import './helpers/isolated-test-db.js';

import { strict as assert } from 'node:assert';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../src/db/migrate.js';
import { startMobileGateway } from '../src/mobile/gateway.js';
import { handleSettings } from '../src/mobile/handlers.js';
import { OperationJournal } from '../src/mobile/operation-journal.js';
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
  const response = await fetch(gateway.url + pathname, {
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: response.status, body: await response.json() };
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
} finally {
  await gateway.stop();
  try { db.close(); } catch { /* already closed */ }
  rmSync(runtimeDir, { recursive: true, force: true });
}

console.log(`\nMobile settings: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
