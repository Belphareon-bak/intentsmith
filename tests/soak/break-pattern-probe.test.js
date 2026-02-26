#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// Soak Test: Break Pattern Probe — INTENT_BREAK word testing
// ══════════════════════════════════════════════════════════════════════════════
//
// Probes the INTENT_BREAK_PATTERNS boundary. After v73, "chci" was removed.
// This test checks how break-adjacent words interact with sticky intent,
// follow-up detection, and classification.
//
// NOT a pass/fail test. Only asserts no-throw.
//
// Run: node tests/soak/break-pattern-probe.test.js
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
let total = 0;

const intentDist = {};
const followUpDist = {};
const ruleDist = {};
const breakDist = { 'break_blocked': 0, 'sticky_applied': 0, 'no_sticky': 0 };

function inc(m, k) { m[k] = (m[k] || 0) + 1; }

// ─────────────────────────────────────────────────────────────────────────────
// Break-word probes — words that ARE or WERE in INTENT_BREAK_PATTERNS
// ─────────────────────────────────────────────────────────────────────────────

// Current break patterns (v73):
// /^(teď|ted|nyní|nyni)\s/i
// /^(změň|zmen|přepni|prepni)\s/i
// /^(něco|neco)\s(jin|úplně|uplne)/i
// /^(dost|stačí|staci|konec)\s/i
// /^(potřebuju|potrebuju)\s/i          ← "chci" REMOVED in v73
// /^(now|switch|change)\s/i
// /\d+\s*(inzerát|nabíd|produkt|auto)/i

const BREAK_PROBES = [
  // ── "chci" (removed from break) — should NOT break ──
  { input: 'chci výtah', group: 'chci', shouldBreak: false },
  { input: 'chci to zkrátit', group: 'chci', shouldBreak: false },
  { input: 'chci přehled', group: 'chci', shouldBreak: false },
  { input: 'chci víc detailů', group: 'chci', shouldBreak: false },
  { input: 'chci to v tabulce', group: 'chci', shouldBreak: false },
  { input: 'chci najít restaurace', group: 'chci', shouldBreak: false },
  { input: 'chci nový report', group: 'chci', shouldBreak: false },
  { input: 'chci to vysvětlit', group: 'chci', shouldBreak: false },

  // ── "teď/ted" (active break) ──
  { input: 'teď najdi hotely', group: 'ted', shouldBreak: true },
  { input: 'ted hledej práci', group: 'ted', shouldBreak: true },
  { input: 'nyní přepni na kód', group: 'ted', shouldBreak: true },
  { input: 'nyni hledej auta', group: 'ted', shouldBreak: true },

  // ── "změň/přepni" (active break) ──
  { input: 'změň téma na sport', group: 'zmen', shouldBreak: true },
  { input: 'přepni na projekty', group: 'zmen', shouldBreak: true },
  { input: 'přepni na analýzu', group: 'zmen', shouldBreak: true },
  { input: 'změň přístup', group: 'zmen', shouldBreak: true },

  // ── "něco jiného" (active break) ──
  { input: 'něco jiného', group: 'neco', shouldBreak: true },
  { input: 'něco úplně jiného', group: 'neco', shouldBreak: true },
  { input: 'neco jinyho', group: 'neco', shouldBreak: true },

  // ── "dost/stačí/konec" (active break) ──
  { input: 'dost reportů', group: 'dost', shouldBreak: true },
  { input: 'stačí s hledáním', group: 'dost', shouldBreak: true },
  { input: 'konec diskuze', group: 'dost', shouldBreak: true },
  { input: 'dost o tom', group: 'dost', shouldBreak: true },

  // ── "potřebuju" (active break) ──
  { input: 'potřebuju nový projekt', group: 'potrebuju', shouldBreak: true },
  { input: 'potrebuju pomoc s CSS', group: 'potrebuju', shouldBreak: true },

  // ── "now/switch/change" (EN active break) ──
  { input: 'now find restaurants', group: 'now', shouldBreak: true },
  { input: 'now search for hotels', group: 'now', shouldBreak: true },
  { input: 'switch to code review', group: 'now', shouldBreak: true },
  { input: 'switch to planning', group: 'now', shouldBreak: true },
  { input: 'change topic to finance', group: 'now', shouldBreak: true },
  { input: 'change to dark mode', group: 'now', shouldBreak: true },

  // ── Item count patterns (active break) ──
  { input: '5 inzerátů na pronájem', group: 'item', shouldBreak: true },
  { input: '10 nabídek práce', group: 'item', shouldBreak: true },
  { input: '3 produkty pod 1000 Kč', group: 'item', shouldBreak: true },
  { input: '20 aut do 500000', group: 'item', shouldBreak: true },

  // ── Edge cases — NOT break patterns ──
  { input: 'je teď polovina', group: 'edge', shouldBreak: false },
  { input: 'a co teď', group: 'edge', shouldBreak: false },
  { input: 'změní se to', group: 'edge', shouldBreak: false },
  { input: 'something new', group: 'edge', shouldBreak: false },
  { input: 'i need more', group: 'edge', shouldBreak: false },
  { input: 'just now', group: 'edge', shouldBreak: false },
  { input: 'do I need to change', group: 'edge', shouldBreak: false },
  { input: 'enough detail?', group: 'edge', shouldBreak: false },
  { input: 'what changed', group: 'edge', shouldBreak: false },
  { input: 'ted cruz biography', group: 'edge', shouldBreak: false },
];

// Sticky intent contexts — test if break patterns block sticky upgrade
const STICKY_CONTEXTS = [
  { lastIntent: IntentType.SEARCH, label: 'after SEARCH' },
  { lastIntent: IntentType.REPORT, label: 'after REPORT' },
  { lastIntent: IntentType.FACTUAL, label: 'after FACTUAL' },
  { lastIntent: IntentType.ITEM_LOOKUP, label: 'after ITEM_LOOKUP' },
];

console.log('══════════════════════════════════════════════════════════');
console.log('  SOAK: Break Pattern Probe — INTENT_BREAK testing');
console.log('══════════════════════════════════════════════════════════\n');

const startTime = Date.now();
const groupDist = {};
const breakResults = [];

for (const probe of BREAK_PROBES) {
  total++;
  inc(groupDist, probe.group);

  // ── classifyIntent ──
  try {
    const intent = engine.classifyIntent(probe.input);
    inc(intentDist, intent);
  } catch (e) {
    crashes++;
    console.log(`  CRASH ci("${probe.input}"): ${e.message}`);
  }

  // ── detectFollowUpType with SEARCH context ──
  try {
    const fu = detectFollowUpType(probe.input, {
      intent: IntentType.SEARCH,
      type: DecisionType.TOOL_CALL,
      hasOutput: true,
    });
    inc(followUpDist, fu.type);
    inc(ruleDist, fu.rule);
  } catch (e) {
    crashes++;
    console.log(`  CRASH dfu("${probe.input}"): ${e.message}`);
  }

  // ── decide with each sticky context — detect break vs sticky ──
  for (const sctx of STICKY_CONTEXTS) {
    try {
      const d = await engine.decide(probe.input, {
        lastIntent: sctx.lastIntent,
        lastDecision: {
          intent: sctx.lastIntent,
          type: DecisionType.TOOL_CALL,
          hasOutput: true,
        },
      });

      // Track: did sticky apply or was it blocked?
      const wasSticky = d.intent === sctx.lastIntent && d.intent !== IntentType.AMBIGUOUS;
      const wasBlocked = d.intent !== sctx.lastIntent;

      breakResults.push({
        input: probe.input,
        group: probe.group,
        stickyCtx: sctx.label,
        result: d.intent,
        type: d.type,
        sticky: wasSticky,
        blocked: wasBlocked,
      });
    } catch (e) {
      // Expected for some AMBIGUOUS cases without LLM
    }
  }
}

const elapsed = Date.now() - startTime;

// ─────────────────────────────────────────────────────────────────────────────
// Distribution summary
// ─────────────────────────────────────────────────────────────────────────────

console.log('── Probe Group Distribution ──');
for (const [k, v] of Object.entries(groupDist)) {
  console.log(`  ${k.padEnd(16)} ${String(v).padStart(3)}`);
}

console.log('\n── Intent Distribution (classifyIntent) ──');
const iSorted = Object.entries(intentDist).sort((a, b) => b[1] - a[1]);
for (const [k, v] of iSorted) {
  const pct = ((v / total) * 100).toFixed(1);
  console.log(`  ${k.padEnd(16)} ${String(v).padStart(3)}  ${pct.padStart(5)}%`);
}

console.log('\n── Follow-up Rule Distribution ──');
const rSorted = Object.entries(ruleDist).sort((a, b) => b[1] - a[1]);
for (const [k, v] of rSorted) {
  const pct = ((v / total) * 100).toFixed(1);
  console.log(`  ${k.padEnd(24)} ${String(v).padStart(3)}  ${pct.padStart(5)}%`);
}

// Break/sticky analysis by group
console.log('\n── Break vs Sticky by Group (decide output) ──');
const groupBreakStats = {};
for (const r of breakResults) {
  if (!groupBreakStats[r.group]) groupBreakStats[r.group] = { sticky: 0, blocked: 0, total: 0 };
  groupBreakStats[r.group].total++;
  if (r.sticky) groupBreakStats[r.group].sticky++;
  if (r.blocked) groupBreakStats[r.group].blocked++;
}
for (const [group, stats] of Object.entries(groupBreakStats)) {
  const stickyPct = ((stats.sticky / stats.total) * 100).toFixed(0);
  const blockedPct = ((stats.blocked / stats.total) * 100).toFixed(0);
  console.log(`  ${group.padEnd(16)} sticky: ${stickyPct.padStart(3)}%  blocked: ${blockedPct.padStart(3)}%  (n=${stats.total})`);
}

// "chci" focus — was sticky preserved?
console.log('\n── "chci" probes detail (was sticky preserved after removal?) ──');
const chciResults = breakResults.filter(r => r.group === 'chci');
for (const r of chciResults) {
  console.log(`  "${r.input}" + ${r.stickyCtx} → ${r.result}/${r.type} (sticky: ${r.sticky})`);
}

console.log('\n══════════════════════════════════════════════════════════');
console.log(`  ${total} probes × ${STICKY_CONTEXTS.length} contexts, ${crashes} crashes, ${elapsed}ms`);
console.log('══════════════════════════════════════════════════════════');

if (crashes > 0) {
  console.log(`\n  ❌ ${crashes} CRASHES — investigate above`);
  process.exit(1);
}
console.log('  ✅ Zero crashes');
process.exit(0);
