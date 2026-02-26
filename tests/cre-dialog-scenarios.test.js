#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// CRE Real Dialog Scenarios — Follow-up Classification Diagnostic
// ══════════════════════════════════════════════════════════════════════════════
//
// 25 realistic multi-turn dialog scenarios that simulate actual user sessions.
// Each scenario has:
//   - A realistic lastInput (what user said in previous turn)
//   - A lastDecision (what CRE decided for the previous turn)
//   - A lastIntent (previous turn's intent)
//   - The current follow-up input
//   - Expected behavior for each layer
//
// This test DOES NOT assert pass/fail — it produces a diagnostic matrix
// showing WHERE each scenario fails (which layer blocks correct behavior).
//
// Layers tested:
//   L1: classifyIntent() — regex/deterministic classification
//   L2: detectFollowUpType() — follow-up detection
//   L3: decide() — full pipeline with LLM + overrides
//
// Run: node tests/cre-dialog-scenarios.test.js
// ══════════════════════════════════════════════════════════════════════════════

import {
  CREDecisionEngine,
  IntentType,
  DecisionType,
} from '../src/chat/cre-decision.js';

import { detectFollowUpType } from '../src/chat/handlers/utils/followup.js';

const engine = new CREDecisionEngine();

// ─────────────────────────────────────────────────────────────────────────────
// Scenario definitions
// ─────────────────────────────────────────────────────────────────────────────

const scenarios = [

  // ═════════════════════════════════════════════════════════════════════════
  // Category A: File attachment follow-ups (CZ)
  // User attached a file, got a response, now asks about it
  // ═════════════════════════════════════════════════════════════════════════

  {
    id: 'A1',
    category: 'attachment-followup',
    desc: 'CZ: "co to dela" after file attachment',
    lastInput: 'co je v prilozenem souboru?\n📎 index.js',
    lastIntent: IntentType.CONVERSATIONAL,
    lastDecisionType: DecisionType.ANSWER,
    input: 'co to dela',
    expected: { notAmbiguous: true, notNewQuery: true, notAskUser: true },
  },
  {
    id: 'A2',
    category: 'attachment-followup',
    desc: 'CZ: "shrn to" after file attachment',
    lastInput: 'podivej se na tohle\n📎 server.js',
    lastIntent: IntentType.CONVERSATIONAL,
    lastDecisionType: DecisionType.ANSWER,
    input: 'shrn to',
    expected: { notAmbiguous: true, notNewQuery: true, notAskUser: true },
  },
  {
    id: 'A3',
    category: 'attachment-followup',
    desc: 'CZ: "chci nejaky vytah k cemu jsou" after multi-file attachment',
    lastInput: 'co je v souboru?\n📎 index.js, package-lock.json',
    lastIntent: IntentType.CONVERSATIONAL,
    lastDecisionType: DecisionType.ANSWER,
    input: 'chci nejaky vytah k cemu jsou',
    expected: { notAmbiguous: true, notNewQuery: true, notAskUser: true },
  },
  {
    id: 'A4',
    category: 'attachment-followup',
    desc: 'CZ: "vysvetli mi to" after attachment',
    lastInput: 'zkontroluj tohle\n📎 utils.py',
    lastIntent: IntentType.CONVERSATIONAL,
    lastDecisionType: DecisionType.ANSWER,
    input: 'vysvetli mi to',
    expected: { notAmbiguous: true, notNewQuery: true, notAskUser: true },
  },
  {
    id: 'A5',
    category: 'attachment-followup',
    desc: 'CZ: "k cemu to slouzi" after attachment',
    lastInput: 'analyzuj\n📎 config.yaml',
    lastIntent: IntentType.CONVERSATIONAL,
    lastDecisionType: DecisionType.ANSWER,
    input: 'k cemu to slouzi',
    expected: { notAmbiguous: true, notNewQuery: true, notAskUser: true },
  },
  {
    id: 'A6',
    category: 'attachment-followup',
    desc: 'CZ: "udelej prehled" after attachment',
    lastInput: 'tohle jsem napsal\n📎 main.go',
    lastIntent: IntentType.CONVERSATIONAL,
    lastDecisionType: DecisionType.ANSWER,
    input: 'udelej prehled',
    expected: { notAmbiguous: true, notNewQuery: true, notAskUser: true },
  },

  // ═════════════════════════════════════════════════════════════════════════
  // Category B: File attachment follow-ups (EN)
  // ═════════════════════════════════════════════════════════════════════════

  {
    id: 'B1',
    category: 'attachment-followup-en',
    desc: 'EN: "what does it do" after file attachment',
    lastInput: 'check this out\n📎 app.tsx',
    lastIntent: IntentType.CONVERSATIONAL,
    lastDecisionType: DecisionType.ANSWER,
    input: 'what does it do',
    expected: { notAmbiguous: true, notNewQuery: true, notAskUser: true },
  },
  {
    id: 'B2',
    category: 'attachment-followup-en',
    desc: 'EN: "summarize this" after attachment',
    lastInput: 'look at this file\n📎 README.md',
    lastIntent: IntentType.CONVERSATIONAL,
    lastDecisionType: DecisionType.ANSWER,
    input: 'summarize this',
    expected: { notAmbiguous: true, notNewQuery: true, notAskUser: true },
  },
  {
    id: 'B3',
    category: 'attachment-followup-en',
    desc: 'EN: "explain the code" after attachment',
    lastInput: 'I wrote this\n📎 handler.py',
    lastIntent: IntentType.CONVERSATIONAL,
    lastDecisionType: DecisionType.ANSWER,
    input: 'explain the code',
    expected: { notAmbiguous: true, notNewQuery: true, notAskUser: true },
  },

  // ═════════════════════════════════════════════════════════════════════════
  // Category C: Project context follow-ups
  // User is in an active project and asks about it
  // ═════════════════════════════════════════════════════════════════════════

  {
    id: 'C1',
    category: 'project-followup',
    desc: 'CZ: "co to dela" after project analysis',
    lastInput: 'analyzuj tento projekt',
    lastIntent: 'PROJECT',
    lastDecisionType: DecisionType.TOOL_CALL,
    input: 'co to dela',
    expected: { notAmbiguous: true, notNewQuery: true, notAskUser: true },
  },
  {
    id: 'C2',
    category: 'project-followup',
    desc: 'CZ: "jake jsou ty soubory" in project',
    lastInput: 'projdi strukturu projektu',
    lastIntent: 'PROJECT',
    lastDecisionType: DecisionType.TOOL_CALL,
    input: 'jake jsou ty soubory',
    expected: { notAmbiguous: true, notNewQuery: true, notAskUser: true },
  },
  {
    id: 'C3',
    category: 'project-followup',
    desc: 'CZ: "udelej prehled" after project context',
    lastInput: 'otevri projekt localai-proxy',
    lastIntent: 'PROJECT',
    lastDecisionType: DecisionType.TOOL_CALL,
    input: 'udelej prehled',
    expected: { notAmbiguous: true, notNewQuery: true, notAskUser: true },
  },

  // ═════════════════════════════════════════════════════════════════════════
  // Category D: REPORT/SEARCH continuation follow-ups
  // User got a search/report result, asks follow-up
  // ═════════════════════════════════════════════════════════════════════════

  {
    id: 'D1',
    category: 'report-continuation',
    desc: 'CZ: "a co jeste" after REPORT',
    lastInput: 'udelej mi report o AI trendech',
    lastIntent: IntentType.REPORT,
    lastDecisionType: DecisionType.TOOL_CALL,
    input: 'a co jeste',
    expected: { notAmbiguous: true, notNewQuery: true, notAskUser: true },
  },
  {
    id: 'D2',
    category: 'report-continuation',
    desc: 'CZ: "shrn to" after REPORT (format change)',
    lastInput: 'hledej informace o kryptomenach',
    lastIntent: IntentType.REPORT,
    lastDecisionType: DecisionType.TOOL_CALL,
    input: 'shrn to',
    expected: { notAmbiguous: true, notNewQuery: true, notAskUser: true },
  },
  {
    id: 'D3',
    category: 'report-continuation',
    desc: 'CZ: "vice detailu" after SEARCH',
    lastInput: 'najdi nejlepsi restaurace v Praze',
    lastIntent: IntentType.SEARCH,
    lastDecisionType: DecisionType.TOOL_CALL,
    input: 'vice detailu',
    expected: { notAmbiguous: true, notNewQuery: true, notAskUser: true },
  },
  {
    id: 'D4',
    category: 'report-continuation',
    desc: 'EN: "tell me more" after SEARCH',
    lastInput: 'search for electric cars comparison',
    lastIntent: IntentType.SEARCH,
    lastDecisionType: DecisionType.TOOL_CALL,
    input: 'tell me more',
    expected: { notAmbiguous: true, notNewQuery: true, notAskUser: true },
  },

  // ═════════════════════════════════════════════════════════════════════════
  // Category E: Topic change (should be NEW_QUERY)
  // User intentionally changes topic — system should detect this
  // ═════════════════════════════════════════════════════════════════════════

  {
    id: 'E1',
    category: 'topic-change',
    desc: 'CZ: topic change from REPORT to new question',
    lastInput: 'udelej mi report o AI trendech',
    lastIntent: IntentType.REPORT,
    lastDecisionType: DecisionType.TOOL_CALL,
    input: 'kolik je hodin',
    expected: { shouldBeLocal: true, shouldBeNewQuery: true },
  },
  {
    id: 'E2',
    category: 'topic-change',
    desc: 'CZ: topic change from attachment to web search',
    lastInput: 'analyzuj\n📎 index.js',
    lastIntent: IntentType.CONVERSATIONAL,
    lastDecisionType: DecisionType.ANSWER,
    input: 'jake je dnes pocasi v Praze',
    expected: { shouldBeSearch: true, shouldBeNewQuery: true },
  },
  {
    id: 'E3',
    category: 'topic-change',
    desc: 'EN: topic change "now find restaurants"',
    lastInput: 'explain the code\n📎 app.js',
    lastIntent: IntentType.CONVERSATIONAL,
    lastDecisionType: DecisionType.ANSWER,
    input: 'now find italian restaurants near me',
    expected: { shouldBeSearch: true, shouldBeNewQuery: true },
  },

  // ═════════════════════════════════════════════════════════════════════════
  // Category F: INTENT_BREAK edge cases
  // "chci" is currently a break pattern — tests if it blocks valid follow-ups
  // ═════════════════════════════════════════════════════════════════════════

  {
    id: 'F1',
    category: 'intent-break-edge',
    desc: 'CZ: "chci vytah" after REPORT — break blocks valid follow-up',
    lastInput: 'udelej analyzu kodu',
    lastIntent: IntentType.REPORT,
    lastDecisionType: DecisionType.TOOL_CALL,
    input: 'chci nejaky vytah k cemu jsou',
    expected: { notAmbiguous: true, notAskUser: true, intentBreakFalsePositive: true },
  },
  {
    id: 'F2',
    category: 'intent-break-edge',
    desc: 'CZ: "chci to kratsi" after REPORT — valid format change but break fires',
    lastInput: 'udelej analyzu trhu',
    lastIntent: IntentType.REPORT,
    lastDecisionType: DecisionType.TOOL_CALL,
    input: 'chci to kratsi',
    expected: { notAmbiguous: true, notAskUser: true, intentBreakFalsePositive: true },
  },

  // ═════════════════════════════════════════════════════════════════════════
  // Category G: CONTINUATION threshold edge cases
  // Short inputs with pronouns that should be continuation
  // ═════════════════════════════════════════════════════════════════════════

  {
    id: 'G1',
    category: 'continuation-threshold',
    desc: 'CZ: "co to dela" — short + pronoun but lastIntent=CONVERSATIONAL blocks',
    lastInput: 'podivej se na tohle\n📎 app.js',
    lastIntent: IntentType.CONVERSATIONAL,
    lastDecisionType: DecisionType.ANSWER,
    input: 'co to dela',
    expected: { notAmbiguous: true, notNewQuery: true, continuationBlocked: true },
  },
  {
    id: 'G2',
    category: 'continuation-threshold',
    desc: 'CZ: "shrn to" — short + pronoun but lastIntent=CONVERSATIONAL blocks',
    lastInput: 'analyzuj tohle\n📎 data.csv',
    lastIntent: IntentType.CONVERSATIONAL,
    lastDecisionType: DecisionType.ANSWER,
    input: 'shrn to',
    expected: { notAmbiguous: true, notNewQuery: true, continuationBlocked: true },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Run all scenarios
// ─────────────────────────────────────────────────────────────────────────────

console.log('══════════════════════════════════════════════════════════════════════');
console.log('  CRE Real Dialog Scenarios — Follow-up Classification Diagnostic');
console.log('══════════════════════════════════════════════════════════════════════\n');

// Counters per layer per category
const layerStats = {
  L1_classifyIntent: { pass: 0, fail: 0, details: [] },
  L2_detectFollowUp: { pass: 0, fail: 0, details: [] },
  L3_decide: { pass: 0, fail: 0, details: [] },
};

const categoryStats = {};

for (const sc of scenarios) {
  const cat = sc.category;
  if (!categoryStats[cat]) categoryStats[cat] = { pass: 0, fail: 0, scenarios: [] };

  console.log(`── ${sc.id}: ${sc.desc}`);
  console.log(`   lastInput: "${sc.lastInput.substring(0, 50)}..."`);
  console.log(`   lastIntent: ${sc.lastIntent}, input: "${sc.input}"`);

  const failures = [];

  // ─── L1: classifyIntent ─────────────────────────────────────────────
  const classifiedIntent = engine.classifyIntent(sc.input);
  const l1ok = sc.expected.notAmbiguous
    ? classifiedIntent !== IntentType.AMBIGUOUS
    : (sc.expected.shouldBeLocal
      ? classifiedIntent === IntentType.LOCAL
      : (sc.expected.shouldBeSearch
        ? classifiedIntent === IntentType.SEARCH
        : true));

  console.log(`   L1 classifyIntent: ${classifiedIntent} ${l1ok ? '✅' : '❌'}`);
  if (l1ok) { layerStats.L1_classifyIntent.pass++; }
  else {
    layerStats.L1_classifyIntent.fail++;
    layerStats.L1_classifyIntent.details.push(`${sc.id}: got ${classifiedIntent}`);
    failures.push('L1');
  }

  // ─── L2: detectFollowUpType (v73: context-oriented) ────────────────
  const followUp = detectFollowUpType(sc.input, {
    intent: sc.lastIntent, type: sc.lastDecisionType, hasOutput: true,
  });

  const l2ok = sc.expected.notNewQuery
    ? followUp.type !== 'NEW_QUERY'
    : (sc.expected.shouldBeNewQuery
      ? followUp.type === 'NEW_QUERY'
      : true);

  console.log(`   L2 detectFollowUp: ${followUp.type} (conf: ${followUp.confidence}, rule: ${followUp.rule || '-'}) ${l2ok ? '✅' : '❌'}`);
  if (l2ok) { layerStats.L2_detectFollowUp.pass++; }
  else {
    layerStats.L2_detectFollowUp.fail++;
    layerStats.L2_detectFollowUp.details.push(`${sc.id}: got ${followUp.type}`);
    failures.push('L2');
  }

  // ─── L3: decide() ──────────────────────────────────────────────────
  try {
    const decision = await engine.decide(sc.input, {
      hasActiveProject: sc.lastIntent === 'PROJECT',
      lastIntent: sc.lastIntent,
      lastDecision: { intent: sc.lastIntent, type: sc.lastDecisionType },
      lastUserInput: sc.lastInput,
    });

    const l3ok = sc.expected.notAskUser
      ? !(decision.type === DecisionType.ASK_USER && decision.slots?.includes('intent_clarification'))
      : (sc.expected.shouldBeLocal
        ? decision.intent === IntentType.LOCAL
        : (sc.expected.shouldBeSearch
          ? (decision.intent === IntentType.SEARCH || decision.intent === IntentType.FACTUAL)
          : true));

    console.log(`   L3 decide: ${decision.type}/${decision.intent} (slots: ${JSON.stringify(decision.slots || [])}) ${l3ok ? '✅' : '❌'}`);
    if (l3ok) { layerStats.L3_decide.pass++; }
    else {
      layerStats.L3_decide.fail++;
      layerStats.L3_decide.details.push(`${sc.id}: got ${decision.type}/${decision.intent}`);
      failures.push('L3');
    }
  } catch (e) {
    console.log(`   L3 decide: ⚠️ ${e.message}`);
    layerStats.L3_decide.fail++;
    layerStats.L3_decide.details.push(`${sc.id}: threw ${e.message}`);
    failures.push('L3');
  }

  // ─── Category tracking ─────────────────────────────────────────────
  if (failures.length === 0) {
    categoryStats[cat].pass++;
  } else {
    categoryStats[cat].fail++;
  }
  categoryStats[cat].scenarios.push({
    id: sc.id,
    failures,
  });

  console.log('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

console.log('══════════════════════════════════════════════════════════════════════');
console.log('  LAYER SUMMARY');
console.log('══════════════════════════════════════════════════════════════════════');

for (const [layer, stats] of Object.entries(layerStats)) {
  const total = stats.pass + stats.fail;
  const pct = total > 0 ? Math.round(stats.pass / total * 100) : 0;
  const icon = stats.fail === 0 ? '✅' : '❌';
  console.log(`  ${icon} ${layer}: ${stats.pass}/${total} (${pct}%)`);
  if (stats.details.length > 0) {
    for (const d of stats.details) {
      console.log(`     ↳ ${d}`);
    }
  }
}

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log('  CATEGORY SUMMARY');
console.log('══════════════════════════════════════════════════════════════════════');

for (const [cat, stats] of Object.entries(categoryStats)) {
  const total = stats.pass + stats.fail;
  const icon = stats.fail === 0 ? '✅' : '❌';
  console.log(`  ${icon} ${cat}: ${stats.pass}/${total}`);
  for (const sc of stats.scenarios) {
    if (sc.failures.length > 0) {
      console.log(`     ↳ ${sc.id} failed at: ${sc.failures.join(', ')}`);
    }
  }
}

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log('  FAILURE DISTRIBUTION (% per layer of total failures)');
console.log('══════════════════════════════════════════════════════════════════════');

const totalFailures = Object.values(layerStats).reduce((s, l) => s + l.fail, 0);
if (totalFailures > 0) {
  for (const [layer, stats] of Object.entries(layerStats)) {
    const pct = Math.round(stats.fail / totalFailures * 100);
    const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
    console.log(`  ${layer}: ${bar} ${pct}% (${stats.fail} failures)`);
  }
} else {
  console.log('  No failures! 🎉');
}

console.log('');

// Exit with error code if any non-topic-change scenario has L3 failures
const hasRealFailures = scenarios.some(sc =>
  sc.expected.notAskUser &&
  categoryStats[sc.category]?.scenarios.find(s => s.id === sc.id)?.failures.includes('L3')
);
process.exit(hasRealFailures ? 1 : 0);
