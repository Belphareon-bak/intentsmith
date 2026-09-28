// tests/e2e/11-memory.e2e.js — Memory API
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer, cooldown } from './_helpers.js';

await waitForServer();
await cooldown();

// ── GET Memory ──────────────────────────────────────────────────────────────
suite('GET /api/memory');

await testAsync('returns memory data (array or object)', async () => {
  const { status, data } = await api('GET', '/api/memory');
  assertEqual(status, 200);
  assert(typeof data === 'object', 'memory must be object or array');
});

// ── POST Memory ─────────────────────────────────────────────────────────────
suite('POST /api/memory');

await testAsync('saves memory object', async () => {
  const payload = { test: true, marker: 'gate0-memory-roundtrip' };
  const { status, data } = await api('POST', '/api/memory', payload);
  assertEqual(status, 200);
  assert(data.success === true, 'success flag required');
});

await testAsync('saved memory persists on GET', async () => {
  const { status, data } = await api('GET', '/api/memory');
  assertEqual(status, 200);
  assert(data.test === true, 'saved data should persist');
});

await testAsync('saves memory array', async () => {
  const payload = [{ key: 'val1' }, { key: 'val2' }];
  const { status, data } = await api('POST', '/api/memory', payload);
  assertEqual(status, 200);
  assert(data.success === true, 'success flag required');
});

await testAsync('oversized memory payload returns 400', async () => {
  // >100KB payload
  const huge = { data: 'x'.repeat(101 * 1024) };
  const { status } = await api('POST', '/api/memory', huge);
  assertEqual(status, 400);
});

// ── Settings Persistence ────────────────────────────────────────────────────
suite('Settings API');

await testAsync('GET /api/settings returns shape', async () => {
  const { status, data } = await api('GET', '/api/settings');
  assertEqual(status, 200);
  assert(typeof data === 'object', 'settings must be object');
});

await testAsync('POST /api/settings saves setting', async () => {
  const { status, data } = await api('POST', '/api/settings', { language: 'cs' });
  assertEqual(status, 200);
  assertEqual(data.success, true);
});

await testAsync('saved setting persists on GET', async () => {
  const { status, data } = await api('GET', '/api/settings');
  assertEqual(status, 200);
  assertEqual(data.language, 'cs');
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
