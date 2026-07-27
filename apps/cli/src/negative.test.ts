import { afterEach, describe, expect, it } from 'vitest';

import { DomainError } from '@intentsmith/core';
import { DisposableWorkspace, createTestRuntime, type TestRuntime } from '@intentsmith/testing';

import { createCoreTransport, createHttpTransport, runCli, type CliTransport } from './cli.js';

/** Negative and adversarial CLI tests. */

const runtimes: TestRuntime[] = [];
const workspaces: DisposableWorkspace[] = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    await runtime.core.shutdown();
    runtime.cleanup();
  }
  for (const workspace of workspaces.splice(0)) workspace.cleanup();
});

function coreTransport(): CliTransport {
  const runtime = createTestRuntime();
  runtimes.push(runtime);
  const workspace = new DisposableWorkspace();
  workspaces.push(workspace);
  return createCoreTransport(runtime.core);
}

/** ANSI escape sequences must never appear in machine-readable output. */
// Built from a char code so the source file stays free of control characters.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`);

/** Binds the HTTP transport to a port nothing is listening on. */
function unreachableTransport(timeoutMs = 10_000): CliTransport {
  return createHttpTransport('http://127.0.0.1:1', timeoutMs);
}

describe('CLI negative paths', () => {
  it('reports a stable code when the server is unreachable', async () => {
    const result = await runCli(['health', '--json'], unreachableTransport());
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).error.code).toBe('SERVER_UNAVAILABLE');
  });

  it('reports a stable code when the request times out', async () => {
    const transport: CliTransport = {
      ...unreachableTransport(),
      health: async () => {
        throw new DomainError('SERVER_TIMEOUT', 'Request timed out', true);
      },
    };
    const result = await runCli(['health', '--json'], transport);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).error.code).toBe('SERVER_TIMEOUT');
  });

  it('reports a stable code when the server returns invalid JSON', async () => {
    const transport: CliTransport = {
      ...unreachableTransport(),
      health: async () => {
        throw new DomainError('INVALID_SERVER_RESPONSE', 'Server returned a response that is not valid JSON.');
      },
    };
    const result = await runCli(['health', '--json'], transport);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).error.code).toBe('INVALID_SERVER_RESPONSE');
  });

  it('rejects an unknown command with a non-zero exit code', async () => {
    const result = await runCli(['teleport'], coreTransport());
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('CLI_USAGE_ERROR');
    expect(result.stdout).toBe('');
  });

  it('rejects an unknown subcommand', async () => {
    const result = await runCli(['task', 'obliterate', '--task-id', 'task_1'], coreTransport());
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('CLI_USAGE_ERROR');
  });

  it('rejects a missing required argument', async () => {
    const result = await runCli(['task', 'show'], coreTransport());
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Missing required option --task-id');
  });

  it('rejects an option given without a value', async () => {
    const result = await runCli(['task', 'show', '--task-id'], coreTransport());
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('CLI_USAGE_ERROR');
  });

  it('rejects an invalid argument value with a domain error', async () => {
    const result = await runCli(
      ['project', 'create', '--name', 'p', '--root', 'relative/not/absolute', '--json'],
      coreTransport(),
    );
    expect(result.exitCode).toBe(1);
    const error = JSON.parse(result.stdout).error;
    expect(error.code).toMatch(/CONTRACT_VALIDATION_FAILED|INVALID_WORKSPACE_ROOT/);
  });

  it('reports an unknown task with a stable code and non-zero exit', async () => {
    const result = await runCli(['task', 'show', '--task-id', 'task_missing', '--json'], coreTransport());
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).error.code).toBe('TASK_NOT_FOUND');
  });

  it('reports an invalid lifecycle transition with a stable code', async () => {
    const transport = coreTransport();
    const workspace = workspaces.at(-1)!;
    const project = await transport.createProject({ name: 'cli', rootPath: workspace.path });
    const task = await transport.createTask({
      projectId: project.id,
      type: 'code',
      goal: 'cli goal',
      scope: {
        fsReadRoots: [workspace.path],
        fsWriteRoots: [workspace.path],
        allowedCommandFamilies: [],
        deniedCommandPatterns: [],
        network: { mode: 'disabled', allowlist: [] },
        envAllowlist: ['PATH'],
        secrets: 'none',
        processSpawning: 'disabled',
        timeoutMs: 1000,
        maxActions: 0,
        approvalRules: [],
      },
      expectedOutputs: ['out'],
      acceptanceCriteria: ['ok'],
    });

    const result = await runCli(['task', 'resume', '--task-id', task.id, '--json'], transport);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).error.code).toBe('INVALID_TASK_TRANSITION');
  });

  it('emits no ANSI escapes and valid JSON on the error path in --json mode', async () => {
    const result = await runCli(['task', 'show', '--task-id', 'task_missing', '--json'], coreTransport());
    expect(result.stdout).not.toMatch(ANSI);
    expect(result.stderr).toBe('');
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });

  it('emits no ANSI escapes and valid JSON on the success path in --json mode', async () => {
    const result = await runCli(['version', '--json'], coreTransport());
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toMatch(ANSI);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({ cli: 'intentsmith' });
  });

  it('writes human errors to stderr only when --json is absent', async () => {
    const result = await runCli(['task', 'show', '--task-id', 'task_missing'], coreTransport());
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('TASK_NOT_FOUND');
    expect(result.stderr).not.toMatch(ANSI);
  });

  it('never leaks a stack trace through the CLI error path', async () => {
    const transport: CliTransport = {
      ...coreTransport(),
      health: async () => {
        throw new Error('kaboom at /home/someone/project/file.ts:9:1');
      },
    };
    const result = await runCli(['health', '--json'], transport);
    expect(result.exitCode).toBe(1);
    const error = JSON.parse(result.stdout).error;
    expect(error).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal error', retryable: false });
    expect(result.stdout).not.toContain('/home/');
  });
});
