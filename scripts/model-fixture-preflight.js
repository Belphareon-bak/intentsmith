import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MIB = 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REQUIRED_FIELDS = [
  'provider',
  'model',
  'digestSha256',
  'contextWindowTokens',
  'minimumFreeVramMiB',
  'parallelRequests',
  'minimumHeadroomMiB',
  'minimumGpuResidencyPercent',
  'fallbackPolicy',
];

export function validateModelFixtureRequirement(value, label = 'modelFixture') {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${label} must be an object`];
  }

  const fields = Object.keys(value).sort();
  const expectedFields = [...REQUIRED_FIELDS].sort();
  if (JSON.stringify(fields) !== JSON.stringify(expectedFields)) {
    errors.push(`${label} fields must equal ${REQUIRED_FIELDS.join(', ')}`);
  }
  if (value.provider !== 'ollama') {
    errors.push(`${label}.provider must equal ollama`);
  }
  if (
    typeof value.model !== 'string'
    || !/^[a-z0-9][a-z0-9._/-]*:[a-z0-9][a-z0-9._-]*$/i.test(value.model)
    || /:latest$/i.test(value.model)
  ) {
    errors.push(`${label}.model must be an explicit non-latest model tag`);
  }
  if (!SHA256_PATTERN.test(value.digestSha256 || '')) {
    errors.push(`${label}.digestSha256 must be a lowercase 64-character SHA-256`);
  }
  if (!isPositiveInteger(value.contextWindowTokens)) {
    errors.push(`${label}.contextWindowTokens must be a positive integer`);
  }
  if (!isPositiveInteger(value.minimumFreeVramMiB)) {
    errors.push(`${label}.minimumFreeVramMiB must be a positive integer`);
  }
  if (!isPositiveInteger(value.parallelRequests)) {
    errors.push(`${label}.parallelRequests must be a positive integer`);
  }
  if (!isPositiveInteger(value.minimumHeadroomMiB)) {
    errors.push(`${label}.minimumHeadroomMiB must be a positive integer`);
  }
  if (
    isPositiveInteger(value.minimumHeadroomMiB)
    && isPositiveInteger(value.minimumFreeVramMiB)
    && value.minimumHeadroomMiB >= value.minimumFreeVramMiB
  ) {
    errors.push(`${label}.minimumHeadroomMiB must be less than minimumFreeVramMiB`);
  }
  if (
    !Number.isInteger(value.minimumGpuResidencyPercent)
    || value.minimumGpuResidencyPercent < 1
    || value.minimumGpuResidencyPercent > 100
  ) {
    errors.push(`${label}.minimumGpuResidencyPercent must be an integer from 1 to 100`);
  }
  if (value.fallbackPolicy !== 'forbid') {
    errors.push(`${label}.fallbackPolicy must equal forbid`);
  }
  return errors;
}

export function evaluateModelFixturePreflight(requirement, observation) {
  const requirementErrors = validateModelFixtureRequirement(requirement);
  if (requirementErrors.length > 0) {
    return preflightResult(requirement, observation, requirementErrors.map(message => ({
      code: 'invalid-requirement',
      message,
    })));
  }

  const issues = [];
  if (!observation || typeof observation !== 'object') {
    issues.push(issue('missing-observation', 'model fixture observation is missing'));
    return preflightResult(requirement, observation, issues);
  }
  if (observation.provider !== requirement.provider) {
    issues.push(issue(
      'provider-mismatch',
      `expected provider ${requirement.provider}, got ${display(observation.provider)}`,
    ));
  }

  const installed = observation.installedModel;
  if (!installed) {
    issues.push(issue('model-not-installed', `model ${requirement.model} is not installed`));
  } else {
    compareModelIdentity(requirement, installed, 'installed', issues);
  }

  const loaded = observation.loadedModel;
  if (!loaded) {
    issues.push(issue('model-not-loaded', `model ${requirement.model} is not loaded`));
  } else {
    compareModelIdentity(requirement, loaded, 'loaded', issues);
    const expectedAllocatedContextTokens = (
      requirement.contextWindowTokens * requirement.parallelRequests
    );
    if (loaded.allocatedContextTokens !== expectedAllocatedContextTokens) {
      issues.push(issue(
        'context-concurrency-mismatch',
        `expected allocated context ${expectedAllocatedContextTokens} `
          + `(${requirement.contextWindowTokens} x ${requirement.parallelRequests}), `
          + `got ${display(loaded.allocatedContextTokens)}`,
      ));
    }
    if (!isPositiveNumber(loaded.sizeBytes) || !isPositiveNumber(loaded.sizeVramBytes)) {
      issues.push(issue(
        'invalid-model-allocation',
        'loaded model size and GPU allocation must be positive numbers',
      ));
    } else {
      const residencyPercent = (loaded.sizeVramBytes / loaded.sizeBytes) * 100;
      if (residencyPercent > 100 + Number.EPSILON) {
        issues.push(issue(
          'invalid-model-allocation',
          'loaded GPU allocation exceeds total model allocation',
        ));
      } else if (
        residencyPercent + Number.EPSILON
        < requirement.minimumGpuResidencyPercent
      ) {
        issues.push(issue(
          'gpu-residency-insufficient',
          `GPU residency ${residencyPercent.toFixed(2)}% is below `
            + `${requirement.minimumGpuResidencyPercent}%`,
        ));
      }
    }
  }

  const gpu = observation.gpu;
  if (
    !gpu
    || !isPositiveNumber(gpu.totalVramMiB)
    || !Number.isFinite(gpu.freeVramMiB)
    || gpu.freeVramMiB < 0
    || gpu.freeVramMiB > gpu.totalVramMiB
  ) {
    issues.push(issue('invalid-gpu-observation', 'GPU total/free VRAM observation is invalid'));
  } else {
    if (gpu.freeVramMiB < requirement.minimumHeadroomMiB) {
      issues.push(issue(
        'vram-headroom-insufficient',
        `free VRAM ${gpu.freeVramMiB} MiB is below `
          + `${requirement.minimumHeadroomMiB} MiB`,
      ));
    }
    const loadedVramMiB = isPositiveNumber(loaded?.sizeVramBytes)
      ? loaded.sizeVramBytes / MIB
      : 0;
    const equivalentPreloadFreeVramMiB = gpu.freeVramMiB + loadedVramMiB;
    if (equivalentPreloadFreeVramMiB > gpu.totalVramMiB + 1) {
      issues.push(issue(
        'invalid-vram-accounting',
        'free VRAM plus loaded model allocation exceeds total VRAM',
      ));
    }
    if (equivalentPreloadFreeVramMiB < requirement.minimumFreeVramMiB) {
      issues.push(issue(
        'free-vram-insufficient',
        `equivalent pre-load free VRAM ${equivalentPreloadFreeVramMiB.toFixed(0)} MiB `
          + `is below ${requirement.minimumFreeVramMiB} MiB`,
      ));
    }
  }

  return preflightResult(requirement, observation, issues);
}

export async function probeModelFixture(requirement, options = {}) {
  const requirementErrors = validateModelFixtureRequirement(requirement);
  if (requirementErrors.length > 0) {
    return preflightResult(requirement, null, requirementErrors.map(message => ({
      code: 'invalid-requirement',
      message,
    })));
  }

  const ollamaUrl = options.ollamaUrl || 'http://127.0.0.1:11434';
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const execImpl = options.execFileImpl || execFileAsync;
  try {
    const [tags, running, gpu] = await Promise.all([
      fetchJson(fetchImpl, `${ollamaUrl}/api/tags`),
      fetchJson(fetchImpl, `${ollamaUrl}/api/ps`),
      inspectSingleNvidiaGpu(execImpl),
    ]);
    const installed = (tags.models || []).find(model => model.name === requirement.model);
    const loaded = (running.models || []).find(model => model.name === requirement.model);
    const observation = {
      provider: 'ollama',
      installedModel: installed ? {
        model: installed.name,
        digestSha256: normalizeDigest(installed.digest),
      } : null,
      loadedModel: loaded ? {
        model: loaded.name,
        digestSha256: normalizeDigest(loaded.digest),
        allocatedContextTokens: loaded.context_length,
        sizeBytes: loaded.size,
        sizeVramBytes: loaded.size_vram,
      } : null,
      gpu,
    };
    return evaluateModelFixturePreflight(requirement, observation);
  } catch (error) {
    return preflightResult(requirement, null, [
      issue('probe-failed', error.message || String(error)),
    ]);
  }
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return response.json();
}

async function inspectSingleNvidiaGpu(execImpl) {
  const result = await execImpl('nvidia-smi', [
    '--query-gpu=memory.total,memory.free',
    '--format=csv,noheader,nounits',
  ], {
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: 64 * 1024,
  });
  const rows = String(result.stdout || '')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.split(',').map(value => Number(value.trim())));
  if (
    rows.length !== 1
    || rows[0].length !== 2
    || rows[0].some(value => !Number.isFinite(value))
  ) {
    throw new Error('model fixture preflight requires one readable NVIDIA GPU');
  }
  return {
    totalVramMiB: rows[0][0],
    freeVramMiB: rows[0][1],
  };
}

function compareModelIdentity(requirement, observed, kind, issues) {
  if (observed.model !== requirement.model) {
    issues.push(issue(
      `${kind}-model-mismatch`,
      `expected ${requirement.model}, got ${display(observed.model)}`,
    ));
  }
  if (normalizeDigest(observed.digestSha256) !== requirement.digestSha256) {
    issues.push(issue(
      `${kind}-digest-mismatch`,
      `expected digest ${requirement.digestSha256}, got `
        + `${display(normalizeDigest(observed.digestSha256))}`,
    ));
  }
}

function preflightResult(requirement, observation, issues) {
  return {
    schemaVersion: 1,
    ok: issues.length === 0,
    requirement,
    observation,
    issues,
  };
}

function issue(code, message) {
  return { code, message };
}

function normalizeDigest(value) {
  return String(value || '').replace(/^sha256:/, '').toLowerCase();
}

function display(value) {
  return value === undefined || value === null ? '(missing)' : String(value);
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isPositiveNumber(value) {
  return Number.isFinite(value) && value > 0;
}
