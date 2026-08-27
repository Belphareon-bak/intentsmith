import './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';

import {
  M6_ACCEPTANCE_RECEIPT_CONTRACT,
  M6_OPERATOR_DEMO_STEPS,
} from '../contracts/m6/acceptance-authority-v1.js';
import {
  applyM6AcceptanceReceipts,
  validateM6AcceptanceReceipt,
} from '../src/release/m6-acceptance-authority.js';
import { suite, summary, test } from './harness.js';

const candidateSha = 'a'.repeat(40);
const registryFingerprint = 'b'.repeat(64);
const artifacts = {
  m5: { path: 'docs/review/m5.json', bytes: 1, sha256: '1'.repeat(64) },
  review: { path: 'docs/review/m6-review.json', bytes: 1, sha256: '2'.repeat(64) },
  demo: { path: 'docs/review/m6-demo.json', bytes: 1, sha256: '3'.repeat(64) },
  gate0: { path: 'docs/review/m6-gate0.json', bytes: 1, sha256: '4'.repeat(64) },
};

function receipt(authorityId) {
  const details = {
    'm5-acceptance': {
      reviewSectionsPassed: 9,
      rotationsCompleted: 8,
      historyDisposition: 'rewrite_and_rotate',
      openCriticalHigh: 0,
      technicalReviewVerdict: 'REVIEW_PASSED',
      operatorRemediation: 'COMPLETE',
    },
    'independent-read-only-review': {
      sectionsReviewed: 8,
      blockingFindings: 0,
      verdict: 'REVIEW_PASSED',
    },
    'operator-demo-approval': {
      stepsPassed: [...M6_OPERATOR_DEMO_STEPS],
      verdict: 'APPROVED',
    },
    'gate0-attestation': {
      chain: 'C-E-R-A',
      candidateEvidenceVerdict: 'PASS',
      reviewArtifactSha256: artifacts.review.sha256,
      approvalArtifactSha256: artifacts.demo.sha256,
      verdict: 'APPROVED',
    },
  }[authorityId];
  const artifact = {
    'm5-acceptance': artifacts.m5,
    'independent-read-only-review': artifacts.review,
    'operator-demo-approval': artifacts.demo,
    'gate0-attestation': artifacts.gate0,
  }[authorityId];
  return {
    contract: M6_ACCEPTANCE_RECEIPT_CONTRACT,
    version: 1,
    authorityId,
    candidateSha,
    registryFingerprint,
    recordedAt: '2026-08-27T00:00:00.000Z',
    source: 'operator-provided',
    actor: { actorType: 'user', actorId: 'operator:belphareon' },
    decision: 'PASS',
    details,
    artifacts: [{ ...artifact }],
  };
}

function releaseEvidence() {
  return {
    candidateSha,
    registryFingerprint,
    checks: [
      'm5-acceptance',
      'independent-read-only-review',
      'operator-demo-approval',
      'gate0-attestation',
    ].map(id => ({ id, status: 'BLOCKED', reasonCode: 'PENDING', artifacts: [] })),
  };
}

suite('M6 external acceptance authority');

test('exact user receipts promote all external authority rows', () => {
  const receipts = [
    receipt('m5-acceptance'),
    receipt('independent-read-only-review'),
    receipt('operator-demo-approval'),
    receipt('gate0-attestation'),
  ];
  assert(receipts.every(item => validateM6AcceptanceReceipt(item, {
    candidateSha,
    registryFingerprint,
  }).valid));
  const result = applyM6AcceptanceReceipts(releaseEvidence(), receipts);
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert(result.evidence.checks.every(row => row.status === 'PASS'));
  assert.equal(Object.isFrozen(result), true);
});

test('agent, self-asserted source, wrong candidate or partial M5 remediation is rejected', () => {
  for (const mutate of [
    value => { value.actor.actorType = 'agent'; },
    value => { value.source = 'self-asserted'; },
    value => { value.candidateSha = 'c'.repeat(40); },
    value => { value.details.rotationsCompleted = 7; },
    value => { value.details.openCriticalHigh = 1; },
  ]) {
    const value = receipt('m5-acceptance');
    mutate(value);
    assert.equal(validateM6AcceptanceReceipt(value, {
      candidateSha,
      registryFingerprint,
    }).valid, false);
  }
});

test('review with blocker and incomplete operator journey cannot pass', () => {
  const review = receipt('independent-read-only-review');
  review.details.blockingFindings = 1;
  assert.equal(validateM6AcceptanceReceipt(review, {
    candidateSha,
    registryFingerprint,
  }).valid, false);
  const demo = receipt('operator-demo-approval');
  demo.details.stepsPassed.pop();
  assert.equal(validateM6AcceptanceReceipt(demo, {
    candidateSha,
    registryFingerprint,
  }).valid, false);
});

test('Gate 0 C-E-R-A approval must bind exact independent review and demo artifacts', () => {
  const receipts = [
    receipt('independent-read-only-review'),
    receipt('operator-demo-approval'),
    receipt('gate0-attestation'),
  ];
  assert.equal(applyM6AcceptanceReceipts(releaseEvidence(), receipts).valid, true);
  receipts[2].details.reviewArtifactSha256 = '9'.repeat(64);
  const invalid = applyM6AcceptanceReceipts(releaseEvidence(), receipts);
  assert.equal(invalid.valid, false);
  assert(invalid.errors.includes('gate0:review-receipt-binding'));
});

test('duplicate receipts and unknown release rows fail closed', () => {
  const duplicate = receipt('m5-acceptance');
  assert.equal(applyM6AcceptanceReceipts(
    releaseEvidence(),
    [duplicate, structuredClone(duplicate)],
  ).valid, false);
  const evidence = releaseEvidence();
  evidence.checks = evidence.checks.filter(row => row.id !== 'm5-acceptance');
  assert.equal(applyM6AcceptanceReceipts(evidence, [duplicate]).valid, false);
});

summary();
