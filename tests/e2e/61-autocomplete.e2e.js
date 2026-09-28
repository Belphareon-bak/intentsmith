// tests/e2e/61-autocomplete.e2e.js — Autocomplete suggestion API
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3: Requires the bound CHAT model for suggestion generation.
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer } from './_helpers.js';

await waitForServer();

const LLM_TIMEOUT = 120000;

// ── Short Prefix ────────────────────────────────────────────────────────────
suite('Autocomplete — Short Prefix');

await testAsync('very short prefix returns null suggestion', async () => {
  const { status, data } = await api('POST', '/api/autocomplete', { partial: 'Co' });
  assertEqual(status, 200);
  assertEqual(data.suggestion, null);
});

// ── Valid Prefix ────────────────────────────────────────────────────────────
suite('Autocomplete — Valid Prefix');

await testAsync('longer prefix returns a non-empty suggestion', async () => {
  const { status, data } = await api('POST', '/api/autocomplete', {
    partial: 'Jak mohu vytvořit'
  });
  assertEqual(status, 200);
  assert(typeof data.suggestion === 'string', 'suggestion must be string');
  assert(data.suggestion.trim().length > 0, 'suggestion must be non-empty');
}, LLM_TIMEOUT);

// ── Context Influence ───────────────────────────────────────────────────────
suite('Autocomplete — Context');

await testAsync('autocomplete with context param works', async () => {
  const { status, data } = await api('POST', '/api/autocomplete', {
    partial: 'Vysvětli mi',
    context: [
      { role: 'user', text: 'Učím se programovat v Pythonu.' },
      { role: 'assistant', text: 'Můžeme projít základní datové typy.' },
    ],
  });
  assertEqual(status, 200);
  assert(typeof data.suggestion === 'string', 'context suggestion must be string');
  assert(data.suggestion.trim().length > 0, 'context suggestion must be non-empty');
}, LLM_TIMEOUT);

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
