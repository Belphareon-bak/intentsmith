export const M6_ACCEPTANCE_RECEIPT_CONTRACT = 'M6AcceptanceReceipt';
export const M6_ACCEPTANCE_RECEIPT_VERSION = 1;

export const M6_ACCEPTANCE_RECEIPT_PATHS = Object.freeze({
  'm5-acceptance': 'docs/review/M5-FINAL-ACCEPTANCE-RESULT.json',
  'independent-read-only-review': 'docs/review/M6-INDEPENDENT-REVIEW-RESULT.json',
  'operator-demo-approval': 'docs/review/M6-OPERATOR-DEMO-RESULT.json',
  'gate0-attestation': 'docs/review/M6-GATE0-RESULT.json',
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
