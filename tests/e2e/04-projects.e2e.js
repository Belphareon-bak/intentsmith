// tests/e2e/04-projects.e2e.js — Project CRUD & workspace
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer, uniqueId, cleanupProject, makeOwnedTempDir, removeOwnedTempDir } from './_helpers.js';

await waitForServer();

const created = [];
const tmpDir = makeOwnedTempDir('e2e-proj');

try {
  // ── List ────────────────────────────────────────────────────────────────
  suite('GET /api/projects — list');

  await testAsync('returns projects array', async () => {
    const { status, data } = await api('GET', '/api/projects');
    assertEqual(status, 200);
    assert(Array.isArray(data.projects), 'projects must be array');
  });

  await testAsync('respects limit param', async () => {
    const { status, data } = await api('GET', '/api/projects?limit=1');
    assertEqual(status, 200);
    assert(data.projects.length <= 1, 'should respect limit');
  });

  await testAsync('defaults endpoint returns defaultDir', async () => {
    const { status, data } = await api('GET', '/api/projects/defaults');
    assertEqual(status, 200);
    assert(typeof data.defaultDir === 'string', 'defaultDir must be string');
  });

  // ── Create ──────────────────────────────────────────────────────────────
  suite('POST /api/projects — create');

  await testAsync('creates project under the runner-owned projects root', async () => {
    const name = uniqueId('test-project');
    const { status, data } = await api('POST', '/api/projects', {
      name,
      description: 'E2E test project',
    });
    assertEqual(status, 201);
    assert(data.project?.id, 'project id required');
    assertEqual(data.id, data.project.id);
    assertEqual(data.path, data.project.path);
    created.push(data.project.id);
  });

  await testAsync('create without name returns 400', async () => {
    const { status } = await api('POST', '/api/projects', {
      description: 'missing name',
    });
    assertEqual(status, 400);
  });

  // ── Get Single ──────────────────────────────────────────────────────────
  suite('GET /api/projects/:id');

  await testAsync('returns existing project', async () => {
    const { status, data } = await api('GET', `/api/projects/${created[0]}`);
    assertEqual(status, 200);
    assertEqual(data.project?.id, created[0]);
  });

  await testAsync('returns 404 for nonexistent', async () => {
    const { status } = await api('GET', '/api/projects/999999999');
    assertEqual(status, 404);
  });

  // ── Update ──────────────────────────────────────────────────────────────
  suite('PUT /api/projects/:id — update');

  await testAsync('updates project description', async () => {
    const { status, data } = await api('PUT', `/api/projects/${created[0]}`, { description: 'Updated description' });
    assertEqual(status, 200);
    assertEqual(data.project?.description, 'Updated description');
  });

  await testAsync('returns 404 for nonexistent', async () => {
    const { status } = await api('PUT', '/api/projects/999999999', { description: 'x' });
    assertEqual(status, 404);
  });

  // ── Archive / Delete ───────────────────────────────────────────────────
  suite('Project Archive & Delete');

  await testAsync('archive project', async () => {
    const { status, data } = await api('PATCH', `/api/projects/${created[0]}/archive`);
    assertEqual(status, 200);
    assertEqual(data.success, true);
    assertEqual(data.status, 'archived');
  });

  await testAsync('restore project', async () => {
    const { status, data } = await api('PATCH', `/api/projects/${created[0]}/restore`);
    assertEqual(status, 200);
    assertEqual(data.success, true);
    assertEqual(data.status, 'active');
  });

  await testAsync('delete project', async () => {
    const { status, data } = await api('DELETE', `/api/projects/${created[0]}`);
    assertEqual(status, 200);
    assertEqual(data.success, true);
    assertEqual(data.mode, 'soft');
  });

  // ── Open Folder ────────────────────────────────────────────────────────
  suite('POST /api/projects/open-folder');

  await testAsync('registers an existing runner-owned folder', async () => {
    const { status, data } = await api('POST', '/api/projects/open-folder', {
      folderPath: tmpDir,
      name: uniqueId('e2e-folder-test'),
    });
    assertEqual(status, 201);
    assertEqual(data.status, 'registered');
    assert(data.project?.id, 'registered project id required');
    created.push(data.project.id);
  });

} finally {
  for (const id of created) {
    await cleanupProject(id);
  }
  removeOwnedTempDir(tmpDir);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
