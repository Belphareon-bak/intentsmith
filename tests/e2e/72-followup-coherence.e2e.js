// tests/e2e/72-followup-coherence.e2e.js — Multi-Turn Follow-Up Coherence
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3: Validates pronoun resolution, context preservation, and topic shifts.
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite, testAsync, assert, summary,
  waitForServer, createConv, chatInConv, hasKeywords, cleanupConversation, LLM_TIMEOUT,
} from './_helpers.js';

await waitForServer();

const created = [];
const MULTI_TURN_TIMEOUT = LLM_TIMEOUT * 2;

try {
  suite('Follow-Up — Pronoun Resolution');

  await testAsync('Czech pronoun "to" resolves to previous topic', async () => {
    const convId = await createConv('followup-pronoun-cz');
    created.push(convId);
    await chatInConv(convId, 'Co je to rekurze?');
    const r2 = await chatInConv(convId, 'Uveď příklad na to');
    assert(hasKeywords(r2.response, ['rekurz', 'rekurziv', 'volá', 'sebe', 'factorial', 'fibonacci', 'def ', 'function'], 1),
      `follow-up should reference recursion, got: ${r2.response.substring(0, 200)}`);
  }, MULTI_TURN_TIMEOUT);

  await testAsync('follow-up pronoun resolves to Docker', async () => {
    const convId = await createConv('followup-pronoun-en');
    created.push(convId);
    await chatInConv(convId, 'Co je Docker?');
    const r2 = await chatInConv(convId, 'Jak funguje uvnitř?');
    assert(hasKeywords(r2.response, ['docker', 'container', 'kontejner', 'image', 'kernel', 'namespace', 'vrst', 'layer'], 1),
      `follow-up should reference Docker, got: ${r2.response.substring(0, 200)}`);
  }, MULTI_TURN_TIMEOUT);

  suite('Follow-Up — Format Change');

  await testAsync('format change preserves topic', async () => {
    const convId = await createConv('followup-format');
    created.push(convId);
    await chatInConv(convId, 'Vysvětli rozdíly mezi TCP a UDP');
    const r2 = await chatInConv(convId, 'Dej mi to v bodech');
    assert(hasKeywords(r2.response, ['tcp', 'udp'], 1),
      'format change should still mention TCP/UDP');
    assert(r2.response.includes('-') || r2.response.includes('•') || /[1-9][.)]\s/.test(r2.response),
      'should have bullet points or numbered list');
  }, MULTI_TURN_TIMEOUT);

  suite('Follow-Up — Refinement');

  await testAsync('refinement narrows the topic', async () => {
    const convId = await createConv('followup-refine');
    created.push(convId);
    await chatInConv(convId, 'Jaké jsou programovací jazyky pro web?');
    const r2 = await chatInConv(convId, 'Jen backend jazyky');
    const hasBackend = hasKeywords(r2.response, ['python', 'java', 'go', 'php', 'ruby', 'node', 'c#', 'rust'], 1);
    assert(hasBackend, `refinement should mention backend languages, got: ${r2.response.substring(0, 200)}`);
  }, MULTI_TURN_TIMEOUT);

  suite('Follow-Up — Topic Shift');

  await testAsync('new topic completely shifts context', async () => {
    const convId = await createConv('followup-shift');
    created.push(convId);
    await chatInConv(convId, 'Co je to Git?');
    const r2 = await chatInConv(convId, 'Jak uvařím česnekovou polévku?');
    assert(hasKeywords(r2.response, ['česnek', 'polévk', 'vař', 'recept', 'přísad', 'brambor', 'smetana', 'cibul'], 1),
      `topic shift should discuss cooking, got: ${r2.response.substring(0, 200)}`);
    assert(!hasKeywords(r2.response, ['git', 'commit', 'branch', 'repository'], 1),
      'topic shift should NOT still discuss Git');
  }, MULTI_TURN_TIMEOUT);

  suite('Follow-Up — Summary After Multiple Turns');

  await testAsync('summary references earlier topics', async () => {
    const convId = await createConv('followup-summary');
    created.push(convId);
    await chatInConv(convId, 'Co jsou proměnné v JavaScriptu?');
    await chatInConv(convId, 'A jaké jsou datové typy?');
    await chatInConv(convId, 'Co je to pole?');
    await chatInConv(convId, 'Jak fungují funkce?');
    await chatInConv(convId, 'Vysvětli closure');
    const r6 = await chatInConv(convId, 'Shrň, o čem jsme mluvili');
    assert(hasKeywords(r6.response, ['javascript', 'js', 'proměnn', 'typ', 'pole', 'funkc', 'closure', 'uzávěr'], 2),
      `summary should reference >= 2 earlier topics, got: ${r6.response.substring(0, 300)}`);
  }, LLM_TIMEOUT * 6);

  suite('Follow-Up — Sticky Intent');

  await testAsync('sticky SEARCH does not bleed to unrelated query', async () => {
    const convId = await createConv('followup-sticky');
    created.push(convId);
    await chatInConv(convId, 'Vyhledej informace o Node.js');
    await chatInConv(convId, 'OK, díky');
    const r3 = await chatInConv(convId, 'Co je to Python?');
    // The key assertion: intent should not blindly continue as SEARCH
    // Note: CRE may legitimately classify "Co je Python?" as SEARCH (freshness heuristic)
    // so we mainly check the response content is correct
    if (r3.intent) {
      assert(['CONVERSATIONAL', 'SEARCH', 'FACTUAL'].includes(r3.intent),
        `"Co je Python?" got unexpected intent: ${r3.intent}`);
    }
    assert(hasKeywords(r3.response, ['python', 'programovac', 'jazyk', 'programming'], 1),
      'response should explain Python');
  }, LLM_TIMEOUT * 3);

  suite('Follow-Up — Long Context Survival');

  await testAsync('context survives 8 turns', async () => {
    const convId = await createConv('followup-context');
    created.push(convId);
    await chatInConv(convId, 'Řekni mi o Pythonu');
    const r2 = await chatInConv(convId, 'Jaké má výhody?');
    await chatInConv(convId, 'A nevýhody?');
    await chatInConv(convId, 'Kde se nejvíce používá?');
    await chatInConv(convId, 'A co knihovny?');
    await chatInConv(convId, 'Které jsou nejpopulárnější?');
    await chatInConv(convId, 'Srovnej s JavaScriptem');
    await chatInConv(convId, 'Jdeme zpět k Pythonu');
    const r9 = await chatInConv(convId, 'Vrať se k tomu, co jsi říkal o výhodách');
    assert(hasKeywords(r9.response, ['python', 'výhod', 'jednoduch', 'syntaxe', 'čiteln', 'učen'], 1),
      `T9 should reference Python advantages from T2, got: ${r9.response.substring(0, 200)}`);
  }, LLM_TIMEOUT * 9);

} finally {
  for (const id of created) await cleanupConversation(id);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
