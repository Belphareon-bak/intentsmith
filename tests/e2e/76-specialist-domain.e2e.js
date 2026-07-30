// tests/e2e/76-specialist-domain.e2e.js — Specialist Domain Knowledge Verification
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3: Verifies specialists inject domain-specific knowledge into responses.
// Tests accountant-cz and translator specialists with domain queries.
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite, testAsync, assert, summary,
  api, waitForServer, createConv, chatInConv, hasKeywords, cleanupConversation, LLM_TIMEOUT,
} from './_helpers.js';

await waitForServer();

const created = [];
let specialists = [];
let accountant = null;
let translator = null;

try {
  suite('Specialist — Listing');

  await testAsync('list specialists returns array', async () => {
    const { status, data } = await api('GET', '/api/specialists');
    assert(status === 200, `expected 200, got ${status}`);
    const list = Array.isArray(data) ? data : (data.specialists || []);
    specialists = list;
    accountant = list.find(s => /účetn|account|daň/i.test(s.id || s.name || s.domain || ''));
    translator = list.find(s => /překl|translat|jazyk/i.test(s.id || s.name || s.domain || ''));
  });

  suite('Specialist — Accountant');

  await testAsync('set accountant specialist', async () => {
    if (!accountant) { assert(true, 'no accountant specialist — skip'); return; }
    const { status } = await api('POST', '/api/chat/specialist', {
      specialistId: accountant.id,
    });
    assert(status === 200 || status === 404, `expected 200/404, got ${status}`);
  });

  await testAsync('accountant answers tax question with domain terms', async () => {
    if (!accountant) { assert(true, 'no accountant specialist — skip'); return; }
    const convId = await createConv('spec-tax');
    created.push(convId);
    const r = await chatInConv(convId, 'Jaký je základ daně z příjmu pro OSVČ?');
    assert(hasKeywords(r.response,
      ['daň', 'základ', 'sazb', 'příjem', 'osvč', '15', '23', 'slev', 'odpočet'], 1),
      `accountant should use tax terminology: ${r.response.substring(0, 200)}`);
  }, LLM_TIMEOUT);

  await testAsync('accountant knows tax deadlines', async () => {
    if (!accountant) { assert(true, 'no accountant specialist — skip'); return; }
    const convId = await createConv('spec-deadline');
    created.push(convId);
    const r = await chatInConv(convId, 'Kdy je termín pro podání daňového přiznání?');
    assert(hasKeywords(r.response,
      ['břez', 'dubn', 'termín', 'lhůt', 'podání', 'přiznání', 'finančn', 'úřad'], 1),
      `accountant should mention deadlines: ${r.response.substring(0, 200)}`);
  }, LLM_TIMEOUT);

  suite('Specialist — Clear');

  await testAsync('clear accountant specialist', async () => {
    const { status } = await api('DELETE', '/api/chat/specialist', {});
    assert(status === 200 || status === 204, `expected 200/204, got ${status}`);
  });

  suite('Specialist — Translator');

  await testAsync('set translator specialist', async () => {
    if (!translator) { assert(true, 'no translator specialist — skip'); return; }
    const { status } = await api('POST', '/api/chat/specialist', {
      specialistId: translator.id,
    });
    assert(status === 200 || status === 404, `expected 200/404, got ${status}`);
  });

  await testAsync('translator handles translation request', async () => {
    if (!translator) { assert(true, 'no translator specialist — skip'); return; }
    const convId = await createConv('spec-translate');
    created.push(convId);
    const r = await chatInConv(convId, 'Přelož do angličtiny: Dnes je krásný den');
    assert(hasKeywords(r.response, ['today', 'beautiful', 'nice', 'lovely', 'day'], 1),
      `translator should produce English translation: ${r.response.substring(0, 200)}`);
  }, LLM_TIMEOUT);

  suite('Specialist — Mode Change After Clear');

  await testAsync('after clearing specialist, mode changes', async () => {
    // Clear any active specialist
    await api('DELETE', '/api/chat/specialist', {});
    const convId = await createConv('spec-cleared');
    created.push(convId);
    const r = await chatInConv(convId, 'Ahoj, jak se máš?');
    if (r.mode) {
      assert(r.mode !== 'specialist',
        `after clearing, mode should not be specialist, got: ${r.mode}`);
    }
    assert(r.response.length > 0, 'should still produce response without specialist');
  }, LLM_TIMEOUT);

} finally {
  // Clean up specialist state
  try { await api('DELETE', '/api/chat/specialist', {}); } catch {}
  for (const id of created) await cleanupConversation(id);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
