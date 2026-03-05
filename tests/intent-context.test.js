// tests/intent-context.test.js — Intent-aware context builder tests
// ==============================================================================

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import { buildIntentAwareContext, CONTEXT_STRATEGIES } from '../src/code-intel/context-builder.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'intent-ctx-'));
}

function writeFile(dir, name, content) {
  const filePath = path.join(dir, name);
  const fileDir = path.dirname(filePath);
  if (!fs.existsSync(fileDir)) {
    fs.mkdirSync(fileDir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ==============================================================================
suite('CONTEXT_STRATEGIES — shape and values');
// ==============================================================================

test('all 6 strategies exist', () => {
  const expected = ['debug', 'refactor', 'architecture', 'understand', 'review', 'general'];
  for (const key of expected) {
    assert(CONTEXT_STRATEGIES[key] != null, `Missing strategy: ${key}`);
  }
  assertEqual(Object.keys(CONTEXT_STRATEGIES).length, 6, 'Should have exactly 6 strategies');
});

test('debug strategy has expanded context', () => {
  assert(
    CONTEXT_STRATEGIES.debug.maxLinesPerFile > CONTEXT_STRATEGIES.general.maxLinesPerFile,
    `debug.maxLinesPerFile (${CONTEXT_STRATEGIES.debug.maxLinesPerFile}) should be > general (${CONTEXT_STRATEGIES.general.maxLinesPerFile})`
  );
});

test('architecture strategy has more files, less lines', () => {
  assert(
    CONTEXT_STRATEGIES.architecture.maxFiles > CONTEXT_STRATEGIES.general.maxFiles,
    `architecture.maxFiles (${CONTEXT_STRATEGIES.architecture.maxFiles}) should be > general (${CONTEXT_STRATEGIES.general.maxFiles})`
  );
  assert(
    CONTEXT_STRATEGIES.architecture.maxLinesPerFile < CONTEXT_STRATEGIES.general.maxLinesPerFile,
    `architecture.maxLinesPerFile (${CONTEXT_STRATEGIES.architecture.maxLinesPerFile}) should be < general (${CONTEXT_STRATEGIES.general.maxLinesPerFile})`
  );
});

// ==============================================================================
suite('buildIntentAwareContext — basic behavior');
// ==============================================================================

await testAsync('returns strategy name for debug', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'app.js', 'const x = 1;\nconsole.log(x);\n');
    const result = await buildIntentAwareContext(dir, [{ file: 'app.js', score: 1 }], { intent: 'debug' });
    assertEqual(result.strategy, 'debug', 'Strategy should be debug');
  } finally {
    cleanup(dir);
  }
});

await testAsync('falls back to general for unknown intent', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'app.js', 'const x = 1;\n');
    const result = await buildIntentAwareContext(dir, [{ file: 'app.js', score: 1 }], { intent: 'unknown' });
    assertEqual(result.strategy, 'general', 'Should fall back to general');
  } finally {
    cleanup(dir);
  }
});

await testAsync('debug context reads more content than architecture', async () => {
  const dir = tmpDir();
  try {
    // Create multiple files sized between architecture.maxLinesPerFile (80) and
    // debug.maxLinesPerFile (250) so truncation differs between strategies.
    // Files with 150 lines: debug keeps all (150 < 250), architecture truncates (150 > 80).
    for (let f = 0; f < 3; f++) {
      const lines = [];
      for (let i = 0; i < 150; i++) {
        lines.push(`function fn_${f}_${i}(x) { return x + ${i}; }`);
      }
      writeFile(dir, `mod${f}.js`, lines.join('\n'));
    }
    const ranked = [0, 1, 2].map(i => ({ file: `mod${i}.js`, score: 3 - i }));

    const debugResult = await buildIntentAwareContext(dir, ranked, { intent: 'debug' });
    const archResult = await buildIntentAwareContext(dir, ranked, { intent: 'architecture' });

    assert(
      debugResult.totalTokens > archResult.totalTokens,
      `debug tokens (${debugResult.totalTokens}) should be > architecture tokens (${archResult.totalTokens})`
    );
  } finally {
    cleanup(dir);
  }
});

await testAsync('returns files array', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'index.js', 'export default 42;\n');
    const result = await buildIntentAwareContext(dir, [{ file: 'index.js', score: 1 }], { intent: 'general' });
    assert(Array.isArray(result.files), 'files should be an array');
    assert(result.files.length > 0, 'files should not be empty');
    assertEqual(result.files[0].path, 'index.js');
  } finally {
    cleanup(dir);
  }
});

await testAsync('empty project produces empty context', async () => {
  const dir = tmpDir();
  try {
    const result = await buildIntentAwareContext(dir, [], { intent: 'debug' });
    assertEqual(result.totalTokens, 0, 'Empty project should have 0 tokens');
    assert(Array.isArray(result.files), 'files should be an array');
    assertEqual(result.files.length, 0, 'files should be empty');
  } finally {
    cleanup(dir);
  }
});

await testAsync('maxTokens override works', async () => {
  const dir = tmpDir();
  try {
    // Create multiple files to potentially exceed small budget
    for (let i = 0; i < 5; i++) {
      const lines = [];
      for (let j = 0; j < 100; j++) {
        lines.push(`// File ${i}, line ${j}: some content to fill tokens`);
      }
      writeFile(dir, `module${i}.js`, lines.join('\n'));
    }
    const rankedFiles = [0, 1, 2, 3, 4].map(i => ({ file: `module${i}.js`, score: 5 - i }));

    const result = await buildIntentAwareContext(dir, rankedFiles, {
      intent: 'debug',   // debug default is 18000
      maxTokens: 5000,
    });
    assert(
      result.totalTokens <= 5000,
      `totalTokens (${result.totalTokens}) should be <= 5000`
    );
  } finally {
    cleanup(dir);
  }
});

// ==============================================================================
suite('buildIntentAwareContext — smell prioritization');
// ==============================================================================

await testAsync('debug strategy boosts files with code smells', async () => {
  const dir = tmpDir();
  try {
    // Clean file — no smells, moderate score
    writeFile(dir, 'clean.js', 'export function add(a, b) { return a + b; }\n');
    // Smelly file — has TODOs, eval, empty catch — slightly lower initial score
    // 5 smells = +0.5 boost, so 0.3 + 0.5 = 0.8 > 0.5
    writeFile(dir, 'smelly.js', [
      '// TODO: fix this',
      '// FIXME: broken',
      'eval("alert(1)")',
      'try { x(); } catch (e) {}',
      'const password = "secret123"',
    ].join('\n'));

    // Smell boost capped at 0.5 — smelly needs 0.3 base + 0.5 boost = 0.8 > clean at 0.5
    const rankedFiles = [
      { file: 'clean.js', score: 0.5 },
      { file: 'smelly.js', score: 0.3 },
    ];

    const result = await buildIntentAwareContext(dir, rankedFiles, { intent: 'debug' });
    // With smell boost, smelly.js should be ranked first
    assert(result.files.length === 2, 'Should include both files');
    assertEqual(result.files[0].path, 'smelly.js', 'Smelly file should be first after boost');
  } finally {
    cleanup(dir);
  }
});

await testAsync('general strategy does not re-rank by smells', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'clean.js', 'export function add(a, b) { return a + b; }\n');
    writeFile(dir, 'smelly.js', [
      '// TODO: fix this',
      'eval("alert(1)")',
      'try { x(); } catch (e) {}',
    ].join('\n'));

    const rankedFiles = [
      { file: 'clean.js', score: 1.0 },
      { file: 'smelly.js', score: 0.2 },
    ];

    const result = await buildIntentAwareContext(dir, rankedFiles, { intent: 'general' });
    assert(result.files.length === 2, 'Should include both files');
    assertEqual(result.files[0].path, 'clean.js', 'Clean file should stay first (no smell boost)');
  } finally {
    cleanup(dir);
  }
});

// ==============================================================================
// RESULTS
// ==============================================================================
const results = summary();
process.exit(results.failed > 0 ? 1 : 0);
