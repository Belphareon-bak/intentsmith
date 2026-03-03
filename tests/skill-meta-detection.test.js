#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// C3-Agent — Meta-skill Detection Unit Tests v93
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests detectMetaSkill() — deterministic pre-resolver detection for
// create-expertise and create-skill patterns.
//
// Requires: skill registry loaded with create-skill + create-expertise
//
// Run: node tests/skill-meta-detection.test.js
// ══════════════════════════════════════════════════════════════════════════════

import path from 'path';
import { fileURLToPath } from 'url';
import { skillRegistry } from '../src/skills/registry.js';
import { detectMetaSkill } from '../src/chat/handlers/skill.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.join(__dirname, '..', 'skills');

// ─── Test Runner ─────────────────────────────────────────────────────────────
let total = 0, passed = 0, failed = 0;
const failures = [];
let currentSection = '';

function section(name) {
  currentSection = name;
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${name}`);
  console.log(`${'─'.repeat(60)}`);
}

function t(name, fn) {
  total++;
  try {
    fn();
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

// ─── Setup: load skill registry ──────────────────────────────────────────────
skillRegistry.load(skillsDir, {
  info: () => {},
  debug: () => {},
  warn: (src, msg) => console.log(`  ⚠ ${src}: ${msg}`),
  error: (src, msg) => console.log(`  ❌ ${src}: ${msg}`),
});

console.log(`  Registry loaded: ${skillRegistry.list().length} skills`);
ok(skillRegistry.get('create-skill'), 'create-skill must be in registry');
ok(skillRegistry.get('create-expertise'), 'create-expertise must be in registry');

// ═══════════════════════════════════════════════════════════════════════════════
// 1. CZ: Create expertise patterns
// ═══════════════════════════════════════════════════════════════════════════════
section('1. CZ: Create expertise → create-expertise');

const czExpertiseInputs = [
  { input: 'chci expertyzu na analýzu hotového projektu', expectedTopic: 'analýzu hotového projektu' },
  { input: 'chci expertizu na vaření', expectedTopic: 'vaření' },
  { input: 'vytvoř expertizu na marketing', expectedTopic: 'marketing' },
  { input: 'udělej expertízu na zahradnictví', expectedTopic: 'zahradnictví' },
  { input: 'přidej expertizu na fitness', expectedTopic: 'fitness' },
  { input: 'zaregistruj expertizu na psychologii', expectedTopic: 'psychologii' },
  { input: 'nová expertiza na programování', expectedTopic: 'programování' },
  { input: 'novou expertizu na správu serverů', expectedTopic: 'správu serverů' },
  { input: 'chci expertízu pro kuchařinu', expectedTopic: 'kuchařinu' },
  { input: 'vytvoř expertizu o historii', expectedTopic: 'historii' },
];

for (const { input, expectedTopic } of czExpertiseInputs) {
  t(`"${input}" → create-expertise(topic="${expectedTopic}")`, () => {
    const result = detectMetaSkill(input);
    ok(result !== null, 'should match');
    eq(result.skillId, 'create-expertise', 'skillId');
    eq(result.params.topic, expectedTopic, 'topic');
    eq(result.confidence, 0.95, 'confidence');
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. CZ: Create skill patterns
// ═══════════════════════════════════════════════════════════════════════════════
section('2. CZ: Create skill → create-skill');

const czSkillInputs = [
  { input: 'chci skill na code review', expectedName: 'code review' },
  { input: 'vytvoř skill na deploy', expectedName: 'deploy' },
  { input: 'udělej skill pro analýzu logů', expectedName: 'analýzu logů' },
  { input: 'přidej skill na testování', expectedName: 'testování' },
  { input: 'nový skill generování reportů', expectedName: 'generování reportů' },
];

for (const { input, expectedName } of czSkillInputs) {
  t(`"${input}" → create-skill(name="${expectedName}")`, () => {
    const result = detectMetaSkill(input);
    ok(result !== null, 'should match');
    eq(result.skillId, 'create-skill', 'skillId');
    eq(result.params.name, expectedName, 'name');
    eq(result.confidence, 0.95, 'confidence');
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Non-matching inputs — must return null
// ═══════════════════════════════════════════════════════════════════════════════
section('3. Non-matching inputs → null');

const nonMatchInputs = [
  'co je to expertiza?',
  'napiš mi příběh',
  'ahoj',
  'jaké je počasí',
  'postav mi web',
  'spusť skill create-expertise',          // explicit skill run, not "create"
  'kolik je DPH?',
  'řekni mi o skillech',
  'navrhni architekturu',
  'analyzuj tento kód',
  'co umíš?',
  'jak funguje expertiza?',
  'expertiza na vaření je super',            // not a create request
  'potřebuju pomoc s expertizou',
];

for (const input of nonMatchInputs) {
  t(`"${input}" → null`, () => {
    const result = detectMetaSkill(input);
    eq(result, null, 'should not match');
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Edge cases
// ═══════════════════════════════════════════════════════════════════════════════
section('4. Edge cases');

t('trailing punctuation stripped from topic', () => {
  const result = detectMetaSkill('chci expertizu na vaření.');
  ok(result !== null, 'should match');
  eq(result.params.topic, 'vaření', 'trailing dot stripped');
});

t('trailing exclamation stripped', () => {
  const result = detectMetaSkill('vytvoř expertizu na marketing!');
  ok(result !== null, 'should match');
  eq(result.params.topic, 'marketing', 'trailing ! stripped');
});

t('trailing question mark stripped', () => {
  const result = detectMetaSkill('chci expertizu na analýzu?');
  ok(result !== null, 'should match');
  eq(result.params.topic, 'analýzu', 'trailing ? stripped');
});

t('expertise takes priority over skill (order)', () => {
  // "chci expertizu" matches expertise pattern first
  const result = detectMetaSkill('chci expertizu na programování');
  ok(result !== null, 'should match');
  eq(result.skillId, 'create-expertise', 'expertise pattern matched first');
});

t('long topic preserved', () => {
  const result = detectMetaSkill('chci expertizu na analýzu hotového projektu s důrazem na bezpečnost');
  ok(result !== null, 'should match');
  eq(result.params.topic, 'analýzu hotového projektu s důrazem na bezpečnost', 'full topic');
});

t('case insensitive', () => {
  const result = detectMetaSkill('CHCI EXPERTIZU NA MARKETING');
  ok(result !== null, 'should match');
  eq(result.skillId, 'create-expertise', 'case insensitive match');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Priority: expertise patterns should NOT eat skill patterns
// ═══════════════════════════════════════════════════════════════════════════════
section('5. Skill vs Expertise disambiguation');

t('"chci skill" → create-skill, NOT create-expertise', () => {
  const result = detectMetaSkill('chci skill na deploy check');
  ok(result !== null, 'should match');
  eq(result.skillId, 'create-skill', 'skill pattern matched');
});

t('"nový skill" → create-skill', () => {
  const result = detectMetaSkill('nový skill code-review');
  ok(result !== null, 'should match');
  eq(result.skillId, 'create-skill', 'skill pattern matched');
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(60)}`);
console.log(`  META-SKILL DETECTION TEST RESULTS`);
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
