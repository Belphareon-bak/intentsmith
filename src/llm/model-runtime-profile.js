// Approved M1 runtime ceiling for the reference local model.
//
// This artifact deliberately does not contain model-weight or KV-cache
// estimates.  Those values do not yet have one measured runtime owner and
// cannot authorize a physical VRAM FIT/NONFIT claim.  The profile binds the
// six dimensions approved by decision 009; the T3 pilot measures the GPU-only
// dimensions while production consumes the context ceiling.

const PROFILE_KEYS = Object.freeze([
  'contextWindowTokens',
  'digestSha256',
  'fallbackPolicy',
  'minimumGpuResidencyPercent',
  'minimumHeadroomMiB',
  'model',
  'schemaVersion',
]);
const DRIFT_KEYS = Object.freeze(PROFILE_KEYS.filter(key => key !== 'schemaVersion'));

const MODEL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value) {
  const actual = Object.keys(value).sort();
  return actual.length === PROFILE_KEYS.length
    && actual.every((key, index) => key === PROFILE_KEYS[index]);
}

/**
 * Validate a candidate profile without mutating or normalizing it.
 *
 * @param {unknown} value
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateModelRuntimeProfile(value) {
  const errors = [];
  if (!isPlainRecord(value)) {
    return { valid: false, errors: ['profile:not-plain-record'] };
  }
  if (!exactKeys(value)) errors.push('profile:keys');
  if (value.schemaVersion !== 1) errors.push('schemaVersion');
  if (typeof value.model !== 'string' || !MODEL_NAME_PATTERN.test(value.model)) {
    errors.push('model');
  }
  if (typeof value.digestSha256 !== 'string' || !DIGEST_PATTERN.test(value.digestSha256)) {
    errors.push('digestSha256');
  }
  if (
    !Number.isSafeInteger(value.contextWindowTokens)
    || value.contextWindowTokens < 512
    || value.contextWindowTokens > 262144
  ) {
    errors.push('contextWindowTokens');
  }
  if (!Number.isSafeInteger(value.minimumHeadroomMiB) || value.minimumHeadroomMiB < 0) {
    errors.push('minimumHeadroomMiB');
  }
  if (
    !Number.isFinite(value.minimumGpuResidencyPercent)
    || value.minimumGpuResidencyPercent <= 0
    || value.minimumGpuResidencyPercent > 100
  ) {
    errors.push('minimumGpuResidencyPercent');
  }
  if (value.fallbackPolicy !== 'forbid') errors.push('fallbackPolicy');
  return { valid: errors.length === 0, errors };
}

const approvedProfile = {
  schemaVersion: 1,
  model: 'qwen3.5:27b',
  digestSha256: '7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e',
  contextWindowTokens: 4096,
  minimumHeadroomMiB: 1024,
  minimumGpuResidencyPercent: 100,
  fallbackPolicy: 'forbid',
};

const approvedValidation = validateModelRuntimeProfile(approvedProfile);
if (!approvedValidation.valid) {
  throw new Error(`Invalid committed model runtime profile: ${approvedValidation.errors.join(',')}`);
}

export const MODEL_RUNTIME_PROFILE = Object.freeze({ ...approvedProfile });

/** Reject any change to the six operator-approved runtime dimensions. */
export function validateApprovedModelRuntimeProfile(value) {
  const validation = validateModelRuntimeProfile(value);
  const errors = [...validation.errors];
  if (isPlainRecord(value)) {
    for (const key of DRIFT_KEYS) {
      if (value[key] !== MODEL_RUNTIME_PROFILE[key]) errors.push(`drift:${key}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

/** Return the profile only for its exact, case-normalized model identity. */
export function getModelRuntimeProfile(modelName) {
  if (typeof modelName !== 'string') return null;
  return modelName.trim().toLowerCase() === MODEL_RUNTIME_PROFILE.model.toLowerCase()
    ? MODEL_RUNTIME_PROFILE
    : null;
}

/** Cap one already validated context value by the committed model ceiling. */
export function capModelContextWindow(modelName, contextWindowTokens) {
  if (
    !Number.isSafeInteger(contextWindowTokens)
    || contextWindowTokens < 512
    || contextWindowTokens > 262144
  ) {
    return null;
  }
  const profile = getModelRuntimeProfile(modelName);
  return profile
    ? Math.min(contextWindowTokens, profile.contextWindowTokens)
    : contextWindowTokens;
}

export const MODEL_RUNTIME_PROFILE_KEYS = PROFILE_KEYS;
export const MODEL_RUNTIME_PROFILE_DRIFT_KEYS = DRIFT_KEYS;
