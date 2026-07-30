import {
  EXPECTED_RECORD_COUNT,
  EXPECTED_RECORDS_SHA256,
  MANIFEST_SCHEMA_VERSION,
  SOURCE_BASE,
  SOURCE_HEAD,
  SOURCE_REPOSITORY_IDENTITY,
} from './final-disposition-manifest.js';

export const ReviewStatus = Object.freeze({
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
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
    report?.schemaVersion !== 2
    || !Array.isArray(report.errors)
    || !Number.isInteger(report.records)
    || !validObject(report.sourceManifest)
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
      || sumCounts(report.sourceManifest.changeCounts) !== EXPECTED_RECORD_COUNT
      || dispositionTotal !== EXPECTED_RECORD_COUNT
      || terminalTotal !== report.dispositionCounts.REBUILD
      || resolutionTotal !== EXPECTED_RECORD_COUNT
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

export function findOpenGate0RepositoryBlockers(
  riskMarkdown,
  blockerIds = ['G0-R023', 'G0-R025'],
) {
  const statuses = new Map();
  for (const line of String(riskMarkdown).split('\n')) {
    const match = line.match(/^\| (G0-R\d+) \|.*\| ([A-Z][A-Z0-9_]*) \|$/);
    if (!match) continue;
    const statusList = statuses.get(match[1]) || [];
    statusList.push(match[2]);
    statuses.set(match[1], statusList);
  }

  const closedStatuses = new Set(['ACCEPTED', 'CLOSED', 'MITIGATED']);
  return blockerIds.flatMap((id) => {
    const statusList = statuses.get(id);
    if (!statusList) return [`${id}: missing from RISK-REGISTER.md`];
    if (statusList.length !== 1) return [`${id}: duplicate risk rows`];
    return closedStatuses.has(statusList[0]) ? [] : [`${id}: ${statusList[0]}`];
  });
}

export function deriveGateOutcome({
  clauses,
  repositoryBlockers = [],
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

  const failedClauses = clauses.filter(clause => clause.result === 'FAIL');
  const blockers = [...repositoryBlockers];
  if (failedClauses.length > 0 || blockers.length > 0) {
    return {
      verdict: 'FAIL',
      exitCode: 1,
      failedClauses,
      repositoryBlockers: blockers,
      reviewStatus,
    };
  }
  if (reviewStatus === ReviewStatus.PENDING) {
    return {
      verdict: 'CONDITIONAL PASS',
      exitCode: 0,
      failedClauses: [],
      repositoryBlockers: [],
      reviewStatus,
    };
  }
  return {
    verdict: 'PASS',
    exitCode: 0,
    failedClauses: [],
    repositoryBlockers: [],
    reviewStatus,
  };
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
