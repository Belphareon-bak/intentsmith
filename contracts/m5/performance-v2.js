import {
  isPlainRecord,
  validateExactKeys,
  validationResult,
} from '../m1/shared.js';

export const M5_PERFORMANCE_EVIDENCE_CONTRACT = 'M5PerformanceEvidence';
export const M5_PERFORMANCE_EVIDENCE_VERSION = 2;
export const M5_PERFORMANCE_RAW_ARTIFACT_CONTRACT = 'M5PerformanceRawArtifact';
export const M5_PERFORMANCE_RAW_ARTIFACT_VERSION = 1;

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SURFACE_PATTERN = /^[a-z][a-z0-9.-]{0,63}$/;

function validNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateDistribution(value, index) {
  const context = `m5-performance-evidence.measurements[${index}]`;
  const errors = validateExactKeys(value, [
    'surface',
    'sampleCount',
    'errorCount',
    'latenciesMs',
    'durationMs',
    'operations',
    'rss',
  ], [], context);
  if (!isPlainRecord(value)) return errors;
  if (!SURFACE_PATTERN.test(value.surface ?? '')) errors.push(`${context}:invalid-surface`);
  if (!Number.isSafeInteger(value.sampleCount) || value.sampleCount < 1) {
    errors.push(`${context}:invalid-sampleCount`);
  }
  if (!validNonNegativeInteger(value.errorCount) || value.errorCount > value.sampleCount) {
    errors.push(`${context}:invalid-errorCount`);
  }
  if (
    !Array.isArray(value.latenciesMs)
    || value.latenciesMs.length !== value.sampleCount
    || value.latenciesMs.some(item => !Number.isFinite(item) || item < 0)
  ) errors.push(`${context}:invalid-latenciesMs`);
  if (!validNonNegativeInteger(value.durationMs)) errors.push(`${context}:invalid-durationMs`);
  if (!validNonNegativeInteger(value.operations)) errors.push(`${context}:invalid-operations`);
  const rssContext = `${context}.rss`;
  errors.push(...validateExactKeys(value.rss, ['startMiB', 'peakMiB', 'endMiB'], [], rssContext));
  if (isPlainRecord(value.rss)) {
    for (const key of ['startMiB', 'peakMiB', 'endMiB']) {
      if (!Number.isFinite(value.rss[key]) || value.rss[key] < 0) {
        errors.push(`${rssContext}:invalid-${key}`);
      }
    }
    if (
      Number.isFinite(value.rss.peakMiB)
      && Number.isFinite(value.rss.startMiB)
      && Number.isFinite(value.rss.endMiB)
      && value.rss.peakMiB < Math.max(value.rss.startMiB, value.rss.endMiB)
    ) errors.push(`${rssContext}:peak-below-observation`);
  }
  return errors;
}

function validateArtifactDescriptor(value) {
  const context = 'm5-performance-evidence.measurementArtifact';
  const errors = validateExactKeys(value, [
    'path',
    'sha256',
    'byteLength',
  ], [], context);
  if (!isPlainRecord(value)) return errors;
  if (
    typeof value.path !== 'string'
    || !value.path.startsWith('.intentsmith-artifacts/')
    || value.path.includes('..')
    || value.path.includes('\\')
    || !value.path.endsWith('.raw.json')
  ) errors.push(`${context}:invalid-path`);
  if (!SHA256_PATTERN.test(value.sha256 ?? '')) errors.push(`${context}:invalid-sha256`);
  if (!Number.isSafeInteger(value.byteLength) || value.byteLength < 1) {
    errors.push(`${context}:invalid-byteLength`);
  }
  return errors;
}

function validatePinnedBaseline(value, index) {
  const context = `m5-performance-evidence.pinnedBaselines[${index}]`;
  const errors = validateExactKeys(value, [
    'surface',
    'sourceRevision',
    'sourcePath',
    'sourceBlobOid',
    'sourceSha256',
  ], [], context);
  if (!isPlainRecord(value)) return errors;
  if (!SURFACE_PATTERN.test(value.surface ?? '')) errors.push(`${context}:invalid-surface`);
  if (!SHA_PATTERN.test(value.sourceRevision ?? '')) errors.push(`${context}:invalid-sourceRevision`);
  if (
    typeof value.sourcePath !== 'string'
    || !value.sourcePath.startsWith('docs/')
    || value.sourcePath.includes('..')
  ) errors.push(`${context}:invalid-sourcePath`);
  if (!SHA_PATTERN.test(value.sourceBlobOid ?? '')) errors.push(`${context}:invalid-sourceBlobOid`);
  if (!SHA256_PATTERN.test(value.sourceSha256 ?? '')) errors.push(`${context}:invalid-sourceSha256`);
  return errors;
}

function validateCandidateIdentity(value, context, errors) {
  if (!SHA_PATTERN.test(value.candidateRevision ?? '')) {
    errors.push(`${context}:invalid-candidateRevision`);
  }
  if (!SHA_PATTERN.test(value.candidateTree ?? '')) {
    errors.push(`${context}:invalid-candidateTree`);
  }
}

function validateHost(value, context, errors) {
  errors.push(...validateExactKeys(value, ['platform', 'arch', 'node'], [], context));
  if (!isPlainRecord(value)) return;
  for (const key of ['platform', 'arch', 'node']) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      errors.push(`${context}:invalid-${key}`);
    }
  }
}

export function validateM5PerformanceRawArtifactV1(value) {
  const context = 'm5-performance-raw-artifact';
  const errors = validateExactKeys(value, [
    'contract',
    'version',
    'candidateRevision',
    'candidateTree',
    'measuredAtIso',
    'host',
    'measurements',
  ], [], context);
  if (!isPlainRecord(value)) return validationResult(errors, value);
  if (value.contract !== M5_PERFORMANCE_RAW_ARTIFACT_CONTRACT) {
    errors.push(`${context}:invalid-contract`);
  }
  if (value.version !== M5_PERFORMANCE_RAW_ARTIFACT_VERSION) {
    errors.push(`${context}:invalid-version`);
  }
  validateCandidateIdentity(value, context, errors);
  if (
    typeof value.measuredAtIso !== 'string'
    || Number.isNaN(Date.parse(value.measuredAtIso))
  ) errors.push(`${context}:invalid-measuredAtIso`);
  validateHost(value.host, `${context}.host`, errors);
  if (!Array.isArray(value.measurements) || value.measurements.length === 0) {
    errors.push(`${context}:invalid-measurements`);
  } else {
    value.measurements.forEach((item, index) => errors.push(...validateDistribution(item, index)));
  }
  const surfaces = Array.isArray(value.measurements)
    ? value.measurements.map(item => item?.surface)
    : [];
  if (new Set(surfaces).size !== surfaces.length) errors.push(`${context}:duplicate-surface`);
  return validationResult(errors, value);
}

export function validateM5PerformanceEvidenceV2(value) {
  const context = 'm5-performance-evidence';
  const errors = validateExactKeys(value, [
    'contract',
    'version',
    'candidateRevision',
    'candidateTree',
    'measuredAtIso',
    'host',
    'measurementArtifact',
    'pinnedBaselines',
    'gpuDisposition',
  ], [], context);
  if (!isPlainRecord(value)) return validationResult(errors, value);
  if (value.contract !== M5_PERFORMANCE_EVIDENCE_CONTRACT) {
    errors.push(`${context}:invalid-contract`);
  }
  if (value.version !== M5_PERFORMANCE_EVIDENCE_VERSION) {
    errors.push(`${context}:invalid-version`);
  }
  validateCandidateIdentity(value, context, errors);
  if (
    typeof value.measuredAtIso !== 'string'
    || Number.isNaN(Date.parse(value.measuredAtIso))
  ) errors.push(`${context}:invalid-measuredAtIso`);
  validateHost(value.host, `${context}.host`, errors);
  errors.push(...validateArtifactDescriptor(value.measurementArtifact));
  if (!Array.isArray(value.pinnedBaselines) || value.pinnedBaselines.length === 0) {
    errors.push(`${context}:invalid-pinnedBaselines`);
  } else {
    value.pinnedBaselines.forEach((item, index) => errors.push(...validatePinnedBaseline(item, index)));
  }
  errors.push(...validateExactKeys(
    value.gpuDisposition,
    ['currentMeasurement', 'reason', 'pinnedSurface'],
    [],
    `${context}.gpuDisposition`,
  ));
  if (isPlainRecord(value.gpuDisposition)) {
    if (!['not_run_foreign_activity', 'measured'].includes(value.gpuDisposition.currentMeasurement)) {
      errors.push(`${context}.gpuDisposition:invalid-currentMeasurement`);
    }
    if (typeof value.gpuDisposition.reason !== 'string' || value.gpuDisposition.reason.length === 0) {
      errors.push(`${context}.gpuDisposition:invalid-reason`);
    }
    if (!SURFACE_PATTERN.test(value.gpuDisposition.pinnedSurface ?? '')) {
      errors.push(`${context}.gpuDisposition:invalid-pinnedSurface`);
    }
  }
  const surfaces = [
    ...(Array.isArray(value.pinnedBaselines) ? value.pinnedBaselines.map(item => item?.surface) : []),
  ];
  if (new Set(surfaces).size !== surfaces.length) errors.push(`${context}:duplicate-surface`);
  return validationResult(errors, value);
}
