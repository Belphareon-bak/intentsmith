import './helpers/isolated-test-db.js';

import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

import Database from 'better-sqlite3';

import { runMigrations } from '../src/db/migrate.js';
import { startMobileGateway } from '../src/mobile/gateway.js';
import {
  normalizeGatewayOrigin,
  prepareAndroidAssets,
  renderRuntimeConfig,
} from '../scripts/mobile-android-prepare-assets.mjs';

const read = file => readFileSync(file, 'utf8');
const capacitor = JSON.parse(read('mobile-app/capacitor.config.json'));
const indexHtml = read('src/mobile/client/index.html');
const appJs = read('src/mobile/client/app.js');
const sourceRuntimeConfig = read('src/mobile/client/runtime-config.js');
const networkPolicy = read('mobile-app/android/app/src/main/res/xml/network_security_config.xml');

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

console.log('\n=== Mobile packaged UI and native transport ===');

await test('Capacitor packages the canonical client instead of a second UI', () => {
  assert.equal(capacitor.webDir, '../src/mobile/client');
  assert.equal(capacitor.plugins.CapacitorHttp.enabled, true);
  assert.deepEqual(capacitor.server, { androidScheme: 'http' });
  assert.ok(!Object.hasOwn(capacitor.server, 'url'));
  assert.ok(!Object.hasOwn(capacitor.server, 'cleartext'));
  assert.ok(!Object.hasOwn(capacitor.server, 'errorPath'));
});

await test('runtime configuration is loaded before the application module', () => {
  const configAt = indexHtml.indexOf('src="/runtime-config.js"');
  const appAt = indexHtml.indexOf('src="/app.js"');
  assert.ok(configAt >= 0);
  assert.ok(appAt > configAt);
});

await test('browser configuration is immutable and keeps same-origin API paths', () => {
  const context = vm.createContext({});
  vm.runInContext(sourceRuntimeConfig, context);
  assert.equal(context.INTENTSMITH_RUNTIME_CONFIG.gatewayOrigin, '');
  assert.equal(Object.isFrozen(context.INTENTSMITH_RUNTIME_CONFIG), true);
  assert.match(appJs, /const API = `\$\{configuredGatewayOrigin\(\)\}\/m1`/);
});

await test('every direct fetch target remains behind the API boundary', () => {
  const targets = [...appJs.matchAll(/fetch\(([^,\n]+)/g)].map(match => match[1].trim());
  assert.deepEqual(targets, ['API + path', '`${API}/pair/claim`']);
});

await test('build origin policy permits loopback HTTP and remote HTTPS only', () => {
  assert.equal(normalizeGatewayOrigin('http://127.0.0.1:3336'), 'http://127.0.0.1:3336');
  assert.equal(normalizeGatewayOrigin('http://localhost:3336'), 'http://localhost:3336');
  assert.equal(normalizeGatewayOrigin('http://[::1]:3336'), 'http://[::1]:3336');
  assert.equal(normalizeGatewayOrigin('https://gateway.example:443'), 'https://gateway.example');
  for (const invalid of [
    'http://192.168.1.2:3336',
    'ftp://gateway.example',
    'https://user:pass@gateway.example',
    'https://gateway.example/path',
    'https://gateway.example?query=1',
    'https://gateway.example/#fragment',
    ' https://gateway.example',
  ]) assert.throws(() => normalizeGatewayOrigin(invalid), TypeError, invalid);
});

await test('generated runtime config safely serializes and freezes the exact origin', () => {
  const rendered = renderRuntimeConfig('https://gateway.example');
  const context = vm.createContext({});
  vm.runInContext(rendered, context);
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.INTENTSMITH_RUNTIME_CONFIG)),
    { gatewayOrigin: 'https://gateway.example' },
  );
  assert.equal(Object.isFrozen(context.INTENTSMITH_RUNTIME_CONFIG), true);
});

await test('asset preparation writes only the selected generated target', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'is-mobile-assets-'));
  const outputPath = path.join(dir, 'public', 'runtime-config.js');
  try {
    const result = await prepareAndroidAssets({
      gatewayUrl: 'https://gateway.example:8443',
      outputPath,
    });
    assert.equal(result.origin, 'https://gateway.example:8443');
    assert.match(read(outputPath), /https:\/\/gateway\.example:8443/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test('loopback cleartext is narrow and gateway CORS remains closed', async () => {
  assert.match(networkPolicy, /<domain includeSubdomains="false">127\.0\.0\.1<\/domain>/);
  assert.match(networkPolicy, /<domain includeSubdomains="false">localhost<\/domain>/);
  assert.match(networkPolicy, /<base-config cleartextTrafficPermitted="false"/);

  const dir = mkdtempSync(path.join(tmpdir(), 'is-mobile-cors-'));
  const db = new Database(path.join(dir, 'gateway.sqlite'));
  let gateway;
  try {
    await runMigrations(db);
    gateway = await startMobileGateway({
      rawDb: db,
      host: '127.0.0.1',
      port: 0,
      env: { ...process.env, C3_MOBILE_UI: 'on' },
      logger: { error() {}, warn() {}, info() {} },
    });
    const runtimeConfig = await fetch(`${gateway.url}/runtime-config.js`, {
      headers: { origin: 'http://untrusted.example' },
    });
    assert.equal(runtimeConfig.status, 200);
    assert.equal(runtimeConfig.headers.get('access-control-allow-origin'), null);
    assert.match(await runtimeConfig.text(), /gatewayOrigin: ''/);

    const health = await fetch(`${gateway.url}/m1/health`, {
      headers: { origin: 'http://localhost' },
    });
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('access-control-allow-origin'), null);

    const preflight = await fetch(`${gateway.url}/m1/health`, {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost' },
    });
    assert.notEqual(preflight.status, 200);
    assert.equal(preflight.headers.get('access-control-allow-origin'), null);

    const legacy = await fetch(`${gateway.url}/api/health`, {
      headers: { origin: 'http://localhost' },
    });
    assert.notEqual(legacy.status, 200);
    assert.equal(legacy.headers.get('access-control-allow-origin'), null);
  } finally {
    if (gateway) await gateway.stop();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\nMobile packaged transport: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
