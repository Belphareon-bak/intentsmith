#!/usr/bin/env node
// A confirmation belongs to whoever asked for it
// ══════════════════════════════════════════════════════════════════════════════
//
// Regression for the 2026-08-02 smoke finding. A skill asked "Potvrdit
// spuštění?"; the user answered "ano"; the upgrade-approval intercept — which
// runs before CRE on every mode and matches a bare "ano" — consumed it and
// applied five pending model upgrades instead, rebinding CHAT from
// qwen3.5:27b to qwen3:14b. The change persisted to model_overrides and
// survived restart, and the skill never ran.
//
// An upgrade notification is not a question. It sits in session state waiting
// for something to consume it, so it must not outrank a confirmation the
// system actively asked for one turn earlier.
//
// ══════════════════════════════════════════════════════════════════════════════

import './helpers/isolated-test-db.js';
import { preHandle } from '../src/chat/handlers/pre-handler.js';

let pass = 0;
let fail = 0;
const failures = [];

function check(condition, label) {
  if (condition) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; failures.push(label); console.error(`  ❌ ${label}`); }
}

// Two upgrade proposals waiting in session state, exactly as the notification
// intercept leaves them.
function sessionWithPendingUpgrades(extra = {}) {
  return {
    _upgradeNotified: true,
    _pendingUpgrades: [
      { role: 'CHAT', currentModel: 'qwen3.5:27b', candidateModel: 'qwen3:14b', score: 0.65 },
      { role: 'D1', currentModel: 'deepseek-r1-32b', candidateModel: 'qwen3:14b', score: 0.64 },
    ],
    ...extra,
  };
}

function context(sessionState) {
  return { sessionState, sessionId: 'test-session', conversationId: 'test-conversation' };
}

async function main() {
  console.log('\n══ A confirmation belongs to whoever asked for it ══\n');

  // ── "ano" while a skill awaits confirmation goes to the skill ─────────────
  // The execution id is synthetic, so the skill subsystem answers "not found".
  // That is the point: what matters is *which* subsystem took the answer.
  const skillPending = sessionWithPendingUpgrades({ _pendingSkillExecution: 'exec-123' });
  const duringSkill = await preHandle('ano', context(skillPending), 'conversation');
  const skillMeta = duringSkill.response?.tag?.metadata || {};

  check(
    skillMeta.skillSystem === true && !skillMeta.upgradeApplied,
    `"ano" is taken by the skill that asked, not by the upgrade notice`
    + ` (skillSystem=${skillMeta.skillSystem}, upgradeApplied=${skillMeta.upgradeApplied})`,
  );
  check(
    Array.isArray(skillPending._pendingUpgrades) && skillPending._pendingUpgrades.length === 2,
    'the pending upgrades are neither applied nor consumed',
  );

  // ── The same holds while a skill proposal is outstanding ──────────────────
  const proposalPending = sessionWithPendingUpgrades({ _pendingSkillProposal: { skillId: 'brainstorm' } });
  const duringProposal = await preHandle('ano', context(proposalPending), 'conversation');
  check(
    !(duringProposal.response?.tag?.metadata?.upgradeApplied)
    && Array.isArray(proposalPending._pendingUpgrades)
    && proposalPending._pendingUpgrades.length === 2,
    'a pending skill proposal also keeps the upgrade notice from taking "ano"',
  );

  // ── With nothing else pending, "ano" still approves upgrades ──────────────
  // The guard narrows ownership; it must not break the feature.
  const onlyUpgrades = sessionWithPendingUpgrades();
  const alone = await preHandle('ano', context(onlyUpgrades), 'conversation');
  check(
    alone.handled === true,
    `with no competing question, "ano" still approves the upgrade (handled=${alone.handled})`,
  );

  // ── An explicit upgrade word reaches upgrades even mid-skill ──────────────
  // The user who really means the upgrade can still say so unambiguously.
  const explicit = sessionWithPendingUpgrades({ _pendingSkillExecution: 'exec-456' });
  const stated = await preHandle('schval upgrade', context(explicit), 'conversation');
  check(
    stated.handled === true,
    `an explicit "schval upgrade" is still honoured mid-skill (handled=${stated.handled})`,
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
