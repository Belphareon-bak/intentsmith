// Lifecycle REVIEW + CHANGE Tests
// ══════════════════════════════════════════════════════════════════════════════
// Tests: getDriftHistory, getAggregateHealth, validatePreservation,
//        rejectChange, listChangeRequests, DriftCheckType
//
// Run: node tests/lifecycle-review-change.test.js
// ══════════════════════════════════════════════════════════════════════════════

import { DriftCheckType, getDriftHistory, getAggregateHealth } from '../src/planner/lifecycle-review.js';
import { validatePreservation, rejectChange, listChangeRequests } from '../src/planner/lifecycle-change.js';
import {
  lifecycles as lifecycleRepo,
  milestones as msRepo,
  roadmapVersions,
  changeRequests as crRepo,
  driftChecks,
  projects,
  db,
} from '../src/db/database.js';

let passed = 0;
let failed = 0;
const failures = [];

function pass(name) {
  console.log(`  ✅ ${name}`);
  passed++;
}

function fail(name, msg) {
  console.log(`  ❌ ${name}: ${msg}`);
  failed++;
  failures.push({ name, msg });
}

function assert(condition, name, detail = '') {
  if (condition) pass(name);
  else fail(name, detail || 'assertion failed');
}

function assertThrows(fn, name) {
  try {
    fn();
    fail(name, 'expected throw');
  } catch {
    pass(name);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// Setup
// ════════════════════════════════════════════════════════════════════════════════

const testProjectName = `lc-rc-test-${Date.now()}`;
let testProjectId;

try {
  const result = projects.create.run(testProjectName, `/tmp/${testProjectName}`, 'review/change test');
  testProjectId = Number(result.lastInsertRowid);
} catch {
  const existing = projects.findByName.get(testProjectName);
  testProjectId = existing.id;
}

function setupLifecycle(suffix) {
  const lcId = `lc-rc-${Date.now()}-${suffix}`;
  lifecycleRepo.save(lcId, testProjectId, 'BUILD', null, {});
  return lcId;
}

function addMs(lcId, id, seq, status = 'PENDING', healthScore = null) {
  msRepo.addMilestone({
    id,
    lifecycle_id: lcId,
    roadmap_version: 1,
    sequence: seq,
    title: `Milestone ${seq}`,
    dependencies: [],
    estimated_loc: 500,
    estimated_files: 4,
    max_retries: 3,
  });
  if (status === 'PASSED') {
    const hsStr = healthScore ? JSON.stringify(healthScore) : null;
    msRepo.updateCompletion.run('h' + seq, 't' + seq, hsStr, id);
  } else if (status !== 'PENDING') {
    msRepo.updateStatus.run(status, id);
  }
}

function cleanup(lcId) {
  db.prepare('DELETE FROM drift_checks WHERE lifecycle_id = ?').run(lcId);
  db.prepare('DELETE FROM change_requests WHERE lifecycle_id = ?').run(lcId);
  db.prepare('DELETE FROM milestones WHERE lifecycle_id = ?').run(lcId);
  db.prepare('DELETE FROM roadmap_versions WHERE lifecycle_id = ?').run(lcId);
  db.prepare('DELETE FROM project_lifecycles WHERE id = ?').run(lcId);
}

// ════════════════════════════════════════════════════════════════════════════════
// 1. DriftCheckType Enum
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── DriftCheckType Enum ──');

{
  const types = Object.values(DriftCheckType);
  assert(types.length === 4, `DriftCheckType has 4 values (got ${types.length})`);
  assert(types.includes('SPEC_ALIGNMENT'), 'has SPEC_ALIGNMENT');
  assert(types.includes('SCOPE_CREEP'), 'has SCOPE_CREEP');
  assert(types.includes('ARCHITECTURE_CONSISTENCY'), 'has ARCHITECTURE_CONSISTENCY');
  assert(types.includes('TECH_DEBT'), 'has TECH_DEBT');
}

// ════════════════════════════════════════════════════════════════════════════════
// 2. getDriftHistory
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── getDriftHistory ──');

{
  // Empty history
  const lcId = setupLifecycle('drift0');
  const history = getDriftHistory(lcId);
  assert(history.totalChecks === 0, 'empty: totalChecks=0');
  assert(history.overallTrend === 'STABLE', 'empty: overallTrend=STABLE');
  cleanup(lcId);
}

{
  // Some drift checks
  const lcId = setupLifecycle('drift1');

  driftChecks.addCheck(lcId, null, 'SPEC_ALIGNMENT', 'PASS', { addressed_goals: ['G1'] });
  driftChecks.addCheck(lcId, null, 'SCOPE_CREEP', 'WARN', { severity: 'LOW' });
  driftChecks.addCheck(lcId, null, 'TECH_DEBT', 'PASS', { trend: 'STABLE' });

  const history = getDriftHistory(lcId);
  assert(history.totalChecks === 3, 'has 3 checks');
  assert(history.checks.length === 3, 'checks array length=3');
  assert(history.trends['SPEC_ALIGNMENT'] === 'INSUFFICIENT_DATA', 'SPEC: insufficient data (only 1 check)');
  cleanup(lcId);
}

{
  // Trend analysis with 2+ checks per type
  const lcId = setupLifecycle('drift2');

  // SPEC_ALIGNMENT: WARN → PASS = improving
  driftChecks.addCheck(lcId, null, 'SPEC_ALIGNMENT', 'WARN', { old: true });
  driftChecks.addCheck(lcId, null, 'SPEC_ALIGNMENT', 'PASS', { new: true });

  // TECH_DEBT: PASS → WARN = degrading
  driftChecks.addCheck(lcId, null, 'TECH_DEBT', 'PASS', { old: true });
  driftChecks.addCheck(lcId, null, 'TECH_DEBT', 'WARN', { new: true });

  const history = getDriftHistory(lcId);
  assert(history.trends['SPEC_ALIGNMENT'] === 'IMPROVING', 'SPEC trend: IMPROVING');
  assert(history.trends['TECH_DEBT'] === 'DEGRADING', 'TECH_DEBT trend: DEGRADING');
  assert(history.overallTrend === 'DEGRADING', 'overall: DEGRADING (any degrading → overall degrading)');
  cleanup(lcId);
}

{
  // Stable trend
  const lcId = setupLifecycle('drift3');

  driftChecks.addCheck(lcId, null, 'SCOPE_CREEP', 'PASS', {});
  driftChecks.addCheck(lcId, null, 'SCOPE_CREEP', 'PASS', {});

  const history = getDriftHistory(lcId);
  assert(history.trends['SCOPE_CREEP'] === 'STABLE', 'same result → STABLE trend');
  cleanup(lcId);
}

// ════════════════════════════════════════════════════════════════════════════════
// 3. getAggregateHealth
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── getAggregateHealth ──');

{
  // No data
  const lcId = setupLifecycle('health0');
  const health = getAggregateHealth(lcId);
  assert(health.milestoneCount === 0, 'no data: milestoneCount=0');
  assert(health.trend === 'NO_DATA', 'no data: trend=NO_DATA');
  cleanup(lcId);
}

{
  // 3 milestones with health scores
  const lcId = setupLifecycle('health1');
  const ts = Date.now();

  addMs(lcId, `ms-h1-${ts}`, 1, 'PASSED', { scope_adherence: 0.9, test_coverage: 0.8, complexity_delta: 0.1, tech_debt_delta: 0.05 });
  addMs(lcId, `ms-h2-${ts}`, 2, 'PASSED', { scope_adherence: 0.95, test_coverage: 0.85, complexity_delta: 0.15, tech_debt_delta: 0.1 });
  addMs(lcId, `ms-h3-${ts}`, 3, 'PASSED', { scope_adherence: 1.0, test_coverage: 0.9, complexity_delta: 0.2, tech_debt_delta: 0.15 });

  const health = getAggregateHealth(lcId);
  assert(health.milestoneCount === 3, 'health: 3 milestones');
  assert(health.averages.scope_adherence > 0.9, `health: avg scope_adherence > 0.9 (got ${health.averages.scope_adherence})`);
  assert(health.averages.test_coverage > 0.8, `health: avg test_coverage > 0.8 (got ${health.averages.test_coverage})`);
  assert(health.trend === 'STABLE', 'health: STABLE trend (< 6 milestones)');
  cleanup(lcId);
}

{
  // Milestones without health score → excluded from average
  const lcId = setupLifecycle('health2');
  const ts = Date.now();

  addMs(lcId, `ms-h2a-${ts}`, 1, 'PASSED', { scope_adherence: 1.0, test_coverage: 1.0, complexity_delta: 0.0, tech_debt_delta: 0.0 });
  addMs(lcId, `ms-h2b-${ts}`, 2, 'PASSED', null); // No health score

  const health = getAggregateHealth(lcId);
  assert(health.milestoneCount === 1, 'only 1 milestone with health score');
  assert(health.averages.scope_adherence === 1.0, 'average from single milestone');
  cleanup(lcId);
}

// ════════════════════════════════════════════════════════════════════════════════
// 4. validatePreservation
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── validatePreservation ──');

{
  // All completed preserved → no errors
  const completed = [
    { id: 'ms-1', status: 'PASSED', commit_hash: 'abc', git_tag: 'ms-1' },
    { id: 'ms-2', status: 'PASSED', commit_hash: 'def', git_tag: 'ms-2' },
  ];
  const newMs = [
    { id: 'ms-1', status: 'PASSED', preserved: true },
    { id: 'ms-2', status: 'PASSED', preserved: true },
    { id: 'ms-3', status: 'PENDING' },
  ];
  const errors = validatePreservation(completed, newMs);
  assert(errors.length === 0, 'all preserved → no errors');
}

{
  // Completed milestone removed → error
  const completed = [
    { id: 'ms-1', status: 'PASSED' },
    { id: 'ms-2', status: 'PASSED' },
  ];
  const newMs = [
    { id: 'ms-1', status: 'PASSED', preserved: true },
    { id: 'ms-3', status: 'PENDING' },
    // ms-2 missing!
  ];
  const errors = validatePreservation(completed, newMs);
  assert(errors.length === 1, 'removed completed → 1 error');
  assert(errors[0].includes('ms-2'), 'error mentions ms-2');
  assert(errors[0].includes('removed'), 'error says removed');
}

{
  // Completed milestone status changed → error
  const completed = [{ id: 'ms-1', status: 'PASSED' }];
  const newMs = [{ id: 'ms-1', status: 'PENDING', preserved: false }];
  const errors = validatePreservation(completed, newMs);
  assert(errors.length >= 1, 'status changed → error');
}

{
  // No completed milestones → always valid
  const errors = validatePreservation([], [{ id: 'ms-1', status: 'PENDING' }]);
  assert(errors.length === 0, 'no completed → no preservation errors');
}

{
  // Completed without status in new (undefined) → OK (no explicit change)
  const completed = [{ id: 'ms-1', status: 'PASSED' }];
  const newMs = [{ id: 'ms-1' }]; // no status field
  const errors = validatePreservation(completed, newMs);
  assert(errors.length === 0, 'no explicit status change → ok');
}

// ════════════════════════════════════════════════════════════════════════════════
// 5. rejectChange
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── rejectChange ──');

{
  const lcId = setupLifecycle('reject1');
  const crId = `cr-reject-${Date.now()}`;

  crRepo.addRequest({
    id: crId,
    lifecycle_id: lcId,
    description: 'Add feature X',
    affected_milestones: [],
  });

  const result = rejectChange(crId);
  assert(result.status === 'REJECTED', 'rejectChange returns REJECTED');

  const cr = crRepo.findById.get(crId);
  assert(cr.status === 'REJECTED', 'CR status REJECTED in DB');
  assert(cr.resolved_at !== null, 'resolved_at set');

  cleanup(lcId);
}

{
  // Nonexistent CR
  assertThrows(() => rejectChange('cr-nonexistent'), 'nonexistent CR throws');
}

// ════════════════════════════════════════════════════════════════════════════════
// 6. listChangeRequests
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── listChangeRequests ──');

{
  const lcId = setupLifecycle('list1');

  crRepo.addRequest({ id: `cr-list-1-${Date.now()}`, lifecycle_id: lcId, description: 'Change 1' });
  crRepo.addRequest({ id: `cr-list-2-${Date.now()}`, lifecycle_id: lcId, description: 'Change 2', affected_milestones: ['ms-1', 'ms-2'] });

  const list = listChangeRequests(lcId);
  assert(list.length === 2, 'listChangeRequests returns 2');
  assert(list[0].description === 'Change 2' || list[1].description === 'Change 2', 'descriptions stored');

  // JSON fields parsed
  const withAffected = list.find(cr => Array.isArray(cr.affected_milestones) && cr.affected_milestones.length === 2);
  assert(withAffected !== undefined, 'affected_milestones JSON parsed');

  cleanup(lcId);
}

{
  // Empty
  const lcId = setupLifecycle('list0');
  const list = listChangeRequests(lcId);
  assert(list.length === 0, 'empty lifecycle → empty list');
  cleanup(lcId);
}

// ════════════════════════════════════════════════════════════════════════════════
// 7. Index Exports
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Index Exports ──');

{
  const mod = await import('../src/planner/index.js');
  assert(typeof mod.DriftCheckType === 'object', 'index exports DriftCheckType');
  assert(typeof mod.getDriftHistory === 'function', 'index exports getDriftHistory');
  assert(typeof mod.getAggregateHealth === 'function', 'index exports getAggregateHealth');
  assert(typeof mod.validatePreservation === 'function', 'index exports validatePreservation');
  assert(typeof mod.rejectChange === 'function', 'index exports rejectChange');
  assert(typeof mod.listChangeRequests === 'function', 'index exports listChangeRequests');
}

// ════════════════════════════════════════════════════════════════════════════════
// Cleanup & Summary
// ════════════════════════════════════════════════════════════════════════════════

try {
  db.prepare('DELETE FROM projects WHERE id = ?').run(testProjectId);
} catch (e) {
  console.log(`  ⚠️ Cleanup: ${e.message}`);
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`  Lifecycle REVIEW+CHANGE Tests: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(60)}\n`);

if (failures.length > 0) {
  console.log('  Failures:');
  for (const f of failures) {
    console.log(`    - ${f.name}: ${f.msg}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
