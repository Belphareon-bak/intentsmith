#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  M2_REMOTE_CORE_CAPABILITY_IDS,
  M2_REMOTE_CORE_CAPABILITY_STATUS,
  M2_REMOTE_CORE_ERROR_CODE,
  M2_REMOTE_CORE_NEGOTIATION_STATUS,
  M2_REMOTE_CORE_PORT_KIND,
  M2_REMOTE_CORE_PORT_VERSION,
  computeM2RemoteCoreValueDigest,
  validateM2RemoteCoreNegotiationForHello,
} from '../contracts/m2/remote-core-port-v1.js';
import {
  M5_REMOTE_CORE_ADAPTER_MANIFEST_DIGEST_V1,
  M5_REMOTE_CORE_ADAPTER_MANIFEST_V1,
  M5_REMOTE_CORE_CAPABILITY_MANIFESTS_V1,
  M5_REMOTE_CORE_OPERATION,
} from '../contracts/m5/remote-core-adapter-v1.js';
import {
  M5_REMOTE_CORE_ADAPTER_ERROR,
  M5_REMOTE_CORE_IMPLEMENTED_CAPABILITIES,
  createM5RemoteCorePortAdapter,
} from '../src/remote/remote-core-port-adapter.js';
import {
  computeProjectContextSnapshotDigest,
  normalizeProjectContextQuery,
} from '../contracts/m2/project-context-v1.js';
import { suite, summary, test, testAsync } from './harness.js';

const SENT_AT = '2026-08-26T13:00:00.000Z';
const CLOCK_MS = Date.parse('2026-08-26T13:00:00.001Z');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hello(capabilityIds = M2_REMOTE_CORE_CAPABILITY_IDS, overrides = {}) {
  return {
    contract: M2_REMOTE_CORE_PORT_KIND.HELLO,
    version: M2_REMOTE_CORE_PORT_VERSION,
    requestId: 'm5-remote-hello-001',
    clientId: 'm5-in-process-fixture',
    clientBuild: 'm5-candidate',
    supportedPortVersions: [1],
    capabilities: capabilityIds.map(capabilityId => ({ capabilityId, versions: [1] })),
    sentAt: SENT_AT,
    ...overrides,
  };
}

function command(overrides = {}) {
  return {
    contract: 'ConversationCommand',
    version: 1,
    requestId: 'remote-conversation-001',
    conversationId: 'conversation-001',
    turnId: 'turn-001',
    action: 'send',
    input: 'Kolik je 17 * 23?',
    ...overrides,
  };
}

function conversationResult(request, overrides = {}) {
  return {
    contract: 'ConversationResult',
    version: 1,
    requestId: request.requestId,
    conversationId: request.conversationId,
    turnId: request.turnId,
    status: 'ok',
    response: { content: '391' },
    ...overrides,
  };
}

function projectQuery(overrides = {}) {
  return {
    contract: 'ProjectContextQuery',
    version: 1,
    requestId: 'remote-project-001',
    projectId: 7,
    canonicalRoot: '/workspace/project',
    workspaceRevision: `wsr1:${'a'.repeat(64)}`,
    queryText: 'find request authority',
    maxFiles: 8,
    maxBytes: 8_192,
    maxTokens: 2_048,
    ...overrides,
  };
}

function projectResult(request, overrides = {}) {
  return {
    contract: 'ProjectContextSnapshot',
    version: 1,
    requestId: request.requestId,
    projectId: request.projectId,
    status: 'error',
    error: {
      code: 'PROJECT_CONTEXT_NOT_READY',
      message: 'Project context index is not ready.',
    },
    ...overrides,
  };
}

function successfulProjectResult(request, overrides = {}) {
  const normalized = normalizeProjectContextQuery(request.queryText);
  const result = {
    contract: 'ProjectContextSnapshot',
    version: 1,
    requestId: request.requestId,
    projectId: request.projectId,
    status: 'ok',
    outcome: 'empty',
    workspaceRevision: request.workspaceRevision,
    normalizationVersion: normalized.normalizationVersion,
    normalizedQuery: normalized.normalizedQuery,
    terms: [...normalized.terms],
    items: [],
    budget: {
      maxFiles: request.maxFiles,
      maxBytes: request.maxBytes,
      maxTokens: request.maxTokens,
      usedFiles: 0,
      usedBytes: 0,
      usedTokens: 0,
    },
    truncation: { truncated: false },
    ...overrides,
  };
  result.snapshotDigest = computeProjectContextSnapshotDigest(result);
  return result;
}

function adapter(overrides = {}) {
  return createM5RemoteCorePortAdapter({
    clock: () => CLOCK_MS,
    executeConversation: async request => conversationResult(request),
    queryProjectContext: async request => projectResult(request),
    ...overrides,
  });
}

function invocation(port, capabilityId, operationId, request, requestedHello = hello()) {
  return {
    hello: requestedHello,
    negotiation: port.negotiate(requestedHello),
    capabilityId,
    capabilityVersion: 1,
    operationId,
    request,
  };
}

suite('M5 RemoteCorePort in-process adapter manifest');

test('manifest exposes only exact payload contracts that already exist', () => {
  assert.deepEqual(M5_REMOTE_CORE_IMPLEMENTED_CAPABILITIES, ['conversations', 'projects']);
  assert.deepEqual(
    M5_REMOTE_CORE_ADAPTER_MANIFEST_V1.capabilities.map(item => item.capabilityId),
    ['conversations', 'projects'],
  );
  assert.equal(
    computeM2RemoteCoreValueDigest(M5_REMOTE_CORE_ADAPTER_MANIFEST_V1),
    M5_REMOTE_CORE_ADAPTER_MANIFEST_DIGEST_V1,
  );
  assert.deepEqual(
    M5_REMOTE_CORE_CAPABILITY_MANIFESTS_V1.conversations.contractManifest.contracts,
    ['ConversationCommand@1', 'ConversationResult@1'],
  );
  assert.deepEqual(
    M5_REMOTE_CORE_CAPABILITY_MANIFESTS_V1.projects.contractManifest.contracts,
    ['ProjectContextQuery@1', 'ProjectContextSnapshot@1'],
  );
  assert.equal(Object.isFrozen(M5_REMOTE_CORE_ADAPTER_MANIFEST_V1.capabilities[0]), true);
});

test('all seven requested capabilities get one truthful result and only two are available', () => {
  const port = adapter();
  const request = hello();
  const result = port.negotiate(request);
  assert.equal(validateM2RemoteCoreNegotiationForHello(request, result).valid, true);
  assert.equal(result.status, M2_REMOTE_CORE_NEGOTIATION_STATUS.NEGOTIATED);
  assert.deepEqual(
    result.capabilities.filter(item => item.status === 'available').map(item => item.capabilityId),
    ['conversations', 'projects'],
  );
  assert.equal(result.capabilities.length, 7);
  for (const item of result.capabilities.filter(entry => entry.status === 'unavailable')) {
    assert.equal(item.error.code, M2_REMOTE_CORE_ERROR_CODE.CAPABILITY_UNAVAILABLE);
  }
});

test('unsupported-only hello is unavailable rather than empty success', () => {
  const port = adapter();
  const request = hello(['approvals', 'events', 'notifications']);
  const result = port.negotiate(request);
  assert.equal(result.status, M2_REMOTE_CORE_NEGOTIATION_STATUS.UNAVAILABLE);
  assert.equal(result.error.code, M2_REMOTE_CORE_ERROR_CODE.NO_CAPABILITY_AVAILABLE);
  assert.equal(result.capabilities.every(item => item.status === 'unavailable'), true);
  assert.equal(validateM2RemoteCoreNegotiationForHello(request, result).valid, true);
});

test('foreign port and capability versions fail closed without an implicit downgrade', () => {
  const port = adapter();
  const foreignPort = hello(['conversations'], { supportedPortVersions: [2] });
  assert.equal(port.negotiate(foreignPort).status, M2_REMOTE_CORE_NEGOTIATION_STATUS.INCOMPATIBLE);

  const foreignCapability = hello(['conversations']);
  foreignCapability.capabilities[0].versions = [2];
  const result = port.negotiate(foreignCapability);
  assert.equal(result.status, M2_REMOTE_CORE_NEGOTIATION_STATUS.UNAVAILABLE);
  assert.equal(result.capabilities[0].status, M2_REMOTE_CORE_CAPABILITY_STATUS.INCOMPATIBLE);
  assert.equal(
    result.capabilities[0].error.code,
    M2_REMOTE_CORE_ERROR_CODE.CAPABILITY_VERSION_INCOMPATIBLE,
  );
});

test('invalid hello is rejected before the clock is consulted', () => {
  let clockCalls = 0;
  const port = createM5RemoteCorePortAdapter({
    clock: () => { clockCalls += 1; return CLOCK_MS; },
  });
  assert.throws(() => port.negotiate({ ...hello(), token: 'self-asserted' }), /unknown-token/);
  assert.equal(clockCalls, 0);
});

suite('M5 RemoteCorePort in-process invocation');

await testAsync('conversation invocation validates the exact request and result identities', async () => {
  let receivedContext = null;
  const port = adapter({
    executeConversation: async (request, context) => {
      receivedContext = context;
      return conversationResult(request);
    },
  });
  const request = command();
  const context = Object.freeze({ authenticatedSubject: Object.freeze({ actorId: 'operator-1' }) });
  const result = await port.invoke(invocation(
    port,
    'conversations',
    M5_REMOTE_CORE_OPERATION.CONVERSATION_EXECUTE,
    request,
  ), context);
  assert.equal(result.response.content, '391');
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.response), true);
  assert.equal(receivedContext, context);
});

await testAsync('project invocation uses ProjectContextQuery/Snapshot v1 without a route or DB bridge', async () => {
  const port = adapter();
  const request = projectQuery();
  const result = await port.invoke(invocation(
    port,
    'projects',
    M5_REMOTE_CORE_OPERATION.PROJECT_CONTEXT_QUERY,
    request,
  ));
  assert.equal(result.status, 'error');
  assert.equal(result.error.code, 'PROJECT_CONTEXT_NOT_READY');
});

await testAsync('project result is bound to exact revision, normalized query and request budgets', async () => {
  const request = projectQuery();
  const accepted = adapter({
    queryProjectContext: async value => successfulProjectResult(value),
  });
  const result = await accepted.invoke(invocation(
    accepted,
    'projects',
    M5_REMOTE_CORE_OPERATION.PROJECT_CONTEXT_QUERY,
    request,
  ));
  assert.equal(result.workspaceRevision, request.workspaceRevision);

  for (const forged of [
    successfulProjectResult(request, { workspaceRevision: `wsr1:${'b'.repeat(64)}` }),
    successfulProjectResult(request, {
      normalizedQuery: 'foreign query',
      terms: ['foreign', 'query'],
    }),
    successfulProjectResult(request, {
      budget: {
        maxFiles: request.maxFiles + 1,
        maxBytes: request.maxBytes,
        maxTokens: request.maxTokens,
        usedFiles: 0,
        usedBytes: 0,
        usedTokens: 0,
      },
    }),
  ]) {
    const rejecting = adapter({ queryProjectContext: async () => forged });
    await assert.rejects(
      rejecting.invoke(invocation(
        rejecting,
        'projects',
        M5_REMOTE_CORE_OPERATION.PROJECT_CONTEXT_QUERY,
        request,
      )),
      error => error.code === M5_REMOTE_CORE_ADAPTER_ERROR.IDENTITY_MISMATCH,
    );
  }
});

await testAsync('forged negotiation digest is rejected before the handler runs', async () => {
  let calls = 0;
  const port = adapter({
    executeConversation: async request => { calls += 1; return conversationResult(request); },
  });
  const value = invocation(
    port,
    'conversations',
    M5_REMOTE_CORE_OPERATION.CONVERSATION_EXECUTE,
    command(),
  );
  value.negotiation = clone(value.negotiation);
  value.negotiation.capabilities.find(item => item.capabilityId === 'conversations')
    .operationsDigest = `sha256:${'f'.repeat(64)}`;
  await assert.rejects(
    port.invoke(value),
    error => error.code === M5_REMOTE_CORE_ADAPTER_ERROR.CAPABILITY_NOT_NEGOTIATED,
  );
  assert.equal(calls, 0);
});

await testAsync('malformed request and foreign result identity both fail closed', async () => {
  const malformedPort = adapter();
  const badRequest = command({ token: 'not-part-of-contract' });
  await assert.rejects(
    malformedPort.invoke(invocation(
      malformedPort,
      'conversations',
      M5_REMOTE_CORE_OPERATION.CONVERSATION_EXECUTE,
      badRequest,
    )),
    error => error.code === M5_REMOTE_CORE_ADAPTER_ERROR.INVALID_REQUEST,
  );

  const foreignPort = adapter({
    executeConversation: async request => conversationResult(request, { turnId: 'turn-foreign' }),
  });
  await assert.rejects(
    foreignPort.invoke(invocation(
      foreignPort,
      'conversations',
      M5_REMOTE_CORE_OPERATION.CONVERSATION_EXECUTE,
      command(),
    )),
    error => error.code === M5_REMOTE_CORE_ADAPTER_ERROR.IDENTITY_MISMATCH,
  );
});

test('a capability with no installed core handler stays unavailable', () => {
  const port = createM5RemoteCorePortAdapter({ clock: () => CLOCK_MS });
  const request = hello(['conversations']);
  const result = port.negotiate(request);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.capabilities[0].status, 'unavailable');
});

suite('M5 RemoteCorePort physical security boundary');

test('adapter has no listener, pairing, legacy route, server, DB or network edge', () => {
  const port = adapter();
  assert.deepEqual(Object.keys(port), ['describe', 'verification', 'negotiate', 'invoke']);
  for (const forbiddenMethod of ['listen', 'connect', 'pair', 'fetch', 'approve']) {
    assert.equal(forbiddenMethod in port, false, forbiddenMethod);
  }
  const source = readFileSync(
    new URL('../src/remote/remote-core-port-adapter.js', import.meta.url),
    'utf8',
  );
  for (const token of [
    'node:http', 'node:https', 'node:net', 'node:tls', 'node:dgram',
    '/server', '/routes/', '/db/', '/ws-bridge/', 'better-sqlite3',
  ]) assert.equal(source.includes(token), false, token);
});

summary();
