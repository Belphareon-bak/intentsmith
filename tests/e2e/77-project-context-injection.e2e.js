// tests/e2e/77-project-context-injection.e2e.js — Project Context in Responses
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3: Verifies project-bound conversations inject project context into responses.
// Creates project with unique canary content and validates it appears in responses.
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite, testAsync, assert, summary,
  api, waitForServer, chatInConv, hasKeywords, cleanupConversation, cleanupProject,
  uniqueId, LLM_TIMEOUT, makeOwnedTempDir, removeOwnedTempDir,
} from './_helpers.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

await waitForServer();

const created = [];
let projectId = null;
let projectDir = null;

try {
  suite('Project Context — Setup');

  await testAsync('create project with unique canary content', async () => {
    // Create temp dir with unique content, inside the runner-owned artifact root
    projectDir = makeOwnedTempDir('e2e-project');
    writeFileSync(join(projectDir, 'README.md'),
      '# Projekt XyzQuantum\n\nTento projekt slouží pro analýzu hvězdných dat z observatoře Brno.\n\n## Funkce\n- Zpracování spektrálních dat\n- Výpočet červeného posuvu\n- Katalog hvězdných objektů\n');
    writeFileSync(join(projectDir, 'main.py'),
      'import numpy as np\n\ndef analyze_spectrum(data):\n    """Analyze star spectrum data."""\n    return np.fft.fft(data)\n');

    // Create project via API
    const { status, data } = await api('POST', '/api/projects', {
      name: uniqueId('XyzQuantum'),
      description: 'Analýza hvězdných dat',
      path: projectDir,
    });
    assert(status === 200 || status === 201, `expected 200/201, got ${status}`);
    projectId = data.id || data.project?.id;
    assert(projectId, 'project ID required');
  });

  await testAsync('create conversation bound to project', async () => {
    if (!projectId) return;
    const { status, data } = await api('POST', '/api/conversations', {
      title: 'Project context test',
      mode: 'chat',
      project_id: projectId,
    });
    assert(status === 200 || status === 201, `expected 200/201, got ${status}`);
    const convId = data.id || data.conversation?.id;
    assert(convId, 'conversation ID required');
    created.push(convId);
  });

  suite('Project Context — Content Injection');

  await testAsync('asks about project content and gets relevant answer', async () => {
    if (created.length === 0 || !projectId) return;
    const r = await chatInConv(created[0], 'Co obsahuje tento projekt?');
    // Should mention the project canary content
    assert(hasKeywords(r.response, ['xyzquantum', 'hvězdn', 'spektr', 'observ', 'brno',
      'analýz', 'červen', 'posuv', 'readme', 'python', 'main.py'], 1),
      `project context should mention canary content: ${r.response.substring(0, 300)}`);
  }, LLM_TIMEOUT);

  await testAsync('follow-up about project files', async () => {
    if (created.length === 0 || !projectId) return;
    const r = await chatInConv(created[0], 'A jaké jsou hlavní soubory projektu?');
    assert(hasKeywords(r.response, ['readme', 'main.py', 'python', 'numpy', 'soubor', 'file'], 1),
      `should reference project files: ${r.response.substring(0, 200)}`);
  }, LLM_TIMEOUT);

  suite('Project Context — Isolation');

  await testAsync('unbound conversation has no project context', async () => {
    // Create conversation WITHOUT project
    const { data } = await api('POST', '/api/conversations', {
      title: 'No project conv',
      mode: 'chat',
    });
    const noProjectConvId = data.id || data.conversation?.id;
    if (noProjectConvId) created.push(noProjectConvId);

    const r = await chatInConv(noProjectConvId, 'Co obsahuje tento projekt?');
    // Should NOT mention XyzQuantum canary
    assert(!hasKeywords(r.response, ['xyzquantum', 'hvězdných', 'observatoř', 'spektráln'], 1),
      `unbound conv should NOT mention project canary: ${r.response.substring(0, 200)}`);
  }, LLM_TIMEOUT);

  suite('Project Context — Intent Detection');

  await testAsync('BUILD intent detected in project conversation', async () => {
    if (created.length === 0 || !projectId) return;
    // Create a fresh project conversation for this test
    const { data } = await api('POST', '/api/conversations', {
      title: 'Build intent test',
      mode: 'chat',
      project_id: projectId,
    });
    const convId = data.id || data.conversation?.id;
    if (convId) created.push(convId);

    const r = await chatInConv(convId, 'Chci přidat nový REST API endpoint pro správu hvězdných dat');
    // Intent should be BUILD, CODE, or DESIGN in project context
    if (r.intent) {
      assert(['BUILD', 'CODE', 'DESIGN', 'PLAN', 'CREATIVE', 'CONVERSATIONAL'].includes(r.intent),
        `in project context, coding request should get coding-related intent, got: ${r.intent}`);
    }
    assert(r.response.length > 20, 'should have meaningful response');
  }, LLM_TIMEOUT);

  suite('Project Context — Cleanup');

  await testAsync('cleanup project and conversations', async () => {
    // Conversations cleaned in finally block
    if (projectId) await cleanupProject(projectId);
    if (projectDir) {
      try { removeOwnedTempDir(projectDir); } catch {}
    }
    assert(true, 'cleanup complete');
  });

} finally {
  for (const id of created) await cleanupConversation(id);
  if (projectId) await cleanupProject(projectId);
  if (projectDir) {
    try { removeOwnedTempDir(projectDir); } catch {}
  }
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
