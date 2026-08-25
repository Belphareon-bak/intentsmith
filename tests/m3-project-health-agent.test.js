import './helpers/isolated-test-db.js';

import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import { EXTENSION_HOST_CAPABILITY } from '../contracts/m3/extension-v1.js';
import { AgentRepository, initAgentTables } from '../src/agents/repository.js';
import { AgentRunner, RUN_STATE } from '../src/agents/runner.js';
import { AgentScheduler } from '../src/agents/scheduler.js';
import { AgentExtensionService } from '../src/extensions/agent-extension-service.js';
import { createAgentProjectContextBridge } from '../src/extensions/agent-project-context.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ❌ ${name}: ${error.stack || error.message}`);
  }
}

const quietLogger = Object.freeze({
  info() {},
  warn() {},
  error() {},
});

function createRuntime(projectRoot) {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  database.exec(`
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    )
  `);
  database.prepare(`
    INSERT INTO projects (id, name, path, status) VALUES (1, 'M3 fixture', ?, 'active')
  `).run(projectRoot);
  initAgentTables(database);

  const projects = { findById: database.prepare('SELECT * FROM projects WHERE id = ?') };
  const repository = new AgentRepository(database);
  const bridge = createAgentProjectContextBridge({ projects });
  const extensionService = new AgentExtensionService({
    repository,
    hostCapabilities: {
      [EXTENSION_HOST_CAPABILITY.PROJECT_CONTEXT]: bridge.capability,
    },
  });
  extensionService.discover();
  const runner = new AgentRunner({
    repository,
    extensionService,
    projectContextBridge: bridge,
    logger: quietLogger,
  });
  const scheduler = new AgentScheduler({ repository, runner, logger: quietLogger });
  extensionService.attachScheduler(scheduler);
  return { database, repository, bridge, extensionService, runner, scheduler };
}

console.log('\n═══ M3 local project-health agent ════════════════════════════');

const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'intentsmith-m3-agent-'));
try {
  await writeFile(path.join(projectRoot, 'index.js'), 'export const healthy = true;\n');
  const runtime = createRuntime(projectRoot);

  await test('native agent manifest discovers through ExtensionContext capability checks', () => {
    const extensions = runtime.extensionService.list();
    assert.equal(extensions.length, 1);
    assert.deepEqual(extensions[0], {
      id: 'project-health',
      moduleVersion: '1.0.0',
      enabledByDefault: false,
      name: 'Project Health',
      description: 'Lokální deterministická kontrola projektových signálů přes M2 ProjectContext.',
      requiredCapabilities: ['code-intel.project-context.v1'],
    });
  });

  await test('missing required ProjectContext capability rejects discovery', () => {
    const isolated = new AgentExtensionService({
      repository: runtime.repository,
      hostCapabilities: {},
    });
    assert.throws(
      () => isolated.discover(),
      /missing-required-capability:code-intel\.project-context\.v1/,
    );
  });

  await test('native agent extension cannot request an ambient HTTP source', async () => {
    const extensionsRoot = await mkdtemp(path.join(os.tmpdir(), 'intentsmith-m3-agent-policy-'));
    try {
      const packageRoot = path.join(extensionsRoot, 'ambient-agent');
      await mkdir(packageRoot, { recursive: true });
      const definition = JSON.parse(await readFile(
        new URL('../agent-extensions/project-health/agent.json', import.meta.url),
        'utf8',
      ));
      definition.id = 'ambient-agent';
      definition.payload.definition.id = 'ambient-agent';
      definition.payload.definition.sources = [{
        id: 'ambient',
        type: 'http',
        config: { url: 'https://example.invalid', method: 'GET' },
      }];
      await writeFile(path.join(packageRoot, 'agent.json'), `${JSON.stringify(definition)}\n`);
      const isolated = new AgentExtensionService({
        repository: runtime.repository,
        hostCapabilities: {
          [EXTENSION_HOST_CAPABILITY.PROJECT_CONTEXT]: runtime.bridge.capability,
        },
        extensionsDir: extensionsRoot,
      });
      assert.throws(
        () => isolated.discover(),
        error => error.code === 'M3_AGENT_EXTENSION_EFFECT_AUTHORITY_REQUIRED',
      );
    } finally {
      await rm(extensionsRoot, { recursive: true, force: true });
    }
  });

  await test('native agent extension cannot request a webhook action', async () => {
    const extensionsRoot = await mkdtemp(path.join(os.tmpdir(), 'intentsmith-m3-agent-action-'));
    try {
      const packageRoot = path.join(extensionsRoot, 'ambient-action');
      await mkdir(packageRoot, { recursive: true });
      const definition = JSON.parse(await readFile(
        new URL('../agent-extensions/project-health/agent.json', import.meta.url),
        'utf8',
      ));
      definition.id = 'ambient-action';
      definition.payload.definition.id = 'ambient-action';
      definition.payload.definition.actions = [{
        type: 'webhook',
        trigger_id: 'health_changed',
        config: { url: 'https://example.invalid/hook' },
      }];
      await writeFile(path.join(packageRoot, 'agent.json'), `${JSON.stringify(definition)}\n`);
      const isolated = new AgentExtensionService({
        repository: runtime.repository,
        hostCapabilities: {
          [EXTENSION_HOST_CAPABILITY.PROJECT_CONTEXT]: runtime.bridge.capability,
        },
        extensionsDir: extensionsRoot,
      });
      assert.throws(
        () => isolated.discover(),
        error => error.code === 'M3_AGENT_EXTENSION_EFFECT_AUTHORITY_REQUIRED',
      );
    } finally {
      await rm(extensionsRoot, { recursive: true, force: true });
    }
  });

  await test('disabled manual run is inert and creates no run or notification', async () => {
    const installed = runtime.extensionService.install('project-health', {
      instanceId: 'project-health-fixture',
      params: { project_id: 1 },
      enabled: false,
    });
    assert.equal(installed.enabled, false);
    const result = await runtime.scheduler.triggerAgent(installed.id);
    assert.equal(result.run_state, RUN_STATE.SKIP_DISABLED);
    assert.equal(runtime.repository.getRunHistory(installed.id).length, 0);
    assert.equal(runtime.repository.getNotifications({ agentId: installed.id }).length, 0);
  });

  await test('first enabled run persists an exact workspace baseline without notification', async () => {
    runtime.repository.updateAgent('project-health-fixture', { enabled: true });
    const result = await runtime.scheduler.triggerAgent('project-health-fixture');
    assert.equal(result.run_state, RUN_STATE.INIT_BASELINE, JSON.stringify(result));
    assert.deepEqual(result.triggered, []);
    const agent = runtime.repository.getAgent('project-health-fixture');
    assert.match(agent.state._prev_sources_project_health_data_workspace_revision, /^wsr1:[0-9a-f]{64}$/);
    assert.equal(runtime.repository.getNotifications({ agentId: agent.id }).length, 0);
  });

  await test('changed project fires trigger and exposes durable health evidence in Studio notification data', async () => {
    await writeFile(
      path.join(projectRoot, 'index.js'),
      'export const healthy = false;\n// FIXME remove temporary bypass\n',
    );
    const result = await runtime.scheduler.triggerAgent('project-health-fixture');
    assert.equal(result.run_state, RUN_STATE.SUCCESS_TRIGGERED, JSON.stringify(result));
    assert.deepEqual(result.triggered, ['health_changed']);
    assert.equal(result.actions.filter(action => action.type === 'notify' && action.status === 'ok').length, 1);

    const notifications = runtime.repository.getNotifications({ agentId: 'project-health-fixture' });
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].title, 'Project Health: attention');
    assert.match(notifications[0].body, /1 signálů v 1 souborech/);
    assert.match(notifications[0].data.workspaceRevision, /^wsr1:[0-9a-f]{64}$/);
    assert.match(notifications[0].data.snapshotDigest, /^pcs1:[0-9a-f]{64}$/);
    assert.equal(notifications[0].data.issueCount, '1');

    const run = runtime.repository.getLastRun('project-health-fixture');
    const evidence = run.explain.sources[0].evidence;
    assert.equal(evidence.issueCount, 1);
    assert.equal(evidence.provenance[0].path, 'index.js');
    assert.match(evidence.provenance[0].contentDigest, /^sha256:[0-9a-f]{64}$/);
  });

  await test('tampered extension definition fails closed before project source execution', async () => {
    const agent = runtime.repository.getAgent('project-health-fixture');
    const definition = structuredClone(agent.definition);
    definition.sources[0].config.query = 'invented ambient authority';
    runtime.repository.updateAgent(agent.id, { definition });
    const before = runtime.repository.getNotifications({ agentId: agent.id }).length;
    const result = await runtime.scheduler.triggerAgent(agent.id);
    assert.equal(result.run_state, RUN_STATE.ERROR_UNKNOWN);
    assert.match(result.error, /modified/);
    assert.equal(runtime.repository.getNotifications({ agentId: agent.id }).length, before);
  });

  await test('owned extension instance can be removed and cannot run afterwards', async () => {
    runtime.repository.updateAgent('project-health-fixture', { enabled: false });
    assert.equal(
      runtime.extensionService.uninstall('project-health', 'project-health-fixture'),
      true,
    );
    assert.equal(runtime.repository.getAgent('project-health-fixture'), null);
    await assert.rejects(
      () => runtime.scheduler.triggerAgent('project-health-fixture'),
      /Agent not found/,
    );
  });

  runtime.database.close();
} finally {
  await rm(projectRoot, { recursive: true, force: true });
}

console.log(`\n${'═'.repeat(68)}`);
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(68)}\n`);

process.exit(failed > 0 ? 1 : 0);
