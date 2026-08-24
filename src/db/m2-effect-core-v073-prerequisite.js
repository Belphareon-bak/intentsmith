import { createHash } from 'node:crypto';

// Later M2 migrations add other `m2_*` objects. This independent prerequisite
// freezes the exact committed 073 effect authority without modifying that
// historical migration or accidentally including later tool/invalidation SQL.
export const M2_EFFECT_CORE_OBJECT_NAMES_V073 = Object.freeze([
  'idx_m2_approval_grants_run_state',
  'idx_m2_effect_authority_events_effect',
  'idx_m2_effect_requests_run',
  'm2_approval_grants',
  'm2_effect_authority_events',
  'm2_effect_execution_claims',
  'm2_effect_requests',
  'm2_effect_results',
  'm2_pending_effect_payloads',
  'trg_m2_approval_grants_append_only_delete',
  'trg_m2_approval_grants_consume_audit',
  'trg_m2_approval_grants_exact_scope',
  'trg_m2_approval_grants_fresh_insert',
  'trg_m2_approval_grants_insert_conflict',
  'trg_m2_approval_grants_issue_audit',
  'trg_m2_approval_grants_json_identity',
  'trg_m2_approval_grants_revoke_audit',
  'trg_m2_approval_grants_transition',
  'trg_m2_effect_authority_events_append_only_delete',
  'trg_m2_effect_authority_events_append_only_update',
  'trg_m2_effect_authority_events_derived_state',
  'trg_m2_effect_authority_events_insert_conflict',
  'trg_m2_effect_execution_claims_append_only_delete',
  'trg_m2_effect_execution_claims_append_only_update',
  'trg_m2_effect_execution_claims_exact_grant',
  'trg_m2_effect_requests_append_only_delete',
  'trg_m2_effect_requests_append_only_update',
  'trg_m2_effect_requests_audit',
  'trg_m2_effect_requests_insert_conflict',
  'trg_m2_effect_requests_json_identity',
  'trg_m2_effect_results_append_only_delete',
  'trg_m2_effect_results_append_only_update',
  'trg_m2_effect_results_audit',
  'trg_m2_effect_results_authority',
  'trg_m2_effect_results_exact_request',
  'trg_m2_effect_results_insert_conflict',
  'trg_m2_effect_results_json_identity',
  'trg_m2_effect_results_named_grant',
  'trg_m2_pending_payload_append_only_update',
  'trg_m2_pending_payload_exact_request',
  'trg_m2_pending_payload_terminal_delete',
]);

export const EXPECTED_M2_EFFECT_CORE_FINGERPRINT_V073 = '8e8f0202eb6a5ff3d49bc64583abcd2f8348736a8a52e72e5e6cb41c193bf1d8';
export const EXPECTED_M2_EFFECT_CORE_FINGERPRINT_V077 = '8860c23528c1e903c9722fe11da597ec309cde5c05a88728e41f7403a428b4e2';

export function computeM2EffectCoreFingerprintV073(db) {
  const expectedNames = new Set(M2_EFFECT_CORE_OBJECT_NAMES_V073);
  const rows = db.prepare(`
    SELECT type, name, sql FROM sqlite_master
    WHERE sql IS NOT NULL
    ORDER BY type, name
  `).all()
    .filter(row => expectedNames.has(row.name))
    .map(row => ({
      type: row.type,
      name: row.name,
      sql: row.sql.replace(/\s+/g, ' ').trim(),
    }));
  return createHash('sha256').update(JSON.stringify(rows), 'utf8').digest('hex');
}

export default {
  M2_EFFECT_CORE_OBJECT_NAMES_V073,
  EXPECTED_M2_EFFECT_CORE_FINGERPRINT_V073,
  computeM2EffectCoreFingerprintV073,
};
