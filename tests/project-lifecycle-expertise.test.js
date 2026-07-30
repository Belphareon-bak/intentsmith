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

import './helpers/isolated-test-db.js';
import fs from 'fs';
import os from 'os';
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
import { rawId, scopeId } from '../src/planner/lifecycle-planning.js';

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
    { id: 'G1', description: 'Detect mobile frameworks from user queries', priority: 'MUST', success_criteria: 'Framework detection identifies React Native, Flutter, and native iOS/Android' },
    { id: 'G2', description: 'Scaffold new mobile project structures', priority: 'MUST', success_criteria: 'Scaffolding generates valid project directory with required config files' },
    { id: 'G3', description: 'Recommend libraries for mobile development', priority: 'MUST', success_criteria: 'Recommendations include at least 3 libraries per category' },
  ],
  requirements: [
    { id: 'R1', description: 'specialist.json manifest with valid schema', type: 'functional', goal_id: 'G1', acceptance_test: 'Validate specialist.json against C3 specialist schema' },
    { id: 'R2', description: 'register/unregister exports in index.js', type: 'functional', goal_id: 'G1', acceptance_test: 'Call register() and verify tools are available, unregister() cleans up' },
    { id: 'R3', description: 'Pattern-based intent detection for 3 tools', type: 'functional', goal_id: 'G1', acceptance_test: 'Send 10 sample queries and verify correct tool is selected' },
    { id: 'R4', description: 'Framework detection tool', type: 'functional', goal_id: 'G1', acceptance_test: 'Input "build iOS app" and verify React Native/Swift detected' },
    { id: 'R5', description: 'Project scaffolding tool', type: 'functional', goal_id: 'G2', acceptance_test: 'Run scaffold for React Native and verify directory structure created' },
    { id: 'R6', description: 'Library recommendation tool', type: 'functional', goal_id: 'G3', acceptance_test: 'Query "navigation library" and verify ranked list returned' },
    { id: 'R7', description: 'Routing accuracy >= 80%', type: 'non-functional', goal_id: 'G1', metric: 'routing_accuracy_percent >= 80', acceptance_test: 'Run routing test suite of 20+ queries and verify >= 80% correct' },
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
  design_decisions: [
    {
      id: 'DD1',
      decision: 'Intent detection approach',
      chosen: 'Pattern-based regex matching',
      alternatives_considered: ['LLM-based classification', 'Keyword lookup table'],
      rationale: 'Deterministic pattern matching provides predictable routing without LLM latency',
    },
  ],
  acceptance_criteria: [
    'specialist.json validates against C3 specialist schema',
    'All 3 tools execute and return structured output',
    'Routing accuracy meets or exceeds 80% threshold',
  ],
};

const ROADMAP = {
  milestones: [
    {
      id: 'ms-1',
      title: 'Manifest + Config',
      description: 'specialist.json manifest and index.js entry point',
      dependencies: [],
      estimated_loc: 80,
      estimated_files: 6,
      estimated_complexity: 'LOW',
      goals_addressed: ['G1'],
      requirements_addressed: ['R1', 'R2'],
      test_strategy: {
        type: 'integration',
        description: 'Load the manifest entry point with all declared tool interfaces present',
        specific_tests: ['manifest parses', 'entry point imports resolve', 'register and unregister exports exist'],
        expected_test_count: 3,
        command: 'node mobile-dev/tests/manifest-smoke.test.js',
      },
      acceptance_criteria: ['Manifest parses', 'Entry point imports resolve', 'Tool interfaces export their declared functions'],
      deliverables: [
        'mobile-dev/specialist.json',
        'mobile-dev/index.js',
        'mobile-dev/tools/detect-frameworks.js',
        'mobile-dev/tools/scaffold-project.js',
        'mobile-dev/tools/recommend-libs.js',
        'mobile-dev/tests/manifest-smoke.test.js',
      ],
    },
    {
      id: 'ms-2',
      title: 'Tool Implementations',
      description: 'Three tool modules: detect-frameworks, scaffold-project, recommend-libs',
      dependencies: ['ms-1'],
      estimated_loc: 150,
      estimated_files: 4,
      estimated_complexity: 'MEDIUM',
      goals_addressed: ['G1', 'G2', 'G3'],
      requirements_addressed: ['R3', 'R4', 'R5', 'R6'],
      test_strategy: {
        type: 'integration',
        description: 'Execute all three specialist tools with representative inputs',
        specific_tests: [
          'framework detection returns matches',
          'scaffolder returns a project plan',
          'library recommender returns packages',
          'unknown inputs use deterministic fallbacks',
        ],
        expected_test_count: 6,
        command: 'node mobile-dev/tests/tools-smoke.test.js',
      },
      acceptance_criteria: ['All three tools return structured output', 'Unknown inputs have deterministic fallbacks'],
      deliverables: [
        'mobile-dev/tools/detect-frameworks.js',
        'mobile-dev/tools/scaffold-project.js',
        'mobile-dev/tools/recommend-libs.js',
        'mobile-dev/tests/tools-smoke.test.js',
      ],
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
      test_strategy: {
        type: 'e2e',
        description: 'Boot the specialist and measure routing recall, precision, and tool accuracy',
        specific_tests: ['recall is at least 80%', 'precision is at least 80%', 'tool accuracy is at least 70%'],
        expected_test_count: 25,
        command: 'node mobile-dev/tests/routing.test.js',
      },
      acceptance_criteria: ['Specialist boots successfully', 'Routing thresholds are met', 'Disable and re-enable are reversible'],
      deliverables: ['mobile-dev/tests/routing.test.js'],
    },
  ],
  total_estimated_loc: 290,
  total_milestones: 3,
  critical_path: ['ms-1', 'ms-2', 'ms-3'],
  requirements_coverage: {
    covered: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7'],
    uncovered: [],
    rationale_for_uncovered: '',
  },
};

const ARCHITECTURE = {
  layers: ['entrypoint', 'tools', 'tests'],
  rules: [
    {
      from: 'entrypoint',
      canImport: ['tools'],
      cannotImport: ['tests'],
    },
    {
      from: 'tools',
      canImport: [],
      cannotImport: ['entrypoint', 'tests'],
    },
    {
      from: 'tests',
      canImport: ['entrypoint', 'tools'],
      cannotImport: [],
    },
  ],
  fileStructure: {
    entrypoint: 'mobile-dev/index.js',
    tools: 'mobile-dev/tools',
    tests: 'mobile-dev/tests',
  },
};

const MS_PLANS = {
  'ms-1': {
    milestone_id: 'ms-1',
    files: [
      { path: 'mobile-dev/specialist.json', action: 'create', purpose: 'Manifest' },
      { path: 'mobile-dev/index.js', action: 'create', purpose: 'Entry point' },
      { path: 'mobile-dev/tools/detect-frameworks.js', action: 'create', purpose: 'Framework detection interface' },
      { path: 'mobile-dev/tools/scaffold-project.js', action: 'create', purpose: 'Project scaffolding interface' },
      { path: 'mobile-dev/tools/recommend-libs.js', action: 'create', purpose: 'Library recommendation interface' },
      { path: 'mobile-dev/tests/manifest-smoke.test.js', action: 'create', purpose: 'Manifest and entry-point smoke test' },
    ],
    implementation_steps: [
      { step: 1, action: 'Create specialist.json manifest', file: 'mobile-dev/specialist.json' },
      { step: 2, action: 'Create index.js with register/unregister', file: 'mobile-dev/index.js' },
      { step: 3, action: 'Create import-safe interfaces for all declared tools', file: 'mobile-dev/tools/', validation: 'Every index.js import resolves' },
      { step: 4, action: 'Add executable manifest and entry-point smoke checks', file: 'mobile-dev/tests/manifest-smoke.test.js', validation: 'Smoke test registers and unregisters all declared tools' },
    ],
    scope_files: [
      'mobile-dev/specialist.json',
      'mobile-dev/index.js',
      'mobile-dev/tools/detect-frameworks.js',
      'mobile-dev/tools/scaffold-project.js',
      'mobile-dev/tools/recommend-libs.js',
      'mobile-dev/tests/manifest-smoke.test.js',
    ],
  },
  'ms-2': {
    milestone_id: 'ms-2',
    files: [
      { path: 'mobile-dev/tools/detect-frameworks.js', action: 'create', purpose: 'Framework detection' },
      { path: 'mobile-dev/tools/scaffold-project.js', action: 'create', purpose: 'Project scaffolding' },
      { path: 'mobile-dev/tools/recommend-libs.js', action: 'create', purpose: 'Library recommendation' },
      { path: 'mobile-dev/tests/tools-smoke.test.js', action: 'create', purpose: 'Executable tool smoke test' },
    ],
    implementation_steps: [
      { step: 1, action: 'Create detect-frameworks tool', file: 'mobile-dev/tools/detect-frameworks.js' },
      { step: 2, action: 'Create scaffold-project tool', file: 'mobile-dev/tools/scaffold-project.js' },
      { step: 3, action: 'Create recommend-libs tool and executable smoke checks', file: 'mobile-dev/tools/recommend-libs.js', validation: 'mobile-dev/tests/tools-smoke.test.js passes' },
    ],
    scope_files: [
      'mobile-dev/tools/detect-frameworks.js',
      'mobile-dev/tools/scaffold-project.js',
      'mobile-dev/tools/recommend-libs.js',
      'mobile-dev/tests/tools-smoke.test.js',
    ],
  },
  'ms-3': {
    milestone_id: 'ms-3',
    files: [
      { path: 'mobile-dev/tests/routing.test.js', action: 'create', purpose: 'Routing accuracy test' },
    ],
    implementation_steps: [
      { step: 1, action: 'Create routing accuracy test', file: 'mobile-dev/tests/routing.test.js' },
      { step: 2, action: 'Add positive and negative routing cases', file: 'mobile-dev/tests/routing.test.js' },
      { step: 3, action: 'Validate recall, precision, and tool accuracy thresholds', file: 'mobile-dev/tests/routing.test.js' },
    ],
    scope_files: ['mobile-dev/tests/routing.test.js'],
  },
};

const TOOL_INTERFACE_STUBS = {
  'mobile-dev/tools/detect-frameworks.js': `export function detectFrameworks() {
  return { detected: false, frameworks: [] };
}
`,
  'mobile-dev/tools/scaffold-project.js': `export function scaffoldProject() {
  return { platform: 'react-native', structure: [], dependencies: [] };
}
`,
  'mobile-dev/tools/recommend-libs.js': `export function recommendLibraries() {
  return { category: 'general', platform: 'react-native', libraries: [] };
}
`,
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
    'mobile-dev/tests/manifest-smoke.test.js': `import fs from 'node:fs';
import * as entry from '../index.js';

const manifest = JSON.parse(
  fs.readFileSync(new URL('../specialist.json', import.meta.url), 'utf8')
);
if (manifest.id !== 'mobile-dev' || manifest.tools?.length !== 3) {
  throw new Error('Manifest identity or tool declarations are invalid');
}
if (typeof entry.register !== 'function' || typeof entry.unregister !== 'function') {
  throw new Error('Entry point must export register and unregister');
}
for (const tool of manifest.tools) {
  const moduleUrl = new URL(\`../\${tool.module.replace(/^\\.\\//, '')}\`, import.meta.url);
  const toolModule = await import(moduleUrl);
  if (typeof toolModule[tool.function] !== 'function') {
    throw new Error(\`Missing declared export \${tool.function} in \${tool.module}\`);
  }
}

let registered;
entry.register({
  runtime: {
    registerSpecialist(value) {
      registered = value;
    },
  },
});
if (registered?.id !== manifest.id || registered.tools?.length !== manifest.tools.length) {
  throw new Error('register() did not expose all manifest tools');
}

let unregistered;
entry.unregister({
  runtime: {
    unregisterSpecialist(id) {
      unregistered = id;
    },
  },
});
if (unregistered !== manifest.id) {
  throw new Error('unregister() did not remove the specialist');
}
console.log('Manifest smoke checks passed');
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
    'mobile-dev/tests/tools-smoke.test.js': `import { detectFrameworks } from '../tools/detect-frameworks.js';
import { scaffoldProject } from '../tools/scaffold-project.js';
import { recommendLibraries } from '../tools/recommend-libs.js';

if (!detectFrameworks({ query: 'React Native' }).detected) {
  throw new Error('React Native was not detected');
}
if (scaffoldProject({ platform: 'flutter' }).platform !== 'flutter') {
  throw new Error('Flutter scaffold was not selected');
}
if (recommendLibraries({ category: 'navigation', platform: 'react-native' }).libraries.length === 0) {
  throw new Error('Navigation recommendations are empty');
}
const unknownFramework = detectFrameworks({ query: 'unrelated input' });
if (unknownFramework.detected !== false || unknownFramework.frameworks.length === 0) {
  throw new Error('Unknown framework input did not use the deterministic catalog fallback');
}
if (scaffoldProject({ platform: 'unknown' }).command !== 'npx react-native init MyApp') {
  throw new Error('Unknown scaffold platform did not use the React Native fallback');
}
if (recommendLibraries({ category: 'unknown', platform: 'unknown' }).libraries.length === 0) {
  throw new Error('Unknown library input did not use the general React Native fallback');
}
console.log('Tool smoke checks passed');
`,
  },
  'ms-3': {
    'mobile-dev/tests/routing.test.js': `// Routing accuracy test for mobile-dev specialist
import { register } from '../index.js';

let specialist;
register({
  runtime: {
    registerSpecialist(value) {
      specialist = value;
    },
  },
});

if (!specialist?.tools?.length) {
  throw new Error('Specialist did not register any tools');
}

const TESTS = [
  // Positive routing cases
  { input: 'Which React Native version should I use?', expected: 'mobile-dev.detect_frameworks' },
  { input: 'Is Flutter better than React Native?', expected: 'mobile-dev.detect_frameworks' },
  { input: 'Jaký mobilní framework je nejlepší?', expected: 'mobile-dev.detect_frameworks' },
  { input: 'Tell me about Ionic framework', expected: 'mobile-dev.detect_frameworks' },
  { input: 'Compare SwiftUI and Flutter', expected: 'mobile-dev.detect_frameworks' },
  { input: 'Is Expo a mobile framework?', expected: 'mobile-dev.detect_frameworks' },
  { input: 'Scaffold a new React Native project', expected: 'mobile-dev.scaffold_project' },
  { input: 'Vytvoř nový mobilní projekt', expected: 'mobile-dev.scaffold_project' },
  { input: 'Create a new Flutter app', expected: 'mobile-dev.scaffold_project' },
  { input: 'Initialize an Ionic app', expected: 'mobile-dev.scaffold_project' },
  { input: 'Založ React Native aplikaci', expected: 'mobile-dev.scaffold_project' },
  { input: 'Doporuč knihovnu pro navigaci', expected: 'mobile-dev.recommend_libs' },
  { input: 'Recommend a state management library', expected: 'mobile-dev.recommend_libs' },
  { input: 'Jaká knihovna je nejlepší pro formuláře?', expected: 'mobile-dev.recommend_libs' },
  { input: 'Suggest a package for forms', expected: 'mobile-dev.recommend_libs' },

  // Negative routing cases
  { input: 'Kolik je hodin?', expected: null },
  { input: 'What is the weather?', expected: null },
  { input: 'Kolik zaplatím daní?', expected: null },
  { input: 'Hello, how are you?', expected: null },
  { input: 'What is 2 + 2?', expected: null },
  { input: 'Write a SQL query', expected: null },
  { input: 'Summarize the project status', expected: null },
  { input: 'Open the local config file', expected: null },
  { input: 'Translate this sentence to Czech', expected: null },
  { input: 'Explain recursion', expected: null },
];

function route(input) {
  const matches = [];
  for (const tool of specialist.tools) {
    const matched = tool.patterns?.some(group =>
      group.patterns?.some(pattern => {
        pattern.lastIndex = 0;
        return pattern.test(input);
      })
    );
    if (matched) matches.push(tool);
  }
  matches.sort((a, b) =>
    (b.patterns?.[0]?.priority || 0) - (a.patterns?.[0]?.priority || 0)
  );
  return matches[0]?.id || null;
}

const positives = TESTS.filter(test => test.expected !== null);
const negatives = TESTS.filter(test => test.expected === null);
const positiveResults = positives.map(test => ({ ...test, actual: route(test.input) }));
const negativeResults = negatives.map(test => ({ ...test, actual: route(test.input) }));
const routedPositives = positiveResults.filter(test => test.actual !== null).length;
const exactPositives = positiveResults.filter(test => test.actual === test.expected).length;
const falsePositives = negativeResults.filter(test => test.actual !== null).length;
const predictedPositives = routedPositives + falsePositives;
const recall = routedPositives / positives.length;
const precision = predictedPositives > 0 ? routedPositives / predictedPositives : 0;
const toolAccuracy = exactPositives / positives.length;

if (TESTS.length < 20 || recall < 0.8 || precision < 0.8 || toolAccuracy < 0.7) {
  throw new Error(
    \`Routing thresholds failed: cases=\${TESTS.length}, recall=\${recall}, precision=\${precision}, toolAccuracy=\${toolAccuracy}\`
  );
}
console.log(
  \`Routing metrics: cases=\${TESTS.length}, recall=\${recall}, precision=\${precision}, toolAccuracy=\${toolAccuracy}\`
);
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

    if (p.includes('generate an ARCHITECTURE.json file')) {
      return { content: JSON.stringify(ARCHITECTURE) };
    }

    if (p.includes('implementing a specific milestone') || p.includes('implementation plan for THIS milestone')) {
      const msMatch = p.match(/"id"\s*:\s*"(ms-\d+)"/);
      const msId = msMatch?.[1];
      if (!msId || !MS_PLANS[msId]) throw new Error(`Unknown milestone plan prompt: ${msId}`);
      return { content: JSON.stringify(MS_PLANS[msId]) };
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

    throw new Error(`Unmatched fake LLM prompt (role=${role}): ${p.slice(0, 160)}`);
  };
}

// ─── Fake Executor ──────────────────────────────────────────────────────────

function createFakeExecutor(projectPath) {
  return {
    async start(request, context) {
      const msId = rawId(context.milestoneId);
      const files = msId === 'ms-1'
        ? { ...FILES[msId], ...TOOL_INTERFACE_STUBS }
        : FILES[msId];
      if (!files) throw new Error(`No executor fixture for ${context.milestoneId}`);
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
    { input: 'Compare SwiftUI and Flutter', expected: 'mobile-dev.detect_frameworks' },
    { input: 'Is Expo a mobile framework?', expected: 'mobile-dev.detect_frameworks' },
    { input: 'Scaffold a new React Native project', expected: 'mobile-dev.scaffold_project' },
    { input: 'Vytvoř nový mobilní projekt', expected: 'mobile-dev.scaffold_project' },
    { input: 'Create a new Flutter app', expected: 'mobile-dev.scaffold_project' },
    { input: 'Initialize an Ionic app', expected: 'mobile-dev.scaffold_project' },
    { input: 'Založ React Native aplikaci', expected: 'mobile-dev.scaffold_project' },
    { input: 'Doporuč knihovnu pro navigaci', expected: 'mobile-dev.recommend_libs' },
    { input: 'Recommend a state management library', expected: 'mobile-dev.recommend_libs' },
    { input: 'Jaká knihovna je nejlepší pro formuláře?', expected: 'mobile-dev.recommend_libs' },
    { input: 'Suggest a package for forms', expected: 'mobile-dev.recommend_libs' },
  ];

  // Group C: Should NOT match (precision)
  const groupC = [
    { input: 'Kolik je hodin?' },
    { input: 'What is the weather?' },
    { input: 'Kolik zaplatím daní?' },
    { input: 'Hello, how are you?' },
    { input: 'What is 2 + 2?' },
    { input: 'Write a SQL query' },
    { input: 'Summarize the project status' },
    { input: 'Open the local config file' },
    { input: 'Translate this sentence to Czech' },
    { input: 'Explain recursion' },
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

  let falsePositives = 0;

  for (const test of groupC) {
    const result = matchInput(test.input);
    if (result !== null) falsePositives++;
  }

  const predictedPositives = recallHits + falsePositives;
  const precision = predictedPositives > 0 ? recallHits / predictedPositives : 0;

  return {
    caseCount: groupA.length + groupC.length,
    recall: recallHits / recallTotal,
    precision,
    toolAccuracy: toolAccuracyHits / recallTotal,
    recallDetail: `${recallHits}/${recallTotal}`,
    precisionDetail: `${recallHits}/${predictedPositives}`,
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

  // Unique temporary project path: never overwrite a user's projects/ tree.
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-expertise-'));

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
    check(fs.existsSync(path.join(projectPath, 'ARCHITECTURE.json')), 'Build.5b: ARCHITECTURE.json exists');

    // Approve roadmap → BUILD ms-1
    const r5 = await handleLifecycleInput('schvaluji', context);
    logTurn('schvaluji', r5);
    const s5 = getLcState(SESSION_ID);
    check(s5?.currentMilestoneId === scopeId(s5.lifecycleId, 'ms-1'), 'Build.6: scoped ms-1 plan shown');

    // Execute ms-1
    const r6 = await handleLifecycleInput('ano', context);
    logTurn('ano', r6);
    const ms1 = msRepo.getMilestone(scopeId(s5.lifecycleId, 'ms-1'));
    check(ms1?.status === 'PASSED', 'Build.7: ms-1 PASSED');
    check(fs.existsSync(path.join(projectPath, 'mobile-dev/specialist.json')), 'Build.8: specialist.json on disk');
    check(fs.existsSync(path.join(projectPath, 'mobile-dev/index.js')), 'Build.9: index.js on disk');

    // Execute ms-2
    const s6 = getLcState(SESSION_ID);
    check(s6?.currentMilestoneId === scopeId(s6.lifecycleId, 'ms-2'), 'Build.10: auto-advanced to scoped ms-2');
    const r7 = await handleLifecycleInput('ano', context);
    logTurn('ano', r7);
    const ms2 = msRepo.getMilestone(scopeId(s6.lifecycleId, 'ms-2'));
    check(ms2?.status === 'PASSED', 'Build.11: ms-2 PASSED');
    check(fs.existsSync(path.join(projectPath, 'mobile-dev/tools/detect-frameworks.js')), 'Build.12: detect-frameworks.js on disk');
    check(fs.existsSync(path.join(projectPath, 'mobile-dev/tools/scaffold-project.js')), 'Build.13: scaffold-project.js on disk');
    check(fs.existsSync(path.join(projectPath, 'mobile-dev/tools/recommend-libs.js')), 'Build.14: recommend-libs.js on disk');

    // Execute ms-3
    const s7 = getLcState(SESSION_ID);
    check(s7?.currentMilestoneId === scopeId(s7.lifecycleId, 'ms-3'), 'Build.15: auto-advanced to scoped ms-3');
    const r8 = await handleLifecycleInput('ano', context);
    logTurn('ano', r8);
    const ms3 = msRepo.getMilestone(scopeId(s7.lifecycleId, 'ms-3'));
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

    check(accuracy.caseCount >= 20, 'Routing.0: routing corpus has 20+ cases',
      `got: ${accuracy.caseCount}`);
    check(accuracy.recall >= 0.80, 'Routing.1: recall >= 80%',
      `got: ${(accuracy.recall * 100).toFixed(0)}%`);
    check(accuracy.precision >= 0.80, 'Routing.2: precision >= 80%',
      `got: ${(accuracy.precision * 100).toFixed(0)}%`);
    check(accuracy.toolAccuracy >= 0.70, 'Routing.3: tool accuracy >= 70%',
      `got: ${(accuracy.toolAccuracy * 100).toFixed(0)}%`);

    // Phase 2.5: Tool execution test
    console.log('\n═══ TOOL EXECUTION ═════════════════════════════════════════════════');

    const specialistTools = specialist?.tools ?? [];

    const detectTool = specialistTools.find(t => t.id === 'mobile-dev.detect_frameworks');
    check(typeof detectTool?.toolAdapter?.run === 'function',
      'Exec.1: detect_frameworks adapter is registered');
    const detectResult = detectTool?.toolAdapter?.run?.({ query: 'React Native' });
    check(detectResult?.status === 'ok', 'Exec.2: detect_frameworks returns ok');
    check(detectResult?.data?.detected === true, 'Exec.3: detected React Native');

    const scaffoldTool = specialistTools.find(t => t.id === 'mobile-dev.scaffold_project');
    check(typeof scaffoldTool?.toolAdapter?.run === 'function',
      'Exec.4: scaffold_project adapter is registered');
    const scaffoldResult = scaffoldTool?.toolAdapter?.run?.({
      platform: 'flutter',
      query: 'new Flutter app',
    });
    check(scaffoldResult?.status === 'ok', 'Exec.5: scaffold_project returns ok');
    check(scaffoldResult?.data?.platform === 'flutter', 'Exec.6: scaffold for Flutter');

    const recTool = specialistTools.find(t => t.id === 'mobile-dev.recommend_libs');
    check(typeof recTool?.toolAdapter?.run === 'function',
      'Exec.7: recommend_libs adapter is registered');
    const recResult = recTool?.toolAdapter?.run?.({
      category: 'navigation',
      platform: 'react-native',
    });
    check(recResult?.status === 'ok', 'Exec.8: recommend_libs returns ok');
    check(Array.isArray(recResult?.data?.libraries) && recResult.data.libraries.length > 0,
      'Exec.9: libraries returned');

    // Phase 2.6: Disable and verify cleanup
    await loader.disable('mobile-dev');
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

    console.log(`\n  ── Dočasný projekt: ${projectPath}`);
    console.log(`  ── Konverzace v DB: ${CONV_ID}`);
    console.log(`  ── Projekt v DB: id=${projectId}, name=${dbProject?.name}`);

  } catch (err) {
    console.error(`\n\nFATAL ERROR: ${err.message}`);
    console.error(err.stack);
    failed++;
    failures.push({ name: 'FATAL', detail: err.message });
  }

  if (failed === 0 && process.env.KEEP_PROJECT !== '1') {
    fs.rmSync(projectPath, { recursive: true, force: true });
    console.log(`\n  🧹 Dočasný projekt odstraněn: ${projectPath}`);
  } else {
    console.log(`\n  ℹ️ Dočasný projekt ponechán pro diagnostiku: ${projectPath}`);
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
