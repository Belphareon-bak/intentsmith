import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { CapabilityEnvelope, CreateTaskInput } from '@intentsmith/contracts';
import { IntentSmithCore, type Clock, type IdGenerator, type Timer } from '@intentsmith/core';
import { openIntentSmithDatabase, type SQLiteStore } from '@intentsmith/persistence';

import { FakeWorker } from './fake-worker.js';

export class FakeClock implements Clock {
  private current: Date;

  constructor(start = '2026-07-27T00:00:00.000Z') {
    this.current = new Date(start);
  }

  now(): string {
    return this.current.toISOString();
  }

  tick(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/**
 * Timer driven by explicit advancement instead of wall-clock time, so timeout
 * behaviour is identical on a fast and a loaded machine.
 */
export class FakeTimer implements Timer {
  private currentMs = 0;
  private nextId = 0;
  private readonly pending = new Map<number, { at: number; fn: () => void }>();

  schedule(fn: () => void, ms: number): () => void {
    const id = this.nextId++;
    this.pending.set(id, { at: this.currentMs + ms, fn });
    return () => {
      this.pending.delete(id);
    };
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  /** Advances virtual time and fires every timer due at or before the new instant. */
  advance(ms: number): void {
    this.currentMs += ms;
    const due = [...this.pending.entries()]
      .filter(([, timer]) => timer.at <= this.currentMs)
      .sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
    for (const [id, timer] of due) {
      this.pending.delete(id);
      timer.fn();
    }
  }
}

export class DeterministicIdGenerator implements IdGenerator {
  private readonly counters = new Map<string, number>();

  next(prefix: string): string {
    const next = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, next);
    return `${prefix}_${String(next).padStart(4, '0')}`;
  }
}

export class DisposableWorkspace {
  readonly path: string;

  constructor(prefix = 'intentsmith-workspace-') {
    this.path = mkdtempSync(path.join(tmpdir(), prefix));
  }

  cleanup(): void {
    rmSync(this.path, { recursive: true, force: true });
  }
}

export function createCapabilityEnvelope(rootPath: string, overrides: Partial<CapabilityEnvelope> = {}): CapabilityEnvelope {
  return {
    fsReadRoots: [rootPath],
    fsWriteRoots: [rootPath],
    allowedCommandFamilies: [],
    deniedCommandPatterns: ['rm -rf', 'curl', 'wget'],
    network: { mode: 'disabled', allowlist: [] },
    envAllowlist: ['PATH'],
    secrets: 'none',
    processSpawning: 'disabled',
    timeoutMs: 1000,
    maxActions: 0,
    approvalRules: [],
    ...overrides,
  };
}

export function createTaskInput(projectId: string, rootPath: string, overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
  return {
    projectId,
    type: 'code',
    goal: 'Make a deterministic fake-worker change',
    scope: createCapabilityEnvelope(rootPath),
    expectedOutputs: ['A deterministic result'],
    acceptanceCriteria: ['Fake worker emits passing test evidence'],
    workerScenario: 'success',
    timeoutMs: 1000,
    ...overrides,
  };
}

export type TestRuntime = {
  core: IntentSmithCore;
  store: SQLiteStore;
  worker: FakeWorker;
  clock: FakeClock;
  timer: FakeTimer;
  ids: DeterministicIdGenerator;
  cleanup(): void;
};

export function createTestRuntime(dbPath = ':memory:'): TestRuntime {
  const store = openIntentSmithDatabase(dbPath);
  const worker = new FakeWorker();
  const clock = new FakeClock();
  const timer = new FakeTimer();
  const ids = new DeterministicIdGenerator();
  const core = new IntentSmithCore({
    clock,
    ids,
    timer,
    projects: store,
    tasks: store,
    audit: store,
    transactions: store,
    worker,
  });

  return {
    core,
    store,
    worker,
    clock,
    timer,
    ids,
    cleanup: () => store.close(),
  };
}
