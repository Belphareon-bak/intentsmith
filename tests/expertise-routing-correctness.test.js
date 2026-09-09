#!/usr/bin/env node
import { resolveIsolatedArtifactPath } from './helpers/isolated-test-db.js';
import { writeFileSync } from 'node:fs';

// ══════════════════════════════════════════════════════════════════════════════
// C3-Agent — Expertise Routing Correctness Tests v87
// ══════════════════════════════════════════════════════════════════════════════
//
// PURPOSE: Verify GUARD 6 — Creative Override in CRE decide().
//   When creative expertise (creativeLock=true / outputBias=creative) is active,
//   SEARCH intent should be downgraded to CREATIVE for world-building/narrative queries.
//   Explicit factual search queries ("vyhledej", "najdi na internetu") bypass the guard.
//
// Run: node tests/expertise-routing-correctness.test.js
// ══════════════════════════════════════════════════════════════════════════════

import {
  CREDecisionEngine,
  IntentType,
  DecisionType,
} from '../src/chat/cre-decision.js';

import { BUILTIN_EXPERTISES } from '../src/expertises/expertise-layer.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test Runner (real CRE classifier; model-profile execution)
// ─────────────────────────────────────────────────────────────────────────────
let total = 0, passed = 0, failed = 0;
const failures = [];
let currentSection = '';
let currentTest = '';
let currentDecisionTrace = null;
const decisionTraces = [];

function section(name) {
  currentSection = name;
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${name}`);
  console.log(`${'─'.repeat(60)}`);
}

async function t(name, fn) {
  total++;
  currentTest = name;
  currentDecisionTrace = null;
  try {
    await fn();
    passed++;
    console.log(`  \x1b[32m✅\x1b[0m ${name}`);
  } catch (err) {
    failed++;
    const trace = currentDecisionTrace?.decision;
    const diagnostic = JSON.stringify({
      type: trace?.type ?? null,
      intent: trace?.intent ?? null,
      classifiedBy: trace?.metadata?.classifiedBy ?? null,
      diag: trace?.metadata?.diag ?? null,
      error: currentDecisionTrace?.error ?? null,
    }).slice(0, 1600);
    console.log(`  \x1b[31m❌\x1b[0m ${name}: ${err.message}; decisionTrace=${diagnostic}`);
    failures.push({ section: currentSection, name, error: err.message, decisionTrace: currentDecisionTrace });
  }
}

function eq(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} — expected "${expected}", got "${actual}"`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────
const cre = new CREDecisionEngine();

async function decideWithTrace(input, context = {}) {
  const trace = {
    section: currentSection,
    test: currentTest,
    input,
    expertiseId: context.expertise?.id ?? null,
    startedAt: new Date().toISOString(),
  };
  currentDecisionTrace = trace;
  decisionTraces.push(trace);
  try {
    const decision = await cre.decide(input, context);
    // Persist the serialized diagnostics from this exact returned decision,
    // before a failed expectation can discard them.
    trace.decision = decision.toJSON();
    return trace.decision;
  } catch (error) {
    trace.error = {
      code: typeof error?.code === 'string' ? error.code : null,
      message: String(error?.message ?? error).slice(0, 400),
    };
    throw error;
  } finally {
    trace.endedAt = new Date().toISOString();
  }
}

function assertCreativeGuardProof(decision) {
  const diag = decision.metadata?.diag;
  eq(decision.metadata?.classifiedBy, 'llm', 'guard witness must use the real classifier');
  eq(diag?.initialIntent, IntentType.SEARCH, 'same-call initial intent');
  eq(diag?.finalIntent, IntentType.CREATIVE, 'same-call final intent');
  eq(decision.intent, IntentType.CREATIVE, 'returned intent');
  if (!Array.isArray(diag?.overrides)
      || !diag.overrides.includes('guard6_creative_override')) {
    throw new Error('same-call guard6_creative_override witness is missing');
  }
}

function assertStaticKnowledgeWithoutCreativeOverride(decision) {
  const diag = decision.metadata?.diag;
  eq(decision.metadata?.classifiedBy, 'deterministic', 'static knowledge classifier');
  eq(diag?.initialIntent, IntentType.CONVERSATIONAL, 'static knowledge initial intent');
  eq(diag?.finalIntent, IntentType.CONVERSATIONAL, 'static knowledge final intent');
  eq(decision.intent, IntentType.CONVERSATIONAL, 'static knowledge returned intent');
  if (diag?.overrides?.includes('guard6_creative_override')) {
    throw new Error('guard6_creative_override must not fire without expertise');
  }
}

function assertSearchWithoutCreativeOverride(decision) {
  const diag = decision.metadata?.diag;
  eq(diag?.initialIntent, IntentType.SEARCH, 'unguarded same-call initial intent');
  eq(diag?.finalIntent, IntentType.SEARCH, 'unguarded same-call final intent');
  eq(decision.intent, IntentType.SEARCH, 'unguarded returned intent');
  if (diag?.overrides !== null && !Array.isArray(diag?.overrides)) {
    throw new Error('guard diagnostics must contain an override array or null');
  }
  if (diag?.overrides?.includes('guard6_creative_override')) {
    throw new Error('guard6_creative_override must not fire for this SEARCH');
  }
}

// Creative expertise contexts
const writerCtx = {
  hasActiveExpertise: true,
  expertise: BUILTIN_EXPERTISES.writer,
};
const dndCtx = {
  hasActiveExpertise: true,
  expertise: BUILTIN_EXPERTISES.dnd_master,
};
const songwriterCtx = {
  hasActiveExpertise: true,
  expertise: BUILTIN_EXPERTISES.songwriter,
};

// Non-creative expertise context (analyst — outputBias: analytical, no creativeLock)
const analystCtx = {
  hasActiveExpertise: true,
  expertise: BUILTIN_EXPERTISES.analyst,
};

// No expertise context
const noExpertiseCtx = {};

// ═══════════════════════════════════════════════════════════════════════════════
// 1a. GUARD 6 — SEARCH → CREATIVE downgrade for creative expertises
// ═══════════════════════════════════════════════════════════════════════════════

section('1a. SEARCH → CREATIVE downgrade (regex-classified SEARCH queries)');

// Queries that regex classifies as SEARCH → GUARD 6 should downgrade to CREATIVE
const regexSearchQueries = [
  'co je to ten temný les na severu',
  'jak vypadá město Waterdeep',
  'jaké jsou rasy v tomhle světě',
  'co je to nekromantie',
  'jaká je historie královského rodu',
  'jak pokračuje ten příběh',
  'jaké jsou motivace padoucha',
];

for (const input of regexSearchQueries) {
  await t(`DnD: "${input}" → CREATIVE (was SEARCH)`, async () => {
    const d = await decideWithTrace(input, dndCtx);
    eq(d.intent, IntentType.CREATIVE, `intent for "${input}" with dnd_master`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1b. GUARD 6 — AMBIGUOUS → CREATIVE downgrade for creative expertises
// ═══════════════════════════════════════════════════════════════════════════════

section('1b. AMBIGUOUS → CREATIVE downgrade (regex-classified AMBIGUOUS queries)');

// Queries that regex classifies as AMBIGUOUS → GUARD 6 should downgrade to CREATIVE
const regexAmbiguousQueries = [
  'Prokletý ostrov',
  'popiš mi hlavní město',
];

for (const input of regexAmbiguousQueries) {
  await t(`DnD: "${input}" → CREATIVE (was AMBIGUOUS)`, async () => {
    const d = await decideWithTrace(input, dndCtx);
    eq(d.intent, IntentType.CREATIVE, `intent for "${input}" with dnd_master`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1c. CONVERSATIONAL stays CONVERSATIONAL (handler uses expertise prompt)
// ═══════════════════════════════════════════════════════════════════════════════

section('1c. CONVERSATIONAL stays CONVERSATIONAL (handler has expertise context)');

// Queries that regex classifies as CONVERSATIONAL — guard does NOT touch these,
// because the conversation handler already gets the expertise system prompt.
const regexConversationalQueries = [
  { input: 'kdo vládne tady', ctx: dndCtx, label: 'DnD' },
  { input: 'kdo je hlavní postava', ctx: writerCtx, label: 'Writer' },
  { input: 'kdo je ten starý mudrc', ctx: dndCtx, label: 'DnD' },
  { input: 'jak zní ten refrén', ctx: songwriterCtx, label: 'Songwriter' },
];

// These regex-classify as CONVERSATIONAL but decide() overrides route them
// through GUARD 6 (AMBIGUOUS path or follow-up logic) → CREATIVE under creative expertise.
const conversationalOverriddenToCreative = [
  { input: 'co se stalo s tím drakem', ctx: dndCtx, label: 'DnD' },
  { input: 'co se stane na konci', ctx: writerCtx, label: 'Writer' },
];

for (const { input, ctx, label } of conversationalOverriddenToCreative) {
  await t(`${label}: "${input}" → CREATIVE (decide() override path)`, async () => {
    const d = await decideWithTrace(input, ctx);
    eq(d.intent, IntentType.CREATIVE, `intent for "${input}"`);
  });
}

for (const { input, ctx, label } of regexConversationalQueries) {
  await t(`${label}: "${input}" → CONVERSATIONAL (ok, handler has expertise)`, async () => {
    const d = await decideWithTrace(input, ctx);
    eq(d.intent, IntentType.CONVERSATIONAL, `intent for "${input}"`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Explicit factual search — BYPASS guard (SEARCH stays SEARCH)
// ═══════════════════════════════════════════════════════════════════════════════

section('2. Explicit search patterns BYPASS creative override');

const explicitSearchQueries = [
  'vyhledej mi informace o D&D pravidlech',
  'najdi na internetu historii Forgotten Realms',
  've skutečnosti jak vypadá hrad Karlštejn',
  'v reálném světě kolik stojí kostka D20',
  've wikipedii najdi Tolkiena',
  'googluj pravidla pro 5e combat',
  'faktická data o středověkých zbraních',
  'historická fakta o vikinzích',
];

for (const input of explicitSearchQueries) {
  await t(`Explicit search: "${input}" → stays SEARCH with DnD`, async () => {
    const d = await decideWithTrace(input, dndCtx);
    // These should NOT be downgraded — explicit search patterns bypass GUARD 6
    eq(d.intent, IntentType.SEARCH, `intent for "${input}" should stay SEARCH`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Non-creative expertise — no downgrade
// ═══════════════════════════════════════════════════════════════════════════════

section('3. Non-creative expertise (analyst) — no SEARCH downgrade');

const analystSearchQueries = [
  'kolik stojí bitcoin',
  'jaké jsou ceny GPU karet',
  'porovnej výkon M4 vs Ryzen 9',
  'jaké jsou trendy v AI',
];

for (const input of analystSearchQueries) {
  await t(`Analyst: "${input}" → stays SEARCH`, async () => {
    const d = await decideWithTrace(input, analystCtx);
    eq(d.intent, IntentType.SEARCH, `intent for "${input}" with analyst`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. No expertise — baseline (no downgrade)
// ═══════════════════════════════════════════════════════════════════════════════

section('4. No expertise — intents unchanged (baseline)');

const baselineQueries = [
  { input: 'co je to nekromantie', expected: IntentType.CONVERSATIONAL },
  { input: 'kdo vládne v Čechách', expected: IntentType.SEARCH },
  { input: 'jaká je cena zlata', expected: IntentType.SEARCH },
  { input: 'Prokletý ostrov', expected: IntentType.AMBIGUOUS },  // regex: AMBIGUOUS (no guard without expertise)
];

for (const { input, expected } of baselineQueries) {
  await t(`No expertise: "${input}" → ${expected}`, async () => {
    const d = await decideWithTrace(input, noExpertiseCtx);
    eq(d.intent, expected, `intent for "${input}" without expertise`);
    if (input === 'co je to nekromantie') {
      assertStaticKnowledgeWithoutCreativeOverride(d);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Creative expertises preserve non-SEARCH intents
// ═══════════════════════════════════════════════════════════════════════════════

section('5. Non-SEARCH intents unaffected by creative expertise');

const nonSearchInputs = [
  { input: 'ahoj', expected: IntentType.CONVERSATIONAL, label: 'greeting' },
  { input: 'kolik je 5+3', expected: IntentType.LOCAL, label: 'math' },
  { input: 'napiš mi funkci na sort', expected: IntentType.CODE, label: 'code' },
  { input: 'napiš příběh o drakovi', expected: IntentType.CREATIVE, label: 'creative (already)' },
  { input: 'díky', expected: IntentType.CONVERSATIONAL, label: 'thanks' },
];

for (const { input, expected, label } of nonSearchInputs) {
  await t(`DnD + ${label}: "${input}" → ${expected} (unchanged)`, async () => {
    const d = await decideWithTrace(input, dndCtx);
    eq(d.intent, expected, `intent for "${input}" with dnd_master`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. creativeLock flag validation
// ═══════════════════════════════════════════════════════════════════════════════

section('6. creativeLock flag present on creative expertises');

await t('writer has creativeLock=true', async () => {
  eq(BUILTIN_EXPERTISES.writer.creativeLock, true, 'writer.creativeLock');
});

await t('dnd_master has creativeLock=true', async () => {
  eq(BUILTIN_EXPERTISES.dnd_master.creativeLock, true, 'dnd_master.creativeLock');
});

await t('songwriter has creativeLock=true', async () => {
  eq(BUILTIN_EXPERTISES.songwriter.creativeLock, true, 'songwriter.creativeLock');
});

await t('analyst does NOT have creativeLock', async () => {
  eq(BUILTIN_EXPERTISES.analyst.creativeLock, undefined, 'analyst.creativeLock');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Diagnostic tracking — guard6 override logged in _diag
// ═══════════════════════════════════════════════════════════════════════════════

section('7. Diagnostic tracking (guard6_creative_override in metadata)');

await t('SEARCH with DnD logs guard6_creative_override in diag', async () => {
  // Same accepted witness as C-12. A CREATIVE final label alone does not prove
  // the SEARCH precondition or that Guard6 performed the transition.
  const d = await decideWithTrace('kdo napsal Prokletý ostrov', dndCtx);
  assertCreativeGuardProof(d);
});

await t('SEARCH without expertise has no guard6 override', async () => {
  // This existing deterministic live-search rule supplies the SEARCH
  // precondition. A static explanation such as blockchain is CONVERSATIONAL.
  const d = await decideWithTrace('jaké jsou trendy v IT podnikání', noExpertiseCtx);
  eq(d.metadata?.classifiedBy, 'deterministic', 'known live-search rule');
  assertSearchWithoutCreativeOverride(d);
});

await t('Explicit search with DnD has no guard6 override', async () => {
  const d = await decideWithTrace('vyhledej pravidla D&D 5e', dndCtx);
  assertSearchWithoutCreativeOverride(d);
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

const serializedEvidence = JSON.stringify({
  total, passed, failed, failures, decisions: decisionTraces,
}, null, 2);
writeFileSync(
  resolveIsolatedArtifactPath('expertise-routing-decisions.json'),
  serializedEvidence,
  { encoding: 'utf8', mode: 0o600 },
);

process.exit(failed > 0 ? 1 : 0);
