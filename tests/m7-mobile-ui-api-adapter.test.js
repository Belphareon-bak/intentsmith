#!/usr/bin/env node

import assert from 'node:assert/strict';

import {
  M7UiApiAdapterError,
  createM7UiApiAdapter,
} from '../src/mobile/client/m7-ui-api-adapter.js';
import { suite, summary, testAsync } from './harness.js';

function envelope(payload) {
  return {
    contract: 'RemoteResponseEnvelope', version: 1, status: 'ok',
    payload, error: null,
  };
}

function clientFixture() {
  const calls = [];
  const operations = new Map();
  return {
    calls,
    operations,
    snapshot() {
      return {
        deviceId: 'device:test', subjectId: 'subject:test',
        sessionId: 'session:test', sessionRevision: 'session-revision:test',
        expiresAt: '2026-09-08T21:00:00.000Z', scopes: ['read:chat'],
      };
    },
    async health() {
      return {
        contract: 'RemoteHealthSnapshot', version: 1, requestId: 'request:health',
        status: 'ok', coreVersion: '136.1', observedAt: '2026-09-08T20:00:00.000Z',
        components: [{ componentId: 'database', status: 'ok', code: 'READY' }],
      };
    },
    async invoke(operationId, request) {
      calls.push({ operationId, request: structuredClone(request) });
      const handler = operations.get(operationId);
      if (!handler) throw new Error(`unhandled ${operationId}`);
      return envelope(await handler(request));
    },
  };
}

function makeAdapter(client) {
  let sequence = 0;
  return createM7UiApiAdapter({
    client,
    cryptoApi: { randomUUID: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}` },
  });
}

suite('M7 mobile UI API adapter');

await testAsync('list/history/health responses map into the existing UI without weakening contracts', async () => {
  const client = clientFixture();
  client.operations.set('conversation.list', request => ({
    contract: 'ConversationPage', version: 1, requestId: request.requestId,
    status: 'ok', items: [{
      conversationId: 'conversation:1', projectId: null, title: 'Test', state: 'active',
      messageCount: 2, updatedAt: '2026-09-08T20:00:00.000Z', revision: 'rev:1',
    }], end: true, nextCursor: null, snapshotRevision: 'rev:list',
  }));
  client.operations.set('conversation.history', request => ({
    contract: 'ConversationHistoryPage', version: 1, requestId: request.requestId,
    conversationId: request.conversationId, status: 'ok', messages: [{
      messageId: 'message:1', turnId: 'turn:1', role: 'assistant', content: 'Hotovo.',
      status: 'ok', createdAt: '2026-09-08T20:00:00.000Z', revision: 'rev:message:1',
    }], end: true, nextCursor: null, snapshotRevision: 'rev:history',
  }));
  const adapter = makeAdapter(client);
  const list = await adapter.request('/conversations?limit=50');
  assert.equal(list.protocolVersion, 'm1.2026-07-30');
  assert.equal(list.data[0].id, 'conversation:1');
  const history = await adapter.request('/conversations/conversation%3A1?anchor=latest&limit=50');
  assert.equal(history.data.messages[0].id, 'message:1');
  assert.equal(history.data.conversation.id, 'conversation:1');
  const health = await adapter.request('/health');
  assert.equal(health.data.time, '2026-09-08T20:00:00.000Z');
  assert.equal(health.data.upstream, 'ok');
});

await testAsync('approval decisions preserve fingerprint, view digest, revision and operation identity', async () => {
  const client = clientFixture();
  client.operations.set('approval.decide', request => ({
    contract: 'ApprovalDecisionResult', version: 1, requestId: request.requestId,
    operationId: request.operationId, approvalId: request.approvalId,
    decision: request.decision, approvalState: 'approved',
    payloadFingerprint: request.expectedPayloadFingerprint, revision: 'approval:rev:2',
    outcome: 'CONFIRMED', replayed: false,
  }));
  const adapter = makeAdapter(client);
  const response = await adapter.request('/approvals/approval%3A1/decide', {
    method: 'POST',
    body: {
      decision: 'approve', operationId: 'operation:1',
      payloadFingerprint: `sha256:${'a'.repeat(64)}`,
      approvalViewDigest: `sha256:${'b'.repeat(64)}`,
      revision: 'approval:rev:1',
    },
  });
  assert.deepEqual(response.data, {
    approvalId: 'approval:1', state: 'CONFIRMED', decision: 'approve',
  });
  const request = client.calls[0].request;
  assert.equal(request.expectedViewDigest, `sha256:${'b'.repeat(64)}`);
  assert.equal(request.expectedRevision, 'approval:rev:1');
});

await testAsync('operation recovery maps not-found and binds abandon to reviewed revision', async () => {
  const client = clientFixture();
  client.operations.set('operation.get', request => ({
    contract: 'OperationLookupResult', version: 1, requestId: request.requestId,
    status: 'error', error: {
      code: 'REMOTE_OPERATION_NOT_FOUND', message: 'not found', retryable: false,
    },
  }));
  client.operations.set('operation.abandon', request => ({
    contract: 'OperationAbandonResult', version: 1, requestId: request.requestId,
    operationId: request.operationId, targetOperationId: request.targetOperationId,
    revision: 'rev:2', outcome: 'CONFIRMED', replayed: false,
  }));
  client.operations.set('operation.list', request => ({
    contract: 'OperationPage', version: 1, requestId: request.requestId,
    status: 'ok', items: [], end: true, nextCursor: null, snapshotRevision: 'ops:1:2',
  }));
  const adapter = makeAdapter(client);
  await assert.rejects(
    adapter.request('/operations/operation%3Amissing'),
    error => error instanceof M7UiApiAdapterError
      && error.status === 404
      && error.body.data.known === false,
  );
  const abandoned = await adapter.request('/operations/operation%3Aold/abandon', {
    method: 'POST', body: { operationId: 'operation:abandon', expectedRevision: 'rev:1' },
  });
  assert.equal(abandoned.data.open, 0);
  const request = client.calls.find(call => call.operationId === 'operation.abandon').request;
  assert.equal(request.targetOperationId, 'operation:old');
  assert.equal(request.expectedRevision, 'rev:1');
});

await testAsync('unknown paths and incomplete mutations fail before native invocation', async () => {
  const client = clientFixture();
  const adapter = makeAdapter(client);
  await assert.rejects(adapter.request('/legacy/admin'), { code: 'not_found' });
  await assert.rejects(adapter.request('/notifications/ack', {
    method: 'POST', body: { ids: ['notification:1'] },
  }), { code: 'protocol_invalid_request' });
  assert.equal(client.calls.length, 0);
});

summary();
