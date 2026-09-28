// tests/semantic-index.test.js — Semantic Index unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import { SemanticIndex, TFIDFVectorizer, cosineSimilarity, tokenize } from '../src/code-intel/semantic-index.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sem-test-'));
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

// ─── TF-IDF Tests ────────────────────────────────────────────────────────────

suite('Semantic Index — Tokenizer');

test('tokenizes camelCase', () => {
  const tokens = tokenize('forwardingAddress');
  assert(tokens.includes('forwarding'), `should split camelCase, got: ${tokens}`);
  assert(tokens.includes('address'), `should split camelCase, got: ${tokens}`);
});

test('tokenizes snake_case', () => {
  const tokens = tokenize('max_retry_count');
  assert(tokens.includes('max'), `should split snake_case, got: ${tokens}`);
  assert(tokens.includes('retry'), `should split snake_case, got: ${tokens}`);
});

test('filters short tokens', () => {
  const tokens = tokenize('a b cd efg');
  assert(!tokens.includes('a'), 'should filter single char');
  assert(!tokens.includes('b'), 'should filter single char');
  assert(tokens.includes('cd'), 'should keep 2+ chars');
});

suite('Semantic Index — TF-IDF Vectorizer');

test('fit builds vocabulary', () => {
  const v = new TFIDFVectorizer();
  v.fit(['hello world', 'hello code', 'test world']);
  assert(v.vocabSize > 0, `should have vocab, got ${v.vocabSize}`);
  assert(v.vocabulary.has('hello'), 'should have hello in vocab');
  assert(v.vocabulary.has('world'), 'should have world in vocab');
});

test('transform produces vector', () => {
  const v = new TFIDFVectorizer();
  v.fit(['hello world', 'hello code']);
  const vec = v.transform('hello world');
  assert(vec instanceof Float32Array, 'should return Float32Array');
  assertEqual(vec.length, v.vocabSize);
});

test('similar documents have higher similarity', () => {
  const v = new TFIDFVectorizer();
  v.fit([
    'function validate token auth',
    'function process data transform',
    'validate user authentication token',
  ]);

  const q = v.transform('validate token');
  const v1 = v.transform('function validate token auth');
  const v2 = v.transform('function process data transform');

  const sim1 = cosineSimilarity(q, v1);
  const sim2 = cosineSimilarity(q, v2);

  assert(sim1 > sim2, `similar doc should score higher: ${sim1} vs ${sim2}`);
});

suite('Semantic Index — Cosine Similarity');

test('identical vectors have similarity 1', () => {
  const a = new Float32Array([1, 0, 1]);
  const sim = cosineSimilarity(a, a);
  assert(Math.abs(sim - 1) < 0.001, `should be ~1, got ${sim}`);
});

test('orthogonal vectors have similarity 0', () => {
  const a = new Float32Array([1, 0, 0]);
  const b = new Float32Array([0, 1, 0]);
  const sim = cosineSimilarity(a, b);
  assert(Math.abs(sim) < 0.001, `should be ~0, got ${sim}`);
});

test('empty vectors return 0', () => {
  const a = new Float32Array([0, 0, 0]);
  const b = new Float32Array([0, 0, 0]);
  assertEqual(cosineSimilarity(a, b), 0);
});

// ─── Full Index Tests ────────────────────────────────────────────────────────

suite('Semantic Index — Build & Search (TF-IDF)');

await testAsync('builds index from project', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/auth.js', 'function validateToken(token) {\n  if (!token) return false;\n  return token.length > 0;\n}\n');
    writeFile(dir, 'src/db.js', 'function executeQuery(sql) {\n  return database.run(sql);\n}\n');
    writeFile(dir, 'src/handler.js', 'function handleRequest(req, res) {\n  const token = req.headers.auth;\n  if (validateToken(token)) {\n    res.send("ok");\n  }\n}\n');

    const index = new SemanticIndex();
    const stats = await index.buildIndex(dir, { forceLocal: true });

    assert(stats.chunkCount > 0, `should have chunks, got ${stats.chunkCount}`);
    assertEqual(stats.engine, 'tfidf');
    assert(stats.buildTime >= 0, 'should report build time');
  } finally { cleanup(dir); }
});

await testAsync('semantic search finds relevant chunks', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/auth.js', 'function validateToken(token) {\n  if (!token) return false;\n  return token.length > 0;\n}\n\nfunction checkPermission(user, action) {\n  return user.permissions.includes(action);\n}\n');
    writeFile(dir, 'src/math.js', 'function calculate(x, y) {\n  return x + y;\n}\n\nfunction multiply(a, b) {\n  return a * b;\n}\n');

    const index = new SemanticIndex();
    await index.buildIndex(dir, { forceLocal: true });

    const results = await index.semanticSearch('authentication token validation');
    assert(results.length > 0, `should find results, got ${results.length}`);

    // Auth-related chunk should rank higher than math
    const authResult = results.find(r => r.chunk.file.includes('auth'));
    const mathResult = results.find(r => r.chunk.file.includes('math'));

    if (authResult && mathResult) {
      assert(authResult.score > mathResult.score,
        `auth should score higher than math: ${authResult.score} vs ${mathResult.score}`);
    }
  } finally { cleanup(dir); }
});

await testAsync('search returns scores between 0 and 1', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/app.js', 'function handler() {\n  return "hello";\n}\n');

    const index = new SemanticIndex();
    await index.buildIndex(dir, { forceLocal: true });

    const results = await index.semanticSearch('handler');
    for (const r of results) {
      assert(r.score >= 0 && r.score <= 1, `score should be 0-1, got ${r.score}`);
    }
  } finally { cleanup(dir); }
});

suite('Semantic Index — Stats');

await testAsync('reports stats', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/app.js', 'function test(x) {\n  const result = x * 2;\n  return result;\n}\n\nfunction validate(t) {\n  if (!t) return false;\n  return t.length > 0;\n}\n');

    const index = new SemanticIndex();
    await index.buildIndex(dir, { forceLocal: true });

    const stats = index.getStats();
    assert(stats.chunkCount > 0, `should have chunks, got ${stats.chunkCount}`);
    assertEqual(stats.engine, 'tfidf');
    assert(stats.vocabSize > 0, 'should have vocab');
    assertEqual(stats.building, false);
  } finally { cleanup(dir); }
});

suite('Semantic Index — Edge Cases');

await testAsync('empty project produces empty index', async () => {
  const dir = tmpDir();
  try {
    const index = new SemanticIndex();
    const stats = await index.buildIndex(dir, { forceLocal: true });
    assertEqual(stats.chunkCount, 0);
  } finally { cleanup(dir); }
});

await testAsync('search on empty index returns empty', async () => {
  const index = new SemanticIndex();
  const results = await index.semanticSearch('test');
  assertEqual(results.length, 0);
});

await testAsync('clear resets index', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/app.js', 'function test(x) {\n  const result = x * 2;\n  return result;\n}\n\nfunction other(y) {\n  return y + 1;\n}\n');

    const index = new SemanticIndex();
    await index.buildIndex(dir, { forceLocal: true });
    assert(index.getStats().chunkCount > 0, 'should have data before clear');

    index.clear();
    assertEqual(index.getStats().chunkCount, 0);
  } finally { cleanup(dir); }
});

// ─── Summary ─────────────────────────────────────────────────────────────────

summary();
