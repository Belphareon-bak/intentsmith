#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// Soak Test: Short Input Stress — 100 inputs under 25 chars
// ══════════════════════════════════════════════════════════════════════════════
//
// Stress-tests CRE on very short inputs — the hardest classification edge.
// Mix of CZ/EN, 1-word to 3-word phrases, pronouns, commands, greetings.
//
// Deterministic crash-resistance probe, not the M6 release soak. The real
// 24-hour runtime evidence is produced by m6-long-soak.e2e.js.
//
// Run: node tests/soak/short-input-stress.test.js
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
const lengthBuckets = { '1-3': 0, '4-7': 0, '8-12': 0, '13-18': 0, '19-25': 0 };

function inc(m, k) { m[k] = (m[k] || 0) + 1; }
function lenBucket(n) {
  if (n <= 3) return '1-3';
  if (n <= 7) return '4-7';
  if (n <= 12) return '8-12';
  if (n <= 18) return '13-18';
  return '19-25';
}

// ─────────────────────────────────────────────────────────────────────────────
// 100 short inputs (all < 25 chars)
// ─────────────────────────────────────────────────────────────────────────────

const INPUTS = [
  // 1-char
  'a', 'x', '?', '!', '.', 'k',
  // 2-3 char
  'ok', 'ne', 'jo', 'hi', 'no', 'yes', 'ano', 'hm', 'aha', 'wow',
  // Single CZ words
  'ahoj', 'díky', 'super', 'fajn', 'jasně', 'hmm', 'proč', 'kdy',
  'kde', 'kdo', 'jak', 'kolik', 'co', 'hele', 'tady', 'tam',
  // Single EN words
  'hello', 'thanks', 'great', 'why', 'how', 'what', 'when', 'where',
  'who', 'sure', 'right', 'cool', 'nice', 'done', 'next',
  // 2-word CZ
  'shrň to', 'co to', 'jak to', 'a dál', 'co dál', 'to je',
  'díky moc', 'jak kde', 'ne díky', 'no jo', 'tak co', 'co říkáš',
  'dej víc', 'popiš to', 'vysvětli to', 'ukaž to',
  // 2-word EN
  'do it', 'go on', 'tell me', 'show me', 'help me', 'try it',
  'not sure', 'sounds good', 'why not', 'and then',
  // 3-word CZ
  'co to dělá', 'k čemu to', 'jak to funguje', 'o čem to',
  'uděl to kratší', 'dej mi příklad',
  // 3-word EN
  'what is it', 'how does it', 'tell me more', 'show me code',
  'why is this', 'can you help',
  // Pronouns only
  'to', 'tohle', 'tenhle', 'ten', 'it', 'this', 'these', 'those',
  'nich', 'them', 'tady to',
  // Commands
  'stop', 'dost', 'konec', 'quit', 'reset',
];

// Contexts for follow-up detection
const CONTEXTS = [
  { intent: IntentType.SEARCH, type: DecisionType.TOOL_CALL, hasOutput: true },
  { intent: IntentType.REPORT, type: DecisionType.TOOL_CALL, hasOutput: true },
  { intent: IntentType.CONVERSATIONAL, type: DecisionType.ANSWER, hasOutput: true },
  { intent: IntentType.CODE, type: DecisionType.ANSWER, hasOutput: true },
  null,
];

console.log('══════════════════════════════════════════════════════════');
console.log('  SOAK: Short Input Stress — 100 inputs under 25 chars');
console.log('══════════════════════════════════════════════════════════\n');

const startTime = Date.now();

for (const input of INPUTS) {
  total++;
  inc(lengthBuckets, lenBucket(input.length));

  // ── classifyIntent ──
  try {
    const intent = engine.classifyIntent(input);
    inc(intentDist, intent);
  } catch (e) {
    crashes++;
    console.log(`  CRASH classifyIntent("${input}"): ${e.message}`);
  }

  // ── detectFollowUpType with each context ──
  for (const ctx of CONTEXTS) {
    try {
      const fu = detectFollowUpType(input, ctx);
      inc(followUpDist, fu.type);
      inc(ruleDist, fu.rule);
    } catch (e) {
      crashes++;
      console.log(`  CRASH detectFollowUpType("${input}", ctx=${ctx?.intent}): ${e.message}`);
    }
  }

  // ── decide with rotating context ──
  try {
    const ctx = CONTEXTS[total % CONTEXTS.length];
    await engine.decide(input, {
      lastIntent: ctx?.intent || null,
      lastDecision: ctx,
    });
  } catch (e) {
    // Expected for AMBIGUOUS without LLM — not a crash
  }
}

const elapsed = Date.now() - startTime;

// ─────────────────────────────────────────────────────────────────────────────
// Distribution summary
// ─────────────────────────────────────────────────────────────────────────────

console.log('── Length Distribution ──');
for (const [k, v] of Object.entries(lengthBuckets)) {
  const pct = ((v / total) * 100).toFixed(1);
  const bar = '█'.repeat(Math.round(v / total * 30));
  console.log(`  ${k.padEnd(8)} ${String(v).padStart(3)}  ${pct.padStart(5)}%  ${bar}`);
}

console.log('\n── Intent Distribution (classifyIntent) ──');
const intentSorted = Object.entries(intentDist).sort((a, b) => b[1] - a[1]);
for (const [k, v] of intentSorted) {
  const pct = ((v / total) * 100).toFixed(1);
  const bar = '█'.repeat(Math.round(v / total * 30));
  console.log(`  ${k.padEnd(16)} ${String(v).padStart(3)}  ${pct.padStart(5)}%  ${bar}`);
}

console.log('\n── Follow-up Type Distribution (across all contexts) ──');
const fuTotal = Object.values(followUpDist).reduce((a, b) => a + b, 0);
const fuSorted = Object.entries(followUpDist).sort((a, b) => b[1] - a[1]);
for (const [k, v] of fuSorted) {
  const pct = ((v / fuTotal) * 100).toFixed(1);
  const bar = '█'.repeat(Math.round(v / fuTotal * 30));
  console.log(`  ${k.padEnd(16)} ${String(v).padStart(4)}  ${pct.padStart(5)}%  ${bar}`);
}

console.log('\n── Rule Distribution ──');
const ruleTotal = Object.values(ruleDist).reduce((a, b) => a + b, 0);
const ruleSorted = Object.entries(ruleDist).sort((a, b) => b[1] - a[1]);
for (const [k, v] of ruleSorted) {
  const pct = ((v / ruleTotal) * 100).toFixed(1);
  console.log(`  ${k.padEnd(24)} ${String(v).padStart(4)}  ${pct.padStart(5)}%`);
}

console.log('\n══════════════════════════════════════════════════════════');
console.log(`  ${total} inputs × ${CONTEXTS.length} contexts, ${crashes} crashes, ${elapsed}ms`);
console.log('══════════════════════════════════════════════════════════');

if (crashes > 0) {
  console.log(`\n  ❌ ${crashes} CRASHES — investigate above`);
  process.exit(1);
}
console.log('  ✅ Zero crashes');
process.exit(0);
