// tests/e2e/77-project-context-injection.e2e.js — Project Context in Responses
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3: Verifies project-bound conversations inject project context into responses.
// Creates project with unique canary content and validates it appears in responses.
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite, testAsync, assert, assertEqual, summary,
  api, waitForServer, createConv, createProject, createProjectConv,
  chatWithTimeout, hasKeywords, cleanupConversation, cleanupProject, LLM_TIMEOUT,
} from './_helpers.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

await waitForServer();

const created = [];
let projectId = null;
let projectDir = null;
let projectConvId = null;
let secondProjectId = null;
let secondProjectConvId = null;
const FIRST_PROJECT_CODE = 'ORION_VELA_A27';
const UPDATED_FIRST_PROJECT_CODE = 'ORION_VELA_C63';
const SECOND_PROJECT_CODE = 'LYRA_NOVA_B42';
const SINGLE_TURN_TIMEOUT = LLM_TIMEOUT + 15_000;

try {
  suite('Project Context — Setup');

  await testAsync('create project with unique canary content', async () => {
    const project = await createProject('e2e-project-context', 'Analýza hvězdných dat');
    projectId = project.id;
    projectDir = project.path;
    writeFileSync(join(projectDir, 'README.md'),
      `# Projekt XyzQuantum\n\nInterní kód projektu: ${FIRST_PROJECT_CODE}.\n` +
      'Tento projekt slouží pro analýzu hvězdných dat z observatoře Brno.\n\n## Funkce\n- Zpracování spektrálních dat\n- Výpočet červeného posuvu\n- Katalog hvězdných objektů\n');
    writeFileSync(join(projectDir, 'main.py'),
      'import numpy as np\n\ndef analyze_spectrum(data):\n    """Analyze star spectrum data."""\n    return np.fft.fft(data)\n');
  });

  await testAsync('create conversation bound to project', async () => {
    projectConvId = await createProjectConv(projectId, 'Project context test');
    created.push(projectConvId);
  });

  suite('Project Context — Content Injection');

  await testAsync('asks about project content and gets relevant answer', async () => {
    const r = await chatWithTimeout(
      projectConvId,
      'Co obsahuje tento projekt?',
      LLM_TIMEOUT,
    );
    assertEqual(r.mode, 'project');
    assert(hasKeywords(r.response, ['xyzquantum', 'hvězdn', 'spektr', 'observ', 'brno',
      'analýz', 'červen', 'posuv', 'readme', 'python', 'main.py'], 2),
      `project context should mention canary content: ${r.response.substring(0, 300)}`);

    const session = await api('GET', `/api/chat/sessions/${projectConvId}`);
    assertEqual(session.status, 200);
    assertEqual(session.data.state.project.id, projectId);
  }, SINGLE_TURN_TIMEOUT);

  await testAsync('follow-up about project files', async () => {
    const r = await chatWithTimeout(
      projectConvId,
      'A jaké jsou hlavní soubory projektu?',
      LLM_TIMEOUT,
    );
    assertEqual(r.mode, 'project');
    assert(hasKeywords(r.response, ['readme', 'main.py', 'python', 'numpy', 'soubor', 'file'], 2),
      `should reference project files: ${r.response.substring(0, 200)}`);
  }, SINGLE_TURN_TIMEOUT);

  suite('Project Context — Two Projects');

  await testAsync('create a second project with a distinct context', async () => {
    const second = await createProject('e2e-project-context-b', 'Evidence vodních čidel');
    secondProjectId = second.id;
    writeFileSync(join(second.path, 'README.md'),
      `# Projekt LyraHydro\n\nInterní kód projektu: ${SECOND_PROJECT_CODE}.\n` +
      'Projekt sleduje vodní čidla a jejich kalibraci.\n');
    writeFileSync(join(second.path, 'sensor.py'),
      'def calibrate(reading, offset):\n    return reading + offset\n');
    secondProjectConvId = await createProjectConv(secondProjectId, 'Second project context test');
    created.push(secondProjectConvId);
  });

  await testAsync('alternating project conversations use current README without cross-project content', async signal => {
    for (const [convId, ownCode, forbiddenCodes, ownProjectId, refreshFirstProject] of [
      [projectConvId, FIRST_PROJECT_CODE, [SECOND_PROJECT_CODE], projectId, false],
      [secondProjectConvId, SECOND_PROJECT_CODE, [FIRST_PROJECT_CODE], secondProjectId, false],
      [projectConvId, UPDATED_FIRST_PROJECT_CODE, [FIRST_PROJECT_CODE, SECOND_PROJECT_CODE], projectId, true],
    ]) {
      if (refreshFirstProject) {
        writeFileSync(join(projectDir, 'README.md'),
          `# Projekt XyzQuantum\n\nAktuální interní kód projektu: ${UPDATED_FIRST_PROJECT_CODE}.\n` +
          'Původní identifikátor už neplatí. Projekt analyzuje hvězdná data.\n');
      }
      const r = await chatWithTimeout(
        convId,
        'Jaký je aktuální přesný interní kód tohoto projektu podle README? Odpověz pouze kódem.',
        LLM_TIMEOUT,
      );
      assertEqual(r.mode, 'project');
      const normalized = r.response.trim().replace(/^```(?:text)?\s*|\s*```$/g, '').trim();
      assertEqual(normalized, ownCode,
        `project ${ownProjectId} must return only its current README code`);
      for (const forbiddenCode of forbiddenCodes) {
        assert(!r.response.includes(forbiddenCode),
          `project ${ownProjectId} exposed stale or foreign code: ${r.response.substring(0, 200)}`);
      }
      const session = await api('GET', `/api/chat/sessions/${convId}`, undefined, signal);
      assertEqual(session.status, 200);
      assertEqual(session.data.state.project.id, ownProjectId);
    }
  }, LLM_TIMEOUT * 4);

  suite('Project Context — Isolation');

  await testAsync('unbound conversation has no project context', async () => {
    const noProjectConvId = await createConv('project-context-unbound');
    created.push(noProjectConvId);

    const r = await chatWithTimeout(
      noProjectConvId,
      'Co obsahuje tento projekt?',
      LLM_TIMEOUT,
    );
    assert(!hasKeywords(r.response, ['xyzquantum', 'hvězdných', 'observatoř', 'spektráln'], 1),
      `unbound conv should NOT mention project canary: ${r.response.substring(0, 200)}`);
    assert(!r.response.includes(FIRST_PROJECT_CODE)
      && !r.response.includes(UPDATED_FIRST_PROJECT_CODE)
      && !r.response.includes(SECOND_PROJECT_CODE),
      `unbound conversation leaked a project code: ${r.response.substring(0, 200)}`);

    const session = await api('GET', `/api/chat/sessions/${noProjectConvId}`);
    assertEqual(session.status, 200);
    assertEqual(session.data.state.project, null);
  }, SINGLE_TURN_TIMEOUT);

  suite('Project Context — Intent Detection');

  await testAsync('BUILD intent detected in project conversation', async () => {
    const convId = await createProjectConv(projectId, 'Build intent test');
    created.push(convId);

    const r = await chatWithTimeout(
      convId,
      'Chci přidat nový REST API endpoint pro správu hvězdných dat',
      LLM_TIMEOUT,
    );
    assertEqual(r.mode, 'project');
    assertEqual(r.intent, 'BUILD');
    assert(r.response.length > 20, 'should have meaningful response');
  }, SINGLE_TURN_TIMEOUT);

} finally {
  for (const id of created) await cleanupConversation(id);
  if (projectId) await cleanupProject(projectId);
  if (secondProjectId) await cleanupProject(secondProjectId);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
