// Single role -> suite contract mapping for the upgrade prototype.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SEMANTIC_ROLE_SUITES } from './semantic-role-suites.js';
import { collectionSuite } from './role-collection-profile.js';
import { codePatchRuntimeAvailability, codePatchSuite } from './code-patch-suite.js';
import {
  ROLE_QUALITY_VERSION,
  ROLE_SUITE_NAMES,
  getQualitySuiteForRole,
} from './role-quality-suites.js';
import { suiteContract } from '../upgrade/model-evaluation-history.js';
import { DEFAULT_REPEATS } from '../upgrade/pairwise-trial.js';
import { ModelEvaluationAcceptanceStore, qualificationRuntimeSha256 } from '../upgrade/model-evaluation-acceptance.js';
import { applicabilityContractForRole } from './model-evaluation-applicability.js';

export {
  MODEL_EVALUATION_APPLICABILITY_VERSION,
  applicabilityContractForRole,
  checkModelEvaluationApplicability,
} from './model-evaluation-applicability.js';

// One locked exploratory context for placement and inference on every role.
// Qualification for the larger interactive production profile is separate.
export const HUNT_EVALUATION_NUM_CTX = 16384;

const CODE_FIXTURE_URL = new URL('./code-suite-tasks.json', import.meta.url);

// A role is not decision-capable merely because its suite is non-empty. These
// floors are part of the current authority contract: accidental task loss must
// block a hunt before a model is pulled or placed in VRAM.
export const MINIMUM_ROLE_TASK_COUNTS = Object.freeze({
  D1: 8,
  D2: 8,
  R1: 8,
  CODE: 6,
  R2: 6,
  CHAT: 40,
  VISION: 13,
});

// A replacement needs a trend, not one lucky task. CHAT keeps stronger
// language-specific breadth because it is the user-facing bilingual role.
export const MINIMUM_ROLE_DISCRIMINATION = Object.freeze({
  D1: 3,
  D2: 3,
  R1: 3,
  CODE: 2,
  R2: 3,
  CHAT: 7,
  VISION: 2,
});

export const ROLE_IMPROVEMENT_THRESHOLDS = Object.freeze({
  D1: 0.06,
  D2: 0.05,
  CODE: 0.05,
  R1: 0.06,
  R2: 0.05,
  CHAT: 0.04,
  VISION: 0.05,
});

function fileSha256(url) {
  return createHash('sha256').update(readFileSync(fileURLToPath(url))).digest('hex');
}

// grade.toString() does not include the helper that applies and tests a patch.
// Cache reuse must change when that grading implementation or its installed
// dependency contract changes. Reads fail closed; never reuse a name-only or
// unknown-source grade. The reader argument is only a deterministic test seam;
// production plans always read these fixed local files with the default reader.
export function codeGradingRuntimeContract(readSource = readFileSync) {
  const files = [
    './code-patch-suite.js', './code-patch-runner.js', './code-contract-check.mjs', './code-technical-projection.js', './function-span.js',
    './code-task-extractor.js', './build-code-suite.js', './model-evaluation-runner.js', './role-collection-profile.js', './conversation-capture.js',
    '../../package-lock.json',
  ];
  return Object.freeze({
    version: 1, nodeVersion: process.version,
    sources: Object.freeze(Object.fromEntries(files.map(relative => [relative,
      createHash('sha256').update(readSource(new URL(relative, import.meta.url))).digest('hex')]))),
  });
}

export function textGradingRuntimeContract(readSource = readFileSync) {
  const files = ['./role-quality-suites.js', './model-evaluation-runner.js',
    './runtime-json.js', './structured-answer.js', '../llm/client.js',
    './fixtures/vision/manifest.json', './semantic-role-suites.js', './semantic-evaluation-judge.js',
    './fixtures/role-semantic-tasks.json', './role-collection-profile.js', './conversation-capture.js', './model-answer-collection.js',
    './grade-answer-collection.js', './semantic-grader-acceptance.js'];
  return Object.freeze({
    version: 1, nodeVersion: process.version,
    sources: Object.freeze(Object.fromEntries(files.map(relative => [relative,
      createHash('sha256').update(readSource(new URL(relative, import.meta.url))).digest('hex')]))),
  });
}

export function createRoleEvaluationPlans(opts = {}) {
  const repeats = opts.repeats ?? DEFAULT_REPEATS;
  const codeFixtureSha256 = opts.codeFixtureSha256 || fileSha256(CODE_FIXTURE_URL);
  const codeGradingRuntime = codeGradingRuntimeContract();
  const textGradingRuntime = textGradingRuntimeContract();
  const codeRuntime = opts.codeRuntimeAvailability || codePatchRuntimeAvailability();
  const acceptanceStore = new ModelEvaluationAcceptanceStore(opts.db || null);
  let runtimeSha256 = null;
  try { runtimeSha256 = qualificationRuntimeSha256(); } catch { /* unavailable source cannot authorize decisions */ }
  const plans = {};
  for (const role of Object.keys(ROLE_SUITE_NAMES)) {
    const collectionOnly = Boolean(SEMANTIC_ROLE_SUITES[role]);
    const profile = collectionSuite(role, SEMANTIC_ROLE_SUITES[role] || getQualitySuiteForRole(role));
    const suite = { ...profile, tests: profile.tests.map(t => ({ ...t, options: { ...t.options, num_ctx: HUNT_EVALUATION_NUM_CTX } })) };
    const suiteName = suite.name;
    const suiteVersion = suiteName === 'code_patch'
      ? `code-patch-${ROLE_QUALITY_VERSION}`
      : (suite.version || ROLE_QUALITY_VERSION);
    const contract = suiteContract(suite, {
      version: suiteVersion,
      repeats,
      extra: suiteName === 'code_patch' ? { codeFixtureSha256, codeGradingRuntime } : { textGradingRuntime },
    });
    const minimumTaskCount = MINIMUM_ROLE_TASK_COUNTS[role];
    const minimumDiscriminatingTasks = MINIMUM_ROLE_DISCRIMINATION[role];
    if (!Number.isInteger(minimumTaskCount) || minimumTaskCount < 1
      || !Number.isInteger(minimumDiscriminatingTasks)
      || minimumDiscriminatingTasks < 1) {
      throw new Error(`missing fail-closed evaluation floors for role ${role}`);
    }
    const acceptanceIdentity = { role, suiteContractSha256:contract.sha256,
      taskNames:suite.tests.map(task => task.name), runtimeSha256 };
    plans[role] = Object.freeze({
      role,
      suiteName,
      suite,
      suiteVersion,
      suiteContractSha256: contract.sha256,
      applicabilityContract: applicabilityContractForRole(role),
      repeats,
      collectionOnly,
      numCtx: HUNT_EVALUATION_NUM_CTX,
      taskCount: suite.tests.length,
      minimumTaskCount,
      measurementReady: suite.tests.length >= minimumTaskCount
        && (role !== 'VISION' || new Set(suite.tests.flatMap(t => t.contractMaterial?.prompt?.imageDigests || [])).size >= 10)
        && (role !== 'CODE' || codeRuntime.ready),
      // Read durable evidence at use time: revocation must affect an already
      // constructed plan, including the final retention recheck under its lock.
      qualificationRuntimeSha256: runtimeSha256,
      get acceptance() { return acceptanceStore.resolve(acceptanceIdentity); },
      get decisionReady() { return this.measurementReady && this.acceptance.ready; },
      get evidencePurpose() { return this.decisionReady ? 'QUALIFIED_PAIR_ONLY' : collectionOnly ? 'COLLECTION_FOR_REVIEW' : 'EXPLORATORY'; },
      get decisionBlockCode() { return this.decisionReady ? null : this.acceptance.code || 'EVALUATION_PROFILE_NOT_ACCEPTED'; },
      get decisionBlockReason() {
        return this.decisionReady ? null : 'Sada nemá ověřitelnou přejímku hodnotitele a odděleného párového provozního měření pro tento kontrakt. Výsledky jsou průzkumné.';
      },
      qualificationForRuns(runIds) { return this.decisionReady ? acceptanceStore.forRuns(this, runIds) : null; },
      runtimeBlockCode: role === 'CODE' ? codeRuntime.code : null,
      runtimeBlockReason: role === 'CODE' ? codeRuntime.reason : null,
      // CHAT needs breadth in both supported languages. The former 1:1
      // decision rested on just two Czech tasks and is diagnostic evidence,
      // not enough authority for an automatic user-facing model change.
      minimumDiscriminatingTasks,
      minimumDiscriminatingByLanguage: role === 'CHAT'
        ? Object.freeze({ en: 3, cs: 4 })
        : Object.freeze({}),
    });
  }
  return Object.freeze(plans);
}

export function planForRole(role, opts = {}) {
  return createRoleEvaluationPlans(opts)[String(role || '').toUpperCase()] || null;
}

export { codePatchSuite };

export default {
  MINIMUM_ROLE_TASK_COUNTS,
  MINIMUM_ROLE_DISCRIMINATION,
  ROLE_IMPROVEMENT_THRESHOLDS,
  createRoleEvaluationPlans,
  planForRole,
};
