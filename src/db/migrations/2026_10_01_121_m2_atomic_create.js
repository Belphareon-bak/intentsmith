import { createHash } from 'node:crypto';
import {
  EXPECTED_M2_FILE_LIST_OUTPUT_FINGERPRINT_V110,
  computeM2FileListOutputFingerprintV110,
} from './2026_09_10_110_m2_file_list_outputs.js';
import { registerM2EffectCurrentFunctions } from '../../effects/effect-current-functions.js';
import { registerM2CreateToolProjectionFunction } from '../../tools/m2-tool-authority-repository.js';

export const version = '2026_10_01_121_m2_atomic_create';
export const description = 'Bind create-only EffectRequest v3 to durable M2 request and result authority';

const hash = sql => createHash('sha256').update(sql.replace(/\s+/gu, ' ').trim()).digest('hex');
const REQUEST_NAME = 'trg_m2_effect_requests_json_identity';
const RESULT_NAME = 'trg_m2_tool_effect_link_terminal_exact';
const requestNeedle = "CASE WHEN json_extract(NEW.request_json, '$.version') = 2 THEN";
const TARGET_REQUEST_HASH = 'cdd1e20ee41daad32be327fa2c6f0483e27404d293416f6f90837b90884d78c7';
const TARGET_RESULT_HASH = '7d3222b82df248a6e7a3a86ae3e5a6ea039945e3920bbd83c4617d21b3b51ecc';
const requestReplacement = `CASE WHEN json_extract(NEW.request_json, '$.version') = 3 THEN
        m2_effect_request_create_v3(NEW.request_json, NEW.request_digest, NEW.created_at_ms)
        WHEN json_extract(NEW.request_json, '$.version') = 2 THEN`;
const resultNeedle = "ELSE m2_tool_effect_projection_matches_v1(request.request_json, effect_request.request_json,";
const resultReplacement = `WHEN request.tool_id = 'file.create' AND request.tool_version = 1 THEN
          m2_tool_effect_projection_create_v1(request.request_json, effect_request.request_json,
            effect_result.result_json, NEW.result_json)
        ELSE m2_tool_effect_projection_matches_v1(request.request_json, effect_request.request_json,`;

function trigger(database, name) {
  return database.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(name)?.sql || null;
}

export function up(database) {
  registerM2EffectCurrentFunctions(database);
  registerM2CreateToolProjectionFunction(database);
  const requestSql = trigger(database, REQUEST_NAME);
  const resultSql = trigger(database, RESULT_NAME);
  if (!requestSql || !resultSql) throw new Error('M2_ATOMIC_CREATE_121_TRIGGERS_MISSING');
  if (requestSql.includes('m2_effect_request_create_v3')
    || resultSql.includes('m2_tool_effect_projection_create_v1')) {
    if (hash(requestSql) !== TARGET_REQUEST_HASH || hash(resultSql) !== TARGET_RESULT_HASH) {
      throw new Error('M2_ATOMIC_CREATE_121_PARTIAL_SCHEMA');
    }
    return;
  }
  if (computeM2FileListOutputFingerprintV110(database)
    !== EXPECTED_M2_FILE_LIST_OUTPUT_FINGERPRINT_V110
    || !requestSql.includes(requestNeedle)
    || !resultSql.includes(resultNeedle)) {
    throw new Error('M2_ATOMIC_CREATE_121_SOURCE_SCHEMA_MISMATCH');
  }
  const updatedRequest = requestSql.replace(requestNeedle, requestReplacement);
  const updatedResult = resultSql.replace(resultNeedle, resultReplacement);
  database.exec(`DROP TRIGGER ${REQUEST_NAME}; DROP TRIGGER ${RESULT_NAME};`);
  database.exec(`${updatedRequest}; ${updatedResult};`);
  if (hash(trigger(database, REQUEST_NAME)) !== TARGET_REQUEST_HASH
    || hash(trigger(database, RESULT_NAME)) !== TARGET_RESULT_HASH) {
    throw new Error('M2_ATOMIC_CREATE_121_TARGET_SCHEMA_MISMATCH');
  }
}

export default { version, description, up };
