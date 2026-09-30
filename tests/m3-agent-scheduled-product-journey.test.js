#!/usr/bin/env node

// A trusted M3 extension must run from the product scheduler after startup,
// preserve its ProjectContext baseline, and deliver a durable in-app result.
// The five-minute interval is recovered from controlled state in test-owned
// SQLite; no wall-clock soak or model call is involved.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

import Database from 'better-sqlite3';

import { AgentRepository } from '../src/agents/repository.js';
import { createOwnedJourneyRuntime, expectJson, startProduct, stopProduct } from
  './helpers/chat-project-expertise-model-journey.js';
import { isolatedTestRuntime as parentRuntime } from './helpers/isolated-test-db.js';

const MODEL = 'fixture:1b';
const DIGEST = 'a'.repeat(64);
const EXTENSION_ID = 'scheduled-project-health';

async function startTripwireProvider() {
  let modelCalls = 0;
  const server = http.createServer(async (request, response) => {
    for await (const _chunk of request) { /* drain */ }
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') {
      response.end(JSON.stringify({ models: [{ name: MODEL, digest: DIGEST }] }));
    } else if (request.url === '/api/show') {
      response.end(JSON.stringify({ model_info: { 'fixture.context_length': 4096 } }));
    } else if (request.url === '/api/chat' || request.url === '/api/generate') {
      modelCalls++;
      response.writeHead(503).end(JSON.stringify({ error: 'Scheduled worker must not call a model' }));
    } else {
      response.writeHead(503).end(JSON.stringify({ error: 'Unexpected provider endpoint' }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address !== 'string' && address.address === '127.0.0.1');
  return { url: `http://127.0.0.1:${address.port}`,
    get modelCalls() { return modelCalls; },
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

function createTestExtensionRoot(runtime) {
  const extensionsDir = path.join(runtime.artifacts, 'agent-extensions');
  const shipped = JSON.parse(readFileSync(
    new URL('../agent-extensions/project-health/agent.json', import.meta.url), 'utf8'));
  const scheduled = structuredClone(shipped);
  scheduled.id = EXTENSION_ID;
  scheduled.payload.definition.id = EXTENSION_ID;
  scheduled.payload.definition.name = 'Scheduled Project Health fixture';
  scheduled.payload.definition.schedule = { type: 'interval', value: '5m' };
  for (const manifest of [shipped, scheduled]) {
    const directory = path.join(extensionsDir, manifest.id);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(directory, 'agent.json'), `${JSON.stringify(manifest)}\n`,
      { flag: 'wx', mode: 0o600 });
  }
  return extensionsDir;
}

async function waitForRun(product, agentId, expectedState) {
  const deadline = Date.now() + 12_000;
  let detail;
  do {
    detail = await expectJson(product, 'GET', `/api/agents/${agentId}`, null, 200);
    if (detail.recentRuns?.[0]?.explain?.run_state === expectedState) return detail;
    await delay(100);
  } while (Date.now() < deadline);
  assert.fail(`Timed out waiting for ${expectedState}; latest=${JSON.stringify(
    detail?.recentRuns?.map(run => ({ id: run.id, status: run.status,
      runState: run.explain?.run_state })) || [])}`);
}

function setControlledRecoveryState(databasePath, trustedId, legacyId) {
  const database = new Database(databasePath, { fileMustExist: true });
  try {
    const repository = new AgentRepository(database);
    const trusted = repository.getAgent(trustedId);
    assert(trusted?.state?._last_run, 'automatic baseline must persist its last run');
    repository.updateAgentState(trustedId, {
      ...trusted.state,
      _last_run: new Date(Date.now() - 600_000).toISOString(),
    });
    const legacyDefinition = structuredClone(trusted.definition);
    legacyDefinition.id = legacyId;
    delete legacyDefinition.m3_extension;
    repository.createAgent({ id: legacyId, name: 'Untrusted scheduled control',
      definition: legacyDefinition, params: trusted.params,
      state: { _last_run: new Date(Date.now() - 600_000).toISOString() },
      enabled: true });
    repository.setSchedule(legacyId, {
      nextRun: new Date(Date.now() - 60_000).toISOString(), intervalMs: 300_000,
    });
    assert.equal(repository.getRunHistory(legacyId).length, 0);
  } finally {
    database.close();
  }
}

test('trusted scheduled M3 extension runs in the product, recovers and notifies', {
  timeout: 90_000,
}, async t => {
  const runtime = createOwnedJourneyRuntime(parentRuntime);
  const extensionsDir = createTestExtensionRoot(runtime);
  const provider = await startTripwireProvider();
  const productionAdminToken = randomBytes(32).toString('base64url');
  let product = null;
  t.after(async () => {
    try {
      if (product) await stopProduct(product);
    } finally {
      await provider.close();
    }
  });
  const launch = () => startProduct(runtime, provider.url, MODEL, {
    enableAgents: true, productionAdminToken, testAgentExtensionsDir: extensionsDir,
  });
  await assert.rejects(() => startProduct(runtime, provider.url, MODEL, {
    enableAgents: true, productionAdminToken,
    testAgentExtensionsDir: runtime.projects,
  }), /Product exited before ready/,
  'an extension directory outside the private test artifacts must be rejected');
  product = await launch();
  const unauthenticated = await fetch(`http://127.0.0.1:${product.port}/api/agent-extensions`, {
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(unauthenticated.status, 401);

  const listed = await expectJson(product, 'GET', '/api/agent-extensions', null, 200);
  assert(listed.extensions.some(item => item.id === EXTENSION_ID),
    'the product must discover the isolated trusted extension');
  assert(listed.extensions.some(item => item.id === 'project-health'),
    'the shipped manifest remains available and unchanged');
  const created = await expectJson(product, 'POST', '/api/projects', {
    name: `scheduled-worker-${randomBytes(4).toString('hex')}`,
    description: 'Owned scheduled Project Health journey',
  }, 201);
  const projectId = created.project?.id;
  assert(Number.isSafeInteger(projectId) && projectId > 0);
  assert(created.project.path.startsWith(runtime.projects + path.sep));
  const projectFile = path.join(created.project.path, 'scheduled-health-probe.js');
  writeFileSync(projectFile, 'export const scheduledProbe = true;\n', { mode: 0o600 });

  const instanceId = `scheduled-health-${randomBytes(4).toString('hex')}`;
  const preview = await expectJson(product, 'POST',
    `/api/agent-extensions/${EXTENSION_ID}/preview`, {
      instanceId, params: { project_id: projectId },
    }, 200);
  assert.equal(preview.validation.valid, true);
  assert.equal(preview.definition.schedule.type, 'interval');
  assert.equal(preview.definition.schedule.value, '5m');
  const installed = await expectJson(product, 'POST',
    `/api/agent-extensions/${EXTENSION_ID}/install`, {
      instanceId, projectId, enabled: false,
      expectedDefinitionDigest: preview.definitionDigest,
    }, 201);
  assert.equal(installed.enabled, false);
  await expectJson(product, 'POST', `/api/agent-extensions/instances/${instanceId}/enable`,
    null, 200);
  const scheduled = await expectJson(product, 'GET', '/api/scheduler/status', null, 200);
  const scheduledEntry = scheduled.scheduled.find(item => item.id === instanceId);
  assert(scheduled.running && scheduledEntry?.enabled && scheduledEntry?.nextRun,
    'trusted extension must have a real persisted next-run time');
  const beforeRestart = await expectJson(product, 'GET', `/api/agents/${instanceId}`, null, 200);
  assert.equal(beforeRestart.recentRuns.length, 0,
    'the first run must come from scheduler startup after the controlled restart');

  await stopProduct(product);
  product = null;
  product = await launch();
  const baselineDetail = await waitForRun(product, instanceId, 'INIT_BASELINE');
  const baseline = baselineDetail.recentRuns[0];
  assert.equal(baseline.explain.sources[0].evidence.projectId, projectId);
  assert.equal(baselineDetail.definition.m3_extension.definitionDigest,
    preview.definitionDigest);
  assert.equal(baselineDetail.notifications.length, 0);

  await stopProduct(product);
  product = null;
  const changedContent = 'export const scheduledProbe = false; // FIXME SCHEDULED_CHANGED_917\n';
  writeFileSync(projectFile, changedContent, { mode: 0o600 });
  const legacyId = `legacy-scheduled-${randomBytes(4).toString('hex')}`;
  setControlledRecoveryState(runtime.database, instanceId, legacyId);
  product = await launch();
  const changedDetail = await waitForRun(product, instanceId, 'SUCCESS_TRIGGERED');
  const changed = changedDetail.recentRuns[0];
  assert.equal(changed.explain.run_state, 'SUCCESS_TRIGGERED');
  assert.equal(changed.explain.sources[0].evidence.issueCount,
    baseline.explain.sources[0].evidence.issueCount + 1);
  assert.equal(changed.explain.triggers.length, 1);
  assert.equal(changed.explain.triggers[0].id, 'health_changed');
  assert.equal(changed.explain.triggers[0].condition_id, 'project_changed');
  assert.equal(changed.explain.triggers[0].fired, true);
  assert.equal(changedDetail.notifications.length, 1);
  const notification = changedDetail.notifications[0];
  assert.equal(notification.agent_id, instanceId);
  assert.equal(notification.run_id, changed.id);
  assert.equal(notification.data.projectId, String(projectId));
  assert.equal(notification.data.issueCount,
    String(changed.explain.sources[0].evidence.issueCount));
  assert.equal(notification.data.workspaceRevision,
    changed.explain.sources[0].evidence.workspaceRevision);
  const source = changed.explain.sources[0].evidence.provenance.find(item =>
    item.path === 'scheduled-health-probe.js');
  assert.equal(source?.contentDigest,
    `sha256:${createHash('sha256').update(changedContent).digest('hex')}`);
  assert(notification.body.includes('signálů')
    && notification.body.includes(changed.explain.sources[0].evidence.workspaceRevision));
  const feed = await expectJson(product, 'GET',
    `/api/notifications?agent=${encodeURIComponent(instanceId)}`, null, 200);
  assert.deepEqual(feed.notifications.map(item => item.id), [notification.id]);
  const untrusted = await expectJson(product, 'GET', `/api/agents/${legacyId}`, null, 200);
  assert.equal(untrusted.recentRuns.length, 0,
    'an overdue row without M3 extension authority must never run');
  const status = await expectJson(product, 'GET', '/api/scheduler/status', null, 200);
  assert(!status.scheduled.some(item => item.id === legacyId));
  assert.equal(provider.modelCalls, 0);

  await stopProduct(product);
  product = null;
  product = await launch();
  const recovered = await expectJson(product, 'GET', `/api/agents/${instanceId}`, null, 200);
  assert.equal(recovered.notifications.length, 1);
  assert.equal(recovered.recentRuns.length, 2);
  assert.equal(recovered.recentRuns[0].id, changed.id);
  const recoveredStatus = await expectJson(product, 'GET', '/api/scheduler/status', null, 200);
  const recoveredSchedule = recoveredStatus.scheduled.find(item => item.id === instanceId);
  assert(Date.parse(recoveredSchedule?.nextRun) > Date.now(),
    'restart must preserve a future next-run time after the completed effect');
  assert.equal((await expectJson(product, 'GET', `/api/agents/${legacyId}`, null, 200))
    .recentRuns.length, 0);
  assert.equal(provider.modelCalls, 0);

  writeFileSync(path.join(parentRuntime.artifacts, 'm3-agent-scheduled-product-journey.json'),
    `${JSON.stringify({ schemaVersion: 1, status: 'PASS',
      sourceRevision: process.env.INTENTSMITH_TEST_SOURCE_REVISION || null,
      instanceId, projectId, baselineRunId: baseline.id, changedRunId: changed.id,
      notificationId: notification.id,
      scheduledNextRun: scheduledEntry.nextRun,
      controlledElapsedMinutes: 10,
      untrustedRunCount: 0, providerModelCalls: provider.modelCalls,
      productionAuthRejected: true, productRestarts: 3,
    }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
});
