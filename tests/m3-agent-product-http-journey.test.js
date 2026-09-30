#!/usr/bin/env node

// Exercise the shipped Project Health extension through the actual product
// server, including its local capability gate and a process restart. The
// existing service-level journey covers change notifications and source errors.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
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
    if (product) await stopProduct(product);
    await provider.close();
  });
  const launch = () => startProduct(runtime, provider.url, MODEL,
    { enableAgents: true, productionAdminToken });
  product = await launch();

  const unauthenticated = await fetch(`http://127.0.0.1:${product.port}/api/agent-extensions`, {
    signal: AbortSignal.timeout(5_000),
  });
  assert(unauthenticated.status >= 400 && unauthenticated.status < 500,
    'agent extension inventory must require the product local capability');

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
  writeFileSync(path.join(created.project.path, 'project-health-probe.js'),
    'export const healthProbe = true; // TODO PRODUCT_WORKER_SOURCE_714\n', { mode: 0o600 });

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
  const unchanged = await expectJson(product, 'POST', `${route}/run`, null, 200);
  assert.equal(unchanged.run_state, 'SUCCESS_NO_TRIGGER');
  assert.deepEqual(unchanged.triggered, []);
  assert.equal(provider.modelCalls, 0);

  await stopProduct(product);
  product = null;
  product = await launch();
  const restored = await expectJson(product, 'POST', `${route}/run`, null, 200);
  assert.equal(restored.run_state, 'SUCCESS_NO_TRIGGER',
    'agent baseline and trusted extension binding must survive product restart');
  assert.equal(restored.explain.sources[0].evidence.projectId, projectId);
  assert.equal(provider.modelCalls, 0);
  writeFileSync(path.join(parentRuntime.artifacts, 'm3-agent-product-http-journey.json'),
    `${JSON.stringify({ schemaVersion: 1, status: 'PASS',
      sourceRevision: process.env.INTENTSMITH_TEST_SOURCE_REVISION || null,
      projectId, instanceId, runs: [disabled.run_state, baseline.run_state,
        unchanged.run_state, restored.run_state], providerModelCalls: provider.modelCalls,
      productRestarted: true, localCapabilityRequired: true,
    }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
});
