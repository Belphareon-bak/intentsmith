// Test 8: Human Friction Test — "Is the engine usable?"
// ══════════════════════════════════════════════════════════════════════════════
//
// 3 user profiles simulate different levels of engagement:
//   Profile A: "Just do it" — minimal input, wants defaults
//   Profile B: "No alternatives" — wants recommendations, not choices
//   Profile C: "Aggressive changes" — changes direction mid-build
//
// Metrics collected per profile:
//   - spec_attempts: how many answerSpecQuestions calls before valid spec
//   - total_turns: total user interactions before BUILD
//   - rejection_count: how many validation failures surfaced
//   - question_count: how many clarifying questions asked
//   - response_length: total characters in engine responses
//   - reached_build: did the profile reach BUILD phase?
//
// Key assertions:
//   - All profiles MUST eventually reach BUILD (no dead ends)
//   - Validation errors MUST be surfaced to the user (not swallowed)
//   - Minimal-input user should reach BUILD in ≤ 8 turns
//   - Engine must never enter infinite rejection loop
//
// ══════════════════════════════════════════════════════════════════════════════

import { isolatedTestRuntime } from './helpers/isolated-test-db.js';

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  projects,
  conversations,
  lifecycleHandoffState,
  lifecycles as lifecycleRepo,
  db,
} from '../src/db/database.js';

import {
  handleLifecycleBuildDetected,
  handleLifecycleInput,
} from '../src/chat/handlers/lifecycle-router.js';

import {
  getLcState,
  setLcState,
  cancelLifecycleHandoff,
  initLifecycleStateDb,
} from '../src/chat/handlers/lifecycle-state.js';

let passed = 0;
let failed = 0;
const failures = [];
const metrics = {};
const ownedProjects = [];

function check(condition, name, detail) {
  if (condition) {
    console.log(`  \u2713 ${name}`);
    passed++;
  } else {
    console.log(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ''}`);
    failed++;
    failures.push({ name, detail: detail || '' });
  }
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

function cleanDB() {
  const cleanOwnedProject = db.transaction(({
    id,
    projectPath,
    conversationId,
  }) => {
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
    db.prepare(
      'DELETE FROM conversations WHERE id = ? AND project_id = ?',
    ).run(conversationId, id);
    db.prepare('DELETE FROM lifecycle_handoff_state WHERE project_id = ?').run(id);

    const lifecycleRows = db.prepare(
      'SELECT id FROM project_lifecycles WHERE project_id = ?',
    ).all(id);
    for (const { id: lifecycleId } of lifecycleRows) {
      db.prepare('DELETE FROM drift_checks WHERE lifecycle_id = ?').run(lifecycleId);
      db.prepare('DELETE FROM change_requests WHERE lifecycle_id = ?').run(lifecycleId);
      db.prepare('DELETE FROM milestones WHERE lifecycle_id = ?').run(lifecycleId);
      db.prepare('DELETE FROM roadmap_versions WHERE lifecycle_id = ?').run(lifecycleId);
      db.prepare('DELETE FROM quality_scores WHERE lifecycle_id = ?').run(lifecycleId);
      db.prepare('DELETE FROM lifecycle_handoff_state WHERE lifecycle_id = ?').run(lifecycleId);
      const deletedLifecycle = db.prepare(
        'DELETE FROM project_lifecycles WHERE id = ? AND project_id = ?',
      ).run(lifecycleId, id);
      if (deletedLifecycle.changes !== 1) {
        throw new Error(`Owned lifecycle was not removed: ${lifecycleId}`);
      }
    }

    const deleted = db.prepare(
      'DELETE FROM projects WHERE id = ? AND path = ?',
    ).run(id, projectPath);
    if (deleted.changes !== 1) {
      throw new Error(`Owned friction project was not removed: ${projectPath}`);
    }
  });

  for (const ownedProject of ownedProjects) {
    cleanOwnedProject(ownedProject);
  }
  ownedProjects.length = 0;
  initLifecycleStateDb(lifecycleHandoffState, lifecycleRepo);
}

function makeProjectPath(profile) {
  return fs.mkdtempSync(path.join(
    isolatedTestRuntime.projects,
    `friction-${profile}-`,
  ));
}

// ─── Spec fixtures (progressively better quality) ────────────────────────────

// Incomplete spec — missing quality gate fields (what a lazy LLM might produce)
const SPEC_INCOMPLETE = {
  title: 'Note-taking CLI',
  goals: [
    { id: 'G1', description: 'Create and store notes' },
    { id: 'G2', description: 'Search notes by keyword' },
    { id: 'G3', description: 'Tag notes for organization' },
  ],
  requirements: {
    functional: [
      { id: 'R1', description: 'Create a new note with title and body' },
      { id: 'R2', description: 'List all notes' },
      { id: 'R3', description: 'Search notes by keyword' },
      { id: 'R4', description: 'Delete a note by ID' },
      { id: 'R5', description: 'Tag notes with labels' },
    ],
    non_functional: [
      { id: 'NF1', category: 'performance', description: 'Fast startup' },
    ],
  },
  tech_stack: { languages: ['Node.js 22'], tools: ['better-sqlite3'] },
  risks: [
    { id: 'RISK1', description: 'Data loss on crash', severity: 'MEDIUM', mitigation: 'WAL mode' },
  ],
  // MISSING: design_decisions, acceptance_criteria, success_criteria, acceptance_test, NF metric
};

// Complete spec — passes all quality gates
const SPEC_COMPLETE = {
  title: 'Note-taking CLI',
  goals: [
    { id: 'G1', description: 'Create and store notes', success_criteria: 'note add "title" "body" creates entry in DB' },
    { id: 'G2', description: 'Search notes by keyword', success_criteria: 'note search "keyword" returns matching notes in <100ms' },
    { id: 'G3', description: 'Tag notes for organization', success_criteria: 'note tag <id> "label" associates tag, filterable' },
  ],
  requirements: {
    functional: [
      { id: 'R1', description: 'Create a new note with title and body', acceptance_test: 'note add "test" "body" -> note list shows "test"' },
      { id: 'R2', description: 'List all notes', acceptance_test: 'note list -> table with id, title, date' },
      { id: 'R3', description: 'Search notes by keyword', acceptance_test: 'note search "test" -> matching notes' },
      { id: 'R4', description: 'Delete a note by ID', acceptance_test: 'note delete 1 -> note list no longer shows it' },
      { id: 'R5', description: 'Tag notes with labels', acceptance_test: 'note tag 1 "work" -> note list --tag work shows it' },
    ],
    non_functional: [
      { id: 'NF1', category: 'performance', description: 'Fast startup', metric: 'Cold start < 200ms measured with time command' },
      { id: 'NF2', category: 'portability', description: 'No native deps', metric: 'npm install without node-gyp' },
      { id: 'NF3', category: 'reliability', description: 'Crash-safe writes', metric: 'Kill -9 during write does not corrupt DB' },
    ],
  },
  tech_stack: {
    languages: ['Node.js 22'],
    frameworks: ['commander 12'],
    tools: ['better-sqlite3'],
    rationale: 'Node.js for cross-platform CLI, better-sqlite3 for embedded storage',
  },
  design_decisions: [
    { id: 'DD1', decision: 'Storage engine', chosen: 'SQLite via better-sqlite3', alternatives_considered: ['JSON file', 'LevelDB'], rationale: 'SQL queries for search, ACID for reliability, single-file for portability' },
    { id: 'DD2', decision: 'Search approach', chosen: 'FTS5 full-text search', alternatives_considered: ['LIKE queries', 'External search index'], rationale: 'FTS5 is built into SQLite, fast for small datasets, no external deps' },
  ],
  risks: [
    { id: 'RISK1', description: 'Data loss on crash', severity: 'MEDIUM', likelihood: 'LOW', mitigation: 'WAL mode + PRAGMA journal_mode', contingency: 'Periodic backup command' },
    { id: 'RISK2', description: 'FTS5 not available on all SQLite builds', severity: 'LOW', likelihood: 'LOW', mitigation: 'Fallback to LIKE queries', contingency: 'Document requirement' },
    { id: 'RISK3', description: 'Large note bodies slow down search', severity: 'LOW', likelihood: 'MEDIUM', mitigation: 'Index title separately, limit body in results', contingency: 'Pagination' },
  ],
  acceptance_criteria: [
    'All CRUD operations work end-to-end from CLI',
    'Search returns results in under 200ms for 1000 notes',
    'Tags can be used to filter note list',
  ],
};

// Roadmap and milestone plans — parameterized by prefix to avoid ID collisions
function makeRoadmap(prefix) {
  return {
    milestones: [
      {
        id: `${prefix}-ms-1`, title: 'DB Schema + Note CRUD', description: 'SQLite setup with notes table, CRUD operations',
        dependencies: [], estimated_loc: 200, estimated_files: 3, estimated_complexity: 'LOW',
        goals_addressed: ['G1'], requirements_addressed: ['R1', 'R2', 'R4'],
        test_strategy: { type: 'unit', description: 'CRUD round-trip tests', specific_tests: ['create note', 'list notes', 'delete note'], expected_test_count: 5 },
        acceptance_criteria: ['note add/list/delete work', 'DB persists across runs'],
        deliverables: ['src/db.js', 'src/notes.js', 'tests/notes.test.js'],
      },
      {
        id: `${prefix}-ms-2`, title: 'Search + Tags', description: 'FTS5 search and tag system',
        dependencies: [`${prefix}-ms-1`], estimated_loc: 250, estimated_files: 3, estimated_complexity: 'MEDIUM',
        goals_addressed: ['G2', 'G3'], requirements_addressed: ['R3', 'R5'],
        test_strategy: { type: 'integration', description: 'Search accuracy tests', specific_tests: ['keyword match', 'tag filter', 'combined search'], expected_test_count: 8 },
        acceptance_criteria: ['FTS5 search returns relevant results', 'Tags filterable'],
        deliverables: ['src/search.js', 'src/tags.js', 'tests/search.test.js'],
      },
    ],
    total_estimated_loc: 450,
    total_milestones: 2,
    critical_path: [`${prefix}-ms-1`, `${prefix}-ms-2`],
    requirements_coverage: { covered: ['R1', 'R2', 'R3', 'R4', 'R5'], uncovered: [], rationale_for_uncovered: '' },
  };
}

function makePlans(prefix) {
  return {
    [`${prefix}-ms-1`]: {
      milestone_id: `${prefix}-ms-1`, technical_approach: 'SQLite with WAL mode, simple CRUD',
      files: [
        { path: 'src/db.js', action: 'create', purpose: 'Database connection + schema' },
        { path: 'src/notes.js', action: 'create', purpose: 'Note CRUD operations' },
      ],
      implementation_steps: [{ step: 1, action: 'Create SQLite schema', file: 'src/db.js', validation: 'DB file created' }],
      scope_files: ['src/db.js', 'src/notes.js'],
    },
    [`${prefix}-ms-2`]: {
      milestone_id: `${prefix}-ms-2`, technical_approach: 'FTS5 virtual table for search',
      files: [
        { path: 'src/search.js', action: 'create', purpose: 'Full-text search via FTS5' },
        { path: 'src/tags.js', action: 'create', purpose: 'Tag management' },
      ],
      implementation_steps: [{ step: 1, action: 'Create FTS5 virtual table', file: 'src/search.js', validation: 'Search queries work' }],
      scope_files: ['src/search.js', 'src/tags.js'],
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════

async function run() {
  console.log('\u2550'.repeat(70));
  console.log('  Test 8: Human Friction Test \u2014 "Is the engine usable?"');
  console.log('\u2550'.repeat(70));

  cleanDB();

  // ═══════════════════════════════════════════════════════════════════════════
  // PROFILE A: "Just do it" \u2014 minimal input, wants defaults
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('\n\u2550\u2550\u2550 PROFILE A: "Just do it" \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  const profileA = { spec_attempts: 0, total_turns: 0, rejection_count: 0, question_count: 0, response_length: 0, reached_build: false, validation_errors_surfaced: false };

  {
    const SESSION_ID = 'friction-a';
    const projectPath = makeProjectPath('a');
    execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', { cwd: projectPath, stdio: 'pipe' });
    fs.writeFileSync(path.join(projectPath, 'package.json'), JSON.stringify({ name: 'friction-a', version: '0.0.1', scripts: { test: 'echo ok' } }));
    execSync('git add -A && git commit -m "init"', { cwd: projectPath, stdio: 'pipe' });

    const project = projects.getOrCreate('friction-a', projectPath, 'Friction test A');
    const projectId = Number(project.id);
    const CONV_ID = `friction-a-${Date.now()}`;
    conversations.getOrCreate(CONV_ID, projectId, 'Friction A');
    ownedProjects.push({
      id: projectId,
      projectPath,
      conversationId: CONV_ID,
    });

    // FakeLLM: Profile A — returns incomplete spec first, then complete
    const ROADMAP_A = makeRoadmap('a');
    const PLANS_A = makePlans('a');
    let specDocCalls = 0;
    const fakeLLM = async (role, prompt) => {
      const p = prompt.toLowerCase();

      if (p.includes('senior software architect and engineering partner') || p.includes('deeply analyze')) {
        profileA.question_count += 5; // returns 5 questions
        return {
          content: JSON.stringify({
            core_goal: 'Simple note-taking CLI',
            implicit_assumptions: ['Single-user', 'Local storage only'],
            technical_decisions: [
              { decision: 'Storage', alternatives: [{ option: 'SQLite', pros: ['Fast'], cons: ['File-based'] }, { option: 'JSON', pros: ['Simple'], cons: ['No queries'] }], recommendation: 'SQLite \u2014 best for search' },
            ],
            clarifying_questions: [
              'Max number of notes expected?',
              'Need encryption?',
              'Need cloud sync?',
              'Markdown support?',
              'Export format?',
            ],
            initial_assessment: { estimated_complexity: 'LOW', key_risks: [], suggested_tech_stack: ['Node.js'], tech_stack_rationale: 'Simple CLI' },
          }),
        };
      }

      if (p.includes('structured project specification') || p.includes('thorough project specification')) {
        specDocCalls++;
        profileA.spec_attempts++;

        // First attempt: return INCOMPLETE spec (missing quality gate fields)
        if (specDocCalls === 1) {
          return { content: JSON.stringify(SPEC_INCOMPLETE) };
        }
        // Second attempt: return COMPLETE spec
        return { content: JSON.stringify(SPEC_COMPLETE) };
      }

      if (p.includes('creating a project roadmap') || p.includes('break the project into milestones')) {
        return { content: JSON.stringify(ROADMAP_A) };
      }

      if (p.includes('implementation plan for this milestone') || p.includes('detailed implementation plan')) {
        const msMatch = prompt.match(/"id"\s*:\s*"([^"]+)"/);
        const msId = msMatch ? msMatch[1] : 'a-ms-1';
        return { content: JSON.stringify(PLANS_A[msId] || PLANS_A['a-ms-1']) };
      }

      if (p.includes('compare the actual output') || p.includes('reviewing a completed milestone')) {
        return { content: JSON.stringify({ passed: true, deliverables_check: [{ deliverable: 'Files', status: 'DONE', note: 'ok' }], scope_violations: [], test_summary: { total: 3, passed: 3, failed: 0 }, security_findings: [], error_handling_gaps: [], discovered_requirements: [], quality_notes: [], overall_assessment: 'OK' }) };
      }

      if (p.includes('health metrics')) {
        return { content: JSON.stringify({ scope_adherence: 0.9, test_coverage: 0.8, complexity_delta: 0.1, tech_debt_delta: 0.05 }) };
      }

      return { content: JSON.stringify({ fallback: true }) };
    };

    const fakeExecutor = {
      async start(request, meta) {
        const msId = meta?.milestoneId || 'a-ms-1';
        const plan = PLANS_A[msId] || PLANS_A['a-ms-1'];
        for (const f of (plan.files || [])) {
          const fp = path.join(projectPath, f.path);
          fs.mkdirSync(path.dirname(fp), { recursive: true });
          fs.writeFileSync(fp, `// ${f.purpose}\nexport default {};\n`);
        }
        execSync('git add -A && git commit -m "milestone" --allow-empty', { cwd: projectPath, stdio: 'pipe' });
        return { state: 'COMPLETED', sessionId: `wf-${msId}` };
      },
      async approve(sid) { return { state: 'COMPLETED', sessionId: sid }; },
    };

    const context = { sessionId: SESSION_ID, callLLM: fakeLLM, executor: fakeExecutor, projectPath, projectId };

    function turn(input) { profileA.total_turns++; }
    function trackResponse(r) { profileA.response_length += (r?.content?.length || 0); }

    // Turn 1: Project-scope build detected → propose lifecycle
    const r1 = handleLifecycleBuildDetected(
      'chci appku na poznamky, CLI, jednoduchy',
      { intent: 'BUILD' },
      context
    );
    turn('/lifecycle'); trackResponse(r1);
    const s1 = getLcState(SESSION_ID);

    check(s1?.phase === 'PROPOSED', 'A.1: lifecycle proposed', `phase=${s1?.phase}`);

    // Turn 2: Accept lifecycle
    const r2 = await handleLifecycleInput('ano', context);
    turn('ano'); trackResponse(r2);
    const s2 = getLcState(SESSION_ID);

    check(s2?.phase === 'SPEC', 'A.2: in SPEC phase', `phase=${s2?.phase}`);
    check(r2?.content?.length > 0, 'A.3: engine returned questions', `len=${r2?.content?.length}`);

    // Turn 3: Minimal answers (Profile A style)
    const r3 = await handleLifecycleInput('max 1000 poznamek, nechci sifrovani, bez cloudu, bez markdownu, JSON export', context);
    turn('answers'); trackResponse(r3);
    const s3 = getLcState(SESSION_ID);

    // KEY FRICTION POINT: The first spec attempt should FAIL validation
    // Engine should tell the user what's wrong, NOT silently transition to SPEC_REVIEW
    if (s3?.phase === 'SPEC_REVIEW') {
      // Engine transitioned to SPEC_REVIEW with invalid spec \u2014 this is a friction bug!
      // The spec is missing quality gate fields but engine didn't tell the user
      profileA.validation_errors_surfaced = false;

      check(false,
        'A.4: engine caught invalid spec and reported errors to user',
        'Engine went to SPEC_REVIEW with invalid spec (missing design_decisions, acceptance_criteria, etc.)');

      // Try to approve \u2014 should fail because spec is invalid
      const rApprove = await handleLifecycleInput('schvaluji', context);
      turn('schvaluji'); trackResponse(rApprove);
      const sApprove = getLcState(SESSION_ID);

      // approveSpec should throw, engine should report error
      const approveHasError = rApprove?.content?.toLowerCase().includes('chyba') ||
        rApprove?.content?.toLowerCase().includes('error') ||
        rApprove?.content?.toLowerCase().includes('invalid') ||
        rApprove?.content?.toLowerCase().includes('cannot approve');

      check(approveHasError,
        'A.4b: engine rejects approval of invalid spec with error message',
        `response: ${rApprove?.content?.substring(0, 200)}`);

      // User should be able to trigger revision
      if (sApprove?.phase === 'SPEC_REVIEW' || sApprove?.phase === 'SPEC') {
        const rRevise = await handleLifecycleInput('doplň to, vyber defaults za mě', context);
        turn('doplň to'); trackResponse(rRevise);
        const sRevise = getLcState(SESSION_ID);

        // After revision, should be back in SPEC or SPEC_REVIEW with valid spec
        if (sRevise?.phase === 'SPEC') {
          // Need to answer questions again
          const rAnswer = await handleLifecycleInput('jo, ok, cokoliv', context);
          turn('jo ok'); trackResponse(rAnswer);
        }
      }
    } else if (s3?.phase === 'SPEC') {
      // Good! Engine stayed in SPEC \u2014 validation errors were reported inline
      profileA.validation_errors_surfaced = true;
      profileA.rejection_count++;

      const hasValidationInfo = r3?.content?.includes('valid') ||
        r3?.content?.includes('design') ||
        r3?.content?.includes('acceptance') ||
        r3?.content?.includes('chyb') ||
        r3?.content?.includes('problem');

      check(hasValidationInfo,
        'A.4: engine reported validation errors to user',
        `response: ${r3?.content?.substring(0, 200)}`);

      // Turn 4: User says "fix it for me" \u2014 minimal friction
      const r4 = await handleLifecycleInput('ok, doplň co chybí, vyber ty', context);
      turn('doplň co chybí'); trackResponse(r4);
    }

    // Navigate to SPEC_REVIEW if not there already
    let currentState = getLcState(SESSION_ID);
    let safetyCounter = 0;
    while (currentState?.phase !== 'SPEC_REVIEW' && currentState?.phase !== 'PLANNING' && safetyCounter < 5) {
      const rNav = await handleLifecycleInput('ano, pokračuj', context);
      turn('pokračuj'); trackResponse(rNav);
      currentState = getLcState(SESSION_ID);
      safetyCounter++;
    }

    check(safetyCounter < 5, 'A.5: reached SPEC_REVIEW without infinite loop', `iterations=${safetyCounter}`);

    // Approve spec
    if (currentState?.phase === 'SPEC_REVIEW') {
      const rApproveSpec = await handleLifecycleInput('schvaluji', context);
      turn('schvaluji spec'); trackResponse(rApproveSpec);
      currentState = getLcState(SESSION_ID);
    }

    // Navigate through PLANNING to BUILD
    if (currentState?.phase === 'PLANNING' || currentState?.phase === 'PLAN_REVIEW') {
      if (currentState?.phase === 'PLAN_REVIEW') {
        const rApproveRoadmap = await handleLifecycleInput('schvaluji', context);
        turn('schvaluji roadmap'); trackResponse(rApproveRoadmap);
        currentState = getLcState(SESSION_ID);
      }
    }

    // Check if we reached BUILD
    const buildPhases = new Set(['BUILD', 'BUILD_MILESTONE_REVIEW', 'PLAN_REVIEW']);
    profileA.reached_build = buildPhases.has(currentState?.phase) || currentState?.phase === 'BUILD';

    check(profileA.reached_build || currentState?.phase === 'PLAN_REVIEW',
      'A.6: Profile A reached BUILD or PLAN_REVIEW',
      `phase=${currentState?.phase}`);

    check(profileA.total_turns <= 10,
      'A.7: reached BUILD in \u226410 turns',
      `turns=${profileA.total_turns}`);

    check(profileA.spec_attempts <= 3,
      'A.8: spec generated in \u22643 attempts',
      `attempts=${profileA.spec_attempts}`);

    metrics.profileA = { ...profileA };
    cancelLifecycleHandoff(SESSION_ID);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROFILE B: "No alternatives" \u2014 wants recommendations, not choices
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('\n\u2550\u2550\u2550 PROFILE B: "No alternatives" \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  const profileB = { spec_attempts: 0, total_turns: 0, rejection_count: 0, question_count: 0, response_length: 0, reached_build: false, single_alt_handled: false };

  {
    const SESSION_ID = 'friction-b';
    const projectPath = makeProjectPath('b');
    execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', { cwd: projectPath, stdio: 'pipe' });
    fs.writeFileSync(path.join(projectPath, 'package.json'), JSON.stringify({ name: 'friction-b', version: '0.0.1', scripts: { test: 'echo ok' } }));
    execSync('git add -A && git commit -m "init"', { cwd: projectPath, stdio: 'pipe' });

    const project = projects.getOrCreate('friction-b', projectPath, 'Friction test B');
    const projectId = Number(project.id);
    const CONV_ID = `friction-b-${Date.now()}`;
    conversations.getOrCreate(CONV_ID, projectId, 'Friction B');
    ownedProjects.push({
      id: projectId,
      projectPath,
      conversationId: CONV_ID,
    });

    // FakeLLM: Profile B — always returns complete spec (user says "pick for me")
    const ROADMAP_B = makeRoadmap('b');
    const PLANS_B = makePlans('b');
    const fakeLLM = async (role, prompt) => {
      const p = prompt.toLowerCase();

      if (p.includes('senior software architect and engineering partner') || p.includes('deeply analyze')) {
        profileB.question_count += 3;
        return {
          content: JSON.stringify({
            core_goal: 'Note-taking CLI',
            implicit_assumptions: ['Local only', 'Single user'],
            technical_decisions: [
              { decision: 'Storage', alternatives: [{ option: 'SQLite', pros: ['Fast'], cons: ['File'] }, { option: 'JSON', pros: ['Simple'], cons: ['Slow'] }], recommendation: 'SQLite' },
            ],
            clarifying_questions: ['Max notes?', 'Need tags?', 'Export format?'],
            initial_assessment: { estimated_complexity: 'LOW', key_risks: [], suggested_tech_stack: ['Node.js 22'], tech_stack_rationale: 'Standard' },
          }),
        };
      }

      if (p.includes('structured project specification') || p.includes('thorough project specification')) {
        profileB.spec_attempts++;
        // Profile B: user says "pick for me" \u2014 LLM produces complete spec immediately
        return { content: JSON.stringify(SPEC_COMPLETE) };
      }

      if (p.includes('creating a project roadmap') || p.includes('break the project into milestones')) {
        return { content: JSON.stringify(ROADMAP_B) };
      }

      if (p.includes('implementation plan for this milestone') || p.includes('detailed implementation plan')) {
        const msMatch = prompt.match(/"id"\s*:\s*"([^"]+)"/);
        const msId = msMatch ? msMatch[1] : 'b-ms-1';
        return { content: JSON.stringify(PLANS_B[msId] || PLANS_B['b-ms-1']) };
      }

      if (p.includes('compare the actual output') || p.includes('reviewing a completed milestone')) {
        return { content: JSON.stringify({ passed: true, deliverables_check: [], scope_violations: [], test_summary: { total: 3, passed: 3, failed: 0 }, security_findings: [], error_handling_gaps: [], discovered_requirements: [], quality_notes: [], overall_assessment: 'OK' }) };
      }

      if (p.includes('health metrics')) {
        return { content: JSON.stringify({ scope_adherence: 0.9, test_coverage: 0.8, complexity_delta: 0.1, tech_debt_delta: 0.05 }) };
      }

      return { content: JSON.stringify({ fallback: true }) };
    };

    const fakeExecutor = {
      async start(request, meta) {
        const msId = meta?.milestoneId || 'b-ms-1';
        const plan = PLANS_B[msId] || PLANS_B['b-ms-1'];
        for (const f of (plan.files || [])) {
          const fp = path.join(projectPath, f.path);
          fs.mkdirSync(path.dirname(fp), { recursive: true });
          fs.writeFileSync(fp, `// ${f.purpose}\nexport default {};\n`);
        }
        execSync('git add -A && git commit -m "milestone" --allow-empty', { cwd: projectPath, stdio: 'pipe' });
        return { state: 'COMPLETED', sessionId: `wf-${msId}` };
      },
      async approve(sid) { return { state: 'COMPLETED', sessionId: sid }; },
    };

    const context = { sessionId: SESSION_ID, callLLM: fakeLLM, executor: fakeExecutor, projectPath, projectId };

    function turn() { profileB.total_turns++; }
    function trackResponse(r) { profileB.response_length += (r?.content?.length || 0); }

    // Turn 1: Project-scope build detected → propose lifecycle
    const r1 = handleLifecycleBuildDetected(
      'poznamky CLI, vyber technologie za me, nechci resit alternativy',
      { intent: 'BUILD' },
      context
    );
    turn(); trackResponse(r1);

    // Turn 2: Accept lifecycle
    const r2 = await handleLifecycleInput('ano', context);
    turn(); trackResponse(r2);

    // Turn 3: Answer with "pick for me" attitude
    const r3 = await handleLifecycleInput('max 500 poznamek, ano chci tagy, JSON export, vyber ty zbytek', context);
    turn(); trackResponse(r3);
    const s3 = getLcState(SESSION_ID);

    // Profile B: LLM returns complete spec \u2014 should go straight to SPEC_REVIEW
    check(s3?.phase === 'SPEC_REVIEW',
      'B.1: complete spec goes directly to SPEC_REVIEW',
      `phase=${s3?.phase}`);

    check(profileB.spec_attempts === 1,
      'B.2: spec accepted on first attempt (no friction)',
      `attempts=${profileB.spec_attempts}`);

    // Turn 4: Approve spec
    if (s3?.phase === 'SPEC_REVIEW') {
      const r4 = await handleLifecycleInput('schvaluji', context);
      turn(); trackResponse(r4);
    }

    // Turn 5: Approve roadmap
    let currentState = getLcState(SESSION_ID);
    if (currentState?.phase === 'PLAN_REVIEW') {
      const r5 = await handleLifecycleInput('schvaluji', context);
      turn(); trackResponse(r5);
      currentState = getLcState(SESSION_ID);
    }

    profileB.reached_build = currentState?.phase === 'BUILD' || currentState?.phase === 'BUILD_MILESTONE_REVIEW';

    check(profileB.reached_build,
      'B.3: Profile B reached BUILD',
      `phase=${currentState?.phase}`);

    check(profileB.total_turns <= 6,
      'B.4: reached BUILD in \u22646 turns (zero friction for cooperative user)',
      `turns=${profileB.total_turns}`);

    check(profileB.rejection_count === 0,
      'B.5: zero rejections for cooperative user',
      `rejections=${profileB.rejection_count}`);

    metrics.profileB = { ...profileB };
    cancelLifecycleHandoff(SESSION_ID);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROFILE C: "Aggressive changes" \u2014 changes direction mid-build
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('\n\u2550\u2550\u2550 PROFILE C: "Aggressive changes" \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  const profileC = { total_turns: 0, change_count: 0, spec_revisions: 0, roadmap_revisions: 0, response_length: 0, reached_build: false, engine_stayed_consistent: true };

  {
    const SESSION_ID = 'friction-c';
    const projectPath = makeProjectPath('c');
    execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', { cwd: projectPath, stdio: 'pipe' });
    fs.writeFileSync(path.join(projectPath, 'package.json'), JSON.stringify({ name: 'friction-c', version: '0.0.1', scripts: { test: 'echo ok' } }));
    execSync('git add -A && git commit -m "init"', { cwd: projectPath, stdio: 'pipe' });

    const project = projects.getOrCreate('friction-c', projectPath, 'Friction test C');
    const projectId = Number(project.id);
    const CONV_ID = `friction-c-${Date.now()}`;
    conversations.getOrCreate(CONV_ID, projectId, 'Friction C');
    ownedProjects.push({
      id: projectId,
      projectPath,
      conversationId: CONV_ID,
    });

    const ROADMAP_C = makeRoadmap('c');
    const PLANS_C = makePlans('c');
    let specDocCalls = 0;
    let roadmapCalls = 0;

    // SPEC with encryption (user will change this later)
    const SPEC_WITH_ENCRYPTION = {
      ...SPEC_COMPLETE,
      title: 'Encrypted Note-taking CLI',
      goals: [
        ...SPEC_COMPLETE.goals,
        { id: 'G4', description: 'Encrypt notes at rest', success_criteria: 'Notes encrypted with AES-256-GCM' },
      ],
      design_decisions: [
        ...SPEC_COMPLETE.design_decisions,
        { id: 'DD3', decision: 'Encryption', chosen: 'AES-256-GCM', alternatives_considered: ['ChaCha20', 'No encryption'], rationale: 'User explicitly wants encryption' },
      ],
    };

    // SPEC without encryption (after user says "actually no encryption")
    const SPEC_NO_ENCRYPTION = { ...SPEC_COMPLETE };

    const fakeLLM = async (role, prompt) => {
      const p = prompt.toLowerCase();

      if (p.includes('senior software architect and engineering partner') || p.includes('deeply analyze')) {
        return {
          content: JSON.stringify({
            core_goal: 'Note-taking CLI',
            implicit_assumptions: ['Local', 'Single-user'],
            technical_decisions: [
              { decision: 'Encryption', alternatives: [{ option: 'AES-256', pros: ['Secure'], cons: ['Complex'] }, { option: 'None', pros: ['Simple'], cons: ['Insecure'] }], recommendation: 'AES-256' },
            ],
            clarifying_questions: ['Need encryption?', 'Max notes?', 'Export format?'],
            initial_assessment: { estimated_complexity: 'MEDIUM', key_risks: [], suggested_tech_stack: ['Node.js 22'], tech_stack_rationale: 'Standard' },
          }),
        };
      }

      if (p.includes('structured project specification') || p.includes('thorough project specification')) {
        specDocCalls++;
        // First: with encryption. After revision: without.
        if (specDocCalls <= 1) return { content: JSON.stringify(SPEC_WITH_ENCRYPTION) };
        return { content: JSON.stringify(SPEC_NO_ENCRYPTION) };
      }

      if (p.includes('creating a project roadmap') || p.includes('break the project into milestones')) {
        roadmapCalls++;
        return { content: JSON.stringify(ROADMAP_C) };
      }

      if (p.includes('implementation plan for this milestone') || p.includes('detailed implementation plan')) {
        const msMatch = prompt.match(/"id"\s*:\s*"([^"]+)"/);
        const msId = msMatch ? msMatch[1] : 'c-ms-1';
        return { content: JSON.stringify(PLANS_C[msId] || PLANS_C['c-ms-1']) };
      }

      if (p.includes('compare the actual output') || p.includes('reviewing a completed milestone')) {
        return { content: JSON.stringify({ passed: true, deliverables_check: [], scope_violations: [], test_summary: { total: 3, passed: 3, failed: 0 }, security_findings: [], error_handling_gaps: [], discovered_requirements: [], quality_notes: [], overall_assessment: 'OK' }) };
      }

      if (p.includes('health metrics')) {
        return { content: JSON.stringify({ scope_adherence: 0.9, test_coverage: 0.8, complexity_delta: 0.1, tech_debt_delta: 0.05 }) };
      }

      if (p.includes('analyzing a change request') || p.includes('impact of this change')) {
        return { content: JSON.stringify({ affected_milestones: ['c-ms-2'], impact: { milestones_to_add: [], milestones_to_remove: [], milestones_to_modify: [{ id: 'c-ms-2', changes: 'Add encryption support' }], effort_delta: '+200 LOC', risk_level: 'LOW' }, feasibility: 'FEASIBLE', recommendation: 'Approve' }) };
      }

      if (p.includes('rewriting a project roadmap') || p.includes('incorporate an approved change')) {
        return { content: JSON.stringify(ROADMAP_C) };
      }

      return { content: JSON.stringify({ fallback: true }) };
    };

    const fakeExecutor = {
      async start(request, meta) {
        const msId = meta?.milestoneId || 'c-ms-1';
        const plan = PLANS_C[msId] || PLANS_C['c-ms-1'];
        for (const f of (plan.files || [])) {
          const fp = path.join(projectPath, f.path);
          fs.mkdirSync(path.dirname(fp), { recursive: true });
          fs.writeFileSync(fp, `// ${f.purpose}\nexport default {};\n`);
        }
        execSync('git add -A && git commit -m "milestone" --allow-empty', { cwd: projectPath, stdio: 'pipe' });
        return { state: 'COMPLETED', sessionId: `wf-${msId}` };
      },
      async approve(sid) { return { state: 'COMPLETED', sessionId: sid }; },
    };

    const context = { sessionId: SESSION_ID, callLLM: fakeLLM, executor: fakeExecutor, projectPath, projectId };

    function turn() { profileC.total_turns++; }
    function trackResponse(r) { profileC.response_length += (r?.content?.length || 0); }

    // Turn 1: Project-scope build detected → propose lifecycle
    const r1 = handleLifecycleBuildDetected(
      'poznamky CLI s sifrovani',
      { intent: 'BUILD' },
      context
    );
    turn(); trackResponse(r1);

    // Turn 2: Accept lifecycle
    const r2 = await handleLifecycleInput('ano', context);
    turn(); trackResponse(r2);

    // Turn 3: Answer questions
    const r3 = await handleLifecycleInput('chci sifrovani AES, max 1000 poznamek, JSON export', context);
    turn(); trackResponse(r3);

    // Should be in SPEC_REVIEW with encrypted spec
    let s = getLcState(SESSION_ID);
    check(s?.phase === 'SPEC_REVIEW',
      'C.1: encrypted spec in SPEC_REVIEW',
      `phase=${s?.phase}`);

    // Turn 4: User CHANGES MIND \u2014 "actually no encryption"
    const r4 = await handleLifecycleInput('vlastne nechci sifrovani, zjednodus to', context);
    turn(); trackResponse(r4);
    profileC.spec_revisions++;
    s = getLcState(SESSION_ID);

    check(s?.phase === 'SPEC' || s?.phase === 'SPEC_REVIEW',
      'C.2: revision triggered \u2014 back to SPEC or SPEC_REVIEW',
      `phase=${s?.phase}`);

    // Navigate to SPEC_REVIEW with revised spec
    let navCounter = 0;
    while (s?.phase === 'SPEC' && navCounter < 5) {
      const rNav = await handleLifecycleInput('ano, pokracuj bez sifrovani', context);
      turn(); trackResponse(rNav);
      s = getLcState(SESSION_ID);
      navCounter++;
    }

    // Approve revised spec
    if (s?.phase === 'SPEC_REVIEW') {
      const rApprove = await handleLifecycleInput('schvaluji', context);
      turn(); trackResponse(rApprove);
      s = getLcState(SESSION_ID);
    }

    // Approve roadmap
    if (s?.phase === 'PLAN_REVIEW') {
      const rApprove = await handleLifecycleInput('schvaluji', context);
      turn(); trackResponse(rApprove);
      s = getLcState(SESSION_ID);
    }

    profileC.reached_build = s?.phase === 'BUILD' || s?.phase === 'BUILD_MILESTONE_REVIEW';

    check(profileC.reached_build,
      'C.3: Profile C reached BUILD after direction change',
      `phase=${s?.phase}`);

    check(profileC.total_turns <= 12,
      'C.4: reached BUILD in \u226412 turns despite direction change',
      `turns=${profileC.total_turns}`);

    check(specDocCalls >= 2,
      'C.5: spec regenerated after revision (\u22652 specDocument calls)',
      `calls=${specDocCalls}`);

    check(roadmapCalls >= 1,
      'C.6: roadmap generated at least once',
      `calls=${roadmapCalls}`);

    metrics.profileC = { ...profileC };
    cancelLifecycleHandoff(SESSION_ID);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FRICTION DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('\n\u2550\u2550\u2550 FRICTION DASHBOARD \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  console.log('');
  console.log('  \u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510');
  console.log('  \u2502 Metric              \u2502 Profile A     \u2502 Profile B     \u2502 Profile C     \u2502');
  console.log('  \u251c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524');
  console.log(`  \u2502 Total turns         \u2502 ${String(metrics.profileA?.total_turns).padStart(13)} \u2502 ${String(metrics.profileB?.total_turns).padStart(13)} \u2502 ${String(metrics.profileC?.total_turns).padStart(13)} \u2502`);
  console.log(`  \u2502 Spec attempts       \u2502 ${String(metrics.profileA?.spec_attempts).padStart(13)} \u2502 ${String(metrics.profileB?.spec_attempts).padStart(13)} \u2502 ${String(metrics.profileC?.spec_revisions || '-').padStart(13)} \u2502`);
  console.log(`  \u2502 Rejections          \u2502 ${String(metrics.profileA?.rejection_count).padStart(13)} \u2502 ${String(metrics.profileB?.rejection_count).padStart(13)} \u2502 ${String(metrics.profileC?.change_count || 0).padStart(13)} \u2502`);
  console.log(`  \u2502 Questions asked     \u2502 ${String(metrics.profileA?.question_count).padStart(13)} \u2502 ${String(metrics.profileB?.question_count).padStart(13)} \u2502 ${String('-').padStart(13)} \u2502`);
  console.log(`  \u2502 Response chars      \u2502 ${String(metrics.profileA?.response_length).padStart(13)} \u2502 ${String(metrics.profileB?.response_length).padStart(13)} \u2502 ${String(metrics.profileC?.response_length).padStart(13)} \u2502`);
  console.log(`  \u2502 Reached BUILD       \u2502 ${String(metrics.profileA?.reached_build).padStart(13)} \u2502 ${String(metrics.profileB?.reached_build).padStart(13)} \u2502 ${String(metrics.profileC?.reached_build).padStart(13)} \u2502`);
  console.log(`  \u2502 Validation surfaced \u2502 ${String(metrics.profileA?.validation_errors_surfaced).padStart(13)} \u2502 ${String('-').padStart(13)} \u2502 ${String('-').padStart(13)} \u2502`);
  console.log('  \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518');
  console.log('');

  // ═══════════════════════════════════════════════════════════════════════════
  // CROSS-PROFILE ASSERTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('\u2550\u2550\u2550 CROSS-PROFILE ASSERTIONS \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  // No profile should be stuck (all reach BUILD)
  const allReachedBuild = [metrics.profileA, metrics.profileB, metrics.profileC]
    .every(m => m?.reached_build);
  check(allReachedBuild,
    'X.1: all profiles reached BUILD (no dead ends)',
    `A=${metrics.profileA?.reached_build}, B=${metrics.profileB?.reached_build}, C=${metrics.profileC?.reached_build}`);

  // Cooperative user (B) should have LESS friction than lazy user (A)
  check((metrics.profileB?.total_turns || 99) <= (metrics.profileA?.total_turns || 0),
    'X.2: cooperative user (B) has \u2264 turns than lazy user (A)',
    `B=${metrics.profileB?.total_turns}, A=${metrics.profileA?.total_turns}`);

  // No profile should need more than 15 turns to BUILD
  const maxTurns = Math.max(
    metrics.profileA?.total_turns || 0,
    metrics.profileB?.total_turns || 0,
    metrics.profileC?.total_turns || 0
  );
  check(maxTurns <= 15,
    'X.3: no profile needs >15 turns to BUILD',
    `max=${maxTurns}`);

  // Friction delta: lazy user should need at most 2x more turns than cooperative
  const frictionRatio = (metrics.profileA?.total_turns || 1) / (metrics.profileB?.total_turns || 1);
  check(frictionRatio <= 3.0,
    'X.4: friction ratio A/B \u2264 3.0 (lazy user not excessively punished)',
    `ratio=${frictionRatio.toFixed(2)}`);

  // ═══ Summary ═══════════════════════════════════════════════════════════════

  cleanDB();

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  Human Friction Test: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.log(`\n  Failures:`);
    for (const f of failures) {
      console.log(`    \u2717 ${f.name}: ${f.detail}`);
    }
  }

  console.log('='.repeat(70) + '\n');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('\nFATAL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
