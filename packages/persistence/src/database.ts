import Database from 'better-sqlite3';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync } from 'node:fs';
import type { Static, TSchema } from '@sinclair/typebox';

import {
  AuditEventSchema,
  CapabilityApprovalSchema,
  ProjectSchema,
  TaskResultSchema,
  TaskRunSchema,
  TaskSchema,
  parseWithSchema,
  type AuditEvent,
  type CapabilityApproval,
  type Project,
  type Task,
  type TaskResult,
  type TaskRun,
  type TaskRunStatus,
} from '@intentsmith/contracts';
import type {
  ApprovalRepository,
  AuditRepository,
  ProjectRepository,
  TaskRepository,
  TransactionManager,
} from '@intentsmith/core';
import { DomainError } from '@intentsmith/core';

const MIGRATIONS = [
  {
    id: '0001_phase1_core',
    sql: `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  trust_state TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  status TEXT NOT NULL,
  type TEXT NOT NULL,
  latest_run_id TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  attempt INTEGER NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  payload_json TEXT NOT NULL,
  UNIQUE(task_id, attempt)
);

CREATE TABLE IF NOT EXISTS task_results (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE RESTRICT,
  core_verdict TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  project_id TEXT,
  task_id TEXT,
  run_id TEXT,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_task ON task_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_task_results_task ON task_results(task_id);
CREATE INDEX IF NOT EXISTS idx_audit_task_seq ON audit_events(task_id, seq);
`,
  },
  {
    id: '0002_capability_approvals',
    sql: `
CREATE TABLE IF NOT EXISTS capability_approvals (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE RESTRICT,
  action_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  state TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  -- One live approval per (run, action, payload). A worker that asks twice for
  -- the same thing is answered once; a worker that asks for something different
  -- gets a different row, because the payload is part of the identity.
  UNIQUE(run_id, action_id, payload_hash)
);

CREATE INDEX IF NOT EXISTS idx_approvals_run ON capability_approvals(run_id);
CREATE INDEX IF NOT EXISTS idx_approvals_state ON capability_approvals(state);
`,
  },
] as const;

export type SQLiteStore = ProjectRepository &
  TaskRepository &
  AuditRepository &
  ApprovalRepository &
  TransactionManager & {
    close(): void;
    pragmaValue(name: string): unknown;
  };

export function openIntentSmithDatabase(dbPath: string): SQLiteStore {
  if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return new BetterSqliteStore(db);
}

export function migrate(db: Database.Database): void {
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  // A database written by a newer build carries migrations this code does not
  // know how to interpret. Refuse it instead of silently reading unknown rows.
  const known = new Set<string>(MIGRATIONS.map(migration => migration.id));
  const applied = db.prepare('SELECT id FROM schema_migrations').all() as Array<{ id: string }>;
  const unknown = applied.map(row => row.id).filter(id => !known.has(id));
  if (unknown.length > 0) {
    throw new DomainError(
      'UNKNOWN_SCHEMA_VERSION',
      `Database contains unknown schema migrations: ${unknown.sort().join(', ')}`,
    );
  }

  for (const migration of MIGRATIONS) {
    const applied = db.prepare('SELECT id FROM schema_migrations WHERE id = ?').get(migration.id);
    if (applied) continue;
    const transaction = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(migration.id, new Date().toISOString());
    });
    transaction();
  }
}

class BetterSqliteStore implements SQLiteStore {
  /** Serializes top-level transactions; see {@link transaction}. */
  private tail: Promise<unknown> = Promise.resolve();

  /**
   * Tracks whether the current async execution context already runs inside a
   * transaction *on this connection*. better-sqlite3 exposes a single
   * connection with a single transaction slot, so a nested `BEGIN IMMEDIATE`
   * fails with "cannot start a transaction within a transaction".
   *
   * This is deliberately instance-owned rather than module-level. A shared
   * context would make a transaction opened on one store look reentrant to a
   * different store nested inside it, and that store would then run its writes
   * with no transaction at all, silently losing its rollback. Instance
   * ownership also keeps independent databases free of any shared
   * synchronization: each store serializes only its own connection.
   */
  private readonly transactionContext = new AsyncLocalStorage<{ depth: number }>();

  constructor(private readonly db: Database.Database) {}

  /**
   * Runs `fn` inside a single SQLite transaction.
   *
   * Phase 1 issued `BEGIN IMMEDIATE` directly, so two overlapping callers (for
   * example a lifecycle command racing the finalization of a worker run) made
   * the second caller fail with a raw SQLite error instead of a domain error.
   * Top-level transactions are now serialized through a promise queue, and a
   * reentrant call joins the transaction already open on this connection
   * rather than starting a second one. Reentrancy is scoped to this store, so
   * a transaction on another database nested inside this one still gets its
   * own real transaction.
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const open = this.transactionContext.getStore();
    if (open) {
      open.depth += 1;
      try {
        return await fn();
      } finally {
        open.depth -= 1;
      }
    }
    return await this.enqueue(async () => {
      this.db.prepare('BEGIN IMMEDIATE').run();
      try {
        const result = await this.transactionContext.run({ depth: 1 }, fn);
        this.db.prepare('COMMIT').run();
        return result;
      } catch (error) {
        // The transaction may already be closed if SQLite aborted it itself.
        if (this.db.inTransaction) this.db.prepare('ROLLBACK').run();
        throw error;
      }
    });
  }

  /** Appends `fn` to the serial queue regardless of the previous outcome. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async create(project: Project): Promise<void> {
    parseWithSchema(ProjectSchema, project);
    this.db.prepare(`
      INSERT INTO projects (id, name, root_path, trust_state, status, payload_json, created_at, updated_at)
      VALUES (@id, @name, @rootPath, @trustState, @status, @payload, @createdAt, @updatedAt)
    `).run({ ...project, payload: JSON.stringify(project) });
  }

  async get(id: string): Promise<Project | null> {
    const row = this.db.prepare('SELECT payload_json FROM projects WHERE id = ?').get(id) as JsonRow | undefined;
    return row ? parseJson(ProjectSchema, row.payload_json) : null;
  }

  async createTask(task: Task): Promise<void> {
    parseWithSchema(TaskSchema, task);
    this.db.prepare(`
      INSERT INTO tasks (id, project_id, status, type, latest_run_id, payload_json, created_at, updated_at)
      VALUES (@id, @projectId, @status, @type, @latestRunId, @payload, @createdAt, @updatedAt)
    `).run({ ...task, latestRunId: task.latestRunId ?? null, payload: JSON.stringify(task) });
  }

  async getTask(id: string): Promise<Task | null> {
    const row = this.db.prepare('SELECT payload_json FROM tasks WHERE id = ?').get(id) as JsonRow | undefined;
    return row ? parseJson(TaskSchema, row.payload_json) : null;
  }

  async update(task: Task): Promise<void> {
    parseWithSchema(TaskSchema, task);
    const result = this.db.prepare(`
      UPDATE tasks SET status = @status, type = @type, latest_run_id = @latestRunId, payload_json = @payload, updated_at = @updatedAt
      WHERE id = @id
    `).run({ ...task, latestRunId: task.latestRunId ?? null, payload: JSON.stringify(task) });
    if (result.changes !== 1) throw new DomainError('TASK_NOT_FOUND', `Task not found: ${task.id}`);
  }

  async createRun(run: TaskRun): Promise<void> {
    parseWithSchema(TaskRunSchema, run);
    this.db.prepare(`
      INSERT INTO task_runs (id, task_id, attempt, status, started_at, ended_at, payload_json)
      VALUES (@id, @taskId, @attempt, @status, @startedAt, @endedAt, @payload)
    `).run({ ...run, endedAt: run.endedAt ?? null, payload: JSON.stringify(run) });
  }

  async getRun(id: string): Promise<TaskRun | null> {
    const row = this.db.prepare('SELECT payload_json FROM task_runs WHERE id = ?').get(id) as JsonRow | undefined;
    return row ? parseJson(TaskRunSchema, row.payload_json) : null;
  }

  async updateRun(run: TaskRun): Promise<void> {
    parseWithSchema(TaskRunSchema, run);
    const result = this.db.prepare(`
      UPDATE task_runs SET status = @status, ended_at = @endedAt, payload_json = @payload
      WHERE id = @id
    `).run({ ...run, endedAt: run.endedAt ?? null, payload: JSON.stringify(run) });
    if (result.changes !== 1) throw new DomainError('TASK_RUN_NOT_FOUND', `Task run not found: ${run.id}`);
  }

  async listRuns(taskId: string): Promise<TaskRun[]> {
    const rows = this.db
      .prepare('SELECT payload_json FROM task_runs WHERE task_id = ? ORDER BY attempt ASC')
      .all(taskId) as JsonRow[];
    return rows.map(row => parseJson(TaskRunSchema, row.payload_json));
  }

  async listRunsByStatus(statuses: readonly TaskRunStatus[]): Promise<TaskRun[]> {
    if (statuses.length === 0) return [];
    const placeholders = statuses.map(() => '?').join(', ');
    const rows = this.db
      .prepare(`SELECT payload_json FROM task_runs WHERE status IN (${placeholders}) ORDER BY started_at ASC, id ASC`)
      .all(...statuses) as JsonRow[];
    return rows.map(row => parseJson(TaskRunSchema, row.payload_json));
  }

  async countRuns(taskId: string): Promise<number> {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM task_runs WHERE task_id = ?').get(taskId) as { count: number };
    return row.count;
  }

  async saveResult(result: TaskResult): Promise<void> {
    parseWithSchema(TaskResultSchema, result);
    this.db.prepare(`
      INSERT INTO task_results (id, task_id, run_id, core_verdict, payload_json, created_at)
      VALUES (@id, @taskId, @runId, @coreVerdict, @payload, @createdAt)
    `).run({ ...result, payload: JSON.stringify(result) });
  }

  async getResultByRun(runId: string): Promise<TaskResult | null> {
    const row = this.db
      .prepare('SELECT payload_json FROM task_results WHERE run_id = ? ORDER BY created_at ASC, id ASC LIMIT 1')
      .get(runId) as JsonRow | undefined;
    return row ? parseJson(TaskResultSchema, row.payload_json) : null;
  }

  async getResult(taskId: string): Promise<TaskResult | null> {
    const row = this.db.prepare('SELECT payload_json FROM task_results WHERE task_id = ? ORDER BY created_at DESC, id DESC LIMIT 1').get(taskId) as JsonRow | undefined;
    return row ? parseJson(TaskResultSchema, row.payload_json) : null;
  }

  async append(event: AuditEvent): Promise<void> {
    parseWithSchema(AuditEventSchema, event);
    this.db.prepare(`
      INSERT INTO audit_events (id, project_id, task_id, run_id, type, payload_json, created_at)
      VALUES (@id, @projectId, @taskId, @runId, @type, @payload, @createdAt)
    `).run({
      id: event.id,
      projectId: event.projectId ?? null,
      taskId: event.taskId ?? null,
      runId: event.runId ?? null,
      type: event.type,
      payload: JSON.stringify(event),
      createdAt: event.createdAt,
    });
  }

  async createApproval(approval: CapabilityApproval): Promise<void> {
    parseWithSchema(CapabilityApprovalSchema, approval);
    this.db.prepare(`
      INSERT INTO capability_approvals
        (id, task_id, run_id, action_id, payload_hash, state, requested_at, expires_at, payload_json)
      VALUES (@id, @taskId, @runId, @actionId, @payloadHash, @state, @requestedAt, @expiresAt, @payload)
    `).run({ ...approval, payload: JSON.stringify(approval) });
  }

  async getApproval(id: string): Promise<CapabilityApproval | null> {
    const row = this.db
      .prepare('SELECT payload_json FROM capability_approvals WHERE id = ?')
      .get(id) as JsonRow | undefined;
    return row ? parseJson(CapabilityApprovalSchema, row.payload_json) : null;
  }

  async findApproval(runId: string, actionId: string, payloadHash: string): Promise<CapabilityApproval | null> {
    const row = this.db
      .prepare('SELECT payload_json FROM capability_approvals WHERE run_id = ? AND action_id = ? AND payload_hash = ?')
      .get(runId, actionId, payloadHash) as JsonRow | undefined;
    return row ? parseJson(CapabilityApprovalSchema, row.payload_json) : null;
  }

  /**
   * Writes a new state only when the approval is still in the state the caller
   * read.
   *
   * The guard is what makes approve-vs-cancel and approve-vs-expire safe: the
   * loser of the race updates zero rows and is told so, rather than overwriting
   * a terminal state with a stale one.
   */
  async updateApprovalState(
    approval: CapabilityApproval,
    expectedState: CapabilityApproval['state'],
  ): Promise<boolean> {
    parseWithSchema(CapabilityApprovalSchema, approval);
    const result = this.db.prepare(`
      UPDATE capability_approvals
         SET state = @state, payload_json = @payload
       WHERE id = @id AND state = @expectedState
    `).run({ id: approval.id, state: approval.state, payload: JSON.stringify(approval), expectedState });
    return result.changes === 1;
  }

  async listApprovalsByRun(runId: string): Promise<CapabilityApproval[]> {
    const rows = this.db
      .prepare('SELECT payload_json FROM capability_approvals WHERE run_id = ? ORDER BY requested_at ASC, id ASC')
      .all(runId) as JsonRow[];
    return rows.map(row => parseJson(CapabilityApprovalSchema, row.payload_json));
  }

  async listApprovalsByState(states: readonly CapabilityApproval['state'][]): Promise<CapabilityApproval[]> {
    if (states.length === 0) return [];
    const placeholders = states.map(() => '?').join(', ');
    const rows = this.db
      .prepare(`SELECT payload_json FROM capability_approvals WHERE state IN (${placeholders}) ORDER BY requested_at ASC, id ASC`)
      .all(...states) as JsonRow[];
    return rows.map(row => parseJson(CapabilityApprovalSchema, row.payload_json));
  }

  async listByTask(taskId: string): Promise<AuditEvent[]> {
    const rows = this.db.prepare('SELECT payload_json FROM audit_events WHERE task_id = ? ORDER BY seq ASC').all(taskId) as JsonRow[];
    return rows.map(row => parseJson(AuditEventSchema, row.payload_json));
  }

  pragmaValue(name: string): unknown {
    return this.db.pragma(name, { simple: true });
  }

  close(): void {
    this.db.close();
  }
}

type JsonRow = {
  payload_json: string;
};

function parseJson<T extends TSchema>(schema: T, payload: string): Static<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new DomainError('CORRUPT_PERSISTED_JSON', 'Persisted JSON payload is not valid JSON.');
  }
  return parseWithSchema(schema, parsed);
}
