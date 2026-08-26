#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import Database from 'better-sqlite3';

import { config } from '../src/config.js';
import { up as applyOutboundAudit } from '../src/db/migrations/2026_08_26_089_m5_outbound_audit.js';
import {
  OUTBOUND_ERROR_CODE,
  configureProductionOutboundPolicy,
} from '../src/network/outbound-policy.js';
import { resolveM5ConditionalSurfaces } from '../src/release/conditional-surfaces.js';
import { clearCache } from '../src/upgrade/huggingface-client.js';
import { discover } from '../src/upgrade/model-discovery.js';
import { getCurrentBindings } from '../src/upgrade/model-profiles.js';
import { suite, summary, testAsync } from './harness.js';

const JOURNEY_ID = 'M6-JOURNEY-MODEL-DISCOVERY-V1';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

suite('M6 governed model-discovery conditional journey');

await testAsync('enabled discovery enriches an owned local candidate through audited opaque authority without changing bindings', async () => {
  assert.equal(config.features.onlineDiscovery, true);
  const surfaces = resolveM5ConditionalSurfaces({ config, environment: {} });
  assert.deepEqual(surfaces.requiredM6Journeys, [JOURNEY_ID]);

  const database = new Database(':memory:');
  applyOutboundAudit(database);
  const transportCalls = [];
  const policy = configureProductionOutboundPolicy({
    database,
    enabledSurfaces: { 'model-discovery': true },
    logger: { warn() {}, error() {} },
    clock: (() => {
      let now = Date.parse('2026-08-27T00:00:00.000Z');
      return () => ++now;
    })(),
    idFactory: (() => {
      let id = 0;
      return () => `m6-model-discovery-${++id}`;
    })(),
    transport: async (input, init) => {
      transportCalls.push({ url: String(input), redirect: init.redirect });
      return new Response(JSON.stringify([{
        id: 'Qwen/Qwen3.5-27B',
        createdAt: '2026-01-01T00:00:00.000Z',
        pipeline_tag: 'image-text-to-text',
        downloads: 123456,
        likes: 789,
      }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const ollama = createServer((request, response) => {
    assert.equal(request.method, 'GET');
    assert.equal(request.url, '/api/tags');
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      models: [{
        name: 'qwen3.5:27b',
        size: 17_179_869_184,
        modified_at: '2026-08-26T00:00:00.000Z',
        digest: `sha256:${'a'.repeat(64)}`,
        details: {
          family: 'qwen3.5',
          parameter_size: '27B',
          quantization_level: 'Q4_K_M',
        },
      }],
    }));
  });
  const port = await listen(ollama);
  clearCache();
  const bindingsBefore = getCurrentBindings();

  try {
    const result = await discover({
      baseUrl: `http://127.0.0.1:${port}`,
      timeout: 2_000,
      includeCatalog: false,
      includeHuggingFace: true,
    });
    assert.equal(result.ollamaAvailable, true);
    assert.equal(result.stats.local, 1);
    assert.equal(result.stats.hfResolved, 1);
    assert.equal(result.candidates[0].name, 'qwen3.5:27b');
    assert.equal(result.candidates[0].hfRepo, 'Qwen/Qwen3.5-27B');
    assert.equal(result.candidates[0].adoption.downloads, 123456);
    assert(result.candidates[0].capabilities.includes('vision'));
    assert.deepEqual(getCurrentBindings(), bindingsBefore);

    assert.equal(transportCalls.length, 1);
    assert.equal(transportCalls[0].redirect, 'manual');
    const transportUrl = new URL(transportCalls[0].url);
    assert.equal(transportUrl.origin, 'https://huggingface.co');
    assert.equal(transportUrl.pathname, '/api/models');
    assert.equal(transportUrl.searchParams.get('search'), 'qwen3.5 27b');

    await assert.rejects(
      policy.fetch(transportCalls[0].url, {
        headers: { Accept: 'application/json', 'User-Agent': 'intentsmith/1.0' },
      }, { surface: 'model-discovery', scope: 'model.metadata.read' }),
      error => error.code === OUTBOUND_ERROR_CODE.SCOPE_REQUIRED,
    );
    assert.equal(transportCalls.length, 1, 'forged string/object authority reached transport');

    assert.deepEqual(database.prepare(`
      SELECT phase, decision, surface, scope, reason_code AS reasonCode
      FROM m5_outbound_audit_events
      ORDER BY occurred_at_ms, event_id
    `).all(), [
      {
        phase: 'decision', decision: 'allow', surface: 'model-discovery',
        scope: 'model.metadata.read', reasonCode: 'OUTBOUND_POLICY_ALLOWED',
      },
      {
        phase: 'terminal', decision: 'succeeded', surface: 'model-discovery',
        scope: 'model.metadata.read', reasonCode: 'OUTBOUND_REQUEST_COMPLETED',
      },
      {
        phase: 'decision', decision: 'deny', surface: 'unscoped',
        scope: 'none', reasonCode: 'OUTBOUND_SCOPE_REQUIRED',
      },
    ]);
  } finally {
    clearCache();
    await close(ollama);
    database.close();
  }
});

summary();
