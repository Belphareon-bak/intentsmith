import './helpers/isolated-test-db.js';

import { strict as assert } from 'node:assert';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../src/db/migrate.js';
import { startMobileGateway } from '../src/mobile/gateway.js';
import { createPairingCode, PAIRABLE_SCOPES } from '../src/mobile/pairing.js';
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

console.log('\n=== Mobile paired-device lifecycle ===');

const runtimeDir = mkdtempSync(path.join(tmpdir(), 'is-mobile-devices-'));
const db = new Database(path.join(runtimeDir, 'devices.sqlite'));
db.pragma('journal_mode = WAL');
await runMigrations(db);

const env = { ...process.env, C3_MOBILE_PAIRING: 'on', C3_MOBILE_UI: 'off' };
const gateway = await startMobileGateway({
  rawDb: db,
  host: '127.0.0.1',
  port: 0,
  upstream: new OfflineUpstream(),
  env,
  logger: { error() {}, warn() {}, info() {} },
});

async function request(pathname, { token = null, method = 'GET', body = null } = {}) {
  const response = await fetch(gateway.url + pathname, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: response.status,
    cacheControl: response.headers.get('cache-control'),
    body: await response.json(),
  };
}

async function pair(name, scopes) {
  const issued = createPairingCode(db, { scopes, ttlMs: 60_000 });
  const response = await request('/m1/pair/claim', {
    method: 'POST',
    body: { code: issued.code, deviceName: name },
  });
  assert.equal(response.status, 200);
  return response.body.data;
}

try {
  const manager = await pair('Manager phone', [
    'read:capabilities', 'read:devices', 'write:devices',
  ]);
  const viewer = await pair('Viewer phone', ['read:capabilities', 'read:devices']);
  const target = await pair('Lost phone', ['read:capabilities']);

  await test('device lifecycle scopes are pairable but grant no token-reading authority', () => {
    assert.ok(PAIRABLE_SCOPES.includes('read:devices'));
    assert.ok(PAIRABLE_SCOPES.includes('write:devices'));
    assert.ok(!PAIRABLE_SCOPES.includes('read:security'));
    assert.ok(!PAIRABLE_SCOPES.includes('write:security'));
  });

  await test('the list is scope-gated, no-store and contains no credential material', async () => {
    const denied = await request('/m1/devices', { token: target.token });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error.requiredScope, 'read:devices');

    const response = await request('/m1/devices', { token: manager.token });
    assert.equal(response.status, 200);
    assert.equal(response.cacheControl, 'no-store');
    assert.equal(response.body.data.length, 3);
    assert.equal(response.body.data.filter(device => device.current).length, 1);
    assert.equal(response.body.data.find(device => device.current).deviceId, manager.deviceId);
    assert.ok(response.body.data.every(device => typeof device.expired === 'boolean'));
    const wire = JSON.stringify(response.body);
    assert.ok(!wire.includes(manager.token));
    assert.ok(!wire.includes('token_hash'));
  });

  await test('read-only device scope cannot revoke', async () => {
    const response = await request(`/m1/devices/${target.deviceId}/revoke`, {
      token: viewer.token,
      method: 'POST',
      body: { operationId: 'v'.repeat(32) },
    });
    assert.equal(response.status, 403);
    assert.equal(response.body.error.requiredScope, 'write:devices');
  });

  await test('revocation is durable, explicit about no remote wipe, and cuts off access', async () => {
    const response = await request(`/m1/devices/${target.deviceId}/revoke`, {
      token: manager.token,
      method: 'POST',
      body: { operationId: 'a'.repeat(32) },
    });
    assert.equal(response.status, 200);
    assert.equal(response.cacheControl, 'no-store');
    assert.equal(response.body.data.state, 'CONFIRMED');
    assert.equal(response.body.data.deviceId, target.deviceId);
    assert.equal(response.body.data.remoteWipe, false);
    assert.equal(response.body.data.current, false);

    const cutOff = await request('/m1/capabilities', { token: target.token });
    assert.equal(cutOff.status, 401);
    assert.equal(cutOff.body.error.code, 'token_revoked');
  });

  await test('same operation key replays the original result and cannot change target', async () => {
    const replay = await request(`/m1/devices/${target.deviceId}/revoke`, {
      token: manager.token,
      method: 'POST',
      body: { operationId: 'a'.repeat(32) },
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.data.state, 'CONFIRMED');
    assert.equal(replay.body.data.result.deviceId, target.deviceId);
    assert.equal(replay.body.replayed, true);

    const conflict = await request(`/m1/devices/${viewer.deviceId}/revoke`, {
      token: manager.token,
      method: 'POST',
      body: { operationId: 'a'.repeat(32) },
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error.code, 'operation_conflict');
  });

  await test('a new operation against an already revoked device is idempotent', async () => {
    const response = await request(`/m1/devices/${target.deviceId}/revoke`, {
      token: manager.token,
      method: 'POST',
      body: { operationId: 'b'.repeat(32) },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.alreadyRevoked, true);
    assert.equal(response.body.data.remoteWipe, false);
  });

  await test('unknown targets do not consume an operation-journal entry', async () => {
    const operationId = 'c'.repeat(32);
    const response = await request('/m1/devices/dev_missing_123/revoke', {
      token: manager.token,
      method: 'POST',
      body: { operationId },
    });
    assert.equal(response.status, 404);
    const row = db.prepare(
      'SELECT 1 FROM mobile_operations WHERE device_id = ? AND operation_id = ?',
    ).get(manager.deviceId, operationId);
    assert.equal(row, undefined);
  });

  await test('self-revocation commits its result before invalidating the caller', async () => {
    const response = await request(`/m1/devices/${manager.deviceId}/revoke`, {
      token: manager.token,
      method: 'POST',
      body: { operationId: 'd'.repeat(32) },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.current, true);
    assert.equal(response.body.data.state, 'CONFIRMED');

    const cutOff = await request('/m1/devices', { token: manager.token });
    assert.equal(cutOff.status, 401);
    assert.equal(cutOff.body.error.code, 'token_revoked');
  });
} finally {
  await gateway.stop();
  db.close();
  try { rmSync(runtimeDir, { recursive: true, force: true }); } catch (error) {
    if (error?.code !== 'EBUSY' && error?.code !== 'EPERM') throw error;
  }
}

console.log(`\nMobile devices: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
