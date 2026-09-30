#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import './harness.js';
import { assertSafeSandbox } from '../scripts/workspace-budget.mjs';

const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(SOURCE_ROOT, 'scripts', 'workspace-budget.mjs');
const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'intentsmith workspace-budget '));
const repo = path.join(fixtureRoot, 'repo with spaces');
const cleanPath = path.join(fixtureRoot, 'clean old\nnewline');
const dirtyPath = path.join(fixtureRoot, 'dirty old');
const activePath = path.join(fixtureRoot, 'active old');
const evidencePath = path.join(fixtureRoot, 'evidence old');
const directExpertisePath = path.join(fixtureRoot, 'direct expertise old');
const directValuePath = path.join(fixtureRoot, 'direct value old');
const directAcceptancePath = path.join(fixtureRoot, 'direct acceptance old');
const detachedPath = path.join(fixtureRoot, 'detached old');
let activeProcess = null;
let passed = 0;

function git(cwd, args) {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

function run(args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  return result;
}

function check(name, callback) {
  callback();
  passed += 1;
  process.stdout.write(`  ✅ ${name}\n`);
}

try {
  mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-b', 'main']);
  git(repo, ['config', 'user.email', 'workspace-budget@example.invalid']);
  git(repo, ['config', 'user.name', 'Workspace Budget Test']);
  writeFileSync(path.join(repo, '.gitignore'), '.intentsmith-artifacts/\n');
  writeFileSync(path.join(repo, 'tracked.txt'), 'base\n');
  git(repo, ['add', '.gitignore', 'tracked.txt']);
  git(repo, ['commit', '-m', 'base']);
  const base = git(repo, ['rev-parse', 'HEAD']);

  for (const branch of ['clean-old', 'dirty-old', 'active-old', 'evidence-old',
    'direct-expertise-old', 'direct-value-old', 'direct-acceptance-old']) {
    git(repo, ['branch', branch, base]);
  }
  git(repo, ['worktree', 'add', cleanPath, 'clean-old']);
  git(repo, ['worktree', 'add', dirtyPath, 'dirty-old']);
  git(repo, ['worktree', 'add', activePath, 'active-old']);
  git(repo, ['worktree', 'add', evidencePath, 'evidence-old']);
  git(repo, ['worktree', 'add', directExpertisePath, 'direct-expertise-old']);
  git(repo, ['worktree', 'add', directValuePath, 'direct-value-old']);
  git(repo, ['worktree', 'add', directAcceptancePath, 'direct-acceptance-old']);
  git(repo, ['worktree', 'add', '--detach', detachedPath, base]);

  writeFileSync(path.join(repo, 'tracked.txt'), 'base\nnew main\n');
  git(repo, ['commit', '-am', 'descendant']);
  writeFileSync(path.join(dirtyPath, 'untracked.txt'), 'foreign dirt\n');
  mkdirSync(path.join(evidencePath, '.intentsmith-artifacts', 'run', 'logs'), { recursive: true });
  writeFileSync(
    path.join(evidencePath, '.intentsmith-artifacts', 'run', 'logs', 'suite.log'),
    'evidence\n',
  );
  // The original evidence matcher recognized report.json and logs, but missed
  // these real direct-test artifact shapes and the SQLite runtime they attest.
  const expertiseArtifact = path.join(directExpertisePath, '.intentsmith-artifacts',
    'direct-tests', 'chat-project-expertise-model-contract.test-9Huv6r',
    'artifacts', 'chat-project-expertise-model-contract.json');
  const valueArtifact = path.join(directValuePath, '.intentsmith-artifacts',
    'direct-tests', 'chat-value-fidelity-contract.test-5Z9ziT',
    'artifacts', 'chat-value-fidelity-contract.json');
  const valueRuntime = path.join(directValuePath, '.intentsmith-artifacts',
    'direct-tests', 'chat-value-fidelity-contract.test-5Z9ziT', 'runtime');
  const valueDatabase = path.join(valueRuntime, 'intentsmith-test.sqlite');
  const newerValueRuntime = path.join(directValuePath, '.intentsmith-artifacts',
    'direct-tests', 'newer-direct-test', 'runtime');
  const acceptanceArtifact = path.join(directAcceptancePath, '.intentsmith-artifacts',
    'direct-tests', 'chat-value-fidelity-contract.test-LQ5PKL',
    'artifacts', 'chat-value-fidelity-contract.json');
  for (const artifact of [expertiseArtifact, valueArtifact, acceptanceArtifact]) {
    mkdirSync(path.dirname(artifact), { recursive: true });
    writeFileSync(artifact, '{"status":"PASS","sourceRevision":"fixture"}\n');
  }
  mkdirSync(valueRuntime, { recursive: true });
  mkdirSync(newerValueRuntime, { recursive: true });
  writeFileSync(valueDatabase, 'SQLite fixture evidence');
  writeFileSync(path.join(newerValueRuntime, 'state.bin'), 'newer scratch');
  mkdirSync(path.join(cleanPath, '.intentsmith-artifacts'), { recursive: true });
  const directNow = Date.now() / 1000;
  utimesSync(valueRuntime, directNow - 300, directNow - 300);
  utimesSync(newerValueRuntime, directNow - 100, directNow - 100);

  activeProcess = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    cwd: activePath,
    stdio: 'ignore',
  });
  await new Promise(resolve => setTimeout(resolve, 100));

  const report = JSON.parse(run(['report', '--repo', repo, '--json']).stdout);
  const byBranch = new Map(report.rows.map(row => [row.branch, row]));

  check('porcelain -z keeps spaces, newline paths and detached worktrees exact', () => {
    assert.equal(report.worktreeCount, 9);
    assert.equal(byBranch.get('clean-old').path, cleanPath);
    assert.equal(report.rows.filter(row => row.branch === null).length, 1);
    assert(byBranch.get(null).reasons.includes('detached'));
  });
  check('only clean process-free evidence-free absorbed checkout is retirable', () => {
    assert.deepEqual(report.rows.filter(row => row.retirable).map(row => row.branch), ['clean-old']);
    assert.equal(byBranch.get('clean-old').absorbedBy, 'main');
  });
  check('dirty absorbed checkout is protected', () => {
    assert(byBranch.get('dirty-old').reasons.includes('dirty'));
    assert.equal(byBranch.get('dirty-old').retirable, false);
  });
  check('live process cwd protects an absorbed checkout', () => {
    assert.equal(byBranch.get('active-old').inUse, true);
    assert(byBranch.get('active-old').reasons.includes('in-use'));
  });
  check('uncommitted gate evidence protects an absorbed checkout', () => {
    assert.equal(byBranch.get('evidence-old').containsEvidence, true);
    assert(byBranch.get('evidence-old').reasons.includes('evidence'));
  });
  check('three clean absorbed direct-test evidence roots are not retirable', () => {
    for (const branch of ['direct-expertise-old', 'direct-value-old', 'direct-acceptance-old']) {
      const row = byBranch.get(branch);
      assert.equal(row.dirty, false);
      assert.equal(row.absorbedBy, 'main');
      assert.equal(row.containsEvidence, true, branch);
      assert.equal(row.retirable, false, branch);
      assert(row.reasons.includes('evidence'), branch);
    }
    assert.equal(byBranch.get('clean-old').containsEvidence, false,
      'an empty ignored artifact root must remain safe to retire');
  });

  const artifactRoot = path.join(repo, '.intentsmith-artifacts');
  const oldRuntime = path.join(artifactRoot, 'run-old', 'runtime');
  const evidenceRuntime = path.join(artifactRoot, 'run-evidence', 'runtime');
  const newRuntime = path.join(artifactRoot, 'run-new', 'runtime');
  const outside = path.join(fixtureRoot, 'outside-runtime');
  const escapedLink = path.join(artifactRoot, 'run-link', 'runtime');
  const cacheRuntime = path.join(artifactRoot, 'run-old', 'toolchain', 'gomodcache', 'protobuf@1', 'runtime');
  const sourceRuntime = path.join(artifactRoot, 'run-old', 'source', 'src', 'runtime');
  mkdirSync(oldRuntime, { recursive: true });
  mkdirSync(evidenceRuntime, { recursive: true });
  mkdirSync(newRuntime, { recursive: true });
  mkdirSync(outside, { recursive: true });
  mkdirSync(cacheRuntime, { recursive: true });
  mkdirSync(sourceRuntime, { recursive: true });
  writeFileSync(path.join(cacheRuntime, 'source.go'), 'package runtime\n');
  writeFileSync(path.join(sourceRuntime, 'source.js'), 'export const value = true;\n');
  mkdirSync(path.dirname(escapedLink), { recursive: true });
  writeFileSync(path.join(oldRuntime, 'state.bin'), 'old');
  writeFileSync(path.join(evidenceRuntime, 'report.json'), '{"verdict":"FAIL"}\n');
  writeFileSync(path.join(newRuntime, 'state.bin'), 'new');
  symlinkSync(outside, escapedLink, 'dir');
  const now = Date.now() / 1000;
  utimesSync(oldRuntime, now - 300, now - 300);
  utimesSync(evidenceRuntime, now - 200, now - 200);
  utimesSync(newRuntime, now - 100, now - 100);

  const dryRun = JSON.parse(run(['clean', '--repo', repo, '--json']).stdout);
  check('direct-test SQLite is protected even when a newer sandbox exists', () => {
    assert(dryRun.protected.some(item => item.path === valueRuntime
      && item.reasons.includes('evidence')));
    assert(!dryRun.removable.includes(valueRuntime));
    assert.throws(() => assertSafeSandbox(directValuePath, valueRuntime, []),
      /sandbox contains protected evidence/);
  });
  check('clean defaults to a non-mutating dry run', () => {
    assert.equal(dryRun.outcome, 'DRY_RUN');
    assert(dryRun.removable.includes(oldRuntime));
    assert(existsSync(oldRuntime));
    assert(!dryRun.removable.includes(cacheRuntime));
    assert(!dryRun.removable.includes(sourceRuntime));
    assert.throws(() => assertSafeSandbox(repo, cacheRuntime, []), /unsafe sandbox target/);
    assert.throws(() => assertSafeSandbox(repo, sourceRuntime, []), /unsafe sandbox target/);
  });
  check('newest sandbox and evidence-bearing sandbox are retained', () => {
    assert(dryRun.kept.includes(newRuntime));
    assert(dryRun.protected.some(item => item.path === evidenceRuntime));
  });

  const applied = JSON.parse(run(['clean', '--yes', '--repo', repo, '--json']).stdout);
  check('explicit clean removes only the prevalidated old sandbox', () => {
    assert(applied.removed.includes(oldRuntime));
    assert.equal(existsSync(oldRuntime), false);
    assert.equal(existsSync(newRuntime), true);
  });
  check('cleanup preserves evidence bytes and ignores symlink escape', () => {
    assert.equal(existsSync(path.join(evidenceRuntime, 'report.json')), true);
    assert.equal(existsSync(escapedLink), true);
    assert.equal(existsSync(outside), true);
    assert.equal(existsSync(path.join(cacheRuntime, 'source.go')), true);
    assert.equal(existsSync(path.join(sourceRuntime, 'source.js')), true);
    assert.equal(existsSync(expertiseArtifact), true);
    assert.equal(existsSync(valueArtifact), true);
    assert.equal(existsSync(valueDatabase), true);
    assert.equal(existsSync(acceptanceArtifact), true);
  });
  check('malformed invocation and non-Git repository fail closed', () => {
    run(['report', '--yes', '--repo', repo], 2);
    run(['report', '--unknown', '--repo', repo], 2);
    run(['report', '--repo', '/proc'], 2);
  });

  process.stdout.write(`workspace budget: ${passed}/${passed} PASS\n`);
} finally {
  activeProcess?.kill('SIGTERM');
  rmSync(fixtureRoot, { recursive: true, force: true });
}
