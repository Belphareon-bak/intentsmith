// Migration 066 — decision 020/E: model automation policy gets its own storage.
//
// The three automation keys used to live inside the shared `user_settings` JSON
// blob, which has five live mutation paths (generic POST, reset, storage,
// webhook and notification writers). Any of them could enable, disable or lose
// the policy, and none of them recorded who did it.
//
// This table is the single authority. The projection carries a revision and the
// id of the event that produced it; the append-only event log carries actor,
// source and a repository-owned request id. A projection whose `last_event_id`
// does not match a stored event is not trusted — the reader reports it and
// falls back to default-off.
//
// The seed row is deliberately OFF. A pre-existing
// `user_settings.models.autoFailoverEnabled = true` is NOT promoted: it was
// writable by unauthenticated full-document paths, so it is not evidence of a
// deliberate opt-in. The value is preserved on the genesis event as quarantined
// evidence so the operator can see it and decide again.

export const version = '2026_08_22_066_model_automation_policy';
export const description = 'Add versioned model automation policy storage with append-only events';

const GENESIS_EVENT_ID = 'policy-genesis-0000000000000001';

function legacyAutomationEvidence(db) {
  let row;
  try {
    row = db.prepare('SELECT data FROM user_settings WHERE id = 1').get();
  } catch (_) {
    return null;
  }
  if (!row?.data) return null;
  let parsed;
  try {
    parsed = JSON.parse(row.data);
  } catch (_) {
    return null;
  }
  const models = parsed?.models;
  if (!models || typeof models !== 'object' || Array.isArray(models)) return null;
  const evidence = {};
  for (const key of ['autoFailoverEnabled', 'autoCleanupEnabled', 'autoCleanupDays']) {
    if (Object.hasOwn(models, key)) evidence[key] = models[key];
  }
  return Object.keys(evidence).length > 0 ? JSON.stringify(evidence) : null;
}

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_automation_policy_events (
      event_id              TEXT PRIMARY KEY,
      seq                   INTEGER NOT NULL,
      revision              INTEGER NOT NULL UNIQUE,
      auto_failover_enabled INTEGER NOT NULL CHECK (auto_failover_enabled IN (0, 1)),
      auto_cleanup_enabled  INTEGER NOT NULL CHECK (auto_cleanup_enabled IN (0, 1)),
      auto_cleanup_days     INTEGER NOT NULL CHECK (auto_cleanup_days BETWEEN 1 AND 3650),
      actor                 TEXT NOT NULL,
      source                TEXT NOT NULL,
      request_id            TEXT NOT NULL UNIQUE,
      created_at_ms         INTEGER NOT NULL,
      quarantined_legacy    TEXT,
      CHECK (revision > 0),
      CHECK (seq > 0),
      CHECK (length(actor) > 0),
      CHECK (source IN ('GENESIS', 'TYPED_ROUTE', 'EXPLICIT_IMPORT', 'EXPLICIT_RESET'))
    );

    CREATE TABLE IF NOT EXISTS model_automation_policy (
      id                    INTEGER PRIMARY KEY CHECK (id = 1),
      revision              INTEGER NOT NULL,
      auto_failover_enabled INTEGER NOT NULL CHECK (auto_failover_enabled IN (0, 1)),
      auto_cleanup_enabled  INTEGER NOT NULL CHECK (auto_cleanup_enabled IN (0, 1)),
      auto_cleanup_days     INTEGER NOT NULL CHECK (auto_cleanup_days BETWEEN 1 AND 3650),
      last_event_id         TEXT NOT NULL REFERENCES model_automation_policy_events(event_id),
      updated_at_ms         INTEGER NOT NULL
    );

    CREATE TRIGGER IF NOT EXISTS trg_model_automation_policy_events_no_update
    BEFORE UPDATE ON model_automation_policy_events
    BEGIN
      SELECT RAISE(ABORT, 'model automation policy events are append-only');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_model_automation_policy_events_no_delete
    BEFORE DELETE ON model_automation_policy_events
    BEGIN
      SELECT RAISE(ABORT, 'model automation policy events are append-only');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_model_automation_policy_events_sequence
    BEFORE INSERT ON model_automation_policy_events
    BEGIN
      SELECT RAISE(ABORT, 'model automation policy event revision must advance by exactly one')
      WHERE NEW.revision <> (
        SELECT COALESCE(MAX(revision), 0) + 1 FROM model_automation_policy_events
      );
      SELECT RAISE(ABORT, 'model automation policy event sequence must advance by exactly one')
      WHERE NEW.seq <> (
        SELECT COALESCE(MAX(seq), 0) + 1 FROM model_automation_policy_events
      );
    END;

    CREATE TRIGGER IF NOT EXISTS trg_model_automation_policy_projection_event
    BEFORE INSERT ON model_automation_policy
    BEGIN
      SELECT RAISE(ABORT, 'model automation policy projection must match its event')
      WHERE NOT EXISTS (
        SELECT 1 FROM model_automation_policy_events event
        WHERE event.event_id = NEW.last_event_id
          AND event.revision = NEW.revision
          AND event.auto_failover_enabled = NEW.auto_failover_enabled
          AND event.auto_cleanup_enabled = NEW.auto_cleanup_enabled
          AND event.auto_cleanup_days = NEW.auto_cleanup_days
      );
    END;

    CREATE TRIGGER IF NOT EXISTS trg_model_automation_policy_projection_event_update
    BEFORE UPDATE ON model_automation_policy
    BEGIN
      SELECT RAISE(ABORT, 'model automation policy projection must match its event')
      WHERE NOT EXISTS (
        SELECT 1 FROM model_automation_policy_events event
        WHERE event.event_id = NEW.last_event_id
          AND event.revision = NEW.revision
          AND event.auto_failover_enabled = NEW.auto_failover_enabled
          AND event.auto_cleanup_enabled = NEW.auto_cleanup_enabled
          AND event.auto_cleanup_days = NEW.auto_cleanup_days
      );
      SELECT RAISE(ABORT, 'model automation policy revision must advance')
      WHERE NEW.revision <= OLD.revision;
    END;
  `);

  const existing = db.prepare('SELECT revision FROM model_automation_policy WHERE id = 1').get();
  if (existing) return;

  const quarantined = legacyAutomationEvidence(db);
  const nowMs = Date.now();

  db.prepare(`
    INSERT INTO model_automation_policy_events (
      event_id, seq, revision, auto_failover_enabled, auto_cleanup_enabled,
      auto_cleanup_days, actor, source, request_id, created_at_ms, quarantined_legacy
    ) VALUES (?, 1, 1, 0, 0, 14, 'system:migration', 'GENESIS', ?, ?, ?)
  `).run(GENESIS_EVENT_ID, `request-${GENESIS_EVENT_ID}`, nowMs, quarantined);

  db.prepare(`
    INSERT INTO model_automation_policy (
      id, revision, auto_failover_enabled, auto_cleanup_enabled,
      auto_cleanup_days, last_event_id, updated_at_ms
    ) VALUES (1, 1, 0, 0, 14, ?, ?)
  `).run(GENESIS_EVENT_ID, nowMs);
}

export default { version, description, up };
