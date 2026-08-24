import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { suite, testAsync, summary } from './harness.js';

const { handleFileWriteDecision } = await import('../src/chat/handlers/file.js');
const { parseExactEffectApproval } = await import('../src/chat/handlers/pre-handler.js');
const { handleToolCallDecision } = await import('../src/chat/handlers/decisions.js');
const { toolExecutor, ExecutionStatus, ToolResult } = await import('../src/executor/tool-executor.js');

function decision(filePath = 'notes/result.md') {
  const serialized = { type: 'FILE_WRITE', metadata: { handler: 'file.write', filePath } };
  return {
    metadata: { handler: 'file.write', filePath },
    toJSON: () => serialized,
  };
}

function context(projectRoot, overrides = {}) {
  return {
    project: { id: 17, path: projectRoot },
    projectId: 17,
    authenticatedSubject: { actorType: 'user', actorId: 'user-1' },
    userMessageId: 41,
    sessionId: 'session-1',
    conversationId: 'conversation-1',
    history: [
      { response: { content: 'authoritative assistant content\n', tag: { speaker: 'system' } } },
      { response: { content: 'ulož to do notes/result.md', tag: { speaker: 'user' } } },
    ],
    langCtx: { language: 'en' },
    signal: new AbortController().signal,
    ...overrides,
  };
}

async function withProject(callback) {
  const directory = mkdtempSync(path.join(tmpdir(), 'intentsmith-m2-effect-consumer-'));
  const projectRoot = path.join(directory, 'project');
  mkdirSync(projectRoot, { recursive: true });
  try {
    return await callback({ directory, projectRoot });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

suite('M2 first filesystem effect consumer');

await testAsync('handler delegates exact bytes and authority context to the M2 ToolRequest seam without writing', async () => {
  await withProject(async ({ projectRoot }) => {
    const calls = [];
    const requestReached = new Promise(resolve => {
      calls.onRequest = resolve;
    });
    let release;
    const runtimeResult = new Promise(resolve => { release = resolve; });
    const injectedToolExecutor = {
      async executeM2Tool(input) {
        calls.push(input);
        calls.onRequest();
        return runtimeResult;
      },
    };
    const handlerContext = context(projectRoot);
    const target = path.join(projectRoot, 'notes/result.md');
    const responsePromise = handleFileWriteDecision(
      'ulož to do notes/result.md',
      decision(),
      handlerContext,
      { toolExecutor: injectedToolExecutor },
    );

    await requestReached;
    assert.equal(existsSync(target), false, 'consumer must not write before or instead of the broker runtime');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      toolId: 'file.write',
      input: {
        path: 'notes/result.md',
        content: 'authoritative assistant content\n',
      },
      context: handlerContext,
      timeoutMs: 120_000,
    });

    release({
      request: { requestId: `tool:${'f'.repeat(64)}` },
      effectRequestId: `effect:${'a'.repeat(64)}`,
      state: 'approval_required',
      result: null,
    });
    const response = await responsePromise;
    assert.equal(existsSync(target), false, 'request registration must not be presented as a completed write');
    assert.equal(response.tag.canExecute, false);
    assert.equal(response.tag.metadata.handler, 'file.write');
    assert.equal(response.tag.metadata.fileOperation, false);
    assert.equal(response.tag.metadata.approvalRequired, true);
    assert.equal(response.tag.metadata.effectState, 'approval_required');
    assert.equal(response.tag.metadata.effectId, `effect:${'a'.repeat(64)}`);
    assert.match(response.content, /awaits approval/i);
  });
});

await testAsync('missing project or authenticated caller blocks before the runtime seam', async () => {
  await withProject(async ({ projectRoot }) => {
    let runtimeCalls = 0;
    const injectedToolExecutor = {
      async executeM2Tool() {
        runtimeCalls += 1;
        return {
          request: { requestId: `tool:${'f'.repeat(64)}` },
          effectRequestId: `effect:${'b'.repeat(64)}`,
          state: 'approval_required',
          result: null,
        };
      },
    };
    const cases = [
      context(projectRoot, { project: null, projectId: null }),
      context(projectRoot, { authenticatedSubject: null }),
      context(projectRoot, { userMessageId: null }),
    ];

    for (const handlerContext of cases) {
      const response = await handleFileWriteDecision(
        'ulož to do notes/result.md',
        decision(),
        handlerContext,
        { toolExecutor: injectedToolExecutor },
      );
      assert.equal(response.tag.metadata.securityBlocked, true);
      assert.equal(response.tag.metadata.error, 'effect_authority_required');
      assert.equal(response.tag.canExecute, false);
    }
    assert.equal(runtimeCalls, 0);
    assert.equal(existsSync(path.join(projectRoot, 'notes/result.md')), false);
  });
});

await testAsync('runtime rejection is surfaced as authorization failure and never falls back to a legacy write', async () => {
  await withProject(async ({ projectRoot }) => {
    let runtimeCalls = 0;
    const injectedToolExecutor = {
      async executeM2Tool() {
        runtimeCalls += 1;
        const error = new Error('workspace changed after approval');
        error.code = 'EFFECT_WORKSPACE_STALE';
        throw error;
      },
    };
    const response = await handleFileWriteDecision(
      'ulož to do notes/result.md',
      decision(),
      context(projectRoot),
      { toolExecutor: injectedToolExecutor },
    );

    assert.equal(runtimeCalls, 1);
    assert.equal(response.tag.canExecute, false);
    assert.equal(response.tag.metadata.error, 'EFFECT_WORKSPACE_STALE');
    assert.equal(response.tag.metadata.fileOperation, undefined);
    assert.match(response.content, /was not authorized/i);
    assert.equal(existsSync(path.join(projectRoot, 'notes/result.md')), false);
  });
});

await testAsync('an unavailable injected runtime fails closed instead of using direct filesystem APIs', async () => {
  await withProject(async ({ projectRoot }) => {
    const response = await handleFileWriteDecision(
      'ulož to do notes/result.md',
      decision(),
      context(projectRoot),
      { toolExecutor: {} },
    );

    assert.equal(response.tag.canExecute, false);
    assert.equal(response.tag.metadata.error, 'TOOL_EFFECT_AUTHORITY_UNAVAILABLE');
    assert.equal(existsSync(path.join(projectRoot, 'notes/result.md')), false);
  });
});

await testAsync('an idempotent terminal retry is rendered without asking for a second approval', async () => {
  await withProject(async ({ projectRoot }) => {
    const effectId = `effect:${'d'.repeat(64)}`;
    const response = await handleFileWriteDecision(
      'ulož to do notes/result.md',
      decision(),
      context(projectRoot),
      {
        toolExecutor: {
          async executeM2Tool() {
            return {
              request: { requestId: `tool:${'e'.repeat(64)}` },
              value: { path: 'notes/result.md', effectId, terminalStatus: 'succeeded' },
              result: { status: 'ok', effectRequestId: effectId },
            };
          },
        },
      },
    );

    assert.equal(response.tag.metadata.effectId, effectId);
    assert.equal(response.tag.metadata.effectState, 'terminal');
    assert.equal(response.tag.metadata.terminalStatus, 'ok');
    assert.equal(response.tag.metadata.approvalRequired, false);
    assert.equal(response.tag.metadata.fileOperation, true);
    assert.doesNotMatch(response.content, /approve|schvál/i);
  });
});

await testAsync('approval parser accepts only a command containing the exact full effect ID', async () => {
  const effectId = `effect:${'c'.repeat(64)}`;
  assert.equal(parseExactEffectApproval(`schválit efekt ${effectId}`), effectId);
  assert.equal(parseExactEffectApproval(`approve effect ${effectId}`), effectId);
  for (const rejected of ['ano', 'schvaluji', 'schválit efekt', `schválit efekt ${effectId.slice(0, -1)}`]) {
    assert.equal(parseExactEffectApproval(rejected), null);
  }
});

await testAsync('security hook is telemetry-only and authority denial comes from the M2 executor', async () => {
  const originalExecute = toolExecutor.execute;
  let executorCalls = 0;
  toolExecutor.execute = async () => {
    executorCalls += 1;
    return {
      status: ExecutionStatus.FAILED,
      duration: 1,
      toolResults: [ToolResult.failed({
        type: 'file.write',
        error: 'exact effect approval is required',
        errorCode: 'TOOL_EFFECT_AUTHORITY_REQUIRED',
      })],
    };
  };
  const authorityError = new Error('M2 effect authority is required');
  authorityError.code = 'M2_EFFECT_AUTHORITY_REQUIRED';
  const legacyDecision = {
    intent: 'FILE_WRITE',
    confidence: 1,
    tools: ['web.search', 'file.write'],
    metadata: {},
    toJSON: () => ({ intent: 'FILE_WRITE', tools: ['web.search', 'file.write'] }),
  };
  const hookedTools = [];

  try {
    const response = await handleToolCallDecision('write the file', legacyDecision, {
        sessionState: null,
        history: [],
        hasActiveProject: true,
        onToolCall: async tool => {
          hookedTools.push(tool);
          if (tool === 'file.write') throw authorityError;
        },
      });
    assert.deepEqual(hookedTools, ['web.search', 'file.write']);
    assert.equal(executorCalls, 1);
    assert.equal(response.tag.metadata.securityBlocked, true);
    assert.equal(response.tag.metadata.fallbackSuppressed, true);
  } finally {
    toolExecutor.execute = originalExecute;
  }
});

summary();
