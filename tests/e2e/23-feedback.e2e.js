// tests/e2e/23-feedback.e2e.js — Feedback CRUD, rate limit, attachments
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer, uniqueId } from './_helpers.js';

await waitForServer();
const feedbackMessage = uniqueId('feedback-message');

// ── List ─────────────────────────────────────────────────────────────────────
suite('GET /api/feedback');

await testAsync('returns feedback list', async () => {
  const { status, data } = await api('GET', '/api/feedback');
  assertEqual(status, 200);
  assert(Array.isArray(data.feedback), 'feedback array required');
});

// ── Submit ──────────────────────────────────────────────────────────────────
suite('POST /api/feedback');

await testAsync('submit feedback', async () => {
  const { status, data } = await api('POST', '/api/feedback', {
    category: 'bug',
    message: feedbackMessage,
    context: { test: true }
  });
  assertEqual(status, 201);
  assertEqual(data.ok, true);
  assert(Number.isInteger(data.id) && data.id > 0, 'feedback id required');
});

await testAsync('immediate second feedback submission is rate limited', async () => {
  const { status, data } = await api('POST', '/api/feedback', {
    category: 'bug',
    message: uniqueId('second-feedback'),
  });
  assertEqual(status, 429);
  assert(data.error.includes('Wait 30s'), 'feedback rate-limit error required');
});

await testAsync('submitted feedback is visible in the list', async () => {
  const { status, data } = await api('GET', '/api/feedback');
  assertEqual(status, 200);
  assert(data.feedback.some(item => (
    item.category === 'bug' && item.message === feedbackMessage
  )), 'submitted feedback row required');
});

// ── Attachment ──────────────────────────────────────────────────────────────
suite('Feedback Attachments');

await testAsync('attach to nonexistent feedback returns 404', async () => {
  const { status, data } = await api('POST', '/api/feedback/2147483647/attach', {
    name: 'test.txt',
    data: Buffer.from('test data').toString('base64'),
    type: 'text/plain'
  });
  assertEqual(status, 404);
  assert(data.error.includes('not found'), 'missing-feedback error required');
});

// ── Audit Log ───────────────────────────────────────────────────────────────
suite('Audit & Logs');

await testAsync('GET /api/audit returns shape', async () => {
  const { status, data } = await api('GET', '/api/audit');
  assertEqual(status, 200);
  assert(Array.isArray(data.audit), 'audit array required');
  assert(Array.isArray(data.drift), 'drift array required');
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
