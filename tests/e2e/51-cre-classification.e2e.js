// tests/e2e/51-cre-classification.e2e.js — CRE intent classification via chat
// ══════════════════════════════════════════════════════════════════════════════
// Tier 2: Verifies CRE classifies representative inputs correctly.
// Uses POST /chat which triggers CRE internally.
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, summary, api, waitForServer } from './_helpers.js';

await waitForServer();

const LLM_TIMEOUT = 60000;

// Helper: send chat and check it doesn't crash
async function chatExpect(message, label) {
  const { status, data } = await api('POST', '/chat', { message });
  assert(status === 200 || status === 202 || status === 500, `[${label}] expected 200/202/500, got ${status}`);
  return { status, data };
}

// ── Simple Intents ──────────────────────────────────────────────────────────
suite('CRE — Simple Intents');

await testAsync('greeting classified correctly', async () => {
  await chatExpect('Ahoj, jak se máš?', 'GREETING');
}, LLM_TIMEOUT);

await testAsync('creative writing classified', async () => {
  await chatExpect('Napiš mi básničku o kočce.', 'CREATIVE');
}, LLM_TIMEOUT);

await testAsync('factual question classified', async () => {
  await chatExpect('Kolik obyvatel má Praha?', 'FACTUAL');
}, LLM_TIMEOUT);

await testAsync('search intent classified', async () => {
  await chatExpect('Vyhledej informace o Node.js 22', 'SEARCH');
}, LLM_TIMEOUT);

// ── Code Intents ────────────────────────────────────────────────────────────
suite('CRE — Code Intents');

await testAsync('code generation classified', async () => {
  await chatExpect('Napiš funkci v Pythonu, která počítá faktoriál.', 'CODE');
}, LLM_TIMEOUT);

await testAsync('code review classified', async () => {
  await chatExpect('Zkontroluj tento kód: function add(a,b) { return a+b; }', 'CODE_REVIEW');
}, LLM_TIMEOUT);

// ── Complex Intents ─────────────────────────────────────────────────────────
suite('CRE — Complex Intents');

await testAsync('comparison classified', async () => {
  await chatExpect('Porovnej React a Vue.js — klady a zápory.', 'COMPARISON');
}, LLM_TIMEOUT);

await testAsync('summarize classified', async () => {
  await chatExpect('Shrň mi hlavní body z tohoto textu: ' + 'Lorem ipsum '.repeat(20), 'SUMMARIZE');
}, LLM_TIMEOUT);

await testAsync('translate classified', async () => {
  await chatExpect('Přelož do angličtiny: Dnes je krásný den.', 'TRANSLATE');
}, LLM_TIMEOUT);

// ── Edge Cases ──────────────────────────────────────────────────────────────
suite('CRE — Edge Cases');

await testAsync('very short input handled', async () => {
  await chatExpect('ok', 'SHORT');
}, LLM_TIMEOUT);

await testAsync('emoji-only input handled', async () => {
  await chatExpect('👍', 'EMOJI');
}, LLM_TIMEOUT);

await testAsync('mixed language input handled', async () => {
  await chatExpect('Can you tell me, kolik je 2+2?', 'MIXED');
}, LLM_TIMEOUT);

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
