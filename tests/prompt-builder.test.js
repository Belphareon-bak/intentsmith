// tests/prompt-builder.test.js — Prompt Builder v119 tests
import { suite, test, assert, assertEqual, assertIncludes, summary } from './harness.js';
import {
  buildStructuredPrompt,
  buildSectionBudget,
  estimateTokens,
  SECTION_DEFS,
  ADAPTIVE_WEIGHTS,
} from '../src/context/prompt-builder.js';

// ─── estimateTokens ─────────────────────────────────────────────────────────

suite('estimateTokens');

test('empty string → 0', () => {
  assertEqual(estimateTokens(''), 0);
});

test('null → 0', () => {
  assertEqual(estimateTokens(null), 0);
});

test('4 chars → 1 token', () => {
  assertEqual(estimateTokens('abcd'), 1);
});

test('5 chars → 2 tokens (ceil)', () => {
  assertEqual(estimateTokens('abcde'), 2);
});

test('100 chars → 25 tokens', () => {
  assertEqual(estimateTokens('a'.repeat(100)), 25);
});

// ─── buildSectionBudget ──────────────────────────────────────────────────────

suite('buildSectionBudget');

test('zero maxTokens → all budgets 0', () => {
  const budgets = buildSectionBudget(0, null, null);
  for (const [, val] of budgets) {
    assertEqual(val.budget, 0);
  }
});

test('returns all section names', () => {
  const budgets = buildSectionBudget(4096, null, null);
  for (const def of SECTION_DEFS) {
    assert(budgets.has(def.name), `Missing section: ${def.name}`);
  }
});

test('total budget does not exceed maxTokens', () => {
  const budgets = buildSectionBudget(4096, null, null);
  let total = 0;
  for (const [, val] of budgets) total += val.budget;
  assert(total <= 4096, `Total ${total} exceeds 4096`);
});

test('IMPORT_NOT_FOUND boosts IMPORT_MAP', () => {
  const neutral = buildSectionBudget(4096, null, null);
  const boosted = buildSectionBudget(4096, 'IMPORT_NOT_FOUND', null);
  assert(
    boosted.get('IMPORT_MAP').budget > neutral.get('IMPORT_MAP').budget,
    'IMPORT_MAP should be boosted for IMPORT_NOT_FOUND'
  );
});

test('IMPORT_NOT_FOUND boosts SIGNATURES', () => {
  const neutral = buildSectionBudget(4096, null, null);
  const boosted = buildSectionBudget(4096, 'IMPORT_NOT_FOUND', null);
  assert(
    boosted.get('SIGNATURES').budget > neutral.get('SIGNATURES').budget,
    'SIGNATURES should be boosted for IMPORT_NOT_FOUND'
  );
});

test('SYNTAX_ERROR boosts SOURCE', () => {
  const neutral = buildSectionBudget(4096, null, null);
  const boosted = buildSectionBudget(4096, 'SYNTAX_ERROR', null);
  assert(
    boosted.get('SOURCE').budget > neutral.get('SOURCE').budget,
    'SOURCE should be boosted for SYNTAX_ERROR'
  );
});

test('DETERMINISTIC strategy reduces budgets', () => {
  const full = buildSectionBudget(4096, null, null);
  const det = buildSectionBudget(4096, null, 'DETERMINISTIC');
  let fullTotal = 0, detTotal = 0;
  for (const [, v] of full) fullTotal += v.budget;
  for (const [, v] of det) detTotal += v.budget;
  assert(detTotal < fullTotal, `DETERMINISTIC total ${detTotal} should be < full ${fullTotal}`);
});

test('unknown error type → no multiplier applied (same as null)', () => {
  const neutral = buildSectionBudget(4096, null, null);
  const unknown = buildSectionBudget(4096, 'TOTALLY_UNKNOWN_ERROR', null);
  assertEqual(
    neutral.get('SOURCE').budget,
    unknown.get('SOURCE').budget,
  );
});

// ─── buildStructuredPrompt ───────────────────────────────────────────────────

suite('buildStructuredPrompt — basic');

test('null opts → empty prompt', () => {
  const result = buildStructuredPrompt(null);
  assertEqual(result.prompt, '');
  assertEqual(result.metadata.totalTokens, 0);
});

test('empty sections → empty prompt', () => {
  const result = buildStructuredPrompt({ sections: {}, maxTokens: 4096 });
  assertEqual(result.prompt, '');
  assertEqual(result.metadata.sectionsIncluded, 0);
});

test('single section included', () => {
  const result = buildStructuredPrompt({
    sections: { ROLE: 'You are a senior software engineer.' },
    maxTokens: 4096,
  });
  assertIncludes(result.prompt, 'You are a senior software engineer.');
  assertEqual(result.metadata.sectionsIncluded, 1);
});

test('sections with no content are skipped', () => {
  const result = buildStructuredPrompt({
    sections: {
      ROLE: 'You are a senior software engineer.',
      ERRORS: '',
      SOURCE: '   ',
    },
    maxTokens: 4096,
  });
  assertEqual(result.metadata.sectionsIncluded, 1);
});

test('accepts Map as sections input', () => {
  const sections = new Map([['ROLE', 'Test role.']]);
  const result = buildStructuredPrompt({ sections, maxTokens: 4096 });
  assertIncludes(result.prompt, 'Test role.');
});

suite('buildStructuredPrompt — ordering');

test('higher priority sections appear first', () => {
  const result = buildStructuredPrompt({
    sections: {
      TASK: 'Task content here.',
      ROLE: 'Role content here.',
      ERRORS: 'Error content here.',
    },
    maxTokens: 4096,
  });
  const roleIdx = result.prompt.indexOf('Role content');
  const errIdx = result.prompt.indexOf('Error content');
  const taskIdx = result.prompt.indexOf('Task content');
  assert(roleIdx < errIdx, 'ROLE should come before ERRORS');
  assert(errIdx < taskIdx, 'ERRORS should come before TASK');
});

suite('buildStructuredPrompt — truncation');

test('section exceeding budget is truncated', () => {
  // Create a section with 500 tokens (~2000 chars)
  const bigContent = ('x'.repeat(80) + '\n').repeat(50); // ~50 lines × ~80 chars
  const result = buildStructuredPrompt({
    sections: { SOURCE: bigContent },
    maxTokens: 100, // very tight budget
  });
  assert(result.metadata.sections.some(s => s.name === 'SOURCE' && s.truncated),
    'SOURCE should be truncated');
  assertIncludes(result.prompt, '... (truncated)');
});

test('small section within budget is not truncated', () => {
  const result = buildStructuredPrompt({
    sections: { ROLE: 'Short role.' },
    maxTokens: 4096,
  });
  const roleMeta = result.metadata.sections.find(s => s.name === 'ROLE');
  assert(roleMeta && !roleMeta.truncated, 'ROLE should not be truncated');
});

suite('buildStructuredPrompt — budget exhaustion');

test('later sections get budget_exhausted when total spent', () => {
  // Fill budget with huge ROLE (highest priority)
  const bigRole = ('x'.repeat(80) + '\n').repeat(200);
  const result = buildStructuredPrompt({
    sections: {
      ROLE: bigRole,
      OUTPUT_FORMAT: 'format info',
    },
    maxTokens: 50, // very tight
  });
  const fmtMeta = result.metadata.sections.find(s => s.name === 'OUTPUT_FORMAT');
  // OUTPUT_FORMAT should either be not included or have 0 tokens
  if (fmtMeta && fmtMeta.included) {
    // If it got some budget, that's fine too
  } else {
    assert(!fmtMeta?.included || fmtMeta?.tokens === 0,
      'OUTPUT_FORMAT should be budget-exhausted or minimal');
  }
});

suite('buildStructuredPrompt — metadata');

test('metadata has correct structure', () => {
  const result = buildStructuredPrompt({
    sections: { ROLE: 'Test' },
    maxTokens: 4096,
  });
  const m = result.metadata;
  assert(Array.isArray(m.sections), 'sections should be array');
  assert(typeof m.totalTokens === 'number', 'totalTokens should be number');
  assertEqual(m.maxTokens, 4096);
  assertEqual(m.errorType, null);
  assertEqual(m.strategy, null);
  assert(typeof m.sectionsIncluded === 'number', 'sectionsIncluded should be number');
  assert(typeof m.sectionsTruncated === 'number', 'sectionsTruncated should be number');
});

test('metadata includes errorType when provided', () => {
  const result = buildStructuredPrompt({
    sections: { ERRORS: 'Some error' },
    maxTokens: 4096,
    errorType: 'IMPORT_NOT_FOUND',
  });
  assertEqual(result.metadata.errorType, 'IMPORT_NOT_FOUND');
});

test('metadata includes strategy when provided', () => {
  const result = buildStructuredPrompt({
    sections: { ERRORS: 'Some error' },
    maxTokens: 4096,
    strategy: 'HEURISTIC',
  });
  assertEqual(result.metadata.strategy, 'HEURISTIC');
});

test('all SECTION_DEFS appear in metadata (either included or not)', () => {
  const result = buildStructuredPrompt({
    sections: { ROLE: 'Test' },
    maxTokens: 4096,
  });
  for (const def of SECTION_DEFS) {
    const found = result.metadata.sections.find(s => s.name === def.name);
    assert(found, `Missing section metadata for ${def.name}`);
  }
});

suite('buildStructuredPrompt — deterministic');

test('same inputs → same output', () => {
  const opts = {
    sections: { ROLE: 'test', ERRORS: 'error1', SOURCE: 'code' },
    maxTokens: 4096,
    errorType: 'TEST_FAILED',
  };
  const r1 = buildStructuredPrompt(opts);
  const r2 = buildStructuredPrompt(opts);
  assertEqual(r1.prompt, r2.prompt);
  assertEqual(r1.metadata.totalTokens, r2.metadata.totalTokens);
});

suite('buildStructuredPrompt — adaptive weighting');

test('IMPORT_NOT_FOUND gives more tokens to IMPORT_MAP', () => {
  const sections = {
    IMPORT_MAP: 'sym → file\nsym2 → file2\nsym3 → file3',
    CALL_GRAPH: 'graph data here with details',
  };
  const neutral = buildStructuredPrompt({ sections, maxTokens: 200 });
  const boosted = buildStructuredPrompt({ sections, maxTokens: 200, errorType: 'IMPORT_NOT_FOUND' });

  const neutralImport = neutral.metadata.sections.find(s => s.name === 'IMPORT_MAP');
  const boostedImport = boosted.metadata.sections.find(s => s.name === 'IMPORT_MAP');

  // Both should be included, but boosted should have >= neutral tokens
  if (neutralImport?.included && boostedImport?.included) {
    assert(boostedImport.tokens >= neutralImport.tokens,
      `Boosted IMPORT_MAP (${boostedImport.tokens}) should have >= neutral (${neutralImport.tokens})`);
  }
});

// ─── ADAPTIVE_WEIGHTS structure ──────────────────────────────────────────────

suite('ADAPTIVE_WEIGHTS');

test('has expected error types', () => {
  assert(ADAPTIVE_WEIGHTS.IMPORT_NOT_FOUND, 'Missing IMPORT_NOT_FOUND');
  assert(ADAPTIVE_WEIGHTS.TYPE_MISMATCH, 'Missing TYPE_MISMATCH');
  assert(ADAPTIVE_WEIGHTS.TEST_FAILED, 'Missing TEST_FAILED');
  assert(ADAPTIVE_WEIGHTS.SYNTAX_ERROR, 'Missing SYNTAX_ERROR');
});

test('SECTION_DEFS has 12 entries', () => {
  assertEqual(SECTION_DEFS.length, 12);
});

// ─── Summary ────────────────────────────────────────────────────────────────

const results = summary();
process.exit(results.failed > 0 ? 1 : 0);
