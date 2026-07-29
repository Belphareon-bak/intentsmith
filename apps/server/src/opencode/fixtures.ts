import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createFakeAgent, type FakeAgentBehaviour } from '@intentsmith/adapter-opencode/fixtures';
import type { AuditEvent, TaskResult } from '@intentsmith/contracts';
import { DeterministicIdGenerator, FakeClock, FakeTimer, createTaskInput } from '@intentsmith/testing';
import type { GrantAudit } from '@intentsmith/worker-sdk';

import type { ServerRuntime } from '../app.js';
import { buildServer } from '../app.js';
import { createRuntime } from '../runtime.js';
import type { RemoteAccessConfig } from '../remote-access.js';
import type { ApprovalDesk } from './approval-desk.js';
import { OPENCODE_ENV, WORKER_SELECTION_ENV } from './config.js';

/**
 * Shared executable-OpenCode harness.
 *
 * Everything a test built on this touches goes through `createRuntime` and
 * `buildServer` — the things an operator actually runs. The worker is a real
 * child process, Git and the gates are real processes, and only the ACP agent
 * is a deterministic fixture, so nothing here needs OpenCode installed or a
 * network.
 *
 * It lives outside a `.test.ts` file so the approval-surface tests and the
 * composition tests share one wiring rather than two that can drift apart.
 */

export type Fixture = { root: string; target: string; gatesPath: string };

/** `always` passes whatever the workspace contains, isolating Git as the judge. */
export type GateFixture = 'pass' | 'fail' | 'always';

function gateDefinition(kind: GateFixture, root: string): Record<string, unknown> {
  if (kind === 'fail') {
    return {
      id: 'fixture',
      description: 'forced failing gate',
      executable: process.execPath,
      args: ['-e', 'process.stderr.write("forced gate failure"); process.exit(1);'],
    };
  }
  if (kind === 'always') {
    return {
      id: 'fixture',
      description: 'gate that never disagrees with the worker',
      executable: process.execPath,
      args: ['-e', 'process.stdout.write("ok");'],
    };
  }
  return {
    id: 'fixture',
    description: 'fixture answer is correct',
    executable: process.execPath,
    args: [path.join(root, 'check.cjs')],
  };
}

export function repository(
  cleanups: Array<() => void | Promise<void>>,
  options: { gates?: GateFixture } = {},
): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), 'intentsmith-exec-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: root, env, stdio: 'ignore' });
  };
  git('init', '--initial-branch=main');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'IntentSmith Test');
  mkdirSync(path.join(root, 'src'));
  const target = path.join(root, 'src', 'answer.js');
  writeFileSync(target, 'module.exports = 3;\n');
  writeFileSync(
    path.join(root, 'check.cjs'),
    [
      `const answer = require('./src/answer.js');`,
      `if (answer !== 4) { console.error('expected 4, got ' + answer); process.exit(1); }`,
      `console.log('fixture gate passed');`,
    ].join('\n'),
  );
  git('add', '.');
  git('commit', '-m', 'fixture base');

  // The gate file lives outside the repository on purpose: configuration that
  // sits in the workspace would show up as a change the worker made.
  const configRoot = mkdtempSync(path.join(tmpdir(), 'intentsmith-exec-cfg-'));
  cleanups.push(() => rmSync(configRoot, { recursive: true, force: true }));
  const gatesPath = path.join(configRoot, 'gates.json');
  writeFileSync(gatesPath, JSON.stringify([gateDefinition(options.gates ?? 'pass', root)]));

  return { root, target, gatesPath };
}

export type Scenario = {
  behaviour?: FakeAgentBehaviour;
  editPath?: string;
  /**
   * `surface` installs no decider, which is what production composes: the run
   * then waits for a real decision through the server's approval routes.
   */
  approval?: 'approve' | 'deny' | 'pending' | 'surface';
  gates?: GateFixture;
  bindGateway?: boolean;
  /** Runs through a shell wrapper so the test can delete it before spawn. */
  executable?: 'node' | 'wrapper';
  timeoutMs?: number;
  /** Drives Core's timeout virtually instead of by wall clock. */
  timer?: FakeTimer;
  /** Shares one repository fixture between harnesses, e.g. for two runtimes. */
  fixture?: Fixture;
  /** Builds the server behind an operator credential, as a VPN bind does. */
  remoteAccess?: RemoteAccessConfig;
};

export type Harness = {
  runtime: ServerRuntime;
  /** The real HTTP surface, for tests that decide the way an operator does. */
  server: ReturnType<typeof buildServer>;
  desk: ApprovalDesk;
  fixture: Fixture;
  taskId: string;
  grantAudits: GrantAudit[];
  decisions: number;
  permissionReached: Promise<void>;
  removeExecutable(): void;
  run(): Promise<{ result: TaskResult | null; audit: AuditEvent[]; status: string }>;
  newTask(goal?: string): Promise<string>;
  /** The run id of a task's latest run, once one exists. */
  runIdFor(taskId: string): Promise<string>;
  /** Resolves once the mediator has recorded a pending approval for the run. */
  awaitPending(runId: string): Promise<string>;
};

export async function harness(
  cleanups: Array<() => void | Promise<void>>,
  options: Scenario = {},
): Promise<Harness> {
  const fixture = options.fixture ?? repository(cleanups, options.gates === undefined ? {} : { gates: options.gates });
  const agent = createFakeAgent({
    behaviour: options.behaviour ?? 'waits-for-permission',
    editPath: options.editPath ?? 'src/answer.js',
    editContent: 'module.exports = 4;\n',
    // The activity log would itself be an unapproved workspace change.
    recordActivity: false,
  });
  cleanups.push(() => agent.cleanup());

  const wrapper = path.join(path.dirname(agent.scriptPath), 'opencode-wrapper.sh');
  writeFileSync(wrapper, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(agent.scriptPath)} "$@"\n`);
  chmodSync(wrapper, 0o755);

  const timeoutMs = options.timeoutMs ?? 1_000;
  const grantAudits: GrantAudit[] = [];
  let decisions = 0;
  let permissionResolve!: () => void;
  const permissionReached = new Promise<void>(resolve => {
    permissionResolve = resolve;
  });
  const never = new Promise<'approve' | 'deny'>(() => undefined);

  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    [WORKER_SELECTION_ENV]: 'opencode',
    [OPENCODE_ENV.executable]: options.executable === 'wrapper' ? wrapper : process.execPath,
    [OPENCODE_ENV.args]: options.executable === 'wrapper' ? '[]' : JSON.stringify([agent.scriptPath]),
    [OPENCODE_ENV.version]: 'fake-opencode/0.0.0',
    [OPENCODE_ENV.workspaceRoot]: fixture.root,
    [OPENCODE_ENV.model]: 'qwen3:14b',
    [OPENCODE_ENV.gates]: fixture.gatesPath,
  };

  const runtime = createRuntime({
    env,
    dbPath: ':memory:',
    clock: new FakeClock(),
    ids: new DeterministicIdGenerator(),
    timer: options.timer ?? new FakeTimer(),
    opencode: {
      preferSandbox: false,
      limits: { startupMs: 3_000, idleMs: 5_000, overallMs: 10_000, terminationGraceMs: 200 },
      onGrantAudit: audit => grantAudits.push(audit),
      ...(options.approval === 'surface'
        ? {}
        : {
            approvalDecider: async () => {
              decisions += 1;
              permissionResolve();
              if (options.approval === 'pending') return await never;
              return options.approval === 'deny' ? 'deny' : 'approve';
            },
          }),
    },
  });
  cleanups.push(() => runtime.close());

  const server = options.remoteAccess ? buildServer(runtime, options.remoteAccess) : buildServer(runtime);
  cleanups.push(async () => {
    // `close` runs the runtime's own shutdown hook, so it must come first.
    await server.close();
  });

  // The composition root reports the gateway as mandatory by exposing this.
  if (options.bindGateway !== false) runtime.bindWorkerGateway?.('http://127.0.0.1:1');

  const project = await runtime.core.createProject({ name: 'opencode-exec', rootPath: fixture.root });
  const makeTask = async (goal = 'Change src/answer.js so the fixture gate passes.'): Promise<string> => {
    const task = await runtime.core.createTask(
      createTaskInput(project.id, fixture.root, {
        goal,
        timeoutMs,
        scope: { ...createTaskInput(project.id, fixture.root).scope, timeoutMs },
      }),
    );
    return task.id;
  };
  const taskId = await makeTask();

  const desk = runtime.approvals as ApprovalDesk;

  const self: Harness = {
    runtime,
    server,
    desk,
    fixture,
    taskId,
    grantAudits,
    get decisions() {
      return decisions;
    },
    permissionReached,
    removeExecutable: () => rmSync(wrapper, { force: true }),
    newTask: makeTask,
    runIdFor: async id => {
      const task = await runtime.core.getTask(id);
      const runId = task.latestRunId;
      if (!runId) throw new Error(`Task ${id} has no run yet.`);
      return runId;
    },
    awaitPending: async runId => {
      // Polling, not a callback: the point is to observe the same state an
      // operator's client would poll, rather than a test-only notification.
      for (let attempt = 0; attempt < 400; attempt += 1) {
        const pending = await desk.listPending(runId);
        const first = pending[0];
        if (first) return first.id;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error(`No approval became pending for run ${runId}.`);
    },
    run: async () => {
      await runtime.core.startTask(taskId);
      const task = await runtime.core.waitForTask(taskId);
      return {
        result: await runtime.core.getTaskResult(taskId),
        audit: await runtime.core.listAuditEvents(taskId),
        status: task.status,
      };
    },
  };
  return self;
}
