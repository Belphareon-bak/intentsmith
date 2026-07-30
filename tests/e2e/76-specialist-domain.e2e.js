// tests/e2e/76-specialist-domain.e2e.js — Specialist Domain Knowledge Verification
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3: Verifies specialists inject domain-specific knowledge into responses.
// Tests accountant-cz and translator specialists with domain queries.
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite, testAsync, assert, assertEqual, summary,
  api, waitForServer, createConv, chatWithTimeout, hasKeywords,
  cleanupConversation, LLM_TIMEOUT,
} from './_helpers.js';

await waitForServer();

const created = [];
let accountant = null;
let translator = null;
let accountantConvId = null;
let translatorConvId = null;

try {
  suite('Specialist — Listing');

  await testAsync('list specialists returns array', async () => {
    const { status, data } = await api('GET', '/api/specialists');
    assertEqual(status, 200);
    assertEqual(data.ok, true);
    assert(Array.isArray(data.specialists), 'specialists must be an array');
    accountant = data.specialists.find(item => item.id === 'accountant-cz');
    translator = data.specialists.find(item => item.id === 'translator');
    assert(accountant, 'accountant-cz specialist fixture required');
    assert(translator, 'translator specialist fixture required');
  });

  suite('Specialist — Accountant');

  await testAsync('set accountant specialist', async () => {
    accountantConvId = await createConv('spec-accountant');
    created.push(accountantConvId);
    const { status, data } = await api('POST', '/api/chat/specialist', {
      specialistId: accountant.id,
      sessionId: accountantConvId,
    });
    assertEqual(status, 200);
    assertEqual(data.ok, true);
    assertEqual(data.specialistId, accountant.id);

    const session = await api('GET', `/api/chat/sessions/${accountantConvId}`);
    assertEqual(session.status, 200);
    assertEqual(session.data.state.specialist.id, accountant.id);
  });

  await testAsync('accountant answers tax question with domain terms', async () => {
    const r = await chatWithTimeout(
      accountantConvId,
      'Jaký je základ daně z příjmu pro OSVČ?',
      LLM_TIMEOUT,
    );
    assertEqual(r.mode, 'specialist');
    assert(hasKeywords(r.response,
      ['daň', 'základ', 'sazb', 'příjem', 'osvč', '15', '23', 'slev', 'odpočet'], 2),
      `accountant should use tax terminology: ${r.response.substring(0, 200)}`);
  }, LLM_TIMEOUT);

  await testAsync('accountant knows tax deadlines', async () => {
    const r = await chatWithTimeout(
      accountantConvId,
      'Kdy je termín pro podání daňového přiznání?',
      LLM_TIMEOUT,
    );
    assertEqual(r.mode, 'specialist');
    assert(hasKeywords(r.response,
      ['břez', 'dubn', 'termín', 'lhůt', 'podání', 'přiznání', 'finančn', 'úřad'], 2),
      `accountant should mention deadlines: ${r.response.substring(0, 200)}`);
  }, LLM_TIMEOUT);

  suite('Specialist — Clear');

  await testAsync('clear accountant specialist', async () => {
    const { status, data } = await api('DELETE', '/api/chat/specialist', {
      sessionId: accountantConvId,
    });
    assertEqual(status, 200);
    assertEqual(data.ok, true);

    const session = await api('GET', `/api/chat/sessions/${accountantConvId}`);
    assertEqual(session.status, 200);
    assertEqual(session.data.state.specialist, null);
  });

  suite('Specialist — Translator');

  await testAsync('set translator specialist', async () => {
    translatorConvId = await createConv('spec-translator');
    created.push(translatorConvId);
    const { status, data } = await api('POST', '/api/chat/specialist', {
      specialistId: translator.id,
      sessionId: translatorConvId,
    });
    assertEqual(status, 200);
    assertEqual(data.ok, true);
    assertEqual(data.specialistId, translator.id);

    const session = await api('GET', `/api/chat/sessions/${translatorConvId}`);
    assertEqual(session.status, 200);
    assertEqual(session.data.state.specialist.id, translator.id);
  });

  await testAsync('translator handles translation request', async () => {
    const r = await chatWithTimeout(
      translatorConvId,
      'Přelož do angličtiny: Dnes je krásný den',
      LLM_TIMEOUT,
    );
    assertEqual(r.mode, 'specialist');
    assert(hasKeywords(r.response, ['today', 'beautiful', 'nice', 'lovely', 'day'], 2),
      `translator should produce English translation: ${r.response.substring(0, 200)}`);
  }, LLM_TIMEOUT);

  suite('Specialist — Mode Change After Clear');

  await testAsync('after clearing specialist, mode changes', async () => {
    const cleared = await api('DELETE', '/api/chat/specialist', {
      sessionId: translatorConvId,
    });
    assertEqual(cleared.status, 200);
    assertEqual(cleared.data.ok, true);

    const session = await api('GET', `/api/chat/sessions/${translatorConvId}`);
    assertEqual(session.status, 200);
    assertEqual(session.data.state.specialist, null);

    const r = await chatWithTimeout(translatorConvId, 'Ahoj, jak se máš?', LLM_TIMEOUT);
    assertEqual(r.mode, 'conversation');
    assert(r.response.length > 0, 'should still produce response without specialist');
  }, LLM_TIMEOUT);

} finally {
  for (const id of created) {
    try {
      await api('DELETE', '/api/chat/specialist', { sessionId: id });
    } catch {}
  }
  for (const id of created) await cleanupConversation(id);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
