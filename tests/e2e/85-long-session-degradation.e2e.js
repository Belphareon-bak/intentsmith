// tests/e2e/85-long-session-degradation.e2e.js — Long Session Degradation
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3+: Tests that the system maintains quality across 10+ turn conversations.
// Validates context retention, topic switching, and no memory drift.
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite, testAsync, assert, summary,
  waitForServer, chatInConv, createConv, hasKeywords,
  cleanupConversation, LLM_TIMEOUT,
} from './_helpers.js';

await waitForServer();
const created = [];
const LONG_TIMEOUT = LLM_TIMEOUT * 2; // 120s for multi-turn sequences

try {
  // ═══════════════════════════════════════════════════════════════════════════
  suite('Long Session — Context Retention (10 turns)');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('remembers topic after 10 turns', async () => {
    const convId = await createConv('long-1');
    created.push(convId);

    // Turn 1: Establish topic
    await chatInConv(convId, 'Povídejme si o programování v Pythonu. Co je seznam?');
    // Turns 2-9: Build context
    await chatInConv(convId, 'A co slovníky?');
    await chatInConv(convId, 'Jak se iteruje přes slovník?');
    await chatInConv(convId, 'A co list comprehension?');
    await chatInConv(convId, 'Uveď příklad s filtrem');
    await chatInConv(convId, 'A co generátory?');
    await chatInConv(convId, 'Jak se liší od iterátorů?');
    await chatInConv(convId, 'Dej mi příklad s yield');
    await chatInConv(convId, 'A dekorátory?');

    // Turn 10: Reference turn 1
    const r = await chatInConv(convId, 'Vrať se k tomu prvnímu tématu — co jsme říkali o seznamech?');
    assert(hasKeywords(r.response, ['seznam', 'list', 'python', 'pole', 'prvk', 'index', 'append'], 1),
      `after 10 turns, should remember lists topic: ${r.response.substring(0, 200)}`);
  }, LONG_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Long Session — Topic Switching');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('switches topic cleanly and returns', async () => {
    const convId = await createConv('long-2');
    created.push(convId);

    // Topic A: JavaScript
    const r1 = await chatInConv(convId, 'Co je closure v JavaScriptu?');
    assert(hasKeywords(r1.response, ['closure', 'uzávěr', 'funkc', 'scope', 'proměn'], 1), 'T1: JS closure');

    // Topic B: Cooking (complete switch)
    const r2 = await chatInConv(convId, 'A teď úplně jiné téma — jak se vaří risotto?');
    assert(hasKeywords(r2.response, ['risotto', 'rýž', 'vař', 'bujon', 'míchá', 'jídlo'], 1), 'T2: cooking');
    // Should NOT mention JavaScript
    assert(!hasKeywords(r2.response, ['javascript', 'closure', 'funkce', 'scope'], 1),
      `cooking answer should not mention JS: ${r2.response.substring(0, 200)}`);

    // Topic A return: JavaScript
    const r3 = await chatInConv(convId, 'Zpět k JavaScriptu — dej mi příklad closure');
    assert(hasKeywords(r3.response, ['closure', 'function', 'const', 'return', 'uzávěr'], 1),
      `should return to JS with example: ${r3.response.substring(0, 200)}`);
  }, LONG_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Long Session — Quality Maintenance');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('no JSON leak after many turns', async () => {
    const convId = await createConv('long-3');
    created.push(convId);

    // 5 turns of normal conversation
    await chatInConv(convId, 'Co je REST API?');
    await chatInConv(convId, 'A jaké jsou HTTP metody?');
    await chatInConv(convId, 'Vysvětli mi GET vs POST');
    await chatInConv(convId, 'A co PUT a DELETE?');
    const r5 = await chatInConv(convId, 'Shrň mi to celé v bodech');

    // After 5 turns: no JSON leak, no metadata leak
    assert(!r5.response.includes('"decision_type"'), 'no JSON metadata leak');
    assert(!r5.response.includes('"intent_type"'), 'no intent type leak');
    assert(!r5.response.includes('"confidence":'), 'no confidence leak');
    assert(r5.response.length > 50, 'summary should be substantive');
  }, LONG_TIMEOUT);

} finally {
  for (const id of created) await cleanupConversation(id);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
