#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VALIDATOR = join(ROOT, 'scripts/validate-core-optional-map.mjs');
const GRAPH_FIXTURE = join(ROOT, 'tests/fixtures/core-optional-map/module-graph.json');
const MAP_FIXTURE = join(ROOT, 'tests/fixtures/core-optional-map/core-optional-map.json');
const artifactParent = process.env.INTENTSMITH_TEST_ARTIFACT_DIR
  && existsSync(process.env.INTENTSMITH_TEST_ARTIFACT_DIR)
  ? process.env.INTENTSMITH_TEST_ARTIFACT_DIR
  : tmpdir();
const scratch = mkdtempSync(join(artifactParent, 'core-optional-map-validator-'));
const repo = join(scratch, 'repo');
const artifactRoot = join(scratch, 'artifacts');
let caseCounter = 0;
let passed = 0;
let failed = 0;
const failures = [];

function test(name, callback) {
  try {
    callback();
    passed += 1;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    failed += 1;
    failures.push({ name, message: error.stack || error.message });
    console.log(`  ❌ ${name}: ${error.message}`);
  }
}

function command(commandName, args, cwd = repo) {
  return spawnSync(commandName, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, LC_ALL: 'C' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function git(args) {
  const result = command('git', ['-C', repo, ...args], repo);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function combined(result) {
  return `${result.stdout || ''}${result.stderr || ''}`;
}

function assertStatus(result, status, marker = null) {
  assert.equal(result.status, status, combined(result));
  if (marker !== null) assert.match(combined(result), new RegExp(marker, 'u'));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function makeCase({ mutateGraph, mutateMap, rawMap } = {}) {
  caseCounter += 1;
  const root = join(artifactRoot, String(caseCounter).padStart(2, '0'));
  mkdirSync(root, { recursive: true });
  let graphBytes = readFileSync(GRAPH_FIXTURE);
  const graph = JSON.parse(graphBytes);
  const map = clone(JSON.parse(readFileSync(MAP_FIXTURE, 'utf8')));
  if (mutateGraph) {
    mutateGraph(graph);
    graphBytes = Buffer.from(`${JSON.stringify(graph, null, 2)}\n`);
  }
  map.sourceRevision = sourceRevision;
  map.graphSha256 = sha256(graphBytes);
  if (mutateMap) mutateMap(map, graph);
  const graphPath = join(root, 'module-graph.json');
  const mapPath = join(root, 'core-optional-map.json');
  writeFileSync(graphPath, graphBytes);
  const mapText = rawMap
    ? rawMap(`${JSON.stringify(map, null, 2)}\n`)
    : `${JSON.stringify(map, null, 2)}\n`;
  writeFileSync(mapPath, mapText);
  return { root, graphPath, mapPath, map, graph };
}

function runCase(fixture, revision = sourceRevision) {
  return command(process.execPath, [
    VALIDATOR,
    '--graph', fixture.graphPath,
    '--map', fixture.mapPath,
    '--source-revision', revision,
  ]);
}

mkdirSync(repo, { recursive: true });
mkdirSync(artifactRoot, { recursive: true });
writeFileSync(join(repo, 'README.md'), 'validator fixture repository\n');
git(['init', '-q']);
git(['add', 'README.md']);
git([
  '-c', 'user.name=IntentSmith P10 Test',
  '-c', 'user.email=p10-test@invalid.local',
  'commit', '-q', '-m', 'fixture source revision',
]);
const sourceRevision = git(['rev-parse', 'HEAD']);

console.log('\n═══ Core / Optional map validator ═══');

try {
  test('help and CLI failures are explicit', () => {
    const help = command(process.execPath, [VALIDATOR, '--help']);
    assertStatus(help, 0, 'Usage:');
    const missing = command(process.execPath, [VALIDATOR, '--graph', '/tmp/graph.json']);
    assertStatus(missing, 2, 'code=USAGE');
    const unknown = command(process.execPath, [VALIDATOR, '--unknown', 'value']);
    assertStatus(unknown, 2, 'code=USAGE');
  });

  test('valid fixture binds exact graph, rows, directional edges, and SCC flags', () => {
    const fixtureDigest = sha256(readFileSync(GRAPH_FIXTURE));
    const fixtureMap = JSON.parse(readFileSync(MAP_FIXTURE, 'utf8'));
    assert.equal(fixtureMap.graphSha256, fixtureDigest);
    const result = runCase(makeCase());
    assertStatus(result, 0, 'CORE_OPTIONAL_MAP_VALID_PASS');
    assert.match(result.stdout, /files=4 core=2 optional=1 unresolved=1/u);
    assert.match(result.stdout, /coreToOptional=2 sameCycle=1 unresolvedBoundary=1/u);
  });

  test('source revision and clean worktree are checked fail-closed', () => {
    const mismatch = makeCase({ mutateMap: map => { map.sourceRevision = 'f'.repeat(40); } });
    assertStatus(runCase(mismatch), 1, 'code=MAP_SOURCE_REVISION_MISMATCH');

    const wrongHead = makeCase();
    wrongHead.map.sourceRevision = 'f'.repeat(40);
    writeJson(wrongHead.mapPath, wrongHead.map);
    assertStatus(runCase(wrongHead, 'f'.repeat(40)), 2, 'code=SOURCE_REVISION_MISMATCH');

    const dirtyPath = join(repo, 'untracked.txt');
    writeFileSync(dirtyPath, 'dirty\n');
    assertStatus(runCase(makeCase()), 2, 'code=WORKTREE_NOT_CLEAN');
    unlinkSync(dirtyPath);
    assert.equal(git(['status', '--porcelain=v1', '--untracked-files=all']), '');
  });

  test('artifact paths must be absolute, co-located, regular, and direct', () => {
    const fixture = makeCase();
    const relative = command(process.execPath, [
      VALIDATOR,
      '--graph', 'module-graph.json',
      '--map', 'core-optional-map.json',
      '--source-revision', sourceRevision,
    ]);
    assertStatus(relative, 2, 'code=ARTIFACT_PATH_NOT_ABSOLUTE');

    const otherRoot = join(artifactRoot, 'other-root');
    mkdirSync(otherRoot, { recursive: true });
    const otherMap = join(otherRoot, 'core-optional-map.json');
    copyFileSync(fixture.mapPath, otherMap);
    const split = runCase({ ...fixture, mapPath: otherMap });
    assertStatus(split, 2, 'code=ARTIFACT_ROOT_MISMATCH');

    const graphLink = join(fixture.root, 'graph-link.json');
    symlinkSync(fixture.graphPath, graphLink);
    const linked = runCase({ ...fixture, graphPath: graphLink });
    assertStatus(linked, 2, 'code=ARTIFACT_NOT_REGULAR');
  });

  test('duplicate JSON object keys are rejected before JSON.parse can overwrite them', () => {
    const fixture = makeCase({
      rawMap: text => text.replace(
        /\{\n/u,
        `{\n  "sourceRevision": "${sourceRevision}",\n`,
      ),
    });
    assertStatus(runCase(fixture), 1, 'code=JSON_DUPLICATE_KEY');
  });

  test('duplicate and missing file rows are rejected', () => {
    const duplicate = makeCase({ mutateMap: map => { map.rows.push(clone(map.rows[0])); } });
    assertStatus(runCase(duplicate), 1, 'code=MAP_FILE_DUPLICATE');
    const missing = makeCase({ mutateMap: map => { map.rows.pop(); } });
    assertStatus(runCase(missing), 1, 'code=MAP_COUNT_MISMATCH');
  });

  test('foreign file rows are rejected even when the row count is unchanged', () => {
    const fixture = makeCase({
      mutateMap: map => { map.rows[3].file = 'src/foreign/not-in-graph.js'; },
    });
    assertStatus(runCase(fixture), 1, 'code=MAP_FOREIGN_FILE');
  });

  test('unknown classification is rejected', () => {
    const fixture = makeCase({
      mutateMap: map => { map.rows[0].classification = 'BUILTIN'; },
    });
    assertStatus(runCase(fixture), 1, 'code=MAP_CLASSIFICATION_INVALID');
  });

  test('graph source count must equal the unique fanIn file census', () => {
    const fixture = makeCase({ mutateGraph: graph => { graph.counts.srcFiles = 5; } });
    assertStatus(runCase(fixture), 1, 'code=GRAPH_COUNT_MISMATCH');
  });

  test('OPTIONAL and UNRESOLVED rows require a concrete R1 reason', () => {
    const optional = makeCase({ mutateMap: map => { map.rows[2].reason = '  '; } });
    assertStatus(runCase(optional), 1, 'code=MAP_REASON_REQUIRED');
    const unresolved = makeCase({ mutateMap: map => { map.rows[3].reason = ''; } });
    assertStatus(runCase(unresolved), 1, 'code=MAP_REASON_REQUIRED');
  });

  test('map graph digest binds exact graph bytes', () => {
    const fixture = makeCase({ mutateMap: map => { map.graphSha256 = '0'.repeat(64); } });
    assertStatus(runCase(fixture), 1, 'code=GRAPH_DIGEST_MISMATCH');
  });

  test('missing derived CORE to OPTIONAL edge is rejected', () => {
    const fixture = makeCase({ mutateMap: map => { map.coreToOptional.pop(); } });
    assertStatus(runCase(fixture), 1, 'code=MAP_EDGE_MISSING');
  });

  test('manually added non-derived CORE to OPTIONAL edge is rejected', () => {
    const fixture = makeCase({
      mutateMap: map => {
        map.coreToOptional.push({
          edge: 'src/chat/core.js -> src/core/kernel.js',
          inSameCycle: false,
        });
      },
    });
    assertStatus(runCase(fixture), 1, 'code=MAP_EDGE_UNEXPECTED');
  });

  test('SCC membership is re-derived instead of trusted from the map', () => {
    const fixture = makeCase({ mutateMap: map => { map.coreToOptional[0].inSameCycle = false; } });
    assertStatus(runCase(fixture), 1, 'code=MAP_SCC_FLAG_MISMATCH');
  });

  test('unknown map fields are rejected instead of becoming shadow authority', () => {
    const fixture = makeCase({ mutateMap: map => { map.overall = 'PASS'; } });
    assertStatus(runCase(fixture), 1, 'code=MAP_SCHEMA_INVALID');
  });

  test('graph edges cannot reference files outside the fanIn census', () => {
    const fixture = makeCase({
      mutateGraph: graph => { graph.edges.push('src/chat/core.js -> src/foreign.js'); },
    });
    assertStatus(runCase(fixture), 1, 'code=GRAPH_EDGE_FOREIGN_FILE');
  });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n${'═'.repeat(70)}`);
console.log(`  RESULTS: ${passed} passed, ${failed} failed, 0 skipped`);
for (const failure of failures) console.log(`    ❌ ${failure.name}: ${failure.message}`);
console.log(`${'═'.repeat(70)}\n`);
if (failed > 0) process.exitCode = 1;
