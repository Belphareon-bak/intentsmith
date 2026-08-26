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
  MODEL_DISCOVERY_OUTBOUND_AUTHORITY,
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
    disabled.policy.fetch(
      'https://ollama.com/library',
      {},
      MODEL_DISCOVERY_OUTBOUND_AUTHORITY,
    ),
    error => error.code === OUTBOUND_ERROR_CODE.SURFACE_DISABLED,
  );
  assert.equal(disabled.calls.length, 0);

  const enabled = harness({ enabled: true });
  const response = await enabled.policy.fetch(
    'https://huggingface.co/api/models?search=qwen',
    { method: 'GET', redirect: 'follow' },
    MODEL_DISCOVERY_OUTBOUND_AUTHORITY,
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
    wrongOrigin.policy.fetch('https://example.com/models', {}, MODEL_DISCOVERY_OUTBOUND_AUTHORITY),
    error => error.code === OUTBOUND_ERROR_CODE.ORIGIN_DENIED,
  );
  assert.equal(wrongOrigin.calls.length, 0);

  const wrongMethod = harness({ enabled: true });
  await assert.rejects(
    wrongMethod.policy.fetch('https://ollama.com/library', { method: 'POST' }, MODEL_DISCOVERY_OUTBOUND_AUTHORITY),
    error => error.code === OUTBOUND_ERROR_CODE.METHOD_DENIED,
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
    redirected.policy.fetch('https://whatllm.org', {}, MODEL_DISCOVERY_OUTBOUND_AUTHORITY),
    error => error.code === OUTBOUND_ERROR_CODE.REDIRECT_DENIED,
  );
  assert.equal(redirectCalls, 1);
  assert.deepEqual(
    redirected.database.prepare('SELECT phase, decision, reason_code AS reasonCode FROM m5_outbound_audit_events ORDER BY occurred_at_ms').all(),
    [
      { phase: 'decision', decision: 'allow', reasonCode: 'OUTBOUND_POLICY_ALLOWED' },
      { phase: 'terminal', decision: 'failed', reasonCode: 'OUTBOUND_REDIRECT_DENIED' },
    ],
  );
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
