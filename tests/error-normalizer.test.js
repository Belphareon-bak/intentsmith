// Error Normalizer v104 (F2) — Tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual, summary } from './harness.js';
import {
  ERROR_CODES,
  normalizeErrors,
  deduplicateErrors,
  classifyRecoverability,
  findRootCause,
  formatErrorsForLLM,
} from '../src/executor/error-normalizer.js';

// ─── Suite 1: ERROR_CODES constant ──────────────────────────────────────────

suite('ERROR_CODES constant');

test('ERROR_CODES is frozen', () => {
  assert(Object.isFrozen(ERROR_CODES), 'ERROR_CODES should be frozen');
});

test('ERROR_CODES has all 14 values', () => {
  const expected = [
    'MISSING_PROPERTY', 'TYPE_MISMATCH', 'UNDEFINED_VARIABLE', 'IMPORT_NOT_FOUND',
    'SYNTAX_ERROR', 'NULL_REFERENCE', 'ASSERTION_FAILED', 'TEST_FAILED',
    'FILE_NOT_FOUND', 'PERMISSION_DENIED', 'UNUSED_IMPORT',
    'ARGUMENT_COUNT', 'MISSING_TYPE', 'UNKNOWN',
  ];
  for (const code of expected) {
    assert(ERROR_CODES[code] === code, `Missing ERROR_CODES.${code}`);
  }
  assertEqual(Object.keys(ERROR_CODES).length, 14);
});

// ─── Suite 2: normalizeErrors — raw string ──────────────────────────────────

suite('normalizeErrors — raw string');

test('TS2339 → MISSING_PROPERTY with symbol', () => {
  const input = `src/app.ts(10,5): error TS2339: Property 'foo' does not exist on type 'Bar'.`;
  const result = normalizeErrors(input);
  assertEqual(result.length, 1);
  assertEqual(result[0].code, 'MISSING_PROPERTY');
  assertEqual(result[0].symbol, 'foo');
  assertEqual(result[0].category, 'compile');
  assertEqual(result[0].severity, 'error');
});

test('TS2554 → ARGUMENT_COUNT with symbol', () => {
  const input = `error TS2554: Expected 2 arguments, but got 3.`;
  const result = normalizeErrors(input);
  assertEqual(result.length, 1);
  assertEqual(result[0].code, 'ARGUMENT_COUNT');
  assertEqual(result[0].symbol, '2');
});

test('TS7006 → MISSING_TYPE with symbol', () => {
  const input = `error TS7006: Parameter 'req' implicitly has an 'any' type.`;
  const result = normalizeErrors(input);
  assertEqual(result.length, 1);
  assertEqual(result[0].code, 'MISSING_TYPE');
  assertEqual(result[0].symbol, 'req');
});

test('TypeError: Cannot read properties of undefined → NULL_REFERENCE', () => {
  const input = `TypeError: Cannot read properties of undefined (reading 'name')`;
  const result = normalizeErrors(input);
  assertEqual(result.length, 1);
  assertEqual(result[0].code, 'NULL_REFERENCE');
  assertEqual(result[0].category, 'runtime');
});

test('ReferenceError → UNDEFINED_VARIABLE with symbol', () => {
  const input = `ReferenceError: myVar is not defined`;
  const result = normalizeErrors(input);
  assertEqual(result.length, 1);
  assertEqual(result[0].code, 'UNDEFINED_VARIABLE');
  assertEqual(result[0].symbol, 'myVar');
});

test('SyntaxError: missing ) → SYNTAX_ERROR', () => {
  const input = `SyntaxError: missing )`;
  const result = normalizeErrors(input);
  assertEqual(result.length, 1);
  assertEqual(result[0].code, 'SYNTAX_ERROR');
});

test('Module not found → IMPORT_NOT_FOUND with symbol', () => {
  const input = `Module not found: Can't resolve './config' in '/app/src'`;
  const result = normalizeErrors(input);
  assertEqual(result.length, 1);
  assertEqual(result[0].code, 'IMPORT_NOT_FOUND');
  assertEqual(result[0].symbol, './config');
});

test('Python ImportError → IMPORT_NOT_FOUND', () => {
  const input = `ImportError: No module named flask`;
  const result = normalizeErrors(input);
  assertEqual(result.length, 1);
  assertEqual(result[0].code, 'IMPORT_NOT_FOUND');
  assertEqual(result[0].symbol, 'flask');
});

test('Go undefined → UNDEFINED_VARIABLE', () => {
  const input = `./main.go:15:2: undefined: initDB`;
  const result = normalizeErrors(input);
  assertEqual(result.length, 1);
  assertEqual(result[0].code, 'UNDEFINED_VARIABLE');
  assertEqual(result[0].symbol, 'initDB');
});

test('Java cannot find symbol → MISSING_PROPERTY', () => {
  const input = `error: cannot find symbol\n  symbol:   variable myField`;
  const result = normalizeErrors(input);
  // Two lines → two matches (cannot find symbol + symbol: variable myField)
  assert(result.length >= 1, 'Should match at least one line');
  assertEqual(result[0].code, 'MISSING_PROPERTY');
  // Second line has the symbol extraction
  const withSymbol = result.find(r => r.symbol === 'myField');
  assert(!!withSymbol, 'Should extract symbol myField from second line');
});

test('Rust E0425 → UNDEFINED_VARIABLE', () => {
  const input = 'error[E0425]: cannot find value `handler` in this scope';
  const result = normalizeErrors(input);
  assertEqual(result.length, 1);
  assertEqual(result[0].code, 'UNDEFINED_VARIABLE');
  assertEqual(result[0].symbol, 'handler');
});

test('ENOENT → FILE_NOT_FOUND with path', () => {
  const input = `Error: ENOENT: no such file or directory, open '/app/config.json'`;
  const result = normalizeErrors(input);
  assertEqual(result.length, 1);
  assertEqual(result[0].code, 'FILE_NOT_FOUND');
  assertEqual(result[0].symbol, '/app/config.json');
});

test('unused import → UNUSED_IMPORT (lint/warning)', () => {
  const input = `  3:1  warning  'fs' is defined but never used  no-unused-vars`;
  const result = normalizeErrors(input);
  assertEqual(result.length, 1);
  assertEqual(result[0].code, 'UNUSED_IMPORT');
  assertEqual(result[0].category, 'lint');
  assertEqual(result[0].severity, 'warning');
});

test('generic FAIL → TEST_FAILED (last priority)', () => {
  const input = `FAIL src/tests/auth.test.js`;
  const result = normalizeErrors(input);
  assertEqual(result.length, 1);
  assertEqual(result[0].code, 'TEST_FAILED');
  assertEqual(result[0].category, 'test');
});

// ─── Suite 3: normalizeErrors — pre-parsed objects ──────────────────────────

suite('normalizeErrors — pre-parsed objects');

test('array of build errors → NormalizedError[]', () => {
  const input = [
    { file: 'app.ts', line: 10, message: "error TS2339: Property 'x' does not exist on type 'Y'" },
    { file: 'server.ts', line: 5, message: "error TS2307: Cannot find module './db'" },
  ];
  const result = normalizeErrors(input);
  assertEqual(result.length, 2);
  assertEqual(result[0].code, 'MISSING_PROPERTY');
  assertEqual(result[0].file, 'app.ts');
  assertEqual(result[0].line, 10);
  assertEqual(result[1].code, 'IMPORT_NOT_FOUND');
});

test('array of test failures → NormalizedError[]', () => {
  const input = [
    { file: 'test.js', line: 42, message: 'AssertionError: expected 3 to equal 4' },
  ];
  const result = normalizeErrors(input);
  assertEqual(result.length, 1);
  assertEqual(result[0].code, 'ASSERTION_FAILED');
  assertEqual(result[0].category, 'test');
});

test('unknown error → UNKNOWN code', () => {
  const input = [{ message: 'Something completely unknown happened' }];
  const result = normalizeErrors(input);
  assertEqual(result.length, 1);
  assertEqual(result[0].code, 'UNKNOWN');
});

test('empty/null input → empty array', () => {
  assertEqual(normalizeErrors(null).length, 0);
  assertEqual(normalizeErrors('').length, 0);
  assertEqual(normalizeErrors([]).length, 0);
});

// ─── Suite 4: normalizeErrors — severity ────────────────────────────────────

suite('normalizeErrors — severity');

test('lint category → warning severity', () => {
  const result = normalizeErrors([{ message: "TS6133: 'x' is declared but its value is never read." }]);
  assertEqual(result[0].severity, 'warning');
});

test('compile category → error severity', () => {
  const result = normalizeErrors([{ message: "error TS2304: Cannot find name 'foo'" }]);
  assertEqual(result[0].severity, 'error');
});

// ─── Suite 5: extractFileLocation ───────────────────────────────────────────

suite('extractFileLocation');

test('extracts tsc format file(line,col)', () => {
  const input = `src/app.ts(42,5): error TS2304: Cannot find name 'x'`;
  const result = normalizeErrors(input);
  assertEqual(result[0].file, 'src/app.ts');
  assertEqual(result[0].line, 42);
});

test('extracts Python traceback format', () => {
  const input = `NameError: name 'foo' is not defined\n  File "app.py", line 15, in main`;
  const result = normalizeErrors(input);
  assertEqual(result[0].code, 'UNDEFINED_VARIABLE');
  // File extracted from nearby line
  assertEqual(result[0].file, 'app.py');
  assertEqual(result[0].line, 15);
});

test('extracts JS stack trace format', () => {
  const input = `ReferenceError: myFunc is not defined\n    at Object.<anonymous> (src/server.js:25:3)`;
  const result = normalizeErrors(input);
  assertEqual(result[0].file, 'src/server.js');
  assertEqual(result[0].line, 25);
});

test('no file:line found → empty file, null line', () => {
  const input = `SyntaxError: Unexpected token '}' somewhere`;
  const result = normalizeErrors(input);
  assertEqual(result[0].file, '');
  assertEqual(result[0].line, null);
});

// ─── Suite 6: deduplicateErrors ─────────────────────────────────────────────

suite('deduplicateErrors');

test('removes exact duplicates (same code+file+line)', () => {
  const errors = [
    { code: 'SYNTAX_ERROR', file: 'a.js', line: 10 },
    { code: 'SYNTAX_ERROR', file: 'a.js', line: 10 },
    { code: 'SYNTAX_ERROR', file: 'a.js', line: 10 },
  ];
  assertEqual(deduplicateErrors(errors).length, 1);
});

test('keeps errors with different lines in same file', () => {
  const errors = [
    { code: 'SYNTAX_ERROR', file: 'a.js', line: 10 },
    { code: 'SYNTAX_ERROR', file: 'a.js', line: 20 },
  ];
  assertEqual(deduplicateErrors(errors).length, 2);
});

test('keeps errors with same code but different files', () => {
  const errors = [
    { code: 'SYNTAX_ERROR', file: 'a.js', line: 10 },
    { code: 'SYNTAX_ERROR', file: 'b.js', line: 10 },
  ];
  assertEqual(deduplicateErrors(errors).length, 2);
});

test('handles empty/null input', () => {
  assertEqual(deduplicateErrors(null).length, 0);
  assertEqual(deduplicateErrors([]).length, 0);
});

// ─── Suite 7: classifyRecoverability ────────────────────────────────────────

suite('classifyRecoverability');

test('SYNTAX_ERROR → recoverable', () => {
  assert(classifyRecoverability({ code: 'SYNTAX_ERROR', category: 'compile' }), 'SYNTAX_ERROR should be recoverable');
});

test('IMPORT_NOT_FOUND → recoverable', () => {
  assert(classifyRecoverability({ code: 'IMPORT_NOT_FOUND', category: 'compile' }), 'IMPORT_NOT_FOUND should be recoverable');
});

test('ARGUMENT_COUNT → recoverable', () => {
  assert(classifyRecoverability({ code: 'ARGUMENT_COUNT', category: 'compile' }), 'ARGUMENT_COUNT should be recoverable');
});

test('PERMISSION_DENIED → not recoverable', () => {
  assert(!classifyRecoverability({ code: 'PERMISSION_DENIED', category: 'runtime' }), 'PERMISSION_DENIED should not be recoverable');
});

test('TEST_FAILED with file → recoverable', () => {
  assert(classifyRecoverability({ code: 'TEST_FAILED', file: 'test.js', category: 'test' }), 'TEST_FAILED with file should be recoverable');
});

test('TEST_FAILED without file → not recoverable', () => {
  assert(!classifyRecoverability({ code: 'TEST_FAILED', file: '', category: 'test' }), 'TEST_FAILED without file should not be recoverable');
});

// ─── Suite 8: findRootCause ─────────────────────────────────────────────────

suite('findRootCause');

test('IMPORT_NOT_FOUND + UNDEFINED_VARIABLE in same file → derivedFrom', () => {
  const errors = [
    { code: 'IMPORT_NOT_FOUND', file: 'app.js', symbol: 'config', message: "Cannot find module './config'" },
    { code: 'UNDEFINED_VARIABLE', file: 'app.js', symbol: 'configLoader', message: 'configLoader is not defined' },
  ];
  const result = findRootCause(errors);
  assertEqual(result[0].derivedFrom, null);
  assertEqual(result[1].derivedFrom, 'IMPORT_NOT_FOUND');
});

test('symbol startsWith module name → derivedFrom', () => {
  const errors = [
    { code: 'IMPORT_NOT_FOUND', file: 'server.js', symbol: 'db', message: "Cannot find module './db'" },
    { code: 'UNDEFINED_VARIABLE', file: 'routes.js', symbol: 'dbConnect', message: 'dbConnect is not defined' },
  ];
  const result = findRootCause(errors);
  assertEqual(result[1].derivedFrom, 'IMPORT_NOT_FOUND');
});

test('exact symbol name match → derivedFrom', () => {
  const errors = [
    { code: 'IMPORT_NOT_FOUND', file: 'a.js', symbol: 'express', message: "Cannot find module 'express'" },
    { code: 'UNDEFINED_VARIABLE', file: 'b.js', symbol: 'express', message: 'express is not defined' },
  ];
  const result = findRootCause(errors);
  assertEqual(result[1].derivedFrom, 'IMPORT_NOT_FOUND');
});

test('no reverse containment: util ≠ utilityFunction', () => {
  const errors = [
    { code: 'IMPORT_NOT_FOUND', file: 'a.js', symbol: 'util', message: "Cannot find module 'util'" },
    { code: 'UNDEFINED_VARIABLE', file: 'b.js', symbol: 'myHelper', message: 'myHelper is not defined' },
  ];
  const result = findRootCause(errors);
  // myHelper does NOT start with "util", so no derivedFrom
  assertEqual(result[1].derivedFrom, null);
});

test('independent errors → no derivedFrom', () => {
  const errors = [
    { code: 'SYNTAX_ERROR', file: 'a.js', symbol: null, message: 'Unexpected token' },
    { code: 'NULL_REFERENCE', file: 'b.js', symbol: null, message: 'Cannot read properties of undefined' },
  ];
  const result = findRootCause(errors);
  assertEqual(result[0].derivedFrom, null);
  assertEqual(result[1].derivedFrom, null);
});

test('single error → returned unchanged', () => {
  const errors = [{ code: 'SYNTAX_ERROR', file: 'a.js', symbol: null, message: 'err' }];
  const result = findRootCause(errors);
  assertEqual(result.length, 1);
  assertEqual(result[0].derivedFrom, null);
});

test('empty input → empty array', () => {
  assertEqual(findRootCause([]).length, 0);
  assertEqual(findRootCause(null).length, 0);
});

// ─── Suite 9: formatErrorsForLLM ───────────────────────────────────────────

suite('formatErrorsForLLM');

test('root causes appear under separate header', () => {
  const errors = [
    { code: 'IMPORT_NOT_FOUND', file: 'a.js', line: 1, symbol: 'x', message: 'missing module', recoverable: true, derivedFrom: null },
    { code: 'UNDEFINED_VARIABLE', file: 'a.js', line: 5, symbol: 'x', message: 'x not defined', recoverable: true, derivedFrom: 'IMPORT_NOT_FOUND' },
  ];
  const output = formatErrorsForLLM(errors);
  assert(output.includes('Root cause errors'), 'Should have root cause header');
  assert(output.includes('IMPORT_NOT_FOUND'), 'Should include root cause error');
  assert(output.includes('downstream'), 'Should mention downstream');
});

test('derived errors shown as omitted count', () => {
  const errors = [
    { code: 'IMPORT_NOT_FOUND', file: 'a.js', line: 1, symbol: null, message: 'err', recoverable: true, derivedFrom: null },
    { code: 'UNDEFINED_VARIABLE', file: 'a.js', line: 2, symbol: null, message: 'err', recoverable: true, derivedFrom: 'IMPORT_NOT_FOUND' },
    { code: 'UNDEFINED_VARIABLE', file: 'a.js', line: 3, symbol: null, message: 'err', recoverable: true, derivedFrom: 'IMPORT_NOT_FOUND' },
    { code: 'UNDEFINED_VARIABLE', file: 'a.js', line: 4, symbol: null, message: 'err', recoverable: true, derivedFrom: 'IMPORT_NOT_FOUND' },
  ];
  const output = formatErrorsForLLM(errors);
  assert(output.includes('3 downstream'), 'Should show 3 downstream omitted');
});

test('respects maxRoots and maxOther limits', () => {
  const errors = [];
  // 7 independent errors
  for (let i = 0; i < 7; i++) {
    errors.push({ code: 'SYNTAX_ERROR', file: `f${i}.js`, line: i, symbol: null, message: `err${i}`, recoverable: true, derivedFrom: null });
  }
  const output = formatErrorsForLLM(errors, { maxOther: 3 });
  // Should only have 3 error lines + "more omitted"
  const errorLines = output.split('\n').filter(l => l.startsWith('- **'));
  assertEqual(errorLines.length, 3);
  assert(output.includes('4 more error(s) omitted'), 'Should show overflow');
});

test('empty errors → empty string', () => {
  assertEqual(formatErrorsForLLM([]), '');
  assertEqual(formatErrorsForLLM(null), '');
});

test('single error formats correctly with code, file, line', () => {
  const errors = [
    { code: 'SYNTAX_ERROR', file: 'app.js', line: 42, symbol: null, message: 'Unexpected token', recoverable: true, derivedFrom: null },
  ];
  const output = formatErrorsForLLM(errors);
  assert(output.includes('**SYNTAX_ERROR**'), 'Should include error code');
  assert(output.includes('`app.js:42`'), 'Should include file:line');
  assert(output.includes('Unexpected token'), 'Should include message');
});

// ─── Summary ────────────────────────────────────────────────────────────────

summary();
