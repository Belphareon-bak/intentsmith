import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { FakeAgentBehaviour } from '@intentsmith/adapter-opencode/fixtures';
import { FakeTimer, createTaskInput } from '@intentsmith/testing';

import { createRuntime } from '../runtime.js';
import { WORKER_SELECTION_ENV, WorkerConfigError } from './config.js';
import { harness as buildHarness, repository, type Scenario } from './fixtures.js';

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

const harness = async (options: Scenario = {}) => await buildHarness(cleanups, options);

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

    const { root } = repository(cleanups);
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
  it('never turns silence into consent on the production composition', async () => {
    // The production composition installs the decision desk, not a decider that
    // answers by itself. Nobody decides here, so the run must end without the
    // edit — silence is not a yes, and never becomes one by waiting.
    const timer = new FakeTimer();
    const test = await harness({ approval: 'surface', timer });
    await test.runtime.core.startTask(test.taskId);
    const runId = await test.runIdFor(test.taskId);
    await test.awaitPending(runId);

    timer.advance(1_000);
    await test.runtime.core.waitForTask(test.taskId);

    expect((await test.runtime.core.getTaskResult(test.taskId))?.coreVerdict).not.toBe('pass');
    const audit = await test.runtime.core.listAuditEvents(test.taskId);
    expect(audit.map(event => event.type)).not.toContain('approval.granted');
    expect(readFileSync(test.fixture.target, 'utf8')).toBe('module.exports = 3;\n');
    // Nothing is left suspended waiting for an answer that can never come.
    expect(test.desk.pendingWaiterCount).toBe(0);
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

describe('the terminal verdict carries trusted provenance', () => {
  it('cites the run, sandbox, approvals, digest, paths and gates for an approved edit', async () => {
    const test = await harness();
    const { audit, status, result } = await test.run();
    expect(status).toBe('passed');

    const verdict = audit.at(-1);
    const links = (verdict?.data as { evidenceLinks?: Record<string, unknown> }).evidenceLinks ?? {};
    const runId = await test.runIdFor(test.taskId);

    expect(verdict?.type).toBe('task.verdict');
    expect(links).toMatchObject({
      // Git remains the authority for what changed.
      authoritativeSource: 'git',
      changedPaths: ['src/answer.js'],
      diffDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      diffUri: expect.stringMatching(/^intentsmith:\/\/git-diff\/[0-9a-f]{64}$/),
      gateEvidenceUris: ['intentsmith://gate/fixture'],
      // Trusted run provenance, none of which passed through the worker.
      runId,
      taskId: test.taskId,
      sandboxAttestationUri: expect.stringMatching(/^intentsmith:\/\/sandbox\//),
      sandboxLevel: expect.any(String),
    });
    expect(links.approvalIds).toEqual(result?.approvals.map(approval => approval.id));
    // The structured lifecycle evidence this verdict rests on is addressable.
    expect(links.grantAuditIds).toHaveLength(1);
    const grantId = (links.grantAuditIds as string[])[0];
    expect(audit.find(event => event.id === grantId)?.type).toBe('security.grant');

    // The verdict and the persisted diff artifact agree on the digest.
    expect(result?.diffs[0]?.sha256).toBe(links.diffDigest);
  });

  it('cannot pass on the worker’s account when Git has nothing to show', async () => {
    // The worker reports a completed tool call and success, and the gate is
    // rigged to agree. Git disagrees, and Git is the only source of the digest
    // and the changed paths, so there is no provenance to substitute.
    const test = await harness({ behaviour: 'tool-call-success', gates: 'always' });
    const { audit, result } = await test.run();

    expect(result?.workerClaim?.status).toBe('success');
    expect(result?.coreVerdict).toBe('fail');
    const links = (audit.at(-1)?.data as { evidenceLinks?: Record<string, unknown> }).evidenceLinks ?? {};
    expect(links.changedPaths).toEqual([]);
    expect(links.diffDigest).toBeNull();
    expect(links.diffUri).toBeNull();
    // The run is still identifiable even though it produced nothing.
    expect(links.runId).toBe(await test.runIdFor(test.taskId));
  });

  it('leaves a non-code task judged on gates alone, as before', async () => {
    const test = await harness();
    const project = await test.runtime.core.getTask(test.taskId);
    const planTask = await test.runtime.core.createTask(
      createTaskInput(project.projectId, test.fixture.root, {
        type: 'plan',
        goal: 'Describe the change without making it.',
        timeoutMs: 1_000,
        scope: { ...createTaskInput(project.projectId, test.fixture.root).scope, timeoutMs: 1_000 },
      }),
    );
    await test.runtime.core.startTask(planTask.id);
    await test.runtime.core.waitForTask(planTask.id);

    const result = await test.runtime.core.getTaskResult(planTask.id);
    // No change was required of it, so missing change evidence is not a risk.
    expect(result?.unresolvedRisks.join(' ')).not.toMatch(/provenance|actual workspace change/);
  });
});
