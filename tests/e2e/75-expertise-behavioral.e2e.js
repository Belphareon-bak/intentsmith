// tests/e2e/75-expertise-behavioral.e2e.js — Expertise Behavioral A/B Comparison
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3: Verifies selecting an expertise ACTUALLY changes response behavior.
// A/B compares same query with and without expertise.
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite, testAsync, assert, assertEqual, summary,
  api, waitForServer, createConv, chatWithTimeout, hasKeywords,
  cleanupConversation, LLM_TIMEOUT,
} from './_helpers.js';

await waitForServer();

const created = [];
let expertises = [];
let writer;
let developer;

try {
  suite('Expertise — Listing');

  await testAsync('list expertises returns canonical fixtures', async () => {
    const { status, data } = await api('GET', '/api/expertises');
    assertEqual(status, 200);
    assert(Array.isArray(data.experts) && data.experts.length >= 3, 'at least three expertises required');
    assert(Array.isArray(data.categories), 'expertise categories must be an array');
    expertises = data.experts;
    writer = expertises.find(item => item.id === 'writer');
    developer = expertises.find(item => item.id === 'developer');
    assert(writer, 'canonical writer expertise required');
    assert(developer, 'canonical developer expertise required');
  });

  suite('Expertise — Behavioral A/B');

  await testAsync('writer expertise activates canonical narrative mode', async () => {
    const convA = await createConv('exp-ab-no');
    created.push(convA);
    const rA = await chatWithTimeout(
      convA,
      'Jak působí noční město na člověka?',
      LLM_TIMEOUT,
    );

    const convB = await createConv('exp-ab-writer');
    created.push(convB);
    const rB = await chatWithTimeout(
      convB,
      'Jak působí noční město na člověka?',
      LLM_TIMEOUT,
      { expertise_id: writer.id },
    );

    assertEqual(rB.mode, 'expert');
    assert(rB.response.length > 80, 'writer response must be substantive');
    assert(
      hasKeywords(rB.response, ['měst', 'noc', 'svět', 'ulic', 'atmosf', 'člověk'], 2),
      `writer response must use narrative subject matter: ${rB.response.substring(0, 240)}`,
    );
    assert(rA.response !== rB.response, 'writer and baseline responses must not be identical');

    const session = await api('GET', `/api/chat/sessions/${convB}`);
    assertEqual(session.status, 200);
    assertEqual(session.data.state.expertise.id, writer.id);
  }, LLM_TIMEOUT * 2);

  await testAsync('tech expertise includes technical depth', async () => {
    const convId = await createConv('exp-tech');
    created.push(convId);
    const r = await chatWithTimeout(
      convId,
      'Co je to microservice?',
      LLM_TIMEOUT,
      { expertise_id: developer.id },
    );

    assertEqual(r.mode, 'expert');
    assert(hasKeywords(r.response, ['api', 'služb', 'service', 'kontejner', 'container',
      'škálov', 'dekompo', 'docker', 'kubernetes', 'rozděl'], 2),
      `tech expertise should include technical terms: ${r.response.substring(0, 200)}`);
  }, LLM_TIMEOUT);

  suite('Expertise — GUARD 6: Creative Lock');

  await testAsync('writer expertise blocks SEARCH intent', async () => {
    const convId = await createConv('exp-guard6');
    created.push(convId);
    const r = await chatWithTimeout(
      convId,
      'Prokletý ostrov',
      LLM_TIMEOUT,
      { expertise_id: writer.id },
    );

    assert(!hasKeywords(r.response, ['http://', 'https://'], 1),
      'creative lock should suppress URLs in response');
    assertEqual(r.intent, 'CREATIVE');
  }, LLM_TIMEOUT);

  suite('Expertise — Persistence Across Turns');

  await testAsync('expertise persists across turns in conversation', async () => {
    const convId = await createConv('exp-persist');
    created.push(convId);
    const r1 = await chatWithTimeout(
      convId,
      'Vysvětli REST API',
      LLM_TIMEOUT,
      { expertise_id: developer.id },
    );
    assertEqual(r1.mode, 'expert');
    const r2 = await chatWithTimeout(convId, 'A jak se autentizuje?', LLM_TIMEOUT);
    assertEqual(r2.mode, 'expert');
    assert(r2.response.length > 30, 'follow-up should have substantial response');

    const session = await api('GET', `/api/chat/sessions/${convId}`);
    assertEqual(session.status, 200);
    assertEqual(session.data.state.expertise.id, developer.id);
  }, LLM_TIMEOUT * 2);

  suite('Expertise — Multiple Expertises Differ');

  await testAsync('same question to different expertises produces different responses', async () => {
    const selected = [
      writer,
      developer,
      expertises.find(item => item.id === 'analyst'),
    ];
    assert(selected.every(Boolean), 'writer, developer and analyst fixtures required');
    const responses = [];
    for (let i = 0; i < selected.length; i++) {
      const convId = await createConv(`exp-multi-${i}`);
      created.push(convId);
      const r = await chatWithTimeout(
        convId,
        'Napiš krátký text o vodě',
        LLM_TIMEOUT,
        { expertise_id: selected[i].id },
      );
      assertEqual(r.mode, 'expert');
      responses.push(r.response);

      const session = await api('GET', `/api/chat/sessions/${convId}`);
      assertEqual(session.status, 200);
      assertEqual(session.data.state.expertise.id, selected[i].id);
    }

    assert(new Set(responses).size >= 2, 'at least two expertise responses must differ');
  }, LLM_TIMEOUT * 3);

  suite('Expertise — Default Baseline');

  await testAsync('no expertise = conversation mode', async () => {
    const convId = await createConv('exp-baseline');
    created.push(convId);
    const r = await chatWithTimeout(convId, 'Ahoj, jak se máš?', LLM_TIMEOUT);
    assert(r.response.length > 30, 'baseline response should be substantial');
    assertEqual(r.mode, 'conversation');

    const session = await api('GET', `/api/chat/sessions/${convId}`);
    assertEqual(session.status, 200);
    assertEqual(session.data.state.expertise, null);
  }, LLM_TIMEOUT);

} finally {
  for (const id of created) await cleanupConversation(id);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
