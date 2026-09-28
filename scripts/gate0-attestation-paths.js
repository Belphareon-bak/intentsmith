import { GATE0_REVIEW_PACKET_PATH } from './gate0-review-contract.js';

export const GATE0_EVIDENCE_INDEX_PATH =
  'docs/convergence/EVIDENCE-INDEX.json';
export const GATE0_BASELINE_REPORT_PATH =
  'docs/convergence/GATE0-BASELINE-REPORT.md';
export const GATE0_STATUS_PATH =
  'docs/convergence/STATUS.md';
export const GATE0_ATTESTATION_OUTPUTS = Object.freeze([
  GATE0_EVIDENCE_INDEX_PATH,
  GATE0_BASELINE_REPORT_PATH,
  GATE0_STATUS_PATH,
  GATE0_REVIEW_PACKET_PATH,
]);
export const GATE0_BOUND_OUTPUTS = Object.freeze(
  GATE0_ATTESTATION_OUTPUTS.filter(
    filePath => filePath !== GATE0_EVIDENCE_INDEX_PATH,
  ),
);
