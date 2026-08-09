import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
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
const SCANNER = join(ROOT, 'scripts/module-graph.mjs');
const BASELINE_PATH = join(ROOT, 'tests/fixtures/module-boundary/baseline.json');
const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
const artifactParent = process.env.INTENTSMITH_TEST_ARTIFACT_DIR
  && existsSync(process.env.INTENTSMITH_TEST_ARTIFACT_DIR)
  ? process.env.INTENTSMITH_TEST_ARTIFACT_DIR
  : tmpdir();
const scratch = mkdtempSync(join(artifactParent, 'module-boundary-ratchet-test-'));
let writerRepoIndex = 0;

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

function runCommand(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, LC_ALL: 'C' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function runGit(repo, args) {
  const result = runCommand('git', ['-C', repo, ...args], repo);
  assertEqual(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function commitFixture(repo, paths, message) {
  runGit(repo, ['add', '--', ...paths]);
  runGit(repo, [
    '-c', 'user.name=IntentSmith Ratchet Test',
    '-c', 'user.email=ratchet-test@invalid.local',
    'commit', '-q', '-m', message,
  ]);
}

function makeBaselineWriterRepo() {
  writerRepoIndex += 1;
  const repo = join(scratch, `baseline-writer-repo-${writerRepoIndex}`);
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  mkdirSync(join(repo, 'src'), { recursive: true });
  mkdirSync(join(repo, 'tests/fixtures/module-boundary'), { recursive: true });
  copyFileSync(CHECKER, join(repo, 'scripts/module-boundary-ratchet.mjs'));
  copyFileSync(SCANNER, join(repo, 'scripts/module-graph.mjs'));
  copyFileSync(BASELINE_PATH, join(repo, 'tests/fixtures/module-boundary/baseline.json'));
  writeFileSync(join(repo, 'src/server.js'), 'export const ready = true;\n');
  runGit(repo, ['init', '-q']);
  commitFixture(repo, [
    'scripts/module-boundary-ratchet.mjs',
    'scripts/module-graph.mjs',
    'src/server.js',
    'tests/fixtures/module-boundary/baseline.json',
  ], 'fixture baseline');
  return repo;
}

function parseHeadline(stdout) {
  const line = stdout.split('\n').find((entry) => (
    entry.startsWith('MODULE_BOUNDARY_RATCHET_PASS ')
    || entry.startsWith('MODULE_BOUNDARY_RATCHET_FAIL ')
  ));
  assert(line, `missing ratchet headline in: ${stdout}`);
  return Object.fromEntries(line.split(' ').slice(1).map((entry) => {
    const separator = entry.indexOf('=');
    assert(separator > 0, `malformed ratchet headline field: ${entry}`);
    return [entry.slice(0, separator), entry.slice(separator + 1)];
  }));
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
    meta: {
      tool: 'scripts/module-graph.mjs',
      protocol: 1,
      limitations: [
        'computed import() targets are not resolved',
        'template-literal content is ignored',
      ],
    },
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
    const headline = parseHeadline(result.stdout);
    const baselineEdges = Number(headline.baselineEdges);
    const currentEdges = Number(headline.currentEdges);
    const added = Number(headline.added);
    const removed = Number(headline.removed);
    assertEqual(baselineEdges, baseline.edges.length, result.stdout);
    assertEqual(added, 0, result.stdout);
    assert(currentEdges <= baselineEdges, result.stdout);
    assertEqual(removed, baselineEdges - currentEdges, result.stdout);
    if (removed > 0) {
      assert(result.stdout.includes('BASELINE_TIGHTENING_AVAILABLE'), result.stdout);
    }
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

  test('static and dynamic forms of one resolved pair collapse after normalization', () => {
    const existing = baseline.edges[0];
    const graphPath = writeJson('static-dynamic-collision.json', graphFixture({
      edges: [...baseline.edges, `${existing} (dynamic)`],
    }));
    const result = run(['--graph', graphPath]);
    assertEqual(result.status, 0, result.stderr || result.stdout);
    const headline = parseHeadline(result.stdout);
    assertEqual(Number(headline.currentEdges), baseline.edges.length, result.stdout);
    assertEqual(Number(headline.normalizedDuplicates), 1, result.stdout);
    assert(result.stdout.includes('NORMALIZED_EDGE_COLLISIONS collapsed=1'), result.stdout);

    const added = 'src/__fixture__/dual.js -> src/core/logger.js';
    const addedGraphPath = writeJson('new-static-dynamic-collision.json', graphFixture({
      edges: [...baseline.edges, added, `${added} (dynamic)`],
    }));
    const addedResult = run(['--graph', addedGraphPath]);
    assertEqual(addedResult.status, 1, addedResult.stderr || addedResult.stdout);
    assertEqual((addedResult.stdout.match(new RegExp(`ADDED ${added}`, 'gu')) || []).length, 1, addedResult.stdout);
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
      assertEqual(result.status, 2, result.stderr || result.stdout);
      assert(/exact|glob|directory exception/u.test(result.stderr), result.stderr);
    }
  });

  test('missing and malformed baselines fail closed', () => {
    const graphPath = writeJson('valid-graph.json', graphFixture());
    const missing = run([
      '--baseline', join(scratch, 'does-not-exist.json'),
      '--graph', graphPath,
    ]);
    assertEqual(missing.status, 2, missing.stderr || missing.stdout);
    assert(missing.stderr.includes('INVALID_BASELINE'), missing.stderr);
    assert(missing.stderr.includes('ENOENT'), missing.stderr);

    const malformedPath = join(scratch, 'malformed.json');
    writeFileSync(malformedPath, '{"schemaVersion":');
    const malformed = run(['--baseline', malformedPath, '--graph', graphPath]);
    assertEqual(malformed.status, 2, malformed.stderr || malformed.stdout);
    assert(malformed.stderr.includes('INVALID_BASELINE'), malformed.stderr);
  });

  test('explicit writer migrates v1 atomically and requires exact acceptance for additions', () => {
    const repo = makeBaselineWriterRepo();
    const fixtureBaseline = join(repo, 'tests/fixtures/module-boundary/baseline.json');
    const migrate = run(['--root', repo, '--write-baseline']);
    assertEqual(migrate.status, 0, migrate.stderr || migrate.stdout);
    assert(migrate.stdout.includes('MODULE_BOUNDARY_BASELINE_WRITTEN'), migrate.stdout);
    const migrated = JSON.parse(readFileSync(fixtureBaseline, 'utf8'));
    assertEqual(migrated.schemaVersion, 2);
    assertEqual(migrated.authority, 'integration');
    assertEqual(migrated.scanner, 'scripts/module-graph.mjs');
    assertEqual(migrated.edges.length, 0);
    assertEqual(migrated.sourceRevision, runGit(repo, ['rev-parse', 'HEAD']));
    assertEqual(migrated.sourceTree, runGit(repo, ['rev-parse', 'HEAD:src']));

    const migratedCheck = run(['--root', repo]);
    assertEqual(migratedCheck.status, 0, migratedCheck.stderr || migratedCheck.stdout);
    assert(migratedCheck.stdout.includes('BASELINE_PROVENANCE_VERIFIED'), migratedCheck.stdout);

    commitFixture(repo, ['tests/fixtures/module-boundary/baseline.json'], 'migrate baseline');
    writeFileSync(join(repo, 'src/dependency.js'), 'export const dependency = true;\n');
    writeFileSync(
      join(repo, 'src/server.js'),
      "import './dependency.js';\nexport const ready = true;\n",
    );
    commitFixture(repo, ['src/dependency.js', 'src/server.js'], 'add exact dependency');

    const beforeRefusal = readFileSync(fixtureBaseline, 'utf8');
    const refused = run(['--root', repo, '--write-baseline']);
    assertEqual(refused.status, 1, refused.stderr || refused.stdout);
    assert(refused.stderr.includes('EXACT_ACCEPTANCE_REQUIRED'), refused.stderr);
    assert(refused.stderr.includes('ACCEPTANCE_REQUIRED src/server.js -> src/dependency.js'), refused.stderr);
    assertEqual(readFileSync(fixtureBaseline, 'utf8'), beforeRefusal, 'refused write changed the baseline');

    const accepted = run([
      '--root', repo,
      '--write-baseline',
      '--accept-edge', 'src/server.js -> src/dependency.js',
    ]);
    assertEqual(accepted.status, 0, accepted.stderr || accepted.stdout);
    const updated = JSON.parse(readFileSync(fixtureBaseline, 'utf8'));
    assert(updated.edges.includes('src/server.js -> src/dependency.js'));
    assertEqual(updated.sourceRevision, runGit(repo, ['rev-parse', 'HEAD']));

    const syntheticWrite = run([
      '--root', repo,
      '--write-baseline',
      '--graph', join(scratch, 'valid-graph.json'),
    ]);
    assertEqual(syntheticWrite.status, 2, syntheticWrite.stderr || syntheticWrite.stdout);
    assert(syntheticWrite.stderr.includes('refuses synthetic --graph input'), syntheticWrite.stderr);
  });

  test('schema v2 provenance rejects a revision claim that is not a local ancestor', () => {
    const repo = makeBaselineWriterRepo();
    const fixtureBaseline = join(repo, 'tests/fixtures/module-boundary/baseline.json');
    const migrate = run(['--root', repo, '--write-baseline']);
    assertEqual(migrate.status, 0, migrate.stderr || migrate.stdout);
    const invalid = JSON.parse(readFileSync(fixtureBaseline, 'utf8'));
    invalid.sourceRevision = 'f'.repeat(40);
    writeFileSync(fixtureBaseline, `${JSON.stringify(invalid, null, 2)}\n`);
    const result = run(['--root', repo]);
    assertEqual(result.status, 2, result.stderr || result.stdout);
    assert(result.stderr.includes('INVALID_BASELINE_PROVENANCE'), result.stderr);
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
