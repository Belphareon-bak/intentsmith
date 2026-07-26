#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runNightly } from '../scripts/nightly-orchestrator.js';

const tmp = await mkdtemp(path.join(os.tmpdir(), 'c3-nightly-orchestrator-'));

try {
  const remote = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  const artifactRoot = path.join(tmp, 'artifacts');
  const worktreeRoot = path.join(tmp, 'worktrees');

  git(['init', '--bare', remote], tmp);
  await mkdir(repo, { recursive: true });
  git(['init', '-b', 'master'], repo);
  git(['config', 'user.email', 'selftest@example.invalid'], repo);
  git(['config', 'user.name', 'C3 Self Test'], repo);
  git(['remote', 'add', 'origin', remote], repo);

  await writeFixtureRepo(repo, { preflightFails: false });
  git(['add', '.'], repo);
  git(['commit', '-m', 'fixture: passing preflight'], repo);
  git(['push', '-u', 'origin', 'master'], repo);
  git(['fetch', 'origin', 'master'], repo);

  const dryRun = await runNightly({
    repo,
    artifactRoot,
    worktreeRoot,
    runId: 'selftest-dry',
    dryRun: true,
  });
  assert.equal(dryRun.dryRun, true);
  assert.equal(dryRun.blockerPolicy.noBlock, false);
  assert.equal(dryRun.blockerPolicy.allowDirty, false);
  assert.deepEqual(dryRun.blockerPolicy.allowBlockers, []);
  assertNoUnsafeAuditFlags(dryRun.commands.audit);
  await assertMissing(path.join(worktreeRoot, 'selftest-dry'));

  await mkdir(path.join(artifactRoot, 'c3-nightly.lock'), { recursive: true });
  await writeJson(path.join(artifactRoot, 'c3-nightly.lock', 'owner.json'), { owner: 'self-test' });
  await assert.rejects(
    () => runNightly({ repo, artifactRoot, worktreeRoot, runId: 'selftest-lock' }),
    /lock is already held/,
  );
  await rm(path.join(artifactRoot, 'c3-nightly.lock'), { recursive: true, force: true });

  await seedCompletedRuns(artifactRoot, 8);
  const failingAudit = await runNightly({
    repo,
    artifactRoot,
    worktreeRoot,
    runId: 'selftest-failing-audit',
    retain: 7,
  });
  assert.equal(failingAudit.exitCode, 1);
  assert.equal(failingAudit.runnerExitCode, 1);
  assert.equal(failingAudit.summaryExitCode, 0);

  const metadata = await readJson(path.join(artifactRoot, 'runs', 'selftest-failing-audit', 'metadata.json'));
  assert.equal(metadata.candidateMode, false);
  assert.equal(metadata.blockerPolicy.noBlock, false);
  assert.equal(metadata.blockerPolicy.allowDirty, false);
  assert.deepEqual(metadata.blockerPolicy.allowBlockers, []);
  assert.equal(metadata.dependencyInstall.command, 'npm ci --legacy-peer-deps');
  assert.match(metadata.dependencyInstall.temporaryDebt, /legacy peer/i);

  const auditLog = await readFile(path.join(artifactRoot, 'runs', 'selftest-failing-audit', 'audit-runner.log'), 'utf8');
  assertNoUnsafeAuditFlags(auditLog.split(/\s+/));

  const env = await readJson(path.join(artifactRoot, 'runs', 'selftest-failing-audit', 'audit', 'product-audit', 'env.json'));
  assert.match(env.C3_DB_PATH, /runtime\/c3-nightly\.db$/);
  assert.match(env.C3_PROJECTS_DIR, /runtime\/projects$/);
  assert.match(env.C3_PORT_FILE, /runtime\/c3\.port$/);
  assert.equal(env.C3_LIFECYCLE_AUTO_COMMIT, 'false');
  assert.equal(env.C3_ENABLE_AUTONOMY, 'false');
  assert.equal(env.C3_LOG_LEVEL, 'warn');
  await assertMissing(failingAudit.paths.worktree);

  const retained = await listRunDirs(path.join(artifactRoot, 'runs'));
  assert.ok(retained.length <= 7, `expected retention <= 7, got ${retained.length}`);

  await assert.rejects(
    () => runNightly({ repo, artifactRoot, worktreeRoot, runId: 'selftest-failing-audit' }),
    /Refusing to reuse existing artifact run directory/,
  );

  await writeFixtureRepo(repo, { preflightFails: true });
  git(['add', '.'], repo);
  git(['commit', '-m', 'fixture: failing preflight'], repo);
  git(['push', 'origin', 'master'], repo);

  const preflightFailure = await runNightly({
    repo,
    artifactRoot,
    worktreeRoot,
    runId: 'selftest-preflight-fail',
  });
  assert.equal(preflightFailure.exitCode, 2);
  assert.equal(preflightFailure.preflight.ok, false);
  await assertMissing(preflightFailure.paths.worktree);
  await assertMissing(path.join(artifactRoot, 'runs', 'selftest-preflight-fail', 'audit', 'product-audit', 'report.json'));

  await assert.rejects(
    () => runNightly({ repo, artifactRoot, worktreeRoot, runId: '../bad', dryRun: true }),
    /Invalid run-id/,
  );

  console.log('nightly orchestrator self-test passed');
} finally {
  await rm(tmp, { recursive: true, force: true });
}

async function writeFixtureRepo(repo, { preflightFails }) {
  await mkdir(path.join(repo, 'scripts'), { recursive: true });
  await mkdir(path.join(repo, 'tests'), { recursive: true });

  await writeFile(path.join(repo, 'package.json'), `${JSON.stringify({
    name: 'c3-nightly-orchestrator-fixture',
    version: '1.0.0',
    type: 'module',
  }, null, 2)}\n`);
  await writeFile(path.join(repo, 'package-lock.json'), `${JSON.stringify({
    name: 'c3-nightly-orchestrator-fixture',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: 'c3-nightly-orchestrator-fixture',
        version: '1.0.0',
      },
    },
  }, null, 2)}\n`);

  await writeFile(path.join(repo, 'tests', 'harness-exit-code.test.js'), "console.log('harness ok');\n");
  await writeFile(path.join(repo, 'tests', 'nightly-audit-runner-self-test.js'), "console.log('runner ok');\n");
  await writeFile(
    path.join(repo, 'tests', 'audit-summary-self-test.js'),
    preflightFails ? "console.error('summary preflight fail'); process.exit(5);\n" : "console.log('summary ok');\n",
  );

  await writeFile(path.join(repo, 'scripts', 'nightly-audit.js'), `#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const outDir = args[args.indexOf('--out-dir') + 1];
const runId = args[args.indexOf('--run-id') + 1];
const runDir = path.join(outDir, runId);
await mkdir(runDir, { recursive: true });
await writeFile(path.join(runDir, 'env.json'), JSON.stringify({
  C3_DB_PATH: process.env.C3_DB_PATH,
  C3_PROJECTS_DIR: process.env.C3_PROJECTS_DIR,
  C3_PORT_FILE: process.env.C3_PORT_FILE,
  C3_LIFECYCLE_AUTO_COMMIT: process.env.C3_LIFECYCLE_AUTO_COMMIT,
  C3_ENABLE_AUTONOMY: process.env.C3_ENABLE_AUTONOMY,
  C3_LOG_LEVEL: process.env.C3_LOG_LEVEL,
}, null, 2));
const inventory = {
  runId,
  sourceRevision: 'fixture',
  generatedAt: new Date().toISOString(),
  counts: { unit: 3 },
  suites: [
    { path: 'tests/pass.test.js', category: 'unit', command: ['node', 'tests/pass.test.js'] },
    { path: 'tests/block.test.js', category: 'ollama-e2e', blockers: ['ollama'] },
    { path: 'tests/fail.test.js', category: 'unit', command: ['node', 'tests/fail.test.js'] }
  ]
};
const report = {
  runId,
  sourceRevision: 'fixture',
  startedAt: new Date().toISOString(),
  endedAt: new Date().toISOString(),
  inventory: { total: 3, counts: { unit: 2, 'ollama-e2e': 1 } },
  results: [
    { path: 'tests/pass.test.js', category: 'unit', command: ['node', 'tests/pass.test.js'], status: 'PASS', exitCode: 0, required: true, logPath: 'logs/pass.log' },
    { path: 'tests/block.test.js', category: 'ollama-e2e', command: ['node', 'tests/block.test.js'], status: 'BLOCKED', exitCode: null, required: false, blockers: ['ollama'], logPath: 'logs/block.log' },
    { path: 'tests/fail.test.js', category: 'unit', command: ['node', 'tests/fail.test.js'], status: 'FAIL', exitCode: 1, required: true, logPath: 'logs/fail.log' }
  ]
};
await mkdir(path.join(runDir, 'logs'), { recursive: true });
await writeFile(path.join(runDir, 'logs', 'fail.log'), 'AssertionError: fixture failure\\\\n');
await writeFile(path.join(runDir, 'inventory.json'), JSON.stringify(inventory, null, 2));
await writeFile(path.join(runDir, 'checkpoint.json'), JSON.stringify(report, null, 2));
await writeFile(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2));
process.exitCode = 1;
`);

  await writeFile(path.join(repo, 'scripts', 'audit-summary.js'), `#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const input = args[0];
const out = args[args.indexOf('--out') + 1];
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, JSON.stringify({
  input,
  statusCounts: { PASS: 1, FAIL: 1, BLOCKED: 1 },
  failures: { total: 1, clusters: [{ signature: 'AssertionError: fixture failure', count: 1 }] }
}, null, 2));
`);
}

async function seedCompletedRuns(artifactRoot, count) {
  for (let i = 0; i < count; i++) {
    const runDir = path.join(artifactRoot, 'runs', `old-${i}`);
    await mkdir(runDir, { recursive: true });
    await writeJson(path.join(runDir, 'metadata.json'), {
      orchestrator: 'c3-nightly-orchestrator',
      runId: `old-${i}`,
      endedAt: `2026-07-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
    });
  }
}

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed\n${result.stderr || result.stdout}`);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function assertMissing(targetPath) {
  await assert.rejects(() => readFile(targetPath), /ENOENT|EISDIR/);
}

async function listRunDirs(root) {
  const { readdir } = await import('node:fs/promises');
  try {
    return await readdir(root);
  } catch {
    return [];
  }
}

function assertNoUnsafeAuditFlags(values) {
  const text = Array.isArray(values) ? values.join(' ') : String(values);
  assert.equal(text.includes('--no-block'), false);
  assert.equal(text.includes('--allow-dirty'), false);
  assert.equal(text.includes('--allow-blocker'), false);
}
