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

export default createStoredInformationReadProvider;
