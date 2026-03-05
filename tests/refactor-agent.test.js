// tests/refactor-agent.test.js — Refactor Agent v100 tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import {
  SmellType,
  detectSmells,
  generateRefactorPlan,
  formatRefactorReport,
} from '../src/code-intel/refactor-agent.js';

// ─── SmellType ──────────────────────────────────────────────────────────────

suite('Refactor Agent — SmellType');

test('has all smell types', () => {
  assertEqual(SmellType.DEAD_CODE, 'dead_code');
  assertEqual(SmellType.DUPLICATE_LOGIC, 'duplicate_logic');
  assertEqual(SmellType.GOD_CLASS, 'god_class');
  assertEqual(SmellType.LAYER_VIOLATION, 'layer_violation');
  assertEqual(SmellType.CIRCULAR_DEPENDENCY, 'circular_dep');
  assertEqual(SmellType.MISSING_ERROR_HANDLING, 'missing_error_handling');
});

test('SmellType is frozen', () => {
  assert(Object.isFrozen(SmellType), 'SmellType should be frozen');
});

// ─── detectSmells ───────────────────────────────────────────────────────────

suite('Refactor Agent — detectSmells');

await testAsync('detects dead code from deadCodeResult', async () => {
  const smells = await detectSmells('/tmp/test', {
    deadCodeResult: {
      unreachable: [
        { file: 'src/old.js', name: 'unusedFn', kind: 'function' },
        { file: 'src/legacy.js', name: 'deprecatedClass', kind: 'class' },
      ],
    },
  });
  assertEqual(smells.length, 2);
  assertEqual(smells[0].type, SmellType.DEAD_CODE);
  assert(smells[0].description.includes('unusedFn'), 'should include symbol name');
});

await testAsync('detects layer violations from driftResult', async () => {
  const smells = await detectSmells('/tmp/test', {
    driftResult: {
      violations: [
        { file: 'src/model/user.js', sourceLayer: 'model', targetLayer: 'controller', message: 'model imports controller' },
      ],
    },
  });
  const violations = smells.filter(s => s.type === SmellType.LAYER_VIOLATION);
  assertEqual(violations.length, 1);
  assertEqual(violations[0].severity, 'MEDIUM');
});

await testAsync('detects circular dependencies', async () => {
  const smells = await detectSmells('/tmp/test', {
    driftResult: {
      violations: [],
      circularDependencies: [
        { files: ['src/a.js', 'src/b.js', 'src/a.js'] },
      ],
    },
  });
  const circular = smells.filter(s => s.type === SmellType.CIRCULAR_DEPENDENCY);
  assertEqual(circular.length, 1);
  assertEqual(circular[0].severity, 'HIGH');
  assert(circular[0].description.includes('Circular'), 'should mention circular');
});

await testAsync('detects god classes (>500 lines)', async () => {
  const bigContent = 'line\n'.repeat(600);
  const smells = await detectSmells('/tmp/test', {
    files: [{ file: 'src/god.js', content: bigContent }],
  });
  const gods = smells.filter(s => s.type === SmellType.GOD_CLASS);
  assertEqual(gods.length, 1);
  assert(/\d+\s+lines/.test(gods[0].description), 'should mention line count');
});

await testAsync('detects missing error handling in async code', async () => {
  const asyncContent = `
async function fetchData() {
  const result = await fetch('/api/data');
  return result.json();
}
// enough lines to be >50
${'// padding\n'.repeat(50)}
`;
  const smells = await detectSmells('/tmp/test', {
    files: [{ file: 'src/fetcher.js', content: asyncContent }],
  });
  const missing = smells.filter(s => s.type === SmellType.MISSING_ERROR_HANDLING);
  assertEqual(missing.length, 1);
});

await testAsync('does NOT flag async code with try/catch', async () => {
  const safeContent = `
async function fetchData() {
  try {
    const result = await fetch('/api/data');
    return result.json();
  } catch (err) {
    return null;
  }
}
${'// padding\n'.repeat(50)}
`;
  const smells = await detectSmells('/tmp/test', {
    files: [{ file: 'src/safe.js', content: safeContent }],
  });
  const missing = smells.filter(s => s.type === SmellType.MISSING_ERROR_HANDLING);
  assertEqual(missing.length, 0);
});

await testAsync('deduplicates by file+type', async () => {
  const smells = await detectSmells('/tmp/test', {
    deadCodeResult: {
      unreachable: [
        { file: 'src/old.js', name: 'fn1', kind: 'function' },
        { file: 'src/old.js', name: 'fn2', kind: 'function' },
      ],
    },
  });
  // Both are dead_code in src/old.js → deduplicated to 1
  assertEqual(smells.length, 1);
});

await testAsync('sorts by severity (HIGH first)', async () => {
  const smells = await detectSmells('/tmp/test', {
    deadCodeResult: {
      unreachable: [{ file: 'src/unused.js', name: 'x', kind: 'var' }],
    },
    driftResult: {
      violations: [{ file: 'src/v.js', sourceLayer: 'a', targetLayer: 'b', message: 'bad' }],
      circularDependencies: [{ files: ['src/c1.js', 'src/c2.js'] }],
    },
  });
  assertEqual(smells[0].severity, 'HIGH');  // circular
  assertEqual(smells[1].severity, 'MEDIUM'); // violation
  assertEqual(smells[2].severity, 'LOW');   // dead code
});

await testAsync('returns empty for no inputs', async () => {
  const smells = await detectSmells('/tmp/test', {});
  assertEqual(smells.length, 0);
});

// ─── generateRefactorPlan ───────────────────────────────────────────────────

suite('Refactor Agent — generateRefactorPlan');

test('generates plan with safe steps', () => {
  const smells = [
    { type: SmellType.DEAD_CODE, file: 'src/old.js', symbol: 'unused', severity: 'LOW' },
  ];
  const plan = generateRefactorPlan(smells, {
    coverageMap: { 'src/old.js': true },
  });
  assertEqual(plan.safeSteps, 1);
  assertEqual(plan.unsafeSteps, 0);
  assert(plan.steps[0].action.includes('Remove'), 'should suggest removal');
});

test('dead code is safe even without coverage', () => {
  const smells = [
    { type: SmellType.DEAD_CODE, file: 'src/old.js', symbol: 'unused', severity: 'LOW' },
  ];
  const plan = generateRefactorPlan(smells, {
    coverageMap: {}, // no coverage
  });
  assertEqual(plan.safeSteps, 1); // dead code exempt from coverage requirement
});

test('skips non-dead-code without coverage', () => {
  const smells = [
    { type: SmellType.LAYER_VIOLATION, file: 'src/v.js', severity: 'MEDIUM' },
  ];
  const plan = generateRefactorPlan(smells, {
    coverageMap: {}, // no coverage
  });
  assertEqual(plan.safeSteps, 0);
  assertEqual(plan.unsafeSteps, 1);
  assert(plan.skippedSteps[0].reason.includes('no test coverage'), 'should mention coverage');
});

test('respects maxSteps', () => {
  const smells = Array.from({ length: 10 }, (_, i) => ({
    type: SmellType.DEAD_CODE,
    file: `src/f${i}.js`,
    symbol: `fn${i}`,
    severity: 'LOW',
  }));
  const plan = generateRefactorPlan(smells, { maxSteps: 3 });
  assertEqual(plan.safeSteps, 3);
  assertEqual(plan.unsafeSteps, 7);
});

test('calculates totalRisk as average', () => {
  const smells = [
    { type: SmellType.DEAD_CODE, file: 'src/a.js', symbol: 'a', severity: 'LOW' },
    { type: SmellType.DEAD_CODE, file: 'src/b.js', symbol: 'b', severity: 'LOW' },
  ];
  const plan = generateRefactorPlan(smells);
  assertEqual(plan.totalRisk, 0); // no impact results → all riskScore=0
});

test('handles empty smells', () => {
  const plan = generateRefactorPlan([]);
  assertEqual(plan.safeSteps, 0);
  assertEqual(plan.unsafeSteps, 0);
  assertEqual(plan.totalRisk, 0);
});

test('action suggestions for each smell type', () => {
  const types = [
    SmellType.DEAD_CODE,
    SmellType.LAYER_VIOLATION,
    SmellType.CIRCULAR_DEPENDENCY,
    SmellType.GOD_CLASS,
    SmellType.MISSING_ERROR_HANDLING,
    SmellType.DUPLICATE_LOGIC,
  ];
  for (const type of types) {
    const plan = generateRefactorPlan(
      [{ type, file: 'x.js', symbol: 'x', severity: 'LOW' }],
      { coverageMap: { 'x.js': true } }
    );
    assert(plan.steps[0].action.length > 0, `${type} should have action suggestion`);
  }
});

// ─── formatRefactorReport ───────────────────────────────────────────────────

suite('Refactor Agent — formatRefactorReport');

test('formats plan with safe and skipped steps', () => {
  const plan = {
    steps: [
      { smell: { type: SmellType.DEAD_CODE, file: 'src/a.js' }, action: 'Remove unused x', riskScore: 5 },
    ],
    skippedSteps: [
      { smell: { file: 'src/b.js' }, reason: 'risk too high' },
    ],
    safeSteps: 1,
    unsafeSteps: 1,
  };
  const report = formatRefactorReport(plan);
  assert(report.includes('Safe steps: 1'), 'should show safe count');
  assert(report.includes('Skipped: 1'), 'should show skipped count');
  assert(report.includes('Remove unused x'), 'should show action');
  assert(report.includes('risk too high'), 'should show skip reason');
});

test('formats applied results', () => {
  const report = formatRefactorReport({
    steps: [],
    skippedSteps: [],
    safeSteps: 0,
    unsafeSteps: 0,
    applied: [{ file: 'src/a.js', action: 'Removed dead code' }],
  });
  assert(report.includes('Applied'), 'should include Applied section');
  assert(report.includes('src/a.js'), 'should include file');
});

test('formats failed results', () => {
  const report = formatRefactorReport({
    steps: [],
    skippedSteps: [],
    safeSteps: 0,
    unsafeSteps: 0,
    failed: [{ file: 'src/b.js', error: 'Tests failed after patch' }],
  });
  assert(report.includes('Failed'), 'should include Failed section');
  assert(report.includes('Tests failed'), 'should include error');
});

test('returns empty string for null', () => {
  assertEqual(formatRefactorReport(null), '');
});

// ─── Summary ────────────────────────────────────────────────────────────────

summary();
