import { Buffer } from 'node:buffer';

import { createWorkerMobileReadModel } from '../../agents/mobile-read-model.js';

const MAX_PROJECTION_BYTES = 512 * 1024;
const INPUT_KEYS = new Set(['operation', 'limit', 'offset']);
const TOGGLE_INPUT_KEYS = new Set(['operation', 'id', 'expectedEnabled', 'enabled']);

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

export function createWorkersToggleProvider(upstream) {
  if (!upstream || typeof upstream.setWorkerEnabled !== 'function') {
    throw new TypeError('worker toggle provider requires a lifecycle upstream');
  }
  return async input => {
    if (
      input.operation !== 'setEnabled'
      || Object.keys(input).some(key => !TOGGLE_INPUT_KEYS.has(key))
      || Object.keys(input).length !== TOGGLE_INPUT_KEYS.size
    ) {
      return { ok: false, error: { code: 'operation_invalid' } };
    }
    if (
      typeof input.id !== 'string'
      || input.id.length < 1
      || input.id.length > 128
      || input.id !== input.id.trim()
      || /[\u0000-\u001f\u007f]/u.test(input.id)
    ) {
      return { ok: false, error: { code: 'worker_id_invalid' } };
    }
    if (
      typeof input.expectedEnabled !== 'boolean'
      || typeof input.enabled !== 'boolean'
      || input.expectedEnabled === input.enabled
    ) {
      return { ok: false, error: { code: 'worker_transition_invalid' } };
    }

    let result;
    try {
      result = await upstream.setWorkerEnabled({
        id: input.id,
        expectedEnabled: input.expectedEnabled,
        enabled: input.enabled,
      });
    } catch {
      return { ok: false, error: { code: 'upstream_unreachable', details: { decided: false } } };
    }
    if (!result?.ok) {
      return {
        ok: false,
        error: {
          code: typeof result?.code === 'string' ? result.code : 'upstream_unreachable',
          details: { decided: result?.decided === true },
        },
      };
    }
    return { ok: true, data: result.data };
  };
}

export default createWorkersReadProvider;
