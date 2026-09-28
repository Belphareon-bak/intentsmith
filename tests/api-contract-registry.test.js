// tests/api-contract-registry.test.js — API Contract Registry unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual, summary } from './harness.js';
import { extractExports } from '../src/planner/api-contract-registry.js';

// ─── Export Extraction — JavaScript ────────────────────────────────────────

suite('API Contract Registry — JS Exports');

test('extracts export function', () => {
  const code = `export function createUser(name, email) { return { name, email }; }`;
  const exports = extractExports(code, '.js');
  assertEqual(exports.length, 1);
  assertEqual(exports[0].name, 'createUser');
  assertEqual(exports[0].signature, 'name, email');
  assertEqual(exports[0].kind, 'function');
});

test('extracts export async function', () => {
  const code = `export async function fetchData(url, opts) { return await fetch(url, opts); }`;
  const exports = extractExports(code, '.js');
  assertEqual(exports.length, 1);
  assertEqual(exports[0].name, 'fetchData');
  assert(exports[0].signature.includes('url'), `signature should include url, got: ${exports[0].signature}`);
});

test('extracts export class', () => {
  const code = `export class UserService { constructor(db) {} }`;
  const exports = extractExports(code, '.js');
  assertEqual(exports.length, 1);
  assertEqual(exports[0].name, 'UserService');
  assertEqual(exports[0].kind, 'class');
});

test('extracts export const', () => {
  const code = `export const MAX_RETRIES = 3;`;
  const exports = extractExports(code, '.js');
  assertEqual(exports.length, 1);
  assertEqual(exports[0].name, 'MAX_RETRIES');
  assertEqual(exports[0].kind, 'constant');
});

test('extracts export default function', () => {
  const code = `export default function handleRequest(req, res) { res.send('ok'); }`;
  const exports = extractExports(code, '.js');
  assertEqual(exports.length, 1);
  assertEqual(exports[0].name, 'handleRequest');
});

test('extracts module.exports', () => {
  const code = `module.exports.createUser = function(name) {};\nmodule.exports.deleteUser = function(id) {};`;
  const exports = extractExports(code, '.js');
  assert(exports.length >= 2, `should find 2 exports, got: ${exports.length}`);
  const names = exports.map(e => e.name);
  assert(names.includes('createUser'), 'should find createUser');
  assert(names.includes('deleteUser'), 'should find deleteUser');
});

test('extracts multiple exports from same file', () => {
  const code = `
export function foo() {}
export class Bar {}
export const BAZ = 42;
`;
  const exports = extractExports(code, '.js');
  assertEqual(exports.length, 3);
});

test('skips private exports (underscore prefix)', () => {
  const code = `export function _internal() {}`;
  const exports = extractExports(code, '.js');
  assertEqual(exports.length, 0);
});

test('deduplicates by name', () => {
  const code = `
export function foo() {}
exports.foo = bar;
`;
  const exports = extractExports(code, '.js');
  assertEqual(exports.length, 1);
});

// ─── Export Extraction — Python ────────────────────────────────────────────

suite('API Contract Registry — Python Exports');

test('extracts Python function', () => {
  const code = `def create_user(name, email):\n    return {"name": name}`;
  const exports = extractExports(code, '.py');
  assertEqual(exports.length, 1);
  assertEqual(exports[0].name, 'create_user');
  assertEqual(exports[0].kind, 'function');
});

test('extracts Python class', () => {
  const code = `class UserService:\n    def __init__(self):\n        pass`;
  const exports = extractExports(code, '.py');
  assertEqual(exports.length, 1);
  assertEqual(exports[0].name, 'UserService');
  assertEqual(exports[0].kind, 'class');
});

test('extracts Python function with type hints', () => {
  const code = `def get_user(user_id: int) -> dict:\n    pass`;
  const exports = extractExports(code, '.py');
  assertEqual(exports.length, 1);
  assertEqual(exports[0].name, 'get_user');
});

test('skips Python private functions', () => {
  const code = `def _helper():\n    pass`;
  const exports = extractExports(code, '.py');
  assertEqual(exports.length, 0);
});

// ─── Export Extraction — Go ──────────────────────────────────────────────

suite('API Contract Registry — Go Exports');

test('extracts Go exported function', () => {
  const code = `func CreateUser(name string, email string) error {\n    return nil\n}`;
  const exports = extractExports(code, '.go');
  assertEqual(exports.length, 1);
  assertEqual(exports[0].name, 'CreateUser');
  assertEqual(exports[0].kind, 'function');
});

test('extracts Go exported type struct', () => {
  const code = `type UserService struct {\n    db *sql.DB\n}`;
  const exports = extractExports(code, '.go');
  assertEqual(exports.length, 1);
  assertEqual(exports[0].name, 'UserService');
  assertEqual(exports[0].kind, 'type');
});

test('skips Go unexported (lowercase) functions', () => {
  const code = `func helper() {}`;
  const exports = extractExports(code, '.go');
  assertEqual(exports.length, 0);
});

// ─── Edge Cases ──────────────────────────────────────────────────────────

suite('API Contract Registry — Edge Cases');

test('returns empty for unknown extension', () => {
  const exports = extractExports('some code', '.txt');
  assertEqual(exports.length, 0);
});

test('handles empty content', () => {
  const exports = extractExports('', '.js');
  assertEqual(exports.length, 0);
});

test('handles null content', () => {
  const exports = extractExports(null, '.js');
  assertEqual(exports.length, 0);
});

test('handles .ts extension', () => {
  const code = `export function processData(input: string): string { return input; }`;
  const exports = extractExports(code, '.ts');
  assertEqual(exports.length, 1);
  assertEqual(exports[0].name, 'processData');
});

// ─── Summary ────────────────────────────────────────────────────────────────

summary();
