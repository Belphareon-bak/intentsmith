// Projection of the two user-facing memory stores plus the narrow create-only
// authority for explicit LTM facts.
//
// Long-term memory and task memory were built at different times and do not
// share a provenance vocabulary. This repository therefore preserves their
// actual fields instead of inventing the proposed conversation/run/manual
// origin labels. Internal agent memory is never part of this projection.

const MEMORY_KINDS = new Set(['all', 'ltm', 'task']);
const LTM_DECAY_LAMBDA = 0.01;
const TASK_DECAY_LAMBDA = 0.005;
const MS_PER_DAY = 86_400_000;

function timestampMs(value) {
  if (Number.isFinite(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const source = /[TZ]|[+-]\d\d:?\d\d$/.test(value)
    ? value
    : `${value.replace(' ', 'T')}Z`;
  const parsed = Date.parse(source);
  return Number.isNaN(parsed) ? null : parsed;
}

function isoTimestamp(value) {
  const parsed = timestampMs(value);
  return parsed === null ? null : new Date(parsed).toISOString();
}

function strength(confidence, createdAt, lambda, now) {
  const base = Number(confidence);
  const created = timestampMs(createdAt);
  if (!Number.isFinite(base) || created === null) return null;
  const ageDays = Math.max(0, (now - created) / MS_PER_DAY);
  return Math.max(0, Math.min(1, base * Math.exp(-lambda * ageDays)));
}

function parseStoredValue(row) {
  if (row.record_kind === 'task') {
    try { return JSON.parse(row.stored_value); } catch { return row.stored_value; }
  }
  try {
    return JSON.parse(row.stored_value);
  } catch {
    const error = new Error('Long-term memory contains malformed JSON');
    error.code = 'STORED_INFORMATION_VALUE_INVALID';
    throw error;
  }
}

function recordDto(row, now) {
  const isTask = row.record_kind === 'task';
  return {
    id: row.record_id,
    kind: row.record_kind,
    category: row.category,
    key: row.record_key,
    value: parseStoredValue(row),
    strength: strength(
      row.confidence,
      row.created_at,
      isTask ? TASK_DECAY_LAMBDA : LTM_DECAY_LAMBDA,
      now,
    ),
    storedConfidence: Number.isFinite(Number(row.confidence))
      ? Number(row.confidence)
      : null,
    source: row.source,
    projectId: row.project_id === null ? null : String(row.project_id),
    milestoneId: row.milestone_id === null ? null : String(row.milestone_id),
    createdAt: isoTimestamp(row.created_at),
    lastUsedAt: isoTimestamp(row.last_used_at),
    accessCount: Number.isSafeInteger(row.access_count) ? row.access_count : 0,
  };
}

export function createStoredInformationRepository(rawDb, { userId = 'default' } = {}) {
  if (!rawDb || typeof rawDb.prepare !== 'function') {
    throw new TypeError('stored information repository requires a database handle');
  }
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new TypeError('stored information repository requires a user id');
  }

  const listRows = rawDb.prepare(`
    SELECT *
      FROM (
        SELECT 'ltm:' || id AS record_id,
               'ltm' AS record_kind,
               kind AS category,
               key AS record_key,
               value AS stored_value,
               confidence,
               source,
               NULL AS project_id,
               NULL AS milestone_id,
               created_at,
               COALESCE(last_accessed_at, last_used) AS last_used_at,
               CASE WHEN COALESCE(last_accessed_at, last_used) IS NULL THEN 1 ELSE 0 END AS last_used_missing,
               COALESCE(CAST(strftime('%s', COALESCE(last_accessed_at, last_used)) AS INTEGER) * 1000, 0) AS last_used_sort,
               COALESCE(access_count, 0) AS access_count
          FROM memory
         WHERE user_id = ?
           AND kind != 'agent_internal'
           AND (
             ttl IS NULL
             OR ttl <= 0
             OR ((julianday(created_at) - 2440587.5) * 86400000 + ttl * 1000) >= ?
           )
        UNION ALL
        SELECT 'task:' || CAST(id AS TEXT) AS record_id,
               'task' AS record_kind,
               kind AS category,
               key AS record_key,
               value AS stored_value,
               confidence,
               'execution_loop' AS source,
               project_id,
               milestone_id,
               created_at,
               last_accessed_at AS last_used_at,
               CASE WHEN last_accessed_at IS NULL THEN 1 ELSE 0 END AS last_used_missing,
               COALESCE(last_accessed_at, 0) AS last_used_sort,
               COALESCE(access_count, 0) AS access_count
          FROM task_memory
      )
     WHERE (? = 'all' OR record_kind = ?)
     ORDER BY last_used_missing ASC, last_used_sort DESC, record_id DESC
     LIMIT ? OFFSET ?
  `);
  const createManual = rawDb.prepare(`
    INSERT INTO memory (
      id, user_id, kind, key, value, confidence, source, ttl,
      access_count, last_accessed_at
    ) VALUES (?, ?, ?, ?, ?, 1, 'explicit', NULL, 0, NULL)
  `);

  return Object.freeze({
    list({ kind = 'all', limit, offset = 0, now = Date.now() } = {}) {
      if (!MEMORY_KINDS.has(kind)) {
        const error = new Error('Unknown stored information kind');
        error.code = 'STORED_INFORMATION_KIND_INVALID';
        throw error;
      }
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        const error = new Error('Invalid stored information limit');
        error.code = 'STORED_INFORMATION_LIMIT_INVALID';
        throw error;
      }
      if (!Number.isInteger(offset) || offset < 0) {
        const error = new Error('Invalid stored information offset');
        error.code = 'STORED_INFORMATION_CURSOR_INVALID';
        throw error;
      }
      if (!Number.isFinite(now)) {
        const error = new Error('Invalid stored information clock');
        error.code = 'STORED_INFORMATION_CLOCK_INVALID';
        throw error;
      }
      const rows = listRows.all(userId, now, kind, kind, limit + 1, offset);
      return rows.map(row => recordDto(row, now));
    },

    // Unlike LongTermMemory.write(), this is intentionally INSERT-only. The
    // table's UNIQUE(user_id, kind, key) constraint is the atomic authority:
    // a stale/manual caller can never replace a fact that already exists.
    createManual({ category, key, value } = {}) {
      const id = `mem_${userId}_${category}_${key}`;
      try {
        createManual.run(id, userId, category, key, JSON.stringify(value));
      } catch (error) {
        if (String(error?.code || '').startsWith('SQLITE_CONSTRAINT')) {
          const conflict = new Error('Long-term memory key already exists');
          conflict.code = 'STORED_INFORMATION_ALREADY_EXISTS';
          throw conflict;
        }
        const failure = new Error('Long-term memory create failed');
        failure.code = 'STORED_INFORMATION_CREATE_FAILED';
        throw failure;
      }
      return { id, category, key };
    },
  });
}

export default createStoredInformationRepository;
