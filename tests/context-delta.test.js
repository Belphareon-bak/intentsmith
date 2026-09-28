// tests/context-delta.test.js — Context Delta Engine (FΔ) unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual, summary } from './harness.js';
import {
  hashSection,
  createContextSnapshot,
  computeContextDelta,
  formatFullContext,
  formatDeltaForPrompt,
  estimateTokenSavings,
} from '../src/context/context-delta.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function mkContext(overrides = {}) {
  return {
    errors: '- [SYNTAX_ERROR] src/app.js:10 Unexpected token',
    patches: '--- src/app.js\n@@ function main\n- bad\n+ good',
    files: 'src/app.js, src/util.js',
    taskMemory: '[WORKED] SYNTAX_ERROR: bracket fix (80%)',
    critique: 'Root cause: missing closing bracket',
    gitDiff: 'diff --git a/src/app.js\n+ good line',
    ...overrides,
  };
}

function mkContext2(overrides = {}) {
  return {
    errors: '- [TYPE_MISMATCH] src/db.js:22 Expected string, got number',
    patches: '--- src/db.js\n@@ function query\n- old\n+ new',
    files: 'src/app.js, src/util.js, src/db.js',
    taskMemory: '[WORKED] SYNTAX_ERROR: bracket fix (80%)',
    critique: 'Root cause: type coercion in query builder',
    gitDiff: 'diff --git a/src/db.js\n+ fixed type',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// hashSection
// ═══════════════════════════════════════════════════════════════════════════

suite('hashSection');

test('deterministic — same input → same hash', () => {
  const a = hashSection('hello world');
  const b = hashSection('hello world');
  assertEqual(a, b, 'same input should produce same hash');
});

test('different input → different hash', () => {
  const a = hashSection('hello');
  const b = hashSection('world');
  assert(a !== b, 'different input should produce different hash');
});

test('empty string → consistent hash', () => {
  const a = hashSection('');
  assertEqual(a, '0', 'empty string should hash to 0');
});

test('null → consistent hash', () => {
  const a = hashSection(null);
  assertEqual(a, '0', 'null should hash to 0');
});

test('large content hashes without error', () => {
  const big = 'x'.repeat(100_000);
  const h = hashSection(big);
  assert(typeof h === 'string' && h.length > 0, 'should hash large content');
});

// ═══════════════════════════════════════════════════════════════════════════
// createContextSnapshot
// ═══════════════════════════════════════════════════════════════════════════

suite('createContextSnapshot');

test('captures all sections', () => {
  const ctx = mkContext();
  const snap = createContextSnapshot(ctx);

  assertEqual(snap.sections.errors, ctx.errors, 'errors captured');
  assertEqual(snap.sections.patches, ctx.patches, 'patches captured');
  assertEqual(snap.sections.files, ctx.files, 'files captured');
  assertEqual(snap.sections.taskMemory, ctx.taskMemory, 'taskMemory captured');
  assertEqual(snap.sections.critique, ctx.critique, 'critique captured');
  assertEqual(snap.sections.gitDiff, ctx.gitDiff, 'gitDiff captured');
});

test('generates hashes for all sections', () => {
  const snap = createContextSnapshot(mkContext());
  assert(typeof snap.hashes.errors === 'string', 'errors hash');
  assert(typeof snap.hashes.patches === 'string', 'patches hash');
  assert(typeof snap.hashes.gitDiff === 'string', 'gitDiff hash');
});

test('includes timestamp', () => {
  const before = Date.now();
  const snap = createContextSnapshot(mkContext());
  assert(snap.timestamp >= before, 'timestamp should be recent');
});

test('null context → empty snapshot', () => {
  const snap = createContextSnapshot(null);
  assert(typeof snap.hashes === 'object', 'hashes object');
  assert(typeof snap.sections === 'object', 'sections object');
});

test('missing fields default to empty string', () => {
  const snap = createContextSnapshot({ errors: 'some error' });
  assertEqual(snap.sections.patches, '', 'missing patches → empty');
  assertEqual(snap.sections.critique, '', 'missing critique → empty');
});

// ═══════════════════════════════════════════════════════════════════════════
// computeContextDelta
// ═══════════════════════════════════════════════════════════════════════════

suite('computeContextDelta');

test('first iteration (null prev) → isFirstIteration', () => {
  const snap = createContextSnapshot(mkContext());
  const delta = computeContextDelta(null, snap);

  assertEqual(delta.isFirstIteration, true, 'should be first iteration');
  assertEqual(delta.changed.size, 6, 'all sections changed');
});

test('no changes → all unchanged', () => {
  const ctx = mkContext();
  const snap1 = createContextSnapshot(ctx);
  const snap2 = createContextSnapshot(ctx);
  const delta = computeContextDelta(snap1, snap2);

  assertEqual(delta.isFirstIteration, false, 'not first');
  assertEqual(delta.changed.size, 0, 'nothing changed');
  assertEqual(delta.unchanged.length, 6, 'all unchanged');
});

test('errors changed → detected', () => {
  const snap1 = createContextSnapshot(mkContext());
  const snap2 = createContextSnapshot(mkContext({ errors: '- [TYPE_MISMATCH] new error' }));
  const delta = computeContextDelta(snap1, snap2);

  assert(delta.changed.has('errors'), 'errors should be changed');
  assert(!delta.changed.has('taskMemory'), 'taskMemory should not be changed');
});

test('multiple sections changed', () => {
  const snap1 = createContextSnapshot(mkContext());
  const snap2 = createContextSnapshot(mkContext2());
  const delta = computeContextDelta(snap1, snap2);

  assert(delta.changed.has('errors'), 'errors changed');
  assert(delta.changed.has('patches'), 'patches changed');
  assert(delta.changed.has('critique'), 'critique changed');
  assert(delta.changed.has('gitDiff'), 'gitDiff changed');
  // taskMemory is the same in both contexts
  assert(!delta.changed.has('taskMemory'), 'taskMemory unchanged');
});

test('error delta — added and resolved', () => {
  const snap1 = createContextSnapshot(mkContext({
    errors: '- [SYNTAX_ERROR] a.js:1 bad syntax\n- [UNUSED_IMPORT] b.js:2 unused',
  }));
  const snap2 = createContextSnapshot(mkContext({
    errors: '- [SYNTAX_ERROR] a.js:1 bad syntax\n- [TYPE_MISMATCH] c.js:3 wrong type',
  }));
  const delta = computeContextDelta(snap1, snap2);

  assert(delta.delta.errors, 'should have error delta');
  assertEqual(delta.delta.errors.addedCount, 1, '1 new error');
  assertEqual(delta.delta.errors.resolvedCount, 1, '1 resolved error');
});

test('stats computation', () => {
  const snap1 = createContextSnapshot(mkContext());
  const snap2 = createContextSnapshot(mkContext2());
  const delta = computeContextDelta(snap1, snap2);

  assert(delta.stats.sectionsChanged > 0, 'some changed');
  assertEqual(delta.stats.sectionsChanged + delta.stats.sectionsUnchanged, 6, 'total = 6');
});

test('null current snapshot', () => {
  const delta = computeContextDelta(null, null);
  assertEqual(delta.isFirstIteration, true, 'null → first iteration');
});

// ═══════════════════════════════════════════════════════════════════════════
// formatFullContext
// ═══════════════════════════════════════════════════════════════════════════

suite('formatFullContext');

test('includes all non-empty sections', () => {
  const snap = createContextSnapshot(mkContext());
  const full = formatFullContext(snap);

  assert(full.includes('SYNTAX_ERROR'), 'includes errors');
  assert(full.includes('Past Fix Experience'), 'includes task memory');
  assert(full.includes('Self-Critique'), 'includes critique');
  assert(full.includes('Previous Patches'), 'includes patches');
  assert(full.includes('Current Git Diff'), 'includes git diff');
});

test('omits empty sections', () => {
  const snap = createContextSnapshot({ errors: 'err', patches: '', files: '', taskMemory: '', critique: '', gitDiff: '' });
  const full = formatFullContext(snap);

  assert(full.includes('err'), 'includes errors');
  assert(!full.includes('Past Fix'), 'omits empty task memory');
  assert(!full.includes('Self-Critique'), 'omits empty critique');
});

test('null snapshot → empty string', () => {
  assertEqual(formatFullContext(null), '', 'null → empty');
  assertEqual(formatFullContext({}), '', 'empty obj → empty');
});

// ═══════════════════════════════════════════════════════════════════════════
// formatDeltaForPrompt
// ═══════════════════════════════════════════════════════════════════════════

suite('formatDeltaForPrompt');

test('first iteration → full context', () => {
  const snap = createContextSnapshot(mkContext());
  const delta = computeContextDelta(null, snap);
  const prompt = formatDeltaForPrompt(delta, snap);

  assert(prompt.includes('SYNTAX_ERROR'), 'full errors');
  assert(prompt.includes('Past Fix Experience'), 'full task memory');
});

test('delta — shows error changes', () => {
  const snap1 = createContextSnapshot(mkContext({
    errors: '- [SYNTAX_ERROR] a.js:1 bad',
  }));
  const snap2 = createContextSnapshot(mkContext({
    errors: '- [TYPE_MISMATCH] b.js:2 wrong',
  }));
  const delta = computeContextDelta(snap1, snap2);
  const prompt = formatDeltaForPrompt(delta, snap2);

  assert(prompt.includes('Error Changes'), 'shows error changes header');
  assert(prompt.includes('RESOLVED'), 'shows resolved');
  assert(prompt.includes('NEW ERRORS'), 'shows new errors');
});

test('delta — unchanged sections summarized', () => {
  const ctx = mkContext();
  const snap1 = createContextSnapshot(ctx);
  // Only change errors
  const snap2 = createContextSnapshot({ ...ctx, errors: 'new error' });
  const delta = computeContextDelta(snap1, snap2);
  const prompt = formatDeltaForPrompt(delta, snap2);

  assert(prompt.includes('Unchanged from previous iteration'), 'shows unchanged summary');
  assert(prompt.includes('taskMemory'), 'lists unchanged sections');
});

test('delta — changed critique shown in full', () => {
  const snap1 = createContextSnapshot(mkContext());
  const snap2 = createContextSnapshot(mkContext({ critique: 'new analysis' }));
  const delta = computeContextDelta(snap1, snap2);
  const prompt = formatDeltaForPrompt(delta, snap2);

  assert(prompt.includes('Self-Critique Analysis (updated)'), 'updated critique');
  assert(prompt.includes('new analysis'), 'full critique content');
});

test('all sections changed → no unchanged summary', () => {
  const snap1 = createContextSnapshot(mkContext());
  const snap2 = createContextSnapshot(mkContext2());
  const delta = computeContextDelta(snap1, snap2);
  const prompt = formatDeltaForPrompt(delta, snap2);

  // taskMemory is same in both → still have unchanged
  assert(prompt.includes('Unchanged') || !delta.unchanged.some(n => snap2.sections[n]?.trim()),
    'unchanged summary only for non-empty unchanged');
});

test('null inputs → empty string', () => {
  assertEqual(formatDeltaForPrompt(null, null), '', 'null → empty');
});

// ═══════════════════════════════════════════════════════════════════════════
// estimateTokenSavings
// ═══════════════════════════════════════════════════════════════════════════

suite('estimateTokenSavings');

test('calculates savings correctly', () => {
  const full = 'x'.repeat(4000); // ~1000 tokens
  const delta = 'x'.repeat(800); // ~200 tokens
  const result = estimateTokenSavings(full, delta);

  assertEqual(result.fullTokens, 1000, 'full tokens');
  assertEqual(result.deltaTokens, 200, 'delta tokens');
  assertEqual(result.saved, 800, 'saved tokens');
  assert(result.ratio >= 0.79 && result.ratio <= 0.81, `ratio ~0.8, got ${result.ratio}`);
});

test('no savings when delta equals full', () => {
  const text = 'hello world';
  const result = estimateTokenSavings(text, text);

  assertEqual(result.saved, 0, 'no savings');
  assertEqual(result.ratio, 0, 'ratio 0');
});

test('empty inputs', () => {
  const result = estimateTokenSavings('', '');
  assertEqual(result.fullTokens, 0, 'zero full');
  assertEqual(result.ratio, 0, 'ratio 0');
});

test('null inputs', () => {
  const result = estimateTokenSavings(null, null);
  assertEqual(result.fullTokens, 0, 'null → 0');
});

// ═══════════════════════════════════════════════════════════════════════════
// Integration — snapshot round-trip
// ═══════════════════════════════════════════════════════════════════════════

suite('integration');

test('3-iteration delta chain', () => {
  // Iteration 1: first context
  const ctx1 = mkContext();
  const snap1 = createContextSnapshot(ctx1);
  const delta1 = computeContextDelta(null, snap1);
  assert(delta1.isFirstIteration, 'iter 1 is first');

  // Iteration 2: errors changed
  const ctx2 = { ...ctx1, errors: '- [TYPE_MISMATCH] b.js:5 wrong type' };
  const snap2 = createContextSnapshot(ctx2);
  const delta2 = computeContextDelta(snap1, snap2);
  assert(!delta2.isFirstIteration, 'iter 2 not first');
  assert(delta2.changed.has('errors'), 'errors changed');
  assertEqual(delta2.stats.sectionsChanged, 1, 'only errors changed');

  // Iteration 3: errors + gitDiff changed
  const ctx3 = { ...ctx2, gitDiff: 'new diff content' };
  const snap3 = createContextSnapshot(ctx3);
  const delta3 = computeContextDelta(snap2, snap3);
  assert(delta3.changed.has('gitDiff'), 'gitDiff changed');
  assert(!delta3.changed.has('errors'), 'errors same as iter 2');
  assertEqual(delta3.stats.sectionsChanged, 1, 'only gitDiff');
});

test('delta prompt is shorter than full prompt', () => {
  const snap1 = createContextSnapshot(mkContext());
  const snap2 = createContextSnapshot(mkContext({ errors: 'new error only' }));
  const delta = computeContextDelta(snap1, snap2);

  const fullPrompt = formatFullContext(snap2);
  const deltaPrompt = formatDeltaForPrompt(delta, snap2);

  assert(deltaPrompt.length < fullPrompt.length,
    `delta (${deltaPrompt.length}) should be shorter than full (${fullPrompt.length})`);
});

test('hash stability across snapshots', () => {
  const ctx = mkContext();
  const snap1 = createContextSnapshot(ctx);
  const snap2 = createContextSnapshot(ctx);

  for (const name of ['errors', 'patches', 'files', 'taskMemory', 'critique', 'gitDiff']) {
    assertEqual(snap1.hashes[name], snap2.hashes[name], `${name} hash should be stable`);
  }
});

test('estimateTokenSavings with real delta', () => {
  const snap1 = createContextSnapshot(mkContext());
  const snap2 = createContextSnapshot(mkContext({ errors: 'x' }));
  const delta = computeContextDelta(snap1, snap2);

  const full = formatFullContext(snap2);
  const deltaP = formatDeltaForPrompt(delta, snap2);
  const savings = estimateTokenSavings(full, deltaP);

  assert(savings.saved > 0, 'should have savings');
  assert(savings.ratio > 0, 'positive ratio');
});

// ═══════════════════════════════════════════════════════════════════════════

summary();
