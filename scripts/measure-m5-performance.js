#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { request as httpRequest } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import {
  M5_PERFORMANCE_EVIDENCE_CONTRACT,
  M5_PERFORMANCE_EVIDENCE_VERSION,
  M5_PERFORMANCE_RAW_ARTIFACT_CONTRACT,
  M5_PERFORMANCE_RAW_ARTIFACT_VERSION,
  validateM5PerformanceEvidenceV3,
  validateM5PerformanceRawArtifactV2,
} from '../contracts/m5/performance-v3.js';
import {
  M5_PERFORMANCE_BUDGETS,
  evaluateM5PerformanceEvidence,
  summarizePerformanceMeasurement,
} from '../src/observability/performance-budget.js';
import {
  publishPerformanceArtifactExclusive,
} from '../src/observability/performance-artifact-store.js';
import {
  nonMeasuredGpuObservation,
  observeGpuPerformanceCensus,
  readLinuxProcessRssMiB,
} from '../src/observability/performance-runtime-observation.js';
import {
  observeWorkspaceRevision,
  queryProjectContext,
} from '../src/code-intel/project-context-provider.js';
import {
  PROJECT_CONTEXT_CONTRACT_VERSION,
  PROJECT_CONTEXT_KIND,
} from '../contracts/m2/project-context-v1.js';

const repositoryRoot = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const outputIndex = process.argv.indexOf('--output');
const requestedOutput = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
if (outputIndex >= 0 && (!requestedOutput || requestedOutput.startsWith('--'))) {
  throw new Error('performance-runner:missing-output-path');
}
const quick = process.argv.includes('--quick');
const soakDurationMs = quick ? 5_000 : 300_000;
const deterministicSamples = quick ? 20 : 40;
const contextSamples = quick ? 20 : 40;
const runtimeRoot = mkdtempSync(path.join(os.tmpdir(), 'intentsmith-m5-perf-'));
const serverRoot = path.join(runtimeRoot, 'server');
mkdirSync(serverRoot, { mode: 0o700 });
const portFile = path.join(serverRoot, 'intentsmith.port');
const dbPath = path.join(serverRoot, 'intentsmith.sqlite');
let server = null;

process.once('exit', () => {
  if (server?.child && !server.exited) server.child.kill('SIGTERM');
});

function percentileMeasurement(surface, latenciesMs, errorCount, durationMs, operations, rss) {
  return {
    surface,
    sampleCount: latenciesMs.length,
    errorCount,
    latenciesMs: latenciesMs.map(value => Number(value.toFixed(3))),
    durationMs: Math.round(durationMs),
    operations,
    rss,
  };
}

function git(args) {
  return execFileSync('/usr/bin/git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function requireCleanCandidate(expectedRevision = null) {
  const candidateRevision = git(['rev-parse', 'HEAD']);
  const candidateTree = git(['rev-parse', 'HEAD^{tree}']);
  if (expectedRevision !== null && candidateRevision !== expectedRevision) {
    throw new Error('performance-runner:candidate-revision-changed');
  }
  const status = git(['status', '--porcelain=v1', '--untracked-files=all']);
  if (status !== '') throw new Error('performance-runner:dirty-candidate');
  return Object.freeze({ candidateRevision, candidateTree });
}

function resolveOutputPaths(candidateRevision) {
  const artifactRoot = path.join(repositoryRoot, '.intentsmith-artifacts');
  const runId = `${candidateRevision.slice(0, 12)}-${new Date().toISOString().replaceAll(/[^0-9]/g, '').slice(0, 17)}-${randomBytes(4).toString('hex')}`;
  const evidencePath = requestedOutput
    ? path.resolve(requestedOutput)
    : path.join(artifactRoot, `m5-performance-${runId}.evidence.json`);
  const relative = path.relative(artifactRoot, evidencePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('performance-runner:output-outside-artifact-root');
  }
  if (!evidencePath.endsWith('.json')) throw new Error('performance-runner:output-must-be-json');
  const rawPath = evidencePath.replace(/\.json$/u, '.raw.json');
  if (rawPath === evidencePath) throw new Error('performance-runner:invalid-output-path');
  return Object.freeze({ artifactRoot, evidencePath, rawPath });
}

function serverEnvironment() {
  const home = path.join(serverRoot, 'home');
  const temp = path.join(serverRoot, 'tmp');
  const data = path.join(serverRoot, 'data');
  const projects = path.join(serverRoot, 'projects');
  for (const directory of [home, temp, data, projects]) mkdirSync(directory, { recursive: true });
  return {
    PATH: process.env.PATH || '/usr/bin:/bin',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    TZ: 'UTC',
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    XDG_DATA_HOME: data,
    XDG_STATE_HOME: path.join(home, '.state'),
    TMPDIR: temp,
    TMP: temp,
    TEMP: temp,
    NODE_ENV: 'production',
    CI: '1',
    DOTENV_CONFIG_PATH: path.join(serverRoot, 'no-dotenv'),
    DOTENV_CONFIG_QUIET: 'true',
    C3_HOST: '127.0.0.1',
    C3_PORT: '0',
    C3_PORT_FILE: portFile,
    C3_DB_PATH: dbPath,
    C3_PROJECTS_DIR: projects,
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
    C3_LOG_LEVEL: 'error',
    C3_ADMIN_TOKEN: randomBytes(32).toString('base64url'),
    OLLAMA_URL: 'invalid://m5-performance-no-provider',
    INTENTSMITH_TEST_SERVER_NONCE: 'm5-performance-owned-server-000001',
  };
}

async function startServer() {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: repositoryRoot,
    env: serverEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const state = {
    child,
    stdout: '',
    stderr: '',
    port: null,
    capability: null,
    exited: false,
    exitCode: null,
    signal: null,
  };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { state.stdout = (state.stdout + chunk).slice(-20_000); });
  child.stderr.on('data', chunk => { state.stderr = (state.stderr + chunk).slice(-20_000); });
  child.once('exit', (code, signal) => {
    state.exited = true;
    state.exitCode = code;
    state.signal = signal;
  });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (state.exited) {
      throw new Error(
        `owned server exited code=${state.exitCode} signal=${state.signal}: `
        + `${state.stdout}\n${state.stderr}`.slice(-4000),
      );
    }
    if (existsSync(portFile)) {
      try {
        const value = JSON.parse(readFileSync(portFile, 'utf8'));
        if (
          value.pid === child.pid
          && Number.isInteger(value.port)
          && /^[A-Za-z0-9_-]{43}$/.test(value.localCapability || '')
        ) {
          state.port = value.port;
          state.capability = value.localCapability;
          return state;
        }
      } catch {
        // Atomic port-file publication can be observed between rename and read.
      }
    }
    await delay(25);
  }
  const error = new Error(
    `owned server readiness timeout: ${`${state.stdout}\n${state.stderr}`.slice(-4000)}`,
  );
  await stopServer(state);
  throw error;
}

async function stopServer(state) {
  if (!state || state.exited) return;
  state.child.kill('SIGTERM');
  const deadline = Date.now() + 15_000;
  while (!state.exited && Date.now() < deadline) await delay(25);
  if (!state.exited) throw new Error('owned server did not stop gracefully');
}

function requestChat(state, index, phase) {
  const payload = JSON.stringify({
    contract: 'ConversationCommand',
    version: 1,
    requestId: `m5-perf-${phase}-request-${index}`,
    conversationId: `m5-perf-${phase}-conversation`,
    turnId: `m5-perf-${phase}-turn-${index}`,
    action: 'send',
    input: `kolik je ${index + 2} + 2?`,
  });
  const started = process.hrtime.bigint();
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: '127.0.0.1',
      port: state.port,
      path: '/api/chat',
      method: 'POST',
      headers: {
        'X-IntentSmith-Local-Capability': state.capability,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, response => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { raw += chunk; });
      response.on('end', () => {
        const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
        let body = null;
        try { body = JSON.parse(raw); } catch { /* classified as error below */ }
        resolve({ elapsedMs, ok: response.statusCode === 200 && body?.status === 'ok' });
      });
    });
    request.setTimeout(10_000, () => request.destroy(new Error('chat measurement timed out')));
    request.once('error', reject);
    request.end(payload);
  });
}

async function measureChat(state, samples, surface) {
  const latencies = [];
  let errors = 0;
  let peakRss = readLinuxProcessRssMiB(state.child.pid);
  const startRss = peakRss;
  const started = Date.now();
  for (let index = 0; index < samples; index += 1) {
    const result = await requestChat(state, index, surface.replaceAll('.', '-'));
    latencies.push(result.elapsedMs);
    if (!result.ok) errors += 1;
    peakRss = Math.max(peakRss, readLinuxProcessRssMiB(state.child.pid));
  }
  const endRss = readLinuxProcessRssMiB(state.child.pid);
  return percentileMeasurement(surface, latencies, errors, Date.now() - started, samples, {
    startMiB: startRss,
    peakMiB: peakRss,
    endMiB: endRss,
  });
}

async function measureSoak(state) {
  const latencies = [];
  let errors = 0;
  let operation = 0;
  const startRss = readLinuxProcessRssMiB(state.child.pid);
  let peakRss = startRss;
  const started = Date.now();
  while (Date.now() - started < soakDurationMs) {
    const operationStarted = Date.now();
    const result = await requestChat(state, operation, 'soak');
    latencies.push(result.elapsedMs);
    if (!result.ok) errors += 1;
    operation += 1;
    peakRss = Math.max(peakRss, readLinuxProcessRssMiB(state.child.pid));
    if (!quick) {
      const remaining = 200 - (Date.now() - operationStarted);
      if (remaining > 0) await delay(remaining);
    }
  }
  const endRss = readLinuxProcessRssMiB(state.child.pid);
  return percentileMeasurement(
    'core.deterministic-soak',
    latencies,
    errors,
    Date.now() - started,
    operation,
    { startMiB: startRss, peakMiB: peakRss, endMiB: endRss },
  );
}

async function measureProjectContext() {
  const fixture = path.join(runtimeRoot, 'context-project');
  mkdirSync(path.join(fixture, 'src'), { recursive: true });
  for (let index = 0; index < 128; index += 1) {
    writeFileSync(
      path.join(fixture, 'src', `module-${String(index).padStart(3, '0')}.js`),
      `export function projectAuthority${index}() { return ${index}; }\n`,
    );
  }
  const canonicalRoot = realpathSync(fixture);
  const projects = {
    findById: {
      get(projectId) {
        return projectId === 1 ? { id: 1, path: canonicalRoot, status: 'active' } : null;
      },
    },
  };
  const observation = await observeWorkspaceRevision(
    { projectId: 1, canonicalRoot },
    {},
    { projects },
  );
  const latencies = [];
  let errors = 0;
  const rssStart = Number((process.memoryUsage().rss / 2 ** 20).toFixed(3));
  let rssPeak = rssStart;
  const started = Date.now();
  for (let index = 0; index < contextSamples; index += 1) {
    const began = process.hrtime.bigint();
    const snapshot = await queryProjectContext({
      contract: PROJECT_CONTEXT_KIND.QUERY,
      version: PROJECT_CONTEXT_CONTRACT_VERSION,
      requestId: `m5-context-${index}`,
      projectId: 1,
      canonicalRoot,
      workspaceRevision: observation.workspaceRevision,
      queryText: 'projectAuthority',
      maxFiles: 8,
      maxBytes: 32_768,
      maxTokens: 8_192,
    }, {}, { projects });
    latencies.push(Number(process.hrtime.bigint() - began) / 1e6);
    if (snapshot.status !== 'ok' || snapshot.outcome !== 'found') errors += 1;
    rssPeak = Math.max(rssPeak, process.memoryUsage().rss / 2 ** 20);
  }
  const rssEnd = process.memoryUsage().rss / 2 ** 20;
  return percentileMeasurement(
    'code-intelligence.project-context',
    latencies,
    errors,
    Date.now() - started,
    contextSamples,
    {
      startMiB: Number(rssStart.toFixed(3)),
      peakMiB: Number(rssPeak.toFixed(3)),
      endMiB: Number(rssEnd.toFixed(3)),
    },
  );
}

function pinnedBaselines() {
  return Object.values(M5_PERFORMANCE_BUDGETS.pinned).map(item => ({
    surface: item.surface,
    sourceRevision: item.sourceRevision,
    sourcePath: item.sourcePath,
    sourceBlobOid: item.sourceBlobOid,
    sourceSha256: item.sourceSha256,
  }));
}

async function main() {
  const before = requireCleanCandidate();
  const output = resolveOutputPaths(before.candidateRevision);
  mkdirSync(output.artifactRoot, { recursive: true, mode: 0o700 });
  mkdirSync(path.dirname(output.evidencePath), { recursive: true, mode: 0o700 });
  server = await startServer();
  await requestChat(server, 0, 'warmup');
  const deterministic = await measureChat(
    server,
    deterministicSamples,
    'chat.deterministic-http',
  );
  const projectContext = await measureProjectContext();
  const soak = await measureSoak(server);
  const after = requireCleanCandidate(before.candidateRevision);
  if (after.candidateTree !== before.candidateTree) {
    throw new Error('performance-runner:candidate-tree-changed');
  }
  const measuredAtIso = new Date().toISOString();
  const host = { platform: process.platform, arch: process.arch, node: process.version };
  const gpuObservation = nonMeasuredGpuObservation(observeGpuPerformanceCensus());
  const rawArtifact = {
    contract: M5_PERFORMANCE_RAW_ARTIFACT_CONTRACT,
    version: M5_PERFORMANCE_RAW_ARTIFACT_VERSION,
    candidateRevision: before.candidateRevision,
    candidateTree: before.candidateTree,
    measuredAtIso,
    host,
    measurements: [deterministic, projectContext, soak],
    gpuObservation,
  };
  const rawValidation = validateM5PerformanceRawArtifactV2(rawArtifact);
  if (!rawValidation.valid) throw new Error(rawValidation.errors.join(', '));
  const rawBytes = Buffer.from(`${JSON.stringify(rawArtifact, null, 2)}\n`);
  const rawPublication = publishPerformanceArtifactExclusive(output.rawPath, rawBytes);
  const evidence = {
    contract: M5_PERFORMANCE_EVIDENCE_CONTRACT,
    version: M5_PERFORMANCE_EVIDENCE_VERSION,
    candidateRevision: before.candidateRevision,
    candidateTree: before.candidateTree,
    measuredAtIso,
    host,
    measurementArtifact: {
      path: path.relative(repositoryRoot, output.rawPath),
      sha256: rawPublication.sha256,
      byteLength: rawPublication.byteLength,
    },
    pinnedBaselines: pinnedBaselines(),
  };
  const validation = validateM5PerformanceEvidenceV3(evidence);
  if (!validation.valid) throw new Error(validation.errors.join(', '));
  const evaluation = evaluateM5PerformanceEvidence(evidence, {
    repositoryRoot,
    expectedCandidateRevision: before.candidateRevision,
    requireHeadCandidate: true,
    requireCleanWorktree: true,
  });
  const envelopeBytes = Buffer.from(`${JSON.stringify({ evidence, evaluation }, null, 2)}\n`);
  publishPerformanceArtifactExclusive(output.evidencePath, envelopeBytes);
  console.log(JSON.stringify({
    outputPath: output.evidencePath,
    rawArtifact: evidence.measurementArtifact,
    quick,
    measurements: rawArtifact.measurements.map(summarizePerformanceMeasurement),
    verdict: evaluation.verdict,
    failedChecks: evaluation.checks.filter(check => !check.passed),
  }, null, 2));
  if (evaluation.verdict !== 'PASS') process.exitCode = 1;
}

try {
  await main();
} finally {
  try { await stopServer(server); } finally {
    rmSync(runtimeRoot, { recursive: true, force: true });
  }
}
