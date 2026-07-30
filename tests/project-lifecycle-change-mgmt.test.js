// Project Lifecycle E2E Test 3 — Change Management during BUILD
// ══════════════════════════════════════════════════════════════════════════════
// Tests change management:
//   A. Propose change → reject → roadmap unchanged
//   B. Propose change → approve → roadmap rewritten, ROADMAP.md updated
//   C. Completed milestones preserved through change
//
// Deterministic (mock LLM). Verifies:
//   - Change request created in DB
//   - Rejected change doesn't modify roadmap
//   - Approved change creates new roadmap version
//   - ROADMAP.md reflects new version after change applied
//   - PASSED milestones survive roadmap rewrite
//
// Run: node tests/project-lifecycle-change-mgmt.test.js
// ══════════════════════════════════════════════════════════════════════════════

import './helpers/isolated-test-db.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

import {
  ProjectPhase,
  MilestoneStatus,
  ProjectLifecycle,
  getBuildProgress,
  validatePreservation,
  listChangeRequests,
} from '../src/planner/index.js';

import {
  lifecycles as lifecycleRepo,
  milestones as msRepo,
  roadmapVersions,
  changeRequests as crRepo,
  driftChecks,
  projects,
  lifecycleHandoffState,
  db,
} from '../src/db/database.js';

import {
  handleLifecycleBuildDetected,
  handleLifecycleInput,
} from '../src/chat/handlers/lifecycle-handoff.js';

import {
  getLcState,
  setLcState,
  clearLcState,
  initLifecycleStateDb,
} from '../src/chat/handlers/lifecycle-state.js';
import { rawId, scopeId } from '../src/planner/lifecycle-planning.js';

// ─── Assertions ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function check(condition, name, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}: ${detail}`);
    failures.push({ name, detail });
  }
}

// ─── Sample Data ────────────────────────────────────────────────────────────

const SPEC = {
  title: 'Note Taker',
  goals: [
    { id: 'G1', description: 'Create and list notes', priority: 'MUST', success_criteria: 'Notes can be added and listed with no data loss' },
    { id: 'G2', description: 'Search notes', priority: 'MUST', success_criteria: 'Keyword search returns all matching notes within 50ms' },
    { id: 'G3', description: 'Tag notes', priority: 'SHOULD', success_criteria: 'Notes can be tagged and filtered by tag' },
  ],
  requirements: [
    { id: 'R1', description: 'add note command', type: 'functional', goal_id: 'G1', acceptance_test: 'Run add "Buy milk" and verify note appears in store' },
    { id: 'R2', description: 'list notes command', type: 'functional', goal_id: 'G1', acceptance_test: 'Run list and verify all added notes are displayed' },
    { id: 'R3', description: 'search by keyword', type: 'functional', goal_id: 'G2', acceptance_test: 'Run search "milk" and verify only matching notes returned' },
    { id: 'R4', description: 'tag support', type: 'functional', goal_id: 'G3', acceptance_test: 'Add note with --tag shopping and filter by tag' },
    { id: 'R5', description: 'JSON file storage', type: 'functional', goal_id: 'G1', acceptance_test: 'Verify notes.json file exists and contains valid JSON after add' },
  ],
  tech_stack: { languages: ['JavaScript'], frameworks: ['Node.js CLI'], tools: [] },
  architecture: { pattern: 'Modular CLI', components: ['store.js', 'commands.js', 'search.js'] },
  risks: [{ id: 'RISK1', description: 'File locking', severity: 'LOW', mitigation: 'Single user' }],
  design_decisions: [
    {
      id: 'DD1',
      decision: 'Storage format',
      chosen: 'JSON file',
      alternatives_considered: ['SQLite', 'YAML file'],
      rationale: 'JSON is native to Node.js with zero dependencies for read/write',
    },
  ],
  acceptance_criteria: [
    'Notes can be added and retrieved without data loss',
    'Search returns only notes matching the keyword',
    'Tags can be assigned and used for filtering',
  ],
};

const ROADMAP = {
  milestones: [
    { id: 'ms-1', title: 'Note Storage', description: 'JSON file storage for notes',
      dependencies: [], estimated_loc: 50, estimated_files: 1, estimated_complexity: 'LOW',
      deliverables: ['store.js'],
      acceptance_criteria: ['Store source declares JSON load and save operations'],
      test_strategy: { type: 'structural', command: 'node --check store.js', specific_tests: ['Store module parses'] } },
    { id: 'ms-2', title: 'Basic Commands', description: 'Add and list notes',
      dependencies: ['ms-1'], estimated_loc: 70, estimated_files: 1, estimated_complexity: 'LOW',
      deliverables: ['commands.js'],
      acceptance_criteria: ['Command source declares add/list operations and tag persistence'],
      test_strategy: { type: 'structural', command: 'node --check commands.js', specific_tests: ['Command module parses'] } },
    { id: 'ms-3', title: 'Search & Tags Source Verification', description: 'Finalize keyword-search and tag-filter source contracts',
      dependencies: ['ms-2'], estimated_loc: 80, estimated_files: 1, estimated_complexity: 'MEDIUM',
      deliverables: ['search.js'],
      acceptance_criteria: ['Search source declares keyword and tag filters'],
      test_strategy: { type: 'structural', command: 'node --check search.js', specific_tests: ['Search module parses'] } },
  ],
  total_estimated_loc: 200,
  total_milestones: 3,
  requirements_coverage: {
    covered: ['R1', 'R2', 'R3', 'R4', 'R5'],
    uncovered: [],
  },
};

// Rewritten roadmap after change (adds ms-4)
const ROADMAP_AFTER_CHANGE = {
  milestones: [
    // ms-1 preserved (PASSED)
    { id: 'ms-1', title: 'Note Storage', description: 'JSON file storage for notes', preserved: true,
      dependencies: [], estimated_loc: 50, estimated_files: 1, estimated_complexity: 'LOW',
      deliverables: ['store.js'],
      acceptance_criteria: ['Store source declares JSON load and save operations'],
      test_strategy: { type: 'structural', command: 'node --check store.js', specific_tests: ['Store module parses'] } },
    // ms-2 modified
    { id: 'ms-2', title: 'Basic Commands + Export', description: 'Add, list, export notes',
      dependencies: ['ms-1'], estimated_loc: 90, estimated_files: 1, estimated_complexity: 'MEDIUM',
      deliverables: ['commands.js'],
      acceptance_criteria: ['Command source retains add/list/tag operations and declares Markdown export'],
      test_strategy: { type: 'structural', command: 'node --check commands.js', specific_tests: ['Command module parses'] } },
    // ms-3 unchanged
    { id: 'ms-3', title: 'Search & Tags Source Verification', description: 'Finalize keyword-search and tag-filter source contracts',
      dependencies: ['ms-2'], estimated_loc: 80, estimated_files: 1, estimated_complexity: 'MEDIUM',
      deliverables: ['search.js'],
      acceptance_criteria: ['Search source declares keyword and tag filters'],
      test_strategy: { type: 'structural', command: 'node --check search.js', specific_tests: ['Search module parses'] } },
  ],
  total_estimated_loc: 220,
  total_milestones: 3,
  requirements_coverage: {
    covered: ['R1', 'R2', 'R3', 'R4', 'R5'],
    uncovered: [],
  },
  changes_summary: 'Added export functionality to ms-2',
  diff: { added: [], removed: [], modified: ['ms-2'], preserved: ['ms-1', 'ms-3'] },
};

const MS_PLANS = {
  'ms-1': { milestone_id: 'ms-1', files: [{ path: 'store.js', action: 'create' }],
    implementation_steps: [
      { step: 1, action: 'Create store.js' },
      { step: 2, action: 'Implement JSON note loading' },
      { step: 3, action: 'Implement JSON note saving' },
    ], scope_files: ['store.js'] },
  'ms-2': { milestone_id: 'ms-2', files: [{ path: 'commands.js', action: 'create' }],
    implementation_steps: [
      { step: 1, action: 'Create commands.js' },
      { step: 2, action: 'Implement add command with tag persistence' },
      { step: 3, action: 'Implement list command' },
    ], scope_files: ['commands.js'] },
  'ms-3': { milestone_id: 'ms-3', files: [{ path: 'search.js', action: 'create' }],
    implementation_steps: [
      { step: 1, action: 'Create search.js' },
      { step: 2, action: 'Import shared store loader' },
      { step: 3, action: 'Implement keyword and tag filtering' },
    ], scope_files: ['search.js'] },
};

const MS_PLANS_AFTER_CHANGE = {
  ...MS_PLANS,
  'ms-2': {
    milestone_id: 'ms-2',
    files: [{ path: 'commands.js', action: 'create' }],
    implementation_steps: [
      { step: 1, action: 'Retain add and list command interfaces' },
      { step: 2, action: 'Retain tag persistence in added notes' },
      { step: 3, action: 'Add Markdown export source contract' },
    ],
    scope_files: ['commands.js'],
  },
};

const FILES = {
  'ms-1': { 'store.js': 'import fs from "fs";\nexport const load = () => JSON.parse(fs.readFileSync("notes.json","utf8"));\nexport const save = (d) => fs.writeFileSync("notes.json",JSON.stringify(d,null,2));\n' },
  'ms-2': { 'commands.js': 'import {load,save} from "./store.js";\nexport function add(text, tags = []) { const d = load(); d.push({text,tags,ts:Date.now()}); save(d); }\nexport function list() { return load(); }\n' },
  'ms-3': { 'search.js': 'import {load} from "./store.js";\nexport function search(q) { return load().filter(n=>n.text.includes(q)); }\nexport function filterByTag(tag) { return load().filter(n => n.tags?.includes(tag)); }\n' },
};

const FILES_AFTER_CHANGE = {
  'ms-2': {
    'commands.js': 'import {load,save} from "./store.js";\nexport function add(text, tags = []) { const d = load(); d.push({text,tags,ts:Date.now()}); save(d); }\nexport function list() { return load(); }\nexport function exportMarkdown() { return load().map(n => `- ${n.text}`).join("\\n"); }\n',
  },
};

let roadmapChanged = false;

function createFakeLLM() {
  return async function fakeLLM(role, prompt) {
    const p = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);

    if (p.includes('clarifying questions') || p.includes('## User Request') && p.includes('## Task'))
      return { content: JSON.stringify({ core_goal: 'Note taker', clarifying_questions: ['Format?'], initial_assessment: { estimated_complexity: 'LOW' } }) };
    if (p.includes('structured project specification') || p.includes('thorough project specification') || p.includes('creating a project specification'))
      return { content: JSON.stringify(SPEC) };
    if (p.includes('creating a project roadmap') || p.includes('Break the project into milestones'))
      return { content: JSON.stringify(ROADMAP) };
    if (p.includes('implementing a specific milestone') || p.includes('implementation plan for THIS milestone')) {
      const msId = p.match(/"id"\s*:\s*"(ms-\d+)"/)?.[1];
      const plans = roadmapChanged ? MS_PLANS_AFTER_CHANGE : MS_PLANS;
      if (!msId || !plans[msId]) throw new Error(`Unknown milestone plan prompt: ${msId}`);
      return { content: JSON.stringify(plans[msId]) };
    }
    if (p.includes('reviewing a completed milestone') || p.includes('Compare the actual output'))
      return { content: JSON.stringify({ passed: true, deliverables_check: [], scope_violations: [], overall_assessment: 'OK' }) };
    if (p.includes('computing health metrics') || p.includes('health metrics'))
      return { content: JSON.stringify({ scope_adherence: 0.9, test_coverage: 0.7, complexity_delta: 0.1, tech_debt_delta: 0.1 }) };
    if (p.includes('conducting a project review') || p.includes('4 drift checks'))
      return { content: JSON.stringify({ spec_alignment: { confidence: 0.9 }, scope_creep: { severity: 'NONE' }, architecture_consistency: { consistent: true }, tech_debt: { trend: 'STABLE' }, overall_health: 'GREEN' }) };

    // CHANGE: analyze
    if (p.includes('analyzing a change request') || p.includes('impact of this change'))
      return { content: JSON.stringify({
        affected_milestones: ['ms-2'],
        impact: { milestones_to_modify: [{ id: 'ms-2', changes: 'Add export' }], effort_delta: '+20 LOC', risk_level: 'LOW' },
        feasibility: 'FEASIBLE',
        recommendation: 'Low-risk, approve',
      }) };

    // CHANGE: rewrite roadmap
    if (p.includes('rewriting a project roadmap') || p.includes('incorporate an approved change')) {
      roadmapChanged = true;
      return { content: JSON.stringify(ROADMAP_AFTER_CHANGE) };
    }

    return { content: '{}' };
  };
}

function createFakeExecutor(projectPath) {
  return {
    async start(request, context) {
      const msId = rawId(context.milestoneId);
      const files = roadmapChanged && FILES_AFTER_CHANGE[msId]
        ? FILES_AFTER_CHANGE[msId]
        : FILES[msId];
      if (!files) throw new Error(`No executor fixture for ${context.milestoneId}`);
      for (const [relPath, content] of Object.entries(files)) {
        const fp = path.join(projectPath, relPath);
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        fs.writeFileSync(fp, content);
      }
      try {
        execSync('git add -A', { cwd: projectPath, stdio: 'pipe' });
        execSync(`git commit -m "executor: ${context.milestoneId}" --allow-empty`, { cwd: projectPath, stdio: 'pipe' });
      } catch { /* ignore */ }
      return { state: 'COMPLETED', sessionId: `mock-${context.milestoneId}` };
    },
    async approve(s) { return { state: 'COMPLETED', sessionId: s }; },
  };
}

function cleanDB() {
  // Clean lifecycle data — NEVER wipe user projects/conversations
  for (const t of ['lifecycle_handoff_state', 'drift_checks', 'change_requests',
                    'milestones', 'roadmap_versions', 'project_lifecycles']) {
    try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* ignore */ }
  }
  try { db.prepare(`DELETE FROM projects WHERE path LIKE '/tmp/%'`).run(); } catch { /* ignore */ }
  initLifecycleStateDb(lifecycleHandoffState, lifecycleRepo);
}

function setupProject() {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-change-'));
  execSync('git init', { cwd: projectPath, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: projectPath, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: projectPath, stdio: 'pipe' });
  execSync('git commit --allow-empty -m "init"', { cwd: projectPath, stdio: 'pipe' });
  return projectPath;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── MAIN TEST ──────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function run() {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('  Test 3: Change Management during BUILD');
  console.log('══════════════════════════════════════════════════════════════════════');

  cleanDB();
  const projectPath = setupProject();
  const SESSION = 'change-mgmt-test';
  const ctx = { sessionId: SESSION, callLLM: createFakeLLM(), executor: createFakeExecutor(projectPath), projectPath };

  try {
    // ═══ Walk to BUILD — complete ms-1 ═══════════════════════════════════

    console.log('\n═══ Setup: Walk to BUILD, complete ms-1 ════════════════════════════');

    handleLifecycleBuildDetected('Note taker s vyhledáváním a tagy', { intent: 'BUILD' }, ctx);
    await handleLifecycleInput('ano', ctx);              // → SPEC
    await handleLifecycleInput('JSON, plaintext', ctx);   // → SPEC_REVIEW
    await handleLifecycleInput('schvaluji', ctx);         // → PLAN_REVIEW
    await handleLifecycleInput('schvaluji', ctx);         // → BUILD, ms-1 plan
    await handleLifecycleInput('ano', ctx);               // → ms-1 executes, ms-2 plan

    const state = getLcState(SESSION);
    const lifecycleId = state.lifecycleId;

    check(state?.currentMilestoneId === scopeId(lifecycleId, 'ms-2'), 'Setup: at scoped ms-2 after ms-1 PASSED',
      `got: ${state?.currentMilestoneId}`);

    const ms1 = msRepo.getMilestone(scopeId(lifecycleId, 'ms-1'));
    check(ms1?.status === 'PASSED', 'Setup: ms-1 PASSED', `got: ${ms1?.status}`);

    const rv1 = roadmapVersions.getLatestVersion(lifecycleId);
    check(rv1 === 1, 'Setup: roadmap version is 1', `got: ${rv1}`);

    // ═══ TEST A: Propose change → Reject ════════════════════════════════

    console.log('\n═══ TEST A: Propose Change → Reject ═══════════════════════════════');

    // Force to BUILD for change management routing
    setLcState(SESSION, { ...getLcState(SESSION), phase: 'BUILD' });

    const changeResp = await handleLifecycleInput('změna: přidat export poznámek do markdown', ctx);
    check(changeResp?.content != null, 'A.1: change response received');

    const stateAfterChange = getLcState(SESSION);
    check(stateAfterChange?.phase === 'CHANGE', 'A.2: state is CHANGE', `got: ${stateAfterChange?.phase}`);
    check(stateAfterChange?.changeRequestId != null, 'A.3: changeRequestId set');

    // Reject change
    const rejectResp = await handleLifecycleInput('ne', ctx);
    check(rejectResp?.content?.includes('zamítnuta') || rejectResp?.content?.includes('BUILD'),
      'A.4: rejection confirmed');

    const stateAfterReject = getLcState(SESSION);
    check(stateAfterReject?.phase === 'BUILD', 'A.5: back to BUILD after rejection',
      `got: ${stateAfterReject?.phase}`);

    // Roadmap version unchanged
    const rv2 = roadmapVersions.getLatestVersion(lifecycleId);
    check(rv2 === 1, 'A.6: roadmap still v1 after rejection', `got: ${rv2}`);

    // Change request in DB as REJECTED
    const crs1 = crRepo.findByLifecycle ? crRepo.findByLifecycle.all(lifecycleId) : [];
    check(crs1.length >= 1, 'A.7: change request exists in DB', `got: ${crs1.length}`);
    if (crs1.length > 0) {
      check(crs1[0].status === 'REJECTED', 'A.8: change request status is REJECTED',
        `got: ${crs1[0].status}`);
    }

    // ═══ TEST B: Propose change → Approve ═══════════════════════════════

    console.log('\n═══ TEST B: Propose Change → Approve ══════════════════════════════');

    // Propose another change
    setLcState(SESSION, { ...getLcState(SESSION), phase: 'BUILD' });
    const change2 = await handleLifecycleInput('změna: přidat export do markdown formátu', ctx);
    check(change2?.content != null, 'B.1: second change response received');

    const stateChange2 = getLcState(SESSION);
    check(stateChange2?.phase === 'CHANGE', 'B.2: state is CHANGE', `got: ${stateChange2?.phase}`);

    // Approve change
    const approveResp = await handleLifecycleInput('ano', ctx);
    check(approveResp?.content != null, 'B.3: approve response received');

    const stateAfterApprove = getLcState(SESSION);
    check(stateAfterApprove?.phase === 'BUILD', 'B.4: back to BUILD after approval',
      `got: ${stateAfterApprove?.phase}`);

    // Roadmap version incremented
    const rv3 = roadmapVersions.getLatestVersion(lifecycleId);
    check(rv3 === 2, 'B.5: roadmap version is 2 after change applied', `got: ${rv3}`);

    // ROADMAP.md reflects new version
    const roadmapPath = path.join(projectPath, 'ROADMAP.md');
    if (fs.existsSync(roadmapPath)) {
      const rmContent = fs.readFileSync(roadmapPath, 'utf-8');
      check(rmContent.includes('v2'), 'B.6: ROADMAP.md shows v2');
      check(rmContent.includes('Version History'), 'B.7: ROADMAP.md has version history');
    } else {
      check(false, 'B.6: ROADMAP.md exists after change applied');
    }

    // ═══ TEST C: Preservation of completed milestones ════════════════════

    console.log('\n═══ TEST C: Completed Milestones Preserved ════════════════════════');

    // ms-1 should STILL be PASSED
    const ms1After = msRepo.getMilestone(scopeId(lifecycleId, 'ms-1'));
    check(ms1After?.status === 'PASSED', 'C.1: ms-1 still PASSED after roadmap rewrite',
      `got: ${ms1After?.status}`);

    // Second change request should be APPLIED
    const crs2 = crRepo.findByLifecycle ? crRepo.findByLifecycle.all(lifecycleId) : [];
    const appliedCR = crs2.find(cr => cr.status === 'APPLIED');
    check(appliedCR != null, 'C.2: one change request is APPLIED',
      `statuses: ${crs2.map(c => c.status).join(', ')}`);

    // ms-2 should still exist (modified, not deleted)
    const ms2After = msRepo.getMilestone(scopeId(lifecycleId, 'ms-2'));
    check(ms2After != null, 'C.3: ms-2 still exists after change');

    // Progress: 1 completed out of 3
    const progress = getBuildProgress(lifecycleId);
    check(progress.completed === 1, 'C.4: 1 completed milestone after change',
      `got: ${progress.completed}`);
    check(progress.total >= 3, 'C.5: at least 3 milestones total',
      `got: ${progress.total}`);

    // DB summary
    console.log('\n  ─── DB Summary ───');
    const allMs = msRepo.listByLifecycle(lifecycleId);
    for (const m of allMs) {
      console.log(`    ${m.status === 'PASSED' ? '✅' : '⬜'} ${m.id}: ${m.title} [${m.status}]`);
    }
    const allCRs = crRepo.findByLifecycle ? crRepo.findByLifecycle.all(lifecycleId) : [];
    for (const cr of allCRs) {
      console.log(`    CR: ${cr.id} — ${cr.status}`);
    }

    // Cleanup
    try { fs.rmSync(projectPath, { recursive: true, force: true }); } catch { /* ignore */ }

  } catch (err) {
    console.error(`\n\nFATAL ERROR: ${err.message}`);
    console.error(err.stack);
    failed++;
    failures.push({ name: 'FATAL', detail: err.message });
  }

  // ═══ Summary ════════════════════════════════════════════════════════════

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log(`  Test 3 Change Management: ${passed} passed, ${failed} failed`);

  if (failures.length > 0) {
    console.log('\n  FAILURES:');
    for (const f of failures) {
      console.log(`    ❌ ${f.name}: ${f.detail}`);
    }
  }

  console.log('══════════════════════════════════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
}

run();
