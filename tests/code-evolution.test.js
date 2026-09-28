// tests/code-evolution.test.js — Code Evolution Analyzer unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import {
  findHotspots,
  analyzeChurn,
  findCoChanges,
  analyzeComplexityTrend,
  analyzeEvolution,
  formatEvolutionReport,
} from '../src/code-intel/code-evolution.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tmpGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evolution-'));
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'ignore' });
  return dir;
}

function writeAndCommit(dir, file, content, msg = 'update') {
  const filePath = path.join(dir, file);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  execSync(`git add "${file}"`, { cwd: dir, stdio: 'ignore' });
  execSync(`git commit -m "${msg}" --allow-empty`, { cwd: dir, stdio: 'ignore' });
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ─── Hotspot Detection ──────────────────────────────────────────────────────

suite('CodeEvolution — Hotspots');

await testAsync('detects frequently changed files', async () => {
  const dir = tmpGitRepo();
  try {
    // Create initial files
    writeAndCommit(dir, 'src/hotfile.js', 'v1', 'initial');

    // Change hotfile multiple times
    writeAndCommit(dir, 'src/hotfile.js', 'v2', 'update 1');
    writeAndCommit(dir, 'src/hotfile.js', 'v3', 'update 2');
    writeAndCommit(dir, 'src/hotfile.js', 'v4', 'update 3');

    // Change coldfile once
    writeAndCommit(dir, 'src/coldfile.js', 'v1', 'cold file');

    const hotspots = await findHotspots(dir, { days: 30 });
    assert(hotspots.length >= 2, `should find ≥2 files, got ${hotspots.length}`);
    assertEqual(hotspots[0].file, 'src/hotfile.js');
    assert(hotspots[0].commits > hotspots[hotspots.length - 1].commits, 'hotfile should have more commits');
    assertEqual(hotspots[0].rank, 1);
  } finally { cleanup(dir); }
});

await testAsync('ignores node_modules', async () => {
  const dir = tmpGitRepo();
  try {
    writeAndCommit(dir, 'src/main.js', 'code', 'init');
    writeAndCommit(dir, 'node_modules/pkg/index.js', 'lib', 'dep');

    const hotspots = await findHotspots(dir, { days: 30 });
    assert(hotspots.every(h => !h.file.includes('node_modules')), 'should not include node_modules');
  } finally { cleanup(dir); }
});

await testAsync('returns empty for non-git directory', async () => {
  const dir = tmpGitRepo();
  try {
    writeAndCommit(dir, 'src/tracked.js', 'code', 'init');
    const nestedNonRoot = path.join(dir, 'nested-project');
    fs.mkdirSync(nestedNonRoot);

    const hotspots = await findHotspots(nestedNonRoot);
    assertEqual(hotspots.length, 0);
  } finally { cleanup(dir); }
});

await testAsync('ignores inherited Git repository overrides', async () => {
  const target = tmpGitRepo();
  const override = tmpGitRepo();
  const previousGitDir = process.env.GIT_DIR;
  const previousWorkTree = process.env.GIT_WORK_TREE;
  try {
    writeAndCommit(target, 'src/target.js', 'target\n', 'target commit');
    writeAndCommit(target, 'src/target.js', 'target\nmore\nlines\nfor\ngrowth\n', 'target growth');
    writeAndCommit(override, 'src/override.js', 'override', 'override commit');
    process.env.GIT_DIR = path.join(override, '.git');
    process.env.GIT_WORK_TREE = override;

    const hotspots = await findHotspots(target, { days: 30 });
    const complexity = await analyzeComplexityTrend(target, 'src/target.js');
    assert(hotspots.some(item => item.file === 'src/target.js'), 'should analyze the requested repository');
    assert(hotspots.every(item => item.file !== 'src/override.js'), 'should ignore inherited Git overrides');
    assertEqual(complexity.history.length, 2);
    assertEqual(complexity.trend, 'growing');
  } finally {
    if (previousGitDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = previousGitDir;
    if (previousWorkTree === undefined) delete process.env.GIT_WORK_TREE;
    else process.env.GIT_WORK_TREE = previousWorkTree;
    cleanup(target);
    cleanup(override);
  }
});

// ─── Churn Analysis ──────────────────────────────────────────────────────────

suite('CodeEvolution — Churn');

await testAsync('calculates churn correctly', async () => {
  const dir = tmpGitRepo();
  try {
    writeAndCommit(dir, 'src/app.js', 'line1\nline2\nline3\n', 'init');
    writeAndCommit(dir, 'src/app.js', 'line1\nline2_changed\nline3\nline4\nline5\n', 'modify');

    const churn = await analyzeChurn(dir, { days: 30 });
    assert(churn.length >= 1, `should find ≥1 file, got ${churn.length}`);

    const appChurn = churn.find(c => c.file === 'src/app.js');
    assert(appChurn !== undefined, 'should find src/app.js');
    assert(appChurn.churn > 0, 'churn should be > 0');
    assert(appChurn.added > 0, 'should have added lines');
  } finally { cleanup(dir); }
});

// ─── Co-Change Detection ──────────────────────────────────────────────────────

suite('CodeEvolution — Co-Changes');

await testAsync('detects files that change together', async () => {
  const dir = tmpGitRepo();
  try {
    // Create coupled files that always change together
    writeAndCommit(dir, 'src/model.js', 'v1', 'init');

    for (let i = 1; i <= 4; i++) {
      fs.writeFileSync(path.join(dir, 'src/model.js'), `v${i + 1}`);
      fs.writeFileSync(path.join(dir, 'src/controller.js'), `v${i}`);
      execSync('git add -A', { cwd: dir, stdio: 'ignore' });
      execSync(`git commit -m "pair change ${i}"`, { cwd: dir, stdio: 'ignore' });
    }

    const coChanges = await findCoChanges(dir, { days: 30, minCoChanges: 2 });
    assert(coChanges.length >= 1, `should find ≥1 co-change pair, got ${coChanges.length}`);

    const pair = coChanges[0];
    assert(
      (pair.file1.includes('model') && pair.file2.includes('controller')) ||
      (pair.file1.includes('controller') && pair.file2.includes('model')),
      'should find model ↔ controller coupling'
    );
    assert(pair.coChanges >= 2, 'should have ≥2 co-changes');
    assert(pair.coupling > 0, 'coupling should be > 0');
  } finally { cleanup(dir); }
});

// ─── Full Analysis ───────────────────────────────────────────────────────────

suite('CodeEvolution — Full Analysis');

await testAsync('analyzeEvolution returns combined results', async () => {
  const dir = tmpGitRepo();
  try {
    writeAndCommit(dir, 'src/main.js', 'code1', 'init');
    writeAndCommit(dir, 'src/main.js', 'code2', 'update');

    const result = await analyzeEvolution(dir, { days: 30 });
    assert(result.hotspots !== undefined, 'should have hotspots');
    assert(result.churn !== undefined, 'should have churn');
    assert(result.coChanges !== undefined, 'should have coChanges');
    assert(result.buildTime >= 0, 'should report build time');
  } finally { cleanup(dir); }
});

// ─── Formatting ─────────────────────────────────────────────────────────────

suite('CodeEvolution — Formatting');

test('formatEvolutionReport produces markdown', () => {
  const report = formatEvolutionReport({
    hotspots: [{ file: 'src/app.js', commits: 10, rank: 1 }],
    churn: [{ file: 'src/app.js', added: 100, removed: 50, churn: 150 }],
    coChanges: [{ file1: 'src/a.js', file2: 'src/b.js', coChanges: 5, coupling: 0.8 }],
    buildTime: 42,
  });

  assert(report.includes('## Code Evolution'), 'should have header');
  assert(report.includes('src/app.js'), 'should mention file');
  assert(report.includes('10 commits'), 'should show commit count');
  assert(report.includes('coupling'), 'should mention coupling');
});

test('formatEvolutionReport handles empty results', () => {
  const report = formatEvolutionReport({
    hotspots: [],
    churn: [],
    coChanges: [],
    buildTime: 0,
  });

  assert(report.includes('## Code Evolution'), 'should have header');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

summary();
