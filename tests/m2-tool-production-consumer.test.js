#!/usr/bin/env node

import './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { suite, test, testAsync, summary } from './harness.js';

const {
  DecisionType,
  IntentType,
  ToolType,
} = await import('../src/chat/cre-decision.js');
const {
  ExecutionStatus,
  ToolResult,
  toolExecutor,
} = await import('../src/executor/tool-executor.js');
const { handleToolCallDecision } = await import('../src/chat/handlers/decisions.js');
const { handleFileWriteDecision } = await import('../src/chat/handlers/file.js');
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

suite('M2 ToolRequest/ToolResult — active Studio/chat production boundary');

test('exported active singleton owns a broker; standalone compatibility is not the production path', () => {
  assert.equal(typeof toolExecutor.m2ToolBroker?.execute, 'function');
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
      'TOOL_EFFECT_AUTHORITY_UNAVAILABLE',
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
      assert.equal(result.toolResults[0].errorCode, 'TOOL_EFFECT_AUTHORITY_UNAVAILABLE');
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

await testAsync('authority denial suppresses LLM fallback in regular and REPORT chat paths', async () => {
  const originalExecute = toolExecutor.execute;
  let calls = 0;
  toolExecutor.execute = async () => {
    calls += 1;
    return {
      status: ExecutionStatus.FAILED,
      duration: 1,
      toolResults: [ToolResult.failed({
        type: 'web.search',
        error: 'network effect authority unavailable',
        errorCode: 'TOOL_EFFECT_AUTHORITY_UNAVAILABLE',
      })],
    };
  };
  try {
    for (const intent of [IntentType.SEARCH, IntentType.REPORT]) {
      const response = await handleToolCallDecision(
        'najdi IntentSmith',
        decision(ToolType.WEB_SEARCH, intent),
        {
          ...context({
            input: 'najdi IntentSmith',
            query: 'najdi IntentSmith',
            sessionId: `m2-denial-${intent}`,
            conversationId: `m2-denial-conversation-${intent}`,
            userMessageId: intent === IntentType.SEARCH ? 47 : 48,
          }),
          history: [],
          hasActiveProject: false,
          userPreferences: {},
        },
      );
      assert.equal(response.tag.metadata.securityBlocked, true);
      assert.equal(response.tag.metadata.fallbackSuppressed, true);
      assert.equal(response.tag.metadata.error, 'TOOL_EFFECT_AUTHORITY_UNAVAILABLE');
      assert.match(response.content, /Žádné síťové spojení/);
    }
    assert.equal(calls, 2);
  } finally {
    toolExecutor.execute = originalExecute;
  }
});

await testAsync('mixed pure success plus authority denial is terminal and never reaches synthesis', async () => {
  const originalExecute = toolExecutor.execute;
  let llmStarts = 0;
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
    });
    assert.equal(response.tag.metadata.securityBlocked, true);
    assert.equal(response.tag.metadata.fallbackSuppressed, true);
    assert.equal(response.tag.metadata.error, 'TOOL_EFFECT_AUTHORITY_UNAVAILABLE');
    assert.equal(llmStarts, 0);
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
