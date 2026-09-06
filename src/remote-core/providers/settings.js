import { Buffer } from 'node:buffer';

import {
  createPortableUserSettingsPatch,
  createUserSettingsRepository,
} from '../../db/user-settings.js';

const MAX_PUBLIC_SETTINGS_BYTES = 256 * 1024;

/** Core-owned read projection of the public, non-secret settings allow-list. */
export function createSettingsReadProvider(rawDb) {
  if (!rawDb || typeof rawDb.prepare !== 'function' || typeof rawDb.transaction !== 'function') {
    throw new TypeError('settings provider requires a transactional database handle');
  }
  return async input => {
    if (input.operation !== 'read' || Object.keys(input).length !== 1) {
      return { ok: false, error: { code: 'operation_invalid' } };
    }
    try {
      const projected = createUserSettingsRepository(rawDb).readPublic();
      if (Buffer.byteLength(JSON.stringify(projected), 'utf8') > MAX_PUBLIC_SETTINGS_BYTES) {
        return { ok: false, error: { code: 'settings_projection_too_large' } };
      }
      return { ok: true, data: projected };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'settings_read_failed',
          details: {
            sourceCode: typeof error?.code === 'string' ? error.code : 'USER_SETTINGS_DB_READ_FAILED',
          },
        },
      };
    }
  };
}

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactWriteInput(input) {
  if (!isPlainRecord(input)) return false;
  const keys = Object.keys(input).sort();
  return keys.length === 4
    && keys[0] === 'expectedRevision'
    && keys[1] === 'operation'
    && keys[2] === 'path'
    && keys[3] === 'value';
}

/**
 * Core-owned write adapter for the UX_PREFERENCES_V1 allow-list.
 *
 * This deliberately does not expose `commitGeneric` as a generic mobile
 * escape hatch. The portability profile supplies both the exact path set and
 * value validators; the user-settings repository remains the revision and
 * transaction authority and preserves every unrelated setting.
 */
export function createSettingsWriteProvider(rawDb) {
  if (!rawDb || typeof rawDb.prepare !== 'function' || typeof rawDb.transaction !== 'function') {
    throw new TypeError('settings provider requires a transactional database handle');
  }
  return async input => {
    if (!exactWriteInput(input) || input.operation !== 'write') {
      return { ok: false, error: { code: 'operation_invalid' } };
    }
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
      return { ok: false, error: { code: 'settings_revision_invalid' } };
    }
    try {
      // Merging into an empty document validates the value and yields the
      // narrow patch shape expected by the core repository. Dotted setting
      // names remain literal top-level keys; slash paths become nested leaves.
      const patch = createPortableUserSettingsPatch(input.path, input.value);
      const committed = createUserSettingsRepository(rawDb).commitGeneric({
        expectedRevision: input.expectedRevision,
        patch,
      });
      if (Buffer.byteLength(JSON.stringify(committed.settings), 'utf8') > MAX_PUBLIC_SETTINGS_BYTES) {
        // The transaction has committed by this point. Throwing would make the
        // caller classify the outcome as ambiguous, which is more honest than
        // returning an oversized success body. In normal operation the public
        // read projection enforces the same cap before a write is attempted.
        throw Object.assign(new Error('settings projection too large'), {
          code: 'SETTINGS_PROJECTION_TOO_LARGE_AFTER_COMMIT',
        });
      }
      return {
        ok: true,
        data: {
          revision: committed.revision,
          path: input.path,
          value: input.value,
        },
      };
    } catch (error) {
      if (error?.code === 'USER_SETTINGS_REVISION_CONFLICT') {
        return {
          ok: false,
          error: {
            code: 'settings_revision_conflict',
            details: {
              currentRevision: error.details?.currentRevision ?? null,
            },
          },
        };
      }
      if (error?.code === 'SETTINGS_PORTABILITY_VALUE_INVALID') {
        return { ok: false, error: { code: 'setting_value_invalid' } };
      }
      if (error?.code === 'SETTINGS_PORTABILITY_PROJECTION_INVALID'
          || error?.code === 'USER_SETTINGS_PORTABLE_PATH_INVALID') {
        return { ok: false, error: { code: 'setting_path_invalid' } };
      }
      // A post-commit size failure must escape: the gateway then records
      // UNKNOWN instead of incorrectly asserting that no effect happened.
      if (error?.code === 'SETTINGS_PROJECTION_TOO_LARGE_AFTER_COMMIT') throw error;
      return {
        ok: false,
        error: {
          code: 'settings_write_failed',
          details: {
            sourceCode: typeof error?.code === 'string' ? error.code : 'USER_SETTINGS_DB_WRITE_FAILED',
          },
        },
      };
    }
  };
}

export default createSettingsReadProvider;
