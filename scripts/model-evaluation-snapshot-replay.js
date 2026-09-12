#!/usr/bin/env node

// Offline/read-only replay of a committed host snapshot against the same DB.
// Provider inventory is reconstructed exclusively from the SHA-bound
// normalized projection stored in the snapshot; Ollama is never contacted.

import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildEvaluationReport } from './model-evaluation-report.js';
import {
  inventoryFromModelEvaluationSnapshot,
  summarizeModelEvaluationReport,
} from '../src/upgrade/model-evaluation-snapshot.js';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT_PATH = fileURLToPath(import.meta.url);

function parseNonNegativeInteger(value, flag) {
  if (!/^\d+$/.test(value || '')) throw new Error(`${flag} must be a non-negative integer`);
  return Number(value);
}

function parseArgs(argv) {
  const values = {};
  for (const arg of argv) {
    const match = /^--(snapshot|db|out|expect-complete|expect-blocked|expect-applicable-missing|expect-not-applicable)=(.+)$/.exec(arg);
    if (!match || Object.hasOwn(values, match[1])) {
      throw new Error(
        'Usage: node scripts/model-evaluation-snapshot-replay.js '
        + '--snapshot=/path/snapshot.json --db=/path/c3.db '
        + '--expect-complete=N --expect-blocked=N '
        + '--expect-applicable-missing=N --expect-not-applicable=N '
        + '[--out=/new/evidence.json]',
      );
    }
    values[match[1]] = match[2];
  }
  for (const required of [
    'snapshot',
    'db',
    'expect-complete',
    'expect-blocked',
    'expect-applicable-missing',
    'expect-not-applicable',
  ]) {
    if (!values[required]) throw new Error(`--${required} is required`);
  }
  return Object.freeze({
    snapshotPath: resolve(values.snapshot),
    dbPath: resolve(values.db),
    outPath: values.out ? resolve(values.out) : null,
    expected: Object.freeze({
      complete: parseNonNegativeInteger(values['expect-complete'], '--expect-complete'),
      blocked: parseNonNegativeInteger(values['expect-blocked'], '--expect-blocked'),
      applicableMissing: parseNonNegativeInteger(
        values['expect-applicable-missing'],
        '--expect-applicable-missing',
      ),
      notApplicable: parseNonNegativeInteger(
        values['expect-not-applicable'],
        '--expect-not-applicable',
      ),
    }),
  });
}

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function sourceRevision() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    timeout: 5_000,
  });
  return Object.freeze({
    cwd: REPOSITORY_ROOT,
    command: Object.freeze(['git', 'rev-parse', 'HEAD']),
    exitCode: Number.isInteger(result.status) ? result.status : null,
    value: result.status === 0 ? result.stdout.trim() : null,
  });
}

function comparableSummary(summary) {
  return Object.freeze({
    inventoryProjectionSha256: summary.inventoryProjection.sha256,
    roles: summary.roles,
    totals: summary.totals,
    coverage: summary.coverage,
    completeIntervalIntegrity: summary.completeIntervalIntegrity,
    decisionCount: summary.decisionCount,
    actionableDecisionCount: summary.actionableDecisionCount,
  });
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function compareSnapshotReplay(snapshotSummary, replaySummary, expected) {
  const actual = Object.freeze({
    complete: replaySummary.coverage.applicableStatusCounts.COMPLETE,
    blocked: replaySummary.coverage.applicableStatusCounts.BLOCKED,
    applicableMissing: replaySummary.coverage.applicableStatusCounts.MISSING,
    notApplicable: replaySummary.coverage.notApplicable,
  });
  const checks = Object.freeze({
    summaryMatchesSnapshot: sameJson(
      comparableSummary(snapshotSummary),
      comparableSummary(replaySummary),
    ),
    expectedCountsMatch: sameJson(expected, actual),
  });
  return Object.freeze({
    verdict: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL',
    checks,
    expected,
    actual,
  });
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const options = parseArgs(rawArgs);
  const startedAt = new Date().toISOString();
  const snapshot = JSON.parse(readFileSync(options.snapshotPath, 'utf8'));
  const inventory = inventoryFromModelEvaluationSnapshot(snapshot);
  const databaseSha256Before = await sha256File(options.dbPath);
  const report = await buildEvaluationReport({
    dbPath: options.dbPath, inventory,
    providerVersion: snapshot.readModel.inventoryProjection.providerVersion || null,
  });
  const replaySummary = summarizeModelEvaluationReport(report);
  const databaseSha256After = await sha256File(options.dbPath);
  const comparison = compareSnapshotReplay(snapshot.readModel, replaySummary, options.expected);
  const databaseMatchesSnapshot = snapshot.projectedDatabase?.sha256 === databaseSha256Before;
  const databaseUnchanged = databaseSha256Before === databaseSha256After;
  const verdict = comparison.verdict === 'PASS'
    && databaseMatchesSnapshot
    && databaseUnchanged
    ? 'PASS'
    : 'FAIL';
  const evidence = {
    schemaVersion: 'intentsmith-model-evaluation-snapshot-replay-v1',
    startedAt,
    completedAt: new Date().toISOString(),
    verdict,
    invocation: {
      cwd: process.cwd(),
      repositoryRoot: REPOSITORY_ROOT,
      command: [process.execPath, SCRIPT_PATH, ...rawArgs],
    },
    sourceRevision: sourceRevision(),
    inputs: {
      snapshot: {
        path: options.snapshotPath,
        sha256: await sha256File(options.snapshotPath),
        inventoryProjectionSha256: snapshot.readModel.inventoryProjection.sha256,
      },
      database: {
        path: options.dbPath,
        sha256Before: databaseSha256Before,
        sha256After: databaseSha256After,
        matchesSnapshot: databaseMatchesSnapshot,
        byteIdenticalDuringReplay: databaseUnchanged,
      },
    },
    providerInventorySource: 'SNAPSHOT_NORMALIZED_PROJECTION_ONLY',
    providerContacted: false,
    comparison,
  };
  const rendered = `${JSON.stringify(evidence, null, 2)}\n`;
  if (options.outPath) {
    writeFileSync(options.outPath, rendered, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  } else {
    process.stdout.write(rendered);
  }
  if (verdict !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch(error => {
    process.stderr.write(`MODEL_EVALUATION_SNAPSHOT_REPLAY_FAILED: ${error.message}\n`);
    process.exitCode = 1;
  });
}
