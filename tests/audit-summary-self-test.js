#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdir, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { makeTempAuditFixture, summarizeAudit } from '../scripts/audit-summary.js';

const root = await makeTempAuditFixture();
const runDir = path.join(root, 'data/artifacts/audit-runs/summary-self-test');
const logsDir = path.join(runDir, 'logs');
await mkdir(logsDir, { recursive: true });

await writeFile(path.join(logsDir, 'fail-a.log'), 'AssertionError: expected 1 got 2\n    at test.js:10\n');
await writeFile(path.join(logsDir, 'fail-b.log'), 'AssertionError: expected 1 got 2\n    at test.js:10\n');
await writeFile(path.join(logsDir, 'env.log'), 'Error [ERR_MODULE_NOT_FOUND]: Cannot find package "left-pad"\n');
await writeFile(path.join(logsDir, 'rel-env.log'), "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/tmp/project/core/logger.js'\n");

const report = {
  runId: 'summary-self-test',
  sourceRevision: 'abc123',
  startedAt: '2026-07-26T00:00:00.000Z',
  endedAt: '2026-07-26T00:01:00.000Z',
  inventory: { total: 7, counts: {}, blockerCounts: {} },
  results: [
    { path: 'tests/a.test.js', category: 'unit', command: ['node', 'tests/a.test.js'], status: 'FAIL', exitCode: 1, signal: null, required: true, logPath: 'data/artifacts/audit-runs/summary-self-test/logs/fail-a.log' },
    { path: 'tests/b.test.js', category: 'unit', command: ['node', 'tests/b.test.js'], status: 'FAIL', exitCode: 1, signal: null, required: true, logPath: 'data/artifacts/audit-runs/summary-self-test/logs/fail-b.log' },
    { path: 'tests/c.test.js', category: 'contract', command: ['node', 'tests/c.test.js'], status: 'FAIL', exitCode: 1, signal: null, required: true, logPath: 'data/artifacts/audit-runs/summary-self-test/logs/env.log' },
    { path: 'tests/c2.test.js', category: 'contract', command: ['node', 'tests/c2.test.js'], status: 'FAIL', exitCode: 1, signal: null, required: true, logPath: 'data/artifacts/audit-runs/summary-self-test/logs/rel-env.log' },
    { path: 'tests/d.test.js', category: 'ollama-e2e', command: ['node', 'tests/d.test.js'], status: 'BLOCKED', exitCode: null, signal: null, required: false, blockers: ['ollama'], blockedBy: ['ollama'] },
    { path: 'tests/e2e/cleanup.e2e.js', category: 'local-e2e', command: ['node', 'tests/e2e/cleanup.e2e.js'], status: 'BLOCKED', exitCode: null, signal: null, required: false, blockers: ['destructive'], blockedBy: ['destructive'] },
    { path: 'tests/e.test.js', category: 'integration', command: ['node', 'tests/e.test.js'], status: 'TIMEOUT', exitCode: null, signal: 'SIGTERM', required: true, durationMs: 2000, logPath: null },
  ],
};

await writeFile(path.join(runDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(path.join(runDir, 'inventory.json'), `${JSON.stringify({
  suites: [
    { path: 'tests/d.test.js', category: 'ollama-e2e', blockers: ['ollama'] },
    { path: 'tests/e2e/cleanup.e2e.js', category: 'local-e2e', blockers: ['destructive'] },
    { path: 'tests/f.test.js', category: 'integration', blockers: ['ports'] },
  ],
}, null, 2)}\n`);

const baselineRunDir = path.join(root, 'data/artifacts/audit-runs/summary-baseline');
const baselineLogsDir = path.join(baselineRunDir, 'logs');
await mkdir(baselineLogsDir, { recursive: true });
await writeFile(path.join(baselineLogsDir, 'old-a.log'), 'AssertionError: expected 9 got 10\n    at test.js:10\n');
await writeFile(path.join(baselineLogsDir, 'env.log'), 'Error [ERR_MODULE_NOT_FOUND]: Cannot find package "left-pad"\n');
await writeFile(path.join(baselineRunDir, 'report.json'), `${JSON.stringify({
  runId: 'summary-baseline',
  sourceRevision: 'abc123',
  startedAt: '2026-07-26T00:00:00.000Z',
  endedAt: '2026-07-26T00:01:00.000Z',
  inventory: { total: 2, counts: {}, blockerCounts: {} },
  results: [
    { path: 'tests/a.test.js', category: 'unit', command: ['node', 'tests/a.test.js'], status: 'FAIL', exitCode: 1, signal: null, required: true, logPath: 'data/artifacts/audit-runs/summary-baseline/logs/old-a.log' },
    { path: 'tests/c.test.js', category: 'contract', command: ['node', 'tests/c.test.js'], status: 'FAIL', exitCode: 1, signal: null, required: true, logPath: 'data/artifacts/audit-runs/summary-baseline/logs/env.log' },
  ],
}, null, 2)}\n`);

const checkpointRunDir = path.join(root, 'data/artifacts/audit-runs/checkpoint-only');
await mkdir(checkpointRunDir, { recursive: true });
await writeFile(path.join(checkpointRunDir, 'inventory.json'), `${JSON.stringify({
  runId: 'checkpoint-only',
  sourceRevision: 'def456',
  generatedAt: '2026-07-26T00:00:00.000Z',
  suites: [
    { path: 'tests/pass.test.js', category: 'unit', blockers: [] },
  ],
}, null, 2)}\n`);
await writeFile(path.join(checkpointRunDir, 'checkpoint.json'), `${JSON.stringify({
  runId: 'checkpoint-only',
  sourceRevision: 'def456',
  updatedAt: '2026-07-26T00:00:30.000Z',
  results: [
    { path: 'tests/pass.test.js', category: 'unit', command: ['node', 'tests/pass.test.js'], status: 'PASS', exitCode: 0, signal: null, required: true, logPath: null },
  ],
}, null, 2)}\n`);

const newerCheckpointRunDir = path.join(root, 'data/artifacts/audit-runs/newer-checkpoint');
await mkdir(newerCheckpointRunDir, { recursive: true });
await writeFile(path.join(newerCheckpointRunDir, 'inventory.json'), `${JSON.stringify({
  runId: 'newer-checkpoint',
  sourceRevision: 'ghi789',
  generatedAt: '2026-07-26T00:00:00.000Z',
  suites: [
    { path: 'tests/pass.test.js', category: 'unit', blockers: [] },
    { path: 'tests/late.test.js', category: 'unit', blockers: [] },
  ],
}, null, 2)}\n`);
const staleReportPath = path.join(newerCheckpointRunDir, 'report.json');
const newerCheckpointPath = path.join(newerCheckpointRunDir, 'checkpoint.json');
await writeFile(staleReportPath, `${JSON.stringify({
  runId: 'newer-checkpoint',
  sourceRevision: 'ghi789',
  startedAt: '2026-07-26T00:00:00.000Z',
  endedAt: '2026-07-26T00:00:10.000Z',
  inventory: { total: 2, counts: {}, blockerCounts: {} },
  statusCounts: { PASS: 1, FAIL: 0, TIMEOUT: 0, BLOCKED: 0, SKIPPED: 1 },
  results: [
    { path: 'tests/pass.test.js', category: 'unit', command: ['node', 'tests/pass.test.js'], status: 'PASS', exitCode: 0, signal: null, required: true, logPath: null },
    { path: 'tests/late.test.js', category: 'unit', command: ['node', 'tests/late.test.js'], status: 'SKIPPED', exitCode: null, signal: null, required: true, logPath: null },
  ],
}, null, 2)}\n`);
await writeFile(newerCheckpointPath, `${JSON.stringify({
  runId: 'newer-checkpoint',
  sourceRevision: 'ghi789',
  updatedAt: '2026-07-26T00:00:30.000Z',
  results: [
    { path: 'tests/pass.test.js', category: 'unit', command: ['node', 'tests/pass.test.js'], status: 'PASS', exitCode: 0, signal: null, required: true, logPath: null },
    { path: 'tests/late.test.js', category: 'unit', command: ['node', 'tests/late.test.js'], status: 'PASS', exitCode: 0, signal: null, required: true, logPath: null },
  ],
}, null, 2)}\n`);
await utimes(staleReportPath, new Date('2026-07-26T00:00:10.000Z'), new Date('2026-07-26T00:00:10.000Z'));
await utimes(newerCheckpointPath, new Date('2026-07-26T00:00:30.000Z'), new Date('2026-07-26T00:00:30.000Z'));

const summary = await summarizeAudit(runDir);
const summaryFromReport = await summarizeAudit(path.join(runDir, 'report.json'));
const summaryWithBaseline = await summarizeAudit(runDir, { baseline: path.join(baselineRunDir, 'report.json') });
const checkpointSummary = await summarizeAudit(path.join(checkpointRunDir, 'checkpoint.json'));
const newerCheckpointSummary = await summarizeAudit(newerCheckpointRunDir);

assert.equal(summary.runId, 'summary-self-test');
assert.equal(summaryFromReport.runId, 'summary-self-test');
assert.equal(summary.statusCounts.FAIL, 4);
assert.equal(summary.statusCounts.TIMEOUT, 1);
assert.equal(summary.statusCounts.BLOCKED, 2);
assert.equal(summary.requiredFailureCount, 5);
assert.equal(summary.failures.clusters.length, 4);
assert.equal(summary.environmentErrors.total, 2);
assert.deepEqual(new Set(summary.environmentErrors.items.map(item => item.kind)), new Set(['missing_dependency', 'invalid_relative_module_path']));
assert.equal(summary.newVsRepeated.newFailures, 5);
assert.equal(summaryWithBaseline.newVsRepeated.newFailures, 4);
assert.equal(summaryWithBaseline.newVsRepeated.repeatedFailures, 1);
assert.equal(summary.blocked.counts.REQUIRES_OLLAMA, 1);
assert.equal(summary.blocked.counts.SAFE_IN_DISPOSABLE_WORKTREE, 1);
assert.equal(summary.blocked.suites.find(item => item.classification.label === 'SAFE_IN_DISPOSABLE_WORKTREE').classification.autoAllow, false);
assert.equal(summary.preflightBlockers.total, 3);
assert.equal(summary.preflightBlockers.counts.REQUIRES_OLLAMA, 1);
assert.equal(summary.preflightBlockers.counts.SAFE_IN_DISPOSABLE_WORKTREE, 1);
assert.equal(summary.preflightBlockers.counts.REQUIRES_FREE_PORT, 1);
assert.match(summary.recommendedRerun, /^node tests\//);
assert.equal(checkpointSummary.mode, 'checkpoint');
assert.equal(checkpointSummary.runId, 'checkpoint-only');
assert.equal(checkpointSummary.statusCounts.PASS, 1);
assert.equal(newerCheckpointSummary.mode, 'checkpoint');
assert.equal(newerCheckpointSummary.statusCounts.PASS, 2);
assert.equal(newerCheckpointSummary.statusCounts.SKIPPED, 0);

console.log('audit summary self-test: PASS');
