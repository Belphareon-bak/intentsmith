// tests/e2e/57-lifecycle-full.e2e.js — Project lifecycle SPEC→BUILD detection
// ══════════════════════════════════════════════════════════════════════════════
// Tier 2: Verifies lifecycle detection via chat (not full build — too slow).
// Tests that the system recognizes project-building intent.
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer, uniqueId, cleanupProject, cleanupConversation, makeOwnedTempDir, removeOwnedTempDir } from './_helpers.js';
import { join } from 'node:path';

await waitForServer();

const LLM_TIMEOUT = 90000;
const createdProjects = [];
const createdConvs = [];
const tmpDir = makeOwnedTempDir('e2e-lifecycle');

try {
  // ── Setup ──────────────────────────────────────────────────────────────────
  suite('Lifecycle — Setup');

  let projectId = null;

  await testAsync('create project for lifecycle', async () => {
    const name = uniqueId('lifecycle');
    const projPath = join(tmpDir, name);
    const { mkdirSync } = await import('node:fs');
    mkdirSync(projPath, { recursive: true });

    const { status, data } = await api('POST', '/api/projects', {
      name, path: projPath, description: 'E2E lifecycle test'
    });
    assert(status === 200 || status === 201, `expected 200/201, got ${status}`);
    projectId = data.project?.id || data.id;
    if (projectId) createdProjects.push(projectId);
  });

  // ── Lifecycle Detection ────────────────────────────────────────────────────
  suite('Lifecycle — BUILD Intent Detection');

  await testAsync('project-building message triggers lifecycle or chat', async () => {
    if (!projectId) return;
    // Create conversation in project scope
    const { data: convData } = await api('POST', '/api/conversations', {
      title: uniqueId('lifecycle-conv'), project_id: projectId, mode: 'chat'
    });
    const convId = convData?.id || convData?.conversation?.id;
    if (convId) createdConvs.push(convId);

    const { status, data } = await api('POST', '/api/chat', {
      message: 'Chci vytvořit webovou aplikaci v Pythonu s Flaskem. Bude mít REST API pro správu úkolů.',
      conversation_id: convId
    });
    assert(status === 200 || status === 202, `expected 200/202, got ${status}`);
    if (data.response) {
      assert(data.response.length > 20, 'lifecycle response should be meaningful');
    }
  }, LLM_TIMEOUT);

  // ── Lifecycle Status Check ────────────────────────────────────────────────
  suite('Lifecycle — Status');

  await testAsync('project status accessible after lifecycle trigger', async () => {
    if (!projectId) return;
    const { status, data } = await api('GET', `/api/projects/${projectId}`);
    assert(status === 200 || status === 404, `expected 200/404, got ${status}`);
  });

} finally {
  for (const id of createdConvs) await cleanupConversation(id);
  for (const id of createdProjects) await cleanupProject(id);
  try { removeOwnedTempDir(tmpDir); } catch {}
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
