#!/usr/bin/env node

// The product child is stopped at the exact gap between the committed in-app
// notification and the run terminal. A new child must expose the interrupted
// run truthfully and must not create a second notification for that revision.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

import { AgentRepository, initAgentTables } from '../src/agents/repository.js';
import { createOwnedJourneyRuntime, expectJson, startProduct, stopProduct } from
  './helpers/chat-project-expertise-model-journey.js';
import { isolatedTestRuntime as parentRuntime } from './helpers/isolated-test-db.js';

const MODEL = 'fixture:1b';
const EXTENSION_ID = 'scheduled-project-health-crash';
const PRELOAD = fileURLToPath(new URL('./helpers/m3-notification-crash-preload.js', import.meta.url));

async function startTripwireProvider() {
  let modelCalls = 0;
  const server = http.createServer(async (request, response) => {
    for await (const _chunk of request) { /* drain */ }
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') {
      response.end(JSON.stringify({ models: [{ name: MODEL, digest: 'a'.repeat(64) }] }));
    } else if (request.url === '/api/show') {
      response.end(JSON.stringify({ model_info: { 'fixture.context_length': 4096 } }));
    } else {
      modelCalls++;
      response.writeHead(503).end(JSON.stringify({ error: 'Worker must not call a model' }));
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

function createScheduledExtension(runtime) {
  const root = path.join(runtime.artifacts, 'agent-extensions');
  const shipped = JSON.parse(readFileSync(
    new URL('../agent-extensions/project-health/agent.json', import.meta.url), 'utf8'));
  const scheduled = structuredClone(shipped);
  scheduled.id = EXTENSION_ID;
  scheduled.payload.definition.id = EXTENSION_ID;
  scheduled.payload.definition.name = 'Scheduled crash recovery fixture';
  scheduled.payload.definition.schedule = { type: 'interval', value: '5m' };
  for (const manifest of [shipped, scheduled]) {
    const directory = path.join(root, manifest.id);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(directory, 'agent.json'), `${JSON.stringify(manifest)}\n`,
      { flag: 'wx', mode: 0o600 });
  }
  return root;
}

async function waitForDetail(product, agentId, predicate, label) {
  const deadline = Date.now() + 15_000;
  let detail;
  do {
    detail = await expectJson(product, 'GET', `/api/agents/${agentId}`, null, 200);
    if (predicate(detail)) return detail;
    await delay(75);
  } while (Date.now() < deadline);
  assert.fail(`Timed out waiting for ${label}; latest=${JSON.stringify(detail?.recentRuns?.map(
    run => ({ id: run.id, status: run.status, state: run.explain?.run_state })) || [])}`);
}

async function waitForMarker(marker) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (existsSync(marker)) return JSON.parse(readFileSync(marker, 'utf8'));
    await delay(25);
  }
  assert.fail('No notification persistence barrier reached');
}

function readCrashState(databasePath, agentId) {
  const db = new Database(databasePath, { fileMustExist: true, readonly: true });
  try {
    return {
      runs: db.prepare('SELECT id, status, finished_at, error, explain FROM agent_runs_v33 WHERE agent_id = ? ORDER BY id').all(agentId),
      notifications: db.prepare('SELECT id, run_id, data FROM agent_notifications_v33 WHERE agent_id = ? ORDER BY id').all(agentId),
    };
  } finally {
    db.close();
  }
}

test('legacy M3 schema upgrades without terminalizing a live or unowned run', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE agents_v33 (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, icon TEXT,
        definition TEXT NOT NULL, state TEXT DEFAULT '{}', params TEXT DEFAULT '{}',
        enabled INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE agent_runs_v33 (
        id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT NOT NULL,
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP, finished_at DATETIME,
        status TEXT DEFAULT 'running', triggers_fired TEXT DEFAULT '[]',
        actions_executed INTEGER DEFAULT 0, explain TEXT, log TEXT, error TEXT
      );
      CREATE TABLE agent_notifications_v33 (
        id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT NOT NULL,
        run_id INTEGER, title TEXT NOT NULL, body TEXT, priority TEXT DEFAULT 'normal',
        data TEXT, read_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    initAgentTables(db);
    initAgentTables(db);
    const repository = new AgentRepository(db);
    repository.createAgent({ id: 'recovery-agent', name: 'Recovery', definition: {} });
    const legacy = db.prepare(`
      INSERT INTO agent_runs_v33 (agent_id, status) VALUES ('recovery-agent', 'running')
    `).run().lastInsertRowid;
    const live = repository.createRun('recovery-agent');
    assert.equal(repository.recoverInterruptedRuns(), 0,
      'a stopped or concurrent live owner must not be misclassified as dead');
    assert.equal(repository.getRunHistory('recovery-agent').find(run => run.id === live).status,
      'running');
    db.prepare('UPDATE agent_runs_v33 SET owner_started_at = ? WHERE id = ?').run('0', live);
    assert.equal(repository.recoverInterruptedRuns(), 1,
      'a reused PID with a different birth time cannot own the old run');
    const history = repository.getRunHistory('recovery-agent');
    assert.equal(history.find(run => run.id === live).status, 'interrupted');
    assert.equal(history.find(run => run.id === legacy).status, 'running',
      'old unowned history must remain explicitly unproven');

    const same = { title: 'Project Health', body: 'Revision A',
      data: { workspaceRevision: 'wsr1:a' }, effectKey: 'a'.repeat(64) };
    const first = repository.createNotification('recovery-agent', live, same);
    assert.equal(repository.createNotification('recovery-agent', legacy, same), first);
    const different = repository.createNotification('recovery-agent', legacy,
      { ...same, data: { workspaceRevision: 'wsr1:b' }, effectKey: 'b'.repeat(64) });
    assert.notEqual(first, different, 'a later revision must remain visible');
    assert.equal(repository.getNotifications({ agentId: 'recovery-agent' }).length, 2);
  } finally {
    db.close();
  }
});

test('product recovers a worker killed after persisted notification without duplicate', {
  timeout: 90_000,
}, async t => {
  const runtime = createOwnedJourneyRuntime(parentRuntime);
  const extensionsDir = createScheduledExtension(runtime);
  const provider = await startTripwireProvider();
  let product = null;
  t.after(async () => {
    try {
      if (product) {
        // The assertion may fail while this owned child is SIGSTOPed.
        if (product.signal === null && product.code === null) product.child.kill('SIGCONT');
        await stopProduct(product);
      }
    } finally {
      await provider.close();
    }
  });
  const launch = (testPreload = null) => startProduct(runtime, provider.url, MODEL, {
    enableAgents: true, testAgentExtensionsDir: extensionsDir, testPreload,
  });

  product = await launch();
  const created = await expectJson(product, 'POST', '/api/projects', {
    name: `worker-crash-${randomBytes(4).toString('hex')}`,
  }, 201);
  const projectId = created.project.id;
  const projectFile = path.join(created.project.path, 'crash-probe.js');
  writeFileSync(projectFile, 'export const crashProbe = true;\n', { mode: 0o600 });
  const agentId = `worker-crash-${randomBytes(4).toString('hex')}`;
  const preview = await expectJson(product, 'POST',
    `/api/agent-extensions/${EXTENSION_ID}/preview`, {
      instanceId: agentId, params: { project_id: projectId },
    }, 200);
  assert.equal(preview.validation.valid, true);
  await expectJson(product, 'POST', `/api/agent-extensions/${EXTENSION_ID}/install`, {
    instanceId: agentId, projectId, enabled: false,
    expectedDefinitionDigest: preview.definitionDigest,
  }, 201);
  await expectJson(product, 'POST', `/api/agent-extensions/instances/${agentId}/enable`, null, 200);
  await stopProduct(product);
  product = null;

  product = await launch();
  const baseline = await waitForDetail(product, agentId,
    detail => detail.recentRuns?.[0]?.explain?.run_state === 'INIT_BASELINE', 'baseline');
  assert.equal(baseline.notifications.length, 0);
  await stopProduct(product);
  product = null;

  writeFileSync(projectFile,
    'export const crashProbe = false; // FIXME CRASH_REVISION_915\n', { mode: 0o600 });
  const db = new Database(runtime.database, { fileMustExist: true });
  try {
    const repository = new AgentRepository(db);
    const agent = repository.getAgent(agentId);
    assert(agent.state._last_run);
    repository.updateAgentState(agentId, {
      ...agent.state, _last_run: new Date(Date.now() - 600_000).toISOString(),
    });
  } finally {
    db.close();
  }

  product = await launch(PRELOAD);
  const markerPath = path.join(runtime.artifacts, 'm3-notification-persisted.json');
  const barrier = await waitForMarker(markerPath);
  assert.equal(barrier.agentId, agentId);
  assert.equal(barrier.pid, product.child.pid);
  const liveDb = new Database(runtime.database, { fileMustExist: true });
  try {
    const liveRepository = new AgentRepository(liveDb);
    assert.equal(liveRepository.recoverInterruptedRuns(), 0,
      'another process must not terminalize the stopped but living product child');
  } finally {
    liveDb.close();
  }
  assert.equal(product.child.kill('SIGKILL'), true);
  const killDeadline = Date.now() + 5000;
  while (product.signal === null && Date.now() < killDeadline) await delay(20);
  assert.equal(product.signal, 'SIGKILL', product.output);
  product = null;

  const afterKill = readCrashState(runtime.database, agentId);
  assert.equal(afterKill.runs.length, 2);
  assert.equal(afterKill.runs[1].id, barrier.runId);
  assert.equal(afterKill.runs[1].status, 'running');
  assert.equal(afterKill.runs[1].finished_at, null);
  assert.equal(afterKill.notifications.length, 1);
  assert.equal(afterKill.notifications[0].id, barrier.notificationId);
  assert.equal(afterKill.notifications[0].run_id, barrier.runId);
  const persistedRevision = JSON.parse(afterKill.notifications[0].data).workspaceRevision;
  assert.match(persistedRevision, /^wsr1:[0-9a-f]{64}$/);

  product = await launch();
  const recovered = await waitForDetail(product, agentId,
    detail => detail.recentRuns?.length >= 3 && detail.recentRuns[0]?.status !== 'running',
    'recovery replay');
  const afterRecovery = readCrashState(runtime.database, agentId);
  writeFileSync(path.join(parentRuntime.artifacts, 'm3-agent-crash-recovery-diagnostic.json'),
    `${JSON.stringify({ schemaVersion: 1,
      sourceRevision: process.env.INTENTSMITH_TEST_SOURCE_REVISION || null,
      barrier, afterKill, afterRecovery, modelCalls: provider.modelCalls,
    }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });

  const crashed = afterRecovery.runs.find(run => run.id === barrier.runId);
  assert.equal(crashed?.status, 'interrupted', 'killed run must become an explicit terminal');
  assert.equal(crashed?.finished_at !== null, true);
  assert.equal(JSON.parse(crashed.explain || '{}').run_state, 'ERROR_INTERRUPTED');
  assert.equal(afterRecovery.runs.at(-1).status, 'success');
  assert.equal(JSON.parse(afterRecovery.runs.at(-1).explain).run_state, 'SUCCESS_TRIGGERED');
  assert.equal(afterRecovery.notifications.length, 1,
    'restart must not send a second notification for the same project revision');
  assert.equal(afterRecovery.notifications[0].id, barrier.notificationId);
  assert.equal(JSON.parse(afterRecovery.notifications[0].data).workspaceRevision,
    persistedRevision);
  assert.equal(recovered.notifications.length, 1);
  assert.equal(provider.modelCalls, 0);
});
