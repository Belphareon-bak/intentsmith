#!/usr/bin/env node
// Capability #2 — CRE: model-profile behaviour acceptance
// ══════════════════════════════════════════════════════════════════════════════
//
// CONTRACT.md §3 step 3, for the behaviours in docs/behaviours/02-cre.md that
// cannot be observed without a model. The rest are in
// tests/capability-02-cre-behaviours.test.js.
//
// PREREQUISITE (CONTRACT.md §5): a reachable Ollama serving config.models.FAST
// or config.models.CHAT. Without it this suite exits BLOCKED — never green.
//
// One behaviour, one assertion. A model that classifies wrongly is a FAIL, not
// variance to be averaged away: CONTRACT.md §5 forbids hiding FAIL behind the
// model. No retries, no best-of, no re-prompting.
//
// ══════════════════════════════════════════════════════════════════════════════

import './helpers/isolated-test-db.js';
import { CREDecisionEngine, DecisionType, IntentType } from '../src/chat/cre-decision.js';
import { featureManager } from '../src/core/feature-manager.js';
import { config } from '../src/config.js';

const EXIT_BLOCKED = 2;

let pass = 0;
let fail = 0;
const failures = [];

function check(condition, label) {
  if (condition) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; failures.push(label); console.error(`  ❌ ${label}`); }
}

// ── Prerequisite gate ────────────────────────────────────────────────────────
// Declared, not assumed. A missing model must be visible as BLOCKED rather
// than silently degrading into the regex fallback, which would let this suite
// "pass" while proving nothing about the model path.
async function requireModel() {
  const baseUrl = config.ollama?.baseUrl || 'http://127.0.0.1:11434';
  const wanted = config.models?.FAST || config.models?.CHAT;

  let tags;
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    tags = await res.json();
  } catch (err) {
    console.error(`\n══ BLOCKED — Ollama unreachable at ${baseUrl}: ${err.message} ══`);
    console.error('   Prerequisite: a running Ollama. This is not a FAIL and not a PASS.\n');
    process.exit(EXIT_BLOCKED);
  }

  const installed = (tags.models || []).map(m => m.name);
  if (!installed.includes(wanted)) {
    console.error(`\n══ BLOCKED — classification model "${wanted}" is not installed ══`);
    console.error(`   Installed: ${installed.join(', ') || '(none)'}`);
    console.error(`   Run: ollama pull ${wanted}\n`);
    process.exit(EXIT_BLOCKED);
  }

  console.log(`  model: ${wanted} @ ${baseUrl}`);
  return wanted;
}

const cre = new CREDecisionEngine();

async function main() {
  console.log('\n══ Capability #2 — CRE model behaviours ══\n');
  await requireModel();
  console.log('');

  // ── C-05 — a shell command never originates in the model ───────────────────
  // GUARD 1 deletes shellCommand from the model's output; the command that
  // reaches the decision is produced by the deterministic extractor. Observable
  // form: for these inputs the command is exactly the deterministic value, so
  // no model-authored text can have reached it.
  const shellDirect = await cre.decide('git status');
  const shellVerb = await cre.decide('spusť ls -la');
  check(
    shellDirect.intent === IntentType.SHELL
    && shellDirect.metadata?.shellCommand === 'git status'
    && shellVerb.intent === IntentType.SHELL
    && shellVerb.metadata?.shellCommand === 'ls -la',
    'C-05 — a SHELL decision carries the deterministically extracted command, never the model\'s'
    + ` (got "${shellDirect.metadata?.shellCommand}" / "${shellVerb.metadata?.shellCommand}")`,
  );

  // ── C-06 — SKILL is not selected while its feature flag is off (GUARD 4) ───
  const skillsWereEnabled = featureManager.isEnabled('skills');
  featureManager.set('skills', false);
  let skillOff;
  try {
    skillOff = await cre.decide('spusť skill na nasazení aplikace');
  } finally {
    featureManager.set('skills', skillsWereEnabled);
  }
  check(
    skillOff.intent !== IntentType.SKILL,
    `C-06 — SKILL is not selected while the skills feature is disabled (got ${skillOff.intent})`,
  );

  // ── C-08 — an unambiguous information request is SEARCH ────────────────────
  const search = await cre.decide('vyhledej aktuální kurz eura vůči koruně');
  check(
    search.intent === IntentType.SEARCH,
    `C-08 — an unambiguous request for current information classifies as SEARCH (got ${search.intent})`,
  );

  // ── C-09 — an unambiguous code request is CODE, not SEARCH ─────────────────
  const code = await cre.decide('napiš funkci v Pythonu, která seřadí seznam čísel');
  check(
    code.intent === IntentType.CODE,
    `C-09 — an unambiguous code request classifies as CODE, not SEARCH (got ${code.intent})`,
  );

  // ── C-10 — thanks and goodbye are CONVERSATIONAL (routing patch Q2) ────────
  const thanks = await cre.decide('díky moc, měj se hezky');
  check(
    thanks.intent === IntentType.CONVERSATIONAL && thanks.type === DecisionType.ANSWER,
    `C-10 — gratitude and farewell classify as CONVERSATIONAL, not SEARCH (got ${thanks.intent})`,
  );

  // ── C-11 — an ambiguous input asks, it does not guess ──────────────────────
  const ambiguous = await cre.decide('no a co teda s tím');
  check(
    ambiguous.intent === IntentType.AMBIGUOUS
    && ambiguous.type === DecisionType.ASK_USER
    && (ambiguous.slots || []).includes('intent_clarification'),
    `C-11 — an ambiguous input yields AMBIGUOUS with a clarification slot, not a guess`
    + ` (got ${ambiguous.intent}/${ambiguous.type})`,
  );

  // ── C-12 — an active creative expertise rewrites SEARCH to CREATIVE ────────
  // GUARD 6: "Prokletý ostrov" during a role-playing session is the campaign's
  // island, not the film — the creative domain wins over the lookup.
  const creative = await cre.decide('Prokletý ostrov', {
    hasActiveExpertise: true,
    expertise: { id: 'dnd-master', creativeLock: true, outputBias: 'creative' },
  });
  check(
    creative.intent === IntentType.CREATIVE,
    `C-12 — under an active creative expertise, SEARCH is rewritten to CREATIVE (got ${creative.intent})`,
  );

  // ── C-13 — FILE_WRITE without a recognizable target is not selected ────────
  const write = await cre.decide('ulož to');
  check(
    write.intent !== IntentType.FILE_WRITE,
    `C-13 — FILE_WRITE is not selected without a recognizable target (got ${write.intent})`,
  );

  // ── C-14 — DESIGN without a confirmed pattern is knocked down to CREATIVE ──
  // An itinerary is a plan, but not a software design. GUARD 5 requires a
  // deterministic DESIGN pattern before the model's DESIGN is accepted.
  const itinerary = await cre.decide('navrhni mi itinerář na víkendový výlet do Alp');
  check(
    itinerary.intent === IntentType.CREATIVE,
    `C-14 — DESIGN without a confirmed deterministic pattern becomes CREATIVE (got ${itinerary.intent})`,
  );

  console.log(`\n══ RESULTS: ${pass} passed, ${fail} failed ══`);
  if (failures.length) {
    console.error('\n  FAILURES:');
    for (const f of failures) console.error(`    ❌ ${f}`);
  }
  console.log('');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(`\nFATAL: ${err.stack || err.message}\n`);
  process.exit(1);
});
