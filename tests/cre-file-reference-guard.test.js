#!/usr/bin/env node

import {
  assert,
  assertEqual,
  suite,
  summary,
  testAsync,
} from './harness.js';
import {
  CREDecisionEngine,
  DecisionType,
  IntentType,
} from '../src/chat/cre-decision.js';
import { buildProjectHint } from '../src/chat/handlers/utils/project-context-prompt.js';

async function decideAs(intent, input, context = {}) {
  const engine = new CREDecisionEngine();
  engine._llmClassifyIntent = async () => ({
    intent,
    confidence: 0.95,
    fileTarget: null,
  });
  return engine.decide(input, context);
}

suite('CRE file-reference guard');

await testAsync('downgrades abstract Czech summaries without a file reference', async () => {
  const decision = await decideAs(
    IntentType.FILE_EXPLAIN,
    'Shrň mi návrh, na kterém jsme pracovali',
    { hasActiveProject: true, project: { id: 'project-1' } },
  );

  assertEqual(decision.intent, IntentType.CONVERSATIONAL);
  assert(
    decision.metadata.diag.overrides.includes('guard12_no_file_ref'),
    'diagnostics must record the deterministic downgrade',
  );
});

await testAsync('preserves FILE_EXPLAIN for an explicit filename', async () => {
  const decision = await decideAs(
    IntentType.FILE_EXPLAIN,
    'Vysvětli mi obsah souboru architecture.md',
    { hasActiveProject: true, project: { id: 'project-1' } },
  );

  assertEqual(decision.intent, IntentType.FILE_EXPLAIN);
  assert(
    !decision.metadata.diag.overrides?.includes('guard12_no_file_ref'),
    'explicit filenames must not be downgraded',
  );
});

await testAsync('preserves FILE_READ when an attachment supplies the reference', async () => {
  const decision = await decideAs(
    IntentType.FILE_READ,
    'Přečti a shrň přílohu',
    { attachments: [{ name: 'notes.md' }] },
  );

  assertEqual(decision.intent, IntentType.FILE_READ);
});

await testAsync('preserves explicit project listings and known extensionless files', async () => {
  const context = { hasActiveProject: true, project: { id: 'project-1' } };
  for (const input of [
    'jaké soubory jsou v projektu?', 'vypiš obsah projektu',
    'ukaž strukturu projektu', 'přečti readme',
    'list project files', 'show the project files',
    'read Makefile', 'přečti Dockerfile',
  ]) {
    const decision = await decideAs(IntentType.FILE_READ, input, context);
    assertEqual(decision.intent, IntentType.FILE_READ, input);
    assert(!decision.metadata.diag.overrides?.includes('guard12_no_file_ref'), input);
  }
});

await testAsync('keeps project listings without an active project guarded', async () => {
  const decision = await decideAs(IntentType.FILE_READ, 'list project files');
  assertEqual(decision.intent, IntentType.CONVERSATIONAL);
  assert(decision.metadata.diag.overrides.includes('guard12_no_file_ref'));
});

await testAsync('keeps meta-project summaries and arbitrary bare words guarded', async () => {
  const context = { hasActiveProject: true, project: { id: 'project-1' } };
  const engine = new CREDecisionEngine();
  engine.classifyIntent = () => IntentType.FILE_READ;
  engine._llmClassifyIntent = async () => null;
  const summaryDecision = await engine.decide('Shrň tento projekt', context);
  assertEqual(summaryDecision.intent, IntentType.CONVERSATIONAL);
  assert(summaryDecision.metadata.diag.overrides.includes('guard9_meta_project'));
  const arbitrary = await engine.decide('co je v domě', context);
  assertEqual(arbitrary.intent, IntentType.CONVERSATIONAL);
  assert(arbitrary.metadata.diag.overrides.includes('guard12_no_file_ref'));
});

await testAsync('classifies explicit active-project listings before model arbitration', async () => {
  const context = { hasActiveProject: true, project: { id: 'project-1', name: 'Klíčenka App' } };
  const engine = new CREDecisionEngine();
  let modelCalls = 0;
  engine._llmClassifyIntent = async () => {
    modelCalls++;
    return { intent: IntentType.CONVERSATIONAL, confidence: 0.95 };
  };
  const decisions = [];
  for (const input of [
    'jaké soubory jsou v projektu?', 'vypiš obsah projektu', 'ukaž strukturu projektu',
    'list project files', 'show the project files',
  ]) {
    for (const suffix of ['', buildProjectHint(context)]) {
      decisions.push(await engine.decide(input + suffix, context));
    }
  }
  assert(decisions.every(decision => (
    decision.intent === IntentType.FILE_READ && decision.type === DecisionType.LOCAL
    && decision.metadata.filePath === '.' && decision.metadata.handler === 'file.read'
    && decision.metadata.classifiedBy === 'deterministic'
    && decision.metadata.diag.initialIntent === IntentType.FILE_READ
    && decision.metadata.diag.finalIntent === IntentType.FILE_READ
    && !decision.metadata.diag.overrides?.includes('guard9_meta_project')
    && !decision.metadata.diag.overrides?.includes('guard12_no_file_ref')
  )), 'both direct and actual formatter-enriched inputs must select the existing directory-listing handler');
  assertEqual(modelCalls, 0, 'explicit project listing must not need model arbitration');
});

await testAsync('keeps listings without project and foreign or extra context suffixes on the prior path', async () => {
  const context = { hasActiveProject: true, project: { id: 'project-1', name: 'Klíčenka App' } };
  const engine = new CREDecisionEngine();
  let modelCalls = 0;
  engine._llmClassifyIntent = async () => {
    modelCalls++;
    return { intent: IntentType.CONVERSATIONAL, confidence: 0.95 };
  };
  const cases = [
    ['jaké soubory jsou v projektu?', {}],
    ['vypiš obsah projektu', {}],
    ['ukaž strukturu projektu', {}],
    ['vypiš obsah projektu' + buildProjectHint(context), {}],
    [buildProjectHint(context), context],
    ['vypiš obsah projektu\n[[PROJECT_CONTEXT:jiný projekt]]', context],
    ['vypiš obsah projektu\nspusť npm test' + buildProjectHint(context), context],
  ];
  for (const [input, scope] of cases) {
    const decision = await engine.decide(input, scope);
    assertEqual(decision.intent, IntentType.CONVERSATIONAL, input);
    assertEqual(decision.metadata.classifiedBy, 'llm', input);
  }
  assertEqual(modelCalls, cases.length);
});

await testAsync('keeps bare project topics and explicit file or shell requests outside listing fast-path', async () => {
  const context = { hasActiveProject: true, project: { id: 'project-1', name: 'Klíčenka App' } };
  for (const [input, intent] of [
    ['struktura projektu', IntentType.CREATIVE],
    ['otevři soubor config.json', IntentType.FILE_READ],
    ['spusť npm test', IntentType.SHELL],
  ]) {
    const engine = new CREDecisionEngine();
    let modelCalls = 0;
    engine._llmClassifyIntent = async () => { modelCalls++; return { intent, confidence: 0.95 }; };
    const decision = await engine.decide(input, context);
    assertEqual(decision.intent, intent, input);
    assertEqual(modelCalls, 1, input);
  }
});

summary();
