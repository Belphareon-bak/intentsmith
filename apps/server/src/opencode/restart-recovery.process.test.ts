import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { createFakeAgent } from '@intentsmith/adapter-opencode/fixtures';
import type { AuditEvent } from '@intentsmith/contracts';
import { createTaskInput } from '@intentsmith/testing';

import { buildServer } from '../app.js';
import { createRuntime } from '../runtime.js';
import type { ApprovalDesk } from './approval-desk.js';
import { openCodeEnvironment, repository, type Fixture } from './fixtures.js';
import {
  RESTART_PROCESS_LIMITS,
  type RestartChildConfig,
  type RestartHandshake,
} from './restart-recovery.fixtures.js';

/**
 * Restart recovery on the executable OpenCode composition.
 *
 * This is the one Phase 3 requirement the rest of the suite could not reach.
 * `pending-permission.test.ts` proves a worker killed *during* a run settles
 * cleanly, and `startup.test.ts` proves an interrupted run is closed after a
 * restart — but only for the in-process fake worker, whose "crash" is a
 * runtime object that is simply never awaited. Neither shows what happens when
 * the thing that dies is a real Core with a real OpenCode child process, a
 * pending approval, a suspended waiter and a live gateway token behind it, and
 * neither shows that the system can do useful work afterwards.
 *
 * The interruption here is therefore a real one. A child process runs the
 * product's own composition root (`restart-recovery.fixtures.ts`), reaches a
 * pending approval, and is killed with SIGKILL — a signal it cannot catch,
 * handle or clean up after. What it leaves behind is genuine wreckage:
 *
 *  - a `running` TaskRun row with no live worker;
 *  - a `pending` approval nobody answered;
 *  - an orphaned OpenCode process, reparented to init;
 *  - a gateway token that existed only in the dead process's memory.
 *
 * A second Core is then started on the same database — in this process, so the
 * assertions can see its internals — and has to reconcile all of it and then
 * run a fresh task to a correct terminal verdict.
 *
 * ## The boundary this test states rather than papers over
 *
 * ADR 0007 closes an interrupted run as `failed` and moves its task to `failed`
 * with it; ADR 0008 makes terminal statuses accept no lifecycle command. So the
 * *recovered task itself* cannot be started again, by design and by decision:
 * retry orchestration is deferred, and "a new attempt is an explicit user
 * action". That is asserted below as a contract, not worked around — and what
 * "remains recoverable" is proven to mean is that nothing the dead process left
 * behind stops the next run from happening or from being trustworthy.
 *
 * Nothing here needs OpenCode, Ollama, a GPU or the network.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const CHILD = fileURLToPath(new URL('./restart-recovery.fixtures.ts', import.meta.url));

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** True while the process exists. Signal 0 checks for existence and nothing else. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Kills a whole process group, tolerating one that has already gone. */
function killGroup(pid: number): void {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

async function until<T>(what: string, deadlineMs: number, attempt: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const value = await attempt();
    if (value !== undefined) return value;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

type DeadCore = {
  handshake: RestartHandshake;
  fixture: Fixture;
  agentScript: string;
  dbPath: string;
  /** How the child actually ended. Proven to be the kill, not a graceful exit. */
  exit: { code: number | null; signal: NodeJS.Signals | null };
  stderr: string;
};

/**
 * Starts a real Core, drives it to a pending approval, and kills it.
 *
 * The kill is SIGKILL rather than SIGTERM on purpose: SIGTERM would let the
 * runtime's shutdown hook cancel the run, revoke the grant and settle the desk,
 * which is the graceful path Phase 3 already proves. Recovery exists for the
 * case where none of that ran.
 */
async function interruptedCore(): Promise<DeadCore> {
  const fixture = repository(cleanups);
  const agent = createFakeAgent({
    behaviour: 'waits-for-permission',
    editPath: 'src/answer.js',
    editContent: 'module.exports = 4;\n',
    recordActivity: false,
  });
  cleanups.push(() => agent.cleanup());

  const stateDir = mkdtempSync(path.join(tmpdir(), 'intentsmith-restart-'));
  cleanups.push(() => rmSync(stateDir, { recursive: true, force: true }));
  const dbPath = path.join(stateDir, 'state.db');
  const handshakePath = path.join(stateDir, 'handshake.json');
  const configPath = path.join(stateDir, 'child.json');

  const config: RestartChildConfig = {
    dbPath,
    fixture,
    agentScript: agent.scriptPath,
    handshakePath,
    goal: 'Change src/answer.js so the fixture gate passes.',
    // Far longer than this test takes, so the kill is what ends the run.
    timeoutMs: 300_000,
  };
  writeFileSync(configPath, JSON.stringify(config));

  // Every ambient INTENTSMITH_* variable is stripped, so a developer's shell
  // cannot configure the composition this test is about.
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('INTENTSMITH_')),
  );
  const child: ChildProcessByStdio<null, Readable, Readable> = spawn(
    process.execPath,
    ['--import', 'tsx', CHILD, configPath],
    {
      cwd: REPO_ROOT,
      // The adapter gives each run an isolated HOME and XDG root under the
      // system temporary directory, and a Core killed with SIGKILL never
      // removes it — the same reason its worker survives. Pointing the child's
      // whole temporary directory at one this test owns keeps that unavoidable
      // leak inside something that is unavoidably cleaned up, without a sweep
      // that could delete a concurrent test's live workspace.
      env: { ...inherited, TMPDIR: stateDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  cleanups.push(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  });

  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => (stderr += chunk));
  let childExit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  void exited.then(value => (childExit = value));

  const handshake = await until('the child to reach a pending approval', 60_000, async () => {
    if (childExit) throw new Error(`The child exited before it was killed: ${stderr}`);
    return existsSync(handshakePath)
      ? (JSON.parse(readFileSync(handshakePath, 'utf8')) as RestartHandshake)
      : undefined;
  });

  // The worker outlives its parent, so it must be cleaned up by this test
  // whatever happens after this point.
  cleanups.push(() => killGroup(handshake.workerPid));

  child.kill('SIGKILL');
  const exit = await exited;

  return { handshake, fixture, agentScript: agent.scriptPath, dbPath, exit, stderr };
}

type RestartedCore = {
  runtime: ReturnType<typeof createRuntime>;
  server: ReturnType<typeof buildServer>;
  desk: ApprovalDesk;
  recovered: { recoveredRunCount: number; affectedTaskIds: string[]; status: string };
};

/** Starts a second Core on the dead one's database, exactly as the entry point does. */
async function restart(dead: DeadCore): Promise<RestartedCore> {
  const runtime = createRuntime({
    env: openCodeEnvironment({ agentScript: dead.agentScript, fixture: dead.fixture }),
    dbPath: dead.dbPath,
    opencode: { preferSandbox: false, limits: RESTART_PROCESS_LIMITS },
  });
  cleanups.push(() => runtime.close());
  const server = buildServer(runtime);
  cleanups.push(async () => await server.close());

  const recovered = await runtime.prepare!();
  runtime.bindWorkerGateway?.('http://127.0.0.1:1');

  return { runtime, server, desk: runtime.approvals as ApprovalDesk, recovered };
}

/** Runs one fresh task to completion, deciding its approval the way an operator does. */
async function runApprovedTask(
  restarted: RestartedCore,
  dead: DeadCore,
  goal: string,
): Promise<{ taskId: string; runId: string; status: string; audit: AuditEvent[] }> {
  const base = createTaskInput(dead.handshake.projectId, dead.fixture.root);
  const task = await restarted.runtime.core.createTask(
    createTaskInput(dead.handshake.projectId, dead.fixture.root, {
      goal,
      timeoutMs: 300_000,
      scope: { ...base.scope, timeoutMs: 300_000 },
    }),
  );
  await restarted.runtime.core.startTask(task.id);

  const runId = await until(
    'the new run to exist',
    30_000,
    async () => (await restarted.runtime.core.getTask(task.id)).latestRunId,
  );
  const approvalId = await until(
    'the new run to ask for permission',
    60_000,
    async () => (await restarted.desk.listPending(runId))[0]?.id,
  );

  const decision = await restarted.server.inject({
    method: 'POST',
    url: `/runs/${runId}/approvals/${approvalId}/approve`,
  });
  expect(decision.statusCode).toBe(200);

  const settled = await restarted.runtime.core.waitForTask(task.id);
  return {
    taskId: task.id,
    runId,
    status: settled.status,
    audit: await restarted.runtime.core.listAuditEvents(task.id),
  };
}

describe('a Core killed mid-run leaves recoverable state behind', () => {
  it(
    'reconciles the interrupted run, its approval, its token and its worker',
    async () => {
      const dead = await interruptedCore();
      const { handshake } = dead;

      // The interruption was a kill, not an exit: nothing in the child had a
      // chance to run, which is the precondition for everything below.
      expect(dead.exit.signal).toBe('SIGKILL');
      expect(dead.exit.code).toBeNull();
      // SIGKILL cannot be cleaned up after, so the worker really is orphaned.
      // This is a fact about the operating system, recorded rather than hidden.
      expect(isAlive(handshake.workerPid)).toBe(true);

      const restarted = await restart(dead);

      // Persisted state is reconciled: exactly the interrupted run, closed.
      expect(restarted.recovered).toMatchObject({
        status: 'completed',
        recoveredRunCount: 1,
        affectedTaskIds: [handshake.taskId],
      });

      const runs = await restarted.runtime.core.listTaskRuns(handshake.taskId);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ id: handshake.runId, status: 'failed' });
      expect(runs[0]?.endedAt).toEqual(expect.any(String));
      expect((await restarted.runtime.core.getTask(handshake.taskId)).status).toBe('failed');

      // The verdict says interrupted, not failed on merit — ADR 0007's whole
      // point is that the distinction survives in the result, not the status.
      const result = await restarted.runtime.core.getTaskResult(handshake.taskId);
      expect(result?.coreVerdict).toBe('blocked');
      expect(result?.unresolvedRisks.join(' ')).toMatch(/interrupted by an unexpected process restart/);
      expect(result?.diffs).toEqual([]);

      const audit = await restarted.runtime.core.listAuditEvents(handshake.taskId);
      // A restart is not consent: the unanswered question was closed, never granted.
      const types = audit.map(event => event.type);
      expect(types).toContain('approval.requested');
      expect(types).toContain('approval.revoked');
      expect(types).not.toContain('approval.granted');
      expect(types).not.toContain('approval.consumed');
      expect(audit.find(event => event.type === 'task.verdict')).toMatchObject({
        data: { verdict: 'blocked', reason: 'process_restart' },
      });
      // The verdict is written inside the recovery transaction and the approval
      // is closed after it, so the run is already terminal by the time anything
      // it held is released. Order matters: releasing first would leave a window
      // in which a decision could still arrive for a run with no verdict.
      expect(types.indexOf('task.verdict')).toBeLessThan(types.indexOf('approval.revoked'));
      expect(types.filter(type => type === 'task.verdict')).toHaveLength(1);

      // Nothing survived that could authorize or block anything: no waiter, no
      // decidable question, no token. The token could not have survived a
      // process boundary, and this asserts the restarted Core does not mint or
      // inherit one for a run that is over.
      expect(restarted.desk.pendingWaiterCount).toBe(0);
      expect(await restarted.desk.listPending(handshake.runId)).toEqual([]);
      expect(restarted.runtime.gatewayTokens.size).toBe(0);

      // A decision arriving for the dead run finds nothing to decide.
      const late = await restarted.server.inject({
        method: 'POST',
        url: `/runs/${handshake.runId}/approvals/${handshake.approvalId}/approve`,
      });
      expect(late.statusCode).toBe(404);

      // The worker was never touched by recovery — and must not be, because a
      // pid recorded before a restart may belong to something else by now. What
      // the record gives an operator is the identity, not an action.
      expect(audit.find(event => event.type === 'worker.process_start')).toMatchObject({
        data: { pid: handshake.workerPid },
      });
      expect(readFileSync(dead.fixture.target, 'utf8')).toBe('module.exports = 3;\n');
    },
    120_000,
  );

  it(
    'starts a new run after the restart and takes it to a correct terminal verdict',
    async () => {
      const dead = await interruptedCore();
      const restarted = await restart(dead);
      expect(restarted.recovered.recoveredRunCount).toBe(1);

      // The recovered task is terminal, so it accepts no lifecycle command.
      // ADR 0007 defers retry orchestration and ADR 0008 makes terminal statuses
      // refuse commands; a new attempt is an explicit new task, and this asserts
      // that refusal is the contract rather than an accident of the crash.
      await expect(restarted.runtime.core.startTask(dead.handshake.taskId)).rejects.toMatchObject({
        code: 'INVALID_TASK_TRANSITION',
      });

      // The real claim: the wreckage stops nothing. A fresh run in the same
      // workspace, through the same composition, on the same database, asks its
      // own question and reaches its own verdict.
      const fresh = await runApprovedTask(restarted, dead, 'Change src/answer.js so the fixture gate passes.');
      expect(fresh.status).toBe('passed');
      expect(fresh.runId).not.toBe(dead.handshake.runId);

      const result = await restarted.runtime.core.getTaskResult(fresh.taskId);
      expect(result?.coreVerdict).toBe('pass');
      // Git, not the worker, is still the authority for what changed.
      expect(result?.diffs[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(result?.approvals).toHaveLength(1);
      expect(readFileSync(dead.fixture.target, 'utf8')).toBe('module.exports = 4;\n');

      // The new run asked for its own permission; it did not inherit the dead
      // run's pending one, and the dead run's approval id is nowhere in it.
      const types = fresh.audit.map(event => event.type);
      expect(types.filter(type => type === 'approval.requested')).toHaveLength(1);
      expect(types).toContain('approval.granted');
      expect(types).toContain('approval.consumed');
      expect(JSON.stringify(fresh.audit)).not.toContain(dead.handshake.approvalId);

      // And it left nothing behind either.
      expect(restarted.runtime.gatewayTokens.size).toBe(0);
      expect(restarted.desk.pendingWaiterCount).toBe(0);
    },
    120_000,
  );

  it(
    'keeps the interrupted run terminal and unchanged while later work happens',
    async () => {
      const dead = await interruptedCore();
      const restarted = await restart(dead);

      const before = await restarted.runtime.core.listTaskRuns(dead.handshake.taskId);
      const beforeAudit = await restarted.runtime.core.listAuditEvents(dead.handshake.taskId);
      await runApprovedTask(restarted, dead, 'Change src/answer.js again, in a later run.');

      // Terminality is one-way: a later run must not reopen, rewrite or
      // re-verdict the interrupted one, and the append-only trail must not have
      // acquired a second ending.
      const after = await restarted.runtime.core.listTaskRuns(dead.handshake.taskId);
      expect(after).toEqual(before);
      const afterAudit = await restarted.runtime.core.listAuditEvents(dead.handshake.taskId);
      expect(afterAudit).toEqual(beforeAudit);
      expect(afterAudit.filter(event => event.type === 'task.verdict')).toHaveLength(1);
      expect((await restarted.runtime.core.getTaskResult(dead.handshake.taskId))?.coreVerdict).toBe('blocked');

      // Recovery is idempotent: a third start finds nothing left to close.
      const third = await restart(dead);
      expect(third.recovered.recoveredRunCount).toBe(0);
    },
    120_000,
  );
});
