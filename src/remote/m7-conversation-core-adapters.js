import { createHash } from 'node:crypto';

import { validateConversationResult } from '../../contracts/m1/index.js';
import { canonicalizeM2ExecutionValue } from '../../contracts/m2/execution-v1.js';
import {
  M7_CORE_CURSOR_ERROR,
  M7CoreCursorError,
  computeM7CoreCursorFilterDigest,
  createM7CoreCursorCodec,
} from './m7-core-cursor.js';

export const M7_CONVERSATION_CORE_ERROR = Object.freeze({
  ACCESS_DENIED: 'M7_CONVERSATION_ACCESS_DENIED',
  CURSOR_INVALID: 'M7_CONVERSATION_CURSOR_INVALID',
  CURSOR_STALE: 'M7_CONVERSATION_CURSOR_STALE',
  EXECUTION_FAILED: 'M7_CONVERSATION_EXECUTION_FAILED',
  INPUT_INVALID: 'M7_CONVERSATION_INPUT_INVALID',
  READ_FAILED: 'M7_CONVERSATION_READ_FAILED',
  SCAN_LIMIT: 'M7_CONVERSATION_SCAN_LIMIT',
});

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MESSAGE_STATUS = new Set(['ok', 'cancelled', 'timeout', 'error']);
const MESSAGE_ROLE = new Set(['user', 'assistant', 'system']);
const MAX_DEFAULT_CONVERSATION_SCAN = 2_000;
const MAX_DEFAULT_MESSAGE_SCAN = 10_000;
const MAX_MESSAGE_BYTES = 16_384;
const MAX_METADATA_BYTES = 65_536;

class M7ConversationCoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'M7ConversationCoreError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new M7ConversationCoreError(code, message);
}

function plain(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function digestRevision(prefix, value) {
  return `rev:${prefix}:${createHash('sha256')
    .update(canonicalizeM2ExecutionValue(value), 'utf8')
    .digest('hex')}`;
}

function rawDigest(value) {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function requireDatabase(value) {
  const db = value?.db ?? value;
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw new TypeError('m7-conversation-core:sqlite-database-required');
  }
  return db;
}

function requireFunction(value, label) {
  if (typeof value !== 'function') {
    throw new TypeError(`m7-conversation-core:${label}-required`);
  }
  return value;
}

function requireLimit(value, label, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`m7-conversation-core:${label}-invalid`);
  }
  return value;
}

function requireIdentityContext(value) {
  if (!plain(value)
    || !IDENTIFIER.test(value.deviceId || '')
    || !IDENTIFIER.test(value.subjectId || '')) {
    fail(M7_CONVERSATION_CORE_ERROR.INPUT_INVALID, 'm7-conversation-core:trusted-context-invalid');
  }
  return value;
}

function canonicalTimestamp(value) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(M7_CONVERSATION_CORE_ERROR.READ_FAILED, 'm7-conversation-core:timestamp-invalid');
  }
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/u.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const milliseconds = Date.parse(normalized);
  if (!Number.isFinite(milliseconds)) {
    fail(M7_CONVERSATION_CORE_ERROR.READ_FAILED, 'm7-conversation-core:timestamp-invalid');
  }
  return new Date(milliseconds).toISOString();
}

function safeText(value, label, maximumBytes, { allowEmpty = false } = {}) {
  if (typeof value !== 'string'
    || (!allowEmpty && value.length === 0)
    || Buffer.byteLength(value, 'utf8') > maximumBytes
    || value.normalize('NFC') !== value
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    fail(M7_CONVERSATION_CORE_ERROR.READ_FAILED, `m7-conversation-core:${label}-invalid`);
  }
  return value;
}

function conversationState(value) {
  if (!['active', 'archived'].includes(value)) {
    fail(M7_CONVERSATION_CORE_ERROR.READ_FAILED, 'm7-conversation-core:state-invalid');
  }
  return value;
}

function conversationProjectId(value) {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(M7_CONVERSATION_CORE_ERROR.READ_FAILED, 'm7-conversation-core:project-id-invalid');
  }
  return value;
}

function conversationTitle(value) {
  if (value === null || value === '') return 'Untitled conversation';
  return safeText(value, 'title', 512);
}

function listError(requestId, code, message, retryable = false) {
  return deepFreeze({
    contract: 'ConversationPage',
    version: 1,
    requestId,
    status: 'error',
    error: { code, message, retryable },
  });
}

function historyError(request, code, message, retryable = false) {
  return deepFreeze({
    contract: 'ConversationHistoryPage',
    version: 1,
    requestId: request.requestId,
    conversationId: request.conversationId,
    status: 'error',
    error: { code, message, retryable },
  });
}

function commandError(request, code, message) {
  const result = {
    contract: 'ConversationResult',
    version: 1,
    requestId: request.requestId,
    conversationId: request.conversationId,
    turnId: request.turnId,
    status: 'error',
    error: { code, message },
  };
  const validation = validateConversationResult(result);
  if (!validation.valid) {
    throw new TypeError(`m7-conversation-core:error-result-invalid:${validation.errors.join(',')}`);
  }
  return deepFreeze(result);
}

function mapListFailure(request, error) {
  if (error instanceof M7CoreCursorError) {
    return listError(
      request.requestId,
      error.code === M7_CORE_CURSOR_ERROR.STALE
        ? 'REMOTE_CONVERSATION_CURSOR_STALE'
        : 'REMOTE_CONVERSATION_CURSOR_INVALID',
      'The conversation cursor is invalid or no longer describes the current snapshot.',
    );
  }
  if (error instanceof M7ConversationCoreError
    && error.code === M7_CONVERSATION_CORE_ERROR.SCAN_LIMIT) {
    return listError(
      request.requestId,
      'REMOTE_CONVERSATION_SCAN_LIMIT',
      'The authorized conversation catalog exceeds the bounded remote projection.',
    );
  }
  return listError(
    request.requestId,
    'REMOTE_CONVERSATION_READ_FAILED',
    'The conversation catalog could not be read safely.',
    true,
  );
}

function mapHistoryFailure(request, error) {
  if (error instanceof M7CoreCursorError) {
    return historyError(
      request,
      error.code === M7_CORE_CURSOR_ERROR.STALE
        ? 'REMOTE_CONVERSATION_CURSOR_STALE'
        : 'REMOTE_CONVERSATION_CURSOR_INVALID',
      'The conversation cursor is invalid or no longer describes the current snapshot.',
    );
  }
  if (error instanceof M7ConversationCoreError
    && error.code === M7_CONVERSATION_CORE_ERROR.SCAN_LIMIT) {
    return historyError(
      request,
      'REMOTE_CONVERSATION_SCAN_LIMIT',
      'The conversation history exceeds the bounded remote projection.',
    );
  }
  if (error instanceof M7ConversationCoreError
    && error.code === M7_CONVERSATION_CORE_ERROR.ACCESS_DENIED) {
    return historyError(
      request,
      'REMOTE_CONVERSATION_NOT_AVAILABLE',
      'The requested conversation is not available.',
    );
  }
  return historyError(
    request,
    'REMOTE_CONVERSATION_READ_FAILED',
    'The conversation history could not be read safely.',
    true,
  );
}

function mapConversationRow(row) {
  if (!IDENTIFIER.test(row.id || '')
    || !Number.isSafeInteger(row.messageCount)
    || row.messageCount < 0
    || row.messageCount !== row.observedMessageCount) {
    fail(M7_CONVERSATION_CORE_ERROR.READ_FAILED, 'm7-conversation-core:row-invalid');
  }
  const item = {
    conversationId: row.id,
    projectId: conversationProjectId(row.projectId),
    title: conversationTitle(row.title),
    state: conversationState(row.state),
    messageCount: row.messageCount,
    updatedAt: canonicalTimestamp(row.updatedAt),
    revision: null,
  };
  item.revision = digestRevision('conversation', {
    conversationId: item.conversationId,
    projectId: item.projectId,
    title: item.title,
    state: item.state,
    messageCount: item.messageCount,
    updatedAt: item.updatedAt,
  });
  return deepFreeze(item);
}

function parseMetadata(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > MAX_METADATA_BYTES) {
    fail(M7_CONVERSATION_CORE_ERROR.READ_FAILED, 'm7-conversation-core:metadata-invalid');
  }
  let metadata;
  try {
    metadata = JSON.parse(raw);
  } catch {
    fail(M7_CONVERSATION_CORE_ERROR.READ_FAILED, 'm7-conversation-core:metadata-invalid');
  }
  if (!plain(metadata)) {
    fail(M7_CONVERSATION_CORE_ERROR.READ_FAILED, 'm7-conversation-core:metadata-invalid');
  }
  return metadata;
}

function messageIdentity(row, metadata) {
  const candidate = metadata.m7?.turnId;
  if (candidate !== undefined && !IDENTIFIER.test(candidate || '')) {
    fail(M7_CONVERSATION_CORE_ERROR.READ_FAILED, 'm7-conversation-core:turn-id-invalid');
  }
  return candidate ?? `turn:message:${row.id}`;
}

function messageStatus(metadata) {
  const candidate = metadata.m7?.status;
  if (candidate !== undefined && !MESSAGE_STATUS.has(candidate)) {
    fail(M7_CONVERSATION_CORE_ERROR.READ_FAILED, 'm7-conversation-core:message-status-invalid');
  }
  if (candidate !== undefined) return candidate;
  return metadata.error === true ? 'error' : 'ok';
}

function mapMessageRow(row) {
  if (!Number.isSafeInteger(row.id) || row.id < 1 || !MESSAGE_ROLE.has(row.role)) {
    fail(M7_CONVERSATION_CORE_ERROR.READ_FAILED, 'm7-conversation-core:message-row-invalid');
  }
  const metadata = parseMetadata(row.metadata);
  const item = {
    messageId: `message:${row.id}`,
    turnId: messageIdentity(row, metadata),
    role: row.role,
    content: safeText(row.content, 'message-content', MAX_MESSAGE_BYTES),
    status: messageStatus(metadata),
    createdAt: canonicalTimestamp(row.createdAt),
    revision: null,
  };
  item.revision = digestRevision('conversation-message', {
    messageId: item.messageId,
    turnId: item.turnId,
    role: item.role,
    content: item.content,
    status: item.status,
    createdAt: item.createdAt,
    metadataDigest: rawDigest(row.metadata),
  });
  return deepFreeze(item);
}

function sameRaw(left, right) {
  return canonicalizeM2ExecutionValue(left) === canonicalizeM2ExecutionValue(right);
}

export function createM7ConversationCoreAdapters({
  authorizeConversation,
  cursorKey,
  database,
  executeConversation,
  maxConversationScan = MAX_DEFAULT_CONVERSATION_SCAN,
  maxMessageScan = MAX_DEFAULT_MESSAGE_SCAN,
} = {}) {
  const db = requireDatabase(database);
  const authorize = requireFunction(authorizeConversation, 'authorize-conversation');
  const execute = requireFunction(executeConversation, 'execute-conversation');
  const conversationScan = requireLimit(
    maxConversationScan,
    'max-conversation-scan',
    100_000,
  );
  const messageScan = requireLimit(maxMessageScan, 'max-message-scan', 100_000);
  const cursorCodec = createM7CoreCursorCodec({ key: cursorKey });

  const listRows = db.prepare(`
    SELECT
      conversation.id,
      conversation.project_id AS projectId,
      conversation.title,
      conversation.message_count AS messageCount,
      conversation.state,
      conversation.updated_at AS updatedAt,
      (
        SELECT count(*) FROM messages message
        WHERE message.conversation_id = conversation.id
      ) AS observedMessageCount
    FROM conversations conversation
    WHERE conversation.deleted_at IS NULL
      AND conversation.state IN ('active', 'archived')
    ORDER BY conversation.updated_at DESC, conversation.id ASC
    LIMIT ?
  `);
  const findConversation = db.prepare(`
    SELECT id, project_id AS projectId, title, message_count AS messageCount,
      state, updated_at AS updatedAt, deleted_at AS deletedAt
    FROM conversations WHERE id = ?
  `);
  const readMessages = db.prepare(`
    SELECT id, role, content, metadata, created_at AS createdAt
    FROM messages WHERE conversation_id = ?
    ORDER BY created_at ASC, id ASC
    LIMIT ?
  `);
  const readHistorySnapshot = db.transaction((conversationId) => {
    const conversation = findConversation.get(conversationId) ?? null;
    if (!conversation
      || conversation.deletedAt !== null
      || !['active', 'archived'].includes(conversation.state)) {
      return { conversation: null, messages: [] };
    }
    const messages = readMessages.all(conversationId, messageScan + 1);
    return { conversation, messages };
  });

  async function accessAllowed(context, row, operationId, action = null) {
    const decision = await authorize(deepFreeze({
      deviceId: context.deviceId,
      subjectId: context.subjectId,
      conversationId: row?.id ?? null,
      projectId: row?.projectId ?? null,
      state: row?.state ?? null,
      exists: row !== null,
      operationId,
      action,
    }));
    if (decision !== true && decision !== false) {
      fail(M7_CONVERSATION_CORE_ERROR.READ_FAILED, 'm7-conversation-core:access-decision-invalid');
    }
    return decision;
  }

  async function buildConversationSnapshot(context) {
    const rows = listRows.all(conversationScan + 1);
    if (rows.length > conversationScan) {
      fail(M7_CONVERSATION_CORE_ERROR.SCAN_LIMIT, 'm7-conversation-core:conversation-scan-limit');
    }
    const items = [];
    for (const row of rows) {
      if (await accessAllowed(context, row, 'conversation.list')) {
        const item = mapConversationRow(row);
        if (await accessAllowed(context, row, 'conversation.list')) items.push(item);
      }
    }
    const rowsAfter = listRows.all(conversationScan + 1);
    if (!sameRaw(rowsAfter, rows)) {
      fail(M7_CONVERSATION_CORE_ERROR.READ_FAILED, 'm7-conversation-core:catalog-unstable');
    }
    const snapshotRevision = digestRevision('conversation-snapshot', {
      deviceId: context.deviceId,
      subjectId: context.subjectId,
      items,
    });
    return deepFreeze({ items, snapshotRevision });
  }

  async function listConversations(request, trustedContext) {
    try {
      const context = requireIdentityContext(trustedContext);
      const filterDigest = computeM7CoreCursorFilterDigest({ limit: request.limit });
      const snapshot = await buildConversationSnapshot(context);
      const cursor = request.cursor === undefined ? null : cursorCodec.decode(request.cursor, {
        capabilityId: 'conversations',
        capabilityVersion: 2,
        operationId: 'conversation.list',
        deviceId: context.deviceId,
        subjectId: context.subjectId,
        filterDigest,
        snapshotRevision: snapshot.snapshotRevision,
      });
      const offset = cursor?.offset ?? 0;
      if (offset > snapshot.items.length) {
        throw new M7CoreCursorError(M7_CORE_CURSOR_ERROR.INVALID, 'm7-core-cursor:offset-invalid');
      }
      const items = snapshot.items.slice(offset, offset + request.limit);
      const nextOffset = offset + items.length;
      const end = nextOffset >= snapshot.items.length;
      return deepFreeze({
        contract: 'ConversationPage',
        version: 1,
        requestId: request.requestId,
        status: 'ok',
        items,
        end,
        nextCursor: end ? null : cursorCodec.encode({
          capabilityId: 'conversations',
          capabilityVersion: 2,
          operationId: 'conversation.list',
          deviceId: context.deviceId,
          subjectId: context.subjectId,
          filterDigest,
          snapshotRevision: snapshot.snapshotRevision,
          offset: nextOffset,
        }),
        snapshotRevision: snapshot.snapshotRevision,
      });
    } catch (error) {
      return mapListFailure(request, error);
    }
  }

  async function buildHistorySnapshot(request, context) {
    const firstRow = findConversation.get(request.conversationId) ?? null;
    if (!firstRow
      || firstRow.deletedAt !== null
      || !['active', 'archived'].includes(firstRow.state)
      || !await accessAllowed(context, firstRow, 'conversation.history')) {
      fail(M7_CONVERSATION_CORE_ERROR.ACCESS_DENIED, 'm7-conversation-core:not-available');
    }
    const raw = readHistorySnapshot(request.conversationId);
    if (raw.conversation === null || raw.messages.length > messageScan) {
      fail(
        raw.messages.length > messageScan
          ? M7_CONVERSATION_CORE_ERROR.SCAN_LIMIT
          : M7_CONVERSATION_CORE_ERROR.ACCESS_DENIED,
        'm7-conversation-core:history-unavailable',
      );
    }
    if (!sameRaw(raw.conversation, firstRow)
      || raw.conversation.messageCount !== raw.messages.length) {
      fail(M7_CONVERSATION_CORE_ERROR.READ_FAILED, 'm7-conversation-core:history-count-unstable');
    }
    const messages = raw.messages.map(mapMessageRow);
    if (!await accessAllowed(context, raw.conversation, 'conversation.history')) {
      fail(M7_CONVERSATION_CORE_ERROR.ACCESS_DENIED, 'm7-conversation-core:not-available');
    }
    const confirmation = readHistorySnapshot(request.conversationId);
    if (!sameRaw(confirmation, raw)) {
      fail(M7_CONVERSATION_CORE_ERROR.READ_FAILED, 'm7-conversation-core:history-unstable');
    }
    const snapshotRevision = digestRevision('conversation-history', {
      deviceId: context.deviceId,
      subjectId: context.subjectId,
      conversationId: request.conversationId,
      messages,
    });
    return deepFreeze({ messages, snapshotRevision });
  }

  async function readConversationHistory(request, trustedContext) {
    try {
      const context = requireIdentityContext(trustedContext);
      const filterDigest = computeM7CoreCursorFilterDigest({
        conversationId: request.conversationId,
        direction: 'newest-to-oldest-pages',
        limit: request.limit,
      });
      const snapshot = await buildHistorySnapshot(request, context);
      const cursor = request.cursor === undefined ? null : cursorCodec.decode(request.cursor, {
        capabilityId: 'conversations',
        capabilityVersion: 2,
        operationId: 'conversation.history',
        deviceId: context.deviceId,
        subjectId: context.subjectId,
        filterDigest,
        snapshotRevision: snapshot.snapshotRevision,
      });
      const offset = cursor?.offset ?? 0;
      if (offset > snapshot.messages.length) {
        throw new M7CoreCursorError(M7_CORE_CURSOR_ERROR.INVALID, 'm7-core-cursor:offset-invalid');
      }
      const endIndex = snapshot.messages.length - offset;
      const startIndex = Math.max(0, endIndex - request.limit);
      const messages = snapshot.messages.slice(startIndex, endIndex);
      const nextOffset = offset + messages.length;
      const end = nextOffset >= snapshot.messages.length;
      return deepFreeze({
        contract: 'ConversationHistoryPage',
        version: 1,
        requestId: request.requestId,
        conversationId: request.conversationId,
        status: 'ok',
        messages,
        end,
        nextCursor: end ? null : cursorCodec.encode({
          capabilityId: 'conversations',
          capabilityVersion: 2,
          operationId: 'conversation.history',
          deviceId: context.deviceId,
          subjectId: context.subjectId,
          filterDigest,
          snapshotRevision: snapshot.snapshotRevision,
          offset: nextOffset,
        }),
        snapshotRevision: snapshot.snapshotRevision,
      });
    } catch (error) {
      return mapHistoryFailure(request, error);
    }
  }

  async function executeConversationCommand(request, trustedContext) {
    const context = requireIdentityContext(trustedContext);
    const row = findConversation.get(request.conversationId) ?? null;
    if (!row
      || row.deletedAt !== null
      || row.state !== 'active'
      || !await accessAllowed(context, row, 'conversation.execute', request.action)) {
      return commandError(
        request,
        M7_CONVERSATION_CORE_ERROR.ACCESS_DENIED,
        'The requested conversation is not available.',
      );
    }
    let result;
    try {
      result = await execute(request, deepFreeze({
        deviceId: context.deviceId,
        subjectId: context.subjectId,
        grantedScopes: Array.isArray(context.grantedScopes) ? [...context.grantedScopes] : [],
      }));
    } catch {
      fail(M7_CONVERSATION_CORE_ERROR.EXECUTION_FAILED, 'm7-conversation-core:execution-failed');
    }
    const validation = validateConversationResult(result);
    if (!validation.valid
      || result.requestId !== request.requestId
      || result.conversationId !== request.conversationId
      || result.turnId !== request.turnId) {
      fail(M7_CONVERSATION_CORE_ERROR.EXECUTION_FAILED, 'm7-conversation-core:result-invalid');
    }
    const rowAfter = findConversation.get(request.conversationId) ?? null;
    if (!rowAfter
      || rowAfter.deletedAt !== null
      || rowAfter.state !== 'active'
      || !await accessAllowed(context, rowAfter, 'conversation.execute', request.action)) {
      fail(M7_CONVERSATION_CORE_ERROR.EXECUTION_FAILED, 'm7-conversation-core:authority-revoked');
    }
    return deepFreeze(structuredClone(result));
  }

  const handlers = deepFreeze({
    'conversation.execute': executeConversationCommand,
    'conversation.history': readConversationHistory,
    'conversation.list': listConversations,
  });
  return Object.freeze({
    executeConversation: executeConversationCommand,
    handlers,
    listConversations,
    readConversationHistory,
  });
}

export default createM7ConversationCoreAdapters;
