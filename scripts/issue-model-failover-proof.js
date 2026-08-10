#!/usr/bin/env node

// Operator-only proof issuer for one exact model-failover measurement.
//
// The caller supplies only a file-backed database connection, role and
// explicitly tagged model name. This module owns the parent run, evidence
// paths, clock, proof identity, durable content-addressed store and the only
// transaction that inserts the artifact companion plus PASS proof. It never
// changes desired/active bindings, runtime configuration or provider state.

import { createHash, randomUUID } from 'node:crypto';
import {
  constants as fsConstants,
  access,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  runModelFailoverCandidateMeasurement,
  takeModelFailoverCandidateMeasurementHandoff,
} from './run-model-failover-candidate-measurement.js';
import {
  assertModelFailoverProofIssuanceEnabled,
  canonicalizeModelFailoverContract,
  getModelFailoverMeasurementContract,
} from '../src/upgrade/model-failover-proof-policy.js';

const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));
const MIGRATION_VERSION = '2026_08_10_062_model_failover_proof_issuance';
const STORE_SUFFIX = Object.freeze([
  'model-failover-proofs',
  'v1',
  'sha256',
]);
const ROLES = new Set(['D1', 'D2', 'CODE', 'R1', 'R2', 'CHAT', 'VISION']);
const MODEL_NAME_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,190}:[a-z0-9][a-z0-9._-]{0,63}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REVISION_PATTERN = /^[a-f0-9]{40}$/;
const CLI_FIELDS = Object.freeze({
  '--role': 'role',
  '--proposed-model-name': 'proposedModelName',
});

const COMPANION_COLUMNS = Object.freeze([
  'proof_id',
  'validation_run_id',
  'parent_run_id',
  'source_revision',
  'measurement_artifact_sha256',
  'measurement_artifact_byte_length',
  'acceptance_artifact_sha256',
  'acceptance_artifact_byte_length',
  'role',
  'suite',
  'role_contract_sha256',
  'model_name',
  'model_canonical_name',
  'model_digest_sha256',
  'validation_version',
  'policy_version',
  'score',
  'required_score',
  'passed_count',
  'required_passed_count',
  'total_count',
  'duration_ms',
  'result',
  'inventory_before_name',
  'inventory_before_digest',
  'inventory_after_name',
  'inventory_after_digest',
  'measurement_started_at_ms',
  'measurement_completed_at_ms',
  'acceptance_completed_at_ms',
  'proof_ttl_ms',
  'expires_at_ms',
  'issued_at_ms',
]);
const PROOF_COLUMNS = Object.freeze([
  'proof_id',
  'validation_run_id',
  'role',
  'suite',
  'role_contract_sha256',
  'model_name',
  'model_canonical_name',
  'model_digest_sha256',
  'validation_version',
  'policy_version',
  'score',
  'required_score',
  'passed_count',
  'required_passed_count',
  'total_count',
  'duration_ms',
  'result',
  'inventory_before_name',
  'inventory_before_digest',
  'inventory_after_name',
  'inventory_after_digest',
  'started_at_ms',
  'completed_at_ms',
  'expires_at_ms',
  'created_at_ms',
]);

export class ModelFailoverProofIssuerError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'ModelFailoverProofIssuerError';
    this.code = code;
    this.details = options.details || null;
  }
}

function fail(code, message, details = null) {
  throw new ModelFailoverProofIssuerError(code, message, { details });
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactDataRecord(value, expectedKeys, label) {
  if (!isPlainRecord(value)) {
    fail('MODEL_FAILOVER_PROOF_INPUT_INVALID', `${label} must be a plain object`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some(key => {
    if (typeof key !== 'string') return true;
    const descriptor = descriptors[key];
    return !descriptor.enumerable || !Object.hasOwn(descriptor, 'value');
  })) {
    fail('MODEL_FAILOVER_PROOF_INPUT_INVALID', `${label} contains non-data properties`);
  }
  const actual = keys.sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    fail('MODEL_FAILOVER_PROOF_INPUT_INVALID', `${label} fields drifted`, {
      actual,
      expected,
    });
  }
  return Object.fromEntries(expectedKeys.map(key => [key, descriptors[key].value]));
}

function requireString(value, label, maximum = 512) {
  if (typeof value !== 'string') {
    fail('MODEL_FAILOVER_PROOF_INPUT_INVALID', `${label} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    fail('MODEL_FAILOVER_PROOF_INPUT_INVALID', `${label} has an invalid length`);
  }
  return normalized;
}

function requireSafeInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail('MODEL_FAILOVER_PROOF_AUTHORITY_INVALID', `${label} must be a safe integer >= ${minimum}`);
  }
  return value;
}

function requireFiniteNumber(value, label, minimum = 0, maximum = 1) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    fail(
      'MODEL_FAILOVER_PROOF_AUTHORITY_INVALID',
      `${label} must be a finite number between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

function requireInput(inputValue) {
  const input = exactDataRecord(
    inputValue,
    ['db', 'proposedModelName', 'role'],
    'proof issuer input',
  );
  const role = requireString(input.role, 'role', 16);
  if (role !== role.toUpperCase() || !ROLES.has(role)) {
    fail('MODEL_FAILOVER_PROOF_INPUT_INVALID', 'role must be a canonical model role');
  }
  const proposedModelName = requireString(input.proposedModelName, 'proposedModelName', 256);
  if (!MODEL_NAME_PATTERN.test(proposedModelName)) {
    fail(
      'MODEL_FAILOVER_PROOF_INPUT_INVALID',
      'proposedModelName must use an explicit provider tag',
    );
  }
  const db = input.db;
  if (!db || typeof db !== 'object'
    || typeof db.prepare !== 'function'
    || typeof db.pragma !== 'function'
    || typeof db.exec !== 'function') {
    fail('MODEL_FAILOVER_PROOF_DATABASE_INVALID', 'db must be a better-sqlite3 connection');
  }
  return Object.freeze({ db, role, proposedModelName });
}

function parseCli(argv) {
  if (!Array.isArray(argv) || argv.length !== Object.keys(CLI_FIELDS).length * 2) {
    fail(
      'MODEL_FAILOVER_PROOF_INPUT_INVALID',
      'Exactly two named proof issuance arguments are required',
    );
  }
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const field = CLI_FIELDS[argv[index]];
    if (!field || Object.hasOwn(parsed, field)) {
      fail(
        'MODEL_FAILOVER_PROOF_INPUT_INVALID',
        'Unknown or duplicate proof issuance argument',
      );
    }
    parsed[field] = argv[index + 1];
  }
  return Object.freeze({
    role: requireString(parsed.role, 'role', 16),
    proposedModelName: requireString(parsed.proposedModelName, 'proposedModelName', 256),
  });
}

function requireOpenWritableConnection(db) {
  if (db.open === false || db.readonly === true || db.inTransaction === true) {
    fail(
      'MODEL_FAILOVER_PROOF_DATABASE_INVALID',
      'Proof issuance requires an open writable connection outside a transaction',
    );
  }
  let queryOnly;
  try {
    queryOnly = db.pragma('query_only', { simple: true });
  } catch (error) {
    throw new ModelFailoverProofIssuerError(
      'MODEL_FAILOVER_PROOF_DATABASE_INVALID',
      'Cannot inspect database query-only state',
      { cause: error },
    );
  }
  if (queryOnly !== 0) {
    fail('MODEL_FAILOVER_PROOF_DATABASE_INVALID', 'Database connection is query-only');
  }
}

function requireUnshadowedMainNamespace(db, databaseList, code) {
  if (!Array.isArray(databaseList)) {
    fail(code, 'Database namespace authority result is invalid');
  }
  const mainRows = databaseList.filter(row => row?.name === 'main');
  const tempRows = databaseList.filter(row => row?.name === 'temp');
  const unexpected = databaseList.filter(row => row?.name !== 'main' && row?.name !== 'temp');
  if (mainRows.length !== 1
    || unexpected.length !== 0
    || tempRows.length > 1
    || tempRows.some(row => row.file !== '')) {
    fail(
      code,
      'Proof issuance requires one file-backed main database and no attached schema',
    );
  }
  let tempObjectCount;
  try {
    tempObjectCount = db.prepare('SELECT COUNT(*) AS count FROM temp.sqlite_master').get().count;
  } catch (error) {
    throw new ModelFailoverProofIssuerError(
      code,
      'Cannot inspect the TEMP namespace',
      { cause: error },
    );
  }
  if (tempObjectCount !== 0) {
    fail(code, 'TEMP objects are forbidden during proof issuance');
  }
  return mainRows[0];
}

async function inspectDatabaseAuthority(db) {
  requireOpenWritableConnection(db);
  let databaseList;
  try {
    databaseList = db.pragma('database_list');
  } catch (error) {
    throw new ModelFailoverProofIssuerError(
      'MODEL_FAILOVER_PROOF_DATABASE_INVALID',
      'Cannot inspect database identity',
      { cause: error },
    );
  }
  const mainRow = requireUnshadowedMainNamespace(
    db,
    databaseList,
    'MODEL_FAILOVER_PROOF_DATABASE_INVALID',
  );
  const configuredPath = mainRow.file;
  if (typeof configuredPath !== 'string'
    || configuredPath.length === 0
    || configuredPath.includes('\0')
    || !path.isAbsolute(configuredPath)
    || path.resolve(configuredPath) !== configuredPath) {
    fail('MODEL_FAILOVER_PROOF_DATABASE_INVALID', 'Main database path is not canonical');
  }
  let canonicalPath;
  let metadata;
  try {
    [canonicalPath, metadata] = await Promise.all([
      realpath(configuredPath),
      lstat(configuredPath),
      access(configuredPath, fsConstants.W_OK),
    ]);
  } catch (error) {
    throw new ModelFailoverProofIssuerError(
      'MODEL_FAILOVER_PROOF_DATABASE_INVALID',
      'Main database file is unavailable or not writable',
      { cause: error },
    );
  }
  if (canonicalPath !== configuredPath
    || metadata.isSymbolicLink()
    || !metadata.isFile()
    || metadata.nlink !== 1
    || (typeof process.getuid === 'function' && metadata.uid !== process.getuid())) {
    fail(
      'MODEL_FAILOVER_PROOF_DATABASE_INVALID',
      'Main database must be an owned canonical regular single-link file',
    );
  }
  let migration;
  try {
    migration = db.prepare('SELECT version FROM main.schema_migrations WHERE version = ?')
      .get(MIGRATION_VERSION);
  } catch (error) {
    throw new ModelFailoverProofIssuerError(
      'MODEL_FAILOVER_PROOF_DATABASE_SCHEMA_INVALID',
      'Cannot verify proof issuance migration',
      { cause: error },
    );
  }
  if (migration?.version !== MIGRATION_VERSION) {
    fail(
      'MODEL_FAILOVER_PROOF_DATABASE_SCHEMA_INVALID',
      'Proof issuance migration 062 is not applied',
    );
  }
  if (db.pragma('foreign_keys', { simple: true }) !== 1) {
    fail(
      'MODEL_FAILOVER_PROOF_FOREIGN_KEYS_REQUIRED',
      'foreign_keys must be enabled before measurement',
    );
  }
  return Object.freeze({
    canonicalPath,
    dev: metadata.dev,
    ino: metadata.ino,
    uid: metadata.uid,
  });
}

async function recheckDatabaseFile(identity) {
  const [canonicalPath, metadata] = await Promise.all([
    realpath(identity.canonicalPath),
    lstat(identity.canonicalPath),
  ]);
  if (canonicalPath !== identity.canonicalPath
    || metadata.dev !== identity.dev
    || metadata.ino !== identity.ino
    || metadata.uid !== identity.uid
    || metadata.isSymbolicLink()
    || !metadata.isFile()
    || metadata.nlink !== 1) {
    fail('MODEL_FAILOVER_PROOF_DATABASE_DRIFT', 'Main database identity changed during issuance');
  }
}

function recheckDatabaseNamespaceAuthority(db, identity) {
  requireOpenWritableConnection(db);
  let databaseList;
  try {
    databaseList = db.pragma('database_list');
  } catch (error) {
    throw new ModelFailoverProofIssuerError(
      'MODEL_FAILOVER_PROOF_DATABASE_INVALID',
      'Cannot recheck database namespace authority',
      { cause: error },
    );
  }
  const mainRow = requireUnshadowedMainNamespace(
    db,
    databaseList,
    'MODEL_FAILOVER_PROOF_DATABASE_DRIFT',
  );
  if (mainRow.file !== identity.canonicalPath) {
    fail(
      'MODEL_FAILOVER_PROOF_DATABASE_DRIFT',
      'Database namespace authority changed during issuance',
    );
  }
}

async function verifyOwnedDirectory(directory) {
  const [canonical, metadata] = await Promise.all([
    realpath(directory),
    lstat(directory),
  ]);
  if (canonical !== directory
    || metadata.isSymbolicLink()
    || !metadata.isDirectory()
    || (metadata.mode & 0o777) !== 0o700
    || (typeof process.getuid === 'function' && metadata.uid !== process.getuid())) {
    fail(
      'MODEL_FAILOVER_PROOF_STORE_INVALID',
      'Proof store directories must be owned canonical mode-0700 directories',
      { directory },
    );
  }
}

async function ensurePrivateStore(databasePath) {
  const databaseDirectory = path.dirname(databasePath);
  const artifactRoot = `${databasePath}.artifacts`;
  if (path.dirname(artifactRoot) !== databaseDirectory) {
    fail('MODEL_FAILOVER_PROOF_STORE_INVALID', 'Proof store escaped the database directory');
  }
  const directories = [
    artifactRoot,
    path.join(artifactRoot, STORE_SUFFIX[0]),
    path.join(artifactRoot, STORE_SUFFIX[0], STORE_SUFFIX[1]),
    path.join(artifactRoot, ...STORE_SUFFIX),
  ];
  for (const directory of directories) {
    let created = false;
    try {
      await mkdir(directory, { mode: 0o700 });
      created = true;
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw new ModelFailoverProofIssuerError(
          'MODEL_FAILOVER_PROOF_STORE_INVALID',
          'Cannot create private proof store',
          { cause: error, details: { directory } },
        );
      }
    }
    await verifyOwnedDirectory(directory);
    if (created) {
      await syncDirectory(directory);
      await syncDirectory(path.dirname(directory));
    }
  }
  return directories.at(-1);
}

async function verifyBlob(filePath, bytes, expectedSha256) {
  const [canonical, metadata, actualBytes] = await Promise.all([
    realpath(filePath),
    lstat(filePath),
    readFile(filePath),
  ]);
  if (canonical !== filePath
    || metadata.isSymbolicLink()
    || !metadata.isFile()
    || (metadata.mode & 0o777) !== 0o400
    || metadata.nlink !== 1
    || (typeof process.getuid === 'function' && metadata.uid !== process.getuid())
    || metadata.size !== bytes.length
    || actualBytes.length !== bytes.length
    || sha256(actualBytes) !== expectedSha256
    || !actualBytes.equals(bytes)) {
    fail(
      'MODEL_FAILOVER_PROOF_BLOB_COLLISION',
      'Durable proof blob does not match its content address and private metadata',
    );
  }
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await open(
      directory,
      fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
    );
    await handle.sync();
  } finally {
    await handle?.close();
  }
}

async function publishBlob(directory, bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    fail('MODEL_FAILOVER_PROOF_ARTIFACT_INVALID', 'Proof artifact bytes are empty or invalid');
  }
  const digest = sha256(bytes);
  const finalPath = path.join(directory, `${digest}.json`);
  const temporaryPath = path.join(directory, `.proof-${randomUUID()}.tmp`);
  let handle;
  let temporaryExists = false;
  try {
    handle = await open(
      temporaryPath,
      fsConstants.O_CREAT
        | fsConstants.O_EXCL
        | fsConstants.O_WRONLY
        | fsConstants.O_NOFOLLOW,
      0o600,
    );
    temporaryExists = true;
    await handle.writeFile(bytes);
    await handle.chmod(0o400);
    await handle.sync();
    await handle.close();
    handle = null;
    await verifyBlob(temporaryPath, bytes, digest);

    try {
      await link(temporaryPath, finalPath);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
    await unlink(temporaryPath);
    temporaryExists = false;
    await syncDirectory(directory);
    await verifyBlob(finalPath, bytes, digest);
    return Object.freeze({ digest, byteLength: bytes.length, path: finalPath });
  } catch (error) {
    if (error instanceof ModelFailoverProofIssuerError) throw error;
    throw new ModelFailoverProofIssuerError(
      'MODEL_FAILOVER_PROOF_STORE_WRITE_FAILED',
      'Cannot publish immutable proof evidence',
      { cause: error },
    );
  } finally {
    await handle?.close().catch(() => {});
    if (temporaryExists) {
      await unlink(temporaryPath).catch(() => {});
      await syncDirectory(directory).catch(() => {});
    }
  }
}

function exactArrayEqual(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function requireProjection(handoffResult, input) {
  const top = exactDataRecord(
    handoffResult,
    [
      'acceptanceArtifactBytes',
      'measurementArtifactBytes',
      'projection',
      'schemaVersion',
      'validationScope',
    ],
    'parent handoff result',
  );
  if (top.schemaVersion !== 1 || top.validationScope !== 'PARENT_PINS_VERIFIED'
    || !Buffer.isBuffer(top.measurementArtifactBytes)
    || !Buffer.isBuffer(top.acceptanceArtifactBytes)) {
    fail('MODEL_FAILOVER_PROOF_AUTHORITY_INVALID', 'Parent handoff result is invalid');
  }
  const projection = exactDataRecord(
    top.projection,
    ['acceptance', 'artifacts', 'candidate', 'measurement', 'parentRunId', 'schemaVersion', 'sourceRevision', 'validationScope'],
    'parent handoff projection',
  );
  const candidate = exactDataRecord(
    projection.candidate,
    ['canonicalName', 'digestSha256', 'observedModelName', 'requestedModelName', 'role'],
    'parent candidate projection',
  );
  const measurement = exactDataRecord(
    projection.measurement,
    [
      'completedAtMs', 'durationMs', 'passedCount', 'policyVersion', 'proofTtlMs',
      'requiredPassedCount', 'requiredScore', 'roleContractSha256', 'runId',
      'score', 'startedAtMs', 'suite', 'totalCount', 'validationVersion',
    ],
    'parent measurement projection',
  );
  const acceptance = exactDataRecord(
    projection.acceptance,
    ['completedAtMs'],
    'parent acceptance projection',
  );
  const artifacts = exactDataRecord(
    projection.artifacts,
    ['acceptance', 'measurement'],
    'parent artifacts projection',
  );
  const measurementArtifact = exactDataRecord(
    artifacts.measurement,
    ['byteLength', 'sha256'],
    'measurement artifact projection',
  );
  const acceptanceArtifact = exactDataRecord(
    artifacts.acceptance,
    ['byteLength', 'sha256'],
    'acceptance artifact projection',
  );

  if (projection.schemaVersion !== 1
    || projection.validationScope !== 'PARENT_PINS_VERIFIED'
    || candidate.role !== input.role
    || candidate.requestedModelName !== input.proposedModelName
    || !REVISION_PATTERN.test(projection.sourceRevision)
    || !SHA256_PATTERN.test(candidate.digestSha256)
    || !SHA256_PATTERN.test(measurement.roleContractSha256)
    || !SHA256_PATTERN.test(measurementArtifact.sha256)
    || !SHA256_PATTERN.test(acceptanceArtifact.sha256)
    || measurementArtifact.sha256 === acceptanceArtifact.sha256
    || measurementArtifact.byteLength !== top.measurementArtifactBytes.length
    || acceptanceArtifact.byteLength !== top.acceptanceArtifactBytes.length
    || sha256(top.measurementArtifactBytes) !== measurementArtifact.sha256
    || sha256(top.acceptanceArtifactBytes) !== acceptanceArtifact.sha256) {
    fail('MODEL_FAILOVER_PROOF_AUTHORITY_INVALID', 'Parent projection identity drifted');
  }

  const current = getModelFailoverMeasurementContract(input.role);
  const currentRole = assertModelFailoverProofIssuanceEnabled(input.role);
  const roleAcceptance = current.contract.acceptance;
  if (measurement.suite !== currentRole.suite
    || measurement.totalCount !== currentRole.totalCount
    || measurement.roleContractSha256 !== current.measurementContractSha256
    || measurement.policyVersion !== current.contract.policyVersion
    || measurement.validationVersion !== current.contract.validationVersion
    || measurement.requiredScore !== roleAcceptance.requiredScore
    || measurement.requiredPassedCount !== roleAcceptance.requiredPassedCount
    || measurement.proofTtlMs !== roleAcceptance.proofTtlMs) {
    fail('MODEL_FAILOVER_PROOF_POLICY_DRIFT', 'Parent result no longer matches current proof policy');
  }

  const startedAtMs = requireSafeInteger(measurement.startedAtMs, 'measurement.startedAtMs', 1);
  const completedAtMs = requireSafeInteger(measurement.completedAtMs, 'measurement.completedAtMs', startedAtMs);
  const durationMs = requireSafeInteger(measurement.durationMs, 'measurement.durationMs');
  const acceptanceCompletedAtMs = requireSafeInteger(
    acceptance.completedAtMs,
    'acceptance.completedAtMs',
    completedAtMs,
  );
  const proofTtlMs = requireSafeInteger(measurement.proofTtlMs, 'measurement.proofTtlMs', 1);
  if (durationMs !== completedAtMs - startedAtMs
    || acceptanceCompletedAtMs > Number.MAX_SAFE_INTEGER - proofTtlMs) {
    fail('MODEL_FAILOVER_PROOF_AUTHORITY_INVALID', 'Parent timing authority is invalid');
  }
  const score = requireFiniteNumber(measurement.score, 'measurement.score');
  const requiredScore = requireFiniteNumber(measurement.requiredScore, 'measurement.requiredScore', Number.MIN_VALUE);
  const passedCount = requireSafeInteger(measurement.passedCount, 'measurement.passedCount');
  const requiredPassedCount = requireSafeInteger(
    measurement.requiredPassedCount,
    'measurement.requiredPassedCount',
    1,
  );
  const totalCount = requireSafeInteger(measurement.totalCount, 'measurement.totalCount', 1);
  if (score < requiredScore
    || passedCount < requiredPassedCount
    || passedCount > totalCount
    || requiredPassedCount > totalCount) {
    fail('MODEL_FAILOVER_PROOF_ACCEPTANCE_FAILED', 'Parent measurement does not satisfy PASS policy');
  }

  return Object.freeze({
    measurementArtifactBytes: Buffer.from(top.measurementArtifactBytes),
    acceptanceArtifactBytes: Buffer.from(top.acceptanceArtifactBytes),
    projection: top.projection,
    candidate,
    measurement,
    acceptance,
    measurementArtifact,
    acceptanceArtifact,
    expiresAtMs: acceptanceCompletedAtMs + proofTtlMs,
  });
}

function sameHandoff(left, right) {
  return left.measurementArtifact.sha256 === right.measurementArtifact.sha256
    && left.acceptanceArtifact.sha256 === right.acceptanceArtifact.sha256
    && left.measurementArtifact.byteLength === right.measurementArtifact.byteLength
    && left.acceptanceArtifact.byteLength === right.acceptanceArtifact.byteLength
    && left.measurementArtifactBytes.equals(right.measurementArtifactBytes)
    && left.acceptanceArtifactBytes.equals(right.acceptanceArtifactBytes)
    && canonicalizeModelFailoverContract(left.projection)
      === canonicalizeModelFailoverContract(right.projection);
}

function ledgerRows(validated, issuedAtMs) {
  const { projection, candidate, measurement, acceptance } = validated;
  if (!Number.isSafeInteger(issuedAtMs)
    || issuedAtMs < acceptance.completedAtMs
    || issuedAtMs >= validated.expiresAtMs) {
    fail('MODEL_FAILOVER_PROOF_EXPIRED', 'Accepted measurement is no longer issuable');
  }
  const proofId = `mfp-${validated.acceptanceArtifact.sha256}`;
  const companion = Object.freeze({
    proof_id: proofId,
    validation_run_id: measurement.runId,
    parent_run_id: projection.parentRunId,
    source_revision: projection.sourceRevision,
    measurement_artifact_sha256: validated.measurementArtifact.sha256,
    measurement_artifact_byte_length: validated.measurementArtifact.byteLength,
    acceptance_artifact_sha256: validated.acceptanceArtifact.sha256,
    acceptance_artifact_byte_length: validated.acceptanceArtifact.byteLength,
    role: candidate.role,
    suite: measurement.suite,
    role_contract_sha256: measurement.roleContractSha256,
    model_name: candidate.observedModelName,
    model_canonical_name: candidate.canonicalName,
    model_digest_sha256: candidate.digestSha256,
    validation_version: measurement.validationVersion,
    policy_version: measurement.policyVersion,
    score: measurement.score,
    required_score: measurement.requiredScore,
    passed_count: measurement.passedCount,
    required_passed_count: measurement.requiredPassedCount,
    total_count: measurement.totalCount,
    duration_ms: measurement.durationMs,
    result: 'PASS',
    inventory_before_name: candidate.observedModelName,
    inventory_before_digest: candidate.digestSha256,
    inventory_after_name: candidate.observedModelName,
    inventory_after_digest: candidate.digestSha256,
    measurement_started_at_ms: measurement.startedAtMs,
    measurement_completed_at_ms: measurement.completedAtMs,
    acceptance_completed_at_ms: acceptance.completedAtMs,
    proof_ttl_ms: measurement.proofTtlMs,
    expires_at_ms: validated.expiresAtMs,
    issued_at_ms: issuedAtMs,
  });
  const proof = Object.freeze({
    proof_id: companion.proof_id,
    validation_run_id: companion.validation_run_id,
    role: companion.role,
    suite: companion.suite,
    role_contract_sha256: companion.role_contract_sha256,
    model_name: companion.model_name,
    model_canonical_name: companion.model_canonical_name,
    model_digest_sha256: companion.model_digest_sha256,
    validation_version: companion.validation_version,
    policy_version: companion.policy_version,
    score: companion.score,
    required_score: companion.required_score,
    passed_count: companion.passed_count,
    required_passed_count: companion.required_passed_count,
    total_count: companion.total_count,
    duration_ms: companion.duration_ms,
    result: companion.result,
    inventory_before_name: companion.inventory_before_name,
    inventory_before_digest: companion.inventory_before_digest,
    inventory_after_name: companion.inventory_after_name,
    inventory_after_digest: companion.inventory_after_digest,
    started_at_ms: companion.measurement_started_at_ms,
    completed_at_ms: companion.measurement_completed_at_ms,
    expires_at_ms: companion.expires_at_ms,
    created_at_ms: companion.issued_at_ms,
  });
  return Object.freeze({ proofId, companion, proof });
}

function makeInsert(table, columns) {
  const placeholders = columns.map(column => `@${column}`).join(', ');
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
}

function assertExactRow(actual, expected, label) {
  if (!isPlainRecord(actual)) {
    fail('MODEL_FAILOVER_PROOF_DATABASE_COMMIT_INVALID', `${label} row is missing`);
  }
  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  if (!exactArrayEqual(actualKeys, expectedKeys)
    || expectedKeys.some(key => actual[key] !== expected[key])) {
    fail('MODEL_FAILOVER_PROOF_DATABASE_COMMIT_INVALID', `${label} row drifted`);
  }
}

async function commitProof(db, identity, rows) {
  // The filesystem check is the last asynchronous operation. Namespace, FK,
  // statement preparation and BEGIN then run as one synchronous commit point,
  // so another callback cannot attach or create TEMP objects between them.
  await recheckDatabaseFile(identity);
  recheckDatabaseNamespaceAuthority(db, identity);
  const insertCompanion = db.prepare(makeInsert(
    'main.model_failover_proof_artifacts',
    COMPANION_COLUMNS,
  ));
  const insertProof = db.prepare(makeInsert('main.model_failover_proofs', PROOF_COLUMNS));
  const readCompanion = db.prepare(
    `SELECT ${COMPANION_COLUMNS.join(', ')} FROM main.model_failover_proof_artifacts `
      + 'WHERE proof_id = ?',
  );
  const readProof = db.prepare(
    `SELECT ${PROOF_COLUMNS.join(', ')} FROM main.model_failover_proofs WHERE proof_id = ?`,
  );
  if (db.pragma('foreign_keys', { simple: true }) !== 1) {
    fail(
      'MODEL_FAILOVER_PROOF_FOREIGN_KEYS_REQUIRED',
      'foreign_keys changed before the proof commit point',
    );
  }
  try {
    db.exec('BEGIN IMMEDIATE');
    db.exec('PRAGMA defer_foreign_keys = ON');
    insertCompanion.run(rows.companion);
    insertProof.run(rows.proof);
    assertExactRow(readCompanion.get(rows.proofId), rows.companion, 'companion');
    assertExactRow(readProof.get(rows.proofId), rows.proof, 'proof');
    const violations = db.pragma('main.foreign_key_check');
    if (!Array.isArray(violations) || violations.length !== 0) {
      fail('MODEL_FAILOVER_PROOF_DATABASE_COMMIT_INVALID', 'Proof transaction violates a foreign key');
    }
    db.exec('COMMIT');
  } catch (error) {
    if (db.inTransaction) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Preserve the original typed/SQLite failure.
      }
    }
    if (error instanceof ModelFailoverProofIssuerError) throw error;
    throw new ModelFailoverProofIssuerError(
      'MODEL_FAILOVER_PROOF_DATABASE_COMMIT_FAILED',
      'Proof ledger transaction failed',
      { cause: error },
    );
  }
}

export async function issueModelFailoverProof(inputValue, ...authorityOverrides) {
  if (authorityOverrides.length !== 0) {
    fail(
      'MODEL_FAILOVER_PROOF_AUTHORITY_OVERRIDE_REJECTED',
      'Proof issuer does not accept caller-owned authority',
    );
  }
  const input = requireInput(inputValue);
  const databaseIdentity = await inspectDatabaseAuthority(input.db);
  assertModelFailoverProofIssuanceEnabled(input.role);
  getModelFailoverMeasurementContract(input.role);

  const parentResult = await runModelFailoverCandidateMeasurement({
    role: input.role,
    proposedModelName: input.proposedModelName,
  });
  const handoff = takeModelFailoverCandidateMeasurementHandoff(parentResult);
  const preflight = requireProjection(await handoff.recheck(), input);
  const store = await ensurePrivateStore(databaseIdentity.canonicalPath);
  const measurementBlob = await publishBlob(store, preflight.measurementArtifactBytes);
  const acceptanceBlob = await publishBlob(store, preflight.acceptanceArtifactBytes);
  if (measurementBlob.digest !== preflight.measurementArtifact.sha256
    || measurementBlob.byteLength !== preflight.measurementArtifact.byteLength
    || acceptanceBlob.digest !== preflight.acceptanceArtifact.sha256
    || acceptanceBlob.byteLength !== preflight.acceptanceArtifact.byteLength) {
    fail('MODEL_FAILOVER_PROOF_ARTIFACT_DRIFT', 'Published artifact identity drifted');
  }

  const terminal = requireProjection(await handoff.recheck(), input);
  if (!sameHandoff(preflight, terminal)) {
    fail('MODEL_FAILOVER_PROOF_TERMINAL_DRIFT', 'Parent authority changed after publication');
  }
  await verifyBlob(measurementBlob.path, terminal.measurementArtifactBytes, measurementBlob.digest);
  await verifyBlob(acceptanceBlob.path, terminal.acceptanceArtifactBytes, acceptanceBlob.digest);
  const rows = ledgerRows(terminal, Date.now());
  await commitProof(input.db, databaseIdentity, rows);

  return Object.freeze({
    status: 'ISSUED',
    proofId: rows.proofId,
    expiresAtMs: rows.companion.expires_at_ms,
  });
}

function renderError(error) {
  return JSON.stringify({
    status: 'FAILED',
    code: typeof error?.code === 'string'
      ? error.code
      : 'MODEL_FAILOVER_PROOF_UNEXPECTED_FAILURE',
    message: error?.message || String(error),
  });
}

export async function main(argv = process.argv.slice(2)) {
  let databaseModule;
  try {
    const cliInput = parseCli(argv);
    if (cliInput.role !== cliInput.role.toUpperCase() || !ROLES.has(cliInput.role)) {
      fail('MODEL_FAILOVER_PROOF_INPUT_INVALID', 'role must be a canonical model role');
    }
    if (!MODEL_NAME_PATTERN.test(cliInput.proposedModelName)) {
      fail(
        'MODEL_FAILOVER_PROOF_INPUT_INVALID',
        'proposedModelName must use an explicit provider tag',
      );
    }
    const [cwdCanonical, repositoryCanonical] = await Promise.all([
      realpath(process.cwd()),
      realpath(REPOSITORY_ROOT),
    ]);
    if (cwdCanonical !== repositoryCanonical) {
      fail(
        'MODEL_FAILOVER_PROOF_SOURCE_ROOT_INVALID',
        'Proof issuer CLI must run from its repository root',
      );
    }
    process.env.C3_LOG_LEVEL = 'error';
    await import('../src/runtime-environment.js');
    databaseModule = await import('../src/db/database.js');
    const result = await issueModelFailoverProof({ db: databaseModule.db, ...cliInput });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${renderError(error)}\n`);
    return 1;
  } finally {
    databaseModule?.close?.();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
