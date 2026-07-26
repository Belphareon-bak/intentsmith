#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { classifyTestFile, detectBlockers, runAudit } from '../scripts/nightly-audit.js';

const root = await mkdtemp(path.join(os.tmpdir(), 'c3-audit-runner-'));
const testsDir = path.join(root, 'tests');
await mkdir(testsDir, { recursive: true });

await writeFile(path.join(testsDir, 'pass.test.js'), 'console.log("fixture pass");\n');
await writeFile(path.join(testsDir, 'fail.test.js'), 'console.error("fixture fail"); process.exit(7);\n');
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
assert.equal(dryRun.inventory.total, 5);
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
});

assert.equal(run.inventory.total, 5);
assert.equal(run.statusCounts.PASS, 1);
assert.equal(run.statusCounts.FAIL, 1);
assert.equal(run.statusCounts.TIMEOUT, 3);
assert.equal(run.requiredFailureCount, 4);

const byPath = new Map(run.results.map(result => [result.path, result]));
assert.equal(byPath.get('tests/pass.test.js')?.status, 'PASS');
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
  resume: true,
});
assert.equal(resumed.results.length, 5);

await assert.rejects(
  () => runAudit({
    root,
    outDir: 'data/artifacts/audit-runs',
    runId: 'self-test-execution',
    timeoutMs: 251,
    deadlineMs: 15_000,
    concurrency: 1,
    noBlock: true,
    resume: true,
  }),
  /option fingerprint mismatch/
);

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
