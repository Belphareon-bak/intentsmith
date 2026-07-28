import { describe, expect, it } from 'vitest';

import { InferenceScheduler } from './scheduler.js';

/**
 * Scheduler tests.
 *
 * Timers are injected, so no case depends on wall-clock time or on how fast
 * the machine runs.
 */

/** Timer whose callbacks fire only when the test says so. */
function manualTimer() {
  const pending: Array<{ fn: () => void; ms: number }> = [];
  return {
    schedule: (fn: () => void, ms: number) => {
      const entry = { fn, ms };
      pending.push(entry);
      return () => {
        const index = pending.indexOf(entry);
        if (index !== -1) pending.splice(index, 1);
      };
    },
    fireAll: () => {
      for (const entry of pending.splice(0)) entry.fn();
    },
    get pendingCount() {
      return pending.length;
    },
  };
}

const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('inference scheduler', () => {
  it('defaults to one active generation', async () => {
    const scheduler = new InferenceScheduler();
    const first = await scheduler.acquire();
    expect(scheduler.activeCount).toBe(1);

    let secondAcquired = false;
    const second = scheduler.acquire().then(release => {
      secondAcquired = true;
      return release;
    });
    await settle();
    // The second caller waits rather than running concurrently.
    expect(secondAcquired).toBe(false);
    expect(scheduler.queueDepth).toBe(1);

    first();
    (await second)();
    expect(scheduler.activeCount).toBe(0);
  });

  it('serves waiters in FIFO order', async () => {
    const scheduler = new InferenceScheduler();
    const order: number[] = [];
    const held = await scheduler.acquire();

    const waiters = [1, 2, 3, 4].map(index =>
      scheduler.acquire().then(release => {
        order.push(index);
        release();
      }),
    );
    await settle();
    held();
    await Promise.all(waiters);

    expect(order).toEqual([1, 2, 3, 4]);
  });

  it('cancels a queued waiter without disturbing the queue', async () => {
    const scheduler = new InferenceScheduler();
    const held = await scheduler.acquire();
    const controller = new AbortController();

    const cancelled = scheduler.acquire(controller.signal);
    const survivor = scheduler.acquire();
    await settle();
    expect(scheduler.queueDepth).toBe(2);

    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' });
    expect(scheduler.queueDepth).toBe(1);

    held();
    (await survivor)();
    expect(scheduler.activeCount).toBe(0);
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(new InferenceScheduler().acquire(controller.signal)).rejects.toMatchObject({
      code: 'REQUEST_CANCELLED',
    });
  });

  it('times out a queued waiter on the injected timer', async () => {
    const timer = manualTimer();
    const scheduler = new InferenceScheduler({ queueTimeoutMs: 1000, schedule: timer.schedule });
    const held = await scheduler.acquire();

    const queued = scheduler.acquire();
    await settle();
    timer.fireAll();

    await expect(queued).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
    expect(scheduler.queueDepth).toBe(0);
    held();
  });

  it('rejects arrivals beyond the queue depth', async () => {
    const scheduler = new InferenceScheduler({ maxQueueDepth: 2 });
    const held = await scheduler.acquire();
    const queued = [scheduler.acquire(), scheduler.acquire()];
    await settle();

    await expect(scheduler.acquire()).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    held();
    for (const waiter of queued) (await waiter)();
  });

  it('never leaks a permit when the held work throws', async () => {
    const scheduler = new InferenceScheduler();
    await expect(
      scheduler.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(scheduler.activeCount).toBe(0);
    // The slot is genuinely reusable.
    (await scheduler.acquire())();
  });

  it('treats a double release as one release', async () => {
    const scheduler = new InferenceScheduler();
    const release = await scheduler.acquire();
    release();
    release();
    expect(scheduler.activeCount).toBe(0);

    // A phantom permit would let two run at once here.
    const first = await scheduler.acquire();
    let secondRan = false;
    void scheduler.acquire().then(() => {
      secondRan = true;
    });
    await settle();
    expect(secondRan).toBe(false);
    first();
  });

  it('drains the queue deterministically on shutdown', async () => {
    const scheduler = new InferenceScheduler();
    const held = await scheduler.acquire();
    const queued = [scheduler.acquire(), scheduler.acquire()];
    await settle();

    scheduler.shutdown();
    for (const waiter of queued) {
      await expect(waiter).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    }
    expect(scheduler.queueDepth).toBe(0);
    await expect(scheduler.acquire()).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    held();
  });

  it('honours a configured concurrency above one', async () => {
    const scheduler = new InferenceScheduler({ maxConcurrent: 2 });
    const first = await scheduler.acquire();
    const second = await scheduler.acquire();
    expect(scheduler.activeCount).toBe(2);

    let thirdRan = false;
    void scheduler.acquire().then(() => {
      thirdRan = true;
    });
    await settle();
    expect(thirdRan).toBe(false);
    first();
    second();
  });

  it('produces identical FIFO ordering across repeated runs', async () => {
    const orders: number[][] = [];
    for (let run = 0; run < 5; run += 1) {
      const scheduler = new InferenceScheduler();
      const order: number[] = [];
      const held = await scheduler.acquire();
      const waiters = [1, 2, 3, 4, 5].map(index =>
        scheduler.acquire().then(release => {
          order.push(index);
          release();
        }),
      );
      await settle();
      held();
      await Promise.all(waiters);
      orders.push(order);
    }
    for (const order of orders) expect(order).toEqual([1, 2, 3, 4, 5]);
  });
});
