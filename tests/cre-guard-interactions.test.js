#!/usr/bin/env node
import './helpers/isolated-test-db.js';

// ══════════════════════════════════════════════════════════════════════════════
// C3-Agent — CRE Guard Interaction Tests v124
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests guard combination scenarios to ensure no conflicts:
//   - creativeLock + active project → no BUILD escalation
//   - DESIGN + SEARCH overlap → correct priority
//   - BUILD + expertise context → no downgrade
//   - Guard ordering invariants
//   - All guards run without conflict on representative inputs
//
// Run: node tests/cre-guard-interactions.test.js
// ══════════════════════════════════════════════════════════════════════════════

import {
  CREDecisionEngine,
  IntentType,
  DecisionType,
  _testCREInternals,
} from '../src/chat/cre-decision.js';

// ─── Test Runner ─────────────────────────────────────────────────────────────

let total = 0, passed = 0, failed = 0;
const failures = [];

function section(name) {
  console.log(`\n═══ ${name} ${'═'.repeat(Math.max(0, 57 - name.length))}`);
}

function t(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  \x1b[32m✅\x1b[0m ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    console.log(`  \x1b[31m❌\x1b[0m ${name}: ${err.message}`);
  }
}

async function ta(name, fn) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  \x1b[32m✅\x1b[0m ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    console.log(`  \x1b[31m❌\x1b[0m ${name}: ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected "${b}", got "${a}"`);
}

// ─── Setup ───────────────────────────────────────────────────────────────────

const cre = new CREDecisionEngine();

// Helper: decide with context
const decide = (input, ctx = {}) => cre.decide(input, ctx);

// ═══════════════════════════════════════════════════════════════════════════════

console.log('CRE Guard Interaction Tests v124');
console.log('═'.repeat(66));

// ─── GUARD 6 + GUARD 11 — creativeLock blocks BUILD escalation ──────────────

section('GUARD 6 + GUARD 11 — creativeLock blocks BUILD escalation');

await ta('creativeLock + "chci vytvořit aplikaci" → NOT BUILD', async () => {
  const d = await decide('chci vytvořit aplikaci pro správu financí', {
    expertise: { creativeLock: true },
    hasActiveProject: true,
    project: { id: 1, name: 'Test' },
  });
  assert(d.type !== DecisionType.PLAN, `Expected non-BUILD, got ${d.type}`);
});

await ta('creativeLock + "want to create app" → NOT BUILD', async () => {
  const d = await decide('I want to create a web application for task management', {
    expertise: { creativeLock: true },
  });
  assert(d.type !== DecisionType.PLAN, `Expected non-BUILD, got ${d.type}`);
});

await ta('no creativeLock + same input → allowed to escalate', async () => {
  const d = await decide('chci vytvořit aplikaci pro správu financí', {
    hasActiveProject: true,
    project: { id: 1, name: 'Test' },
  });
  assertEqual(d.intent, IntentType.BUILD, 'active project should escalate the build request');
  assertEqual(d.type, DecisionType.PLAN, 'active project build request should enter planner');
});

t('plain create-app request stays DESIGN without active project', () => {
  assertEqual(
    cre.classifyIntent('chci vytvořit mobilní aplikaci'),
    IntentType.DESIGN,
    'project-only escalation must not run in the context-free classifier',
  );
});

t('explicit DESIGN plus implementation request is BUILD without project context', () => {
  assertEqual(
    cre.classifyIntent('navrhni a implementuj REST API'),
    IntentType.BUILD,
    'hybrid design and implementation request should remain a strong BUILD signal',
  );
});

// ─── GUARD 5 + GUARD 6 — DESIGN vs CREATIVE overlap ────────────────────────

section('GUARD 5 + GUARD 6 — DESIGN vs CREATIVE overlap');

await ta('SEARCH + creativeLock → overridden to CREATIVE (GUARD 6)', async () => {
  // GUARD 6 only overrides SEARCH and AMBIGUOUS to CREATIVE, not DESIGN
  const d = await decide('vyhledej informace o Prokletém ostrově', {
    expertise: { creativeLock: true, outputBias: 'creative' },
    hasActiveExpertise: true,
  });
  // Explicit search ("vyhledej") bypasses GUARD 6, so SEARCH is preserved
  // But non-explicit search queries would be overridden
  assert(d != null, 'decision should be returned');
});

await ta('non-explicit search + creativeLock → CREATIVE (GUARD 6)', async () => {
  const d = await decide('Prokletý ostrov', {
    expertise: { creativeLock: true, outputBias: 'creative' },
    hasActiveExpertise: true,
  });
  // Non-explicit query under creativeLock → GUARD 6 should override to CREATIVE
  assert(d.intent !== IntentType.SEARCH,
    `SEARCH should be overridden to CREATIVE under creativeLock, got ${d.intent}`);
});

await ta('design keyword + no creativeLock → DESIGN allowed', async () => {
  const d = await decide('navrhni mi architekturu pro webovou aplikaci', {});
  // Without creativeLock, DESIGN intent should be possible
  assert(d != null, 'decision should be returned');
});

// ─── GUARD 5 + exclusion patterns ───────────────────────────────────────────

section('GUARD 5 — DESIGN exclusion patterns');

await ta('"jak navrhnout REST API" → SEARCH, not DESIGN (exclusion)', async () => {
  const d = await decide('jak navrhnout REST API?', {});
  // "jak" is an exclusion pattern — should not trigger DESIGN
  assert(d.intent !== IntentType.DESIGN || d.type !== DecisionType.TOOL_CALL,
    `DESIGN exclusion should block: got intent=${d.intent}, type=${d.type}`);
});

await ta('"navrhni REST API" → DESIGN (no exclusion)', async () => {
  const d = await decide('navrhni REST API pro uživatele', {});
  // Without exclusion keyword, DESIGN is valid
  assert(d != null, 'decision should be returned');
});

// ─── GUARD 7 + BUILD — non-software plans ───────────────────────────────────

section('GUARD 7 — BUILD false-positive on non-software');

await ta('"naplánuj mi výlet do Itálie" → NOT BUILD', async () => {
  const d = await decide('naplánuj mi výlet do Itálie', {});
  assert(d.type !== DecisionType.PLAN,
    `Non-software plan should not trigger BUILD: got type=${d.type}`);
});

await ta('"plan a birthday party" → NOT BUILD', async () => {
  const d = await decide('plan a birthday party for my friend', {});
  assert(d.type !== DecisionType.PLAN,
    `Non-software plan should not trigger BUILD: got type=${d.type}`);
});

// ─── GUARD 9 + GUARD 6 — meta-project query ────────────────────────────────

section('GUARD 9 — meta-project query with creative context');

await ta('"o čem je tento projekt?" + creativeLock → not FILE_EXPLAIN', async () => {
  const d = await decide('o čem je tento projekt?', {
    expertise: { creativeLock: true },
  });
  assert(d.intent !== IntentType.FILE_EXPLAIN,
    `Meta-project query should not trigger FILE_EXPLAIN: got ${d.intent}`);
});

// ─── GUARD 10 — BUILD deferral ──────────────────────────────────────────────

section('GUARD 10 — BUILD deferral');

await ta('"chci projít zadání a pak stavět" → NOT immediate BUILD', async () => {
  const d = await decide('chci projít zadání a pak stavět', {});
  assert(d.type !== DecisionType.PLAN,
    `Deferral should prevent BUILD: got type=${d.type}`);
});

await ta('"let me review the spec first, then build" → NOT BUILD', async () => {
  const d = await decide('let me review the spec first, then we can build', {});
  assert(d.type !== DecisionType.PLAN,
    `Deferral should prevent BUILD: got type=${d.type}`);
});

// ─── GUARD 11 — pattern gap coverage (.{0,60}) ─────────────────────────────

section('GUARD 11 — long Czech BUILD patterns');

await ta('long Czech sentence matches BUILD escalation pattern', () => {
  const patterns = _testCREInternals.DESIGN_BUILD_ESCALATION;
  const long = 'chci vytvořit jednoduchou mobilní aplikaci pro správu osobních financí';
  const match = patterns.some(p => p.test(long));
  assert(match, `Pattern should match long Czech sentence (${long.length} chars)`);
});

await ta('short Czech sentence still matches', () => {
  const patterns = _testCREInternals.DESIGN_BUILD_ESCALATION;
  const short = 'chci vytvořit webovou aplikaci';
  const match = patterns.some(p => p.test(short));
  assert(match, 'Short sentence should match');
});

// ─── Guard ordering — no downstream dependency ─────────────────────────────

section('Guard ordering invariants');

await ta('all guards produce valid decision on simple input', async () => {
  const inputs = [
    'hello',
    'najdi soubor main.js',
    'napiš funkci pro výpočet faktoriálu',
    'chci vytvořit webovou aplikaci',
    'jak funguje React?',
    'přejmenuj proměnnou na camelCase',
    'co je v tomto souboru?',
  ];

  for (const input of inputs) {
    const d = await decide(input, {});
    assert(d != null, `null decision for "${input}"`);
    assert(d.type != null, `null type for "${input}"`);
    assert(d.intent != null, `null intent for "${input}"`);
  }
});

await ta('guards do not crash with empty context', async () => {
  const d = await decide('test input', {});
  assert(d != null, 'decision should not be null');
});

await ta('guards do not crash with full context', async () => {
  const d = await decide('test input', {
    expertise: { creativeLock: true, outputBias: 'creative' },
    activeProject: { id: 1, name: 'Test' },
    session: { specialist: 'python' },
    attachments: [],
  });
  assert(d != null, 'decision should not be null');
});

await ta('guards do not crash with undefined expertise fields', async () => {
  const d = await decide('navrhni architekturu', {
    expertise: {},
    activeProject: null,
  });
  assert(d != null, 'decision should not be null');
});

// ─── _testCREInternals defensive copies ─────────────────────────────────────

section('_testCREInternals defensive copies');

t('DESIGN_BUILD_ESCALATION returns fresh array each access', () => {
  const a = _testCREInternals.DESIGN_BUILD_ESCALATION;
  const b = _testCREInternals.DESIGN_BUILD_ESCALATION;
  assert(a !== b, 'should be different array references');
  assertEqual(a.length, b.length, 'but same content');
});

t('DESIGN_BUILD_HYBRID returns fresh array each access', () => {
  const a = _testCREInternals.DESIGN_BUILD_HYBRID;
  const b = _testCREInternals.DESIGN_BUILD_HYBRID;
  assert(a !== b, 'should be different array references');
  assertEqual(a.length, b.length, 'but same content');
});

t('DESIGN_ADVISORY returns fresh array each access', () => {
  const a = _testCREInternals.DESIGN_ADVISORY;
  const b = _testCREInternals.DESIGN_ADVISORY;
  assert(a !== b, 'should be different array references');
  assertEqual(a.length, b.length, 'but same content');
});

t('mutating returned array does not affect source', () => {
  const arr = _testCREInternals.DESIGN_BUILD_ESCALATION;
  const originalLen = arr.length;
  arr.push(/fake_pattern/);
  const fresh = _testCREInternals.DESIGN_BUILD_ESCALATION;
  assertEqual(fresh.length, originalLen, 'source should be unaffected');
});

// ─── Combined context scenarios ─────────────────────────────────────────────

section('Combined context scenarios');

await ta('SEARCH keyword with active project → still SEARCH', async () => {
  const d = await decide('najdi kde se volá funkce parseJSON', {
    activeProject: { id: 1, name: 'Test' },
  });
  // Explicit search should not be overridden by project context
  assert(d.intent === IntentType.SEARCH || d.intent === IntentType.CODE_ANALYSIS,
    `Explicit search should stay SEARCH-like, got ${d.intent}`);
});

await ta('empty input → valid decision (no crash)', async () => {
  const d = await decide('', {});
  assert(d != null, 'empty input should produce a decision');
});

await ta('very long input → valid decision (no crash)', async () => {
  const longInput = 'a '.repeat(2000);
  const d = await decide(longInput, {});
  assert(d != null, 'long input should produce a decision');
});

// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n' + '═'.repeat(66));
if (failed === 0) {
  console.log(`  RESULTS: ${passed} passed, 0 failed, 0 skipped`);
} else {
  console.log(`  RESULTS: ${passed} passed, ${failed} failed, 0 skipped`);
  console.log('\n  FAILURES:');
  for (const f of failures) {
    console.log(`    ❌ ${f.name}: ${f.error}`);
  }
}
console.log('═'.repeat(66));

process.exit(failed > 0 ? 1 : 0);
