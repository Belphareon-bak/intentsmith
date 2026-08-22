#!/usr/bin/env node
// Capability #1 — Server, routing, DB, migrations: behaviour acceptance
// ══════════════════════════════════════════════════════════════════════════════
//
// CONTRACT.md §3 step 3. One test per behaviour from
// docs/behaviours/01-server-routing-db.md. Behaviours already covered elsewhere
// are mapped, not duplicated:
//
//   B-02, B-03  → tests/schema-migrations.test.js   (T-SM1, T-SM2, T-SM9)
//   B-12, B-13  → tests/routes-smoke.test.js        (origin guard, loopback bind)
//
// This suite owns the remaining ten. It creates, owns and closes its own
// loopback listener in an isolated HOME/XDG/TMP fixture on an ephemeral port,
// and declares no server, database, Ollama or GPU prerequisite.
//
// ══════════════════════════════════════════════════════════════════════════════

import { spawn, spawnSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { isolatedTestRuntime } from './helpers/isolated-test-db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STARTUP_TIMEOUT_MS = 60_000;

let pass = 0;
let fail = 0;
const failures = [];

function check(condition, label) {
  if (condition) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    failures.push(label);
    console.error(`  ❌ ${label}`);
  }
}

function makeDir(...parts) {
  const dir = path.join(...parts);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Environment for a fully isolated server child. No inherited developer state. */
function serverEnv(fixture, overrides = {}) {
  return {
    PATH: process.env.PATH || '',
    LANG: 'C.UTF-8',
    TZ: 'UTC',
    HOME: fixture.home,
    XDG_CONFIG_HOME: fixture.xdgConfig,
    XDG_CACHE_HOME: fixture.xdgCache,
    XDG_DATA_HOME: fixture.xdgData,
    XDG_STATE_HOME: fixture.xdgState,
    TMPDIR: fixture.temp,
    TMP: fixture.temp,
    TEMP: fixture.temp,
    npm_config_cache: fixture.npmCache,
    NODE_ENV: 'test',
    CI: '1',
    DOTENV_CONFIG_PATH: path.join(fixture.runtime, 'no-dotenv-file'),
    DOTENV_CONFIG_QUIET: 'true',
    C3_HOST: '127.0.0.1',
    C3_PORT: '0',
    C3_PORT_FILE: fixture.portFile,
    C3_DB_PATH: fixture.database,
    C3_PROJECTS_DIR: fixture.projects,
    C3_ENABLE_AGENTS: 'false',
    C3_ENABLE_EXPERTISES: 'false',
    C3_ENABLE_LIFECYCLE: 'false',
    C3_ENABLE_COMFYUI: 'false',
    C3_ENABLE_AUTONOMY: 'false',
    C3_ENABLE_SKILLS: 'false',
    C3_ENABLE_TELEMETRY: 'false',
    C3_MODEL_UNIVERSE_ENABLED: 'false',
    C3_UPDATE_REPO: '',
    C3_LOG_LEVEL: 'info',
    // Guarantees B-14 runs with no reachable model provider.
    OLLAMA_URL: 'invalid://capability-01-no-model-provider',
    ...overrides,
  };
}

function startServer(fixture, overrides = {}) {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    env: serverEnv(fixture, overrides),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const state = { child, stdout: '', stderr: '', exitCode: null, signal: null };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', c => { state.stdout += c; });
  child.stderr.on('data', c => { state.stderr += c; });
  child.on('exit', (code, sig) => { state.exitCode = code; state.signal = sig; });
  return state;
}

async function waitForPort(state, portFile) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (state.exitCode !== null) return null;
    if (existsSync(portFile)) {
      try {
        const parsed = JSON.parse(readFileSync(portFile, 'utf8'));
        if (Number.isInteger(parsed.port) && parsed.port > 0) return parsed;
      } catch { /* file still being written */ }
    }
    await delay(150);
  }
  return null;
}

async function stopServer(state) {
  if (!state.child || state.exitCode !== null) return;
  state.child.kill('SIGTERM');
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && state.exitCode === null) await delay(100);
  if (state.exitCode === null) state.child.kill('SIGKILL');
}

/** Minimal HTTP probe. Returns status, raw body and parsed JSON when possible. */
function probe(port, { method = 'GET', pathname = '/', body = null, headers = {} } = {}) {
  return new Promise(resolve => {
    const payload = body === null ? null : Buffer.from(body);
    const req = httpRequest({
      host: '127.0.0.1',
      port,
      path: pathname,
      method,
      headers: payload
        ? { 'Content-Type': 'application/json', 'Content-Length': payload.length, ...headers }
        : headers,
      timeout: 45_000,
    }, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, raw, json });
      });
    });
    req.on('timeout', () => { req.destroy(new Error('probe timeout')); });
    req.on('error', err => resolve({ status: 0, raw: String(err.message), json: null }));
    if (payload) req.write(payload);
    req.end();
  });
}

function negotiateM1(portInfo, offeredFeatures) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `ws://127.0.0.1:${portInfo.port}/c3/ws`,
      ['c3-v1', `c3-local-v1.${portInfo.localCapability}`],
      { handshakeTimeout: 3_000, origin: 'null' },
    );
    let ack = null;
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('production M1 handshake timed out'));
    }, 5_000);
    socket.once('open', () => {
      socket.send(JSON.stringify({
        type: 'hello',
        protocolVersion: 1,
        ideVersion: 'm1-production-activation-test',
        features: offeredFeatures,
      }));
    });
    socket.on('message', raw => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch (error) {
        clearTimeout(timer);
        socket.terminate();
        reject(error);
        return;
      }
      if (message.type !== 'hello_ack') return;
      ack = message;
      socket.close(1000, 'test-complete');
    });
    socket.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    socket.once('close', () => {
      clearTimeout(timer);
      if (ack) resolve(ack);
      else reject(new Error('production M1 socket closed before hello_ack'));
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('\n══ Capability #1 — behaviour acceptance ══\n');

  const fixtureRoot = makeDir(isolatedTestRuntime.temp, "capability-01");
  const fixture = {
    home: makeDir(fixtureRoot, 'home'),
    xdgConfig: makeDir(fixtureRoot, 'xdg-config'),
    xdgCache: makeDir(fixtureRoot, 'xdg-cache'),
    xdgData: makeDir(fixtureRoot, 'xdg-data'),
    xdgState: makeDir(fixtureRoot, 'xdg-state'),
    temp: makeDir(fixtureRoot, 'tmp'),
    npmCache: makeDir(fixtureRoot, 'npm-cache'),
    projects: makeDir(fixtureRoot, 'projects'),
    runtime: makeDir(fixtureRoot, 'runtime'),
    database: path.join(fixtureRoot, 'runtime', 'server.sqlite'),
    portFile: path.join(fixtureRoot, 'runtime', 'server.port'),
  };

  let server = null;
  try {
    // ── B-04 — database module refuses to load without an explicit path ──────
    // Runs before any server so a stray default database cannot already exist.
    const strayDatabase = path.join(fixture.runtime, 'stray-default.sqlite');
    const guard = spawnSync(process.execPath, [
      '-e', "import('./src/db/database.js').then(()=>{console.log('LOADED');process.exit(0)},e=>{console.log('REFUSED:'+e.message);process.exit(3)})",
    ], {
      cwd: ROOT,
      env: { ...serverEnv(fixture), C3_DB_PATH: '' },
      encoding: 'utf8',
      timeout: 60_000,
    });
    check(
      guard.status === 3 && /C3_DB_PATH/.test(guard.stdout + guard.stderr) && !existsSync(strayDatabase),
      'B-04 — importing the database module without C3_DB_PATH is refused and creates no file',
    );

    // ── Start the owned server ───────────────────────────────────────────────
    server = startServer(fixture);
    const portInfo = await waitForPort(server, fixture.portFile);

    check(
      portInfo !== null && Number.isInteger(portInfo.port),
      'B-01 — a clean checkout starts with no configuration and publishes a port',
    );
    if (!portInfo) throw new Error(`server did not start:\n${server.stdout}\n${server.stderr}`);
    const { port } = portInfo;

    // ── B-15 — production M1 activation remains required-offer ─────────────
    const m1Ack = await negotiateM1(portInfo, ['m1-wire-v1']);
    const legacyAck = await negotiateM1(portInfo, []);
    check(
      m1Ack.features?.filter(feature => feature === 'm1-wire-v1').length === 1
        && legacyAck.features?.includes('m1-wire-v1') === false,
      'B-15 — production acknowledges m1-wire-v1 exactly once and only when offered',
    );

    // ── B-01 — the started server actually answers ───────────────────────────
    const root = await probe(port, { pathname: '/' });
    check(root.status === 200, 'B-01 — the started server answers GET / with 200');

    // ── B-05 — the port file names the port that is really listening ─────────
    check(
      root.status === 200 && portInfo.host === '127.0.0.1',
      'B-05 — the port file names the loopback port the server actually listens on',
    );

    // ── B-07 — unknown route is a JSON 404 ───────────────────────────────────
    const missing = await probe(port, { pathname: '/api/this-route-does-not-exist' });
    check(
      missing.status === 404 && missing.json !== null && typeof missing.json.error === 'string',
      'B-07 — an unknown route answers 404 with a JSON body',
    );

    // ── B-08 — malformed percent-encoding is a 404, never a 500 ──────────────
    const badEncoding = await probe(port, { pathname: '/api/conversations/%E0%A4%A' });
    check(
      badEncoding.status === 404,
      'B-08 — a malformed URL parameter answers 404 rather than 500',
    );

    // ── B-09 — malformed JSON body is a 400 ──────────────────────────────────
    const badJson = await probe(port, {
      method: 'POST', pathname: '/api/conversations', body: '{"title": ',
    });
    check(
      badJson.status === 400,
      'B-09 — a malformed JSON body answers 400 rather than 500',
    );

    // ── B-10 — oversized body is a 413 that states the limit ─────────────────
    const oversized = await probe(port, {
      method: 'POST',
      pathname: '/api/conversations',
      body: JSON.stringify({ title: 'x'.repeat(8 * 1024 * 1024) }),
    });
    check(
      oversized.status === 413 && /\d+\s*MB/i.test(oversized.raw),
      'B-10 — an oversized body answers 413 and states the limit',
    );

    // ── B-11 — no error response leaks a stack trace or an absolute path ─────
    const leaky = [missing, badEncoding, badJson, oversized].filter(r =>
      /\bat\s+\w+[^\n]*\(/.test(r.raw) || r.raw.includes(ROOT) || /\.js:\d+:\d+/.test(r.raw));
    check(
      leaky.length === 0,
      'B-11 — no error response contains a stack trace or an absolute path',
    );

    // ── B-14 — without a model the server keeps serving and says so ──────────
    const conversation = await probe(port, {
      method: 'POST', pathname: '/api/conversations', body: JSON.stringify({ title: 'b14' }),
    });
    const conversationId = conversation.json?.id
      || conversation.json?.conversation_id
      || conversation.json?.conversation?.id;
    const llm = conversationId
      ? await probe(port, {
        method: 'POST',
        pathname: '/api/chat',
        body: JSON.stringify({ conversation_id: conversationId, message: 'napiš mi báseň o podzimu' }),
      })
      : { status: 0, raw: 'no conversation id', json: null };
    const stillAlive = await probe(port, { pathname: '/' });
    check(
      llm.status === 503
      && llm.json?.code === 'LLM_PROVIDER_UNAVAILABLE'
      && llm.json?.recoverable === true
      && stillAlive.status === 200,
      'B-14 — with no reachable model the LLM path answers 503 LLM_PROVIDER_UNAVAILABLE and the server keeps serving',
    );

    // B-06 - a fatal startup error fails closed.
    // Second server aimed at the same, already-bound port.
    const occupied = startServer(fixture, { C3_PORT: String(port) });
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline && occupied.exitCode === null) await delay(150);
    const transcript = `${occupied.stdout}\n${occupied.stderr}`;
    const sawFatal = /Fatal error - shutting down|EADDRINUSE/.test(transcript);
    check(
      occupied.exitCode !== null && occupied.exitCode !== 0 && sawFatal,
      'B-06 \u2014 a fatal startup error exits non-zero',
    );
    check(
      sawFatal && /Database connection closed/.test(transcript),
      'B-06b \u2014 a fatal startup error closes the database it opened',
    );
    // A failed start must not clobber the running instance or its port file.
    const portFileAfterClash = existsSync(fixture.portFile)
      ? JSON.parse(readFileSync(fixture.portFile, 'utf8'))
      : null;
    const survivorStillServes = await probe(port, { pathname: '/' });
    check(
      portFileAfterClash?.port === port && survivorStillServes.status === 200,
      'B-06c \u2014 a failed start leaves the running instance and its port file untouched',
    );
    // Deliberately NOT asserted: "nothing initialises after the fatal branch".
    // Model-context initialisation races listen() and has been observed
    // finishing 6 ms after the fatal branch in one run and 8 ms before it in
    // another. That is a timing outcome, not a behaviour, and asserting it
    // would produce a flaky test. Recorded as finding R-1 in
    // docs/behaviours/01-server-routing-db.md.
    await stopServer(occupied);
  } finally {
    if (server) await stopServer(server);
    try { rmSync(fixtureRoot, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  console.log(`\n══ RESULTS: ${pass} passed, ${fail} failed ══`);
  if (failures.length) {
    console.error('\n  FAILURES:');
    for (const f of failures) console.error(`    ❌ ${f}`);
  }
  console.log('');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(`\nFATAL: ${err.stack || err.message}\n`);
  process.exit(1);
});
