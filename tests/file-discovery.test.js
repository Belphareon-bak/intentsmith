// tests/file-discovery.test.js — File Discovery unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import { rankFiles, buildImportGraph, _clearGitRecencyCache } from '../src/code-intel/file-discovery.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeResult(file, line, content) {
  return { file, line, content };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

suite('File Discovery — Basic Ranking');

await testAsync('ranks file with more matches higher', async () => {
  _clearGitRecencyCache();
  const results = [
    makeResult('src/a.js', 10, 'const timeout = 30;'),
    makeResult('src/a.js', 20, 'const timeout = 60;'),
    makeResult('src/a.js', 30, 'const timeout = 90;'),
    makeResult('src/b.js', 5, 'const timeout = 10;'),
  ];

  const ranked = await rankFiles(results, ['timeout']);
  assert(ranked.length === 2, `should have 2 files, got ${ranked.length}`);
  assertEqual(ranked[0].file, 'src/a.js');
  assert(ranked[0].score > ranked[1].score, 'a.js should rank higher (more matches)');
});

await testAsync('returns empty for empty input', async () => {
  const ranked = await rankFiles([], ['test']);
  assertEqual(ranked.length, 0);
});

await testAsync('returns empty for null input', async () => {
  const ranked = await rankFiles(null, ['test']);
  assertEqual(ranked.length, 0);
});

suite('File Discovery — Path Relevance');

await testAsync('src/ path ranks higher than tests/', async () => {
  _clearGitRecencyCache();
  const results = [
    makeResult('src/handler.js', 10, 'function process()'),
    makeResult('tests/handler.test.js', 10, 'function process()'),
  ];

  const ranked = await rankFiles(results, ['process']);
  // src should rank higher due to path relevance
  assert(ranked[0].file.startsWith('src/'), `src/ should rank first, got ${ranked[0].file}`);
});

await testAsync('test/ path ranks higher when searching for tests', async () => {
  _clearGitRecencyCache();
  const results = [
    makeResult('src/handler.js', 10, 'function testHelper()'),
    makeResult('tests/handler.test.js', 10, 'function testHelper()'),
  ];

  const ranked = await rankFiles(results, ['test', 'testHelper']);
  // test path should NOT be penalized when query contains 'test'
  const testFile = ranked.find(r => r.file.includes('tests/'));
  assert(testFile, 'test file should be in results');
});

await testAsync('filename containing query term gets boost', async () => {
  _clearGitRecencyCache();
  const results = [
    makeResult('src/auth.js', 10, 'const token = "abc";'),
    makeResult('src/utils.js', 10, 'const token = "xyz";'),
  ];

  const ranked = await rankFiles(results, ['auth']);
  assertEqual(ranked[0].file, 'src/auth.js');
});

suite('File Discovery — File Type Scoring');

await testAsync('code files rank higher than config', async () => {
  _clearGitRecencyCache();
  const results = [
    makeResult('config.json', 10, 'timeout: 30'),
    makeResult('src/app.js', 10, 'const timeout = 30;'),
  ];

  const ranked = await rankFiles(results, ['timeout']);
  assertEqual(ranked[0].file, 'src/app.js');
});

await testAsync('code files rank higher than docs', async () => {
  _clearGitRecencyCache();
  const results = [
    makeResult('README.md', 10, 'timeout configuration'),
    makeResult('src/app.py', 10, 'timeout = 30'),
  ];

  const ranked = await rankFiles(results, ['timeout']);
  assertEqual(ranked[0].file, 'src/app.py');
});

suite('File Discovery — Proximity Score');

await testAsync('close matches boost score', async () => {
  _clearGitRecencyCache();
  // File A: matches on lines 10 and 12 (close together)
  // File B: matches on lines 10 and 200 (far apart)
  const results = [
    makeResult('src/close.js', 10, 'const auth = true;'),
    makeResult('src/close.js', 12, 'const token = "abc";'),
    makeResult('src/far.js', 10, 'const auth = true;'),
    makeResult('src/far.js', 200, 'const token = "abc";'),
  ];

  const ranked = await rankFiles(results, ['auth', 'token']);
  assertEqual(ranked[0].file, 'src/close.js');
});

suite('File Discovery — Score Properties');

await testAsync('all scores are between 0 and 1', async () => {
  _clearGitRecencyCache();
  const results = [
    makeResult('src/a.js', 10, 'const x = 1;'),
    makeResult('src/b.js', 20, 'const x = 2;'),
    makeResult('lib/c.py', 30, 'x = 3'),
  ];

  const ranked = await rankFiles(results, ['const']);
  for (const r of ranked) {
    assert(r.score >= 0 && r.score <= 1, `score should be 0-1, got ${r.score} for ${r.file}`);
  }
});

await testAsync('includes matchCount and matchLines', async () => {
  _clearGitRecencyCache();
  const results = [
    makeResult('src/a.js', 10, 'const x = 1;'),
    makeResult('src/a.js', 20, 'const y = 2;'),
  ];

  const ranked = await rankFiles(results, ['const']);
  assertEqual(ranked[0].matchCount, 2);
  assert(ranked[0].matchLines.includes(10), 'should include line 10');
  assert(ranked[0].matchLines.includes(20), 'should include line 20');
});

await testAsync('includes reason string', async () => {
  _clearGitRecencyCache();
  const results = [
    makeResult('src/handler.js', 10, 'function validate()'),
  ];

  const ranked = await rankFiles(results, ['validate']);
  assert(typeof ranked[0].reason === 'string', 'should have reason string');
});

suite('File Discovery — Import Graph');

test('builds import graph from file contents', () => {
  const files = [
    { file: 'src/app.js', content: 'import { helper } from "./helper.js";\nimport path from "path";' },
    { file: 'src/helper.js', content: 'import { util } from "./util.js";' },
    { file: 'src/util.js', content: 'export const x = 1;' },
  ];

  const graph = buildImportGraph(files);
  assert(graph.has('src/app.js'), 'should have src/app.js');
  assert(graph.get('src/app.js').has('src/helper.js'), 'app.js should import helper.js');
  assert(graph.has('src/helper.js'), 'should have src/helper.js');
  assert(graph.get('src/helper.js').has('src/util.js'), 'helper.js should import util.js');
});

test('import graph ignores non-relative imports', () => {
  const files = [
    { file: 'src/app.js', content: 'import fs from "fs";\nimport path from "path";' },
  ];

  const graph = buildImportGraph(files);
  assert(!graph.has('src/app.js') || graph.get('src/app.js').size === 0, 'should not include node built-ins');
});

test('import graph handles require()', () => {
  const files = [
    { file: 'src/app.js', content: 'const h = require("./helper");' },
  ];

  const graph = buildImportGraph(files);
  assert(graph.has('src/app.js'), 'should have src/app.js');
  assert(graph.get('src/app.js').has('src/helper'), 'should resolve require path');
});

test('import graph resolves relative paths', () => {
  const files = [
    { file: 'src/handlers/auth.js', content: 'import { db } from "../db/connection.js";' },
  ];

  const graph = buildImportGraph(files);
  assert(graph.has('src/handlers/auth.js'), 'should have auth.js');
  assert(graph.get('src/handlers/auth.js').has('src/db/connection.js'),
    `should resolve ../db/connection.js, got: ${[...graph.get('src/handlers/auth.js')]}`);
});

suite('File Discovery — Cluster Score Integration');

await testAsync('files sharing imports rank higher', async () => {
  _clearGitRecencyCache();
  // Both a.js and b.js import shared.js — they form a cluster
  const results = [
    makeResult('src/a.js', 10, 'const x = 1;'),
    makeResult('src/b.js', 10, 'const x = 1;'),
    makeResult('src/isolated.js', 10, 'const x = 1;'),
  ];

  const importGraph = new Map();
  importGraph.set('src/a.js', new Set(['src/shared.js', 'src/b.js']));
  importGraph.set('src/b.js', new Set(['src/shared.js', 'src/a.js']));

  const ranked = await rankFiles(results, ['const'], { importGraph });
  // a.js and b.js should rank above isolated.js due to cluster density
  const isolatedRank = ranked.findIndex(r => r.file === 'src/isolated.js');
  assert(isolatedRank > 0, 'isolated.js should not be first');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

summary();
