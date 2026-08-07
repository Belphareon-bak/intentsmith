#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  STUDIO_M0_POLICY,
  STUDIO_ROUTE_IDS,
  createStudioCdpEvidenceReducer,
  evaluateStudioCdpEvidence,
} from '../scripts/studio-cdp-evidence.js';

const require = createRequire(import.meta.url);
const { readLocalAccess } = require(
  '../c3-ide/applications/electron/c3-local-access.js',
);

const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);
const EVIDENCE_FILE = 'studio-electron-boundary.json';
const FAILURE_FILE = 'studio-electron-boundary-failure.log';
const SCHEMA_VERSION = 1;
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const DISPLAY_PATTERN = /^:\d+(?:\.\d+)?$/;
const MAX_LOG_BYTES = 8 * 1024 * 1024;
const CDP_TIMEOUT_MS = 15_000;
const STARTUP_TIMEOUT_MS = 60_000;
const SHUTDOWN_TIMEOUT_MS = 15_000;

class SafeFailure extends Error {
  constructor(code, exitCode = 1) {
    super(code);
    this.name = 'SafeFailure';
    this.code = code;
    this.exitCode = exitCode;
  }
}

function fail(code) {
  throw new SafeFailure(code);
}

function block(code) {
  throw new SafeFailure(code, 2);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function monotonicMs() {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

export function safeInheritedEnvironment() {
  const env = {};
  for (const key of ['PATH', 'LANG', 'LC_ALL', 'TZ']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

function commandAvailable(command) {
  const searchPath = process.env.PATH || '';
  return searchPath.split(path.delimiter).some(directory => {
    if (!directory) return false;
    try {
      fs.accessSync(path.join(directory, command), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

async function assertPrivateDirectory(directory, envName) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
    block(`${envName.toLowerCase()}-missing`);
  }
  let metadata;
  try {
    metadata = await lstat(directory);
  } catch {
    block(`${envName.toLowerCase()}-missing`);
  }
  const owned = typeof process.getuid !== 'function'
    || !Number.isInteger(metadata.uid)
    || metadata.uid === process.getuid();
  if (
    !metadata.isDirectory()
    || metadata.isSymbolicLink()
    || !owned
    || (metadata.mode & 0o077) !== 0
  ) {
    block(`${envName.toLowerCase()}-unsafe`);
  }
  const resolved = path.resolve(directory);
  if (await realpath(directory) !== resolved) {
    block(`${envName.toLowerCase()}-noncanonical`);
  }
  return resolved;
}

async function assertScopedX11() {
  const display = process.env.INTENTSMITH_STUDIO_DISPLAY;
  const xauthority = process.env.INTENTSMITH_STUDIO_XAUTHORITY;
  if (typeof display !== 'string' || !DISPLAY_PATTERN.test(display)) {
    block('x11-display-invalid');
  }
  if (typeof xauthority !== 'string' || !path.isAbsolute(xauthority)) {
    block('x11-xauthority-missing');
  }
  let metadata;
  try {
    metadata = await lstat(xauthority);
  } catch {
    block('x11-xauthority-invalid');
  }
  const owned = typeof process.getuid !== 'function'
    || !Number.isInteger(metadata.uid)
    || metadata.uid === process.getuid();
  if (
    !metadata.isFile()
    || metadata.isSymbolicLink()
    || !owned
    || (metadata.mode & 0o077) !== 0
    || (metadata.mode & 0o400) === 0
  ) {
    block('x11-xauthority-invalid');
  }
  return { display, xauthority };
}

function runQuiet(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd || SOURCE_ROOT,
    env: options.env || safeInheritedEnvironment(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout || 10_000,
  });
}

async function inspectSource() {
  const expectedRevision = process.env.INTENTSMITH_TEST_SOURCE_REVISION;
  if (!SHA_PATTERN.test(expectedRevision || '')) block('source-revision-missing');
  const head = runQuiet('git', ['rev-parse', 'HEAD']);
  if (head.status !== 0 || head.stdout.trim() !== expectedRevision) {
    fail('source-revision-mismatch');
  }
  const statusResult = runQuiet(
    'git',
    ['status', '--porcelain', '--untracked-files=all'],
  );
  if (statusResult.status !== 0) fail('source-status-unavailable');
  if (statusResult.stdout.length !== 0) fail('source-worktree-dirty');
  return expectedRevision;
}

async function assertBuildPresent() {
  const required = [
    'c3-ide/node_modules/electron/package.json',
    'c3-ide/applications/electron/lib/backend/electron-main.js',
    'c3-ide/applications/electron/lib/frontend/bundle.js',
    'c3-ide/applications/electron/lib/frontend/index.html',
    'c3-ide/applications/electron/lib/frontend/preload.js',
    'c3-ide/applications/electron/scripts/launch.js',
  ];
  for (const relative of required) {
    let metadata;
    try {
      metadata = await lstat(path.join(SOURCE_ROOT, relative));
    } catch {
      block('studio-production-build-missing');
    }
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size === 0) {
      block('studio-production-build-invalid');
    }
  }
}

async function preflight() {
  const artifactRoot = await assertPrivateDirectory(
    process.env.INTENTSMITH_TEST_ARTIFACT_DIR,
    'artifact-root',
  );
  const sourceRevision = await inspectSource();
  await assertBuildPresent();
  const x11 = await assertScopedX11();
  for (const command of ['unshare', 'ip', 'xdpyinfo']) {
    if (!commandAvailable(command)) block(`toolchain-${command}-missing`);
  }
  const unshareProbe = runQuiet('unshare', [
    '--user',
    '--map-root-user',
    '--net',
    process.execPath,
    '-e',
    '',
  ]);
  if (unshareProbe.status !== 0) block('user-network-namespace-unavailable');
  const displayProbe = runQuiet('xdpyinfo', ['-display', x11.display], {
    env: {
      ...safeInheritedEnvironment(),
      DISPLAY: x11.display,
      XAUTHORITY: x11.xauthority,
    },
  });
  if (displayProbe.status !== 0) block('x11-display-unreachable');
  return { artifactRoot, sourceRevision, ...x11 };
}

function safeFailureCode(error) {
  return error instanceof SafeFailure ? error.code : 'unexpected-runner-error';
}

function safeExitCode(error) {
  return error instanceof SafeFailure ? error.exitCode : 1;
}

function effectiveExitCode(error) {
  const code = safeExitCode(error);
  return code === 2 && process.env.C3_AUDIT_RUN === '1' ? 1 : code;
}

async function writePrivateJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
}

async function writeFailureDetail(artifactRoot, error) {
  if (!artifactRoot) return;
  const detail = error?.stack || String(error);
  try {
    await writeFile(path.join(artifactRoot, FAILURE_FILE), `${detail}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
  } catch {
    // The public result remains fail-closed even if private diagnostics fail.
  }
}

async function writeSanitizedFailureEvidence(artifactRoot, error, exitCode) {
  if (!artifactRoot) return;
  const sourceRevision = process.env.INTENTSMITH_TEST_SOURCE_REVISION;
  const evidence = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    evidenceType: 'intentsmith.studio-electron-boundary',
    sourceRevision: SHA_PATTERN.test(sourceRevision || '') ? sourceRevision : null,
    verdict: exitCode === 2 ? 'BLOCKED' : 'FAIL',
    uiEvaluation: 'excluded-non-final-ui',
    failureCode: safeFailureCode(error),
  });
  try {
    await writePrivateJson(path.join(artifactRoot, EVIDENCE_FILE), evidence);
  } catch {
    // Never replace the original failure with an evidence-write diagnostic.
  }
}

async function outerMain() {
  let facts;
  try {
    facts = await preflight();
    if (process.argv.includes('--preflight')) {
      process.stdout.write('STUDIO_ELECTRON_PREFLIGHT_PASS\n');
      return;
    }
  } catch (error) {
    const exitCode = effectiveExitCode(error);
    process.stderr.write(
      `${exitCode === 2 ? 'STUDIO_ELECTRON_BOUNDARY_BLOCKED' : 'STUDIO_ELECTRON_BOUNDARY_FAIL'} ${safeFailureCode(error)}\n`,
    );
    process.exitCode = exitCode;
    return;
  }

  const networkNamespace = await stat('/proc/self/ns/net');
  const baselineProcessGroup = processGroupMembers(currentProcessGroup());
  const childEnv = {
    ...safeInheritedEnvironment(),
    INTENTSMITH_TEST_SOURCE_REVISION: facts.sourceRevision,
    INTENTSMITH_TEST_ARTIFACT_DIR: facts.artifactRoot,
    INTENTSMITH_STUDIO_DISPLAY: facts.display,
    INTENTSMITH_STUDIO_XAUTHORITY: facts.xauthority,
    INTENTSMITH_STUDIO_PARENT_NETNS: String(networkNamespace.ino),
    INTENTSMITH_STUDIO_BASELINE_PGIDS: baselineProcessGroup.join(','),
    INTENTSMITH_STUDIO_SOURCE_ROOT: SOURCE_ROOT,
  };
  if (process.env.C3_AUDIT_RUN === '1') childEnv.C3_AUDIT_RUN = '1';
  const child = spawn('unshare', [
    '--user',
    '--map-root-user',
    '--net',
    process.execPath,
    SELF,
    '--namespace-inner',
  ], {
    cwd: SOURCE_ROOT,
    env: childEnv,
    stdio: 'inherit',
  });
  const completion = await observeSpawnCompletion(child);
  if (
    completion.spawnError
    || completion.signal !== null
    || !Number.isInteger(completion.code)
  ) {
    process.exitCode = 1;
    return;
  }
  process.exitCode = completion.code;
}

export function observeSpawnCompletion(child) {
  return new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      resolve(Object.freeze(result));
    };
    child.once('error', () => finish({
      code: null,
      signal: null,
      spawnError: true,
    }));
    child.once('close', (code, signal) => finish({
      code,
      signal,
      spawnError: false,
    }));
  });
}

function makeRuntimePaths(artifactRoot) {
  const runtimeRoot = path.join(artifactRoot, 'studio-runtime');
  return Object.freeze({
    runtimeRoot,
    home: path.join(runtimeRoot, 'home'),
    tmp: path.join(runtimeRoot, 'tmp'),
    data: path.join(runtimeRoot, 'data'),
    projects: path.join(runtimeRoot, 'projects'),
    output: path.join(runtimeRoot, 'output'),
    xdgConfig: path.join(runtimeRoot, 'xdg-config'),
    xdgCache: path.join(runtimeRoot, 'xdg-cache'),
    xdgData: path.join(runtimeRoot, 'xdg-data'),
    xdgState: path.join(runtimeRoot, 'xdg-state'),
    electronData: path.join(runtimeRoot, 'electron-user-data'),
    portFile: path.join(runtimeRoot, 'server-port.json'),
    backendLog: path.join(runtimeRoot, 'backend.log'),
    electronLog: path.join(runtimeRoot, 'electron.log'),
    evidence: path.join(artifactRoot, EVIDENCE_FILE),
  });
}

async function prepareRuntime(paths) {
  try {
    await mkdir(paths.runtimeRoot, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST') fail('runtime-root-already-exists');
    throw error;
  }
  for (const directory of [
    paths.home,
    paths.tmp,
    paths.data,
    paths.projects,
    paths.output,
    paths.xdgConfig,
    paths.xdgCache,
    paths.xdgData,
    paths.xdgState,
    paths.electronData,
  ]) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      fail('runtime-directory-invalid');
    }
    const relative = path.relative(paths.runtimeRoot, await realpath(directory));
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      fail('runtime-directory-escaped');
    }
  }
}

function makeBackendEnvironment(paths, modelProviderUrl) {
  return {
    ...safeInheritedEnvironment(),
    HOME: paths.home,
    TMPDIR: paths.tmp,
    TMP: paths.tmp,
    TEMP: paths.tmp,
    XDG_CONFIG_HOME: paths.xdgConfig,
    XDG_CACHE_HOME: paths.xdgCache,
    XDG_DATA_HOME: paths.xdgData,
    XDG_STATE_HOME: paths.xdgState,
    NODE_ENV: 'test',
    NODE_NO_WARNINGS: '1',
    NO_COLOR: '1',
    C3_HOST: '127.0.0.1',
    C3_PORT: '0',
    C3_PORT_FILE: paths.portFile,
    C3_DB_PATH: path.join(paths.data, 'c3.db'),
    C3_PROJECTS_DIR: paths.projects,
    C3_OUTPUT_DIR: paths.output,
    C3_ENABLE_AUTONOMY: 'false',
    C3_ENABLE_COMFYUI: 'false',
    C3_ENABLE_ONLINE_DISCOVERY: 'false',
    C3_LIFECYCLE_AUTO_COMMIT: 'false',
    C3_LOG_LEVEL: 'warn',
    OLLAMA_URL: modelProviderUrl,
  };
}

export async function startModelProviderSentinel() {
  let requests = 0;
  const server = http.createServer((request, response) => {
    requests += 1;
    request.resume();
    response.writeHead(503, {
      Connection: 'close',
      'Content-Type': 'application/json',
    });
    response.end('{"error":"model-provider-sentinel"}');
  });
  server.keepAliveTimeout = 1;
  server.headersTimeout = 2_000;
  server.requestTimeout = 2_000;
  server.on('clientError', (_error, socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    const onError = error => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });
  const address = server.address();
  if (
    !address
    || typeof address === 'string'
    || address.address !== '127.0.0.1'
    || !Number.isInteger(address.port)
  ) {
    server.close();
    fail('model-provider-sentinel-bind-invalid');
  }
  return Object.freeze({
    origin: `http://127.0.0.1:${address.port}`,
    requestCount: () => requests,
    close: async () => {
      if (!server.listening) return;
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections?.();
      const result = await Promise.race([
        closed.then(() => true),
        delay(2_000).then(() => false),
      ]);
      if (!result) fail('model-provider-sentinel-shutdown-failed');
    },
  });
}

function makeElectronEnvironment(paths, display, xauthority) {
  return {
    ...safeInheritedEnvironment(),
    HOME: paths.home,
    TMPDIR: paths.tmp,
    TMP: paths.tmp,
    TEMP: paths.tmp,
    XDG_CONFIG_HOME: paths.xdgConfig,
    XDG_CACHE_HOME: paths.xdgCache,
    XDG_DATA_HOME: paths.xdgData,
    XDG_STATE_HOME: paths.xdgState,
    DISPLAY: display,
    XAUTHORITY: xauthority,
    NODE_ENV: 'test',
    NODE_NO_WARNINGS: '1',
    NO_COLOR: '1',
    C3_PORT_FILE: paths.portFile,
  };
}

function observeChild(child) {
  const state = { closed: false, code: null, signal: null, spawnError: false };
  const closed = new Promise(resolve => {
    child.once('error', () => { state.spawnError = true; });
    child.once('close', (code, signal) => {
      state.closed = true;
      state.code = code;
      state.signal = signal;
      resolve({ ...state });
    });
  });
  return { state, closed };
}

function spawnLogged(command, args, { cwd, env, logFile }) {
  const descriptor = fs.openSync(logFile, 'wx', 0o600);
  const child = spawn(command, args, {
    cwd,
    env,
    // Keep every descendant inside the suite-owned process group created by
    // nightly-audit. Nested detached groups would escape its orphan detector.
    detached: false,
    stdio: ['ignore', descriptor, descriptor],
  });
  fs.closeSync(descriptor);
  return { child, observation: observeChild(child) };
}

function signalOwnedChild(child, signal) {
  if (!child?.pid) return;
  try {
    child.kill(signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

export function processGroupFromStat(text) {
  const endOfName = text.lastIndexOf(')');
  if (endOfName < 0) return null;
  const fields = text.slice(endOfName + 1).trim().split(/\s+/);
  const group = Number(fields[2]);
  return Number.isInteger(group) && group > 0 ? group : null;
}

function currentProcessGroup() {
  const group = processGroupFromStat(fs.readFileSync('/proc/self/stat', 'utf8'));
  if (!Number.isInteger(group) || group < 1) fail('process-group-unavailable');
  return group;
}

function processGroupMembers(group) {
  const members = [];
  for (const entry of fs.readdirSync('/proc', { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    try {
      const observedGroup = processGroupFromStat(
        fs.readFileSync(`/proc/${entry.name}/stat`, 'utf8'),
      );
      if (observedGroup === group) members.push(Number(entry.name));
    } catch {
      // Processes may disappear between directory enumeration and read.
    }
  }
  return members;
}

async function waitForOwnedDescendantsToExit(timeoutMs, baselinePids) {
  const group = currentProcessGroup();
  const expected = new Set([...baselinePids, process.pid]);
  const clean = () => processGroupMembers(group).every(pid => expected.has(pid));
  const deadline = monotonicMs() + timeoutMs;
  while (monotonicMs() < deadline) {
    if (clean()) return true;
    await delay(50);
  }
  return clean();
}

async function stopOwnedProcess(entry, requestedSignal) {
  if (!entry) return Object.freeze({
    started: false,
    exitCode: null,
    signal: null,
    requestedSignal: 'none',
    forced: false,
    processGroupClean: true,
  });
  const { child, observation } = entry;
  let forced = false;
  if (!observation.state.closed && requestedSignal) {
    signalOwnedChild(child, requestedSignal);
  }
  await Promise.race([observation.closed, delay(SHUTDOWN_TIMEOUT_MS)]);
  if (!observation.state.closed) {
    forced = true;
    signalOwnedChild(child, 'SIGKILL');
    await Promise.race([observation.closed, delay(2_000)]);
  }
  return Object.freeze({
    started: true,
    exitCode: observation.state.code,
    signal: observation.state.signal,
    requestedSignal: requestedSignal || 'none',
    forced,
    processGroupClean: null,
  });
}

export async function runCleanupSequence(steps) {
  const results = {};
  let error = null;
  for (const step of steps) {
    try {
      results[step.name] = await step.run();
    } catch {
      results[step.name] = step.fallback;
      if (!error) error = new SafeFailure(`${step.name}-cleanup-failed`);
    }
  }
  return Object.freeze({ results: Object.freeze(results), error });
}

function failedCleanupExit(started, requestedSignal) {
  return Object.freeze({
    started,
    exitCode: null,
    signal: null,
    requestedSignal: requestedSignal || 'none',
    forced: true,
    processGroupClean: false,
  });
}

async function waitForAccess(portFile, serverObservation) {
  const deadline = monotonicMs() + STARTUP_TIMEOUT_MS;
  while (monotonicMs() < deadline) {
    if (serverObservation.state.closed) fail('backend-exited-before-ready');
    const access = readLocalAccess({ portFile });
    if (access) return access;
    await delay(100);
  }
  fail('backend-readiness-timeout');
}

async function waitForDevToolsActivePort(file, electronObservation) {
  const deadline = monotonicMs() + STARTUP_TIMEOUT_MS;
  while (monotonicMs() < deadline) {
    if (electronObservation.state.closed) fail('electron-exited-before-cdp');
    try {
      const metadata = await lstat(file);
      const owned = typeof process.getuid !== 'function'
        || !Number.isInteger(metadata.uid)
        || metadata.uid === process.getuid();
      if (
        !metadata.isFile()
        || metadata.isSymbolicLink()
        || !owned
        || metadata.size < 3
        || metadata.size > 512
        || (metadata.mode & 0o077) !== 0
      ) {
        fail('devtools-active-port-invalid');
      }
      const lines = (await readFile(file, 'utf8')).trim().split(/\r?\n/);
      const port = Number(lines[0]);
      if (
        !Number.isInteger(port)
        || port < 1
        || port > 65535
        || lines.length !== 2
        || !/^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(lines[1])
      ) {
        fail('devtools-active-port-invalid');
      }
      return port;
    } catch (error) {
      if (error instanceof SafeFailure) throw error;
    }
    await delay(100);
  }
  fail('devtools-active-port-timeout');
}

export function exactStudioPageTarget(target, debugPort, expectedEntrypoint) {
  if (target?.type !== 'page' || typeof target.webSocketDebuggerUrl !== 'string') {
    return false;
  }
  try {
    const page = new URL(target.url);
    const socket = new URL(target.webSocketDebuggerUrl);
    return (
      page.protocol === 'file:'
      && fileURLToPath(page) === expectedEntrypoint
      && socket.protocol === 'ws:'
      && socket.hostname === '127.0.0.1'
      && Number(socket.port) === debugPort
      && !socket.username
      && !socket.password
      && !socket.hash
      && socket.pathname.startsWith('/devtools/page/')
    );
  } catch {
    return false;
  }
}

export function theiaControlPlaneOriginFromEntrypoint(rawUrl, expectedEntrypoint) {
  try {
    const page = new URL(rawUrl);
    const keys = [...page.searchParams.keys()];
    const ports = page.searchParams.getAll('port');
    if (
      page.protocol !== 'file:'
      || fileURLToPath(page) !== expectedEntrypoint
      || keys.length !== 1
      || keys[0] !== 'port'
      || ports.length !== 1
      || !/^[1-9][0-9]{0,4}$/.test(ports[0])
    ) {
      return null;
    }
    const port = Number(ports[0]);
    if (!Number.isInteger(port) || port > 65535) return null;
    return `http://localhost:${port}`;
  } catch {
    return null;
  }
}

async function waitForCdpTarget(debugPort, electronObservation, expectedEntrypoint) {
  const deadline = monotonicMs() + STARTUP_TIMEOUT_MS;
  while (monotonicMs() < deadline) {
    if (electronObservation.state.closed) fail('electron-exited-before-cdp');
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) {
        const targets = await response.json();
        const target = Array.isArray(targets)
          ? targets.find(item => exactStudioPageTarget(
            item,
            debugPort,
            expectedEntrypoint,
          ))
          : null;
        if (target) return target;
      }
    } catch {
      // Expected while Electron is starting.
    }
    await delay(150);
  }
  fail('electron-cdp-timeout');
}

export class CdpClient {
  constructor(url, WebSocketCtor = WebSocket, connectTimeoutMs = CDP_TIMEOUT_MS) {
    this.socket = new WebSocketCtor(url);
    this.openState = WebSocketCtor.OPEN ?? 1;
    this.nextId = 1;
    this.pending = new Map();
    this.eventSink = null;
    this.closed = false;
    this.fatalError = null;
    this.openPromise = new Promise((resolve, reject) => {
      let settled = false;
      let timer;
      const finish = (error = null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.socket.removeEventListener('open', onOpen);
        this.socket.removeEventListener('error', onError);
        this.socket.removeEventListener('close', onCloseBeforeOpen);
        if (error) reject(error);
        else resolve();
      };
      const onOpen = () => finish();
      const onError = () => finish(new SafeFailure('cdp-connect-error'));
      const onCloseBeforeOpen = () => finish(new SafeFailure('cdp-connect-closed'));
      timer = setTimeout(() => {
        try { this.socket.close(); } catch {}
        finish(new SafeFailure('cdp-connect-timeout'));
      }, connectTimeoutMs);
      this.socket.addEventListener('open', onOpen);
      this.socket.addEventListener('error', onError);
      this.socket.addEventListener('close', onCloseBeforeOpen);
    });
    this.socket.addEventListener('message', event => this.#onMessage(event.data));
    this.socket.addEventListener('close', () => {
      this.closed = true;
      if (!this.fatalError) this.fatalError = new SafeFailure('cdp-disconnected');
      this.#rejectPending(this.fatalError);
    });
    this.socket.addEventListener('error', () => {
      if (this.socket.readyState !== this.openState) return;
      this.#markFatal(new SafeFailure('cdp-socket-error'));
    });
  }

  async open() {
    await this.openPromise;
  }

  setEventSink(sink) {
    this.eventSink = sink;
  }

  assertHealthy() {
    if (this.fatalError) throw this.fatalError;
  }

  send(method, params = {}, timeoutMs = CDP_TIMEOUT_MS) {
    if (this.fatalError) return Promise.reject(this.fatalError);
    if (this.closed || this.socket.readyState !== this.openState) {
      return Promise.reject(new SafeFailure('cdp-not-connected'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new SafeFailure('cdp-command-timeout'));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  #onMessage(raw) {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      this.#markFatal(new SafeFailure('cdp-message-malformed'));
      return;
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new SafeFailure('cdp-command-failed'));
      else pending.resolve(message.result);
      return;
    }
    if (typeof message.method === 'string' && this.eventSink) {
      try {
        this.eventSink(message.method, message.params || {});
      } catch {
        this.#markFatal(new SafeFailure('cdp-event-reducer-failed'));
      }
    }
  }

  #rejectPending(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  #markFatal(error) {
    if (!this.fatalError) this.fatalError = error;
    this.#rejectPending(this.fatalError);
    try { this.socket.close(); } catch {}
  }

  close() {
    try { this.socket.close(); } catch {}
  }
}

function runtimeValue(result) {
  if (result?.exceptionDetails || !Object.hasOwn(result || {}, 'result')) {
    fail('renderer-evaluation-failed');
  }
  return result.result.value;
}

async function evaluate(cdp, expression, timeoutMs = CDP_TIMEOUT_MS) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, timeoutMs);
  return runtimeValue(result);
}

async function waitForRendererTransport(cdp) {
  const deadline = monotonicMs() + STARTUP_TIMEOUT_MS;
  while (monotonicMs() < deadline) {
    try {
      const ready = await evaluate(cdp, `(() => ({
        bridge: Boolean(window.electronC3?.getLocalAccess?.()),
        shim: window.__intentSmithLegacyLocalFetchV1 === true,
        bus: Boolean(window.C3Bus?.on && window.C3Bus?.off),
        ws: Boolean(window.C3WS?.send && window.C3WS?.isReady?.())
      }))()`);
      if (ready?.bridge && ready?.shim && ready?.bus && ready?.ws) return;
    } catch {
      // Expected during renderer reload.
      cdp.assertHealthy();
    }
    await delay(150);
  }
  fail('renderer-transport-timeout');
}

async function rendererSettingsPost(cdp) {
  const result = await evaluate(cdp, `(async () => {
    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      return { status: response.status, ok: response.ok };
    } catch {
      return { status: null, ok: false };
    }
  })()`);
  if (!result?.ok || !Number.isInteger(result.status)) fail('renderer-settings-post-failed');
  return result.status;
}

async function installSoakLifecycleMonitor(cdp) {
  const installed = await evaluate(cdp, `(() => {
    if (window.__intentSmithStudioLifecycleProbeV1) return false;
    const counts = {
      assistantMessages: 0,
      systemMessages: 0,
      disconnects: 0,
      turnStarts: 0,
      turnEnds: 0,
      routingDecisions: 0,
      conversationRouteDecisions: 0,
      unexpectedRouteDecisions: 0,
      unexpectedAgentEvents: 0,
      forbiddenEffects: 0,
      agentErrors: 0,
      idleSignals: 0
    };
    const handlers = {
      message: () => { counts.assistantMessages += 1; },
      system: () => { counts.systemMessages += 1; },
      disconnected: () => { counts.disconnects += 1; },
      agent: wrapped => {
        const type = wrapped?.event?.type;
        if (type === 'turn_start') counts.turnStarts += 1;
        else if (type === 'turn_end') counts.turnEnds += 1;
        else if (type === 'cre_decision') {
          counts.routingDecisions += 1;
          if (wrapped?.event?.payload?.intent === 'conversation') {
            counts.conversationRouteDecisions += 1;
          } else counts.unexpectedRouteDecisions += 1;
        } else if ([
          'llm_start',
          'llm_token',
          'llm_done',
          'tool_call',
          'tool_result',
          'edit_request',
          'edit_timeout',
          'edit_conflict'
        ].includes(type)) {
          counts.forbiddenEffects += 1;
        } else if (type === 'error') counts.agentErrors += 1;
        else if (!['gate_verdict', 'status_change', 'system_step'].includes(type)) {
          counts.unexpectedAgentEvents += 1;
        }
      },
      status: event => {
        if (event?.data?.agentStatus === 'idle') counts.idleSignals += 1;
      }
    };
    window.C3Bus.on('chat:message', handlers.message);
    window.C3Bus.on('chat:system', handlers.system);
    window.C3Bus.on('ws:disconnected', handlers.disconnected);
    window.C3Bus.on('agent:event', handlers.agent);
    window.C3Bus.on('status:update', handlers.status);
    Object.defineProperty(window, '__intentSmithStudioLifecycleProbeV1', {
      configurable: true,
      enumerable: false,
      writable: false,
      value: { counts, handlers }
    });
    return true;
  })()`);
  if (installed !== true) fail('lifecycle-monitor-install-failed');
}

async function readAndRemoveSoakLifecycleMonitor(cdp) {
  return await evaluate(cdp, `(() => {
    const probe = window.__intentSmithStudioLifecycleProbeV1;
    if (!probe) return null;
    window.C3Bus.off('chat:message', probe.handlers.message);
    window.C3Bus.off('chat:system', probe.handlers.system);
    window.C3Bus.off('ws:disconnected', probe.handlers.disconnected);
    window.C3Bus.off('agent:event', probe.handlers.agent);
    window.C3Bus.off('status:update', probe.handlers.status);
    delete window.__intentSmithStudioLifecycleProbeV1;
    return { ...probe.counts };
  })()`);
}

async function rendererFunctionalWsProbe(cdp) {
  return await evaluate(cdp, `(async () => {
    const prompt = 'kolik je 17 * 23?';
    let conversation;
    try {
      const response = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Studio transport probe' })
      });
      const parsed = await response.json();
      conversation = parsed?.conversation;
      if (response.status !== 201 || typeof conversation?.id !== 'string') {
        return { resultClass: 'conversation-create-failed' };
      }
    } catch {
      return { resultClass: 'conversation-create-failed' };
    }

    return await new Promise(resolve => {
      let settled = false;
      let sent = false;
      let turnId = null;
      let sequence = 0;
      let assistantOrder = null;
      let turnEndOrder = null;
      let idleOrder = null;
      const counts = {
        turnStarts: 0,
        routingDecisions: 0,
        conversationRouteDecisions: 0,
        unexpectedRouteDecisions: 0,
        unexpectedAgentEvents: 0,
        assistantMessages: 0,
        turnEndsOk: 0,
        forbiddenEffects: 0,
        errorSignals: 0
      };
      let assistantMatches = false;
      let assistantCorrelated = false;
      let assistantModeValid = false;
      let disconnected = false;

      const removeListeners = () => {
        window.C3Bus.off('agent:event', onAgent);
        window.C3Bus.off('chat:message', onMessage);
        window.C3Bus.off('chat:system', onSystem);
        window.C3Bus.off('status:update', onStatus);
        window.C3Bus.off('ws:disconnected', onDisconnected);
      };
      const finish = resultClass => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        removeListeners();
        resolve({
          conversationCreated: true,
          sent,
          ...counts,
          assistantMatches,
          assistantCorrelated,
          assistantModeValid,
          disconnected,
          orderValid: (
            assistantOrder !== null
            && turnEndOrder !== null
            && idleOrder !== null
            && assistantOrder < turnEndOrder
            && turnEndOrder < idleOrder
          ),
          resultClass
        });
      };
      const onAgent = wrapped => {
        sequence += 1;
        const event = wrapped?.event;
        if (!event || typeof event.type !== 'string') return;
        if (event.type === 'turn_start' && event.payload?.input === prompt) {
          counts.turnStarts += 1;
          if (!turnId) turnId = event.turnId;
          else if (turnId !== event.turnId) counts.errorSignals += 1;
          return;
        }
        if (!turnId || event.turnId !== turnId) return;
        if (event.type === 'cre_decision') {
          counts.routingDecisions += 1;
          if (event.payload?.intent === 'conversation') {
            counts.conversationRouteDecisions += 1;
          } else counts.unexpectedRouteDecisions += 1;
        } else if ([
          'llm_start',
          'llm_token',
          'llm_done',
          'tool_call',
          'tool_result',
          'edit_request',
          'edit_timeout',
          'edit_conflict'
        ].includes(event.type)) {
          counts.forbiddenEffects += 1;
        } else if (event.type === 'error') {
          counts.errorSignals += 1;
        } else if (event.type === 'turn_end') {
          if (event.payload?.status === 'ok') counts.turnEndsOk += 1;
          else counts.errorSignals += 1;
          turnEndOrder = sequence;
        } else if (!['gate_verdict', 'status_change', 'system_step'].includes(event.type)) {
          counts.unexpectedAgentEvents += 1;
        }
      };
      const onMessage = event => {
        sequence += 1;
        counts.assistantMessages += 1;
        assistantOrder = sequence;
        assistantMatches = typeof event?.content === 'string'
          && /17\\s*(?:\\*|×)\\s*23\\s*=\\s*391/.test(event.content);
        assistantCorrelated = Boolean(
          turnId
          && event?.metadata?.turnId === turnId
          && event?.metadata?.conversationId === conversation.id
        );
        assistantModeValid = event?.tag === 'conversation'
          && event?.metadata?.mode === 'conversation';
      };
      const onSystem = () => { counts.errorSignals += 1; };
      const onStatus = event => {
        sequence += 1;
        if (turnEndOrder !== null && event?.data?.agentStatus === 'idle') {
          idleOrder = sequence;
          setTimeout(() => finish('terminal-idle'), 250);
        }
      };
      const onDisconnected = () => {
        disconnected = true;
        finish('disconnected');
      };
      window.C3Bus.on('agent:event', onAgent);
      window.C3Bus.on('chat:message', onMessage);
      window.C3Bus.on('chat:system', onSystem);
      window.C3Bus.on('status:update', onStatus);
      window.C3Bus.on('ws:disconnected', onDisconnected);
      const timeout = setTimeout(() => {
        window.C3WS.send('control', {
          action: 'cancel',
          conversationId: conversation.id
        });
        finish('timeout');
      }, 15_000);
      sent = window.C3WS.send('chat', {
        content: prompt,
        conversationId: conversation.id,
        editMode: 'ask',
        agentId: null,
        projectId: null,
        attachments: []
      });
      if (!sent) finish('send-rejected');
    });
  })()`, 25_000);
}

function directRequest(access, { origin, fetchSite, includeCapability }) {
  return new Promise((resolve, reject) => {
    const headers = { 'Sec-Fetch-Site': fetchSite, Connection: 'close' };
    if (origin !== undefined) headers.Origin = origin;
    if (includeCapability) {
      headers['X-IntentSmith-Local-Capability'] = access.localCapability;
    }
    const request = http.request({
      host: '127.0.0.1',
      port: access.port,
      path: '/api/health',
      method: 'GET',
      headers,
      timeout: 5_000,
    }, response => {
      const status = response.statusCode;
      let settled = false;
      const finish = (error = null) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve(status);
      };
      response.once('aborted', () => finish(new Error('response-aborted')));
      response.once('error', finish);
      response.resume();
      response.once('end', () => finish());
    });
    request.once('timeout', () => request.destroy(new Error('timeout')));
    request.once('error', reject);
    request.end();
  });
}

async function negativeBoundary(access) {
  const crossSite = await directRequest(access, {
    origin: undefined,
    fetchSite: 'cross-site',
    includeCapability: true,
  });
  const missingCapability = await directRequest(access, {
    origin: 'null',
    fetchSite: 'cross-site',
    includeCapability: false,
  });
  if (crossSite !== 403) fail('cross-site-without-origin-not-rejected');
  if (missingCapability !== 403) fail('opaque-without-capability-not-rejected');
  return Object.freeze([
    Object.freeze({
      case: 'cross-site-no-origin-with-capability',
      status: crossSite,
      outcome: 'rejected',
    }),
    Object.freeze({
      case: 'opaque-origin-without-capability',
      status: missingCapability,
      outcome: 'rejected',
    }),
  ]);
}

async function hashBoundedFile(file) {
  const metadata = await lstat(file);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_LOG_BYTES) {
    fail('diagnostic-log-invalid');
  }
  const bytes = await readFile(file);
  return createHash('sha256').update(bytes).digest('hex');
}

async function captureBuildDigests() {
  const files = {
    electronMainSha256:
      'c3-ide/applications/electron/lib/backend/electron-main.js',
    frontendBundleSha256:
      'c3-ide/applications/electron/lib/frontend/bundle.js',
    frontendIndexSha256:
      'c3-ide/applications/electron/lib/frontend/index.html',
    preloadSha256:
      'c3-ide/applications/electron/lib/frontend/preload.js',
  };
  const result = {};
  for (const [key, relative] of Object.entries(files)) {
    const absolute = path.join(SOURCE_ROOT, relative);
    const metadata = await lstat(absolute);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size === 0) {
      fail('studio-build-artifact-invalid');
    }
    result[key] = createHash('sha256').update(await readFile(absolute)).digest('hex');
  }
  return Object.freeze(result);
}

export function actualPositiveBoundary(snapshot) {
  const record = snapshot.http.find(record => (
    record.routeId === STUDIO_ROUTE_IDS.API_HEALTH
    && record.methodClass === 'GET'
    && record.statusClass === '2xx'
    && record.originClass === 'opaque'
    && record.fetchSiteClass === 'cross-site'
    && record.capabilityClass === 'match'
    && record.allowOriginClass === 'opaque'
  ));
  return record?.status ?? null;
}

export function validateFunctional(result) {
  return Boolean(
    result?.conversationCreated === true
    && result.sent === true
    && result.turnStarts === 1
    && result.routingDecisions === 1
    && result.conversationRouteDecisions === 1
    && result.unexpectedRouteDecisions === 0
    && result.unexpectedAgentEvents === 0
    && result.assistantMessages === 1
    && result.turnEndsOk === 1
    && result.modelProviderRequestsDuringTurn === 0
    && result.forbiddenEffects === 0
    && result.errorSignals === 0
    && result.assistantMatches === true
    && result.assistantCorrelated === true
    && result.assistantModeValid === true
    && result.disconnected === false
    && result.orderValid === true
    && result.resultClass === 'terminal-idle'
  );
}

export function validateSoakLifecycle(result) {
  return Boolean(
    result
    && result.assistantMessages === 1
    && result.systemMessages === 0
    && result.disconnects === 0
    && result.turnStarts === 1
    && result.turnEnds === 1
    && result.routingDecisions === 1
    && result.conversationRouteDecisions === 1
    && result.unexpectedRouteDecisions === 0
    && result.unexpectedAgentEvents === 0
    && result.forbiddenEffects === 0
    && result.agentErrors === 0
    && Number.isInteger(result.idleSignals)
    && result.idleSignals >= 1
  );
}

async function waitForNetworkQuiescence(reducer) {
  const deadline = monotonicMs() + 5_000;
  let previousEvents = -1;
  let stableSince = monotonicMs();
  while (monotonicMs() < deadline) {
    const events = reducer.snapshot().counts.events;
    if (events !== previousEvents) {
      previousEvents = events;
      stableSince = monotonicMs();
    } else if (monotonicMs() - stableSince >= 750) {
      return;
    }
    await delay(100);
  }
  fail('network-observation-not-quiescent');
}

function sanitizedExit(value) {
  return Object.freeze({
    started: value.started === true,
    exitCode: Number.isInteger(value.exitCode) ? value.exitCode : null,
    signal: typeof value.signal === 'string' ? value.signal : null,
    requestedSignal: new Set(['none', 'SIGTERM']).has(value.requestedSignal)
      ? value.requestedSignal
      : 'invalid',
    forced: value.forced === true,
    processGroupClean: value.processGroupClean === true,
  });
}

export function successEvidence({
  sourceRevision,
  observationDurationMs,
  networkCaptureDurationMs,
  snapshot,
  networkVerdict,
  negative,
  functional,
  soakMonitor,
  positiveBoundaryStatus,
  buildDigests,
  shutdown,
  portFileRemoved,
  logDigests,
}) {
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    evidenceType: 'intentsmith.studio-electron-boundary',
    sourceRevision,
    verdict: 'PASS',
    uiEvaluation: 'excluded-non-final-ui',
    isolation: Object.freeze({
      networkNamespace: 'owned-loopback-only',
      display: 'scoped-x11',
      electronSandbox: 'disabled-for-user-namespace-probe',
      ambientRuntimeEnvironment: 'process-neutral-allowlist-only',
    }),
    build: Object.freeze({
      provenance: 'fresh-clone-envelope-required',
      electronMainSha256: buildDigests.electronMainSha256,
      frontendBundleSha256: buildDigests.frontendBundleSha256,
      frontendIndexSha256: buildDigests.frontendIndexSha256,
      preloadSha256: buildDigests.preloadSha256,
    }),
    observation: Object.freeze({
      requiredDurationMs: STUDIO_M0_POLICY.requiredSoakMs,
      actualDurationMs: observationDurationMs,
      networkCaptureDurationMs,
    }),
    network: Object.freeze({ snapshot, evaluation: networkVerdict }),
    boundaryMatrix: Object.freeze([
      ...negative.map(item => Object.freeze({
        case: item.case,
        status: item.status,
        outcome: item.outcome,
      })),
      Object.freeze({
        case: 'electron-opaque-origin-with-capability',
        status: positiveBoundaryStatus,
        outcome: 'accepted',
      }),
    ]),
    functional: Object.freeze({
      transport: 'websocket',
      requestClass: 'deterministic-arithmetic',
      conversationCreated: functional.conversationCreated,
      sent: functional.sent,
      turnStarts: functional.turnStarts,
      routingDecisions: functional.routingDecisions,
      conversationRouteDecisions: functional.conversationRouteDecisions,
      unexpectedRouteDecisions: functional.unexpectedRouteDecisions,
      unexpectedAgentEvents: functional.unexpectedAgentEvents,
      assistantMessages: functional.assistantMessages,
      turnEndsOk: functional.turnEndsOk,
      modelProviderRequestsDuringTurn: functional.modelProviderRequestsDuringTurn,
      forbiddenEffects: functional.forbiddenEffects,
      errorSignals: functional.errorSignals,
      assistantMatches: functional.assistantMatches,
      assistantCorrelated: functional.assistantCorrelated,
      assistantModeValid: functional.assistantModeValid,
      disconnected: functional.disconnected,
      orderValid: functional.orderValid,
      resultClass: functional.resultClass,
    }),
    soakLifecycle: Object.freeze({
      assistantMessages: soakMonitor.assistantMessages,
      systemMessages: soakMonitor.systemMessages,
      disconnects: soakMonitor.disconnects,
      turnStarts: soakMonitor.turnStarts,
      turnEnds: soakMonitor.turnEnds,
      routingDecisions: soakMonitor.routingDecisions,
      conversationRouteDecisions: soakMonitor.conversationRouteDecisions,
      unexpectedRouteDecisions: soakMonitor.unexpectedRouteDecisions,
      unexpectedAgentEvents: soakMonitor.unexpectedAgentEvents,
      forbiddenEffects: soakMonitor.forbiddenEffects,
      agentErrors: soakMonitor.agentErrors,
      idleSignals: soakMonitor.idleSignals,
    }),
    shutdown: Object.freeze({
      electron: sanitizedExit(shutdown.electron),
      backend: sanitizedExit(shutdown.backend),
      portFileRemoved,
      processGroupsClean: (
        shutdown.electron.processGroupClean
        && shutdown.backend.processGroupClean
      ),
    }),
    diagnostics: Object.freeze({
      backendLogSha256: logDigests.backend,
      electronLogSha256: logDigests.electron,
    }),
  });
}

async function runJourney({ artifactRoot, sourceRevision, display, xauthority }) {
  const paths = makeRuntimePaths(artifactRoot);
  await prepareRuntime(paths);
  const buildDigests = await captureBuildDigests();
  let modelProviderSentinel;
  let backend;
  let electron;
  let cdp;
  let snapshot;
  let networkVerdict;
  let functional;
  let soakMonitor;
  let negative;
  let observationDurationMs = 0;
  let networkCaptureDurationMs = 0;
  let journeyError = null;
  let browserCloseRequested = false;

  try {
    modelProviderSentinel = await startModelProviderSentinel();
    const backendEnv = makeBackendEnvironment(paths, modelProviderSentinel.origin);
    const electronEnv = makeElectronEnvironment(paths, display, xauthority);
    backend = spawnLogged(process.execPath, ['src/server.js'], {
      cwd: SOURCE_ROOT,
      env: backendEnv,
      logFile: paths.backendLog,
    });
    const access = await waitForAccess(paths.portFile, backend.observation);
    electron = spawnLogged(process.execPath, [
      'c3-ide/applications/electron/scripts/launch.js',
      '--no-sandbox',
      '--remote-debugging-port=0',
      `--user-data-dir=${paths.electronData}`,
    ], {
      cwd: SOURCE_ROOT,
      env: electronEnv,
      logFile: paths.electronLog,
    });

    const debugPort = await waitForDevToolsActivePort(
      path.join(paths.electronData, 'DevToolsActivePort'),
      electron.observation,
    );
    const expectedEntrypoint = path.join(
      SOURCE_ROOT,
      'c3-ide/applications/electron/lib/frontend/index.html',
    );
    const target = await waitForCdpTarget(
      debugPort,
      electron.observation,
      expectedEntrypoint,
    );
    cdp = new CdpClient(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable', {
      maxTotalBufferSize: 8 * 1024 * 1024,
      maxResourceBufferSize: 512 * 1024,
    });

    const originalLocation = await evaluate(cdp, 'location.href');
    let observedEntrypoint = null;
    try {
      observedEntrypoint = fileURLToPath(new URL(originalLocation));
    } catch {
      // Handled by the exact comparison below.
    }
    if (observedEntrypoint !== expectedEntrypoint) {
      fail('renderer-entrypoint-not-file');
    }
    const theiaControlPlaneOrigin = theiaControlPlaneOriginFromEntrypoint(
      originalLocation,
      expectedEntrypoint,
    );
    if (!theiaControlPlaneOrigin) fail('theia-control-plane-origin-invalid');
    await cdp.send('Page.navigate', { url: 'about:blank' });
    const blankDeadline = monotonicMs() + CDP_TIMEOUT_MS;
    while (monotonicMs() < blankDeadline) {
      if (await evaluate(cdp, 'location.href') === 'about:blank') break;
      await delay(50);
    }
    if (await evaluate(cdp, 'location.href') !== 'about:blank') {
      fail('renderer-reset-failed');
    }
    await delay(500);

    const reducer = createStudioCdpEvidenceReducer({
      backendOrigin: access.backendUrl,
      controlPlaneOrigin: theiaControlPlaneOrigin,
      expectedCapability: access.localCapability,
    });
    cdp.setEventSink((method, params) => reducer.ingest(method, params));
    const networkCaptureStarted = monotonicMs();
    await cdp.send('Page.navigate', { url: originalLocation });
    await waitForRendererTransport(cdp);
    await installSoakLifecycleMonitor(cdp);
    const observationStarted = monotonicMs();
    await rendererSettingsPost(cdp);
    const modelProviderRequestsBeforeTurn = modelProviderSentinel.requestCount();
    functional = await rendererFunctionalWsProbe(cdp);
    functional.modelProviderRequestsDuringTurn = (
      modelProviderSentinel.requestCount() - modelProviderRequestsBeforeTurn
    );
    if (!validateFunctional(functional)) fail('functional-websocket-probe-failed');
    negative = await negativeBoundary(access);

    const remaining = STUDIO_M0_POLICY.requiredSoakMs
      - (monotonicMs() - observationStarted);
    if (remaining > 0) await delay(remaining + 50);
    const stillReady = await evaluate(cdp, 'window.C3WS?.isReady?.() === true');
    if (stillReady !== true) fail('websocket-not-ready-after-soak');
    await waitForNetworkQuiescence(reducer);
    soakMonitor = await readAndRemoveSoakLifecycleMonitor(cdp);
    if (!validateSoakLifecycle(soakMonitor)) fail('soak-lifecycle-contract-failed');
    observationDurationMs = monotonicMs() - observationStarted;
    networkCaptureDurationMs = monotonicMs() - networkCaptureStarted;
    snapshot = reducer.snapshot();
    networkVerdict = evaluateStudioCdpEvidence(
      snapshot,
      STUDIO_M0_POLICY,
      { observationDurationMs },
    );
    if (networkVerdict.verdict !== 'PASS') fail('network-evidence-failed');
    const positiveBoundaryStatus = actualPositiveBoundary(snapshot);
    if (!Number.isInteger(positiveBoundaryStatus)) {
      fail('positive-boundary-missing');
    }

    browserCloseRequested = true;
    try {
      await cdp.send('Browser.close', {}, 2_000);
    } catch {
      // Browser.close normally closes the CDP socket before returning.
    }
    await Promise.race([electron.observation.closed, delay(SHUTDOWN_TIMEOUT_MS)]);
    if (!electron.observation.state.closed) fail('electron-clean-shutdown-timeout');
  } catch (error) {
    journeyError = error;
  } finally {
    cdp?.close();
  }

  const baselinePids = new Set(
    String(process.env.INTENTSMITH_STUDIO_BASELINE_PGIDS || '')
      .split(',')
      .filter(value => /^\d+$/.test(value))
      .map(Number),
  );
  const electronRequestedSignal = browserCloseRequested ? null : 'SIGTERM';
  const cleanup = await runCleanupSequence([
    {
      name: 'electron',
      run: () => stopOwnedProcess(electron, electronRequestedSignal),
      fallback: failedCleanupExit(Boolean(electron), electronRequestedSignal),
    },
    {
      name: 'backend',
      run: () => stopOwnedProcess(backend, 'SIGTERM'),
      fallback: failedCleanupExit(Boolean(backend), 'SIGTERM'),
    },
    {
      name: 'model-provider-sentinel',
      run: async () => {
        if (modelProviderSentinel) await modelProviderSentinel.close();
        return true;
      },
      fallback: false,
    },
    {
      name: 'process-group',
      run: () => waitForOwnedDescendantsToExit(2_000, baselinePids),
      fallback: false,
    },
  ]);
  if (!journeyError && cleanup.error) journeyError = cleanup.error;
  const rawElectronExit = cleanup.results.electron;
  const rawBackendExit = cleanup.results.backend;
  const processGroupClean = cleanup.results['process-group'] === true;
  const electronExit = Object.freeze({
    ...rawElectronExit,
    processGroupClean,
  });
  const backendExit = Object.freeze({
    ...rawBackendExit,
    processGroupClean,
  });
  const shutdown = { electron: electronExit, backend: backendExit };
  const portFileRemoved = !fs.existsSync(paths.portFile);

  if (!journeyError) {
    if (
      electronExit.exitCode !== 0
      || electronExit.signal !== null
      || electronExit.forced
      || !electronExit.processGroupClean
    ) {
      journeyError = new SafeFailure('electron-shutdown-contract-failed');
    } else if (
      backendExit.exitCode !== 0
      || backendExit.signal !== null
      || backendExit.forced
      || !backendExit.processGroupClean
      || !portFileRemoved
    ) {
      journeyError = new SafeFailure('backend-shutdown-contract-failed');
    }
  }

  if (journeyError) throw journeyError;
  const buildDigestsAfter = await captureBuildDigests();
  if (JSON.stringify(buildDigestsAfter) !== JSON.stringify(buildDigests)) {
    fail('studio-build-mutated-during-run');
  }
  const finalSourceRevision = await inspectSource();
  if (finalSourceRevision !== sourceRevision) {
    fail('source-revision-changed-during-run');
  }
  const logDigests = {
    backend: await hashBoundedFile(paths.backendLog),
    electron: await hashBoundedFile(paths.electronLog),
  };
  const evidence = successEvidence({
    sourceRevision,
    observationDurationMs,
    networkCaptureDurationMs,
    snapshot,
    networkVerdict,
    negative,
    functional,
    soakMonitor,
    positiveBoundaryStatus: actualPositiveBoundary(snapshot),
    buildDigests,
    shutdown,
    portFileRemoved,
    logDigests,
  });
  await writePrivateJson(paths.evidence, evidence);
  return evidence;
}

async function namespaceMain() {
  let artifactRoot;
  try {
    artifactRoot = await assertPrivateDirectory(
      process.env.INTENTSMITH_TEST_ARTIFACT_DIR,
      'artifact-root',
    );
    const parentNetns = process.env.INTENTSMITH_STUDIO_PARENT_NETNS;
    const currentNetns = await stat('/proc/self/ns/net');
    if (!/^\d+$/.test(parentNetns || '') || String(currentNetns.ino) === parentNetns) {
      block('network-namespace-not-isolated');
    }
    const ipResult = runQuiet('ip', ['link', 'set', 'lo', 'up']);
    if (ipResult.status !== 0) block('isolated-loopback-unavailable');
    const x11 = await assertScopedX11();
    const x11Result = runQuiet('xdpyinfo', ['-display', x11.display], {
      env: {
        ...safeInheritedEnvironment(),
        DISPLAY: x11.display,
        XAUTHORITY: x11.xauthority,
      },
    });
    if (x11Result.status !== 0) block('isolated-x11-unreachable');
    const sourceRoot = process.env.INTENTSMITH_STUDIO_SOURCE_ROOT;
    if (sourceRoot !== SOURCE_ROOT) fail('source-root-mismatch');
    const sourceRevision = process.env.INTENTSMITH_TEST_SOURCE_REVISION;
    if (!SHA_PATTERN.test(sourceRevision || '')) block('source-revision-missing');
    await runJourney({
      artifactRoot,
      sourceRevision,
      display: x11.display,
      xauthority: x11.xauthority,
    });
    process.stdout.write('STUDIO_ELECTRON_BOUNDARY_PASS\n');
  } catch (error) {
    await writeFailureDetail(artifactRoot, error);
    const exitCode = effectiveExitCode(error);
    await writeSanitizedFailureEvidence(artifactRoot, error, exitCode);
    const code = safeFailureCode(error);
    process.stderr.write(
      `${exitCode === 2 ? 'STUDIO_ELECTRON_BOUNDARY_BLOCKED' : 'STUDIO_ELECTRON_BOUNDARY_FAIL'} ${code}\n`,
    );
    process.exitCode = exitCode;
  }
}

const invokedAsMain = process.argv[1]
  && path.resolve(process.argv[1]) === SELF;

if (invokedAsMain) {
  process.umask(0o077);
  if (process.argv.includes('--namespace-inner')) {
    await namespaceMain();
  } else {
    await outerMain();
  }
}
