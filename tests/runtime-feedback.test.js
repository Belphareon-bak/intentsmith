// tests/runtime-feedback.test.js — Runtime Feedback Loop v100 tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual, summary } from './harness.js';
import {
  parseTestOutput,
  parseBuildOutput,
  detectPatterns,
  generateFixSuggestions,
  collectFeedback,
  formatFeedbackForPrompt,
} from '../src/planner/runtime-feedback.js';

// ─── Test Output Parsing ────────────────────────────────────────────────────

suite('Runtime Feedback — parseTestOutput');

test('parses Jest output', () => {
  const stdout = `
Tests: 10 passed, 3 failed
Time: 5.2s
`;
  const result = parseTestOutput(stdout);
  assertEqual(result.passed, 10);
  assertEqual(result.failed, 3);
});

test('parses Mocha output', () => {
  const stdout = `
  15 passing (3s)
  2 failing
`;
  const result = parseTestOutput(stdout);
  assertEqual(result.passed, 15);
  assertEqual(result.failed, 2);
});

test('parses pytest output', () => {
  const stdout = '8 passed, 1 failed in 2.5s';
  const result = parseTestOutput(stdout);
  assertEqual(result.passed, 8);
  assertEqual(result.failed, 1);
});

test('parses go test output', () => {
  const stdout = `ok  github.com/pkg/auth 1.2s
ok  github.com/pkg/api  0.5s
FAIL github.com/pkg/db  2.1s`;
  const result = parseTestOutput(stdout);
  assertEqual(result.passed, 2);
  assertEqual(result.failed, 1);
});

test('parses cargo test output', () => {
  const stdout = 'test result: ok. 25 passed; 0 failed; 3 ignored';
  const result = parseTestOutput(stdout);
  assertEqual(result.passed, 25);
  assertEqual(result.failed, 0);
});

test('extracts failure details', () => {
  const stderr = `FAIL src/auth.test.js
  ✕ should authenticate user
    AssertionError: expected true to be false
      at Object.<anonymous> (src/auth.test.js:42)
`;
  const result = parseTestOutput('', stderr);
  assert(result.failures.length > 0, 'should extract failures');
});

test('handles empty output', () => {
  const result = parseTestOutput('', '');
  assertEqual(result.passed, 0);
  assertEqual(result.failed, 0);
  assertEqual(result.failures.length, 0);
});

// ─── Build Output Parsing ───────────────────────────────────────────────────

suite('Runtime Feedback — parseBuildOutput');

test('parses tsc errors', () => {
  const stderr = `src/server.ts(42,5): error TS2304: Cannot find name 'foo'
src/utils.ts(10,3): warning TS6133: Variable declared but never used`;
  const result = parseBuildOutput('', stderr);
  assertEqual(result.errors.length, 1);
  assertEqual(result.warnings.length, 1);
  assertEqual(result.errors[0].code, 'TS2304');
  assertEqual(result.tool, 'tsc');
});

test('parses eslint errors', () => {
  const stdout = `src/api.js:15:3: error no-unused-vars 'x' is defined but never used
src/api.js:20:1: warning no-console Unexpected console statement`;
  const result = parseBuildOutput(stdout);
  assertEqual(result.errors.length, 1);
  assertEqual(result.warnings.length, 1);
});

test('parses Go build errors', () => {
  const stderr = `./main.go:15:2: undefined: initDB`;
  const result = parseBuildOutput('', stderr);
  assert(result.errors.length >= 1, 'should find Go error');
  assertEqual(result.errors[0].file, './main.go');
});

test('parses generic errors', () => {
  const stderr = `SyntaxError: Unexpected token }`;
  const result = parseBuildOutput('', stderr);
  assert(result.errors.length >= 1, 'should find generic error');
});

test('handles empty build output', () => {
  const result = parseBuildOutput('', '');
  assertEqual(result.errors.length, 0);
  assertEqual(result.warnings.length, 0);
});

// ─── Pattern Detection ──────────────────────────────────────────────────────

suite('Runtime Feedback — detectPatterns');

test('detects recurring errors across milestones', () => {
  const history = [
    { milestoneId: 'ms-1', errors: [{ message: 'Cannot find module x' }] },
    { milestoneId: 'ms-2', errors: [{ message: 'Cannot find module x' }] },
    { milestoneId: 'ms-3', errors: [{ message: 'Cannot find module x' }] },
  ];
  const patterns = detectPatterns(history);
  assert(patterns.length > 0, 'should detect recurring error');
  assertEqual(patterns[0].type, 'RECURRING_ERROR');
  assert(patterns[0].milestones.length >= 2, 'should span 2+ milestones');
});

test('detects error-prone files', () => {
  const history = [
    { milestoneId: 'ms-1', errors: [{ file: 'src/auth.js', message: 'error A' }] },
    { milestoneId: 'ms-2', errors: [{ file: 'src/auth.js', message: 'error B' }] },
  ];
  const patterns = detectPatterns(history);
  const filePat = patterns.find(p => p.type === 'ERROR_PRONE_FILE');
  assert(filePat, 'should detect error-prone file');
  assertEqual(filePat.file, 'src/auth.js');
});

test('ignores single-milestone errors (not patterns)', () => {
  const history = [
    { milestoneId: 'ms-1', errors: [{ message: 'one-time error' }] },
  ];
  const patterns = detectPatterns(history);
  assertEqual(patterns.length, 0);
});

test('handles null history', () => {
  assertEqual(detectPatterns(null).length, 0);
});

test('sorts patterns by severity', () => {
  const history = [
    { milestoneId: 'ms-1', errors: [
      { message: 'rare error' },
      { message: 'common error' }, { message: 'common error' },
      { message: 'common error' }, { message: 'common error' },
      { message: 'common error' },
    ]},
    { milestoneId: 'ms-2', errors: [
      { message: 'rare error' },
      { message: 'common error' },
    ]},
  ];
  const patterns = detectPatterns(history);
  if (patterns.length >= 2) {
    const severities = patterns.map(p => p.severity);
    // HIGH should come before MEDIUM
    const highIdx = severities.indexOf('HIGH');
    const medIdx = severities.indexOf('MEDIUM');
    if (highIdx >= 0 && medIdx >= 0) {
      assert(highIdx < medIdx, 'HIGH severity should come first');
    }
  }
});

// ─── Fix Suggestions ────────────────────────────────────────────────────────

suite('Runtime Feedback — generateFixSuggestions');

test('suggests import fix for module errors', () => {
  const patterns = [{
    type: 'RECURRING_ERROR',
    message: 'Cannot find module ./config',
    occurrences: 3,
    milestones: ['ms-1', 'ms-2', 'ms-3'],
    severity: 'HIGH',
  }];
  const suggestions = generateFixSuggestions(patterns);
  assert(suggestions.length > 0, 'should generate suggestion');
  assert(suggestions[0].suggestion.includes('import'), 'should mention import');
});

test('suggests refactoring for error-prone files', () => {
  const patterns = [{
    type: 'ERROR_PRONE_FILE',
    file: 'src/fragile.js',
    errorCount: 8,
    milestones: ['ms-1', 'ms-2', 'ms-3'],
    severity: 'HIGH',
  }];
  const suggestions = generateFixSuggestions(patterns);
  assert(suggestions.length > 0, 'should generate suggestion');
  assert(suggestions[0].suggestion.includes('src/fragile.js'), 'should mention file');
});

test('handles empty patterns', () => {
  assertEqual(generateFixSuggestions([]).length, 0);
  assertEqual(generateFixSuggestions(null).length, 0);
});

// ─── Feedback Collection ────────────────────────────────────────────────────

suite('Runtime Feedback — collectFeedback');

test('collects from test output', () => {
  const fb = collectFeedback('ms-1',
    { stdout: '5 passed, 2 failed', stderr: '' },
    null, null
  );
  assert(fb.errors.length > 0, 'should have test failure error');
  assert(fb.source.includes('test'), 'should record test source');
});

test('collects from build output', () => {
  const fb = collectFeedback('ms-1', null,
    { stdout: '', stderr: 'SyntaxError: Unexpected token }' },
    null
  );
  assert(fb.errors.length > 0, 'should have build error');
  assert(fb.source.includes('build'), 'should record build source');
});

test('collects from checkpoint', () => {
  const fb = collectFeedback('ms-1', null, null,
    { fix_instructions: ['Fix auth middleware'] }
  );
  assert(fb.errors.length > 0, 'should have checkpoint error');
  assert(fb.source.includes('checkpoint'), 'should record checkpoint source');
});

// ─── Prompt Formatting ──────────────────────────────────────────────────────

suite('Runtime Feedback — formatFeedbackForPrompt');

test('formats feedback with errors', () => {
  const fb = {
    errors: [{ message: 'test failure', file: 'src/a.js' }],
  };
  const result = formatFeedbackForPrompt(fb, []);
  assert(result.includes('test failure'), 'should include error message');
  assert(result.includes('src/a.js'), 'should include file');
});

test('formats patterns', () => {
  const patterns = [{
    type: 'RECURRING_ERROR',
    message: 'Cannot find module x',
    occurrences: 3,
  }];
  const result = formatFeedbackForPrompt(null, patterns);
  assert(result.includes('RECURRING_ERROR'), 'should include pattern type');
  assert(result.includes('Suggested Fixes'), 'should include suggestions');
});

test('respects token limit', () => {
  const fb = {
    errors: Array.from({ length: 100 }, (_, i) => ({
      message: `Error number ${i}: ${'x'.repeat(200)}`,
    })),
  };
  const result = formatFeedbackForPrompt(fb, [], 100);
  assert(result.length < 500, `should be truncated, got ${result.length} chars`);
});

test('returns empty for no feedback', () => {
  assertEqual(formatFeedbackForPrompt(null, []), '');
  assertEqual(formatFeedbackForPrompt(null, null), '');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

summary();
