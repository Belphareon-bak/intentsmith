#!/usr/bin/env node

// Isolated, measurement-only D+ role-suite executor.
//
// This program deliberately has no DB, binding, broadcast or proof writer. It
// derives policy inside its own process, permits only the exact local provider
// routes needed by one role suite and publishes one private canonical artifact
// after every post-condition has passed.

import { createHash, randomUUID } from 'node:crypto';
import {
  constants as fsConstants,
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));
const REPOSITORY_ARTIFACT_ROOT = path.join(REPOSITORY_ROOT, '.intentsmith-artifacts');
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MODEL_NAME_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,190}:[a-z0-9][a-z0-9._-]{0,63}$/i;
const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_PROVIDER_BODY_BYTES = 4 * 1024 * 1024;
const INVENTORY_TIMEOUT_MS = 5_000;
const ARTIFACT_FILE = 'measurement.json';
const BASE_ENVIRONMENT_KEYS = Object.freeze([
  'C3_ENABLE_AUTONOMY',
  'C3_ENABLE_COMFYUI',
  'C3_ENABLE_ONLINE_DISCOVERY',
  'HOME',
  'LANG',
  'LC_ALL',
  'NODE_ENV',
  'TEMP',
  'TMP',
  'TMPDIR',
  'TZ',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
].sort());
const ALLOWED_STARTUP_ENVIRONMENT_KEYS = Object.freeze([
  'INTENTSMITH_TEST_ARTIFACT_DIR',
  'INTENTSMITH_TEST_SOURCE_REVISION',
  'LANG',
  'LC_ALL',
  'TZ',
].sort());
const ARTIFACT_KEYS = Object.freeze([
  'schemaVersion',
  'artifactKind',
  'measurementStatus',
  'proofStatus',
  'proofBlockReason',
  'proofIssued',
  'runId',
  'producer',
  'sourceRevisionClaim',
  'startedAtMs',
  'completedAtMs',
  'durationMs',
  'environment',
  'provider',
  'candidate',
  'measurementContract',
  'measurementContractSha256',
  'contractPreflight',
  'contractPostflight',
  'inventoryBefore',
  'inventoryAfter',
  'results',
  'aggregate',
  'effectBoundary',
]);
const CLI_FIELDS = Object.freeze({
  '--role': 'role',
  '--model-name': 'modelName',
  '--digest-sha256': 'digestSha256',
  '--provider-origin': 'providerOrigin',
});

export class ModelFailoverMeasurementError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'ModelFailoverMeasurementError';
    this.code = code;
    this.details = options.details || null;
  }
}

function fail(code, message, details = null) {
  throw new ModelFailoverMeasurementError(code, message, { details });
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected, label) {
  if (!isPlainRecord(value)) fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', `${label} fields drifted`, {
      actual,
      expected: wanted,
    });
  }
}

function requireSafeInteger(value, label, { minimum = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', `${label} must be an integer >= ${minimum}`);
  }
  return value;
}

function requireScore(value, label) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', `${label} must be finite and within 0..1`);
  }
  return value;
}

function requireString(value, label, { minimum = 1, maximum = 4096 } = {}) {
  if (typeof value !== 'string'
    || value.length < minimum
    || value.length > maximum
    || value !== value.trim()) {
    fail('MODEL_MEASUREMENT_INPUT_INVALID', `${label} is invalid`);
  }
  return value;
}

function requireArtifactString(value, label, { minimum = 1, maximum = 4096 } = {}) {
  if (typeof value !== 'string'
    || value.length < minimum
    || value.length > maximum
    || value !== value.trim()) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', `${label} is invalid`);
  }
  return value;
}

function requireDigest(value, label = 'digestSha256') {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    fail('MODEL_MEASUREMENT_INPUT_INVALID', `${label} must be lowercase 64hex`);
  }
  return value;
}

function normalizeDigest(value) {
  const normalized = String(value || '').replace(/^sha256:/i, '').toLowerCase();
  return SHA256_PATTERN.test(normalized) ? normalized : null;
}

export function requireExactLoopbackProviderOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail('MODEL_MEASUREMENT_PROVIDER_INVALID', 'Provider must be an exact HTTP loopback origin');
  }
  if (parsed.protocol !== 'http:'
    || parsed.hostname !== '127.0.0.1'
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.pathname !== '/'
    || parsed.search !== ''
    || parsed.hash !== ''
    || parsed.port === ''
    || !Number.isSafeInteger(Number(parsed.port))
    || Number(parsed.port) < 1
    || Number(parsed.port) > 65535) {
    fail('MODEL_MEASUREMENT_PROVIDER_INVALID', 'Provider must be an exact HTTP 127.0.0.1 origin with an explicit port');
  }
  return parsed.origin;
}

function parseCli(argv) {
  if (argv.length !== Object.keys(CLI_FIELDS).length * 2) {
    fail('MODEL_MEASUREMENT_INPUT_INVALID', 'Exactly four named measurement arguments are required');
  }
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const field = CLI_FIELDS[flag];
    if (!field || Object.hasOwn(result, field)) {
      fail('MODEL_MEASUREMENT_INPUT_INVALID', 'Unknown or duplicate measurement argument');
    }
    result[field] = argv[index + 1];
  }
  requireString(result.role, 'role', { maximum: 16 });
  if (typeof result.modelName !== 'string' || !MODEL_NAME_PATTERN.test(result.modelName)) {
    fail('MODEL_MEASUREMENT_INPUT_INVALID', 'modelName must have an explicit provider tag');
  }
  requireDigest(result.digestSha256);
  result.providerOrigin = requireExactLoopbackProviderOrigin(result.providerOrigin);
  return Object.freeze(result);
}

function isPathInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

async function inspectPrivateDirectory(directory, label) {
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    fail('MODEL_MEASUREMENT_ARTIFACT_BOUNDARY_INVALID', `${label} is not a real directory`);
  }
  if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) {
    fail('MODEL_MEASUREMENT_ARTIFACT_BOUNDARY_INVALID', `${label} has a foreign owner`);
  }
  if ((metadata.mode & 0o077) !== 0) {
    await chmod(directory, 0o700);
  }
  const checked = await lstat(directory);
  if ((checked.mode & 0o077) !== 0) {
    fail('MODEL_MEASUREMENT_ARTIFACT_BOUNDARY_INVALID', `${label} is not private`);
  }
}

async function ensurePrivateDirectoryTree(requestedRoot) {
  const repositoryRoot = await realpath(REPOSITORY_ROOT);
  const lexicalArtifactRoot = REPOSITORY_ARTIFACT_ROOT;
  const absoluteRequested = path.resolve(requestedRoot);
  if (absoluteRequested !== lexicalArtifactRoot
    && !isPathInside(lexicalArtifactRoot, absoluteRequested)) {
    fail('MODEL_MEASUREMENT_ARTIFACT_BOUNDARY_INVALID', 'Artifact root escaped .intentsmith-artifacts');
  }

  let current = lexicalArtifactRoot;
  const relativeSegments = path.relative(lexicalArtifactRoot, absoluteRequested)
    .split(path.sep)
    .filter(Boolean);
  for (const segment of ['', ...relativeSegments]) {
    if (segment) current = path.join(current, segment);
    try {
      await mkdir(current, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
    await inspectPrivateDirectory(current, `artifact directory ${path.relative(repositoryRoot, current)}`);
  }

  const canonicalArtifactRoot = await realpath(lexicalArtifactRoot);
  const canonicalRequested = await realpath(absoluteRequested);
  if (canonicalArtifactRoot !== lexicalArtifactRoot
    || (canonicalRequested !== canonicalArtifactRoot
      && !isPathInside(canonicalArtifactRoot, canonicalRequested))) {
    fail('MODEL_MEASUREMENT_ARTIFACT_BOUNDARY_INVALID', 'Artifact directory resolved outside its owned boundary');
  }
  return canonicalRequested;
}

async function createRunDirectory() {
  const configured = process.env.INTENTSMITH_TEST_ARTIFACT_DIR;
  const requestedRoot = configured
    ? path.resolve(configured)
    : path.join(REPOSITORY_ARTIFACT_ROOT, 'model-failover-measurements');
  const root = await ensurePrivateDirectoryTree(requestedRoot);
  const runId = randomUUID();
  const runDirectory = path.join(root, `run-${runId}`);
  await mkdir(runDirectory, { mode: 0o700 });
  await inspectPrivateDirectory(runDirectory, 'measurement run directory');
  for (const childName of ['home', 'tmp', 'xdg-config', 'xdg-cache', 'xdg-data', 'xdg-state']) {
    const child = path.join(runDirectory, childName);
    await mkdir(child, { mode: 0o700 });
    await inspectPrivateDirectory(child, `measurement ${childName}`);
  }
  return Object.freeze({ root, runId, runDirectory });
}

function scrubEnvironment(runDirectory, sourceRevisionClaim) {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, {
    HOME: path.join(runDirectory, 'home'),
    XDG_CONFIG_HOME: path.join(runDirectory, 'xdg-config'),
    XDG_CACHE_HOME: path.join(runDirectory, 'xdg-cache'),
    XDG_DATA_HOME: path.join(runDirectory, 'xdg-data'),
    XDG_STATE_HOME: path.join(runDirectory, 'xdg-state'),
    TMPDIR: path.join(runDirectory, 'tmp'),
    TMP: path.join(runDirectory, 'tmp'),
    TEMP: path.join(runDirectory, 'tmp'),
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    TZ: 'UTC',
    NODE_ENV: 'production',
    C3_ENABLE_AUTONOMY: 'false',
    C3_ENABLE_COMFYUI: 'false',
    C3_ENABLE_ONLINE_DISCOVERY: 'false',
  });
  if (sourceRevisionClaim) {
    process.env.INTENTSMITH_TEST_SOURCE_REVISION = sourceRevisionClaim;
  }
  return Object.freeze(Object.keys(process.env).sort());
}

function captureSourceRevisionClaim() {
  const value = process.env.INTENTSMITH_TEST_SOURCE_REVISION || '';
  if (value === '') return null;
  if (!/^[a-f0-9]{40}$/.test(value)) {
    fail('MODEL_MEASUREMENT_INPUT_INVALID', 'Source revision must be a full lowercase Git SHA');
  }
  return value;
}

function requireCleanStartupEnvironment() {
  const keys = Object.keys(process.env).sort();
  const unexpected = keys.filter(key => !ALLOWED_STARTUP_ENVIRONMENT_KEYS.includes(key));
  if (unexpected.length > 0 || process.execArgv.length !== 0) {
    fail(
      'MODEL_MEASUREMENT_STARTUP_ENVIRONMENT_INVALID',
      'Measurement child must start from an explicit environment and Node-flag allowlist',
      {
        unexpectedKeys: unexpected,
        unexpectedNodeFlagCount: process.execArgv.length,
      },
    );
  }
  return Object.freeze(keys);
}

async function readBoundedBody(response) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    fail('MODEL_MEASUREMENT_PROVIDER_RESPONSE_INVALID', 'Provider response body is unavailable');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PROVIDER_BODY_BYTES) {
        await reader.cancel();
        fail('MODEL_MEASUREMENT_PROVIDER_RESPONSE_INVALID', 'Provider response exceeded the byte limit');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total));
  } catch {
    fail('MODEL_MEASUREMENT_PROVIDER_RESPONSE_INVALID', 'Provider response is not valid UTF-8');
  }
}

function installImportNetworkDeny() {
  const nativeFetch = globalThis.fetch;
  if (typeof nativeFetch !== 'function') {
    fail('MODEL_MEASUREMENT_RUNTIME_INVALID', 'Global fetch is unavailable');
  }
  globalThis.fetch = async () => {
    fail(
      'MODEL_MEASUREMENT_IMPORT_NETWORK_SCOPE_VIOLATION',
      'Measurement authority import attempted network access',
    );
  };
  return nativeFetch;
}

function installNetworkBoundary(providerOrigin, runnerContract, nativeFetch) {
  const records = [];
  globalThis.fetch = async (input, options = {}) => {
    const target = new URL(typeof input === 'string' || input instanceof URL ? input : input?.url);
    const method = String(options.method || input?.method || 'GET').toUpperCase();
    if (target.origin !== providerOrigin || target.search || target.hash) {
      fail('MODEL_MEASUREMENT_NETWORK_SCOPE_VIOLATION', 'Measurement attempted an unapproved origin');
    }
    const route = `${method} ${target.pathname}`;
    if (route !== 'GET /api/tags' && route !== 'POST /api/chat') {
      fail('MODEL_MEASUREMENT_NETWORK_SCOPE_VIOLATION', 'Measurement attempted an unapproved provider route', { route });
    }
    let body = null;
    if (route === 'POST /api/chat') {
      try {
        body = JSON.parse(options.body);
      } catch {
        fail('MODEL_MEASUREMENT_WIRE_INVALID', 'Provider request body is not JSON');
      }
      exactKeys(body, ['model', 'messages', 'stream', 'think', 'options'], 'provider request');
      exactKeys(body.options, ['temperature', 'top_p', 'num_predict', 'num_ctx'], 'provider options');
      if (body.stream !== false
        || body.think !== false
        || body.options.temperature !== runnerContract.temperature
        || body.options.top_p !== runnerContract.topP
        || body.options.num_predict !== runnerContract.numPredict
        || body.options.num_ctx !== runnerContract.numCtx
        || !Array.isArray(body.messages)
        || body.messages.length !== 1) {
        fail('MODEL_MEASUREMENT_WIRE_INVALID', 'Provider request violated the measurement contract');
      }
    } else if (options.body !== undefined) {
      fail('MODEL_MEASUREMENT_WIRE_INVALID', 'Inventory request unexpectedly carried a body');
    }
    records.push({ route, body });
    return nativeFetch(target, { ...options, redirect: 'error' });
  };
  return Object.freeze({ records, nativeFetch });
}

async function fetchJsonWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await globalThis.fetch(url, { ...options, signal: controller.signal });
    const rawBody = await readBoundedBody(response);
    if (!response.ok) {
      fail('MODEL_MEASUREMENT_PROVIDER_HTTP_ERROR', `Provider returned HTTP ${response.status}`, {
        status: response.status,
      });
    }
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      fail('MODEL_MEASUREMENT_PROVIDER_RESPONSE_INVALID', 'Provider response is not JSON');
    }
    return Object.freeze({ payload, rawBody, durationMs: Date.now() - startedAt });
  } catch (error) {
    if (error?.name === 'AbortError') {
      fail('MODEL_MEASUREMENT_PROVIDER_TIMEOUT', 'Provider request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function sortedInventory(payload, canonicalModelName, canonicalize) {
  if (!isPlainRecord(payload) || !Array.isArray(payload.models)) {
    fail('MODEL_MEASUREMENT_INVENTORY_INVALID', 'Provider inventory has an invalid shape');
  }
  const models = payload.models.map((entry, index) => {
    if (!isPlainRecord(entry)) {
      fail('MODEL_MEASUREMENT_INVENTORY_INVALID', `Inventory entry ${index} is invalid`);
    }
    const name = requireString(entry.name, `inventory[${index}].name`, { maximum: 256 });
    const canonicalName = canonicalModelName(name);
    const digestSha256 = normalizeDigest(entry.digest);
    if (!canonicalName || !digestSha256) {
      fail('MODEL_MEASUREMENT_INVENTORY_INVALID', `Inventory entry ${index} lacks canonical identity`);
    }
    return { name, canonicalName, digestSha256 };
  }).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  if (new Set(models.map(model => model.name)).size !== models.length) {
    fail('MODEL_MEASUREMENT_INVENTORY_INVALID', 'Provider inventory contains duplicate names');
  }
  const canonicalJson = canonicalize(models);
  return Object.freeze({ models, sha256: sha256(canonicalJson) });
}

function requireCandidateInventory(inventory, requestedModelName, expectedDigest, canonicalModelName) {
  const requestedCanonical = canonicalModelName(requestedModelName);
  const matches = inventory.models.filter(model => model.canonicalName === requestedCanonical);
  if (matches.length !== 1) {
    fail('MODEL_MEASUREMENT_CANDIDATE_UNAVAILABLE', 'Inventory must contain exactly one canonical candidate');
  }
  if (matches[0].digestSha256 !== expectedDigest) {
    fail('MODEL_MEASUREMENT_CANDIDATE_DIGEST_MISMATCH', 'Candidate digest does not match the requested artifact');
  }
  return matches[0];
}

function normalizePrompt(promptResult) {
  if (typeof promptResult === 'string') {
    return { text: requireString(promptResult, 'prompt', { maximum: 100_000 }), images: null, gradeContext: null };
  }
  if (!isPlainRecord(promptResult)) {
    fail('MODEL_MEASUREMENT_PROMPT_INVALID', 'Prompt factory returned an unsupported value');
  }
  const text = requireString(promptResult.text, 'prompt.text', { maximum: 100_000 });
  let images = null;
  if (Object.hasOwn(promptResult, 'images')) {
    if (!Array.isArray(promptResult.images)
      || promptResult.images.length === 0
      || promptResult.images.some(image => typeof image !== 'string' || image.length === 0)) {
      fail('MODEL_MEASUREMENT_PROMPT_INVALID', 'Prompt images are invalid');
    }
    images = [...promptResult.images];
  }
  const gradeContext = Object.hasOwn(promptResult, '_expected')
    ? { _expected: requireString(promptResult._expected, 'prompt._expected', { maximum: 1024 }) }
    : null;
  return { text, images, gradeContext };
}

async function runOneTest({
  definition,
  index,
  modelName,
  providerOrigin,
  runnerContract,
  canonicalize,
}) {
  const prompt = normalizePrompt(definition.prompt());
  const message = { role: 'user', content: prompt.text };
  if (prompt.images) message.images = prompt.images;
  const body = {
    model: modelName,
    messages: [message],
    stream: runnerContract.stream,
    think: runnerContract.think,
    options: {
      temperature: runnerContract.temperature,
      top_p: runnerContract.topP,
      num_predict: runnerContract.numPredict,
      num_ctx: runnerContract.numCtx,
    },
  };
  const requestCanonicalJson = canonicalize(body);
  const provider = await fetchJsonWithTimeout(
    `${providerOrigin}/api/chat`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    runnerContract.perTestTimeoutMs,
  );
  const content = provider.payload?.message?.content;
  if (!isPlainRecord(provider.payload)
    || Object.hasOwn(provider.payload, 'error')
    || !isPlainRecord(provider.payload.message)
    || provider.payload.message.role !== 'assistant'
    || provider.payload?.done !== true
    || typeof content !== 'string'
    || content.length === 0) {
    fail(
      'MODEL_MEASUREMENT_PROVIDER_RESPONSE_INVALID',
      'Provider returned no terminal assistant content',
    );
  }
  let grade;
  try {
    grade = definition.grade(content, prompt.gradeContext);
  } catch (error) {
    throw new ModelFailoverMeasurementError(
      'MODEL_MEASUREMENT_GRADER_FAILED',
      `Grader failed for ${definition.name}`,
      { cause: error },
    );
  }
  if (!isPlainRecord(grade)
    || typeof grade.passed !== 'boolean'
    || !Number.isFinite(grade.score)
    || grade.score < 0
    || grade.score > 1) {
    fail('MODEL_MEASUREMENT_GRADER_INVALID', `Grader returned an invalid result for ${definition.name}`);
  }
  return {
    index,
    testId: definition.name,
    request: { body, sha256: sha256(requestCanonicalJson) },
    response: {
      rawBody: provider.rawBody,
      sha256: sha256(provider.rawBody),
      content,
      evalCount: Number.isSafeInteger(provider.payload.eval_count) && provider.payload.eval_count >= 0
        ? provider.payload.eval_count
        : 0,
      promptEvalCount: Number.isSafeInteger(provider.payload.prompt_eval_count)
        && provider.payload.prompt_eval_count >= 0
        ? provider.payload.prompt_eval_count
        : 0,
      durationMs: provider.durationMs,
    },
    gradeContext: prompt.gradeContext,
    passed: grade.passed,
    score: grade.score,
  };
}

function contractCheckpoint(measurement) {
  return {
    measurementContractSha256: measurement.measurementContractSha256,
    canonicalJsonSha256: sha256(measurement.canonicalJson),
    sourcePins: measurement.contract.sourcePins,
  };
}

function sameCanonical(left, right, canonicalize) {
  return canonicalize(left) === canonicalize(right);
}

function exactEffectBoundary() {
  return {
    persistence: 'NONE',
    proofIssuance: 'DISABLED',
    bindingMutation: 'NONE',
    externalNetwork: 'FORBIDDEN',
    artifactWrite: 'EXCLUSIVE_PRIVATE_CANONICAL_FILE',
  };
}

async function executeMeasurement(input, run, environmentKeys, startupEnvironmentKeys) {
  const nativeFetch = installImportNetworkDeny();
  const {
    canonicalizeModelFailoverContract: canonicalize,
    getModelFailoverMeasurementContract,
    MODEL_FAILOVER_MEASUREMENT_NOT_ISSUED_REASON,
  } = await import('../src/upgrade/model-failover-proof-policy.js');
  const { SUITES } = await import('../src/upgrade/validation-suites.js');
  const { canonicalModelName } = await import('../src/upgrade/model-identity.js');

  const preflight = getModelFailoverMeasurementContract(input.role);
  const role = preflight.contract.role.role;
  const suiteName = preflight.contract.role.suite;
  const suite = SUITES[suiteName];
  if (!suite || suite.tests.length !== preflight.contract.role.totalCount) {
    fail('MODEL_MEASUREMENT_SUITE_DRIFT', 'Runtime suite does not match the measurement contract');
  }
  const network = installNetworkBoundary(
    input.providerOrigin,
    preflight.contract.runner,
    nativeFetch,
  );
  const startedAtMs = Date.now();

  const beforeResponse = await fetchJsonWithTimeout(
    `${input.providerOrigin}/api/tags`,
    { method: 'GET' },
    INVENTORY_TIMEOUT_MS,
  );
  const inventoryBefore = sortedInventory(beforeResponse.payload, canonicalModelName, canonicalize);
  const candidate = requireCandidateInventory(
    inventoryBefore,
    input.modelName,
    input.digestSha256,
    canonicalModelName,
  );

  const results = [];
  for (let index = 0; index < suite.tests.length; index++) {
    const definition = suite.tests[index];
    const expectedId = preflight.contract.role.orderedTestIds[index];
    if (definition?.name !== expectedId) {
      fail('MODEL_MEASUREMENT_SUITE_DRIFT', 'Runtime test order drifted before provider execution');
    }
    results.push(await runOneTest({
      definition,
      index,
      modelName: candidate.name,
      providerOrigin: input.providerOrigin,
      runnerContract: preflight.contract.runner,
      canonicalize,
    }));
  }

  const afterResponse = await fetchJsonWithTimeout(
    `${input.providerOrigin}/api/tags`,
    { method: 'GET' },
    INVENTORY_TIMEOUT_MS,
  );
  const inventoryAfter = sortedInventory(afterResponse.payload, canonicalModelName, canonicalize);
  requireCandidateInventory(
    inventoryAfter,
    input.modelName,
    input.digestSha256,
    canonicalModelName,
  );
  if (!sameCanonical(inventoryBefore, inventoryAfter, canonicalize)) {
    fail('MODEL_MEASUREMENT_INVENTORY_DRIFT', 'Provider inventory changed during measurement');
  }

  const postflight = getModelFailoverMeasurementContract(role);
  if (preflight.canonicalJson !== postflight.canonicalJson
    || preflight.measurementContractSha256 !== postflight.measurementContractSha256) {
    fail('MODEL_MEASUREMENT_CONTRACT_DRIFT', 'Measurement contract changed during execution');
  }
  if (network.records.length !== results.length + 2
    || network.records[0]?.route !== 'GET /api/tags'
    || network.records.at(-1)?.route !== 'GET /api/tags'
    || network.records.slice(1, -1).some(record => record.route !== 'POST /api/chat')) {
    fail('MODEL_MEASUREMENT_NETWORK_SCOPE_VIOLATION', 'Provider effect count or order drifted');
  }

  const completedAtMs = Date.now();
  const passedCount = results.filter(result => result.passed).length;
  const score = results.reduce((sum, result) => sum + result.score, 0) / results.length;
  const artifact = {
    schemaVersion: 1,
    artifactKind: 'MODEL_FAILOVER_ROLE_MEASUREMENT',
    measurementStatus: 'COMPLETE',
    proofStatus: 'NOT_ISSUED',
    proofBlockReason: MODEL_FAILOVER_MEASUREMENT_NOT_ISSUED_REASON,
    proofIssued: false,
    runId: run.runId,
    producer: {
      kind: 'ISOLATED_NODE_PROCESS',
      pid: process.pid,
      nodeVersion: process.version,
    },
    sourceRevisionClaim: captureSourceRevisionClaim(),
    startedAtMs,
    completedAtMs,
    durationMs: completedAtMs - startedAtMs,
    environment: {
      startupKeys: startupEnvironmentKeys,
      activeKeys: environmentKeys,
    },
    provider: {
      origin: input.providerOrigin,
      inventoryRequestCount: 2,
      chatRequestCount: results.length,
      allowedRoutes: ['GET /api/tags', 'POST /api/chat'],
    },
    candidate: {
      role,
      requestedModelName: input.modelName,
      observedModelName: candidate.name,
      canonicalName: candidate.canonicalName,
      digestSha256: candidate.digestSha256,
    },
    measurementContract: preflight.contract,
    measurementContractSha256: preflight.measurementContractSha256,
    contractPreflight: contractCheckpoint(preflight),
    contractPostflight: contractCheckpoint(postflight),
    inventoryBefore,
    inventoryAfter,
    results,
    aggregate: {
      score,
      passedCount,
      totalCount: results.length,
    },
    effectBoundary: exactEffectBoundary(),
  };
  await validateModelFailoverMeasurementArtifact(artifact, {
    role,
    modelName: input.modelName,
    digestSha256: input.digestSha256,
    providerOrigin: input.providerOrigin,
    sourceRevisionClaim: artifact.sourceRevisionClaim,
  });
  return Object.freeze({ artifact, canonicalJson: canonicalize(artifact) });
}

function validateInventorySnapshot(snapshot, label, canonicalize) {
  exactKeys(snapshot, ['models', 'sha256'], label);
  if (!Array.isArray(snapshot.models)) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', `${label}.models must be an array`);
  }
  let previous = null;
  const names = new Set();
  for (let index = 0; index < snapshot.models.length; index++) {
    const model = snapshot.models[index];
    exactKeys(model, ['name', 'canonicalName', 'digestSha256'], `${label}.models[${index}]`);
    requireArtifactString(model.name, `${label}.models[${index}].name`, { maximum: 256 });
    requireArtifactString(model.canonicalName, `${label}.models[${index}].canonicalName`, { maximum: 256 });
    requireDigest(model.digestSha256, `${label}.models[${index}].digestSha256`);
    if (previous !== null && model.name <= previous) {
      fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', `${label}.models is not strictly sorted`);
    }
    if (names.has(model.name)) {
      fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', `${label}.models contains a duplicate`);
    }
    previous = model.name;
    names.add(model.name);
  }
  if (snapshot.sha256 !== sha256(canonicalize(snapshot.models))) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', `${label} hash mismatch`);
  }
}

function validateRequest(result, runner, canonicalize, label) {
  exactKeys(result.request, ['body', 'sha256'], `${label}.request`);
  const body = result.request.body;
  exactKeys(body, ['model', 'messages', 'stream', 'think', 'options'], `${label}.request.body`);
  exactKeys(body.options, ['temperature', 'top_p', 'num_predict', 'num_ctx'], `${label}.request.options`);
  if (body.stream !== runner.stream
    || body.think !== runner.think
    || body.options.temperature !== runner.temperature
    || body.options.top_p !== runner.topP
    || body.options.num_predict !== runner.numPredict
    || body.options.num_ctx !== runner.numCtx
    || !Array.isArray(body.messages)
    || body.messages.length !== 1) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', `${label} wire policy drifted`);
  }
  exactKeys(body.messages[0], body.messages[0].images
    ? ['role', 'content', 'images']
    : ['role', 'content'], `${label}.request.message`);
  if (body.messages[0].role !== 'user') {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', `${label} request role drifted`);
  }
  requireArtifactString(body.messages[0].content, `${label}.request.content`, { maximum: 100_000 });
  if (Object.hasOwn(body.messages[0], 'images')
    && (!Array.isArray(body.messages[0].images)
      || body.messages[0].images.length === 0
      || body.messages[0].images.some(image => typeof image !== 'string' || image.length === 0))) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', `${label} request images are invalid`);
  }
  if (result.request.sha256 !== sha256(canonicalize(body))) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', `${label} request hash mismatch`);
  }
}

function validatePromptProvenance(result, definition, canonicalize, label) {
  const message = result.request.body.messages[0];
  if (definition.name === 'math_basic') {
    const match = message.content.match(
      /^Kolik je ([1-4]\d|50) × ([1-4]\d|50)\? Odpověz pouze číslem\.$/,
    );
    if (!match
      || message.images !== undefined
      || result.gradeContext?._expected !== String(Number(match[1]) * Number(match[2]))) {
      fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', `${label} randomized prompt provenance drifted`);
    }
    return;
  }

  const expectedPrompt = normalizePrompt(definition.prompt());
  const expectedMessage = { role: 'user', content: expectedPrompt.text };
  if (expectedPrompt.images) expectedMessage.images = expectedPrompt.images;
  if (canonicalize(message) !== canonicalize(expectedMessage)
    || canonicalize(result.gradeContext) !== canonicalize(expectedPrompt.gradeContext)) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', `${label} prompt provenance drifted`);
  }
}

function validateResponse(result, label) {
  exactKeys(result.response, [
    'rawBody',
    'sha256',
    'content',
    'evalCount',
    'promptEvalCount',
    'durationMs',
  ], `${label}.response`);
  if (typeof result.response.rawBody !== 'string'
    || result.response.rawBody.length === 0
    || Buffer.byteLength(result.response.rawBody) > MAX_PROVIDER_BODY_BYTES) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', `${label}.response.rawBody is invalid`);
  }
  if (result.response.sha256 !== sha256(result.response.rawBody)) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', `${label} response hash mismatch`);
  }
  let payload;
  try {
    payload = JSON.parse(result.response.rawBody);
  } catch {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', `${label} response is not JSON`);
  }
  const content = payload?.message?.content;
  if (!isPlainRecord(payload)
    || Object.hasOwn(payload, 'error')
    || !isPlainRecord(payload.message)
    || payload.message.role !== 'assistant'
    || payload.done !== true
    || result.response.content !== content
    || typeof content !== 'string'
    || content.length === 0) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', `${label} response content mismatch`);
  }
  const expectedEvalCount = Number.isSafeInteger(payload.eval_count) && payload.eval_count >= 0
    ? payload.eval_count
    : 0;
  const expectedPromptEvalCount = Number.isSafeInteger(payload.prompt_eval_count)
    && payload.prompt_eval_count >= 0
    ? payload.prompt_eval_count
    : 0;
  requireSafeInteger(result.response.evalCount, `${label}.response.evalCount`);
  requireSafeInteger(result.response.promptEvalCount, `${label}.response.promptEvalCount`);
  if (result.response.evalCount !== expectedEvalCount
    || result.response.promptEvalCount !== expectedPromptEvalCount) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', `${label} response counters drifted`);
  }
  requireSafeInteger(result.response.durationMs, `${label}.response.durationMs`);
}

function validateExpectedArtifactPins(expected) {
  if (!isPlainRecord(expected)) {
    fail('MODEL_MEASUREMENT_EXPECTATION_INVALID', 'Artifact expectations must be an object');
  }
  const keys = Object.keys(expected).sort();
  if (keys.length === 0) return null;
  const requiredKeys = [
    'digestSha256',
    'modelName',
    'providerOrigin',
    'role',
    'sourceRevisionClaim',
  ];
  if (JSON.stringify(keys) !== JSON.stringify(requiredKeys)) {
    fail(
      'MODEL_MEASUREMENT_EXPECTATION_INVALID',
      'Artifact expectations must provide the exact complete parent pin set',
    );
  }
  if (typeof expected.role !== 'string' || expected.role !== expected.role.trim().toUpperCase()) {
    fail('MODEL_MEASUREMENT_EXPECTATION_INVALID', 'Expected role must be canonical uppercase');
  }
  if (typeof expected.modelName !== 'string' || !MODEL_NAME_PATTERN.test(expected.modelName)) {
    fail('MODEL_MEASUREMENT_EXPECTATION_INVALID', 'Expected model name is invalid');
  }
  if (typeof expected.digestSha256 !== 'string' || !SHA256_PATTERN.test(expected.digestSha256)) {
    fail('MODEL_MEASUREMENT_EXPECTATION_INVALID', 'Expected digest is invalid');
  }
  const providerOrigin = requireExactLoopbackProviderOrigin(expected.providerOrigin);
  if (expected.sourceRevisionClaim !== null
    && (typeof expected.sourceRevisionClaim !== 'string'
      || !/^[a-f0-9]{40}$/.test(expected.sourceRevisionClaim))) {
    fail('MODEL_MEASUREMENT_EXPECTATION_INVALID', 'Expected source revision claim is invalid');
  }
  return { ...expected, providerOrigin };
}

export async function validateModelFailoverMeasurementArtifact(artifact, expected = {}) {
  const expectedPins = validateExpectedArtifactPins(expected);
  exactKeys(artifact, ARTIFACT_KEYS, 'artifact');
  if (artifact.schemaVersion !== 1
    || artifact.artifactKind !== 'MODEL_FAILOVER_ROLE_MEASUREMENT'
    || artifact.measurementStatus !== 'COMPLETE'
    || artifact.proofStatus !== 'NOT_ISSUED'
    || artifact.proofIssued !== false) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', 'Artifact status fields are invalid');
  }
  if (!RUN_ID_PATTERN.test(artifact.runId || '')) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', 'Artifact runId is invalid');
  }
  exactKeys(artifact.producer, ['kind', 'pid', 'nodeVersion'], 'artifact.producer');
  if (artifact.producer.kind !== 'ISOLATED_NODE_PROCESS'
    || !Number.isSafeInteger(artifact.producer.pid)
    || artifact.producer.pid < 1
    || typeof artifact.producer.nodeVersion !== 'string'
    || !/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(artifact.producer.nodeVersion)) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', 'Artifact producer is invalid');
  }
  if (artifact.sourceRevisionClaim !== null
    && (typeof artifact.sourceRevisionClaim !== 'string'
      || !/^[a-f0-9]{40}$/.test(artifact.sourceRevisionClaim))) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', 'Artifact source revision claim is invalid');
  }
  requireSafeInteger(artifact.startedAtMs, 'artifact.startedAtMs', { minimum: 1 });
  requireSafeInteger(artifact.completedAtMs, 'artifact.completedAtMs', { minimum: 1 });
  requireSafeInteger(artifact.durationMs, 'artifact.durationMs');
  if (artifact.completedAtMs < artifact.startedAtMs
    || artifact.durationMs !== artifact.completedAtMs - artifact.startedAtMs) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', 'Artifact chronology is invalid');
  }
  exactKeys(artifact.environment, ['activeKeys', 'startupKeys'], 'artifact.environment');
  if (!Array.isArray(artifact.environment.activeKeys)
    || new Set(artifact.environment.activeKeys).size !== artifact.environment.activeKeys.length
    || JSON.stringify(artifact.environment.activeKeys) !== JSON.stringify([
      ...BASE_ENVIRONMENT_KEYS,
      ...(artifact.sourceRevisionClaim === null ? [] : ['INTENTSMITH_TEST_SOURCE_REVISION']),
    ].sort())) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', 'Artifact environment key set is invalid');
  }
  if (!Array.isArray(artifact.environment.startupKeys)
    || new Set(artifact.environment.startupKeys).size !== artifact.environment.startupKeys.length
    || JSON.stringify(artifact.environment.startupKeys)
      !== JSON.stringify([...artifact.environment.startupKeys].sort())
    || artifact.environment.startupKeys.some(
      key => !ALLOWED_STARTUP_ENVIRONMENT_KEYS.includes(key),
    )
    || artifact.environment.startupKeys.includes('INTENTSMITH_TEST_SOURCE_REVISION')
      !== (artifact.sourceRevisionClaim !== null)) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', 'Artifact startup environment is invalid');
  }
  exactKeys(artifact.provider, [
    'origin',
    'inventoryRequestCount',
    'chatRequestCount',
    'allowedRoutes',
  ], 'artifact.provider');
  const providerOrigin = requireExactLoopbackProviderOrigin(artifact.provider.origin);
  if (artifact.provider.inventoryRequestCount !== 2
    || JSON.stringify(artifact.provider.allowedRoutes)
      !== JSON.stringify(['GET /api/tags', 'POST /api/chat'])) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', 'Artifact provider boundary is invalid');
  }
  exactKeys(artifact.candidate, [
    'role',
    'requestedModelName',
    'observedModelName',
    'canonicalName',
    'digestSha256',
  ], 'artifact.candidate');
  for (const [field, value] of [
    ['requestedModelName', artifact.candidate.requestedModelName],
    ['observedModelName', artifact.candidate.observedModelName],
  ]) {
    if (typeof value !== 'string' || !MODEL_NAME_PATTERN.test(value)) {
      fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', `artifact.candidate.${field} is invalid`);
    }
  }
  requireArtifactString(artifact.candidate.role, 'artifact.candidate.role', { maximum: 16 });
  requireArtifactString(
    artifact.candidate.canonicalName,
    'artifact.candidate.canonicalName',
    { maximum: 256 },
  );
  requireDigest(artifact.candidate.digestSha256, 'artifact.candidate.digestSha256');

  const {
    canonicalizeModelFailoverContract: canonicalize,
    getModelFailoverMeasurementContract,
    MODEL_FAILOVER_MEASUREMENT_NOT_ISSUED_REASON,
  } = await import('../src/upgrade/model-failover-proof-policy.js');
  const { SUITES } = await import('../src/upgrade/validation-suites.js');
  const { canonicalModelName } = await import('../src/upgrade/model-identity.js');
  const derived = getModelFailoverMeasurementContract(artifact.candidate.role);
  if (artifact.candidate.role !== derived.contract.role.role) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', 'Artifact role is not canonical');
  }
  if (canonicalize(artifact.measurementContract) !== derived.canonicalJson
    || artifact.measurementContractSha256 !== derived.measurementContractSha256
    || artifact.proofBlockReason !== MODEL_FAILOVER_MEASUREMENT_NOT_ISSUED_REASON) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', 'Artifact measurement authority drifted');
  }
  for (const [label, checkpoint] of [
    ['artifact.contractPreflight', artifact.contractPreflight],
    ['artifact.contractPostflight', artifact.contractPostflight],
  ]) {
    exactKeys(checkpoint, [
      'measurementContractSha256',
      'canonicalJsonSha256',
      'sourcePins',
    ], label);
    if (checkpoint.measurementContractSha256 !== derived.measurementContractSha256
      || checkpoint.canonicalJsonSha256 !== sha256(derived.canonicalJson)
      || canonicalize(checkpoint.sourcePins) !== canonicalize(derived.contract.sourcePins)) {
      fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', `${label} drifted`);
    }
  }
  if (canonicalize(artifact.contractPreflight) !== canonicalize(artifact.contractPostflight)) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', 'Artifact contract changed during measurement');
  }

  validateInventorySnapshot(artifact.inventoryBefore, 'artifact.inventoryBefore', canonicalize);
  validateInventorySnapshot(artifact.inventoryAfter, 'artifact.inventoryAfter', canonicalize);
  for (const [label, snapshot] of [
    ['artifact.inventoryBefore', artifact.inventoryBefore],
    ['artifact.inventoryAfter', artifact.inventoryAfter],
  ]) {
    snapshot.models.forEach((model, index) => {
      if (model.canonicalName !== canonicalModelName(model.name)) {
        fail(
          'MODEL_MEASUREMENT_ARTIFACT_INVALID',
          `${label}.models[${index}] canonical identity drifted`,
        );
      }
    });
  }
  if (canonicalize(artifact.inventoryBefore) !== canonicalize(artifact.inventoryAfter)) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', 'Artifact inventory changed during measurement');
  }
  const candidateMatches = artifact.inventoryBefore.models.filter(model => (
    model.canonicalName === canonicalModelName(artifact.candidate.requestedModelName)
  ));
  if (candidateMatches.length !== 1
    || candidateMatches[0].name !== artifact.candidate.observedModelName
    || candidateMatches[0].canonicalName !== artifact.candidate.canonicalName
    || candidateMatches[0].digestSha256 !== artifact.candidate.digestSha256) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', 'Artifact candidate is not bound to inventory');
  }

  const roleContract = derived.contract.role;
  const suite = SUITES[roleContract.suite];
  if (!Array.isArray(artifact.results)
    || artifact.results.length !== roleContract.totalCount
    || artifact.provider.chatRequestCount !== roleContract.totalCount) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', 'Artifact result count is incomplete');
  }
  let passedCount = 0;
  let totalScore = 0;
  for (let index = 0; index < artifact.results.length; index++) {
    const result = artifact.results[index];
    const label = `artifact.results[${index}]`;
    exactKeys(result, [
      'index',
      'testId',
      'request',
      'response',
      'gradeContext',
      'passed',
      'score',
    ], label);
    if (result.index !== index || result.testId !== roleContract.orderedTestIds[index]) {
      fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', `${label} order or identity drifted`);
    }
    if (typeof result.passed !== 'boolean') {
      fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', `${label}.passed must be boolean`);
    }
    requireScore(result.score, `${label}.score`);
    if (result.gradeContext !== null) {
      exactKeys(result.gradeContext, ['_expected'], `${label}.gradeContext`);
      requireString(result.gradeContext._expected, `${label}.gradeContext._expected`, { maximum: 1024 });
    }
    validateRequest(result, derived.contract.runner, canonicalize, label);
    validateResponse(result, label);
    if (result.request.body.model !== artifact.candidate.observedModelName) {
      fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', `${label} used a different model`);
    }
    const definition = suite.tests[index];
    validatePromptProvenance(result, definition, canonicalize, label);
    let regraded;
    try {
      regraded = definition.grade(result.response.content, result.gradeContext);
    } catch {
      fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', `${label} cannot be regraded`);
    }
    if (!isPlainRecord(regraded)
      || regraded.passed !== result.passed
      || regraded.score !== result.score) {
      fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', `${label} grade mismatch`);
    }
    if (result.passed) passedCount++;
    totalScore += result.score;
  }
  exactKeys(artifact.aggregate, ['score', 'passedCount', 'totalCount'], 'artifact.aggregate');
  const expectedScore = totalScore / artifact.results.length;
  if (artifact.aggregate.totalCount !== artifact.results.length
    || artifact.aggregate.passedCount !== passedCount
    || artifact.aggregate.score !== expectedScore) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', 'Artifact aggregate mismatch');
  }
  if (canonicalize(artifact.effectBoundary) !== canonicalize(exactEffectBoundary())) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', 'Artifact effect boundary drifted');
  }
  if (expectedPins && artifact.candidate.role !== expectedPins.role) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', 'Artifact role differs from parent expectation');
  }
  if (expectedPins && artifact.candidate.requestedModelName !== expectedPins.modelName) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', 'Artifact model differs from parent expectation');
  }
  if (expectedPins && artifact.candidate.digestSha256 !== expectedPins.digestSha256) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', 'Artifact digest differs from parent expectation');
  }
  if (expectedPins && providerOrigin !== expectedPins.providerOrigin) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', 'Artifact provider differs from parent expectation');
  }
  if (expectedPins && artifact.sourceRevisionClaim !== expectedPins.sourceRevisionClaim) {
    fail('MODEL_MEASUREMENT_ARTIFACT_INVALID', 'Artifact source claim differs from parent expectation');
  }
  return Object.freeze({
    valid: true,
    validationScope: expectedPins ? 'PARENT_PINS_VERIFIED' : 'STRUCTURAL_ONLY',
    measurementStatus: 'COMPLETE',
    proofStatus: 'NOT_ISSUED',
  });
}

async function writeImmutableArtifact(runDirectory, canonicalJson, beforePublish) {
  const finalPath = path.join(runDirectory, ARTIFACT_FILE);
  const temporaryPath = path.join(runDirectory, `.measurement-${randomUUID()}.tmp`);
  let handle = null;
  try {
    handle = await open(
      temporaryPath,
      fsConstants.O_CREAT
        | fsConstants.O_EXCL
        | fsConstants.O_WRONLY
        | fsConstants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile(canonicalJson, 'utf8');
    await handle.chmod(0o400);
    await handle.sync();
    await handle.close();
    handle = null;
    const metadata = await lstat(temporaryPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o400) {
      fail('MODEL_MEASUREMENT_ARTIFACT_WRITE_FAILED', 'Staged artifact is not a private regular file');
    }
    const persisted = await readFile(temporaryPath, 'utf8');
    if (persisted !== canonicalJson) {
      fail('MODEL_MEASUREMENT_ARTIFACT_WRITE_FAILED', 'Staged artifact failed read-back validation');
    }
    const publication = Object.freeze({
      path: finalPath,
      sha256: sha256(persisted),
      byteLength: Buffer.byteLength(persisted),
    });
    await syncDirectory(runDirectory);
    // The parent-facing summary is flushed before publication. It is only a
    // candidate locator: consumers must also require exit 0 and the exact file.
    // The summary is not an acceptance signal until the child exits 0.
    await beforePublish(publication);
    // The non-clobber hard link is the publication commit point. Both paths
    // refer to the already fsynced, validated read-only inode; the namespace
    // changes become durable only after the post-link directory fsync.
    await link(temporaryPath, finalPath);
    await unlink(temporaryPath);
    await syncDirectory(runDirectory);
    return publication;
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporaryPath).catch(() => {});
    throw new ModelFailoverMeasurementError(
      'MODEL_MEASUREMENT_ARTIFACT_WRITE_FAILED',
      'Cannot publish immutable measurement artifact',
      { cause: error },
    );
  }
}

async function syncDirectory(directory) {
  const directoryHandle = await open(directory, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY);
  try {
    await directoryHandle.sync();
  } finally {
    await directoryHandle.close();
  }
}

async function writeSuccessSummary(runId, published) {
  const line = `${JSON.stringify({
    schemaVersion: 1,
    measurementStatus: 'COMPLETE',
    proofStatus: 'NOT_ISSUED',
    runId,
    artifactPath: published.path,
    artifactSha256: published.sha256,
    artifactByteLength: published.byteLength,
  })}\n`;
  await new Promise((resolve, reject) => {
    process.stdout.write(line, error => error ? reject(error) : resolve());
  });
}

async function main() {
  process.umask(0o077);
  const startupEnvironmentKeys = requireCleanStartupEnvironment();
  const input = parseCli(process.argv.slice(2));
  const sourceRevisionClaim = captureSourceRevisionClaim();
  const run = await createRunDirectory();
  const environmentKeys = scrubEnvironment(run.runDirectory, sourceRevisionClaim);
  const measurement = await executeMeasurement(
    input,
    run,
    environmentKeys,
    startupEnvironmentKeys,
  );
  await writeImmutableArtifact(
    run.runDirectory,
    measurement.canonicalJson,
    published => writeSuccessSummary(run.runId, published),
  );
}

function renderError(error) {
  const code = error instanceof ModelFailoverMeasurementError
    ? error.code
    : 'MODEL_MEASUREMENT_UNEXPECTED_FAILURE';
  return JSON.stringify({
    schemaVersion: 1,
    measurementStatus: 'FAILED',
    proofStatus: 'NOT_ISSUED',
    code,
    message: error?.message || String(error),
  });
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === SCRIPT_PATH) {
  main().catch(error => {
    process.stderr.write(`${renderError(error)}\n`);
    process.exitCode = 1;
  });
}
