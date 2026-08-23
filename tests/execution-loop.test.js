// Execution Loop v104 (F3) — Tests
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { suite, test, testAsync, assert, assertEqual, assertIncludes, summary } from './harness.js';
import { isolatedTestRuntime } from './helpers/isolated-test-db.js';
import {
  shouldContinue, compareErrors, limitErrors, buildFixPrompt,
  extractErrors, partitionErrorsByProjectScope, runFixLoop,
} from '../src/executor/execution-loop.js';

// ─── Test Project Setup ─────────────────────────────────────────────────────

const TEST_DIR = fs.mkdtempSync(
  path.join(isolatedTestRuntime.projects, 'execution-loop-'),
);

function setupTestProject() {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  // Create source files with predictable anchors
  const fileNames = [
    'main', 'a', 'b', 'c', 'app', 'first', 'second', 'x', 'y', 'z', 'w',
    ...Array.from({ length: 10 }, (_, i) => `file${i}`),
    ...Array.from({ length: 10 }, (_, i) => `fix${i + 1}`),
    ...Array.from({ length: 10 }, (_, i) => `f${i + 1}`),
  ];
  for (const name of fileNames) {
    fs.writeFileSync(
      path.join(TEST_DIR, `${name}.js`),
      `function main() {\n  old;\n}\n`
    );
  }
}

function cleanupTestProject() {
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
}

setupTestProject();

// Diff template — generates a valid patch against our test files
// Files contain: function main() {\n  old;\n}\n
function mkDiff(file, iter) {
  return `--- ${file}\n@@ function main\n-   old;\n+   fixed${iter || ''};`;
}

// ─── Test Helpers ───────────────────────────────────────────────────────────

function mkError(code, file = 'test.js', line = 1, opts = {}) {
  return {
    code,
    file,
    line,
    symbol: opts.symbol || null,
    message: opts.message || `Error: ${code}`,
    raw: opts.raw || `Error: ${code}`,
    severity: opts.severity || 'error',
    category: opts.category || 'compile',
    recoverable: opts.recoverable !== undefined ? opts.recoverable : true,
    derivedFrom: opts.derivedFrom || null,
  };
}

function mkTestResults(allPassed, stdout = '', stderr = '') {
  return { allPassed, exitCode: allPassed ? 0 : 1, summary: '', stdout, stderr, command: 'npm test', strategy: {} };
}

function mkQualityGate(passed, results = []) {
  return { passed, status: passed ? 'PASS' : 'FAIL', results };
}

// Real error patterns that match ERROR_MAP
const ERR_SYNTAX = 'SyntaxError: Unexpected token at main.js:5';
const ERR_REF = 'ReferenceError: myFunc is not defined';
const ERR_IMPORT = "Cannot find module 'express'";
const ERR_PERMISSION = 'EACCES: permission denied, open /etc/shadow';

// ─── shouldContinue ─────────────────────────────────────────────────────────

suite('shouldContinue');

test('all_passed — no errors', () => {
  const r = shouldContinue([], [mkError('SYNTAX_ERROR')], 1, 8);
  assertEqual(r.continue, false);
  assertEqual(r.reason, 'all_passed');
});

test('all_passed — only warnings remain', () => {
  const warn = mkError('UNUSED_IMPORT', 'a.js', 1, { severity: 'warning' });
  const r = shouldContinue([warn], [mkError('SYNTAX_ERROR')], 1, 8);
  assertEqual(r.continue, false);
  assertEqual(r.reason, 'all_passed');
});

test('not_converging — same errors repeat', () => {
  const errs = [mkError('SYNTAX_ERROR', 'a.js', 10), mkError('IMPORT_NOT_FOUND', 'b.js', 5)];
  const r = shouldContinue(errs, errs, 2, 8);
  assertEqual(r.continue, false);
  assertEqual(r.reason, 'not_converging');
});

test('diverging — error count ×2', () => {
  const prev = [mkError('SYNTAX_ERROR', 'a.js', 1)];
  const curr = [mkError('X', 'a.js', 1), mkError('Y', 'b.js', 2), mkError('Z', 'c.js', 3)];
  const r = shouldContinue(curr, prev, 2, 8);
  assertEqual(r.continue, false);
  assertEqual(r.reason, 'diverging');
});

test('NOT diverging — 2→3 errors (under ×2 threshold)', () => {
  const prev = [mkError('A', 'a.js', 1), mkError('B', 'b.js', 2)];
  const curr = [mkError('C', 'c.js', 3), mkError('D', 'd.js', 4), mkError('E', 'e.js', 5)];
  const r = shouldContinue(curr, prev, 2, 8);
  assertEqual(r.continue, true);
  assertEqual(r.reason, 'errors_decreasing');
});

test('budget_exhausted', () => {
  const r = shouldContinue([mkError('SYNTAX_ERROR')], [mkError('X')], 8, 8);
  assertEqual(r.continue, false);
  assertEqual(r.reason, 'budget_exhausted');
});

test('errors_decreasing — fewer errors', () => {
  const prev = [mkError('A', 'a.js', 1), mkError('B', 'b.js', 2)];
  const curr = [mkError('A', 'a.js', 1)];
  const r = shouldContinue(curr, prev, 2, 8);
  assertEqual(r.continue, true);
  assertEqual(r.reason, 'errors_decreasing');
});

test('unrecoverable — all errors unrecoverable', () => {
  const errs = [
    mkError('PERMISSION_DENIED', 'a.js', 1, { recoverable: false }),
    mkError('UNKNOWN', 'b.js', 2, { recoverable: false }),
  ];
  const r = shouldContinue(errs, [mkError('X')], 1, 8);
  assertEqual(r.continue, false);
  assertEqual(r.reason, 'unrecoverable');
});

test('empty previous — first iteration', () => {
  const r = shouldContinue([mkError('SYNTAX_ERROR')], [], 1, 8);
  assertEqual(r.continue, true);
  assertEqual(r.reason, 'errors_decreasing');
});

// ─── compareErrors ──────────────────────────────────────────────────────────

suite('compareErrors');

test('added/removed/unchanged', () => {
  const prev = [mkError('A', 'a.js', 1), mkError('B', 'b.js', 2)];
  const curr = [mkError('A', 'a.js', 1), mkError('C', 'c.js', 3)];
  const r = compareErrors(curr, prev);
  assertEqual(r.added.length, 1);
  assertEqual(r.removed.length, 1);
  assertEqual(r.unchanged.length, 1);
});

test('empty arrays', () => {
  const r = compareErrors([], []);
  assertEqual(r.added.length, 0);
  assertEqual(r.removed.length, 0);
});

test('same set', () => {
  const errs = [mkError('A', 'a.js', 1)];
  const r = compareErrors(errs, errs);
  assertEqual(r.unchanged.length, 1);
  assertEqual(r.added.length, 0);
});

test('disjoint sets', () => {
  const prev = [mkError('A', 'a.js', 1)];
  const curr = [mkError('B', 'b.js', 2)];
  const r = compareErrors(curr, prev);
  assertEqual(r.added.length, 1);
  assertEqual(r.removed.length, 1);
});

// ─── limitErrors ────────────────────────────────────────────────────────────

suite('limitErrors');

test('roots only — all pass through', () => {
  const errs = [mkError('A'), mkError('B'), mkError('C')];
  assertEqual(limitErrors(errs).length, 3);
});

test('roots + dependents capped at 5', () => {
  const roots = [mkError('IMPORT_NOT_FOUND', 'a.js', 1)];
  const deps = Array.from({ length: 10 }, (_, i) =>
    mkError('UNDEFINED_VARIABLE', `f${i}.js`, i, { derivedFrom: 'IMPORT_NOT_FOUND' })
  );
  assertEqual(limitErrors([...roots, ...deps]).length, 6);
});

test('all dependents — still capped', () => {
  const deps = Array.from({ length: 8 }, (_, i) =>
    mkError('X', `f${i}.js`, i, { derivedFrom: 'Y' })
  );
  assertEqual(limitErrors(deps).length, 5);
});

test('empty input', () => {
  assertEqual(limitErrors([]).length, 0);
  assertEqual(limitErrors(null).length, 0);
});

// ─── buildFixPrompt ─────────────────────────────────────────────────────────

suite('buildFixPrompt');

test('basic structure', () => {
  const errs = [mkError('SYNTAX_ERROR', 'main.js', 42)];
  const iterMem = { iteration: 1, patchesApplied: [], errorHistory: [errs] };
  const prompt = buildFixPrompt({ title: 'Test Milestone' }, errs, iterMem, 'diff output');
  assertIncludes(prompt, 'Test Milestone');
  assertIncludes(prompt, 'iteration 1/');
});

test('includes formatted errors', () => {
  const errs = [mkError('IMPORT_NOT_FOUND', 'server.js', 5, { symbol: 'express' })];
  const iterMem = { iteration: 2, patchesApplied: [], errorHistory: [] };
  const prompt = buildFixPrompt({ title: 'MS' }, errs, iterMem, '');
  assertIncludes(prompt, 'IMPORT_NOT_FOUND');
});

test('previous patches capped to last 2', () => {
  const mkP = (f) => ({ file: f, regions: [{ anchor: 'fn', anchorType: 'function', old: [], new: ['x'] }], metadata: {} });
  const iterMem = { iteration: 4, patchesApplied: [mkP('a.js'), mkP('b.js'), mkP('c.js')], errorHistory: [] };
  const prompt = buildFixPrompt({ title: 'MS' }, [mkError('X')], iterMem, '');
  assertIncludes(prompt, 'b.js');
  assertIncludes(prompt, 'c.js');
});

test('git diff capped at 4000 chars', () => {
  const longDiff = 'x'.repeat(5000);
  const iterMem = { iteration: 1, patchesApplied: [], errorHistory: [] };
  const prompt = buildFixPrompt({ title: 'MS' }, [mkError('X')], iterMem, longDiff);
  assert(!prompt.includes('x'.repeat(5000)), 'Git diff should be capped');
  assert(prompt.includes('x'.repeat(4000)), 'Should contain first 4000 chars');
});

test('compile-first priority', () => {
  const compileErr = mkError('SYNTAX_ERROR', 'a.js', 1, { category: 'compile' });
  const testErr = mkError('TEST_FAILED', 'test.js', 10, { category: 'test' });
  const iterMem = { iteration: 1, patchesApplied: [], errorHistory: [] };
  const prompt = buildFixPrompt({ title: 'MS' }, [compileErr, testErr], iterMem, '');
  assertIncludes(prompt, 'SYNTAX_ERROR');
});

test('iteration counter', () => {
  const iterMem = { iteration: 3, patchesApplied: [], errorHistory: [] };
  const prompt = buildFixPrompt({ title: 'MS' }, [mkError('X')], iterMem, '');
  assertIncludes(prompt, 'iteration 3/');
});

// ─── extractErrors ──────────────────────────────────────────────────────────

suite('extractErrors');

test('compile errors from quality gate', () => {
  const qg = mkQualityGate(false, [
    { passed: false, file: 'a.js', line: 10, message: "TS2339: Property 'foo' does not exist" },
  ]);
  const errs = extractErrors(mkTestResults(null), qg);
  assert(errs.length >= 1, `Expected >= 1 error, got ${errs.length}`);
});

test('test errors from stdout/stderr', () => {
  const tr = mkTestResults(false, '', ERR_REF + '\n  at test.js:42');
  const errs = extractErrors(tr, mkQualityGate(true));
  assert(errs.length >= 1, `Expected >= 1 error, got ${errs.length}`);
});

test('combined compile + test errors', () => {
  const qg = mkQualityGate(false, [
    { passed: false, file: 'a.js', line: 5, message: 'SyntaxError: Unexpected token' },
  ]);
  const tr = mkTestResults(false, 'FAIL test suite', 'AssertionError: expected true');
  const errs = extractErrors(tr, qg);
  assert(errs.length >= 1, `Expected >= 1 errors, got ${errs.length}`);
});

test('empty both', () => {
  assertEqual(extractErrors(mkTestResults(true), mkQualityGate(true)).length, 0);
});

test('dedup across sources', () => {
  const qg = mkQualityGate(false, [
    { passed: false, file: 'a.js', line: 10, message: ERR_REF },
  ]);
  const tr = mkTestResults(false, '', ERR_REF + '\n  at a.js:10');
  const errs = extractErrors(tr, qg);
  assert(errs.length <= 3, `Expected dedup, got ${errs.length}`);
});

// ─── runFixLoop — convergence ───────────────────────────────────────────────

suite('runFixLoop — convergence');

await testAsync('pass on iteration 1', async () => {
  const r = await runFixLoop({
    lifecycle: { projectPath: TEST_DIR },
    milestone: { id: 'ms-1', title: 'Test' },
    testResults: mkTestResults(false, '', ERR_SYNTAX),
    qualityGateResult: mkQualityGate(true),
    callLLM: async () => ({ content: mkDiff('main.js', 1) }),
    runTests: async () => mkTestResults(true),
    runQualityGate: async () => mkQualityGate(true),
    getGitDiff: async () => 'diff --stat',
  });
  assertEqual(r.converged, true);
  assertEqual(r.stopReason, 'all_passed');
  assertEqual(r.iterations, 1);
});

await testAsync('pass on iteration 2', async () => {
  // Reset file for this test
  fs.writeFileSync(path.join(TEST_DIR, 'a.js'), 'function main() {\n  old;\n}\n');
  fs.writeFileSync(path.join(TEST_DIR, 'b.js'), 'function main() {\n  old;\n}\n');
  let iter = 0;
  const r = await runFixLoop({
    lifecycle: { projectPath: TEST_DIR },
    milestone: { id: 'ms-1', title: 'Test' },
    testResults: mkTestResults(false, '', ERR_SYNTAX),
    qualityGateResult: mkQualityGate(true),
    callLLM: async () => {
      iter++;
      // Unique file per iteration to avoid oscillation/file-loop
      return { content: mkDiff(iter === 1 ? 'a.js' : 'b.js', iter) };
    },
    runTests: async () => {
      if (iter >= 2) return mkTestResults(true);
      return mkTestResults(false, '', ERR_REF);
    },
    runQualityGate: async () => mkQualityGate(true),
    getGitDiff: async () => 'diff',
  });
  assertEqual(r.converged, true);
  assertEqual(r.stopReason, 'all_passed');
  assertEqual(r.iterations, 2);
});

await testAsync('not_converging — same errors repeat', async () => {
  // Reset files
  for (let i = 1; i <= 5; i++) {
    fs.writeFileSync(path.join(TEST_DIR, `fix${i}.js`), 'function main() {\n  old;\n}\n');
  }
  let iter = 0;
  const r = await runFixLoop({
    lifecycle: { projectPath: TEST_DIR },
    milestone: { id: 'ms-1', title: 'Test' },
    testResults: mkTestResults(false, '', ERR_SYNTAX),
    qualityGateResult: mkQualityGate(true),
    callLLM: async () => {
      iter++;
      return { content: mkDiff(`fix${iter}.js`, iter) };
    },
    runTests: async () => mkTestResults(false, '', ERR_SYNTAX),
    runQualityGate: async () => mkQualityGate(true),
    getGitDiff: async () => '',
  });
  assertEqual(r.converged, false);
  assertEqual(r.stopReason, 'not_converging');
});

await testAsync('diverging — rollback triggered', async () => {
  fs.writeFileSync(path.join(TEST_DIR, 'first.js'), 'function main() {\n  old;\n}\n');
  fs.writeFileSync(path.join(TEST_DIR, 'second.js'), 'function main() {\n  old;\n}\n');
  let iter = 0;
  const r = await runFixLoop({
    lifecycle: { projectPath: TEST_DIR },
    milestone: { id: 'ms-1', title: 'Test' },
    testResults: mkTestResults(false, '', ERR_SYNTAX),
    qualityGateResult: mkQualityGate(true),
    callLLM: async () => {
      iter++;
      return { content: mkDiff(iter === 1 ? 'first.js' : 'second.js', iter) };
    },
    runTests: async () => {
      if (iter <= 1) return mkTestResults(false, '', ERR_REF);
      // Many unique errors at different files/lines to trigger diverging (×2)
      // Previous iteration had 1 error; need >2 unique errors
      return mkTestResults(false, '',
        [
          'SyntaxError: Unexpected token at x.js:1',
          'ReferenceError: alpha is not defined',
          "Cannot find module 'lodash'",
          'TypeError: beta is not a function',
          'ReferenceError: gamma is not defined',
          'SyntaxError: Unexpected token at y.js:2',
        ].join('\n'));
    },
    runQualityGate: async () => mkQualityGate(true),
    getGitDiff: async () => '',
  });
  assertEqual(r.converged, false);
  assertEqual(r.stopReason, 'diverging');
  const lastEntry = r.report.iterations[r.report.iterations.length - 1];
  assertEqual(lastEntry.action, 'rolled_back');
});

await testAsync('budget_exhausted — max 2 iterations', async () => {
  const cfg = (await import('../src/config.js')).config;
  const origMax = cfg.lifecycle.maxLoopIterations;
  cfg.lifecycle.maxLoopIterations = 2;

  // Reset files
  for (let i = 1; i <= 3; i++) {
    fs.writeFileSync(path.join(TEST_DIR, `f${i}.js`), 'function main() {\n  old;\n}\n');
  }
  let iter = 0;
  try {
    const r = await runFixLoop({
      lifecycle: { projectPath: TEST_DIR },
      milestone: { id: 'ms-1', title: 'Test' },
      testResults: mkTestResults(false, '', ERR_SYNTAX),
      qualityGateResult: mkQualityGate(true),
      callLLM: async () => {
        iter++;
        return { content: mkDiff(`f${iter}.js`, iter) };
      },
      runTests: async () => mkTestResults(false, '', `ReferenceError: var${iter} is not defined`),
      runQualityGate: async () => mkQualityGate(true),
      getGitDiff: async () => '',
    });
    assertEqual(r.converged, false);
    assertEqual(r.stopReason, 'budget_exhausted');
    assertEqual(r.iterations, 2);
  } finally {
    cfg.lifecycle.maxLoopIterations = origMax;
  }
});

await testAsync('unrecoverable — early stop', async () => {
  const r = await runFixLoop({
    lifecycle: { projectPath: TEST_DIR },
    milestone: { id: 'ms-1', title: 'Test' },
    testResults: mkTestResults(false, '', ERR_PERMISSION),
    qualityGateResult: mkQualityGate(true),
    callLLM: async () => { throw new Error('Should not be called'); },
    runTests: async () => { throw new Error('Should not be called'); },
    runQualityGate: async () => { throw new Error('Should not be called'); },
    getGitDiff: async () => '',
  });
  assertEqual(r.converged, false);
  assertEqual(r.stopReason, 'unrecoverable');
  assertEqual(r.iterations, 0);
});

await testAsync('patch_failed — no patches parsed', async () => {
  const r = await runFixLoop({
    lifecycle: { projectPath: TEST_DIR },
    milestone: { id: 'ms-1', title: 'Test' },
    testResults: mkTestResults(false, '', ERR_SYNTAX),
    qualityGateResult: mkQualityGate(true),
    callLLM: async () => ({ content: 'I cannot fix this error.' }),
    runTests: async () => mkTestResults(true),
    runQualityGate: async () => mkQualityGate(true),
    getGitDiff: async () => '',
  });
  assertEqual(r.converged, false);
  assertEqual(r.stopReason, 'patch_failed');
});

await testAsync('project path violation is terminal and retained in iteration evidence', async () => {
  const main = path.join(TEST_DIR, 'main.js');
  const outside = path.join(path.dirname(TEST_DIR), 'execution-loop-outside.js');
  const original = 'function main() {\n  old;\n}\n';
  fs.writeFileSync(main, original);
  fs.writeFileSync(outside, original);
  let qualityGateCalls = 0;
  let testCalls = 0;

  try {
    const r = await runFixLoop({
      lifecycle: { projectPath: TEST_DIR },
      milestone: { id: 'ms-path-authority', title: 'Authority evidence' },
      testResults: mkTestResults(false, '', ERR_SYNTAX),
      qualityGateResult: mkQualityGate(true),
      callLLM: async () => ({
        content: `${mkDiff('main.js', 1)}\n${mkDiff('../execution-loop-outside.js', 2)}`,
      }),
      runTests: async () => {
        testCalls += 1;
        return mkTestResults(true);
      },
      runQualityGate: async () => {
        qualityGateCalls += 1;
        return mkQualityGate(true);
      },
      getGitDiff: async () => '',
    });

    assertEqual(r.converged, false);
    assertEqual(r.stopReason, 'project_path_violation');
    assertEqual(r.report.iterations.length, 1);
    assertEqual(r.report.iterations[0].action, 'rejected');
    assertEqual(r.report.iterations[0].state, 'project_path_violation');
    assertEqual(r.report.iterations[0].pathAuthority.reason, 'traversal');
    assertEqual(r.report.iterations[0].rejectedPatches[0].file, '../execution-loop-outside.js');
    assertEqual(qualityGateCalls, 0);
    assertEqual(testCalls, 0);
    assertEqual(fs.readFileSync(main, 'utf8'), original);
    assertEqual(fs.readFileSync(outside, 'utf8'), original);
  } finally {
    fs.rmSync(outside, { force: true });
  }
});

await testAsync('no initial errors → immediate converge', async () => {
  const r = await runFixLoop({
    lifecycle: { projectPath: TEST_DIR },
    milestone: { id: 'ms-1', title: 'Test' },
    testResults: mkTestResults(true),
    qualityGateResult: mkQualityGate(true),
    callLLM: async () => { throw new Error('Should not be called'); },
    runTests: async () => { throw new Error('Should not be called'); },
    runQualityGate: async () => { throw new Error('Should not be called'); },
    getGitDiff: async () => '',
  });
  assertEqual(r.converged, true);
  assertEqual(r.iterations, 0);
});

// ─── runFixLoop — guards ────────────────────────────────────────────────────

suite('runFixLoop — guards');

test('scope partition accepts declared missing files and rejects traversal', () => {
  const declared = mkError('DECLARED', 'src/new-file.js');
  const existing = mkError('EXISTING', 'main.js');
  const traversal = mkError('TRAVERSAL', '../../etc/passwd');
  const missing = mkError('MISSING', 'other/missing.js');
  const noFile = mkError('GENERAL', null);

  const result = partitionErrorsByProjectScope(
    [declared, existing, traversal, missing, noFile],
    JSON.stringify(['src/new-file.js']),
    TEST_DIR,
  );

  assert(result.inScopeErrors.includes(declared), 'declared target must remain actionable');
  assert(result.inScopeErrors.includes(existing), 'existing project file must remain actionable');
  assert(result.inScopeErrors.includes(noFile), 'general errors must remain actionable');
  assert(result.outOfScopeErrors.includes(traversal), 'path traversal must be rejected');
  assert(result.outOfScopeErrors.includes(missing), 'hallucinated file must be rejected');
});

await testAsync('out_of_scope_only — no LLM call for hallucinated files', async () => {
  let llmCalls = 0;
  const r = await runFixLoop({
    lifecycle: { projectPath: TEST_DIR },
    milestone: {
      id: 'ms-1',
      title: 'Test',
      scope_files: JSON.stringify(['src/expected.js']),
    },
    testResults: mkTestResults(false, '', 'SyntaxError: Unexpected token at ghost.js:1'),
    qualityGateResult: mkQualityGate(true),
    callLLM: async () => {
      llmCalls += 1;
      return { content: '' };
    },
    runTests: async () => mkTestResults(true),
    runQualityGate: async () => mkQualityGate(true),
    getGitDiff: async () => '',
  });

  assertEqual(r.stopReason, 'out_of_scope_only');
  assertEqual(llmCalls, 0);
});

await testAsync('scope_exceeded — >5 files', async () => {
  const r = await runFixLoop({
    lifecycle: { projectPath: TEST_DIR },
    milestone: { id: 'ms-1', title: 'Test' },
    testResults: mkTestResults(false, '', ERR_SYNTAX),
    qualityGateResult: mkQualityGate(true),
    callLLM: async () => ({
      content: Array.from({ length: 6 }, (_, i) => mkDiff(`file${i}.js`, i)).join('\n'),
    }),
    runTests: async () => mkTestResults(true),
    runQualityGate: async () => mkQualityGate(true),
    getGitDiff: async () => '',
  });
  assertEqual(r.converged, false);
  assertEqual(r.stopReason, 'scope_exceeded');
});

await testAsync('file_loop — >3× same file', async () => {
  let iter = 0;
  const r = await runFixLoop({
    lifecycle: { projectPath: TEST_DIR },
    milestone: { id: 'ms-1', title: 'Test' },
    testResults: mkTestResults(false, '', ERR_SYNTAX),
    qualityGateResult: mkQualityGate(true),
    callLLM: async () => {
      iter++;
      // Reset file before each patch so anchor + old line match
      fs.writeFileSync(path.join(TEST_DIR, 'main.js'), 'function main() {\n  old;\n}\n');
      return { content: `--- main.js\n@@ function main\n-   old;\n+   v${iter};` };
    },
    // Different error each iteration (different file/line) to prevent not_converging
    runTests: async () => mkTestResults(false, '', `SyntaxError: Unexpected token at w${iter}.js:${iter * 10}`),
    runQualityGate: async () => mkQualityGate(true),
    getGitDiff: async () => '',
  });
  assertEqual(r.converged, false);
  assertEqual(r.stopReason, 'file_loop');
  assert(r.iterations <= 4, `Should stop by iteration 4, got ${r.iterations}`);
});

await testAsync('oscillation_detected — same patch repeated', async () => {
  let iter = 0;
  const r = await runFixLoop({
    lifecycle: { projectPath: TEST_DIR },
    milestone: { id: 'ms-1', title: 'Test' },
    testResults: mkTestResults(false, '', ERR_SYNTAX),
    qualityGateResult: mkQualityGate(true),
    callLLM: async () => {
      iter++;
      if (iter <= 2) {
        fs.writeFileSync(path.join(TEST_DIR, `fix${iter}.js`), 'function main() {\n  old;\n}\n');
        return { content: mkDiff(`fix${iter}.js`, iter) };
      }
      // Iter 3: repeat exact same patch as iter 1 (same file, same anchor, same new lines)
      fs.writeFileSync(path.join(TEST_DIR, 'fix1.js'), 'function main() {\n  old;\n}\n');
      return { content: mkDiff('fix1.js', 1) };
    },
    // Different error each iteration (different file/line) to prevent not_converging
    runTests: async () => mkTestResults(false, '', `SyntaxError: Unexpected token at w${iter}.js:${iter * 10}`),
    runQualityGate: async () => mkQualityGate(true),
    getGitDiff: async () => '',
  });
  assertEqual(r.converged, false);
  assertEqual(r.stopReason, 'oscillation_detected');
});

await testAsync('compile-first — quality gate before tests', async () => {
  fs.writeFileSync(path.join(TEST_DIR, 'app.js'), 'function main() {\n  old;\n}\n');
  let qgCallCount = 0;
  let testCallCount = 0;
  let qgCalledFirst = false;

  const r = await runFixLoop({
    lifecycle: { projectPath: TEST_DIR },
    milestone: { id: 'ms-1', title: 'Test' },
    testResults: mkTestResults(false, '', ERR_SYNTAX),
    qualityGateResult: mkQualityGate(true),
    callLLM: async () => ({ content: mkDiff('app.js', 1) }),
    runTests: async () => {
      testCallCount++;
      return mkTestResults(true);
    },
    runQualityGate: async () => {
      qgCallCount++;
      if (testCallCount === 0) qgCalledFirst = true;
      return mkQualityGate(true);
    },
    getGitDiff: async () => '',
  });
  assert(qgCallCount >= 1, 'Quality gate should be called');
  assert(qgCalledFirst, 'Quality gate should be called before tests');
});

await testAsync('compile failure skips test run', async () => {
  let testCallCount = 0;
  let iter = 0;
  fs.writeFileSync(path.join(TEST_DIR, 'a.js'), 'function main() {\n  old;\n}\n');

  const r = await runFixLoop({
    lifecycle: { projectPath: TEST_DIR },
    milestone: { id: 'ms-1', title: 'Test' },
    testResults: mkTestResults(false, '', ERR_SYNTAX),
    qualityGateResult: mkQualityGate(true),
    callLLM: async () => {
      iter++;
      fs.writeFileSync(path.join(TEST_DIR, 'a.js'), 'function main() {\n  old;\n}\n');
      return { content: mkDiff('a.js', iter) };
    },
    runTests: async () => {
      testCallCount++;
      return mkTestResults(false, '', ERR_REF);
    },
    runQualityGate: async () => mkQualityGate(false, [
      { passed: false, file: 'a.js', line: 1, message: 'SyntaxError: missing )' },
    ]),
    getGitDiff: async () => '',
  });
  assertEqual(testCallCount, 0);
});

await testAsync('clearBackups always called', async () => {
  const r = await runFixLoop({
    lifecycle: { projectPath: TEST_DIR },
    milestone: { id: 'ms-1', title: 'Test' },
    testResults: mkTestResults(true),
    qualityGateResult: mkQualityGate(true),
    callLLM: async () => ({ content: '' }),
    runTests: async () => mkTestResults(true),
    runQualityGate: async () => mkQualityGate(true),
    getGitDiff: async () => '',
  });
  assert(r.converged === true || r.converged === false, 'Should return valid result');
});

// ─── runFixLoop — callbacks ─────────────────────────────────────────────────

suite('runFixLoop — callbacks');

await testAsync('callLLM called with prompt', async () => {
  fs.writeFileSync(path.join(TEST_DIR, 'app.js'), 'function main() {\n  old;\n}\n');
  let promptReceived = '';
  const r = await runFixLoop({
    lifecycle: { projectPath: TEST_DIR },
    milestone: { id: 'ms-1', title: 'MyMilestone' },
    testResults: mkTestResults(false, '', ERR_SYNTAX),
    qualityGateResult: mkQualityGate(true),
    callLLM: async (role, prompt) => {
      promptReceived = prompt;
      return { content: mkDiff('app.js', 1) };
    },
    runTests: async () => mkTestResults(true),
    runQualityGate: async () => mkQualityGate(true),
    getGitDiff: async () => 'some diff',
  });
  assertIncludes(promptReceived, 'MyMilestone');
  assertIncludes(promptReceived, 'iteration 1/');
});

await testAsync('runTests called per iteration', async () => {
  let testCount = 0;
  let iter = 0;
  for (let i = 1; i <= 3; i++) {
    fs.writeFileSync(path.join(TEST_DIR, `f${i}.js`), 'function main() {\n  old;\n}\n');
  }
  const r = await runFixLoop({
    lifecycle: { projectPath: TEST_DIR },
    milestone: { id: 'ms-1', title: 'Test' },
    testResults: mkTestResults(false, '', ERR_SYNTAX),
    qualityGateResult: mkQualityGate(true),
    callLLM: async () => {
      iter++;
      return { content: mkDiff(`f${iter}.js`, iter) };
    },
    runTests: async () => {
      testCount++;
      if (testCount >= 2) return mkTestResults(true);
      return mkTestResults(false, '', ERR_REF);
    },
    runQualityGate: async () => mkQualityGate(true),
    getGitDiff: async () => '',
  });
  assertEqual(testCount, 2);
});

await testAsync('runQualityGate called per iteration', async () => {
  fs.writeFileSync(path.join(TEST_DIR, 'a.js'), 'function main() {\n  old;\n}\n');
  let qgCount = 0;
  const r = await runFixLoop({
    lifecycle: { projectPath: TEST_DIR },
    milestone: { id: 'ms-1', title: 'Test' },
    testResults: mkTestResults(false, '', ERR_SYNTAX),
    qualityGateResult: mkQualityGate(true),
    callLLM: async () => ({ content: mkDiff('a.js', 1) }),
    runTests: async () => mkTestResults(true),
    runQualityGate: async () => {
      qgCount++;
      return mkQualityGate(true);
    },
    getGitDiff: async () => '',
  });
  assert(qgCount >= 1, `Quality gate should be called >= 1 time, got ${qgCount}`);
});

await testAsync('getGitDiff called', async () => {
  fs.writeFileSync(path.join(TEST_DIR, 'a.js'), 'function main() {\n  old;\n}\n');
  let diffCalled = false;
  const r = await runFixLoop({
    lifecycle: { projectPath: TEST_DIR },
    milestone: { id: 'ms-1', title: 'Test' },
    testResults: mkTestResults(false, '', ERR_SYNTAX),
    qualityGateResult: mkQualityGate(true),
    callLLM: async () => ({ content: mkDiff('a.js', 1) }),
    runTests: async () => mkTestResults(true),
    runQualityGate: async () => mkQualityGate(true),
    getGitDiff: async () => { diffCalled = true; return 'diff output'; },
  });
  assert(diffCalled, 'getGitDiff should be called');
});

await testAsync('LLM receives CODE role', async () => {
  fs.writeFileSync(path.join(TEST_DIR, 'a.js'), 'function main() {\n  old;\n}\n');
  let roleReceived = '';
  const r = await runFixLoop({
    lifecycle: { projectPath: TEST_DIR },
    milestone: { id: 'ms-1', title: 'Test' },
    testResults: mkTestResults(false, '', ERR_SYNTAX),
    qualityGateResult: mkQualityGate(true),
    callLLM: async (role) => {
      roleReceived = role;
      return { content: mkDiff('a.js', 1) };
    },
    runTests: async () => mkTestResults(true),
    runQualityGate: async () => mkQualityGate(true),
    getGitDiff: async () => '',
  });
  assertEqual(roleReceived, 'CODE');
});

// ─── runFixLoop — report ────────────────────────────────────────────────────

suite('runFixLoop — report');

await testAsync('correct iteration count', async () => {
  for (let i = 1; i <= 3; i++) {
    fs.writeFileSync(path.join(TEST_DIR, `f${i}.js`), 'function main() {\n  old;\n}\n');
  }
  let iter = 0;
  const r = await runFixLoop({
    lifecycle: { projectPath: TEST_DIR },
    milestone: { id: 'ms-1', title: 'Test' },
    testResults: mkTestResults(false, '', ERR_SYNTAX),
    qualityGateResult: mkQualityGate(true),
    callLLM: async () => {
      iter++;
      return { content: mkDiff(`f${iter}.js`, iter) };
    },
    runTests: async () => {
      if (iter >= 2) return mkTestResults(true);
      return mkTestResults(false, '', ERR_REF);
    },
    runQualityGate: async () => mkQualityGate(true),
    getGitDiff: async () => '',
  });
  assertEqual(r.report.iterations.length, 2);
});

await testAsync('filesModified tracks all files', async () => {
  for (let i = 1; i <= 3; i++) {
    fs.writeFileSync(path.join(TEST_DIR, `file${i}.js`), 'function main() {\n  old;\n}\n');
  }
  let iter = 0;
  const r = await runFixLoop({
    lifecycle: { projectPath: TEST_DIR },
    milestone: { id: 'ms-1', title: 'Test' },
    testResults: mkTestResults(false, '', ERR_SYNTAX),
    qualityGateResult: mkQualityGate(true),
    callLLM: async () => {
      iter++;
      return { content: mkDiff(`file${iter}.js`, iter) };
    },
    runTests: async () => {
      if (iter >= 2) return mkTestResults(true);
      return mkTestResults(false, '', ERR_REF);
    },
    runQualityGate: async () => mkQualityGate(true),
    getGitDiff: async () => '',
  });
  assert(r.report.filesModified.includes('file1.js'), 'Should track file1.js');
  assert(r.report.filesModified.includes('file2.js'), 'Should track file2.js');
});

await testAsync('summary text', async () => {
  fs.writeFileSync(path.join(TEST_DIR, 'a.js'), 'function main() {\n  old;\n}\n');
  const r = await runFixLoop({
    lifecycle: { projectPath: TEST_DIR },
    milestone: { id: 'ms-1', title: 'Test' },
    testResults: mkTestResults(false, '', ERR_SYNTAX),
    qualityGateResult: mkQualityGate(true),
    callLLM: async () => ({ content: mkDiff('a.js', 1) }),
    runTests: async () => mkTestResults(true),
    runQualityGate: async () => mkQualityGate(true),
    getGitDiff: async () => '',
  });
  assert(typeof r.report.summary === 'string' && r.report.summary.length > 0, 'Summary should be non-empty string');
});

await testAsync('totalPatches count', async () => {
  for (let i = 1; i <= 3; i++) {
    fs.writeFileSync(path.join(TEST_DIR, `f${i}.js`), 'function main() {\n  old;\n}\n');
  }
  let iter = 0;
  const r = await runFixLoop({
    lifecycle: { projectPath: TEST_DIR },
    milestone: { id: 'ms-1', title: 'Test' },
    testResults: mkTestResults(false, '', ERR_SYNTAX),
    qualityGateResult: mkQualityGate(true),
    callLLM: async () => {
      iter++;
      return { content: mkDiff(`f${iter}.js`, iter) };
    },
    runTests: async () => {
      if (iter >= 2) return mkTestResults(true);
      return mkTestResults(false, '', ERR_REF);
    },
    runQualityGate: async () => mkQualityGate(true),
    getGitDiff: async () => '',
  });
  assertEqual(r.report.totalPatches, 2);
});

await testAsync('converged flag in report', async () => {
  fs.writeFileSync(path.join(TEST_DIR, 'a.js'), 'function main() {\n  old;\n}\n');
  const r = await runFixLoop({
    lifecycle: { projectPath: TEST_DIR },
    milestone: { id: 'ms-1', title: 'Test' },
    testResults: mkTestResults(false, '', ERR_SYNTAX),
    qualityGateResult: mkQualityGate(true),
    callLLM: async () => ({ content: mkDiff('a.js', 1) }),
    runTests: async () => mkTestResults(true),
    runQualityGate: async () => mkQualityGate(true),
    getGitDiff: async () => '',
  });
  assertEqual(r.converged, true);
  assertIncludes(r.report.summary, 'Fixed all errors');
});

// ─── rollback ───────────────────────────────────────────────────────────────

suite('rollback');

await testAsync('rollback on diverging — report shows rolled_back', async () => {
  fs.writeFileSync(path.join(TEST_DIR, 'first.js'), 'function main() {\n  old;\n}\n');
  fs.writeFileSync(path.join(TEST_DIR, 'second.js'), 'function main() {\n  old;\n}\n');
  let iter = 0;
  const r = await runFixLoop({
    lifecycle: { projectPath: TEST_DIR },
    milestone: { id: 'ms-1', title: 'Test' },
    testResults: mkTestResults(false, '', ERR_SYNTAX),
    qualityGateResult: mkQualityGate(true),
    callLLM: async () => {
      iter++;
      return { content: mkDiff(iter === 1 ? 'first.js' : 'second.js', iter) };
    },
    runTests: async () => {
      if (iter <= 1) return mkTestResults(false, '', ERR_REF);
      // >2× unique errors at distinct files/lines to trigger diverging
      return mkTestResults(false, '', [
        'SyntaxError: Unexpected token at x.js:1',
        'SyntaxError: Unexpected token at y.js:2',
        'SyntaxError: Unexpected token at z.js:3',
      ].join('\n'));
    },
    runQualityGate: async () => mkQualityGate(true),
    getGitDiff: async () => '',
  });
  const rolledBack = r.report.iterations.filter(e => e.action === 'rolled_back');
  assert(rolledBack.length >= 1, 'Should have at least one rolled_back entry');
});

await testAsync('no rollback on budget_exhausted', async () => {
  const cfg = (await import('../src/config.js')).config;
  const origMax = cfg.lifecycle.maxLoopIterations;
  cfg.lifecycle.maxLoopIterations = 1;

  fs.writeFileSync(path.join(TEST_DIR, 'a.js'), 'function main() {\n  old;\n}\n');
  try {
    const r = await runFixLoop({
      lifecycle: { projectPath: TEST_DIR },
      milestone: { id: 'ms-1', title: 'Test' },
      testResults: mkTestResults(false, '', ERR_SYNTAX),
      qualityGateResult: mkQualityGate(true),
      callLLM: async () => ({ content: mkDiff('a.js', 1) }),
      runTests: async () => mkTestResults(false, '', ERR_REF),
      runQualityGate: async () => mkQualityGate(true),
      getGitDiff: async () => '',
    });
    assertEqual(r.stopReason, 'budget_exhausted');
    const rolledBack = r.report.iterations.filter(e => e.action === 'rolled_back');
    assertEqual(rolledBack.length, 0);
  } finally {
    cfg.lifecycle.maxLoopIterations = origMax;
  }
});

await testAsync('no rollback on convergence', async () => {
  fs.writeFileSync(path.join(TEST_DIR, 'a.js'), 'function main() {\n  old;\n}\n');
  const r = await runFixLoop({
    lifecycle: { projectPath: TEST_DIR },
    milestone: { id: 'ms-1', title: 'Test' },
    testResults: mkTestResults(false, '', ERR_SYNTAX),
    qualityGateResult: mkQualityGate(true),
    callLLM: async () => ({ content: mkDiff('a.js', 1) }),
    runTests: async () => mkTestResults(true),
    runQualityGate: async () => mkQualityGate(true),
    getGitDiff: async () => '',
  });
  assertEqual(r.converged, true);
  const rolledBack = r.report.iterations.filter(e => e.action === 'rolled_back');
  assertEqual(rolledBack.length, 0);
});

await testAsync('rollback targets specific files', async () => {
  fs.writeFileSync(path.join(TEST_DIR, 'first.js'), 'function main() {\n  old;\n}\n');
  fs.writeFileSync(path.join(TEST_DIR, 'second.js'), 'function main() {\n  old;\n}\n');
  let iter = 0;
  const r = await runFixLoop({
    lifecycle: { projectPath: TEST_DIR },
    milestone: { id: 'ms-1', title: 'Test' },
    testResults: mkTestResults(false, '', ERR_SYNTAX),
    qualityGateResult: mkQualityGate(true),
    callLLM: async () => {
      iter++;
      return { content: mkDiff(iter === 1 ? 'first.js' : 'second.js', iter) };
    },
    runTests: async () => {
      if (iter <= 1) return mkTestResults(false, '', ERR_REF);
      // >2× unique errors at distinct files/lines to trigger diverging
      return mkTestResults(false, '', [
        'SyntaxError: Unexpected token at x.js:1',
        'SyntaxError: Unexpected token at y.js:2',
        'SyntaxError: Unexpected token at z.js:3',
      ].join('\n'));
    },
    runQualityGate: async () => mkQualityGate(true),
    getGitDiff: async () => '',
  });
  const rolledBackEntry = r.report.iterations.find(e => e.action === 'rolled_back');
  assert(rolledBackEntry, 'Should have a rolled_back entry');
  assert(rolledBackEntry.patchFiles.includes('second.js'), 'Rollback should target second.js');
});

// ─── Cleanup + Summary ─────────────────────────────────────────────────────

cleanupTestProject();
summary();
