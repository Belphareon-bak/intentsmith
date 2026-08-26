import './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { request as httpRequest } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import {
  GLOBAL_AUTH_CREDENTIAL_AMBIGUOUS,
  GLOBAL_AUTH_REQUIRED,
  GLOBAL_AUTH_SCOPE_REQUIRED,
  RouteAuthClass,
  assertGlobalAuthRouteTable,
  authorizeGlobalRequest,
  classifyRouteAuth,
  encodeWebSocketBearerCredential,
  extractWebSocketBearerCredential,
} from '../src/security/global-auth-policy.js';
import { createLegacyLocalCapability } from '../src/security/legacy-local-access-policy.js';
import { _testInternals as wsInternals } from '../src/ws-bridge/ws-server.js';

const LOCAL = '127.0.0.1';
const route = 'POST /api/projects';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function authorize(overrides = {}) {
  return authorizeGlobalRequest({
    routeKey: route,
    headers: {},
    remoteAddress: LOCAL,
    production: true,
    localCapability: 'A'.repeat(43),
    adminToken: 'admin-secret',
    ...overrides,
  });
}

test('every supported HTTP method is classified and public surface is exact', () => {
  assert.equal(classifyRouteAuth('GET /api/health'), RouteAuthClass.PUBLIC);
  assert.equal(classifyRouteAuth('GET /api/projects'), RouteAuthClass.READ);
  assert.equal(classifyRouteAuth('POST /api/projects'), RouteAuthClass.MUTATE);
  assert.equal(classifyRouteAuth('POST /api/lifecycle/spec/approve'), RouteAuthClass.APPROVAL);
  assert.equal(classifyRouteAuth('POST /api/system/backup'), RouteAuthClass.ADMIN);
  assert.equal(classifyRouteAuth('TRACE /api/projects'), null);
  assert.deepEqual(assertGlobalAuthRouteTable({
    'GET /api/health': () => {},
    'PATCH /api/projects/:id': () => {},
  }), { routeCount: 2 });
  assert.throws(
    () => assertGlobalAuthRouteTable({ 'TRACE /unsafe': () => {} }),
    error => error.code === 'INTENTSMITH_AUTH_ROUTE_UNCLASSIFIED',
  );
});

test('production is fail-closed while public health remains credential-free', () => {
  const denied = authorize();
  assert.equal(denied.allowed, false);
  assert.equal(denied.status, 401);
  assert.equal(denied.code, GLOBAL_AUTH_REQUIRED);
  const health = authorize({ routeKey: 'GET /api/health' });
  assert.equal(health.allowed, true);
  assert.equal(health.subject, null);
});

test('development loopback bypass is explicit and cannot authorize a network peer', () => {
  const local = authorize({ production: false });
  assert.equal(local.allowed, true);
  assert.equal(local.credentialType, 'development-loopback');
  const remote = authorize({ production: false, remoteAddress: '192.0.2.10' });
  assert.equal(remote.allowed, false);
  assert.equal(remote.code, GLOBAL_AUTH_REQUIRED);
});

test('per-process Studio capability authenticates without exposing admin material', () => {
  const localCapability = createLegacyLocalCapability();
  const allowed = authorize({
    localCapability,
    headers: { 'x-intentsmith-local-capability': localCapability },
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.credentialType, 'local-capability');
  assert.deepEqual(allowed.subject, { actorType: 'user', actorId: 'local-operator' });
  const rejected = authorize({
    localCapability,
    headers: { 'x-intentsmith-local-capability': 'B'.repeat(43) },
  });
  assert.equal(rejected.allowed, false);
});

test('admin token is timing-safe authority and mixed credentials fail closed', () => {
  const bearer = authorize({ headers: { authorization: 'Bearer admin-secret' } });
  assert.equal(bearer.allowed, true);
  assert.equal(bearer.credentialType, 'admin-token');
  const header = authorize({ headers: { 'x-admin-token': 'admin-secret' } });
  assert.equal(header.allowed, true);
  const apiTokenInAdminHeader = authorize({
    headers: { 'x-admin-token': 'c3_reader' },
    validateApiToken: () => ({ valid: true, id: 'reader', scopes: ['write'] }),
  });
  assert.equal(apiTokenInAdminHeader.allowed, false);
  assert.equal(apiTokenInAdminHeader.code, GLOBAL_AUTH_REQUIRED);
  const ambiguous = authorize({
    headers: {
      authorization: 'Bearer admin-secret',
      'x-admin-token': 'admin-secret',
    },
  });
  assert.equal(ambiguous.allowed, false);
  assert.equal(ambiguous.code, GLOBAL_AUTH_CREDENTIAL_AMBIGUOUS);
});

test('API token scopes are route-class bound and cannot self-upgrade', () => {
  const validateApiToken = () => ({ valid: true, id: 'reader', scopes: ['read'] });
  const read = authorize({
    routeKey: 'GET /api/projects',
    headers: { authorization: 'Bearer c3_reader' },
    validateApiToken,
  });
  assert.equal(read.allowed, true);
  assert.equal(read.subject.actorId, 'api-token:reader');
  const write = authorize({
    headers: { authorization: 'Bearer c3_reader' },
    validateApiToken,
  });
  assert.equal(write.allowed, false);
  assert.equal(write.status, 403);
  assert.equal(write.code, GLOBAL_AUTH_SCOPE_REQUIRED);

  const approval = authorize({
    routeKey: 'POST /api/lifecycle/spec/approve',
    headers: { authorization: 'Bearer c3_approver' },
    validateApiToken: () => ({ valid: true, id: 'approver', scopes: ['approve'] }),
  });
  assert.equal(approval.allowed, true);
  const admin = authorize({
    routeKey: 'POST /api/system/backup',
    headers: { authorization: 'Bearer c3_writer' },
    validateApiToken: () => ({ valid: true, id: 'writer', scopes: ['write'] }),
  });
  assert.equal(admin.allowed, false);
  assert.equal(admin.code, GLOBAL_AUTH_SCOPE_REQUIRED);
});

test('WebSocket bearer protocol round-trips exactly and rejects malformed encodings', () => {
  const protocol = encodeWebSocketBearerCredential('admin secret / unicode-ž');
  assert.equal(extractWebSocketBearerCredential(`c3-v1, ${protocol}`), 'admin secret / unicode-ž');
  assert.equal(extractWebSocketBearerCredential(`${protocol}, ${protocol}`), null);
  assert.equal(extractWebSocketBearerCredential('intentsmith-auth-v1.%%%'), null);
});

function verifyUpgrade({
  capability,
  protocols,
  origin,
  production = true,
  adminToken = 'admin-secret',
} = {}) {
  let callback = null;
  const request = {
    headers: {
      host: '127.0.0.1:3335',
      ...(protocols ? { 'sec-websocket-protocol': protocols } : {}),
    },
    socket: { remoteAddress: LOCAL },
  };
  const verify = wsInternals.createLegacyWebSocketVerifyClient({
    httpServer: { address: () => ({ port: 3335 }) },
    allowedOrigins: [],
    localCapability: capability,
    adminToken,
    production,
    validateApiToken: () => ({ valid: false }),
    logger: { warn() {} },
  });
  verify({ req: request, origin }, (allowed, status, reason) => {
    callback = { allowed, status, reason };
  });
  return { callback, request };
}

test('WS upgrade binds capability-derived subject and production native bypass is closed', () => {
  const capability = createLegacyLocalCapability();
  const withCapability = verifyUpgrade({
    capability,
    protocols: `c3-v1, c3-local-v1.${capability}`,
  });
  assert.equal(withCapability.callback.allowed, true);
  assert.deepEqual(withCapability.request.authenticatedSubject, {
    actorType: 'user',
    actorId: 'local-operator',
  });

  const withoutCredential = verifyUpgrade({ capability });
  assert.equal(withoutCredential.callback.allowed, false);
  assert.equal(withoutCredential.callback.status, 401);

  const adminProtocol = encodeWebSocketBearerCredential('admin-secret');
  const withAdmin = verifyUpgrade({ capability, protocols: `c3-v1, ${adminProtocol}` });
  assert.equal(withAdmin.callback.allowed, true);
  assert.equal(withAdmin.request.authenticatedSubject.actorId, 'admin-token');
});

test('WS still rejects foreign origin before any credential is considered', () => {
  const capability = createLegacyLocalCapability();
  const result = verifyUpgrade({
    capability,
    protocols: `c3-v1, c3-local-v1.${capability}`,
    origin: 'https://evil.example',
  });
  assert.equal(result.callback.allowed, false);
  assert.equal(result.callback.status, 403);
});

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForPortFile(child, portFile, output) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Production auth server exited early: ${output()}`);
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(portFile, 'utf8'));
      if (Number.isInteger(parsed.port) && parsed.port > 0 && parsed.localCapability) return parsed;
    } catch { /* server is still starting */ }
    await delay(50);
  }
  throw new Error(`Production auth server did not publish its port: ${output()}`);
}

function request(port, method, pathname, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const bytes = body === null ? null : Buffer.from(JSON.stringify(body));
    const req = httpRequest({
      host: LOCAL,
      port,
      method,
      path: pathname,
      headers: bytes
        ? { 'content-type': 'application/json', 'content-length': bytes.length, ...headers }
        : headers,
    }, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { /* non-JSON response */ }
        resolve({ status: res.statusCode, headers: res.headers, json, raw });
      });
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error('HTTP auth probe timed out')));
    if (bytes) req.write(bytes);
    req.end();
  });
}

function websocketAttempt(url, protocols) {
  return new Promise(resolve => {
    const ws = protocols ? new WebSocket(url, protocols) : new WebSocket(url);
    const finish = result => {
      try { ws.terminate(); } catch { /* already closed */ }
      resolve(result);
    };
    ws.once('open', () => finish({ opened: true }));
    ws.once('unexpected-response', (_req, res) => finish({ opened: false, status: res.statusCode }));
    ws.once('error', error => finish({ opened: false, error: error.message }));
    setTimeout(() => finish({ opened: false, error: 'timeout' }), 5_000).unref();
  });
}

test('production server enforces one HTTP/WS auth boundary before effects', async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'intentsmith-m5-auth-live-'));
  const runtime = path.join(fixture, 'runtime');
  const projects = path.join(fixture, 'projects');
  const home = path.join(fixture, 'home');
  for (const directory of [runtime, projects, home]) fs.mkdirSync(directory, { recursive: true });
  const portFile = path.join(runtime, 'port.json');
  const adminToken = 'm5-production-admin-test-credential';
  let output = '';
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH || '',
      HOME: home,
      LANG: 'C.UTF-8',
      TZ: 'UTC',
      NODE_ENV: 'production',
      CI: '1',
      DOTENV_CONFIG_PATH: path.join(runtime, 'missing.env'),
      DOTENV_CONFIG_QUIET: 'true',
      C3_ADMIN_TOKEN: adminToken,
      C3_HOST: LOCAL,
      C3_PORT: '0',
      C3_PORT_FILE: portFile,
      C3_DB_PATH: path.join(runtime, 'auth.sqlite'),
      C3_PROJECTS_DIR: projects,
      C3_CORS_ORIGINS: '',
      C3_ENABLE_AGENTS: 'false',
      C3_ENABLE_EXPERTISES: 'false',
      C3_ENABLE_LIFECYCLE: 'false',
      C3_ENABLE_COMFYUI: 'false',
      C3_ENABLE_AUTONOMY: 'false',
      C3_ENABLE_SKILLS: 'false',
      C3_ENABLE_TELEMETRY: 'false',
      C3_MODEL_UNIVERSE_ENABLED: 'false',
      C3_UPDATE_REPO: '',
      C3_LOG_LEVEL: 'warn',
      OLLAMA_URL: 'invalid://m5-auth-no-model-provider',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { output = `${output}${chunk}`.slice(-12_000); });
  child.stderr.on('data', chunk => { output = `${output}${chunk}`.slice(-12_000); });

  try {
    const access = await waitForPortFile(child, portFile, () => output);
    const publicHealth = await request(access.port, 'GET', '/api/health');
    assert.equal(publicHealth.status, 200);
    assert.equal(publicHealth.json.status, 'ok');
    assert.equal(publicHealth.json.ready, true);
    assert.deepEqual(publicHealth.json.health, { database: true, lifecycleRecovery: true });
    assert.match(publicHealth.headers['x-request-id'], /^http:[A-Za-z0-9-]+$/);

    const deniedRead = await request(access.port, 'GET', '/api/projects');
    assert.equal(deniedRead.status, 401);
    assert.equal(deniedRead.json.code, GLOBAL_AUTH_REQUIRED);
    assert.match(deniedRead.headers['www-authenticate'], /^Bearer /);

    const adminRead = await request(access.port, 'GET', '/api/projects', {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(adminRead.status, 200, adminRead.raw);

    const studioRead = await request(access.port, 'GET', '/api/projects', {
      headers: { 'x-intentsmith-local-capability': access.localCapability },
    });
    assert.equal(studioRead.status, 200, studioRead.raw);

    const issued = await request(access.port, 'POST', '/api/security/tokens', {
      headers: { authorization: `Bearer ${adminToken}` },
      body: { name: 'M5 read-only proof', scopes: ['read'], expiresIn: 60 },
    });
    assert.equal(issued.status, 201, issued.raw);
    assert.match(issued.json.token, /^c3_/);

    const scopedRead = await request(access.port, 'GET', '/api/projects', {
      headers: { authorization: `Bearer ${issued.json.token}` },
    });
    assert.equal(scopedRead.status, 200, scopedRead.raw);
    const scopedWrite = await request(access.port, 'POST', '/api/projects', {
      headers: { authorization: `Bearer ${issued.json.token}` },
      body: { name: 'must not exist' },
    });
    assert.equal(scopedWrite.status, 403);
    assert.equal(scopedWrite.json.code, GLOBAL_AUTH_SCOPE_REQUIRED);

    const diagnostics = await request(access.port, 'GET', '/api/system/diagnostics', {
      headers: { authorization: `Bearer ${issued.json.token}` },
    });
    assert.equal(diagnostics.status, 200, diagnostics.raw);
    assert.equal(diagnostics.json.contract, 'intentsmith.production-diagnostics');
    assert.equal(diagnostics.json.version, 1);
    assert.equal(diagnostics.json.readiness.database, true);
    assert.equal(diagnostics.json.readiness.lifecycleRecovery.complete, true);
    assert.deepEqual(diagnostics.json.outbound.decisions, {});
    assert.deepEqual(diagnostics.json.outbound.recent, []);
    assert.equal(diagnostics.json.http.failureCounts.authentication >= 1, true);
    assert.equal(diagnostics.json.http.failureCounts.authorization >= 1, true);
    assert.equal(diagnostics.json.http.recentFailures.some(item => (
      item.errorCode === GLOBAL_AUTH_REQUIRED
    )), true);
    assert.doesNotMatch(JSON.stringify(diagnostics.json), new RegExp(adminToken));

    const wsUrl = `ws://${LOCAL}:${access.port}/c3/ws`;
    const unauthenticatedWs = await websocketAttempt(wsUrl);
    assert.equal(unauthenticatedWs.opened, false);
    assert.equal(unauthenticatedWs.status, 401);
    const studioWs = await websocketAttempt(wsUrl, [
      'c3-v1',
      `c3-local-v1.${access.localCapability}`,
    ]);
    assert.equal(studioWs.opened, true, studioWs.error);
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    const deadline = Date.now() + 10_000;
    while (child.exitCode === null && Date.now() < deadline) await delay(50);
    if (child.exitCode === null) child.kill('SIGKILL');
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
