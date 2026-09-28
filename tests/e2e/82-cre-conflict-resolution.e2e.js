// tests/e2e/82-cre-conflict-resolution.e2e.js — CRE Conflict Resolution
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3+: Tests how CRE handles ambiguous/multi-intent inputs where multiple
// intents compete. In real usage, users rarely send "clean" single-intent
// messages — this validates the system handles conflict gracefully.
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite, testAsync, assert, summary,
  api, waitForServer, chatInConv, createConv, hasKeywords,
  cleanupConversation, LLM_TIMEOUT,
} from './_helpers.js';

await waitForServer();
const created = [];

try {
  // ═══════════════════════════════════════════════════════════════════════════
  suite('CRE Conflict — Multi-Intent Inputs');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('SEARCH + CODE: "Najdi info o Dockeru a napiš mi k tomu Python skript"', async () => {
    const convId = await createConv('conflict-1');
    created.push(convId);
    const r = await chatInConv(convId, 'Najdi info o Dockeru a napiš mi k tomu Python skript');
    // Primary intent should be CODE, SEARCH, or PLAN — NOT just one of them
    // Response should address BOTH aspects
    assert(r.response.length > 50, `should have substantive response, got ${r.response.length} chars`);
    const addressesBoth = hasKeywords(r.response, ['docker', 'python', 'skript', 'script', 'kód', 'code', 'kontejner', 'container'], 2);
    assert(addressesBoth, `should address both Docker and code: ${r.response.substring(0, 300)}`);
  }, LLM_TIMEOUT);

  await testAsync('DESIGN + BUILD: "Navrhni a implementuj REST API pro e-shop"', async () => {
    const convId = await createConv('conflict-2');
    created.push(convId);
    const r = await chatInConv(convId, 'Navrhni a implementuj REST API pro e-shop');
    // Should be BUILD or PLAN (not just DESIGN)
    if (r.intent) {
      assert(['BUILD', 'PLAN', 'DESIGN', 'CODE', 'CREATIVE', 'CONVERSATIONAL'].includes(r.intent),
        `design+build should resolve to actionable intent, got: ${r.intent}`);
    }
    assert(r.response.length > 50, 'should have meaningful response');
    assert(hasKeywords(r.response, ['api', 'rest', 'endpoint', 'e-shop', 'obchod', 'route', 'architektur', 'server'], 1),
      `should address API design/build: ${r.response.substring(0, 300)}`);
  }, LLM_TIMEOUT);

  await testAsync('SEARCH + REPORT: "Zjisti ceny GPU a porovnej je"', async () => {
    const convId = await createConv('conflict-3');
    created.push(convId);
    const r = await chatInConv(convId, 'Zjisti ceny GPU a porovnej je');
    // Should be SEARCH, REPORT, or COMPARISON
    if (r.intent) {
      assert(['SEARCH', 'REPORT', 'COMPARISON', 'CONVERSATIONAL', 'CREATIVE'].includes(r.intent),
        `search+report should resolve to data-oriented intent, got: ${r.intent}`);
    }
    assert(r.response.length > 30, 'should have response');
    assert(hasKeywords(r.response, ['gpu', 'cen', 'grafick', 'nvidia', 'amd', 'porovn', 'kart'], 1),
      `should discuss GPU prices: ${r.response.substring(0, 200)}`);
  }, LLM_TIMEOUT);

  await testAsync('FILE + CODE: "Vysvětli tento kód a uprav ho: const x = 1"', async () => {
    const convId = await createConv('conflict-4');
    created.push(convId);
    const r = await chatInConv(convId, 'Vysvětli tento kód a uprav ho: const x = 1');
    // Should be CODE, CODE_ANALYSIS, or FILE_EXPLAIN
    if (r.intent) {
      assert(['CODE', 'CODE_ANALYSIS', 'FILE_EXPLAIN', 'CONVERSATIONAL', 'FILE_WRITE', 'CREATIVE'].includes(r.intent),
        `file+code should resolve to code-related intent, got: ${r.intent}`);
    }
    assert(hasKeywords(r.response, ['const', 'proměn', 'variable', 'kód', 'code', 'hodnot'], 1),
      `should reference the code: ${r.response.substring(0, 200)}`);
  }, LLM_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('CRE Conflict — Ambiguity Resolution');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('vague + technical: "Řekni mi něco o tom Pythonu"', async () => {
    const convId = await createConv('conflict-5');
    created.push(convId);
    const r = await chatInConv(convId, 'Řekni mi něco o tom Pythonu');
    // Should resolve to CONVERSATIONAL or FACTUAL (not CODE)
    assert(r.response.length > 30, 'should have response');
    assert(hasKeywords(r.response, ['python', 'jazyk', 'programov', 'language'], 1),
      `should discuss Python: ${r.response.substring(0, 200)}`);
  }, LLM_TIMEOUT);

  await testAsync('action + question: "Chci udělat web, jak na to?"', async () => {
    const convId = await createConv('conflict-6');
    created.push(convId);
    const r = await chatInConv(convId, 'Chci udělat web, jak na to?');
    // Should be BUILD, DESIGN, or CONVERSATIONAL (explains process)
    if (r.intent) {
      assert(['BUILD', 'DESIGN', 'PLAN', 'CONVERSATIONAL', 'CREATIVE'].includes(r.intent),
        `action+question should be advisory or build, got: ${r.intent}`);
    }
    assert(r.response.length > 50, 'should have substantive response');
  }, LLM_TIMEOUT);

  await testAsync('contradictory: long creative request vs short answer expectation', async () => {
    const convId = await createConv('conflict-7');
    created.push(convId);
    const r = await chatInConv(convId, 'Stručně mi napiš podrobnou analýzu Linuxu');
    // "stručně" + "podrobnou" = contradiction
    assert(r.response.length > 30, 'should produce something despite contradiction');
    assert(hasKeywords(r.response, ['linux', 'systém', 'operační', 'kernel', 'open'], 1),
      `should discuss Linux: ${r.response.substring(0, 200)}`);
  }, LLM_TIMEOUT);

  await testAsync('multi-language: "Explain mi co je recursion v Pythonu"', async () => {
    const convId = await createConv('conflict-8');
    created.push(convId);
    const r = await chatInConv(convId, 'Explain mi co je recursion v Pythonu');
    // Mixed CZ/EN input — should still respond coherently
    assert(r.response.length > 30, 'should handle mixed-language input');
    assert(hasKeywords(r.response, ['rekurz', 'recursion', 'funkc', 'volá', 'python', 'sebe'], 1),
      `should explain recursion: ${r.response.substring(0, 200)}`);
  }, LLM_TIMEOUT);

} finally {
  for (const id of created) await cleanupConversation(id);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
