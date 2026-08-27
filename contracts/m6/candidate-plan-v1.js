export const M6_CANDIDATE_PLAN_CONTRACT = 'M6CandidateExecutionPlan';
export const M6_CANDIDATE_PLAN_VERSION = 6;

export const M6_DIRECT_FRESH_CLONE_PROGRAMS = Object.freeze([
  'IS-T5-TESTS-M1-JOURNEY-TEST',
  'IS-T5-TESTS-M6-PREVIOUS-VERSION-UPGRADE-E2E',
  'IS-T5-TESTS-STUDIO-ELECTRON-BOUNDARY-E2E',
  'IS-T5-TESTS-STUDIO-M1-ELECTRON-JOURNEY-E2E',
]);

export const M6_DIRECT_OWNED_SERVER_PROGRAMS = Object.freeze([
  'IS-T1-TESTS-M5-GLOBAL-AUTH-TEST',
]);

// These historical journeys consume an already-running local C3 server. They
// cannot be delegated to nightly-audit: that runner deliberately treats
// `requirements.server` as a hard blocker and never mints a server authority.
// M6 therefore runs this exact frozen set through a dedicated, serial,
// runner-owned server fixture.
export const M6_RUNNER_OWNED_SERVER_PROGRAMS = Object.freeze([
  'IS-T3-TESTS-ATTACHMENTS-PROJECTS-TEST',
  'IS-T3-TESTS-E2E-SPECIALISTS-TEST',
  'IS-T3-TESTS-M2-LIFECYCLE-HTTP-E2E-TEST',
  'IS-T3-TESTS-TOOL-PIPELINE-E2E-TEST',
  'IS-T3-E2E-64-M3-PROJECT-HEALTH-AGENT',
  'IS-T3-E2E-83-M3-EXPERTISE-EXTENSION',
  'IS-T3-E2E-84-M3-CODE-REVIEW-SPECIALIST',
  'IS-T3-TESTS-PROJECT-E2E-TEST',
  'IS-T3-TESTS-TIMEOUT-DIAGNOSTIC-TEST',
]);

export const M6_PHYSICAL_GPU_PROGRAMS = Object.freeze([
  'IS-T3-TESTS-M1-MODEL-GPU-PILOT-TEST',
]);

export const M6_CANDIDATE_PHASE_IDS = Object.freeze([
  'deterministic-offline-database',
  'owned-production-server',
  'model-without-server',
  'runner-owned-server-programs',
  'fresh-clone-install-build-studio',
  'physical-ollama-gpu',
  'controlled-soak',
]);

export const M6_CANDIDATE_PHASE_LIMITS = Object.freeze({
  'deterministic-offline-database': Object.freeze({
    timeoutMinutes: 60,
    deadlineHours: 8,
  }),
  'owned-production-server': Object.freeze({ timeoutMinutes: 60, deadlineHours: 8 }),
  'model-without-server': Object.freeze({ timeoutMinutes: 60, deadlineHours: 8 }),
  'runner-owned-server-programs': Object.freeze({ timeoutMinutes: 60, deadlineHours: 8 }),
  'controlled-soak': Object.freeze({ timeoutMinutes: 1_500, deadlineHours: 30 }),
  'fresh-clone-install-build-studio': Object.freeze({ timeoutMinutes: 60, deadlineHours: 8 }),
  'physical-ollama-gpu': Object.freeze({ timeoutMinutes: 60, deadlineHours: 8 }),
});
