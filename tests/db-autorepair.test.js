// Test: database.js auto-repair for broken better-sqlite3 native binding
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, summary } from './harness.js';
import { createRequire } from 'module';

suite('DB auto-repair — binding error detection');

const BINDING_REGEX = /bindings|\.node|NAPI|MODULE_NOT_FOUND/i;

test('detects "Could not locate the bindings file"', () => {
  assert(BINDING_REGEX.test('Could not locate the bindings file. Tried: /path/better_sqlite3.node'));
});

test('detects MODULE_NOT_FOUND', () => {
  assert(BINDING_REGEX.test("Cannot find module '/path/better_sqlite3.node'"));
});

test('detects NAPI error', () => {
  assert(BINDING_REGEX.test('NAPI module failed to load'));
});

test('detects .node extension mention', () => {
  assert(BINDING_REGEX.test('Error loading /foo/bar/better_sqlite3.node'));
});

test('does NOT match unrelated import errors', () => {
  assert(!BINDING_REGEX.test('Cannot find module "some-other-package"'));
});

test('does NOT match syntax errors', () => {
  assert(!BINDING_REGEX.test('SyntaxError: Unexpected token {'));
});

test('does NOT match type errors', () => {
  assert(!BINDING_REGEX.test('TypeError: db.prepare is not a function'));
});

test('better-sqlite3 resolves (binding healthy)', () => {
  const req = createRequire(import.meta.url);
  const resolved = req.resolve('better-sqlite3');
  assert(typeof resolved === 'string' && resolved.length > 0);
});

test('better-sqlite3 loads and creates DB (binding healthy)', () => {
  const req = createRequire(import.meta.url);
  const Database = req('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE t(x)');
  db.prepare('INSERT INTO t VALUES(?)').run(42);
  const row = db.prepare('SELECT x FROM t').get();
  assert(row.x === 42, 'in-memory DB should work');
  db.close();
});

summary();
