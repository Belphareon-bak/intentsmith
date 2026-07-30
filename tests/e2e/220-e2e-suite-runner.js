// 220-e2e-suite-runner.js — private, fail-closed runner for large E2E suites
// ══════════════════════════════════════════════════════════════════════════════
// Runs the original S1 MiniC3 and S2 ShopFlow phase assertions against one
// runner-owned C3 server. All writable state is isolated below a caller-provided
// INTENTSMITH_TEST_ARTIFACT_DIR containing a `.intentsmith-artifacts` component.
//
// Usage:
//   node tests/e2e/220-e2e-suite-runner.js [--suite=s1|s2|all] [--clean]
//   node tests/e2e/220-e2e-suite-runner.js --self-check
// ══════════════════════════════════════════════════════════════════════════════

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';

const PRIVATE_ROOT_COMPONENT = '.intentsmith-artifacts';
const ARTIFACT_ROOT_ENV = 'INTENTSMITH_TEST_ARTIFACT_DIR';
const STATE_DIR_ENV = 'INTENTSMITH_TEST_STATE_DIR';
const PHASE_TIMEOUT_MS = 90 * 60 * 1000;
const DEFAULT_GLOBAL_DEADLINE_MS = 18 * 60 * 60 * 1000;
const SERVER_START_TIMEOUT_MS = 90_000;
const OLLAMA_PREFLIGHT_TIMEOUT_MS = 15_000;
const TERM_GRACE_MS = 8_000;
const KILL_GRACE_MS = 3_000;
const MAX_JSON_BYTES = 5 * 1024 * 1024;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..');
const NODE_BIN = process.execPath;

const SUITES = Object.freeze({
  s1: Object.freeze({
    name: 'S1 MiniC3',
    stateId: 's1-minic3',
    phases: Object.freeze([
      Object.freeze({ file: 'tests/e2e/200-s1-minic3-p1.e2e.js', desc: 'P1 Architecture' }),
      Object.freeze({ file: 'tests/e2e/201-s1-minic3-p2.e2e.js', desc: 'P2 Core' }),
      Object.freeze({ file: 'tests/e2e/202-s1-minic3-p3.e2e.js', desc: 'P3 Pipeline' }),
      Object.freeze({ file: 'tests/e2e/203-s1-minic3-p4.e2e.js', desc: 'P4 Refinement' }),
      Object.freeze({ file: 'tests/e2e/204-s1-minic3-p5.e2e.js', desc: 'P5 Tests' }),
      Object.freeze({ file: 'tests/e2e/205-s1-minic3-p6.e2e.js', desc: 'P6 Finalization' }),
    ]),
  }),
  s2: Object.freeze({
    name: 'S2 ShopFlow',
    stateId: 's2-shopflow',
    phases: Object.freeze([
      Object.freeze({ file: 'tests/e2e/206-s2-shopflow-p1.e2e.js', desc: 'P1 Research+Arch' }),
      Object.freeze({ file: 'tests/e2e/207-s2-shopflow-p2.e2e.js', desc: 'P2 Core+DB' }),
      Object.freeze({ file: 'tests/e2e/208-s2-shopflow-p3.e2e.js', desc: 'P3 Routes+Auth' }),
      Object.freeze({ file: 'tests/e2e/209-s2-shopflow-p4.e2e.js', desc: 'P4 Frontend' }),
      Object.freeze({ file: 'tests/e2e/210-s2-shopflow-p5.e2e.js', desc: 'P5 Export+Tests' }),
      Object.freeze({ file: 'tests/e2e/211-s2-shopflow-p6.e2e.js', desc: 'P6 Finalization' }),
    ]),
  }),
});

// All files created by this process or its children are private by default.
process.umask(0o077);

const activeProcessGroups = new Set();
let requestedSignal = null;
let signalCount = 0;

function usage() {
  return [
    'Usage: node tests/e2e/220-e2e-suite-runner.js [options]',
    '  --suite=s1|s2|all       Suite selection (default: all)',
    '  --clean                 Clear only this run-owned E2E state before phases',
    '  --deadline-ms=<number>  Finite global run deadline',
    '  --self-check            Validate isolation/argv/report plumbing; run no server or phases',
    '  --help                  Show this help',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    suite: 'all',
    clean: false,
    deadlineMs: DEFAULT_GLOBAL_DEADLINE_MS,
    selfCheck: false,
    help: false,
  };

  for (const arg of argv) {
    if (arg === '--clean') {
      options.clean = true;
    } else if (arg === '--self-check') {
      options.selfCheck = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg.startsWith('--suite=')) {
      options.suite = arg.slice('--suite='.length);
    } else if (arg.startsWith('--deadline-ms=')) {
      const value = Number(arg.slice('--deadline-ms='.length));
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`Invalid --deadline-ms value: ${arg}`);
      }
      options.deadlineMs = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!['s1', 's2', 'all'].includes(options.suite)) {
    throw new Error(`Invalid suite: ${options.suite}`);
  }
  return options;
}

function pathParts(path) {
  return resolve(path).split(sep).filter(Boolean);
}

function hasPrivateMarker(path) {
  return pathParts(path).includes(PRIVATE_ROOT_COMPONENT);
}

function inspectExistingPathChain(path) {
  const parts = pathParts(path);
  let current = sep;
  for (const part of parts) {
    current = join(current, part);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`Writable path contains a symbolic link: ${current}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`Writable path component is not a directory: ${current}`);
    }
  }
}

function resolvePrivateArtifactRoot(configuredRoot) {
  if (!configuredRoot) {
    throw new Error(`${ARTIFACT_ROOT_ENV} is required`);
  }
  if (!isAbsolute(configuredRoot)) {
    throw new Error(`${ARTIFACT_ROOT_ENV} must be an absolute path`);
  }

  const root = resolve(configuredRoot);
  if (!hasPrivateMarker(root)) {
    throw new Error(
      `${ARTIFACT_ROOT_ENV} must contain a ${PRIVATE_ROOT_COMPONENT} path component`,
    );
  }

  inspectExistingPathChain(root);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  inspectExistingPathChain(root);

  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Unsafe artifact root: ${root}`);
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new Error(`${ARTIFACT_ROOT_ENV} must not be accessible by group or others`);
  }

  const canonical = realpathSync(root);
  if (!hasPrivateMarker(canonical)) {
    throw new Error(`Canonical artifact root lost ${PRIVATE_ROOT_COMPONENT}: ${canonical}`);
  }
  return canonical;
}

function assertContained(root, candidate, label) {
  const rel = relative(root, candidate);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`${label} must be a strict child of ${root}: ${candidate}`);
  }
}

function ensurePrivateDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Unsafe private directory: ${path}`);
  }
  chmodSync(path, 0o700);
}

function createPrivateFile(path, content = '') {
  const fd = openSync(path, 'wx', 0o600);
  try {
    if (content) writeFileSync(fd, content, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(path, 0o600);
}

function openPrivateLog(path) {
  const fd = openSync(path, 'wx', 0o600);
  chmodSync(path, 0o600);
  return fd;
}

function assertRegularPrivateFile(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Unsafe private file: ${path}`);
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new Error(`Private file has group/other permissions: ${path}`);
  }
}

function makeRunPaths(artifactRoot, suiteLabel) {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
  const runId = `${suiteLabel}-${timestamp}-${process.pid}-${randomUUID()}`;
  const runRoot = join(artifactRoot, `e2e-suite-runner-${runId}`);
  assertContained(artifactRoot, runRoot, 'run root');
  mkdirSync(runRoot, { mode: 0o700 });
  chmodSync(runRoot, 0o700);

  const paths = {
    artifactRoot,
    runId,
    runRoot,
    home: join(runRoot, 'home'),
    xdgConfig: join(runRoot, 'xdg', 'config'),
    xdgCache: join(runRoot, 'xdg', 'cache'),
    xdgData: join(runRoot, 'xdg', 'data'),
    xdgState: join(runRoot, 'xdg', 'state'),
    xdgRuntime: join(runRoot, 'xdg', 'runtime'),
    temp: join(runRoot, 'tmp'),
    runtime: join(runRoot, 'runtime'),
    database: join(runRoot, 'runtime', 'c3.sqlite'),
    portFile: join(runRoot, 'runtime', 'server.port.json'),
    projects: join(runRoot, 'projects'),
    artifacts: join(runRoot, 'artifacts'),
    state: join(runRoot, 'artifacts', 'e2e-state'),
    logs: join(runRoot, 'artifacts', 'logs'),
    transcript: join(runRoot, 'artifacts', 'transcript.md'),
    report: join(runRoot, 'artifacts', 'report.json'),
    gitConfig: join(runRoot, 'home', '.gitconfig'),
  };

  for (const [label, path] of Object.entries(paths)) {
    if (typeof path === 'string' && !['artifactRoot', 'runId'].includes(label)) {
      assertContained(artifactRoot, path, label);
    }
  }

  for (const directory of [
    paths.home,
    paths.xdgConfig,
    paths.xdgCache,
    paths.xdgData,
    paths.xdgState,
    paths.xdgRuntime,
    paths.temp,
    paths.runtime,
    paths.projects,
    paths.artifacts,
    paths.logs,
  ]) {
    ensurePrivateDirectory(directory);
  }

  createPrivateFile(paths.gitConfig, '');
  createPrivateFile(paths.transcript, [
    '# IntentSmith private E2E transcript',
    '',
    `Run: ${runId}`,
    '',
  ].join('\n'));
  return paths;
}

function writePrivateJson(path, value) {
  const parent = dirname(path);
  const existing = existsSync(path) ? lstatSync(path) : null;
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) {
    throw new Error(`Refusing to replace unsafe report path: ${path}`);
  }

  const tmp = join(parent, `.report-${process.pid}-${randomUUID()}.tmp`);
  const fd = openSync(tmp, 'wx', 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  chmodSync(path, 0o600);
}

function relativeToArtifacts(paths, path) {
  return relative(paths.artifacts, path);
}

function safeError(error) {
  return String(error?.message || error || 'unknown error').slice(0, 2_000);
}

function validatePhaseFiles(suitesToRun) {
  const files = [];
  for (const suiteId of suitesToRun) {
    for (const phase of SUITES[suiteId].phases) {
      const absolute = resolve(REPO_ROOT, phase.file);
      assertContained(REPO_ROOT, absolute, `phase ${phase.file}`);
      const stat = lstatSync(absolute);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(`Unsafe or missing phase file: ${phase.file}`);
      }
      files.push(phase.file);
    }
  }
  return files;
}

function clearOwnedState(paths) {
  assertContained(paths.runRoot, paths.state, 'state directory');
  if (existsSync(paths.state)) {
    const stat = lstatSync(paths.state);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Refusing to recursively clean unsafe state path: ${paths.state}`);
    }
    rmSync(paths.state, { recursive: true, force: true });
  }
  ensurePrivateDirectory(paths.state);
}

function makeChildEnv(paths, port = '0') {
  const env = {};
  const inheritedKeys = [
    'PATH',
    'LANG',
    'LC_ALL',
    'TZ',
    'SYSTEMROOT',
    'WINDIR',
    'PATHEXT',
    'COMSPEC',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
  ];
  const modelKeys = [
    'OLLAMA_URL',
    'C3_CHAT_MODEL',
    'C3_MODEL_CHAT',
    'C3_MODEL_D1',
    'C3_MODEL_D2',
    'C3_MODEL_CODE',
    'C3_MODEL_R1',
    'C3_MODEL_R2',
  ];
  for (const key of [...inheritedKeys, ...modelKeys]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }

  Object.assign(env, {
    HOME: paths.home,
    XDG_CONFIG_HOME: paths.xdgConfig,
    XDG_CACHE_HOME: paths.xdgCache,
    XDG_DATA_HOME: paths.xdgData,
    XDG_STATE_HOME: paths.xdgState,
    XDG_RUNTIME_DIR: paths.xdgRuntime,
    TMPDIR: paths.temp,
    TMP: paths.temp,
    TEMP: paths.temp,
    GIT_CONFIG_GLOBAL: paths.gitConfig,
    GIT_CONFIG_NOSYSTEM: '1',
    NODE_ENV: 'test',
    CI: '1',
    NO_COLOR: '1',
    PYTHONNOUSERSITE: '1',
    C3_DB_PATH: paths.database,
    C3_PROJECTS_DIR: paths.projects,
    INTENTSMITH_TEST_PROJECTS_DIR: paths.projects,
    INTENTSMITH_TEST_ARTIFACT_DIR: paths.artifacts,
    [STATE_DIR_ENV]: paths.state,
    C3_E2E_STATE_DIR: paths.state,
    C3_TRANSCRIPT: paths.transcript,
    C3_HOST: '127.0.0.1',
    C3_PORT: String(port),
    PORT: String(port),
    C3_PORT_FILE: paths.portFile,
    C3_LIFECYCLE_AUTO_COMMIT: 'false',
    C3_ENABLE_AUTONOMY: 'false',
    C3_ENABLE_COMFYUI: 'false',
    C3_LOG_LEVEL: 'warn',
    NO_PROXY: '127.0.0.1,localhost,::1',
    no_proxy: '127.0.0.1,localhost,::1',
  });

  if (String(port) !== '0') {
    env.C3_URL = `http://127.0.0.1:${port}`;
    env.C3_SERVER_PORT = String(port);
  }
  return env;
}

function configuredOllamaUrl(env) {
  const raw = env.OLLAMA_URL || 'http://127.0.0.1:11434';
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('OLLAMA_URL is not a valid URL');
  }
  if (url.protocol !== 'http:') {
    throw new Error('OLLAMA_URL must use http for the local preflight');
  }
  if (url.username || url.password) {
    throw new Error('OLLAMA_URL must not contain credentials');
  }
  const host = url.hostname.toLowerCase();
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error(`OLLAMA_URL must target loopback, got ${url.hostname}`);
  }
  url.search = '';
  url.hash = '';
  return url;
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${url.origin}`);
    }
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_JSON_BYTES) {
      throw new Error(`Oversized JSON response from ${url.origin}`);
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

function canonicalModelName(name) {
  const value = String(name || '').trim();
  return value.endsWith(':latest') ? value.slice(0, -':latest'.length) : value;
}

async function preflightOllama(env) {
  const base = configuredOllamaUrl(env);
  const tagsUrl = new URL(`${base.pathname.replace(/\/+$/, '')}/api/tags`, base);
  const data = await fetchJson(tagsUrl, OLLAMA_PREFLIGHT_TIMEOUT_MS);
  if (!Array.isArray(data?.models) || data.models.length === 0) {
    throw new Error('Ollama preflight returned no installed models');
  }

  const expectedModel = env.C3_MODEL_CHAT || env.C3_CHAT_MODEL || 'qwen3.5:27b';
  const installed = new Set();
  for (const model of data.models) {
    installed.add(canonicalModelName(model?.name));
    installed.add(canonicalModelName(model?.model));
  }
  if (!installed.has(canonicalModelName(expectedModel))) {
    throw new Error(`Required chat model is not installed: ${expectedModel}`);
  }

  return {
    endpoint: base.origin,
    installedModelCount: data.models.length,
    expectedChatModel: expectedModel,
    expectedModelPresent: true,
  };
}

function groupAlive(pid) {
  if (!pid || process.platform === 'win32') return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    throw error;
  }
}

function signalGroup(pid, signal) {
  if (!pid || process.platform === 'win32') return false;
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

async function waitForGroupExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!groupAlive(pid)) return true;
    await delay(100);
  }
  return !groupAlive(pid);
}

async function terminateOwnedGroup(pid) {
  const result = {
    pid,
    termSent: false,
    killSent: false,
    terminated: true,
  };
  if (!pid || !groupAlive(pid)) {
    activeProcessGroups.delete(pid);
    return result;
  }

  result.termSent = signalGroup(pid, 'SIGTERM');
  if (await waitForGroupExit(pid, TERM_GRACE_MS)) {
    activeProcessGroups.delete(pid);
    return result;
  }

  result.killSent = signalGroup(pid, 'SIGKILL');
  result.terminated = await waitForGroupExit(pid, KILL_GRACE_MS);
  if (result.terminated) activeProcessGroups.delete(pid);
  return result;
}

function spawnOwned(command, args, options, stdoutPath, stderrPath) {
  if (process.platform === 'win32') {
    throw new Error('Owned process-group cleanup is unavailable on win32');
  }

  const stdoutFd = openPrivateLog(stdoutPath);
  const stderrFd = openPrivateLog(stderrPath);
  let child;
  try {
    child = spawn(command, args, {
      ...options,
      detached: true,
      shell: false,
      stdio: ['ignore', stdoutFd, stderrFd],
    });
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }

  if (child.pid) activeProcessGroups.add(child.pid);
  const exitPromise = new Promise(resolveExit => {
    let settled = false;
    child.once('error', error => {
      if (settled) return;
      settled = true;
      resolveExit({ code: null, signal: null, error: safeError(error) });
    });
    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      resolveExit({ code, signal, error: null });
    });
  });
  return { child, exitPromise, stdoutPath, stderrPath };
}

function readVerifiedPortFile(path, expectedPid) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Unsafe server port file: ${path}`);
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new Error(`Server port file is not private: ${path}`);
  }
  if (stat.size <= 0 || stat.size > 4096) return null;

  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (data.pid !== expectedPid) {
    throw new Error(`Server port-file PID mismatch: expected ${expectedPid}, got ${data.pid}`);
  }
  if (data.host !== '127.0.0.1') {
    throw new Error(`Server port-file host mismatch: ${String(data.host)}`);
  }
  if (!Number.isInteger(data.port) || data.port < 1 || data.port > 65535) {
    throw new Error(`Invalid server port: ${String(data.port)}`);
  }
  return data;
}

async function verifyServerHealth(port) {
  const url = new URL(`http://127.0.0.1:${port}/api/health`);
  const data = await fetchJson(url, 3_000);
  if (data?.status !== 'ok') {
    throw new Error(`Unexpected /api/health status: ${String(data?.status)}`);
  }
  return { url: url.origin, status: data.status };
}

async function startServer(paths, baseEnv, globalDeadlineAt) {
  const stdoutPath = join(paths.logs, 'server.stdout.log');
  const stderrPath = join(paths.logs, 'server.stderr.log');
  const handle = spawnOwned(
    NODE_BIN,
    ['src/server.js'],
    { cwd: REPO_ROOT, env: baseEnv },
    stdoutPath,
    stderrPath,
  );

  const startupDeadline = Math.min(
    globalDeadlineAt,
    Date.now() + SERVER_START_TIMEOUT_MS,
  );
  let exitInfo = null;
  handle.exitPromise.then(info => {
    exitInfo = info;
  });
  let lastHealthError = null;

  while (Date.now() < startupDeadline) {
    if (requestedSignal) throw new Error(`Interrupted by ${requestedSignal}`);
    if (exitInfo) {
      throw new Error(
        `C3 server exited before readiness (code=${exitInfo.code}, signal=${exitInfo.signal})`,
      );
    }

    const portData = readVerifiedPortFile(paths.portFile, handle.child.pid);
    if (portData) {
      try {
        const health = await verifyServerHealth(portData.port);
        return {
          ...handle,
          pid: handle.child.pid,
          port: portData.port,
          host: portData.host,
          health,
          stdoutLog: relativeToArtifacts(paths, stdoutPath),
          stderrLog: relativeToArtifacts(paths, stderrPath),
        };
      } catch (error) {
        lastHealthError = safeError(error);
      }
    }
    await delay(250);
  }

  throw new Error(
    `C3 server did not become healthy before deadline`
    + (lastHealthError ? `: ${lastHealthError}` : ''),
  );
}

async function runPhase(paths, suiteId, phase, phaseIndex, env, globalDeadlineAt) {
  const phaseStartedAt = new Date().toISOString();
  const startedMs = Date.now();
  const phaseNumber = phase.file.match(/\/(\d+)-/)?.[1] || String(phaseIndex + 1);
  const logStem = `${suiteId}-${phaseNumber}`;
  const stdoutPath = join(paths.logs, `${logStem}.stdout.log`);
  const stderrPath = join(paths.logs, `${logStem}.stderr.log`);
  const remainingMs = globalDeadlineAt - Date.now();

  if (remainingMs <= 0) {
    return {
      suite: suiteId,
      phase: phase.desc,
      file: phase.file,
      argv: [NODE_BIN, phase.file],
      status: 'GLOBAL_TIMEOUT',
      startedAt: phaseStartedAt,
      finishedAt: new Date().toISOString(),
      durationMs: 0,
      exitCode: null,
      signal: null,
      stdoutLog: null,
      stderrLog: null,
    };
  }

  const timeoutMs = Math.min(PHASE_TIMEOUT_MS, remainingMs);
  const timeoutStatus = remainingMs < PHASE_TIMEOUT_MS ? 'GLOBAL_TIMEOUT' : 'TIMEOUT';
  const handle = spawnOwned(
    NODE_BIN,
    [phase.file],
    { cwd: REPO_ROOT, env },
    stdoutPath,
    stderrPath,
  );

  let timer;
  const outcome = await Promise.race([
    handle.exitPromise.then(exit => ({ kind: 'exit', exit })),
    new Promise(resolveTimeout => {
      timer = setTimeout(() => resolveTimeout({ kind: 'timeout' }), timeoutMs);
    }),
  ]);
  clearTimeout(timer);

  let exit = null;
  let cleanup = null;
  let status;
  if (outcome.kind === 'timeout') {
    cleanup = await terminateOwnedGroup(handle.child.pid);
    exit = await Promise.race([
      handle.exitPromise,
      delay(KILL_GRACE_MS).then(() => ({
        code: null,
        signal: cleanup.killSent ? 'SIGKILL' : 'SIGTERM',
        error: cleanup.terminated ? null : 'process group survived cleanup',
      })),
    ]);
    status = timeoutStatus;
  } else {
    exit = outcome.exit;
    if (groupAlive(handle.child.pid)) {
      cleanup = await terminateOwnedGroup(handle.child.pid);
      status = cleanup.terminated ? 'PROCESS_LEAK' : 'CLEANUP_FAILED';
    } else {
      activeProcessGroups.delete(handle.child.pid);
      status = exit.error || exit.signal || exit.code !== 0 ? 'FAIL' : 'PASS';
    }
  }

  return {
    suite: suiteId,
    phase: phase.desc,
    file: phase.file,
    argv: [NODE_BIN, phase.file],
    status,
    startedAt: phaseStartedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    timeoutMs,
    exitCode: exit?.code ?? null,
    signal: exit?.signal ?? null,
    error: exit?.error || null,
    processGroupCleanup: cleanup,
    stdoutLog: relativeToArtifacts(paths, stdoutPath),
    stderrLog: relativeToArtifacts(paths, stderrPath),
  };
}

function appendNotRun(results, suiteId, phases, reason) {
  for (const phase of phases) {
    results.push({
      suite: suiteId,
      phase: phase.desc,
      file: phase.file,
      argv: [NODE_BIN, phase.file],
      status: 'NOT_RUN',
      reason,
      startedAt: null,
      finishedAt: null,
      durationMs: 0,
      exitCode: null,
      signal: null,
      stdoutLog: null,
      stderrLog: null,
    });
  }
}

function safeRemoveOwnedEntry(paths, path) {
  assertContained(paths.runRoot, path, 'cleanup path');
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return { path, removed: false, reason: 'absent' };
    throw error;
  }

  if (stat.isSymbolicLink()) {
    unlinkSync(path);
  } else if (stat.isDirectory()) {
    rmSync(path, { recursive: true, force: true });
  } else {
    unlinkSync(path);
  }
  return { path, removed: true, reason: null };
}

function cleanupPortFile(paths) {
  return safeRemoveOwnedEntry(paths, paths.portFile);
}

function cleanupTransientDirectories(paths) {
  return [
    safeRemoveOwnedEntry(paths, paths.temp),
    safeRemoveOwnedEntry(paths, paths.xdgRuntime),
  ];
}

function reportSummary(results) {
  return {
    expected: results.length,
    passed: results.filter(result => result.status === 'PASS').length,
    failed: results.filter(result => !['PASS', 'NOT_RUN'].includes(result.status)).length,
    notRun: results.filter(result => result.status === 'NOT_RUN').length,
  };
}

function makeInitialReport(options, paths, suitesToRun, phaseFiles) {
  return {
    schemaVersion: 1,
    runner: 'tests/e2e/220-e2e-suite-runner.js',
    runId: paths.runId,
    status: 'RUNNING',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    selection: {
      suite: options.suite,
      suites: suitesToRun,
      clean: options.clean,
      selfCheck: options.selfCheck,
    },
    limits: {
      phaseTimeoutMs: PHASE_TIMEOUT_MS,
      globalDeadlineMs: options.deadlineMs,
      serverStartTimeoutMs: SERVER_START_TIMEOUT_MS,
    },
    isolation: {
      configuredArtifactRoot: paths.artifactRoot,
      runRoot: paths.runRoot,
      home: paths.home,
      xdg: {
        config: paths.xdgConfig,
        cache: paths.xdgCache,
        data: paths.xdgData,
        state: paths.xdgState,
        runtime: paths.xdgRuntime,
      },
      temp: paths.temp,
      database: paths.database,
      portFile: paths.portFile,
      projects: paths.projects,
      artifacts: paths.artifacts,
      state: paths.state,
      transcript: paths.transcript,
      privateUmask: '0077',
      secretValuesRecorded: false,
    },
    phaseFiles,
    preflight: {
      filesystem: 'PASS',
      ollama: null,
      server: null,
    },
    phases: [],
    cleanup: null,
    summary: null,
    error: null,
  };
}

function selfCheck(options, paths, report, suitesToRun) {
  const selfCheckLog = join(paths.logs, 'self-check.log');
  createPrivateFile(selfCheckLog, 'self-check: filesystem and argv isolation only\n');
  assertRegularPrivateFile(selfCheckLog);
  assertRegularPrivateFile(paths.gitConfig);
  assertRegularPrivateFile(paths.transcript);

  const env = makeChildEnv(paths, '43210');
  const writablePaths = [
    env.HOME,
    env.XDG_CONFIG_HOME,
    env.XDG_CACHE_HOME,
    env.XDG_DATA_HOME,
    env.XDG_STATE_HOME,
    env.XDG_RUNTIME_DIR,
    env.TMPDIR,
    env.C3_DB_PATH,
    env.C3_PORT_FILE,
    env.C3_PROJECTS_DIR,
    env.INTENTSMITH_TEST_PROJECTS_DIR,
    env.INTENTSMITH_TEST_ARTIFACT_DIR,
    env[STATE_DIR_ENV],
    env.C3_TRANSCRIPT,
  ];
  for (const path of writablePaths) {
    assertContained(paths.runRoot, path, 'self-check writable path');
  }
  if (env.C3_URL !== 'http://127.0.0.1:43210') {
    throw new Error(`Self-check C3_URL mismatch: ${String(env.C3_URL)}`);
  }

  const expectedFiles = suitesToRun.flatMap(suiteId => SUITES[suiteId].phases.map(p => p.file));
  if (JSON.stringify(expectedFiles) !== JSON.stringify(report.phaseFiles)) {
    throw new Error('Self-check phase ordering mismatch');
  }

  report.status = 'SELF_CHECK_PASS';
  report.finishedAt = new Date().toISOString();
  report.preflight.filesystem = 'PASS';
  report.preflight.selfCheck = {
    status: 'PASS',
    serverStarted: false,
    phasesStarted: 0,
    log: relativeToArtifacts(paths, selfCheckLog),
  };
  report.summary = {
    expected: expectedFiles.length,
    passed: 0,
    failed: 0,
    notRun: expectedFiles.length,
  };
  return report;
}

function installSignalHandlers() {
  const handler = signal => {
    signalCount++;
    requestedSignal ||= signal;
    for (const pid of activeProcessGroups) {
      try {
        signalGroup(pid, signalCount === 1 ? 'SIGTERM' : 'SIGKILL');
      } catch {}
    }
  };
  process.on('SIGINT', () => handler('SIGINT'));
  process.on('SIGTERM', () => handler('SIGTERM'));
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`ERROR: ${safeError(error)}\n${usage()}`);
    return 2;
  }
  if (options.help) {
    console.log(usage());
    return 0;
  }

  installSignalHandlers();
  let paths = null;
  let report = null;
  let server = null;
  let exitCode = 1;

  try {
    const artifactRoot = resolvePrivateArtifactRoot(process.env[ARTIFACT_ROOT_ENV]);
    paths = makeRunPaths(artifactRoot, options.suite);
    const suitesToRun = options.suite === 'all' ? ['s1', 's2'] : [options.suite];
    const phaseFiles = validatePhaseFiles(suitesToRun);

    if (options.clean) clearOwnedState(paths);
    else ensurePrivateDirectory(paths.state);

    report = makeInitialReport(options, paths, suitesToRun, phaseFiles);
    writePrivateJson(paths.report, report);

    console.log(`IntentSmith large E2E runner: ${suitesToRun.join(', ')}`);
    console.log(`Private report: ${paths.report}`);

    if (options.selfCheck) {
      selfCheck(options, paths, report, suitesToRun);
      exitCode = 0;
      return exitCode;
    }

    const globalDeadlineAt = Date.now() + options.deadlineMs;
    const serverEnv = makeChildEnv(paths, '0');
    report.preflight.ollama = await preflightOllama(serverEnv);
    writePrivateJson(paths.report, report);

    server = await startServer(paths, serverEnv, globalDeadlineAt);
    report.preflight.server = {
      status: 'PASS',
      pid: server.pid,
      host: server.host,
      port: server.port,
      health: server.health,
      stdoutLog: server.stdoutLog,
      stderrLog: server.stderrLog,
    };
    writePrivateJson(paths.report, report);

    const phaseEnv = makeChildEnv(paths, server.port);
    const results = report.phases;

    for (let suitePosition = 0; suitePosition < suitesToRun.length; suitePosition++) {
      const suiteId = suitesToRun[suitePosition];
      const suite = SUITES[suiteId];

      if (requestedSignal || Date.now() >= globalDeadlineAt) {
        appendNotRun(results, suiteId, suite.phases, requestedSignal || 'global deadline exceeded');
        for (const remainingSuiteId of suitesToRun.slice(suitePosition + 1)) {
          appendNotRun(
            results,
            remainingSuiteId,
            SUITES[remainingSuiteId].phases,
            requestedSignal || 'global deadline exceeded',
          );
        }
        break;
      }

      console.log(`\n${suite.name}`);
      for (let index = 0; index < suite.phases.length; index++) {
        const phase = suite.phases[index];
        console.log(`  [${index + 1}/${suite.phases.length}] ${phase.desc}`);
        const result = await runPhase(
          paths,
          suiteId,
          phase,
          index,
          phaseEnv,
          globalDeadlineAt,
        );
        results.push(result);
        report.summary = reportSummary(results);
        writePrivateJson(paths.report, report);
        console.log(`    ${result.status} (${result.durationMs}ms)`);

        if (result.status !== 'PASS') {
          appendNotRun(
            results,
            suiteId,
            suite.phases.slice(index + 1),
            `dependency phase failed: ${phase.file}`,
          );
          report.summary = reportSummary(results);
          writePrivateJson(paths.report, report);
          break;
        }
      }
    }

    report.summary = reportSummary(results);
    const expectedCount = phaseFiles.length;
    const complete = results.length === expectedCount;
    const green = complete && results.every(result => result.status === 'PASS');
    report.status = green ? 'PASS' : 'FAIL';
    exitCode = green ? 0 : 1;
  } catch (error) {
    if (report) {
      report.status = 'FAIL';
      report.error = safeError(error);
    }
    console.error(`ERROR: ${safeError(error)}`);
    exitCode = 1;
  } finally {
    const cleanup = {
      serverProcessGroup: null,
      portFile: null,
      transientDirectories: [],
      errors: [],
    };

    if (server?.pid) {
      try {
        cleanup.serverProcessGroup = await terminateOwnedGroup(server.pid);
        if (!cleanup.serverProcessGroup.terminated) {
          cleanup.errors.push('server process group survived TERM/KILL');
        }
      } catch (error) {
        cleanup.errors.push(`server cleanup: ${safeError(error)}`);
      }
    } else {
      for (const pid of [...activeProcessGroups]) {
        try {
          const result = await terminateOwnedGroup(pid);
          if (!result.terminated) cleanup.errors.push(`process group ${pid} survived cleanup`);
        } catch (error) {
          cleanup.errors.push(`process group ${pid}: ${safeError(error)}`);
        }
      }
    }

    if (paths) {
      try {
        cleanup.portFile = cleanupPortFile(paths);
      } catch (error) {
        cleanup.errors.push(`port file cleanup: ${safeError(error)}`);
      }
      try {
        cleanup.transientDirectories = cleanupTransientDirectories(paths);
      } catch (error) {
        cleanup.errors.push(`transient cleanup: ${safeError(error)}`);
      }
    }

    if (report && paths) {
      if (cleanup.errors.length > 0) {
        report.status = 'FAIL';
        exitCode = 1;
      }
      if (requestedSignal) {
        report.status = 'FAIL';
        report.error ||= `Interrupted by ${requestedSignal}`;
        exitCode = requestedSignal === 'SIGINT' ? 130 : 143;
      }
      report.cleanup = cleanup;
      report.finishedAt = new Date().toISOString();
      report.summary ||= reportSummary(report.phases);
      try {
        writePrivateJson(paths.report, report);
        assertRegularPrivateFile(paths.report);
      } catch (error) {
        console.error(`ERROR: could not finalize private report: ${safeError(error)}`);
        exitCode = 1;
      }
      console.log(`Final status: ${report.status}`);
      console.log(`Private report: ${paths.report}`);
    }
  }

  return exitCode;
}

const exitCode = await main();
process.exitCode = exitCode;
