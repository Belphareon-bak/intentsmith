// tests/chunker.test.js — Code Chunker unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual, summary } from './harness.js';
import { chunkCode, chunkFixed } from '../src/code-intel/chunker.js';

suite('Chunker — JavaScript');

test('chunks JS file into functions', () => {
  const code = `import path from 'path';

const MAX = 100;

function validate(token) {
  if (!token) return false;
  return token.length > 0;
}

function process(data) {
  return data.map(x => x * 2);
}

class Service {
  constructor() {
    this.db = null;
  }

  start() {
    this.db = connect();
  }
}
`;

  const chunks = chunkCode(code, 'app.js');
  assert(chunks.length >= 2, `should produce 2+ chunks, got ${chunks.length}`);

  // Should find function chunks
  const funcChunks = chunks.filter(c => c.type === 'function');
  assert(funcChunks.length >= 2, `should find function chunks, got ${funcChunks.length}`);

  // Should have correct metadata
  const validateChunk = chunks.find(c => c.name === 'validate' || c.content.includes('validate'));
  assert(validateChunk, 'should find validate chunk');
  assertEqual(validateChunk.language, 'javascript');
  assert(validateChunk.startLine > 0, 'should have startLine');
});

test('chunks Python file into functions', () => {
  const code = `import os
from pathlib import Path

MAX_SIZE = 1024

def calculate(x, y):
    return x + y

def process(data):
    result = []
    for item in data:
        result.append(item * 2)
    return result

class Config:
    def __init__(self):
        self.host = "localhost"

    def validate(self):
        return bool(self.host)
`;

  const chunks = chunkCode(code, 'app.py');
  assert(chunks.length >= 2, `should produce chunks, got ${chunks.length}`);
});

test('includes top-level chunk', () => {
  const code = `import fs from 'fs';
import path from 'path';

const CONFIG = { timeout: 30 };

function main() {
  console.log("hello");
}
`;

  const chunks = chunkCode(code, 'app.js');
  const topLevel = chunks.find(c => c.type === 'block' || c.name === 'top-level');
  assert(topLevel, 'should have top-level block');
  assert(topLevel.content.includes('import') || topLevel.content.includes('CONFIG'),
    'top-level should contain imports or constants');
});

suite('Chunker — Fixed Window');

test('chunks by fixed window', () => {
  const lines = Array.from({ length: 100 }, (_, i) => `const line${i} = ${i};`);
  const code = lines.join('\n');

  const chunks = chunkFixed(code, 'big.js', 30, 5);
  assert(chunks.length >= 3, `should produce multiple chunks, got ${chunks.length}`);
  assertEqual(chunks[0].type, 'window');
  assert(chunks[0].startLine === 1, 'first chunk starts at line 1');
});

test('handles small file', () => {
  const code = 'const x = 1;\nconst y = 2;\nconst z = 3;\n';
  const chunks = chunkFixed(code, 'small.js', 60, 10);
  assertEqual(chunks.length, 1, 'should produce single chunk for small file');
});

suite('Chunker — Edge Cases');

test('empty content returns empty', () => {
  const chunks = chunkCode('', 'app.js');
  assertEqual(chunks.length, 0);
});

test('null content returns empty', () => {
  const chunks = chunkCode(null, 'app.js');
  assertEqual(chunks.length, 0);
});

test('null path returns empty', () => {
  const chunks = chunkCode('const x = 1;', null);
  assertEqual(chunks.length, 0);
});

suite('Chunker — Chunk Properties');

test('all chunks have required fields', () => {
  const code = 'function f() { return 1; }\nfunction g() { return 2; }\n';
  const chunks = chunkCode(code, 'test.js');

  for (const chunk of chunks) {
    assert(chunk.content, 'should have content');
    assert(chunk.file, 'should have file');
    assert(chunk.type, 'should have type');
    assert(chunk.name, 'should have name');
    assert(chunk.startLine > 0, 'should have startLine');
    assert(chunk.language, 'should have language');
  }
});

summary();
