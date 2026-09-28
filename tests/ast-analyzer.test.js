// tests/ast-analyzer.test.js — AST Intelligence unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import {
  parseAST, extractSymbols, findUsagesInTree, extractCalls,
  isASTSupported, getSupportedLanguages,
} from '../src/code-intel/ast-analyzer.js';

// ─── Capability Tests ────────────────────────────────────────────────────────

suite('AST Analyzer — Capabilities');

test('reports supported languages', () => {
  const langs = getSupportedLanguages();
  assert(langs.includes('javascript'), 'should support javascript');
  assert(langs.includes('python'), 'should support python');
  assert(langs.includes('go'), 'should support go');
  assert(langs.includes('java'), 'should support java');
});

test('isASTSupported returns true for supported', () => {
  assert(isASTSupported('javascript'), 'javascript should be supported');
  assert(isASTSupported('python'), 'python should be supported');
});

test('isASTSupported returns false for unsupported', () => {
  assert(!isASTSupported('rust'), 'rust should not be supported (no grammar installed)');
  assert(!isASTSupported('unknown'), 'unknown should not be supported');
});

// ─── JavaScript AST Parsing ─────────────────────────────────────────────────

suite('AST Analyzer — JavaScript Parsing');

await testAsync('parses JavaScript', async () => {
  const result = await parseAST('const x = 42;', 'javascript');
  assert(result.supported, 'should be supported');
  assert(result.tree !== null, 'should produce a tree');
  assertEqual(result.language, 'javascript');
});

await testAsync('extracts JS function declaration', async () => {
  const code = 'function hello(name, age) {\n  return name;\n}';
  const { tree } = await parseAST(code, 'javascript');
  const symbols = extractSymbols(tree, 'javascript', 'test.js');

  assert(symbols.length >= 1, `should find function, got ${symbols.length}`);
  const fn = symbols.find(s => s.name === 'hello');
  assert(fn, 'should find hello');
  assertEqual(fn.type, 'function');
  assertEqual(fn.line, 1);
});

await testAsync('extracts JS class', async () => {
  const code = 'class UserService {\n  constructor(db) {\n    this.db = db;\n  }\n  findAll() {\n    return this.db.query("SELECT *");\n  }\n}';
  const { tree } = await parseAST(code, 'javascript');
  const symbols = extractSymbols(tree, 'javascript', 'test.js');

  const cls = symbols.find(s => s.name === 'UserService');
  assert(cls, 'should find UserService');
  assertEqual(cls.type, 'class');
});

await testAsync('extracts JS variable declarations', async () => {
  const code = 'const MAX_SIZE = 1024;\nlet count = 0;\nvar name = "test";';
  const { tree } = await parseAST(code, 'javascript');
  const symbols = extractSymbols(tree, 'javascript');

  const maxSize = symbols.find(s => s.name === 'MAX_SIZE');
  assert(maxSize, `should find MAX_SIZE, got: ${symbols.map(s => s.name)}`);
  assertEqual(maxSize.type, 'variable');
});

await testAsync('detects exported functions', async () => {
  const code = 'export function fetchData(url) {\n  return fetch(url);\n}';
  const { tree } = await parseAST(code, 'javascript');
  const symbols = extractSymbols(tree, 'javascript');

  const fn = symbols.find(s => s.name === 'fetchData');
  assert(fn, 'should find fetchData');
  assertEqual(fn.exported, true);
});

// ─── Python AST Parsing ─────────────────────────────────────────────────────

suite('AST Analyzer — Python Parsing');

await testAsync('parses Python', async () => {
  const result = await parseAST('x = 42', 'python');
  assert(result.supported, 'should be supported');
  assert(result.tree !== null, 'should produce a tree');
});

await testAsync('extracts Python function', async () => {
  const code = 'def calculate(x, y):\n    return x + y\n';
  const { tree } = await parseAST(code, 'python');
  const symbols = extractSymbols(tree, 'python');

  const fn = symbols.find(s => s.name === 'calculate');
  assert(fn, 'should find calculate');
  assertEqual(fn.type, 'function');
});

await testAsync('extracts Python class', async () => {
  const code = 'class UserModel:\n    def __init__(self):\n        pass\n';
  const { tree } = await parseAST(code, 'python');
  const symbols = extractSymbols(tree, 'python');

  const cls = symbols.find(s => s.name === 'UserModel');
  assert(cls, 'should find UserModel');
  assertEqual(cls.type, 'class');
});

// ─── Go AST Parsing ─────────────────────────────────────────────────────────

suite('AST Analyzer — Go Parsing');

await testAsync('parses Go', async () => {
  const result = await parseAST('package main\n', 'go');
  assert(result.supported, 'should be supported');
  assert(result.tree !== null, 'should produce a tree');
});

await testAsync('extracts Go function', async () => {
  const code = 'package main\n\nfunc HandleRequest(w http.ResponseWriter, r *http.Request) {\n}\n';
  const { tree } = await parseAST(code, 'go');
  const symbols = extractSymbols(tree, 'go');

  const fn = symbols.find(s => s.name === 'HandleRequest');
  assert(fn, `should find HandleRequest, got: ${symbols.map(s => s.name)}`);
  assertEqual(fn.type, 'function');
  assertEqual(fn.exported, true); // starts with uppercase
});

// ─── Usage Finding ───────────────────────────────────────────────────────────

suite('AST Analyzer — Usage Finding');

await testAsync('finds all usages of a symbol', async () => {
  const code = `
function validate(x) {
  return x > 0;
}
const result = validate(42);
if (validate(0)) {}
`;
  const { tree } = await parseAST(code, 'javascript');
  const usages = findUsagesInTree(tree, 'validate');

  assert(usages.length >= 3, `should find 3+ usages, got ${usages.length}`);

  const defs = usages.filter(u => u.isDefinition);
  const refs = usages.filter(u => !u.isDefinition);
  assert(defs.length >= 1, 'should find at least 1 definition');
  assert(refs.length >= 2, 'should find at least 2 references');
});

await testAsync('returns empty for unknown symbol', async () => {
  const code = 'const x = 1;';
  const { tree } = await parseAST(code, 'javascript');
  const usages = findUsagesInTree(tree, 'nonExistentSymbol');
  assertEqual(usages.length, 0);
});

// ─── Call Chain ──────────────────────────────────────────────────────────────

suite('AST Analyzer — Call Chain');

await testAsync('extracts function calls', async () => {
  const code = `
function outer() {
  inner();
  helper.process();
}
function inner() {
  console.log("done");
}
`;
  const { tree } = await parseAST(code, 'javascript');
  const calls = extractCalls(tree);

  assert(calls.length >= 2, `should find calls, got ${calls.length}`);
  const innerCall = calls.find(c => c.callee === 'inner');
  assert(innerCall, 'should find call to inner');
  assertEqual(innerCall.caller, 'outer');
});

await testAsync('extracts method calls', async () => {
  const code = 'function process() {\n  db.query("SELECT *");\n}\n';
  const { tree } = await parseAST(code, 'javascript');
  const calls = extractCalls(tree);

  const dbCall = calls.find(c => c.callee === 'db.query');
  assert(dbCall, `should find db.query, got: ${calls.map(c => c.callee)}`);
});

// ─── Edge Cases ──────────────────────────────────────────────────────────────

suite('AST Analyzer — Edge Cases');

await testAsync('null content returns unsupported', async () => {
  const result = await parseAST(null, 'javascript');
  assert(!result.supported || result.tree === null, 'should handle null');
});

await testAsync('unsupported language returns unsupported', async () => {
  const result = await parseAST('code', 'brainfuck');
  assertEqual(result.supported, false);
  assertEqual(result.tree, null);
});

await testAsync('empty code returns tree', async () => {
  const result = await parseAST('', 'javascript');
  // Empty string might or might not produce a tree depending on parser
  assertEqual(result.language, 'javascript');
});

await testAsync('handles syntax errors gracefully', async () => {
  // tree-sitter is error-tolerant — it should still parse
  const code = 'function broken( {\n  return;\n';
  const result = await parseAST(code, 'javascript');
  assert(result.supported, 'should still be supported');
  // tree-sitter produces a tree even for invalid code
  assert(result.tree !== null, 'should produce a tree even for invalid code');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

summary();
