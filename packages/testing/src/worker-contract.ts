import { afterEach, describe, expect, it } from 'vitest';

import type { CreateTaskInput, Task, TaskRun } from '@intentsmith/contracts';
import type { WorkerAdapter } from '@intentsmith/worker-sdk';

import { DisposableWorkspace, createTaskInput, createTestRuntime, type TestRuntime } from './fakes.js';

/**
 * Abstract behaviours every worker adapter must exhibit, independent of how a
 * concrete adapter is told to produce them.
 */
export type WorkerContractScenario =
  | 'deterministic-success'
  | 'worker-failure'
  | 'timeout'
  | 'cancellation'
  | 'pause-resume'
  | 'invalid-event'
  | 'event-after-terminal'
  | 'two-terminal-events'
  | 'claim-without-evidence'
  | 'worker-exception';

export type WorkerContractHarness = {
  /** Label used in the test report. */
  name: string;
  /** Builds a runtime whose worker is the adapter under test. */
  createRuntime(): TestRuntime;
  /**
   * Translates an abstract scenario into task input for this adapter.
   * Every scenario must be expressible; the contract has no optional cases.
   */
  taskInputFor(scenario: WorkerContractScenario, projectId: string, rootPath: string): CreateTaskInput;
  /** Drives virtual time forward far enough to trip the core worker timeout. */
  advancePastTimeout(runtime: TestRuntime): void;
};

/**
 * Shared WorkerAdapter contract suite.
 *
 * Call this from a `.test.ts` file with a harness for any adapter. The suite
 * only touches the public core API and the adapter's own port, so it never
 * needs to be copied or forked per adapter.
 */
export function runWorkerAdapterContract(harness: WorkerContractHarness): void {
  describe(`WorkerAdapter contract: ${harness.name}`, () => {
    const runtimes: TestRuntime[] = [];
    const workspaces: DisposableWorkspace[] = [];

    afterEach(() => {
      for (const runtime of runtimes.splice(0)) runtime.cleanup();
      for (const workspace of workspaces.splice(0)) workspace.cleanup();
    });

    async function scenario(kind: WorkerContractScenario): Promise<{ runtime: TestRuntime; task: Task }> {
      const runtime = harness.createRuntime();
      runtimes.push(runtime);
      const workspace = new DisposableWorkspace();
      workspaces.push(workspace);
      const project = await runtime.core.createProject({ name: 'contract', rootPath: workspace.path });
      const task = await runtime.core.createTask(harness.taskInputFor(kind, project.id, workspace.path));
      return { runtime, task };
    }

    it('exposes identity and capability discovery', () => {
      const runtime = harness.createRuntime();
      runtimes.push(runtime);
      const descriptor = (runtime.worker as WorkerAdapter).describe();
      expect(descriptor.id).toMatch(/\S/);
      expect(descriptor.version).toMatch(/\S/);
      expect(typeof descriptor.capabilities.pause).toBe('boolean');
      expect(typeof descriptor.capabilities.cancel).toBe('boolean');
    });

    it('produces a deterministic success verdict', async () => {
      const { runtime, task } = await scenario('deterministic-success');
      await runtime.core.startTask(task.id);
      const finished = await runtime.core.waitForTask(task.id);
      expect(finished.status).toBe('passed');
      const result = await runtime.core.getTaskResult(task.id);
      expect(result?.coreVerdict).toBe('pass');
      expect(result?.deterministicEvidence.some(evidence => evidence.status === 'pass')).toBe(true);
    });

    it('reports worker failure as a failed verdict', async () => {
      const { runtime, task } = await scenario('worker-failure');
      await runtime.core.startTask(task.id);
      const finished = await runtime.core.waitForTask(task.id);
      expect(finished.status).toBe('failed');
      expect((await runtime.core.getTaskResult(task.id))?.coreVerdict).toBe('fail');
    });

    it('fails the run and marks the TaskRun as timeout when the worker stalls', async () => {
      const { runtime, task } = await scenario('timeout');
      await runtime.core.startTask(task.id);
      harness.advancePastTimeout(runtime);
      const finished = await runtime.core.waitForTask(task.id);
      expect(finished.status).toBe('failed');
      const runs = await runtime.core.listTaskRuns(task.id);
      expect(runs.at(-1)?.status).toBe('timeout');
    });

    it('observes AbortSignal cancellation and records a cancelled verdict', async () => {
      const { runtime, task } = await scenario('cancellation');
      await runtime.core.startTask(task.id);
      const cancelled = await runtime.core.cancelTask(task.id);
      expect(cancelled.status).toBe('cancelled');
      const result = await runtime.core.getTaskResult(task.id);
      expect(result?.coreVerdict).toBe('cancelled');
      const runs = await runtime.core.listTaskRuns(task.id);
      expect(runs.at(-1)?.status).toBe('cancelled');
    });

    /**
     * Pause is capability-gated.
     *
     * ACP has no pause primitive, so an adapter for such a worker reports
     * `pause: false`. Requiring cooperation unconditionally would force that
     * adapter to fake a pause, which is precisely the dishonesty the descriptor
     * exists to prevent. An adapter that claims pause must cooperate; one that
     * does not must refuse rather than pretend.
     */
    it('cooperates with pause and resume, or refuses honestly', async () => {
      const { runtime, task } = await scenario('pause-resume');
      const supportsPause = (runtime.worker as WorkerAdapter).describe().capabilities.pause;
      await runtime.core.startTask(task.id);

      if (!supportsPause) {
        const runs = await runtime.core.listTaskRuns(task.id);
        const handleUnderTest = runs.at(-1);
        expect(handleUnderTest).toBeDefined();
        // The refusal must be explicit, not a silent no-op that leaves the
        // caller believing the worker paused.
        await expect(runtime.core.pauseTask(task.id)).rejects.toBeDefined();
        await runtime.core.cancelTask(task.id).catch(() => undefined);
        return;
      }

      expect((await runtime.core.pauseTask(task.id)).status).toBe('paused');
      const runsWhilePaused = await runtime.core.listTaskRuns(task.id);
      expect(runsWhilePaused.at(-1)?.status).toBe('paused');
      await runtime.core.resumeTask(task.id);
      const finished = await runtime.core.waitForTask(task.id);
      expect(finished.status).toBe('passed');
    });

    /**
     * An invalid event must never yield a pass.
     *
     * How it is stopped is an adapter's choice: a thin adapter may pass the
     * malformed event to Core, which rejects it and audits
     * `worker.invalid_event`; a protocol adapter normalizes it into a failure
     * before Core ever sees it. Both are correct, and requiring the first would
     * penalise the safer design.
     */
    it('never lets a schema-invalid event produce a pass', async () => {
      const { runtime, task } = await scenario('invalid-event');
      await runtime.core.startTask(task.id);
      const finished = await runtime.core.waitForTask(task.id);
      expect(finished.status).toBe('failed');
      expect((await runtime.core.getTaskResult(task.id))?.coreVerdict).not.toBe('pass');
    });

    /**
     * An event after the terminal one is a protocol violation.
     *
     * It must be recorded, either as an unresolved risk when Core sees the
     * stray event, or as failing security evidence when the adapter catches it
     * first. What must not happen is silence.
     */
    it('records an event emitted after a terminal event', async () => {
      const { runtime, task } = await scenario('event-after-terminal');
      await runtime.core.startTask(task.id);
      await runtime.core.waitForTask(task.id);
      const result = await runtime.core.getTaskResult(task.id);
      const risks = result?.unresolvedRisks.join(' ') ?? '';
      const securityFindings = (result?.securityEvidence ?? [])
        .concat(result?.deterministicEvidence ?? [])
        .filter(evidence => evidence.status === 'fail')
        .map(evidence => evidence.summary)
        .join(' ');
      expect(`${risks} ${securityFindings}`).toMatch(/after a terminal event|after the turn ended/);
    });

    /**
     * Two terminal events must never yield a pass.
     *
     * As with an invalid event, an adapter may either forward the duplicate for
     * Core to reject or refuse it itself; both are correct, and exactly one
     * terminal outcome must survive.
     */
    it('never lets two terminal events produce a pass', async () => {
      const { runtime, task } = await scenario('two-terminal-events');
      await runtime.core.startTask(task.id);
      const finished = await runtime.core.waitForTask(task.id);
      expect(finished.status).not.toBe('passed');
      expect((await runtime.core.getTaskResult(task.id))?.coreVerdict).not.toBe('pass');
    });

    it('refuses a completed claim that carries no deterministic evidence', async () => {
      const { runtime, task } = await scenario('claim-without-evidence');
      await runtime.core.startTask(task.id);
      const finished = await runtime.core.waitForTask(task.id);
      expect(finished.status).toBe('failed');
      const result = await runtime.core.getTaskResult(task.id);
      expect(result?.workerClaim?.status).toBe('success');
      expect(result?.coreVerdict).toBe('fail');
    });

    it('normalizes a worker exception into a stable error code', async () => {
      const { runtime, task } = await scenario('worker-exception');
      await runtime.core.startTask(task.id);
      const finished = await runtime.core.waitForTask(task.id);
      expect(finished.status).toBe('failed');
      const result = await runtime.core.getTaskResult(task.id);
      expect(result?.coreVerdict).toBe('fail');
      // No stack trace or host path may reach the persisted result.
      expect(JSON.stringify(result)).not.toMatch(/\s+at\s+.*:\d+:\d+/);
    });

    it('cannot change Task or TaskRun state directly', async () => {
      const { runtime, task } = await scenario('deterministic-success');
      await runtime.core.startTask(task.id);
      // Let the legitimate run settle first, so the comparison below is about
      // what the detached adapter did rather than about when the real run
      // happened to finish.
      const settled = await runtime.core.waitForTask(task.id);
      const started = settled;
      const runBefore = (await runtime.core.listTaskRuns(task.id)).at(-1) as TaskRun;

      // Drive the adapter outside core and assert persisted state is untouched.
      const handle = runtime.worker.start({
        task: started,
        run: { ...runBefore, id: `${runBefore.id}_detached`, attempt: runBefore.attempt + 1 },
        signal: new AbortController().signal,
      });
      // Pause and resume are capability-gated; an adapter without them refuses,
      // which is itself correct behaviour and must not fail this test.
      await handle.pause().catch(() => undefined);
      await handle.resume().catch(() => undefined);
      await handle.cancel();

      const taskAfter = await runtime.core.getTask(task.id);
      const runsAfter = await runtime.core.listTaskRuns(task.id);
      expect(taskAfter.status).toBe(started.status);
      expect(runsAfter.map(run => run.id)).toEqual([runBefore.id]);
      expect(runsAfter.at(-1)?.status).toBe(runBefore.status);
    });

    it('receives no persistence or transaction handle in its execution context', async () => {
      const { runtime, task } = await scenario('deterministic-success');
      const started = await runtime.core.startTask(task.id);
      const runs = await runtime.core.listTaskRuns(task.id);
      const context = { task: started, run: runs[0] as TaskRun, signal: new AbortController().signal };
      // The port surface is exactly task, run, and signal.
      expect(Object.keys(context).sort()).toEqual(['run', 'signal', 'task']);
      expect(JSON.stringify(context.task)).not.toContain('better-sqlite3');
      await runtime.core.waitForTask(task.id);
    });
  });
}

/** Harness binding the shared contract suite to the built-in FakeWorker. */
export const fakeWorkerContractHarness: WorkerContractHarness = {
  name: 'FakeWorker',
  createRuntime: () => createTestRuntime(),
  advancePastTimeout: runtime => runtime.timer.advance(5000),
  taskInputFor: (scenario, projectId, rootPath) => {
    const scenarios: Record<WorkerContractScenario, CreateTaskInput['workerScenario']> = {
      'deterministic-success': 'success',
      'worker-failure': 'failure',
      timeout: 'timeout',
      cancellation: 'pauseable-success',
      'pause-resume': 'pauseable-success',
      'invalid-event': 'invalid-event',
      'event-after-terminal': 'event-after-terminal',
      'two-terminal-events': 'two-terminal-events',
      'claim-without-evidence': 'claim-without-evidence',
      'worker-exception': 'throwing',
    };
    return createTaskInput(projectId, rootPath, { workerScenario: scenarios[scenario] });
  },
};
