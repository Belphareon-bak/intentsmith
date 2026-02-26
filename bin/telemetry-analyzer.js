#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// telemetry-analyzer.js — CRE Decision Pipeline Metrics
// ══════════════════════════════════════════════════════════════════════════════
//
// Reads telemetry_snapshots from SQLite and computes 5 key metrics:
//
//   M1 — LLM weakness rate (% AMBIGUOUS on initial classification)
//   M2 — L2 rescue rate (% of AMBIGUOUS corrected by overrides)
//   M3 — Follow-up rule distribution (R1/R2/R3/R4 breakdown)
//   M4 — Intent stability index (% turns where initial != final)
//   M5 — ASK_USER rate (% turns ending in clarification request)
//
// Usage:
//   node bin/telemetry-analyzer.js                    # all data
//   node bin/telemetry-analyzer.js --since=2026-02-26 # since date
//   node bin/telemetry-analyzer.js --session=abc123   # specific session
//   node bin/telemetry-analyzer.js --json             # JSON output
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
  const m = a.match(/^--(\w+)(?:=(.+))?$/);
  if (m) flags[m[1]] = m[2] ?? true;
}

const dbPath = flags.db || process.env.C3_DB_PATH || resolve(PROJECT_ROOT, 'data/c3.db');
const sinceDate = flags.since || null;
const sessionFilter = flags.session || null;
const jsonOutput = flags.json === true;

// ─── Open DB ────────────────────────────────────────────────────────────────

if (!existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  console.error('Run the backend first to create telemetry data, or specify --db=<path>');
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });

// ─── Build WHERE clause ─────────────────────────────────────────────────────

const conditions = [];
const params = [];
if (sinceDate) {
  conditions.push('created_at >= ?');
  params.push(sinceDate);
}
if (sessionFilter) {
  conditions.push('session_id = ?');
  params.push(sessionFilter);
}
const WHERE = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

// ─── Helpers ────────────────────────────────────────────────────────────────

function pct(n, total) {
  if (!total) return '0.0';
  return ((n / total) * 100).toFixed(1);
}

function bar(n, total, width = 20) {
  if (!total) return '';
  const filled = Math.round((n / total) * width);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled);
}

// ─── Query all snapshots with diag ──────────────────────────────────────────

const rows = db.prepare(`
  SELECT
    intent,
    classified_by,
    execution_status,
    snapshot_json,
    session_id,
    created_at
  FROM telemetry_snapshots
  ${WHERE}
  ORDER BY created_at ASC
`).all(...params);

if (rows.length === 0) {
  console.log('No telemetry data found.');
  if (sinceDate) console.log(`  (filtered: since=${sinceDate})`);
  if (sessionFilter) console.log(`  (filtered: session=${sessionFilter})`);
  process.exit(0);
}

// ─── Parse snapshots ────────────────────────────────────────────────────────

const snapshots = rows.map(r => {
  try {
    const s = JSON.parse(r.snapshot_json);
    return {
      intent: r.intent,
      classifiedBy: r.classified_by,
      executionStatus: r.execution_status,
      sessionId: r.session_id,
      createdAt: r.created_at,
      version: s.version,
      diag: s.classification?.diag || null,
      confidence: s.classification?.confidence,
      overrideApplied: s.classification?.overrideApplied,
      overrideSource: s.classification?.overrideSource,
      finalType: s.classification?.diag?.finalIntent ? 'from_diag' : null,
    };
  } catch {
    return { intent: r.intent, classifiedBy: r.classified_by, diag: null };
  }
});

const total = snapshots.length;
const withDiag = snapshots.filter(s => s.diag !== null);
const withoutDiag = total - withDiag.length;

// ═══════════════════════════════════════════════════════════════════════════
// M1 — LLM Weakness Rate
// ═══════════════════════════════════════════════════════════════════════════

const ambiguousInitial = withDiag.filter(s => s.diag.initialIntent === 'AMBIGUOUS');
const m1_rate = ambiguousInitial.length;

// ═══════════════════════════════════════════════════════════════════════════
// M2 — L2 Rescue Rate (AMBIGUOUS corrected to non-AMBIGUOUS)
// ═══════════════════════════════════════════════════════════════════════════

const rescued = ambiguousInitial.filter(s => s.diag.finalIntent !== 'AMBIGUOUS');
const m2_rate = rescued.length;

// Breakdown by override source
const rescueBreakdown = {};
for (const s of rescued) {
  if (s.diag.overrides && s.diag.overrides.length > 0) {
    for (const ov of s.diag.overrides) {
      const source = ov.split(':')[0];
      rescueBreakdown[source] = (rescueBreakdown[source] || 0) + 1;
    }
  } else {
    rescueBreakdown['unknown'] = (rescueBreakdown['unknown'] || 0) + 1;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// M3 — Follow-up Rule Distribution
// ═══════════════════════════════════════════════════════════════════════════

const ruleDist = {};
const ruleConfBuckets = {};
for (const s of withDiag) {
  const rule = s.diag.followUp?.rule || 'none';
  ruleDist[rule] = (ruleDist[rule] || 0) + 1;
  if (s.diag.followUp?.confidence !== undefined) {
    if (!ruleConfBuckets[rule]) ruleConfBuckets[rule] = [];
    ruleConfBuckets[rule].push(s.diag.followUp.confidence);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// M4 — Intent Stability Index
// ═══════════════════════════════════════════════════════════════════════════

const unstable = withDiag.filter(s => s.diag.initialIntent !== s.diag.finalIntent);
const m4_corrections = unstable.length;

// Correction flow breakdown
const correctionFlows = {};
for (const s of unstable) {
  const key = `${s.diag.initialIntent} \u2192 ${s.diag.finalIntent}`;
  correctionFlows[key] = (correctionFlows[key] || 0) + 1;
}

// ═══════════════════════════════════════════════════════════════════════════
// M5 — ASK_USER Rate
// ═══════════════════════════════════════════════════════════════════════════

// ASK_USER = execution_status is null + intent is AMBIGUOUS + finalType still AMBIGUOUS
const askUser = snapshots.filter(s =>
  s.intent === 'AMBIGUOUS' || (s.diag && s.diag.finalIntent === 'AMBIGUOUS')
);
const m5_rate = askUser.length;

// ═══════════════════════════════════════════════════════════════════════════
// Additional: Intent distribution, classifiedBy, break rate
// ═══════════════════════════════════════════════════════════════════════════

const intentDist = {};
for (const s of snapshots) {
  const i = s.intent || 'unknown';
  intentDist[i] = (intentDist[i] || 0) + 1;
}

const classifierDist = {};
for (const s of snapshots) {
  const c = s.classifiedBy || 'unknown';
  classifierDist[c] = (classifierDist[c] || 0) + 1;
}

const breakCount = withDiag.filter(s => s.diag.isIntentBreak).length;

// Session stats
const sessions = new Set(snapshots.map(s => s.sessionId).filter(Boolean));
const turnsPerSession = {};
for (const s of snapshots) {
  if (s.sessionId) {
    turnsPerSession[s.sessionId] = (turnsPerSession[s.sessionId] || 0) + 1;
  }
}
const sessionCounts = Object.values(turnsPerSession);
const avgTurnsPerSession = sessionCounts.length > 0
  ? (sessionCounts.reduce((a, b) => a + b, 0) / sessionCounts.length).toFixed(1)
  : 0;

// ═══════════════════════════════════════════════════════════════════════════
// Output
// ═══════════════════════════════════════════════════════════════════════════

if (jsonOutput) {
  const report = {
    meta: { total, withDiag: withDiag.length, withoutDiag, sessions: sessions.size, avgTurnsPerSession: parseFloat(avgTurnsPerSession) },
    m1_llm_weakness: { ambiguous: m1_rate, total: withDiag.length, rate: parseFloat(pct(m1_rate, withDiag.length)) },
    m2_l2_rescue: { rescued: m2_rate, ambiguous: m1_rate, rate: parseFloat(pct(m2_rate, m1_rate)), breakdown: rescueBreakdown },
    m3_followup_rules: ruleDist,
    m4_intent_stability: { corrections: m4_corrections, total: withDiag.length, rate: parseFloat(pct(m4_corrections, withDiag.length)), flows: correctionFlows },
    m5_ask_user: { count: m5_rate, total, rate: parseFloat(pct(m5_rate, total)) },
    intent_distribution: intentDist,
    classifier_distribution: classifierDist,
    break_rate: { count: breakCount, total: withDiag.length, rate: parseFloat(pct(breakCount, withDiag.length)) },
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

// ─── Human-readable output ──────────────────────────────────────────────────

console.log('\u2550'.repeat(60));
console.log('  CRE Telemetry Analysis');
console.log('\u2550'.repeat(60));
console.log();
console.log(`  Snapshots: ${total} (${withDiag.length} with diag v2, ${withoutDiag} legacy)`);
console.log(`  Sessions:  ${sessions.size} (avg ${avgTurnsPerSession} turns/session)`);
if (sinceDate) console.log(`  Filter:    since ${sinceDate}`);
if (sessionFilter) console.log(`  Filter:    session ${sessionFilter}`);
console.log();

// M1
console.log('\u2500\u2500 M1: LLM Weakness Rate (initial AMBIGUOUS) \u2500\u2500');
console.log(`  ${m1_rate}/${withDiag.length} = ${pct(m1_rate, withDiag.length)}%  ${bar(m1_rate, withDiag.length)}`);
console.log();

// M2
console.log('\u2500\u2500 M2: L2 Rescue Rate (AMBIGUOUS \u2192 resolved) \u2500\u2500');
if (m1_rate > 0) {
  console.log(`  ${m2_rate}/${m1_rate} = ${pct(m2_rate, m1_rate)}%  ${bar(m2_rate, m1_rate)}`);
  if (Object.keys(rescueBreakdown).length > 0) {
    console.log('  By source:');
    const rbSorted = Object.entries(rescueBreakdown).sort((a, b) => b[1] - a[1]);
    for (const [src, cnt] of rbSorted) {
      console.log(`    ${src.padEnd(28)} ${String(cnt).padStart(4)}  ${pct(cnt, m2_rate).padStart(5)}%`);
    }
  }
} else {
  console.log('  No AMBIGUOUS classifications (L1 is strong)');
}
console.log();

// M3
console.log('\u2500\u2500 M3: Follow-up Rule Distribution \u2500\u2500');
const rSorted = Object.entries(ruleDist).sort((a, b) => b[1] - a[1]);
for (const [rule, cnt] of rSorted) {
  const avgConf = ruleConfBuckets[rule]
    ? (ruleConfBuckets[rule].reduce((a, b) => a + b, 0) / ruleConfBuckets[rule].length).toFixed(2)
    : '-';
  console.log(`  ${rule.padEnd(24)} ${String(cnt).padStart(4)}  ${pct(cnt, withDiag.length).padStart(5)}%  avg_conf: ${avgConf}  ${bar(cnt, withDiag.length, 15)}`);
}
console.log();

// M4
console.log('\u2500\u2500 M4: Intent Stability (initial \u2260 final corrections) \u2500\u2500');
console.log(`  ${m4_corrections}/${withDiag.length} = ${pct(m4_corrections, withDiag.length)}% corrected  ${bar(m4_corrections, withDiag.length)}`);
if (Object.keys(correctionFlows).length > 0) {
  console.log('  Top corrections:');
  const cfSorted = Object.entries(correctionFlows).sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [flow, cnt] of cfSorted) {
    console.log(`    ${flow.padEnd(36)} ${String(cnt).padStart(4)}  ${pct(cnt, m4_corrections).padStart(5)}%`);
  }
}
console.log();

// M5
console.log('\u2500\u2500 M5: ASK_USER Rate (unresolved AMBIGUOUS) \u2500\u2500');
console.log(`  ${m5_rate}/${total} = ${pct(m5_rate, total)}%  ${bar(m5_rate, total)}`);
console.log();

// Intent distribution
console.log('\u2500\u2500 Final Intent Distribution \u2500\u2500');
const iSorted = Object.entries(intentDist).sort((a, b) => b[1] - a[1]);
for (const [intent, cnt] of iSorted) {
  console.log(`  ${intent.padEnd(20)} ${String(cnt).padStart(4)}  ${pct(cnt, total).padStart(5)}%  ${bar(cnt, total, 15)}`);
}
console.log();

// Classifier distribution
console.log('\u2500\u2500 Classifier Distribution \u2500\u2500');
const cSorted = Object.entries(classifierDist).sort((a, b) => b[1] - a[1]);
for (const [cls, cnt] of cSorted) {
  console.log(`  ${cls.padEnd(16)} ${String(cnt).padStart(4)}  ${pct(cnt, total).padStart(5)}%  ${bar(cnt, total, 15)}`);
}
console.log();

// Break rate
console.log('\u2500\u2500 Intent Break Rate \u2500\u2500');
console.log(`  ${breakCount}/${withDiag.length} = ${pct(breakCount, withDiag.length)}%  ${bar(breakCount, withDiag.length)}`);

console.log();
console.log('\u2550'.repeat(60));

db.close();
