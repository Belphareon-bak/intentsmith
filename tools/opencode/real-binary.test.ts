import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { chatRecord, fixtureTransport, fixtures } from '@intentsmith/adapter-ollama/fixtures';
import { OpenCodeWorker, type PermissionDecision } from '@intentsmith/adapter-opencode';
import {
  ApprovalLedger,
  CapabilityMediator,
  IntentSmithCore,
  type ApprovalDecider,
  type WorkerAdapter,
  type WorkerExecutionContext,
  type WorkerHandle,
} from '@intentsmith/core';
import { openIntentSmithDatabase } from '@intentsmith/persistence';
import {
  DeterministicIdGenerator,
  FakeClock,
  FakeTimer,
  createTaskInput,
} from '@intentsmith/testing';
import type { CapabilityRequest, GrantAudit, InferenceGrant } from '@intentsmith/worker-sdk';

import { createTestServerRuntime } from '../../apps/server/src/test-runtime.js';
import { startGateway, type GatewayHandle } from '../../apps/server/src/gateway/lifecycle.js';
import { GatewayTokenStore } from '../../apps/server/src/gateway/token-store.js';

/**
 * Real opencode-ai@1.18.8 lifecycle proof.
 *
 * This suite uses the pinned real binary and a real loopback gateway. The
 * provider behind that gateway is a deterministic transport double whose only
 * answer is a structured request to write one file. That keeps the lifecycle
 * proof independent of model sampling while still driving OpenCode's real ACP,
 * tool and permission paths.
 *
 * Strict-offline execution is deliberately NOT claimed: OpenCode's provider
 * catalogue access remains unresolved and is outside this suite's assertion.
 */

const OPT_IN = process.env.INTENTSMITH_RUN_REAL_OPENCODE === '1';
const BIN = process.env.INTENTSMITH_OPENCODE_BIN;
const PINNED_VERSION = '1.18.8';
const maybe = OPT_IN ? describe : describe.skip;

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function bounded<T>(promise: Promise<T>, label: string, ms = 45_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Hard timeout waiting for ${label}.`)), ms);
    timer.unref?.();
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function command(executable: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return await bounded(
    new Promise(resolve => {
      execFile(executable, args, { timeout: 10_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        resolve({
          code: typeof (error as { code?: unknown } | null)?.code === 'number'
            ? (error as { code: number }).code
            : error
              ? null
              : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      });
    }),
    `${path.basename(executable)} ${args.join(' ')}`,
    12_000,
  );
}

function processGroupExists(leader: number | undefined): boolean {
  if (leader === undefined) return false;
  try {
    process.kill(-leader, 0);
    return true;
  } catch {
    return false;
  }
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(settle => {
    resolve = settle;
  });
  return { promise, resolve };
}

type LifecycleKind = 'cancel' | 'timeout' | 'termination';

type Harness = {
  core: IntentSmithCore;
  timer: FakeTimer;
  taskId: string;
  runId(): Promise<string>;
  workspace: string;
  target: string;
  permissionReached: Promise<void>;
  lateDecision: Deferred<'approve' | 'deny'>;
  mediationSettled(): Promise<PermissionDecision> | undefined;
  processPid(): number | undefined;
  token(): string;
  grantAudits: GrantAudit[];
  gateway: GatewayHandle;
  tokens: GatewayTokenStore;
  store: ReturnType<typeof openIntentSmithDatabase>;
};

async function lifecycleHarness(kind: LifecycleKind): Promise<Harness> {
  if (!BIN) throw new Error('BLOCKED: set INTENTSMITH_OPENCODE_BIN to the installed opencode-ai@1.18.8 binary.');

  const workspace = mkdtempSync(path.join(tmpdir(), `intentsmith-real-opencode-${kind}-`));
  cleanups.push(() => rmSync(workspace, { recursive: true, force: true }));
  mkdirSync(path.join(workspace, 'src'), { recursive: true });
  const target = path.join(workspace, 'src', 'permission-pending.txt');

  const store = openIntentSmithDatabase(':memory:');
  cleanups.push(() => store.close());
  const clock = new FakeClock();
  const timer = new FakeTimer();
  const ids = new DeterministicIdGenerator();
  const approvals = new ApprovalLedger({ approvals: store, audit: store, clock, ids });
  const tokens = new GatewayTokenStore();
  const lateDecision = deferred<'approve' | 'deny'>();
  const permissionLatch = deferred<void>();
  const grantAudits: GrantAudit[] = [];

  let processPid: number | undefined;
  let tokenValue = '';
  let mediation: Promise<PermissionDecision> | undefined;
  let activeContext: WorkerExecutionContext | undefined;

  const adapter = new OpenCodeWorker({
    executable: BIN,
    expectedVersion: `opencode-ai/${PINNED_VERSION}`,
    preferSandbox: false,
    limits: {
      startupMs: 15_000,
      idleMs: 30_000,
      overallMs: 45_000,
      terminationGraceMs: 1_000,
    },
    onProcessStart: pid => {
      processPid = pid;
    },
    onPermissionRequest: async (request: CapabilityRequest) => {
      const context = activeContext;
      if (!context) return { allowed: false, reason: 'Run context is unavailable.' };
      const mediator = new CapabilityMediator({
        ledger: approvals,
        audit: store,
        clock,
        ids,
        taskId: context.task.id,
        runId: context.run.id,
        workspaceRoot: workspace,
        decide: (async () => {
          permissionLatch.resolve();
          return await lateDecision.promise;
        }) as ApprovalDecider,
      });
      mediation = mediator.mediate(request).then(outcome => ({
        allowed: outcome.allowed,
        reason: outcome.reason,
      }));
      return await mediation;
    },
  });

  const worker: WorkerAdapter = {
    describe: () => adapter.describe(),
    start: (context: WorkerExecutionContext): WorkerHandle => {
      activeContext = context;
      const issuedAt = clock.now();
      tokenValue = gateway.issueToken(context.run.id, context.task.id);
      const grant: InferenceGrant = {
        baseUrl: gateway.url,
        token: tokenValue,
        modelId: 'qwen3:14b',
      };
      const handle = adapter.start({ ...context, workspaceRoot: workspace, inference: grant });
      const done = handle.done.finally(() => {
        const revoked = gateway.revokeRun(context.run.id);
        grantAudits.push({
          runId: context.run.id,
          taskId: context.task.id,
          outcome: kind === 'cancel' ? 'cancelled' : kind === 'timeout' ? 'timeout' : 'failure',
          revoked,
          issuedAt,
          revokedAt: clock.now(),
        });
      });
      return { ...handle, done };
    },
  };

  const core = new IntentSmithCore({
    clock,
    ids,
    timer,
    projects: store,
    tasks: store,
    audit: store,
    transactions: store,
    worker,
    approvals,
  });
  cleanups.push(() => core.shutdown());

  const runtime = createTestServerRuntime({
    core,
    gatewayTokens: tokens,
    transport: fixtureTransport({
      chat: fixtures.jsonResponse(
        200,
        chatRecord({
          toolCalls: [
            {
              name: 'write',
              arguments: { filePath: target, content: 'must never be written before approval\n' },
            },
          ],
        }),
      ),
    }),
  });
  const gateway = await startGateway({ runtime, tokens });
  cleanups.push(() => gateway.close());

  const project = await core.createProject({ name: `real-opencode-${kind}`, rootPath: workspace });
  const task = await core.createTask(
    createTaskInput(project.id, workspace, {
      goal: `Write exactly one file at ${target}. Use the write tool and do not use shell.`,
      timeoutMs: 2_000,
      scope: {
        ...createTaskInput(project.id, workspace).scope,
        timeoutMs: 2_000,
      },
    }),
  );

  return {
    core,
    timer,
    taskId: task.id,
    runId: async () => {
      const run = (await core.listTaskRuns(task.id))[0];
      if (!run) throw new Error('TaskRun was not created.');
      return run.id;
    },
    workspace,
    target,
    permissionReached: permissionLatch.promise,
    lateDecision,
    mediationSettled: () => mediation,
    processPid: () => processPid,
    token: () => tokenValue,
    grantAudits,
    gateway,
    tokens,
    store,
  };
}

beforeAll(async () => {
  if (!OPT_IN) return;
  if (!BIN) throw new Error('BLOCKED: INTENTSMITH_OPENCODE_BIN is required when the real suite is enabled.');
  const version = await command(BIN, ['--version']);
  const reported = `${version.stdout}\n${version.stderr}`.trim();
  if (version.code !== 0 || !new RegExp(`\\b${PINNED_VERSION.replaceAll('.', '\\.')}\\b`).test(reported)) {
    throw new Error(
      `BLOCKED: expected opencode-ai@${PINNED_VERSION}, but "${BIN} --version" reported ${JSON.stringify(reported)}.`,
    );
  }
});

maybe('real OpenCode permission-pending lifecycle', () => {
  it.each([
    ['cancel', 'cancelled'],
    ['timeout', 'timeout'],
    ['termination', 'failed'],
  ] as const)('%s settles cleanup without permitting a late side effect', async (kind, expectedRunStatus) => {
    const harness = await lifecycleHarness(kind);
    await harness.core.startTask(harness.taskId);
    await bounded(harness.permissionReached, `${kind} permission-pending latch`);

    const runId = await harness.runId();
    const pid = harness.processPid();
    expect(pid).toBeDefined();
    expect(existsSync(harness.target)).toBe(false);
    expect((await harness.store.listApprovalsByRun(runId)).map(entry => entry.state)).toContain('pending');

    if (kind === 'cancel') {
      await bounded(harness.core.cancelTask(harness.taskId), 'Core cancellation');
    } else if (kind === 'timeout') {
      harness.timer.advance(2_000);
      await bounded(harness.core.waitForTask(harness.taskId), 'Core timeout');
    } else {
      if (pid === undefined) throw new Error('Process pid disappeared before termination.');
      process.kill(-pid, 'SIGKILL');
      await bounded(harness.core.waitForTask(harness.taskId), 'worker process failure');
    }

    const run = (await harness.core.listTaskRuns(harness.taskId))[0];
    expect(run?.status).toBe(expectedRunStatus);
    expect(processGroupExists(pid)).toBe(false);
    expect(existsSync(harness.target)).toBe(false);
    expect(harness.tokens.verify(harness.token())).toBeUndefined();
    expect(harness.grantAudits).toEqual([
      expect.objectContaining({ runId, revoked: true }),
    ]);

    const approvals = await harness.store.listApprovalsByRun(runId);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.state).toBe('revoked');

    // An answer and output arriving after terminal cleanup have no authority.
    harness.lateDecision.resolve('approve');
    const settled = harness.mediationSettled();
    if (settled) await bounded(settled, 'late approval settlement');
    expect(existsSync(harness.target)).toBe(false);

    const audit = await harness.core.listAuditEvents(harness.taskId);
    const types = audit.map(event => event.type);
    expect(types).toContain('approval.requested');
    expect(types).toContain('approval.revoked');
    expect(types).toContain('task.verdict');
    expect(types.indexOf('approval.requested')).toBeLessThan(types.indexOf('task.verdict'));
    expect(types.indexOf('task.verdict')).toBeLessThan(types.indexOf('approval.revoked'));
    expect(JSON.stringify(audit)).not.toContain(harness.token());
  });
});
