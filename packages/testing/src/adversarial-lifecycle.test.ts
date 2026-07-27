import { afterEach, describe, expect, it } from 'vitest';

import type { CreateTaskInput, Task } from '@intentsmith/contracts';

import { DisposableWorkspace, createTaskInput, createTestRuntime, type TestRuntime } from './fakes.js';

/**
 * Adversarial lifecycle tests.
 *
 * Every case here is order-independent by construction: the fake worker
 * settles synchronously or waits for an explicit signal, timeouts are driven
 * by a virtual timer, and commands are awaited rather than fired and forgotten.
 * No assertion depends on microtask ordering or machine speed.
 */

const runtimes: TestRuntime[] = [];
const workspaces: DisposableWorkspace[] = [];

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.cleanup();
  for (const workspace of workspaces.splice(0)) workspace.cleanup();
});

async function setup(overrides: Partial<CreateTaskInput> = {}): Promise<{ runtime: TestRuntime; task: Task }> {
  const runtime = createTestRuntime();
  runtimes.push(runtime);
  const workspace = new DisposableWorkspace();
  workspaces.push(workspace);
  const project = await runtime.core.createProject({ name: 'adversarial', rootPath: workspace.path });
  const task = await runtime.core.createTask(createTaskInput(project.id, workspace.path, overrides));
  return { runtime, task };
}

/** Settles both promises without letting a rejection escape. */
async function race<A, B>(a: Promise<A>, b: Promise<B>): Promise<[PromiseSettledResult<A>, PromiseSettledResult<B>]> {
  const [first, second] = await Promise.allSettled([a, b]);
  return [first as PromiseSettledResult<A>, second as PromiseSettledResult<B>];
}

function codeOf(outcome: PromiseSettledResult<unknown>): string | undefined {
  if (outcome.status === 'fulfilled') return undefined;
  return (outcome.reason as { code?: string }).code;
}

describe('adversarial lifecycle', () => {
  it('admits exactly one of two concurrent start requests', async () => {
    const { runtime, task } = await setup({ workerScenario: 'pauseable-success' });
    const [first, second] = await race(runtime.core.startTask(task.id), runtime.core.startTask(task.id));

    const fulfilled = [first, second].filter(outcome => outcome.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
    const rejected = [first, second].find(outcome => outcome.status === 'rejected');
    expect(codeOf(rejected!)).toBe('INVALID_TASK_TRANSITION');
    // Regression: the loser used to surface a raw SQLite nested-transaction error.
    expect(String((rejected as PromiseRejectedResult).reason)).not.toContain('within a transaction');
    expect(await runtime.core.listTaskRuns(task.id)).toHaveLength(1);
  });

  it('resolves near-simultaneous pause and cancel to a single terminal state', async () => {
    const { runtime, task } = await setup({ workerScenario: 'pauseable-success' });
    await runtime.core.startTask(task.id);
    await race(runtime.core.pauseTask(task.id), runtime.core.cancelTask(task.id));

    const final = await runtime.core.getTask(task.id);
    expect(['paused', 'cancelled']).toContain(final.status);
    // Whatever wins, cancel must be able to finish the task and stay terminal.
    if (final.status === 'paused') await runtime.core.cancelTask(task.id);
    expect((await runtime.core.getTask(task.id)).status).toBe('cancelled');
  });

  it('resolves near-simultaneous resume and cancel without losing terminality', async () => {
    const { runtime, task } = await setup({ workerScenario: 'pauseable-success' });
    await runtime.core.startTask(task.id);
    await runtime.core.pauseTask(task.id);
    await race(runtime.core.resumeTask(task.id), runtime.core.cancelTask(task.id));

    const final = await runtime.core.waitForTask(task.id);
    expect(['cancelled', 'passed']).toContain(final.status);
    if (final.status === 'cancelled') {
      await expect(runtime.core.resumeTask(task.id)).rejects.toMatchObject({ code: 'INVALID_TASK_TRANSITION' });
    }
  });

  it('keeps one verdict when timeout and completion arrive together', async () => {
    const { runtime, task } = await setup({ workerScenario: 'pauseable-success', timeoutMs: 50 });
    await runtime.core.startTask(task.id);

    const handle = runtime.worker.handle((await runtime.core.listTaskRuns(task.id))[0]!.id);
    // Fire the timeout and the worker completion in the same turn.
    runtime.timer.advance(50);
    handle?.emit([]);

    const final = await runtime.core.waitForTask(task.id);
    expect(final.status).toBe('failed');
    const runs = await runtime.core.listTaskRuns(task.id);
    expect(runs).toHaveLength(1);
    // Exactly one verdict was recorded for the run.
    const verdicts = (await runtime.core.listAuditEvents(task.id)).filter(event => event.type === 'task.verdict');
    expect(verdicts).toHaveLength(1);
  });

  it('ignores worker completion that arrives after cancel', async () => {
    const { runtime, task } = await setup({ workerScenario: 'pauseable-success' });
    await runtime.core.startTask(task.id);
    const runId = (await runtime.core.listTaskRuns(task.id))[0]!.id;
    const handle = runtime.worker.handle(runId);

    await runtime.core.cancelTask(task.id);
    handle?.emit([{ type: 'completed', claim: { status: 'success', summary: 'too late' } }]);
    await runtime.core.waitForTask(task.id);

    expect((await runtime.core.getTask(task.id)).status).toBe('cancelled');
    expect((await runtime.core.getTaskResult(task.id))?.coreVerdict).toBe('cancelled');
    expect((await runtime.core.listTaskRuns(task.id))[0]?.status).toBe('cancelled');
  });

  it('never overwrites a terminal verdict with a late worker event', async () => {
    const { runtime, task } = await setup({ workerScenario: 'success' });
    await runtime.core.startTask(task.id);
    const passed = await runtime.core.waitForTask(task.id);
    expect(passed.status).toBe('passed');
    const resultBefore = await runtime.core.getTaskResult(task.id);

    const handle = runtime.worker.handle((await runtime.core.listTaskRuns(task.id))[0]!.id);
    handle?.emit([{ type: 'failed', error: { code: 'LATE', message: 'late', retryable: false } }]);
    await runtime.core.waitForTask(task.id);

    expect((await runtime.core.getTask(task.id)).status).toBe('passed');
    expect(await runtime.core.getTaskResult(task.id)).toEqual(resultBefore);
  });

  it('rejects a repeated cancel with a domain error', async () => {
    const { runtime, task } = await setup();
    expect((await runtime.core.cancelTask(task.id)).status).toBe('cancelled');
    await expect(runtime.core.cancelTask(task.id)).rejects.toMatchObject({ code: 'INVALID_TASK_TRANSITION' });
  });

  it('rejects a repeated pause with a domain error', async () => {
    const { runtime, task } = await setup({ workerScenario: 'pauseable-success' });
    await runtime.core.startTask(task.id);
    expect((await runtime.core.pauseTask(task.id)).status).toBe('paused');
    await expect(runtime.core.pauseTask(task.id)).rejects.toMatchObject({ code: 'INVALID_TASK_TRANSITION' });
  });

  it('rejects resume from pending', async () => {
    const { runtime, task } = await setup();
    // Regression: this used to move a pending task to running with no TaskRun
    // and no worker, leaving it permanently stuck.
    await expect(runtime.core.resumeTask(task.id)).rejects.toMatchObject({ code: 'INVALID_TASK_TRANSITION' });
    expect((await runtime.core.getTask(task.id)).status).toBe('pending');
    expect(await runtime.core.listTaskRuns(task.id)).toHaveLength(0);
  });

  it('rejects resume from failed', async () => {
    const { runtime, task } = await setup({ workerScenario: 'failure' });
    await runtime.core.startTask(task.id);
    expect((await runtime.core.waitForTask(task.id)).status).toBe('failed');
    await expect(runtime.core.resumeTask(task.id)).rejects.toMatchObject({ code: 'INVALID_TASK_TRANSITION' });
  });

  it('rejects starting an already running task', async () => {
    const { runtime, task } = await setup({ workerScenario: 'pauseable-success' });
    await runtime.core.startTask(task.id);
    await expect(runtime.core.startTask(task.id)).rejects.toMatchObject({ code: 'INVALID_TASK_TRANSITION' });
    expect(await runtime.core.listTaskRuns(task.id)).toHaveLength(1);
  });

  it('refuses to overwrite a passed result', async () => {
    const { runtime, task } = await setup({ workerScenario: 'success' });
    await runtime.core.startTask(task.id);
    await runtime.core.waitForTask(task.id);

    for (const command of ['startTask', 'pauseTask', 'resumeTask'] as const) {
      await expect(runtime.core[command](task.id)).rejects.toMatchObject({ code: 'INVALID_TASK_TRANSITION' });
    }
    expect((await runtime.core.getTask(task.id)).status).toBe('passed');
    expect((await runtime.core.getTaskResult(task.id))?.coreVerdict).toBe('pass');
  });

  it('refuses to overwrite a failed result', async () => {
    const { runtime, task } = await setup({ workerScenario: 'failure' });
    await runtime.core.startTask(task.id);
    await runtime.core.waitForTask(task.id);

    for (const command of ['startTask', 'pauseTask', 'resumeTask'] as const) {
      await expect(runtime.core[command](task.id)).rejects.toMatchObject({ code: 'INVALID_TASK_TRANSITION' });
    }
    expect((await runtime.core.getTaskResult(task.id))?.coreVerdict).toBe('fail');
  });

  it('finalizes a worker that completes while the task is paused', async () => {
    const { runtime, task } = await setup({ workerScenario: 'pauseable-success' });
    await runtime.core.startTask(task.id);
    await runtime.core.pauseTask(task.id);

    const handle = runtime.worker.handle((await runtime.core.listTaskRuns(task.id))[0]!.id);
    // Regression: this outcome used to be dropped, stranding the task in paused.
    handle?.emit([
      { type: 'started', runId: (await runtime.core.listTaskRuns(task.id))[0]!.id, workerVersion: 'fake-worker/0.1.0' },
      {
        type: 'evidence',
        evidence: {
          id: 'evidence_paused',
          kind: 'test',
          status: 'pass',
          summary: 'passed while paused',
          producedAt: '2026-07-27T00:00:00.000Z',
        },
      },
      { type: 'completed', claim: { status: 'success', summary: 'done while paused' } },
    ]);

    expect((await runtime.core.getTask(task.id)).status).toBe('paused');
    await runtime.core.resumeTask(task.id);
    const final = await runtime.core.waitForTask(task.id);
    expect(final.status).toBe('passed');
    expect((await runtime.core.getTaskResult(task.id))?.coreVerdict).toBe('pass');
  });

  it('keeps run history and results separate across multiple runs of one task', async () => {
    const { runtime, task } = await setup({ workerScenario: 'failure' });
    await runtime.core.startTask(task.id);
    await runtime.core.waitForTask(task.id);
    const firstRun = (await runtime.core.listTaskRuns(task.id))[0]!;
    const firstResult = await runtime.core.getTaskResult(task.id);

    // Retry orchestration is deferred, so a second attempt is written through
    // the persistence port directly to prove history is additive, not mutating.
    const secondRun = {
      id: 'run_manual_0002',
      taskId: task.id,
      attempt: firstRun.attempt + 1,
      status: 'passed' as const,
      startedAt: '2026-07-27T00:00:01.000Z',
      endedAt: '2026-07-27T00:00:02.000Z',
    };
    await runtime.store.createRun(secondRun);
    await runtime.store.saveResult({
      ...firstResult!,
      id: 'result_manual_0002',
      runId: secondRun.id,
      coreVerdict: 'pass',
      createdAt: '2026-07-27T00:00:02.000Z',
    });

    const runs = await runtime.core.listTaskRuns(task.id);
    expect(runs.map(run => run.attempt)).toEqual([1, 2]);
    // The original run and its result are untouched.
    expect(runs[0]).toEqual(firstRun);
    expect(await runtime.store.getResultByRun(firstRun.id)).toEqual(firstResult);
    expect((await runtime.store.getResultByRun(secondRun.id))?.coreVerdict).toBe('pass');
  });

  it('produces identical audit ordering across repeated runs', async () => {
    const collect = async (): Promise<string[]> => {
      const { runtime, task } = await setup({ workerScenario: 'success' });
      await runtime.core.startTask(task.id);
      await runtime.core.waitForTask(task.id);
      return (await runtime.core.listAuditEvents(task.id)).map(event => event.type);
    };
    expect(await collect()).toEqual(await collect());
  });
});
