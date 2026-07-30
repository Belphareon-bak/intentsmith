// tests/e2e/06-expertises.e2e.js — Expertise system CRUD
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer, uniqueId } from './_helpers.js';

await waitForServer();

const customIds = [];

try {
  // ── List Built-in ──────────────────────────────────────────────────────
  suite('GET /api/expertises — list');

  let builtInCount = 0;

  await testAsync('returns experts array with built-ins', async () => {
    const { status, data } = await api('GET', '/api/expertises');
    assertEqual(status, 200);
    assert(Array.isArray(data.experts), 'experts must be array');
    builtInCount = data.experts.length;
    assert(builtInCount >= 10, `expected ≥10 built-in expertises, got ${builtInCount}`);
  });

  await testAsync('each expertise has required fields', async () => {
    const { status, data } = await api('GET', '/api/expertises');
    assertEqual(status, 200);
    const e = data.experts[0];
    assert(e.id, 'id required');
    assert(e.name, 'name required');
    assert(typeof e.temperature === 'number', 'temperature required');
  });

  // ── Schema ─────────────────────────────────────────────────────────────
  suite('GET /api/expertise-schema');

  await testAsync('returns schema with moduleSections', async () => {
    const { status, data } = await api('GET', '/api/expertise-schema');
    assertEqual(status, 200);
    assert(Array.isArray(data.moduleSections), 'moduleSections required');
    assert(data.limits, 'limits required');
    assert(Array.isArray(data.capabilityDimensions), 'capabilityDimensions required');
  });

  // ── Custom CRUD ────────────────────────────────────────────────────────
  suite('Custom Expertise CRUD');

  await testAsync('create custom expertise', async () => {
    const id = uniqueId('exp');
    const { status, data } = await api('POST', '/api/expertises', {
      id, name: 'E2E Test Expert', domain: 'testing',
      description: 'E2E test expertise',
      temperature: 0.5,
      capabilities: { reasoning: 80, creativity: 50, determinism: 70, riskTolerance: 30, verbosity: 60 }
    });
    assertEqual(status, 201);
    assertEqual(data.id, id);
    customIds.push(id);
  });

  await testAsync('custom expertise appears in list', async () => {
    const { status, data } = await api('GET', '/api/expertises');
    assertEqual(status, 200);
    assert(data.experts.length > builtInCount, 'list should include custom expertise');
    const custom = data.experts.find(e => e.id === customIds[0]);
    assert(custom, 'custom expertise should be in list');
  });

  await testAsync('get custom expertise by ID', async () => {
    const { status, data } = await api('GET', `/api/expertises/${customIds[0]}`);
    assertEqual(status, 200);
    assertEqual(data.id, customIds[0]);
  });

  await testAsync('update custom expertise', async () => {
    const { status, data } = await api('PUT', `/api/expertises/${customIds[0]}`, {
      name: 'E2E Updated Expert', temperature: 0.7
    });
    assertEqual(status, 200);
    assertEqual(data.name, 'E2E Updated Expert');
    assertEqual(data.temperature, 0.7);
  });

  await testAsync('delete custom expertise', async () => {
    const { status, data } = await api('DELETE', `/api/expertises/${customIds[0]}`);
    assertEqual(status, 200);
    assertEqual(data.success, true);
    customIds.pop();
  });

  await testAsync('create with missing required fields returns 400', async () => {
    const { status } = await api('POST', '/api/expertises', {});
    assertEqual(status, 400);
  });

  // ── Merge Preview ──────────────────────────────────────────────────────
  suite('Merge Preview');

  await testAsync('merge preview with 2 expertises returns result', async () => {
    const { status: listStatus, data: listData } = await api('GET', '/api/expertises');
    assertEqual(listStatus, 200);
    const ids = listData.experts.slice(0, 2).map(e => e.id);
    assertEqual(ids.length, 2);
    const { status, data } = await api('GET', `/api/merge-preview?expertises=${ids.join(',')}`);
    assertEqual(status, 200);
    assertEqual(data.activeExpertises.length, 2);
    assert(typeof data.promptPreview === 'string' && data.promptPreview.length > 0, 'prompt preview required');
  });

} finally {
  for (const id of customIds) {
    try { await api('DELETE', `/api/expertises/${id}`); } catch {}
  }
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
