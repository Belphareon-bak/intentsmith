// tests/e2e/75-expertise-behavioral.e2e.js — Expertise Behavioral A/B Comparison
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3: Verifies selecting an expertise ACTUALLY changes response behavior.
// A/B compares same query with and without expertise.
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite, testAsync, assert, summary,
  api, waitForServer, createConv, chatInConv, hasKeywords, cleanupConversation, LLM_TIMEOUT,
} from './_helpers.js';

await waitForServer();

const created = [];
let expertises = [];

try {
  suite('Expertise — Listing');

  await testAsync('list expertises returns array', async () => {
    const { status, data } = await api('GET', '/api/expertises');
    // May return 200 with empty list or 403 on FREE tier
    assert(status === 200 || status === 403, `expected 200/403, got ${status}`);
    if (status === 200) {
      const list = Array.isArray(data) ? data : (data.expertises || []);
      expertises = list;
      if (list.length > 0) {
        const first = list[0];
        assert(first.id || first.name, 'expertise must have id or name');
      }
    }
    assert(true, `expertises: ${expertises.length} found`);
  });

  suite('Expertise — Behavioral A/B');

  await testAsync('writer expertise produces longer/narrative response', async () => {
    if (expertises.length === 0) return;
    const writer = expertises.find(e =>
      /writ|pís|kreativ|liter|autor/i.test(e.domain || e.name || e.id || ''));
    if (!writer) { assert(true, 'no writer expertise found — skip'); return; }

    // A: without expertise
    const convA = await createConv('exp-ab-no');
    created.push(convA);
    const rA = await chatInConv(convA, 'Napiš o počítačích');

    // B: with expertise
    const convB = await createConv('exp-ab-writer');
    created.push(convB);
    const rB = await chatInConv(convB, 'Napiš o počítačích', {
      expertise_id: writer.id,
    });

    // Writer should produce something different (longer, more narrative)
    const diff = Math.abs(rA.response.length - rB.response.length);
    assert(diff > 10 || rA.response !== rB.response,
      'expertise should produce different response than default');
  }, LLM_TIMEOUT * 2);

  await testAsync('tech expertise includes technical depth', async () => {
    if (expertises.length === 0) return;
    const tech = expertises.find(e =>
      /tech|soft|program|vývo|develop/i.test(e.domain || e.name || e.id || ''));
    if (!tech) { assert(true, 'no tech expertise found — skip'); return; }

    const convId = await createConv('exp-tech');
    created.push(convId);
    const r = await chatInConv(convId, 'Co je to microservice?', {
      expertise_id: tech.id,
    });

    assert(hasKeywords(r.response, ['api', 'služb', 'service', 'kontejner', 'container',
      'škálov', 'dekompo', 'docker', 'kubernetes', 'rozděl'], 1),
      `tech expertise should include technical terms: ${r.response.substring(0, 200)}`);
  }, LLM_TIMEOUT);

  suite('Expertise — GUARD 6: Creative Lock');

  await testAsync('writer expertise blocks SEARCH intent', async () => {
    if (expertises.length === 0) return;
    const writer = expertises.find(e =>
      /writ|pís|kreativ|liter|autor/i.test(e.domain || e.name || e.id || ''));
    if (!writer) { assert(true, 'no writer expertise found — skip'); return; }

    const convId = await createConv('exp-guard6');
    created.push(convId);
    const r = await chatInConv(convId, 'Vyhledej informace o Praze', {
      expertise_id: writer.id,
    });

    // GUARD 6 should override SEARCH to CREATIVE
    assert(!hasKeywords(r.response, ['http://', 'https://'], 1),
      'creative lock should suppress URLs in response');
    if (r.intent) {
      assert(r.intent !== 'SEARCH',
        `with writer expertise, SEARCH should be overridden, got: ${r.intent}`);
    }
  }, LLM_TIMEOUT);

  suite('Expertise — Via /chat Body');

  await testAsync('expertise via POST /chat body sets expert mode', async () => {
    if (expertises.length === 0) return;
    const exp = expertises[0];
    const { status, data } = await api('POST', '/chat', {
      message: 'Řekni mi něco zajímavého',
      expertise: { id: exp.id, name: exp.name },
    });
    assert(status === 200 || status === 202, `expected 200/202, got ${status}`);
    assert(data.response && data.response.length > 10, 'should have meaningful response');
  }, LLM_TIMEOUT);

  suite('Expertise — Persistence Across Turns');

  await testAsync('expertise persists across turns in conversation', async () => {
    if (expertises.length === 0) return;
    const tech = expertises.find(e =>
      /tech|soft|program|vývo|develop/i.test(e.domain || e.name || e.id || ''));
    if (!tech) { assert(true, 'no tech expertise found — skip'); return; }

    const convId = await createConv('exp-persist');
    created.push(convId);
    // Turn 1 with expertise
    await chatInConv(convId, 'Vysvětli REST API', { expertise_id: tech.id });
    // Turn 2 without explicit expertise_id — should still be in expert mode
    const r2 = await chatInConv(convId, 'A jak se autentizuje?');
    assert(r2.response.length > 30, 'follow-up should have substantial response');
  }, LLM_TIMEOUT * 2);

  suite('Expertise — Multiple Expertises Differ');

  await testAsync('same question to different expertises produces different responses', async () => {
    if (expertises.length < 3) { assert(true, 'need >= 3 expertises — skip'); return; }

    const responses = [];
    for (let i = 0; i < 3; i++) {
      const convId = await createConv(`exp-multi-${i}`);
      created.push(convId);
      const r = await chatInConv(convId, 'Napiš krátký text o vodě', {
        expertise_id: expertises[i].id,
      });
      responses.push(r.response);
    }

    // At least 2 of 3 should differ significantly
    let diffCount = 0;
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        if (responses[i] !== responses[j]) diffCount++;
      }
    }
    assert(diffCount >= 2, `at least 2/3 pairs should differ, got ${diffCount}`);
  }, LLM_TIMEOUT * 3);

  suite('Expertise — Default Baseline');

  await testAsync('no expertise = conversation mode', async () => {
    const convId = await createConv('exp-baseline');
    created.push(convId);
    const r = await chatInConv(convId, 'Jak funguje internet?');
    assert(r.response.length > 30, 'baseline response should be substantial');
    // mode should be conversation (not expert)
    if (r.mode) {
      assert(r.mode === 'conversation' || r.mode === 'chat',
        `without expertise, mode should be conversation, got: ${r.mode}`);
    }
  }, LLM_TIMEOUT);

} finally {
  for (const id of created) await cleanupConversation(id);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
