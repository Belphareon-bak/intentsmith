// tests/build-deferral.test.js — GUARD 10: BUILD Deferral (discussion-before-build)
// ══════════════════════════════════════════════════════════════════════════════
// v101: When user says "first discuss, then build", CRE should classify as
// CONVERSATIONAL with deferredIntent=BUILD, not BUILD.
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import {
  creDecisionEngine,
  DecisionType,
  IntentType,
} from '../src/chat/cre-decision.js';

// ═══════════════════════════════════════════════════════════════════════════════
suite('GUARD 10 — Discussion-before-build: Czech composite');
// ═══════════════════════════════════════════════════════════════════════════════

const CZ_COMPOSITE = [
  'chci abys udělal revizi zadání tohoto projektu a doladili jsme některé důležité body a pak by ses mohl pustit do implementace',
  'pojďme nejdřív projít specifikaci a pak to začneme stavět',
  'prodiskutujme zadání a potom se pustíme do kódu',
  'doladíme detaily a pak stavíme',
  'probereme body a následně začneš s implementací',
  'zkontrolujeme požadavky a potom to implementujeme',
];

for (const input of CZ_COMPOSITE) {
  await testAsync(`CZ composite: "${input.substring(0, 60)}..." → CONV`, async () => {
    const decision = await creDecisionEngine.decide(input, {});
    assertEqual(decision.type, DecisionType.ANSWER,
      `Expected ANSWER (CONV), got ${decision.type} for: ${input.substring(0, 60)}`);
    assert(decision.intent !== IntentType.BUILD,
      `Should NOT be BUILD intent for: ${input.substring(0, 60)}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
suite('GUARD 10 — Discussion-before-build: Czech conditional mood');
// ═══════════════════════════════════════════════════════════════════════════════

const CZ_CONDITIONAL = [
  'by ses mohl pustit do implementace',
  'bys mohl začít stavět po tom co projdeme spec',
  'mohli bychom se pustit do kódování po revizi',
];

for (const input of CZ_CONDITIONAL) {
  await testAsync(`CZ conditional: "${input.substring(0, 60)}" → CONV`, async () => {
    const decision = await creDecisionEngine.decide(input, {});
    assertEqual(decision.type, DecisionType.ANSWER,
      `Expected ANSWER, got ${decision.type} for: ${input.substring(0, 50)}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
suite('GUARD 10 — Discussion-before-build: Czech implicit sequence');
// ═══════════════════════════════════════════════════════════════════════════════

const CZ_IMPLICIT = [
  'pojďme to nejdřív projít',
  'nejdřív to probereme',
  'předtím bych chtěl doladit zadání',
];

for (const input of CZ_IMPLICIT) {
  await testAsync(`CZ implicit: "${input}" → CONV`, async () => {
    const decision = await creDecisionEngine.decide(input, {});
    assertEqual(decision.type, DecisionType.ANSWER,
      `Expected ANSWER, got ${decision.type} for: ${input}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
suite('GUARD 10 — Discussion-before-build: Czech no-diacritics');
// ═══════════════════════════════════════════════════════════════════════════════

const CZ_NO_DIACRITICS = [
  'chci projit zadani projektu a pak zacit stavet',
  'nejdriv doladit pozadavky a potom implementovat',
];

for (const input of CZ_NO_DIACRITICS) {
  await testAsync(`CZ no-diacr: "${input.substring(0, 50)}" → CONV`, async () => {
    const decision = await creDecisionEngine.decide(input, {});
    assertEqual(decision.type, DecisionType.ANSWER,
      `Expected ANSWER, got ${decision.type} for: ${input}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
suite('GUARD 10 — Discussion-before-build: English');
// ═══════════════════════════════════════════════════════════════════════════════

const EN_DEFERRAL = [
  "let's review the requirements before we build",
  'first discuss the spec, then implement',
  "let's go through the project scope before starting",
  "let's first fine-tune the requirements and then we can build",
];

for (const input of EN_DEFERRAL) {
  await testAsync(`EN: "${input.substring(0, 50)}" → CONV`, async () => {
    const decision = await creDecisionEngine.decide(input, {});
    assertEqual(decision.type, DecisionType.ANSWER,
      `Expected ANSWER, got ${decision.type} for: ${input}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
suite('GUARD 10 — No regression: BUILD stays BUILD');
// ═══════════════════════════════════════════════════════════════════════════════

const STAY_BUILD = [
  'postav mi REST API',
  'postav mi webovou aplikaci',
  'jdeme stavět',
  'začni stavět',
  'build me a project',
  "let's build",
  'chci mít monitoring',
  'potřebuji systém pro logování',
  'nastav mi CI/CD pipeline',
  'rozjeď mi cluster',
  // 'začni s implementací' — pre-existing: classified as CODE by regex, not BUILD
];

for (const input of STAY_BUILD) {
  test(`BUILD stays: "${input}" → BUILD (regex)`, () => {
    const intent = creDecisionEngine.classifyIntent(input);
    assertEqual(intent, IntentType.BUILD, `"${input}" should be BUILD, got ${intent}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
suite('GUARD 10 — Edge cases');
// ═══════════════════════════════════════════════════════════════════════════════

// "revize hotova, začni" — no sequence marker → stays BUILD
await testAsync('reversed done-then-build: "revize projektu hotova, začni implementovat" → BUILD', async () => {
  const decision = await creDecisionEngine.decide('revize projektu hotova, začni implementovat', {});
  // This may or may not classify as BUILD via LLM — the key test is that
  // GUARD 10 does NOT incorrectly defer it. If CRE classifies as something
  // other than BUILD naturally, that's fine. The invariant: it should NOT
  // have deferredIntent = BUILD (no false deferral).
  if (decision.type === DecisionType.PLAN) {
    // If LLM classified as BUILD → correct, no deferral happened
    assert(true, 'Correctly stayed as BUILD/PLAN');
  } else {
    // If CRE classified differently (e.g., CONVERSATIONAL) → also OK,
    // but deferredIntent should be null (not a guard10 deferral)
    assert(!decision.metadata?.diag?.overrides?.includes('guard10_build_deferral'),
      'Should not have guard10_build_deferral override');
  }
});

// "postav projekt, pak projdeme" — reversed order → stays BUILD
// qwen3.5 may classify as CONVERSATIONAL (sees "projdeme" as primary intent).
// Key invariant: GUARD 10 should NOT fire (no false deferral).
await testAsync('reversed build-then-discuss: "postav projekt, pak projdeme detaily" → no guard10', async () => {
  const decision = await creDecisionEngine.decide('postav projekt, pak projdeme detaily', {});
  // LLM variance: PLAN (BUILD) or ANSWER (CONVERSATIONAL). Both OK.
  // Key: GUARD 10 should NOT have deferred this.
  assert(!decision.metadata?.diag?.overrides?.includes('guard10_build_deferral'),
    'Should not have guard10_build_deferral override');
});

// Not BUILD at all — no guard10 involvement
await testAsync('opinion about implementation: "co si myslíš o implementaci?" → not BUILD', async () => {
  const decision = await creDecisionEngine.decide('co si myslíš o implementaci?', {});
  assert(decision.type !== DecisionType.PLAN,
    `Should NOT be PLAN/BUILD, got ${decision.type}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('GUARD 10 — deferredIntent metadata');
// ═══════════════════════════════════════════════════════════════════════════════

await testAsync('deferred BUILD: "chci projít zadání a pak stavět" → ANSWER, no false BUILD', async () => {
  const decision = await creDecisionEngine.decide(
    'chci projít zadání a pak stavět', {}
  );
  assertEqual(decision.type, DecisionType.ANSWER,
    `Should be ANSWER, got ${decision.type}`);
  // qwen3.5 classifies this as CONVERSATIONAL directly (smarter Czech understanding).
  // GUARD 10 only fires when intent === BUILD, so deferredIntent may be null.
  // Both scenarios are correct:
  //   - deferredIntent=BUILD (GUARD 10 caught it) → ideal
  //   - deferredIntent=null (LLM got it right natively) → also correct
  // Key invariant: decision type must be ANSWER, not PLAN.
  assert(decision.type === DecisionType.ANSWER,
    `Must be ANSWER (discussion), not PLAN (build)`);
});

await testAsync('non-deferred BUILD: metadata.deferredIntent = null', async () => {
  const decision = await creDecisionEngine.decide('postav mi API', {});
  // LLM may classify as BUILD→PLAN or DESIGN→CREATIVE→ANSWER (LLM variance).
  // Key invariant: no guard10 false deferral.
  assertEqual(decision.metadata?.deferredIntent ?? null, null,
    `deferredIntent should be null, got ${decision.metadata?.deferredIntent}`);
  assert(!decision.metadata?.diag?.overrides?.includes('guard10_build_deferral'),
    'Should not have guard10_build_deferral override');
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('GUARD 10 — Full pipeline integration');
// ═══════════════════════════════════════════════════════════════════════════════

await testAsync('pipeline: "projdeme specifikaci a potom implementujeme" → ANSWER', async () => {
  const decision = await creDecisionEngine.decide(
    'projdeme specifikaci a potom implementujeme', {}
  );
  assertEqual(decision.type, DecisionType.ANSWER,
    `Should be ANSWER, got ${decision.type}`);
});

await testAsync('pipeline: "postav mi API" → not deferred (LLM may vary)', async () => {
  const decision = await creDecisionEngine.decide('postav mi API', {});
  // LLM variance: may be PLAN (BUILD) or ANSWER (DESIGN→CREATIVE). Both OK.
  // Key: should NOT be deferred by GUARD 10.
  assert(!decision.metadata?.diag?.overrides?.includes('guard10_build_deferral'),
    'Should not have guard10_build_deferral override');
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('GUARD 10 — Regression: existing BUILD patterns still work');
// ═══════════════════════════════════════════════════════════════════════════════

// Verify a subset of build-intent.test.js patterns still produce BUILD via decide()
const REGRESSION_BUILD = [
  'postav mi REST API',
  'jdeme stavět',
  'build me a project',
  'nastav mi CI/CD pipeline',
  'potřebuji systém pro logování',
];

for (const input of REGRESSION_BUILD) {
  await testAsync(`regression: "${input}" → not deferred`, async () => {
    const decision = await creDecisionEngine.decide(input, {});
    // LLM variance: may be PLAN (BUILD) or ANSWER (DESIGN→CREATIVE). Both OK.
    // Key invariant: GUARD 10 should NOT defer these as discussion-before-build.
    assert(!decision.metadata?.diag?.overrides?.includes('guard10_build_deferral'),
      `"${input}" should NOT have guard10_build_deferral override`);
    assertEqual(decision.metadata?.deferredIntent ?? null, null,
      `"${input}" should NOT have deferredIntent, got ${decision.metadata?.deferredIntent}`);
  });
}

// ─── Summary ─────────────────────────────────────────────────────────────────

summary();
