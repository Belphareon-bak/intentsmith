#!/usr/bin/env node

import {
  test,
  assert,
  assertEqual,
  summary,
} from './harness.js';

import {
  computeMath,
  formatLocalResponse,
} from '../src/chat/handlers/local.js';

import {
  formatMathResponse,
} from '../src/chat/handlers/utils/local-i18n.js';

test('computeMath preserves NaN sentinel for non-zero division by zero', () => {
  const result = computeMath('5 / 0');

  assert(Number.isNaN(result.answer), 'answer must be NaN sentinel');
  assertEqual(result.error, 'non_finite_result');
  assertEqual(result.nonFiniteResult, 'Infinity');
  assertEqual(result.expression, '5/0');
});

test('computeMath preserves NaN sentinel for zero divided by zero', () => {
  const result = computeMath('0 / 0');

  assert(Number.isNaN(result.answer), 'answer must be NaN sentinel');
  assertEqual(result.error, 'non_finite_result');
  assertEqual(result.nonFiniteResult, 'NaN');
  assertEqual(result.expression, '0/0');
});

test('computeMath handles non-finite Czech normalized division', () => {
  const result = computeMath('5 děleno 0');

  assert(Number.isNaN(result.answer), 'answer must be NaN sentinel');
  assertEqual(result.error, 'non_finite_result');
  assertEqual(result.nonFiniteResult, 'Infinity');
  assertEqual(result.expression, '5 / 0');
});

test('formatLocalResponse does not display literal NaN for non-finite math', () => {
  const result = computeMath('5 / 0');
  const response = formatLocalResponse('5 / 0', result, 'local.math', 'cs');

  assert(!response.includes('NaN'), `response must not display NaN: ${response}`);
  assert(response.includes('non_finite_result'), `response should include structured error: ${response}`);
});

test('formatMathResponse does not display literal NaN when called directly', () => {
  const response = formatMathResponse('5/0', NaN, 'en');

  assert(!response.includes('NaN'), `response must not display NaN: ${response}`);
  assert(response.includes('not a finite number'), `response should explain non-finite result: ${response}`);
});

summary();
