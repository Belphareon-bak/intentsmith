import { Buffer } from 'node:buffer';

import { createWorkerMobileReadModel } from '../../agents/mobile-read-model.js';

const MAX_PROJECTION_BYTES = 512 * 1024;
const INPUT_KEYS = new Set(['operation', 'limit', 'offset']);

export function createWorkersReadProvider(rawDb) {
  const repository = createWorkerMobileReadModel(rawDb);
  return async input => {
    if (input.operation !== 'list' || Object.keys(input).some(key => !INPUT_KEYS.has(key))) {
      return { ok: false, error: { code: 'operation_invalid' } };
    }
    try {
      const data = { rows: repository.list({ limit: input.limit, offset: input.offset }) };
      if (Buffer.byteLength(JSON.stringify(data), 'utf8') > MAX_PROJECTION_BYTES) {
        return { ok: false, error: { code: 'workers_projection_too_large' } };
      }
      return { ok: true, data };
    } catch (error) {
      const known = {
        WORKER_LIMIT_INVALID: 'limit_invalid',
        WORKER_CURSOR_INVALID: 'cursor_invalid',
        WORKER_DEFINITION_INVALID: 'worker_record_invalid',
        WORKER_RECORD_INVALID: 'worker_record_invalid',
        WORKER_RUN_STATUS_INVALID: 'worker_record_invalid',
      }[error?.code];
      return { ok: false, error: { code: known || 'workers_read_failed' } };
    }
  };
}

export default createWorkersReadProvider;
