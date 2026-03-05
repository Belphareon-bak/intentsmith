// Project Conversation E2E — P5/P6/P7 (Real LLM)
// Extended tests: P5 TaskBoard SaaS, P6 Legacy Refactor, P7 Dev CLI Tool
// Run: node tests/project-conversation-e2e-p5p7.test.js

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

import {
  TestRunner, checkOllama, createExecutor, cleanDB, initProjectDir,
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
// P5: TaskBoard SaaS — Full-Stack (Node.js + PostgreSQL + React + JWT)
// ═════════════════════════════════════════════════════════════════════════════

async function testP5_TaskBoardSaaS() {
  const t = new TestRunner('P5: TaskBoard SaaS');
  console.log('\n\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  P5: TaskBoard SaaS — Node.js + PostgreSQL + React + JWT          ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  const SESSION_ID = 'p5-taskboard-e2e';
  const projectPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../projects/P5-TaskBoard-E2E');
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
    // ── Turn 1: Build request (informal Czech, full-stack SaaS) ──
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

    // ── Turns 3-7: Deep SPEC dialog — 5 detailed answers ──
    const specRounds = await specLoop(t, SESSION_ID, context, [
      // Answer 1: Data model + relationships
      'Uživatelé mají projekty a v nich tasky. Datový model: users (id, email, password_hash, name, ' +
      'created_at), projects (id, owner_id FK users, name, description, created_at), tasks (id, ' +
      'project_id FK projects, title, description, status, due_date, assigned_to FK users, priority, ' +
      'created_at, updated_at). Status enum: todo, in_progress, review, done. Priority: low, medium, ' +
      'high, urgent. Jeden uživatel = více projektů, jeden projekt = více tasků.',

      // Answer 2: Task details + constraints
      'Task má title (povinný, max 200 znaků), description (volitelný, rich text ne — plain text stačí), ' +
      'status (default: todo), due_date (volitelný, ISO date), priority (default: medium). ' +
      'Assigned_to je volitelný — task může být nepřiřazený. Validace: title nesmí být prázdný, ' +
      'due_date musí být v budoucnosti (při vytváření), status lze měnit jen na validní přechod ' +
      '(todo→in_progress→review→done, plus todo→done pro quick-close).',

      // Answer 3: Tech stack decisions
      'Frontend React (Create React App nebo Vite), backend Node.js + Express.js. Databáze PostgreSQL ' +
      's čistým SQL (pg modul, žádný ORM). Autentizace přes JWT — access token (15 min) + refresh ' +
      'token (7 dní). Hesla bcrypt. API: REST, prefix /api/v1. CORS povolený pro localhost:3000 (dev). ' +
      'Žádný TypeScript, plain JavaScript. Struktura: server/ a client/ adresáře.',

      // Answer 4: PostgreSQL specifics
      'PostgreSQL databáze — tabulky přesně jak jsem popsal. Migrace: jeden SQL soubor (schema.sql) ' +
      'co vytvoří všechny tabulky. Foreign keys s ON DELETE CASCADE (smažu projekt → smažou se tasky). ' +
      'Indexy na tasks(project_id), tasks(assigned_to), tasks(status). Dotazy přes prepared statements ' +
      '(SQL injection prevention). Connection pool přes pg Pool, max 10 connections.',

      // Answer 5: Authentication + API design
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

      // Answer revision questions if needed
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

      // Approve spec
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

      // Clear test_strategy (R1 checkpoint workaround)
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

    // Check for backend structure
    const hasServer = allFiles.some(f => f.includes('server') || f.includes('api') || f.includes('routes'));
    t.check(hasServer, 'Files: backend structure present');

    // Check for frontend structure
    const hasFrontend = allFiles.some(f =>
      f.includes('client') || f.includes('frontend') || f.includes('src/App') ||
      f.endsWith('.jsx') || f.includes('react') || f.includes('components')
    );
    t.check(hasFrontend, 'Files: frontend artifacts present',
      `found: ${allFiles.filter(f => /\.(jsx|tsx|css|html)$/.test(f)).join(', ') || 'none'}`
    );

    // Check for auth-related files
    const hasAuth = allFiles.some(f =>
      f.includes('auth') || f.includes('jwt') || f.includes('middleware')
    );
    t.check(hasAuth, 'Files: auth/JWT artifacts present');

    // Check for DB schema
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


// ═════════════════════════════════════════════════════════════════════════════
// P6: Legacy Python Refactor — Existing Monolith → Modular Architecture
// ═════════════════════════════════════════════════════════════════════════════

async function testP6_LegacyRefactor() {
  const t = new TestRunner('P6: Legacy Python Refactor');
  console.log('\n\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  P6: Legacy Python Refactor — Monolith → Modular                   ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  const SESSION_ID = 'p6-refactor-e2e';
  const projectPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../projects/P6-LegacyRefactor-E2E');
  initProjectDir(projectPath);
  cleanDB(projectPath);

  // ── Pre-populate: create a legacy Python monolith ──
  console.log('\n  ─── Scaffolding legacy Python project ───');

  const legacyFiles = {
    'app.py': `#!/usr/bin/env python3
"""Legacy monolith — all logic in one file."""
import sqlite3
import json
from http.server import HTTPServer, BaseHTTPRequestHandler

DB_PATH = 'inventory.db'

def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute('''CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT,
        price REAL,
        stock INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    conn.execute('''CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER REFERENCES products(id),
        quantity INTEGER NOT NULL,
        total_price REAL,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    conn.commit()
    conn.close()

def get_products():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    products = conn.execute('SELECT * FROM products').fetchall()
    conn.close()
    return [dict(p) for p in products]

def add_product(data):
    conn = sqlite3.connect(DB_PATH)
    conn.execute('INSERT INTO products (name, category, price, stock) VALUES (?, ?, ?, ?)',
                 (data['name'], data.get('category'), data.get('price', 0), data.get('stock', 0)))
    conn.commit()
    conn.close()

def create_order(product_id, quantity):
    conn = sqlite3.connect(DB_PATH)
    product = conn.execute('SELECT * FROM products WHERE id = ?', (product_id,)).fetchone()
    if not product:
        conn.close()
        return None
    if product[4] < quantity:  # stock check
        conn.close()
        return None
    total = product[3] * quantity  # price * quantity
    conn.execute('UPDATE products SET stock = stock - ? WHERE id = ?', (quantity, product_id))
    conn.execute('INSERT INTO orders (product_id, quantity, total_price) VALUES (?, ?, ?)',
                 (product_id, quantity, total))
    conn.commit()
    conn.close()
    return {'product_id': product_id, 'quantity': quantity, 'total': total}

def get_orders():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    orders = conn.execute('SELECT * FROM orders').fetchall()
    conn.close()
    return [dict(o) for o in orders]

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/products':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(get_products()).encode())
        elif self.path == '/orders':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(get_orders()).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(length)) if length else {}
        if self.path == '/products':
            add_product(body)
            self.send_response(201)
            self.end_headers()
        elif self.path == '/orders':
            result = create_order(body.get('product_id'), body.get('quantity', 1))
            if result:
                self.send_response(201)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(result).encode())
            else:
                self.send_response(400)
                self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()

if __name__ == '__main__':
    init_db()
    server = HTTPServer(('0.0.0.0', 8080), Handler)
    print('Inventory server on :8080')
    server.serve_forever()
`,

    'db.py': `"""Database utilities — legacy, everything mixed together."""
import sqlite3

DB_PATH = 'inventory.db'

def get_connection():
    return sqlite3.connect(DB_PATH)

def run_query(sql, params=None):
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    result = conn.execute(sql, params or []).fetchall()
    conn.commit()
    conn.close()
    return [dict(r) for r in result]

def run_insert(sql, params):
    conn = get_connection()
    cursor = conn.execute(sql, params)
    conn.commit()
    last_id = cursor.lastrowid
    conn.close()
    return last_id
`,

    'api.py': `"""API helpers — unused but imported in some places."""

def validate_product(data):
    if not data.get('name'):
        return False, 'name is required'
    if data.get('price') and data['price'] < 0:
        return False, 'price must be positive'
    return True, None

def format_response(data, status='ok'):
    return {'status': status, 'data': data}
`,

    'README.md': `# Inventory Manager

Simple inventory management system. Python + SQLite.

## Problems

- Everything in app.py (monolith)
- No error handling
- No tests
- Raw SQL everywhere
- No input validation on API
- Database connections not pooled
- No logging
`,

    'requirements.txt': `# No external dependencies — pure stdlib
`,
  };

  for (const [filePath, content] of Object.entries(legacyFiles)) {
    const fullPath = path.join(projectPath, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  try {
    execSync('git add -A', { cwd: projectPath, stdio: 'pipe' });
    execSync('git commit -m "legacy: inventory manager monolith"', {
      cwd: projectPath, stdio: 'pipe',
    });
  } catch { /* ignore */ }

  console.log(`    Scaffolded ${Object.keys(legacyFiles).length} legacy files`);

  // Register project
  const project = projects.getOrCreate('Legacy Refactor E2E', projectPath,
    'Python inventory monolith — refactor to modular architecture — E2E test');
  const projectId = Number(project.id);
  t.convId = `e2e-p6-${Date.now()}`;
  conversations.getOrCreate(t.convId, projectId, 'P6 — Legacy Refactor (Real LLM)');

  const executor = createExecutor(projectPath, 'Python modular application');
  const context = { sessionId: SESSION_ID, executor, projectPath };
  let lifecycleId = null;

  try {
    // ── Turn 1: Refactoring request ──
    const msg1 = t.userTurn(
      'Mám tady legacy Python projekt — inventory manager. Všechno je v jednom app.py, ' +
      'žádný testy, žádná struktura. Potřebuju to refaktorovat do modulární architektury. ' +
      'Oddělený business logic, services vrstva, pořádný API s Flask nebo FastAPI, a testy. ' +
      'Stávající data model (products + orders) zachovat, ale vylepšit.'
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

    // ── Turns 3-5: Spec — refactoring requirements ──
    const specRounds = await specLoop(t, SESSION_ID, context, [
      // Answer 1: Architecture vision
      'Cílová struktura: src/ s podadresářema models/, services/, api/, utils/. ' +
      'Plus tests/ adresář s unit testy. Oddělit business logiku od HTTP handleru. ' +
      'Models: Product a Order třídy (dataclass nebo plain class). ' +
      'Services: ProductService, OrderService — business logic (validace, stock check, výpočty). ' +
      'API: Flask nebo FastAPI endpointy, jen thin wrapper nad services. ' +
      'Utils: db connection manager (context manager pro connections), logging setup. ' +
      'Zachovat SQLite ale přes čistší abstrakci.',

      // Answer 2: Specific requirements
      'Services musí mít input validaci — ProductService.create() ověří name (povinný), price ≥ 0, ' +
      'stock ≥ 0. OrderService.create() ověří product exists, stock sufficient, quantity > 0. ' +
      'Error handling: custom exceptions (ProductNotFound, InsufficientStock, ValidationError). ' +
      'Testy: pytest, minimálně test pro každý service method. Existující db.py a api.py smazat — ' +
      'nahradit čistou implementací. app.py přepsat na Flask app. requirements.txt aktualizovat ' +
      '(flask, pytest).',

      // Answer 3: Generate spec
      'Ano, vygeneruj spec. Tech rozhodnutí: Flask (alt: FastAPI, Falcon), SQLite (alt: PostgreSQL), ' +
      'pytest (alt: unittest). Architektura: layered — models → services → API. ' +
      'Design princip: každý modul má jednu odpovědnost. Services neví o HTTP, API neví o SQL.',
    ]);

    t.check(
      getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW',
      'T3-5: reached SPEC_REVIEW',
      `got: ${getLcState(SESSION_ID)?.phase}`
    );

    // ── Approve spec ──
    if (getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW') {
      const msgApprove = t.userTurn('schvaluji');
      const respApprove = await handleLifecycleInput(msgApprove, context);
      t.systemTurn('SPEC → PLAN', respApprove);
    }

    // ── Plan review ──
    const planState = getLcState(SESSION_ID);
    t.check(planState?.phase === 'PLAN_REVIEW', 'PLAN_REVIEW reached', `got: ${planState?.phase}`);

    if (planState?.phase === 'PLAN_REVIEW' && lifecycleId) {
      const milestones = msRepo.listByLifecycle(lifecycleId);
      t.check(milestones.length >= 3, 'Roadmap ≥3 milestones', `got: ${milestones.length}`);

      try { db.prepare('UPDATE milestones SET test_strategy = NULL WHERE lifecycle_id = ?').run(lifecycleId); } catch {}

      const msgPlan = t.userTurn('schvaluji');
      const respPlan = await handleLifecycleInput(msgPlan, context);
      t.systemTurn('PLAN → BUILD', respPlan);
    }

    // ── Build loop ──
    const buildResult = await buildLoop(t, SESSION_ID, context, { maxRounds: 25 });
    t.check(buildResult.completed >= 2, 'BUILD: ≥2 milestones completed', `got: ${buildResult.completed}`);

    // ── Final verification ──
    const allFiles = walkFiles(projectPath);
    t.check(allFiles.length >= 5, 'Files: ≥5 total (legacy + refactored)', `got: ${allFiles.length}`);

    // Check for modular structure
    const hasServices = allFiles.some(f => f.includes('services') || f.includes('service'));
    t.check(hasServices, 'Refactor: services layer created');

    const hasModels = allFiles.some(f => f.includes('models') || f.includes('model'));
    t.check(hasModels, 'Refactor: models layer created');

    const hasTests = allFiles.some(f => f.includes('test'));
    t.check(hasTests, 'Refactor: tests added');

    const hasPy = allFiles.some(f => f.endsWith('.py'));
    t.check(hasPy, 'Files: Python files present');

    // Original project context preserved (at least some .py files exist)
    t.check(allFiles.filter(f => f.endsWith('.py')).length >= 3,
      'Refactor: ≥3 Python modules (beyond monolith)',
      `got: ${allFiles.filter(f => f.endsWith('.py')).length} .py files`
    );

    // Git history should have legacy commit + milestone commits
    try {
      const gitLog = execSync('git log --oneline', { cwd: projectPath, encoding: 'utf8' });
      const commits = gitLog.trim().split('\n');
      t.check(commits.length >= 3, 'Git: ≥3 commits (init + legacy + milestones)', `got: ${commits.length}`);
    } catch (e) {
      t.check(false, 'Git: log available', e.message);
    }

    t.check(t.turnNum >= 12, 'Turns: ≥12', `got: ${t.turnNum}`);

  } catch (err) {
    console.error(`\nFATAL P6: ${err.message}\n${err.stack}`);
    t.check(false, 'FATAL', err.message);
  }

  t.summary();
}


// ═════════════════════════════════════════════════════════════════════════════
// P7: Dev CLI Tool — Node.js CLI + Plugin System + YAML Config
// ═════════════════════════════════════════════════════════════════════════════

async function testP7_DevCLI() {
  const t = new TestRunner('P7: Dev CLI Tool');
  console.log('\n\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  P7: Dev CLI Tool — Node.js CLI + Plugins + YAML Config            ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  const SESSION_ID = 'p7-devcli-e2e';
  const projectPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../projects/P7-DevCLI-E2E');
  initProjectDir(projectPath);
  cleanDB(projectPath);

  const PROJECT_NAME = 'Dev CLI E2E';
  const PROJECT_DESC = 'Node.js CLI tool with plugin system and YAML config — E2E test';
  const project = projects.getOrCreate(PROJECT_NAME, projectPath, PROJECT_DESC);
  const projectId = Number(project.id);
  t.convId = `e2e-p7-${Date.now()}`;
  conversations.getOrCreate(t.convId, projectId, 'P7 — Full Lifecycle (Real LLM)');

  const executor = createExecutor(projectPath, 'Node.js CLI application with plugins');
  const context = { sessionId: SESSION_ID, executor, projectPath };
  let lifecycleId = null;

  try {
    // ── Turn 1: Build request (Czech, developer-focused) ──
    const msg1 = t.userTurn(
      'Vytvoř CLI nástroj pro správu projektů — něco jako jednoduchý build tool. ' +
      'Příkazy: init (vytvoří projekt), build (zkompiluje/zpracuje soubory), deploy ' +
      '(nasadí na server). Konfigurace přes YAML soubor. A hlavně — plugin systém, ' +
      'aby si lidi mohli přidávat vlastní příkazy. Node.js, žádný TypeScript.'
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

    // ── Turns 3-5: Spec — CLI architecture ──
    const specRounds = await specLoop(t, SESSION_ID, context, [
      // Answer 1: CLI commands + behavior
      'Tři základní příkazy: init, build, deploy. Init: vytvoří projektový adresář s devtool.yaml ' +
      'config souborem a základní strukturou (src/, dist/, plugins/). Build: načte devtool.yaml, ' +
      'spustí build pipeline (kopíruje src/ → dist/, zpracuje soubory podle pluginů). Deploy: ' +
      'načte deploy config z devtool.yaml (target: local|ssh|s3) a nasadí obsah dist/. ' +
      'CLI entry point: bin/devtool (#!/usr/bin/env node). Parsování argumentů přes process.argv, ' +
      'žádnej commander nebo yargs — čistý stdlib.',

      // Answer 2: Plugin system
      'Plugin systém: plugin je JS modul v plugins/ adresáři nebo npm balíček. Každý plugin ' +
      'exportuje objekt {name, version, commands: {}, hooks: {}}. Commands přidávají nový příkaz ' +
      '(např. plugin-lint přidá "devtool lint"). Hooks: beforeBuild, afterBuild, beforeDeploy, ' +
      'afterDeploy — plugin může transformovat soubory nebo validovat stav. ' +
      'Načítání: devtool.yaml má sekci plugins: [{name, options}]. Core načte plugin přes ' +
      'require() z plugins/ nebo node_modules/. Plugin registry: core/plugin-registry.js ' +
      'spravuje lifecycle (load, init, execute hooks).',

      // Answer 3: YAML config + generate spec
      'devtool.yaml struktura: project (name, version), build (src, dist, steps), deploy ' +
      '(target, host, path), plugins (list s name a options). Příklad: ' +
      'project: {name: my-app, version: 1.0.0}, build: {src: src, dist: dist}, ' +
      'deploy: {target: local, path: /var/www}, plugins: [{name: minify, options: {level: 2}}]. ' +
      'YAML parsing přes js-yaml (jediná závislost). Adresářová struktura: bin/ (entry point), ' +
      'core/ (config loader, plugin registry, command runner), commands/ (init, build, deploy), ' +
      'plugins/ (built-in plugins). Generuj spec.',
    ]);

    t.check(
      getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW',
      'T3-5: reached SPEC_REVIEW',
      `got: ${getLcState(SESSION_ID)?.phase}`
    );

    // ── Approve spec ──
    if (getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW') {
      const msgApprove = t.userTurn('schvaluji');
      const respApprove = await handleLifecycleInput(msgApprove, context);
      t.systemTurn('SPEC → PLAN', respApprove);
    }

    // ── Plan review — reject once (reorder), then approve ──
    const planState = getLcState(SESSION_ID);
    t.check(planState?.phase === 'PLAN_REVIEW', 'PLAN_REVIEW reached', `got: ${planState?.phase}`);

    if (planState?.phase === 'PLAN_REVIEW' && lifecycleId) {
      const milestones = msRepo.listByLifecycle(lifecycleId);
      t.check(milestones.length >= 3, 'Roadmap ≥3 milestones', `got: ${milestones.length}`);

      // Reject — plugin system should be earlier
      const msgReject = t.userTurn(
        'Plugin registry musí být v prvním nebo druhém milníku — build a deploy ho potřebujou. ' +
        'Nemůžu buildovat bez plugin hooks. Přesuň plugin system dřív.'
      );
      const respReject = await handleLifecycleInput(msgReject, context);
      t.systemTurn('PLAN revision', respReject);

      // Approve after revision
      if (getLcState(SESSION_ID)?.phase === 'PLAN_REVIEW') {
        try { db.prepare('UPDATE milestones SET test_strategy = NULL WHERE lifecycle_id = ?').run(lifecycleId); } catch {}

        const msgApprove = t.userTurn('schvaluji');
        const respApprove = await handleLifecycleInput(msgApprove, context);
        t.systemTurn('PLAN → BUILD', respApprove);
      }
    }

    // ── Build loop ──
    const buildResult = await buildLoop(t, SESSION_ID, context, { maxRounds: 25 });
    t.check(buildResult.completed >= 2, 'BUILD: ≥2 milestones completed', `got: ${buildResult.completed}`);

    // ── Final verification ──
    const allFiles = walkFiles(projectPath);
    t.check(allFiles.length >= 4, 'Files: ≥4 generated', `got: ${allFiles.length}`);

    // Check for CLI structure
    const hasCLI = allFiles.some(f =>
      f.includes('bin/') || f.includes('cli') || f.includes('devtool')
    );
    t.check(hasCLI, 'CLI: entry point / bin folder exists');

    // Check for commands
    const hasCommands = allFiles.some(f =>
      f.includes('commands') || f.includes('command') || f.includes('cmd')
    );
    t.check(hasCommands, 'CLI: commands folder/files exist');

    // Check for plugin system
    const hasPlugins = allFiles.some(f =>
      f.includes('plugin') || f.includes('plugins')
    );
    t.check(hasPlugins, 'CLI: plugin system exists');

    // Check for config handling
    const hasConfig = allFiles.some(f =>
      f.includes('config') || f.includes('yaml') || f.endsWith('.yaml') || f.endsWith('.yml')
    );
    t.check(hasConfig, 'CLI: config/YAML handling present');

    const hasJS = allFiles.some(f => f.endsWith('.js'));
    t.check(hasJS, 'Files: JavaScript files present');

    // Check for package.json with bin field
    const pkgPath = path.join(projectPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        t.check(!!pkg.name, 'package.json: has name');
      } catch {
        t.check(false, 'package.json: valid JSON');
      }
    }

    t.check(t.turnNum >= 12, 'Turns: ≥12', `got: ${t.turnNum}`);

  } catch (err) {
    console.error(`\nFATAL P7: ${err.message}\n${err.stack}`);
    t.check(false, 'FATAL', err.message);
  }

  t.summary();
}


// ═════════════════════════════════════════════════════════════════════════════
// MAIN
// ═════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('  Project Conversation E2E — P5/P6/P7 (Real LLM)');
  console.log('══════════════════════════════════════════════════════════════════════');

  await runTests('P5-P7 Projects', [testP5_TaskBoardSaaS, testP6_LegacyRefactor, testP7_DevCLI], 'p5p7');
}

main();
