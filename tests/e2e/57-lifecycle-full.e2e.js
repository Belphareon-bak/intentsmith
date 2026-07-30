// tests/e2e/57-lifecycle-full.e2e.js — Project lifecycle SPEC→BUILD detection
// ══════════════════════════════════════════════════════════════════════════════
// Tier 2: Verifies lifecycle detection via chat (not full build — too slow).
// Tests that the system recognizes project-building intent.
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite, testAsync, assert, assertEqual, summary, api, waitForServer,
  createProject, createProjectConv, cleanupProject, cleanupConversation,
} from './_helpers.js';

await waitForServer();

const LLM_TIMEOUT = 90000;
const createdProjects = [];
const createdConvs = [];

try {
  // ── Setup ──────────────────────────────────────────────────────────────────
  suite('Lifecycle — Setup');

  let projectId = null;
  let convId = null;

  await testAsync('create project for lifecycle', async () => {
    const project = await createProject('e2e-lifecycle', 'E2E lifecycle test');
    projectId = project.id;
    createdProjects.push(projectId);
    convId = await createProjectConv(projectId, 'lifecycle-conv');
    createdConvs.push(convId);
  });

  // ── Lifecycle Detection ────────────────────────────────────────────────────
  suite('Lifecycle — BUILD Intent Detection');

  await testAsync('project-building message proposes a lifecycle handoff', async (signal) => {
    const { status, data } = await api('POST', '/api/chat', {
      conversation_id: convId,
      project_id: projectId,
      message: 'Chci vytvořit webovou aplikaci v Pythonu s Flaskem. Bude mít REST API pro správu úkolů.',
    }, signal);
    assertEqual(status, 200);
    assert(
      typeof data.response === 'string' && data.response.trim().length > 0,
      'lifecycle proposal must contain a response',
    );
    assertEqual(data.mode, 'project');
    assertEqual(data.metadata?.lifecycleHandoff, true);
    assertEqual(data.metadata?.phase, 'PROPOSED');
    assert(
      /potvr|confirm|ano|yes/i.test(data.response),
      'lifecycle proposal must request explicit confirmation',
    );
  }, LLM_TIMEOUT);

  // ── Lifecycle Status Check ────────────────────────────────────────────────
  suite('Lifecycle — Status');

  await testAsync('project status accessible after lifecycle trigger', async () => {
    const { status, data } = await api('GET', `/api/projects/${projectId}`);
    assertEqual(status, 200);
    assertEqual(data.project?.id ?? data.id, projectId);
  });

} finally {
  for (const id of createdConvs) await cleanupConversation(id);
  for (const id of createdProjects) await cleanupProject(id);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
