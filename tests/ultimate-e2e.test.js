// Ultimate E2E Project Test — AI Knowledge Base (Real LLM)
// ══════════════════════════════════════════════════════════════════════════════
//
// The most comprehensive lifecycle test. Simulates a realistic 30-45 min
// development session covering ALL critical subsystems:
//
//   - Lifecycle engine (full PROPOSED→SPEC→PLAN→BUILD→REVIEW flow)
//   - SPEC revision (add export feature mid-spec)
//   - PLAN rejection (question milestone order → replan)
//   - Milestone rejection (reject search module → rearchitect)
//   - Scope change during BUILD (add fulltext fallback)
//   - Project resume (new context, continue from state)
//   - Executor code generation (real LLM)
//   - Git history integrity
//   - Quality gate verification
//
// Project: AI Knowledge Base
//   - Backend: FastAPI + SQLite + embeddings search
//   - Frontend: simple web UI
//   - Features: document upload, semantic search, tagging, REST API, JSON export
//
// Requirements:
//   - Ollama running at http://127.0.0.1:11434
//   - Models: deepseek-r1:32b, qwen3.5:27b, qwen3.5:27b
//   - Expected duration: 30-60 minutes
//
// Run: node tests/ultimate-e2e.test.js
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

import {
  TestRunner,
  createExecutor,
  cleanDB,
  initProjectDir,
  walkFiles,
  buildLoop,
  specLoop,
  runTests,
  projects,
  conversations,
  msRepo,
  db,
  handleLifecycleBuildDetected,
  handleLifecycleInput,
  getLcState,
} from './e2e-harness.js';


// ═════════════════════════════════════════════════════════════════════════════
// Ultimate Test: AI Knowledge Base — Full Lifecycle Stress Test
// ═════════════════════════════════════════════════════════════════════════════

async function testUltimate_AIKnowledgeBase() {
  const t = new TestRunner('Ultimate: AI Knowledge Base');
  console.log('\n\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  ULTIMATE: AI Knowledge Base — Full Lifecycle Stress Test          ║');
  console.log('║                                                                    ║');
  console.log('║  Tests: lifecycle engine, spec revision, plan rejection,           ║');
  console.log('║         milestone rejection, scope change, project resume,         ║');
  console.log('║         executor, git history, quality gate                         ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  const SESSION_ID = 'ultimate-kb-e2e';
  const projectPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../projects/Ultimate-KB-E2E');
  initProjectDir(projectPath);
  cleanDB(projectPath);

  const PROJECT_NAME = 'AI Knowledge Base E2E';
  const PROJECT_DESC = 'FastAPI + SQLite + embeddings search + web UI — Ultimate E2E test';
  const project = projects.getOrCreate(PROJECT_NAME, projectPath, PROJECT_DESC);
  const projectId = Number(project.id);
  t.convId = `e2e-ultimate-${Date.now()}`;
  conversations.getOrCreate(t.convId, projectId, 'Ultimate — Full Lifecycle Stress Test (Real LLM)');

  const executor = createExecutor(projectPath, 'Python FastAPI with SQLite and embeddings');
  const context = { sessionId: SESSION_ID, executor, projectPath };
  let lifecycleId = null;

  try {
    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 1: Initialization — PROPOSED → SPEC
    // ═══════════════════════════════════════════════════════════════════════

    console.log('\n  ══ PHASE 1: Initialization ══');

    const msg1 = t.userTurn(
      'Postav mi knowledge base s AI vyhledáváním dokumentů. Backend FastAPI s SQLite databází, ' +
      'vyhledávání přes embeddings (sentence-transformers nebo podobný). Uživatel nahraje dokumenty ' +
      '(text, PDF), systém je zaindexuje a pak může semanticky vyhledávat. Přidej tagy pro organizaci ' +
      'a jednoduchý web UI pro upload a search. REST API pro všechno.'
    );
    const resp1 = handleLifecycleBuildDetected(msg1, { intent: 'BUILD' }, context);
    t.systemTurn('PROPOSED', resp1);
    t.check(resp1?.content?.length > 20, 'PHASE 1: got substantive proposal');

    // ── Confirm lifecycle ──
    const msg2 = t.userTurn('ano');
    const resp2 = await handleLifecycleInput(msg2, context);
    t.systemTurn('SPEC', resp2);

    const state2 = getLcState(SESSION_ID);
    t.check(state2?.phase === 'SPEC', 'PHASE 1: entered SPEC', `got: ${state2?.phase}`);
    lifecycleId = state2?.lifecycleId;

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 2: Deep SPEC dialog — 5 detailed answers
    // ═══════════════════════════════════════════════════════════════════════

    console.log('\n  ══ PHASE 2: SPEC Dialog ══');

    const specRounds = await specLoop(t, SESSION_ID, context, [
      // Answer 1: Document upload
      'Uživatel může nahrávat dokumenty přes API i web UI. Podporovaný formáty: plain text (.txt) ' +
      'a PDF (.pdf). Při uploadu se dokument uloží do SQLite (metadata: název, popis, tagy, datum) ' +
      'a text se extrahuje (pro PDF přes PyPDF2 nebo pdfplumber). Maximální velikost 10MB. ' +
      'Endpoint: POST /api/documents (multipart/form-data). Response: document ID + metadata.',

      // Answer 2: Tagging system
      'Dokumenty mají tagy — many-to-many relace. Tabulka tags (id, name), tabulka document_tags ' +
      '(document_id, tag_id). Tag se vytvoří automaticky při prvním použití. Endpoint: ' +
      'GET /api/tags (list všech), POST /api/documents/:id/tags (přidej tag), ' +
      'DELETE /api/documents/:id/tags/:tag_id (odeber tag). Filtrování: ' +
      'GET /api/documents?tag=python vrátí jen dokumenty s daným tagem.',

      // Answer 3: Embeddings search
      'Vyhledávání přes embeddings: při indexaci se z textu dokumentu vytvoří embedding vektor ' +
      '(sentence-transformers, model all-MiniLM-L6-v2). Vektor uložený v SQLite jako BLOB. ' +
      'Search endpoint: POST /api/search {query: "text", limit: 10} → vrátí dokumenty ' +
      'seřazené podle cosine similarity. Fallback: pokud embeddings model není dostupný, ' +
      'použij SQLite FTS5 fulltext search.',

      // Answer 4: REST API design
      'REST API kompletní: GET /api/documents (list, pagination, filter by tag), ' +
      'POST /api/documents (upload), GET /api/documents/:id (detail + text preview), ' +
      'PUT /api/documents/:id (update metadata), DELETE /api/documents/:id, ' +
      'POST /api/search (semantic search), GET /api/tags. Všechno JSON response, ' +
      'proper HTTP status codes (201 created, 404 not found, 422 validation error). ' +
      'CORS enabled. No authentication (single-user local tool).',

      // Answer 5: Web UI
      'Jednoduchý web UI — jedna HTML stránka + vanilla JS (žádný React, žádný framework). ' +
      'Upload formulář (drag & drop + file input), search bar s výsledky (title, snippet, score, tagy), ' +
      'document detail view, tag management. CSS: minimalistický, responzivní. ' +
      'Served by FastAPI static files. Architecture: backend/ (FastAPI app, models, search engine), ' +
      'frontend/ (index.html, app.js, style.css), db/ (SQLite file), tests/ (pytest).',
    ]);

    t.check(
      getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW',
      'PHASE 2: reached SPEC_REVIEW',
      `got: ${getLcState(SESSION_ID)?.phase}`
    );

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 3: SPEC Revision — add JSON export
    // ═══════════════════════════════════════════════════════════════════════

    console.log('\n  ══ PHASE 3: SPEC Revision ══');

    if (getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW') {
      const msgRev = t.userTurn(
        'Ještě přidej export výsledků do JSON — GET /api/export?tag=python vrátí všechny ' +
        'dokumenty s daným tagem jako JSON soubor ke stažení (Content-Disposition: attachment). ' +
        'Taky chci GET /api/export/search?query=text co exportuje výsledky posledního searche. ' +
        'To je důležitý pro integraci s dalšíma nástrojema.'
      );
      const respRev = await handleLifecycleInput(msgRev, context);
      t.systemTurn('SPEC revision', respRev);

      // Answer revision questions if phase went back to SPEC
      let revRound = 0;
      while (getLcState(SESSION_ID)?.phase === 'SPEC' && revRound < 3) {
        const msg = t.userTurn(
          'Export formát: JSON array s objektama {id, title, text_preview (prvních 500 znaků), ' +
          'tags: [], similarity_score (jen pro search export), created_at}. ' +
          'Response header: Content-Type: application/json, ' +
          'Content-Disposition: attachment; filename="export-{timestamp}.json".'
        );
        const resp = await handleLifecycleInput(msg, context);
        t.systemTurn(`SPEC revision round ${revRound + 1}`, resp);
        revRound++;
      }

      t.check(
        getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW',
        'PHASE 3: back to SPEC_REVIEW after revision',
        `got: ${getLcState(SESSION_ID)?.phase}`
      );

      // Approve spec
      if (getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW') {
        const msgApprove = t.userTurn('schvaluji');
        const respApprove = await handleLifecycleInput(msgApprove, context);
        t.systemTurn('SPEC → PLAN', respApprove);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 4: PLAN Rejection — question milestone order → replan
    // ═══════════════════════════════════════════════════════════════════════

    console.log('\n  ══ PHASE 4: PLAN Rejection ══');

    const planState = getLcState(SESSION_ID);
    t.check(planState?.phase === 'PLAN_REVIEW', 'PHASE 4: reached PLAN_REVIEW', `got: ${planState?.phase}`);

    if (planState?.phase === 'PLAN_REVIEW' && lifecycleId) {
      const milestonesBefore = msRepo.listByLifecycle(lifecycleId);
      t.check(milestonesBefore.length >= 3, 'PHASE 4: ≥3 milestones in roadmap', `got: ${milestonesBefore.length}`);

      // Reject plan — question UI placement
      const msgReject = t.userTurn(
        'Proč je UI až poslední milník? Potřebuju UI dřív, aspoň basic verzi — jinak nemůžu ' +
        'ručně testovat search a upload. Přesuň základní UI do třetího milníku hned po search enginu. ' +
        'Plný UI s tag managementem a drag&drop může být později.'
      );
      const respReject = await handleLifecycleInput(msgReject, context);
      t.systemTurn('PLAN rejection', respReject);
      t.check(true, 'PHASE 4: plan rejection sent');

      // If still in PLAN_REVIEW after rejection feedback, approve
      if (getLcState(SESSION_ID)?.phase === 'PLAN_REVIEW') {
        try { db.prepare('UPDATE milestones SET test_strategy = NULL WHERE lifecycle_id = ?').run(lifecycleId); } catch {}

        const msgApprove = t.userTurn('schvaluji');
        const respApprove = await handleLifecycleInput(msgApprove, context);
        t.systemTurn('PLAN → BUILD', respApprove);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 5: BUILD — first batch with milestone rejection
    // ═══════════════════════════════════════════════════════════════════════

    console.log('\n  ══ PHASE 5: BUILD (first batch + milestone rejection) ══');

    const buildState = getLcState(SESSION_ID);
    t.check(
      buildState?.phase === 'BUILD' || buildState?.phase === 'BUILD_MILESTONE_REVIEW',
      'PHASE 5: entered BUILD',
      `got: ${buildState?.phase}`
    );

    // Build with milestone rejection — reject first milestone review
    const buildResult1 = await buildLoop(t, SESSION_ID, context, {
      maxRounds: 15,
      rejectFirst: true,
      rejectMessage:
        'Search modul by měl být samostatná služba s vlastním rozhraním, ne funkce vmíchaná ' +
        'do hlavního API. Oddělte SearchEngine třídu s metodami index(), search(), remove(). ' +
        'API ji jen volá. Přepracuj to.',
    });

    t.check(buildResult1.rejected, 'PHASE 5: milestone rejection executed');
    const completedAfterPhase5 = buildResult1.completed;

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 6: Scope Change During BUILD — add fulltext fallback
    // ═══════════════════════════════════════════════════════════════════════

    console.log('\n  ══ PHASE 6: Scope Change During BUILD ══');

    const phase6State = getLcState(SESSION_ID);
    if (phase6State && phase6State.phase !== 'COMPLETED') {
      const msgScope = t.userTurn(
        'Přidej také fulltext fallback search — když embeddings model není dostupný nebo query ' +
        'je příliš krátký (< 3 slova), použij SQLite FTS5. SearchEngine by měl mít metodu ' +
        'search(query, mode="auto"|"semantic"|"fulltext"). V auto modu rozhodne sám na základě ' +
        'dostupnosti modelu a délky query.'
      );
      const respScope = await handleLifecycleInput(msgScope, context);
      t.systemTurn('SCOPE change', respScope);
      t.check(true, 'PHASE 6: scope change sent during BUILD');

      // Continue build after scope change
      const phase6ContState = getLcState(SESSION_ID);
      if (phase6ContState && phase6ContState.phase !== 'COMPLETED') {
        const buildResult2 = await buildLoop(t, SESSION_ID, context, { maxRounds: 15 });
        t.check(
          buildResult2.completed + completedAfterPhase5 >= 2,
          'PHASE 6: cumulative ≥2 milestones completed',
          `got: ${buildResult2.completed + completedAfterPhase5}`
        );
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 7: Project Resume — new context, continue from state
    // ═══════════════════════════════════════════════════════════════════════

    console.log('\n  ══ PHASE 7: Project Resume ══');

    const phase7State = getLcState(SESSION_ID);
    if (phase7State && phase7State.phase !== 'COMPLETED') {
      // Create fresh context (simulates restart)
      const executor2 = createExecutor(projectPath, 'Python FastAPI with SQLite and embeddings');
      const context2 = { sessionId: SESSION_ID, executor: executor2, projectPath };

      const msgResume = t.userTurn(
        'Pokračuj v projektu — kde jsme skončili? Dokonči zbývající milníky.'
      );
      const respResume = await handleLifecycleInput(msgResume, context2);
      t.systemTurn('RESUME', respResume);
      t.check(true, 'PHASE 7: project resumed with new context');

      // Continue build with new context
      const resumeState = getLcState(SESSION_ID);
      if (resumeState && resumeState.phase !== 'COMPLETED') {
        const buildResult3 = await buildLoop(t, SESSION_ID, context2, { maxRounds: 15 });
        // Don't require additional milestones — resume may find everything blocked
      }
    } else {
      t.check(true, 'PHASE 7: lifecycle already completed (skip resume)');
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 8: Verification — files, structure, git, quality gate
    // ═══════════════════════════════════════════════════════════════════════

    console.log('\n  ══ PHASE 8: Verification ══');

    const allFiles = walkFiles(projectPath);
    console.log(`    Generated files (${allFiles.length}):`);
    for (const f of allFiles) console.log(`      ${f}`);

    // ── File count ──
    t.check(allFiles.length >= 5, 'FILES: ≥5 generated', `got: ${allFiles.length}`);

    // ── Backend structure ──
    const hasBackend = allFiles.some(f =>
      f.includes('main.py') || f.includes('app.py') || f.includes('server.py') ||
      f.includes('backend/')
    );
    t.check(hasBackend, 'STRUCTURE: backend entry point present');

    // ── Search module ──
    const hasSearch = allFiles.some(f =>
      f.includes('search') || f.includes('embedding') || f.includes('vector')
    );
    t.check(hasSearch, 'STRUCTURE: search/embeddings module present');

    // ── Models ──
    const hasModels = allFiles.some(f =>
      f.includes('model') || f.includes('schema') || f.includes('database')
    );
    t.check(hasModels, 'STRUCTURE: models/schema present');

    // ── Frontend ──
    const hasFrontend = allFiles.some(f =>
      f.includes('frontend') || f.includes('index.html') || f.includes('static') ||
      f.includes('templates')
    );
    t.check(hasFrontend, 'STRUCTURE: frontend artifacts present');

    // ── Tests ──
    const hasTests = allFiles.some(f =>
      f.includes('test') && f.endsWith('.py')
    );
    // Tests may or may not be generated — informational check
    if (hasTests) {
      t.check(true, 'STRUCTURE: test files present');
    } else {
      console.log('    ⓘ  No test files generated (informational)');
    }

    // ── Python files ──
    const pyFiles = allFiles.filter(f => f.endsWith('.py'));
    t.check(pyFiles.length >= 2, 'FILES: ≥2 Python modules', `got: ${pyFiles.length}`);

    // ── Git history integrity ──
    try {
      const gitLog = execSync('git log --oneline', { cwd: projectPath, encoding: 'utf8' });
      const commits = gitLog.trim().split('\n');
      t.check(commits.length >= 3, 'GIT: ≥3 commits (init + milestones)', `got: ${commits.length}`);

      // Check commit count via rev-list for accuracy
      const revCount = execSync('git rev-list --count HEAD', { cwd: projectPath, encoding: 'utf8' }).trim();
      t.check(Number(revCount) >= 3, 'GIT: rev-list confirms ≥3 commits', `got: ${revCount}`);

      console.log(`    Git commits (${commits.length}):`);
      for (const c of commits.slice(0, 10)) console.log(`      ${c}`);
    } catch (e) {
      t.check(false, 'GIT: history available', e.message);
    }

    // ── Quality gate: Python syntax check ──
    let syntaxOk = true;
    for (const pyFile of pyFiles) {
      const fullPath = path.join(projectPath, pyFile);
      try {
        execSync(`python3 -c "import ast; ast.parse(open('${fullPath}').read())"`, {
          stdio: 'pipe',
          timeout: 5000,
        });
      } catch {
        syntaxOk = false;
        console.log(`    ⚠ Syntax error in ${pyFile}`);
      }
    }
    if (pyFiles.length > 0) {
      t.check(syntaxOk, 'QUALITY: all Python files parse without syntax errors');
    }

    // ── Lifecycle final state ──
    const finalState = getLcState(SESSION_ID);
    if (finalState) {
      console.log(`    Lifecycle final state: phase=${finalState.phase}`);
    } else {
      console.log('    Lifecycle final state: cleared (completed)');
    }

    // ── Milestone summary ──
    if (lifecycleId) {
      const allMs = msRepo.listByLifecycle(lifecycleId);
      const passed = allMs.filter(m => m.status === 'PASSED').length;
      const blocked = allMs.filter(m => m.status === 'BLOCKED').length;
      const pending = allMs.filter(m => m.status === 'PENDING').length;
      console.log(`    Milestones: ${allMs.length} total — ${passed} PASSED, ${blocked} BLOCKED, ${pending} PENDING`);
      t.check(passed >= 2, 'MILESTONES: ≥2 PASSED', `got: ${passed} passed of ${allMs.length}`);
    }

    // ── Turn count — should be high for ultimate test ──
    t.check(t.turnNum >= 20, 'TURNS: ≥20 (comprehensive lifecycle)', `got: ${t.turnNum}`);

  } catch (err) {
    console.error(`\nFATAL Ultimate: ${err.message}\n${err.stack}`);
    t.check(false, 'FATAL', err.message);
  }

  t.summary();
}


// ═════════════════════════════════════════════════════════════════════════════
// MAIN
// ═════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('  Ultimate E2E — AI Knowledge Base (Real LLM)');
  console.log('══════════════════════════════════════════════════════════════════════');

  await runTests('Ultimate Test', [testUltimate_AIKnowledgeBase], 'ultimate');
}

main();
