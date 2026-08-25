// M3 project-bound code-review specialist journey. This suite is deliberately
// local-server-only: deterministic ProjectContext retrieval and package tools
// must produce the final response without Ollama/model fallback.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  api,
  assert,
  assertEqual,
  cleanupConversation,
  cleanupProject,
  createProject,
  createProjectConv,
  suite,
  summary,
  testAsync,
  waitForServer,
} from './_helpers.js';

await waitForServer();

let project = null;
let conversationId = null;
let disabled = false;

try {
  suite('M3 code-review specialist — setup and deterministic result');

  await testAsync('create a project fixture and select the native specialist', async () => {
    project = await createProject('m3-code-review', 'M3 deterministic specialist fixture');
    const projectRecord = await api('GET', `/api/projects/${project.id}`);
    assertEqual(projectRecord.status, 200);
    assertEqual(projectRecord.data.project.status, 'active');
    mkdirSync(path.join(project.path, 'src'), { recursive: true });
    writeFileSync(
      path.join(project.path, 'src/auth.js'),
      [
        'export function validateSessionToken(input) {',
        '  return eval(input);',
        '}',
        '',
      ].join('\n'),
    );
    conversationId = await createProjectConv(project.id, 'M3 code review');

    const selected = await api('POST', '/api/chat/specialist', {
      sessionId: conversationId,
      specialistId: 'code-reviewer',
    });
    assertEqual(selected.status, 200);
    assertEqual(selected.data.specialistId, 'code-reviewer');
  });

  await testAsync('project chat returns deterministic findings, provenance and expertise evidence', async () => {
    const { status, data } = await api('POST', '/api/chat', {
      conversation_id: conversationId,
      message: 'Proveď security audit validateSessionToken v tomto projektu.',
    });
    assertEqual(status, 200);
    assertEqual(data.mode, 'specialist');
    assert(
      data.response.includes('**CRITICAL** `src/auth.js:2`'),
      `missing exact critical finding: ${data.response}`,
    );
    assert(data.response.includes('ProjectContext:'), `missing ProjectContext receipt: ${data.response}`);
    assert(
      data.response.includes('Toto je automatizovane code review'),
      `missing expertise disclaimer: ${data.response}`,
    );
    assertEqual(data.metadata.executionStatus, 'SUCCESS');
    assertEqual(data.metadata.deterministicPresentation, true);
    assertEqual(data.metadata.specialist.id, 'code-reviewer');
    assertEqual(data.metadata.specialist.version, '1.1.0');
    assertEqual(data.metadata.expertise.id, 'code_reviewer');
    assertEqual(data.metadata.expertise.evidence.moduleVersion, '1.1.0');
    assertEqual(data.metadata.projectContext.projectId, project.id);
    assert(
      /^wsr1:[a-f0-9]{64}$/.test(data.metadata.projectContext.workspaceRevision),
      `invalid workspace revision: ${data.metadata.projectContext.workspaceRevision}`,
    );
    assert(
      data.metadata.projectContext.items.some(item => item.path === 'src/auth.js'),
      'ProjectContext evidence must include the reviewed source path',
    );
    assertEqual(
      data.metadata.projectContext.items.some(item => Object.hasOwn(item, 'content')),
      false,
    );
    const finding = data.metadata.toolResults[0].data.data.vulnerabilities[0];
    assertEqual(finding.severity, 'critical');
    assertEqual(finding.path, 'src/auth.js');
    assertEqual(finding.line, 2);
    assertEqual(finding.provenance.projectId, project.id);
    const session = await api('GET', `/api/chat/sessions/${conversationId}`);
    assertEqual(session.status, 200);
    assertEqual(session.data.state.project.id, project.id);
    assertEqual(session.data.state.specialist.id, 'code-reviewer');
  });

  suite('M3 code-review specialist — disabled and absent fail closed');

  await testAsync('disabled package clears stale selection without package or model fallback', async () => {
    const disable = await api('POST', '/api/specialists/code-reviewer/disable');
    assertEqual(disable.status, 200);
    disabled = true;

    const rejectedSelection = await api('POST', '/api/chat/specialist', {
      sessionId: conversationId,
      specialistId: 'code-reviewer',
    });
    assertEqual(rejectedSelection.status, 409);
    assertEqual(rejectedSelection.data.errorCode, 'M3_SPECIALIST_UNAVAILABLE');

    const stale = await api('POST', '/api/chat', {
      conversation_id: conversationId,
      message: 'Proveď security audit validateSessionToken v tomto projektu.',
    });
    assertEqual(stale.status, 200);
    assertEqual(stale.data.mode, 'specialist');
    assertEqual(stale.data.metadata.errorCode, 'M3_SPECIALIST_UNAVAILABLE');
    assertEqual(stale.data.metadata.specialistAvailable, false);
    assert(stale.data.response.includes('Nebyl spuštěn žádný jeho nástroj ani modelový fallback'));
    const session = await api('GET', `/api/chat/sessions/${conversationId}`);
    assertEqual(session.status, 200);
    assertEqual(session.data.state.specialist, null);
  });

  await testAsync('absent package selection is explicit 404', async () => {
    const missing = await api('POST', '/api/chat/specialist', {
      sessionId: conversationId,
      specialistId: 'not-installed-specialist',
    });
    assertEqual(missing.status, 404);
  });
} finally {
  if (disabled) {
    try { await api('POST', '/api/specialists/code-reviewer/enable'); } catch {}
  }
  if (conversationId) {
    try { await api('DELETE', '/api/chat/specialist', { sessionId: conversationId }); } catch {}
    await cleanupConversation(conversationId);
  }
  if (project?.id) await cleanupProject(project.id);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
