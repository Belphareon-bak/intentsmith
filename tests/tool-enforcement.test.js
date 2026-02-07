#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// C3-Agent v57.2 — Tool-Only Enforcement Guard Tests
// ═══════════════════════════════════════════════════════════════════════════════
// Run: node tests/tool-enforcement.test.js

import {
  extractNumericClaims,
  isSafeNumber,
  extractNumbersFromToolData,
  fuzzyNumberMatch,
  verifyNumericClaims,
  buildToolEnforcementRetryPrompt,
} from '../src/experts/guards/tool-enforcement.js';

let passed = 0, failed = 0;
const failures = [];

function ok(n) { passed++; console.log(`  ✅ ${n}`); }
function fail(n, e) { failed++; failures.push({ n, m: e?.message || String(e) }); console.log(`  ❌ ${n}: ${e?.message || e}`); }
async function test(n, fn) { try { await fn(); ok(n); } catch (e) { fail(n, e); } }
function assert(c, m) { if (!c) throw new Error(m || 'Assertion failed'); }

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Number Extraction from Response
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n📋 1. extractNumericClaims (12 tests)');

await test('extracts currency — Kč', () => {
  const claims = extractNumericClaims('Cena je 15 499 Kč bez DPH.');
  const curr = claims.find(c => c.category === 'currency');
  assert(curr, 'should find currency');
  assert(curr.normalized === '15499', `got ${curr.normalized}`);
});

await test('extracts currency — EUR', () => {
  const claims = extractNumericClaims('Total cost: 1500 EUR.');
  const curr = claims.find(c => c.category === 'currency');
  assert(curr, 'should find currency');
  assert(curr.normalized === '1500', `got ${curr.normalized}`);
});

await test('extracts currency — $ prefix', () => {
  const claims = extractNumericClaims('Price was $299.99');
  // This may match as currency or decimal depending on pattern order
  const found = claims.some(c => c.normalized.includes('299'));
  assert(found, `should find 299 somewhere in claims: ${JSON.stringify(claims)}`);
});

await test('extracts percentage', () => {
  const claims = extractNumericClaims('DPH je 21% a sleva 3.5 %.');
  const pcts = claims.filter(c => c.category === 'percentage');
  assert(pcts.length >= 2, `expected 2 percentages, got ${pcts.length}`);
  assert(pcts.some(p => p.normalized === '21'), 'should find 21');
  assert(pcts.some(p => p.normalized === '3.5'), 'should find 3.5');
});

await test('extracts ISO date', () => {
  const claims = extractNumericClaims('Deadline je 2025-04-01.');
  const date = claims.find(c => c.category === 'date_iso');
  assert(date, 'should find ISO date');
  assert(date.normalized === '20250401', `got ${date.normalized}`);
});

await test('extracts Czech date', () => {
  const claims = extractNumericClaims('Termín: 1.4.2025');
  const date = claims.find(c => c.category === 'date_cz');
  assert(date, 'should find Czech date');
  assert(date.normalized === '20250401', `got ${date.normalized}`);
});

await test('extracts large integer', () => {
  const claims = extractNumericClaims('Populace města je 150000 obyvatel.');
  const int = claims.find(c => c.normalized === '150000');
  assert(int, 'should find 150000');
});

await test('extracts decimal', () => {
  const claims = extractNumericClaims('Koeficient je 1,75 a průměr 3.14.');
  const decs = claims.filter(c => c.category === 'decimal');
  assert(decs.length >= 2, `expected 2+ decimals, got ${decs.length}`);
});

await test('skips numbers in URLs', () => {
  const claims = extractNumericClaims('Viz https://example.com/2024/report/15499');
  const curr = claims.find(c => c.normalized === '15499');
  assert(!curr, 'should not extract number from URL');
});

await test('handles no numbers', () => {
  const claims = extractNumericClaims('Odpověď bez jakýchkoliv čísel.');
  assert(claims.length === 0, `expected 0, got ${claims.length}`);
});

await test('handles empty string', () => {
  assert(extractNumericClaims('').length === 0);
  assert(extractNumericClaims(null).length === 0);
});

await test('extracts spaced integer', () => {
  const claims = extractNumericClaims('Cena domu je 3 500 000 korun.');
  const big = claims.find(c => c.normalized === '3500000');
  assert(big, `should find 3500000, got: ${JSON.stringify(claims.map(c => c.normalized))}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Safe Number Detection
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n🛡️ 2. isSafeNumber (8 tests)');

await test('single digit is safe', () => {
  assert(isSafeNumber({ raw: '5', normalized: '5', category: 'integer' }));
});

await test('list marker is safe', () => {
  assert(isSafeNumber({ raw: '1.', normalized: '1', category: 'integer' }));
  assert(isSafeNumber({ raw: '3)', normalized: '3', category: 'integer' }));
});

await test('footnote ref is safe', () => {
  assert(isSafeNumber({ raw: '[2]', normalized: '2', category: 'integer' }));
});

await test('version number is safe', () => {
  assert(isSafeNumber({ raw: 'v57', normalized: '57', category: 'integer' }));
});

await test('standalone year is safe', () => {
  assert(isSafeNumber({ raw: '2024', normalized: '2024', category: 'integer' }));
  assert(isSafeNumber({ raw: '1999', normalized: '1999', category: 'integer' }));
});

await test('year as currency is NOT safe', () => {
  assert(!isSafeNumber({ raw: '2024 Kč', normalized: '2024', category: 'currency' }));
});

await test('large number is NOT safe', () => {
  assert(!isSafeNumber({ raw: '15499', normalized: '15499', category: 'integer' }));
});

await test('percentage is NOT safe', () => {
  assert(!isSafeNumber({ raw: '21%', normalized: '21', category: 'percentage' }));
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Tool Data Number Extraction
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n🔍 3. extractNumbersFromToolData (5 tests)');

await test('extracts from search results', () => {
  const results = [{
    type: 'search',
    data: {
      results: [
        { title: 'Cena bydlení', snippet: 'Průměrná cena je 15 499 Kč za m²' },
        { title: 'DPH', snippet: 'Sazba DPH je 21%' },
      ],
    },
  }];
  const nums = extractNumbersFromToolData(results);
  assert(nums.has('15499'), `should contain 15499, got: ${[...nums].join(', ')}`);
  assert(nums.has('21'), `should contain 21`);
});

await test('extracts from scrape content', () => {
  const results = [{
    type: 'scrape',
    data: { content: 'Rozpočet: 3 500 000 Kč. Deadline: 2025-04-01', title: 'Budget report' },
  }];
  const nums = extractNumbersFromToolData(results);
  assert(nums.has('3500000'), `should contain 3500000`);
  assert(nums.has('20250401'), `should contain 20250401`);
});

await test('extracts from numeric values', () => {
  const results = [{
    type: 'local',
    data: { price: 299.99, count: 42, items: [{ amount: 1500 }] },
  }];
  const nums = extractNumbersFromToolData(results);
  assert(nums.has('299.99') || nums.has('300'), `should contain 299.99`);
  assert(nums.has('42'), `should contain 42`);
  assert(nums.has('1500'), `should contain 1500`);
});

await test('handles empty/null tool results', () => {
  assert(extractNumbersFromToolData([]).size === 0);
  assert(extractNumbersFromToolData(null).size === 0);
});

await test('handles nested objects', () => {
  const results = [{
    type: 'local',
    data: { deep: { nested: { value: 'celkem 5000 Kč' } } },
  }];
  const nums = extractNumbersFromToolData(results);
  assert(nums.has('5000'), `should contain 5000`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Fuzzy Number Matching
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n🎯 4. fuzzyNumberMatch (5 tests)');

await test('exact match', () => {
  assert(fuzzyNumberMatch('15499', new Set(['15499', '21'])));
});

await test('fuzzy match within 1%', () => {
  // 15500 vs 15499 → diff = 1, tolerance = 154.99 → matches
  assert(fuzzyNumberMatch('15500', new Set(['15499'])));
});

await test('fuzzy match fails beyond 1%', () => {
  // 16000 vs 15499 → diff = 501, tolerance = 160 → no match
  assert(!fuzzyNumberMatch('16000', new Set(['15499'])));
});

await test('no fuzzy for small numbers', () => {
  // Numbers <= 100 must match exactly
  assert(!fuzzyNumberMatch('51', new Set(['50'])));
});

await test('handles NaN', () => {
  assert(!fuzzyNumberMatch('abc', new Set(['123'])));
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Core Verification
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n✅ 5. verifyNumericClaims (8 tests)');

await test('all numbers backed → ok', () => {
  const response = 'Cena je 15 499 Kč a DPH 21%.';
  const tools = [{ type: 'search', data: { results: [{ snippet: '15 499 Kč, DPH 21%' }] } }];
  const v = verifyNumericClaims(response, tools);
  assert(v.ok, `should be ok, unbacked: ${JSON.stringify(v.unbacked)}`);
});

await test('unbacked number → not ok', () => {
  const response = 'Cena je 15 499 Kč a poplatek 350 Kč.';
  const tools = [{ type: 'search', data: { results: [{ snippet: '15 499 Kč' }] } }];
  const v = verifyNumericClaims(response, tools);
  assert(!v.ok, 'should not be ok');
  assert(v.unbacked.length >= 1, 'should have unbacked');
  assert(v.unbacked.some(u => u.normalized === '350'), `should flag 350, got: ${JSON.stringify(v.unbacked)}`);
});

await test('safe numbers excluded', () => {
  const response = '1. Cena: data.\n2. DPH: data.\nRok 2024.';
  const v = verifyNumericClaims(response, []);
  assert(v.safe.length > 0, 'should have safe numbers');
  assert(v.unbacked.length === 0, `should have no unbacked, got: ${JSON.stringify(v.unbacked)}`);
});

await test('no numbers → ok', () => {
  const v = verifyNumericClaims('Odpověď bez čísel.', []);
  assert(v.ok);
  assert(v.unbacked.length === 0);
  assert(v.backed.length === 0);
  assert(v.safe.length === 0);
});

await test('empty tools → all non-safe unbacked', () => {
  const response = 'Celková cena: 25 000 Kč.';
  const v = verifyNumericClaims(response, []);
  assert(!v.ok);
  assert(v.unbacked.length >= 1);
});

await test('fuzzy match works in verification', () => {
  const response = 'Cena je přibližně 15 500 Kč.';
  const tools = [{ type: 'search', data: { results: [{ snippet: 'cena 15 499 Kč' }] } }];
  const v = verifyNumericClaims(response, tools);
  assert(v.ok, `should be ok (fuzzy), unbacked: ${JSON.stringify(v.unbacked)}`);
});

await test('mix of backed, unbacked, safe', () => {
  const response = '1. Byt stojí 3 500 000 Kč.\n2. Poplatek je 5000 Kč.\nRok 2025.';
  const tools = [{ type: 'scrape', data: { content: 'cena bytu 3 500 000 Kč' } }];
  const v = verifyNumericClaims(response, tools);
  assert(v.backed.length >= 1, `backed: ${v.backed.length}`);
  assert(v.unbacked.length >= 1, `unbacked: ${v.unbacked.length}`);
  assert(v.safe.length >= 1, `safe: ${v.safe.length}`);
});

await test('null/undefined response → ok', () => {
  assert(verifyNumericClaims(null, []).ok);
  assert(verifyNumericClaims(undefined, []).ok);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Retry Prompt Builder
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n🔄 6. buildToolEnforcementRetryPrompt (3 tests)');

await test('contains unbacked numbers', () => {
  const verdict = {
    ok: false,
    unbacked: [
      { raw: '350 Kč', normalized: '350', category: 'currency', context: 'poplatek je 350 Kč za službu' },
    ],
    backed: [],
    safe: [],
    reason: '1 unbacked',
  };
  const prompt = buildToolEnforcementRetryPrompt('original prompt', verdict);
  assert(prompt.includes('350 Kč'), 'should include the unbacked number');
  assert(prompt.includes('REJECTED'), 'should include rejection header');
});

await test('preserves original prompt', () => {
  const verdict = { ok: false, unbacked: [{ raw: '99', normalized: '99', category: 'integer', context: 'foo 99 bar' }], backed: [], safe: [] };
  const prompt = buildToolEnforcementRetryPrompt('My original query here', verdict);
  assert(prompt.startsWith('My original query here'), 'should start with original prompt');
});

await test('includes correction instructions', () => {
  const verdict = { ok: false, unbacked: [{ raw: '42%', normalized: '42', category: 'percentage', context: 'asi 42% lidí' }], backed: [], safe: [] };
  const prompt = buildToolEnforcementRetryPrompt('prompt', verdict);
  assert(prompt.includes('REMOVE'), 'should mention removal option');
  assert(prompt.includes('údaj není k dispozici'), 'should mention alternative');
});

// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(60));
console.log(`Tool Enforcement: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ❌ ${f.n}: ${f.m}`);
}
console.log('═'.repeat(60));
process.exit(failed > 0 ? 1 : 0);
