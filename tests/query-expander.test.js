// tests/query-expander.test.js — Query Expander unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual, summary } from './harness.js';
import { expandQuery, buildSearchQueries } from '../src/code-intel/query-expander.js';

suite('Query Expander — Identifier Extraction');

test('extracts camelCase identifier', () => {
  const r = expandQuery('why forwardingAddress fails');
  assert(r.primary.includes('forwardingAddress'), `should find forwardingAddress, got: ${r.primary}`);
});

test('extracts snake_case identifier', () => {
  const r = expandQuery('the NOT_RETURNED_BY_DEFAULT flag is set');
  assert(r.primary.includes('NOT_RETURNED_BY_DEFAULT'), `should find NOT_RETURNED_BY_DEFAULT, got: ${r.primary}`);
});

test('extracts PascalCase identifier', () => {
  const r = expandQuery('class DominoAccountAttribute has a problem');
  assert(r.primary.includes('DominoAccountAttribute'), `should find DominoAccountAttribute, got: ${r.primary}`);
});

test('extracts multi-word identifiers', () => {
  const r = expandQuery('check handleUserLogin function');
  assert(r.primary.includes('handleUserLogin'), 'should find handleUserLogin');
});

suite('Query Expander — camelCase Decomposition');

test('decomposes camelCase into sub-terms', () => {
  const r = expandQuery('forwardingAddress is broken');
  assert(r.secondary.includes('forwarding'), `should have "forwarding" in secondary, got: ${r.secondary}`);
  assert(r.secondary.includes('address'), `should have "address" in secondary, got: ${r.secondary}`);
});

test('decomposes UPPER_CASE into sub-terms', () => {
  const r = expandQuery('NOT_RETURNED_BY_DEFAULT');
  assert(r.secondary.length > 0, 'should have secondary terms');
  assert(r.secondary.includes('returned'), `should have "returned", got: ${r.secondary}`);
});

suite('Query Expander — Stop Words');

test('filters English stop words', () => {
  const r = expandQuery('why does the function fail');
  const allTerms = [...r.primary, ...r.secondary, ...r.terms];
  assert(!allTerms.includes('why'), 'should filter "why"');
  assert(!allTerms.includes('does'), 'should filter "does"');
  assert(!allTerms.includes('the'), 'should filter "the"');
});

test('filters Czech stop words', () => {
  const r = expandQuery('proč ta funkce nefunguje');
  const allTerms = [...r.primary, ...r.secondary, ...r.terms].map(t => t.toLowerCase());
  assert(!allTerms.includes('proč'), 'should filter "proč"');
  assert(!allTerms.includes('ta'), 'should filter "ta"');
});

suite('Query Expander — Technical Terms');

test('promotes technical terms to primary', () => {
  const r = expandQuery('there is a timeout error in the API');
  assert(r.primary.some(p => p.toLowerCase() === 'timeout'), `should promote "timeout", got: ${r.primary}`);
  assert(r.primary.some(p => p.toLowerCase() === 'error'), `should promote "error", got: ${r.primary}`);
  assert(r.primary.some(p => p.toLowerCase() === 'api'), `should promote "api", got: ${r.primary}`);
});

suite('Query Expander — Edge Cases');

test('empty input returns empty', () => {
  const r = expandQuery('');
  assertEqual(r.primary.length, 0);
  assertEqual(r.secondary.length, 0);
  assertEqual(r.terms.length, 0);
});

test('null input returns empty', () => {
  const r = expandQuery(null);
  assertEqual(r.primary.length, 0);
});

test('only stop words returns empty primary', () => {
  const r = expandQuery('the is a');
  assertEqual(r.primary.length, 0);
});

suite('Query Expander — buildSearchQueries');

test('uses primary terms first', () => {
  const expanded = expandQuery('why forwardingAddress fails');
  const queries = buildSearchQueries(expanded);
  assert(queries.length > 0, 'should produce queries');
  assertEqual(queries[0], 'forwardingAddress');
});

test('falls back to secondary when no primary', () => {
  // Only stop words = no primary, but expandQuery should still find some terms
  const expanded = { primary: [], secondary: ['forwarding', 'address'], terms: ['something'] };
  const queries = buildSearchQueries(expanded);
  assert(queries.includes('forwarding'), 'should use secondary');
});

test('falls back to terms when no primary or secondary', () => {
  const expanded = { primary: [], secondary: [], terms: ['something'] };
  const queries = buildSearchQueries(expanded);
  assert(queries.includes('something'), 'should use terms');
});

suite('Query Expander — Real-world Queries');

test('Czech: "analyzuj kód pro autentizaci"', () => {
  const r = expandQuery('analyzuj kód pro autentizaci');
  assert(r.terms.length > 0, 'should extract terms');
});

test('English: "why does validateToken throw null pointer"', () => {
  const r = expandQuery('why does validateToken throw null pointer');
  assert(r.primary.includes('validateToken'), 'should find validateToken');
});

test('Mixed: "proč forwardingAddress nefunguje v DominoConnector"', () => {
  const r = expandQuery('proč forwardingAddress nefunguje v DominoConnector');
  assert(r.primary.includes('forwardingAddress'), 'should find forwardingAddress');
  assert(r.primary.includes('DominoConnector'), 'should find DominoConnector');
});

summary();
