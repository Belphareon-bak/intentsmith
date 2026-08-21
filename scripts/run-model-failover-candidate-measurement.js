#!/usr/bin/env node

// Parent authority for one model failover measurement.
//
// The child executor owns prompt/result capture. This parent owns the clean
// Git candidate, the exact provider inventory identity, child process result,
// immutable file boundary and the complete five-pin validation. It still does
// not issue a proof or mutate DB, bindings, config, runtime or broadcasts.

import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import {
  constants as fsConstants,
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));
const GIT_BINARY = '/usr/bin/git';
const CHILD_RELATIVE_PATH = 'scripts/run-model-failover-measurement.js';
const ARTIFACT_ROOT_RELATIVE = '.intentsmith-artifacts/model-failover-candidate-measurements';
const ACCEPTANCE_FILE = 'acceptance.json';
const SOURCE_EXPORT_DIRECTORY = 'source';
const SOURCE_EXPORT_ARTIFACT_RELATIVE = '.intentsmith-artifacts/child';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REVISION_PATTERN = /^[a-f0-9]{40}$/;
const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MODEL_NAME_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,190}:[a-z0-9][a-z0-9._-]{0,63}$/i;
const ROLES = new Set(['D1', 'D2', 'CODE', 'R1', 'R2', 'CHAT', 'VISION']);
const MAX_PROVIDER_BODY_BYTES = 4 * 1024 * 1024;
const MAX_CHILD_OUTPUT_BYTES = 64 * 1024;
const INVENTORY_TIMEOUT_MS = 5_000;
const CHILD_TIMEOUT_MS = 15 * 60 * 1000;
const CLI_FIELDS = Object.freeze({
  '--role': 'role',
  '--proposed-model-name': 'proposedModelName',
});
const CANDIDATE_SOURCE_PATHS = Object.freeze([
  'package.json',
  'scripts/run-model-failover-candidate-measurement.js',
  'scripts/run-model-failover-measurement.js',
  'src/config.js',
  'src/core/logger.js',
  'src/db/user-settings.js',
  'src/timeout-policy.js',
  'src/upgrade/model-failover-proof-policy.js',
  'src/upgrade/model-failover.js',
  'src/upgrade/model-identity.js',
  'src/upgrade/model-profiles.js',
  'src/upgrade/validation-suites.js',
]);
const CHILD_SUMMARY_KEYS = Object.freeze([
  'schemaVersion',
  'measurementStatus',
  'proofStatus',
  'runId',
  'artifactPath',
  'artifactSha256',
  'artifactByteLength',
]);

export class ModelFailoverCandidateMeasurementError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'ModelFailoverCandidateMeasurementError';
    this.code = code;
    this.details = options.details || null;
  }
}

function fail(code, message, details = null) {
  throw new ModelFailoverCandidateMeasurementError(code, message, { details });
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
  if (!isPlainRecord(value)) {
    fail('MODEL_CANDIDATE_MEASUREMENT_INVALID', `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail('MODEL_CANDIDATE_MEASUREMENT_INVALID', `${label} fields drifted`, {
      actual,
      expected: wanted,
    });
  }
}

function normalizeDigest(value) {
  const normalized = String(value || '').replace(/^sha256:/i, '').toLowerCase();
  return SHA256_PATTERN.test(normalized) ? normalized : null;
}

function requireString(value, label, { maximum = 512 } = {}) {
  if (typeof value !== 'string') {
    fail('MODEL_CANDIDATE_MEASUREMENT_INPUT_INVALID', `${label} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    fail('MODEL_CANDIDATE_MEASUREMENT_INPUT_INVALID', `${label} has an invalid length`);
  }
  return normalized;
}

function requireSafeInteger(value, label, { minimum = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail('MODEL_CANDIDATE_MEASUREMENT_INVALID', `${label} must be an integer >= ${minimum}`);
  }
  return value;
}

function requireInput(inputValue) {
  exactKeys(inputValue, ['proposedModelName', 'role'], 'candidate input');
  const role = requireString(inputValue.role, 'role', { maximum: 16 });
  if (role !== role.toUpperCase() || !ROLES.has(role)) {
    fail('MODEL_CANDIDATE_MEASUREMENT_INPUT_INVALID', 'role must be a canonical model role');
  }
  const proposedModelName = requireString(
    inputValue.proposedModelName,
    'proposedModelName',
    { maximum: 256 },
  );
  if (!MODEL_NAME_PATTERN.test(proposedModelName)) {
    fail(
      'MODEL_CANDIDATE_MEASUREMENT_INPUT_INVALID',
      'proposedModelName must use an explicit provider tag',
    );
  }
  return Object.freeze({ role, proposedModelName });
}

async function loadParentAuthorities(sourceRoot = REPOSITORY_ROOT) {
  const [childModule, configModule, identityModule, policyModule] = await Promise.all([
    import(pathToFileURL(path.join(sourceRoot, CHILD_RELATIVE_PATH)).href),
    import(pathToFileURL(path.join(sourceRoot, 'src/config.js')).href),
    import(pathToFileURL(path.join(sourceRoot, 'src/upgrade/model-identity.js')).href),
    import(pathToFileURL(path.join(sourceRoot, 'src/upgrade/model-failover-proof-policy.js')).href),
  ]);
  return Object.freeze({
    config: configModule.config,
    canonicalModelName: identityModule.canonicalModelName,
    canonicalize: policyModule.canonicalizeModelFailoverContract,
    requireExactLoopbackProviderOrigin: childModule.requireExactLoopbackProviderOrigin,
    validateModelFailoverMeasurementArtifact: childModule.validateModelFailoverMeasurementArtifact,
  });
}

function configuredProviderOrigin(config, requireExactLoopbackProviderOrigin) {
  const configured = config.ollama?.baseUrl;
  let providerOrigin;
  try {
    providerOrigin = requireExactLoopbackProviderOrigin(configured);
  } catch (error) {
    throw new ModelFailoverCandidateMeasurementError(
      'MODEL_CANDIDATE_MEASUREMENT_PROVIDER_INVALID',
      'Configured Ollama authority must be an exact HTTP 127.0.0.1 origin',
      { cause: error },
    );
  }
  return providerOrigin;
}

function parseCli(argv) {
  if (!Array.isArray(argv) || argv.length !== Object.keys(CLI_FIELDS).length * 2) {
    fail(
      'MODEL_CANDIDATE_MEASUREMENT_INPUT_INVALID',
      'Exactly two named candidate measurement arguments are required',
    );
  }
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const field = CLI_FIELDS[argv[index]];
    if (!field || Object.hasOwn(parsed, field)) {
      fail(
        'MODEL_CANDIDATE_MEASUREMENT_INPUT_INVALID',
        'Unknown or duplicate candidate measurement argument',
      );
    }
    parsed[field] = argv[index + 1];
  }
  return requireInput(parsed);
}

function requireCleanParentRuntime() {
  const nodeOptions = process.env.NODE_OPTIONS || '';
  if (process.execArgv.length !== 0 || nodeOptions.trim() !== '') {
    fail(
      'MODEL_CANDIDATE_MEASUREMENT_PARENT_RUNTIME_INVALID',
      'Candidate measurement parent rejects inherited Node execution hooks',
      {
        execArgvCount: process.execArgv.length,
        nodeOptionsPresent: nodeOptions.trim() !== '',
      },
    );
  }
}

function git(args, cwd) {
  try {
    return execFileSync(GIT_BINARY, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
        PATH: '/usr/bin:/bin',
        TZ: 'UTC',
      },
    }).trimEnd();
  } catch (error) {
    throw new ModelFailoverCandidateMeasurementError(
      'MODEL_CANDIDATE_MEASUREMENT_GIT_FAILED',
      'Unable to derive candidate Git state',
      { cause: error },
    );
  }
}

function gitBytes(args, cwd) {
  try {
    return execFileSync(GIT_BINARY, args, {
      cwd,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
        PATH: '/usr/bin:/bin',
        TZ: 'UTC',
      },
    });
  } catch (error) {
    throw new ModelFailoverCandidateMeasurementError(
      'MODEL_CANDIDATE_MEASUREMENT_GIT_FAILED',
      'Unable to read candidate Git object bytes',
      { cause: error },
    );
  }
}

async function requireCanonicalSourceRoot(requestedRoot) {
  const requested = await realpath(requestedRoot);
  const discovered = await realpath(git(['rev-parse', '--show-toplevel'], requested));
  if (requested !== discovered) {
    fail(
      'MODEL_CANDIDATE_MEASUREMENT_SOURCE_ROOT_INVALID',
      'Candidate measurement must run from a canonical Git worktree root',
    );
  }
  return requested;
}

function sourceState(sourceRoot) {
  const revision = git(['rev-parse', 'HEAD'], sourceRoot);
  if (!REVISION_PATTERN.test(revision)) {
    fail(
      'MODEL_CANDIDATE_MEASUREMENT_SOURCE_REVISION_INVALID',
      'Candidate revision must be a full lowercase Git SHA',
    );
  }
  try {
    git(['ls-files', '--error-unmatch', '--', ...CANDIDATE_SOURCE_PATHS], sourceRoot);
  } catch (error) {
    throw new ModelFailoverCandidateMeasurementError(
      'MODEL_CANDIDATE_MEASUREMENT_SOURCE_UNTRACKED',
      'Candidate measurement source closure is not fully tracked at HEAD',
      { cause: error },
    );
  }
  const porcelain = git([
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '--ignored=matching',
    '--',
    'src',
    'scripts',
    'tests',
    'package.json',
  ], sourceRoot);
  return Object.freeze({
    revision,
    clean: porcelain === '',
    dirtyEntryCount: porcelain === '' ? 0 : porcelain.split('\n').length,
  });
}

function requireCleanCandidateState(state, expectedRevision = null) {
  if (!state.clean || (expectedRevision !== null && state.revision !== expectedRevision)) {
    fail(
      'MODEL_CANDIDATE_MEASUREMENT_SOURCE_DIRTY',
      'Candidate source revision or porcelain changed',
      {
        revisionMatches: expectedRevision === null || state.revision === expectedRevision,
        dirtyEntryCount: state.dirtyEntryCount,
      },
    );
  }
}

function isPathInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

async function inspectPrivateDirectory(directory, label) {
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    fail('MODEL_CANDIDATE_MEASUREMENT_ARTIFACT_BOUNDARY_INVALID', `${label} is not a real directory`);
  }
  if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) {
    fail('MODEL_CANDIDATE_MEASUREMENT_ARTIFACT_BOUNDARY_INVALID', `${label} has a foreign owner`);
  }
  if ((metadata.mode & 0o077) !== 0) await chmod(directory, 0o700);
  const checked = await lstat(directory);
  if ((checked.mode & 0o777) !== 0o700) {
    fail('MODEL_CANDIDATE_MEASUREMENT_ARTIFACT_BOUNDARY_INVALID', `${label} is not mode 0700`);
  }
}

async function requirePrivateDirectory(directory, label) {
  const metadata = await lstat(directory);
  if (!metadata.isDirectory()
    || metadata.isSymbolicLink()
    || (metadata.mode & 0o777) !== 0o700
    || (typeof process.getuid === 'function' && metadata.uid !== process.getuid())) {
    fail(
      'MODEL_CANDIDATE_MEASUREMENT_ARTIFACT_BOUNDARY_INVALID',
      `${label} must remain an owned real mode-0700 directory`,
    );
  }
}

async function ensureOwnedArtifactBase(sourceRoot) {
  const sourceCanonical = await realpath(sourceRoot);
  let current = sourceCanonical;
  for (const segment of ARTIFACT_ROOT_RELATIVE.split('/')) {
    current = path.join(current, segment);
    try {
      await mkdir(current, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
    await inspectPrivateDirectory(current, `artifact directory ${segment}`);
  }
  const canonical = await realpath(current);
  if (!isPathInside(sourceCanonical, canonical)) {
    fail(
      'MODEL_CANDIDATE_MEASUREMENT_ARTIFACT_BOUNDARY_INVALID',
      'Candidate artifact root escaped the source repository',
    );
  }
  return canonical;
}

async function createParentRunDirectory(sourceRoot) {
  const base = await ensureOwnedArtifactBase(sourceRoot);
  const parentRunId = randomUUID();
  const runDirectory = path.join(base, `parent-${parentRunId}`);
  const sourceExportRoot = path.join(runDirectory, SOURCE_EXPORT_DIRECTORY);
  const childArtifactRoot = path.join(sourceExportRoot, ...SOURCE_EXPORT_ARTIFACT_RELATIVE.split('/'));
  await mkdir(runDirectory, { mode: 0o700 });
  await inspectPrivateDirectory(runDirectory, 'candidate parent run directory');
  await mkdir(sourceExportRoot, { mode: 0o700 });
  await inspectPrivateDirectory(sourceExportRoot, 'candidate source export root');
  return Object.freeze({ parentRunId, runDirectory, sourceExportRoot, childArtifactRoot });
}

async function validateParentRunBoundary(sourceRoot, run) {
  let ownedDirectory = sourceRoot;
  for (const segment of ARTIFACT_ROOT_RELATIVE.split('/')) {
    ownedDirectory = path.join(ownedDirectory, segment);
    await requirePrivateDirectory(ownedDirectory, `artifact directory ${segment}`);
  }
  await requirePrivateDirectory(run.runDirectory, 'candidate parent run directory');
  await requirePrivateDirectory(run.sourceExportRoot, 'candidate source export root');
  const [sourceCanonical, runCanonical, exportCanonical] = await Promise.all([
    realpath(sourceRoot),
    realpath(run.runDirectory),
    realpath(run.sourceExportRoot),
  ]);
  if (runCanonical !== path.resolve(run.runDirectory)
    || exportCanonical !== path.resolve(run.sourceExportRoot)
    || !isPathInside(sourceCanonical, runCanonical)
    || !isPathInside(runCanonical, exportCanonical)) {
    fail(
      'MODEL_CANDIDATE_MEASUREMENT_ARTIFACT_BOUNDARY_INVALID',
      'Candidate parent run boundary escaped or changed identity',
    );
  }
}

async function writeExportedSourceFile(sourceRoot, exportRoot, revision, relativePath) {
  const treeEntry = git(['ls-tree', revision, '--', relativePath], sourceRoot);
  const match = /^(100644) blob ([a-f0-9]{40})\t(.+)$/.exec(treeEntry);
  if (!match || match[3] !== relativePath) {
    fail(
      'MODEL_CANDIDATE_MEASUREMENT_SOURCE_EXPORT_INVALID',
      `Candidate source ${relativePath} is not one regular mode-100644 blob`,
    );
  }
  const bytes = gitBytes(['show', `${revision}:${relativePath}`], sourceRoot);
  const target = path.join(exportRoot, ...relativePath.split('/'));
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  let handle;
  try {
    handle = await open(
      target,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile(bytes);
    await handle.chmod(0o400);
    await handle.sync();
  } finally {
    await handle?.close();
  }
  return Object.freeze({
    path: relativePath,
    byteLength: bytes.length,
    sha256: sha256(bytes),
  });
}

async function createCandidateSourceExport(sourceRoot, exportRoot, revision) {
  const entries = [];
  for (const relativePath of CANDIDATE_SOURCE_PATHS) {
    entries.push(await writeExportedSourceFile(sourceRoot, exportRoot, revision, relativePath));
  }
  await mkdir(path.join(exportRoot, '.intentsmith-artifacts'), { mode: 0o700 });
  await inspectPrivateDirectory(
    path.join(exportRoot, '.intentsmith-artifacts'),
    'exported source artifact root',
  );
  return Object.freeze(entries);
}

async function validateCandidateSourceExport(exportRoot, manifest) {
  const expected = new Map(manifest.map(entry => [entry.path, entry]));
  const found = [];
  const visit = async (directory, prefix = '') => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const candidate = path.join(directory, entry.name);
      if (relativePath === '.intentsmith-artifacts') {
        await requirePrivateDirectory(candidate, 'exported source artifact root');
        continue;
      }
      if (entry.isSymbolicLink()) {
        fail(
          'MODEL_CANDIDATE_MEASUREMENT_SOURCE_EXPORT_INVALID',
          'Candidate source export contains a symbolic link',
        );
      }
      if (entry.isDirectory()) {
        const metadata = await lstat(candidate);
        if ((metadata.mode & 0o777) !== 0o700
          || (typeof process.getuid === 'function' && metadata.uid !== process.getuid())) {
          fail(
            'MODEL_CANDIDATE_MEASUREMENT_SOURCE_EXPORT_INVALID',
            'Candidate source export directory metadata drifted',
          );
        }
        await visit(candidate, relativePath);
        continue;
      }
      if (!entry.isFile()) {
        fail(
          'MODEL_CANDIDATE_MEASUREMENT_SOURCE_EXPORT_INVALID',
          'Candidate source export contains an unsupported entry',
        );
      }
      found.push(relativePath);
      const wanted = expected.get(relativePath);
      const [metadata, bytes] = await Promise.all([lstat(candidate), readFile(candidate)]);
      if (!wanted
        || !metadata.isFile()
        || metadata.isSymbolicLink()
        || (metadata.mode & 0o777) !== 0o400
        || metadata.nlink !== 1
        || (typeof process.getuid === 'function' && metadata.uid !== process.getuid())
        || metadata.size !== wanted.byteLength
        || bytes.length !== wanted.byteLength
        || sha256(bytes) !== wanted.sha256) {
        fail(
          'MODEL_CANDIDATE_MEASUREMENT_SOURCE_EXPORT_INVALID',
          `Candidate source export file ${relativePath} drifted`,
        );
      }
    }
  };
  await visit(exportRoot);
  if (found.sort().join('\n') !== [...expected.keys()].sort().join('\n')) {
    fail(
      'MODEL_CANDIDATE_MEASUREMENT_SOURCE_EXPORT_INVALID',
      'Candidate source export inventory drifted',
    );
  }
}

async function createChildArtifactRoot(childArtifactRoot) {
  await mkdir(childArtifactRoot, { mode: 0o700 });
  await inspectPrivateDirectory(childArtifactRoot, 'candidate child artifact root');
}

async function readBoundedResponse(response) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    fail('MODEL_CANDIDATE_MEASUREMENT_PROVIDER_INVALID', 'Provider response body is unavailable');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > MAX_PROVIDER_BODY_BYTES) {
        await reader.cancel();
        fail('MODEL_CANDIDATE_MEASUREMENT_PROVIDER_INVALID', 'Provider inventory exceeded 4 MiB');
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total));
  } catch {
    fail('MODEL_CANDIDATE_MEASUREMENT_PROVIDER_INVALID', 'Provider inventory is not valid UTF-8');
  }
}

async function fetchProviderInventory(providerOrigin, { canonicalModelName, canonicalize }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INVENTORY_TIMEOUT_MS);
  try {
    const response = await globalThis.fetch(`${providerOrigin}/api/tags`, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
    });
    const rawBody = await readBoundedResponse(response);
    if (!response.ok) {
      fail(
        'MODEL_CANDIDATE_MEASUREMENT_PROVIDER_HTTP_ERROR',
        `Provider returned HTTP ${response.status}`,
        { status: response.status },
      );
    }
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      fail('MODEL_CANDIDATE_MEASUREMENT_PROVIDER_INVALID', 'Provider inventory is not JSON');
    }
    if (!isPlainRecord(payload) || !Array.isArray(payload.models)) {
      fail('MODEL_CANDIDATE_MEASUREMENT_PROVIDER_INVALID', 'Provider inventory shape is invalid');
    }
    const models = payload.models.map((entry, index) => {
      if (!isPlainRecord(entry)) {
        fail('MODEL_CANDIDATE_MEASUREMENT_PROVIDER_INVALID', `Inventory entry ${index} is invalid`);
      }
      const name = requireString(entry.name, `inventory[${index}].name`, { maximum: 256 });
      const canonicalName = canonicalModelName(name);
      const digestSha256 = normalizeDigest(entry.digest);
      if (!canonicalName || !digestSha256) {
        fail(
          'MODEL_CANDIDATE_MEASUREMENT_PROVIDER_INVALID',
          `Inventory entry ${index} lacks exact identity`,
        );
      }
      return { name, canonicalName, digestSha256 };
    }).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    if (new Set(models.map(model => model.name)).size !== models.length) {
      fail('MODEL_CANDIDATE_MEASUREMENT_PROVIDER_INVALID', 'Provider inventory has duplicate names');
    }
    const canonicalJson = canonicalize(models);
    return Object.freeze({ models, sha256: sha256(canonicalJson) });
  } catch (error) {
    if (error instanceof ModelFailoverCandidateMeasurementError) throw error;
    if (error?.name === 'AbortError') {
      fail('MODEL_CANDIDATE_MEASUREMENT_PROVIDER_TIMEOUT', 'Provider inventory timed out');
    }
    throw new ModelFailoverCandidateMeasurementError(
      'MODEL_CANDIDATE_MEASUREMENT_PROVIDER_FAILED',
      'Provider inventory request failed',
      { cause: error },
    );
  } finally {
    clearTimeout(timer);
  }
}

function selectCandidate(inventory, requestedModelName, canonicalModelName) {
  const requestedCanonical = canonicalModelName(requestedModelName);
  const matches = inventory.models.filter(model => model.canonicalName === requestedCanonical);
  if (matches.length !== 1) {
    fail(
      'MODEL_CANDIDATE_MEASUREMENT_CANDIDATE_AMBIGUOUS',
      'Parent inventory must contain exactly one canonical candidate',
      { matchCount: matches.length },
    );
  }
  return Object.freeze({ ...matches[0] });
}

function collectBounded(stream, child, label) {
  const chunks = [];
  let total = 0;
  let overflow = null;
  stream.on('data', chunkValue => {
    if (overflow) return;
    const chunk = Buffer.from(chunkValue);
    total += chunk.length;
    if (total > MAX_CHILD_OUTPUT_BYTES) {
      overflow = new Error(`${label} exceeded ${MAX_CHILD_OUTPUT_BYTES} bytes`);
      child.kill('SIGKILL');
      return;
    }
    chunks.push(chunk);
  });
  return {
    bytes: () => Buffer.concat(chunks, total),
    overflow: () => overflow,
  };
}

async function spawnMeasurementChild({
  sourceRoot,
  childArtifactRoot,
  input,
  providerOrigin,
  digestSha256,
  revision,
}) {
  const childPath = path.join(sourceRoot, CHILD_RELATIVE_PATH);
  const childMetadata = await lstat(childPath);
  if (!childMetadata.isFile() || childMetadata.isSymbolicLink()) {
    fail(
      'MODEL_CANDIDATE_MEASUREMENT_CHILD_INVALID',
      'Measurement child is not a regular source file',
    );
  }
  const args = [
    childPath,
    '--role', input.role,
    '--model-name', input.proposedModelName,
    '--digest-sha256', digestSha256,
    '--provider-origin', providerOrigin,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: sourceRoot,
      env: {
        INTENTSMITH_TEST_ARTIFACT_DIR: childArtifactRoot,
        INTENTSMITH_TEST_SOURCE_REVISION: revision,
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
        TZ: 'UTC',
      },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = collectBounded(child.stdout, child, 'measurement child stdout');
    const stderr = collectBounded(child.stderr, child, 'measurement child stderr');
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, CHILD_TIMEOUT_MS);
    child.once('error', error => {
      clearTimeout(timer);
      reject(new ModelFailoverCandidateMeasurementError(
        'MODEL_CANDIDATE_MEASUREMENT_CHILD_SPAWN_FAILED',
        'Unable to spawn measurement child',
        { cause: error },
      ));
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      const outputError = stdout.overflow() || stderr.overflow();
      if (outputError) {
        reject(new ModelFailoverCandidateMeasurementError(
          'MODEL_CANDIDATE_MEASUREMENT_CHILD_OUTPUT_INVALID',
          outputError.message,
          { cause: outputError },
        ));
        return;
      }
      if (timedOut) {
        reject(new ModelFailoverCandidateMeasurementError(
          'MODEL_CANDIDATE_MEASUREMENT_CHILD_TIMEOUT',
          `Measurement child exceeded ${CHILD_TIMEOUT_MS}ms`,
        ));
        return;
      }
      resolve(Object.freeze({
        code,
        signal,
        stdoutBytes: stdout.bytes(),
        stderrBytes: stderr.bytes(),
      }));
    });
  });
}

function decodeUtf8(bytes, label) {
  if (!Buffer.isBuffer(bytes)) {
    fail('MODEL_CANDIDATE_MEASUREMENT_CHILD_OUTPUT_INVALID', `${label} must be bytes`);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail('MODEL_CANDIDATE_MEASUREMENT_CHILD_OUTPUT_INVALID', `${label} is not valid UTF-8`);
  }
}

export function parseModelFailoverMeasurementChildSummary(result) {
  exactKeys(result, ['code', 'signal', 'stderrBytes', 'stdoutBytes'], 'child result');
  if (result.code !== 0 || result.signal !== null) {
    fail(
      'MODEL_CANDIDATE_MEASUREMENT_CHILD_FAILED',
      'Measurement child did not exit successfully',
      { code: result.code, signal: result.signal },
    );
  }
  const stderr = decodeUtf8(result.stderrBytes, 'child stderr');
  if (stderr !== '') {
    fail('MODEL_CANDIDATE_MEASUREMENT_CHILD_OUTPUT_INVALID', 'Successful child wrote stderr');
  }
  const stdout = decodeUtf8(result.stdoutBytes, 'child stdout');
  if (!stdout.endsWith('\n') || stdout.includes('\r')) {
    fail(
      'MODEL_CANDIDATE_MEASUREMENT_CHILD_OUTPUT_INVALID',
      'Child stdout must be one LF-terminated JSON line',
    );
  }
  const lines = stdout.slice(0, -1).split('\n');
  if (lines.length !== 1 || lines[0].length === 0) {
    fail(
      'MODEL_CANDIDATE_MEASUREMENT_CHILD_OUTPUT_INVALID',
      'Child stdout must contain exactly one JSON line',
    );
  }
  let summary;
  try {
    summary = JSON.parse(lines[0]);
  } catch {
    fail('MODEL_CANDIDATE_MEASUREMENT_CHILD_OUTPUT_INVALID', 'Child summary is not JSON');
  }
  exactKeys(summary, CHILD_SUMMARY_KEYS, 'child summary');
  if (summary.schemaVersion !== 1
    || summary.measurementStatus !== 'COMPLETE'
    || summary.proofStatus !== 'NOT_ISSUED'
    || !RUN_ID_PATTERN.test(summary.runId || '')
    || typeof summary.artifactPath !== 'string'
    || !path.isAbsolute(summary.artifactPath)
    || !SHA256_PATTERN.test(summary.artifactSha256 || '')
    || !Number.isSafeInteger(summary.artifactByteLength)
    || summary.artifactByteLength < 1) {
    fail('MODEL_CANDIDATE_MEASUREMENT_CHILD_OUTPUT_INVALID', 'Child summary values are invalid');
  }
  return Object.freeze({ ...summary });
}

async function findMeasurementFiles(root) {
  const found = [];
  const visit = async directory => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        fail(
          'MODEL_CANDIDATE_MEASUREMENT_ARTIFACT_BOUNDARY_INVALID',
          'Child artifact tree contains a symbolic link',
        );
      }
      if (entry.isDirectory()) await visit(candidate);
      else if (entry.isFile() && entry.name === 'measurement.json') found.push(candidate);
    }
  };
  await visit(root);
  return found.sort();
}

export async function validateModelFailoverMeasurementChildResult({
  sourceRoot,
  childArtifactRoot,
  result,
  expectedPins,
  expectedInventory,
  authorities: providedAuthorities = null,
}) {
  const authorities = providedAuthorities || await loadParentAuthorities(sourceRoot);
  const { canonicalize } = authorities;
  const summary = parseModelFailoverMeasurementChildSummary(result);
  const expectedPath = path.join(childArtifactRoot, `run-${summary.runId}`, 'measurement.json');
  if (path.resolve(summary.artifactPath) !== expectedPath) {
    fail(
      'MODEL_CANDIDATE_MEASUREMENT_ARTIFACT_BOUNDARY_INVALID',
      'Child summary points outside its exact owned run path',
    );
  }
  await requirePrivateDirectory(childArtifactRoot, 'candidate child artifact root');
  await requirePrivateDirectory(path.dirname(expectedPath), 'candidate child run directory');
  const files = await findMeasurementFiles(childArtifactRoot);
  if (files.length !== 1 || files[0] !== expectedPath) {
    fail(
      'MODEL_CANDIDATE_MEASUREMENT_ARTIFACT_COUNT_INVALID',
      'Child must publish exactly one measurement artifact',
      { count: files.length },
    );
  }
  const [sourceCanonical, rootCanonical, fileCanonical] = await Promise.all([
    realpath(sourceRoot),
    realpath(childArtifactRoot),
    realpath(expectedPath),
  ]);
  if (!isPathInside(sourceCanonical, rootCanonical)
    || !isPathInside(rootCanonical, fileCanonical)
    || fileCanonical !== expectedPath) {
    fail(
      'MODEL_CANDIDATE_MEASUREMENT_ARTIFACT_BOUNDARY_INVALID',
      'Child artifact resolved outside its owned boundary',
    );
  }
  const metadata = await lstat(expectedPath);
  if (!metadata.isFile()
    || metadata.isSymbolicLink()
    || (metadata.mode & 0o777) !== 0o400
    || metadata.nlink !== 1
    || (typeof process.getuid === 'function' && metadata.uid !== process.getuid())) {
    fail(
      'MODEL_CANDIDATE_MEASUREMENT_ARTIFACT_METADATA_INVALID',
      'Child artifact must be an owned regular mode-0400 single-link file',
    );
  }
  const bytes = await readFile(expectedPath);
  if (bytes.length !== summary.artifactByteLength
    || bytes.length !== metadata.size
    || sha256(bytes) !== summary.artifactSha256) {
    fail(
      'MODEL_CANDIDATE_MEASUREMENT_ARTIFACT_DIGEST_INVALID',
      'Child artifact bytes differ from its process summary',
    );
  }
  const text = decodeUtf8(bytes, 'measurement artifact');
  let artifact;
  try {
    artifact = JSON.parse(text);
  } catch {
    fail('MODEL_CANDIDATE_MEASUREMENT_ARTIFACT_INVALID', 'Child artifact is not JSON');
  }
  let validation;
  try {
    validation = await authorities.validateModelFailoverMeasurementArtifact(artifact, expectedPins);
  } catch (error) {
    throw new ModelFailoverCandidateMeasurementError(
      'MODEL_CANDIDATE_MEASUREMENT_ARTIFACT_INVALID',
      'Child artifact failed exact parent-pin validation',
      { cause: error },
    );
  }
  if (validation.validationScope !== 'PARENT_PINS_VERIFIED'
    || artifact.runId !== summary.runId
    || canonicalize(artifact.inventoryBefore) !== canonicalize(expectedInventory)
    || canonicalize(artifact.inventoryAfter) !== canonicalize(expectedInventory)) {
    fail(
      'MODEL_CANDIDATE_MEASUREMENT_ARTIFACT_INVALID',
      'Child artifact does not match parent inventory authority',
    );
  }
  return Object.freeze({ summary, artifact, validation, bytes });
}

function validateReceiptInventory(snapshot, label, { canonicalModelName, canonicalize }) {
  exactKeys(snapshot, ['models', 'sha256'], label);
  if (!Array.isArray(snapshot.models) || !SHA256_PATTERN.test(snapshot.sha256 || '')) {
    fail('MODEL_CANDIDATE_MEASUREMENT_ACCEPTANCE_INVALID', `${label} shape is invalid`);
  }
  let previousName = null;
  const names = new Set();
  for (let index = 0; index < snapshot.models.length; index++) {
    const model = snapshot.models[index];
    exactKeys(model, ['canonicalName', 'digestSha256', 'name'], `${label}.models[${index}]`);
    const name = requireString(model.name, `${label}.models[${index}].name`, { maximum: 256 });
    if (previousName !== null && previousName >= name) {
      fail('MODEL_CANDIDATE_MEASUREMENT_ACCEPTANCE_INVALID', `${label} is not strictly sorted`);
    }
    previousName = name;
    if (names.has(name)
      || model.canonicalName !== canonicalModelName(name)
      || !SHA256_PATTERN.test(model.digestSha256 || '')) {
      fail('MODEL_CANDIDATE_MEASUREMENT_ACCEPTANCE_INVALID', `${label} identity is invalid`);
    }
    names.add(name);
  }
  if (sha256(canonicalize(snapshot.models)) !== snapshot.sha256) {
    fail('MODEL_CANDIDATE_MEASUREMENT_ACCEPTANCE_INVALID', `${label} digest is invalid`);
  }
}

export async function validateModelFailoverCandidateAcceptance(
  acceptance,
  providedAuthorities = null,
  expectedAuthority = null,
) {
  const authorities = providedAuthorities || await loadParentAuthorities();
  exactKeys(acceptance, [
    'schemaVersion',
    'artifactKind',
    'acceptanceStatus',
    'measurementStatus',
    'proofStatus',
    'parentRunId',
    'parent',
    'source',
    'provider',
    'candidate',
    'measurement',
    'startedAtMs',
    'completedAtMs',
    'durationMs',
    'effectBoundary',
  ], 'candidate acceptance');
  if (acceptance.schemaVersion !== 1
    || acceptance.artifactKind !== 'MODEL_FAILOVER_CANDIDATE_MEASUREMENT_ACCEPTANCE'
    || acceptance.acceptanceStatus !== 'PARENT_PINS_VERIFIED'
    || acceptance.measurementStatus !== 'COMPLETE'
    || acceptance.proofStatus !== 'NOT_ISSUED'
    || !RUN_ID_PATTERN.test(acceptance.parentRunId || '')) {
    fail('MODEL_CANDIDATE_MEASUREMENT_ACCEPTANCE_INVALID', 'Acceptance status is invalid');
  }
  exactKeys(acceptance.parent, ['kind', 'nodeVersion', 'pid'], 'acceptance.parent');
  if (acceptance.parent.kind !== 'CANDIDATE_MEASUREMENT_PARENT'
    || !Number.isSafeInteger(acceptance.parent.pid)
    || acceptance.parent.pid < 1
    || typeof acceptance.parent.nodeVersion !== 'string'
    || !/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(acceptance.parent.nodeVersion)) {
    fail('MODEL_CANDIDATE_MEASUREMENT_ACCEPTANCE_INVALID', 'Acceptance producer is invalid');
  }
  exactKeys(acceptance.source, ['cleanAfter', 'cleanBefore', 'revision'], 'acceptance.source');
  if (!REVISION_PATTERN.test(acceptance.source.revision || '')
    || acceptance.source.cleanBefore !== true
    || acceptance.source.cleanAfter !== true) {
    fail('MODEL_CANDIDATE_MEASUREMENT_ACCEPTANCE_INVALID', 'Acceptance source state is invalid');
  }
  exactKeys(
    acceptance.provider,
    ['inventoryAfter', 'inventoryBefore', 'origin'],
    'acceptance.provider',
  );
  let providerOrigin;
  try {
    providerOrigin = authorities.requireExactLoopbackProviderOrigin(acceptance.provider.origin);
  } catch (error) {
    throw new ModelFailoverCandidateMeasurementError(
      'MODEL_CANDIDATE_MEASUREMENT_ACCEPTANCE_INVALID',
      'Acceptance provider is invalid',
      { cause: error },
    );
  }
  validateReceiptInventory(acceptance.provider.inventoryBefore, 'inventoryBefore', authorities);
  validateReceiptInventory(acceptance.provider.inventoryAfter, 'inventoryAfter', authorities);
  if (authorities.canonicalize(acceptance.provider.inventoryBefore)
    !== authorities.canonicalize(acceptance.provider.inventoryAfter)) {
    fail('MODEL_CANDIDATE_MEASUREMENT_ACCEPTANCE_INVALID', 'Acceptance inventory drifted');
  }
  exactKeys(acceptance.candidate, [
    'role',
    'requestedModelName',
    'observedModelName',
    'canonicalName',
    'digestSha256',
  ], 'acceptance.candidate');
  if (!ROLES.has(acceptance.candidate.role)
    || !MODEL_NAME_PATTERN.test(acceptance.candidate.requestedModelName || '')
    || typeof acceptance.candidate.observedModelName !== 'string'
    || acceptance.candidate.observedModelName.length < 1
    || acceptance.candidate.observedModelName.length > 256
    || acceptance.candidate.canonicalName
      !== authorities.canonicalModelName(acceptance.candidate.observedModelName)
    || acceptance.candidate.canonicalName
      !== authorities.canonicalModelName(acceptance.candidate.requestedModelName)
    || !SHA256_PATTERN.test(acceptance.candidate.digestSha256 || '')) {
    fail('MODEL_CANDIDATE_MEASUREMENT_ACCEPTANCE_INVALID', 'Acceptance candidate is invalid');
  }
  const matches = acceptance.provider.inventoryBefore.models.filter(model => (
    model.canonicalName === acceptance.candidate.canonicalName
  ));
  if (matches.length !== 1
    || matches[0].name !== acceptance.candidate.observedModelName
    || matches[0].digestSha256 !== acceptance.candidate.digestSha256) {
    fail('MODEL_CANDIDATE_MEASUREMENT_ACCEPTANCE_INVALID', 'Candidate is not inventory-authoritative');
  }
  exactKeys(acceptance.measurement, [
    'runId',
    'artifactPath',
    'artifactSha256',
    'artifactByteLength',
    'validationScope',
  ], 'acceptance.measurement');
  if (!RUN_ID_PATTERN.test(acceptance.measurement.runId || '')
    || !SHA256_PATTERN.test(acceptance.measurement.artifactSha256 || '')
    || !Number.isSafeInteger(acceptance.measurement.artifactByteLength)
    || acceptance.measurement.artifactByteLength < 1
    || acceptance.measurement.validationScope !== 'PARENT_PINS_VERIFIED') {
    fail('MODEL_CANDIDATE_MEASUREMENT_ACCEPTANCE_INVALID', 'Acceptance measurement is invalid');
  }
  const exactRelativePath = [
    ARTIFACT_ROOT_RELATIVE,
    `parent-${acceptance.parentRunId}`,
    SOURCE_EXPORT_DIRECTORY,
    SOURCE_EXPORT_ARTIFACT_RELATIVE,
    `run-${acceptance.measurement.runId}`,
    'measurement.json',
  ].join('/');
  if (acceptance.measurement.artifactPath !== exactRelativePath) {
    fail('MODEL_CANDIDATE_MEASUREMENT_ACCEPTANCE_INVALID', 'Acceptance artifact path is invalid');
  }
  requireSafeInteger(acceptance.startedAtMs, 'acceptance.startedAtMs', { minimum: 1 });
  requireSafeInteger(acceptance.completedAtMs, 'acceptance.completedAtMs', { minimum: 1 });
  requireSafeInteger(acceptance.durationMs, 'acceptance.durationMs');
  if (acceptance.completedAtMs < acceptance.startedAtMs
    || acceptance.durationMs !== acceptance.completedAtMs - acceptance.startedAtMs) {
    fail('MODEL_CANDIDATE_MEASUREMENT_ACCEPTANCE_INVALID', 'Acceptance timing is invalid');
  }
  const expectedEffectBoundary = {
    providerRoutes: ['GET /api/tags', 'POST /api/chat'],
    proofIssued: false,
    databaseWrites: 0,
    bindingWrites: 0,
    runtimeConfigWrites: 0,
    broadcasts: 0,
    externalNetwork: false,
  };
  if (authorities.canonicalize(acceptance.effectBoundary)
    !== authorities.canonicalize(expectedEffectBoundary)
    || providerOrigin !== acceptance.provider.origin) {
    fail('MODEL_CANDIDATE_MEASUREMENT_ACCEPTANCE_INVALID', 'Acceptance effect boundary is invalid');
  }

  if (expectedAuthority === null) {
    return Object.freeze({
      valid: true,
      validationScope: 'STRUCTURAL_ONLY',
      declaredAcceptanceStatus: acceptance.acceptanceStatus,
      measurementStatus: 'COMPLETE',
      proofStatus: 'NOT_ISSUED',
    });
  }
  exactKeys(expectedAuthority, [
    'parentRunId',
    'sourceRevision',
    'providerOrigin',
    'inventory',
    'candidate',
    'measurement',
  ], 'expected acceptance authority');
  exactKeys(expectedAuthority.candidate, [
    'role',
    'requestedModelName',
    'observedModelName',
    'digestSha256',
  ], 'expected acceptance candidate');
  exactKeys(expectedAuthority.measurement, [
    'runId',
    'artifactPath',
    'artifactSha256',
    'artifactByteLength',
  ], 'expected acceptance measurement');
  const expectedProjection = {
    parentRunId: expectedAuthority.parentRunId,
    sourceRevision: expectedAuthority.sourceRevision,
    providerOrigin: expectedAuthority.providerOrigin,
    inventory: expectedAuthority.inventory,
    candidate: expectedAuthority.candidate,
    measurement: expectedAuthority.measurement,
  };
  const actualProjection = {
    parentRunId: acceptance.parentRunId,
    sourceRevision: acceptance.source.revision,
    providerOrigin: acceptance.provider.origin,
    inventory: acceptance.provider.inventoryBefore,
    candidate: {
      role: acceptance.candidate.role,
      requestedModelName: acceptance.candidate.requestedModelName,
      observedModelName: acceptance.candidate.observedModelName,
      digestSha256: acceptance.candidate.digestSha256,
    },
    measurement: {
      runId: acceptance.measurement.runId,
      artifactPath: acceptance.measurement.artifactPath,
      artifactSha256: acceptance.measurement.artifactSha256,
      artifactByteLength: acceptance.measurement.artifactByteLength,
    },
  };
  if (authorities.canonicalize(actualProjection)
    !== authorities.canonicalize(expectedProjection)) {
    fail(
      'MODEL_CANDIDATE_MEASUREMENT_ACCEPTANCE_AUTHORITY_MISMATCH',
      'Acceptance does not match independently derived parent authority',
    );
  }
  return Object.freeze({
    valid: true,
    validationScope: 'PARENT_PINS_VERIFIED',
    acceptanceStatus: 'PARENT_PINS_VERIFIED',
    measurementStatus: 'COMPLETE',
    proofStatus: 'NOT_ISSUED',
  });
}

async function writeImmutableAcceptance(runDirectory, canonicalJson, beforePublish) {
  const finalPath = path.join(runDirectory, ACCEPTANCE_FILE);
  const temporaryPath = path.join(runDirectory, `.acceptance-${randomUUID()}.tmp`);
  let handle = null;
  let finalCreated = false;
  try {
    handle = await open(
      temporaryPath,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile(canonicalJson, 'utf8');
    await handle.chmod(0o400);
    await handle.sync();
    await handle.close();
    handle = null;
    const [metadata, persisted] = await Promise.all([
      lstat(temporaryPath),
      readFile(temporaryPath),
    ]);
    if (!metadata.isFile()
      || metadata.isSymbolicLink()
      || (metadata.mode & 0o777) !== 0o400
      || sha256(persisted) !== sha256(canonicalJson)
      || persisted.length !== Buffer.byteLength(canonicalJson)) {
      fail(
        'MODEL_CANDIDATE_MEASUREMENT_ACCEPTANCE_WRITE_FAILED',
        'Staged parent acceptance failed read-back validation',
      );
    }
    await beforePublish();
    await link(temporaryPath, finalPath);
    finalCreated = true;
    await unlink(temporaryPath);
    const [finalMetadata, finalBytes] = await Promise.all([
      lstat(finalPath),
      readFile(finalPath),
    ]);
    if (!finalMetadata.isFile()
      || finalMetadata.isSymbolicLink()
      || (finalMetadata.mode & 0o777) !== 0o400
      || finalMetadata.nlink !== 1
      || (typeof process.getuid === 'function' && finalMetadata.uid !== process.getuid())
      || sha256(finalBytes) !== sha256(canonicalJson)
      || finalBytes.length !== Buffer.byteLength(canonicalJson)) {
      fail(
        'MODEL_CANDIDATE_MEASUREMENT_ACCEPTANCE_WRITE_FAILED',
        'Published parent acceptance failed final read-back validation',
      );
    }
    const directoryHandle = await open(runDirectory, fsConstants.O_RDONLY);
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
    return Object.freeze({
      path: finalPath,
      sha256: sha256(canonicalJson),
      byteLength: Buffer.byteLength(canonicalJson),
    });
  } catch (error) {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // Preserve the primary failure.
      }
    }
    try {
      await unlink(temporaryPath);
    } catch {
      // A private failed staging file is non-authoritative diagnostic residue.
    }
    if (finalCreated) {
      try {
        await unlink(finalPath);
      } catch {
        // Preserve the primary publication failure. A caller must still
        // require exit 0 before treating any private residue as accepted.
      }
    }
    if (error instanceof ModelFailoverCandidateMeasurementError) throw error;
    throw new ModelFailoverCandidateMeasurementError(
      'MODEL_CANDIDATE_MEASUREMENT_ACCEPTANCE_WRITE_FAILED',
      'Unable to publish immutable parent acceptance',
      { cause: error },
    );
  }
}

export async function runModelFailoverCandidateMeasurement(inputValue) {
  const input = requireInput(inputValue);
  requireCleanParentRuntime();
  const sourceRoot = await requireCanonicalSourceRoot(REPOSITORY_ROOT);
  const startedAtMs = Date.now();
  const beforeSource = sourceState(sourceRoot);
  requireCleanCandidateState(beforeSource);
  const run = await createParentRunDirectory(sourceRoot);
  const sourceManifest = await createCandidateSourceExport(
    sourceRoot,
    run.sourceExportRoot,
    beforeSource.revision,
  );
  await validateCandidateSourceExport(run.sourceExportRoot, sourceManifest);
  await createChildArtifactRoot(run.childArtifactRoot);
  await validateParentRunBoundary(sourceRoot, run);
  const authorities = await loadParentAuthorities(run.sourceExportRoot);
  const providerOrigin = configuredProviderOrigin(
    authorities.config,
    authorities.requireExactLoopbackProviderOrigin,
  );

  const inventoryBefore = await fetchProviderInventory(providerOrigin, authorities);
  const candidate = selectCandidate(
    inventoryBefore,
    input.proposedModelName,
    authorities.canonicalModelName,
  );
  const childResult = await spawnMeasurementChild({
    sourceRoot: run.sourceExportRoot,
    childArtifactRoot: run.childArtifactRoot,
    input,
    providerOrigin,
    digestSha256: candidate.digestSha256,
    revision: beforeSource.revision,
  });
  const expectedPins = Object.freeze({
    role: input.role,
    modelName: input.proposedModelName,
    digestSha256: candidate.digestSha256,
    providerOrigin,
    sourceRevisionClaim: beforeSource.revision,
  });
  const child = await validateModelFailoverMeasurementChildResult({
    sourceRoot: run.sourceExportRoot,
    childArtifactRoot: run.childArtifactRoot,
    result: childResult,
    expectedPins,
    expectedInventory: inventoryBefore,
    authorities,
  });

  const inventoryAfter = await fetchProviderInventory(providerOrigin, authorities);
  if (authorities.canonicalize(inventoryBefore) !== authorities.canonicalize(inventoryAfter)) {
    fail(
      'MODEL_CANDIDATE_MEASUREMENT_INVENTORY_DRIFT',
      'Parent provider inventory changed across the child run',
    );
  }
  selectCandidate(inventoryAfter, input.proposedModelName, authorities.canonicalModelName);
  const afterSource = sourceState(sourceRoot);
  requireCleanCandidateState(afterSource, beforeSource.revision);
  await validateParentRunBoundary(sourceRoot, run);
  await validateCandidateSourceExport(run.sourceExportRoot, sourceManifest);

  const completedAtMs = Date.now();
  const artifactRelativePath = path.relative(sourceRoot, child.summary.artifactPath);
  if (artifactRelativePath === ''
    || artifactRelativePath === '..'
    || artifactRelativePath.startsWith(`..${path.sep}`)
    || path.isAbsolute(artifactRelativePath)) {
    fail(
      'MODEL_CANDIDATE_MEASUREMENT_ARTIFACT_BOUNDARY_INVALID',
      'Measurement artifact cannot be represented relative to the candidate',
    );
  }
  const acceptance = {
    schemaVersion: 1,
    artifactKind: 'MODEL_FAILOVER_CANDIDATE_MEASUREMENT_ACCEPTANCE',
    acceptanceStatus: 'PARENT_PINS_VERIFIED',
    measurementStatus: 'COMPLETE',
    proofStatus: 'NOT_ISSUED',
    parentRunId: run.parentRunId,
    parent: {
      kind: 'CANDIDATE_MEASUREMENT_PARENT',
      pid: process.pid,
      nodeVersion: process.version,
    },
    source: {
      revision: beforeSource.revision,
      cleanBefore: beforeSource.clean,
      cleanAfter: afterSource.clean,
    },
    provider: {
      origin: providerOrigin,
      inventoryBefore,
      inventoryAfter,
    },
    candidate: {
      role: input.role,
      requestedModelName: input.proposedModelName,
      observedModelName: candidate.name,
      canonicalName: candidate.canonicalName,
      digestSha256: candidate.digestSha256,
    },
    measurement: {
      runId: child.summary.runId,
      artifactPath: artifactRelativePath.split(path.sep).join('/'),
      artifactSha256: child.summary.artifactSha256,
      artifactByteLength: child.summary.artifactByteLength,
      validationScope: child.validation.validationScope,
    },
    startedAtMs,
    completedAtMs,
    durationMs: completedAtMs - startedAtMs,
    effectBoundary: {
      providerRoutes: ['GET /api/tags', 'POST /api/chat'],
      proofIssued: false,
      databaseWrites: 0,
      bindingWrites: 0,
      runtimeConfigWrites: 0,
      broadcasts: 0,
      externalNetwork: false,
    },
  };
  const expectedAcceptanceAuthority = Object.freeze({
    parentRunId: run.parentRunId,
    sourceRevision: beforeSource.revision,
    providerOrigin,
    inventory: inventoryBefore,
    candidate: Object.freeze({
      role: input.role,
      requestedModelName: input.proposedModelName,
      observedModelName: candidate.name,
      digestSha256: candidate.digestSha256,
    }),
    measurement: Object.freeze({
      runId: child.summary.runId,
      artifactPath: artifactRelativePath.split(path.sep).join('/'),
      artifactSha256: child.summary.artifactSha256,
      artifactByteLength: child.summary.artifactByteLength,
    }),
  });
  await validateModelFailoverCandidateAcceptance(
    acceptance,
    authorities,
    expectedAcceptanceAuthority,
  );
  const canonicalJson = authorities.canonicalize(acceptance);
  const published = await writeImmutableAcceptance(
    run.runDirectory,
    canonicalJson,
    async () => {
      requireCleanCandidateState(sourceState(sourceRoot), beforeSource.revision);
      await validateParentRunBoundary(sourceRoot, run);
      await validateCandidateSourceExport(run.sourceExportRoot, sourceManifest);
    },
  );
  return Object.freeze({
    acceptance: Object.freeze(acceptance),
    acceptancePath: published.path,
    acceptanceSha256: published.sha256,
    acceptanceByteLength: published.byteLength,
    child: Object.freeze({ ...child, result: childResult }),
  });
}

function renderSuccess(result) {
  return JSON.stringify({
    schemaVersion: 1,
    acceptanceStatus: result.acceptance.acceptanceStatus,
    measurementStatus: result.acceptance.measurementStatus,
    proofStatus: result.acceptance.proofStatus,
    parentRunId: result.acceptance.parentRunId,
    sourceRevision: result.acceptance.source.revision,
    acceptancePath: result.acceptancePath,
    acceptanceSha256: result.acceptanceSha256,
    acceptanceByteLength: result.acceptanceByteLength,
    measurementArtifactPath: result.child.summary.artifactPath,
    measurementArtifactSha256: result.child.summary.artifactSha256,
  });
}

function renderError(error) {
  return JSON.stringify({
    schemaVersion: 1,
    acceptanceStatus: 'FAILED',
    measurementStatus: 'UNACCEPTED',
    proofStatus: 'NOT_ISSUED',
    code: error instanceof ModelFailoverCandidateMeasurementError
      ? error.code
      : 'MODEL_CANDIDATE_MEASUREMENT_UNEXPECTED_FAILURE',
    message: error?.message || String(error),
  });
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const input = parseCli(argv);
    const cwdCanonical = await realpath(process.cwd());
    const repositoryCanonical = await realpath(REPOSITORY_ROOT);
    if (cwdCanonical !== repositoryCanonical) {
      fail(
        'MODEL_CANDIDATE_MEASUREMENT_SOURCE_ROOT_INVALID',
        'Candidate measurement CLI must run from its repository root',
      );
    }
    const result = await runModelFailoverCandidateMeasurement(input);
    await new Promise((resolve, reject) => {
      process.stdout.write(`${renderSuccess(result)}\n`, error => error ? reject(error) : resolve());
    });
    return 0;
  } catch (error) {
    process.stderr.write(`${renderError(error)}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
