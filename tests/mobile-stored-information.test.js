import './helpers/isolated-test-db.js';

import { strict as assert } from 'node:assert';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../src/db/migrate.js';
import { startMobileGateway } from '../src/mobile/gateway.js';
import { handleStoredInformation, handleStoredInformationWrite } from '../src/mobile/handlers.js';
import { createPairingCode } from '../src/mobile/pairing.js';
import { RemoteCorePort } from '../src/remote-core/port.js';
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

console.log('\n=== Mobile stored-information projection ===');

const runtimeDir = mkdtempSync(path.join(tmpdir(), 'is-mobile-memory-'));
const db = new Database(path.join(runtimeDir, 'memory.sqlite'));
db.pragma('journal_mode = WAL');
await runMigrations(db);

const insertLtm = db.prepare(`
  INSERT INTO memory (
    id, user_id, kind, key, value, confidence, source, created_at,
    last_used, ttl, access_count, last_accessed_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
insertLtm.run(
  'ltm-visible', 'default', 'preference', 'language', JSON.stringify('cs'),
  0.9, 'explicit', '2026-09-01 10:00:00', null, null, 3, '2026-09-04 11:00:00',
);
insertLtm.run(
  'ltm-internal', 'default', 'agent_internal', 'secret-plan', JSON.stringify('must-not-leak'),
  1, 'agent', '2026-09-04 12:00:00', null, null, 1, '2026-09-04 12:00:00',
);
insertLtm.run(
  'ltm-other-user', 'somebody-else', 'fact', 'foreign', JSON.stringify('foreign-secret'),
  1, 'explicit', '2026-09-04 12:00:00', null, null, 1, '2026-09-04 12:00:00',
);
insertLtm.run(
  'ltm-expired', 'default', 'fact', 'expired', JSON.stringify('expired-secret'),
  1, 'explicit', '2020-01-01 00:00:00', null, 1, 0, null,
);

db.prepare(`
  INSERT INTO task_memory (
    project_id, kind, key, value, confidence, milestone_id,
    created_at, last_accessed_at, access_count
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  'project-17', 'fix', 'sqlite-lock', 'serialize writes', 0.8, 'milestone-4',
  Date.UTC(2026, 8, 1, 10), Date.UTC(2026, 8, 4, 10), 2,
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
    body: JSON.stringify({ code: issued.code, deviceName: 'memory-test' }),
  });
  assert.equal(response.status, 200);
  return (await response.json()).data;
}

async function get(pathname, token) {
  const response = await fetch(gateway.url + pathname, {
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

async function post(pathname, token, body) {
  const response = await fetch(gateway.url + pathname, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json(),
  };
}

try {
  await test('memory scope is enforced before any stored information is returned', async () => {
    const paired = await pair(['read:capabilities']);
    const response = await get('/m1/memory', paired.token);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.body.error.code, 'scope_required');
    assert.equal(response.body.error.requiredScope, 'read:memory');
  });

  const readPair = await pair(['read:capabilities', 'read:memory']);
  const token = readPair.token;
  const writePair = await pair(['read:capabilities', 'read:memory', 'write:memory']);

  await test('write authority is explicit, pairable and non-transitive', async () => {
    const response = await get('/m1/capabilities', token);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.features.memory, true);
    assert.equal(response.body.data.features.memoryWrite, false);
    assert.equal(response.body.data.remoteCore.features['storedInformation.read'].status, 'available');
    assert.equal(response.body.data.remoteCore.features['storedInformation.write'].status, 'forbidden');
    assert.equal(response.body.data.remoteCore.features['storedInformation.delete'].status, 'unavailable');

    const writable = await get('/m1/capabilities', writePair.token);
    assert.equal(writable.body.data.features.memoryWrite, true);
    assert.equal(writable.body.data.remoteCore.features['storedInformation.write'].status, 'available');

    const denied = await post('/m1/memory', token, {
      operationId: 'memory-create-denied',
      category: 'project',
      key: 'denied-key',
      value: 'must not be written',
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error.requiredScope, 'write:memory');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM memory WHERE key = 'denied-key'").get().n, 0);
  });

  await test('manual memory creates one explicit LTM fact and returns a content-free receipt', async () => {
    const request = {
      operationId: 'memory-create-project-root',
      category: 'project',
      key: 'repository-root',
      value: 'C:\\work\\intentsmith',
    };
    const created = await post('/m1/memory', writePair.token, request);
    assert.equal(created.status, 200);
    assert.equal(created.headers.get('cache-control'), 'no-store');
    assert.equal(created.body.data.state, 'CONFIRMED');
    assert.deepEqual(created.body.data.result, {
      id: 'ltm:mem_default_project_repository-root',
      kind: 'ltm',
      category: 'project',
      key: 'repository-root',
    });
    assert.ok(!JSON.stringify(created.body.data.result).includes(request.value));

    const row = db.prepare(`
      SELECT user_id, kind, key, value, confidence, source, ttl
        FROM memory WHERE id = ?
    `).get('mem_default_project_repository-root');
    assert.deepEqual(row, {
      user_id: 'default',
      kind: 'project',
      key: 'repository-root',
      value: JSON.stringify(request.value),
      confidence: 1,
      source: 'explicit',
      ttl: null,
    });

    const replay = await post('/m1/memory', writePair.token, request);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM memory WHERE key = 'repository-root'").get().n, 1);
  });

  await test('create-only semantics reject replacement and operation-key rebinding', async () => {
    const conflict = await post('/m1/memory', writePair.token, {
      operationId: 'memory-create-project-root-again',
      category: 'project',
      key: 'repository-root',
      value: 'silently replacing this would be unsafe',
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error.reason, 'memory_key_conflict');
    assert.equal(conflict.body.error.state, 'REJECTED');
    assert.equal(
      JSON.parse(db.prepare("SELECT value FROM memory WHERE key = 'repository-root'").get().value),
      'C:\\work\\intentsmith',
    );

    const rebound = await post('/m1/memory', writePair.token, {
      operationId: 'memory-create-project-root',
      category: 'project',
      key: 'different-key',
      value: 'different value',
    });
    assert.equal(rebound.status, 409);
    assert.equal(rebound.body.error.code, 'operation_conflict');
    assert.equal(rebound.body.error.reason, 'fingerprint_mismatch');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM memory WHERE key = 'different-key'").get().n, 0);
  });

  await test('manual writer rejects internal categories, malformed keys and oversized values', async () => {
    const cases = [
      { operationId: 'memory-invalid-category', category: 'agent_internal', key: 'secret', value: 'x' },
      { operationId: 'memory-invalid-task', category: 'task', key: 'execution', value: 'x' },
      { operationId: 'memory-invalid-key', category: 'project', key: ' padded ', value: 'x' },
      { operationId: 'memory-invalid-value', category: 'project', key: 'blank', value: '   ' },
      { operationId: 'memory-oversized-value', category: 'project', key: 'large', value: 'x'.repeat(8193) },
    ];
    for (const body of cases) {
      const response = await post('/m1/memory', writePair.token, body);
      assert.equal(response.status, 400, body.operationId);
      assert.equal(response.body.error.state, 'REJECTED', body.operationId);
    }
    const wrongShape = await post('/m1/memory', writePair.token, {
      operationId: 'memory-wrong-shape',
      category: 'project',
      key: 'shape',
      value: 'x',
      ttl: 30,
    });
    assert.equal(wrongShape.status, 400);
    assert.equal(wrongShape.body.error.reason, 'body_shape_invalid');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM memory WHERE key IN ('secret', 'execution', 'blank', 'large', 'shape')").get().n, 0);
  });

  await test('a provider failure after an effect is UNKNOWN and is never dispatched twice', async () => {
    let calls = 0;
    const ambiguousPort = new RemoteCorePort({
      providers: {
        'storedInformation.write': async input => {
          calls += 1;
          db.prepare(`
            INSERT INTO memory (id, user_id, kind, key, value, confidence, source)
            VALUES (?, 'default', ?, ?, ?, 1, 'explicit')
          `).run(
            `mem_default_${input.category}_${input.key}`,
            input.category,
            input.key,
            JSON.stringify(input.value),
          );
          throw new Error('simulated lost provider result');
        },
      },
    });
    const body = {
      operationId: 'memory-create-lost-result',
      category: 'style',
      key: 'answer-tone',
      value: 'brief and direct',
    };
    const response = await handleStoredInformationWrite({
      corePort: ambiguousPort,
      journal: gateway.journal,
      principal: { deviceId: writePair.deviceId, scopes: ['write:memory'] },
      body,
    });
    assert.equal(calls, 1);
    assert.equal(response.status, 503);
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.equal(response.body.error.state, 'UNKNOWN');
    assert.equal(response.body.error.resolveBy, 'GET /m1/operations/memory-create-lost-result');
    assert.equal(gateway.journal.lookup(writePair.deviceId, body.operationId).state, 'UNKNOWN');
    assert.equal(
      JSON.parse(db.prepare("SELECT value FROM memory WHERE key = 'answer-tone'").get().value),
      body.value,
    );
    const journalRow = db.prepare(`
      SELECT request_fingerprint, result_json FROM mobile_operations
       WHERE device_id = ? AND operation_id = ?
    `).get(writePair.deviceId, body.operationId);
    assert.match(journalRow.request_fingerprint, /^[0-9a-f]{64}$/);
    assert.equal(journalRow.result_json, null);
    assert.ok(!JSON.stringify(journalRow).includes(body.value));
  });

  await test('a malformed success is UNKNOWN rather than invented confirmation', async () => {
    const malformedPort = new RemoteCorePort({
      providers: {
        'storedInformation.write': async () => ({
          ok: true,
          data: { id: 'wrong', kind: 'ltm', category: 'project', key: 'malformed-result' },
        }),
      },
    });
    const body = {
      operationId: 'memory-create-malformed-result',
      category: 'project',
      key: 'malformed-result',
      value: 'x',
    };
    const response = await handleStoredInformationWrite({
      corePort: malformedPort,
      journal: gateway.journal,
      principal: { deviceId: writePair.deviceId, scopes: ['write:memory'] },
      body,
    });
    assert.equal(response.status, 503);
    assert.equal(response.body.error.state, 'UNKNOWN');
    assert.equal(gateway.journal.lookup(writePair.deviceId, body.operationId).state, 'UNKNOWN');
  });

  await test('combined projection preserves real LTM and task-memory fields', async () => {
    const response = await get('/m1/memory?kind=all&limit=50', token);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.body.data.filter(record => record.kind === 'ltm').length, 3);
    assert.equal(response.body.data.filter(record => record.kind === 'task').length, 1);
    const ltm = response.body.data.find(record => record.id === 'ltm:ltm-visible');
    const task = response.body.data.find(record => record.kind === 'task');
    assert.equal(ltm.id, 'ltm:ltm-visible');
    assert.equal(ltm.value, 'cs');
    assert.equal(ltm.source, 'explicit');
    assert.equal(ltm.projectId, null);
    assert.ok(ltm.strength >= 0 && ltm.strength <= ltm.storedConfidence);
    assert.match(ltm.version, /^v1:/);
    assert.equal(task.value, 'serialize writes');
    assert.equal(task.source, 'execution_loop');
    assert.equal(task.projectId, 'project-17');
    assert.equal(task.milestoneId, 'milestone-4');
  });

  await test('internal, foreign-user and expired LTM never cross the projection', async () => {
    const response = await get('/m1/memory', token);
    const encoded = JSON.stringify(response.body);
    assert.ok(!encoded.includes('must-not-leak'));
    assert.ok(!encoded.includes('foreign-secret'));
    assert.ok(!encoded.includes('expired-secret'));
    assert.ok(!encoded.includes('agent_internal'));
  });

  await test('kind filters paginate independently with opaque cursors', async () => {
    const ltm = await get('/m1/memory?kind=ltm&limit=1', token);
    assert.equal(ltm.status, 200);
    assert.equal(ltm.body.data.length, 1);
    assert.equal(ltm.body.data[0].kind, 'ltm');
    assert.equal(ltm.body.hasMore, true);
    assert.equal(ltm.body.end, false);

    const task = await get('/m1/memory?kind=task&limit=1', token);
    assert.equal(task.status, 200);
    assert.equal(task.body.data[0].kind, 'task');

    const crossed = await get('/m1/memory?kind=task&cursor=c1.invalid', token);
    assert.equal(crossed.status, 400);
    assert.equal(crossed.body.error.code, 'cursor_unknown');
  });

  await test('unknown, duplicate and malformed query values fail closed', async () => {
    for (const pathname of [
      '/m1/memory?origin=manual',
      '/m1/memory?kind=ltm&kind=task',
      '/m1/memory?kind=agent_internal',
      '/m1/memory?limit=0',
      '/m1/memory?limit=101',
      '/m1/memory?limit=1x',
    ]) {
      const response = await get(pathname, token);
      assert.equal(response.status, 400, pathname);
      assert.equal(response.body.error.code, 'bad_request', pathname);
    }
  });

  await test('missing provider and malformed stored JSON fail without leaking data', async () => {
    const unavailable = await handleStoredInformation({
      corePort: new RemoteCorePort(),
      principal: { deviceId: 'd1', scopes: ['read:memory'] },
      query: new URLSearchParams(),
    });
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.body.error.reason, 'capability_unavailable');

    insertLtm.run(
      'ltm-malformed', 'default', 'fact', 'broken', 'not-json-secret',
      1, 'explicit', '2026-09-04 13:00:00', null, null, 1, '2026-09-04 13:00:00',
    );
    const malformed = await get('/m1/memory?kind=ltm', token);
    assert.equal(malformed.status, 503);
    assert.equal(malformed.body.error.reason, 'stored_information_value_invalid');
    assert.ok(!JSON.stringify(malformed.body).includes('not-json-secret'));
  });
} finally {
  await gateway.stop();
  db.close();
  try { rmSync(runtimeDir, { recursive: true, force: true }); } catch (error) {
    if (error?.code !== 'EBUSY' && error?.code !== 'EPERM') throw error;
  }
}

console.log(`\nMobile stored information: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
