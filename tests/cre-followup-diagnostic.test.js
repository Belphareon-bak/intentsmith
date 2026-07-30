#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// CRE Follow-up Diagnostic Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Diagnoses CRE classification of follow-up questions after:
//   - file attachments
//   - project context
//   - previous CONVERSATIONAL/PROJECT turns
//
// Tests both classifyIntent() (regex) and follow-up detection to understand
// WHERE the misclassification happens.
//
// Run: node tests/cre-followup-diagnostic.test.js
// ══════════════════════════════════════════════════════════════════════════════

import {
  CREDecisionEngine,
  IntentType,
} from '../src/chat/cre-decision.js';

import { detectFollowUpType } from '../src/chat/handlers/utils/followup.js';

const engine = new CREDecisionEngine();
let totalPassed = 0;
let totalFailed = 0;
let currentSection = '';
let sectionPassed = 0;
let sectionFailed = 0;

function section(name) {
  if (currentSection && (sectionPassed + sectionFailed) > 0) {
    const s = sectionFailed === 0 ? '✅' : '❌';
    console.log(`  ${s} ${currentSection}: ${sectionPassed}/${sectionPassed + sectionFailed}`);
  }
  currentSection = name;
  sectionPassed = 0;
  sectionFailed = 0;
}

function assert(label, condition) {
  if (condition) { sectionPassed++; totalPassed++; }
  else { sectionFailed++; totalFailed++; console.log(`    ❌ FAIL: ${label}`); }
}

/** Diagnostic: log what CRE classifies + what we expect */
function diag(input, expected, actual) {
  if (actual !== expected) {
    console.log(`    📊 "${input}" → got: ${actual}, expected: ${expected}`);
  }
}

function ci(input) { return engine.classifyIntent(input); }

console.log('══════════════════════════════════════════════════════════');
console.log('  CRE Follow-up Diagnostic — Attachment & Project Context');
console.log('══════════════════════════════════════════════════════════\n');

// ═══════════════════════════════════════════════════════════════════════════
// GROUP 1: classifyIntent() on short follow-up phrases (CZ)
// After file attachments, users send short follow-ups about the files.
// These should NOT be AMBIGUOUS — they should be CONVERSATIONAL or REPORT.
// ═══════════════════════════════════════════════════════════════════════════

section('G1: Short CZ follow-ups after file attachment — classifyIntent()');

const shortFollowups = [
  { input: 'chci nejaky vytah k cemu jsou', expect: 'NOT_AMBIGUOUS', desc: 'vytah = summary request' },
  { input: 'shrn to', expect: 'NOT_AMBIGUOUS', desc: 'shrn = summarize' },
  { input: 'co to dela', expect: 'NOT_AMBIGUOUS', desc: 'what does it do' },
  { input: 'vysvetli mi to', expect: 'NOT_AMBIGUOUS', desc: 'explain it to me' },
  { input: 'k cemu to slouzi', expect: 'NOT_AMBIGUOUS', desc: 'what is it for' },
  { input: 'popiš ten soubor', expect: 'NOT_AMBIGUOUS', desc: 'describe the file' },
  { input: 'o cem to je', expect: 'NOT_AMBIGUOUS', desc: 'what is it about' },
  { input: 'jake jsou ty soubory', expect: 'NOT_AMBIGUOUS', desc: 'what are the files' },
  { input: 'co je v nich', expect: 'NOT_AMBIGUOUS', desc: 'what is in them' },
  { input: 'udelej prehled', expect: 'NOT_AMBIGUOUS', desc: 'make an overview' },
];

for (const t of shortFollowups) {
  const intent = ci(t.input);
  const isNotAmbiguous = intent !== IntentType.AMBIGUOUS;
  diag(t.input, t.expect, isNotAmbiguous ? `${intent} (OK)` : `AMBIGUOUS (FAIL)`);
  assert(`"${t.input}" (${t.desc}) → should NOT be AMBIGUOUS, got: ${intent}`, isNotAmbiguous);
}

// ═══════════════════════════════════════════════════════════════════════════
// GROUP 2: classifyIntent() on short follow-ups (EN)
// ═══════════════════════════════════════════════════════════════════════════

section('G2: Short EN follow-ups after file attachment — classifyIntent()');

const enFollowups = [
  { input: 'what do these files do', expect: 'NOT_AMBIGUOUS' },
  { input: 'give me a summary', expect: 'NOT_AMBIGUOUS' },
  { input: 'explain the code', expect: 'NOT_AMBIGUOUS' },
  { input: 'what is this for', expect: 'NOT_AMBIGUOUS' },
  { input: 'describe it', expect: 'NOT_AMBIGUOUS' },
  { input: 'summarize them', expect: 'NOT_AMBIGUOUS' },
];

for (const t of enFollowups) {
  const intent = ci(t.input);
  const isNotAmbiguous = intent !== IntentType.AMBIGUOUS;
  diag(t.input, t.expect, isNotAmbiguous ? `${intent} (OK)` : `AMBIGUOUS (FAIL)`);
  assert(`"${t.input}" → should NOT be AMBIGUOUS, got: ${intent}`, isNotAmbiguous);
}

// ═══════════════════════════════════════════════════════════════════════════
// GROUP 3: detectFollowUpType() — does it catch follow-ups correctly?
// Simulate session state after a file attachment was sent + answered.
// ═══════════════════════════════════════════════════════════════════════════

section('G3: Follow-up detection after attachment turn');

// v73: New signature — pass lastDecision directly, not sessionState
const mockLastDecision = {
  intent: IntentType.CONVERSATIONAL,
  type: 'ANSWER',
  hasOutput: true,
};

const followupInputs = [
  { input: 'chci nejaky vytah k cemu jsou', expectedNot: 'NEW_QUERY' },
  { input: 'shrn to', expectedNot: 'NEW_QUERY' },
  { input: 'co to dela', expectedNot: 'NEW_QUERY' },
  { input: 'vysvetli mi to', expectedNot: 'NEW_QUERY' },
  { input: 'k cemu to slouzi', expectedNot: 'NEW_QUERY' },
  { input: 'udelej prehled', expectedNot: 'NEW_QUERY' },
  { input: 'jake jsou ty soubory', expectedNot: 'NEW_QUERY' },
];

for (const t of followupInputs) {
  const result = detectFollowUpType(t.input, mockLastDecision);
  const ok = result.type !== t.expectedNot;
  diag(t.input, `NOT ${t.expectedNot}`, `${result.type} (conf: ${result.confidence}, rule: ${result.rule})`);
  assert(`"${t.input}" → should NOT be ${t.expectedNot}, got: ${result.type}`, ok);
}

// ═══════════════════════════════════════════════════════════════════════════
// GROUP 4: Follow-up detection with PROJECT lastIntent
// ═══════════════════════════════════════════════════════════════════════════

section('G4: Follow-up detection after PROJECT turn');

const mockProjectDecision = {
  intent: 'PROJECT',
  type: 'ANSWER',
  hasOutput: true,
};

for (const t of followupInputs) {
  const result = detectFollowUpType(t.input, mockProjectDecision);
  diag(t.input, `NOT NEW_QUERY`, `${result.type} (conf: ${result.confidence}, rule: ${result.rule})`);
  assert(`"${t.input}" (PROJECT ctx) → NOT NEW_QUERY, got: ${result.type}`, result.type !== 'NEW_QUERY');
}

// ═══════════════════════════════════════════════════════════════════════════
// GROUP 5: CONTINUATION detection — length + pronoun thresholds
// "chci nejaky vytah k cemu jsou" is 33 chars (>30 threshold in followup.js)
// ═══════════════════════════════════════════════════════════════════════════

section('G5: CONTINUATION threshold boundary cases');

const boundaryTests = [
  { input: 'co to dela', len: 10, hasPronoun: true, desc: '<30 + "to"' },
  { input: 'vysvetli to', len: 11, hasPronoun: true, desc: '<30 + "to"' },
  { input: 'shrn to', len: 7, hasPronoun: true, desc: '<30 + "to"' },
  { input: 'k cemu to je', len: 12, hasPronoun: true, desc: '<30 + "to"' },
  { input: 'chci vytah k cemu jsou', len: 22, hasPronoun: false, desc: '<30, no pronoun' },
  { input: 'chci nejaky vytah k cemu jsou', len: 29, hasPronoun: false, desc: 'exactly 29, no pronoun' },
  { input: 'chci nejaky vytah k cemu to je', len: 30, hasPronoun: true, desc: 'exactly 30 + "to"' },
  { input: 'chci nejaky vytah k cemu jsou x', len: 31, hasPronoun: false, desc: '31 chars, no pronoun' },
];

for (const t of boundaryTests) {
  const result = detectFollowUpType(t.input, mockLastDecision);
  console.log(`    📊 "${t.input}" (${t.len} chars, pronoun: ${t.hasPronoun}) → ${result.type} (conf: ${result.confidence}, rule: ${result.rule})`);
}

// ═══════════════════════════════════════════════════════════════════════════
// GROUP 6: decide() with project context — full decision flow
// Tests the actual CRE decide() with hasActiveProject=true
// ═══════════════════════════════════════════════════════════════════════════

section('G6: CRE decide() with project context — async');

const decideTests = [
  'chci nejaky vytah k cemu jsou',
  'shrn to',
  'co to dela',
  'vysvetli mi to',
  'k cemu to slouzi',
  'udelej prehled',
];

let g6Completed = 0;
const g6Total = decideTests.length;

for (const input of decideTests) {
  try {
    const decision = await engine.decide(input, {
      hasActiveProject: true,
      projectScope: 'localai-proxy',
      lastIntent: IntentType.CONVERSATIONAL,
    });
    const isAskUser = decision.type === 'ASK_USER';
    const hasClarification = decision.slots?.includes('intent_clarification');
    diag(input, 'NOT ASK_USER+clarification', `${decision.type} (intent: ${decision.intent}, slots: ${JSON.stringify(decision.slots || [])})`);
    assert(`"${input}" → should NOT be ASK_USER+intent_clarification, got: ${decision.type}/${decision.intent}`,
      !(isAskUser && hasClarification));
    g6Completed++;
  } catch (e) {
    assert(`"${input}" → decide() must complete: ${e.message}`, false);
    g6Completed++;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GROUP 7: STICKY_INTENTS coverage for attachment follow-ups
// If lastIntent was REPORT/SEARCH, AMBIGUOUS should upgrade via sticky
// ═══════════════════════════════════════════════════════════════════════════

section('G7: Sticky intent upgrade from AMBIGUOUS');

const stickyTests = [
  { input: 'chci nejaky vytah k cemu jsou', lastIntent: IntentType.REPORT },
  { input: 'shrn to', lastIntent: IntentType.SEARCH },
  { input: 'co to dela', lastIntent: IntentType.SEARCH },
  { input: 'udelej prehled', lastIntent: IntentType.REPORT },
];

for (const t of stickyTests) {
  try {
    const decision = await engine.decide(t.input, {
      hasActiveProject: true,
      lastIntent: t.lastIntent,
    });
    const upgraded = decision.intent !== IntentType.AMBIGUOUS;
    diag(t.input, `sticky upgrade from ${t.lastIntent}`, `${decision.intent} (type: ${decision.type})`);
    assert(`"${t.input}" with lastIntent=${t.lastIntent} → should upgrade from AMBIGUOUS, got: ${decision.intent}`, upgraded);
  } catch (e) {
    assert(`"${t.input}" → sticky decide() must complete: ${e.message}`, false);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Print results
// ═══════════════════════════════════════════════════════════════════════════

// Flush last section
if (currentSection && (sectionPassed + sectionFailed) > 0) {
  const s = sectionFailed === 0 ? '✅' : '❌';
  console.log(`  ${s} ${currentSection}: ${sectionPassed}/${sectionPassed + sectionFailed}`);
}

console.log('\n══════════════════════════════════════════════════════════');
console.log(`  RESULTS: ${totalPassed} passed, ${totalFailed} failed`);
console.log('══════════════════════════════════════════════════════════');

process.exit(totalFailed > 0 ? 1 : 0);
