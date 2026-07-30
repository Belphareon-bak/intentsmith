// tests/e2e/54-chat-with-expertise.e2e.js — Chat with expertise routing
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3: Requires Ollama. The legacy /chat endpoint accepts a full `expertise`
// object, not `expertise_id`; session state proves the selected expertise was used.
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

const MODEL_TIMEOUT = LLM_TIMEOUT * 5;
const sessions = [];
let expertises = [];
let selectedExpertise = null;

try {
  suite('Chat with Expertise — Setup');

  await testAsync('list available expertises', async () => {
    const { status, data } = await api('GET', '/api/expertises');
    assertEqual(status, 200);
    assert(Array.isArray(data.experts), 'response.experts must be an array');
    expertises = data.experts;
    assert(expertises.length > 0, 'at least one expertise is a required prerequisite');
    selectedExpertise = expertises.find(expertise => expertise.id === 'developer')
      || expertises.find(expertise => /tech|soft|program|develop/i.test(
        `${expertise.domain || ''} ${expertise.name || ''} ${expertise.id || ''}`,
      ))
      || expertises[0];
    assert(
      typeof selectedExpertise.id === 'string' && selectedExpertise.id.length > 0,
      'selected expertise must have an id',
    );
  });

  suite('Chat with Expertise — Default');

  await testAsync('chat without explicit expertise returns a response', async signal => {
    const sessionId = uniqueId('expertise-default');
    sessions.push(sessionId);
    const { status, data } = await api('POST', '/chat', {
      session_id: sessionId,
      message: 'Co je to Git?',
    }, signal);
    assertEqual(status, 200);
    assertEqual(data.session_id, sessionId);
    assert(
      typeof data.response === 'string' && data.response.trim().length > 20,
      'default response must be non-empty and substantive',
    );
    assert(
      hasKeywords(data.response, ['git', 'verz', 'version', 'commit', 'repozit'], 1),
      `default response should address Git: ${data.response.substring(0, 240)}`,
    );
  }, MODEL_TIMEOUT);

  suite('Chat with Expertise — Selected');

  await testAsync('full expertise object is applied to the requested session', async signal => {
    const sessionId = uniqueId('expertise-selected');
    sessions.push(sessionId);
    const { status, data } = await api('POST', '/chat', {
      session_id: sessionId,
      message: 'Vysvětli princip mikroslužeb.',
      expertise: selectedExpertise,
    }, signal);
    assertEqual(status, 200);
    assertEqual(data.session_id, sessionId);
    assert(
      typeof data.response === 'string' && data.response.trim().length > 20,
      'expertise response must be non-empty and substantive',
    );
    assert(
      hasKeywords(data.response, ['mikrosluž', 'microservice', 'služb', 'service', 'api'], 1),
      `expertise response should address microservices: ${data.response.substring(0, 240)}`,
    );

    const info = await api('GET', `/api/chat/sessions/${sessionId}`, undefined, signal);
    assertEqual(info.status, 200);
    assertEqual(info.data.exists, true);
    assertEqual(
      info.data.state?.expertise?.id,
      selectedExpertise.id,
      'session state must retain the explicitly supplied expertise',
    );
    assertEqual(
      info.data.state?.expertiseLocked,
      true,
      'explicit expertise selection must be locked in session state',
    );
  }, MODEL_TIMEOUT);
} finally {
  for (const sessionId of sessions) {
    try { await api('DELETE', `/api/chat/sessions/${sessionId}`); } catch {}
    await cleanupConversation(sessionId);
  }
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
