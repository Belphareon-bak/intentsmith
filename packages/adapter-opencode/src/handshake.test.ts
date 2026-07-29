import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { Task, TaskRun } from '@intentsmith/contracts';
import type { InferenceGrant } from '@intentsmith/worker-sdk';

import { OpenCodeWorker } from './adapter.js';
import { createFakeAgent, type FakeAgentBehaviour } from './fixtures.js';

/**
 * Wire-level handshake regression tests.
 *
 * `buildSession().start()` issues only `session/new`, so nothing in the SDK
 * sends `initialize` on IntentSmith's behalf. These assert on the actual
 * outbound message order rather than on a constant, which is exactly the
 * mistake that let a missing handshake go unnoticed once already.
 */

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'intentsmith-hs-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const TOKEN = 'gwtok-handshake-9f3b2c7e1a5d8046';
const GRANT: InferenceGrant = { baseUrl: 'http://127.0.0.1:65500', token: TOKEN, modelId: 'fixture' };

function fakeTask(): Task {
  return {
    id: 'task_hs',
    projectId: 'project_hs',
    dependencyIds: [],
    type: 'code',
    goal: 'handshake goal',
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
    expectedOutputs: ['out'],
    acceptanceCriteria: ['ok'],
    workerPreference: { kind: 'fake', scenario: 'success' },
    timeoutMs: 1000,
    retryPolicy: { maxAttempts: 1, backoffMs: 0 },
    status: 'running',
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
  };
}

const fakeRun: TaskRun = {
  id: 'run_hs',
  taskId: 'task_hs',
  attempt: 1,
  status: 'running',
  startedAt: '2026-07-28T00:00:00.000Z',
};

type WireEntry = { direction: 'out' | 'in'; message: Record<string, unknown> };

function start(behaviour: FakeAgentBehaviour, options: { protocolVersion?: number } = {}) {
  const agent = createFakeAgent({
    behaviour,
    ...(options.protocolVersion === undefined ? {} : { protocolVersion: options.protocolVersion }),
  });
  cleanups.push(() => agent.cleanup());
  const workspace = tempDir();
  const wire: WireEntry[] = [];

  const worker = new OpenCodeWorker({
    executable: process.execPath,
    args: [agent.scriptPath],
    expectedVersion: 'fake-opencode/0.0.0',
    preferSandbox: false,
    limits: { startupMs: 3_000, idleMs: 3_000, overallMs: 8_000, terminationGraceMs: 200 },
    onWireMessage: (direction, message) => {
      if (typeof message === 'object' && message !== null) {
        wire.push({ direction, message: message as Record<string, unknown> });
      }
    },
  });

  const handle = worker.start({
    task: fakeTask(),
    run: fakeRun,
    signal: new AbortController().signal,
    workspaceRoot: workspace,
    inference: GRANT,
  });
  return { worker, handle, wire, workspace, agent };
}

/** Outbound request methods, in the order they hit the wire. */
const outboundMethods = (wire: WireEntry[]): string[] =>
  wire
    .filter(entry => entry.direction === 'out' && typeof entry.message.method === 'string')
    .map(entry => entry.message.method as string);

const failureOf = (events: unknown[]) =>
  (events.find(e => (e as { type: string }).type === 'failed') as
    | { error: { code: string; message: string } }
    | undefined)?.error;

describe('ACP handshake order', () => {
  it('sends initialize, then session/new, then session/prompt', async () => {
    const { handle, wire } = start('success');
    await handle.done;

    const methods = outboundMethods(wire);
    expect(methods.slice(0, 3)).toEqual(['initialize', 'session/new', 'session/prompt']);
  });

  it('sends initialize exactly once, as the first outbound message', async () => {
    const { handle, wire } = start('success');
    await handle.done;

    const methods = outboundMethods(wire);
    expect(methods[0]).toBe('initialize');
    expect(methods.filter(method => method === 'initialize')).toHaveLength(1);
  });

  it('carries the negotiated protocol version and client info', async () => {
    const { handle, wire } = start('success');
    await handle.done;

    const initialize = wire.find(
      entry => entry.direction === 'out' && entry.message.method === 'initialize',
    );
    const params = initialize?.message.params as Record<string, unknown> | undefined;
    expect(params?.protocolVersion).toBe(1);
    expect(params?.clientInfo).toMatchObject({ name: 'IntentSmith' });
    // IntentSmith exposes no filesystem or terminal capability to the worker.
    expect(params?.clientCapabilities).toMatchObject({
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
    });
  });

  it('never sends session/new when initialize was not answered', async () => {
    const { handle, wire } = start('no-initialize');
    const result = await handle.done;

    expect(outboundMethods(wire)).not.toContain('session/new');
    expect(failureOf(result.events)).toBeDefined();
  });

  it('a protocol version mismatch prevents session/new', async () => {
    const { handle, wire } = start('success', { protocolVersion: 99 });
    const result = await handle.done;

    const methods = outboundMethods(wire);
    expect(methods[0]).toBe('initialize');
    // The gate runs before anything else is sent.
    expect(methods).not.toContain('session/new');
    expect(methods).not.toContain('session/prompt');

    const error = failureOf(result.events);
    expect(error?.code).toBe('WORKER_PROTOCOL_INCOMPATIBLE');
    expect(error?.message).toContain('protocol version 99');
  });

  it('a malformed initialize response prevents session/new', async () => {
    const { handle, wire } = start('malformed-initialize');
    const result = await handle.done;

    expect(outboundMethods(wire)).not.toContain('session/new');
    expect(failureOf(result.events)?.code).toBe('WORKER_PROTOCOL_INCOMPATIBLE');
  });

  it('cancelling during initialize ends the run without a session', async () => {
    const { handle, wire } = start('stalls-initialize');
    await handle.cancel();
    const result = await handle.done;

    expect(outboundMethods(wire)).not.toContain('session/new');
    expect(failureOf(result.events)?.code).toBe('WORKER_CANCELLED');
  });

  it('rejects a session update that arrives before a session exists', async () => {
    const { handle, wire } = start('update-before-session');
    const result = await handle.done;

    // The premature update belongs to no session this run owns.
    const violations = result.events.filter(
      e => (e as { evidence?: { kind: string } }).evidence?.kind === 'security',
    ) as Array<{ evidence: { summary: string } }>;
    expect(violations.length).toBeGreaterThan(0);
    expect(outboundMethods(wire)[0]).toBe('initialize');
  });

  it('never leaks the gateway token onto the observed wire in events', async () => {
    const { handle } = start('success');
    const result = await handle.done;
    expect(JSON.stringify(result.events)).not.toContain(TOKEN);
  });
});

describe('concurrent workers', () => {
  it('run independent handshakes with separate sessions and no shared state', async () => {
    const first = start('success');
    const second = start('success');

    const [firstResult, secondResult] = await Promise.all([first.handle.done, second.handle.done]);

    // Each worker performed its own complete handshake.
    for (const wire of [first.wire, second.wire]) {
      expect(outboundMethods(wire).slice(0, 3)).toEqual(['initialize', 'session/new', 'session/prompt']);
      expect(outboundMethods(wire).filter(m => m === 'initialize')).toHaveLength(1);
    }

    // Neither observed the other's traffic.
    expect(first.wire).not.toBe(second.wire);
    expect(first.workspace).not.toBe(second.workspace);
    expect(firstResult.events).not.toBe(secondResult.events);

    // Both completed on their own terms.
    for (const result of [firstResult, secondResult]) {
      const terminals = result.events.filter(e => {
        const type = (e as { type: string }).type;
        return type === 'completed' || type === 'failed';
      });
      expect(terminals).toHaveLength(1);
    }
  });

  it('one worker failing does not disturb the other', async () => {
    const healthy = start('success');
    const broken = start('protocol-garbage');

    const [healthyResult, brokenResult] = await Promise.all([healthy.handle.done, broken.handle.done]);

    expect(failureOf(healthyResult.events)).toBeUndefined();
    expect(failureOf(brokenResult.events)).toBeDefined();
    // The healthy worker still completed its own handshake in full.
    expect(outboundMethods(healthy.wire).slice(0, 3)).toEqual([
      'initialize',
      'session/new',
      'session/prompt',
    ]);
  });

  it('cancelling one worker leaves the other running to completion', async () => {
    const cancelled = start('hangs');
    const healthy = start('success');

    await cancelled.handle.cancel();
    const [cancelledResult, healthyResult] = await Promise.all([
      cancelled.handle.done,
      healthy.handle.done,
    ]);

    expect(failureOf(cancelledResult.events)?.code).toBe('WORKER_CANCELLED');
    expect(failureOf(healthyResult.events)).toBeUndefined();
  });
});
