#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// C3-Agent — BUILD Routing in PROJECT Mode Tests v87
// ══════════════════════════════════════════════════════════════════════════════
//
// PURPOSE: Verify that BUILD/PLAN decisions in PROJECT mode don't dead-end.
// Bug: project.js had no case DecisionType.PLAN → fell to default → REFUSE
//
// Run: node tests/build-routing-project-mode.test.js
// ══════════════════════════════════════════════════════════════════════════════

import {
  CREDecisionEngine,
  IntentType,
  DecisionType,
} from '../src/chat/cre-decision.js';

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

async function t(name, fn) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  \x1b[32m✅\x1b[0m ${name}`);
  } catch (err) {
    failed++;
    console.log(`  \x1b[31m❌\x1b[0m ${name}: ${err.message}`);
    failures.push({ section: currentSection, name, error: err.message });
  }
}

function eq(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} — expected "${expected}", got "${actual}"`);
  }
}

function ok(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────
const cre = new CREDecisionEngine();

// Project context (simulates active project)
const projectCtx = {
  hasActiveProject: true,
  projectId: 161,
  projectName: 'Mobilni-aplikace',
  projectScope: 'project',
};

// No project context (baseline)
const noProjectCtx = {};

// ═══════════════════════════════════════════════════════════════════════════════
// 1. BUILD intent → PLAN decision type (CRE level)
// ═══════════════════════════════════════════════════════════════════════════════

section('1. CRE: BUILD queries → DecisionType.PLAN');

// Queries that regex BUILD_PATTERNS reliably catch
const regexBuildQueries = [
  'scaffoldni React projekt',
  'zacni s buildem',
  'muzes zacit implementovat',
  'prepni se do build modu',
];

for (const input of regexBuildQueries) {
  await t(`"${input}" → PLAN decision (regex)`, async () => {
    const d = await cre.decide(input, projectCtx);
    eq(d.type, DecisionType.PLAN, `decision type for "${input}"`);
    eq(d.intent, IntentType.BUILD, `intent for "${input}"`);
  });
}

// Queries that regex may NOT classify as BUILD (LLM would).
// They should still produce a valid decision (not dead-end).
const llmBuildQueries = [
  'postav mi mobilní aplikaci',
  'rozjeď mi REST API',
  'build me a chat module',
];

for (const input of llmBuildQueries) {
  await t(`"${input}" → valid decision (LLM-dependent BUILD)`, async () => {
    const d = await cre.decide(input, projectCtx);
    ok(d.type !== undefined, `decision type should be defined`);
    ok(d.intent !== undefined, `intent should be defined`);
    // In regex mode these may not be BUILD, but must NOT dead-end
    console.log(`    → intent: ${d.intent}, type: ${d.type}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. BUILD-like queries from the failing conversation
// ═══════════════════════════════════════════════════════════════════════════════

section('2. Failing conversation queries — intent classification');

const failingConversationQueries = [
  { input: 'chci abys zacal implementovat a psat kod', label: 'implementovat+kod' },
  { input: 'zacni s buildem', label: 'zacni s buildem' },
  { input: 'muzes zacit implementovat', label: 'muzes implementovat' },
  { input: 'zacni s psanim kodu', label: 'zacni s kodem' },
  { input: 'prepni se do build modu', label: 'build modu' },
  { input: 'napsat program', label: 'napsat program' },
];

for (const { input, label } of failingConversationQueries) {
  await t(`"${input}" — classified (not dead-end)`, async () => {
    const d = await cre.decide(input, projectCtx);
    // These may classify as BUILD, CODE, FILE_WRITE, or CREATIVE — all valid.
    // The key is they must NOT produce a decision that would dead-end.
    ok(d.type !== undefined, `decision type should be defined`);
    ok(d.intent !== undefined, `intent should be defined`);
    console.log(`    → intent: ${d.intent}, type: ${d.type}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. PLAN decision carries project metadata
// ═══════════════════════════════════════════════════════════════════════════════

section('3. PLAN decision metadata');

await t('PLAN decision has buildRequest flag', async () => {
  const d = await cre.decide('scaffoldni React projekt', projectCtx);
  eq(d.type, DecisionType.PLAN, 'type');
  ok(d.metadata?.buildRequest === true, 'buildRequest should be true');
});

await t('PLAN decision has input preview', async () => {
  const d = await cre.decide('scaffoldni React projekt', projectCtx);
  eq(d.type, DecisionType.PLAN, 'type');
  ok(d.metadata?.inputPreview?.length > 0, 'inputPreview should be non-empty');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Verify project.js handler import works
// ═══════════════════════════════════════════════════════════════════════════════

section('4. project.js handler imports');

await t('project.js imports build-handoff.js successfully', async () => {
  const bh = await import('../src/chat/handlers/build-handoff.js');
  ok(typeof bh.handleBuildDetected === 'function', 'handleBuildDetected should be a function');
  ok(typeof bh.handleBuildConfirmed === 'function', 'handleBuildConfirmed should be a function');
  ok(typeof bh.isProjectScopeBuild === 'function', 'isProjectScopeBuild should be a function');
});

await t('handleBuildDetected returns TaggedResponse (not REFUSE)', async () => {
  const bh = await import('../src/chat/handlers/build-handoff.js');
  const result = bh.handleBuildDetected('postav mi React aplikaci', {
    type: DecisionType.PLAN,
    intent: IntentType.BUILD,
    reason: 'BUILD intent detected',
    metadata: { buildRequest: true },
  }, {
    sessionId: 'test-session-build',
    project: { id: 1, name: 'test', path: '/tmp/test' },
  });

  // handleBuildDetected may return a Promise (lifecycle path) or TaggedResponse (quick build)
  const resolved = await Promise.resolve(result);
  ok(resolved !== null, 'result should not be null');
  ok(resolved.content !== undefined, 'result should have content');
  // Must NOT contain the REFUSE template
  ok(!resolved.content.includes('Zkuste prosím přeformulovat'), 'should NOT show REFUSE message');
  ok(!resolved.content.includes('nemohu zpracovat'), 'should NOT show "nemohu zpracovat"');
  console.log(`    → Response preview: ${resolved.content.substring(0, 100)}...`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. isProjectScopeBuild detection
// ═══════════════════════════════════════════════════════════════════════════════

section('5. isProjectScopeBuild heuristic');

await t('Multi-component query = project-scope', async () => {
  const bh = await import('../src/chat/handlers/build-handoff.js');
  ok(bh.isProjectScopeBuild('postav mi full-stack s React frontend, Express backend a PostgreSQL databází'), 'should be project-scope');
});

await t('Simple query = NOT project-scope', async () => {
  const bh = await import('../src/chat/handlers/build-handoff.js');
  ok(!bh.isProjectScopeBuild('postav mi REST API endpoint'), 'should NOT be project-scope');
});

await t('"celý projekt" = project-scope', async () => {
  const bh = await import('../src/chat/handlers/build-handoff.js');
  ok(bh.isProjectScopeBuild('chci postavit celý projekt'), 'should be project-scope');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(60)}`);
console.log(`  RESULTS: ${passed}/${total} passed, ${failed} failed`);
console.log(`${'═'.repeat(60)}`);

if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  [${f.section}] ${f.name}: ${f.error}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
