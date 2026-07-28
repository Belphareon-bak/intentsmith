import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { OpenCodeWorker } from '@intentsmith/adapter-opencode';
import { createFakeAgent, type FakeAgentBehaviour } from '@intentsmith/adapter-opencode/fixtures';
import {
  ApprovalLedger,
  CapabilityMediator,
  IntentSmithCore,
  type ChangeEvidenceCollector,
  type WorkerAdapter,
  type WorkerExecutionContext,
} from '@intentsmith/core';
import { openIntentSmithDatabase } from '@intentsmith/persistence';
import {
  captureProposedChanges,
  isAcceptable,
  runGates,
  type CapturedChangeSet,
  type GateDefinition,
  type GateResult,
} from '@intentsmith/process-runtime';
import type { ApprovalEvidenceReference } from '@intentsmith/worker-sdk';

import {
  DeterministicIdGenerator,
  FakeClock,
  FakeTimer,
  createTaskInput,
} from '@intentsmith/testing';

/**
 * Phase 3 approved edit -> Git evidence -> gates -> Core verdict.
 *
 * The worker is a real child process and Git/gates are real processes. Only
 * the ACP agent is deterministic. This keeps the proof offline while crossing
 * every production boundary that owns authority.
 */

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function repository(): { root: string; target: string; outside: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'intentsmith-phase3-change-'));
  const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.txt`);
  cleanups.push(() => rmSync(root, { recursive: true, force: true }), () => rmSync(outside, { force: true }));
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
  return { root, target, outside };
}

type Scenario = {
  behaviour?: FakeAgentBehaviour;
  editPath?: string;
  approval?: 'approve' | 'deny' | 'pending';
  collector?: 'normal' | 'missing';
  gates?: 'pass' | 'fail' | 'missing';
  workerProposedDiffDigest?: string;
  action?: 'complete' | 'cancel' | 'timeout';
};

type ScenarioHarness = {
  core: IntentSmithCore;
  taskId: string;
  timer: FakeTimer;
  permissionReached: Promise<void>;
  captured(): CapturedChangeSet | undefined;
  target: string;
  outside: string;
};

async function scenario(options: Scenario = {}): Promise<ScenarioHarness> {
  const fixture = repository();
  const behaviour = options.behaviour ?? 'waits-for-permission';
  const editPath =
    options.editPath === '__outside__'
      ? `../${path.basename(fixture.outside)}`
      : options.editPath ?? 'src/answer.js';
  const agent = createFakeAgent({
    behaviour,
    editPath,
    editContent: 'module.exports = 4;\n',
    recordActivity: false,
  });
  cleanups.push(() => agent.cleanup());

  const store = openIntentSmithDatabase(':memory:');
  cleanups.push(() => store.close());
  const clock = new FakeClock();
  const timer = new FakeTimer();
  const ids = new DeterministicIdGenerator();
  const approvals = new ApprovalLedger({ approvals: store, audit: store, clock, ids });

  let permissionResolve!: () => void;
  const permissionReached = new Promise<void>(resolve => {
    permissionResolve = resolve;
  });
  const never = new Promise<'approve' | 'deny'>(() => undefined);
  let contextForPermission: WorkerExecutionContext | undefined;
  let captured: CapturedChangeSet | undefined;

  const adapter = new OpenCodeWorker({
    executable: process.execPath,
    args: [agent.scriptPath],
    expectedVersion: 'fake-opencode/0.0.0',
    preferSandbox: false,
    limits: { startupMs: 3_000, idleMs: 5_000, overallMs: 10_000, terminationGraceMs: 200 },
    onPermissionRequest: async request => {
      permissionResolve();
      const context = contextForPermission;
      if (!context) return { allowed: false, reason: 'TaskRun context is unavailable.' };
      const mediator = new CapabilityMediator({
        ledger: approvals,
        audit: store,
        clock,
        ids,
        taskId: context.task.id,
        runId: context.run.id,
        workspaceRoot: fixture.root,
        decide: async () =>
          options.approval === 'pending'
            ? await never
            : options.approval === 'deny'
              ? 'deny'
              : 'approve',
      });
      const outcome = await mediator.mediate(request);
      return { allowed: outcome.allowed, reason: outcome.reason };
    },
  });

  const worker: WorkerAdapter = {
    describe: () => adapter.describe(),
    start: context => {
      contextForPermission = context;
      return adapter.start({ ...context, workspaceRoot: fixture.root });
    },
  };

  const fixtureGate: GateDefinition = {
    id: 'fixture',
    description: 'fixture answer is correct',
    executable: process.execPath,
    args: [path.join(fixture.root, 'check.cjs')],
  };
  const failingGate: GateDefinition = {
    id: 'fixture',
    description: 'forced failing gate',
    executable: process.execPath,
    args: ['-e', 'process.stderr.write("forced gate failure"); process.exit(1);'],
  };

  const collector: ChangeEvidenceCollector = {
    collect: async ({ run }) => {
      const gateResults: GateResult[] =
        options.gates === 'missing'
          ? []
          : await runGates([options.gates === 'fail' ? failingGate : fixtureGate], {
              cwd: fixture.root,
              env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
            });
      const approvalReferences: ApprovalEvidenceReference[] = (await approvals.listByRun(run.id)).map(approval => ({
        approvalId: approval.id,
        actionId: approval.actionId,
        payloadHash: approval.payloadHash,
        resourcePaths: approval.resourcePaths,
        state: approval.state,
      }));
      captured = await captureProposedChanges({
        workspaceRoot: fixture.root,
        approvals: approvalReferences,
        gates: gateResults,
        requiredGateIds: ['fixture'],
        requireChanges: true,
        ...(options.workerProposedDiffDigest === undefined
          ? {}
          : { workerProposedDiffDigest: options.workerProposedDiffDigest }),
      });

      const gateEvidence = gateResults.map(gate => ({
        id: `gate_${gate.id}`,
        kind: 'test' as const,
        status: gate.status,
        summary: `${gate.description}: ${gate.status}`,
        producedAt: clock.now(),
      }));
      const diffUri = captured.diffDigest
        ? `intentsmith://git-diff/${captured.diffDigest}`
        : undefined;

      return {
        acceptable: isAcceptable(captured),
        findings: [...captured.policyFindings, ...captured.unresolvedRisks],
        ...(captured.unavailableReason === undefined
          ? {}
          : { unavailableReason: captured.unavailableReason }),
        gateEvidence,
        diffs:
          captured.diffArtifact && diffUri
            ? [{
                id: captured.diffArtifact.id,
                kind: 'diff' as const,
                uri: diffUri,
                sha256: captured.diffArtifact.sha256,
              }]
            : [],
        approvals: approvalReferences.map(reference => ({
          id: reference.approvalId,
          taskId: run.taskId,
          runId: run.id,
          action: reference.actionId,
          decision: reference.state === 'denied' ? 'denied' as const : 'approved' as const,
          decidedAt: clock.now(),
        })),
        auditLinks: {
          authoritativeSource: captured.authoritativeSource,
          changedPaths: captured.changedPaths.map(entry => entry.path),
          diffDigest: captured.diffDigest ?? null,
          diffUri: diffUri ?? null,
          approvalIds: captured.approvalReferences.map(reference => reference.approvalId),
          gateEvidenceUris: captured.gateEvidence.map(gate => gate.evidenceUri),
        },
      };
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
    requireChangeEvidenceForCodeTasks: true,
    ...(options.collector === 'missing' ? {} : { changeEvidence: collector }),
  });
  cleanups.push(() => core.shutdown());

  const project = await core.createProject({ name: 'phase3-change', rootPath: fixture.root });
  const task = await core.createTask(
    createTaskInput(project.id, fixture.root, {
      goal: 'Change src/answer.js so the fixture gate passes.',
      timeoutMs: 1_000,
      scope: {
        ...createTaskInput(project.id, fixture.root).scope,
        timeoutMs: 1_000,
      },
    }),
  );

  return {
    core,
    taskId: task.id,
    timer,
    permissionReached,
    captured: () => captured,
    target: fixture.target,
    outside: fixture.outside,
  };
}

describe('Phase 3 proposed change set to verdict', () => {
  it('proves approved edit -> Git diff -> gate evidence -> PASS end to end', async () => {
    const harness = await scenario();
    await harness.core.startTask(harness.taskId);
    const task = await harness.core.waitForTask(harness.taskId);
    const result = await harness.core.getTaskResult(harness.taskId);
    const captured = harness.captured();
    if (task.status !== 'passed') {
      throw new Error(JSON.stringify({ taskStatus: task.status, result, captured }, null, 2));
    }
    expect({ taskStatus: task.status, verdict: result?.coreVerdict, risks: result?.unresolvedRisks, captured }).toMatchObject({
      taskStatus: 'passed',
      verdict: 'pass',
    });
    expect(result?.coreVerdict).toBe('pass');
    expect(captured).toMatchObject({
      authoritativeSource: 'git',
      changedPaths: [{ path: 'src/answer.js', status: 'modified' }],
      approvalReferences: [{ state: 'consumed' }],
      gateEvidence: [{ id: 'fixture', status: 'pass' }],
      requiredGateIds: ['fixture'],
      changeRequired: true,
    });
    expect(captured?.diffDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(result?.diffs[0]?.sha256).toBe(captured?.diffDigest);
    expect(result?.approvals).toHaveLength(1);

    const audit = await harness.core.listAuditEvents(harness.taskId);
    const types = audit.map(event => event.type);
    expect(types.indexOf('approval.requested')).toBeLessThan(types.indexOf('approval.granted'));
    expect(types.indexOf('approval.granted')).toBeLessThan(types.indexOf('approval.consumed'));
    expect(types.indexOf('approval.consumed')).toBeLessThan(types.indexOf('task.verdict'));
    expect(audit.at(-1)).toMatchObject({
      type: 'task.verdict',
      data: {
        verdict: 'pass',
        evidenceLinks: {
          authoritativeSource: 'git',
          changedPaths: ['src/answer.js'],
          approvalIds: [expect.stringMatching(/^approval_/)],
          gateEvidenceUris: ['intentsmith://gate/fixture'],
        },
      },
    });
  });

  it('fails a worker edit with no approval reference', async () => {
    const harness = await scenario({ behaviour: 'edits-file' });
    await harness.core.startTask(harness.taskId);
    await harness.core.waitForTask(harness.taskId);

    expect((await harness.core.getTaskResult(harness.taskId))?.coreVerdict).toBe('fail');
    expect(harness.captured()?.unresolvedRisks.join(' ')).toMatch(/no approval was recorded/);
  });

  it('denies an outside-workspace edit and never creates the outside file', async () => {
    const harness = await scenario({ editPath: '__outside__' });
    await harness.core.startTask(harness.taskId);
    await harness.permissionReached;
    await harness.core.waitForTask(harness.taskId);

    expect(existsSync(harness.outside)).toBe(false);
    expect((await harness.core.getTaskResult(harness.taskId))?.coreVerdict).not.toBe('pass');
  });

  it('fails when the worker-proposed digest disagrees with Git', async () => {
    const harness = await scenario({ workerProposedDiffDigest: '0'.repeat(64) });
    await harness.core.startTask(harness.taskId);
    await harness.core.waitForTask(harness.taskId);

    expect((await harness.core.getTaskResult(harness.taskId))?.coreVerdict).toBe('fail');
    expect(harness.captured()?.unresolvedRisks.join(' ')).toMatch(/does not match the Git-derived diff digest/);
  });

  it('fails an edit with missing required gate evidence', async () => {
    const harness = await scenario({ gates: 'missing' });
    await harness.core.startTask(harness.taskId);
    await harness.core.waitForTask(harness.taskId);

    expect((await harness.core.getTaskResult(harness.taskId))?.coreVerdict).toBe('fail');
    expect(harness.captured()?.unresolvedRisks.join(' ')).toMatch(/Required gate "fixture"/);
  });

  it('fails worker success when the required change collector is absent', async () => {
    const harness = await scenario({ collector: 'missing' });
    await harness.core.startTask(harness.taskId);
    await harness.core.waitForTask(harness.taskId);

    const result = await harness.core.getTaskResult(harness.taskId);
    expect(result?.coreVerdict).toBe('fail');
    expect(result?.unresolvedRisks).toContain(
      'Worker claimed success but no Git-backed proposed change set was collected.',
    );
  });

  it('turns a failed required gate into a non-PASS verdict', async () => {
    const harness = await scenario({ gates: 'fail' });
    await harness.core.startTask(harness.taskId);
    await harness.core.waitForTask(harness.taskId);

    expect((await harness.core.getTaskResult(harness.taskId))?.coreVerdict).toBe('fail');
    expect(harness.captured()?.gateEvidence).toMatchObject([{ id: 'fixture', status: 'fail' }]);
  });

  it('keeps cancellation non-PASS while approval is pending', async () => {
    const harness = await scenario({ approval: 'pending', action: 'cancel' });
    await harness.core.startTask(harness.taskId);
    await harness.permissionReached;
    await harness.core.cancelTask(harness.taskId);

    expect((await harness.core.getTaskResult(harness.taskId))?.coreVerdict).toBe('cancelled');
    expect(existsSync(harness.target)).toBe(true);
    // The baseline file exists, but the pending edit never changed it.
    expect(readFileSync(harness.target, 'utf8')).toBe('module.exports = 3;\n');
  });

  it('keeps timeout non-PASS while approval is pending', async () => {
    const harness = await scenario({ approval: 'pending', action: 'timeout' });
    await harness.core.startTask(harness.taskId);
    await harness.permissionReached;
    harness.timer.advance(1_000);
    await harness.core.waitForTask(harness.taskId);

    const run = (await harness.core.listTaskRuns(harness.taskId))[0];
    expect(run?.status).toBe('timeout');
    expect((await harness.core.getTaskResult(harness.taskId))?.coreVerdict).toBe('fail');
  });
});
