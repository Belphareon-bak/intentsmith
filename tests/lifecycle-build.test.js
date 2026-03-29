// Lifecycle BUILD Tests — Milestone Execution Logic
// ══════════════════════════════════════════════════════════════════════════════
// Tests: getBuildProgress, handleMilestoneBlocked (retry/skip/modify),
//        scope enforcement, milestone status flow, blocking logic
//
// NOTE: LLM-dependent functions (startNextMilestone, executeMilestone, etc.)
//       require integration tests with Ollama. This file tests pure logic.
//
// Run: node tests/lifecycle-build.test.js
// ══════════════════════════════════════════════════════════════════════════════

import {
  getBuildProgress,
  handleMilestoneBlocked,
  _testInternals,
} from '../src/planner/lifecycle-build.js';
import {
  ProjectPhase,
  MilestoneStatus,
  ProjectLifecycle,
} from '../src/planner/lifecycle.js';
import {
  lifecycles as lifecycleRepo,
  milestones as msRepo,
  projects,
  db,
} from '../src/db/database.js';

const {
  mergeCheckpointFindings,
  filterContextCandidatesToScope,
  buildScopeFallbackCandidates,
  matchesScopePattern,
} = _testInternals;

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

async function assertThrowsAsync(fn, name) {
  try {
    await fn();
    fail(name, 'expected throw');
  } catch {
    pass(name);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// Setup
// ════════════════════════════════════════════════════════════════════════════════

const testProjectName = `lc-build-test-${Date.now()}`;
let testProjectId;

try {
  const result = projects.create.run(testProjectName, `/tmp/${testProjectName}`, 'build test');
  testProjectId = Number(result.lastInsertRowid);
} catch {
  const existing = projects.findByName.get(testProjectName);
  testProjectId = existing.id;
}

function createTestLifecycle(suffix = '') {
  const lcId = `lc-build-${Date.now()}-${suffix}`;
  lifecycleRepo.save(lcId, testProjectId, 'BUILD', null, {});
  const lc = new ProjectLifecycle({
    id: lcId,
    projectId: testProjectId,
    projectPath: '/tmp/test',
    lifecycleConfig: { maxMilestoneRetries: 3 },
  });
  lc._phase = ProjectPhase.BUILD;
  return lc;
}

function addMilestone(lcId, id, seq, status = 'PENDING', deps = []) {
  msRepo.addMilestone({
    id,
    lifecycle_id: lcId,
    roadmap_version: 1,
    sequence: seq,
    title: `Milestone ${seq}`,
    description: `Test milestone ${seq}`,
    status,
    dependencies: deps,
    estimated_loc: 500,
    estimated_files: 4,
    estimated_complexity: 'MEDIUM',
    max_retries: 3,
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// 1. getBuildProgress
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── getBuildProgress ──');

{
  // Empty lifecycle
  const lc = createTestLifecycle('prog0');
  const progress = getBuildProgress(lc.id);
  assert(progress.total === 0, 'empty lifecycle: total=0');
  assert(progress.percentage === 0, 'empty lifecycle: percentage=0');

  db.prepare('DELETE FROM project_lifecycles WHERE id = ?').run(lc.id);
}

{
  // 4 milestones: 2 PASSED, 1 EXECUTING, 1 PENDING
  const lc = createTestLifecycle('prog1');
  const ms1 = `ms-prog1-1-${Date.now()}`;
  const ms2 = `ms-prog1-2-${Date.now()}`;
  const ms3 = `ms-prog1-3-${Date.now()}`;
  const ms4 = `ms-prog1-4-${Date.now()}`;

  addMilestone(lc.id, ms1, 1);
  addMilestone(lc.id, ms2, 2);
  addMilestone(lc.id, ms3, 3);
  addMilestone(lc.id, ms4, 4);

  msRepo.updateCompletion.run('hash1', 'tag1', '{}', ms1);
  msRepo.updateCompletion.run('hash2', 'tag2', '{}', ms2);
  msRepo.updateStatus.run('EXECUTING', ms3);
  // ms4 stays PENDING

  const progress = getBuildProgress(lc.id);
  assert(progress.total === 4, 'progress: total=4');
  assert(progress.completed === 2, 'progress: completed=2');
  assert(progress.executing === 1, 'progress: executing=1');
  assert(progress.pending === 1, 'progress: pending=1');
  assert(progress.percentage === 50, 'progress: 50% (2/4)');
  assert(progress.milestones.length === 4, 'progress: milestones array has 4');

  // Cleanup
  db.prepare('DELETE FROM milestones WHERE lifecycle_id = ?').run(lc.id);
  db.prepare('DELETE FROM project_lifecycles WHERE id = ?').run(lc.id);
}

{
  // All milestones PASSED = 100%
  const lc = createTestLifecycle('prog2');
  const ms1 = `ms-prog2-1-${Date.now()}`;
  const ms2 = `ms-prog2-2-${Date.now()}`;

  addMilestone(lc.id, ms1, 1);
  addMilestone(lc.id, ms2, 2);

  msRepo.updateCompletion.run('h1', 't1', '{}', ms1);
  msRepo.updateCompletion.run('h2', 't2', '{}', ms2);

  const progress = getBuildProgress(lc.id);
  assert(progress.percentage === 100, 'all passed: 100%');
  assert(progress.blocked === 0, 'all passed: blocked=0');

  db.prepare('DELETE FROM milestones WHERE lifecycle_id = ?').run(lc.id);
  db.prepare('DELETE FROM project_lifecycles WHERE id = ?').run(lc.id);
}

{
  // SKIPPED counts toward progress
  const lc = createTestLifecycle('prog3');
  const ms1 = `ms-prog3-1-${Date.now()}`;
  const ms2 = `ms-prog3-2-${Date.now()}`;

  addMilestone(lc.id, ms1, 1);
  addMilestone(lc.id, ms2, 2);

  msRepo.updateCompletion.run('h1', 't1', '{}', ms1);
  msRepo.updateStatus.run('SKIPPED', ms2);

  const progress = getBuildProgress(lc.id);
  assert(progress.percentage === 100, 'PASSED + SKIPPED = 100%');
  assert(progress.skipped === 1, 'skipped=1');

  db.prepare('DELETE FROM milestones WHERE lifecycle_id = ?').run(lc.id);
  db.prepare('DELETE FROM project_lifecycles WHERE id = ?').run(lc.id);
}

{
  // BLOCKED milestone tracked
  const lc = createTestLifecycle('prog4');
  const ms1 = `ms-prog4-1-${Date.now()}`;
  const ms2 = `ms-prog4-2-${Date.now()}`;

  addMilestone(lc.id, ms1, 1);
  addMilestone(lc.id, ms2, 2);

  msRepo.updateStatus.run('BLOCKED', ms1);

  const progress = getBuildProgress(lc.id);
  assert(progress.blocked === 1, 'blocked=1');
  assert(progress.percentage === 0, '0% when 1 blocked 1 pending');

  db.prepare('DELETE FROM milestones WHERE lifecycle_id = ?').run(lc.id);
  db.prepare('DELETE FROM project_lifecycles WHERE id = ?').run(lc.id);
}

// ════════════════════════════════════════════════════════════════════════════════
// 2. handleMilestoneBlocked — retry
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── handleMilestoneBlocked (retry) ──');

{
  const lc = createTestLifecycle('block-retry');
  const msId = `ms-blocked-retry-${Date.now()}`;
  addMilestone(lc.id, msId, 1);
  msRepo.updateStatus.run('BLOCKED', msId);

  const result = await handleMilestoneBlocked(lc, msId, 'retry');
  assert(result.status === 'WILL_RETRY', 'retry: status=WILL_RETRY');

  const ms = msRepo.findById.get(msId);
  assert(ms.status === 'PENDING', 'retry: milestone reset to PENDING');

  db.prepare('DELETE FROM milestones WHERE lifecycle_id = ?').run(lc.id);
  db.prepare('DELETE FROM project_lifecycles WHERE id = ?').run(lc.id);
}

// ════════════════════════════════════════════════════════════════════════════════
// 3. handleMilestoneBlocked — skip
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── handleMilestoneBlocked (skip) ──');

{
  // Skip milestone with no dependents → OK
  const lc = createTestLifecycle('block-skip1');
  const msId = `ms-blocked-skip1-${Date.now()}`;
  addMilestone(lc.id, msId, 1);
  msRepo.updateStatus.run('BLOCKED', msId);

  const result = await handleMilestoneBlocked(lc, msId, 'skip');
  assert(result.status === 'SKIPPED', 'skip: status=SKIPPED');

  const ms = msRepo.findById.get(msId);
  assert(ms.status === 'SKIPPED', 'skip: milestone set to SKIPPED in DB');

  db.prepare('DELETE FROM milestones WHERE lifecycle_id = ?').run(lc.id);
  db.prepare('DELETE FROM project_lifecycles WHERE id = ?').run(lc.id);
}

{
  // Skip milestone WITH dependents → CANNOT_SKIP
  const lc = createTestLifecycle('block-skip2');
  const ms1Id = `ms-blocked-skip2a-${Date.now()}`;
  const ms2Id = `ms-blocked-skip2b-${Date.now()}`;

  addMilestone(lc.id, ms1Id, 1);
  addMilestone(lc.id, ms2Id, 2, 'PENDING', [ms1Id]);
  msRepo.updateStatus.run('BLOCKED', ms1Id);

  const result = await handleMilestoneBlocked(lc, ms1Id, 'skip');
  assert(result.status === 'CANNOT_SKIP', 'skip with deps: status=CANNOT_SKIP');
  assert(result.reason.includes(ms2Id), 'skip with deps: reason mentions dependent');

  // ms1 stays BLOCKED
  const ms = msRepo.findById.get(ms1Id);
  assert(ms.status === 'BLOCKED', 'skip with deps: milestone stays BLOCKED');

  db.prepare('DELETE FROM milestones WHERE lifecycle_id = ?').run(lc.id);
  db.prepare('DELETE FROM project_lifecycles WHERE id = ?').run(lc.id);
}

{
  // Skip is OK if dependent is already PASSED
  const lc = createTestLifecycle('block-skip3');
  const ms1Id = `ms-blocked-skip3a-${Date.now()}`;
  const ms2Id = `ms-blocked-skip3b-${Date.now()}`;

  addMilestone(lc.id, ms1Id, 1);
  addMilestone(lc.id, ms2Id, 2, 'PENDING', [ms1Id]);
  msRepo.updateCompletion.run('h', 't', '{}', ms2Id); // ms2 already PASSED
  msRepo.updateStatus.run('BLOCKED', ms1Id);

  const result = await handleMilestoneBlocked(lc, ms1Id, 'skip');
  assert(result.status === 'SKIPPED', 'skip OK when dependent already PASSED');

  db.prepare('DELETE FROM milestones WHERE lifecycle_id = ?').run(lc.id);
  db.prepare('DELETE FROM project_lifecycles WHERE id = ?').run(lc.id);
}

// ════════════════════════════════════════════════════════════════════════════════
// 4. handleMilestoneBlocked — modify
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── handleMilestoneBlocked (modify) ──');

{
  const lc = createTestLifecycle('block-modify');
  const msId = `ms-blocked-modify-${Date.now()}`;
  addMilestone(lc.id, msId, 1);
  msRepo.updateStatus.run('BLOCKED', msId);

  const result = await handleMilestoneBlocked(lc, msId, 'modify', 'Split into smaller tasks');
  assert(result.status === 'WILL_MODIFY', 'modify: status=WILL_MODIFY');
  assert(result.feedback === 'Split into smaller tasks', 'modify: feedback stored');

  const ms = msRepo.getMilestone(msId);
  assert(ms.status === 'PENDING', 'modify: reset to PENDING');
  assert(ms.local_plan._userFeedback === 'Split into smaller tasks', 'modify: feedback in local_plan');

  db.prepare('DELETE FROM milestones WHERE lifecycle_id = ?').run(lc.id);
  db.prepare('DELETE FROM project_lifecycles WHERE id = ?').run(lc.id);
}

// ════════════════════════════════════════════════════════════════════════════════
// 5. handleMilestoneBlocked — error cases
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── handleMilestoneBlocked (errors) ──');

{
  const lc = createTestLifecycle('block-err1');

  // Nonexistent milestone
  await assertThrowsAsync(
    () => handleMilestoneBlocked(lc, 'ms-nonexistent', 'retry'),
    'nonexistent milestone throws'
  );

  db.prepare('DELETE FROM project_lifecycles WHERE id = ?').run(lc.id);
}

{
  // Not BLOCKED milestone
  const lc = createTestLifecycle('block-err2');
  const msId = `ms-not-blocked-${Date.now()}`;
  addMilestone(lc.id, msId, 1);
  // Status is PENDING, not BLOCKED

  await assertThrowsAsync(
    () => handleMilestoneBlocked(lc, msId, 'retry'),
    'non-BLOCKED milestone throws'
  );

  db.prepare('DELETE FROM milestones WHERE lifecycle_id = ?').run(lc.id);
  db.prepare('DELETE FROM project_lifecycles WHERE id = ?').run(lc.id);
}

{
  // Invalid decision
  const lc = createTestLifecycle('block-err3');
  const msId = `ms-bad-decision-${Date.now()}`;
  addMilestone(lc.id, msId, 1);
  msRepo.updateStatus.run('BLOCKED', msId);

  await assertThrowsAsync(
    () => handleMilestoneBlocked(lc, msId, 'delete'),
    'unknown decision throws'
  );

  db.prepare('DELETE FROM milestones WHERE lifecycle_id = ?').run(lc.id);
  db.prepare('DELETE FROM project_lifecycles WHERE id = ?').run(lc.id);
}

// ════════════════════════════════════════════════════════════════════════════════
// 6. Milestone Status Flow (DB-level)
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Milestone Status Flow ──');

{
  const lc = createTestLifecycle('flow');
  const msId = `ms-flow-${Date.now()}`;
  addMilestone(lc.id, msId, 1);

  // PENDING → PLANNING
  msRepo.updateStatus.run(MilestoneStatus.PLANNING, msId);
  assert(msRepo.findById.get(msId).status === 'PLANNING', 'PENDING → PLANNING');

  // PLANNING → AWAITING_PLAN
  msRepo.updateStatus.run(MilestoneStatus.AWAITING_PLAN, msId);
  assert(msRepo.findById.get(msId).status === 'AWAITING_PLAN', 'PLANNING → AWAITING_PLAN');

  // AWAITING_PLAN → EXECUTING
  msRepo.updateStatus.run(MilestoneStatus.EXECUTING, msId);
  assert(msRepo.findById.get(msId).status === 'EXECUTING', 'AWAITING_PLAN → EXECUTING');

  // EXECUTING → TESTING
  msRepo.updateStatus.run(MilestoneStatus.TESTING, msId);
  assert(msRepo.findById.get(msId).status === 'TESTING', 'EXECUTING → TESTING');

  // TESTING → REVIEW
  msRepo.updateStatus.run(MilestoneStatus.REVIEW, msId);
  assert(msRepo.findById.get(msId).status === 'REVIEW', 'TESTING → REVIEW');

  // REVIEW → PASSED (via updateCompletion)
  const health = { scope_adherence: 0.9, test_coverage: 0.85, complexity_delta: 0.1, tech_debt_delta: 0.05 };
  msRepo.updateCompletion.run('abc123', 'ms-flow', JSON.stringify(health), msId);
  const final = msRepo.getMilestone(msId);
  assert(final.status === 'PASSED', 'REVIEW → PASSED via updateCompletion');
  assert(final.commit_hash === 'abc123', 'commit_hash stored');
  assert(final.git_tag === 'ms-flow', 'git_tag stored');
  assert(final.health_score.scope_adherence === 0.9, 'health_score persisted');
  assert(final.completed_at !== null, 'completed_at set');

  db.prepare('DELETE FROM milestones WHERE lifecycle_id = ?').run(lc.id);
  db.prepare('DELETE FROM project_lifecycles WHERE id = ?').run(lc.id);
}

// ════════════════════════════════════════════════════════════════════════════════
// 7. Retry Count Logic
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Retry Count ──');

{
  const lc = createTestLifecycle('retry');
  const msId = `ms-retry-${Date.now()}`;
  addMilestone(lc.id, msId, 1);

  assert(msRepo.findById.get(msId).retry_count === 0, 'initial retry_count=0');

  msRepo.updateRetry.run(msId);
  assert(msRepo.findById.get(msId).retry_count === 1, 'retry_count incremented to 1');

  msRepo.updateRetry.run(msId);
  msRepo.updateRetry.run(msId);
  assert(msRepo.findById.get(msId).retry_count === 3, 'retry_count incremented to 3');

  db.prepare('DELETE FROM milestones WHERE lifecycle_id = ?').run(lc.id);
  db.prepare('DELETE FROM project_lifecycles WHERE id = ?').run(lc.id);
}

// ════════════════════════════════════════════════════════════════════════════════
// 8. Build Progress — All Status Types
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Build Progress (all status types) ──');

{
  const lc = createTestLifecycle('allstat');
  const ts = Date.now();

  addMilestone(lc.id, `ms-allstat-1-${ts}`, 1); // PENDING
  addMilestone(lc.id, `ms-allstat-2-${ts}`, 2); // PLANNING
  addMilestone(lc.id, `ms-allstat-3-${ts}`, 3); // AWAITING_PLAN
  addMilestone(lc.id, `ms-allstat-4-${ts}`, 4); // EXECUTING
  addMilestone(lc.id, `ms-allstat-5-${ts}`, 5); // TESTING
  addMilestone(lc.id, `ms-allstat-6-${ts}`, 6); // REVIEW
  addMilestone(lc.id, `ms-allstat-7-${ts}`, 7); // PASSED
  addMilestone(lc.id, `ms-allstat-8-${ts}`, 8); // BLOCKED
  addMilestone(lc.id, `ms-allstat-9-${ts}`, 9); // SKIPPED

  msRepo.updateStatus.run('PLANNING', `ms-allstat-2-${ts}`);
  msRepo.updateStatus.run('AWAITING_PLAN', `ms-allstat-3-${ts}`);
  msRepo.updateStatus.run('EXECUTING', `ms-allstat-4-${ts}`);
  msRepo.updateStatus.run('TESTING', `ms-allstat-5-${ts}`);
  msRepo.updateStatus.run('REVIEW', `ms-allstat-6-${ts}`);
  msRepo.updateCompletion.run('h', 't', '{}', `ms-allstat-7-${ts}`);
  msRepo.updateStatus.run('BLOCKED', `ms-allstat-8-${ts}`);
  msRepo.updateStatus.run('SKIPPED', `ms-allstat-9-${ts}`);

  const progress = getBuildProgress(lc.id);
  assert(progress.total === 9, 'all statuses: total=9');
  assert(progress.completed === 1, 'all statuses: completed=1 (PASSED)');
  assert(progress.skipped === 1, 'all statuses: skipped=1');
  assert(progress.blocked === 1, 'all statuses: blocked=1');
  assert(progress.executing === 5, 'all statuses: executing=5 (PLANNING+AWAITING+EXEC+TEST+REVIEW)');
  assert(progress.pending === 1, 'all statuses: pending=1');
  assert(progress.percentage === Math.round(2/9*100), `all statuses: ${Math.round(2/9*100)}% (passed+skipped)`);
  assert(progress.milestones[0].id === `ms-allstat-1-${ts}`, 'milestones ordered by sequence');

  db.prepare('DELETE FROM milestones WHERE lifecycle_id = ?').run(lc.id);
  db.prepare('DELETE FROM project_lifecycles WHERE id = ?').run(lc.id);
}

// ════════════════════════════════════════════════════════════════════════════════
// 9. Quick Win Helpers
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Quick Win Helpers ──');

{
  const merged = mergeCheckpointFindings(
    {
      fix_instructions: ['Fix A', 'Fix B'],
      security_findings: ['Sanitize input'],
      error_handling_gaps: ['Handle timeout'],
      overall_assessment: 'old',
    },
    {
      fix_instructions: ['Fix B', 'Fix C'],
      security_findings: ['Sanitize input', 'Validate auth'],
      error_handling_gaps: ['Handle timeout', 'Return 400'],
      overall_assessment: 'new',
    }
  );

  assert(merged.fix_instructions.length === 3, 'mergeCheckpointFindings: dedups fix instructions');
  assert(merged.security_findings.length === 2, 'mergeCheckpointFindings: dedups security findings');
  assert(merged.error_handling_gaps.length === 2, 'mergeCheckpointFindings: dedups error handling gaps');
  assert(merged.overall_assessment === 'new', 'mergeCheckpointFindings: keeps newest assessment');
}

{
  assert(matchesScopePattern('src/auth/login.js', 'src/auth/'), 'matchesScopePattern: directory scope');
  assert(matchesScopePattern('src/index.js', 'src/*.js'), 'matchesScopePattern: glob scope');
  assert(matchesScopePattern('src/app.js', 'src/app.js'), 'matchesScopePattern: exact file scope');
}

{
  const scoped = filterContextCandidatesToScope([
    { file: 'src/in-scope.js', score: 2 },
    { file: 'src/out-of-scope.js', score: 1 },
  ], ['src/in-scope.js']);

  assert(scoped.length === 1, 'filterContextCandidatesToScope: filters to scope');
  assert(scoped[0].file === 'src/in-scope.js', 'filterContextCandidatesToScope: keeps matching file');
}

{
  const fallback = buildScopeFallbackCandidates([
    'src/in-scope.js',
    'src/auth/',
    'src/*.test.js',
    'src/in-scope.js',
  ]);

  assert(fallback.length === 1, 'buildScopeFallbackCandidates: keeps only concrete unique files');
  assert(fallback[0].file === 'src/in-scope.js', 'buildScopeFallbackCandidates: uses scope file path');
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
console.log(`  Lifecycle BUILD Tests: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(60)}\n`);

if (failures.length > 0) {
  console.log('  Failures:');
  for (const f of failures) {
    console.log(`    - ${f.name}: ${f.msg}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
