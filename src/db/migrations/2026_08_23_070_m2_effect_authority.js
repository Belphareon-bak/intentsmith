// Migration 070 — durable M2 effect request/result and approval-grant authority.
//
// Requests, results and authority events are append-only. Approval grants have
// exactly one database-enforced transition from ACTIVE to CONSUMED or REVOKED.
// The result table independently proves that success followed an exact consumed
// grant, so callers cannot bypass the broker by writing a forged success row.

export const version = '2026_08_23_070_m2_effect_authority';
export const description = 'Add durable M2 effect and single-use approval authority';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS m2_effect_requests (
      effect_id TEXT PRIMARY KEY CHECK (length(trim(effect_id)) BETWEEN 1 AND 128),
      run_id TEXT NOT NULL CHECK (length(trim(run_id)) BETWEEN 1 AND 128),
      project_id INTEGER NOT NULL CHECK (typeof(project_id) = 'integer' AND project_id > 0),
      kind TEXT NOT NULL CHECK (kind IN (
        'fs.read','fs.write','fs.delete','process.exec',
        'network.request','git.commit','git.push'
      )),
      payload_digest TEXT NOT NULL CHECK (
        substr(payload_digest, 1, 7) = 'sha256:'
        AND length(payload_digest) = 71
        AND substr(payload_digest, 8) NOT GLOB '*[^0-9a-f]*'
      ),
      payload_bytes INTEGER NOT NULL CHECK (
        typeof(payload_bytes) = 'integer' AND payload_bytes >= 0
      ),
      request_digest TEXT NOT NULL CHECK (
        substr(request_digest, 1, 7) = 'sha256:'
        AND length(request_digest) = 71
        AND substr(request_digest, 8) NOT GLOB '*[^0-9a-f]*'
      ),
      workspace_revision TEXT NOT NULL CHECK (length(trim(workspace_revision)) BETWEEN 1 AND 256),
      idempotency_key TEXT NOT NULL CHECK (length(trim(idempotency_key)) BETWEEN 1 AND 128),
      request_json TEXT NOT NULL CHECK (json_valid(request_json)),
      created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms >= 0),
      UNIQUE(run_id, idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS m2_approval_grants (
      grant_id TEXT PRIMARY KEY CHECK (length(trim(grant_id)) BETWEEN 1 AND 128),
      effect_id TEXT NOT NULL UNIQUE REFERENCES m2_effect_requests(effect_id) ON DELETE RESTRICT,
      run_id TEXT NOT NULL CHECK (length(trim(run_id)) BETWEEN 1 AND 128),
      project_id INTEGER NOT NULL CHECK (typeof(project_id) = 'integer' AND project_id > 0),
      kind TEXT NOT NULL CHECK (kind IN (
        'fs.read','fs.write','fs.delete','process.exec',
        'network.request','git.commit','git.push'
      )),
      payload_digest TEXT NOT NULL CHECK (
        substr(payload_digest, 1, 7) = 'sha256:'
        AND length(payload_digest) = 71
        AND substr(payload_digest, 8) NOT GLOB '*[^0-9a-f]*'
      ),
      payload_bytes INTEGER NOT NULL CHECK (
        typeof(payload_bytes) = 'integer' AND payload_bytes >= 0
      ),
      workspace_revision TEXT NOT NULL CHECK (length(trim(workspace_revision)) BETWEEN 1 AND 256),
      nonce TEXT NOT NULL UNIQUE CHECK (length(nonce) BETWEEN 16 AND 256),
      grant_json TEXT NOT NULL CHECK (json_valid(grant_json)),
      issued_at_ms INTEGER NOT NULL CHECK (typeof(issued_at_ms) = 'integer' AND issued_at_ms >= 0),
      expires_at_ms INTEGER NOT NULL CHECK (
        typeof(expires_at_ms) = 'integer' AND expires_at_ms > issued_at_ms
      ),
      consumed_at_ms INTEGER CHECK (consumed_at_ms IS NULL OR (
        typeof(consumed_at_ms) = 'integer'
        AND consumed_at_ms >= issued_at_ms
        AND consumed_at_ms < expires_at_ms
      )),
      consumed_by_effect_id TEXT REFERENCES m2_effect_requests(effect_id) ON DELETE RESTRICT,
      revoked_at_ms INTEGER CHECK (
        revoked_at_ms IS NULL OR (typeof(revoked_at_ms) = 'integer' AND revoked_at_ms >= 0)
      ),
      revocation_reason TEXT CHECK (
        revocation_reason IS NULL OR length(trim(revocation_reason)) BETWEEN 1 AND 1024
      ),
      CHECK ((consumed_at_ms IS NULL) = (consumed_by_effect_id IS NULL)),
      CHECK ((revoked_at_ms IS NULL) = (revocation_reason IS NULL)),
      CHECK (NOT (consumed_at_ms IS NOT NULL AND revoked_at_ms IS NOT NULL)),
      CHECK (consumed_by_effect_id IS NULL OR consumed_by_effect_id = effect_id)
    );

    CREATE TABLE IF NOT EXISTS m2_effect_results (
      effect_id TEXT PRIMARY KEY REFERENCES m2_effect_requests(effect_id) ON DELETE RESTRICT,
      run_id TEXT NOT NULL CHECK (length(trim(run_id)) BETWEEN 1 AND 128),
      project_id INTEGER NOT NULL CHECK (typeof(project_id) = 'integer' AND project_id > 0),
      request_digest TEXT NOT NULL CHECK (
        substr(request_digest, 1, 7) = 'sha256:'
        AND length(request_digest) = 71
        AND substr(request_digest, 8) NOT GLOB '*[^0-9a-f]*'
      ),
      approval_grant_id TEXT REFERENCES m2_approval_grants(grant_id) ON DELETE RESTRICT,
      terminal_status TEXT NOT NULL CHECK (terminal_status IN (
        'succeeded','failed','cancelled','timed_out','killed','orphaned'
      )),
      result_json TEXT NOT NULL CHECK (json_valid(result_json)),
      completed_at_ms INTEGER NOT NULL CHECK (typeof(completed_at_ms) = 'integer' AND completed_at_ms >= 0)
    );

    CREATE TABLE IF NOT EXISTS m2_pending_effect_payloads (
      effect_id TEXT PRIMARY KEY REFERENCES m2_effect_requests(effect_id) ON DELETE RESTRICT,
      session_id TEXT NOT NULL CHECK (length(session_id) BETWEEN 1 AND 512),
      conversation_id TEXT NOT NULL CHECK (length(conversation_id) BETWEEN 1 AND 512),
      subject_id TEXT NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 128),
      project_id INTEGER NOT NULL CHECK (typeof(project_id) = 'integer' AND project_id > 0),
      payload BLOB NOT NULL CHECK (typeof(payload) = 'blob'),
      payload_digest TEXT NOT NULL,
      payload_bytes INTEGER NOT NULL CHECK (
        typeof(payload_bytes) = 'integer' AND payload_bytes >= 0
      ),
      created_at_ms INTEGER NOT NULL CHECK (
        typeof(created_at_ms) = 'integer' AND created_at_ms >= 0
      )
    );

    CREATE TABLE IF NOT EXISTS m2_effect_authority_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE CHECK (length(trim(event_id)) BETWEEN 1 AND 512),
      event_type TEXT NOT NULL CHECK (event_type IN (
        'REQUEST_REGISTERED','GRANT_ISSUED','GRANT_CONSUMED',
        'GRANT_REVOKED','RESULT_RECORDED'
      )),
      effect_id TEXT NOT NULL REFERENCES m2_effect_requests(effect_id) ON DELETE RESTRICT,
      grant_id TEXT REFERENCES m2_approval_grants(grant_id) ON DELETE RESTRICT,
      run_id TEXT NOT NULL,
      project_id INTEGER NOT NULL CHECK (typeof(project_id) = 'integer' AND project_id > 0),
      occurred_at_ms INTEGER NOT NULL CHECK (typeof(occurred_at_ms) = 'integer' AND occurred_at_ms >= 0),
      details_json TEXT NOT NULL CHECK (json_valid(details_json))
    );

    CREATE INDEX IF NOT EXISTS idx_m2_effect_requests_run
      ON m2_effect_requests(run_id, created_at_ms, effect_id);
    CREATE INDEX IF NOT EXISTS idx_m2_approval_grants_run_state
      ON m2_approval_grants(run_id, consumed_at_ms, revoked_at_ms, expires_at_ms);
    CREATE INDEX IF NOT EXISTS idx_m2_effect_authority_events_effect
      ON m2_effect_authority_events(effect_id, seq);

    CREATE TRIGGER IF NOT EXISTS trg_m2_pending_payload_exact_request
    BEFORE INSERT ON m2_pending_effect_payloads
    WHEN NOT EXISTS (
      SELECT 1 FROM m2_effect_requests request
      WHERE request.effect_id = NEW.effect_id
        AND request.project_id = NEW.project_id
        AND request.payload_digest = NEW.payload_digest
        AND request.payload_bytes = NEW.payload_bytes
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_PENDING_EFFECT_PAYLOAD_MISMATCH');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_m2_pending_payload_append_only_update
    BEFORE UPDATE ON m2_pending_effect_payloads
    BEGIN
      SELECT RAISE(ABORT, 'm2_pending_effect_payloads is append-only');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_m2_pending_payload_terminal_delete
    BEFORE DELETE ON m2_pending_effect_payloads
    WHEN NOT EXISTS (
      SELECT 1 FROM m2_effect_results result WHERE result.effect_id = OLD.effect_id
    ) AND NOT EXISTS (
      SELECT 1 FROM m2_approval_grants grant
      WHERE grant.effect_id = OLD.effect_id AND grant.revoked_at_ms IS NOT NULL
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_PENDING_EFFECT_PAYLOAD_IS_ACTIVE');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_m2_effect_requests_insert_conflict
    BEFORE INSERT ON m2_effect_requests
    WHEN EXISTS (
      SELECT 1 FROM m2_effect_requests existing
      WHERE existing.effect_id = NEW.effect_id
         OR (existing.run_id = NEW.run_id AND existing.idempotency_key = NEW.idempotency_key)
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_EFFECT_REQUEST_IDENTITY_CONFLICT');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_m2_effect_requests_json_identity
    BEFORE INSERT ON m2_effect_requests
    WHEN json_extract(NEW.request_json, '$.contract') IS NOT 'EffectRequest'
      OR json_extract(NEW.request_json, '$.version') IS NOT 1
      OR json_extract(NEW.request_json, '$.effectId') IS NOT NEW.effect_id
      OR json_extract(NEW.request_json, '$.runId') IS NOT NEW.run_id
      OR json_extract(NEW.request_json, '$.origin.projectId') IS NOT NEW.project_id
      OR json_extract(NEW.request_json, '$.kind') IS NOT NEW.kind
      OR json_extract(NEW.request_json, '$.payloadDigest') IS NOT NEW.payload_digest
      OR json_extract(NEW.request_json, '$.payloadBytes') IS NOT NEW.payload_bytes
      OR json_extract(NEW.request_json, '$.workspaceRevision') IS NOT NEW.workspace_revision
      OR json_extract(NEW.request_json, '$.idempotencyKey') IS NOT NEW.idempotency_key
      OR json_extract(NEW.request_json, '$.approvalGrantId') IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'M2_EFFECT_REQUEST_JSON_IDENTITY_MISMATCH');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_m2_effect_requests_append_only_update
    BEFORE UPDATE ON m2_effect_requests BEGIN
      SELECT RAISE(ABORT, 'm2_effect_requests is append-only');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_m2_effect_requests_append_only_delete
    BEFORE DELETE ON m2_effect_requests BEGIN
      SELECT RAISE(ABORT, 'm2_effect_requests is append-only');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_m2_effect_requests_audit
    AFTER INSERT ON m2_effect_requests
    BEGIN
      INSERT INTO m2_effect_authority_events (
        event_id, event_type, effect_id, grant_id, run_id, project_id,
        occurred_at_ms, details_json
      ) VALUES (
        'REQUEST_REGISTERED:' || NEW.effect_id,
        'REQUEST_REGISTERED', NEW.effect_id, NULL, NEW.run_id, NEW.project_id,
        NEW.created_at_ms, json_object('kind', NEW.kind)
      );
    END;

    CREATE TRIGGER IF NOT EXISTS trg_m2_approval_grants_insert_conflict
    BEFORE INSERT ON m2_approval_grants
    WHEN EXISTS (
      SELECT 1 FROM m2_approval_grants existing
      WHERE existing.grant_id = NEW.grant_id
         OR existing.effect_id = NEW.effect_id
         OR existing.nonce = NEW.nonce
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_APPROVAL_GRANT_IDENTITY_CONFLICT');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_m2_approval_grants_exact_scope
    BEFORE INSERT ON m2_approval_grants
    WHEN NOT EXISTS (
      SELECT 1 FROM m2_effect_requests request
      WHERE request.effect_id = NEW.effect_id
        AND request.run_id = NEW.run_id
        AND request.project_id = NEW.project_id
        AND request.kind = NEW.kind
        AND request.payload_digest = NEW.payload_digest
        AND request.payload_bytes = NEW.payload_bytes
        AND request.workspace_revision = NEW.workspace_revision
        AND json_extract(request.request_json, '$.actor.type') = 'user'
        AND json_extract(request.request_json, '$.actor.id') = json_extract(NEW.grant_json, '$.subject.actorId')
        AND json_extract(NEW.grant_json, '$.subject.actorType') = 'user'
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_APPROVAL_GRANT_SCOPE_MISMATCH');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_m2_approval_grants_json_identity
    BEFORE INSERT ON m2_approval_grants
    WHEN json_extract(NEW.grant_json, '$.contract') IS NOT 'ApprovalGrant'
      OR json_extract(NEW.grant_json, '$.version') IS NOT 1
      OR json_extract(NEW.grant_json, '$.grantId') IS NOT NEW.grant_id
      OR json_extract(NEW.grant_json, '$.scope.effectId') IS NOT NEW.effect_id
      OR json_extract(NEW.grant_json, '$.scope.runId') IS NOT NEW.run_id
      OR json_extract(NEW.grant_json, '$.scope.projectId') IS NOT NEW.project_id
      OR json_extract(NEW.grant_json, '$.scope.kind') IS NOT NEW.kind
      OR json_extract(NEW.grant_json, '$.scope.payloadDigest') IS NOT NEW.payload_digest
      OR json_extract(NEW.grant_json, '$.scope.payloadBytes') IS NOT NEW.payload_bytes
      OR json_extract(NEW.grant_json, '$.scope.workspaceRevision') IS NOT NEW.workspace_revision
      OR json_extract(NEW.grant_json, '$.constraints.maxBytes') IS NOT NEW.payload_bytes
      OR json_extract(NEW.grant_json, '$.nonce') IS NOT NEW.nonce
      OR json_extract(NEW.grant_json, '$.singleUse') IS NOT 1
      OR json_extract(NEW.grant_json, '$.consumedAt') IS NOT NULL
      OR json_extract(NEW.grant_json, '$.consumedByEffectId') IS NOT NULL
      OR json_extract(NEW.grant_json, '$.revokedAt') IS NOT NULL
      OR json_extract(NEW.grant_json, '$.revocationReason') IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'M2_APPROVAL_GRANT_JSON_IDENTITY_MISMATCH');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_m2_approval_grants_fresh_insert
    BEFORE INSERT ON m2_approval_grants
    WHEN NEW.consumed_at_ms IS NOT NULL
      OR NEW.consumed_by_effect_id IS NOT NULL
      OR NEW.revoked_at_ms IS NOT NULL
      OR NEW.revocation_reason IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'M2_APPROVAL_GRANT_MUST_START_ACTIVE');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_m2_approval_grants_transition
    BEFORE UPDATE ON m2_approval_grants
    WHEN OLD.consumed_at_ms IS NOT NULL
      OR OLD.revoked_at_ms IS NOT NULL
      OR NEW.grant_id IS NOT OLD.grant_id
      OR NEW.effect_id IS NOT OLD.effect_id
      OR NEW.run_id IS NOT OLD.run_id
      OR NEW.project_id IS NOT OLD.project_id
      OR NEW.kind IS NOT OLD.kind
      OR NEW.payload_digest IS NOT OLD.payload_digest
      OR NEW.payload_bytes IS NOT OLD.payload_bytes
      OR NEW.workspace_revision IS NOT OLD.workspace_revision
      OR NEW.nonce IS NOT OLD.nonce
      OR NEW.grant_json IS NOT OLD.grant_json
      OR NEW.issued_at_ms IS NOT OLD.issued_at_ms
      OR NEW.expires_at_ms IS NOT OLD.expires_at_ms
      OR NOT (
        OLD.consumed_at_ms IS NULL
        AND OLD.revoked_at_ms IS NULL
        AND (
          (NEW.consumed_at_ms IS NOT NULL
            AND NEW.consumed_by_effect_id = OLD.effect_id
            AND NEW.revoked_at_ms IS NULL
            AND NEW.revocation_reason IS NULL)
          OR
          (NEW.consumed_at_ms IS NULL
            AND NEW.consumed_by_effect_id IS NULL
            AND NEW.revoked_at_ms IS NOT NULL
            AND NEW.revocation_reason IS NOT NULL)
        )
      )
    BEGIN
      SELECT RAISE(ABORT, 'M2_APPROVAL_GRANT_INVALID_TRANSITION');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_m2_approval_grants_append_only_delete
    BEFORE DELETE ON m2_approval_grants BEGIN
      SELECT RAISE(ABORT, 'm2_approval_grants cannot be deleted');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_m2_approval_grants_issue_audit
    AFTER INSERT ON m2_approval_grants
    BEGIN
      INSERT INTO m2_effect_authority_events (
        event_id, event_type, effect_id, grant_id, run_id, project_id,
        occurred_at_ms, details_json
      ) VALUES (
        'GRANT_ISSUED:' || NEW.grant_id,
        'GRANT_ISSUED', NEW.effect_id, NEW.grant_id, NEW.run_id, NEW.project_id,
        NEW.issued_at_ms, json_object('expiresAtMs', NEW.expires_at_ms)
      );
    END;

    CREATE TRIGGER IF NOT EXISTS trg_m2_approval_grants_consume_audit
    AFTER UPDATE OF consumed_at_ms ON m2_approval_grants
    WHEN OLD.consumed_at_ms IS NULL AND NEW.consumed_at_ms IS NOT NULL
    BEGIN
      INSERT INTO m2_effect_authority_events (
        event_id, event_type, effect_id, grant_id, run_id, project_id,
        occurred_at_ms, details_json
      ) VALUES (
        'GRANT_CONSUMED:' || NEW.grant_id,
        'GRANT_CONSUMED', NEW.effect_id, NEW.grant_id, NEW.run_id, NEW.project_id,
        NEW.consumed_at_ms, json_object('consumedByEffectId', NEW.consumed_by_effect_id)
      );
    END;

    CREATE TRIGGER IF NOT EXISTS trg_m2_approval_grants_revoke_audit
    AFTER UPDATE OF revoked_at_ms ON m2_approval_grants
    WHEN OLD.revoked_at_ms IS NULL AND NEW.revoked_at_ms IS NOT NULL
    BEGIN
      INSERT INTO m2_effect_authority_events (
        event_id, event_type, effect_id, grant_id, run_id, project_id,
        occurred_at_ms, details_json
      ) VALUES (
        'GRANT_REVOKED:' || NEW.grant_id,
        'GRANT_REVOKED', NEW.effect_id, NEW.grant_id, NEW.run_id, NEW.project_id,
        NEW.revoked_at_ms, json_object('reason', NEW.revocation_reason)
      );
    END;

    CREATE TRIGGER IF NOT EXISTS trg_m2_effect_results_insert_conflict
    BEFORE INSERT ON m2_effect_results
    WHEN EXISTS (SELECT 1 FROM m2_effect_results existing WHERE existing.effect_id = NEW.effect_id)
    BEGIN
      SELECT RAISE(ABORT, 'M2_EFFECT_RESULT_TERMINAL_CONFLICT');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_m2_effect_results_json_identity
    BEFORE INSERT ON m2_effect_results
    WHEN json_extract(NEW.result_json, '$.contract') IS NOT 'EffectResult'
      OR json_extract(NEW.result_json, '$.version') IS NOT 1
      OR json_extract(NEW.result_json, '$.effectId') IS NOT NEW.effect_id
      OR json_extract(NEW.result_json, '$.runId') IS NOT NEW.run_id
      OR json_extract(NEW.result_json, '$.projectId') IS NOT NEW.project_id
      OR json_extract(NEW.result_json, '$.requestDigest') IS NOT NEW.request_digest
      OR json_extract(NEW.result_json, '$.approvalGrantId') IS NOT NEW.approval_grant_id
      OR json_extract(NEW.result_json, '$.terminalStatus') IS NOT NEW.terminal_status
    BEGIN
      SELECT RAISE(ABORT, 'M2_EFFECT_RESULT_JSON_IDENTITY_MISMATCH');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_m2_effect_results_exact_request
    BEFORE INSERT ON m2_effect_results
    WHEN NOT EXISTS (
      SELECT 1 FROM m2_effect_requests request
      WHERE request.effect_id = NEW.effect_id
        AND request.run_id = NEW.run_id
        AND request.project_id = NEW.project_id
        AND request.request_digest = NEW.request_digest
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_EFFECT_RESULT_REQUEST_MISMATCH');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_m2_effect_results_success_authority
    BEFORE INSERT ON m2_effect_results
    WHEN NEW.terminal_status = 'succeeded' AND NOT EXISTS (
      SELECT 1 FROM m2_approval_grants grant
      WHERE grant.grant_id = NEW.approval_grant_id
        AND grant.effect_id = NEW.effect_id
        AND grant.run_id = NEW.run_id
        AND grant.project_id = NEW.project_id
        AND grant.consumed_at_ms IS NOT NULL
        AND grant.consumed_by_effect_id = NEW.effect_id
        AND grant.revoked_at_ms IS NULL
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_EFFECT_RESULT_AUTHORITY_MISSING');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_m2_effect_results_named_grant
    BEFORE INSERT ON m2_effect_results
    WHEN NEW.approval_grant_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM m2_approval_grants grant
      WHERE grant.grant_id = NEW.approval_grant_id
        AND grant.effect_id = NEW.effect_id
        AND grant.run_id = NEW.run_id
        AND grant.project_id = NEW.project_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_EFFECT_RESULT_GRANT_MISMATCH');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_m2_effect_results_append_only_update
    BEFORE UPDATE ON m2_effect_results BEGIN
      SELECT RAISE(ABORT, 'm2_effect_results is append-only');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_m2_effect_results_append_only_delete
    BEFORE DELETE ON m2_effect_results BEGIN
      SELECT RAISE(ABORT, 'm2_effect_results is append-only');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_m2_effect_results_audit
    AFTER INSERT ON m2_effect_results
    BEGIN
      INSERT INTO m2_effect_authority_events (
        event_id, event_type, effect_id, grant_id, run_id, project_id,
        occurred_at_ms, details_json
      ) VALUES (
        'RESULT_RECORDED:' || NEW.effect_id,
        'RESULT_RECORDED', NEW.effect_id, NEW.approval_grant_id,
        NEW.run_id, NEW.project_id, NEW.completed_at_ms,
        json_object('terminalStatus', NEW.terminal_status)
      );
    END;

    CREATE TRIGGER IF NOT EXISTS trg_m2_effect_authority_events_append_only_update
    BEFORE UPDATE ON m2_effect_authority_events BEGIN
      SELECT RAISE(ABORT, 'm2_effect_authority_events is append-only');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_m2_effect_authority_events_append_only_delete
    BEFORE DELETE ON m2_effect_authority_events BEGIN
      SELECT RAISE(ABORT, 'm2_effect_authority_events is append-only');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_m2_effect_authority_events_insert_conflict
    BEFORE INSERT ON m2_effect_authority_events
    WHEN EXISTS (
      SELECT 1 FROM m2_effect_authority_events existing
      WHERE existing.event_id = NEW.event_id OR (NEW.seq > 0 AND existing.seq = NEW.seq)
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_EFFECT_AUTHORITY_EVENT_IDENTITY_CONFLICT');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_m2_effect_authority_events_derived_state
    BEFORE INSERT ON m2_effect_authority_events
    WHEN NOT (
      (NEW.event_type = 'REQUEST_REGISTERED'
        AND NEW.event_id = 'REQUEST_REGISTERED:' || NEW.effect_id
        AND NEW.grant_id IS NULL
        AND EXISTS (
          SELECT 1 FROM m2_effect_requests request
          WHERE request.effect_id = NEW.effect_id
            AND request.run_id = NEW.run_id
            AND request.project_id = NEW.project_id
            AND request.created_at_ms = NEW.occurred_at_ms
            AND NEW.details_json = json_object('kind', request.kind)
        ))
      OR
      (NEW.event_type = 'GRANT_ISSUED'
        AND NEW.event_id = 'GRANT_ISSUED:' || NEW.grant_id
        AND EXISTS (
          SELECT 1 FROM m2_approval_grants grant
          WHERE grant.grant_id = NEW.grant_id
            AND grant.effect_id = NEW.effect_id
            AND grant.run_id = NEW.run_id
            AND grant.project_id = NEW.project_id
            AND grant.issued_at_ms = NEW.occurred_at_ms
            AND NEW.details_json = json_object('expiresAtMs', grant.expires_at_ms)
        ))
      OR
      (NEW.event_type = 'GRANT_CONSUMED'
        AND NEW.event_id = 'GRANT_CONSUMED:' || NEW.grant_id
        AND EXISTS (
          SELECT 1 FROM m2_approval_grants grant
          WHERE grant.grant_id = NEW.grant_id
            AND grant.effect_id = NEW.effect_id
            AND grant.run_id = NEW.run_id
            AND grant.project_id = NEW.project_id
            AND grant.consumed_at_ms = NEW.occurred_at_ms
            AND grant.consumed_by_effect_id = NEW.effect_id
            AND NEW.details_json = json_object('consumedByEffectId', grant.consumed_by_effect_id)
        ))
      OR
      (NEW.event_type = 'GRANT_REVOKED'
        AND NEW.event_id = 'GRANT_REVOKED:' || NEW.grant_id
        AND EXISTS (
          SELECT 1 FROM m2_approval_grants grant
          WHERE grant.grant_id = NEW.grant_id
            AND grant.effect_id = NEW.effect_id
            AND grant.run_id = NEW.run_id
            AND grant.project_id = NEW.project_id
            AND grant.revoked_at_ms = NEW.occurred_at_ms
            AND NEW.details_json = json_object('reason', grant.revocation_reason)
        ))
      OR
      (NEW.event_type = 'RESULT_RECORDED'
        AND NEW.event_id = 'RESULT_RECORDED:' || NEW.effect_id
        AND EXISTS (
          SELECT 1 FROM m2_effect_results result
          WHERE result.effect_id = NEW.effect_id
            AND NEW.grant_id IS result.approval_grant_id
            AND result.run_id = NEW.run_id
            AND result.project_id = NEW.project_id
            AND result.completed_at_ms = NEW.occurred_at_ms
            AND NEW.details_json = json_object('terminalStatus', result.terminal_status)
        ))
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_EFFECT_AUTHORITY_EVENT_STATE_MISMATCH');
    END;
  `);
}
