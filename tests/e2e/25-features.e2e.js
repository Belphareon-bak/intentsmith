// tests/e2e/25-features.e2e.js — Feature flags list, toggle, reset
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer } from './_helpers.js';

await waitForServer();

// ── List ─────────────────────────────────────────────────────────────────────
suite('GET /api/features');

let originalSkills;

await testAsync('returns features object', async () => {
  const { status, data } = await api('GET', '/api/features');
  assertEqual(status, 200);
  assert(data.features && typeof data.features === 'object', 'features object required');
  assert(Object.keys(data.features).length > 0, 'at least one feature required');
  assert(Object.values(data.features).every(value => typeof value === 'boolean'), 'feature values must be boolean');
  originalSkills = data.features.skills;
  assertEqual(typeof originalSkills, 'boolean');
});

// ── Toggle ──────────────────────────────────────────────────────────────────
suite('POST /api/features/:name — toggle');

await testAsync('toggle known feature succeeds', async () => {
  const { status, data } = await api('POST', '/api/features/skills', {
    enabled: !originalSkills,
  });
  assertEqual(status, 200);
  assertEqual(data.ok, true);
  assertEqual(data.features.skills, !originalSkills);

  const current = await api('GET', '/api/features');
  assertEqual(current.status, 200);
  assertEqual(current.data.features.skills, !originalSkills);
});

await testAsync('toggle unknown feature returns 400', async () => {
  const { status, data } = await api('POST', '/api/features/nonexistent-feature-xyz', { enabled: true });
  assertEqual(status, 400);
  assert(data.error.includes('Unknown feature'), 'unknown-feature error required');
});

// ── Reset ───────────────────────────────────────────────────────────────────
suite('POST /api/features/reset');

await testAsync('reset features to defaults', async () => {
  const { status, data } = await api('POST', '/api/features/reset');
  assertEqual(status, 200);
  assertEqual(data.ok, true);
  assertEqual(data.features.skills, originalSkills);
});

await testAsync('features restored after reset', async () => {
  const { status, data } = await api('GET', '/api/features');
  assertEqual(status, 200);
  assertEqual(data.features.skills, originalSkills);
});

// ── Autocomplete ────────────────────────────────────────────────────────────
suite('POST /api/autocomplete');

await testAsync('autocomplete with short prefix returns exact null without model I/O', async () => {
  const { status, data } = await api('POST', '/api/autocomplete', {
    partial: 'Ja',
    context: [],
  });
  assertEqual(status, 200);
  assertEqual(data.suggestion, null);
});

// ── Context ─────────────────────────────────────────────────────────────────
suite('POST /api/context');

await testAsync('context estimate returns percentage', async () => {
  const { status, data } = await api('POST', '/api/context', { messageCount: 8 });
  assertEqual(status, 200);
  assertEqual(data.percent, 20);
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
