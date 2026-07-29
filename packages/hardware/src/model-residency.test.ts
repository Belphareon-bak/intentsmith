import { describe, expect, it } from 'vitest';

import { ModelResidencyManager, type ResidencyProvider } from './model-residency.js';

/**
 * Single-GPU residency scheduling.
 *
 * A fake daemon stands in for Ollama so the switching behaviour can be proven
 * without a GPU. The real-hardware version of this is opt-in and lives with the
 * Ollama suite; what matters here is the scheduling logic, which is where the
 * mistakes are.
 */

const DEEP = 'qwen3.5:27b';
const CODER = 'qwen3-coder:30b';

/** Fake daemon holding at most one model, like the GPU it stands for. */
function fakeDaemon(initial?: string) {
  const calls: string[] = [];
  let resident: string | undefined = initial;
  /** When true, an unload is acknowledged but the model stays resident. */
  let stuck = false;

  const provider: ResidencyProvider = {
    async loadedModels() {
      calls.push('ps');
      return resident === undefined ? [] : [{ model: resident, sizeVramBytes: 23_000_000_000 }];
    },
    async unloadModel(modelId) {
      calls.push(`unload:${modelId}`);
      if (!stuck && resident === modelId) resident = undefined;
    },
  };

  return {
    provider,
    calls,
    get resident() {
      return resident;
    },
    load: (modelId: string) => {
      resident = modelId;
    },
    stick: () => {
      stuck = true;
    },
  };
}

const manager = (daemon: ReturnType<typeof fakeDaemon>) =>
  new ModelResidencyManager({
    provider: daemon.provider,
    wait: async () => undefined,
    unloadVerifyAttempts: 3,
  });

describe('exclusive residency', () => {
  it('grants one lease at a time and queues the rest', async () => {
    const daemon = fakeDaemon(DEEP);
    const residency = manager(daemon);

    const first = await residency.acquire(DEEP);
    let secondGranted = false;
    const second = residency.acquire(DEEP).then(lease => {
      secondGranted = true;
      return lease;
    });

    await Promise.resolve();
    expect(secondGranted).toBe(false);
    expect(residency.queueDepth).toBe(1);

    await first.release();
    await (await second).release();
    expect(secondGranted).toBe(true);
  });

  it('reuses residency for a second job on the same model', async () => {
    const daemon = fakeDaemon(DEEP);
    const residency = manager(daemon);

    await (await residency.acquire(DEEP)).release();
    daemon.calls.length = 0;
    await (await residency.acquire(DEEP)).release();

    // Nothing is unloaded and nothing is re-checked: the model is already there.
    expect(daemon.calls.filter(call => call.startsWith('unload'))).toEqual([]);
  });

  it('unloads the old model and verifies it is gone before switching', async () => {
    const daemon = fakeDaemon(DEEP);
    const residency = manager(daemon);

    const lease = await residency.acquire(CODER);
    expect(lease.modelId).toBe(CODER);
    expect(daemon.calls).toContain(`unload:${DEEP}`);
    // A `ps` after the unload: "asked to unload" and "unloaded" are different
    // claims, and only the second one may be acted on.
    expect(daemon.calls.filter(call => call === 'ps').length).toBeGreaterThanOrEqual(2);
    expect(residency.residentModel).toBe(CODER);
  });

  it('switches back the other way just as carefully', async () => {
    const daemon = fakeDaemon(DEEP);
    const residency = manager(daemon);

    await (await residency.acquire(CODER)).release();
    daemon.load(CODER);
    daemon.calls.length = 0;

    const lease = await residency.acquire(DEEP);
    expect(daemon.calls).toContain(`unload:${CODER}`);
    expect(lease.modelId).toBe(DEEP);
  });

  it('reports a stuck model as a residency conflict, not a model failure', async () => {
    const daemon = fakeDaemon(DEEP);
    daemon.stick();
    const residency = manager(daemon);

    await expect(residency.acquire(CODER)).rejects.toMatchObject({
      code: 'MODEL_RESIDENCY_CONFLICT',
      retryable: true,
    });
  });

  it('refuses to release the same lease twice', async () => {
    const daemon = fakeDaemon(DEEP);
    const residency = manager(daemon);
    const lease = await residency.acquire(DEEP);
    await lease.release();
    await expect(lease.release()).rejects.toThrow(/already released/);
  });
});

describe('keep-alive derived from the queue', () => {
  it('retains briefly when the next job wants the same model', async () => {
    const daemon = fakeDaemon(DEEP);
    const residency = new ModelResidencyManager({
      provider: daemon.provider,
      wait: async () => undefined,
      retainSameModelSeconds: 45,
    });

    const lease = await residency.acquire(DEEP);
    const queued = residency.acquire(DEEP);
    const plan = await lease.release();

    expect(plan).toMatchObject({ action: 'retain', seconds: 45 });
    await (await queued).release();
  });

  it('unloads immediately when the next job needs a different model', async () => {
    const daemon = fakeDaemon(DEEP);
    const residency = manager(daemon);

    const lease = await residency.acquire(DEEP);
    const queued = residency.acquire(CODER);
    const plan = await lease.release();

    // Holding VRAM for ten minutes here is exactly what starved the next job.
    expect(plan.action).toBe('unload');
    expect(daemon.calls).toContain(`unload:${DEEP}`);
    await (await queued).release();
  });

  it('falls back to the idle window when nothing is waiting', async () => {
    const daemon = fakeDaemon(DEEP);
    const residency = new ModelResidencyManager({
      provider: daemon.provider,
      wait: async () => undefined,
      idleRetainSeconds: 600,
    });

    const plan = await (await residency.acquire(DEEP)).release();
    expect(plan).toMatchObject({ action: 'retain', seconds: 600 });
  });
});

describe('cancellation and fairness', () => {
  it('removes a cancelled request from the queue', async () => {
    const daemon = fakeDaemon(DEEP);
    const residency = manager(daemon);
    const held = await residency.acquire(DEEP);

    const controller = new AbortController();
    const queued = residency.acquire(DEEP, controller.signal);
    await Promise.resolve();
    controller.abort();

    await expect(queued).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' });
    // A cancelled waiter that still received a lease would pin the GPU until
    // released by code that had already given up.
    expect(residency.queueDepth).toBe(0);
    await held.release();
  });

  it('refuses a request that was cancelled before it queued', async () => {
    const daemon = fakeDaemon(DEEP);
    const controller = new AbortController();
    controller.abort();
    await expect(manager(daemon).acquire(DEEP, controller.signal)).rejects.toMatchObject({
      code: 'REQUEST_CANCELLED',
    });
  });

  it('serves strictly in arrival order so a deep job cannot be starved', async () => {
    const daemon = fakeDaemon(CODER);
    const residency = manager(daemon);
    const order: string[] = [];

    const held = await residency.acquire(CODER);
    const deep = residency.acquire(DEEP).then(async lease => {
      order.push('deep');
      await lease.release();
    });
    const fastOne = residency.acquire(CODER).then(async lease => {
      order.push('fast-1');
      await lease.release();
    });
    const fastTwo = residency.acquire(CODER).then(async lease => {
      order.push('fast-2');
      await lease.release();
    });

    await held.release();
    await Promise.all([deep, fastOne, fastTwo]);

    // Serving same-model jobs first would be faster and would let a stream of
    // them starve the deep job forever.
    expect(order).toEqual(['deep', 'fast-1', 'fast-2']);
  });
});
