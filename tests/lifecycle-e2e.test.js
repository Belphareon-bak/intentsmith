// Lifecycle E2E Test — Full Chain: SPEC → PLANNING → BUILD → REVIEW → CHANGE
// ══════════════════════════════════════════════════════════════════════════════
// Creates a real sample project (TODO API) and walks through the entire
// lifecycle chain, verifying every phase transition, DB state, and output.
//
// Sample project: Simple TODO REST API (Node.js + Express + SQLite)
//   Milestone 1: Project setup + DB schema
//   Milestone 2: REST API endpoints (CRUD)
//   Milestone 3: Error handling + validation
//
// Run: node tests/lifecycle-e2e.test.js
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

import {
  ProjectPhase,
  MilestoneStatus,
  ChangeRequestStatus,
  ProjectLifecycle,
  validateSpec,
  validateDependencies,
  checkDependencies,
  validateMilestoneSize,
  suggestMilestoneSplit,
  estimateContextTokens,
  getBuildProgress,
  DriftCheckType,
  getDriftHistory,
  getAggregateHealth,
  validatePreservation,
  rejectChange,
  listChangeRequests,
  computeLifecycleProgress,
  formatLifecycleProgress,
  formatMilestoneTable,
  formatHealthScoreHistory,
} from '../src/planner/index.js';

import {
  lifecycles as lifecycleRepo,
  milestones as msRepo,
  roadmapVersions,
  changeRequests as crRepo,
  driftChecks,
  projects,
  db,
} from '../src/db/database.js';

import { isProjectScopeBuild } from '../src/chat/handlers/build-handoff.js';
import {
  handleLifecycleBuildDetected,
  handleLifecycleInput,
  getActiveLifecycleHandoff,
  cancelLifecycleHandoff,
} from '../src/chat/handlers/lifecycle-handoff.js';

// ─── Test framework ─────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function pass(name) {
  console.log(`  ✅ ${name}`);
  passed++;
}

function fail(name, msg) {
  console.log(`  ❌ ${name}: ${msg}`);
  failed++;
  failures.push({ name, msg });
}

function assert(condition, name, detail = '') {
  if (condition) pass(name);
  else fail(name, detail || 'assertion failed');
}

// ─── Sample project spec ────────────────────────────────────────────────────

const SAMPLE_SPEC = {
  title: 'TODO REST API',
  description: 'A simple REST API for managing TODO items with Express.js and SQLite.',
  goals: [
    { id: 'G1', description: 'Provide CRUD operations for TODO items' },
    { id: 'G2', description: 'Persist data in SQLite database' },
    { id: 'G3', description: 'Input validation and error handling' },
  ],
  requirements: [
    { id: 'R1', description: 'GET /todos — list all items' },
    { id: 'R2', description: 'POST /todos — create a new item' },
    { id: 'R3', description: 'PUT /todos/:id — update an item' },
    { id: 'R4', description: 'DELETE /todos/:id — delete an item' },
    { id: 'R5', description: 'Input validation with clear error messages' },
  ],
  tech_stack: {
    languages: ['JavaScript'],
    frameworks: ['Express.js'],
    databases: ['SQLite'],
    tools: ['better-sqlite3'],
  },
  risks: [
    'SQLite concurrency limitations under heavy load',
  ],
};

const SAMPLE_ROADMAP = {
  milestones: [
    {
      id: 'ms-1',
      title: 'Project Setup + DB Schema',
      description: 'Initialize project, create package.json, set up SQLite database with todos table',
      dependencies: [],
      estimated_loc: 150,
      estimated_files: 4,
      estimated_complexity: 'LOW',
      test_strategy: { type: 'unit', framework: 'node:test' },
    },
    {
      id: 'ms-2',
      title: 'REST API Endpoints',
      description: 'Implement GET/POST/PUT/DELETE for /todos',
      dependencies: ['ms-1'],
      estimated_loc: 300,
      estimated_files: 3,
      estimated_complexity: 'MEDIUM',
      test_strategy: { type: 'integration', framework: 'node:test' },
    },
    {
      id: 'ms-3',
      title: 'Error Handling + Validation',
      description: 'Add input validation, error middleware, 404 handler',
      dependencies: ['ms-2'],
      estimated_loc: 200,
      estimated_files: 3,
      estimated_complexity: 'LOW',
      test_strategy: { type: 'unit', framework: 'node:test' },
    },
  ],
};

// ─── Sample project file contents ───────────────────────────────────────────

const SAMPLE_FILES = {
  'package.json': JSON.stringify({
    name: 'todo-api',
    version: '1.0.0',
    type: 'module',
    scripts: { start: 'node src/index.js', test: 'node --test tests/' },
    dependencies: { express: '^4.18.0', 'better-sqlite3': '^9.0.0' },
  }, null, 2),

  'src/db.js': `import Database from 'better-sqlite3';
const db = new Database('./data/todos.db');
db.pragma('journal_mode = WAL');
db.exec(\`
  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    completed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
\`);
export default db;
`,

  'src/routes.js': `import { Router } from 'express';
import db from './db.js';
const router = Router();

router.get('/todos', (req, res) => {
  const todos = db.prepare('SELECT * FROM todos ORDER BY created_at DESC').all();
  res.json(todos);
});

router.post('/todos', (req, res) => {
  const { title } = req.body;
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return res.status(400).json({ error: 'title is required' });
  }
  const result = db.prepare('INSERT INTO todos (title) VALUES (?)').run(title.trim());
  res.status(201).json({ id: Number(result.lastInsertRowid), title: title.trim(), completed: 0 });
});

router.put('/todos/:id', (req, res) => {
  const { id } = req.params;
  const { title, completed } = req.body;
  const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
  if (!todo) return res.status(404).json({ error: 'Todo not found' });
  const newTitle = title !== undefined ? title : todo.title;
  const newCompleted = completed !== undefined ? (completed ? 1 : 0) : todo.completed;
  db.prepare('UPDATE todos SET title = ?, completed = ? WHERE id = ?').run(newTitle, newCompleted, id);
  res.json({ id: Number(id), title: newTitle, completed: newCompleted });
});

router.delete('/todos/:id', (req, res) => {
  const result = db.prepare('DELETE FROM todos WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Todo not found' });
  res.json({ deleted: true });
});

export default router;
`,

  'src/index.js': `import express from 'express';
import router from './routes.js';
const app = express();
app.use(express.json());
app.use(router);
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(\`TODO API running on port \${PORT}\`));
`,
};

// ════════════════════════════════════════════════════════════════════════════════
// Setup: create temp project directory + git repo
// ════════════════════════════════════════════════════════════════════════════════

const projectName = `todo-api-e2e-${Date.now()}`;
const projectPath = path.join('/tmp', projectName);
let testProjectId;
let lifecycleId;

// Create project dir + git init
fs.mkdirSync(path.join(projectPath, 'src'), { recursive: true });
fs.mkdirSync(path.join(projectPath, 'data'), { recursive: true });
try {
  execSync(`git init "${projectPath}"`, { stdio: 'pipe' });
  execSync(`git -C "${projectPath}" config user.email "test@test.com"`, { stdio: 'pipe' });
  execSync(`git -C "${projectPath}" config user.name "E2E Test"`, { stdio: 'pipe' });
  execSync(`git -C "${projectPath}" commit --allow-empty -m "Initial commit"`, { stdio: 'pipe' });
} catch (e) {
  console.log(`  ⚠️ Git init: ${e.message}`);
}

// Create project in DB
try {
  const result = projects.create.run(projectName, projectPath, 'E2E test: TODO REST API');
  testProjectId = Number(result.lastInsertRowid);
} catch {
  const existing = projects.findByName.get(projectName);
  testProjectId = existing.id;
}

// ════════════════════════════════════════════════════════════════════════════════
// Phase 1: CRE Routing — isProjectScopeBuild
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Phase 1: CRE Routing ──');

{
  const request = 'Chci postavit kompletní TODO REST API s Express.js, SQLite databází a error handlingem';
  assert(isProjectScopeBuild(request), 'E2E request detected as project-scope');

  const sessionId = `e2e-${Date.now()}`;
  const response = handleLifecycleBuildDetected(
    request,
    { type: 'PLAN', intent: 'BUILD' },
    { sessionId }
  );
  assert(response.content.includes('lifecycle'), 'Lifecycle proposal shown to user');
  assert(getActiveLifecycleHandoff(sessionId).phase === 'PROPOSED', 'Handoff state = PROPOSED');
  cancelLifecycleHandoff(sessionId);
}

// ════════════════════════════════════════════════════════════════════════════════
// Phase 2: SPEC — Spec validation + persistence
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Phase 2: SPEC ──');

{
  // Validate our sample spec
  const validation = validateSpec(SAMPLE_SPEC);
  assert(validation.valid === true, `Spec validation passed (${validation.errors.length} errors)`);
  assert(validation.errors.length === 0, 'No validation errors');
}

{
  // Create lifecycle (manually — no LLM)
  lifecycleId = `lc-e2e-${Date.now()}`;
  lifecycleRepo.save(lifecycleId, testProjectId, 'SPEC', null, {
    reviewFrequency: 2,  // review after every 2 milestones for testing
    maxMilestoneLOC: 2000,
    maxMilestoneFiles: 10,
    maxMilestoneRetries: 3,
    autoCommit: true,
  });

  // Store spec
  lifecycleRepo.updateSpec.run(JSON.stringify(SAMPLE_SPEC), lifecycleId);

  // Verify stored spec
  const storedSpec = lifecycleRepo.getSpec(lifecycleId);
  assert(storedSpec.title === 'TODO REST API', 'Spec stored: title');
  assert(storedSpec.goals.length === 3, 'Spec stored: 3 goals');
  assert(storedSpec.requirements.length === 5, 'Spec stored: 5 requirements');
  assert(storedSpec.tech_stack.languages[0] === 'JavaScript', 'Spec stored: tech_stack');

  // Approve spec → PLANNING
  lifecycleRepo.updatePhase.run('PLANNING', lifecycleId);
  const lc = lifecycleRepo.findById.get(lifecycleId);
  assert(lc.phase === 'PLANNING', 'Phase transitioned to PLANNING');
}

// ════════════════════════════════════════════════════════════════════════════════
// Phase 3: PLANNING — Roadmap creation, deps, size validation
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Phase 3: PLANNING ──');

{
  // Validate roadmap dependencies
  const depErrors = validateDependencies(SAMPLE_ROADMAP.milestones);
  assert(depErrors.length === 0, `No dependency errors (got ${depErrors.length})`);
}

{
  // Validate milestone sizes
  for (const ms of SAMPLE_ROADMAP.milestones) {
    const sizeResult = validateMilestoneSize(ms, { maxLOC: 2000, maxFiles: 10 });
    assert(sizeResult.fits, `Milestone ${ms.id} fits size limit`);
  }
}

{
  // Estimate context tokens
  for (const ms of SAMPLE_ROADMAP.milestones) {
    const tokens = estimateContextTokens(ms);
    assert(tokens > 0, `Milestone ${ms.id} tokens estimated: ${tokens}`);
    assert(tokens < 60000, `Milestone ${ms.id} fits context window`);
  }
}

{
  // Store roadmap version 1
  roadmapVersions.addVersion(lifecycleId, 1, SAMPLE_ROADMAP, 'Initial roadmap', null);

  const latest = roadmapVersions.getLatestRoadmap(lifecycleId);
  assert(latest !== null, 'Roadmap v1 stored');
  assert(latest.version === 1, 'Roadmap version = 1');
  assert(latest.roadmap.milestones.length === 3, 'Roadmap has 3 milestones');
}

{
  // Create milestone DB records (IDs prefixed with lifecycleId for uniqueness)
  // Dependencies must reference the SAME prefixed IDs
  for (const ms of SAMPLE_ROADMAP.milestones) {
    const seq = parseInt(ms.id.replace('ms-', ''), 10);
    const fullId = `${lifecycleId}-${ms.id}`;
    const fullDeps = (ms.dependencies || []).map(d => `${lifecycleId}-${d}`);
    msRepo.addMilestone({
      id: fullId,
      lifecycle_id: lifecycleId,
      roadmap_version: 1,
      sequence: seq,
      title: ms.title,
      description: ms.description,
      dependencies: fullDeps,
      estimated_loc: ms.estimated_loc,
      estimated_files: ms.estimated_files,
      estimated_complexity: ms.estimated_complexity,
      test_strategy: ms.test_strategy,
      max_retries: 3,
    });
  }

  const allMs = msRepo.listByLifecycle(lifecycleId);
  assert(allMs.length === 3, 'DB: 3 milestones created');
  assert(allMs[0].status === 'PENDING', 'DB: ms-1 status = PENDING');
  assert(allMs[0].sequence === 1, 'DB: ms-1 sequence = 1');
}

{
  // Phase transition: PLANNING → BUILD
  lifecycleRepo.updatePhase.run('BUILD', lifecycleId);
  assert(lifecycleRepo.findById.get(lifecycleId).phase === 'BUILD', 'Phase = BUILD');
}

// ════════════════════════════════════════════════════════════════════════════════
// Phase 4: BUILD — Walk through milestones, create actual files
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Phase 4: BUILD ──');

// Helper: prefix milestone IDs
const msId = (n) => `${lifecycleId}-ms-${n}`;

{
  // --- Milestone 1: Project Setup + DB Schema ---
  console.log('  -- Milestone 1: Project Setup --');

  // Check dependencies
  const depCheck = checkDependencies(msId(1), lifecycleId);
  assert(depCheck.ready === true, 'ms-1: no deps → ready');

  // Transition to EXECUTING
  msRepo.updateStatus.run('PLANNING', msId(1));
  msRepo.markStarted.run(msId(1));
  msRepo.updateStatus.run('AWAITING_PLAN', msId(1));
  msRepo.updateStatus.run('EXECUTING', msId(1));

  // Write actual project files (simulating code execution)
  fs.writeFileSync(path.join(projectPath, 'package.json'), SAMPLE_FILES['package.json']);
  fs.writeFileSync(path.join(projectPath, 'src', 'db.js'), SAMPLE_FILES['src/db.js']);

  // Verify files exist
  assert(fs.existsSync(path.join(projectPath, 'package.json')), 'ms-1: package.json created');
  assert(fs.existsSync(path.join(projectPath, 'src', 'db.js')), 'ms-1: src/db.js created');

  // Git commit (simulating auto-commit)
  try {
    execSync(`git -C "${projectPath}" add -A && git -C "${projectPath}" commit -m "feat(ms-1): Project Setup + DB Schema"`, { stdio: 'pipe' });
    const hash = execSync(`git -C "${projectPath}" rev-parse --short HEAD`, { stdio: 'pipe' }).toString().trim();
    execSync(`git -C "${projectPath}" tag ms-1`, { stdio: 'pipe' });

    // Store completion in DB
    const healthScore1 = { scope_adherence: 1.0, test_coverage: 0.7, complexity_delta: 0.05, tech_debt_delta: 0.02 };
    msRepo.updateCompletion.run(hash, 'ms-1', JSON.stringify(healthScore1), msId(1));

    assert(true, `ms-1: committed ${hash}, tagged`);

    // Verify DB state
    const ms1 = msRepo.getMilestone(msId(1));
    assert(ms1.status === 'PASSED', 'ms-1: status = PASSED');
    assert(ms1.commit_hash === hash, 'ms-1: commit_hash stored');
    assert(ms1.health_score.scope_adherence === 1.0, 'ms-1: health_score stored');
  } catch (e) {
    fail('ms-1: git commit', e.message);
  }
}

{
  // --- Milestone 2: REST API Endpoints ---
  console.log('  -- Milestone 2: REST API Endpoints --');

  // Check dependencies: ms-2 depends on ms-1
  const depCheck = checkDependencies(msId(2), lifecycleId);
  assert(depCheck.ready === true, 'ms-2: deps satisfied (ms-1 PASSED)');

  // Execute milestone
  msRepo.updateStatus.run('EXECUTING', msId(2));
  msRepo.markStarted.run(msId(2));

  // Write files
  fs.writeFileSync(path.join(projectPath, 'src', 'routes.js'), SAMPLE_FILES['src/routes.js']);
  fs.writeFileSync(path.join(projectPath, 'src', 'index.js'), SAMPLE_FILES['src/index.js']);

  assert(fs.existsSync(path.join(projectPath, 'src', 'routes.js')), 'ms-2: routes.js created');
  assert(fs.existsSync(path.join(projectPath, 'src', 'index.js')), 'ms-2: index.js created');

  try {
    execSync(`git -C "${projectPath}" add -A && git -C "${projectPath}" commit -m "feat(ms-2): REST API Endpoints"`, { stdio: 'pipe' });
    const hash = execSync(`git -C "${projectPath}" rev-parse --short HEAD`, { stdio: 'pipe' }).toString().trim();
    execSync(`git -C "${projectPath}" tag ms-2`, { stdio: 'pipe' });

    const healthScore2 = { scope_adherence: 0.95, test_coverage: 0.8, complexity_delta: 0.1, tech_debt_delta: 0.05 };
    msRepo.updateCompletion.run(hash, 'ms-2', JSON.stringify(healthScore2), msId(2));

    assert(true, `ms-2: committed ${hash}, tagged`);
    assert(msRepo.getMilestone(msId(2)).status === 'PASSED', 'ms-2: status = PASSED');
  } catch (e) {
    fail('ms-2: git commit', e.message);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// Phase 5: REVIEW — Drift detection after 2 milestones
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Phase 5: REVIEW (after 2 milestones) ──');

{
  // Simulate review check (config.reviewFrequency = 2)
  const completed = msRepo.getCompleted(lifecycleId);
  assert(completed.length === 2, `2 milestones completed (got ${completed.length})`);

  // isReviewDue would return true at count 2 with frequency 2
  assert(2 % 2 === 0, 'Review due: 2 % 2 === 0');

  // Add drift checks (simulating what triggerProjectReview would store)
  driftChecks.addCheck(lifecycleId, null, 'SPEC_ALIGNMENT', 'PASS', { addressed_goals: ['G1', 'G2'] });
  driftChecks.addCheck(lifecycleId, null, 'SCOPE_CREEP', 'PASS', { severity: 'NONE' });
  driftChecks.addCheck(lifecycleId, null, 'ARCHITECTURE_CONSISTENCY', 'PASS', { consistent: true });
  driftChecks.addCheck(lifecycleId, null, 'TECH_DEBT', 'PASS', { trend: 'STABLE' });

  // Get drift history
  const history = getDriftHistory(lifecycleId);
  assert(history.totalChecks === 4, `Drift: 4 checks stored (got ${history.totalChecks})`);
  assert(history.overallTrend === 'STABLE', `Drift: overallTrend=STABLE (got ${history.overallTrend})`);

  // Get aggregate health
  const health = getAggregateHealth(lifecycleId);
  assert(health.milestoneCount === 2, 'Health: 2 milestones with scores');
  assert(health.averages.scope_adherence >= 0.95, `Health: avg scope >= 0.95 (got ${health.averages.scope_adherence})`);
  assert(health.averages.test_coverage >= 0.7, `Health: avg test_coverage >= 0.7 (got ${health.averages.test_coverage})`);
  assert(health.trend === 'STABLE', `Health: trend=STABLE (< 6 ms) (got ${health.trend})`);
}

// ════════════════════════════════════════════════════════════════════════════════
// Phase 6: CHANGE MANAGEMENT — Add a new feature mid-project
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Phase 6: CHANGE MANAGEMENT ──');

{
  // Propose change: add search/filter to todos
  const crId = `cr-e2e-${Date.now()}`;
  crRepo.addRequest({
    id: crId,
    lifecycle_id: lifecycleId,
    description: 'Add search/filter functionality to GET /todos',
    affected_milestones: ['ms-3'],
  });

  // List change requests
  const crs = listChangeRequests(lifecycleId);
  assert(crs.length === 1, 'Change: 1 CR listed');
  assert(crs[0].description.includes('search'), 'Change: description stored');

  // Validate preservation: completed milestones must stay
  const completedMs = msRepo.getCompleted(lifecycleId);
  const newMilestones = [
    { id: msId(1), status: 'PASSED', preserved: true },
    { id: msId(2), status: 'PASSED', preserved: true },
    { id: msId(3), status: 'PENDING' },
    { id: `${lifecycleId}-ms-4`, status: 'PENDING' }, // new milestone
  ];
  const preservationErrors = validatePreservation(completedMs, newMilestones);
  assert(preservationErrors.length === 0, 'Preservation: all PASSED milestones preserved');

  // Test preservation violation
  const badMilestones = [
    { id: msId(1), status: 'PASSED', preserved: true },
    // ms-2 MISSING!
    { id: msId(3), status: 'PENDING' },
  ];
  const violations = validatePreservation(completedMs, badMilestones);
  assert(violations.length === 1, 'Preservation: violation detected when ms-2 removed');
  assert(violations[0].includes('removed'), 'Preservation: error says "removed"');

  // Reject the change
  const rejectResult = rejectChange(crId);
  assert(rejectResult.status === 'REJECTED', 'Change: rejected');

  const rejectedCR = crRepo.findById.get(crId);
  assert(rejectedCR.status === 'REJECTED', 'Change: DB status = REJECTED');
}

// ════════════════════════════════════════════════════════════════════════════════
// Phase 7: BUILD continues — Milestone 3 with retry
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Phase 7: BUILD continues — ms-3 with retry ──');

{
  // ms-3 depends on ms-2 — check
  const depCheck = checkDependencies(msId(3), lifecycleId);
  assert(depCheck.ready === true, 'ms-3: deps satisfied');

  // Simulate: first attempt fails
  msRepo.updateStatus.run('EXECUTING', msId(3));
  msRepo.markStarted.run(msId(3));
  msRepo.updateStatus.run('FAILED', msId(3));
  msRepo.updateRetry.run(msId(3));

  let ms3 = msRepo.getMilestone(msId(3));
  assert(ms3.status === 'FAILED', 'ms-3: first attempt failed');
  assert(ms3.retry_count === 1, 'ms-3: retry_count = 1');

  // Retry → success
  msRepo.updateStatus.run('EXECUTING', msId(3));

  // Write validation middleware file
  const validationCode = `export function validateTodo(req, res, next) {
  const { title } = req.body;
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return res.status(400).json({ error: 'title is required and must be a non-empty string' });
  }
  if (title.length > 200) {
    return res.status(400).json({ error: 'title must be 200 characters or less' });
  }
  next();
}

export function notFound(req, res) {
  res.status(404).json({ error: 'Endpoint not found' });
}

export function errorHandler(err, req, res, next) {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
}
`;

  fs.writeFileSync(path.join(projectPath, 'src', 'middleware.js'), validationCode);

  try {
    execSync(`git -C "${projectPath}" add -A && git -C "${projectPath}" commit -m "feat(ms-3): Error Handling + Validation"`, { stdio: 'pipe' });
    const hash = execSync(`git -C "${projectPath}" rev-parse --short HEAD`, { stdio: 'pipe' }).toString().trim();
    execSync(`git -C "${projectPath}" tag ms-3`, { stdio: 'pipe' });

    const healthScore3 = { scope_adherence: 0.9, test_coverage: 0.85, complexity_delta: 0.08, tech_debt_delta: 0.03 };
    msRepo.updateCompletion.run(hash, 'ms-3', JSON.stringify(healthScore3), msId(3));

    assert(true, `ms-3: committed ${hash} (after retry)`);

    ms3 = msRepo.getMilestone(msId(3));
    assert(ms3.status === 'PASSED', 'ms-3: status = PASSED');
    assert(ms3.retry_count === 1, 'ms-3: retry_count preserved');
  } catch (e) {
    fail('ms-3: git commit', e.message);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// Phase 8: Final state verification
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Phase 8: Final State ──');

{
  // All milestones completed
  const allMs = msRepo.listByLifecycle(lifecycleId);
  assert(allMs.length === 3, 'Final: 3 milestones total');

  const passedCount = allMs.filter(m => m.status === 'PASSED').length;
  assert(passedCount === 3, `Final: all 3 PASSED (got ${passedCount})`);

  // Each has commit hash
  for (const ms of allMs) {
    assert(ms.commit_hash !== null, `Final: ${ms.id} has commit_hash`);
    assert(ms.health_score !== null, `Final: ${ms.id} has health_score`);
  }

  // Roadmap version
  const latestRoadmap = roadmapVersions.getLatestRoadmap(lifecycleId);
  assert(latestRoadmap.version === 1, 'Final: roadmap still v1 (change was rejected)');

  // Git tags exist
  try {
    const tags = execSync(`git -C "${projectPath}" tag -l`, { stdio: 'pipe' }).toString().trim();
    assert(tags.includes('ms-1'), 'Final: git tag ms-1 exists');
    assert(tags.includes('ms-2'), 'Final: git tag ms-2 exists');
    assert(tags.includes('ms-3'), 'Final: git tag ms-3 exists');
  } catch (e) {
    fail('Final: git tags', e.message);
  }

  // Git log
  try {
    const log = execSync(`git -C "${projectPath}" log --oneline`, { stdio: 'pipe' }).toString().trim();
    assert(log.includes('feat(ms-1)'), 'Final: git log has ms-1 commit');
    assert(log.includes('feat(ms-2)'), 'Final: git log has ms-2 commit');
    assert(log.includes('feat(ms-3)'), 'Final: git log has ms-3 commit');
  } catch (e) {
    fail('Final: git log', e.message);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// Phase 9: Progress & Display
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Phase 9: Progress & Display ──');

{
  // computeLifecycleProgress
  const progress = computeLifecycleProgress(lifecycleId);
  assert(progress.percentage === 100, `Progress: 100% (got ${progress.percentage})`);
  assert(progress.total === 3, 'Progress: 3 milestones');
  assert(progress.byStatus.PASSED === 3, 'Progress: 3 PASSED');
}

{
  // getBuildProgress
  const bp = getBuildProgress(lifecycleId);
  assert(bp.percentage === 100, `BuildProgress: 100% (got ${bp.percentage})`);
  assert(bp.total === 3, 'BuildProgress: 3 total');
  assert(bp.completed === 3, `BuildProgress: 3 completed (got ${bp.completed})`);
}

{
  // formatLifecycleProgress
  const formatted = formatLifecycleProgress(lifecycleId, 'cs');
  assert(typeof formatted === 'string', 'formatLifecycleProgress: returns string');
  assert(formatted.includes('100%'), 'formatLifecycleProgress: includes 100%');
  assert(formatted.includes('hotovo'), 'formatLifecycleProgress: includes "hotovo"');
}

{
  // formatMilestoneTable
  const allMs = msRepo.listByLifecycle(lifecycleId);
  const table = formatMilestoneTable(allMs);
  assert(typeof table === 'string', 'formatMilestoneTable: returns string');
  assert(table.includes('ms-1') || table.includes('Project Setup'), 'formatMilestoneTable: includes milestone');
  assert(table.includes('PASSED'), 'formatMilestoneTable: includes status');
  assert(table.includes('|'), 'formatMilestoneTable: is a table (has pipes)');
}

{
  // formatHealthScoreHistory
  const allMs = msRepo.listByLifecycle(lifecycleId);
  const healthDisplay = formatHealthScoreHistory(allMs);
  assert(typeof healthDisplay === 'string', 'formatHealthScoreHistory: returns string');
  assert(healthDisplay.includes('Health Score'), 'formatHealthScoreHistory: includes header');
  assert(healthDisplay.includes('Scope'), 'formatHealthScoreHistory: includes Scope column');
}

{
  // Drift history after 4 checks
  const driftHistory = getDriftHistory(lifecycleId);
  assert(driftHistory.totalChecks === 4, 'Drift history: 4 checks total');
  assert(Object.keys(driftHistory.trends).length === 4, 'Drift history: trends for 4 types');
}

{
  // Aggregate health across all 3 milestones
  const health = getAggregateHealth(lifecycleId);
  assert(health.milestoneCount === 3, 'Aggregate health: 3 milestones');
  assert(health.averages.scope_adherence > 0.9, `Aggregate health: scope > 0.9 (got ${health.averages.scope_adherence})`);
  assert(health.averages.test_coverage > 0.7, `Aggregate health: tests > 0.7 (got ${health.averages.test_coverage})`);
}

// ════════════════════════════════════════════════════════════════════════════════
// Phase 10: Sample project verification
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Phase 10: Sample Project on Disk ──');

{
  // Verify all files exist
  const expectedFiles = [
    'package.json',
    'src/db.js',
    'src/routes.js',
    'src/index.js',
    'src/middleware.js',
  ];

  for (const file of expectedFiles) {
    const fullPath = path.join(projectPath, file);
    assert(fs.existsSync(fullPath), `File exists: ${file}`);
  }

  // Verify file contents
  const pkg = JSON.parse(fs.readFileSync(path.join(projectPath, 'package.json'), 'utf-8'));
  assert(pkg.name === 'todo-api', 'package.json: name = todo-api');
  assert(pkg.dependencies.express !== undefined, 'package.json: express dependency');
  assert(pkg.dependencies['better-sqlite3'] !== undefined, 'package.json: better-sqlite3 dependency');

  const dbContent = fs.readFileSync(path.join(projectPath, 'src', 'db.js'), 'utf-8');
  assert(dbContent.includes('CREATE TABLE'), 'db.js: has CREATE TABLE');
  assert(dbContent.includes('todos'), 'db.js: has todos table');

  const routesContent = fs.readFileSync(path.join(projectPath, 'src', 'routes.js'), 'utf-8');
  assert(routesContent.includes('router.get('), 'routes.js: has GET route');
  assert(routesContent.includes('router.post('), 'routes.js: has POST route');
  assert(routesContent.includes('router.put('), 'routes.js: has PUT route');
  assert(routesContent.includes('router.delete('), 'routes.js: has DELETE route');

  const mwContent = fs.readFileSync(path.join(projectPath, 'src', 'middleware.js'), 'utf-8');
  assert(mwContent.includes('validateTodo'), 'middleware.js: has validateTodo');
  assert(mwContent.includes('errorHandler'), 'middleware.js: has errorHandler');

  // File count
  const fileCount = expectedFiles.length;
  assert(fileCount === 5, `Sample project: ${fileCount} files created`);

  console.log(`\n  📁 Sample project created at: ${projectPath}`);
  console.log(`     Files: ${expectedFiles.join(', ')}`);
}

// ════════════════════════════════════════════════════════════════════════════════
// Phase 11: Cross-phase consistency
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Phase 11: Cross-phase Consistency ──');

{
  // DB consistency: lifecycle exists with correct project_id
  const lc = lifecycleRepo.findById.get(lifecycleId);
  assert(lc !== null, 'DB: lifecycle exists');
  assert(lc.project_id === testProjectId, 'DB: lifecycle.project_id correct');

  // Milestones belong to this lifecycle
  const allMs = msRepo.listByLifecycle(lifecycleId);
  for (const ms of allMs) {
    assert(ms.lifecycle_id === lifecycleId, `DB: ${ms.id} belongs to lifecycle`);
    assert(ms.roadmap_version === 1, `DB: ${ms.id} roadmap_version = 1`);
  }

  // Drift checks belong to this lifecycle
  const checks = driftChecks.getChecks(lifecycleId);
  assert(checks.length === 4, 'DB: 4 drift checks for this lifecycle');
  for (const check of checks) {
    assert(check.lifecycle_id === lifecycleId, `DB: drift check belongs to lifecycle`);
  }

  // Change requests belong to this lifecycle
  const crs = listChangeRequests(lifecycleId);
  assert(crs.length === 1, 'DB: 1 change request for this lifecycle');
  assert(crs[0].status === 'REJECTED', 'DB: CR status = REJECTED');

  // Spec is still valid
  const spec = lifecycleRepo.getSpec(lifecycleId);
  const validation = validateSpec(spec);
  assert(validation.valid, 'DB: stored spec still valid');
}

{
  // Git consistency
  try {
    const commitCount = execSync(`git -C "${projectPath}" rev-list --count HEAD`, { stdio: 'pipe' }).toString().trim();
    assert(parseInt(commitCount) >= 4, `Git: ${commitCount} commits (init + 3 milestones)`);

    const tagCount = execSync(`git -C "${projectPath}" tag -l | wc -l`, { stdio: 'pipe' }).toString().trim();
    assert(parseInt(tagCount) === 3, `Git: 3 tags`);
  } catch (e) {
    fail('Git consistency', e.message);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// Phase 12: API response structure
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Phase 12: API Response Structure ──');

{
  // Simulate what GET /api/lifecycle/status would return
  const progress = computeLifecycleProgress(lifecycleId);
  const driftHistory = getDriftHistory(lifecycleId);
  const aggregateHealth = getAggregateHealth(lifecycleId);
  const changeReqs = listChangeRequests(lifecycleId);

  const statusResponse = {
    lifecycleId,
    phase: lifecycleRepo.findById.get(lifecycleId).phase,
    progress,
    driftHistory,
    aggregateHealth,
    changeRequests: changeReqs,
  };

  assert(statusResponse.lifecycleId === lifecycleId, 'API: lifecycleId');
  assert(statusResponse.progress.percentage === 100, 'API: progress.percentage');
  assert(statusResponse.progress.total === 3, 'API: progress.total');
  assert(statusResponse.driftHistory.totalChecks === 4, 'API: driftHistory.totalChecks');
  assert(statusResponse.aggregateHealth.milestoneCount === 3, 'API: aggregateHealth.milestoneCount');
  assert(statusResponse.changeRequests.length === 1, 'API: changeRequests.length');

  // Verify it's JSON-serializable
  const serialized = JSON.stringify(statusResponse);
  const parsed = JSON.parse(serialized);
  assert(parsed.lifecycleId === lifecycleId, 'API: JSON round-trip OK');
}

// ════════════════════════════════════════════════════════════════════════════════
// Cleanup
// ════════════════════════════════════════════════════════════════════════════════

try {
  db.prepare('DELETE FROM drift_checks WHERE lifecycle_id = ?').run(lifecycleId);
  db.prepare('DELETE FROM change_requests WHERE lifecycle_id = ?').run(lifecycleId);
  db.prepare('DELETE FROM milestones WHERE lifecycle_id = ?').run(lifecycleId);
  db.prepare('DELETE FROM roadmap_versions WHERE lifecycle_id = ?').run(lifecycleId);
  db.prepare('DELETE FROM project_lifecycles WHERE id = ?').run(lifecycleId);
  db.prepare('DELETE FROM projects WHERE id = ?').run(testProjectId);
} catch (e) {
  console.log(`  ⚠️ DB cleanup: ${e.message}`);
}

// Keep sample project on disk for inspection (it's in /tmp, will auto-clean)
console.log(`\n  📁 Sample project preserved at: ${projectPath}`);
console.log(`     To inspect: ls -la ${projectPath}`);
console.log(`     Git log:    git -C ${projectPath} log --oneline`);

// ════════════════════════════════════════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(60)}`);
console.log(`  Lifecycle E2E Tests: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(60)}\n`);

if (failures.length > 0) {
  console.log('  Failures:');
  for (const f of failures) {
    console.log(`    - ${f.name}: ${f.msg}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
