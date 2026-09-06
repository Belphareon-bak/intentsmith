// Mobile-safe, read-only projection of the production v33 worker tables.
//
// The legacy `agents` table is intentionally ignored. Runtime rows whose
// status is still `running` are also ignored: the current store has no lease
// or crash-recovery marker that would make such a row trustworthy after a
// process restart.

const TERMINAL_STATUSES = new Set(['success', 'partial', 'error']);

function projectionError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function isoTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const source = String(value);
  const normalized = /[TZ]|[+-]\d\d:?\d\d$/.test(source)
    ? source
    : `${source.replace(' ', 'T')}Z`;
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) throw projectionError('WORKER_RECORD_INVALID');
  return new Date(parsed).toISOString();
}

function requiredText(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw projectionError('WORKER_RECORD_INVALID');
  }
  return value;
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw projectionError('WORKER_RECORD_INVALID');
  return value;
}

function workerDto(row) {
  let definition;
  try { definition = JSON.parse(row.definition); } catch {
    throw projectionError('WORKER_DEFINITION_INVALID');
  }
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw projectionError('WORKER_DEFINITION_INVALID');
  }

  const kind = definition.type === undefined || definition.type === null
    ? null
    : optionalText(definition.type);
  const status = row.last_status === null ? null : requiredText(row.last_status);
  if (status !== null && !TERMINAL_STATUSES.has(status)) {
    throw projectionError('WORKER_RUN_STATUS_INVALID');
  }
  if (row.enabled !== 0 && row.enabled !== 1) {
    throw projectionError('WORKER_RECORD_INVALID');
  }
  const intervalMs = row.interval_ms === null ? null : Number(row.interval_ms);
  if (intervalMs !== null && (!Number.isSafeInteger(intervalMs) || intervalMs < 0)) {
    throw projectionError('WORKER_RECORD_INVALID');
  }
  const actionsExecuted = row.last_run_id === null ? null : Number(row.actions_executed || 0);
  if (actionsExecuted !== null && (!Number.isSafeInteger(actionsExecuted) || actionsExecuted < 0)) {
    throw projectionError('WORKER_RECORD_INVALID');
  }

  return {
    id: requiredText(row.id),
    name: requiredText(row.name),
    description: optionalText(row.description),
    icon: optionalText(row.icon),
    kind,
    enabled: row.enabled === 1,
    schedule: row.schedule_agent_id === null ? null : {
      intervalMs,
      cronExpression: optionalText(row.cron_expression),
      nextRunAt: isoTimestamp(row.next_run),
      lastRunAt: isoTimestamp(row.schedule_last_run),
    },
    lastRun: row.last_run_id === null ? null : {
      id: String(row.last_run_id),
      status,
      startedAt: isoTimestamp(row.last_started_at),
      finishedAt: isoTimestamp(row.last_finished_at),
      actionsExecuted,
    },
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
  };
}

export function createWorkerMobileReadModel(rawDb) {
  if (!rawDb || typeof rawDb.prepare !== 'function') {
    throw new TypeError('worker mobile read model requires a database handle');
  }

  const listRows = rawDb.prepare(`
    SELECT a.id, a.name, a.description, a.icon, a.definition, a.enabled,
           a.created_at, a.updated_at,
           s.agent_id AS schedule_agent_id, s.next_run, s.last_run AS schedule_last_run,
           s.interval_ms, s.cron_expression,
           r.id AS last_run_id, r.status AS last_status,
           r.started_at AS last_started_at, r.finished_at AS last_finished_at,
           r.actions_executed
      FROM agents_v33 a
      LEFT JOIN agent_schedule_v33 s ON s.agent_id = a.id
      LEFT JOIN agent_runs_v33 r ON r.id = (
        SELECT rr.id
          FROM agent_runs_v33 rr
         WHERE rr.agent_id = a.id
           AND rr.status != 'running'
           AND rr.finished_at IS NOT NULL
         ORDER BY rr.started_at DESC, rr.id DESC
         LIMIT 1
      )
     ORDER BY a.name COLLATE NOCASE ASC, a.id ASC
     LIMIT ? OFFSET ?
  `);

  return Object.freeze({
    list({ limit, offset = 0 } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw projectionError('WORKER_LIMIT_INVALID');
      }
      if (!Number.isInteger(offset) || offset < 0) {
        throw projectionError('WORKER_CURSOR_INVALID');
      }
      return listRows.all(limit + 1, offset).map(workerDto);
    },
  });
}

export default createWorkerMobileReadModel;
