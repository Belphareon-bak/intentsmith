const PROJECT_STATES = new Set(['active', 'archived']);

function isoTimestamp(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const source = /[TZ]|[+-]\d\d:?\d\d$/.test(value)
    ? value
    : `${value.replace(' ', 'T')}Z`;
  const parsed = Date.parse(source);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function projectDto(row) {
  return {
    id: String(row.id),
    name: row.name,
    state: PROJECT_STATES.has(row.status) ? row.status : 'active',
    createdAt: isoTimestamp(row.created_at),
    // The core has last_active rather than an updated_at column. On this wire
    // surface updatedAt therefore means last activity, not row modification.
    updatedAt: isoTimestamp(row.last_active),
    conversationCount: Number.isSafeInteger(row.conversation_count)
      ? row.conversation_count
      : null,
  };
}

function validProjectId(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function listProjects(rawDb, input) {
  const state = input.state ?? 'active';
  const limit = input.limit;
  const offset = input.offset ?? 0;
  if (!PROJECT_STATES.has(state)) {
    return { ok: false, error: { code: 'state_invalid', details: { allowed: [...PROJECT_STATES] } } };
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return { ok: false, error: { code: 'limit_invalid' } };
  }
  if (!Number.isInteger(offset) || offset < 0) {
    return { ok: false, error: { code: 'cursor_invalid' } };
  }

  const rows = rawDb.prepare(`
    SELECT p.id, p.name, p.status, p.created_at, p.last_active,
           (SELECT COUNT(*)
              FROM conversations c
             WHERE c.project_id = p.id AND c.state != 'deleted') AS conversation_count
      FROM projects p
     WHERE p.status = ?
     ORDER BY datetime(p.last_active) DESC, p.id DESC
     LIMIT ? OFFSET ?
  `).all(state, limit + 1, offset);

  return { ok: true, data: { rows: rows.map(projectDto) } };
}

function projectDetail(rawDb, input) {
  const id = validProjectId(input.id);
  if (id === null) return { ok: false, error: { code: 'project_id_invalid' } };

  const row = rawDb.prepare(`
    SELECT p.id, p.name, p.status, p.created_at, p.last_active,
           (SELECT COUNT(*)
              FROM conversations c
             WHERE c.project_id = p.id AND c.state != 'deleted') AS conversation_count
      FROM projects p
     WHERE p.id = ? AND p.status != 'deleted'
  `).get(id);
  if (!row) return { ok: false, error: { code: 'not_found' } };
  return { ok: true, data: { project: projectDto(row) } };
}

/** Core-owned implementation of the read-only mobile project projection. */
export function createProjectsReadProvider(rawDb) {
  if (!rawDb || typeof rawDb.prepare !== 'function') {
    throw new TypeError('projects provider requires a database handle');
  }
  return async input => {
    if (input.operation === 'list') return listProjects(rawDb, input);
    if (input.operation === 'detail') return projectDetail(rawDb, input);
    return { ok: false, error: { code: 'operation_invalid' } };
  };
}

export default createProjectsReadProvider;
