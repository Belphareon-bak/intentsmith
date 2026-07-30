#!/usr/bin/env node
import './helpers/isolated-test-db.js';

// ══════════════════════════════════════════════════════════════════════════════
// C3-Agent — SKILL Routing CRE Tests v88
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests SKILL_PATTERNS + GUARD 8 (deterministic SKILL detection):
//   - CZ phrases: "vytvořit expertizu", "chci expertizu", "přidej expertizu"
//   - EN phrases: "create expertise", "run skill"
//   - Explicit skill/recept/proceduru mentions
//   - Feature gate: SKILL → CONVERSATIONAL when skills disabled
//   - Non-SKILL inputs must NOT match SKILL_PATTERNS
//
// Run: node tests/skill-routing-cre.test.js
// ══════════════════════════════════════════════════════════════════════════════

import {
  CREDecisionEngine,
  IntentType,
  DecisionType,
} from '../src/chat/cre-decision.js';
import { featureManager } from '../src/core/feature-manager.js';

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

// ═══════════════════════════════════════════════════════════════════════════════
// 1. CZ: Create expertise phrases → SKILL
// ═══════════════════════════════════════════════════════════════════════════════
section('1. CZ: Create expertise → SKILL');

const czExpertiseQueries = [
  'chci vytvorit expertyzu na vyvoj mobilni aplikace v androidu',
  'vytvoř mi expertizu na zahradnictví',
  'vytvořit expertízu pro fitness',
  'přidej expertizu na vaření',
  'chci novou expertizu na marketing',
  'chci expertizu na programování',
  'nova expertiza na psychologii',
];

for (const input of czExpertiseQueries) {
  await t(`"${input}" → SKILL`, async () => {
    const d = await cre.decide(input, {});
    eq(d.intent, IntentType.SKILL, `intent for "${input}"`);
    eq(d.type, DecisionType.SKILL, `decision type for "${input}"`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Explicit skill/recept/procedura mentions → SKILL
// ═══════════════════════════════════════════════════════════════════════════════
section('2. Explicit skill/recept/procedura → SKILL');

const explicitSkillQueries = [
  'spusť skill create-expertise',
  'spust recept na vytvoreni projektu',
  'spusť proceduru X',
  'vytvoř skill na analýzu',
];

for (const input of explicitSkillQueries) {
  await t(`"${input}" → SKILL`, async () => {
    const d = await cre.decide(input, {});
    eq(d.intent, IntentType.SKILL, `intent for "${input}"`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. EN: Create expertise → SKILL
// ═══════════════════════════════════════════════════════════════════════════════
section('3. EN: Create expertise → SKILL');

const enQueries = [
  'create a new expertise on cooking',
  'add expertise for data analysis',
  'run the skill create-expertise',
];

for (const input of enQueries) {
  await t(`"${input}" → SKILL`, async () => {
    const d = await cre.decide(input, {});
    eq(d.intent, IntentType.SKILL, `intent for "${input}"`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Non-SKILL inputs must NOT match SKILL_PATTERNS
// ═══════════════════════════════════════════════════════════════════════════════
section('4. Non-SKILL inputs — must NOT match SKILL');

const nonSkillQueries = [
  { input: 'co je to expertiza?', expectedNot: IntentType.SKILL, label: 'question about expertise' },
  { input: 'napiš mi příběh', expectedNot: IntentType.SKILL, label: 'creative writing' },
  { input: 'postav mi web', expectedNot: IntentType.SKILL, label: 'BUILD query' },
  { input: 'ahoj', expectedNot: IntentType.SKILL, label: 'greeting' },
  { input: 'kolik je DPH z 15000 Kč?', expectedNot: IntentType.SKILL, label: 'accountant query' },
  { input: 'jaké je počasí v Praze', expectedNot: IntentType.SKILL, label: 'SEARCH query' },
  { input: 'navrhni architekturu systému', expectedNot: IntentType.SKILL, label: 'DESIGN query' },
];

for (const { input, expectedNot, label } of nonSkillQueries) {
  await t(`"${input}" (${label}) → NOT SKILL`, async () => {
    const d = await cre.decide(input, {});
    ok(d.intent !== expectedNot, `"${input}" should not be SKILL, got ${d.intent}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Feature gate: SKILL → CONVERSATIONAL when skills disabled
// ═══════════════════════════════════════════════════════════════════════════════
section('5. Feature gate — skills disabled → CONVERSATIONAL');

await t('SKILL_PATTERNS match but skills disabled → CONVERSATIONAL', async () => {
  // Disable skills
  featureManager.set('skills', false);

  const d = await cre.decide('vytvořit expertizu na vaření', {});
  ok(d.intent !== IntentType.SKILL, `should not be SKILL when disabled, got ${d.intent}`);

  // Re-enable skills
  featureManager.set('skills', true);
});

await t('after re-enable: SKILL works again', async () => {
  const d = await cre.decide('vytvořit expertizu na vaření', {});
  eq(d.intent, IntentType.SKILL, 'should be SKILL after re-enable');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Regression: existing intent classifications unchanged
// ═══════════════════════════════════════════════════════════════════════════════
section('6. Regression — existing intents unchanged');

const regressionTests = [
  { input: 'postav mi celý nový projekt', expected: IntentType.BUILD },
  { input: 'navrhni architekturu systému', expected: IntentType.DESIGN },
  { input: 'napiš mi druhou kapitolu s živým dialogem', expected: IntentType.CREATIVE },
];

for (const { input, expected } of regressionTests) {
  await t(`"${input}" → ${expected}`, async () => {
    const d = await cre.decide(input, {});
    eq(d.intent, expected, `intent for "${input}"`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(60)}`);
console.log(`  SKILL ROUTING CRE TEST RESULTS`);
console.log(`${'═'.repeat(60)}`);
console.log(`  Total:  ${total}`);
console.log(`  \x1b[32mPassed: ${passed}\x1b[0m`);
if (failed > 0) {
  console.log(`  \x1b[31mFailed: ${failed}\x1b[0m`);
  console.log(`${'═'.repeat(60)}\n`);
  console.log(`  FAILURES:`);
  for (const f of failures) {
    console.log(`  ❌ [${f.section}] ${f.name}: ${f.error}`);
  }
}
console.log(`${'═'.repeat(60)}`);

process.exit(failed > 0 ? 1 : 0);
