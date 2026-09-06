import './helpers/isolated-test-db.js';

import { strict as assert } from 'node:assert';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createAgentRoutes } from '../src/agents/api.js';
import { AgentRepository, initAgentTables } from '../src/agents/repository.js';
import { runMigrations } from '../src/db/migrate.js';
import { startMobileGateway } from '../src/mobile/gateway.js';
import {
  handleSpecialistDetail,
  handleSpecialists,
  handleWorkerRuns,
  handleWorkers,
} from '../src/mobile/handlers.js';
import { createPairingCode, PAIRABLE_SCOPES } from '../src/mobile/pairing.js';
import { encodeCursor } from '../src/mobile/protocol.js';
import { RemoteCorePort, createMobileRemoteCorePort } from '../src/remote-core/port.js';
import { UpstreamClient } from '../src/mobile/upstream.js';

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
    (agent_id, started_at, finished_at, status, triggers_fired, actions_executed, explain, log, error)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  'worker-a', '2026-09-04 07:00:00', '2026-09-04 07:01:00', 'partial',
  JSON.stringify(['trigger-secret-old']), 1, JSON.stringify({ secret: 'explain-old' }), 'log-old', 'error-old',
  'worker-a', '2026-09-04 08:00:00', '2026-09-04 08:02:00', 'error',
  JSON.stringify(['trigger-secret-a', 'trigger-secret-b']), 0, JSON.stringify({ secret: 'explain-error' }), 'log-error', 'error-secret',
);
db.prepare(`
  INSERT INTO agent_runs_v33
    (agent_id, started_at, finished_at, status, triggers_fired, actions_executed, explain, log, error)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  'worker-a', '2026-09-04 09:00:00', '2026-09-04 09:01:00', 'success',
  JSON.stringify(['trigger-secret-latest']), 2,
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

const agentRepository = new AgentRepository(db);
const scheduler = {
  rescheduled: [],
  rescheduleAgent(id) { this.rescheduled.push(id); },
};
const agentRoutes = createAgentRoutes({ repository: agentRepository, scheduler });
const workerUpstream = {
  calls: 0,
  mode: 'normal',
  async probe() { return { reachable: true }; },
  async postChat() { return { ok: false, decided: false, code: 'not_used' }; },
  async setWorkerEnabled({ id, expectedEnabled, enabled }) {
    this.calls += 1;
    let status = 200;
    let payload = null;
    const res = {
      status(value) { status = value; return this; },
      json(value) { payload = value; return value; },
    };
    const handler = enabled ? agentRoutes.enableAgent : agentRoutes.disableAgent;
    await handler({ params: { id }, body: { expectedEnabled } }, res);
    if (this.mode === 'ambiguous-after-effect' && payload?.ok) {
      return { ok: false, decided: false, code: 'upstream_reset' };
    }
    if (this.mode === 'malformed-after-effect' && payload?.ok) {
      return { ok: true, data: { id, enabled } };
    }
    if (status === 200) {
      return {
        ok: true,
        data: {
          id: payload.id,
          previousEnabled: payload.previousEnabled,
          enabled: payload.enabled,
        },
      };
    }
    return {
      ok: false,
      decided: [400, 404, 409].includes(status),
      code: payload?.code || `upstream_status_${status}`,
      status,
    };
  },
};

const gateway = await startMobileGateway({
  rawDb: db,
  host: '127.0.0.1',
  port: 0,
  upstream: workerUpstream,
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
  return { status: response.status, headers: response.headers, body: await response.json() };
}

async function put(pathname, token, body) {
  const response = await fetch(gateway.url + pathname, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

try {
  await test('both read scopes are enforced at the route boundary', async () => {
    const token = await pair(['read:capabilities']);
    for (const [pathname, scope] of [
      ['/m1/workers', 'read:workers'],
      ['/m1/workers/worker-a/runs', 'read:workers'],
      ['/m1/specialists', 'read:specialists'],
      ['/m1/specialists/finance-cz', 'read:specialists'],
    ]) {
      const response = await get(pathname, token);
      assert.equal(response.status, 403);
      assert.equal(response.body.error.requiredScope, scope);
    }
    const denied = await put('/m1/workers/worker-a/enabled', token, {
      operationId: 'worker-denied', expectedEnabled: true, enabled: false,
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error.requiredScope, 'write:workers');
    assert.equal(agentRepository.getAgent('worker-a').enabled, true);
  });

  const token = await pair(['read:capabilities', 'read:workers', 'read:specialists']);
  const writeToken = await pair([
    'read:capabilities', 'read:workers', 'write:workers', 'read:specialists',
  ]);

  await test('discovery reports the worker transition separately from unsupported actions', async () => {
    assert.ok(PAIRABLE_SCOPES.includes('write:workers'));
    assert.ok(!createPairingCode(db, { ttlMs: 60_000 }).scopes.includes('write:workers'));
    const response = await get('/m1/capabilities', token);
    const features = response.body.data.remoteCore.features;
    assert.equal(response.body.data.features.workers, true);
    assert.equal(response.body.data.features.specialists, true);
    assert.equal(features['workers.read'].status, 'available');
    assert.equal(features['workers.toggle'].status, 'forbidden');
    assert.equal(features['workers.dryRun'].status, 'unavailable');
    assert.equal(features['specialists.read'].status, 'available');
    assert.equal(features['specialists.toggle'].status, 'unavailable');

    const writable = await get('/m1/capabilities', writeToken);
    assert.equal(writable.body.data.features.workersWrite, true);
    assert.equal(writable.body.data.remoteCore.features['workers.toggle'].status, 'available');
  });

  await test('legacy worker owner enforces the expected state and reschedules only enable', async () => {
    const callsBefore = workerUpstream.calls;
    const disable = {
      operationId: 'worker-disable-a', expectedEnabled: true, enabled: false,
    };
    const disabled = await put('/m1/workers/worker-a/enabled', writeToken, disable);
    assert.equal(disabled.status, 200, JSON.stringify(disabled.body));
    assert.equal(disabled.headers.get('cache-control'), 'no-store');
    assert.equal(disabled.body.data.state, 'CONFIRMED');
    assert.deepEqual(disabled.body.data.result, {
      id: 'worker-a', previousEnabled: true, enabled: false,
    });
    assert.equal(agentRepository.getAgent('worker-a').enabled, false);
    assert.equal(scheduler.rescheduled.length, 0);

    const replay = await put('/m1/workers/worker-a/enabled', writeToken, disable);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(workerUpstream.calls, callsBefore + 1);

    const stale = await put('/m1/workers/worker-a/enabled', writeToken, {
      operationId: 'worker-disable-stale', expectedEnabled: true, enabled: false,
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.reason, 'worker_state_conflict');
    assert.equal(stale.body.error.state, 'REJECTED');
    assert.equal(agentRepository.getAgent('worker-a').enabled, false);

    const enabled = await put('/m1/workers/worker-a/enabled', writeToken, {
      operationId: 'worker-enable-aa', expectedEnabled: false, enabled: true,
    });
    assert.equal(enabled.status, 200);
    assert.deepEqual(enabled.body.data.result, {
      id: 'worker-a', previousEnabled: false, enabled: true,
    });
    assert.equal(agentRepository.getAgent('worker-a').enabled, true);
    assert.deepEqual(scheduler.rescheduled, ['worker-a']);
  });

  await test('worker operation key binds target and both states', async () => {
    const response = await put('/m1/workers/worker-a/enabled', writeToken, {
      operationId: 'worker-enable-aa', expectedEnabled: true, enabled: false,
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'operation_conflict');
    assert.equal(response.body.error.reason, 'fingerprint_mismatch');
    assert.equal(agentRepository.getAgent('worker-a').enabled, true);

    const malformed = await put('/m1/workers/worker-a/enabled', writeToken, {
      operationId: 'worker-malformed', expectedEnabled: true, enabled: false, force: true,
    });
    assert.equal(malformed.status, 400);
    assert.equal(agentRepository.getAgent('worker-a').enabled, true);
  });

  await test('upstream worker adapter fixes method, target and precondition shape', async () => {
    const calls = [];
    const upstream = new UpstreamClient({
      baseUrl: 'http://127.0.0.1:3335',
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          status: 200,
          async json() {
            return { ok: true, id: 'worker-a', previousEnabled: true, enabled: false };
          },
        };
      },
    });
    const result = await upstream.setWorkerEnabled({
      id: 'worker-a', expectedEnabled: true, enabled: false,
    });
    assert.deepEqual(result, {
      ok: true,
      data: { id: 'worker-a', previousEnabled: true, enabled: false },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://127.0.0.1:3335/api/agents/worker-a/disable');
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].init.body), { expectedEnabled: true });
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

  await test('worker history is terminal-only, content-free and walks stably into the past', async () => {
    const first = await get('/m1/workers/worker-a/runs?limit=2', token);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.direction, 'backward');
    assert.equal(first.body.hasMore, true);
    assert.equal(first.body.end, false);
    assert.ok(first.body.nextCursor);
    assert.equal(first.body.data.worker.id, 'worker-a');
    assert.deepEqual(first.body.data.runs.map(run => run.status), ['success', 'error']);
    assert.deepEqual(first.body.data.runs.map(run => run.triggerCount), [1, 2]);
    assert.equal(first.body.data.runs[0].actionsExecuted, 2);
    assert.equal(first.headers.get('cache-control'), 'no-store');

    const encoded = JSON.stringify(first.body);
    for (const secret of [
      'definition-secret', 'state-secret', 'params-secret',
      'trigger-secret-latest', 'trigger-secret-a', 'trigger-secret-b',
      'explain-secret', 'explain-error', 'log-secret', 'log-error', 'error-secret',
      'untrusted-running-secret',
    ]) assert.ok(!encoded.includes(secret), secret);

    // A newer terminal run appended after page one must not shift the absolute
    // cursor that already points to the older prefix.
    db.prepare(`
      INSERT INTO agent_runs_v33
        (agent_id, started_at, finished_at, status, triggers_fired, actions_executed, log)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'worker-a', '2026-09-04 12:00:00', '2026-09-04 12:01:00', 'success',
      JSON.stringify([]), 0, 'newer-secret',
    );
    const second = await get(
      `/m1/workers/worker-a/runs?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
      token,
    );
    assert.equal(second.status, 200);
    assert.deepEqual(second.body.data.runs.map(run => run.status), ['partial']);
    assert.equal(second.body.hasMore, false);
    assert.equal(second.body.end, true);
    assert.equal(second.body.nextCursor, null);
    assert.ok(!JSON.stringify(second.body).includes('newer-secret'));
  });

  await test('worker history rejects missing workers, foreign cursors and malformed queries', async () => {
    const missing = await get('/m1/workers/not-there/runs', token);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'not_found');

    const list = await get('/m1/workers?limit=1', token);
    const crossed = await get(
      `/m1/workers/worker-a/runs?cursor=${encodeURIComponent(list.body.nextCursor)}`,
      token,
    );
    assert.equal(crossed.status, 400);
    assert.equal(crossed.body.error.code, 'cursor_unknown');

    const forward = encodeCursor({ stream: 'worker-runs:worker-a', position: 1 });
    const wrongDirection = await get(
      `/m1/workers/worker-a/runs?cursor=${encodeURIComponent(forward)}`,
      token,
    );
    assert.equal(wrongDirection.status, 400);
    assert.equal(wrongDirection.body.error.reason, 'cursor_direction_mismatch');

    for (const pathname of [
      '/m1/workers/worker-a/runs?state=success',
      '/m1/workers/worker-a/runs?limit=1&limit=2',
      '/m1/workers/worker-a/runs?limit=0',
    ]) {
      const response = await get(pathname, token);
      assert.equal(response.status, 400, pathname);
    }
  });

  await test('malformed run metadata fails closed without returning its raw bytes', async () => {
    db.prepare('UPDATE agent_runs_v33 SET triggers_fired = ? WHERE id = 1')
      .run('malformed-trigger-secret');
    const response = await get('/m1/workers/worker-a/runs?limit=100', token);
    assert.equal(response.status, 503);
    assert.equal(response.body.error.reason, 'worker_record_invalid');
    assert.ok(!JSON.stringify(response.body).includes('malformed-trigger-secret'));
    db.prepare('UPDATE agent_runs_v33 SET triggers_fired = ? WHERE id = 1')
      .run('[]');
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

  await test('specialist detail exposes ordered expertise bindings without runtime or manifest data', async () => {
    const response = await get('/m1/specialists/finance-cz', token);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.body.data.id, 'finance-cz');
    assert.equal(response.body.data.expertiseCount, 2);
    assert.deepEqual(
      response.body.data.expertises.map(item => [item.id, item.label, item.priority]),
      [['tax', 'Daně', 2], ['cashflow', 'Cashflow', 1]],
    );
    assert.match(response.body.data.version, /^v1:/);
    const encoded = JSON.stringify(response.body);
    for (const secret of ['manifest-secret', 'private-tool']) {
      assert.ok(!encoded.includes(secret), secret);
    }
    for (const absent of ['manifest', 'tools', 'isRegistered', 'integrity']) {
      assert.ok(!Object.hasOwn(response.body.data, absent), absent);
    }
  });

  await test('specialist detail rejects missing resources, unknown query and non-exact provider input', async () => {
    const missing = await get('/m1/specialists/not-there', token);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'not_found');

    const query = await get('/m1/specialists/finance-cz?include=manifest', token);
    assert.equal(query.status, 400);
    assert.equal(query.body.error.reason, 'unknown_parameter');

    const port = createMobileRemoteCorePort({ rawDb: db, upstream: workerUpstream });
    const extra = await port.invoke({
      version: 1,
      feature: 'specialists.read',
      input: { operation: 'detail', id: 'finance-cz', include: 'manifest' },
      principal: { deviceId: 'direct', scopes: ['read:specialists'] },
    });
    assert.equal(extra.ok, false);
    assert.equal(extra.error.code, 'operation_invalid');
  });

  await test('malformed specialist binding fails closed without returning its raw bytes', async () => {
    db.prepare(`
      UPDATE specialist_expertises SET added_at = ?
       WHERE specialist_id = ? AND expertise_id = ?
    `).run('malformed-binding-secret', 'finance-cz', 'tax');
    const response = await get('/m1/specialists/finance-cz', token);
    assert.equal(response.status, 503);
    assert.equal(response.body.error.reason, 'specialist_record_invalid');
    assert.ok(!JSON.stringify(response.body).includes('malformed-binding-secret'));
    db.prepare(`
      UPDATE specialist_expertises SET added_at = CURRENT_TIMESTAMP
       WHERE specialist_id = ? AND expertise_id = ?
    `).run('finance-cz', 'tax');
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

  await test('lost or malformed post-effect results stay UNKNOWN and are never dispatched twice', async () => {
    workerUpstream.mode = 'ambiguous-after-effect';
    const ambiguousBody = {
      operationId: 'worker-disable-lost-result', expectedEnabled: true, enabled: false,
    };
    const callsBefore = workerUpstream.calls;
    const ambiguous = await put('/m1/workers/worker-a/enabled', writeToken, ambiguousBody);
    assert.equal(ambiguous.status, 503);
    assert.equal(ambiguous.body.error.state, 'UNKNOWN');
    assert.equal(ambiguous.body.error.resolveBy, 'GET /m1/operations/worker-disable-lost-result');
    assert.equal(agentRepository.getAgent('worker-a').enabled, false);
    const replay = await put('/m1/workers/worker-a/enabled', writeToken, ambiguousBody);
    assert.equal(replay.status, 202);
    assert.equal(replay.body.data.state, 'UNKNOWN');
    assert.equal(workerUpstream.calls, callsBefore + 1);

    const journalRow = db.prepare(`
      SELECT request_fingerprint, result_json
        FROM mobile_operations WHERE operation_id = ?
    `).get(ambiguousBody.operationId);
    assert.match(journalRow.request_fingerprint, /^[0-9a-f]{64}$/);
    assert.equal(journalRow.result_json, null);
    assert.ok(!db.prepare('PRAGMA table_info(mobile_operations)').all()
      .some(column => column.name === 'request_json'));

    workerUpstream.mode = 'malformed-after-effect';
    const malformed = await put('/m1/workers/worker-a/enabled', writeToken, {
      operationId: 'worker-enable-malformed-result', expectedEnabled: false, enabled: true,
    });
    assert.equal(malformed.status, 503);
    assert.equal(malformed.body.error.state, 'UNKNOWN');
    assert.equal(agentRepository.getAgent('worker-a').enabled, true);
    workerUpstream.mode = 'normal';
  });

  await test('missing providers fail closed and optional worker tables stay undiscoverable', async () => {
    for (const [handler, scope, params] of [
      [handleWorkers, 'read:workers', undefined],
      [handleWorkerRuns, 'read:workers', { id: 'worker-a' }],
      [handleSpecialists, 'read:specialists', undefined],
      [handleSpecialistDetail, 'read:specialists', { id: 'finance-cz' }],
    ]) {
      const response = await handler({
        corePort: new RemoteCorePort(),
        principal: { deviceId: 'd1', scopes: [scope] },
        query: new URLSearchParams(),
        params,
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
