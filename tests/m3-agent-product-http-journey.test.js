#!/usr/bin/env node

// Exercise the shipped Project Health extension through the actual product
// server, including authentication, an actual project change, a durable in-app
// notification, a fail-closed ProjectContext read, and a process restart.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { renameSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { test } from 'node:test';

import { createOwnedJourneyRuntime, expectJson, startProduct, stopProduct } from
  './helpers/chat-project-expertise-model-journey.js';
import { isolatedTestRuntime as parentRuntime } from './helpers/isolated-test-db.js';

const MODEL = 'fixture:1b';
const DIGEST = 'a'.repeat(64);

async function startTripwireProvider() {
  let modelCalls = 0;
  const server = http.createServer(async (request, response) => {
    for await (const _chunk of request) { /* drain the small local request */ }
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') {
      response.end(JSON.stringify({ models: [{ name: MODEL, digest: DIGEST }] }));
    } else if (request.url === '/api/show') {
      response.end(JSON.stringify({ model_info: { 'fixture.context_length': 4096 } }));
    } else if (request.url === '/api/chat' || request.url === '/api/generate') {
      modelCalls++;
      response.writeHead(503).end(JSON.stringify({ error: 'Worker must not call a model' }));
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

test('Project Health runs through the product HTTP server and survives restart', {
  timeout: 180_000,
}, async t => {
  const runtime = createOwnedJourneyRuntime(parentRuntime);
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
  const launch = () => startProduct(runtime, provider.url, MODEL,
    { enableAgents: true, productionAdminToken });
  product = await launch();

  const unauthenticated = await fetch(`http://127.0.0.1:${product.port}/api/agent-extensions`, {
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(unauthenticated.status, 401,
    'agent extension inventory must reject a request without credentials');
  const unauthenticatedBody = await unauthenticated.json();
  assert.equal(unauthenticatedBody.code, 'INTENTSMITH_AUTH_REQUIRED');

  const extensionId = 'project-health';
  const instanceId = `health-product-${randomBytes(4).toString('hex')}`;
  const listed = await expectJson(product, 'GET', '/api/agent-extensions', null, 200);
  assert(listed.extensions.some(item => item.id === extensionId),
    'shipped Project Health extension must be discovered by the product');
  const created = await expectJson(product, 'POST', '/api/projects', {
    name: `worker-product-${randomBytes(4).toString('hex')}`,
    description: 'Isolated Project Health product journey',
  }, 201);
  const projectId = created.project?.id;
  assert(Number.isSafeInteger(projectId) && projectId > 0);
  assert(created.project.path.startsWith(runtime.projects + '/'));
  const projectFile = path.join(created.project.path, 'project-health-probe.js');
  writeFileSync(projectFile,
    'export const healthProbe = true; // PRODUCT_WORKER_SOURCE_714\n', { mode: 0o600 });

  const preview = await expectJson(product, 'POST',
    `/api/agent-extensions/${extensionId}/preview`, {
      instanceId, params: { project_id: projectId },
    }, 200);
  assert.equal(preview.validation.valid, true);
  const installed = await expectJson(product, 'POST',
    `/api/agent-extensions/${extensionId}/install`, {
      instanceId, projectId, enabled: false,
      expectedDefinitionDigest: preview.definitionDigest,
    }, 201);
  assert.equal(installed.enabled, false);
  const route = `/api/agent-extensions/instances/${instanceId}`;
  const disabled = await expectJson(product, 'POST', `${route}/run`, null, 200);
  assert.equal(disabled.run_state, 'SKIP_DISABLED');
  await expectJson(product, 'POST', `${route}/enable`, null, 200);
  const baseline = await expectJson(product, 'POST', `${route}/run`, null, 200);
  assert.equal(baseline.run_state, 'INIT_BASELINE');
  assert.equal(baseline.explain.sources[0].evidence.projectId, projectId);
  const baselineRevision = baseline.explain.sources[0].evidence.workspaceRevision;
  const unchanged = await expectJson(product, 'POST', `${route}/run`, null, 200);
  assert.equal(unchanged.run_state, 'SUCCESS_NO_TRIGGER');
  assert.deepEqual(unchanged.triggered, []);
  const scheduler = await expectJson(product, 'GET', '/api/scheduler/status', null, 200);
  assert.equal(scheduler.running, true);
  assert(scheduler.scheduled.some(agent => agent.id === instanceId && agent.enabled),
    'the product scheduler must own the enabled extension instance');

  const configuration = await expectJson(product, 'GET', `${route}/config`, null, 200);
  const renamed = await expectJson(product, 'PUT', route, {
    params: configuration.params, name: 'Renamed Project Health',
    description: 'Presentation changed; the monitored project is the same.',
    expectedDefinitionDigest: configuration.definition.m3_extension.definitionDigest,
    expectedConfigDigest: configuration.configDigest,
  }, 200);
  assert.deepEqual(renamed.state, configuration.state,
    'name and description edits must preserve the project baseline and trigger history');
  assert.equal(renamed.enabled, true);
  await expectJson(product, 'PUT', route, {
    params: configuration.params, name: 'Stale rename',
    expectedDefinitionDigest: configuration.definition.m3_extension.definitionDigest,
    expectedConfigDigest: configuration.configDigest,
  }, 409);

  const changedContent = 'export const healthProbe = false; // FIXME PRODUCT_WORKER_CHANGED_714\n';
  writeFileSync(projectFile, changedContent, { mode: 0o600 });
  const changed = await expectJson(product, 'POST', `${route}/run`, null, 200);
  assert.equal(changed.run_state, 'SUCCESS_TRIGGERED');
  assert.deepEqual(changed.triggered, ['health_changed']);
  assert(changed.actions.some(action => action.type === 'notify' && action.status === 'ok'));
  const evidence = changed.explain.sources[0].evidence;
  assert.equal(evidence.projectId, projectId);
  assert.notEqual(evidence.workspaceRevision, baselineRevision);
  assert.match(evidence.workspaceRevision, /^wsr1:[a-f0-9]{64}$/);
  assert.equal(evidence.issueCount,
    baseline.explain.sources[0].evidence.issueCount + 1,
    'the added FIXME must increase the project finding count by one');
  const source = evidence.provenance.find(item => item.path === 'project-health-probe.js');
  assert(source, 'the M2 ProjectContext snapshot must identify the changed file');
  assert.equal(source.contentDigest,
    `sha256:${createHash('sha256').update(changedContent).digest('hex')}`);

  const detail = await expectJson(product, 'GET', `/api/agents/${instanceId}`, null, 200);
  assert.equal(detail.notifications.length, 1);
  const notification = detail.notifications[0];
  assert.equal(notification.agent_id, instanceId);
  assert.equal(notification.run_id, changed.runId);
  assert.equal(notification.title, 'Project Health: attention');
  assert.equal(notification.data.projectId, String(projectId));
  assert.equal(notification.data.workspaceRevision, evidence.workspaceRevision);
  assert.equal(notification.data.snapshotDigest, evidence.snapshotDigest);
  assert.equal(notification.data.issueCount, String(evidence.issueCount));
  assert(notification.body.includes(`${evidence.issueCount} signálů v ${evidence.filesObserved} souborech`));
  assert(notification.body.includes(evidence.workspaceRevision));
  const feed = await expectJson(product, 'GET',
    `/api/notifications?agent=${encodeURIComponent(instanceId)}`, null, 200);
  assert.deepEqual(feed.notifications.map(item => item.id), [notification.id]);
  assert.equal(feed.unreadCount, 1);
  const otherAgentFeed = await expectJson(product, 'GET',
    `/api/notifications?agent=${encodeURIComponent(`${instanceId}-other`)}`, null, 200);
  assert.deepEqual(otherAgentFeed.notifications, [],
    'the product HTTP adapter must apply the agent filter, even with one notification');
  const repeated = await expectJson(product, 'POST', `${route}/run`, null, 200);
  assert.equal(repeated.run_state, 'SUCCESS_NO_TRIGGER');
  assert.deepEqual(repeated.triggered, []);
  assert.equal((await expectJson(product, 'GET', `/api/agents/${instanceId}`, null, 200))
    .notifications.length, 1);

  const unavailableProjectRoot = `${created.project.path}.unavailable`;
  renameSync(created.project.path, unavailableProjectRoot);
  let sourceFailure;
  try {
    sourceFailure = await expectJson(product, 'POST', `${route}/run`, null, 200);
  } finally {
    renameSync(unavailableProjectRoot, created.project.path);
  }
  assert.equal(sourceFailure.run_state, 'ERROR_SOURCE');
  assert.deepEqual(sourceFailure.sourceErrors.map(error => error.errorCode),
    ['M3_AGENT_PROJECT_CONTEXT_REQUIRED']);
  assert.equal((await expectJson(product, 'GET', `/api/agents/${instanceId}`, null, 200))
    .notifications.length, 1);
  assert.equal(provider.modelCalls, 0);

  await stopProduct(product);
  product = null;
  product = await launch();
  const restored = await expectJson(product, 'POST', `${route}/run`, null, 200);
  assert.equal(restored.run_state, 'SUCCESS_NO_TRIGGER',
    'agent state and trusted extension binding must survive product restart');
  assert.equal(restored.explain.sources[0].evidence.projectId, projectId);
  const durable = await expectJson(product, 'GET', `/api/agents/${instanceId}`, null, 200);
  assert.equal(durable.notifications.length, 1);
  assert.equal(durable.notifications[0].id, notification.id);
  assert(durable.recentRuns.some(run => run.id === changed.runId
    && run.explain?.run_state === 'SUCCESS_TRIGGERED'));
  assert(durable.recentRuns.some(run => run.id === sourceFailure.runId
    && run.status === 'error' && run.explain?.sources?.[0]?.errorCode
      === 'M3_AGENT_PROJECT_CONTEXT_REQUIRED'));
  assert.equal((await expectJson(product, 'GET',
    `/api/notifications?agent=${encodeURIComponent(instanceId)}`, null, 200))
    .notifications.length, 1);
  assert.equal(provider.modelCalls, 0);
  const restoredConfiguration = await expectJson(product, 'GET', `${route}/config`, null, 200);
  assert.equal(restoredConfiguration.name, renamed.name);
  assert.equal(restoredConfiguration.description, renamed.description);

  const otherProject = await expectJson(product, 'POST', '/api/projects', {
    name: `worker-retarget-${randomBytes(4).toString('hex')}`,
  }, 201);
  writeFileSync(path.join(otherProject.project.path, 'different.js'),
    'export const different = true; // FIXME RETARGETED_PROJECT\n', { mode: 0o600 });
  const retargeted = await expectJson(product, 'PUT', route, {
    params: { project_id: otherProject.project.id },
    expectedDefinitionDigest: restoredConfiguration.definition.m3_extension.definitionDigest,
    expectedConfigDigest: restoredConfiguration.configDigest,
  }, 200);
  assert.deepEqual(retargeted.state, {}, 'a changed source must discard the previous baseline');
  const newBaseline = await expectJson(product, 'POST', `${route}/run`, null, 200);
  assert.equal(newBaseline.run_state, 'INIT_BASELINE');
  assert.equal(newBaseline.explain.sources[0].evidence.projectId, otherProject.project.id);
  assert.equal((await expectJson(product, 'GET', `/api/agents/${instanceId}`, null, 200))
    .notifications.length, 1, 'retargeting must not invent a project-change notification');
  assert.equal(provider.modelCalls, 0);
  writeFileSync(path.join(parentRuntime.artifacts, 'm3-agent-product-http-journey.json'),
    `${JSON.stringify({ schemaVersion: 1, status: 'PASS',
      sourceRevision: process.env.INTENTSMITH_TEST_SOURCE_REVISION || null,
      projectId, instanceId, runs: [disabled.run_state, baseline.run_state,
        unchanged.run_state, changed.run_state, repeated.run_state,
        sourceFailure.run_state, restored.run_state],
      changedRunId: changed.runId, notificationId: notification.id,
      changedWorkspaceRevision: evidence.workspaceRevision,
      failClosedSourceCode: sourceFailure.sourceErrors[0].errorCode,
      providerModelCalls: provider.modelCalls, productRestarted: true,
      unauthenticatedRejected: true, localCapabilityAccepted: true,
      presentationEditPreservedState: true, renamedConfigurationPersisted: true,
      staleEditRejected: true, changedParametersResetBaseline: true,
    }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
});
