import { createHash } from 'node:crypto';

import { registerM5PrivacyAuthorityFunctions } from '../../security/privacy-authority-validation.js';
import { parseAndScrubM5UserSettingsPrivacy } from '../../security/user-settings-privacy.js';

export const version = '2026_08_26_090_m5_privacy_authority';
export const description = 'Remove obsolete plaintext settings and add append-only M5 privacy receipts';

export const EXPECTED_M5_PRIVACY_AUTHORITY_FINGERPRINT_V090 =
  '39d26b2493fc7e42ceef5c83b5a31c518b3c900d71b56168570c9421b37bc4de';

const OBJECT_NAMES = Object.freeze([
  'm5_privacy_history_receipts',
  'm5_privacy_rotation_receipts',
  'idx_m5_privacy_rotation_incident_time',
  'trg_m5_privacy_history_append_only_delete',
  'trg_m5_privacy_history_append_only_update',
  'trg_m5_privacy_history_exact',
  'trg_m5_privacy_rotation_append_only_delete',
  'trg_m5_privacy_rotation_append_only_update',
  'trg_m5_privacy_rotation_exact',
  'trg_m5_user_settings_no_plaintext_credentials_insert',
  'trg_m5_user_settings_no_plaintext_credentials_update',
]);

export function computeM5PrivacyAuthorityFingerprintV090(db) {
  const expected = new Set(OBJECT_NAMES);
  const rows = db.prepare(`
    SELECT type, name, sql FROM sqlite_master
    WHERE sql IS NOT NULL ORDER BY type, name
  `).all()
    .filter(row => expected.has(row.name))
    .map(row => ({
      type: row.type,
      name: row.name,
      sql: row.sql.replace(/\s+/g, ' ').trim(),
    }));
  return createHash('sha256').update(JSON.stringify(rows), 'utf8').digest('hex');
}

function scrubObsoletePlaintextSettings(db) {
  const update = db.prepare(`
    UPDATE user_settings SET data = ?, updated_at = datetime('now') WHERE id = ?
  `);
  for (const row of db.prepare('SELECT id, data FROM user_settings ORDER BY id').all()) {
    let result;
    try {
      result = parseAndScrubM5UserSettingsPrivacy(row.data);
    } catch {
      throw new Error('M5_PRIVACY_USER_SETTINGS_MALFORMED');
    }
    if (result.removedCount > 0) update.run(JSON.stringify(result.settings), row.id);
  }
}

function install(db) {
  db.exec(`
    CREATE TABLE m5_privacy_rotation_receipts (
      receipt_id TEXT PRIMARY KEY CHECK (
        length(receipt_id) = 69 AND substr(receipt_id, 1, 5) = 'prr1:'
      ),
      incident_id TEXT NOT NULL CHECK (incident_id = 'G0-PRIVACY-001'),
      category_id TEXT NOT NULL CHECK (category_id IN (
        'administrative-api',
        'ephemeral-authority',
        'fixture-password-reuse',
        'license-agent',
        'license-signing-validation',
        'model-provider',
        'notification-credentials',
        'project-external'
      )),
      completed_at_ms INTEGER NOT NULL CHECK (
        typeof(completed_at_ms) = 'integer' AND completed_at_ms > 0
      ),
      attested_at_ms INTEGER NOT NULL CHECK (
        typeof(attested_at_ms) = 'integer' AND attested_at_ms >= completed_at_ms
      ),
      actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 128),
      record_json TEXT NOT NULL UNIQUE CHECK (json_valid(record_json)),
      UNIQUE (incident_id, category_id)
    );

    CREATE INDEX idx_m5_privacy_rotation_incident_time
      ON m5_privacy_rotation_receipts(incident_id, attested_at_ms, receipt_id);

    CREATE TABLE m5_privacy_history_receipts (
      receipt_id TEXT PRIMARY KEY CHECK (
        length(receipt_id) = 69 AND substr(receipt_id, 1, 5) = 'phr1:'
      ),
      incident_id TEXT NOT NULL UNIQUE CHECK (incident_id = 'G0-PRIVACY-001'),
      decision TEXT NOT NULL CHECK (decision IN (
        'retain_and_rotate', 'rewrite_and_rotate', 'new_root_and_rotate'
      )),
      action_status TEXT NOT NULL CHECK (action_status IN (
        'retained', 'rewrite_completed', 'new_root_completed'
      )),
      repository_visibility TEXT NOT NULL CHECK (
        repository_visibility IN ('public', 'private', 'removed')
      ),
      completed_at_ms INTEGER NOT NULL CHECK (
        typeof(completed_at_ms) = 'integer' AND completed_at_ms > 0
      ),
      attested_at_ms INTEGER NOT NULL CHECK (
        typeof(attested_at_ms) = 'integer' AND attested_at_ms >= completed_at_ms
      ),
      actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 128),
      record_json TEXT NOT NULL UNIQUE CHECK (json_valid(record_json))
    );

    CREATE TRIGGER trg_m5_privacy_rotation_exact
    BEFORE INSERT ON m5_privacy_rotation_receipts
    WHEN m5_privacy_rotation_receipt_valid_v1(NEW.record_json) != 1
      OR json_extract(NEW.record_json, '$.receiptId') IS NOT NEW.receipt_id
      OR json_extract(NEW.record_json, '$.incidentId') IS NOT NEW.incident_id
      OR json_extract(NEW.record_json, '$.categoryId') IS NOT NEW.category_id
      OR json_extract(NEW.record_json, '$.completedAtMs') IS NOT NEW.completed_at_ms
      OR json_extract(NEW.record_json, '$.attestedAtMs') IS NOT NEW.attested_at_ms
      OR json_extract(NEW.record_json, '$.actor.actorId') IS NOT NEW.actor_id
      OR json_extract(NEW.record_json, '$.secretValuesRecorded') IS NOT 0
    BEGIN
      SELECT RAISE(ABORT, 'M5_PRIVACY_ROTATION_AUTHORITY_MISMATCH');
    END;

    CREATE TRIGGER trg_m5_privacy_history_exact
    BEFORE INSERT ON m5_privacy_history_receipts
    WHEN m5_privacy_history_receipt_valid_v1(NEW.record_json) != 1
      OR json_extract(NEW.record_json, '$.receiptId') IS NOT NEW.receipt_id
      OR json_extract(NEW.record_json, '$.incidentId') IS NOT NEW.incident_id
      OR json_extract(NEW.record_json, '$.decision') IS NOT NEW.decision
      OR json_extract(NEW.record_json, '$.actionStatus') IS NOT NEW.action_status
      OR json_extract(NEW.record_json, '$.repositoryVisibility')
        IS NOT NEW.repository_visibility
      OR json_extract(NEW.record_json, '$.completedAtMs') IS NOT NEW.completed_at_ms
      OR json_extract(NEW.record_json, '$.attestedAtMs') IS NOT NEW.attested_at_ms
      OR json_extract(NEW.record_json, '$.actor.actorId') IS NOT NEW.actor_id
      OR json_extract(NEW.record_json, '$.operatorAuthorityConfirmed') IS NOT 1
      OR json_extract(NEW.record_json, '$.secretValuesRecorded') IS NOT 0
    BEGIN
      SELECT RAISE(ABORT, 'M5_PRIVACY_HISTORY_AUTHORITY_MISMATCH');
    END;

    CREATE TRIGGER trg_m5_privacy_rotation_append_only_update
    BEFORE UPDATE ON m5_privacy_rotation_receipts
    BEGIN
      SELECT RAISE(ABORT, 'm5_privacy_rotation_receipts is append-only');
    END;
    CREATE TRIGGER trg_m5_privacy_rotation_append_only_delete
    BEFORE DELETE ON m5_privacy_rotation_receipts
    BEGIN
      SELECT RAISE(ABORT, 'm5_privacy_rotation_receipts is append-only');
    END;
    CREATE TRIGGER trg_m5_privacy_history_append_only_update
    BEFORE UPDATE ON m5_privacy_history_receipts
    BEGIN
      SELECT RAISE(ABORT, 'm5_privacy_history_receipts is append-only');
    END;
    CREATE TRIGGER trg_m5_privacy_history_append_only_delete
    BEFORE DELETE ON m5_privacy_history_receipts
    BEGIN
      SELECT RAISE(ABORT, 'm5_privacy_history_receipts is append-only');
    END;

    CREATE TRIGGER trg_m5_user_settings_no_plaintext_credentials_insert
    BEFORE INSERT ON user_settings
    WHEN m5_privacy_user_settings_valid_v1(NEW.data) != 1
    BEGIN
      SELECT RAISE(ABORT, 'M5_PRIVACY_PLAINTEXT_SETTING_FORBIDDEN');
    END;

    CREATE TRIGGER trg_m5_user_settings_no_plaintext_credentials_update
    BEFORE UPDATE OF data ON user_settings
    WHEN m5_privacy_user_settings_valid_v1(NEW.data) != 1
    BEGIN
      SELECT RAISE(ABORT, 'M5_PRIVACY_PLAINTEXT_SETTING_FORBIDDEN');
    END;
  `);
}

export function up(db) {
  registerM5PrivacyAuthorityFunctions(db);
  const current = computeM5PrivacyAuthorityFingerprintV090(db);
  if (current === EXPECTED_M5_PRIVACY_AUTHORITY_FINGERPRINT_V090) return;
  const existing = db.prepare(`
    SELECT count(*) AS count FROM sqlite_master
    WHERE name IN (${OBJECT_NAMES.map(() => '?').join(',')})
  `).get(...OBJECT_NAMES).count;
  if (existing !== 0) throw new Error('M5_PRIVACY_AUTHORITY_090_SOURCE_OBJECT_MISMATCH');
  scrubObsoletePlaintextSettings(db);
  install(db);
  const installed = computeM5PrivacyAuthorityFingerprintV090(db);
  if (installed !== EXPECTED_M5_PRIVACY_AUTHORITY_FINGERPRINT_V090) {
    throw new Error(`M5_PRIVACY_AUTHORITY_090_FINAL_SCHEMA_FINGERPRINT_MISMATCH:${installed}`);
  }
}

export default { version, description, up };
