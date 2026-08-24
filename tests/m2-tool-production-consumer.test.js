#!/usr/bin/env node

import './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';

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

summary();
