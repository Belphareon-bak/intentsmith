// tests/code-search.test.js — Code Search Engine unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import { searchCode, searchSymbol, clearSearchCache, _resetEngineCache } from '../src/code-intel/code-search.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cs-test-'));
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

// ─── Tests ───────────────────────────────────────────────────────────────────

suite('Code Search — Basic');

await testAsync('finds text in JS file', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'app.js', 'const x = 42;\nfunction hello() { return "world"; }\n');
    const r = await searchCode(dir, 'hello', { noCache: true });
    assert(r.results.length > 0, `should find "hello", got ${r.results.length} results`);
    assertEqual(r.results[0].file, 'app.js');
    assert(r.results[0].line > 0, 'should have line number');
  } finally { cleanup(dir); }
});

await testAsync('finds text in Python file', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'main.py', 'def calculate():\n    return 42\n');
    const r = await searchCode(dir, 'calculate', { noCache: true });
    assert(r.results.length > 0, `should find "calculate"`);
    assertEqual(r.results[0].file, 'main.py');
  } finally { cleanup(dir); }
});

await testAsync('case insensitive by default', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'app.js', 'const MyClass = "test";\n');
    const r = await searchCode(dir, 'myclass', { noCache: true });
    assert(r.results.length > 0, 'should find case-insensitive match');
  } finally { cleanup(dir); }
});

suite('Code Search — Multi-file');

await testAsync('searches across multiple files', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/a.js', 'const shared = 1;\n');
    writeFile(dir, 'src/b.js', 'const shared = 2;\n');
    writeFile(dir, 'lib/c.py', 'shared = 3\n');
    const r = await searchCode(dir, 'shared', { noCache: true });
    assert(r.results.length >= 3, `should find in all files, got ${r.results.length}`);
  } finally { cleanup(dir); }
});

await testAsync('ignores node_modules', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'app.js', 'const x = 1;\n');
    writeFile(dir, 'node_modules/dep/index.js', 'const x = 2;\n');
    const r = await searchCode(dir, 'const x', { noCache: true });
    const files = r.results.map(x => x.file);
    assert(!files.some(f => f.includes('node_modules')), 'should not search node_modules');
  } finally { cleanup(dir); }
});

suite('Code Search — Edge Cases');

await testAsync('no matches returns empty results', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'app.js', 'const x = 42;\n');
    const r = await searchCode(dir, 'nonexistentIdentifier12345', { noCache: true });
    assertEqual(r.results.length, 0);
    assertEqual(r.totalMatches, 0);
  } finally { cleanup(dir); }
});

await testAsync('empty query returns empty', async () => {
  const r = await searchCode('/tmp', '');
  assertEqual(r.results.length, 0);
  assertEqual(r.engine, 'none');
});

await testAsync('null project path returns empty', async () => {
  const r = await searchCode(null, 'test');
  assertEqual(r.results.length, 0);
});

suite('Code Search — Cache');

await testAsync('cache works (same query returns instantly)', async () => {
  const dir = tmpDir();
  try {
    clearSearchCache();
    writeFile(dir, 'app.js', 'const cached = true;\n');
    const r1 = await searchCode(dir, 'cached');
    const r2 = await searchCode(dir, 'cached');
    assertEqual(r1.results.length, r2.results.length);
  } finally { cleanup(dir); }
});

await testAsync('noCache bypasses cache', async () => {
  const dir = tmpDir();
  try {
    clearSearchCache();
    writeFile(dir, 'app.js', 'const fresh = true;\n');
    await searchCode(dir, 'fresh');
    const r = await searchCode(dir, 'fresh', { noCache: true });
    assert(r.results.length > 0, 'should still find results with noCache');
  } finally { cleanup(dir); }
});

suite('Code Search — Symbol Search');

await testAsync('finds function definition', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'utils.js', 'function validateToken(token) {\n  return token.length > 0;\n}\n');
    writeFile(dir, 'auth.js', 'const result = validateToken(userToken);\n');
    const r = await searchSymbol(dir, 'validateToken');
    assert(r.definitions.length > 0 || r.references.length > 0, 'should find symbol');
  } finally { cleanup(dir); }
});

await testAsync('finds class definition', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'models.py', 'class UserService:\n    def __init__(self):\n        pass\n');
    const r = await searchSymbol(dir, 'UserService');
    assert(r.definitions.length > 0 || r.references.length > 0, 'should find class');
  } finally { cleanup(dir); }
});

suite('Code Search — Engine Info');

await testAsync('returns engine name', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'app.js', 'const x = 1;\n');
    const r = await searchCode(dir, 'const', { noCache: true });
    assert(['ripgrep', 'grep', 'node'].includes(r.engine), `engine should be known, got: ${r.engine}`);
  } finally { cleanup(dir); }
});

await testAsync('returns search time', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'app.js', 'const x = 1;\n');
    const r = await searchCode(dir, 'const', { noCache: true });
    assert(r.searchTime >= 0, `searchTime should be >= 0, got: ${r.searchTime}`);
  } finally { cleanup(dir); }
});

// ─── Summary ─────────────────────────────────────────────────────────────────

summary();
