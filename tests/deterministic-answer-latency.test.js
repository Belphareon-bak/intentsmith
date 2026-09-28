#!/usr/bin/env node
// A deterministic answer costs no model call
// ══════════════════════════════════════════════════════════════════════════════
//
// Regression for the 2026-08-02 smoke finding: "kolik je hodin?" answered in
// 25 466 ms. The decision itself took 2 ms — the CRE never touched the gateway,
// and tests/capability-02-cre-behaviours.test.js proved exactly that and passed.
// The model call happened AFTER the decision, in the response finalizer, which
// refined any answer over 20 characters regardless of intent.
//
// The lesson, and the reason this suite exists at all: the behaviour was stated
// about decide() and the user experiences it about the request. This asserts it
// at the level where it is felt.
//
// Kept structural rather than HTTP-driven so it stays in the offline profile:
// the guard is a property of the finalizer, and a real model call is precisely
// what must NOT happen.
//
// ══════════════════════════════════════════════════════════════════════════════

import './helpers/isolated-test-db.js';
import { finalizeChatResponse } from '../src/chat/response-finalizer.js';

let pass = 0;
let fail = 0;
const failures = [];

function check(condition, label) {
  if (condition) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; failures.push(label); console.error(`  ❌ ${label}`); }
}

const silent = { info() {}, warn() {}, error() {}, debug() {} };

// The answer a clock question actually produces, at its actual length: 28
// characters, comfortably over the finalizer's 20-character threshold.
const CLOCK_ANSWER = '📊 **Aktuální čas: 22:02:56**';

function runFinalizer(intent, content) {
  const calls = { improve: 0, generate: 0 };
  const result = {
    content,
    mode: 'conversation',
    confidence: 0.95,
    canExecute: false,
    tag: { metadata: { decision: { intent, type: 'LOCAL' } } },
  };
  return finalizeChatResponse({
    result,
    message: 'kolik je hodin?',
    sessionId: 'test-session',
    conversationId: 'test-conversation',
    persistAssistantTurn: () => {},
    log: silent,
    dependencies: {
      improveResponse: async () => {
        calls.improve++;
        return { improved: false, response: content, telemetry: {} };
      },
      generateChatResponse: async () => {
        calls.generate++;
        return { content: 'refined' };
      },
      scoreResponse: async () => ({ total: 54, dimensions: {}, issues: [] }),
    },
  }).then(response => ({ response, calls }));
}

async function main() {
  console.log('\n══ A deterministic answer costs no model call ══\n');

  // ── The four intents whose answer no model wrote ──────────────────────────
  const skipped = [];
  for (const intent of ['LOCAL', 'SHELL', 'FILE_READ', 'FILE_WRITE']) {
    const { calls } = await runFinalizer(intent, CLOCK_ANSWER);
    skipped.push(`${intent}:${calls.improve}`);
  }
  check(
    skipped.every(entry => entry.endsWith(':0')),
    `no refinement for answers a model did not write (${skipped.join(' ')})`,
  );

  // ── The answer itself is untouched ────────────────────────────────────────
  const { response } = await runFinalizer('LOCAL', CLOCK_ANSWER);
  check(
    response.response === CLOCK_ANSWER,
    'the deterministic answer reaches the user exactly as computed',
  );

  // ── Decision 024/C applies equally to model-authored answers ──────────────
  // Scoring remains in the finalizer, but no answer triggers a second model
  // call after the first response has been produced.
  const explain = await runFinalizer('FILE_EXPLAIN', CLOCK_ANSWER);
  const conversational = await runFinalizer('CONVERSATIONAL', CLOCK_ANSWER);
  check(
    explain.calls.improve === 0 && conversational.calls.improve === 0,
    'post-answer refinement is removed for model-authored answers'
    + ` (FILE_EXPLAIN ${explain.calls.improve}, CONVERSATIONAL ${conversational.calls.improve})`,
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
