#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  buildGate0ExecutionPlan,
  environmentForExecution,
  gate0EvidenceLayout,
  makePortableInvocation,
  validGate0Toolchain,
} from './gate0-evidence-contract.js';
import {
  classifyDispositionValidatorExecution,
  classifyRegistryValidatorExecution,
  deriveGateOutcome,
  ReviewStatus,
} from './gate0-evidence-verdict.js';
import {
  buildGate0RiskEvidence,
  buildPrivacyIncidentEvidence,
  buildRegistryGateFacts,
  projectDispositionValidation,
  projectRegistryValidation,
  PRIVACY_INCIDENT_PATH,
  RISK_POLICY_PATH,
  RISK_REGISTER_PATH,
} from './gate0-evidence-projections.js';
import {
  runLogged,
  runWithOwnedProcessTerminationHandling,
} from './nightly-orchestrator.js';
import {
  collectDispositionCandidateInputPaths,
  FINAL_DIFF_MANIFEST_PATH,
  FINAL_DISPOSITION_PATH,
  REPAIRED_SUBJECTS_PATH,
} from './validate-final-disposition.js';
import {
  TEST_REGISTRY_DOC_PATH,
  TEST_REGISTRY_PATH,
} from './test-registry.js';
import {
  GATE0_ATTESTATION_OUTPUTS,
  GATE0_BOUND_OUTPUTS,
} from './gate0-attestation-paths.js';
import {
  GATE0_APPROVED_ATTESTATION_RULE,
  GATE0_PENDING_ATTESTATION_RULE,
  GATE0_REVIEW_PACKET_PATH,
  GATE0_REVIEW_RESULT_PATH,
  parseGate0ReviewResult,
} from './gate0-review-contract.js';
import {
  buildApprovedGate0Promotion,
} from './gate0-promotion-contract.js';

export {
  GATE0_ATTESTATION_OUTPUTS,
  GATE0_BOUND_OUTPUTS,
};
const EVIDENCE_INDEX_TOP_LEVEL_KEYS = Object.freeze([
  'schemaVersion',
  'product',
  'gate',
  'verdict',
  'exitCode',
  'generatedAt',
  'candidate',
  'sourceRefs',
  'inventory',
  'clauses',
  'repositoryBlockers',
  'provenance',
  'riskPolicy',
  'validations',
  'installation',
  'deterministic',
  'pilotFiveConsecutive',
  'soakRequirementGuard',
  'privacyIncident',
  'review',
  'generatedOutputs',
]);

export function validateGate0Attestation({
  headSha,
  parentShas,
  changedEntries,
  evidenceIndex,
  outputArtifacts,
  outputModes,
  expectedRegistrySha256,
  expectedRegistryValidation,
  expectedRegistryFacts,
  expectedDispositionValidation,
  expectedRiskPolicy,
  expectedPrivacyIncident,
  revalidationInputScopes,
  worktreeClean,
}) {
  const errors = [];
  if (!/^[a-f0-9]{40}$/.test(headSha || '')) {
    errors.push('attestation HEAD must be a full lowercase SHA-1');
  }
  if (
    !Array.isArray(parentShas)
    || parentShas.length !== 1
    || !/^[a-f0-9]{40}$/.test(parentShas[0] || '')
  ) {
    errors.push('attestation commit must have exactly one full-SHA parent');
  }
  if (
    evidenceIndex?.schemaVersion !== 7
    || evidenceIndex?.product !== 'IntentSmith'
    || evidenceIndex?.gate !== 'Gate 0'
    || !/^[a-f0-9]{40}$/.test(evidenceIndex?.candidate?.sha || '')
  ) {
    errors.push('evidence index identity/schema is invalid');
  } else {
    errors.push(...validateEvidenceIndexShape(
      evidenceIndex,
      expectedRegistryFacts,
    ));
    if (parentShas?.[0] !== evidenceIndex.candidate.sha) {
      errors.push('attestation parent does not equal the indexed candidate SHA');
    }
    if (headSha === evidenceIndex.candidate.sha) {
      errors.push('attestation HEAD must differ from its candidate parent');
    }
    if (
      !/^[a-f0-9]{64}$/.test(evidenceIndex.candidate.registrySha256 || '')
      || evidenceIndex.candidate.registrySha256 !== expectedRegistrySha256
    ) {
      errors.push('indexed registry fingerprint differs from the candidate parent');
    }
    if (
      evidenceIndex.candidate.attestationRule
      !== GATE0_PENDING_ATTESTATION_RULE
    ) {
      errors.push('evidence index attestation rule is missing or changed');
    }
    for (const [label, actual, expected] of [
      [
        'registry validation',
        evidenceIndex.validations?.registry,
        expectedRegistryValidation,
      ],
      [
        'disposition validation',
        evidenceIndex.validations?.disposition,
        expectedDispositionValidation,
      ],
      ['risk policy', evidenceIndex.riskPolicy, expectedRiskPolicy],
      ['privacy incident', evidenceIndex.privacyIncident, expectedPrivacyIncident],
    ]) {
      if (expected === undefined || !isDeepStrictEqual(actual, expected)) {
        errors.push(`${label} differs from candidate-parent revalidation`);
      }
    }
    if (
      expectedRiskPolicy === undefined
      || !isDeepStrictEqual(
        evidenceIndex.repositoryBlockers,
        expectedRiskPolicy.repositoryBlockers,
      )
    ) {
      errors.push('repository blockers differ from candidate-parent risk policy');
    }
  }
  const expectedEntries = GATE0_ATTESTATION_OUTPUTS
    .map(filePath => `M\t${filePath}`)
    .sort();
  const actualEntries = Array.isArray(changedEntries)
    ? [...changedEntries].sort()
    : [];
  if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
    errors.push(
      'attestation commit must modify exactly the four generated evidence outputs',
    );
  }
  if (worktreeClean !== true) {
    errors.push('attestation validation requires a clean worktree');
  }
  const revalidationBoundary = validateGate0RevalidationDisjointness(
    [...GATE0_ATTESTATION_OUTPUTS, GATE0_REVIEW_RESULT_PATH],
    revalidationInputScopes,
  );
  if (!revalidationBoundary.valid) {
    errors.push(...revalidationBoundary.errors);
  }
  for (const filePath of GATE0_ATTESTATION_OUTPUTS) {
    if (outputModes?.[filePath] !== '100644') {
      errors.push(`attestation output has an invalid Git mode: ${filePath}`);
    }
  }
  const expectedBindingPaths = [...GATE0_BOUND_OUTPUTS].sort();
  const actualBindingPaths = Object.keys(
    evidenceIndex?.generatedOutputs || {},
  ).sort();
  if (
    JSON.stringify(actualBindingPaths) !== JSON.stringify(expectedBindingPaths)
  ) {
    errors.push('evidence index must bind exactly the three Markdown outputs');
  } else {
    for (const filePath of expectedBindingPaths) {
      const contents = outputArtifacts?.[filePath];
      const bytes = Buffer.isBuffer(contents)
        ? contents
        : typeof contents === 'string' ? Buffer.from(contents) : null;
      const binding = evidenceIndex.generatedOutputs[filePath];
      if (
        bytes === null
        || !hasExactKeys(binding, ['bytes', 'sha256'])
        || binding?.bytes !== bytes.length
        || binding?.sha256 !== sha256(bytes)
      ) {
        errors.push(`generated output binding mismatch for ${filePath}`);
      }
    }
  }
  return {
    schemaVersion: 1,
    valid: errors.length === 0,
    errors,
    headSha,
    candidateSha: evidenceIndex?.candidate?.sha || null,
    changedEntries: actualEntries,
  };
}

export function validateGate0ApprovedAttestation({
  headSha,
  parentShas,
  changedEntries,
  evidenceIndex,
  outputArtifacts,
  outputModes,
  pendingAttestation,
  reviewResultCommit,
  expectedRegistrySha256,
  expectedRegistryValidation,
  expectedRegistryFacts,
  expectedDispositionValidation,
  expectedRiskPolicy,
  expectedPrivacyIncident,
  revalidationInputScopes,
  worktreeClean,
}) {
  const errors = [];
  const pendingReport = validateGate0Attestation({
    ...pendingAttestation,
    expectedRegistrySha256,
    expectedRegistryValidation,
    expectedRegistryFacts,
    expectedDispositionValidation,
    expectedRiskPolicy,
    expectedPrivacyIncident,
    revalidationInputScopes,
    worktreeClean: true,
  });
  if (!pendingReport.valid) {
    errors.push(
      ...pendingReport.errors.map(error => `pending attestation: ${error}`),
    );
  }

  const pendingIndex = pendingAttestation?.evidenceIndex;
  const candidateSha = pendingIndex?.candidate?.sha;
  const pendingAttestationSha = pendingAttestation?.headSha;
  const reviewResultSha = reviewResultCommit?.headSha;
  const fullShaPattern = /^[a-f0-9]{40}$/;

  if (!fullShaPattern.test(headSha || '')) {
    errors.push('approved attestation HEAD must be a full lowercase SHA-1');
  }
  if (
    !Array.isArray(parentShas)
    || parentShas.length !== 1
    || parentShas[0] !== reviewResultSha
  ) {
    errors.push('approved attestation must have the review-result commit as sole parent');
  }
  if (
    !fullShaPattern.test(reviewResultSha || '')
    || reviewResultSha === pendingAttestationSha
    || reviewResultSha === candidateSha
  ) {
    errors.push('review-result commit identity is invalid');
  }
  if (
    !Array.isArray(reviewResultCommit?.parentShas)
    || reviewResultCommit.parentShas.length !== 1
    || reviewResultCommit.parentShas[0] !== pendingAttestationSha
  ) {
    errors.push(
      'review-result commit must have the pending attestation as sole parent',
    );
  }
  if (
    headSha === reviewResultSha
    || headSha === pendingAttestationSha
    || headSha === candidateSha
  ) {
    errors.push('approved attestation commits must have distinct identities');
  }

  const expectedReviewEntries = [`A\t${GATE0_REVIEW_RESULT_PATH}`];
  const actualReviewEntries = Array.isArray(reviewResultCommit?.changedEntries)
    ? [...reviewResultCommit.changedEntries].sort()
    : [];
  if (!isDeepStrictEqual(actualReviewEntries, expectedReviewEntries)) {
    errors.push('review-result commit must add exactly the locked result file');
  }
  if (reviewResultCommit?.resultMode !== '100644') {
    errors.push('review-result file must have Git mode 100644');
  }

  const packetBytes = toBuffer(
    pendingAttestation?.outputArtifacts?.[GATE0_REVIEW_PACKET_PATH],
  );
  const parsedReview = parseGate0ReviewResult(
    reviewResultCommit?.resultBytes,
    {
      candidateSha,
      pendingAttestationSha,
      registryFingerprint: pendingIndex?.candidate?.registrySha256,
      reviewRange: pendingIndex?.review?.range,
      packetSha256: packetBytes === null ? null : sha256(packetBytes),
      reviewRequiredRisks: pendingIndex?.riskPolicy?.reviewRequiredRisks,
    },
  );
  if (!parsedReview.valid) {
    errors.push(...parsedReview.errors.map(error => `review result: ${error}`));
  }
  const promotion = buildApprovedGate0Promotion({
    pendingAttestationSha,
    reviewResultSha,
    pendingIndex,
    pendingArtifacts: pendingAttestation?.outputArtifacts,
    reviewResultBytes: reviewResultCommit?.resultBytes,
  });
  if (!promotion.valid) {
    errors.push(
      ...promotion.errors.map(error => `approved promotion: ${error}`),
    );
  }

  if (
    !hasExactKeys(evidenceIndex, EVIDENCE_INDEX_TOP_LEVEL_KEYS)
    || evidenceIndex?.schemaVersion !== 8
    || evidenceIndex?.product !== 'IntentSmith'
    || evidenceIndex?.gate !== 'Gate 0'
  ) {
    errors.push('approved evidence index identity/schema is invalid');
  }

  const expectedCandidate = isRecord(pendingIndex?.candidate)
    ? {
      ...pendingIndex.candidate,
      attestationRule: GATE0_APPROVED_ATTESTATION_RULE,
    }
    : null;
  if (!isDeepStrictEqual(evidenceIndex?.candidate, expectedCandidate)) {
    errors.push('approved evidence candidate binding differs from pending evidence');
  }

  for (const field of [
    'product',
    'gate',
    'generatedAt',
    'sourceRefs',
    'inventory',
    'clauses',
    'repositoryBlockers',
    'provenance',
    'riskPolicy',
    'validations',
    'installation',
    'deterministic',
    'pilotFiveConsecutive',
    'soakRequirementGuard',
    'privacyIncident',
  ]) {
    if (!isDeepStrictEqual(evidenceIndex?.[field], pendingIndex?.[field])) {
      errors.push(`approved evidence changed inherited field: ${field}`);
    }
  }

  let approvedOutcome = null;
  try {
    approvedOutcome = deriveGateOutcome({
      clauses: evidenceIndex?.clauses,
      repositoryBlockers: evidenceIndex?.repositoryBlockers,
      reviewRequiredRisks:
        evidenceIndex?.riskPolicy?.reviewRequiredRisks,
      reviewStatus: ReviewStatus.APPROVED,
    });
  } catch (error) {
    errors.push(`approved evidence outcome is invalid: ${error.message}`);
  }
  if (
    approvedOutcome?.verdict !== 'PASS'
    || approvedOutcome?.exitCode !== 0
  ) {
    errors.push('approved review cannot promote a failing Gate 0 candidate');
  }
  if (
    evidenceIndex?.verdict !== approvedOutcome?.verdict
    || evidenceIndex?.exitCode !== approvedOutcome?.exitCode
  ) {
    errors.push('approved evidence verdict/exit disagrees with derived outcome');
  }

  const result = parsedReview.result;
  const expectedReview = {
    range: pendingIndex?.review?.range,
    commitCount: pendingIndex?.review?.commitCount,
    packet: pendingIndex?.review?.packet,
    independentReviewStatus: ReviewStatus.APPROVED,
    result: {
      path: GATE0_REVIEW_RESULT_PATH,
      commitSha: reviewResultSha,
      pendingAttestationSha,
      schemaVersion: result?.schemaVersion,
      bytes: parsedReview.bytes,
      sha256: parsedReview.sha256,
      decision: result?.decision,
      reviewerRole: result?.reviewerRole,
      reviewMethod: result?.reviewMethod,
      completedAt: result?.completedAt,
      findingCount: Array.isArray(result?.findings)
        ? result.findings.length
        : null,
    },
  };
  if (!isDeepStrictEqual(evidenceIndex?.review, expectedReview)) {
    errors.push('approved evidence review binding differs from the review commit');
  }

  const expectedEntries = GATE0_ATTESTATION_OUTPUTS
    .map(filePath => `M\t${filePath}`)
    .sort();
  const actualEntries = Array.isArray(changedEntries)
    ? [...changedEntries].sort()
    : [];
  if (!isDeepStrictEqual(actualEntries, expectedEntries)) {
    errors.push(
      'approved attestation must modify exactly the four generated evidence outputs',
    );
  }
  if (worktreeClean !== true) {
    errors.push('approved attestation validation requires a clean worktree');
  }
  const revalidationBoundary = validateGate0RevalidationDisjointness(
    [...GATE0_ATTESTATION_OUTPUTS, GATE0_REVIEW_RESULT_PATH],
    revalidationInputScopes,
  );
  if (!revalidationBoundary.valid) {
    errors.push(...revalidationBoundary.errors);
  }
  for (const filePath of GATE0_ATTESTATION_OUTPUTS) {
    if (outputModes?.[filePath] !== '100644') {
      errors.push(`approved attestation output has an invalid Git mode: ${filePath}`);
    }
  }

  const expectedBindingPaths = [...GATE0_BOUND_OUTPUTS].sort();
  const actualBindingPaths = Object.keys(
    evidenceIndex?.generatedOutputs || {},
  ).sort();
  if (!isDeepStrictEqual(actualBindingPaths, expectedBindingPaths)) {
    errors.push(
      'approved evidence index must bind exactly the three Markdown outputs',
    );
  } else {
    for (const filePath of expectedBindingPaths) {
      const bytes = toBuffer(outputArtifacts?.[filePath]);
      const binding = evidenceIndex.generatedOutputs[filePath];
      if (
        bytes === null
        || !hasExactKeys(binding, ['bytes', 'sha256'])
        || binding.bytes !== bytes.length
        || binding.sha256 !== sha256(bytes)
      ) {
        errors.push(`approved generated output binding mismatch for ${filePath}`);
      }
    }
  }
  if (promotion.valid) {
    if (!isDeepStrictEqual(evidenceIndex, promotion.evidenceIndex)) {
      errors.push(
        'approved evidence index differs from deterministic promotion output',
      );
    }
    for (const filePath of GATE0_BOUND_OUTPUTS) {
      const actual = toBuffer(outputArtifacts?.[filePath]);
      const expected = promotion.outputArtifacts[filePath];
      if (
        actual === null
        || !Buffer.isBuffer(expected)
        || !actual.equals(expected)
      ) {
        errors.push(
          `approved Markdown differs from deterministic promotion: ${filePath}`,
        );
      }
    }
  }

  return {
    schemaVersion: 2,
    valid: errors.length === 0,
    errors,
    headSha,
    candidateSha: candidateSha || null,
    pendingAttestationSha: pendingAttestationSha || null,
    reviewResultSha: reviewResultSha || null,
    changedEntries: actualEntries,
  };
}

export function buildGate0RevalidationInputScopes(dispositionManifest) {
  return [
    {
      kind: 'exact',
      path: TEST_REGISTRY_PATH,
      source: 'registry-json',
    },
    {
      kind: 'exact',
      path: TEST_REGISTRY_DOC_PATH,
      source: 'registry-rendered-document',
    },
    {
      kind: 'tree',
      path: 'tests',
      source: 'registry-program-discovery',
    },
    {
      kind: 'exact',
      path: 'e2e/run-e2e.js',
      source: 'registry-root-runner-discovery',
    },
    {
      kind: 'exact',
      path: FINAL_DIFF_MANIFEST_PATH,
      source: 'disposition-source-manifest',
    },
    {
      kind: 'exact',
      path: FINAL_DISPOSITION_PATH,
      source: 'disposition-document',
    },
    {
      kind: 'exact',
      path: REPAIRED_SUBJECTS_PATH,
      source: 'disposition-repaired-subjects',
    },
    ...collectDispositionCandidateInputPaths(dispositionManifest).map(
      inputPath => ({
        kind: 'exact',
        path: inputPath,
        source: 'disposition-candidate-subject',
      }),
    ),
  ];
}

export function validateGate0RevalidationDisjointness(
  outputPaths,
  inputScopes,
) {
  const errors = [];
  if (!Array.isArray(outputPaths) || outputPaths.length === 0) {
    errors.push('attestation revalidation outputs are missing');
  }
  if (!Array.isArray(inputScopes) || inputScopes.length === 0) {
    errors.push('attestation revalidation input boundary is missing');
  }
  const normalizedOutputs = [];
  for (const [index, outputPath] of (outputPaths || []).entries()) {
    const normalized = normalizeBoundaryPath(outputPath);
    if (normalized === null) {
      errors.push(`attestation output[${index}] is not a safe relative path`);
    } else {
      normalizedOutputs.push(normalized);
    }
  }
  for (const [index, scope] of (inputScopes || []).entries()) {
    if (
      !hasExactKeys(scope, ['kind', 'path', 'source'])
      || !['exact', 'tree'].includes(scope.kind)
      || typeof scope.source !== 'string'
      || scope.source.trim() === ''
    ) {
      errors.push(`attestation revalidation input scope[${index}] is invalid`);
      continue;
    }
    const inputPath = normalizeBoundaryPath(scope.path);
    if (inputPath === null) {
      errors.push(
        `attestation revalidation input scope[${index}] has an unsafe path`,
      );
      continue;
    }
    for (const outputPath of normalizedOutputs) {
      const overlaps = scope.kind === 'exact'
        ? inputPath === outputPath
        : outputPath === inputPath
          || outputPath.startsWith(`${inputPath}/`);
      if (overlaps) {
        errors.push(
          `attestation output ${outputPath} overlaps ${scope.source} `
          + `${scope.kind} input ${inputPath}`,
        );
      }
    }
  }
  return {
    schemaVersion: 1,
    valid: errors.length === 0,
    errors,
  };
}

export function validateEvidenceIndexShape(index, expectedRegistryFacts) {
  const errors = [];
  if (
    index === null
    || typeof index !== 'object'
    || Array.isArray(index)
    || !isDeepStrictEqual(
      Object.keys(index).sort(),
      [...EVIDENCE_INDEX_TOP_LEVEL_KEYS].sort(),
    )
  ) {
    return ['schema-7 evidence index top-level fields differ from the locked contract'];
  }
  if (
    !validIsoTimestamp(index.generatedAt)
    || !hasExactKeys(index.candidate, [
      'sha',
      'branch',
      'registrySha256',
      'attestationRule',
    ])
    || !/^(?:detached|[A-Za-z0-9][A-Za-z0-9._/-]{0,127})$/
      .test(index.candidate.branch)
    || index.candidate.branch.includes('..')
    || !Array.isArray(index.repositoryBlockers)
    || !isDeepStrictEqual(index.sourceRefs, {
      c3Input: 'ffd21cf119865259ea1847af989acb24916bebe3',
      c3Parent: 'a7b90e36aa80310305703f54f2332e1c0e7f9e8f',
      intentSmithDonor: '6676902c5f6fe7a5d66aba0d79cb502e0f3a60e4',
      localValidationCandidate: index.candidate?.sha,
    })
  ) {
    errors.push('evidence index candidate/source/outcome metadata is invalid');
  }
  const provenance = index.provenance;
  const expectedProvenancePath = /^[a-f0-9]{40}$/.test(index.candidate?.sha || '')
    ? gate0EvidenceLayout(index.candidate.sha).provenance
    : null;
  if (
    !hasExactKeys(provenance, [
      'schemaVersion',
      'path',
      'sha256',
      'bytes',
      'executionCount',
      'secretValuesRecorded',
      'initialIgnoredState',
      'startedAt',
      'endedAt',
      'toolchain',
    ])
    || provenance?.schemaVersion !== 1
    || provenance?.path !== expectedProvenancePath
    || !/^[a-f0-9]{64}$/.test(provenance?.sha256 || '')
    || !Number.isInteger(provenance?.bytes)
    || provenance.bytes < 1
    || provenance.executionCount !== 9
    || provenance.secretValuesRecorded !== false
    || JSON.stringify(provenance.initialIgnoredState) !== '{"clean":true}'
    || !validIsoTimestamp(provenance.startedAt)
    || !validIsoTimestamp(provenance.endedAt)
    || Date.parse(provenance.startedAt) > Date.parse(provenance.endedAt)
    || provenance.endedAt !== index.generatedAt
    || !validGate0Toolchain(provenance.toolchain)
  ) {
    errors.push('evidence index does not carry the locked producer provenance');
  }
  const expectedClauseIds = Array.from(
    { length: 9 },
    (_, index) => `G0-C${index + 1}`,
  );
  const clauses = Array.isArray(index.clauses) ? index.clauses : [];
  if (
    clauses.length !== expectedClauseIds.length
    || JSON.stringify(clauses.map(clause => clause?.id).sort())
      !== JSON.stringify(expectedClauseIds)
    || clauses.some(clause => (
      !hasExactKeys(clause, ['id', 'label', 'result', 'evidence'])
      || !['PASS', 'FAIL'].includes(clause?.result)
      || typeof clause?.label !== 'string'
      || typeof clause?.evidence !== 'string'
    ))
  ) {
    errors.push('evidence index must contain exact unique G0-C1..G0-C9 outcomes');
  }
  const reviewStatus = index.review?.independentReviewStatus;
  const hasFailure = clauses.some(clause => clause.result === 'FAIL')
    || index.repositoryBlockers.length > 0;
  const expectedVerdict = hasFailure
    ? 'FAIL'
    : reviewStatus === 'PENDING' ? 'CONDITIONAL PASS' : null;
  const expectedExitCode = expectedVerdict === 'FAIL' ? 1 : 0;
  if (
    expectedVerdict === null
    || index.verdict !== expectedVerdict
    || index.exitCode !== expectedExitCode
  ) {
    errors.push('evidence index verdict/exit disagrees with clauses and review');
  }
  if (
    !hasExactKeys(index.review, [
      'range',
      'commitCount',
      'packet',
      'independentReviewStatus',
    ])
    || index.review?.packet !== 'docs/convergence/reviews/GATE0-OPUS-REVIEW.md'
    || index.review?.range
      !== `f11026f062e5d2e75fe6802a3e4e2ad38a6c9dab..${index.candidate?.sha}`
    || !Number.isInteger(index.review?.commitCount)
    || index.review.commitCount < 1
  ) {
    errors.push('evidence index review packet/range is invalid');
  }
  const clauseById = new Map(clauses.map(clause => [clause.id, clause]));
  const registryValidation = index.validations?.registry;
  const dispositionValidation = index.validations?.disposition;
  if (
    !hasExactKeys(index.validations, ['registry', 'disposition'])
    || !validValidatorEvidence(
      registryValidation,
      'node scripts/validate-test-registry.js --json',
    )
    || !validValidatorEvidence(
      dispositionValidation,
      'node scripts/validate-final-disposition.js --json',
    )
    || (registryValidation?.exitCode === 0)
      !== (clauseById.get('G0-C3')?.result === 'PASS')
    || (dispositionValidation?.exitCode === 0)
      !== (clauseById.get('G0-C2')?.result === 'PASS')
  ) {
    errors.push('evidence index validator outcomes are missing or contradictory');
  }
  const registryFactsValid = hasExactKeys(expectedRegistryFacts, [
    'runnablePrograms',
    'explicitSupportExclusions',
    'profileCounts',
    'stateCounts',
    'deterministicRequired',
    'deterministicScopeValid',
    'knownDefectiveInDeterministic',
    'blockedWithoutPrerequisite',
  ])
    && isRecord(expectedRegistryFacts.profileCounts)
    && isRecord(expectedRegistryFacts.stateCounts)
    && typeof expectedRegistryFacts.deterministicScopeValid === 'boolean'
    && Array.isArray(expectedRegistryFacts.knownDefectiveInDeterministic)
    && Array.isArray(expectedRegistryFacts.blockedWithoutPrerequisite);
  if (
    !hasExactKeys(index.inventory, [
      'runnablePrograms',
      'explicitSupportExclusions',
      'profileCounts',
      'stateCounts',
      'deterministicRequired',
      'dispositionRecords',
    ])
    || !registryFactsValid
    || index.inventory.runnablePrograms
      !== expectedRegistryFacts?.runnablePrograms
    || index.inventory.explicitSupportExclusions
      !== expectedRegistryFacts?.explicitSupportExclusions
    || index.inventory.deterministicRequired
      !== expectedRegistryFacts?.deterministicRequired
    || index.inventory.dispositionRecords !== 225
    || !isDeepStrictEqual(
      index.inventory.profileCounts,
      expectedRegistryFacts?.profileCounts,
    )
    || !isDeepStrictEqual(
      index.inventory.stateCounts,
      expectedRegistryFacts?.stateCounts,
    )
  ) {
    errors.push('evidence index inventory differs from the candidate-parent registry');
  }
  if (
    !hasExactKeys(index.riskPolicy, [
      'path',
      'schemaVersion',
      'sha256',
      'registerPath',
      'registerSha256',
      'valid',
      'errors',
      'riskCount',
      'policyCount',
      'impactCounts',
      'openImpactCounts',
      'repositoryBlockers',
      'reviewRequiredRisks',
      'laterGateRisks',
      'separateIncidents',
    ])
    || index.riskPolicy.path !== RISK_POLICY_PATH
    || index.riskPolicy.registerPath !== RISK_REGISTER_PATH
    || index.riskPolicy.schemaVersion !== 1
    || typeof index.riskPolicy.valid !== 'boolean'
    || !Array.isArray(index.riskPolicy.errors)
    || !/^[a-f0-9]{64}$/.test(index.riskPolicy.sha256 || '')
    || !/^[a-f0-9]{64}$/.test(index.riskPolicy.registerSha256 || '')
    || !Array.isArray(index.riskPolicy.repositoryBlockers)
    || !isDeepStrictEqual(
      index.repositoryBlockers,
      index.riskPolicy.repositoryBlockers,
    )
    || (index.riskPolicy.valid && index.riskPolicy.errors.length !== 0)
    || (
      index.riskPolicy.valid
      !== (clauseById.get('G0-C9')?.result === 'PASS')
    )
  ) {
    errors.push('evidence index risk-policy outcome is missing or contradictory');
  }
  const installLogs = index.installation?.logs;
  if (
    !hasExactKeys(index.installation, ['passed', 'logs'])
    || typeof index.installation.passed !== 'boolean'
    || !Array.isArray(installLogs)
    || installLogs.length !== 2
    || JSON.stringify(installLogs.map(log => log?.kind))
      !== JSON.stringify(['clean', 'repeat'])
    || installLogs.some(log => !Number.isInteger(log?.exitCode))
    || (
      index.installation.passed
      !== installLogs.every(log => log.exitCode === 0)
    )
    || (
      index.installation.passed
      !== (clauseById.get('G0-C4')?.result === 'PASS')
    )
  ) {
    errors.push('evidence index installation outcome is missing or contradictory');
  }
  const pilots = index.pilotFiveConsecutive;
  if (
    !validAuditOutcome(index.deterministic)
    || !Array.isArray(pilots)
    || pilots.length !== 5
    || pilots.some(item => !validAuditOutcome(item))
    || new Set(pilots.map(item => item.runId)).size !== 5
    || !validAuditOutcome(index.soakRequirementGuard)
    || !Array.isArray(index.soakRequirementGuard.blockedBy)
    || index.soakRequirementGuard.guardPassed !== (
      index.soakRequirementGuard.passed === false
      && index.soakRequirementGuard.verdict === 'BLOCKED'
      && index.soakRequirementGuard.exitCode === 2
      && isDeepStrictEqual(index.soakRequirementGuard.statusCounts, {
        PASS: 0,
        FAIL: 0,
        TIMEOUT: 0,
        BLOCKED: 5,
        SKIPPED: 0,
      })
      && index.soakRequirementGuard.blockedBy.includes('gpu')
      && index.soakRequirementGuard.blockedBy.includes('ollama')
    )
  ) {
    errors.push('evidence index audit/pilot/soak outcomes are incomplete');
  }
  const pilotsPassed = Array.isArray(pilots)
    && pilots.length === 5
    && pilots.every(item => item.passed === true);
  if (
    isRecord(index.deterministic)
    && typeof index.deterministic.passed === 'boolean'
    && (index.deterministic.passed && pilotsPassed)
      !== (clauseById.get('G0-C5')?.result === 'PASS')
  ) {
    errors.push('evidence index deterministic/pilot outcome contradicts G0-C5');
  }
  const expectedC6Pass = registryFactsValid
    && expectedRegistryFacts.deterministicScopeValid
    && expectedRegistryFacts.knownDefectiveInDeterministic.length === 0;
  const expectedC7Pass = registryFactsValid
    && expectedRegistryFacts.blockedWithoutPrerequisite.length === 0
    && index.soakRequirementGuard?.guardPassed === true;
  if (
    clauseById.get('G0-C6')?.result
      !== (expectedC6Pass ? 'PASS' : 'FAIL')
    || clauseById.get('G0-C7')?.result
      !== (expectedC7Pass ? 'PASS' : 'FAIL')
    || clauseById.get('G0-C8')?.result !== 'PASS'
  ) {
    errors.push(
      'evidence index G0-C6/G0-C7/G0-C8 outcome contradicts parent-derived facts',
    );
  }
  errors.push(...validateD021Evidence(index, clauseById));
  if (
    !hasExactKeys(index.privacyIncident, [
      'path',
      'schemaVersion',
      'sha256',
      'incidentId',
      'status',
      'trackedPathsRemoved',
      'trackedBytesRemoved',
      'historyReachable',
      'historyRewritten',
      'personalContentInspected',
      'rotationCategories',
    ])
    || index.privacyIncident.path !== PRIVACY_INCIDENT_PATH
    || index.privacyIncident.schemaVersion !== 1
    || !/^[a-f0-9]{64}$/.test(index.privacyIncident.sha256 || '')
    || index.privacyIncident.status !== 'CONFIRMED_COMPROMISE'
    || !Number.isInteger(index.privacyIncident.trackedPathsRemoved)
    || index.privacyIncident.trackedPathsRemoved < 1
    || !Number.isInteger(index.privacyIncident.trackedBytesRemoved)
    || index.privacyIncident.trackedBytesRemoved < 1
    || typeof index.privacyIncident.historyReachable !== 'boolean'
    || typeof index.privacyIncident.historyRewritten !== 'boolean'
    || index.privacyIncident.personalContentInspected !== false
    || !Array.isArray(index.privacyIncident.rotationCategories)
  ) {
    errors.push('evidence index privacy incident section is invalid');
  }
  if (
    !isRecord(index.deterministic)
    || !Array.isArray(index.pilotFiveConsecutive)
    || !isRecord(index.soakRequirementGuard)
  ) {
    errors.push('evidence index is missing required evidence sections');
  }
  return errors;
}

function validateD021Evidence(index, clauseById) {
  const errors = [];
  const candidateSha = index.candidate?.sha;
  if (!/^[a-f0-9]{40}$/.test(candidateSha || '')) return errors;
  const syntheticRoot = '/intentsmith-gate0-candidate';
  const plan = buildGate0ExecutionPlan({
    root: syntheticRoot,
    candidateSha,
  });
  const installLogs = Array.isArray(index.installation?.logs)
    ? index.installation.logs
    : [];
  const audits = [
    index.deterministic,
    ...(Array.isArray(index.pilotFiveConsecutive)
      ? index.pilotFiveConsecutive
      : []),
    index.soakRequirementGuard,
  ];
  const executionBindings = [
    ...installLogs.map((log, offset) => ({
      execution: log?.execution,
      expected: plan[offset],
      outer: log,
      kind: 'install',
    })),
    ...audits.map((audit, offset) => ({
      execution: audit?.execution,
      expected: plan[offset + 2],
      outer: audit,
      kind: 'audit',
    })),
  ];
  if (executionBindings.length !== plan.length) {
    errors.push('D-021 evidence does not contain the locked nine executions');
    return errors;
  }
  let previousEnd = Date.parse(index.provenance?.startedAt);
  const provenanceEnd = Date.parse(index.provenance?.endedAt);
  const logPaths = new Set();
  for (const [offset, binding] of executionBindings.entries()) {
    const label = `D-021 execution ${offset + 1}`;
    errors.push(...sanitizedExecutionErrors({
      value: binding.execution,
      expected: binding.expected,
      candidateSha,
      syntheticRoot,
      label,
    }));
    if (!isRecord(binding.execution)) continue;
    const executionStart = Date.parse(binding.execution.startedAt);
    const executionEnd = Date.parse(binding.execution.endedAt);
    if (
      !Number.isFinite(previousEnd)
      || !Number.isFinite(provenanceEnd)
      || !Number.isFinite(executionStart)
      || !Number.isFinite(executionEnd)
      || executionStart < previousEnd
      || executionEnd > provenanceEnd
    ) {
      errors.push(`${label} chronology is not serially bound to provenance`);
    }
    previousEnd = executionEnd;
    if (logPaths.has(binding.execution.log)) {
      errors.push(`${label} reuses another producer log`);
    }
    logPaths.add(binding.execution.log);
    if (binding.kind === 'install') {
      if (
        !hasExactKeys(binding.outer, [
          'kind',
          'path',
          'bytes',
          'sha256',
          'exitCode',
          'execution',
        ])
        || binding.outer.path !== binding.execution.log
        || binding.outer.bytes !== binding.execution.logBytes
        || binding.outer.sha256 !== binding.execution.logSha256
        || binding.outer.exitCode !== binding.execution.exitCode
      ) {
        errors.push(`${label} install log binding is incomplete`);
      }
    } else {
      errors.push(...auditBindingErrors(
        binding.outer,
        binding.execution,
        binding.expected,
        label,
      ));
    }
  }
  const installsPassed = installLogs.length === 2
    && installLogs.every(log => log.exitCode === 0);
  const pilotsPassed = Array.isArray(index.pilotFiveConsecutive)
    && index.pilotFiveConsecutive.length === 5
    && index.pilotFiveConsecutive.every(audit => audit.passed === true);
  const deterministicPassed = index.deterministic?.passed === true;
  if (
    index.installation?.passed !== installsPassed
    || (clauseById.get('G0-C4')?.result === 'PASS') !== installsPassed
    || (clauseById.get('G0-C5')?.result === 'PASS')
      !== (deterministicPassed && pilotsPassed)
    || clauseById.get('G0-C1')?.result !== 'PASS'
    || clauseById.get('G0-C8')?.result !== 'PASS'
  ) {
    errors.push('D-021 evidence contradicts its Gate 0 clauses');
  }
  return errors;
}

function sanitizedExecutionErrors({
  value,
  expected,
  candidateSha,
  syntheticRoot,
  label,
}) {
  const errors = [];
  const expectedKeys = [
    'id',
    'portableReplay',
    'startedAt',
    'endedAt',
    'exitCode',
    'signal',
    'timedOut',
    'leakDetected',
    'cleanupTerminated',
    'log',
    'logBytes',
    'logSha256',
    'report',
    'reportBytes',
    'reportSha256',
    'inventory',
    'inventoryBytes',
    'inventorySha256',
    'preSourceState',
    'postSourceState',
    'preIgnoredState',
    'postIgnoredState',
  ];
  if (!hasExactKeys(value, expectedKeys)) {
    return [`${label} fields differ from the sanitized execution contract`];
  }
  if (
    value.id !== expected.id
    || !isDeepStrictEqual(
      value.portableReplay,
      makePortableInvocation(expected, syntheticRoot),
    )
    || !validIsoTimestamp(value.startedAt)
    || !validIsoTimestamp(value.endedAt)
    || Date.parse(value.startedAt) > Date.parse(value.endedAt)
    || !Number.isInteger(value.exitCode)
    || value.exitCode < 0
    || value.signal !== null
    || value.timedOut !== false
    || value.leakDetected !== false
    || value.cleanupTerminated !== true
    || value.log !== expected.logPath
    || !Number.isInteger(value.logBytes)
    || value.logBytes < 1
    || !/^[a-f0-9]{64}$/.test(value.logSha256 || '')
    || value.report !== expected.reportPath
    || value.inventory !== expected.inventoryPath
    || !isDeepStrictEqual(value.preSourceState, {
      sha: candidateSha,
      clean: true,
    })
    || !isDeepStrictEqual(value.postSourceState, {
      sha: candidateSha,
      clean: true,
    })
    || !validIgnoredState(value.preIgnoredState)
    || !validIgnoredState(value.postIgnoredState)
  ) {
    errors.push(`${label} identity, replay, process, or source state is invalid`);
  }
  for (const [pathKey, bytesKey, digestKey] of [
    ['report', 'reportBytes', 'reportSha256'],
    ['inventory', 'inventoryBytes', 'inventorySha256'],
  ]) {
    if (value[pathKey] === null) {
      if (value[bytesKey] !== null || value[digestKey] !== null) {
        errors.push(`${label} ${pathKey} null binding is contradictory`);
      }
    } else if (
      !Number.isInteger(value[bytesKey])
      || value[bytesKey] < 1
      || !/^[a-f0-9]{64}$/.test(value[digestKey] || '')
    ) {
      errors.push(`${label} ${pathKey} bytes/digest is invalid`);
    }
  }
  return errors;
}

function auditBindingErrors(audit, execution, expected, label) {
  const errors = [];
  const expectedKeys = [
    'runId',
    'passed',
    'verdict',
    'exitCode',
    'statusCounts',
    'report',
    'reportSha256',
    'reportBytes',
    'inventory',
    'inventorySha256',
    'inventoryBytes',
    'inventoryFingerprint',
    'optionsFingerprint',
    'startedAt',
    'endedAt',
    'execution',
  ];
  if (expected.id === 'soak-guard') {
    expectedKeys.push('blockedBy', 'guardPassed');
  }
  if (!hasExactKeys(audit, expectedKeys)) {
    return [`${label} audit fields differ from the locked contract`];
  }
  const expectedRunId = expected.argv
    .find(value => value.startsWith('--run-id='))
    ?.slice('--run-id='.length);
  const expectedSuiteCount = expected.id === 'deterministic'
    ? 199
    : expected.id === 'soak-guard' ? 5 : 1;
  const statusCounts = audit.statusCounts;
  const statusTotal = isRecord(statusCounts)
    && hasExactKeys(statusCounts, [
      'PASS',
      'FAIL',
      'TIMEOUT',
      'BLOCKED',
      'SKIPPED',
    ])
    && Object.values(statusCounts).every(
      count => Number.isInteger(count) && count >= 0,
    )
    ? Object.values(statusCounts).reduce((sum, count) => sum + count, 0)
    : -1;
  const derivedVerdict = statusTotal < 0
    ? null
    : statusCounts.FAIL + statusCounts.TIMEOUT + statusCounts.SKIPPED > 0
      ? 'FAIL'
      : statusCounts.BLOCKED > 0
        ? 'BLOCKED'
        : 'PASS';
  if (
    !validAuditOutcome(audit)
    || audit.runId !== expectedRunId
    || audit.exitCode !== execution.exitCode
    || audit.report !== execution.report
    || audit.reportSha256 !== execution.reportSha256
    || audit.reportBytes !== execution.reportBytes
    || audit.inventory !== execution.inventory
    || audit.inventorySha256 !== execution.inventorySha256
    || audit.inventoryBytes !== execution.inventoryBytes
    || !/^[a-f0-9]{64}$/.test(audit.inventoryFingerprint || '')
    || !/^[a-f0-9]{64}$/.test(audit.optionsFingerprint || '')
    || !validIsoTimestamp(audit.startedAt)
    || !validIsoTimestamp(audit.endedAt)
    || Date.parse(audit.startedAt) < Date.parse(execution.startedAt)
    || Date.parse(audit.endedAt) > Date.parse(execution.endedAt)
    || statusTotal !== expectedSuiteCount
    || audit.verdict !== derivedVerdict
  ) {
    errors.push(`${label} report/inventory/outcome binding is invalid`);
  }
  return errors;
}

function validIgnoredState(value) {
  return hasExactKeys(value, [
    'policy',
    'observedAllowedCount',
    'unexpectedPathCount',
  ])
    && value.policy === 'gate0-ignored-path-boundary-v1'
    && Number.isInteger(value.observedAllowedCount)
    && value.observedAllowedCount >= 1
    && value.unexpectedPathCount === 0;
}

export function resolveGate0AttestationChain({
  headSha,
  parentShas,
  schemaVersion,
  reviewRevision = null,
  pendingRevision = null,
}) {
  const errors = [];
  if (!isFullSha1(headSha)) {
    errors.push('attestation HEAD must be a full lowercase SHA-1');
  }
  if (
    !Array.isArray(parentShas)
    || parentShas.length !== 1
    || !isFullSha1(parentShas[0])
  ) {
    errors.push('attestation HEAD must have exactly one full-SHA parent');
  }

  if (schemaVersion === 7) {
    return {
      schemaVersion: 1,
      valid: errors.length === 0,
      errors,
      candidateSha: parentShas?.[0] || null,
      pendingAttestationSha: headSha || null,
      reviewResultSha: null,
      approvedAttestationSha: null,
    };
  }
  if (schemaVersion !== 8) {
    errors.push(`unsupported Gate 0 evidence schema: ${String(schemaVersion)}`);
    return {
      schemaVersion: 1,
      valid: false,
      errors,
      candidateSha: null,
      pendingAttestationSha: null,
      reviewResultSha: null,
      approvedAttestationSha: headSha || null,
    };
  }

  const reviewResultSha = parentShas?.[0] || null;
  if (
    reviewRevision?.headSha !== reviewResultSha
    || !Array.isArray(reviewRevision?.parentShas)
    || reviewRevision.parentShas.length !== 1
    || !isFullSha1(reviewRevision.parentShas[0])
  ) {
    errors.push('review-result revision must be the sole parent of schema 8');
  }
  const pendingAttestationSha = reviewRevision?.parentShas?.[0] || null;
  if (
    pendingRevision?.headSha !== pendingAttestationSha
    || !Array.isArray(pendingRevision?.parentShas)
    || pendingRevision.parentShas.length !== 1
    || !isFullSha1(pendingRevision.parentShas[0])
  ) {
    errors.push('pending revision must be the sole parent of the review result');
  }
  const candidateSha = pendingRevision?.parentShas?.[0] || null;
  const identities = [
    headSha,
    reviewResultSha,
    pendingAttestationSha,
    candidateSha,
  ];
  if (
    identities.some(identity => !isFullSha1(identity))
    || new Set(identities).size !== identities.length
  ) {
    errors.push('schema-8 C/E/R/A identities must be full and distinct');
  }
  return {
    schemaVersion: 1,
    valid: errors.length === 0,
    errors,
    candidateSha,
    pendingAttestationSha,
    reviewResultSha,
    approvedAttestationSha: headSha || null,
  };
}

export function loadGate0AttestationCommit(root, revision = 'HEAD') {
  const { headSha, parentShas } = readRevision(root, revision);
  const changedEntries = readChangedEntries(root, headSha);
  const evidenceIndex = JSON.parse(
    gitBuffer(
      ['show', `${headSha}:docs/convergence/EVIDENCE-INDEX.json`],
      root,
    ).toString('utf8'),
  );
  return {
    headSha,
    parentShas,
    changedEntries,
    evidenceIndex,
    outputArtifacts: Object.fromEntries(
      GATE0_BOUND_OUTPUTS.map(filePath => [
        filePath,
        gitBuffer(['show', `${headSha}:${filePath}`], root),
      ]),
    ),
    outputModes: Object.fromEntries(
      GATE0_ATTESTATION_OUTPUTS.map(filePath => [
        filePath,
        readMode(root, headSha, filePath),
      ]),
    ),
  };
}

export function loadGate0ReviewResultCommit(root, revision) {
  const { headSha, parentShas } = readRevision(root, revision);
  return {
    headSha,
    parentShas,
    changedEntries: readChangedEntries(root, headSha),
    resultBytes: gitBuffer(
      ['show', `${headSha}:${GATE0_REVIEW_RESULT_PATH}`],
      root,
    ),
    resultMode: readMode(root, headSha, GATE0_REVIEW_RESULT_PATH),
  };
}

export async function validateCommittedGate0PendingAttestation({
  root,
  pendingAttestationSha,
  worktreeHeadSha,
  approvedAttestation = null,
  reviewResultCommit = null,
}) {
  const pendingAttestation = loadGate0AttestationCommit(
    root,
    pendingAttestationSha,
  );
  const candidateSha = pendingAttestation.parentShas[0];
  if (
    pendingAttestation.parentShas.length !== 1
    || !isFullSha1(candidateSha)
  ) {
    return {
      report: invalidAttestationReport({
        headSha: pendingAttestation.headSha,
        candidateSha,
        errors: [
          'pending attestation must have exactly one full-SHA candidate parent',
        ],
      }),
      pendingAttestation,
      expectations: null,
    };
  }

  const candidateRegistry = JSON.parse(
    gitBuffer(
      ['show', `${candidateSha}:tests/registry.json`],
      root,
    ).toString('utf8'),
  );
  const expectedRegistrySha256 = sha256(
    Buffer.from(JSON.stringify(candidateRegistry)),
  );
  const expectedRegistryFacts = buildRegistryGateFacts(candidateRegistry);
  const candidateDispositionManifest = JSON.parse(
    gitBuffer(
      ['show', `${candidateSha}:${FINAL_DIFF_MANIFEST_PATH}`],
      root,
    ).toString('utf8'),
  );
  const revalidationInputScopes = buildGate0RevalidationInputScopes(
    candidateDispositionManifest,
  );
  const initialWorktreeClean = worktreeMatches(
    root,
    worktreeHeadSha,
  );
  const common = {
    ...pendingAttestation,
    expectedRegistrySha256,
    expectedRegistryFacts,
    revalidationInputScopes,
  };
  const preflight = validateGate0Attestation({
    ...common,
    expectedRegistryValidation:
      pendingAttestation.evidenceIndex.validations?.registry,
    expectedDispositionValidation:
      pendingAttestation.evidenceIndex.validations?.disposition,
    expectedRiskPolicy: pendingAttestation.evidenceIndex.riskPolicy,
    expectedPrivacyIncident:
      pendingAttestation.evidenceIndex.privacyIncident,
    worktreeClean: initialWorktreeClean,
  });
  if (!preflight.valid) {
    return {
      report: preflight,
      pendingAttestation,
      expectations: null,
    };
  }
  if (approvedAttestation !== null || reviewResultCommit !== null) {
    const approvedPreflight = validateGate0ApprovedAttestation({
      ...approvedAttestation,
      pendingAttestation,
      reviewResultCommit,
      expectedRegistrySha256,
      expectedRegistryFacts,
      expectedRegistryValidation:
        pendingAttestation.evidenceIndex.validations?.registry,
      expectedDispositionValidation:
        pendingAttestation.evidenceIndex.validations?.disposition,
      expectedRiskPolicy: pendingAttestation.evidenceIndex.riskPolicy,
      expectedPrivacyIncident:
        pendingAttestation.evidenceIndex.privacyIncident,
      revalidationInputScopes,
      worktreeClean: initialWorktreeClean,
    });
    if (!approvedPreflight.valid) {
      return {
        report: approvedPreflight,
        pendingAttestation,
        expectations: null,
      };
    }
  }

  const validatorEnvironment = environmentForExecution(
    buildGate0ExecutionPlan({
      root,
      candidateSha,
    })[2],
  );
  const [registryValidation, dispositionValidation] =
    await runWithOwnedProcessTerminationHandling(async () => {
      const registry = classifyRegistryValidatorExecution(
        await runValidator(
          ['node', 'scripts/validate-test-registry.js', '--json'],
          root,
          validatorEnvironment,
        ),
      );
      const disposition = classifyDispositionValidatorExecution(
        await runValidator(
          ['node', 'scripts/validate-final-disposition.js', '--json'],
          root,
          validatorEnvironment,
        ),
      );
      return [registry, disposition];
    });
  const expectations = {
    expectedRegistrySha256,
    expectedRegistryFacts,
    expectedRegistryValidation:
      projectRegistryValidation(registryValidation),
    expectedDispositionValidation:
      projectDispositionValidation(dispositionValidation),
    expectedRiskPolicy: buildGate0RiskEvidence({
      riskMarkdownBytes: gitBuffer(
        ['show', `${candidateSha}:${RISK_REGISTER_PATH}`],
        root,
      ),
      policyBytes: gitBuffer(
        ['show', `${candidateSha}:${RISK_POLICY_PATH}`],
        root,
      ),
    }),
    expectedPrivacyIncident: buildPrivacyIncidentEvidence(
      gitBuffer(
        ['show', `${candidateSha}:${PRIVACY_INCIDENT_PATH}`],
        root,
      ),
    ),
    revalidationInputScopes,
  };
  const report = validateGate0Attestation({
    ...common,
    ...expectations,
    worktreeClean: initialWorktreeClean
      && worktreeMatches(root, worktreeHeadSha),
  });
  return {
    report,
    pendingAttestation,
    expectations,
  };
}

export async function validateCurrentAttestation(root = process.cwd()) {
  const approvedAttestation = loadGate0AttestationCommit(root, 'HEAD');
  const schemaVersion = approvedAttestation.evidenceIndex?.schemaVersion;
  if (schemaVersion === 7) {
    const topology = resolveGate0AttestationChain({
      headSha: approvedAttestation.headSha,
      parentShas: approvedAttestation.parentShas,
      schemaVersion,
    });
    if (!topology.valid) {
      return invalidAttestationReport({
        headSha: approvedAttestation.headSha,
        candidateSha: topology.candidateSha,
        errors: topology.errors,
      });
    }
    const pending = await validateCommittedGate0PendingAttestation({
      root,
      pendingAttestationSha: approvedAttestation.headSha,
      worktreeHeadSha: approvedAttestation.headSha,
    });
    return pending.report;
  }
  if (schemaVersion !== 8) {
    return invalidAttestationReport({
      headSha: approvedAttestation.headSha,
      candidateSha: null,
      errors: [
        `unsupported Gate 0 evidence schema: ${String(schemaVersion)}`,
      ],
    });
  }

  if (
    approvedAttestation.parentShas.length !== 1
    || !isFullSha1(approvedAttestation.parentShas[0])
  ) {
    return invalidApprovedAttestationReport({
      approvedAttestation,
      errors: [
        'approved attestation must have exactly one full-SHA review parent',
      ],
    });
  }
  const reviewResultCommit = loadGate0ReviewResultCommit(
    root,
    approvedAttestation.parentShas[0],
  );
  if (
    reviewResultCommit.parentShas.length !== 1
    || !isFullSha1(reviewResultCommit.parentShas[0])
  ) {
    return invalidApprovedAttestationReport({
      approvedAttestation,
      reviewResultCommit,
      errors: [
        'review-result commit must have exactly one full-SHA pending parent',
      ],
    });
  }
  const pendingAttestation = loadGate0AttestationCommit(
    root,
    reviewResultCommit.parentShas[0],
  );
  const topology = resolveGate0AttestationChain({
    headSha: approvedAttestation.headSha,
    parentShas: approvedAttestation.parentShas,
    schemaVersion,
    reviewRevision: reviewResultCommit,
    pendingRevision: pendingAttestation,
  });
  if (!topology.valid) {
    return invalidApprovedAttestationReport({
      approvedAttestation,
      reviewResultCommit,
      pendingAttestation,
      errors: topology.errors,
    });
  }

  const pending = await validateCommittedGate0PendingAttestation({
    root,
    pendingAttestationSha: topology.pendingAttestationSha,
    worktreeHeadSha: topology.approvedAttestationSha,
    approvedAttestation,
    reviewResultCommit,
  });
  if (!pending.report.valid || pending.expectations === null) {
    if (pending.report.schemaVersion === 2) {
      return pending.report;
    }
    return invalidApprovedAttestationReport({
      approvedAttestation,
      reviewResultCommit,
      pendingAttestation,
      errors: pending.report.errors.map(
        error => `pending attestation: ${error}`,
      ),
    });
  }
  return validateGate0ApprovedAttestation({
    ...approvedAttestation,
    pendingAttestation,
    reviewResultCommit,
    ...pending.expectations,
    worktreeClean: worktreeMatches(
      root,
      topology.approvedAttestationSha,
    ),
  });
}

function readRevision(root, revision) {
  const values = git(
    ['rev-list', '--parents', '-n', '1', revision],
    root,
  ).split(' ').filter(Boolean);
  return {
    headSha: values.shift() || null,
    parentShas: values,
  };
}

function readChangedEntries(root, revision) {
  return git(
    [
      'diff-tree',
      '--no-commit-id',
      '--name-status',
      '--no-renames',
      '-r',
      revision,
    ],
    root,
  ).split('\n').filter(Boolean);
}

function readMode(root, revision, filePath) {
  const entry = git(
    ['ls-tree', revision, '--', filePath],
    root,
  );
  return entry === '' ? null : entry.split(/\s+/, 1)[0];
}

function worktreeMatches(root, expectedHeadSha) {
  return git(['rev-parse', 'HEAD'], root) === expectedHeadSha
    && git(
      ['status', '--porcelain=v1', '--untracked-files=all'],
      root,
    ) === '';
}

function invalidAttestationReport({
  headSha,
  candidateSha,
  errors,
}) {
  return {
    schemaVersion: 1,
    valid: false,
    errors,
    headSha: headSha || null,
    candidateSha: candidateSha || null,
    changedEntries: [],
  };
}

function invalidApprovedAttestationReport({
  approvedAttestation,
  reviewResultCommit = null,
  pendingAttestation = null,
  errors,
}) {
  return {
    schemaVersion: 2,
    valid: false,
    errors,
    headSha: approvedAttestation?.headSha || null,
    candidateSha:
      pendingAttestation?.evidenceIndex?.candidate?.sha || null,
    pendingAttestationSha: pendingAttestation?.headSha || null,
    reviewResultSha: reviewResultCommit?.headSha || null,
    changedEntries: approvedAttestation?.changedEntries || [],
  };
}

async function runValidator(argv, cwd, environment) {
  const result = await runLogged(argv, {
    cwd,
    env: environment,
    capture: true,
    allowFailure: true,
    timeoutMs: 5 * 60 * 1000,
  });
  return {
    status: result.exitCode,
    signal: result.signal,
    error: result.spawnError,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function gitBuffer(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') return Buffer.from(value);
  return null;
}

function validIsoTimestamp(value) {
  return typeof value === 'string'
    && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function isRecord(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value);
}

function isFullSha1(value) {
  return /^[a-f0-9]{40}$/.test(value || '');
}

function hasExactKeys(value, expectedKeys) {
  return isRecord(value)
    && isDeepStrictEqual(Object.keys(value).sort(), [...expectedKeys].sort());
}

function normalizeBoundaryPath(value) {
  if (
    typeof value !== 'string'
    || value === ''
    || value.includes('\\')
    || value.startsWith('/')
    || value.endsWith('/')
  ) {
    return null;
  }
  const segments = value.split('/');
  if (
    segments.some(segment => (
      segment === ''
      || segment === '.'
      || segment === '..'
      || segment.includes('\0')
    ))
  ) {
    return null;
  }
  return segments.join('/');
}

function validValidatorEvidence(value, expectedCommand) {
  if (
    !hasExactKeys(value, [
      'command',
      'exitCode',
      'outputSha256',
      'reportSha256',
      'errors',
      'report',
    ])
    || !isRecord(value.report)
  ) {
    return false;
  }
  const reportShapeValid = expectedCommand.includes('test-registry')
    ? hasExactKeys(value.report, [
      'schemaVersion',
      'valid',
      'runnablePrograms',
      'explicitSupportExclusions',
      'fingerprint',
      'document',
    ])
    : hasExactKeys(value.report, [
      'schemaVersion',
      'sourceRepository',
      'sourceRange',
      'sourceManifest',
      'repairedSubjectEvidence',
      'records',
      'dispositionCounts',
      'terminalCounts',
      'resolutionCounts',
      'pathsCount',
      'pathsSha256',
    ]);
  return reportShapeValid
    && value.command === expectedCommand
    && [0, 1].includes(value.exitCode)
    && /^[a-f0-9]{64}$/.test(value.outputSha256 || '')
    && /^[a-f0-9]{64}$/.test(value.reportSha256 || '')
    && Array.isArray(value.errors)
    && (value.exitCode === 0) === (value.errors.length === 0);
}

function validAuditOutcome(value) {
  if (!isRecord(value)) return false;
  const exitForVerdict = {
    PASS: 0,
    FAIL: 1,
    BLOCKED: 2,
  }[value.verdict];
  return typeof value.passed === 'boolean'
    && exitForVerdict !== undefined
    && value.exitCode === exitForVerdict
    && value.passed === (value.verdict === 'PASS')
    && /^[a-f0-9]{64}$/.test(value.reportSha256 || '')
    && /^[a-f0-9]{64}$/.test(value.inventorySha256 || '')
    && isRecord(value.execution);
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== '--json')) {
    console.error('Usage: node scripts/validate-gate0-attestation.js [--json]');
    return 2;
  }
  const report = await validateCurrentAttestation();
  if (argv[0] === '--json') {
    console.log(JSON.stringify(report));
  } else if (report.valid) {
    console.log(
      `Gate 0 attestation valid: ${report.headSha} attests ${report.candidateSha}; `
      + `${report.changedEntries.length} generated files only`,
    );
  } else {
    for (const error of report.errors) console.error(`ERROR: ${error}`);
  }
  return report.valid ? 0 : 1;
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 2;
  }
}
