import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { AuditEvent, Project, Task } from '@intentsmith/contracts';

import { openIntentSmithDatabase } from './database.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('SQLite persistence', () => {
  it('migrates a new database and repeated migration is idempotent', () => {
    const { dbPath } = temporaryDatabase();
    const first = openIntentSmithDatabase(dbPath);
    first.close();
    const second = openIntentSmithDatabase(dbPath);
    second.close();

    const db = new Database(dbPath, { readonly: true });
    const migrations = db.prepare('SELECT id FROM schema_migrations ORDER BY id').all();
    db.close();
    expect(migrations).toEqual([{ id: '0001_phase1_core' }]);
  });

  it('round-trips validated projects, tasks and audit events', async () => {
    const { dbPath, root } = temporaryDatabase();
    const store = openIntentSmithDatabase(dbPath);
    const project = projectFixture(root);
    const task = taskFixture(project);
    const event = auditFixture(project.id, task.id);

    await store.create(project);
    await store.createTask(task);
    await store.append(event);

    expect(await store.get(project.id)).toEqual(project);
    expect(await store.getTask(task.id)).toEqual(task);
    expect(await store.listByTask(task.id)).toEqual([event]);
    expect('updateAudit' in store).toBe(false);
    expect('deleteAudit' in store).toBe(false);
    store.close();
  });

  it('rolls back an atomic transaction', async () => {
    const { dbPath, root } = temporaryDatabase();
    const store = openIntentSmithDatabase(dbPath);
    const project = projectFixture(root);

    await expect(store.transaction(async () => {
      await store.create(project);
      throw new Error('rollback');
    })).rejects.toThrow('rollback');

    expect(await store.get(project.id)).toBeNull();
    store.close();
  });

  it('enforces foreign keys', async () => {
    const { dbPath, root } = temporaryDatabase();
    const store = openIntentSmithDatabase(dbPath);
    await expect(store.createTask(taskFixture(projectFixture(root)))).rejects.toThrow();
    store.close();
  });

  it('enables WAL, foreign keys and busy timeout', () => {
    const { dbPath } = temporaryDatabase();
    const store = openIntentSmithDatabase(dbPath);
    expect(store.pragmaValue('journal_mode')).toBe('wal');
    expect(store.pragmaValue('foreign_keys')).toBe(1);
    expect(Number(store.pragmaValue('busy_timeout'))).toBe(5000);
    store.close();
  });

  it('rejects corrupt persisted JSON instead of silently falling back', async () => {
    const { dbPath, root } = temporaryDatabase();
    const store = openIntentSmithDatabase(dbPath);
    const project = projectFixture(root);
    await store.create(project);

    const raw = new Database(dbPath);
    raw.prepare('UPDATE projects SET payload_json = ? WHERE id = ?').run('{broken', project.id);
    raw.close();

    await expect(store.get(project.id)).rejects.toMatchObject({ code: 'CORRUPT_PERSISTED_JSON' });
    store.close();
  });
});

function temporaryDatabase(): { dbPath: string; root: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'intentsmith-db-'));
  temporaryDirectories.push(root);
  return { root, dbPath: path.join(root, 'intentsmith.db') };
}

function projectFixture(rootPath: string): Project {
  return {
    id: 'project_1',
    name: 'Test project',
    rootPath,
    trustState: 'untrusted',
    status: 'active',
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
  };
}

function taskFixture(project: Project): Task {
  return {
    id: 'task_1',
    projectId: project.id,
    dependencyIds: [],
    type: 'code',
    goal: 'Verify persistence',
    scope: {
      fsReadRoots: [project.rootPath],
      fsWriteRoots: [project.rootPath],
      allowedCommandFamilies: [],
      deniedCommandPatterns: [],
      network: { mode: 'disabled', allowlist: [] },
      envAllowlist: [],
      secrets: 'none',
      processSpawning: 'disabled',
      timeoutMs: 1000,
      maxActions: 0,
      approvalRules: [],
    },
    inputs: [],
    expectedOutputs: ['round trip'],
    acceptanceCriteria: ['same payload'],
    workerPreference: { kind: 'fake', scenario: 'success' },
    timeoutMs: 1000,
    retryPolicy: { maxAttempts: 1, backoffMs: 0 },
    status: 'pending',
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
  };
}

function auditFixture(projectId: string, taskId: string): AuditEvent {
  return {
    id: 'audit_1',
    projectId,
    taskId,
    type: 'task.created',
    message: 'Task created',
    data: {},
    createdAt: '2026-07-27T00:00:00.000Z',
  };
}
