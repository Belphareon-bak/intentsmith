#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { classifyTestFile, detectBlockers, runAudit } from '../scripts/nightly-audit.js';

const root = await mkdtemp(path.join(os.tmpdir(), 'c3-audit-runner-'));
const testsDir = path.join(root, 'tests');
await mkdir(testsDir, { recursive: true });

await writeFile(path.join(testsDir, 'pass.test.js'), 'console.log("fixture pass");\n');
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

assert.equal(run.inventory.total, 6);
assert.equal(run.statusCounts.PASS, 2);
assert.equal(run.statusCounts.FAIL, 1);
assert.equal(run.statusCounts.TIMEOUT, 3);
assert.equal(run.requiredFailureCount, 4);

const byPath = new Map(run.results.map(result => [result.path, result]));
assert.equal(byPath.get('tests/pass.test.js')?.status, 'PASS');
assert.equal(byPath.get('tests/test_flush.py')?.status, 'PASS');
assert.equal(byPath.get('tests/fail.test.js')?.status, 'FAIL');
assert.equal(byPath.get('tests/fail.test.js')?.exitCode, 7);
assert.equal(byPath.get('tests/timeout.test.js')?.status, 'TIMEOUT');
assert.equal(byPath.get('tests/ignore-term.test.js')?.status, 'TIMEOUT');
assert.equal(byPath.get('tests/spawn-child.test.js')?.status, 'TIMEOUT');

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

const failFastRoot = await mkdtemp(path.join(os.tmpdir(), 'c3-audit-runner-failfast-'));
await mkdir(path.join(failFastRoot, 'tests'), { recursive: true });
await writeFile(path.join(failFastRoot, 'tests', 'a-fail.test.js'), 'process.exit(9);\n');
await writeFile(path.join(failFastRoot, 'tests', 'z-pass.test.js'), 'console.log("late pass");\n');
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

const deterministicCommentOnly = '// LLM knowledge is handled by deterministic fallback tests.\n';
assert.equal(classifyTestFile('tests/cre-comprehensive.test.js', deterministicCommentOnly), 'unit');
assert.deepEqual(detectBlockers('tests/cre-comprehensive.test.js', deterministicCommentOnly), []);

const urlFixtureOnly = 't("url text", () => classifyIntent("https://novinky.cz"));\n';
assert.deepEqual(detectBlockers('tests/cre-comprehensive.test.js', urlFixtureOnly), []);

const liveOllama = 'const OLLAMA_URL = "http://127.0.0.1:11434"; await fetch(`${OLLAMA_URL}/api/generate`);\n';
assert.equal(classifyTestFile('tests/llm-integration.test.js', liveOllama), 'ollama-e2e');
assert.deepEqual(detectBlockers('tests/llm-integration.test.js', liveOllama), ['network', 'ollama', 'ports']);

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
