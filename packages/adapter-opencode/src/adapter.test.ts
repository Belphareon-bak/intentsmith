import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { Task, TaskRun } from '@intentsmith/contracts';
import type { InferenceGrant } from '@intentsmith/worker-sdk';

import { OpenCodeWorker, type PermissionDecision, type ToolProposal } from './adapter.js';
import { createFakeAgent, type FakeAgentBehaviour } from './fixtures.js';

/**
 * OpenCode adapter behaviour against a real fake-ACP child process.
 *
 * No OpenCode installation is needed. The fake is a genuine process, so spawn,
 * stdio framing, protocol violations, cancellation and termination are all
 * exercised for real.
 */

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const GRANT: InferenceGrant = {
  baseUrl: 'http://127.0.0.1:65500',
  token: 'fixture-token',
  modelId: 'qwen3:14b',
};

function fakeTask(): Task {
  return {
    id: 'task_1',
    projectId: 'project_1',
    dependencyIds: [],
    type: 'code',
    goal: 'make the fixture test pass',
    scope: {
      fsReadRoots: ['/'],
      fsWriteRoots: [],
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
    inputs: [],
    expectedOutputs: ['a passing test'],
    acceptanceCriteria: ['fixture gate passes'],
    workerPreference: { kind: 'fake', scenario: 'success' },
    timeoutMs: 1000,
    retryPolicy: { maxAttempts: 1, backoffMs: 0 },
    status: 'running',
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
  };
}

const fakeRun: TaskRun = {
  id: 'run_1',
  taskId: 'task_1',
  attempt: 1,
  status: 'running',
  startedAt: '2026-07-28T00:00:00.000Z',
};

type RunOptions = {
  behaviour: FakeAgentBehaviour;
  workspace?: string;
  onPermissionRequest?: (proposal: ToolProposal) => Promise<PermissionDecision>;
  withGrant?: boolean;
  runtimeRoots?: string[];
};

async function runAgent(options: RunOptions) {
  const agent = createFakeAgent({ behaviour: options.behaviour });
  cleanups.push(() => agent.cleanup());
  const workspace = options.workspace ?? tempDir('intentsmith-adapter-ws-');

  const worker = new OpenCodeWorker({
    executable: process.execPath,
    args: [agent.scriptPath],
    expectedVersion: 'fake-opencode/0.0.0',
    preferSandbox: false,
    limits: { startupMs: 3_000, idleMs: 3_000, overallMs: 8_000, terminationGraceMs: 200 },
    ...(options.onPermissionRequest ? { onPermissionRequest: options.onPermissionRequest } : {}),
    ...(options.runtimeRoots
      ? {
          makeRuntimeRoot: () => {
            const root = tempDir('intentsmith-adapter-rt-');
            options.runtimeRoots?.push(root);
            return root;
          },
        }
      : {}),
  });

  const handle = worker.start({
    task: fakeTask(),
    run: fakeRun,
    signal: new AbortController().signal,
    workspaceRoot: workspace,
    ...(options.withGrant === false ? {} : { inference: GRANT }),
  });

  return { worker, handle, workspace, agent };
}

const eventTypes = (events: unknown[]): string[] =>
  events.map(event => (event as { type: string }).type);

const failure = (events: unknown[]): { code: string; message: string } | undefined =>
  (events.find(event => (event as { type: string }).type === 'failed') as
    | { error: { code: string; message: string } }
    | undefined)?.error;

describe('adapter description', () => {
  it('claims nothing before a session has negotiated anything', () => {
    const worker = new OpenCodeWorker({ executable: '/nonexistent', expectedVersion: 'pinned/1.2.3' });
    const descriptor = worker.describe();
    expect(descriptor.id).toBe('opencode');
    expect(descriptor.version).toBe('pinned/1.2.3');
    // Pause is not emulated, and nothing is assumed from the ACP schema.
    expect(descriptor.capabilities.pause).toBe(false);
    expect(descriptor.detailed?.protocolVersion).toBeUndefined();
    expect(descriptor.detailed?.limitations?.join(' ')).toContain('nothing is assumed');
  });

  it('records what the agent actually negotiated', async () => {
    const { worker, handle } = await runAgent({ behaviour: 'success' });
    await handle.done;

    const detailed = worker.describe().detailed;
    expect(detailed?.protocolVersion).toBe(1);
    expect(detailed?.workerVersion).toBe('0.0.0-fixture');
    expect(detailed?.session?.loadSession).toEqual({ available: false, source: 'negotiated' });
    // The agent said nothing about terminal support, so it stays unknown.
    expect(detailed?.session?.terminal?.source).toBe('unknown');
    expect(detailed?.limitations?.join(' ')).toContain('terminal support');
  });

  it('records a protocol version mismatch as a limitation', async () => {
    const agent = createFakeAgent({ behaviour: 'success', protocolVersion: 99 });
    cleanups.push(() => agent.cleanup());
    const worker = new OpenCodeWorker({
      executable: process.execPath,
      args: [agent.scriptPath],
      preferSandbox: false,
      limits: { terminationGraceMs: 200 },
    });
    const handle = worker.start({
      task: fakeTask(),
      run: fakeRun,
      signal: new AbortController().signal,
      workspaceRoot: tempDir('intentsmith-adapter-ws-'),
      inference: GRANT,
    });
    await handle.done;
    expect(worker.describe().detailed?.limitations?.join(' ')).toContain('negotiated ACP protocol version 99');
  });
});

describe('adapter run outcomes', () => {
  it('completes a successful turn and reports sandbox status', async () => {
    const { worker, handle } = await runAgent({ behaviour: 'success' });
    const result = await handle.done;

    expect(eventTypes(result.events)).toContain('started');
    expect(failure(result.events)).toBeUndefined();
    // Sandbox status is recorded as evidence for every run.
    expect(worker.sandboxStatus?.level).toBe('degraded');
    expect(eventTypes(result.events)).toContain('artifact');
  });

  it('refuses to run without a disposable workspace', async () => {
    const worker = new OpenCodeWorker({ executable: process.execPath, preferSandbox: false });
    const handle = worker.start({
      task: fakeTask(),
      run: fakeRun,
      signal: new AbortController().signal,
      inference: GRANT,
    });
    const result = await handle.done;
    // The original project must never be the thing being edited.
    expect(failure(result.events)?.message).toContain('disposable workspace');
  });

  it('reports a missing executable with actionable guidance', async () => {
    const worker = new OpenCodeWorker({
      executable: path.join(tempDir('intentsmith-missing-'), 'opencode'),
      preferSandbox: false,
      limits: { terminationGraceMs: 100 },
    });
    const handle = worker.start({
      task: fakeTask(),
      run: fakeRun,
      signal: new AbortController().signal,
      workspaceRoot: tempDir('intentsmith-adapter-ws-'),
      inference: GRANT,
    });
    const result = await handle.done;
    const error = failure(result.events);
    expect(error?.code).toBe('WORKER_EXECUTABLE_MISSING');
    expect(error?.message).toContain('never installs it for you');
  });

  it('fails when the agent crashes mid-turn', async () => {
    const { handle } = await runAgent({ behaviour: 'crashes' });
    const result = await handle.done;
    expect(failure(result.events)?.message).toContain('exited before the session completed');
  });

  it('fails on malformed JSON-RPC from the agent', async () => {
    const { handle } = await runAgent({ behaviour: 'protocol-garbage' });
    const result = await handle.done;
    expect(failure(result.events)).toBeDefined();
  });

  it('survives stdout pollution but records it as a protocol error', async () => {
    const { handle } = await runAgent({ behaviour: 'stdout-pollution' });
    const result = await handle.done;
    // A non-JSON line means the process is not purely speaking ACP.
    expect(failure(result.events)?.code).toBe('WORKER_PROTOCOL_ERROR');
  });

  it('fails when the agent never answers initialize', async () => {
    const { handle } = await runAgent({ behaviour: 'no-initialize' });
    const result = await handle.done;
    expect(failure(result.events)).toBeDefined();
  });

  it('never leaks a stack frame into a failure message', async () => {
    const { handle } = await runAgent({ behaviour: 'crashes' });
    const result = await handle.done;
    expect(failure(result.events)?.message ?? '').not.toMatch(/\s+at\s+\S+:\d+:\d+/);
  });
});

describe('permission authority', () => {
  it('denies by default when Core installed no handler', async () => {
    const { handle } = await runAgent({ behaviour: 'requests-permission' });
    // The agent waits for an answer; cancel to end the run.
    setTimeout(() => void handle.cancel(), 300);
    const result = await handle.done;

    const evidence = result.events.filter(
      event => (event as { type: string }).type === 'evidence',
    ) as Array<{ evidence: { summary: string; status: string } }>;
    const permission = evidence.find(entry => entry.evidence.summary.includes('Permission'));
    // Silence must never read as consent.
    expect(permission?.evidence.status).toBe('fail');
    expect(permission?.evidence.summary).toContain('denied');
  });

  it('forwards a normalized proposal to Core and honours a denial', async () => {
    const seen: ToolProposal[] = [];
    const { handle } = await runAgent({
      behaviour: 'requests-permission',
      onPermissionRequest: async proposal => {
        seen.push(proposal);
        // Core denies: the path is outside the disposable workspace.
        return { allowed: false, reason: 'path outside workspace' };
      },
    });
    setTimeout(() => void handle.cancel(), 300);
    await handle.done;

    expect(seen).toHaveLength(1);
    expect(seen[0]?.toolCallId).toBe('tool-1');
    expect(seen[0]?.paths).toEqual(['/etc/passwd']);
    expect(seen[0]?.options.map(option => option.optionId)).toEqual(['allow', 'reject']);
  });

  it('records an approval as security evidence', async () => {
    const { handle } = await runAgent({
      behaviour: 'requests-permission',
      onPermissionRequest: async () => ({ allowed: true, reason: 'inside workspace' }),
    });
    setTimeout(() => void handle.cancel(), 300);
    const result = await handle.done;

    const evidence = result.events.filter(
      event => (event as { type: string }).type === 'evidence',
    ) as Array<{ evidence: { kind: string; status: string; summary: string } }>;
    const permission = evidence.find(entry => entry.evidence.kind === 'security');
    expect(permission?.evidence.status).toBe('pass');
    expect(permission?.evidence.summary).toContain('granted');
  });
});

describe('lifecycle control', () => {
  it('refuses pause honestly rather than emulating it', async () => {
    const { handle } = await runAgent({ behaviour: 'success' });
    await handle.done;
    await expect(handle.pause()).rejects.toThrow(/does not support pause/);
    await expect(handle.resume()).rejects.toThrow(/does not support resume/);
  });

  it('cancels a hung agent and leaves no process behind', async () => {
    const { handle } = await runAgent({ behaviour: 'hangs' });
    await handle.cancel();
    const result = await handle.done;
    expect(result.events.length).toBeGreaterThan(0);
  });

  it('forcefully terminates an agent that ignores cancel', async () => {
    const { handle } = await runAgent({ behaviour: 'ignores-cancel' });
    await handle.cancel();
    // The run still ends: cooperative first, SIGKILL to the group second.
    const result = await handle.done;
    expect(result.events).toBeDefined();
  });

  it('removes the throwaway runtime directory when the run ends', async () => {
    const runtimeRoots: string[] = [];
    const { handle } = await runAgent({ behaviour: 'success', runtimeRoots });
    await handle.done;

    expect(runtimeRoots).toHaveLength(1);
    // The generated config held a provider definition; it must not linger.
    expect(existsSync(runtimeRoots[0] as string)).toBe(false);
  });

  it('writes the generated config inside the throwaway runtime, not the workspace', async () => {
    const workspace = tempDir('intentsmith-adapter-ws-');
    const { handle } = await runAgent({ behaviour: 'success', workspace });
    await handle.done;
    // Nothing OpenCode-config-shaped is left in the workspace.
    expect(readdirSync(workspace)).not.toContain('opencode.json');
  });
});
