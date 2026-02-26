#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// Soak Test: Mixed Session Simulation — 20 realistic conversations
// ══════════════════════════════════════════════════════════════════════════════
//
// Simulates 20 multi-turn conversations (5-10 turns each).
// Carries lastDecision forward between turns to test real conversation flow.
//
// NOT a pass/fail test. Only asserts no-throw.
//
// Run: node tests/soak/mixed-session-simulation.test.js
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
let crashes = 0;
let totalTurns = 0;

const intentDist = {};
const followUpDist = {};
const ruleDist = {};
const transitionDist = {}; // "SEARCH→REPORT", "CONV→SEARCH" etc.
const turnPositionDist = {}; // turn 1, 2, 3... distribution

function inc(m, k) { m[k] = (m[k] || 0) + 1; }

// ─────────────────────────────────────────────────────────────────────────────
// 20 Conversation templates — realistic multi-turn flows
// ─────────────────────────────────────────────────────────────────────────────

const CONVERSATIONS = [
  {
    name: 'S01: Search → follow-ups → topic change',
    turns: [
      'najdi restaurace v Praze',
      'kolik jich je',
      'ukaž jen ty s vegetariánským menu',
      'a co ceny',
      'shrň to do tabulky',
      'díky, teď hledej hotely',
    ],
  },
  {
    name: 'S02: Report → refinements',
    turns: [
      'udělej report o trhu s AI',
      'přidej víc dat o Evropě',
      'zkrať to na jednu stránku',
      'jen klíčové závěry',
      'přidej graf trendů',
    ],
  },
  {
    name: 'S03: Attachment → analysis → follow-up',
    turns: [
      'ahoj, mám soubor k analýze',
      'co to dělá',
      'vysvětli tu hlavní funkci',
      'jsou tam nějaké bugy',
      'optimalizuj to',
      'přepiš to do TypeScriptu',
      'díky',
    ],
  },
  {
    name: 'S04: Code → explain → modify',
    turns: [
      'napiš funkci pro validaci emailu',
      'přidej i validaci telefonu',
      'a co regex pro PSČ',
      'spoj to do jednoho modulu',
      'přidej testy',
    ],
  },
  {
    name: 'S05: Greeting → search → report',
    turns: [
      'ahoj',
      'co umíš',
      'najdi kurzy programování online',
      'kolik stojí',
      'udělej srovnání top 5',
      'shrň to',
    ],
  },
  {
    name: 'S06: Factual → deep dive → creative',
    turns: [
      'co je machine learning',
      'jaký je rozdíl mezi ML a AI',
      'uveď příklady použití',
      'napiš o tom báseň',
      'a teď vtip',
    ],
  },
  {
    name: 'S07: Project workflow',
    turns: [
      'otevři projekt c3-agent',
      'jaká je struktura',
      'najdi všechny testy',
      'spusť test suite',
      'kolik prošlo',
      'ukaž detaily selhání',
      'oprav ten první bug',
    ],
  },
  {
    name: 'S08: Multi-topic session',
    turns: [
      'hledej letenky do Londýna',
      'kolik stojí',
      'teď najdi hotely',
      'srovnej ceny',
      'a co počasí',
      'změň téma na restaurace',
      'shrň celý trip',
    ],
  },
  {
    name: 'S09: EN code review',
    turns: [
      'review this function',
      'what does it do',
      'any security issues',
      'how to fix them',
      'show me the fixed version',
      'add error handling',
    ],
  },
  {
    name: 'S10: Short bursts',
    turns: [
      'hledej',
      'ne takhle',
      'restaurace',
      'v Praze',
      'levné',
      'ukaž to',
      'díky',
      'konec',
    ],
  },
  {
    name: 'S11: Conversational → technical',
    turns: [
      'ahoj jak se máš',
      'potřebuju pomoct s kódem',
      'mám React komponentu',
      'nefunguje state management',
      'ukaž mi příklad s useReducer',
      'to je moc složité',
      'zjednodušil to',
    ],
  },
  {
    name: 'S12: Report → deep analysis',
    turns: [
      'napiš analýzu konkurence pro fintech startup',
      'přidej SWOT',
      'víc o hrozbách',
      'jaké jsou příležitosti v CEE regionu',
      'shrň to do executive summary',
    ],
  },
  {
    name: 'S13: Search → item lookup',
    turns: [
      'hledej elektromobily pod 1 milion',
      '5 nejlepších modelů',
      'porovnej Tesla vs Hyundai',
      'kde je nejlevnější',
      'jaký má dojezd',
      'shrň to',
    ],
  },
  {
    name: 'S14: Creative session',
    turns: [
      'vymysli název pro kavárnu',
      'něco víc originálního',
      'a co slogan',
      'napiš popis pro web',
      'přidej menu návrh',
      'super, ještě vizitku',
    ],
  },
  {
    name: 'S15: Debug session',
    turns: [
      'mám bug v aplikaci',
      'TypeError: cannot read property of undefined',
      'ukaž mi stack trace handling',
      'kde je problém',
      'jak to opravit',
      'otestuj to',
      'funguje to',
    ],
  },
  {
    name: 'S16: EN research flow',
    turns: [
      'search for quantum computing papers 2026',
      'summarize the top results',
      'what are the key findings',
      'compare with 2025',
      'create a timeline',
      'add references',
    ],
  },
  {
    name: 'S17: Mixed language',
    turns: [
      'find restaurants in Prague',
      'kolik jich je',
      'show me the best ones',
      'ukaž recenze',
      'which one has vegan options',
      'objednej stůl',
    ],
  },
  {
    name: 'S18: Abandon and restart',
    turns: [
      'hledej hotely v Berlíně',
      'ne, vlastně v Mnichově',
      'stačí, něco jiného',
      'napiš report o trhu s nemovitostmi',
      'dost, zpět k hotelům',
      'hledej hotely v Praze',
    ],
  },
  {
    name: 'S19: Rapid follow-ups',
    turns: [
      'co je to kubernetes',
      'k čemu to je',
      'jak to funguje',
      'příklady',
      'výhody',
      'nevýhody',
      'alternativy',
      'srovnání',
      'shrň to',
      'díky',
    ],
  },
  {
    name: 'S20: File analysis pipeline',
    turns: [
      'analyzuj soubor server.js',
      'jaká je architektura',
      'najdi bezpečnostní problémy',
      'kolik má endpointů',
      'vypiš je v tabulce',
      'přidej autentizaci',
      'napiš testy',
      'udělej code review',
    ],
  },
];

console.log('══════════════════════════════════════════════════════════');
console.log('  SOAK: Mixed Session Simulation — 20 conversations');
console.log('══════════════════════════════════════════════════════════\n');

const startTime = Date.now();
const sessionSummaries = [];

for (const conv of CONVERSATIONS) {
  let lastDecision = null;
  let lastIntent = null;
  let turnNum = 0;
  const sessionIntents = [];

  for (const input of conv.turns) {
    totalTurns++;
    turnNum++;
    inc(turnPositionDist, `turn_${turnNum}`);

    // ── classifyIntent ──
    let classifiedIntent = null;
    try {
      classifiedIntent = engine.classifyIntent(input);
      inc(intentDist, classifiedIntent);
    } catch (e) {
      crashes++;
      console.log(`  CRASH ci("${input}") in ${conv.name}: ${e.message}`);
    }

    // ── detectFollowUpType ──
    try {
      const fu = detectFollowUpType(input, lastDecision);
      inc(followUpDist, fu.type);
      inc(ruleDist, fu.rule);
    } catch (e) {
      crashes++;
      console.log(`  CRASH dfu("${input}") in ${conv.name}: ${e.message}`);
    }

    // ── decide (carries forward lastDecision) ──
    try {
      const decision = await engine.decide(input, {
        lastIntent,
        lastDecision,
        hasActiveProject: conv.name.includes('Project') || conv.name.includes('File'),
      });

      // Track transition
      if (lastIntent) {
        inc(transitionDist, `${lastIntent}→${decision.intent}`);
      }

      sessionIntents.push(decision.intent);

      // Update state for next turn
      lastDecision = {
        intent: decision.intent,
        type: decision.type,
        hasOutput: true,
        tools: decision.tools,
        confidence: decision.confidence,
      };
      lastIntent = decision.intent;
    } catch (e) {
      // Keep last state on error (expected for AMBIGUOUS without LLM)
      sessionIntents.push('ERROR');
    }
  }

  sessionSummaries.push({
    name: conv.name,
    turns: turnNum,
    intents: sessionIntents,
  });
}

const elapsed = Date.now() - startTime;

// ─────────────────────────────────────────────────────────────────────────────
// Distribution summary
// ─────────────────────────────────────────────────────────────────────────────

console.log('── Session Summaries ──');
for (const s of sessionSummaries) {
  const flow = s.intents.map(i => i.substring(0, 4)).join('→');
  console.log(`  ${s.name}`);
  console.log(`    ${s.turns} turns: ${flow}`);
}

console.log('\n── Turn Position Distribution ──');
const tpSorted = Object.entries(turnPositionDist).sort((a, b) => {
  const na = parseInt(a[0].split('_')[1]);
  const nb = parseInt(b[0].split('_')[1]);
  return na - nb;
});
for (const [k, v] of tpSorted) {
  const bar = '█'.repeat(v);
  console.log(`  ${k.padEnd(10)} ${String(v).padStart(3)}  ${bar}`);
}

console.log('\n── Intent Distribution (classifyIntent) ──');
const iSorted = Object.entries(intentDist).sort((a, b) => b[1] - a[1]);
for (const [k, v] of iSorted) {
  const pct = ((v / totalTurns) * 100).toFixed(1);
  const bar = '█'.repeat(Math.round(v / totalTurns * 30));
  console.log(`  ${k.padEnd(16)} ${String(v).padStart(3)}  ${pct.padStart(5)}%  ${bar}`);
}

console.log('\n── Follow-up Type Distribution ──');
const fSorted = Object.entries(followUpDist).sort((a, b) => b[1] - a[1]);
for (const [k, v] of fSorted) {
  const pct = ((v / totalTurns) * 100).toFixed(1);
  const bar = '█'.repeat(Math.round(v / totalTurns * 30));
  console.log(`  ${k.padEnd(16)} ${String(v).padStart(3)}  ${pct.padStart(5)}%  ${bar}`);
}

console.log('\n── Rule Distribution ──');
const rSorted = Object.entries(ruleDist).sort((a, b) => b[1] - a[1]);
for (const [k, v] of rSorted) {
  const pct = ((v / totalTurns) * 100).toFixed(1);
  console.log(`  ${k.padEnd(24)} ${String(v).padStart(3)}  ${pct.padStart(5)}%`);
}

console.log('\n── Intent Transitions (top 20) ──');
const trSorted = Object.entries(transitionDist).sort((a, b) => b[1] - a[1]).slice(0, 20);
for (const [k, v] of trSorted) {
  console.log(`  ${k.padEnd(32)} ${String(v).padStart(3)}`);
}

console.log('\n══════════════════════════════════════════════════════════');
console.log(`  ${CONVERSATIONS.length} sessions, ${totalTurns} total turns, ${crashes} crashes, ${elapsed}ms`);
console.log('══════════════════════════════════════════════════════════');

if (crashes > 0) {
  console.log(`\n  ❌ ${crashes} CRASHES — investigate above`);
  process.exit(1);
}
console.log('  ✅ Zero crashes');
process.exit(0);
