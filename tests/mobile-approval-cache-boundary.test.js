// F-080 — approval data must never enter a browser-managed cache.
// ==============================================================================
//
// This suite pins both browser cache layers that are outside app.js ownership:
//
//   1. the service worker has an approval-specific bypass that remains effective
//      independently of its broader /m1 and non-GET guards; and
//   2. every HTTP response for an approval route carries Cache-Control: no-store,
//      including authorization, body-validation, and handler error paths.
//
// The client-side fetch cache mode is owned and tested by WP-MOBILE-019.
//
// ==============================================================================

import { strict as assert } from 'node:assert';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

import { runMigrations } from '../src/db/migrate.js';
import { startMobileGateway } from '../src/mobile/gateway.js';
import { handleApprovalDecide, handleApprovals } from '../src/mobile/handlers.js';
import { OperationJournal } from '../src/mobile/operation-journal.js';
import { createPairingCode } from '../src/mobile/pairing.js';
import { OfflineUpstream } from '../src/mobile/upstream.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.log(`  ✗ ${name}: ${error.message}`);
  }
}

console.log('\n=== Mobile approval cache boundary ===');

const serviceWorkerSource = readFileSync(
  new URL('../src/mobile/client/sw.js', import.meta.url),
  'utf8',
);

function loadServiceWorker(source) {
  const listeners = new Map();
  const cacheCalls = [];
  const fetchCalls = [];
  const cachedResponse = { ok: true, clone() { return this; } };

  const cache = {
    async addAll(requests) { cacheCalls.push(['addAll', [...requests]]); },
    async put(request, response) { cacheCalls.push(['put', request, response]); },
  };
  const caches = {
    async open(name) { cacheCalls.push(['open', name]); return cache; },
    async match(request) { cacheCalls.push(['match', request]); return null; },
    async keys() { cacheCalls.push(['keys']); return []; },
    async delete(name) { cacheCalls.push(['delete', name]); return true; },
  };
  const self = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  const fetch = async request => {
    fetchCalls.push(request);
    return cachedResponse;
  };

  vm.runInNewContext(source, { URL, caches, fetch, self }, { filename: 'sw.js' });

  return {
    cacheCalls,
    fetchCalls,
    async dispatchFetch(url, method) {
      let responsePromise = null;
      const event = {
        request: { url, method },
        respondWith(value) { responsePromise = Promise.resolve(value); },
      };
      listeners.get('fetch')(event);
      if (responsePromise) await responsePromise;
      return { intercepted: responsePromise !== null };
    },
  };
}

function withoutBroadApiGuards(source) {
  const apiGuard = "  if (url.pathname.startsWith('/m1')) return;\n";
  const nonGetGuard = "  if (event.request.method !== 'GET') return;\n";
  assert.ok(source.includes(apiGuard), 'the broad /m1 guard fixture changed');
  assert.ok(source.includes(nonGetGuard), 'the broad non-GET guard fixture changed');
  return source.replace(apiGuard, '').replace(nonGetGuard, '');
}

await test('approval list and decision bypass CacheStorage in the shipped service worker', async () => {
  const worker = loadServiceWorker(serviceWorkerSource);

  for (const [url, method] of [
    ['https://mobile.test/m1/approvals?refresh=1', 'GET'],
    ['https://mobile.test/m1/approvals/ap-1/decide', 'POST'],
  ]) {
    const before = worker.cacheCalls.length;
    const result = await worker.dispatchFetch(url, method);
    assert.equal(result.intercepted, false, `${method} ${url} must stay outside respondWith`);
    assert.equal(worker.cacheCalls.length, before, `${method} ${url} touched CacheStorage`);
  }
});

await test('approval bypass is explicit rather than an accidental consequence of broad guards', async () => {
  // Removing the generic API and method guards models a future shell-cache
  // refactor. Approval routes must still remain outside respondWith/CacheStorage.
  const worker = loadServiceWorker(withoutBroadApiGuards(serviceWorkerSource));

  for (const [url, method] of [
    ['https://mobile.test/m1/approvals', 'GET'],
    ['https://mobile.test/m1/approvals/ap-1/decide', 'POST'],
  ]) {
    const before = worker.cacheCalls.length;
    const result = await worker.dispatchFetch(url, method);
    assert.equal(result.intercepted, false, `${method} ${url} lacks a dedicated approval bypass`);
    assert.equal(worker.cacheCalls.length, before, `${method} ${url} reached CacheStorage`);
  }
});

const runtimeDir = mkdtempSync(path.join(tmpdir(), 'is-approval-cache-'));
const db = new Database(path.join(runtimeDir, 'approval-cache.sqlite'));
db.pragma('journal_mode = WAL');
await runMigrations(db);

const env = { ...process.env, C3_MOBILE_PAIRING: 'on', C3_MOBILE_UI: 'off' };
const gateway = await startMobileGateway({
  rawDb: db,
  host: '127.0.0.1',
  port: 0,
  upstream: new OfflineUpstream(),
  journal: new OperationJournal(db),
  env,
  logger: { error: () => {}, warn: () => {}, info: () => {} },
});

async function call(pathname, {
  method = 'GET', token = null, body = undefined, rawBody = undefined, headers = {},
} = {}) {
  const requestHeaders = { ...headers };
  if (token) requestHeaders.authorization = `Bearer ${token}`;

  let requestBody;
  if (rawBody !== undefined) {
    requestHeaders['content-type'] = 'application/json';
    requestBody = rawBody;
  } else if (body !== undefined) {
    requestHeaders['content-type'] = 'application/json';
    requestBody = JSON.stringify(body);
  }

  const response = await fetch(gateway.url + pathname, {
    method,
    headers: requestHeaders,
    body: requestBody,
  });
  let json = null;
  try { json = await response.json(); } catch { /* no JSON body */ }
  return { status: response.status, body: json, headers: response.headers };
}

async function pairDevice(scopes) {
  const issued = createPairingCode(db, { scopes, ttlMs: 60_000 });
  const claimed = await call('/m1/pair/claim', {
    method: 'POST', body: { code: issued.code, deviceName: 'cache boundary test' },
  });
  assert.equal(claimed.status, 200, `pairing failed: ${JSON.stringify(claimed.body)}`);
  return claimed.body.data;
}

function assertNoStore(response, label) {
  assert.equal(response.headers.get('cache-control'), 'no-store', `${label} may enter the HTTP cache`);
}

try {
  const device = await pairDevice(['read:approvals', 'write:approvals']);
  const readOnlyDevice = await pairDevice(['read:approvals']);
  const approvalId = 'approval-cache-1';
  const fingerprint = 'f'.repeat(64);

  db.prepare(`
    INSERT INTO mobile_approvals
      (id, subject_type, subject_id, title, detail, payload_fingerprint, expires_at)
    VALUES (?, 'task_run', 'run-cache-1', 'Cache boundary', 'Sensitive approval', ?, '2099-01-01 00:00:00')
  `).run(approvalId, fingerprint);

  await test('approval handlers declare no-store without changing their bodies', async () => {
    const principal = { deviceId: device.deviceId, name: 'cache boundary test', scopes: device.scopes };
    const listed = await handleApprovals({ rawDb: db, principal });
    assert.equal(listed.headers['Cache-Control'], 'no-store');
    assert.equal(listed.body.ok, true);
    assert.equal(listed.body.data[0].id, approvalId);

    const invalid = await handleApprovalDecide({
      rawDb: db,
      journal: gateway.journal,
      principal,
      params: { id: approvalId },
      body: { decision: 'later' },
    });
    assert.equal(invalid.headers['Cache-Control'], 'no-store');
    assert.equal(invalid.body.error.code, 'bad_request');
  });

  await test('approval list success is no-store', async () => {
    const response = await call('/m1/approvals', { token: device.token });
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.data[0].id, approvalId);
    assertNoStore(response, 'GET /m1/approvals 200');
  });

  await test('approval authorization failures are no-store', async () => {
    const missing = await call('/m1/approvals');
    assert.equal(missing.status, 401);
    assertNoStore(missing, 'GET /m1/approvals 401');

    const missingScope = await call(`/m1/approvals/${approvalId}/decide`, {
      method: 'POST', token: readOnlyDevice.token, body: {},
    });
    assert.equal(missingScope.status, 403);
    assertNoStore(missingScope, 'POST /m1/approvals/:id/decide 403');
  });

  await test('approval decision body-validation errors are no-store', async () => {
    const response = await call(`/m1/approvals/${approvalId}/decide`, {
      method: 'POST', token: device.token, rawBody: '{',
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'bad_request');
    assertNoStore(response, 'malformed approval decision');
  });

  await test('approval decision handler errors are no-store', async () => {
    const invalidDecision = await call(`/m1/approvals/${approvalId}/decide`, {
      method: 'POST', token: device.token,
      body: { decision: 'later', operationId: 'cache-error-operation-01', payloadFingerprint: fingerprint },
    });
    assert.equal(invalidDecision.status, 400);
    assertNoStore(invalidDecision, 'invalid approval decision');

    const missingApproval = await call('/m1/approvals/does-not-exist/decide', {
      method: 'POST', token: device.token,
      body: { decision: 'approve', operationId: 'cache-error-operation-02', payloadFingerprint: fingerprint },
    });
    assert.equal(missingApproval.status, 404);
    assertNoStore(missingApproval, 'missing approval decision');
  });

  await test('approval decision success and replay are no-store', async () => {
    const body = {
      decision: 'approve',
      operationId: 'cache-success-operation-01',
      payloadFingerprint: fingerprint,
    };
    const decided = await call(`/m1/approvals/${approvalId}/decide`, {
      method: 'POST', token: device.token, body,
    });
    assert.equal(decided.status, 200);
    assert.equal(decided.body.data.state, 'CONFIRMED');
    assertNoStore(decided, 'approval decision 200');

    const replayed = await call(`/m1/approvals/${approvalId}/decide`, {
      method: 'POST', token: device.token, body,
    });
    assert.equal(replayed.status, 200);
    assert.equal(replayed.body.replayed, true);
    assertNoStore(replayed, 'approval decision replay');
  });

  await test('unexpected approval handler failures are no-store', async () => {
    db.exec('ALTER TABLE mobile_approvals RENAME TO mobile_approvals_cache_test_hidden');
    try {
      const response = await call('/m1/approvals', { token: device.token });
      assert.equal(response.status, 500);
      assert.equal(response.body.error.code, 'internal_error');
      assertNoStore(response, 'approval handler 500');
    } finally {
      db.exec('ALTER TABLE mobile_approvals_cache_test_hidden RENAME TO mobile_approvals');
    }
  });

  await test('no-store remains scoped to approval routes', async () => {
    const health = await call('/m1/health');
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('cache-control'), null);
  });
} finally {
  await gateway.stop();
  try { db.close(); } catch { /* already closed */ }
  rmSync(runtimeDir, { recursive: true, force: true });
}

console.log(`\nMobile approval cache boundary: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
