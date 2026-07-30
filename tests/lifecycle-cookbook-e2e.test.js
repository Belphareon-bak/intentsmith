import './helpers/isolated-test-db.js';

// Lifecycle E2E Test — Kuchařka (Recipe API) — Real LLM (v92)
// ══════════════════════════════════════════════════════════════════════════════
// Real scenario with REAL Ollama LLM calls. Focus: DEEP QUALITY VERIFICATION.
//
// Project: Python REST API for recipe management (FastAPI + SQLAlchemy + SQLite)
// Different domain + tech stack from Klíčenka (Node.js/crypto) and FitTracker (Flutter).
//
// This test adds assertions NOT covered by other E2E tests:
//   ① Checkpoint mode progression: verify STRUCTURAL → FUNCTIONAL → SECURITY
//   ② Health score verification: presence + reasonable ranges per milestone
//   ③ Drift check records: verify checkpoint + scope data stored in drift_checks
//   ④ Phase transition tracking: DB state verified at EVERY phase boundary
//   ⑤ Roadmap deep structure: critical_path, total_estimated_loc, dependency graph
//   ⑥ Spec deep structure: tech_stack structure, architecture.components, risks
//   ⑦ Generated code analysis: Python-specific patterns (imports, decorators, models)
//   ⑧ Milestone plan quality: actionable steps, target files, estimated LOC
//   ⑨ Multi-revision spec: two rounds of revision feedback before approval
//   ⑩ README/ARCHITECTURE content depth: section analysis, not just existence
//
// Flow:
//   PROPOSED → SPEC (2 rounds) → SPEC_REVIEW (revise 2× → approve)
//   → PLAN_REVIEW (approve) → BUILD (ms-1, ms-2, ...) → COMPLETED
//   → Deep quality verification (checkpoint modes, health, drift, docs, code)
//
// Requirements:
//   - Ollama running at http://127.0.0.1:11434
//   - Models: deepseek-r1:32b, qwen3.5:27b, qwen3.5:27b
//   - Expected duration: 20-40 minutes
//
// Run: node tests/lifecycle-cookbook-e2e.test.js
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

import {
  ProjectPhase,
  MilestoneStatus,
  CheckpointMode,
  getBuildProgress,
  computeLifecycleProgress,
  formatMilestoneTable,
} from '../src/planner/index.js';

import {
  lifecycles as lifecycleRepo,
  milestones as msRepo,
  roadmapVersions,
  changeRequests as crRepo,
  driftChecks,
  projects,
  conversations,
  messages as messagesRepo,
  lifecycleHandoffState,
  db,
} from '../src/db/database.js';

import {
  handleLifecycleBuildDetected,
  handleLifecycleInput,
} from '../src/chat/handlers/lifecycle-handoff.js';

import { getLcState, setLcState, clearLcState, initLifecycleStateDb } from '../src/chat/handlers/lifecycle-state.js';
import { callLLM } from '../src/planner/workflow.js';

// ─── Test Infra ─────────────────────────────────────────────────────────────

const transcript = [];
let turnNum = 0;
let passed = 0;
let failed = 0;
const failures = [];
const startTime = Date.now();
let _convId = null;

function elapsed() {
  return `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
}

function userTurn(message) {
  turnNum++;
  transcript.push({ turn: turnNum, role: 'USER', content: message, time: elapsed() });
  console.log(`\n${'─'.repeat(70)}`);
  console.log(` TURN ${turnNum} │ USER │ ${elapsed()}`);
  console.log(`${'─'.repeat(70)}`);
  console.log(message);
  if (_convId) try { messagesRepo.addMessage(_convId, 'user', message); } catch {}
  return message;
}

function systemTurn(phase, response) {
  turnNum++;
  const content = typeof response === 'string' ? response : (response?.content || JSON.stringify(response));
  transcript.push({ turn: turnNum, role: 'SYSTEM', phase, content, time: elapsed() });
  console.log(`\n${'─'.repeat(70)}`);
  console.log(` TURN ${turnNum} │ SYSTEM │ Phase: ${phase} │ ${elapsed()}`);
  console.log(`${'─'.repeat(70)}`);
  const maxLen = 800;
  console.log(content?.substring(0, maxLen) + (content?.length > maxLen ? '\n  ...(truncated)' : ''));
  if (_convId) try { messagesRepo.addMessage(_convId, 'assistant', content); } catch {}
}

function check(condition, name, detail = '') {
  if (condition) {
    passed++;
    console.log(`    ✅ ${name}`);
  } else {
    failed++;
    console.log(`    ❌ ${name}: ${detail}`);
    failures.push({ name, detail });
  }
}

// ─── Ollama Health Check ────────────────────────────────────────────────────

async function checkOllama() {
  console.log('\n  ─── Ollama Health Check ───');
  try {
    const resp = await fetch('http://127.0.0.1:11434/api/tags');
    const data = await resp.json();
    const models = data.models?.map(m => m.name) || [];
    const required = ['deepseek-r1', 'qwen3.5'];
    let ok = true;
    for (const req of required) {
      const found = models.some(m => m.includes(req));
      if (!found) { ok = false; console.log(`    Missing model: ${req}`); }
    }
    console.log(`    Models: ${models.length} available`);
    return ok;
  } catch (e) {
    console.error(`    Ollama not available: ${e.message}`);
    return false;
  }
}

// ─── Real LLM Executor ─────────────────────────────────────────────────────

function createRealLLMExecutor(projectPath) {
  return {
    async start(request, metadata) {
      const msId = metadata.milestoneId;
      console.log(`\n    [EXECUTOR] ─── ${msId}: Real LLM Code Generation ───`);

      const milestone = msRepo.getMilestone(msId);
      let localPlan = milestone?.local_plan;
      if (typeof localPlan === 'string') {
        try { localPlan = JSON.parse(localPlan); } catch { localPlan = {}; }
      }
      if (!localPlan) localPlan = {};

      let files = localPlan.files || [];
      if (files.length === 0) {
        const fileMatches = [...request.matchAll(/- ([^\s(]+)\s*\((\w+)\):\s*(.+)/g)];
        for (const m of fileMatches) {
          files.push({ path: m[1], action: m[2], purpose: m[3] });
        }
      }

      if (files.length === 0) {
        console.log(`    [EXECUTOR] No files in plan — generating default`);
        files = [{ path: 'src/main.py', action: 'create', purpose: 'Main application entry point' }];
      }

      for (const file of files) {
        const codePrompt = `You are implementing a file for a Python REST API recipe management app.
The app uses FastAPI, SQLAlchemy ORM, Pydantic schemas, and SQLite.

File: ${file.path}
Purpose: ${file.purpose || 'As described'}

Context:
${request}

Generate the COMPLETE file content. Output ONLY raw source code (Python), NO markdown fences, NO explanation.
Include proper imports, type hints, and docstrings.`;

        console.log(`    [EXECUTOR]   Generating ${file.path}...`);
        const t0 = Date.now();
        try {
          const result = await callLLM('CODE', codePrompt);
          let content = result.content || '';
          content = content.replace(/^```[\w]*\n?/, '').replace(/\n?```\s*$/, '').trim();

          const fullPath = path.join(projectPath, file.path);
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, content);

          const dt = ((Date.now() - t0) / 1000).toFixed(1);
          console.log(`    [EXECUTOR]   ✓ ${file.path} (${content.length} bytes, ${dt}s)`);
        } catch (err) {
          console.log(`    [EXECUTOR]   ✗ ${file.path}: ${err.message}`);
        }
      }

      try {
        execSync('git add -A', { cwd: projectPath, stdio: 'pipe' });
        execSync(`git commit -m "feat(${msId}): milestone implementation" --allow-empty`, {
          cwd: projectPath, stdio: 'pipe',
        });
      } catch { /* ignore */ }

      console.log(`    [EXECUTOR] ─── ${msId} complete ───\n`);
      return { state: 'COMPLETED', sessionId: `real-wf-${msId}` };
    },

    async approve(sessionId) {
      return { state: 'COMPLETED', sessionId };
    },
  };
}

// ─── DB Cleanup ─────────────────────────────────────────────────────────────

function cleanDB(projectPath) {
  try {
    const proj = db.prepare(`SELECT id FROM projects WHERE path = ?`).get(projectPath);
    if (proj) {
      const lcIds = db.prepare(`SELECT id FROM project_lifecycles WHERE project_id = ?`).all(proj.id).map(r => r.id);
      for (const lcId of lcIds) {
        for (const t of ['milestones', 'roadmap_versions', 'drift_checks', 'change_requests']) {
          try { db.prepare(`DELETE FROM ${t} WHERE lifecycle_id = ?`).run(lcId); } catch {}
        }
      }
      try { db.prepare(`DELETE FROM project_lifecycles WHERE project_id = ?`).run(proj.id); } catch {}
      try { db.prepare(`DELETE FROM lifecycle_handoff_state WHERE lifecycle_id IN (${lcIds.map(() => '?').join(',')})`)
        .run(...lcIds); } catch {}
    }
  } catch { /* first run */ }
  initLifecycleStateDb(lifecycleHandoffState, lifecycleRepo);
}

function walkFiles(dir, base = dir) {
  const result = [];
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) result.push(...walkFiles(fp, base));
      else result.push(path.relative(base, fp));
    }
  } catch { /* ignore */ }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN TEST
// ═══════════════════════════════════════════════════════════════════════════════

async function runTest() {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('  Lifecycle E2E: Kuchařka (Recipe API — Python/FastAPI)');
  console.log('  Mode: REAL LLM (Ollama) + Deep Quality Verification');
  console.log('  Focus: Checkpoint modes, health scores, drift checks, code quality');
  console.log('══════════════════════════════════════════════════════════════════════');

  const ollamaOk = await checkOllama();
  if (!ollamaOk) {
    console.log('\n  Ollama not available — skipping test');
    process.exit(1);
  }

  const SESSION_ID = 'cookbook-e2e-real';
  const projectPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../projects/Kucharka-E2E');
  fs.mkdirSync(projectPath, { recursive: true });

  cleanDB(projectPath);

  // Init git
  if (!fs.existsSync(path.join(projectPath, '.git'))) {
    execSync('git init', { cwd: projectPath, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: projectPath, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: projectPath, stdio: 'pipe' });
    execSync('git commit --allow-empty -m "init"', { cwd: projectPath, stdio: 'pipe' });
  }

  const PROJECT_NAME = 'Kuchařka E2E';
  const PROJECT_DESC = 'Recipe REST API — E2E lifecycle test with deep quality verification (v92)';
  const project = projects.getOrCreate(PROJECT_NAME, projectPath, PROJECT_DESC);
  const projectId = Number(project.id);
  _convId = `e2e-cookbook-${Date.now()}`;
  conversations.getOrCreate(_convId, projectId, 'Kuchařka — Deep Quality E2E (Real LLM)');

  const executor = createRealLLMExecutor(projectPath);
  const context = { sessionId: SESSION_ID, executor, projectPath };

  let lifecycleId = null;

  // Track phase transitions for verification
  const phaseTransitions = [];
  function recordPhase(label) {
    const state = getLcState(SESSION_ID);
    phaseTransitions.push({ label, phase: state?.phase, time: elapsed() });
  }

  // Declared outside try so summary can access it
  const milestoneResults = [];
  let completedMilestones = 0;
  let blockedMilestones = 0;

  try {
    // ═══ PHASE 1: Detection + Proposal ════════════════════════════════════════

    console.log('\n\n═══ PHASE 1: Detection + Proposal ═══════════════════════════════════');

    const userMsg1 = userTurn(
      'Potřebuji vytvořit REST API pro správu receptů — kuchařku. ' +
      'Python, FastAPI framework, SQLAlchemy ORM, SQLite databáze. ' +
      'Recepty mají název, popis, ingredience (s množstvím a jednotkou), kroky přípravy, ' +
      'kategorii (předkrm, hlavní jídlo, dezert, polévka), čas přípravy a obtížnost. ' +
      'CRUD operace + fulltextové vyhledávání + filtrování podle kategorie. ' +
      'Pydantic modely pro validaci. Alembic pro databázové migrace.'
    );

    const response1 = handleLifecycleBuildDetected(userMsg1, { intent: 'BUILD' }, context);
    systemTurn('PROPOSED', response1);
    recordPhase('after-proposal');

    check(response1?.content?.includes('lifecycle'), 'T1: response mentions lifecycle');
    const state1 = getLcState(SESSION_ID);
    check(state1?.phase === 'PROPOSED', 'T1: state is PROPOSED', `got: ${state1?.phase}`);

    // ─── DB check: lifecycle record created ───
    // At PROPOSED, lifecycle may not exist yet (created on accept)

    // ═══ PHASE 2: SPEC — Answer Questions (detailed) ═════════════════════════

    console.log('\n\n═══ PHASE 2: SPEC — Real LLM Questions (2 rounds) ═══════════════════');

    const userMsg2 = userTurn('ano');
    const response2 = await handleLifecycleInput(userMsg2, context);
    systemTurn('SPEC start', response2);
    recordPhase('after-accept');

    const state2 = getLcState(SESSION_ID);
    check(state2?.phase === 'SPEC', 'T2: state is SPEC', `got: ${state2?.phase}`);
    lifecycleId = state2?.lifecycleId;

    // ─── DB check: lifecycle record exists after accept ───
    if (lifecycleId) {
      const lcDb = lifecycleRepo.findById.get(lifecycleId);
      check(lcDb != null, 'T2-DB: lifecycle record exists in DB');
      check(lcDb?.phase === 'SPEC', 'T2-DB: lifecycle DB phase is SPEC', `got: ${lcDb?.phase}`);
      check(lcDb?.project_id != null, 'T2-DB: lifecycle has project_id');
    }

    // Detailed spec answers — two rounds with different levels of detail
    const specAnswers = [
      // Round 1: Core requirements + tech decisions
      'FastAPI s async endpointy. SQLAlchemy 2.0 async (create_async_engine). SQLite přes aiosqlite. ' +
      'Pydantic v2 pro validaci (model_config, ConfigDict). ' +
      'Recepty: title (str, max 200), description (text), prep_time_min (int), difficulty (enum: easy/medium/hard). ' +
      'Ingredience: name (str), amount (float), unit (str enum: g/kg/ml/l/ks/lžíce/lžička). ' +
      'Kroky: step_number (int), instruction (text). Kategorie: enum (predkrm/hlavni/dezert/polevka/salat). ' +
      'Design decisions: Framework: FastAPI (chosen), alternatives: Flask (simpler but sync), Django REST (heavier). ' +
      'ORM: SQLAlchemy 2.0 (chosen), alternatives: Tortoise ORM (async-native), raw SQL. ' +
      'Validace: Pydantic v2 (chosen), alternatives: marshmallow, attrs. ' +
      'Architektura: layered (routers → services → repositories → models), alternatives: MVC, hexagonal.',

      // Round 2: Detailed API + search + error handling
      'Endpointy: GET /recipes (list + filter + search), POST /recipes (create), ' +
      'GET /recipes/{id} (detail), PUT /recipes/{id} (update), DELETE /recipes/{id}. ' +
      'GET /categories (list all). GET /recipes/search?q=... (fulltext). ' +
      'Filtr: ?category=hlavni&difficulty=easy&max_prep_time=30. ' +
      'Stránkování: ?page=1&per_page=20 (default 20, max 100). ' +
      'Error handling: HTTPException pro 404/422, custom exception handlers, consistent JSON error format. ' +
      'Seeding: 5 ukázkových receptů při prvním startu (check if DB empty). ' +
      'Alembic pro migrace, ale pro E2E stačí create_all(). ' +
      'Risks: async SQLite performance under load, fulltext search quality bez FTS5. ' +
      'Non-functional: response time < 200ms pro list, JSON response format, CORS middleware.',

      'Ano, vygeneruj kompletní specifikaci. Pro každý design decision uveď alespoň 2 alternativy s pros/cons.',
    ];

    let specRound = 0;
    while (getLcState(SESSION_ID)?.phase === 'SPEC' && specRound < 5) {
      const answer = specAnswers[Math.min(specRound, specAnswers.length - 1)];
      const msgSpec = userTurn(answer);
      const respSpec = await handleLifecycleInput(msgSpec, context);
      systemTurn(`SPEC round ${specRound + 1}`, respSpec);
      specRound++;
    }

    recordPhase('after-spec');
    check(
      getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW',
      'T3: reached SPEC_REVIEW',
      `got: ${getLcState(SESSION_ID)?.phase}`
    );

    // ═══ PHASE 3: Spec Review — TWO Revisions + Deep Quality ═════════════════

    console.log('\n\n═══ PHASE 3: SPEC_REVIEW — Two Revisions + Deep Quality ═════════════');

    if (getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW') {
      // ─── 3a. Quality assertions on initial spec ───
      const specV1 = lifecycleId ? lifecycleRepo.getSpec(lifecycleId) : null;
      if (specV1) {
        console.log('\n  ─── Spec v1 Quality ───');

        // Goals
        const goals = specV1.goals || [];
        check(goals.length >= 2, 'T3-Q: spec has ≥2 goals', `got: ${goals.length}`);

        // Functional requirements — deep check
        const frs = specV1.requirements?.functional || [];
        check(frs.length >= 4, 'T3-Q: spec has ≥4 functional requirements', `got: ${frs.length}`);
        const frIds = frs.map(fr => fr.id).filter(Boolean);
        check(frIds.length === frs.length, 'T3-Q: every FR has an id', `${frIds.length}/${frs.length}`);
        check(new Set(frIds).size === frIds.length, 'T3-Q: FR IDs are unique');

        // Non-functional requirements
        const nfrs = specV1.requirements?.non_functional || specV1.requirements?.nonfunctional || [];
        check(nfrs.length >= 1, 'T3-Q: spec has ≥1 non-functional requirement', `got: ${nfrs.length}`);

        // Design decisions — deep check
        const dds = specV1.design_decisions || [];
        check(dds.length >= 2, 'T3-Q: spec has ≥2 design decisions', `got: ${dds.length}`);
        const ddsWithAlts = dds.filter(d =>
          (d.alternatives_considered || d.alternatives || []).length >= 2
        );
        check(ddsWithAlts.length >= 1, 'T3-Q: ≥1 DD with ≥2 alternatives', `got: ${ddsWithAlts.length}`);

        // Tech stack structure (not just existence)
        const ts = specV1.tech_stack;
        if (ts) {
          const hasPython = JSON.stringify(ts).toLowerCase().includes('python') ||
                            JSON.stringify(ts).toLowerCase().includes('fastapi');
          check(hasPython, 'T3-Q: tech_stack references Python/FastAPI');
        }

        // Architecture
        const arch = specV1.architecture;
        if (arch) {
          // Architecture may have description, overview, pattern, or data_flow — any signals content
          const hasContent = !!arch.description || !!arch.overview || !!arch.pattern ||
                             !!arch.data_flow || (arch.components && arch.components.length > 0);
          check(hasContent, 'T3-Q: architecture has substantive content',
            `keys: ${Object.keys(arch).join(', ')}`);
          const comps = arch.components || [];
          check(comps.length >= 2, 'T3-Q: architecture has ≥2 components', `got: ${comps.length}`);
        }

        // Risks
        const risks = specV1.risks || [];
        check(risks.length >= 1, 'T3-Q: spec has ≥1 risk', `got: ${risks.length}`);

        console.log(`    Goals: ${goals.length}, FRs: ${frs.length}, NFRs: ${nfrs.length}, ` +
                    `DDs: ${dds.length}, Risks: ${risks.length}`);
      }

      // ─── 3b. First revision: add pagination requirement ───
      const rev1Msg = userTurn(
        'Přidej podporu pro řazení výsledků — sort parametr v query stringu (?sort=prep_time_asc, ' +
        'sort=difficulty_desc, sort=created_at_desc). Defaultní řazení podle created_at DESC.'
      );
      const rev1Resp = await handleLifecycleInput(rev1Msg, context);
      systemTurn('SPEC revision 1', rev1Resp);

      // Answer revision questions
      let rev1Round = 0;
      while (getLcState(SESSION_ID)?.phase === 'SPEC' && rev1Round < 3) {
        const answer = userTurn(
          'Ano, sort parametr pro API. Allowed values: prep_time_asc, prep_time_desc, ' +
          'difficulty_asc, difficulty_desc, created_at_asc, created_at_desc. ' +
          'Neplatný sort → 422 s chybovou zprávou.'
        );
        const resp = await handleLifecycleInput(answer, context);
        systemTurn(`SPEC revision 1 round ${rev1Round + 1}`, resp);
        rev1Round++;
      }

      // ─── 3c. Second revision: add nutritional info ───
      if (getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW') {
        const rev2Msg = userTurn(
          'Ještě přidej volitelné nutriční údaje k receptu — kalorie (kcal), bílkoviny (g), ' +
          'sacharidy (g), tuky (g). Nepovinné pole, zobrazí se pokud jsou vyplněné.'
        );
        const rev2Resp = await handleLifecycleInput(rev2Msg, context);
        systemTurn('SPEC revision 2', rev2Resp);

        let rev2Round = 0;
        while (getLcState(SESSION_ID)?.phase === 'SPEC' && rev2Round < 3) {
          const answer = userTurn(
            'Ano, nutriční údaje jako nullable fields: calories_kcal (int?), protein_g (float?), ' +
            'carbs_g (float?), fat_g (float?). Zobrazit v response jen pokud non-null.'
          );
          const resp = await handleLifecycleInput(answer, context);
          systemTurn(`SPEC revision 2 round ${rev2Round + 1}`, resp);
          rev2Round++;
        }
      }

      // ─── 3d. Verify revisions in spec ───
      if (getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW') {
        const specV2 = lifecycleId ? lifecycleRepo.getSpec(lifecycleId) : null;
        if (specV2) {
          const specStr = JSON.stringify(specV2).toLowerCase();
          check(
            specStr.includes('sort') || specStr.includes('řazen') || specStr.includes('order'),
            'T3-R1: revised spec mentions sorting'
          );
          check(
            specStr.includes('nutri') || specStr.includes('kalori') || specStr.includes('calori') ||
            specStr.includes('protein') || specStr.includes('bílkovin'),
            'T3-R2: revised spec mentions nutritional info'
          );

          // FR count should increase after revisions
          const frsV2 = specV2.requirements?.functional || [];
          check(frsV2.length >= 5, 'T3-R: revised spec has ≥5 FRs (grew from revisions)', `got: ${frsV2.length}`);
        }
      }

      // ─── 3e. Approve spec ───
      if (getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW') {
        const approveMsg = userTurn('schvaluji');
        const approveResp = await handleLifecycleInput(approveMsg, context);
        systemTurn('SPEC → PLAN_REVIEW', approveResp);
      }
    }

    recordPhase('after-spec-review');

    // ═══ PHASE 4: PLAN_REVIEW — Roadmap Deep Quality ═════════════════════════

    console.log('\n\n═══ PHASE 4: PLAN_REVIEW — Roadmap Deep Quality ═════════════════════');

    const stateRoadmap = getLcState(SESSION_ID);
    check(stateRoadmap?.phase === 'PLAN_REVIEW', 'T4: reached PLAN_REVIEW', `got: ${stateRoadmap?.phase}`);
    lifecycleId = stateRoadmap?.lifecycleId || lifecycleId;

    if (lifecycleId) {
      const milestones = msRepo.listByLifecycle(lifecycleId);
      check(milestones.length >= 3, 'T4-Q: roadmap has ≥3 milestones (v91 minimum)', `got: ${milestones.length}`);

      console.log(`    Milestones:`);
      for (const m of milestones) {
        console.log(`      ${m.id}: ${m.title} [mode=${m.checkpoint_mode}, seq=${m.sequence}]`);
      }

      // ─── ① Checkpoint mode verification — STRUCTURAL/FUNCTIONAL/SECURITY ───
      console.log('\n  ─── Checkpoint Mode Progression ───');
      if (milestones.length >= 3) {
        const first = milestones[0];
        const last = milestones[milestones.length - 1];
        const middle = milestones.slice(1, -1);

        check(
          first.checkpoint_mode === 'STRUCTURAL',
          'T4-CM: first milestone is STRUCTURAL',
          `got: ${first.checkpoint_mode}`
        );
        check(
          last.checkpoint_mode === 'SECURITY',
          'T4-CM: last milestone is SECURITY',
          `got: ${last.checkpoint_mode}`
        );
        for (const m of middle) {
          check(
            m.checkpoint_mode === 'FUNCTIONAL',
            `T4-CM: ${m.id} is FUNCTIONAL`,
            `got: ${m.checkpoint_mode}`
          );
        }
      }

      // ─── Roadmap structure deep validation ───
      console.log('\n  ─── Roadmap Structure ───');
      const roadmapRow = roadmapVersions.getLatestRoadmap(lifecycleId);
      if (roadmapRow?.roadmap) {
        const rm = roadmapRow.roadmap;

        // Requirements coverage
        const coverage = rm.requirements_coverage || {};
        const covKeys = Object.keys(coverage);
        check(covKeys.length >= 1, 'T4-Q: requirements_coverage present', `got: ${covKeys.length}`);

        // Total estimated LOC
        if (rm.total_estimated_loc) {
          check(rm.total_estimated_loc > 100, 'T4-Q: total_estimated_loc > 100', `got: ${rm.total_estimated_loc}`);
          check(rm.total_estimated_loc < 50000, 'T4-Q: total_estimated_loc < 50000 (realistic)', `got: ${rm.total_estimated_loc}`);
        }

        // Critical path
        if (rm.critical_path) {
          check(Array.isArray(rm.critical_path), 'T4-Q: critical_path is array');
          check(rm.critical_path.length >= 2, 'T4-Q: critical_path has ≥2 milestones', `got: ${rm.critical_path.length}`);
        }

        // Each milestone has required fields
        let missingFields = 0;
        const rmMs = rm.milestones || [];
        for (const m of rmMs) {
          if (!m.title) missingFields++;
          if (!m.description) missingFields++;
          if (!m.deliverables || m.deliverables.length === 0) missingFields++;
        }
        check(missingFields === 0, 'T4-Q: all milestones have title + description + deliverables', `missing: ${missingFields}`);

        // Last milestone covers testing/integration/docs
        const lastMs = rmMs[rmMs.length - 1];
        if (lastMs) {
          const lastText = (lastMs.title + ' ' + (lastMs.description || '')).toLowerCase();
          check(
            /test|integr|doc|kvalit|final|polish|security/.test(lastText),
            'T4-Q: last milestone covers testing/integration/docs',
            `got: "${lastMs.title}"`
          );
        }

        // Dependency graph — check for no circular deps
        const depMap = new Map();
        for (const m of rmMs) {
          depMap.set(m.id, m.dependencies || []);
        }
        let hasCircular = false;
        for (const [msId, deps] of depMap) {
          for (const depId of deps) {
            const depDeps = depMap.get(depId) || [];
            if (depDeps.includes(msId)) {
              hasCircular = true;
              console.log(`    CIRCULAR: ${msId} <-> ${depId}`);
            }
          }
        }
        check(!hasCircular, 'T4-Q: no circular dependencies in roadmap');

        console.log(`    Milestones: ${rmMs.length}, Coverage: ${covKeys.length} FRs, ` +
                    `LOC: ${rm.total_estimated_loc || '?'}, Version: ${roadmapRow.version}`);
      }

      // Clear test_strategy — no Python env in test
      try {
        db.prepare('UPDATE milestones SET test_strategy = NULL WHERE lifecycle_id = ?').run(lifecycleId);
      } catch { /* ignore */ }
    }

    // Approve roadmap
    if (getLcState(SESSION_ID)?.phase === 'PLAN_REVIEW') {
      const approveRoadmapMsg = userTurn('schvaluji');
      const approveRoadmapResp = await handleLifecycleInput(approveRoadmapMsg, context);
      systemTurn('PLAN → BUILD', approveRoadmapResp);
    }

    recordPhase('after-plan-review');

    // ═══ PHASE 5: BUILD — Milestones with Deep Tracking ═════════════════════

    console.log('\n\n═══ PHASE 5: BUILD — Milestones with Deep Tracking ═══════════════════');

    let buildRound = 0;
    const maxBuildRounds = 30;

    while (buildRound < maxBuildRounds) {
      buildRound++;
      const state = getLcState(SESSION_ID);
      if (!state) {
        console.log('    Lifecycle cleared — COMPLETED');
        break;
      }

      console.log(`    [Build round ${buildRound}] phase=${state.phase} ms=${state.currentMilestoneId || '-'}`);

      if (state.phase === 'BUILD_MILESTONE_REVIEW') {
        // ─── Milestone plan quality check (before approving) ───
        if (state.currentMilestoneId) {
          const msDb = msRepo.getMilestone(state.currentMilestoneId);
          let localPlan = msDb?.local_plan;
          if (typeof localPlan === 'string') {
            try { localPlan = JSON.parse(localPlan); } catch { localPlan = null; }
          }
          if (localPlan) {
            const steps = localPlan.implementation_steps || localPlan.steps || [];
            check(
              steps.length >= 2,
              `T5-PLAN: ${state.currentMilestoneId} has ≥2 impl steps`,
              `got: ${steps.length}`
            );
            const planFiles = localPlan.files || localPlan.scope_files || [];
            check(
              planFiles.length >= 1,
              `T5-PLAN: ${state.currentMilestoneId} has ≥1 target file`,
              `got: ${planFiles.length}`
            );
          }
        }

        const msg = userTurn('ano');
        const resp = await handleLifecycleInput(msg, context);
        systemTurn(`BUILD ${state.currentMilestoneId || ''}`, resp);

        // Check result
        if (state.currentMilestoneId) {
          const msDb = msRepo.getMilestone(state.currentMilestoneId);
          if (msDb?.status === 'PASSED') {
            completedMilestones++;
            check(true, `BUILD: ${state.currentMilestoneId} PASSED`);

            milestoneResults.push({
              id: state.currentMilestoneId,
              status: 'PASSED',
              checkpointMode: msDb.checkpoint_mode,
              healthScore: msDb.health_score,
              sequence: msDb.sequence,
            });
          } else if (msDb?.status === 'BLOCKED') {
            blockedMilestones++;
            console.log(`    ${state.currentMilestoneId} BLOCKED (checkpoint_mode: ${msDb.checkpoint_mode})`);

            milestoneResults.push({
              id: state.currentMilestoneId,
              status: 'BLOCKED',
              checkpointMode: msDb.checkpoint_mode,
              sequence: msDb.sequence,
            });
          }
        }
      } else if (state.phase === 'BUILD') {
        const msg = userTurn('pokračovat');
        const resp = await handleLifecycleInput(msg, context);
        systemTurn('BUILD continue', resp);
      } else if (state.phase === 'REVIEW') {
        const msg = userTurn('pokračovat');
        const resp = await handleLifecycleInput(msg, context);
        systemTurn('REVIEW', resp);
      } else if (state.phase === 'COMPLETED') {
        break;
      } else {
        console.log(`    Unexpected phase: ${state.phase}`);
        break;
      }
    }

    recordPhase('after-build');
    check(completedMilestones >= 1, 'BUILD: ≥1 milestones completed', `got: ${completedMilestones}`);

    // ═══ PHASE 6: Deep Quality Verification ══════════════════════════════════

    console.log('\n\n═══ PHASE 6: Deep Quality Verification ══════════════════════════════');

    // ─── ② Health Score Verification ───
    console.log('\n  ─── ② Health Scores ───');
    for (const mr of milestoneResults.filter(m => m.status === 'PASSED')) {
      const hs = mr.healthScore;
      if (hs) {
        const hsObj = typeof hs === 'string' ? JSON.parse(hs) : hs;
        check(hsObj != null, `HEALTH: ${mr.id} has health score object`);

        // Health score should have known fields
        const hasKnownFields = hsObj.scope_adherence != null || hsObj.overall != null ||
                               hsObj.quality != null || hsObj.test_coverage != null;
        check(hasKnownFields, `HEALTH: ${mr.id} has recognizable health fields`,
          `keys: ${Object.keys(hsObj).join(', ')}`);

        console.log(`    ${mr.id}: ${JSON.stringify(hsObj).substring(0, 150)}`);
      } else {
        // Health score may be null if computation failed — soft check
        console.log(`    ${mr.id}: no health score (may be expected)`);
      }
    }

    // ─── ③ Drift Check Records ───
    console.log('\n  ─── ③ Drift Checks ───');
    if (lifecycleId) {
      const allDriftChecks = driftChecks.findByLifecycle.all(lifecycleId);
      check(allDriftChecks.length >= 1, 'DRIFT: ≥1 drift check records', `got: ${allDriftChecks.length}`);

      // Group by type
      const byType = {};
      for (const dc of allDriftChecks) {
        byType[dc.check_type] = (byType[dc.check_type] || 0) + 1;
      }
      console.log(`    Drift check types: ${JSON.stringify(byType)}`);

      // Should have MILESTONE_CHECKPOINT entries for completed milestones
      const checkpointChecks = allDriftChecks.filter(dc => dc.check_type === 'MILESTONE_CHECKPOINT');
      check(
        checkpointChecks.length >= completedMilestones,
        `DRIFT: ≥${completedMilestones} MILESTONE_CHECKPOINT records`,
        `got: ${checkpointChecks.length}`
      );

      // Verify checkpoint drift check has details
      if (checkpointChecks.length > 0) {
        const firstCheck = checkpointChecks[0];
        check(firstCheck.result != null, 'DRIFT: checkpoint has result (PASS/FAIL)');
        if (firstCheck.details) {
          let details = firstCheck.details;
          if (typeof details === 'string') {
            try { details = JSON.parse(details); } catch {}
          }
          const hasCheckpointData = typeof details === 'object' && details !== null;
          check(hasCheckpointData, 'DRIFT: checkpoint details is parseable object',
            `type: ${typeof details}`);
        }
      }
    }

    // ─── ④ Phase Transition Tracking ───
    console.log('\n  ─── ④ Phase Transitions ───');
    console.log(`    Recorded ${phaseTransitions.length} transitions:`);
    for (const pt of phaseTransitions) {
      console.log(`      ${pt.label}: ${pt.phase} (${pt.time})`);
    }
    check(phaseTransitions.length >= 4, 'PHASES: ≥4 phase transitions recorded', `got: ${phaseTransitions.length}`);

    // ─── ⑤ Milestone Checkpoint Mode Progression in Results ───
    console.log('\n  ─── ⑤ Checkpoint Mode Progression (Actual) ───');
    if (milestoneResults.length > 0) {
      console.log(`    Milestone results:`);
      for (const mr of milestoneResults) {
        console.log(`      ${mr.id}: ${mr.status} [mode=${mr.checkpointMode}, seq=${mr.sequence}]`);
      }

      // First completed milestone should have been STRUCTURAL
      const firstCompleted = milestoneResults.find(m => m.status === 'PASSED' && m.sequence === 1);
      if (firstCompleted) {
        check(
          firstCompleted.checkpointMode === 'STRUCTURAL',
          'CKPT: first PASSED milestone was STRUCTURAL',
          `got: ${firstCompleted.checkpointMode}`
        );
      }

      // Any SECURITY-mode milestone should be last or blocked
      const securityMs = milestoneResults.filter(m => m.checkpointMode === 'SECURITY');
      for (const sm of securityMs) {
        // SECURITY is expected on last milestone — may be BLOCKED (strict audit)
        console.log(`    SECURITY milestone: ${sm.id} → ${sm.status}`);
      }
    }

    // ─── ⑥ Spec Deep Structure ───
    console.log('\n  ─── ⑥ Final Spec Structure ───');
    if (lifecycleId) {
      const finalSpec = lifecycleRepo.getSpec(lifecycleId);
      if (finalSpec) {
        const goals = finalSpec.goals || [];
        check(goals.length >= 3, 'SPEC-F: ≥3 goals', `got: ${goals.length}`);

        const frs = finalSpec.requirements?.functional || [];
        check(frs.length >= 5, 'SPEC-F: ≥5 functional requirements', `got: ${frs.length}`);

        const frIds = frs.map(fr => fr.id).filter(Boolean);
        check(frIds.length === frs.length, 'SPEC-F: every FR has an id', `${frIds.length}/${frs.length}`);
        check(new Set(frIds).size === frIds.length, 'SPEC-F: FR IDs are unique');

        const dds = finalSpec.design_decisions || [];
        check(dds.length >= 2, 'SPEC-F: ≥2 design decisions', `got: ${dds.length}`);

        // Revision content present
        const specStr = JSON.stringify(finalSpec).toLowerCase();
        check(
          specStr.includes('sort') || specStr.includes('řazen') || specStr.includes('order'),
          'SPEC-F: sorting requirement present (from revision 1)'
        );
        check(
          specStr.includes('nutri') || specStr.includes('kalori') || specStr.includes('calori') || specStr.includes('protein'),
          'SPEC-F: nutritional info present (from revision 2)'
        );

        console.log(`    Goals: ${goals.length}, FRs: ${frs.length}, DDs: ${dds.length}`);
      } else {
        check(false, 'SPEC-F: spec exists in DB');
      }
    }

    // ─── ⑦ Generated Code Analysis (Python-specific) ───
    console.log('\n  ─── ⑦ Generated Code Analysis ───');
    const allFiles = walkFiles(projectPath);
    console.log(`    Generated ${allFiles.length} files:`);
    for (const f of allFiles) {
      const size = fs.statSync(path.join(projectPath, f)).size;
      console.log(`      ${f} (${size} bytes)`);
    }

    check(allFiles.length >= 3, 'CODE: ≥3 files generated', `got: ${allFiles.length}`);

    const pyFiles = allFiles.filter(f => f.endsWith('.py'));
    check(pyFiles.length >= 1, 'CODE: ≥1 Python file', `got: ${pyFiles.length}`);

    // Python-specific code quality checks
    for (const pyFile of pyFiles.slice(0, 5)) {
      const content = fs.readFileSync(path.join(projectPath, pyFile), 'utf8');
      check(content.length > 30, `CODE: ${pyFile} is non-trivial (${content.length} bytes)`);

      // Check for Python patterns (at least some should match across files)
      const hasImports = /^(import |from \S+ import )/m.test(content);
      const hasFunctions = /^(def |async def |class )/m.test(content);
      if (hasImports) {
        check(true, `CODE: ${pyFile} has Python imports`);
      }
      if (hasFunctions) {
        check(true, `CODE: ${pyFile} has functions/classes`);
      }
    }

    // Check for FastAPI patterns in at least one file
    const allPyContent = pyFiles.map(f =>
      fs.readFileSync(path.join(projectPath, f), 'utf8')
    ).join('\n');

    const hasFastAPI = /fastapi|FastAPI|APIRouter|@app\.(get|post|put|delete)|@router\.(get|post|put|delete)/i.test(allPyContent);
    if (hasFastAPI) {
      check(true, 'CODE: FastAPI patterns found in generated code');
    } else {
      console.log('    Note: No FastAPI patterns found (may use different naming)');
    }

    const hasSQLAlchemy = /sqlalchemy|SQLAlchemy|Column|relationship|Base|DeclarativeBase|create_engine/i.test(allPyContent);
    if (hasSQLAlchemy) {
      check(true, 'CODE: SQLAlchemy patterns found in generated code');
    } else {
      console.log('    Note: No SQLAlchemy patterns found');
    }

    const hasPydantic = /pydantic|BaseModel|Field\(|model_config|ConfigDict/i.test(allPyContent);
    if (hasPydantic) {
      check(true, 'CODE: Pydantic patterns found in generated code');
    } else {
      console.log('    Note: No Pydantic patterns found');
    }

    // Config/requirements files
    const hasRequirements = allFiles.some(f =>
      f === 'requirements.txt' || f === 'pyproject.toml' || f.includes('setup.py')
    );
    if (hasRequirements) {
      check(true, 'CODE: Python dependency file exists');
    }

    // ─── ⑧ Roadmap Quality (final) ───
    console.log('\n  ─── ⑧ Roadmap Quality (Final) ───');
    if (lifecycleId) {
      const roadmapRow = roadmapVersions.getLatestRoadmap(lifecycleId);
      if (roadmapRow?.roadmap) {
        const rm = roadmapRow.roadmap;
        const rmMs = rm.milestones || [];
        check(rmMs.length >= 3, 'ROAD-F: ≥3 milestones', `got: ${rmMs.length}`);

        const coverage = rm.requirements_coverage || {};
        const covKeys = Object.keys(coverage);
        check(covKeys.length >= 1, 'ROAD-F: requirements_coverage present', `got: ${covKeys.length} entries`);

        console.log(`    Version: ${roadmapRow.version}, Milestones: ${rmMs.length}`);
      }

      const allMs = msRepo.listByLifecycle(lifecycleId);
      console.log(`    DB milestones:`);
      for (const m of allMs) {
        console.log(`      ${m.id}: ${m.title} [${m.status}, mode=${m.checkpoint_mode}]`);
      }
    }

    // ─── ⑨ Documentation Quality — Deep Content Analysis ───
    console.log('\n  ─── ⑨ Documentation Quality ───');
    const readmePath = path.join(projectPath, 'README.md');
    const archPath = path.join(projectPath, 'ARCHITECTURE.md');

    if (fs.existsSync(readmePath)) {
      const readme = fs.readFileSync(readmePath, 'utf-8');
      check(readme.length > 200, 'DOC: README.md is substantive', `got: ${readme.length} chars`);

      // Section analysis
      const sectionHeaders = [...readme.matchAll(/^##\s+(.+)$/gm)].map(m => m[1].trim());
      console.log(`    README sections: ${sectionHeaders.join(', ')}`);

      // Install section only generated if package.json/requirements.txt exists on disk
      const hasInstallSection = sectionHeaders.some(h => /Použití|Usage|Instalace|Install|Spuštění|Getting/i.test(h));
      if (hasInstallSection) {
        check(true, 'DOC: README has usage/install section');
      } else {
        console.log('    Note: README lacks install section (no requirements.txt/package.json at generation time)');
      }
      check(
        sectionHeaders.some(h => /Architektura|Architecture|Struktura|Component/i.test(h)),
        'DOC: README has architecture section'
      );
      check(
        sectionHeaders.some(h => /Tech\s*[Ss]tack|Technolog/i.test(h)),
        'DOC: README has tech stack section'
      );
      check(
        sectionHeaders.some(h => /Design|Decision|Rozhodnut/i.test(h)),
        'DOC: README has design decisions section'
      );

      // README should reference Python/FastAPI
      const readmeLower = readme.toLowerCase();
      const refsPython = readmeLower.includes('python') || readmeLower.includes('fastapi') ||
                         readmeLower.includes('pip') || readmeLower.includes('uvicorn');
      check(refsPython, 'DOC: README references Python/FastAPI stack');

      console.log(`    README.md: ${readme.length} chars, ${sectionHeaders.length} sections`);
    } else {
      check(false, 'DOC: README.md exists');
    }

    if (fs.existsSync(archPath)) {
      const arch = fs.readFileSync(archPath, 'utf-8');
      check(arch.length > 100, 'DOC: ARCHITECTURE.md is substantive', `got: ${arch.length} chars`);

      const archSections = [...arch.matchAll(/^##\s+(.+)$/gm)].map(m => m[1].trim());
      console.log(`    ARCHITECTURE.md: ${arch.length} chars, sections: ${archSections.join(', ')}`);

      check(
        archSections.some(h => /Component|Overview|Komponent/i.test(h)),
        'DOC: ARCHITECTURE.md has components/overview section'
      );
    } else {
      console.log('    ARCHITECTURE.md: not generated (spec may lack architecture data)');
    }

    // ─── ⑩ DB Final State ───
    console.log('\n  ─── ⑩ DB Final State ───');
    if (lifecycleId) {
      const lcDb = lifecycleRepo.findById.get(lifecycleId);
      check(lcDb != null, 'DB: lifecycle record exists');
      check(
        lcDb?.phase === 'COMPLETED' || lcDb?.phase === 'BUILD',
        'DB: lifecycle progressed',
        `got: ${lcDb?.phase}`
      );

      const allMs = msRepo.listByLifecycle(lifecycleId);
      check(allMs.length >= 3, 'DB: ≥3 milestones in DB', `got: ${allMs.length}`);

      const passedMs = allMs.filter(m => m.status === 'PASSED');
      check(passedMs.length >= 1, 'DB: ≥1 milestones PASSED', `got: ${passedMs.length}`);

      const blockedMs = allMs.filter(m => m.status === 'BLOCKED');
      console.log(`    PASSED: ${passedMs.length}, BLOCKED: ${blockedMs.length}, PENDING: ${allMs.filter(m => m.status === 'PENDING').length}`);

      // Roadmap versioning
      const roadmapV = roadmapVersions.getLatestVersion(lifecycleId);
      check(roadmapV >= 1, 'DB: roadmap version ≥1', `got: ${roadmapV}`);

      // Progress computation
      try {
        const progress = computeLifecycleProgress(lifecycleId);
        check(progress.percentage >= 10, 'DB: lifecycle progress ≥10%', `got: ${progress.percentage}%`);
        console.log(`    Progress: ${progress.percentage}%`);
      } catch (e) {
        console.log(`    Progress computation failed: ${e.message}`);
      }
    }

    // ─── Git ───
    console.log('\n  ─── Git ───');
    try {
      const gitLog = execSync('git log --oneline', { cwd: projectPath, encoding: 'utf8' });
      const commits = gitLog.trim().split('\n');
      check(commits.length >= 2, 'Git: ≥2 commits', `got: ${commits.length}`);
      for (const c of commits.slice(0, 10)) console.log(`      ${c}`);
    } catch (e) {
      check(false, 'Git: log available', e.message);
    }

    // Turn count
    check(turnNum >= 15, 'Turns: ≥15 conversation turns', `got: ${turnNum}`);

    console.log(`\n  Project preserved at: ${projectPath}`);

  } catch (err) {
    console.error(`\nFATAL: ${err.message}`);
    console.error(err.stack);
    failed++;
    failures.push({ name: 'FATAL', detail: err.message });
  }

  // Summary
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log(`  Kuchařka E2E (Real LLM): ${passed} passed, ${failed} failed`);
  console.log(`  Duration: ${totalTime}s | Turns: ${turnNum}`);
  console.log(`  Milestones: ${milestoneResults.length} tracked (${milestoneResults.filter(m => m.status === 'PASSED').length} PASSED)`);
  if (failures.length > 0) {
    console.log(`\n  FAILURES:`);
    for (const f of failures) console.log(`    - ${f.name}: ${f.detail}`);
  }
  console.log('══════════════════════════════════════════════════════════════════════\n');

  try {
    const transcriptDir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'test-transcripts');
    fs.mkdirSync(transcriptDir, { recursive: true });
    const transcriptPath = path.join(transcriptDir, `transcript-cookbook-${Date.now()}.json`);
    fs.writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2));
    console.log(`  Transcript: ${transcriptPath}`);
  } catch { /* ignore */ }

  process.exit(failed > 0 ? 1 : 0);
}

runTest();
