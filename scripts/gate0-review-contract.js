import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export const GATE0_REVIEW_RESULT_PATH =
  'docs/convergence/reviews/GATE0-OPUS-RESULT.json';
export const GATE0_REVIEW_PACKET_PATH =
  'docs/convergence/reviews/GATE0-OPUS-REVIEW.md';
export const GATE0_REVIEW_RESULT_SCHEMA_VERSION = 1;
export const GATE0_REGISTRY_FINGERPRINT_ALGORITHM =
  'sha256-json-stringify-v1';
export const GATE0_REVIEWER_ROLE = 'Opus 5';
export const GATE0_REVIEW_METHOD = 'independent-read-only';

const REVIEW_DECISION = 'APPROVED';
const REVIEW_SEVERITIES = new Set([
  'BLOCKER',
  'HIGH',
  'MEDIUM',
  'LOW',
  'INFO',
]);
const RESULT_KEYS = Object.freeze([
  'schemaVersion',
  'gate',
  'candidateSha',
  'pendingAttestationSha',
  'registryFingerprintAlgorithm',
  'registryFingerprint',
  'reviewRange',
  'packetPath',
  'packetSha256',
  'reviewRequiredRisks',
  'reviewerRole',
  'reviewMethod',
  'completedAt',
  'decision',
  'findings',
]);
const FINDING_KEYS = Object.freeze([
  'id',
  'severity',
  'blocking',
  'summary',
]);

export function validateGate0ReviewResult(result, expected) {
  const errors = [];
  const expectedShape = validateExpectedReviewBinding(expected);
  errors.push(...expectedShape.errors);

  if (!hasExactKeys(result, RESULT_KEYS)) {
    errors.push('review result fields differ from the locked schema');
    return report(errors);
  }

  if (result.schemaVersion !== GATE0_REVIEW_RESULT_SCHEMA_VERSION) {
    errors.push(
      `review result schemaVersion must equal ${GATE0_REVIEW_RESULT_SCHEMA_VERSION}`,
    );
  }
  if (result.gate !== 'Gate 0') {
    errors.push('review result gate must equal Gate 0');
  }
  if (!isFullSha1(result.candidateSha)) {
    errors.push('review result candidateSha must be a full lowercase SHA-1');
  }
  if (!isFullSha1(result.pendingAttestationSha)) {
    errors.push(
      'review result pendingAttestationSha must be a full lowercase SHA-1',
    );
  }
  if (
    result.registryFingerprintAlgorithm
    !== GATE0_REGISTRY_FINGERPRINT_ALGORITHM
  ) {
    errors.push('review result registry fingerprint algorithm is unsupported');
  }
  if (!isSha256(result.registryFingerprint)) {
    errors.push('review result registryFingerprint must be a SHA-256 digest');
  }
  if (
    typeof result.reviewRange !== 'string'
    || !result.reviewRange.endsWith(`..${result.candidateSha}`)
  ) {
    errors.push('review result range must end at the exact candidate SHA');
  }
  if (result.packetPath !== GATE0_REVIEW_PACKET_PATH) {
    errors.push('review result packet path is unsupported');
  }
  if (!isSha256(result.packetSha256)) {
    errors.push('review result packetSha256 must be a SHA-256 digest');
  }
  if (!validSortedUniqueStrings(result.reviewRequiredRisks)) {
    errors.push(
      'review result reviewRequiredRisks must be a sorted unique string array',
    );
  }
  if (result.reviewerRole !== GATE0_REVIEWER_ROLE) {
    errors.push(`reviewerRole must equal ${GATE0_REVIEWER_ROLE}`);
  }
  if (result.reviewMethod !== GATE0_REVIEW_METHOD) {
    errors.push(`reviewMethod must equal ${GATE0_REVIEW_METHOD}`);
  }
  if (!validIsoTimestamp(result.completedAt)) {
    errors.push('review result completedAt must be an exact ISO timestamp');
  }
  if (result.decision !== REVIEW_DECISION) {
    errors.push(`review result decision must equal ${REVIEW_DECISION}`);
  }

  if (!Array.isArray(result.findings) || result.findings.length > 100) {
    errors.push('review result findings must be an array of at most 100 rows');
  } else {
    const findingIds = new Set();
    for (const [index, finding] of result.findings.entries()) {
      const label = `review result findings[${index}]`;
      if (!hasExactKeys(finding, FINDING_KEYS)) {
        errors.push(`${label} fields differ from the locked schema`);
        continue;
      }
      if (!/^G0-REV-\d{3}$/.test(finding.id || '')) {
        errors.push(`${label}.id is invalid`);
      } else if (findingIds.has(finding.id)) {
        errors.push(`${label}.id is duplicated`);
      } else {
        findingIds.add(finding.id);
      }
      if (!REVIEW_SEVERITIES.has(finding.severity)) {
        errors.push(`${label}.severity is unsupported`);
      }
      if (typeof finding.blocking !== 'boolean') {
        errors.push(`${label}.blocking must be boolean`);
      } else if (finding.blocking) {
        errors.push('an APPROVED review result cannot contain a blocking finding');
      }
      if (!validBoundedText(finding.summary, 1, 1000)) {
        errors.push(`${label}.summary must contain 1..1000 safe characters`);
      }
    }
  }

  if (expectedShape.valid) {
    for (const [label, actual, required] of [
      ['candidate SHA', result.candidateSha, expected.candidateSha],
      [
        'pending attestation SHA',
        result.pendingAttestationSha,
        expected.pendingAttestationSha,
      ],
      [
        'registry fingerprint',
        result.registryFingerprint,
        expected.registryFingerprint,
      ],
      ['review range', result.reviewRange, expected.reviewRange],
      ['packet SHA-256', result.packetSha256, expected.packetSha256],
    ]) {
      if (actual !== required) {
        errors.push(`review result ${label} differs from pending evidence`);
      }
    }
    if (
      !isDeepStrictEqual(
        result.reviewRequiredRisks,
        expected.reviewRequiredRisks,
      )
    ) {
      errors.push(
        'review result required-risk set differs from pending evidence',
      );
    }
  }

  return report(errors);
}

export function parseGate0ReviewResult(bytes, expected) {
  const contents = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || '');
  let result;
  try {
    result = JSON.parse(contents.toString('utf8'));
  } catch {
    return {
      ...report(['review result is not valid JSON']),
      result: null,
      bytes: contents.length,
      sha256: sha256(contents),
    };
  }
  return {
    ...validateGate0ReviewResult(result, expected),
    result,
    bytes: contents.length,
    sha256: sha256(contents),
  };
}

function validateExpectedReviewBinding(expected) {
  const errors = [];
  if (!hasExactKeys(expected, [
    'candidateSha',
    'pendingAttestationSha',
    'registryFingerprint',
    'reviewRange',
    'packetSha256',
    'reviewRequiredRisks',
  ])) {
    return report(['expected review binding fields differ from the contract']);
  }
  if (!isFullSha1(expected.candidateSha)) {
    errors.push('expected candidate SHA is invalid');
  }
  if (!isFullSha1(expected.pendingAttestationSha)) {
    errors.push('expected pending attestation SHA is invalid');
  }
  if (!isSha256(expected.registryFingerprint)) {
    errors.push('expected registry fingerprint is invalid');
  }
  if (
    typeof expected.reviewRange !== 'string'
    || !expected.reviewRange.endsWith(`..${expected.candidateSha}`)
  ) {
    errors.push('expected review range is invalid');
  }
  if (!isSha256(expected.packetSha256)) {
    errors.push('expected review packet digest is invalid');
  }
  if (!validSortedUniqueStrings(expected.reviewRequiredRisks)) {
    errors.push('expected review-required risk set is invalid');
  }
  return report(errors);
}

function report(errors) {
  return {
    schemaVersion: GATE0_REVIEW_RESULT_SCHEMA_VERSION,
    valid: errors.length === 0,
    approved: errors.length === 0,
    errors,
  };
}

function validSortedUniqueStrings(value) {
  return Array.isArray(value)
    && value.every(item => validBoundedText(item, 1, 256))
    && isDeepStrictEqual(value, [...new Set(value)].sort());
}

function validBoundedText(value, minimum, maximum) {
  return typeof value === 'string'
    && value.length >= minimum
    && value.length <= maximum
    && value.trim() === value
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}

function validIsoTimestamp(value) {
  return typeof value === 'string'
    && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function hasExactKeys(value, expectedKeys) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && isDeepStrictEqual(Object.keys(value).sort(), [...expectedKeys].sort());
}

function isFullSha1(value) {
  return /^[a-f0-9]{40}$/.test(value || '');
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/.test(value || '');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
