import type { Evidence, WorkerEvent } from '@intentsmith/contracts';
import type {
  WorkerAdapter,
  WorkerDescriptor,
  WorkerExecutionContext,
  WorkerExecutionResult,
  WorkerHandle,
} from '@intentsmith/core';

/**
 * Deterministic in-process worker adapter.
 *
 * Kept free of any persistence import: a worker adapter must never reach the
 * database, and `tools/architecture/boundaries.test.ts` enforces that.
 */

export const FAKE_WORKER_VERSION = 'fake-worker/0.1.0';

export class FakeWorker implements WorkerAdapter {
  private readonly handles = new Map<string, FakeWorkerHandle>();

  describe(): WorkerDescriptor {
    return {
      id: 'fake',
      version: FAKE_WORKER_VERSION,
      capabilities: { pause: true, cancel: true },
    };
  }

  start(context: WorkerExecutionContext): WorkerHandle {
    const handle = new FakeWorkerHandle(context);
    this.handles.set(context.run.id, handle);
    return handle;
  }

  handle(runId: string): FakeWorkerHandle | undefined {
    return this.handles.get(runId);
  }
}

/**
 * Deterministic worker handle.
 *
 * Scenarios that finish on their own resolve synchronously during construction
 * rather than through `setTimeout`, so no test outcome depends on task-queue
 * ordering. `pauseable-success` and `timeout` never self-resolve: the first
 * waits for `resume()`, the second for the core timeout.
 */
export class FakeWorkerHandle implements WorkerHandle {
  readonly done: Promise<WorkerExecutionResult>;
  private resolveDone!: (value: WorkerExecutionResult) => void;
  private rejectDone!: (reason: unknown) => void;
  private settled = false;
  private cancelled = false;
  private paused = false;

  constructor(private readonly context: WorkerExecutionContext) {
    this.done = new Promise((resolve, reject) => {
      this.resolveDone = resolve;
      this.rejectDone = reject;
    });
    this.settleImmediateScenarios();
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get isCancelled(): boolean {
    return this.cancelled;
  }

  async pause(): Promise<void> {
    this.paused = true;
  }

  async resume(): Promise<void> {
    this.paused = false;
    if (this.cancelled) return;
    if (this.context.task.workerPreference.scenario === 'pauseable-success') {
      this.finish({ events: successfulEvents(this.context) });
    }
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    this.finish({ events: [] });
  }

  /** Lets a test push an arbitrary event stream through the adapter. */
  emit(events: unknown[]): void {
    this.finish({ events });
  }

  private finish(result: WorkerExecutionResult): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveDone(result);
  }

  private fail(error: unknown): void {
    if (this.settled) return;
    this.settled = true;
    this.rejectDone(error);
  }

  private settleImmediateScenarios(): void {
    const scenario = this.context.task.workerPreference.scenario;
    const runId = this.context.run.id;
    switch (scenario) {
      case 'pauseable-success':
      case 'timeout':
        return;
      case 'success':
        return this.finish({ events: successfulEvents(this.context) });
      case 'failure':
        return this.finish({ events: failureEvents(this.context) });
      case 'failing-evidence':
        return this.finish({
          events: [
            { type: 'started', runId, workerVersion: FAKE_WORKER_VERSION },
            { type: 'evidence', evidence: failingEvidence(runId) },
            { type: 'completed', claim: { status: 'success', summary: 'Claimed success despite failing evidence' } },
          ],
        });
      case 'invalid-event':
        return this.finish({
          events: [{ type: 'completed', claim: { status: 'success', summary: 'ok' }, extra: true }],
        });
      case 'claim-without-evidence':
        return this.finish({
          events: [
            { type: 'started', runId, workerVersion: FAKE_WORKER_VERSION },
            { type: 'completed', claim: { status: 'success', summary: 'No evidence attached' } },
          ],
        });
      case 'event-after-terminal':
        return this.finish({
          events: [
            ...successfulEvents(this.context),
            { type: 'evidence', evidence: passingEvidence(runId) },
          ],
        });
      case 'two-terminal-events':
        return this.finish({
          events: [
            ...successfulEvents(this.context),
            { type: 'failed', error: { code: 'LATE_FAILURE', message: 'Late failure', retryable: false } },
          ],
        });
      case 'throwing':
        return this.fail(new Error('Fake worker exploded'));
    }
  }
}

function successfulEvents(context: WorkerExecutionContext): WorkerEvent[] {
  return [
    { type: 'started', runId: context.run.id, workerVersion: FAKE_WORKER_VERSION },
    { type: 'evidence', evidence: passingEvidence(context.run.id) },
    { type: 'completed', claim: { status: 'success', summary: 'Fake worker completed successfully' } },
  ];
}

function failureEvents(context: WorkerExecutionContext): WorkerEvent[] {
  return [
    { type: 'started', runId: context.run.id, workerVersion: FAKE_WORKER_VERSION },
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

function failingEvidence(runId: string): Evidence {
  return {
    id: `evidence_fail_${runId}`,
    kind: 'test',
    status: 'fail',
    summary: 'Fake deterministic test failed',
    producedAt: '2026-07-27T00:00:00.000Z',
  };
}
