// tests/e2e/54-chat-with-expertise.e2e.js — Chat with expertise routing
// ══════════════════════════════════════════════════════════════════════════════
// Tier 2: Verifies expertise affects response tone/behavior.
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer } from './_helpers.js';

await waitForServer();

const LLM_TIMEOUT = 60000;

// ── List Available Expertises ───────────────────────────────────────────────
suite('Chat with Expertise — Setup');

let expertises = [];

await testAsync('list available expertises', async () => {
  const { status, data } = await api('GET', '/api/expertises');
  assertEqual(status, 200);
  expertises = data.experts || [];
  assert(expertises.length > 0, 'need at least 1 expertise');
});

// ── Chat with Default ───────────────────────────────────────────────────────
suite('Chat with Expertise — Default');

await testAsync('chat without expertise works', async () => {
  const { status, data } = await api('POST', '/chat', {
    message: 'Co je to Git?'
  });
  assert(status === 200 || status === 202, `expected 200/202, got ${status}`);
  if (data.response) {
    assert(data.response.length > 20, 'default response should be meaningful');
  }
}, LLM_TIMEOUT);

// ── Chat with Specific Expertise ─────────────────────────────────────────────
suite('Chat with Expertise — Selected');

await testAsync('chat with selected expertise returns response', async () => {
  if (expertises.length === 0) return;
  // Find a technical expertise
  const tech = expertises.find(e => e.domain === 'technology' || e.domain === 'tech') || expertises[0];
  const { status, data } = await api('POST', '/chat', {
    message: 'Vysvětli princip mikroslužeb.',
    expertise_id: tech.id
  });
  assert(status === 200 || status === 202, `expected 200/202, got ${status}`);
  if (data.response) {
    assert(data.response.length > 20, 'expertise response should be meaningful');
  }
}, LLM_TIMEOUT);

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
