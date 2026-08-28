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

const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(SOURCE_ROOT, 'scripts', 'workspace-budget.mjs');
const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'intentsmith workspace-budget '));
const repo = path.join(fixtureRoot, 'repo with spaces');
const cleanPath = path.join(fixtureRoot, 'clean old\nnewline');
const dirtyPath = path.join(fixtureRoot, 'dirty old');
const activePath = path.join(fixtureRoot, 'active old');
const evidencePath = path.join(fixtureRoot, 'evidence old');
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

  for (const branch of ['clean-old', 'dirty-old', 'active-old', 'evidence-old']) {
    git(repo, ['branch', branch, base]);
  }
  git(repo, ['worktree', 'add', cleanPath, 'clean-old']);
  git(repo, ['worktree', 'add', dirtyPath, 'dirty-old']);
  git(repo, ['worktree', 'add', activePath, 'active-old']);
  git(repo, ['worktree', 'add', evidencePath, 'evidence-old']);
  git(repo, ['worktree', 'add', '--detach', detachedPath, base]);

  writeFileSync(path.join(repo, 'tracked.txt'), 'base\nnew main\n');
  git(repo, ['commit', '-am', 'descendant']);
  writeFileSync(path.join(dirtyPath, 'untracked.txt'), 'foreign dirt\n');
  mkdirSync(path.join(evidencePath, '.intentsmith-artifacts', 'run', 'logs'), { recursive: true });
  writeFileSync(
    path.join(evidencePath, '.intentsmith-artifacts', 'run', 'logs', 'suite.log'),
    'evidence\n',
  );

  activeProcess = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    cwd: activePath,
    stdio: 'ignore',
  });
  await new Promise(resolve => setTimeout(resolve, 100));

  const report = JSON.parse(run(['report', '--repo', repo, '--json']).stdout);
  const byBranch = new Map(report.rows.map(row => [row.branch, row]));

  check('porcelain -z keeps spaces, newline paths and detached worktrees exact', () => {
    assert.equal(report.worktreeCount, 6);
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

  const artifactRoot = path.join(repo, '.intentsmith-artifacts');
  const oldRuntime = path.join(artifactRoot, 'run-old', 'runtime');
  const evidenceRuntime = path.join(artifactRoot, 'run-evidence', 'runtime');
  const newRuntime = path.join(artifactRoot, 'run-new', 'runtime');
  const outside = path.join(fixtureRoot, 'outside-runtime');
  const escapedLink = path.join(artifactRoot, 'run-link', 'runtime');
  mkdirSync(oldRuntime, { recursive: true });
  mkdirSync(evidenceRuntime, { recursive: true });
  mkdirSync(newRuntime, { recursive: true });
  mkdirSync(outside, { recursive: true });
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
  check('clean defaults to a non-mutating dry run', () => {
    assert.equal(dryRun.outcome, 'DRY_RUN');
    assert(dryRun.removable.includes(oldRuntime));
    assert(existsSync(oldRuntime));
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
  });
  check('malformed invocation and non-Git repository fail closed', () => {
    run(['report', '--yes', '--repo', repo], 2);
    run(['report', '--unknown', '--repo', repo], 2);
    run(['report', '--repo', fixtureRoot], 2);
  });

  process.stdout.write(`workspace budget: ${passed}/${passed} PASS\n`);
} finally {
  activeProcess?.kill('SIGTERM');
  rmSync(fixtureRoot, { recursive: true, force: true });
}
