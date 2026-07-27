import Database from 'better-sqlite3';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import type { Static, TSchema } from '@sinclair/typebox';

import {
  AuditEventSchema,
  ProjectSchema,
  TaskResultSchema,
  TaskRunSchema,
  TaskSchema,
  parseWithSchema,
  type AuditEvent,
  type Project,
  type Task,
  type TaskResult,
  type TaskRun,
} from '@intentsmith/contracts';
import type { AuditRepository, ProjectRepository, TaskRepository, TransactionManager } from '@intentsmith/core';
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
] as const;

export type SQLiteStore = ProjectRepository & TaskRepository & AuditRepository & TransactionManager & {
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
  constructor(private readonly db: Database.Database) {}

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    this.db.prepare('BEGIN IMMEDIATE').run();
    try {
      const result = await fn();
      this.db.prepare('COMMIT').run();
      return result;
    } catch (error) {
      this.db.prepare('ROLLBACK').run();
      throw error;
    }
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
