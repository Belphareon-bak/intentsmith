#!/usr/bin/env node

// Operator-triggered D+ PASS proof issuer.
//
// The candidate runner owns provider measurement and immutable artifact
// publication. This issuer performs no provider, binding, runtime, broadcast or
// external-network effect. It revalidates the exact committed source and both
// artifacts, then atomically records their content addresses with one PASS
// proof. An artifact may remain orphaned; a proof without both artifacts may
// never commit.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  constants as fsConstants,
  existsSync,
  lstatSync,
  openSync,
  closeSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

import {
  validateModelFailoverCandidateAcceptance,
} from './run-model-failover-candidate-measurement.js';
import {
  validateModelFailoverMeasurementArtifact,
} from './run-model-failover-measurement.js';
import {
  canonicalizeModelFailoverContract,
  getModelFailoverProofContract,
} from '../src/upgrade/model-failover-proof-policy.js';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = realpathSync(path.resolve(path.dirname(SCRIPT_PATH), '..'));
const ARTIFACT_ROOT_RELATIVE =
  '.intentsmith-artifacts/model-failover-candidate-measurements';
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
const GIT_BINARY = '/usr/bin/git';
const REVISION_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PROOF_ID_PREFIX = 'mfp_';

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

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected, label) {
  if (!isPlainRecord(value)) {
    fail('MODEL_FAILOVER_PROOF_ISSUER_INPUT_INVALID', `${label} must be a plain object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail(
      'MODEL_FAILOVER_PROOF_ISSUER_AUTHORITY_OVERRIDE_REJECTED',
      `${label} has unknown or repository-owned fields`,
      { fields: actual.filter(field => !wanted.includes(field)) },
    );
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function decodeCanonicalArtifact(bytes, label) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail('MODEL_FAILOVER_PROOF_ARTIFACT_INVALID', `${label} is not valid UTF-8`);
  }
  let artifact;
  try {
    artifact = JSON.parse(text);
  } catch {
    fail('MODEL_FAILOVER_PROOF_ARTIFACT_INVALID', `${label} is not JSON`);
  }
  if (canonicalizeModelFailoverContract(artifact) !== text) {
    fail('MODEL_FAILOVER_PROOF_ARTIFACT_INVALID', `${label} is not canonical JSON`);
  }
  return artifact;
}

function requirePrivateDirectory(directory, label) {
  let metadata;
  try {
    metadata = lstatSync(directory);
  } catch (error) {
    throw new ModelFailoverProofIssuerError(
      'MODEL_FAILOVER_PROOF_ARTIFACT_BOUNDARY_INVALID',
      `${label} is unavailable`,
      { cause: error },
    );
  }
  if (!metadata.isDirectory()
    || metadata.isSymbolicLink()
    || (metadata.mode & 0o777) !== 0o700
    || (typeof process.getuid === 'function' && metadata.uid !== process.getuid())
    || realpathSync(directory) !== path.resolve(directory)) {
    fail(
      'MODEL_FAILOVER_PROOF_ARTIFACT_BOUNDARY_INVALID',
      `${label} must be an owned real mode-0700 directory`,
    );
  }
}

function requirePrivateArtifact(filePath, label) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    fail('MODEL_FAILOVER_PROOF_ARTIFACT_BOUNDARY_INVALID', `${label} path must be absolute`);
  }
  let metadata;
  try {
    metadata = lstatSync(filePath);
  } catch (error) {
    throw new ModelFailoverProofIssuerError(
      'MODEL_FAILOVER_PROOF_ARTIFACT_BOUNDARY_INVALID',
      `${label} is unavailable`,
      { cause: error },
    );
  }
  if (!metadata.isFile()
    || metadata.isSymbolicLink()
    || (metadata.mode & 0o777) !== 0o400
    || metadata.nlink !== 1
    || metadata.size < 1
    || metadata.size > MAX_ARTIFACT_BYTES
    || (typeof process.getuid === 'function' && metadata.uid !== process.getuid())
    || realpathSync(filePath) !== path.resolve(filePath)) {
    fail(
      'MODEL_FAILOVER_PROOF_ARTIFACT_METADATA_INVALID',
      `${label} must be an owned regular mode-0400 single-link bounded file`,
    );
  }
  let descriptor;
  try {
    descriptor = openSync(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const bytes = readFileSync(descriptor);
    if (bytes.length !== metadata.size) {
      fail('MODEL_FAILOVER_PROOF_ARTIFACT_DIGEST_INVALID', `${label} size changed while reading`);
    }
    return Object.freeze({
      path: filePath,
      bytes,
      byteLength: bytes.length,
      sha256: sha256(bytes),
    });
  } catch (error) {
    if (error instanceof ModelFailoverProofIssuerError) throw error;
    throw new ModelFailoverProofIssuerError(
      'MODEL_FAILOVER_PROOF_ARTIFACT_READ_FAILED',
      `Cannot read ${label}`,
      { cause: error },
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function isPathInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function git(args, sourceRoot) {
  try {
    return execFileSync(GIT_BINARY, args, {
      cwd: sourceRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
      maxBuffer: 4 * 1024 * 1024,
    }).trim();
  } catch (error) {
    throw new ModelFailoverProofIssuerError(
      'MODEL_FAILOVER_PROOF_SOURCE_UNAVAILABLE',
      'Cannot inspect proof source revision',
      { cause: error },
    );
  }
}

function sourceState(sourceRoot) {
  const revision = git(['rev-parse', '--verify', 'HEAD'], sourceRoot);
  if (!REVISION_PATTERN.test(revision)) {
    fail('MODEL_FAILOVER_PROOF_SOURCE_INVALID', 'Source HEAD is not a full Git revision');
  }
  const status = git([
    'status', '--porcelain=v1', '--untracked-files=all', '--',
    'src', 'scripts', 'tests', 'package.json',
  ], sourceRoot);
  if (status !== '') {
    fail(
      'MODEL_FAILOVER_PROOF_SOURCE_DIRTY',
      'Proof issuance requires clean committed runtime, runner and test sources',
    );
  }
  return Object.freeze({ revision });
}

function resolveArtifactPaths(sourceRoot, acceptancePathValue) {
  if (typeof acceptancePathValue !== 'string'
    || acceptancePathValue.length === 0
    || !path.isAbsolute(acceptancePathValue)) {
    fail(
      'MODEL_FAILOVER_PROOF_ISSUER_INPUT_INVALID',
      'acceptancePath must be an absolute path',
    );
  }
  const artifactRoot = path.join(sourceRoot, ...ARTIFACT_ROOT_RELATIVE.split('/'));
  if (!isPathInside(sourceRoot, artifactRoot)) {
    fail('MODEL_FAILOVER_PROOF_ARTIFACT_BOUNDARY_INVALID', 'Artifact root escaped source root');
  }
  requirePrivateDirectory(path.join(sourceRoot, '.intentsmith-artifacts'), 'artifact base');
  requirePrivateDirectory(artifactRoot, 'candidate measurement artifact root');
  const acceptancePath = path.resolve(acceptancePathValue);
  if (!isPathInside(artifactRoot, acceptancePath)) {
    fail(
      'MODEL_FAILOVER_PROOF_ARTIFACT_BOUNDARY_INVALID',
      'Acceptance artifact is outside the candidate measurement store',
    );
  }
  return Object.freeze({ artifactRoot, acceptancePath });
}

function validateAcceptancePath(paths, acceptance) {
  const runDirectory = path.join(paths.artifactRoot, `parent-${acceptance.parentRunId}`);
  const expectedAcceptancePath = path.join(runDirectory, 'acceptance.json');
  if (paths.acceptancePath !== expectedAcceptancePath) {
    fail(
      'MODEL_FAILOVER_PROOF_ARTIFACT_BOUNDARY_INVALID',
      'Acceptance artifact is not at its exact parent run path',
    );
  }
  requirePrivateDirectory(runDirectory, 'candidate parent run directory');
  const measurementPath = path.join(
    REPOSITORY_ROOT,
    ...acceptance.measurement.artifactPath.split('/'),
  );
  if (!isPathInside(runDirectory, measurementPath)) {
    fail(
      'MODEL_FAILOVER_PROOF_ARTIFACT_BOUNDARY_INVALID',
      'Measurement artifact is outside its accepted parent run',
    );
  }
  let current = path.dirname(measurementPath);
  const directories = [];
  while (current !== runDirectory) {
    if (!isPathInside(runDirectory, current)) {
      fail('MODEL_FAILOVER_PROOF_ARTIFACT_BOUNDARY_INVALID', 'Measurement path escaped parent run');
    }
    directories.push(current);
    current = path.dirname(current);
  }
  for (const directory of directories.reverse()) {
    requirePrivateDirectory(directory, 'measurement artifact directory');
  }
  return Object.freeze({ runDirectory, measurementPath });
}

function requireDatabase(db) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    fail('MODEL_FAILOVER_PROOF_DB_INVALID', 'A better-sqlite3 database is required');
  }
  return db;
}

function proofIdentity(evidence, proofContract) {
  return `${PROOF_ID_PREFIX}${sha256(canonicalizeModelFailoverContract({
    schemaVersion: 1,
    validationRunId: evidence.measurement.runId,
    role: evidence.measurement.candidate.role,
    modelDigestSha256: evidence.measurement.candidate.digestSha256,
    roleContractSha256: proofContract.roleContractSha256,
    measurementArtifactSha256: evidence.measurementFile.sha256,
    acceptanceArtifactSha256: evidence.acceptanceFile.sha256,
    sourceRevision: evidence.sourceRevision,
  }))}`;
}

function expectedProofRow(evidence, proofContract, createdAtMs) {
  const { measurement } = evidence;
  const { acceptance, role } = proofContract.contract;
  const expiresAtMs = measurement.completedAtMs + acceptance.proofTtlMs;
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= measurement.completedAtMs) {
    fail('MODEL_FAILOVER_PROOF_EXPIRY_INVALID', 'Proof expiry overflows safe time');
  }
  if (measurement.completedAtMs > createdAtMs
    || evidence.acceptance.completedAtMs > createdAtMs
    || createdAtMs >= expiresAtMs) {
    fail(
      'MODEL_FAILOVER_PROOF_EVIDENCE_EXPIRED',
      'Measurement evidence is future-dated or no longer eligible',
      { completedAtMs: measurement.completedAtMs, expiresAtMs, nowMs: createdAtMs },
    );
  }
  const beforeModel = measurement.inventoryBefore.models.find(model => (
    model.name === measurement.candidate.observedModelName
  ));
  const afterModel = measurement.inventoryAfter.models.find(model => (
    model.name === measurement.candidate.observedModelName
  ));
  if (!beforeModel || !afterModel) {
    fail('MODEL_FAILOVER_PROOF_EVIDENCE_INVALID', 'Candidate is absent from inventory evidence');
  }
  return Object.freeze({
    proof_id: proofIdentity(evidence, proofContract),
    validation_run_id: measurement.runId,
    role: role.role,
    suite: role.suite,
    role_contract_sha256: proofContract.roleContractSha256,
    model_name: measurement.candidate.observedModelName,
    model_canonical_name: measurement.candidate.canonicalName,
    model_digest_sha256: measurement.candidate.digestSha256,
    validation_version: proofContract.contract.validationVersion,
    policy_version: proofContract.contract.policyVersion,
    score: measurement.aggregate.score,
    required_score: acceptance.requiredScore,
    passed_count: measurement.aggregate.passedCount,
    required_passed_count: acceptance.requiredPassedCount,
    total_count: measurement.aggregate.totalCount,
    duration_ms: measurement.durationMs,
    result: 'PASS',
    inventory_before_name: beforeModel.name,
    inventory_before_digest: beforeModel.digestSha256,
    inventory_after_name: afterModel.name,
    inventory_after_digest: afterModel.digestSha256,
    started_at_ms: measurement.startedAtMs,
    completed_at_ms: measurement.completedAtMs,
    expires_at_ms: expiresAtMs,
    created_at_ms: createdAtMs,
    measurement_artifact_sha256: evidence.measurementFile.sha256,
    acceptance_artifact_sha256: evidence.acceptanceFile.sha256,
    source_revision: evidence.sourceRevision,
  });
}

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
  'measurement_artifact_sha256',
  'acceptance_artifact_sha256',
  'source_revision',
]);

function stableProofProjection(row) {
  const projected = Object.fromEntries(PROOF_COLUMNS.map(column => [column, row[column]]));
  delete projected.created_at_ms;
  return projected;
}

function insertArtifactMetadata(db, artifact, kind, sourceRevision, createdAtMs) {
  db.prepare(`
    INSERT OR IGNORE INTO model_failover_proof_artifacts (
      artifact_sha256, kind, byte_length, source_revision, created_at_ms
    ) VALUES (?, ?, ?, ?, ?)
  `).run(artifact.sha256, kind, artifact.byteLength, sourceRevision, createdAtMs);
  const persisted = db.prepare(`
    SELECT artifact_sha256, kind, byte_length, source_revision, created_at_ms
    FROM model_failover_proof_artifacts
    WHERE artifact_sha256 = ?
  `).get(artifact.sha256);
  const expected = {
    artifact_sha256: artifact.sha256,
    kind,
    byte_length: artifact.byteLength,
    source_revision: sourceRevision,
    created_at_ms: createdAtMs,
  };
  if (canonicalizeModelFailoverContract(persisted)
    !== canonicalizeModelFailoverContract(expected)) {
    fail(
      'MODEL_FAILOVER_PROOF_ARTIFACT_IDENTITY_CONFLICT',
      'Artifact hash is already bound to different metadata',
      { artifactSha256: artifact.sha256 },
    );
  }
}

function insertOrReplayProof(db, expected) {
  const existing = db.prepare(`
    SELECT ${PROOF_COLUMNS.join(', ')}
    FROM model_failover_proofs
    WHERE validation_run_id = ? AND role = ?
  `).get(expected.validation_run_id, expected.role);
  if (existing) {
    if (canonicalizeModelFailoverContract(stableProofProjection(existing))
      !== canonicalizeModelFailoverContract(stableProofProjection(expected))) {
      fail(
        'MODEL_FAILOVER_PROOF_IDENTITY_CONFLICT',
        'Validation run is already bound to a different proof',
        { validationRunId: expected.validation_run_id, role: expected.role },
      );
    }
    return Object.freeze({ outcome: 'ALREADY_ISSUED', row: existing });
  }
  const placeholders = PROOF_COLUMNS.map(() => '?').join(', ');
  db.prepare(`
    INSERT INTO model_failover_proofs (${PROOF_COLUMNS.join(', ')})
    VALUES (${placeholders})
  `).run(...PROOF_COLUMNS.map(column => expected[column]));
  const row = db.prepare(`
    SELECT ${PROOF_COLUMNS.join(', ')}
    FROM model_failover_proofs
    WHERE proof_id = ?
  `).get(expected.proof_id);
  return Object.freeze({ outcome: 'ISSUED', row });
}

function terminalRecheck(evidence, proofContract, clock, db) {
  const source = sourceState(REPOSITORY_ROOT);
  if (source.revision !== evidence.sourceRevision) {
    fail('MODEL_FAILOVER_PROOF_SOURCE_DRIFT', 'Source revision changed before proof commit');
  }
  const measurementFile = requirePrivateArtifact(
    evidence.measurementFile.path,
    'measurement artifact',
  );
  const acceptanceFile = requirePrivateArtifact(
    evidence.acceptanceFile.path,
    'acceptance artifact',
  );
  if (measurementFile.sha256 !== evidence.measurementFile.sha256
    || measurementFile.byteLength !== evidence.measurementFile.byteLength
    || acceptanceFile.sha256 !== evidence.acceptanceFile.sha256
    || acceptanceFile.byteLength !== evidence.acceptanceFile.byteLength) {
    fail('MODEL_FAILOVER_PROOF_ARTIFACT_DRIFT', 'Proof artifacts changed before commit');
  }
  const currentContract = getModelFailoverProofContract(evidence.measurement.candidate.role);
  if (currentContract.canonicalJson !== proofContract.canonicalJson
    || currentContract.roleContractSha256 !== proofContract.roleContractSha256) {
    fail('MODEL_FAILOVER_PROOF_CONTRACT_DRIFT', 'Live proof contract changed before commit');
  }
  const createdAtMs = clock();
  if (!Number.isSafeInteger(createdAtMs) || createdAtMs < 1) {
    fail('MODEL_FAILOVER_PROOF_CLOCK_INVALID', 'Issuer clock returned an invalid time');
  }
  const expected = expectedProofRow(evidence, currentContract, createdAtMs);
  insertArtifactMetadata(
    db,
    evidence.measurementFile,
    'MEASUREMENT',
    evidence.sourceRevision,
    evidence.measurement.completedAtMs,
  );
  insertArtifactMetadata(
    db,
    evidence.acceptanceFile,
    'PARENT_ACCEPTANCE',
    evidence.sourceRevision,
    evidence.acceptance.completedAtMs,
  );
  return insertOrReplayProof(db, expected);
}

async function loadAndValidateEvidence(acceptancePath) {
  const sourceBefore = sourceState(REPOSITORY_ROOT);
  const paths = resolveArtifactPaths(REPOSITORY_ROOT, acceptancePath);
  const acceptanceFile = requirePrivateArtifact(paths.acceptancePath, 'acceptance artifact');
  const acceptance = decodeCanonicalArtifact(acceptanceFile.bytes, 'acceptance artifact');
  await validateModelFailoverCandidateAcceptance(acceptance);
  if (acceptance.source.revision !== sourceBefore.revision) {
    fail(
      'MODEL_FAILOVER_PROOF_SOURCE_MISMATCH',
      'Acceptance source revision does not equal the current committed HEAD',
    );
  }
  const acceptedPaths = validateAcceptancePath(paths, acceptance);
  const measurementFile = requirePrivateArtifact(
    acceptedPaths.measurementPath,
    'measurement artifact',
  );
  if (measurementFile.sha256 !== acceptance.measurement.artifactSha256
    || measurementFile.byteLength !== acceptance.measurement.artifactByteLength) {
    fail(
      'MODEL_FAILOVER_PROOF_ARTIFACT_DIGEST_INVALID',
      'Measurement artifact does not match its accepted content address',
    );
  }
  const measurement = decodeCanonicalArtifact(measurementFile.bytes, 'measurement artifact');
  const expectedPins = {
    role: acceptance.candidate.role,
    modelName: acceptance.candidate.requestedModelName,
    digestSha256: acceptance.candidate.digestSha256,
    providerOrigin: acceptance.provider.origin,
    sourceRevisionClaim: acceptance.source.revision,
  };
  const measurementValidation = await validateModelFailoverMeasurementArtifact(
    measurement,
    expectedPins,
  );
  if (measurementValidation.validationScope !== 'PARENT_PINS_VERIFIED'
    || measurement.runId !== acceptance.measurement.runId
    || measurement.candidate.observedModelName !== acceptance.candidate.observedModelName
    || measurement.candidate.canonicalName !== acceptance.candidate.canonicalName
    || canonicalizeModelFailoverContract(measurement.inventoryBefore)
      !== canonicalizeModelFailoverContract(acceptance.provider.inventoryBefore)
    || canonicalizeModelFailoverContract(measurement.inventoryAfter)
      !== canonicalizeModelFailoverContract(acceptance.provider.inventoryAfter)) {
    fail('MODEL_FAILOVER_PROOF_EVIDENCE_INVALID', 'Measurement and acceptance disagree');
  }
  const expectedAcceptanceAuthority = {
    parentRunId: acceptance.parentRunId,
    sourceRevision: sourceBefore.revision,
    providerOrigin: acceptance.provider.origin,
    inventory: measurement.inventoryBefore,
    candidate: {
      role: measurement.candidate.role,
      requestedModelName: measurement.candidate.requestedModelName,
      observedModelName: measurement.candidate.observedModelName,
      digestSha256: measurement.candidate.digestSha256,
    },
    measurement: {
      runId: measurement.runId,
      artifactPath: acceptance.measurement.artifactPath,
      artifactSha256: measurementFile.sha256,
      artifactByteLength: measurementFile.byteLength,
    },
  };
  const acceptanceValidation = await validateModelFailoverCandidateAcceptance(
    acceptance,
    null,
    expectedAcceptanceAuthority,
  );
  if (acceptanceValidation.validationScope !== 'PARENT_PINS_VERIFIED') {
    fail('MODEL_FAILOVER_PROOF_EVIDENCE_INVALID', 'Acceptance lacks exact parent pins');
  }
  const proofContract = getModelFailoverProofContract(measurement.candidate.role);
  if (measurement.aggregate.score !== proofContract.contract.acceptance.requiredScore
    || measurement.aggregate.passedCount
      !== proofContract.contract.acceptance.requiredPassedCount
    || measurement.aggregate.totalCount !== proofContract.contract.role.totalCount
    || measurement.results.some(result => result.passed !== true || result.score !== 1)) {
    fail(
      'MODEL_FAILOVER_PROOF_THRESHOLD_NOT_MET',
      'Measurement does not satisfy every mandatory A-bootstrap test',
    );
  }
  if (measurement.completedAtMs > acceptance.completedAtMs) {
    fail('MODEL_FAILOVER_PROOF_EVIDENCE_INVALID', 'Acceptance predates its measurement');
  }
  const sourceAfter = sourceState(REPOSITORY_ROOT);
  if (sourceAfter.revision !== sourceBefore.revision) {
    fail('MODEL_FAILOVER_PROOF_SOURCE_DRIFT', 'Source revision changed during validation');
  }
  return Object.freeze({
    sourceRevision: sourceBefore.revision,
    acceptance: Object.freeze(acceptance),
    measurement: Object.freeze(measurement),
    acceptanceFile,
    measurementFile,
    proofContract,
  });
}

export function createModelFailoverProofIssuer(dbValue, options = {}) {
  const db = requireDatabase(dbValue);
  if (!isPlainRecord(options)) {
    fail('MODEL_FAILOVER_PROOF_ISSUER_INPUT_INVALID', 'issuer options must be a plain object');
  }
  const unexpectedOptions = Object.keys(options).filter(field => field !== 'clock');
  if (unexpectedOptions.length > 0) {
    fail(
      'MODEL_FAILOVER_PROOF_ISSUER_AUTHORITY_OVERRIDE_REJECTED',
      'issuer options contain unknown authority',
      { fields: unexpectedOptions.sort() },
    );
  }
  const clock = options.clock ?? Date.now;
  if (typeof clock !== 'function') {
    fail('MODEL_FAILOVER_PROOF_ISSUER_INPUT_INVALID', 'issuer clock must be a function');
  }
  return Object.freeze({
    async issue(inputValue) {
      exactKeys(inputValue, ['acceptancePath'], 'proof issuance input');
      const evidence = await loadAndValidateEvidence(inputValue.acceptancePath);
      const transaction = db.transaction(() => terminalRecheck(
        evidence,
        evidence.proofContract,
        clock,
        db,
      ));
      try {
        const result = transaction.immediate();
        return Object.freeze({
          outcome: result.outcome,
          proofId: result.row.proof_id,
          validationRunId: result.row.validation_run_id,
          role: result.row.role,
          modelName: result.row.model_name,
          modelDigestSha256: result.row.model_digest_sha256,
          roleContractSha256: result.row.role_contract_sha256,
          expiresAtMs: result.row.expires_at_ms,
          measurementArtifactSha256: result.row.measurement_artifact_sha256,
          acceptanceArtifactSha256: result.row.acceptance_artifact_sha256,
          sourceRevision: result.row.source_revision,
        });
      } catch (error) {
        if (error instanceof ModelFailoverProofIssuerError) throw error;
        throw new ModelFailoverProofIssuerError(
          'MODEL_FAILOVER_PROOF_PERSISTENCE_FAILED',
          'PASS proof transaction failed',
          { cause: error },
        );
      }
    },
  });
}

function parseCli(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!new Set(['--acceptance', '--db']).has(token) || index + 1 >= argv.length) {
      fail(
        'MODEL_FAILOVER_PROOF_ISSUER_INPUT_INVALID',
        'Usage: issue-model-failover-proof.js --acceptance <absolute path> --db <absolute path>',
      );
    }
    const field = token === '--acceptance' ? 'acceptancePath' : 'dbPath';
    if (Object.hasOwn(values, field)) {
      fail('MODEL_FAILOVER_PROOF_ISSUER_INPUT_INVALID', `${token} may appear only once`);
    }
    values[field] = argv[++index];
  }
  exactKeys(values, ['acceptancePath', 'dbPath'], 'CLI input');
  for (const [field, value] of Object.entries(values)) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) {
      fail('MODEL_FAILOVER_PROOF_ISSUER_INPUT_INVALID', `${field} must be absolute`);
    }
  }
  return Object.freeze(values);
}

function openExistingDatabase(dbPathValue) {
  const dbPath = path.resolve(dbPathValue);
  if (!existsSync(dbPath)) {
    fail('MODEL_FAILOVER_PROOF_DB_INVALID', 'Proof database does not exist');
  }
  const metadata = lstatSync(dbPath);
  if (!metadata.isFile()
    || metadata.isSymbolicLink()
    || (typeof process.getuid === 'function' && metadata.uid !== process.getuid())
    || realpathSync(dbPath) !== dbPath) {
    fail('MODEL_FAILOVER_PROOF_DB_INVALID', 'Proof database must be an owned regular file');
  }
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

function renderResult(result) {
  return JSON.stringify({ schemaVersion: 1, proofStatus: 'PASS', ...result });
}

function renderError(error) {
  return JSON.stringify({
    schemaVersion: 1,
    proofStatus: 'NOT_ISSUED',
    code: error instanceof ModelFailoverProofIssuerError
      ? error.code
      : 'MODEL_FAILOVER_PROOF_UNEXPECTED_FAILURE',
    message: error?.message || String(error),
  });
}

export async function main(argv = process.argv.slice(2)) {
  let db = null;
  try {
    if (realpathSync(process.cwd()) !== REPOSITORY_ROOT) {
      fail(
        'MODEL_FAILOVER_PROOF_SOURCE_INVALID',
        'Proof issuer must run from its repository root',
      );
    }
    const input = parseCli(argv);
    db = openExistingDatabase(input.dbPath);
    const issuer = createModelFailoverProofIssuer(db);
    const result = await issuer.issue({ acceptancePath: input.acceptancePath });
    process.stdout.write(`${renderResult(result)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${renderError(error)}\n`);
    return 1;
  } finally {
    db?.close();
  }
}

if (path.resolve(process.argv[1] || '') === SCRIPT_PATH) {
  process.exitCode = await main();
}
