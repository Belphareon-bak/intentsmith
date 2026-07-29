import { afterEach, describe, expect, it } from 'vitest';

import { chatRecord, fixtureTransport, fixtures } from '@intentsmith/adapter-ollama/fixtures';
import type { AuditEvent } from '@intentsmith/contracts';
import { ApprovalLedger } from '@intentsmith/core';
import { openIntentSmithDatabase } from '@intentsmith/persistence';
import { DeterministicIdGenerator, FakeClock } from '@intentsmith/testing';
import { assertNoTokenLeak } from '@intentsmith/worker-sdk';

import { buildGateway } from '../gateway/gateway.js';
import { GatewayTokenStore } from '../gateway/token-store.js';
import { createTestServerRuntime } from '../test-runtime.js';
import { createGitChangeEvidenceCollector } from './change-evidence.js';
import { harness as buildHarness, repository, type Scenario } from './fixtures.js';
import { RunEvidenceRecorder, assertStructuredMetadata } from './run-evidence.js';

/**
 * What the audit trail can answer after a run has ended.
 *
 * The claims here are all about durability and attribution: that the grant
 * lifecycle, the profile a turn ran under and the bounded protocol-attempt
 * ledger survive the process, that each is attached to the run it describes,
 * and that none of them carries a prompt, a model response, a wire message or a
 * token. A callback that observed the right thing and wrote nothing down would
 * pass none of these.
 */

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const harness = async (options: Scenario = {}) => await buildHarness(cleanups, options);

/** Records every token the run-scoped issuer hands out, so leaks are provable. */
function watchTokens(runtime: { gatewayTokens: GatewayTokenStore }): string[] {
  const issued: string[] = [];
  const store = runtime.gatewayTokens;
  const original = store.issue.bind(store);
  store.issue = (runId: string, taskId?: string, ttlMs?: number) => {
    const token = original(runId, taskId, ttlMs);
    issued.push(token.value);
    return token;
  };
  return issued;
}

const byType = (audit: AuditEvent[], type: string): AuditEvent[] =>
  audit.filter(event => event.type === type);

describe('grant lifecycle evidence', () => {
  it('reaches the audit repository, attributed to its run, carrying no token', async () => {
    const test = await harness();
    const issued = watchTokens(test.runtime);
    const { audit, status } = await test.run();
    expect(status).toBe('passed');
    expect(issued).toHaveLength(1);

    const grants = byType(audit, 'security.grant');
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      taskId: test.taskId,
      runId: expect.stringMatching(/^run_/),
      data: { outcome: 'success', revoked: true },
    });
    expect(grants[0]?.data).toMatchObject({
      issuedAt: expect.any(String),
      revokedAt: expect.any(String),
    });

    // The whole persisted trail, not just the grant record.
    for (const token of issued) assertNoTokenLeak(audit, token);
    expect(JSON.stringify(grants)).not.toMatch(/token/i);
  });

  it('records the terminal outcome on a failing run too', async () => {
    const test = await harness({ behaviour: 'crashes' });
    const { audit } = await test.run();

    const grants = byType(audit, 'security.grant');
    expect(grants).toHaveLength(1);
    expect(grants[0]?.data.revoked).toBe(true);
    expect(grants[0]?.data.outcome).not.toBe('success');
  });

  it('records the supervised process-group leader, and nothing else about it', async () => {
    const test = await harness();
    const { audit } = await test.run();

    const started = byType(audit, 'worker.process_start');
    expect(started).toHaveLength(1);
    expect(Object.keys(started[0]?.data ?? {})).toEqual(['pid']);
    expect(typeof started[0]?.data.pid).toBe('number');
  });
});

describe('audit ordering supports the approval and lifecycle claims', () => {
  it('orders request, grant, use, grant revocation and verdict', async () => {
    const test = await harness();
    const { audit } = await test.run();
    const order = audit.map(event => event.type);

    expect(order.indexOf('worker.process_start')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('worker.process_start')).toBeLessThan(order.indexOf('approval.requested'));
    expect(order.indexOf('approval.requested')).toBeLessThan(order.indexOf('approval.granted'));
    expect(order.indexOf('approval.granted')).toBeLessThan(order.indexOf('approval.consumed'));
    // The grant is revoked before the workspace is even inspected, so the
    // verdict cannot be reached while a live token still exists.
    expect(order.indexOf('approval.consumed')).toBeLessThan(order.indexOf('security.grant'));
    expect(order.indexOf('security.grant')).toBeLessThan(order.lastIndexOf('task.verdict'));
  });

  it('persists no prompt, model response, wire message or unbounded field', async () => {
    const test = await harness();
    const { audit } = await test.run();

    const lifecycle = audit.filter(event =>
      ['security.grant', 'worker.process_start', 'inference.profile', 'inference.protocol_attempt'].includes(
        event.type,
      ),
    );
    expect(lifecycle.length).toBeGreaterThan(0);
    for (const event of lifecycle) {
      // Bounded, named, primitive fields only: an accidental dump of a callback
      // argument cannot satisfy this.
      expect(() => assertStructuredMetadata(event.data)).not.toThrow();
    }

    // The task goal is what the agent was prompted with, and the agent's own
    // reply text appears in its worker evidence. Neither may reach a lifecycle
    // record, and no ACP wire frame may reach the audit at all.
    const serialized = JSON.stringify(lifecycle);
    expect(serialized).not.toContain('Change src/answer.js');
    expect(serialized).not.toMatch(/jsonrpc|session\/update|session\/request_permission/);
    expect(byType(audit, 'worker.wire')).toEqual([]);
  });
});

describe('inference evidence through the gateway', () => {
  const readTool = {
    type: 'function' as const,
    function: { name: 'read', description: 'Read a file', parameters: { type: 'object', properties: {} } },
  };

  /** A gateway whose lifecycle sink is a real recorder over a real database. */
  function persistingGateway(routes: Parameters<typeof fixtureTransport>[0] = {}) {
    const store = openIntentSmithDatabase(':memory:');
    cleanups.push(() => store.close());
    const recorder = new RunEvidenceRecorder({
      audit: store,
      clock: new FakeClock(),
      ids: new DeterministicIdGenerator(),
    });
    recorder.beginRun('run_1', 'task_1', () => undefined);
    // A second live run, so attribution has something to get wrong.
    recorder.beginRun('run_2', 'task_2', () => undefined);

    const tokens = new GatewayTokenStore();
    const runtime = createTestServerRuntime({
      core: undefined as never,
      transport: fixtureTransport(routes),
      gatewayTokens: tokens,
      workerEvidence: recorder,
    });
    const app = buildGateway({ runtime, tokens, now: () => 1_780_000_000_000 });
    cleanups.push(() => app.close());
    return { app, tokens, recorder, store };
  }

  const post = async (
    app: ReturnType<typeof buildGateway>,
    token: string,
    body: Record<string, unknown>,
  ) =>
    await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${token}` },
      payload: { model: 'qwen3:14b', messages: [{ role: 'user', content: 'hi' }], ...body },
    });

  it('associates the effective profile with the run that made the turn', async () => {
    const { app, tokens, recorder, store } = persistingGateway({
      chat: fixtures.jsonResponse(200, chatRecord({ toolCalls: [{ name: 'read', arguments: {} }] })),
    });
    const token = tokens.issue('run_1', 'task_1').value;

    const response = await post(app, token, { tools: [readTool], max_tokens: 100_000, temperature: 1.5 });
    expect(response.statusCode).toBe(200);
    await recorder.flush();

    const mine = byType(await store.listByTask('task_1'), 'inference.profile');
    const theirs = byType(await store.listByTask('task_2'), 'inference.profile');
    expect(theirs).toEqual([]);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.runId).toBe('run_1');
    expect(mine[0]?.data).toMatchObject({
      modelId: 'qwen3:14b',
      // Phase 3 profiles are provisional until runtime evidence promotes them.
      profileStatus: 'PROVISIONAL',
      // qwen3:14b passed its scenarios only with thinking disabled, and no
      // worker request may turn it back on. This is the negative regression.
      think: false,
      maxOutputTokens: 512,
      temperature: 0,
      toolProtocol: 'structured',
    });
    expect(mine[0]?.data.overruled).toEqual(expect.arrayContaining(['max_tokens', 'temperature']));
    // Nothing the model or the client wrote is in the record: not the prompt,
    // not the advertised toolset, not the call the model made.
    expect(Object.keys(mine[0]?.data ?? {}).sort()).toEqual([
      'maxOutputTokens',
      'modelId',
      'overruled',
      'profileStatus',
      'role',
      'temperature',
      'think',
      'toolProtocol',
    ]);
  });

  it('records the bounded retry decision and attempt number, with no model text', async () => {
    // A model that writes its call as prose, twice: one retry is allowed
    // because no tool turn was consumed, and the second is refused.
    const pseudoCall = chatRecord({ content: 'let me look.\n<function=read>\n' });
    const { app, tokens, recorder, store } = persistingGateway({
      chat: async () => fixtures.jsonResponse(200, pseudoCall),
    });
    const token = tokens.issue('run_1', 'task_1').value;

    const response = await post(app, token, { tools: [readTool] });
    expect(response.json().error.code).toBe('MODEL_TOOL_PROTOCOL_ERROR');
    await recorder.flush();

    const attempts = byType(await store.listByTask('task_1'), 'inference.protocol_attempt');
    expect(attempts.map(event => [event.data.attempt, event.data.retryDecision])).toEqual([
      [1, 'allowed'],
      [2, 'refused'],
    ]);
    expect(attempts[0]?.data).toMatchObject({
      outcome: 'error',
      errorCode: 'MODEL_TOOL_PROTOCOL_ERROR',
      sideEffectEvidence: 'proven_absent',
    });
    expect(attempts.every(event => event.runId === 'run_1')).toBe(true);
    // The refusal reason is IntentSmith's own sentence about its own rule.
    expect(attempts[1]?.data.reason).toMatch(/already consumed/);
    // The model's call-shaped prose is nowhere in the persisted evidence.
    expect(JSON.stringify(attempts)).not.toContain('<function=read>');
    expect(JSON.stringify(attempts)).not.toContain('let me look');
  });
});

describe('structured-metadata enforcement', () => {
  it('refuses a nested object, an oversized string and a non-string array', () => {
    expect(() => assertStructuredMetadata({ ok: 'yes', count: 1, flag: true, list: ['a'] })).not.toThrow();
    expect(() => assertStructuredMetadata({ dumped: { nested: true } })).toThrow(/bounded structured metadata/);
    expect(() => assertStructuredMetadata({ transcript: 'x'.repeat(501) })).toThrow(/longer than/);
    expect(() => assertStructuredMetadata({ mixed: [1, 2] })).toThrow(/bounded structured metadata/);
  });
});

describe('audit persistence failure is not silently discarded', () => {
  it('records the failure against the run instead of losing the evidence', async () => {
    const failures: string[] = [];
    const recorder = new RunEvidenceRecorder({
      audit: {
        append: async () => {
          throw new Error('disk is gone');
        },
        listByTask: async () => [],
      },
      clock: new FakeClock(),
      ids: new DeterministicIdGenerator(),
    });
    recorder.beginRun('run_1', 'task_1', () => undefined);
    recorder.grantSettled({
      runId: 'run_1',
      taskId: 'task_1',
      outcome: 'success',
      revoked: true,
      issuedAt: '2026-07-27T00:00:00.000Z',
      revokedAt: '2026-07-27T00:00:01.000Z',
    });
    await recorder.flush();

    failures.push(...(recorder.provenanceFor('run_1')?.auditFailures ?? []));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/security\.grant evidence could not be persisted/);
    // The reference is still recorded, so the gap is visible rather than absent.
    expect(recorder.provenanceFor('run_1')?.evidenceRefs.grantAuditIds).toHaveLength(1);
  });

  it('makes change evidence unacceptable when a grant record could not be written', async () => {
    // Git, the gates and the approval ledger all work here. The only thing that
    // failed is the security audit write, and that alone is enough: a run whose
    // evidence is incomplete is a run nobody can review, so it cannot pass.
    const fixture = repository(cleanups);
    const store = openIntentSmithDatabase(':memory:');
    cleanups.push(() => store.close());
    const clock = new FakeClock();
    const ids = new DeterministicIdGenerator();
    const recorder = new RunEvidenceRecorder({
      audit: {
        append: async () => {
          throw new Error('disk is gone');
        },
        listByTask: async () => [],
      },
      clock,
      ids,
    });
    recorder.beginRun('run_1', 'task_1', () => undefined);
    recorder.grantSettled({
      runId: 'run_1',
      taskId: 'task_1',
      outcome: 'success',
      revoked: true,
      issuedAt: '2026-07-27T00:00:00.000Z',
      revokedAt: '2026-07-27T00:00:01.000Z',
    });

    const collector = createGitChangeEvidenceCollector({
      workspaceRoot: fixture.root,
      approvals: new ApprovalLedger({ approvals: store, audit: store, clock, ids }),
      evidence: recorder,
      gates: [],
      requiredGateIds: [],
      clock,
    });
    const collected = await collector.collect({
      task: { id: 'task_1', type: 'plan' } as never,
      run: { id: 'run_1', taskId: 'task_1' } as never,
    });

    expect(collected.acceptable).toBe(false);
    expect(collected.findings.join(' ')).toMatch(/security\.grant evidence could not be persisted/);
  });
});
