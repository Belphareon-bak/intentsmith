import { describe, expect, it } from 'vitest';

import type { Task, TaskRun } from '@intentsmith/contracts';
import type {
  GrantAudit,
  WorkerAdapter,
  WorkerExecutionContext,
  WorkerExecutionResult,
  WorkerHandle,
} from '@intentsmith/worker-sdk';

import { GatewayTokenStore } from '../gateway/token-store.js';
import { GatewayGrantIssuer, WorkerAuthorityError, createRunScopedWorker } from './run-grant-worker.js';

/**
 * The run-scoped grant lifecycle, on the paths that are easy to forget.
 *
 * A spawn that never happened, a cancel that arrived before the process
 * existed, a worker that reported its own failure: each of these is a way a
 * token could be left behind, and none of them is covered by "revoke when the
 * run finishes normally".
 */

const DESCRIPTOR = { id: 'stub', version: '0', capabilities: { pause: false, cancel: true } } as const;

function context(runId = 'run_1', taskId = 'task_1'): WorkerExecutionContext {
  return {
    task: { id: taskId, goal: 'do the thing' } as Task,
    run: { id: runId, taskId } as TaskRun,
    signal: new AbortController().signal,
  };
}

function stubAdapter(handle: Partial<WorkerHandle> & { start?: () => never }): WorkerAdapter {
  return {
    describe: () => ({ ...DESCRIPTOR }),
    start: () => {
      if (handle.start) handle.start();
      return {
        done: handle.done ?? Promise.resolve({ events: [] }),
        pause: handle.pause ?? (async () => undefined),
        resume: handle.resume ?? (async () => undefined),
        cancel: handle.cancel ?? (async () => undefined),
      };
    },
  };
}

function harness(adapter: WorkerAdapter, options: { bind?: boolean } = {}): {
  worker: WorkerAdapter;
  tokens: GatewayTokenStore;
  audits: GrantAudit[];
  issued: string[];
} {
  const tokens = new GatewayTokenStore();
  const issuer = new GatewayGrantIssuer(tokens, 'qwen3:14b');
  if (options.bind !== false) issuer.bind('http://127.0.0.1:1');
  const audits: GrantAudit[] = [];
  const issued: string[] = [];

  const worker = createRunScopedWorker({
    describe: () => adapter.describe(),
    adapterFor: () => ({
      describe: () => adapter.describe(),
      start: executionContext => {
        issued.push(executionContext.inference?.token ?? '');
        return adapter.start(executionContext);
      },
    }),
    issuer,
    workspaceRoot: '/tmp/workspace',
    onGrantAudit: audit => audits.push(audit),
  });

  return { worker, tokens, audits, issued };
}

describe('GatewayGrantIssuer', () => {
  it('refuses to issue before the gateway is listening', () => {
    const issuer = new GatewayGrantIssuer(new GatewayTokenStore(), 'qwen3:14b');
    expect(issuer.bound).toBe(false);
    expect(() => issuer.issue('run_1', 'task_1')).toThrow(WorkerAuthorityError);
    expect(() => issuer.issue('run_1', 'task_1')).toThrow(/not listening/);
  });

  it('issues a run-scoped grant once bound, and revokes it by run', () => {
    const tokens = new GatewayTokenStore();
    const issuer = new GatewayGrantIssuer(tokens, 'qwen3:14b');
    issuer.bind('http://127.0.0.1:4321');

    const grant = issuer.issue('run_1', 'task_1');
    expect(grant).toMatchObject({ baseUrl: 'http://127.0.0.1:4321', modelId: 'qwen3:14b' });
    expect(tokens.verify(grant.token)).toMatchObject({ runId: 'run_1', taskId: 'task_1' });

    expect(issuer.revoke('run_1')).toBe(true);
    expect(tokens.verify(grant.token)).toBeUndefined();
    expect(tokens.size).toBe(0);
  });
});

describe('createRunScopedWorker', () => {
  it('describes the worker without starting one', () => {
    const { worker } = harness(stubAdapter({}));
    expect(worker.describe()).toMatchObject({ id: 'stub' });
  });

  it('hands the worker a grant and revokes it when the run settles', async () => {
    const { worker, tokens, audits, issued } = harness(stubAdapter({}));
    await worker.start(context()).done;

    expect(issued[0]).toBeTruthy();
    expect(tokens.verify(issued[0] as string)).toBeUndefined();
    expect(audits).toEqual([expect.objectContaining({ runId: 'run_1', outcome: 'success', revoked: true })]);
  });

  it('revokes when the adapter refuses to spawn, and reports a terminal failure', async () => {
    const { worker, tokens, audits } = harness(
      stubAdapter({
        start: () => {
          throw Object.assign(new Error('spawn refused'), { reason: 'spawn_failed' });
        },
      }),
    );

    // The failure becomes a worker event rather than a rejection, so Core sees
    // a run that failed instead of an unhandled crash.
    const result = await worker.start(context()).done;
    expect(result.events).toEqual([
      { type: 'failed', error: { code: 'WORKER_FAILED', message: 'spawn refused', retryable: false } },
    ]);
    expect(audits).toEqual([expect.objectContaining({ outcome: 'spawn_failed', revoked: true })]);
    expect(tokens.size).toBe(0);
  });

  it('refuses to run at all when no gateway backs the grant', async () => {
    const { worker, tokens, audits } = harness(stubAdapter({}), { bind: false });
    const result = await worker.start(context()).done;

    expect(result.events).toEqual([
      expect.objectContaining({ type: 'failed', error: expect.objectContaining({ code: 'WORKER_AUTHORITY_UNAVAILABLE' }) }),
    ]);
    // Nothing was ever issued, so there is nothing to revoke and no audit.
    expect(audits).toEqual([]);
    expect(tokens.size).toBe(0);
  });

  it('delivers a cancel issued immediately after start', async () => {
    let cancelled = 0;
    let settle!: (result: WorkerExecutionResult) => void;
    const done = new Promise<WorkerExecutionResult>(resolve => {
      settle = resolve;
    });
    const { worker, tokens } = harness(
      stubAdapter({
        done,
        cancel: async () => {
          cancelled += 1;
          settle({ events: [] });
        },
      }),
    );

    const handle = worker.start(context());
    await handle.cancel();
    await handle.done;

    expect(cancelled).toBe(1);
    expect(tokens.size).toBe(0);
  });

  it('refuses pause and resume for a run that never produced a worker', async () => {
    const { worker } = harness(stubAdapter({}), { bind: false });
    const handle = worker.start(context());
    await expect(handle.pause()).rejects.toThrow(/never started, so it cannot be paused/);
    await expect(handle.resume()).rejects.toThrow(/never started, so it cannot be resumed/);
    // Cancelling one is not an error; there is simply nothing to stop.
    await expect(handle.cancel()).resolves.toBeUndefined();
    await handle.done;
  });

  it('forwards pause and resume once the worker exists', async () => {
    const calls: string[] = [];
    let settle!: (result: WorkerExecutionResult) => void;
    const done = new Promise<WorkerExecutionResult>(resolve => {
      settle = resolve;
    });
    const { worker } = harness(
      stubAdapter({
        done,
        pause: async () => {
          calls.push('pause');
        },
        resume: async () => {
          calls.push('resume');
          settle({ events: [] });
        },
      }),
    );

    const handle = worker.start(context());
    await Promise.resolve();
    await handle.pause();
    await handle.resume();
    await handle.done;
    expect(calls).toEqual(['pause', 'resume']);
  });

  it.each([
    ['WORKER_CANCELLED', 'cancelled'],
    ['WORKER_TIMEOUT', 'timeout'],
    ['WORKER_EXECUTABLE_MISSING', 'spawn_failed'],
    ['WORKER_PROTOCOL_ERROR', 'failure'],
  ])('records a %s terminal event as a %s outcome', async (code, outcome) => {
    const { worker, audits } = harness(
      stubAdapter({ done: Promise.resolve({ events: [{ type: 'failed', error: { code } }] }) }),
    );
    await worker.start(context()).done;

    // A resolved promise is not evidence of success; the audit must not claim
    // one for a run the worker reported as failed.
    expect(audits[0]).toMatchObject({ outcome, revoked: true });
  });

  it('never puts the token into a grant audit or a failure message', async () => {
    // A worker that dies while quoting its own secret is the worst case: the
    // failure path must not be the one place a token reaches a persisted result.
    let captured = '';
    const tokens = new GatewayTokenStore();
    const issuer = new GatewayGrantIssuer(tokens, 'qwen3:14b');
    issuer.bind('http://127.0.0.1:1');
    const audits: GrantAudit[] = [];

    const leaking = createRunScopedWorker({
      describe: () => ({ ...DESCRIPTOR }),
      adapterFor: () => ({
        describe: () => ({ ...DESCRIPTOR }),
        start: executionContext => {
          captured = executionContext.inference?.token ?? '';
          throw new Error(`worker died holding ${captured}`);
        },
      }),
      issuer,
      workspaceRoot: '/tmp/workspace',
      onGrantAudit: audit => audits.push(audit),
    });

    const result = await leaking.start(context('run_leak', 'task_leak')).done;

    expect(captured.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain(captured);
    expect(JSON.stringify(audits)).not.toContain(captured);
    expect(tokens.size).toBe(0);
  });
});
