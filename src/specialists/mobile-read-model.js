// Mobile-safe, read-only projection of installed specialist packages.
// This reports persisted configuration only; it deliberately does not invent
// an `isRegistered` runtime value that the standalone gateway cannot observe.

const TYPES = new Set(['domain', 'utility', 'integration']);
const STATUSES = new Set(['installed', 'enabled', 'disabled']);

function projectionError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function requiredText(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw projectionError('SPECIALIST_RECORD_INVALID');
  }
  return value;
}

function isoTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const source = String(value);
  const normalized = /[TZ]|[+-]\d\d:?\d\d$/.test(source)
    ? source
    : `${source.replace(' ', 'T')}Z`;
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) throw projectionError('SPECIALIST_RECORD_INVALID');
  return new Date(parsed).toISOString();
}

function optionalText(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw projectionError('SPECIALIST_RECORD_INVALID');
  return value;
}

function expertiseDto(row) {
  const priority = Number(row.priority);
  if (!Number.isSafeInteger(priority)) {
    throw projectionError('SPECIALIST_RECORD_INVALID');
  }
  return {
    id: requiredText(row.expertise_id),
    label: optionalText(row.label),
    priority,
    addedAt: isoTimestamp(row.added_at),
  };
}

function specialistDto(row) {
  const type = requiredText(row.type);
  const status = requiredText(row.status);
  if (!TYPES.has(type) || !STATUSES.has(status)) {
    throw projectionError('SPECIALIST_RECORD_INVALID');
  }
  const expertiseCount = Number(row.expertise_count);
  if (!Number.isSafeInteger(expertiseCount) || expertiseCount < 0) {
    throw projectionError('SPECIALIST_RECORD_INVALID');
  }
  return {
    id: requiredText(row.id),
    name: requiredText(row.name),
    packageVersion: requiredText(row.version),
    domain: requiredText(row.domain),
    type,
    status,
    expertiseCount,
    installedAt: isoTimestamp(row.installed_at),
    enabledAt: isoTimestamp(row.enabled_at),
    disabledAt: isoTimestamp(row.disabled_at),
    updatedAt: isoTimestamp(row.updated_at),
  };
}

export function createSpecialistMobileReadModel(rawDb) {
  if (!rawDb || typeof rawDb.prepare !== 'function') {
    throw new TypeError('specialist mobile read model requires a database handle');
  }

  const listRows = rawDb.prepare(`
    SELECT s.id, s.name, s.version, s.domain, s.type, s.status,
           s.installed_at, s.enabled_at, s.disabled_at, s.updated_at,
           COUNT(se.expertise_id) AS expertise_count
      FROM specialists s
      LEFT JOIN specialist_expertises se ON se.specialist_id = s.id
     GROUP BY s.id
     ORDER BY s.name COLLATE NOCASE ASC, s.id ASC
     LIMIT ? OFFSET ?
  `);
  const getRow = rawDb.prepare(`
    SELECT s.id, s.name, s.version, s.domain, s.type, s.status,
           s.installed_at, s.enabled_at, s.disabled_at, s.updated_at
      FROM specialists s
     WHERE s.id = ?
  `);
  const expertiseRows = rawDb.prepare(`
    SELECT expertise_id, label, priority, added_at
      FROM specialist_expertises
     WHERE specialist_id = ?
     ORDER BY priority DESC, added_at ASC, expertise_id ASC
  `);
  const readDetail = rawDb.transaction(id => {
    const row = getRow.get(id);
    if (!row) return null;
    const expertises = expertiseRows.all(id).map(expertiseDto);
    return {
      ...specialistDto({ ...row, expertise_count: expertises.length }),
      expertises,
    };
  });

  return Object.freeze({
    list({ limit, offset = 0 } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw projectionError('SPECIALIST_LIMIT_INVALID');
      }
      if (!Number.isInteger(offset) || offset < 0) {
        throw projectionError('SPECIALIST_CURSOR_INVALID');
      }
      return listRows.all(limit + 1, offset).map(specialistDto);
    },

    get(id) {
      return readDetail(id);
    },
  });
}

export default createSpecialistMobileReadModel;
