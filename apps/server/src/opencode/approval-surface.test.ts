import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import { FakeTimer } from '@intentsmith/testing';

import { isLoopbackAddress } from '../approval-routes.js';
import { harness as buildHarness, repository, type Scenario } from './fixtures.js';

/**
 * The human approval decision surface, exercised the way an operator uses it.
 *
 * Every decision here is made by injecting into the real server built by
 * `buildServer` over the real composition root. A test that called the ledger
 * directly would prove the ledger works, which was never in doubt; what needed
 * proving is that a person can reach it, that reaching it cannot widen what was
 * asked, and that no route or race leaves a run suspended on a question nobody
 * will answer.
 */

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const harness = async (options: Scenario = {}) => await buildHarness(cleanups, { approval: 'surface', ...options });

/** Starts a run and waits until exactly one approval is pending for it. */
async function pendingRun(test: Awaited<ReturnType<typeof harness>>): Promise<{ runId: string; approvalId: string }> {
  await test.runtime.core.startTask(test.taskId);
  const runId = await test.runIdFor(test.taskId);
  const approvalId = await test.awaitPending(runId);
  return { runId, approvalId };
}

describe('listing pending approvals', () => {
  it('shows one pending request, scoped to its own run', async () => {
    const test = await harness();
    const { runId, approvalId } = await pendingRun(test);

    const response = await test.server.inject({ method: 'GET', url: `/runs/${runId}/approvals` });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { approvals: Array<Record<string, unknown>> };
    expect(body.approvals).toHaveLength(1);
    expect(body.approvals[0]).toMatchObject({
      id: approvalId,
      runId,
      taskId: test.taskId,
      capabilityId: expect.any(String),
      payloadHash: expect.stringMatching(/^[0-9a-f]{16,}$/),
    });
    // A pending approval is a question, not a transcript: nothing the model or
    // the agent wrote, and no credential, is on this surface.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/token|authorization|prompt|content|arguments/i);

    // A different run id is a different question set, even from the same client.
    const other = await test.server.inject({ method: 'GET', url: '/runs/run_does_not_exist/approvals' });
    expect(other.json()).toEqual({ approvals: [] });

    await test.runtime.core.cancelTask(test.taskId);
    await test.runtime.core.waitForTask(test.taskId);
  });

  it('reports no decision surface at all when the runtime mediates nothing', async () => {
    const { root } = repository(cleanups);
    const { createRuntime } = await import('../runtime.js');
    const { buildServer } = await import('../app.js');
    const runtime = createRuntime({ env: {}, dbPath: ':memory:' });
    cleanups.push(() => runtime.close());
    const app = buildServer(runtime);
    cleanups.push(() => app.close());
    expect(runtime.approvals).toBeUndefined();
    expect(root).toBeTruthy();

    const response = await app.inject({ method: 'GET', url: '/runs/run_1/approvals' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'APPROVAL_SURFACE_UNAVAILABLE' } });
  });
});

describe('deciding one exact request', () => {
  it('permits only the operation that was already recorded', async () => {
    const test = await harness();
    const { runId, approvalId } = await pendingRun(test);

    const decision = await test.server.inject({
      method: 'POST',
      url: `/runs/${runId}/approvals/${approvalId}/approve`,
    });
    expect(decision.statusCode).toBe(200);
    expect(decision.json()).toMatchObject({
      decision: 'approve',
      outcome: 'recorded',
      approval: { id: approvalId, runId },
    });

    const task = await test.runtime.core.waitForTask(test.taskId);
    const result = await test.runtime.core.getTaskResult(test.taskId);
    expect({ status: task.status, verdict: result?.coreVerdict }).toEqual({ status: 'passed', verdict: 'pass' });
    // The approved write happened; nothing else did.
    expect(readFileSync(test.fixture.target, 'utf8')).toBe('module.exports = 4;\n');

    const audit = (await test.runtime.core.listAuditEvents(test.taskId)).map(event => event.type);
    // One question, one grant, one use. The order is the claim.
    expect(audit.indexOf('approval.requested')).toBeLessThan(audit.indexOf('approval.granted'));
    expect(audit.indexOf('approval.granted')).toBeLessThan(audit.indexOf('approval.consumed'));
    expect(audit.indexOf('approval.consumed')).toBeLessThan(audit.lastIndexOf('task.verdict'));
    expect(audit.filter(type => type === 'approval.granted')).toHaveLength(1);
    expect(audit.filter(type => type === 'approval.consumed')).toHaveLength(1);
    expect(test.desk.pendingWaiterCount).toBe(0);
  });

  it('prevents the protected side effect when the operator denies', async () => {
    const test = await harness();
    const { runId, approvalId } = await pendingRun(test);

    const decision = await test.server.inject({
      method: 'POST',
      url: `/runs/${runId}/approvals/${approvalId}/deny`,
    });
    expect(decision.statusCode).toBe(200);
    expect(decision.json()).toMatchObject({ decision: 'deny', outcome: 'recorded' });

    await test.runtime.core.waitForTask(test.taskId);
    expect((await test.runtime.core.getTaskResult(test.taskId))?.coreVerdict).not.toBe('pass');
    expect(readFileSync(test.fixture.target, 'utf8')).toBe('module.exports = 3;\n');
    expect((await test.runtime.core.listAuditEvents(test.taskId)).map(event => event.type)).toContain(
      'approval.denied',
    );
    expect(test.desk.pendingWaiterCount).toBe(0);
  });

  it('fails closed on an unknown approval, an unknown run and a mismatched pair', async () => {
    const test = await harness();
    const { runId, approvalId } = await pendingRun(test);

    const unknownApproval = await test.server.inject({
      method: 'POST',
      url: `/runs/${runId}/approvals/approval_not_real/approve`,
    });
    const unknownRun = await test.server.inject({
      method: 'POST',
      url: `/runs/run_not_real/approvals/${approvalId}/approve`,
    });
    // The id exists — in another run. Answering it from the wrong run must not
    // work, and must not confirm that it exists somewhere else either.
    expect([unknownApproval.statusCode, unknownRun.statusCode]).toEqual([404, 404]);
    expect(unknownApproval.json()).toMatchObject({ error: { code: 'APPROVAL_NOT_FOUND' } });
    expect(unknownRun.json()).toMatchObject({ error: { code: 'APPROVAL_NOT_FOUND' } });
    expect(JSON.stringify(unknownRun.json())).not.toContain(test.taskId);

    // The real request is untouched by either attempt.
    expect((await test.desk.listPending(runId)).map(approval => approval.id)).toEqual([approvalId]);

    await test.runtime.core.cancelTask(test.taskId);
    await test.runtime.core.waitForTask(test.taskId);
  });

  it('consumes a decision once: a conflicting second decision cannot change it', async () => {
    const test = await harness();
    const { runId, approvalId } = await pendingRun(test);

    const first = await test.server.inject({ method: 'POST', url: `/runs/${runId}/approvals/${approvalId}/deny` });
    expect(first.statusCode).toBe(200);

    const contradiction = await test.server.inject({
      method: 'POST',
      url: `/runs/${runId}/approvals/${approvalId}/approve`,
    });
    const repeat = await test.server.inject({ method: 'POST', url: `/runs/${runId}/approvals/${approvalId}/deny` });
    expect(contradiction.statusCode).toBe(409);
    expect(contradiction.json()).toMatchObject({ error: { code: 'APPROVAL_NOT_PENDING' } });
    expect(repeat.statusCode).toBe(409);

    await test.runtime.core.waitForTask(test.taskId);
    // The denial stands, and the second decision produced no grant of any kind.
    const audit = (await test.runtime.core.listAuditEvents(test.taskId)).map(event => event.type);
    expect(audit).toContain('approval.denied');
    expect(audit).not.toContain('approval.granted');
    expect(readFileSync(test.fixture.target, 'utf8')).toBe('module.exports = 3;\n');
  });

  it('offers no route that widens scope, grants always, or crosses runs', async () => {
    const test = await harness();
    const { runId, approvalId } = await pendingRun(test);

    // Every shape a client might try to use to ask for more than was requested.
    const attempts = await Promise.all(
      [
        { method: 'POST' as const, url: `/runs/${runId}/approvals/${approvalId}/approve-always` },
        { method: 'POST' as const, url: `/runs/${runId}/approvals/approve` },
        { method: 'POST' as const, url: `/runs/${runId}/approvals/*/approve` },
        { method: 'POST' as const, url: `/runs/${runId}/approvals` },
        { method: 'POST' as const, url: '/approvals/approve-all' },
        { method: 'POST' as const, url: '/runs/*/approvals/*/approve' },
      ].map(async request => await test.server.inject(request)),
    );
    expect(attempts.map(response => response.statusCode)).toEqual([404, 404, 404, 404, 404, 404]);

    // A body cannot widen the decision either: the route declares no body, and
    // the decision it makes is bound to the recorded payload hash regardless.
    const withPayload = await test.server.inject({
      method: 'POST',
      url: `/runs/${runId}/approvals/${approvalId}/approve`,
      payload: { scope: 'always', paths: ['/'], durationMs: 86_400_000 },
    });
    expect(withPayload.statusCode).toBe(200);
    const pendingAfter = await test.desk.listPending(runId);
    expect(pendingAfter).toEqual([]);

    await test.runtime.core.waitForTask(test.taskId);
    const result = await test.runtime.core.getTaskResult(test.taskId);
    // Exactly one approval, for exactly one action.
    expect(result?.approvals).toHaveLength(1);
    const audit = (await test.runtime.core.listAuditEvents(test.taskId)).map(event => event.type);
    expect(audit.filter(type => type === 'approval.granted')).toHaveLength(1);
    expect(audit.filter(type => type === 'approval.consumed')).toHaveLength(1);
  });

  it('refuses a decision that did not arrive over loopback', async () => {
    const test = await harness();
    const { runId, approvalId } = await pendingRun(test);

    const response = await test.server.inject({
      method: 'POST',
      url: `/runs/${runId}/approvals/${approvalId}/approve`,
      remoteAddress: '10.1.2.3',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'APPROVAL_SURFACE_REMOTE' } });
    expect((await test.desk.listPending(runId)).map(approval => approval.id)).toEqual([approvalId]);

    await test.runtime.core.cancelTask(test.taskId);
    await test.runtime.core.waitForTask(test.taskId);
  });

  it('classifies loopback peers without trusting a name', () => {
    expect([
      isLoopbackAddress('127.0.0.1'),
      isLoopbackAddress('127.9.9.9'),
      isLoopbackAddress('::1'),
      isLoopbackAddress('::ffff:127.0.0.1'),
    ]).toEqual([true, true, true, true]);
    expect([
      isLoopbackAddress('10.0.0.1'),
      isLoopbackAddress('localhost'),
      isLoopbackAddress(undefined),
      isLoopbackAddress('0.0.0.0'),
    ]).toEqual([false, false, false, false]);
  });
});

describe('a pending decision settles on every terminal path', () => {
  it('settles and removes the waiter when the run is cancelled', async () => {
    const test = await harness();
    const { runId, approvalId } = await pendingRun(test);
    expect(test.desk.pendingWaiterCount).toBe(1);

    await test.runtime.core.cancelTask(test.taskId);
    await test.runtime.core.waitForTask(test.taskId);

    expect(test.desk.pendingWaiterCount).toBe(0);
    expect(await test.desk.listPending(runId)).toEqual([]);
    expect((await test.runtime.core.getTaskResult(test.taskId))?.coreVerdict).toBe('cancelled');
    expect(readFileSync(test.fixture.target, 'utf8')).toBe('module.exports = 3;\n');

    // A decision that arrives after the run ended cannot revive anything.
    const late = await test.server.inject({
      method: 'POST',
      url: `/runs/${runId}/approvals/${approvalId}/approve`,
    });
    expect(late.statusCode).toBe(404);
    expect(readFileSync(test.fixture.target, 'utf8')).toBe('module.exports = 3;\n');
  });

  it('settles and removes the waiter when IntentSmith times the run out', async () => {
    const timer = new FakeTimer();
    const test = await harness({ timer });
    const { runId, approvalId } = await pendingRun(test);

    timer.advance(1_000);
    await test.runtime.core.waitForTask(test.taskId);

    expect(test.desk.pendingWaiterCount).toBe(0);
    const runs = await test.runtime.core.listTaskRuns(test.taskId);
    expect(runs[0]?.status).toBe('timeout');

    const late = await test.server.inject({
      method: 'POST',
      url: `/runs/${runId}/approvals/${approvalId}/approve`,
    });
    expect(late.statusCode).toBe(404);
    expect(readFileSync(test.fixture.target, 'utf8')).toBe('module.exports = 3;\n');
  });

  it('removes the waiter when the worker dies while the question is open', async () => {
    const test = await harness();
    const { runId, approvalId } = await pendingRun(test);

    // The supervised process is killed underneath the open ACP request, which is
    // what a crash, a protocol failure or an operator `kill` all look like here.
    await test.runtime.core.cancelTask(test.taskId);
    await test.runtime.core.waitForTask(test.taskId);
    expect(test.desk.pendingWaiterCount).toBe(0);

    const late = await test.server.inject({ method: 'POST', url: `/runs/${runId}/approvals/${approvalId}/deny` });
    expect(late.statusCode).toBe(404);
    expect(test.grantAudits).toHaveLength(1);
    expect(test.grantAudits[0]?.revoked).toBe(true);
    expect(test.runtime.gatewayTokens.size).toBe(0);
  });

  it('releases every waiter when the server itself stops', async () => {
    const test = await harness();
    await pendingRun(test);
    expect(test.desk.pendingWaiterCount).toBe(1);

    await test.runtime.close();
    expect(test.desk.pendingWaiterCount).toBe(0);
    await test.runtime.core.waitForTask(test.taskId).catch(() => undefined);
  });
});

describe('two concurrent runs cannot reach each other', () => {
  it('keeps the approvals of each run invisible and undecidable from the other', async () => {
    // One runtime, one ledger, one desk, two live runs. Git attribution between
    // simultaneous runs sharing a worktree is a separate problem and is not
    // claimed here: both runs are cancelled, so nothing is ever committed.
    const test = await harness();
    const otherTask = await test.newTask('Change src/answer.js from a second run.');

    await test.runtime.core.startTask(test.taskId);
    await test.runtime.core.startTask(otherTask);
    const one = { runId: await test.runIdFor(test.taskId), approvalId: '' };
    const two = { runId: await test.runIdFor(otherTask), approvalId: '' };
    one.approvalId = await test.awaitPending(one.runId);
    two.approvalId = await test.awaitPending(two.runId);
    expect(one.runId).not.toBe(two.runId);
    expect(one.approvalId).not.toBe(two.approvalId);

    // Each run's list contains exactly its own question, and never the other's.
    const listOne = (await test.server.inject({ method: 'GET', url: `/runs/${one.runId}/approvals` })).json() as {
      approvals: Array<{ id: string; runId: string }>;
    };
    const listTwo = (await test.server.inject({ method: 'GET', url: `/runs/${two.runId}/approvals` })).json() as {
      approvals: Array<{ id: string; runId: string }>;
    };
    expect(listOne.approvals.map(approval => approval.id)).toEqual([one.approvalId]);
    expect(listTwo.approvals.map(approval => approval.id)).toEqual([two.approvalId]);

    // Nor can either be decided from the other's run, even knowing both ids.
    const crossA = await test.server.inject({
      method: 'POST',
      url: `/runs/${one.runId}/approvals/${two.approvalId}/approve`,
    });
    const crossB = await test.server.inject({
      method: 'POST',
      url: `/runs/${two.runId}/approvals/${one.approvalId}/approve`,
    });
    expect([crossA.statusCode, crossB.statusCode]).toEqual([404, 404]);

    // Deciding one leaves the other exactly as it was.
    const denyOne = await test.server.inject({
      method: 'POST',
      url: `/runs/${one.runId}/approvals/${one.approvalId}/deny`,
    });
    expect(denyOne.statusCode).toBe(200);
    expect((await test.desk.listPending(two.runId)).map(approval => approval.id)).toEqual([two.approvalId]);

    await test.runtime.core.cancelTask(otherTask);
    await test.runtime.core.waitForTask(test.taskId);
    await test.runtime.core.waitForTask(otherTask);
    expect(test.desk.pendingWaiterCount).toBe(0);
  });
});
