import './helpers/isolated-test-db.js';

import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import test from 'node:test';

import Database from 'better-sqlite3';

import {
  computeProjectContextSnapshotDigest,
  estimateProjectContextTokens,
  normalizeProjectContextQuery,
  validateProjectContextSnapshot,
} from '../contracts/m2/project-context-v1.js';
import { EXTENSION_HOST_CAPABILITY } from '../contracts/m3/extension-v1.js';
import { AgentRepository, initAgentTables } from '../src/agents/repository.js';
import { AgentRunner, RUN_STATE } from '../src/agents/runner.js';
import { AgentScheduler } from '../src/agents/scheduler.js';
import { AgentExtensionService } from '../src/extensions/agent-extension-service.js';
import { createAgentProjectContextBridge } from '../src/extensions/agent-project-context.js';
import { createAgentPlatformRoutes } from '../src/routes/agents.js';

const quietLogger = Object.freeze({ info() {}, warn() {}, error() {} });
const sha256 = value => createHash('sha256').update(value).digest('hex');
const revision = (projectId, content) => `wsr1:${sha256(`${projectId}:${content}`)}`;

function fakeClock(start = '2026-09-30T10:00:00.000Z') {
  let now = Date.parse(start);
  return Object.freeze({
    read: () => new Date(now),
    advance: milliseconds => { now += milliseconds; },
  });
}

function fakeProjectContextProvider(roots) {
  const calls = [];
  const failingProjects = new Set();
  return {
    calls,
    failingProjects,
    async observeWorkspaceRevision(scope) {
      const root = roots.get(scope.projectId);
      assert.equal(scope.canonicalRoot, root, 'provider receives only the registered canonical root');
      calls.push({ phase: 'observe', projectId: scope.projectId, root: scope.canonicalRoot });
      if (failingProjects.has(scope.projectId)) {
        throw Object.assign(new Error('controlled project-context outage'), { code: 'FAKE_PROVIDER_DOWN' });
      }
      const content = await readFile(path.join(root, 'index.js'), 'utf8');
      return {
        projectId: scope.projectId,
        canonicalRoot: root,
        workspaceRevision: revision(scope.projectId, content),
      };
    },
    async queryProjectContext(query) {
      const root = roots.get(query.projectId);
      assert.equal(query.canonicalRoot, root);
      assert.match(query.requestId, /^agctx:[0-9a-f]{64}$/);
      assert.equal(query.maxFiles, 12);
      assert.equal(query.maxBytes, 49_152);
      assert.equal(query.maxTokens, 12_288);
      const content = await readFile(path.join(root, 'index.js'), 'utf8');
      assert.equal(query.workspaceRevision, revision(query.projectId, content));
      calls.push({ phase: 'query', projectId: query.projectId, root, requestId: query.requestId });
      const contentDigest = `sha256:${sha256(content)}`;
      const normalized = normalizeProjectContextQuery(query.queryText);
      const usedBytes = Buffer.byteLength(content);
      const snapshot = {
        contract: 'ProjectContextSnapshot',
        version: 1,
        requestId: query.requestId,
        projectId: query.projectId,
        status: 'ok',
        outcome: 'found',
        workspaceRevision: query.workspaceRevision,
        normalizationVersion: 1,
        normalizedQuery: normalized.normalizedQuery,
        terms: normalized.terms,
        items: [{
          path: 'index.js',
          startLine: 1,
          endLine: content.trimEnd().split('\n').length,
          content,
          contentDigest,
          score: 1000,
          provenance: {
            sourceSet: 'ContextSourceSet@1',
            projectId: query.projectId,
            workspaceRevision: query.workspaceRevision,
            path: 'index.js',
            contentDigest,
          },
        }],
        budget: {
          maxFiles: query.maxFiles, maxBytes: query.maxBytes, maxTokens: query.maxTokens,
          usedFiles: 1, usedBytes, usedTokens: estimateProjectContextTokens(usedBytes),
        },
        truncation: { truncated: false },
        snapshotDigest: null,
      };
      snapshot.snapshotDigest = computeProjectContextSnapshotDigest(snapshot);
      const validation = validateProjectContextSnapshot(snapshot);
      assert.equal(validation.valid, true, validation.errors.join(', '));
      return snapshot;
    },
  };
}

function openRuntime(dbPath, roots, provider, clock) {
  const database = new Database(dbPath);
  database.pragma('foreign_keys = ON');
  database.exec(`CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
  )`);
  const insertProject = database.prepare(`
    INSERT OR IGNORE INTO projects (id, name, path, status) VALUES (?, ?, ?, 'active')
  `);
  for (const [id, root] of roots) insertProject.run(id, `Fixture ${id}`, root);
  initAgentTables(database);
  const repository = new AgentRepository(database);
  const projects = { findById: database.prepare('SELECT * FROM projects WHERE id = ?') };
  const bridge = createAgentProjectContextBridge({ provider, projects });
  const extensionService = new AgentExtensionService({
    repository,
    hostCapabilities: { [EXTENSION_HOST_CAPABILITY.PROJECT_CONTEXT]: bridge.capability },
  });
  extensionService.discover();
  const runner = new AgentRunner({
    repository, extensionService, projectContextBridge: bridge,
    clock: clock.read, logger: quietLogger,
  });
  const scheduler = new AgentScheduler({
    repository, runner, logger: quietLogger,
    executionAuthority: agent => {
      try { extensionService.resolveExecution(agent); return true; }
      catch { return false; }
    },
  });
  extensionService.attachScheduler(scheduler);
  return { database, repository, extensionService, scheduler };
}

async function startHttp(runtime) {
  const sendJSON = (res, status, value) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(value));
  };
  const parseBody = async req => {
    let body = '';
    for await (const chunk of req) body += chunk;
    return body ? JSON.parse(body) : {};
  };
  const routes = createAgentPlatformRoutes({
    sendJSON, parseBody, agentExtensionService: runtime.extensionService,
  });
  const allowedRoutes = Object.entries(routes).filter(([key]) =>
    key.startsWith('GET /api/agent-extensions')
    || key.startsWith('POST /api/agent-extensions'));
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    const requestParts = pathname.split('/');
    for (const [key, handler] of allowedRoutes) {
      const [method, route] = key.split(' ');
      const routeParts = route.split('/');
      if (method !== req.method || routeParts.length !== requestParts.length) continue;
      const params = {};
      const matches = routeParts.every((part, index) => {
        if (part.startsWith(':')) {
          params[part.slice(1)] = decodeURIComponent(requestParts[index]);
          return true;
        }
        return part === requestParts[index];
      });
      if (!matches) continue;
      try { await handler(req, res, params); }
      catch (error) { sendJSON(res, 500, { error: error.message }); }
      return;
    }
    sendJSON(res, 404, { error: 'route not found' });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    baseUrl,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

async function request(server, method, route, body, expectedStatus = 200) {
  const response = await fetch(`${server.baseUrl}${route}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(5_000),
  });
  const payload = await response.json();
  assert.equal(response.status, expectedStatus, `${method} ${route}: ${JSON.stringify(payload)}`);
  return payload;
}

test('native worker HTTP journey is durable, idempotent and project-bound', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'intentsmith-m3-worker-http-'));
  const projectA = path.join(root, 'project-a');
  const projectB = path.join(root, 'project-b');
  await Promise.all([mkdir(projectA), mkdir(projectB)]);
  const fileA = path.join(projectA, 'index.js');
  const fileB = path.join(projectB, 'index.js');
  await writeFile(fileA, 'export const a = true;\n');
  await writeFile(fileB, 'export const B_ONLY_CANARY = true;\n');
  const roots = new Map([[1, projectA], [2, projectB]]);
  const provider = fakeProjectContextProvider(roots);
  const clock = fakeClock();
  const dbPath = path.join(root, 'agents.sqlite');
  let runtime;
  let server;
  try {
    runtime = openRuntime(dbPath, roots, provider, clock);
    server = await startHttp(runtime);
    const extensionId = 'project-health';
    const agentA = 'health-project-a';
    const agentB = 'health-project-b';
    const run = agentId => request(server, 'POST', `/api/agent-extensions/instances/${agentId}/run`);
    const notifications = agentId => runtime.repository.getNotifications({ agentId });
    const runs = agentId => runtime.repository.getRunHistory(agentId);

    await t.test('HTTP discovery, preview, install and disabled run have no source effect', async () => {
      const listed = await request(server, 'GET', '/api/agent-extensions');
      assert(listed.extensions.some(extension => extension.id === extensionId));
      const preview = await request(server, 'POST', `/api/agent-extensions/${extensionId}/preview`, {
        instanceId: agentA, params: { project_id: 1 },
      });
      assert.equal(preview.validation.valid, true);
      const installed = await request(server, 'POST', `/api/agent-extensions/${extensionId}/install`, {
        instanceId: agentA, projectId: 1, enabled: false,
        expectedDefinitionDigest: preview.definitionDigest,
      }, 201);
      assert.equal(installed.enabled, false);
      assert.equal((await run(agentA)).run_state, RUN_STATE.SKIP_DISABLED);
      assert.equal(runs(agentA).length, 0);
      assert.equal(notifications(agentA).length, 0);
      assert.equal(provider.calls.length, 0);
    });

    await t.test('first enabled run establishes a durable baseline; unchanged runs are inert', async () => {
      await request(server, 'POST', `/api/agent-extensions/instances/${agentA}/enable`);
      const baseline = await run(agentA);
      assert.equal(baseline.run_state, RUN_STATE.INIT_BASELINE);
      assert.equal(baseline.explain.timestamp, clock.read().toISOString());
      assert.equal(runs(agentA).length, 1);
      assert.equal(notifications(agentA).length, 0);
      const unchanged = await run(agentA);
      assert.equal(unchanged.run_state, RUN_STATE.SUCCESS_NO_TRIGGER);
      assert.deepEqual(unchanged.triggered, []);
      assert.equal(runs(agentA).length, 2);
      assert.equal(notifications(agentA).length, 0);
      assert.equal(unchanged.explain.sources[0].evidence.projectId, 1);
    });

    await t.test('file change produces one project A notification with exact provenance', async () => {
      await writeFile(fileA, 'export const a = false;\n// FIXME A_ONLY_CANARY\n');
      clock.advance(61_000);
      const changed = await run(agentA);
      assert.equal(changed.run_state, RUN_STATE.SUCCESS_TRIGGERED);
      assert.deepEqual(changed.triggered, ['health_changed']);
      const evidence = changed.explain.sources[0].evidence;
      assert.equal(evidence.projectId, 1);
      assert.equal(evidence.workspaceRevision, revision(1, await readFile(fileA, 'utf8')));
      assert.equal(evidence.issueCount, 1);
      assert.equal(evidence.provenance[0].path, 'index.js');
      assert.match(evidence.provenance[0].contentDigest, /^sha256:[0-9a-f]{64}$/);
      assert.equal(notifications(agentA).length, 1);
      assert.equal(notifications(agentA)[0].run_id, changed.runId);
      assert.equal(notifications(agentA)[0].data.projectId, '1');
      assert.equal(notifications(agentA)[0].data.workspaceRevision, evidence.workspaceRevision);
      assert.doesNotMatch(notifications(agentA)[0].body, /B_ONLY_CANARY/);
      const repeat = await run(agentA);
      assert.equal(repeat.run_state, RUN_STATE.SUCCESS_NO_TRIGGER);
      assert.equal(notifications(agentA).length, 1);
    });

    await t.test('second installed project has independent baseline and notifications', async () => {
      await request(server, 'POST', `/api/agent-extensions/${extensionId}/install`, {
        instanceId: agentB, projectId: 2, enabled: true,
      }, 201);
      assert.equal((await run(agentB)).run_state, RUN_STATE.INIT_BASELINE);
      assert.equal(notifications(agentB).length, 0);
      await writeFile(fileB, 'export const B_ONLY_CANARY = false;\n// TODO B_ONLY_CANARY\n');
      clock.advance(61_000);
      const changedB = await run(agentB);
      assert.equal(changedB.run_state, RUN_STATE.SUCCESS_TRIGGERED);
      assert.equal(changedB.explain.sources[0].evidence.projectId, 2);
      assert.equal(notifications(agentB).length, 1);
      assert.equal(notifications(agentB)[0].data.projectId, '2');
      assert.equal(notifications(agentA).length, 1);
      assert.equal(runtime.repository.getAgent(agentA).params.project_id, 1);
      assert.equal(runtime.repository.getAgent(agentB).params.project_id, 2);
      assert(provider.calls.filter(call => call.phase === 'query' && call.projectId === 1)
        .every(call => call.root === projectA));
      assert(provider.calls.filter(call => call.phase === 'query' && call.projectId === 2)
        .every(call => call.root === projectB));
      const requests = provider.calls.filter(call => call.phase === 'query').map(call => call.requestId);
      assert.equal(new Set(requests).size, requests.length, 'every durable run has a distinct project query');
    });

    await t.test('process-style restart retains state; disable and source error terminate safely', async () => {
      await server.close();
      server = null;
      runtime.database.close();
      runtime = openRuntime(dbPath, roots, provider, clock);
      server = await startHttp(runtime);
      assert.equal((await run(agentA)).run_state, RUN_STATE.SUCCESS_NO_TRIGGER);
      assert.equal((await run(agentB)).run_state, RUN_STATE.SUCCESS_NO_TRIGGER);
      assert.equal(notifications(agentA).length, 1);
      assert.equal(notifications(agentB).length, 1);
      const beforeDisable = runs(agentA).length;
      await request(server, 'POST', `/api/agent-extensions/instances/${agentA}/disable`);
      assert.equal((await run(agentA)).run_state, RUN_STATE.SKIP_DISABLED);
      assert.equal(runs(agentA).length, beforeDisable);
      await request(server, 'POST', `/api/agent-extensions/instances/${agentA}/enable`);
      provider.failingProjects.add(1);
      const failed = await run(agentA);
      assert.equal(failed.run_state, RUN_STATE.ERROR_SOURCE);
      assert.equal(failed.sourceErrors[0].errorCode, 'FAKE_PROVIDER_DOWN');
      assert.equal(runtime.repository.getLastRun(agentA).status, 'error');
      assert.equal(notifications(agentA).length, 1);
      provider.failingProjects.delete(1);
      assert.equal((await run(agentA)).run_state, RUN_STATE.SUCCESS_NO_TRIGGER);
      assert.equal(notifications(agentA).length, 1);
      await writeFile(fileA, 'export const a = true;\n// HACK A_ONLY_CANARY\n');
      clock.advance(61_000);
      assert.equal((await run(agentA)).run_state, RUN_STATE.SUCCESS_TRIGGERED);
      assert.equal(notifications(agentA).length, 2);
      assert.equal(notifications(agentB).length, 1);
      assert.equal(runtime.database.prepare("SELECT count(*) AS n FROM agent_runs_v33 WHERE status = 'running'").get().n, 0);
    });
  } finally {
    if (server) await server.close();
    if (runtime?.database?.open) runtime.database.close();
    await rm(root, { recursive: true, force: true });
  }
});
