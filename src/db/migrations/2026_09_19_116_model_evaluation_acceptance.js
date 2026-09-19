// Přejímka belongs to the existing evaluation history, never to a config flag.
export const version = '2026_09_19_116_model_evaluation_acceptance';
export const description = 'Append-only exact-contract evaluation acceptance and revocation evidence';
export function up(db) {
  db.exec(`
    CREATE TABLE model_evaluation_acceptances (
      acceptance_id TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK(role IN ('D1','D2','CODE','R1','R2','CHAT','VISION')),
      contract_sha256 TEXT NOT NULL CHECK(length(contract_sha256)=64 AND contract_sha256 NOT GLOB '*[^0-9a-f]*'),
      kind TEXT NOT NULL CHECK(kind IN ('GRADER','OPERATIONAL','REVOKE')),
      target_id TEXT REFERENCES model_evaluation_acceptances(acceptance_id),
      payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
      payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'),
      recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      CHECK((kind='REVOKE') = (target_id IS NOT NULL))
    );
    CREATE INDEX idx_evaluation_acceptances_contract ON model_evaluation_acceptances(role, contract_sha256);
    CREATE TRIGGER trg_evaluation_acceptance_revoke BEFORE INSERT ON model_evaluation_acceptances
    WHEN NEW.kind='REVOKE' BEGIN
      SELECT RAISE(ABORT,'revocation target mismatch') WHERE NOT EXISTS (
        SELECT 1 FROM model_evaluation_acceptances WHERE acceptance_id=NEW.target_id
        AND kind!='REVOKE' AND role=NEW.role AND contract_sha256=NEW.contract_sha256);
    END;
    CREATE TRIGGER trg_evaluation_acceptances_no_update BEFORE UPDATE ON model_evaluation_acceptances
    BEGIN SELECT RAISE(ABORT,'evaluation acceptance is append-only'); END;
    CREATE TRIGGER trg_evaluation_acceptances_no_delete BEFORE DELETE ON model_evaluation_acceptances
    BEGIN SELECT RAISE(ABORT,'evaluation acceptance is append-only'); END;
  `);
}
export default { version, description, up };
