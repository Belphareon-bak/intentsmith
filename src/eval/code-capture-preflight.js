// Capture eligibility is separate from acceptance of the final CODE oracle.
// Executable controls test fixture/harness integrity; semantic controls may
// still block grading and every model decision after raw answers are saved.
import { fileURLToPath } from 'node:url';
import { verifyExecutableTask } from './code-technical-replay.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export function inspectCodeCaptureSuite(suite, { repo = REPO_ROOT, verify = verifyExecutableTask } = {}) {
  const tests = suite?.tests;
  if (!Array.isArray(tests) || tests.length === 0) {
    return { ready: false, checked: 0, code: 'CODE_CAPTURE_FIXTURE_UNAVAILABLE', failures: [] };
  }
  const controls = [], failures = [];
  for (const test of tests) {
    try {
      if (typeof test.prepare !== 'function') throw new Error('CODE_CAPTURE_TASK_NOT_PREPARABLE');
      const prepared = test.prepare();
      const result = verify(repo, prepared);
      const row = { test: test.name, status: result.status,
        controls: (result.controls || []).map(control => ({ name: control.name, ok: control.ok,
          expectedTechnicalScore: control.expectedTechnicalScore,
          observedTechnicalScore: control.result?.technical?.score ?? null })) };
      controls.push(row);
      if (result.status !== 'COMPONENT_CONTROLS_PASS' || row.controls.some(control => !control.ok))
        failures.push({ test: test.name, reason: result.status });
    } catch (error) {
      failures.push({ test: test.name, reason: error.message || String(error) });
    }
  }
  return { ready: failures.length === 0, checked: tests.length,
    code: failures.length ? 'CODE_CAPTURE_FIXTURE_UNAVAILABLE' : null,
    controls, failures, fullOracleAccepted: false };
}
