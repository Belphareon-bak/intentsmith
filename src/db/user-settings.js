import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { SETTINGS_PORTABLE_PATHS, mergeSettingsProjection } from './settings-portability.js';

// IntentSmith user-settings authority
//
// The persisted document lives in the single user_settings row with id=1.
// Readers return typed states instead of silently treating malformed storage as
// a valid opt-in. Writers use one SQLite transaction and preserve unrelated
// settings sections.

export const UserSettingsStatus = Object.freeze({
  VALID: 'VALID',
  MISSING: 'MISSING',
  MALFORMED: 'MALFORMED',
  DB_ERROR: 'DB_ERROR',
});

export const DEFAULT_MODEL_SETTINGS = Object.freeze({
  autoFailoverEnabled: false,
  autoCleanupEnabled: false,
  autoCleanupDays: 14,
});

export const LEGACY_NOTIFICATION_USER_SETTING_PATHS = Object.freeze([
  '/notifications/discordWebhook',
  '/notifications/emailAddresses',
  '/notifications/slackChannel',
  '/notifications/slackWebhook',
  '/notifications/smsApiKey',
  '/notifications/smsPhone',
  '/notifications/smsSecret',
  '/notifications/telegramChatId',
  '/notifications/telegramToken',
  '/notifications/webhookUrl',
  'c3.notif.emailEnabled',
  'c3.notif.emailOnLifecycle',
  'c3.notif.emailOnWorker',
  'c3.notif.emailRecipient',
  'c3.notif.smtpFrom',
  'c3.notif.smtpHost',
  'c3.notif.smtpPass',
  'c3.notif.smtpPort',
  'c3.notif.smtpUser',
  'c3.notif.webhookSecret',
  'webhookSecret',
]);

const LEGACY_NOTIFICATION_USER_SETTING_PATH_SET = new Set(
  LEGACY_NOTIFICATION_USER_SETTING_PATHS,
);
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const brandedLegacyNotificationCensuses = new WeakSet();

// Versioned GENERIC owner map. Dotted names are literal top-level JSON keys;
// slash-prefixed names address the two nested preference containers.
export const GENERIC_USER_SETTING_PATHS = Object.freeze([
  'c3.account.displayName',
  'c3.account.description',
  'c3.account.timezone',
  'c3.account.currency',
  'c3.language',
  'c3.llm.chatModel',
  'c3.llm.codeModel',
  'c3.llm.ollamaUrl',
  'c3.llm.temperature',
  'c3.llm.contextWindow',
  'c3.llm.timeoutChat',
  'c3.llm.timeoutCode',
  'c3.llm.numGpu',
  'c3.memory.conversationMaxTurns',
  'c3.memory.compactThreshold',
  'c3.memory.compactKeepTurns',
  'c3.memory.ltmEnabled',
  'c3.memory.ltmMaxEntries',
  'c3.memory.ltmDecayHalfLife',
  'c3.memory.contextBudgetChat',
  'c3.memory.contextBudgetCode',
  'c3.memory.contextBudgetMaxTokens',
  'c3.memory.learningEnabled',
  'c3.memory.feedbackDetection',
  'c3.memory.patternTracking',
  'c3.notif.desktopEnabled',
  'c3.notif.quietEnabled',
  'c3.notif.quietFrom',
  'c3.notif.quietTo',
  'c3.output.codeBlocks',
  'c3.output.syntaxHighlight',
  'c3.output.markdownRendering',
  'c3.output.maxResponseLength',
  'c3.system.logLevel',
  'c3.system.logRetentionDays',
  'c3.system.maxFileSize',
  'c3.system.rateLimit',
  '/appearance/theme',
  '/appearance/accentColor',
  '/appearance/fontFamily',
  '/appearance/fontSize',
  '/appearance/density',
  '/output/enabledTypes',
  '/output/defaultFormat',
  '/output/codeStyle',
  '/output/namingConvention',
]);

const GENERIC_FLAT_SETTING_KEYS = Object.freeze(
  GENERIC_USER_SETTING_PATHS.filter(path => !path.startsWith('/')),
);
const GENERIC_FLAT_SETTING_KEY_SET = new Set(GENERIC_FLAT_SETTING_KEYS);
const GENERIC_NESTED_SETTING_PATHS = Object.freeze(
  GENERIC_USER_SETTING_PATHS
    .filter(path => path.startsWith('/'))
    .map(path => path.slice(1).split('/')),
);
const GENERIC_NESTED_SETTING_KEYS = new Map();
for (const [container, key] of GENERIC_NESTED_SETTING_PATHS) {
  if (!GENERIC_NESTED_SETTING_KEYS.has(container)) {
    GENERIC_NESTED_SETTING_KEYS.set(container, new Set());
  }
  GENERIC_NESTED_SETTING_KEYS.get(container).add(key);
}

export class UserSettingsError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'UserSettingsError';
    this.code = code;
    this.details = options.details || null;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clone(value) {
  return structuredClone(value);
}

function isSafeRevision(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

function hasRevisionColumn(db) {
  try {
    return db.prepare('PRAGMA table_info(user_settings)').all()
      .some(column => column.name === 'revision');
  } catch (error) {
    throw new UserSettingsError(
      'USER_SETTINGS_DB_READ_FAILED',
      'Failed to inspect user settings storage',
      { cause: error },
    );
  }
}

function cloneFiniteJson(value, code = 'USER_SETTINGS_VALUE_INVALID') {
  let encoded;
  try {
    encoded = JSON.stringify(value, (_key, current) => {
      if (typeof current === 'number' && !Number.isFinite(current)) {
        throw new TypeError('non-finite number');
      }
      if (['bigint', 'function', 'symbol', 'undefined'].includes(typeof current)) {
        throw new TypeError(`unsupported ${typeof current}`);
      }
      if (current !== null
        && typeof current === 'object'
        && !Array.isArray(current)
        && !isPlainObject(current)) {
        throw new TypeError('non-plain object');
      }
      return current;
    });
  } catch (error) {
    throw new UserSettingsError(code, 'Settings value must be finite JSON data', { cause: error });
  }
  if (encoded === undefined) {
    throw new UserSettingsError(code, 'Settings value must be finite JSON data');
  }
  return JSON.parse(encoded);
}

function requirePlainSettingsPatch(value, code) {
  if (!isPlainObject(value)) {
    throw new UserSettingsError(code, 'Settings patch must be a plain object');
  }
  return value;
}

function setOwn(document, key, value) {
  Object.defineProperty(document, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

function parseSettingsRow(row, { requireRevision = false } = {}) {
  if (!row) {
    return {
      status: UserSettingsStatus.MISSING,
      settings: {},
      reason: 'USER_SETTINGS_ROW_MISSING',
    };
  }

  try {
    const settings = JSON.parse(row.data);
    if (!isPlainObject(settings)) {
      return {
        status: UserSettingsStatus.MALFORMED,
        settings: {},
        reason: 'USER_SETTINGS_DOCUMENT_NOT_OBJECT',
      };
    }
    const revision = row.revision ?? null;
    if (requireRevision && !isSafeRevision(revision)) {
      return {
        status: UserSettingsStatus.MALFORMED,
        settings: {},
        revision: null,
        reason: 'USER_SETTINGS_REVISION_INVALID',
      };
    }
    return {
      status: UserSettingsStatus.VALID,
      settings,
      revision,
      reason: null,
    };
  } catch (_) {
    return {
      status: UserSettingsStatus.MALFORMED,
      settings: {},
      revision: null,
      reason: 'USER_SETTINGS_JSON_INVALID',
    };
  }
}

/**
 * Read the complete settings document without throwing.
 *
 * DB errors and malformed storage remain distinguishable from a missing row so
 * security-sensitive consumers can fail closed and report the real reason.
 */
export function readUserSettings(db) {
  try {
    const versioned = hasRevisionColumn(db);
    const row = db.prepare(
      versioned
        ? 'SELECT data, revision FROM user_settings WHERE id = 1'
        : 'SELECT data FROM user_settings WHERE id = 1',
    ).get();
    return parseSettingsRow(row, { requireRevision: versioned });
  } catch (_) {
    return {
      status: UserSettingsStatus.DB_ERROR,
      settings: {},
      reason: 'USER_SETTINGS_DB_READ_FAILED',
    };
  }
}

function validateModelSettings(models) {
  if (models === undefined) {
    return { valid: true, settings: { ...DEFAULT_MODEL_SETTINGS }, reason: null };
  }
  if (!isPlainObject(models)) {
    return { valid: false, settings: { ...DEFAULT_MODEL_SETTINGS }, reason: 'MODEL_SETTINGS_NOT_OBJECT' };
  }

  const result = { ...DEFAULT_MODEL_SETTINGS };
  if ('autoFailoverEnabled' in models) {
    if (typeof models.autoFailoverEnabled !== 'boolean') {
      return { valid: false, settings: { ...DEFAULT_MODEL_SETTINGS }, reason: 'AUTO_FAILOVER_ENABLED_NOT_BOOLEAN' };
    }
    result.autoFailoverEnabled = models.autoFailoverEnabled;
  }
  if ('autoCleanupEnabled' in models) {
    if (typeof models.autoCleanupEnabled !== 'boolean') {
      return { valid: false, settings: { ...DEFAULT_MODEL_SETTINGS }, reason: 'AUTO_CLEANUP_ENABLED_NOT_BOOLEAN' };
    }
    result.autoCleanupEnabled = models.autoCleanupEnabled;
  }
  if ('autoCleanupDays' in models) {
    if (!Number.isInteger(models.autoCleanupDays)
      || models.autoCleanupDays < 1
      || models.autoCleanupDays > 3650) {
      return { valid: false, settings: { ...DEFAULT_MODEL_SETTINGS }, reason: 'AUTO_CLEANUP_DAYS_OUT_OF_RANGE' };
    }
    result.autoCleanupDays = models.autoCleanupDays;
  }

  return { valid: true, settings: result, reason: null };
}

/**
 * Pre-migration-061 compatibility reader for the retired JSON model settings.
 * Production policy consumers use model-policy.js; this helper is not a
 * versioned policy authority and cannot write through the migration guard.
 */
export function readModelSettings(db) {
  const document = readUserSettings(db);
  if (document.status !== UserSettingsStatus.VALID) {
    return {
      status: document.status,
      valid: false,
      settings: { ...DEFAULT_MODEL_SETTINGS },
      reason: document.reason,
    };
  }

  const validated = validateModelSettings(document.settings.models);
  return {
    status: validated.valid ? UserSettingsStatus.VALID : UserSettingsStatus.MALFORMED,
    valid: validated.valid,
    settings: validated.settings,
    reason: validated.reason,
  };
}

function requireDatabase(db) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw new UserSettingsError('USER_SETTINGS_DB_INVALID', 'A better-sqlite3 database is required');
  }
  return db;
}

function requireUpdater(updater) {
  if (typeof updater !== 'function') {
    throw new UserSettingsError('USER_SETTINGS_UPDATER_INVALID', 'Settings updater must be a function');
  }
}

function readCurrentSettings(db, { requireRevision = false } = {}) {
  let current;
  try {
    current = parseSettingsRow(
      db.prepare(
        requireRevision
          ? 'SELECT data, revision FROM user_settings WHERE id = 1'
          : 'SELECT data FROM user_settings WHERE id = 1',
      ).get(),
      { requireRevision },
    );
  } catch (error) {
    throw new UserSettingsError(
      'USER_SETTINGS_DB_READ_FAILED',
      'Failed to read user settings inside the transaction',
      { cause: error },
    );
  }
  if (current.status === UserSettingsStatus.MISSING) {
    if (requireRevision) {
      throw new UserSettingsError(
        'USER_SETTINGS_ROW_MISSING',
        'Versioned user settings singleton is missing',
      );
    }
    return current;
  }
  if (current.status === UserSettingsStatus.MALFORMED) {
    throw new UserSettingsError(current.reason, 'Refusing to overwrite malformed user settings');
  }
  return current;
}

function readCurrentVersionedSettingsWithRaw(db) {
  let row;
  try {
    row = db.prepare(`
      SELECT data, revision
      FROM user_settings
      WHERE id = 1
    `).get();
  } catch (error) {
    throw new UserSettingsError(
      'USER_SETTINGS_DB_READ_FAILED',
      'Failed to read versioned user settings for legacy notification census',
      { cause: error },
    );
  }
  if (!row) {
    throw new UserSettingsError(
      'USER_SETTINGS_ROW_MISSING',
      'Versioned user settings singleton is missing',
    );
  }
  let serialized;
  if (typeof row.data === 'string') {
    serialized = row.data;
  } else if (Buffer.isBuffer(row.data)) {
    try {
      serialized = new TextDecoder('utf-8', { fatal: true }).decode(row.data);
    } catch (error) {
      throw new UserSettingsError(
        'USER_SETTINGS_STORAGE_CONTRACT',
        'Versioned user settings blob must contain valid UTF-8',
        { cause: error },
      );
    }
  } else {
    throw new UserSettingsError(
      'USER_SETTINGS_STORAGE_CONTRACT',
      'Versioned user settings data must be stored as text or a legacy byte blob',
    );
  }
  const current = parseSettingsRow(
    { data: serialized, revision: row.revision },
    { requireRevision: true },
  );
  if (current.status === UserSettingsStatus.MISSING) {
    throw new UserSettingsError(
      'USER_SETTINGS_ROW_MISSING',
      'Versioned user settings singleton is missing',
    );
  }
  if (current.status === UserSettingsStatus.MALFORMED) {
    throw new UserSettingsError(
      current.reason,
      'Refusing to inspect malformed user settings',
    );
  }
  return {
    raw: row.data,
    revision: current.revision,
    settings: current.settings,
  };
}

function serializeSettingsDocument(document) {
  if (!isPlainObject(document)) {
    throw new UserSettingsError(
      'USER_SETTINGS_DOCUMENT_NOT_OBJECT',
      'Settings document must be a plain object',
    );
  }
  let serialized;
  try {
    serialized = JSON.stringify(document, (_key, current) => {
      if (typeof current === 'number' && !Number.isFinite(current)) {
        throw new TypeError('non-finite number');
      }
      if (['bigint', 'function', 'symbol', 'undefined'].includes(typeof current)) {
        throw new TypeError(`unsupported ${typeof current}`);
      }
      if (current !== null
        && typeof current === 'object'
        && !Array.isArray(current)
        && !isPlainObject(current)) {
        throw new TypeError('non-plain object');
      }
      return current;
    });
  } catch (error) {
    throw new UserSettingsError(
      'USER_SETTINGS_SERIALIZATION_FAILED',
      'Settings document could not be serialized',
      { cause: error },
    );
  }
  if (typeof serialized !== 'string') {
    throw new UserSettingsError(
      'USER_SETTINGS_SERIALIZATION_FAILED',
      'Settings document could not be serialized',
    );
  }
  return serialized;
}

function updateVersionedRowInTransaction(db, expectedRevision, document) {
  if (!db.inTransaction) {
    throw new UserSettingsError(
      'USER_SETTINGS_TRANSACTION_OWNERSHIP_REQUIRED',
      'Versioned user settings update requires an owned transaction',
    );
  }
  if (!isSafeRevision(expectedRevision)) {
    throw new UserSettingsError(
      'USER_SETTINGS_EXPECTED_REVISION_INVALID',
      'Expected revision must be a positive safe integer',
    );
  }
  if (expectedRevision === Number.MAX_SAFE_INTEGER) {
    throw new UserSettingsError(
      'USER_SETTINGS_REVISION_EXHAUSTED',
      'User settings revision cannot advance safely',
    );
  }
  const serialized = serializeSettingsDocument(document);
  let result;
  try {
    result = db.prepare(`
      UPDATE user_settings
      SET data = ?,
          updated_at = datetime('now'),
          revision = revision + 1
      WHERE id = 1 AND revision = ?
    `).run(serialized, expectedRevision);
  } catch (error) {
    throw new UserSettingsError(
      'USER_SETTINGS_DB_WRITE_FAILED',
      'Failed to persist versioned user settings',
      { cause: error },
    );
  }
  if (result.changes !== 1) {
    throw new UserSettingsError(
      'USER_SETTINGS_STORAGE_CONTRACT',
      'Versioned user settings update did not mutate exactly one row',
    );
  }
  let persisted;
  try {
    persisted = db.prepare(`
      SELECT data, revision
      FROM user_settings
      WHERE id = 1
    `).get();
  } catch (error) {
    throw new UserSettingsError(
      'USER_SETTINGS_DB_READ_FAILED',
      'Failed to verify the committed user settings row',
      { cause: error },
    );
  }
  if (!persisted
    || persisted.revision !== expectedRevision + 1
    || persisted.data !== serialized) {
    throw new UserSettingsError(
      'USER_SETTINGS_STORAGE_CONTRACT',
      'Committed user settings differ from the owned update',
    );
  }
  return {
    revision: expectedRevision + 1,
    document: clone(document),
  };
}

function runImmediate(db, callback) {
  if (db.inTransaction === true) {
    throw new UserSettingsError(
      'USER_SETTINGS_TRANSACTION_OWNERSHIP_REQUIRED',
      'Top-level user settings commits reject foreign transaction ownership',
    );
  }
  const transaction = db.transaction(callback);
  try {
    return transaction.immediate();
  } catch (error) {
    if (error instanceof UserSettingsError) throw error;
    const sqliteCode = typeof error?.code === 'string' ? error.code : '';
    if (sqliteCode.startsWith('SQLITE_BUSY') || sqliteCode.startsWith('SQLITE_LOCKED')) {
      throw new UserSettingsError(
        'USER_SETTINGS_DB_BUSY',
        'User settings storage is busy',
        { cause: error },
      );
    }
    throw new UserSettingsError(
      'USER_SETTINGS_TRANSACTION_FAILED',
      'User settings transaction failed unexpectedly',
      { cause: error },
    );
  }
}

function applyUpdater(current, updater) {
  const draft = clone(current.settings);
  let updated;
  try {
    updated = updater(draft);
  } catch (error) {
    if (error instanceof UserSettingsError) throw error;
    throw new UserSettingsError(
      'USER_SETTINGS_UPDATER_FAILED',
      'Settings updater failed before persistence',
      { cause: error },
    );
  }
  const next = updated === undefined ? draft : updated;
  serializeSettingsDocument(next);
  return next;
}

function commitLatestUserSettings(db, updater) {
  requireDatabase(db);
  requireUpdater(updater);

  return runImmediate(db, () => {
    const current = readCurrentSettings(db, { requireRevision: true });
    const next = applyUpdater(current, updater);
    return updateVersionedRowInTransaction(db, current.revision, next);
  });
}

function sha256StoredBytes(value) {
  const digest = createHash('sha256');
  if (typeof value === 'string') digest.update(value, 'utf8');
  else if (Buffer.isBuffer(value)) digest.update(value);
  else {
    throw new UserSettingsError(
      'USER_SETTINGS_STORAGE_CONTRACT',
      'Stored user settings preimage is not a supported byte representation',
    );
  }
  return digest.digest('hex');
}

function readLegacyNotificationPath(document, pathId) {
  if (pathId.startsWith('/')) {
    const [, containerKey, childKey] = pathId.split('/');
    if (!Object.hasOwn(document, containerKey)
      || !isPlainObject(document[containerKey])
      || !Object.hasOwn(document[containerKey], childKey)) {
      return Object.freeze({ present: false, value: undefined });
    }
    return Object.freeze({ present: true, value: document[containerKey][childKey] });
  }
  if (!Object.hasOwn(document, pathId)) {
    return Object.freeze({ present: false, value: undefined });
  }
  return Object.freeze({ present: true, value: document[pathId] });
}

function deleteLegacyNotificationPath(document, pathId) {
  if (pathId.startsWith('/')) {
    const [, containerKey, childKey] = pathId.split('/');
    if (isPlainObject(document[containerKey])) delete document[containerKey][childKey];
    return;
  }
  delete document[pathId];
}

function legacyNotificationValueSha256(value) {
  const normalized = cloneFiniteJson(
    value,
    'LEGACY_NOTIFICATION_SCRUB_SERIALIZATION_FAILED',
  );
  let serialized;
  try {
    serialized = JSON.stringify(normalized);
  } catch (error) {
    throw new UserSettingsError(
      'LEGACY_NOTIFICATION_SCRUB_SERIALIZATION_FAILED',
      'Legacy notification value could not be serialized',
      { cause: error },
    );
  }
  if (typeof serialized !== 'string') {
    throw new UserSettingsError(
      'LEGACY_NOTIFICATION_SCRUB_SERIALIZATION_FAILED',
      'Legacy notification value could not be serialized',
    );
  }
  return sha256StoredBytes(serialized);
}

function requireExactDataObject(value, expectedKeys, code, message) {
  if (!isPlainObject(value)) throw new UserSettingsError(code, message);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some(key => typeof key !== 'string')) {
    throw new UserSettingsError(code, message);
  }
  const actualKeys = [...ownKeys].sort();
  if (actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new UserSettingsError(code, message);
  }
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
      throw new UserSettingsError(code, message);
    }
  }
  return value;
}

function requireDenseArray(value, maximumLength, code, message) {
  if (!Array.isArray(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < 1
    || value.length > maximumLength) {
    throw new UserSettingsError(code, message);
  }
  const expectedOwnKeys = new Set(['length']);
  for (let index = 0; index < value.length; index++) {
    const key = String(index);
    expectedOwnKeys.add(key);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor
      || !Object.hasOwn(descriptor, 'value')
      || descriptor.enumerable !== true) {
      throw new UserSettingsError(code, message);
    }
  }
  if (Reflect.ownKeys(value).some(key => !expectedOwnKeys.has(key))) {
    throw new UserSettingsError(code, message);
  }
  return value;
}

function requireSha256(value, code, message) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new UserSettingsError(code, message);
  }
  return value;
}

function normalizeSelectedLegacyPaths(value, { requirePresentIn } = {}) {
  const code = 'LEGACY_NOTIFICATION_SCRUB_INPUT_INVALID';
  const paths = requireDenseArray(
    value,
    LEGACY_NOTIFICATION_USER_SETTING_PATHS.length,
    code,
    'Legacy notification scrub paths must be a non-empty dense array',
  ).map(pathId => {
    if (typeof pathId !== 'string'
      || !LEGACY_NOTIFICATION_USER_SETTING_PATH_SET.has(pathId)
      || (requirePresentIn && !requirePresentIn.has(pathId))) {
      throw new UserSettingsError(code, 'Legacy notification scrub path is unowned or absent');
    }
    return pathId;
  });
  for (let index = 1; index < paths.length; index++) {
    if (paths[index - 1] >= paths[index]) {
      throw new UserSettingsError(
        code,
        'Legacy notification scrub paths must be sorted and unique',
      );
    }
  }
  return Object.freeze(paths);
}

function normalizeLegacyNotificationPathDigests(value) {
  const code = 'LEGACY_NOTIFICATION_SCRUB_INPUT_INVALID';
  const entries = requireDenseArray(
    value,
    LEGACY_NOTIFICATION_USER_SETTING_PATHS.length,
    code,
    'Legacy notification path digests must be a non-empty dense array',
  ).map(entry => {
    requireExactDataObject(
      entry,
      ['path', 'valueSha256'],
      code,
      'Legacy notification path digest must contain exactly path and valueSha256',
    );
    if (typeof entry.path !== 'string'
      || !LEGACY_NOTIFICATION_USER_SETTING_PATH_SET.has(entry.path)) {
      throw new UserSettingsError(code, 'Legacy notification path digest is unowned');
    }
    return Object.freeze({
      path: entry.path,
      valueSha256: requireSha256(
        entry.valueSha256,
        code,
        'Legacy notification value digest must be lowercase SHA-256',
      ),
    });
  });
  for (let index = 1; index < entries.length; index++) {
    if (entries[index - 1].path >= entries[index].path) {
      throw new UserSettingsError(
        code,
        'Legacy notification path digests must be sorted and unique',
      );
    }
  }
  return Object.freeze(entries);
}

function normalizeLegacyNotificationScrubRequest(value) {
  const code = 'LEGACY_NOTIFICATION_SCRUB_INPUT_INVALID';
  requireExactDataObject(
    value,
    ['expectedRevision', 'pathDigests', 'postimageSha256', 'preimageSha256'],
    code,
    'Legacy notification scrub request has an invalid shape',
  );
  return Object.freeze({
    expectedRevision: requireExpectedRevision(value.expectedRevision),
    pathDigests: normalizeLegacyNotificationPathDigests(value.pathDigests),
    postimageSha256: requireSha256(
      value.postimageSha256,
      code,
      'Legacy notification postimage digest must be lowercase SHA-256',
    ),
    preimageSha256: requireSha256(
      value.preimageSha256,
      code,
      'Legacy notification preimage digest must be lowercase SHA-256',
    ),
  });
}

function createLegacyNotificationCensus(current) {
  const capturedDocument = clone(current.settings);
  const capturedValues = new Map();
  const pathDescriptors = [];
  for (const pathId of LEGACY_NOTIFICATION_USER_SETTING_PATHS) {
    const state = readLegacyNotificationPath(capturedDocument, pathId);
    if (!state.present) continue;
    capturedValues.set(pathId, clone(state.value));
    pathDescriptors.push(Object.freeze({
      path: pathId,
      valueSha256: legacyNotificationValueSha256(state.value),
    }));
  }
  const frozenPathDescriptors = Object.freeze(pathDescriptors);
  const presentPathSet = new Set(capturedValues.keys());
  const preimageSha256 = sha256StoredBytes(current.raw);

  const census = Object.create(null);
  Object.defineProperties(census, {
    revision: {
      enumerable: false,
      value: () => current.revision,
    },
    preimageSha256: {
      enumerable: false,
      value: () => preimageSha256,
    },
    paths: {
      enumerable: false,
      value: () => frozenPathDescriptors,
    },
    value: {
      enumerable: false,
      value: pathId => {
        if (typeof pathId !== 'string'
          || !LEGACY_NOTIFICATION_USER_SETTING_PATH_SET.has(pathId)) {
          throw new UserSettingsError(
            'LEGACY_NOTIFICATION_CENSUS_PATH_UNOWNED',
            'Legacy notification census raw access requires an exact owned path',
          );
        }
        return capturedValues.has(pathId) ? clone(capturedValues.get(pathId)) : undefined;
      },
    },
    scrubRequest: {
      enumerable: false,
      value: (selectedPaths = [...presentPathSet]) => {
        const paths = normalizeSelectedLegacyPaths(selectedPaths, {
          requirePresentIn: presentPathSet,
        });
        const next = clone(capturedDocument);
        const pathDigests = [];
        for (const pathId of paths) {
          deleteLegacyNotificationPath(next, pathId);
          pathDigests.push(Object.freeze({
            path: pathId,
            valueSha256: legacyNotificationValueSha256(capturedValues.get(pathId)),
          }));
        }
        const serializedPostimage = serializeSettingsDocument(next);
        return Object.freeze({
          expectedRevision: current.revision,
          pathDigests: Object.freeze(pathDigests),
          postimageSha256: sha256StoredBytes(serializedPostimage),
          preimageSha256,
        });
      },
    },
  });
  Object.freeze(census);
  brandedLegacyNotificationCensuses.add(census);
  return census;
}

export function readLegacyNotificationUserSettingsCensus(db) {
  requireDatabase(db);
  if (!hasRevisionColumn(db)) {
    throw new UserSettingsError(
      'USER_SETTINGS_STORAGE_CONTRACT',
      'Legacy notification census requires versioned user settings authority',
    );
  }
  return createLegacyNotificationCensus(readCurrentVersionedSettingsWithRaw(db));
}

export function requireLegacyNotificationUserSettingsCensus(value) {
  if ((typeof value !== 'object' && typeof value !== 'function')
    || value === null
    || !Object.isFrozen(value)
    || !brandedLegacyNotificationCensuses.has(value)) {
    throw new UserSettingsError(
      'LEGACY_NOTIFICATION_CENSUS_INVALID',
      'A branded legacy notification census is required',
    );
  }
  return value;
}

export function scrubLegacyNotificationUserSettingsInTransaction(db, request) {
  requireDatabase(db);
  const input = normalizeLegacyNotificationScrubRequest(request);
  if (db.inTransaction !== true) {
    throw new UserSettingsError(
      'USER_SETTINGS_TRANSACTION_OWNERSHIP_REQUIRED',
      'Legacy notification scrub requires caller-owned BEGIN IMMEDIATE',
    );
  }
  if (!hasRevisionColumn(db)) {
    throw new UserSettingsError(
      'USER_SETTINGS_STORAGE_CONTRACT',
      'Legacy notification scrub requires versioned user settings authority',
    );
  }

  const scrubSavepoint = db.transaction(() => {
    const current = readCurrentVersionedSettingsWithRaw(db);
    const currentSha256 = sha256StoredBytes(current.raw);
    const selectedPathsAbsent = input.pathDigests.every(
      entry => !readLegacyNotificationPath(current.settings, entry.path).present,
    );
    if (currentSha256 === input.postimageSha256 && selectedPathsAbsent) {
      return Object.freeze({
        status: 'ALREADY_APPLIED',
        revision: current.revision,
        postimageSha256: currentSha256,
        scrubbedPaths: Object.freeze(input.pathDigests.map(entry => entry.path)),
      });
    }
    if (current.revision !== input.expectedRevision) {
      throw new UserSettingsError(
        'USER_SETTINGS_REVISION_CONFLICT',
        'User settings changed since the legacy notification census',
        {
          details: {
            expectedRevision: input.expectedRevision,
            currentRevision: current.revision,
          },
        },
      );
    }
    if (currentSha256 !== input.preimageSha256) {
      throw new UserSettingsError(
        'LEGACY_NOTIFICATION_SCRUB_PREIMAGE_MISMATCH',
        'Legacy notification scrub preimage changed',
      );
    }

    const next = clone(current.settings);
    for (const entry of input.pathDigests) {
      const state = readLegacyNotificationPath(current.settings, entry.path);
      if (!state.present
        || legacyNotificationValueSha256(state.value) !== entry.valueSha256) {
        throw new UserSettingsError(
          'LEGACY_NOTIFICATION_SCRUB_PATH_MISMATCH',
          'Legacy notification scrub path changed or disappeared',
          { details: { path: entry.path } },
        );
      }
      deleteLegacyNotificationPath(next, entry.path);
    }

    const serializedPostimage = serializeSettingsDocument(next);
    const predictedPostimageSha256 = sha256StoredBytes(serializedPostimage);
    if (predictedPostimageSha256 !== input.postimageSha256) {
      throw new UserSettingsError(
        'LEGACY_NOTIFICATION_SCRUB_POSTIMAGE_MISMATCH',
        'Legacy notification scrub postimage does not match the approved manifest',
      );
    }
    const committed = updateVersionedRowInTransaction(
      db,
      current.revision,
      next,
    );
    return Object.freeze({
      status: 'APPLIED',
      revision: committed.revision,
      postimageSha256: predictedPostimageSha256,
      scrubbedPaths: Object.freeze(input.pathDigests.map(entry => entry.path)),
    });
  });

  try {
    return scrubSavepoint();
  } catch (error) {
    if (error instanceof UserSettingsError) throw error;
    throw new UserSettingsError(
      'USER_SETTINGS_TRANSACTION_FAILED',
      'Legacy notification scrub transaction failed unexpectedly',
      { cause: error },
    );
  }
}

function requireExpectedRevision(value) {
  if (!isSafeRevision(value)) {
    throw new UserSettingsError(
      'USER_SETTINGS_EXPECTED_REVISION_INVALID',
      'Expected revision must be a positive safe integer',
    );
  }
  return value;
}

function requireExactGenericCommitInput(value) {
  if (!isPlainObject(value)) {
    throw new UserSettingsError('USER_SETTINGS_INPUT_INVALID', 'Settings commit must be an object');
  }
  const expectedKeys = ['expectedRevision', 'patch'];
  const actualKeys = Object.keys(value).sort();
  if (actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new UserSettingsError(
      'USER_SETTINGS_INPUT_INVALID',
      'Settings commit must contain exactly expectedRevision and patch',
    );
  }
  return {
    expectedRevision: requireExpectedRevision(value.expectedRevision),
    patch: requirePlainSettingsPatch(value.patch, 'USER_SETTINGS_INPUT_INVALID'),
  };
}

function normalizeGenericPatch(patch) {
  const entries = [];
  const unowned = [];

  for (const [key, rawValue] of Object.entries(patch)) {
    if (GENERIC_FLAT_SETTING_KEY_SET.has(key)) {
      entries.push({ path: key, segments: [key], value: cloneFiniteJson(rawValue) });
      continue;
    }

    const allowedChildren = GENERIC_NESTED_SETTING_KEYS.get(key);
    if (!allowedChildren || !isPlainObject(rawValue)) {
      unowned.push(key);
      continue;
    }
    for (const [child, value] of Object.entries(rawValue)) {
      const path = `/${key}/${child}`;
      if (!allowedChildren.has(child)) {
        unowned.push(path);
        continue;
      }
      entries.push({ path, segments: [key, child], value: cloneFiniteJson(value) });
    }
  }

  if (unowned.length > 0) {
    throw new UserSettingsError(
      'USER_SETTINGS_PATH_UNOWNED',
      'Generic settings patch contains an unowned path',
      { details: { paths: [...new Set(unowned)].sort() } },
    );
  }
  return entries;
}

function applyGenericEntries(document, entries) {
  for (const entry of entries) {
    if (entry.segments.length === 1) {
      setOwn(document, entry.segments[0], clone(entry.value));
      continue;
    }
    const [containerKey, childKey] = entry.segments;
    const existing = Object.hasOwn(document, containerKey) && isPlainObject(document[containerKey])
      ? clone(document[containerKey])
      : {};
    setOwn(existing, childKey, clone(entry.value));
    setOwn(document, containerKey, existing);
  }
}

function removeOwnedResetSettings(document) {
  const next = clone(document);
  for (const key of GENERIC_FLAT_SETTING_KEYS) delete next[key];
  for (const [containerKey, allowedChildren] of GENERIC_NESTED_SETTING_KEYS) {
    if (!isPlainObject(next[containerKey])) continue;
    for (const childKey of allowedChildren) delete next[containerKey][childKey];
    if (Object.keys(next[containerKey]).length === 0) delete next[containerKey];
  }
  delete next.storage;
  return next;
}

export function projectPublicUserSettings(document) {
  if (!isPlainObject(document)) {
    throw new UserSettingsError(
      'USER_SETTINGS_DOCUMENT_NOT_OBJECT',
      'Stored user settings must be an object',
    );
  }
  const projected = {};
  for (const key of GENERIC_FLAT_SETTING_KEYS) {
    if (Object.hasOwn(document, key)) setOwn(projected, key, clone(document[key]));
  }
  for (const [containerKey, allowedChildren] of GENERIC_NESTED_SETTING_KEYS) {
    if (!Object.hasOwn(document, containerKey) || !isPlainObject(document[containerKey])) continue;
    const container = {};
    for (const childKey of allowedChildren) {
      if (Object.hasOwn(document[containerKey], childKey)) {
        setOwn(container, childKey, clone(document[containerKey][childKey]));
      }
    }
    if (Object.keys(container).length > 0) setOwn(projected, containerKey, container);
  }
  return projected;
}

/**
 * Validate one mobile-safe UX preference and return the narrow patch shape
 * consumed by `commitGeneric`. Keeping this adapter beside the repository
 * prevents remote providers from reaching through the core settings boundary.
 */
export function createPortableUserSettingsPatch(path, value) {
  if (typeof path !== 'string' || !SETTINGS_PORTABLE_PATHS.includes(path)) {
    throw new UserSettingsError(
      'USER_SETTINGS_PORTABLE_PATH_INVALID',
      'Setting path is outside the portable UX profile',
    );
  }
  return mergeSettingsProjection({}, { [path]: value }).document;
}

export class UserSettingsRepository {
  constructor(db) {
    this.db = requireDatabase(db);
    if (!hasRevisionColumn(this.db)) {
      throw new UserSettingsError(
        'USER_SETTINGS_STORAGE_CONTRACT',
        'User settings revision authority is not installed',
      );
    }
  }

  readPublic() {
    const current = readCurrentSettings(this.db, { requireRevision: true });
    return {
      revision: current.revision,
      settings: projectPublicUserSettings(current.settings),
    };
  }

  commitGeneric(value) {
    const input = requireExactGenericCommitInput(value);
    const entries = normalizeGenericPatch(input.patch);
    return runImmediate(this.db, () => {
      const current = readCurrentSettings(this.db, { requireRevision: true });
      if (current.revision !== input.expectedRevision) {
        throw new UserSettingsError(
          'USER_SETTINGS_REVISION_CONFLICT',
          'User settings changed since the client read them',
          {
            details: {
              expectedRevision: input.expectedRevision,
              currentRevision: current.revision,
            },
          },
        );
      }
      if (entries.length === 0) {
        return {
          revision: current.revision,
          settings: projectPublicUserSettings(current.settings),
        };
      }
      const next = clone(current.settings);
      applyGenericEntries(next, entries);
      const committed = updateVersionedRowInTransaction(
        this.db,
        current.revision,
        next,
      );
      return {
        revision: committed.revision,
        settings: projectPublicUserSettings(committed.document),
      };
    });
  }

  commitStorage(storage) {
    const ownedStorage = cloneFiniteJson(storage, 'USER_SETTINGS_INPUT_INVALID');
    const committed = commitLatestUserSettings(this.db, (document) => {
      setOwn(document, 'storage', ownedStorage);
    });
    return { revision: committed.revision, storage: clone(ownedStorage) };
  }

  readImportSnapshotInTransaction() {
    if (!this.db.inTransaction) {
      throw new UserSettingsError(
        'USER_SETTINGS_TRANSACTION_OWNERSHIP_REQUIRED',
        'Import snapshot requires the caller-owned transaction',
      );
    }
    const current = readCurrentSettings(this.db, { requireRevision: true });
    return { revision: current.revision, document: clone(current.settings) };
  }

  readResetSnapshotInTransaction() {
    if (!this.db.inTransaction) {
      throw new UserSettingsError(
        'USER_SETTINGS_TRANSACTION_OWNERSHIP_REQUIRED',
        'Settings reset snapshot requires the caller-owned transaction',
      );
    }
    const current = readCurrentSettings(this.db, { requireRevision: true });
    return { revision: current.revision, document: clone(current.settings) };
  }

  applyPortableImportInTransaction({ expectedRevision, portableValues }) {
    if (!this.db.inTransaction) {
      throw new UserSettingsError(
        'USER_SETTINGS_TRANSACTION_OWNERSHIP_REQUIRED',
        'Portable import requires the caller-owned transaction',
      );
    }
    const current = readCurrentSettings(this.db, { requireRevision: true });
    const requiredRevision = requireExpectedRevision(expectedRevision);
    if (current.revision !== requiredRevision) {
      throw new UserSettingsError(
        'USER_SETTINGS_REVISION_CONFLICT',
        'User settings changed since the import destination was read',
        {
          details: {
            expectedRevision: requiredRevision,
            currentRevision: current.revision,
          },
        },
      );
    }
    const merged = mergeSettingsProjection(current.settings, portableValues);
    const committed = updateVersionedRowInTransaction(
      this.db,
      current.revision,
      merged.document,
    );
    return {
      revision: committed.revision,
      document: committed.document,
      settings: projectPublicUserSettings(committed.document),
      appliedPortablePaths: merged.appliedPortablePaths,
      preservedLocalPaths: merged.preservedLocalPaths,
    };
  }

  resetOwnedInTransaction({ expectedRevision }) {
    if (!this.db.inTransaction) {
      throw new UserSettingsError(
        'USER_SETTINGS_TRANSACTION_OWNERSHIP_REQUIRED',
        'Settings reset requires the caller-owned transaction',
      );
    }
    const current = readCurrentSettings(this.db, { requireRevision: true });
    const requiredRevision = requireExpectedRevision(expectedRevision);
    if (current.revision !== requiredRevision) {
      throw new UserSettingsError(
        'USER_SETTINGS_REVISION_CONFLICT',
        'User settings changed since the reset snapshot was read',
        {
          details: {
            expectedRevision: requiredRevision,
            currentRevision: current.revision,
          },
        },
      );
    }
    return updateVersionedRowInTransaction(
      this.db,
      current.revision,
      removeOwnedResetSettings(current.settings),
    );
  }
}

export function createUserSettingsRepository(db) {
  return new UserSettingsRepository(db);
}
