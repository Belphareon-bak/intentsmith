// tests/fix-strategy.test.js — Fix Strategy (F10) unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual, summary } from './harness.js';
import {
  StrategyType,
  selectFixStrategy,
  buildDeterministicPatch,
  validateDeterministicPatch,
  buildHeuristicHint,
  formatStrategyReport,
} from '../src/planner/fix-strategy.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function mkError(code, file = 'app.js', opts = {}) {
  return {
    code,
    file,
    line: opts.line ?? 10,
    symbol: opts.symbol ?? null,
    message: opts.message ?? `Error: ${code}`,
    raw: opts.raw ?? `Error: ${code}`,
    severity: opts.severity ?? 'error',
    category: opts.category ?? 'compile',
    recoverable: opts.recoverable ?? true,
    derivedFrom: opts.derivedFrom ?? null,
  };
}

function mkArchetype(errorCode, strategy = 'Fixed it', confidence = 0.85) {
  return { errorCode, strategy, confidence };
}

// ═══════════════════════════════════════════════════════════════════════════
// StrategyType enum
// ═══════════════════════════════════════════════════════════════════════════

suite('StrategyType');

test('all types defined', () => {
  assertEqual(StrategyType.DETERMINISTIC, 'deterministic', 'DETERMINISTIC');
  assertEqual(StrategyType.HEURISTIC, 'heuristic', 'HEURISTIC');
  assertEqual(StrategyType.LLM_FULL, 'llm_full', 'LLM_FULL');
  assertEqual(StrategyType.SKIP, 'skip', 'SKIP');
});

test('is frozen', () => {
  assert(Object.isFrozen(StrategyType), 'should be frozen');
});

// ═══════════════════════════════════════════════════════════════════════════
// selectFixStrategy
// ═══════════════════════════════════════════════════════════════════════════

suite('selectFixStrategy');

test('UNUSED_IMPORT → DETERMINISTIC', () => {
  const errors = [mkError('UNUSED_IMPORT', 'a.js', { symbol: 'lodash' })];
  const map = selectFixStrategy(errors, [], 1);
  assertEqual(map.get(errors[0]).type, StrategyType.DETERMINISTIC, 'should be deterministic');
  assert(map.get(errors[0]).template === 'remove_unused_import', 'correct template');
});

test('SYNTAX_ERROR with semicolon → DETERMINISTIC', () => {
  const errors = [mkError('SYNTAX_ERROR', 'a.js', { message: 'Missing semicolon at end' })];
  const map = selectFixStrategy(errors, [], 1);
  assertEqual(map.get(errors[0]).type, StrategyType.DETERMINISTIC, 'should be deterministic');
});

test('IMPORT_NOT_FOUND with archetype → DETERMINISTIC', () => {
  const errors = [mkError('IMPORT_NOT_FOUND', 'a.js', { symbol: 'utils' })];
  const archetypes = [mkArchetype('IMPORT_NOT_FOUND', 'Added missing import path')];
  const map = selectFixStrategy(errors, archetypes, 1);
  assertEqual(map.get(errors[0]).type, StrategyType.DETERMINISTIC, 'should be deterministic');
  assert(map.get(errors[0]).archetype, 'should have archetype ref');
});

test('IMPORT_NOT_FOUND without archetype → LLM_FULL', () => {
  const errors = [mkError('IMPORT_NOT_FOUND', 'a.js')];
  const map = selectFixStrategy(errors, [], 1);
  // IMPORT_NOT_FOUND has no standard heuristic hint AND no archetype → should have a hint via UNDEFINED_VARIABLE check
  // Actually IMPORT_NOT_FOUND isn't in HEURISTIC_HINTS, so it falls to LLM_FULL
  assertEqual(map.get(errors[0]).type, StrategyType.LLM_FULL, 'no archetype → LLM_FULL');
});

test('NULL_REFERENCE → HEURISTIC', () => {
  const errors = [mkError('NULL_REFERENCE', 'b.js')];
  const map = selectFixStrategy(errors, [], 1);
  assertEqual(map.get(errors[0]).type, StrategyType.HEURISTIC, 'should be heuristic');
  assert(map.get(errors[0]).hint.includes('null'), 'hint mentions null check');
});

test('ASSERTION_FAILED → HEURISTIC', () => {
  const errors = [mkError('ASSERTION_FAILED', 'test.js')];
  const map = selectFixStrategy(errors, [], 1);
  assertEqual(map.get(errors[0]).type, StrategyType.HEURISTIC, 'should be heuristic');
});

test('TYPE_MISMATCH → HEURISTIC', () => {
  const errors = [mkError('TYPE_MISMATCH', 'c.js')];
  const map = selectFixStrategy(errors, [], 1);
  assertEqual(map.get(errors[0]).type, StrategyType.HEURISTIC, 'should be heuristic');
});

test('PERMISSION_DENIED → SKIP', () => {
  const errors = [mkError('PERMISSION_DENIED', '/etc/passwd')];
  const map = selectFixStrategy(errors, [], 1);
  assertEqual(map.get(errors[0]).type, StrategyType.SKIP, 'should be skip');
});

test('UNKNOWN error → LLM_FULL', () => {
  const errors = [mkError('UNKNOWN', 'x.js')];
  const map = selectFixStrategy(errors, [], 1);
  assertEqual(map.get(errors[0]).type, StrategyType.LLM_FULL, 'unknown → LLM_FULL');
});

test('archetype for unknown error → HEURISTIC', () => {
  const errors = [mkError('CUSTOM_ERR', 'x.js')];
  const archetypes = [mkArchetype('CUSTOM_ERR', 'Custom fix')];
  const map = selectFixStrategy(errors, archetypes, 1);
  assertEqual(map.get(errors[0]).type, StrategyType.HEURISTIC, 'archetype provides hint → heuristic');
});

test('stale error (3+ iterations) → SKIP', () => {
  const error = mkError('TYPE_MISMATCH', 'a.js', { line: 5 });
  const sameError = mkError('TYPE_MISMATCH', 'a.js', { line: 5 });
  const errorHistory = [
    [sameError],
    [sameError],
    [sameError],
  ];
  const map = selectFixStrategy([error], [], 3, { errorHistory });
  assertEqual(map.get(error).type, StrategyType.SKIP, 'stale error → skip');
});

test('HEURISTIC with archetype enhances hint', () => {
  const errors = [mkError('NULL_REFERENCE', 'svc.js')];
  const archetypes = [mkArchetype('NULL_REFERENCE', 'Added optional chaining')];
  const map = selectFixStrategy(errors, archetypes, 1);
  assertEqual(map.get(errors[0]).type, StrategyType.HEURISTIC, 'still heuristic');
  assert(map.get(errors[0]).hint.includes('optional chaining'), 'hint includes archetype strategy');
});

test('mixed errors → mixed strategies', () => {
  const errors = [
    mkError('UNUSED_IMPORT', 'a.js', { symbol: 'x' }),
    mkError('NULL_REFERENCE', 'b.js'),
    mkError('PERMISSION_DENIED', 'c.js'),
    mkError('UNKNOWN', 'd.js'),
  ];
  const map = selectFixStrategy(errors, [], 1);
  assertEqual(map.get(errors[0]).type, StrategyType.DETERMINISTIC, 'unused → det');
  assertEqual(map.get(errors[1]).type, StrategyType.HEURISTIC, 'null ref → heur');
  assertEqual(map.get(errors[2]).type, StrategyType.SKIP, 'perm → skip');
  assertEqual(map.get(errors[3]).type, StrategyType.LLM_FULL, 'unknown → llm');
});

// ═══════════════════════════════════════════════════════════════════════════
// buildDeterministicPatch
// ═══════════════════════════════════════════════════════════════════════════

suite('buildDeterministicPatch');

test('removes unused import line', () => {
  const error = mkError('UNUSED_IMPORT', 'a.js', { line: 3, symbol: 'lodash' });
  const strategy = { type: StrategyType.DETERMINISTIC, template: 'remove_unused_import' };
  const content = "import foo from 'foo';\nimport bar from 'bar';\nimport lodash from 'lodash';\nconst x = 1;";
  const patch = buildDeterministicPatch(error, strategy, content);

  assert(patch !== null, 'should produce a patch');
  assertEqual(patch.file, 'a.js', 'correct file');
  assert(patch.patchText.includes('- import lodash'), 'removes the import line');
});

test('syntax fix adds semicolon', () => {
  const error = mkError('SYNTAX_ERROR', 'b.js', { line: 2, message: 'Missing semicolon' });
  const strategy = { type: StrategyType.DETERMINISTIC, template: 'fix_trivial_syntax' };
  const content = "const x = 1;\nconst y = 2\nconst z = 3;";
  const patch = buildDeterministicPatch(error, strategy, content);

  assert(patch !== null, 'should produce a patch');
  assert(patch.patchText.includes('+ const y = 2;'), 'adds semicolon');
});

test('returns null for non-deterministic strategy', () => {
  const error = mkError('UNKNOWN', 'c.js');
  const strategy = { type: StrategyType.LLM_FULL };
  const patch = buildDeterministicPatch(error, strategy, 'code');
  assertEqual(patch, null, 'non-det → null');
});

test('returns null for null inputs', () => {
  assertEqual(buildDeterministicPatch(null, null, null), null, 'null → null');
});

test('returns null when line out of range', () => {
  const error = mkError('UNUSED_IMPORT', 'a.js', { line: 999, symbol: 'x' });
  const strategy = { type: StrategyType.DETERMINISTIC, template: 'remove_unused_import' };
  const patch = buildDeterministicPatch(error, strategy, 'one line');
  assertEqual(patch, null, 'out of range → null');
});

test('import fix template returns null (complex, defers to LLM)', () => {
  const error = mkError('IMPORT_NOT_FOUND', 'a.js', { symbol: 'utils' });
  const strategy = { type: StrategyType.DETERMINISTIC, template: 'fix_import', archetype: mkArchetype('IMPORT_NOT_FOUND') };
  const patch = buildDeterministicPatch(error, strategy, 'code');
  assertEqual(patch, null, 'import fix is too complex → null');
});

// ═══════════════════════════════════════════════════════════════════════════
// validateDeterministicPatch
// ═══════════════════════════════════════════════════════════════════════════

suite('validateDeterministicPatch');

test('valid removal (balanced brackets)', () => {
  const patch = { patchText: '--- a.js\n@@ line 3\n- import lodash from \'lodash\';\n', file: 'a.js' };
  const content = "import foo from 'foo';\nimport bar from 'bar';\nimport lodash from 'lodash';\n";
  const result = validateDeterministicPatch(patch, content);
  assertEqual(result.valid, true, 'should be valid');
});

test('rejects removal of unbalanced brackets', () => {
  const patch = { patchText: '--- a.js\n- if (x) {\n', file: 'a.js' };
  const content = 'if (x) {\n  foo();\n}\n';
  const result = validateDeterministicPatch(patch, content);
  assertEqual(result.valid, false, 'unbalanced → invalid');
  assert(result.reason.includes('Unbalanced'), 'reason mentions unbalanced');
});

test('valid substitution', () => {
  const patch = { patchText: '--- a.js\n- const y = 2\n+ const y = 2;\n', file: 'a.js' };
  const content = 'const x = 1;\nconst y = 2\n';
  const result = validateDeterministicPatch(patch, content);
  assertEqual(result.valid, true, 'substitution should be valid');
});

test('rejects empty replacement', () => {
  const patch = { patchText: '--- a.js\n- const x = 1;\n+   \n', file: 'a.js' };
  const content = 'const x = 1;\n';
  const result = validateDeterministicPatch(patch, content);
  assertEqual(result.valid, false, 'empty replacement → invalid');
});

test('null inputs → invalid', () => {
  const result = validateDeterministicPatch(null, null);
  assertEqual(result.valid, false, 'null → invalid');
});

// ═══════════════════════════════════════════════════════════════════════════
// buildHeuristicHint
// ═══════════════════════════════════════════════════════════════════════════

suite('buildHeuristicHint');

test('formats error with hint', () => {
  const error = mkError('NULL_REFERENCE', 'svc.js', { line: 42, message: 'Cannot read property of null' });
  const strategy = { type: StrategyType.HEURISTIC, hint: 'Add null check' };
  const result = buildHeuristicHint(error, strategy);
  assert(result.includes('NULL_REFERENCE'), 'includes error code');
  assert(result.includes('svc.js:42'), 'includes location');
  assert(result.includes('Add null check'), 'includes hint');
});

test('includes archetype info', () => {
  const error = mkError('TYPE_MISMATCH', 'api.js');
  const strategy = { type: StrategyType.HEURISTIC, hint: 'Check types' };
  const archetype = mkArchetype('TYPE_MISMATCH', 'Cast to string', 0.9);
  const result = buildHeuristicHint(error, strategy, archetype);
  assert(result.includes('Cast to string'), 'includes archetype strategy');
  assert(result.includes('90%'), 'includes confidence');
});

test('no archetype → still works', () => {
  const error = mkError('ASSERTION_FAILED', 'test.js');
  const strategy = { type: StrategyType.HEURISTIC, hint: 'Compare values' };
  const result = buildHeuristicHint(error, strategy, null);
  assert(result.includes('Compare values'), 'includes hint without archetype');
  assert(!result.includes('Past successful fix'), 'no archetype section');
});

test('null strategy → still formats error', () => {
  const error = mkError('UNKNOWN', 'x.js');
  const result = buildHeuristicHint(error, null);
  assert(result.includes('UNKNOWN'), 'includes error code');
});

test('null error → empty string', () => {
  assertEqual(buildHeuristicHint(null, null), '', 'null → empty');
});

// ═══════════════════════════════════════════════════════════════════════════
// formatStrategyReport
// ═══════════════════════════════════════════════════════════════════════════

suite('formatStrategyReport');

test('formats mixed strategies', () => {
  const map = new Map();
  map.set({}, { type: StrategyType.DETERMINISTIC });
  map.set({}, { type: StrategyType.HEURISTIC });
  map.set({}, { type: StrategyType.HEURISTIC });
  map.set({}, { type: StrategyType.LLM_FULL });
  map.set({}, { type: StrategyType.SKIP });

  const report = formatStrategyReport(map);
  assert(report.includes('1 deterministic'), 'det count');
  assert(report.includes('2 heuristic'), 'heur count');
  assert(report.includes('1 LLM'), 'llm count');
  assert(report.includes('1 skipped'), 'skip count');
});

test('all deterministic', () => {
  const map = new Map();
  map.set({}, { type: StrategyType.DETERMINISTIC });
  map.set({}, { type: StrategyType.DETERMINISTIC });
  const report = formatStrategyReport(map);
  assert(report.includes('2 deterministic'), '2 det');
  assert(report.includes('0 LLM'), '0 llm');
});

test('empty map → empty string', () => {
  assertEqual(formatStrategyReport(new Map()), '', 'empty → empty');
  assertEqual(formatStrategyReport(null), '', 'null → empty');
});

// ═══════════════════════════════════════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════════════════════════════════════

suite('edge cases');

test('empty errors', () => {
  const map = selectFixStrategy([], [], 1);
  assertEqual(map.size, 0, 'empty → empty map');
});

test('null errors', () => {
  const map = selectFixStrategy(null, null, 1);
  assertEqual(map.size, 0, 'null → empty map');
});

test('high iteration without history → no stale detection', () => {
  const errors = [mkError('TYPE_MISMATCH', 'a.js')];
  const map = selectFixStrategy(errors, [], 10);
  // Without errorHistory, stale detection can't fire
  assertEqual(map.get(errors[0]).type, StrategyType.HEURISTIC, 'no stale without history');
});

test('all skipped', () => {
  const errors = [
    mkError('PERMISSION_DENIED', 'a'),
    mkError('PERMISSION_DENIED', 'b'),
  ];
  const map = selectFixStrategy(errors, [], 1);
  for (const [, s] of map) {
    assertEqual(s.type, StrategyType.SKIP, 'all should be skip');
  }
});

// ═══════════════════════════════════════════════════════════════════════════

summary();
