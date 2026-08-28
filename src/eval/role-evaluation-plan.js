// Single role -> suite contract mapping for the upgrade prototype.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { codePatchRuntimeAvailability, codePatchSuite } from './code-patch-suite.js';
import {
  ROLE_QUALITY_VERSION,
  ROLE_SUITE_NAMES,
  getQualitySuiteForRole,
} from './role-quality-suites.js';
import { suiteContract } from '../upgrade/model-evaluation-history.js';
import { DEFAULT_REPEATS } from '../upgrade/pairwise-trial.js';
import { applicabilityContractForRole } from './model-evaluation-applicability.js';

export {
  MODEL_EVALUATION_APPLICABILITY_VERSION,
  applicabilityContractForRole,
  checkModelEvaluationApplicability,
} from './model-evaluation-applicability.js';

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
  VISION: 5,
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

export function createRoleEvaluationPlans(opts = {}) {
  const repeats = opts.repeats ?? DEFAULT_REPEATS;
  const codeFixtureSha256 = opts.codeFixtureSha256 || fileSha256(CODE_FIXTURE_URL);
  const codeRuntime = opts.codeRuntimeAvailability || codePatchRuntimeAvailability();
  const plans = {};
  for (const [role, suiteName] of Object.entries(ROLE_SUITE_NAMES)) {
    const suite = getQualitySuiteForRole(role);
    const suiteVersion = suiteName === 'code_patch'
      ? `code-patch-${ROLE_QUALITY_VERSION}`
      : (suite.version || ROLE_QUALITY_VERSION);
    const contract = suiteContract(suite, {
      version: suiteVersion,
      repeats,
      extra: suiteName === 'code_patch' ? { codeFixtureSha256 } : null,
    });
    const minimumTaskCount = MINIMUM_ROLE_TASK_COUNTS[role];
    const minimumDiscriminatingTasks = MINIMUM_ROLE_DISCRIMINATION[role];
    if (!Number.isInteger(minimumTaskCount) || minimumTaskCount < 1
      || !Number.isInteger(minimumDiscriminatingTasks)
      || minimumDiscriminatingTasks < 1) {
      throw new Error(`missing fail-closed evaluation floors for role ${role}`);
    }
    plans[role] = Object.freeze({
      role,
      suiteName,
      suite,
      suiteVersion,
      suiteContractSha256: contract.sha256,
      applicabilityContract: applicabilityContractForRole(role),
      repeats,
      taskCount: suite.tests.length,
      minimumTaskCount,
      decisionReady: suite.tests.length >= minimumTaskCount
        && (role !== 'CODE' || codeRuntime.ready),
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
