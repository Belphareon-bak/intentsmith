// tests/continuous-improvement.test.js — Continuous Improvement (F13) unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import {
  ImprovementType,
  analyzeImprovementOpportunities,
  executeImprovement,
  runImprovementCycle,
  formatImprovementReport,
} from '../src/planner/continuous-improvement.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function mkImprovement(type, file, desc = '', effort = 'low') {
  return {
    type,
    priority: 3,
    file,
    description: desc || `Issue in ${file}`,
    estimatedEffort: effort,
  };
}

function mkCallLLM(content = 'generated code') {
  return async (_role, _prompt) => ({ content });
}

function mkRunTests(allPassed = true) {
  return async () => ({ allPassed });
}

function mkApplyPatch(success = true) {
  return async (_patch) => ({ success });
}

function mkReadFile(content = 'const x = 1;\nmodule.exports = x;') {
  return (_path) => content;
}

// ═══════════════════════════════════════════════════════════════════════════
// ImprovementType enum
// ═══════════════════════════════════════════════════════════════════════════

suite('ImprovementType');

test('all types defined', () => {
  assertEqual(ImprovementType.TEST_COVERAGE, 'test_coverage', 'TEST_COVERAGE');
  assertEqual(ImprovementType.CODE_QUALITY, 'code_quality', 'CODE_QUALITY');
  assertEqual(ImprovementType.DOCUMENTATION, 'documentation', 'DOCUMENTATION');
  assertEqual(ImprovementType.DEAD_CODE, 'dead_code', 'DEAD_CODE');
});

test('is frozen', () => {
  assert(Object.isFrozen(ImprovementType), 'should be frozen');
});

// ═══════════════════════════════════════════════════════════════════════════
// analyzeImprovementOpportunities
// ═══════════════════════════════════════════════════════════════════════════

suite('analyzeImprovementOpportunities');

test('test coverage gaps detected', () => {
  const result = analyzeImprovementOpportunities('/proj', {
    testCoverage: { covered: ['a.js'], uncovered: ['b.js', 'c.js'] },
  });
  assertEqual(result.length, 2, 'should find 2 gaps');
  assert(result.every(o => o.type === ImprovementType.TEST_COVERAGE), 'all test_coverage');
  assertEqual(result[0].priority, 4, 'priority = 4');
});

test('code smells detected', () => {
  const result = analyzeImprovementOpportunities('/proj', {
    codeSmells: [
      { file: 'a.js', description: 'Long function', severity: 'warning' },
      { file: 'b.js', type: 'complexity' },
    ],
  });
  assertEqual(result.length, 2, 'should find 2 smells');
  assertEqual(result[0].type, ImprovementType.CODE_QUALITY, 'code_quality type');
  assertEqual(result[0].estimatedEffort, 'low', 'warning → low effort');
  assertEqual(result[1].estimatedEffort, 'medium', 'non-warning → medium effort');
});

test('dead symbols detected', () => {
  const result = analyzeImprovementOpportunities('/proj', {
    deadSymbols: [{ file: 'util.js', name: 'oldHelper' }],
  });
  assertEqual(result.length, 1, 'should find 1');
  assertEqual(result[0].type, ImprovementType.DEAD_CODE, 'dead_code type');
  assert(result[0].description.includes('oldHelper'), 'includes symbol name');
});

test('undocumented files detected', () => {
  const result = analyzeImprovementOpportunities('/proj', {
    undocumented: ['api.js', 'utils.js'],
  });
  assertEqual(result.length, 2, 'should find 2');
  assert(result.every(o => o.type === ImprovementType.DOCUMENTATION), 'all documentation');
  assertEqual(result[0].priority, 1, 'lowest priority');
});

test('sorted by priority descending', () => {
  const result = analyzeImprovementOpportunities('/proj', {
    testCoverage: { uncovered: ['x.js'] },
    codeSmells: [{ file: 'y.js', description: 'smell' }],
    deadSymbols: [{ file: 'z.js', name: 'old' }],
    undocumented: ['w.js'],
  });
  assertEqual(result[0].type, ImprovementType.TEST_COVERAGE, 'test_coverage first (4)');
  assertEqual(result[1].type, ImprovementType.CODE_QUALITY, 'code_quality second (3)');
  assertEqual(result[2].type, ImprovementType.DEAD_CODE, 'dead_code third (2)');
  assertEqual(result[3].type, ImprovementType.DOCUMENTATION, 'documentation last (1)');
});

test('maxItems respected', () => {
  const result = analyzeImprovementOpportunities('/proj', {
    testCoverage: { uncovered: ['a.js', 'b.js', 'c.js', 'd.js', 'e.js', 'f.js'] },
    maxItems: 3,
  });
  assertEqual(result.length, 3, 'capped at 3');
});

test('default maxItems is 5', () => {
  const result = analyzeImprovementOpportunities('/proj', {
    testCoverage: { uncovered: ['a.js', 'b.js', 'c.js', 'd.js', 'e.js', 'f.js', 'g.js'] },
  });
  assertEqual(result.length, 5, 'default cap 5');
});

test('same-priority sorted by file name', () => {
  const result = analyzeImprovementOpportunities('/proj', {
    testCoverage: { uncovered: ['z.js', 'a.js', 'm.js'] },
  });
  assertEqual(result[0].file, 'a.js', 'a.js first');
  assertEqual(result[1].file, 'm.js', 'm.js second');
  assertEqual(result[2].file, 'z.js', 'z.js last');
});

test('empty inputs → empty', () => {
  const result = analyzeImprovementOpportunities('/proj', {});
  assertEqual(result.length, 0, 'no opportunities');
});

test('dead symbol with symbol field instead of name', () => {
  const result = analyzeImprovementOpportunities('/proj', {
    deadSymbols: [{ file: 'x.js', symbol: 'deadFn' }],
  });
  assert(result[0].description.includes('deadFn'), 'uses symbol fallback');
});

// ═══════════════════════════════════════════════════════════════════════════
// executeImprovement — TEST_COVERAGE
// ═══════════════════════════════════════════════════════════════════════════

suite('executeImprovement — test coverage');

await testAsync('generates test and applies', async () => {
  const result = await executeImprovement(
    mkImprovement(ImprovementType.TEST_COVERAGE, 'src/app.js'),
    {
      callLLM: mkCallLLM('test("works", () => {});\n'),
      runTests: mkRunTests(true),
      applyPatch: mkApplyPatch(true),
    },
  );
  assert(result.success, 'should succeed');
  assertEqual(result.filesModified.length, 1, '1 file modified');
  assert(result.filesModified[0].includes('.test.'), 'test file created');
  assert(result.linesChanged > 0, 'lines changed');
});

await testAsync('rolls back on test failure', async () => {
  let rolledBack = false;
  const result = await executeImprovement(
    mkImprovement(ImprovementType.TEST_COVERAGE, 'src/app.js'),
    {
      callLLM: mkCallLLM('bad test'),
      runTests: mkRunTests(false),
      applyPatch: mkApplyPatch(true),
      rollback: () => { rolledBack = true; },
    },
  );
  assert(!result.success, 'should fail');
  assert(rolledBack, 'should rollback');
});

await testAsync('fails without callLLM', async () => {
  const result = await executeImprovement(
    mkImprovement(ImprovementType.TEST_COVERAGE, 'src/app.js'),
    {},
  );
  assert(!result.success, 'should fail');
  assert(result.report.includes('No LLM'), 'correct reason');
});

await testAsync('fails on empty LLM output', async () => {
  const result = await executeImprovement(
    mkImprovement(ImprovementType.TEST_COVERAGE, 'src/app.js'),
    { callLLM: mkCallLLM('   ') },
  );
  assert(!result.success, 'should fail');
  assert(result.report.includes('empty'), 'reports empty');
});

// ═══════════════════════════════════════════════════════════════════════════
// executeImprovement — CODE_QUALITY
// ═══════════════════════════════════════════════════════════════════════════

suite('executeImprovement — code quality');

await testAsync('fixes code and applies', async () => {
  const result = await executeImprovement(
    mkImprovement(ImprovementType.CODE_QUALITY, 'src/util.js', 'Long function'),
    {
      callLLM: mkCallLLM('const x = 1;\nmodule.exports = x;\n// refactored'),
      runTests: mkRunTests(true),
      applyPatch: mkApplyPatch(true),
      readFile: mkReadFile(),
    },
  );
  assert(result.success, 'should succeed');
  assert(result.report.includes('Fixed'), 'report says Fixed');
});

await testAsync('rolls back on regression', async () => {
  let rolledBack = false;
  const result = await executeImprovement(
    mkImprovement(ImprovementType.CODE_QUALITY, 'src/util.js'),
    {
      callLLM: mkCallLLM('broken code'),
      runTests: mkRunTests(false),
      applyPatch: mkApplyPatch(true),
      rollback: () => { rolledBack = true; },
      readFile: mkReadFile(),
    },
  );
  assert(!result.success, 'should fail');
  assert(rolledBack, 'should rollback');
});

await testAsync('fails without readFile', async () => {
  const result = await executeImprovement(
    mkImprovement(ImprovementType.CODE_QUALITY, 'src/util.js'),
    { callLLM: mkCallLLM('code') },
  );
  assert(!result.success, 'should fail');
  assert(result.report.includes('Missing'), 'reports missing deps');
});

// ═══════════════════════════════════════════════════════════════════════════
// executeImprovement — DEAD_CODE
// ═══════════════════════════════════════════════════════════════════════════

suite('executeImprovement — dead code');

await testAsync('returns manual review required', async () => {
  const result = await executeImprovement(
    mkImprovement(ImprovementType.DEAD_CODE, 'src/old.js', "Dead code: 'helper'"),
    { readFile: mkReadFile() },
  );
  assert(!result.success, 'not auto-fixable');
  assert(result.report.includes('manual review'), 'requires manual review');
});

await testAsync('fails without readFile', async () => {
  const result = await executeImprovement(
    mkImprovement(ImprovementType.DEAD_CODE, 'src/old.js'),
    {},
  );
  assert(!result.success, 'should fail');
  assert(result.report.includes('Missing'), 'reports missing');
});

// ═══════════════════════════════════════════════════════════════════════════
// executeImprovement — DOCUMENTATION
// ═══════════════════════════════════════════════════════════════════════════

suite('executeImprovement — documentation');

await testAsync('adds docs and applies', async () => {
  const documented = '/** @module util */\nconst x = 1;\nmodule.exports = x;';
  const result = await executeImprovement(
    mkImprovement(ImprovementType.DOCUMENTATION, 'src/util.js'),
    {
      callLLM: mkCallLLM(documented),
      applyPatch: mkApplyPatch(true),
      readFile: mkReadFile(),
    },
  );
  assert(result.success, 'should succeed');
  assert(result.report.includes('Added docs'), 'reports docs added');
  assert(result.linesChanged > 0, 'lines changed');
});

await testAsync('fails on empty LLM output', async () => {
  const result = await executeImprovement(
    mkImprovement(ImprovementType.DOCUMENTATION, 'src/util.js'),
    {
      callLLM: mkCallLLM(''),
      readFile: mkReadFile(),
    },
  );
  assert(!result.success, 'should fail');
  assert(result.report.includes('empty'), 'reports empty');
});

// ═══════════════════════════════════════════════════════════════════════════
// executeImprovement — edge cases
// ═══════════════════════════════════════════════════════════════════════════

suite('executeImprovement — edge cases');

await testAsync('null improvement', async () => {
  const result = await executeImprovement(null);
  assert(!result.success, 'should fail');
  assert(result.report.includes('No improvement'), 'correct reason');
});

await testAsync('unknown type', async () => {
  const result = await executeImprovement({ type: 'unknown_type', file: 'x.js' });
  assert(!result.success, 'should fail');
  assert(result.report.includes('Unknown type'), 'correct reason');
});

await testAsync('exception caught gracefully', async () => {
  const result = await executeImprovement(
    mkImprovement(ImprovementType.TEST_COVERAGE, 'x.js'),
    { callLLM: async () => { throw new Error('LLM crash'); } },
  );
  assert(!result.success, 'should fail');
  assert(result.report.includes('LLM crash'), 'error message preserved');
});

// ═══════════════════════════════════════════════════════════════════════════
// runImprovementCycle
// ═══════════════════════════════════════════════════════════════════════════

suite('runImprovementCycle');

await testAsync('executes pre-analyzed opportunities', async () => {
  const opportunities = [
    mkImprovement(ImprovementType.DOCUMENTATION, 'a.js', 'Missing docs'),
  ];
  const result = await runImprovementCycle('/proj', {
    opportunities,
    callLLM: mkCallLLM('/** docs */\nconst x = 1;'),
    applyPatch: mkApplyPatch(true),
    readFile: mkReadFile(),
  });
  assertEqual(result.completed.length, 1, '1 completed');
  assertEqual(result.failed.length, 0, '0 failed');
  assert(!result.stoppedEarly, 'not stopped early');
});

await testAsync('runs analysis when no opportunities provided', async () => {
  const result = await runImprovementCycle('/proj', {
    analysisOpts: {
      testCoverage: { uncovered: ['a.js'] },
    },
    callLLM: mkCallLLM('test code'),
    applyPatch: mkApplyPatch(true),
    runTests: mkRunTests(true),
  });
  assertEqual(result.improvements.length, 1, '1 opportunity found');
});

await testAsync('filters by type', async () => {
  const opportunities = [
    mkImprovement(ImprovementType.TEST_COVERAGE, 'a.js'),
    mkImprovement(ImprovementType.DOCUMENTATION, 'b.js'),
    mkImprovement(ImprovementType.CODE_QUALITY, 'c.js'),
  ];
  const result = await runImprovementCycle('/proj', {
    opportunities,
    types: [ImprovementType.DOCUMENTATION],
    callLLM: mkCallLLM('/** docs */\nconst x = 1;'),
    applyPatch: mkApplyPatch(true),
    readFile: mkReadFile(),
  });
  // Only documentation type should be attempted
  const attempted = result.completed.length + result.failed.length;
  assertEqual(attempted, 1, 'only 1 type attempted');
});

await testAsync('stops at maxFiles limit', async () => {
  const opportunities = [
    mkImprovement(ImprovementType.DOCUMENTATION, 'a.js'),
    mkImprovement(ImprovementType.DOCUMENTATION, 'b.js'),
    mkImprovement(ImprovementType.DOCUMENTATION, 'c.js'),
  ];
  const result = await runImprovementCycle('/proj', {
    opportunities,
    maxFiles: 1,
    callLLM: mkCallLLM('/** docs */\nconst x = 1;'),
    applyPatch: mkApplyPatch(true),
    readFile: mkReadFile(),
  });
  // First completes (1 file), second should be stopped
  assert(result.stoppedEarly, 'should stop early');
  assertEqual(result.completed.length, 1, 'only 1 completed');
});

await testAsync('stops at maxLines limit', async () => {
  const opportunities = [
    mkImprovement(ImprovementType.DOCUMENTATION, 'a.js'),
    mkImprovement(ImprovementType.DOCUMENTATION, 'b.js'),
  ];
  const result = await runImprovementCycle('/proj', {
    opportunities,
    maxLines: 1,
    callLLM: mkCallLLM('/** docs */\nconst x = 1;\nconst y = 2;'),
    applyPatch: mkApplyPatch(true),
    readFile: mkReadFile(),
  });
  // First completes (~2 lines changed), second should be stopped
  assert(result.stoppedEarly, 'should stop early');
});

await testAsync('failed improvements tracked', async () => {
  const opportunities = [
    mkImprovement(ImprovementType.DEAD_CODE, 'old.js', "Dead code: 'x'"),
  ];
  const result = await runImprovementCycle('/proj', {
    opportunities,
    readFile: mkReadFile(),
  });
  assertEqual(result.failed.length, 1, '1 failed');
  assertEqual(result.completed.length, 0, '0 completed');
});

await testAsync('report included in result', async () => {
  const result = await runImprovementCycle('/proj', {
    opportunities: [],
  });
  assert(typeof result.report === 'string', 'report is string');
});

// ═══════════════════════════════════════════════════════════════════════════
// formatImprovementReport
// ═══════════════════════════════════════════════════════════════════════════

suite('formatImprovementReport');

test('formats completed items', () => {
  const report = formatImprovementReport({
    completed: [{
      type: ImprovementType.TEST_COVERAGE,
      file: 'a.js',
      result: { report: 'Generated tests' },
    }],
    failed: [],
    stoppedEarly: false,
  });
  assert(report.includes('Completed (1)'), 'completed count');
  assert(report.includes('a.js'), 'file name');
  assert(report.includes('Generated tests'), 'result report');
});

test('formats failed items', () => {
  const report = formatImprovementReport({
    completed: [],
    failed: [{
      type: ImprovementType.CODE_QUALITY,
      file: 'b.js',
      result: { report: 'Fix caused regression' },
    }],
    stoppedEarly: false,
  });
  assert(report.includes('Failed (1)'), 'failed count');
  assert(report.includes('regression'), 'failure reason');
});

test('formats stoppedEarly warning', () => {
  const report = formatImprovementReport({
    completed: [{ type: 'x', file: 'a.js', result: { report: 'ok' } }],
    failed: [],
    stoppedEarly: true,
  });
  assert(report.includes('Stopped early'), 'stopped early warning');
});

test('empty → default message', () => {
  const report = formatImprovementReport({
    completed: [],
    failed: [],
    stoppedEarly: false,
  });
  assertEqual(report, 'No improvements executed', 'empty → default');
});

test('null → empty', () => {
  assertEqual(formatImprovementReport(null), '', 'null → empty');
});

test('mixed results', () => {
  const report = formatImprovementReport({
    completed: [
      { type: ImprovementType.TEST_COVERAGE, file: 'a.js', result: { report: 'Tests added' } },
      { type: ImprovementType.DOCUMENTATION, file: 'b.js', result: { report: 'Docs added' } },
    ],
    failed: [
      { type: ImprovementType.CODE_QUALITY, file: 'c.js', result: { report: 'Regression' } },
    ],
    stoppedEarly: true,
  });
  assert(report.includes('Completed (2)'), 'completed 2');
  assert(report.includes('Failed (1)'), 'failed 1');
  assert(report.includes('Stopped early'), 'stopped early');
});

// ═══════════════════════════════════════════════════════════════════════════

summary();
