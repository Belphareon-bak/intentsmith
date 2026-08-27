#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// Soak Test: Attachment-heavy — 100 attachment follow-up scenarios
// ══════════════════════════════════════════════════════════════════════════════
//
// Simulates post-attachment context with diverse follow-up phrases.
// Tests the R1-R4 rule distribution when lastDecision = CONVERSATIONAL/ANSWER
// (typical for attachment processing turns).
//
// Deterministic crash-resistance probe, not the M6 release soak. The real
// 24-hour runtime evidence is produced by m6-long-soak.e2e.js.
//
// Run: node tests/soak/attachment-heavy.test.js
// ══════════════════════════════════════════════════════════════════════════════

import {
  CREDecisionEngine,
  IntentType,
  DecisionType,
} from '../../src/chat/cre-decision.js';

import {
  detectFollowUpType,
  FollowUpType,
} from '../../src/chat/handlers/utils/followup.js';

const engine = new CREDecisionEngine();
engine._llmClassifyIntent = async () => null;
let crashes = 0;
let total = 0;

const intentDist = {};
const followUpDist = {};
const ruleDist = {};
const contextDist = {};
const decideOutcomeDist = {};

function inc(m, k) { m[k] = (m[k] || 0) + 1; }

// ─────────────────────────────────────────────────────────────────────────────
// Attachment follow-up phrases — what users say AFTER sending a file
// ─────────────────────────────────────────────────────────────────────────────

const FOLLOWUPS_CZ = [
  'co to dělá',
  'shrň to',
  'vysvětli to',
  'k čemu to slouží',
  'popiš ten soubor',
  'o čem to je',
  'jaké jsou ty soubory',
  'co je v nich',
  'udělej přehled',
  'chci nějaký výtah',
  'chci vytah k čemu jsou',
  'analyzuj to',
  'co to obsahuje',
  'jaká je struktura',
  'kolik má řádků',
  'je tam nějaká chyba',
  'najdi bugy',
  'optimalizuj to',
  'přepiš to do TypeScriptu',
  'přidej komentáře',
  'vysvětli mi tu funkci',
  'co dělá ten loop',
  'proč je tam ten if',
  'popiš algoritmus',
  'jak to funguje',
];

const FOLLOWUPS_EN = [
  'what does it do',
  'summarize this',
  'explain the code',
  'describe it',
  'what is this for',
  'give me an overview',
  'analyze it',
  'what does it contain',
  'find bugs',
  'optimize it',
  'rewrite in TypeScript',
  'add comments',
  'explain that function',
  'how does it work',
  'what is the structure',
  'are there any errors',
  'review the code',
  'simplify this',
  'make it more readable',
  'what are the dependencies',
  'show the imports',
  'extract the main logic',
  'create unit tests for this',
  'document this module',
  'what patterns are used',
];

// Topic changes AFTER attachment — should detect as NEW_QUERY
const TOPIC_CHANGES = [
  'teď najdi restaurace v Praze',
  'now search for hotels',
  'změň téma na marketing',
  'switch to debugging',
  'něco úplně jiného',
  'forget the file, help with CSS',
  'dost o tom souboru',
  'stačí, potřebuju report o AI',
  'konec analýzy, hledej práci',
  'now write me a poem',
  'přepni na plánování',
  'change to project management',
  'teď chci mluvit o databázích',
  'stop reviewing, find me flights',
  'switch to creative writing',
  'dost kódu, chci report',
  'now help me with SQL',
  'přepni na hledání',
  'forget this, search for news',
  'stačí, chci něco jiného',
];

// Long inputs (>80 chars, no anaphora) — should be R3 NEW_QUERY
const LONG_INPUTS = [
  'potřebuju aby jsi mi našel všechny restaurace v okolí Prahy které mají vegetariánské menu a dobré recenze',
  'i need you to search for the best programming bootcamps in europe that offer remote options and have good placement rates',
  'napiš mi kompletní report o stavu trhu s elektromobily v České republice včetně prognózy na příštích pět let',
  'vytvoř mi detailní analýzu všech konkurenčních produktů v segmentu prémiových sluchátek s aktivním potlačením hluku',
  'please write a comprehensive guide to setting up kubernetes cluster on aws with auto scaling and monitoring',
];

// ─────────────────────────────────────────────────────────────────────────────
// Last decision contexts — simulating different attachment processing states
// ─────────────────────────────────────────────────────────────────────────────

const ATTACHMENT_CONTEXTS = [
  {
    label: 'CONV/ANSWER (typical attachment ack)',
    decision: { intent: IntentType.CONVERSATIONAL, type: DecisionType.ANSWER, hasOutput: true },
  },
  {
    label: 'CODE/ANSWER (code file analyzed)',
    decision: { intent: IntentType.CODE, type: DecisionType.ANSWER, hasOutput: true },
  },
  {
    label: 'FILE_READ/ANSWER (file was read)',
    decision: { intent: IntentType.FILE_READ, type: DecisionType.ANSWER, hasOutput: true },
  },
  {
    label: 'FILE_EXPLAIN/ANSWER (file was explained)',
    decision: { intent: IntentType.FILE_EXPLAIN, type: DecisionType.ANSWER, hasOutput: true },
  },
  {
    label: 'REPORT/TOOL_CALL (report generated from file)',
    decision: { intent: IntentType.REPORT, type: DecisionType.TOOL_CALL, hasOutput: true },
  },
  {
    label: 'SEARCH/TOOL_CALL (searched based on file)',
    decision: { intent: IntentType.SEARCH, type: DecisionType.TOOL_CALL, hasOutput: true },
  },
  {
    label: 'null (first turn, no history)',
    decision: null,
  },
];

console.log('══════════════════════════════════════════════════════════');
console.log('  SOAK: Attachment-heavy — 100 post-attachment scenarios');
console.log('══════════════════════════════════════════════════════════\n');

const startTime = Date.now();
let ctxIdx = 0;

// ── CZ follow-ups (25) ──
for (const input of FOLLOWUPS_CZ) {
  total++;
  const ctx = ATTACHMENT_CONTEXTS[ctxIdx % ATTACHMENT_CONTEXTS.length];
  ctxIdx++;
  inc(contextDist, ctx.label);

  try {
    inc(intentDist, engine.classifyIntent(input));
  } catch (e) { crashes++; console.log(`  CRASH ci("${input}"): ${e.message}`); }

  try {
    const fu = detectFollowUpType(input, ctx.decision);
    inc(followUpDist, fu.type);
    inc(ruleDist, fu.rule);
  } catch (e) { crashes++; console.log(`  CRASH dfu("${input}"): ${e.message}`); }

  try {
    const d = await engine.decide(input, {
      lastIntent: ctx.decision?.intent || null,
      lastDecision: ctx.decision,
      hasActiveProject: true,
    });
    inc(decideOutcomeDist, `${d.intent}/${d.type}`);
  } catch (e) {
    inc(decideOutcomeDist, `ERROR`);
  }
}

// ── EN follow-ups (25) ──
for (const input of FOLLOWUPS_EN) {
  total++;
  const ctx = ATTACHMENT_CONTEXTS[ctxIdx % ATTACHMENT_CONTEXTS.length];
  ctxIdx++;
  inc(contextDist, ctx.label);

  try {
    inc(intentDist, engine.classifyIntent(input));
  } catch (e) { crashes++; console.log(`  CRASH ci("${input}"): ${e.message}`); }

  try {
    const fu = detectFollowUpType(input, ctx.decision);
    inc(followUpDist, fu.type);
    inc(ruleDist, fu.rule);
  } catch (e) { crashes++; console.log(`  CRASH dfu("${input}"): ${e.message}`); }

  try {
    const d = await engine.decide(input, {
      lastIntent: ctx.decision?.intent || null,
      lastDecision: ctx.decision,
      hasActiveProject: true,
    });
    inc(decideOutcomeDist, `${d.intent}/${d.type}`);
  } catch (e) {
    inc(decideOutcomeDist, `ERROR`);
  }
}

// ── CZ follow-ups repeated with DIFFERENT contexts (25) ──
for (let i = 0; i < 25; i++) {
  total++;
  const input = FOLLOWUPS_CZ[i % FOLLOWUPS_CZ.length];
  // Use a different context than the first pass
  const ctx = ATTACHMENT_CONTEXTS[(ctxIdx + 3) % ATTACHMENT_CONTEXTS.length];
  ctxIdx++;
  inc(contextDist, ctx.label);

  try { inc(intentDist, engine.classifyIntent(input)); }
  catch (e) { crashes++; }

  try {
    const fu = detectFollowUpType(input, ctx.decision);
    inc(followUpDist, fu.type);
    inc(ruleDist, fu.rule);
  } catch (e) { crashes++; }

  try {
    const d = await engine.decide(input, {
      lastIntent: ctx.decision?.intent || null,
      lastDecision: ctx.decision,
    });
    inc(decideOutcomeDist, `${d.intent}/${d.type}`);
  } catch (e) { inc(decideOutcomeDist, `ERROR`); }
}

// ── Topic changes after attachment (20) ──
for (const input of TOPIC_CHANGES) {
  total++;
  const ctx = ATTACHMENT_CONTEXTS[ctxIdx % ATTACHMENT_CONTEXTS.length];
  ctxIdx++;
  inc(contextDist, ctx.label);

  try { inc(intentDist, engine.classifyIntent(input)); }
  catch (e) { crashes++; }

  try {
    const fu = detectFollowUpType(input, ctx.decision);
    inc(followUpDist, fu.type);
    inc(ruleDist, fu.rule);
  } catch (e) { crashes++; }

  try {
    const d = await engine.decide(input, {
      lastIntent: ctx.decision?.intent || null,
      lastDecision: ctx.decision,
    });
    inc(decideOutcomeDist, `${d.intent}/${d.type}`);
  } catch (e) { inc(decideOutcomeDist, `ERROR`); }
}

// ── Long inputs after attachment (5) ──
for (const input of LONG_INPUTS) {
  total++;
  const ctx = ATTACHMENT_CONTEXTS[0]; // CONV/ANSWER
  inc(contextDist, ctx.label);

  try { inc(intentDist, engine.classifyIntent(input)); }
  catch (e) { crashes++; }

  try {
    const fu = detectFollowUpType(input, ctx.decision);
    inc(followUpDist, fu.type);
    inc(ruleDist, fu.rule);
  } catch (e) { crashes++; }

  try {
    const d = await engine.decide(input, {
      lastIntent: ctx.decision?.intent || null,
      lastDecision: ctx.decision,
    });
    inc(decideOutcomeDist, `${d.intent}/${d.type}`);
  } catch (e) { inc(decideOutcomeDist, `ERROR`); }
}

const elapsed = Date.now() - startTime;

// ─────────────────────────────────────────────────────────────────────────────
// Distribution summary
// ─────────────────────────────────────────────────────────────────────────────

console.log('── Context Distribution (which lastDecision was used) ──');
for (const [k, v] of Object.entries(contextDist)) {
  console.log(`  ${k.padEnd(44)} ${String(v).padStart(3)}`);
}

console.log('\n── Intent Distribution (classifyIntent) ──');
const iSorted = Object.entries(intentDist).sort((a, b) => b[1] - a[1]);
for (const [k, v] of iSorted) {
  const pct = ((v / total) * 100).toFixed(1);
  const bar = '█'.repeat(Math.round(v / total * 30));
  console.log(`  ${k.padEnd(16)} ${String(v).padStart(3)}  ${pct.padStart(5)}%  ${bar}`);
}

console.log('\n── Follow-up Type Distribution ──');
const fSorted = Object.entries(followUpDist).sort((a, b) => b[1] - a[1]);
for (const [k, v] of fSorted) {
  const pct = ((v / total) * 100).toFixed(1);
  const bar = '█'.repeat(Math.round(v / total * 30));
  console.log(`  ${k.padEnd(16)} ${String(v).padStart(3)}  ${pct.padStart(5)}%  ${bar}`);
}

console.log('\n── Rule Distribution ──');
const rSorted = Object.entries(ruleDist).sort((a, b) => b[1] - a[1]);
for (const [k, v] of rSorted) {
  const pct = ((v / total) * 100).toFixed(1);
  console.log(`  ${k.padEnd(24)} ${String(v).padStart(3)}  ${pct.padStart(5)}%`);
}

console.log('\n── decide() Outcome Distribution ──');
const dSorted = Object.entries(decideOutcomeDist).sort((a, b) => b[1] - a[1]);
for (const [k, v] of dSorted) {
  console.log(`  ${k.padEnd(36)} ${String(v).padStart(3)}`);
}

console.log('\n══════════════════════════════════════════════════════════');
console.log(`  ${total} scenarios, ${crashes} crashes, ${elapsed}ms`);
console.log('══════════════════════════════════════════════════════════');

if (crashes > 0) {
  console.log(`\n  ❌ ${crashes} CRASHES — investigate above`);
  process.exit(1);
}
console.log('  ✅ Zero crashes');
process.exit(0);
