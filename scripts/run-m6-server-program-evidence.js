#!/usr/bin/env node

import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { openSync, closeSync } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  writeFile,
} from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import {
  M6_RUNNER_OWNED_SERVER_PROGRAMS,
} from '../contracts/m6/candidate-plan-v1.js';
import {
  runLogged,
  runWithOwnedProcessTerminationHandling,
} from './nightly-orchestrator.js';
import {
  loadTestRegistry,
  registryFingerprint,
} from './test-registry.js';

const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const LOCAL_CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const LOOPBACK = '127.0.0.1';
const SERVER_PORT = 3335;
const SERVER_START_TIMEOUT_MS = 90_000;
const SERVER_STOP_TIMEOUT_MS = 30_000;
const MODEL = 'qwen3.5:27b';
const AUTHORITY = 'm6-runner-owned-server-programs-v1';

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function sourceState(root) {
  return {
    head: git(root, ['rev-parse', 'HEAD']),
    porcelain: git(root, ['status', '--porcelain=v1', '--untracked-files=all']),
  };
}

function assertCleanCandidate(root, candidateSha, label) {
  const state = sourceState(root);
  if (state.head !== candidateSha || state.porcelain !== '') {
    throw new Error(`${label}: exact M6 candidate is not clean`);
  }
}

function relative(root, target) {
  return path.relative(root, target).split(path.sep).join('/');
}

async function sha256File(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function writePrivateJsonAtomic(filePath, value) {
  const temporary = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  await rename(temporary, filePath);
  await chmod(filePath, 0o600);
}

async function createPhaseRoot(root, candidateSha) {
  const phaseRoot = path.join(
    root,
    '.intentsmith-artifacts',
    'm6',
    `candidate-${candidateSha}`,
    'server-programs',
  );
  await mkdir(path.dirname(phaseRoot), { recursive: true, mode: 0o700 });
  try {
    await mkdir(phaseRoot, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(
        `Refusing to reuse M6 server-program evidence: ${relative(root, phaseRoot)}`,
      );
    }
    throw error;
  }
  const metadata = await lstat(phaseRoot);
  if (
    !metadata.isDirectory()
    || metadata.isSymbolicLink()
    || await realpath(phaseRoot) !== phaseRoot
    || (metadata.mode & 0o077) !== 0
  ) {
    throw new Error('M6 server-program evidence root is not a private canonical directory');
  }
  return phaseRoot;
}

async function createProgramRuntime(phaseRoot, programId) {
  const runtime = path.join(phaseRoot, 'runtime', programId.toLowerCase());
  const paths = {
    runtime,
    home: path.join(runtime, 'home'),
    temp: path.join(runtime, 'tmp'),
    projects: path.join(runtime, 'projects'),
    artifacts: path.join(runtime, 'artifacts'),
    npmCache: path.join(runtime, 'artifacts', 'npm-cache'),
    xdgConfig: path.join(runtime, 'xdg', 'config'),
    xdgCache: path.join(runtime, 'xdg', 'cache'),
    xdgData: path.join(runtime, 'xdg', 'data'),
    xdgState: path.join(runtime, 'xdg', 'state'),
    database: path.join(runtime, 'intentsmith.sqlite'),
    portFile: path.join(runtime, 'server.port.json'),
    gitConfig: path.join(runtime, 'gitconfig'),
    testLog: path.join(runtime, 'test.log'),
    serverStdout: path.join(runtime, 'server.stdout.log'),
    serverStderr: path.join(runtime, 'server.stderr.log'),
  };
  for (const directory of [
    paths.runtime,
    paths.home,
    paths.temp,
    paths.projects,
    paths.artifacts,
    paths.npmCache,
    paths.xdgConfig,
    paths.xdgCache,
    paths.xdgData,
    paths.xdgState,
  ]) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
  }
  await writeFile(paths.gitConfig, '', { flag: 'wx', mode: 0o600 });
  return paths;
}

function privateToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

function programEnvironment(paths, candidateSha, suite, nonce, adminToken) {
  const environment = {};
  for (const key of ['PATH', 'LANG', 'LC_ALL', 'TZ']) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  return {
    ...environment,
    HOME: paths.home,
    XDG_CONFIG_HOME: paths.xdgConfig,
    XDG_CACHE_HOME: paths.xdgCache,
    XDG_DATA_HOME: paths.xdgData,
    XDG_STATE_HOME: paths.xdgState,
    TMPDIR: paths.temp,
    TMP: paths.temp,
    TEMP: paths.temp,
    npm_config_cache: paths.npmCache,
    GIT_CONFIG_GLOBAL: paths.gitConfig,
    GIT_CONFIG_NOSYSTEM: '1',
    NODE_ENV: 'test',
    CI: '1',
    NO_COLOR: '1',
    NODE_NO_WARNINGS: '1',
    DOTENV_CONFIG_PATH: path.join(paths.temp, 'missing.env'),
    DOTENV_CONFIG_QUIET: 'true',
    C3_AUDIT_RUN: '1',
    INTENTSMITH_TEST_SOURCE_REVISION: candidateSha,
    INTENTSMITH_TEST_SUITE_ID: suite.id,
    INTENTSMITH_TEST_SERVER_NONCE: nonce,
    C3_ADMIN_TOKEN: adminToken,
    C3_DB_PATH: paths.database,
    C3_PROJECTS_DIR: paths.projects,
    INTENTSMITH_TEST_PROJECTS_DIR: paths.projects,
    INTENTSMITH_TEST_ARTIFACT_DIR: paths.artifacts,
    C3_HOST: LOOPBACK,
    C3_PORT: String(SERVER_PORT),
    PORT: String(SERVER_PORT),
    C3_PORT_FILE: paths.portFile,
    C3_URL: `http://${LOOPBACK}:${SERVER_PORT}`,
    OLLAMA_URL: suite.requirements.ollama
      ? 'http://127.0.0.1:11434'
      : 'http://127.0.0.1:9',
    C3_MODEL_D1: MODEL,
    C3_MODEL_D2: MODEL,
    C3_MODEL_CODE: MODEL,
    C3_MODEL_R1: MODEL,
    C3_MODEL_R2: MODEL,
    C3_MODEL_CHAT: MODEL,
    C3_CORS_ORIGINS: '',
    C3_ENABLE_AGENTS: 'true',
    C3_ENABLE_EXPERTISES: 'true',
    C3_ENABLE_LIFECYCLE: 'true',
    C3_ENABLE_SKILLS: 'true',
    C3_ENABLE_AUTONOMY: 'false',
    C3_ENABLE_COMFYUI: 'false',
    C3_ENABLE_MARKETPLACE: 'false',
    C3_ENABLE_EXTERNAL_NOTIFICATIONS: 'false',
    C3_ENABLE_TELEMETRY: 'false',
    C3_ENABLE_ONLINE_DISCOVERY: 'false',
    C3_MODEL_UNIVERSE_ENABLED: 'false',
    C3_MODEL_RUNTIME_GUARD_ENABLED: 'false',
    C3_LIFECYCLE_AUTO_COMMIT: 'false',
    C3_UPDATE_REPO: '',
    C3_LOG_LEVEL: 'warn',
    NO_PROXY: '127.0.0.1,localhost,::1',
    no_proxy: '127.0.0.1,localhost,::1',
  };
}

function childExit(child) {
  return new Promise(resolve => {
    let settled = false;
    child.once('error', error => {
      if (settled) return;
      settled = true;
      resolve({ code: null, signal: null, error: error.message });
    });
    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      resolve({ code, signal, error: null });
    });
  });
}

async function assertServerPortAvailable() {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', error => {
      const typed = new Error(`M6 server port ${SERVER_PORT} is unavailable: ${error.code}`);
      typed.code = 'M6_SERVER_PORT_UNAVAILABLE';
      reject(typed);
    });
    probe.listen({ host: LOOPBACK, port: SERVER_PORT, exclusive: true }, () => {
      probe.close(error => error ? reject(error) : resolve());
    });
  });
}

async function readServerAuthority(portFile, expectedPid, expectedNonce) {
  let metadata;
  try {
    metadata = await lstat(portFile);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (
    !metadata.isFile()
    || metadata.isSymbolicLink()
    || (metadata.mode & 0o077) !== 0
    || metadata.size < 2
    || metadata.size > 4096
    || await realpath(portFile) !== portFile
  ) {
    throw new Error('M6 server port authority is not a private canonical regular file');
  }
  let value;
  try {
    value = JSON.parse(await readFile(portFile, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (
    value?.pid !== expectedPid
    || value?.host !== LOOPBACK
    || value?.port !== SERVER_PORT
    || value?.testRunNonce !== expectedNonce
    || !LOCAL_CAPABILITY_PATTERN.test(value?.localCapability || '')
  ) {
    throw new Error('M6 server port authority does not match its runner-owned process');
  }
  return Object.freeze({
    pid: value.pid,
    host: value.host,
    port: value.port,
    localCapability: value.localCapability,
  });
}

async function verifyHealth() {
  const response = await fetch(`http://${LOOPBACK}:${SERVER_PORT}/api/health`, {
    headers: { Accept: 'application/json', Connection: 'close' },
    redirect: 'error',
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error(`M6 owned server health returned HTTP ${response.status}`);
  const value = await response.json();
  if (value?.status !== 'ok') throw new Error('M6 owned server health payload is not ok');
}

async function startServer(root, environment, paths, nonce) {
  const stdout = openSync(paths.serverStdout, 'wx', 0o600);
  const stderr = openSync(paths.serverStderr, 'wx', 0o600);
  let child;
  try {
    child = spawn(process.execPath, ['src/server.js'], {
      cwd: root,
      env: environment,
      detached: false,
      shell: false,
      stdio: ['ignore', stdout, stderr],
    });
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
  const exitPromise = childExit(child);
  let exitInfo = null;
  exitPromise.then(value => { exitInfo = value; });
  try {
    const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
    let lastHealthError = null;
    while (Date.now() < deadline) {
      if (exitInfo) {
        throw new Error(
          `M6 owned server exited during startup: ${JSON.stringify(exitInfo)}`,
        );
      }
      const authority = await readServerAuthority(paths.portFile, child.pid, nonce);
      if (authority) {
        try {
          await verifyHealth();
          return { child, exitPromise, authority };
        } catch (error) {
          lastHealthError = error.message;
        }
      }
      await delay(100);
    }
    throw new Error(
      `M6 owned server did not become healthy${lastHealthError ? `: ${lastHealthError}` : ''}`,
    );
  } catch (error) {
    const cleanup = await stopServer({ child, exitPromise });
    if (!cleanup.terminated) {
      throw new AggregateError(
        [error, new Error('M6 startup-failed server did not terminate')],
        'M6 owned server startup and cleanup failed',
      );
    }
    throw error;
  }
}

async function stopServer(server) {
  if (!server?.child) return { clean: false, forced: false, terminated: false };
  if (server.child.exitCode !== null || server.child.signalCode !== null) {
    const result = await server.exitPromise;
    return {
      clean: result.code === 0 && result.signal === null && result.error === null,
      forced: false,
      terminated: true,
      result,
    };
  }
  server.child.kill('SIGTERM');
  let result = await Promise.race([
    server.exitPromise,
    delay(SERVER_STOP_TIMEOUT_MS).then(() => null),
  ]);
  let forced = false;
  if (result === null) {
    forced = true;
    server.child.kill('SIGKILL');
    result = await server.exitPromise;
  }
  return {
    clean: !forced && result.code === 0 && result.signal === null && result.error === null,
    forced,
    terminated: true,
    result,
  };
}

async function combineProgramLog(paths, root, suite, serverCleanup) {
  const output = [
    `authority=${AUTHORITY}`,
    `program=${suite.id}`,
    `server_cleanup=${JSON.stringify(serverCleanup)}`,
    '',
    '--- server stdout ---',
    await readFile(paths.serverStdout, 'utf8'),
    '--- server stderr ---',
    await readFile(paths.serverStderr, 'utf8'),
    '--- program output ---',
    await readFile(paths.testLog, 'utf8'),
  ].join('\n');
  const logPath = path.join(path.dirname(paths.runtime), `${suite.id}.log`);
  await writeFile(logPath, output, { flag: 'wx', mode: 0o600 });
  await chmod(logPath, 0o600);
  return { absolute: logPath, relative: relative(root, logPath) };
}

async function runProgram({ root, phaseRoot, candidateSha, suite }) {
  assertCleanCandidate(root, candidateSha, `${suite.id}:pre-state`);
  await assertServerPortAvailable();
  const paths = await createProgramRuntime(phaseRoot, suite.id);
  const nonce = privateToken();
  const environment = programEnvironment(
    paths,
    candidateSha,
    suite,
    nonce,
    privateToken(),
  );
  const startedAt = new Date().toISOString();
  let server = null;
  let execution = null;
  let serverCleanup = { clean: false, forced: false, terminated: false };
  try {
    server = await startServer(root, environment, paths, nonce);
    environment.INTENTSMITH_TEST_SERVER_PID = String(server.authority.pid);
    execution = await runLogged([...suite.argv], {
      cwd: root,
      env: environment,
      logPath: paths.testLog,
      allowFailure: true,
      timeoutMs: suite.timeoutMs,
    });
  } finally {
    serverCleanup = await stopServer(server);
  }
  const endedAt = new Date().toISOString();
  assertCleanCandidate(root, candidateSha, `${suite.id}:post-state`);
  const combined = await combineProgramLog(paths, root, suite, serverCleanup);
  const passed = execution !== null
    && execution.exitCode === 0
    && execution.signal === null
    && execution.timedOut === false
    && execution.leakDetected === false
    && execution.cleanupTerminated === true
    && serverCleanup.clean === true
    && serverCleanup.forced === false
    && serverCleanup.terminated === true;
  return {
    id: suite.id,
    path: suite.path,
    profile: suite.profile,
    category: suite.profile,
    command: [...suite.argv],
    blockers: ['server', ...(suite.requirements.ollama ? ['ollama'] : []),
      ...(suite.requirements.gpu ? ['gpu'] : [])],
    required: true,
    start: startedAt,
    end: endedAt,
    durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)),
    exitCode: execution?.exitCode ?? null,
    signal: execution?.signal ?? null,
    timedOut: execution?.timedOut ?? false,
    status: passed ? 'PASS' : execution?.timedOut ? 'TIMEOUT' : 'FAIL',
    retryCount: 0,
    logPath: combined.relative,
    sourceRevision: candidateSha,
    modelFixturePreflight: null,
    environment: {
      authority: AUTHORITY,
      inheritedKeys: ['PATH', 'LANG', 'LC_ALL', 'TZ'].filter(
        key => process.env[key] !== undefined,
      ),
      sourceRevision: candidateSha,
      runtimeRoot: relative(root, paths.runtime),
      server: {
        host: LOOPBACK,
        port: SERVER_PORT,
        pidBound: true,
        nonceBound: true,
        localCapabilityObserved: true,
        productionMode: false,
        reason: 'legacy journeys use authenticated development-loopback semantics',
      },
    },
    cleanup: {
      checked: true,
      leakDetected: execution?.leakDetected === true || !serverCleanup.clean,
      terminated: execution?.cleanupTerminated === true && serverCleanup.terminated === true,
      server: serverCleanup,
    },
    sourceTree: {
      checked: true,
      clean: true,
      porcelain: null,
      head: candidateSha,
    },
    logError: null,
    outputError: null,
    logSha256: await sha256File(combined.absolute),
  };
}

async function skippedProgramResult({ root, phaseRoot, candidateSha, suite, reason }) {
  const runtimeRoot = path.join(phaseRoot, 'runtime');
  await mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
  const logPath = path.join(runtimeRoot, `${suite.id}.log`);
  await writeFile(logPath, `status=SKIPPED\nreason=${reason}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  return {
    id: suite.id,
    path: suite.path,
    profile: suite.profile,
    category: suite.profile,
    command: [...suite.argv],
    blockers: ['server', ...(suite.requirements.ollama ? ['ollama'] : []),
      ...(suite.requirements.gpu ? ['gpu'] : [])],
    required: true,
    start: null,
    end: null,
    durationMs: 0,
    exitCode: null,
    signal: null,
    timedOut: false,
    status: 'SKIPPED',
    retryCount: 0,
    logPath: relative(root, logPath),
    sourceRevision: candidateSha,
    modelFixturePreflight: null,
    environment: { authority: AUTHORITY, sourceRevision: candidateSha },
    cleanup: { checked: true, leakDetected: false, terminated: true },
    sourceTree: {
      checked: true,
      clean: true,
      porcelain: null,
      head: candidateSha,
    },
    logError: null,
    outputError: null,
    logSha256: await sha256File(logPath),
  };
}

function reportFor({ candidateSha, fingerprint, phaseRoot, startedAt, endedAt, results }) {
  const failures = results.filter(result => result.status !== 'PASS');
  return {
    schemaVersion: 1,
    manifestType: 'intentsmith.audit-report',
    runId: `m6-server-programs-${candidateSha}`,
    sourceRevision: candidateSha,
    startedAt,
    endedAt,
    dryRun: false,
    options: {
      authority: AUTHORITY,
      acceptsArguments: false,
      concurrency: 1,
      serverPort: SERVER_PORT,
      programSet: [...M6_RUNNER_OWNED_SERVER_PROGRAMS],
    },
    paths: { runDir: relative(process.cwd(), phaseRoot) },
    inventoryFingerprint: createHash('sha256')
      .update(M6_RUNNER_OWNED_SERVER_PROGRAMS.join('\n'))
      .digest('hex'),
    optionsFingerprint: createHash('sha256').update(AUTHORITY).digest('hex'),
    registryHash: fingerprint,
    interruptionSignal: null,
    inventory: { selected: results.length },
    statusCounts: Object.fromEntries(
      [...new Set(results.map(result => result.status))]
        .map(status => [status, results.filter(result => result.status === status).length]),
    ),
    verdict: failures.length === 0 ? 'PASS' : 'FAIL',
    exitCode: failures.length === 0 ? 0 : 1,
    requiredFailureCount: failures.length,
    requiredBlockedCount: 0,
    results,
  };
}

export async function runM6ServerProgramEvidence(root = process.cwd(), argv = []) {
  if (argv.length > 0) {
    throw new Error('M6 server-program evidence uses a locked plan and accepts no arguments');
  }
  const canonicalRoot = git(root, ['rev-parse', '--show-toplevel']);
  if (await realpath(root) !== await realpath(canonicalRoot)) {
    throw new Error('M6 server-program evidence must run from the canonical worktree root');
  }
  const candidateSha = git(root, ['rev-parse', 'HEAD']);
  if (!SHA_PATTERN.test(candidateSha)) throw new Error('M6 candidate SHA is invalid');
  assertCleanCandidate(root, candidateSha, 'server-programs:pre-state');
  const registry = await loadTestRegistry(root);
  const fingerprint = registryFingerprint(registry);
  const suitesById = new Map(registry.suites.map(suite => [suite.id, suite]));
  const suites = M6_RUNNER_OWNED_SERVER_PROGRAMS.map(programId => {
    const suite = suitesById.get(programId);
    if (
      !suite
      || suite.required !== true
      || suite.state !== 'ACTIVE'
      || suite.requirements?.server !== true
      || suite.requirements?.network !== 'loopback'
    ) throw new Error(`M6 server program is not an ACTIVE required loopback suite: ${programId}`);
    return suite;
  });
  const phaseRoot = await createPhaseRoot(root, candidateSha);
  const startedAt = new Date().toISOString();
  const results = [];
  for (let index = 0; index < suites.length; index += 1) {
    const suite = suites[index];
    const result = await runProgram({ root, phaseRoot, candidateSha, suite });
    results.push(result);
    if (result.status !== 'PASS') {
      for (const remaining of suites.slice(index + 1)) {
        results.push(await skippedProgramResult({
          root,
          phaseRoot,
          candidateSha,
          suite: remaining,
          reason: `fail-fast-after-${suite.id}`,
        }));
      }
      break;
    }
  }
  const endedAt = new Date().toISOString();
  assertCleanCandidate(root, candidateSha, 'server-programs:post-state');
  const report = reportFor({
    candidateSha,
    fingerprint,
    phaseRoot,
    startedAt,
    endedAt,
    results,
  });
  const reportPath = path.join(phaseRoot, 'report.json');
  await writePrivateJsonAtomic(reportPath, report);
  return Object.freeze({
    candidateSha,
    registryFingerprint: fingerprint,
    reportPath: relative(root, reportPath),
    verdict: report.verdict,
    exitCode: report.exitCode,
  });
}

export async function main(argv = process.argv.slice(2)) {
  return await runWithOwnedProcessTerminationHandling(async () => {
    const result = await runM6ServerProgramEvidence(process.cwd(), argv);
    console.log(JSON.stringify(result, null, 2));
    return result.exitCode;
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().then(code => {
    process.exitCode = code;
  }).catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
