// tests/e2e/58-code-generation.e2e.js — Code generation via chat
// ══════════════════════════════════════════════════════════════════════════════
// Tier 2: Verifies code generation requests produce code blocks.
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite, testAsync, assert, summary, waitForServer,
  createConv, chatWithTimeout, cleanupConversation,
} from './_helpers.js';

await waitForServer();

const LLM_TIMEOUT = 60000;
const created = [];

async function strictCodeChat(title, message) {
  const convId = await createConv(title);
  created.push(convId);
  return chatWithTimeout(convId, message, LLM_TIMEOUT);
}

try {
  // ── Python Code ─────────────────────────────────────────────────────────────
  suite('Code Generation — Python');

  await testAsync('generates Python function', async () => {
    const { response } = await strictCodeChat(
      'python-generation',
      'Napiš Python funkci, která počítá faktoriál čísla.',
    );
    assert(
      /```(?:python|py)?[\s\S]*\bdef\s+\w+\s*\(/i.test(response),
      'Python response must contain a fenced function',
    );
    assert(/faktori|factorial/i.test(response), 'Python response must address factorial');
  }, LLM_TIMEOUT);

  // ── JavaScript Code ─────────────────────────────────────────────────────────
  suite('Code Generation — JavaScript');

  await testAsync('generates JavaScript function', async () => {
    const { response } = await strictCodeChat(
      'javascript-generation',
      'Write a JavaScript function that reverses a string.',
    );
    assert(
      /```(?:javascript|js)?[\s\S]*(?:\bfunction\b|=>)/i.test(response),
      'JavaScript response must contain a fenced function',
    );
    assert(/revers|string/i.test(response), 'JavaScript response must address string reversal');
  }, LLM_TIMEOUT);

  // ── Code Explanation ────────────────────────────────────────────────────────
  suite('Code Generation — Explanation');

  await testAsync('explains given code snippet', async () => {
    const { response } = await strictCodeChat(
      'code-explanation',
      'Vysvětli tento kód:\n```python\ndef fib(n):\n  if n <= 1: return n\n  return fib(n-1) + fib(n-2)\n```',
    );
    assert(response.length > 80, 'explanation must be substantive');
    assert(/rekurz|recurs/i.test(response), 'explanation must identify recursion');
    assert(/základ|base case|n\s*<=\s*1/i.test(response), 'explanation must identify the base case');
  }, LLM_TIMEOUT);
} finally {
  for (const id of created) await cleanupConversation(id);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
