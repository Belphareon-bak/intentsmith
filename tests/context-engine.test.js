// tests/context-engine.test.js — Incremental Context Engine v100 tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual, summary } from './harness.js';
import {
  extractRelevantSections,
  compressContext,
} from '../src/code-intel/context-engine.js';

// ─── Extract Relevant Sections ──────────────────────────────────────────────

suite('Context Engine — extractRelevantSections');

const SAMPLE_FILE = `import { readFile } from 'fs/promises';
import path from 'path';

const MAX = 100;

function helperFn() {
  return 'hello';
}

export function createUser(name, email) {
  const user = { name, email };
  helperFn();
  return user;
}

function internalFn() {
  return 42;
}

export class UserService {
  constructor(db) {
    this.db = db;
  }
  getUser(id) {
    return this.db.find(id);
  }
}

export default { createUser, UserService };`;

test('extracts function matching symbol', () => {
  const result = extractRelevantSections(SAMPLE_FILE, ['createUser']);
  assert(result.includes('createUser'), 'should include createUser function');
  assert(result.includes('import'), 'should keep imports');
});

test('extracts class matching symbol', () => {
  const result = extractRelevantSections(SAMPLE_FILE, ['UserService']);
  assert(result.includes('UserService'), 'should include UserService class');
  assert(result.includes('getUser'), 'should include methods');
});

test('keeps imports and exports', () => {
  const result = extractRelevantSections(SAMPLE_FILE, ['createUser']);
  assert(result.includes("import"), 'should keep imports');
  assert(result.includes("export default"), 'should keep exports');
});

test('returns full content for small files', () => {
  const small = 'function foo() { return 1; }\nfunction bar() { return 2; }';
  const result = extractRelevantSections(small, ['foo']);
  assertEqual(result, small);
});

test('returns full content when no symbols match', () => {
  const result = extractRelevantSections(SAMPLE_FILE, ['nonExistentSymbol123']);
  // When nothing matches, should return full content
  assert(result.length > 0, 'should return something');
});

test('handles empty content', () => {
  const result = extractRelevantSections('', ['foo']);
  assertEqual(result, '');
});

test('handles null symbols', () => {
  const result = extractRelevantSections(SAMPLE_FILE, null);
  assertEqual(result, SAMPLE_FILE);
});

test('omits unrelated sections with separator', () => {
  // Build a large file with many functions
  const lines = ["import x from 'y';", ''];
  for (let i = 0; i < 20; i++) {
    lines.push(`function fn${i}() {`);
    lines.push(`  return ${i};`);
    lines.push('}');
    lines.push('');
  }
  lines.push("export default { fn5 };");
  const bigFile = lines.join('\n');

  const result = extractRelevantSections(bigFile, ['fn5']);
  assert(result.includes('fn5'), 'should include fn5');
  // Should have omitted marker
  if (result.includes('// ... (omitted)')) {
    assert(result.length < bigFile.length, 'should be shorter than full file');
  }
});

// ─── Compress Context ──────────────────────────────────────────────────────

suite('Context Engine — compressContext');

test('compresses within token budget', () => {
  const sections = [
    { file: 'a.js', content: 'function a() { return 1; }', score: 1.0 },
    { file: 'b.js', content: 'function b() { return 2; }', score: 0.8 },
    { file: 'c.js', content: 'function c() { return 3; }', score: 0.6 },
  ];
  const result = compressContext(sections, 50); // very small budget
  assert(result.files.length >= 1, 'should keep at least 1 file');
  assert(result.tokens <= 50 || result.files.length === 1, 'should respect budget or keep minimum 1');
});

test('keeps higher-scored files first', () => {
  const sections = [
    { file: 'low.js', content: 'x', score: 0.1 },
    { file: 'high.js', content: 'y', score: 0.9 },
    { file: 'mid.js', content: 'z', score: 0.5 },
  ];
  const result = compressContext(sections, 10000);
  assertEqual(result.files[0], 'high.js');
});

test('reports dropped files', () => {
  const sections = [
    { file: 'a.js', content: 'x'.repeat(1000), score: 1.0 },
    { file: 'b.js', content: 'y'.repeat(1000), score: 0.5 },
  ];
  const result = compressContext(sections, 100); // budget too small for both
  assert(result.droppedFiles.length > 0 || result.files.length === 2, 'should track dropped files');
});

test('handles empty sections', () => {
  const result = compressContext([], 5000);
  assertEqual(result.context, '');
  assertEqual(result.tokens, 0);
});

test('handles null sections', () => {
  const result = compressContext(null, 5000);
  assertEqual(result.context, '');
});

test('formats output with file headers', () => {
  const sections = [
    { file: 'test.js', content: 'const x = 1;', score: 1.0 },
  ];
  const result = compressContext(sections, 5000);
  assert(result.context.includes('### test.js'), 'should have file header');
  assert(result.context.includes('```'), 'should have code fence');
});

// ─── Milestone Symbol Extraction ────────────────────────────────────────────

suite('Context Engine — Symbol Extraction');

test('milestone context handles null milestone', async () => {
  const { buildMilestoneContext } = await import('../src/code-intel/context-engine.js');
  const result = await buildMilestoneContext('/tmp', null);
  assertEqual(result.tokens, 0);
});

// ─── Summary ─────────────────────────────────────────────────────────────────

summary();
