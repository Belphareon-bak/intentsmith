import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { CapabilityEnvelope, CreateTaskInput, Evidence, WorkerEvent } from '@intentsmith/contracts';
import { IntentSmithCore, type Clock, type IdGenerator, type WorkerAdapter, type WorkerExecutionContext, type WorkerExecutionResult, type WorkerHandle } from '@intentsmith/core';
import { openIntentSmithDatabase, type SQLiteStore } from '@intentsmith/persistence';

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

export class FakeWorker implements WorkerAdapter {
  private readonly handles = new Map<string, FakeWorkerHandle>();

  start(context: WorkerExecutionContext): WorkerHandle {
    const handle = new FakeWorkerHandle(context);
    this.handles.set(context.run.id, handle);
    return handle;
  }

  handle(runId: string): FakeWorkerHandle | undefined {
    return this.handles.get(runId);
  }
}

export class FakeWorkerHandle implements WorkerHandle {
  readonly done: Promise<WorkerExecutionResult>;
  private resolveDone!: (value: WorkerExecutionResult) => void;
  private cancelled = false;

  constructor(private readonly context: WorkerExecutionContext) {
    this.done = new Promise(resolve => {
      this.resolveDone = resolve;
    });
    this.schedule();
  }

  async pause(): Promise<void> {
    if (this.context.task.workerPreference.scenario !== 'pauseable-success') return;
  }

  async resume(): Promise<void> {
    if (this.context.task.workerPreference.scenario === 'pauseable-success' && !this.cancelled) {
      this.resolveDone({ events: successfulEvents(this.context) });
    }
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    this.resolveDone({ events: [] });
  }

  private schedule(): void {
    const scenario = this.context.task.workerPreference.scenario;
    if (scenario === 'pauseable-success' || scenario === 'timeout') return;
    setTimeout(() => {
      if (this.cancelled) return;
      if (scenario === 'success') this.resolveDone({ events: successfulEvents(this.context) });
      if (scenario === 'failure') this.resolveDone({ events: failureEvents(this.context) });
      if (scenario === 'invalid-event') this.resolveDone({ events: [{ type: 'completed', claim: { status: 'success', summary: 'ok' }, extra: true }] });
      if (scenario === 'claim-without-evidence') {
        this.resolveDone({ events: [
          { type: 'started', runId: this.context.run.id, workerVersion: 'fake-worker/0.1.0' },
          { type: 'completed', claim: { status: 'success', summary: 'No evidence attached' } },
        ] });
      }
    }, 0);
  }
}

export type TestRuntime = {
  core: IntentSmithCore;
  store: SQLiteStore;
  worker: FakeWorker;
  clock: FakeClock;
  ids: DeterministicIdGenerator;
  cleanup(): void;
};

export function createTestRuntime(dbPath = ':memory:'): TestRuntime {
  const store = openIntentSmithDatabase(dbPath);
  const worker = new FakeWorker();
  const clock = new FakeClock();
  const ids = new DeterministicIdGenerator();
  const core = new IntentSmithCore({
    clock,
    ids,
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
    ids,
    cleanup: () => store.close(),
  };
}

function successfulEvents(context: WorkerExecutionContext): WorkerEvent[] {
  return [
    { type: 'started', runId: context.run.id, workerVersion: 'fake-worker/0.1.0' },
    { type: 'evidence', evidence: passingEvidence(context.run.id) },
    { type: 'completed', claim: { status: 'success', summary: 'Fake worker completed successfully' } },
  ];
}

function failureEvents(context: WorkerExecutionContext): WorkerEvent[] {
  return [
    { type: 'started', runId: context.run.id, workerVersion: 'fake-worker/0.1.0' },
    {
      type: 'failed',
      error: {
        code: 'FAKE_WORKER_FAILURE',
        message: 'Fake worker failed deterministically',
        retryable: false,
      },
    },
  ];
}

function passingEvidence(runId: string): Evidence {
  return {
    id: `evidence_${runId}`,
    kind: 'test',
    status: 'pass',
    summary: 'Fake deterministic test passed',
    producedAt: '2026-07-27T00:00:00.000Z',
  };
}
