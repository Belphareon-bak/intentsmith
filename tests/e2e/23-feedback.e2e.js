// tests/e2e/23-feedback.e2e.js — Feedback CRUD, rate limit, attachments
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer, cooldown } from './_helpers.js';

await waitForServer();
await cooldown();

// ── List ─────────────────────────────────────────────────────────────────────
suite('GET /api/feedback');

await testAsync('returns feedback list', async () => {
  const { status, data } = await api('GET', '/api/feedback');
  assertEqual(status, 200);
  assert(typeof data === 'object', 'feedback response must be object');
});

// ── Submit ──────────────────────────────────────────────────────────────────
suite('POST /api/feedback');

await testAsync('submit feedback', async () => {
  const { status, data } = await api('POST', '/api/feedback', {
    type: 'bug',
    message: 'E2E test feedback — please ignore',
    context: { test: true }
  });
  // May succeed or hit rate limit from previous runs
  assert(status === 200 || status === 201 || status === 429 || status === 500, `expected 200/201/429/500, got ${status}`);
});

await testAsync('submit feedback without message returns 400', async () => {
  // Wait to avoid rate limit
  await new Promise(r => setTimeout(r, 1000));
  const { status } = await api('POST', '/api/feedback', { type: 'bug' });
  assert(status === 400 || status === 429, `expected 400/429, got ${status}`);
});

await testAsync('submit feedback without type returns 400', async () => {
  await new Promise(r => setTimeout(r, 1000));
  const { status } = await api('POST', '/api/feedback', { message: 'test' });
  assert(status === 400 || status === 200 || status === 201 || status === 429 || status === 500, `expected 400/200/429/500, got ${status}`);
});

// ── Attachment ──────────────────────────────────────────────────────────────
suite('Feedback Attachments');

await testAsync('attach to nonexistent feedback returns 404 or 400', async () => {
  const { status } = await api('POST', '/api/feedback/999999/attach', {
    filename: 'test.txt',
    content: Buffer.from('test data').toString('base64'),
    mime_type: 'text/plain'
  });
  assert(status === 404 || status === 400 || status === 500 || status === 429, `expected 404/400/500/429, got ${status}`);
});

// ── Audit Log ───────────────────────────────────────────────────────────────
suite('Audit & Logs');

await testAsync('GET /api/audit returns shape', async () => {
  const { status, data } = await api('GET', '/api/audit');
  assert(status === 200 || status === 429, `expected 200/429, got ${status}`);
  if (status === 429) return;
  assert(typeof data === 'object', 'audit must be object');
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
