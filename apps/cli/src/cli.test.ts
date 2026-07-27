import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DisposableWorkspace, createTestRuntime, type TestRuntime } from '@intentsmith/testing';

import { createCoreTransport, runCli } from './cli.js';

let runtime: TestRuntime;
let workspace: DisposableWorkspace;

beforeEach(() => {
  runtime = createTestRuntime();
  workspace = new DisposableWorkspace();
});

afterEach(async () => {
  await runtime.core.shutdown();
  runtime.cleanup();
  workspace.cleanup();
});

describe('intentsmith CLI', () => {
  it('formats health and version for people', async () => {
    const transport = createCoreTransport(runtime.core);
    expect((await runCli(['health'], transport)).stdout).toBe('health: ok\n');
    expect((await runCli(['version'], transport)).stdout).toBe('IntentSmith 0.1.0\n');
  });

  it('emits machine-readable JSON', async () => {
    const result = await runCli(['version', '--json'], createCoreTransport(runtime.core));
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ version: '0.1.0', cli: 'intentsmith' });
  });

  it('returns a non-zero exit code and stable JSON error code', async () => {
    const result = await runCli(
      ['task', 'show', '--task-id', 'missing', '--json'],
      createCoreTransport(runtime.core),
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout).error.code).toBe('TASK_NOT_FOUND');
  });

  it('returns a contract error for invalid command values', async () => {
    const transport = createCoreTransport(runtime.core);
    const project = await runtime.core.createProject({ name: 'CLI validation', rootPath: workspace.path });
    const result = await runCli([
      'task',
      'create',
      '--project-id',
      project.id,
      '--goal',
      'Invalid timeout',
      '--timeout-ms',
      '-1',
      '--json',
    ], transport);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).error.code).toBe('CONTRACT_VALIDATION_FAILED');
  });

  it('runs create, start, result and audit through an injected transport', async () => {
    const transport = createCoreTransport(runtime.core);
    const projectResult = await runCli([
      'project',
      'create',
      '--name',
      'CLI project',
      '--root',
      workspace.path,
      '--json',
    ], transport);
    const projectId = JSON.parse(projectResult.stdout).id as string;

    const taskResult = await runCli([
      'task',
      'create',
      '--project-id',
      projectId,
      '--goal',
      'Run offline fake worker',
      '--json',
    ], transport);
    const taskId = JSON.parse(taskResult.stdout).id as string;
    expect((await runCli(['task', 'start', '--task-id', taskId], transport)).exitCode).toBe(0);
    await runtime.core.waitForTask(taskId);

    const result = await runCli(['task', 'result', '--task-id', taskId, '--json'], transport);
    const audit = await runCli(['task', 'audit', '--task-id', taskId, '--json'], transport);
    expect(JSON.parse(result.stdout).coreVerdict).toBe('pass');
    expect(JSON.parse(audit.stdout).events.at(-1).type).toBe('task.verdict');
  });

  it('supports pause, resume and cancel commands', async () => {
    const transport = createCoreTransport(runtime.core);
    const project = await runtime.core.createProject({ name: 'CLI lifecycle', rootPath: workspace.path });
    const create = await runCli([
      'task',
      'create',
      '--project-id',
      project.id,
      '--goal',
      'Pause and resume',
      '--scenario',
      'pauseable-success',
      '--json',
    ], transport);
    const taskId = JSON.parse(create.stdout).id as string;
    await runCli(['task', 'start', '--task-id', taskId], transport);
    expect((await runCli(['task', 'pause', '--task-id', taskId, '--json'], transport)).exitCode).toBe(0);
    expect(JSON.parse((await runCli(['task', 'resume', '--task-id', taskId, '--json'], transport)).stdout).status).toBe('running');
    await runtime.core.waitForTask(taskId);

    const pendingCreate = await runCli([
      'task',
      'create',
      '--project-id',
      project.id,
      '--goal',
      'Cancel pending',
      '--json',
    ], transport);
    const pendingId = JSON.parse(pendingCreate.stdout).id as string;
    expect(JSON.parse((await runCli(['task', 'cancel', '--task-id', pendingId, '--json'], transport)).stdout).status).toBe('cancelled');
  });
});
