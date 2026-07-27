import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { AuditEvent, Task, TaskRun } from '@intentsmith/contracts';
import { DomainError, IntentSmithCore, type Clock, type IdGenerator, type Timer } from '@intentsmith/core';

import Database from 'better-sqlite3';

import { openIntentSmithDatabase, type SQLiteStore } from './database.js';

/** Opens a second raw handle purely to inject corruption a real caller cannot. */
function rawHandle(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  cleanups.push(() => db.close());
  return db;
}

/**
 * Persistence, transaction and restart-recovery tests.
 *
 * These live in the persistence package so they can exercise the store
 * directly, including failure injection that the public core API cannot reach.
 */

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function tempDbPath(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'intentsmith-recovery-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'state.db');
}

function openStore(dbPath: string): SQLiteStore {
  const store = openIntentSmithDatabase(dbPath);
  cleanups.push(() => {
    try {
      store.close();
    } catch {
      // Already closed by the test.
    }
  });
  return store;
}

class StaticClock implements Clock {
  constructor(private value = '2026-07-27T00:00:00.000Z') {}
  now(): string {
    return this.value;
  }
}

/**
 * Deterministic ids. A restarted process must use a distinct `epoch` so its
 * ids do not collide with those written before the restart, mirroring the
 * UUID generator used in production.
 */
class SeqIds implements IdGenerator {
  private readonly counters = new Map<string, number>();
  constructor(private readonly epoch = 'a') {}
  next(prefix: string): string {
    const next = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, next);
    return `${prefix}_${this.epoch}${String(next).padStart(4, '0')}`;
  }
}

const inertTimer: Timer = { schedule: () => () => undefined };

const workspaceRoot = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'intentsmith-ws-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

function makeCore(store: SQLiteStore, epoch = 'a'): IntentSmithCore {
  return new IntentSmithCore({
    clock: new StaticClock(),
    ids: new SeqIds(epoch),
    timer: inertTimer,
    projects: store,
    tasks: store,
    audit: store,
    transactions: store,
    worker: {
      describe: () => ({ id: 'inert', version: '0', capabilities: { pause: false, cancel: false } }),
      // Never settles, so a run stays `running` until the process "dies".
      start: () => ({
        done: new Promise(() => undefined),
        pause: async () => undefined,
        resume: async () => undefined,
        cancel: async () => undefined,
      }),
    },
  });
}

function sampleProject(rootPath: string) {
  return {
    id: 'project_0001',
    name: 'persist',
    rootPath,
    trustState: 'untrusted' as const,
    status: 'active' as const,
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
  };
}

function sampleTask(projectId: string, rootPath: string): Task {
  return {
    id: 'task_0001',
    projectId,
    dependencyIds: [],
    type: 'code',
    goal: 'persist me',
    scope: {
      fsReadRoots: [rootPath],
      fsWriteRoots: [rootPath],
      allowedCommandFamilies: [],
      deniedCommandPatterns: [],
      network: { mode: 'disabled', allowlist: [] },
      envAllowlist: ['PATH'],
      secrets: 'none',
      processSpawning: 'disabled',
      timeoutMs: 1000,
      maxActions: 0,
      approvalRules: [],
    },
    inputs: [],
    expectedOutputs: ['out'],
    acceptanceCriteria: ['ok'],
    workerPreference: { kind: 'fake', scenario: 'success' },
    timeoutMs: 1000,
    retryPolicy: { maxAttempts: 1, backoffMs: 0 },
    status: 'running',
    latestRunId: 'run_0001',
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
  };
}

function auditEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: 'audit_0001',
    projectId: 'project_0001',
    taskId: 'task_0001',
    type: 'task.transition',
    message: 'transition',
    data: {},
    createdAt: '2026-07-27T00:00:00.000Z',
    ...overrides,
  };
}

describe('persistence transactions', () => {
  it('commits a lifecycle change and its audit event atomically', async () => {
    const store = openStore(tempDbPath());
    const root = workspaceRoot();
    await store.create(sampleProject(root));
    await store.transaction(async () => {
      await store.createTask(sampleTask('project_0001', root));
      await store.append(auditEvent());
    });

    expect((await store.getTask('task_0001'))?.status).toBe('running');
    expect(await store.listByTask('task_0001')).toHaveLength(1);
  });

  it('rolls back the lifecycle change when the audit append fails', async () => {
    const store = openStore(tempDbPath());
    const root = workspaceRoot();
    await store.create(sampleProject(root));

    await expect(
      store.transaction(async () => {
        await store.createTask(sampleTask('project_0001', root));
        // Invalid audit type; schema validation rejects it.
        await store.append(auditEvent({ type: 'not.a.real.type' as AuditEvent['type'] }));
      }),
    ).rejects.toBeDefined();

    expect(await store.getTask('task_0001')).toBeNull();
    expect(await store.listByTask('task_0001')).toHaveLength(0);
  });

  it('rolls back the audit event when the lifecycle change fails', async () => {
    const store = openStore(tempDbPath());
    const root = workspaceRoot();
    await store.create(sampleProject(root));

    await expect(
      store.transaction(async () => {
        await store.append(auditEvent());
        // Updating a task that does not exist fails after the audit insert.
        await store.update(sampleTask('project_0001', root));
      }),
    ).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' });

    expect(await store.listByTask('task_0001')).toHaveLength(0);
  });

  it('serializes concurrent transactions through the supported application API', async () => {
    const store = openStore(tempDbPath());
    const root = workspaceRoot();
    await store.create(sampleProject(root));
    await store.createTask(sampleTask('project_0001', root));

    // Regression: overlapping transactions used to fail with a raw
    // "cannot start a transaction within a transaction" SQLite error.
    const writes = Array.from({ length: 8 }, (_, index) =>
      store.transaction(async () => {
        await store.append(auditEvent({ id: `audit_${String(index).padStart(4, '0')}` }));
      }),
    );
    await expect(Promise.all(writes)).resolves.toBeDefined();
    expect(await store.listByTask('task_0001')).toHaveLength(8);
  });

  it('joins a reentrant transaction instead of opening a nested one', async () => {
    const store = openStore(tempDbPath());
    const root = workspaceRoot();
    await store.create(sampleProject(root));

    await store.transaction(async () => {
      await store.createTask(sampleTask('project_0001', root));
      await store.transaction(async () => {
        await store.append(auditEvent());
      });
    });
    expect(await store.listByTask('task_0001')).toHaveLength(1);
  });

  it('keeps audit ordering monotonic', async () => {
    const store = openStore(tempDbPath());
    const root = workspaceRoot();
    await store.create(sampleProject(root));
    await store.createTask(sampleTask('project_0001', root));

    for (let index = 0; index < 5; index += 1) {
      await store.append(auditEvent({ id: `audit_${index}`, message: `event ${index}` }));
    }
    const events = await store.listByTask('task_0001');
    expect(events.map(event => event.message)).toEqual([
      'event 0',
      'event 1',
      'event 2',
      'event 3',
      'event 4',
    ]);
  });

  it('exposes no update or delete for audit events', () => {
    const store = openStore(tempDbPath());
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(store));
    expect(surface.filter(name => /audit/i.test(name))).toEqual([]);
    expect(surface).not.toContain('updateAuditEvent');
    expect(surface).not.toContain('deleteAuditEvent');
    // `append` and `listByTask` are the entire audit surface.
    expect(surface).toContain('append');
    expect(surface).toContain('listByTask');
  });

  it('applies a busy timeout pragma', () => {
    const store = openStore(tempDbPath());
    expect(Number(store.pragmaValue('busy_timeout'))).toBeGreaterThan(0);
  });

  it('rejects corrupt persisted JSON', async () => {
    const dbPath = tempDbPath();
    const store = openStore(dbPath);
    const root = workspaceRoot();
    await store.create(sampleProject(root));
    await store.createTask(sampleTask('project_0001', root));
    rawHandle(dbPath).prepare('UPDATE tasks SET payload_json = ? WHERE id = ?').run('{not json', 'task_0001');

    await expect(store.getTask('task_0001')).rejects.toMatchObject({ code: 'CORRUPT_PERSISTED_JSON' });
  });

  it('rejects a persisted payload that no longer matches the schema', async () => {
    const dbPath = tempDbPath();
    const store = openStore(dbPath);
    const root = workspaceRoot();
    await store.create(sampleProject(root));
    await store.createTask(sampleTask('project_0001', root));
    rawHandle(dbPath)
      .prepare('UPDATE tasks SET payload_json = ? WHERE id = ?')
      .run(JSON.stringify({ id: 'task_0001', schemaVersion: 999 }), 'task_0001');

    await expect(store.getTask('task_0001')).rejects.toMatchObject({ code: 'CONTRACT_VALIDATION_FAILED' });
  });

  it('rejects an unknown schema migration version', () => {
    const dbPath = tempDbPath();
    const store = openStore(dbPath);
    rawHandle(dbPath)
      .prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)')
      .run('9999_from_the_future', '2026-07-27T00:00:00.000Z');
    store.close();

    expect(() => openIntentSmithDatabase(dbPath)).toThrow(DomainError);
  });
});

describe('restart recovery', () => {
  it('restores terminal runs unchanged after close and reopen', async () => {
    const dbPath = tempDbPath();
    const first = openStore(dbPath);
    const root = workspaceRoot();
    await first.create(sampleProject(root));
    await first.createTask({ ...sampleTask('project_0001', root), status: 'passed' });
    const run: TaskRun = {
      id: 'run_0001',
      taskId: 'task_0001',
      attempt: 1,
      status: 'passed',
      startedAt: '2026-07-27T00:00:00.000Z',
      endedAt: '2026-07-27T00:00:01.000Z',
    };
    await first.createRun(run);
    first.close();

    const second = openStore(dbPath);
    expect(await second.getRun('run_0001')).toEqual(run);
    expect((await second.getTask('task_0001'))?.status).toBe('passed');

    // Recovery must not touch a run that already reached a terminal state.
    const core = makeCore(second);
    expect(await core.recoverInterruptedRuns()).toEqual([]);
    expect(await second.getRun('run_0001')).toEqual(run);
  });

  it('closes an orphaned running run instead of presenting it as live', async () => {
    const dbPath = tempDbPath();
    const root = workspaceRoot();
    const first = openStore(dbPath);
    const core = makeCore(first);
    const project = await core.createProject({ name: 'orphan', rootPath: root });
    const task = await core.createTask({
      projectId: project.id,
      type: 'code',
      goal: 'orphan me',
      scope: sampleTask(project.id, root).scope,
      expectedOutputs: ['out'],
      acceptanceCriteria: ['ok'],
    });
    await core.startTask(task.id);
    expect((await core.getTask(task.id)).status).toBe('running');
    // Simulate an unexpected process exit: the DB keeps a `running` row.
    first.close();

    const second = openStore(dbPath);
    const recoveredCore = makeCore(second, 'b');
    const runsBefore = await second.listRuns(task.id);
    expect(runsBefore[0]?.status).toBe('running');

    const recovered = await recoveredCore.recoverInterruptedRuns();
    expect(recovered).toHaveLength(1);

    const run = (await second.listRuns(task.id))[0]!;
    expect(run.status).toBe('failed');
    expect(run.endedAt).toBeDefined();
    expect((await second.getTask(task.id))?.status).toBe('failed');

    const result = await second.getResultByRun(run.id);
    expect(result?.coreVerdict).toBe('blocked');
    expect(result?.unresolvedRisks.join(' ')).toContain('interrupted');

    // The audit trail from before the restart is preserved and extended.
    const audit = await second.listByTask(task.id);
    expect(audit.map(event => event.type)).toContain('task.created');
    expect(audit.at(-1)?.type).toBe('task.verdict');
  });

  it('does not restart a recovered run automatically and is idempotent', async () => {
    const dbPath = tempDbPath();
    const root = workspaceRoot();
    const first = openStore(dbPath);
    const core = makeCore(first);
    const project = await core.createProject({ name: 'orphan', rootPath: root });
    const task = await core.createTask({
      projectId: project.id,
      type: 'code',
      goal: 'orphan me',
      scope: sampleTask(project.id, root).scope,
      expectedOutputs: ['out'],
      acceptanceCriteria: ['ok'],
    });
    await core.startTask(task.id);
    first.close();

    const second = openStore(dbPath);
    const recoveredCore = makeCore(second, 'b');
    expect(await recoveredCore.recoverInterruptedRuns()).toHaveLength(1);
    // A second pass finds nothing left to recover and starts nothing.
    expect(await recoveredCore.recoverInterruptedRuns()).toEqual([]);
    expect(await second.listRuns(task.id)).toHaveLength(1);
    expect((await second.getTask(task.id))?.status).toBe('failed');
  });

  it('recovers an orphaned paused run with the same policy', async () => {
    const dbPath = tempDbPath();
    const root = workspaceRoot();
    const store = openStore(dbPath);
    await store.create(sampleProject(root));
    await store.createTask({ ...sampleTask('project_0001', root), status: 'paused' });
    await store.createRun({
      id: 'run_0001',
      taskId: 'task_0001',
      attempt: 1,
      status: 'paused',
      startedAt: '2026-07-27T00:00:00.000Z',
    });

    const recovered = await makeCore(store).recoverInterruptedRuns();
    expect(recovered).toHaveLength(1);
    expect((await store.getRun('run_0001'))?.status).toBe('failed');
    expect((await store.getTask('task_0001'))?.status).toBe('failed');
  });
});
