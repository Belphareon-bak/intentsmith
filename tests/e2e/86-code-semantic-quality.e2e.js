// tests/e2e/86-code-semantic-quality.e2e.js — Code Semantic Quality
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3+: Tests that generated code is not just syntactically valid but also
// semantically correct. Validates function structure, import validity,
// and code completeness WITHOUT executing code (safe).
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite, testAsync, assert, summary,
  waitForServer, chatWithTimeout, createConv, hasKeywords,
  cleanupConversation, LLM_TIMEOUT,
} from './_helpers.js';

await waitForServer();
const created = [];
const REQUEST_TIMEOUT = LLM_TIMEOUT;
const TEST_TIMEOUT = REQUEST_TIMEOUT + 5_000;
const PYTHON_HTTP_MODULES = new Set([
  'aiohttp',
  'asyncio',
  'http',
  'httpx',
  'json',
  'requests',
  'urllib',
]);

function extractCodeBlocks(response) {
  return [...response.matchAll(/```(?:[\w.+-]+)?\s*\n([\s\S]*?)```/g)].map(match => match[1]);
}

function requireCode(response, label) {
  const blocks = extractCodeBlocks(response);
  assert(blocks.length > 0, `${label} should include at least one fenced code block`);
  return blocks.join('\n');
}

function assertCompleteCode(code, label) {
  assert(!/\b(?:TODO|FIXME|PLACEHOLDER)\b|implement\s+here|not\s+implemented/i.test(code),
    `${label} should not contain placeholders`);
  assert(!/^\s*(?:pass|\.\.\.)\s*(?:#.*)?$/m.test(code),
    `${label} should not contain an empty implementation`);
  assert(/\breturn\b/.test(code), `${label} should return a value`);
}

function extractPythonModules(code) {
  const modules = [];
  for (const rawLine of code.split('\n')) {
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    const fromMatch = line.match(/^from\s+([\w.]+)\s+import\b/);
    if (fromMatch) {
      modules.push(fromMatch[1].split('.')[0]);
      continue;
    }
    const importMatch = line.match(/^import\s+(.+)$/);
    if (!importMatch) continue;
    for (const imported of importMatch[1].split(',')) {
      const moduleName = imported.trim().split(/\s+as\s+/)[0].split('.')[0];
      if (moduleName) modules.push(moduleName);
    }
  }
  return modules;
}

try {
  // ═══════════════════════════════════════════════════════════════════════════
  suite('Code Quality — Function Correctness');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('factorial function has correct structure', async () => {
    const convId = await createConv('code-1');
    created.push(convId);
    const r = await chatWithTimeout(
      convId,
      'Napiš funkci pro výpočet faktoriálu v Pythonu',
      REQUEST_TIMEOUT,
    );
    const code = requireCode(r.response, 'factorial response');
    // Should have def keyword
    assert(/\bdef\s+\w+/.test(code), `should have function definition: ${code.substring(0, 200)}`);
    // Should have base case (n <= 1 or n == 0 or similar)
    assert(/[<>=!]=?\s*[01]/.test(code) || /\breturn\s+1\b/.test(code),
      `should have base case: ${code.substring(0, 300)}`);
    // Should have recursive call or loop
    assert(/\bfor\b/.test(code) || /\bwhile\b/.test(code) || /factorial|fact/.test(code.toLowerCase()),
      `should have recursion or loop: ${code.substring(0, 300)}`);
    assertCompleteCode(code, 'factorial code');
  }, TEST_TIMEOUT);

  await testAsync('sorting function has comparison logic', async () => {
    const convId = await createConv('code-2');
    created.push(convId);
    const r = await chatWithTimeout(convId, 'Napiš bubble sort v Pythonu', REQUEST_TIMEOUT);
    const code = requireCode(r.response, 'sorting response');
    // Should have def + nested loops
    assert(/\bdef\s+\w+/.test(code), 'should have function definition');
    assert(/\bfor\b/.test(code), 'should have for loop');
    // Should have comparison (< or >)
    assert(/[<>]/.test(code), 'should have comparison operator');
    // Should have swap logic (Python tuple swap: a, b = b, a OR temp variable OR Czech description)
    assert(/\bswap\b/i.test(code) || /temp/.test(code)
      || /,\s*\w+\[.+?\]\s*=\s*\w+\[/.test(code)    // arr[j], arr[j+1] = arr[j+1], arr[j]
      || /\w+\[.+?\]\s*,\s*\w+\[.+?\]\s*=/.test(code), // same pattern, flexible index
      `should have swap logic: ${code.substring(0, 300)}`);
    assertCompleteCode(code, 'sorting code');
  }, TEST_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Code Quality — Import Validity');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('Python imports are standard library or well-known', async () => {
    const convId = await createConv('code-3');
    created.push(convId);
    const r = await chatWithTimeout(
      convId,
      'Napiš Python skript pro HTTP request na API',
      REQUEST_TIMEOUT,
    );
    const code = requireCode(r.response, 'Python HTTP response');
    // Extract imports
    const modules = extractPythonModules(code);
    assert(modules.length > 0, 'Python HTTP code should contain an import');
    for (const moduleName of modules) {
      assert(PYTHON_HTTP_MODULES.has(moduleName),
        `Python HTTP import is not in the explicit allowlist: ${moduleName}`);
    }
    // Should have request-related code
    assert(hasKeywords(code, ['request', 'get', 'post', 'url', 'http', 'response', 'api'], 2),
      `should have HTTP request code: ${code.substring(0, 300)}`);
  }, TEST_TIMEOUT);

  await testAsync('JavaScript imports use valid patterns', async () => {
    const convId = await createConv('code-4');
    created.push(convId);
    const r = await chatWithTimeout(
      convId,
      'Napiš Express.js server s jedním GET endpointem',
      REQUEST_TIMEOUT,
    );
    const code = requireCode(r.response, 'Express response');
    // Should have express import
    assert(
      /(?:import\s+express(?:\s*,?\s*\{[^}]*\})?\s+from|require\s*\(\s*)['"]express['"]/.test(code),
      `should import express: ${code.substring(0, 200)}`,
    );
    // Should have route definition
    assert(/app\.get\s*\(/.test(code),
      `should define a GET route: ${code.substring(0, 300)}`);
    // Should have port/listen
    assert(/app\.listen\s*\(/.test(code),
      `should have server listen: ${code.substring(0, 300)}`);
  }, TEST_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Code Quality — Completeness');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('generated code is complete (no TODO/placeholder)', async () => {
    const convId = await createConv('code-5');
    created.push(convId);
    const r = await chatWithTimeout(
      convId,
      'Napiš kompletní funkci pro validaci emailu v JavaScriptu',
      REQUEST_TIMEOUT,
    );
    // Extract code blocks
    const code = requireCode(r.response, 'email validation response');
    assertCompleteCode(code, 'email validation code');
  }, TEST_TIMEOUT);

  await testAsync('code handles edge cases when asked', async () => {
    const convId = await createConv('code-6');
    created.push(convId);
    const r = await chatWithTimeout(
      convId,
      'Napiš robustní funkci pro dělení dvou čísel v Pythonu. Ošetři dělení nulou.',
      REQUEST_TIMEOUT,
    );
    const code = requireCode(r.response, 'division response');
    // Should handle division by zero
    assert(hasKeywords(code, ['zero', 'nul', '0', 'exception', 'error', 'raise', 'try', 'if', 'zerodivision', 'dělení', 'nula'], 1),
      `should handle division by zero: ${code.substring(0, 300)}`);
    // Should have the division operator
    assert(code.includes('/'), 'should have division operator');
    assertCompleteCode(code, 'division code');
  }, TEST_TIMEOUT);

} finally {
  for (const id of created) await cleanupConversation(id);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
