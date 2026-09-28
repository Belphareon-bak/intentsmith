// tests/pattern-miner.test.js — Pattern Miner (F8) unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual, summary } from './harness.js';
import {
  minePatterns,
  findArchetypes,
  formatPatternsForPrompt,
  PatternType,
} from '../src/code-intel/pattern-miner.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;
const NOW = Date.now();

function mkEntry(kind, key, value, confidence = 0.8, daysAgo = 0) {
  return {
    kind,
    key,
    value: typeof value === 'string' ? value : JSON.stringify(value),
    confidence,
    created_at: NOW - daysAgo * MS_PER_DAY,
    access_count: 1,
  };
}

function mkFixSuccess(errorCode, file, strategy, confidence = 0.8, daysAgo = 0) {
  return mkEntry('fix_strategy', `${errorCode}:${file}:`, { success: true, strategy, patchFile: file }, confidence, daysAgo);
}

function mkFixFailure(errorCode, file, strategy, confidence = 0.5, daysAgo = 0) {
  return mkEntry('error_pattern', `${errorCode}:${file}:`, { success: false, strategy, patchFile: file }, confidence, daysAgo);
}

function mkError(code, file) {
  return { code, file, line: 1, message: 'test', severity: 'error' };
}

// ═══════════════════════════════════════════════════════════════════════════
// PatternType
// ═══════════════════════════════════════════════════════════════════════════

suite('PatternType');

test('all types defined', () => {
  assertEqual(PatternType.ERROR_CASCADE, 'error_cascade', 'ERROR_CASCADE');
  assertEqual(PatternType.FIX_ARCHETYPE, 'fix_archetype', 'FIX_ARCHETYPE');
  assertEqual(PatternType.FILE_COUPLING, 'file_coupling', 'FILE_COUPLING');
  assertEqual(PatternType.COMPLEXITY_HOTSPOT, 'complexity_hotspot', 'COMPLEXITY_HOTSPOT');
});

test('PatternType is frozen', () => {
  assert(Object.isFrozen(PatternType), 'should be frozen');
});

// ═══════════════════════════════════════════════════════════════════════════
// Fix Archetypes
// ═══════════════════════════════════════════════════════════════════════════

suite('fix archetypes');

test('detects repeated successful strategy', () => {
  const entries = [
    mkFixSuccess('SYNTAX_ERROR', 'a.js', 'Fixed in 1 iteration(s)'),
    mkFixSuccess('SYNTAX_ERROR', 'b.js', 'Fixed in 1 iteration(s)'),
    mkFixSuccess('SYNTAX_ERROR', 'c.js', 'Fixed in 1 iteration(s)'),
  ];

  const patterns = minePatterns(entries);
  const archetypes = patterns.filter(p => p.type === PatternType.FIX_ARCHETYPE);
  assert(archetypes.length >= 1, 'should find at least 1 archetype');
  assertEqual(archetypes[0].data.errorCode, 'SYNTAX_ERROR', 'error code matches');
});

test('ignores failures', () => {
  const entries = [
    mkFixFailure('TYPE_ERROR', 'a.js', 'Failed attempt'),
    mkFixFailure('TYPE_ERROR', 'b.js', 'Failed attempt'),
  ];

  const patterns = minePatterns(entries);
  const archetypes = patterns.filter(p => p.type === PatternType.FIX_ARCHETYPE);
  assertEqual(archetypes.length, 0, 'failures should not create archetypes');
});

test('needs MIN_OCCURRENCES (2)', () => {
  const entries = [
    mkFixSuccess('RARE_ERROR', 'a.js', 'Fixed once'),
  ];

  const patterns = minePatterns(entries);
  const archetypes = patterns.filter(p => p.type === PatternType.FIX_ARCHETYPE);
  assertEqual(archetypes.length, 0, 'single occurrence should not create archetype');
});

test('dominant strategy selected', () => {
  const entries = [
    mkFixSuccess('IMPORT_ERROR', 'a.js', 'Added missing import'),
    mkFixSuccess('IMPORT_ERROR', 'b.js', 'Added missing import'),
    mkFixSuccess('IMPORT_ERROR', 'c.js', 'Restructured imports'),
  ];

  const patterns = minePatterns(entries);
  const arch = patterns.find(p => p.type === PatternType.FIX_ARCHETYPE && p.data.errorCode === 'IMPORT_ERROR');
  assert(arch, 'should find import archetype');
  assert(arch.data.strategy.includes('Added missing import'), 'dominant strategy should be selected');
});

// ═══════════════════════════════════════════════════════════════════════════
// Error Cascades
// ═══════════════════════════════════════════════════════════════════════════

suite('error cascades');

test('detects repeated error pattern', () => {
  const entries = [
    mkFixFailure('NULL_REF', 'service.js', 'Failed', 0.8),
    mkFixFailure('NULL_REF', 'handler.js', 'Failed', 0.8),
  ];

  const patterns = minePatterns(entries);
  const cascades = patterns.filter(p => p.type === PatternType.ERROR_CASCADE);
  assert(cascades.length >= 1, 'should find cascade');
  assertEqual(cascades[0].data.errorCode, 'NULL_REF', 'error code matches');
  assertEqual(cascades[0].data.files.length, 2, 'two files affected');
});

test('below threshold filtered out', () => {
  const entries = [
    mkFixFailure('LOW_CONF', 'a.js', 'Failed', 0.3),
    mkFixFailure('LOW_CONF', 'b.js', 'Failed', 0.3),
  ];

  const patterns = minePatterns(entries, { minConfidence: 0.7 });
  const cascades = patterns.filter(p => p.type === PatternType.ERROR_CASCADE);
  assertEqual(cascades.length, 0, 'low confidence should be filtered');
});

// ═══════════════════════════════════════════════════════════════════════════
// File Coupling
// ═══════════════════════════════════════════════════════════════════════════

suite('file coupling');

test('detects files modified together', () => {
  const entries = [
    mkEntry('fix_strategy', 'ERR:controller.js:', { success: true, strategy: 'fix', patchFile: 'service.js' }, 0.8),
    mkEntry('fix_strategy', 'ERR:controller.js:', { success: true, strategy: 'fix', patchFile: 'service.js' }, 0.8),
  ];

  const patterns = minePatterns(entries);
  const coupling = patterns.filter(p => p.type === PatternType.FILE_COUPLING);
  assert(coupling.length >= 1, `should find coupling, got ${coupling.length}`);
  assert(coupling[0].data.files.includes('controller.js'), 'should include controller');
  assert(coupling[0].data.files.includes('service.js'), 'should include service');
});

test('same file pair → no coupling', () => {
  const entries = [
    mkEntry('fix_strategy', 'ERR:a.js:', { success: true, strategy: 'fix', patchFile: 'a.js' }, 0.8),
    mkEntry('fix_strategy', 'ERR:a.js:', { success: true, strategy: 'fix', patchFile: 'a.js' }, 0.8),
  ];

  const patterns = minePatterns(entries);
  const coupling = patterns.filter(p => p.type === PatternType.FILE_COUPLING);
  assertEqual(coupling.length, 0, 'same file should not create coupling');
});

test('pair normalization (order-independent)', () => {
  const entries = [
    mkEntry('fix_strategy', 'ERR:b.js:', { success: true, strategy: 'fix', patchFile: 'a.js' }, 0.8),
    mkEntry('fix_strategy', 'ERR:a.js:', { success: true, strategy: 'fix', patchFile: 'b.js' }, 0.8),
  ];

  const patterns = minePatterns(entries);
  const coupling = patterns.filter(p => p.type === PatternType.FILE_COUPLING);
  assert(coupling.length >= 1, 'should combine reversed pairs');
  assertEqual(coupling[0].data.count, 2, 'both occurrences counted');
});

// ═══════════════════════════════════════════════════════════════════════════
// Complexity Hotspots
// ═══════════════════════════════════════════════════════════════════════════

suite('complexity hotspots');

test('detects file with many errors + fixes', () => {
  const entries = [
    mkFixFailure('ERR1', 'hot.js', 'Failed', 0.8),
    mkFixFailure('ERR2', 'hot.js', 'Failed', 0.8),
    mkFixSuccess('ERR1', 'hot.js', 'Fixed', 0.8),
  ];

  const patterns = minePatterns(entries, { minConfidence: 0.5 });
  const hotspots = patterns.filter(p => p.type === PatternType.COMPLEXITY_HOTSPOT);
  assert(hotspots.length >= 1, 'should find hotspot');
  assertEqual(hotspots[0].data.file, 'hot.js', 'file matches');
});

test('needs at least 3 total entries', () => {
  const entries = [
    mkFixFailure('ERR1', 'mild.js', 'Failed'),
    mkFixSuccess('ERR1', 'mild.js', 'Fixed'),
  ];

  const patterns = minePatterns(entries);
  const hotspots = patterns.filter(p => p.type === PatternType.COMPLEXITY_HOTSPOT);
  assertEqual(hotspots.length, 0, '2 entries not enough for hotspot');
});

// ═══════════════════════════════════════════════════════════════════════════
// Decay
// ═══════════════════════════════════════════════════════════════════════════

suite('decay');

test('old entries have reduced confidence', () => {
  // Entries from 100 days ago: decay = e^(-0.01 * 100) ≈ 0.37
  // confidence 0.8 * 0.37 ≈ 0.30 → below 0.7 threshold
  const entries = [
    mkFixSuccess('OLD_ERR', 'a.js', 'old fix', 0.8, 100),
    mkFixSuccess('OLD_ERR', 'b.js', 'old fix', 0.8, 100),
  ];

  const patterns = minePatterns(entries, { minConfidence: 0.7 });
  const archetypes = patterns.filter(p => p.type === PatternType.FIX_ARCHETYPE);
  assertEqual(archetypes.length, 0, 'old entries should decay below threshold');
});

test('recent entries pass threshold', () => {
  const entries = [
    mkFixSuccess('RECENT_ERR', 'a.js', 'new fix', 0.8, 1),
    mkFixSuccess('RECENT_ERR', 'b.js', 'new fix', 0.8, 1),
  ];

  const patterns = minePatterns(entries, { minConfidence: 0.7 });
  const archetypes = patterns.filter(p => p.type === PatternType.FIX_ARCHETYPE);
  assert(archetypes.length >= 1, 'recent entries should pass threshold');
});

// ═══════════════════════════════════════════════════════════════════════════
// findArchetypes
// ═══════════════════════════════════════════════════════════════════════════

suite('findArchetypes');

test('matches error code to archetype', () => {
  const patterns = [
    {
      type: PatternType.FIX_ARCHETYPE,
      key: 'archetype:SYNTAX_ERROR',
      description: 'test',
      confidence: 0.85,
      occurrences: 3,
      data: { errorCode: 'SYNTAX_ERROR', strategy: 'Fix syntax', count: 3 },
    },
  ];

  const errors = [mkError('SYNTAX_ERROR', 'a.js')];
  const result = findArchetypes(errors, patterns);

  assertEqual(result.length, 1, 'should match 1 archetype');
  assertEqual(result[0].strategy, 'Fix syntax', 'strategy matches');
  assertEqual(result[0].confidence, 0.85, 'confidence matches');
});

test('no match returns empty', () => {
  const patterns = [{
    type: PatternType.FIX_ARCHETYPE,
    data: { errorCode: 'OTHER', strategy: 'X', count: 1 },
    confidence: 0.8, occurrences: 1,
  }];

  const errors = [mkError('UNMATCHED', 'a.js')];
  const result = findArchetypes(errors, patterns);
  assertEqual(result.length, 0, 'no match → empty');
});

test('null inputs', () => {
  assertEqual(findArchetypes(null, null).length, 0, 'null → empty');
  assertEqual(findArchetypes([], []).length, 0, 'empty → empty');
});

// ═══════════════════════════════════════════════════════════════════════════
// formatPatternsForPrompt
// ═══════════════════════════════════════════════════════════════════════════

suite('formatPatternsForPrompt');

test('formats patterns with confidence', () => {
  const patterns = [
    { type: 'fix_archetype', description: 'SYNTAX_ERROR → fix', confidence: 0.85, occurrences: 3 },
    { type: 'error_cascade', description: 'NULL_REF recurring', confidence: 0.72, occurrences: 2 },
  ];

  const result = formatPatternsForPrompt(patterns);
  assert(result.includes('85%'), 'should include confidence percentage');
  assert(result.includes('fix_archetype'), 'should include type');
  assert(result.includes('SYNTAX_ERROR'), 'should include description');
});

test('caps at maxEntries', () => {
  const patterns = [];
  for (let i = 0; i < 10; i++) {
    patterns.push({ type: 'test', description: `pattern ${i}`, confidence: 0.8, occurrences: 1 });
  }

  const result = formatPatternsForPrompt(patterns, 3);
  const lines = result.split('\n');
  assertEqual(lines.length, 3, 'should cap at 3');
});

test('empty patterns returns empty string', () => {
  assertEqual(formatPatternsForPrompt([]), '', 'empty → empty');
  assertEqual(formatPatternsForPrompt(null), '', 'null → empty');
});

// ═══════════════════════════════════════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════════════════════════════════════

suite('edge cases');

test('empty entries', () => {
  const patterns = minePatterns([]);
  assertEqual(patterns.length, 0, 'empty entries → empty patterns');
});

test('null entries', () => {
  const patterns = minePatterns(null);
  assertEqual(patterns.length, 0, 'null entries → empty patterns');
});

test('maxPatterns respected', () => {
  // Create many entries to generate many patterns
  const entries = [];
  for (let i = 0; i < 30; i++) {
    entries.push(mkFixSuccess(`ERR_${i}`, `f${i}.js`, 'fix'));
    entries.push(mkFixSuccess(`ERR_${i}`, `g${i}.js`, 'fix'));
  }

  const patterns = minePatterns(entries, { maxPatterns: 5, minConfidence: 0.5 });
  assert(patterns.length <= 5, `should cap at 5, got ${patterns.length}`);
});

test('sorted by confidence descending', () => {
  const entries = [
    mkFixSuccess('HIGH', 'a.js', 'fix', 0.95),
    mkFixSuccess('HIGH', 'b.js', 'fix', 0.95),
    mkFixSuccess('LOW', 'c.js', 'fix', 0.75),
    mkFixSuccess('LOW', 'd.js', 'fix', 0.75),
  ];

  const patterns = minePatterns(entries, { minConfidence: 0.5 });
  if (patterns.length >= 2) {
    assert(patterns[0].confidence >= patterns[1].confidence,
      'should be sorted by confidence descending');
  }
});

test('malformed value JSON handled gracefully', () => {
  const entries = [
    mkEntry('fix_strategy', 'ERR:a.js:', 'not json', 0.8),
    mkEntry('fix_strategy', 'ERR:b.js:', 'not json', 0.8),
  ];

  // Should not throw
  const patterns = minePatterns(entries);
  assert(Array.isArray(patterns), 'should return array');
});

// ═══════════════════════════════════════════════════════════════════════════

summary();
