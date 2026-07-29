import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTaskInput } from '@intentsmith/testing';

import { createRuntime } from '../runtime.js';
import type { ApprovalDesk } from './approval-desk.js';
import { openCodeEnvironment, type Fixture } from './fixtures.js';

/**
 * The Core that dies, for the restart-recovery regression.
 *
 * `restart-recovery.process.test.ts` needs a real IntentSmith Core that is
 * genuinely killed rather than shut down, because the property under test only
 * exists in a process: a run left `running` on disk with no live worker behind
 * it, an OpenCode child process that outlives the thing that started it, and a
 * gateway token that existed only in the dead process's memory. A test that
 * simulated the crash in-process would never produce any of those.
 *
 * So this module is the first half of that regression, and it is deliberately
 * the *product's* composition: `createRuntime` with `INTENTSMITH_WORKER=opencode`
 * and no approval decider, which is exactly what an operator runs. Nothing is
 * stubbed except the ACP agent, which is the same deterministic fake child
 * process every other offline OpenCode test uses.
 *
 * It reaches a pending approval, publishes what the parent needs to observe,
 * and then blocks forever waiting for an answer that will never come — which is
 * the state the parent SIGKILLs it in.
 *
 * This file is a test fixture and is executed only as a child process, so it
 * carries no coverage: the assertions that matter about it are made in the
 * parent, against the database it left behind.
 */

export type RestartChildConfig = {
  /** File-backed database, so state survives the process that wrote it. */
  dbPath: string;
  fixture: Fixture;
  /** Generated fake ACP agent script. */
  agentScript: string;
  /** Where the child publishes what it reached, once it is reached. */
  handshakePath: string;
  goal: string;
  /** Long enough that the parent's kill, not a timeout, ends this run. */
  timeoutMs: number;
};

/** Everything the parent must know about the run it is about to interrupt. */
export type RestartHandshake = {
  corePid: number;
  projectId: string;
  taskId: string;
  runId: string;
  approvalId: string;
  /** Process-group leader of the OpenCode worker, read from the audit trail. */
  workerPid: number;
};

/**
 * Process limits for a run that is meant to sit still.
 *
 * The regression's worker waits at a permission request and produces no output
 * until it is answered, so the idle ceiling has to outlast the parent's
 * observation window. A short one would end the run as a timeout and prove
 * something else entirely.
 */
export const RESTART_PROCESS_LIMITS = {
  startupMs: 15_000,
  idleMs: 120_000,
  overallMs: 300_000,
  terminationGraceMs: 200,
};

/** Publishes the handshake atomically, so the parent never reads a partial one. */
function publish(handshakePath: string, handshake: RestartHandshake): void {
  const temporary = `${handshakePath}.partial`;
  writeFileSync(temporary, JSON.stringify(handshake));
  renameSync(temporary, handshakePath);
}

async function poll<T>(what: string, attempt: () => Promise<T | undefined>): Promise<T> {
  for (let tries = 0; tries < 600; tries += 1) {
    const value = await attempt();
    if (value !== undefined) return value;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

/**
 * Runs a real OpenCode task up to a pending approval and then stops there.
 *
 * Never resolves: the caller is expected to be killed. Returning would close
 * the runtime gracefully, which is the one thing this fixture must not do.
 */
export async function reachPendingApprovalAndBlock(config: RestartChildConfig): Promise<never> {
  const runtime = createRuntime({
    env: openCodeEnvironment({ agentScript: config.agentScript, fixture: config.fixture }),
    dbPath: config.dbPath,
    opencode: { preferSandbox: false, limits: RESTART_PROCESS_LIMITS },
  });

  // The same order the entry point uses: recover, then bind, then serve.
  await runtime.prepare?.();
  runtime.bindWorkerGateway?.('http://127.0.0.1:1');

  const project = await runtime.core.createProject({
    name: 'restart-recovery',
    rootPath: config.fixture.root,
  });
  const base = createTaskInput(project.id, config.fixture.root);
  const task = await runtime.core.createTask(
    createTaskInput(project.id, config.fixture.root, {
      goal: config.goal,
      timeoutMs: config.timeoutMs,
      scope: { ...base.scope, timeoutMs: config.timeoutMs },
    }),
  );
  await runtime.core.startTask(task.id);

  const runId = await poll('the run to exist', async () => (await runtime.core.getTask(task.id)).latestRunId);
  const desk = runtime.approvals as ApprovalDesk;
  const approvalId = await poll(
    'an approval to become pending',
    async () => (await desk.listPending(runId))[0]?.id,
  );
  const workerPid = await poll('the worker process to be recorded', async () => {
    const started = (await runtime.core.listAuditEvents(task.id)).find(
      event => event.type === 'worker.process_start',
    );
    const pid = (started?.data as { pid?: unknown } | undefined)?.pid;
    return typeof pid === 'number' ? pid : undefined;
  });

  publish(config.handshakePath, {
    corePid: process.pid,
    projectId: project.id,
    taskId: task.id,
    runId,
    approvalId,
    workerPid,
  });

  // Nobody will ever answer. Staying alive is the point: the parent needs a
  // process to kill while the database still says this run is `running`.
  return await new Promise<never>(() => {
    setInterval(() => undefined, 1_000);
  });
}

/** Child-process entry point. Only runs when this file is the process's own argv[1]. */
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const configPath = process.argv[2];
  if (configPath === undefined) throw new Error('A configuration path is required.');
  void reachPendingApprovalAndBlock(JSON.parse(readFileSync(configPath, 'utf8')) as RestartChildConfig);
}
