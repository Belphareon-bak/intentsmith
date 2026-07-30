// tests/e2e/07-specialists.e2e.js — Specialist CRUD & lifecycle
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer } from './_helpers.js';

await waitForServer();

const TARGET_SPECIALIST_ID = 'dummy-logger';
let specialists = [];

try {
  // ── List ────────────────────────────────────────────────────────────────
  suite('GET /api/specialists — list');

  await testAsync('returns specialists array', async () => {
    const { status, data } = await api('GET', '/api/specialists');
    assertEqual(status, 200);
    assertEqual(data.ok, true);
    assert(Array.isArray(data.specialists), 'specialists must be array');
    assert(data.specialists.length > 0, 'committed specialists required');
    assert(
      data.specialists.some(s => s.id === TARGET_SPECIALIST_ID),
      `${TARGET_SPECIALIST_ID} fixture required`,
    );
    specialists = data.specialists;
  });

  await testAsync('each specialist has required fields', async () => {
    for (const specialist of specialists) {
      assert(specialist.id, 'id required');
      assert(specialist.name, 'name required');
      assert(specialist.version, 'version required');
      assert(typeof specialist.status === 'string', 'status required');
    }
  });

  // ── Get Single ──────────────────────────────────────────────────────────
  suite('GET /api/specialists/:id');

  await testAsync('returns existing specialist', async () => {
    const { status, data } = await api('GET', `/api/specialists/${TARGET_SPECIALIST_ID}`);
    assertEqual(status, 200);
    assertEqual(data.ok, true);
    assertEqual(data.id, TARGET_SPECIALIST_ID);
    assert(data.manifest && typeof data.manifest === 'object', 'manifest required');
  });

  await testAsync('returns 404 for nonexistent', async () => {
    const { status } = await api('GET', '/api/specialists/nonexistent-spec-xyz');
    assertEqual(status, 404);
  });

  // ── Enable/Disable ─────────────────────────────────────────────────────
  suite('Specialist Enable/Disable');

  await testAsync('disable specialist', async () => {
    const { status, data } = await api('POST', `/api/specialists/${TARGET_SPECIALIST_ID}/disable`);
    assertEqual(status, 200);
    assertEqual(data.ok, true);
    assertEqual(data.status, 'disabled');

    const listed = await api('GET', '/api/specialists');
    assertEqual(listed.status, 200);
    assertEqual(
      listed.data.specialists.find(s => s.id === TARGET_SPECIALIST_ID)?.status,
      'disabled',
    );
  });

  await testAsync('enable specialist', async () => {
    const { status, data } = await api('POST', `/api/specialists/${TARGET_SPECIALIST_ID}/enable`);
    assertEqual(status, 200);
    assertEqual(data.ok, true);
    assertEqual(data.status, 'enabled');

    const listed = await api('GET', '/api/specialists');
    assertEqual(listed.status, 200);
    assertEqual(
      listed.data.specialists.find(s => s.id === TARGET_SPECIALIST_ID)?.status,
      'enabled',
    );
  });

  // ── Discover ───────────────────────────────────────────────────────────
  suite('Specialist Discovery');

  await testAsync('discover re-scans', async () => {
    const { status, data } = await api('POST', '/api/specialists/discover');
    assertEqual(status, 200);
    assertEqual(data.ok, true);
    assert(Array.isArray(data.discovered), 'discovered must be array');
    assert(Array.isArray(data.newlyInstalled), 'newlyInstalled must be array');
    assert(typeof data.total === 'number', 'total must be numeric');
  });

  // ── Integrity ──────────────────────────────────────────────────────────
  suite('Specialist Integrity');

  await testAsync('integrity check for existing specialist', async () => {
    const { status, data } = await api('GET', `/api/specialists/${TARGET_SPECIALIST_ID}/integrity`);
    assertEqual(status, 200);
    assertEqual(data.ok, true);
    assert(Array.isArray(data.issues), 'issues must be array');
  });

  // ── Expertise Binding ──────────────────────────────────────────────────
  suite('Specialist Expertise Binding');

  await testAsync('list specialist expertises', async () => {
    const { status, data } = await api('GET', `/api/specialists/${TARGET_SPECIALIST_ID}/expertises`);
    assertEqual(status, 200);
    assertEqual(data.ok, true);
    assert(Array.isArray(data.expertises), 'expertises must be array');
  });

  // ── Telemetry ──────────────────────────────────────────────────────────
  suite('Specialist Telemetry');

  await testAsync('telemetry endpoint returns data', async () => {
    const { status, data } = await api('GET', '/api/specialists/telemetry');
    assertEqual(status, 200);
    assertEqual(data.ok, true);
  });
} finally {
  try {
    await api('POST', `/api/specialists/${TARGET_SPECIALIST_ID}/enable`);
  } catch {}
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
