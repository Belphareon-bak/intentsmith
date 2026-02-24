// Project Lifecycle E2E Test 1 — Happy Path: PROPOSED → COMPLETED
// ══════════════════════════════════════════════════════════════════════════════
// Deterministic, mock LLM. Walks through the entire lifecycle:
//   PROPOSED → SPEC → SPEC_REVIEW → PLANNING → PLAN_REVIEW →
//   BUILD (ms-1, ms-2, ms-3) → REVIEW → COMPLETED
//
// Verifies at each phase:
//   - Phase transitions (DB + RAM state)
//   - ROADMAP.md exists with correct content (P1)
//   - README.md gets refreshed after milestones (P2)
//   - PROPOSED intro info is comprehensive (P4)
//   - Git commits + tags after milestones
//   - DB consistency (lifecycle, milestones, roadmap_versions)
//
// Run: node tests/project-lifecycle-happy-path.test.js
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

// ─── Sample Data ────────────────────────────────────────────────────────────

const SPEC = {
  title: 'Greeting Service',
  goals: [
    { id: 'G1', description: 'HTTP greeting endpoint', priority: 'MUST' },
    { id: 'G2', description: 'Multiple language support', priority: 'MUST' },
    { id: 'G3', description: 'Configurable port', priority: 'SHOULD' },
  ],
  requirements: [
    { id: 'R1', description: 'GET /greet?name=X returns greeting', type: 'functional', goal_id: 'G1' },
    { id: 'R2', description: 'Accept-Language header for locale', type: 'functional', goal_id: 'G2' },
    { id: 'R3', description: 'PORT env variable support', type: 'functional', goal_id: 'G3' },
    { id: 'R4', description: 'Health check endpoint GET /health', type: 'functional', goal_id: 'G1' },
    { id: 'R5', description: 'JSON response format', type: 'functional', goal_id: 'G1' },
  ],
  tech_stack: {
    languages: ['JavaScript'],
    frameworks: ['Node.js', 'Express'],
    tools: [],
    rationale: 'Simple HTTP service',
  },
  architecture: {
    pattern: 'Single-file service',
    components: ['server.js', 'greetings.js', 'config.js'],
  },
  risks: [
    { id: 'RISK1', description: 'Port conflict', severity: 'LOW', mitigation: 'Configurable port' },
  ],
  constraints: ['No external API calls'],
  out_of_scope: ['Authentication', 'Database'],
};

const ROADMAP = {
  milestones: [
    {
      id: 'ms-1',
      title: 'Server Setup + Config',
      description: 'Express server with configurable port and health endpoint',
      dependencies: [],
      estimated_loc: 60,
      estimated_files: 2,
      estimated_complexity: 'LOW',
      goals_addressed: ['G3'],
      requirements_addressed: ['R3', 'R4'],
      deliverables: ['server.js', 'config.js'],
    },
    {
      id: 'ms-2',
      title: 'Greeting Endpoint',
      description: 'GET /greet endpoint with greeting logic',
      dependencies: ['ms-1'],
      estimated_loc: 80,
      estimated_files: 1,
      estimated_complexity: 'LOW',
      goals_addressed: ['G1'],
      requirements_addressed: ['R1', 'R5'],
      deliverables: ['greetings.js'],
    },
    {
      id: 'ms-3',
      title: 'Multi-language Support',
      description: 'Accept-Language header parsing and locale-based greetings',
      dependencies: ['ms-2'],
      estimated_loc: 50,
      estimated_files: 1,
      estimated_complexity: 'LOW',
      goals_addressed: ['G2'],
      requirements_addressed: ['R2'],
      deliverables: ['greetings.js'],
    },
  ],
  total_estimated_loc: 190,
  total_milestones: 3,
  critical_path: ['ms-1', 'ms-2', 'ms-3'],
};

const MS_PLANS = {
  'ms-1': {
    milestone_id: 'ms-1',
    files: [
      { path: 'server.js', action: 'create', purpose: 'Express server' },
      { path: 'config.js', action: 'create', purpose: 'Port configuration' },
    ],
    implementation_steps: [
      { step: 1, action: 'Create config.js with PORT', file: 'config.js' },
      { step: 2, action: 'Create server.js with /health', file: 'server.js' },
    ],
    scope_files: ['server.js', 'config.js'],
  },
  'ms-2': {
    milestone_id: 'ms-2',
    files: [
      { path: 'greetings.js', action: 'create', purpose: 'Greeting logic' },
    ],
    implementation_steps: [
      { step: 1, action: 'Create greetings.js with greet function', file: 'greetings.js' },
    ],
    scope_files: ['greetings.js', 'server.js'],
  },
  'ms-3': {
    milestone_id: 'ms-3',
    files: [
      { path: 'greetings.js', action: 'modify', purpose: 'Add locale support' },
    ],
    implementation_steps: [
      { step: 1, action: 'Add Accept-Language parsing', file: 'greetings.js' },
    ],
    scope_files: ['greetings.js'],
  },
};

const FILES = {
  'ms-1': {
    'config.js': `export const PORT = process.env.PORT || 3000;\n`,
    'server.js': `import express from 'express';
import { PORT } from './config.js';

const app = express();

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(\`Listening on \${PORT}\`));

export default app;
`,
  },
  'ms-2': {
    'greetings.js': `const greetings = { en: 'Hello', cs: 'Ahoj', de: 'Hallo' };

export function greet(name, locale = 'en') {
  const greeting = greetings[locale] || greetings.en;
  return { greeting: \`\${greeting}, \${name}!\`, locale };
}
`,
  },
  'ms-3': {
    'greetings.js': `const greetings = { en: 'Hello', cs: 'Ahoj', de: 'Hallo', fr: 'Bonjour', es: 'Hola' };

export function greet(name, locale = 'en') {
  const greeting = greetings[locale] || greetings.en;
  return { greeting: \`\${greeting}, \${name}!\`, locale, supported: Object.keys(greetings) };
}

export function parseLocale(acceptLanguage) {
  if (!acceptLanguage) return 'en';
  const primary = acceptLanguage.split(',')[0].split('-')[0].trim().toLowerCase();
  return greetings[primary] ? primary : 'en';
}
`,
  },
};

// ─── Fake LLM ───────────────────────────────────────────────────────────────

function createFakeLLM() {
  return async function fakeLLM(role, prompt) {
    const p = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);

    // SPEC: questions
    if (p.includes('analyzing a project request') || p.includes('clarifying questions')) {
      return {
        content: JSON.stringify({
          core_goal: 'Build a greeting HTTP service',
          clarifying_questions: [
            'Jaké jazyky chceš podporovat?',
            'Má služba odpovídat v JSON?',
            'Jaký port?',
          ],
          initial_assessment: {
            estimated_complexity: 'LOW',
            key_risks: ['Port conflict'],
            suggested_tech_stack: ['Node.js', 'Express'],
          },
        }),
      };
    }

    // SPEC: document
    if (p.includes('creating a project specification') || p.includes('structured project specification')) {
      return { content: JSON.stringify(SPEC) };
    }

    // PLANNING: roadmap
    if (p.includes('creating a project roadmap') || p.includes('Break the project into milestones')) {
      return { content: JSON.stringify(ROADMAP) };
    }

    // BUILD: milestone plan
    if (p.includes('implementing a specific milestone') || p.includes('implementation plan for THIS milestone')) {
      const msMatch = p.match(/"id"\s*:\s*"(ms-\d+)"/);
      const msId = msMatch ? msMatch[1] : 'ms-1';
      return { content: JSON.stringify(MS_PLANS[msId] || MS_PLANS['ms-1']) };
    }

    // BUILD: checkpoint
    if (p.includes('reviewing a completed milestone') || p.includes('Compare the actual output')) {
      return {
        content: JSON.stringify({
          passed: true,
          deliverables_check: [{ deliverable: 'Files', status: 'DONE', note: 'All present' }],
          scope_violations: [],
          test_summary: { total: 3, passed: 3, failed: 0 },
          overall_assessment: 'Milestone completed',
        }),
      };
    }

    // BUILD: health score
    if (p.includes('computing health metrics') || p.includes('health metrics for a completed milestone')) {
      return {
        content: JSON.stringify({
          scope_adherence: 0.95,
          test_coverage: 0.80,
          complexity_delta: 0.10,
          tech_debt_delta: 0.05,
        }),
      };
    }

    // REVIEW: project review
    if (p.includes('conducting a project review') || p.includes('4 drift checks')) {
      return {
        content: JSON.stringify({
          spec_alignment: { addressed_goals: ['G1', 'G2', 'G3'], unaddressed_goals: [], confidence: 0.95 },
          scope_creep: { severity: 'NONE', confidence: 0.9 },
          architecture_consistency: { consistent: true, violations: [], confidence: 0.9 },
          tech_debt: { items: [], trend: 'STABLE', confidence: 0.8 },
          overall_health: 'GREEN',
          recommendations: [],
        }),
      };
    }

    console.warn(`    ⚠️ fakeLLM: unmatched prompt (role=${role})`);
    return { content: '{}' };
  };
}

// ─── Fake Executor ──────────────────────────────────────────────────────────

function createFakeExecutor(projectPath) {
  return {
    async start(request, context) {
      const msId = context.milestoneId;
      const files = FILES[msId] || {};

      for (const [relPath, content] of Object.entries(files)) {
        const fullPath = path.join(projectPath, relPath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content);
      }

      try {
        execSync('git add -A', { cwd: projectPath, stdio: 'pipe' });
        execSync(`git commit -m "executor: ${msId}" --allow-empty`, { cwd: projectPath, stdio: 'pipe' });
      } catch { /* ignore */ }

      return { state: 'COMPLETED', sessionId: `mock-wf-${msId}` };
    },
    async approve(sessionId) {
      return { state: 'COMPLETED', sessionId };
    },
  };
}

// ─── DB Cleanup ─────────────────────────────────────────────────────────────

function cleanDB() {
  // Clean lifecycle data — NEVER wipe user projects/conversations
  for (const t of ['lifecycle_handoff_state', 'drift_checks', 'change_requests',
                    'milestones', 'roadmap_versions', 'project_lifecycles']) {
    try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* ignore */ }
  }
  // Only remove temp test projects (preserve user/persistent projects)
  try { db.prepare(`DELETE FROM projects WHERE path LIKE '/tmp/%'`).run(); } catch { /* ignore */ }
  initLifecycleStateDb(lifecycleHandoffState, lifecycleRepo);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── MAIN TEST ──────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function run() {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('  Test 1: Happy Path — PROPOSED → COMPLETED');
  console.log('══════════════════════════════════════════════════════════════════════');

  cleanDB();

  const SESSION_ID = 'happy-path-test';
  const projectPath = `/tmp/lc-happy-path-${Date.now()}`;
  fs.mkdirSync(projectPath, { recursive: true });
  execSync('git init', { cwd: projectPath, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: projectPath, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: projectPath, stdio: 'pipe' });
  execSync('git commit --allow-empty -m "init"', { cwd: projectPath, stdio: 'pipe' });

  const fakeLLM = createFakeLLM();
  const fakeExecutor = createFakeExecutor(projectPath);

  const context = {
    sessionId: SESSION_ID,
    callLLM: fakeLLM,
    executor: fakeExecutor,
    projectPath,
  };

  try {
    // ═══ PHASE 1: PROPOSED ══════════════════════════════════════════════════

    console.log('\n═══ PHASE 1: PROPOSED ═══════════════════════════════════════════════');

    const r1 = handleLifecycleBuildDetected(
      'Chci vytvořit greeting service s multi-language support a konfigurovatelným portem',
      { intent: 'BUILD' },
      context
    );

    check(r1?.content?.includes('lifecycle'), 'P1.1: response mentions lifecycle');
    check(r1?.content?.includes('ano/ne'), 'P1.2: asks for confirmation');

    // P4: Verify comprehensive intro info
    check(r1?.content?.includes('SPEC'), 'P4.1: intro mentions SPEC phase');
    check(r1?.content?.includes('PLANNING'), 'P4.2: intro mentions PLANNING phase');
    check(r1?.content?.includes('BUILD'), 'P4.3: intro mentions BUILD phase');
    check(r1?.content?.includes('README.md'), 'P4.4: intro mentions README.md');
    check(r1?.content?.includes('ROADMAP.md'), 'P4.5: intro mentions ROADMAP.md');
    check(r1?.content?.includes('Git commit') || r1?.content?.includes('commit'),
      'P4.6: intro mentions git commits');
    check(r1?.content?.includes('pauza') || r1?.content?.includes('zrušit'),
      'P4.7: intro mentions pause/cancel');

    const s1 = getLcState(SESSION_ID);
    check(s1?.phase === 'PROPOSED', 'P1.3: state is PROPOSED', `got: ${s1?.phase}`);

    // ═══ PHASE 2: SPEC ══════════════════════════════════════════════════════

    console.log('\n═══ PHASE 2: SPEC ═══════════════════════════════════════════════════');

    const r2 = await handleLifecycleInput('ano', context);
    const s2 = getLcState(SESSION_ID);
    check(s2?.phase === 'SPEC', 'P2.1: state is SPEC', `got: ${s2?.phase}`);
    check(s2?.lifecycleId != null, 'P2.2: lifecycleId set');

    // Answer spec questions → SPEC_REVIEW
    const r3 = await handleLifecycleInput('JSON, Express, Node 20+, port 3000', context);
    const s3 = getLcState(SESSION_ID);
    check(s3?.phase === 'SPEC_REVIEW', 'P2.3: state is SPEC_REVIEW', `got: ${s3?.phase}`);

    // ═══ PHASE 3: SPEC_REVIEW → PLANNING → PLAN_REVIEW ═════════════════════

    console.log('\n═══ PHASE 3: SPEC_REVIEW → PLAN_REVIEW ══════════════════════════════');

    const r4 = await handleLifecycleInput('schvaluji', context);
    const s4 = getLcState(SESSION_ID);
    check(s4?.phase === 'PLAN_REVIEW', 'P3.1: state is PLAN_REVIEW', `got: ${s4?.phase}`);

    // P1: ROADMAP.md should exist after generateRoadmap
    const roadmapAfterPlan = path.join(projectPath, 'ROADMAP.md');
    check(fs.existsSync(roadmapAfterPlan),
      'P1.1: ROADMAP.md exists after generateRoadmap');

    if (fs.existsSync(roadmapAfterPlan)) {
      const rmContent = fs.readFileSync(roadmapAfterPlan, 'utf-8');
      check(rmContent.includes('# ROADMAP'), 'P1.2: ROADMAP.md has # ROADMAP header');
      check(rmContent.includes('v1'), 'P1.3: ROADMAP.md has version v1');
      check(rmContent.includes('Server Setup'), 'P1.4: ROADMAP.md has ms-1 title');
      check(rmContent.includes('Greeting Endpoint'), 'P1.5: ROADMAP.md has ms-2 title');
      check(rmContent.includes('Multi-language'), 'P1.6: ROADMAP.md has ms-3 title');
      check(rmContent.includes('PENDING'), 'P1.7: ROADMAP.md shows PENDING status');
      check(rmContent.includes('Version History'), 'P1.8: ROADMAP.md has version history');
      check(rmContent.includes('Initial roadmap'), 'P1.9: version history has "Initial roadmap"');
    }

    // ═══ PHASE 4: BUILD — Milestone 1 ═══════════════════════════════════════

    console.log('\n═══ PHASE 4: BUILD — Milestone 1 ══════════════════════════════════');

    const r5 = await handleLifecycleInput('schvaluji', context);
    const s5 = getLcState(SESSION_ID);
    check(s5?.phase === 'BUILD_MILESTONE_REVIEW', 'P4.1: state is BUILD_MILESTONE_REVIEW',
      `got: ${s5?.phase}`);
    check(s5?.currentMilestoneId === 'ms-1', 'P4.2: currentMilestoneId is ms-1',
      `got: ${s5?.currentMilestoneId}`);

    // Approve ms-1 → execute
    const r6 = await handleLifecycleInput('ano', context);

    const ms1 = msRepo.getMilestone('ms-1');
    check(ms1?.status === 'PASSED', 'P4.3: ms-1 PASSED in DB', `got: ${ms1?.status}`);

    // File verification
    check(fs.existsSync(path.join(projectPath, 'server.js')), 'P4.4: server.js on disk');
    check(fs.existsSync(path.join(projectPath, 'config.js')), 'P4.5: config.js on disk');

    // P1: ROADMAP.md updated after ms-1 PASSED
    if (fs.existsSync(roadmapAfterPlan)) {
      const rmAfterMs1 = fs.readFileSync(roadmapAfterPlan, 'utf-8');
      check(rmAfterMs1.includes('DONE'), 'P1.10: ROADMAP.md shows DONE after ms-1');
    }

    // P2: README.md refreshed
    const readmePath = path.join(projectPath, 'README.md');
    check(fs.existsSync(readmePath), 'P2.1: README.md exists after ms-1');

    // ═══ PHASE 5: BUILD — Milestone 2 ═══════════════════════════════════════

    console.log('\n═══ PHASE 5: BUILD — Milestone 2 ══════════════════════════════════');

    // ms-2 plan should be auto-shown after ms-1 PASS
    const s6 = getLcState(SESSION_ID);
    check(s6?.currentMilestoneId === 'ms-2', 'P5.1: auto-advanced to ms-2',
      `got: ${s6?.currentMilestoneId}`);

    const r7 = await handleLifecycleInput('ano', context);
    const ms2 = msRepo.getMilestone('ms-2');
    check(ms2?.status === 'PASSED', 'P5.2: ms-2 PASSED in DB', `got: ${ms2?.status}`);

    check(fs.existsSync(path.join(projectPath, 'greetings.js')), 'P5.3: greetings.js on disk');

    // P1: ROADMAP.md updated — two milestones DONE
    if (fs.existsSync(roadmapAfterPlan)) {
      const rmAfterMs2 = fs.readFileSync(roadmapAfterPlan, 'utf-8');
      const doneCount = (rmAfterMs2.match(/DONE/g) || []).length;
      check(doneCount >= 2, 'P1.11: ROADMAP.md has 2+ DONE milestones', `got: ${doneCount}`);
    }

    // ═══ PHASE 6: BUILD — Milestone 3 ═══════════════════════════════════════

    console.log('\n═══ PHASE 6: BUILD — Milestone 3 ══════════════════════════════════');

    const s7 = getLcState(SESSION_ID);
    check(s7?.currentMilestoneId === 'ms-3', 'P6.1: auto-advanced to ms-3',
      `got: ${s7?.currentMilestoneId}`);

    const r8 = await handleLifecycleInput('ano', context);
    const ms3 = msRepo.getMilestone('ms-3');
    check(ms3?.status === 'PASSED', 'P6.2: ms-3 PASSED in DB', `got: ${ms3?.status}`);

    // P1: ROADMAP.md — all milestones DONE
    if (fs.existsSync(roadmapAfterPlan)) {
      const rmFinal = fs.readFileSync(roadmapAfterPlan, 'utf-8');
      const doneCount = (rmFinal.match(/DONE/g) || []).length;
      check(doneCount === 3, 'P1.12: ROADMAP.md has all 3 DONE', `got: ${doneCount}`);
      check(!rmFinal.includes('PENDING'), 'P1.13: ROADMAP.md has no PENDING');
    }

    // P2: README.md still exists after all milestones
    check(fs.existsSync(readmePath), 'P2.2: README.md exists after all milestones');

    // ═══ PHASE 7: REVIEW or COMPLETED ═══════════════════════════════════════

    console.log('\n═══ PHASE 7: REVIEW / COMPLETED ═══════════════════════════════════');

    const sAfterMs3 = getLcState(SESSION_ID);
    if (sAfterMs3?.phase === 'REVIEW') {
      console.log('  Review triggered, acknowledging...');
      const r9 = await handleLifecycleInput('pokračovat', context);
    }

    // ═══ PHASE 8: Final Verification ════════════════════════════════════════

    console.log('\n═══ PHASE 8: Final Verification ═══════════════════════════════════');

    const lifecycleId = s4.lifecycleId;

    // DB: lifecycle COMPLETED
    const lcDb = lifecycleRepo.findById.get(lifecycleId);
    check(lcDb?.phase === 'COMPLETED', 'DB.1: lifecycle phase is COMPLETED', `got: ${lcDb?.phase}`);

    // DB: all milestones PASSED
    const allMs = msRepo.listByLifecycle(lifecycleId);
    check(allMs.length === 3, 'DB.2: 3 milestones exist', `got: ${allMs.length}`);
    const allPassed = allMs.every(m => m.status === 'PASSED');
    check(allPassed, 'DB.3: all milestones PASSED',
      `statuses: ${allMs.map(m => m.status).join(', ')}`);

    // DB: roadmap version
    const rv = roadmapVersions.getLatestVersion(lifecycleId);
    check(rv === 1, 'DB.4: roadmap version is 1', `got: ${rv}`);

    // DB: drift checks recorded
    const dc = driftChecks.getChecks(lifecycleId);
    check(dc.length > 0, 'DB.5: drift checks recorded', `count: ${dc.length}`);

    // DB: commit hashes on milestones
    for (const ms of allMs) {
      check(ms.commit_hash != null || ms.health_score != null,
        `DB.6: ${ms.id} has commit_hash or health_score`);
    }

    // Files on disk
    const expectedFiles = ['config.js', 'server.js', 'greetings.js'];
    for (const f of expectedFiles) {
      check(fs.existsSync(path.join(projectPath, f)), `File: ${f} exists`);
    }

    // ROADMAP.md final state
    if (fs.existsSync(roadmapAfterPlan)) {
      const rmFinal = fs.readFileSync(roadmapAfterPlan, 'utf-8');
      console.log('\n  ─── ROADMAP.md content ───');
      console.log(rmFinal.split('\n').map(l => `    ${l}`).join('\n'));
    }

    // README.md exists
    check(fs.existsSync(readmePath), 'File: README.md exists');

    // Git: commits exist
    try {
      const gitLog = execSync('git log --oneline', { cwd: projectPath, encoding: 'utf8' });
      const commits = gitLog.trim().split('\n');
      check(commits.length >= 4, 'Git: at least 4 commits (init + 3 milestones)',
        `got: ${commits.length}`);
      console.log('\n  ─── Git log ───');
      commits.forEach(l => console.log(`    ${l}`));
    } catch (e) {
      check(false, 'Git: log available', e.message);
    }

    // Git: tags
    try {
      const tags = execSync('git tag', { cwd: projectPath, encoding: 'utf8' }).trim();
      if (tags) {
        console.log(`\n  ─── Git tags: ${tags.replace(/\n/g, ', ')} ───`);
      }
    } catch { /* tags optional */ }

    // Build progress
    const progress = getBuildProgress(lifecycleId);
    check(progress.percentage === 100, 'Progress: 100%', `got: ${progress.percentage}%`);

    // Cleanup
    if (process.env.KEEP_PROJECT || failed > 0) {
      console.log(`\n  Project preserved at: ${projectPath}`);
    } else {
      try {
        fs.rmSync(projectPath, { recursive: true, force: true });
        console.log(`\n  Project cleaned up. Set KEEP_PROJECT=1 to preserve.`);
      } catch { /* ignore */ }
    }

  } catch (err) {
    console.error(`\n\nFATAL ERROR: ${err.message}`);
    console.error(err.stack);
    failed++;
    failures.push({ name: 'FATAL', detail: err.message });
  }

  // ═══ Summary ════════════════════════════════════════════════════════════

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log(`  Test 1 Happy Path: ${passed} passed, ${failed} failed`);

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
