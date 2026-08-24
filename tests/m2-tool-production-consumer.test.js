#!/usr/bin/env node

import './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { suite, test, testAsync, summary } from './harness.js';

const {
  creDecisionEngine,
  DecisionType,
  IntentType,
  ToolType,
  extractFilePath,
  isExplicitFileReadIntent,
  isExplicitFileWriteIntent,
} = await import('../src/chat/cre-decision.js');
const {
  ExecutionStatus,
  ToolResult,
  toolExecutor,
} = await import('../src/executor/tool-executor.js');
const { handleToolCallDecision } = await import('../src/chat/handlers/decisions.js');
const { ChatController, SessionState } = await import('../src/chat/controller.js');
const { conversationHandler } = await import('../src/chat/handlers/conversation.js');
const { handleLocalDecision } = await import('../src/chat/handlers/local.js');
const { handleFileDecision, handleFileWriteDecision } = await import('../src/chat/handlers/file.js');
const { projectHandler } = await import('../src/chat/handlers/project.js');
const { preHandle } = await import('../src/chat/handlers/pre-handler.js');
const { db, projects } = await import('../src/db/database.js');

function decision(tool, intent = IntentType.LOCAL) {
  const value = {
    type: DecisionType.TOOL_CALL,
    intent,
    tools: [tool],
    confidence: 0.9,
    reason: 'test',
    metadata: {},
  };
  value.toJSON = () => ({
    type: value.type,
    intent: value.intent,
    tools: [...value.tools],
    confidence: value.confidence,
    reason: value.reason,
    metadata: value.metadata,
  });
  return value;
}

function context(overrides = {}) {
  return {
    input: '2 + 2',
    query: '2 + 2',
    sessionId: 'm2-tool-session-1',
    conversationId: 'm2-tool-conversation-1',
    userMessageId: 41,
    authenticatedSubject: { actorType: 'user', actorId: 'operator-1' },
    signal: new AbortController().signal,
    maxAutoRetries: 0,
    ...overrides,
  };
}

function fileDecision(filePath) {
  return {
    metadata: { filePath, handler: 'file.write' },
    toJSON() {
      return { type: 'LOCAL', intent: 'FILE_WRITE', metadata: this.metadata };
    },
  };
}

function fileReadDecision(filePath, intent = IntentType.FILE_READ) {
  return {
    intent,
    confidence: 0.95,
    metadata: {
      filePath,
      handler: intent === IntentType.FILE_EXPLAIN ? 'file.explain' : 'file.read',
    },
    toJSON() {
      return { type: DecisionType.LOCAL, intent, metadata: this.metadata };
    },
  };
}

function localDecision(handler) {
  return {
    intent: IntentType.LOCAL,
    confidence: 0.95,
    metadata: { handler },
    toJSON() {
      return { type: DecisionType.LOCAL, intent: this.intent, metadata: this.metadata };
    },
  };
}

suite('M2 ToolRequest/ToolResult — active Studio/chat production boundary');

test('exported active singleton owns a broker; standalone compatibility is not the production path', () => {
  assert.equal(typeof toolExecutor.m2ToolBroker?.execute, 'function');
});

await testAsync('path-only attachment is rejected before persistence, disk read or model work', async () => {
  const directory = mkdtempSync(path.join(process.env.TMPDIR, 'm2-path-only-attachment-'));
  const secretPath = path.join(directory, 'secret.txt');
  writeFileSync(secretPath, 'MUST_NOT_LEAK');
  try {
    const response = await ChatController.handle({
      message: 'vysvětli přílohu',
      sessionId: 'm2-path-only-attachment-session',
      conversationId: 'm2-path-only-attachment-conversation',
      authenticatedSubject: { actorType: 'user', actorId: 'operator-1' },
      attachments: [{ name: 'secret.txt', path: secretPath, size: 13 }],
    });
    assert.equal(response.metadata.securityBlocked, true);
    assert.equal(response.metadata.fallbackSuppressed, true);
    assert.equal(response.metadata.error, 'ATTACHMENT_CONTENT_AUTHORITY_REQUIRED');
    assert.doesNotMatch(response.response, /MUST_NOT_LEAK/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

await testAsync('first project turn consumes persisted context without creating README or scanning files', async () => {
  const directory = mkdtempSync(path.join(process.env.TMPDIR, 'm2-first-project-turn-'));
  const registered = projects.registerExternal(`m2-first-project-turn-${Date.now()}`, directory).project;
  const conversationId = `m2-first-project-turn-conversation-${Date.now()}`;
  ChatController.setProject(conversationId, {
    id: Number(registered.id),
    name: registered.name,
    path: directory,
    description: registered.description || '',
  });
  try {
    assert.equal(existsSync(path.join(directory, 'README.md')), false);
    const response = await ChatController.handle({
      message: 'Kolik je 19 + 23?',
      sessionId: 'm2-first-project-turn-session',
      conversationId,
      authenticatedSubject: { actorType: 'user', actorId: 'operator-1' },
      projectId: Number(registered.id),
      context: { projectId: Number(registered.id) },
    });
    assert.equal(typeof response.response, 'string');
    assert.equal(response.response.length > 0, true);
    assert.equal(existsSync(path.join(directory, 'README.md')), false);
    assert.equal(existsSync(path.join(directory, 'ROADMAP.md')), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

await testAsync('active file.read and FILE_EXPLAIN deny disk and symlink reads through durable authority', async () => {
  const directory = mkdtempSync(path.join(process.env.TMPDIR, 'm2-file-read-denial-'));
  const projectRoot = path.join(directory, 'project');
  mkdirSync(projectRoot, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(projectRoot, 'canary.txt'), 'MUST_NOT_LEAK');
  symlinkSync('canary.txt', path.join(projectRoot, 'alias.txt'));
  const registered = projects.registerExternal(`m2-file-read-${Date.now()}`, projectRoot).project;
  const before = db.prepare(`
    SELECT
      (SELECT count(*) FROM tool_v1_requests) AS requests,
      (SELECT count(*) FROM tool_v1_results) AS results,
      (SELECT count(*) FROM m2_effect_requests) AS effects
  `).get();
  try {
    for (const [index, [filePath, intent]] of [
      ['canary.txt', IntentType.FILE_READ],
      ['alias.txt', IntentType.FILE_EXPLAIN],
    ].entries()) {
      const response = await handleFileDecision(
        `přečti ${filePath}`,
        fileReadDecision(filePath, intent),
        context({
          input: `přečti ${filePath}`,
          query: `přečti ${filePath}`,
          sessionId: `m2-file-read-session-${index}`,
          conversationId: `m2-file-read-conversation-${index}`,
          userMessageId: 520 + index,
          project: { id: Number(registered.id), path: projectRoot },
          projectId: Number(registered.id),
          hasActiveProject: true,
          langCtx: { language: 'cs' },
          sessionState: { recordDecision() {}, setActiveFile() {} },
          attachments: [],
        }),
      );
      assert.equal(response.tag.metadata.securityBlocked, true);
      assert.equal(response.tag.metadata.fallbackSuppressed, true);
      assert.match(response.tag.metadata.toolRequestId, /^tool:[a-f0-9]{64}$/);
      assert.doesNotMatch(response.content, /MUST_NOT_LEAK/);
    }
    const after = db.prepare(`
      SELECT
        (SELECT count(*) FROM tool_v1_requests) AS requests,
        (SELECT count(*) FROM tool_v1_results) AS results,
        (SELECT count(*) FROM m2_effect_requests) AS effects
    `).get();
    assert.deepEqual({
      requests: after.requests - before.requests,
      results: after.results - before.results,
      effects: after.effects - before.effects,
    }, { requests: 2, results: 2, effects: 0 });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

await testAsync('project path routing keeps writes on FILE_WRITE and root listing durable', async () => {
  const directory = mkdtempSync(path.join(process.env.TMPDIR, 'm2-project-path-routing-'));
  const projectRoot = path.join(directory, 'project');
  mkdirSync(projectRoot, { recursive: true, mode: 0o700 });
  const registered = projects.registerExternal(`m2-project-routing-${Date.now()}`, projectRoot).project;
  const originalDecide = creDecisionEngine.decide;
  const writeInputs = [
    'zapiš ahoj do notes.txt',
    'chci uložit text do saved.txt',
    'vytvořit soubor plan.md a uložit ho do plan.md',
    'write this to result.txt',
  ];
  let decideCalls = 0;
  try {
    for (const input of writeInputs) {
      assert.equal(isExplicitFileReadIntent(input), false, input);
      assert.equal(isExplicitFileWriteIntent(input), true, input);
    }
    assert.equal(isExplicitFileReadIntent('přečti notes.txt'), true);
    assert.equal(isExplicitFileWriteIntent('přečti notes.txt'), false);

    creDecisionEngine.decide = async input => {
      decideCalls += 1;
      return creDecisionEngine.overrideDecision({
        type: DecisionType.LOCAL,
        intent: IntentType.FILE_WRITE,
        tools: [],
        source: 'm2_project_routing_test',
        reason: 'deterministic FILE_WRITE production-path probe',
        confidence: 1,
        metadata: {
          handler: 'file.write',
          filePath: extractFilePath(input),
        },
      });
    };

    for (const [index, input] of writeInputs.entries()) {
      const target = extractFilePath(input);
      const response = await projectHandler(input, context({
        input,
        query: input,
        sessionId: `m2-project-write-session-${index}`,
        conversationId: `m2-project-write-conversation-${index}`,
        userMessageId: 600 + index,
        project: { id: Number(registered.id), path: projectRoot, name: 'routing' },
        projectId: Number(registered.id),
        history: [
          { response: { content: `durable content ${index}\n`, tag: { speaker: 'system' } } },
          { response: { content: input, tag: { speaker: 'user' } } },
        ],
        sessionState: { recordDecision() {}, setActiveFile() {} },
        hasActiveProject: true,
      }));
      assert.equal(response.tag.metadata.handler, 'file.write');
      assert.equal(response.tag.metadata.approvalRequired, true);
      assert.match(response.tag.metadata.toolRequestId, /^tool:[a-f0-9]{64}$/);
      assert.equal(existsSync(path.join(projectRoot, target)), false);
      const stored = db.prepare(`
        SELECT tool_id, request_json FROM tool_v1_requests WHERE request_id = ?
      `).get(response.tag.metadata.toolRequestId);
      assert.equal(stored.tool_id, 'file.write');
      assert.equal(JSON.parse(stored.request_json).input.path, target);
    }
    assert.equal(decideCalls, writeInputs.length);

    creDecisionEngine.decide = async () => {
      assert.fail('project listing heuristic must not call CRE or an LLM');
    };
    const listing = await projectHandler('vypiš soubory v projektu', context({
      input: 'vypiš soubory v projektu',
      query: 'vypiš soubory v projektu',
      sessionId: 'm2-project-list-session',
      conversationId: 'm2-project-list-conversation',
      userMessageId: 610,
      project: { id: Number(registered.id), path: projectRoot, name: 'routing' },
      projectId: Number(registered.id),
      history: [],
      sessionState: { recordDecision() {}, setActiveFile() {} },
      hasActiveProject: true,
    }));
    assert.equal(listing.tag.metadata.handler, 'file.list');
    assert.equal(listing.tag.metadata.fallbackSuppressed, true);
    assert.match(listing.tag.metadata.toolRequestId, /^tool:[a-f0-9]{64}$/);
    const listRequest = db.prepare(`
      SELECT tool_id, request_json FROM tool_v1_requests WHERE request_id = ?
    `).get(listing.tag.metadata.toolRequestId);
    assert.equal(listRequest.tool_id, 'file.list');
    assert.deepEqual(JSON.parse(listRequest.request_json).input, { path: '.' });
  } finally {
    creDecisionEngine.decide = originalDecide;
    rmSync(directory, { recursive: true, force: true });
  }
});

await testAsync('active LOCAL math uses one durable provider result and exact replay', async () => {
  const exactContext = context({
    input: '847 děleno 7',
    query: '847 děleno 7',
    sessionId: 'm2-local-dispatch-session',
    conversationId: 'm2-local-dispatch-conversation',
    userMessageId: 525,
    history: [],
    langCtx: { language: 'cs' },
    sessionState: { recordDecision() {} },
  });
  const before = db.prepare(`
    SELECT
      (SELECT count(*) FROM tool_v1_requests) AS requests,
      (SELECT count(*) FROM tool_v1_results) AS results
  `).get();
  const first = await handleLocalDecision(
    '847 děleno 7',
    localDecision('local.math'),
    exactContext,
  );
  const replay = await handleLocalDecision(
    '847 děleno 7',
    localDecision('local.math'),
    exactContext,
  );
  assert.equal(first.tag.metadata.computationResult.answer, 121);
  assert.match(first.tag.metadata.toolRequestId, /^tool:[a-f0-9]{64}$/);
  assert.equal(first.content, replay.content);
  assert.deepEqual(first.tag.metadata.computationResult, replay.tag.metadata.computationResult);
  assert.equal(first.tag.metadata.toolRequestId, replay.tag.metadata.toolRequestId);
  const after = db.prepare(`
    SELECT
      (SELECT count(*) FROM tool_v1_requests) AS requests,
      (SELECT count(*) FROM tool_v1_results) AS results
  `).get();
  assert.deepEqual({
    requests: after.requests - before.requests,
    results: after.results - before.results,
  }, { requests: 1, results: 1 });
});

await testAsync('date correction replay creates a fresh durable LOCAL terminal and suppresses denial fallback', async () => {
  const previous = creDecisionEngine.overrideDecision({
    type: DecisionType.LOCAL,
    intent: IntentType.LOCAL,
    tools: ['local.date'],
    source: 'm2_date_correction_seed',
    reason: 'seed previous durable LOCAL decision',
    confidence: 1,
    metadata: { handler: 'local.date' },
  });
  const state = new SessionState('m2-date-correction-state');
  state.recordDecision(previous, 'jaké je dnes datum');
  const correctionContext = context({
    input: 'dnes je ale 8.2.2026',
    query: 'dnes je ale 8.2.2026',
    sessionId: 'm2-date-correction-session',
    conversationId: 'm2-date-correction-conversation',
    userMessageId: 620,
    sessionState: state,
    history: [],
    hasActiveProject: false,
    userPreferences: {},
  });
  const before = db.prepare(`
    SELECT count(*) AS count FROM tool_v1_requests WHERE tool_id = 'local.date'
  `).get().count;
  const response = await conversationHandler('dnes je ale 8.2.2026', correctionContext);
  assert.match(response.tag.metadata.toolRequestId, /^tool:[a-f0-9]{64}$/);
  assert.equal(response.tag.metadata.toolTerminalStatus, 'ok');
  assert.equal(response.tag.metadata.fallbackSuppressed, undefined);
  const durable = db.prepare(`
    SELECT request.tool_id, result.status
    FROM tool_v1_requests request
    JOIN tool_v1_results result ON result.request_id = request.request_id
    WHERE request.request_id = ?
  `).get(response.tag.metadata.toolRequestId);
  assert.deepEqual(durable, { tool_id: 'local.date', status: 'ok' });
  assert.equal(db.prepare(`
    SELECT count(*) AS count FROM tool_v1_requests WHERE tool_id = 'local.date'
  `).get().count, before + 1);

  const originalBroker = toolExecutor.m2ToolBroker;
  const deniedState = new SessionState('m2-date-correction-denied-state');
  deniedState.recordDecision(previous, 'jaké je dnes datum');
  try {
    toolExecutor.m2ToolBroker = {
      async execute() {
        throw Object.assign(new Error('injected result conflict'), {
          code: 'TOOL_RESULT_CONFLICT',
        });
      },
    };
    const denied = await conversationHandler('dnes je ale 8.2.2026', {
      ...correctionContext,
      sessionId: 'm2-date-correction-denied-session',
      conversationId: 'm2-date-correction-denied-conversation',
      userMessageId: 621,
      sessionState: deniedState,
    });
    assert.equal(denied.tag.metadata.securityBlocked, true);
    assert.equal(denied.tag.metadata.fallbackSuppressed, true);
    assert.equal(denied.tag.metadata.error, 'TOOL_RESULT_CONFLICT');
    assert.equal(denied.tag.metadata.m2AuthorityFailure, true);
  } finally {
    toolExecutor.m2ToolBroker = originalBroker;
  }
});

test('active chat file boundary has no ambient fs read or README writer seam', () => {
  const controllerSource = readFileSync(new URL('../src/chat/controller.js', import.meta.url), 'utf8');
  const fileSource = readFileSync(new URL('../src/chat/handlers/file.js', import.meta.url), 'utf8');
  const projectSource = readFileSync(new URL('../src/chat/handlers/project.js', import.meta.url), 'utf8');
  const contextInitSource = readFileSync(new URL('../src/chat/context-init.js', import.meta.url), 'utf8');
  assert.doesNotMatch(controllerSource, /readFileSync\s*\(/);
  assert.doesNotMatch(fileSource, /\bfs\.(?:stat|readdir|readFile)\s*\(/);
  assert.doesNotMatch(projectSource, /\breaddirSync\s*\(/);
  assert.doesNotMatch(contextInitSource, /\b(?:ensureReadme|readFileSync|writeFileSync|existsSync)\s*\(/);
});

await testAsync('local.math crosses durable ToolRequest/ToolResult and preserves legacy response data', async () => {
  const result = await toolExecutor.execute(decision(ToolType.LOCAL_MATH), context());
  assert.equal(result.status, ExecutionStatus.SUCCESS);
  assert.equal(result.toolResults.length, 1);
  assert.equal(result.toolResults[0].success, true);
  assert.equal(result.toolResults[0].data.subtype, 'math');
  assert.equal(result.toolResults[0].data.result, 4);
  assert.match(result.toolResults[0].meta.m2ToolRequestId, /^tool:[a-f0-9]{64}$/);
  assert.equal(result.toolResults[0].meta.m2ToolStatus, 'ok');
  assert.equal(result.toolResults[0].meta.m2RiskClass, 'pure');
});

await testAsync('production direct handler receives the exact NFC ToolRequest input', async () => {
  const original = toolExecutor.toolHandlers.get(ToolType.LOCAL_MATH);
  let invokedQuery = null;
  let calls = 0;
  toolExecutor.register(ToolType.LOCAL_MATH, async params => {
    calls += 1;
    invokedQuery = params.query;
    const value = ToolResult.local({
      subtype: 'math',
      data: { expression: params.query, result: 4 },
    });
    value.meta = {
      timestamp: 9_999_999_999_999,
      source: 'forged-provider-meta',
      privileged: true,
    };
    return value;
  });
  try {
    const exactContext = context({
      input: 'Cafe\u0301',
      query: 'Cafe\u0301',
      sessionId: 'm2-tool-session-nfc',
      conversationId: 'm2-tool-conversation-nfc',
      userMessageId: 51,
    });
    const first = await toolExecutor.execute(
      decision(ToolType.LOCAL_MATH),
      exactContext,
    );
    const replay = await toolExecutor.execute(decision(ToolType.LOCAL_MATH), exactContext);
    assert.equal(first.status, ExecutionStatus.SUCCESS);
    assert.equal(replay.status, ExecutionStatus.SUCCESS);
    assert.equal(calls, 1);
    assert.equal(invokedQuery, 'Café');
    assert.equal(first.toolResults[0].data.expression, 'Café');
    assert.deepEqual(replay.toolResults[0], first.toolResults[0]);
    assert.equal(first.toolResults[0].meta.source, 'm2-durable-authority');
    assert.equal(first.toolResults[0].meta.privileged, undefined);
    assert.notEqual(first.toolResults[0].meta.timestamp, 9_999_999_999_999);
  } finally {
    toolExecutor.register(ToolType.LOCAL_MATH, original);
  }
});

await testAsync('exact retry returns the durable result without invoking the handler again', async () => {
  const original = toolExecutor.toolHandlers.get(ToolType.LOCAL_MATH);
  let calls = 0;
  toolExecutor.register(ToolType.LOCAL_MATH, async params => {
    calls += 1;
    return original(params);
  });
  try {
    const retryContext = context({
      sessionId: 'm2-tool-session-retry',
      conversationId: 'm2-tool-conversation-retry',
      userMessageId: 42,
    });
    const first = await toolExecutor.execute(decision(ToolType.LOCAL_MATH), retryContext);
    const second = await toolExecutor.execute(decision(ToolType.LOCAL_MATH), retryContext);
    assert.equal(first.status, ExecutionStatus.SUCCESS);
    assert.equal(second.status, ExecutionStatus.SUCCESS);
    assert.equal(calls, 1);
    assert.equal(
      first.toolResults[0].meta.m2ToolRequestId,
      second.toolResults[0].meta.m2ToolRequestId,
    );
  } finally {
    toolExecutor.register(ToolType.LOCAL_MATH, original);
  }
});

await testAsync('web.search is denied before handler and before any fetch attempt', async () => {
  const original = toolExecutor.toolHandlers.get(ToolType.WEB_SEARCH);
  const originalFetch = globalThis.fetch;
  let handlerCalls = 0;
  let fetchCalls = 0;
  toolExecutor.register(ToolType.WEB_SEARCH, async () => {
    handlerCalls += 1;
    return ToolResult.search({ results: [], count: 0, source: 'forged', latency: 0 });
  });
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('network must not be reached');
  };
  try {
    const result = await toolExecutor.execute(
      decision(ToolType.WEB_SEARCH, IntentType.SEARCH),
      context({
        input: 'IntentSmith',
        query: 'IntentSmith',
        sessionId: 'm2-tool-session-web',
        conversationId: 'm2-tool-conversation-web',
        userMessageId: 43,
        project: { id: 17, path: '/workspace/project-a' },
      }),
    );
    assert.equal(result.status, ExecutionStatus.FAILED);
    assert.equal(handlerCalls, 0);
    assert.equal(fetchCalls, 0);
    assert.equal(
      result.toolResults[0].errorCode,
      'TOOL_EFFECT_TRANSLATION_INVALID',
    );
    assert.equal(result.toolResults[0].meta.m2RiskClass, 'network');
  } finally {
    toolExecutor.register(ToolType.WEB_SEARCH, original);
    globalThis.fetch = originalFetch;
  }
});

await testAsync('open legacy circuit cannot bypass durable M2 authority', async () => {
  const original = toolExecutor.toolHandlers.get(ToolType.WEB_SEARCH);
  let handlerCalls = 0;
  toolExecutor.register(ToolType.WEB_SEARCH, async () => {
    handlerCalls += 1;
    return ToolResult.search({ results: [], count: 0, source: 'forged', latency: 0 });
  });
  try {
    const requestIds = [];
    for (let index = 0; index < 6; index += 1) {
      const result = await toolExecutor.execute(
        decision(ToolType.WEB_SEARCH, IntentType.SEARCH),
        context({
          input: `IntentSmith ${index}`,
          query: `IntentSmith ${index}`,
          sessionId: 'm2-tool-session-circuit',
          conversationId: 'm2-tool-conversation-circuit',
          userMessageId: 60 + index,
          project: { id: 17, path: '/workspace/project-a' },
        }),
      );
      assert.equal(result.status, ExecutionStatus.FAILED);
      assert.equal(result.toolResults[0].errorCode, 'TOOL_EFFECT_TRANSLATION_INVALID');
      assert.match(result.toolResults[0].meta.m2ToolRequestId, /^tool:[a-f0-9]{64}$/);
      requestIds.push(result.toolResults[0].meta.m2ToolRequestId);
    }
    assert.equal(handlerCalls, 0);
    assert.equal(new Set(requestIds).size, 6);
  } finally {
    toolExecutor.register(ToolType.WEB_SEARCH, original);
  }
});

await testAsync('web.scrape, database and unregistered tools cannot bypass the dispatcher', async () => {
  const originalScrape = toolExecutor.toolHandlers.get(ToolType.WEB_SCRAPE);
  const originalDatabase = toolExecutor.toolHandlers.get(ToolType.DATABASE_QUERY);
  let scrapeCalls = 0;
  let databaseCalls = 0;
  let unknownCalls = 0;
  toolExecutor.register(ToolType.WEB_SCRAPE, async () => {
    scrapeCalls += 1;
    return {};
  });
  toolExecutor.register('specialist.unknown-effect', async () => {
    unknownCalls += 1;
    return {};
  });
  toolExecutor.register(ToolType.DATABASE_QUERY, async () => {
    databaseCalls += 1;
    return {};
  });
  try {
    const scrape = await toolExecutor.execute(
      decision(ToolType.WEB_SCRAPE, IntentType.REPORT),
      context({
        input: 'https://example.test/',
        query: 'test',
        url: 'https://example.test/',
        sessionId: 'm2-tool-session-scrape',
        conversationId: 'm2-tool-conversation-scrape',
        userMessageId: 44,
        project: { id: 17, path: '/workspace/project-a' },
      }),
    );
    const unknown = await toolExecutor.execute(
      decision('specialist.unknown-effect', IntentType.CODE),
      context({
        input: 'run specialist',
        query: 'run specialist',
        sessionId: 'm2-tool-session-unknown',
        conversationId: 'm2-tool-conversation-unknown',
        userMessageId: 45,
      }),
    );
    const database = await toolExecutor.execute(
      decision(ToolType.DATABASE_QUERY, IntentType.CODE),
      context({
        input: 'select 1',
        query: 'select 1',
        sessionId: 'm2-tool-session-database',
        conversationId: 'm2-tool-conversation-database',
        userMessageId: 49,
        project: { id: 17, path: '/workspace/project-a' },
      }),
    );
    assert.equal(scrape.status, ExecutionStatus.FAILED);
    assert.equal(unknown.status, ExecutionStatus.FAILED);
    assert.equal(database.status, ExecutionStatus.FAILED);
    assert.equal(scrapeCalls, 0);
    assert.equal(databaseCalls, 0);
    assert.equal(unknownCalls, 0);
  } finally {
    toolExecutor.register(ToolType.WEB_SCRAPE, originalScrape);
    toolExecutor.register(ToolType.DATABASE_QUERY, originalDatabase);
    toolExecutor.unregister('specialist.unknown-effect');
  }
});

await testAsync('missing authenticated or persisted identity fails before a pure handler', async () => {
  const original = toolExecutor.toolHandlers.get(ToolType.LOCAL_MATH);
  let calls = 0;
  toolExecutor.register(ToolType.LOCAL_MATH, async params => {
    calls += 1;
    return original(params);
  });
  try {
    const noSubject = await toolExecutor.execute(
      decision(ToolType.LOCAL_MATH),
      context({
        sessionId: 'm2-tool-session-no-subject',
        conversationId: 'm2-tool-conversation-no-subject',
        userMessageId: 46,
        authenticatedSubject: null,
      }),
    );
    const noMessage = await toolExecutor.execute(
      decision(ToolType.LOCAL_MATH),
      context({
        sessionId: 'm2-tool-session-no-message',
        conversationId: 'm2-tool-conversation-no-message',
        userMessageId: null,
      }),
    );
    assert.equal(noSubject.status, ExecutionStatus.FAILED);
    assert.equal(noMessage.status, ExecutionStatus.FAILED);
    assert.equal(calls, 0);
  } finally {
    toolExecutor.register(ToolType.LOCAL_MATH, original);
  }
});

await testAsync('authority denial or live claim suppresses fallback in regular and REPORT chat paths', async () => {
  const originalExecute = toolExecutor.execute;
  let calls = 0;
  try {
    for (const errorCode of [
      'TOOL_EFFECT_AUTHORITY_UNAVAILABLE',
      'TOOL_EFFECT_TRANSLATION_INVALID',
      'TOOL_EXECUTION_IN_PROGRESS',
    ]) {
      toolExecutor.execute = async () => {
        calls += 1;
        return {
          status: ExecutionStatus.FAILED,
          duration: 1,
          toolResults: [ToolResult.failed({
            type: 'web.search',
            error: errorCode,
            errorCode,
          })],
        };
      };
      for (const intent of [IntentType.SEARCH, IntentType.REPORT]) {
        let llmStarts = 0;
        const response = await handleToolCallDecision(
          'najdi IntentSmith',
          decision(ToolType.WEB_SEARCH, intent),
          {
            ...context({
              input: 'najdi IntentSmith',
              query: 'najdi IntentSmith',
              sessionId: `m2-denial-${errorCode}-${intent}`,
              conversationId: `m2-denial-conversation-${errorCode}-${intent}`,
              userMessageId: calls + 47,
            }),
            history: [],
            hasActiveProject: false,
            userPreferences: {},
            onLLMStart() { llmStarts += 1; },
          },
        );
        assert.equal(response.tag.metadata.securityBlocked, true);
        assert.equal(response.tag.metadata.fallbackSuppressed, true);
        assert.equal(response.tag.metadata.error, errorCode);
        assert.equal(llmStarts, 0);
        if (errorCode === 'TOOL_EXECUTION_IN_PROGRESS') {
          assert.equal(response.tag.metadata.executionInProgress, true);
          assert.match(response.content, /aktivní M2 execution claim/);
        } else if (errorCode === 'TOOL_EFFECT_AUTHORITY_UNAVAILABLE') {
          assert.match(response.content, /Žádné síťové spojení/);
        }
      }
    }
    assert.equal(calls, 6);
  } finally {
    toolExecutor.execute = originalExecute;
  }
});

await testAsync('thrown broker/repository authority failures keep exact codes and suppress chat fallback', async () => {
  const originalBroker = toolExecutor.m2ToolBroker;
  try {
    for (const errorCode of [
      'M2_TOOL_RESULT_UNCOMMITTED',
      'TOOL_AUTHORITY_STORAGE_FAILURE',
      'TOOL_REQUEST_CONFLICT',
      'TOOL_RESULT_CONFLICT',
      'TOOL_EFFECT_LINK_MISMATCH',
      'M2_TOOL_BROKER_CONTRACT_INVALID',
      'EFFECT_AUTHORITY_STORAGE_FAILURE',
    ]) {
      toolExecutor.m2ToolBroker = {
        async execute() {
          throw Object.assign(new Error(`injected ${errorCode}`), { code: errorCode });
        },
      };
      for (const intent of [IntentType.SEARCH, IntentType.REPORT]) {
        let llmStarts = 0;
        const response = await handleToolCallDecision(
          'najdi authority failure',
          decision(ToolType.WEB_SEARCH, intent),
          {
            ...context({
              input: 'najdi authority failure',
              query: 'najdi authority failure',
              sessionId: `m2-thrown-${errorCode}-${intent}`,
              conversationId: `m2-thrown-conversation-${errorCode}-${intent}`,
              userMessageId: 530 + llmStarts,
            }),
            history: [],
            hasActiveProject: false,
            userPreferences: {},
            onLLMStart() { llmStarts += 1; },
          },
        );
        assert.equal(response.tag.metadata.securityBlocked, true);
        assert.equal(response.tag.metadata.fallbackSuppressed, true);
        assert.equal(response.tag.metadata.m2AuthorityFailure, true);
        assert.equal(response.tag.metadata.error, errorCode);
        assert.equal(llmStarts, 0);
      }
    }
  } finally {
    toolExecutor.m2ToolBroker = originalBroker;
  }
});

await testAsync('mixed pure success plus authority denial is terminal and never reaches synthesis', async () => {
  const originalExecute = toolExecutor.execute;
  let llmStarts = 0;
  const toolEvents = [];
  toolExecutor.execute = async () => ({
    status: ExecutionStatus.PARTIAL,
    duration: 1,
    toolResults: [
      ToolResult.local({ subtype: 'math', data: { expression: '2+2', result: 4 } }),
      ToolResult.failed({
        type: 'web.search',
        error: 'network effect authority unavailable',
        errorCode: 'TOOL_EFFECT_AUTHORITY_UNAVAILABLE',
      }),
    ],
  });
  const mixedDecision = decision(ToolType.LOCAL_MATH, IntentType.FACTUAL);
  mixedDecision.tools = [ToolType.LOCAL_MATH, ToolType.WEB_SEARCH];
  try {
    const response = await handleToolCallDecision('spočítej a vyhledej', mixedDecision, {
      ...context({
        input: 'spočítej a vyhledej',
        query: 'spočítej a vyhledej',
        sessionId: 'm2-mixed-denial-session',
        conversationId: 'm2-mixed-denial-conversation',
        userMessageId: 50,
      }),
      history: [],
      hasActiveProject: false,
      userPreferences: {},
      onLLMStart() { llmStarts += 1; },
      onToolResult(tool, event) { toolEvents.push({ tool, event }); },
    });
    assert.equal(response.tag.metadata.securityBlocked, true);
    assert.equal(response.tag.metadata.fallbackSuppressed, true);
    assert.equal(response.tag.metadata.error, 'TOOL_EFFECT_AUTHORITY_UNAVAILABLE');
    assert.equal(llmStarts, 0);
    assert.equal(toolEvents.length, 1);
    assert.equal(toolEvents[0].event.success, false);
    assert.equal(toolEvents[0].event.errorCode, 'TOOL_EFFECT_AUTHORITY_UNAVAILABLE');
  } finally {
    toolExecutor.execute = originalExecute;
  }
});

await testAsync('durable effect terminals suppress mixed synthesis and all-failed fallback', async () => {
  const originalExecute = toolExecutor.execute;
  const terminalCodes = [
    'TOOL_EFFECT_PREPARATION_FAILED',
    'TOOL_CANCELLED',
    'TOOL_TIMEOUT',
    'EFFECT_WORKSPACE_STALE',
    'EFFECT_PROVIDER_FAILED',
    'EFFECT_ORPHANED',
  ];
  try {
    for (const [index, errorCode] of terminalCodes.entries()) {
      for (const shape of ['mixed', 'failed']) {
        let llmStarts = 0;
        const toolEvents = [];
        const terminal = ToolResult.failed({
          type: 'web.search',
          error: errorCode,
          errorCode,
          meta: {
            m2ToolRequestId: `tool:${String(index + 1).repeat(64)}`,
            m2RiskClass: 'network',
            effectRequestId: `effect:${String(index + 1).repeat(64)}`,
          },
        });
        toolExecutor.execute = async () => ({
          status: shape === 'mixed' ? ExecutionStatus.PARTIAL : ExecutionStatus.FAILED,
          duration: 1,
          toolResults: shape === 'mixed'
            ? [ToolResult.local({ subtype: 'math', data: { expression: '2+2', result: 4 } }), terminal]
            : [terminal],
        });
        const terminalDecision = decision(
          shape === 'mixed' ? ToolType.LOCAL_MATH : ToolType.WEB_SEARCH,
          shape === 'mixed' ? IntentType.FACTUAL : IntentType.SEARCH,
        );
        if (shape === 'mixed') {
          terminalDecision.tools = [ToolType.LOCAL_MATH, ToolType.WEB_SEARCH];
        }
        const response = await handleToolCallDecision('durable terminal', terminalDecision, {
          ...context({
            input: 'durable terminal',
            query: 'durable terminal',
            sessionId: `m2-durable-terminal-${shape}-${index}`,
            conversationId: `m2-durable-terminal-conversation-${shape}-${index}`,
            userMessageId: 600 + (index * 2) + (shape === 'failed' ? 1 : 0),
          }),
          history: [],
          hasActiveProject: false,
          userPreferences: {},
          onLLMStart() { llmStarts += 1; },
          onToolResult(tool, event) { toolEvents.push({ tool, event }); },
        });
        assert.equal(response.tag.metadata.fallbackSuppressed, true);
        assert.equal(response.tag.metadata.m2EffectTerminal, true);
        assert.equal(response.tag.metadata.error, errorCode);
        assert.equal(llmStarts, 0);
        assert.equal(toolEvents.length, 1);
        assert.equal(toolEvents[0].event.success, false);
        assert.equal(toolEvents[0].event.errorCode, errorCode);
      }
    }
  } finally {
    toolExecutor.execute = originalExecute;
  }
});

await testAsync('production file.write persists request/link, approval settles one result across reconnect', async () => {
  const parent = mkdtempSync(path.join(process.env.TMPDIR, 'm2-tool-journey-'));
  const projectRoot = path.join(parent, 'project');
  mkdirSync(projectRoot, { recursive: true, mode: 0o700 });
  const registered = projects.registerExternal(`m2-tool-${Date.now()}`, projectRoot).project;
  const target = path.join(projectRoot, 'result.md');
  const baseContext = context({
    sessionId: 'm2-tool-write-session-before-reconnect',
    conversationId: 'm2-tool-write-conversation',
    userMessageId: 501,
    project: { id: Number(registered.id), path: projectRoot },
    projectId: Number(registered.id),
    input: 'save it to result.md',
    query: 'save it to result.md',
    history: [
      { response: { content: 'durable tool content\n', tag: { speaker: 'system' } } },
      { response: { content: 'save it to result.md', tag: { speaker: 'user' } } },
    ],
    langCtx: { language: 'en' },
    sessionState: { setActiveFile() {} },
  });
  try {
    const pending = await handleFileWriteDecision(
      'save it to result.md',
      fileDecision('result.md'),
      baseContext,
    );
    const effectId = pending.tag.metadata.effectId;
    assert.equal(pending.tag.metadata.approvalRequired, true);
    assert.match(pending.tag.metadata.toolRequestId, /^tool:[a-f0-9]{64}$/);
    assert.match(effectId, /^effect:[a-f0-9]{64}$/);
    assert.equal(existsSync(target), false);
    assert.deepEqual(db.prepare(`
      SELECT
        (SELECT count(*) FROM tool_v1_requests WHERE request_id = ?) AS requests,
        (SELECT count(*) FROM m2_tool_effect_links WHERE request_id = ?) AS links,
        (SELECT count(*) FROM tool_v1_results WHERE request_id = ?) AS results
    `).get(
      pending.tag.metadata.toolRequestId,
      pending.tag.metadata.toolRequestId,
      pending.tag.metadata.toolRequestId,
    ), { requests: 1, links: 1, results: 0 });

    const reconnectedContext = {
      ...baseContext,
      sessionId: 'm2-tool-write-session-after-reconnect',
      userMessageId: 502,
    };
    const approved = await preHandle(
      `approve effect ${effectId}`,
      reconnectedContext,
      'PROJECT',
    );
    assert.equal(approved.handled, true);
    assert.equal(approved.response.tag.metadata.effectResult, 'succeeded');
    assert.equal(approved.response.tag.metadata.toolResult, 'ok');
    assert.equal(readFileSync(target, 'utf8'), 'durable tool content\n');
    assert.equal(
      db.prepare('SELECT count(*) AS count FROM tool_v1_results WHERE request_id = ?')
        .get(pending.tag.metadata.toolRequestId).count,
      1,
    );

    const replay = await handleFileWriteDecision(
      'save it to result.md',
      fileDecision('result.md'),
      { ...baseContext, sessionId: 'm2-tool-write-session-third', userMessageId: 501 },
    );
    assert.equal(replay.tag.metadata.terminalStatus, 'ok');
    assert.equal(replay.tag.metadata.approvalRequired, false);
    assert.equal(
      db.prepare('SELECT count(*) AS count FROM m2_effect_requests WHERE effect_id = ?')
        .get(effectId).count,
      1,
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

await testAsync('workspace drift before approval settles both effect and tool as durable errors', async () => {
  const parent = mkdtempSync(path.join(process.env.TMPDIR, 'm2-tool-stale-approval-'));
  const projectRoot = path.join(parent, 'project');
  mkdirSync(projectRoot, { recursive: true, mode: 0o700 });
  const registered = projects.registerExternal(`m2-tool-stale-${Date.now()}`, projectRoot).project;
  const target = path.join(projectRoot, 'stale.md');
  const writeContext = context({
    sessionId: 'm2-tool-stale-session',
    conversationId: 'm2-tool-stale-conversation',
    userMessageId: 506,
    project: { id: Number(registered.id), path: projectRoot },
    projectId: Number(registered.id),
    input: 'save it to stale.md',
    query: 'save it to stale.md',
    history: [
      { response: { content: 'must not be written\n', tag: { speaker: 'system' } } },
      { response: { content: 'save it to stale.md', tag: { speaker: 'user' } } },
    ],
    langCtx: { language: 'en' },
    sessionState: { setActiveFile() {} },
  });
  try {
    const pending = await handleFileWriteDecision(
      'save it to stale.md',
      fileDecision('stale.md'),
      writeContext,
    );
    const effectId = pending.tag.metadata.effectId;
    writeFileSync(path.join(projectRoot, 'workspace-drift.txt'), 'changed after request\n');

    const approved = await preHandle(
      `approve effect ${effectId}`,
      { ...writeContext, sessionId: 'm2-tool-stale-reconnected', userMessageId: 507 },
      'PROJECT',
    );

    assert.equal(approved.handled, true);
    assert.equal(approved.response.tag.metadata.effectResult, 'failed');
    assert.equal(approved.response.tag.metadata.toolResult, 'error');
    assert.equal(existsSync(target), false);
    const durable = db.prepare(`
      SELECT
        (SELECT terminal_status FROM m2_effect_results WHERE effect_id = ?) AS effectStatus,
        (SELECT result_json FROM m2_effect_results WHERE effect_id = ?) AS effectJson,
        (SELECT status FROM tool_v1_results WHERE request_id = ?) AS toolStatus,
        (SELECT result_json FROM tool_v1_results WHERE request_id = ?) AS toolJson,
        (SELECT count(*) FROM m2_pending_effect_payloads WHERE effect_id = ?) AS pending
    `).get(
      effectId,
      effectId,
      pending.tag.metadata.toolRequestId,
      pending.tag.metadata.toolRequestId,
      effectId,
    );
    assert.deepEqual({
      effectStatus: durable.effectStatus,
      effectError: JSON.parse(durable.effectJson).errorCode,
      toolStatus: durable.toolStatus,
      toolError: JSON.parse(durable.toolJson).error.code,
      pending: durable.pending,
    }, {
      effectStatus: 'failed',
      effectError: 'EFFECT_WORKSPACE_STALE',
      toolStatus: 'error',
      toolError: 'EFFECT_WORKSPACE_STALE',
      pending: 0,
    });
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

await testAsync('file.write does not smuggle an unauthorized parent-directory creation', async () => {
  const parent = mkdtempSync(path.join(process.env.TMPDIR, 'm2-tool-no-mkdir-'));
  const projectRoot = path.join(parent, 'project');
  mkdirSync(projectRoot, { recursive: true, mode: 0o700 });
  const registered = projects.registerExternal(`m2-tool-no-mkdir-${Date.now()}`, projectRoot).project;
  const target = path.join(projectRoot, 'missing/result.md');
  const writeContext = context({
    sessionId: 'm2-tool-no-mkdir-session',
    conversationId: 'm2-tool-no-mkdir-conversation',
    userMessageId: 503,
    project: { id: Number(registered.id), path: projectRoot },
    projectId: Number(registered.id),
    input: 'save it to missing/result.md',
    query: 'save it to missing/result.md',
    history: [
      { response: { content: 'bounded content\n', tag: { speaker: 'system' } } },
      { response: { content: 'save it to missing/result.md', tag: { speaker: 'user' } } },
    ],
    langCtx: { language: 'en' },
    sessionState: { setActiveFile() {} },
  });
  try {
    const pending = await handleFileWriteDecision(
      'save it to missing/result.md',
      fileDecision('missing/result.md'),
      writeContext,
    );
    const approved = await preHandle(
      `approve effect ${pending.tag.metadata.effectId}`,
      { ...writeContext, sessionId: 'm2-tool-no-mkdir-reconnected', userMessageId: 504 },
      'PROJECT',
    );
    assert.equal(approved.handled, true);
    assert.equal(approved.response.tag.metadata.effectResult, 'failed');
    assert.equal(approved.response.tag.metadata.toolResult, 'error');
    assert.equal(existsSync(target), false);
    assert.equal(existsSync(path.dirname(target)), false);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

summary();
