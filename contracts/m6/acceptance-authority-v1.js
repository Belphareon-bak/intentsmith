import {
  SIGNED_AUTHORITY_DOMAIN,
} from '../authority/signed-authority-receipt-v1.js';
import {
  M5_PRIVACY_ROTATION_CATEGORIES,
} from '../m5/privacy-remediation-v1.js';

export const M6_ACCEPTANCE_PAYLOAD_VERSION = 1;

export const M6_ACCEPTANCE_RECEIPT_PATHS = Object.freeze({
  'm5-acceptance': 'docs/review/M5-FINAL-ACCEPTANCE-RESULT.json',
  'independent-read-only-review': 'docs/review/M6-INDEPENDENT-REVIEW-RESULT.json',
  'operator-demo-approval': 'docs/review/M6-OPERATOR-DEMO-RESULT.json',
  'gate0-attestation': 'docs/review/M6-GATE0-RESULT.json',
});

export const M5_SIGNED_PRIVACY_RECEIPT_PATHS = Object.freeze([
  ...M5_PRIVACY_ROTATION_CATEGORIES.map(category => (
    `docs/review/M5-PRIVACY-ROTATION-${category.categoryId}.json`
  )),
  'docs/review/M5-PRIVACY-HISTORY-RESULT.json',
]);

export const SIGNED_AUTHORITY_BUNDLE_PATHS = Object.freeze([
  ...M5_SIGNED_PRIVACY_RECEIPT_PATHS,
  ...Object.values(M6_ACCEPTANCE_RECEIPT_PATHS),
]);

export const M6_ACCEPTANCE_CHECK_DOMAIN = Object.freeze({
  'm5-acceptance': SIGNED_AUTHORITY_DOMAIN.M5_ACCEPTANCE,
  'independent-read-only-review': SIGNED_AUTHORITY_DOMAIN.M6_INDEPENDENT_REVIEW,
  'operator-demo-approval': SIGNED_AUTHORITY_DOMAIN.M6_OPERATOR_DEMO,
  'gate0-attestation': SIGNED_AUTHORITY_DOMAIN.M6_GATE0,
});

export const M6_ACCEPTANCE_DOMAIN_CHECK = Object.freeze(Object.fromEntries(
  Object.entries(M6_ACCEPTANCE_CHECK_DOMAIN).map(([checkId, domain]) => [domain, checkId]),
));

export const M6_ACCEPTANCE_PAYLOAD_CONTRACT = Object.freeze({
  M5: 'M5FinalAcceptanceEvidence',
  REVIEW: 'M6IndependentReviewEvidence',
  DEMO: 'M6OperatorDemoEvidence',
  GATE0: 'M6Gate0Evidence',
});

export const M6_OPERATOR_DEMO_STEPS = Object.freeze([
  'open-project',
  'resume-conversation',
  'deterministic-turn',
  'model-turn',
  'approve-change',
  'negative-effect',
  'specialist-agent',
  'learning',
  'model-discovery',
]);

export const M6_EXTERNAL_AUTHORITY_IDS = Object.freeze(
  Object.keys(M6_ACCEPTANCE_RECEIPT_PATHS),
);
