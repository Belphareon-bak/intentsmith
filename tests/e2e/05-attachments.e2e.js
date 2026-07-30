// tests/e2e/05-attachments.e2e.js — Attachment & chat validation (HTTP layer only)
// ══════════════════════════════════════════════════════════════════════════════
// Tier 1: Tests only validation paths that return immediately (400).
// NEVER sends a valid message that would trigger LLM calls.
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite, testAsync, assert, assertEqual, summary, api, apiRaw, waitForServer, BASE_URL,
} from './_helpers.js';

await waitForServer();

// ── POST /chat — validation errors (immediate 400, no LLM) ─────────────────
suite('POST /chat — validation');

await testAsync('missing message returns 400', async () => {
  const { status } = await api('POST', '/chat', {});
  assertEqual(status, 400);
});

await testAsync('empty string message returns 400', async () => {
  const { status } = await api('POST', '/chat', { message: '' });
  assertEqual(status, 400);
});

await testAsync('null message returns 400', async () => {
  const { status } = await api('POST', '/chat', { message: null });
  assertEqual(status, 400);
});

await testAsync('numeric message returns 400', async () => {
  const { status } = await api('POST', '/chat', { message: 12345 });
  assertEqual(status, 400);
});

// ── POST /api/chat — validation errors ──────────────────────────────────────
suite('POST /api/chat — validation');

await testAsync('missing conversation_id returns 400', async () => {
  const { status } = await api('POST', '/api/chat', { message: 'test' });
  assertEqual(status, 400);
});

await testAsync('missing message returns 400', async () => {
  const { status } = await api('POST', '/api/chat', { conversation_id: 'test' });
  assertEqual(status, 400);
});

await testAsync('both fields missing returns 400', async () => {
  const { status } = await api('POST', '/api/chat', {});
  assertEqual(status, 400);
});

// ── Content-Type ────────────────────────────────────────────────────────────
suite('Content-Type Handling');

await testAsync('non-JSON body returns 400', async () => {
  const res = await apiRaw('POST', '/chat', 'not json');
  assertEqual(res.status, 400);
});

await testAsync('empty POST body returns 400', async () => {
  const res = await fetch(`${BASE_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: ''
  });
  assertEqual(res.status, 400);
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
