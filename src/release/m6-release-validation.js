import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import {
  M6_L0_IDS,
  M6_RELEASE_EVIDENCE_CONTRACT,
  M6_RELEASE_EVIDENCE_INDEX_CONTRACT,
  M6_RELEASE_EVIDENCE_INDEX_VERSION,
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
const INDEX_KEYS = Object.freeze([
  'candidateSha',
  'contract',
  'generatedAt',
  'registryFingerprint',
  'releaseArtifactManifest',
  'reports',
  'version',
]);
const INDEX_REPORT_KEYS = Object.freeze(['artifact', 'logs', 'phaseId', 'runner']);
const INDEX_LOG_KEYS = Object.freeze(['artifact', 'programId']);
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

export function validateM6ReleaseEvidenceIndex(index, {
  candidateSha,
  registryFingerprint,
  expectedPhases,
} = {}) {
  const errors = [];
  if (!exactKeys(index, INDEX_KEYS)) {
    errors.push('index:keys');
    return Object.freeze({ valid: false, errors: Object.freeze(errors) });
  }
  if (index.contract !== M6_RELEASE_EVIDENCE_INDEX_CONTRACT) errors.push('index:contract');
  if (index.version !== M6_RELEASE_EVIDENCE_INDEX_VERSION) errors.push('index:version');
  if (!FULL_SHA_PATTERN.test(index.candidateSha || '') || index.candidateSha !== candidateSha) {
    errors.push('index:candidate');
  }
  if (
    !SHA256_PATTERN.test(index.registryFingerprint || '')
    || index.registryFingerprint !== registryFingerprint
  ) errors.push('index:registry');
  if (!Number.isFinite(Date.parse(index.generatedAt))) errors.push('index:generatedAt');
  if (!validArtifact(index.releaseArtifactManifest)) errors.push('index:release-artifact');
  if (!Array.isArray(index.reports)) {
    errors.push('index:reports');
  } else {
    const actualPhaseIds = index.reports.map(item => item?.phaseId);
    const expectedPhaseIds = (expectedPhases || []).map(item => item.id);
    if (new Set(actualPhaseIds).size !== actualPhaseIds.length) {
      errors.push('index:duplicate-phase');
    }
    if (
      JSON.stringify(actualPhaseIds)
      !== JSON.stringify(expectedPhaseIds)
    ) errors.push('index:exact-phases');
    index.reports.forEach((item, indexPosition) => {
      if (!exactKeys(item, INDEX_REPORT_KEYS)) {
        errors.push(`index.reports[${indexPosition}]:keys`);
      } else {
        const expectedPhase = expectedPhases?.[indexPosition];
        if (item.runner !== expectedPhase?.runner) {
          errors.push(`index.reports[${indexPosition}]:runner`);
        }
        if (!validArtifact(item.artifact)) {
          errors.push(`index.reports[${indexPosition}]:artifact`);
        }
        if (!Array.isArray(item.logs)) {
          errors.push(`index.reports[${indexPosition}]:logs`);
        } else {
          const programIds = item.logs.map(log => log?.programId);
          if (new Set(programIds).size !== programIds.length) {
            errors.push(`index.reports[${indexPosition}]:duplicate-log-program`);
          }
          if (
            JSON.stringify([...programIds].sort())
            !== JSON.stringify([...(expectedPhase?.programIds || [])].sort())
          ) errors.push(`index.reports[${indexPosition}]:phase-programs`);
          item.logs.forEach((log, logIndex) => {
            if (
              !exactKeys(log, INDEX_LOG_KEYS)
              || typeof log.programId !== 'string'
              || log.programId.length === 0
              || !validArtifact(log.artifact)
            ) {
              errors.push(`index.reports[${indexPosition}].logs[${logIndex}]:shape`);
            }
          });
        }
      }
    });
  }
  const paths = [
    index.releaseArtifactManifest?.path,
    ...(index.reports || []).map(item => item?.artifact?.path),
    ...(index.reports || []).flatMap(item => (item?.logs || []).map(log => log?.artifact?.path)),
  ];
  if (new Set(paths).size !== paths.length) errors.push('index:duplicate-artifact-path');
  for (const artifactPath of paths) {
    if (
      typeof artifactPath === 'string'
      && !artifactPath.startsWith('docs/execution/runs/m6/')
    ) errors.push(`index:artifact-outside-git-evidence:${artifactPath}`);
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function validateM6ReportLogBindings(indexReport, report) {
  const errors = [];
  if (!Array.isArray(indexReport?.logs) || !Array.isArray(report?.results)) {
    return Object.freeze({ valid: false, errors: Object.freeze(['report-logs:shape']) });
  }
  const byProgram = new Map(indexReport.logs.map(log => [log.programId, log.artifact]));
  const resultIds = report.results.map(result => result?.id);
  if (new Set(resultIds).size !== resultIds.length) errors.push('report-logs:duplicate-result');
  if (
    JSON.stringify([...byProgram.keys()].sort()) !== JSON.stringify([...resultIds].sort())
  ) errors.push('report-logs:exact-programs');
  for (const result of report.results) {
    const binding = byProgram.get(result?.id);
    if (!binding) continue;
    if (result.logPath !== binding.path) errors.push(`report-logs:path:${result.id}`);
    if (result.logSha256 !== binding.sha256) errors.push(`report-logs:sha256:${result.id}`);
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
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

export async function verifyM6GitArtifactBindings(bindings, { readGitArtifact } = {}) {
  const errors = [];
  if (!Array.isArray(bindings)) {
    return Object.freeze({ valid: false, errors: Object.freeze(['git-artifacts:not-array']) });
  }
  if (typeof readGitArtifact !== 'function') {
    return Object.freeze({ valid: false, errors: Object.freeze(['git-artifacts:reader']) });
  }
  for (const [index, binding] of bindings.entries()) {
    const label = `git-artifact[${index}]`;
    if (!validArtifact(binding)) {
      errors.push(`${label}:shape`);
      continue;
    }
    try {
      const artifact = await readGitArtifact(binding.path);
      if (!Buffer.isBuffer(artifact?.bytes) || typeof artifact?.executable !== 'boolean') {
        throw new Error('invalid-git-artifact');
      }
      if (artifact.bytes.length !== binding.bytes) errors.push(`${label}:bytes`);
      if (createHash('sha256').update(artifact.bytes).digest('hex') !== binding.sha256) {
        errors.push(`${label}:sha256`);
      }
    } catch {
      errors.push(`${label}:missing-or-unreadable-git-blob`);
    }
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function validateM6EvidenceCommitBoundary({
  candidateSha,
  evidenceHeadSha,
  candidateIsAncestor,
  changedEntries,
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
  validateEvidenceOnlyEntries(changedEntries, 'boundary', errors);
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    candidateSha,
    evidenceHeadSha,
    evidenceOnly: candidateSha !== evidenceHeadSha,
  });
}

function validateEvidenceOnlyEntries(changedEntries, label, errors) {
  if (!Array.isArray(changedEntries)) {
    errors.push(`${label}:changed-entries`);
    return;
  }
  const normalized = changedEntries.map(entry => ({
    status: entry?.status,
    path: String(entry?.path || '').replaceAll('\\', '/'),
  }));
  if (new Set(normalized.map(entry => entry.path)).size !== normalized.length) {
    errors.push(`${label}:duplicate-path`);
  }
  for (const entry of normalized) {
    const changedPath = entry.path;
    const allowed = EVIDENCE_ONLY_EXACT_PATHS.has(changedPath)
      || EVIDENCE_ONLY_PREFIXES.some(prefix => changedPath.startsWith(prefix));
    if (!['A', 'M'].includes(entry.status)) {
      errors.push(`${label}:unsafe-change:${entry.status || 'unknown'}:${changedPath}`);
    }
    if (!safeRelativePath(changedPath) || !allowed) {
      errors.push(`${label}:product-path:${changedPath}`);
    }
  }
}

export function validateM6EvidenceCommitHistory({
  candidateSha,
  evidenceHeadSha,
  candidateIsAncestor,
  commits,
  worktreeClean,
  candidateRegistryFingerprint,
  evidenceRegistryFingerprint,
} = {}) {
  const errors = [];
  if (!FULL_SHA_PATTERN.test(candidateSha || '')) errors.push('history:candidate');
  if (!FULL_SHA_PATTERN.test(evidenceHeadSha || '')) errors.push('history:evidence-head');
  if (candidateIsAncestor !== true) errors.push('history:not-descendant');
  if (worktreeClean !== true) errors.push('history:dirty');
  if (!SHA256_PATTERN.test(candidateRegistryFingerprint || '')) {
    errors.push('history:candidate-registry');
  }
  if (candidateRegistryFingerprint !== evidenceRegistryFingerprint) {
    errors.push('history:registry-drift');
  }
  if (!Array.isArray(commits)) {
    errors.push('history:commits');
  } else {
    if (candidateSha !== evidenceHeadSha && commits.length === 0) errors.push('history:empty');
    let expectedParent = candidateSha;
    for (const [index, commit] of commits.entries()) {
      const label = `history:commit[${index}]`;
      if (!FULL_SHA_PATTERN.test(commit?.commitSha || '')) errors.push(`${label}:sha`);
      if (!Array.isArray(commit?.parentShas) || commit.parentShas.length === 0) {
        errors.push(`${label}:parents`);
        continue;
      }
      if (commit.parentShas.length !== 1) errors.push(`${label}:merge-forbidden`);
      if (!Array.isArray(commit.changesByParent)
        || commit.changesByParent.length !== commit.parentShas.length) {
        errors.push(`${label}:parent-diffs`);
      } else {
        const seenParents = new Set();
        for (const parentDiff of commit.changesByParent) {
          const parentSha = parentDiff?.parentSha;
          if (!commit.parentShas.includes(parentSha) || seenParents.has(parentSha)) {
            errors.push(`${label}:parent-diff-binding`);
          }
          seenParents.add(parentSha);
          validateEvidenceOnlyEntries(parentDiff?.changedEntries, label, errors);
        }
      }
      if (commit.parentShas.length === 1 && commit.parentShas[0] !== expectedParent) {
        errors.push(`${label}:nonlinear-parent`);
      }
      expectedParent = commit.commitSha;
    }
    if (commits.length > 0 && commits.at(-1)?.commitSha !== evidenceHeadSha) {
      errors.push('history:head-binding');
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
