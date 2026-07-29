import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createFakeAgent, type FakeAgentBehaviour } from '@intentsmith/adapter-opencode/fixtures';
import type { AuditEvent, TaskResult } from '@intentsmith/contracts';
import { DeterministicIdGenerator, FakeClock, FakeTimer, createTaskInput } from '@intentsmith/testing';
import type { GrantAudit } from '@intentsmith/worker-sdk';

import type { ServerRuntime } from '../app.js';
import { createRuntime } from '../runtime.js';
import { OPENCODE_ENV, WORKER_SELECTION_ENV, WorkerConfigError } from './config.js';

/**
 * The executable OpenCode path, exercised through the real composition root.
 *
 * Every assertion here goes through `createRuntime`, because that is the thing
 * an operator actually runs. Constructing Core by hand in a test proves the
 * components can be wired correctly; it does not prove the product wires them,
 * and that gap is exactly what this file exists to close.
 *
 * The worker is a real child process, Git and the gates are real processes.
 * Only the ACP agent is a deterministic fixture, so nothing here needs OpenCode
 * installed or a network.
 */

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

type Fixture = { root: string; target: string; gatesPath: string };

/** `always` passes whatever the workspace contains, isolating Git as the judge. */
type GateFixture = 'pass' | 'fail' | 'always';

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

function repository(options: { gates?: GateFixture } = {}): Fixture {
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

type Scenario = {
  behaviour?: FakeAgentBehaviour;
  editPath?: string;
  /** `default` installs no decider, which is what production has today. */
  approval?: 'approve' | 'deny' | 'pending' | 'default';
  gates?: GateFixture;
  bindGateway?: boolean;
  /** Runs through a shell wrapper so the test can delete it before spawn. */
  executable?: 'node' | 'wrapper';
  timeoutMs?: number;
  /** Drives Core's timeout virtually instead of by wall clock. */
  timer?: FakeTimer;
};

type Harness = {
  runtime: ServerRuntime;
  fixture: Fixture;
  taskId: string;
  grantAudits: GrantAudit[];
  decisions: number;
  permissionReached: Promise<void>;
  removeExecutable(): void;
  run(): Promise<{ result: TaskResult | null; audit: AuditEvent[]; status: string }>;
  newTask(goal?: string): Promise<string>;
};

async function harness(options: Scenario = {}): Promise<Harness> {
  const fixture = repository(options.gates === undefined ? {} : { gates: options.gates });
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
      ...(options.approval === 'default'
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

  const self: Harness = {
    runtime,
    fixture,
    taskId,
    grantAudits,
    get decisions() {
      return decisions;
    },
    permissionReached,
    removeExecutable: () => rmSync(wrapper, { force: true }),
    newTask: makeTask,
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

describe('INTENTSMITH_WORKER=opencode composes the real authority stack', () => {
  it('selects the OpenCode adapter, the ledger, Git evidence and the gates', async () => {
    const test = await harness();
    expect(test.runtime.workerKind).toBe('opencode');
    // Present only for a worker that cannot run without a mediated inference
    // path, which is what makes the gateway mandatory at startup.
    expect(typeof test.runtime.bindWorkerGateway).toBe('function');

    const { result, audit, status } = await test.run();
    if (status !== 'passed') throw new Error(JSON.stringify({ status, result }, null, 2));

    // Artifacts only the OpenCode adapter produces: a fake worker emits none.
    expect(result?.artifacts.map(artifact => artifact.id)).toEqual(
      expect.arrayContaining(['opencode-config', 'sandbox-status']),
    );
    // The ledger and the mediator decided the write.
    const types = audit.map(event => event.type);
    expect(types).toEqual(expect.arrayContaining(['approval.requested', 'approval.granted', 'approval.consumed']));
    // Git produced the diff; the gate runner produced the evidence.
    expect(result?.diffs[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result?.deterministicEvidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'gate_fixture', status: 'pass' })]),
    );
    expect(audit.at(-1)).toMatchObject({
      type: 'task.verdict',
      data: { verdict: 'pass', evidenceLinks: { authoritativeSource: 'git', changedPaths: ['src/answer.js'] } },
    });
  });

  it('reaches PASS for an approved Git-backed change with passing gates', async () => {
    const test = await harness();
    const { result, status } = await test.run();
    expect({ status, verdict: result?.coreVerdict }).toEqual({ status: 'passed', verdict: 'pass' });
    expect(readFileSync(test.fixture.target, 'utf8')).toBe('module.exports = 4;\n');
    expect(result?.approvals).toHaveLength(1);
  });

  it('keeps the fake worker the explicit, deterministic default', async () => {
    const runtime = createRuntime({ env: {}, dbPath: ':memory:' });
    cleanups.push(() => runtime.close());
    expect(runtime.workerKind).toBe('fake');
    // Nothing to bind: the fake worker needs no gateway, so startup keeps it off.
    expect(runtime.bindWorkerGateway).toBeUndefined();

    const root = mkdtempSync(path.join(tmpdir(), 'intentsmith-fake-'));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const project = await runtime.core.createProject({ name: 'fake', rootPath: root });
    const task = await runtime.core.createTask(createTaskInput(project.id, root));
    await runtime.core.startTask(task.id);

    expect((await runtime.core.waitForTask(task.id)).status).toBe('passed');
  });

  it('refuses an unrecognized worker selection instead of falling back', () => {
    expect(() => createRuntime({ env: { [WORKER_SELECTION_ENV]: 'opencodee' }, dbPath: ':memory:' })).toThrow(
      WorkerConfigError,
    );
  });

  it('fails closed when OpenCode is selected without its configuration', () => {
    // No database is opened and no fake worker is substituted: the process
    // refuses to compose a runtime it cannot back with real authority.
    expect(() => createRuntime({ env: { [WORKER_SELECTION_ENV]: 'opencode' }, dbPath: ':memory:' })).toThrow(
      /configuration is unusable/,
    );
  });

  it('refuses to run when no gateway backs the run-scoped grant', async () => {
    const test = await harness({ bindGateway: false });
    const { result, status } = await test.run();

    expect(status).toBe('failed');
    expect(result?.coreVerdict).not.toBe('pass');
    // Nothing was issued, so nothing had to be revoked.
    expect(test.grantAudits).toHaveLength(0);
    expect(test.runtime.gatewayTokens.size).toBe(0);
    expect(readFileSync(test.fixture.target, 'utf8')).toBe('module.exports = 3;\n');
  });
});

describe('code-task evidence enforcement through the composition root', () => {
  it('refuses to pass an unapproved edit even though the worker succeeded', async () => {
    const test = await harness({ behaviour: 'edits-file' });
    const { result } = await test.run();

    expect(result?.workerClaim?.status).toBe('success');
    expect(result?.coreVerdict).toBe('fail');
    expect(result?.unresolvedRisks.join(' ')).toMatch(/no approval was recorded/);
  });

  it('refuses to accept the worker’s own account in place of Git evidence', async () => {
    // Everything the worker controls says the work happened: a completed tool
    // call, passing worker evidence, and a success claim. The gate is rigged to
    // agree, so Git is the only thing left that can disagree — and it does.
    const test = await harness({ behaviour: 'tool-call-success', gates: 'always' });
    const { result } = await test.run();

    expect(result?.workerClaim?.status).toBe('success');
    expect(result?.deterministicEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'worker', status: 'pass' }),
        expect.objectContaining({ id: 'gate_fixture', status: 'pass' }),
      ]),
    );
    expect(result?.coreVerdict).toBe('fail');
    expect(result?.unresolvedRisks.join(' ')).toMatch(/required an actual workspace change, but Git found none/);
    // Git capture is the only producer of a diff reference, so a worker that
    // reports one has no way to put it here.
    expect(result?.diffs).toEqual([]);
  });

  it('refuses to pass when a required gate fails', async () => {
    const test = await harness({ gates: 'fail' });
    const { result } = await test.run();

    expect(result?.coreVerdict).toBe('fail');
    expect(result?.deterministicEvidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'gate_fixture', status: 'fail' })]),
    );
  });

  it('denies an edit outside the workspace and never creates the file', async () => {
    const outside = path.join(tmpdir(), `intentsmith-escape-${process.pid}.txt`);
    cleanups.push(() => rmSync(outside, { force: true }));
    const test = await harness({ editPath: path.relative(tmpdir(), outside).replace(/^/, '../') });
    const { result } = await test.run();

    expect(existsSync(outside)).toBe(false);
    expect(result?.coreVerdict).not.toBe('pass');
  });
});

describe('no run leaves a standing permission', () => {
  it('denies by default because no approval decision surface exists yet', async () => {
    // The production composition installs no decider. Silence must read as a
    // refusal, never as an automatic yes.
    const test = await harness({ approval: 'default' });
    const { result, audit } = await test.run();

    expect(result?.coreVerdict).toBe('fail');
    expect(audit.map(event => event.type)).toContain('approval.denied');
    expect(readFileSync(test.fixture.target, 'utf8')).toBe('module.exports = 3;\n');
  });

  it('spends the approval once and leaves nothing granted behind', async () => {
    const test = await harness();
    const { audit } = await test.run();
    const types = audit.map(event => event.type);

    expect(types.indexOf('approval.requested')).toBeLessThan(types.indexOf('approval.granted'));
    expect(types.indexOf('approval.granted')).toBeLessThan(types.indexOf('approval.consumed'));
    // One question, one answer, one use.
    expect(types.filter(type => type === 'approval.granted')).toHaveLength(1);
    expect(types.filter(type => type === 'approval.consumed')).toHaveLength(1);
    expect(test.decisions).toBe(1);
    // Nothing was left in a state that could authorize a later action.
    expect(types.lastIndexOf('approval.granted')).toBeLessThan(types.lastIndexOf('approval.consumed'));
  });

  it('makes a second run ask again rather than inherit the first answer', async () => {
    const test = await harness();
    await test.run();

    const second = await test.newTask('Change src/answer.js again.');
    await test.runtime.core.startTask(second);
    await test.runtime.core.waitForTask(second);
    const audit = await test.runtime.core.listAuditEvents(second);

    expect(audit.map(event => event.type)).toContain('approval.requested');
    expect(test.decisions).toBe(2);
  });
});

describe('the run-scoped grant is revoked on every terminal path', () => {
  it.each([
    ['success', { behaviour: 'waits-for-permission' as FakeAgentBehaviour }],
    ['worker failure', { behaviour: 'refusal' as FakeAgentBehaviour }],
    ['worker crash', { behaviour: 'crashes' as FakeAgentBehaviour }],
    ['a protocol violation', { behaviour: 'protocol-garbage' as FakeAgentBehaviour }],
  ])('revokes exactly once on %s', async (_label, scenario) => {
    const test = await harness(scenario);
    await test.run();

    expect(test.grantAudits).toHaveLength(1);
    expect(test.grantAudits[0]?.revoked).toBe(true);
    expect(test.runtime.gatewayTokens.size).toBe(0);
    // The audit record carries the run it belonged to and no secret.
    expect(JSON.stringify(test.grantAudits[0])).not.toMatch(/token/i);
  });

  it('revokes when the executable disappears before the process starts', async () => {
    const test = await harness({ executable: 'wrapper' });
    test.removeExecutable();
    const { result } = await test.run();

    expect(result?.coreVerdict).toBe('fail');
    expect(test.grantAudits).toHaveLength(1);
    expect(test.grantAudits[0]).toMatchObject({ outcome: 'spawn_failed', revoked: true });
    expect(test.runtime.gatewayTokens.size).toBe(0);
  });

  it('revokes when the run is cancelled with an approval still pending', async () => {
    const test = await harness({ approval: 'pending' });
    await test.runtime.core.startTask(test.taskId);
    await test.permissionReached;
    await test.runtime.core.cancelTask(test.taskId);
    await test.runtime.core.waitForTask(test.taskId);

    expect((await test.runtime.core.getTaskResult(test.taskId))?.coreVerdict).toBe('cancelled');
    expect(test.grantAudits).toHaveLength(1);
    expect(test.grantAudits[0]?.revoked).toBe(true);
    expect(test.runtime.gatewayTokens.size).toBe(0);
    // A pending edit never happened.
    expect(readFileSync(test.fixture.target, 'utf8')).toBe('module.exports = 3;\n');
  });

  it('revokes when IntentSmith times the run out', async () => {
    const timer = new FakeTimer();
    const test = await harness({ behaviour: 'hangs', timer });
    await test.runtime.core.startTask(test.taskId);
    timer.advance(1_000);
    await test.runtime.core.waitForTask(test.taskId);

    const runs = await test.runtime.core.listTaskRuns(test.taskId);
    expect(runs[0]?.status).toBe('timeout');
    expect(test.grantAudits).toHaveLength(1);
    expect(test.grantAudits[0]?.revoked).toBe(true);
    expect(test.runtime.gatewayTokens.size).toBe(0);
  });

  it('has revoked the grant before change evidence is even collected', async () => {
    const test = await harness();
    await test.run();

    // Evidence collection and gates run after the worker settles, so a failure
    // in either cannot strand a live token.
    expect(test.runtime.gatewayTokens.size).toBe(0);
    expect(test.grantAudits[0]?.revoked).toBe(true);
  });
});
