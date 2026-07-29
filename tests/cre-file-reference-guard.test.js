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

summary();
