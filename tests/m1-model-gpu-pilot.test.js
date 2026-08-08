#!/usr/bin/env node

// WP-M1-MODEL registered T3 pilot.
//
// This suite is intentionally stricter than a normal model test. It is the
// only B3 path allowed to touch the shared local Ollama/GPU, and it does so
// only after proving that the pinned model is already installed, no model is
// resident, no compute process owns the GPU, and the required headroom exists.
// It never pulls, deletes, stops, unloads, or rebinds a model.

import './helpers/isolated-test-db.js';

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

import { AbortSource, abortWithReason } from '../src/core/abort-error.js';
import { config } from '../src/config.js';
import { createAuthToken, LLMCallerRole } from '../src/llm/auth-types.js';
import { executeM1ModelRequest } from '../src/llm/cre-bridge.js';
import { llmGateway } from '../src/llm/gateway.js';

const execFileAsync = promisify(execFile);
const EXIT_BLOCKED = 2;
const SUITE_ID = 'IS-T3-TESTS-M1-MODEL-GPU-PILOT-TEST';
const MODEL = 'qwen3.5:27b';
const MODEL_DIGEST = '7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e';
const NUM_CTX = 8192;
const MINIMUM_FREE_VRAM_MIB = 20128;
const MINIMUM_HEADROOM_MIB = 1024;
const SAMPLE_INTERVAL_MS = 100;
const PROVIDER_TIMEOUT_MS = 45000;
const NATURAL_RESTORE_TIMEOUT_MS = 420000;
const NATURAL_RESTORE_POLL_MS = 5000;
const GENERATION_OBSERVATION_TIMEOUT_MS = 10000;
const GENERATION_OBSERVATION_POLL_MS = 50;

const requirement = Object.freeze({
  provider: 'ollama',
  model: MODEL,
  digestSha256: MODEL_DIGEST,
  contextWindowTokens: NUM_CTX,
  minimumFreeVramMiB: MINIMUM_FREE_VRAM_MIB,
  parallelRequests: 1,
  minimumHeadroomMiB: MINIMUM_HEADROOM_MIB,
  minimumGpuResidencyPercent: 100,
  fallbackPolicy: 'forbid',
});

let reportPath = null;
let report = null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function normalizeDigest(value) {
  return String(value || '').replace(/^sha256:/, '').toLowerCase();
}

function isLoopbackHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:'
      && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
      && parsed.username === ''
      && parsed.password === ''
      && parsed.pathname.replace(/\/+$/, '') === ''
      && parsed.search === ''
      && parsed.hash === '';
  } catch {
    return false;
  }
}

function parseSingleGpuCsv(stdout) {
  const rows = String(stdout || '')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  assert(rows.length === 1, 'GPU pilot requires exactly one readable NVIDIA GPU');
  const fields = rows[0].split(',').map(value => value.trim());
  assert(fields.length === 6, 'Unexpected nvidia-smi GPU observation shape');
  const [index, totalMiB, usedMiB, freeMiB, utilizationPercent, temperatureC] = fields.map(Number);
  assert(
    [index, totalMiB, usedMiB, freeMiB, utilizationPercent, temperatureC]
      .every(Number.isFinite),
    'nvidia-smi GPU observation contains a non-numeric field',
  );
  assert(index === 0, 'GPU pilot is pinned to the single GPU at index 0');
  assert(totalMiB > 0 && usedMiB >= 0 && freeMiB >= 0, 'Invalid GPU memory observation');
  assert(Math.abs(totalMiB - usedMiB - freeMiB) <= 512, 'GPU memory accounting is inconsistent');
  return Object.freeze({
    index,
    totalMiB,
    usedMiB,
    freeMiB,
    utilizationPercent,
    temperatureC,
  });
}

function parseComputeApps(stdout) {
  return String(stdout || '')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      const fields = line.split(',').map(value => value.trim());
      assert(fields.length === 3, 'Unexpected nvidia-smi compute-process shape');
      const pid = Number(fields[0]);
      const usedMemoryMiB = Number(fields[2]);
      assert(Number.isSafeInteger(pid) && pid > 0, 'Invalid GPU process PID');
      assert(Number.isFinite(usedMemoryMiB) && usedMemoryMiB >= 0, 'Invalid GPU process memory');
      return Object.freeze({ pid, processName: fields[1], usedMemoryMiB });
    });
}

async function observeGpu() {
  const result = await execFileAsync('nvidia-smi', [
    '--query-gpu=index,memory.total,memory.used,memory.free,utilization.gpu,temperature.gpu',
    '--format=csv,noheader,nounits',
  ], {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 64 * 1024,
  });
  return Object.freeze({
    ...parseSingleGpuCsv(result.stdout),
    observedAtMs: Date.now(),
  });
}

async function observeComputeApps() {
  const result = await execFileAsync('nvidia-smi', [
    '--query-compute-apps=pid,process_name,used_memory',
    '--format=csv,noheader,nounits',
  ], {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 64 * 1024,
  });
  return parseComputeApps(result.stdout);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

function installWireBoundary(baseUrl) {
  const originalFetch = globalThis.fetch;
  const expectedOrigin = new URL(baseUrl).origin;
  const records = [];
  const allowed = new Set([
    'GET /api/tags',
    'GET /api/ps',
    'POST /api/chat',
  ]);
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = String(options.method || input?.method || 'GET').toUpperCase();
    const route = `${method} ${url.pathname}`;
    if (url.origin !== expectedOrigin || !allowed.has(route)) {
      const error = new Error('GPU pilot attempted a network request outside its exact loopback routes');
      error.code = 'GPU_PILOT_NETWORK_SCOPE_VIOLATION';
      throw error;
    }
    if (route === 'POST /api/chat') {
      let body;
      try {
        body = JSON.parse(options.body);
      } catch {
        const error = new Error('GPU pilot provider request body was not JSON');
        error.code = 'GPU_PILOT_WIRE_CONTRACT_INVALID';
        throw error;
      }
      if (
        body.model !== MODEL
        || body.stream !== false
        || body.options?.num_ctx !== NUM_CTX
        || Object.hasOwn(body, 'keep_alive')
      ) {
        const error = new Error('GPU pilot provider request violated model/context/lifecycle policy');
        error.code = 'GPU_PILOT_WIRE_CONTRACT_INVALID';
        throw error;
      }
      records.push(Object.freeze({
        method,
        pathname: url.pathname,
        model: body.model,
        numCtx: body.options.num_ctx,
        stream: body.stream,
        format: body.format ?? null,
        hasKeepAlive: Object.hasOwn(body, 'keep_alive'),
      }));
    }
    return originalFetch(input, options);
  };
  return {
    records,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
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
      sizeBytes: Number.isFinite(model.size) ? model.size : null,
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

function validateInitialSafety({ baseUrl, sourceRevision, ollama, gpu, computeApps, concurrency }) {
  const issues = [];
  if (!isLoopbackHttpUrl(baseUrl)) issues.push('provider-not-exact-loopback-http');
  if (!/^[a-f0-9]{40}$/.test(sourceRevision || '')) issues.push('source-revision-unbound');
  const installed = ollama.installed.find(model => model.name === MODEL);
  if (!installed) issues.push('pinned-model-not-installed');
  else if (installed.digestSha256 !== MODEL_DIGEST) issues.push('pinned-model-digest-mismatch');
  if (ollama.loaded.length !== 0) issues.push('gpu-model-already-resident');
  if (computeApps.length !== 0) issues.push('gpu-compute-process-already-active');
  if (gpu.freeMiB < MINIMUM_FREE_VRAM_MIB) issues.push('preload-free-vram-insufficient');
  if (gpu.utilizationPercent > 60) issues.push('gpu-baseline-utilization-too-high');
  if (gpu.totalMiB < MINIMUM_FREE_VRAM_MIB + MINIMUM_HEADROOM_MIB) {
    issues.push('total-vram-insufficient');
  }
  if (concurrency.max !== 1 || concurrency.active !== 0 || concurrency.queued !== 0) {
    issues.push('model-gateway-not-serial-and-idle');
  }
  return issues;
}

function makeRequest(label, purpose, prompt, systemPrompt, parameters = {}) {
  const prefix = `m1-gpu-${label}-${process.pid}`;
  return {
    contract: 'ModelRequest',
    version: 1,
    requestId: `${prefix}-request`,
    conversationId: `${prefix}-conversation`,
    turnId: `${prefix}-turn`,
    callerRole: purpose === 'classify'
      ? LLMCallerRole.WORKFLOW_CLASSIFIER
      : LLMCallerRole.CRE_DECISION,
    modelRole: 'CHAT',
    purpose,
    prompt,
    systemPrompt,
    parameters: {
      temperature: 0,
      num_ctx: NUM_CTX,
      timeout: PROVIDER_TIMEOUT_MS,
      ...parameters,
    },
  };
}

function authorityFor(request) {
  return createAuthToken({
    role: request.callerRole,
    decisionId: request.requestId,
    auditContext: {
      sessionId: request.conversationId,
      stepId: request.turnId,
    },
  });
}

async function executeMeasured(label, request, options = {}) {
  const auditOffset = llmGateway.getAuditLogs(0).length;
  const startedAt = Date.now();
  const result = await executeM1ModelRequest(request, {
    authToken: authorityFor(request),
    signal: options.signal || null,
  });
  const latencyMs = Date.now() - startedAt;
  const audit = llmGateway.getAuditLogs(0).slice(auditOffset).filter(entry => (
    entry.requestId === request.requestId
  ));
  const terminals = audit.filter(entry => entry.event === 'M1_MODEL_RESULT');
  assert(terminals.length === 1, `${label} produced ${terminals.length} terminal audits`);
  assert(terminals[0].status === result.status, `${label} result/audit status mismatch`);
  const vramPreflight = audit.find(entry => entry.event === 'LLM_VRAM_PREFLIGHT_UNKNOWN');
  assert(vramPreflight, `${label} did not preserve the unknown production VRAM preflight`);
  assert(
    vramPreflight.vramReason === 'VRAM_FOOTPRINT_UNKNOWN',
    `${label} reported an unexpected production VRAM preflight reason`,
  );
  return {
    label,
    latencyMs,
    result,
    audit,
    terminal: {
      status: terminals[0].status,
      errorCode: terminals[0].errorCode,
      callerRole: terminals[0].callerRole,
      modelRole: terminals[0].modelRole,
      purpose: terminals[0].purpose,
    },
    productionVramPreflight: {
      state: 'unknown',
      reason: vramPreflight.vramReason,
    },
  };
}

function redactSuccessfulMeasurement(measurement, semanticCheck) {
  const content = measurement.result.response?.content || '';
  return {
    label: measurement.label,
    latencyMs: measurement.latencyMs,
    status: measurement.result.status,
    model: measurement.result.response?.model || null,
    usage: measurement.result.response?.usage || null,
    responseChars: content.length,
    responseSha256: sha256(content),
    semanticCheck,
    terminal: measurement.terminal,
    productionVramPreflight: measurement.productionVramPreflight,
  };
}

function summarizeGpuSamples(samples) {
  assert(samples.length > 0, 'GPU monitor produced no samples');
  return {
    sampleCount: samples.length,
    requestedIntervalMs: SAMPLE_INTERVAL_MS,
    observedSpanMs: samples.at(-1).observedAtMs - samples[0].observedAtMs,
    averageObservedIntervalMs: samples.length > 1
      ? (samples.at(-1).observedAtMs - samples[0].observedAtMs) / (samples.length - 1)
      : null,
    peakUsedMiB: Math.max(...samples.map(sample => sample.usedMiB)),
    minimumFreeMiB: Math.min(...samples.map(sample => sample.freeMiB)),
    peakUtilizationPercent: Math.max(...samples.map(sample => sample.utilizationPercent)),
    peakTemperatureC: Math.max(...samples.map(sample => sample.temperatureC)),
  };
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
        errors.push(error.message || String(error));
      }
      if (!stopping) await new Promise(resolve => setTimeout(resolve, SAMPLE_INTERVAL_MS));
    }
  })();
  return {
    async stop() {
      stopping = true;
      await pending;
      if (errors.length > 0) {
        throw new Error(`GPU monitor lost ${errors.length} sample(s): ${errors[0]}`);
      }
      return samples;
    },
  };
}

async function waitForObservedGeneration(wireBoundary, beforeGpu) {
  const startedAt = Date.now();
  const utilizationThreshold = Math.max(80, beforeGpu.utilizationPercent + 30);
  while (Date.now() - startedAt < GENERATION_OBSERVATION_TIMEOUT_MS) {
    if (wireBoundary.records.length >= 4) {
      const [gpu, computeApps] = await Promise.all([
        observeGpu(),
        observeComputeApps(),
      ]);
      const ollamaComputeActive = computeApps.some(app => /ollama/i.test(app.processName));
      if (ollamaComputeActive && gpu.utilizationPercent >= utilizationThreshold) {
        return {
          trigger: 'observed-ollama-gpu-generation',
          elapsedMs: Date.now() - startedAt,
          utilizationThreshold,
          gpu,
          computeProcessCount: computeApps.length,
        };
      }
    }
    await new Promise(resolve => setTimeout(resolve, GENERATION_OBSERVATION_POLL_MS));
  }
  const error = new Error('GPU generation activity was not observed before cancellation deadline');
  error.code = 'GPU_PILOT_GENERATION_NOT_OBSERVED';
  throw error;
}

async function waitForNaturalRestoration(baseUrl, beforeGpu) {
  const startedAt = Date.now();
  let pollCount = 0;
  let lastObservation = null;
  while (Date.now() - startedAt < NATURAL_RESTORE_TIMEOUT_MS) {
    const [ollama, gpu, computeApps] = await Promise.all([
      observeOllama(baseUrl),
      observeGpu(),
      observeComputeApps(),
    ]);
    pollCount += 1;
    lastObservation = {
      loadedModels: ollama.loaded.map(model => model.name),
      gpu,
      computeProcessCount: computeApps.length,
    };
    const gpuMemoryRestored = gpu.usedMiB <= beforeGpu.usedMiB + MINIMUM_HEADROOM_MIB;
    if (ollama.loaded.length === 0 && computeApps.length === 0 && gpuMemoryRestored) {
      return {
        elapsedMs: Date.now() - startedAt,
        pollCount,
        loadedModels: [],
        computeProcessCount: 0,
        gpu,
      };
    }
    await new Promise(resolve => setTimeout(resolve, NATURAL_RESTORE_POLL_MS));
  }
  const error = new Error('shared GPU state did not restore through natural Ollama expiry');
  error.code = 'GPU_PILOT_STATE_NOT_RESTORED';
  error.lastObservation = lastObservation;
  throw error;
}

async function prepareArtifactPath() {
  const root = process.env.INTENTSMITH_TEST_ARTIFACT_DIR;
  assert(typeof root === 'string' && path.isAbsolute(root), 'owned artifact root is required');
  assert(
    root.split(path.sep).includes('.intentsmith-artifacts'),
    'artifact root must be inside .intentsmith-artifacts',
  );
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const metadata = await lstat(root);
  assert(metadata.isDirectory() && !metadata.isSymbolicLink(), 'artifact root must be a real directory');
  assert((metadata.mode & 0o077) === 0, 'artifact root must be private');
  const canonical = await realpath(root);
  assert(
    canonical.split(path.sep).includes('.intentsmith-artifacts'),
    'canonical artifact root escaped .intentsmith-artifacts',
  );
  return path.join(canonical, 'm1-model-gpu-pilot.json');
}

async function persistReport() {
  if (!reportPath || !report) return;
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  await chmod(reportPath, 0o600);
}

async function selfCheck() {
  assert(isLoopbackHttpUrl('http://127.0.0.1:11434'), 'IPv4 loopback must pass');
  assert(isLoopbackHttpUrl('http://localhost:11434'), 'localhost must pass');
  assert(!isLoopbackHttpUrl('https://127.0.0.1:11434'), 'TLS origin must fail exact fixture');
  assert(!isLoopbackHttpUrl('http://example.com:11434'), 'external origin must fail');
  assert(normalizeDigest(`sha256:${MODEL_DIGEST}`) === MODEL_DIGEST, 'digest normalization failed');
  const gpu = parseSingleGpuCsv('0, 24576, 1000, 23576, 12, 44\n');
  assert(gpu.freeMiB === 23576 && gpu.usedMiB === 1000, 'GPU parser changed values');
  const apps = parseComputeApps('1234, /usr/bin/ollama, 18000\n');
  assert(apps.length === 1 && apps[0].pid === 1234, 'GPU process parser failed');
  const safeIssues = validateInitialSafety({
    baseUrl: 'http://127.0.0.1:11434',
    sourceRevision: 'a'.repeat(40),
    ollama: {
      installed: [{ name: MODEL, digestSha256: MODEL_DIGEST }],
      loaded: [],
    },
    gpu,
    computeApps: [],
    concurrency: { max: 1, active: 0, queued: 0 },
  });
  assert(safeIssues.length === 0, `safe fixture rejected: ${safeIssues.join(',')}`);
  const unsafeIssues = validateInitialSafety({
    baseUrl: 'http://example.com:11434',
    sourceRevision: 'bad',
    ollama: {
      installed: [{ name: MODEL, digestSha256: 'b'.repeat(64) }],
      loaded: [{ name: MODEL }],
    },
    gpu: { ...gpu, freeMiB: 100 },
    computeApps: [{ pid: 7 }],
    concurrency: { max: 2, active: 1, queued: 1 },
  });
  assert(unsafeIssues.length === 7, `unsafe fixture did not fail closed: ${unsafeIssues.join(',')}`);

  const hostFetch = globalThis.fetch;
  const fakeFetch = async () => ({ ok: true });
  globalThis.fetch = fakeFetch;
  const boundary = installWireBoundary('http://127.0.0.1:11434');
  try {
    await globalThis.fetch('http://127.0.0.1:11434/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        options: { num_ctx: NUM_CTX },
      }),
    });
    assert(boundary.records.length === 1, 'wire boundary did not record the provider attempt');
    let blockedError = null;
    try {
      await globalThis.fetch('http://example.com/api/chat', {
        method: 'POST',
        body: '{}',
      });
    } catch (error) {
      blockedError = error;
    }
    assert(
      blockedError?.code === 'GPU_PILOT_NETWORK_SCOPE_VIOLATION',
      'wire boundary did not reject an external origin',
    );
    for (const [label, url, body, expectedCode] of [
      ['pull', 'http://127.0.0.1:11434/api/pull', {}, 'GPU_PILOT_NETWORK_SCOPE_VIOLATION'],
      ['delete', 'http://127.0.0.1:11434/api/delete', {}, 'GPU_PILOT_NETWORK_SCOPE_VIOLATION'],
      ['keep-alive', 'http://127.0.0.1:11434/api/chat', {
        model: MODEL, stream: false, keep_alive: 0, options: { num_ctx: NUM_CTX },
      }, 'GPU_PILOT_WIRE_CONTRACT_INVALID'],
      ['wrong-model', 'http://127.0.0.1:11434/api/chat', {
        model: 'other:1b', stream: false, options: { num_ctx: NUM_CTX },
      }, 'GPU_PILOT_WIRE_CONTRACT_INVALID'],
      ['wrong-context', 'http://127.0.0.1:11434/api/chat', {
        model: MODEL, stream: false, options: { num_ctx: 4096 },
      }, 'GPU_PILOT_WIRE_CONTRACT_INVALID'],
      ['streaming', 'http://127.0.0.1:11434/api/chat', {
        model: MODEL, stream: true, options: { num_ctx: NUM_CTX },
      }, 'GPU_PILOT_WIRE_CONTRACT_INVALID'],
    ]) {
      let error = null;
      try {
        await globalThis.fetch(url, { method: 'POST', body: JSON.stringify(body) });
      } catch (caught) {
        error = caught;
      }
      assert(error?.code === expectedCode, `${label} wire mutation was not rejected`);
    }
  } finally {
    boundary.restore();
    globalThis.fetch = hostFetch;
  }
  console.log('SELF_CHECK_PASS: M1 GPU pilot performs no provider or GPU effect in self-check mode');
}

async function main() {
  if (process.argv.includes('--self-check')) {
    await selfCheck();
    return 0;
  }

  const startedAt = new Date().toISOString();
  const sourceRevision = process.env.INTENTSMITH_TEST_SOURCE_REVISION || '';
  const baseUrl = config.ollama?.baseUrl || 'http://127.0.0.1:11434';
  const registry = JSON.parse(await readFile(path.join(process.cwd(), 'tests/registry.json'), 'utf8'));
  const registryFingerprint = sha256(JSON.stringify(registry));
  const registryEntry = registry.suites?.find(suite => suite.id === SUITE_ID);
  assert(registryEntry?.path === 'tests/m1-model-gpu-pilot.test.js', 'GPU pilot registry entry is missing');
  assert(
    registryEntry.requirements?.ollama === true
      && registryEntry.requirements?.gpu === true
      && registryEntry.requirements?.network === 'loopback',
    'GPU pilot registry prerequisites are incomplete',
  );
  reportPath = await prepareArtifactPath();
  report = {
    schemaVersion: 1,
    suiteId: SUITE_ID,
    sourceRevision,
    registryFingerprint,
    startedAt,
    endedAt: null,
    verdict: 'RUNNING',
    requirement,
    safety: null,
    measurements: null,
    failure: null,
  };

  let monitor = null;
  let wireBoundary = null;
  let providerEffectStarted = false;
  let stage = 'preflight';
  try {
    const staticIssues = [];
    if (process.env.C3_AUDIT_RUN !== '1') staticIssues.push('audit-run-boundary-missing');
    if (baseUrl !== 'http://127.0.0.1:11434') staticIssues.push('provider-not-exact-loopback-http');
    if (!/^[a-f0-9]{40}$/.test(sourceRevision)) staticIssues.push('source-revision-unbound');
    if (staticIssues.length > 0) {
      report.safety = { baseUrl, issues: staticIssues };
      report.verdict = 'BLOCKED';
      report.failure = { code: 'GPU_PILOT_PREREQUISITE_BLOCKED', issues: staticIssues };
      report.endedAt = new Date().toISOString();
      await persistReport();
      console.error(`BLOCKED: ${staticIssues.join(', ')}`);
      return EXIT_BLOCKED;
    }

    wireBoundary = installWireBoundary(baseUrl);
    const [initialOllama, beforeGpu, computeApps] = await Promise.all([
      observeOllama(baseUrl),
      observeGpu(),
      observeComputeApps(),
    ]);
    const concurrency = llmGateway.getConcurrencyStats();
    const issues = validateInitialSafety({
      baseUrl,
      sourceRevision,
      ollama: initialOllama,
      gpu: beforeGpu,
      computeApps,
      concurrency,
    });
    report.safety = {
      baseUrl,
      initialLoadedModels: initialOllama.loaded.map(model => model.name),
      pinnedModelInstalled: initialOllama.installed.some(model => (
        model.name === MODEL && model.digestSha256 === MODEL_DIGEST
      )),
      initialComputeProcessCount: computeApps.length,
      gatewayConcurrency: concurrency,
      beforeGpu,
      issues,
    };
    if (issues.length > 0) {
      report.verdict = 'BLOCKED';
      report.failure = { code: 'GPU_PILOT_PREREQUISITE_BLOCKED', issues };
      report.endedAt = new Date().toISOString();
      wireBoundary.restore();
      wireBoundary = null;
      await persistReport();
      console.error(`BLOCKED: ${issues.join(', ')}`);
      return EXIT_BLOCKED;
    }

    stage = 'gpu-monitor-start';
    monitor = startGpuMonitor();

    stage = 'cold-answer';
    const coldRequest = makeRequest(
      'cold-answer',
      'answer',
      'Return exactly this token and nothing else: M1_GPU_OK',
      'Follow the output format exactly. Do not explain.',
      { maxTokens: 32 },
    );
    providerEffectStarted = true;
    const cold = await executeMeasured('cold-answer', coldRequest);
    assert(cold.result.status === 'ok', `cold answer ended ${cold.result.status}`);
    assert(cold.result.response.model === MODEL, 'cold answer used a different model');
    const coldContent = cold.result.response.content.trim();
    assert(coldContent === 'M1_GPU_OK', 'cold answer violated the exact response contract');

    stage = 'cold-allocation-observation';
    const afterColdOllama = await observeOllama(baseUrl);
    const loadedAfterCold = afterColdOllama.loaded.find(model => model.name === MODEL);
    assert(loadedAfterCold, 'pinned model did not become resident after the cold call');
    assert(loadedAfterCold.digestSha256 === MODEL_DIGEST, 'resident model digest changed');
    assert(loadedAfterCold.contextWindowTokens === NUM_CTX, 'resident model context differs from request');
    assert(loadedAfterCold.sizeBytes > 0 && loadedAfterCold.sizeVramBytes > 0, 'resident allocation missing');
    const residencyPercent = (loadedAfterCold.sizeVramBytes / loadedAfterCold.sizeBytes) * 100;
    assert(residencyPercent + Number.EPSILON >= 100, 'model is not fully GPU resident');

    stage = 'warm-answer';
    const warmRequest = makeRequest(
      'warm-answer',
      'answer',
      'Compute 17 multiplied by 23. Return only the decimal integer.',
      'Return only the requested decimal integer.',
      { maxTokens: 32 },
    );
    const warm = await executeMeasured('warm-answer', warmRequest);
    assert(warm.result.status === 'ok', `warm answer ended ${warm.result.status}`);
    assert(warm.result.response.model === MODEL, 'warm answer used a different model');
    assert(warm.result.response.content.trim() === '391', 'warm answer was not exactly 391');

    stage = 'classification';
    const classifyRequest = makeRequest(
      'classification',
      'classify',
      'Classify this request: "Write a Python function that sorts integers."',
      'Return exactly one JSON object with one key named label. Allowed label: code.',
      { format: 'json', maxTokens: 64 },
    );
    const classification = await executeMeasured('classification', classifyRequest);
    assert(classification.result.status === 'ok', `classification ended ${classification.result.status}`);
    assert(classification.result.response.model === MODEL, 'classification used a different model');
    let parsedClassification;
    try {
      parsedClassification = JSON.parse(classification.result.response.content);
    } catch {
      throw Object.assign(new Error('classification returned malformed JSON'), {
        code: 'GPU_PILOT_CLASSIFICATION_MALFORMED',
      });
    }
    assert(
      JSON.stringify(Object.keys(parsedClassification).sort()) === JSON.stringify(['label']),
      'classification returned extra or missing keys',
    );
    assert(parsedClassification.label === 'code', 'classification label is not code');

    stage = 'mid-generation-cancel';
    const cancelController = new AbortController();
    const cancelRequest = makeRequest(
      'mid-generation-cancel',
      'answer',
      'Write 1500 numbered, distinct sentences about software architecture. Do not stop early.',
      'Produce the full requested long response.',
      { maxTokens: 2000 },
    );
    const cancelPending = executeMeasured('mid-generation-cancel', cancelRequest, {
      signal: cancelController.signal,
    }).then(
      measurement => ({ ok: true, measurement }),
      error => ({ ok: false, error }),
    );
    const generationPending = waitForObservedGeneration(wireBoundary, beforeGpu).then(
      trigger => ({ kind: 'generation-observed', trigger }),
      error => ({ kind: 'generation-observation-failed', error }),
    );
    const firstCancelEvent = await Promise.race([
      generationPending,
      cancelPending.then(outcome => ({ kind: 'provider-settled', outcome })),
    ]);
    if (firstCancelEvent.kind !== 'generation-observed') {
      abortWithReason(
        cancelController,
        AbortSource.USER,
        'M1 GPU pilot cancellation after failed generation observation',
      );
      const settled = firstCancelEvent.kind === 'provider-settled'
        ? firstCancelEvent.outcome
        : await cancelPending;
      if (firstCancelEvent.kind === 'provider-settled' && !settled.ok) {
        throw settled.error;
      }
      if (firstCancelEvent.kind === 'generation-observation-failed') {
        throw firstCancelEvent.error;
      }
      const error = new Error('provider settled before mid-generation cancellation was observed');
      error.code = 'GPU_PILOT_PROVIDER_SETTLED_BEFORE_CANCEL';
      throw error;
    }
    const generationTrigger = firstCancelEvent.trigger;
    abortWithReason(
      cancelController,
      AbortSource.USER,
      'M1 GPU pilot mid-generation cancellation',
    );
    const cancelOutcome = await cancelPending;
    if (!cancelOutcome.ok) throw cancelOutcome.error;
    const cancelled = cancelOutcome.measurement;
    assert(cancelled.result.status === 'cancelled', `cancel request ended ${cancelled.result.status}`);
    assert(
      cancelled.audit.some(entry => entry.event === 'LLM_CALL_CANCELLED' && entry.preflight !== true),
      'cancel did not reach the active provider call',
    );
    assert(
      !cancelled.audit.some(entry => entry.event === 'LLM_CALL_COMPLETE'),
      'cancelled request emitted a success audit',
    );

    stage = 'post-run-observation';
    const samples = await monitor.stop();
    monitor = null;
    const [postCallGpu, postCallOllama, postCallComputeApps] = await Promise.all([
      observeGpu(),
      observeOllama(baseUrl),
      observeComputeApps(),
    ]);
    const postCallLoaded = postCallOllama.loaded.find(model => model.name === MODEL);
    assert(postCallLoaded, 'pinned model was unexpectedly unloaded before allocation evidence');
    assert(postCallLoaded.contextWindowTokens === NUM_CTX, 'post-call context changed');
    assert(postCallLoaded.digestSha256 === MODEL_DIGEST, 'post-call model digest changed');
    assert(postCallGpu.freeMiB >= MINIMUM_HEADROOM_MIB, 'post-call GPU headroom is unsafe');
    assert(
      postCallComputeApps.every(app => /ollama/i.test(app.processName)),
      'an unrelated compute process appeared during the pilot',
    );

    const gpuSummary = summarizeGpuSamples(samples);
    assert(
      gpuSummary.peakUsedMiB > beforeGpu.usedMiB + 1000,
      'GPU monitor did not observe the model allocation',
    );

    stage = 'natural-gpu-restoration';
    const restoration = await waitForNaturalRestoration(baseUrl, beforeGpu);
    assert(wireBoundary.records.length === 4, 'GPU pilot did not make exactly four provider attempts');

    report.measurements = {
      coldAnswer: redactSuccessfulMeasurement(cold, coldContent === 'M1_GPU_OK'),
      warmAnswer: redactSuccessfulMeasurement(warm, warm.result.response.content.trim() === '391'),
      classification: redactSuccessfulMeasurement(
        classification,
        parsedClassification.label === 'code',
      ),
      cancellation: {
        label: cancelled.label,
        latencyMs: cancelled.latencyMs,
        status: cancelled.result.status,
        terminal: cancelled.terminal,
        reachedActiveProvider: true,
        trigger: generationTrigger,
        emittedSuccessAudit: false,
        productionVramPreflight: cancelled.productionVramPreflight,
      },
      modelAllocation: {
        model: postCallLoaded.name,
        digestSha256: postCallLoaded.digestSha256,
        contextWindowTokens: postCallLoaded.contextWindowTokens,
        sizeBytes: postCallLoaded.sizeBytes,
        sizeVramBytes: postCallLoaded.sizeVramBytes,
        residencyPercent: (postCallLoaded.sizeVramBytes / postCallLoaded.sizeBytes) * 100,
      },
      gpu: {
        before: beforeGpu,
        peak: gpuSummary,
        afterProvider: postCallGpu,
        restored: restoration.gpu,
      },
      naturalRestoration: restoration,
      wire: wireBoundary.records,
      modelLeftResident: false,
      explicitAdministrativeActions: [],
    };
    wireBoundary.restore();
    wireBoundary = null;
    report.verdict = 'PASS';
    report.endedAt = new Date().toISOString();
    await persistReport();

    console.log(`PASS: cold=${cold.latencyMs}ms warm=${warm.latencyMs}ms classify=${classification.latencyMs}ms`);
    console.log(`PASS: cancel=${cancelled.latencyMs}ms peak=${gpuSummary.peakUsedMiB}MiB restoredFree=${restoration.gpu.freeMiB}MiB`);
    console.log(`PASS: shared GPU state restored naturally after ${restoration.elapsedMs}ms`);
    console.log(`ARTIFACT: ${reportPath}`);
    return 0;
  } catch (error) {
    const failureStage = stage;
    if (wireBoundary) {
      wireBoundary.restore();
      wireBoundary = null;
    }
    if (monitor) {
      try {
        await monitor.stop();
      } catch (monitorError) {
        error.monitorError = monitorError.message || String(monitorError);
      }
    }
    let failureRestoration = null;
    let restorationError = null;
    if (providerEffectStarted && failureStage !== 'natural-gpu-restoration') {
      try {
        failureRestoration = await waitForNaturalRestoration(baseUrl, report.safety.beforeGpu);
      } catch (cleanupError) {
        restorationError = cleanupError;
      }
    }
    report.verdict = 'FAIL';
    report.endedAt = new Date().toISOString();
    const originalSafeCode = typeof error.code === 'string' && /^[A-Z0-9_]{3,80}$/.test(error.code)
      ? error.code
      : 'GPU_PILOT_FAILED';
    report.failure = {
      code: restorationError ? 'GPU_PILOT_STATE_NOT_RESTORED' : originalSafeCode,
      stage: failureStage,
      diagnosticSha256: sha256(error.message || String(error)),
      ...(restorationError
        ? { restorationDiagnosticSha256: sha256(restorationError.message || String(restorationError)) }
        : {}),
      ...(error.monitorError
        ? { monitorDiagnosticSha256: sha256(error.monitorError) }
        : {}),
    };
    report.failureRestoration = failureRestoration;
    report.unrestoredState = restorationError?.lastObservation
      || error.lastObservation
      || null;
    await persistReport();
    console.error(`FAIL: ${report.failure.code} at ${failureStage}`);
    return 1;
  }
}

const exitCode = await main();
process.exitCode = exitCode;
