import './helpers/isolated-test-db.js';

import { strict as assert } from 'node:assert';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../src/db/migrate.js';
import { startMobileGateway } from '../src/mobile/gateway.js';
import { handleSettings, handleSettingsWrite } from '../src/mobile/handlers.js';
import { OperationJournal } from '../src/mobile/operation-journal.js';
import { createPairingCode, PAIRABLE_SCOPES } from '../src/mobile/pairing.js';
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

console.log('\n=== Mobile public settings projection ===');

const runtimeDir = mkdtempSync(path.join(tmpdir(), 'is-mobile-settings-'));
const db = new Database(path.join(runtimeDir, 'settings.sqlite'));
db.pragma('journal_mode = WAL');
await runMigrations(db);

db.prepare(`
  UPDATE user_settings
     SET data = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
   WHERE id = 1
`).run(JSON.stringify({
  'c3.language': 'cs',
  appearance: { theme: 'dark', density: 'comfortable' },
  'private.integration.secret': 'must-not-cross-mobile-boundary',
}));

const gateway = await startMobileGateway({
  rawDb: db,
  host: '127.0.0.1',
  port: 0,
  upstream: new OfflineUpstream(),
  journal: new OperationJournal(db),
  env: { ...process.env, C3_MOBILE_PAIRING: 'on', C3_MOBILE_UI: 'off' },
  logger: { error: () => {}, warn: () => {}, info: () => {} },
});

async function pair(scopes) {
  const issued = createPairingCode(db, { scopes, ttlMs: 60_000 });
  const response = await fetch(`${gateway.url}/m1/pair/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: issued.code, deviceName: 'settings test' }),
  });
  assert.equal(response.status, 200);
  return (await response.json()).data;
}

async function get(pathname, token) {
  return request(pathname, { token });
}

async function request(pathname, { token, method = 'GET', body = null } = {}) {
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

try {
  await test('settings scope is enforced before the provider can return data', async () => {
    const device = await pair(['read:capabilities']);
    const response = await get('/m1/settings', device.token);
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'scope_required');
    assert.equal(response.body.error.requiredScope, 'read:settings');
  });

  await test('public settings and their authoritative revision are returned', async () => {
    const device = await pair(['read:settings']);
    const response = await get('/m1/settings', device.token);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.revision, 2);
    assert.equal(response.body.data.settings['c3.language'], 'cs');
    assert.deepEqual(response.body.data.settings.appearance, {
      theme: 'dark', density: 'comfortable',
    });
    assert.match(response.body.data.version, /^v1:/);
  });

  await test('unowned and secret-shaped settings never cross the public projection', async () => {
    const device = await pair(['read:settings']);
    const response = await get('/m1/settings', device.token);
    assert.equal(response.status, 200);
    assert.equal(Object.hasOwn(response.body.data.settings, 'private.integration.secret'), false);
    assert.ok(!JSON.stringify(response.body).includes('must-not-cross-mobile-boundary'));
  });

  await test('settings route rejects every query parameter', async () => {
    const device = await pair(['read:settings']);
    const response = await get('/m1/settings?include=secrets', device.token);
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'bad_request');
    assert.equal(response.body.error.reason, 'unknown_parameter');
    assert.equal(response.body.error.field, 'include');
  });

  await test('missing settings provider is an explicit unavailable failure', async () => {
    const response = await handleSettings({
      corePort: new RemoteCorePort(),
      principal: { deviceId: 'd1', scopes: ['read:settings'] },
      query: new URLSearchParams(),
    });
    assert.equal(response.status, 503);
    assert.equal(response.body.error.reason, 'capability_unavailable');
  });

  await test('write scope is pairable, non-default and enforced before body dispatch', async () => {
    assert.ok(PAIRABLE_SCOPES.includes('write:settings'));
    const defaults = createPairingCode(db, { ttlMs: 60_000 });
    assert.ok(!defaults.scopes.includes('write:settings'));

    const reader = await pair(['read:settings']);
    const denied = await request('/m1/settings', {
      token: reader.token,
      method: 'PUT',
      body: {
        operationId: 'w'.repeat(32), expectedRevision: 2,
        path: '/appearance/theme', value: 'light',
      },
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.cacheControl, 'no-store');
    assert.equal(denied.body.error.requiredScope, 'write:settings');
  });

  const writer = await pair(['read:capabilities', 'read:settings', 'write:settings']);

  await test('capabilities advertise write only when provider and scope are both present', async () => {
    const response = await get('/m1/capabilities', writer.token);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.features.settings, true);
    assert.equal(response.body.data.features.settingsWrite, true);
    assert.equal(response.body.data.remoteCore.features['settings.write'].status, 'available');
  });

  await test('one allow-listed setting commits at the expected revision and preserves siblings', async () => {
    const response = await request('/m1/settings', {
      token: writer.token,
      method: 'PUT',
      body: {
        operationId: 'a'.repeat(32), expectedRevision: 2,
        path: '/appearance/theme', value: 'light',
      },
    });
    assert.equal(response.status, 200);
    assert.equal(response.cacheControl, 'no-store');
    assert.equal(response.body.data.state, 'CONFIRMED');
    assert.deepEqual(response.body.data.result, {
      revision: 3, path: '/appearance/theme', value: 'light',
    });

    const read = await get('/m1/settings', writer.token);
    assert.equal(read.cacheControl, 'no-store');
    assert.equal(read.body.data.revision, 3);
    assert.equal(read.body.data.settings.appearance.theme, 'light');
    assert.equal(read.body.data.settings.appearance.density, 'comfortable');
    assert.ok(!JSON.stringify(read.body).includes('must-not-cross-mobile-boundary'));
  });

  await test('same key replays one setting effect and cannot be rebound', async () => {
    const replay = await request('/m1/settings', {
      token: writer.token,
      method: 'PUT',
      body: {
        operationId: 'a'.repeat(32), expectedRevision: 2,
        path: '/appearance/theme', value: 'light',
      },
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.data.result.revision, 3);

    const conflict = await request('/m1/settings', {
      token: writer.token,
      method: 'PUT',
      body: {
        operationId: 'a'.repeat(32), expectedRevision: 3,
        path: '/appearance/theme', value: 'system',
      },
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error.code, 'operation_conflict');
  });

  await test('stale revision is rejected with the current revision and no overwrite', async () => {
    const response = await request('/m1/settings', {
      token: writer.token,
      method: 'PUT',
      body: {
        operationId: 'b'.repeat(32), expectedRevision: 2,
        path: '/appearance/theme', value: 'system',
      },
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'state_conflict');
    assert.equal(response.body.error.state, 'REJECTED');
    assert.equal(response.body.error.currentRevision, 3);
    const read = await get('/m1/settings', writer.token);
    assert.equal(read.body.data.settings.appearance.theme, 'light');
  });

  await test('path and value validation default-deny settings outside the UX profile', async () => {
    const invalidPath = await request('/m1/settings', {
      token: writer.token,
      method: 'PUT',
      body: {
        operationId: 'c'.repeat(32), expectedRevision: 3,
        path: '/private/integration/secret', value: 'leak',
      },
    });
    assert.equal(invalidPath.status, 400);
    assert.equal(invalidPath.body.error.reason, 'setting_path_invalid');

    const invalidValue = await request('/m1/settings', {
      token: writer.token,
      method: 'PUT',
      body: {
        operationId: 'd'.repeat(32), expectedRevision: 3,
        path: '/appearance/fontSize', value: 99,
      },
    });
    assert.equal(invalidValue.status, 400);
    assert.equal(invalidValue.body.error.reason, 'setting_value_invalid');
    const read = await get('/m1/settings', writer.token);
    assert.equal(read.body.data.revision, 3);
  });

  await test('unknown body fields are rejected before consuming an operation key', async () => {
    const operationId = 'e'.repeat(32);
    const response = await request('/m1/settings', {
      token: writer.token,
      method: 'PUT',
      body: {
        operationId, expectedRevision: 3,
        path: '/appearance/theme', value: 'dark', force: true,
      },
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.reason, 'body_shape_invalid');
    const row = db.prepare(
      'SELECT 1 FROM mobile_operations WHERE device_id = ? AND operation_id = ?',
    ).get(writer.deviceId, operationId);
    assert.equal(row, undefined);
  });

  await test('malformed provider success remains UNKNOWN instead of confirming an unbound result', async () => {
    const operationId = 'f'.repeat(32);
    const response = await handleSettingsWrite({
      corePort: new RemoteCorePort({
        providers: {
          'settings.write': async () => ({
            ok: true,
            data: { revision: 4, path: '/output/defaultFormat', value: 'json' },
          }),
        },
      }),
      journal: new OperationJournal(db),
      principal: {
        deviceId: writer.deviceId,
        scopes: ['read:settings', 'write:settings'],
      },
      body: {
        operationId, expectedRevision: 3,
        path: '/appearance/theme', value: 'dark',
      },
    });
    assert.equal(response.status, 503);
    assert.equal(response.body.error.state, 'UNKNOWN');
    assert.equal(
      db.prepare(
        'SELECT state FROM mobile_operations WHERE device_id = ? AND operation_id = ?',
      ).get(writer.deviceId, operationId).state,
      'UNKNOWN',
    );
  });
} finally {
  await gateway.stop();
  try { db.close(); } catch { /* already closed */ }
  rmSync(runtimeDir, { recursive: true, force: true });
}

console.log(`\nMobile settings: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
