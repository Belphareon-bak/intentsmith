// Single role -> suite contract mapping for the upgrade prototype.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { codePatchSuite } from './code-patch-suite.js';
import {
  ROLE_QUALITY_VERSION,
  ROLE_SUITE_NAMES,
  getQualitySuiteForRole,
} from './role-quality-suites.js';
import { suiteContract } from '../upgrade/model-evaluation-history.js';
import { DEFAULT_REPEATS } from '../upgrade/pairwise-trial.js';

const CODE_FIXTURE_URL = new URL('./code-suite-tasks.json', import.meta.url);

function fileSha256(url) {
  return createHash('sha256').update(readFileSync(fileURLToPath(url))).digest('hex');
}

export function createRoleEvaluationPlans(opts = {}) {
  const repeats = opts.repeats ?? DEFAULT_REPEATS;
  const codeFixtureSha256 = opts.codeFixtureSha256 || fileSha256(CODE_FIXTURE_URL);
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
    plans[role] = Object.freeze({
      role,
      suiteName,
      suite,
      suiteVersion,
      suiteContractSha256: contract.sha256,
      repeats,
      taskCount: suite.tests.length,
      // CODE patch tasks are expensive and sparse. One lucky historical bug
      // is not enough evidence for an automatic binding change; the accepted
      // prototype target is six independently discriminating tasks.
      minimumTaskCount: role === 'CODE' ? 6 : 1,
      decisionReady: suite.tests.length >= (role === 'CODE' ? 6 : 1),
      // CHAT needs breadth in both supported languages. The former 1:1
      // decision rested on just two Czech tasks and is diagnostic evidence,
      // not enough authority for an automatic user-facing model change.
      minimumDiscriminatingTasks: role === 'CHAT' ? 7 : 0,
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

export default { createRoleEvaluationPlans, planForRole };
