import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  deriveGateOutcome,
  ReviewStatus,
} from './gate0-evidence-verdict.js';
import {
  GATE0_APPROVED_ATTESTATION_RULE,
  GATE0_PENDING_ATTESTATION_RULE,
  GATE0_REVIEW_METHOD,
  GATE0_REVIEW_PACKET_PATH,
  GATE0_REVIEW_RESULT_PATH,
  GATE0_REVIEWER_ROLE,
  parseGate0ReviewResult,
} from './gate0-review-contract.js';
import {
  GATE0_BOUND_OUTPUTS,
} from './gate0-attestation-paths.js';

export const GATE0_PROMOTION_SCHEMA_VERSION = 1;

export function buildApprovedGate0Promotion({
  pendingAttestationSha,
  reviewResultSha,
  pendingIndex,
  pendingArtifacts,
  reviewResultBytes,
}) {
  const errors = [];
  if (
    !isFullSha1(pendingAttestationSha)
    || !isFullSha1(reviewResultSha)
    || pendingAttestationSha === reviewResultSha
  ) {
    errors.push('promotion commit identities are invalid');
  }
  if (
    pendingIndex?.schemaVersion !== 7
    || pendingIndex?.verdict !== 'CONDITIONAL PASS'
    || pendingIndex?.exitCode !== 0
    || pendingIndex?.review?.independentReviewStatus !== ReviewStatus.PENDING
    || pendingIndex?.candidate?.attestationRule
      !== GATE0_PENDING_ATTESTATION_RULE
    || !isFullSha1(pendingIndex?.candidate?.sha)
  ) {
    errors.push('promotion requires a green schema-7 PENDING attestation');
  }
  if (pendingIndex?.review?.packet !== GATE0_REVIEW_PACKET_PATH) {
    errors.push('promotion pending review packet path is invalid');
  }

  const artifactPaths = Object.keys(pendingArtifacts || {}).sort();
  if (!isDeepStrictEqual(artifactPaths, [...GATE0_BOUND_OUTPUTS].sort())) {
    errors.push('promotion requires exactly the three pending Markdown artifacts');
  }
  if (
    !isDeepStrictEqual(
      Object.keys(pendingIndex?.generatedOutputs || {}).sort(),
      [...GATE0_BOUND_OUTPUTS].sort(),
    )
  ) {
    errors.push('promotion pending output bindings are incomplete');
  }
  const normalizedArtifacts = {};
  for (const filePath of GATE0_BOUND_OUTPUTS) {
    const bytes = toBuffer(pendingArtifacts?.[filePath]);
    const binding = pendingIndex?.generatedOutputs?.[filePath];
    if (
      bytes === null
      || !hasExactKeys(binding, ['bytes', 'sha256'])
      || binding.bytes !== bytes?.length
      || binding.sha256 !== sha256(bytes || Buffer.alloc(0))
    ) {
      errors.push(`pending artifact binding mismatch for ${filePath}`);
    } else {
      normalizedArtifacts[filePath] = bytes;
    }
  }

  const packetBytes = normalizedArtifacts[GATE0_REVIEW_PACKET_PATH] || null;
  const parsedReview = parseGate0ReviewResult(reviewResultBytes, {
    candidateSha: pendingIndex?.candidate?.sha,
    pendingAttestationSha,
    registryFingerprint: pendingIndex?.candidate?.registrySha256,
    reviewRange: pendingIndex?.review?.range,
    packetSha256: packetBytes === null ? null : sha256(packetBytes),
    reviewRequiredRisks: pendingIndex?.riskPolicy?.reviewRequiredRisks,
  });
  if (!parsedReview.valid) {
    errors.push(...parsedReview.errors.map(error => `review result: ${error}`));
  }

  let outcome = null;
  try {
    outcome = deriveGateOutcome({
      clauses: pendingIndex?.clauses,
      repositoryBlockers: pendingIndex?.repositoryBlockers,
      reviewRequiredRisks: pendingIndex?.riskPolicy?.reviewRequiredRisks,
      reviewStatus: ReviewStatus.APPROVED,
    });
  } catch (error) {
    errors.push(`promotion outcome is invalid: ${error.message}`);
  }
  if (outcome?.verdict !== 'PASS' || outcome?.exitCode !== 0) {
    errors.push('approved review cannot promote a failing Gate 0 candidate');
  }

  if (errors.length > 0) {
    return {
      schemaVersion: GATE0_PROMOTION_SCHEMA_VERSION,
      valid: false,
      errors,
      evidenceIndex: null,
      outputArtifacts: null,
      parsedReview,
    };
  }

  const reviewResult = parsedReview.result;
  const reviewBinding = {
    path: GATE0_REVIEW_RESULT_PATH,
    commitSha: reviewResultSha,
    pendingAttestationSha,
    schemaVersion: reviewResult.schemaVersion,
    bytes: parsedReview.bytes,
    sha256: parsedReview.sha256,
    decision: reviewResult.decision,
    reviewerRole: reviewResult.reviewerRole,
    reviewMethod: reviewResult.reviewMethod,
    completedAt: reviewResult.completedAt,
    findingCount: reviewResult.findings.length,
  };
  const outputArtifacts = Object.fromEntries(
    GATE0_BOUND_OUTPUTS.map(filePath => [
      filePath,
      renderApprovedGate0Artifact({
        filePath,
        pendingBytes: normalizedArtifacts[filePath],
        candidateSha: pendingIndex.candidate.sha,
        pendingAttestationSha,
        reviewResultSha,
        reviewResultSha256: parsedReview.sha256,
        reviewResult,
      }),
    ]),
  );
  const evidenceIndex = JSON.parse(JSON.stringify(pendingIndex));
  evidenceIndex.schemaVersion = 8;
  evidenceIndex.verdict = outcome.verdict;
  evidenceIndex.exitCode = outcome.exitCode;
  evidenceIndex.candidate.attestationRule =
    GATE0_APPROVED_ATTESTATION_RULE;
  evidenceIndex.review = {
    range: pendingIndex.review.range,
    commitCount: pendingIndex.review.commitCount,
    packet: pendingIndex.review.packet,
    independentReviewStatus: ReviewStatus.APPROVED,
    result: reviewBinding,
  };
  evidenceIndex.generatedOutputs = Object.fromEntries(
    Object.entries(outputArtifacts).map(([filePath, bytes]) => [
      filePath,
      {
        bytes: bytes.length,
        sha256: sha256(bytes),
      },
    ]),
  );

  return {
    schemaVersion: GATE0_PROMOTION_SCHEMA_VERSION,
    valid: true,
    errors: [],
    evidenceIndex,
    outputArtifacts,
    parsedReview,
  };
}

export function renderApprovedGate0Artifact({
  filePath,
  pendingBytes,
  candidateSha,
  pendingAttestationSha,
  reviewResultSha,
  reviewResultSha256,
  reviewResult,
}) {
  const original = toBuffer(pendingBytes);
  if (
    !GATE0_BOUND_OUTPUTS.includes(filePath)
    || original === null
    || !isFullSha1(candidateSha)
    || !isFullSha1(pendingAttestationSha)
    || !isFullSha1(reviewResultSha)
    || !isSha256(reviewResultSha256)
    || reviewResult?.decision !== 'APPROVED'
    || reviewResult?.reviewerRole !== GATE0_REVIEWER_ROLE
    || reviewResult?.reviewMethod !== GATE0_REVIEW_METHOD
    || typeof reviewResult?.completedAt !== 'string'
    || !Array.isArray(reviewResult?.findings)
  ) {
    throw new Error('approved Gate 0 artifact inputs are invalid');
  }
  const envelope = `# Gate 0 approval attestation

> Generated by \`scripts/promote-gate0-review.js\`. This approval envelope is
> authoritative for the current artifact. The exact schema-7 artifact reviewed
> at \`${pendingAttestationSha}\` is preserved byte-for-byte after the marker
> below; its PENDING/CONDITIONAL wording is a historical snapshot.

- Gate: **Gate 0 — trustworthy baseline**
- Verdict: **PASS**
- Independent review: **APPROVED**
- Candidate: \`${candidateSha}\`
- Pending evidence attestation: \`${pendingAttestationSha}\`
- Review-result commit: \`${reviewResultSha}\`
- Review-result SHA-256: \`${reviewResultSha256}\`
- Review completed: ${reviewResult.completedAt}
- Reviewer: ${GATE0_REVIEWER_ROLE} (${GATE0_REVIEW_METHOD})
- Non-blocking findings recorded: ${reviewResult.findings.length}
- Reviewed artifact: \`${filePath}\`
- Reviewed artifact SHA-256: \`${sha256(original)}\`

## Reviewed pending artifact snapshot (verbatim)

<!-- intentsmith-gate0-reviewed-snapshot-begin -->
`;
  return Buffer.concat([Buffer.from(envelope), original]);
}

function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') return Buffer.from(value);
  return null;
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
