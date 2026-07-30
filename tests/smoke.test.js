// tests/smoke.test.js — Runtime smoke test (no LLM, no GPU, no server)
// ══════════════════════════════════════════════════════════════════════════════
// Verifies the actual execution machinery works end-to-end using:
//   - fakeLLM   — predefined JSON responses (no Ollama, no network)
//   - fakeExecutor — writes real files to a tmpdir + real git commits
//
// This is the minimum viable runtime check. It catches failures that
// unit tests cannot: broken imports, DB schema mismatches, integration
// gaps between planner → executor → artifact output.
//
// Scenario: "Calculator API" — 1 milestone plan plus executor artifact checks
//   ms-1: Project Setup (package.json + src/index.js)
//
// Assertions:
//   1. Module exports are available and typed correctly
//   2. handleLifecycleBuildDetected sets PROPOSED state
//   3. ProjectLifecycle can be instantiated and DB records created
//   4. startNextMilestone creates a valid bounded plan awaiting approval
//   5. Files physically exist on disk and are non-empty
//   6. Git commit was created
//   7. DB tables are accessible
//
// Run: node tests/smoke.test.js
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { randomBytes } from 'crypto';

import {
  ProjectPhase,
  MilestoneStatus,
  ProjectLifecycle,
} from '../src/planner/index.js';

import {
  lifecycles as lifecycleRepo,
  milestones as msRepo,
  driftChecks,
  projects,
  lifecycleHandoffState,
  db,
} from '../src/db/database.js';

import {
  handleLifecycleBuildDetected,
  handleLifecycleInput,
} from '../src/chat/handlers/lifecycle-handoff.js';

import { getLcState, setLcState, clearLcState, initLifecycleStateDb } from '../src/chat/handlers/lifecycle-state.js';
import { startNextMilestone } from '../src/planner/lifecycle-build.js';

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';

// ─── Setup ───────────────────────────────────────────────────────────────────

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-smoke-'));
const projectDir = path.join(tmpDir, 'calculator-api');
fs.mkdirSync(projectDir, { recursive: true });
execFileSync('git', ['init', '-q'], { cwd: projectDir });
execFileSync('git', ['config', 'user.email', 'smoke@c3'], { cwd: projectDir });
execFileSync('git', ['config', 'user.name', 'C3 Smoke'], { cwd: projectDir });
execFileSync('git', ['commit', '--allow-empty', '-m', 'init', '-q'], { cwd: projectDir });

// ─── fakeLLM ─────────────────────────────────────────────────────────────────
// Returns minimal but structurally valid JSON for each lifecycle phase.
// IMPORTANT: Order matters — more specific patterns must come first to avoid
// substring conflicts (e.g. 'implementation' contains 'implement').

// fakeLLM returns {content, model, duration} matching the real callLLM contract.
// IMPORTANT: More specific patterns come first to avoid substring conflicts.
function createFakeLLM() {
  function wrap(obj) {
    return { content: JSON.stringify(obj), model: 'fake', duration: 1, promptEvalCount: 0, evalCount: 0 };
  }

  return async function fakeLLM(role, prompt) {
    const p = (prompt || '').toLowerCase();

    // Checkpoint (before 'implement' — 'implementation' would otherwise match code gen)
    if (p.includes('## checkpoint mode:') || p.includes('assess quality and correctness')) {
      return wrap({ passed: true, score: 0.90, findings: [], summary: 'Implementation looks correct' });
    }

    // SPEC detection
    if (p.includes('detect') || p.includes('classify')) {
      return wrap({ isProject: true, confidence: 0.95, reason: 'smoke-detected' });
    }

    // Spec generation
    if (
      (p.includes('spec') || p.includes('specif'))
      && !p.includes('detailed implementation plan for this milestone')
    ) {
      return wrap({
        title: 'Calculator API',
        goals: [{ id: 'G1', description: 'Provide REST endpoints for arithmetic operations' }],
        requirements: [{ id: 'R1', description: 'GET /calculate?op=add&a=1&b=2' }],
        tech_stack: { language: 'JavaScript', runtime: 'Node.js', framework: 'http' },
        risks: [],
      });
    }

    // Milestone-local implementation plan. This must precede generic code
    // generation because the prompt contains the word "implementation".
    if (
      p.includes('detailed implementation plan for this milestone')
      && p.includes('current milestone')
    ) {
      return wrap({
        milestone_id: 'ms-1',
        technical_approach: 'Create a minimal Node.js package and HTTP entry point within the milestone scope.',
        files: [
          { path: 'package.json', action: 'create', purpose: 'Define the runnable Node.js package.' },
          { path: 'src/index.js', action: 'create', purpose: 'Implement the calculator HTTP endpoint.' },
        ],
        implementation_steps: [
          {
            step: 1,
            action: 'Create the package manifest with an explicit module type and start script.',
            file: 'package.json',
            validation: 'Parse the manifest as JSON and verify the start script.',
          },
          {
            step: 2,
            action: 'Implement the HTTP calculator endpoint with numeric input validation.',
            file: 'src/index.js',
            validation: 'Import the module and exercise a valid addition request.',
          },
          {
            step: 3,
            action: 'Add validation for unsupported operations and malformed operands.',
            file: 'src/index.js',
            validation: 'Verify invalid requests return a deterministic 400 response.',
          },
        ],
        test_plan: [{
          name: 'calculator request validation',
          type: 'integration',
          description: 'Exercise successful and rejected calculator requests.',
          input: 'GET /calculate?op=add&a=1&b=2',
          expected_output: '{"result":3}',
        }],
        error_handling: [{
          scenario: 'The request contains an unsupported operation or non-numeric operand.',
          handling: 'Return status 400 with a stable JSON error.',
        }],
        scope_files: ['package.json', 'src/index.js'],
        rollback_strategy: 'Revert the milestone commit and restore the prior two files.',
      });
    }

    // Code generation (before roadmap — check 'implement' or 'write code')
    if (p.includes('implement') || (p.includes('generate') && p.includes('code')) || p.includes('write code')) {
      return wrap({
        steps: [
          { type: 'create_file', description: 'Create package.json', files: ['package.json'] },
          { type: 'create_file', description: 'Create HTTP server', files: ['src/index.js'] },
          { type: 'run_tests', description: 'Verify server starts', files: [] },
        ],
        files: [
          { path: 'package.json', content: JSON.stringify({ name: 'calculator-api', version: '1.0.0', type: 'module', main: 'src/index.js' }) },
          {
            path: 'src/index.js',
            content: [
              'import http from "http";',
              'const server = http.createServer((req, res) => {',
              '  res.writeHead(200, { "Content-Type": "application/json" });',
              '  res.end(JSON.stringify({ ok: true }));',
              '});',
              'server.listen(3000);',
              'export default server;',
            ].join('\n'),
          },
        ],
      });
    }

    // Roadmap / planning
    if (p.includes('roadmap') || p.includes('milestone') || p.includes('plan')) {
      return wrap({
        milestones: [{
          id: 'ms-1',
          title: 'Project Setup',
          description: 'Initialize project with package.json and HTTP server',
          scope_files: ['package.json', 'src/index.js'],
          estimated_loc: 80,
          dependencies: [],
        }],
      });
    }

    // Health score
    if (p.includes('health') || p.includes('quality') || p.includes('score')) {
      return wrap({ scope: 0.95, tests: 0.60, complexity: 0.15, debt: 0.05 });
    }

    // Fallback
    return wrap({ ok: true, smoke: true });
  };
}

// ─── fakeExecutor ─────────────────────────────────────────────────────────────

function createFakeExecutor(projectPath) {
  return async function fakeExecutor(plan) {
    const files = plan.files || [];
    const written = [];

    for (const f of files) {
      const fullPath = path.join(projectPath, f.path);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, f.content || '', 'utf-8');
      written.push(f.path);
    }

    if (written.length > 0) {
      try {
        execFileSync('git', ['add', '--', ...written], { cwd: projectPath });
        execFileSync('git', ['commit', '-m', `executor: ${plan.milestone_id || 'smoke'}`, '-q'], {
          cwd: projectPath,
        });
      } catch (_) {
        // git errors are non-fatal in smoke context
      }
    }

    return {
      success: true,
      files_written: written,
      exit_code: 0,
      stdout: `Written: ${written.join(', ')}`,
      stderr: '',
    };
  };
}

// ─── Session ──────────────────────────────────────────────────────────────────

const SESSION = `smoke-${Date.now()}`;

// ─── Tests (top-level await — ESM supports it) ────────────────────────────────

suite('Smoke — module loadability');

test('all critical planner exports are available', () => {
  assert(typeof ProjectLifecycle === 'function', 'ProjectLifecycle not a function');
  assert(typeof ProjectPhase === 'object', 'ProjectPhase not an object');
  assert(typeof MilestoneStatus === 'object', 'MilestoneStatus not an object');
});

test('handleLifecycleBuildDetected is a function', () => {
  assert(typeof handleLifecycleBuildDetected === 'function');
});

test('handleLifecycleInput is a function', () => {
  assert(typeof handleLifecycleInput === 'function');
});

test('startNextMilestone is a function', () => {
  assert(typeof startNextMilestone === 'function');
});

test('DB repos are available', () => {
  // lifecycleRepo.create is a prepared statement (not a callable fn) — check save() instead
  assert(lifecycleRepo && typeof lifecycleRepo.save === 'function', 'lifecycleRepo.save missing');
  assert(msRepo && typeof msRepo.addMilestone === 'function', 'msRepo.addMilestone missing');
});

// ─────────────────────────────────────────────────────────────────────────────

suite('Smoke — lifecycle init');

await testAsync('handleLifecycleBuildDetected sets PROPOSED state', async () => {
  // handleLifecycleBuildDetected(input, decision, context) — sets LC state, returns response
  const fakeDec = { type: 'BUILD', intent: 'BUILD', confidence: 0.9 };
  const ctx = { sessionId: SESSION };

  let result;
  try {
    result = handleLifecycleBuildDetected('Chci vytvořit REST API pro kalkulačku v Node.js', fakeDec, ctx);
  } catch (e) {
    assert(false, `handleLifecycleBuildDetected threw: ${e.message}`);
  }

  assert(result !== undefined && result !== null, 'handleLifecycleBuildDetected returned nothing');

  // State should be PROPOSED
  const state = getLcState(SESSION);
  assert(state, 'lifecycle state not set after detection');
  assert(state.phase === 'PROPOSED', `expected PROPOSED phase, got ${state.phase}`);
});

await testAsync('lifecycle phase is PROPOSED after detection', async () => {
  const state = getLcState(SESSION);
  if (!state) { console.log('  ⏭ skipped (no state)'); return; }
  assert(state.phase === 'PROPOSED', `expected PROPOSED, got ${state.phase}`);
});

// ─────────────────────────────────────────────────────────────────────────────

suite('Smoke — full 1-milestone build (fakeLLM + fakeExecutor)');

const buildLcId = 'lc-smoke-' + randomBytes(4).toString('hex');
const smokeMs1Id = 'ms-1@' + buildLcId.slice(-6);

await testAsync('creates a valid ms-1 plan and waits for explicit approval', async () => {
  // 0. Create a project record (project_lifecycles has FK → projects(id))
  const projResult = projects.create.run('smoke-' + buildLcId, projectDir, 'Smoke test project');
  const smokeProjectId = projResult.lastInsertRowid;

  // 1. Create lifecycle record using save(id, projectId, phase, spec, config)
  lifecycleRepo.save(buildLcId, smokeProjectId, ProjectPhase.PLANNING,
    JSON.stringify({
      title: 'Calculator API',
      goals: [{ id: 'G1', description: 'REST arithmetic endpoints' }],
      requirements: [{ id: 'R1', description: 'GET /calculate' }],
      tech_stack: { language: 'JavaScript', runtime: 'Node.js' },
      risks: [],
    }),
    JSON.stringify({
      roadmap: {
        version: 1,
        milestones: [{
          id: 'ms-1', title: 'Project Setup',
          scope_files: ['package.json', 'src/index.js'],
          dependencies: [],
        }],
      },
    }),
  );

  const lcRow = lifecycleRepo.findById.get(buildLcId);
  assert(lcRow, `lifecycle ${buildLcId} not found in DB after save()`);

  // 2. Create milestone using addMilestone()
  msRepo.addMilestone({
    id: smokeMs1Id,
    lifecycle_id: buildLcId,
    roadmap_version: 1,
    sequence: 1,
    title: 'Project Setup',
    status: 'PENDING',
    scope_files: ['package.json', 'src/index.js'],
    estimated_loc: 80,
    dependencies: [],
  });

  const msRow = msRepo.getMilestone(smokeMs1Id);
  assert(msRow, `milestone ${smokeMs1Id} not found in DB after addMilestone()`);

  // 3. Instantiate ProjectLifecycle with DI
  const lifecycle = new ProjectLifecycle({
    id: buildLcId,
    projectId: smokeProjectId,
    projectPath: projectDir,
    callLLM: createFakeLLM(),
    executor: createFakeExecutor(projectDir),
  });
  lifecycle._phase = ProjectPhase.PLANNING;

  // 4. Run startNextMilestone — finds PENDING milestones and prepares a plan.
  let startResult;
  try {
    startResult = await startNextMilestone(lifecycle);
  } catch (e) {
    assert(false, `startNextMilestone threw: ${e.message}`);
  }

  // 5. startNextMilestone is deliberately approval-gated. It must not silently
  // accept a failed, blocked, pending, or already-passed state.
  const msFinal = msRepo.getMilestone(smokeMs1Id);
  assertEqual(startResult?.status, MilestoneStatus.AWAITING_PLAN);
  assertEqual(msFinal?.status, MilestoneStatus.AWAITING_PLAN);
  assertEqual(startResult?.localPlan?.implementation_steps?.length, 3);
  assertEqual(startResult?.scopeFiles?.join(','), 'package.json,src/index.js');
});

// ─────────────────────────────────────────────────────────────────────────────

suite('Smoke — artifact existence on disk');

await testAsync('fakeExecutor writes non-empty files to projectDir', async () => {
  const executor = createFakeExecutor(projectDir);
  const plan = {
    milestone_id: 'ms-smoke',
    files: [
      { path: 'smoke-check.json', content: JSON.stringify({ smoke: true, ts: Date.now() }) },
      { path: 'src/smoke.js', content: 'export const smoke = true;\n' },
    ],
  };

  const result = await executor(plan);

  assert(result.success, 'executor failed');
  assert(result.files_written.length === 2, `expected 2 files, got ${result.files_written.length}`);

  for (const rel of result.files_written) {
    const fullPath = path.join(projectDir, rel);
    assert(fs.existsSync(fullPath), `file not found: ${rel}`);
    assert(fs.statSync(fullPath).size > 0, `file is empty: ${rel}`);
  }
});

await testAsync('package.json written by executor is valid JSON', async () => {
  const executor = createFakeExecutor(projectDir);
  const pkgContent = JSON.stringify({ name: 'calculator-api', version: '1.0.0', type: 'module' });
  await executor({ milestone_id: 'ms-pkg', files: [{ path: 'package.json', content: pkgContent }] });

  const written = fs.readFileSync(path.join(projectDir, 'package.json'), 'utf-8');
  let parsed;
  try { parsed = JSON.parse(written); } catch (e) { assert(false, `package.json is not valid JSON: ${e.message}`); }
  assertEqual(parsed.name, 'calculator-api');
  assertEqual(parsed.version, '1.0.0');
});

await testAsync('js file written by executor is non-empty', async () => {
  const executor = createFakeExecutor(projectDir);
  const jsContent = 'import http from "http";\nconst server = http.createServer();\nexport default server;\n';
  await executor({ milestone_id: 'ms-js', files: [{ path: 'src/index.js', content: jsContent }] });

  const written = fs.readFileSync(path.join(projectDir, 'src/index.js'), 'utf-8');
  assert(written.trim().length > 0, 'src/index.js is empty');
  assert(written.includes('import http'), 'expected import statement not found');
});

// ─────────────────────────────────────────────────────────────────────────────

suite('Smoke — git state');

test('projectDir is a git repository', () => {
  const gitDir = path.join(projectDir, '.git');
  assert(fs.existsSync(gitDir), '.git directory not found in projectDir');
});

await testAsync('fakeExecutor creates a git commit', async () => {
  const executor = createFakeExecutor(projectDir);
  await executor({ milestone_id: 'ms-git-check', files: [{ path: 'git-smoke.txt', content: 'smoke\n' }] });

  let log;
  try {
    log = execFileSync('git', ['log', '--oneline'], { cwd: projectDir, encoding: 'utf-8' });
  } catch (e) {
    assert(false, `git log failed: ${e.message}`);
  }
  assert(log.includes('executor:'), 'expected executor commit not found in git log');
});

// ─────────────────────────────────────────────────────────────────────────────

suite('Smoke — fakeLLM response validity');

await testAsync('fakeLLM returns valid JSON for spec prompt', async () => {
  const llm = createFakeLLM();
  const res = await llm('D1', 'Generate a spec for this project with goals and requirements');
  let parsed;
  try { parsed = JSON.parse(res.content); } catch (e) { assert(false, `spec response is not JSON: ${e.message}`); }
  assert(parsed.title, 'spec response missing title');
  assert(Array.isArray(parsed.goals), 'spec response missing goals array');
});

await testAsync('fakeLLM returns valid JSON for roadmap prompt', async () => {
  const llm = createFakeLLM();
  const res = await llm('D1', 'Generate a roadmap with milestones for the project');
  let parsed;
  try { parsed = JSON.parse(res.content); } catch (e) { assert(false, `roadmap response is not JSON: ${e.message}`); }
  assert(Array.isArray(parsed.milestones), 'roadmap response missing milestones array');
  assert(parsed.milestones.length > 0, 'roadmap has no milestones');
});

await testAsync('fakeLLM returns valid JSON for code generation prompt', async () => {
  const llm = createFakeLLM();
  const res = await llm('CODE', 'Write code and generate files for this feature');
  let parsed;
  try { parsed = JSON.parse(res.content); } catch (e) { assert(false, `code response is not JSON: ${e.message}`); }
  assert(Array.isArray(parsed.files), 'code response missing files array');
  assert(parsed.files.length > 0, 'code response has no files');
  for (const f of parsed.files) {
    assert(f.path, `file missing path: ${JSON.stringify(f)}`);
    assert(f.content && f.content.trim().length > 0, `file has empty content: ${f.path}`);
  }
});

await testAsync('fakeLLM returns valid JSON for checkpoint prompt', async () => {
  const llm = createFakeLLM();
  const res = await llm('D1', 'Checkpoint: assess quality and correctness of the current implementation');
  let parsed;
  try { parsed = JSON.parse(res.content); } catch (e) { assert(false, `checkpoint response is not JSON: ${e.message}`); }
  assert(typeof parsed.passed === 'boolean', 'checkpoint missing passed field');
});

// ─────────────────────────────────────────────────────────────────────────────

suite('Smoke — DB integrity');

test('lifecycle DB table is accessible', () => {
  let count;
  try {
    const rows = db.prepare('SELECT COUNT(*) as c FROM project_lifecycles').get();
    count = rows.c;
  } catch (e) {
    assert(false, `project_lifecycles table not accessible: ${e.message}`);
  }
  assert(typeof count === 'number', 'unexpected count type');
});

test('milestones DB table is accessible', () => {
  try { db.prepare('SELECT COUNT(*) as c FROM milestones').get(); }
  catch (e) { assert(false, `milestones table not accessible: ${e.message}`); }
});

test('drift_checks DB table is accessible', () => {
  try { db.prepare('SELECT COUNT(*) as c FROM drift_checks').get(); }
  catch (e) { assert(false, `drift_checks table not accessible: ${e.message}`); }
});

test('roadmap_versions DB table is accessible', () => {
  try { db.prepare('SELECT COUNT(*) as c FROM roadmap_versions').get(); }
  catch (e) { assert(false, `roadmap_versions table not accessible: ${e.message}`); }
});

// ─────────────────────────────────────────────────────────────────────────────

// Cleanup tmpDir on success (leave on failure for inspection)
process.on('exit', (code) => {
  if (code === 0) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  } else {
    console.log(`\n  ℹ️  Smoke tmpDir preserved for inspection: ${tmpDir}`);
  }
});

const { failed: smokeFailed } = summary();
process.exit(smokeFailed > 0 ? 1 : 0);
