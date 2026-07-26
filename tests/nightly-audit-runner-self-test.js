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

const dryRun = await runAudit({
  root,
  outDir: 'data/artifacts/audit-runs',
  runId: 'self-test-dry-run',
  dryRun: true,
  noBlock: true,
});

assert.equal(dryRun.dryRun, true);
assert.equal(dryRun.inventory.total, 3);
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
  timeoutMs: 200,
  deadlineMs: 10_000,
  concurrency: 1,
  noBlock: true,
});

assert.equal(run.inventory.total, 3);
assert.equal(run.statusCounts.PASS, 1);
assert.equal(run.statusCounts.FAIL, 1);
assert.equal(run.statusCounts.TIMEOUT, 1);
assert.equal(run.requiredFailureCount, 2);

const byPath = new Map(run.results.map(result => [result.path, result]));
assert.equal(byPath.get('tests/pass.test.js')?.status, 'PASS');
assert.equal(byPath.get('tests/fail.test.js')?.status, 'FAIL');
assert.equal(byPath.get('tests/fail.test.js')?.exitCode, 7);
assert.equal(byPath.get('tests/timeout.test.js')?.status, 'TIMEOUT');

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

const deterministicCommentOnly = '// LLM knowledge is handled by deterministic fallback tests.\n';
assert.equal(classifyTestFile('tests/cre-comprehensive.test.js', deterministicCommentOnly), 'unit');
assert.deepEqual(detectBlockers('tests/cre-comprehensive.test.js', deterministicCommentOnly), []);

const urlFixtureOnly = 't("url text", () => classifyIntent("https://novinky.cz"));\n';
assert.deepEqual(detectBlockers('tests/cre-comprehensive.test.js', urlFixtureOnly), []);

const liveOllama = 'const OLLAMA_URL = "http://127.0.0.1:11434"; await fetch(`${OLLAMA_URL}/api/generate`);\n';
assert.equal(classifyTestFile('tests/llm-integration.test.js', liveOllama), 'ollama-e2e');
assert.deepEqual(detectBlockers('tests/llm-integration.test.js', liveOllama), ['network', 'ollama', 'ports']);

console.log('nightly audit runner self-test: PASS');
