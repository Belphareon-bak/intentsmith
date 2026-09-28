#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  cp,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { suite, test, testAsync, summary } from './harness.js';
import {
  PROJECT_CONTEXT_ERROR_CODE,
  validateProjectContextSnapshot,
} from '../contracts/m2/project-context-v1.js';
import { projectContextProvider } from '../src/code-intel/project-context-provider.js';
import { AbortSource, abortWithReason } from '../src/core/abort-error.js';
import { handleCodeAnalysisDecision } from '../src/chat/handlers/code-analysis.js';
import { llmGateway } from '../src/llm/gateway.js';
import { finalizeChatResponse } from '../src/chat/response-finalizer.js';
import { ChatController } from '../src/chat/controller.js';
import { throwIfTerminalChatFailure } from '../src/core/chat-turn-error.js';

const fixtureRoot = fileURLToPath(
  new URL('./fixtures/m2-project-context/', import.meta.url),
);
const projectAFixture = path.join(fixtureRoot, 'project-a');
const projectBFixture = path.join(fixtureRoot, 'project-b');
const projectARoot = await realpath(projectAFixture);
const projectBRoot = await realpath(projectBFixture);
const handlerSource = await readFile(
  fileURLToPath(new URL('../src/chat/handlers/code-analysis.js', import.meta.url)),
  'utf8',
);
const providerSource = await readFile(
  fileURLToPath(new URL('../src/code-intel/project-context-provider.js', import.meta.url)),
  'utf8',
);

function projectRegistry(rows) {
  return {
    findById: {
      get(projectId) {
        return rows.find(row => row.id === projectId) ?? null;
      },
    },
  };
}

function handlerContext(projectId, projectPath, overrides = {}) {
  return {
    project: {
      id: projectId,
      name: `fixture-${projectId}`,
      path: projectPath,
    },
    ...overrides,
  };
}

function metadataOf(response) {
  return response.metadata.projectContext;
}

async function withCopiedProject(callback) {
  const temporaryParent = await mkdtemp(path.join(os.tmpdir(), 'is-m2-context-consumer-'));
  const root = path.join(temporaryParent, 'project-a');
  try {
    await cp(projectAFixture, root, { recursive: true });
    await callback(await realpath(root));
  } finally {
    await rm(temporaryParent, { recursive: true, force: true });
  }
}

suite('M2 project-context consumer — production call graph containment');

test('the production consumer path imports the provider and no legacy retrieval or answer fallback', () => {
  assert.match(
    handlerSource,
    /from ['"]\.\.\/\.\.\/code-intel\/project-context-provider\.js['"]/,
  );
  for (const forbidden of [
    'code-search.js',
    'file-discovery.js',
    'symbol-index.js',
    'knowledge-graph.js',
    'graph-retrieval.js',
  ]) {
    assert.equal(handlerSource.includes(forbidden), false, `legacy import remains: ${forbidden}`);
    assert.equal(providerSource.includes(forbidden), false, `provider legacy import remains: ${forbidden}`);
  }
  assert.equal(handlerSource.includes('handleAnswerDecision'), false);
  assert.equal(handlerSource.includes("import('./decisions.js')"), false);
  for (const forbiddenEffect of [
    'node:child_process',
    'node:http',
    'node:https',
    'node:net',
    'execFile(',
    'spawn(',
    'fetch(',
    'writeFile(',
    'appendFile(',
  ]) {
    assert.equal(
      providerSource.includes(forbiddenEffect),
      false,
      `provider side-effect dependency remains: ${forbiddenEffect}`,
    );
  }
  assert.equal(providerSource.includes('localeCompare'), false);
  assert.equal(providerSource.includes('Intl.Collator'), false);
  assert.equal((providerSource.match(/\bDate\.now\b/g) ?? []).length, 1);
});

await testAsync('real provider runs observe then query before the injected LLM', async () => {
  const projects = projectRegistry([
    { id: 1701, path: projectARoot, status: 'active' },
  ]);
  const calls = [];
  let observed;
  let capturedQuery;
  let capturedSnapshot;
  let capturedPrompt;
  const observingProvider = {
    async observeWorkspaceRevision(...args) {
      calls.push('observe');
      observed = await projectContextProvider.observeWorkspaceRevision(...args);
      return observed;
    },
    async queryProjectContext(query, ...rest) {
      calls.push('query');
      capturedQuery = structuredClone(query);
      capturedSnapshot = await projectContextProvider.queryProjectContext(query, ...rest);
      return capturedSnapshot;
    },
  };

  const response = await handleCodeAnalysisDecision(
    'validateSessionToken',
    { intent: 'CODE_ANALYSIS' },
    handlerContext(1701, projectARoot, {
      workspaceRevision: `wsr1:${'f'.repeat(64)}`,
    }),
    {
      projectContextProvider: observingProvider,
      projectContextDependencies: { projects },
      async realpath(root) {
        calls.push('realpath');
        return realpath(root);
      },
      async classifyIntent(prompt, options) {
        calls.push('llm');
        capturedPrompt = prompt;
        assert.equal(options.snapshot.workspaceRevision, observed.workspaceRevision);
        return { content: 'SESSION_ANALYSIS_FROM_FAKE_LLM' };
      },
    },
  );

  assert.deepEqual(calls, ['realpath', 'observe', 'query', 'llm']);
  assert.equal(capturedQuery.workspaceRevision, observed.workspaceRevision);
  assert.notEqual(capturedQuery.workspaceRevision, `wsr1:${'f'.repeat(64)}`);
  assert.equal(capturedQuery.canonicalRoot, projectARoot);
  assert.equal(capturedQuery.projectId, 1701);
  assert.equal(validateProjectContextSnapshot(capturedSnapshot).valid, true);
  assert.match(capturedQuery.requestId, /^code-context:[0-9a-f]{64}$/);
  assert.match(capturedPrompt, /src\/auth\/validateSessionToken\.js:/);
  assert.match(capturedPrompt, /SESSION_VALIDATION_RESULT/);
  assert.equal(capturedPrompt.includes('PROJECT_B_CANARY_DO_NOT_LEAK'), false);
  assert.match(response.content, /SESSION_ANALYSIS_FROM_FAKE_LLM/);
  assert.match(response.content, /src\/auth\/validateSessionToken\.js/);
  assert.equal(metadataOf(response).status, 'ok');
  assert.equal(metadataOf(response).outcome, 'found');
  assert.equal(metadataOf(response).workspaceRevision, observed.workspaceRevision);
});

await testAsync('stable empty is exposed as empty and never calls a model or answer fallback', async () => {
  const projects = projectRegistry([
    { id: 1701, path: projectARoot, status: 'active' },
  ]);
  let modelCalls = 0;

  const response = await handleCodeAnalysisDecision(
    'termThatDoesNotExistInEitherFixture',
    { intent: 'CODE_ANALYSIS' },
    handlerContext(1701, projectARoot),
    {
      projectContextDependencies: { projects },
      async classifyIntent() {
        modelCalls += 1;
        throw new Error('model must not run for empty context');
      },
    },
  );

  assert.equal(modelCalls, 0);
  assert.equal(metadataOf(response).status, 'ok');
  assert.equal(metadataOf(response).outcome, 'empty');
  assert.match(response.content, /nebyla nalezena/i);
});

await testAsync('concurrent production journeys keep project A and B prompts isolated', async () => {
  const projects = projectRegistry([
    { id: 1701, path: projectARoot, status: 'active' },
    { id: 1702, path: projectBRoot, status: 'active' },
  ]);
  const prompts = new Map();
  const classifyIntent = async (prompt, { snapshot }) => {
    prompts.set(snapshot.projectId, prompt);
    return `analysis-${snapshot.projectId}`;
  };
  const dependencies = {
    projectContextDependencies: { projects },
    classifyIntent,
  };

  const [responseA, responseB] = await Promise.all([
    handleCodeAnalysisDecision(
      'validateSessionToken',
      { intent: 'CODE_ANALYSIS' },
      handlerContext(1701, projectARoot),
      dependencies,
    ),
    handleCodeAnalysisDecision(
      'validateSessionToken',
      { intent: 'CODE_ANALYSIS' },
      handlerContext(1702, projectBRoot),
      dependencies,
    ),
  ]);

  assert.equal(metadataOf(responseA).projectId, 1701);
  assert.equal(metadataOf(responseB).projectId, 1702);
  assert.equal(prompts.get(1701).includes('PROJECT_B_CANARY_DO_NOT_LEAK'), false);
  assert.equal(prompts.get(1701).includes(projectBRoot), false);
  assert.match(prompts.get(1702), /PROJECT_B_CANARY_DO_NOT_LEAK/);
});

suite('M2 project-context consumer — fail-closed terminal behavior');

// Exercise the default bridge, not the injected classifyIntent seam which
// previously hid malformed model options and lost terminal metadata.
async function withAnalysisGateway(gateway, callback) {
  const original = llmGateway.call;
  const originalFetch = globalThis.fetch;
  llmGateway.call = gateway;
  globalThis.fetch = async () => { throw new Error('Unexpected network in analysis regression'); };
  try { await callback(); } finally {
    llmGateway.call = original;
    globalThis.fetch = originalFetch;
  }
}

async function productionAnalysis(context = {}) {
  return handleCodeAnalysisDecision('validateSessionToken', { intent: 'CODE_ANALYSIS' },
    handlerContext(1701, projectARoot, context), {
      projectContextDependencies: {
        projects: projectRegistry([{ id: 1701, path: projectARoot, status: 'active' }]),
      },
    });
}

async function finalizeAnalysis(response, persisted) {
  return finalizeChatResponse({
    result: response, message: 'validateSessionToken', sessionId: 'analysis-regression',
    conversationId: 'analysis-regression', turnId: 'analysis-turn',
    persistAssistantTurn: (content, metadata) => persisted.push({ content, metadata }),
    dependencies: { scoreResponse: async () => ({ total: 100, dimensions: {}, issues: [] }) },
    log: { info() {}, warn() {}, error() {} },
  });
}

await testAsync('default bridge uses authorized reasoning prose and preserves successful output identity', async () => {
  const abort = new AbortController();
  let captured;
  await withAnalysisGateway(async (prompt, options) => {
    captured = options;
    assert.match(prompt, /validateSessionToken/);
    return { content: 'Verified project analysis.', model: 'fixture-model', finishReason: 'stop' };
  }, async () => {
    const response = await productionAnalysis({ signal: abort.signal });
    assert.equal(typeof captured.systemPrompt, 'string');
    assert.equal(captured._authToken.role, 'WORKFLOW_ANALYZER');
    assert.equal(captured.format, undefined);
    assert.equal(captured.signal, abort.signal);
    assert.equal(response.metadata.finishReason, 'stop');
    const persisted = [];
    await finalizeAnalysis(response, persisted);
    assert.equal(persisted.length, 1);
    assert.match(persisted[0].content, /^Verified project analysis\./);
    assert.equal(persisted[0].metadata.model, 'fixture-model');
    assert.equal(persisted[0].metadata.m7.status, 'ok');
  });
});

for (const scenario of [
  { name: 'provider outage', code: 'LLM_PROVIDER_UNAVAILABLE', run: async () => { throw new Error('provider down'); } },
  { name: 'truncated output', code: 'MODEL_RESPONSE_TRUNCATED', run: async () => ({ content: 'unfinished', finishReason: 'length' }) },
  { name: 'empty output', code: 'LLM_PROVIDER_UNAVAILABLE', run: async () => ({ content: '' }) },
]) {
  await testAsync(`${scenario.name} never enters controller history or assistant persistence`, async () => {
    await withAnalysisGateway(scenario.run, async () => {
      const response = await productionAnalysis();
      assert.throws(() => throwIfTerminalChatFailure(response), { code: scenario.code });
      const persisted = [];
      await assert.rejects(finalizeAnalysis(response, persisted), { code: scenario.code });
      assert.equal(persisted.length, 0);
      const controller = new ChatController({
        sessionId: 'analysis-regression', config: { autoModeDetection: false },
        handlers: { project: async () => response },
      });
      await assert.rejects(controller.process('validateSessionToken', {
        forceMode: 'project', project: { id: 1701 }, hasActiveProject: true,
      }), { code: scenario.code });
    });
  });
}

await testAsync('deadline abort reaches the real bridge while a provider is pending', async () => {
  await withAnalysisGateway(async (_prompt, options) => {
    assert(options.signal instanceof AbortSignal);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 1000);
      options.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        // The gateway normalizes its transport abort into the shared contract.
        const error = new Error('deadline');
        error.name = 'AbortError'; error.abortSource = 'timeout'; reject(error);
      }, { once: true });
    });
    throw new Error('deadline was ignored');
  }, async () => {
    const response = await productionAnalysis({ deadlineAt: Date.now() + 100 });
    assert.equal(metadataOf(response).status, 'timeout');
    assert.throws(() => throwIfTerminalChatFailure(response), { name: 'AbortError', abortSource: 'timeout' });
    const persisted = [];
    await assert.rejects(finalizeAnalysis(response, persisted), { name: 'AbortError' });
    assert.equal(persisted.length, 0);
  });
});

await testAsync('a late model success after user cancellation is not persisted', async () => {
  const abort = new AbortController();
  await withAnalysisGateway(async () => {
    abortWithReason(abort, AbortSource.USER);
    return { content: 'late success', finishReason: 'stop' };
  }, async () => {
    const response = await productionAnalysis({ signal: abort.signal });
    assert.equal(metadataOf(response).status, 'cancelled');
    const persisted = [];
    await assert.rejects(finalizeAnalysis(response, persisted), { name: 'AbortError', abortSource: 'user' });
    assert.equal(persisted.length, 0);
  });
});

await testAsync('a change between observation and query is stale and never reaches the model', async () => {
  await withCopiedProject(async root => {
    const projects = projectRegistry([{ id: 1701, path: root, status: 'active' }]);
    let modelCalls = 0;
    let mutated = false;
    const changingProvider = {
      observeWorkspaceRevision: (...args) => projectContextProvider.observeWorkspaceRevision(...args),
      async queryProjectContext(...args) {
        if (!mutated) {
          mutated = true;
          await writeFile(
            path.join(root, 'src', 'auth', 'validateSessionToken.js'),
            "export const changedBetweenObservationAndQuery = true;\n",
          );
        }
        return projectContextProvider.queryProjectContext(...args);
      },
    };

    const response = await handleCodeAnalysisDecision(
      'validateSessionToken',
      { intent: 'CODE_ANALYSIS' },
      handlerContext(1701, root),
      {
        projectContextProvider: changingProvider,
        projectContextDependencies: { projects },
        async classifyIntent() {
          modelCalls += 1;
          throw new Error('model must not run for stale context');
        },
      },
    );

    assert.equal(mutated, true);
    assert.equal(modelCalls, 0);
    assert.equal(metadataOf(response).status, 'error');
    assert.equal(metadataOf(response).error.code, PROJECT_CONTEXT_ERROR_CODE.STALE);
    assert.equal(validateProjectContextSnapshot(metadataOf(response)).valid, true);
    assert.notEqual(
      metadataOf(response).error.expectedRevision,
      metadataOf(response).error.observedRevision,
    );
    assert.equal(Object.hasOwn(metadataOf(response), 'items'), false);
  });
});

await testAsync('synthesis failure preserves the successful snapshot evidence and never falls back', async () => {
  const projects = projectRegistry([
    { id: 1701, path: projectARoot, status: 'active' },
  ]);
  const response = await handleCodeAnalysisDecision(
    'validateSessionToken',
    { intent: 'CODE_ANALYSIS' },
    handlerContext(1701, projectARoot),
    {
      projectContextDependencies: { projects },
      async classifyIntent() {
        throw new Error('synthetic synthesis failure');
      },
    },
  );

  assert.equal(metadataOf(response).status, 'ok');
  assert.equal(metadataOf(response).outcome, 'found');
  assert.equal(response.metadata.synthesis.status, 'error');
  assert.equal(response.metadata.synthesis.code, 'CODE_ANALYSIS_SYNTHESIS_FAILED');
  assert.match(response.content, /nepodařilo dokončit/i);
});

await testAsync('project ID/root mismatch remains invalid scope and does not invoke the model', async () => {
  const projects = projectRegistry([
    { id: 1701, path: projectARoot, status: 'active' },
    { id: 1702, path: projectBRoot, status: 'active' },
  ]);
  let modelCalls = 0;

  const response = await handleCodeAnalysisDecision(
    'validateSessionToken',
    { intent: 'CODE_ANALYSIS' },
    handlerContext(1701, projectBRoot),
    {
      projectContextDependencies: { projects },
      async classifyIntent() {
        modelCalls += 1;
      },
    },
  );

  assert.equal(modelCalls, 0);
  assert.equal(metadataOf(response).status, 'error');
  assert.equal(metadataOf(response).error.code, PROJECT_CONTEXT_ERROR_CODE.INVALID_SCOPE);
});

await testAsync('pre-cancel and elapsed deadline stay distinct before any model call', async () => {
  const projects = projectRegistry([
    { id: 1701, path: projectARoot, status: 'active' },
  ]);
  let modelCalls = 0;
  const classifyIntent = async () => {
    modelCalls += 1;
    throw new Error('model must not run after cancellation or timeout');
  };
  const controller = new AbortController();
  abortWithReason(controller, AbortSource.USER, 'consumer fixture cancellation');

  const cancelled = await handleCodeAnalysisDecision(
    'validateSessionToken',
    { intent: 'CODE_ANALYSIS' },
    handlerContext(1701, projectARoot, { signal: controller.signal }),
    { projectContextDependencies: { projects }, classifyIntent },
  );
  const timeout = await handleCodeAnalysisDecision(
    'validateSessionToken',
    { intent: 'CODE_ANALYSIS' },
    handlerContext(1701, projectARoot, { deadlineAt: 10 }),
    {
      projectContextDependencies: { projects, now: () => 10 },
      classifyIntent,
    },
  );

  assert.equal(modelCalls, 0);
  assert.equal(metadataOf(cancelled).status, 'cancelled');
  assert.equal(metadataOf(cancelled).error.code, PROJECT_CONTEXT_ERROR_CODE.CANCELLED);
  assert.equal(metadataOf(timeout).status, 'timeout');
  assert.equal(metadataOf(timeout).error.code, PROJECT_CONTEXT_ERROR_CODE.TIMEOUT);
});

await testAsync('missing provider is not-ready and cannot fall through to legacy retrieval', async () => {
  let modelCalls = 0;
  const response = await handleCodeAnalysisDecision(
    'validateSessionToken',
    { intent: 'CODE_ANALYSIS' },
    handlerContext(1701, projectARoot),
    {
      projectContextProvider: {},
      async classifyIntent() {
        modelCalls += 1;
      },
    },
  );

  assert.equal(modelCalls, 0);
  assert.equal(metadataOf(response).status, 'error');
  assert.equal(metadataOf(response).error.code, PROJECT_CONTEXT_ERROR_CODE.NOT_READY);
});

summary();
