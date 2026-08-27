export const M6_TECHNICAL_EVIDENCE_CONTRACT = 'M6TechnicalEvidenceMatrix';
export const M6_TECHNICAL_EVIDENCE_VERSION = 2;

export const M6_TECHNICAL_PROGRAMS = Object.freeze({
  'fresh-clone-install-build': Object.freeze([
    'IS-T5-TESTS-M1-JOURNEY-TEST',
  ]),
  'server-ws-studio-journey': Object.freeze([
    'IS-T5-TESTS-M1-JOURNEY-TEST',
    'IS-T5-TESTS-STUDIO-M1-ELECTRON-JOURNEY-E2E',
    'IS-T1-TESTS-M5-GLOBAL-AUTH-TEST',
    'IS-T1-TESTS-WS-BRIDGE-TEST',
  ]),
  'ollama-gpu-roles': Object.freeze([
    'IS-T5-TESTS-M1-JOURNEY-TEST',
    'IS-T3-TESTS-M1-MODEL-GPU-PILOT-TEST',
    'IS-T1-TESTS-M1-VRAM-ARTIFACT-USE-TEST',
    'IS-T3-TESTS-VRAM-COORDINATION-TEST',
    'IS-T1-TESTS-VRAM-MEASUREMENT-TEST',
  ]),
  'effect-approval-security-data-recovery': Object.freeze([
    'IS-T1-TESTS-M2-EFFECT-AUTHORITY-REPOSITORY-TEST',
    'IS-T1-TESTS-M2-EFFECT-BROKER-V1-TEST',
    'IS-T1-TESTS-M2-EFFECT-FILE-RUNTIME-TEST',
    'IS-T1-TESTS-M2-LIFECYCLE-APPLICATION-SERVICE-TEST',
    'IS-T1-TESTS-M5-DATA-RESTORE-TEST',
    'IS-T1-TESTS-M5-GLOBAL-AUTH-TEST',
    'IS-T1-TESTS-M5-OUTBOUND-POLICY-TEST',
    'IS-T1-TESTS-M5-PROCESS-HARDENING-TEST',
    'IS-T1-TESTS-M5-PRIVACY-REMEDIATION-TEST',
  ]),
  'specialist-agent-learning': Object.freeze([
    'IS-T1-TESTS-M3-CODE-REVIEW-SPECIALIST-TEST',
    'IS-T1-TESTS-M3-PROJECT-HEALTH-AGENT-TEST',
    'IS-T3-TESTS-M4-LEARNING-JOURNEY-E2E-TEST',
    'IS-T1-TESTS-M6-PLATFORM-JOURNEY-TEST',
  ]),
  'remote-core-port': Object.freeze([
    'IS-T1-TESTS-M2-REMOTE-CORE-PORT-CONTRACT-V1-TEST',
    'IS-T1-TESTS-M2-REMOTE-CORE-PORT-BOUNDARY-TEST',
    'IS-T1-TESTS-M5-REMOTE-CORE-ADAPTER-TEST',
    'IS-T1-TESTS-M6-PLATFORM-JOURNEY-TEST',
  ]),
  'conditional-surfaces': Object.freeze([
    'IS-T1-TESTS-M5-CONDITIONAL-SURFACES-TEST',
    'IS-T1-TESTS-M5-OUTBOUND-POLICY-TEST',
    'IS-T1-TESTS-M6-MODEL-DISCOVERY-JOURNEY-TEST',
  ]),
  'upgrade-backup-restore': Object.freeze([
    'IS-T1-TESTS-UPGRADE-APPLY-TEST',
    'IS-T1-TESTS-UPGRADE-FLOW-TEST',
    'IS-T1-TESTS-UPGRADE-UX-V125-TEST',
    'IS-T1-TESTS-M5-DATA-RESTORE-TEST',
  ]),
});

export const M6_DYNAMIC_TECHNICAL_CHECKS = Object.freeze({
  'all-active-required-programs': Object.freeze({
    profiles: Object.freeze(['offline', 'database', 'model', 'server', 'soak']),
  }),
  'deterministic-offline-database': Object.freeze({
    profiles: Object.freeze(['offline', 'database']),
  }),
  'soak-nightly-resources': Object.freeze({
    profiles: Object.freeze(['soak']),
  }),
});

export const M6_EXTERNAL_AUTHORITY_CHECKS = Object.freeze([
  'm5-acceptance',
  'gate0-attestation',
  'independent-read-only-review',
  'release-artifact',
  'operator-demo-approval',
]);
