// Lifecycle Blocked Milestone Tests — Dependency Skip + ALL_BLOCKED
// ══════════════════════════════════════════════════════════════════════════════
// Tests the ms-4 infinite loop fix:
//   - startNextMilestone() skips dependency-blocked milestones
//   - Returns ALL_BLOCKED when all pending milestones are blocked
//   - SKIPPED milestones satisfy dependencies
//   - handleMilestoneBlocked retry/skip work correctly
//
// Deterministic — no LLM calls.
// Run: node tests/lifecycle-blocked-milestone.test.js
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import {
  checkDependencies,
  validateRoadmap,
} from '../src/planner/lifecycle-planning.js';
import {
  startNextMilestone,
  handleMilestoneBlocked,
  getBuildProgress,
} from '../src/planner/lifecycle-build.js';
import {
  MilestoneStatus,
  CheckpointMode,
  ProjectLifecycle,
} from '../src/planner/lifecycle.js';
import { milestoneCheckpoint as checkpointPrompt } from '../src/planner/lifecycle-prompts.js';
import {
  lifecycles as lifecycleRepo,
  milestones as msRepo,
  roadmapVersions,
  projects,
  db,
} from '../src/db/database.js';

// ─── Test lifecycle factory ─────────────────────────────────────────────────

const TEST_PROJECT_PATH = '/tmp/c3-test-blocked-' + Date.now();

function createTestLifecycle() {
  const proj = projects.getOrCreate('BlockedTest', TEST_PROJECT_PATH, 'Test project');
  const projectId = Number(proj.id);

  const lifecycle = db.transaction(() => {
    const lcId = `lc-blocked-${Date.now()}`;
    lifecycleRepo.create.run(
      lcId, projectId,
      'SPEC', JSON.stringify({}), JSON.stringify({
        reviewFrequency: 3,
        maxMilestoneLOC: 2000,
        maxMilestoneFiles: 10,
        maxMilestoneRetries: 3,
        autoCommit: false,
      })
    );
    lifecycleRepo.updatePhase.run('BUILD', lcId);

    return {
      id: lcId,
      projectId,
      projectPath: TEST_PROJECT_PATH,
      config: {
        reviewFrequency: 3,
        maxMilestoneLOC: 2000,
        maxMilestoneFiles: 10,
        maxMilestoneRetries: 3,
        autoCommit: false,
      },
      callLLM: null,
      executor: null,
      incrementCompleted: () => {},
      isReviewDue: () => false,
      git: { git: async () => ({ success: false }), commitMilestone: async () => ({}), tagMilestone: async () => ({}) },
    };
  })();

  return lifecycle;
}

function addMilestone(lifecycleId, id, seq, status, deps = []) {
  msRepo.addMilestone({
    id,
    lifecycle_id: lifecycleId,
    roadmap_version: 1,
    sequence: seq,
    title: `Milestone ${seq}`,
    description: `Test milestone ${seq}`,
    status,
    dependencies: deps,
    estimated_loc: 100,
    estimated_files: 2,
    estimated_complexity: 'LOW',
    test_strategy: null,
    max_retries: 3,
  });
  // addMilestone always sets status PENDING — update if different
  if (status !== 'PENDING') {
    msRepo.updateStatus.run(status, id);
  }
}

function cleanTestData(lifecycleId) {
  try {
    db.prepare('DELETE FROM milestones WHERE lifecycle_id = ?').run(lifecycleId);
    db.prepare('DELETE FROM project_lifecycles WHERE id = ?').run(lifecycleId);
  } catch { /* ignore */ }
}

// ══════════════════════════════════════════════════════════════════════════════
// Test Suite: checkDependencies
// ══════════════════════════════════════════════════════════════════════════════

suite('checkDependencies — PASSED + SKIPPED satisfy deps');

{
  const lc = createTestLifecycle();

  // ms-1: PASSED, ms-2: SKIPPED, ms-3: depends on [ms-1, ms-2]
  const ms1Id = `ms-1@bk${Date.now()}`;
  const ms2Id = `ms-2@bk${Date.now()}`;
  const ms3Id = `ms-3@bk${Date.now()}`;

  addMilestone(lc.id, ms1Id, 1, 'PASSED', []);
  addMilestone(lc.id, ms2Id, 2, 'SKIPPED', []);
  addMilestone(lc.id, ms3Id, 3, 'PENDING', [ms1Id, ms2Id]);

  test('T1: PASSED dependency satisfies', () => {
    const result = checkDependencies(ms3Id, lc.id);
    assert(result.ready, 'ms-3 should be ready — ms-1 PASSED, ms-2 SKIPPED');
    assertEqual(result.blockedBy.length, 0, 'No blocked deps');
  });

  // Now change ms-2 to BLOCKED — ms-3 should be blocked
  msRepo.updateStatus.run('BLOCKED', ms2Id);

  test('T2: BLOCKED dependency blocks', () => {
    const result = checkDependencies(ms3Id, lc.id);
    assert(!result.ready, 'ms-3 should NOT be ready — ms-2 BLOCKED');
    assertEqual(result.blockedBy.length, 1);
    assertEqual(result.blockedBy[0], ms2Id);
  });

  // Cleanup
  cleanTestData(lc.id);
}

// ══════════════════════════════════════════════════════════════════════════════
// Test Suite: startNextMilestone — skip blocked deps
// ══════════════════════════════════════════════════════════════════════════════

suite('startNextMilestone — skip dependency-blocked, find independent');

{
  const lc = createTestLifecycle();
  const suffix = Date.now();
  const ms1Id = `ms-1@sk${suffix}`;
  const ms2Id = `ms-2@sk${suffix}`;
  const ms3Id = `ms-3@sk${suffix}`;
  const ms4Id = `ms-4@sk${suffix}`;

  // ms-1: PASSED, ms-2: BLOCKED, ms-3: depends on ms-2 (blocked), ms-4: no deps (independent)
  addMilestone(lc.id, ms1Id, 1, 'PASSED', []);
  addMilestone(lc.id, ms2Id, 2, 'BLOCKED', []);
  addMilestone(lc.id, ms3Id, 3, 'PENDING', [ms2Id]);
  addMilestone(lc.id, ms4Id, 4, 'PENDING', [ms1Id]);

  // Inject a fake LLM that returns a valid plan (D1)
  let milestonePlanPromptSeen = null;
  lc.callLLM = async (role, prompt) => {
    milestonePlanPromptSeen = prompt;
    return {
      content: JSON.stringify({
        implementation_steps: [
          { step: 1, action: 'Create initial config file' },
          { step: 2, action: 'Implement core module' },
          { step: 3, action: 'Add unit tests' },
        ],
        files: [
          { path: 'src/index.js', action: 'create', purpose: 'Entry point' },
        ],
        scope_files: ['src/index.js'],
      }),
    };
  };

  await testAsync('T3: startNextMilestone skips ms-3 (dep-blocked), returns ms-4', async () => {
    const result = await startNextMilestone(lc);
    assert(result !== null, 'Should find a milestone');
    assertEqual(result.milestoneId, ms4Id, `Expected ms-4 (${ms4Id}), got ${result.milestoneId}`);
    assertEqual(result.status, MilestoneStatus.AWAITING_PLAN);
    assert(result.localPlan !== null, 'Should have a local plan');
    assert(milestonePlanPromptSeen.includes('"id": "ms-4"'), 'D1 prompt should use raw current milestone ID');
    assert(milestonePlanPromptSeen.includes('- ms-1: Milestone 1 (PASSED)'), 'D1 prompt should use raw completed milestone ID');
    assert(!milestonePlanPromptSeen.includes(ms4Id), 'D1 prompt must not expose scoped current milestone ID');
    assert(!milestonePlanPromptSeen.includes(ms1Id), 'D1 prompt must not expose scoped completed milestone ID');
    const currentMilestoneJson = milestonePlanPromptSeen
      .split('## Current Milestone\n')[1]
      .split('\n\n## Task')[0];
    const currentMilestone = JSON.parse(currentMilestoneJson);
    assertEqual(JSON.stringify(currentMilestone.dependencies), JSON.stringify(['ms-1']),
      'D1 prompt dependencies should use raw milestone IDs');
    const persistedMilestone = msRepo.getMilestone(ms4Id);
    assert(persistedMilestone !== null, 'DB milestone must retain its scoped ID');
    assertEqual(JSON.stringify(persistedMilestone.dependencies), JSON.stringify([ms1Id]),
      'DB milestone dependencies must remain scoped');
  });

  // Mark ms-4 as PASSED and try again — only ms-3 left (blocked by ms-2)
  msRepo.updateStatus.run('PASSED', ms4Id);

  await testAsync('T4: ALL_BLOCKED when only dep-blocked milestones remain', async () => {
    const result = await startNextMilestone(lc);
    assert(result !== null, 'Should return ALL_BLOCKED, not null');
    assertEqual(result.status, 'ALL_BLOCKED', `Expected ALL_BLOCKED, got ${result.status}`);
    assert(result.milestoneId === null, 'milestoneId should be null');
    assert(result.blockedMilestones.length === 1, `Expected 1 blocked, got ${result.blockedMilestones.length}`);
    assertEqual(result.blockedMilestones[0].milestoneId, ms3Id);
  });

  cleanTestData(lc.id);
}

// ══════════════════════════════════════════════════════════════════════════════
// Test Suite: handleMilestoneBlocked — retry + skip
// ══════════════════════════════════════════════════════════════════════════════

suite('handleMilestoneBlocked — retry / skip');

{
  const lc = createTestLifecycle();
  const suffix = Date.now();
  const ms1Id = `ms-1@hb${suffix}`;
  const ms2Id = `ms-2@hb${suffix}`;

  addMilestone(lc.id, ms1Id, 1, 'BLOCKED', []);
  addMilestone(lc.id, ms2Id, 2, 'PENDING', [ms1Id]);

  await testAsync('T5: retry resets BLOCKED → PENDING', async () => {
    const result = await handleMilestoneBlocked(lc, ms1Id, 'retry');
    assertEqual(result.status, 'WILL_RETRY');
    const ms = msRepo.getMilestone(ms1Id);
    assertEqual(ms.status, 'PENDING', 'Status should be PENDING after retry');
  });

  // Re-block it for skip test
  msRepo.updateStatus.run('BLOCKED', ms1Id);

  await testAsync('T6: skip with dependent → CANNOT_SKIP', async () => {
    const result = await handleMilestoneBlocked(lc, ms1Id, 'skip');
    assertEqual(result.status, 'CANNOT_SKIP', 'Should not be able to skip — ms-2 depends on it');
  });

  // Remove dependency from ms-2 so ms-1 can be skipped
  db.prepare(`UPDATE milestones SET dependencies = '[]' WHERE id = ?`).run(ms2Id);

  await testAsync('T7: skip without dependent → SKIPPED', async () => {
    const result = await handleMilestoneBlocked(lc, ms1Id, 'skip');
    assertEqual(result.status, 'SKIPPED');
    const ms = msRepo.getMilestone(ms1Id);
    assertEqual(ms.status, 'SKIPPED', 'Status should be SKIPPED');
  });

  // Now ms-2 depends on SKIPPED ms-1 — should be able to proceed
  db.prepare(`UPDATE milestones SET dependencies = ? WHERE id = ?`).run(JSON.stringify([ms1Id]), ms2Id);

  test('T8: SKIPPED dependency satisfies — ms-2 is ready', () => {
    const result = checkDependencies(ms2Id, lc.id);
    assert(result.ready, 'ms-2 should be ready — ms-1 SKIPPED satisfies dependency');
  });

  cleanTestData(lc.id);
}

// ══════════════════════════════════════════════════════════════════════════════
// Test Suite: null case — no pending milestones
// ══════════════════════════════════════════════════════════════════════════════

suite('startNextMilestone — no pending milestones → null');

{
  const lc = createTestLifecycle();
  const suffix = Date.now();
  addMilestone(lc.id, `ms-1@np${suffix}`, 1, 'PASSED', []);

  await testAsync('T9: no pending → returns null', async () => {
    const result = await startNextMilestone(lc);
    assert(result === null, `Expected null, got ${JSON.stringify(result)}`);
  });

  cleanTestData(lc.id);
}

// ══════════════════════════════════════════════════════════════════════════════
// Test Suite: validateRoadmap — quality gates
// ══════════════════════════════════════════════════════════════════════════════

suite('validateRoadmap — quality gates');

{
  const spec = {
    requirements: {
      functional: [
        { id: 'FR-1', description: 'Auth' },
        { id: 'FR-2', description: 'API' },
        { id: 'FR-3', description: 'Storage' },
        { id: 'FR-4', description: 'CLI' },
        { id: 'FR-5', description: 'Encryption' },
      ],
    },
  };

  test('T10: too few milestones → invalid', () => {
    const roadmap = {
      milestones: [
        { id: 'ms-1', title: 'Setup', description: 'Init', deliverables: ['pkg.json'], acceptance_criteria: ['works'], test_strategy: { type: 'unit' } },
        { id: 'ms-2', title: 'Testing', description: 'Final tests', deliverables: ['tests'], acceptance_criteria: ['pass'], test_strategy: { type: 'e2e' } },
      ],
      requirements_coverage: { covered: ['FR-1', 'FR-2', 'FR-3', 'FR-4', 'FR-5'], uncovered: [] },
    };
    const result = validateRoadmap(roadmap, spec);
    assert(!result.valid, 'Should be invalid — 2 milestones < min 4 (≥5 FRs)');
    assert(result.errors.some(e => e.includes('≥4')), `Should mention minimum: ${result.errors}`);
  });

  test('T11: missing acceptance_criteria → invalid', () => {
    const roadmap = {
      milestones: [
        { id: 'ms-1', title: 'A', description: 'D', deliverables: ['f'], test_strategy: { type: 'unit' } },
        { id: 'ms-2', title: 'B', description: 'D', deliverables: ['f'], acceptance_criteria: ['ok'], test_strategy: { type: 'unit' } },
        { id: 'ms-3', title: 'C', description: 'D', deliverables: ['f'], acceptance_criteria: ['ok'], test_strategy: { type: 'unit' } },
        { id: 'ms-4', title: 'Integration testing', description: 'Test all', deliverables: ['tests'], acceptance_criteria: ['pass'], test_strategy: { type: 'e2e' } },
      ],
      requirements_coverage: { covered: ['FR-1', 'FR-2', 'FR-3', 'FR-4', 'FR-5'], uncovered: [] },
    };
    const result = validateRoadmap(roadmap, spec);
    assert(!result.valid, 'Should be invalid — ms-1 missing acceptance_criteria');
  });

  test('T12: last milestone not integration → warning', () => {
    const roadmap = {
      milestones: [
        { id: 'ms-1', title: 'Setup', description: 'Init', deliverables: ['f'], acceptance_criteria: ['ok'], test_strategy: { type: 'unit' } },
        { id: 'ms-2', title: 'API', description: 'REST', deliverables: ['f'], acceptance_criteria: ['ok'], test_strategy: { type: 'unit' } },
        { id: 'ms-3', title: 'Storage', description: 'DB', deliverables: ['f'], acceptance_criteria: ['ok'], test_strategy: { type: 'unit' } },
        { id: 'ms-4', title: 'Encryption', description: 'Crypto core', deliverables: ['f'], acceptance_criteria: ['ok'], test_strategy: { type: 'unit' } },
      ],
      requirements_coverage: { covered: ['FR-1', 'FR-2', 'FR-3', 'FR-4', 'FR-5'], uncovered: [] },
    };
    const result = validateRoadmap(roadmap, spec);
    assert(!result.valid, 'Should be invalid — last milestone not integration/testing');
    assert(result.errors.some(e => e.includes('integration') || e.includes('testing')));
  });

  test('T13: valid roadmap passes', () => {
    const roadmap = {
      milestones: [
        { id: 'ms-1', title: 'Setup', description: 'Init project', deliverables: ['package.json'], acceptance_criteria: ['project runs'], test_strategy: { type: 'unit', specific_tests: ['init test'] } },
        { id: 'ms-2', title: 'Core API', description: 'REST endpoints', deliverables: ['routes.js'], acceptance_criteria: ['endpoints respond'], test_strategy: { type: 'integration', specific_tests: ['API test'] }, requirements_addressed: ['FR-1', 'FR-2'] },
        { id: 'ms-3', title: 'Storage + Crypto', description: 'Database + encryption', deliverables: ['storage.js', 'crypto.js'], acceptance_criteria: ['data persists', 'encryption works'], test_strategy: { type: 'unit', specific_tests: ['crypto test'] }, requirements_addressed: ['FR-3', 'FR-5'] },
        { id: 'ms-4', title: 'CLI + Integration Testing', description: 'CLI tool and full integration tests', deliverables: ['cli.js', 'tests/'], acceptance_criteria: ['CLI works', 'all tests pass'], test_strategy: { type: 'e2e', specific_tests: ['e2e test'] }, requirements_addressed: ['FR-4'] },
      ],
      requirements_coverage: { covered: ['FR-1', 'FR-2', 'FR-3', 'FR-4', 'FR-5'], uncovered: [] },
    };
    const result = validateRoadmap(roadmap, spec);
    assert(result.valid, `Should be valid, got errors: ${result.errors.join(', ')}`);
  });

  test('T14: duplicate FR IDs → invalid', () => {
    const dupSpec = {
      requirements: {
        functional: [
          { id: 'FR-1', description: 'Auth' },
          { id: 'FR-1', description: 'Auth copy' },
          { id: 'FR-2', description: 'API' },
        ],
      },
    };
    const roadmap = {
      milestones: [
        { id: 'ms-1', title: 'A', description: 'D', deliverables: ['f'], acceptance_criteria: ['ok'], test_strategy: { type: 'unit' } },
        { id: 'ms-2', title: 'B', description: 'D', deliverables: ['f'], acceptance_criteria: ['ok'], test_strategy: { type: 'unit' } },
        { id: 'ms-3', title: 'Integration testing', description: 'Tests', deliverables: ['f'], acceptance_criteria: ['ok'], test_strategy: { type: 'e2e' } },
      ],
      requirements_coverage: { covered: ['FR-1', 'FR-2'], uncovered: [] },
    };
    const result = validateRoadmap(roadmap, dupSpec);
    assert(!result.valid);
    assert(result.errors.some(e => e.includes('Duplicate')));
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// Test Suite: getBuildProgress
// ══════════════════════════════════════════════════════════════════════════════

suite('getBuildProgress — status summary');

{
  const lc = createTestLifecycle();
  const suffix = Date.now();
  addMilestone(lc.id, `ms-1@bp${suffix}`, 1, 'PASSED', []);
  addMilestone(lc.id, `ms-2@bp${suffix}`, 2, 'BLOCKED', []);
  addMilestone(lc.id, `ms-3@bp${suffix}`, 3, 'PENDING', [`ms-2@bp${suffix}`]);
  addMilestone(lc.id, `ms-4@bp${suffix}`, 4, 'SKIPPED', []);

  test('T15: progress counts are correct', () => {
    const progress = getBuildProgress(lc.id);
    assertEqual(progress.total, 4);
    assertEqual(progress.completed, 1, 'Expected 1 PASSED');
    assertEqual(progress.blocked, 1, 'Expected 1 BLOCKED');
    assertEqual(progress.pending, 1, 'Expected 1 PENDING');
    assertEqual(progress.skipped, 1, 'Expected 1 SKIPPED');
    assertEqual(progress.percentage, 50, 'Expected 50% (PASSED + SKIPPED = 2/4)');
  });

  cleanTestData(lc.id);
}

// ══════════════════════════════════════════════════════════════════════════════
// Test Suite: CheckpointMode enum + prompt generation
// ══════════════════════════════════════════════════════════════════════════════

suite('CheckpointMode — enum + prompt mode awareness');

{
  test('T16: CheckpointMode enum has 3 modes', () => {
    assertEqual(CheckpointMode.STRUCTURAL, 'STRUCTURAL');
    assertEqual(CheckpointMode.FUNCTIONAL, 'FUNCTIONAL');
    assertEqual(CheckpointMode.SECURITY, 'SECURITY');
    assert(Object.isFrozen(CheckpointMode), 'CheckpointMode should be frozen');
  });

  test('T17: STRUCTURAL prompt skips security/test checks', () => {
    const prompt = checkpointPrompt(
      { title: 'Scaffolding', description: 'Initial setup' },
      'diff --stat: 3 files changed',
      ['src/index.js', 'package.json'],
      { allPassed: null, summary: 'No tests' },
      { checkpointMode: 'STRUCTURAL' }
    );
    assert(prompt.includes('STRUCTURAL'), 'Should mention STRUCTURAL mode');
    assert(prompt.includes('DO NOT fail for'), 'Should tell model not to fail for tests');
    assert(prompt.includes('Missing tests'), 'Should mention test leniency');
    assert(prompt.includes('Security concerns'), 'Should mention security leniency');
    assert(!prompt.includes('FAIL if'), 'Should NOT have strict FAIL rules');
  });

  test('T18: FUNCTIONAL prompt allows deferred tests', () => {
    const prompt = checkpointPrompt(
      { title: 'Core logic', description: 'Implementation' },
      'diff --stat: 5 files changed',
      ['src/auth.js', 'src/api.js'],
      { allPassed: null, note: 'Tests deferred' },
      { checkpointMode: 'FUNCTIONAL' }
    );
    assert(prompt.includes('FUNCTIONAL'), 'Should mention FUNCTIONAL mode');
    assert(prompt.includes('Missing tests IF test_strategy is null'), 'Should allow deferred tests');
    assert(prompt.includes('Enterprise-grade security'), 'Should defer enterprise security');
  });

  test('T19: SECURITY prompt requires full audit', () => {
    const prompt = checkpointPrompt(
      { title: 'Security hardening', description: 'Final audit' },
      'diff --stat: 8 files changed',
      ['src/crypto.js', 'src/validation.js'],
      { allPassed: true, summary: 'All tests pass' },
      { checkpointMode: 'SECURITY' }
    );
    assert(prompt.includes('SECURITY'), 'Should mention SECURITY mode');
    assert(prompt.includes('FAIL if'), 'Should have strict FAIL rules');
    assert(prompt.includes('hardcoded secrets'), 'Should check for secrets');
    assert(prompt.includes('SQL injection'), 'Should check for injection');
  });

  test('T20: default mode is FUNCTIONAL', () => {
    const prompt = checkpointPrompt(
      { title: 'Feature', description: 'Stuff' },
      'diff',
      ['file.js'],
      {}
    );
    assert(prompt.includes('FUNCTIONAL'), 'Default should be FUNCTIONAL');
  });

  test('T21: previousFindings included in prompt (adaptive retry)', () => {
    const findings = {
      fix_instructions: ['Add input validation to POST /api/store'],
      security_findings: ['Hardcoded API key in config.js'],
    };
    const prompt = checkpointPrompt(
      { title: 'Feature', description: 'Stuff' },
      'diff',
      ['file.js'],
      {},
      { checkpointMode: 'FUNCTIONAL', previousFindings: findings }
    );
    assert(prompt.includes('Previous Attempt Findings'), 'Should include previous findings');
    assert(prompt.includes('Add input validation'), 'Should include fix instructions');
    assert(prompt.includes('Hardcoded API key'), 'Should include security findings');
  });

  test('T22: fix_instructions in output schema', () => {
    const prompt = checkpointPrompt(
      { title: 'Test', description: 'D' },
      'diff',
      [],
      {},
      { checkpointMode: 'STRUCTURAL' }
    );
    assert(prompt.includes('fix_instructions'), 'Output schema should include fix_instructions');
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// Test Suite: checkpoint_mode in milestone DB
// ══════════════════════════════════════════════════════════════════════════════

suite('checkpoint_mode — DB storage + positional heuristic');

{
  const lc = createTestLifecycle();
  const suffix = Date.now();

  // Create milestones with explicit checkpoint modes
  msRepo.addMilestone({
    id: `ms-1@cm${suffix}`,
    lifecycle_id: lc.id,
    roadmap_version: 1,
    sequence: 1,
    title: 'Setup',
    description: 'Initial scaffolding',
    checkpoint_mode: 'STRUCTURAL',
    max_retries: 3,
  });

  msRepo.addMilestone({
    id: `ms-2@cm${suffix}`,
    lifecycle_id: lc.id,
    roadmap_version: 1,
    sequence: 2,
    title: 'Core',
    description: 'Core logic',
    checkpoint_mode: 'FUNCTIONAL',
    max_retries: 3,
  });

  msRepo.addMilestone({
    id: `ms-3@cm${suffix}`,
    lifecycle_id: lc.id,
    roadmap_version: 1,
    sequence: 3,
    title: 'Security',
    description: 'Final audit',
    checkpoint_mode: 'SECURITY',
    max_retries: 3,
  });

  test('T23: checkpoint_mode persisted to DB', () => {
    const ms1 = msRepo.getMilestone(`ms-1@cm${suffix}`);
    assertEqual(ms1.checkpoint_mode, 'STRUCTURAL', 'ms-1 should be STRUCTURAL');

    const ms2 = msRepo.getMilestone(`ms-2@cm${suffix}`);
    assertEqual(ms2.checkpoint_mode, 'FUNCTIONAL', 'ms-2 should be FUNCTIONAL');

    const ms3 = msRepo.getMilestone(`ms-3@cm${suffix}`);
    assertEqual(ms3.checkpoint_mode, 'SECURITY', 'ms-3 should be SECURITY');
  });

  test('T24: default checkpoint_mode is FUNCTIONAL', () => {
    msRepo.addMilestone({
      id: `ms-4@cm${suffix}`,
      lifecycle_id: lc.id,
      roadmap_version: 1,
      sequence: 4,
      title: 'Extra',
      description: 'No explicit mode',
      max_retries: 3,
    });
    const ms4 = msRepo.getMilestone(`ms-4@cm${suffix}`);
    assertEqual(ms4.checkpoint_mode, 'FUNCTIONAL', 'Default should be FUNCTIONAL');
  });

  cleanTestData(lc.id);
}

// ══════════════════════════════════════════════════════════════════════════════

summary();
