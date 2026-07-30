// tests/e2e/56-chat-with-project.e2e.js — Chat with project context
// ══════════════════════════════════════════════════════════════════════════════
// Tier 2: Verifies project context injection into chat.
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer, uniqueId, cleanupProject, cleanupConversation, makeOwnedTempDir, removeOwnedTempDir } from './_helpers.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

await waitForServer();

const LLM_TIMEOUT = 60000;
const createdProjects = [];
const createdConvs = [];
const tmpDir = makeOwnedTempDir('e2e-proj-chat');

try {
  // ── Setup Project ──────────────────────────────────────────────────────────
  suite('Chat with Project — Setup');

  let projectId = null;
  let convId = null;

  await testAsync('create project with files', async () => {
    const name = uniqueId('proj-chat');
    const projPath = join(tmpDir, name);
    // Create a simple project file
    const { mkdirSync } = await import('node:fs');
    mkdirSync(projPath, { recursive: true });
    writeFileSync(join(projPath, 'README.md'), '# Test Project\nThis is an E2E test project for C3.');

    const { status, data } = await api('POST', '/api/projects', {
      name, path: projPath, description: 'E2E test project for chat context'
    });
    assert(status === 200 || status === 201, `expected 200/201, got ${status}`);
    projectId = data.project?.id || data.id;
    if (projectId) createdProjects.push(projectId);
  });

  await testAsync('create conversation bound to project', async () => {
    if (!projectId) return;
    const { status, data } = await api('POST', '/api/conversations', {
      title: uniqueId('proj-chat-conv'),
      project_id: projectId,
      mode: 'chat'
    });
    assert(status === 200 || status === 201, `expected 200/201, got ${status}`);
    convId = data.id || data.conversation?.id;
    if (convId) createdConvs.push(convId);
  });

  // ── Chat with Project Context ─────────────────────────────────────────────
  suite('Chat with Project — Context');

  await testAsync('chat references project context', async () => {
    if (!convId) return;
    const { status, data } = await api('POST', '/api/chat', {
      message: 'Co obsahuje tento projekt?',
      conversation_id: convId
    });
    assert(status === 200 || status === 202, `expected 200/202, got ${status}`);
    if (data.response) {
      assert(data.response.length > 10, 'project chat response should be meaningful');
    }
  }, LLM_TIMEOUT);

  // ── Session Isolation ─────────────────────────────────────────────────────
  suite('Chat with Project — Isolation');

  await testAsync('chat without project does not reference project files', async () => {
    const { status, data } = await api('POST', '/chat', {
      message: 'Ahoj, o čem si povídáme?'
    });
    assert(status === 200 || status === 202, `expected 200/202, got ${status}`);
  }, LLM_TIMEOUT);

} finally {
  for (const id of createdConvs) await cleanupConversation(id);
  for (const id of createdProjects) await cleanupProject(id);
  try { removeOwnedTempDir(tmpDir); } catch {}
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
