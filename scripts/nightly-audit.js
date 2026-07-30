#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { finished } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

import {
  TEST_PROFILES,
  loadTestRegistry,
  registryFingerprint,
} from './test-registry.js';

const DEFAULT_OUT_DIR = '.intentsmith-artifacts/test-runs';
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_DEADLINE_MS = 8 * 60 * 60 * 1000;
const PROFILE_ORDER = [
  'offline',
  'database',
  'server',
  'model',
  'soak',
  'manual',
];

export function parseArgs(argv = process.argv.slice(2)) {
  const opts = {
    root: process.cwd(),
    outDir: DEFAULT_OUT_DIR,
    runId: null,
    dryRun: false,
    failFast: false,
    resume: false,
    concurrency: 1,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    deadlineMs: DEFAULT_DEADLINE_MS,
    profiles: new Set(),
    ids: new Set(),
    exclude: new Set(),
    allowBlockers: new Set(),
    noBlock: false,
    allowDirty: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const eq = arg.indexOf('=');
      if (eq !== -1) return arg.slice(eq + 1);
      i += 1;
      return argv[i];
    };

    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--fail-fast') opts.failFast = true;
    else if (arg === '--resume') opts.resume = true;
    else if (arg === '--no-block') opts.noBlock = true;
    else if (arg === '--allow-dirty') opts.allowDirty = true;
    else if (arg.startsWith('--root')) opts.root = path.resolve(value());
    else if (arg.startsWith('--out-dir')) opts.outDir = value();
    else if (arg.startsWith('--run-id')) opts.runId = value();
    else if (arg.startsWith('--concurrency')) opts.concurrency = Math.max(1, Number(value()) || 1);
    else if (arg.startsWith('--timeout-ms')) opts.timeoutMs = Math.max(1, Number(value()) || DEFAULT_TIMEOUT_MS);
    else if (arg.startsWith('--timeout-minutes')) opts.timeoutMs = Math.max(1, Number(value()) || 10) * 60 * 1000;
    else if (arg.startsWith('--deadline-ms')) opts.deadlineMs = Math.max(1, Number(value()) || DEFAULT_DEADLINE_MS);
    else if (arg.startsWith('--deadline-hours')) opts.deadlineMs = Math.max(1, Number(value()) || 8) * 60 * 60 * 1000;
    else if (arg.startsWith('--profile')) addCsv(opts.profiles, value());
    else if (arg.startsWith('--suite')) addCsv(opts.ids, value());
    else if (arg.startsWith('--include')) addCsv(opts.profiles, value());
    else if (arg.startsWith('--exclude')) addCsv(opts.exclude, value());
    else if (arg.startsWith('--allow-blocker')) addCsv(opts.allowBlockers, value());
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  for (const profile of [...opts.profiles, ...opts.exclude]) {
    if (!TEST_PROFILES.includes(profile)) {
      throw new Error(`Unknown test profile: ${profile}`);
    }
  }
  return opts;
}

function addCsv(target, value) {
  for (const item of String(value || '').split(',')) {
    const trimmed = item.trim();
    if (trimmed) target.add(trimmed);
  }
}

function printHelp() {
  console.log(`Usage: node scripts/nightly-audit.js [options]

Options:
  --dry-run                     Discover and classify inventory only
  --profile=a,b                 Include only explicit registry profiles
  --suite=ID[,ID]               Include only exact stable registry IDs
  --exclude=a,b                 Exclude profiles
  --allow-blocker=ollama,gpu    Permit soft local prerequisites
  --no-block                    Bypass soft blockers in disposable fixtures
                                 (never state, external-network, or unowned server)
  --allow-dirty                 Permit non-dry-run audits from a dirty worktree
  --timeout-minutes=N           Per-suite timeout, default 10
  --deadline-hours=N            Total deadline, default 8
  --concurrency=N               Default 1
  --fail-fast                   Stop scheduling after first required failure
  --resume --run-id=ID          Resume from checkpoint
  --out-dir=PATH                Default ${DEFAULT_OUT_DIR}
`);
}

export async function discoverInventory(root = process.cwd()) {
  const registry = await loadTestRegistry(root);
  return registry.suites
    .map(suite => ({
      ...suite,
      category: suite.profile,
      command: suite.argv,
      blockers: blockersFor(suite),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function filterSuites(suites, opts) {
  return suites.filter(suite => {
    if (opts.ids?.size && !opts.ids.has(suite.id)) return false;
    if (opts.profiles?.size && !opts.profiles.has(suite.profile)) return false;
    if (opts.exclude?.has(suite.profile)) return false;
    return true;
  });
}

function blockersFor(suite) {
  const blockers = new Set();
  if (suite.state !== 'ACTIVE') blockers.add(`state-${suite.state.toLowerCase()}`);
  if (suite.requirements.server) blockers.add('server');
  if (suite.requirements.ollama) blockers.add('ollama');
  if (suite.requirements.gpu) blockers.add('gpu');
  if (suite.requirements.network === 'external') blockers.add('external-network');
  return [...blockers].sort();
}

export async function runAudit(options = {}) {
  const opts = {
    ...parseArgs([]),
    ...options,
    profiles: options.profiles instanceof Set
      ? options.profiles
      : new Set(options.profiles || options.include || []),
    ids: options.ids instanceof Set ? options.ids : new Set(options.ids || []),
    exclude: options.exclude instanceof Set ? options.exclude : new Set(options.exclude || []),
    allowBlockers: options.allowBlockers instanceof Set ? options.allowBlockers : new Set(options.allowBlockers || []),
  };
  for (const profile of [...opts.profiles, ...opts.exclude]) {
    if (!TEST_PROFILES.includes(profile)) throw new Error(`Unknown test profile: ${profile}`);
  }
  opts.root = path.resolve(opts.root);
  opts.outDir = path.resolve(opts.root, opts.outDir);
  const runId = opts.runId || makeRunId();
  assertSafeRunId(runId);
  const runDir = path.join(opts.outDir, runId);
  const logsDir = path.join(runDir, 'logs');
  if (!opts.resume && await pathExists(runDir)) {
    throw new Error(`Run id already exists: ${runId}. Use --resume to continue it or choose a new --run-id.`);
  }
  if (!opts.dryRun && !opts.allowDirty) {
    await assertCleanGitWorktree(opts.root);
  }

  const sourceRevision = await getSourceRevision(opts.root);
  const registry = await loadTestRegistry(opts.root);
  const registryHash = registryFingerprint(registry);
  const allSuites = await discoverInventory(opts.root);
  const knownIds = new Set(allSuites.map(suite => suite.id));
  for (const id of opts.ids) {
    if (!knownIds.has(id)) throw new Error(`Unknown test suite id: ${id}`);
  }
  const selectedSuites = filterSuites(allSuites, opts);
  if (selectedSuites.length === 0) {
    throw new Error('No test suites selected');
  }
  await mkdir(logsDir, { recursive: true, mode: 0o700 });
  await chmod(runDir, 0o700);
  await chmod(logsDir, 0o700);
  const counts = countByCategory(selectedSuites);
  const blockerCounts = countBlockers(selectedSuites);
  const inventoryFingerprint = fingerprintInventory(selectedSuites);
  const optionsSnapshot = makeOptionsSnapshot(opts);
  const optionsFingerprint = stableHash(optionsSnapshot);
  const checkpointPath = path.join(runDir, 'checkpoint.json');
  const reportPath = path.join(runDir, 'report.json');
  const inventoryPath = path.join(runDir, 'inventory.json');
  const startedAt = new Date().toISOString();
  const completedResults = opts.resume
    ? await readAndValidateResume({
      checkpointPath,
      inventoryPath,
      sourceRevision,
      inventoryFingerprint,
      optionsFingerprint,
      registryHash,
      expectedSuites: selectedSuites,
      root: opts.root,
      allowDirty: opts.allowDirty,
    })
    : [];
  const completedKeys = new Set(completedResults.map(resultKey));
  let checkpointWrite = Promise.resolve();

  await writeJSON(inventoryPath, {
    runId,
    sourceRevision,
    generatedAt: startedAt,
    counts,
    blockerCounts,
    inventoryFingerprint,
    optionsFingerprint,
    registryHash,
    options: optionsSnapshot,
    suites: selectedSuites,
  });

  if (opts.dryRun) {
    const report = makeReport({
      runId,
      sourceRevision,
      startedAt,
      endedAt: new Date().toISOString(),
      opts,
      inventory: selectedSuites,
      results: [],
      dryRun: true,
      counts,
      blockerCounts,
      runDir,
      inventoryFingerprint,
      optionsFingerprint,
      registryHash,
    });
    await writeJSON(reportPath, report);
    printInventorySummary(report);
    return report;
  }

  const deadlineAt = Date.now() + opts.deadlineMs;
  const pending = selectedSuites.filter(suite => !completedKeys.has(resultKey(suite)));
  const results = [...completedResults];
  let cursor = 0;
  let requiredFailureSeen = opts.resume
    ? false
    : results.some(result => result.required !== false && result.status !== 'PASS');

  async function nextSuite() {
    if (opts.failFast && requiredFailureSeen) return null;
    if (Date.now() >= deadlineAt) return null;
    if (cursor >= pending.length) return null;
    const suite = pending[cursor];
    cursor += 1;
    return suite;
  }

  async function worker() {
    for (;;) {
      const suite = await nextSuite();
      if (!suite) return;

      const disallowedBlockers = suite.blockers.filter(blocker => (
        isHardBlocker(blocker)
        || (!opts.noBlock && !opts.allowBlockers.has(blocker))
      ));
      let result;
      if (disallowedBlockers.length) {
        result = makeBlockedResult(suite, sourceRevision, disallowedBlockers);
      } else {
        result = await runSuite({ suite, opts, sourceRevision, logsDir, deadlineAt });
      }

      results.push(result);
      if (result.required !== false && result.status !== 'PASS') requiredFailureSeen = true;
      await enqueueCheckpoint({
        runId,
        sourceRevision,
        inventoryFingerprint,
        optionsFingerprint,
        registryHash,
        options: optionsSnapshot,
        updatedAt: new Date().toISOString(),
        results,
      });
      printSuiteProgress(results.length, selectedSuites.length, result);
    }
  }

  function enqueueCheckpoint(value) {
    checkpointWrite = checkpointWrite.then(() => writeJSONAtomic(checkpointPath, value));
    return checkpointWrite;
  }

  await Promise.all(Array.from({ length: opts.concurrency }, () => worker()));
  await checkpointWrite;

  for (let i = cursor; i < pending.length; i++) {
    const suite = pending[i];
    const result = makeSkippedResult(suite, sourceRevision, Date.now() >= deadlineAt ? 'total_deadline' : 'fail_fast');
    results.push(result);
  }
  if (results.length !== completedResults.length) {
    await enqueueCheckpoint({
      runId,
      sourceRevision,
      inventoryFingerprint,
      optionsFingerprint,
      registryHash,
      options: optionsSnapshot,
      updatedAt: new Date().toISOString(),
      results,
    });
    await checkpointWrite;
  }

  const endedAt = new Date().toISOString();
  const report = makeReport({
    runId,
    sourceRevision,
    startedAt,
    endedAt,
    opts,
    inventory: selectedSuites,
    results,
    dryRun: false,
    counts,
    blockerCounts,
    runDir,
    inventoryFingerprint,
    optionsFingerprint,
    registryHash,
  });
  await writeJSON(reportPath, report);
  printFinalSummary(report);
  return report;
}

async function runSuite({ suite, opts, sourceRevision, logsDir, deadlineAt }) {
  const startMs = Date.now();
  const startedAt = new Date(startMs).toISOString();
  const safeName = safeLogName(suite.path);
  const runDir = path.dirname(logsDir);
  const suiteRoot = path.join(runDir, 'runtime', safeName);
  const homeDir = path.join(suiteRoot, 'home');
  const tempDir = path.join(suiteRoot, 'tmp');
  const projectsDir = path.join(suiteRoot, 'projects');
  const runtimeDir = path.join(suiteRoot, 'runtime');
  const xdgConfigDir = path.join(suiteRoot, 'xdg', 'config');
  const xdgCacheDir = path.join(suiteRoot, 'xdg', 'cache');
  const xdgDataDir = path.join(suiteRoot, 'xdg', 'data');
  const xdgStateDir = path.join(suiteRoot, 'xdg', 'state');
  const logPath = path.join(logsDir, `${safeName}.log`);
  const gitConfigPath = path.join(suiteRoot, 'gitconfig');

  for (const directory of [
    suiteRoot,
    homeDir,
    tempDir,
    projectsDir,
    runtimeDir,
    xdgConfigDir,
    xdgCacheDir,
    xdgDataDir,
    xdgStateDir,
  ]) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
  }
  await writeFile(gitConfigPath, '', { encoding: 'utf8', mode: 0o600, flag: 'wx' });

  const log = createWriteStream(logPath, { flags: 'wx', mode: 0o600 });
  const [registeredCommand, ...args] = suite.command;
  const command = registeredCommand === 'node' ? process.execPath : registeredCommand;
  let timedOut = false;
  let spawnError = null;
  const remainingMs = Math.max(1, deadlineAt - startMs);
  const suiteTimeoutMs = Math.min(opts.timeoutMs, suite.timeoutMs, remainingMs);
  const environment = makeSuiteEnvironment({
    suite,
    homeDir,
    tempDir,
    projectsDir,
    runtimeDir,
    xdgConfigDir,
    xdgCacheDir,
    xdgDataDir,
    xdgStateDir,
    gitConfigPath,
  });

  log.write(`$ ${suite.command.join(' ')}\n`);
  log.write(`started_at=${startedAt}\n`);
  log.write(`source_revision=${sourceRevision}\n\n`);
  log.write(`suite_timeout_ms=${suiteTimeoutMs}\n\n`);

  return await new Promise(resolve => {
    const detached = process.platform !== 'win32';
    const child = spawn(command, args, {
      cwd: opts.root,
      env: environment.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached,
    });
    let killTimer = null;

    const signalChildTree = (signal) => {
      if (!child.pid) return;
      try {
        if (detached) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch (err) {
        if (err.code !== 'ESRCH') log.write(`\nkill_error_${signal}=${err.message}\n`);
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      log.write(`\ntimeout_after_ms=${suiteTimeoutMs}\n`);
      signalChildTree('SIGTERM');
      killTimer = setTimeout(() => {
        signalChildTree('SIGKILL');
      }, 2000).unref();
    }, suiteTimeoutMs);
    timer.unref();

    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    const stdoutDone = finished(child.stdout).catch(() => {});
    const stderrDone = finished(child.stderr).catch(() => {});
    child.on('error', error => {
      spawnError = error;
      log.write(`\nspawn_error=${error.message}\n`);
    });
    child.on('close', async (code, signal) => {
      if (timedOut) signalChildTree('SIGKILL');
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      await Promise.all([stdoutDone, stderrDone]);
      const cleanup = await cleanupOwnedProcessGroup(child.pid, detached, log);
      const sourceTree = opts.allowDirty
        ? { checked: false, clean: null, porcelain: null }
        : await inspectGitWorktree(opts.root);
      const endMs = Date.now();
      const endedAt = new Date(endMs).toISOString();
      let status = timedOut ? 'TIMEOUT' : code === 0 && !spawnError ? 'PASS' : 'FAIL';
      const cleanupEvidenceComplete = (
        cleanup.checked === true
        && cleanup.terminated === true
      );
      const sourceEvidenceComplete = (
        opts.allowDirty
        || (sourceTree.checked === true && sourceTree.clean === true)
      );
      if (
        cleanup.leakDetected
        || !cleanupEvidenceComplete
        || !sourceEvidenceComplete
      ) {
        status = 'FAIL';
      }
      const result = {
        id: suite.id,
        path: suite.path,
        profile: suite.profile,
        category: suite.category,
        command: suite.command,
        blockers: suite.blockers,
        required: suite.required,
        start: startedAt,
        end: endedAt,
        durationMs: endMs - startMs,
        exitCode: code,
        signal,
        status,
        retryCount: 0,
        logPath: normalizePath(path.relative(opts.root, logPath)),
        sourceRevision,
        environment: environment.evidence,
        cleanup,
        sourceTree,
      };
      log.write(
        `\nended_at=${endedAt}\nexit_code=${code}\nsignal=${signal || ''}` +
        `\nstatus=${status}\ncleanup=${JSON.stringify(cleanup)}` +
        `\nsource_tree_clean=${sourceTree.clean}\n`,
      );
      log.end();
      await finished(log).catch(() => {});
      result.logSha256 = await hashFile(logPath);
      resolve(result);
    });
  });
}

function isHardBlocker(blocker) {
  return (
    blocker === 'server'
    || blocker === 'external-network'
    || blocker.startsWith('state-')
  );
}

function makeSuiteEnvironment({
  suite,
  homeDir,
  tempDir,
  projectsDir,
  runtimeDir,
  xdgConfigDir,
  xdgCacheDir,
  xdgDataDir,
  xdgStateDir,
  gitConfigPath,
}) {
  const inheritedKeys = [
    'PATH',
    'LANG',
    'LC_ALL',
    'TZ',
    'SYSTEMROOT',
    'WINDIR',
    'PATHEXT',
    'COMSPEC',
  ];
  const env = {};
  for (const key of inheritedKeys) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }

  Object.assign(env, {
    HOME: homeDir,
    XDG_CONFIG_HOME: xdgConfigDir,
    XDG_CACHE_HOME: xdgCacheDir,
    XDG_DATA_HOME: xdgDataDir,
    XDG_STATE_HOME: xdgStateDir,
    TMPDIR: tempDir,
    TMP: tempDir,
    TEMP: tempDir,
    NODE_ENV: 'test',
    NODE_NO_WARNINGS: '1',
    CI: '1',
    NO_COLOR: '1',
    GIT_CONFIG_GLOBAL: gitConfigPath,
    GIT_CONFIG_NOSYSTEM: '1',
    C3_AUDIT_RUN: '1',
    C3_DB_PATH: path.join(runtimeDir, 'intentsmith-test.sqlite'),
    C3_PROJECTS_DIR: projectsDir,
    C3_PORT: '0',
    C3_PORT_FILE: path.join(runtimeDir, 'intentsmith.port'),
    C3_LIFECYCLE_AUTO_COMMIT: 'false',
    C3_ENABLE_AUTONOMY: 'false',
    C3_LOG_LEVEL: 'warn',
  });

  if (suite.requirements.server) env.C3_URL = 'http://127.0.0.1:3335';
  if (suite.requirements.ollama) env.OLLAMA_URL = 'http://127.0.0.1:11434';

  return {
    env,
    evidence: {
      inheritedKeys: inheritedKeys.filter(key => process.env[key] !== undefined),
      home: homeDir,
      temp: tempDir,
      database: env.C3_DB_PATH,
      projects: projectsDir,
      portFile: env.C3_PORT_FILE,
      xdg: {
        config: xdgConfigDir,
        cache: xdgCacheDir,
        data: xdgDataDir,
        state: xdgStateDir,
      },
    },
  };
}

async function cleanupOwnedProcessGroup(pid, detached, log) {
  if (!detached || !pid) {
    return {
      checked: false,
      leakDetected: false,
      terminated: null,
      reason: 'process groups unsupported',
    };
  }

  const leakDetected = processGroupAlive(pid);
  if (!leakDetected) {
    return { checked: true, leakDetected: false, terminated: true };
  }

  log.write('\nowned_process_group_leak=true\n');
  signalProcessGroup(pid, 'SIGTERM', log);
  let terminated = await waitForProcessGroupExit(pid, 500);
  if (!terminated) {
    signalProcessGroup(pid, 'SIGKILL', log);
    terminated = await waitForProcessGroupExit(pid, 500);
  }
  return { checked: true, leakDetected: true, terminated };
}

function signalProcessGroup(pid, signal, log) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') log.write(`process_group_${signal}_error=${error.message}\n`);
  }
}

function processGroupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    return true;
  }
}

async function waitForProcessGroupExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processGroupAlive(pid)) return true;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return !processGroupAlive(pid);
}

async function inspectGitWorktree(root) {
  return await new Promise(resolve => {
    const child = spawn('git', ['status', '--porcelain', '--untracked-files=all'], {
      cwd: root,
      env: pickCommandEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => resolve({
      checked: false,
      clean: null,
      porcelain: null,
      error: error.message,
    }));
    child.on('close', code => {
      if (code !== 0) {
        resolve({
          checked: false,
          clean: null,
          porcelain: null,
          error: stderr.trim() || `git status exited ${code}`,
        });
        return;
      }
      resolve({
        checked: true,
        clean: stdout.trim().length === 0,
        porcelain: stdout.trim() || null,
      });
    });
  });
}

function pickCommandEnvironment() {
  const env = {};
  for (const key of ['PATH', 'LANG', 'LC_ALL', 'SYSTEMROOT', 'WINDIR', 'PATHEXT', 'COMSPEC']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

async function hashFile(filePath) {
  const hash = createHash('sha256');
  const input = createReadStream(filePath);
  input.on('data', chunk => hash.update(chunk));
  await finished(input);
  return hash.digest('hex');
}

function makeBlockedResult(suite, sourceRevision, blockers) {
  const now = new Date().toISOString();
  return {
    id: suite.id,
    path: suite.path,
    profile: suite.profile,
    category: suite.category,
    command: suite.command,
    blockers: suite.blockers,
    required: suite.required,
    start: now,
    end: now,
    durationMs: 0,
    exitCode: null,
    signal: null,
    status: 'BLOCKED',
    blockedBy: blockers,
    retryCount: 0,
    logPath: null,
    sourceRevision,
  };
}

function makeSkippedResult(suite, sourceRevision, reason) {
  const now = new Date().toISOString();
  return {
    id: suite.id,
    path: suite.path,
    profile: suite.profile,
    category: suite.category,
    command: suite.command,
    blockers: suite.blockers,
    required: suite.required,
    start: now,
    end: now,
    durationMs: 0,
    exitCode: null,
    signal: null,
    status: 'SKIPPED',
    skipReason: reason,
    retryCount: 0,
    logPath: null,
    sourceRevision,
  };
}

function makeReport({
  runId,
  sourceRevision,
  startedAt,
  endedAt,
  opts,
  inventory,
  results,
  dryRun,
  counts,
  blockerCounts,
  runDir,
  inventoryFingerprint,
  optionsFingerprint,
  registryHash,
}) {
  const statusCounts = {};
  for (const status of ['PASS', 'FAIL', 'TIMEOUT', 'BLOCKED', 'SKIPPED']) statusCounts[status] = 0;
  for (const result of results) statusCounts[result.status] = (statusCounts[result.status] || 0) + 1;
  const requiredProblems = results.filter(result => result.required !== false && result.status !== 'PASS');
  const requiredBlocked = requiredProblems.filter(result => result.status === 'BLOCKED');
  const requiredFailures = requiredProblems.filter(result => result.status !== 'BLOCKED');
  const verdict = dryRun
    ? 'DRY_RUN'
    : requiredFailures.length > 0 ? 'FAIL'
      : requiredBlocked.length > 0 ? 'BLOCKED'
        : 'PASS';
  const exitCode = verdict === 'PASS' || verdict === 'DRY_RUN'
    ? 0
    : verdict === 'BLOCKED' ? 2 : 1;
  return {
    runId,
    sourceRevision,
    startedAt,
    endedAt,
    dryRun,
    options: {
      concurrency: opts.concurrency,
      failFast: opts.failFast,
      timeoutMs: opts.timeoutMs,
      deadlineMs: opts.deadlineMs,
      profiles: [...opts.profiles],
      ids: [...opts.ids],
      exclude: [...opts.exclude],
      allowBlockers: [...opts.allowBlockers],
      noBlock: opts.noBlock,
    },
    paths: {
      runDir: normalizePath(path.relative(opts.root, runDir)),
      report: normalizePath(path.relative(opts.root, path.join(runDir, 'report.json'))),
      checkpoint: normalizePath(path.relative(opts.root, path.join(runDir, 'checkpoint.json'))),
      inventory: normalizePath(path.relative(opts.root, path.join(runDir, 'inventory.json'))),
    },
    inventoryFingerprint,
    optionsFingerprint,
    registryHash,
    inventory: {
      total: inventory.length,
      counts,
      blockerCounts,
    },
    statusCounts,
    verdict,
    exitCode,
    requiredFailureCount: requiredProblems.length,
    requiredBlockedCount: requiredBlocked.length,
    results,
  };
}

async function readAndValidateResume({
  checkpointPath,
  inventoryPath,
  sourceRevision,
  inventoryFingerprint,
  optionsFingerprint,
  registryHash,
  expectedSuites,
  root,
  allowDirty,
}) {
  const inventory = await readRequiredJSON(inventoryPath, 'resume inventory');
  if (inventory.sourceRevision !== sourceRevision) {
    throw new Error(`Cannot resume: source revision mismatch (${inventory.sourceRevision} !== ${sourceRevision})`);
  }
  if (inventory.inventoryFingerprint !== inventoryFingerprint) {
    throw new Error('Cannot resume: inventory fingerprint mismatch');
  }
  if (inventory.optionsFingerprint !== optionsFingerprint) {
    throw new Error('Cannot resume: audit option fingerprint mismatch');
  }
  if (inventory.registryHash !== registryHash) {
    throw new Error('Cannot resume: test registry fingerprint mismatch');
  }

  try {
    const parsed = JSON.parse(await readFile(checkpointPath, 'utf8'));
    if (parsed.sourceRevision !== sourceRevision) {
      throw new Error(`Cannot resume: checkpoint source revision mismatch (${parsed.sourceRevision} !== ${sourceRevision})`);
    }
    if (parsed.inventoryFingerprint !== inventoryFingerprint) {
      throw new Error('Cannot resume: checkpoint inventory fingerprint mismatch');
    }
    if (parsed.optionsFingerprint !== optionsFingerprint) {
      throw new Error('Cannot resume: checkpoint option fingerprint mismatch');
    }
    if (parsed.registryHash !== registryHash) {
      throw new Error('Cannot resume: checkpoint test registry fingerprint mismatch');
    }
    if (!Array.isArray(parsed.results)) {
      throw new Error('Cannot resume: checkpoint results must be an array');
    }
    return await validateCompletedResults({
      results: parsed.results,
      expectedSuites,
      sourceRevision,
      root,
      logsDir: path.join(path.dirname(checkpointPath), 'logs'),
      allowDirty,
    });
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return [];
  }
}

async function validateCompletedResults({
  results,
  expectedSuites,
  sourceRevision,
  root,
  logsDir,
  allowDirty,
}) {
  const resumableStatuses = new Set(['PASS', 'FAIL', 'TIMEOUT']);
  const expectedById = new Map(expectedSuites.map(suite => [suite.id, suite]));
  const completed = [];
  const seenIds = new Set();

  for (const result of results) {
    if (!resumableStatuses.has(result.status)) continue;
    const expected = expectedById.get(result.id);
    if (!expected) {
      throw new Error(`Cannot resume: checkpoint contains unknown suite id ${result.id || '(missing)'}`);
    }
    if (seenIds.has(result.id)) {
      throw new Error(`Cannot resume: checkpoint contains duplicate suite id ${result.id}`);
    }
    seenIds.add(result.id);
    if (
      result.path !== expected.path
      || JSON.stringify(result.command) !== JSON.stringify(expected.command)
    ) {
      throw new Error(`Cannot resume: checkpoint suite metadata mismatch for ${result.id}`);
    }
    if (result.sourceRevision !== sourceRevision) {
      throw new Error(`Cannot resume: checkpoint result source revision mismatch for ${result.id}`);
    }
    if (!result.logPath || !/^[a-f0-9]{64}$/.test(result.logSha256 || '')) {
      throw new Error(`Cannot resume: checkpoint result lacks log evidence for ${result.id}`);
    }

    const absoluteLogPath = path.resolve(root, result.logPath);
    const relativeToLogs = path.relative(logsDir, absoluteLogPath);
    if (
      relativeToLogs === ''
      || relativeToLogs.startsWith(`..${path.sep}`)
      || path.isAbsolute(relativeToLogs)
    ) {
      throw new Error(`Cannot resume: checkpoint log path escapes the run for ${result.id}`);
    }
    const actualLogHash = await hashFile(absoluteLogPath).catch(error => {
      throw new Error(`Cannot resume: missing log evidence for ${result.id}: ${error.message}`);
    });
    if (actualLogHash !== result.logSha256) {
      throw new Error(`Cannot resume: log evidence hash mismatch for ${result.id}`);
    }
    if (
      !result.cleanup
      || result.cleanup.checked !== true
      || result.cleanup.terminated !== true
    ) {
      throw new Error(`Cannot resume: incomplete process cleanup evidence for ${result.id}`);
    }
    if (!allowDirty && result.sourceTree?.clean !== true) {
      throw new Error(`Cannot resume: incomplete clean-tree evidence for ${result.id}`);
    }
    if (result.status === 'PASS' && (result.exitCode !== 0 || result.signal !== null)) {
      throw new Error(`Cannot resume: invalid PASS exit evidence for ${result.id}`);
    }
    if (result.status === 'PASS' && result.cleanup.leakDetected !== false) {
      throw new Error(`Cannot resume: PASS contains process-leak evidence for ${result.id}`);
    }
    if (result.cleanup.leakDetected === true && result.status !== 'FAIL') {
      throw new Error(`Cannot resume: process leak is not classified as FAIL for ${result.id}`);
    }

    completed.push(result);
  }
  return completed;
}

async function readRequiredJSON(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`Cannot resume: missing or invalid ${label} at ${filePath}: ${err.message}`);
  }
}

function resultKey(item) {
  return item.id;
}

function countByCategory(suites) {
  const counts = Object.fromEntries(PROFILE_ORDER.map(profile => [profile, 0]));
  for (const suite of suites) counts[suite.category] = (counts[suite.category] || 0) + 1;
  return counts;
}

function countBlockers(suites) {
  const counts = {};
  for (const suite of suites) {
    for (const blocker of suite.blockers) counts[blocker] = (counts[blocker] || 0) + 1;
  }
  return counts;
}

function fingerprintInventory(suites) {
  return stableHash(suites.map(suite => ({
    id: suite.id,
    path: suite.path,
    profile: suite.profile,
    tier: suite.tier,
    command: suite.command,
    blockers: suite.blockers,
    required: suite.required,
    state: suite.state,
    requirements: suite.requirements,
    timeoutMs: suite.timeoutMs,
    expectedDurationMs: suite.expectedDurationMs,
  })));
}

function makeOptionsSnapshot(opts) {
  return {
    concurrency: opts.concurrency,
    failFast: opts.failFast,
    timeoutMs: opts.timeoutMs,
    deadlineMs: opts.deadlineMs,
    profiles: [...opts.profiles].sort(),
    ids: [...opts.ids].sort(),
    exclude: [...opts.exclude].sort(),
    allowBlockers: [...opts.allowBlockers].sort(),
    noBlock: opts.noBlock,
    allowDirty: opts.allowDirty,
  };
}

function stableHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function getSourceRevision(root) {
  return await new Promise(resolve => {
    const child = spawn('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      env: pickCommandEnvironment(),
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.on('close', code => resolve(code === 0 ? out.trim() : 'unknown'));
    child.on('error', () => resolve('unknown'));
  });
}

async function assertCleanGitWorktree(root) {
  const status = await new Promise((resolve, reject) => {
    const child = spawn('git', ['status', '--porcelain', '--untracked-files=all'], {
      cwd: root,
      env: pickCommandEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('close', code => {
      if (code === 0) resolve(out);
      else reject(new Error(`Cannot verify clean git worktree: ${err.trim() || `git status exited ${code}`}`));
    });
    child.on('error', error => reject(new Error(`Cannot verify clean git worktree: ${error.message}`)));
  });

  if (status.trim()) {
    throw new Error('Non-dry-run audit requires a clean git worktree. Commit, stash, or use --allow-dirty for disposable fixtures only.');
  }
}

function assertSafeRunId(runId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(runId)) {
    throw new Error(`Invalid run-id "${runId}". Use a filename-only id containing letters, numbers, dot, underscore, or dash.`);
  }
}

function makeRunId() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function safeLogName(relPath) {
  const hash = createHash('sha1').update(relPath).digest('hex').slice(0, 8);
  return `${relPath.replace(/[^a-zA-Z0-9_.-]+/g, '_')}.${hash}`;
}

function normalizePath(p) {
  return p.split(path.sep).join('/');
}

async function writeJSON(filePath, value) {
  await writeJSONAtomic(filePath, value);
}

async function writeJSONAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(tmpPath, filePath);
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function printInventorySummary(report) {
  console.log(`audit dry-run ${report.runId}`);
  console.log(`inventory: ${report.inventory.total}`);
  for (const profile of PROFILE_ORDER) {
    console.log(`  ${profile}: ${report.inventory.counts[profile] || 0}`);
  }
  console.log(`blockers: ${JSON.stringify(report.inventory.blockerCounts)}`);
  console.log(`report: ${report.paths.report}`);
}

function printSuiteProgress(done, total, result) {
  const code = result.exitCode === null ? '-' : result.exitCode;
  console.log(`[${done}/${total}] ${result.status} ${result.path} (${result.durationMs}ms, exit ${code})`);
}

function printFinalSummary(report) {
  console.log(`audit run ${report.runId}`);
  console.log(`verdict: ${report.verdict}`);
  console.log(`status: ${JSON.stringify(report.statusCounts)}`);
  console.log(`required failures: ${report.requiredFailureCount}`);
  console.log(`report: ${report.paths.report}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await runAudit(parseArgs());
    process.exitCode = report.exitCode;
  } catch (err) {
    console.error(`audit runner failed: ${err.stack || err.message}`);
    process.exitCode = 2;
  }
}
