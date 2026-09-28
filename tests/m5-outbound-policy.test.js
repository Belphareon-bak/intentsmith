#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import Database from 'better-sqlite3';

import { suite, summary, test, testAsync } from './harness.js';
import {
  EXPECTED_M5_OUTBOUND_AUDIT_FINGERPRINT_V089,
  computeM5OutboundAuditFingerprintV089,
  up as applyOutboundAudit,
} from '../src/db/migrations/2026_08_26_089_m5_outbound_audit.js';
import {
  OUTBOUND_ERROR_CODE,
  createOutboundPolicy,
} from '../src/network/outbound-policy.js';

function harness({ enabled = false, transport } = {}) {
  const database = new Database(':memory:');
  applyOutboundAudit(database);
  let now = Date.parse('2026-08-26T15:00:00.000Z');
  let id = 0;
  const logs = [];
  const logger = {
    warn: (component, message, data) => logs.push({ level: 'warn', component, message, data }),
    error: (component, message, data) => logs.push({ level: 'error', component, message, data }),
  };
  const calls = [];
  const policy = createOutboundPolicy({
    database,
    logger,
    clock: () => ++now,
    idFactory: () => `event-${++id}`,
    enabledSurfaces: { 'model-discovery': enabled },
    transport: transport || (async (input, init) => {
      calls.push({ input: String(input), init });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  });
  return { database, logs, calls, policy };
}

suite('M5 outbound policy and append-only audit');

await testAsync('provider release metadata has an exact distinct capability, audit and opt-out', async () => {
  const { database, calls, policy } = harness({ enabled: true });
  const target = 'https://api.github.com/repos/ollama/ollama/releases/latest';
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'intentsmith/1.0' };
  await policy.ollamaReleaseFetch(target, { headers });
  assert.equal(calls.length, 1);
  assert.deepEqual(database.prepare('SELECT phase, scope, decision FROM m5_outbound_audit_events ORDER BY occurred_at_ms').all(), [
    { phase: 'decision', scope: 'provider.release.read', decision: 'allow' },
    { phase: 'terminal', scope: 'provider.release.read', decision: 'succeeded' },
  ]);
  for (const [url, init] of [
    [target + '?private=data', { headers }], [target + '#secret', { headers }],
    [target.replace('/latest', ''), { headers }],
    [target.replace('/ollama/ollama/', '/other/repo/'), { headers }],
    [target, { headers, method: 'POST' }], [target, { headers, body: 'secret' }],
    [target, { headers: { ...headers, Authorization: 'secret' } }],
    ['https://ollama.com/library', { headers }],
  ]) await assert.rejects(policy.ollamaReleaseFetch(url, init), error => error.code === OUTBOUND_ERROR_CODE.TARGET_CONTRACT_DENIED);
  await assert.rejects(policy.modelDiscoveryFetch(target, { headers }), error => error.code === OUTBOUND_ERROR_CODE.TARGET_CONTRACT_DENIED);
  await assert.rejects(policy.fetch(target, { headers }), error => error.code === OUTBOUND_ERROR_CODE.SCOPE_REQUIRED);
  assert.equal(calls.length, 1);
  const disabled = harness();
  await assert.rejects(disabled.policy.ollamaReleaseFetch(target, { headers }), error => error.code === OUTBOUND_ERROR_CODE.SURFACE_DISABLED);
  assert.equal(disabled.calls.length, 0);
  let redirects = 0;
  const redirected = harness({ enabled: true, transport: async () => {
    redirects++;
    return new Response(null, { status: 302, headers: { location: 'https://evil.test' } });
  } });
  await assert.rejects(redirected.policy.ollamaReleaseFetch(target, { headers }), error => error.code === OUTBOUND_ERROR_CODE.TARGET_CONTRACT_DENIED);
  assert.equal(redirects, 1);
});

await testAsync('hunt tag metadata is audited and bounded to the library family', async () => {
  const { database, calls, policy } = harness({ enabled: true });
  const target = 'https://ollama.com/library/devstral-small-2/tags';
  const response = await policy.modelDiscoveryFetch(target, {
    headers: { 'User-Agent': 'intentsmith/1.0' },
  });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.deepEqual(database.prepare(
    'SELECT phase, decision FROM m5_outbound_audit_events ORDER BY occurred_at_ms',
  ).all(), [
    { phase: 'decision', decision: 'allow' },
    { phase: 'terminal', decision: 'succeeded' },
  ]);
  for (const [url, init] of [
    [target + '?data=private', {}],
    [target + '/extra', {}],
    [target + '#private', {}],
    ['https://ollama.com/api/tags', {}],
    [target, { method: 'POST' }],
    [target, { body: 'private' }],
    [target, { headers: { Authorization: 'Bearer private' } }],
  ]) {
    await assert.rejects(policy.modelDiscoveryFetch(url, init),
      error => error.code === OUTBOUND_ERROR_CODE.TARGET_CONTRACT_DENIED);
  }
  assert.equal(calls.length, 1);
  const disabled = harness();
  await assert.rejects(disabled.policy.modelDiscoveryFetch(target, {}),
    error => error.code === OUTBOUND_ERROR_CODE.SURFACE_DISABLED);
  assert.equal(disabled.calls.length, 0);
});

test('migration installs the exact fingerprinted audit authority', () => {
  const { database } = harness();
  assert.equal(
    computeM5OutboundAuditFingerprintV089(database),
    EXPECTED_M5_OUTBOUND_AUDIT_FINGERPRINT_V089,
  );
});

await testAsync('loopback remains local and never enters the outbound audit', async () => {
  const { database, calls, policy } = harness();
  const response = await policy.fetch('http://127.0.0.1:11434/api/tags');
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(database.prepare('SELECT count(*) AS count FROM m5_outbound_audit_events').get().count, 0);
});

await testAsync('unscoped external request is durably denied before transport without leaking its URL', async () => {
  const { database, calls, policy } = harness();
  await assert.rejects(
    policy.fetch('https://example.test/private?token=MUST_NOT_PERSIST'),
    error => error.code === OUTBOUND_ERROR_CODE.SCOPE_REQUIRED,
  );
  assert.equal(calls.length, 0);
  const rows = database.prepare('SELECT * FROM m5_outbound_audit_events').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].decision, 'deny');
  assert.equal(rows[0].surface, 'unscoped');
  assert.equal(rows[0].scope, 'none');
  assert.equal(rows[0].target_origin, 'https://example.test');
  assert.doesNotMatch(JSON.stringify(rows), /private|MUST_NOT_PERSIST|token/);
});

await testAsync('model discovery needs both explicit opt-in and its exact scope', async () => {
  const disabled = harness({ enabled: false });
  await assert.rejects(
    disabled.policy.modelDiscoveryFetch(
      'https://ollama.com/library',
      {},
    ),
    error => error.code === OUTBOUND_ERROR_CODE.SURFACE_DISABLED,
  );
  assert.equal(disabled.calls.length, 0);

  const enabled = harness({ enabled: true });
  const response = await enabled.policy.modelDiscoveryFetch(
    'https://huggingface.co/api/models?search=qwen&limit=10&sort=downloads&direction=-1',
    {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': 'intentsmith/1.0', Accept: 'application/json' },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(enabled.calls.length, 1);
  assert.equal(enabled.calls[0].init.redirect, 'manual');
  const events = enabled.database.prepare(`
    SELECT phase, decision, target_origin AS targetOrigin, http_status AS httpStatus
    FROM m5_outbound_audit_events ORDER BY occurred_at_ms
  `).all();
  assert.deepEqual(events, [
    { phase: 'decision', decision: 'allow', targetOrigin: 'https://huggingface.co', httpStatus: null },
    { phase: 'terminal', decision: 'succeeded', targetOrigin: 'https://huggingface.co', httpStatus: 200 },
  ]);
});

await testAsync('origin, method and redirects are independently fail-closed', async () => {
  const wrongOrigin = harness({ enabled: true });
  await assert.rejects(
    wrongOrigin.policy.modelDiscoveryFetch('https://example.com/models', {}),
    error => error.code === OUTBOUND_ERROR_CODE.TARGET_CONTRACT_DENIED,
  );
  assert.equal(wrongOrigin.calls.length, 0);

  const wrongMethod = harness({ enabled: true });
  await assert.rejects(
    wrongMethod.policy.modelDiscoveryFetch('https://ollama.com/library', { method: 'POST' }),
    error => error.code === OUTBOUND_ERROR_CODE.TARGET_CONTRACT_DENIED,
  );
  assert.equal(wrongMethod.calls.length, 0);

  let redirectCalls = 0;
  const redirected = harness({
    enabled: true,
    transport: async () => {
      redirectCalls += 1;
      return new Response(null, { status: 302, headers: { location: 'https://evil.test/' } });
    },
  });
  await assert.rejects(
    redirected.policy.modelDiscoveryFetch(
      'https://whatllm.org',
      { headers: { Accept: 'text/html' } },
    ),
    error => error.code === OUTBOUND_ERROR_CODE.TARGET_CONTRACT_DENIED,
  );
  assert.equal(redirectCalls, 1);
  assert.deepEqual(
    redirected.database.prepare('SELECT phase, decision, reason_code AS reasonCode FROM m5_outbound_audit_events ORDER BY occurred_at_ms').all(),
    [
      { phase: 'decision', decision: 'allow', reasonCode: 'OUTBOUND_POLICY_ALLOWED' },
      { phase: 'decision', decision: 'deny', reasonCode: 'OUTBOUND_TARGET_CONTRACT_DENIED' },
      { phase: 'terminal', decision: 'failed', reasonCode: 'OUTBOUND_TARGET_CONTRACT_DENIED' },
    ],
  );
});

await testAsync('an allowed redirect receives a second exact decision before transport', async () => {
  const calls = [];
  const redirected = harness({
    enabled: true,
    transport: async (input, init) => {
      calls.push({ input: String(input), redirect: init.redirect });
      if (calls.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: '/library/qwen3' },
        });
      }
      return new Response('{}', { status: 200 });
    },
  });
  const response = await redirected.policy.modelDiscoveryFetch('https://ollama.com/library');
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    { input: 'https://ollama.com/library', redirect: 'manual' },
    { input: 'https://ollama.com/library/qwen3', redirect: 'manual' },
  ]);
  assert.deepEqual(
    redirected.database.prepare(`
      SELECT phase, decision, target_origin AS targetOrigin, reason_code AS reasonCode
      FROM m5_outbound_audit_events ORDER BY occurred_at_ms
    `).all(),
    [
      {
        phase: 'decision', decision: 'allow', targetOrigin: 'https://ollama.com',
        reasonCode: 'OUTBOUND_POLICY_ALLOWED',
      },
      {
        phase: 'decision', decision: 'allow', targetOrigin: 'https://ollama.com',
        reasonCode: 'OUTBOUND_POLICY_ALLOWED',
      },
      {
        phase: 'terminal', decision: 'succeeded', targetOrigin: 'https://ollama.com',
        reasonCode: 'OUTBOUND_REQUEST_COMPLETED',
      },
    ],
  );
});

await testAsync('loopback redirect cannot escape before a new audited policy decision', async () => {
  const targets = [];
  const redirected = harness({
    enabled: true,
    transport: async (input, init) => {
      targets.push({ input: String(input), redirect: init.redirect });
      return new Response(null, {
        status: 302,
        headers: { location: 'http://192.0.2.10/private' },
      });
    },
  });
  await assert.rejects(
    redirected.policy.fetch('http://127.0.0.1:11434/api/tags'),
    error => error.code === OUTBOUND_ERROR_CODE.SCOPE_REQUIRED,
  );
  assert.deepEqual(targets, [{
    input: 'http://127.0.0.1:11434/api/tags',
    redirect: 'manual',
  }]);
  assert.deepEqual(
    redirected.database.prepare(`
      SELECT phase, decision, target_origin AS targetOrigin, reason_code AS reasonCode
      FROM m5_outbound_audit_events ORDER BY occurred_at_ms
    `).all(),
    [
      {
        phase: 'decision',
        decision: 'deny',
        targetOrigin: 'http://192.0.2.10',
        reasonCode: 'OUTBOUND_SCOPE_REQUIRED',
      },
      {
        phase: 'terminal',
        decision: 'failed',
        targetOrigin: 'http://192.0.2.10',
        reasonCode: 'OUTBOUND_SCOPE_REQUIRED',
      },
    ],
  );
});

await testAsync('string-literal metadata and endpoint/header overreach cannot forge authority', async () => {
  for (const probe of [
    {
      url: 'https://huggingface.co/unrelated',
      init: { headers: { Authorization: 'Bearer stolen' } },
      modelDiscovery: true,
      code: OUTBOUND_ERROR_CODE.TARGET_CONTRACT_DENIED,
    },
    {
      url: 'https://huggingface.co/api/models?search=qwen&limit=10&sort=downloads&direction=-1',
      init: { headers: { 'User-Agent': 'intentsmith/1.0', Accept: 'application/json' } },
      authority: { surface: 'model-discovery', scope: 'model.metadata.read' },
      code: OUTBOUND_ERROR_CODE.SCOPE_REQUIRED,
    },
    {
      url: 'https://ollama.com/library?q=secret',
      init: {},
      modelDiscovery: true,
      code: OUTBOUND_ERROR_CODE.TARGET_CONTRACT_DENIED,
    },
    {
      url: 'https://ollama.com/library',
      init: { method: 'GET', body: 'forged' },
      modelDiscovery: true,
      code: OUTBOUND_ERROR_CODE.TARGET_CONTRACT_DENIED,
    },
  ]) {
    const value = harness({ enabled: true });
    await assert.rejects(
      probe.modelDiscovery
        ? value.policy.modelDiscoveryFetch(probe.url, probe.init)
        : value.policy.fetch(probe.url, probe.init, probe.authority),
      error => error.code === probe.code,
    );
    assert.equal(value.calls.length, 0);
  }
});

await testAsync('audit authority is append-only', async () => {
  const { database, policy } = harness();
  await assert.rejects(policy.fetch('https://example.test/'));
  assert.throws(
    () => database.prepare('UPDATE m5_outbound_audit_events SET scope = scope').run(),
    /append-only/,
  );
  assert.throws(
    () => database.prepare('DELETE FROM m5_outbound_audit_events').run(),
    /append-only/,
  );
});

test('production installs the guard before optional/background services initialize', () => {
  const source = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const configureAt = source.indexOf('configureProductionOutboundPolicy({');
  const installAt = source.indexOf('installProductionOutboundGuard();');
  const notificationsAt = source.indexOf('initNotificationTables(db.db);');
  const schedulerAt = source.indexOf('agentScheduler.start();');
  assert(configureAt > 0 && installAt > configureAt);
  assert(installAt < notificationsAt);
  assert(schedulerAt < 0 || installAt < schedulerAt);
  assert.equal((source.match(/installProductionOutboundGuard\(\)/g) || []).length, 1);
  const capturedFetches = [];
  for (const file of [
    '../src/server.js',
    '../src/agents/runner.js',
    '../src/tools/registry.js',
    '../src/notifications/channels/webhook.js',
  ]) {
    const body = readFileSync(new URL(file, import.meta.url), 'utf8');
    if (/(?:const|let|var)\s+\w*[Ff]etch\w*\s*=\s*(?:globalThis\.)?fetch/.test(body)) {
      capturedFetches.push(file);
    }
  }
  assert.deepEqual(capturedFetches, []);
});

summary();
