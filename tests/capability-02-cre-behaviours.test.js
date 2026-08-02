#!/usr/bin/env node
// Capability #2 — CRE: deterministic behaviour acceptance
// ══════════════════════════════════════════════════════════════════════════════
//
// CONTRACT.md §3 step 3, for the seven behaviours in
// docs/behaviours/02-cre.md that do not need a model. The seven that do are a
// separate model-profile suite.
//
// ══════════════════════════════════════════════════════════════════════════════

import './helpers/isolated-test-db.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CREDecisionEngine, DecisionType, IntentType } from '../src/chat/cre-decision.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// One attempt, no retry: C-04's bound. Six seconds today is three attempts at
// 2s and 4s against a refused connection; one attempt fails immediately.
const CLASSIFICATION_BOUND_MS = 2000;

let pass = 0;
let fail = 0;
const failures = [];

function check(condition, label) {
  if (condition) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; failures.push(label); console.error(`  ❌ ${label}`); }
}

const cre = new CREDecisionEngine();

async function main() {
  console.log('\n══ Capability #2 — CRE deterministic behaviours ══\n');

  // ── C-01 / C-02 — LOCAL is classified and terminal, with no model call ─────
  // The engine is constructed with no LLM wired in, so any model call would
  // throw or hang rather than silently succeed.
  const clock = await cre.decide('kolik je hodin?');
  const math = await cre.decide('kolik je 17 * 23?');

  check(
    clock.intent === IntentType.LOCAL && math.intent === IntentType.LOCAL,
    'C-01 — a clock question and an arithmetic question classify as LOCAL',
  );
  check(
    clock.metadata?.localComputation === true && math.metadata?.localComputation === true,
    'C-01b — LOCAL answers are computed locally, not requested from a model',
  );
  check(
    clock.type === DecisionType.LOCAL && math.type === DecisionType.LOCAL
    && (clock.tools?.length ?? 0) === 0 && (math.tools?.length ?? 0) === 0,
    'C-02 — LOCAL is a terminal decision that calls no tool and no gateway',
  );

  // ── C-03 — every decision carries its own provenance ──────────────────────
  check(
    typeof clock.metadata?.classifiedBy === 'string'
    && clock.metadata.classifiedBy.length > 0
    && typeof clock.confidence === 'number'
    && Number.isFinite(clock.metadata?.classificationTimeMs),
    'C-03 — a decision records classifiedBy, confidence and its classification time',
  );

  // ── C-04 — an unreachable model degrades fast and never throws ────────────
  // "napiš mi báseň" has no deterministic pattern, so it must go to the model,
  // find nothing listening, and fall back to regex.
  const started = Date.now();
  let threw = null;
  let fallback = null;
  try {
    fallback = await cre.decide('napiš mi báseň o podzimu');
  } catch (err) {
    threw = err;
  }
  const elapsed = Date.now() - started;

  check(threw === null && fallback !== null, 'C-04 — an unreachable model never throws out of decide()');
  check(
    fallback?.intent !== undefined && fallback?.type !== undefined,
    'C-04b — an unreachable model still yields a decision through the regex fallback',
  );
  check(
    elapsed < CLASSIFICATION_BOUND_MS,
    `C-04c — classification does not wait on retries (${elapsed} ms, bound ${CLASSIFICATION_BOUND_MS} ms)`,
  );

  // C-07 - nothing reaches an answer without a CRE decision
  // Structural: every handler that answers must obtain a decision from the
  // engine, and the only sanctioned way past it is the audited intercept.
  const conversation = readFileSync(path.join(ROOT, 'src/chat/handlers/conversation.js'), 'utf8');
  const engine = readFileSync(path.join(ROOT, 'src/chat/cre-decision.js'), 'utf8');
  check(
    /creDecisionEngine\.decide\s*\(/.test(conversation),
    'C-07 - the conversation handler obtains its decision from the CRE engine',
  );
  check(
    /logIntercept\s*\(/.test(engine) && /overrideDecision\s*\(/.test(engine),
    'C-07b - the engine provides audited overrides so a bypass leaves a record',
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
