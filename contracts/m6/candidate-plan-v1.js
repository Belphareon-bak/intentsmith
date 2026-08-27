export const M6_CANDIDATE_PLAN_CONTRACT = 'M6CandidateExecutionPlan';
export const M6_CANDIDATE_PLAN_VERSION = 3;

export const M6_DIRECT_FRESH_CLONE_PROGRAMS = Object.freeze([
  'IS-T5-TESTS-M1-JOURNEY-TEST',
  'IS-T5-TESTS-M6-PREVIOUS-VERSION-UPGRADE-E2E',
  'IS-T5-TESTS-STUDIO-ELECTRON-BOUNDARY-E2E',
  'IS-T5-TESTS-STUDIO-M1-ELECTRON-JOURNEY-E2E',
]);

export const M6_DIRECT_OWNED_SERVER_PROGRAMS = Object.freeze([
  'IS-T1-TESTS-M5-GLOBAL-AUTH-TEST',
]);

export const M6_PHYSICAL_GPU_PROGRAMS = Object.freeze([
  'IS-T3-TESTS-M1-MODEL-GPU-PILOT-TEST',
]);

export const M6_CANDIDATE_PHASE_IDS = Object.freeze([
  'deterministic-offline-database',
  'owned-production-server',
  'model-and-server',
  'controlled-soak',
  'fresh-clone-install-build-studio',
  'physical-ollama-gpu',
]);
