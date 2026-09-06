import { Buffer } from 'node:buffer';

import { createSpecialistMobileReadModel } from '../../specialists/mobile-read-model.js';

const MAX_PROJECTION_BYTES = 512 * 1024;
const LIST_INPUT_KEYS = new Set(['operation', 'limit', 'offset']);
const DETAIL_INPUT_KEYS = new Set(['operation', 'id']);

function validSpecialistId(value) {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 128
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

export function createSpecialistsReadProvider(rawDb) {
  const repository = createSpecialistMobileReadModel(rawDb);
  return async input => {
    const keys = Object.keys(input);
    const list = input.operation === 'list'
      && keys.length === LIST_INPUT_KEYS.size
      && !keys.some(key => !LIST_INPUT_KEYS.has(key));
    const detail = input.operation === 'detail'
      && keys.length === DETAIL_INPUT_KEYS.size
      && !keys.some(key => !DETAIL_INPUT_KEYS.has(key));
    if (!list && !detail) {
      return { ok: false, error: { code: 'operation_invalid' } };
    }
    try {
      let data;
      if (list) {
        data = { rows: repository.list({ limit: input.limit, offset: input.offset }) };
      } else {
        if (!validSpecialistId(input.id)) {
          return { ok: false, error: { code: 'specialist_id_invalid' } };
        }
        const specialist = repository.get(input.id);
        if (!specialist) return { ok: false, error: { code: 'not_found' } };
        data = { specialist };
      }
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
