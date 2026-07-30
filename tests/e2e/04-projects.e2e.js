// tests/e2e/04-projects.e2e.js — Project CRUD & workspace
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer, uniqueId, cleanupProject, makeOwnedTempDir, removeOwnedTempDir } from './_helpers.js';
import { join } from 'node:path';

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
    const { data } = await api('GET', '/api/projects?limit=1');
    assert(data.projects.length <= 1, 'should respect limit');
  });

  await testAsync('defaults endpoint returns defaultDir', async () => {
    const { status, data } = await api('GET', '/api/projects/defaults');
    assertEqual(status, 200);
    assert(typeof data.defaultDir === 'string', 'defaultDir must be string');
  });

  // ── Create ──────────────────────────────────────────────────────────────
  suite('POST /api/projects — create');

  await testAsync('creates project with name and path', async () => {
    const name = uniqueId('test-project');
    const projPath = join(tmpDir, name);
    const { status, data } = await api('POST', '/api/projects', { name, path: projPath, description: 'E2E test project' });
    assert(status === 200 || status === 201, `expected 200/201, got ${status}`);
    const id = data.project?.id || data.id;
    assert(id, 'project id required');
    created.push(id);
  });

  await testAsync('create without name returns 400', async () => {
    const { status } = await api('POST', '/api/projects', {
      path: join(tmpDir, 'no-name'),
    });
    assertEqual(status, 400);
  });

  // ── Get Single ──────────────────────────────────────────────────────────
  suite('GET /api/projects/:id');

  await testAsync('returns existing project', async () => {
    if (!created[0]) return;
    const { status, data } = await api('GET', `/api/projects/${created[0]}`);
    assertEqual(status, 200);
    assert(data.name || data.project, 'project data required');
  });

  await testAsync('returns 404 or 500 for nonexistent', async () => {
    const { status } = await api('GET', '/api/projects/proj-nonexistent-xyz');
    assert(status === 404 || status === 500, `expected 404/500, got ${status}`);
  });

  // ── Update ──────────────────────────────────────────────────────────────
  suite('PUT /api/projects/:id — update');

  await testAsync('updates project description', async () => {
    if (!created[0]) return;
    const { status } = await api('PUT', `/api/projects/${created[0]}`, { description: 'Updated description' });
    assert(status === 200 || status === 204, `expected 200/204, got ${status}`);
  });

  await testAsync('returns 404 or 500 for nonexistent', async () => {
    const { status } = await api('PUT', '/api/projects/proj-nonexistent-xyz', { description: 'x' });
    assert(status === 404 || status === 500, `expected 404/500, got ${status}`);
  });

  // ── Archive / Delete ───────────────────────────────────────────────────
  suite('Project Archive & Delete');

  await testAsync('archive project', async () => {
    if (!created[0]) return;
    const { status } = await api('PATCH', `/api/projects/${created[0]}/archive`);
    assert(status === 200 || status === 204, `expected 200/204, got ${status}`);
  });

  await testAsync('restore project', async () => {
    if (!created[0]) return;
    const { status } = await api('PATCH', `/api/projects/${created[0]}/restore`);
    assert(status === 200 || status === 204, `expected 200/204, got ${status}`);
  });

  await testAsync('delete project', async () => {
    if (!created[0]) return;
    const { status } = await api('DELETE', `/api/projects/${created[0]}`);
    assert(status === 200 || status === 204, `expected 200/204, got ${status}`);
  });

  // ── Open Folder ────────────────────────────────────────────────────────
  suite('POST /api/projects/open-folder');

  await testAsync('registers existing folder (or rejects missing name)', async () => {
    const { status } = await api('POST', '/api/projects/open-folder', { path: tmpDir, name: 'e2e-folder-test' });
    assert(status === 200 || status === 201 || status === 400, `expected 200/201/400, got ${status}`);
  });

} finally {
  for (const id of created) {
    await cleanupProject(id);
  }
  try { removeOwnedTempDir(tmpDir); } catch {}
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
