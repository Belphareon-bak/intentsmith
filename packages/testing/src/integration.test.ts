import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { evaluateCapabilityRequest } from '@intentsmith/worker-sdk';
import { IntentSmithCore, type ApprovalLedger } from '@intentsmith/core';
import { openIntentSmithDatabase } from '@intentsmith/persistence';

import {
  DeterministicIdGenerator,
  DisposableWorkspace,
  FakeClock,
  FakeTimer,
  createTaskInput,
  createTestRuntime,
} from './fakes.js';
import { FakeWorker } from './fake-worker.js';

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

describe('deterministic vertical slice', () => {
  it('creates, starts and passes a task with evidence', async () => {
    const context = await createContext('success');
    await context.core.startTask(context.taskId);
    expect((await context.core.waitForTask(context.taskId)).status).toBe('passed');
    expect((await context.core.getTaskResult(context.taskId))?.coreVerdict).toBe('pass');
  });

  it('pauses, resumes and then passes a cooperative task', async () => {
    const context = await createContext('pauseable-success');
    await context.core.startTask(context.taskId);
    expect((await context.core.pauseTask(context.taskId)).status).toBe('paused');
    expect((await context.core.resumeTask(context.taskId)).status).toBe('running');
    expect((await context.core.waitForTask(context.taskId)).status).toBe('passed');
  });

  it('cancels pending and running tasks and rejects resume after cancellation', async () => {
    const pending = await createContext('success');
    expect((await pending.core.cancelTask(pending.taskId)).status).toBe('cancelled');
    await expect(pending.core.resumeTask(pending.taskId)).rejects.toMatchObject({
      code: 'INVALID_TASK_TRANSITION',
    });
    expect((await pending.core.listAuditEvents(pending.taskId)).at(-1)?.type).toBe('task.invalid_transition');

    const running = await createContext('timeout', 1000);
    await running.core.startTask(running.taskId);
    expect((await running.core.cancelTask(running.taskId)).status).toBe('cancelled');
    expect((await running.core.getTaskResult(running.taskId))?.coreVerdict).toBe('cancelled');
  });

  it.each([
    ['failure', 'fail'],
    ['claim-without-evidence', 'fail'],
    ['invalid-event', 'fail'],
  ] as const)('turns %s into a deterministic %s verdict', async (scenario, verdict) => {
    const context = await createContext(scenario);
    await context.core.startTask(context.taskId);
    await context.core.waitForTask(context.taskId);
    expect((await context.core.getTaskResult(context.taskId))?.coreVerdict).toBe(verdict);
  });

  it('classifies timeout as failure and aborts the worker', async () => {
    const context = await createContext('timeout', 10);
    await context.core.startTask(context.taskId);
    // Timeouts are driven by the injected timer, never by wall-clock time.
    context.timer.advance(10);
    expect((await context.core.waitForTask(context.taskId)).status).toBe('failed');
    const [run] = await context.core.listTaskRuns(context.taskId);
    expect(run).toBeDefined();
    expect(context.worker.handle(run?.id ?? '')?.isCancelled).toBe(true);
    const result = await context.core.getTaskResult(context.taskId);
    expect(result?.coreVerdict).toBe('fail');
    expect(result?.unresolvedRisks).toContain('Worker timed out before producing a valid result.');
  });

  it('revokes an outstanding approval when its run is cancelled', async () => {
    const context = await createContext('pauseable-success');
    await context.core.startTask(context.taskId);
    const run = (await context.core.listTaskRuns(context.taskId))[0];
    if (!run) throw new Error('expected a run');

    const target = path.join(context.workspaceRoot, 'edited.txt');
    const request = {
      toolName: 'edit',
      actionId: 'call_1',
      resourcePaths: [target],
      payload: { filepath: target, diff: '@@ -0 +1 @@' },
    };
    const decision = evaluateCapabilityRequest(request, { workspaceRoot: context.workspaceRoot });
    if (decision.outcome !== 'requires_approval') throw new Error('expected an approval to be required');
    const approval = await context.approvals.request({
      taskId: context.taskId,
      runId: run.id,
      request,
      decision,
    });
    await context.approvals.approve(approval.id);

    await context.core.cancelTask(context.taskId);

    // A grant that outlived its run would be permission with nothing left to
    // authorize, which is exactly what gets reused for something else.
    const outcome = await context.approvals.consume({ runId: run.id, request });
    expect(outcome).toMatchObject({ allowed: false, refusal: 'revoked' });
  });

  it('cancels active work during core shutdown', async () => {
    const context = await createContext('timeout', 1000);
    await context.core.startTask(context.taskId);
    await context.core.shutdown();
    expect((await context.core.getTask(context.taskId)).status).toBe('cancelled');
    expect((await context.core.getTaskResult(context.taskId))?.coreVerdict).toBe('cancelled');
  });

  it('records lifecycle and worker events in order', async () => {
    const context = await createContext('success');
    await context.core.startTask(context.taskId);
    await context.core.waitForTask(context.taskId);
    const types = (await context.core.listAuditEvents(context.taskId)).map(event => event.type);
    expect(types).toEqual([
      'task.created',
      'task.transition',
      'worker.event',
      'worker.event',
      'worker.event',
      'task.verdict',
    ]);
  });

  it('reloads persisted task state and results after a process-style restart', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'intentsmith-restart-'));
    const dbPath = path.join(root, 'state.db');
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const workspace = new DisposableWorkspace();
    cleanups.push(() => workspace.cleanup());

    const first = createTestRuntime(dbPath);
    const project = await first.core.createProject({ name: 'restart', rootPath: workspace.path });
    const task = await first.core.createTask(createTaskInput(project.id, workspace.path));
    await first.core.startTask(task.id);
    await first.core.waitForTask(task.id);
    first.cleanup();

    const store = openIntentSmithDatabase(dbPath);
    const second = new IntentSmithCore({
      clock: new FakeClock(),
      ids: new DeterministicIdGenerator(),
      projects: store,
      tasks: store,
      audit: store,
      transactions: store,
      worker: new FakeWorker(),
    });
    expect((await second.getTask(task.id)).status).toBe('passed');
    expect((await second.getTaskResult(task.id))?.coreVerdict).toBe('pass');
    store.close();
    expect(existsSync(dbPath)).toBe(true);
  });

  it('rejects task capability roots outside the project', async () => {
    const runtime = createTestRuntime();
    const projectWorkspace = new DisposableWorkspace();
    const outsideWorkspace = new DisposableWorkspace();
    cleanups.push(() => runtime.cleanup(), () => projectWorkspace.cleanup(), () => outsideWorkspace.cleanup());
    const project = await runtime.core.createProject({ name: 'scope', rootPath: projectWorkspace.path });

    await expect(runtime.core.createTask(createTaskInput(project.id, outsideWorkspace.path))).rejects.toMatchObject({
      code: 'TASK_SCOPE_OUTSIDE_PROJECT',
    });
  });
});

async function createContext(
  scenario: Parameters<typeof createTaskInput>[2] extends infer T
    ? T extends { workerScenario?: infer S }
      ? S
      : never
    : never,
  timeoutMs = 1000,
): Promise<{
  core: IntentSmithCore;
  taskId: string;
  timer: FakeTimer;
  worker: FakeWorker;
  approvals: ApprovalLedger;
  workspaceRoot: string;
}> {
  const runtime = createTestRuntime();
  const workspace = new DisposableWorkspace();
  cleanups.push(() => runtime.cleanup(), () => workspace.cleanup());
  const project = await runtime.core.createProject({ name: `project-${scenario}`, rootPath: workspace.path });
  const task = await runtime.core.createTask(createTaskInput(project.id, workspace.path, {
    workerScenario: scenario,
    timeoutMs,
    scope: {
      ...createTaskInput(project.id, workspace.path).scope,
      timeoutMs,
    },
  }));
  return {
    core: runtime.core,
    taskId: task.id,
    timer: runtime.timer,
    worker: runtime.worker,
    approvals: runtime.approvals,
    workspaceRoot: workspace.path,
  };
}
