#!/usr/bin/env node
import './helpers/isolated-test-db.js';

// ══════════════════════════════════════════════════════════════════════════════
// C3-Agent — Executor Capabilities Tests v90
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests all 4 executor capability additions:
//   1. Shell whitelist expansion (35+ commands, 120s timeout)
//   2. Build verification state in WorkflowOrchestrator
//   3. Scaffold templates (8 total, tag matching)
//   4. CODE→BUILD escalation (isProjectScopeBuild + CRE)
//
// Run: node tests/executor-capabilities.test.js
// ══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// Test Runner
// ─────────────────────────────────────────────────────────────────────────────
let total = 0, passed = 0, failed = 0;
const failures = [];
let currentSection = '';

function section(name) {
  currentSection = name;
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${name}`);
  console.log(`${'─'.repeat(60)}`);
}

function test(desc, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  \x1b[32m✅\x1b[0m ${desc}`);
  } catch (err) {
    failed++;
    const msg = `[${currentSection}] ${desc}: ${err.message}`;
    failures.push(msg);
    console.log(`  \x1b[31m❌\x1b[0m ${desc}`);
    console.log(`     → ${err.message}`);
  }
}

async function testAsync(desc, fn) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  \x1b[32m✅\x1b[0m ${desc}`);
  } catch (err) {
    failed++;
    const msg = `[${currentSection}] ${desc}: ${err.message}`;
    failures.push(msg);
    console.log(`  \x1b[31m❌\x1b[0m ${desc}`);
    console.log(`     → ${err.message}`);
  }
}

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg ? msg + ' — ' : ''}expected "${expected}", got "${actual}"`);
  }
}

function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. SHELL WHITELIST EXPANSION
// ═══════════════════════════════════════════════════════════════════════════════
section('1. Shell whitelist expansion (10 tests)');

// We can't import ALLOWED_COMMANDS directly (it's a const in module scope),
// but we can test via the executeShell function's behavior.
// Instead, re-read the source to verify the whitelist content.
import { readFileSync } from 'fs';
const shellSource = readFileSync(new URL('../src/skills/steps/shell.js', import.meta.url), 'utf-8');

const EXPECTED_COMMANDS = [
  'npm', 'yarn', 'pnpm', 'pip', 'pip3',     // Package managers
  'python', 'python3', 'deno', 'bun',         // Runtimes
  'git',                                       // VCS
  'mkdir', 'cp', 'mv', 'touch',               // Filesystem
  'tsc', 'eslint', 'prettier',                 // Build/lint
  'jest', 'vitest', 'pytest',                  // Test runners
  'make', 'cargo', 'go', 'flutter', 'dart',   // Multi-lang
  'docker', 'curl',                            // Containers/HTTP
  'grep', 'find', 'sort', 'diff',             // Text/file search
  // Original commands
  'dot', 'plantuml', 'mermaid', 'npx', 'node',
  'cat', 'ls', 'wc', 'head', 'tail', 'echo',
];

for (const cmd of EXPECTED_COMMANDS) {
  test(`"${cmd}" in ALLOWED_COMMANDS`, () => {
    // Check if the command appears as a string in the Set definition
    assert(
      shellSource.includes(`'${cmd}'`),
      `"${cmd}" not found in shell.js ALLOWED_COMMANDS`
    );
  });
}

test('SHELL_TIMEOUT is 120_000 (120 seconds)', () => {
  assert(
    shellSource.includes('120_000') || shellSource.includes('120000'),
    'SHELL_TIMEOUT should be 120000 (120 seconds)'
  );
});

test('timeout error message says 120s', () => {
  assert(
    shellSource.includes("timeout (120s)"),
    'Error message should reference 120s timeout'
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. BUILD VERIFICATION STATE
// ═══════════════════════════════════════════════════════════════════════════════
section('2. Build verification state (5 tests)');

import { WorkflowState } from '../src/planner/workflow.js';

test('BUILD_VERIFYING state exists', () => {
  assert(WorkflowState.BUILD_VERIFYING !== undefined, 'BUILD_VERIFYING should exist in WorkflowState');
  assertEqual(WorkflowState.BUILD_VERIFYING, 'BUILD_VERIFYING');
});

test('all original states still exist', () => {
  const originalStates = [
    'IDLE', 'ANALYZING', 'CLARIFYING', 'PLANNING', 'AWAITING_APPROVAL',
    'IMPLEMENTING', 'QUICK_REVIEWING', 'FIX_DELIBERATING', 'APPLYING_FIX',
    'FINAL_REVIEWING', 'REDESIGNING', 'COMPLETED', 'FAILED',
  ];
  for (const state of originalStates) {
    assert(WorkflowState[state] !== undefined, `${state} should still exist`);
  }
});

test('WorkflowState is frozen', () => {
  assert(Object.isFrozen(WorkflowState), 'WorkflowState should be frozen');
});

// Verify _buildVerify and _detectBuildCommand exist on the orchestrator
import WorkflowOrchestrator from '../src/planner/workflow.js';

test('WorkflowOrchestrator has _buildVerify method', () => {
  const orc = new WorkflowOrchestrator();
  assert(typeof orc._buildVerify === 'function', '_buildVerify should be a function');
});

test('WorkflowOrchestrator has _detectBuildCommand method', () => {
  const orc = new WorkflowOrchestrator();
  assert(typeof orc._detectBuildCommand === 'function', '_detectBuildCommand should be a function');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. BUILD COMMAND DETECTION
// ═══════════════════════════════════════════════════════════════════════════════
section('3. Build command detection (7 tests)');

const orc = new WorkflowOrchestrator();

test('detects npm run build from package.json', () => {
  const impl = [{ output: '{"scripts": {"build": "tsc && vite build"}}' }];
  assertEqual(orc._detectBuildCommand(impl), 'npm run build');
});

test('detects cargo build from Cargo.toml', () => {
  const impl = [{ output: 'Created Cargo.toml with dependencies' }];
  assertEqual(orc._detectBuildCommand(impl), 'cargo build');
});

test('detects go build from go.mod', () => {
  const impl = [{ output: 'module example.com/app\n\ngo.mod initialized' }];
  assertEqual(orc._detectBuildCommand(impl), 'go build ./...');
});

test('detects make from Makefile', () => {
  const impl = [{ output: 'Created Makefile with build target' }];
  assertEqual(orc._detectBuildCommand(impl), 'make');
});

test('detects flutter build from pubspec.yaml', () => {
  const impl = [{ output: 'Created pubspec.yaml with dependencies' }];
  assertEqual(orc._detectBuildCommand(impl), 'flutter build');
});

test('returns null when no build system detected', () => {
  const impl = [{ output: 'Created simple script.py with no build' }];
  assertEqual(orc._detectBuildCommand(impl), null);
});

test('handles string implementation', () => {
  const impl = 'package.json with "build": "tsc"';
  assertEqual(orc._detectBuildCommand(impl), 'npm run build');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. BUILD ERROR PARSER
// ═══════════════════════════════════════════════════════════════════════════════
section('4. Build error parser (4 tests)');

test('parses TypeScript errors', () => {
  const stderr = 'src/index.ts(10,5): error TS2304: Cannot find name "foo"\nsrc/app.ts(20,1): error TS1005: ";" expected';
  const errors = orc._parseBuildErrors(stderr);
  assert(errors.length === 2, `expected 2 errors, got ${errors.length}`);
  assert(errors[0].includes('TS2304'), 'first error should contain TS2304');
});

test('parses generic error lines', () => {
  const stderr = 'Build output\nERROR in ./src/index.js\nModule not found\nwarning: unused variable';
  const errors = orc._parseBuildErrors(stderr);
  assert(errors.length >= 1, `expected at least 1 error, got ${errors.length}`);
  assert(errors[0].includes('ERROR'), 'should contain ERROR');
});

test('caps at 20 errors', () => {
  const lines = Array.from({ length: 30 }, (_, i) => `Error: problem ${i}`);
  const errors = orc._parseBuildErrors(lines.join('\n'));
  assert(errors.length <= 20, `expected max 20 errors, got ${errors.length}`);
});

test('returns output slice when no error lines found', () => {
  const stderr = 'some output without error keyword';
  const errors = orc._parseBuildErrors(stderr);
  assert(errors.length === 1, `expected 1 fallback entry, got ${errors.length}`);
  assert(errors[0].includes('some output'), 'should return original output');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. SCAFFOLD TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════════
section('5. Scaffold templates (8 tests)');

import { domainRegistry, extractTags } from '../src/domains/index.js';

const ALL_SCAFFOLD_IDS = [
  'express-api', 'react-app', 'fullstack',
  'next-app', 'vue-app', 'python-fastapi', 'cli-tool', 'flutter-app',
];

test('8 scaffolds registered', () => {
  const all = domainRegistry.listAll();
  assertEqual(all.scaffolds.length, 8, 'scaffold count');
});

for (const id of ALL_SCAFFOLD_IDS) {
  test(`scaffold "${id}" exists`, () => {
    const s = domainRegistry.getScaffold(id);
    assert(s !== null, `scaffold "${id}" not found`);
    assert(s.files && s.files.length > 0, `scaffold "${id}" has no files`);
    assert(s.postSetup && s.postSetup.length > 0, `scaffold "${id}" has no postSetup`);
    assert(s.tags && s.tags.length > 0, `scaffold "${id}" has no tags`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. TAG MATCHING
// ═══════════════════════════════════════════════════════════════════════════════
section('6. Tag matching (7 tests)');

test('extractTags: "flutter mobilní app" → flutter, mobile', () => {
  const tags = extractTags('flutter mobilní app');
  assert(tags.includes('flutter'), 'should include flutter');
  assert(tags.includes('mobile'), 'should include mobile');
});

test('extractTags: "next.js react" → next, react', () => {
  const tags = extractTags('next.js react app');
  assert(tags.includes('next'), 'should include next');
  assert(tags.includes('react'), 'should include react');
});

test('extractTags: "vue frontend" → vue', () => {
  const tags = extractTags('vue frontend aplikace');
  assert(tags.includes('vue'), 'should include vue');
});

test('extractTags: "fastapi python" → fastapi, python', () => {
  const tags = extractTags('fastapi python api');
  assert(tags.includes('fastapi'), 'should include fastapi');
  assert(tags.includes('python'), 'should include python');
});

test('extractTags: "cli command-line tool" → cli', () => {
  const tags = extractTags('cli command-line tool');
  assert(tags.includes('cli'), 'should include cli');
});

test('searchScaffolds(["flutter"]) → flutter-app', () => {
  const results = domainRegistry.searchScaffolds(['flutter']);
  assert(results.length > 0, 'should find at least 1 scaffold');
  assertEqual(results[0].id, 'flutter-app');
});

test('searchScaffolds(["next"]) → next-app', () => {
  const results = domainRegistry.searchScaffolds(['next']);
  assert(results.length > 0, 'should find at least 1 scaffold');
  assertEqual(results[0].id, 'next-app');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. CODE→BUILD ESCALATION (isProjectScopeBuild)
// ═══════════════════════════════════════════════════════════════════════════════
section('7. CODE→BUILD escalation — isProjectScopeBuild (6 tests)');

import { isProjectScopeBuild } from '../src/chat/handlers/build-handoff.js';

const SHOULD_ESCALATE = [
  { input: 'napiš frontend v React a backend API s MongoDB databáze', label: '3 components: frontend + backend + DB' },
  { input: 'vytvořit celý projekt s autentizací a testami a API', label: 'explicit celý projekt + 3 components' },
  { input: 'chci postavit kompletní e-shop', label: 'explicit kompletní e-shop' },
  { input: 'build a full stack application with React frontend, Express backend and PostgreSQL', label: 'EN: 3 components' },
];

for (const { input, label } of SHOULD_ESCALATE) {
  test(`"${input.slice(0, 50)}..." → true (${label})`, () => {
    assert(isProjectScopeBuild(input), `expected true for: ${input}`);
  });
}

const SHOULD_NOT_ESCALATE = [
  { input: 'napiš funkci pro sorting', label: 'single function' },
  { input: 'oprav bug v app.js', label: 'single file fix' },
];

for (const { input, label } of SHOULD_NOT_ESCALATE) {
  test(`"${input}" → false (${label})`, () => {
    assert(!isProjectScopeBuild(input), `expected false for: ${input}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. CRE CODE→BUILD ESCALATION (integration)
// ═══════════════════════════════════════════════════════════════════════════════
section('8. CRE CODE→BUILD integration (3 tests)');

import { CREDecisionEngine, IntentType, DecisionType } from '../src/chat/cre-decision.js';

const cre = new CREDecisionEngine();

await testAsync('"napiš frontend + backend + databázi" with project → BUILD/PLAN', async () => {
  const d = await cre.decide('napiš frontend v React, backend v Express a MongoDB databázi', {
    hasActiveProject: true,
    projectScope: { type: 'webapp', path: '/tmp/test-project' },
  });
  // Should escalate to BUILD (PLAN decision)
  assertEqual(d.type, DecisionType.PLAN, `decision type — got ${d.type}`);
  assertEqual(d.intent, IntentType.BUILD, `intent — got ${d.intent}`);
  assert(d.metadata?.escalatedFromCode === true, 'should have escalatedFromCode flag');
});

await testAsync('"napiš funkci pro sorting" with project → TOOL_CALL (no escalation)', async () => {
  const d = await cre.decide('napiš funkci pro sorting', {
    hasActiveProject: true,
    projectScope: { type: 'webapp', path: '/tmp/test-project' },
  });
  // Should NOT escalate — single function, no multi-component scope
  assert(d.type !== DecisionType.PLAN || d.intent !== IntentType.BUILD,
    `should NOT escalate to BUILD, got type=${d.type} intent=${d.intent}`);
});

await testAsync('"napiš frontend + backend + DB" WITHOUT project → ANSWER (no escalation)', async () => {
  const d = await cre.decide('napiš frontend v React, backend v Express a MongoDB databázi', {});
  // No active project → cannot escalate to BUILD
  assert(d.type !== DecisionType.PLAN || d.metadata?.escalatedFromCode !== true,
    `should NOT escalate without project, got type=${d.type}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(60)}`);
console.log(`  EXECUTOR CAPABILITIES TEST RESULTS`);
console.log(`${'═'.repeat(60)}`);
console.log(`  Total:  ${total}`);
console.log(`  \x1b[32mPassed: ${passed}\x1b[0m`);
if (failed > 0) {
  console.log(`  \x1b[31mFailed: ${failed}\x1b[0m`);
  console.log(`${'═'.repeat(60)}\n`);
  console.log(`  FAILURES:`);
  for (const f of failures) {
    console.log(`  ❌ ${f}`);
  }
}
console.log(`${'═'.repeat(60)}`);

process.exit(failed > 0 ? 1 : 0);
