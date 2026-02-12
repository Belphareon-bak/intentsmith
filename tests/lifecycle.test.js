// Lifecycle Tests — SPEC + PLANNING Phases
// ══════════════════════════════════════════════════════════════════════════════
// Tests: spec validation, dependency validation, planning helpers, enums,
//        state machine transitions
//
// Run: node tests/lifecycle.test.js
//
// NOTE: LLM-dependent functions (startSpec, generateRoadmap, etc.) are NOT
//       tested here — those require integration tests with Ollama running.
//       This file tests pure logic: validation, enums, state machine, deps.
// ══════════════════════════════════════════════════════════════════════════════

import { validateSpec } from '../src/planner/lifecycle-spec.js';
import { validateDependencies, checkDependencies } from '../src/planner/lifecycle-planning.js';
import {
  ProjectPhase,
  MilestoneStatus,
  ChangeRequestStatus,
  ProjectLifecycle,
} from '../src/planner/lifecycle.js';
import {
  validateMilestoneSize,
  suggestMilestoneSplit,
} from '../src/planner/milestone-size.js';
import {
  lifecycles as lifecycleRepo,
  milestones as msRepo,
  roadmapVersions,
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

async function assertThrowsAsync(fn, name) {
  try {
    await fn();
    fail(name, 'expected throw');
  } catch {
    pass(name);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// 1. Enum Completeness
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Enum Completeness ──');

{
  const phases = Object.values(ProjectPhase);
  assert(phases.length === 10, `ProjectPhase has 10 values (got ${phases.length})`);
  assert(phases.includes('SPEC'), 'ProjectPhase has SPEC');
  assert(phases.includes('SPEC_REVIEW'), 'ProjectPhase has SPEC_REVIEW');
  assert(phases.includes('PLANNING'), 'ProjectPhase has PLANNING');
  assert(phases.includes('PLAN_REVIEW'), 'ProjectPhase has PLAN_REVIEW');
  assert(phases.includes('BUILD'), 'ProjectPhase has BUILD');
  assert(phases.includes('PROJECT_REVIEW'), 'ProjectPhase has PROJECT_REVIEW');
  assert(phases.includes('CHANGE_MANAGEMENT'), 'ProjectPhase has CHANGE_MANAGEMENT');
  assert(phases.includes('PAUSED'), 'ProjectPhase has PAUSED');
  assert(phases.includes('COMPLETED'), 'ProjectPhase has COMPLETED');
  assert(phases.includes('FAILED'), 'ProjectPhase has FAILED');

  // Frozen
  assertThrows(() => { ProjectPhase.NEW_STATE = 'X'; }, 'ProjectPhase is frozen');
}

{
  const statuses = Object.values(MilestoneStatus);
  assert(statuses.length === 10, `MilestoneStatus has 10 values (got ${statuses.length})`);
  assert(statuses.includes('PENDING'), 'MilestoneStatus has PENDING');
  assert(statuses.includes('EXECUTING'), 'MilestoneStatus has EXECUTING');
  assert(statuses.includes('PASSED'), 'MilestoneStatus has PASSED');
  assert(statuses.includes('BLOCKED'), 'MilestoneStatus has BLOCKED');
  assert(statuses.includes('SKIPPED'), 'MilestoneStatus has SKIPPED');
}

{
  const statuses = Object.values(ChangeRequestStatus);
  assert(statuses.length === 5, `ChangeRequestStatus has 5 values (got ${statuses.length})`);
  assert(statuses.includes('PROPOSED'), 'CRS has PROPOSED');
  assert(statuses.includes('APPLIED'), 'CRS has APPLIED');
  assert(statuses.includes('REJECTED'), 'CRS has REJECTED');
}

// ════════════════════════════════════════════════════════════════════════════════
// 2. Spec Validation
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Spec Validation ──');

{
  const result = validateSpec(null);
  assert(result.valid === false, 'null spec is invalid');
  assert(result.errors.length >= 1, 'null spec has errors');
}

{
  const result = validateSpec({});
  assert(result.valid === false, 'empty spec is invalid');
  assert(result.errors.some(e => e.includes('title')), 'empty spec: missing title error');
  assert(result.errors.some(e => e.includes('Goals')), 'empty spec: missing goals error');
  assert(result.errors.some(e => e.includes('Requirements')), 'empty spec: missing reqs error');
  assert(result.errors.some(e => e.includes('tech_stack')), 'empty spec: missing tech_stack error');
  assert(result.errors.some(e => e.includes('Risks')), 'empty spec: missing risks error');
}

{
  // Too few goals
  const result = validateSpec({
    title: 'Test',
    goals: [{ id: 'G1', description: 'goal' }],
    requirements: [{ id: 'R1', description: 'req' }],
    tech_stack: { languages: ['JS'] },
    risks: [],
  });
  assert(result.valid === false, 'insufficient goals/reqs/risks → invalid');
  assert(result.errors.some(e => e.includes('minimum 3')), 'goals minimum 3 enforced');
  assert(result.errors.some(e => e.includes('minimum 5')), 'reqs minimum 5 enforced');
  assert(result.errors.some(e => e.includes('minimum 1')), 'risks minimum 1 enforced');
}

{
  // Valid spec (minimum viable)
  const result = validateSpec({
    title: 'E-shop',
    goals: [
      { id: 'G1', description: 'User can browse products' },
      { id: 'G2', description: 'User can add to cart' },
      { id: 'G3', description: 'User can checkout' },
    ],
    requirements: [
      { id: 'R1', description: 'Product listing page' },
      { id: 'R2', description: 'Product detail page' },
      { id: 'R3', description: 'Shopping cart' },
      { id: 'R4', description: 'Checkout flow' },
      { id: 'R5', description: 'Order confirmation' },
    ],
    tech_stack: {
      languages: ['TypeScript'],
      frameworks: ['Next.js'],
    },
    risks: [
      { id: 'RISK1', description: 'Payment integration complexity', severity: 'MEDIUM', mitigation: 'Use Stripe' },
    ],
  });
  assert(result.valid === true, 'valid spec passes validation');
  assert(result.errors.length === 0, 'valid spec has no errors');
}

{
  // Goals without id → invalid
  const result = validateSpec({
    title: 'Test',
    goals: [
      { description: 'no id goal' },
      { id: 'G2', description: 'ok' },
      { id: 'G3', description: 'ok' },
    ],
    requirements: [
      { id: 'R1', description: 'r' }, { id: 'R2', description: 'r' },
      { id: 'R3', description: 'r' }, { id: 'R4', description: 'r' },
      { id: 'R5', description: 'r' },
    ],
    tech_stack: { languages: ['JS'] },
    risks: [{ id: 'R1', description: 'risk' }],
  });
  assert(result.valid === false, 'goal without id → invalid');
  assert(result.errors.some(e => e.includes('missing id')), 'goal without id error reported');
}

{
  // tech_stack without languages → invalid
  const result = validateSpec({
    title: 'Test',
    goals: [
      { id: 'G1', description: 'a' }, { id: 'G2', description: 'b' }, { id: 'G3', description: 'c' },
    ],
    requirements: [
      { id: 'R1', description: 'r' }, { id: 'R2', description: 'r' },
      { id: 'R3', description: 'r' }, { id: 'R4', description: 'r' },
      { id: 'R5', description: 'r' },
    ],
    tech_stack: { frameworks: ['React'] }, // no languages
    risks: [{ id: 'R1', description: 'risk' }],
  });
  assert(result.valid === false, 'tech_stack without languages → invalid');
  assert(result.errors.some(e => e.includes('languages')), 'languages empty error reported');
}

// ════════════════════════════════════════════════════════════════════════════════
// 3. Dependency Validation
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Dependency Validation ──');

{
  // No deps → no errors
  const errors = validateDependencies([
    { id: 'ms-1', dependencies: [] },
    { id: 'ms-2', dependencies: [] },
  ]);
  assert(errors.length === 0, 'no dependencies → no errors');
}

{
  // Valid deps
  const errors = validateDependencies([
    { id: 'ms-1', dependencies: [] },
    { id: 'ms-2', dependencies: ['ms-1'] },
    { id: 'ms-3', dependencies: ['ms-1', 'ms-2'] },
  ]);
  assert(errors.length === 0, 'valid linear dependencies → no errors');
}

{
  // Missing dependency
  const errors = validateDependencies([
    { id: 'ms-1', dependencies: ['ms-0'] },
    { id: 'ms-2', dependencies: ['ms-1'] },
  ]);
  assert(errors.some(e => e.includes("doesn't exist")), 'missing dep detected');
}

{
  // Self-dependency
  const errors = validateDependencies([
    { id: 'ms-1', dependencies: ['ms-1'] },
  ]);
  assert(errors.some(e => e.includes('itself')), 'self-dependency detected');
}

{
  // Circular dependency (A→B, B→A)
  const errors = validateDependencies([
    { id: 'ms-1', dependencies: ['ms-2'] },
    { id: 'ms-2', dependencies: ['ms-1'] },
  ]);
  assert(errors.some(e => e.includes('Circular')), 'circular dependency detected');
}

{
  // Complex circular (A→B, B→C, C→A)
  const errors = validateDependencies([
    { id: 'ms-1', dependencies: ['ms-3'] },
    { id: 'ms-2', dependencies: ['ms-1'] },
    { id: 'ms-3', dependencies: ['ms-2'] },
  ]);
  assert(errors.some(e => e.includes('Circular')), 'complex circular dependency detected');
}

{
  // Diamond dependency (no error: ms-3 depends on ms-1 and ms-2, both depend on ms-0)
  const errors = validateDependencies([
    { id: 'ms-0', dependencies: [] },
    { id: 'ms-1', dependencies: ['ms-0'] },
    { id: 'ms-2', dependencies: ['ms-0'] },
    { id: 'ms-3', dependencies: ['ms-1', 'ms-2'] },
  ]);
  assert(errors.length === 0, 'diamond dependency is valid (no cycle)');
}

// ════════════════════════════════════════════════════════════════════════════════
// 4. State Machine Transitions
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── State Machine Transitions ──');

// Create test project for lifecycle
const testProjectName = `lc-sm-test-${Date.now()}`;
let testProjectId;
try {
  const result = projects.create.run(testProjectName, `/tmp/${testProjectName}`, 'test');
  testProjectId = Number(result.lastInsertRowid);
} catch {
  const existing = projects.findByName.get(testProjectName);
  testProjectId = existing.id;
}

{
  // Valid transitions
  const lc = new ProjectLifecycle({
    id: `lc-sm-${Date.now()}`,
    projectId: testProjectId,
    projectPath: '/tmp/test',
  });
  lc.save();

  assert(lc.phase === 'SPEC', 'initial phase is SPEC');

  await lc.transitionTo(ProjectPhase.SPEC_REVIEW);
  assert(lc.phase === 'SPEC_REVIEW', 'SPEC → SPEC_REVIEW valid');

  await lc.transitionTo(ProjectPhase.PLANNING);
  assert(lc.phase === 'PLANNING', 'SPEC_REVIEW → PLANNING valid');

  await lc.transitionTo(ProjectPhase.PLAN_REVIEW);
  assert(lc.phase === 'PLAN_REVIEW', 'PLANNING → PLAN_REVIEW valid');

  await lc.transitionTo(ProjectPhase.BUILD);
  assert(lc.phase === 'BUILD', 'PLAN_REVIEW → BUILD valid');

  await lc.transitionTo(ProjectPhase.PROJECT_REVIEW);
  assert(lc.phase === 'PROJECT_REVIEW', 'BUILD → PROJECT_REVIEW valid');

  await lc.transitionTo(ProjectPhase.BUILD);
  assert(lc.phase === 'BUILD', 'PROJECT_REVIEW → BUILD valid');

  await lc.transitionTo(ProjectPhase.COMPLETED);
  assert(lc.phase === 'COMPLETED', 'BUILD → COMPLETED valid');

  // Cleanup
  db.prepare('DELETE FROM project_lifecycles WHERE id = ?').run(lc.id);
}

{
  // Invalid transitions
  const lc = new ProjectLifecycle({
    id: `lc-sm2-${Date.now()}`,
    projectId: testProjectId,
    projectPath: '/tmp/test',
  });
  lc.save();

  // SPEC → BUILD (invalid — must go through PLANNING)
  await assertThrowsAsync(
    () => lc.transitionTo(ProjectPhase.BUILD),
    'SPEC → BUILD is invalid'
  );

  // SPEC → COMPLETED (invalid)
  await assertThrowsAsync(
    () => lc.transitionTo(ProjectPhase.COMPLETED),
    'SPEC → COMPLETED is invalid'
  );

  // SPEC → CHANGE_MANAGEMENT (invalid)
  await assertThrowsAsync(
    () => lc.transitionTo(ProjectPhase.CHANGE_MANAGEMENT),
    'SPEC → CHANGE_MANAGEMENT is invalid'
  );

  // Cleanup
  db.prepare('DELETE FROM project_lifecycles WHERE id = ?').run(lc.id);
}

{
  // SPEC_REVIEW → SPEC (revision path)
  const lc = new ProjectLifecycle({
    id: `lc-sm3-${Date.now()}`,
    projectId: testProjectId,
    projectPath: '/tmp/test',
  });
  lc.save();

  await lc.transitionTo(ProjectPhase.SPEC_REVIEW);
  await lc.transitionTo(ProjectPhase.SPEC); // Revision
  assert(lc.phase === 'SPEC', 'SPEC_REVIEW → SPEC (revision) valid');

  // Cleanup
  db.prepare('DELETE FROM project_lifecycles WHERE id = ?').run(lc.id);
}

{
  // fail() from any state
  const lc = new ProjectLifecycle({
    id: `lc-sm4-${Date.now()}`,
    projectId: testProjectId,
    projectPath: '/tmp/test',
  });
  lc.save();

  await lc.transitionTo(ProjectPhase.SPEC_REVIEW);
  await lc.fail('test failure');
  assert(lc.phase === 'FAILED', 'fail() from SPEC_REVIEW → FAILED');

  // Terminal — no more transitions
  await assertThrowsAsync(
    () => lc.transitionTo(ProjectPhase.SPEC),
    'FAILED → SPEC is invalid (terminal state)'
  );

  // Cleanup
  db.prepare('DELETE FROM project_lifecycles WHERE id = ?').run(lc.id);
}

{
  // BUILD → PAUSED → BUILD
  const lc = new ProjectLifecycle({
    id: `lc-sm5-${Date.now()}`,
    projectId: testProjectId,
    projectPath: '/tmp/test',
  });
  lc.save();

  await lc.transitionTo(ProjectPhase.SPEC_REVIEW);
  await lc.transitionTo(ProjectPhase.PLANNING);
  await lc.transitionTo(ProjectPhase.PLAN_REVIEW);
  await lc.transitionTo(ProjectPhase.BUILD);
  await lc.transitionTo(ProjectPhase.PAUSED);
  assert(lc.phase === 'PAUSED', 'BUILD → PAUSED valid');

  await lc.transitionTo(ProjectPhase.BUILD);
  assert(lc.phase === 'BUILD', 'PAUSED → BUILD valid');

  // Cleanup
  db.prepare('DELETE FROM project_lifecycles WHERE id = ?').run(lc.id);
}

{
  // BUILD → CHANGE_MANAGEMENT → BUILD
  const lc = new ProjectLifecycle({
    id: `lc-sm6-${Date.now()}`,
    projectId: testProjectId,
    projectPath: '/tmp/test',
  });
  lc.save();

  await lc.transitionTo(ProjectPhase.SPEC_REVIEW);
  await lc.transitionTo(ProjectPhase.PLANNING);
  await lc.transitionTo(ProjectPhase.PLAN_REVIEW);
  await lc.transitionTo(ProjectPhase.BUILD);
  await lc.transitionTo(ProjectPhase.CHANGE_MANAGEMENT);
  assert(lc.phase === 'CHANGE_MANAGEMENT', 'BUILD → CHANGE_MANAGEMENT valid');

  await lc.transitionTo(ProjectPhase.BUILD);
  assert(lc.phase === 'BUILD', 'CHANGE_MANAGEMENT → BUILD valid');

  // Cleanup
  db.prepare('DELETE FROM project_lifecycles WHERE id = ?').run(lc.id);
}

// ════════════════════════════════════════════════════════════════════════════════
// 5. Review Frequency
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Review Frequency ──');

{
  const lc = new ProjectLifecycle({
    id: `lc-rf-${Date.now()}`,
    projectId: testProjectId,
    projectPath: '/tmp/test',
    lifecycleConfig: { reviewFrequency: 3 },
  });

  assert(lc.isReviewDue() === false, 'review not due at 0 milestones');

  lc.incrementCompleted();
  assert(lc.isReviewDue() === false, 'review not due at 1 milestone');

  lc.incrementCompleted();
  assert(lc.isReviewDue() === false, 'review not due at 2 milestones');

  lc.incrementCompleted();
  assert(lc.isReviewDue() === true, 'review due at 3 milestones (reviewFrequency=3)');

  lc.incrementCompleted();
  assert(lc.isReviewDue() === false, 'review not due at 4 milestones');

  lc.incrementCompleted();
  lc.incrementCompleted();
  assert(lc.isReviewDue() === true, 'review due at 6 milestones');
}

{
  const lc = new ProjectLifecycle({
    id: `lc-rf2-${Date.now()}`,
    projectId: testProjectId,
    projectPath: '/tmp/test',
    lifecycleConfig: { reviewFrequency: 1 },
  });

  lc.incrementCompleted();
  assert(lc.isReviewDue() === true, 'reviewFrequency=1 → every milestone triggers review');
}

// ════════════════════════════════════════════════════════════════════════════════
// 6. Lifecycle Persistence
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Lifecycle Persistence ──');

{
  const lc = new ProjectLifecycle({
    id: `lc-persist-${Date.now()}`,
    projectId: testProjectId,
    projectPath: '/tmp/test',
    lifecycleConfig: { reviewFrequency: 5, maxMilestoneLOC: 1500 },
  });
  lc.save();

  // Read from DB
  const row = lifecycleRepo.findById.get(lc.id);
  assert(row !== undefined, 'lifecycle persisted to DB');
  assert(row.phase === 'SPEC', 'persisted phase is SPEC');

  const cfg = JSON.parse(row.config);
  assert(cfg.reviewFrequency === 5, 'persisted config.reviewFrequency = 5');
  assert(cfg.maxMilestoneLOC === 1500, 'persisted config.maxMilestoneLOC = 1500');

  // Transition and check persistence
  await lc.transitionTo(ProjectPhase.SPEC_REVIEW);
  const row2 = lifecycleRepo.findById.get(lc.id);
  assert(row2.phase === 'SPEC_REVIEW', 'phase transition persisted to DB');

  // Cleanup
  db.prepare('DELETE FROM project_lifecycles WHERE id = ?').run(lc.id);
}

// ════════════════════════════════════════════════════════════════════════════════
// 7. checkDependencies (DB-backed)
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── checkDependencies (DB) ──');

{
  const lcId = `lc-deps-${Date.now()}`;
  lifecycleRepo.save(lcId, testProjectId, 'BUILD', null, {});

  // ms-1: no deps (ready immediately)
  msRepo.addMilestone({
    id: `ms-d1-${Date.now()}`,
    lifecycle_id: lcId,
    roadmap_version: 1,
    sequence: 1,
    title: 'Setup',
    dependencies: [],
  });

  const ms1Id = `ms-d1-${Date.now()}`.replace('ms-d1-', `ms-d1-`);

  // For the actual check, use the IDs we just created
  const allMs = msRepo.listByLifecycle(lcId);
  const firstMs = allMs[0];

  const check1 = checkDependencies(firstMs.id, lcId);
  assert(check1.ready === true, 'ms with no deps → ready');
  assert(check1.blockedBy.length === 0, 'no blockers');

  // ms-2 depends on ms-1 (which is PENDING, not PASSED)
  const ms2Id = `ms-d2-${Date.now()}`;
  msRepo.addMilestone({
    id: ms2Id,
    lifecycle_id: lcId,
    roadmap_version: 1,
    sequence: 2,
    title: 'Core',
    dependencies: [firstMs.id],
  });

  const check2 = checkDependencies(ms2Id, lcId);
  assert(check2.ready === false, 'ms-2 blocked by unfinished ms-1');
  assert(check2.blockedBy.length === 1, 'exactly 1 blocker');
  assert(check2.blockedBy[0] === firstMs.id, 'blocker is ms-1');

  // Mark ms-1 as PASSED
  msRepo.updateCompletion.run('hash123', 'tag123', '{}', firstMs.id);

  const check3 = checkDependencies(ms2Id, lcId);
  assert(check3.ready === true, 'ms-2 ready after ms-1 PASSED');

  // Cleanup
  db.prepare('DELETE FROM milestones WHERE lifecycle_id = ?').run(lcId);
  db.prepare('DELETE FROM project_lifecycles WHERE id = ?').run(lcId);
}

{
  // Nonexistent milestone
  const check = checkDependencies('ms-nonexistent', 'lc-nonexistent');
  assert(check.ready === false, 'nonexistent milestone → not ready');
}

// ════════════════════════════════════════════════════════════════════════════════
// 8. Lifecycle Status
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Lifecycle Status ──');

{
  const lc = new ProjectLifecycle({
    id: `lc-status-${Date.now()}`,
    projectId: testProjectId,
    projectPath: '/tmp/test',
    lifecycleConfig: { reviewFrequency: 3 },
  });

  const status = lc.getStatus();
  assert(status.id === lc.id, 'status has correct id');
  assert(status.phase === 'SPEC', 'status shows SPEC phase');
  assert(status.completedMilestones === 0, 'status shows 0 completed');
  assert(status.config.reviewFrequency === 3, 'status includes config');
}

// ════════════════════════════════════════════════════════════════════════════════
// 9. Index Exports
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Index Exports ──');

{
  // Verify all expected exports are available from planner/index.js
  const indexModule = await import('../src/planner/index.js');

  assert(typeof indexModule.ProjectPhase === 'object', 'index exports ProjectPhase');
  assert(typeof indexModule.MilestoneStatus === 'object', 'index exports MilestoneStatus');
  assert(typeof indexModule.ChangeRequestStatus === 'object', 'index exports ChangeRequestStatus');
  assert(typeof indexModule.ProjectLifecycle === 'function', 'index exports ProjectLifecycle');
  assert(typeof indexModule.validateSpec === 'function', 'index exports validateSpec');
  assert(typeof indexModule.validateDependencies === 'function', 'index exports validateDependencies');
  assert(typeof indexModule.checkDependencies === 'function', 'index exports checkDependencies');
  assert(typeof indexModule.validateMilestoneSize === 'function', 'index exports validateMilestoneSize');
  assert(typeof indexModule.suggestMilestoneSplit === 'function', 'index exports suggestMilestoneSplit');
  assert(typeof indexModule.estimateContextTokens === 'function', 'index exports estimateContextTokens');
  assert(typeof indexModule.callLLM === 'function', 'index exports callLLM');
  assert(typeof indexModule.parseJSON === 'function', 'index exports parseJSON');

  // Existing exports still work
  assert(typeof indexModule.WorkflowOrchestrator === 'function', 'index still exports WorkflowOrchestrator');
  assert(typeof indexModule.WorkflowState === 'object', 'index still exports WorkflowState');
  assert(typeof indexModule.workflowOrchestrator === 'object', 'index still exports workflowOrchestrator singleton');
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
console.log(`  Lifecycle Tests: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(60)}\n`);

if (failures.length > 0) {
  console.log('  Failures:');
  for (const f of failures) {
    console.log(`    - ${f.name}: ${f.msg}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
