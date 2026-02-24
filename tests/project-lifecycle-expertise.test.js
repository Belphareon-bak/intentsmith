// Project Lifecycle E2E Test 5 — Expertise Meta Test
// ══════════════════════════════════════════════════════════════════════════════
// Two-phase meta test:
//
// PHASE 1: Use lifecycle engine to BUILD a mobile-dev specialist plugin
//   - MS-1: Manifest + Config (specialist.json, index.js)
//   - MS-2: Tool Adapters (adapters.js, tools/)
//   - MS-3: Routing Tests (test file)
//
// PHASE 2: Load the built specialist and verify:
//   - SpecialistLoader.boot() succeeds
//   - Specialist registered in runtime
//   - Routing accuracy >= 80%
//   - Tool patterns match expected inputs
//
// Run: node tests/project-lifecycle-expertise.test.js
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import Database from 'better-sqlite3';

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
  conversations,
  messages,
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

import { SpecialistLoader } from '../src/specialists/specialist-loader.js';

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

// ─── Sample Data: Mobile-Dev Specialist ─────────────────────────────────────

const SPEC = {
  title: 'Mobile-Dev Specialist Plugin',
  goals: [
    { id: 'G1', description: 'Detect mobile frameworks from user queries', priority: 'MUST' },
    { id: 'G2', description: 'Scaffold new mobile project structures', priority: 'MUST' },
    { id: 'G3', description: 'Recommend libraries for mobile development', priority: 'MUST' },
  ],
  requirements: [
    { id: 'R1', description: 'specialist.json manifest with valid schema', type: 'functional', goal_id: 'G1' },
    { id: 'R2', description: 'register/unregister exports in index.js', type: 'functional', goal_id: 'G1' },
    { id: 'R3', description: 'Pattern-based intent detection for 3 tools', type: 'functional', goal_id: 'G1' },
    { id: 'R4', description: 'Framework detection tool', type: 'functional', goal_id: 'G1' },
    { id: 'R5', description: 'Project scaffolding tool', type: 'functional', goal_id: 'G2' },
    { id: 'R6', description: 'Library recommendation tool', type: 'functional', goal_id: 'G3' },
    { id: 'R7', description: 'Routing accuracy >= 80%', type: 'non-functional', goal_id: 'G1' },
  ],
  tech_stack: {
    languages: ['JavaScript'],
    frameworks: ['Node.js'],
    tools: [],
    rationale: 'C3 specialist plugin system',
  },
  architecture: {
    pattern: 'Specialist plugin',
    components: ['specialist.json', 'index.js', 'tools/'],
  },
  risks: [
    { id: 'RISK1', description: 'Pattern false positives', severity: 'MEDIUM', mitigation: 'Precision testing' },
  ],
  constraints: ['Must be self-contained', 'No external dependencies'],
  out_of_scope: ['Actual mobile project generation'],
};

const ROADMAP = {
  milestones: [
    {
      id: 'ms-1',
      title: 'Manifest + Config',
      description: 'specialist.json manifest and index.js entry point',
      dependencies: [],
      estimated_loc: 80,
      estimated_files: 2,
      estimated_complexity: 'LOW',
      goals_addressed: ['G1'],
      requirements_addressed: ['R1', 'R2'],
      deliverables: ['mobile-dev/specialist.json', 'mobile-dev/index.js'],
    },
    {
      id: 'ms-2',
      title: 'Tool Implementations',
      description: 'Three tool modules: detect-frameworks, scaffold-project, recommend-libs',
      dependencies: ['ms-1'],
      estimated_loc: 150,
      estimated_files: 3,
      estimated_complexity: 'MEDIUM',
      goals_addressed: ['G1', 'G2', 'G3'],
      requirements_addressed: ['R3', 'R4', 'R5', 'R6'],
      deliverables: ['mobile-dev/tools/detect-frameworks.js', 'mobile-dev/tools/scaffold-project.js', 'mobile-dev/tools/recommend-libs.js'],
    },
    {
      id: 'ms-3',
      title: 'Routing Tests',
      description: 'Routing accuracy test file verifying >= 80% match rate',
      dependencies: ['ms-2'],
      estimated_loc: 60,
      estimated_files: 1,
      estimated_complexity: 'LOW',
      goals_addressed: ['G1'],
      requirements_addressed: ['R7'],
      deliverables: ['mobile-dev/tests/routing.test.js'],
    },
  ],
  total_estimated_loc: 290,
  total_milestones: 3,
  critical_path: ['ms-1', 'ms-2', 'ms-3'],
};

const MS_PLANS = {
  'ms-1': {
    milestone_id: 'ms-1',
    files: [
      { path: 'mobile-dev/specialist.json', action: 'create', purpose: 'Manifest' },
      { path: 'mobile-dev/index.js', action: 'create', purpose: 'Entry point' },
    ],
    implementation_steps: [
      { step: 1, action: 'Create specialist.json manifest', file: 'mobile-dev/specialist.json' },
      { step: 2, action: 'Create index.js with register/unregister', file: 'mobile-dev/index.js' },
    ],
    scope_files: ['mobile-dev/specialist.json', 'mobile-dev/index.js'],
  },
  'ms-2': {
    milestone_id: 'ms-2',
    files: [
      { path: 'mobile-dev/tools/detect-frameworks.js', action: 'create', purpose: 'Framework detection' },
      { path: 'mobile-dev/tools/scaffold-project.js', action: 'create', purpose: 'Project scaffolding' },
      { path: 'mobile-dev/tools/recommend-libs.js', action: 'create', purpose: 'Library recommendation' },
    ],
    implementation_steps: [
      { step: 1, action: 'Create detect-frameworks tool', file: 'mobile-dev/tools/detect-frameworks.js' },
      { step: 2, action: 'Create scaffold-project tool', file: 'mobile-dev/tools/scaffold-project.js' },
      { step: 3, action: 'Create recommend-libs tool', file: 'mobile-dev/tools/recommend-libs.js' },
    ],
    scope_files: ['mobile-dev/tools/detect-frameworks.js', 'mobile-dev/tools/scaffold-project.js', 'mobile-dev/tools/recommend-libs.js'],
  },
  'ms-3': {
    milestone_id: 'ms-3',
    files: [
      { path: 'mobile-dev/tests/routing.test.js', action: 'create', purpose: 'Routing accuracy test' },
    ],
    implementation_steps: [
      { step: 1, action: 'Create routing accuracy test', file: 'mobile-dev/tests/routing.test.js' },
    ],
    scope_files: ['mobile-dev/tests/routing.test.js'],
  },
};

// Self-contained specialist files (no imports from C3 project)
const FILES = {
  'ms-1': {
    'mobile-dev/specialist.json': JSON.stringify({
      id: 'mobile-dev',
      version: '1.0.0',
      name: 'Mobile Development Specialist',
      description: 'Framework detection, project scaffolding, library recommendations',
      author: 'c3-lifecycle-test',
      domain: 'mobile',
      type: 'domain',
      engine: '>=65.0.0',
      entry: './index.js',
      tools: [
        { id: 'mobile-dev.detect_frameworks', name: 'Detect Frameworks', module: './tools/detect-frameworks.js', function: 'detectFrameworks' },
        { id: 'mobile-dev.scaffold_project', name: 'Scaffold Project', module: './tools/scaffold-project.js', function: 'scaffoldProject' },
        { id: 'mobile-dev.recommend_libs', name: 'Recommend Libraries', module: './tools/recommend-libs.js', function: 'recommendLibraries' },
      ],
      expertises: ['mobile-dev'],
      knowledge_packs: [],
      migrations: [],
      settings: { default_platform: 'react-native' },
      enabledByDefault: true,
    }, null, 2) + '\n',

    'mobile-dev/index.js': `// Mobile-Dev Specialist — Entry Point (self-contained)

import { detectFrameworks } from './tools/detect-frameworks.js';
import { scaffoldProject } from './tools/scaffold-project.js';
import { recommendLibraries } from './tools/recommend-libs.js';

export function register(ctx) {
  const { runtime } = ctx;

  runtime.registerSpecialist({
    id: 'mobile-dev',
    domain: 'mobile',
    tools: [
      {
        id: 'mobile-dev.detect_frameworks',
        name: 'Detect Frameworks',
        description: 'Detect mobile frameworks from user query',
        patterns: [{
          priority: 5,
          patterns: [
            /(?:react\\s*native|flutter|ionic|kotlin\\s*multiplatform|swiftui|expo)/i,
            /(?:mobiln[ií]|mobile)\\s*.{0,20}(?:framework|technolog)/i,
            /jak[ýy]\\s+(?:framework|technologi)/i,
          ],
        }],
        extractParams: (input) => ({ query: input }),
        toolAdapter: {
          run: (params) => {
            const result = detectFrameworks(params);
            return { status: 'ok', data: result };
          },
        },
      },
      {
        id: 'mobile-dev.scaffold_project',
        name: 'Scaffold Project',
        description: 'Scaffold a new mobile project',
        patterns: [{
          priority: 4,
          patterns: [
            /(?:scaffold|vytvo[rř]|založ|init|create)\\s*.{0,20}(?:projekt|project|app|aplikac)/i,
            /nov[ýy]\\s+(?:mobiln[ií]\\s+)?(?:projekt|app)/i,
          ],
        }],
        extractParams: (input) => {
          const platform = input.match(/react\\s*native/i) ? 'react-native'
            : input.match(/flutter/i) ? 'flutter'
            : input.match(/ionic/i) ? 'ionic'
            : 'react-native';
          return { platform, query: input };
        },
        toolAdapter: {
          run: (params) => {
            const result = scaffoldProject(params);
            return { status: 'ok', data: result };
          },
        },
      },
      {
        id: 'mobile-dev.recommend_libs',
        name: 'Recommend Libraries',
        description: 'Recommend libraries for mobile development',
        patterns: [{
          priority: 3,
          patterns: [
            /(?:doporu[cč]|recommend|suggest)\\s*.{0,20}(?:knihovn|librar|bal[ií][cč]k|package)/i,
            /(?:jak[áa]|kter[áa])\\s+(?:knihovn|librar)\\s*.{0,20}(?:navigac|nav|stav|state|form)/i,
          ],
        }],
        extractParams: (input) => {
          const category = input.match(/navigac|nav/i) ? 'navigation'
            : input.match(/stav|state/i) ? 'state-management'
            : input.match(/form/i) ? 'forms'
            : 'general';
          return { category, query: input };
        },
        toolAdapter: {
          run: (params) => {
            const result = recommendLibraries(params);
            return { status: 'ok', data: result };
          },
        },
      },
    ],
  });
}

export function unregister(ctx) {
  const { runtime } = ctx;
  if (typeof runtime.unregisterSpecialist === 'function') {
    runtime.unregisterSpecialist('mobile-dev');
  }
}
`,
  },
  'ms-2': {
    'mobile-dev/tools/detect-frameworks.js': `// Mobile framework detection tool

const FRAMEWORKS = {
  'react-native': { name: 'React Native', language: 'JavaScript/TypeScript', platform: 'cross-platform', popularity: 'high' },
  'flutter': { name: 'Flutter', language: 'Dart', platform: 'cross-platform', popularity: 'high' },
  'ionic': { name: 'Ionic', language: 'TypeScript', platform: 'cross-platform (hybrid)', popularity: 'medium' },
  'kotlin-multiplatform': { name: 'Kotlin Multiplatform', language: 'Kotlin', platform: 'cross-platform (native)', popularity: 'growing' },
  'swiftui': { name: 'SwiftUI', language: 'Swift', platform: 'iOS only', popularity: 'high (Apple ecosystem)' },
  'expo': { name: 'Expo', language: 'JavaScript/TypeScript', platform: 'cross-platform (React Native)', popularity: 'high' },
};

export function detectFrameworks(params) {
  const query = (params.query || '').toLowerCase();
  const detected = [];

  for (const [key, info] of Object.entries(FRAMEWORKS)) {
    if (query.includes(key.replace('-', ' ')) || query.includes(key)) {
      detected.push({ id: key, ...info });
    }
  }

  // If no specific framework detected, return all as options
  if (detected.length === 0) {
    return {
      detected: false,
      suggestion: 'No specific framework mentioned. Here are the top options:',
      frameworks: Object.entries(FRAMEWORKS).map(([id, info]) => ({ id, ...info })),
    };
  }

  return { detected: true, frameworks: detected };
}
`,
    'mobile-dev/tools/scaffold-project.js': `// Mobile project scaffolding tool

const SCAFFOLDS = {
  'react-native': {
    command: 'npx react-native init MyApp',
    structure: ['src/', 'src/components/', 'src/screens/', 'src/navigation/', 'src/utils/', 'App.tsx'],
    dependencies: ['react-native', 'react', '@react-navigation/native'],
  },
  'flutter': {
    command: 'flutter create my_app',
    structure: ['lib/', 'lib/screens/', 'lib/widgets/', 'lib/models/', 'lib/main.dart'],
    dependencies: ['flutter', 'dart'],
  },
  'ionic': {
    command: 'ionic start myApp blank --type=angular',
    structure: ['src/', 'src/app/', 'src/pages/', 'src/services/', 'src/theme/'],
    dependencies: ['@ionic/angular', '@angular/core'],
  },
};

export function scaffoldProject(params) {
  const platform = params.platform || 'react-native';
  const scaffold = SCAFFOLDS[platform] || SCAFFOLDS['react-native'];

  return {
    platform,
    ...scaffold,
    note: 'This is a recommended project structure. Adjust based on your needs.',
  };
}
`,
    'mobile-dev/tools/recommend-libs.js': `// Library recommendation tool for mobile development

const RECOMMENDATIONS = {
  'navigation': {
    'react-native': ['@react-navigation/native', '@react-navigation/stack', 'react-native-screens'],
    'flutter': ['go_router', 'auto_route', 'fluro'],
  },
  'state-management': {
    'react-native': ['zustand', 'redux-toolkit', 'mobx', 'jotai'],
    'flutter': ['riverpod', 'bloc', 'provider', 'getx'],
  },
  'forms': {
    'react-native': ['react-hook-form', 'formik', 'yup'],
    'flutter': ['flutter_form_builder', 'reactive_forms'],
  },
  'general': {
    'react-native': ['axios', 'react-query', 'async-storage', 'react-native-reanimated'],
    'flutter': ['dio', 'hive', 'get_it', 'freezed'],
  },
};

export function recommendLibraries(params) {
  const category = params.category || 'general';
  const platform = params.platform || 'react-native';
  const libs = RECOMMENDATIONS[category] || RECOMMENDATIONS['general'];

  return {
    category,
    platform,
    libraries: libs[platform] || libs['react-native'] || [],
    note: 'Recommendations based on community popularity and maintenance status.',
  };
}
`,
  },
  'ms-3': {
    'mobile-dev/tests/routing.test.js': `// Routing accuracy test for mobile-dev specialist
// Tests pattern matching recall and precision

const TESTS = [
  // Should match detect_frameworks
  { input: 'Which React Native version should I use?', expected: 'mobile-dev.detect_frameworks' },
  { input: 'Is Flutter better than React Native?', expected: 'mobile-dev.detect_frameworks' },
  { input: 'Jaký mobilní framework je nejlepší?', expected: 'mobile-dev.detect_frameworks' },

  // Should match scaffold_project
  { input: 'Scaffold a new React Native project', expected: 'mobile-dev.scaffold_project' },
  { input: 'Vytvoř nový mobilní projekt', expected: 'mobile-dev.scaffold_project' },

  // Should match recommend_libs
  { input: 'Doporuč knihovnu pro navigaci', expected: 'mobile-dev.recommend_libs' },
  { input: 'Recommend a state management library', expected: 'mobile-dev.recommend_libs' },

  // Should NOT match (null)
  { input: 'Kolik je hodin?', expected: null },
  { input: 'What is the weather?', expected: null },
];

console.log('Routing accuracy test:', TESTS.length, 'cases');
`,
  },
};

// ─── Fake LLM ───────────────────────────────────────────────────────────────

function createFakeLLM() {
  return async function fakeLLM(role, prompt) {
    const p = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);

    if (p.includes('## User Request') && p.includes('## Task')) {
      return {
        content: JSON.stringify({
          core_goal: 'Build a mobile-dev specialist plugin for C3',
          implicit_assumptions: ['C3 specialist plugin architecture', 'Node.js runtime'],
          technical_decisions: [
            {
              decision: 'Framework detection approach',
              alternatives: [
                { option: 'AST parsing', pros: ['Accurate'], cons: ['Slow, complex'] },
                { option: 'File pattern matching', pros: ['Fast, simple'], cons: ['False positives'] },
              ],
              recommendation: 'File pattern matching — sufficient for framework detection',
            },
          ],
          clarifying_questions: ['Jaké nástroje chceš?', 'Kolik toolů?', 'Jaký domain?'],
          initial_assessment: {
            estimated_complexity: 'MEDIUM',
            key_risks: [
              { risk: 'Pattern false positives', severity: 'MEDIUM', likelihood: 'MEDIUM', mitigation: 'Confidence scoring' },
            ],
            suggested_tech_stack: ['Node.js 22'],
            tech_stack_rationale: 'C3 plugin system requires Node.js',
          },
        }),
      };
    }

    if (p.includes('thorough project specification') || p.includes('creating a project specification') || p.includes('structured project specification')) {
      return { content: JSON.stringify(SPEC) };
    }

    if (p.includes('creating a project roadmap') || p.includes('Break the project into milestones')) {
      return { content: JSON.stringify(ROADMAP) };
    }

    if (p.includes('implementing a specific milestone') || p.includes('implementation plan for THIS milestone')) {
      const msMatch = p.match(/"id"\s*:\s*"(ms-\d+)"/);
      const msId = msMatch ? msMatch[1] : 'ms-1';
      return { content: JSON.stringify(MS_PLANS[msId] || MS_PLANS['ms-1']) };
    }

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

    if (p.includes('computing health metrics') || p.includes('health metrics for a completed milestone')) {
      return {
        content: JSON.stringify({
          scope_adherence: 0.95, test_coverage: 0.80, complexity_delta: 0.10, tech_debt_delta: 0.05,
        }),
      };
    }

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
  // Clean only this test's previous conversations (idempotent re-run)
  try {
    const oldConvs = db.prepare(`SELECT id FROM conversations WHERE title LIKE '%Mobile-Dev%'`).all();
    for (const c of oldConvs) {
      db.prepare(`DELETE FROM messages WHERE conversation_id = ?`).run(c.id);
      db.prepare(`DELETE FROM conversations WHERE id = ?`).run(c.id);
    }
  } catch { /* ignore */ }
  // Only remove temp test projects
  try { db.prepare(`DELETE FROM projects WHERE path LIKE '/tmp/%'`).run(); } catch { /* ignore */ }
  initLifecycleStateDb(lifecycleHandoffState, lifecycleRepo);
}

// ─── Mock Runtime for Phase 2 ───────────────────────────────────────────────

function createMockRuntime() {
  const registered = new Map();
  return {
    registerSpecialist(config) { registered.set(config.id, config); },
    unregisterSpecialist(id) { registered.delete(id); },
    isSpecialist(id) { return registered.has(id); },
    getSpecialistIds() { return [...registered.keys()]; },
    _registered: registered,
  };
}

function createSpecialistDb() {
  const sDb = new Database(':memory:');
  sDb.pragma('journal_mode = WAL');
  sDb.pragma('foreign_keys = ON');
  sDb.exec(`
    CREATE TABLE specialists (
      id TEXT PRIMARY KEY, version TEXT NOT NULL, name TEXT NOT NULL,
      domain TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'domain',
      status TEXT NOT NULL DEFAULT 'installed'
        CHECK (status IN ('installed', 'enabled', 'disabled')),
      manifest_json TEXT NOT NULL,
      installed_at TEXT DEFAULT (datetime('now')),
      enabled_at TEXT, disabled_at TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  sDb.exec(`
    CREATE TABLE specialist_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      specialist_id TEXT NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
      migration_name TEXT NOT NULL, applied_at TEXT DEFAULT (datetime('now')),
      UNIQUE(specialist_id, migration_name)
    )
  `);
  return sDb;
}

// ─── Routing Accuracy Tester ────────────────────────────────────────────────

function testRouting(runtime) {
  const specialist = runtime._registered.get('mobile-dev');
  if (!specialist) return { recall: 0, precision: 0, total: 0, passed: 0 };

  const tools = specialist.tools || [];

  function matchInput(input) {
    // Sort by priority (higher first)
    const sorted = [...tools].sort((a, b) => {
      const pA = a.patterns?.[0]?.priority ?? 0;
      const pB = b.patterns?.[0]?.priority ?? 0;
      return pB - pA;
    });

    for (const tool of sorted) {
      for (const pg of tool.patterns || []) {
        for (const pat of pg.patterns) {
          if (pat.test(input)) return tool.id;
        }
      }
    }
    return null;
  }

  // Group A: Should match specific tool (recall)
  const groupA = [
    { input: 'Which React Native version should I use?', expected: 'mobile-dev.detect_frameworks' },
    { input: 'Is Flutter good for my app?', expected: 'mobile-dev.detect_frameworks' },
    { input: 'Jaký mobilní framework je nejlepší?', expected: 'mobile-dev.detect_frameworks' },
    { input: 'Tell me about Ionic framework', expected: 'mobile-dev.detect_frameworks' },
    { input: 'Scaffold a new React Native project', expected: 'mobile-dev.scaffold_project' },
    { input: 'Vytvoř nový mobilní projekt', expected: 'mobile-dev.scaffold_project' },
    { input: 'Create a new Flutter app', expected: 'mobile-dev.scaffold_project' },
    { input: 'Doporuč knihovnu pro navigaci', expected: 'mobile-dev.recommend_libs' },
    { input: 'Recommend a state management library', expected: 'mobile-dev.recommend_libs' },
    { input: 'Jaká knihovna je nejlepší pro formuláře?', expected: 'mobile-dev.recommend_libs' },
  ];

  // Group C: Should NOT match (precision)
  const groupC = [
    { input: 'Kolik je hodin?' },
    { input: 'What is the weather?' },
    { input: 'Kolik zaplatím daní?' },
    { input: 'Hello, how are you?' },
    { input: 'What is 2 + 2?' },
  ];

  let recallHits = 0;
  let recallTotal = groupA.length;
  let toolAccuracyHits = 0;

  for (const test of groupA) {
    const result = matchInput(test.input);
    if (result) {
      recallHits++;
      if (result === test.expected) toolAccuracyHits++;
    }
  }

  let precisionHits = 0;
  let precisionTotal = groupC.length;

  for (const test of groupC) {
    const result = matchInput(test.input);
    if (result === null) precisionHits++;
  }

  return {
    recall: recallHits / recallTotal,
    precision: precisionHits / precisionTotal,
    toolAccuracy: toolAccuracyHits / recallTotal,
    recallDetail: `${recallHits}/${recallTotal}`,
    precisionDetail: `${precisionHits}/${precisionTotal}`,
    toolAccuracyDetail: `${toolAccuracyHits}/${recallTotal}`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── MAIN TEST ──────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function run() {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('  Test 5: Expertise Meta Test — Build + Load Mobile-Dev Specialist');
  console.log('══════════════════════════════════════════════════════════════════════');

  cleanDB();

  const SESSION_ID = 'expertise-meta-test';

  // ─── Persistent project path (under projects/, not /tmp/) ─────────────────
  const projectsRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../projects');
  const projectPath = path.join(projectsRoot, 'mobile-dev-specialist');

  // Clean previous run if exists (idempotent re-run)
  if (fs.existsSync(projectPath)) {
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
  fs.mkdirSync(projectPath, { recursive: true });

  // Git init
  execSync('git init', { cwd: projectPath, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: projectPath, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: projectPath, stdio: 'pipe' });
  execSync('git commit --allow-empty -m "init"', { cwd: projectPath, stdio: 'pipe' });

  // ─── Register project in DB ───────────────────────────────────────────────
  const project = projects.getOrCreate('mobile-dev-specialist', projectPath,
    'Mobile-Dev Specialist Plugin — framework detection, scaffolding, library recommendations');
  const projectId = Number(project.id);

  // ─── Create conversation linked to project ────────────────────────────────
  const CONV_ID = `conv-expertise-${Date.now()}`;
  const conv = conversations.getOrCreate(CONV_ID, projectId,
    'Mobile-Dev Specialist — Lifecycle Build + Routing Test');

  /** Helper: log user input + agent response as messages in conversation */
  function logTurn(userInput, response) {
    messages.addMessage(CONV_ID, 'user', userInput, null, { source: 'lifecycle-test' });
    const content = typeof response?.content === 'string' ? response.content : JSON.stringify(response || {});
    messages.addMessage(CONV_ID, 'assistant', content, null, { source: 'lifecycle-test' });
  }

  const fakeLLM = createFakeLLM();
  const fakeExecutor = createFakeExecutor(projectPath);
  const context = { sessionId: SESSION_ID, callLLM: fakeLLM, executor: fakeExecutor, projectPath, projectId };

  try {
    // ════════════════════════════════════════════════════════════════════════
    // PHASE 1: Build specialist using lifecycle engine
    // ════════════════════════════════════════════════════════════════════════

    console.log('\n═══ PHASE 1: LIFECYCLE BUILD ════════════════════════════════════════');

    // PROPOSED
    const userRequest = 'Chci vytvořit mobile-dev specialist plugin s detekcí frameworků, scaffoldingem a doporučením knihoven';
    const r1 = handleLifecycleBuildDetected(userRequest, { intent: 'BUILD' }, context);
    logTurn(userRequest, r1);
    check(r1?.content?.includes('lifecycle'), 'Build.1: lifecycle proposed');

    // SPEC
    const r2 = await handleLifecycleInput('ano', context);
    logTurn('ano', r2);
    const s2 = getLcState(SESSION_ID);
    check(s2?.phase === 'SPEC', 'Build.2: SPEC phase started');

    // Answer questions → SPEC_REVIEW
    const specAnswer = '3 tools, domain mobile, self-contained';
    const r3 = await handleLifecycleInput(specAnswer, context);
    logTurn(specAnswer, r3);
    const s3 = getLcState(SESSION_ID);
    check(s3?.phase === 'SPEC_REVIEW', 'Build.3: SPEC_REVIEW');

    // Approve spec → PLANNING → PLAN_REVIEW
    const r4 = await handleLifecycleInput('schvaluji', context);
    logTurn('schvaluji', r4);
    const s4 = getLcState(SESSION_ID);
    check(s4?.phase === 'PLAN_REVIEW', 'Build.4: PLAN_REVIEW');

    // Check ROADMAP.md
    const roadmapPath = path.join(projectPath, 'ROADMAP.md');
    check(fs.existsSync(roadmapPath), 'Build.5: ROADMAP.md exists');

    // Approve roadmap → BUILD ms-1
    const r5 = await handleLifecycleInput('schvaluji', context);
    logTurn('schvaluji', r5);
    const s5 = getLcState(SESSION_ID);
    check(s5?.currentMilestoneId === 'ms-1', 'Build.6: ms-1 plan shown');

    // Execute ms-1
    const r6 = await handleLifecycleInput('ano', context);
    logTurn('ano', r6);
    const ms1 = msRepo.getMilestone('ms-1');
    check(ms1?.status === 'PASSED', 'Build.7: ms-1 PASSED');
    check(fs.existsSync(path.join(projectPath, 'mobile-dev/specialist.json')), 'Build.8: specialist.json on disk');
    check(fs.existsSync(path.join(projectPath, 'mobile-dev/index.js')), 'Build.9: index.js on disk');

    // Execute ms-2
    const s6 = getLcState(SESSION_ID);
    check(s6?.currentMilestoneId === 'ms-2', 'Build.10: auto-advanced to ms-2');
    const r7 = await handleLifecycleInput('ano', context);
    logTurn('ano', r7);
    const ms2 = msRepo.getMilestone('ms-2');
    check(ms2?.status === 'PASSED', 'Build.11: ms-2 PASSED');
    check(fs.existsSync(path.join(projectPath, 'mobile-dev/tools/detect-frameworks.js')), 'Build.12: detect-frameworks.js on disk');
    check(fs.existsSync(path.join(projectPath, 'mobile-dev/tools/scaffold-project.js')), 'Build.13: scaffold-project.js on disk');
    check(fs.existsSync(path.join(projectPath, 'mobile-dev/tools/recommend-libs.js')), 'Build.14: recommend-libs.js on disk');

    // Execute ms-3
    const s7 = getLcState(SESSION_ID);
    check(s7?.currentMilestoneId === 'ms-3', 'Build.15: auto-advanced to ms-3');
    const r8 = await handleLifecycleInput('ano', context);
    logTurn('ano', r8);
    const ms3 = msRepo.getMilestone('ms-3');
    check(ms3?.status === 'PASSED', 'Build.16: ms-3 PASSED');
    check(fs.existsSync(path.join(projectPath, 'mobile-dev/tests/routing.test.js')), 'Build.17: routing test on disk');

    // Handle REVIEW if triggered
    const sAfterMs3 = getLcState(SESSION_ID);
    if (sAfterMs3?.phase === 'REVIEW') {
      const rReview = await handleLifecycleInput('pokračovat', context);
      logTurn('pokračovat', rReview);
    }

    // COMPLETED
    const lifecycleId = s4.lifecycleId;
    const lcDb = lifecycleRepo.findById.get(lifecycleId);
    check(lcDb?.phase === 'COMPLETED', 'Build.18: lifecycle COMPLETED');

    const allMs = msRepo.listByLifecycle(lifecycleId);
    check(allMs.length === 3, 'Build.19: 3 milestones exist');
    check(allMs.every(m => m.status === 'PASSED'), 'Build.20: all milestones PASSED');

    const progress = getBuildProgress(lifecycleId);
    check(progress.percentage === 100, 'Build.21: progress 100%');

    // Git verification
    try {
      const gitLog = execSync('git log --oneline', { cwd: projectPath, encoding: 'utf8' });
      const commits = gitLog.trim().split('\n');
      check(commits.length >= 4, 'Build.22: 4+ git commits', `got: ${commits.length}`);
    } catch (e) {
      check(false, 'Build.22: git log', e.message);
    }

    console.log('\n  Phase 1 complete: specialist built via lifecycle engine');

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 2: Load and test the built specialist
    // ════════════════════════════════════════════════════════════════════════

    console.log('\n═══ PHASE 2: SPECIALIST BOOT + ROUTING ══════════════════════════════');

    // Create isolated DB + runtime for specialist loading
    const sDb = createSpecialistDb();
    const mockRuntime = createMockRuntime();

    const loader = new SpecialistLoader(sDb, mockRuntime, {
      baseDir: projectPath,  // scan projectPath for specialist dirs
      engineVersion: '65.5.0',
    });

    // Phase 2.1: Discovery
    const manifests = loader.discoverAll();
    check(manifests.length >= 1, 'Boot.1: discovered at least 1 specialist', `got: ${manifests.length}`);
    check(manifests.some(m => m.id === 'mobile-dev'), 'Boot.2: discovered mobile-dev');

    // Phase 2.2: Install
    loader.installPending();
    const installed = loader.getInstalled();
    check(installed.some(r => r.id === 'mobile-dev'), 'Boot.3: mobile-dev installed in DB');

    // Phase 2.3: Enable (loads index.js, calls register)
    await loader.enableAll();
    check(mockRuntime.isSpecialist('mobile-dev'), 'Boot.4: mobile-dev registered in runtime');

    // Verify registered tools
    const specialist = mockRuntime._registered.get('mobile-dev');
    check(specialist != null, 'Boot.5: specialist config captured');
    check(specialist?.tools?.length === 3, 'Boot.6: 3 tools registered',
      `got: ${specialist?.tools?.length}`);

    // Phase 2.4: Routing accuracy test
    console.log('\n═══ ROUTING ACCURACY ═══════════════════════════════════════════════');

    const accuracy = testRouting(mockRuntime);

    console.log(`  Recall:        ${accuracy.recallDetail} (${(accuracy.recall * 100).toFixed(0)}%)`);
    console.log(`  Precision:     ${accuracy.precisionDetail} (${(accuracy.precision * 100).toFixed(0)}%)`);
    console.log(`  Tool accuracy: ${accuracy.toolAccuracyDetail} (${(accuracy.toolAccuracy * 100).toFixed(0)}%)`);

    check(accuracy.recall >= 0.80, 'Routing.1: recall >= 80%',
      `got: ${(accuracy.recall * 100).toFixed(0)}%`);
    check(accuracy.precision >= 0.80, 'Routing.2: precision >= 80%',
      `got: ${(accuracy.precision * 100).toFixed(0)}%`);
    check(accuracy.toolAccuracy >= 0.70, 'Routing.3: tool accuracy >= 70%',
      `got: ${(accuracy.toolAccuracy * 100).toFixed(0)}%`);

    // Phase 2.5: Tool execution test
    console.log('\n═══ TOOL EXECUTION ═════════════════════════════════════════════════');

    if (specialist?.tools) {
      // Test detect_frameworks
      const detectTool = specialist.tools.find(t => t.id === 'mobile-dev.detect_frameworks');
      if (detectTool?.toolAdapter) {
        const detectResult = detectTool.toolAdapter.run({ query: 'React Native' });
        check(detectResult?.status === 'ok', 'Exec.1: detect_frameworks returns ok');
        check(detectResult?.data?.detected === true, 'Exec.2: detected React Native');
      }

      // Test scaffold_project
      const scaffoldTool = specialist.tools.find(t => t.id === 'mobile-dev.scaffold_project');
      if (scaffoldTool?.toolAdapter) {
        const scaffoldResult = scaffoldTool.toolAdapter.run({ platform: 'flutter', query: 'new Flutter app' });
        check(scaffoldResult?.status === 'ok', 'Exec.3: scaffold_project returns ok');
        check(scaffoldResult?.data?.platform === 'flutter', 'Exec.4: scaffold for Flutter');
      }

      // Test recommend_libs
      const recTool = specialist.tools.find(t => t.id === 'mobile-dev.recommend_libs');
      if (recTool?.toolAdapter) {
        const recResult = recTool.toolAdapter.run({ category: 'navigation', platform: 'react-native' });
        check(recResult?.status === 'ok', 'Exec.5: recommend_libs returns ok');
        check(Array.isArray(recResult?.data?.libraries) && recResult.data.libraries.length > 0,
          'Exec.6: libraries returned');
      }
    }

    // Phase 2.6: Disable and verify cleanup
    loader.disable('mobile-dev');
    check(!mockRuntime.isSpecialist('mobile-dev'), 'Boot.7: mobile-dev unregistered after disable');

    // Phase 2.7: Re-enable
    await loader.enable('mobile-dev');
    check(mockRuntime.isSpecialist('mobile-dev'), 'Boot.8: mobile-dev re-enabled');

    // Cleanup specialist DB (in-memory only, not the project DB)
    sDb.close();

    // ═══ DB VERIFICATION (projekt + konverzace) ═════════════════════════════

    console.log('\n═══ DB VERIFICATION (projekt + konverzace) ═════════════════════════');

    // Project registered in DB
    const dbProject = projects.findByPath.get(projectPath);
    check(dbProject != null, 'DB.1: project registered in DB');
    check(dbProject?.name === 'mobile-dev-specialist', 'DB.2: project name is mobile-dev-specialist');

    // Conversation linked to project
    const dbConv = conversations.findById.get(CONV_ID);
    check(dbConv != null, 'DB.3: conversation exists in DB');
    check(Number(dbConv?.project_id) === projectId, 'DB.4: conversation linked to project',
      `got project_id: ${dbConv?.project_id}, expected: ${projectId}`);

    // Messages in conversation
    const dbMessages = messages.listByConversation.all(CONV_ID);
    check(dbMessages.length >= 14, 'DB.5: conversation has 14+ messages (7+ turns)',
      `got: ${dbMessages.length}`);

    const userMsgs = dbMessages.filter(m => m.role === 'user');
    const assistantMsgs = dbMessages.filter(m => m.role === 'assistant');
    check(userMsgs.length >= 7, 'DB.6: 7+ user messages', `got: ${userMsgs.length}`);
    check(assistantMsgs.length >= 7, 'DB.7: 7+ assistant messages', `got: ${assistantMsgs.length}`);

    // Conversation summary
    console.log(`\n  ─── Conversation: ${CONV_ID} ───`);
    console.log(`    Project: ${dbProject?.name} (id: ${projectId})`);
    console.log(`    Messages: ${dbMessages.length} (${userMsgs.length} user, ${assistantMsgs.length} assistant)`);
    console.log(`    Title: ${dbConv?.title}`);

    // Project and conversation persist (NO cleanup)
    console.log(`\n  ── Projekt persistuje v: ${projectPath}`);
    console.log(`  ── Konverzace v DB: ${CONV_ID}`);
    console.log(`  ── Projekt v DB: id=${projectId}, name=${dbProject?.name}`);

  } catch (err) {
    console.error(`\n\nFATAL ERROR: ${err.message}`);
    console.error(err.stack);
    failed++;
    failures.push({ name: 'FATAL', detail: err.message });
  }

  // ═══ Summary ════════════════════════════════════════════════════════════

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log(`  Test 5 Expertise: ${passed} passed, ${failed} failed`);

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
