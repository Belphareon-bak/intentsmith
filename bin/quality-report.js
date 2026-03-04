#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// quality-report.js — C3 Quality Score Report CLI
// ══════════════════════════════════════════════════════════════════════════════
//
// Reads quality_scores from SQLite and produces aggregate reports.
//
// Usage:
//   node bin/quality-report.js                       # 30-day text report
//   node bin/quality-report.js --since=90            # 90-day report
//   node bin/quality-report.js --type=spec           # spec scores only
//   node bin/quality-report.js --project=lc-abc-123  # single project
//   node bin/quality-report.js --json                # JSON output
//   node bin/quality-report.js --csv                 # CSV output
//   node bin/quality-report.js --db=/custom/path     # custom DB path
//
// ══════════════════════════════════════════════════════════════════════════════

import Database from 'better-sqlite3';
import { resolve, dirname } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

// ─── Parse CLI args ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flags = {};
for (const a of args) {
  if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
  const m = a.match(/^--(\w+)(?:=(.+))?$/);
  if (m) flags[m[1]] = m[2] ?? true;
}

const dbPath = flags.db || process.env.C3_DB_PATH || resolve(PROJECT_ROOT, 'data/c3.db');
const sinceDays = flags.since ? parseInt(flags.since, 10) : 30;
const artifactType = flags.type || null;
const projectId = flags.project || null;
const jsonOutput = flags.json === true;
const csvOutput = flags.csv === true;

// ─── Help ───────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
C3 Quality Score Report
═══════════════════════

Usage:
  node bin/quality-report.js [options]

Options:
  --since=N       Period in days (default: 30)
  --type=TYPE     Filter by artifact type (spec, roadmap, change, lifecycle)
  --project=ID    Report for a specific lifecycle/project ID
  --json          Output as JSON
  --csv           Output as CSV
  --db=PATH       Custom database path
  --help, -h      Show this help

Examples:
  node bin/quality-report.js                       # 30-day summary
  node bin/quality-report.js --since=90            # 90-day summary
  node bin/quality-report.js --type=spec           # spec scores only
  node bin/quality-report.js --project=lc-abc-123  # single project detail
  node bin/quality-report.js --json                # machine-readable output
  node bin/quality-report.js --csv > report.csv    # export to CSV
`);
}

// ─── Open DB ────────────────────────────────────────────────────────────────

if (!existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  console.error('Run the backend first to create quality data, or specify --db=<path>');
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });

// ─── Helpers ────────────────────────────────────────────────────────────────

function round2(n) { return Math.round(n * 100) / 100; }

function median(sorted) {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function stddev(values, mean) {
  if (values.length < 2) return 0;
  const sumSq = values.reduce((acc, v) => acc + (v - mean) ** 2, 0);
  return Math.sqrt(sumSq / values.length);
}

function scoreLabel(score) {
  if (score >= 0.85) return 'EXCELLENT';
  if (score >= 0.70) return 'GOOD';
  if (score >= 0.55) return 'ACCEPTABLE';
  return 'WEAK';
}

function pct(n, total) {
  if (!total) return '0.0';
  return ((n / total) * 100).toFixed(1);
}

function bar(n, total, width = 20) {
  if (!total) return '';
  const filled = Math.round((n / total) * width);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled);
}

function sinceSQL(days) {
  if (!days || days <= 0) return '';
  return `AND created_at >= datetime('now', '-${Math.floor(days)} days')`;
}

function typeSQL(type) {
  if (!type) return '';
  return `AND artifact_type = '${type.replace(/'/g, "''")}'`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Project Report (single lifecycle)
// ═══════════════════════════════════════════════════════════════════════════

if (projectId) {
  const allScores = db.prepare(`
    SELECT * FROM quality_scores
    WHERE lifecycle_id = ?
    ORDER BY created_at ASC
  `).all(projectId);

  if (allScores.length === 0) {
    console.error(`No quality data found for lifecycle: ${projectId}`);
    db.close();
    process.exit(1);
  }

  // Parse breakdown JSON
  const parsed = allScores.map(r => {
    const row = { ...r };
    if (row.breakdown && typeof row.breakdown === 'string') {
      try { row.breakdown = JSON.parse(row.breakdown); } catch { /* keep string */ }
    }
    return row;
  });

  // Latest per type
  const latest = {};
  for (const row of parsed) {
    if (!latest[row.artifact_type] || row.created_at > latest[row.artifact_type].created_at) {
      latest[row.artifact_type] = row;
    }
  }

  // Trend per type
  const trend = {};
  for (const row of parsed) {
    if (!trend[row.artifact_type]) trend[row.artifact_type] = [];
    trend[row.artifact_type].push({
      version: row.artifact_version,
      score: row.score,
      label: row.label,
      created_at: row.created_at,
    });
  }

  // Volatility
  const byType = {};
  for (const row of parsed) {
    if (!byType[row.artifact_type]) byType[row.artifact_type] = [];
    byType[row.artifact_type].push(row.score);
  }
  let totalDelta = 0, deltaCount = 0;
  for (const scores of Object.values(byType)) {
    for (let i = 1; i < scores.length; i++) {
      totalDelta += Math.abs(scores[i] - scores[i - 1]);
      deltaCount++;
    }
  }
  const volatility = deltaCount > 0 ? round2(totalDelta / deltaCount) : 0;

  if (jsonOutput) {
    console.log(JSON.stringify({ lifecycle_id: projectId, latest, trend, volatility, history: parsed }, null, 2));
    db.close();
    process.exit(0);
  }

  if (csvOutput) {
    console.log('lifecycle_id,artifact_type,artifact_version,score,label,created_at');
    for (const row of parsed) {
      console.log(`${row.lifecycle_id},${row.artifact_type},${row.artifact_version ?? ''},${row.score},${row.label},${row.created_at}`);
    }
    db.close();
    process.exit(0);
  }

  // Text output
  console.log('\u2550'.repeat(60));
  console.log(`  C3 Quality Report — ${projectId}`);
  console.log('\u2550'.repeat(60));
  console.log();
  console.log(`  Total scores: ${parsed.length}`);
  console.log(`  Volatility:   ${volatility}`);
  console.log();

  console.log('\u2500\u2500 Latest Scores \u2500\u2500');
  for (const [type, row] of Object.entries(latest)) {
    console.log(`  ${type.padEnd(12)} ${String(row.score).padStart(5)}  [${row.label}]  v${row.artifact_version ?? '-'}  ${row.created_at}`);
  }
  console.log();

  for (const [type, entries] of Object.entries(trend)) {
    if (entries.length > 1) {
      console.log(`\u2500\u2500 ${type} Trend \u2500\u2500`);
      for (const e of entries) {
        const labelPad = e.label.padEnd(10);
        console.log(`  v${String(e.version ?? '-').padEnd(4)} ${String(e.score).padStart(5)}  [${labelPad}]  ${e.created_at}`);
      }
      const delta = round2(entries[entries.length - 1].score - entries[0].score);
      console.log(`  \u0394 = ${delta > 0 ? '+' : ''}${delta}`);
      console.log();
    }
  }

  console.log('\u2550'.repeat(60));
  db.close();
  process.exit(0);
}

// ═══════════════════════════════════════════════════════════════════════════
// Summary Report (all lifecycles)
// ═══════════════════════════════════════════════════════════════════════════

const sinceC = sinceSQL(sinceDays);
const typeC = typeSQL(artifactType);

// Latest score per lifecycle per artifact_type
const rows = db.prepare(`
  SELECT qs.lifecycle_id, qs.artifact_type, qs.artifact_version, qs.score, qs.label, qs.created_at
  FROM quality_scores qs
  INNER JOIN (
    SELECT lifecycle_id, artifact_type, MAX(created_at) as max_created
    FROM quality_scores
    WHERE 1=1 ${sinceC} ${typeC}
    GROUP BY lifecycle_id, artifact_type
  ) latest ON qs.lifecycle_id = latest.lifecycle_id
    AND qs.artifact_type = latest.artifact_type
    AND qs.created_at = latest.max_created
  WHERE 1=1 ${sinceSQL(sinceDays)} ${typeSQL(artifactType)}
  ORDER BY qs.lifecycle_id
`).all();

if (rows.length === 0) {
  console.log('No quality data found.');
  if (sinceDays) console.log(`  Period: last ${sinceDays} days`);
  if (artifactType) console.log(`  Filter: type=${artifactType}`);
  console.log('Run lifecycle operations to start collecting quality scores.');
  db.close();
  process.exit(0);
}

// Compute stats
const scores = rows.map(r => r.score).sort((a, b) => a - b);
const lifecycleIds = new Set(rows.map(r => r.lifecycle_id));
const meanVal = scores.reduce((a, b) => a + b, 0) / scores.length;

const distribution = { EXCELLENT: 0, GOOD: 0, ACCEPTABLE: 0, WEAK: 0 };
for (const s of scores) distribution[scoreLabel(s)]++;

const perType = {};
for (const row of rows) {
  if (!perType[row.artifact_type]) perType[row.artifact_type] = [];
  perType[row.artifact_type].push(row.score);
}
const perTypeStats = {};
for (const [type, typeScores] of Object.entries(perType)) {
  const sorted = [...typeScores].sort((a, b) => a - b);
  const typeMean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  perTypeStats[type] = {
    count: sorted.length,
    mean: round2(typeMean),
    median: round2(median(sorted)),
    min: round2(sorted[0]),
    max: round2(sorted[sorted.length - 1]),
  };
}

// Spec version delta
const specRows = db.prepare(`
  SELECT lifecycle_id, artifact_version, score
  FROM quality_scores
  WHERE artifact_type = 'spec' ${sinceC}
  ORDER BY lifecycle_id, artifact_version ASC
`).all();

const byLifecycle = {};
for (const row of specRows) {
  if (!byLifecycle[row.lifecycle_id]) byLifecycle[row.lifecycle_id] = [];
  byLifecycle[row.lifecycle_id].push(row);
}
let specTotalDelta = 0, specCount = 0, improvements = 0, regressions = 0;
for (const entries of Object.values(byLifecycle)) {
  if (entries.length < 2) continue;
  const delta = entries[entries.length - 1].score - entries[0].score;
  specTotalDelta += delta;
  specCount++;
  if (delta > 0) improvements++;
  else if (delta < 0) regressions++;
}

const summary = {
  projects_analyzed: lifecycleIds.size,
  mean: round2(meanVal),
  median: round2(median(scores)),
  stddev: round2(stddev(scores, meanVal)),
  min: round2(scores[0]),
  max: round2(scores[scores.length - 1]),
  distribution,
  per_type: perTypeStats,
  spec_delta: {
    avg_delta: specCount > 0 ? round2(specTotalDelta / specCount) : 0,
    count: specCount,
    improvements,
    regressions,
  },
};

// ─── JSON output ────────────────────────────────────────────────────────────

if (jsonOutput) {
  console.log(JSON.stringify(summary, null, 2));
  db.close();
  process.exit(0);
}

// ─── CSV output ─────────────────────────────────────────────────────────────

if (csvOutput) {
  console.log('lifecycle_id,artifact_type,artifact_version,score,label,created_at');
  for (const row of rows) {
    console.log(`${row.lifecycle_id},${row.artifact_type},${row.artifact_version ?? ''},${row.score},${row.label},${row.created_at}`);
  }
  db.close();
  process.exit(0);
}

// ─── Text output ────────────────────────────────────────────────────────────

console.log('\u2550'.repeat(60));
console.log('  C3 Quality Score Report');
console.log('\u2550'.repeat(60));
console.log();
console.log(`  Projects analyzed: ${summary.projects_analyzed}`);
console.log(`  Period: last ${sinceDays} days`);
if (artifactType) console.log(`  Filter: type=${artifactType}`);
console.log();

// Overall scores
console.log('\u2500\u2500 Overall Scores \u2500\u2500');
console.log(`  Mean:    ${summary.mean}`);
console.log(`  Median:  ${summary.median}`);
console.log(`  Stddev:  ${summary.stddev}`);
console.log(`  Min/Max: ${summary.min} / ${summary.max}`);
console.log();

// Distribution
console.log('\u2500\u2500 Distribution \u2500\u2500');
const total = rows.length;
console.log(`  EXCELLENT (\u22650.85): ${distribution.EXCELLENT.toString().padStart(3)}  ${pct(distribution.EXCELLENT, total).padStart(5)}%  ${bar(distribution.EXCELLENT, total, 15)}`);
console.log(`  GOOD (0.70\u20130.85):  ${distribution.GOOD.toString().padStart(3)}  ${pct(distribution.GOOD, total).padStart(5)}%  ${bar(distribution.GOOD, total, 15)}`);
console.log(`  ACCEPTABLE:        ${distribution.ACCEPTABLE.toString().padStart(3)}  ${pct(distribution.ACCEPTABLE, total).padStart(5)}%  ${bar(distribution.ACCEPTABLE, total, 15)}`);
console.log(`  WEAK (<0.55):      ${distribution.WEAK.toString().padStart(3)}  ${pct(distribution.WEAK, total).padStart(5)}%  ${bar(distribution.WEAK, total, 15)}`);
console.log();

// Per-type
if (Object.keys(perTypeStats).length > 0) {
  console.log('\u2500\u2500 Per Artifact Type \u2500\u2500');
  for (const [type, stats] of Object.entries(perTypeStats)) {
    console.log(`  ${type.padEnd(12)} mean=${String(stats.mean).padStart(5)}  median=${String(stats.median).padStart(5)}  range=${stats.min}\u2013${stats.max}  (n=${stats.count})`);
  }
  console.log();
}

// Spec delta
if (summary.spec_delta.count > 0) {
  const sd = summary.spec_delta;
  console.log('\u2500\u2500 Spec Version Trend \u2500\u2500');
  console.log(`  Avg delta v1\u2192vN:  ${sd.avg_delta > 0 ? '+' : ''}${sd.avg_delta}`);
  console.log(`  Improvements:     ${sd.improvements}`);
  console.log(`  Regressions:      ${sd.regressions}`);
  console.log(`  Lifecycles w/ \u22652: ${sd.count}`);
  console.log();
}

// Per-project listing
console.log('\u2500\u2500 Per Project \u2500\u2500');
for (const lcId of lifecycleIds) {
  const projectRows = rows.filter(r => r.lifecycle_id === lcId);
  const lcScores = projectRows.map(r => `${r.artifact_type}=${r.score}`).join(', ');
  const avgScore = round2(projectRows.reduce((a, r) => a + r.score, 0) / projectRows.length);
  console.log(`  ${lcId.substring(0, 24).padEnd(24)} avg=${String(avgScore).padStart(5)}  ${lcScores}`);
}
console.log();

console.log('\u2550'.repeat(60));
db.close();
