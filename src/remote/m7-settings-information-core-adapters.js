import { createHash } from 'node:crypto';

import { canonicalizeM2ExecutionValue } from '../../contracts/m2/execution-v1.js';
import {
  readUserSettings,
  updateUserSettings,
  UserSettingsError,
  UserSettingsStatus,
} from '../db/user-settings.js';
import {
  M7_CORE_CURSOR_ERROR,
  M7CoreCursorError,
  computeM7CoreCursorFilterDigest,
  createM7CoreCursorCodec,
} from './m7-core-cursor.js';

export const M7_SETTINGS_INFORMATION_ERROR = Object.freeze({
  ACCESS_DENIED: 'M7_STORED_INFORMATION_ACCESS_DENIED',
  CURSOR_INVALID: 'M7_STORED_INFORMATION_CURSOR_INVALID',
  CURSOR_STALE: 'M7_STORED_INFORMATION_CURSOR_STALE',
  INPUT_INVALID: 'M7_SETTINGS_INFORMATION_INPUT_INVALID',
  KIND_UNAVAILABLE: 'M7_STORED_INFORMATION_KIND_UNAVAILABLE',
  READ_FAILED: 'M7_SETTINGS_INFORMATION_READ_FAILED',
  SETTING_UNKNOWN: 'M7_SETTING_UNKNOWN',
  SETTING_VALUE_INVALID: 'M7_SETTING_VALUE_INVALID',
  STALE_REVISION: 'M7_SETTING_STALE_REVISION',
});

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAX_INFORMATION_SCAN = 2_000;
const AUTHORITY_CONTRACTS = Object.freeze([
  'ApprovalGrant@1',
  'EffectRequest@1',
  'EffectResult@1',
]);

const SETTING_DEFINITIONS = Object.freeze([
  Object.freeze({
    key: 'appearance.density', category: 'appearance', valueType: 'enum',
    defaultValue: 'comfortable', path: Object.freeze(['appearance', 'density']),
    constraints: Object.freeze({ enumValues: Object.freeze(['comfortable', 'compact', 'spacious']) }),
  }),
  Object.freeze({
    key: 'appearance.fontSize', category: 'appearance', valueType: 'integer',
    defaultValue: 14, path: Object.freeze(['appearance', 'fontSize']),
    constraints: Object.freeze({ minimum: '10', maximum: '24', step: '1' }),
  }),
  Object.freeze({
    key: 'appearance.theme', category: 'appearance', valueType: 'enum',
    defaultValue: 'dark', path: Object.freeze(['appearance', 'theme']),
    constraints: Object.freeze({ enumValues: Object.freeze(['dark', 'light', 'system']) }),
  }),
  Object.freeze({
    key: 'memory.saveContext', category: 'memory', valueType: 'boolean',
    defaultValue: true, path: Object.freeze(['memory', 'saveContext']),
    constraints: Object.freeze({}),
  }),
  Object.freeze({
    key: 'memory.saveHistory', category: 'memory', valueType: 'boolean',
    defaultValue: true, path: Object.freeze(['memory', 'saveHistory']),
    constraints: Object.freeze({}),
  }),
]);
const SETTING_BY_KEY = new Map(SETTING_DEFINITIONS.map(definition => [definition.key, definition]));

class M7SettingsInformationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'M7SettingsInformationError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new M7SettingsInformationError(code, message);
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function requireFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`m7-settings-information:${label}-required`);
  return value;
}

function requireDatabase(value) {
  const db = value?.db ?? value;
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw new TypeError('m7-settings-information:sqlite-database-required');
  }
  return db;
}

function requireContext(value) {
  if (!value || !IDENTIFIER.test(value.deviceId || '') || !IDENTIFIER.test(value.subjectId || '')) {
    fail(M7_SETTINGS_INFORMATION_ERROR.INPUT_INVALID, 'trusted identity context is invalid');
  }
  return value;
}

function digestRevision(prefix, value) {
  return `rev:${prefix}:${createHash('sha256')
    .update(canonicalizeM2ExecutionValue(value), 'utf8')
    .digest('hex')}`;
}

function remoteError(code, message, retryable = false) {
  return { code, message, retryable };
}

function readPath(document, definition) {
  let value = document;
  for (const segment of definition.path) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)
      || !Object.hasOwn(value, segment)) return definition.defaultValue;
    value = value[segment];
  }
  return value;
}

function valueValid(definition, value) {
  if (definition.valueType === 'boolean') return typeof value === 'boolean';
  if (definition.valueType === 'integer') {
    return Number.isSafeInteger(value)
      && value >= Number(definition.constraints.minimum)
      && value <= Number(definition.constraints.maximum);
  }
  return definition.constraints.enumValues.includes(value);
}

function projectSetting(definition, document) {
  const value = readPath(document, definition);
  if (!valueValid(definition, value)) {
    fail(M7_SETTINGS_INFORMATION_ERROR.READ_FAILED, 'persisted mobile setting is invalid');
  }
  const projected = {
    key: definition.key,
    category: definition.category,
    valueType: definition.valueType,
    value,
    writable: true,
    constraints: structuredClone(definition.constraints),
  };
  return {
    ...projected,
    revision: digestRevision('setting', projected),
  };
}

function readSettingsDocument(db) {
  const result = readUserSettings(db);
  if (result.status === UserSettingsStatus.MISSING) return {};
  if (result.status !== UserSettingsStatus.VALID) {
    fail(M7_SETTINGS_INFORMATION_ERROR.READ_FAILED, 'settings storage is unavailable or malformed');
  }
  return result.settings;
}

function settingsProjection(db) {
  const document = readSettingsDocument(db);
  const items = SETTING_DEFINITIONS.map(definition => projectSetting(definition, document));
  return {
    items,
    revision: digestRevision('settings', items),
  };
}

function setPath(document, definition, value) {
  const [section, key] = definition.path;
  const existing = document[section];
  if (existing !== undefined && (existing === null || typeof existing !== 'object' || Array.isArray(existing))) {
    fail(M7_SETTINGS_INFORMATION_ERROR.READ_FAILED, 'settings section is malformed');
  }
  document[section] = { ...(existing || {}), [key]: value };
}

function settingFailure(request, revision, code, message, retryable = false) {
  return deepFreeze({
    contract: 'MobileSettingUpdateResult',
    version: 1,
    requestId: request.requestId,
    operationId: request.operationId,
    key: request.key,
    value: request.value,
    revision,
    outcome: 'REJECTED',
    replayed: false,
    error: remoteError(code, message, retryable),
  });
}

function deterministicInformationId(subjectId, operationId) {
  const digest = createHash('sha256')
    .update('IntentSmith:M7ManualInformation@1\0', 'utf8')
    .update(subjectId, 'utf8')
    .update('\0', 'utf8')
    .update(operationId, 'utf8')
    .digest('hex');
  return `information:${digest}`;
}

function canonicalSummary(content) {
  const normalized = content.trim().replace(/\s+/gu, ' ');
  if (normalized.length === 0) {
    fail(M7_SETTINGS_INFORMATION_ERROR.INPUT_INVALID, 'manual information must contain visible text');
  }
  let summary = '';
  for (const character of normalized) {
    if (Buffer.byteLength(summary + character, 'utf8') > 512) break;
    summary += character;
  }
  return summary;
}

function protectedTextValid(value, { maxBytes }) {
  return typeof value === 'string'
    && Buffer.byteLength(value, 'utf8') >= 1
    && Buffer.byteLength(value, 'utf8') <= maxBytes
    && value.normalize('NFC') === value
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}

function parseTags(value) {
  let tags;
  try {
    tags = JSON.parse(value);
  } catch {
    fail(M7_SETTINGS_INFORMATION_ERROR.READ_FAILED, 'stored information tags are invalid');
  }
  if (!Array.isArray(tags)
    || tags.length > 32
    || tags.some(tag => !protectedTextValid(tag, { maxBytes: 64 }))
    || tags.some((tag, index) => index > 0 && tags[index - 1] >= tag)) {
    fail(M7_SETTINGS_INFORMATION_ERROR.READ_FAILED, 'stored information tags are invalid');
  }
  return tags;
}

function informationItem(row) {
  if (!Number.isSafeInteger(row?.createdAtMs) || row.createdAtMs < 1
    || !IDENTIFIER.test(row.informationId || '')
    || (row.projectId !== null
      && (!Number.isSafeInteger(row.projectId) || row.projectId < 1))
    || !protectedTextValid(row.content, { maxBytes: 16_384 })
    || !protectedTextValid(row.summary, { maxBytes: 512 })) {
    fail(M7_SETTINGS_INFORMATION_ERROR.READ_FAILED, 'stored information row is invalid');
  }
  let createdAt;
  try {
    createdAt = new Date(row.createdAtMs).toISOString();
  } catch {
    fail(M7_SETTINGS_INFORMATION_ERROR.READ_FAILED, 'stored information timestamp is invalid');
  }
  const projected = {
    informationId: row.informationId,
    kind: 'manual_note',
    projectId: row.projectId,
    summary: row.summary,
    content: row.content,
    tags: parseTags(row.tagsJson),
    createdAt,
    updatedAt: createdAt,
  };
  return {
    ...projected,
    revision: digestRevision('information', projected),
  };
}

function listFailure(requestId, code, message, retryable = false) {
  return deepFreeze({
    contract: 'StoredInformationPage',
    version: 1,
    requestId,
    status: 'error',
    error: remoteError(code, message, retryable),
  });
}

function informationFailure(request, informationId, revision, code, message, retryable = false) {
  return deepFreeze({
    contract: 'StoredInformationAppendResult',
    version: 1,
    requestId: request.requestId,
    operationId: request.operationId,
    informationId,
    revision,
    outcome: 'REJECTED',
    replayed: false,
    error: remoteError(code, message, retryable),
  });
}

function normalizeMediation(value, pendingResult, rejectedResult) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(M7_SETTINGS_INFORMATION_ERROR.INPUT_INVALID, 'mutation mediator returned an invalid decision');
  }
  if (value.state === 'executed' && Object.keys(value).length === 2 && value.result) {
    return value.result;
  }
  if (value.state === 'pending'
    && Object.keys(value).length === 2
    && IDENTIFIER.test(value.pendingApprovalId || '')) {
    return pendingResult(value.pendingApprovalId);
  }
  if (value.state === 'rejected'
    && Object.keys(value).length === 2
    && value.error
    && typeof value.error.code === 'string'
    && typeof value.error.message === 'string'
    && typeof value.error.retryable === 'boolean') {
    const candidateCode = value.error.code.startsWith('REMOTE_')
      ? value.error.code
      : `REMOTE_${value.error.code}`;
    return rejectedResult({
      ...value.error,
      code: /^REMOTE_[A-Z0-9_]{1,80}$/u.test(candidateCode)
        ? candidateCode
        : 'REMOTE_MUTATION_REJECTED',
    });
  }
  fail(M7_SETTINGS_INFORMATION_ERROR.INPUT_INVALID, 'mutation mediator returned an invalid decision');
}

export function createM7SettingsInformationCoreAdapters({
  authorizeProject,
  cursorKey,
  database,
  mediateMutation,
  maxInformationScan = MAX_INFORMATION_SCAN,
  now = Date.now,
} = {}) {
  const db = requireDatabase(database);
  const authorize = requireFunction(authorizeProject, 'authorize-project');
  const mediate = requireFunction(mediateMutation, 'mutation-mediator');
  const clock = requireFunction(now, 'clock');
  if (!Number.isSafeInteger(maxInformationScan) || maxInformationScan < 1 || maxInformationScan > 10_000) {
    throw new TypeError('m7-settings-information:max-information-scan-invalid');
  }
  const cursorCodec = createM7CoreCursorCodec({ key: cursorKey });
  const listProjectIds = db.prepare(`
    SELECT DISTINCT project_id AS projectId
    FROM m7_manual_information
    WHERE subject_id = ? AND project_id IS NOT NULL
    ORDER BY project_id ASC
    LIMIT ?
  `);
  const listAll = db.prepare(`
    SELECT information_id AS informationId, project_id AS projectId,
      content, summary, tags_json AS tagsJson, created_at_ms AS createdAtMs
    FROM m7_manual_information
    WHERE subject_id = ?
    ORDER BY created_at_ms DESC, information_id DESC
    LIMIT ?
  `);
  const listByProject = db.prepare(`
    SELECT information_id AS informationId, project_id AS projectId,
      content, summary, tags_json AS tagsJson, created_at_ms AS createdAtMs
    FROM m7_manual_information
    WHERE subject_id = ? AND project_id = ?
    ORDER BY created_at_ms DESC, information_id DESC
    LIMIT ?
  `);
  const insertInformation = db.prepare(`
    INSERT INTO m7_manual_information (
      information_id, subject_id, project_id, operation_id,
      content, summary, tags_json, created_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findInformation = db.prepare(`
    SELECT information_id AS informationId, project_id AS projectId,
      content, summary, tags_json AS tagsJson, created_at_ms AS createdAtMs
    FROM m7_manual_information
    WHERE subject_id = ? AND information_id = ?
  `);

  async function projectAllowed(context, projectId, operationId) {
    if (projectId === null || projectId === undefined) return true;
    try {
      return await authorize({
        deviceId: context.deviceId,
        subjectId: context.subjectId,
        projectId,
        operationId,
      }) === true;
    } catch {
      return false;
    }
  }

  async function readSettings(request, trustedContext) {
    requireContext(trustedContext);
    try {
      const snapshot = settingsProjection(db);
      const requested = request.keys ?? SETTING_DEFINITIONS.map(item => item.key);
      if (requested.some(key => !SETTING_BY_KEY.has(key))) {
        return deepFreeze({
          contract: 'MobileSettingsSnapshot', version: 1, requestId: request.requestId,
          status: 'error', error: remoteError('REMOTE_SETTING_UNKNOWN', 'A requested setting is unavailable.'),
        });
      }
      return deepFreeze({
        contract: 'MobileSettingsSnapshot',
        version: 1,
        requestId: request.requestId,
        status: 'ok',
        items: snapshot.items.filter(item => requested.includes(item.key)),
        revision: snapshot.revision,
      });
    } catch {
      return deepFreeze({
        contract: 'MobileSettingsSnapshot', version: 1, requestId: request.requestId,
        status: 'error', error: remoteError('REMOTE_SETTINGS_READ_FAILED', 'Settings could not be read safely.', true),
      });
    }
  }

  async function updateSetting(request, trustedContext) {
    const context = requireContext(trustedContext);
    let before;
    try {
      before = settingsProjection(db);
    } catch {
      return settingFailure(
        request, 'rev:settings:unavailable', 'REMOTE_SETTINGS_READ_FAILED',
        'Settings could not be read safely.', true,
      );
    }
    const definition = SETTING_BY_KEY.get(request.key);
    if (!definition) return settingFailure(
      request, before.revision, 'REMOTE_SETTING_UNKNOWN', 'The setting is not in the mobile allowlist.',
    );
    if (!valueValid(definition, request.value)) return settingFailure(
      request, before.revision, 'REMOTE_SETTING_VALUE_INVALID', 'The requested value is invalid.',
    );
    if (request.expectedRevision !== before.revision) return settingFailure(
      request, before.revision, 'REMOTE_SETTING_STALE_REVISION', 'The settings snapshot is stale.',
    );

    const mediation = await mediate(deepFreeze({
      authorityContracts: [...AUTHORITY_CONTRACTS],
      capabilityId: 'settings',
      operationId: 'settings.update',
      deviceId: context.deviceId,
      subjectId: context.subjectId,
      request,
      perform() {
        let updated;
        try {
          const persisted = updateUserSettings(db, (document) => {
            const current = SETTING_DEFINITIONS.map(item => projectSetting(item, document));
            if (digestRevision('settings', current) !== request.expectedRevision) {
              fail(M7_SETTINGS_INFORMATION_ERROR.STALE_REVISION, 'settings changed before mutation');
            }
            setPath(document, definition, request.value);
          });
          const items = SETTING_DEFINITIONS.map(item => projectSetting(item, persisted));
          updated = { items, revision: digestRevision('settings', items) };
        } catch (error) {
          if (error instanceof M7SettingsInformationError) throw error;
          if (error instanceof UserSettingsError) throw error;
          throw error;
        }
        return deepFreeze({
          contract: 'MobileSettingUpdateResult', version: 1,
          requestId: request.requestId, operationId: request.operationId,
          key: request.key, value: request.value, revision: updated.revision,
          outcome: 'CONFIRMED', replayed: false,
        });
      },
    }));
    return normalizeMediation(
      mediation,
      pendingApprovalId => deepFreeze({
        contract: 'MobileSettingUpdateResult', version: 1,
        requestId: request.requestId, operationId: request.operationId,
        key: request.key, value: request.value, revision: before.revision,
        outcome: 'PENDING', replayed: false, pendingApprovalId,
      }),
      error => settingFailure(request, before.revision, error.code, error.message, error.retryable),
    );
  }

  async function authorizedProjectIds(context, requestedProjectId, operationId) {
    if (requestedProjectId !== undefined) {
      return await projectAllowed(context, requestedProjectId, operationId)
        ? new Set([requestedProjectId])
        : null;
    }
    const rows = listProjectIds.all(context.subjectId, maxInformationScan + 1);
    if (rows.length > maxInformationScan) {
      fail(M7_SETTINGS_INFORMATION_ERROR.READ_FAILED, 'stored information project scan limit exceeded');
    }
    const allowed = new Set();
    for (const row of rows) {
      if (await projectAllowed(context, row.projectId, operationId)) allowed.add(row.projectId);
    }
    return allowed;
  }

  async function listInformation(request, trustedContext) {
    const context = requireContext(trustedContext);
    const kinds = request.kinds ?? ['manual_note'];
    if (kinds.some(kind => kind !== 'manual_note')) {
      return listFailure(
        request.requestId, 'REMOTE_INFORMATION_KIND_UNAVAILABLE',
        'Legacy task and long-term memory are not bound to the mobile subject authority.',
      );
    }
    try {
      const allowed = await authorizedProjectIds(context, request.projectId, 'stored-information.list');
      if (allowed === null) return listFailure(
        request.requestId, 'REMOTE_STORED_INFORMATION_ACCESS_DENIED',
        'Stored information is unavailable for this project.',
      );
      const rawRows = request.projectId === undefined
        ? listAll.all(context.subjectId, maxInformationScan + 1)
        : listByProject.all(context.subjectId, request.projectId, maxInformationScan + 1);
      if (rawRows.length > maxInformationScan) {
        fail(M7_SETTINGS_INFORMATION_ERROR.READ_FAILED, 'stored information scan limit exceeded');
      }
      const rows = rawRows.filter(row => row.projectId === null || allowed.has(row.projectId));
      const items = rows.map(informationItem);
      for (const projectId of new Set(items.map(item => item.projectId).filter(id => id !== null))) {
        if (!await projectAllowed(context, projectId, 'stored-information.list')) {
          fail(M7_SETTINGS_INFORMATION_ERROR.ACCESS_DENIED, 'stored information authority changed');
        }
      }
      const snapshotRevision = digestRevision('information-snapshot', items);
      const filterDigest = computeM7CoreCursorFilterDigest({
        kinds, limit: request.limit, projectId: request.projectId ?? null,
      });
      let offset = 0;
      if (request.cursor) offset = cursorCodec.decode(request.cursor, {
        capabilityId: 'stored_information', capabilityVersion: 1,
        operationId: 'stored-information.list', deviceId: context.deviceId,
        subjectId: context.subjectId, filterDigest, snapshotRevision,
      }).offset;
      if (offset > items.length) fail(M7_SETTINGS_INFORMATION_ERROR.CURSOR_INVALID, 'cursor offset is invalid');
      const pageItems = items.slice(offset, offset + request.limit);
      const nextOffset = offset + pageItems.length;
      const end = nextOffset >= items.length;
      return deepFreeze({
        contract: 'StoredInformationPage', version: 1, requestId: request.requestId,
        status: 'ok', items: pageItems, end,
        nextCursor: end ? null : cursorCodec.encode({
          capabilityId: 'stored_information', capabilityVersion: 1,
          operationId: 'stored-information.list', deviceId: context.deviceId,
          subjectId: context.subjectId, filterDigest, snapshotRevision, offset: nextOffset,
        }),
        snapshotRevision,
      });
    } catch (error) {
      if (error instanceof M7CoreCursorError) return listFailure(
        request.requestId,
        error.code === M7_CORE_CURSOR_ERROR.STALE
          ? 'REMOTE_STORED_INFORMATION_CURSOR_STALE'
          : 'REMOTE_STORED_INFORMATION_CURSOR_INVALID',
        'The stored-information cursor is invalid or stale.',
      );
      return listFailure(
        request.requestId, 'REMOTE_STORED_INFORMATION_READ_FAILED',
        'Stored information could not be read safely.', true,
      );
    }
  }

  async function appendInformation(request, trustedContext) {
    const context = requireContext(trustedContext);
    const informationId = deterministicInformationId(context.subjectId, request.operationId);
    const emptyRevision = digestRevision('information', {
      informationId, subjectId: context.subjectId, operationId: request.operationId,
    });
    if (!await projectAllowed(context, request.projectId, 'stored-information.append')) {
      return informationFailure(
        request, informationId, emptyRevision, 'REMOTE_STORED_INFORMATION_ACCESS_DENIED',
        'Stored information is unavailable for this project.',
      );
    }
    let summary;
    try {
      summary = canonicalSummary(request.content);
    } catch {
      return informationFailure(
        request, informationId, emptyRevision, 'REMOTE_STORED_INFORMATION_CONTENT_INVALID',
        'Manual information must contain visible text.',
      );
    }
    const mediation = await mediate(deepFreeze({
      authorityContracts: [...AUTHORITY_CONTRACTS],
      capabilityId: 'stored_information',
      operationId: 'stored-information.append',
      deviceId: context.deviceId,
      subjectId: context.subjectId,
      projectId: request.projectId ?? null,
      request,
      async perform() {
        if (!await projectAllowed(context, request.projectId, 'stored-information.append')) {
          fail(M7_SETTINGS_INFORMATION_ERROR.ACCESS_DENIED, 'project authority changed before append');
        }
        const timestamp = clock();
        if (!Number.isSafeInteger(timestamp) || timestamp < 1) {
          fail(M7_SETTINGS_INFORMATION_ERROR.INPUT_INVALID, 'clock returned an invalid timestamp');
        }
        const info = insertInformation.run(
          informationId, context.subjectId, request.projectId ?? null, request.operationId,
          request.content, summary, JSON.stringify(request.tags ?? []), timestamp,
        );
        if (info.changes !== 1) fail(M7_SETTINGS_INFORMATION_ERROR.READ_FAILED, 'manual information was not inserted');
        const row = findInformation.get(context.subjectId, informationId);
        const item = informationItem(row);
        return deepFreeze({
          contract: 'StoredInformationAppendResult', version: 1,
          requestId: request.requestId, operationId: request.operationId,
          informationId, revision: item.revision,
          outcome: 'CONFIRMED', replayed: false,
        });
      },
    }));
    return normalizeMediation(
      mediation,
      pendingApprovalId => deepFreeze({
        contract: 'StoredInformationAppendResult', version: 1,
        requestId: request.requestId, operationId: request.operationId,
        informationId, revision: emptyRevision,
        outcome: 'PENDING', replayed: false, pendingApprovalId,
      }),
      error => informationFailure(
        request, informationId, emptyRevision, error.code, error.message, error.retryable,
      ),
    );
  }

  return deepFreeze({
    readSettings,
    updateSetting,
    listInformation,
    appendInformation,
    handlers: {
      'settings.read': readSettings,
      'settings.update': updateSetting,
      'stored-information.list': listInformation,
      'stored-information.append': appendInformation,
    },
  });
}

export default createM7SettingsInformationCoreAdapters;
