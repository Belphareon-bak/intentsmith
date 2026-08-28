import { createHash } from 'node:crypto';

import {
  M6_DYNAMIC_TECHNICAL_CHECKS,
  M6_EXTERNAL_AUTHORITY_CHECKS,
  M6_TECHNICAL_EVIDENCE_CONTRACT,
  M6_TECHNICAL_EVIDENCE_VERSION,
  M6_TECHNICAL_PROGRAMS,
} from '../../contracts/m6/technical-evidence-v1.js';
import {
  M6_L0_EVIDENCE_PROGRAMS,
  M6_L0_SEMANTIC_AUTHORITY,
  M6_L0_SEMANTIC_STATE,
} from '../../contracts/m6/l0-evidence-v1.js';
import {
  M6_L0_IDS,
  M6_RELEASE_EVIDENCE_VERSION,
  M6_REQUIRED_CHECK_IDS,
} from '../../contracts/m6/release-v1.js';
import {
  M6_RUNTIME_EVIDENCE_PROGRAMS,
} from '../../contracts/m6/runtime-evidence-v1.js';
import { validateM6CandidateExecutionPlan } from './m6-candidate-plan.js';
import { validateM6RuntimeEvidence } from './m6-runtime-evidence.js';

const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function validArtifact(binding) {
  return binding !== null
    && typeof binding === 'object'
    && !Array.isArray(binding)
    && typeof binding.path === 'string'
    && binding.path.length > 0
    && Number.isSafeInteger(binding.bytes)
    && binding.bytes >= 0
    && SHA256_PATTERN.test(binding.sha256 || '');
}

function passingResult(entry, candidateSha) {
  const result = entry?.result;
  return result?.status === 'PASS'
    && result.required === true
    && result.exitCode === 0
    && result.signal === null
    && result.timedOut === false
    && result.sourceRevision === candidateSha
    && result.cleanup?.checked === true
    && result.cleanup?.leakDetected === false
    && result.cleanup?.terminated === true
    && result.sourceTree?.checked === true
    && result.sourceTree?.clean === true
    && result.sourceTree?.head === candidateSha
    && SHA256_PATTERN.test(result.logSha256 || '')
    && entry.logValid === true
    && entry.runtimeValidation.valid === true;
}

function technicalProgramSets(registry) {
  const sets = Object.fromEntries(
    Object.entries(M6_TECHNICAL_PROGRAMS).map(([id, programs]) => [id, [...programs]]),
  );
  for (const [id, definition] of Object.entries(M6_DYNAMIC_TECHNICAL_CHECKS)) {
    sets[id] = (registry?.suites || [])
      .filter(suite => (
        suite.required === true
        && suite.state === 'ACTIVE'
        && definition.profiles.includes(suite.profile)
      ))
      .map(suite => suite.id)
      .sort();
  }
  return sets;
}

export function validateM6TechnicalProgramMap(registry) {
  const errors = [];
  const registrySuites = new Map((registry?.suites || []).map(suite => [suite.id, suite]));
  const sets = technicalProgramSets(registry);
  const expectedTechnicalIds = M6_REQUIRED_CHECK_IDS.filter(
    id => !M6_EXTERNAL_AUTHORITY_CHECKS.includes(id),
  );
  if (JSON.stringify(Object.keys(sets).sort()) !== JSON.stringify(expectedTechnicalIds.sort())) {
    errors.push('technical-map:exact-check-ids');
  }
  for (const [checkId, programIds] of Object.entries(sets)) {
    if (!Array.isArray(programIds) || programIds.length === 0) {
      errors.push(`${checkId}:empty-program-set`);
      continue;
    }
    if (new Set(programIds).size !== programIds.length) {
      errors.push(`${checkId}:duplicate-program`);
    }
    for (const programId of programIds) {
      const suite = registrySuites.get(programId);
      if (!suite) errors.push(`${checkId}:missing-program:${programId}`);
      else if (suite.required !== true || suite.state !== 'ACTIVE') {
        errors.push(`${checkId}:program-not-required-active:${programId}`);
      }
    }
  }
  return deepFreeze({ valid: errors.length === 0, errors, programSets: sets });
}

function reportMatchesRunner(report, phase) {
  if (phase?.runner === 'nightly-audit') {
    const actualIds = Array.isArray(report?.options?.ids)
      ? [...report.options.ids].sort()
      : [];
    return report?.dryRun === false
      && report?.options?.concurrency === 1
      && JSON.stringify(actualIds) === JSON.stringify([...phase.programIds].sort());
  }
  const expectedAuthority = {
    'm6-owned-program': 'm6-owned-production-server-v1',
    'm6-runner-owned-server-programs': 'm6-runner-owned-server-programs-v1',
    'm6-fresh-clone': 'm6-fresh-clone-install-build-studio-v1',
  }[phase?.runner];
  return expectedAuthority !== undefined
    && report?.dryRun === false
    && report?.options?.acceptsArguments === false
    && report?.options?.concurrency === 1
    && report?.options?.authority === expectedAuthority;
}

function collectReports({ reports, plan, candidateSha, registryFingerprint, errors }) {
  const results = new Map();
  const phases = Array.isArray(plan?.phases) ? plan.phases : [];
  if ((reports || []).length !== phases.length) errors.push('reports:exact-phases');
  for (const [reportIndex, item] of (reports || []).entries()) {
    const phase = phases[reportIndex];
    const report = item?.report;
    const artifact = item?.artifact;
    if (item?.phaseId !== phase?.id) errors.push(`report[${reportIndex}]:phase`);
    if (item?.runner !== phase?.runner) errors.push(`report[${reportIndex}]:runner`);
    if (!validArtifact(artifact)) errors.push(`report[${reportIndex}]:artifact`);
    if (report?.manifestType !== 'intentsmith.audit-report' || report?.schemaVersion !== 1) {
      errors.push(`report[${reportIndex}]:contract`);
    }
    if (report?.sourceRevision !== candidateSha) errors.push(`report[${reportIndex}]:candidate`);
    if (report?.registryHash !== registryFingerprint) errors.push(`report[${reportIndex}]:registry`);
    if (!Array.isArray(report?.results)) {
      errors.push(`report[${reportIndex}]:results`);
      continue;
    }
    const expectedResultIds = [...(phase?.programIds || [])].sort();
    const reportResultIds = report.results.map(result => result?.id).sort();
    if (new Set(reportResultIds).size !== reportResultIds.length) {
      errors.push(`report[${reportIndex}]:duplicate-result`);
    }
    if (JSON.stringify(reportResultIds) !== JSON.stringify(expectedResultIds)) {
      errors.push(`report[${reportIndex}]:phase-programs`);
    }
    if (!reportMatchesRunner(report, phase)) errors.push(`report[${reportIndex}]:runner-authority`);
    const logEntries = Array.isArray(item?.logs) ? item.logs : [];
    const logsByProgram = new Map();
    for (const log of logEntries) {
      if (logsByProgram.has(log?.programId)) {
        errors.push(`report[${reportIndex}]:duplicate-log:${log?.programId}`);
      } else {
        logsByProgram.set(log?.programId, log?.bytes);
      }
    }
    const resultIds = report.results.map(result => result?.id).sort();
    const logIds = [...logsByProgram.keys()].sort();
    if (JSON.stringify(resultIds) !== JSON.stringify(logIds)) {
      errors.push(`report[${reportIndex}]:exact-log-programs`);
    }
    for (const result of report.results) {
      if (results.has(result?.id)) {
        errors.push(`report:duplicate-program:${result?.id}`);
      } else {
        const logBytes = logsByProgram.get(result?.id);
        const logValid = (typeof logBytes === 'string' || Buffer.isBuffer(logBytes))
          && createHash('sha256').update(logBytes).digest('hex') === result?.logSha256;
        if (!logValid) errors.push(`report[${reportIndex}]:log-sha:${result?.id}`);
        const runtimeValidation = M6_RUNTIME_EVIDENCE_PROGRAMS.includes(result?.id)
          ? validateM6RuntimeEvidence(result.id, logBytes, { candidateSha })
          : Object.freeze({ valid: true, errors: Object.freeze([]), receipt: null });
        if (!runtimeValidation.valid) {
          errors.push(...runtimeValidation.errors.map(error => `${result.id}:${error}`));
        }
        results.set(result?.id, { result, artifact, logValid, runtimeValidation });
      }
    }
  }
  return results;
}

function rowForPrograms(id, programIds, results, candidateSha) {
  const missing = programIds.filter(programId => !results.has(programId));
  const failed = programIds.filter(programId => (
    results.has(programId)
    && !passingResult(results.get(programId), candidateSha)
  ));
  const status = failed.length > 0 ? 'FAIL' : missing.length > 0 ? 'NOT_RUN' : 'PASS';
  const artifacts = [...new Map(
    programIds
      .filter(programId => results.has(programId))
      .map(programId => results.get(programId).artifact)
      .filter(validArtifact)
      .map(artifact => [`${artifact.path}:${artifact.sha256}`, artifact]),
  ).values()];
  return {
    id,
    status,
    reasonCode: status === 'PASS'
      ? null
      : status === 'FAIL'
        ? 'M6_TECHNICAL_PROGRAM_FAILED'
        : 'M6_TECHNICAL_PROGRAM_NOT_RUN',
    artifacts,
    programIds: [...programIds],
    missing,
    failed,
  };
}

function l0RowForPrograms(id, programIds, results, candidateSha) {
  const row = rowForPrograms(id, programIds, results, candidateSha);
  const authority = M6_L0_SEMANTIC_AUTHORITY[id];
  if (row.status !== 'PASS') return { ...row, semanticState: authority.state };
  if (authority.state === M6_L0_SEMANTIC_STATE.OPEN_VIOLATION) {
    return {
      ...row,
      status: 'FAIL',
      reasonCode: authority.reasonCode,
      semanticState: authority.state,
    };
  }
  if (authority.state !== M6_L0_SEMANTIC_STATE.VERIFIED) {
    return {
      ...row,
      status: 'NOT_RUN',
      reasonCode: authority.reasonCode,
      semanticState: authority.state,
    };
  }
  return { ...row, semanticState: authority.state };
}

function externalRow(id) {
  return {
    id,
    status: 'BLOCKED',
    reasonCode: `M6_${id.replaceAll('-', '_').toUpperCase()}_REQUIRES_EXTERNAL_AUTHORITY`,
    artifacts: [],
    programIds: [],
    missing: [],
    failed: [],
  };
}

export function evaluateM6TechnicalEvidence({
  candidateSha,
  registryFingerprint,
  registry,
  plan,
  reports,
} = {}) {
  const errors = [];
  if (!SHA_PATTERN.test(candidateSha || '')) errors.push('candidate:invalid');
  if (!SHA256_PATTERN.test(registryFingerprint || '')) errors.push('registry:invalid');
  if (!Array.isArray(reports) || reports.length === 0) errors.push('reports:required');
  const planValidation = validateM6CandidateExecutionPlan(plan, registry);
  errors.push(...planValidation.errors.map(error => `plan:${error}`));
  const map = validateM6TechnicalProgramMap(registry);
  errors.push(...map.errors);
  const results = collectReports({
    reports,
    plan,
    candidateSha,
    registryFingerprint,
    errors,
  });
  const requiredActiveIds = (registry?.suites || [])
    .filter(suite => suite.required === true && suite.state === 'ACTIVE')
    .map(suite => suite.id)
    .sort();
  const actualResultIds = [...results.keys()].sort();
  for (const programId of actualResultIds) {
    if (!requiredActiveIds.includes(programId)) {
      errors.push(`technical-results:unexpected:${programId}`);
    }
  }

  const technicalRows = Object.entries(map.programSets).map(([id, programIds]) => (
    rowForPrograms(id, programIds, results, candidateSha)
  ));
  const technicalById = new Map(technicalRows.map(row => [row.id, row]));
  const checks = M6_REQUIRED_CHECK_IDS.map(id => (
    M6_EXTERNAL_AUTHORITY_CHECKS.includes(id)
      ? externalRow(id)
      : technicalById.get(id)
  ));
  const l0 = M6_L0_IDS.map(id => l0RowForPrograms(
    id,
    M6_L0_EVIDENCE_PROGRAMS[id] || [],
    results,
    candidateSha,
  ));
  const conditionalSource = technicalById.get('conditional-surfaces');
  const conditionalJourneys = [{
    journeyId: 'M6-JOURNEY-MODEL-DISCOVERY-V1',
    status: conditionalSource.status,
    reasonCode: conditionalSource.reasonCode,
    artifacts: [...conditionalSource.artifacts],
    programIds: [...conditionalSource.programIds],
    missing: [...conditionalSource.missing],
    failed: [...conditionalSource.failed],
  }];
  const statusRows = [...checks, ...l0, ...conditionalJourneys];
  const verdict = errors.length > 0 || statusRows.some(row => row.status === 'FAIL')
    ? 'FAIL'
    : statusRows.some(row => row.status !== 'PASS')
      ? 'BLOCKED'
      : 'PASS';
  return deepFreeze({
    contract: M6_TECHNICAL_EVIDENCE_CONTRACT,
    version: M6_TECHNICAL_EVIDENCE_VERSION,
    valid: errors.length === 0,
    verdict,
    errors,
    checks,
    l0,
    conditionalJourneys,
  });
}

export function projectM6ReleaseEvidence({
  candidateSha,
  registryFingerprint,
  generatedAt,
  technicalEvidence,
} = {}) {
  if (
    technicalEvidence?.contract !== M6_TECHNICAL_EVIDENCE_CONTRACT
    || technicalEvidence?.version !== M6_TECHNICAL_EVIDENCE_VERSION
    || technicalEvidence?.valid !== true
  ) {
    throw new TypeError('m6-release:invalid-technical-evidence');
  }
  const projectRow = row => ({
    id: row.id,
    status: row.status,
    reasonCode: row.reasonCode,
    artifacts: [...row.artifacts],
  });
  return deepFreeze({
    contract: 'M6ReleaseEvidence',
    version: M6_RELEASE_EVIDENCE_VERSION,
    candidateSha,
    registryFingerprint,
    generatedAt,
    checks: technicalEvidence.checks.map(projectRow),
    l0: technicalEvidence.l0.map(projectRow),
    conditionalJourneys: technicalEvidence.conditionalJourneys.map(row => ({
      journeyId: row.journeyId,
      status: row.status,
      reasonCode: row.reasonCode,
      artifacts: [...row.artifacts],
    })),
  });
}
