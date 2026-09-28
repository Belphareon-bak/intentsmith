// tests/perf-analyzer.test.js — Performance Analyzer (F12) unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual, summary } from './harness.js';
import {
  AntiPatternType,
  detectAntiPatterns,
  analyzeFilePerformance,
  formatPerfReport,
  severityScore,
} from '../src/code-intel/perf-analyzer.js';

// ═══════════════════════════════════════════════════════════════════════════
// AntiPatternType enum
// ═══════════════════════════════════════════════════════════════════════════

suite('AntiPatternType');

test('all types defined', () => {
  assertEqual(AntiPatternType.N_PLUS_ONE, 'n_plus_one', 'N_PLUS_ONE');
  assertEqual(AntiPatternType.UNBOUNDED_LOOP, 'unbounded_loop', 'UNBOUNDED_LOOP');
  assertEqual(AntiPatternType.SYNC_IN_ASYNC, 'sync_in_async', 'SYNC_IN_ASYNC');
  assertEqual(AntiPatternType.REDUNDANT_QUERY, 'redundant_query', 'REDUNDANT_QUERY');
  assertEqual(AntiPatternType.LARGE_PAYLOAD, 'large_payload', 'LARGE_PAYLOAD');
});

test('is frozen', () => {
  assert(Object.isFrozen(AntiPatternType), 'should be frozen');
});

// ═══════════════════════════════════════════════════════════════════════════
// N+1 Detection
// ═══════════════════════════════════════════════════════════════════════════

suite('N+1 detection');

test('detects DB call inside for loop (with prisma import)', () => {
  const code = `import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function getUsers(ids) {
  const results = [];
  for (const id of ids) {
    const user = await prisma.user.findUnique({ where: { id } });
    results.push(user);
  }
  return results;
}`;

  const patterns = detectAntiPatterns(code);
  const nPlus = patterns.filter(p => p.type === AntiPatternType.N_PLUS_ONE);
  assert(nPlus.length >= 1, `should detect N+1, got ${nPlus.length}`);
});

test('detects DB call inside forEach', () => {
  const code = `import knex from 'knex';
const db = knex({});

ids.forEach(async (id) => {
  const row = await db.select('*').from('users').where('id', id);
});`;

  const patterns = detectAntiPatterns(code);
  const nPlus = patterns.filter(p => p.type === AntiPatternType.N_PLUS_ONE);
  assert(nPlus.length >= 1, 'forEach + DB call = N+1');
});

test('no false positive without DB import', () => {
  const code = `
function process(items) {
  for (const item of items) {
    const result = item.find(x => x.active);
  }
}`;

  const patterns = detectAntiPatterns(code);
  const nPlus = patterns.filter(p => p.type === AntiPatternType.N_PLUS_ONE);
  assertEqual(nPlus.length, 0, 'no DB import → no N+1');
});

test('single query outside loop → no detection', () => {
  const code = `import mongoose from 'mongoose';
const users = await User.find({});
for (const u of users) {
  console.log(u.name);
}`;

  const patterns = detectAntiPatterns(code);
  const nPlus = patterns.filter(p => p.type === AntiPatternType.N_PLUS_ONE);
  assertEqual(nPlus.length, 0, 'query before loop → ok');
});

// ═══════════════════════════════════════════════════════════════════════════
// Unbounded Loop Detection
// ═══════════════════════════════════════════════════════════════════════════

suite('unbounded loop');

test('while(true) without break → detected', () => {
  const code = `
function pollForever() {
  while (true) {
    const data = fetch('/api');
    process(data);
  }
}`;

  const patterns = detectAntiPatterns(code);
  const unbounded = patterns.filter(p => p.type === AntiPatternType.UNBOUNDED_LOOP);
  assert(unbounded.length >= 1, 'while(true) no break → unbounded');
});

test('while(true) with break → not detected', () => {
  const code = `
function poll() {
  while (true) {
    const data = fetch('/api');
    if (data.done) break;
    process(data);
  }
}`;

  const patterns = detectAntiPatterns(code);
  const unbounded = patterns.filter(p => p.type === AntiPatternType.UNBOUNDED_LOOP);
  assertEqual(unbounded.length, 0, 'has break → ok');
});

test('while(true) with return → not detected', () => {
  const code = `
function poll() {
  while (true) {
    const data = fetch('/api');
    if (data.done) return data;
    process(data);
  }
}`;

  const patterns = detectAntiPatterns(code);
  const unbounded = patterns.filter(p => p.type === AntiPatternType.UNBOUNDED_LOOP);
  assertEqual(unbounded.length, 0, 'has return → ok');
});

test('for(;;) without break → detected', () => {
  const code = `
for (;;) {
  doWork();
}`;

  const patterns = detectAntiPatterns(code);
  const unbounded = patterns.filter(p => p.type === AntiPatternType.UNBOUNDED_LOOP);
  assert(unbounded.length >= 1, 'for(;;) no break → unbounded');
});

test('Python while True without break → detected', () => {
  const code = `
while True:
    data = fetch_data()
    process(data)
`;

  const patterns = detectAntiPatterns(code);
  const unbounded = patterns.filter(p => p.type === AntiPatternType.UNBOUNDED_LOOP);
  assert(unbounded.length >= 1, 'Python while True → unbounded');
});

// ═══════════════════════════════════════════════════════════════════════════
// Sync-in-Async Detection
// ═══════════════════════════════════════════════════════════════════════════

suite('sync-in-async');

test('readFileSync in async function → detected', () => {
  const code = `
async function loadConfig() {
  const data = fs.readFileSync('/etc/config');
  return JSON.parse(data);
}`;

  const patterns = detectAntiPatterns(code);
  const sync = patterns.filter(p => p.type === AntiPatternType.SYNC_IN_ASYNC);
  assert(sync.length >= 1, 'readFileSync in async → detected');
  assert(sync[0].suggestion.includes('readFile'), 'suggests async equivalent');
});

test('execSync in async function → detected', () => {
  const code = `
async function build() {
  const out = execSync('npm run build');
  return out;
}`;

  const patterns = detectAntiPatterns(code);
  const sync = patterns.filter(p => p.type === AntiPatternType.SYNC_IN_ASYNC);
  assert(sync.length >= 1, 'execSync in async → detected');
});

test('readFileSync in sync function → not detected', () => {
  const code = `
function loadConfig() {
  const data = fs.readFileSync('/etc/config');
  return JSON.parse(data);
}`;

  const patterns = detectAntiPatterns(code);
  const sync = patterns.filter(p => p.type === AntiPatternType.SYNC_IN_ASYNC);
  assertEqual(sync.length, 0, 'sync function → ok');
});

test('writeFileSync in async → detected', () => {
  const code = `
async function save(data) {
  fs.writeFileSync('out.json', JSON.stringify(data));
}`;

  const patterns = detectAntiPatterns(code);
  const sync = patterns.filter(p => p.type === AntiPatternType.SYNC_IN_ASYNC);
  assert(sync.length >= 1, 'writeFileSync in async → detected');
});

// ═══════════════════════════════════════════════════════════════════════════
// Redundant Query Detection
// ═══════════════════════════════════════════════════════════════════════════

suite('redundant query');

test('same DB call twice within 50 lines → detected', () => {
  const code = `import pg from 'pg';
const users1 = await db.query('SELECT * FROM users');
processA(users1);
const users2 = await db.query('SELECT * FROM users');
processB(users2);`;

  const patterns = detectAntiPatterns(code);
  const redundant = patterns.filter(p => p.type === AntiPatternType.REDUNDANT_QUERY);
  assert(redundant.length >= 1, 'duplicate query → detected');
});

test('different queries → not detected', () => {
  const code = `import pg from 'pg';
const users = await db.query('SELECT * FROM users');
const orders = await db.query('SELECT * FROM orders');`;

  const patterns = detectAntiPatterns(code);
  const redundant = patterns.filter(p => p.type === AntiPatternType.REDUNDANT_QUERY);
  assertEqual(redundant.length, 0, 'different queries → ok');
});

test('no DB import → no detection', () => {
  const code = `
cache.query('SELECT stuff');
cache.query('SELECT stuff');`;

  const patterns = detectAntiPatterns(code);
  const redundant = patterns.filter(p => p.type === AntiPatternType.REDUNDANT_QUERY);
  assertEqual(redundant.length, 0, 'no DB import → ok');
});

// ═══════════════════════════════════════════════════════════════════════════
// Large Payload Detection
// ═══════════════════════════════════════════════════════════════════════════

suite('large payload');

test('SELECT * without LIMIT → detected', () => {
  const code = `import pg from 'pg';
const all = await db.query("SELECT * FROM users");`;

  const patterns = detectAntiPatterns(code);
  const large = patterns.filter(p => p.type === AntiPatternType.LARGE_PAYLOAD);
  assert(large.length >= 1, 'SELECT * no LIMIT → detected');
});

test('SELECT * with LIMIT → not detected', () => {
  const code = `import pg from 'pg';
const page = await db.query("SELECT * FROM users LIMIT 20");`;

  const patterns = detectAntiPatterns(code);
  const large = patterns.filter(p => p.type === AntiPatternType.LARGE_PAYLOAD);
  assertEqual(large.length, 0, 'has LIMIT → ok');
});

test('findMany() without params → detected', () => {
  const code = `import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const all = await prisma.user.findMany();`;

  const patterns = detectAntiPatterns(code);
  const large = patterns.filter(p => p.type === AntiPatternType.LARGE_PAYLOAD);
  assert(large.length >= 1, 'findMany() empty → detected');
});

test('findMany with take → not detected', () => {
  const code = `import { PrismaClient } from '@prisma/client';
const page = await prisma.user.findMany({ take: 20 });`;

  const patterns = detectAntiPatterns(code);
  const large = patterns.filter(p => p.type === AntiPatternType.LARGE_PAYLOAD);
  assertEqual(large.length, 0, 'findMany with params → ok');
});

// ═══════════════════════════════════════════════════════════════════════════
// analyzeFilePerformance
// ═══════════════════════════════════════════════════════════════════════════

suite('analyzeFilePerformance');

test('populates file path', () => {
  const code = `import pg from 'pg';
const all = await db.query("SELECT * FROM users");`;

  const results = analyzeFilePerformance('src/db.js', code);
  assert(results.length > 0, 'should find patterns');
  assertEqual(results[0].file, 'src/db.js', 'file path populated');
});

test('empty content → empty', () => {
  assertEqual(analyzeFilePerformance('x.js', '').length, 0, 'empty → empty');
  assertEqual(analyzeFilePerformance('x.js', null).length, 0, 'null → empty');
});

// ═══════════════════════════════════════════════════════════════════════════
// formatPerfReport
// ═══════════════════════════════════════════════════════════════════════════

suite('formatPerfReport');

test('formats patterns', () => {
  const patterns = [
    { type: 'n_plus_one', line: 10, severity: 'warning', description: 'N+1 query', file: 'app.js' },
    { type: 'sync_in_async', line: 20, severity: 'warning', description: 'Sync I/O', file: 'svc.js' },
  ];
  const report = formatPerfReport(patterns);
  assert(report.includes('[WARNING]'), 'includes severity');
  assert(report.includes('app.js:10'), 'includes location');
  assert(report.includes('N+1 query'), 'includes description');
});

test('caps at maxEntries', () => {
  const patterns = Array.from({ length: 20 }, (_, i) => ({
    type: 'test', line: i, severity: 'info', description: `p${i}`,
  }));
  const report = formatPerfReport(patterns, 5);
  const lines = report.split('\n');
  assertEqual(lines.length, 6, '5 entries + 1 omitted line');
  assert(report.includes('15 more'), 'shows omitted count');
});

test('empty → empty string', () => {
  assertEqual(formatPerfReport([]), '', 'empty → empty');
  assertEqual(formatPerfReport(null), '', 'null → empty');
});

// ═══════════════════════════════════════════════════════════════════════════
// severityScore
// ═══════════════════════════════════════════════════════════════════════════

suite('severityScore');

test('clean code → 100', () => {
  assertEqual(severityScore([]), 100, 'no patterns → 100');
});

test('warnings reduce score', () => {
  const patterns = [
    { severity: 'warning' },
    { severity: 'warning' },
  ];
  const score = severityScore(patterns);
  assertEqual(score, 70, '2 warnings (15 each) → 70');
});

test('mixed severities', () => {
  const patterns = [
    { severity: 'warning' },
    { severity: 'info' },
  ];
  const score = severityScore(patterns);
  assertEqual(score, 80, 'warning(15) + info(5) → 80');
});

test('many patterns → floor at 0', () => {
  const patterns = Array.from({ length: 10 }, () => ({ severity: 'warning' }));
  const score = severityScore(patterns);
  assertEqual(score, 0, '10 warnings → floor at 0');
});

test('null → 100', () => {
  assertEqual(severityScore(null), 100, 'null → 100');
});

// ═══════════════════════════════════════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════════════════════════════════════

suite('edge cases');

test('empty content → no patterns', () => {
  assertEqual(detectAntiPatterns('').length, 0, 'empty → 0');
});

test('null content → no patterns', () => {
  assertEqual(detectAntiPatterns(null).length, 0, 'null → 0');
});

test('non-string content → no patterns', () => {
  assertEqual(detectAntiPatterns(123).length, 0, 'number → 0');
});

test('results sorted by line number', () => {
  const code = `import pg from 'pg';
async function a() {
  fs.readFileSync('x');
}
const q1 = await db.query("SELECT * FROM t");`;

  const patterns = detectAntiPatterns(code);
  for (let i = 1; i < patterns.length; i++) {
    assert(patterns[i].line >= patterns[i - 1].line, 'should be sorted by line');
  }
});

// ═══════════════════════════════════════════════════════════════════════════

summary();
