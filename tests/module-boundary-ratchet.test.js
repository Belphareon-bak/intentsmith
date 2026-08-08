import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const TEST_PATH = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(TEST_PATH), '..');
const CHECKER = join(ROOT, 'scripts/module-boundary-ratchet.mjs');
const BASELINE_PATH = join(ROOT, 'tests/fixtures/module-boundary/baseline.json');
const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
const artifactParent = process.env.INTENTSMITH_TEST_ARTIFACT_DIR
  && existsSync(process.env.INTENTSMITH_TEST_ARTIFACT_DIR)
  ? process.env.INTENTSMITH_TEST_ARTIFACT_DIR
  : tmpdir();
const scratch = mkdtempSync(join(artifactParent, 'module-boundary-ratchet-test-'));

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

function test(name, callback) {
  try {
    callback();
    passed += 1;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    failed += 1;
    failures.push({ name, error: error.message });
    console.log(`  ❌ ${name}: ${error.message}`);
  }
}

function writeJson(name, value) {
  const target = join(scratch, name);
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
  return target;
}

function run(args = []) {
  return spawnSync(process.execPath, [CHECKER, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env,
      INTENTSMITH_TEST_ARTIFACT_DIR: scratch,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function fixtureCycles(lengths) {
  return lengths.map((length, cycleIndex) => Array.from(
    { length },
    (_, fileIndex) => `src/__fixture__/cycle-${cycleIndex}-${fileIndex}.js`,
  ));
}

function graphFixture({ edges = baseline.edges, cycleLengths = [21, 5, 2] } = {}) {
  const sortedEdges = [...edges].sort();
  return {
    counts: {
      internalEdges: sortedEdges.length,
      cycles: cycleLengths.length,
      filesInCycles: cycleLengths.reduce((total, length) => total + length, 0),
    },
    edges: sortedEdges,
    cycles: fixtureCycles(cycleLengths),
  };
}

console.log('\n═══ Module boundary ratchet ═══════════════════════════════════');

try {
  test('current P6 graph matches the provisional exact-edge baseline', () => {
    const result = run();
    assertEqual(result.status, 0, result.stderr || result.stdout);
    assert(result.stdout.includes('MODULE_BOUNDARY_RATCHET_PASS'), result.stdout);
    assert(result.stdout.includes('baselineEdges=1004 currentEdges=1004'), result.stdout);
    assert(result.stdout.includes('P6_SCANNER_LIMITS'), result.stdout);
  });

  test('added edge fails and prints the exact from -> to pair', () => {
    const added = 'src/__fixture__/added.js -> src/core/logger.js';
    const graphPath = writeJson('added-edge.json', graphFixture({
      edges: [...baseline.edges, added],
    }));
    const result = run(['--graph', graphPath]);
    assertEqual(result.status, 1, result.stdout || result.stderr);
    assert(result.stdout.includes('MODULE_BOUNDARY_RATCHET_FAIL'), result.stdout);
    assert(result.stdout.includes(`ADDED ${added}`), result.stdout);
  });

  test('new cycle or larger cyclic membership fails closed', () => {
    const graphPath = writeJson('new-cycle.json', graphFixture({
      cycleLengths: [21, 5, 2, 2],
    }));
    const result = run(['--graph', graphPath]);
    assertEqual(result.status, 1, result.stdout || result.stderr);
    assert(result.stdout.includes('CYCLE_COUNT_GREW baseline=3 current=4'), result.stdout);
    assert(result.stdout.includes('FILES_IN_CYCLES_GREW baseline=28 current=30'), result.stdout);
  });

  test('removed edge passes but reports integrator-owned tightening', () => {
    const removed = baseline.edges[0];
    const graphPath = writeJson('removed-edge.json', graphFixture({
      edges: baseline.edges.slice(1),
    }));
    const result = run(['--graph', graphPath]);
    assertEqual(result.status, 0, result.stderr || result.stdout);
    assert(result.stdout.includes('BASELINE_TIGHTENING_AVAILABLE'), result.stdout);
    assert(result.stdout.includes(`REMOVED ${removed}`), result.stdout);
  });

  test('glob and directory-wide baseline exceptions are invalid format', () => {
    const variants = [
      'src/chat/* -> src/core/logger.js',
      'src/chat/ -> src/core/logger.js',
    ];
    for (const [index, edge] of variants.entries()) {
      const invalidBaseline = {
        ...baseline,
        edges: [edge],
      };
      const baselinePath = writeJson(`wide-exception-${index}.json`, invalidBaseline);
      const graphPath = writeJson(`wide-exception-graph-${index}.json`, graphFixture());
      const result = run(['--baseline', baselinePath, '--graph', graphPath]);
      assertEqual(result.status, 1, result.stderr || result.stdout);
      assert(/exact|glob|directory exception/u.test(result.stderr), result.stderr);
    }
  });

  test('missing and malformed baselines fail closed', () => {
    const graphPath = writeJson('valid-graph.json', graphFixture());
    const missing = run([
      '--baseline', join(scratch, 'does-not-exist.json'),
      '--graph', graphPath,
    ]);
    assertEqual(missing.status, 1, missing.stderr || missing.stdout);
    assert(missing.stderr.includes('INVALID_BASELINE'), missing.stderr);
    assert(missing.stderr.includes('ENOENT'), missing.stderr);

    const malformedPath = join(scratch, 'malformed.json');
    writeFileSync(malformedPath, '{"schemaVersion":');
    const malformed = run(['--baseline', malformedPath, '--graph', graphPath]);
    assertEqual(malformed.status, 1, malformed.stderr || malformed.stdout);
    assert(malformed.stderr.includes('INVALID_BASELINE'), malformed.stderr);
  });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n${'═'.repeat(70)}`);
console.log(`  RESULTS: ${passed} passed, ${failed} failed, 0 skipped`);
for (const failure of failures) {
  console.log(`    ❌ ${failure.name}: ${failure.error}`);
}
console.log(`${'═'.repeat(70)}\n`);
if (failed > 0) process.exitCode = 1;
