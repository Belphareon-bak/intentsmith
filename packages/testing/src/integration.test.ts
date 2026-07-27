import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { IntentSmithCore } from '@intentsmith/core';
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
    const result = await context.core.getTaskResult(context.taskId);
    expect(result?.coreVerdict).toBe('fail');
    expect(result?.unresolvedRisks).toContain('Worker timed out before producing a valid result.');
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
): Promise<{ core: IntentSmithCore; taskId: string; timer: FakeTimer }> {
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
  return { core: runtime.core, taskId: task.id, timer: runtime.timer };
}
