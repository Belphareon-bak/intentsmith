import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { Task, TaskRun } from '@intentsmith/contracts';
import type { CapabilityRequest } from '@intentsmith/worker-sdk';

import { OpenCodeWorker, type PermissionDecision } from './adapter.js';
import { FAKE_AGENT_LOG_FILE, createFakeAgent } from './fixtures.js';

/**
 * Cancellation and timeout while a permission request is outstanding.
 *
 * This is the dangerous window: the agent has asked, nobody has answered, and
 * the run is ending. The failure to rule out is an implicit yes — a default
 * option selected on the way out, or a side effect that lands because the agent
 * stopped waiting.
 *
 * The fake agent here waits for a real answer before writing anything, so "no
 * file" is a genuine proof rather than an artefact of the fixture never trying.
 * The equivalent against the pinned real binary lives in
 * `tools/opencode/real-binary.test.ts` and is opt-in.
 */

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const EDIT_PATH = 'src/created-by-worker.txt';

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const fakeTask = (): Task => ({
  id: 'task_1',
  projectId: 'project_1',
  dependencyIds: [],
  type: 'code',
  goal: 'edit a file',
  scope: {
    fsReadRoots: ['/tmp'],
    fsWriteRoots: ['/tmp'],
    allowedCommandFamilies: [],
    deniedCommandPatterns: [],
    network: { mode: 'disabled', allowlist: [] },
    envAllowlist: [],
    secrets: 'none',
    processSpawning: 'disabled',
    timeoutMs: 5_000,
    maxActions: 0,
    approvalRules: [],
  },
  inputs: [],
  expectedOutputs: ['an edit'],
  acceptanceCriteria: ['file exists'],
  timeoutMs: 5_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  workerPreference: { kind: 'fake', scenario: 'success' },
  status: 'running',
  createdAt: '2026-07-28T00:00:00.000Z',
  updatedAt: '2026-07-28T00:00:00.000Z',
});

const fakeRun = (): TaskRun => ({
  id: 'run_1',
  taskId: 'task_1',
  attempt: 1,
  status: 'running',
  startedAt: '2026-07-28T00:00:00.000Z',
});

type Harness = {
  handle: ReturnType<OpenCodeWorker['start']>;
  processPid: () => number | undefined;
  workspace: string;
  requests: CapabilityRequest[];
  outbound: unknown[];
  agentLog: () => Array<Record<string, unknown>>;
  editExists: () => boolean;
};

/**
 * Starts the waiting agent with a decider that never answers, so the
 * permission stays outstanding for the whole test.
 */
function startWaiting(options: {
  limits?: Record<string, number>;
  decide?: (request: CapabilityRequest) => Promise<PermissionDecision>;
} = {}): Harness {
  const agent = createFakeAgent({ behaviour: 'waits-for-permission', editPath: EDIT_PATH });
  cleanups.push(() => agent.cleanup());
  const workspace = tempDir('intentsmith-pending-ws-');
  const requests: CapabilityRequest[] = [];
  const outbound: unknown[] = [];
  let processPid: number | undefined;

  const worker = new OpenCodeWorker({
    executable: process.execPath,
    args: [agent.scriptPath],
    expectedVersion: 'fake-opencode/0.0.0',
    preferSandbox: false,
    limits: { startupMs: 3_000, idleMs: 3_000, overallMs: 8_000, terminationGraceMs: 200, ...options.limits },
    onWireMessage: (direction, message) => {
      if (direction === 'out') outbound.push(message);
    },
    onProcessStart: pid => {
      processPid = pid;
    },
    onPermissionRequest: async (request): Promise<PermissionDecision> => {
      requests.push(request);
      if (options.decide) return await options.decide(request);
      // Never resolves: this is a human who has not answered yet.
      return await new Promise<PermissionDecision>(() => undefined);
    },
    makeRuntimeRoot: () => tempDir('intentsmith-pending-rt-'),
  });

  const handle = worker.start({
    task: fakeTask(),
    run: fakeRun(),
    signal: new AbortController().signal,
    workspaceRoot: workspace,
  });

  return {
    handle,
    processPid: () => processPid,
    workspace,
    requests,
    outbound,
    agentLog: () => {
      try {
        return JSON.parse(readFileSync(path.join(workspace, FAKE_AGENT_LOG_FILE), 'utf8')) as Array<
          Record<string, unknown>
        >;
      } catch {
        return [];
      }
    },
    editExists: () => existsSync(path.join(workspace, EDIT_PATH)),
  };
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

async function waitForPermission(harness: Harness): Promise<void> {
  await Promise.race([
    waitFor(() => harness.requests.length > 0, 'the agent to request permission'),
    harness.handle.done.then(result => {
      throw new Error(`Run ended before permission was requested: ${JSON.stringify(result.events)}`);
    }),
  ]);
}

function processExists(pid: number | undefined): boolean {
  if (pid === undefined) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Permission responses the adapter sent back to the agent. */
function permissionResponses(outbound: unknown[]): Array<{ optionId?: string }> {
  return outbound
    .filter(message => (message as { result?: { outcome?: unknown } }).result !== undefined)
    .map(message => (message as { result: { outcome?: { optionId?: string } } }).result.outcome ?? {});
}

describe('cancel while a permission is outstanding', () => {
  it('selects no option, produces no side effect and ends exactly once', async () => {
    const harness = startWaiting();
    await waitForPermission(harness);

    // The permission is outstanding and unanswered at this moment.
    expect(harness.editExists()).toBe(false);
    await harness.handle.cancel();
    const result = await harness.handle.done;

    // No option was chosen on the way out. An implicit selection here would be
    // an answer nobody gave.
    expect(permissionResponses(harness.outbound)).toEqual([]);
    expect(harness.editExists()).toBe(false);
    expect(harness.agentLog().some(entry => entry.kind === 'edit')).toBe(false);

    const terminal = result.events.filter(event =>
      ['completed', 'failed', 'cancelled', 'timeout'].includes((event as { type: string }).type),
    );
    expect(terminal).toHaveLength(1);
    // A cancellation is recorded as a terminal failure carrying
    // WORKER_CANCELLED, not as a success and not as an anonymous error.
    expect(terminal[0]).toMatchObject({ type: 'failed', error: { code: 'WORKER_CANCELLED' } });
  });

  it('leaves no process behind', async () => {
    const harness = startWaiting();
    await waitForPermission(harness);
    await harness.handle.cancel();
    await harness.handle.done;

    expect(processExists(harness.processPid())).toBe(false);
    expect(harness.editExists()).toBe(false);
  });

  it('ignores a late approval after terminal cleanup', async () => {
    let allowLate: ((decision: PermissionDecision) => void) | undefined;
    const decision = new Promise<PermissionDecision>(resolve => {
      allowLate = resolve;
    });
    const harness = startWaiting({ decide: async () => await decision });
    await waitForPermission(harness);

    await harness.handle.cancel();
    await harness.handle.done;
    allowLate?.({ allowed: true, reason: 'arrived after cancellation' });
    await decision;

    expect(processExists(harness.processPid())).toBe(false);
    expect(harness.editExists()).toBe(false);
    expect(harness.agentLog().some(entry => entry.kind === 'edit')).toBe(false);
  });
});

describe('timeout while a permission is outstanding', () => {
  it('ends the run without answering and without a side effect', async () => {
    const harness = startWaiting({ limits: { overallMs: 1_200, idleMs: 1_200 } });
    await waitForPermission(harness);

    const result = await harness.handle.done;

    expect(permissionResponses(harness.outbound)).toEqual([]);
    expect(harness.editExists()).toBe(false);

    const terminal = result.events.filter(event =>
      ['completed', 'failed', 'cancelled', 'timeout'].includes((event as { type: string }).type),
    );
    expect(terminal).toHaveLength(1);
    // Whatever it is called, it is not a success.
    expect((terminal[0] as { type: string }).type).not.toBe('completed');
  });
});

describe('worker process failure while a permission is outstanding', () => {
  it('settles the run and leaves no process or side effect behind', async () => {
    const harness = startWaiting();
    await waitForPermission(harness);
    const pid = harness.processPid();
    if (pid === undefined) throw new Error('expected a supervised process pid');

    process.kill(-pid, 'SIGKILL');
    const result = await harness.handle.done;

    expect(processExists(pid)).toBe(false);
    expect(harness.editExists()).toBe(false);
    expect(permissionResponses(harness.outbound)).toEqual([]);
    expect(result.events.at(-1)).toMatchObject({
      type: 'failed',
      error: { code: 'WORKER_CRASHED' },
    });
  });
});

describe('an answered permission still gates the side effect', () => {
  it('writes only after an explicit allow-once', async () => {
    const agent = createFakeAgent({ behaviour: 'waits-for-permission', editPath: EDIT_PATH });
    cleanups.push(() => agent.cleanup());
    const workspace = tempDir('intentsmith-pending-ws-');

    const worker = new OpenCodeWorker({
      executable: process.execPath,
      args: [agent.scriptPath],
      expectedVersion: 'fake-opencode/0.0.0',
      preferSandbox: false,
      limits: { startupMs: 3_000, idleMs: 3_000, overallMs: 8_000, terminationGraceMs: 200 },
      onPermissionRequest: async () => ({ allowed: true, reason: 'approved once' }),
      makeRuntimeRoot: () => tempDir('intentsmith-pending-rt-'),
    });

    const handle = worker.start({
      task: fakeTask(),
      run: fakeRun(),
      signal: new AbortController().signal,
      workspaceRoot: workspace,
    });
    await handle.done;

    // The ordering is the point: the file appears only after the answer.
    const log = JSON.parse(readFileSync(path.join(workspace, FAKE_AGENT_LOG_FILE), 'utf8')) as Array<{
      kind: string;
    }>;
    const kinds = log
      .map(entry => entry.kind)
      .filter(kind => kind !== 'session-created');
    expect(kinds).toEqual(['permission-requested', 'permission-answered', 'edit']);
    expect(existsSync(path.join(workspace, EDIT_PATH))).toBe(true);
  });
});
