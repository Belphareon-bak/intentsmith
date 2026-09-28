#!/usr/bin/env node

import {
  testAsync,
  assert,
  assertEqual,
  summary,
} from './harness.js';

import {
  CREDecisionEngine,
  IntentType,
  DecisionType,
  _testCREInternals,
} from '../src/chat/cre-decision.js';
import { config } from '../src/config.js';

async function decideWithAcceptedLLM(input, llmIntent, onClassify = () => {}) {
  const engine = new CREDecisionEngine();
  engine._llmClassifyIntent = async () => {
    onClassify();
    return {
      intent: llmIntent,
      confidence: 0.92,
      fileTarget: null,
    };
  };

  return {
    engine,
    decision: await engine.decide(input),
  };
}

await testAsync('classification context stays resident when FAST shares the CHAT artifact', async () => {
  const hadFast = Object.prototype.hasOwnProperty.call(config.models, 'FAST');
  const originalFast = config.models.FAST;
  try {
    delete config.models.FAST;
    assertEqual(_testCREInternals.classifierNumCtxOverride(), null);
    config.models.FAST = config.models.CHAT;
    assertEqual(_testCREInternals.classifierNumCtxOverride(), null);
    config.models.FAST = 'dedicated-fast:1b';
    assertEqual(_testCREInternals.classifierNumCtxOverride(), 1024);
  } finally {
    if (hadFast) config.models.FAST = originalFast;
    else delete config.models.FAST;
  }
});

const buildArbitrationCases = [
  ['deployni na server', IntentType.SHELL],
  ['nastav mi CI/CD pipeline', IntentType.CREATIVE],
  ['build me a REST API', IntentType.CODE],
  ['postav mi web', IntentType.REPORT],
];

for (const [input, llmIntent] of buildArbitrationCases) {
  await testAsync(`accepted LLM ${llmIntent} + deterministic BUILD for "${input}" uses audited BUILD`, async () => {
    const { engine, decision } = await decideWithAcceptedLLM(input, llmIntent);

    assertEqual(decision.intent, IntentType.BUILD, `intent for "${input}"`);
    assertEqual(decision.type, DecisionType.PLAN, `decision for "${input}"`);
    assertEqual(decision.metadata.override, true, 'must use override audit metadata');
    assertEqual(decision.metadata.overrideSource, 'llm_to_build_deterministic_arbitration');
    assertEqual(decision.metadata.originalDecision.intent, llmIntent, 'must preserve LLM intent');
    assertEqual(engine.getAuditStats().overrideCount, 1, 'must log override');
  });
}

const nonBuildCases = [
  ['create a deployment plan', IntentType.DESIGN, IntentType.DESIGN, DecisionType.ANSWER],
  ['explain build pipelines', IntentType.CONVERSATIONAL, IntentType.CONVERSATIONAL, DecisionType.ANSWER],
  ['review the deployment plan before implementation', IntentType.DESIGN, IntentType.CONVERSATIONAL, DecisionType.ANSWER],
];

for (const [input, llmIntent, expectedIntent, expectedDecision] of nonBuildCases) {
  await testAsync(`accepted LLM ${llmIntent} + non-BUILD request "${input}" stays non-BUILD`, async () => {
    const { engine, decision } = await decideWithAcceptedLLM(input, llmIntent);

    assertEqual(decision.intent, expectedIntent, `intent for "${input}"`);
    assertEqual(decision.type, expectedDecision, `decision for "${input}"`);
    assert(!decision.metadata.override, 'must not mark decision as override');
    assertEqual(engine.getAuditStats().overrideCount, 0, 'must not log BUILD override');
  });
}

await testAsync('unsupported LLM LOCAL label cannot enter terminal local authority', async () => {
  const { decision } = await decideWithAcceptedLLM(
    'Kolik zaplatim dani z prijmu 850000 Kc jako OSVC?',
    IntentType.LOCAL,
  );

  assertEqual(decision.intent, IntentType.CONVERSATIONAL);
  assertEqual(decision.type, DecisionType.ANSWER);
  assert(
    decision.metadata.diag.overrides.includes('guard13_unbacked_local'),
    'the deterministic authority downgrade must be recorded',
  );
});

await testAsync('supported deterministic calculation remains terminal LOCAL', async () => {
  const { decision } = await decideWithAcceptedLLM(
    'Spočítej mi DPH z 15000 Kč',
    IntentType.CONVERSATIONAL,
  );

  assertEqual(decision.intent, IntentType.LOCAL);
  assertEqual(decision.type, DecisionType.LOCAL);
  assertEqual(decision.metadata.localComputation, true);
});

for (const input of [
  'Napiš mi funkci pro výpočet faktoriálu v Pythonu.',
  'A co rekurzivní verze?',
]) {
  await testAsync(`strong inline-code request "${input}" bypasses model arbitration`, async () => {
    let classificationCalls = 0;
    const { decision } = await decideWithAcceptedLLM(
      input,
      IntentType.SEARCH,
      () => { classificationCalls++; },
    );

    assertEqual(classificationCalls, 0);
    assertEqual(decision.intent, IntentType.CODE);
    assertEqual(decision.type, DecisionType.ANSWER);
    assertEqual(decision.metadata.inlineCode, true);
    assertEqual(decision.metadata.classifiedBy, 'deterministic');
  });
}

await testAsync('explicit stable ideation bypasses model arbitration but retains CREATIVE authority', async () => {
  let classificationCalls = 0;
  const { decision } = await decideWithAcceptedLLM(
    'Vymysli mi název pro knihovnu na zpracování dat.',
    IntentType.SEARCH,
    () => { classificationCalls++; },
  );

  assertEqual(classificationCalls, 0);
  assertEqual(decision.intent, IntentType.CREATIVE);
  assertEqual(decision.type, DecisionType.ANSWER);
  assertEqual(decision.metadata.classifiedBy, 'deterministic');
});

await testAsync('referential population request bypasses clarification and requires search authority', async () => {
  let classificationCalls = 0;
  const { decision } = await decideWithAcceptedLLM(
    'Kolik tam žije lidí?',
    IntentType.AMBIGUOUS,
    () => { classificationCalls++; },
  );

  assertEqual(classificationCalls, 0);
  assertEqual(decision.intent, IntentType.SEARCH);
  assertEqual(decision.type, DecisionType.TOOL_CALL);
  assertEqual(decision.metadata.classifiedBy, 'deterministic');
});

for (const input of [
  'Jaké jsou trendy v IT podnikání?',
  'What are the current trends in IT business?',
  'Ahoj! Co je nového v technologiích?',
  'Hello! What is new in technology?',
  'Jaký je aktuální ekosystém knihoven pro každý framework?',
  'Jaké jsou trendy pro rok 2026? Který framework roste nejrychleji?',
]) {
  await testAsync(`explicit live-data request "${input}" requires search authority`, async () => {
    let classificationCalls = 0;
    const { decision } = await decideWithAcceptedLLM(
      input,
      IntentType.CONVERSATIONAL,
      () => { classificationCalls++; },
    );

    assertEqual(classificationCalls, 0);
    assertEqual(decision.intent, IntentType.SEARCH);
    assertEqual(decision.type, DecisionType.TOOL_CALL);
    assertEqual(decision.metadata.classifiedBy, 'deterministic');
  });
}

await testAsync('evergreen castle recommendation cannot become an outbound effect', async () => {
  let classificationCalls = 0;
  const { decision } = await decideWithAcceptedLLM(
    'Jaké jsou nejhezčí české hrady?',
    IntentType.SEARCH,
    () => { classificationCalls++; },
  );

  assertEqual(classificationCalls, 0);
  assertEqual(decision.intent, IntentType.CONVERSATIONAL);
  assertEqual(decision.type, DecisionType.ANSWER);
});

for (const input of [
  'Kolik kalorií spálím za hodinu běhu?',
  'How many calories do I burn in an hour of running?',
  'How many calories do you burn in an hour of running?',
]) {
  await testAsync(`stable calorie estimate "${input}" cannot become an outbound effect`, async () => {
    let classificationCalls = 0;
    const { decision } = await decideWithAcceptedLLM(
      input,
      IntentType.SEARCH,
      () => { classificationCalls++; },
    );

    assertEqual(classificationCalls, 0);
    assertEqual(decision.intent, IntentType.CONVERSATIONAL);
    assertEqual(decision.type, DecisionType.ANSWER);
    assertEqual(decision.metadata.classifiedBy, 'deterministic');
  });
}

await testAsync('closed historical year bypasses model classification and outbound authority', async () => {
  let classificationCalls = 0;
  const { decision } = await decideWithAcceptedLLM(
    'What happened in 1969?',
    IntentType.SEARCH,
    () => { classificationCalls++; },
  );

  assertEqual(classificationCalls, 0);
  assertEqual(decision.intent, IntentType.CONVERSATIONAL);
  assertEqual(decision.type, DecisionType.ANSWER);
  assertEqual(decision.metadata.classifiedBy, 'deterministic');
});

await testAsync('stable impact knowledge bypasses model classification and outbound authority', async () => {
  let classificationCalls = 0;
  const { engine, decision } = await decideWithAcceptedLLM(
    'Jaký dopad může mít AI na pracovní trh v ČR?',
    IntentType.SEARCH,
    () => { classificationCalls++; },
  );

  assertEqual(decision.intent, IntentType.CONVERSATIONAL);
  assertEqual(decision.type, DecisionType.ANSWER);
  assertEqual(decision.metadata.classifiedBy, 'deterministic');
  assertEqual(classificationCalls, 0);
  assertEqual(engine.getAuditStats().overrideCount, 0);
});

await testAsync('stable no-diacritics influence question bypasses outbound authority', async () => {
  let classificationCalls = 0;
  const { decision } = await decideWithAcceptedLLM(
    'Jaky vliv bude mit automatizace na male firmy?',
    IntentType.SEARCH,
    () => { classificationCalls++; },
  );

  assertEqual(classificationCalls, 0);
  assertEqual(decision.intent, IntentType.CONVERSATIONAL);
  assertEqual(decision.type, DecisionType.ANSWER);
  assertEqual(decision.metadata.classifiedBy, 'deterministic');
});

for (const input of [
  'Chci se naucit programovat systematicky, ne nahodne.',
  'Jak bys vysvetlil rozdil mezi programovanim a softwarovym inzenyrstvim?',
  'Chci zacit cvicit, ale dlouhodobe, ne jen na mesic.',
  'Je lepsi zacit silou nebo kondici? Proc?',
  'Jake chyby zacatecnici delaji nejcasteji?',
  'Shrni hlavni rizika a prilezitosti AI pro bezneho cloveka.',
]) {
  await testAsync(`stable learning discussion "${input}" cannot become DESIGN`, async () => {
    let classificationCalls = 0;
    const { decision } = await decideWithAcceptedLLM(
      input,
      IntentType.DESIGN,
      () => { classificationCalls++; },
    );

    assertEqual(decision.intent, IntentType.CONVERSATIONAL);
    assertEqual(decision.type, DecisionType.ANSWER);
    assertEqual(decision.metadata.classifiedBy, 'deterministic');
    assertEqual(classificationCalls, 0);
  });
}

await testAsync('explicit fresh-data search remains outbound authority', async () => {
  const { engine, decision } = await decideWithAcceptedLLM(
    'Vyhledej aktuální dopad AI na pracovní trh v ČR.',
    IntentType.SEARCH,
  );

  assertEqual(decision.intent, IntentType.SEARCH);
  assertEqual(decision.type, DecisionType.TOOL_CALL);
  assertEqual(decision.metadata.override, undefined);
  assertEqual(engine.getAuditStats().overrideCount, 0);
});

await testAsync('fresh summary remains outbound authority', async () => {
  const { decision } = await decideWithAcceptedLLM(
    'Shrni aktualni zpravy o AI z dnesniho webu.',
    IntentType.REPORT,
  );

  assertEqual(decision.intent, IntentType.REPORT);
  assertEqual(decision.type, DecisionType.TOOL_CALL);
});

summary();
