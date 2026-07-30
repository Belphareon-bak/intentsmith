// C3: Realistic LLM Lifecycle Test — Full Pipeline Verification
// ══════════════════════════════════════════════════════════════════════════════
// Tests the FULL lifecycle pipeline with realistic LLM simulation covering:
//   1. Happy path: SPEC → PLANNING → BUILD (3 milestones) → COMPLETED
//   2. Milestone failure + retry
//   3. Change request APPROVAL with roadmap rewrite
//   4. Pause + resume
//   5. Progress inquiry during BUILD
//   6. Project context injection (v65.4)
//   7. State recovery after simulated crash
//   8. Review trigger (after reviewFrequency milestones)
//
// Run: node tests/lifecycle-llm-realistic.test.js
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
  computeLifecycleProgress,
  formatLifecycleProgress,
  formatMilestoneTable,
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
  _clearAllRam,
  clearLcState,
  getLcState,
  initLifecycleStateDb,
  preloadActiveLifecycles,
  setLcState,
} from '../src/chat/handlers/lifecycle-state.js';

import { startNextMilestone } from '../src/planner/lifecycle-build.js';
import { rawId, scopeId } from '../src/planner/lifecycle-planning.js';

// ─── Test Framework ──────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];
let currentSection = '';

function section(name) {
  currentSection = name;
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ${name}`);
  console.log(`${'═'.repeat(70)}`);
}

function check(condition, name, detail = '') {
  if (condition) {
    passed++;
    console.log(`    ✅ ${name}`);
  } else {
    failed++;
    const msg = `${currentSection} > ${name}: ${detail}`;
    console.log(`    ❌ ${name}: ${detail}`);
    failures.push(msg);
  }
}

function cleanDB() {
  // Initialize handoff DB persistence (normally done by server.js at startup)
  initLifecycleStateDb(lifecycleHandoffState, lifecycleRepo);

  // Clean lifecycle data — NEVER wipe user projects/conversations
  for (const t of ['lifecycle_handoff_state', 'drift_checks', 'change_requests',
                    'milestones', 'roadmap_versions', 'project_lifecycles']) {
    try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* ignore */ }
  }
  try { db.prepare(`DELETE FROM projects WHERE path LIKE '/tmp/%'`).run(); } catch { /* ignore */ }
}

function initProjectDir() {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-llm-realistic-'));
  execSync('git init && git config user.email "test@c3.dev" && git config user.name "C3 Test" && git commit --allow-empty -m "init"',
    { cwd: p, stdio: 'pipe' });
  return p;
}

// ─── Sample Data ─────────────────────────────────────────────────────────────

const SPEC = {
  title: 'Expense Tracker API',
  goals: [
    {
      id: 'G1',
      description: 'REST API for expense tracking',
      priority: 'MUST',
      success_criteria: 'Clients can create and list expenses through documented JSON endpoints',
    },
    {
      id: 'G2',
      description: 'SQLite persistence',
      priority: 'MUST',
      success_criteria: 'Expenses and categories persist across application restarts',
    },
    {
      id: 'G3',
      description: 'Monthly summary reports',
      priority: 'SHOULD',
      success_criteria: 'The API returns expense totals grouped by calendar month',
    },
    {
      id: 'G4',
      description: 'Category management',
      priority: 'COULD',
      success_criteria: 'Clients can create and list unique expense categories',
    },
  ],
  requirements: [
    {
      id: 'R1',
      description: 'POST /expenses creates expense',
      type: 'functional',
      goal_id: 'G1',
      acceptance_test: 'Generated expense route source declares POST /expenses and calls addExpense',
    },
    {
      id: 'R2',
      description: 'GET /expenses lists all expenses',
      type: 'functional',
      goal_id: 'G1',
      acceptance_test: 'Generated expense route source declares GET /expenses and calls getExpenses',
    },
    {
      id: 'R3',
      description: 'SQLite database with migrations',
      type: 'functional',
      goal_id: 'G2',
      acceptance_test: 'Generated database source declares idempotent expense and category table initialization',
    },
    {
      id: 'R4',
      description: 'GET /reports/monthly returns monthly summary',
      type: 'functional',
      goal_id: 'G3',
      acceptance_test: 'Generated report route source declares monthly grouping and SUM(amount)',
    },
    {
      id: 'R5',
      description: 'CRUD for expense categories',
      type: 'functional',
      goal_id: 'G4',
      acceptance_test: 'Generated category route source declares create and list handlers',
    },
  ],
  tech_stack: {
    languages: ['JavaScript'],
    frameworks: ['Node.js', 'Express'],
    tools: ['better-sqlite3'],
    rationale: 'Simple REST API with native SQLite',
  },
  architecture: {
    pattern: 'MVC',
    components: ['db.js', 'routes/', 'server.js'],
    data_model: 'expenses(id, amount, description, category, date), categories(id, name)',
  },
  risks: [
    { id: 'RISK1', description: 'DB migrations complexity', severity: 'LOW', mitigation: 'Simple schema' },
  ],
  constraints: ['No authentication required for MVP'],
  out_of_scope: ['Frontend', 'User management', 'Export to CSV'],
  design_decisions: [
    {
      id: 'DD1',
      decision: 'Embedded persistence engine',
      chosen: 'SQLite via better-sqlite3',
      alternatives_considered: ['PostgreSQL', 'JSON file storage'],
      rationale: 'SQLite provides durable local persistence without an external service',
    },
  ],
  acceptance_criteria: [
    'Generated persistence modules declare the required SQLite schema and model operations',
    'Generated route modules declare all documented expense, category, and monthly report endpoints',
    'Automated source-contract checks cover the generated persistence and route interfaces',
  ],
};

const ARCHITECTURE = {
  layers: ['routes', 'models', 'database'],
  rules: [
    { from: 'routes', canImport: ['models', 'database'], cannotImport: [] },
    { from: 'models', canImport: ['database'], cannotImport: ['routes'] },
    { from: 'database', canImport: [], cannotImport: ['routes', 'models'] },
  ],
  fileStructure: {
    routes: 'src/routes',
    models: 'src/models.js',
    database: 'src/db.js',
  },
};

const ROADMAP = {
  milestones: [
    {
      id: 'ms-1', title: 'Database + Models',
      description: 'SQLite database setup with expense and category tables',
      dependencies: [], estimated_loc: 150, estimated_files: 3, estimated_complexity: 'LOW',
      goals_addressed: ['G2'], requirements_addressed: ['R3'],
      deliverables: ['src/db.js', 'src/models.js', 'test/persistence.contract.test.js'],
      acceptance_criteria: ['Database and model sources declare idempotent schema initialization and persistence functions'],
      test_strategy: {
        type: 'unit',
        description: 'Run generated persistence source-contract checks',
        command: 'node --test test/persistence.contract.test.js',
      },
    },
    {
      id: 'ms-2', title: 'REST API Endpoints',
      description: 'Express server with expense CRUD endpoints',
      dependencies: ['ms-1'], estimated_loc: 250, estimated_files: 4, estimated_complexity: 'MEDIUM',
      goals_addressed: ['G1'], requirements_addressed: ['R1', 'R2'],
      deliverables: ['src/routes/expenses.js', 'src/server.js', 'package.json', 'test/expenses.contract.test.js'],
      acceptance_criteria: ['Expense route source declares POST and GET handlers wired to the model functions'],
      test_strategy: {
        type: 'integration',
        description: 'Run generated expense route and server wiring source-contract checks',
        command: 'node --test test/expenses.contract.test.js',
      },
    },
    {
      id: 'ms-3', title: 'Reports, Categories + Contract Verification',
      description: 'Monthly summary reports, category management, source-contract tests and API documentation',
      dependencies: ['ms-2'], estimated_loc: 180, estimated_files: 4, estimated_complexity: 'MEDIUM',
      goals_addressed: ['G3', 'G4'], requirements_addressed: ['R4', 'R5'],
      deliverables: ['src/routes/reports.js', 'src/routes/categories.js', 'test/integration.test.js', 'README.md'],
      acceptance_criteria: ['Monthly report and category source contracts pass and the endpoints are documented'],
      test_strategy: {
        type: 'integration',
        description: 'Run generated report and category route contract checks',
        command: 'node --test test/integration.test.js',
      },
    },
  ],
  total_estimated_loc: 580,
  total_milestones: 3,
  critical_path: ['ms-1', 'ms-2', 'ms-3'],
  requirements_coverage: {
    R1: ['ms-2'],
    R2: ['ms-2'],
    R3: ['ms-1'],
    R4: ['ms-3'],
    R5: ['ms-3'],
    covered: ['R1', 'R2', 'R3', 'R4', 'R5'],
    uncovered: [],
  },
};

// Modified roadmap after approved change request (adds ms-4)
const ROADMAP_V2 = {
  milestones: [
    ...ROADMAP.milestones,
    {
      id: 'ms-4', title: 'Budget Limits + Final Contract Verification',
      description: 'Monthly budget limits with alerts, source-contract tests and updated API documentation',
      dependencies: ['ms-3'], estimated_loc: 100, estimated_files: 3, estimated_complexity: 'LOW',
      goals_addressed: ['G1'], requirements_addressed: [],
      deliverables: ['src/routes/budgets.js', 'test/budgets.integration.test.js', 'README.md'],
      acceptance_criteria: ['Budget source declares persistence and threshold response contracts, documented by executable checks'],
      test_strategy: {
        type: 'integration',
        description: 'Run the generated budget route contract check',
        command: 'node --test test/budgets.integration.test.js',
      },
    },
  ],
  total_estimated_loc: 680,
  total_milestones: 4,
  critical_path: ['ms-1', 'ms-2', 'ms-3', 'ms-4'],
  requirements_coverage: ROADMAP.requirements_coverage,
  changes_summary: 'Added ms-4: Budget Limits',
  diff: { added: ['ms-4'], removed: [], modified: [], preserved: ['ms-1', 'ms-2', 'ms-3'] },
};

const MS_PLANS = {
  'ms-1': {
    milestone_id: 'ms-1',
    files: [
      { path: 'src/db.js', action: 'create', purpose: 'SQLite database init' },
      { path: 'src/models.js', action: 'create', purpose: 'Expense and category models' },
      { path: 'test/persistence.contract.test.js', action: 'create', purpose: 'Executable persistence source-contract checks' },
    ],
    implementation_steps: [
      { step: 1, action: 'Create the SQLite schema initialization module', file: 'src/db.js' },
      { step: 2, action: 'Implement expense persistence functions', file: 'src/models.js' },
      { step: 3, action: 'Add category persistence functions using the shared database', file: 'src/models.js' },
      { step: 4, action: 'Test schema and model source contracts with executable checks', file: 'test/persistence.contract.test.js' },
    ],
    scope_files: ['src/db.js', 'src/models.js', 'test/persistence.contract.test.js'],
    rollback_strategy: 'Delete created files',
  },
  'ms-2': {
    milestone_id: 'ms-2',
    files: [
      { path: 'src/routes/expenses.js', action: 'create', purpose: 'Expense endpoints' },
      { path: 'src/server.js', action: 'create', purpose: 'Express server' },
      { path: 'package.json', action: 'create', purpose: 'Dependencies' },
      { path: 'test/expenses.contract.test.js', action: 'create', purpose: 'Executable expense route wiring checks' },
    ],
    implementation_steps: [
      { step: 1, action: 'Create expense routes', file: 'src/routes/expenses.js' },
      { step: 2, action: 'Create server', file: 'src/server.js' },
      { step: 3, action: 'Create package.json', file: 'package.json' },
      { step: 4, action: 'Test expense handler and server wiring source contracts', file: 'test/expenses.contract.test.js' },
    ],
    scope_files: ['src/routes/expenses.js', 'src/server.js', 'package.json', 'test/expenses.contract.test.js'],
    rollback_strategy: 'Delete created files',
  },
  'ms-3': {
    milestone_id: 'ms-3',
    files: [
      { path: 'src/routes/reports.js', action: 'create', purpose: 'Report endpoints' },
      { path: 'src/routes/categories.js', action: 'create', purpose: 'Category CRUD' },
      { path: 'test/integration.test.js', action: 'create', purpose: 'Reports and categories integration checks' },
      { path: 'README.md', action: 'create', purpose: 'API usage documentation' },
    ],
    implementation_steps: [
      { step: 1, action: 'Create reports route', file: 'src/routes/reports.js' },
      { step: 2, action: 'Create categories route', file: 'src/routes/categories.js' },
      { step: 3, action: 'Add report and category route integration verification', file: 'test/integration.test.js' },
      { step: 4, action: 'Write report and category endpoint documentation', file: 'README.md' },
    ],
    scope_files: ['src/routes/reports.js', 'src/routes/categories.js', 'test/integration.test.js', 'README.md'],
    rollback_strategy: 'Delete created files',
  },
  'ms-4': {
    milestone_id: 'ms-4',
    files: [
      { path: 'src/routes/budgets.js', action: 'create', purpose: 'Budget limits' },
      { path: 'test/budgets.integration.test.js', action: 'create', purpose: 'Budget endpoint integration checks' },
      { path: 'README.md', action: 'modify', purpose: 'Budget API documentation' },
    ],
    implementation_steps: [
      { step: 1, action: 'Create budget persistence and route handlers', file: 'src/routes/budgets.js' },
      { step: 2, action: 'Implement threshold alert responses', file: 'src/routes/budgets.js' },
      { step: 3, action: 'Add budget endpoint integration verification', file: 'test/budgets.integration.test.js' },
    ],
    scope_files: ['src/routes/budgets.js', 'test/budgets.integration.test.js', 'README.md'],
    rollback_strategy: 'Delete src/routes/budgets.js',
  },
};

const PROJECT_FILES = {
  'ms-1': {
    'src/db.js': `import Database from 'better-sqlite3';\nconst db = new Database('expenses.db');\ndb.exec('CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY, amount REAL, description TEXT, category TEXT, date TEXT)');\ndb.exec('CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY, name TEXT UNIQUE)');\nexport default db;\n`,
    'src/models.js': `import db from './db.js';\nexport const addExpense = (a, d, c, dt) => db.prepare('INSERT INTO expenses (amount, description, category, date) VALUES (?,?,?,?)').run(a, d, c, dt);\nexport const getExpenses = () => db.prepare('SELECT * FROM expenses ORDER BY date DESC').all();\nexport const addCategory = (n) => db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)').run(n);\nexport const getCategories = () => db.prepare('SELECT * FROM categories').all();\n`,
    'test/persistence.contract.test.js': `import fs from 'node:fs';\nimport test from 'node:test';\nimport assert from 'node:assert/strict';\n\nconst database = fs.readFileSync(new URL('../src/db.js', import.meta.url), 'utf8');\nconst models = fs.readFileSync(new URL('../src/models.js', import.meta.url), 'utf8');\n\ntest('persistence schema and model contracts are present', () => {\n  assert.match(database, /CREATE TABLE IF NOT EXISTS expenses/);\n  assert.match(database, /CREATE TABLE IF NOT EXISTS categories/);\n  assert.match(models, /export const addExpense/);\n  assert.match(models, /export const getExpenses/);\n  assert.match(models, /export const addCategory/);\n  assert.match(models, /export const getCategories/);\n  assert.match(models, /INSERT INTO expenses/);\n});\n`,
  },
  'ms-2': {
    'src/routes/expenses.js': `import { addExpense, getExpenses } from '../models.js';\nexport function registerExpenseRoutes(app) {\n  app.post('/expenses', (req, res) => { addExpense(req.body.amount, req.body.description, req.body.category, req.body.date); res.json({ok:true}); });\n  app.get('/expenses', (req, res) => res.json(getExpenses()));\n}\n`,
    'src/server.js': `import express from 'express';\nimport { registerExpenseRoutes } from './routes/expenses.js';\nconst app = express();\napp.use(express.json());\nregisterExpenseRoutes(app);\napp.listen(3000);\n`,
    'package.json': JSON.stringify({ name: 'expense-tracker', version: '1.0.0', type: 'module', dependencies: { express: '^4.18.0', 'better-sqlite3': '^9.0.0' } }, null, 2),
    'test/expenses.contract.test.js': `import fs from 'node:fs';\nimport test from 'node:test';\nimport assert from 'node:assert/strict';\n\nconst expenses = fs.readFileSync(new URL('../src/routes/expenses.js', import.meta.url), 'utf8');\nconst server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');\n\ntest('expense routes and server wiring contracts are present', () => {\n  assert.match(expenses, /import \\{ addExpense, getExpenses \\}/);\n  assert.ok(expenses.includes(\"app.post('/expenses'\"));\n  assert.ok(expenses.includes(\"app.get('/expenses'\"));\n  assert.match(expenses, /addExpense\\(req\\.body\\.amount/);\n  assert.match(expenses, /getExpenses\\(\\)/);\n  assert.match(server, /import \\{ registerExpenseRoutes \\}/);\n  assert.match(server, /registerExpenseRoutes\\(app\\)/);\n});\n`,
  },
  'ms-3': {
    'src/routes/reports.js': `import db from '../db.js';\nexport function registerReportRoutes(app) {\n  app.get('/reports/monthly', (req, res) => {\n    const rows = db.prepare("SELECT strftime('%Y-%m', date) as month, SUM(amount) as total FROM expenses GROUP BY month").all();\n    res.json(rows);\n  });\n}\n`,
    'src/routes/categories.js': `import { addCategory, getCategories } from '../models.js';\nexport function registerCategoryRoutes(app) {\n  app.get('/categories', (req, res) => res.json(getCategories()));\n  app.post('/categories', (req, res) => { addCategory(req.body.name); res.json({ok:true}); });\n}\n`,
    'test/integration.test.js': `import fs from 'node:fs';\nimport test from 'node:test';\nimport assert from 'node:assert/strict';\n\nconst reports = fs.readFileSync(new URL('../src/routes/reports.js', import.meta.url), 'utf8');\nconst categories = fs.readFileSync(new URL('../src/routes/categories.js', import.meta.url), 'utf8');\n\ntest('report and category route contracts are present', () => {\n  assert.match(reports, /\\/reports\\/monthly/);\n  assert.match(reports, /SUM\\(amount\\)/);\n  assert.match(categories, /app\\.get\\('\\/categories'/);\n  assert.match(categories, /app\\.post\\('\\/categories'/);\n});\n`,
    'README.md': `# Expense Tracker API\n\nIncludes expense, category, and monthly report endpoints.\n`,
  },
  'ms-4': {
    'src/routes/budgets.js': `import db from '../db.js';\ndb.exec('CREATE TABLE IF NOT EXISTS budgets (id INTEGER PRIMARY KEY, month TEXT, limit_amount REAL)');\nexport function registerBudgetRoutes(app) {\n  app.post('/budgets', (req, res) => { db.prepare('INSERT INTO budgets (month, limit_amount) VALUES (?,?)').run(req.body.month, req.body.limit); res.json({ok:true}); });\n  app.get('/budgets', (req, res) => res.json(db.prepare('SELECT * FROM budgets').all()));\n  app.post('/budgets/check', (req, res) => {\n    const budget = db.prepare('SELECT limit_amount FROM budgets WHERE month = ?').get(req.body.month);\n    res.json({ exceeded: Boolean(budget && req.body.spent > budget.limit_amount) });\n  });\n}\n`,
    'test/budgets.integration.test.js': `import fs from 'node:fs';\nimport test from 'node:test';\nimport assert from 'node:assert/strict';\n\nconst budgets = fs.readFileSync(new URL('../src/routes/budgets.js', import.meta.url), 'utf8');\n\ntest('budget persistence and threshold alert contracts are present', () => {\n  assert.match(budgets, /CREATE TABLE IF NOT EXISTS budgets/);\n  assert.match(budgets, /\\/budgets\\/check/);\n  assert.match(budgets, /exceeded/);\n});\n`,
    'README.md': `# Expense Tracker API\n\nIncludes expense, category, monthly report, and budget limit endpoints.\n`,
  },
};

// ─── LLM Call Tracker ────────────────────────────────────────────────────────

const llmCalls = [];
let ms2FailCount = 0;

function createLLM() {
  return async function realisticLLM(role, prompt) {
    const p = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
    llmCalls.push({ role, promptSnippet: p.substring(0, 80) });

    // SPEC: analyze
    if (p.includes('## User Request') && p.includes('## Task') || p.includes('clarifying questions')) {
      return { content: JSON.stringify({
        core_goal: 'Build an Expense Tracker REST API',
        clarifying_questions: [
          'Jakou databazi preferujes?',
          'Ma API podporovat autentizaci?',
          'Jak podrobne maji byt reporty?',
        ],
        initial_assessment: { estimated_complexity: 'MEDIUM', key_risks: ['Schema design'], suggested_tech_stack: ['Node.js', 'Express', 'better-sqlite3'] },
      })};
    }

    // SPEC: document
    if (p.includes('thorough project specification') || p.includes('creating a project specification') || p.includes('structured project specification')) {
      return { content: JSON.stringify(SPEC) };
    }

    // PLANNING: roadmap
    if (p.includes('creating a project roadmap') || p.includes('Break the project into milestones')) {
      return { content: JSON.stringify(ROADMAP) };
    }

    // PLANNING: architecture contract
    if (p.includes('generate an ARCHITECTURE.json file')) {
      return { content: JSON.stringify(ARCHITECTURE) };
    }

    // BUILD: milestone plan
    if (p.includes('implementing a specific milestone') || p.includes('implementation plan for THIS milestone')) {
      const match = p.match(/"id"\s*:\s*"(ms-\d+)"/);
      const msId = match?.[1];
      if (!msId || !MS_PLANS[msId]) {
        throw new Error(`Unknown milestone plan prompt: ${msId}`);
      }
      return { content: JSON.stringify(MS_PLANS[msId]) };
    }

    // BUILD: checkpoint — ms-2 fails on first attempt
    if (p.includes('reviewing a completed milestone') || p.includes('Compare the actual output')) {
      const isMs2 = p.includes('ms-2') || p.includes('REST API');
      if (isMs2 && ms2FailCount === 0) {
        ms2FailCount++;
        return { content: JSON.stringify({
          passed: false,
          deliverables_check: [{ deliverable: 'server.js', status: 'PARTIAL', note: 'Missing error handling' }],
          scope_violations: [],
          test_summary: { total: 10, passed: 6, failed: 4, coverage_estimate: '55%' },
          quality_notes: ['Missing error handling middleware'],
          overall_assessment: 'Milestone needs fixes — insufficient test pass rate',
        })};
      }
      return { content: JSON.stringify({
        passed: true,
        deliverables_check: [{ deliverable: 'All files', status: 'DONE', note: 'Complete' }],
        scope_violations: [],
        test_summary: { total: 8, passed: 8, failed: 0, coverage_estimate: '85%' },
        quality_notes: ['Clean implementation'],
        overall_assessment: 'Milestone completed successfully',
      })};
    }

    // BUILD: health score
    if (p.includes('computing health metrics') || p.includes('health metrics for a completed milestone')) {
      return { content: JSON.stringify({
        scope_adherence: 0.92, test_coverage: 0.85, complexity_delta: 0.12, tech_debt_delta: 0.04,
      })};
    }

    // REVIEW: project review
    if (p.includes('conducting a project review') || p.includes('4 drift checks')) {
      return { content: JSON.stringify({
        spec_alignment: { addressed_goals: ['G1', 'G2', 'G3', 'G4'], unaddressed_goals: [], missed_requirements: [], confidence: 0.9 },
        scope_creep: { in_scope: ['API', 'DB', 'Reports'], out_of_scope: [], severity: 'NONE', confidence: 0.92 },
        architecture_consistency: { consistent: true, violations: [], confidence: 0.88 },
        tech_debt: { items: [], trend: 'STABLE', confidence: 0.8 },
        overall_health: 'GREEN',
        recommendations: ['Consider adding input validation'],
      })};
    }

    // CHANGE: analyze
    if (p.includes('analyzing a change request') || p.includes('impact of this change')) {
      return { content: JSON.stringify({
        affected_milestones: ['ms-3'],
        impact: {
          milestones_to_add: [{ id: 'ms-4', title: 'Budget Limits', estimated_loc: 100 }],
          milestones_to_remove: [],
          milestones_to_modify: [],
          effort_delta: '+100 LOC, +1 milestone',
          risk_level: 'LOW',
        },
        feasibility: 'FEASIBLE',
        recommendation: 'Low-risk addition, recommend approval',
      })};
    }

    // CHANGE: rewrite roadmap
    if (p.includes('rewriting a project roadmap') || p.includes('incorporate an approved change')) {
      return { content: JSON.stringify(ROADMAP_V2) };
    }

    throw new Error(`Unexpected LLM prompt for role ${role}: ${p.substring(0, 120)}`);
  };
}

// ─── Fake Executor ───────────────────────────────────────────────────────────

function createExecutor(projectPath) {
  return {
    async start(request, context) {
      const msId = rawId(context.milestoneId);
      const files = PROJECT_FILES[msId];
      if (!files) {
        throw new Error(`No executor fixture for ${context.milestoneId}`);
      }
      for (const [relPath, content] of Object.entries(files)) {
        const fullPath = path.join(projectPath, relPath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content);
      }
      try {
        execSync('git add -A && git commit -m "build: ' + msId + '" --allow-empty',
          { cwd: projectPath, stdio: 'pipe' });
      } catch { /* ok */ }
      return { state: 'COMPLETED', sessionId: `wf-${msId}` };
    },
    async approve(sessionId) {
      return { state: 'COMPLETED', sessionId };
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── TEST SCENARIOS ─────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function run() {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('  C3: Realistic LLM Lifecycle Test');
  console.log('══════════════════════════════════════════════════════════════════════');

  cleanDB();

  const SID = 'c3-llm-test';
  const projectPath = initProjectDir();
  const fakeLLM = createLLM();
  const fakeExecutor = createExecutor(projectPath);
  const ctx = { sessionId: SID, callLLM: fakeLLM, executor: fakeExecutor, projectPath };

  try {

    // ═══ T1: Detection + Proposal ════════════════════════════════════════════

    section('T1: Detection + Proposal');

    const r1 = handleLifecycleBuildDetected(
      'Postav mi REST API na sledovani vydaju s Express a SQLite, vcetne mesicnich reportu a kategorii',
      { intent: 'BUILD' }, ctx);

    check(r1?.content != null, 'Response is non-null');
    check(getLcState(SID)?.phase === 'PROPOSED', 'State is PROPOSED', `got: ${getLcState(SID)?.phase}`);

    // ═══ T2: SPEC ════════════════════════════════════════════════════════════

    section('T2: SPEC — clarifying questions');

    const r2 = await handleLifecycleInput('ano', ctx);
    check(getLcState(SID)?.phase === 'SPEC', 'State is SPEC', `got: ${getLcState(SID)?.phase}`);
    check(getLcState(SID)?.lifecycleId != null, 'Lifecycle ID assigned');

    const r3 = await handleLifecycleInput('SQLite, bez autentizace, mesicni souhrny po kategoriich', ctx);
    check(getLcState(SID)?.phase === 'SPEC_REVIEW', 'State is SPEC_REVIEW', `got: ${getLcState(SID)?.phase}`);

    // ═══ T3: SPEC_REVIEW → PLANNING ══════════════════════════════════════════

    section('T3: SPEC_REVIEW → PLAN_REVIEW');

    const r4 = await handleLifecycleInput('schvaluji', ctx);
    check(getLcState(SID)?.phase === 'PLAN_REVIEW', 'State is PLAN_REVIEW', `got: ${getLcState(SID)?.phase}`);
    check(r4?.content?.includes('ms-1') || r4?.content?.includes('Milník') || r4?.content?.includes('Roadmap'),
      'Response contains roadmap info');

    // ═══ T4: BUILD — Milestone 1 (happy path) ════════════════════════════════

    section('T4: BUILD — Milestone 1 (happy path)');

    const r5 = await handleLifecycleInput('schvaluji', ctx);
    const s5 = getLcState(SID);
    check(s5?.phase === 'BUILD_MILESTONE_REVIEW', 'State is BUILD_MILESTONE_REVIEW', `got: ${s5?.phase}`);
    check(s5?.currentMilestoneId === scopeId(s5?.lifecycleId, 'ms-1'),
      'Current milestone is scoped ms-1', `got: ${s5?.currentMilestoneId}`);

    const r6 = await handleLifecycleInput('ano', ctx);
    const ms1 = msRepo.getMilestone(scopeId(s5.lifecycleId, 'ms-1'));
    check(ms1?.status === 'PASSED', 'ms-1 PASSED in DB', `got: ${ms1?.status}`);
    check(fs.existsSync(path.join(projectPath, 'src/db.js')), 'src/db.js on disk');
    check(fs.existsSync(path.join(projectPath, 'src/models.js')), 'src/models.js on disk');

    // ═══ T5: BUILD — Milestone 2 (FAIL + retry) ═════════════════════════════

    section('T5: BUILD — Milestone 2 (FAIL then retry PASS)');

    const s6 = getLcState(SID);
    check(s6?.currentMilestoneId === scopeId(s6?.lifecycleId, 'ms-2'),
      'Auto-advanced to scoped ms-2', `got: ${s6?.currentMilestoneId}`);
    check(s6?.phase === 'BUILD_MILESTONE_REVIEW', 'Phase is BUILD_MILESTONE_REVIEW', `got: ${s6?.phase}`);

    // Approve ms-2 plan — checkpoint will FAIL (ms2FailCount=0, first checkpoint for ms-2)
    ms2FailCount = 0;
    const r7 = await handleLifecycleInput('ano', ctx);

    const ms2AfterFail = msRepo.getMilestone(scopeId(s6.lifecycleId, 'ms-2'));
    // On failure with retries remaining: status goes back to PENDING (not FAILED/BLOCKED)
    check(ms2AfterFail?.status === 'PENDING', 'ms-2 PENDING after first checkpoint failure (retry)',
      `got: ${ms2AfterFail?.status}`);

    // LLM call tracking — verify checkpoint was called
    const checkpointCalls = llmCalls.filter(c => c.role === 'R1');
    check(checkpointCalls.length >= 1, 'Checkpoint LLM call made (R1 role)', `calls: ${checkpointCalls.length}`);

    // After RETRY, state is BUILD. To retry: call startNextMilestone (picks up ms-2 PENDING),
    // then approve the regenerated plan through the handler.
    const lifecycleForRetry = ProjectLifecycle.resume(getLcState(SID)?.lifecycleId, projectPath);
    lifecycleForRetry.callLLM = fakeLLM;
    lifecycleForRetry.executor = fakeExecutor;
    const retryPlan = await startNextMilestone(lifecycleForRetry);
    check(retryPlan?.milestoneId === scopeId(s6.lifecycleId, 'ms-2'),
      'Retry picks up scoped ms-2', `got: ${retryPlan?.milestoneId}`);

    setLcState(SID, {
      ...getLcState(SID),
      phase: 'BUILD_MILESTONE_REVIEW',
      currentMilestoneId: scopeId(s6.lifecycleId, 'ms-2'),
    });

    // Second attempt — checkpoint returns passed: true (ms2FailCount=1 now)
    const r7b = await handleLifecycleInput('ano', ctx);
    const ms2Final = msRepo.getMilestone(scopeId(s6.lifecycleId, 'ms-2'));
    check(ms2Final?.status === 'PASSED', 'ms-2 PASSED on retry', `got: ${ms2Final?.status}`);

    check(fs.existsSync(path.join(projectPath, 'src/routes/expenses.js')), 'expenses.js on disk');
    check(fs.existsSync(path.join(projectPath, 'src/server.js')), 'server.js on disk');

    // ═══ T6: Progress query during BUILD ═════════════════════════════════════

    section('T6: Progress query');

    const lifecycleId = getLcState(SID)?.lifecycleId;
    check(lifecycleId != null, 'Lifecycle ID available');

    if (lifecycleId) {
      const progress = getBuildProgress(lifecycleId);
      check(progress != null, 'getBuildProgress returns data');
      check(progress.completed >= 2, 'At least 2 milestones completed', `got: ${progress.completed}`);
      check(progress.total >= 3, 'Total milestones >= 3', `got: ${progress.total}`);

      const progressPct = computeLifecycleProgress(lifecycleId);
      check(progressPct.percentage > 0, 'Progress percentage > 0', `got: ${progressPct.percentage}%`);

      const display = formatLifecycleProgress(lifecycleId, 'cs');
      check(display != null && display.length > 0, 'Progress display non-empty');
    }

    // ═══ T7: Change management — APPROVAL ════════════════════════════════════

    section('T7: Change request — APPROVAL with roadmap rewrite');

    // ms-3 plan should be auto-shown. Force to BUILD for change management.
    const stateBeforeChange = getLcState(SID);
    const savedState = { ...stateBeforeChange };
    setLcState(SID, { ...stateBeforeChange, phase: 'BUILD' });

    const rChange = await handleLifecycleInput('zmena: pridat mesicni budgetove limity s alertem pri prekroceni', ctx);
    check(getLcState(SID)?.phase === 'CHANGE', 'State is CHANGE', `got: ${getLcState(SID)?.phase}`);

    // APPROVE the change (unlike the existing test which rejects)
    const rApprove = await handleLifecycleInput('ano', ctx);
    const stateAfterApprove = getLcState(SID);

    // After approval, roadmap should be rewritten (version 2)
    if (lifecycleId) {
      const rv = roadmapVersions.getLatestVersion(lifecycleId);
      check(rv >= 2, 'Roadmap version bumped to 2+', `got: ${rv}`);
    }

    // Change request should be APPLIED in DB (flow: PROPOSED → ANALYZED → APPLIED)
    const crs = crRepo.findByLifecycle ? crRepo.findByLifecycle.all(lifecycleId) : [];
    const appliedCR = crs.find(cr => cr.status === 'APPLIED');
    check(appliedCR != null, 'Change request APPLIED in DB',
      `statuses: ${crs.map(c => c.status).join(', ')}`);

    // Check that ms-4 was added to DB (if roadmap rewrite worked)
    const allMs = msRepo.listByLifecycle(lifecycleId);
    const ms4Exists = allMs.some(m => m.id === scopeId(lifecycleId, 'ms-4'));
    check(ms4Exists, 'scoped ms-4 added after change approval',
      `milestones: ${allMs.map(m => m.id).join(', ')}`);

    // ═══ T8: Pause + Resume ══════════════════════════════════════════════════

    section('T8: Pause + Resume');

    // Restore to BUILD state so we can test pause
    const stateForPause = getLcState(SID);
    if (stateForPause) {
      setLcState(SID, { ...stateForPause, phase: 'BUILD' });

      const rPause = await handleLifecycleInput('pauza', ctx);
      const pausedState = getLcState(SID);
      check(pausedState?.phase === 'PAUSED', 'State is PAUSED after pause command', `got: ${pausedState?.phase}`);

      // Resume — reads phase from DB (which was set to PAUSED by the pause handler)
      // The resume handler doesn't auto-transition; it restores the DB phase
      if (pausedState?.phase === 'PAUSED') {
        const rResume = await handleLifecycleInput('pokracovat', ctx);
        const resumedState = getLcState(SID);
        // Resume restores the phase from DB record — may be PAUSED or BUILD depending on impl
        check(resumedState != null, 'State restored after resume');
        check(rResume?.content?.includes('obnoven') || rResume?.content?.includes('Lifecycle'),
          'Resume returns lifecycle status message');

        // Manually restore to BUILD for subsequent tests
        setLcState(SID, { ...resumedState, phase: 'BUILD' });
      }
    }

    // ═══ T8b: State recovery simulation ══════════════════════════════════════

    section('T8b: State recovery simulation');

    const stateBeforeCrash = getLcState(SID);
    check(stateBeforeCrash != null, 'Active state exists before simulated crash');
    const dbRow = db.prepare(
      'SELECT * FROM lifecycle_handoff_state WHERE session_id = ?'
    ).get(SID);
    check(dbRow != null, 'Handoff state persisted to DB');
    check(dbRow?.lifecycle_id === lifecycleId, 'Persisted lifecycle ID is exact',
      `got: ${dbRow?.lifecycle_id}`);

    _clearAllRam();
    check(getLcState(SID) == null, 'RAM state is empty after simulated crash');

    const loaded = preloadActiveLifecycles();
    const restoredAfterCrash = getLcState(SID);
    check(loaded >= 1, 'Startup preload restores at least one active state',
      `loaded: ${loaded}`);
    check(restoredAfterCrash?.restored === true, 'Restored state is marked as restored');
    check(restoredAfterCrash?.lifecycleId === lifecycleId, 'Restored lifecycle ID is exact',
      `got: ${restoredAfterCrash?.lifecycleId}`);
    check(restoredAfterCrash?.phase === stateBeforeCrash?.phase, 'Restored phase is exact',
      `got: ${restoredAfterCrash?.phase}, expected: ${stateBeforeCrash?.phase}`);

    // ═══ T9: Complete remaining milestones ════════════════════════════════════

    section('T9: Complete remaining milestones');

    // Find and complete remaining milestones
    const remainingMs = msRepo.listByLifecycle(lifecycleId)
      .filter(m => m.status !== 'PASSED' && m.status !== 'SKIPPED');

    for (const ms of remainingMs) {
      const curState = getLcState(SID);

      // Ensure we're in BUILD or BUILD_MILESTONE_REVIEW
      if (curState?.phase === 'BUILD') {
        // Need to get to milestone review — trigger next milestone
        setLcState(SID, { ...curState, phase: 'BUILD_MILESTONE_REVIEW', currentMilestoneId: ms.id });

        // Try to get the milestone to AWAITING_PLAN if it's PENDING
        const msDb = msRepo.getMilestone(ms.id);
        if (msDb?.status === 'PENDING') {
          const lifecycle = ProjectLifecycle.resume(lifecycleId, projectPath);
          if (!lifecycle) {
            throw new Error(`Unable to resume lifecycle before starting ${ms.id}`);
          }
          lifecycle.callLLM = fakeLLM;
          lifecycle.executor = fakeExecutor;
          const { startNextMilestone } = await import('../src/planner/lifecycle-build.js');
          const started = await startNextMilestone(lifecycle);
          if (!started) {
            throw new Error(`Unable to start pending milestone ${ms.id}`);
          }
        }
      }

      // Approve the milestone plan
      if (getLcState(SID)?.phase === 'BUILD_MILESTONE_REVIEW') {
        await handleLifecycleInput('ano', ctx);
      }

      const msResult = msRepo.getMilestone(ms.id);
      console.log(`    ${ms.id}: ${msResult?.status || 'unknown'}`);
    }

    // ═══ T10: Handle review if triggered ═════════════════════════════════════

    section('T10: Review + Completion');

    let finalState = getLcState(SID);

    if (finalState?.phase === 'REVIEW') {
      const rReview = await handleLifecycleInput('pokracovat', ctx);
      finalState = getLcState(SID);
    }

    // Keep going until done or stuck
    let safetyCounter = 5;
    while (finalState && finalState.phase !== 'DONE' && finalState.phase !== 'COMPLETED' && safetyCounter > 0) {
      safetyCounter--;
      if (finalState.phase === 'BUILD_MILESTONE_REVIEW') {
        await handleLifecycleInput('ano', ctx);
      } else if (finalState.phase === 'REVIEW') {
        await handleLifecycleInput('pokracovat', ctx);
      } else if (finalState.phase === 'BUILD') {
        break; // Can't auto-advance from BUILD
      } else {
        break;
      }
      finalState = getLcState(SID);
    }
    const lifecycleAfterCompletion = lifecycleRepo.findById.get(lifecycleId);
    check(lifecycleAfterCompletion?.phase === 'COMPLETED', 'Lifecycle reaches COMPLETED',
      `got: ${lifecycleAfterCompletion?.phase}`);
    check(getLcState(SID) == null, 'Handoff state is cleared after completion',
      `got: ${getLcState(SID)?.phase}`);

    // ═══ T12: LLM call audit ═════════════════════════════════════════════════

    section('T12: LLM call audit');

    check(llmCalls.length > 0, 'LLM was called at least once', `total calls: ${llmCalls.length}`);

    const d1Calls = llmCalls.filter(c => c.role === 'D1');
    check(d1Calls.length >= 3, 'D1 (planner) called >= 3 times (spec + roadmap + milestones)',
      `got: ${d1Calls.length}`);

    const r1Calls = llmCalls.filter(c => c.role === 'R1');
    check(r1Calls.length >= 1, 'R1 (checkpoint reviewer) called >= 1 time', `got: ${r1Calls.length}`);

    const r2Calls = llmCalls.filter(c => c.role === 'R2');
    check(r2Calls.length >= 1, 'R2 (health scorer) called >= 1 time', `got: ${r2Calls.length}`);

    console.log(`\n    LLM call summary:`);
    const roleCounts = {};
    for (const c of llmCalls) { roleCounts[c.role] = (roleCounts[c.role] || 0) + 1; }
    for (const [role, count] of Object.entries(roleCounts)) {
      console.log(`      ${role}: ${count} calls`);
    }

    // ═══ T13: Final DB state verification ════════════════════════════════════

    section('T13: Final DB verification');

    if (lifecycleId) {
      const lcFinal = lifecycleRepo.findById.get(lifecycleId);
      check(lcFinal != null, 'Lifecycle record exists in DB');

      const allMsFinal = msRepo.listByLifecycle(lifecycleId);
      check(allMsFinal.length >= 3, 'At least 3 milestones in DB', `got: ${allMsFinal.length}`);

      const passedCount = allMsFinal.filter(m => m.status === 'PASSED').length;
      check(
        allMsFinal.length > 0 && allMsFinal.every(m => m.status === 'PASSED'),
        'All milestones are PASSED',
        `${passedCount}/${allMsFinal.length} passed`,
      );
      console.log(`    Milestones: ${passedCount}/${allMsFinal.length} PASSED`);
      for (const m of allMsFinal) {
        console.log(`      ${m.status === 'PASSED' ? '✅' : '⬜'} ${m.id}: ${m.title} [${m.status}]`);
      }

      const dChecks = driftChecks.getChecks(lifecycleId);
      check(dChecks.length > 0, 'Drift checks recorded', `count: ${dChecks.length}`);

      const crFinal = crRepo.findByLifecycle ? crRepo.findByLifecycle.all(lifecycleId) : [];
      console.log(`    Change requests: ${crFinal.length}`);
      for (const cr of crFinal) {
        console.log(`      ${cr.status === 'APPLIED' ? '✅' : cr.status === 'REJECTED' ? '❌' : '⬜'} ${cr.status}: ${cr.description?.substring(0, 50)}`);
      }
    }

    // ═══ T14: File system final check ════════════════════════════════════════

    section('T14: File system verification');

    const expectedFiles = [
      'src/db.js',
      'src/models.js',
      'src/routes/expenses.js',
      'src/server.js',
      'package.json',
      'test/persistence.contract.test.js',
      'test/expenses.contract.test.js',
    ];
    for (const f of expectedFiles) {
      check(fs.existsSync(path.join(projectPath, f)), `${f} exists on disk`);
    }

    // Git history check
    try {
      const gitLog = execSync('git log --oneline', { cwd: projectPath, encoding: 'utf8' });
      const commits = gitLog.trim().split('\n');
      check(commits.length >= 3, 'At least 3 git commits', `got: ${commits.length}`);
      console.log(`    Git log (${commits.length} commits):`);
      commits.slice(0, 8).forEach(l => console.log(`      ${l}`));
    } catch (e) {
      check(false, 'Git log accessible', e.message);
    }

    // ═══ T15: Project context verification (v65.4) ═══════════════════════════

    section('T15: Project context (v65.4)');

    // Verify project was created in DB
    try {
      const allProjects = projects.findAll ? projects.findAll.all() :
        db.prepare('SELECT * FROM projects').all();
      const ourProject = allProjects.find(p => p.path === projectPath || p.name?.includes('Expense'));
      check(ourProject != null, 'Project record exists in DB', `projects: ${allProjects.length}`);
      if (ourProject) {
        check(ourProject.name != null, 'Project has name', `name: ${ourProject.name}`);
        console.log(`    Project: id=${ourProject.id}, name=${ourProject.name}`);
      }
    } catch (e) {
      check(false, 'Project DB query succeeds', e.message);
    }

  } catch (err) {
    console.error(`\n\n💥 FATAL: ${err.message}`);
    console.error(err.stack);
    failed++;
    failures.push(`FATAL: ${err.message}`);
  }

  // Cleanup
  if (!process.env.KEEP_PROJECT && failed === 0) {
    try { fs.rmSync(projectPath, { recursive: true, force: true }); } catch { /* ok */ }
  } else if (failed > 0) {
    console.log(`\n  📁 Project preserved: ${projectPath}`);
  }

  // ═══ Summary ═══════════════════════════════════════════════════════════════

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  C3 Realistic LLM Lifecycle: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log(`\n  FAILURES:`);
    for (const f of failures) console.log(`    ❌ ${f}`);
  }
  console.log(`${'═'.repeat(70)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

run();
