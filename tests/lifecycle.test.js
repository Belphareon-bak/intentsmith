import './helpers/isolated-test-db.js';

// Lifecycle Tests — SPEC + PLANNING Phases
// ══════════════════════════════════════════════════════════════════════════════
// Tests: spec validation, dependency validation, planning helpers, enums,
//        state machine transitions
//
// Run: node tests/lifecycle.test.js
//
// Model quality remains covered by registered integration programs. SPEC
// answer retention below uses the real repository and an inert callLLM seam;
// it does not contact a model or execute generated code.
// ══════════════════════════════════════════════════════════════════════════════

import { startSpec, answerSpecQuestions, approveSpec, reviseSpec, validateSpec } from '../src/planner/lifecycle-spec.js';
import { specAnalyze, specDocument } from '../src/planner/lifecycle-prompts.js';
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
  assert(result.errors.some(e => e.toLowerCase().includes('requirements')), 'empty spec: missing reqs error');
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
      { id: 'G1', description: 'User can browse products', success_criteria: 'Product listing page renders 20+ items' },
      { id: 'G2', description: 'User can add to cart', success_criteria: 'Cart badge shows correct count' },
      { id: 'G3', description: 'User can checkout', success_criteria: 'Order confirmation page shown after payment' },
    ],
    requirements: [
      { id: 'R1', description: 'Product listing page', acceptance_test: 'GET /products returns 200 with items' },
      { id: 'R2', description: 'Product detail page', acceptance_test: 'GET /products/:id returns product details' },
      { id: 'R3', description: 'Shopping cart', acceptance_test: 'POST /cart/add → cart count increments' },
      { id: 'R4', description: 'Checkout flow', acceptance_test: 'POST /checkout → order created in DB' },
      { id: 'R5', description: 'Order confirmation', acceptance_test: 'GET /orders/:id shows order summary' },
    ],
    tech_stack: {
      languages: ['TypeScript'],
      frameworks: ['Next.js'],
    },
    design_decisions: [
      { id: 'DD1', decision: 'Payment gateway', chosen: 'Stripe', alternatives_considered: ['Stripe', 'PayPal'], rationale: 'Better developer experience and documentation' },
    ],
    risks: [
      { id: 'RISK1', description: 'Payment integration complexity', severity: 'MEDIUM', mitigation: 'Use Stripe' },
    ],
    acceptance_criteria: ['User can complete full purchase flow end-to-end'],
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


// ─── SPEC clarification retention (real private DB, inert D1) ───────────────
console.log('\n── SPEC clarification retention ──');
{
  const draft = { _phase: 'ANALYZING', _request: 'Build a recipe API.', _assessment: { complexity: 'MEDIUM' }, _technicalDecisions: [], _implicitAssumptions: [] };
  let counter = 0;
  const newLifecycle = (callLLM, initial = draft) => {
    const lifecycle = new ProjectLifecycle({ id: `lc-answers-${Date.now()}-${counter++}`, projectId: testProjectId, projectPath: '/tmp/test', callLLM });
    lifecycle.save();
    lifecycleRepo.updateSpec.run(JSON.stringify(initial), lifecycle.id);
    return lifecycle;
  };
  const failureOf = async promise => {
    try { await promise; return null; } catch (error) { return error; }
  };
  const valid = title => ({
    title,
    goals: [1, 2, 3].map(id => ({ id: `G${id}`, description: `Goal ${id}`, success_criteria: `Check ${id}` })),
    requirements: [1, 2, 3, 4, 5].map(id => ({ id: `R${id}`, description: `Requirement ${id}`, acceptance_test: `Test ${id}` })),
    tech_stack: { languages: ['Python'] },
    design_decisions: [{ id: 'DD1', decision: 'Database', rationale: 'Local use', alternatives_considered: ['SQLite', 'PostgreSQL'] }],
    risks: [{ id: 'RISK1', description: 'Concurrent writes' }],
    acceptance_criteria: ['All API tests pass'],
  });

  const prompts = [];
  const malformed = async (_role, prompt) => { prompts.push(prompt); return { content: 'SYNTHETIC malformed spec' }; };
  const first = 'Use SQLite; preserve recipes offline.';
  const second = 'Change storage to PostgreSQL; retain recipe export.';
  const lifecycle = newLifecycle(malformed);
  await failureOf(answerSpecQuestions(lifecycle, first));
  assert(prompts[0] === specDocument(draft._request, first, { ...draft._assessment, technical_decisions: [], implicit_assumptions: [] }), 'first SPEC prompt remains byte-for-byte unchanged');
  assert(JSON.stringify(lifecycleRepo.getSpec(lifecycle.id)._clarificationAnswers) === JSON.stringify([first]), 'parse failure durably retains first clarification');
  const resumed = ProjectLifecycle.resume(lifecycle.id, '/tmp/test');
  resumed.callLLM = malformed;
  await failureOf(answerSpecQuestions(resumed, second));
  await failureOf(answerSpecQuestions(resumed, first));
  await failureOf(answerSpecQuestions(resumed, first));
  assert(JSON.stringify(lifecycleRepo.getSpec(lifecycle.id)._clarificationAnswers) === JSON.stringify([first, second, first]), 'resume retains A → B → A corrections and coalesces only consecutive duplicates');
  assert(prompts[2].includes(first + '\n\n' + second + '\n\n' + first) && prompts[2] === prompts[3], 'all prior answers reach D1 once per retained turn without duplicated retry context');
  assert(lifecycleRepo.findById.get(lifecycle.id).phase === 'SPEC', 'malformed output does not advance SPEC');

  const isolatedPrompts = [];
  const isolated = newLifecycle(async (_role, prompt) => { isolatedPrompts.push(prompt); throw new Error('SYNTHETIC transport failure'); });
  await failureOf(answerSpecQuestions(isolated, 'Use local image files only.'));
  assert(!isolatedPrompts[0].includes(first) && JSON.stringify(lifecycleRepo.getSpec(isolated.id)._clarificationAnswers) === JSON.stringify(['Use local image files only.']), 'transport failure retains answers only in its own lifecycle draft');

  const validationPrompts = [];
  const fullDraft = {
    ...draft,
    _questions: ['Must recipes remain usable offline?'],
    _technicalDecisions: [{ area: 'Storage', decision: 'SQLite', rationale: 'Offline use', alternatives_considered: ['PostgreSQL', 'JSON files'] }],
    _implicitAssumptions: ['Recipes contain Unicode ingredient names.'],
    _learnedPatternConformance: [{ itemId: 'pattern-local-storage', status: 'conformed', evidence: 'Keep local storage.' }],
  };
  let validationRound = 0;
  const validationLc = newLifecycle(async (_role, prompt) => {
    validationPrompts.push(prompt);
    return { content: JSON.stringify(validationRound++ === 0
      ? { title: 'Incomplete', _request: 'MODEL MUST NOT REPLACE REQUEST', _assessment: {}, _questions: [], _technicalDecisions: [], _implicitAssumptions: [], _learnedPatternConformance: [], _clarificationAnswers: ['MODEL MUST NOT REPLACE ANSWERS'] }
      : valid('Completed')) };
  }, fullDraft);
  const invalid = await answerSpecQuestions(validationLc, first);
  const invalidDraft = lifecycleRepo.getSpec(validationLc.id);
  const contextFields = ['_request', '_assessment', '_questions', '_technicalDecisions', '_implicitAssumptions', '_learnedPatternConformance'];
  assert(contextFields.every(key => JSON.stringify(invalidDraft[key]) === JSON.stringify(fullDraft[key])), 'validation failure preserves original draft facts and conformance against model replacement');
  const corrected = await answerSpecQuestions(validationLc, second);
  assert(validationPrompts[1] === specDocument(fullDraft._request, first + '\n\n' + second, { ...fullDraft._assessment, technical_decisions: fullDraft._technicalDecisions, implicit_assumptions: fullDraft._implicitAssumptions }), 'validation retry receives every original technical decision and implicit assumption');
  assert(invalid.needsMore === true && corrected.needsMore === false && validationPrompts[1].includes(first + '\n\n' + second), 'validation failure also preserves earlier clarification for correction');

  // The cap applies only to added prior-answer context, never the first input.
  let largeCalls = 0;
  const large = newLifecycle(async () => { largeCalls++; return { content: 'SYNTHETIC malformed spec' }; });
  const largeAnswer = 'é'.repeat(4096); // 8192 UTF-8 bytes, plus two prefix newlines.
  await failureOf(answerSpecQuestions(large, largeAnswer));
  assert(largeCalls === 1, 'original large single answer is not newly rejected');
  const beforeOverflow = lifecycleRepo.findById.get(large.id).spec;
  const overflow = await failureOf(answerSpecQuestions(large, 'Keep every earlier requirement.'));
  assert(overflow?.code === 'SPEC_CLARIFICATION_BUDGET_EXCEEDED' && largeCalls === 1 && lifecycleRepo.findById.get(large.id).spec === beforeOverflow, 'over-budget UTF-8 history fails before model and preserves exact prior draft');
  await failureOf(answerSpecQuestions(large, largeAnswer));
  assert(largeCalls === 2 && JSON.stringify(lifecycleRepo.getSpec(large.id)._clarificationAnswers) === JSON.stringify([largeAnswer]), 'identical retry adds no history and still accepts the original large answer');

  const boundary = newLifecycle(malformed);
  const boundaryAnswer = 'é'.repeat(4095); // 8190 bytes + two newlines = exact8192.
  await failureOf(answerSpecQuestions(boundary, boundaryAnswer));
  const beforeBoundaryCalls = prompts.length;
  await failureOf(answerSpecQuestions(boundary, 'Refinement'));
  assert(prompts.length === beforeBoundaryCalls + 1 && lifecycleRepo.getSpec(boundary.id)._clarificationAnswers?.length === 2, 'exact UTF-8 prior-prefix boundary is accepted without dropping content');

  const pending = [];
  const concurrent = newLifecycle((_role, prompt) => new Promise(resolve => pending.push({ prompt, resolve })));
  const older = answerSpecQuestions(concurrent, first).then(value => ({ value }), error => ({ error }));
  const newer = answerSpecQuestions(concurrent, second).then(value => ({ value }), error => ({ error }));
  pending[1].resolve({ content: JSON.stringify(valid('Newer complete spec')) });
  const newerResult = await newer;
  pending[0].resolve({ content: JSON.stringify(valid('Older stale spec')) });
  const olderResult = await older;
  assert(newerResult.value?.needsMore === false && olderResult.error?.code === 'SPEC_DRAFT_STALE' && lifecycleRepo.getSpec(concurrent.id).title === 'Newer complete spec', 'overlapping stale completion cannot overwrite the newer specification');
  assert(pending[1].prompt.includes(first + '\n\n' + second), 'overlapping later turn includes the earlier persisted clarification');

  let releasePhase;
  const phaseLc = newLifecycle(() => new Promise(resolve => { releasePhase = resolve; }));
  const phaseResult = answerSpecQuestions(phaseLc, first).then(value => ({ value }), error => ({ error }));
  const pendingPhaseSpec = lifecycleRepo.findById.get(phaseLc.id).spec;
  lifecycleRepo.updatePhase.run('SPEC_REVIEW', phaseLc.id);
  releasePhase({ content: JSON.stringify(valid('Unexpected late spec')) });
  const phaseOutcome = await phaseResult;
  assert(phaseOutcome.error?.code === 'SPEC_DRAFT_STALE' && lifecycleRepo.findById.get(phaseLc.id).spec === pendingPhaseSpec, 'atomic draft replacement also rejects a concurrent phase change');

  // All three JSON-contract consumers opt in through the existing options seam.
  // Real private lifecycle state and functions run; D1 itself is inert.
  const structuredCalls = [];
  const analysis = { clarifying_questions: ['Which database?'], initial_assessment: { complexity: 'MEDIUM' } };
  const structured = newLifecycle(async (...args) => {
    structuredCalls.push(args);
    return { content: JSON.stringify(structuredCalls.length === 2 ? valid('Structured spec') : analysis) };
  });
  await startSpec(structured, 'Build a recipe API.');
  await answerSpecQuestions(structured, 'Use SQLite.');
  const previous = lifecycleRepo.getSpec(structured.id);
  await structured.transitionTo(ProjectPhase.SPEC_REVIEW);
  await reviseSpec(structured, 'Add sorting.');
  assert(structuredCalls.length === 3 && structuredCalls.every(args => args[0] === 'D1' && args[2] === '' && JSON.stringify(args[3]) === JSON.stringify({ format: 'json' })), 'SPEC analysis, document and revision request JSON format without token/context overrides');
  assert(structuredCalls[0][1] === specAnalyze('Build a recipe API.', ''), 'JSON mode preserves initial analysis prompt bytes');
  assert(structuredCalls[1][1] === specDocument('Build a recipe API.', 'Use SQLite.', { ...analysis.initial_assessment, technical_decisions: [], implicit_assumptions: [] }), 'JSON mode preserves full SPEC document prompt bytes');
  assert(structuredCalls[2][1] === specAnalyze(`Build a recipe API.\n\nUser feedback on spec: Add sorting.\n\nPrevious spec: ${JSON.stringify(valid('Structured spec'))}`, ''), 'JSON revision prompt retains original request and public previous spec');
  assert(lifecycleRepo.getSpec(structured.id)._phase === 'REVISING', 'valid revised JSON still commits the original revision draft');

  let corruptCalls = 0;
  const corrupt = newLifecycle(async () => { corruptCalls++; return { content: 'SYNTHETIC malformed' }; }, { ...draft, _clarificationAnswers: ['Saved answer', 42] });
  const corruptError = await failureOf(answerSpecQuestions(corrupt, first));
  assert(corruptError?.code === 'SPEC_CLARIFICATION_HISTORY_INVALID' && corruptCalls === 0, 'malformed stored history fails closed before a model call');

  // SPEC_REVIEW feedback retention uses the same real repository and phase owner.
  const originalRequest = 'Build a recipe API with the exact original Unicode request: polévka.';
  const initialSpec = valid('Accepted initial spec');
  const reviewAnalysis = {
    initial_assessment: { complexity: 'MEDIUM', required: ['Keep local recipes'] },
    clarifying_questions: ['Which sorting order?'],
    technical_decisions: [{ decision: 'Stable query sorting', alternatives: ['Ascending', 'Descending'] }],
    implicit_assumptions: ['Preserve all recipe fields'],
  };
  const reviewLifecycle = async (callLLM, spec = { ...initialSpec, _request: originalRequest }) => {
    const lc = newLifecycle(callLLM, spec);
    await lc.transitionTo(ProjectPhase.SPEC_REVIEW);
    return lc;
  };
  const expectedReviewRequest = (history, previous = initialSpec) => `${originalRequest}\n\nUser feedback on spec: ${history.join('\n\n')}\n\nPrevious spec: ${JSON.stringify(previous)}`;
  const reviewA = 'Add sort=prep_time_asc and default created_at_desc.';
  const reviewB = 'Add optional nutrition fields without removing sorting.';
  const reviewC = 'Keep the exact requested sorting names.';
  const reviewPrompts = [];
  let reviewRound = 0;
  const reviewModel = async (_role, prompt) => {
    reviewPrompts.push(prompt);
    const n = reviewRound++;
    if (n === 1) throw new Error('SYNTHETIC review transport failure');
    if (n < 4) return { content: 'SYNTHETIC malformed review JSON' };
    if (n === 4) return { content: JSON.stringify(reviewAnalysis) };
    return { content: JSON.stringify({ ...valid('Completed revision'), _request: 'MODEL FORGED REQUEST', _reviewFeedback: ['MODEL FORGED FEEDBACK'] }) };
  };
  const reviewLc = await reviewLifecycle(reviewModel);
  await failureOf(reviseSpec(reviewLc, reviewA));
  assert(JSON.stringify(lifecycleRepo.getSpec(reviewLc.id)._reviewFeedback) === JSON.stringify([reviewA]), 'failed review durably retains the exact first feedback before awaiting D1');
  assert(lifecycleRepo.findById.get(reviewLc.id).phase === 'SPEC_REVIEW', 'malformed review remains in SPEC_REVIEW');
  assert(reviewPrompts[0] === specAnalyze(expectedReviewRequest([reviewA]), ''), 'review prompt retains original request and only the full public previous spec');
  const reviewResumed = ProjectLifecycle.resume(reviewLc.id, '/tmp/test');
  reviewResumed.callLLM = reviewModel;
  await failureOf(reviseSpec(reviewResumed, reviewB));
  assert(JSON.stringify(lifecycleRepo.getSpec(reviewLc.id)._reviewFeedback) === JSON.stringify([reviewA, reviewB]), 'review transport failure after resume retains both ordered feedback turns');
  await failureOf(reviseSpec(reviewResumed, reviewA));
  await failureOf(reviseSpec(reviewResumed, reviewA));
  assert(JSON.stringify(lifecycleRepo.getSpec(reviewLc.id)._reviewFeedback) === JSON.stringify([reviewA, reviewB, reviewA]), 'review keeps A to B to A and coalesces only consecutive exact duplicates');
  assert(reviewPrompts[2] === reviewPrompts[3] && reviewPrompts[2] === specAnalyze(expectedReviewRequest([reviewA, reviewB, reviewA]), ''), 'retained review history reaches the same request exactly once per turn');
  await reviseSpec(reviewResumed, reviewC);
  const reviewDraft = lifecycleRepo.getSpec(reviewLc.id);
  assert(reviewResumed.phase === 'SPEC' && lifecycleRepo.findById.get(reviewLc.id).phase === 'SPEC', 'successful revised analysis advances the real phase owner to SPEC');
  assert(reviewDraft._request === originalRequest && JSON.stringify(reviewDraft._previousSpec) === JSON.stringify(initialSpec), 'revised draft preserves original request and full public previous spec separately');
  assert(JSON.stringify(reviewDraft._technicalDecisions) === JSON.stringify(reviewAnalysis.technical_decisions) && JSON.stringify(reviewDraft._implicitAssumptions) === JSON.stringify(reviewAnalysis.implicit_assumptions), 'revised analysis retains all technical decisions and assumptions for the next generation');
  const reviewAnswer = 'Use nullable nutrition and stable sorting.';
  await answerSpecQuestions(reviewResumed, reviewAnswer);
  assert(reviewPrompts[5] === specDocument(expectedReviewRequest([reviewA, reviewB, reviewA, reviewC]), reviewAnswer, { ...reviewAnalysis.initial_assessment, technical_decisions: reviewAnalysis.technical_decisions, implicit_assumptions: reviewAnalysis.implicit_assumptions }), 'complete revised SPEC prompt includes all retained feedback and analysis facts once');
  const completedReview = lifecycleRepo.getSpec(reviewLc.id);
  assert(completedReview._request === originalRequest && completedReview.title === 'Completed revision', 'valid revised SPEC preserves original request against model metadata replacement');
  assert(completedReview._reviewFeedback === undefined && completedReview._previousSpec === undefined, 'valid revised SPEC clears resolved pending feedback and recursive previous-spec metadata');
  await reviewResumed.transitionTo(ProjectPhase.SPEC_REVIEW);
  reviewResumed.callLLM = async (_role, prompt) => { reviewPrompts.push(prompt); return { content: 'SYNTHETIC malformed later review' }; };
  await failureOf(reviseSpec(reviewResumed, reviewB));
  assert(reviewPrompts.at(-1) === specAnalyze(expectedReviewRequest([reviewB], valid('Completed revision')), ''), 'later review uses the latest public spec without nesting earlier review metadata');

  const initialAccepted = newLifecycle(async () => ({ content: JSON.stringify({ ...initialSpec, _request: 'MODEL REPLACEMENT' }) }), { ...draft, _request: originalRequest });
  await answerSpecQuestions(initialAccepted, 'Initial details');
  assert(lifecycleRepo.getSpec(initialAccepted.id)._request === originalRequest, 'initial valid SPEC also retains exact original request');

  const legacyPrompts = [];
  const legacyReview = await reviewLifecycle(async (_role, prompt) => {
    legacyPrompts.push(prompt);
    return { content: JSON.stringify(legacyPrompts.length === 1 ? reviewAnalysis : valid('Legacy revision')) };
  }, initialSpec);
  await reviseSpec(legacyReview, reviewA);
  const legacyResult = await answerSpecQuestions(legacyReview, reviewAnswer);
  const legacyRequest = `\n\nUser feedback on spec: ${reviewA}\n\nPrevious spec: ${JSON.stringify(initialSpec)}`;
  assert(legacyResult.needsMore === false && lifecycleRepo.getSpec(legacyReview.id)._request === '', 'legacy accepted SPEC without recoverable original request can still complete a revision');
  assert(legacyPrompts[0] === specAnalyze(legacyRequest, '') && legacyPrompts[1] === specDocument(legacyRequest, reviewAnswer, { ...reviewAnalysis.initial_assessment, technical_decisions: reviewAnalysis.technical_decisions, implicit_assumptions: reviewAnalysis.implicit_assumptions }), 'legacy revision retains all available feedback and public spec without inventing the original request');

  const invalidRevisionPrompts = [];
  const invalidRevision = await reviewLifecycle(async (_role, prompt) => {
    invalidRevisionPrompts.push(prompt);
    const content = invalidRevisionPrompts.length === 1 ? reviewAnalysis
      : invalidRevisionPrompts.length === 2 ? { title: 'Invalid revision', _request: 'MODEL FORGED', _reviewFeedback: ['MODEL FORGED'], _previousSpec: { title: 'MODEL FORGED' } }
        : valid('Revision after validation failure');
    return { content: JSON.stringify(content) };
  });
  await reviseSpec(invalidRevision, reviewA);
  const invalidRevisionResult = await answerSpecQuestions(invalidRevision, reviewAnswer);
  const invalidRevisionDraft = lifecycleRepo.getSpec(invalidRevision.id);
  assert(invalidRevisionResult.needsMore === true && invalidRevisionDraft._request === originalRequest && JSON.stringify(invalidRevisionDraft._reviewFeedback) === JSON.stringify([reviewA]) && JSON.stringify(invalidRevisionDraft._previousSpec) === JSON.stringify(initialSpec), 'invalid revised document preserves actual review context against forged model metadata');
  const retriedRevisionResult = await answerSpecQuestions(invalidRevision, reviewAnswer);
  assert(retriedRevisionResult.needsMore === false && invalidRevisionPrompts[1] === invalidRevisionPrompts[2] && invalidRevisionPrompts[2] === specDocument(expectedReviewRequest([reviewA]), reviewAnswer, { ...reviewAnalysis.initial_assessment, technical_decisions: reviewAnalysis.technical_decisions, implicit_assumptions: reviewAnalysis.implicit_assumptions }), 'retry after revision validation failure reuses all retained facts exactly once');

  const pendingApproval = await reviewLifecycle(async () => ({ content: 'SYNTHETIC malformed' }));
  await failureOf(reviseSpec(pendingApproval, reviewA));
  const approvalBefore = lifecycleRepo.findById.get(pendingApproval.id).spec;
  const approvalError = await failureOf(approveSpec(pendingApproval));
  assert(approvalError?.code === 'SPEC_REVIEW_PENDING' && lifecycleRepo.findById.get(pendingApproval.id).phase === 'SPEC_REVIEW' && lifecycleRepo.findById.get(pendingApproval.id).spec === approvalBefore, 'failed pending feedback cannot approve the stale previous specification');

  let largeReviewCalls = 0;
  const largeReview = await reviewLifecycle(async () => { largeReviewCalls++; return { content: 'SYNTHETIC malformed' }; });
  await failureOf(reviseSpec(largeReview, largeAnswer));
  assert(largeReviewCalls === 1, 'original large single review feedback is not newly capped');
  const largeReviewBefore = lifecycleRepo.findById.get(largeReview.id).spec;
  const largeReviewError = await failureOf(reviseSpec(largeReview, reviewB));
  assert(largeReviewError?.code === 'SPEC_REVIEW_FEEDBACK_BUDGET_EXCEEDED' && largeReviewCalls === 1 && lifecycleRepo.findById.get(largeReview.id).spec === largeReviewBefore, 'UTF-8 review prefix overflow rejects before model without discarding or mutating prior feedback');
  await failureOf(reviseSpec(largeReview, largeAnswer));
  assert(largeReviewCalls === 2 && lifecycleRepo.getSpec(largeReview.id)._reviewFeedback?.length === 1, 'duplicate large review retry adds no prefix bytes');
  let boundaryReviewCalls = 0;
  const boundaryReview = await reviewLifecycle(async () => { boundaryReviewCalls++; return { content: 'SYNTHETIC malformed' }; });
  await failureOf(reviseSpec(boundaryReview, boundaryAnswer));
  await failureOf(reviseSpec(boundaryReview, reviewB));
  assert(boundaryReviewCalls === 2 && lifecycleRepo.getSpec(boundaryReview.id)._reviewFeedback?.length === 2, 'exact 8192-byte review prefix boundary remains allowed');

  const reviewPending = [];
  const reviewConcurrent = await reviewLifecycle((_role, prompt) => new Promise(resolve => reviewPending.push({ prompt, resolve })));
  const reviewOlder = reviseSpec(reviewConcurrent, reviewA).then(value => ({ value }), error => ({ error }));
  const reviewNewer = reviseSpec(reviewConcurrent, reviewB).then(value => ({ value }), error => ({ error }));
  reviewPending[1].resolve({ content: JSON.stringify(reviewAnalysis) });
  const reviewNewerOutcome = await reviewNewer;
  const reviewNewerBytes = lifecycleRepo.findById.get(reviewConcurrent.id).spec;
  reviewPending[0].resolve({ content: JSON.stringify({ ...reviewAnalysis, initial_assessment: { stale: true } }) });
  const reviewOlderOutcome = await reviewOlder;
  assert(reviewNewerOutcome.value && reviewOlderOutcome.error?.code === 'SPEC_DRAFT_STALE' && lifecycleRepo.findById.get(reviewConcurrent.id).spec === reviewNewerBytes, 'older review completion cannot overwrite newer exact draft or phase');
  assert(reviewPending[1].prompt === specAnalyze(expectedReviewRequest([reviewA, reviewB]), ''), 'overlapping newer review request contains earlier feedback before model completion');

  let finishReviewPhase;
  const phaseReview = await reviewLifecycle(() => new Promise(resolve => { finishReviewPhase = resolve; }));
  const phaseReviewPending = reviseSpec(phaseReview, reviewA).then(value => ({ value }), error => ({ error }));
  const pendingReviewBytes = lifecycleRepo.findById.get(phaseReview.id).spec;
  lifecycleRepo.updatePhase.run('PLANNING', phaseReview.id);
  finishReviewPhase({ content: JSON.stringify(reviewAnalysis) });
  const phaseReviewOutcome = await phaseReviewPending;
  assert(phaseReviewOutcome.error?.code === 'SPEC_DRAFT_STALE' && lifecycleRepo.findById.get(phaseReview.id).spec === pendingReviewBytes && lifecycleRepo.findById.get(phaseReview.id).phase === 'PLANNING', 'review completion CAS rejects changed database phase without overwriting it');

  let finishReviewBytes;
  const changedReview = await reviewLifecycle(() => new Promise(resolve => { finishReviewBytes = resolve; }));
  const changedPending = reviseSpec(changedReview, reviewA).then(value => ({ value }), error => ({ error }));
  const changedValue = JSON.stringify({ ...initialSpec, title: 'Newer external draft', _request: originalRequest });
  lifecycleRepo.updateSpec.run(changedValue, changedReview.id);
  finishReviewBytes({ content: JSON.stringify(reviewAnalysis) });
  const changedOutcome = await changedPending;
  assert(changedOutcome.error?.code === 'SPEC_DRAFT_STALE' && lifecycleRepo.findById.get(changedReview.id).spec === changedValue, 'review completion CAS rejects changed spec bytes even in the same phase');

  let invalidReviewCalls = 0;
  const invalidReview = await reviewLifecycle(async () => { invalidReviewCalls++; return { content: 'SYNTHETIC malformed' }; }, { ...initialSpec, _request: originalRequest, _reviewFeedback: [reviewA, 42] });
  const invalidReviewError = await failureOf(reviseSpec(invalidReview, reviewB));
  assert(invalidReviewError?.code === 'SPEC_REVIEW_HISTORY_INVALID' && invalidReviewCalls === 0, 'invalid stored review history fails closed before a model call');
  const wrongReviewPhase = newLifecycle(async () => { invalidReviewCalls++; return { content: JSON.stringify(reviewAnalysis) }; }, { ...initialSpec, _request: originalRequest });
  const wrongReviewBytes = lifecycleRepo.findById.get(wrongReviewPhase.id).spec;
  const wrongReviewError = await failureOf(reviseSpec(wrongReviewPhase, reviewA));
  assert(wrongReviewError?.code === 'SPEC_DRAFT_STALE' && invalidReviewCalls === 0 && lifecycleRepo.findById.get(wrongReviewPhase.id).spec === wrongReviewBytes, 'review admission CAS requires exact SPEC_REVIEW phase before any model call');

}

// ─── Concise complete SPEC (real repository, inert D1) ──────────────────────
console.log('\n── Concise complete SPEC ──');
{
  const request = 'Kuchařka: Python REST API, FastAPI, SQLAlchemy 2.0, SQLite FTS5, Alembic. Zachovat CRUD, ingredience (množství > 0), kroky, kategorie, obtížnost a vyhledávání.';
  const review = 'Přidej řazení: prep_time_asc, difficulty_desc, created_at_desc; neplatný sort vrací HTTP 422. Zachovej vše ostatní.';
  const answer = 'Nutriční údaje jsou volitelné: calories_kcal (int?), protein_g (float?), carbs_g (float?), fat_g (float?). V response jen pokud non-null. Text "řádek\\n" zůstává doslovný.';
  const requirementDescriptions = [
    'CRUD receptů, ingredience s množstvím > 0 a seřazené kroky.',
    'Filtr kategorie a obtížnosti.',
    'SQLite FTS5 vyhledává název a popis.',
    'Pydantic odmítá prázdný název a nekladné množství.',
    'Alembic spravuje relační schéma i FTS5 index.',
    'Řazení přes enum prep_time_asc, difficulty_desc, created_at_desc; výchozí created_at_desc.',
    'Volitelné calories_kcal (int?), protein_g (float?), carbs_g (float?), fat_g (float?); response obsahuje jen non-null hodnoty.',
  ];
  const acceptanceTests = [
    'POST 201; GET vrátí ingredience a kroky; PATCH změní název; DELETE odstraní recept.',
    'GET s kategorií a obtížností vrátí pouze oběma filtrům odpovídající recepty.',
    'Dotaz polévka najde shodu v názvu i popisu; aktualizace a smazání se projeví v indexu.',
    'Prázdný název nebo množství <= 0 vrátí HTTP 422 bez zápisu.',
    'alembic upgrade head uspěje na čisté i předchozí DB a zachová recepty i FTS5.',
    'Každý sort enum seřadí připravenou trojici; bez sort platí created_at_desc; neplatný sort vrátí HTTP 422.',
    'Recept bez nutrition projde; non-null hodnoty roundtrip přes CRUD; null hodnoty jsou v response vynechány.',
  ];
  const complete = {
    title: 'Kuchařka',
    goals: [
      { id: 'G1', description: 'Správa receptů.', priority: 'MUST', success_criteria: 'CRUD i chyby R1/R4/R7 projdou integračními testy.' },
      { id: 'G2', description: 'Vyhledání a řazení.', priority: 'MUST', success_criteria: 'R2/R3/R6 vrátí přesnou očekávanou množinu a pořadí.' },
      { id: 'G3', description: 'Trvalá lokální data.', priority: 'MUST', success_criteria: 'Migrace R5 zachová všechny canary recepty.' },
    ],
    requirements: {
      functional: requirementDescriptions.map((description, index) => ({ id: `R${index + 1}`, description, goal_id: index === 4 ? 'G3' : [1, 2, 5].includes(index) ? 'G2' : 'G1', acceptance_test: acceptanceTests[index] })),
      non_functional: [
        { id: 'NF1', category: 'performance', description: 'Lokální odezva.', metric: 'p95 <= 300 ms při 1000 receptech.' },
        { id: 'NF2', category: 'security', description: 'Parametrizované SQL a whitelist sort.', metric: 'Injekční vstupy neprovedou žádný další SQL příkaz.' },
        { id: 'NF3', category: 'usability', description: 'Interaktivní API dokumentace.', metric: '/docs obsahuje všechny endpointy a sort enum.' },
      ],
    },
    tech_stack: { languages: ['Python 3.11'], frameworks: ['FastAPI 0.109', 'SQLAlchemy 2.0', 'Pydantic 2'], tools: ['SQLite 3 s FTS5', 'aiosqlite 0.19', 'Alembic 1.13', 'pytest 8'], rationale: 'Typovaná validace, async I/O a lokální relační DB.' },
    architecture: { pattern: 'Vrstvené API', components: [
      { name: 'API', responsibility: 'Validace vstupu a serializace.', interfaces: ['HTTP CRUD, search, list'] },
      { name: 'Repository', responsibility: 'Transakce, FTS5 a sort.', interfaces: ['Async SQLAlchemy session'] },
    ], data_flow: 'HTTP → Pydantic → repository → SQLite; výsledek → Pydantic → HTTP.', data_model: 'recipes(id,title,description,prep_time_min,difficulty,category,created_at,calories_kcal int NULL,protein_g float NULL,carbs_g float NULL,fat_g float NULL); ingredients(recipe_id,name,quantity>0,unit); steps(recipe_id,position,text); FTS5(title,description).' },
    design_decisions: [
      { id: 'DD1', decision: 'Fulltext.', chosen: 'FTS5 s transakčními triggery.', alternatives_considered: ['LIKE: bez relevance.', 'Elasticsearch: externí služba.'], rationale: 'Lokální index konzistentní s CRUD.' },
      { id: 'DD2', decision: 'Řazení.', chosen: 'Enum → statický SQLAlchemy order_by.', alternatives_considered: ['Raw SQL: injekce.', 'Jediné pořadí: nesplní R6.'], rationale: 'Přesná rozhraní a žádná SQL injekce.' },
      { id: 'DD3', decision: 'Nutrition.', chosen: 'Nullable sloupce, ruční zadání.', alternatives_considered: ['Povinná pole: nesplní R7.', 'Externí výpočet: vyžaduje další data.'], rationale: 'Volitelnost bez nových služeb.' },
    ],
    security_model: { threat_model: 'SQL injekce a nevalidní vstupy.', mitigations: ['Parametrizované dotazy.', 'Pydantic a sort whitelist.', 'SQLite soubor pouze pro vlastníka.'], sensitive_data: ['Lokální obsah receptů.'] },
    risks: [
      { id: 'RISK1', description: 'Zámek SQLite.', severity: 'MEDIUM', likelihood: 'MEDIUM', mitigation: 'Krátké transakce a WAL.', contingency: 'HTTP 503 bez částečného zápisu.' },
      { id: 'RISK2', description: 'Rozchod FTS5 indexu.', severity: 'HIGH', likelihood: 'LOW', mitigation: 'Transakční triggery a test R3.', contingency: 'Offline rebuild indexu.' },
      { id: 'RISK3', description: 'N+1 dotazy.', severity: 'MEDIUM', likelihood: 'MEDIUM', mitigation: 'selectinload.', contingency: 'Profilovat dotazy a přidat index.' },
    ],
    constraints: ['SQLite bez externí DB serveru.', 'Zachovat API a data při migraci.'],
    out_of_scope: ['Autentizace.', 'Obrázky.', 'Externí nutriční databáze.'],
    acceptance_criteria: ['Všechny testy R1–R7 a NF1–NF3 projdou.', 'uvicorn main:app spustí API a /docs.', 'Alembic upgrade head zachová canary recepty.'],
  };
  const assessment = { estimated_complexity: 'MEDIUM', agreed: true, omittedValue: null, measurable: 300, technical_decisions: complete.design_decisions, implicit_assumptions: ['Žádná síť.', 'Řetězec "\\n" neměnit.'] };
  const structuredAnswers = { text: answer, nullable: null, flags: [false, true], quantity: 1.25 };
  const structuredPrompt = specDocument(request, structuredAnswers, assessment);
  const between = (text, start, end) => text.split(start)[1].split(end)[0];
  const encodedAnswers = between(structuredPrompt, '## Clarification Answers\n', '\n\n## Initial Assessment');
  const encodedAssessment = between(structuredPrompt, '## Initial Assessment (including technical decisions)\n', '\n\n## Task');
  assert(encodedAnswers === JSON.stringify(structuredAnswers) && encodedAssessment === JSON.stringify(assessment), 'SPEC inputs use compact JSON without changing any structured answer or assessment value');
  assert(JSON.stringify(JSON.parse(encodedAnswers)) === JSON.stringify(structuredAnswers) && JSON.stringify(JSON.parse(encodedAssessment)) === JSON.stringify(assessment), 'SPEC compact input serialization preserves Unicode, escapes, null, booleans, arrays and numbers');
  assert(between(structuredPrompt, '## Original Request\n', '\n\n## Clarification Answers') === request && specDocument(request, answer, assessment).includes(`## Clarification Answers\n${answer}\n\n`), 'SPEC keeps original request and plain clarification bytes exact');
  const schemaText = between(structuredPrompt, '```json\n', '\n```');
  const shape = value => Array.isArray(value) ? [shape(value[0])] : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, shape(entry)])) : typeof value;
  assert(JSON.stringify(shape(JSON.parse(schemaText))) === JSON.stringify(shape(complete)), 'SPEC compact schema retains every public field and nested type including risk contingency and string alternatives');
  assert(!schemaText.includes('\n'), 'SPEC schema example models one complete compact JSON object');
  assert(structuredPrompt.includes('Return one complete JSON object on one line') && structuredPrompt.includes('Never drop a requirement to shorten the document.') && structuredPrompt.includes('not just an ID or "as above"'), 'SPEC concise output instructions preserve complete requirements and concrete acceptance outcomes');
  assert(['minimum 3 distinct goals', 'minimum 5', 'non-functional requirements: minimum 3', 'at least 2 alternatives_considered', 'risks: minimum 3', 'SAME LANGUAGE'].every(rule => structuredPrompt.includes(rule)), 'SPEC concise prompt keeps all existing count, alternatives and language requirements');
  assert(validateSpec(complete).valid, 'complete concise specification passes the unchanged production validator');

  const makeLifecycle = (id, callLLM) => {
    const lifecycle = new ProjectLifecycle({ id: `lc-compact-${Date.now()}-${id}`, projectId: testProjectId, projectPath: '/tmp/test', callLLM });
    lifecycle.save();
    lifecycleRepo.updateSpec.run(JSON.stringify({ _phase: 'REVISING', _request: request, _assessment: assessment, _questions: ['Nullable?'], _technicalDecisions: assessment.technical_decisions, _implicitAssumptions: assessment.implicit_assumptions, _learnedPatternConformance: [{ item_id: 'approved-pattern', item_version: 3, key: 'local.db', status: 'conformed', explanation: 'SQLite bez sítě.' }], _previousSpec: complete, _reviewFeedback: [review] }), lifecycle.id);
    return lifecycle;
  };
  const calls = [];
  const lifecycle = makeLifecycle('valid', async (...args) => { calls.push(args); return { content: JSON.stringify(complete), finishReason: 'stop' }; });
  const generated = await answerSpecQuestions(lifecycle, answer);
  const stored = lifecycleRepo.getSpec(lifecycle.id);
  assert(calls.length === 1 && calls[0][0] === 'D1' && calls[0][2] === '' && JSON.stringify(calls[0][3]) === JSON.stringify({ format: 'json' }), 'concise SPEC uses exactly one original D1 JSON call with no budget, context, temperature or retry override');
  assert(calls[0][1].includes(`${request}\n\nUser feedback on spec: ${review}\n\nPrevious spec: ${JSON.stringify(complete)}`) && calls[0][1].includes(answer) && JSON.stringify(JSON.parse(between(calls[0][1], '## Initial Assessment (including technical decisions)\n', '\n\n## Task'))) === JSON.stringify(assessment), 'actual SPEC consumer sends the complete previous spec, original request, review, clarification and technical assessment');
  assert(!generated.needsMore && JSON.stringify(generated.spec) === JSON.stringify(complete) && requirementDescriptions.every((text, i) => stored.requirements.functional[i].description === text && stored.requirements.functional[i].acceptance_test === acceptanceTests[i]), 'actual SPEC repository preserves every concise requirement and its full acceptance outcome');
  assert(stored._request === request && stored._learnedPatternConformance[0].item_id === 'approved-pattern' && stored._learnedPatternConformance[0].item_version === 3, 'concise public output preserves original request and approved-pattern provenance');
  assert(lifecycleRepo.findById.get(lifecycle.id).phase === ProjectPhase.SPEC && msRepo.findByLifecycle.all(lifecycle.id).length === 0 && roadmapVersions.findByLifecycle.all(lifecycle.id).length === 0, 'generating complete concise SPEC does not approve it, create a roadmap or start build');

  const malformed = makeLifecycle('malformed', async () => ({ content: '{"title":"unfinished', finishReason: 'length' }));
  let malformedError;
  try { await answerSpecQuestions(malformed, answer); } catch (error) { malformedError = error; }
  const afterMalformed = lifecycleRepo.getSpec(malformed.id);
  assert(malformedError?.message === 'D1 failed to produce structured spec document' && afterMalformed._previousSpec.title === complete.title && afterMalformed._reviewFeedback[0] === review && afterMalformed._clarificationAnswers[0] === answer && lifecycleRepo.findById.get(malformed.id).phase === ProjectPhase.SPEC, 'truncated JSON remains an error with complete pending revision and prior spec preserved in private DB');
  const invalid = makeLifecycle('invalid', async () => ({ content: JSON.stringify({ ...complete, goals: complete.goals.map(({ success_criteria, ...goal }) => goal) }), finishReason: 'stop' }));
  const invalidResult = await answerSpecQuestions(invalid, answer);
  const invalidStored = lifecycleRepo.getSpec(invalid.id);
  assert(invalidResult.needsMore && invalidResult.validationErrors.some(error => error.includes('success_criteria')) && invalidStored._phase === 'VALIDATION_FAILED' && invalidStored._reviewFeedback[0] === review && invalidStored._clarificationAnswers[0] === answer, 'short output cannot omit required success criteria: validation fails and pending feedback survives');
  assert(lifecycleRepo.findById.get(invalid.id).phase === ProjectPhase.SPEC && msRepo.findByLifecycle.all(invalid.id).length === 0 && msRepo.findByLifecycle.all(malformed.id).length === 0 && [invalid.id, malformed.id].every(id => roadmapVersions.findByLifecycle.all(id).length === 0), 'invalid and truncated concise SPEC cause no automatic phase advance or milestones');
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
