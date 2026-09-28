// tests/e2e/55-chat-with-specialist.e2e.js — Chat with specialist mode
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3: Requires Ollama. Assignment, interaction, and clear operations all
// use the same explicit session_id so the specialist cannot be set on session-0
// and silently tested through a different random session.
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite,
  testAsync,
  assert,
  assertEqual,
  summary,
  api,
  waitForServer,
  uniqueId,
  hasKeywords,
  cleanupConversation,
  LLM_TIMEOUT,
} from './_helpers.js';

await waitForServer();

const sessionId = uniqueId('specialist-chat');
let selectedSpecialist = null;

try {
  suite('Chat with Specialist — Setup');

  await testAsync('list and select an enabled specialist', async () => {
    const { status, data } = await api('GET', '/api/specialists');
    assertEqual(status, 200);
    assert(Array.isArray(data.specialists), 'response.specialists must be an array');
    selectedSpecialist = data.specialists.find(specialist => specialist.id === 'code-reviewer')
      || data.specialists.find(specialist => specialist.status === 'enabled')
      || null;
    assert(selectedSpecialist, 'an installed enabled specialist is a required prerequisite');
    assert(
      typeof selectedSpecialist.id === 'string' && selectedSpecialist.id.length > 0,
      'selected specialist must have an id',
    );
  });

  suite('Chat with Specialist — Assign');

  await testAsync('assign specialist to the explicit chat session', async () => {
    const { status, data } = await api('POST', '/api/chat/specialist', {
      sessionId,
      specialistId: selectedSpecialist.id,
    });
    assertEqual(status, 200);
    assertEqual(data.ok, true);
    assertEqual(data.specialistId, selectedSpecialist.id);
  });

  suite('Chat with Specialist — Interaction');

  await testAsync('chat uses the same specialist session', async signal => {
    const { status, data } = await api('POST', '/chat', {
      session_id: sessionId,
      message: 'Proveď stručný code review funkce: function add(a, b) { return a + b; }',
    }, signal);
    assertEqual(status, 200);
    assertEqual(data.session_id, sessionId);
    assert(
      typeof data.response === 'string' && data.response.trim().length > 10,
      'specialist response must be non-empty',
    );
    assert(
      hasKeywords(data.response, ['function', 'add', 'parametr', 'return', 'kód', 'code'], 1),
      `specialist response should address the supplied code: ${data.response.substring(0, 240)}`,
    );

    const info = await api('GET', `/api/chat/sessions/${sessionId}`, undefined, signal);
    assertEqual(info.status, 200);
    assertEqual(
      info.data.state?.specialist?.id,
      selectedSpecialist.id,
      'specialist must remain active on the interaction session',
    );
  }, LLM_TIMEOUT * 3);

  suite('Chat with Specialist — Clear');

  await testAsync('clear specialist from the same explicit session', async () => {
    const { status, data } = await api('DELETE', '/api/chat/specialist', { sessionId });
    assertEqual(status, 200);
    assertEqual(data.ok, true);

    const info = await api('GET', `/api/chat/sessions/${sessionId}`);
    assertEqual(info.status, 200);
    assertEqual(info.data.state?.specialist, null);
  });
} finally {
  try { await api('DELETE', '/api/chat/specialist', { sessionId }); } catch {}
  try { await api('DELETE', `/api/chat/sessions/${sessionId}`); } catch {}
  await cleanupConversation(sessionId);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
