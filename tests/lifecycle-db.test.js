// Lifecycle DB Schema Tests — v61
// ══════════════════════════════════════════════════════════════════════════════
// Verifies: 5 new tables, repositories, JSON serialization, foreign keys
//
// Run: node tests/lifecycle-db.test.js
// ══════════════════════════════════════════════════════════════════════════════

import {
  db,
  lifecycles,
  roadmapVersions,
  milestones,
  changeRequests,
  driftChecks,
  projects,
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
// Setup: create test project
// ════════════════════════════════════════════════════════════════════════════════

const testProjectName = `lifecycle-test-${Date.now()}`;
let testProjectId;

try {
  const result = projects.create.run(testProjectName, `/tmp/${testProjectName}`, 'test project');
  testProjectId = Number(result.lastInsertRowid);
} catch {
  const existing = projects.findByName.get(testProjectName);
  testProjectId = existing.id;
}

// ════════════════════════════════════════════════════════════════════════════════
// 1. Table Existence
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Table Existence ──');

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
assert(tables.includes('project_lifecycles'), 'project_lifecycles table exists');
assert(tables.includes('roadmap_versions'), 'roadmap_versions table exists');
assert(tables.includes('milestones'), 'milestones table exists');
assert(tables.includes('change_requests'), 'change_requests table exists');
assert(tables.includes('drift_checks'), 'drift_checks table exists');

// ════════════════════════════════════════════════════════════════════════════════
// 2. Lifecycles Repository
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Lifecycles ──');

const lcId = `lc-test-${Date.now()}`;

lifecycles.save(lcId, testProjectId, 'SPEC', null, { reviewFrequency: 3 });
const lc = lifecycles.findById.get(lcId);
assert(lc !== undefined, 'lifecycle created');
assert(lc.phase === 'SPEC', 'lifecycle phase = SPEC');
assert(lc.project_id === testProjectId, 'lifecycle project_id correct');

// Config stored as JSON
const lcConfig = lifecycles.getConfig(lcId);
assert(lcConfig.reviewFrequency === 3, 'lifecycle config JSON parsed');

// Update phase
lifecycles.updatePhase.run('PLANNING', lcId);
const lc2 = lifecycles.findById.get(lcId);
assert(lc2.phase === 'PLANNING', 'phase updated to PLANNING');

// Update spec
const testSpec = { title: 'Test', goals: [{ id: 'G1', description: 'test goal' }] };
lifecycles.updateSpec.run(JSON.stringify(testSpec), lcId);
const spec = lifecycles.getSpec(lcId);
assert(spec.title === 'Test', 'spec JSON stored and retrieved');
assert(spec.goals[0].id === 'G1', 'spec goals preserved');

// Find active by project
const active = lifecycles.findActiveByProject.get(testProjectId);
assert(active !== undefined, 'findActiveByProject works');
assert(active.id === lcId, 'findActiveByProject returns correct lifecycle');

// Save (update existing)
lifecycles.save(lcId, testProjectId, 'BUILD');
const lc3 = lifecycles.findById.get(lcId);
assert(lc3.phase === 'BUILD', 'save() updates existing lifecycle');

// ════════════════════════════════════════════════════════════════════════════════
// 3. Roadmap Versions Repository
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Roadmap Versions ──');

const testRoadmap = {
  milestones: [
    { id: 'ms-1', title: 'Setup', estimated_loc: 500 },
    { id: 'ms-2', title: 'Core', estimated_loc: 1200 },
  ],
};

roadmapVersions.addVersion(lcId, 1, testRoadmap, null, null);
const v1 = roadmapVersions.findByVersion.get(lcId, 1);
assert(v1 !== undefined, 'roadmap v1 created');
assert(v1.version === 1, 'roadmap version number correct');

const v1Parsed = roadmapVersions.getLatestRoadmap(lcId);
assert(v1Parsed.roadmap.milestones.length === 2, 'roadmap JSON parsed');
assert(v1Parsed.roadmap.milestones[0].id === 'ms-1', 'roadmap milestones intact');

// Add version 2 (immutable — v1 still exists)
const testRoadmap2 = { ...testRoadmap, milestones: [...testRoadmap.milestones, { id: 'ms-3', title: 'Polish' }] };
roadmapVersions.addVersion(lcId, 2, testRoadmap2, 'Added polish phase', 'added ms-3');

const latest = roadmapVersions.getLatestRoadmap(lcId);
assert(latest.version === 2, 'latest version is 2');
assert(latest.roadmap.milestones.length === 3, 'v2 has 3 milestones');

const latestVersion = roadmapVersions.getLatestVersion(lcId);
assert(latestVersion === 2, 'getLatestVersion returns 2');

// v1 still exists (immutable)
const v1Still = roadmapVersions.findByVersion.get(lcId, 1);
assert(v1Still !== undefined, 'v1 still exists (immutable)');

// UNIQUE constraint
assertThrows(() => roadmapVersions.addVersion(lcId, 1, {}, 'duplicate'), 'UNIQUE(lifecycle_id, version) enforced');

// History
const allVersions = roadmapVersions.findByLifecycle.all(lcId);
assert(allVersions.length === 2, 'version history preserved');

// ════════════════════════════════════════════════════════════════════════════════
// 4. Milestones Repository
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Milestones ──');

const msData = {
  id: `ms-test-1-${Date.now()}`,
  lifecycle_id: lcId,
  roadmap_version: 1,
  sequence: 1,
  title: 'Setup project structure',
  description: 'Create base files and configuration',
  dependencies: [],
  estimated_loc: 500,
  estimated_files: 4,
  estimated_complexity: 'LOW',
  test_strategy: { type: 'unit', description: 'test config loading', expected_test_count: 5 },
  scope_files: ['package.json', 'src/index.js', 'src/config.js', 'tsconfig.json'],
  max_retries: 3,
};

milestones.addMilestone(msData);
const ms = milestones.getMilestone(msData.id);
assert(ms !== null, 'milestone created');
assert(ms.title === 'Setup project structure', 'milestone title correct');
assert(ms.status === 'PENDING', 'default status is PENDING');
assert(ms.estimated_loc === 500, 'estimated_loc stored');
assert(Array.isArray(ms.dependencies), 'dependencies parsed as array');
assert(Array.isArray(ms.test_strategy.type ? [ms.test_strategy] : ms.test_strategy), 'test_strategy parsed');
assert(ms.scope_files.length === 4, 'scope_files parsed as array');
assert(ms.retry_count === 0, 'retry_count default 0');

// Status updates
milestones.updateStatus.run('EXECUTING', msData.id);
const ms2 = milestones.findById.get(msData.id);
assert(ms2.status === 'EXECUTING', 'status updated to EXECUTING');

// Completion with health score
const healthScore = { scope_adherence: 0.95, test_coverage: 0.8, complexity_delta: 0.1, tech_debt_delta: 0.05 };
milestones.updateCompletion.run('abc123', 'ms-test-1', JSON.stringify(healthScore), msData.id);
const ms3 = milestones.getMilestone(msData.id);
assert(ms3.status === 'PASSED', 'status updated to PASSED via updateCompletion');
assert(ms3.commit_hash === 'abc123', 'commit_hash stored');
assert(ms3.git_tag === 'ms-test-1', 'git_tag stored');
assert(ms3.health_score.scope_adherence === 0.95, 'health_score JSON parsed');

// Add second milestone
const msData2 = {
  id: `ms-test-2-${Date.now()}`,
  lifecycle_id: lcId,
  roadmap_version: 1,
  sequence: 2,
  title: 'Core implementation',
  dependencies: [msData.id],
  estimated_loc: 1200,
  estimated_files: 8,
  estimated_complexity: 'MEDIUM',
};

milestones.addMilestone(msData2);

// List by lifecycle
const allMs = milestones.listByLifecycle(lcId);
assert(allMs.length === 2, 'listByLifecycle returns 2 milestones');
assert(allMs[0].sequence < allMs[1].sequence, 'milestones ordered by sequence');

// Find by status
const passedMs = milestones.getCompleted(lcId);
assert(passedMs.length === 1, 'getCompleted returns 1 PASSED');

// Count by status
const counts = milestones.countByStatus.all(lcId);
assert(counts.length >= 1, 'countByStatus returns results');

// Retry
milestones.updateStatus.run('PENDING', msData2.id);
milestones.updateRetry.run(msData2.id);
const ms4 = milestones.findById.get(msData2.id);
assert(ms4.retry_count === 1, 'retry_count incremented');

// UNIQUE(lifecycle_id, sequence) constraint
assertThrows(
  () => milestones.addMilestone({ ...msData, id: 'ms-dup', sequence: 1 }),
  'UNIQUE(lifecycle_id, sequence) enforced'
);

// ════════════════════════════════════════════════════════════════════════════════
// 5. Change Requests Repository
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Change Requests ──');

const crId = `cr-test-${Date.now()}`;
const crData = {
  id: crId,
  lifecycle_id: lcId,
  description: 'Add authentication support',
  affected_milestones: ['ms-2', 'ms-3'],
  old_roadmap_version: 1,
};

changeRequests.addRequest(crData);
const cr = changeRequests.getRequest(crId);
assert(cr !== null, 'change request created');
assert(cr.status === 'PROPOSED', 'default status is PROPOSED');
assert(cr.description === 'Add authentication support', 'description stored');
assert(Array.isArray(cr.affected_milestones), 'affected_milestones parsed as array');
assert(cr.affected_milestones.length === 2, 'affected_milestones has 2 items');

// Update analysis
const impact = { effort_delta: '+1 milestone', risk_level: 'MEDIUM' };
changeRequests.updateAnalysis.run(JSON.stringify(impact), JSON.stringify(['ms-2', 'ms-3']), null, crId);
const cr2 = changeRequests.getRequest(crId);
assert(cr2.status === 'ANALYZED', 'status updated to ANALYZED');
assert(cr2.impact_analysis.risk_level === 'MEDIUM', 'impact_analysis JSON parsed');

// Apply
changeRequests.updateApplied.run(2, crId);
const cr3 = changeRequests.findById.get(crId);
assert(cr3.status === 'APPLIED', 'status updated to APPLIED');
assert(cr3.new_roadmap_version === 2, 'new_roadmap_version stored');
assert(cr3.resolved_at !== null, 'resolved_at set');

// List pending (should be empty now)
const pending = changeRequests.findPending.all(lcId);
assert(pending.length === 0, 'no pending change requests after APPLIED');

// ════════════════════════════════════════════════════════════════════════════════
// 6. Drift Checks Repository
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Drift Checks ──');

driftChecks.addCheck(lcId, msData.id, 'SPEC_ALIGNMENT', 'PASS', {
  addressed_goals: ['G1', 'G2'],
  unaddressed_goals: [],
  confidence: 0.85,
});

driftChecks.addCheck(lcId, msData.id, 'SCOPE_CREEP', 'WARN', {
  out_of_scope: ['extra_feature.js'],
  severity: 'LOW',
});

driftChecks.addCheck(lcId, null, 'TECH_DEBT', 'PASS', {
  trend: 'STABLE',
});

const checks = driftChecks.getChecks(lcId);
assert(checks.length === 3, 'drift checks stored (3)');
assert(checks[0].details.confidence !== undefined || checks[0].details.trend !== undefined, 'details JSON parsed');

const msChecks = driftChecks.getChecksByMilestone(msData.id);
assert(msChecks.length === 2, 'milestone-specific checks (2)');

const typeCheck = driftChecks.findLatestByType.get(lcId, 'SPEC_ALIGNMENT');
assert(typeCheck !== undefined, 'findLatestByType works');
assert(typeCheck.result === 'PASS', 'latest SPEC_ALIGNMENT result correct');

// ════════════════════════════════════════════════════════════════════════════════
// 7. Foreign Key Constraints
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Foreign Keys ──');

// lifecycle references existing project
assertThrows(
  () => lifecycles.create.run('lc-fk-test', 999999, 'SPEC', null, '{}'),
  'FK: lifecycle → project enforced'
);

// roadmap_version references existing lifecycle
assertThrows(
  () => roadmapVersions.addVersion('nonexistent-lc', 1, '{}', null, null),
  'FK: roadmap_version → lifecycle enforced'
);

// milestone references existing lifecycle
assertThrows(
  () => milestones.addMilestone({ id: 'ms-fk', lifecycle_id: 'nonexistent-lc', roadmap_version: 1, sequence: 1, title: 'x' }),
  'FK: milestone → lifecycle enforced'
);

// ════════════════════════════════════════════════════════════════════════════════
// 8. Index Existence
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Indexes ──');

const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(r => r.name);
assert(indexes.includes('idx_lifecycles_project'), 'idx_lifecycles_project exists');
assert(indexes.includes('idx_lifecycles_phase'), 'idx_lifecycles_phase exists');
assert(indexes.includes('idx_roadmap_versions_lifecycle'), 'idx_roadmap_versions_lifecycle exists');
assert(indexes.includes('idx_milestones_lifecycle'), 'idx_milestones_lifecycle exists');
assert(indexes.includes('idx_milestones_status'), 'idx_milestones_status exists');
assert(indexes.includes('idx_change_requests_lifecycle'), 'idx_change_requests_lifecycle exists');
assert(indexes.includes('idx_drift_checks_lifecycle'), 'idx_drift_checks_lifecycle exists');
assert(indexes.includes('idx_drift_checks_milestone'), 'idx_drift_checks_milestone exists');

// ════════════════════════════════════════════════════════════════════════════════
// Cleanup & Summary
// ════════════════════════════════════════════════════════════════════════════════

// Clean up test data
try {
  db.prepare('DELETE FROM drift_checks WHERE lifecycle_id = ?').run(lcId);
  db.prepare('DELETE FROM change_requests WHERE lifecycle_id = ?').run(lcId);
  db.prepare('DELETE FROM milestones WHERE lifecycle_id = ?').run(lcId);
  db.prepare('DELETE FROM roadmap_versions WHERE lifecycle_id = ?').run(lcId);
  db.prepare('DELETE FROM project_lifecycles WHERE id = ?').run(lcId);
  db.prepare('DELETE FROM projects WHERE id = ?').run(testProjectId);
} catch (e) {
  console.log(`  ⚠️ Cleanup: ${e.message}`);
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`  Lifecycle DB Tests: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(60)}\n`);

if (failures.length > 0) {
  console.log('  Failures:');
  for (const f of failures) {
    console.log(`    - ${f.name}: ${f.msg}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
