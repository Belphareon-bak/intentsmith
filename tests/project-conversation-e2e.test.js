// Project Conversation E2E Test — 4 Diverse Projects (Real LLM)
// P1 Malý Alchymista (Flask), P2 QuizMaster (Go), P3 Dětský Deník (Svelte), P4 ResumeBot (resume existing)
// Run: node tests/project-conversation-e2e.test.js

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

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


// ═════════════════════════════════════════════════════════════════════════════
// P1: Malý Alchymista — Flask Potion Tracker (15 turns, Czech, informal)
// ═════════════════════════════════════════════════════════════════════════════

async function testP1_MalyAlchymista() {
  const t = new TestRunner('P1: Malý Alchymista');
  console.log('\n\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  P1: Malý Alchymista — Flask Potion Tracker (Python)               ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  const SESSION_ID = 'p1-alchymista-e2e';
  const projectPath = resolveTestProjectPath('P1-Alchymista-E2E');
  initProjectDir(projectPath);
  cleanDB(projectPath);

  const PROJECT_NAME = 'Malý Alchymista E2E';
  const PROJECT_DESC = 'Flask potion ingredient tracker with SQLite — E2E test';
  const project = projects.getOrCreate(PROJECT_NAME, projectPath, PROJECT_DESC);
  const projectId = Number(project.id);
  t.convId = `e2e-p1-${Date.now()}`;
  conversations.getOrCreate(t.convId, projectId, 'P1 — Full Lifecycle (Real LLM)');

  const executor = createExecutor(projectPath, 'Python Flask with SQLite');
  const context = { sessionId: SESSION_ID, executor, projectPath };
  let lifecycleId = null;

  try {
    // ── Turn 1: Build request (informal, long-winded) ──
    const msg1 = t.userTurn(
      'Hele, potřeboval bych appku na sledování ingrediencí do lektvarů. Nic velkýho, ' +
      'prostě Flask server s REST API. Mám tam recepty na lektvary a ke každýmu seznam ' +
      'ingrediencí s množstvím. Databáze SQLite, žádnej overkill. Jasný?'
    );
    const resp1 = handleLifecycleBuildDetected(msg1, { intent: 'BUILD' }, context);
    t.systemTurn('PROPOSED', resp1);
    t.check(resp1?.content?.length > 20, 'T1: got substantive proposal');

    // ── Turn 2: Confirm lifecycle (must be standalone "ano") ──
    const msg2 = t.userTurn('jo');
    const resp2 = await handleLifecycleInput(msg2, context);
    t.systemTurn('SPEC', resp2);

    const state2 = getLcState(SESSION_ID);
    t.check(state2?.phase === 'SPEC', 'T2: state is SPEC', `got: ${state2?.phase}`);
    lifecycleId = state2?.lifecycleId;

    // ── Turns 3-6: Detailed spec answers (opinionated, pushback on decisions) ──
    const specRounds = await specLoop(t, SESSION_ID, context, [
      'Důležitý — chci mít full-text hledání přes názvy ingrediencí, to je pro mě klíčový. ' +
      'A taky endpoint na export receptů do JSON souboru. ' +
      'Takže: REST API s CRUD pro recepty (/api/potions) a ingredience (/api/ingredients). ' +
      'Každej recept má název, popis, difficulty (1-5), a list ingrediencí s množstvím a jednotkou. ' +
      'Ingredience: název, typ (bylina/minerál/tekutina/magická), popis, rarita (common/rare/legendary). ' +
      'Full-text search přes FTS5 modul v SQLite. Export GET /api/export → JSON dump.',

      'Ne, nechci žádnej ORM! Čistý SQL dotazy přes sqlite3 modul. ORMy jsou podle mě zbytečná ' +
      'abstrakce pro takhle malou appku. Navíc chci mít kontrolu nad FTS5 indexem přímo. ' +
      'Flask-CORS pro CORS headers, to jo. Ale žádnej SQLAlchemy ani Peewee.',

      'Ano, generuj specifikaci. Rozhodnutí: SQLite bez ORM (alternativy: SQLAlchemy, Peewee, MongoDB). ' +
      'Flask (alternativy: FastAPI, Django). FTS5 pro fulltext (alternativy: Whoosh, Elasticsearch).',
    ]);

    t.check(
      getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW',
      'T3-5: reached SPEC_REVIEW',
      `got: ${getLcState(SESSION_ID)?.phase}`
    );

    // ── Turn 6: Spec revision — add ingredient substitution ──
    if (getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW') {
      const msg6 = t.userTurn(
        'Hele, ještě jsem zapomněl — přidej tam substituce ingrediencí. Když nemám ' +
        'dračí krev, chci vědět čím ji nahradit. Tabulka ingredient_substitutions s ' +
        'quality_factor (0.5 = poloviční účinnost). To je důležitý pro alchymisty-začátečníky.'
      );
      const resp6 = await handleLifecycleInput(msg6, context);
      t.systemTurn('SPEC revision', resp6);

      // Answer revision questions if needed
      let revRound = 0;
      while (getLcState(SESSION_ID)?.phase === 'SPEC' && revRound < 3) {
        const msg = t.userTurn(
          'Quality factor je float 0.0-1.0, kde 1.0 = perfektní náhrada. ' +
          'Endpoint GET /api/ingredients/:id/substitutes vrací list alternativ seřazených podle quality_factor desc.'
        );
        const resp = await handleLifecycleInput(msg, context);
        t.systemTurn(`SPEC revision round ${revRound + 1}`, resp);
        revRound++;
      }

      // Approve spec
      if (getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW') {
        const msgApprove = t.userTurn('schvaluji');
        const respApprove = await handleLifecycleInput(msgApprove, context);
        t.systemTurn('SPEC → PLAN', respApprove);
      }
    }

    // ── Turn 7-8: Plan review ──
    const planState = getLcState(SESSION_ID);
    t.check(planState?.phase === 'PLAN_REVIEW', 'PLAN_REVIEW reached', `got: ${planState?.phase}`);

    if (planState?.phase === 'PLAN_REVIEW' && lifecycleId) {
      const milestones = msRepo.listByLifecycle(lifecycleId);
      t.check(milestones.length >= 3, 'Roadmap ≥3 milestones', `got: ${milestones.length}`);

      // Clear test_strategy
      try { db.prepare('UPDATE milestones SET test_strategy = NULL WHERE lifecycle_id = ?').run(lifecycleId); } catch {}

      // Approve plan
      const msgPlan = t.userTurn('schvaluji');
      const respPlan = await handleLifecycleInput(msgPlan, context);
      t.systemTurn('PLAN → BUILD', respPlan);
    }

    // ── Turns 9-15: Build with one rejection ──
    const buildResult = await buildLoop(t, SESSION_ID, context, {
      maxRounds: 25,
      rejectFirst: true,
      rejectMessage: 'Počkej, v tom FTS5 indexu chybí trigger na UPDATE. Přidej ON UPDATE trigger pro FTS5 sync.',
    });
    t.check(buildResult.completed >= 2, 'BUILD: ≥2 milestones completed', `got: ${buildResult.completed}`);
    t.check(buildResult.rejected, 'BUILD: milestone rejection tested');

    // ── Final verification ──
    const allFiles = walkFiles(projectPath);
    t.check(allFiles.length >= 3, 'Files: ≥3 generated', `got: ${allFiles.length}`);
    const hasPy = allFiles.some(f => f.endsWith('.py'));
    t.check(hasPy, 'Files: Python files present');
    t.check(t.turnNum >= 12, 'Turns: ≥12', `got: ${t.turnNum}`);

  } catch (err) {
    console.error(`\nFATAL P1: ${err.message}\n${err.stack}`);
    t.check(false, 'FATAL', err.message);
  }

  t.summary();
}


// ═════════════════════════════════════════════════════════════════════════════
// P2: QuizMaster — Go CLI Trivia Engine (15 turns, English, analytical)
// ═════════════════════════════════════════════════════════════════════════════

async function testP2_QuizMaster() {
  const t = new TestRunner('P2: QuizMaster');
  console.log('\n\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  P2: QuizMaster — Go CLI Trivia Engine                             ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  const SESSION_ID = 'p2-quizmaster-e2e';
  const projectPath = resolveTestProjectPath('P2-QuizMaster-E2E');
  initProjectDir(projectPath);
  cleanDB(projectPath);

  const project = projects.getOrCreate('QuizMaster E2E', projectPath, 'Go CLI trivia engine — E2E test');
  const projectId = Number(project.id);
  t.convId = `e2e-p2-${Date.now()}`;
  conversations.getOrCreate(t.convId, projectId, 'P2 — Full Lifecycle (Real LLM)');

  const executor = createExecutor(projectPath, 'Go (Golang) CLI application');
  const context = { sessionId: SESSION_ID, executor, projectPath };
  let lifecycleId = null;

  try {
    // ── Turn 1: Build request (English, detailed) ──
    const msg1 = t.userTurn(
      'I want to build a CLI trivia game in Go. Think of it as a terminal-based ' +
      'quiz show where questions are loaded from YAML files. Multiple categories ' +
      '(science, history, pop culture), difficulty levels, scoring with streaks, ' +
      'and a local leaderboard stored in BoltDB.'
    );
    const resp1 = handleLifecycleBuildDetected(msg1, { intent: 'BUILD' }, context);
    t.systemTurn('PROPOSED', resp1);
    t.check(resp1?.content?.length > 20, 'T1: got substantive proposal');

    // ── Turn 2: Confirm lifecycle (must be standalone) ──
    const msg2 = t.userTurn('yes');
    const resp2 = await handleLifecycleInput(msg2, context);
    t.systemTurn('SPEC', resp2);

    const state2 = getLcState(SESSION_ID);
    t.check(state2?.phase === 'SPEC', 'T2: state is SPEC', `got: ${state2?.phase}`);
    lifecycleId = state2?.lifecycleId;

    // ── Turns 3-6: Spec with thoughtful detail + constraint ──
    const specRounds = await specLoop(t, SESSION_ID, context, [
      'Strong preference: I want zero external dependencies besides BoltDB. No Cobra, no Viper, ' +
      'no color libraries. Pure stdlib for CLI parsing and output formatting. Keep it lean. ' +
      'For the quiz flow: player picks category → gets 10 questions → multiple choice (4 options) ' +
      '→ answer within time limit (configurable, default 15s) → streak bonus (3+ correct = 1.5x, ' +
      '5+ = 2x). Questions stored in YAML: question text, 4 options, correct index, difficulty ' +
      '(easy/medium/hard), category tag. Leaderboard: top 20 scores, stored in BoltDB, ' +
      'sortable by score or date.',

      'Wait, actually — can we support both single-player and "hot-seat" multiplayer? ' +
      'Hot-seat means players take turns on the same terminal. Each player answers the same ' +
      'questions, scores are tracked separately, winner announced at the end. ' +
      'This changes the architecture a bit — we need a Session struct that tracks players.',

      'Yes, generate the spec. Design decisions: BoltDB (alternatives: SQLite, flat JSON file). ' +
      'YAML for questions (alternatives: JSON, TOML). stdlib CLI (alternatives: Cobra, urfave/cli). ' +
      'Architecture: Clean separation — engine/ (quiz logic), store/ (BoltDB), loader/ (YAML), ' +
      'cmd/ (CLI interface). Main loop in cmd/root.go.',
    ]);

    t.check(
      getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW',
      'T3-5: reached SPEC_REVIEW',
      `got: ${getLcState(SESSION_ID)?.phase}`
    );

    // ── Turn 6: Approve spec with note ──
    if (getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW') {
      const msg6 = t.userTurn('approve');
      const resp6 = await handleLifecycleInput(msg6, context);
      t.systemTurn('SPEC → PLAN', resp6);
    }

    // ── Turn 7: Plan review — approve ──
    const planState = getLcState(SESSION_ID);
    t.check(planState?.phase === 'PLAN_REVIEW', 'PLAN_REVIEW reached', `got: ${planState?.phase}`);

    if (planState?.phase === 'PLAN_REVIEW' && lifecycleId) {
      const milestones = msRepo.listByLifecycle(lifecycleId);
      t.check(milestones.length >= 3, 'Roadmap ≥3 milestones', `got: ${milestones.length}`);

      try { db.prepare('UPDATE milestones SET test_strategy = NULL WHERE lifecycle_id = ?').run(lifecycleId); } catch {}

      const msgPlan = t.userTurn('approve');
      const respPlan = await handleLifecycleInput(msgPlan, context);
      t.systemTurn('PLAN → BUILD', respPlan);
    }

    // ── Turns 8-15: Build — straightforward ──
    const buildResult = await buildLoop(t, SESSION_ID, context, { maxRounds: 25 });
    t.check(buildResult.completed >= 2, 'BUILD: ≥2 milestones completed', `got: ${buildResult.completed}`);

    // ── Final verification ──
    const allFiles = walkFiles(projectPath);
    t.check(allFiles.length >= 3, 'Files: ≥3 generated', `got: ${allFiles.length}`);
    const hasGo = allFiles.some(f => f.endsWith('.go'));
    t.check(hasGo, 'Files: Go files present');
    t.check(t.turnNum >= 12, 'Turns: ≥12', `got: ${t.turnNum}`);

    // Check for Go-specific patterns
    const goFiles = allFiles.filter(f => f.endsWith('.go'));
    if (goFiles.length > 0) {
      const mainGoContent = fs.readFileSync(path.join(projectPath, goFiles[0]), 'utf8');
      t.check(mainGoContent.includes('package'), 'Go: files have package declaration');
    }

  } catch (err) {
    console.error(`\nFATAL P2: ${err.message}\n${err.stack}`);
    t.check(false, 'FATAL', err.message);
  }

  t.summary();
}


// ═════════════════════════════════════════════════════════════════════════════
// P3: Dětský Deník — Svelte Kids' Diary (15 turns, mixed CZ/EN, UX-opinionated)
// ═════════════════════════════════════════════════════════════════════════════

async function testP3_DetskyDenik() {
  const t = new TestRunner('P3: Dětský Deník');
  console.log('\n\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  P3: Dětský Deník — Svelte Kids\' Diary (Frontend + API)             ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  const SESSION_ID = 'p3-denik-e2e';
  const projectPath = resolveTestProjectPath('P3-DetskyDenik-E2E');
  initProjectDir(projectPath);
  cleanDB(projectPath);

  const project = projects.getOrCreate('Dětský Deník E2E', projectPath, 'Svelte kids diary with Express API — E2E test');
  const projectId = Number(project.id);
  t.convId = `e2e-p3-${Date.now()}`;
  conversations.getOrCreate(t.convId, projectId, 'P3 — Full Lifecycle (Real LLM)');

  const executor = createExecutor(projectPath, 'Svelte frontend + Express.js API');
  const context = { sessionId: SESSION_ID, executor, projectPath };
  let lifecycleId = null;

  try {
    // ── Turn 1: Build request (mixed CZ/EN, emotional) ──
    const msg1 = t.userTurn(
      'Mám nápad na appku pro děti — "Dětský Deník". Svelte frontend kde dítě může ' +
      'psát zápisky, přidávat emoji mood (😊😢😎🤔), kreslit obrázky (canvas), a přikládat ' +
      'fotky. Backend Express.js + SQLite. Důležitý je jednoduchost — target audience jsou ' +
      'děti 6-12 let, UI musí být colorful a intuitivní. No login, just a PIN code.'
    );
    const resp1 = handleLifecycleBuildDetected(msg1, { intent: 'BUILD' }, context);
    t.systemTurn('PROPOSED', resp1);
    t.check(resp1?.content?.length > 20, 'T1: got substantive proposal');

    // ── Turn 2: Confirm lifecycle (must be standalone) ──
    const msg2 = t.userTurn('ano');
    const resp2 = await handleLifecycleInput(msg2, context);
    t.systemTurn('SPEC', resp2);

    const state2 = getLcState(SESSION_ID);
    t.check(state2?.phase === 'SPEC', 'T2: state is SPEC', `got: ${state2?.phase}`);
    lifecycleId = state2?.lifecycleId;

    // ── Turns 3-6: Spec — UX-focused answers ──
    const specRounds = await specLoop(t, SESSION_ID, context, [
      'Pozor na UX — nechci žádný dark patterns, žádný gamifikaci, žádný streaky nebo achievementy. ' +
      'Tohle má být safe space pro sebevyjádření, ne engagement trap. Žádný cloud storage — všechno lokální. ' +
      'Zápisky mají: datum (auto), mood emoji (volitelný), text (rich-text by bylo moc — ' +
      'plain text + bold/italic stačí), kreslení (HTML Canvas, save jako PNG), fotky (upload, ' +
      'max 2MB, resize na 800px). Archiv = timeline view (vertikální scroll, nejnovější nahoře). ' +
      'PIN: 4-digit, uložený jako bcrypt hash lokálně. Barvy: pastelové, žádné ostré kontrasty. ' +
      'Font: rounded (Nunito nebo Quicksand).',

      'Data model: entries tabulka (id, date, mood, text, has_drawing, has_photo, created_at). ' +
      'Drawings: uložený jako PNG v ./data/drawings/{entry_id}.png. Fotky: ./data/photos/{entry_id}.jpg. ' +
      'API: Express na portu 3456. Endpointy: ' +
      'POST /api/pin/verify, GET /api/entries, POST /api/entries, ' +
      'PUT /api/entries/:id, DELETE /api/entries/:id, ' +
      'POST /api/entries/:id/drawing (binary), POST /api/entries/:id/photo (multipart).',

      'Generuj specifikaci. Tech: Svelte (ne SvelteKit, plain Svelte), Express.js, SQLite ' +
      '(better-sqlite3), bcrypt pro PIN. No TypeScript — plain JS. Canvas API pro kreslení. ' +
      'Design decisions: Svelte (alt: React, Vue), SQLite (alt: JSON files, LevelDB), ' +
      'Express (alt: Fastify, Koa). Architecture: monorepo — client/ a server/ adresáře.',
    ]);

    t.check(
      getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW',
      'SPEC_REVIEW reached',
      `got: ${getLcState(SESSION_ID)?.phase}`
    );

    // ── Turn 6: Approve spec with passion ──
    if (getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW') {
      const msg6 = t.userTurn('schvaluji');
      const resp6 = await handleLifecycleInput(msg6, context);
      t.systemTurn('SPEC → PLAN', resp6);
    }

    // ── Turn 7-8: Plan review — reject then approve ──
    const planState = getLcState(SESSION_ID);
    t.check(planState?.phase === 'PLAN_REVIEW', 'PLAN_REVIEW reached', `got: ${planState?.phase}`);

    if (planState?.phase === 'PLAN_REVIEW' && lifecycleId) {
      const milestones = msRepo.listByLifecycle(lifecycleId);
      t.check(milestones.length >= 3, 'Roadmap ≥3 milestones', `got: ${milestones.length}`);

      // Reject roadmap — reorder milestones
      const msgReject = t.userTurn(
        'Moment — proč je canvas drawing až v posledním milníku? To je core feature! ' +
        'Přesuň kreslení do druhého milníku hned po základním UI. Fotky můžou být později.'
      );
      const respReject = await handleLifecycleInput(msgReject, context);
      t.systemTurn('PLAN revision', respReject);

      // If still PLAN_REVIEW or back to it after revision
      if (getLcState(SESSION_ID)?.phase === 'PLAN_REVIEW') {
        try { db.prepare('UPDATE milestones SET test_strategy = NULL WHERE lifecycle_id = ?').run(lifecycleId); } catch {}

        const msgApprove = t.userTurn('schvaluji');
        const respApprove = await handleLifecycleInput(msgApprove, context);
        t.systemTurn('PLAN → BUILD', respApprove);
      }
    }

    // ── Turns 9-15: Build ──
    const buildResult = await buildLoop(t, SESSION_ID, context, { maxRounds: 25 });
    t.check(buildResult.completed >= 2, 'BUILD: ≥2 milestones completed', `got: ${buildResult.completed}`);

    // ── Final verification ──
    const allFiles = walkFiles(projectPath);
    t.check(allFiles.length >= 3, 'Files: ≥3 generated', `got: ${allFiles.length}`);
    t.check(t.turnNum >= 12, 'Turns: ≥12', `got: ${t.turnNum}`);

    // Check for both frontend and backend files
    const hasJS = allFiles.some(f => f.endsWith('.js'));
    const hasSvelte = allFiles.some(f => f.endsWith('.svelte'));
    const hasHTML = allFiles.some(f => f.endsWith('.html'));
    t.check(hasJS, 'Files: JavaScript files present');
    // Svelte or HTML — depends on which milestone the LLM reached
    t.check(hasSvelte || hasHTML || allFiles.some(f => f.includes('client')),
      'Files: frontend artifacts present',
      `found: ${allFiles.filter(f => /\.(svelte|html|css)$/.test(f)).join(', ') || 'none'}`
    );

  } catch (err) {
    console.error(`\nFATAL P3: ${err.message}\n${err.stack}`);
    t.check(false, 'FATAL', err.message);
  }

  t.summary();
}


// ═════════════════════════════════════════════════════════════════════════════
// P4: ResumeBot — Resume an Existing Half-Built Project (Node API)
// ═════════════════════════════════════════════════════════════════════════════

async function testP4_ResumeBot() {
  const t = new TestRunner('P4: ResumeBot (resume existing)');
  console.log('\n\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  P4: ResumeBot — Resume Existing Half-Built Node API               ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  const SESSION_ID = 'p4-resumebot-e2e';
  const projectPath = resolveTestProjectPath('P4-ResumeBot-E2E');
  initProjectDir(projectPath);
  cleanDB(projectPath);

  // ── Pre-populate: create a half-built project with existing files ──
  console.log('\n  ─── Scaffolding existing project files ───');

  // Write existing project files to simulate a half-finished state
  const existingFiles = {
    'package.json': JSON.stringify({
      name: 'resumebot-api',
      version: '0.1.0',
      description: 'REST API for managing resumes and job applications',
      main: 'src/server.js',
      type: 'module',
      scripts: { start: 'node src/server.js', test: 'node tests/run.js' },
      dependencies: {
        express: '^4.18.2',
        'better-sqlite3': '^9.4.3',
        multer: '^1.4.5',
        'pdf-parse': '^1.1.1',
      },
    }, null, 2),

    'src/server.js': `import express from 'express';
import { initDb } from './db.js';

const app = express();
app.use(express.json());

initDb();

// TODO: Add routes
app.get('/health', (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(\`ResumeBot API on :\${PORT}\`));
`,

    'src/db.js': `import Database from 'better-sqlite3';
import { join } from 'path';

let db;

export function initDb() {
  db = new Database(join(process.cwd(), 'data', 'resumebot.sqlite'));
  db.pragma('journal_mode = WAL');
  db.exec(\`
    CREATE TABLE IF NOT EXISTS resumes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      summary TEXT,
      pdf_path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS experiences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resume_id INTEGER NOT NULL REFERENCES resumes(id),
      company TEXT NOT NULL,
      role TEXT NOT NULL,
      start_date TEXT,
      end_date TEXT,
      description TEXT
    );
  \`);
  return db;
}

export function getDb() { return db; }
`,

    'src/routes/resumes.js': `// TODO: implement CRUD routes for resumes
// GET /api/resumes — list all
// POST /api/resumes — create (JSON body)
// GET /api/resumes/:id — get one
// PUT /api/resumes/:id — update
// DELETE /api/resumes/:id — delete
// POST /api/resumes/:id/pdf — upload PDF
`,

    'README.md': `# ResumeBot API

REST API for managing resumes and job applications.

## Status: In Progress

- [x] Project setup
- [x] Database schema (resumes, experiences)
- [ ] CRUD routes for resumes
- [ ] PDF upload and parsing
- [ ] Job application tracker
- [ ] Search and filtering
- [ ] Export to PDF

## Stack

- Node.js + Express
- SQLite (better-sqlite3)
- Multer (file uploads)
- pdf-parse (PDF extraction)
`,

    'ROADMAP.md': `# ResumeBot Roadmap

## Milestone 1: Core CRUD (In Progress)
- Resume CRUD endpoints
- Experience sub-resource
- Basic validation

## Milestone 2: PDF Pipeline
- PDF upload via Multer
- Text extraction via pdf-parse
- Auto-populate resume fields from PDF

## Milestone 3: Job Tracker
- Applications table
- Link resumes to job postings
- Status tracking (applied/interview/offer/rejected)

## Milestone 4: Search & Export
- Full-text search across resumes
- Filter by skills, experience
- Export resume to formatted PDF
`,
  };

  for (const [filePath, content] of Object.entries(existingFiles)) {
    const fullPath = path.join(projectPath, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  try {
    execFileSync('git', ['add', '-A'], { cwd: projectPath, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'initial: project scaffold with DB + partial routes'], {
      cwd: projectPath, stdio: 'pipe',
    });
  } catch { /* ignore */ }

  console.log(`    Scaffolded ${Object.keys(existingFiles).length} files`);

  // Register project
  const project = projects.getOrCreate('ResumeBot E2E', projectPath, 'Resume API — half-built, E2E resume test');
  const projectId = Number(project.id);
  t.convId = `e2e-p4-${Date.now()}`;
  conversations.getOrCreate(t.convId, projectId, 'P4 — Resume Existing Project (Real LLM)');

  const executor = createExecutor(projectPath, 'Node.js Express API with SQLite');
  const context = { sessionId: SESSION_ID, executor, projectPath };
  let lifecycleId = null;

  try {
    // ── Turn 1: User asks agent to analyze and continue the project ──
    const msg1 = t.userTurn(
      'Mám tady rozdělaný projekt ResumeBot — REST API na správu životopisů. ' +
      'Podívej se na soubory, pochop v jaký fázi to je, a dokonči to. ' +
      'Databáze a server základ je hotový, chybí routes, PDF pipeline a job tracker.'
    );
    const resp1 = handleLifecycleBuildDetected(msg1, { intent: 'BUILD' }, context);
    t.systemTurn('PROPOSED', resp1);
    t.check(resp1?.content?.length > 20, 'T1: got substantive proposal');

    // ── Turn 2: Confirm lifecycle (must be standalone) ──
    const msg2 = t.userTurn('ano');
    const resp2 = await handleLifecycleInput(msg2, context);
    t.systemTurn('SPEC', resp2);

    const state2 = getLcState(SESSION_ID);
    t.check(state2?.phase === 'SPEC', 'T2: state is SPEC', `got: ${state2?.phase}`);
    lifecycleId = state2?.lifecycleId;

    // ── Turns 3-6: Spec answers — reference existing code ──
    const specRounds = await specLoop(t, SESSION_ID, context, [
      'Důležitý — nemaž co už tam je! Databázový schema je hotový, src/db.js funguje. ' +
      'Potřebuju dopsat routes v src/routes/resumes.js, přidat PDF upload endpoint, a job tracker. ' +
      'Existující README a ROADMAP popisují co zbývá. ' +
      'Existující kód: src/server.js (Express server, port 4000), src/db.js (SQLite schema ' +
      'pro resumes + experiences tabulky), src/routes/resumes.js (prázdný TODO). ' +
      'Co chybí: 1) CRUD routes pro resumes (GET/POST/PUT/DELETE /api/resumes, ' +
      'GET/POST/PUT/DELETE /api/resumes/:id/experiences). ' +
      '2) PDF upload POST /api/resumes/:id/pdf s Multer + pdf-parse extraction. ' +
      '3) Job tracker — nová tabulka applications (resume_id, company, position, status, applied_at).',

      'Validace: name je povinný (400 bez něj), email format check (regex), phone optional. ' +
      'PDF: max 5MB, uložit do ./data/pdfs/{resume_id}.pdf, extrahovat text a pokusit se ' +
      'naparsovat jméno, email, summary. Status values pro applications: ' +
      'applied, screening, interview, offer, rejected, accepted.',

      'Ano, vygeneruj spec. DB schema pro applications je nový — přidej k existujícím tabulkám. ' +
      'Nemazat resumes a experiences tabulky, jen přidat CREATE TABLE IF NOT EXISTS applications.',
    ]);

    t.check(
      getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW',
      'SPEC_REVIEW reached',
      `got: ${getLcState(SESSION_ID)?.phase}`
    );

    // ── Turn 6: Approve spec ──
    if (getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW') {
      const msg6 = t.userTurn('schvaluji');
      const resp6 = await handleLifecycleInput(msg6, context);
      t.systemTurn('SPEC → PLAN', resp6);
    }

    // ── Turn 7: Plan review ──
    const planState = getLcState(SESSION_ID);
    t.check(planState?.phase === 'PLAN_REVIEW', 'PLAN_REVIEW reached', `got: ${planState?.phase}`);

    if (planState?.phase === 'PLAN_REVIEW' && lifecycleId) {
      const milestones = msRepo.listByLifecycle(lifecycleId);
      t.check(milestones.length >= 2, 'Roadmap ≥2 milestones', `got: ${milestones.length}`);

      try { db.prepare('UPDATE milestones SET test_strategy = NULL WHERE lifecycle_id = ?').run(lifecycleId); } catch {}

      const msgPlan = t.userTurn('schvaluji');
      const respPlan = await handleLifecycleInput(msgPlan, context);
      t.systemTurn('PLAN → BUILD', respPlan);
    }

    // ── Turns 8-15: Build ──
    const buildResult = await buildLoop(t, SESSION_ID, context, { maxRounds: 25 });
    t.check(buildResult.completed >= 2, 'BUILD: ≥2 milestones completed', `got: ${buildResult.completed}`);

    // ── Final verification ──
    const allFiles = walkFiles(projectPath);
    t.check(allFiles.length >= 5, 'Files: ≥5 total (scaffold + generated)', `got: ${allFiles.length}`);

    // Verify original files still exist
    t.check(fs.existsSync(path.join(projectPath, 'src/server.js')), 'Preserve: src/server.js exists');
    t.check(fs.existsSync(path.join(projectPath, 'src/db.js')), 'Preserve: src/db.js exists');
    t.check(fs.existsSync(path.join(projectPath, 'package.json')), 'Preserve: package.json exists');

    // Check routes were populated
    const routesPath = path.join(projectPath, 'src/routes/resumes.js');
    if (fs.existsSync(routesPath)) {
      const routesContent = fs.readFileSync(routesPath, 'utf8');
      const hasCRUD = /get|post|put|delete|router/i.test(routesContent);
      t.check(routesContent.length > 100, 'Routes: resumes.js has substance', `got: ${routesContent.length} chars`);
      t.check(hasCRUD, 'Routes: has CRUD keywords');
    }

    // Git history should have original + milestone commits
    try {
      const gitLog = execFileSync('git', ['log', '--oneline'], {
        cwd: projectPath,
        encoding: 'utf8',
      });
      const commits = gitLog.trim().split('\n');
      t.check(commits.length >= 3, 'Git: ≥3 commits (scaffold + milestones)', `got: ${commits.length}`);
    } catch (e) {
      t.check(false, 'Git: log available', e.message);
    }

    t.check(t.turnNum >= 12, 'Turns: ≥12', `got: ${t.turnNum}`);

  } catch (err) {
    console.error(`\nFATAL P4: ${err.message}\n${err.stack}`);
    t.check(false, 'FATAL', err.message);
  }

  t.summary();
}


// ═════════════════════════════════════════════════════════════════════════════
// MAIN — Run All 4 Projects Sequentially
// ═════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('  Project Conversation E2E — 4 Diverse Projects (Real LLM)');
  console.log('══════════════════════════════════════════════════════════════════════');

  await runTests('P1-P4 Projects', [testP1_MalyAlchymista, testP2_QuizMaster, testP3_DetskyDenik, testP4_ResumeBot], '4projects');
}

main();
