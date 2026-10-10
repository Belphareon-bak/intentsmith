#!/usr/bin/env node

// Wall-clock acceptance probe for one trusted scheduled Project Health worker.
// The product, SQLite, project, extension and provider are all test-owned.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

import {
  createOwnedJourneyRuntime, expectJson, startProduct, stopProduct,
} from './helpers/chat-project-expertise-model-journey.js';
import { isolatedTestRuntime as parentRuntime } from './helpers/isolated-test-db.js';

const MODEL = 'fixture:1b';
const DIGEST = 'a'.repeat(64);
const EXTENSION_ID = 'real-scheduled-project-health';
const INTERVAL_MS = 300_000;
const POLL_MS = 2_000;
const DUE_GRACE_MS = 45_000;

async function startTripwireProvider() {
  let modelCalls = 0;
  let unexpectedCalls = 0;
  const unexpectedRequests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    let body = null;
    try {
      if (chunks.length > 0) body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { /* malformed requests are unexpected */ }
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET' && request.url === '/api/tags') {
      response.end(JSON.stringify({ models: [{ name: MODEL, digest: DIGEST }] }));
    } else if (request.method === 'POST' && request.url === '/api/show'
      && (body?.name === MODEL || body?.model === MODEL)) {
      response.end(JSON.stringify({ model_info: { 'fixture.context_length': 4096 } }));
    } else {
      unexpectedCalls++;
      unexpectedRequests.push({ method: request.method, path: request.url });
      if (request.url === '/api/chat' || request.url === '/api/generate') modelCalls++;
      response.writeHead(503).end(JSON.stringify({ error: 'Unexpected provider request' }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address !== 'string' && address.address === '127.0.0.1');
  return {
    url: 'http://127.0.0.1:' + address.port,
    get modelCalls() { return modelCalls; },
    get unexpectedCalls() { return unexpectedCalls; },
    get unexpectedRequests() { return [...unexpectedRequests]; },
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

test('tripwire counts and rejects all unexpected provider requests', {
  timeout: 5_000,
}, async () => {
  const provider = await startTripwireProvider();
  try {
    const requests = [
      { method: 'POST', path: '/api/tags', body: '{}' },
      { method: 'GET', path: '/api/show' },
      { method: 'GET', path: '/unexpected' },
      { method: 'POST', path: '/api/chat', body: '{}' },
    ];
    for (const item of requests) {
      const response = await fetch(provider.url + item.path, {
        method: item.method,
        ...(item.body ? { headers: { 'content-type': 'application/json' },
          body: item.body } : {}),
      });
      assert.equal(response.status, 503);
    }
    assert.equal(provider.unexpectedCalls, requests.length);
    assert.equal(provider.modelCalls, 1);
    assert.deepEqual(provider.unexpectedRequests,
      requests.map(item => ({ method: item.method, path: item.path })));
  } finally {
    await provider.close();
  }
});

function createTestExtensionRoot(runtime) {
  const root = path.join(runtime.artifacts, 'agent-extensions');
  const shipped = JSON.parse(readFileSync(
    new URL('../agent-extensions/project-health/agent.json', import.meta.url), 'utf8'));
  const scheduled = structuredClone(shipped);
  scheduled.id = EXTENSION_ID;
  scheduled.payload.definition.id = EXTENSION_ID;
  scheduled.payload.definition.name = 'Wall-clock Project Health fixture';
  scheduled.payload.definition.schedule = { type: 'interval', value: '5m' };
  const directory = path.join(root, EXTENSION_ID);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(directory, 'agent.json'), JSON.stringify(scheduled) + '\n',
    { flag: 'wx', mode: 0o600 });
  return root;
}

async function waitForBaseline(product, agentId) {
  const deadline = performance.now() + 45_000;
  let detail;
  do {
    detail = await expectJson(product, 'GET', '/api/agents/' + agentId, null, 200);
    assert.equal(product.code, null, 'owned product exited during baseline');
    assert.equal(product.signal, null, 'owned product signalled during baseline');
    assert(detail.recentRuns.length <= 1, 'worker ran more than once before baseline');
    const first = detail.recentRuns[0];
    if (first && first.status !== 'running') {
      assert.equal(first.explain?.run_state, 'INIT_BASELINE',
        'first scheduled run must establish Project Health baseline');
      return detail;
    }
    await delay(250);
  } while (performance.now() < deadline);
  assert.fail('Timed out waiting for automatic baseline: ' +
    JSON.stringify(detail?.recentRuns || []));
}

async function waitForNextRun(product, agentId) {
  const deadline = performance.now() + 5_000;
  do {
    const status = await expectJson(product, 'GET', '/api/scheduler/status', null, 200);
    const entry = status.scheduled.find(item => item.id === agentId);
    if (status.running && entry?.enabled && entry?.lastRun
      && Date.parse(entry.nextRun) > Date.now()) return entry;
    await delay(100);
  } while (performance.now() < deadline);
  assert.fail('Scheduler did not persist a future next_run after baseline');
}

function sqliteUtc(raw) {
  return Date.parse(String(raw).replace(' ', 'T') + 'Z');
}

function assertCleanSourceRevision() {
  const cwd = parentRuntime.repositoryRoot;
  const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd, encoding: 'utf8',
  }).trim();
  const dirt = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd, encoding: 'utf8',
  }).trim();
  assert.equal(dirt, '', 'wall-clock soak requires a clean committed source');
  if (process.env.INTENTSMITH_TEST_SOURCE_REVISION) {
    assert.equal(process.env.INTENTSMITH_TEST_SOURCE_REVISION, sourceRevision,
      'audit runner source revision must equal the actual clean HEAD');
  }
  return sourceRevision;
}

async function stopOwnedProduct(product) {
  await stopProduct(product);
  assert.equal(product.signal, null,
    'owned product exited by signal before or during clean shutdown');
  assert.equal(product.code, 0,
    'owned product exited nonzero before or during clean shutdown');
}

test('soak cleanup rejects an owned product that already exited badly', async () => {
  await assert.rejects(
    stopOwnedProduct({ child: {}, code: 1, signal: null }),
    /owned product exited nonzero/);
  await assert.rejects(
    stopOwnedProduct({ child: {}, code: null, signal: 'SIGTERM' }),
    /owned product exited by signal/);
});

test('trusted worker waits for a real five-minute due time and notifies once', {
  timeout: 450_000,
}, async t => {
  const sourceRevision = assertCleanSourceRevision();
  const runtime = createOwnedJourneyRuntime(parentRuntime);
  const extensionsDir = createTestExtensionRoot(runtime);
  const provider = await startTripwireProvider();
  let product = null;
  let successfulEvidence = null;
  t.after(async () => {
    try {
      if (product) await stopOwnedProduct(product);
    } finally {
      await provider.close();
    }
    assert.equal(provider.modelCalls, 0, 'owned product attempted model inference');
    assert.equal(provider.unexpectedCalls, 0,
      'owned product attempted an unexpected provider endpoint or method: '
      + JSON.stringify(provider.unexpectedRequests));
    assert.equal(assertCleanSourceRevision(), sourceRevision,
      'source revision changed before clean evidence finalization');
    if (successfulEvidence) {
      writeFileSync(path.join(parentRuntime.artifacts, 'm3-agent-real-scheduled-soak.json'),
        JSON.stringify({ ...successfulEvidence, status: 'PASS',
          providerModelCalls: provider.modelCalls,
          providerUnexpectedCalls: provider.unexpectedCalls,
          ownedProductCleanlyStopped: true, providerCleanlyStopped: true }, null, 2) + '\n',
        { flag: 'wx', mode: 0o600 });
    }
  });
  const launch = () => startProduct(runtime, provider.url, MODEL, {
    enableAgents: true, testAgentExtensionsDir: extensionsDir,
  });

  product = await launch();
  const initialProductPid = product.child.pid;
  const created = await expectJson(product, 'POST', '/api/projects', {
    name: 'real-worker-soak-' + randomBytes(4).toString('hex'),
  }, 201);
  const projectId = created.project?.id;
  assert(Number.isSafeInteger(projectId) && projectId > 0);
  assert(created.project.path.startsWith(runtime.projects + path.sep));
  const fileName = 'real-scheduled-health-probe.js';
  const projectFile = path.join(created.project.path, fileName);
  writeFileSync(projectFile, 'export const health = true;\n', { mode: 0o600 });

  const instanceId = 'real-scheduled-health-' + randomBytes(4).toString('hex');
  const preview = await expectJson(product, 'POST',
    '/api/agent-extensions/' + EXTENSION_ID + '/preview', {
      instanceId, params: { project_id: projectId },
    }, 200);
  assert.equal(preview.validation.valid, true);
  assert.equal(preview.definition.schedule.type, 'interval');
  assert.equal(preview.definition.schedule.value, '5m');
  const installed = await expectJson(product, 'POST',
    '/api/agent-extensions/' + EXTENSION_ID + '/install', {
      instanceId, projectId, enabled: false,
      expectedDefinitionDigest: preview.definitionDigest,
    }, 201);
  assert.equal(installed.enabled, false);
  await expectJson(product, 'POST',
    '/api/agent-extensions/instances/' + instanceId + '/enable', null, 200);

  const baselineDetail = await waitForBaseline(product, instanceId);
  const baseline = baselineDetail.recentRuns[0];
  assert.equal(baselineDetail.notifications.length, 0);
  assert.equal(baseline.explain.sources[0].evidence.projectId, projectId);
  const scheduled = await waitForNextRun(product, instanceId);
  const dueEpochMs = Date.parse(scheduled.nextRun);
  const lastRunEpochMs = sqliteUtc(scheduled.lastRun);
  const baselineStartedEpochMs = sqliteUtc(baseline.started_at);
  assert(Number.isFinite(dueEpochMs) && Number.isFinite(lastRunEpochMs)
    && Number.isFinite(baselineStartedEpochMs));
  assert(Math.abs(dueEpochMs - baselineStartedEpochMs - INTERVAL_MS) < 2_000,
  'persisted next_run must be exactly five minutes after actual baseline start');
  assert(lastRunEpochMs >= baselineStartedEpochMs
    && lastRunEpochMs < dueEpochMs,
  'persisted last_run must follow baseline start and precede next_run');
  assert(dueEpochMs - Date.now() > INTERVAL_MS - 20_000,
    'baseline observation must leave almost a full real interval');

  const instanceRoute = '/api/agent-extensions/instances/' + instanceId;
  const configuration = await expectJson(product, 'GET', instanceRoute + '/config', null, 200);
  const renamed = await expectJson(product, 'PUT', instanceRoute, {
    params: configuration.params, name: 'Renamed scheduled Project Health',
    expectedDefinitionDigest: configuration.definition.m3_extension.definitionDigest,
    expectedConfigDigest: configuration.configDigest,
  }, 200);
  assert.deepEqual(renamed.state, configuration.state,
    'renaming a scheduled worker must retain its baseline and last run');
  const afterRename = await waitForNextRun(product, instanceId);
  assert.equal(afterRename.nextRun, scheduled.nextRun,
    'renaming must preserve the existing due time');
  assert.equal(afterRename.lastRun, scheduled.lastRun);

  const changedContent =
    'export const health = false; // FIXME REAL_SCHEDULED_REVISION_402\n';
  writeFileSync(projectFile, changedContent, { mode: 0o600 });
  const changeEpochMs = Date.now();
  const changeMonotonicMs = performance.now();
  const dueMonotonicMs = changeMonotonicMs + (dueEpochMs - changeEpochMs);
  let beforeDuePolls = 0;
  let firstChangedObservedEpochMs = null;
  let firstChangedObservedMonotonicMs = null;
  let notificationObservedMonotonicMs = null;
  let changedDetail = null;
  while (performance.now() < dueMonotonicMs + DUE_GRACE_MS) {
    assert.equal(product.code, null, 'owned product exited during real interval');
    assert.equal(product.signal, null, 'owned product signalled during real interval');
    const detail = await expectJson(product, 'GET', '/api/agents/' + instanceId, null, 200);
    const observedAt = Date.now();
    const clockDriftMs = Math.abs(
      (observedAt - dueEpochMs) - (performance.now() - dueMonotonicMs));
    assert(clockDriftMs < 2_000, 'wall clock moved during real-time scheduler test');
    assert(detail.recentRuns.length <= 2,
      'more than one scheduled run appeared during the first interval');
    if (observedAt < dueEpochMs - 1_000) {
      beforeDuePolls++;
      assert.equal(detail.recentRuns.length, 1, 'worker ran before persisted next_run');
      assert.equal(detail.notifications.length, 0, 'notification arrived before due time');
    }
    if (detail.recentRuns.length === 2) {
      const changed = detail.recentRuns[0];
      if (firstChangedObservedEpochMs === null) {
        firstChangedObservedEpochMs = observedAt;
        firstChangedObservedMonotonicMs = performance.now();
      }
      const startedAtMs = sqliteUtc(changed.started_at);
      assert(Number.isFinite(startedAtMs));
      assert(startedAtMs >= dueEpochMs - 1_000,
        'durable run started before persisted next_run');
      if (changed.status !== 'running' && detail.notifications.length === 1) {
        changedDetail = detail;
        notificationObservedMonotonicMs = performance.now();
        break;
      }
    }
    await delay(POLL_MS);
  }
  assert(changedDetail, 'one due run and notification must appear within one 30s tick plus grace');
  assert(beforeDuePolls >= 100, 'the test must observe most of the real five-minute interval');
  const changed = changedDetail.recentRuns[0];
  assert.equal(changed.status, 'success');
  assert.equal(changed.explain?.run_state, 'SUCCESS_TRIGGERED');
  assert.equal(changed.explain.triggers.length, 1);
  assert.equal(changed.explain.triggers[0].id, 'health_changed');
  const evidence = changed.explain.sources[0].evidence;
  assert.equal(evidence.projectId, projectId);
  assert.notEqual(evidence.workspaceRevision,
    baseline.explain.sources[0].evidence.workspaceRevision);
  assert.match(evidence.workspaceRevision, /^wsr1:[a-f0-9]{64}$/);
  const source = evidence.provenance.find(item => item.path === fileName);
  assert.equal(source?.contentDigest,
    'sha256:' + createHash('sha256').update(changedContent).digest('hex'));
  const notification = changedDetail.notifications[0];
  assert.equal(notification.agent_id, instanceId);
  assert.equal(notification.run_id, changed.id);
  assert.equal(notification.data.projectId, String(projectId));
  assert.equal(notification.data.workspaceRevision, evidence.workspaceRevision);
  assert.equal(notification.data.snapshotDigest, evidence.snapshotDigest);
  const feed = await expectJson(product, 'GET',
    '/api/notifications?agent=' + encodeURIComponent(instanceId), null, 200);
  assert.deepEqual(feed.notifications.map(item => item.id), [notification.id]);
  const afterDue = await waitForNextRun(product, instanceId);
  assert(Date.parse(afterDue.nextRun) > Date.now(),
    'completed scheduled run must leave a future next_run');
  assert.equal(provider.modelCalls, 0);
  assert.equal(provider.unexpectedCalls, 0);

  const manual = await expectJson(product, 'POST',
    '/api/agent-extensions/instances/' + instanceId + '/run', null, 200);
  assert.equal(manual.run_state, 'SUCCESS_NO_TRIGGER',
    'unchanged project must not repeat the notification');
  assert.deepEqual(manual.triggered, []);
  assert.equal((await expectJson(product, 'GET',
    '/api/agents/' + instanceId, null, 200)).notifications.length, 1);

  await stopOwnedProduct(product);
  product = null;
  product = await launch();
  const recovered = await expectJson(product, 'GET',
    '/api/agents/' + instanceId, null, 200);
  assert.equal(recovered.recentRuns.length, 3,
    'restart must preserve exactly baseline, due trigger and manual unchanged runs');
  assert.deepEqual(new Set(recovered.recentRuns.map(run => run.id)),
    new Set([baseline.id, changed.id, manual.runId]),
    'restart must neither lose nor add a worker run');
  assert.equal(recovered.recentRuns.find(run => run.id === baseline.id)
    ?.explain?.run_state, 'INIT_BASELINE');
  assert.equal(recovered.recentRuns.find(run => run.id === manual.runId)
    ?.explain?.run_state, 'SUCCESS_NO_TRIGGER');
  assert.equal(recovered.notifications.length, 1);
  assert.equal(recovered.notifications[0].id, notification.id);
  assert(recovered.recentRuns.some(run => run.id === changed.id
    && run.explain?.run_state === 'SUCCESS_TRIGGERED'));
  const recoveredSchedule = await expectJson(product, 'GET',
    '/api/scheduler/status', null, 200);
  const recoveredEntry = recoveredSchedule.scheduled.find(item => item.id === instanceId);
  assert(recoveredSchedule.running && recoveredEntry?.enabled
    && Date.parse(recoveredEntry.nextRun) > Date.now(),
  'restart must preserve an enabled worker with a future persisted next_run');
  assert.equal(provider.modelCalls, 0);
  assert.equal(provider.unexpectedCalls, 0);

  assert.equal(assertCleanSourceRevision(), sourceRevision,
    'source revision changed during the wall-clock soak');
  successfulEvidence = {
      schemaVersion: 1, sourceRevision, executionMode: 'test',
      presentationEditPreservedState: true, presentationEditPreservedSchedule: true,
      intervalMs: INTERVAL_MS, projectId, instanceId, initialProductPid,
      restartedProductPid: product.child.pid,
      baselineRunId: baseline.id, changedRunId: changed.id,
      manualUnchangedRunId: manual.runId, notificationId: notification.id,
      finalRunIds: recovered.recentRuns.map(run => run.id),
      baselineLastRun: scheduled.lastRun, persistedDueAt: scheduled.nextRun,
      persistedNextRunAfterRestart: recoveredEntry.nextRun,
      changedStartedAt: changed.started_at, changedFirstObservedAt:
        new Date(firstChangedObservedEpochMs).toISOString(),
      changeAt: new Date(changeEpochMs).toISOString(),
      monotonicElapsedToDueMs: dueMonotonicMs - changeMonotonicMs,
      monotonicElapsedToFirstRunMs:
        firstChangedObservedMonotonicMs - changeMonotonicMs,
      monotonicElapsedToNotificationMs:
        notificationObservedMonotonicMs - changeMonotonicMs,
      beforeDuePolls, workspaceRevision: evidence.workspaceRevision,
      changedSourceDigest: source.contentDigest, providerModelCalls: provider.modelCalls,
      providerUnexpectedCalls: provider.unexpectedCalls,
      productRestarted: true, finalNotificationCount: recovered.notifications.length,
    };
});
