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

let settingsRevision;

await testAsync('GET /api/settings/v2 returns versioned public settings', async () => {
  const { status, data } = await api('GET', '/api/settings/v2');
  assertEqual(status, 200);
  assert(Number.isSafeInteger(data.revision) && data.revision > 0, 'revision must be positive');
  assert(
    data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings),
    'settings must be an object',
  );
  settingsRevision = data.revision;
});

await testAsync('PUT /api/settings/v2 saves setting with observed revision', async () => {
  const { status, data } = await api('PUT', '/api/settings/v2', {
    expectedRevision: settingsRevision,
    patch: { 'c3.language': 'cs' },
  });
  assertEqual(status, 200);
  assertEqual(data.revision, settingsRevision + 1);
  assertEqual(data.settings?.['c3.language'], 'cs');
  settingsRevision = data.revision;
});

await testAsync('versioned setting persists on GET', async () => {
  const { status, data } = await api('GET', '/api/settings/v2');
  assertEqual(status, 200);
  assertEqual(data.revision, settingsRevision);
  assertEqual(data.settings?.['c3.language'], 'cs');
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
