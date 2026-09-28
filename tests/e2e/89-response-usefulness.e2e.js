// tests/e2e/89-response-usefulness.e2e.js — Response Usefulness & Actionability
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3+: Tests that responses are actually USEFUL, not just "correct".
// Validates actionability, completeness, appropriate verbosity, and structure.
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
  suite('Usefulness — Actionable Responses');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('step-by-step instructions: "Jak deploynu Node.js app?"', async () => {
    const convId = await createConv('useful-1');
    created.push(convId);
    const r = await chatInConv(convId, 'Jak deploynu Node.js app na server? Dej mi konkrétní kroky.');
    // Should have numbered/structured steps
    const hasSteps = /\d+[.)]\s/.test(r.response) || /^[\s]*[-*•]\s/m.test(r.response);
    assert(hasSteps, `deployment guide should have numbered steps: ${r.response.substring(0, 300)}`);
    // Should mention concrete tools/services
    assert(hasKeywords(r.response, ['npm', 'node', 'server', 'deploy', 'host', 'port', 'build', 'pm2', 'nginx', 'docker', 'ssh'], 2),
      `should mention concrete deployment tools: ${r.response.substring(0, 300)}`);
    assert(r.response.length > 200, `should be detailed (>200 chars), got ${r.response.length}`);
  }, LLM_TIMEOUT);

  await testAsync('code with explanation: "Napiš funkci pro validaci emailu"', async () => {
    const convId = await createConv('useful-2');
    created.push(convId);
    const r = await chatInConv(convId, 'Napiš funkci pro validaci emailu v JavaScriptu');
    // Should have both code AND explanation
    const hasCode = r.response.includes('```') || /\bfunction\b/.test(r.response) || /=>/.test(r.response);
    assert(hasCode, `should include code: ${r.response.substring(0, 200)}`);
    // Should have explanation around the code
    const codeEnd = r.response.lastIndexOf('```');
    const afterCode = r.response.substring(codeEnd + 3);
    const beforeCode = r.response.substring(0, r.response.indexOf('```'));
    const hasExplanation = (afterCode.length > 20) || (beforeCode.length > 20);
    assert(hasExplanation || r.response.length > 150,
      `should have explanation alongside code: ${r.response.substring(0, 300)}`);
  }, LLM_TIMEOUT);

  await testAsync('comparison with clear structure: "Porovnej React a Vue"', async () => {
    const convId = await createConv('useful-3');
    created.push(convId);
    const r = await chatInConv(convId, 'Porovnej React a Vue pro frontend development');
    // Should mention BOTH frameworks
    assert(hasKeywords(r.response, ['react'], 1), `should mention React: ${r.response.substring(0, 200)}`);
    assert(hasKeywords(r.response, ['vue'], 1), `should mention Vue: ${r.response.substring(0, 200)}`);
    // Should have structure (bullets, table, or headings)
    const hasStructure = /^[\s]*[-*•]\s/m.test(r.response) || /\|.*\|/.test(r.response) || /^#{1,3}\s/m.test(r.response);
    assert(hasStructure || r.response.length > 200,
      `comparison should be structured: ${r.response.substring(0, 300)}`);
  }, LLM_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Usefulness — Verbosity Control');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('simple question gets concise answer', async () => {
    const convId = await createConv('useful-4');
    created.push(convId);
    const r = await chatInConv(convId, 'Co je HTTP?');
    // Should be informative but not excessively long
    assert(r.response.length > 30, `should have meaningful answer, got ${r.response.length}`);
    assert(r.response.length < 2000, `should not be excessively verbose (got ${r.response.length} chars)`);
    assert(hasKeywords(r.response, ['http', 'protokol', 'protocol', 'web', 'request', 'server', 'přenos'], 1),
      `should explain HTTP: ${r.response.substring(0, 200)}`);
  }, LLM_TIMEOUT);

  await testAsync('greeting gets short response', async () => {
    const convId = await createConv('useful-5');
    created.push(convId);
    const r = await chatInConv(convId, 'Ahoj!');
    assert(r.response.length > 5, 'should respond to greeting');
    assert(r.response.length < 500, `greeting response should be brief (<500 chars), got ${r.response.length}`);
  }, LLM_TIMEOUT);

  await testAsync('farewell gets short response', async () => {
    const convId = await createConv('useful-6');
    created.push(convId);
    const r = await chatInConv(convId, 'Díky za pomoc, to je vše!');
    assert(r.response.length > 5, 'should acknowledge');
    assert(r.response.length < 500, `farewell should be brief (<500 chars), got ${r.response.length}`);
  }, LLM_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Usefulness — Completeness');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('technical question has all key aspects', async () => {
    const convId = await createConv('useful-7');
    created.push(convId);
    const r = await chatInConv(convId, 'Vysvětli, jak funguje garbage collector v JavaScriptu');
    assert(r.response.length > 100, 'technical topic needs detailed answer');
    // Should cover: what it is, how it works, key concepts
    assert(hasKeywords(r.response, ['garbage', 'paměť', 'memory', 'objekt', 'referenc', 'uvolň', 'heap', 'collect', 'mark', 'sweep', 'automatick'], 2),
      `should cover GC key concepts: ${r.response.substring(0, 300)}`);
  }, LLM_TIMEOUT);

  await testAsync('list request returns multiple items', async () => {
    const convId = await createConv('useful-8');
    created.push(convId);
    const r = await chatInConv(convId, 'Vyjmenuj 5 populárních JavaScriptových frameworků');
    // Should have at least 3 items
    const frameworks = ['react', 'vue', 'angular', 'svelte', 'next', 'nuxt', 'express', 'nest', 'ember', 'backbone'];
    let foundCount = 0;
    for (const fw of frameworks) {
      if (r.response.toLowerCase().includes(fw)) foundCount++;
    }
    assert(foundCount >= 3, `should list at least 3 frameworks, found ${foundCount}: ${r.response.substring(0, 300)}`);
  }, LLM_TIMEOUT);

} finally {
  for (const id of created) await cleanupConversation(id);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
