// tests/symbol-index.test.js — Symbol Index unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import { SymbolIndex } from '../src/code-intel/symbol-index.js';
import { collectCodeFiles, extractFileSymbols, findReferencesInFile } from '../src/code-intel/index-builder.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'si-test-'));
}

function writeFile(dir, name, content) {
  const filePath = path.join(dir, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return name;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ─── Index Builder Tests ─────────────────────────────────────────────────────

suite('Index Builder — File Collection');

await testAsync('collects code files', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/app.js', 'const x = 1;');
    writeFile(dir, 'src/helper.py', 'x = 1');
    writeFile(dir, 'README.md', '# Hello');

    const files = await collectCodeFiles(dir);
    assert(files.length >= 2, `should find code files, got ${files.length}`);
    assert(files.some(f => f.endsWith('app.js')), 'should include .js files');
    assert(files.some(f => f.endsWith('helper.py')), 'should include .py files');
  } finally { cleanup(dir); }
});

await testAsync('ignores node_modules', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/app.js', 'const x = 1;');
    writeFile(dir, 'node_modules/dep/index.js', 'const y = 2;');

    const files = await collectCodeFiles(dir);
    assert(!files.some(f => f.includes('node_modules')), 'should ignore node_modules');
  } finally { cleanup(dir); }
});

suite('Index Builder — Symbol Extraction');

await testAsync('extracts JS symbols', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'app.js', 'function validate(token) {\n  return token.length > 0;\n}\n\nclass AuthService {\n  login() {}\n}\n');

    const symbols = await extractFileSymbols(dir, 'app.js');
    assert(symbols.length >= 2, `should find symbols, got ${symbols.length}: ${symbols.map(s=>s.name)}`);
    assert(symbols.some(s => s.name === 'validate'), `should find validate, got: ${symbols.map(s=>s.name)}`);
    assert(symbols.some(s => s.name === 'AuthService'), `should find AuthService, got: ${symbols.map(s=>s.name)}`);
  } finally { cleanup(dir); }
});

await testAsync('extracts Python symbols', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'app.py', 'def calculate(x, y):\n    return x + y\n\nclass Config:\n    pass\n');

    const symbols = await extractFileSymbols(dir, 'app.py');
    assert(symbols.some(s => s.name === 'calculate'), `should find calculate, got: ${symbols.map(s=>s.name)}`);
    assert(symbols.some(s => s.name === 'Config'), `should find Config, got: ${symbols.map(s=>s.name)}`);
  } finally { cleanup(dir); }
});

suite('Index Builder — Reference Finding');

await testAsync('finds references in file', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'app.js', 'function validate(x) { return x; }\nconst r = validate(42);\nif (validate(0)) {}');

    const refs = await findReferencesInFile(dir, 'app.js', 'validate');
    assert(refs.length >= 3, `should find 3+ references, got ${refs.length}`);
  } finally { cleanup(dir); }
});

// ─── SymbolIndex Tests ───────────────────────────────────────────────────────

suite('Symbol Index — Build');

await testAsync('builds index from project', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/auth.js', 'function validateToken(t) { return t; }\nclass AuthService { login() {} }\n');
    writeFile(dir, 'src/db.js', 'function query(sql) { return sql; }\n');

    const index = new SymbolIndex();
    const stats = await index.buildIndex(dir);

    assert(stats.fileCount >= 2, `should index 2+ files, got ${stats.fileCount}`);
    assert(stats.symbolCount >= 3, `should find 3+ symbols, got ${stats.symbolCount}`);
    assert(stats.buildTime >= 0, 'should report build time');
  } finally { cleanup(dir); }
});

suite('Symbol Index — Lookup');

await testAsync('finds symbol by exact name', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/auth.js', 'function validateToken(t) { return t; }\n');

    const index = new SymbolIndex();
    await index.buildIndex(dir);

    const result = index.findSymbol('validateToken');
    assert(result !== null, 'should find symbol');
    assert(result.length >= 1, 'should have at least 1 definition');
    assertEqual(result[0].name, 'validateToken');
  } finally { cleanup(dir); }
});

await testAsync('returns null for unknown symbol', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/app.js', 'const x = 1;\n');

    const index = new SymbolIndex();
    await index.buildIndex(dir);

    const result = index.findSymbol('nonExistent');
    assertEqual(result, null);
  } finally { cleanup(dir); }
});

await testAsync('finds symbol by prefix', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/auth.js', 'function validateToken(t) {}\nfunction validateEmail(e) {}\nfunction processData() {}\n');

    const index = new SymbolIndex();
    await index.buildIndex(dir);

    const results = index.findByPrefix('validate');
    assert(results.length >= 2, `should find 2+ matches, got ${results.length}`);
    assert(results.every(r => r.name.startsWith('validate')), 'all should start with validate');
  } finally { cleanup(dir); }
});

await testAsync('fuzzy find matches substring', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/auth.js', 'function handleUserLogin() {}\nfunction handleAdminLogin() {}\n');

    const index = new SymbolIndex();
    await index.buildIndex(dir);

    const results = index.fuzzyFind('Login');
    assert(results.length >= 2, `should find 2+ matches, got ${results.length}`);
  } finally { cleanup(dir); }
});

suite('Symbol Index — File Symbols');

await testAsync('gets all symbols in a file', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/auth.js', 'function validate() {}\nclass Auth {}\nconst MAX = 100;\n');

    const index = new SymbolIndex();
    await index.buildIndex(dir);

    const symbols = index.getFileSymbols('src/auth.js');
    assert(symbols.length >= 2, `should find symbols, got ${symbols.length}`);
  } finally { cleanup(dir); }
});

suite('Symbol Index — References');

await testAsync('finds cross-file references', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/auth.js', 'function validate(x) { return x; }\n');
    writeFile(dir, 'src/handler.js', 'import { validate } from "./auth.js";\nconst r = validate(42);\n');

    const index = new SymbolIndex();
    await index.buildIndex(dir);

    const refs = await index.findReferences('validate');
    assert(refs.length >= 2, `should find references, got ${refs.length}`);
    assert(refs.some(r => r.file.includes('handler')), 'should find reference in handler.js');
  } finally { cleanup(dir); }
});

suite('Symbol Index — Reindex');

await testAsync('reindexes a single file', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/app.js', 'function oldFunc() {}\n');

    const index = new SymbolIndex();
    await index.buildIndex(dir);

    assert(index.findSymbol('oldFunc'), 'should find oldFunc before reindex');

    // Modify file
    writeFile(dir, 'src/app.js', 'function newFunc() {}\n');
    await index.reindexFile('src/app.js');

    assertEqual(index.findSymbol('oldFunc'), null, 'old symbol should be gone');
    assert(index.findSymbol('newFunc'), 'new symbol should exist');
  } finally { cleanup(dir); }
});

suite('Symbol Index — Stats');

await testAsync('reports accurate stats', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/a.js', 'function f1() {}\nfunction f2() {}\n');
    writeFile(dir, 'src/b.js', 'class C1 {}\n');

    const index = new SymbolIndex();
    await index.buildIndex(dir);

    const stats = index.getStats();
    assert(stats.fileCount >= 2, 'should count files');
    assert(stats.symbolCount >= 3, 'should count symbols');
    assert(stats.buildTime >= 0, 'should report build time');
    assertEqual(stats.building, false, 'should not be building');
  } finally { cleanup(dir); }
});

suite('Symbol Index — Edge Cases');

await testAsync('clear empties index', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/app.js', 'function test() {}\n');

    const index = new SymbolIndex();
    await index.buildIndex(dir);
    assert(index.symbolCount > 0, 'should have symbols before clear');

    index.clear();
    assertEqual(index.symbolCount, 0);
    assertEqual(index.fileCount, 0);
  } finally { cleanup(dir); }
});

await testAsync('empty project produces empty index', async () => {
  const dir = tmpDir();
  try {
    const index = new SymbolIndex();
    const stats = await index.buildIndex(dir);
    assertEqual(stats.fileCount, 0);
    assertEqual(stats.symbolCount, 0);
  } finally { cleanup(dir); }
});

// ─── Summary ─────────────────────────────────────────────────────────────────

summary();
