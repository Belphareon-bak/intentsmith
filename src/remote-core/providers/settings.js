import { Buffer } from 'node:buffer';

import { createUserSettingsRepository } from '../../db/user-settings.js';

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

export default createSettingsReadProvider;
