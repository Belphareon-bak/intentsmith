import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { FakeTimer } from '@intentsmith/testing';

import type { PendingApprovalView } from '../../apps/server/src/opencode/approval-desk.js';
import {
  MODEL,
  OPT_IN,
  assertPreflight,
  awaitProcessGroupExit,
  processGroupMembers,
  processGroupOf,
  realProductHarness,
  recordScenario,
  sampleShowsGpu,
  sleep,
  startGpuSampler,
  type Cleanups,
  type Preflight,
  type RealProductHarness,
} from './real-product.js';

/**
 * Phase 3 run 2C: the complete product lifecycle against the pinned real binary.
 *
 * Every scenario here is driven the way an operator drives it — HTTP against the
 * server the composition root built — with the pinned `opencode-ai@1.18.8`
 * binary, the real gateway and real local Ollama inference on this machine's
 * NVIDIA GPU. Nothing substitutes a fixture for the worker, the model, Git or
 * the gates.
 *
 * The claims are ordered so each rests on the one before it: a permission is
 * asked before any side effect; only the exact recorded request can be
 * approved; the workspace changes only afterwards; what changed is read out of
 * Git rather than believed; and every terminal path leaves no side effect, no
 * suspended waiter, no live token and no surviving process-group member.
 */

export const EDIT_GOAL = [
  'Edit the existing file src/answer.js in this project so that it exports the number 4 instead of 3.',
  'After your edit the file must contain exactly: module.exports = 4;',
  'Change nothing else, create no new file, and run no shell command.',
].join(' ');

const cleanups: Cleanups = [];
let preflight: Preflight | undefined;

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

beforeAll(async () => {
  if (!OPT_IN) return;
  preflight = await assertPreflight();
}, 120_000);

const maybe = OPT_IN ? describe : describe.skip;

/** Starts a task and waits until the real agent has raised one permission. */
async function runToPendingApproval(
  test: RealProductHarness,
): Promise<{ taskId: string; runId: string; pid: number; pgid: number; pending: PendingApprovalView }> {
  const taskId = await test.createTask(EDIT_GOAL);
  await test.startTask(taskId);
  const runId = await test.runIdFor(taskId);
  const pid = await test.awaitWorkerPid(taskId);
  const pgid = processGroupOf(pid);
  if (pgid === undefined) throw new Error(`Could not resolve the process group of worker pid ${pid}.`);
  // Resolved while the process is alive: after termination there is nothing
  // left to ask, and a group learned too late proves nothing about descendants.
  expect(processGroupMembers(pgid).length).toBeGreaterThan(0);
  const pending = await test.awaitPending(runId);
  return { taskId, runId, pid, pgid, pending };
}

maybe('an approved edit through the complete product', () => {
  it(
    'asks first, changes the workspace only after approval, and passes on Git-derived evidence',
    async () => {
      const test = await realProductHarness(cleanups, { label: 'approved-edit' });
      expect(test.runtime.workerKind).toBe('opencode');
      expect(test.boundAddress).toBe('127.0.0.1');

      const sampler = startGpuSampler();
      const { taskId, runId, pid, pgid, pending } = await runToPendingApproval(test);

      // 1. The operator lists what is pending, through the real route.
      const listed = await test.get(`/runs/${runId}/approvals`);
      expect(listed.status).toBe(200);
      const approvals = (listed.body as { approvals: PendingApprovalView[] }).approvals;
      expect(approvals).toHaveLength(1);
      expect(approvals[0]).toMatchObject({ id: pending.id, runId, taskId });
      // A question, not a transcript: no payload, no prompt, no credential.
      expect(JSON.stringify(listed.body)).not.toMatch(/token|authorization|prompt|content|arguments/i);

      // 2. Nothing has happened to the workspace yet.
      expect(test.targetContent()).toBe('module.exports = 3;\n');
      expect(test.gitStatus()).toBe('');

      // The permission was recorded before any protected side effect could be.
      const beforeApproval = (await test.audit(taskId)).map(event => event.type);
      expect(beforeApproval).toContain('approval.requested');
      expect(beforeApproval).not.toContain('approval.granted');

      // 3. Approve one exact (run, approval) pair.
      const decision = await test.decide(runId, pending.id, 'approve');
      expect(decision.status).toBe(200);
      expect(decision.body).toMatchObject({
        decision: 'approve',
        outcome: 'recorded',
        approval: { id: pending.id, runId },
      });
      // The same decision cannot be spent twice.
      const replay = await test.decide(runId, pending.id, 'approve');
      expect(replay.status).toBe(409);

      // 4. Anything the agent asks for after this is answered on its own merits:
      // the approved request authorized one action and nothing else.
      let stop = false;
      const laterDecisions: Array<{ toolName: string; verdict: string }> = [];
      const operator = (async () => {
        while (!stop) {
          for (const request of await test.pending(runId)) {
            const wanted =
              request.resourcePaths.length > 0 &&
              request.resourcePaths.every(resource => resource === test.fixture.target);
            const verdict = wanted ? 'approve' : 'deny';
            await test.decide(runId, request.id, verdict);
            laterDecisions.push({ toolName: request.toolName, verdict });
          }
          await sleep(250);
        }
      })();

      const task = await test.awaitTerminal(taskId);
      stop = true;
      await operator;
      const gpuSamples = sampler.stop();

      // 5. The expected terminal verdict, on evidence Git produced.
      expect(task.status).toBe('passed');
      const result = await test.result(taskId);
      expect(result.status).toBe(200);
      expect(result.body.coreVerdict).toBe('pass');
      expect(test.targetContent()).toContain('4');
      expect(test.gitStatus()).toBe('M src/answer.js');

      expect(result.body.diffs[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(result.body.deterministicEvidence).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'gate_answer', status: 'pass' })]),
      );
      expect(result.body.artifacts.map(artifact => artifact.id)).toEqual(
        expect.arrayContaining(['opencode-config', 'sandbox-status']),
      );

      // 6. The verdict cites run, task, sandbox, inference, approval, Git and
      // gate provenance, and the change set agrees with it.
      const audit = await test.audit(taskId);
      const verdict = audit.at(-1);
      const links = (verdict?.data as { evidenceLinks?: Record<string, unknown> }).evidenceLinks ?? {};
      expect(verdict?.type).toBe('task.verdict');
      expect(links).toMatchObject({
        authoritativeSource: 'git',
        changedPaths: ['src/answer.js'],
        diffDigest: result.body.diffs[0]?.sha256,
        diffUri: `intentsmith://git-diff/${result.body.diffs[0]?.sha256}`,
        gateEvidenceUris: ['intentsmith://gate/answer'],
        runId,
        taskId,
        sandboxAttestationUri: expect.stringMatching(/^intentsmith:\/\//),
        // The actual local model decided this run, and its profile is not
        // promoted by having been used once.
        modelId: MODEL,
        modelProfileStatus: 'PROVISIONAL',
      });
      expect(links.approvalIds).toContain(pending.id);
      expect((links.grantAuditIds as string[]).length).toBe(1);
      expect((links.inferenceProfileAuditIds as string[]).length).toBeGreaterThan(0);
      const grantEvent = audit.find(event => event.id === (links.grantAuditIds as string[])[0]);
      expect(grantEvent?.type).toBe('security.grant');
      const profileEvent = audit.find(event => event.id === (links.inferenceProfileAuditIds as string[])[0]);
      expect(profileEvent).toMatchObject({ type: 'inference.profile', runId, data: { modelId: MODEL } });

      // 7. The ordering is the claim: asked, granted, spent, then judged.
      const types = audit.map(event => event.type);
      expect(types.indexOf('approval.requested')).toBeLessThan(types.indexOf('approval.granted'));
      expect(types.indexOf('approval.granted')).toBeLessThan(types.indexOf('approval.consumed'));
      expect(types.indexOf('approval.consumed')).toBeLessThan(types.lastIndexOf('task.verdict'));
      expect(types.filter(type => type === 'approval.granted')).toHaveLength(1);

      // 8. GPU evidence belongs to this run: sampled while it was executing.
      expect(gpuSamples.some(sample => sampleShowsGpu(sample, MODEL))).toBe(true);

      // 9. Nothing outlives the run: no grant, no token, no waiter, no process.
      expect(test.grantAudits).toHaveLength(1);
      expect(test.grantAudits[0]).toMatchObject({ runId, revoked: true });
      expect(test.runtime.gatewayTokens.size).toBe(0);
      expect(test.desk.pendingWaiterCount).toBe(0);
      expect(await awaitProcessGroupExit(pgid)).toEqual([]);

      // 10. No raw model or workspace content reached the audit trail.
      const serializedAudit = JSON.stringify(audit);
      expect(serializedAudit).not.toContain('module.exports');
      expect(serializedAudit).not.toMatch(/Bearer |apiKey|INTENTSMITH_GATEWAY_TOKEN/);

      recordScenario({
        scenario: 'approved-edit',
        outcome: 'pass',
        preflight: preflight ?? null,
        taskId,
        runId,
        workerPid: pid,
        workerPgid: pgid,
        approvalId: pending.id,
        approvalToolName: pending.toolName,
        approvalCapabilityId: pending.capabilityId,
        laterDecisions,
        finalTaskStatus: task.status,
        coreVerdict: result.body.coreVerdict,
        changedPaths: links.changedPaths,
        diffDigest: links.diffDigest,
        diffUri: links.diffUri,
        gateEvidenceUris: links.gateEvidenceUris,
        modelId: links.modelId,
        modelProfileStatus: links.modelProfileStatus,
        grantAuditIds: links.grantAuditIds,
        inferenceProfileAuditIds: links.inferenceProfileAuditIds,
        auditOrder: types,
        gpuSamples,
        processGroupMembersAfterTerminal: processGroupMembers(pgid),
        gatewayTokensAfterTerminal: test.runtime.gatewayTokens.size,
        pendingWaitersAfterTerminal: test.desk.pendingWaiterCount,
      });
    },
    900_000,
  );
});

maybe('terminal paths while a real permission is pending', () => {
  it(
    'deny prevents the protected side effect and settles the run',
    async () => {
      const test = await realProductHarness(cleanups, { label: 'deny' });
      const { taskId, runId, pid, pgid, pending } = await runToPendingApproval(test);

      const decision = await test.decide(runId, pending.id, 'deny');
      expect(decision.status).toBe(200);
      expect(decision.body).toMatchObject({ decision: 'deny', outcome: 'recorded' });

      const task = await test.awaitTerminal(taskId);

      expect(test.targetContent()).toBe('module.exports = 3;\n');
      expect(test.gitStatus()).toBe('');
      expect((await test.result(taskId)).body.coreVerdict).not.toBe('pass');
      expect(test.desk.pendingWaiterCount).toBe(0);
      expect(test.grantAudits).toHaveLength(1);
      expect(test.grantAudits[0]?.revoked).toBe(true);
      expect(test.runtime.gatewayTokens.size).toBe(0);
      expect(await awaitProcessGroupExit(pgid)).toEqual([]);

      const types = (await test.audit(taskId)).map(event => event.type);
      expect(types).toContain('approval.requested');
      expect(types).toContain('approval.denied');
      expect(types).not.toContain('approval.granted');

      recordScenario({
        scenario: 'deny-while-pending',
        outcome: 'pass',
        taskId,
        runId,
        workerPid: pid,
        workerPgid: pgid,
        approvalId: pending.id,
        finalTaskStatus: task.status,
        auditOrder: types,
        targetUnchanged: true,
        processGroupMembersAfterTerminal: processGroupMembers(pgid),
        gatewayTokensAfterTerminal: test.runtime.gatewayTokens.size,
        pendingWaitersAfterTerminal: test.desk.pendingWaiterCount,
      });
    },
    900_000,
  );

  it(
    'cancel leaves no side effect, no live process group and no late authority',
    async () => {
      const test = await realProductHarness(cleanups, { label: 'cancel' });
      const { taskId, runId, pid, pgid, pending } = await runToPendingApproval(test);

      const cancelled = await test.post(`/tasks/${taskId}/cancel`);
      expect(cancelled.status).toBe(200);
      const task = await test.awaitTerminal(taskId);
      expect(task.status).toBe('cancelled');

      const runs = await test.runtime.core.listTaskRuns(taskId);
      expect(runs).toHaveLength(1);
      expect(runs[0]?.status).toBe('cancelled');

      // A decision arriving after the run ended has no authority at all.
      const late = await test.decide(runId, pending.id, 'approve');
      expect(late.status).toBeGreaterThanOrEqual(400);

      expect(test.targetContent()).toBe('module.exports = 3;\n');
      expect(test.gitStatus()).toBe('');
      expect(test.desk.pendingWaiterCount).toBe(0);
      expect(test.grantAudits).toHaveLength(1);
      expect(test.grantAudits[0]?.revoked).toBe(true);
      expect(test.runtime.gatewayTokens.size).toBe(0);
      expect(await awaitProcessGroupExit(pgid)).toEqual([]);

      const types = (await test.audit(taskId)).map(event => event.type);
      // The pending question is settled as a refusal, never granted. Which
      // refusal it is depends on who reaches it first: the desk releases every
      // suspended decision as a deny when the run ends, and the ledger revokes
      // whatever is still pending. Either is a recorded no, and both are
      // asserted as such rather than one being treated as the only correct one.
      expect(types).not.toContain('approval.granted');
      expect(types.some(type => type === 'approval.denied' || type === 'approval.revoked')).toBe(true);
      expect(await test.pending(runId)).toEqual([]);
      expect(types.indexOf('approval.requested')).toBeLessThan(types.lastIndexOf('task.verdict'));

      recordScenario({
        scenario: 'cancel-while-pending',
        outcome: 'pass',
        taskId,
        runId,
        workerPid: pid,
        workerPgid: pgid,
        approvalId: pending.id,
        lateApprovalStatus: late.status,
        finalTaskStatus: task.status,
        finalRunStatus: runs[0]?.status ?? null,
        auditOrder: types,
        processGroupMembersAfterTerminal: processGroupMembers(pgid),
        gatewayTokensAfterTerminal: test.runtime.gatewayTokens.size,
        pendingWaitersAfterTerminal: test.desk.pendingWaiterCount,
      });
    },
    900_000,
  );

  it(
    'an IntentSmith timeout ends the run and kills the real process group',
    async () => {
      // The product owns the timeout; the injected timer only decides when its
      // own scheduled deadline fires, so the path under test is the real one.
      const timer = new FakeTimer();
      const test = await realProductHarness(cleanups, { label: 'timeout', timeoutMs: 120_000, timer });
      const { taskId, runId, pid, pgid, pending } = await runToPendingApproval(test);

      timer.advance(120_000);
      const task = await test.awaitTerminal(taskId);

      const runs = await test.runtime.core.listTaskRuns(taskId);
      expect(runs).toHaveLength(1);
      expect(runs[0]?.status).toBe('timeout');

      const late = await test.decide(runId, pending.id, 'approve');
      expect(late.status).toBeGreaterThanOrEqual(400);

      expect(test.targetContent()).toBe('module.exports = 3;\n');
      expect(test.gitStatus()).toBe('');
      expect(test.desk.pendingWaiterCount).toBe(0);
      expect(test.grantAudits).toHaveLength(1);
      expect(test.grantAudits[0]?.revoked).toBe(true);
      expect(test.runtime.gatewayTokens.size).toBe(0);
      expect(await awaitProcessGroupExit(pgid)).toEqual([]);

      recordScenario({
        scenario: 'timeout-while-pending',
        outcome: 'pass',
        taskId,
        runId,
        workerPid: pid,
        workerPgid: pgid,
        approvalId: pending.id,
        lateApprovalStatus: late.status,
        finalTaskStatus: task.status,
        finalRunStatus: runs[0]?.status ?? null,
        auditOrder: (await test.audit(taskId)).map(event => event.type),
        processGroupMembersAfterTerminal: processGroupMembers(pgid),
        gatewayTokensAfterTerminal: test.runtime.gatewayTokens.size,
        pendingWaitersAfterTerminal: test.desk.pendingWaiterCount,
      });
    },
    900_000,
  );

  it(
    'a killed real worker fails the run and leaves no descendant behind',
    async () => {
      const test = await realProductHarness(cleanups, { label: 'termination' });
      const { taskId, runId, pid, pgid, pending } = await runToPendingApproval(test);

      // Only the process group this disposable run created is signalled.
      process.kill(-pgid, 'SIGKILL');
      const task = await test.awaitTerminal(taskId);
      expect(task.status).toBe('failed');

      const runs = await test.runtime.core.listTaskRuns(taskId);
      expect(runs[0]?.status).toBe('failed');

      const late = await test.decide(runId, pending.id, 'approve');
      expect(late.status).toBeGreaterThanOrEqual(400);

      expect(test.targetContent()).toBe('module.exports = 3;\n');
      expect(test.gitStatus()).toBe('');
      expect(test.desk.pendingWaiterCount).toBe(0);
      expect(test.grantAudits).toHaveLength(1);
      expect(test.grantAudits[0]?.revoked).toBe(true);
      expect(test.runtime.gatewayTokens.size).toBe(0);
      expect(await awaitProcessGroupExit(pgid)).toEqual([]);

      recordScenario({
        scenario: 'worker-termination-while-pending',
        outcome: 'pass',
        taskId,
        runId,
        workerPid: pid,
        workerPgid: pgid,
        approvalId: pending.id,
        lateApprovalStatus: late.status,
        finalTaskStatus: task.status,
        finalRunStatus: runs[0]?.status ?? null,
        auditOrder: (await test.audit(taskId)).map(event => event.type),
        processGroupMembersAfterTerminal: processGroupMembers(pgid),
        gatewayTokensAfterTerminal: test.runtime.gatewayTokens.size,
        pendingWaitersAfterTerminal: test.desk.pendingWaiterCount,
      });
    },
    900_000,
  );
});
