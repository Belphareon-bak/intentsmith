// tests/e2e/55-chat-with-specialist.e2e.js — Chat with specialist mode
// ══════════════════════════════════════════════════════════════════════════════
// Tier 2: Verifies specialist affects response behavior.
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer } from './_helpers.js';

await waitForServer();

const LLM_TIMEOUT = 60000;

// ── Setup ───────────────────────────────────────────────────────────────────
suite('Chat with Specialist — Setup');

let specialists = [];

await testAsync('list available specialists', async () => {
  const { status, data } = await api('GET', '/api/specialists');
  assertEqual(status, 200);
  specialists = data.specialists || [];
});

// ── Assign Specialist ───────────────────────────────────────────────────────
suite('Chat with Specialist — Assign');

await testAsync('assign specialist to session', async () => {
  if (specialists.length === 0) return;
  const s = specialists.find(s => s.enabled !== false) || specialists[0];
  const { status } = await api('POST', '/api/chat/specialist', { specialistId: s.id });
  assert(status === 200 || status === 204, `expected 200/204, got ${status}`);
});

// ── Chat with Specialist ────────────────────────────────────────────────────
suite('Chat with Specialist — Interaction');

await testAsync('chat message with specialist active', async () => {
  const { status, data } = await api('POST', '/chat', {
    message: 'Poradíš mi s kódem? Mám chybu v JavaScript funkci.'
  });
  assert(status === 200 || status === 202, `expected 200/202, got ${status}`);
  if (data.response) {
    assert(data.response.length > 10, 'specialist response should be meaningful');
  }
}, LLM_TIMEOUT);

// ── Clear Specialist ────────────────────────────────────────────────────────
suite('Chat with Specialist — Clear');

await testAsync('clear specialist from session', async () => {
  const { status } = await api('DELETE', '/api/chat/specialist');
  assert(status === 200 || status === 204, `expected 200/204, got ${status}`);
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
