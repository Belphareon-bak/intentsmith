import { Buffer } from 'node:buffer';

import { createSpecialistMobileReadModel } from '../../specialists/mobile-read-model.js';

const MAX_PROJECTION_BYTES = 512 * 1024;
const INPUT_KEYS = new Set(['operation', 'limit', 'offset']);

export function createSpecialistsReadProvider(rawDb) {
  const repository = createSpecialistMobileReadModel(rawDb);
  return async input => {
    if (input.operation !== 'list' || Object.keys(input).some(key => !INPUT_KEYS.has(key))) {
      return { ok: false, error: { code: 'operation_invalid' } };
    }
    try {
      const data = { rows: repository.list({ limit: input.limit, offset: input.offset }) };
      if (Buffer.byteLength(JSON.stringify(data), 'utf8') > MAX_PROJECTION_BYTES) {
        return { ok: false, error: { code: 'specialists_projection_too_large' } };
      }
      return { ok: true, data };
    } catch (error) {
      const known = {
        SPECIALIST_LIMIT_INVALID: 'limit_invalid',
        SPECIALIST_CURSOR_INVALID: 'cursor_invalid',
        SPECIALIST_RECORD_INVALID: 'specialist_record_invalid',
      }[error?.code];
      return { ok: false, error: { code: known || 'specialists_read_failed' } };
    }
  };
}

export default createSpecialistsReadProvider;
