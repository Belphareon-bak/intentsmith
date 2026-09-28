export const M6_L0_EVIDENCE_CONTRACT = 'M6L0EvidenceMatrix';
export const M6_L0_EVIDENCE_VERSION = 3;

export const M6_L0_SEMANTIC_STATE = Object.freeze({
  VERIFIED: 'VERIFIED',
  UNVERIFIED: 'UNVERIFIED',
  PARTIAL: 'PARTIAL',
  OPEN_VIOLATION: 'OPEN_VIOLATION',
});

// A passing program set is necessary but is not, by itself, authority to call
// an invariant verified. These states mirror the product truth in SYSTEM-MAP;
// release evidence must fail closed while a semantic gap remains open.
export const M6_L0_SEMANTIC_AUTHORITY = Object.freeze({
  'L0-1': Object.freeze({ state: 'VERIFIED', reasonCode: null }),
  'L0-2': Object.freeze({ state: 'VERIFIED', reasonCode: null }),
  'L0-3': Object.freeze({ state: 'VERIFIED', reasonCode: null }),
  'L0-4': Object.freeze({ state: 'VERIFIED', reasonCode: null }),
  'L0-5': Object.freeze({ state: 'VERIFIED', reasonCode: null }),
  'L0-6': Object.freeze({ state: 'VERIFIED', reasonCode: null }),
  'L0-7': Object.freeze({ state: 'VERIFIED', reasonCode: null }),
  'L0-8': Object.freeze({ state: 'VERIFIED', reasonCode: null }),
  'L0-9': Object.freeze({ state: 'VERIFIED', reasonCode: null }),
  'L0-10': Object.freeze({ state: 'VERIFIED', reasonCode: null }),
  'L0-11': Object.freeze({
    state: 'OPEN_VIOLATION',
    reasonCode: 'M5_PRIVACY_SAME_PROCESS_AUTHORITY_OPEN',
  }),
  'L0-12': Object.freeze({
    state: 'PARTIAL',
    reasonCode: 'M6_L0_12_LONG_HORIZON_NOT_RUN',
  }),
  'L0-13': Object.freeze({ state: 'VERIFIED', reasonCode: null }),
});

export const M6_L0_EVIDENCE_PROGRAMS = Object.freeze({
  'L0-1': Object.freeze(['IS-T1-TESTS-CRE-GATEKEEPER-TEST']),
  'L0-2': Object.freeze(['IS-T1-TESTS-MERGE-ENGINE-TEST']),
  'L0-3': Object.freeze(['IS-T1-TESTS-CAPABILITY-ENFORCER-TEST']),
  'L0-4': Object.freeze([
    'IS-T1-TESTS-CAPABILITY-ENFORCER-TEST',
    'IS-T1-TESTS-EXPERTISE-WIZARD-TEST',
  ]),
  'L0-5': Object.freeze(['IS-T1-TESTS-QUALITY-GATE-TEST']),
  'L0-6': Object.freeze(['IS-T1-TESTS-PATCH-ENGINE-TEST']),
  'L0-7': Object.freeze(['IS-T1-TESTS-EXECUTION-LOOP-TEST']),
  'L0-8': Object.freeze(['IS-T1-TESTS-SPECIALIST-BOUNDARY-RATCHET-TEST']),
  'L0-9': Object.freeze([
    'IS-T1-TESTS-MODEL-UPGRADE-TEST',
    'IS-T1-TESTS-M6-MODEL-DISCOVERY-JOURNEY-TEST',
  ]),
  'L0-10': Object.freeze([
    'IS-T1-TESTS-WS-BRIDGE-TEST',
    'IS-T1-TESTS-M5-GLOBAL-AUTH-TEST',
  ]),
  'L0-11': Object.freeze([
    'IS-T1-TESTS-M1-MODEL-USE-AUTHORITY-TEST',
    'IS-T1-TESTS-M1-VRAM-ARTIFACT-USE-TEST',
    'IS-T1-TESTS-M1-MODEL-BINDING-APPLICATION-TEST',
    'IS-T1-TESTS-M6-MODEL-ARTIFACT-AUTHORITY-TEST',
  ]),
  'L0-12': Object.freeze([
    'IS-T1-TESTS-M5-OUTBOUND-POLICY-TEST',
    'IS-T1-TESTS-M6-MODEL-DISCOVERY-JOURNEY-TEST',
  ]),
  'L0-13': Object.freeze([
    'IS-T3-TESTS-M4-LEARNING-JOURNEY-E2E-TEST',
    'IS-T1-TESTS-M6-PLATFORM-JOURNEY-TEST',
  ]),
});
