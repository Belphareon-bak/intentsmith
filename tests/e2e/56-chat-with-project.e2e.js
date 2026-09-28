// tests/e2e/56-chat-with-project.e2e.js — Chat with project context
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3 deterministic server scenario: proves an explicit project binding does
// not grant ambient file.read authority. No LLM response or disk byte is
// accepted as project-context evidence.
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite,
  testAsync,
  assert,
  assertEqual,
  summary,
  api,
  waitForServer,
  createConv,
  createProject,
  createProjectConv,
  chatInConv,
  cleanupProject,
  cleanupConversation,
} from './_helpers.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

await waitForServer();

const PROJECT_CANARY = 'INTENTSMITH_PROJECT_CONTEXT_CANARY_56';
const createdProjects = [];
const createdConversations = [];
let project = null;
let projectConvId = null;

try {
  suite('Chat with Project — Setup');

  await testAsync('create runner-owned project with canary file', async () => {
    project = await createProject('e2e-proj-chat', 'E2E project context fixture');
    createdProjects.push(project.id);
    writeFileSync(
      join(project.path, 'PROJECT-NOTE.txt'),
      `${PROJECT_CANARY}\nThis file belongs only to the project-bound scenario.\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
    assert(typeof project.id !== 'undefined' && project.id !== null, 'project id required');
  });

  await testAsync('create conversation bound to project', async () => {
    projectConvId = await createProjectConv(project.id, 'Project file-read conversation');
    createdConversations.push(projectConvId);

    const { status, data } = await api('GET', `/api/conversations/${projectConvId}`);
    assertEqual(status, 200);
    assertEqual(
      String(data.conversation?.project_id),
      String(project.id),
      'conversation must be persisted with the project binding',
    );
  });

  suite('Chat with Project — Deterministic Context');

  await testAsync('explicit project_id preserves binding but file.read fails closed', async () => {
    const result = await chatInConv(
      projectConvId,
      'Přečti soubor PROJECT-NOTE.txt.',
      { project_id: project.id },
    );
    assertEqual(result.status, 200);
    assertEqual(result.intent, 'FILE_READ');
    assertEqual(result.metadata?.securityBlocked, true);
    assertEqual(result.metadata?.fallbackSuppressed, true);
    assert(
      /^tool:[a-f0-9]{64}$/.test(result.metadata?.toolRequestId || ''),
      'file.read denial must retain its durable ToolRequest identity',
    );
    assert(
      !result.response.includes(PROJECT_CANARY),
      'file.read denial must not leak project bytes',
    );

    const info = await api('GET', `/api/chat/sessions/${projectConvId}`);
    assertEqual(info.status, 200);
    assertEqual(
      String(info.data.state?.project?.id),
      String(project.id),
      'chat session state must contain the explicit project',
    );
  });

  suite('Chat with Project — Isolation');

  await testAsync('unbound conversation remains outside project state', async () => {
    const unboundConvId = await createConv('project-isolation');
    createdConversations.push(unboundConvId);

    const result = await chatInConv(unboundConvId, 'Kolik je 2 + 2?');
    assertEqual(result.status, 200);
    assertEqual(result.intent, 'LOCAL');
    assert(result.response.includes('4'), 'deterministic local response must contain 4');
    assert(
      !result.response.includes(PROJECT_CANARY),
      'unbound response must not contain the project canary',
    );

    const info = await api('GET', `/api/chat/sessions/${unboundConvId}`);
    assertEqual(info.status, 200);
    assertEqual(info.data.state?.project, null, 'unbound session must have no project state');
  });
} finally {
  for (const id of createdConversations) await cleanupConversation(id);
  for (const id of createdProjects) await cleanupProject(id);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
