#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { constants as fsConstants, createWriteStream } from 'node:fs';
import {
  access,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const ORCHESTRATOR_ID = 'c3-nightly-orchestrator';
const DEFAULT_BRANCH = 'master';
const DEFAULT_REMOTE = 'origin';
const DEFAULT_RETAIN = 7;
const DEFAULT_DEADLINE_MS = 8 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const AUDIT_RUN_ID = 'product-audit';

const PREFLIGHT_COMMANDS = [
  ['node', 'tests/harness-exit-code.test.js'],
  ['node', 'tests/nightly-audit-runner-self-test.js'],
  ['node', 'tests/audit-summary-self-test.js'],
];

export function parseArgs(argv = process.argv.slice(2)) {
  const opts = {
    repo: process.cwd(),
    remote: DEFAULT_REMOTE,
    branch: DEFAULT_BRANCH,
    artifactRoot: null,
    worktreeRoot: null,
    runId: null,
    retain: DEFAULT_RETAIN,
    dryRun: false,
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
    else if (arg.startsWith('--repo')) opts.repo = value();
    else if (arg.startsWith('--remote')) opts.remote = value();
    else if (arg.startsWith('--branch')) opts.branch = value();
    else if (arg.startsWith('--artifact-root')) opts.artifactRoot = value();
    else if (arg.startsWith('--worktree-root')) opts.worktreeRoot = value();
    else if (arg.startsWith('--run-id')) opts.runId = value();
    else if (arg.startsWith('--retain')) opts.retain = Math.max(1, Number(value()) || DEFAULT_RETAIN);
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return normalizeOptions(opts);
}

function printHelp() {
  console.log(`Usage: node scripts/nightly-orchestrator.js [options]

Options:
  --repo=PATH            Primary repository, default current directory
  --remote=NAME          Git remote, default origin
  --branch=NAME          Remote branch, default master
  --artifact-root=PATH   Durable artifact root, default ../c3-nightly-artifacts
  --worktree-root=PATH   Disposable worktree root, default ../c3-nightly-worktrees
  --run-id=ID            Filename-safe run id
  --retain=N             Retain latest N completed runs, default 7
  --dry-run              Print plan only; no fetch, worktree, install, or audit
`);
}

function normalizeOptions(opts) {
  const repo = path.resolve(opts.repo);
  return {
    ...opts,
    repo,
    artifactRoot: path.resolve(opts.artifactRoot || path.join(repo, '..', 'c3-nightly-artifacts')),
    worktreeRoot: path.resolve(opts.worktreeRoot || path.join(repo, '..', 'c3-nightly-worktrees')),
    runId: opts.runId || makeRunId(),
  };
}

export async function runNightly(rawOptions = {}) {
  const opts = normalizeOptions({ ...parseArgs([]), ...rawOptions });
  assertSafeRunId(opts.runId);

  const remoteRef = `refs/remotes/${opts.remote}/${opts.branch}`;
  const sha = opts.dryRun
    ? await resolveCommit(opts.repo, remoteRef)
    : await fetchAndResolveCommit(opts.repo, opts.remote, opts.branch, remoteRef);
  const paths = makePaths(opts, sha);
  const commands = makeCommandPlan(paths, opts);

  if (opts.dryRun) {
    return {
      dryRun: true,
      orchestrator: ORCHESTRATOR_ID,
      runId: opts.runId,
      sourceRevision: sha,
      repo: opts.repo,
      paths,
      commands,
      environment: makeAuditEnv(paths),
      blockerPolicy: {
        noBlock: false,
        allowDirty: false,
        allowBlockers: [],
      },
      note: 'dry-run does not fetch, create/delete worktrees, install packages, or run tests',
    };
  }

  await mkdir(opts.artifactRoot, { recursive: true });
  await mkdir(opts.worktreeRoot, { recursive: true });

  const lock = await acquireLock(paths.lockDir, { runId: opts.runId, repo: opts.repo, sourceRevision: sha });
  const startedAt = new Date().toISOString();
  let runnerExitCode = null;
  let summaryExitCode = null;
  let preflight = null;

  try {
    await ensureNoExistingPath(paths.runDir, 'artifact run directory');
    await mkdir(paths.runDir, { recursive: true });
    await writeJSON(paths.ownership, {
      owner: ORCHESTRATOR_ID,
      runId: opts.runId,
      sourceRevision: sha,
      createdAt: startedAt,
    });
    await writeJSON(paths.metadata, makeMetadata({ opts, paths, sha, status: 'starting', startedAt }));

    await ensureNoExistingWorktree(paths.worktree);
    await runLogged(['git', 'worktree', 'add', '--detach', paths.worktree, sha], {
      cwd: opts.repo,
      logPath: paths.launchLog,
    });
    await writeJSON(path.join(paths.worktree, '.c3-nightly-owned.json'), {
      owner: ORCHESTRATOR_ID,
      runId: opts.runId,
      sourceRevision: sha,
      createdAt: new Date().toISOString(),
    });

    await runLogged(['npm', 'ci', '--legacy-peer-deps'], {
      cwd: paths.worktree,
      logPath: paths.installLog,
    });
    await writeJSON(paths.metadata, makeMetadata({
      opts,
      paths,
      sha,
      status: 'preflight',
      startedAt,
      dependencyInstall: {
        command: 'npm ci --legacy-peer-deps',
        temporaryDebt: 'tree-sitter-java peer dependency conflict requires legacy peer resolution for now',
      },
    }));

    preflight = await runPreflight(paths);
    await writeJSON(paths.preflight, preflight);
    if (!preflight.ok) {
      await writeJSON(paths.metadata, makeMetadata({ opts, paths, sha, status: 'preflight_failed', startedAt, preflight }));
      await cleanupOwnedWorktree(opts.repo, paths.worktree, opts.runId);
      await retainCompletedRuns(opts.artifactRoot, opts.retain);
      return { ok: false, exitCode: 2, preflight, paths, sourceRevision: sha };
    }

    await mkdir(paths.runtimeDir, { recursive: true });
    const audit = await runLogged(commands.audit, {
      cwd: paths.worktree,
      logPath: paths.auditLog,
      env: makeAuditEnv(paths),
      allowFailure: true,
    });
    runnerExitCode = audit.exitCode;

    const summary = await runLogged(commands.summary, {
      cwd: paths.worktree,
      logPath: paths.summaryLog,
      allowFailure: true,
    });
    summaryExitCode = summary.exitCode;

    await writeJSON(paths.metadata, makeMetadata({
      opts,
      paths,
      sha,
      status: runnerExitCode === 0 && summaryExitCode === 0 ? 'completed' : 'completed_with_failures',
      startedAt,
      runnerExitCode,
      summaryExitCode,
      preflight,
      dependencyInstall: {
        command: 'npm ci --legacy-peer-deps',
        temporaryDebt: 'tree-sitter-java peer dependency conflict requires legacy peer resolution for now',
      },
    }));

    await cleanupOwnedWorktree(opts.repo, paths.worktree, opts.runId);
    await retainCompletedRuns(opts.artifactRoot, opts.retain);

    const exitCode = summaryExitCode !== 0 ? summaryExitCode : runnerExitCode;
    return { ok: exitCode === 0, exitCode, runnerExitCode, summaryExitCode, preflight, paths, sourceRevision: sha };
  } catch (err) {
    await writeJSON(paths.metadata, makeMetadata({
      opts,
      paths,
      sha,
      status: 'failed',
      startedAt,
      runnerExitCode,
      summaryExitCode,
      preflight,
      error: err.stack || err.message,
    })).catch(() => {});
    await cleanupOwnedWorktree(opts.repo, paths.worktree, opts.runId).catch(() => {});
    throw err;
  } finally {
    await lock.release();
  }
}

async function fetchAndResolveCommit(repo, remote, branch, remoteRef) {
  await runLogged(['git', 'fetch', remote, branch], { cwd: repo, logPath: null });
  return await resolveCommit(repo, remoteRef);
}

async function resolveCommit(repo, ref) {
  const result = await runLogged(['git', 'rev-parse', `${ref}^{commit}`], { cwd: repo, capture: true });
  return result.stdout.trim();
}

function makePaths(opts, sha) {
  const runDir = path.join(opts.artifactRoot, 'runs', opts.runId);
  return {
    runDir,
    artifactRoot: opts.artifactRoot,
    lockDir: path.join(opts.artifactRoot, 'c3-nightly.lock'),
    worktreeRoot: opts.worktreeRoot,
    worktree: path.join(opts.worktreeRoot, `${opts.runId}-${sha.slice(0, 12)}`),
    metadata: path.join(runDir, 'metadata.json'),
    ownership: path.join(runDir, 'ownership.json'),
    preflight: path.join(runDir, 'preflight.json'),
    launchLog: path.join(runDir, 'worktree.log'),
    installLog: path.join(runDir, 'npm-ci.log'),
    auditLog: path.join(runDir, 'audit-runner.log'),
    summaryLog: path.join(runDir, 'audit-summary.log'),
    summaryJson: path.join(runDir, 'summary.json'),
    auditOutDir: path.join(runDir, 'audit'),
    auditRunDir: path.join(runDir, 'audit', AUDIT_RUN_ID),
    runtimeDir: path.join(runDir, 'runtime'),
  };
}

function makeCommandPlan(paths, opts) {
  return {
    fetch: ['git', 'fetch', opts.remote, opts.branch],
    worktree: ['git', 'worktree', 'add', '--detach', paths.worktree, '<source-sha>'],
    install: ['npm', 'ci', '--legacy-peer-deps'],
    preflight: PREFLIGHT_COMMANDS,
    audit: [
      'node',
      'scripts/nightly-audit.js',
      '--run-id', AUDIT_RUN_ID,
      '--out-dir', paths.auditOutDir,
      '--concurrency', '1',
      '--deadline-ms', String(DEFAULT_DEADLINE_MS),
      '--timeout-ms', String(DEFAULT_TIMEOUT_MS),
    ],
    summary: [
      'node',
      'scripts/audit-summary.js',
      paths.auditRunDir,
      '--json',
      '--out', paths.summaryJson,
    ],
  };
}

function makeAuditEnv(paths) {
  return {
    ...process.env,
    C3_DB_PATH: path.join(paths.runtimeDir, 'c3-nightly.db'),
    C3_PROJECTS_DIR: path.join(paths.runtimeDir, 'projects'),
    C3_PORT_FILE: path.join(paths.runtimeDir, 'c3.port'),
    C3_LIFECYCLE_AUTO_COMMIT: 'false',
    C3_ENABLE_AUTONOMY: 'false',
    C3_LOG_LEVEL: 'warn',
  };
}

async function runPreflight(paths) {
  const results = [];
  for (const command of PREFLIGHT_COMMANDS) {
    const logPath = path.join(paths.runDir, `preflight-${safeName(command[1])}.log`);
    const result = await runLogged(command, {
      cwd: paths.worktree,
      logPath,
      allowFailure: true,
    });
    results.push({
      command,
      status: result.exitCode === 0 ? 'PASS' : 'FAIL',
      exitCode: result.exitCode,
      signal: result.signal,
      logPath,
    });
    if (result.exitCode !== 0) break;
  }
  return {
    ok: results.every(result => result.status === 'PASS'),
    results,
    endedAt: new Date().toISOString(),
  };
}

async function runLogged(command, options = {}) {
  const {
    cwd,
    env = process.env,
    logPath = null,
    capture = false,
    allowFailure = false,
  } = options;
  if (logPath) await mkdir(path.dirname(logPath), { recursive: true });
  const log = logPath ? createWriteStream(logPath, { flags: 'a' }) : null;
  let stdout = '';
  let stderr = '';
  const startedAt = new Date().toISOString();
  if (log) log.write(`$ ${command.join(' ')}\nstarted_at=${startedAt}\n\n`);

  const result = await new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', chunk => {
      if (capture) stdout += chunk;
      if (log) log.write(chunk);
    });
    child.stderr.on('data', chunk => {
      if (capture) stderr += chunk;
      if (log) log.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (exitCode, signal) => {
      const endedAt = new Date().toISOString();
      if (log) {
        log.write(`\nended_at=${endedAt}\nexit_code=${exitCode}\nsignal=${signal || ''}\n`);
        log.end(() => resolve({ command, exitCode, signal, stdout, stderr }));
      } else {
        resolve({ command, exitCode, signal, stdout, stderr });
      }
    });
  });

  if (!allowFailure && result.exitCode !== 0) {
    throw new Error(`Command failed (${result.exitCode}): ${command.join(' ')}\n${result.stderr || result.stdout}`);
  }
  return result;
}

async function acquireLock(lockDir, payload) {
  try {
    await mkdir(lockDir, { recursive: false });
  } catch (err) {
    if (err.code === 'EEXIST') {
      const owner = await readFile(path.join(lockDir, 'owner.json'), 'utf8').catch(() => '');
      throw new Error(`Nightly audit lock is already held at ${lockDir}${owner ? `: ${owner}` : ''}`);
    }
    throw err;
  }
  await writeJSON(path.join(lockDir, 'owner.json'), {
    ...payload,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });
  return {
    release: async () => {
      await rm(lockDir, { recursive: true, force: true });
    },
  };
}

async function ensureNoExistingWorktree(worktree) {
  await ensureNoExistingPath(worktree, 'worktree path');
}

async function ensureNoExistingPath(targetPath, label) {
  try {
    await access(targetPath, fsConstants.F_OK);
  } catch {
    return;
  }
  throw new Error(`Refusing to reuse existing ${label}: ${targetPath}`);
}

async function cleanupOwnedWorktree(repo, worktree, runId) {
  const markerPath = path.join(worktree, '.c3-nightly-owned.json');
  const marker = JSON.parse(await readFile(markerPath, 'utf8'));
  if (marker.owner !== ORCHESTRATOR_ID || marker.runId !== runId) {
    throw new Error(`Refusing to remove unrecognized worktree: ${worktree}`);
  }
  await runLogged(['git', 'worktree', 'remove', '--force', worktree], {
    cwd: repo,
    logPath: null,
    allowFailure: false,
  });
}

async function retainCompletedRuns(artifactRoot, retain) {
  const runsRoot = path.join(artifactRoot, 'runs');
  let entries = [];
  try {
    entries = await readdir(runsRoot, { withFileTypes: true });
  } catch {
    return;
  }

  const owned = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(runsRoot, entry.name);
    const metadata = await readJSON(path.join(dir, 'metadata.json')).catch(() => null);
    if (metadata?.orchestrator !== ORCHESTRATOR_ID || !metadata.endedAt) continue;
    owned.push({ dir, endedAt: metadata.endedAt });
  }

  owned.sort((a, b) => String(b.endedAt).localeCompare(String(a.endedAt)));
  for (const item of owned.slice(retain)) {
    await rm(item.dir, { recursive: true, force: true });
  }
}

function makeMetadata({ opts, paths, sha, status, startedAt, runnerExitCode = null, summaryExitCode = null, preflight = null, error = null, dependencyInstall = null }) {
  return {
    orchestrator: ORCHESTRATOR_ID,
    runId: opts.runId,
    sourceRemote: opts.remote,
    sourceBranch: opts.branch,
    sourceRevision: sha,
    status,
    startedAt,
    endedAt: ['completed', 'completed_with_failures', 'preflight_failed', 'failed'].includes(status) ? new Date().toISOString() : null,
    runnerExitCode,
    summaryExitCode,
    preflight,
    dependencyInstall,
    paths: {
      runDir: paths.runDir,
      worktree: paths.worktree,
      auditRunDir: paths.auditRunDir,
      summaryJson: paths.summaryJson,
    },
    candidateMode: false,
    blockerPolicy: {
      noBlock: false,
      allowDirty: false,
      allowBlockers: [],
    },
    error,
  };
}

async function readJSON(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJSON(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function makeRunId() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `nightly-${stamp}`;
}

function assertSafeRunId(runId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(runId)) {
    throw new Error(`Invalid run-id "${runId}". Use a filename-only id containing letters, numbers, dot, underscore, or dash.`);
  }
}

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9_.-]+/g, '_');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runNightly(parseArgs());
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.dryRun && result.exitCode !== 0) process.exitCode = result.exitCode;
  } catch (err) {
    console.error(`nightly orchestrator failed: ${err.stack || err.message}`);
    process.exitCode = 2;
  }
}
