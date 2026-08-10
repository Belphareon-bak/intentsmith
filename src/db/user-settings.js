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

const MODEL_SETTING_KEYS = new Set(Object.keys(DEFAULT_MODEL_SETTINGS));

export const NOTIFICATION_SETTING_FIELD_MAP = Object.freeze({
  emailEnabled: 'c3.notif.emailEnabled',
  smtpHost: 'c3.notif.smtpHost',
  smtpPort: 'c3.notif.smtpPort',
  smtpUser: 'c3.notif.smtpUser',
  smtpPass: 'c3.notif.smtpPass',
  smtpFrom: 'c3.notif.smtpFrom',
  emailRecipient: 'c3.notif.emailRecipient',
  emailOnLifecycle: 'c3.notif.emailOnLifecycle',
  emailOnWorker: 'c3.notif.emailOnWorker',
});

export const NOTIFICATION_SETTING_KEYS = Object.freeze(
  Object.values(NOTIFICATION_SETTING_FIELD_MAP),
);

const NOTIFICATION_SETTING_KEY_SET = new Set(NOTIFICATION_SETTING_KEYS);

export class UserSettingsError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'UserSettingsError';
    this.code = code;
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

function parseSettingsRow(row) {
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
    return {
      status: UserSettingsStatus.VALID,
      settings,
      reason: null,
    };
  } catch (_) {
    return {
      status: UserSettingsStatus.MALFORMED,
      settings: {},
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
    const row = db.prepare('SELECT data FROM user_settings WHERE id = 1').get();
    return parseSettingsRow(row);
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

/**
 * Atomically update the complete settings document while preserving unrelated
 * sections. Malformed persisted JSON is never overwritten implicitly.
 */
export function updateUserSettings(db, updater) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw new UserSettingsError('USER_SETTINGS_DB_INVALID', 'A better-sqlite3 database is required');
  }
  if (typeof updater !== 'function') {
    throw new UserSettingsError('USER_SETTINGS_UPDATER_INVALID', 'Settings updater must be a function');
  }

  const write = db.transaction(() => {
    let current;
    try {
      current = parseSettingsRow(
        db.prepare('SELECT data FROM user_settings WHERE id = 1').get(),
      );
    } catch (error) {
      throw new UserSettingsError(
        'USER_SETTINGS_DB_READ_FAILED',
        'Failed to read user settings inside the update transaction',
        { cause: error },
      );
    }
    if (current.status === UserSettingsStatus.MALFORMED) {
      throw new UserSettingsError(current.reason, 'Refusing to overwrite malformed user settings');
    }

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
    if (!isPlainObject(next)) {
      throw new UserSettingsError(
        'USER_SETTINGS_DOCUMENT_NOT_OBJECT',
        'Settings updater must return a plain object',
      );
    }

    let serialized;
    try {
      serialized = JSON.stringify(next);
    } catch (error) {
      throw new UserSettingsError(
        'USER_SETTINGS_SERIALIZATION_FAILED',
        'Settings document could not be serialized',
        { cause: error },
      );
    }
    try {
      db.prepare(`
        INSERT INTO user_settings (id, data, updated_at)
        VALUES (1, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          data = excluded.data,
          updated_at = excluded.updated_at
      `).run(serialized);
    } catch (error) {
      throw new UserSettingsError(
        'USER_SETTINGS_DB_WRITE_FAILED',
        'Failed to persist user settings',
        { cause: error },
      );
    }

    return clone(next);
  });

  try {
    // Acquire the SQLite write reservation before the read so a second DB
    // connection cannot interleave another read-modify-write and lose keys.
    return write.immediate();
  } catch (error) {
    if (error instanceof UserSettingsError) throw error;
    throw new UserSettingsError(
      'USER_SETTINGS_TRANSACTION_FAILED',
      'User settings transaction failed unexpectedly',
      { cause: error },
    );
  }
}

/**
 * Atomically merge the generic top-level settings surface while preserving
 * every field absent from the request. The nine notification fields are owned
 * exclusively by the typed notification route and are ignored here by exact
 * key, never by prefix.
 */
export function mergeGenericUserSettings(db, patch) {
  requirePlainSettingsPatch(patch, 'USER_SETTINGS_INPUT_INVALID');

  const ignoredNotificationKeys = NOTIFICATION_SETTING_KEYS.filter(
    key => Object.hasOwn(patch, key),
  );
  const genericEntries = Object.entries(patch).filter(
    ([key]) => !NOTIFICATION_SETTING_KEY_SET.has(key),
  );

  const document = updateUserSettings(db, (draft) => {
    for (const [key, value] of genericEntries) {
      setOwn(draft, key, clone(value));
    }
  });

  return {
    document,
    ignoredNotificationKeys,
  };
}

/**
 * Atomically apply only the notification route's exact nine-field map. The
 * masked SMTP password is a preserve instruction, not a persisted value.
 */
export function updateNotificationUserSettings(db, patch) {
  requirePlainSettingsPatch(patch, 'NOTIFICATION_SETTINGS_INPUT_INVALID');

  return updateUserSettings(db, (document) => {
    for (const [field, settingKey] of Object.entries(NOTIFICATION_SETTING_FIELD_MAP)) {
      if (Object.hasOwn(patch, field) && patch[field] !== '*****') {
        setOwn(document, settingKey, clone(patch[field]));
      }
    }
  });
}

/**
 * Pre-migration-061 compatibility writer. Unknown model keys and all unrelated
 * document sections are retained, but a migrated database rejects the retired
 * automation keys at the storage boundary.
 */
export function updateModelSettings(db, patch) {
  if (!isPlainObject(patch)) {
    throw new UserSettingsError('MODEL_SETTINGS_PATCH_INVALID', 'Model settings patch must be an object');
  }
  for (const key of Object.keys(patch)) {
    if (!MODEL_SETTING_KEYS.has(key)) {
      throw new UserSettingsError('MODEL_SETTINGS_KEY_UNKNOWN', `Unknown model setting: ${key}`);
    }
  }

  let persistedModels;
  updateUserSettings(db, (document) => {
    const existing = document.models;
    if (existing !== undefined && !isPlainObject(existing)) {
      throw new UserSettingsError('MODEL_SETTINGS_NOT_OBJECT', 'Refusing to overwrite malformed model settings');
    }

    const candidate = { ...(existing || {}), ...patch };
    const validated = validateModelSettings(candidate);
    if (!validated.valid) {
      throw new UserSettingsError(validated.reason, 'Invalid model settings patch');
    }

    document.models = candidate;
    persistedModels = { ...validated.settings };
  });
  return persistedModels;
}
