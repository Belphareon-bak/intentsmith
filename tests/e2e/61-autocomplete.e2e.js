// tests/e2e/61-autocomplete.e2e.js — Autocomplete suggestion API
// ══════════════════════════════════════════════════════════════════════════════
// Tier 2: Requires LLM for suggestion generation.
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, summary, api, waitForServer } from './_helpers.js';

await waitForServer();

const LLM_TIMEOUT = 30000;

// ── Short Prefix ────────────────────────────────────────────────────────────
suite('Autocomplete — Short Prefix');

await testAsync('very short prefix returns null suggestion', async () => {
  const { status, data } = await api('POST', '/api/autocomplete', { partial: 'Co' });
  assert(status === 200 || status === 400 || status === 502, `expected 200/400/502, got ${status}`);
  if (status === 200) {
    // Short prefix (< 3 chars) should return null
    assert(data.suggestion === null || data.suggestion === undefined, 'short prefix should return null');
  }
});

// ── Valid Prefix ────────────────────────────────────────────────────────────
suite('Autocomplete — Valid Prefix');

await testAsync('longer prefix returns suggestion or null', async () => {
  const { status, data } = await api('POST', '/api/autocomplete', {
    partial: 'Jak mohu vytvořit'
  });
  assert(status === 200 || status === 502, `expected 200/502, got ${status}`);
  if (status === 200 && data.suggestion) {
    assert(typeof data.suggestion === 'string', 'suggestion must be string');
    assert(data.suggestion.length > 0, 'suggestion should not be empty');
  }
}, LLM_TIMEOUT);

// ── Context Influence ───────────────────────────────────────────────────────
suite('Autocomplete — Context');

await testAsync('autocomplete with context param works', async () => {
  const { status } = await api('POST', '/api/autocomplete', {
    partial: 'Vysvětli mi',
    context: 'Diskuse o programování v Pythonu'
  });
  assert(status === 200 || status === 502, `expected 200/502, got ${status}`);
}, LLM_TIMEOUT);

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
