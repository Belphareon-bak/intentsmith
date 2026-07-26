#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { makeTempAuditFixture, summarizeAudit } from '../scripts/audit-summary.js';

const root = await makeTempAuditFixture();
const runDir = path.join(root, 'data/artifacts/audit-runs/summary-self-test');
const logsDir = path.join(runDir, 'logs');
await mkdir(logsDir, { recursive: true });

await writeFile(path.join(logsDir, 'fail-a.log'), 'AssertionError: expected 1 got 2\n    at test.js:10\n');
await writeFile(path.join(logsDir, 'fail-b.log'), 'AssertionError: expected 1 got 2\n    at test.js:12\n');
await writeFile(path.join(logsDir, 'env.log'), 'Error [ERR_MODULE_NOT_FOUND]: Cannot find module x\n');

const report = {
  runId: 'summary-self-test',
  sourceRevision: 'abc123',
  startedAt: '2026-07-26T00:00:00.000Z',
  endedAt: '2026-07-26T00:01:00.000Z',
  inventory: { total: 5, counts: {}, blockerCounts: {} },
  results: [
    { path: 'tests/a.test.js', category: 'unit', command: ['node', 'tests/a.test.js'], status: 'FAIL', exitCode: 1, signal: null, required: true, logPath: 'data/artifacts/audit-runs/summary-self-test/logs/fail-a.log' },
    { path: 'tests/b.test.js', category: 'unit', command: ['node', 'tests/b.test.js'], status: 'FAIL', exitCode: 1, signal: null, required: true, logPath: 'data/artifacts/audit-runs/summary-self-test/logs/fail-b.log' },
    { path: 'tests/c.test.js', category: 'contract', command: ['node', 'tests/c.test.js'], status: 'FAIL', exitCode: 1, signal: null, required: true, logPath: 'data/artifacts/audit-runs/summary-self-test/logs/env.log' },
    { path: 'tests/d.test.js', category: 'ollama-e2e', command: ['node', 'tests/d.test.js'], status: 'BLOCKED', exitCode: null, signal: null, required: false, blockers: ['ollama'], blockedBy: ['ollama'] },
    { path: 'tests/e.test.js', category: 'integration', command: ['node', 'tests/e.test.js'], status: 'TIMEOUT', exitCode: null, signal: 'SIGTERM', required: true, durationMs: 2000, logPath: null },
  ],
};

await writeFile(path.join(runDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(path.join(runDir, 'inventory.json'), `${JSON.stringify({
  suites: [
    { path: 'tests/d.test.js', category: 'ollama-e2e', blockers: ['ollama'] },
    { path: 'tests/f.test.js', category: 'integration', blockers: ['ports'] },
  ],
}, null, 2)}\n`);

const summary = await summarizeAudit(runDir);

assert.equal(summary.runId, 'summary-self-test');
assert.equal(summary.statusCounts.FAIL, 3);
assert.equal(summary.statusCounts.TIMEOUT, 1);
assert.equal(summary.statusCounts.BLOCKED, 1);
assert.equal(summary.requiredFailureCount, 4);
assert.equal(summary.failures.clusters.length, 3);
assert.equal(summary.environmentErrors.total, 1);
assert.equal(summary.environmentErrors.items[0].kind, 'missing_dependency');
assert.equal(summary.blocked.counts.REQUIRES_OLLAMA, 1);
assert.equal(summary.preflightBlockers.total, 2);
assert.equal(summary.preflightBlockers.counts.REQUIRES_OLLAMA, 1);
assert.equal(summary.preflightBlockers.counts.REQUIRES_FREE_PORT, 1);
assert.match(summary.recommendedRerun, /^node tests\//);

console.log('audit summary self-test: PASS');
