// tests/dead-code-detector.test.js — Dead Code Detector unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import { detectDeadCode, formatDeadCodeReport, getDeadCodeSummary } from '../src/code-intel/dead-code-detector.js';
import { symbolIndex } from '../src/code-intel/symbol-index.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Helpers ────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dead-code-test-'));
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

// ─── Tests ──────────────────────────────────────────────────────────────────

suite('Dead Code Detector');

// 1. Detects unused function
await testAsync('detects unused function', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'utils.js', `
function usedHelper() {
  return 42;
}

function unusedHelper() {
  return 99;
}
`);
    writeFile(dir, 'main.js', `
function main() {
  const val = usedHelper();
  return val;
}
`);

    symbolIndex.clear();
    const result = await detectDeadCode(dir);

    // unusedHelper should be detected as dead
    const dead = result.deadSymbols.find(s => s.name === 'unusedHelper');
    assert(dead !== undefined, 'unusedHelper should be detected as dead code');
    assertEqual(dead.type, 'function', 'should be a function');
    assert(dead.confidence > 0, 'should have positive confidence');
  } finally {
    symbolIndex.clear();
    cleanup(dir);
  }
});

// 2. Does not flag used function
await testAsync('does not flag used function', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'utils.js', `
function usedHelper() {
  return 42;
}
`);
    writeFile(dir, 'consumer.js', `
function doWork() {
  const result = usedHelper();
  return result;
}
`);

    symbolIndex.clear();
    const result = await detectDeadCode(dir);

    const dead = result.deadSymbols.find(s => s.name === 'usedHelper');
    assert(dead === undefined, 'usedHelper should NOT be detected as dead (it is referenced in consumer.js)');
  } finally {
    symbolIndex.clear();
    cleanup(dir);
  }
});

// 3. Skips exported symbols by default
await testAsync('skips exported symbols by default', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'api.js', `
function internalUnused() {
  return 1;
}
`);

    symbolIndex.clear();
    await symbolIndex.buildIndex(dir);

    // Manually mark internalUnused as exported to test the filter
    const syms = symbolIndex.symbolsByName.get('internalUnused');
    assert(syms && syms.length > 0, 'internalUnused should be indexed');
    syms[0].exported = true;

    const result = await detectDeadCode(dir, { includeExported: false });

    const dead = result.deadSymbols.find(s => s.name === 'internalUnused');
    assert(dead === undefined, 'exported symbol should be skipped by default');
  } finally {
    symbolIndex.clear();
    cleanup(dir);
  }
});

// 4. Finds exported dead code when includeExported=true
await testAsync('finds exported dead code when includeExported=true', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'api.js', `
function exportedUnused() {
  return 1;
}
`);

    symbolIndex.clear();
    await symbolIndex.buildIndex(dir);

    // Mark as exported
    const syms = symbolIndex.symbolsByName.get('exportedUnused');
    assert(syms && syms.length > 0, 'exportedUnused should be indexed');
    syms[0].exported = true;

    const result = await detectDeadCode(dir, { includeExported: true });

    const dead = result.deadSymbols.find(s => s.name === 'exportedUnused');
    assert(dead !== undefined, 'exported symbol should be found when includeExported=true');
    assertEqual(dead.confidence, 0.6, 'exported+unused should have 0.6 confidence');
  } finally {
    symbolIndex.clear();
    cleanup(dir);
  }
});

// 5. Skips framework entrypoint patterns
await testAsync('skips framework entrypoint patterns', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'server.js', `
function handleRequest() {
  return 'ok';
}

function processData() {
  return 'data';
}
`);

    symbolIndex.clear();
    const result = await detectDeadCode(dir);

    const deadHandle = result.deadSymbols.find(s => s.name === 'handleRequest');
    assert(deadHandle === undefined, 'handleRequest should be skipped (handler pattern)');

    // processData has no special pattern — could be dead if unreferenced
    // (it might show up or not, depending on other filters — the point is handleRequest is safe)
  } finally {
    symbolIndex.clear();
    cleanup(dir);
  }
});

// 6. Skips lifecycle hooks
await testAsync('skips lifecycle hooks', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'component.js', `
function onInit() {
  console.log('init');
}

function beforeMount() {
  console.log('mount');
}

function setupConfig() {
  console.log('config');
}
`);

    symbolIndex.clear();
    const result = await detectDeadCode(dir);

    const deadOnInit = result.deadSymbols.find(s => s.name === 'onInit');
    assert(deadOnInit === undefined, 'onInit should be skipped (lifecycle hook pattern)');

    const deadBefore = result.deadSymbols.find(s => s.name === 'beforeMount');
    assert(deadBefore === undefined, 'beforeMount should be skipped (lifecycle hook pattern)');

    const deadSetup = result.deadSymbols.find(s => s.name === 'setupConfig');
    assert(deadSetup === undefined, 'setupConfig should be skipped (lifecycle hook pattern)');
  } finally {
    symbolIndex.clear();
    cleanup(dir);
  }
});

// 7. Skips test files
await testAsync('skips test files', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'tests/helper.js', `
function testHelper() {
  return 'test';
}
`);
    writeFile(dir, 'src/app.js', `
function appMain() {
  return 'app';
}
`);

    symbolIndex.clear();
    const result = await detectDeadCode(dir);

    const deadTest = result.deadSymbols.find(s => s.name === 'testHelper');
    assert(deadTest === undefined, 'symbol in tests/ dir should be skipped');
  } finally {
    symbolIndex.clear();
    cleanup(dir);
  }
});

// 8. formatDeadCodeReport returns markdown
await testAsync('formatDeadCodeReport returns markdown', async () => {
  const mockResult = {
    deadSymbols: [
      { name: 'unusedFn', type: 'function', file: 'src/utils.js', line: 10, confidence: 0.9 },
      { name: 'deadClass', type: 'class', file: 'src/models.js', line: 5, confidence: 0.6 },
    ],
    stats: { totalSymbols: 50, deadCount: 2, scanTime: 120 },
    entryPoints: ['index.js'],
  };

  const report = formatDeadCodeReport(mockResult);
  assert(typeof report === 'string', 'report should be a string');
  assert(report.includes('##'), 'report should contain markdown headers');
  assert(report.includes('src/utils.js'), 'report should contain file names');
  assert(report.includes('src/models.js'), 'report should contain file names');
  assert(report.includes('unusedFn'), 'report should contain symbol names');
  assert(report.includes('deadClass'), 'report should contain symbol names');
  assert(report.includes('50'), 'report should contain total symbol count');
});

// 9. getDeadCodeSummary returns one-line string
await testAsync('getDeadCodeSummary returns one-line string', async () => {
  const mockResult = {
    deadSymbols: [
      { name: 'unusedFn', type: 'function', file: 'src/utils.js', line: 10, confidence: 0.9 },
      { name: 'anotherFn', type: 'function', file: 'src/other.js', line: 20, confidence: 0.6 },
    ],
    stats: { totalSymbols: 50, deadCount: 2, scanTime: 100 },
    entryPoints: [],
  };

  const summaryStr = getDeadCodeSummary(mockResult);
  assert(typeof summaryStr === 'string', 'summary should be a string');
  assert(summaryStr.includes('unused'), 'summary should mention unused symbols');
  assert(!summaryStr.includes('\n'), 'summary should be a single line');
  assert(summaryStr.includes('2'), 'summary should contain the dead count');
});

// 10. Empty project returns empty result
await testAsync('empty project returns empty result', async () => {
  const dir = tmpDir();
  try {
    // Empty directory — no code files at all
    symbolIndex.clear();
    const result = await detectDeadCode(dir);

    assertEqual(result.deadSymbols.length, 0, 'empty project should have no dead symbols');
    assertEqual(result.stats.deadCount, 0, 'deadCount should be 0');
    assertEqual(result.stats.totalSymbols, 0, 'totalSymbols should be 0');
  } finally {
    symbolIndex.clear();
    cleanup(dir);
  }
});

// 11. Returns stats with timing
await testAsync('returns stats with timing', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'app.js', `
function alpha() { return 1; }
function beta() { return alpha(); }
`);

    symbolIndex.clear();
    const result = await detectDeadCode(dir);

    assert(result.stats !== undefined, 'result should have stats');
    assert(result.stats.totalSymbols > 0, 'totalSymbols should be > 0');
    assert(result.stats.scanTime >= 0, 'scanTime should be >= 0');
    assert(typeof result.stats.deadCount === 'number', 'deadCount should be a number');
    assert(Array.isArray(result.entryPoints), 'entryPoints should be an array');
  } finally {
    symbolIndex.clear();
    cleanup(dir);
  }
});

// ─── Summary ────────────────────────────────────────────────────────────────

const results = summary();
process.exit(results.failed > 0 ? 1 : 0);
