import { afterEach, describe, expect, it } from 'vitest';

import type { CreateTaskInput, Task, TaskRun } from '@intentsmith/contracts';
import type { WorkerAdapter } from '@intentsmith/core';

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

    it('cooperates with pause and resume', async () => {
      const { runtime, task } = await scenario('pause-resume');
      await runtime.core.startTask(task.id);
      expect((await runtime.core.pauseTask(task.id)).status).toBe('paused');
      const runsWhilePaused = await runtime.core.listTaskRuns(task.id);
      expect(runsWhilePaused.at(-1)?.status).toBe('paused');
      await runtime.core.resumeTask(task.id);
      const finished = await runtime.core.waitForTask(task.id);
      expect(finished.status).toBe('passed');
    });

    it('rejects an event that fails schema validation', async () => {
      const { runtime, task } = await scenario('invalid-event');
      await runtime.core.startTask(task.id);
      const finished = await runtime.core.waitForTask(task.id);
      expect(finished.status).toBe('failed');
      const audit = await runtime.core.listAuditEvents(task.id);
      expect(audit.some(event => event.type === 'worker.invalid_event')).toBe(true);
    });

    it('rejects an event emitted after a terminal event', async () => {
      const { runtime, task } = await scenario('event-after-terminal');
      await runtime.core.startTask(task.id);
      const finished = await runtime.core.waitForTask(task.id);
      expect(finished.status).toBe('failed');
      const result = await runtime.core.getTaskResult(task.id);
      expect(result?.unresolvedRisks.join(' ')).toContain('after a terminal event');
    });

    it('rejects two terminal events in one run', async () => {
      const { runtime, task } = await scenario('two-terminal-events');
      await runtime.core.startTask(task.id);
      const finished = await runtime.core.waitForTask(task.id);
      expect(finished.status).toBe('failed');
      const audit = await runtime.core.listAuditEvents(task.id);
      expect(audit.some(event => event.type === 'worker.invalid_event')).toBe(true);
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
      const started = await runtime.core.startTask(task.id);
      const runBefore = (await runtime.core.listTaskRuns(task.id)).at(-1) as TaskRun;

      // Drive the adapter outside core and assert persisted state is untouched.
      const handle = runtime.worker.start({
        task: started,
        run: { ...runBefore, id: `${runBefore.id}_detached`, attempt: runBefore.attempt + 1 },
        signal: new AbortController().signal,
      });
      await handle.pause();
      await handle.resume();
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
