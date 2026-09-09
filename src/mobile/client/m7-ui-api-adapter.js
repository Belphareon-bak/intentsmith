import { M7_NATIVE_OPERATION_CATALOG } from './m7-native-remote-client.js';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const LEGACY_PROTOCOL_VERSION = 'm1.2026-07-30';
const OPEN_OPERATION_LIMIT = 32;

function plain(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clone(value) {
  if (value === undefined) return undefined;
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export class M7UiApiAdapterError extends Error {
  constructor(code, { status = 500, detail = {}, body = null } = {}) {
    super(code);
    this.name = 'M7UiApiAdapterError';
    this.code = code;
    this.status = status;
    this.detail = detail;
    this.body = body;
  }
}

function fail(code, options) {
  throw new M7UiApiAdapterError(code, options);
}

function pageLimit(value, fallback = 50) {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
    fail('protocol_invalid_request', { status: 400 });
  }
  return parsed;
}

function requestId(cryptoApi) {
  return `request:mobile:${cryptoApi.randomUUID()}`;
}

function legacy(data, extra = {}) {
  return Object.freeze({ ok: true, protocolVersion: LEGACY_PROTOCOL_VERSION, data, ...extra });
}

function operationError(result, status = 400) {
  if (result?.status === 'error' && plain(result.error)) {
    fail(result.error.code, { status, detail: clone(result.error), body: clone(result) });
  }
  if (plain(result?.error)) {
    fail(result.error.code, {
      status: result.outcome === 'UNKNOWN' ? 503 : status,
      detail: { ...clone(result.error), state: result.outcome },
      body: clone(result),
    });
  }
  return result;
}

function responsePayload(envelope) {
  if (envelope?.status === 'error') {
    const code = envelope.error?.code || 'REMOTE_OPERATION_FAILED';
    fail(code, {
      status: code === 'REMOTE_SESSION_IN_FLIGHT_LIMIT' ? 429 : 503,
      detail: clone(envelope.error || {}),
      body: clone(envelope),
    });
  }
  if (envelope?.status !== 'ok' || !plain(envelope.payload)) {
    fail('protocol_invalid_response', { status: 502, body: clone(envelope) });
  }
  return envelope.payload;
}

function mapConversation(item) {
  return {
    id: item.conversationId,
    projectId: item.projectId,
    title: item.title,
    state: item.state,
    messageCount: item.messageCount,
    updatedAt: item.updatedAt,
    revision: item.revision,
  };
}

function mapMessage(item) {
  return {
    id: item.messageId,
    turnId: item.turnId,
    role: item.role,
    content: item.content,
    status: item.status,
    createdAt: item.createdAt,
    revision: item.revision,
  };
}

function mapApproval(item) {
  return {
    id: item.approvalId,
    title: item.summary,
    subjectType: item.effectKind,
    subjectId: item.runId,
    detail: item.details.join('\n'),
    payloadFingerprint: item.payloadFingerprint,
    approvalViewDigest: item.approvalViewDigest,
    revision: item.revision,
    createdAt: item.createdAt,
    expiresAt: item.expiresAt,
    expired: item.state === 'expired',
  };
}

function mapNotification(item) {
  return {
    id: item.notificationId,
    sequence: item.sequence,
    kind: item.kind,
    priority: item.priority,
    title: item.title,
    target: clone(item.target),
    projectId: item.projectId,
    createdAt: item.createdAt,
    read: item.readAt !== null,
    readAt: item.readAt,
    revision: item.revision,
  };
}

function mapOperation(item) {
  return {
    operationId: item.operationId,
    operationType: item.operationKind,
    state: item.state.toUpperCase(),
    unknownReason: null,
    unknownAt: item.state === 'unknown' ? item.updatedAt : null,
    createdAt: item.createdAt,
    lastCheckedAt: item.updatedAt,
    revision: item.revision,
    canAbandon: item.canAbandon,
    resultReference: item.resultReference,
  };
}

function parsePath(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    fail('protocol_invalid_request', { status: 400 });
  }
  const value = new URL(path, 'https://mobile-adapter.invalid');
  if (value.origin !== 'https://mobile-adapter.invalid' || value.hash) {
    fail('protocol_invalid_request', { status: 400 });
  }
  return value;
}

function requiredBody(value, keys) {
  if (!plain(value) || keys.some(key => !Object.hasOwn(value, key))) {
    fail('protocol_invalid_request', { status: 400 });
  }
  return value;
}

export function createM7UiApiAdapter({ client, cryptoApi = globalThis.crypto } = {}) {
  if (!client || typeof client.invoke !== 'function' || typeof client.health !== 'function'
    || typeof client.snapshot !== 'function' || typeof cryptoApi?.randomUUID !== 'function') {
    fail('remote_adapter_configuration_invalid');
  }

  async function invoke(operationId, request) {
    if (!Object.hasOwn(M7_NATIVE_OPERATION_CATALOG, operationId)) {
      fail('protocol_invalid_request', { status: 400 });
    }
    return responsePayload(await client.invoke(operationId, request));
  }

  async function request(path, { method = 'GET', body = null } = {}) {
    const url = parsePath(path);
    const pathname = url.pathname;
    const id = requestId(cryptoApi);

    if (method === 'GET' && pathname === '/health' && !url.search) {
      const health = await client.health();
      operationError(health, 503);
      const unavailable = health.components.filter(item => item.status !== 'ok');
      return legacy({
        status: unavailable.length ? 'degraded' : 'ok',
        upstream: unavailable.length ? 'unavailable' : 'ok',
        upstreamDetail: unavailable.map(item => `${item.componentId}:${item.code}`).join(', ') || null,
        protocolVersion: 'remote-core-v1',
        time: health.observedAt,
        coreVersion: health.coreVersion,
      });
    }

    if (method === 'GET' && pathname === '/capabilities' && !url.search) {
      const snapshot = client.snapshot();
      if (!snapshot) fail('M7_SESSION_INVALID', { status: 401 });
      return legacy({
        device: { id: snapshot.deviceId, name: 'Android companion' },
        scopes: [...snapshot.scopes],
        operations: Object.keys(M7_NATIVE_OPERATION_CATALOG).sort(),
      });
    }

    if (method === 'GET' && pathname === '/conversations') {
      const cursor = url.searchParams.get('cursor');
      const request = {
        contract: 'ConversationListQuery', version: 1, requestId: id,
        limit: pageLimit(url.searchParams.get('limit')),
        ...(cursor === null ? {} : { cursor }),
      };
      const result = operationError(await invoke('conversation.list', request));
      return legacy(result.items.map(mapConversation), {
        end: result.end, hasMore: !result.end, nextCursor: result.nextCursor,
      });
    }

    const conversation = pathname.match(/^\/conversations\/([^/]+)$/);
    if (method === 'GET' && conversation) {
      const conversationId = decodeURIComponent(conversation[1]);
      if (!IDENTIFIER.test(conversationId)) fail('protocol_invalid_request', { status: 400 });
      const cursor = url.searchParams.get('cursor');
      const anchor = url.searchParams.get('anchor');
      if ((cursor === null) === (anchor === null) || (anchor !== null && anchor !== 'latest')) {
        fail('protocol_invalid_request', { status: 400 });
      }
      const request = {
        contract: 'ConversationHistoryQuery', version: 1, requestId: id,
        conversationId, limit: pageLimit(url.searchParams.get('limit')),
        ...(cursor === null ? { anchor: 'latest' } : { cursor }),
      };
      const result = operationError(await invoke('conversation.history', request), 404);
      return legacy({
        conversation: { id: conversationId, title: 'Konverzace' },
        messages: result.messages.map(mapMessage),
      }, { end: result.end, hasMore: !result.end, nextCursor: result.nextCursor });
    }

    if (method === 'GET' && pathname === '/notifications') {
      const after = url.searchParams.get('afterSeq');
      const request = {
        contract: 'NotificationListQuery', version: 1, requestId: id,
        limit: pageLimit(url.searchParams.get('limit')),
        ...(after === null ? {} : { afterSeq: Number(after) }),
      };
      const result = operationError(await invoke('notification.list', request));
      return legacy(result.items.map(mapNotification), {
        hasMore: !result.caughtUp,
        nextAfterSeq: result.nextAfterSeq,
      });
    }

    if (method === 'POST' && pathname === '/notifications/ack') {
      const input = requiredBody(body, ['ids', 'observedThroughSeq', 'operationId']);
      const result = operationError(await invoke('notification.ack', {
        contract: 'NotificationAckCommand', version: 1, requestId: id,
        operationId: input.operationId,
        notificationIds: [...input.ids].sort(),
        observedThroughSeq: input.observedThroughSeq,
      }));
      return legacy({ state: result.outcome, acknowledgedIds: result.acknowledgedIds });
    }

    if (method === 'GET' && pathname === '/approvals' && !url.search) {
      const result = operationError(await invoke('approval.list', {
        contract: 'ApprovalListQuery', version: 1, requestId: id,
        limit: 100, states: ['pending'],
      }));
      return legacy(result.items.map(mapApproval));
    }

    const approval = pathname.match(/^\/approvals\/([^/]+)\/decide$/);
    if (method === 'POST' && approval) {
      const approvalId = decodeURIComponent(approval[1]);
      const input = requiredBody(body, [
        'decision', 'operationId', 'payloadFingerprint', 'approvalViewDigest', 'revision',
      ]);
      if (!IDENTIFIER.test(approvalId) || !DIGEST.test(input.payloadFingerprint || '')
        || !DIGEST.test(input.approvalViewDigest || '')) {
        fail('protocol_invalid_request', { status: 400 });
      }
      const result = operationError(await invoke('approval.decide', {
        contract: 'ApprovalDecisionCommand', version: 1, requestId: id,
        operationId: input.operationId, approvalId, decision: input.decision,
        expectedPayloadFingerprint: input.payloadFingerprint,
        expectedViewDigest: input.approvalViewDigest,
        expectedRevision: input.revision,
      }));
      const data = result.replayed
        ? {
            approvalId, state: result.outcome,
            result: result.outcome === 'CONFIRMED' ? { approvalId, decision: result.decision } : null,
          }
        : { approvalId, state: result.outcome, decision: result.decision };
      return result.replayed ? legacy(data, { replayed: true }) : legacy(data);
    }

    if (method === 'POST' && pathname === '/chat') {
      const input = requiredBody(body, ['conversationId', 'message', 'operationId']);
      const result = await invoke('conversation.execute', {
        contract: 'ConversationCommand', version: 1,
        requestId: input.operationId,
        conversationId: input.conversationId,
        turnId: input.operationId,
        action: 'send', input: input.message,
      });
      if (result.status !== 'ok') {
        fail(result.error?.code || 'REMOTE_CONVERSATION_FAILED', {
          status: 503, detail: clone(result.error || {}), body: clone(result),
        });
      }
      return legacy({ state: 'CONFIRMED', result: clone(result) });
    }

    if (method === 'GET' && pathname === '/operations' && !url.search) {
      const result = operationError(await invoke('operation.list', {
        contract: 'OperationListQuery', version: 1, requestId: id,
        limit: 100, states: ['pending', 'unknown'],
      }));
      const rows = result.items.map(mapOperation);
      return legacy(rows, {
        open: rows.length, limit: OPEN_OPERATION_LIMIT,
        atLimit: rows.length >= OPEN_OPERATION_LIMIT,
      });
    }

    const abandon = pathname.match(/^\/operations\/([^/]+)\/abandon$/);
    if (method === 'POST' && abandon) {
      const targetOperationId = decodeURIComponent(abandon[1]);
      const input = requiredBody(body, ['operationId', 'expectedRevision']);
      const result = operationError(await invoke('operation.abandon', {
        contract: 'OperationAbandonCommand', version: 1, requestId: id,
        operationId: input.operationId,
        targetOperationId,
        expectedRevision: input.expectedRevision,
      }), 409);
      let open = null;
      try {
        const page = operationError(await invoke('operation.list', {
          contract: 'OperationListQuery', version: 1, requestId: requestId(cryptoApi),
          limit: 100, states: ['pending', 'unknown'],
        }));
        open = page.items.length;
      } catch { /* the confirmed abandonment remains authoritative */ }
      return legacy({
        state: result.outcome, open, limit: OPEN_OPERATION_LIMIT,
      });
    }

    const lookup = pathname.match(/^\/operations\/([^/]+)$/);
    if (method === 'GET' && lookup) {
      const operationId = decodeURIComponent(lookup[1]);
      const result = await invoke('operation.get', {
        contract: 'OperationLookupQuery', version: 1, requestId: id, operationId,
      });
      if (result.status === 'error' && result.error?.code === 'REMOTE_OPERATION_NOT_FOUND') {
        const bodyValue = legacy({ operationId, known: false, state: null });
        fail('not_found', { status: 404, detail: clone(result.error), body: bodyValue });
      }
      operationError(result);
      return legacy({ known: true, ...mapOperation(result.operation) });
    }

    fail('not_found', { status: 404 });
  }

  return Object.freeze({ request });
}
