import {
  isPlainRecord,
  validateExactKeys,
  validationResult,
} from '../m1/shared.js';

export const M5_PERFORMANCE_EVIDENCE_CONTRACT = 'M5PerformanceEvidence';
export const M5_PERFORMANCE_EVIDENCE_VERSION = 1;

const SHA_PATTERN = /^[0-9a-f]{40}$/;
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

function validatePinnedBaseline(value, index) {
  const context = `m5-performance-evidence.pinnedBaselines[${index}]`;
  const errors = validateExactKeys(value, [
    'surface',
    'sourceRevision',
    'sourcePath',
    'metrics',
  ], [], context);
  if (!isPlainRecord(value)) return errors;
  if (!SURFACE_PATTERN.test(value.surface ?? '')) errors.push(`${context}:invalid-surface`);
  if (!SHA_PATTERN.test(value.sourceRevision ?? '')) errors.push(`${context}:invalid-sourceRevision`);
  if (
    typeof value.sourcePath !== 'string'
    || !value.sourcePath.startsWith('docs/')
    || value.sourcePath.includes('..')
  ) errors.push(`${context}:invalid-sourcePath`);
  if (
    !isPlainRecord(value.metrics)
    || Object.keys(value.metrics).length === 0
    || Object.values(value.metrics).some(metric => !Number.isFinite(metric) || metric < 0)
  ) errors.push(`${context}:invalid-metrics`);
  return errors;
}

export function validateM5PerformanceEvidenceV1(value) {
  const context = 'm5-performance-evidence';
  const errors = validateExactKeys(value, [
    'contract',
    'version',
    'candidateRevision',
    'measuredAtIso',
    'host',
    'measurements',
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
  if (!SHA_PATTERN.test(value.candidateRevision ?? '')) {
    errors.push(`${context}:invalid-candidateRevision`);
  }
  if (
    typeof value.measuredAtIso !== 'string'
    || Number.isNaN(Date.parse(value.measuredAtIso))
  ) errors.push(`${context}:invalid-measuredAtIso`);
  errors.push(...validateExactKeys(value.host, ['platform', 'arch', 'node'], [], `${context}.host`));
  if (!Array.isArray(value.measurements) || value.measurements.length === 0) {
    errors.push(`${context}:invalid-measurements`);
  } else {
    value.measurements.forEach((item, index) => errors.push(...validateDistribution(item, index)));
  }
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
    ...(Array.isArray(value.measurements) ? value.measurements.map(item => item?.surface) : []),
    ...(Array.isArray(value.pinnedBaselines) ? value.pinnedBaselines.map(item => item?.surface) : []),
  ];
  if (new Set(surfaces).size !== surfaces.length) errors.push(`${context}:duplicate-surface`);
  return validationResult(errors, value);
}
