#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  M6_DIRECT_OWNED_SERVER_PROGRAMS,
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

function assertCleanCandidate(state, candidateSha, label) {
  if (state.head !== candidateSha || state.porcelain !== '') {
    throw new Error(`${label} requires the exact clean M6 candidate`);
  }
}

function safeEnvironment(runtime) {
  const env = {};
  for (const key of ['PATH', 'LANG', 'LC_ALL', 'TZ']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return {
    ...env,
    HOME: path.join(runtime, 'home'),
    XDG_CONFIG_HOME: path.join(runtime, 'xdg', 'config'),
    XDG_CACHE_HOME: path.join(runtime, 'xdg', 'cache'),
    XDG_DATA_HOME: path.join(runtime, 'xdg', 'data'),
    XDG_STATE_HOME: path.join(runtime, 'xdg', 'state'),
    TMPDIR: path.join(runtime, 'tmp'),
    TMP: path.join(runtime, 'tmp'),
    TEMP: path.join(runtime, 'tmp'),
    npm_config_cache: path.join(runtime, 'npm-cache'),
    C3_DB_PATH: path.join(runtime, 'server-evidence.sqlite'),
    C3_PROJECTS_DIR: path.join(runtime, 'projects'),
    INTENTSMITH_TEST_PROJECTS_DIR: path.join(runtime, 'projects'),
    INTENTSMITH_TEST_ARTIFACT_DIR: path.join(runtime, 'artifacts'),
    NODE_ENV: 'test',
    CI: '1',
    DOTENV_CONFIG_PATH: path.join(runtime, 'no-dotenv-file'),
    DOTENV_CONFIG_QUIET: 'true',
  };
}

async function sha256File(filePath) {
  const bytes = await readFile(filePath);
  return createHash('sha256').update(bytes).digest('hex');
}

async function writePrivateJsonAtomic(filePath, value) {
  const temporary = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
  await chmod(filePath, 0o600);
}

async function createPrivatePhaseRoot(root, candidateSha) {
  const relative = `.intentsmith-artifacts/m6/candidate-${candidateSha}/owned-server`;
  const absolute = path.join(root, relative);
  await mkdir(path.dirname(absolute), { recursive: true, mode: 0o700 });
  try {
    await mkdir(absolute, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(`Refusing to reuse M6 owned-server evidence: ${relative}`);
    }
    throw error;
  }
  const metadata = await lstat(absolute);
  if (
    !metadata.isDirectory()
    || metadata.isSymbolicLink()
    || await realpath(absolute) !== absolute
  ) {
    throw new Error('M6 owned-server evidence root is not canonical');
  }
  return { relative, absolute };
}

function makeReport({
  candidateSha,
  fingerprint,
  result,
  suite,
  phaseRoot,
  logPath,
  startedAt,
  endedAt,
}) {
  const passed = result.exitCode === 0
    && result.signal === null
    && result.timedOut === false
    && result.leakDetected === false
    && result.cleanupTerminated === true;
  const status = passed ? 'PASS' : result.timedOut ? 'TIMEOUT' : 'FAIL';
  const relativeLog = path.relative(process.cwd(), logPath).split(path.sep).join('/');
  const programResult = {
    id: suite.id,
    path: suite.path,
    profile: suite.profile,
    category: suite.profile,
    command: [...suite.argv],
    blockers: ['server'],
    required: true,
    start: startedAt,
    end: endedAt,
    durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)),
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    status,
    retryCount: 0,
    logPath: relativeLog,
    sourceRevision: candidateSha,
    modelFixturePreflight: null,
    environment: {
      authority: 'm6-owned-production-server-v1',
      inheritedKeys: ['PATH', 'LANG', 'LC_ALL', 'TZ'].filter(
        key => process.env[key] !== undefined,
      ),
      sourceRevision: candidateSha,
      runtimeRoot: path.relative(process.cwd(), path.join(phaseRoot, 'runtime'))
        .split(path.sep).join('/'),
    },
    cleanup: {
      checked: true,
      leakDetected: result.leakDetected,
      terminated: result.cleanupTerminated,
    },
    sourceTree: {
      checked: true,
      clean: true,
      porcelain: null,
      head: candidateSha,
    },
    logError: null,
    outputError: null,
    logSha256: null,
  };
  return {
    report: {
      schemaVersion: 1,
      manifestType: 'intentsmith.audit-report',
      runId: `m6-owned-server-${candidateSha}`,
      sourceRevision: candidateSha,
      startedAt,
      endedAt,
      dryRun: false,
      options: {
        authority: 'm6-owned-production-server-v1',
        acceptsArguments: false,
        concurrency: 1,
      },
      paths: {
        runDir: path.relative(process.cwd(), phaseRoot).split(path.sep).join('/'),
      },
      inventoryFingerprint: createHash('sha256').update(suite.id).digest('hex'),
      optionsFingerprint: createHash('sha256')
        .update('m6-owned-production-server-v1')
        .digest('hex'),
      registryHash: fingerprint,
      interruptionSignal: null,
      inventory: { selected: 1 },
      statusCounts: { [status]: 1 },
      verdict: passed ? 'PASS' : 'FAIL',
      exitCode: passed ? 0 : 1,
      requiredFailureCount: passed ? 0 : 1,
      requiredBlockedCount: 0,
      results: [programResult],
    },
    programResult,
  };
}

export async function runM6OwnedServerEvidence(root = process.cwd(), argv = []) {
  if (argv.length > 0) {
    throw new Error('M6 owned-server evidence uses a locked plan and accepts no arguments');
  }
  const repositoryRoot = git(root, ['rev-parse', '--show-toplevel']);
  if (await realpath(root) !== await realpath(repositoryRoot)) {
    throw new Error('M6 owned-server evidence must run from the worktree root');
  }
  const candidateSha = git(root, ['rev-parse', 'HEAD']);
  if (!SHA_PATTERN.test(candidateSha)) throw new Error('M6 candidate SHA is invalid');
  assertCleanCandidate(sourceState(root), candidateSha, 'pre-state');
  const registry = await loadTestRegistry(root);
  const fingerprint = registryFingerprint(registry);
  const suite = registry.suites.find(item => item.id === M6_DIRECT_OWNED_SERVER_PROGRAMS[0]);
  if (
    !suite
    || suite.required !== true
    || suite.state !== 'ACTIVE'
    || suite.requirements?.server !== true
  ) {
    throw new Error('M6 owned-server program is not an ACTIVE required server suite');
  }
  const phase = await createPrivatePhaseRoot(root, candidateSha);
  const runtime = path.join(phase.absolute, 'runtime');
  for (const directory of [
    runtime,
    path.join(runtime, 'home'),
    path.join(runtime, 'tmp'),
    path.join(runtime, 'projects'),
    path.join(runtime, 'artifacts'),
    path.join(runtime, 'npm-cache'),
    path.join(runtime, 'xdg', 'config'),
    path.join(runtime, 'xdg', 'cache'),
    path.join(runtime, 'xdg', 'data'),
    path.join(runtime, 'xdg', 'state'),
  ]) await mkdir(directory, { recursive: true, mode: 0o700 });
  const logPath = path.join(phase.absolute, 'program.log');
  const startedAt = new Date().toISOString();
  const result = await runLogged([...suite.argv], {
    cwd: root,
    env: safeEnvironment(runtime),
    logPath,
    allowFailure: true,
    timeoutMs: suite.timeoutMs,
  });
  const endedAt = new Date().toISOString();
  assertCleanCandidate(sourceState(root), candidateSha, 'post-state');
  const built = makeReport({
    candidateSha,
    fingerprint,
    result,
    suite,
    phaseRoot: phase.absolute,
    logPath,
    startedAt,
    endedAt,
  });
  built.programResult.logSha256 = await sha256File(logPath);
  const reportPath = path.join(phase.absolute, 'report.json');
  await writePrivateJsonAtomic(reportPath, built.report);
  return Object.freeze({
    candidateSha,
    registryFingerprint: fingerprint,
    reportPath: path.relative(root, reportPath).split(path.sep).join('/'),
    verdict: built.report.verdict,
    exitCode: built.report.exitCode,
  });
}

export async function main(argv = process.argv.slice(2)) {
  return await runWithOwnedProcessTerminationHandling(async () => {
    const result = await runM6OwnedServerEvidence(process.cwd(), argv);
    console.log(JSON.stringify(result, null, 2));
    return result.exitCode;
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().then(code => {
    process.exitCode = code;
  }).catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 2;
  });
}

