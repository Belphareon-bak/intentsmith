function conversationDto(row) {
  return {
    id: String(row.id),
    title: row.title || 'Nová konverzace',
    messageCount: Number.isSafeInteger(row.message_count) ? row.message_count : 0,
    state: row.state || 'active',
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function messageDto(row) {
  return {
    id: String(row.id),
    role: row.role ?? null,
    content: row.content ?? null,
    createdAt: row.created_at ?? null,
    // Keep the persisted representation opaque here. The mobile wire adapter
    // already owns the fail-closed JSON parse used by the shipped contract.
    metadata: row.metadata ?? null,
  };
}

function validPage(input) {
  return Number.isInteger(input.limit) && input.limit >= 1 && input.limit <= 100
    && Number.isInteger(input.position) && input.position >= 0;
}

const LIST_INPUT_KEYS = new Set(['operation', 'limit', 'position', 'projectId']);
const EXISTS_INPUT_KEYS = new Set(['operation', 'id']);
const DETAIL_INPUT_KEYS = new Set([
  'operation', 'id', 'limit', 'position', 'direction', 'anchorLatest',
]);

function exactInput(input, keys, requiredSize = keys.size) {
  const names = Object.keys(input);
  return names.length >= requiredSize && !names.some(name => !keys.has(name));
}

function projectFilter(value) {
  if (value === undefined || value === null) return { ok: true, id: null };
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) {
    return { ok: false };
  }
  const id = Number(value);
  return Number.isSafeInteger(id) ? { ok: true, id } : { ok: false };
}

function listConversations(rawDb, input) {
  if (!validPage(input)) return { ok: false, error: { code: 'page_invalid' } };
  const project = projectFilter(input.projectId);
  if (!project.ok) return { ok: false, error: { code: 'project_id_invalid' } };
  const filtered = project.id !== null;
  const rows = rawDb.prepare(`
    SELECT id, title, message_count, state, created_at, updated_at
      FROM conversations
     WHERE state != 'deleted'
       ${filtered ? 'AND project_id = ?' : ''}
     ORDER BY datetime(updated_at) DESC, id DESC
     LIMIT ? OFFSET ?
  `).all(...(filtered
    ? [project.id, input.limit + 1, input.position]
    : [input.limit + 1, input.position]));
  return { ok: true, data: { rows: rows.map(conversationDto) } };
}

function requireConversation(rawDb, id) {
  if (typeof id !== 'string' || id.length === 0) {
    return { ok: false, error: { code: 'conversation_id_invalid' } };
  }
  const row = rawDb.prepare(`
    SELECT id
      FROM conversations
     WHERE id = ? AND state != 'deleted'
  `).get(id);
  return row
    ? { ok: true, data: { exists: true } }
    : { ok: false, error: { code: 'not_found' } };
}

function conversationDetail(rawDb, input) {
  if (typeof input.id !== 'string' || input.id.length === 0) {
    return { ok: false, error: { code: 'conversation_id_invalid' } };
  }
  if (!validPage(input) || (input.direction !== 'forward' && input.direction !== 'backward')) {
    return { ok: false, error: { code: 'page_invalid' } };
  }

  const conversation = rawDb.prepare(`
    SELECT id, title, message_count, state, created_at, updated_at
      FROM conversations
     WHERE id = ? AND state != 'deleted'
  `).get(input.id);
  if (!conversation) return { ok: false, error: { code: 'not_found' } };

  const selectMessages = rawDb.prepare(`
    SELECT id, role, content, created_at, metadata
      FROM messages
     WHERE conversation_id = ?
     ORDER BY id ASC
     LIMIT ? OFFSET ?
  `);

  if (input.direction === 'backward') {
    const total = rawDb.prepare(`
      SELECT COUNT(*) AS total FROM messages WHERE conversation_id = ?
    `).get(input.id).total;
    const until = input.anchorLatest ? total : Math.min(input.position, total);
    const start = Math.max(0, until - input.limit);
    const rows = until > start ? selectMessages.all(input.id, until - start, start) : [];
    return {
      ok: true,
      data: { conversation: conversationDto(conversation), rows: rows.map(messageDto), start },
    };
  }

  const rows = selectMessages.all(input.id, input.limit + 1, input.position);
  return {
    ok: true,
    data: {
      conversation: conversationDto(conversation),
      rows: rows.map(messageDto),
      start: input.position,
    },
  };
}

/** Core-owned implementation of the read-only mobile conversation projection. */
export function createConversationsReadProvider(rawDb) {
  if (!rawDb || typeof rawDb.prepare !== 'function') {
    throw new TypeError('conversations provider requires a database handle');
  }
  return async input => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { ok: false, error: { code: 'operation_invalid' } };
    }
    if (input.operation === 'list'
        && exactInput(input, LIST_INPUT_KEYS, LIST_INPUT_KEYS.size - 1)) {
      return listConversations(rawDb, input);
    }
    if (input.operation === 'exists' && exactInput(input, EXISTS_INPUT_KEYS)) {
      return requireConversation(rawDb, input.id);
    }
    if (input.operation === 'detail' && exactInput(input, DETAIL_INPUT_KEYS)) {
      return conversationDetail(rawDb, input);
    }
    return { ok: false, error: { code: 'operation_invalid' } };
  };
}

export default createConversationsReadProvider;
