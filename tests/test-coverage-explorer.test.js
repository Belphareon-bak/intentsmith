// tests/test-coverage-explorer.test.js — Test Coverage Explorer unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import { exploreTestCoverage, formatCoverageReport, getCoverageSummary } from '../src/code-intel/test-coverage-explorer.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cov-test-'));
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

// ─── Test Coverage Detection ────────────────────────────────────────────────

suite('TestCoverageExplorer — Detection');

await testAsync('finds untested files', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/auth.js', `function validate() { return true; }`);
    writeFile(dir, 'src/db.js', `function query() { return []; }`);
    writeFile(dir, 'tests/auth.test.js', `
import { validate } from '../src/auth.js';
describe('auth', () => {
  test('validates', () => { expect(validate()).toBe(true); });
});
`);

    const result = await exploreTestCoverage(dir);

    assertEqual(result.sourceFiles, 2);
    assertEqual(result.testFiles, 1);
    assert(result.untestedFiles.length > 0, 'should have untested files');
    assert(result.untestedFiles.includes('src/db.js'), `db.js should be untested: ${result.untestedFiles}`);
  } finally { cleanup(dir); }
});

await testAsync('maps test to source via naming convention', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/auth.js', `function validate() { return true; }`);
    writeFile(dir, 'tests/auth.test.js', `test('auth works', () => {});`);

    const result = await exploreTestCoverage(dir);

    assertEqual(result.testedFiles, 1);
    assert('src/auth.js' in result.sourceTestMap, 'auth.js should be in test map');
  } finally { cleanup(dir); }
});

await testAsync('maps test to source via import analysis', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/utils.js', `export function helper() { return 42; }`);
    writeFile(dir, 'tests/utils-spec.test.js', `
import { helper } from '../src/utils.js';
test('helper returns 42', () => { expect(helper()).toBe(42); });
`);

    const result = await exploreTestCoverage(dir);

    assert(result.testedFiles >= 1, `should find ≥1 tested, got ${result.testedFiles}`);
  } finally { cleanup(dir); }
});

await testAsync('detects describe block names as tested symbols', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/auth.js', `function validate() { return true; }`);
    writeFile(dir, 'tests/auth.test.js', `
describe('AuthService', () => {
  it('validates token', () => {});
  it('checks permission', () => {});
});
`);

    const result = await exploreTestCoverage(dir);

    assert(result.testedSymbols.includes('AuthService'), `should detect AuthService: ${result.testedSymbols}`);
    assert(result.testedSymbols.includes('validates token'), `should detect 'validates token': ${result.testedSymbols}`);
  } finally { cleanup(dir); }
});

await testAsync('calculates coverage estimate', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/a.js', `function a() {}`);
    writeFile(dir, 'src/b.js', `function b() {}`);
    writeFile(dir, 'src/c.js', `function c() {}`);
    writeFile(dir, 'tests/a.test.js', `test('a', () => {});`);

    const result = await exploreTestCoverage(dir);

    assertEqual(result.sourceFiles, 3);
    assert(result.coverageEstimate > 0, 'should have some coverage');
    assert(result.coverageEstimate <= 100, 'should be ≤100');
  } finally { cleanup(dir); }
});

await testAsync('checks specific symbols for test coverage', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/auth.js', `function validate() {} function refresh() {}`);
    writeFile(dir, 'tests/auth.test.js', `
describe('validate', () => { it('works', () => {}); });
`);

    const result = await exploreTestCoverage(dir, {
      symbolNames: ['validate', 'refresh'],
    });

    assert(!result.untestedSymbols.includes('validate'), 'validate should be tested');
    assert(result.untestedSymbols.includes('refresh'), 'refresh should be untested');
  } finally { cleanup(dir); }
});

// ─── Edge Cases ─────────────────────────────────────────────────────────────

suite('TestCoverageExplorer — Edge Cases');

await testAsync('empty project returns zeros', async () => {
  const dir = tmpDir();
  try {
    const result = await exploreTestCoverage(dir);
    assertEqual(result.sourceFiles, 0);
    assertEqual(result.testFiles, 0);
    assertEqual(result.coverageEstimate, 0);
  } finally { cleanup(dir); }
});

await testAsync('project with only tests', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'tests/a.test.js', `test('a', () => {});`);
    writeFile(dir, 'tests/b.test.js', `test('b', () => {});`);

    const result = await exploreTestCoverage(dir);
    assertEqual(result.sourceFiles, 0);
    assertEqual(result.testFiles, 2);
    assertEqual(result.coverageEstimate, 0);
  } finally { cleanup(dir); }
});

// ─── Formatting ─────────────────────────────────────────────────────────────

suite('TestCoverageExplorer — Formatting');

test('formatCoverageReport returns markdown', () => {
  const result = {
    sourceFiles: 10,
    testFiles: 3,
    testedFiles: 5,
    untestedFiles: ['src/db.js', 'src/cache.js'],
    untestedSymbols: ['refreshToken'],
    testSourceMap: {},
    sourceTestMap: { 'src/auth.js': ['tests/auth.test.js'] },
    testedSymbols: [],
    coverageEstimate: 50,
    scanTime: 42,
  };

  const report = formatCoverageReport(result);
  assert(report.includes('##'), 'should have markdown headers');
  assert(report.includes('50%'), 'should include coverage percentage');
  assert(report.includes('src/db.js'), 'should list untested files');
});

test('getCoverageSummary returns one-line string', () => {
  const result = {
    sourceFiles: 10,
    testFiles: 3,
    testedFiles: 5,
    untestedFiles: ['a.js', 'b.js'],
    coverageEstimate: 50,
  };

  const s = getCoverageSummary(result);
  assert(typeof s === 'string', 'should be string');
  assert(!s.includes('\n'), 'should be one line');
  assert(s.includes('50%'), 'should include percentage');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

summary();
