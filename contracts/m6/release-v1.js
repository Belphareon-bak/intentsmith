export const M6_RELEASE_EVIDENCE_CONTRACT = 'M6ReleaseEvidence';
export const M6_RELEASE_EVIDENCE_VERSION = 1;

export const M6_RELEASE_STATUS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  BLOCKED: 'BLOCKED',
  NOT_RUN: 'NOT_RUN',
});

export const M6_REQUIRED_CHECK_IDS = Object.freeze([
  'm5-acceptance',
  'fresh-clone-install-build',
  'deterministic-offline-database',
  'server-ws-studio-journey',
  'ollama-gpu-roles',
  'effect-approval-security-data-recovery',
  'specialist-agent-learning',
  'remote-core-port',
  'conditional-surfaces',
  'upgrade-backup-restore',
  'soak-nightly-resources',
  'gate0-attestation',
  'independent-read-only-review',
  'release-artifact',
  'operator-demo-approval',
]);

export const M6_L0_IDS = Object.freeze(
  Array.from({ length: 13 }, (_, index) => `L0-${index + 1}`),
);

export const M6_RELEASE_VERDICT = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  BLOCKED: 'BLOCKED',
});

