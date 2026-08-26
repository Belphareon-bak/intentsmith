import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import {
  M6_L0_IDS,
  M6_RELEASE_EVIDENCE_CONTRACT,
  M6_RELEASE_EVIDENCE_VERSION,
  M6_RELEASE_STATUS,
  M6_RELEASE_VERDICT,
  M6_REQUIRED_CHECK_IDS,
} from '../../contracts/m6/release-v1.js';

const FULL_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const STATUS_VALUES = new Set(Object.values(M6_RELEASE_STATUS));
const EVIDENCE_KEYS = Object.freeze([
  'candidateSha',
  'checks',
  'conditionalJourneys',
  'contract',
  'generatedAt',
  'l0',
  'registryFingerprint',
  'version',
]);
const ROW_KEYS = Object.freeze(['artifacts', 'id', 'reasonCode', 'status']);
const CONDITIONAL_KEYS = Object.freeze([
  'artifacts',
  'journeyId',
  'reasonCode',
  'status',
]);
const ARTIFACT_KEYS = Object.freeze(['bytes', 'path', 'sha256']);
const EVIDENCE_ONLY_EXACT_PATHS = new Set([
  'ROADMAP.md',
  'SYSTEM-MAP.md',
  'docs/wp/WP-M6-RELEASE.md',
]);
const EVIDENCE_ONLY_PREFIXES = Object.freeze([
  'docs/execution/runs/',
  'docs/review/',
]);

function exactKeys(value, expected) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) return false;
  const normalized = value.replaceAll('\\', '/');
  return !path.posix.isAbsolute(normalized)
    && normalized !== '..'
    && !normalized.startsWith('../')
    && !normalized.includes('/../')
    && path.posix.normalize(normalized) === normalized;
}

function validArtifact(binding) {
  return exactKeys(binding, ARTIFACT_KEYS)
    && safeRelativePath(binding.path)
    && SHA256_PATTERN.test(binding.sha256 || '')
    && Number.isSafeInteger(binding.bytes)
    && binding.bytes >= 0;
}

function validateEvidenceRow(row, label, errors) {
  if (!exactKeys(row, ROW_KEYS)) {
    errors.push(`${label}:keys`);
    return;
  }
  if (!STATUS_VALUES.has(row.status)) errors.push(`${label}:status`);
  if (!Array.isArray(row.artifacts) || row.artifacts.some(binding => !validArtifact(binding))) {
    errors.push(`${label}:artifacts`);
  }
  if (row.status === M6_RELEASE_STATUS.PASS && row.artifacts.length === 0) {
    errors.push(`${label}:pass-without-artifact`);
  }
  if (row.status !== M6_RELEASE_STATUS.PASS) {
    if (
      typeof row.reasonCode !== 'string'
      || !/^[A-Z][A-Z0-9_]{2,127}$/u.test(row.reasonCode)
    ) errors.push(`${label}:reasonCode`);
  } else if (row.reasonCode !== null) {
    errors.push(`${label}:pass-reasonCode`);
  }
}

function validateExactIds(rows, expectedIds, label, errors) {
  if (!Array.isArray(rows)) {
    errors.push(`${label}:not-array`);
    return;
  }
  const actualIds = rows.map(row => row?.id);
  if (new Set(actualIds).size !== actualIds.length) errors.push(`${label}:duplicate-id`);
  if (JSON.stringify([...actualIds].sort()) !== JSON.stringify([...expectedIds].sort())) {
    errors.push(`${label}:exact-ids`);
  }
  rows.forEach((row, index) => validateEvidenceRow(row, `${label}[${index}]`, errors));
}

function validateConditionals(rows, expectedJourneys, errors) {
  if (!Array.isArray(rows)) {
    errors.push('conditionalJourneys:not-array');
    return;
  }
  const actualIds = rows.map(row => row?.journeyId);
  if (new Set(actualIds).size !== actualIds.length) {
    errors.push('conditionalJourneys:duplicate-id');
  }
  if (JSON.stringify([...actualIds].sort()) !== JSON.stringify([...expectedJourneys].sort())) {
    errors.push('conditionalJourneys:exact-ids');
  }
  rows.forEach((row, index) => {
    const label = `conditionalJourneys[${index}]`;
    if (!exactKeys(row, CONDITIONAL_KEYS)) {
      errors.push(`${label}:keys`);
      return;
    }
    validateEvidenceRow(
      { id: row.journeyId, status: row.status, reasonCode: row.reasonCode, artifacts: row.artifacts },
      label,
      errors,
    );
  });
}

function allStatusRows(evidence) {
  return [
    ...(evidence.checks || []),
    ...(evidence.l0 || []),
    ...(evidence.conditionalJourneys || []),
  ];
}

export function validateM6ReleaseEvidence(evidence, {
  candidateSha,
  worktreeClean,
  registryFingerprint,
  expectedConditionalJourneys,
} = {}) {
  const errors = [];
  if (!exactKeys(evidence, EVIDENCE_KEYS)) {
    errors.push('evidence:keys');
  } else {
    if (evidence.contract !== M6_RELEASE_EVIDENCE_CONTRACT) errors.push('evidence:contract');
    if (evidence.version !== M6_RELEASE_EVIDENCE_VERSION) errors.push('evidence:version');
    if (!FULL_SHA_PATTERN.test(evidence.candidateSha || '')) errors.push('evidence:candidateSha');
    if (evidence.candidateSha !== candidateSha) errors.push('candidate:mismatch');
    if (worktreeClean !== true) errors.push('candidate:dirty');
    if (!SHA256_PATTERN.test(evidence.registryFingerprint || '')) {
      errors.push('evidence:registryFingerprint');
    }
    if (evidence.registryFingerprint !== registryFingerprint) errors.push('registry:mismatch');
    if (!Number.isFinite(Date.parse(evidence.generatedAt))) errors.push('evidence:generatedAt');
    validateExactIds(evidence.checks, M6_REQUIRED_CHECK_IDS, 'checks', errors);
    validateExactIds(evidence.l0, M6_L0_IDS, 'l0', errors);
    validateConditionals(
      evidence.conditionalJourneys,
      Array.isArray(expectedConditionalJourneys) ? expectedConditionalJourneys : [],
      errors,
    );
  }

  let verdict = M6_RELEASE_VERDICT.FAIL;
  let exitCode = 1;
  if (errors.length === 0) {
    const statuses = allStatusRows(evidence).map(row => row.status);
    if (statuses.includes(M6_RELEASE_STATUS.FAIL)) {
      verdict = M6_RELEASE_VERDICT.FAIL;
      exitCode = 1;
    } else if (statuses.some(status => status !== M6_RELEASE_STATUS.PASS)) {
      verdict = M6_RELEASE_VERDICT.BLOCKED;
      exitCode = 2;
    } else {
      verdict = M6_RELEASE_VERDICT.PASS;
      exitCode = 0;
    }
  }
  return Object.freeze({
    contract: 'M6ReleaseValidation',
    version: 1,
    valid: errors.length === 0,
    verdict,
    exitCode,
    errors: Object.freeze(errors),
  });
}

export async function verifyM6ArtifactBindings(root, evidence) {
  const errors = [];
  const rootReal = await realpath(root);
  const bindings = allStatusRows(evidence)
    .flatMap(row => Array.isArray(row.artifacts) ? row.artifacts : []);
  for (const [index, binding] of bindings.entries()) {
    const label = `artifact[${index}]`;
    if (!validArtifact(binding)) {
      errors.push(`${label}:shape`);
      continue;
    }
    const target = path.resolve(root, binding.path);
    const relative = path.relative(root, target);
    if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`)) {
      errors.push(`${label}:outside-root`);
      continue;
    }
    try {
      const metadata = await lstat(target);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        errors.push(`${label}:not-regular`);
        continue;
      }
      const targetReal = await realpath(target);
      const realRelative = path.relative(rootReal, targetReal);
      if (realRelative === '' || realRelative === '..' || realRelative.startsWith(`..${path.sep}`)) {
        errors.push(`${label}:realpath-outside-root`);
        continue;
      }
      const bytes = await readFile(target);
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (bytes.length !== binding.bytes) errors.push(`${label}:bytes`);
      if (digest !== binding.sha256) errors.push(`${label}:sha256`);
    } catch (error) {
      errors.push(`${label}:${error.code === 'ENOENT' ? 'missing' : 'unreadable'}`);
    }
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function validateM6EvidenceCommitBoundary({
  candidateSha,
  evidenceHeadSha,
  candidateIsAncestor,
  changedPaths,
  worktreeClean,
  candidateRegistryFingerprint,
  evidenceRegistryFingerprint,
} = {}) {
  const errors = [];
  if (!FULL_SHA_PATTERN.test(candidateSha || '')) errors.push('boundary:candidate');
  if (!FULL_SHA_PATTERN.test(evidenceHeadSha || '')) errors.push('boundary:evidence-head');
  if (candidateIsAncestor !== true) errors.push('boundary:not-descendant');
  if (worktreeClean !== true) errors.push('boundary:dirty');
  if (!SHA256_PATTERN.test(candidateRegistryFingerprint || '')) {
    errors.push('boundary:candidate-registry');
  }
  if (candidateRegistryFingerprint !== evidenceRegistryFingerprint) {
    errors.push('boundary:registry-drift');
  }
  if (!Array.isArray(changedPaths)) {
    errors.push('boundary:changed-paths');
  } else {
    const normalized = changedPaths.map(value => String(value).replaceAll('\\', '/'));
    if (new Set(normalized).size !== normalized.length) errors.push('boundary:duplicate-path');
    for (const changedPath of normalized) {
      const allowed = EVIDENCE_ONLY_EXACT_PATHS.has(changedPath)
        || EVIDENCE_ONLY_PREFIXES.some(prefix => changedPath.startsWith(prefix));
      if (!safeRelativePath(changedPath) || !allowed) {
        errors.push(`boundary:product-path:${changedPath}`);
      }
    }
  }
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    candidateSha,
    evidenceHeadSha,
    evidenceOnly: candidateSha !== evidenceHeadSha,
  });
}
