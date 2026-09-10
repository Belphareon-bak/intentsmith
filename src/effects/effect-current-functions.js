import { canonicalStringify, computeEffectRequestDigest, validateEffectRequest,
  timestampToMs, validateEffectResultForRequest, validateApprovalGrantForRequest } from '../../contracts/m2/effect-current.js';
export function registerM2EffectCurrentFunctions(database) {
  database.function('m2_effect_request_root_list_v2', { deterministic: true }, (requestJson, requestDigest, createdAtMs) => {
    try {
      const request = JSON.parse(requestJson);
      return request.version === 2 && validateEffectRequest(request).valid
        && timestampToMs(request.createdAt) === createdAtMs && canonicalStringify(request) === requestJson && computeEffectRequestDigest(request) === requestDigest ? 1 : 0;
    } catch { return 0; }
  });
  database.function('m2_effect_result_matches_request_v3', { deterministic: true }, (requestJson, resultJson) => {
    try { return validateEffectResultForRequest(JSON.parse(requestJson), JSON.parse(resultJson)).valid ? 1 : 0; } catch { return 0; }
  });
  database.function('m2_approval_grant_matches_request_v2', { deterministic: true }, (requestJson, grantJson) => {
    try { return validateApprovalGrantForRequest(JSON.parse(requestJson), JSON.parse(grantJson)).valid ? 1 : 0; } catch { return 0; }
  });
}
