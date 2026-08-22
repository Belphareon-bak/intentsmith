#!/usr/bin/env node

// WP-M1-QUALITY registered T3 A/B measurement.
//
// The suite compares each raw answer (A) with the final output after the
// production refinement owner (B). It uses one pinned model and one committed
// corpus, performs no model administration, and waits for natural Ollama
// restoration before returning.

import './helpers/isolated-test-db.js';

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

import { config } from '../src/config.js';
import { improveResponse, REFINEMENT_OWNER } from '../src/chat/quality/improvement-loops.js';
import { scoreResponse } from '../src/chat/quality/response-scorer.js';
import { createAuthToken, LLMCallerRole } from '../src/llm/auth-types.js';
import { executeM1ModelRequest } from '../src/llm/cre-bridge.js';
import { llmGateway } from '../src/llm/gateway.js';
import {
  MODEL_RUNTIME_PROFILE,
  validateApprovedModelRuntimeProfile,
} from '../src/llm/model-runtime-profile.js';

const execFileAsync = promisify(execFile);
const SUITE_ID = 'IS-T3-TESTS-M1-QUALITY-GPU-AB-TEST';
const EXIT_BLOCKED = 2;
const MODEL = MODEL_RUNTIME_PROFILE.model;
const DIGEST = MODEL_RUNTIME_PROFILE.digestSha256;
const NUM_CTX = MODEL_RUNTIME_PROFILE.contextWindowTokens;
const MINIMUM_FREE_VRAM_MIB = 20128;
const MINIMUM_HEADROOM_MIB = MODEL_RUNTIME_PROFILE.minimumHeadroomMiB;
const RESTORE_TIMEOUT_MS = 420000;
const RESTORE_POLL_MS = 5000;
const SAMPLE_INTERVAL_MS = 150;
const PROVIDER_TIMEOUT_MS = 90000;
const CORPUS_PATH = 'tests/fixtures/m1-quality-corpus.json';

let reportPath = null;
let report = null;
let requestCounter = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function normalizeDigest(value) {
  return String(value || '').replace(/^sha256:/, '').toLowerCase();
}

function percentile(values, quantile) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
}

function summarizeLatencies(values) {
  return {
    count: values.length,
    p50Ms: percentile(values, 0.50),
    p95Ms: percentile(values, 0.95),
    totalMs: values.reduce((sum, value) => sum + value, 0),
  };
}

function summarizeTokens(records) {
  return records.reduce((total, usage) => ({
    promptTokens: total.promptTokens + (usage?.promptEvalCount || usage?.promptTokens || 0),
    outputTokens: total.outputTokens + (usage?.evalCount || usage?.outputTokens || 0),
  }), { promptTokens: 0, outputTokens: 0 });
}

function parseGpu(stdout) {
  const rows = String(stdout || '').trim().split(/\r?\n/).filter(Boolean);
  assert(rows.length === 1, 'M1 quality A/B requires exactly one readable NVIDIA GPU');
  const values = rows[0].split(',').map(value => Number(value.trim()));
  assert(values.length === 6 && values.every(Number.isFinite), 'Invalid GPU observation');
  const [index, totalMiB, usedMiB, freeMiB, utilizationPercent, temperatureC] = values;
  assert(index === 0, 'M1 quality A/B is pinned to GPU index 0');
  assert(Math.abs(totalMiB - usedMiB - freeMiB) <= 512, 'GPU accounting is inconsistent');
  return { index, totalMiB, usedMiB, freeMiB, utilizationPercent, temperatureC };
}

async function observeGpu() {
  const result = await execFileAsync('nvidia-smi', [
    '--query-gpu=index,memory.total,memory.used,memory.free,utilization.gpu,temperature.gpu',
    '--format=csv,noheader,nounits',
  ], { encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024 });
  return { ...parseGpu(result.stdout), observedAtMs: Date.now() };
}

async function observeComputeApps() {
  const result = await execFileAsync('nvidia-smi', [
    '--query-compute-apps=pid,process_name,used_memory',
    '--format=csv,noheader,nounits',
  ], { encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024 });
  return String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean).map(line => {
    const [pid, processName, usedMemoryMiB] = line.split(',').map(value => value.trim());
    return { pid: Number(pid), processName, usedMemoryMiB: Number(usedMemoryMiB) };
  });
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

async function observeOllama(baseUrl) {
  const [tags, running] = await Promise.all([
    fetchJson(`${baseUrl}/api/tags`),
    fetchJson(`${baseUrl}/api/ps`),
  ]);
  return {
    installed: (tags.models || []).map(model => ({
      name: model.name,
      digestSha256: normalizeDigest(model.digest),
    })),
    loaded: (running.models || []).map(model => ({
      name: model.name,
      digestSha256: normalizeDigest(model.digest),
      contextWindowTokens: model.context_length,
      sizeBytes: model.size,
      sizeVramBytes: model.size_vram,
    })),
  };
}

function installWireBoundary(baseUrl) {
  const originalFetch = globalThis.fetch;
  const origin = new URL(baseUrl).origin;
  const wire = [];
  const allowed = new Set(['GET /api/tags', 'GET /api/ps', 'POST /api/chat']);
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = String(options.method || input?.method || 'GET').toUpperCase();
    const route = `${method} ${url.pathname}`;
    if (url.origin !== origin || !allowed.has(route)) {
      throw Object.assign(new Error('M1 quality A/B escaped its loopback routes'), {
        code: 'M1_QUALITY_NETWORK_SCOPE_VIOLATION',
      });
    }
    if (route === 'POST /api/chat') {
      const body = JSON.parse(options.body);
      if (
        body.model !== MODEL
        || body.stream !== false
        || body.options?.num_ctx !== NUM_CTX
        || Object.hasOwn(body, 'keep_alive')
      ) {
        throw Object.assign(new Error('M1 quality A/B wire contract drifted'), {
          code: 'M1_QUALITY_WIRE_CONTRACT_INVALID',
        });
      }
      wire.push({
        method,
        pathname: url.pathname,
        model: body.model,
        numCtx: body.options.num_ctx,
        format: body.format ?? null,
        hasKeepAlive: Object.hasOwn(body, 'keep_alive'),
      });
    }
    return originalFetch(input, options);
  };
  return { wire, restore: () => { globalThis.fetch = originalFetch; } };
}

function startGpuMonitor() {
  const samples = [];
  const errors = [];
  let stopping = false;
  const pending = (async () => {
    while (!stopping) {
      try {
        samples.push(await observeGpu());
      } catch (error) {
        errors.push(error.message);
      }
      if (!stopping) await new Promise(resolve => setTimeout(resolve, SAMPLE_INTERVAL_MS));
    }
  })();
  return {
    async stop() {
      stopping = true;
      await pending;
      assert(errors.length === 0, `GPU monitor failed: ${errors[0]}`);
      return samples;
    },
  };
}

async function waitForNaturalRestore(baseUrl, beforeGpu) {
  const startedAt = Date.now();
  let polls = 0;
  let last = null;
  while (Date.now() - startedAt < RESTORE_TIMEOUT_MS) {
    const [ollama, gpu, compute] = await Promise.all([
      observeOllama(baseUrl), observeGpu(), observeComputeApps(),
    ]);
    polls += 1;
    last = { loadedModels: ollama.loaded.map(model => model.name), computeCount: compute.length, gpu };
    if (
      ollama.loaded.length === 0
      && compute.length === 0
      && gpu.usedMiB <= beforeGpu.usedMiB + MINIMUM_HEADROOM_MIB
    ) {
      return { elapsedMs: Date.now() - startedAt, polls, ...last };
    }
    await new Promise(resolve => setTimeout(resolve, RESTORE_POLL_MS));
  }
  const error = new Error('M1 quality A/B shared GPU state did not restore naturally');
  error.code = 'M1_QUALITY_GPU_STATE_NOT_RESTORED';
  error.lastObservation = last;
  throw error;
}

async function loadCorpus() {
  const bytes = await readFile(path.join(process.cwd(), CORPUS_PATH));
  const corpus = JSON.parse(bytes.toString('utf8'));
  assert(corpus.schemaVersion === 1, 'M1 quality corpus schema drifted');
  assert(corpus.modelRole === 'CHAT', 'M1 quality corpus role drifted');
  assert(Array.isArray(corpus.cases) && corpus.cases.length >= 4, 'M1 quality corpus is incomplete');
  return { corpus, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function registryIssues(entry) {
  const expectedRequirements = {
    network: 'loopback', database: false, server: false, ollama: true, gpu: true,
  };
  const issues = [];
  if (entry?.id !== SUITE_ID) issues.push('registry-entry-missing');
  if (entry?.path !== 'tests/m1-quality-gpu-ab.test.js') issues.push('registry-path-drift');
  if (JSON.stringify(entry?.argv) !== JSON.stringify(['node', 'tests/m1-quality-gpu-ab.test.js'])) {
    issues.push('registry-argv-drift');
  }
  if (entry?.tier !== 'T3' || entry?.profile !== 'model') issues.push('registry-classification-drift');
  if (entry?.timeoutMs !== 900000 || entry?.state !== 'ACTIVE' || entry?.required !== true) {
    issues.push('registry-execution-drift');
  }
  if (JSON.stringify(entry?.requirements) !== JSON.stringify(expectedRequirements)) {
    issues.push('registry-requirements-drift');
  }
  return issues;
}

function staticIssues({ baseUrl, sourceRevision, registryEntry }) {
  const issues = [];
  if (process.env.C3_AUDIT_RUN !== '1') issues.push('audit-run-boundary-missing');
  if (baseUrl !== 'http://127.0.0.1:11434') issues.push('provider-not-exact-loopback-http');
  if (!/^[a-f0-9]{40}$/.test(sourceRevision)) issues.push('source-revision-unbound');
  if (config.models?.CHAT !== MODEL) issues.push('runtime-chat-binding-drift');
  if (!validateApprovedModelRuntimeProfile(MODEL_RUNTIME_PROFILE).valid) issues.push('runtime-profile-invalid');
  if (REFINEMENT_OWNER !== 'response-finalizer') issues.push('refinement-owner-drift');
  issues.push(...registryIssues(registryEntry));
  return issues;
}

function initialIssues({ ollama, gpu, compute, concurrency }) {
  const issues = [];
  const installed = ollama.installed.find(model => model.name === MODEL);
  if (!installed) issues.push('pinned-model-not-installed');
  else if (installed.digestSha256 !== DIGEST) issues.push('pinned-model-digest-mismatch');
  if (ollama.loaded.length !== 0) issues.push('gpu-model-already-resident');
  if (compute.length !== 0) issues.push('gpu-compute-process-already-active');
  if (gpu.freeMiB < MINIMUM_FREE_VRAM_MIB) issues.push('preload-free-vram-insufficient');
  if (gpu.utilizationPercent > 60) issues.push('gpu-baseline-utilization-too-high');
  if (concurrency.max !== 1 || concurrency.active !== 0 || concurrency.queued !== 0) {
    issues.push('model-gateway-not-serial-and-idle');
  }
  return issues;
}

function makeRequest(entry, purpose, prompt, systemPrompt, signal = null) {
  requestCounter += 1;
  const callerRole = purpose === 'refine'
    ? LLMCallerRole.REFLECTOR
    : LLMCallerRole.CRE_DECISION;
  const identity = `m1-quality-${entry.id}-${purpose}-${process.pid}-${requestCounter}`;
  const request = {
    contract: 'ModelRequest',
    version: 1,
    requestId: `${identity}-request`,
    conversationId: `${identity}-conversation`,
    turnId: `${identity}-turn`,
    callerRole,
    modelRole: 'CHAT',
    purpose,
    prompt,
    systemPrompt,
    parameters: {
      temperature: purpose === 'refine' ? 0.3 : 0.2,
      num_ctx: NUM_CTX,
      timeout: PROVIDER_TIMEOUT_MS,
      maxTokens: entry.intent === 'CODE' ? 700 : 450,
    },
  };
  const token = createAuthToken({
    role: callerRole,
    decisionId: request.requestId,
    auditContext: { sessionId: request.conversationId, stepId: request.turnId },
  });
  return { request, token, signal };
}

async function callModel(entry, purpose, prompt, systemPrompt, signal = null) {
  const { request, token } = makeRequest(entry, purpose, prompt, systemPrompt, signal);
  const startedAt = Date.now();
  const result = await executeM1ModelRequest(request, { authToken: token, signal });
  const latencyMs = Date.now() - startedAt;
  if (result.status !== 'ok') {
    throw Object.assign(new Error(`M1 quality ${purpose} ended ${result.status}`), {
      code: result.error?.code || 'M1_QUALITY_MODEL_FAILURE',
    });
  }
  assert(result.response?.model === MODEL, `M1 quality ${purpose} used a different model`);
  return {
    content: result.response.content,
    model: result.response.model,
    duration: latencyMs,
    promptEvalCount: result.response.usage?.promptEvalCount,
    evalCount: result.response.usage?.evalCount,
  };
}

function acceptedBehavior(entry, text) {
  const normalized = String(text || '').toLocaleLowerCase('cs');
  const missingTerms = entry.requiredTerms.filter(term => (
    !normalized.includes(term.toLocaleLowerCase('cs'))
  ));
  const patternPresent = !entry.requiredPattern || text.includes(entry.requiredPattern);
  return { pass: missingTerms.length === 0 && patternPresent, missingTerms, patternPresent };
}

async function prepareReportPath() {
  const root = process.env.INTENTSMITH_TEST_ARTIFACT_DIR;
  assert(typeof root === 'string' && path.isAbsolute(root), 'owned artifact root is required');
  assert(root.split(path.sep).includes('.intentsmith-artifacts'), 'artifact root escaped ownership');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const metadata = await lstat(root);
  assert(metadata.isDirectory() && !metadata.isSymbolicLink(), 'artifact root must be a real directory');
  const canonical = await realpath(root);
  assert(canonical.split(path.sep).includes('.intentsmith-artifacts'), 'canonical artifact root escaped');
  return path.join(canonical, 'm1-quality-gpu-ab.json');
}

async function persistReport() {
  if (!reportPath || !report) return;
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8', mode: 0o600, flag: 'wx',
  });
  await chmod(reportPath, 0o600);
}

async function selfCheck() {
  const { corpus } = await loadCorpus();
  const registry = JSON.parse(await readFile('tests/registry.json', 'utf8'));
  const entry = registry.suites.find(suite => suite.id === SUITE_ID);
  assert(registryIssues(entry).length === 0, registryIssues(entry).join(','));
  assert(REFINEMENT_OWNER === 'response-finalizer', 'refinement owner drifted');
  assert(corpus.cases.every(item => acceptedBehavior(
    item,
    `${item.requiredTerms.join(' ')} ${item.requiredPattern || ''}`,
  ).pass), 'corpus behavior parser drifted');
  assert(percentile([10, 30, 20, 40], 0.5) === 20, 'p50 calculation drifted');
  assert(percentile([10, 30, 20, 40], 0.95) === 40, 'p95 calculation drifted');
  const safe = initialIssues({
    ollama: { installed: [{ name: MODEL, digestSha256: DIGEST }], loaded: [] },
    gpu: { freeMiB: MINIMUM_FREE_VRAM_MIB, utilizationPercent: 0 },
    compute: [],
    concurrency: { max: 1, active: 0, queued: 0 },
  });
  assert(safe.length === 0, `safe preflight fixture rejected: ${safe.join(',')}`);
  console.log('SELF_CHECK_PASS: M1 quality A/B performs no provider or GPU effect');
}

async function main() {
  if (process.argv.includes('--self-check')) {
    await selfCheck();
    return 0;
  }

  const startedAt = new Date().toISOString();
  const sourceRevision = process.env.INTENTSMITH_TEST_SOURCE_REVISION || '';
  const baseUrl = config.ollama?.baseUrl || 'http://127.0.0.1:11434';
  const { corpus, sha256: corpusSha256 } = await loadCorpus();
  const registry = JSON.parse(await readFile('tests/registry.json', 'utf8'));
  const registryEntry = registry.suites.find(suite => suite.id === SUITE_ID);
  reportPath = await prepareReportPath();
  report = {
    schemaVersion: 1,
    suiteId: SUITE_ID,
    sourceRevision,
    startedAt,
    endedAt: null,
    verdict: 'RUNNING',
    requirement: {
      model: MODEL,
      digestSha256: DIGEST,
      contextWindowTokens: NUM_CTX,
      minimumFreeVramMiB: MINIMUM_FREE_VRAM_MIB,
      minimumHeadroomMiB: MINIMUM_HEADROOM_MIB,
      fallbackPolicy: MODEL_RUNTIME_PROFILE.fallbackPolicy,
      corpusPath: CORPUS_PATH,
      corpusSha256,
      refinementOwner: REFINEMENT_OWNER,
    },
    safety: null,
    measurements: null,
    failure: null,
  };

  let boundary = null;
  let monitor = null;
  let beforeGpu = null;
  let providerEffectStarted = false;
  let stage = 'static-preflight';
  try {
    const staticFailures = staticIssues({ baseUrl, sourceRevision, registryEntry });
    if (staticFailures.length > 0) {
      report.verdict = 'BLOCKED';
      report.failure = { code: 'M1_QUALITY_PREREQUISITE_BLOCKED', issues: staticFailures };
      report.endedAt = new Date().toISOString();
      await persistReport();
      console.error(`BLOCKED: ${staticFailures.join(', ')}`);
      return EXIT_BLOCKED;
    }

    boundary = installWireBoundary(baseUrl);
    stage = 'shared-state-preflight';
    const [ollama, gpu, compute] = await Promise.all([
      observeOllama(baseUrl), observeGpu(), observeComputeApps(),
    ]);
    beforeGpu = gpu;
    const concurrency = llmGateway.getConcurrencyStats();
    const issues = initialIssues({ ollama, gpu, compute, concurrency });
    report.safety = {
      initialLoadedModels: ollama.loaded.map(model => model.name),
      initialComputeProcessCount: compute.length,
      beforeGpu: gpu,
      gatewayConcurrency: concurrency,
      issues,
    };
    if (issues.length > 0) {
      report.verdict = 'BLOCKED';
      report.failure = { code: 'M1_QUALITY_PREREQUISITE_BLOCKED', issues };
      report.endedAt = new Date().toISOString();
      boundary.restore();
      boundary = null;
      await persistReport();
      console.error(`BLOCKED: ${issues.join(', ')}`);
      return EXIT_BLOCKED;
    }

    monitor = startGpuMonitor();
    const cases = [];
    for (const entry of corpus.cases) {
      stage = `baseline:${entry.id}`;
      const baselinePrompt = [
        entry.query,
        '',
        `Povinné pojmy: ${entry.requiredTerms.join(', ')}.`,
        `Přijaté chování: ${entry.acceptedBehavior}`,
      ].join('\n');
      const baselineSystem = 'Vytvoř stručný první návrh odpovědi. Piš pouze česky, bez meta-komentáře.';
      providerEffectStarted = true;
      const baseline = await callModel(entry, 'answer', baselinePrompt, baselineSystem);
      const scoreBefore = scoreResponse(baseline.content, {
        query: entry.query, intent: entry.intent, lang: corpus.language,
      });

      stage = `refinement:${entry.id}`;
      const improved = await improveResponse(
        baseline.content,
        { query: entry.query, intent: entry.intent, lang: corpus.language },
        async (prompt, systemPrompt, options) => callModel(
          entry, 'refine', prompt, systemPrompt, options?.signal || null,
        ),
        { mode: 'balanced', sessionId: `m1-quality-${entry.id}`, scoreBefore },
      );
      const finalScore = scoreResponse(improved.response, {
        query: entry.query, intent: entry.intent, lang: corpus.language,
      });
      const behavior = acceptedBehavior(entry, improved.response);
      cases.push({
        id: entry.id,
        intent: entry.intent,
        baseline: {
          latencyMs: baseline.duration,
          usage: {
            promptEvalCount: baseline.promptEvalCount ?? null,
            evalCount: baseline.evalCount ?? null,
          },
          responseChars: baseline.content.length,
          responseSha256: sha256(baseline.content),
          score: scoreBefore.total,
        },
        refinement: {
          attempted: improved.telemetry.attempted,
          accepted: improved.telemetry.accepted,
          outcome: improved.telemetry.outcome,
          latencyMs: improved.telemetry.latencyMs,
          providerDurationMs: improved.telemetry.providerDurationMs,
          usage: improved.telemetry.usage,
          candidateScore: improved.telemetry.scoreAfter?.total ?? null,
          candidateDelta: improved.telemetry.scoreDelta,
          similarity: improved.telemetry.similarity,
          errorCode: improved.telemetry.errorCode,
        },
        final: {
          responseChars: improved.response.length,
          responseSha256: sha256(improved.response),
          score: finalScore.total,
          appliedDelta: finalScore.total - scoreBefore.total,
          acceptedBehavior: behavior,
        },
      });
    }

    stage = 'post-call-observation';
    const [postOllama, postGpu, postCompute] = await Promise.all([
      observeOllama(baseUrl), observeGpu(), observeComputeApps(),
    ]);
    const loaded = postOllama.loaded.find(model => model.name === MODEL);
    assert(loaded, 'pinned model was not resident after A/B');
    assert(postOllama.loaded.length === 1, 'another model became resident during A/B');
    assert(loaded.digestSha256 === DIGEST, 'resident model digest drifted');
    assert(loaded.contextWindowTokens === NUM_CTX, 'resident model context drifted');
    const residencyPercent = (loaded.sizeVramBytes / loaded.sizeBytes) * 100;
    assert(residencyPercent >= 100, 'model was not fully GPU resident');
    assert(postGpu.freeMiB >= MINIMUM_HEADROOM_MIB, 'post-call GPU headroom is unsafe');
    assert(postCompute.some(item => /ollama/i.test(item.processName)), 'Ollama compute was not observed');

    stage = 'gpu-monitor-stop';
    const samples = await monitor.stop();
    monitor = null;
    const minimumFreeMiB = Math.min(...samples.map(sample => sample.freeMiB));
    assert(minimumFreeMiB >= MINIMUM_HEADROOM_MIB, 'monitored GPU headroom is unsafe');

    stage = 'natural-restore';
    const naturalRestore = await waitForNaturalRestore(baseUrl, beforeGpu);
    const attempted = cases.filter(item => item.refinement.attempted);
    const accepted = attempted.filter(item => item.refinement.accepted);
    const rejected = attempted.filter(item => !item.refinement.accepted);
    const baselineLatencies = cases.map(item => item.baseline.latencyMs);
    const refinementLatencies = attempted.map(item => item.refinement.latencyMs);
    const finalLatencies = cases.map(item => (
      item.baseline.latencyMs + item.refinement.latencyMs
    ));
    const baselineTokens = summarizeTokens(cases.map(item => item.baseline.usage));
    const refinementTokens = summarizeTokens(attempted.map(item => item.refinement.usage));
    const appliedDeltas = cases.map(item => item.final.appliedDelta);

    assert(accepted.length >= 1, 'fixed corpus produced no accepted refinement');
    assert(rejected.length >= 1, 'fixed corpus produced no rejected refinement');
    assert(cases.every(item => item.final.acceptedBehavior.pass), 'final output violated a corpus behavior');
    assert(!attempted.some(item => item.refinement.errorCode), 'refinement had a provider error');

    report.measurements = {
      cases,
      summary: {
        corpusCases: cases.length,
        attemptedRefinements: attempted.length,
        acceptedRefinements: accepted.length,
        rejectedRefinements: rejected.length,
        acceptanceRate: attempted.length > 0 ? accepted.length / attempted.length : 0,
        meanAppliedScoreDelta: appliedDeltas.reduce((sum, value) => sum + value, 0) / cases.length,
        baselineLatency: summarizeLatencies(baselineLatencies),
        refinementLatency: summarizeLatencies(refinementLatencies),
        finalLatency: summarizeLatencies(finalLatencies),
        baselineTokens,
        refinementTokens,
        totalTokens: {
          promptTokens: baselineTokens.promptTokens + refinementTokens.promptTokens,
          outputTokens: baselineTokens.outputTokens + refinementTokens.outputTokens,
        },
      },
      gpu: {
        sampleCount: samples.length,
        minimumFreeMiB,
        peakUsedMiB: Math.max(...samples.map(sample => sample.usedMiB)),
        postCall: postGpu,
        residencyPercent,
      },
      wire: boundary.wire,
      naturalRestore,
      explicitAdministrativeActions: [],
      modelLeftResident: false,
    };
    report.verdict = 'PASS';
    report.endedAt = new Date().toISOString();
    boundary.restore();
    boundary = null;
    await persistReport();
    console.log(`PASS: accepted=${accepted.length} rejected=${rejected.length} rate=${report.measurements.summary.acceptanceRate}`);
    console.log(`PASS: meanDelta=${report.measurements.summary.meanAppliedScoreDelta} p95=${report.measurements.summary.finalLatency.p95Ms}ms`);
    console.log(`PASS: restoredFree=${naturalRestore.gpu.freeMiB}MiB after ${naturalRestore.elapsedMs}ms`);
    console.log(`ARTIFACT: ${reportPath}`);
    return 0;
  } catch (error) {
    if (monitor) {
      try { await monitor.stop(); } catch { /* preserve primary error */ }
      monitor = null;
    }
    if (boundary) {
      boundary.restore();
      boundary = null;
    }
    let restoration = null;
    if (providerEffectStarted && beforeGpu) {
      try { restoration = await waitForNaturalRestore(baseUrl, beforeGpu); } catch (restoreError) {
        restoration = { errorCode: restoreError.code || 'M1_QUALITY_RESTORE_FAILED' };
      }
    }
    report.verdict = 'FAIL';
    report.endedAt = new Date().toISOString();
    report.failure = {
      stage,
      code: error.code || 'M1_QUALITY_GPU_AB_FAILED',
      messageHash: sha256(error.message || String(error)),
      restoration,
    };
    await persistReport();
    console.error(`FAIL: ${stage}: ${error.code || error.message}`);
    console.error(`ARTIFACT: ${reportPath}`);
    return 1;
  }
}

process.exitCode = await main();
