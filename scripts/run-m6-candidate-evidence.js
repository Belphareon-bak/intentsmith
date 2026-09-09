#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  M6_DIRECT_FRESH_CLONE_PROGRAMS,
} from '../contracts/m6/candidate-plan-v1.js';
import {
  M6_PREVIOUS_VERSION_UPGRADE_PROGRAM,
} from '../contracts/m6/runtime-evidence-v1.js';
import {
  M6_RELEASE_EVIDENCE_INDEX_CONTRACT,
  M6_RELEASE_EVIDENCE_INDEX_PATH,
  M6_RELEASE_EVIDENCE_INDEX_VERSION,
} from '../contracts/m6/release-v1.js';
import {
  buildM6CandidateExecutionPlan,
  validateM6CandidateExecutionPlan,
} from '../src/release/m6-candidate-plan.js';
import {
  validateM6ReleaseArtifact,
} from '../src/release/m6-release-artifact.js';
import {
  evaluateM6TechnicalEvidence,
} from '../src/release/m6-technical-evidence.js';
import { resolvePdfPythonInterpreter } from '../src/chat/export/pdf-exporter.js';
import {
  runLogged,
  runWithOwnedProcessTerminationHandling,
} from './nightly-orchestrator.js';
import {
  loadTestRegistry,
  registryFingerprint,
} from './test-registry.js';

const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const PHYSICAL_GPU_MINIMUM_FREE_MIB = 20_000;
const PHYSICAL_GPU_QUIESCENCE_TIMEOUT_MS = 6 * 60 * 1000;
const PHYSICAL_GPU_QUIESCENCE_POLL_MS = 5_000;
const PHYSICAL_GPU_PREFLIGHT_STABLE_SAMPLES = 2;
const M6_CANDIDATE_MODEL = 'qwen3.5:27b';
const M6_CANDIDATE_MODEL_ID = '7653528ba5cb';
const M6_OLLAMA_WORKER = '/usr/local/lib/ollama/llama-server';
const OWNED_SERVER_REPORT = 'owned-server/report.json';
const SERVER_PROGRAM_REPORT = 'server-programs/report.json';

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function command(executable, args, options = {}) {
  return execFileSync(executable, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
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

function safeBaseEnvironment() {
  const environment = {};
  for (const key of ['PATH', 'LANG', 'LC_ALL', 'TZ']) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  const pdfPython = resolvePdfPythonInterpreter(process.env);
  environment.INTENTSMITH_PDF_PYTHON = pdfPython;
  environment.C3_PDF_PYTHON = pdfPython;
  return environment;
}

async function sha256File(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function artifactBinding(root, filePath) {
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`M6 evidence is not a regular file: ${filePath}`);
  }
  return {
    path: relative(root, filePath),
    bytes: metadata.size,
    sha256: await sha256File(filePath),
  };
}

async function writePrivateJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
  await chmod(filePath, 0o600);
}

async function createEvidenceRoot(root, candidateSha) {
  const evidenceRoot = path.join(
    root,
    '.intentsmith-artifacts',
    'm6',
    `candidate-${candidateSha}`,
  );
  await mkdir(path.dirname(evidenceRoot), { recursive: true, mode: 0o700 });
  try {
    await mkdir(evidenceRoot, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(`Refusing to reuse M6 candidate evidence root: ${relative(root, evidenceRoot)}`);
    }
    throw error;
  }
  if (await realpath(evidenceRoot) !== evidenceRoot) {
    throw new Error('M6 candidate evidence root is not canonical');
  }
  return evidenceRoot;
}

function auditArguments({ phase, evidenceRoot, root, candidateSha }) {
  const outDir = relative(root, path.join(evidenceRoot, phase.id));
  const args = [
    'scripts/nightly-audit.js',
    `--suite=${phase.programIds.join(',')}`,
    `--run-id=${phase.id}-${candidateSha}`,
    `--out-dir=${outDir}`,
    '--concurrency=1',
    `--timeout-minutes=${phase.timeoutMinutes}`,
    `--deadline-hours=${phase.deadlineHours}`,
    '--fail-fast',
  ];
  for (const blocker of phase.allowedBlockers) args.push(`--allow-blocker=${blocker}`);
  return args;
}

async function runAuditPhase({ root, candidateSha, evidenceRoot, phase }) {
  assertCleanCandidate(root, candidateSha, `${phase.id}:pre-state`);
  const logPath = path.join(evidenceRoot, 'logs', `${phase.id}.log`);
  await runLogged(['node', ...auditArguments({ phase, evidenceRoot, root, candidateSha })], {
    cwd: root,
    env: safeBaseEnvironment(),
    logPath,
    allowFailure: true,
    timeoutMs: phase.deadlineHours * 60 * 60 * 1_000 + 10 * 60 * 1_000,
  });
  assertCleanCandidate(root, candidateSha, `${phase.id}:post-state`);
  const runId = `${phase.id}-${candidateSha}`;
  const reportPath = path.join(evidenceRoot, phase.id, runId, 'report.json');
  await stat(reportPath);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const completion = validateM6CompletedAuditPhase(report, phase, candidateSha);
  if (!completion.valid) {
    throw new Error(`M6 phase ${phase.id} is red: ${completion.errors.join('; ')}`);
  }
  return reportPath;
}

export function validateM6CompletedAuditPhase(report, phase, candidateSha) {
  const errors = [];
  if (report?.verdict !== 'PASS') errors.push('report:verdict');
  if (report?.exitCode !== 0) errors.push('report:exit-code');
  if (report?.sourceRevision !== candidateSha) errors.push('report:candidate');
  if (report?.interruptionSignal !== null) errors.push('report:interrupted');
  if (report?.runnerFailure != null) errors.push('report:runner-failure');
  if (report?.requiredFailureCount !== 0) errors.push('report:required-failure-count');
  if (report?.requiredBlockedCount !== 0) errors.push('report:required-blocked-count');

  const expectedIds = [...(phase?.programIds || [])].sort();
  const results = Array.isArray(report?.results) ? report.results : [];
  const actualIds = results.map(result => result.id).sort();
  if (new Set(actualIds).size !== actualIds.length) errors.push('report:duplicate-result');
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) errors.push('report:result-set');
  for (const result of results) {
    if (result.status !== 'PASS') errors.push(`${result.id}:status`);
    if (result.exitCode !== 0) errors.push(`${result.id}:exit-code`);
    if (result.signal !== null) errors.push(`${result.id}:signal`);
    if (result.timedOut !== false) errors.push(`${result.id}:timeout`);
    if (result.sourceRevision !== candidateSha) errors.push(`${result.id}:candidate`);
    if (
      result.cleanup?.checked !== true
      || result.cleanup?.leakDetected !== false
      || result.cleanup?.terminated !== true
    ) errors.push(`${result.id}:cleanup`);
    if (
      result.sourceTree?.checked !== true
      || result.sourceTree?.clean !== true
      || result.sourceTree?.head !== candidateSha
    ) errors.push(`${result.id}:source-tree`);
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

async function assertNoStaleDirectTestRuntime(root) {
  const runtimeRoot = path.join(root, '.intentsmith-artifacts', 'direct-tests');
  let entries;
  try {
    entries = await readdir(runtimeRoot);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (entries.length > 0) {
    throw new Error(
      'M6 candidate preflight found preserved direct-test runtimes; inspect and quarantine them first',
    );
  }
}

function parseCsvLine(line) {
  return line.split(',').map(value => value.trim());
}

function processIdentity(pid, processName, authority = null) {
  const procRoot = `/proc/${pid}`;
  try {
    const metadata = statSync(procRoot);
    const argv = readFileSync(path.join(procRoot, 'cmdline'))
      .toString('utf8')
      .split('\0')
      .filter(Boolean);
    let executable = null;
    let executableState = 'observed';
    let executableErrorCode = null;
    try {
      executable = realpathSync(path.join(procRoot, 'exe'));
    } catch (error) {
      executableState = 'unreadable';
      executableErrorCode = error.code || 'UNKNOWN';
    }
    const argument = name => {
      const index = argv.indexOf(name);
      return index >= 0 ? argv[index + 1] : undefined;
    };
    const executableBound = authority === null
      ? null
      : executable === authority.workerExecutable
        || (executableState === 'unreadable' && executableErrorCode === 'EACCES');
    return {
      state: 'observed',
      uid: metadata.uid,
      executable,
      executableState,
      executableErrorCode,
      candidateWorkerBound: authority === null
        ? null
        : processName === authority.workerExecutable
          && argv[0] === authority.workerExecutable
          && executableBound,
      candidateWorkerUid: authority === null ? null : metadata.uid === authority.workerUid,
      candidateModelArgument: authority === null
        ? null
        : argument('--model') === authority.modelBlob,
      candidateMmprojArgument: authority === null
        ? null
        : argument('--mmproj') === authority.modelBlob,
      loopbackHost: authority === null ? null : argument('--host') === '127.0.0.1',
      offline: authority === null ? null : argv.includes('--offline'),
    };
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ESRCH') {
      return { state: 'gone', errorCode: error.code };
    }
    return { state: 'unreadable', errorCode: error.code || 'UNKNOWN' };
  }
}

function candidateModelAuthority() {
  const listed = command('ollama', ['list'])
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .slice(1)
    .filter(line => {
      const [model, modelId] = line.split(/\s+/u);
      return model === M6_CANDIDATE_MODEL && modelId === M6_CANDIDATE_MODEL_ID;
    });
  if (listed.length !== 1) {
    throw new Error('M6 candidate Ollama model identity is not uniquely installed');
  }
  const fromLines = command('ollama', ['show', '--modelfile', M6_CANDIDATE_MODEL])
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('FROM '));
  if (fromLines.length !== 1) {
    throw new Error('M6 candidate Ollama model blob is ambiguous');
  }
  const modelBlob = fromLines[0].slice('FROM '.length).trim();
  const canonicalBlob = realpathSync(modelBlob);
  if (
    canonicalBlob !== modelBlob
    || !/\/blobs\/sha256-[a-f0-9]{64}$/u.test(canonicalBlob)
  ) {
    throw new Error('M6 candidate Ollama model blob is not canonical');
  }
  const workerExecutable = realpathSync(M6_OLLAMA_WORKER);
  const modelMetadata = statSync(canonicalBlob);
  return Object.freeze({
    model: M6_CANDIDATE_MODEL,
    modelId: M6_CANDIDATE_MODEL_ID,
    modelBlob: canonicalBlob,
    workerExecutable,
    workerUid: modelMetadata.uid,
  });
}

function gpuCensusSnapshot(authority = null) {
  let computeRaw;
  let memoryRaw;
  let ollamaRaw;
  try {
    computeRaw = command('nvidia-smi', [
      '--query-compute-apps=pid,process_name,used_gpu_memory',
      '--format=csv,noheader,nounits',
    ]);
    memoryRaw = command('nvidia-smi', [
      '--query-gpu=index,name,memory.total,memory.used,memory.free,utilization.gpu',
      '--format=csv,noheader,nounits',
    ]);
    ollamaRaw = command('ollama', ['ps']);
  } catch (error) {
    const typed = new Error(`M6 GPU census is unavailable: ${error.message}`);
    typed.code = 'M6_GPU_CENSUS_UNAVAILABLE';
    throw typed;
  }
  const compute = computeRaw ? computeRaw.split('\n').filter(Boolean).map(line => {
    const [pid, processName, usedMemoryMiB] = parseCsvLine(line);
    const numericPid = Number(pid);
    return {
      pid: numericPid,
      processName,
      usedMemoryMiB: Number(usedMemoryMiB),
      identity: processIdentity(numericPid, processName, authority),
    };
  }) : [];
  const gpus = memoryRaw.split('\n').filter(Boolean).map(line => {
    const [index, name, totalMiB, usedMiB, freeMiB, utilizationPercent] = parseCsvLine(line);
    return {
      index: Number(index),
      name,
      totalMiB: Number(totalMiB),
      usedMiB: Number(usedMiB),
      freeMiB: Number(freeMiB),
      utilizationPercent: Number(utilizationPercent),
    };
  });
  const ollamaLines = ollamaRaw.split('\n').map(line => line.trim()).filter(Boolean);
  const census = {
    contract: 'M6GpuCensus',
    version: 1,
    capturedAt: new Date().toISOString(),
    compute,
    gpus,
    ollama: {
      header: ollamaLines[0] || '',
      runningRows: ollamaLines.slice(1),
    },
    minimumFreeMiB: PHYSICAL_GPU_MINIMUM_FREE_MIB,
  };
  census.available = gpus.length > 0
    && gpus.every(gpu => Number.isFinite(gpu.freeMiB));
  census.foreignActivity = compute.length > 0 || census.ollama.runningRows.length > 0;
  census.sufficientFreeMemory = census.available
    && Math.max(...gpus.map(gpu => gpu.freeMiB)) >= PHYSICAL_GPU_MINIMUM_FREE_MIB;
  return census;
}

export async function captureGpuCensus(evidenceRoot, options = {}) {
  const snapshot = options.snapshot || gpuCensusSnapshot;
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const now = options.now || Date.now;
  const timeoutMs = options.timeoutMs ?? PHYSICAL_GPU_QUIESCENCE_TIMEOUT_MS;
  const pollMs = options.pollMs ?? PHYSICAL_GPU_QUIESCENCE_POLL_MS;
  const stableSamples = options.stableSamples ?? PHYSICAL_GPU_PREFLIGHT_STABLE_SAMPLES;
  if (!Number.isInteger(stableSamples) || stableSamples < 2) {
    throw new TypeError('M6 GPU preflight requires at least two stable samples');
  }
  const startedAtMs = now();
  const observations = [];
  let consecutiveCleanSamples = 0;
  const censusPath = path.join(evidenceRoot, 'gpu', 'preflight.json');
  const waitReceiptPath = path.join(evidenceRoot, 'gpu', 'preflight-wait.json');
  while (true) {
    const census = snapshot();
    observations.push(census);
    await writePrivateJsonAtomic(censusPath, census);
    const clean = census.available
      && !census.foreignActivity
      && census.sufficientFreeMemory;
    consecutiveCleanSamples = clean ? consecutiveCleanSamples + 1 : 0;
    const elapsedMs = now() - startedAtMs;
    if (consecutiveCleanSamples >= stableSamples) {
      await writePrivateJsonAtomic(waitReceiptPath, {
        contract: 'M6GpuPreflightWaitReceipt',
        version: 1,
        startedAt: new Date(startedAtMs).toISOString(),
        endedAt: census.capturedAt,
        waitedMs: elapsedMs,
        pollMs,
        requiredStableSamples: stableSamples,
        intervention: 'none-read-only-wait',
        observations,
        verdict: 'PASS',
      });
      return censusPath;
    }
    if (elapsedMs >= timeoutMs) {
      await writePrivateJsonAtomic(waitReceiptPath, {
        contract: 'M6GpuPreflightWaitReceipt',
        version: 1,
        startedAt: new Date(startedAtMs).toISOString(),
        endedAt: census.capturedAt,
        waitedMs: elapsedMs,
        pollMs,
        requiredStableSamples: stableSamples,
        intervention: 'none-read-only-wait',
        observations,
        verdict: 'BLOCKED',
        reasonCode: 'M6_GPU_CENSUS_BLOCKED',
      });
      const error = new Error('M6 physical GPU phase blocked by read-only host census');
      error.code = 'M6_GPU_CENSUS_BLOCKED';
      error.censusPath = censusPath;
      error.waitReceiptPath = waitReceiptPath;
      throw error;
    }
    await sleep(pollMs);
  }
}

export function candidateModelResidencyOnly(census) {
  if (census.compute.length === 0 && census.ollama.runningRows.length === 0) return false;
  if (census.ollama.runningRows.length > 1) return false;
  if (census.ollama.runningRows.length === 1) {
    const [model, modelId] = census.ollama.runningRows[0].split(/\s+/u);
    if (model !== M6_CANDIDATE_MODEL || modelId !== M6_CANDIDATE_MODEL_ID) return false;
  }
  return census.compute.every(item => (
    item.identity?.state === 'gone'
    || (
      item.identity?.state === 'observed'
      && item.processName === M6_OLLAMA_WORKER
      && item.identity.candidateWorkerBound === true
      && item.identity.candidateWorkerUid === true
      && item.identity.candidateModelArgument === true
      && item.identity.candidateMmprojArgument === true
      && item.identity.loopbackHost === true
      && item.identity.offline === true
    )
  ));
}

async function waitForCandidateGpuQuiescence(evidenceRoot) {
  const startedAtMs = Date.now();
  const observations = [];
  const authority = candidateModelAuthority();
  const receiptPath = path.join(evidenceRoot, 'gpu', 'pre-physical-quiescence.json');
  while (true) {
    const census = gpuCensusSnapshot(authority);
    observations.push({
      capturedAt: census.capturedAt,
      compute: census.compute,
      gpus: census.gpus,
      ollama: census.ollama,
      available: census.available,
      foreignActivity: census.foreignActivity,
      sufficientFreeMemory: census.sufficientFreeMemory,
    });
    if (census.available && !census.foreignActivity && census.sufficientFreeMemory) {
      await writePrivateJsonAtomic(receiptPath, {
        contract: 'M6GpuQuiescenceReceipt',
        version: 1,
        candidateModel: M6_CANDIDATE_MODEL,
        candidateModelId: M6_CANDIDATE_MODEL_ID,
        authority,
        startedAt: new Date(startedAtMs).toISOString(),
        endedAt: census.capturedAt,
        waitedMs: Date.now() - startedAtMs,
        intervention: 'none-read-only-wait',
        observations,
        verdict: 'PASS',
      });
      return receiptPath;
    }
    if (!census.available || !candidateModelResidencyOnly(census)) {
      await writePrivateJsonAtomic(receiptPath, {
        contract: 'M6GpuQuiescenceReceipt',
        version: 1,
        candidateModel: M6_CANDIDATE_MODEL,
        candidateModelId: M6_CANDIDATE_MODEL_ID,
        authority,
        startedAt: new Date(startedAtMs).toISOString(),
        endedAt: census.capturedAt,
        waitedMs: Date.now() - startedAtMs,
        intervention: 'none-read-only-wait',
        observations,
        verdict: 'FAIL',
        reasonCode: 'M6_GPU_QUIESCENCE_FOREIGN_ACTIVITY',
      });
      const error = new Error('M6 GPU quiescence encountered unknown or foreign activity');
      error.code = 'M6_GPU_QUIESCENCE_FOREIGN_ACTIVITY';
      throw error;
    }
    if (Date.now() - startedAtMs >= PHYSICAL_GPU_QUIESCENCE_TIMEOUT_MS) {
      await writePrivateJsonAtomic(receiptPath, {
        contract: 'M6GpuQuiescenceReceipt',
        version: 1,
        candidateModel: M6_CANDIDATE_MODEL,
        candidateModelId: M6_CANDIDATE_MODEL_ID,
        authority,
        startedAt: new Date(startedAtMs).toISOString(),
        endedAt: census.capturedAt,
        waitedMs: Date.now() - startedAtMs,
        intervention: 'none-read-only-wait',
        observations,
        verdict: 'FAIL',
        reasonCode: 'M6_GPU_QUIESCENCE_TIMEOUT',
      });
      const error = new Error('M6 candidate model did not unload before physical GPU phase');
      error.code = 'M6_GPU_QUIESCENCE_TIMEOUT';
      throw error;
    }
    await new Promise(resolve => setTimeout(resolve, PHYSICAL_GPU_QUIESCENCE_POLL_MS));
  }
}

async function copyCacheIfPresent(source, destination) {
  try {
    const metadata = await lstat(source);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) return false;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  await cp(source, destination, {
    recursive: true,
    dereference: false,
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
  });
  return true;
}

async function makeFreshCloneEnvironment({ cloneRoot, runtime, candidateSha, evidenceRoot }) {
  for (const directory of [
    runtime,
    path.join(runtime, 'home'),
    path.join(runtime, 'tmp'),
    path.join(runtime, 'projects'),
    path.join(runtime, 'artifacts'),
    path.join(runtime, 'xdg', 'config'),
    path.join(runtime, 'xdg', 'cache'),
    path.join(runtime, 'xdg', 'data'),
    path.join(runtime, 'xdg', 'state'),
  ]) await mkdir(directory, { recursive: true, mode: 0o700 });
  const userHome = os.homedir();
  const hostCacheRoot = process.env.XDG_CACHE_HOME || path.join(userHome, '.cache');
  const npmCache = path.join(runtime, 'npm-cache');
  const yarnCache = path.join(runtime, 'yarn-cache');
  const corepackHome = path.join(runtime, 'corepack');
  const nodeGypCache = path.join(runtime, 'xdg', 'cache', 'node-gyp');
  const electronCache = path.join(runtime, 'xdg', 'cache', 'electron');
  const electronHeaders = path.join(runtime, 'home', '.electron-gyp');
  const cacheReceipt = {
    npm: await copyCacheIfPresent(
      process.env.npm_config_cache || path.join(userHome, '.npm'),
      npmCache,
    ),
    yarn: await copyCacheIfPresent(
      process.env.YARN_CACHE_FOLDER || path.join(userHome, '.cache', 'yarn'),
      yarnCache,
    ),
    corepack: await copyCacheIfPresent(
      process.env.COREPACK_HOME || path.join(userHome, '.cache', 'node', 'corepack'),
      corepackHome,
    ),
    nodeGyp: await copyCacheIfPresent(
      process.env.npm_config_devdir || path.join(hostCacheRoot, 'node-gyp'),
      nodeGypCache,
    ),
    electron: await copyCacheIfPresent(
      process.env.electron_config_cache || path.join(hostCacheRoot, 'electron'),
      electronCache,
    ),
    electronHeaders: await copyCacheIfPresent(
      path.join(userHome, '.electron-gyp'),
      electronHeaders,
    ),
  };
  await writePrivateJsonAtomic(path.join(evidenceRoot, 'fresh-clone', 'cache-receipt.json'), {
    ...cacheReceipt,
    secretValuesRecorded: false,
  });
  const environment = {
    ...safeBaseEnvironment(),
    HOME: path.join(runtime, 'home'),
    XDG_CONFIG_HOME: path.join(runtime, 'xdg', 'config'),
    XDG_CACHE_HOME: path.join(runtime, 'xdg', 'cache'),
    XDG_DATA_HOME: path.join(runtime, 'xdg', 'data'),
    XDG_STATE_HOME: path.join(runtime, 'xdg', 'state'),
    TMPDIR: path.join(runtime, 'tmp'),
    TMP: path.join(runtime, 'tmp'),
    TEMP: path.join(runtime, 'tmp'),
    npm_config_cache: npmCache,
    YARN_CACHE_FOLDER: yarnCache,
    COREPACK_HOME: corepackHome,
    npm_config_devdir: nodeGypCache,
    electron_config_cache: electronCache,
    C3_DB_PATH: path.join(runtime, 'fresh-clone.sqlite'),
    C3_PROJECTS_DIR: path.join(runtime, 'projects'),
    INTENTSMITH_TEST_PROJECTS_DIR: path.join(runtime, 'projects'),
    INTENTSMITH_TEST_ARTIFACT_DIR: path.join(runtime, 'artifacts'),
    INTENTSMITH_TEST_SOURCE_REVISION: candidateSha,
    INTENTSMITH_M1_FRESH_CLONE: '1',
    NODE_ENV: 'test',
    CI: '1',
    DOTENV_CONFIG_PATH: path.join(runtime, 'no-dotenv-file'),
    DOTENV_CONFIG_QUIET: 'true',
    C3_LIFECYCLE_AUTO_COMMIT: 'false',
    C3_ENABLE_AUTONOMY: 'false',
    C3_LOG_LEVEL: 'warn',
  };
  for (const key of ['DISPLAY', 'XAUTHORITY', 'INTENTSMITH_STUDIO_DISPLAY', 'INTENTSMITH_STUDIO_XAUTHORITY']) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  if (environment.INTENTSMITH_STUDIO_DISPLAY === undefined && environment.DISPLAY !== undefined) {
    environment.INTENTSMITH_STUDIO_DISPLAY = environment.DISPLAY;
  }
  if (environment.INTENTSMITH_STUDIO_XAUTHORITY === undefined && environment.XAUTHORITY !== undefined) {
    environment.INTENTSMITH_STUDIO_XAUTHORITY = environment.XAUTHORITY;
  }
  return { environment, cloneRoot };
}

async function directProgramResult({
  root,
  candidateSha,
  suite,
  environment,
  logPath,
  authority,
}) {
  assertCleanCandidate(root, candidateSha, `${suite.id}:pre-state`);
  const startedAt = new Date().toISOString();
  const result = await runLogged([...suite.argv], {
    cwd: root,
    env: environment,
    logPath,
    allowFailure: true,
    timeoutMs: suite.timeoutMs,
  });
  const endedAt = new Date().toISOString();
  assertCleanCandidate(root, candidateSha, `${suite.id}:post-state`);
  const passed = result.exitCode === 0
    && result.signal === null
    && !result.timedOut
    && !result.leakDetected
    && result.cleanupTerminated;
  return {
    id: suite.id,
    path: suite.path,
    profile: suite.profile,
    category: suite.profile,
    command: [...suite.argv],
    blockers: [],
    required: true,
    start: startedAt,
    end: endedAt,
    durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)),
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    status: passed ? 'PASS' : result.timedOut ? 'TIMEOUT' : 'FAIL',
    retryCount: 0,
    logPath: logPath,
    sourceRevision: candidateSha,
    modelFixturePreflight: null,
    environment: { authority, sourceRevision: candidateSha },
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
    logSha256: await sha256File(logPath),
  };
}

function directReport({ candidateSha, fingerprint, results, startedAt, endedAt }) {
  const failed = results.filter(result => result.status !== 'PASS');
  return {
    schemaVersion: 1,
    manifestType: 'intentsmith.audit-report',
    runId: `m6-fresh-clone-${candidateSha}`,
    sourceRevision: candidateSha,
    startedAt,
    endedAt,
    dryRun: false,
    options: {
      authority: 'm6-fresh-clone-install-build-studio-v1',
      acceptsArguments: false,
      concurrency: 1,
      installNetwork: 'linux-user-network-namespace-none',
    },
    paths: {},
    inventoryFingerprint: createHash('sha256')
      .update(results.map(result => result.id).join('\n'))
      .digest('hex'),
    optionsFingerprint: createHash('sha256')
      .update('m6-fresh-clone-install-build-studio-v1')
      .digest('hex'),
    registryHash: fingerprint,
    interruptionSignal: null,
    inventory: { selected: results.length },
    statusCounts: Object.fromEntries(
      [...new Set(results.map(result => result.status))]
        .map(status => [status, results.filter(result => result.status === status).length]),
    ),
    verdict: failed.length === 0 ? 'PASS' : 'FAIL',
    exitCode: failed.length === 0 ? 0 : 1,
    requiredFailureCount: failed.length,
    requiredBlockedCount: 0,
    results,
  };
}

export async function runFreshClonePhase({
  root,
  candidateSha,
  fingerprint,
  registry,
  evidenceRoot,
}) {
  const temporaryParent = await mkdtemp(path.join(os.tmpdir(), 'intentsmith-m6-clone-'));
  const cloneRoot = path.join(temporaryParent, 'source');
  const runtime = path.join(temporaryParent, 'runtime');
  try {
    await runLogged([
      'git', 'clone', '--no-local', '--no-hardlinks', '--no-checkout', root, cloneRoot,
    ], {
      cwd: root,
      env: safeBaseEnvironment(),
      logPath: path.join(evidenceRoot, 'logs', 'fresh-clone.log'),
      timeoutMs: 10 * 60 * 1000,
    });
    await runLogged(['git', 'checkout', '--detach', candidateSha], {
      cwd: cloneRoot,
      env: safeBaseEnvironment(),
      logPath: path.join(evidenceRoot, 'logs', 'fresh-clone.log'),
      timeoutMs: 5 * 60 * 1000,
    });
    if (git(cloneRoot, ['rev-parse', '--git-dir']) !== '.git'
      || git(cloneRoot, ['rev-parse', '--git-common-dir']) !== '.git') {
      throw new Error('M6 fresh clone is not a standalone Git clone');
    }
    const prepared = await makeFreshCloneEnvironment({
      cloneRoot,
      runtime,
      candidateSha,
      evidenceRoot,
    });
    const installLog = path.join(evidenceRoot, 'logs', 'fresh-clone-install.log');
    await runLogged([
      'unshare', '--user', '--map-root-user', '--net', '--',
      './scripts/install.sh', '--profile=core', '--minimal', '--offline',
    ], {
      cwd: cloneRoot,
      env: prepared.environment,
      logPath: installLog,
      timeoutMs: 45 * 60 * 1000,
    });
    assertCleanCandidate(cloneRoot, candidateSha, 'fresh-clone:post-install');

    const startedAt = new Date().toISOString();
    const results = [];
    for (const programId of M6_DIRECT_FRESH_CLONE_PROGRAMS) {
      const suite = registry.suites.find(item => item.id === programId);
      if (!suite || suite.required !== true || suite.state !== 'ACTIVE') {
        throw new Error(`M6 fresh-clone program unavailable: ${programId}`);
      }
      const programRuntime = path.join(
        evidenceRoot,
        'fresh-clone',
        'runtime',
        programId.toLowerCase(),
      );
      const programArtifacts = path.join(programRuntime, 'artifacts');
      const programProjects = path.join(programRuntime, 'projects');
      const programTemp = path.join(programRuntime, 'tmp');
      const programNpmCache = path.join(programArtifacts, 'npm-cache');
      for (const directory of [
        programRuntime,
        programArtifacts,
        programProjects,
        programTemp,
        path.join(programRuntime, 'home'),
        path.join(programRuntime, 'xdg', 'config'),
        path.join(programRuntime, 'xdg', 'cache'),
        path.join(programRuntime, 'xdg', 'data'),
        path.join(programRuntime, 'xdg', 'state'),
      ]) await mkdir(directory, { recursive: true, mode: 0o700 });
      if (programId === M6_PREVIOUS_VERSION_UPGRADE_PROGRAM) {
        const copied = await copyCacheIfPresent(
          prepared.environment.npm_config_cache,
          programNpmCache,
        );
        if (!copied) {
          throw new Error('M6 previous-version upgrade requires the runner-owned npm cache');
        }
      } else {
        await mkdir(programNpmCache, { recursive: false, mode: 0o700 });
      }
      const environment = {
        ...prepared.environment,
        C3_AUDIT_RUN: '1',
        HOME: path.join(programRuntime, 'home'),
        XDG_CONFIG_HOME: path.join(programRuntime, 'xdg', 'config'),
        XDG_CACHE_HOME: path.join(programRuntime, 'xdg', 'cache'),
        XDG_DATA_HOME: path.join(programRuntime, 'xdg', 'data'),
        XDG_STATE_HOME: path.join(programRuntime, 'xdg', 'state'),
        TMPDIR: programTemp,
        TMP: programTemp,
        TEMP: programTemp,
        npm_config_cache: programNpmCache,
        C3_DB_PATH: path.join(programRuntime, 'program.sqlite'),
        C3_PORT_FILE: path.join(programRuntime, 'program.port'),
        C3_PROJECTS_DIR: programProjects,
        INTENTSMITH_TEST_PROJECTS_DIR: programProjects,
        INTENTSMITH_TEST_ARTIFACT_DIR: programArtifacts,
      };
      const logPath = path.join(evidenceRoot, 'logs', `${programId}.log`);
      const result = await directProgramResult({
        root: cloneRoot,
        candidateSha,
        suite,
        environment,
        logPath,
        authority: 'm6-fresh-clone-install-build-studio-v1',
      });
      result.logPath = relative(root, logPath);
      results.push(result);
    }
    const endedAt = new Date().toISOString();
    const report = directReport({
      candidateSha,
      fingerprint,
      results,
      startedAt,
      endedAt,
    });
    const reportPath = path.join(evidenceRoot, 'fresh-clone', 'report.json');
    await writePrivateJsonAtomic(reportPath, report);
    assertCleanCandidate(cloneRoot, candidateSha, 'fresh-clone:post-journeys');
    return { reportPath, cloneRoot, temporaryParent };
  } catch (error) {
    await cleanupFreshClone({ temporaryParent });
    throw error;
  }
}

export async function cleanupFreshClone({ temporaryParent }) {
  const resolved = path.resolve(temporaryParent);
  const temporaryRoot = path.resolve(os.tmpdir());
  if (
    path.dirname(resolved) !== temporaryRoot
    || !path.basename(resolved).startsWith('intentsmith-m6-clone-')
  ) throw new Error(`Refusing unsafe M6 temporary clone cleanup: ${resolved}`);
  await rm(resolved, { recursive: true, force: false, maxRetries: 2 });
}

export async function finalizeFreshCloneRelease({
  root,
  candidateSha,
  evidenceRoot,
  fresh,
}) {
  assertCleanCandidate(root, candidateSha, 'release-artifact:canonical-post-journeys');
  assertCleanCandidate(fresh.cloneRoot, candidateSha, 'release-artifact:clone-post-journeys');
  await runLogged(['node', 'scripts/capture-m6-release-artifact.js'], {
    cwd: fresh.cloneRoot,
    env: safeBaseEnvironment(),
    logPath: path.join(evidenceRoot, 'logs', 'release-artifact-capture.log'),
    timeoutMs: 5 * 60 * 1000,
  });
  const cloneRelease = path.join(
    fresh.cloneRoot,
    '.intentsmith-artifacts',
    'm6',
    `candidate-${candidateSha}`,
    'release',
  );
  const cloneManifestPath = path.join(cloneRelease, 'manifest.json');
  const cloneArtifact = JSON.parse(await readFile(cloneManifestPath, 'utf8'));
  const cloneValidation = await validateM6ReleaseArtifact(cloneArtifact, {
    root: fresh.cloneRoot,
    candidateSha,
    sourceTreeClean: sourceState(fresh.cloneRoot).porcelain === '',
  });
  if (!cloneValidation.valid) {
    throw new Error(`M6 post-journey release artifact invalid: ${cloneValidation.errors.join('; ')}`);
  }
  const candidateRelease = path.join(evidenceRoot, 'release');
  await cp(cloneRelease, candidateRelease, {
    recursive: true,
    dereference: false,
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
  });
  const manifestPath = path.join(candidateRelease, 'manifest.json');
  const releaseArtifact = JSON.parse(await readFile(manifestPath, 'utf8'));
  const releaseValidation = await validateM6ReleaseArtifact(releaseArtifact, {
    root,
    candidateSha,
    sourceTreeClean: sourceState(root).porcelain === '',
  });
  if (!releaseValidation.valid) {
    throw new Error(`M6 copied release artifact invalid: ${releaseValidation.errors.join('; ')}`);
  }
  return manifestPath;
}

export async function loadReportItem(root, reportPath, phase) {
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const logs = [];
  for (const result of report.results || []) {
    if (
      typeof result.logPath !== 'string'
      || path.isAbsolute(result.logPath)
      || result.logPath.includes('\\')
      || result.logPath.split('/').includes('..')
    ) throw new Error(`M6 report has an unsafe log path: ${result.id}`);
    const sourceLog = path.resolve(root, result.logPath);
    const relativeLog = path.relative(root, sourceLog);
    if (
      relativeLog === ''
      || relativeLog === '..'
      || relativeLog.startsWith(`..${path.sep}`)
    ) throw new Error(`M6 report log escapes the candidate root: ${result.id}`);
    const metadata = await lstat(sourceLog);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`M6 report log is not a regular file: ${result.id}`);
    }
    const realLog = await realpath(sourceLog);
    const realRelative = path.relative(await realpath(root), realLog);
    if (realRelative === '' || realRelative === '..' || realRelative.startsWith(`..${path.sep}`)) {
      throw new Error(`M6 report log resolves outside the candidate root: ${result.id}`);
    }
    logs.push({ programId: result.id, bytes: await readFile(sourceLog) });
  }
  return {
    phaseId: phase.id,
    runner: phase.runner,
    report,
    artifact: await artifactBinding(root, reportPath),
    logs,
  };
}

async function stageM6GitEvidence({
  root,
  candidateSha,
  registryFingerprint: fingerprint,
  generatedAt,
  plan,
  reportPaths,
  releaseManifestPath,
}) {
  if (reportPaths.length !== plan.phases.length) {
    throw new Error('M6 Git evidence requires exactly one report per locked phase');
  }
  const relativeEvidenceRoot = `docs/execution/runs/m6/candidate-${candidateSha}`;
  const evidenceRoot = path.join(root, relativeEvidenceRoot);
  await mkdir(path.dirname(evidenceRoot), { recursive: true, mode: 0o700 });
  await mkdir(evidenceRoot, { recursive: false, mode: 0o700 });
  const reportBindings = [];
  for (const [index, phase] of plan.phases.entries()) {
    const report = JSON.parse(await readFile(reportPaths[index], 'utf8'));
    const logs = [];
    for (const result of report.results || []) {
      if (
        typeof result.logPath !== 'string'
        || path.isAbsolute(result.logPath)
        || result.logPath.split(path.sep).includes('..')
      ) throw new Error(`M6 report has an unsafe log path: ${result.id}`);
      const sourceLog = path.resolve(root, result.logPath);
      if (!relative(root, sourceLog) || relative(root, sourceLog).startsWith('../')) {
        throw new Error(`M6 report log escapes the candidate root: ${result.id}`);
      }
      const targetLog = path.join(evidenceRoot, 'logs', phase.id, `${result.id}.log`);
      await mkdir(path.dirname(targetLog), { recursive: true, mode: 0o700 });
      await cp(sourceLog, targetLog, {
        recursive: false,
        dereference: false,
        errorOnExist: true,
        force: false,
      });
      await chmod(targetLog, 0o600);
      const logArtifact = await artifactBinding(root, targetLog);
      if (result.logSha256 !== logArtifact.sha256) {
        throw new Error(`M6 staged log changed bytes: ${result.id}`);
      }
      result.logPath = logArtifact.path;
      logs.push({ programId: result.id, artifact: logArtifact });
    }
    const target = path.join(evidenceRoot, 'reports', `${phase.id}.json`);
    await writePrivateJsonAtomic(target, report);
    reportBindings.push({
      phaseId: phase.id,
      runner: phase.runner,
      artifact: await artifactBinding(root, target),
      logs,
    });
  }

  const sourceManifest = JSON.parse(await readFile(releaseManifestPath, 'utf8'));
  const stagedManifest = structuredClone(sourceManifest);
  for (const file of stagedManifest.files) {
    const source = path.join(path.dirname(releaseManifestPath), 'files', file.role);
    const targetRelative = `${relativeEvidenceRoot}/release/files/${file.role}`;
    const target = path.join(root, targetRelative);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await cp(source, target, {
      recursive: false,
      dereference: false,
      errorOnExist: true,
      force: false,
    });
    await chmod(target, file.mode === 0o700 ? 0o700 : 0o600);
    const binding = await artifactBinding(root, target);
    if (binding.bytes !== file.bytes || binding.sha256 !== file.sha256) {
      throw new Error(`M6 staged release role changed bytes: ${file.role}`);
    }
    file.artifactPath = targetRelative;
  }
  const stagedManifestPath = path.join(evidenceRoot, 'release', 'manifest.json');
  await writePrivateJsonAtomic(stagedManifestPath, stagedManifest);
  const index = {
    contract: M6_RELEASE_EVIDENCE_INDEX_CONTRACT,
    version: M6_RELEASE_EVIDENCE_INDEX_VERSION,
    candidateSha,
    registryFingerprint: fingerprint,
    generatedAt,
    reports: reportBindings,
    releaseArtifactManifest: await artifactBinding(root, stagedManifestPath),
  };
  await writePrivateJsonAtomic(path.join(root, M6_RELEASE_EVIDENCE_INDEX_PATH), index);
  return M6_RELEASE_EVIDENCE_INDEX_PATH;
}

export async function runM6CandidateEvidence(root = process.cwd(), argv = []) {
  if (argv.length > 0) {
    throw new Error('M6 candidate evidence uses a locked plan and accepts no arguments');
  }
  const canonicalRoot = git(root, ['rev-parse', '--show-toplevel']);
  if (await realpath(root) !== await realpath(canonicalRoot)) {
    throw new Error('M6 candidate evidence must run from the canonical worktree root');
  }
  const candidateSha = git(root, ['rev-parse', 'HEAD']);
  if (!SHA_PATTERN.test(candidateSha)) throw new Error('M6 candidate SHA is invalid');
  assertCleanCandidate(root, candidateSha, 'candidate:pre-state');
  await assertNoStaleDirectTestRuntime(root);
  const registry = await loadTestRegistry(root);
  const fingerprint = registryFingerprint(registry);
  const plan = buildM6CandidateExecutionPlan(registry);
  const planValidation = validateM6CandidateExecutionPlan(plan, registry);
  if (!planValidation.valid) {
    throw new Error(`M6 candidate plan invalid: ${planValidation.errors.join('; ')}`);
  }
  const evidenceRoot = await createEvidenceRoot(root, candidateSha);
  await writePrivateJsonAtomic(path.join(evidenceRoot, 'plan.json'), {
    ...plan,
    candidateSha,
    registryFingerprint: fingerprint,
    generatedAt: new Date().toISOString(),
  });

  const reportPaths = [];
  const deterministic = plan.phases.find(phase => phase.id === 'deterministic-offline-database');
  reportPaths.push(await runAuditPhase({ root, candidateSha, evidenceRoot, phase: deterministic }));

  const serverScript = await runLogged(['node', 'scripts/run-m6-owned-server-evidence.js'], {
    cwd: root,
    env: safeBaseEnvironment(),
    logPath: path.join(evidenceRoot, 'logs', 'owned-production-server-runner.log'),
    allowFailure: true,
    timeoutMs: 10 * 60 * 1000,
  });
  if (serverScript.exitCode !== 0) {
    throw new Error(`M6 owned production server phase failed: ${serverScript.exitCode}`);
  }
  const ownedServerReportPath = path.join(evidenceRoot, OWNED_SERVER_REPORT);
  const ownedServerReport = JSON.parse(await readFile(ownedServerReportPath, 'utf8'));
  const ownedServerPhase = plan.phases.find(phase => phase.id === 'owned-production-server');
  const ownedServerCompletion = validateM6CompletedAuditPhase(
    ownedServerReport,
    ownedServerPhase,
    candidateSha,
  );
  if (!ownedServerCompletion.valid) {
    throw new Error(
      `M6 owned production server report is red: ${ownedServerCompletion.errors.join('; ')}`,
    );
  }
  reportPaths.push(ownedServerReportPath);

  await captureGpuCensus(evidenceRoot);
  const modelWithoutServer = plan.phases.find(phase => phase.id === 'model-without-server');
  reportPaths.push(await runAuditPhase({
    root,
    candidateSha,
    evidenceRoot,
    phase: modelWithoutServer,
  }));

  const serverProgramsPhase = plan.phases.find(
    phase => phase.id === 'runner-owned-server-programs',
  );
  const serverProgramsScript = await runLogged([
    'node',
    'scripts/run-m6-server-program-evidence.js',
  ], {
    cwd: root,
    env: safeBaseEnvironment(),
    logPath: path.join(evidenceRoot, 'logs', 'server-programs-runner.log'),
    allowFailure: true,
    timeoutMs: serverProgramsPhase.deadlineHours * 60 * 60 * 1_000 + 10 * 60 * 1_000,
  });
  if (serverProgramsScript.exitCode !== 0) {
    throw new Error(`M6 runner-owned server-program phase failed: ${serverProgramsScript.exitCode}`);
  }
  const serverProgramsReportPath = path.join(evidenceRoot, SERVER_PROGRAM_REPORT);
  const serverProgramsReport = JSON.parse(await readFile(serverProgramsReportPath, 'utf8'));
  const serverProgramsCompletion = validateM6CompletedAuditPhase(
    serverProgramsReport,
    serverProgramsPhase,
    candidateSha,
  );
  if (!serverProgramsCompletion.valid) {
    throw new Error(
      `M6 runner-owned server-program report is red: ${serverProgramsCompletion.errors.join('; ')}`,
    );
  }
  reportPaths.push(serverProgramsReportPath);

  const fresh = await runFreshClonePhase({
    root,
    candidateSha,
    fingerprint,
    registry,
    evidenceRoot,
  });
  reportPaths.push(fresh.reportPath);
  try {
    await waitForCandidateGpuQuiescence(evidenceRoot);
    const physicalGpu = plan.phases.find(phase => phase.id === 'physical-ollama-gpu');
    reportPaths.push(await runAuditPhase({ root, candidateSha, evidenceRoot, phase: physicalGpu }));

    const controlledSoak = plan.phases.find(phase => phase.id === 'controlled-soak');
    reportPaths.push(await runAuditPhase({ root, candidateSha, evidenceRoot, phase: controlledSoak }));
    assertCleanCandidate(root, candidateSha, 'candidate:post-state');

    const releaseManifestPath = await finalizeFreshCloneRelease({
      root,
      candidateSha,
      evidenceRoot,
      fresh,
    });
    const reports = [];
    for (const [index, reportPath] of reportPaths.entries()) {
      reports.push(await loadReportItem(root, reportPath, plan.phases[index]));
    }
    const technical = evaluateM6TechnicalEvidence({
      candidateSha,
      registryFingerprint: fingerprint,
      registry,
      plan,
      reports,
    });
    await writePrivateJsonAtomic(path.join(evidenceRoot, 'technical-evidence.json'), technical);
    if (!technical.valid || technical.checks.some(row => (
      !['m5-acceptance', 'gate0-attestation', 'independent-read-only-review',
        'release-artifact', 'operator-demo-approval'].includes(row.id)
      && row.status !== 'PASS'
    )) || technical.l0.some(row => row.status !== 'PASS')) {
      throw new Error('M6 technical candidate evidence is incomplete or red');
    }
    const releaseEvidencePath = await stageM6GitEvidence({
      root,
      candidateSha,
      registryFingerprint: fingerprint,
      generatedAt: new Date().toISOString(),
      plan,
      reportPaths,
      releaseManifestPath,
    });
    return Object.freeze({
      candidateSha,
      registryFingerprint: fingerprint,
      evidenceRoot: relative(root, evidenceRoot),
      releaseEvidencePath,
      technicalImplementation: 'PASS',
      releaseVerdict: 'BLOCKED',
      reasonCode: 'M6_GIT_EVIDENCE_COMMIT_AND_EXTERNAL_AUTHORITIES_PENDING',
      exitCode: 2,
    });
  } finally {
    await cleanupFreshClone(fresh);
  }
}

export async function main(argv = process.argv.slice(2)) {
  return await runWithOwnedProcessTerminationHandling(async () => {
    const result = await runM6CandidateEvidence(process.cwd(), argv);
    console.log(JSON.stringify(result, null, 2));
    return result.exitCode;
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().then(code => {
    process.exitCode = code;
  }).catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = error.code === 'M6_GPU_CENSUS_BLOCKED' ? 2 : 1;
  });
}
