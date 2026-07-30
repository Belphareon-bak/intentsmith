import { createHash } from 'node:crypto';
import {
  EXPECTED_RECORD_COUNT,
  EXPECTED_RECORDS_SHA256,
  MANIFEST_SCHEMA_VERSION,
  SOURCE_BASE,
  SOURCE_HEAD,
  SOURCE_REPOSITORY_IDENTITY,
} from './final-disposition-manifest.js';

const EXPECTED_CHANGE_COUNTS = Object.freeze({
  ADD: 185,
  DELETE: 0,
  MODIFY: 24,
  RENAME: 16,
});
const ALLOWED_DISPOSITIONS = new Set(['EXCLUDE', 'KEEP', 'REBUILD']);
const ALLOWED_RESOLUTIONS = new Set([
  'ABSENT',
  'EXACT',
  'EXACT_DELETE',
  'MAPPED_REPAIR',
  'MODIFIED',
]);
const DEFERRED_PREREQUISITES = new Set([
  'external-network',
  'gpu',
  'isolated-database',
  'ollama',
  'operator-fixture',
  'owned-server',
  'pinned-model',
  'sufficient-gpu-vram',
  'three-request-gpu-headroom',
]);
const CLOSED_RISK_STATES = new Set([
  'ACCEPTED',
  'CLOSED',
  'MITIGATED',
  'MITIGATED_WITH_RESIDUAL',
  'MITIGATED_WITH_RESIDUALS',
]);
const EXPECTED_REPAIRED_SUBJECT_COUNT = 60;
const REPAIRED_SUBJECTS_PATH =
  'docs/convergence/FINAL-COMMIT-DISPOSITION-SUBJECTS.json';

export const ReviewStatus = Object.freeze({
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
});

export const GateImpact = Object.freeze({
  G0_FAIL: 'G0_FAIL',
  G0_REVIEW_REQUIRED: 'G0_REVIEW_REQUIRED',
  LATER_GATE: 'LATER_GATE',
  SEPARATE_INCIDENT: 'SEPARATE_INCIDENT',
});

export class EvidenceInfrastructureError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EvidenceInfrastructureError';
  }
}

export function classifyRegistryValidatorExecution(result) {
  const label = 'registry validation';
  assertExecutableResult(result, label);
  if (result.status !== 0 && result.status !== 1) {
    throw new EvidenceInfrastructureError(
      `${label} returned unsupported exit ${String(result.status)}`,
    );
  }

  const stdout = String(result.stdout || '');
  const stderr = String(result.stderr || '');
  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    throw new EvidenceInfrastructureError(`${label} did not emit valid JSON`);
  }
  if (
    report?.schemaVersion !== 1
    || typeof report.valid !== 'boolean'
    || !Array.isArray(report.errors)
    || report.document?.path !== 'docs/convergence/TEST-REGISTRY.md'
    || report.document?.mode !== 'check'
  ) {
    throw new EvidenceInfrastructureError(
      `${label} emitted an unsupported report schema`,
    );
  }

  const expectedExit = report.errors.length === 0 && report.valid ? 0 : 1;
  if (result.status !== expectedExit || report.valid !== (report.errors.length === 0)) {
    throw new EvidenceInfrastructureError(
      `${label} exit/report validity is contradictory`,
    );
  }
  if (
    report.valid
    && (
      !Number.isInteger(report.runnablePrograms)
      || report.runnablePrograms < 1
      || !Number.isInteger(report.explicitSupportExclusions)
      || report.explicitSupportExclusions < 0
      || !/^[a-f0-9]{64}$/.test(report.fingerprint || '')
    )
  ) {
    throw new EvidenceInfrastructureError(
      `${label} green report is missing inventory evidence`,
    );
  }

  return {
    exitCode: result.status,
    passed: result.status === 0,
    stdout,
    stderr,
    output: `${stdout}${stderr}`,
    errors: [...report.errors],
    report,
  };
}

export function classifyDispositionValidatorExecution(result) {
  const label = 'disposition validation';
  assertExecutableResult(result, label);
  if (result.status !== 0 && result.status !== 1) {
    throw new EvidenceInfrastructureError(
      `${label} returned unsupported exit ${String(result.status)}`,
    );
  }

  const stdout = String(result.stdout || '');
  const stderr = String(result.stderr || '');
  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    throw new EvidenceInfrastructureError(
      `${label} did not emit valid JSON`,
    );
  }
  if (
    report?.schemaVersion !== 3
    || !Array.isArray(report.errors)
    || !Number.isInteger(report.records)
    || !validObject(report.sourceManifest)
    || !validObject(report.repairedSubjectEvidence)
    || !validObject(report.dispositionCounts)
    || !validObject(report.terminalCounts)
    || !validObject(report.resolutionCounts)
    || !Array.isArray(report.paths)
    || !validCountMap(report.dispositionCounts)
    || !validCountMap(report.terminalCounts)
    || !validCountMap(report.resolutionCounts)
  ) {
    throw new EvidenceInfrastructureError(
      `${label} emitted an unsupported report schema`,
    );
  }

  const expectedExit = report.errors.length === 0 ? 0 : 1;
  if (result.status !== expectedExit) {
    throw new EvidenceInfrastructureError(
      `${label} exit ${result.status} disagrees with ${report.errors.length} reported errors`,
    );
  }
  if (result.status === 0) {
    const dispositionTotal = sumCounts(report.dispositionCounts);
    const terminalTotal = sumCounts(report.terminalCounts);
    const resolutionTotal = sumCounts(report.resolutionCounts);
    const pathDispositionCounts = countPathValues(report.paths, 'disposition');
    const pathTerminalCounts = countPathValues(
      report.paths.filter(item => item.disposition === 'REBUILD'),
      'action',
    );
    const pathResolutionCounts = countPathValues(report.paths, 'resolution');
    if (
      report.records !== EXPECTED_RECORD_COUNT
      || report.paths.length !== EXPECTED_RECORD_COUNT
      || report.sourceRepository?.identity !== SOURCE_REPOSITORY_IDENTITY
      || report.sourceRange?.base !== SOURCE_BASE
      || report.sourceRange?.head !== SOURCE_HEAD
      || report.sourceManifest.path
        !== 'docs/convergence/FINAL-COMMIT-DIFF-MANIFEST.json'
      || report.sourceManifest.schemaVersion !== MANIFEST_SCHEMA_VERSION
      || report.sourceManifest.recordCount !== EXPECTED_RECORD_COUNT
      || report.sourceManifest.recordsSha256 !== EXPECTED_RECORDS_SHA256
      || !sameCountMap(report.sourceManifest.changeCounts, EXPECTED_CHANGE_COUNTS)
      || report.repairedSubjectEvidence.path !== REPAIRED_SUBJECTS_PATH
      || report.repairedSubjectEvidence.schemaVersion !== 1
      || report.repairedSubjectEvidence.sourceManifestRecordsSha256
        !== EXPECTED_RECORDS_SHA256
      || report.repairedSubjectEvidence.terminalState !== 'REBUILD/REPAIRED'
      || report.repairedSubjectEvidence.recordCount !== EXPECTED_REPAIRED_SUBJECT_COUNT
      || report.repairedSubjectEvidence.validatedCount !== EXPECTED_REPAIRED_SUBJECT_COUNT
      || report.repairedSubjectEvidence.recordsDigestAlgorithm
        !== 'sha256-repaired-subject-tuples-v1'
      || !/^[a-f0-9]{64}$/.test(
        report.repairedSubjectEvidence.recordsSha256 || '',
      )
      || report.repairedSubjectEvidence.recordsSha256
        !== repairedSubjectsDigest(report.paths)
      || dispositionTotal !== EXPECTED_RECORD_COUNT
      || terminalTotal !== report.dispositionCounts.REBUILD
      || report.terminalCounts.REPAIRED !== EXPECTED_REPAIRED_SUBJECT_COUNT
      || resolutionTotal !== EXPECTED_RECORD_COUNT
      || !keysAllowed(report.dispositionCounts, ALLOWED_DISPOSITIONS)
      || !keysAllowed(report.resolutionCounts, ALLOWED_RESOLUTIONS)
      || !Object.keys(report.terminalCounts).every(validTerminalState)
      || !sameCountMap(report.dispositionCounts, pathDispositionCounts)
      || !sameCountMap(report.terminalCounts, pathTerminalCounts)
      || !sameCountMap(report.resolutionCounts, pathResolutionCounts)
    ) {
      throw new EvidenceInfrastructureError(
        `${label} green report violates pinned count or source invariants`,
      );
    }
  }

  return {
    exitCode: result.status,
    passed: result.status === 0,
    stdout,
    stderr,
    output: `${stdout}${stderr}`,
    errors: [...report.errors],
    report,
  };
}

function validObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validCountMap(value) {
  return Object.values(value).every(
    count => Number.isInteger(count) && count >= 0,
  );
}

function sumCounts(value) {
  return validObject(value)
    ? Object.values(value).reduce((sum, count) => sum + count, 0)
    : Number.NaN;
}

function countPathValues(values, key) {
  return values.reduce((counts, value) => {
    const label = value?.[key];
    if (typeof label !== 'string' || label === '') return counts;
    counts[label] = (counts[label] || 0) + 1;
    return counts;
  }, {});
}

function keysAllowed(counts, allowed) {
  return Object.keys(counts).every(key => allowed.has(key));
}

function sameCountMap(left, right) {
  if (!validObject(left) || !validObject(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => (
      key === rightKeys[index] && left[key] === right[key]
    ))
  );
}

function validTerminalState(value) {
  if (value === 'ACCEPTED' || value === 'REPAIRED') return true;
  const match = value.match(/^DEFERRED\(([^()]*)\)$/);
  if (!match || match[1] === '') return false;
  const prerequisites = match[1].split('+');
  return (
    new Set(prerequisites).size === prerequisites.length
    && prerequisites.every(item => DEFERRED_PREREQUISITES.has(item))
  );
}

function repairedSubjectsDigest(paths) {
  const records = paths
    .filter(item => item.disposition === 'REBUILD' && item.action === 'REPAIRED')
    .map(item => ([
      item.sourceSequence,
      item.displayPath,
      item.candidatePath,
      item.candidateBlob,
      item.candidateMode,
      typeof item.rationale === 'string'
        ? createHash('sha256').update(item.rationale).digest('hex')
        : null,
    ]));
  const sourceSequences = new Set(records.map(record => record[0]));
  const candidatePaths = new Set(records.map(record => record[2]));
  if (
    records.length !== EXPECTED_REPAIRED_SUBJECT_COUNT
    || sourceSequences.size !== records.length
    || candidatePaths.size !== records.length
  ) {
    return null;
  }
  return createHash('sha256').update(JSON.stringify(records)).digest('hex');
}

export function evaluateGate0RiskPolicy(riskMarkdown, policy) {
  const errors = [];
  const registerRows = parseRiskRegister(riskMarkdown, errors);
  const registerById = groupBy(registerRows, row => row.riskId);
  const impacts = Object.values(GateImpact);
  const validEntries = new Map();

  if (policy?.schemaVersion !== 1) {
    errors.push('risk policy schemaVersion must equal 1');
  }
  if (policy?.gate !== 'Gate 0') {
    errors.push('risk policy gate must equal Gate 0');
  }
  if (policy?.source !== 'docs/convergence/RISK-REGISTER.md') {
    errors.push('risk policy source must equal docs/convergence/RISK-REGISTER.md');
  }
  if (!Array.isArray(policy?.risks)) {
    errors.push('risk policy risks must be an array');
  }

  const policyEntries = Array.isArray(policy?.risks) ? policy.risks : [];
  for (const [index, entry] of policyEntries.entries()) {
    if (!validObject(entry)) {
      errors.push(`risk policy risks[${index}] must be an object`);
    }
  }
  const policyById = groupBy(
    policyEntries.filter(entry => validObject(entry)),
    entry => entry.riskId,
  );

  for (const [riskId, entries] of policyById) {
    if (!/^G0-R\d{3}$/.test(riskId || '')) {
      errors.push(`risk policy contains invalid riskId ${String(riskId)}`);
      continue;
    }
    if (entries.length !== 1) {
      errors.push(`${riskId}: duplicate gateImpact policy entries`);
      continue;
    }
    const [entry] = entries;
    let valid = true;
    if (!impacts.includes(entry.gateImpact)) {
      errors.push(`${riskId}: unknown gateImpact ${String(entry.gateImpact)}`);
      valid = false;
    }
    if (typeof entry.rationale !== 'string' || entry.rationale.trim() === '') {
      errors.push(`${riskId}: gateImpact rationale is required`);
      valid = false;
    }
    if (
      entry.gateImpact !== GateImpact.G0_FAIL
      && (typeof entry.condition !== 'string' || entry.condition.trim() === '')
    ) {
      errors.push(`${riskId}: ${entry.gateImpact} requires a concrete condition`);
      valid = false;
    }
    if (valid) validEntries.set(riskId, entry);
  }

  const repositoryBlockers = [];
  const reviewRequiredRisks = [];
  const laterGateRisks = [];
  const separateIncidents = [];
  const impactCounts = Object.fromEntries(impacts.map(impact => [impact, 0]));
  const openImpactCounts = Object.fromEntries(impacts.map(impact => [impact, 0]));

  for (const [riskId, rows] of registerById) {
    if (rows.length !== 1) {
      errors.push(`${riskId}: duplicate risk register rows`);
      if (rows.some(row => !isClosedRiskState(row.state))) {
        repositoryBlockers.push(`${riskId}: duplicate OPEN/local risk rows`);
      }
      continue;
    }
    const [row] = rows;
    const entry = validEntries.get(riskId);
    if (!entry) {
      errors.push(`${riskId}: missing valid gateImpact policy`);
      if (!isClosedRiskState(row.state)) {
        repositoryBlockers.push(`${riskId}: ${row.state} (unclassified OPEN/local risk)`);
      }
      continue;
    }

    impactCounts[entry.gateImpact] += 1;
    if (isClosedRiskState(row.state)) continue;
    openImpactCounts[entry.gateImpact] += 1;

    const label = `${riskId}: ${row.state}`;
    if (entry.gateImpact === GateImpact.G0_FAIL) repositoryBlockers.push(label);
    else if (entry.gateImpact === GateImpact.G0_REVIEW_REQUIRED) {
      reviewRequiredRisks.push(label);
    } else if (entry.gateImpact === GateImpact.LATER_GATE) {
      laterGateRisks.push(label);
    } else if (entry.gateImpact === GateImpact.SEPARATE_INCIDENT) {
      separateIncidents.push(label);
    }
  }

  for (const riskId of policyById.keys()) {
    if (!registerById.has(riskId)) {
      errors.push(`${riskId}: gateImpact policy has no risk register row`);
    }
  }

  return {
    schemaVersion: policy?.schemaVersion ?? null,
    valid: errors.length === 0,
    errors: uniqueSorted(errors),
    riskCount: registerRows.length,
    policyCount: policyEntries.length,
    impactCounts,
    openImpactCounts,
    repositoryBlockers: uniqueSorted(repositoryBlockers),
    reviewRequiredRisks: uniqueSorted(reviewRequiredRisks),
    laterGateRisks: uniqueSorted(laterGateRisks),
    separateIncidents: uniqueSorted(separateIncidents),
  };
}

export function deriveGateOutcome({
  clauses,
  repositoryBlockers = [],
  reviewRequiredRisks = [],
  reviewStatus = ReviewStatus.PENDING,
}) {
  if (!Array.isArray(clauses) || clauses.length === 0) {
    throw new EvidenceInfrastructureError('Gate 0 clauses are missing');
  }
  for (const clause of clauses) {
    if (
      typeof clause?.id !== 'string'
      || !['PASS', 'FAIL'].includes(clause.result)
      || typeof clause.evidence !== 'string'
    ) {
      throw new EvidenceInfrastructureError('Gate 0 clause has an invalid shape');
    }
  }
  if (!Object.values(ReviewStatus).includes(reviewStatus)) {
    throw new EvidenceInfrastructureError(
      `unsupported independent review status: ${String(reviewStatus)}`,
    );
  }
  if (
    !Array.isArray(reviewRequiredRisks)
    || reviewRequiredRisks.some(item => typeof item !== 'string' || item === '')
  ) {
    throw new EvidenceInfrastructureError(
      'Gate 0 review-required risks have an invalid shape',
    );
  }

  const failedClauses = clauses.filter(clause => clause.result === 'FAIL');
  const blockers = [...repositoryBlockers];
  const reviewRisks = uniqueSorted(reviewRequiredRisks);
  if (failedClauses.length > 0 || blockers.length > 0) {
    return {
      verdict: 'FAIL',
      exitCode: 1,
      failedClauses,
      repositoryBlockers: blockers,
      reviewRequiredRisks: reviewRisks,
      reviewStatus,
    };
  }
  if (reviewStatus === ReviewStatus.PENDING) {
    return {
      verdict: 'CONDITIONAL PASS',
      exitCode: 0,
      failedClauses: [],
      repositoryBlockers: [],
      reviewRequiredRisks: reviewRisks,
      reviewStatus,
    };
  }
  return {
    verdict: 'PASS',
    exitCode: 0,
    failedClauses: [],
    repositoryBlockers: [],
    reviewRequiredRisks: reviewRisks,
    reviewStatus,
  };
}

function parseRiskRegister(markdown, errors) {
  const rows = [];
  for (const [index, line] of String(markdown).split('\n').entries()) {
    if (!/^\|\s*G0-R\d{3}\s*\|/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    if (cells.length !== 7) {
      errors.push(`risk register line ${index + 1} must contain seven columns`);
      continue;
    }
    const [riskId, severity, probability, risk, mitigation, owner, state] = cells;
    if (!/^G0-R\d{3}$/.test(riskId)) {
      errors.push(`risk register line ${index + 1} has invalid risk ID`);
      continue;
    }
    if ([severity, probability, risk, mitigation, owner, state].some(value => value === '')) {
      errors.push(`${riskId}: risk register row contains an empty field`);
    }
    rows.push({ riskId, state });
  }
  if (rows.length === 0) errors.push('risk register contains no G0 risk rows');
  return rows;
}

function groupBy(values, keyFn) {
  const grouped = new Map();
  for (const value of values) {
    const key = keyFn(value);
    const group = grouped.get(key) || [];
    group.push(value);
    grouped.set(key, group);
  }
  return grouped;
}

function isClosedRiskState(state) {
  return CLOSED_RISK_STATES.has(state);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function assertExecutableResult(result, label) {
  if (result?.error) {
    throw new EvidenceInfrastructureError(
      `${label} could not execute: ${result.error.message || result.error}`,
    );
  }
  if (result?.signal) {
    throw new EvidenceInfrastructureError(
      `${label} terminated by signal ${result.signal}`,
    );
  }
  if (!Number.isInteger(result?.status)) {
    throw new EvidenceInfrastructureError(
      `${label} did not return an exit code`,
    );
  }
}
