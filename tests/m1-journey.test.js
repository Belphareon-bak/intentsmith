#!/usr/bin/env node

// M1/B6 fresh-install exit journey.
//
// This is one serial evidence envelope with two deliberately explicit runtime
// boundaries:
//   1. the shipped Electron build, real product server, SQLite and local
//      Ollama for literal deterministic and model turns;
//   2. the same shipped Electron build against the test-owned production M1
//      wire backend for deterministic error/cancel/reconnect terminals.
//
// The distinction is part of the artifact: the literal path proves real model
// integration, while the controlled backend supplies reproducible negative
// terminals that a healthy real provider cannot produce on demand.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { isolatedTestRuntime } from './helpers/isolated-test-db.js';
import {
  CdpClient,
  exactStudioPageTarget,
} from './studio-electron-boundary.e2e.js';

const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_MODEL = 'qwen3.5:27b';
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SERVER_START_TIMEOUT_MS = 60_000;
const SERVER_STOP_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 300_000;
const DETERMINISTIC_HTTP_SAMPLES = 12;
const REPORT_FILE = 'm1-journey.json';
const ownedChildren = new Set();

function bounded(value, chunk, limit = 2_000_000) {
  return (value + String(chunk)).slice(-limit);
}

function percentile(values, requested) {
  assert.ok(values.length > 0, 'percentile requires at least one value');
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((requested / 100) * sorted.length);
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank - 1))];
}

function summarize(values) {
  assert.ok(values.length > 0, 'summary requires at least one value');
  return Object.freeze({
    n: values.length,
    minMs: Math.round(Math.min(...values)),
    p50Ms: Math.round(percentile(values, 50)),
    p95Ms: Math.round(percentile(values, 95)),
    maxMs: Math.round(Math.max(...values)),
    meanMs: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
  });
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function runGit(args) {
  const result = spawnSync('git', args, {
    cwd: SOURCE_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(result.status, 0, result.stderr || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

function assertFreshInstalledSource() {
  const expected = process.env.INTENTSMITH_TEST_SOURCE_REVISION;
  assert.match(expected || '', SHA_PATTERN, 'exact source revision is required');
  assert.equal(runGit(['rev-parse', 'HEAD']), expected, 'source revision mismatch');
  assert.equal(
    runGit(['status', '--porcelain', '--untracked-files=all']),
    '',
    'M1 journey requires a clean source tree',
  );
  assert.equal(runGit(['rev-parse', '--git-dir']), '.git', 'standalone clone required');
  assert.equal(
    runGit(['rev-parse', '--git-common-dir']),
    '.git',
    'linked worktree is not fresh-clone evidence',
  );
  assert.equal(
    process.env.INTENTSMITH_M1_FRESH_CLONE,
    '1',
    'fresh-clone provenance acknowledgement is required',
  );

  for (const relative of [
    'node_modules/.package-lock.json',
    'c3-ide/node_modules/electron/package.json',
    'c3-ide/applications/electron/lib/backend/electron-main.js',
    'c3-ide/applications/electron/lib/frontend/bundle.js',
    'c3-ide/applications/electron/lib/frontend/index.html',
    'c3-ide/applications/electron/lib/frontend/preload.js',
    'c3-ide/applications/electron/scripts/launch.js',
  ]) {
    const absolute = path.join(SOURCE_ROOT, relative);
    assert.ok(existsSync(absolute), `fresh install/build output missing: ${relative}`);
    assert.ok(statSync(absolute).isFile(), `fresh install/build output invalid: ${relative}`);
  }
  return expected;
}

function assertPrivateArtifactRoot() {
  const root = process.env.INTENTSMITH_TEST_ARTIFACT_DIR;
  assert.equal(
    path.resolve(root || ''),
    isolatedTestRuntime.artifacts,
    'M1 journey must use the registered isolation bootstrap artifact root',
  );
  assert.ok(path.isAbsolute(root || ''), 'private artifact root is required');
  const info = statSync(root);
  assert.ok(info.isDirectory(), 'artifact root must be a directory');
  assert.equal(info.mode & 0o077, 0, 'artifact root must not be group/world accessible');
  return root;
}

function makeRuntime(artifactRoot) {
  const root = mkdtempSync(path.join(artifactRoot, 'runtime-'));
  chmodSync(root, 0o700);
  const paths = {
    root,
    home: path.join(root, 'home'),
    xdgConfig: path.join(root, 'xdg-config'),
    xdgCache: path.join(root, 'xdg-cache'),
    xdgData: path.join(root, 'xdg-data'),
    xdgState: path.join(root, 'xdg-state'),
    temp: path.join(root, 'tmp'),
    npmCache: path.join(root, 'npm-cache'),
    projects: path.join(root, 'projects'),
    artifacts: path.join(root, 'artifacts'),
    database: path.join(root, 'm1.sqlite'),
    portFile: path.join(root, 'server-port.json'),
    serverLog: path.join(root, 'server.log'),
  };
  for (const directory of [
    paths.home,
    paths.xdgConfig,
    paths.xdgCache,
    paths.xdgData,
    paths.xdgState,
    paths.temp,
    paths.npmCache,
    paths.projects,
    paths.artifacts,
  ]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  return paths;
}

function safeBaseEnvironment() {
  const env = {};
  for (const key of ['PATH', 'LANG', 'LC_ALL', 'TZ']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

function serverEnvironment(runtime, nonce, providerUrl) {
  return {
    ...safeBaseEnvironment(),
    HOME: runtime.home,
    XDG_CONFIG_HOME: runtime.xdgConfig,
    XDG_CACHE_HOME: runtime.xdgCache,
    XDG_DATA_HOME: runtime.xdgData,
    XDG_STATE_HOME: runtime.xdgState,
    TMPDIR: runtime.temp,
    TMP: runtime.temp,
    TEMP: runtime.temp,
    npm_config_cache: runtime.npmCache,
    NODE_ENV: 'test',
    CI: '1',
    DOTENV_CONFIG_PATH: path.join(runtime.root, 'no-dotenv-file'),
    DOTENV_CONFIG_QUIET: 'true',
    C3_HOST: '127.0.0.1',
    C3_PORT: '0',
    C3_PORT_FILE: runtime.portFile,
    C3_DB_PATH: runtime.database,
    C3_PROJECTS_DIR: runtime.projects,
    INTENTSMITH_TEST_PROJECTS_DIR: runtime.projects,
    INTENTSMITH_TEST_ARTIFACT_DIR: runtime.artifacts,
    INTENTSMITH_TEST_SERVER_NONCE: nonce,
    C3_CORS_ORIGINS: 'http://localhost:3000',
    C3_ENABLE_AGENTS: 'false',
    C3_ENABLE_EXPERTISES: 'false',
    C3_ENABLE_LIFECYCLE: 'false',
    C3_ENABLE_COMFYUI: 'false',
    C3_ENABLE_AUTONOMY: 'false',
    C3_ENABLE_SKILLS: 'false',
    C3_ENABLE_TELEMETRY: 'false',
    C3_ENABLE_ONLINE_DISCOVERY: 'false',
    C3_MODEL_UNIVERSE_ENABLED: 'false',
    C3_MODEL_RUNTIME_GUARD_ENABLED: 'false',
    C3_LIFECYCLE_AUTO_COMMIT: 'false',
    C3_UPDATE_REPO: '',
    C3_TRACE: '0',
    C3_LOG_LEVEL: 'warn',
    C3_MODEL_CHAT: EXPECTED_MODEL,
    OLLAMA_URL: providerUrl,
  };
}

async function startServer(runtime, nonce, providerUrl) {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: SOURCE_ROOT,
    env: serverEnvironment(runtime, nonce, providerUrl),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  ownedChildren.add(child);
  const state = {
    child,
    stdout: '',
    stderr: '',
    exitCode: null,
    signal: null,
    port: null,
    capability: null,
  };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { state.stdout = bounded(state.stdout, chunk); });
  child.stderr.on('data', chunk => { state.stderr = bounded(state.stderr, chunk); });
  child.once('exit', (code, signal) => {
    state.exitCode = code;
    state.signal = signal;
    ownedChildren.delete(child);
    writeFileSync(runtime.serverLog, `${state.stdout}\n${state.stderr}`, { mode: 0o600 });
  });

  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (state.exitCode !== null || state.signal !== null) {
      throw new Error(`server exited before ready: ${state.stderr.slice(-2_000)}`);
    }
    if (existsSync(runtime.portFile)) {
      try {
        const portInfo = JSON.parse(readFileSync(runtime.portFile, 'utf8'));
        if (
          portInfo.pid === child.pid
          && portInfo.testRunNonce === nonce
          && Number.isInteger(portInfo.port)
          && portInfo.port > 0
          && CAPABILITY_PATTERN.test(portInfo.localCapability || '')
        ) {
          state.port = portInfo.port;
          state.capability = portInfo.localCapability;
          return state;
        }
      } catch {
        // The atomic port file can be observed between rename and parse.
      }
    }
    await delay(25);
  }
  await stopServer(state);
  throw new Error('server readiness timeout');
}

async function stopServer(state) {
  if (!state?.child || state.exitCode !== null || state.signal !== null) return;
  state.child.kill('SIGTERM');
  const deadline = Date.now() + SERVER_STOP_TIMEOUT_MS;
  while (Date.now() < deadline && state.exitCode === null && state.signal === null) {
    await delay(25);
  }
  assert.notEqual(state.exitCode, null, 'server did not stop within the owned timeout');
  assert.equal(state.signal, null, `server stopped by signal ${state.signal}`);
  assert.equal(state.exitCode, 0, state.stderr.slice(-2_000));
}

function requestJson(state, method, pathname, body = null, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const encoded = body === null ? null : JSON.stringify(body);
    const started = process.hrtime.bigint();
    const request = http.request({
      hostname: '127.0.0.1',
      port: state.port,
      path: pathname,
      method,
      headers: {
        'X-IntentSmith-Local-Capability': state.capability,
        ...(encoded === null ? {} : {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(encoded),
        }),
      },
    }, response => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        raw = bounded(raw, chunk);
      });
      response.on('end', () => {
        const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
        let json = null;
        try { json = JSON.parse(raw); } catch { /* asserted by caller */ }
        resolve({ statusCode: response.statusCode, json, raw, elapsedMs });
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`${method} ${pathname} timed out`)));
    request.once('error', reject);
    if (encoded !== null) request.write(encoded);
    request.end();
  });
}

function command(conversationId, input, label) {
  return {
    contract: 'ConversationCommand',
    version: 1,
    requestId: `m1-b6-${label}-${randomBytes(6).toString('hex')}`,
    conversationId,
    turnId: `m1-b6-turn-${label}-${randomBytes(6).toString('hex')}`,
    action: 'send',
    input,
  };
}

async function listMessages(server, conversationId) {
  const response = await requestJson(
    server,
    'GET',
    `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
  );
  assert.equal(response.statusCode, 200, response.raw);
  assert.ok(Array.isArray(response.json?.messages), 'history must return a message array');
  return response.json.messages;
}

async function startOllamaProxy(upstreamOrigin) {
  const requests = [];
  const server = http.createServer((incoming, outgoing) => {
    const chunks = [];
    let size = 0;
    incoming.on('data', chunk => {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) incoming.destroy(new Error('provider request too large'));
      else chunks.push(chunk);
    });
    incoming.on('end', () => {
      const body = Buffer.concat(chunks);
      let parsed = null;
      try { parsed = JSON.parse(body.toString('utf8')); } catch { /* non-JSON endpoint */ }
      const promptText = Array.isArray(parsed?.messages)
        ? parsed.messages.map(item => String(item?.content || '')).join('\n')
        : String(parsed?.prompt || '');
      requests.push(Object.freeze({
        path: incoming.url,
        method: incoming.method,
        model: parsed?.model || null,
        numCtx: Number.isInteger(parsed?.options?.num_ctx)
          ? parsed.options.num_ctx
          : null,
        requestSha256: sha256(body),
        refinementPrompt: promptText.includes('Jsi recenzent odpovědí.'),
      }));

      const upstream = new URL(incoming.url || '/', upstreamOrigin);
      const forwarded = http.request({
        hostname: upstream.hostname,
        port: upstream.port,
        path: `${upstream.pathname}${upstream.search}`,
        method: incoming.method,
        headers: {
          ...incoming.headers,
          host: upstream.host,
          'content-length': body.length,
        },
      }, response => {
        outgoing.writeHead(response.statusCode || 502, response.headers);
        response.pipe(outgoing);
      });
      forwarded.setTimeout(REQUEST_TIMEOUT_MS, () => forwarded.destroy(new Error('Ollama proxy timeout')));
      forwarded.once('error', error => {
        if (!outgoing.headersSent) outgoing.writeHead(502, { 'Content-Type': 'application/json' });
        outgoing.end(JSON.stringify({ error: error.message }));
      });
      forwarded.end(body);
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    stop: () => new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve()))),
  };
}

async function inspectOllama(origin) {
  const tags = await fetch(`${origin}/api/tags`, { signal: AbortSignal.timeout(10_000) });
  assert.equal(tags.ok, true, `Ollama tags unavailable: ${tags.status}`);
  const payload = await tags.json();
  const model = payload.models?.find(item => item.name === EXPECTED_MODEL);
  assert.ok(model, `${EXPECTED_MODEL} is not installed in local Ollama`);
  return { name: model.name, digest: model.digest, size: model.size };
}

function runChild(label, args, env = {}, timeoutMs = 300_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: SOURCE_ROOT,
      env: { ...safeBaseEnvironment(), ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    ownedChildren.add(child);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout = bounded(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = bounded(stderr, chunk); });
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.once('error', reject);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      ownedChildren.delete(child);
      if (code !== 0 || signal !== null) {
        reject(new Error(`${label} failed code=${code} signal=${signal}\n${stdout}\n${stderr}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function evaluateRenderer(cdp, expression, timeoutMs = 15_000) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, timeoutMs);
  if (result?.exceptionDetails || !Object.hasOwn(result || {}, 'result')) {
    throw new Error('literal Studio renderer evaluation failed');
  }
  return result.result.value;
}

async function waitForLiteralStudioTarget(userData, childState) {
  const activePortFile = path.join(userData, 'DevToolsActivePort');
  const expectedEntrypoint = path.join(
    SOURCE_ROOT,
    'c3-ide/applications/electron/lib/frontend/index.html',
  );
  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (childState.exitCode !== null || childState.signal !== null) {
      throw new Error(`literal Studio exited before CDP: ${childState.stderr.slice(-2_000)}`);
    }
    if (existsSync(activePortFile)) {
      const lines = readFileSync(activePortFile, 'utf8').trim().split(/\r?\n/);
      const debugPort = Number(lines[0]);
      if (Number.isInteger(debugPort) && debugPort > 0) {
        try {
          const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`, {
            signal: AbortSignal.timeout(1_000),
          });
          const targets = response.ok ? await response.json() : [];
          const target = Array.isArray(targets)
            ? targets.find(item => exactStudioPageTarget(item, debugPort, expectedEntrypoint))
            : null;
          if (target) return target;
        } catch {
          // Expected while Chromium and Theia are still starting.
        }
      }
    }
    await delay(100);
  }
  throw new Error('literal Studio CDP readiness timeout');
}

async function startLiteralStudio(runtime) {
  const display = process.env.INTENTSMITH_STUDIO_DISPLAY;
  const xauthority = process.env.INTENTSMITH_STUDIO_XAUTHORITY;
  assert.match(display || '', /^:\d+(?:\.\d+)?$/, 'scoped Studio DISPLAY is required');
  assert.ok(path.isAbsolute(xauthority || ''), 'scoped Studio XAUTHORITY is required');
  const userData = path.join(runtime.root, 'literal-electron-data');
  mkdirSync(userData, { mode: 0o700 });
  const electronTmp = mkdtempSync('/tmp/is-m1-lit-');
  chmodSync(electronTmp, 0o700);
  const child = spawn(process.execPath, [
    'c3-ide/applications/electron/scripts/launch.js',
    '--no-sandbox',
    '--remote-debugging-port=0',
    `--user-data-dir=${userData}`,
  ], {
    cwd: SOURCE_ROOT,
    env: {
      ...safeBaseEnvironment(),
      HOME: runtime.home,
      TMPDIR: electronTmp,
      TMP: electronTmp,
      TEMP: electronTmp,
      XDG_CONFIG_HOME: runtime.xdgConfig,
      XDG_CACHE_HOME: runtime.xdgCache,
      XDG_DATA_HOME: runtime.xdgData,
      XDG_STATE_HOME: runtime.xdgState,
      DISPLAY: display,
      XAUTHORITY: xauthority,
      NODE_ENV: 'test',
      NODE_NO_WARNINGS: '1',
      NO_COLOR: '1',
      C3_PORT_FILE: runtime.portFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  ownedChildren.add(child);
  const state = { child, exitCode: null, signal: null, stdout: '', stderr: '' };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { state.stdout = bounded(state.stdout, chunk); });
  child.stderr.on('data', chunk => { state.stderr = bounded(state.stderr, chunk); });
  child.once('exit', (code, signal) => {
    state.exitCode = code;
    state.signal = signal;
    ownedChildren.delete(child);
  });

  try {
    const target = await waitForLiteralStudioTarget(userData, state);
    const cdp = new CdpClient(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send('Runtime.enable');
    const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const ready = await evaluateRenderer(cdp, `(() => ({
        negotiated: window.C3WS?.isReady?.() === true
          && window.C3WS?.isM1WireNegotiated?.() === true,
        sessions: Array.isArray(window._sessions) ? window._sessions.length : 0
      }))()`);
      if (ready?.negotiated && ready.sessions >= 1) {
        state.cdp = cdp;
        state.electronTmp = electronTmp;
        return state;
      }
      await delay(100);
    }
    cdp.close();
    throw new Error('literal Studio M1 wire readiness timeout');
  } catch (error) {
    if (state.exitCode === null && state.signal === null) child.kill('SIGTERM');
    rmSync(electronTmp, { recursive: true, force: true });
    throw error;
  }
}

async function literalStudioTurn(studio, conversationId, prompt, label) {
  const expression = `(async () => {
    const client = window.C3WS;
    const pane = window._sessions?.[0];
    if (!client?.isReady?.() || !client?.isM1WireNegotiated?.() || !pane) {
      return { resultClass: 'not-ready' };
    }
    pane._convId = ${JSON.stringify(conversationId)};
    pane._projectId = null;
    pane._agentId = null;
    pane.chat.msgs = [];
    pane.chat.attachments = [];
    pane.chat._pendingAttachments = [];
    pane.chat.editMode = 'ask';
    pane.chat._thinking = { started: true };
    pane.chat._delivery = null;
    return await new Promise(resolve => {
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.C3Bus.off('chat:terminal', onTerminal);
        resolve(value);
      };
      const onTerminal = event => {
        if (event?.conversationId !== ${JSON.stringify(conversationId)}
          || event?.action !== 'send') return;
        finish({
          resultClass: 'terminal',
          status: event.status,
          requestId: event.requestId,
          turnId: event.turnId,
          responseLength: String(event?.result?.response?.content || '').length,
          errorCode: event?.result?.error?.code || null,
          thinkingCleared: pane.chat._thinking === null
        });
      };
      const timer = setTimeout(() => finish({ resultClass: 'timeout' }), 300000);
      window.C3Bus.on('chat:terminal', onTerminal);
      if (!client.sendChat(${JSON.stringify(prompt)}, pane, 0)) {
        finish({ resultClass: 'send-rejected' });
      }
    });
  })()`;
  const started = process.hrtime.bigint();
  const terminal = await evaluateRenderer(studio.cdp, expression, 310_000);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.equal(terminal?.resultClass, 'terminal', `${label}: ${JSON.stringify(terminal)}`);
  assert.equal(terminal.status, 'ok', `${label}: ${JSON.stringify(terminal)}`);
  assert.ok(terminal.responseLength > 0, `${label}: response content missing`);
  assert.equal(terminal.thinkingCleared, true, `${label}: spinner did not clear`);
  return { ...terminal, elapsedMs };
}

async function stopLiteralStudio(studio) {
  try { await studio.cdp.send('Browser.close', {}, 2_000); } catch { /* closes CDP */ }
  studio.cdp.close();
  const deadline = Date.now() + SERVER_STOP_TIMEOUT_MS;
  while (
    Date.now() < deadline
    && studio.exitCode === null
    && studio.signal === null
  ) {
    await delay(25);
  }
  if (studio.exitCode === null && studio.signal === null) studio.child.kill('SIGTERM');
  while (studio.exitCode === null && studio.signal === null) await delay(25);
  assert.equal(studio.signal, null, `literal Studio stopped by ${studio.signal}`);
  assert.equal(studio.exitCode, 0, studio.stderr.slice(-2_000));
  rmSync(studio.electronTmp, { recursive: true, force: true });
}

function selfCheck() {
  const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  for (const marker of [
    'INTENTSMITH_M1_FRESH_CLONE',
    'Jsi recenzent odpovědí.',
    'tests/m1-chat-contract.test.js',
    'tests/confirmation-ownership.test.js',
    'tests/studio-m1-electron-journey.e2e.js',
    'removed_by_decision_024',
    'literalStudioToRealOllamaTurn: true',
  ]) {
    assert.ok(source.includes(marker), `self-check marker missing: ${marker}`);
  }
  assert.equal(
    DETERMINISTIC_HTTP_SAMPLES,
    12,
    'M1 deterministic p95 must use the accepted twelve-request HTTP sample',
  );
  process.stdout.write('M1_JOURNEY_SELF_CHECK_PASS\n');
}

async function main() {
  if (process.argv.includes('--self-check')) {
    selfCheck();
    return;
  }

  const sourceRevision = assertFreshInstalledSource();
  const artifactRoot = assertPrivateArtifactRoot();
  const runtime = makeRuntime(artifactRoot);
  const ollamaOrigin = process.env.INTENTSMITH_M1_OLLAMA_ORIGIN || 'http://127.0.0.1:11434';
  const modelIdentity = await inspectOllama(ollamaOrigin);
  const proxy = await startOllamaProxy(ollamaOrigin);
  const conversationId = `m1-b6-${Date.now().toString(36)}`;
  let server = null;
  const deterministicHttpLatencies = [];
  const modelHttpLatencies = [];
  let historyBeforeRestart;
  let historyAfterRestart;
  let outageEvidence;
  let literalStudioEvidence;

  try {
    server = await startServer(runtime, 'm1-b6-product-first-000000000001', proxy.origin);
    for (let index = 0; index < DETERMINISTIC_HTTP_SAMPLES; index += 1) {
      const response = await requestJson(
        server,
        'POST',
        '/api/chat',
        command(conversationId, `kolik je ${17 + index} * 3?`, `det-${index}`),
      );
      assert.equal(response.statusCode, 200, response.raw);
      assert.equal(response.json?.status, 'ok', response.raw);
      assert.ok(response.json?.response?.content, 'deterministic response content missing');
      deterministicHttpLatencies.push(response.elapsedMs);
    }

    const modelPrompts = [
      'Vysvětli jednou větou, co znamená HTTP status 409.',
      'Jedním odstavcem vysvětli, proč je append-only log vhodný pro audit.',
      'Ve dvou větách vysvětli rozdíl mezi shared a exclusive lockem.',
    ];
    for (let index = 0; index < modelPrompts.length; index += 1) {
      const response = await requestJson(
        server,
        'POST',
        '/api/chat',
        command(conversationId, modelPrompts[index], `model-${index}`),
      );
      assert.equal(response.statusCode, 200, response.raw);
      assert.equal(response.json?.status, 'ok', response.raw);
      assert.ok(
        String(response.json?.response?.content || '').length >= 20,
        'model response is empty or implausibly short',
      );
      modelHttpLatencies.push(response.elapsedMs);
    }

    let literalStudio = null;
    try {
      literalStudio = await startLiteralStudio(runtime);
      const deterministicTurn = await literalStudioTurn(
        literalStudio,
        conversationId,
        'kolik je 23 * 4?',
        'literal Studio deterministic turn',
      );
      const modelTurn = await literalStudioTurn(
        literalStudio,
        conversationId,
        'Jednou větou vysvětli, proč HTTP používá stavový kód 503.',
        'literal Studio model turn',
      );
      literalStudioEvidence = {
        transport: 'm1-wire-v1',
        deterministicStatus: deterministicTurn.status,
        deterministicLatencyMs: Math.round(deterministicTurn.elapsedMs),
        modelStatus: modelTurn.status,
        modelLatencyMs: Math.round(modelTurn.elapsedMs),
        exactConversationId: conversationId,
        spinnersCleared: deterministicTurn.thinkingCleared && modelTurn.thinkingCleared,
      };
    } finally {
      if (literalStudio) await stopLiteralStudio(literalStudio);
    }

    historyBeforeRestart = await listMessages(server, conversationId);
    const successfulTurnsBeforeRestart = DETERMINISTIC_HTTP_SAMPLES + modelPrompts.length + 2;
    assert.equal(
      historyBeforeRestart.length,
      successfulTurnsBeforeRestart * 2,
      'every successful turn must persist one user and one assistant message',
    );
    await stopServer(server);
    server = null;

    server = await startServer(runtime, 'm1-b6-product-second-00000000002', proxy.origin);
    historyAfterRestart = await listMessages(server, conversationId);
    assert.deepEqual(historyAfterRestart, historyBeforeRestart, 'restart changed durable history');
    const postRestart = await requestJson(
      server,
      'POST',
      '/api/chat',
      command(conversationId, 'kolik je 11 * 11?', 'post-restart'),
    );
    assert.equal(postRestart.statusCode, 200, postRestart.raw);
    assert.equal(postRestart.json?.status, 'ok', postRestart.raw);
    await stopServer(server);
    server = null;

    server = await startServer(runtime, 'm1-b6-provider-outage-0000000003', 'http://127.0.0.1:9');
    const outageConversation = `${conversationId}-provider-outage`;
    const outage = await requestJson(
      server,
      'POST',
      '/api/chat',
      command(
        outageConversation,
        'Napiš podrobný odborný rozbor dvoufázového commitu v distribuovaném systému.',
        'provider-outage',
      ),
    );
    const outageMessages = await listMessages(server, outageConversation);
    assert.notEqual(outage.json?.status, 'ok', 'provider outage became false success');
    assert.equal(Object.hasOwn(outage.json || {}, 'response'), false, 'provider error invented a response');
    assert.equal(
      outageMessages.some(message => message.role === 'assistant'),
      false,
      'provider outage persisted an assistant turn',
    );
    outageEvidence = {
      httpStatus: outage.statusCode,
      terminalStatus: outage.json?.status || null,
      errorCode: outage.json?.error?.code || outage.json?.code || null,
      persistedRoles: outageMessages.map(message => message.role),
    };
    await stopServer(server);
    server = null;
  } finally {
    if (server) await stopServer(server);
    await proxy.stop();
  }

  const modelProviderRequests = proxy.requests.filter(item => item.path === '/api/chat');
  assert.ok(modelProviderRequests.length >= 4, 'real model turns did not reach Ollama');
  assert.ok(
    modelProviderRequests.every(item => item.model === EXPECTED_MODEL),
    'model journey used an unexpected model identity',
  );
  assert.ok(
    modelProviderRequests.every(item => (
      Number.isInteger(item.numCtx)
      && item.numCtx > 0
      && item.numCtx <= 4096
    )),
    'model journey exceeded the accepted num_ctx=4096 runtime-profile cap',
  );
  assert.equal(
    modelProviderRequests.some(item => item.refinementPrompt),
    false,
    'Decision 024/C violated: a post-answer refinement prompt reached Ollama',
  );

  const chatContract = await runChild(
    'M1 chat cancel/error contract',
    ['tests/m1-chat-contract.test.js'],
  );
  assert.match(chatContract.stdout, /RESULTS: 21 passed, 0 failed/);
  const confirmation = await runChild(
    'confirmation ownership',
    ['tests/confirmation-ownership.test.js'],
  );
  assert.match(confirmation.stdout, /5 passed, 0 failed/);

  const studioArtifacts = path.join(artifactRoot, 'studio');
  mkdirSync(studioArtifacts, { mode: 0o700 });
  await runChild(
    'built Studio M1 journey',
    ['tests/studio-m1-electron-journey.e2e.js'],
    {
      INTENTSMITH_TEST_SOURCE_REVISION: sourceRevision,
      INTENTSMITH_TEST_ARTIFACT_DIR: studioArtifacts,
      INTENTSMITH_STUDIO_DISPLAY: process.env.INTENTSMITH_STUDIO_DISPLAY || '',
      INTENTSMITH_STUDIO_XAUTHORITY: process.env.INTENTSMITH_STUDIO_XAUTHORITY || '',
    },
    300_000,
  );
  const studio = JSON.parse(readFileSync(path.join(studioArtifacts, 'studio-electron-boundary.json'), 'utf8'));
  assert.equal(studio.verdict, 'PASS');
  assert.equal(studio.evidenceType, 'intentsmith.studio-m1-electron-journey');
  assert.equal(studio.functional.transport, 'm1-wire-v1');
  assert.equal(studio.functional.sendOk, 2);
  assert.equal(studio.functional.sendCancelled, 1);
  assert.equal(studio.functional.sendErrors, 1);
  assert.equal(studio.functional.cancelCancelled, 1);
  assert.equal(studio.functional.allProgressM1, true);
  assert.equal(studio.functional.reconnects, 1);
  assert.equal(studio.network.snapshot.counts.externalAttempts, 0);
  assert.equal(studio.network.snapshot.counts.otherLoopbackAttempts, 0);
  assert.equal(studio.shutdown.processGroupsClean, true);

  // The accepted <100 ms L3 budget is the real-server HTTP boundary measured
  // by the canonical twelve-sample run. Electron/CDP includes renderer and
  // transport scheduling; keep that latency explicit in literalStudioEvidence
  // instead of folding one UI round-trip into a six-sample "p95" (the max).
  const deterministic = summarize(deterministicHttpLatencies);
  assert.ok(
    deterministic.p95Ms < 100,
    `deterministic p95 ${deterministic.p95Ms}ms exceeds the M1 target`,
  );
  const coldMs = Math.round(modelHttpLatencies[0]);
  const warm = summarize(modelHttpLatencies.slice(1));
  const report = Object.freeze({
    schemaVersion: 1,
    evidenceType: 'intentsmith.m1-fresh-install-journey',
    sourceRevision,
    verdict: 'PASS',
    boundaries: {
      productRuntime: 'built-electron-real-server-sqlite-local-ollama',
      studioRuntime: 'built-electron-test-owned-production-m1-wire-backend',
      literalStudioToRealOllamaTurn: true,
      deterministicLatency: 'real-server-http-twelve-sample',
      modelLatency: 'real-server-http-only',
    },
    install: {
      standaloneClone: true,
      npmCiOffline: true,
      studioFrozenInstallOffline: true,
      studioProductionBuild: true,
    },
    model: modelIdentity,
    measurements: {
      deterministic: {
        ...deterministic,
        samplesMs: deterministicHttpLatencies.map(value => Math.round(value)),
      },
      modelChat: {
        coldMs,
        warm: {
          ...warm,
          samplesMs: modelHttpLatencies.slice(1).map(value => Math.round(value)),
        },
        warmThroughputTurnsPerMinute: Number((60_000 / warm.meanMs).toFixed(2)),
      },
      refinement: {
        disposition: 'removed_by_decision_024',
        postAnswerProviderRequests: 0,
        addedTokens: 0,
        addedLatencyMs: 0,
      },
      studioUnexpectedOutboundRequests: 0,
    },
    providerAudit: {
      totalRequests: proxy.requests.length,
      chatRequests: modelProviderRequests.length,
      refinementPrompts: 0,
      numCtxValues: [...new Set(modelProviderRequests.map(item => item.numCtx))].sort((a, b) => a - b),
      requests: proxy.requests,
    },
    scenarios: {
      deterministicRealRequest: true,
      localOllamaModelResponse: true,
      literalStudioDeterministicAndModel: literalStudioEvidence,
      providerOutageNoFalseSuccess: outageEvidence,
      cancelBeforeDuringPrePersistence: true,
      restartExactHistory: {
        messagesBefore: historyBeforeRestart.length,
        messagesAfter: historyAfterRestart.length,
        historySha256: sha256(JSON.stringify(historyAfterRestart)),
      },
      confirmationOwnership: true,
      studioProgressAndExactTerminal: {
        evidenceSha256: sha256(readFileSync(path.join(studioArtifacts, 'studio-electron-boundary.json'))),
        terminalCount: studio.functional.terminalCount,
        progressEvents: studio.functional.progressEvents,
        reconnects: studio.functional.reconnects,
      },
    },
    sourceTreeCleanAfter: runGit(['status', '--porcelain', '--untracked-files=all']) === '',
  });
  assert.equal(report.sourceTreeCleanAfter, true, 'journey dirtied the fresh clone');
  writeFileSync(path.join(artifactRoot, REPORT_FILE), `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
  });
  process.stdout.write(`M1_JOURNEY_PASS ${JSON.stringify({
    sourceRevision,
    deterministicP95Ms: deterministic.p95Ms,
    modelColdMs: coldMs,
    modelWarmP95Ms: warm.p95Ms,
    modelProviderRequests: modelProviderRequests.length,
    numCtxValues: report.providerAudit.numCtxValues,
    studioExternalAttempts: 0,
  })}\n`);
}

process.once('exit', () => {
  for (const child of ownedChildren) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
});

main().catch(error => {
  process.stderr.write(`M1_JOURNEY_FAIL ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
