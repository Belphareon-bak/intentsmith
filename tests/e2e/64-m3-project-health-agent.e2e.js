// M3 local project-health agent journey. This suite uses only the isolated
// server, runner-owned project files, M2 ProjectContext and in-app SQLite
// notifications. It must not call a model, external network, GPU or Ollama.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { buildProjectContextManifest } from '../../src/code-intel/project-context-manifest.js';

import {
  api,
  assert,
  assertEqual,
  cleanupProject,
  createProject,
  suite,
  summary,
  testAsync,
  uniqueId,
  waitForServer,
} from './_helpers.js';

await waitForServer();

let project = null;
let agentId = null;
let baselineEvidence = null;
let baselineManifest = null;

function changedManifestPaths(before, after) {
  const previous = new Map(before.entries.map(entry => [entry.path, entry]));
  const current = new Map(after.entries.map(entry => [entry.path, entry]));
  return [...new Set([...previous.keys(), ...current.keys()])]
    .filter(sourcePath => !isDeepStrictEqual(previous.get(sourcePath), current.get(sourcePath)))
    .sort();
}

try {
  suite('M3 project-health agent — extension install and disabled boundary');

  await testAsync('discover native agent extension and install a disabled project instance', async () => {
    project = await createProject('m3-project-health', 'M3 local agent fixture');
    writeFileSync(path.join(project.path, 'index.js'), 'export const healthy = true;\n');

    const extensions = await api('GET', '/api/agent-extensions');
    assertEqual(extensions.status, 200);
    const projectHealth = extensions.data.extensions.find(item => item.id === 'project-health');
    assert(projectHealth, 'project-health extension must be discoverable');
    assertEqual(projectHealth.moduleVersion, '1.0.0');
    assertEqual(projectHealth.enabledByDefault, false);

    agentId = uniqueId('project-health');
    const installed = await api('POST', '/api/agent-extensions/project-health/install', {
      instanceId: agentId,
      projectId: project.id,
      enabled: false,
    });
    assertEqual(installed.status, 201);
    assertEqual(installed.data.id, agentId);
    assertEqual(installed.data.enabled, false);
    assertEqual(installed.data.definition.m3_extension.id, 'project-health');
  });

  await testAsync('manual run while disabled creates no run and no notification', async () => {
    const skipped = await api('POST', `/api/agent-extensions/instances/${agentId}/run`);
    assertEqual(skipped.status, 200);
    assertEqual(skipped.data.run_state, 'SKIP_DISABLED');
    assertEqual(skipped.data.reason, 'disabled');

    const detail = await api('GET', `/api/agents/${agentId}`);
    assertEqual(detail.status, 200);
    assertEqual(detail.data.recentRuns.length, 0);
    assertEqual(detail.data.notifications.length, 0);
  });

  suite('M3 project-health agent — source, condition, trigger, action, result');

  await testAsync('first enabled run establishes exact workspace baseline', async () => {
    const enabled = await api('POST', `/api/agent-extensions/instances/${agentId}/enable`);
    assertEqual(enabled.status, 200);
    assertEqual(enabled.data.enabled, true);

    const baseline = await api('POST', `/api/agent-extensions/instances/${agentId}/run`);
    assertEqual(baseline.status, 200);
    assertEqual(baseline.data.run_state, 'INIT_BASELINE');
    assertEqual(baseline.data.triggered.length, 0);
    baselineEvidence = baseline.data.explain.sources[0].evidence;
    assertEqual(baselineEvidence.projectId, project.id);
    assert(Number.isSafeInteger(baselineEvidence.issueCount) && baselineEvidence.issueCount >= 0);
    baselineManifest = await buildProjectContextManifest({
      projectId: project.id,
      canonicalRoot: project.path,
    });
    assertEqual(baselineEvidence.workspaceRevision, baselineManifest.revision);

    const detail = await api('GET', `/api/agents/${agentId}`);
    assert(
      /^wsr1:[a-f0-9]{64}$/.test(
        detail.data.state._prev_sources_project_health_data_workspace_revision,
      ),
      'workspace baseline must be persisted',
    );
    assertEqual(detail.data.notifications.length, 0);
  });

  await testAsync('project change produces durable ProjectContext evidence and visible notification', async () => {
    const changedContent = 'export const healthy = false;\n// FIXME remove temporary bypass\n';
    writeFileSync(path.join(project.path, 'index.js'), changedContent);
    const changedManifest = await buildProjectContextManifest({
      projectId: project.id,
      canonicalRoot: project.path,
    });
    assertEqual(changedManifestPaths(baselineManifest, changedManifest).join(','), 'index.js');
    const changed = await api('POST', `/api/agent-extensions/instances/${agentId}/run`);
    assertEqual(changed.status, 200);
    assertEqual(changed.data.run_state, 'SUCCESS_TRIGGERED');
    assertEqual(changed.data.triggered[0], 'health_changed');
    assertEqual(changed.data.actions.some(action => action.type === 'notify' && action.status === 'ok'), true);

    const detail = await api('GET', `/api/agents/${agentId}`);
    assertEqual(detail.status, 200);
    assertEqual(detail.data.notifications.length, 1);
    const notification = detail.data.notifications[0];
    assertEqual(notification.agent_id, agentId);
    assertEqual(notification.run_id, changed.data.runId);
    assertEqual(notification.title, 'Project Health: attention');
    assert(/^wsr1:[a-f0-9]{64}$/.test(notification.data.workspaceRevision));
    assert(/^pcs1:[a-f0-9]{64}$/.test(notification.data.snapshotDigest));

    const run = detail.data.recentRuns[0];
    assertEqual(run.id, changed.data.runId);
    assertEqual(run.explain.run_id, changed.data.runId);
    assertEqual(run.explain.run_state, 'SUCCESS_TRIGGERED');
    const evidence = run.explain.sources[0].evidence;
    assertEqual(evidence.projectId, project.id);
    assertEqual(evidence.workspaceRevision, changedManifest.revision);
    assertEqual(evidence.issueCount, baselineEvidence.issueCount + 1);
    assertEqual(evidence.filesObserved, evidence.provenance.length);
    assertEqual(notification.data.projectId, String(project.id));
    assertEqual(notification.data.workspaceRevision, evidence.workspaceRevision);
    assertEqual(notification.data.snapshotDigest, evidence.snapshotDigest);
    assertEqual(notification.data.issueCount, String(evidence.issueCount));
    assertEqual(notification.data.filesObserved, String(evidence.filesObserved));
    assertEqual(notification.body,
      `Projekt ${project.id}: ${evidence.issueCount} signálů v ${evidence.filesObserved} souborech. `
      + `Revision ${evidence.workspaceRevision}.`);
    const changedDigest = `sha256:${createHash('sha256').update(changedContent).digest('hex')}`;
    const sourceEvidence = evidence.provenance.filter(item => item.path === 'index.js');
    assertEqual(sourceEvidence.length, 1);
    assertEqual(sourceEvidence[0].contentDigest, changedDigest);
    assertEqual(changedManifest.entries.find(entry => entry.path === 'index.js')?.contentDigest,
      changedDigest);
    assert(!baselineEvidence.provenance.some(item => item.path === 'index.js'
      && item.contentDigest === changedDigest), 'baseline must not contain the changed source bytes');
    const roadmapPath = path.join(project.path, 'ROADMAP.md');
    assert(!evidence.provenance.some(item => item.path === 'ROADMAP.md'),
      'negative control must be outside query-matching provenance');
    const roadmapBytes = readFileSync(roadmapPath);
    try {
      writeFileSync(roadmapPath, Buffer.concat([roadmapBytes, Buffer.from('\nManifest-only probe.\n')]));
      const unrelatedEdit = await buildProjectContextManifest({
        projectId: project.id,
        canonicalRoot: project.path,
      });
      assertEqual(changedManifestPaths(changedManifest, unrelatedEdit).join(','), 'ROADMAP.md');
      assert(unrelatedEdit.revision !== changedManifest.revision,
        'an unrelated, query-invisible project edit must change the full workspace revision');
    } finally {
      writeFileSync(roadmapPath, roadmapBytes);
    }
    const restored = await buildProjectContextManifest({
      projectId: project.id,
      canonicalRoot: project.path,
    });
    assertEqual(restored.revision, changedManifest.revision);

    const studio = await api('GET', '/agents');
    assertEqual(studio.status, 200);
    assert(studio.data.includes('🔔 Výsledky'), 'Studio agent detail must expose the results tab');
    assert(studio.data.includes('notification.body'), 'results tab must render notification body');
  });

  await testAsync('disable remains inert after a successful effect-free run', async () => {
    const disabled = await api('POST', `/api/agent-extensions/instances/${agentId}/disable`);
    assertEqual(disabled.status, 200);
    assertEqual(disabled.data.enabled, false);
    writeFileSync(path.join(project.path, 'index.js'), '// FIXME another change\n');

    const skipped = await api('POST', `/api/agent-extensions/instances/${agentId}/run`);
    assertEqual(skipped.status, 200);
    assertEqual(skipped.data.run_state, 'SKIP_DISABLED');
    const detail = await api('GET', `/api/agents/${agentId}`);
    assertEqual(detail.data.notifications.length, 1);
    assertEqual(detail.data.recentRuns.length, 2);
  });

  suite('M3 project-health agent — uninstall');

  await testAsync('owned disabled instance is removable through extension lifecycle', async () => {
    const removed = await api(
      'DELETE',
      `/api/agent-extensions/project-health/instances/${agentId}`,
    );
    assertEqual(removed.status, 200);
    assertEqual(removed.data.removed, true);
    const absent = await api('GET', `/api/agents/${agentId}`);
    assertEqual(absent.status, 404);
    agentId = null;
  });
} finally {
  if (agentId) {
    try {
      await api('DELETE', `/api/agent-extensions/instances/${agentId}`);
    } catch {}
  }
  if (project?.id) await cleanupProject(project.id);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
