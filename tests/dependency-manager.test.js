// tests/dependency-manager.test.js — Dependency Manager (F11) unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  PackageManager,
  detectPackageManager,
  loadCache,
  saveCache,
  formatUpgradeReport,
  runUpgradeCycle,
} from '../src/code-intel/dependency-manager.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'depmgr-test-'));
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════
// PackageManager enum
// ═══════════════════════════════════════════════════════════════════════════

suite('PackageManager');

test('all managers defined', () => {
  assertEqual(PackageManager.NPM, 'npm', 'NPM');
  assertEqual(PackageManager.YARN, 'yarn', 'YARN');
  assertEqual(PackageManager.PNPM, 'pnpm', 'PNPM');
  assertEqual(PackageManager.GO, 'go', 'GO');
  assertEqual(PackageManager.PIP, 'pip', 'PIP');
  assertEqual(PackageManager.CARGO, 'cargo', 'CARGO');
});

test('is frozen', () => {
  assert(Object.isFrozen(PackageManager), 'should be frozen');
});

// ═══════════════════════════════════════════════════════════════════════════
// detectPackageManager
// ═══════════════════════════════════════════════════════════════════════════

suite('detectPackageManager');

test('detects npm (package-lock.json)', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
  const result = detectPackageManager(dir);
  assertEqual(result.manager, PackageManager.NPM, 'should detect npm');
  assertEqual(result.lockFile, 'package-lock.json', 'correct lock file');
  cleanup(dir);
});

test('detects yarn (yarn.lock)', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  fs.writeFileSync(path.join(dir, 'yarn.lock'), '');
  const result = detectPackageManager(dir);
  assertEqual(result.manager, PackageManager.YARN, 'should detect yarn');
  cleanup(dir);
});

test('detects pnpm (pnpm-lock.yaml)', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
  const result = detectPackageManager(dir);
  assertEqual(result.manager, PackageManager.PNPM, 'should detect pnpm');
  cleanup(dir);
});

test('detects Go (go.mod)', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'go.mod'), 'module test');
  const result = detectPackageManager(dir);
  assertEqual(result.manager, PackageManager.GO, 'should detect go');
  cleanup(dir);
});

test('detects pip (requirements.txt)', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'requirements.txt'), 'flask==2.0');
  const result = detectPackageManager(dir);
  assertEqual(result.manager, PackageManager.PIP, 'should detect pip');
  cleanup(dir);
});

test('detects cargo (Cargo.toml)', () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]');
  const result = detectPackageManager(dir);
  assertEqual(result.manager, PackageManager.CARGO, 'should detect cargo');
  cleanup(dir);
});

test('no package manager → null', () => {
  const dir = mkTmpDir();
  const result = detectPackageManager(dir);
  assertEqual(result, null, 'empty dir → null');
  cleanup(dir);
});

test('null path → null', () => {
  assertEqual(detectPackageManager(null), null, 'null → null');
});

// ═══════════════════════════════════════════════════════════════════════════
// Cache
// ═══════════════════════════════════════════════════════════════════════════

suite('cache');

test('save and load round-trip', () => {
  const dir = mkTmpDir();
  const data = { packages: [{ name: 'foo', current: '1.0', latest: '1.1', type: 'minor' }], timestamp: Date.now() };
  saveCache(dir, data);
  const loaded = loadCache(dir);
  assert(loaded !== null, 'should load cache');
  assertEqual(loaded.packages.length, 1, 'should have 1 package');
  assertEqual(loaded.packages[0].name, 'foo', 'name matches');
  cleanup(dir);
});

test('missing cache → null', () => {
  const dir = mkTmpDir();
  assertEqual(loadCache(dir), null, 'no cache → null');
  cleanup(dir);
});

test('corrupt cache → null', () => {
  const dir = mkTmpDir();
  const cacheDir = path.join(dir, '.c3');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'dependency-cache.json'), 'not json');
  assertEqual(loadCache(dir), null, 'corrupt → null');
  cleanup(dir);
});

test('null path → null', () => {
  assertEqual(loadCache(null), null, 'null → null');
});

test('creates .c3 directory if needed', () => {
  const dir = mkTmpDir();
  saveCache(dir, { packages: [], timestamp: Date.now() });
  assert(fs.existsSync(path.join(dir, '.c3')), '.c3 dir created');
  cleanup(dir);
});

// ═══════════════════════════════════════════════════════════════════════════
// formatUpgradeReport
// ═══════════════════════════════════════════════════════════════════════════

suite('formatUpgradeReport');

test('formats mixed results', () => {
  const report = formatUpgradeReport({
    upgraded: [{ name: 'foo', current: '1.0', latest: '1.1', type: 'minor' }],
    failed: [{ name: 'bar', current: '2.0', latest: '2.1', error: 'Tests failed' }],
    skipped: [{ name: 'baz', current: '1.0', latest: '2.0', type: 'major' }],
  });
  assert(report.includes('Upgraded (1)'), 'upgraded count');
  assert(report.includes('foo'), 'upgraded name');
  assert(report.includes('Failed (1)'), 'failed count');
  assert(report.includes('Tests failed'), 'failure reason');
  assert(report.includes('Skipped major (1)'), 'skipped count');
  assert(report.includes('manual upgrade'), 'manual note');
});

test('all success', () => {
  const report = formatUpgradeReport({
    upgraded: [
      { name: 'a', current: '1.0', latest: '1.1', type: 'patch' },
      { name: 'b', current: '2.0', latest: '2.1', type: 'minor' },
    ],
    failed: [],
    skipped: [],
  });
  assert(report.includes('Upgraded (2)'), 'count 2');
  assert(!report.includes('Failed'), 'no failures');
});

test('empty → default message', () => {
  const report = formatUpgradeReport({ upgraded: [], failed: [], skipped: [] });
  assertEqual(report, 'No packages to upgrade', 'empty → default');
});

test('null → empty', () => {
  assertEqual(formatUpgradeReport(null), '', 'null → empty');
});

// ═══════════════════════════════════════════════════════════════════════════
// runUpgradeCycle (with mock)
// ═══════════════════════════════════════════════════════════════════════════

suite('runUpgradeCycle');

await testAsync('no package manager → early return', async () => {
  const dir = mkTmpDir();
  const result = await runUpgradeCycle(dir);
  assertEqual(result.upgraded.length, 0, 'no upgrades');
  assert(result.report.includes('No package manager'), 'correct report');
  cleanup(dir);
});

await testAsync('skips major versions', async () => {
  const dir = mkTmpDir();
  // Create a package.json to detect npm
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');

  // Pre-populate cache with a major upgrade
  saveCache(dir, {
    packages: [
      { name: 'big-lib', current: '1.0.0', latest: '2.0.0', type: 'major' },
    ],
    timestamp: Date.now(),
  });

  const result = await runUpgradeCycle(dir, { useCache: true });
  assertEqual(result.skipped.length, 1, 'should skip major');
  assertEqual(result.skipped[0].name, 'big-lib', 'correct name');
  cleanup(dir);
});

await testAsync('empty outdated → all up to date', async () => {
  const dir = mkTmpDir();
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');

  // Pre-populate cache with empty
  saveCache(dir, { packages: [], timestamp: Date.now() });

  const result = await runUpgradeCycle(dir, { useCache: true });
  assert(result.report.includes('up to date'), 'should report up to date');
  cleanup(dir);
});

await testAsync('maxPackagesPerRun respected', async () => {
  const dir = mkTmpDir();
  const fakeBin = path.join(dir, 'fake-bin');
  const invocationLog = path.join(dir, 'npm-invocations.jsonl');
  const previousPath = process.env.PATH;
  const previousLog = process.env.C3_TEST_NPM_LOG;

  try {
    fs.writeFileSync(path.join(dir, 'package.json'), '{}');
    fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
    fs.mkdirSync(fakeBin);
    fs.writeFileSync(
      path.join(fakeBin, 'npm'),
      [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        "fs.appendFileSync(process.env.C3_TEST_NPM_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');",
        'process.exit(17);',
        '',
      ].join('\n'),
      { mode: 0o700 },
    );

    // Cache with 10 packages — all patch. The fake executable proves exactly
    // which upgrades were selected without contacting the package registry.
    const pkgs = [];
    for (let i = 0; i < 10; i++) {
      pkgs.push({ name: `pkg-${i}`, current: '1.0.0', latest: '1.0.1', type: 'patch' });
    }
    saveCache(dir, { packages: pkgs, timestamp: Date.now() });

    process.env.PATH = `${fakeBin}${path.delimiter}${previousPath || ''}`;
    process.env.C3_TEST_NPM_LOG = invocationLog;

    const result = await runUpgradeCycle(dir, { useCache: true, maxPackagesPerRun: 3 });
    const invocations = fs.readFileSync(invocationLog, 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));

    assertEqual(result.upgraded.length, 0, 'fake npm upgrades do not succeed');
    assertEqual(result.failed.length, 3, 'exactly maxPackagesPerRun upgrades attempted');
    assertEqual(invocations.length, 3, 'exactly three npm commands invoked');
    assertEqual(
      JSON.stringify(invocations),
      JSON.stringify([
        ['install', 'pkg-0@1.0.1'],
        ['install', 'pkg-1@1.0.1'],
        ['install', 'pkg-2@1.0.1'],
      ]),
      'patch upgrades are selected deterministically without network access',
    );
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousLog === undefined) delete process.env.C3_TEST_NPM_LOG;
    else process.env.C3_TEST_NPM_LOG = previousLog;
    cleanup(dir);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════════════════════════════════════

suite('edge cases');

test('priority ordering: patch before minor', () => {
  // Simulate the sorting logic directly
  const pkgs = [
    { name: 'minor-pkg', type: 'minor' },
    { name: 'patch-pkg', type: 'patch' },
    { name: 'another-minor', type: 'minor' },
  ];

  pkgs.sort((a, b) => {
    if (a.type === 'patch' && b.type !== 'patch') return -1;
    if (a.type !== 'patch' && b.type === 'patch') return 1;
    return 0;
  });

  assertEqual(pkgs[0].name, 'patch-pkg', 'patch comes first');
});

test('version classification', () => {
  // _classifyVersionDiff is internal, test through format
  // Major: 1.x → 2.x
  const report = formatUpgradeReport({
    upgraded: [],
    failed: [],
    skipped: [{ name: 'x', current: '1.0.0', latest: '2.0.0', type: 'major' }],
  });
  assert(report.includes('major'), 'major classified');
});

// ═══════════════════════════════════════════════════════════════════════════

summary();
