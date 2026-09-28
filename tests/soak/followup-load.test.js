#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// Soak Test: Follow-up Load — 200 turns across scenario types
// ══════════════════════════════════════════════════════════════════════════════
//
// Deterministic crash-resistance probe that prints regex-fallback distribution
// data. The real M6 24-hour runtime evidence is produced separately.
//
// Run: node tests/soak/followup-load.test.js
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

// Distribution counters
const intentDist = {};
const followUpDist = {};
const ruleDist = {};
const decideTypeDist = {};
const confidenceBuckets = { '0.0-0.3': 0, '0.3-0.5': 0, '0.5-0.7': 0, '0.7-0.9': 0, '0.9-1.0': 0 };

function bucketConf(c) {
  if (c < 0.3) return '0.0-0.3';
  if (c < 0.5) return '0.3-0.5';
  if (c < 0.7) return '0.5-0.7';
  if (c < 0.9) return '0.7-0.9';
  return '0.9-1.0';
}

function inc(map, key) { map[key] = (map[key] || 0) + 1; }

// ─────────────────────────────────────────────────────────────────────────────
// Scenario pool — 200 inputs across categories
// ─────────────────────────────────────────────────────────────────────────────

const SCENARIOS = [
  // ── SEARCH queries (30) ──
  { input: 'najdi restaurace v Praze', cat: 'search' },
  { input: 'hledám autoservis v Brně', cat: 'search' },
  { input: 'kde koupím levné pneumatiky', cat: 'search' },
  { input: 'vyhledej elektrikáře v okolí', cat: 'search' },
  { input: 'porovnej ceny iPhonů', cat: 'search' },
  { input: 'find hotels near airport', cat: 'search' },
  { input: 'search for python tutorials', cat: 'search' },
  { input: 'najdi lety do Barcelony', cat: 'search' },
  { input: 'hledám práci jako programátor', cat: 'search' },
  { input: 'kde se dá koupit Tesla Model 3', cat: 'search' },
  { input: 'vyhledej recenze na Samsung Galaxy', cat: 'search' },
  { input: 'find best coffee shops downtown', cat: 'search' },
  { input: 'hledej kanceláře k pronájmu', cat: 'search' },
  { input: 'najdi lékárnu otevřenou v neděli', cat: 'search' },
  { input: 'where to buy mechanical keyboard', cat: 'search' },
  { input: 'compare wireless headphones under $100', cat: 'search' },
  { input: 'najdi fitness centrum s bazénem', cat: 'search' },
  { input: 'hledám zahradníka na sezónu', cat: 'search' },
  { input: 'vyhledej kurzy angličtiny online', cat: 'search' },
  { input: 'find vegan restaurants near me', cat: 'search' },
  { input: 'kde koupit stavební materiál', cat: 'search' },
  { input: 'search for react developer jobs', cat: 'search' },
  { input: 'najdi veterináře pro kočky', cat: 'search' },
  { input: 'hledej pojištění auta levně', cat: 'search' },
  { input: 'find second hand bookstores', cat: 'search' },
  { input: 'najdi kurz vaření v Praze', cat: 'search' },
  { input: 'kde se dá recyklovat elektroniku', cat: 'search' },
  { input: 'search camping spots near mountains', cat: 'search' },
  { input: 'hledám malíře pokojů', cat: 'search' },
  { input: 'najdi dětského zubaře', cat: 'search' },

  // ── REPORT requests (25) ──
  { input: 'udělej report o trhu s elektromobily', cat: 'report' },
  { input: 'napiš analýzu konkurence', cat: 'report' },
  { input: 'vytvoř přehled trendů v AI', cat: 'report' },
  { input: 'shrň stav českého e-commerce', cat: 'report' },
  { input: 'write a market analysis for SaaS', cat: 'report' },
  { input: 'generate report on renewable energy', cat: 'report' },
  { input: 'udělej srovnání cloud providerů', cat: 'report' },
  { input: 'napiš SWOT analýzu pro startup', cat: 'report' },
  { input: 'vytvoř report o kybernetické bezpečnosti', cat: 'report' },
  { input: 'summarize the state of remote work', cat: 'report' },
  { input: 'prepare industry overview for fintech', cat: 'report' },
  { input: 'napiš přehled o trhu s nemovitostmi', cat: 'report' },
  { input: 'udělej analýzu cenových trendů', cat: 'report' },
  { input: 'write competitive landscape report', cat: 'report' },
  { input: 'vytvoř report o použití AI ve zdravotnictví', cat: 'report' },
  { input: 'napiš přehled o kryptoměnách v 2026', cat: 'report' },
  { input: 'generate quarterly sales analysis', cat: 'report' },
  { input: 'udělej rešerši na téma elektromobilita', cat: 'report' },
  { input: 'prepare a technology radar report', cat: 'report' },
  { input: 'napiš report o stavu trhu práce v IT', cat: 'report' },
  { input: 'create overview of food delivery market', cat: 'report' },
  { input: 'vytvoř analýzu sociálních sítí', cat: 'report' },
  { input: 'write report on supply chain trends', cat: 'report' },
  { input: 'udělej přehled legislativních změn', cat: 'report' },
  { input: 'summarize recent developments in quantum computing', cat: 'report' },

  // ── CONVERSATIONAL (25) ──
  { input: 'ahoj', cat: 'conv' },
  { input: 'díky', cat: 'conv' },
  { input: 'super', cat: 'conv' },
  { input: 'ok', cat: 'conv' },
  { input: 'hello', cat: 'conv' },
  { input: 'thanks', cat: 'conv' },
  { input: 'jak se máš', cat: 'conv' },
  { input: 'co umíš', cat: 'conv' },
  { input: 'kdo jsi', cat: 'conv' },
  { input: 'pomoz mi', cat: 'conv' },
  { input: 'nevím co dál', cat: 'conv' },
  { input: 'to je zajímavé', cat: 'conv' },
  { input: 'a co dál', cat: 'conv' },
  { input: 'rozumím', cat: 'conv' },
  { input: 'how are you', cat: 'conv' },
  { input: 'what can you do', cat: 'conv' },
  { input: 'who are you', cat: 'conv' },
  { input: 'help me', cat: 'conv' },
  { input: 'good job', cat: 'conv' },
  { input: 'that makes sense', cat: 'conv' },
  { input: 'fajn', cat: 'conv' },
  { input: 'paráda', cat: 'conv' },
  { input: 'no a co', cat: 'conv' },
  { input: 'jasně', cat: 'conv' },
  { input: 'hmm', cat: 'conv' },

  // ── FACTUAL (20) ──
  { input: 'kolik je hodin', cat: 'factual' },
  { input: 'jaký je dnes den', cat: 'factual' },
  { input: 'co je hlavní město Francie', cat: 'factual' },
  { input: 'kolik obyvatel má Praha', cat: 'factual' },
  { input: 'what is the speed of light', cat: 'factual' },
  { input: 'who invented the telephone', cat: 'factual' },
  { input: 'what year did WW2 end', cat: 'factual' },
  { input: 'kolik je pi', cat: 'factual' },
  { input: 'jaká je vzdálenost na Měsíc', cat: 'factual' },
  { input: 'co je to DNA', cat: 'factual' },
  { input: 'how many planets in solar system', cat: 'factual' },
  { input: 'what is the boiling point of water', cat: 'factual' },
  { input: 'kdy byl založen Google', cat: 'factual' },
  { input: 'kolik je 7 na druhou', cat: 'factual' },
  { input: 'what is photosynthesis', cat: 'factual' },
  { input: 'jaký je kurz dolaru', cat: 'factual' },
  { input: 'who is the president of USA', cat: 'factual' },
  { input: 'co je blockchain', cat: 'factual' },
  { input: 'how does TCP/IP work', cat: 'factual' },
  { input: 'what is machine learning', cat: 'factual' },

  // ── CODE (20) ──
  { input: 'napiš funkci pro řazení pole', cat: 'code' },
  { input: 'write a function to validate email', cat: 'code' },
  { input: 'vytvoř REST API endpoint', cat: 'code' },
  { input: 'napiš unit test pro login', cat: 'code' },
  { input: 'implement binary search in python', cat: 'code' },
  { input: 'write a react component for modal', cat: 'code' },
  { input: 'napiš SQL query pro top 10 zákazníků', cat: 'code' },
  { input: 'create a dockerfile for node app', cat: 'code' },
  { input: 'write regex for phone numbers', cat: 'code' },
  { input: 'napiš middleware pro autentizaci', cat: 'code' },
  { input: 'implement pagination in express', cat: 'code' },
  { input: 'write a bash script for backup', cat: 'code' },
  { input: 'napiš CSS grid layout', cat: 'code' },
  { input: 'create websocket server in node', cat: 'code' },
  { input: 'write a github actions workflow', cat: 'code' },
  { input: 'napiš parser pro CSV soubor', cat: 'code' },
  { input: 'implement rate limiter middleware', cat: 'code' },
  { input: 'write jest test for api endpoint', cat: 'code' },
  { input: 'create a custom react hook', cat: 'code' },
  { input: 'napiš migration pro databázi', cat: 'code' },

  // ── CREATIVE (15) ──
  { input: 'napiš báseň o programování', cat: 'creative' },
  { input: 'vymysli název pro startup', cat: 'creative' },
  { input: 'write a short story about AI', cat: 'creative' },
  { input: 'navrhni logo pro kavárnu', cat: 'creative' },
  { input: 'vymysli slogan pro fitness', cat: 'creative' },
  { input: 'write a poem about the ocean', cat: 'creative' },
  { input: 'napiš příběh o robotovi', cat: 'creative' },
  { input: 'create a tagline for tech company', cat: 'creative' },
  { input: 'vymysli jméno pro postavu', cat: 'creative' },
  { input: 'write lyrics for a love song', cat: 'creative' },
  { input: 'navrhni menu pro restauraci', cat: 'creative' },
  { input: 'napiš vtip o IT', cat: 'creative' },
  { input: 'create a brand identity concept', cat: 'creative' },
  { input: 'vymysli příběh na dobrou noc', cat: 'creative' },
  { input: 'write a haiku about coding', cat: 'creative' },

  // ── FOLLOW-UP phrases (post-output) (25) ──
  { input: 'co to dělá', cat: 'followup' },
  { input: 'shrň to', cat: 'followup' },
  { input: 'vysvětli to podrobněji', cat: 'followup' },
  { input: 'a co dál', cat: 'followup' },
  { input: 'můžeš to zkrátit', cat: 'followup' },
  { input: 'explain this in detail', cat: 'followup' },
  { input: 'give me more details', cat: 'followup' },
  { input: 'summarize it', cat: 'followup' },
  { input: 'what does it mean', cat: 'followup' },
  { input: 'can you elaborate', cat: 'followup' },
  { input: 'popiš to jinak', cat: 'followup' },
  { input: 'udělej to jako tabulku', cat: 'followup' },
  { input: 'jen první tři', cat: 'followup' },
  { input: 'bez detailů', cat: 'followup' },
  { input: 'pouze názvy', cat: 'followup' },
  { input: 'more examples please', cat: 'followup' },
  { input: 'show me the code', cat: 'followup' },
  { input: 'jake jsou ty soubory', cat: 'followup' },
  { input: 'co je v nich', cat: 'followup' },
  { input: 'udelej prehled', cat: 'followup' },
  { input: 'k cemu to slouzi', cat: 'followup' },
  { input: 'describe it briefly', cat: 'followup' },
  { input: 'what are the pros and cons', cat: 'followup' },
  { input: 'dej mi příklady', cat: 'followup' },
  { input: 'how does this compare', cat: 'followup' },

  // ── TOPIC CHANGES (20) ──
  { input: 'teď najdi restaurace', cat: 'topic_change' },
  { input: 'změň téma na sport', cat: 'topic_change' },
  { input: 'přepni na projekty', cat: 'topic_change' },
  { input: 'now search for hotels', cat: 'topic_change' },
  { input: 'switch to code review', cat: 'topic_change' },
  { input: 'něco úplně jiného', cat: 'topic_change' },
  { input: 'change topic to marketing', cat: 'topic_change' },
  { input: 'dost o tom, hledej auta', cat: 'topic_change' },
  { input: 'stačí, teď potřebuju report', cat: 'topic_change' },
  { input: 'konec, přejdeme na databázi', cat: 'topic_change' },
  { input: 'now find restaurants in Berlin', cat: 'topic_change' },
  { input: 'switch to writing mode', cat: 'topic_change' },
  { input: 'teď chci mluvit o financích', cat: 'topic_change' },
  { input: 'přepni na analýzu dat', cat: 'topic_change' },
  { input: 'change to debugging mode', cat: 'topic_change' },
  { input: 'dost reportů, hledej práci', cat: 'topic_change' },
  { input: 'now help me with CSS', cat: 'topic_change' },
  { input: 'stačí, chci něco jiného', cat: 'topic_change' },
  { input: 'teď potřebuju kód', cat: 'topic_change' },
  { input: 'switch to planning mode', cat: 'topic_change' },

  // ── AMBIGUOUS / EDGE (20) ──
  { input: 'hmm zajímavé', cat: 'ambiguous' },
  { input: 'no nevím', cat: 'ambiguous' },
  { input: 'možná', cat: 'ambiguous' },
  { input: 'interesting', cat: 'ambiguous' },
  { input: 'tell me more', cat: 'ambiguous' },
  { input: 'a', cat: 'ambiguous' },
  { input: '...', cat: 'ambiguous' },
  { input: 'ok ale', cat: 'ambiguous' },
  { input: 'yeah but', cat: 'ambiguous' },
  { input: 'sure', cat: 'ambiguous' },
  { input: 'ne', cat: 'ambiguous' },
  { input: 'yes', cat: 'ambiguous' },
  { input: 'proč', cat: 'ambiguous' },
  { input: 'why', cat: 'ambiguous' },
  { input: 'how', cat: 'ambiguous' },
  { input: 'right', cat: 'ambiguous' },
  { input: 'jo?', cat: 'ambiguous' },
  { input: 'and then', cat: 'ambiguous' },
  { input: 'tak co', cat: 'ambiguous' },
  { input: 'well', cat: 'ambiguous' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Last decision contexts for follow-up testing
// ─────────────────────────────────────────────────────────────────────────────

const LAST_DECISIONS = [
  { intent: IntentType.SEARCH, type: DecisionType.TOOL_CALL, hasOutput: true },
  { intent: IntentType.REPORT, type: DecisionType.TOOL_CALL, hasOutput: true },
  { intent: IntentType.CONVERSATIONAL, type: DecisionType.ANSWER, hasOutput: true },
  { intent: IntentType.CODE, type: DecisionType.ANSWER, hasOutput: true },
  { intent: IntentType.FACTUAL, type: DecisionType.ANSWER, hasOutput: true },
  { intent: IntentType.CREATIVE, type: DecisionType.ANSWER, hasOutput: true },
  null, // no previous turn
];

console.log('══════════════════════════════════════════════════════════');
console.log('  SOAK: Follow-up Load — 200 turns distribution test');
console.log('══════════════════════════════════════════════════════════\n');

const startTime = Date.now();

for (const sc of SCENARIOS) {
  total++;

  // ── classifyIntent ──
  try {
    const intent = engine.classifyIntent(sc.input);
    inc(intentDist, intent);
  } catch (e) {
    crashes++;
    console.log(`  CRASH classifyIntent("${sc.input}"): ${e.message}`);
  }

  // ── detectFollowUpType with random last decision ──
  try {
    const lastDec = LAST_DECISIONS[total % LAST_DECISIONS.length];
    const fu = detectFollowUpType(sc.input, lastDec);
    inc(followUpDist, fu.type);
    inc(ruleDist, fu.rule);
    inc(confidenceBuckets, bucketConf(fu.confidence));
  } catch (e) {
    crashes++;
    console.log(`  CRASH detectFollowUpType("${sc.input}"): ${e.message}`);
  }

  // ── decide (async, may fall back to regex) ──
  try {
    const lastDec = LAST_DECISIONS[total % LAST_DECISIONS.length];
    const decision = await engine.decide(sc.input, {
      lastIntent: lastDec?.intent || null,
      lastDecision: lastDec,
      hasActiveProject: total % 3 === 0,
    });
    inc(decideTypeDist, `${decision.intent}/${decision.type}`);
  } catch (e) {
    // Expected without LLM for AMBIGUOUS — not a crash
    inc(decideTypeDist, `ERROR/${e.message.substring(0, 30)}`);
  }
}

const elapsed = Date.now() - startTime;

// ─────────────────────────────────────────────────────────────────────────────
// Distribution summary
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── Intent Distribution (classifyIntent) ──');
const intentSorted = Object.entries(intentDist).sort((a, b) => b[1] - a[1]);
for (const [k, v] of intentSorted) {
  const pct = ((v / total) * 100).toFixed(1);
  const bar = '█'.repeat(Math.round(v / total * 40));
  console.log(`  ${k.padEnd(16)} ${String(v).padStart(4)}  ${pct.padStart(5)}%  ${bar}`);
}

console.log('\n── Follow-up Type Distribution ──');
const fuSorted = Object.entries(followUpDist).sort((a, b) => b[1] - a[1]);
for (const [k, v] of fuSorted) {
  const pct = ((v / total) * 100).toFixed(1);
  const bar = '█'.repeat(Math.round(v / total * 40));
  console.log(`  ${k.padEnd(16)} ${String(v).padStart(4)}  ${pct.padStart(5)}%  ${bar}`);
}

console.log('\n── Rule Distribution (detectFollowUpType) ──');
const ruleSorted = Object.entries(ruleDist).sort((a, b) => b[1] - a[1]);
for (const [k, v] of ruleSorted) {
  const pct = ((v / total) * 100).toFixed(1);
  console.log(`  ${k.padEnd(24)} ${String(v).padStart(4)}  ${pct.padStart(5)}%`);
}

console.log('\n── Confidence Buckets ──');
for (const [k, v] of Object.entries(confidenceBuckets)) {
  const pct = ((v / total) * 100).toFixed(1);
  console.log(`  ${k.padEnd(10)} ${String(v).padStart(4)}  ${pct.padStart(5)}%`);
}

console.log('\n── decide() Distribution ──');
const decideSorted = Object.entries(decideTypeDist).sort((a, b) => b[1] - a[1]);
for (const [k, v] of decideSorted) {
  console.log(`  ${k.padEnd(36)} ${String(v).padStart(4)}`);
}

console.log('\n══════════════════════════════════════════════════════════');
console.log(`  ${total} turns, ${crashes} crashes, ${elapsed}ms`);
console.log('══════════════════════════════════════════════════════════');

if (crashes > 0) {
  console.log(`\n  ❌ ${crashes} CRASHES — investigate above`);
  process.exit(1);
}
console.log('  ✅ Zero crashes');
process.exit(0);
