import { ProviderError } from './provider.js';

/**
 * Provider-level inference scheduler.
 *
 * Phase 2 default is one active generation per provider. Two GPUs do not imply
 * two concurrent requests: Ollama may split a single model across devices, so
 * device count is not a concurrency signal. Concurrency is raised only through
 * validated local configuration, never inferred from hardware.
 */

export type SchedulerOptions = {
  /** Maximum concurrent permits. Default 1. */
  maxConcurrent?: number;
  /** Maximum queued waiters before new arrivals are rejected. Default 32. */
  maxQueueDepth?: number;
  /** Milliseconds a waiter may sit in the queue before it gives up. */
  queueTimeoutMs?: number;
  /** Injected timer so tests never depend on wall-clock time. */
  schedule?: (fn: () => void, ms: number) => () => void;
};

type Waiter = {
  resolve: (release: () => void) => void;
  reject: (error: unknown) => void;
  settled: boolean;
  cleanup: () => void;
};

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const handle = setTimeout(fn, ms);
  handle.unref?.();
  return () => clearTimeout(handle);
};

export class InferenceScheduler {
  private readonly maxConcurrent: number;
  private readonly maxQueueDepth: number;
  private readonly queueTimeoutMs: number;
  private readonly schedule: (fn: () => void, ms: number) => () => void;

  private active = 0;
  private shuttingDown = false;
  /** FIFO. `shift()` from the head preserves arrival order exactly. */
  private readonly queue: Waiter[] = [];

  constructor(options: SchedulerOptions = {}) {
    this.maxConcurrent = Math.max(1, Math.trunc(options.maxConcurrent ?? 1));
    this.maxQueueDepth = Math.max(0, Math.trunc(options.maxQueueDepth ?? 32));
    this.queueTimeoutMs = Math.max(0, Math.trunc(options.queueTimeoutMs ?? 120_000));
    this.schedule = options.schedule ?? defaultSchedule;
  }

  get activeCount(): number {
    return this.active;
  }

  get queueDepth(): number {
    return this.queue.length;
  }

  /**
   * Acquires a permit, resolving to a release function.
   *
   * The release function is idempotent: calling it twice never frees two
   * permits, so a caller that releases in both a `finally` and an error path
   * cannot corrupt the count.
   */
  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (this.shuttingDown) {
      throw new ProviderError('PROVIDER_UNAVAILABLE', 'Inference scheduler is shutting down.');
    }
    if (signal?.aborted) {
      throw new ProviderError('REQUEST_CANCELLED', 'Request was cancelled before it was scheduled.');
    }

    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return this.makeRelease();
    }

    if (this.queue.length >= this.maxQueueDepth) {
      throw new ProviderError(
        'PROVIDER_UNAVAILABLE',
        `Inference queue is full (${this.maxQueueDepth} waiting).`,
        true,
      );
    }

    return await new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        settled: false,
        cleanup: () => undefined,
      };

      const cancelTimer = this.queueTimeoutMs > 0
        ? this.schedule(() => this.settle(waiter, () => {
            reject(new ProviderError('REQUEST_TIMEOUT', 'Timed out waiting for an inference slot.', true));
          }), this.queueTimeoutMs)
        : () => undefined;

      const onAbort = (): void => {
        this.settle(waiter, () => {
          reject(new ProviderError('REQUEST_CANCELLED', 'Request was cancelled while queued.'));
        });
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      waiter.cleanup = () => {
        cancelTimer();
        signal?.removeEventListener('abort', onAbort);
      };

      this.queue.push(waiter);
    });
  }

  /** Runs `fn` while holding a permit, releasing it on every exit path. */
  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(signal);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Rejects every queued waiter and refuses new arrivals.
   *
   * Active work is not force-killed here; callers own their own AbortSignal.
   * Shutdown is deterministic: after it returns, the queue is empty.
   */
  shutdown(): void {
    this.shuttingDown = true;
    while (this.queue.length > 0) {
      const waiter = this.queue.shift();
      if (!waiter) break;
      this.settle(waiter, () => {
        waiter.reject(new ProviderError('PROVIDER_UNAVAILABLE', 'Inference scheduler shut down while queued.'));
      });
    }
  }

  /** Settles a waiter exactly once and removes it from the queue. */
  private settle(waiter: Waiter, finish: () => void): void {
    if (waiter.settled) return;
    waiter.settled = true;
    waiter.cleanup();
    const index = this.queue.indexOf(waiter);
    if (index !== -1) this.queue.splice(index, 1);
    finish();
  }

  private makeRelease(): () => void {
    let released = false;
    return () => {
      // Idempotent: a double release must never hand out a phantom permit.
      if (released) return;
      released = true;
      this.active -= 1;
      this.pump();
    };
  }

  private pump(): void {
    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      const waiter = this.queue.shift();
      if (!waiter || waiter.settled) continue;
      waiter.settled = true;
      waiter.cleanup();
      this.active += 1;
      waiter.resolve(this.makeRelease());
    }
  }
}
