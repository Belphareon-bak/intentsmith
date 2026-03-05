// tests/context-builder.test.js — Context Builder unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import { buildCodeContext, estimateTokens, extractImports } from '../src/code-intel/context-builder.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-'));
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

suite('Context Builder — Token Estimation');

test('estimates tokens for text', () => {
  const tokens = estimateTokens('hello world');
  assert(tokens > 0, 'should return positive token count');
  assertEqual(tokens, Math.ceil('hello world'.length / 4));
});

test('empty text returns 0', () => {
  assertEqual(estimateTokens(''), 0);
  assertEqual(estimateTokens(null), 0);
});

suite('Context Builder — Import Extraction');

test('extracts JS ESM imports', () => {
  const content = `import { foo } from './bar.js';\nimport path from 'path';\n`;
  const imports = extractImports(content, 'javascript');
  assert(imports.includes('./bar.js'), `should find ./bar.js, got: ${imports}`);
  assert(imports.includes('path'), `should find path, got: ${imports}`);
});

test('extracts JS require', () => {
  const content = `const fs = require('fs');\nconst { join } = require('path');\n`;
  const imports = extractImports(content, 'javascript');
  assert(imports.includes('fs'), `should find fs, got: ${imports}`);
  assert(imports.includes('path'), `should find path, got: ${imports}`);
});

test('extracts Python imports', () => {
  const content = `import os\nfrom pathlib import Path\nimport json\n`;
  const imports = extractImports(content, 'python');
  assert(imports.includes('os'), `should find os, got: ${imports}`);
  assert(imports.includes('pathlib'), `should find pathlib, got: ${imports}`);
});

test('extracts Go imports', () => {
  const content = `package main\n\nimport (\n\t"fmt"\n\t"net/http"\n)\n`;
  const imports = extractImports(content, 'go');
  assert(imports.includes('fmt') || imports.includes('net/http'), `should find imports, got: ${imports}`);
});

test('extracts Java imports', () => {
  const content = `import java.util.List;\nimport com.example.Service;\n`;
  const imports = extractImports(content, 'java');
  assert(imports.includes('java.util.List'), `should find java.util.List, got: ${imports}`);
});

test('deduplicates imports', () => {
  const content = `import os\nimport os\n`;
  const imports = extractImports(content, 'python');
  assertEqual(imports.length, 1, 'should deduplicate');
});

suite('Context Builder — buildCodeContext');

await testAsync('builds context from ranked files', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/app.js', 'import { helper } from "./helper.js";\n\nconst app = () => {\n  return helper();\n};\n');
    writeFile(dir, 'src/helper.js', 'export function helper() {\n  return 42;\n}\n');

    const rankedFiles = [
      { file: 'src/app.js', score: 1.0 },
      { file: 'src/helper.js', score: 0.8 },
    ];

    const result = await buildCodeContext(dir, rankedFiles, {
      queryTerms: ['helper'],
    });

    assert(result.context.length > 0, 'should produce context');
    assert(result.files.length === 2, `should include 2 files, got ${result.files.length}`);
    assert(result.totalTokens > 0, 'should estimate tokens');
    assert(result.context.includes('app.js'), 'context should reference app.js');
    assert(result.context.includes('helper.js'), 'context should reference helper.js');
  } finally { cleanup(dir); }
});

await testAsync('respects token budget', async () => {
  const dir = tmpDir();
  try {
    // Create 10 large files
    for (let i = 0; i < 10; i++) {
      const lines = Array.from({ length: 200 }, (_, j) => `const line${j} = ${j};`).join('\n');
      writeFile(dir, `src/file${i}.js`, lines);
    }

    const rankedFiles = Array.from({ length: 10 }, (_, i) => ({
      file: `src/file${i}.js`,
      score: 1 - i * 0.1,
    }));

    const result = await buildCodeContext(dir, rankedFiles, {
      maxTokens: 1000,
    });

    assert(result.totalTokens <= 1200, `should respect budget (±buffer), got ${result.totalTokens} tokens`);
    assert(result.files.length < 10, `should not include all files, included ${result.files.length}`);
  } finally { cleanup(dir); }
});

await testAsync('smart truncation keeps header + matches', async () => {
  const dir = tmpDir();
  try {
    const lines = [];
    lines.push('import { something } from "./dep.js";');
    lines.push('');
    for (let i = 2; i < 300; i++) {
      if (i === 150) {
        lines.push('const IMPORTANT_BUG = "found here";');
      } else {
        lines.push(`const line${i} = ${i};`);
      }
    }
    writeFile(dir, 'big.js', lines.join('\n'));

    const rankedFiles = [{ file: 'big.js', score: 1.0 }];
    const result = await buildCodeContext(dir, rankedFiles, {
      maxLinesPerFile: 50,
      queryTerms: ['IMPORTANT_BUG'],
    });

    assert(result.context.includes('import'), 'should keep header (imports)');
    assert(result.context.includes('IMPORTANT_BUG'), 'should keep matched line');
    assert(result.context.includes('truncated'), 'should have truncation markers');
  } finally { cleanup(dir); }
});

await testAsync('deduplicates files', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/app.js', 'const x = 1;\n');

    const rankedFiles = [
      { file: 'src/app.js', score: 1.0 },
      { file: 'src/app.js', score: 0.9 }, // duplicate
    ];

    const result = await buildCodeContext(dir, rankedFiles);
    assertEqual(result.files.length, 1, 'should deduplicate');
  } finally { cleanup(dir); }
});

await testAsync('skips unreadable files', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/good.js', 'const x = 1;\n');

    const rankedFiles = [
      { file: 'src/nonexistent.js', score: 1.0 },
      { file: 'src/good.js', score: 0.5 },
    ];

    const result = await buildCodeContext(dir, rankedFiles);
    assertEqual(result.files.length, 1, 'should skip nonexistent file');
    assertEqual(result.files[0].path, 'src/good.js');
  } finally { cleanup(dir); }
});

await testAsync('empty ranked files returns empty context', async () => {
  const dir = tmpDir();
  try {
    const result = await buildCodeContext(dir, []);
    assertEqual(result.files.length, 0);
    assertEqual(result.totalTokens, 0);
    assertEqual(result.context, '');
  } finally { cleanup(dir); }
});

suite('Context Builder — Language Detection');

await testAsync('detects language from extension', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'app.py', 'x = 1\n');
    const result = await buildCodeContext(dir, [{ file: 'app.py', score: 1.0 }]);
    assertEqual(result.files[0].language, 'python');
  } finally { cleanup(dir); }
});

await testAsync('includes code fences with language', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'app.go', 'package main\n\nfunc main() {}\n');
    const result = await buildCodeContext(dir, [{ file: 'app.go', score: 1.0 }]);
    assert(result.context.includes('```go'), 'should have ```go fence');
  } finally { cleanup(dir); }
});

// ─── Summary ─────────────────────────────────────────────────────────────────

summary();
