import {
  M6_L0_EVIDENCE_CONTRACT,
  M6_L0_EVIDENCE_PROGRAMS,
  M6_L0_EVIDENCE_VERSION,
} from '../../contracts/m6/l0-evidence-v1.js';
import { M6_L0_IDS } from '../../contracts/m6/release-v1.js';

const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function validPassingResult(result, candidateSha) {
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

export function validateM6L0ProgramMap(registry) {
  const errors = [];
  const ids = Object.keys(M6_L0_EVIDENCE_PROGRAMS);
  if (JSON.stringify(ids.sort()) !== JSON.stringify([...M6_L0_IDS].sort())) {
    errors.push('l0-map:exact-ids');
  }
  const suites = new Map((registry?.suites || []).map(suite => [suite.id, suite]));
  for (const [l0Id, programIds] of Object.entries(M6_L0_EVIDENCE_PROGRAMS)) {
    if (!Array.isArray(programIds) || programIds.length === 0) {
      errors.push(`${l0Id}:empty-program-set`);
      continue;
    }
    if (new Set(programIds).size !== programIds.length) errors.push(`${l0Id}:duplicate-program`);
    for (const programId of programIds) {
      const suite = suites.get(programId);
      if (!suite) errors.push(`${l0Id}:missing-program:${programId}`);
      else if (suite.required !== true || suite.state !== 'ACTIVE') {
        errors.push(`${l0Id}:program-not-required-active:${programId}`);
      }
    }
  }
  return freeze({ valid: errors.length === 0, errors });
}

export function evaluateM6L0Evidence({
  candidateSha,
  registryFingerprint,
  registry,
  reports,
} = {}) {
  const errors = [];
  if (!SHA_PATTERN.test(candidateSha || '')) errors.push('candidate:invalid');
  if (!SHA256_PATTERN.test(registryFingerprint || '')) errors.push('registry:invalid');
  const mapValidation = validateM6L0ProgramMap(registry);
  errors.push(...mapValidation.errors);
  if (!Array.isArray(reports) || reports.length === 0) errors.push('reports:required');

  const results = new Map();
  for (const [reportIndex, report] of (reports || []).entries()) {
    if (report?.sourceRevision !== candidateSha) errors.push(`report[${reportIndex}]:candidate`);
    if (report?.registryHash !== registryFingerprint) errors.push(`report[${reportIndex}]:registry`);
    if (!Array.isArray(report?.results)) {
      errors.push(`report[${reportIndex}]:results`);
      continue;
    }
    for (const result of report.results) {
      if (results.has(result?.id)) errors.push(`report:duplicate-program:${result?.id}`);
      else results.set(result?.id, result);
    }
  }

  const rows = M6_L0_IDS.map(id => {
    const programIds = M6_L0_EVIDENCE_PROGRAMS[id] || [];
    const missing = programIds.filter(programId => !results.has(programId));
    const failed = programIds.filter(programId => (
      results.has(programId) && !validPassingResult(results.get(programId), candidateSha)
    ));
    const status = failed.length > 0 ? 'FAIL' : missing.length > 0 ? 'NOT_RUN' : 'PASS';
    return {
      id,
      status,
      reasonCode: status === 'PASS'
        ? null
        : status === 'FAIL'
          ? 'M6_L0_PROGRAM_FAILED'
          : 'M6_L0_PROGRAM_NOT_RUN',
      programIds: [...programIds],
      missing,
      failed,
    };
  });
  const verdict = errors.length > 0 || rows.some(row => row.status === 'FAIL')
    ? 'FAIL'
    : rows.some(row => row.status !== 'PASS')
      ? 'BLOCKED'
      : 'PASS';
  return freeze({
    contract: M6_L0_EVIDENCE_CONTRACT,
    version: M6_L0_EVIDENCE_VERSION,
    valid: errors.length === 0,
    verdict,
    errors,
    rows,
  });
}
