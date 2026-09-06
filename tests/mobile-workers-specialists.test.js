import './helpers/isolated-test-db.js';

import { strict as assert } from 'node:assert';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { initAgentTables } from '../src/agents/repository.js';
import { runMigrations } from '../src/db/migrate.js';
import { startMobileGateway } from '../src/mobile/gateway.js';
import { handleSpecialists, handleWorkers } from '../src/mobile/handlers.js';
import { createPairingCode } from '../src/mobile/pairing.js';
import { RemoteCorePort, createMobileRemoteCorePort } from '../src/remote-core/port.js';
import { OfflineUpstream } from '../src/mobile/upstream.js';

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✗ ${name}: ${error.message}`);
  }
}

console.log('\n=== Mobile workers and specialists projections ===');

const runtimeDir = mkdtempSync(path.join(tmpdir(), 'is-mobile-workers-'));
const db = new Database(path.join(runtimeDir, 'workers.sqlite'));
db.pragma('journal_mode = WAL');
await runMigrations(db);
initAgentTables(db);

db.prepare(`
  INSERT INTO agents_v33 (id, name, description, icon, definition, state, params, enabled)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  'worker-a', 'Hlídač cen', 'Sleduje změny', 'robot',
  JSON.stringify({ type: 'MONITOR', triggers: [{ secret: 'definition-secret' }] }),
  JSON.stringify({ secret: 'state-secret' }),
  JSON.stringify({ apiKey: 'params-secret' }),
  1,
);
db.prepare(`
  INSERT INTO agent_schedule_v33 (agent_id, next_run, last_run, interval_ms, cron_expression)
  VALUES (?, ?, ?, ?, ?)
`).run('worker-a', '2026-09-05 10:00:00', '2026-09-04 10:00:00', 3600000, null);
db.prepare(`
  INSERT INTO agent_runs_v33
    (agent_id, started_at, finished_at, status, actions_executed, explain, log, error)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  'worker-a', '2026-09-04 09:00:00', '2026-09-04 09:01:00', 'success', 2,
  JSON.stringify({ secret: 'explain-secret' }), 'log-secret', null,
);
db.prepare(`
  INSERT INTO agent_runs_v33 (agent_id, started_at, status, log)
  VALUES (?, ?, 'running', ?)
`).run('worker-a', '2026-09-04 11:00:00', 'untrusted-running-secret');

db.prepare(`
  INSERT INTO specialists
    (id, version, name, domain, type, status, manifest_json, installed_at, enabled_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  'finance-cz', '2.1.0', 'České finance', 'finance', 'domain', 'enabled',
  JSON.stringify({ apiKey: 'manifest-secret', tools: ['private-tool'] }),
  '2026-09-01 08:00:00', '2026-09-02 08:00:00',
);
db.prepare(`
  INSERT INTO specialist_expertises (specialist_id, expertise_id, label, priority)
  VALUES (?, ?, ?, ?), (?, ?, ?, ?)
`).run(
  'finance-cz', 'tax', 'Daně', 2,
  'finance-cz', 'cashflow', 'Cashflow', 1,
);

const gateway = await startMobileGateway({
  rawDb: db,
  host: '127.0.0.1',
  port: 0,
  upstream: new OfflineUpstream(),
  env: { ...process.env, C3_MOBILE_PAIRING: 'on', C3_MOBILE_UI: 'off' },
  logger: { error() {}, warn() {}, info() {} },
});

async function pair(scopes) {
  const issued = createPairingCode(db, { scopes, ttlMs: 60_000 });
  const response = await fetch(gateway.url + '/m1/pair/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: issued.code, deviceName: 'worker-test' }),
  });
  assert.equal(response.status, 200);
  return (await response.json()).data.token;
}

async function get(pathname, token) {
  const response = await fetch(gateway.url + pathname, {
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: response.status, body: await response.json() };
}

try {
  await test('both read scopes are enforced at the route boundary', async () => {
    const token = await pair(['read:capabilities']);
    for (const [pathname, scope] of [
      ['/m1/workers', 'read:workers'],
      ['/m1/specialists', 'read:specialists'],
    ]) {
      const response = await get(pathname, token);
      assert.equal(response.status, 403);
      assert.equal(response.body.error.requiredScope, scope);
    }
  });

  const token = await pair(['read:capabilities', 'read:workers', 'read:specialists']);

  await test('discovery reports reads available and every mutation unavailable', async () => {
    const response = await get('/m1/capabilities', token);
    const features = response.body.data.remoteCore.features;
    assert.equal(response.body.data.features.workers, true);
    assert.equal(response.body.data.features.specialists, true);
    assert.equal(features['workers.read'].status, 'available');
    assert.equal(features['workers.toggle'].status, 'unavailable');
    assert.equal(features['workers.dryRun'].status, 'unavailable');
    assert.equal(features['specialists.read'].status, 'available');
    assert.equal(features['specialists.toggle'].status, 'unavailable');
  });

  await test('worker projection exposes configuration and only the last terminal run', async () => {
    const response = await get('/m1/workers?limit=50', token);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.length, 1);
    const worker = response.body.data[0];
    assert.equal(worker.id, 'worker-a');
    assert.equal(worker.kind, 'MONITOR');
    assert.equal(worker.enabled, true);
    assert.equal(worker.schedule.intervalMs, 3600000);
    assert.equal(worker.lastRun.status, 'success');
    assert.equal(worker.lastRun.actionsExecuted, 2);
    assert.match(worker.version, /^v1:/);
    const encoded = JSON.stringify(response.body);
    for (const secret of [
      'definition-secret', 'state-secret', 'params-secret', 'explain-secret',
      'log-secret', 'untrusted-running-secret',
    ]) assert.ok(!encoded.includes(secret), secret);
  });

  await test('specialist projection exposes package state and expertise count without manifest', async () => {
    const response = await get('/m1/specialists?limit=50', token);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.length, 1);
    assert.deepEqual(
      Object.fromEntries(['id', 'packageVersion', 'domain', 'type', 'status', 'expertiseCount']
        .map(key => [key, response.body.data[0][key]])),
      {
        id: 'finance-cz', packageVersion: '2.1.0', domain: 'finance', type: 'domain',
        status: 'enabled', expertiseCount: 2,
      },
    );
    assert.ok(!JSON.stringify(response.body).includes('manifest-secret'));
    assert.ok(!Object.hasOwn(response.body.data[0], 'isRegistered'));
  });

  await test('lists paginate with stream-bound opaque cursors', async () => {
    db.prepare(`
      INSERT INTO agents_v33 (id, name, definition, enabled) VALUES (?, ?, ?, 0)
    `).run('worker-b', 'Záložní agent', JSON.stringify({ type: 'HUNTER' }));
    const first = await get('/m1/workers?limit=1', token);
    assert.equal(first.body.data.length, 1);
    assert.equal(first.body.hasMore, true);
    assert.ok(first.body.nextCursor);
    const second = await get(`/m1/workers?limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`, token);
    assert.equal(second.body.data[0].id, 'worker-b');
    const crossed = await get(`/m1/specialists?cursor=${encodeURIComponent(first.body.nextCursor)}`, token);
    assert.equal(crossed.status, 400);
    assert.equal(crossed.body.error.code, 'cursor_unknown');
  });

  await test('unknown, duplicate and malformed query values fail closed', async () => {
    for (const pathname of [
      '/m1/workers?enabled=true',
      '/m1/workers?limit=1&limit=2',
      '/m1/workers?limit=0',
      '/m1/specialists?limit=101',
      '/m1/specialists?limit=1x',
    ]) {
      const response = await get(pathname, token);
      assert.equal(response.status, 400, pathname);
      assert.equal(response.body.error.code, 'bad_request', pathname);
    }
  });

  await test('malformed worker definition fails closed without exposing its bytes', async () => {
    db.prepare(`
      INSERT INTO agents_v33 (id, name, definition) VALUES (?, ?, ?)
    `).run('worker-bad', 'Broken', 'malformed-definition-secret');
    const response = await get('/m1/workers', token);
    assert.equal(response.status, 503);
    assert.equal(response.body.error.reason, 'worker_record_invalid');
    assert.ok(!JSON.stringify(response.body).includes('malformed-definition-secret'));
  });

  await test('missing providers fail closed and optional worker tables stay undiscoverable', async () => {
    for (const [handler, scope] of [
      [handleWorkers, 'read:workers'],
      [handleSpecialists, 'read:specialists'],
    ]) {
      const response = await handler({
        corePort: new RemoteCorePort(),
        principal: { deviceId: 'd1', scopes: [scope] },
        query: new URLSearchParams(),
      });
      assert.equal(response.status, 503);
      assert.equal(response.body.error.reason, 'capability_unavailable');
    }

    const oldDb = new Database(':memory:');
    try {
      await runMigrations(oldDb);
      const port = createMobileRemoteCorePort({
        rawDb: oldDb,
        upstream: { postChat: async () => ({ ok: true, data: {} }) },
      });
      const features = port.capabilities({ scopes: ['read:workers', 'read:specialists'] }).features;
      assert.equal(features['workers.read'].status, 'unavailable');
      assert.equal(features['specialists.read'].status, 'available');
    } finally {
      oldDb.close();
    }
  });
} finally {
  await gateway.stop();
  db.close();
  try { rmSync(runtimeDir, { recursive: true, force: true }); } catch (error) {
    if (error?.code !== 'EBUSY' && error?.code !== 'EPERM') throw error;
  }
}

console.log(`\nMobile workers/specialists: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
