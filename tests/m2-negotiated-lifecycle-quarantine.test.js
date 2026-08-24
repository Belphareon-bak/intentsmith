#!/usr/bin/env node

import assert from 'node:assert/strict';

import { suite, test, testAsync, summary } from './harness.js';
import { createSessionAdapter } from '../src/ws-bridge/session-adapter.js';
import { preHandle } from '../src/chat/handlers/pre-handler.js';
import {
  cancelBuildHandoff,
  getActiveBuildHandoff,
  handleBuildConfirmed,
  handleBuildDetected,
  setHandoffState,
} from '../src/chat/handlers/build-handoff.js';
import {
  clearLcState,
  getLcState,
  setLcState,
} from '../src/chat/handlers/lifecycle-state.js';

const logger = Object.freeze({
  debug() {},
  info() {},
  warn() {},
  error() {},
});

function m1Frame(suffix, input, context = {}) {
  return {
    command: {
      contract: 'ConversationCommand',
      version: 1,
      requestId: `m1-request-${suffix}`,
      conversationId: `m1-conversation-${suffix}`,
      turnId: `m1-turn-${suffix}`,
      action: 'send',
      input,
    },
    context: {
      editMode: 'ask',
      agentId: null,
      projectId: null,
      attachments: [],
      ...context,
    },
  };
}

function controllerResponse(tagged, state = {}) {
  return {
    response: tagged.content,
    mode: tagged.mode,
    confidence: tagged.confidence,
    metadata: tagged.metadata,
    state,
  };
}

function terminalResult(messages, requestId) {
  return messages
    .filter(message => (
      message.channel === 'chat'
      && message.data?.contract === 'CoreEvent'
      && message.data.requestId === requestId
      && message.data.phase === 'terminal'
    ))
    .at(-1)?.data?.payload?.result;
}

const QUICK_BUILD_DECISION = Object.freeze({
  type: 'PLAN',
  intent: 'BUILD',
  confidence: 1,
  metadata: Object.freeze({}),
});

suite('M2 negotiated lifecycle quarantine — M1 context and new BUILD');

await testAsync('negotiated M1 context is explicit and BUILD cannot create either legacy handoff', async () => {
  const suffix = 'build-quarantine';
  const sessionId = `ws-${suffix}`;
  const frame = m1Frame(suffix, 'postav mi kompletní aplikaci s frontendem backendem a databází');
  const sent = [];
  let controllerCalls = 0;
  const adapter = createSessionAdapter({
    sessionId,
    send: encoded => sent.push(JSON.parse(encoded)),
    handleRequest: async request => {
      controllerCalls += 1;
      assert.equal(request.context.m2LifecycleOnly, true);
      const tagged = handleBuildDetected(request.message, QUICK_BUILD_DECISION, {
        ...request.context,
        sessionId,
      });
      return controllerResponse(tagged);
    },
    logger,
  });

  try {
    await adapter.processM1Command(frame);
    assert.equal(controllerCalls, 1);
    assert.equal(getActiveBuildHandoff(sessionId), null, 'quick-build handoff write sentinel');
    assert.equal(getLcState(sessionId), null, 'lifecycle handoff write sentinel');
    assert.deepEqual(terminalResult(sent, frame.command.requestId), {
      contract: 'ConversationResult',
      version: 1,
      requestId: frame.command.requestId,
      conversationId: frame.command.conversationId,
      turnId: frame.command.turnId,
      status: 'error',
      error: {
        code: 'M2_LIFECYCLE_AUTHORITY_REQUIRED',
        message: 'Legacy lifecycle je pro M1 Studio uzavřený. Použij přesný M2 lifecycle plán a schválení.',
      },
    });
  } finally {
    adapter.cleanup();
    cancelBuildHandoff(sessionId);
    clearLcState(sessionId);
  }
});

test('non-M1 callers retain the legacy quick-build proposal semantics', () => {
  const sessionId = 'legacy-build-control';
  try {
    const tagged = handleBuildDetected('postav API endpoint', QUICK_BUILD_DECISION, {
      sessionId,
      m2LifecycleOnly: false,
    });
    assert.equal(tagged.metadata.buildHandoff, true);
    assert.equal(tagged.metadata.phase, 'PROPOSED');
    assert.equal(getActiveBuildHandoff(sessionId)?.phase, 'PROPOSED');
  } finally {
    cancelBuildHandoff(sessionId);
  }
});

suite('M2 negotiated lifecycle quarantine — generic confirmation');

await testAsync('generic ano cannot reach the active legacy build confirmation handler', async () => {
  const sessionId = 'm1-generic-yes-build';
  const originalState = Object.freeze({
    phase: 'PROPOSED',
    workflowSessionId: null,
    originalRequest: 'postav API endpoint',
    plan: null,
    clarificationQuestions: [],
  });
  const downstreamSteps = [];
  setHandoffState(sessionId, originalState);

  try {
    const result = await preHandle('ano', {
      sessionId,
      m2LifecycleOnly: true,
      onSystemStep: (...args) => downstreamSteps.push(args),
    }, 'CONVERSATION');

    assert.equal(result.handled, true);
    assert.equal(result.response.metadata.m2LifecycleRequired, true);
    assert.equal(result.response.metadata.legacyState, 'build');
    assert.deepEqual(downstreamSteps, [], 'build handler invocation sentinel');
    assert.equal(getActiveBuildHandoff(sessionId)?.phase, 'PROPOSED');
    assert.equal(getActiveBuildHandoff(sessionId)?.workflowSessionId, null);
  } finally {
    cancelBuildHandoff(sessionId);
  }
});

await testAsync('negotiated generic ano emits an error terminal without a legacy handler call', async () => {
  const suffix = 'generic-yes-terminal';
  const sessionId = `ws-${suffix}`;
  const frame = m1Frame(suffix, 'ano');
  const sent = [];
  const downstreamSteps = [];
  setHandoffState(sessionId, {
    phase: 'PROPOSED',
    workflowSessionId: null,
    originalRequest: 'postav API endpoint',
    plan: null,
    clarificationQuestions: [],
  });
  const adapter = createSessionAdapter({
    sessionId,
    send: encoded => sent.push(JSON.parse(encoded)),
    handleRequest: async request => {
      const intercepted = await preHandle(request.message, {
        ...request.context,
        sessionId,
        onSystemStep: (...args) => downstreamSteps.push(args),
      }, 'CONVERSATION');
      assert.equal(intercepted.handled, true);
      return controllerResponse(intercepted.response);
    },
    logger,
  });

  try {
    await adapter.processM1Command(frame);
    assert.deepEqual(downstreamSteps, [], 'legacy build handler invocation sentinel');
    assert.equal(getActiveBuildHandoff(sessionId)?.phase, 'PROPOSED');
    assert.equal(getActiveBuildHandoff(sessionId)?.workflowSessionId, null);
    assert.equal(terminalResult(sent, frame.command.requestId)?.status, 'error');
    assert.equal(
      terminalResult(sent, frame.command.requestId)?.error?.code,
      'M2_LIFECYCLE_AUTHORITY_REQUIRED',
    );
  } finally {
    adapter.cleanup();
    cancelBuildHandoff(sessionId);
  }
});

await testAsync('direct generic confirmation guard cannot start Planner or change handoff state', async () => {
  const sessionId = 'm1-direct-generic-yes-build';
  setHandoffState(sessionId, {
    phase: 'PROPOSED',
    workflowSessionId: null,
    originalRequest: 'postav API endpoint',
    plan: null,
    clarificationQuestions: [],
  });

  try {
    const response = await handleBuildConfirmed('ano', {
      sessionId,
      m2LifecycleOnly: true,
    });
    assert.equal(response.metadata.m2LifecycleRequired, true);
    assert.equal(getActiveBuildHandoff(sessionId)?.phase, 'PROPOSED');
    assert.equal(getActiveBuildHandoff(sessionId)?.workflowSessionId, null);
  } finally {
    cancelBuildHandoff(sessionId);
  }
});

await testAsync('generic ano cannot reach an active legacy lifecycle handler', async () => {
  const sessionId = 'm1-generic-yes-lifecycle';
  const downstreamSteps = [];
  setLcState(sessionId, {
    phase: 'PROPOSED',
    lifecycleId: null,
    currentMilestoneId: null,
    originalRequest: 'postav celý projekt',
    projectId: 701,
    projectPath: null,
  });

  try {
    const result = await preHandle('ano', {
      sessionId,
      m2LifecycleOnly: true,
      onSystemStep: (...args) => downstreamSteps.push(args),
    }, 'PROJECT');

    assert.equal(result.handled, true);
    assert.equal(result.response.metadata.m2LifecycleRequired, true);
    assert.equal(result.response.metadata.legacyState, 'lifecycle');
    assert.deepEqual(downstreamSteps, [], 'lifecycle handler invocation sentinel');
    assert.equal(getLcState(sessionId)?.phase, 'PROPOSED');
    assert.equal(getLcState(sessionId)?.lifecycleId, null);
  } finally {
    clearLcState(sessionId);
  }
});

await testAsync('M1 C4 lookup cannot rebind a lifecycle owned by another session', async () => {
  const ownerSessionId = 'legacy-lifecycle-owner';
  const m1SessionId = 'm1-c4-rebind-target';
  setLcState(ownerSessionId, {
    phase: 'SPEC_REVIEW',
    lifecycleId: 'legacy-lifecycle-801',
    currentMilestoneId: null,
    originalRequest: 'legacy project',
    projectId: 801,
    projectPath: '/legacy/project',
  });

  try {
    const result = await preHandle('ukaž stav', {
      sessionId: m1SessionId,
      m2LifecycleOnly: true,
      projectId: 801,
      project: { id: 801, path: '/legacy/project' },
      hasActiveProject: false,
    }, 'PROJECT');

    assert.equal(result.handled, false);
    assert.equal(getLcState(m1SessionId), null, 'C4 setLcState/bind sentinel');
    assert.equal(getLcState(ownerSessionId)?.phase, 'SPEC_REVIEW');
  } finally {
    clearLcState(ownerSessionId);
    clearLcState(m1SessionId);
  }
});

await testAsync('legacy processChat context remains explicitly outside the M1-only quarantine', async () => {
  let observed = null;
  const adapter = createSessionAdapter({
    sessionId: 'legacy-context-control',
    send() {},
    handleRequest: async request => {
      observed = request.context.m2LifecycleOnly;
      return {
        response: 'legacy control response',
        mode: 'conversation',
        confidence: 1,
        state: {},
      };
    },
    logger,
  });
  try {
    await adapter.processChat('běžná legacy zpráva');
    assert.equal(observed, false);
  } finally {
    adapter.cleanup();
  }
});

summary();
