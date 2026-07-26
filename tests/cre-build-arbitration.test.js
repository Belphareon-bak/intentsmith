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
} from '../src/chat/cre-decision.js';

async function decideWithAcceptedLLM(input, llmIntent) {
  const engine = new CREDecisionEngine();
  engine._llmClassifyIntent = async () => ({
    intent: llmIntent,
    confidence: 0.92,
    fileTarget: null,
  });

  return {
    engine,
    decision: await engine.decide(input),
  };
}

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

summary();
