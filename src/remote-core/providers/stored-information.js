import { Buffer } from 'node:buffer';

import { createStoredInformationRepository } from '../../memory/stored-information.js';

const MAX_STORED_INFORMATION_BYTES = 512 * 1024;
const INPUT_KEYS = new Set(['operation', 'kind', 'limit', 'offset']);

/** Core-owned implementation of the read-only stored-information projection. */
export function createStoredInformationReadProvider(rawDb) {
  const repository = createStoredInformationRepository(rawDb);
  return async input => {
    if (
      input.operation !== 'list'
      || Object.keys(input).some(key => !INPUT_KEYS.has(key))
    ) {
      return { ok: false, error: { code: 'operation_invalid' } };
    }
    try {
      const rows = repository.list({
        kind: input.kind,
        limit: input.limit,
        offset: input.offset,
      });
      const data = { rows };
      if (Buffer.byteLength(JSON.stringify(data), 'utf8') > MAX_STORED_INFORMATION_BYTES) {
        return { ok: false, error: { code: 'stored_information_projection_too_large' } };
      }
      return { ok: true, data };
    } catch (error) {
      const known = {
        STORED_INFORMATION_KIND_INVALID: 'kind_invalid',
        STORED_INFORMATION_LIMIT_INVALID: 'limit_invalid',
        STORED_INFORMATION_CURSOR_INVALID: 'cursor_invalid',
        STORED_INFORMATION_CLOCK_INVALID: 'clock_invalid',
        STORED_INFORMATION_VALUE_INVALID: 'stored_information_value_invalid',
      }[error?.code];
      return { ok: false, error: { code: known || 'stored_information_read_failed' } };
    }
  };
}

const MANUAL_CATEGORIES = new Set(['preference', 'project', 'style', 'correction']);
const MAX_MANUAL_VALUE_BYTES = 8 * 1024;
const WRITE_INPUT_KEYS = new Set(['operation', 'category', 'key', 'value']);

function validManualKey(value) {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 128
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validManualValue(value) {
  return typeof value === 'string'
    && value.trim().length > 0
    && Buffer.byteLength(value, 'utf8') <= MAX_MANUAL_VALUE_BYTES;
}

/** Core-owned create-only adapter for explicit, user-facing LTM facts. */
export function createStoredInformationWriteProvider(rawDb) {
  if (!rawDb || typeof rawDb.prepare !== 'function') {
    throw new TypeError('stored information provider requires a database handle');
  }
  const repository = createStoredInformationRepository(rawDb);

  return async input => {
    if (
      input.operation !== 'create'
      || Object.keys(input).some(key => !WRITE_INPUT_KEYS.has(key))
      || Object.keys(input).length !== WRITE_INPUT_KEYS.size
    ) {
      return { ok: false, error: { code: 'operation_invalid' } };
    }
    if (!MANUAL_CATEGORIES.has(input.category)) {
      return { ok: false, error: { code: 'memory_category_invalid' } };
    }
    if (!validManualKey(input.key)) {
      return { ok: false, error: { code: 'memory_key_invalid' } };
    }
    if (!validManualValue(input.value)) {
      return { ok: false, error: { code: 'memory_value_invalid' } };
    }

    let created;
    try {
      created = repository.createManual({
        category: input.category,
        key: input.key,
        value: input.value,
      });
    } catch (error) {
      return {
        ok: false,
        error: {
          code: error?.code === 'STORED_INFORMATION_ALREADY_EXISTS'
            ? 'memory_key_conflict'
            : 'stored_information_write_failed',
        },
      };
    }
    return {
      ok: true,
      data: {
        id: `ltm:${created.id}`,
        kind: 'ltm',
        category: input.category,
        key: input.key,
      },
    };
  };
}

export default createStoredInformationReadProvider;
