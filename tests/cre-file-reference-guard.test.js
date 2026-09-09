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
  IntentType,
} from '../src/chat/cre-decision.js';

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

summary();
