import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

import {
  REMOTE_CORE_DOMAINS,
  REMOTE_CORE_FEATURE_IDS,
  REMOTE_CORE_PORT_STAGE,
  negotiateRemoteCoreVersion,
} from '../contracts/remote-core/index.js';
import {
  RemoteCorePort,
  RemoteCorePortError,
  createMobileRemoteCorePort,
  createUpstreamRemoteCorePort,
} from '../src/remote-core/port.js';
import { handleCapabilities } from '../src/mobile/handlers.js';

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✗ ${name}: ${error.message}`);
  }
}

function code(errorCode) {
  return error => error instanceof RemoteCorePortError && error.code === errorCode;
}

console.log('\n=== RemoteCorePort candidate v1 contract ===');

await test('inventory covers exactly the seven core-owned domains', () => {
  assert.deepEqual(REMOTE_CORE_DOMAINS, [
    'projects', 'conversations', 'settings', 'storedInformation',
    'approvals', 'notifications', 'events',
  ]);
  assert.equal(REMOTE_CORE_FEATURE_IDS.length, 19);
  assert.equal(REMOTE_CORE_PORT_STAGE, 'CANDIDATE_V1');
});

await test('version selection follows client preference and rejects downgrade guesses', () => {
  assert.equal(negotiateRemoteCoreVersion(['v1']).version, 1);
  assert.equal(negotiateRemoteCoreVersion([9, 1]).version, 1);
  assert.equal(negotiateRemoteCoreVersion([9]).code, 'contract_version_unsupported');
  assert.equal(negotiateRemoteCoreVersion([]).code, 'contract_offer_invalid');
  assert.equal(negotiateRemoteCoreVersion([1, 'v1']).code, 'contract_offer_duplicate');
});

await test('capabilities distinguish unavailable from forbidden from available', () => {
  const port = new RemoteCorePort({
    providers: { 'projects.read': async () => ({ ok: true, data: [] }) },
  });
  const none = port.capabilities({ scopes: [] }).features;
  assert.equal(none['projects.read'].status, 'forbidden');
  assert.equal(none['projects.create'].status, 'unavailable');
  const reader = port.capabilities({ scopes: ['read:projects'] }).features;
  assert.equal(reader['projects.read'].status, 'available');
});

await test('missing provider is a named refusal, never an empty success', async () => {
  const port = new RemoteCorePort();
  await assert.rejects(
    port.invoke({ version: 1, feature: 'projects.read', principal: { scopes: ['read:projects'] } }),
    code('capability_unavailable'),
  );
});

await test('scope check happens before provider execution', async () => {
  let calls = 0;
  const port = new RemoteCorePort({
    providers: { 'settings.write': async () => { calls += 1; return { ok: true, data: {} }; } },
  });
  await assert.rejects(
    port.invoke({ version: 1, feature: 'settings.write', input: {}, principal: { scopes: [] } }),
    code('capability_forbidden'),
  );
  assert.equal(calls, 0);
});

await test('providers can return only the closed success/error algebra', async () => {
  const malformed = new RemoteCorePort({
    providers: { 'projects.read': async () => [] },
  });
  await assert.rejects(
    malformed.invoke({ version: 1, feature: 'projects.read', principal: { scopes: ['read:projects'] } }),
    code('provider_result_invalid'),
  );

  const negative = new RemoteCorePort({
    providers: {
      'projects.read': async () => ({ ok: false, error: { code: 'repository_unavailable' } }),
    },
  });
  assert.deepEqual(
    await negative.invoke({ version: 1, feature: 'projects.read', principal: { scopes: ['read:projects'] } }),
    { ok: false, error: { code: 'repository_unavailable' } },
  );
});

await test('unknown capabilities and provider keys cannot become a legacy bypass', async () => {
  assert.throws(
    () => new RemoteCorePort({ providers: { 'legacy.request': async () => ({ ok: true, data: {} }) } }),
    code('provider_unknown'),
  );
  const port = new RemoteCorePort();
  await assert.rejects(
    port.invoke({ version: 1, feature: '/api/security/tokens', input: {} }),
    code('capability_unknown'),
  );
  assert.equal('fetch' in port, false);
  assert.equal('request' in port, false);
  assert.equal('baseUrl' in port, false);
});

await test('legacy chat adapter preserves decided versus ambiguous failures', async () => {
  const outcomes = [
    { ok: false, decided: true, code: 'upstream_bad_request', status: 400 },
    { ok: false, decided: false, code: 'upstream_timeout' },
  ];
  const port = createUpstreamRemoteCorePort({ postChat: async () => outcomes.shift() });
  const request = {
    version: 1,
    feature: 'conversations.send',
    input: { conversationId: 'c1', message: 'hello' },
    principal: { deviceId: 'd1', scopes: ['write:chat'] },
  };
  const decided = await port.invoke(request);
  assert.equal(decided.error.details.decided, true);
  assert.equal(decided.error.details.status, 400);
  const ambiguous = await port.invoke(request);
  assert.equal(ambiguous.error.details.decided, false);
});

await test('gateway capabilities expose the connector version and per-feature truth', async () => {
  const port = new RemoteCorePort({
    providers: { 'conversations.send': async () => ({ ok: true, data: {} }) },
  });
  const response = await handleCapabilities({
    principal: { deviceId: 'd1', name: 'phone', scopes: ['read:capabilities', 'write:chat'] },
    upstream: { probe: async () => ({ reachable: true }) },
    corePort: port,
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.remoteCore.version, 1);
  assert.equal(response.body.data.remoteCore.features['conversations.send'].status, 'available');
  assert.equal(response.body.data.remoteCore.features['projects.read'].status, 'unavailable');
});

await test('production gateway routes chat through the narrow port', () => {
  const gateway = readFileSync(new URL('../src/mobile/gateway.js', import.meta.url), 'utf8');
  const handlers = readFileSync(new URL('../src/mobile/handlers.js', import.meta.url), 'utf8');
  assert.match(gateway, /createMobileRemoteCorePort\(\{ rawDb, upstream \}\)/);
  assert.match(handlers, /corePort\.invoke\(\{/);
  assert.doesNotMatch(gateway, /fetch\s*\(/i);
  assert.doesNotMatch(gateway, /['"](?:GET|POST|PUT|PATCH|DELETE)\s+\/m1\/\*['"]/i);
});

await test('production connector exposes project reads without project writes', () => {
  const rawDb = {
    prepare(sql) {
      return {
        all: () => sql.includes('FROM projects p') ? [] : [],
        get: () => undefined,
      };
    },
  };
  const port = createMobileRemoteCorePort({
    rawDb,
    upstream: { postChat: async () => ({ ok: true, data: {} }) },
  });
  const features = port.capabilities({ scopes: ['read:projects', 'write:projects'] }).features;
  assert.equal(features['projects.read'].status, 'available');
  assert.equal(features['projects.create'].status, 'unavailable');
  assert.equal(features['projects.update'].status, 'unavailable');
  assert.equal(features['projects.archive'].status, 'unavailable');
});

console.log(`\nRemoteCorePort contract: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
