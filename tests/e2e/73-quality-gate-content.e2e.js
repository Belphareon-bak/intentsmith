// tests/e2e/73-quality-gate-content.e2e.js — Quality Gate Content Enforcement
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3: Validates QGv2 pipeline catches JSON leaks, zombies, sparse responses.
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite, testAsync, assert, summary,
  waitForServer, createConv, chatInConv, hasKeywords, countSlovakMarkers,
  cleanupConversation, LLM_TIMEOUT,
} from './_helpers.js';

await waitForServer();

const created = [];

async function qgChat(message) {
  const convId = await createConv('qg-test');
  created.push(convId);
  return chatInConv(convId, message);
}

try {
  suite('Quality Gate — No JSON Leaks');

  await testAsync('normal query does not produce raw JSON', async () => {
    // Don't ask for JSON explicitly — that legitimately produces JSON
    const r = await qgChat('Co je to databáze?');
    const stripped = r.response.replace(/```[\s\S]*?```/g, '').trim();
    const looksLikeRawJson = stripped.startsWith('{') && stripped.endsWith('}') && stripped.length < 500;
    assert(!looksLikeRawJson,
      'normal query should not produce raw JSON object');
  }, LLM_TIMEOUT);

  await testAsync('no decision_type/intent_type leak across 3 sessions', async () => {
    const banned = ['decision_type', 'intent_type', '"confidence":', '"reason":'];
    for (let i = 0; i < 3; i++) {
      const r = await qgChat('Co je Git?');
      assert(!hasKeywords(r.response, banned, 1),
        `session ${i + 1}: response contains JSON metadata key`);
    }
  }, LLM_TIMEOUT * 3);

  suite('Quality Gate — Response Length Bounds');

  await testAsync('factual response has reasonable length', async () => {
    const r = await qgChat('Co je to proměnná?');
    assert(r.response.length > 30, `factual response too short: ${r.response.length}`);
    assert(r.response.length < 5000, `factual response too long: ${r.response.length}`);
  }, LLM_TIMEOUT);

  await testAsync('creative response has reasonable length', async () => {
    const r = await qgChat('Napiš haiku o programování');
    assert(r.response.length > 10, `creative response too short: ${r.response.length}`);
    assert(r.response.length < 3000, `creative response too long: ${r.response.length}`);
  }, LLM_TIMEOUT);

  suite('Quality Gate — Zombie Detection');

  await testAsync('no zombie meta-opener with short tail', async () => {
    const r = await qgChat('Vysvětli, co je to API');
    const text = r.response;
    const openers = ['samozřejmě!', 'jistě!', 'rád pomohu!', 'rád ti pomohu!', 'skvělý dotaz!'];
    for (const opener of openers) {
      if (text.toLowerCase().startsWith(opener)) {
        assert(text.length > 100,
          `zombie pattern: starts with "${opener}" but only ${text.length} chars total`);
      }
    }
  }, LLM_TIMEOUT);

  suite('Quality Gate — Code Output');

  await testAsync('code request includes code structure', async () => {
    const r = await qgChat('Napiš funkci v JS pro součet pole čísel');
    const hasCode = r.response.includes('```') ||
      hasKeywords(r.response, ['function', 'const ', 'let ', '=>', 'reduce', 'sum'], 1);
    assert(hasCode, `code request should contain code structure, got: ${r.response.substring(0, 200)}`);
  }, LLM_TIMEOUT);

  suite('Quality Gate — Structured Comparison');

  await testAsync('comparison has both sides and structure', async () => {
    const r = await qgChat('Porovnej React a Vue');
    assert(hasKeywords(r.response, ['react'], 1), 'should mention React');
    assert(hasKeywords(r.response, ['vue'], 1), 'should mention Vue');
    // Comparison can be structured (bullets, headers, bold) or prose — check for either
    const hasStructure = r.response.includes('-') || r.response.includes('•') ||
      /[1-9][.)]\s/.test(r.response) || r.response.includes('##') || r.response.includes('**') ||
      r.response.includes(':') || r.response.includes('\n\n');
    assert(hasStructure || r.response.length > 200,
      'comparison should have structural markers or be substantive (>200 chars)');
  }, LLM_TIMEOUT);

  suite('Quality Gate — No AI Disclaimer');

  await testAsync('no AI self-reference disclaimer', async () => {
    const r = await qgChat('Řekni mi o CSS');
    const disclaimers = ['as an ai', 'jako jazykový model', 'i\'m just an ai',
      'jako umělá inteligence', 'as a language model'];
    assert(!hasKeywords(r.response, disclaimers, 1),
      'response should not contain AI self-reference disclaimers');
  }, LLM_TIMEOUT);

  suite('Quality Gate — Batch Quality');

  await testAsync('5 diverse queries all pass basic quality', async () => {
    const queries = [
      'Co je to cloud?',
      'Vysvětli OOP',
      'Napiš příklad v Pythonu pro hello world',
      'Jaké jsou výhody TypeScriptu?',
      'Co je to REST API?',
    ];
    for (const q of queries) {
      const r = await qgChat(q);
      assert(r.response.length > 20, `"${q}" response too short: ${r.response.length}`);
      assert(!hasKeywords(r.response, ['decision_type', 'intent_type'], 1),
        `"${q}" has JSON leak`);
      assert(countSlovakMarkers(r.response) < 2,
        `"${q}" has Slovak contamination`);
    }
  }, LLM_TIMEOUT * 5);

} finally {
  for (const id of created) await cleanupConversation(id);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
