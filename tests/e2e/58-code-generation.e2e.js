// tests/e2e/58-code-generation.e2e.js — Code generation via chat
// ══════════════════════════════════════════════════════════════════════════════
// Tier 2: Verifies code generation requests produce code blocks.
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, summary, api, waitForServer } from './_helpers.js';

await waitForServer();

const LLM_TIMEOUT = 60000;

// ── Python Code ─────────────────────────────────────────────────────────────
suite('Code Generation — Python');

await testAsync('generates Python function', async () => {
  const { status, data } = await api('POST', '/chat', {
    message: 'Napiš Python funkci, která počítá faktoriál čísla.'
  });
  assert(status === 200 || status === 202, `expected 200/202, got ${status}`);
  if (data.response) {
    const r = data.response;
    // Should contain code block or at least def keyword
    assert(
      r.includes('```') || r.includes('def ') || r.includes('factorial'),
      'response should contain code'
    );
  }
}, LLM_TIMEOUT);

// ── JavaScript Code ─────────────────────────────────────────────────────────
suite('Code Generation — JavaScript');

await testAsync('generates JavaScript function', async () => {
  const { status, data } = await api('POST', '/chat', {
    message: 'Write a JavaScript function that reverses a string.'
  });
  assert(status === 200 || status === 202, `expected 200/202, got ${status}`);
  if (data.response) {
    const r = data.response;
    assert(
      r.includes('```') || r.includes('function') || r.includes('reverse'),
      'response should contain JS code'
    );
  }
}, LLM_TIMEOUT);

// ── Code Explanation ────────────────────────────────────────────────────────
suite('Code Generation — Explanation');

await testAsync('explains given code snippet', async () => {
  const { status, data } = await api('POST', '/chat', {
    message: 'Vysvětli tento kód:\n```python\ndef fib(n):\n  if n <= 1: return n\n  return fib(n-1) + fib(n-2)\n```'
  });
  assert(status === 200 || status === 202, `expected 200/202, got ${status}`);
  if (data.response) {
    assert(data.response.length > 30, 'explanation should be detailed');
  }
}, LLM_TIMEOUT);

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
