// P5-only test runner for model comparison
// Usage: C3_MODEL_CODE=qwen2.5-coder:32b node tests/p5-only.test.js

import fs from 'fs';

import {
  TestRunner, checkOllama, createExecutor, cleanDB, initProjectDir, resolveTestProjectPath,
  walkFiles, buildLoop, specLoop, runTests,
  allTranscripts, totalPassed, totalFailed, allFailures, globalStart, elapsed,
  ProjectPhase, MilestoneStatus, CheckpointMode,
  getBuildProgress, computeLifecycleProgress, formatMilestoneTable,
  lifecycleRepo, msRepo, roadmapVersions, crRepo, driftChecks,
  projects, conversations, messagesRepo, lifecycleHandoffState, db,
  handleLifecycleBuildDetected, handleLifecycleInput,
  getLcState, setLcState, clearLcState, initLifecycleStateDb,
  callLLM,
} from './e2e-harness.js';


async function testP5_TaskBoardSaaS() {
  const t = new TestRunner('P5: TaskBoard SaaS');
  console.log('\n\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  P5: TaskBoard SaaS — Node.js + PostgreSQL + React + JWT          ║');
  console.log(`║  CODE model: ${process.env.C3_MODEL_CODE || 'qwen3.5:27b'}`.padEnd(69) + '║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  const SESSION_ID = 'p5-taskboard-e2e';
  const projectPath = resolveTestProjectPath('P5-TaskBoard-E2E');
  initProjectDir(projectPath);
  cleanDB(projectPath);

  const PROJECT_NAME = 'TaskBoard SaaS E2E';
  const PROJECT_DESC = 'Full-stack task management SaaS — Node.js + PostgreSQL + React + JWT — E2E test';
  const project = projects.getOrCreate(PROJECT_NAME, projectPath, PROJECT_DESC);
  const projectId = Number(project.id);
  t.convId = `e2e-p5-${Date.now()}`;
  conversations.getOrCreate(t.convId, projectId, 'P5 — Full Lifecycle (Real LLM)');

  const executor = createExecutor(projectPath, 'Node.js Express + PostgreSQL + React');
  const context = { sessionId: SESSION_ID, executor, projectPath };
  let lifecycleId = null;

  try {
    // ── Turn 1: Build request ──
    const msg1 = t.userTurn(
      'Postav mi jednoduchý task management SaaS s loginem a projekty. Backend Node.js + Express, ' +
      'databáze PostgreSQL, frontend React. Uživatel se přihlásí, vidí svoje projekty, v každým ' +
      'projektu má tasky s titulkem, popisem, stavem a deadline. Nic přehnaně složitýho, ale ' +
      'potřebuju to jako reálnou appku s autentizací přes JWT.'
    );
    const resp1 = handleLifecycleBuildDetected(msg1, { intent: 'BUILD' }, context);
    t.systemTurn('PROPOSED', resp1);
    t.check(resp1?.content?.length > 20, 'T1: got substantive proposal');

    // ── Turn 2: Confirm lifecycle ──
    const msg2 = t.userTurn('ano');
    const resp2 = await handleLifecycleInput(msg2, context);
    t.systemTurn('SPEC', resp2);

    const state2 = getLcState(SESSION_ID);
    t.check(state2?.phase === 'SPEC', 'T2: state is SPEC', `got: ${state2?.phase}`);
    lifecycleId = state2?.lifecycleId;

    // ── Turns 3-7: Deep SPEC dialog ──
    const specRounds = await specLoop(t, SESSION_ID, context, [
      'Uživatelé mají projekty a v nich tasky. Datový model: users (id, email, password_hash, name, ' +
      'created_at), projects (id, owner_id FK users, name, description, created_at), tasks (id, ' +
      'project_id FK projects, title, description, status, due_date, assigned_to FK users, priority, ' +
      'created_at, updated_at). Status enum: todo, in_progress, review, done. Priority: low, medium, ' +
      'high, urgent. Jeden uživatel = více projektů, jeden projekt = více tasků.',

      'Task má title (povinný, max 200 znaků), description (volitelný, rich text ne — plain text stačí), ' +
      'status (default: todo), due_date (volitelný, ISO date), priority (default: medium). ' +
      'Assigned_to je volitelný — task může být nepřiřazený. Validace: title nesmí být prázdný, ' +
      'due_date musí být v budoucnosti (při vytváření), status lze měnit jen na validní přechod ' +
      '(todo→in_progress→review→done, plus todo→done pro quick-close).',

      'Frontend React (Create React App nebo Vite), backend Node.js + Express.js. Databáze PostgreSQL ' +
      's čistým SQL (pg modul, žádný ORM). Autentizace přes JWT — access token (15 min) + refresh ' +
      'token (7 dní). Hesla bcrypt. API: REST, prefix /api/v1. CORS povolený pro localhost:3000 (dev). ' +
      'Žádný TypeScript, plain JavaScript. Struktura: server/ a client/ adresáře.',

      'PostgreSQL databáze — tabulky přesně jak jsem popsal. Migrace: jeden SQL soubor (schema.sql) ' +
      'co vytvoří všechny tabulky. Foreign keys s ON DELETE CASCADE (smažu projekt → smažou se tasky). ' +
      'Indexy na tasks(project_id), tasks(assigned_to), tasks(status). Dotazy přes prepared statements ' +
      '(SQL injection prevention). Connection pool přes pg Pool, max 10 connections.',

      'JWT autentizace: POST /api/v1/auth/register (email, password, name), POST /api/v1/auth/login ' +
      '→ {accessToken, refreshToken}, POST /api/v1/auth/refresh → nový accessToken. Middleware ' +
      'authenticateToken() na všech /api/v1/* routes kromě auth. Projekty: GET/POST /api/v1/projects, ' +
      'GET/PUT/DELETE /api/v1/projects/:id. Tasky: GET/POST /api/v1/projects/:id/tasks, ' +
      'GET/PUT/DELETE /api/v1/tasks/:id. Plus: GET /api/v1/tasks?status=todo&project=:id pro filtr.',
    ]);

    t.check(
      getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW',
      'T3-7: reached SPEC_REVIEW',
      `got: ${getLcState(SESSION_ID)?.phase}`
    );

    // ── SPEC revision: add filter endpoint ──
    if (getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW') {
      const msgRev = t.userTurn(
        'Přidej API endpoint pro filtr tasků podle stavu — GET /api/v1/tasks/filter?status=todo&priority=high. ' +
        'Taky chci endpoint GET /api/v1/projects/:id/stats co vrátí počet tasků per status (kolik todo, ' +
        'kolik in_progress, atd.). To je důležitý pro dashboard.'
      );
      const respRev = await handleLifecycleInput(msgRev, context);
      t.systemTurn('SPEC revision', respRev);

      let revRound = 0;
      while (getLcState(SESSION_ID)?.phase === 'SPEC' && revRound < 3) {
        const msg = t.userTurn(
          'Filter endpoint vrací array tasků matchujících query params. Stats endpoint vrací ' +
          'objekt {todo: N, in_progress: N, review: N, done: N, total: N}. Oba endpointy ' +
          'vyžadují autentizaci a user musí být owner projektu.'
        );
        const resp = await handleLifecycleInput(msg, context);
        t.systemTurn(`SPEC revision round ${revRound + 1}`, resp);
        revRound++;
      }

      if (getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW') {
        const msgApprove = t.userTurn('schvaluji');
        const respApprove = await handleLifecycleInput(msgApprove, context);
        t.systemTurn('SPEC → PLAN', respApprove);
      }
    }

    // ── Plan review ──
    const planState = getLcState(SESSION_ID);
    t.check(planState?.phase === 'PLAN_REVIEW', 'PLAN_REVIEW reached', `got: ${planState?.phase}`);

    if (planState?.phase === 'PLAN_REVIEW' && lifecycleId) {
      const milestones = msRepo.listByLifecycle(lifecycleId);
      t.check(milestones.length >= 4, 'Roadmap ≥4 milestones (DB + API + Auth + React)', `got: ${milestones.length}`);

      try { db.prepare('UPDATE milestones SET test_strategy = NULL WHERE lifecycle_id = ?').run(lifecycleId); } catch {}

      const msgPlan = t.userTurn('schvaluji');
      const respPlan = await handleLifecycleInput(msgPlan, context);
      t.systemTurn('PLAN → BUILD', respPlan);
    }

    // ── Build loop ──
    const buildResult = await buildLoop(t, SESSION_ID, context, { maxRounds: 30 });
    t.check(buildResult.completed >= 2, 'BUILD: ≥2 milestones completed', `got: ${buildResult.completed}`);

    // ── Final verification ──
    const allFiles = walkFiles(projectPath);
    t.check(allFiles.length >= 5, 'Files: ≥5 generated', `got: ${allFiles.length}`);

    const hasJS = allFiles.some(f => f.endsWith('.js') || f.endsWith('.jsx'));
    t.check(hasJS, 'Files: JavaScript/JSX files present');

    const hasServer = allFiles.some(f => f.includes('server') || f.includes('api') || f.includes('routes'));
    t.check(hasServer, 'Files: backend structure present');

    const hasFrontend = allFiles.some(f =>
      f.includes('client') || f.includes('frontend') || f.includes('src/App') ||
      f.endsWith('.jsx') || f.includes('react') || f.includes('components')
    );
    t.check(hasFrontend, 'Files: frontend artifacts present',
      `found: ${allFiles.filter(f => /\.(jsx|tsx|css|html)$/.test(f)).join(', ') || 'none'}`
    );

    const hasAuth = allFiles.some(f =>
      f.includes('auth') || f.includes('jwt') || f.includes('middleware')
    );
    t.check(hasAuth, 'Files: auth/JWT artifacts present');

    const hasSchema = allFiles.some(f =>
      f.includes('schema') || f.includes('migration') || f.includes('db') || f.includes('database')
    );
    t.check(hasSchema, 'Files: database schema present');

    t.check(t.turnNum >= 14, 'Turns: ≥14 (long lifecycle)', `got: ${t.turnNum}`);

  } catch (err) {
    console.error(`\nFATAL P5: ${err.message}\n${err.stack}`);
    t.check(false, 'FATAL', err.message);
  }

  t.summary();
}


async function main() {
  const model = process.env.C3_MODEL_CODE || 'qwen3.5:27b';
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log(`  P5 Single-Test — CODE model: ${model}`);
  console.log('══════════════════════════════════════════════════════════════════════');

  await runTests('P5 Single-Test', [testP5_TaskBoardSaaS], `p5-${model.replace(/[/:]/g, '-')}`);
}

main();
