#!/usr/bin/env node
// Explicit manual qualification, never launched at product startup. Defaults to
// a plan. Real server/Studio/model, disposable state and shared GPU lock.
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs, { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { CdpClient, exactStudioPageTarget } from '../tests/studio-electron-boundary.e2e.js';
import { acquireGpuEvaluationLock, assessScheduledEvaluationReadiness } from '../src/upgrade/gpu-evaluation-lock.js';
const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_MODEL = 'qwen3.5:27b';
const EXPECTED_DIGEST = '7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e';
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SERVER_START_TIMEOUT_MS = 60000, SERVER_STOP_TIMEOUT_MS = 20000, REQUEST_TIMEOUT_MS = 180000;
const ownedChildren = new Set();
const sha256 = value => createHash('sha256').update(value).digest('hex');
const save = (root, name, value) => writeFileSync(path.join(root, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const git = (args, cwd = SOURCE_ROOT) => execFileSync('/usr/bin/git', args, { cwd, encoding: 'utf8', env: {
  PATH: process.env.PATH, HOME: cwd, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',
} }).trim();
const self = fileURLToPath(import.meta.url);
function bounded(value, chunk, limit = 2_000_000) {
  return (value + String(chunk)).slice(-limit);
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
    projects: path.join(root, 'home', 'projects'),
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
    C3_LIFECYCLE_AUTO_COMMIT: 'false',
    C3_UPDATE_REPO: '',
    C3_TRACE: '0',
    C3_LOG_LEVEL: 'warn',
    C3_MODEL_CHAT: EXPECTED_MODEL, C3_MODEL_CODE: EXPECTED_MODEL,
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
    writeFileSync(runtime.serverLog + '.' + child.pid, `${state.stdout}\n${state.stderr}`, { mode: 0o600 });
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


async function evaluateRenderer(cdp, expression, timeoutMs = 15_000) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, timeoutMs);
  if (result?.exceptionDetails || !Object.hasOwn(result || {}, 'result')) {
    throw new Error('literal Studio renderer evaluation failed: ' + JSON.stringify(result.exceptionDetails));
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
  mkdirSync(userData, { mode: 0o700, recursive: true });
  rmSync(path.join(userData, 'DevToolsActivePort'), { force: true });
  const electronTmp = mkdtempSync('/tmp/is-m1-lit-');
  chmodSync(electronTmp, 0o700);
  const child = spawn(process.execPath, [
    'c3-ide/applications/electron/scripts/launch.js',
    '--no-sandbox', '--disable-gpu',
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
  if (studio.exitCode === null && studio.signal === null) {
    studio.child.kill('SIGTERM');
    const cleanupDeadline = Date.now() + SERVER_STOP_TIMEOUT_MS;
    while (Date.now() < cleanupDeadline && studio.exitCode === null && studio.signal === null) await delay(25);
    if (studio.exitCode === null && studio.signal === null) studio.child.kill('SIGKILL');
    throw new Error('Studio required forced cleanup');
  }
  assert.equal(studio.signal, null, `literal Studio stopped by ${studio.signal}`);
  assert.equal(studio.exitCode, 0, studio.stderr.slice(-2_000));
  rmSync(studio.electronTmp, { recursive: true, force: true });
}

async function waitUntil(probe, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await delay(100);
  }
  throw new Error('timeout: ' + label);
}

const ui = (studio, fn, args = {}) => evaluateRenderer(studio.cdp,
  '(' + fn.toString() + ')(' + JSON.stringify(args) + ')', 160000);

// Fixture registration and initial session selection are explicit setup.
// The actual draft and approval always use the rendered form and buttons.
async function fillComposer(studio, projectPath) {
  return ui(studio, async ({ projectPath }) => {
    const post = async (url, body) => {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await r.json(); if (r.status !== 201) throw new Error(JSON.stringify(result)); return result;
    };
    const project = (await post('/api/projects', { name: 'Physical calendar build', type: 'general', path: projectPath })).project;
    const conversation = (await post('/api/conversations', { title: 'Calendar build', project_id: project.id })).conversation;
    const pane = window._sessions[0];
    pane._convId = conversation.id; pane._projectId = project.id; pane._agentId = null;
    pane._conversationFocus = false; pane.chat._thinking = null; pane.chat.attachments = [];
    window.C3Bus.emit('session:changed', { idx: 0 });
    const pause = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const el = id => document.getElementById('m2-build-0-' + id);
    const click = async id => { if (!el(id) || el(id).disabled) throw new Error('disabled ' + id); el(id).click(); await pause(); };
    const change = async (id, value) => {
      const input = el(id); if (!input || input.disabled) throw new Error('missing ' + id);
      const prototype = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true })); await pause();
    };
    await pause(); await click('open');
    await change('instruction', 'Implement Gregorian leap year checking. Keep two small ES modules, no external dependencies.');
    const files = [
      { path: 'src/app.mjs', instruction: 'Re-export isLeapYear from ./calendar.mjs.', dependsOn: ['src/calendar.mjs'] },
      { path: 'src/calendar.mjs', instruction: 'Export isLeapYear(year): accept only integer numbers, false for all other types. True if divisible by 4 except centuries unless divisible by 400, false otherwise.', dependsOn: [] },
    ];
    for (let i = 0; i < files.length; i++) {
      if (i) await click('add-file');
      await change('file-' + i + '-path', files[i].path);
      await change('file-' + i + '-instruction', files[i].instruction);
      await change('file-' + i + '-dependencies', files[i].dependsOn.join('\n'));
    }
    await change('binary', '/usr/bin/node');
    const argv = ['--input-type=module', '-e', "import assert from 'node:assert/strict';import {isLeapYear} from './src/app.mjs';for(const y of [2000,2024,2400])assert.equal(isLeapYear(y),true);for(const y of [1900,2100,2023,2024.5,'2024',null,undefined,NaN,Infinity])assert.equal(isLeapYear(y),false);"];
    for (let i = 0; i < argv.length; i++) { await click('add-arg'); await change('arg-' + i, argv[i]); }
    await change('timeout', '30000');
    await click('submit');
    return { projectId: project.id, conversationId: conversation.id, files, argv };
  }, { projectPath });
}

async function clickAction(studio, label) {
  return ui(studio, ({ label }) => {
    const button = [...document.querySelectorAll('[aria-label="Akce připravené změny"] button')].find(item => item.textContent === label);
    if (!button || button.disabled) throw new Error('action unavailable: ' + label);
    button.click(); return true;
  }, { label });
}

async function sendStatus(studio, id) {
  return ui(studio, ({ id }) => {
    const textarea = document.getElementById('c3-chat-ta-0');
    if (!textarea) throw new Error('chat input unavailable');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, '/m2-status ' + id);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    return true;
  }, { id });
}

async function capture(studio, out, label) {
  const result = await ui(studio, () => ({
    conversationId: window._sessions?.[0]?._convId, projectId: window._sessions?.[0]?._projectId,
    pending: window._sessions?.[0]?._m2Pending, busy: !!window._sessions?.[0]?.chat?._m2Busy,
    messages: window._sessions?.[0]?.chat?.msgs, text: document.body.innerText,
  }));
  save(out, label + '.json', result);
  const screenshot = await studio.cdp.send('Page.captureScreenshot');
  writeFileSync(path.join(out, label + '.png'), Buffer.from(screenshot.data, 'base64'), { mode: 0o600 });
  return result;
}

function trackNetwork(studio, rows) {
  const requests = new Map();
  studio.cdp.setEventSink((method, params) => {
    if (method === 'Network.requestWillBeSent') {
      const row = { requestId: params.requestId, method: params.request.method, url: params.request.url,
        postData: params.request.postData ?? null, startedAt: new Date().toISOString() };
      requests.set(params.requestId, row); rows.push(row);
    } else if (method === 'Network.responseReceived' && requests.has(params.requestId)) {
      requests.get(params.requestId).status = params.response.status;
    } else if (method === 'Network.loadingFinished' && requests.has(params.requestId)) {
      requests.get(params.requestId).finished = true;
    } else if (method === 'Network.loadingFailed') {
      const row = requests.get(params.requestId); if (row) row.error = params.errorText;
    }
  });
  return studio.cdp.send('Network.enable');
}

function relay(socketPath) {
  return http.createServer((incoming, outgoing) => {
    const forwarded = http.request({ socketPath, path: incoming.url, method: incoming.method,
      headers: { 'Content-Type': 'application/json' } }, response => {
      outgoing.writeHead(response.statusCode, response.headers); response.pipe(outgoing);
    });
    forwarded.on('error', error => { outgoing.writeHead(502); outgoing.end(error.message); });
    incoming.pipe(forwarded);
  });
}

async function inside(configurationPath) {
  const cfg = JSON.parse(readFileSync(configurationPath, 'utf8'));
  const out = path.dirname(configurationPath), rows = [];
  assert.equal(git(['rev-parse', 'HEAD']), cfg.revision);
  assert.equal(git(['status', '--porcelain']), '');
  execFileSync('/usr/sbin/ip', ['link', 'set', 'lo', 'up']);
  const network = execFileSync('/usr/sbin/ip', ['-j', 'address'], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(network).map(item => item.ifname), ['lo']);
  const bridge = relay(cfg.socketPath);
  await new Promise(resolve => bridge.listen(0, '127.0.0.1', resolve));
  const provider = 'http://127.0.0.1:' + bridge.address().port;
  const runtime = makeRuntime(out), project = path.join(runtime.projects, 'calendar');
  mkdirSync(path.join(project, 'src'), { recursive: true }); mkdirSync(path.join(project, '.c3'));
  const before = 'export const isLeapYear = () => false;\n';
  writeFileSync(path.join(project, 'src/app.mjs'), before);
  writeFileSync(path.join(project, '.c3/m2-governance-policy.json'), JSON.stringify({
    policyId: 'calendar-local', layers: [{ name: 'app', roots: ['src'] }], rules: [{ from: 'app', canImport: ['app'] }],
    externalImports: [], sourceExtensions: ['.mjs'], requiredChecks: ['imports.allowed', 'inventory.complete', 'layers.mapped'], unmappedFilePolicy: 'unavailable',
  }));
  git(['init', '-b', 'main'], project); git(['add', '.'], project);
  git(['-c', 'user.name=IntentSmith Qualification', '-c', 'user.email=qualification@example.invalid', 'commit', '-m', 'calendar baseline'], project);
  const baseline = git(['rev-parse', 'HEAD'], project);
  const evidence = { status: 'RUNNING', sourceRevision: cfg.revision, runtime, baseline, network: JSON.parse(network),
    fixtureSetup: 'private Git baseline, governance, API registration and initial session selection; no mocked model or approval',
    rendererCaptureScope: 'after negotiated startup; this is not the registered 65-second full-network boundary probe', processes: [], bindings: [] };
  let server, studio;
  const boot = async () => {
    server = await startServer(runtime, randomBytes(20).toString('hex'), provider);
    evidence.processes.push({ serverPid: server.child.pid });
    studio = await startLiteralStudio(runtime);
    evidence.processes.at(-1).studioLauncherPid = studio.child.pid;
    await trackNetwork(studio, rows);
  };
  const shutdown = async () => {
    if (studio) { await stopLiteralStudio(studio); studio = null; evidence.processes.at(-1).studioExit = 0; }
    if (server) { await stopServer(server); server = null; evidence.processes.at(-1).serverExit = 0; }
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(runtime.database, { readonly: true, fileMustExist: true });
    try {
      const binding = db.prepare("SELECT * FROM model_desired_bindings WHERE role = 'CODE'").get();
      assert.equal(binding.model_name, EXPECTED_MODEL); assert.equal(binding.digest_sha256, EXPECTED_DIGEST);
      assert.equal(binding.source, 'CONFIG_DEFAULT');
      evidence.bindings.push(binding);
      assert.equal(db.pragma('quick_check', { simple: true }), 'ok');
      assert.deepEqual(db.pragma('foreign_key_check'), []);
    } finally { db.close(); }
  };
  const currentStatus = async pending => {
    const query = new URLSearchParams({ id: pending.lifecycleId, ...pending.origin });
    const response = await requestJson(server, 'GET', '/api/m2/lifecycle/status?' + query);
    assert.equal(response.statusCode, 200, response.raw); return response.json;
  };
  try {
    await boot();
    evidence.fixture = await fillComposer(studio, project);
    await waitUntil(() => ui(studio, () => !window._sessions[0].chat._m2Busy), 'model draft', 155000);
    const preview = await capture(studio, out, 'preview');
    assert.ok(preview.pending, 'draft failed: ' + JSON.stringify(preview.messages?.slice(-2)));
    const pending = preview.pending;
    evidence.pending = pending;
    const plan = await currentStatus(pending); save(out, 'prepared-plan.json', plan);
    assert.equal(plan.state, 'awaiting_approval'); assert.equal(plan.diff.length, 2);
    assert.deepEqual(plan.plan.focusedTest.argv, evidence.fixture.argv);
    assert.ok(plan.diff.every(file => preview.text.includes(file.path) && file.after.content.trim().split('\n').every(line => preview.text.includes(line.trim()))), 'visible complete preview');
    assert.equal(readFileSync(path.join(project, 'src/app.mjs'), 'utf8'), before);
    assert.equal(existsSync(path.join(project, 'src/calendar.mjs')), false);
    assert.equal(git(['rev-parse', 'HEAD'], project), baseline);
    evidence.noWriteBeforeApproval = true;
    const wrong = await requestJson(server, 'POST', '/api/m2/lifecycle/approve', { ...pending, planDigest: 'sha256:' + '0'.repeat(64) });
    assert.equal(wrong.statusCode, 409); assert.equal((await currentStatus(pending)).state, 'awaiting_approval');
    evidence.invalidApproval = { status: wrong.statusCode, response: wrong.json };
    await shutdown(); await boot();
    const restoredPreview = await capture(studio, out, 'restored-pending');
    assert.deepEqual(restoredPreview.pending, pending, 'Studio profile restores exact pending plan');
    const disabled = await ui(studio, () => [...document.querySelectorAll('button')].find(item => item.textContent === 'Schválit zobrazené změny')?.disabled);
    assert.equal(disabled, true, 'restored approval requires fresh preview');
    await clickAction(studio, 'Načíst stav a plán');
    await waitUntil(() => ui(studio, () => !window._sessions[0].chat._m2Busy), 'restore preview');
    await capture(studio, out, 'restored-preview');
    assert.deepEqual((await currentStatus(pending)).plan, plan.plan);
    await clickAction(studio, 'Schválit zobrazené změny');
    await waitUntil(() => ui(studio, () => !window._sessions[0].chat._m2Busy), 'execution', 90000);
    const executed = await capture(studio, out, 'executed');
    const terminal = await currentStatus(pending); save(out, 'terminal.json', terminal);
    assert.equal(terminal.state, 'succeeded', JSON.stringify(terminal.result));
    assert.equal(terminal.result.focusedTest.exitCode, 0);
    assert.ok(executed.text.includes('M2 CANONICAL TERMINAL'));
    for (const file of plan.diff) assert.equal(readFileSync(path.join(project, file.path), 'utf8'), file.after.content);
    evidence.exactFiles = plan.diff.map(file => ({ path: file.path, sha256: sha256(file.after.content) }));
    await shutdown(); await boot();
    await sendStatus(studio, pending.lifecycleId);
    await waitUntil(() => ui(studio, () => !window._sessions[0].chat._m2Busy && document.body.innerText.includes('M2 CANONICAL TERMINAL')), 'terminal after restart');
    await capture(studio, out, 'restored-terminal');
    const recovered = await currentStatus(pending);
    assert.deepEqual(recovered.terminal, terminal.terminal); assert.deepEqual(recovered.result, terminal.result);
    evidence.restartRestoredExactTerminal = true;

    const backup = await requestJson(server, 'POST', '/api/system/backup', {});
    assert.equal(backup.statusCode, 200, backup.raw); assert.equal(backup.json.ok, true);
    const marker = await requestJson(server, 'POST', '/api/conversations', { title: 'after backup marker' });
    assert.equal(marker.statusCode, 201, marker.raw);
    await shutdown();
    const originalBackup = path.join(path.dirname(runtime.database), 'backups', backup.json.name);
    // Keep a canonical backup name so the negative reaches content validation.
    const corruptName = backup.json.name.replace('.backup', '-99.backup');
    fs.cpSync(originalBackup, path.join(path.dirname(originalBackup), corruptName), { recursive: true });
    fs.appendFileSync(path.join(path.dirname(originalBackup), corruptName, 'c3.db'), 'damaged-copy');
    const restore = name => spawnSync(process.execPath, ['scripts/restore-state-backup.js', '--data-dir', path.dirname(runtime.database), '--backup', name, '--db-path', runtime.database],
      { cwd: SOURCE_ROOT, env: serverEnvironment(runtime, 'offline-restore', provider), encoding: 'utf8', timeout: 30000 });
    const digestBeforeRejectedRestore = sha256(readFileSync(runtime.database));
    const rejected = restore(corruptName); assert.equal(rejected.status, 1);
    assert.equal(JSON.parse(rejected.stderr).code, 'BACKUP_CONTENT_MISMATCH');
    assert.equal(sha256(readFileSync(runtime.database)), digestBeforeRejectedRestore);
    evidence.corruptBackupRejected = { exit: rejected.status, stderr: rejected.stderr };
    const restored = restore(backup.json.name); assert.equal(restored.status, 0, restored.stderr);
    assert.equal(sha256(readFileSync(runtime.database)), sha256(readFileSync(path.join(originalBackup, 'c3.db'))));
    evidence.backupRestore = { backup: backup.json, result: JSON.parse(restored.stdout), exactDatabaseBytes: true };
    await boot();
    const afterRestore = await currentStatus(pending); assert.deepEqual(afterRestore.terminal, terminal.terminal);
    const absent = await requestJson(server, 'GET', '/api/conversations/' + marker.json.conversation.id);
    assert.equal(absent.statusCode, 404, 'after-backup marker must not survive restore');
    await sendStatus(studio, pending.lifecycleId);
    await waitUntil(() => ui(studio, () => !window._sessions[0].chat._m2Busy && document.body.innerText.includes('M2 CANONICAL TERMINAL')), 'terminal after restore');
    await capture(studio, out, 'backup-restored-terminal');
    assert.ok(evidence.bindings.every(binding => JSON.stringify(binding) === JSON.stringify(evidence.bindings[0])), 'restarts preserve exact durable binding');
    assert.equal(rows.filter(row => row.method === 'POST' && new URL(row.url).pathname === '/api/m2/lifecycle/draft').length, 1);
    assert.equal(rows.filter(row => row.method === 'POST' && new URL(row.url).pathname === '/api/m2/lifecycle/approve').length, 1);
    evidence.status = 'PASS';
  } catch (error) {
    evidence.status = 'FAIL'; evidence.error = { message: error.message, stack: error.stack };
    if (studio) { try { await capture(studio, out, 'failure'); } catch {} }
  } finally {
    try { await shutdown(); } catch (error) { evidence.status = 'FAIL'; evidence.cleanupError = error.message; }
    for (const child of ownedChildren) { child.kill('SIGTERM'); }
    bridge.closeAllConnections(); await new Promise(resolve => bridge.close(resolve));
    save(out, 'renderer-network.json', rows); save(out, 'journey.json', evidence);
  }
  assert.equal(evidence.status, 'PASS', evidence.error?.message || evidence.cleanupError);
}

async function parent(out) {
  assert.equal(git(['status', '--porcelain']), '', 'commit source before qualification');
  assert.ok(path.isAbsolute(out) && out.startsWith(path.join(SOURCE_ROOT, '.intentsmith-artifacts') + path.sep));
  mkdirSync(out, { mode: 0o700 });
  const revision = git(['rev-parse', 'HEAD']);
  const evidence = { status: 'RUNNING', sourceRevision: revision, startedAt: new Date().toISOString(), model: EXPECTED_MODEL, digest: EXPECTED_DIGEST };
  evidence.build = Object.fromEntries(['package-lock.json', 'c3-ide/yarn.lock', 'scripts/run-project-build-journey.js',
    'c3-ide/applications/electron/lib/frontend/bundle.js', 'c3-ide/applications/electron/lib/backend/electron-main.js',
    'c3-ide/applications/electron/lib/frontend/index.html', 'c3-ide/applications/electron/lib/frontend/preload.js']
    .map(relative => [relative, sha256(readFileSync(path.join(SOURCE_ROOT, relative)))]));
  const requests = [], upstreamOrigin = 'http://127.0.0.1:11434';
  let lease, proxy, child, loaded = false, socketRoot;
  const upstream = async endpoint => {
    const response = await fetch(upstreamOrigin + endpoint, { signal: AbortSignal.timeout(5000) });
    assert.ok(response.ok); return response.json();
  };
  try {
    lease = acquireGpuEvaluationLock({ command: 'production Studio build qualification' });
    const ps = await upstream('/api/ps');
    const compute = execFileSync('nvidia-smi', ['--query-compute-apps=pid,process_name,used_memory', '--format=csv,noheader'], { encoding: 'utf8' }).trim();
    const mem = /^MemAvailable:\s+(\d+) kB$/m.exec(readFileSync('/proc/meminfo', 'utf8'));
    const disk = fs.statfsSync(SOURCE_ROOT);
    const ready = assessScheduledEvaluationReadiness({ residentModels: ps.models.map(item => item.name), computeProcesses: compute ? compute.split('\n') : [],
      memoryAvailableBytes: Number(mem?.[1]) * 1024, diskAvailableBytes: disk.bavail * disk.bsize });
    evidence.preflight = ready; assert.ok(ready.ready, JSON.stringify(ready.reasons));
    const inventory = await upstream('/api/tags');
    assert.equal(inventory.models.find(item => item.name === EXPECTED_MODEL)?.digest, EXPECTED_DIGEST);
    evidence.provider = await upstream('/api/version');
    socketRoot = mkdtempSync('/tmp/is-build-'); chmodSync(socketRoot, 0o700);
    const socketPath = path.join(socketRoot, 'provider.sock');
    proxy = http.createServer(async (incoming, outgoing) => {
      let row;
      try {
        const chunks = []; let size = 0;
        for await (const chunk of incoming) { size += chunk.length; assert.ok(size < 1024 * 1024); chunks.push(chunk); }
        const bytes = Buffer.concat(chunks); const body = bytes.length ? JSON.parse(bytes) : null;
        row = { at: new Date().toISOString(), method: incoming.method, path: incoming.url, body, requestSha256: sha256(bytes) }; requests.push(row);
        const allowedRead = incoming.method === 'GET' && ['/api/tags', '/api/ps', '/api/version'].includes(incoming.url);
        const allowedModel = incoming.method === 'POST' && ['/api/chat', '/api/generate'].includes(incoming.url) && body?.model === EXPECTED_MODEL;
        const allowedShow = incoming.method === 'POST' && incoming.url === '/api/show' && (body?.model || body?.name) === EXPECTED_MODEL;
        assert.ok(allowedRead || allowedModel || allowedShow, 'provider request outside fixed qualification scope');
        if (['/api/chat', '/api/generate'].includes(incoming.url)) loaded = true;
        const request = http.request({ hostname: '127.0.0.1', port: 11434, path: incoming.url, method: incoming.method,
          headers: { 'Content-Type': 'application/json', 'Content-Length': bytes.length } }, response => {
          row.status = response.statusCode; const responseChunks = [];
          outgoing.writeHead(response.statusCode, response.headers);
          response.on('data', chunk => { responseChunks.push(chunk); });
          response.on('end', () => {
            const raw = Buffer.concat(responseChunks); row.responseSha256 = sha256(raw);
            try { row.response = JSON.parse(raw); } catch { row.responseLines = raw.toString().trim().split('\n').map(line => { try { return JSON.parse(line); } catch { return { invalid: true }; } }); }
          });
          response.pipe(outgoing);
        });
        request.setTimeout(180000, () => request.destroy(new Error('bounded provider timeout')));
        request.on('error', error => { row.error = error.message; if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(); });
        request.end(bytes);
      } catch (error) { if (row) row.error = error.message; outgoing.writeHead(403); outgoing.end(); }
    });
    await new Promise(resolve => proxy.listen(socketPath, resolve)); chmodSync(socketPath, 0o600);
    save(out, 'configuration.json', { revision, socketPath });
    const env = { ...safeBaseEnvironment(), INTENTSMITH_STUDIO_DISPLAY: process.env.INTENTSMITH_STUDIO_DISPLAY,
      INTENTSMITH_STUDIO_XAUTHORITY: process.env.INTENTSMITH_STUDIO_XAUTHORITY };
    child = spawn('unshare', ['--user', '--map-root-user', '--net', '--', 'bwrap', '--bind', '/', '/', '--dev', '/dev', '--die-with-parent',
      process.execPath, self, '--inside', path.join(out, 'configuration.json')], { cwd: SOURCE_ROOT, env, stdio: 'inherit' });
    const exit = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code, signal) => resolve({ code, signal })); });
    evidence.child = exit; assert.equal(exit.code, 0, 'joined journey failed');
    const generations = requests.filter(row => ['/api/chat', '/api/generate'].includes(row.path) && (row.body?.messages || row.body?.prompt));
    assert.equal(generations.length, 2, 'exactly two file generations');
    for (const row of generations) {
      const terminal = row.response || row.responseLines?.at(-1);
      assert.equal(row.status, 200); assert.equal(terminal?.done, true); assert.equal(terminal?.done_reason, 'stop');
      assert.equal(terminal?.model_digest_sha256 || terminal?.digest, EXPECTED_DIGEST);
      assert.equal(terminal?.provider_version, evidence.provider.version);
    }
    assert.ok(requests.every(row => !row.error), 'provider scope or transport failure');
    evidence.physicalGenerations = generations.length; evidence.status = 'PASS';
  } catch (error) { evidence.status = 'FAIL'; evidence.error = { message: error.message, stack: error.stack }; }
  finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    if (proxy) { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); }
    if (loaded) {
      try {
        const ps = await upstream('/api/ps'); assert.ok(ps.models.every(item => item.name === EXPECTED_MODEL && item.digest === EXPECTED_DIGEST));
        const response = await fetch(upstreamOrigin + '/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: EXPECTED_MODEL, keep_alive: 0 }), signal: AbortSignal.timeout(30000) });
        assert.ok(response.ok); await response.text(); evidence.ownedModelUnloaded = true;
      } catch (error) { evidence.status = 'FAIL'; evidence.cleanupError = error.message; }
    }
    if (socketRoot) rmSync(socketRoot, { recursive: true, force: true });
    if (lease) evidence.gpuLeaseReleased = lease.release();
    evidence.completedAt = new Date().toISOString(); evidence.sourceCleanAfter = git(['status', '--porcelain']) === '';
    save(out, 'provider-requests.json', requests); save(out, 'result.json', evidence);
  }
  console.log(JSON.stringify(evidence));
  if (evidence.status !== 'PASS') process.exitCode = 1;
}

if (process.argv[2] === '--inside' && process.argv.length === 4) {
  await inside(process.argv[3]);
} else if (process.argv[2] === '--run' && process.argv.length === 4) {
  await parent(path.resolve(process.argv[3]));
} else {
  console.log('Manual production qualification: two-file Studio model build, exact approval, two process restarts and offline backup/restore.');
  console.log('Fixed installed model: ' + EXPECTED_MODEL + ' @ ' + EXPECTED_DIGEST);
  console.log('Requires a clean source, built Studio, private Xvfb DISPLAY/XAUTHORITY and idle GPU/Ollama. No pulls, live DB or binding changes.');
  console.log('Usage: node scripts/run-project-build-journey.js --run <new absolute .intentsmith-artifacts directory>');
  if (process.argv.length !== 2) process.exitCode = 2;
}
