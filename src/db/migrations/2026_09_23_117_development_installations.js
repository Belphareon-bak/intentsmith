export const version = '2026_09_23_117_development_installations';
export const description = 'Explicit dependency installation policy, exact plans and append-only events';
export function up(db) {
  db.exec(`
    CREATE TABLE development_install_policy (
      id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL,
      project_mode TEXT NOT NULL CHECK(project_mode IN ('ask','automatic','disabled')),
      sdk_mode TEXT NOT NULL CHECK(sdk_mode IN ('ask','automatic','disabled')),
      updated_at INTEGER NOT NULL
    );
    INSERT INTO development_install_policy VALUES(1,1,'ask','ask',0);
    CREATE TABLE development_installations (
      id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, project_id INTEGER NOT NULL REFERENCES projects(id),
      plan_json TEXT NOT NULL CHECK(json_valid(plan_json)), plan_digest TEXT NOT NULL,
      policy_revision INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('pending','running','succeeded','failed','cancelled','interrupted')),
      result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json))
    );
    CREATE UNIQUE INDEX development_one_running ON development_installations(state) WHERE state='running';
    CREATE TRIGGER development_plan_immutable BEFORE UPDATE ON development_installations
      WHEN NEW.id!=OLD.id OR NEW.actor_id!=OLD.actor_id OR NEW.project_id!=OLD.project_id
        OR NEW.plan_json!=OLD.plan_json OR NEW.plan_digest!=OLD.plan_digest
        OR NEW.policy_revision!=OLD.policy_revision OR NEW.created_at!=OLD.created_at OR NEW.expires_at!=OLD.expires_at
      BEGIN SELECT RAISE(ABORT,'installation plan is immutable'); END;
    CREATE TABLE development_install_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, installation_id TEXT REFERENCES development_installations(id),
      actor_id TEXT NOT NULL, kind TEXT NOT NULL, occurred_at INTEGER NOT NULL,
      detail_json TEXT NOT NULL CHECK(json_valid(detail_json))
    );
    CREATE TRIGGER development_events_no_update BEFORE UPDATE ON development_install_events
      BEGIN SELECT RAISE(ABORT,'installation audit is append-only'); END;
    CREATE TRIGGER development_events_no_delete BEFORE DELETE ON development_install_events
      BEGIN SELECT RAISE(ABORT,'installation audit is append-only'); END;
  `);
}
export default { version, description, up };
