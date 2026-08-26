import {
  M6_DYNAMIC_TECHNICAL_CHECKS,
  M6_EXTERNAL_AUTHORITY_CHECKS,
  M6_TECHNICAL_EVIDENCE_CONTRACT,
  M6_TECHNICAL_EVIDENCE_VERSION,
  M6_TECHNICAL_PROGRAMS,
} from '../../contracts/m6/technical-evidence-v1.js';
import {
  M6_L0_EVIDENCE_PROGRAMS,
} from '../../contracts/m6/l0-evidence-v1.js';
import {
  M6_L0_IDS,
  M6_REQUIRED_CHECK_IDS,
} from '../../contracts/m6/release-v1.js';

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

function passingResult(result, candidateSha) {
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
    && SHA256_PATTERN.test(result.logSha256 || '');
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

function collectReports({ reports, candidateSha, registryFingerprint, errors }) {
  const results = new Map();
  for (const [reportIndex, item] of (reports || []).entries()) {
    const report = item?.report;
    const artifact = item?.artifact;
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
    for (const result of report.results) {
      if (results.has(result?.id)) {
        errors.push(`report:duplicate-program:${result?.id}`);
      } else {
        results.set(result?.id, { result, artifact });
      }
    }
  }
  return results;
}

function rowForPrograms(id, programIds, results, candidateSha) {
  const missing = programIds.filter(programId => !results.has(programId));
  const failed = programIds.filter(programId => (
    results.has(programId)
    && !passingResult(results.get(programId).result, candidateSha)
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
  reports,
} = {}) {
  const errors = [];
  if (!SHA_PATTERN.test(candidateSha || '')) errors.push('candidate:invalid');
  if (!SHA256_PATTERN.test(registryFingerprint || '')) errors.push('registry:invalid');
  if (!Array.isArray(reports) || reports.length === 0) errors.push('reports:required');
  const map = validateM6TechnicalProgramMap(registry);
  errors.push(...map.errors);
  const results = collectReports({ reports, candidateSha, registryFingerprint, errors });

  const technicalRows = Object.entries(map.programSets).map(([id, programIds]) => (
    rowForPrograms(id, programIds, results, candidateSha)
  ));
  const technicalById = new Map(technicalRows.map(row => [row.id, row]));
  const checks = M6_REQUIRED_CHECK_IDS.map(id => (
    M6_EXTERNAL_AUTHORITY_CHECKS.includes(id)
      ? externalRow(id)
      : technicalById.get(id)
  ));
  const l0 = M6_L0_IDS.map(id => rowForPrograms(
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
    version: 1,
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

