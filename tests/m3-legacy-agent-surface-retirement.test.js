#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { suite, test, testAsync, summary } from './harness.js';
import { AgentScheduler } from '../src/agents/scheduler.js';
import {
  M3_LEGACY_AGENT_MUTATING_ROUTE_KEYS,
  M3_LEGACY_AGENT_RETIRED_CODE,
  M3_LEGACY_AGENT_REPLACEMENT,
  M3_LEGACY_AGENT_RETIREMENT_RESPONSE,
  createM3LegacyAgentQuarantineRoutes,
} from '../src/agents/m3-legacy-agent-quarantine.js';

const EXPECTED_ROUTE_KEYS = Object.freeze([
  'POST /api/agents',
  'PUT /api/agents/:id',
  'DELETE /api/agents/:id',
  'POST /api/agents/:id/run',
  'POST /api/agents/:id/enable',
  'POST /api/agents/:id/disable',
  'POST /api/agents/build',
  'POST /api/agents/refine',
  'POST /api/agents/confirm',
  'POST /api/agents/dry-run',
  'POST /api/sources/inspect',
  'POST /api/sources/validate-field',
  'POST /api/sources/validate-condition',
]);

const EXPECTED_RESPONSE = Object.freeze({
  error: 'Legacy agent mutation endpoints are retired.',
  code: 'LEGACY_AGENT_MUTATION_RETIRED',
  replacement: '/api/agent-extensions',
});

const quietLogger = Object.freeze({ info() {}, warn() {}, error() {} });

function makeFactoryHarness() {
  const responses = [];
  let forbiddenDependencyReads = 0;
  const dependencies = new Proxy({
    sendJSON: (res, status, payload) => {
      responses.push({ res, status, payload });
      return Object.freeze({ status, payload });
    },
  }, {
    get(target, property, receiver) {
      if (property === 'sendJSON') return Reflect.get(target, property, receiver);
      forbiddenDependencyReads += 1;
      throw new Error(`quarantine accessed forbidden dependency: ${String(property)}`);
    },
  });
  return {
    dependencies,
    responses,
    get forbiddenDependencyReads() { return forbiddenDependencyReads; },
  };
}

suite('M3 legacy agent mutation surface — exact quarantine membership');

test('route list is frozen, duplicate-free, and exactly covers the legacy mutators', () => {
  assert.equal(Object.isFrozen(M3_LEGACY_AGENT_MUTATING_ROUTE_KEYS), true);
  assert.deepEqual(M3_LEGACY_AGENT_MUTATING_ROUTE_KEYS, EXPECTED_ROUTE_KEYS);
  assert.equal(new Set(M3_LEGACY_AGENT_MUTATING_ROUTE_KEYS).size, EXPECTED_ROUTE_KEYS.length);
});

test('read-only legacy routes and native M3 extension routes remain outside quarantine', () => {
  const excluded = [
    'GET /api/agents',
    'GET /api/agents/:id',
    'GET /api/agents/:id/runs',
    'GET /api/agents/schema',
    'GET /api/scheduler/status',
    'GET /api/agent-extensions',
    'POST /api/agent-extensions/:id/install',
    'DELETE /api/agent-extensions/instances/:agentId',
    'POST /api/agent-extensions/instances/:agentId/run',
    'POST /api/agent-extensions/instances/:agentId/enable',
    'POST /api/agent-extensions/instances/:agentId/disable',
  ];
  for (const routeKey of excluded) {
    assert.equal(M3_LEGACY_AGENT_MUTATING_ROUTE_KEYS.includes(routeKey), false);
  }
});

test('exported typed response is immutable and identifies the M3 replacement', () => {
  assert.equal(M3_LEGACY_AGENT_RETIRED_CODE, EXPECTED_RESPONSE.code);
  assert.equal(M3_LEGACY_AGENT_REPLACEMENT, EXPECTED_RESPONSE.replacement);
  assert.equal(Object.isFrozen(M3_LEGACY_AGENT_RETIREMENT_RESPONSE), true);
  assert.deepEqual(M3_LEGACY_AGENT_RETIREMENT_RESPONSE, EXPECTED_RESPONSE);
});

suite('M3 legacy agent mutation surface — fail-closed handlers');

test('every quarantined route returns exact HTTP 410 without reading request data', () => {
  const harness = makeFactoryHarness();
  const routes = createM3LegacyAgentQuarantineRoutes(harness.dependencies);
  assert.equal(Object.isFrozen(routes), true);
  assert.deepEqual(Object.keys(routes), EXPECTED_ROUTE_KEYS);

  for (const routeKey of EXPECTED_ROUTE_KEYS) {
    const request = new Proxy({}, {
      get(_target, property) {
        throw new Error(`${routeKey} read request property ${String(property)}`);
      },
    });
    const response = Object.freeze({ routeKey });
    const returned = routes[routeKey](request, response, new Proxy({}, {
      get(_target, property) {
        throw new Error(`${routeKey} resolved path property ${String(property)}`);
      },
    }));
    assert.deepEqual(returned, { status: 410, payload: EXPECTED_RESPONSE });
  }

  assert.equal(harness.responses.length, EXPECTED_ROUTE_KEYS.length);
  assert.equal(harness.forbiddenDependencyReads, 0);
});

test('interpolated webhook input cannot select a destination because body is never read', () => {
  const routes = createM3LegacyAgentQuarantineRoutes({
    sendJSON: (_res, status, payload) => ({ status, payload }),
  });
  const request = new Proxy({}, {
    get(_target, property) {
      throw new Error(`retired create route inspected ${String(property)}`);
    },
  });
  const result = routes['POST /api/agents'](request, {}, {
    definition: {
      actions: [{
        type: 'webhook',
        config: { url: '{{sources.source-1.data.redirect}}' },
      }],
    },
  });
  assert.deepEqual(result, { status: 410, payload: EXPECTED_RESPONSE });
});

test('missing response writer fails during construction', () => {
  assert.throws(() => createM3LegacyAgentQuarantineRoutes(), /requires sendJSON/);
});

suite('M3 legacy agent runtime — scheduler authority');

await testAsync('legacy agents cannot be scheduled, triggered, or executed as due work', async () => {
  const legacy = Object.freeze({
    id: 'legacy-agent',
    name: 'Legacy',
    enabled: true,
    definition: { schedule: { type: 'interval', value: '1h' } },
  });
  let executeCalls = 0;
  let scheduleWrites = 0;
  const repository = {
    getAgent: id => (id === legacy.id ? legacy : null),
    getAllAgents: () => [legacy],
    getDueAgents: () => [{ agent_id: legacy.id, interval_ms: 3600000 }],
    getSchedule: () => null,
    setSchedule: () => { scheduleWrites += 1; },
    updateLastRun: () => { throw new Error('legacy schedule advanced'); },
  };
  const scheduler = new AgentScheduler({
    repository,
    runner: { execute: async () => { executeCalls += 1; } },
    executionAuthority: agent => agent.definition?.m3_extension?.contract === 'M3AgentExtensionBinding',
    logger: quietLogger,
  });

  assert.equal(scheduler.scheduleAgent(legacy), false);
  assert.equal(scheduleWrites, 0);
  await assert.rejects(
    () => scheduler.triggerAgent(legacy.id),
    error => error?.code === 'M3_AGENT_EXTENSION_AUTHORITY_REQUIRED',
  );
  scheduler.running = true;
  await scheduler.checkDue();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(executeCalls, 0);
  assert.deepEqual(scheduler.getStatus().scheduled, []);
});

await testAsync('an authorized M3-bound instance still reaches the scheduler', async () => {
  const trusted = Object.freeze({
    id: 'trusted-agent',
    name: 'Trusted',
    enabled: true,
    definition: {
      schedule: { type: 'manual' },
      m3_extension: { contract: 'M3AgentExtensionBinding' },
    },
  });
  const calls = [];
  const repository = {
    getAgent: id => (id === trusted.id ? trusted : null),
    getAllAgents: () => [trusted],
    getSchedule: () => null,
  };
  const scheduler = new AgentScheduler({
    repository,
    runner: { execute: async (id, options) => { calls.push({ id, options }); return { ok: true }; } },
    executionAuthority: agent => agent.definition?.m3_extension?.contract === 'M3AgentExtensionBinding',
    logger: quietLogger,
  });

  assert.deepEqual(await scheduler.triggerAgent(trusted.id), { ok: true });
  assert.deepEqual(calls, [{ id: trusted.id, options: { isManual: true } }]);
  assert.deepEqual(scheduler.getStatus().scheduled.map(item => item.id), [trusted.id]);
});

suite('M3 legacy agent mutation surface — static containment sentinels');

test('quarantine module imports no runner, source, action, builder, or other module', () => {
  const source = readFileSync(
    new URL('../src/agents/m3-legacy-agent-quarantine.js', import.meta.url),
    'utf8',
  );
  const imports = [...source.matchAll(/^\s*import\s+[^;]+;?\s*$/gm)].map(match => match[0]);
  assert.deepEqual(imports, []);
});

test('production scheduler is explicitly bound to the extension execution authority', () => {
  const source = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.match(source, /executionAuthority:\s*agent\s*=>/);
  assert.match(source, /agentExtensionService\.resolveExecution\(agent\)/);
  assert.match(source, /retiredLegacyMutators\.has\(key\)/);
  assert.doesNotMatch(source, /registerAgent\s*\(/);
});

summary();
