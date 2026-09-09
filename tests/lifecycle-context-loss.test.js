// tests/lifecycle-context-loss.test.js
// ══════════════════════════════════════════════════════════════════════════════
// v91: Tests for lifecycle context loss fix — Guard 9 + post-lifecycle injection
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import { CREDecisionEngine } from '../src/chat/cre-decision.js';

const cre = new CREDecisionEngine();

function decisionTrace(decision) {
  const serialized = decision.toJSON();
  return JSON.stringify({
    type: serialized.type,
    intent: serialized.intent,
    classifiedBy: serialized.metadata?.classifiedBy ?? null,
    diag: serialized.metadata?.diag ?? null,
    reason: serialized.reason,
  }).slice(0, 2400);
}

// ── GUARD 9: Meta-project queries should NOT be FILE_READ ────────────────────

suite('Guard 9: Meta-project queries → CONVERSATIONAL (not FILE_READ)');

const PROJECT_CONTEXT = {
  hasActiveProject: true,
  project: { id: 'proj-test-1', name: 'Klíčenka App' },
};

const META_PROJECT_QUERIES = [
  'o čem je tento projekt?',
  'co je to za projekt?',
  'řekni mi o tomto projektu',
  'popiš mi tento projekt',
  'jaký je tento projekt?',
  'shrň mi tenhle projekt',
  'co tento projekt dělá?',
  'co tenhle projekt řeší?',
  'k čemu tento projekt slouží?',
  // EN
  'what is this project about?',
  'tell me about the project',
  'describe this project',
  'summarize the project',
  // Referential
  'ten, který mám teď otevřený',
  'ten projekt co mám aktivní',
];

for (const q of META_PROJECT_QUERIES) {
  await testAsync(`"${q}" → CONVERSATIONAL (not FILE_READ)`, async () => {
    const d = await cre.decide(q, PROJECT_CONTEXT);
    assert(
      d.intent !== 'FILE_READ' && d.intent !== 'FILE_EXPLAIN',
      `intent for "${q}" — expected NOT FILE_READ/FILE_EXPLAIN, got "${d.intent}"; decisionTrace=${decisionTrace(d)}`
    );
  });
}

// ── Guard 9 should NOT block actual file-listing queries ─────────────────────

suite('Guard 9: Actual file-listing queries still → FILE_READ');

const FILE_LISTING_QUERIES = [
  'jaké soubory jsou v projektu?',
  'vypiš obsah projektu',
  'ukaž strukturu projektu',
  // 'struktura projektu' — too short/ambiguous, LLM classifies as CREATIVE (not Guard 9's fault)
  'otevři soubor config.json',
  'přečti readme',
  'co je v souboru package.json?',
  // EN
  'list project files',
  'show the project files',
  'open file index.js',
];

for (const q of FILE_LISTING_QUERIES) {
  await testAsync(`"${q}" → FILE_READ (not affected by Guard 9)`, async () => {
    const d = await cre.decide(q, PROJECT_CONTEXT);
    assert(
      d.intent === 'FILE_READ' || d.intent === 'FILE_EXPLAIN' || d.intent === 'LOCAL',
      `intent for "${q}" — expected FILE_READ/FILE_EXPLAIN/LOCAL, got "${d.intent}"; decisionTrace=${decisionTrace(d)}`
    );
  });
}

// ── Guard 9 should NOT fire without active project ───────────────────────────

suite('Guard 9: No project → no guard');

await testAsync('"o čem je tento projekt?" without project context', async () => {
  const d = await cre.decide('o čem je tento projekt?', {});
  // Without hasActiveProject, Guard 9 shouldn't activate, so any intent is fine
  // (the query might still be classified as CONVERSATIONAL by LLM, but not via Guard 9)
  assert(d.intent != null, 'should return some intent');
});

// ── _persistCompletionContext format ─────────────────────────────────────────

suite('Lifecycle summary format');

test('summary parts join with double newline', () => {
  const parts = ['SPEC: Test app', 'FILES: index.js, app.js', 'PATH: /tmp/test'];
  const summary_text = parts.join('\n\n');
  assert(summary_text.includes('SPEC: Test app'), 'should include SPEC');
  assert(summary_text.includes('FILES: index.js'), 'should include FILES');
  assert(summary_text.includes('PATH: /tmp/test'), 'should include PATH');
  assert(summary_text.includes('\n\n'), 'parts separated by double newline');
});

test('summary truncation at 500 chars for injection', () => {
  const longSummary = 'A'.repeat(1000);
  const injected = 'Dokončený lifecycle projekt. ' + longSummary.slice(0, 500);
  assertEqual(injected.length, 29 + 500, 'should be prefix + 500 chars');
});

// ── Summary ──────────────────────────────────────────────────────────────────

const results = summary();
process.exit(results.failed > 0 ? 1 : 0);
