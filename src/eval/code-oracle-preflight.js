// Diagnostic preflight for the entire active CODE suite. Never infer model quality
// from a failed fixture: report every broken control before placing a model on GPU.
export function inspectCodeOracleSuite(suite) {
  const failures = [];
  const tests = suite?.tests;
  if (!Array.isArray(tests) || tests.length === 0) {
    return { ready: false, checked: 0, code: 'CODE_FIXTURE_RUNTIME_UNAVAILABLE',
      reason: 'CODE suite has no tests', failures: [] };
  }
  for (const test of tests) {
    try {
      test.prepare();
      test.validateOracle();
    } catch (error) {
      failures.push({ test: test.name,
        code: error?.message?.includes('oracle controls failed:')
          ? 'CODE_ORACLE_CONTROL_FAILED' : error?.code || 'CODE_FIXTURE_RUNTIME_UNAVAILABLE',
        reason: error?.message || String(error) });
    }
  }
  const code = failures.some(row => row.code !== 'CODE_ORACLE_CONTROL_FAILED')
    ? 'CODE_FIXTURE_RUNTIME_UNAVAILABLE'
    : failures.length ? 'CODE_ORACLE_CONTROL_FAILED' : null;
  return { ready: failures.length === 0, checked: tests.length, code,
    reason: failures.map(row => `${row.test}: ${row.reason}`).join(' | ') || null,
    failures };
}
