#!/usr/bin/env node

// Bounded, read-only evidence for the local model-evaluation control plane.
// It never runs migrations, starts services, loads a model, or writes the DB.

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import Database from 'better-sqlite3';
import { buildEvaluationReport } from './model-evaluation-report.js';

const MAX_COMMAND_LINES = 50;
const MAX_COMMAND_BYTES = 16 * 1024;

function parseArgs(argv) {
  const values = {};
  for (const arg of argv) {
    const match = /^--(db|source-db)=(.+)$/.exec(arg);
    if (!match || values[match[1]]) {
      throw new Error(
        'Usage: node scripts/model-evaluation-host-snapshot.js ' +
        '--db=/path/projected.db [--source-db=/path/live.db]',
      );
    }
    values[match[1]] = resolve(match[2]);
  }
  if (!values.db) throw new Error('--db is required');
  return Object.freeze({ dbPath: values.db, sourceDbPath: values['source-db'] || null });
}

function boundedText(value) {
  const text = String(value || '').slice(0, MAX_COMMAND_BYTES).trim();
  return text ? text.split(/\r?\n/).slice(0, MAX_COMMAND_LINES) : [];
}

function command(file, args) {
  const result = spawnSync(file, args, {
    encoding: 'utf8',
    timeout: 8_000,
    maxBuffer: MAX_COMMAND_BYTES,
  });
  return Object.freeze({
    command: [file, ...args],
    exitCode: Number.isInteger(result.status) ? result.status : null,
    signal: result.signal || null,
    stdout: boundedText(result.stdout),
    stderr: boundedText(result.stderr || result.error?.message),
  });
}

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function hasTable(db, name) {
  return Boolean(db.prepare(
    "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(name));
}

function scalarCount(db, table) {
  return hasTable(db, table)
    ? db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count
    : null;
}

async function databaseSummary(path) {
  if (!existsSync(path)) throw new Error(`DB not found: ${path}`);
  const stat = statSync(path);
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const schemaMigrationCount = scalarCount(db, 'schema_migrations');
    const lastVersions = hasTable(db, 'schema_migrations')
      ? db.prepare(`
        SELECT version, applied_at AS appliedAt
        FROM schema_migrations
        ORDER BY version DESC
        LIMIT 8
      `).all()
      : [];
    const runStatus = hasTable(db, 'model_evaluation_runs')
      ? db.prepare(`
        SELECT status, COUNT(*) AS count,
               MIN(completed_at) AS minCompletedAt,
               MAX(completed_at) AS maxCompletedAt
        FROM model_evaluation_runs
        GROUP BY status
        ORDER BY status
      `).all()
      : [];
    const roleConsistentDecisionCount = hasTable(db, 'model_evaluation_decisions')
      && hasTable(db, 'model_evaluation_runs')
      ? db.prepare(`
        SELECT COUNT(*) AS count
        FROM model_evaluation_decisions decision
        JOIN model_evaluation_runs incumbent
          ON incumbent.run_id = decision.incumbent_run_id
        JOIN model_evaluation_runs candidate
          ON candidate.run_id = decision.candidate_run_id
        WHERE incumbent.role = decision.role
          AND candidate.role = decision.role
      `).get().count
      : null;
    const importAuditStatus = hasTable(db, 'model_evaluation_import_audits')
      ? db.prepare(`
        SELECT outcome AS status, COUNT(*) AS count
        FROM model_evaluation_import_audits
        GROUP BY outcome
        ORDER BY outcome
      `).all()
      : [];
    return Object.freeze({
      label: basename(path),
      bytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      sha256: await sha256File(path),
      quickCheck: db.pragma('quick_check', { simple: true }),
      tableCount: db.prepare(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'",
      ).get().count,
      schemaMigrationCount,
      lastVersions,
      authorityTables: [
        'model_evaluation_runs',
        'model_evaluation_decisions',
        'model_evaluation_decision_quarantine',
        'model_evaluation_import_audits',
      ].filter(name => hasTable(db, name)),
      retiredV123Tables: ['validation_results', 'validation_suite_scores']
        .filter(name => hasTable(db, name)),
      telemetryBlacklistTablePresent: hasTable(db, 'model_runtime_guard'),
      evaluationRunStatus: runStatus,
      decisionCount: scalarCount(db, 'model_evaluation_decisions'),
      roleConsistentDecisionCount,
      decisionQuarantineCount: scalarCount(db, 'model_evaluation_decision_quarantine'),
      importAuditStatus,
    });
  } finally {
    db.close();
  }
}

function readModelSummary(report) {
  const statuses = ['COMPLETE', 'BLOCKED', 'MISSING', 'FAILED'];
  const totals = Object.fromEntries(statuses.map(status => [status, 0]));
  const roles = {};
  const testedAt = [];
  for (const [role, state] of Object.entries(report.roles)) {
    const counts = Object.fromEntries(statuses.map(status => [status, 0]));
    for (const artifact of state.artifacts) {
      counts[artifact.status] = (counts[artifact.status] || 0) + 1;
      if (artifact.testedAt) testedAt.push(artifact.testedAt);
    }
    roles[role] = Object.freeze(counts);
    for (const status of statuses) totals[status] += counts[status];
  }
  testedAt.sort();
  return Object.freeze({
    generatedAt: report.generatedAt,
    authority: report.authority,
    bindingAuthority: report.bindingAuthority,
    artifactCount: report.models.length,
    artifacts: report.models.map(model => Object.freeze({
      name: model.name,
      canonicalName: model.canonicalName,
      digestSha256: model.digestSha256,
      size: model.size,
      modifiedAt: model.modifiedAt,
    })),
    roles,
    totals,
    currentTestedAtRange: Object.freeze({
      min: testedAt[0] || null,
      max: testedAt.at(-1) || null,
    }),
    decisionCount: report.decisions.length,
    actionableDecisionCount: report.decisions.filter(row => row.actionable).length,
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const timerList = command('systemctl', ['--user', 'list-timers', '--all', '--no-legend']);
  const report = await buildEvaluationReport({ dbPath: options.dbPath });
  const snapshot = {
    schemaVersion: 'intentsmith-model-evaluation-host-db-snapshot-v1',
    capturedAt: new Date().toISOString(),
    readOnly: true,
    prohibitedActionsObserved: Object.freeze({
      migrationsRunByThisScript: false,
      serviceOrTimerStarted: false,
      modelLoaded: false,
      scoringRunStarted: false,
    }),
    sourceRevision: command('git', ['rev-parse', 'HEAD']),
    sourceDatabase: options.sourceDbPath
      ? await databaseSummary(options.sourceDbPath)
      : null,
    projectedDatabase: await databaseSummary(options.dbPath),
    readModel: readModelSummary(report),
    host: Object.freeze({
      timerEnabled: command('systemctl', ['--user', 'is-enabled', 'intentsmith-model-hunt.timer']),
      timerActive: command('systemctl', ['--user', 'is-active', 'intentsmith-model-hunt.timer']),
      serviceActive: command('systemctl', ['--user', 'is-active', 'intentsmith-model-hunt.service']),
      scheduledHuntTimers: Object.freeze({
        ...timerList,
        stdout: timerList.stdout.filter(line => line.includes('intentsmith-model-hunt')),
      }),
      ollamaProcesses: command('ollama', ['ps']),
      nvidiaComputeProcesses: command('nvidia-smi', [
        '--query-compute-apps=pid,process_name,used_gpu_memory',
        '--format=csv,noheader,nounits',
      ]),
      nvidiaGpu: command('nvidia-smi', [
        '--query-gpu=name,memory.total,memory.free,utilization.gpu',
        '--format=csv,noheader,nounits',
      ]),
    }),
  };
  process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`MODEL_EVALUATION_HOST_SNAPSHOT_FAILED: ${error.message}\n`);
  process.exitCode = 1;
});
