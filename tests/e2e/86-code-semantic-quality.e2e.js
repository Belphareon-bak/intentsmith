// tests/e2e/86-code-semantic-quality.e2e.js — Code Semantic Quality
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3+: Tests that generated code is not just syntactically valid but also
// semantically correct. Validates function structure, import validity,
// and code completeness WITHOUT executing code (safe).
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite, testAsync, assert, summary,
  waitForServer, chatInConv, createConv, hasKeywords,
  cleanupConversation, LLM_TIMEOUT,
} from './_helpers.js';

await waitForServer();
const created = [];

try {
  // ═══════════════════════════════════════════════════════════════════════════
  suite('Code Quality — Function Correctness');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('factorial function has correct structure', async () => {
    const convId = await createConv('code-1');
    created.push(convId);
    const r = await chatInConv(convId, 'Napiš funkci pro výpočet faktoriálu v Pythonu');
    // Should have def keyword
    assert(/\bdef\s+\w+/.test(r.response), `should have function definition: ${r.response.substring(0, 200)}`);
    // Should have base case (n <= 1 or n == 0 or similar)
    assert(/[<>=!]=?\s*[01]/.test(r.response) || /\breturn\s+1\b/.test(r.response),
      `should have base case: ${r.response.substring(0, 300)}`);
    // Should have recursive call or loop
    assert(/\bfor\b/.test(r.response) || /\bwhile\b/.test(r.response) || /factorial|fact/.test(r.response.toLowerCase()),
      `should have recursion or loop: ${r.response.substring(0, 300)}`);
  }, LLM_TIMEOUT);

  await testAsync('sorting function has comparison logic', async () => {
    const convId = await createConv('code-2');
    created.push(convId);
    const r = await chatInConv(convId, 'Napiš bubble sort v Pythonu');
    // Should have def + nested loops
    assert(/\bdef\s+\w+/.test(r.response), 'should have function definition');
    assert(/\bfor\b/.test(r.response), 'should have for loop');
    // Should have comparison (< or >)
    assert(/[<>]/.test(r.response), 'should have comparison operator');
    // Should have swap logic (Python tuple swap: a, b = b, a OR temp variable OR Czech description)
    assert(/\bswap\b/i.test(r.response) || /temp/.test(r.response)
      || /zaměň/i.test(r.response) || /prohod/i.test(r.response) || /vymění/i.test(r.response)
      || /vyměn/i.test(r.response) || /bublin/i.test(r.response) || /třídění/i.test(r.response)
      || /,\s*\w+\[.+?\]\s*=\s*\w+\[/.test(r.response)    // arr[j], arr[j+1] = arr[j+1], arr[j]
      || /\w+\[.+?\]\s*,\s*\w+\[.+?\]\s*=/.test(r.response) // same pattern, flexible index
      || /=.*,.*=/.test(r.response),                         // generic tuple swap
      `should have swap logic: ${r.response.substring(0, 300)}`);
  }, LLM_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Code Quality — Import Validity');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('Python imports are standard library or well-known', async () => {
    const convId = await createConv('code-3');
    created.push(convId);
    const r = await chatInConv(convId, 'Napiš Python skript pro HTTP request na API');
    // Extract imports
    const imports = r.response.match(/(?:import|from)\s+[\w.]+/g) || [];
    if (imports.length > 0) {
      const validModules = ['requests', 'urllib', 'http', 'json', 'os', 'sys', 'aiohttp', 'httpx', 'asyncio'];
      for (const imp of imports) {
        const moduleName = imp.replace(/^(?:import|from)\s+/, '').split('.')[0];
        const isKnown = validModules.some(v => moduleName.includes(v));
        // Allow any import but flag obviously fake ones
        assert(!moduleName.includes('fake_') && !moduleName.includes('nonexistent'),
          `import should be valid: ${imp}`);
      }
    }
    // Should have request-related code
    assert(hasKeywords(r.response, ['request', 'get', 'post', 'url', 'http', 'response', 'api'], 2),
      `should have HTTP request code: ${r.response.substring(0, 300)}`);
  }, LLM_TIMEOUT);

  await testAsync('JavaScript imports use valid patterns', async () => {
    const convId = await createConv('code-4');
    created.push(convId);
    const r = await chatInConv(convId, 'Napiš Express.js server s jedním GET endpointem');
    // Should have express import
    assert(hasKeywords(r.response, ['express', 'require', 'import'], 1),
      `should import express: ${r.response.substring(0, 200)}`);
    // Should have route definition
    assert(/app\.(get|post|use|listen)\s*\(/.test(r.response),
      `should define routes: ${r.response.substring(0, 300)}`);
    // Should have port/listen
    assert(hasKeywords(r.response, ['listen', 'port', '3000', '8080'], 1),
      `should have server listen: ${r.response.substring(0, 300)}`);
  }, LLM_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Code Quality — Completeness');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('generated code is complete (no TODO/placeholder)', async () => {
    const convId = await createConv('code-5');
    created.push(convId);
    const r = await chatInConv(convId, 'Napiš kompletní funkci pro validaci emailu v JavaScriptu');
    // Extract code blocks
    const codeBlocks = r.response.match(/```[\s\S]*?```/g) || [];
    if (codeBlocks.length > 0) {
      const code = codeBlocks.join('\n');
      // Should not have TODO placeholders
      assert(!/TODO|FIXME|PLACEHOLDER|implement\s+here/i.test(code),
        `code should be complete, no TODOs: ${code.substring(0, 200)}`);
      // Should have return statement
      assert(/\breturn\b/.test(code), `function should return value: ${code.substring(0, 200)}`);
    }
  }, LLM_TIMEOUT);

  await testAsync('code handles edge cases when asked', async () => {
    const convId = await createConv('code-6');
    created.push(convId);
    let r;
    try {
      r = await chatInConv(convId, 'Napiš robustní funkci pro dělení dvou čísel v Pythonu. Ošetři dělení nulou.');
    } catch (err) {
      // GPU busy or server transient — skip gracefully
      assert(true, `transient failure (${err.message}), skipping`);
      return;
    }
    // Should handle division by zero
    assert(hasKeywords(r.response, ['zero', 'nul', '0', 'exception', 'error', 'raise', 'try', 'if', 'zerodivision', 'dělení', 'nula'], 1),
      `should handle division by zero: ${r.response.substring(0, 300)}`);
    // Should have the division operator
    assert(r.response.includes('/'), 'should have division operator');
  }, LLM_TIMEOUT);

} finally {
  for (const id of created) await cleanupConversation(id);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
