#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runAudit } from '../scripts/nightly-audit.js';

const root = await mkdtemp(path.join(os.tmpdir(), 'c3-audit-runner-'));
const testsDir = path.join(root, 'tests');
await mkdir(testsDir, { recursive: true });

await writeFile(path.join(testsDir, 'pass.test.js'), `
import { writeFileSync } from 'node:fs';
import path from 'node:path';
writeFileSync(path.join(process.env.TMPDIR, 'observed-env.json'), JSON.stringify({
  HOME: process.env.HOME,
  C3_DB_PATH: process.env.C3_DB_PATH,
  TEST_SECRET_SENTINEL: process.env.TEST_SECRET_SENTINEL,
}));
console.log("fixture pass");
`);
await writeFile(path.join(testsDir, 'fail.test.js'), 'console.error("fixture fail"); process.exit(7);\n');
await writeFile(path.join(testsDir, 'test_flush.py'), `
for i in range(2000):
    print(f"flush-line-{i}")
print("FLUSH_MARKER_END")
`);
await writeFile(path.join(testsDir, 'timeout.test.js'), 'setTimeout(() => {}, 5000);\n');
await writeFile(path.join(testsDir, 'ignore-term.test.js'), `
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
`);
await writeFile(path.join(testsDir, 'spawn-child.test.js'), `
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{}); setInterval(()=>{},1000);'], { stdio: 'ignore' });
writeFileSync('child.pid', String(child.pid));
setInterval(() => {}, 1000);
`);
await writeFixtureRegistry(root, [
  'tests/fail.test.js',
  'tests/ignore-term.test.js',
  'tests/pass.test.js',
  'tests/spawn-child.test.js',
  'tests/test_flush.py',
  'tests/timeout.test.js',
]);

const dryRun = await runAudit({
  root,
  outDir: 'data/artifacts/audit-runs',
  runId: 'self-test-dry-run',
  dryRun: true,
  noBlock: true,
});

assert.equal(dryRun.dryRun, true);
assert.equal(dryRun.inventory.total, 6);
assert.deepEqual(dryRun.statusCounts, {
  PASS: 0,
  FAIL: 0,
  TIMEOUT: 0,
  BLOCKED: 0,
  SKIPPED: 0,
});

const selectedDryRun = await runAudit({
  root,
  outDir: 'data/artifacts/audit-runs',
  runId: 'self-test-selected-dry-run',
  dryRun: true,
  ids: new Set(['IS-T1-SELF-003']),
});
assert.equal(selectedDryRun.inventory.total, 1);
assert.equal(selectedDryRun.results.length, 0);

await assert.rejects(
  () => runAudit({
    root,
    outDir: 'data/artifacts/audit-runs',
    runId: 'self-test-unknown-id',
    dryRun: true,
    ids: new Set(['IS-T1-NOT-REGISTERED']),
  }),
  /Unknown test suite id/,
);

process.env.TEST_SECRET_SENTINEL = 'must-not-reach-child';
const run = await runAudit({
  root,
  outDir: 'data/artifacts/audit-runs',
  runId: 'self-test-execution',
  timeoutMs: 250,
  deadlineMs: 15_000,
  concurrency: 1,
  noBlock: true,
  allowDirty: true,
});
delete process.env.TEST_SECRET_SENTINEL;

assert.equal(run.inventory.total, 6);
assert.equal(run.statusCounts.PASS, 2);
assert.equal(run.statusCounts.FAIL, 2);
assert.equal(run.statusCounts.TIMEOUT, 2);
assert.equal(run.requiredFailureCount, 4);
assert.equal(run.verdict, 'FAIL');
assert.equal(run.exitCode, 1);

const byPath = new Map(run.results.map(result => [result.path, result]));
assert.equal(byPath.get('tests/pass.test.js')?.status, 'PASS');
assert.equal(byPath.get('tests/test_flush.py')?.status, 'PASS');
assert.equal(byPath.get('tests/fail.test.js')?.status, 'FAIL');
assert.equal(byPath.get('tests/fail.test.js')?.exitCode, 7);
assert.equal(byPath.get('tests/timeout.test.js')?.status, 'TIMEOUT');
assert.equal(byPath.get('tests/ignore-term.test.js')?.status, 'TIMEOUT');
assert.equal(byPath.get('tests/spawn-child.test.js')?.status, 'FAIL');
assert.equal(byPath.get('tests/spawn-child.test.js')?.cleanup.leakDetected, true);
assert.equal(byPath.get('tests/spawn-child.test.js')?.cleanup.terminated, true);

for (const result of run.results) {
  assert.equal(result.retryCount, 0);
  assert.ok(result.start);
  assert.ok(result.end);
  assert.ok(result.durationMs >= 0);
  assert.equal(result.sourceRevision, 'unknown');
  assert.ok(result.logPath);
  await readFile(path.join(root, result.logPath), 'utf8');
}
const flushLog = await readFile(path.join(root, byPath.get('tests/test_flush.py').logPath), 'utf8');
assert.match(flushLog, /FLUSH_MARKER_END/);
const observedEnv = JSON.parse(await readFile(
  path.join(byPath.get('tests/pass.test.js').environment.temp, 'observed-env.json'),
  'utf8',
));
assert.equal(observedEnv.HOME, byPath.get('tests/pass.test.js').environment.home);
assert.equal(observedEnv.C3_DB_PATH, byPath.get('tests/pass.test.js').environment.database);
assert.equal(observedEnv.TEST_SECRET_SENTINEL, undefined);
assert.equal(new Set(run.results.map(result => result.environment?.database).filter(Boolean)).size, 6);
assert.equal((await stat(path.join(root, run.paths.report))).mode & 0o777, 0o600);

await readFile(path.join(root, dryRun.paths.report), 'utf8');
await readFile(path.join(root, run.paths.report), 'utf8');
await readFile(path.join(root, run.paths.checkpoint), 'utf8');

await assert.rejects(
  () => runAudit({
    root,
    outDir: 'data/artifacts/audit-runs',
    runId: 'self-test-execution',
    timeoutMs: 250,
    deadlineMs: 15_000,
    concurrency: 1,
    noBlock: true,
    allowDirty: true,
  }),
  /Run id already exists/
);

const resumed = await runAudit({
  root,
  outDir: 'data/artifacts/audit-runs',
  runId: 'self-test-execution',
  timeoutMs: 250,
  deadlineMs: 15_000,
  concurrency: 1,
  noBlock: true,
  allowDirty: true,
  resume: true,
});
assert.equal(resumed.results.length, 6);

const passResult = byPath.get('tests/pass.test.js');
const passLogPath = path.join(root, passResult.logPath);
const originalPassLog = await readFile(passLogPath, 'utf8');
await writeFile(passLogPath, `${originalPassLog}\ntampered\n`);
await assert.rejects(
  () => runAudit({
    root,
    outDir: 'data/artifacts/audit-runs',
    runId: 'self-test-execution',
    timeoutMs: 250,
    deadlineMs: 15_000,
    concurrency: 1,
    noBlock: true,
    allowDirty: true,
    resume: true,
  }),
  /log evidence hash mismatch/,
);
await writeFile(passLogPath, originalPassLog);

await assert.rejects(
  () => runAudit({
    root,
    outDir: 'data/artifacts/audit-runs',
    runId: 'self-test-execution',
    timeoutMs: 251,
    deadlineMs: 15_000,
    concurrency: 1,
    noBlock: true,
    allowDirty: true,
    resume: true,
  }),
  /option fingerprint mismatch/
);

await assert.rejects(
  () => runAudit({
    root,
    outDir: 'data/artifacts/audit-runs',
    runId: '../unsafe',
    dryRun: true,
    noBlock: true,
  }),
  /Invalid run-id/
);

const dirtyGuardRoot = await mkdtemp(path.join(os.tmpdir(), 'c3-audit-runner-dirty-'));
await mkdir(path.join(dirtyGuardRoot, 'tests'), { recursive: true });
await writeFile(path.join(dirtyGuardRoot, 'tests', 'pass.test.js'), 'console.log("dirty fixture");\n');
await writeFixtureRegistry(dirtyGuardRoot, ['tests/pass.test.js']);
const gitInit = spawnSync('git', ['init'], { cwd: dirtyGuardRoot, encoding: 'utf8' });
assert.equal(gitInit.status, 0, gitInit.stderr);
await assert.rejects(
  () => runAudit({
    root: dirtyGuardRoot,
    outDir: 'data/artifacts/audit-runs',
    runId: 'dirty-default-reject',
    noBlock: true,
  }),
  /clean git worktree/
);

await writeFile(path.join(dirtyGuardRoot, '.gitignore'), 'data/\n');
for (const args of [
  ['config', 'user.email', 'runner-self-test@example.invalid'],
  ['config', 'user.name', 'IntentSmith Runner Self Test'],
  ['add', '.'],
  ['commit', '-m', 'fixture: clean runner source'],
]) {
  const result = spawnSync('git', args, { cwd: dirtyGuardRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
const cleanGuardRun = await runAudit({
  root: dirtyGuardRoot,
  outDir: 'data/artifacts/audit-runs',
  runId: 'clean-source-evidence',
  noBlock: true,
});
assert.equal(cleanGuardRun.verdict, 'PASS');
assert.equal(cleanGuardRun.results[0].sourceTree.checked, true);
assert.equal(cleanGuardRun.results[0].sourceTree.clean, true);
assert.equal(cleanGuardRun.results[0].cleanup.checked, true);
assert.equal(cleanGuardRun.results[0].cleanup.terminated, true);

const failFastRoot = await mkdtemp(path.join(os.tmpdir(), 'c3-audit-runner-failfast-'));
await mkdir(path.join(failFastRoot, 'tests'), { recursive: true });
await writeFile(path.join(failFastRoot, 'tests', 'a-fail.test.js'), 'process.exit(9);\n');
await writeFile(path.join(failFastRoot, 'tests', 'z-pass.test.js'), 'console.log("late pass");\n');
await writeFixtureRegistry(failFastRoot, ['tests/a-fail.test.js', 'tests/z-pass.test.js']);
const failFastRun = await runAudit({
  root: failFastRoot,
  outDir: 'data/artifacts/audit-runs',
  runId: 'failfast-resume',
  timeoutMs: 250,
  deadlineMs: 10_000,
  concurrency: 1,
  failFast: true,
  noBlock: true,
  allowDirty: true,
});
assert.equal(failFastRun.statusCounts.FAIL, 1);
assert.equal(failFastRun.statusCounts.SKIPPED, 1);
const failFastResumed = await runAudit({
  root: failFastRoot,
  outDir: 'data/artifacts/audit-runs',
  runId: 'failfast-resume',
  timeoutMs: 250,
  deadlineMs: 10_000,
  concurrency: 1,
  failFast: true,
  noBlock: true,
  allowDirty: true,
  resume: true,
});
assert.equal(failFastResumed.statusCounts.FAIL, 1);
assert.equal(failFastResumed.statusCounts.PASS, 1);
assert.equal(failFastResumed.statusCounts.SKIPPED, 0);

const deadlineResumeRoot = await mkdtemp(path.join(os.tmpdir(), 'c3-audit-runner-deadline-resume-'));
await mkdir(path.join(deadlineResumeRoot, 'tests'), { recursive: true });
await writeFile(path.join(deadlineResumeRoot, 'tests', 'a-timeout.test.js'), `
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
`);
await writeFile(path.join(deadlineResumeRoot, 'tests', 'z-pass.test.js'), 'console.log("late pass");\n');
await writeFixtureRegistry(deadlineResumeRoot, [
  'tests/a-timeout.test.js',
  'tests/z-pass.test.js',
]);
const deadlineResumeRun = await runAudit({
  root: deadlineResumeRoot,
  outDir: 'data/artifacts/audit-runs',
  runId: 'deadline-resume',
  timeoutMs: 5_000,
  deadlineMs: 500,
  concurrency: 1,
  noBlock: true,
  allowDirty: true,
});
assert.equal(deadlineResumeRun.statusCounts.TIMEOUT, 1);
assert.equal(deadlineResumeRun.statusCounts.SKIPPED, 1);
const deadlineResumed = await runAudit({
  root: deadlineResumeRoot,
  outDir: 'data/artifacts/audit-runs',
  runId: 'deadline-resume',
  timeoutMs: 5_000,
  deadlineMs: 500,
  concurrency: 1,
  noBlock: true,
  allowDirty: true,
  resume: true,
});
assert.equal(deadlineResumed.statusCounts.TIMEOUT, 1);
assert.equal(deadlineResumed.statusCounts.PASS, 1);
assert.equal(deadlineResumed.statusCounts.SKIPPED, 0);

const deadlineRoot = await mkdtemp(path.join(os.tmpdir(), 'c3-audit-runner-deadline-'));
await mkdir(path.join(deadlineRoot, 'tests'), { recursive: true });
await writeFile(path.join(deadlineRoot, 'tests', 'deadline.test.js'), `
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
`);
await writeFixtureRegistry(deadlineRoot, ['tests/deadline.test.js']);
const deadlineRun = await runAudit({
  root: deadlineRoot,
  outDir: 'data/artifacts/audit-runs',
  runId: 'deadline-bound',
  timeoutMs: 5_000,
  deadlineMs: 300,
  concurrency: 1,
  noBlock: true,
  allowDirty: true,
});
const deadlineResult = deadlineRun.results[0];
assert.equal(deadlineResult.status, 'TIMEOUT');
const deadlineLog = await readFile(path.join(deadlineRoot, deadlineResult.logPath), 'utf8');
assert.match(deadlineLog, /suite_timeout_ms=300/);

const childPid = Number(await readFile(path.join(root, 'child.pid'), 'utf8'));
assert.ok(Number.isInteger(childPid) && childPid > 0);
await waitForProcessExit(childPid);

const blockedRoot = await mkdtemp(path.join(os.tmpdir(), 'c3-audit-runner-blocked-'));
await mkdir(path.join(blockedRoot, 'tests'), { recursive: true });
await writeFile(path.join(blockedRoot, 'tests', 'model.test.js'), 'console.log("must not run");\n');
await writeFixtureRegistry(blockedRoot, ['tests/model.test.js'], {
  profile: 'model',
  tier: 'T3',
  requirements: {
    network: 'loopback',
    database: true,
    server: true,
    ollama: true,
    gpu: true,
  },
});
const blockedRun = await runAudit({
  root: blockedRoot,
  outDir: 'data/artifacts/audit-runs',
  runId: 'blocked-required',
  timeoutMs: 250,
  deadlineMs: 10_000,
  concurrency: 1,
  allowDirty: true,
  allowBlockers: new Set(['server', 'ollama', 'gpu']),
});
assert.equal(blockedRun.statusCounts.BLOCKED, 1);
assert.equal(blockedRun.requiredFailureCount, 1);
assert.equal(blockedRun.requiredBlockedCount, 1);
assert.equal(blockedRun.verdict, 'BLOCKED');
assert.equal(blockedRun.exitCode, 2);
assert.deepEqual(blockedRun.results[0].blockedBy, ['server']);

console.log('nightly audit runner self-test: PASS');

async function waitForProcessExit(pid) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(`spawned child process still exists: ${pid}`);
}

async function writeFixtureRegistry(rootDir, paths, overrides = {}) {
  const requirements = overrides.requirements || {
    network: 'none',
    database: false,
    server: false,
    ollama: false,
    gpu: false,
  };
  const suites = paths.map((testPath, index) => ({
    id: `IS-${overrides.tier || 'T1'}-SELF-${String(index + 1).padStart(3, '0')}`,
    path: testPath,
    argv: [testPath.endsWith('.py') ? 'python3' : 'node', testPath],
    capabilityId: 'C3-027',
    tier: overrides.tier || 'T1',
    fixture: 'self-test',
    profile: overrides.profile || 'offline',
    expectedDurationMs: 1_000,
    timeoutMs: 5_000,
    requirements,
    required: true,
    owner: 'self-test',
    state: 'ACTIVE',
    lastGreen: { commit: null, artifact: null },
    flakeCount: 0,
    quarantineExpiry: null,
  }));
  await writeFile(
    path.join(rootDir, 'tests', 'registry.json'),
    `${JSON.stringify({ schemaVersion: 1, suites }, null, 2)}\n`,
  );
}
