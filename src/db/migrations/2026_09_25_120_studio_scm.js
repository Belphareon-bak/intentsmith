export const version = '2026_09_25_120_studio_scm';
export const description = 'Per-project source control policy, exact operations, audit and shared M2 write exclusion';
export function up(db) {
  db.exec(`
    CREATE TABLE scm_project_policy (
      project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE RESTRICT,
      revision INTEGER NOT NULL CHECK(revision > 0),
      init_mode TEXT NOT NULL CHECK(init_mode IN ('ask','automatic','disabled')),
      commit_mode TEXT NOT NULL CHECK(commit_mode IN ('ask','automatic','disabled')),
      branch_mode TEXT NOT NULL CHECK(branch_mode IN ('ask','disabled')),
      fetch_mode TEXT NOT NULL CHECK(fetch_mode IN ('ask','automatic','disabled')),
      pull_mode TEXT NOT NULL CHECK(pull_mode IN ('ask','automatic','disabled')),
      push_mode TEXT NOT NULL CHECK(push_mode IN ('ask','disabled')),
      remotes_json TEXT NOT NULL CHECK(json_valid(remotes_json)),
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE scm_operations (
      plan_id TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      op TEXT NOT NULL CHECK(op IN ('init','stage','unstage','commit','branch.create','checkout','fetch','pull','push')),
      plan_json TEXT NOT NULL CHECK(json_valid(plan_json)),
      digest TEXT NOT NULL CHECK(length(digest)=71 AND substr(digest,1,7)='sha256:'),
      policy_revision INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('pending','running','succeeded','failed','cancelled','interrupted')),
      result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json))
    );
    CREATE UNIQUE INDEX scm_one_running_per_project ON scm_operations(project_id) WHERE state='running';
    CREATE TRIGGER scm_plan_immutable BEFORE UPDATE ON scm_operations
    WHEN NEW.plan_id!=OLD.plan_id OR NEW.actor_id!=OLD.actor_id OR NEW.project_id!=OLD.project_id
      OR NEW.op!=OLD.op OR NEW.plan_json!=OLD.plan_json OR NEW.digest!=OLD.digest
      OR NEW.policy_revision!=OLD.policy_revision OR NEW.created_at!=OLD.created_at OR NEW.expires_at!=OLD.expires_at
    BEGIN SELECT RAISE(ABORT,'SCM_PLAN_IMMUTABLE'); END;
    CREATE TABLE scm_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id TEXT REFERENCES scm_operations(plan_id) ON DELETE RESTRICT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      actor_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      occurred_at INTEGER NOT NULL,
      detail_json TEXT NOT NULL CHECK(json_valid(detail_json))
    );
    CREATE TRIGGER scm_events_no_update BEFORE UPDATE ON scm_events
      BEGIN SELECT RAISE(ABORT,'SCM_AUDIT_APPEND_ONLY'); END;
    CREATE TRIGGER scm_events_no_delete BEFORE DELETE ON scm_events
      BEGIN SELECT RAISE(ABORT,'SCM_AUDIT_APPEND_ONLY'); END;
    -- M2 claims are serialized through this same database. A running SCM effect
    -- blocks a new M2 write claim until the SCM terminal state is recorded.
    CREATE TRIGGER scm_m2_shared_project_write_lock_renewal BEFORE INSERT ON m2_execution_claim_renewals
    WHEN EXISTS (
      SELECT 1 FROM scm_operations scm JOIN m2_execution_requests req ON req.execution_id=NEW.execution_id
      WHERE scm.project_id=req.project_id AND scm.state='running'
    ) BEGIN SELECT RAISE(ABORT,'SCM_PROJECT_WRITE_BUSY'); END;
    CREATE TRIGGER scm_m2_shared_project_write_lock BEFORE INSERT ON m2_execution_claims
    WHEN EXISTS (
      SELECT 1 FROM scm_operations scm JOIN m2_execution_requests req ON req.execution_id=NEW.execution_id
      WHERE scm.project_id=req.project_id AND scm.state='running'
    ) BEGIN SELECT RAISE(ABORT,'SCM_PROJECT_WRITE_BUSY'); END;
  `);
}
export default { version, description, up };
