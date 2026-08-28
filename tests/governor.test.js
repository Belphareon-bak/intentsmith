#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// C3-Agent — System Governor Tests v135
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests:
//   - HealthAnalyzer: 6 dimensions, trend, data completeness, CRITICAL propagation
//   - ImprovementPlanner: 8 rules, confidence, priority, root cause, action payload
//   - SafetyGuard: validation, dedup, cooldown
//   - SystemGovernor: full pipeline, persistence, idempotency, rate limit, WS diff
//
// Run: node tests/governor.test.js
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, assertIncludes, summary } from './harness.js';
import Database from 'better-sqlite3';
import { createRoleEvaluationPlans } from '../src/eval/role-evaluation-plan.js';

import {
  healthAnalyzer, DIMENSION_WEIGHTS, classifyStatus, tableExists,
  analyzeModels, analyzeCre, analyzeArchitecture, analyzeBuilds, analyzeSpecialists, analyzeUpgrades, applyTrends,
} from '../src/system/governor/health-analyzer.js';

import {
  improvementPlanner, computeConfidence, computePriority, SEVERITY_WEIGHT,
  ruleModelLowSuccess, ruleArchDrift, ruleBuildQualityLow, ruleCRELow,
  ruleModelUnvalidated, ruleSpecialistFailing, ruleModelDrift,
} from '../src/system/governor/improvement-planner.js';

import {
  safetyGuard, computeHash, validateProposal, VALID_TYPES, COOLDOWN_HOURS,
} from '../src/system/governor/safety-guard.js';

// ─── Test DB Setup ──────────────────────────────────────────────────────────

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');

  // Governor tables (migration 040)
  db.exec(`
    CREATE TABLE governor_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      overall_health TEXT NOT NULL,
      overall_score REAL NOT NULL,
      dimensions TEXT NOT NULL,
      proposals_json TEXT NOT NULL,
      summary TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE governor_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL REFERENCES governor_reports(id),
      rule_id TEXT NOT NULL,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      suggested_action TEXT,
      action_payload TEXT,
      confidence REAL NOT NULL,
      priority REAL NOT NULL,
      root_cause TEXT,
      hash TEXT NOT NULL,
      cooldown_until DATETIME,
      status TEXT NOT NULL DEFAULT 'pending',
      resolved_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Source tables needed by health dimensions
  db.exec(`
    CREATE TABLE model_performance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      model TEXT NOT NULL,
      task_type TEXT NOT NULL,
      success INTEGER NOT NULL,
      iterations INTEGER DEFAULT 1,
      tokens INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      errors_fixed INTEGER DEFAULT 0,
      errors_remaining INTEGER DEFAULT 0,
      stop_reason TEXT,
      lifecycle_id TEXT,
      milestone_id TEXT,
      detail_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE telemetry_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      turn_id TEXT NOT NULL,
      session_id TEXT,
      conversation_id TEXT,
      intent TEXT,
      classified_by TEXT,
      execution_status TEXT,
      total_turn_time_ms INTEGER,
      classification_time_ms INTEGER,
      execution_time_ms INTEGER,
      retry_count INTEGER DEFAULT 0,
      partial_failure INTEGER DEFAULT 0,
      was_cancelled INTEGER DEFAULT 0,
      circuit_opened INTEGER DEFAULT 0,
      snapshot_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE cre_override_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      execution_trace_id TEXT,
      conversation_id TEXT,
      session_id TEXT,
      event_type TEXT NOT NULL DEFAULT 'override',
      source TEXT NOT NULL,
      reason TEXT NOT NULL,
      decision_type TEXT,
      decision_intent TEXT,
      original_type TEXT,
      original_intent TEXT,
      confidence REAL,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE architecture_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lifecycle_id TEXT NOT NULL,
      milestone_id TEXT,
      phase TEXT NOT NULL DEFAULT 'post',
      layer_violations INTEGER DEFAULT 0,
      circular_deps INTEGER DEFAULT 0,
      naming_issues INTEGER DEFAULT 0,
      api_surface_count INTEGER DEFAULT 0,
      drift_score REAL DEFAULT 1.0,
      acf_score REAL DEFAULT 1.0,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE quality_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lifecycle_id TEXT NOT NULL,
      artifact_type TEXT NOT NULL,
      artifact_version INTEGER,
      score REAL NOT NULL,
      label TEXT NOT NULL,
      breakdown TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE specialist_telemetry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      specialist_id TEXT,
      tool_id TEXT,
      duration_ms INTEGER,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE model_desired_bindings (
      role TEXT PRIMARY KEY,
      model_name TEXT NOT NULL,
      digest_sha256 TEXT NOT NULL
    );
    CREATE TABLE model_evaluation_runs (
      run_id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_name TEXT,
      model_canonical_name TEXT,
      model_digest_sha256 TEXT NOT NULL,
      suite_name TEXT NOT NULL,
      suite_version TEXT,
      suite_contract_sha256 TEXT NOT NULL,
      role TEXT,
      status TEXT NOT NULL,
      score REAL,
      passed INTEGER DEFAULT 0,
      total INTEGER DEFAULT 0,
      repeats INTEGER DEFAULT 1,
      duration_ms INTEGER DEFAULT 0,
      error_code TEXT,
      error_message TEXT,
      started_at DATETIME,
      completed_at DATETIME
    );
    CREATE TABLE model_evaluation_decisions (
      decision_id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      incumbent_run_id TEXT NOT NULL,
      candidate_run_id TEXT NOT NULL,
      policy_version TEXT NOT NULL,
      policy_contract_sha256 TEXT NOT NULL,
      outcome TEXT NOT NULL,
      basis TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE discovered_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      family TEXT NOT NULL,
      params REAL,
      category TEXT,
      base_vram_mb INTEGER,
      context_window INTEGER,
      benchmarks_json TEXT,
      benchmark_confidence REAL,
      capabilities_json TEXT,
      source TEXT DEFAULT 'L4',
      discovered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE model_overrides (
      role TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      previous_model TEXT NOT NULL,
      score REAL,
      applied_by TEXT DEFAULT 'user',
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      verified INTEGER DEFAULT 1
    );
  `);

  return db;
}

function seedModelPerformance(db, role, success, count, opts = {}) {
  const stmt = db.prepare(
    `INSERT INTO model_performance (role, model, task_type, success, iterations, errors_remaining, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))`
  );
  for (let i = 0; i < count; i++) {
    stmt.run(role, opts.model || 'test:7b', opts.task_type || 'generation', success, opts.iterations || 1, opts.errors_remaining || 0, `-${i} hours`);
  }
}

function seedCurrentEvaluations(db, opts = {}) {
  const plans = createRoleEvaluationPlans();
  const missing = new Set(opts.missing || []);
  const statusByRole = opts.statusByRole || {};
  for (const [index, [role, plan]] of Object.entries(plans).entries()) {
    const digest = (index + 1).toString(16).padStart(64, '0');
    db.prepare(
      'INSERT INTO model_desired_bindings (role, model_name, digest_sha256) VALUES (?, ?, ?)'
    ).run(role, `current-${role.toLowerCase()}:latest`, digest);
    if (missing.has(role)) continue;
    db.prepare(`
      INSERT INTO model_evaluation_runs (
        model_digest_sha256, suite_name, suite_version, suite_contract_sha256, role, status,
        completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      digest,
      plan.suiteName,
      plan.suiteVersion,
      plan.suiteContractSha256,
      role,
      statusByRole[role] || 'COMPLETE',
    );
  }
}

function seedTelemetry(db, successCount, failCount, overrideCount = 0) {
  const stmt = db.prepare(
    `INSERT INTO telemetry_snapshots (turn_id, execution_status, partial_failure, total_turn_time_ms, created_at)
     VALUES (?, ?, ?, ?, datetime('now', ?))`
  );
  for (let i = 0; i < successCount; i++) {
    stmt.run(`t-s-${i}`, 'success', 0, 1000, `-${i} hours`);
  }
  for (let i = 0; i < failCount; i++) {
    stmt.run(`t-f-${i}`, 'error', 0, 2000, `-${i} hours`);
  }
  if (overrideCount > 0) {
    const ovStmt = db.prepare(
      `INSERT INTO cre_override_log (source, reason, created_at) VALUES (?, ?, datetime('now', ?))`
    );
    for (let i = 0; i < overrideCount; i++) {
      ovStmt.run('guard', 'test', `-${i} hours`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 1: HealthAnalyzer
// ═══════════════════════════════════════════════════════════════════════════════

suite('HealthAnalyzer — dimensions & aggregation');

test('classifyStatus thresholds', () => {
  assertEqual(classifyStatus(0.9), 'HEALTHY');
  assertEqual(classifyStatus(0.7), 'HEALTHY');
  assertEqual(classifyStatus(0.69), 'DEGRADED');
  assertEqual(classifyStatus(0.4), 'DEGRADED');
  assertEqual(classifyStatus(0.39), 'CRITICAL');
  assertEqual(classifyStatus(0.0), 'CRITICAL');
});

test('dimension weights sum to 1.0', () => {
  const sum = Object.values(DIMENSION_WEIGHTS).reduce((s, v) => s + v, 0);
  assert(Math.abs(sum - 1.0) < 0.001, `Weights sum to ${sum}, expected 1.0`);
});

test('tableExists returns false for missing table', () => {
  const db = new Database(':memory:');
  assert(!tableExists(db, 'nonexistent_table'));
  db.close();
});

test('tableExists returns true for existing table', () => {
  const db = createTestDb();
  assert(tableExists(db, 'model_performance'));
  db.close();
});

test('models dimension — empty DB returns fallback', () => {
  const db = createTestDb();
  const result = analyzeModels(db);
  assertEqual(result.score, 0.5);
  assertEqual(result.dataCompleteness, 0);
  assertIncludes(result.details.note, 'no data');
  db.close();
});

test('models dimension — high success', () => {
  const db = createTestDb();
  seedModelPerformance(db, 'D1', 1, 30);
  seedModelPerformance(db, 'CODE', 1, 30);
  const result = analyzeModels(db);
  assertEqual(result.score, 1.0);
  assertEqual(result.status, 'HEALTHY');
  assertEqual(result.dataCompleteness, 1.0); // 60 >= 50
  assertEqual(result.details.roles.length, 2);
  db.close();
});

test('models dimension — low success triggers CRITICAL', () => {
  const db = createTestDb();
  seedModelPerformance(db, 'D1', 0, 20);
  seedModelPerformance(db, 'D1', 1, 10);
  const result = analyzeModels(db);
  assert(result.score < 0.4, `Score ${result.score} should be CRITICAL`);
  assertEqual(result.status, 'CRITICAL');
  db.close();
});

test('models dimension — data completeness scales linearly', () => {
  const db = createTestDb();
  seedModelPerformance(db, 'D1', 1, 25);
  const result = analyzeModels(db);
  assertEqual(result.dataCompleteness, 0.5); // 25/50
  db.close();
});

test('CRE dimension — empty DB returns fallback', () => {
  const db = createTestDb();
  const result = analyzeCre(db);
  assertEqual(result.score, 0.5);
  assertIncludes(result.details.note, 'no telemetry');
  db.close();
});

test('CRE dimension — high success', () => {
  const db = createTestDb();
  seedTelemetry(db, 90, 10);
  const result = analyzeCre(db);
  assert(result.score > 0.6, `CRE score ${result.score} should be > 0.6`);
  assertEqual(result.status, 'HEALTHY');
  assertEqual(result.details.total, 100);
  assertEqual(result.dataCompleteness, 1.0); // 100/100
  db.close();
});

test('CRE dimension — overrides reduce score', () => {
  const db = createTestDb();
  seedTelemetry(db, 80, 0, 40); // 40 overrides out of 80
  const result = analyzeCre(db);
  // success_pct = 1.0, override_rate = 0.5
  // score = 1.0 * 0.7 + 0.5 * 0.3 = 0.85
  assert(result.score <= 0.9, `Score ${result.score} should be reduced by overrides`);
  assert(result.details.override_rate > 0.3, `Override rate should be > 0.3`);
  db.close();
});

test('architecture dimension — no records returns fallback', () => {
  const db = createTestDb();
  const result = analyzeArchitecture(db);
  assertEqual(result.score, 0.5);
  assertIncludes(result.details.note, 'no records');
  db.close();
});

test('architecture dimension — low drift = high score', () => {
  const db = createTestDb();
  db.prepare("INSERT INTO architecture_state (lifecycle_id, drift_score, layer_violations, circular_deps) VALUES (?, ?, ?, ?)").run('lc-1', 0.1, 0, 0);
  const result = analyzeArchitecture(db);
  assertEqual(result.score, 0.9); // 1 - 0.1
  assertEqual(result.status, 'HEALTHY');
  assertEqual(result.dataCompleteness, 1.0);
  db.close();
});

test('architecture dimension — high drift = low score', () => {
  const db = createTestDb();
  db.prepare("INSERT INTO architecture_state (lifecycle_id, drift_score, layer_violations, circular_deps) VALUES (?, ?, ?, ?)").run('lc-1', 0.8, 5, 3);
  const result = analyzeArchitecture(db);
  assert(Math.abs(result.score - 0.2) < 0.001, `Score ${result.score} ≈ 0.2`); // 1 - 0.8
  assertEqual(result.status, 'CRITICAL');
  db.close();
});

test('builds dimension — no data returns fallback', () => {
  const db = createTestDb();
  const result = analyzeBuilds(db);
  assertEqual(result.score, 0.5);
  db.close();
});

test('builds dimension — quality + checkpoint combined', () => {
  const db = createTestDb();
  for (let i = 0; i < 20; i++) {
    db.prepare("INSERT INTO quality_scores (lifecycle_id, artifact_type, score, label, created_at) VALUES (?, ?, ?, ?, datetime('now', ?))").run('lc-1', 'code', 0.9, 'good', `-${i} hours`);
  }
  seedModelPerformance(db, 'D1', 1, 10, { task_type: 'checkpoint' });
  const result = analyzeBuilds(db);
  // score = 0.9 * 0.6 + 1.0 * 0.4 = 0.94
  assert(result.score > 0.9, `Score ${result.score} should be > 0.9`);
  assertEqual(result.status, 'HEALTHY');
  assertEqual(result.dataCompleteness, 1.0); // 20/20
  db.close();
});

test('specialists dimension — empty returns fallback', () => {
  const db = createTestDb();
  const result = analyzeSpecialists(db);
  assertEqual(result.score, 0.5);
  db.close();
});

test('specialists dimension — outcome events only (ignores observability)', () => {
  const db = createTestDb();
  // Outcome events: 20 success, 10 fail
  for (let i = 0; i < 20; i++) db.prepare("INSERT INTO specialist_telemetry (event_type) VALUES (?)").run('tool.success');
  for (let i = 0; i < 10; i++) db.prepare("INSERT INTO specialist_telemetry (event_type) VALUES (?)").run('tool.fail');
  // Observability events (should NOT affect score)
  for (let i = 0; i < 50; i++) db.prepare("INSERT INTO specialist_telemetry (event_type) VALUES (?)").run('tool.match');
  for (let i = 0; i < 20; i++) db.prepare("INSERT INTO specialist_telemetry (event_type) VALUES (?)").run('memory.hit');
  const result = analyzeSpecialists(db);
  // score = 20 / 30 outcome events = 0.667 (not 20/100 total events = 0.2)
  assert(Math.abs(result.score - 20 / 30) < 0.01, `Score ${result.score} ≈ 0.667 (outcome-only)`);
  assertEqual(result.status, 'DEGRADED');
  assertEqual(result.details.outcome_total, 30);
  assertEqual(result.details.total, 100); // all events still tracked for details
  assertEqual(result.dataCompleteness, 1.0); // 30 outcome / 30 threshold
  db.close();
});

test('specialists dimension — only observability events returns fallback', () => {
  const db = createTestDb();
  for (let i = 0; i < 50; i++) db.prepare("INSERT INTO specialist_telemetry (event_type) VALUES (?)").run('tool.match');
  for (let i = 0; i < 20; i++) db.prepare("INSERT INTO specialist_telemetry (event_type) VALUES (?)").run('api.request');
  const result = analyzeSpecialists(db);
  assertEqual(result.score, 0.5);
  assertIncludes(result.details.note, 'no outcome');
  db.close();
});

test('upgrades dimension — missing current exact-contract evaluation penalizes', () => {
  const db = createTestDb();
  seedCurrentEvaluations(db, { missing: ['D1'] });
  const result = analyzeUpgrades(db);
  assertEqual(result.score, 0.8);
  assertEqual(result.details.current_evaluation_missing_roles.join(','), 'D1');
  db.close();
});

test('upgrades dimension — unrelated historical evaluation does not affect current state', () => {
  const db = createTestDb();
  seedCurrentEvaluations(db);
  db.prepare(`
    INSERT INTO model_evaluation_runs (
      model_digest_sha256, suite_name, suite_contract_sha256, status, completed_at
    ) VALUES (?, ?, ?, 'FAILED', datetime('now', '-20 days'))
  `).run('f'.repeat(64), 'retired_suite', 'e'.repeat(64));
  const result = analyzeUpgrades(db);
  assertEqual(result.score, 1.0);
  db.close();
});

test('full analyze — empty DB returns all fallbacks', () => {
  const db = new Database(':memory:');
  // No tables at all
  const result = healthAnalyzer.analyze(db);
  assert(result.overallScore > 0, 'Should have a positive score');
  assertEqual(result.overallHealth, 'DEGRADED'); // 0.5 weighted = ~0.5
  assert(result.summary.length > 0, 'Summary should not be empty');
  assert(result.dimensions.models, 'Should have models dimension');
  db.close();
});

test('full analyze — CRITICAL propagation', () => {
  const db = createTestDb();
  // Make models CRITICAL (all failures)
  seedModelPerformance(db, 'D1', 0, 50);
  // Make all others HEALTHY
  seedTelemetry(db, 100, 0);
  db.prepare("INSERT INTO architecture_state (lifecycle_id, drift_score) VALUES (?, ?)").run('lc-1', 0.0);
  for (let i = 0; i < 20; i++) db.prepare("INSERT INTO quality_scores (lifecycle_id, artifact_type, score, label) VALUES (?, ?, ?, ?)").run('lc-1', 'code', 1.0, 'perfect');
  for (let i = 0; i < 30; i++) db.prepare("INSERT INTO specialist_telemetry (event_type) VALUES (?)").run('tool.success');

  const result = healthAnalyzer.analyze(db);
  // Models dimension is CRITICAL → overall can't be HEALTHY even if score is above 0.7
  if (result.overallScore >= 0.7) {
    assertEqual(result.overallHealth, 'DEGRADED', 'CRITICAL propagation should prevent HEALTHY');
  }
  db.close();
});

test('trend analysis — improving trend boosts score', () => {
  const db = createTestDb();
  // Insert historical reports with low model scores
  for (let i = 0; i < 5; i++) {
    db.prepare("INSERT INTO governor_reports (overall_health, overall_score, dimensions, proposals_json, created_at) VALUES (?, ?, ?, ?, datetime('now', ?))").run(
      'DEGRADED', 0.5,
      JSON.stringify({ models: { score: 0.4, status: 'DEGRADED' }, cre: { score: 0.5 }, architecture: { score: 0.5 }, builds: { score: 0.5 }, specialists: { score: 0.5 }, upgrades: { score: 0.5 } }),
      '[]', `-${(i + 1) * 2} hours`
    );
  }
  // Now seed current data with high model success
  seedModelPerformance(db, 'D1', 1, 50);
  const result = healthAnalyzer.analyze(db);
  // The trend should be improving for models (current 1.0 vs historical avg 0.4)
  assert(result.dimensions.models.trendDirection === 'improving', `Expected improving, got ${result.dimensions.models.trendDirection}`);
  assert(result.dimensions.models.trend > 0.05, `Trend ${result.dimensions.models.trend} should be > 0.05`);
  db.close();
});

test('trend analysis — declining trend reduces score', () => {
  const db = createTestDb();
  // Historical high
  for (let i = 0; i < 5; i++) {
    db.prepare("INSERT INTO governor_reports (overall_health, overall_score, dimensions, proposals_json, created_at) VALUES (?, ?, ?, ?, datetime('now', ?))").run(
      'HEALTHY', 0.9,
      JSON.stringify({ models: { score: 0.95 }, cre: { score: 0.9 }, architecture: { score: 0.9 }, builds: { score: 0.9 }, specialists: { score: 0.9 }, upgrades: { score: 0.9 } }),
      '[]', `-${(i + 1) * 2} hours`
    );
  }
  // Current: low model success
  seedModelPerformance(db, 'D1', 0, 30);
  seedModelPerformance(db, 'D1', 1, 20);
  const result = healthAnalyzer.analyze(db);
  assert(result.dimensions.models.trendDirection === 'declining', `Expected declining, got ${result.dimensions.models.trendDirection}`);
  assert(result.dimensions.models.trend < -0.05, `Trend ${result.dimensions.models.trend} should be < -0.05`);
  db.close();
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 2: ImprovementPlanner
// ═══════════════════════════════════════════════════════════════════════════════

suite('ImprovementPlanner — 8 rules + confidence + priority');

test('computeConfidence formula is deterministic', () => {
  const c1 = computeConfidence('HIGH', 1.0, 0.4);
  // HIGH=0.9*0.5 + 1.0*0.3 + (0.4/0.4)*0.2 = 0.45 + 0.3 + 0.2 = 0.95
  assert(Math.abs(c1 - 0.95) < 0.01, `Expected 0.95, got ${c1}`);

  const c2 = computeConfidence('LOW', 0.0, 0.0);
  // LOW=0.3*0.5 + 0*0.3 + 0*0.2 = 0.15
  assert(Math.abs(c2 - 0.15) < 0.01, `Expected 0.15, got ${c2}`);
});

test('computePriority formula with recency', () => {
  const p1 = computePriority('HIGH', 0.9, true);
  // 1.0*0.6 + 0.9*0.3 + 1.0*0.1 = 0.6 + 0.27 + 0.1 = 0.97
  assert(Math.abs(p1 - 0.97) < 0.01, `Expected 0.97, got ${p1}`);

  const p2 = computePriority('HIGH', 0.9, false);
  // 1.0*0.6 + 0.9*0.3 + 0.5*0.1 = 0.6 + 0.27 + 0.05 = 0.92
  assert(Math.abs(p2 - 0.92) < 0.01, `Expected 0.92, got ${p2}`);
});

test('R1: model-low-success fires when role < 75%', () => {
  const dims = {
    models: { score: 0.5, status: 'DEGRADED', dataCompleteness: 1.0, trend: 0, details: {
      roles: [{ role: 'D1', success_rate: 0.6, samples: 50 }],
    }},
  };
  const p = ruleModelLowSuccess(dims);
  assert(p !== null, 'R1 should fire');
  assertEqual(p.rule_id, 'model-low-success');
  assertEqual(p.type, 'MODEL_SWITCH');
  assertEqual(p.severity, 'HIGH');
  assert(p.confidence > 0, 'Should have confidence');
  assert(p.action_payload, 'Should have action payload');
  assert(p.root_cause, 'Should have root cause');
});

test('R1: does not fire when all roles >= 75%', () => {
  const dims = {
    models: { score: 0.8, status: 'HEALTHY', dataCompleteness: 1.0, trend: 0, details: {
      roles: [{ role: 'D1', success_rate: 0.8, samples: 50 }],
    }},
  };
  assertEqual(ruleModelLowSuccess(dims), null);
});

test('R2: arch-drift-high fires when drift > 0.3', () => {
  const dims = {
    architecture: { score: 0.5, status: 'DEGRADED', dataCompleteness: 1.0, trend: 0, details: {
      drift_score: 0.5, layer_violations: 5, circular_deps: 2,
    }},
  };
  const p = ruleArchDrift(dims);
  assert(p !== null, 'R2 should fire');
  assertEqual(p.rule_id, 'arch-drift-high');
  assertEqual(p.type, 'DRIFT_SCAN');
  assertIncludes(p.root_cause, 'hranic');
});

test('R2: does not fire when drift <= 0.3', () => {
  const dims = {
    architecture: { score: 0.8, status: 'HEALTHY', dataCompleteness: 1.0, trend: 0, details: {
      drift_score: 0.2, layer_violations: 0, circular_deps: 0,
    }},
  };
  assertEqual(ruleArchDrift(dims), null);
});

test('R2: root cause picks circular deps when dominant', () => {
  const dims = {
    architecture: { score: 0.4, status: 'DEGRADED', dataCompleteness: 1.0, trend: 0, details: {
      drift_score: 0.6, layer_violations: 1, circular_deps: 5,
    }},
  };
  const p = ruleArchDrift(dims);
  assertIncludes(p.root_cause, 'cyklick');
});

test('R3: build-quality-low fires when avg < 0.85', () => {
  const dims = {
    builds: { score: 0.7, status: 'HEALTHY', dataCompleteness: 1.0, trend: 0, details: {
      avg_quality: 0.7, quality_count: 20, checkpoint_pass_rate: 0.8, checkpoint_count: 10,
    }},
  };
  const p = ruleBuildQualityLow(dims);
  assert(p !== null, 'R3 should fire');
  assertEqual(p.rule_id, 'build-quality-low');
});

test('R3: root cause — checkpoint too strict', () => {
  const dims = {
    builds: { score: 0.6, status: 'DEGRADED', dataCompleteness: 1.0, trend: 0, details: {
      avg_quality: 0.75, quality_count: 20, checkpoint_pass_rate: 0.5, checkpoint_count: 10,
    }},
  };
  const p = ruleBuildQualityLow(dims);
  assertIncludes(p.root_cause, 'checkpoint');
});

test('R4: cre-accuracy-low fires when score < 0.80', () => {
  const dims = {
    cre: { score: 0.6, status: 'DEGRADED', dataCompleteness: 1.0, trend: 0, details: {
      override_rate: 0.5, avg_latency_ms: 1000,
    }},
  };
  const p = ruleCRELow(dims);
  assert(p !== null, 'R4 should fire');
  assertEqual(p.rule_id, 'cre-accuracy-low');
  assertIncludes(p.root_cause, 'override');
});

test('R4: root cause — model overload', () => {
  const dims = {
    cre: { score: 0.6, status: 'DEGRADED', dataCompleteness: 1.0, trend: 0, details: {
      override_rate: 0.1, avg_latency_ms: 8000,
    }},
  };
  const p = ruleCRELow(dims);
  assertIncludes(p.root_cause, 'latence');
});

test('R6: incomplete current exact-contract evaluation fires', () => {
  const dims = {
    upgrades: { score: 0.7, status: 'HEALTHY', dataCompleteness: 1.0, trend: 0, details: {
      current_evaluation_missing_roles: ['D1'],
      current_evaluation_failed_roles: [],
      current_evaluation_blocked_roles: [],
      durable_binding_count: 7,
    }},
  };
  const p = ruleModelUnvalidated(dims);
  assert(p !== null, 'R6 should fire');
  assertEqual(p.type, 'MODEL_EVALUATION_REVIEW');
  assertIncludes(p.root_cause, 'D1');
});

test('R7: specialist-failing fires when score < 0.70', () => {
  const dims = {
    specialists: { score: 0.5, status: 'DEGRADED', dataCompleteness: 1.0, trend: 0, details: {} },
  };
  const p = ruleSpecialistFailing(dims);
  assert(p !== null, 'R7 should fire');
  assertEqual(p.type, 'SPECIALIST_CHECK');
  assertIncludes(p.root_cause, '50%');
});

test('R8: model-drift detects decline > 15%', () => {
  const db = createTestDb();
  // Older 20 samples: 90% success
  const stmtOld = db.prepare("INSERT INTO model_performance (role, model, task_type, success, created_at) VALUES (?, ?, ?, ?, datetime('now', ?))");
  for (let i = 0; i < 20; i++) {
    stmtOld.run('D1', 'test:7b', 'generation', i < 18 ? 1 : 0, `-${40 + i} hours`);
  }
  // Recent 20 samples: 50% success
  for (let i = 0; i < 20; i++) {
    stmtOld.run('D1', 'test:7b', 'generation', i < 10 ? 1 : 0, `-${i} hours`);
  }

  const dims = { models: { score: 0.5, status: 'DEGRADED', dataCompleteness: 1.0, trend: -0.2 } };
  const p = ruleModelDrift(dims, db);
  assert(p !== null, 'R8 should fire');
  assertEqual(p.rule_id, 'model-drift');
  assertEqual(p.severity, 'HIGH');
  assertIncludes(p.root_cause, 'D1');
  db.close();
});

test('R8: no drift when difference <= 15%', () => {
  const db = createTestDb();
  const stmt = db.prepare("INSERT INTO model_performance (role, model, task_type, success, created_at) VALUES (?, ?, ?, ?, datetime('now', ?))");
  for (let i = 0; i < 40; i++) {
    stmt.run('D1', 'test:7b', 'generation', 1, `-${i} hours`);
  }
  const dims = { models: { score: 1.0, status: 'HEALTHY', dataCompleteness: 1.0, trend: 0 } };
  assertEqual(ruleModelDrift(dims, db), null);
  db.close();
});

test('evaluate returns multiple proposals when conditions met', () => {
  const db = createTestDb();
  const analysis = {
    dimensions: {
      models: { score: 0.5, status: 'DEGRADED', dataCompleteness: 1.0, trend: -0.1, details: {
        roles: [{ role: 'D1', success_rate: 0.5, samples: 50 }],
      }},
      cre: { score: 0.6, status: 'DEGRADED', dataCompleteness: 1.0, trend: 0, details: { override_rate: 0.1, avg_latency_ms: 1000 }},
      architecture: { score: 0.5, status: 'DEGRADED', dataCompleteness: 1.0, trend: 0, details: { drift_score: 0.5, layer_violations: 3, circular_deps: 1 }},
      builds: { score: 0.7, status: 'HEALTHY', dataCompleteness: 1.0, trend: 0, details: { avg_quality: 0.7, quality_count: 20, checkpoint_pass_rate: 0.8 }},
      specialists: { score: 0.5, status: 'DEGRADED', dataCompleteness: 1.0, trend: 0, details: {} },
      upgrades: { score: 0.9, status: 'HEALTHY', dataCompleteness: 1.0, trend: 0, details: {
current_evaluation_missing_roles: [],
        current_evaluation_failed_roles: [], current_evaluation_blocked_roles: [],
        durable_binding_count: 7,
      }},
    },
  };
  const proposals = improvementPlanner.evaluate(analysis, db);
  assert(proposals.length >= 4, `Expected >= 4 proposals, got ${proposals.length}`);
  // R1 (models), R2 (arch), R3 (builds), R4 (cre), R7 (specialists)
  const ruleIds = proposals.map(p => p.rule_id);
  assert(ruleIds.includes('model-low-success'), 'R1 should fire');
  assert(ruleIds.includes('arch-drift-high'), 'R2 should fire');
  assert(ruleIds.includes('build-quality-low'), 'R3 should fire');
  assert(ruleIds.includes('cre-accuracy-low'), 'R4 should fire');
  assert(ruleIds.includes('specialist-failing'), 'R7 should fire');
  db.close();
});

test('action payload has valid JSON structure', () => {
  const dims = {
    models: { score: 0.5, status: 'DEGRADED', dataCompleteness: 1.0, trend: 0, details: {
      roles: [{ role: 'D1', success_rate: 0.5, samples: 50 }],
    }},
  };
  const p = ruleModelLowSuccess(dims);
  const payload = JSON.parse(p.action_payload);
  assert(payload.type, 'Payload should have type');
  assert(payload.target, 'Payload should have target');
  assert(payload.hint, 'Payload should have hint');
});

test('rule isolation — one failing dimension does not trigger unrelated rules', () => {
  const analysis = {
    dimensions: {
      models: { score: 0.3, status: 'CRITICAL', dataCompleteness: 1.0, trend: 0, details: {
        roles: [{ role: 'D1', success_rate: 0.3, samples: 50 }],
      }},
      cre: { score: 0.95, status: 'HEALTHY', dataCompleteness: 1.0, trend: 0, details: { override_rate: 0.01, avg_latency_ms: 500 }},
      architecture: { score: 0.95, status: 'HEALTHY', dataCompleteness: 1.0, trend: 0, details: { drift_score: 0.05, layer_violations: 0, circular_deps: 0 }},
      builds: { score: 0.95, status: 'HEALTHY', dataCompleteness: 1.0, trend: 0, details: { avg_quality: 0.95, quality_count: 20 }},
      specialists: { score: 0.95, status: 'HEALTHY', dataCompleteness: 1.0, trend: 0, details: {} },
      upgrades: { score: 0.95, status: 'HEALTHY', dataCompleteness: 1.0, trend: 0, details: {
current_evaluation_missing_roles: [],
        current_evaluation_failed_roles: [], current_evaluation_blocked_roles: [],
        durable_binding_count: 7,
      }},
    },
  };
  const proposals = improvementPlanner.evaluate(analysis);
  // Only R1 should fire (model-low-success)
  assertEqual(proposals.length, 1, `Expected 1 proposal, got ${proposals.length}`);
  assertEqual(proposals[0].rule_id, 'model-low-success');
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 3: SafetyGuard
// ═══════════════════════════════════════════════════════════════════════════════

suite('SafetyGuard — validation + dedup + cooldown');

test('computeHash is deterministic', () => {
  const h1 = computeHash('rule-1', 'MODEL_SWITCH', { role: 'D1' });
  const h2 = computeHash('rule-1', 'MODEL_SWITCH', { role: 'D1' });
  assertEqual(h1, h2);
});

test('computeHash differs on different inputs', () => {
  const h1 = computeHash('rule-1', 'MODEL_SWITCH', { role: 'D1' });
  const h2 = computeHash('rule-1', 'MODEL_SWITCH', { role: 'CODE' });
  assert(h1 !== h2, 'Different inputs should produce different hashes');
});

test('validateProposal rejects missing type', () => {
  const err = validateProposal({ severity: 'HIGH', title: 'x', description: 'x', confidence: 0.5 });
  assertIncludes(err, 'type');
});

test('validateProposal rejects invalid severity', () => {
  const err = validateProposal({ type: 'MODEL_SWITCH', severity: 'EXTREME', title: 'x', description: 'x', confidence: 0.5 });
  assertIncludes(err, 'severity');
});

test('validateProposal rejects low confidence', () => {
  const err = validateProposal({ type: 'MODEL_SWITCH', severity: 'HIGH', title: 'x', description: 'x', confidence: 0.1 });
  assertIncludes(err, 'Confidence');
});

test('validateProposal accepts valid proposal', () => {
  const err = validateProposal({ type: 'MODEL_SWITCH', severity: 'HIGH', title: 'x', description: 'x', confidence: 0.5 });
  assertEqual(err, null);
});

test('filterSafe rejects proposals with invalid type', () => {
  const db = createTestDb();
  const proposals = [{
    rule_id: 'test', type: 'INVALID', severity: 'HIGH', title: 'x', description: 'x',
    confidence: 0.5, priority: 0.5, _keyDetails: {},
  }];
  const safe = safetyGuard.filterSafe(proposals, db);
  assertEqual(safe.length, 0);
  db.close();
});

test('filterSafe dedup blocks duplicate pending proposals', () => {
  const db = createTestDb();
  const hash = computeHash('r1', 'MODEL_SWITCH', { role: 'D1' });
  // Insert dummy report for FK
  db.prepare("INSERT INTO governor_reports (overall_health, overall_score, dimensions, proposals_json) VALUES ('HEALTHY', 0.9, '{}', '[]')").run();
  // Insert existing pending proposal with same hash
  db.prepare("INSERT INTO governor_proposals (report_id, rule_id, type, severity, title, description, confidence, priority, hash, status) VALUES (1, 'r1', 'MODEL_SWITCH', 'HIGH', 'x', 'x', 0.5, 0.5, ?, 'pending')").run(hash);

  const proposals = [{
    rule_id: 'r1', type: 'MODEL_SWITCH', severity: 'HIGH', title: 'x', description: 'x',
    confidence: 0.5, priority: 0.5, _keyDetails: { role: 'D1' },
  }];
  const safe = safetyGuard.filterSafe(proposals, db);
  assertEqual(safe.length, 0, 'Duplicate pending should be blocked');
  db.close();
});

test('filterSafe blocks proposal when existing is approved (acknowledged)', () => {
  const db = createTestDb();
  const hash = computeHash('r1', 'MODEL_SWITCH', { role: 'D1' });
  db.prepare("INSERT INTO governor_reports (overall_health, overall_score, dimensions, proposals_json) VALUES ('HEALTHY', 0.9, '{}', '[]')").run();
  db.prepare("INSERT INTO governor_proposals (report_id, rule_id, type, severity, title, description, confidence, priority, hash, status) VALUES (1, 'r1', 'MODEL_SWITCH', 'HIGH', 'x', 'x', 0.5, 0.5, ?, 'approved')").run(hash);

  const proposals = [{
    rule_id: 'r1', type: 'MODEL_SWITCH', severity: 'HIGH', title: 'x', description: 'x',
    confidence: 0.5, priority: 0.5, _keyDetails: { role: 'D1' },
  }];
  const safe = safetyGuard.filterSafe(proposals, db);
  assertEqual(safe.length, 0, 'Approved (acknowledged) proposals should not be re-proposed');
  db.close();
});

test('filterSafe allows proposal when existing is dismissed with expired cooldown', () => {
  const db = createTestDb();
  const hash = computeHash('r1', 'MODEL_SWITCH', { role: 'D1' });
  db.prepare("INSERT INTO governor_reports (overall_health, overall_score, dimensions, proposals_json) VALUES ('HEALTHY', 0.9, '{}', '[]')").run();
  // Use SQLite-compatible datetime format (YYYY-MM-DD HH:MM:SS) — 1 hour in the past
  const d = new Date(Date.now() - 3600_000);
  const pastTime = d.getUTCFullYear() + '-' + String(d.getUTCMonth()+1).padStart(2,'0') + '-' + String(d.getUTCDate()).padStart(2,'0') + ' ' + String(d.getUTCHours()).padStart(2,'0') + ':' + String(d.getUTCMinutes()).padStart(2,'0') + ':' + String(d.getUTCSeconds()).padStart(2,'0');
  db.prepare("INSERT INTO governor_proposals (report_id, rule_id, type, severity, title, description, confidence, priority, hash, status, cooldown_until) VALUES (1, 'r1', 'MODEL_SWITCH', 'HIGH', 'x', 'x', 0.5, 0.5, ?, 'dismissed', ?)").run(hash, pastTime);

  const proposals = [{
    rule_id: 'r1', type: 'MODEL_SWITCH', severity: 'HIGH', title: 'x', description: 'x',
    confidence: 0.5, priority: 0.5, _keyDetails: { role: 'D1' },
  }];
  const safe = safetyGuard.filterSafe(proposals, db);
  assertEqual(safe.length, 1, 'Dismissed with expired cooldown should allow re-proposal');
  db.close();
});

test('filterSafe cooldown blocks dismissed proposals', () => {
  const db = createTestDb();
  const hash = computeHash('r1', 'MODEL_SWITCH', { role: 'D1' });
  db.prepare("INSERT INTO governor_reports (overall_health, overall_score, dimensions, proposals_json) VALUES ('HEALTHY', 0.9, '{}', '[]')").run();
  // Use SQLite-compatible datetime format — 1 hour in the future
  const d = new Date(Date.now() + 3600_000);
  const futureTime = d.getUTCFullYear() + '-' + String(d.getUTCMonth()+1).padStart(2,'0') + '-' + String(d.getUTCDate()).padStart(2,'0') + ' ' + String(d.getUTCHours()).padStart(2,'0') + ':' + String(d.getUTCMinutes()).padStart(2,'0') + ':' + String(d.getUTCSeconds()).padStart(2,'0');
  db.prepare("INSERT INTO governor_proposals (report_id, rule_id, type, severity, title, description, confidence, priority, hash, status, cooldown_until) VALUES (1, 'r1', 'MODEL_SWITCH', 'HIGH', 'x', 'x', 0.5, 0.5, ?, 'dismissed', ?)").run(hash, futureTime);

  const proposals = [{
    rule_id: 'r1', type: 'MODEL_SWITCH', severity: 'HIGH', title: 'x', description: 'x',
    confidence: 0.5, priority: 0.5, _keyDetails: { role: 'D1' },
  }];
  const safe = safetyGuard.filterSafe(proposals, db);
  assertEqual(safe.length, 0, 'Should be blocked by cooldown');
  db.close();
});

test('filterSafe preserves input order', () => {
  const db = createTestDb();
  const proposals = [
    { rule_id: 'r1', type: 'MODEL_SWITCH', severity: 'HIGH', title: 'First', description: 'x', confidence: 0.5, priority: 0.9, _keyDetails: { a: 1 } },
    { rule_id: 'r2', type: 'DRIFT_SCAN', severity: 'MEDIUM', title: 'Second', description: 'x', confidence: 0.5, priority: 0.5, _keyDetails: { b: 2 } },
    { rule_id: 'r3', type: 'QUALITY_REVIEW', severity: 'LOW', title: 'Third', description: 'x', confidence: 0.5, priority: 0.3, _keyDetails: { c: 3 } },
  ];
  const safe = safetyGuard.filterSafe(proposals, db);
  assertEqual(safe.length, 3);
  assertEqual(safe[0].title, 'First');
  assertEqual(safe[1].title, 'Second');
  assertEqual(safe[2].title, 'Third');
  db.close();
});

test('filterSafe strips _keyDetails from output', () => {
  const db = createTestDb();
  const proposals = [{
    rule_id: 'r1', type: 'MODEL_SWITCH', severity: 'HIGH', title: 'x', description: 'x',
    confidence: 0.5, priority: 0.5, _keyDetails: { role: 'D1' },
  }];
  const safe = safetyGuard.filterSafe(proposals, db);
  assertEqual(safe.length, 1);
  assert(safe[0]._keyDetails === undefined, '_keyDetails should be stripped');
  assert(safe[0].hash, 'hash should be added');
  db.close();
});

test('cooldown hours are severity-based', () => {
  assertEqual(COOLDOWN_HOURS.HIGH, 3);
  assertEqual(COOLDOWN_HOURS.MEDIUM, 12);
  assertEqual(COOLDOWN_HOURS.LOW, 24);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 4: SystemGovernor
// ═══════════════════════════════════════════════════════════════════════════════

suite('SystemGovernor — pipeline + persistence + WS');

// Use dynamic import for singleton reset
async function createFreshGovernor() {
  // We create a fresh instance by importing the class logic
  // Since systemGovernor is singleton, we test via the module
  const { systemGovernor } = await import('../src/system/governor/system-governor.js');
  return systemGovernor;
}

await testAsync('runCheck fails without setDb', async () => {
  // Create a new instance via the class
  const mod = await import('../src/system/governor/system-governor.js');
  // The singleton starts without db
  // We need to create a clean test — let's just verify the error path
  // For a fresh governor, we'd need a separate instance
  // Since it's a singleton, let's just test via new SystemGovernor
  // Actually the module exports the singleton. Let's work with it.
  // Save the current state and restore
  const gov = mod.systemGovernor;
  const savedDb = gov._db;
  gov._db = null;
  gov._stmts = null;
  try {
    let threw = false;
    try { gov.runCheck(); } catch (e) { threw = true; assertIncludes(e.message, 'not initialized'); }
    assert(threw, 'Should throw when not initialized');
  } finally {
    if (savedDb) { gov._db = savedDb; }
  }
});

await testAsync('setDb restores last report from DB (post-restart recovery)', async () => {
  const db = createTestDb();
  // Simulate a previous report persisted in DB
  db.prepare(
    "INSERT INTO governor_reports (overall_health, overall_score, dimensions, proposals_json, summary) VALUES (?, ?, ?, ?, ?)"
  ).run('DEGRADED', 0.65, JSON.stringify({ models: { score: 0.5 } }), '[]', 'test summary');

  const { systemGovernor } = await import('../src/system/governor/system-governor.js');
  systemGovernor._lastRunTime = 0;
  systemGovernor._lastReport = null;
  systemGovernor._lastRuleIds = new Set();
  systemGovernor.setDb(db);

  // After setDb, last report should be restored from DB
  assert(systemGovernor._lastReport !== null, 'Last report should be restored');
  assertEqual(systemGovernor._lastReport.overallHealth, 'DEGRADED');
  assert(Math.abs(systemGovernor._lastReport.overallScore - 0.65) < 0.01, 'Score should be restored');
  assertEqual(systemGovernor._lastReport.summary, 'test summary');

  // getStatus should reflect the restored report
  const status = systemGovernor.getStatus();
  assertEqual(status.overallHealth, 'DEGRADED');
  db.close();
});

await testAsync('full pipeline — runCheck persists report + proposals', async () => {
  const db = createTestDb();
  const { systemGovernor } = await import('../src/system/governor/system-governor.js');

  // Reset state
  systemGovernor._lastRunTime = 0;
  systemGovernor._lastReport = null;
  systemGovernor._lastRuleIds = new Set();
  systemGovernor._broadcast = null;
  systemGovernor.setDb(db);

  // Seed data that triggers R1 (model-low-success)
  seedModelPerformance(db, 'D1', 0, 30);
  seedModelPerformance(db, 'D1', 1, 10);
  seedTelemetry(db, 90, 10);

  const report = systemGovernor.runCheck();
  assert(report.overallHealth, 'Should have overallHealth');
  assert(typeof report.overallScore === 'number', 'Should have overallScore');
  assert(report.dimensions, 'Should have dimensions');
  assert(report.summary, 'Should have summary');

  // Check DB persistence
  const dbReport = db.prepare("SELECT * FROM governor_reports ORDER BY id DESC LIMIT 1").get();
  assert(dbReport, 'Report should be persisted');
  assertEqual(dbReport.overall_health, report.overallHealth);

  // Check proposals were persisted
  const dbProposals = db.prepare("SELECT * FROM governor_proposals WHERE report_id = ?").all(dbReport.id);
  assert(dbProposals.length > 0, 'Proposals should be persisted');
  db.close();
});

await testAsync('rate limit blocks rapid checks', async () => {
  const db = createTestDb();
  const { systemGovernor } = await import('../src/system/governor/system-governor.js');
  systemGovernor._lastRunTime = 0;
  systemGovernor._lastReport = null;
  systemGovernor._lastRuleIds = new Set();
  systemGovernor.setDb(db);

  systemGovernor.runCheck();

  let rateLimited = false;
  try { systemGovernor.runCheck(); } catch (e) {
    if (e.code === 'RATE_LIMITED') rateLimited = true;
  }
  assert(rateLimited, 'Second check should be rate-limited');
  db.close();
});

await testAsync('idempotent skip when score delta < 0.02', async () => {
  const db = createTestDb();
  const { systemGovernor } = await import('../src/system/governor/system-governor.js');
  systemGovernor._lastRunTime = 0;
  systemGovernor._lastReport = null;
  systemGovernor._lastRuleIds = new Set();
  systemGovernor.setDb(db);

  // First check
  const r1 = systemGovernor.runCheck();

  // Simulate that the rate limit has passed but within idempotent window
  systemGovernor._lastRunTime = Date.now() - 35_000; // past rate limit (30s) but within idempotent (60s)

  const r2 = systemGovernor.runCheck();
  assert(r2.skipped === true, 'Should be skipped as idempotent');
  db.close();
});

await testAsync('approveProposal sets status to approved', async () => {
  const db = createTestDb();
  const { systemGovernor } = await import('../src/system/governor/system-governor.js');
  systemGovernor._lastRunTime = 0;
  systemGovernor._lastReport = null;
  systemGovernor._lastRuleIds = new Set();
  systemGovernor.setDb(db);

  // Seed data to trigger proposals
  seedModelPerformance(db, 'D1', 0, 50);
  systemGovernor.runCheck();

  const proposals = db.prepare("SELECT * FROM governor_proposals WHERE status = 'pending'").all();
  if (proposals.length > 0) {
    const result = systemGovernor.approveProposal(proposals[0].id);
    assert(result.success, 'Should succeed');
    const updated = db.prepare("SELECT status FROM governor_proposals WHERE id = ?").get(proposals[0].id);
    assertEqual(updated.status, 'approved');
  }
  db.close();
});

await testAsync('dismissProposal sets cooldown', async () => {
  const db = createTestDb();
  const { systemGovernor } = await import('../src/system/governor/system-governor.js');
  systemGovernor._lastRunTime = 0;
  systemGovernor._lastReport = null;
  systemGovernor._lastRuleIds = new Set();
  systemGovernor.setDb(db);

  seedModelPerformance(db, 'D1', 0, 50);
  systemGovernor.runCheck();

  const proposals = db.prepare("SELECT * FROM governor_proposals WHERE status = 'pending'").all();
  if (proposals.length > 0) {
    const result = systemGovernor.dismissProposal(proposals[0].id);
    assert(result.success, 'Should succeed');
    const updated = db.prepare("SELECT status, cooldown_until FROM governor_proposals WHERE id = ?").get(proposals[0].id);
    assertEqual(updated.status, 'dismissed');
    assert(updated.cooldown_until, 'Should have cooldown_until');
    // Verify cooldown is in the future (toISOString includes Z suffix)
    const cooldownTime = Date.parse(updated.cooldown_until);
    assert(!isNaN(cooldownTime), `Cooldown should be parseable: ${updated.cooldown_until}`);
    assert(cooldownTime > Date.now() - 5_000, 'Cooldown should be in the near future');
  }
  db.close();
});

await testAsync('approveProposal returns error for non-existent id', async () => {
  const db = createTestDb();
  const { systemGovernor } = await import('../src/system/governor/system-governor.js');
  systemGovernor._lastRunTime = 0;
  systemGovernor._lastReport = null;
  systemGovernor._lastRuleIds = new Set();
  systemGovernor.setDb(db);

  const result = systemGovernor.approveProposal(9999);
  assertEqual(result.success, false);
  assertEqual(result.error, 'not_found');
  db.close();
});

await testAsync('approveProposal returns error for already approved', async () => {
  const db = createTestDb();
  const { systemGovernor } = await import('../src/system/governor/system-governor.js');
  systemGovernor._lastRunTime = 0;
  systemGovernor._lastReport = null;
  systemGovernor._lastRuleIds = new Set();
  systemGovernor.setDb(db);

  seedModelPerformance(db, 'D1', 0, 50);
  systemGovernor.runCheck();

  const proposals = db.prepare("SELECT * FROM governor_proposals WHERE status = 'pending'").all();
  if (proposals.length > 0) {
    systemGovernor.approveProposal(proposals[0].id);
    const result = systemGovernor.approveProposal(proposals[0].id);
    assertEqual(result.success, false);
    assertEqual(result.error, 'not_pending');
  }
  db.close();
});

await testAsync('WS broadcast called with diff payload', async () => {
  const db = createTestDb();
  const { systemGovernor } = await import('../src/system/governor/system-governor.js');
  systemGovernor._lastRunTime = 0;
  systemGovernor._lastReport = null;
  systemGovernor._lastRuleIds = new Set();

  let wsPayload = null;
  systemGovernor.setBroadcast((channel, data) => { wsPayload = { channel, data }; });
  systemGovernor.setDb(db);

  seedModelPerformance(db, 'D1', 0, 50);
  systemGovernor.runCheck();

  assert(wsPayload !== null, 'WS broadcast should have been called');
  assertEqual(wsPayload.channel, 'control');
  assertEqual(wsPayload.data.action, 'governor_report');
  assert(wsPayload.data.overallHealth, 'Should include overallHealth');
  assert(wsPayload.data.diff, 'Should include diff');
  assert(Array.isArray(wsPayload.data.diff.newProposals), 'diff.newProposals should be array');
  assert(typeof wsPayload.data.diff.healthChanged === 'boolean', 'diff.healthChanged should be boolean');
  assert(typeof wsPayload.data.diff.scoreChange === 'number', 'diff.scoreChange should be number');
  db.close();
});

await testAsync('getStatus returns correct shape', async () => {
  const db = createTestDb();
  const { systemGovernor } = await import('../src/system/governor/system-governor.js');
  systemGovernor._lastRunTime = 0;
  systemGovernor._lastReport = null;
  systemGovernor._lastRuleIds = new Set();
  systemGovernor.setDb(db);

  const status = systemGovernor.getStatus();
  assertEqual(status.enabled, true);
  assertEqual(status.lastCheckTime, null); // not run yet
  assertEqual(status.overallHealth, null);
  assertEqual(typeof status.proposalCount, 'number');
  db.close();
});

await testAsync('getStatus after check returns health data', async () => {
  const db = createTestDb();
  const { systemGovernor } = await import('../src/system/governor/system-governor.js');
  systemGovernor._lastRunTime = 0;
  systemGovernor._lastReport = null;
  systemGovernor._lastRuleIds = new Set();
  systemGovernor.setDb(db);

  systemGovernor.runCheck();
  const status = systemGovernor.getStatus();
  assert(status.lastCheckTime !== null, 'Should have lastCheckTime after check');
  assert(status.overallHealth !== null, 'Should have overallHealth after check');
  assert(typeof status.overallScore === 'number', 'Should have overallScore');
  db.close();
});

await testAsync('getLatestReport returns parsed dimensions', async () => {
  const db = createTestDb();
  const { systemGovernor } = await import('../src/system/governor/system-governor.js');
  systemGovernor._lastRunTime = 0;
  systemGovernor._lastReport = null;
  systemGovernor._lastRuleIds = new Set();
  systemGovernor.setDb(db);

  systemGovernor.runCheck();
  const report = systemGovernor.getLatestReport();
  assert(report, 'Should return a report');
  assert(report.dimensions, 'Should have dimensions');
  assert(report.dimensions.models, 'Should have models dimension');
  assert(report.dimensions.cre, 'Should have cre dimension');
  assert(typeof report.overallScore === 'number', 'overallScore should be number');
  db.close();
});

await testAsync('getProposals returns pending proposals sorted by priority', async () => {
  const db = createTestDb();
  const { systemGovernor } = await import('../src/system/governor/system-governor.js');
  systemGovernor._lastRunTime = 0;
  systemGovernor._lastReport = null;
  systemGovernor._lastRuleIds = new Set();
  systemGovernor.setDb(db);

  // Seed data to trigger multiple rules
  seedModelPerformance(db, 'D1', 0, 50);
  db.prepare("INSERT INTO architecture_state (lifecycle_id, drift_score, layer_violations, circular_deps) VALUES (?, ?, ?, ?)").run('lc-1', 0.5, 5, 2);
  systemGovernor.runCheck();

  const proposals = systemGovernor.getProposals('pending');
  assert(proposals.length > 0, 'Should have pending proposals');
  // Verify sorted by priority DESC
  for (let i = 1; i < proposals.length; i++) {
    assert(proposals[i - 1].priority >= proposals[i].priority, `Proposals should be sorted by priority DESC`);
  }
  db.close();
});

await testAsync('trend accumulation across multiple checks', async () => {
  const db = createTestDb();
  const { systemGovernor } = await import('../src/system/governor/system-governor.js');
  systemGovernor._lastRunTime = 0;
  systemGovernor._lastReport = null;
  systemGovernor._lastRuleIds = new Set();
  systemGovernor.setDb(db);

  // First check — establishes baseline
  seedModelPerformance(db, 'D1', 1, 50);
  systemGovernor.runCheck();

  // Wait and do second check — should have trend from first report
  systemGovernor._lastRunTime = 0; // bypass rate limit
  systemGovernor._lastReport = null; // bypass idempotency

  const r2 = systemGovernor.runCheck();
  // Should have stable trend (same data)
  assertEqual(r2.dimensions.models.trendDirection, 'stable');

  // Verify governor_reports now has 2 rows
  const count = db.prepare("SELECT COUNT(*) as c FROM governor_reports").get();
  assertEqual(count.c, 2);
  db.close();
});

await testAsync('dedup prevents duplicate proposals across checks', async () => {
  const db = createTestDb();
  const { systemGovernor } = await import('../src/system/governor/system-governor.js');
  systemGovernor._lastRunTime = 0;
  systemGovernor._lastReport = null;
  systemGovernor._lastRuleIds = new Set();
  systemGovernor.setDb(db);

  // Trigger R1
  seedModelPerformance(db, 'D1', 0, 50);
  systemGovernor.runCheck();

  const proposalsAfterFirst = db.prepare("SELECT * FROM governor_proposals WHERE status = 'pending'").all();

  // Do another check — same conditions, should not create duplicate
  systemGovernor._lastRunTime = 0;
  systemGovernor._lastReport = null;
  systemGovernor.runCheck();

  const proposalsAfterSecond = db.prepare("SELECT * FROM governor_proposals WHERE status = 'pending'").all();
  // The dedup in safety guard should prevent duplicates
  assertEqual(proposalsAfterSecond.length, proposalsAfterFirst.length, 'Should not create duplicate proposals');
  db.close();
});

// ═══════════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════════

const results = summary();
process.exit(results.failed > 0 ? 1 : 0);
