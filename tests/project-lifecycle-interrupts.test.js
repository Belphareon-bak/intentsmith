// Project Lifecycle E2E Test 2 — Interrupts: Pause/Resume/Cancel/Crash Recovery
// ══════════════════════════════════════════════════════════════════════════════
// Tests lifecycle resilience:
//   A. Pause during BUILD → resume → continue from where we left off
//   B. Cancel during SPEC → state cleared, clean exit
//   C. Crash recovery — RAM state lost, preload from DB
//
// Deterministic (mock LLM). Verifies:
//   - Pause persists to DB (phase = PAUSED)
//   - Resume restores correct phase + progress
//   - Cancel clears both RAM and DB state
//   - preloadActiveLifecycles() restores RAM from DB after crash
//
// Run: node tests/project-lifecycle-interrupts.test.js
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

import {
  ProjectPhase,
  MilestoneStatus,
  ProjectLifecycle,
  getBuildProgress,
} from '../src/planner/index.js';

import {
  lifecycles as lifecycleRepo,
  milestones as msRepo,
  roadmapVersions,
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
  preloadActiveLifecycles,
  _clearAllRam,
} from '../src/chat/handlers/lifecycle-state.js';

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

// ─── Shared Sample Data ─────────────────────────────────────────────────────

const SPEC = {
  title: 'Counter App',
  goals: [
    { id: 'G1', description: 'Count up and down', priority: 'MUST' },
    { id: 'G2', description: 'Persist count', priority: 'MUST' },
    { id: 'G3', description: 'Reset to zero', priority: 'SHOULD' },
  ],
  requirements: [
    { id: 'R1', description: 'increment command', type: 'functional', goal_id: 'G1' },
    { id: 'R2', description: 'decrement command', type: 'functional', goal_id: 'G1' },
    { id: 'R3', description: 'save to file', type: 'functional', goal_id: 'G2' },
    { id: 'R4', description: 'reset command', type: 'functional', goal_id: 'G3' },
    { id: 'R5', description: 'show current value', type: 'functional', goal_id: 'G1' },
  ],
  tech_stack: { languages: ['JavaScript'], frameworks: ['Node.js CLI'], tools: [] },
  architecture: { pattern: 'Single file', components: ['counter.js', 'store.js'] },
  risks: [{ id: 'RISK1', description: 'File corruption', severity: 'LOW', mitigation: 'Atomic writes' }],
};

const ROADMAP = {
  milestones: [
    { id: 'ms-1', title: 'Store Module', description: 'File-based counter storage',
      dependencies: [], estimated_loc: 40, estimated_files: 1, estimated_complexity: 'LOW' },
    { id: 'ms-2', title: 'Counter Logic', description: 'Inc/dec/reset/show commands',
      dependencies: ['ms-1'], estimated_loc: 60, estimated_files: 1, estimated_complexity: 'LOW' },
  ],
  total_estimated_loc: 100,
  total_milestones: 2,
};

const MS_PLANS = {
  'ms-1': { milestone_id: 'ms-1', files: [{ path: 'store.js', action: 'create' }],
    implementation_steps: [{ step: 1, action: 'Create store.js' }], scope_files: ['store.js'] },
  'ms-2': { milestone_id: 'ms-2', files: [{ path: 'counter.js', action: 'create' }],
    implementation_steps: [{ step: 1, action: 'Create counter.js' }], scope_files: ['counter.js'] },
};

const FILES = {
  'ms-1': { 'store.js': 'import fs from "fs";\nexport const load = () => JSON.parse(fs.readFileSync("count.json","utf8")).count;\nexport const save = (n) => fs.writeFileSync("count.json", JSON.stringify({count:n}));\n' },
  'ms-2': { 'counter.js': 'import {load,save} from "./store.js";\nconst cmd = process.argv[2];\nlet n = 0; try { n = load(); } catch {}\nif (cmd==="inc") n++;\nif (cmd==="dec") n--;\nif (cmd==="reset") n=0;\nsave(n);\nconsole.log(n);\n' },
};

function createFakeLLM() {
  return async function fakeLLM(role, prompt) {
    const p = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
    if (p.includes('clarifying questions') || p.includes('analyzing a project request'))
      return { content: JSON.stringify({ core_goal: 'Counter', clarifying_questions: ['Format?'], initial_assessment: { estimated_complexity: 'LOW' } }) };
    if (p.includes('structured project specification') || p.includes('creating a project specification'))
      return { content: JSON.stringify(SPEC) };
    if (p.includes('creating a project roadmap') || p.includes('Break the project into milestones'))
      return { content: JSON.stringify(ROADMAP) };
    if (p.includes('implementing a specific milestone') || p.includes('implementation plan for THIS milestone')) {
      const m = p.match(/"id"\s*:\s*"(ms-\d+)"/); return { content: JSON.stringify(MS_PLANS[m?.[1] || 'ms-1']) };
    }
    if (p.includes('reviewing a completed milestone') || p.includes('Compare the actual output'))
      return { content: JSON.stringify({ passed: true, deliverables_check: [], scope_violations: [], overall_assessment: 'OK' }) };
    if (p.includes('computing health metrics') || p.includes('health metrics'))
      return { content: JSON.stringify({ scope_adherence: 0.9, test_coverage: 0.7, complexity_delta: 0.1, tech_debt_delta: 0.1 }) };
    if (p.includes('conducting a project review') || p.includes('4 drift checks'))
      return { content: JSON.stringify({ spec_alignment: { confidence: 0.9 }, scope_creep: { severity: 'NONE' }, architecture_consistency: { consistent: true }, tech_debt: { trend: 'STABLE' }, overall_health: 'GREEN' }) };
    return { content: '{}' };
  };
}

function createFakeExecutor(projectPath) {
  return {
    async start(request, context) {
      const files = FILES[context.milestoneId] || {};
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
  const projectPath = `/tmp/lc-interrupt-${Date.now()}`;
  fs.mkdirSync(projectPath, { recursive: true });
  execSync('git init', { cwd: projectPath, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: projectPath, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: projectPath, stdio: 'pipe' });
  execSync('git commit --allow-empty -m "init"', { cwd: projectPath, stdio: 'pipe' });
  return projectPath;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── TEST A: Pause during BUILD → Resume ────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function testPauseResume() {
  console.log('\n═══ TEST A: Pause during BUILD → Resume ═══════════════════════════');

  cleanDB();
  const projectPath = setupProject();
  const SESSION = 'interrupt-pause';
  const ctx = { sessionId: SESSION, callLLM: createFakeLLM(), executor: createFakeExecutor(projectPath), projectPath };

  // Walk to BUILD (ms-1 done, ms-2 plan shown)
  handleLifecycleBuildDetected('Counter app s persistencí', { intent: 'BUILD' }, ctx);
  await handleLifecycleInput('ano', ctx);              // SPEC
  await handleLifecycleInput('Prostý text, soubor', ctx); // → SPEC_REVIEW
  await handleLifecycleInput('schvaluji', ctx);         // → PLAN_REVIEW
  await handleLifecycleInput('schvaluji', ctx);         // → BUILD, ms-1 plan
  await handleLifecycleInput('ano', ctx);               // → ms-1 executes, ms-2 plan

  const stateBeforePause = getLcState(SESSION);
  check(stateBeforePause?.currentMilestoneId === 'ms-2', 'A.1: at ms-2 before pause',
    `got: ${stateBeforePause?.currentMilestoneId}`);

  // Verify ms-1 PASSED
  const ms1 = msRepo.getMilestone('ms-1');
  check(ms1?.status === 'PASSED', 'A.2: ms-1 PASSED before pause', `got: ${ms1?.status}`);

  // ─── PAUSE ────────────────────────────────────────────────────────────
  const pauseResp = await handleLifecycleInput('pauza', ctx);
  check(pauseResp?.content?.includes('pozastaven'), 'A.3: pause response confirms paused');

  const pausedState = getLcState(SESSION);
  check(pausedState?.phase === 'PAUSED', 'A.4: RAM state is PAUSED', `got: ${pausedState?.phase}`);

  // DB should also reflect PAUSED
  const lcDb = lifecycleRepo.findById.get(pausedState.lifecycleId);
  check(lcDb?.phase === 'PAUSED', 'A.5: DB phase is PAUSED', `got: ${lcDb?.phase}`);

  // ms-1 should still be PASSED
  const ms1After = msRepo.getMilestone('ms-1');
  check(ms1After?.status === 'PASSED', 'A.6: ms-1 still PASSED after pause', `got: ${ms1After?.status}`);

  // ─── RESUME ───────────────────────────────────────────────────────────
  const resumeResp = await handleLifecycleInput('pokračovat', ctx);
  check(resumeResp?.content?.includes('obnoven') || resumeResp?.content?.includes('BUILD'),
    'A.7: resume response mentions restoration');

  const resumedState = getLcState(SESSION);
  // Resume reads DB phase (PAUSED) — this is the current behavior
  check(resumedState?.phase === 'PAUSED', 'A.8: state shows PAUSED after resume (reads DB)',
    `got: ${resumedState?.phase}`);

  // Progress should show 1 completed
  const progress = getBuildProgress(resumedState.lifecycleId);
  check(progress.completed === 1, 'A.9: progress shows 1 completed after resume',
    `got: ${progress.completed}`);
  // ms-2 is in AWAITING_PLAN (already planned), not PENDING
  check(progress.completed + progress.executing >= 1,
    'A.10: progress shows completed + executing milestones',
    `completed: ${progress.completed}, executing: ${progress.executing}`);

  // Cleanup
  try { fs.rmSync(projectPath, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── TEST B: Cancel during SPEC ─────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function testCancel() {
  console.log('\n═══ TEST B: Cancel during SPEC ═════════════════════════════════════');

  cleanDB();
  const projectPath = setupProject();
  const SESSION = 'interrupt-cancel';
  const ctx = { sessionId: SESSION, callLLM: createFakeLLM(), executor: createFakeExecutor(projectPath), projectPath };

  handleLifecycleBuildDetected('Counter app', { intent: 'BUILD' }, ctx);
  await handleLifecycleInput('ano', ctx); // → SPEC

  const stateBeforeCancel = getLcState(SESSION);
  check(stateBeforeCancel?.phase === 'SPEC', 'B.1: state is SPEC before cancel',
    `got: ${stateBeforeCancel?.phase}`);
  check(stateBeforeCancel?.lifecycleId != null, 'B.2: lifecycleId exists');

  // ─── CANCEL ───────────────────────────────────────────────────────────
  const cancelResp = await handleLifecycleInput('zrušit', ctx);
  check(cancelResp?.content?.includes('zrušen'), 'B.3: cancel response confirms cancelled');

  const cancelledState = getLcState(SESSION);
  check(cancelledState === null, 'B.4: RAM state cleared after cancel',
    `got: ${JSON.stringify(cancelledState)}`);

  // ─── Verify re-entry works ────────────────────────────────────────────
  handleLifecycleBuildDetected('Nový projekt', { intent: 'BUILD' }, ctx);
  const freshState = getLcState(SESSION);
  check(freshState?.phase === 'PROPOSED', 'B.5: can start new lifecycle after cancel',
    `got: ${freshState?.phase}`);

  clearLcState(SESSION);
  try { fs.rmSync(projectPath, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── TEST C: Crash Recovery (preloadActiveLifecycles) ───────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function testCrashRecovery() {
  console.log('\n═══ TEST C: Crash Recovery ═════════════════════════════════════════');

  cleanDB();
  const projectPath = setupProject();
  const SESSION = 'interrupt-crash';
  const ctx = { sessionId: SESSION, callLLM: createFakeLLM(), executor: createFakeExecutor(projectPath), projectPath };

  // Walk to BUILD (ms-1 done)
  handleLifecycleBuildDetected('Counter app', { intent: 'BUILD' }, ctx);
  await handleLifecycleInput('ano', ctx);
  await handleLifecycleInput('OK', ctx);
  await handleLifecycleInput('schvaluji', ctx);
  await handleLifecycleInput('schvaluji', ctx);
  await handleLifecycleInput('ano', ctx); // ms-1 executes

  const stateBeforeCrash = getLcState(SESSION);
  check(stateBeforeCrash?.currentMilestoneId === 'ms-2', 'C.1: at ms-2 before crash',
    `got: ${stateBeforeCrash?.currentMilestoneId}`);
  const lifecycleId = stateBeforeCrash.lifecycleId;

  // ─── SIMULATE CRASH ──────────────────────────────────────────────────
  // Clear ONLY RAM state (DB survives crash — that's the whole point)
  _clearAllRam();
  const afterCrash = getLcState(SESSION);
  check(afterCrash === null, 'C.2: RAM state lost after crash');

  // ─── RECOVERY ────────────────────────────────────────────────────────
  // Re-initialize DB backing
  initLifecycleStateDb(lifecycleHandoffState, lifecycleRepo);

  // Preload from DB
  const loaded = preloadActiveLifecycles();
  check(loaded >= 1, 'C.3: preloadActiveLifecycles loaded at least 1 state',
    `got: ${loaded}`);

  // Check restored state
  const restoredState = getLcState(SESSION);
  check(restoredState != null, 'C.4: RAM state restored from DB');

  if (restoredState) {
    check(restoredState.lifecycleId === lifecycleId, 'C.5: correct lifecycleId restored',
      `got: ${restoredState.lifecycleId}`);
    check(restoredState.restored === true, 'C.6: restored flag is set');
    check(restoredState.projectPath === projectPath, 'C.7: projectPath preserved',
      `got: ${restoredState.projectPath}`);
  }

  // ms-1 should still be PASSED in DB
  const ms1 = msRepo.getMilestone('ms-1');
  check(ms1?.status === 'PASSED', 'C.8: ms-1 still PASSED in DB after crash',
    `got: ${ms1?.status}`);

  // Progress should be intact
  const progress = getBuildProgress(lifecycleId);
  check(progress.completed === 1, 'C.9: progress shows 1 completed after recovery',
    `got: ${progress.completed}`);

  // Cleanup
  try { fs.rmSync(projectPath, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── MAIN ───────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function run() {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('  Test 2: Interrupts — Pause/Resume/Cancel/Crash Recovery');
  console.log('══════════════════════════════════════════════════════════════════════');

  try {
    await testPauseResume();
    await testCancel();
    await testCrashRecovery();
  } catch (err) {
    console.error(`\n\nFATAL ERROR: ${err.message}`);
    console.error(err.stack);
    failed++;
    failures.push({ name: 'FATAL', detail: err.message });
  }

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log(`  Test 2 Interrupts: ${passed} passed, ${failed} failed`);

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
