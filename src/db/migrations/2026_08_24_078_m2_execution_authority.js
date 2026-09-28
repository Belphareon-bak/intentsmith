import { createHash } from 'node:crypto';

import {
  computeM2ExecutionValueDigest,
  validateM2ProjectChangeRequest,
  validateM2ProjectChangeResultForRequest,
} from '../../../contracts/m2/execution-v1.js';

export const version = '2026_08_24_078_m2_execution_authority';
export const description = 'Add durable M2 project-change authority, fencing, and terminal truth';

// Filled from the canonical sqlite_master projection produced by this migration.
export const EXPECTED_M2_EXECUTION_SCHEMA_FINGERPRINT = '057d60b1438bae5b264510447982711fae9789234aca1bbfb4c5b7142c96284a';

function requestValid(requestJson) {
  try {
    return validateM2ProjectChangeRequest(JSON.parse(requestJson)).valid ? 1 : 0;
  } catch {
    return 0;
  }
}

function resultMatchesRequest(requestJson, resultJson) {
  try {
    return validateM2ProjectChangeResultForRequest(
      JSON.parse(requestJson),
      JSON.parse(resultJson),
    ).valid ? 1 : 0;
  } catch {
    return 0;
  }
}

function fileMatchesRequest(
  requestJson,
  ordinal,
  relativePath,
  beforeExists,
  beforeDigest,
  beforeBytes,
  beforeMode,
  afterDigest,
  afterBytes,
  afterMode,
  forwardEffectId,
  rollbackEffectId,
) {
  try {
    const request = JSON.parse(requestJson);
    if (!validateM2ProjectChangeRequest(request).valid) return 0;
    const change = request.changes?.[ordinal];
    return change
      && change.path === relativePath
      && Number(change.before.exists) === beforeExists
      && change.before.digest === beforeDigest
      && change.before.bytes === beforeBytes
      && change.before.mode === beforeMode
      && change.after.digest === afterDigest
      && change.after.bytes === afterBytes
      && change.after.mode === afterMode
      && change.forwardAuthority?.effectId === forwardEffectId
      && change.rollbackAuthority?.effectId === rollbackEffectId
      ? 1 : 0;
  } catch {
    return 0;
  }
}

function stepMatchesRequest(requestJson, role, ordinal, effectId, requestDigest) {
  try {
    const request = JSON.parse(requestJson);
    if (!validateM2ProjectChangeRequest(request).valid) return 0;
    if (role === 'forward') {
      const authority = request.changes?.[ordinal]?.forwardAuthority;
      return authority?.effectId === effectId && authority?.requestDigest === requestDigest ? 1 : 0;
    }
    if (role === 'rollback') {
      const authority = request.changes?.[ordinal]?.rollbackAuthority;
      return authority?.effectId === effectId && authority?.requestDigest === requestDigest ? 1 : 0;
    }
    if (role === 'focused_test') {
      const authority = request.focusedTest?.authority;
      return ordinal === 0 && authority?.effectId === effectId && authority?.requestDigest === requestDigest ? 1 : 0;
    }
    if (role === 'git_commit') {
      const authority = request.gitCommit?.authority;
      return ordinal === 0 && authority?.effectId === effectId && authority?.requestDigest === requestDigest ? 1 : 0;
    }
    return 0;
  } catch {
    return 0;
  }
}

function gitMaterialMatchesRequest(requestJson, message, identityJson) {
  try {
    const request = JSON.parse(requestJson);
    const identity = JSON.parse(identityJson);
    return validateM2ProjectChangeRequest(request).valid
      && request.gitCommit !== null
      && computeM2ExecutionValueDigest(message) === request.gitCommit.messageDigest
      && computeM2ExecutionValueDigest(identity) === request.gitCommit.identityDigest
      ? 1 : 0;
  } catch {
    return 0;
  }
}

export function registerM2ExecutionSemanticFunctions(db) {
  db.function('m2_execution_request_valid_v1', { deterministic: true }, requestValid);
  db.function('m2_execution_result_matches_request_v1', {
    deterministic: true,
  }, resultMatchesRequest);
  db.function('m2_execution_file_matches_request_v1', {
    deterministic: true,
    varargs: true,
  }, fileMatchesRequest);
  db.function('m2_execution_step_matches_request_v1', {
    deterministic: true,
  }, stepMatchesRequest);
  db.function('m2_execution_git_material_matches_request_v1', {
    deterministic: true,
  }, gitMaterialMatchesRequest);
}

export function computeM2ExecutionSchemaFingerprint(db) {
  const rows = db.prepare(`
    SELECT type, name, sql FROM sqlite_master
    WHERE sql IS NOT NULL AND (
      name GLOB 'm2_execution_*'
      OR name GLOB 'trg_m2_execution_*'
      OR name GLOB 'idx_m2_execution_*'
    )
    ORDER BY type, name
  `).all().map(row => ({
    type: row.type,
    name: row.name,
    sql: row.sql.replace(/\s+/g, ' ').trim(),
  }));
  return createHash('sha256').update(JSON.stringify(rows), 'utf8').digest('hex');
}

function installExecutionAuthority(db) {
  db.exec(`
    CREATE TABLE m2_execution_requests (
      execution_id TEXT PRIMARY KEY CHECK (length(trim(execution_id)) BETWEEN 1 AND 128),
      run_id TEXT NOT NULL CHECK (length(trim(run_id)) BETWEEN 1 AND 128),
      project_id INTEGER NOT NULL CHECK (typeof(project_id) = 'integer' AND project_id > 0),
      request_digest TEXT NOT NULL UNIQUE CHECK (
        length(request_digest) = 71 AND substr(request_digest, 1, 7) = 'sha256:'
      ),
      workspace_revision TEXT NOT NULL CHECK (length(trim(workspace_revision)) BETWEEN 1 AND 256),
      authority_set_digest TEXT NOT NULL CHECK (
        length(authority_set_digest) = 71 AND substr(authority_set_digest, 1, 7) = 'sha256:'
      ),
      request_json TEXT NOT NULL CHECK (
        json_valid(request_json) AND length(CAST(request_json AS BLOB)) <= 4194304
      ),
      created_at_ms INTEGER NOT NULL CHECK (
        typeof(created_at_ms) = 'integer' AND created_at_ms >= 0
      )
    );

    CREATE TRIGGER trg_m2_execution_requests_exact_contract
    BEFORE INSERT ON m2_execution_requests
    WHEN m2_execution_request_valid_v1(NEW.request_json) <> 1
      OR json_extract(NEW.request_json, '$.executionId') IS NOT NEW.execution_id
      OR json_extract(NEW.request_json, '$.runId') IS NOT NEW.run_id
      OR json_extract(NEW.request_json, '$.project.projectId') IS NOT NEW.project_id
      OR json_extract(NEW.request_json, '$.project.workspaceRevision') IS NOT NEW.workspace_revision
      OR json_extract(NEW.request_json, '$.authoritySetDigest') IS NOT NEW.authority_set_digest
    BEGIN
      SELECT RAISE(ABORT, 'M2_EXECUTION_REQUEST_CONTRACT_MISMATCH');
    END;

    CREATE TABLE m2_execution_git_material (
      execution_id TEXT PRIMARY KEY REFERENCES m2_execution_requests(execution_id) ON DELETE RESTRICT,
      message TEXT NOT NULL CHECK (length(CAST(message AS BLOB)) BETWEEN 1 AND 4096),
      identity_json TEXT NOT NULL CHECK (
        json_valid(identity_json) AND length(CAST(identity_json AS BLOB)) BETWEEN 2 AND 4096
      )
    );

    CREATE TRIGGER trg_m2_execution_git_material_exact_contract
    BEFORE INSERT ON m2_execution_git_material
    WHEN NOT EXISTS (
      SELECT 1 FROM m2_execution_requests request
      WHERE request.execution_id = NEW.execution_id
        AND m2_execution_git_material_matches_request_v1(
          request.request_json, NEW.message, NEW.identity_json
        ) = 1
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_EXECUTION_GIT_MATERIAL_MISMATCH');
    END;

    CREATE TABLE m2_execution_files (
      execution_id TEXT NOT NULL REFERENCES m2_execution_requests(execution_id) ON DELETE RESTRICT,
      ordinal INTEGER NOT NULL CHECK (typeof(ordinal) = 'integer' AND ordinal BETWEEN 0 AND 31),
      relative_path TEXT NOT NULL CHECK (length(CAST(relative_path AS BLOB)) BETWEEN 1 AND 4096),
      before_exists INTEGER NOT NULL CHECK (before_exists IN (0, 1)),
      before_digest TEXT,
      before_bytes BLOB NOT NULL CHECK (length(before_bytes) <= 1048576),
      before_byte_count INTEGER NOT NULL CHECK (
        typeof(before_byte_count) = 'integer' AND before_byte_count = length(before_bytes)
      ),
      before_mode INTEGER,
      after_digest TEXT NOT NULL CHECK (
        length(after_digest) = 71 AND substr(after_digest, 1, 7) = 'sha256:'
      ),
      after_bytes BLOB NOT NULL CHECK (length(after_bytes) <= 1048576),
      after_byte_count INTEGER NOT NULL CHECK (
        typeof(after_byte_count) = 'integer' AND after_byte_count = length(after_bytes)
      ),
      after_mode INTEGER NOT NULL CHECK (typeof(after_mode) = 'integer' AND after_mode BETWEEN 0 AND 511),
      forward_effect_id TEXT NOT NULL UNIQUE
        REFERENCES m2_effect_requests(effect_id) ON DELETE RESTRICT,
      rollback_effect_id TEXT NOT NULL UNIQUE
        REFERENCES m2_effect_requests(effect_id) ON DELETE RESTRICT,
      PRIMARY KEY (execution_id, relative_path),
      UNIQUE (execution_id, ordinal),
      CHECK (
        (before_exists = 0 AND before_digest IS NULL AND before_byte_count = 0 AND before_mode IS NULL)
        OR
        (before_exists = 1
          AND length(before_digest) = 71
          AND substr(before_digest, 1, 7) = 'sha256:'
          AND typeof(before_mode) = 'integer'
          AND before_mode BETWEEN 0 AND 511)
      )
    );

    CREATE TRIGGER trg_m2_execution_files_exact_contract
    BEFORE INSERT ON m2_execution_files
    WHEN NOT EXISTS (
      SELECT 1 FROM m2_execution_requests request
      WHERE request.execution_id = NEW.execution_id
        AND m2_execution_file_matches_request_v1(
          request.request_json,
          NEW.ordinal,
          NEW.relative_path,
          NEW.before_exists,
          NEW.before_digest,
          NEW.before_byte_count,
          NEW.before_mode,
          NEW.after_digest,
          NEW.after_byte_count,
          NEW.after_mode,
          NEW.forward_effect_id,
          NEW.rollback_effect_id
        ) = 1
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_EXECUTION_FILE_CONTRACT_MISMATCH');
    END;

    CREATE TABLE m2_execution_steps (
      execution_id TEXT NOT NULL REFERENCES m2_execution_requests(execution_id) ON DELETE RESTRICT,
      role TEXT NOT NULL CHECK (role IN ('forward', 'rollback', 'focused_test', 'git_commit')),
      ordinal INTEGER NOT NULL CHECK (typeof(ordinal) = 'integer' AND ordinal BETWEEN 0 AND 31),
      effect_id TEXT NOT NULL UNIQUE REFERENCES m2_effect_requests(effect_id) ON DELETE RESTRICT,
      request_digest TEXT NOT NULL CHECK (
        length(request_digest) = 71 AND substr(request_digest, 1, 7) = 'sha256:'
      ),
      PRIMARY KEY (execution_id, role, ordinal)
    );

    CREATE TRIGGER trg_m2_execution_steps_exact_contract
    BEFORE INSERT ON m2_execution_steps
    WHEN NOT EXISTS (
      SELECT 1 FROM m2_execution_requests request
      JOIN m2_effect_requests effect ON effect.effect_id = NEW.effect_id
      WHERE request.execution_id = NEW.execution_id
        AND effect.request_digest = NEW.request_digest
        AND m2_execution_step_matches_request_v1(
          request.request_json, NEW.role, NEW.ordinal, NEW.effect_id, NEW.request_digest
        ) = 1
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_EXECUTION_STEP_CONTRACT_MISMATCH');
    END;

    CREATE TABLE m2_execution_claims (
      execution_id TEXT NOT NULL REFERENCES m2_execution_requests(execution_id) ON DELETE RESTRICT,
      generation INTEGER NOT NULL CHECK (typeof(generation) = 'integer' AND generation > 0),
      owner_id TEXT NOT NULL CHECK (length(trim(owner_id)) BETWEEN 1 AND 128),
      owner_pid INTEGER NOT NULL CHECK (typeof(owner_pid) = 'integer' AND owner_pid > 0),
      owner_boot_id TEXT NOT NULL CHECK (length(trim(owner_boot_id)) BETWEEN 1 AND 256),
      owner_start_identity TEXT NOT NULL CHECK (length(trim(owner_start_identity)) BETWEEN 1 AND 256),
      claimed_at_ms INTEGER NOT NULL CHECK (typeof(claimed_at_ms) = 'integer' AND claimed_at_ms >= 0),
      lease_until_ms INTEGER NOT NULL CHECK (
        typeof(lease_until_ms) = 'integer' AND lease_until_ms > claimed_at_ms
      ),
      PRIMARY KEY (execution_id, generation)
    );

    CREATE TRIGGER trg_m2_execution_claims_monotonic
    BEFORE INSERT ON m2_execution_claims
    WHEN EXISTS (SELECT 1 FROM m2_execution_results result WHERE result.execution_id = NEW.execution_id)
      OR NEW.generation <> COALESCE((
        SELECT max(claim.generation) + 1 FROM m2_execution_claims claim
        WHERE claim.execution_id = NEW.execution_id
      ), 1)
      OR NEW.claimed_at_ms < (
        SELECT request.created_at_ms FROM m2_execution_requests request
        WHERE request.execution_id = NEW.execution_id
      )
      OR (
        NEW.generation > 1
        AND NEW.claimed_at_ms < COALESCE(
          (
            SELECT max(renewal.lease_until_ms)
            FROM m2_execution_claim_renewals renewal
            WHERE renewal.execution_id = NEW.execution_id
              AND renewal.generation = NEW.generation - 1
          ),
          (
            SELECT claim.lease_until_ms
            FROM m2_execution_claims claim
            WHERE claim.execution_id = NEW.execution_id
              AND claim.generation = NEW.generation - 1
          )
        )
      )
    BEGIN
      SELECT RAISE(ABORT, 'M2_EXECUTION_CLAIM_FENCE_MISMATCH');
    END;

    CREATE TABLE m2_execution_claim_renewals (
      execution_id TEXT NOT NULL,
      generation INTEGER NOT NULL,
      renewal_seq INTEGER NOT NULL CHECK (typeof(renewal_seq) = 'integer' AND renewal_seq > 0),
      renewed_at_ms INTEGER NOT NULL CHECK (typeof(renewed_at_ms) = 'integer' AND renewed_at_ms >= 0),
      lease_until_ms INTEGER NOT NULL CHECK (
        typeof(lease_until_ms) = 'integer' AND lease_until_ms > renewed_at_ms
      ),
      PRIMARY KEY (execution_id, generation, renewal_seq),
      FOREIGN KEY (execution_id, generation)
        REFERENCES m2_execution_claims(execution_id, generation) ON DELETE RESTRICT
    );

    CREATE TRIGGER trg_m2_execution_claim_renewals_monotonic
    BEFORE INSERT ON m2_execution_claim_renewals
    WHEN NEW.generation <> (
        SELECT max(claim.generation) FROM m2_execution_claims claim
        WHERE claim.execution_id = NEW.execution_id
      )
      OR NEW.renewal_seq <> COALESCE((
        SELECT max(renewal.renewal_seq) + 1 FROM m2_execution_claim_renewals renewal
        WHERE renewal.execution_id = NEW.execution_id
          AND renewal.generation = NEW.generation
      ), 1)
      OR NEW.renewed_at_ms < COALESCE((
        SELECT max(renewal.renewed_at_ms) FROM m2_execution_claim_renewals renewal
        WHERE renewal.execution_id = NEW.execution_id
          AND renewal.generation = NEW.generation
      ), (
        SELECT claim.claimed_at_ms FROM m2_execution_claims claim
        WHERE claim.execution_id = NEW.execution_id AND claim.generation = NEW.generation
      ))
      OR NEW.renewed_at_ms >= max(
        (
          SELECT claim.lease_until_ms FROM m2_execution_claims claim
          WHERE claim.execution_id = NEW.execution_id AND claim.generation = NEW.generation
        ),
        COALESCE((
          SELECT max(renewal.lease_until_ms) FROM m2_execution_claim_renewals renewal
          WHERE renewal.execution_id = NEW.execution_id
            AND renewal.generation = NEW.generation
        ), 0)
      )
      OR NEW.lease_until_ms <= max(
        (
          SELECT claim.lease_until_ms FROM m2_execution_claims claim
          WHERE claim.execution_id = NEW.execution_id AND claim.generation = NEW.generation
        ),
        COALESCE((
          SELECT max(renewal.lease_until_ms) FROM m2_execution_claim_renewals renewal
          WHERE renewal.execution_id = NEW.execution_id
            AND renewal.generation = NEW.generation
        ), 0)
      )
    BEGIN
      SELECT RAISE(ABORT, 'M2_EXECUTION_CLAIM_RENEWAL_MISMATCH');
    END;

    CREATE TABLE m2_execution_approval_sets (
      execution_id TEXT NOT NULL REFERENCES m2_execution_requests(execution_id) ON DELETE RESTRICT,
      generation INTEGER NOT NULL,
      authority_set_digest TEXT NOT NULL,
      grant_ids_json TEXT NOT NULL CHECK (json_valid(grant_ids_json)),
      consumed_at_ms INTEGER NOT NULL CHECK (typeof(consumed_at_ms) = 'integer' AND consumed_at_ms >= 0),
      PRIMARY KEY (execution_id, generation),
      FOREIGN KEY (execution_id, generation)
        REFERENCES m2_execution_claims(execution_id, generation) ON DELETE RESTRICT
    );

    CREATE TRIGGER trg_m2_execution_approval_sets_exact
    BEFORE INSERT ON m2_execution_approval_sets
    WHEN NEW.generation <> (
        SELECT max(claim.generation) FROM m2_execution_claims claim
        WHERE claim.execution_id = NEW.execution_id
      )
      OR NEW.authority_set_digest <> (
        SELECT request.authority_set_digest FROM m2_execution_requests request
        WHERE request.execution_id = NEW.execution_id
      )
      OR json_type(NEW.grant_ids_json) <> 'array'
      OR json_array_length(NEW.grant_ids_json) <> (
        SELECT count(*) FROM m2_execution_steps step
        WHERE step.execution_id = NEW.execution_id
      )
      OR EXISTS (
        SELECT 1 FROM m2_execution_steps step
        WHERE step.execution_id = NEW.execution_id
          AND NOT EXISTS (
            SELECT 1
            FROM m2_effect_execution_claims effect_claim
            JOIN m2_approval_grants grant
              ON grant.grant_id = effect_claim.grant_id
             AND grant.effect_id = effect_claim.effect_id
            JOIN json_each(NEW.grant_ids_json) member ON member.value = grant.grant_id
            WHERE effect_claim.effect_id = step.effect_id
              AND grant.consumed_at_ms IS NOT NULL
              AND grant.consumed_by_effect_id = step.effect_id
              AND grant.revoked_at_ms IS NULL
          )
      )
    BEGIN
      SELECT RAISE(ABORT, 'M2_EXECUTION_APPROVAL_SET_INCOMPLETE');
    END;

    CREATE TABLE m2_execution_processes (
      execution_id TEXT NOT NULL,
      generation INTEGER NOT NULL,
      effect_id TEXT NOT NULL REFERENCES m2_effect_requests(effect_id) ON DELETE RESTRICT,
      supervisor_pid INTEGER NOT NULL CHECK (typeof(supervisor_pid) = 'integer' AND supervisor_pid > 0),
      process_group_id INTEGER NOT NULL CHECK (typeof(process_group_id) = 'integer' AND process_group_id > 0),
      owner_boot_id TEXT NOT NULL CHECK (length(trim(owner_boot_id)) BETWEEN 1 AND 256),
      owner_start_identity TEXT NOT NULL CHECK (length(trim(owner_start_identity)) BETWEEN 1 AND 256),
      started_at_ms INTEGER NOT NULL CHECK (typeof(started_at_ms) = 'integer' AND started_at_ms >= 0),
      PRIMARY KEY (execution_id, generation, effect_id),
      FOREIGN KEY (execution_id, generation)
        REFERENCES m2_execution_claims(execution_id, generation) ON DELETE RESTRICT
    );

    CREATE TRIGGER trg_m2_execution_processes_exact
    BEFORE INSERT ON m2_execution_processes
    WHEN NOT EXISTS (
      SELECT 1 FROM m2_execution_steps step
      WHERE step.execution_id = NEW.execution_id
        AND step.role = 'focused_test'
        AND step.effect_id = NEW.effect_id
    ) OR NEW.generation <> (
      SELECT max(claim.generation) FROM m2_execution_claims claim
      WHERE claim.execution_id = NEW.execution_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_EXECUTION_PROCESS_AUTHORITY_MISMATCH');
    END;

    CREATE TABLE m2_execution_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE CHECK (length(trim(event_id)) BETWEEN 1 AND 128),
      execution_id TEXT NOT NULL,
      generation INTEGER NOT NULL,
      phase TEXT NOT NULL CHECK (length(trim(phase)) BETWEEN 1 AND 64),
      event_type TEXT NOT NULL CHECK (
        event_type IN (
          'phase_intent', 'phase_applied', 'recovery_observed',
          'rollback_intent', 'rollback_applied',
          'process_started', 'process_terminated',
          'git_ref_updated', 'terminal_prepared'
        )
      ),
      relative_path TEXT,
      effect_id TEXT REFERENCES m2_effect_requests(effect_id) ON DELETE RESTRICT,
      occurred_at_ms INTEGER NOT NULL CHECK (typeof(occurred_at_ms) = 'integer' AND occurred_at_ms >= 0),
      details_json TEXT NOT NULL CHECK (
        json_valid(details_json) AND length(CAST(details_json AS BLOB)) <= 65536
      ),
      FOREIGN KEY (execution_id, generation)
        REFERENCES m2_execution_claims(execution_id, generation) ON DELETE RESTRICT
    );

    CREATE TRIGGER trg_m2_execution_events_current_fence
    BEFORE INSERT ON m2_execution_events
    WHEN NEW.generation <> (
        SELECT max(claim.generation) FROM m2_execution_claims claim
        WHERE claim.execution_id = NEW.execution_id
      )
      OR EXISTS (SELECT 1 FROM m2_execution_results result WHERE result.execution_id = NEW.execution_id)
    BEGIN
      SELECT RAISE(ABORT, 'M2_EXECUTION_EVENT_STALE_FENCE');
    END;

    CREATE TABLE m2_execution_results (
      execution_id TEXT PRIMARY KEY REFERENCES m2_execution_requests(execution_id) ON DELETE RESTRICT,
      request_digest TEXT NOT NULL,
      run_id TEXT NOT NULL,
      project_id INTEGER NOT NULL,
      generation INTEGER NOT NULL,
      terminal_status TEXT NOT NULL CHECK (
        terminal_status IN ('succeeded', 'failed', 'cancelled', 'timed_out', 'orphaned')
      ),
      result_json TEXT NOT NULL CHECK (
        json_valid(result_json) AND length(CAST(result_json AS BLOB)) <= 1048576
      ),
      completed_at_ms INTEGER NOT NULL CHECK (typeof(completed_at_ms) = 'integer' AND completed_at_ms >= 0),
      FOREIGN KEY (execution_id, generation)
        REFERENCES m2_execution_claims(execution_id, generation) ON DELETE RESTRICT
    );

    CREATE TRIGGER trg_m2_execution_results_terminal_truth
    BEFORE INSERT ON m2_execution_results
    WHEN NOT EXISTS (
        SELECT 1 FROM m2_execution_requests request
        WHERE request.execution_id = NEW.execution_id
          AND request.request_digest = NEW.request_digest
          AND request.run_id = NEW.run_id
          AND request.project_id = NEW.project_id
          AND m2_execution_result_matches_request_v1(
            request.request_json, NEW.result_json
          ) = 1
      )
      OR NEW.generation <> (
        SELECT max(claim.generation) FROM m2_execution_claims claim
        WHERE claim.execution_id = NEW.execution_id
      )
      OR NOT EXISTS (
        SELECT 1 FROM m2_execution_approval_sets approval
        WHERE approval.execution_id = NEW.execution_id
          AND approval.generation = NEW.generation
      )
      OR (
        NEW.terminal_status = 'succeeded'
        AND (
          EXISTS (
            SELECT 1 FROM m2_execution_steps step
            LEFT JOIN m2_effect_results effect_result ON effect_result.effect_id = step.effect_id
            WHERE step.execution_id = NEW.execution_id
              AND step.role IN ('forward', 'focused_test', 'git_commit')
              AND (effect_result.effect_id IS NULL OR effect_result.terminal_status <> 'succeeded')
          )
          OR EXISTS (
            SELECT 1 FROM m2_execution_steps step
            JOIN m2_effect_results effect_result ON effect_result.effect_id = step.effect_id
            WHERE step.execution_id = NEW.execution_id AND step.role = 'rollback'
          )
          OR EXISTS (
            SELECT 1 FROM m2_execution_processes process
            WHERE process.execution_id = NEW.execution_id
              AND process.generation = NEW.generation
              AND NOT EXISTS (
                SELECT 1 FROM m2_execution_events event
                WHERE event.execution_id = process.execution_id
                  AND event.generation = process.generation
                  AND event.effect_id = process.effect_id
                  AND event.event_type = 'process_terminated'
              )
          )
        )
      )
    BEGIN
      SELECT RAISE(ABORT, 'M2_EXECUTION_RESULT_AUTHORITY_MISSING');
    END;

    CREATE INDEX idx_m2_execution_claims_latest
      ON m2_execution_claims(execution_id, generation DESC);
    CREATE INDEX idx_m2_execution_events_journal
      ON m2_execution_events(execution_id, generation, seq);
    CREATE INDEX idx_m2_execution_steps_effect
      ON m2_execution_steps(effect_id, execution_id);
  `);

  const tables = [
    'm2_execution_requests',
    'm2_execution_git_material',
    'm2_execution_files',
    'm2_execution_steps',
    'm2_execution_claims',
    'm2_execution_claim_renewals',
    'm2_execution_approval_sets',
    'm2_execution_processes',
    'm2_execution_events',
    'm2_execution_results',
  ];
  for (const table of tables) {
    db.exec(`
      CREATE TRIGGER trg_${table}_append_only_update
      BEFORE UPDATE ON ${table}
      BEGIN
        SELECT RAISE(ABORT, '${table} is append-only');
      END;
      CREATE TRIGGER trg_${table}_append_only_delete
      BEFORE DELETE ON ${table}
      BEGIN
        SELECT RAISE(ABORT, '${table} is append-only');
      END;
    `);
  }
}

export function up(db) {
  registerM2ExecutionSemanticFunctions(db);
  const current = computeM2ExecutionSchemaFingerprint(db);
  if (current === EXPECTED_M2_EXECUTION_SCHEMA_FINGERPRINT) return;
  const existing = db.prepare(`
    SELECT count(*) AS count FROM sqlite_master
    WHERE name GLOB 'm2_execution_*'
      OR name GLOB 'trg_m2_execution_*'
      OR name GLOB 'idx_m2_execution_*'
  `).get().count;
  if (existing !== 0) {
    throw new Error('M2_EXECUTION_078_SOURCE_SCHEMA_FINGERPRINT_MISMATCH');
  }
  installExecutionAuthority(db);
  const installed = computeM2ExecutionSchemaFingerprint(db);
  if (installed !== EXPECTED_M2_EXECUTION_SCHEMA_FINGERPRINT) {
    throw new Error('M2_EXECUTION_078_FINAL_SCHEMA_FINGERPRINT_MISMATCH');
  }
}

export default { version, description, up };
