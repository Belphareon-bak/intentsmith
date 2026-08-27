#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants, createWriteStream } from 'node:fs';
import {
  access,
  chmod,
  lstat,
  mkdir,
  realpath,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const ORCHESTRATOR_ID = 'intentsmith-gate0-orchestrator';
const DEFAULT_BRANCH = 'codex/intentsmith-1.0';
const DEFAULT_REMOTE = 'origin';
const LOCKED_REMOTE_URL = 'git@github-intentsmith:Belphareon-bak/intentsmith.git';
const LOCKED_SSH_ALIAS = 'github-intentsmith';
const LOCKED_SSH_HOSTNAME = 'github.com';
const LOCKED_SSH_OPTIONS = [
  '-o', 'BatchMode=yes',
  '-o', `HostName=${LOCKED_SSH_HOSTNAME}`,
  '-o', 'HostKeyAlias=github.com',
  '-o', 'User=git',
  '-o', 'Port=22',
  '-o', 'CanonicalizeHostname=no',
  '-o', 'PermitLocalCommand=no',
  '-o', 'ProxyCommand=none',
  '-o', 'ProxyJump=none',
];
const DEFAULT_RETAIN = 7;
const DEFAULT_DEADLINE_MS = 8 * 60 * 60 * 1000;
const DEFAULT_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10 * 60 * 1000;
const INSTALL_TIMEOUT_MS = 30 * 60 * 1000;
const AUDIT_PROCESS_TIMEOUT_MS = DEFAULT_DEADLINE_MS + (5 * 60 * 1000);
const SUMMARY_TIMEOUT_MS = 5 * 60 * 1000;
const AUDIT_RUN_ID = 'product-audit';
const AUDIT_PROFILES = ['offline', 'database'];
const AUDIT_ALLOWED_BLOCKERS = ['toolchain:python-pdf-runtime'];
const GATE0_REGISTRY_HASH = '69342befdc0267a8b1e5dae70bd0151aaed9d2a0a86db793453249452cd88695';
const GATE0_PROFILE_COUNTS = { offline: 248, database: 60 };
const PDF_RUNTIME_PACKAGES = Object.freeze({
  'charset-normalizer': '3.4.4',
  pillow: '12.3.0',
  reportlab: '5.0.0',
});
const PDF_RUNTIME_TARGET = 'CPython 3.12 / Linux x86_64 / glibc 2.27+';
const REPORT_STATUSES = ['PASS', 'FAIL', 'TIMEOUT', 'BLOCKED', 'SKIPPED'];
const TERMINATION_GRACE_MS = 10_000;
const ACTIVE_OWNED_CHILDREN = new Map();
let requestedTerminationSignal = null;
const BASE_ENV_KEYS = [
  'PATH',
  'LANG',
  'LC_ALL',
  'TZ',
  'SYSTEMROOT',
  'WINDIR',
  'PATHEXT',
  'COMSPEC',
];

const PREFLIGHT_COMMANDS = [
  ['node', 'scripts/validate-test-registry.js'],
  ['node', 'tests/harness-exit-code.test.js'],
  ['node', 'tests/nightly-audit-runner-self-test.js'],
  ['node', 'tests/audit-summary-self-test.js'],
  ['node', 'tests/nightly-orchestrator-self-test.js'],
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
    const value = (optionName) => {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        const inlineValue = arg.slice(eq + 1);
        if (!inlineValue) throw new Error(`Missing value for ${optionName}`);
        return inlineValue;
      }
      i += 1;
      if (i >= argv.length || argv[i].startsWith('--')) {
        throw new Error(`Missing value for ${optionName}`);
      }
      return argv[i];
    };

    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--repo' || arg.startsWith('--repo=')) opts.repo = value('--repo');
    else if (arg === '--remote' || arg.startsWith('--remote=')) opts.remote = value('--remote');
    else if (arg === '--branch' || arg.startsWith('--branch=')) opts.branch = value('--branch');
    else if (arg === '--artifact-root' || arg.startsWith('--artifact-root=')) {
      opts.artifactRoot = value('--artifact-root');
    } else if (arg === '--worktree-root' || arg.startsWith('--worktree-root=')) {
      opts.worktreeRoot = value('--worktree-root');
    } else if (arg === '--run-id' || arg.startsWith('--run-id=')) opts.runId = value('--run-id');
    else if (arg === '--retain' || arg.startsWith('--retain=')) {
      opts.retain = Math.max(1, Number(value('--retain')) || DEFAULT_RETAIN);
    }
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return opts;
}

function printHelp() {
  console.log(`Usage: node scripts/nightly-orchestrator.js [options]

Options:
  --repo=PATH            Primary repository, default current directory
  --remote=NAME          Git remote, default origin
  --branch=NAME          Locked remote branch, default codex/intentsmith-1.0
  --artifact-root=PATH   Locked to .intentsmith-artifacts/nightly
  --worktree-root=PATH   Locked to .intentsmith-artifacts/nightly/worktrees
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
    artifactRoot: path.resolve(opts.artifactRoot || path.join(repo, '.intentsmith-artifacts', 'nightly')),
    worktreeRoot: path.resolve(
      opts.worktreeRoot || path.join(repo, '.intentsmith-artifacts', 'nightly', 'worktrees'),
    ),
    runId: opts.runId || makeRunId(),
  };
}

export async function runNightly(rawOptions = {}) {
  const opts = normalizeOptions({ ...parseArgs([]), ...rawOptions });
  assertSafeRunId(opts.runId);
  assertLockedPaths(opts);
  await assertSafeArtifactBoundary(opts, { requireExisting: false });
  opts.sourceLockEvidence = await assertLockedSource(opts);

  const remoteRef = `refs/remotes/${opts.remote}/${opts.branch}`;
  const sha = opts.dryRun
    ? await resolveCommit(opts.repo, remoteRef)
    : await fetchAndResolveCommit(opts.repo, opts.remote, opts.branch, remoteRef);
  const paths = makePaths(opts, sha);
  const commands = makeCommandPlan(paths, opts);

  if (opts.dryRun) {
    return {
      dryRun: true,
      testMode: opts.testMode === true,
      orchestrator: ORCHESTRATOR_ID,
      runId: opts.runId,
      sourceRevision: sha,
      sourceLock: opts.sourceLockEvidence,
      repo: opts.repo,
      paths,
      commands,
      environment: makeAuditEnvironmentEvidence(paths),
      blockerPolicy: {
        noBlock: false,
        allowDirty: false,
        allowBlockers: [...AUDIT_ALLOWED_BLOCKERS],
      },
      note: 'dry-run does not fetch, create/delete worktrees, install packages, or run tests',
    };
  }

  await assertSafeArtifactBoundary(opts, { requireExisting: false });
  await ensurePrivateBoundary(opts);
  await assertSafeArtifactBoundary(opts, { requireExisting: true });

  const lock = await acquireLock(paths.lockDir, { runId: opts.runId, repo: opts.repo, sourceRevision: sha });
  const startedAt = new Date().toISOString();
  let runnerExitCode = null;
  let summaryExitCode = null;
  let preflight = null;
  let auditContract = null;
  let summaryContract = null;
  let runEvidenceOwnedByThisInvocation = false;
  let worktreeMarkerCreatedByThisInvocation = false;
  const dependencyInstall = {
    command: 'npm ci',
    lockfileOnly: true,
    node: {
      command: commands.install,
      lockPath: 'package-lock.json',
      status: 'PENDING',
    },
    pdfRuntime: {
      command: commands.pdfRuntime,
      lockPath: 'requirements/pdf-export.lock',
      policy: {
        requireHashes: true,
        onlyBinary: true,
        noDependencies: true,
        isolatedPip: true,
        freshStagingVenv: true,
      },
      status: 'PENDING',
    },
  };
  try {
    await ensureNoExistingPath(paths.runDir, 'artifact run directory');
    await ensureNoExistingPath(paths.worktreeOwnership, 'worktree ownership marker');
    await ensurePrivateDirectory(paths.runDir);
    await writeJSON(paths.ownership, {
      owner: ORCHESTRATOR_ID,
      runId: opts.runId,
      sourceRevision: sha,
      createdAt: startedAt,
    });
    runEvidenceOwnedByThisInvocation = true;
    await writeJSON(paths.metadata, makeMetadata({ opts, paths, sha, status: 'starting', startedAt }));

    await ensureNoExistingWorktree(paths.worktree);
    await writeJSON(paths.worktreeOwnership, {
      owner: ORCHESTRATOR_ID,
      runId: opts.runId,
      sourceRevision: sha,
      worktree: paths.worktree,
      state: 'planned',
      createdAt: new Date().toISOString(),
    });
    worktreeMarkerCreatedByThisInvocation = true;
    await runLogged(['git', 'worktree', 'add', '--detach', paths.worktree, sha], {
      cwd: opts.repo,
      logPath: paths.launchLog,
    });
    await writeJSON(paths.worktreeOwnership, {
      owner: ORCHESTRATOR_ID,
      runId: opts.runId,
      sourceRevision: sha,
      worktree: paths.worktree,
      state: 'created',
      createdAt: new Date().toISOString(),
    });

    await prepareRuntime(paths);
    const auditEnvironment = makeAuditEnv(paths);
    await runLogged(commands.install, {
      cwd: paths.worktree,
      logPath: paths.installLog,
      env: auditEnvironment,
      timeoutMs: INSTALL_TIMEOUT_MS,
    });
    dependencyInstall.node = await collectNodeInstallEvidence(paths, commands.install);
    await runLogged(commands.pdfRuntime, {
      cwd: paths.worktree,
      logPath: paths.pdfInstallLog,
      env: auditEnvironment,
      capture: true,
      timeoutMs: INSTALL_TIMEOUT_MS,
    });
    dependencyInstall.pdfRuntime = await collectPdfRuntimeEvidence(
      paths,
      commands.pdfRuntime,
    );
    await assertExactCleanWorktree(paths.worktree, sha);
    await writeJSON(paths.metadata, makeMetadata({
      opts,
      paths,
      sha,
      status: 'preflight',
      startedAt,
      dependencyInstall,
    }));

    preflight = await runPreflight(paths, auditEnvironment, sha);
    await writeJSON(paths.preflight, preflight);
    if (!preflight.ok) {
      await writeJSON(paths.metadata, makeMetadata({
        opts,
        paths,
        sha,
        status: 'preflight_failed_cleanup_pending',
        startedAt,
        preflight,
        dependencyInstall,
      }));
      await cleanupOwnedWorktree(opts.repo, paths, opts.runId, sha);
      worktreeMarkerCreatedByThisInvocation = false;
      await retainCompletedRuns(opts.artifactRoot, opts.retain, paths.runDir);
      await assertCurrentRunRetained(paths);
      throwIfTerminationRequested();
      await writeJSON(paths.metadata, makeMetadata({
        opts,
        paths,
        sha,
        status: 'preflight_failed',
        startedAt,
        preflight,
        dependencyInstall,
        cleanupEvidence: makeCompletedCleanupEvidence(),
      }));
      throwIfTerminationRequested();
      return { ok: false, exitCode: 2, preflight, paths, sourceRevision: sha };
    }

    await assertExactCleanWorktree(paths.worktree, sha);
    const audit = await runLogged(commands.audit, {
      cwd: paths.worktree,
      logPath: paths.auditLog,
      env: auditEnvironment,
      allowFailure: true,
      timeoutMs: AUDIT_PROCESS_TIMEOUT_MS,
    });
    runnerExitCode = audit.exitCode;
    await assertExactCleanWorktree(paths.worktree, sha);
    auditContract = await validateAuditContract({
      paths,
      sourceRevision: sha,
      runnerExitCode,
    });
    await writeJSON(paths.auditContract, auditContract);

    const summary = await runLogged(commands.summary, {
      cwd: paths.worktree,
      logPath: paths.summaryLog,
      env: auditEnvironment,
      allowFailure: true,
      timeoutMs: SUMMARY_TIMEOUT_MS,
    });
    summaryExitCode = summary.exitCode;
    if (summaryExitCode !== 0) {
      throw new Error(`Audit summary failed with exit code ${summaryExitCode}`);
    }
    await assertExactCleanWorktree(paths.worktree, sha);
    summaryContract = await validateSummaryContract(paths, auditContract);
    await writeJSON(paths.summaryContract, summaryContract);

    const completionStatus = runnerExitCode === 0 && summaryExitCode === 0
      ? 'completed'
      : 'completed_with_failures';
    await writeJSON(paths.metadata, makeMetadata({
      opts,
      paths,
      sha,
      status: 'validated_cleanup_pending',
      startedAt,
      runnerExitCode,
      summaryExitCode,
      preflight,
      dependencyInstall,
      auditContract,
      summaryContract,
    }));

    if (
      opts.testMode === true
      && opts.testFailurePoint === 'after-validation-before-cleanup'
    ) {
      throw new Error('Injected test failure after validation before cleanup');
    }
    await cleanupOwnedWorktree(opts.repo, paths, opts.runId, sha);
    worktreeMarkerCreatedByThisInvocation = false;
    await retainCompletedRuns(opts.artifactRoot, opts.retain, paths.runDir);
    await assertCurrentRunRetained(paths);
    throwIfTerminationRequested();
    await writeJSON(paths.metadata, makeMetadata({
      opts,
      paths,
      sha,
      status: completionStatus,
      startedAt,
      runnerExitCode,
      summaryExitCode,
      preflight,
      dependencyInstall,
      auditContract,
      summaryContract,
      cleanupEvidence: makeCompletedCleanupEvidence(),
    }));
    await assertCurrentRunRetained(paths);
    throwIfTerminationRequested();

    return {
      ok: runnerExitCode === 0,
      exitCode: runnerExitCode,
      runnerExitCode,
      summaryExitCode,
      preflight,
      auditContract,
      summaryContract,
      paths,
      sourceRevision: sha,
    };
  } catch (err) {
    if (runEvidenceOwnedByThisInvocation) {
      await writeJSON(paths.metadata, makeMetadata({
        opts,
        paths,
        sha,
        status: 'failed',
        startedAt,
        runnerExitCode,
        summaryExitCode,
        preflight,
        auditContract,
        summaryContract,
        dependencyInstall,
        error: err.stack || err.message,
      })).catch(() => {});
    }
    if (worktreeMarkerCreatedByThisInvocation) {
      await cleanupOwnedWorktree(opts.repo, paths, opts.runId, sha).catch(() => {});
    }
    throw err;
  } finally {
    await lock.release();
  }
}

function makeCompletedCleanupEvidence() {
  return {
    worktreeRemoved: true,
    worktreeOwnershipMarkerRemoved: true,
    lockReleasePending: true,
    currentRunRetained: true,
  };
}

async function fetchAndResolveCommit(repo, remote, branch, remoteRef) {
  await assertSafeFetchConfiguration(repo, remote);
  const branchRef = `refs/heads/${branch}:refs/remotes/${remote}/${branch}`;
  await runLogged(makeFetchCommand(remote, branchRef), {
    cwd: repo,
    env: makeFetchEnv(),
    logPath: null,
    timeoutMs: FETCH_TIMEOUT_MS,
  });
  return await resolveCommit(repo, remoteRef);
}

function makeFetchCommand(remote, branchRef) {
  const lockedSshCommand = ['ssh', ...LOCKED_SSH_OPTIONS].join(' ');
  return [
    'git',
    '-c', `core.sshCommand=${lockedSshCommand}`,
    '-c', 'ssh.variant=ssh',
    'fetch',
    '--no-tags',
    '--upload-pack=git-upload-pack',
    remote,
    branchRef,
  ];
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
    lockDir: path.join(opts.artifactRoot, 'intentsmith-nightly.lock'),
    worktreeRoot: opts.worktreeRoot,
    worktree: path.join(opts.worktreeRoot, `${opts.runId}-${sha.slice(0, 12)}`),
    worktreeOwnership: path.join(opts.worktreeRoot, `${opts.runId}-${sha.slice(0, 12)}.ownership.json`),
    metadata: path.join(runDir, 'metadata.json'),
    ownership: path.join(runDir, 'ownership.json'),
    preflight: path.join(runDir, 'preflight.json'),
    auditContract: path.join(runDir, 'audit-contract.json'),
    summaryContract: path.join(runDir, 'summary-contract.json'),
    launchLog: path.join(runDir, 'worktree.log'),
    installLog: path.join(runDir, 'npm-ci.log'),
    pdfInstallLog: path.join(runDir, 'pdf-runtime-install.log'),
    auditLog: path.join(runDir, 'audit-runner.log'),
    summaryLog: path.join(runDir, 'audit-summary.log'),
    summaryJson: path.join(runDir, 'summary.json'),
    auditOutDir: path.join(runDir, 'audit'),
    auditRunDir: path.join(runDir, 'audit', AUDIT_RUN_ID),
    runtimeDir: path.join(runDir, 'runtime'),
    homeDir: path.join(runDir, 'runtime', 'home'),
    tempDir: path.join(runDir, 'runtime', 'tmp'),
    projectsDir: path.join(runDir, 'runtime', 'projects'),
    xdgConfigDir: path.join(runDir, 'runtime', 'xdg', 'config'),
    xdgCacheDir: path.join(runDir, 'runtime', 'xdg', 'cache'),
    xdgDataDir: path.join(runDir, 'runtime', 'xdg', 'data'),
    xdgStateDir: path.join(runDir, 'runtime', 'xdg', 'state'),
    gitConfigPath: path.join(runDir, 'runtime', 'gitconfig'),
    pdfVenv: path.join(
      opts.worktreeRoot,
      `${opts.runId}-${sha.slice(0, 12)}`,
      '.venv',
      'pdf',
    ),
    pdfPython: path.join(
      opts.worktreeRoot,
      `${opts.runId}-${sha.slice(0, 12)}`,
      '.venv',
      'pdf',
      'bin',
      'python',
    ),
  };
}

function makeCommandPlan(paths, opts) {
  const branchRef = `refs/heads/${opts.branch}:refs/remotes/${opts.remote}/${opts.branch}`;
  return {
    fetch: makeFetchCommand(opts.remote, branchRef),
    worktree: ['git', 'worktree', 'add', '--detach', paths.worktree, '<source-sha>'],
    install: ['npm', 'ci'],
    pdfRuntime: [
      './scripts/install-pdf-runtime.sh',
      '--venv',
      paths.pdfVenv,
    ],
    preflight: PREFLIGHT_COMMANDS,
    audit: [
      'node',
      'scripts/nightly-audit.js',
      '--run-id', AUDIT_RUN_ID,
      '--out-dir', paths.auditOutDir,
      '--concurrency', '1',
      '--profile', AUDIT_PROFILES.join(','),
      '--allow-blocker', AUDIT_ALLOWED_BLOCKERS.join(','),
      '--deadline-ms', String(DEFAULT_DEADLINE_MS),
      '--timeout-ms', String(DEFAULT_DEADLINE_MS),
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
    ...makeBaseEnv(),
    HOME: paths.homeDir,
    XDG_CONFIG_HOME: paths.xdgConfigDir,
    XDG_CACHE_HOME: paths.xdgCacheDir,
    XDG_DATA_HOME: paths.xdgDataDir,
    XDG_STATE_HOME: paths.xdgStateDir,
    TMPDIR: paths.tempDir,
    TMP: paths.tempDir,
    TEMP: paths.tempDir,
    GIT_CONFIG_GLOBAL: paths.gitConfigPath,
    GIT_CONFIG_NOSYSTEM: '1',
    NODE_ENV: 'test',
    CI: '1',
    NO_COLOR: '1',
    C3_DB_PATH: path.join(paths.runtimeDir, 'intentsmith-nightly.sqlite'),
    C3_PROJECTS_DIR: paths.projectsDir,
    C3_PORT_FILE: path.join(paths.runtimeDir, 'intentsmith.port'),
    C3_LIFECYCLE_AUTO_COMMIT: 'false',
    C3_ENABLE_AUTONOMY: 'false',
    C3_LOG_LEVEL: 'warn',
    INTENTSMITH_PDF_PYTHON: paths.pdfPython,
    C3_PDF_PYTHON: paths.pdfPython,
    PYTHONNOUSERSITE: '1',
  };
}

function makeAuditEnvironmentEvidence(paths) {
  return {
    inheritedKeys: BASE_ENV_KEYS.filter(key => process.env[key] !== undefined),
    isolated: {
      home: paths.homeDir,
      temp: paths.tempDir,
      xdgConfig: paths.xdgConfigDir,
      xdgCache: paths.xdgCacheDir,
      xdgData: paths.xdgDataDir,
      xdgState: paths.xdgStateDir,
      gitConfig: paths.gitConfigPath,
      database: path.join(paths.runtimeDir, 'intentsmith-nightly.sqlite'),
      projects: paths.projectsDir,
      portFile: path.join(paths.runtimeDir, 'intentsmith.port'),
      pdfPython: paths.pdfPython,
      pythonNoUserSite: true,
    },
    secretValuesRecorded: false,
  };
}

function makeBaseEnv() {
  const env = {};
  for (const key of BASE_ENV_KEYS) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

function makeFetchEnv() {
  const env = makeBaseEnv();
  for (const key of ['HOME', 'XDG_CONFIG_HOME', 'SSH_AUTH_SOCK', 'USER', 'LOGNAME']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_TERMINAL_PROMPT = '0';
  env.GIT_SSH_VARIANT = 'ssh';
  return env;
}

async function prepareRuntime(paths) {
  for (const directory of [
    paths.runtimeDir,
    paths.homeDir,
    paths.tempDir,
    paths.projectsDir,
    paths.xdgConfigDir,
    paths.xdgCacheDir,
    paths.xdgDataDir,
    paths.xdgStateDir,
  ]) {
    await ensurePrivateDirectory(directory);
  }
  await writeFile(paths.gitConfigPath, '', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
}

async function collectNodeInstallEvidence(paths, command) {
  const lockPath = path.join(paths.worktree, 'package-lock.json');
  await assertRegularContainedFile(lockPath, paths.worktree, 'Node dependency lock');
  await assertRegularContainedFile(paths.installLog, paths.runDir, 'Node dependency install log');
  return {
    command,
    lockPath: 'package-lock.json',
    lockSha256: await hashFile(lockPath),
    logPath: paths.installLog,
    logSha256: await hashFile(paths.installLog),
    status: 'PASS',
  };
}

async function collectPdfRuntimeEvidence(paths, command) {
  const lockPath = path.join(paths.worktree, 'requirements', 'pdf-export.lock');
  const markerPath = path.join(paths.pdfVenv, '.intentsmith-pdf-runtime');
  await assertRegularContainedFile(lockPath, paths.worktree, 'PDF dependency lock');
  await assertRegularContainedFile(markerPath, paths.pdfVenv, 'PDF runtime marker');
  await assertRegularContainedFile(
    paths.pdfInstallLog,
    paths.runDir,
    'PDF runtime install log',
  );
  await access(paths.pdfPython, fsConstants.X_OK);

  const marker = parsePdfRuntimeMarker(await readFile(markerPath, 'utf8'));
  const lockSha256 = await hashFile(lockPath);
  requireContract(marker.format === '1', 'PDF runtime marker format mismatch');
  requireContract(marker.status === 'ready', 'PDF runtime marker is not ready');
  requireContract(marker.lock_sha256 === lockSha256, 'PDF runtime lock hash mismatch');
  requireContract(marker.target === PDF_RUNTIME_TARGET, 'PDF runtime target mismatch');

  let versions;
  try {
    versions = JSON.parse(marker.versions);
  } catch (error) {
    throw new Error(`Invalid PDF runtime version evidence: ${error.message}`);
  }
  requireContract(
    isDeepStrictEqual(versions.packages, PDF_RUNTIME_PACKAGES),
    'PDF runtime package versions differ from policy',
  );
  requireContract(
    typeof versions.python === 'string' && /^3\.12\.\d+$/.test(versions.python),
    'PDF runtime Python version differs from policy',
  );

  return {
    command,
    lockPath: 'requirements/pdf-export.lock',
    lockSha256,
    target: marker.target,
    python: versions.python,
    packages: versions.packages,
    interpreter: paths.pdfPython,
    policy: {
      requireHashes: true,
      onlyBinary: true,
      noDependencies: true,
      isolatedPip: true,
      freshStagingVenv: true,
    },
    logPath: paths.pdfInstallLog,
    logSha256: await hashFile(paths.pdfInstallLog),
    status: 'PASS',
  };
}

function parsePdfRuntimeMarker(contents) {
  const marker = {};
  for (const line of contents.split(/\r?\n/)) {
    if (!line) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) {
      throw new Error(`Invalid PDF runtime marker line: ${line}`);
    }
    const key = line.slice(0, separator);
    if (Object.hasOwn(marker, key)) {
      throw new Error(`Duplicate PDF runtime marker key: ${key}`);
    }
    marker[key] = line.slice(separator + 1);
  }
  return marker;
}

async function runPreflight(paths, env, sourceRevision) {
  const results = [];
  for (const command of PREFLIGHT_COMMANDS) {
    throwIfTerminationRequested();
    await assertExactCleanWorktree(paths.worktree, sourceRevision);
    const logPath = path.join(paths.runDir, `preflight-${safeName(command[1])}.log`);
    const result = await runLogged(command, {
      cwd: paths.worktree,
      logPath,
      env,
      allowFailure: true,
      timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
    });
    await assertExactCleanWorktree(paths.worktree, sourceRevision);
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

export async function runLogged(command, options = {}) {
  const {
    cwd,
    env = makeBaseEnv(),
    logPath = null,
    capture = false,
    allowFailure = false,
    timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
    ignoreInterruption = false,
    logStreamFactory = createWriteStream,
  } = options;
  if (!ignoreInterruption) throwIfTerminationRequested();
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Invalid command timeout: ${timeoutMs}`);
  }
  if (logPath) await ensurePrivateDirectory(path.dirname(logPath));
  const log = logPath ? logStreamFactory(logPath, { flags: 'a', mode: 0o600 }) : null;
  let stdout = '';
  let stderr = '';
  let logError = null;
  let activeChild = null;
  let logTerminationTimer = null;
  if (log) {
    log.on('error', error => {
      if (!logError) logError = error;
      if (activeChild) {
        const activeEntry = ACTIVE_OWNED_CHILDREN.get(activeChild);
        signalOwnedProcess(activeChild, activeEntry?.detached === true, 'SIGTERM');
        if (!logTerminationTimer) {
          logTerminationTimer = setTimeout(() => {
            signalOwnedProcess(activeChild, activeEntry?.detached === true, 'SIGKILL');
          }, 2_000);
          logTerminationTimer.unref();
        }
      }
    });
    try {
      await waitForWritableOpen(log);
    } catch (error) {
      if (!log.destroyed) log.destroy();
      throw new Error(`Command log could not open at ${logPath}: ${error.message}`);
    }
  }
  const startedAt = new Date().toISOString();
  writeLog(log, logError, `$ ${command.join(' ')}\nstarted_at=${startedAt}\n\n`);

  const result = await new Promise(resolve => {
    const detached = process.platform !== 'win32';
    const child = spawnWithPrivateUmask(command[0], command.slice(1), {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached,
    });
    activeChild = child;
    ACTIVE_OWNED_CHILDREN.set(child, { detached, terminationTimer: null });
    let timedOut = false;
    let spawnError = null;
    let killTimer = null;

    child.stdout.on('data', chunk => {
      if (capture) stdout += chunk;
      writeLog(log, logError, chunk);
    });
    child.stderr.on('data', chunk => {
      if (capture) stderr += chunk;
      writeLog(log, logError, chunk);
    });
    child.on('error', error => {
      spawnError = error;
      writeLog(log, logError, `\nspawn_error=${error.message}\n`);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      writeLog(log, logError, `\ntimeout_after_ms=${timeoutMs}\n`);
      signalOwnedProcess(child, detached, 'SIGTERM');
      killTimer = setTimeout(() => {
        signalOwnedProcess(child, detached, 'SIGKILL');
      }, 2000);
      killTimer.unref();
    }, timeoutMs);
    timer.unref();

    child.on('close', async (exitCode, signal) => {
      activeChild = null;
      const activeEntry = ACTIVE_OWNED_CHILDREN.get(child);
      if (activeEntry?.terminationTimer) clearTimeout(activeEntry.terminationTimer);
      ACTIVE_OWNED_CHILDREN.delete(child);
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (logTerminationTimer) clearTimeout(logTerminationTimer);
      let leakDetected = false;
      let cleanupTerminated = true;
      if (detached && child.pid && processGroupAlive(child.pid)) {
        leakDetected = true;
        signalOwnedProcess(child, detached, 'SIGTERM');
        cleanupTerminated = await waitForProcessGroupExit(child.pid, 500);
        if (!cleanupTerminated) {
          signalOwnedProcess(child, detached, 'SIGKILL');
          cleanupTerminated = await waitForProcessGroupExit(child.pid, 500);
        }
      }
      const endedAt = new Date().toISOString();
      if (log && !logError) {
        try {
          await endWritable(
            log,
          `\nended_at=${endedAt}\nexit_code=${exitCode}\nsignal=${signal || ''}` +
          `\ntimed_out=${timedOut}\nowned_process_leak=${leakDetected}` +
          `\ncleanup_terminated=${cleanupTerminated}\n`,
          );
        } catch (error) {
          if (!logError) logError = error;
        }
      } else if (log && !log.destroyed) {
        log.destroy();
      }
      resolve({
        command,
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut,
        leakDetected,
        cleanupTerminated,
        spawnError,
        logError,
      });
    });
  });

  if (result.spawnError) {
    throw new Error(`Command could not start: ${command.join(' ')}\n${result.spawnError.message}`);
  }
  if (result.logError) {
    throw new Error(
      `Command log failed at ${logPath}: ${result.logError.code || 'EIO'} ${result.logError.message}`,
    );
  }
  if (result.timedOut) {
    throw new Error(`Command timed out after ${timeoutMs}ms: ${command.join(' ')}`);
  }
  if (result.leakDetected || !result.cleanupTerminated) {
    throw new Error(`Command left an owned process group behind: ${command.join(' ')}`);
  }
  if (!ignoreInterruption) throwIfTerminationRequested();
  if (!Number.isInteger(result.exitCode)) {
    throw new Error(`Command terminated by signal ${result.signal || 'unknown'}: ${command.join(' ')}`);
  }
  if (!allowFailure && result.exitCode !== 0) {
    throw new Error(`Command failed (${result.exitCode}): ${command.join(' ')}\n${result.stderr || result.stdout}`);
  }
  return result;
}

async function waitForWritableOpen(stream) {
  if (!('pending' in stream) || stream.pending === false) return;
  await new Promise((resolve, reject) => {
    const onOpen = () => {
      stream.off('error', onError);
      resolve();
    };
    const onError = error => {
      stream.off('open', onOpen);
      reject(error);
    };
    stream.once('open', onOpen);
    stream.once('error', onError);
  });
}

async function endWritable(stream, finalChunk) {
  await new Promise((resolve, reject) => {
    const onFinish = () => {
      stream.off('error', onError);
      resolve();
    };
    const onError = error => {
      stream.off('finish', onFinish);
      reject(error);
    };
    stream.once('finish', onFinish);
    stream.once('error', onError);
    stream.end(finalChunk);
  });
}

function writeLog(stream, currentError, chunk) {
  if (!stream || currentError || stream.errored || stream.destroyed) return;
  stream.write(chunk);
}

function installTerminationHandlers() {
  const handlers = new Map();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => requestTermination(signal);
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  return () => {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  };
}

export async function runNightlyWithTerminationHandling(options) {
  return runWithOwnedProcessTerminationHandling(() => runNightly(options));
}

export async function runWithOwnedProcessTerminationHandling(operation) {
  if (ACTIVE_OWNED_CHILDREN.size !== 0) {
    throw new Error('Cannot start termination handling while owned commands are active');
  }
  if (typeof operation !== 'function') {
    throw new Error('Termination-protected operation must be a function');
  }
  requestedTerminationSignal = null;
  const removeTerminationHandlers = installTerminationHandlers();
  try {
    const result = await operation();
    throwIfTerminationRequested();
    return result;
  } finally {
    removeTerminationHandlers();
    requestedTerminationSignal = null;
  }
}

function requestTermination(signal) {
  if (!requestedTerminationSignal) requestedTerminationSignal = signal;
  for (const [child, entry] of ACTIVE_OWNED_CHILDREN) {
    signalOwnedProcess(child, entry.detached, 'SIGTERM');
    if (!entry.terminationTimer) {
      entry.terminationTimer = setTimeout(() => {
        signalOwnedProcess(child, entry.detached, 'SIGKILL');
      }, TERMINATION_GRACE_MS);
      entry.terminationTimer.unref();
    }
  }
}

function throwIfTerminationRequested() {
  if (requestedTerminationSignal) {
    throw new Error(`Nightly orchestration interrupted by ${requestedTerminationSignal}`);
  }
}

function spawnWithPrivateUmask(command, args, options) {
  const previousUmask = process.umask(0o077);
  try {
    return spawn(command, args, options);
  } finally {
    process.umask(previousUmask);
  }
}

function signalOwnedProcess(child, detached, signal) {
  if (!child.pid) return;
  try {
    if (detached) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    if (error.code !== 'ESRCH') return false;
  }
  return true;
}

function processGroupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
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

async function assertLockedSource(opts) {
  if (opts.remote !== DEFAULT_REMOTE || opts.branch !== DEFAULT_BRANCH) {
    throw new Error(
      `Gate 0 source is locked to ${DEFAULT_REMOTE}/${DEFAULT_BRANCH}; ` +
      `received ${opts.remote}/${opts.branch}`,
    );
  }
  const rawRemoteUrl = await runLogged(
    ['git', 'config', '--get-all', `remote.${opts.remote}.url`],
    { cwd: opts.repo, capture: true },
  );
  const effectiveRemoteUrl = await runLogged(
    ['git', 'remote', 'get-url', '--all', opts.remote],
    { cwd: opts.repo, capture: true, env: makeFetchEnv() },
  );
  const rawRemoteUrls = nonemptyLines(rawRemoteUrl.stdout);
  const effectiveRemoteUrls = nonemptyLines(effectiveRemoteUrl.stdout);
  if (opts.testMode === true) {
    const [realRepo, realTemp] = await Promise.all([realpath(opts.repo), realpath(os.tmpdir())]);
    if (!isPathInside(realTemp, realRepo)) {
      throw new Error('Orchestrator test mode is restricted to the system temporary directory');
    }
    if (
      rawRemoteUrls.length !== 1
      || effectiveRemoteUrls.length !== 1
      || rawRemoteUrls[0] !== effectiveRemoteUrls[0]
    ) {
      throw new Error('Orchestrator test mode forbids Git URL rewrites');
    }
    return {
      mode: 'temporary-fixture',
      remoteUrl: rawRemoteUrls[0],
      effectiveRemoteUrl: effectiveRemoteUrls[0],
    };
  }
  if (
    rawRemoteUrls.length !== 1
    || effectiveRemoteUrls.length !== 1
    || rawRemoteUrls[0] !== LOCKED_REMOTE_URL
    || effectiveRemoteUrls[0] !== LOCKED_REMOTE_URL
  ) {
    throw new Error(
      `Gate 0 remote URL is locked to ${LOCKED_REMOTE_URL}; ` +
      `received raw=${rawRemoteUrls.join(',') || '(missing)'} ` +
      `effective=${effectiveRemoteUrls.join(',') || '(missing)'}`,
    );
  }
  const ssh = await assertLockedSshTransport();
  return {
    mode: 'locked-production-source',
    remoteUrl: LOCKED_REMOTE_URL,
    effectiveRemoteUrl: LOCKED_REMOTE_URL,
    ssh,
  };
}

async function assertLockedSshTransport() {
  const result = await runLogged(
    ['ssh', '-G', ...LOCKED_SSH_OPTIONS, LOCKED_SSH_ALIAS],
    { capture: true, env: makeFetchEnv() },
  );
  const fields = new Map();
  for (const line of nonemptyLines(result.stdout)) {
    const separator = line.indexOf(' ');
    if (separator === -1) continue;
    const key = line.slice(0, separator).toLowerCase();
    if (!fields.has(key)) fields.set(key, line.slice(separator + 1).trim());
  }
  const expected = {
    hostname: LOCKED_SSH_HOSTNAME,
    user: 'git',
    port: '22',
    canonicalizehostname: 'false',
    permitlocalcommand: 'no',
  };
  for (const [key, value] of Object.entries(expected)) {
    if (fields.get(key) !== value) {
      throw new Error(
        `Gate 0 SSH transport mismatch for ${key}: ${fields.get(key) || '(missing)'} !== ${value}`,
      );
    }
  }
  for (const key of ['proxycommand', 'proxyjump', 'localcommand']) {
    const value = fields.get(key);
    if (value && value.toLowerCase() !== 'none') {
      throw new Error(`Gate 0 SSH transport forbids ${key}: ${value}`);
    }
  }
  return {
    alias: LOCKED_SSH_ALIAS,
    hostname: expected.hostname,
    user: expected.user,
    port: Number(expected.port),
    proxyCommand: null,
    proxyJump: null,
    canonicalizeHostname: false,
    permitLocalCommand: false,
  };
}

async function assertSafeFetchConfiguration(repo, remote) {
  const forbiddenPattern = [
    '^core\\.sshcommand$',
    '^ssh\\.variant$',
    `^remote\\.${escapeRegex(remote)}\\.(uploadpack|receivepack)$`,
    '^url\\..*\\.(insteadof|pushinsteadof)$',
    '^include(if\\..*)?\\.path$',
  ].join('|');
  const result = await runLogged(
    ['git', 'config', '--local', '--name-only', '--get-regexp', forbiddenPattern],
    { cwd: repo, capture: true, allowFailure: true },
  );
  if (![0, 1].includes(result.exitCode)) {
    throw new Error(
      `Cannot validate repository-local Git transport configuration (exit ${result.exitCode})`,
    );
  }
  const forbiddenKeys = nonemptyLines(result.stdout);
  if (forbiddenKeys.length > 0) {
    throw new Error(
      `Gate 0 fetch forbids repository-local transport overrides: ${forbiddenKeys.join(', ')}`,
    );
  }
}

function assertLockedPaths(opts) {
  const expectedArtifactRoot = path.resolve(
    opts.repo,
    '.intentsmith-artifacts',
    'nightly',
  );
  const expectedWorktreeRoot = path.join(expectedArtifactRoot, 'worktrees');
  if (
    opts.artifactRoot !== expectedArtifactRoot
    || opts.worktreeRoot !== expectedWorktreeRoot
  ) {
    throw new Error(
      'Gate 0 artifact paths are locked inside ' +
      `${path.join(opts.repo, '.intentsmith-artifacts', 'nightly')}`,
    );
  }
}

async function assertSafeArtifactBoundary(opts, { requireExisting }) {
  const ignoredRoot = path.join(opts.repo, '.intentsmith-artifacts');
  const runsRoot = path.join(opts.artifactRoot, 'runs');
  const candidates = [
    opts.repo,
    ignoredRoot,
    opts.artifactRoot,
    runsRoot,
    opts.worktreeRoot,
  ];
  for (const candidate of candidates) {
    let metadata;
    try {
      metadata = await lstat(candidate);
    } catch (error) {
      if (error.code === 'ENOENT' && !requireExisting && candidate !== opts.repo) continue;
      throw error;
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error(`Unsafe artifact boundary component: ${candidate}`);
    }
  }

  const ignoredCheck = await runLogged(
    ['git', 'check-ignore', '-q', '--no-index', '--', '.intentsmith-artifacts/nightly/probe'],
    { cwd: opts.repo, allowFailure: true },
  );
  if (ignoredCheck.exitCode !== 0) {
    throw new Error('Gate 0 artifact boundary is not protected by .gitignore');
  }

  if (requireExisting) {
    const [
      realRepo,
      realIgnoredRoot,
      realArtifactRoot,
      realRunsRoot,
      realWorktreeRoot,
    ] = await Promise.all([
      realpath(opts.repo),
      realpath(ignoredRoot),
      realpath(opts.artifactRoot),
      realpath(runsRoot),
      realpath(opts.worktreeRoot),
    ]);
    if (
      !isPathInside(realRepo, realIgnoredRoot)
      || !isPathInside(realIgnoredRoot, realArtifactRoot)
      || !isPathInside(realArtifactRoot, realRunsRoot)
      || !isPathInside(realArtifactRoot, realWorktreeRoot)
    ) {
      throw new Error('Gate 0 artifact boundary resolves outside the repository');
    }
  }
}

async function ensurePrivateBoundary(opts) {
  const ignoredRoot = path.join(opts.repo, '.intentsmith-artifacts');
  await ensurePrivateBoundaryDirectory(ignoredRoot, opts.repo);
  await ensurePrivateBoundaryDirectory(opts.artifactRoot, ignoredRoot);
  await ensurePrivateBoundaryDirectory(path.join(opts.artifactRoot, 'runs'), opts.artifactRoot);
  await ensurePrivateBoundaryDirectory(opts.worktreeRoot, opts.artifactRoot);
}

async function ensurePrivateBoundaryDirectory(directory, parent) {
  const parentMetadata = await lstat(parent);
  if (parentMetadata.isSymbolicLink() || !parentMetadata.isDirectory()) {
    throw new Error(`Unsafe artifact boundary component: ${parent}`);
  }
  try {
    await mkdir(directory, { recursive: false, mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const metadata = await lstat(directory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`Unsafe artifact boundary component: ${directory}`);
  }
  const [realParent, realDirectory] = await Promise.all([realpath(parent), realpath(directory)]);
  if (!isPathInside(realParent, realDirectory)) {
    throw new Error(`Unsafe artifact boundary resolution: ${directory}`);
  }
  await chmod(directory, 0o700);
}

async function assertExactCleanWorktree(worktree, sourceRevision) {
  const status = await runLogged(
    ['git', 'status', '--porcelain=v1', '--untracked-files=all'],
    { cwd: worktree, capture: true },
  );
  if (status.stdout !== '') {
    throw new Error(`Disposable source worktree is dirty: ${JSON.stringify(status.stdout)}`);
  }
  const head = await runLogged(
    ['git', 'rev-parse', 'HEAD'],
    { cwd: worktree, capture: true },
  );
  if (head.stdout.trim() !== sourceRevision) {
    throw new Error(
      `Disposable source revision changed (${head.stdout.trim()} !== ${sourceRevision})`,
    );
  }
}

async function validateAuditContract({ paths, sourceRevision, runnerExitCode }) {
  const registry = await readJSON(path.join(paths.worktree, 'tests', 'registry.json'));
  requireContract(Array.isArray(registry.suites), 'registry suites are missing');
  const expectedSuites = registry.suites.filter(suite => AUDIT_PROFILES.includes(suite.profile));
  requireContract(expectedSuites.length > 0, 'deterministic registry selection is empty');
  requireContract(
    expectedSuites.every(suite => suite.state === 'ACTIVE' && suite.required === true),
    'deterministic registry contains non-active or optional suites',
  );
  requireContract(
    expectedSuites.every(suite => suite.timeoutMs <= DEFAULT_DEADLINE_MS),
    'deterministic suite timeout exceeds the total Gate 0 deadline',
  );
  const expectedIds = expectedSuites.map(suite => suite.id).sort();
  const expectedById = new Map(expectedSuites.map(suite => [suite.id, suite]));
  const expectedRegistryHash = createHash('sha256')
    .update(JSON.stringify(registry))
    .digest('hex');
  requireContract(
    expectedRegistryHash === GATE0_REGISTRY_HASH,
    'registry hash differs from the reviewed Gate 0 policy',
  );
  const reviewedProfileCounts = countValues(expectedSuites.map(suite => suite.profile));
  requireContract(
    isDeepStrictEqual(reviewedProfileCounts, GATE0_PROFILE_COUNTS),
    'deterministic profile counts differ from the reviewed Gate 0 policy',
  );
  const expectedOptions = {
    concurrency: 1,
    failFast: false,
    timeoutMs: DEFAULT_DEADLINE_MS,
    deadlineMs: DEFAULT_DEADLINE_MS,
    profiles: [...AUDIT_PROFILES].sort(),
    ids: [],
    exclude: [],
    allowBlockers: [...AUDIT_ALLOWED_BLOCKERS],
    noBlock: false,
    allowDirty: false,
  };
  const expectedReportOptions = {
    concurrency: expectedOptions.concurrency,
    failFast: expectedOptions.failFast,
    timeoutMs: expectedOptions.timeoutMs,
    deadlineMs: expectedOptions.deadlineMs,
    profiles: [...AUDIT_PROFILES].sort(),
    ids: [],
    exclude: [],
    allowBlockers: [...AUDIT_ALLOWED_BLOCKERS],
    noBlock: false,
  };
  const expectedOptionsFingerprint = stableHash(expectedOptions);
  const expectedInventorySuites = [...expectedSuites]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(suite => ({
      ...suite,
      category: suite.profile,
      command: suite.argv,
      blockers: registryBlockersFor(suite),
    }));
  const expectedInventoryFingerprint = stableHash(
    expectedInventorySuites.map(suite => ({
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
      })),
  );
  const inventory = await readEvidenceJSON(
    path.join(paths.auditRunDir, 'inventory.json'),
    paths.auditRunDir,
    'inventory',
  );
  const report = await readEvidenceJSON(
    path.join(paths.auditRunDir, 'report.json'),
    paths.auditRunDir,
    'report',
  );

  requireContract(inventory.runId === AUDIT_RUN_ID, 'inventory run id mismatch');
  requireContract(report.runId === AUDIT_RUN_ID, 'report run id mismatch');
  requireContract(inventory.sourceRevision === sourceRevision, 'inventory source revision mismatch');
  requireContract(report.sourceRevision === sourceRevision, 'report source revision mismatch');
  requireContract(
    path.resolve(report.paths?.sourceRoot || '') === path.resolve(paths.worktree),
    'report source root mismatch',
  );
  requireContract(inventory.registryHash === expectedRegistryHash, 'inventory registry hash mismatch');
  requireContract(report.registryHash === expectedRegistryHash, 'report registry hash mismatch');
  requireContract(
    inventory.inventoryFingerprint === expectedInventoryFingerprint,
    'inventory fingerprint does not match the registry selection',
  );
  requireContract(
    inventory.optionsFingerprint === expectedOptionsFingerprint,
    'options fingerprint does not match the locked options',
  );
  requireContract(
    report.inventoryFingerprint === inventory.inventoryFingerprint,
    'inventory fingerprint mismatch between inventory and report',
  );
  requireContract(
    report.optionsFingerprint === inventory.optionsFingerprint,
    'options fingerprint mismatch between inventory and report',
  );
  requireContract(inventory.options?.allowDirty === false, 'dirty source override is forbidden');
  requireContract(inventory.options?.noBlock === false, 'no-block override is forbidden');
  requireContract(report.options?.noBlock === false, 'report no-block override is forbidden');
  requireContract(
    isDeepStrictEqual(inventory.options?.allowBlockers, AUDIT_ALLOWED_BLOCKERS),
    'inventory toolchain authority differs from the locked policy',
  );
  for (const [label, options] of [
    ['inventory', inventory.options],
    ['report', report.options],
  ]) {
    requireContract(Array.isArray(options?.ids) && options.ids.length === 0, `${label} suite filter is forbidden`);
    requireContract(
      Array.isArray(options?.exclude) && options.exclude.length === 0,
      `${label} profile exclusion is forbidden`,
    );
  }
  requireContract(
    sameStringMembers(inventory.options?.profiles, AUDIT_PROFILES)
      && sameStringMembers(report.options?.profiles, AUDIT_PROFILES),
    'audit profiles are not exactly offline,database',
  );
  requireContract(
    isDeepStrictEqual(report.options?.allowBlockers, AUDIT_ALLOWED_BLOCKERS),
    'audit toolchain authority differs from the locked policy',
  );
  requireContract(
    isDeepStrictEqual(inventory.options, expectedOptions),
    'inventory options do not match the locked Gate 0 options',
  );
  requireContract(
    isDeepStrictEqual(report.options, expectedReportOptions),
    'report options do not match the locked Gate 0 options',
  );

  const inventoryIds = Array.isArray(inventory.suites)
    ? inventory.suites.map(suite => suite.id)
    : [];
  requireContract(
    isDeepStrictEqual(inventory.suites, expectedInventorySuites),
    'inventory suite payload does not match the reviewed registry',
  );
  const resultIds = Array.isArray(report.results)
    ? report.results.map(result => result.id)
    : [];
  requireContract(sameStringMembers(inventoryIds, expectedIds), 'inventory suite identity mismatch');
  requireContract(sameStringMembers(resultIds, expectedIds), 'report suite identity mismatch');
  requireContract(new Set(inventoryIds).size === expectedIds.length, 'duplicate inventory suite id');
  requireContract(new Set(resultIds).size === expectedIds.length, 'duplicate report suite id');
  requireContract(report.inventory?.total === expectedIds.length, 'report inventory total mismatch');

  const expectedProfileCounts = countValues(expectedSuites.map(suite => suite.profile));
  for (const profile of AUDIT_PROFILES) {
    requireContract(
      report.inventory?.counts?.[profile] === (expectedProfileCounts[profile] || 0),
      `report profile count mismatch for ${profile}`,
    );
  }

  const observedStatusCounts = Object.fromEntries(REPORT_STATUSES.map(status => [status, 0]));
  for (const result of report.results || []) {
    const expected = expectedById.get(result.id);
    requireContract(expected !== undefined, `unknown report suite id ${result.id}`);
    requireContract(result.path === expected.path, `suite path mismatch for ${result.id}`);
    requireContract(result.profile === expected.profile, `suite profile mismatch for ${result.id}`);
    requireContract(result.required === expected.required, `suite required flag mismatch for ${result.id}`);
    requireContract(
      JSON.stringify(result.command) === JSON.stringify(expected.argv),
      `suite command mismatch for ${result.id}`,
    );
    requireContract(result.sourceRevision === sourceRevision, `suite source revision mismatch for ${result.id}`);
    requireContract(REPORT_STATUSES.includes(result.status), `invalid status for ${result.id}`);
    if (result.status === 'PASS') {
      requireContract(result.exitCode === 0, `PASS has nonzero exit code for ${result.id}`);
      requireContract(result.signal === null, `PASS has signal evidence for ${result.id}`);
      requireContract(result.cleanup?.leakDetected === false, `PASS contains a process leak for ${result.id}`);
    }
    observedStatusCounts[result.status] += 1;

    if (!['BLOCKED', 'SKIPPED'].includes(result.status)) {
      requireContract(result.cleanup?.checked === true, `cleanup evidence missing for ${result.id}`);
      requireContract(result.cleanup?.terminated === true, `cleanup incomplete for ${result.id}`);
      requireContract(result.sourceTree?.checked === true, `source-tree evidence missing for ${result.id}`);
      requireContract(result.sourceTree?.clean === true, `source tree dirty for ${result.id}`);
      requireContract(
        result.sourceTree?.head === sourceRevision,
        `source-tree revision mismatch for ${result.id}`,
      );
      if (result.status === 'TIMEOUT') {
        requireContract(result.timedOut === true, `TIMEOUT lacks timeout evidence for ${result.id}`);
      }
      if (result.status === 'PASS') {
        requireContract(result.timedOut === false, `PASS contains timeout evidence for ${result.id}`);
      }
      requireContract(typeof result.logPath === 'string' && result.logPath, `log path missing for ${result.id}`);
      requireContract(/^[a-f0-9]{64}$/.test(result.logSha256 || ''), `log hash missing for ${result.id}`);
      const logPath = path.resolve(paths.worktree, result.logPath);
      requireContract(
        isPathInside(path.join(paths.auditRunDir, 'logs'), logPath),
        `log path escapes audit run for ${result.id}`,
      );
      await assertRegularContainedFile(
        logPath,
        path.join(paths.auditRunDir, 'logs'),
        `log for ${result.id}`,
      );
      requireContract(
        await hashFile(logPath) === result.logSha256,
        `log hash mismatch for ${result.id}`,
      );
    }
  }

  for (const status of REPORT_STATUSES) {
    requireContract(
      report.statusCounts?.[status] === observedStatusCounts[status],
      `status count mismatch for ${status}`,
    );
  }

  const requiredProblems = (report.results || [])
    .filter(result => result.required !== false && result.status !== 'PASS');
  const requiredBlocked = requiredProblems.filter(result => result.status === 'BLOCKED');
  const requiredFailures = requiredProblems.filter(result => result.status !== 'BLOCKED');
  const expectedVerdict = requiredFailures.length > 0
    ? 'FAIL'
    : requiredBlocked.length > 0 ? 'BLOCKED' : 'PASS';
  const expectedExitCode = expectedVerdict === 'PASS' ? 0 : expectedVerdict === 'BLOCKED' ? 2 : 1;
  requireContract(report.verdict === expectedVerdict, 'report verdict does not match results');
  requireContract(report.exitCode === expectedExitCode, 'report exit code does not match verdict');
  requireContract(runnerExitCode === expectedExitCode, 'runner process exit code does not match report');
  requireContract(report.requiredFailureCount === requiredProblems.length, 'required failure count mismatch');
  requireContract(report.requiredBlockedCount === requiredBlocked.length, 'required blocked count mismatch');
  requireContract(report.dryRun === false, 'dry-run report cannot be nightly evidence');

  return {
    status: 'PASS',
    sourceRevision,
    registryHash: expectedRegistryHash,
    profiles: [...AUDIT_PROFILES].sort(),
    expectedSuiteCount: expectedIds.length,
    profileCounts: expectedProfileCounts,
    reportVerdict: report.verdict,
    reportExitCode: report.exitCode,
    reportStatusCounts: observedStatusCounts,
    summaryRequiredFailureCount: (report.results || []).filter(result => (
      result.required !== false
      && ['FAIL', 'TIMEOUT', 'SKIPPED'].includes(result.status)
    )).length,
    failureTotal: observedStatusCounts.FAIL + observedStatusCounts.TIMEOUT,
    timeoutTotal: observedStatusCounts.TIMEOUT,
    blockedTotal: observedStatusCounts.BLOCKED,
    failurePaths: (report.results || [])
      .filter(result => ['FAIL', 'TIMEOUT'].includes(result.status))
      .map(result => result.path)
      .sort(),
    timeoutPaths: (report.results || [])
      .filter(result => result.status === 'TIMEOUT')
      .map(result => result.path)
      .sort(),
    blockedPaths: (report.results || [])
      .filter(result => result.status === 'BLOCKED')
      .map(result => result.path)
      .sort(),
  };
}

async function validateSummaryContract(paths, auditContract) {
  const summary = await readEvidenceJSON(paths.summaryJson, paths.runDir, 'summary');
  requireContract(summary.runId === AUDIT_RUN_ID, 'summary run id mismatch');
  requireContract(summary.sourceRevision === auditContract.sourceRevision, 'summary source revision mismatch');
  requireContract(summary.mode === 'report', 'summary did not use the final report');
  requireContract(
    summary.inventory?.total === auditContract.expectedSuiteCount,
    'summary inventory total mismatch',
  );
  for (const status of REPORT_STATUSES) {
    requireContract(
      summary.statusCounts?.[status] === auditContract.reportStatusCounts[status],
      `summary status count mismatch for ${status}`,
    );
  }
  requireContract(
    summary.requiredFailureCount === auditContract.summaryRequiredFailureCount,
    'summary required failure count mismatch',
  );
  requireContract(summary.failures?.total === auditContract.failureTotal, 'summary failure total mismatch');
  requireContract(summary.timeouts?.total === auditContract.timeoutTotal, 'summary timeout total mismatch');
  requireContract(summary.blocked?.total === auditContract.blockedTotal, 'summary blocked total mismatch');
  const clusters = Array.isArray(summary.failures?.clusters) ? summary.failures.clusters : [];
  const clusteredFailurePaths = clusters.flatMap(cluster => (
    Array.isArray(cluster.paths) ? cluster.paths : []
  )).sort();
  requireContract(
    clusters.every(cluster => (
      Number.isInteger(cluster.count)
      && cluster.count > 0
      && Array.isArray(cluster.paths)
      && cluster.paths.length === cluster.count
    )),
    'summary failure cluster detail is incomplete',
  );
  requireContract(
    clusters.reduce((total, cluster) => total + cluster.count, 0) === auditContract.failureTotal,
    'summary failure cluster counts do not match the failure total',
  );
  requireContract(
    isDeepStrictEqual(clusteredFailurePaths, auditContract.failurePaths),
    'summary failure paths mismatch',
  );
  requireContract(
    isDeepStrictEqual([...(summary.timeouts?.paths || [])].sort(), auditContract.timeoutPaths),
    'summary timeout paths mismatch',
  );
  const blockedPaths = Array.isArray(summary.blocked?.suites)
    ? summary.blocked.suites.map(item => item.path).sort()
    : [];
  requireContract(
    isDeepStrictEqual(blockedPaths, auditContract.blockedPaths),
    'summary blocked paths mismatch',
  );
  return {
    status: 'PASS',
    sourceRevision: summary.sourceRevision,
    runId: summary.runId,
    mode: summary.mode,
    inventoryTotal: summary.inventory.total,
    statusCounts: summary.statusCounts,
  };
}

function sameStringMembers(actual, expected) {
  if (!Array.isArray(actual) || !Array.isArray(expected)) return false;
  if (actual.length !== expected.length) return false;
  return [...actual].sort().every((value, index) => value === [...expected].sort()[index]);
}

function countValues(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return counts;
}

export function registryBlockersFor(suite) {
  const blockers = new Set();
  if (suite.state !== 'ACTIVE') blockers.add(`state-${String(suite.state).toLowerCase()}`);
  if (suite.requirements.server) blockers.add('server');
  if (suite.requirements.ollama) blockers.add('ollama');
  if (suite.requirements.gpu) blockers.add('gpu');
  if (suite.requirements.modelFixture) blockers.add('model-fixture');
  if (suite.requirements.network === 'external') blockers.add('external-network');
  for (const toolchain of suite.requirements.toolchain || []) {
    blockers.add(`toolchain:${toolchain}`);
  }
  return [...blockers].sort();
}

function stableHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function isPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== ''
    && !relative.startsWith(`..${path.sep}`)
    && relative !== '..'
    && !path.isAbsolute(relative);
}

async function assertRegularContainedFile(filePath, root, label) {
  const metadata = await lstat(filePath);
  requireContract(metadata.isFile() && !metadata.isSymbolicLink(), `${label} is not a regular file`);
  const [realRoot, realFile] = await Promise.all([realpath(root), realpath(filePath)]);
  requireContract(isPathInside(realRoot, realFile), `${label} resolves outside its artifact root`);
}

async function readEvidenceJSON(filePath, root, label) {
  await assertRegularContainedFile(filePath, root, label);
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Nightly evidence contract violation: invalid ${label} JSON: ${error.message}`);
  }
}

async function hashFile(filePath) {
  const contents = await readFile(filePath);
  return createHash('sha256').update(contents).digest('hex');
}

function requireContract(condition, message) {
  if (!condition) throw new Error(`Nightly evidence contract violation: ${message}`);
}

async function acquireLock(lockDir, payload) {
  try {
    await mkdir(lockDir, { recursive: false, mode: 0o700 });
    await chmod(lockDir, 0o700);
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
    await lstat(targetPath);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`Refusing to reuse existing ${label}: ${targetPath}`);
}

async function cleanupOwnedWorktree(repo, paths, runId, sourceRevision) {
  const marker = await readEvidenceJSON(
    paths.worktreeOwnership,
    paths.worktreeRoot,
    'worktree ownership marker',
  );
  if (
    marker.owner !== ORCHESTRATOR_ID
    || marker.runId !== runId
    || marker.sourceRevision !== sourceRevision
    || marker.worktree !== paths.worktree
    || !['planned', 'created'].includes(marker.state)
  ) {
    throw new Error(`Refusing to remove unrecognized worktree: ${paths.worktree}`);
  }
  try {
    await access(paths.worktree, fsConstants.F_OK);
  } catch {
    await rm(paths.worktreeOwnership, { force: true });
    return;
  }
  await runLogged(['git', 'worktree', 'remove', '--force', paths.worktree], {
    cwd: repo,
    logPath: null,
    allowFailure: false,
    ignoreInterruption: true,
  });
  await rm(paths.worktreeOwnership, { force: true });
}

async function retainCompletedRuns(artifactRoot, retain, protectedRunDir) {
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
  const protectedPath = path.resolve(protectedRunDir);
  const keep = new Set([protectedPath]);
  for (const item of owned) {
    if (keep.size >= retain) break;
    keep.add(path.resolve(item.dir));
  }
  for (const item of owned) {
    if (keep.has(path.resolve(item.dir))) continue;
    await rm(item.dir, { recursive: true, force: true });
  }
}

async function assertCurrentRunRetained(paths) {
  const runMetadata = await lstat(paths.runDir);
  if (runMetadata.isSymbolicLink() || !runMetadata.isDirectory()) {
    throw new Error(`Current nightly evidence run was not retained: ${paths.runDir}`);
  }
  await assertRegularContainedFile(paths.metadata, paths.runDir, 'current run metadata');
}

function makeMetadata({
  opts,
  paths,
  sha,
  status,
  startedAt,
  runnerExitCode = null,
  summaryExitCode = null,
  preflight = null,
  auditContract = null,
  summaryContract = null,
  error = null,
  dependencyInstall = null,
  cleanupEvidence = null,
}) {
  return {
    orchestrator: ORCHESTRATOR_ID,
    runId: opts.runId,
    sourceRemote: opts.remote,
    sourceBranch: opts.branch,
    sourceRevision: sha,
    sourceLock: opts.sourceLockEvidence,
    testMode: opts.testMode === true,
    status,
    startedAt,
    endedAt: ['completed', 'completed_with_failures', 'preflight_failed', 'failed'].includes(status) ? new Date().toISOString() : null,
    runnerExitCode,
    summaryExitCode,
    preflight,
    auditContract,
    summaryContract,
    dependencyInstall,
    cleanupEvidence,
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
      allowBlockers: [...AUDIT_ALLOWED_BLOCKERS],
    },
    error,
  };
}

async function readJSON(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJSON(filePath, value) {
  await ensurePrivateDirectory(path.dirname(filePath));
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  await rename(temporaryPath, filePath);
  await chmod(filePath, 0o600);
}

async function ensurePrivateDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
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

function nonemptyLines(value) {
  return String(value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const entrypointUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entrypointUrl && import.meta.url === entrypointUrl) {
  try {
    const result = await runNightlyWithTerminationHandling(parseArgs());
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.dryRun && result.exitCode !== 0) {
      process.exitCode = Number.isInteger(result.exitCode) ? result.exitCode : 2;
    }
  } catch (err) {
    console.error(`nightly orchestrator failed: ${err.stack || err.message}`);
    process.exitCode = 2;
  }
}
