#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { suite, test, testAsync, summary } from './harness.js';
import { computeEffectRequestDigest } from '../contracts/m2/effect-v1.js';
import {
  M2_TOOL_ERROR_CODE,
  canonicalizeM2ToolValue,
  computeM2ToolRequestDigest,
  validateM2ToolRequest,
  validateM2ToolResult,
} from '../contracts/m2/tool-v1.js';
import { createM2ToolBroker, M2ToolBrokerErrorCode } from '../src/tools/m2-tool-broker.js';
import { createM2ToolEffectAdapter } from '../src/tools/m2-tool-effect-adapter.js';
import { expectedM2EffectOperationKey } from '../src/tools/m2-tool-registry.js';
import {
  M2ToolAuthorityErrorCode,
  M2ToolAuthorityRepository,
} from '../src/tools/m2-tool-authority-repository.js';
import { createEffectFileRuntime } from '../src/effects/effect-file-runtime.js';
import { up as applyEffectAuthority } from '../src/db/migrations/2026_08_23_092_m2_effect_authority.js';
import { up as applyEffectHardening } from '../src/db/migrations/2026_08_24_071_m2_effect_authority_hardening.js';
import { up as applyEffectClaims } from '../src/db/migrations/2026_08_24_072_m2_effect_execution_claims.js';
import { up as applyEffectClaimTruth } from '../src/db/migrations/2026_08_24_073_m2_effect_claim_truth.js';
import { up as applyToolAuthority } from '../src/db/migrations/2026_08_24_074_m2_tool_authority.js';
import { up as applyToolEffectLinks } from '../src/db/migrations/2026_08_24_075_m2_tool_effect_links.js';
import { up as applyToolTruth } from '../src/db/migrations/2026_08_24_076_m2_tool_authority_truth.js';
import { up as applyEffectInvalidations } from '../src/db/migrations/2026_08_24_077_m2_effect_invalidations.js';

function clockFrom(values) {
  const queue = [...values];
  return () => queue.shift() ?? values.at(-1);
}

function memoryRepository() {
  const requests = new Map();
  const results = new Map();
  const linksByRequest = new Map();
  const linksByEffect = new Map();
  const effectResults = new Map();
  const claims = new Map();
  return {
    registerToolRequest(request) {
      const encoded = canonicalizeM2ToolValue(request);
      const existing = requests.get(request.requestId);
      if (existing && canonicalizeM2ToolValue(existing) !== encoded) {
        throw new Error('request conflict');
      }
      requests.set(request.requestId, structuredClone(request));
    },
    getToolRequest(requestId) {
      const value = requests.get(requestId);
      return value ? Object.freeze(structuredClone(value)) : null;
    },
    getToolResult(requestId) {
      const value = results.get(requestId);
      return value ? Object.freeze(structuredClone(value)) : null;
    },
    recordToolResult(result) {
      const existing = results.get(result.requestId);
      if (existing && canonicalizeM2ToolValue(existing) !== canonicalizeM2ToolValue(result)) {
        throw new Error('result conflict');
      }
      results.set(result.requestId, structuredClone(result));
    },
    bindToolEffect({ requestId, effectRequestId, effectRequest }) {
      const existing = linksByRequest.get(requestId) || linksByEffect.get(effectRequestId);
      const link = {
        requestId,
        effectId: effectRequestId,
        request: structuredClone(requests.get(requestId)),
        effectRequest: structuredClone(effectRequest),
      };
      if (existing && canonicalizeM2ToolValue(existing.effectRequest)
        !== canonicalizeM2ToolValue(effectRequest)) throw new Error('effect link conflict');
      linksByRequest.set(requestId, link);
      linksByEffect.set(effectRequestId, link);
    },
    getEffectLinkByRequest(requestId) {
      const value = linksByRequest.get(requestId);
      return value ? structuredClone(value) : null;
    },
    getEffectLinkByEffect(effectRequestId) {
      const value = linksByEffect.get(effectRequestId);
      return value ? structuredClone(value) : null;
    },
    getToolRequestByEffect(effectRequestId) {
      const value = linksByEffect.get(effectRequestId)?.request;
      return value ? structuredClone(value) : null;
    },
    getExactEffectResult(effectRequestId) {
      const value = effectResults.get(effectRequestId);
      return value ? structuredClone(value) : null;
    },
    invalidatePendingEffect({ requestId, effectRequestId, reasonCode }) {
      return { requestId, effectId: effectRequestId, reasonCode, invalidatedAtMs: 1 };
    },
    invalidateToolEffectOperation({ requestId, reasonCode }) {
      return { requestId, effectId: null, reasonCode, invalidatedAtMs: 1 };
    },
    getToolEffectOperationInvalidation() {
      return null;
    },
    getToolEffectInvalidation() {
      return null;
    },
    getToolExecutionClaim(requestId) {
      return claims.get(requestId) || null;
    },
    claimToolExecution({ requestId, executionOwner, allowTakeover = false }) {
      const existing = claims.get(requestId);
      if (existing && !allowTakeover) return { acquired: false, claim: existing };
      const claim = Object.freeze({
        requestId,
        generation: (existing?.generation || 0) + 1,
        ownerId: executionOwner.ownerId,
        ownerPid: executionOwner.pid,
        ownerBootId: executionOwner.bootId,
        ownerStartIdentity: executionOwner.startIdentity,
        claimedAtMs: 1,
      });
      claims.set(requestId, claim);
      return { acquired: true, claim };
    },
    _recordEffectResult(value) {
      effectResults.set(value.effectId, structuredClone(value));
    },
  };
}

function realAuthorityDatabase(filename = ':memory:') {
  const database = new Database(filename);
  database.pragma('foreign_keys = ON');
  applyEffectAuthority(database);
  applyEffectHardening(database);
  applyEffectClaims(database);
  applyEffectClaimTruth(database);
  applyToolAuthority(database);
  applyToolEffectLinks(database);
  applyToolTruth(database);
  applyEffectInvalidations(database);
  return database;
}

function openAuthorityDatabase(filename) {
  const database = new Database(filename);
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 2000');
  return database;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return Object.freeze({ promise, resolve, reject });
}

function executionOwner(token, pid) {
  return Object.freeze({
    ownerId: `owner:${token}`,
    pid,
    bootId: `${token.repeat(8).slice(0, 8)}-${token.repeat(4).slice(0, 4)}-4${token.repeat(3).slice(0, 3)}-8${token.repeat(3).slice(0, 3)}-${token.repeat(12).slice(0, 12)}`,
    startIdentity: String(10_000 + pid),
  });
}

function broker(options = {}) {
  return createM2ToolBroker({ repository: memoryRepository(), ...options });
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function digest(value) {
  return `sha256:${sha256(value)}`;
}

function effectRequestForTool(request, {
  kind,
  target,
  payload = Buffer.alloc(0),
  capability,
  riskClass,
} = {}) {
  return {
    contract: 'EffectRequest',
    version: 1,
    effectId: `effect:${sha256(request.requestId)}`,
    runId: request.runId,
    parentEffectId: null,
    actor: request.actor,
    origin: request.origin,
    kind,
    target,
    payloadDigest: digest(payload),
    payloadBytes: payload.length,
    workspaceRevision: 'wsr1:test-revision',
    requiredCapability: capability,
    riskClass,
    timeoutMs: request.timeoutMs,
    idempotencyKey: expectedM2EffectOperationKey(request),
    approvalGrantId: null,
    createdAt: '2026-08-24T08:00:00.000Z',
  };
}

function succeededEffectResult(effectRequest) {
  return {
    contract: 'EffectResult',
    version: 1,
    effectId: effectRequest.effectId,
    runId: effectRequest.runId,
    projectId: effectRequest.origin.projectId,
    requestDigest: computeEffectRequestDigest(effectRequest),
    approvalGrantId: `grant:${'9'.repeat(64)}`,
    terminalStatus: 'succeeded',
    startedAt: '2026-08-24T08:00:01.000Z',
    completedAt: '2026-08-24T08:00:02.000Z',
    process: {
      pid: null,
      processGroupId: null,
      startIdentity: null,
      exitCode: null,
      signal: null,
    },
    changes: {
      paths: [effectRequest.target.relativePath],
      beforeDigest: null,
      afterDigest: effectRequest.payloadDigest,
      diffArtifact: null,
    },
    network: { resolvedAddresses: [], finalUrl: null, status: null, bytes: 0 },
    rollback: { required: false, status: 'not_required', evidenceRef: null },
    outputDigest: effectRequest.payloadDigest,
    errorCode: null,
    evidenceRefs: [`effect:${effectRequest.effectId}:test-success`],
    lateCompletionRejected: false,
  };
}

const context = Object.freeze({
  sessionId: 'studio-session-1',
  conversationId: 'conversation-1',
  userMessageId: 91,
  authenticatedSubject: { actorType: 'user', actorId: 'operator-1' },
  project: { id: 7, path: '/workspace/project-a' },
});

suite('M2 tool broker — exact request ownership and direct execution');

test('registry, not caller, derives risk, schema and effect mapping', () => {
  const broker = createM2ToolBroker({
    repository: memoryRepository(),
    clock: () => 1_777_000_000_000,
  });
  const request = broker.createRequest({
    toolId: 'web.search',
    input: { query: 'IntentSmith' },
    context,
    timeoutMs: 1_000,
  });
  assert.equal(validateM2ToolRequest(request).valid, true);
  assert.equal(request.riskClass, 'network');
  assert.equal(request.requiredEffectKind, 'network.request');
  assert.equal(request.actor.id, 'operator-1');
  assert.equal(request.origin.projectId, 7);
});

test('same run, operation and normalized bytes yield stable request identity', () => {
  const repository = memoryRepository();
  const broker = createM2ToolBroker({
    repository,
    clock: clockFrom([1_777_000_000_000, 1_777_000_001_000]),
  });
  const first = broker.createRequest({ toolId: 'local.math', input: { query: '2+2' }, context });
  const second = broker.createRequest({ toolId: 'local.math', input: { query: '2+2' }, context });
  assert.equal(first.requestId, second.requestId);
  assert.equal(first.idempotencyKey, second.idempotencyKey);
  assert.equal(first.createdAt, second.createdAt);
});

test('explicit effect retry generation creates a new operation while reconnect replay stays exact', () => {
  const repository = memoryRepository();
  const broker = createM2ToolBroker({
    repository,
    clock: clockFrom([
      1_777_000_000_000,
      1_777_000_001_000,
      1_777_000_002_000,
      1_777_000_003_000,
    ]),
  });
  const input = { path: 'notes/retry.txt', content: 'retry bytes\n' };
  const original = broker.createRequest({ toolId: 'file.write', input, context });
  const reconnect = broker.createRequest({
    toolId: 'file.write',
    input,
    context: { ...context, sessionId: 'studio-session-after-reconnect' },
  });
  const retryOne = broker.createRequest({
    toolId: 'file.write',
    input,
    context: { ...context, effectRetryGeneration: 1 },
  });
  const retryOneReplay = broker.createRequest({
    toolId: 'file.write',
    input,
    context: { ...context, sessionId: 'retry-reconnect', effectRetryGeneration: 1 },
  });
  const retryTwo = broker.createRequest({
    toolId: 'file.write',
    input,
    context: { ...context, effectRetryGeneration: 2 },
  });

  assert.equal(reconnect.requestId, original.requestId);
  assert.equal(retryOneReplay.requestId, retryOne.requestId);
  assert.notEqual(retryOne.requestId, original.requestId);
  assert.notEqual(retryTwo.requestId, retryOne.requestId);
  assert.notEqual(retryOne.idempotencyKey, original.idempotencyKey);
  assert.throws(
    () => broker.createRequest({
      toolId: 'file.write', input, context: { ...context, effectRetryGeneration: -1 },
    }),
    error => error?.code === M2ToolBrokerErrorCode.INPUT_INVALID,
  );
  assert.throws(
    () => broker.createRequest({
      toolId: 'local.math', input: { query: '2+2' },
      context: { ...context, effectRetryGeneration: 1 },
    }),
    error => error?.code === M2ToolBrokerErrorCode.INPUT_INVALID,
  );
});

test('real SQLite stores one NFC input before digest and effect-binding derivation', () => {
  const database = realAuthorityDatabase();
  const repository = new M2ToolAuthorityRepository(database, { clock: () => 1_777_000_000_000 });
  const toolBroker = createM2ToolBroker({
    repository,
    clock: () => 1_777_000_000_000,
  });
  try {
    const decomposedContent = 'Cafe\u0301\n';
    const fileRequest = toolBroker.createRequest({
      toolId: 'file.write',
      input: { path: 'notes.txt', content: decomposedContent },
      context,
    });
    assert.equal(fileRequest.input.content, 'Café\n');
    assert.equal(fileRequest.effectBinding.payloadDigest, digest(Buffer.from('Café\n', 'utf8')));
    assert.equal(fileRequest.effectBinding.payloadBytes, Buffer.byteLength('Café\n', 'utf8'));
    assert.deepEqual(repository.getToolRequest(fileRequest.requestId), fileRequest);
    const fileReplay = toolBroker.createRequest({
      toolId: 'file.write',
      input: { path: 'notes.txt', content: 'Café\n' },
      context,
    });
    assert.equal(fileReplay.requestId, fileRequest.requestId);

    const webContext = { ...context, userMessageId: 205 };
    const webRequest = toolBroker.createRequest({
      toolId: 'web.search',
      input: { query: 'Cafe\u0301 IntentSmith' },
      context: webContext,
    });
    assert.equal(webRequest.input.query, 'Café IntentSmith');
    assert.equal(
      webRequest.effectBinding.target.url,
      'https://html.duckduckgo.com/html/?q=Caf%C3%A9%20IntentSmith',
    );
    assert.deepEqual(repository.getToolRequest(webRequest.requestId), webRequest);
  } finally {
    database.close();
  }
});

await testAsync('pure local tool executes once and returns schema-validated ToolResult', async () => {
  let calls = 0;
  const toolBroker = broker({ clock: clockFrom([100, 101, 102, 103]) });
  const execution = await toolBroker.execute({
    toolId: 'local.math',
    input: { query: '2+2' },
    context,
    invoke: async signal => {
      calls += 1;
      assert.equal(signal.aborted, false);
      return { success: true, data: { subtype: 'math', expression: '2+2', result: 4 } };
    },
  });
  assert.equal(calls, 1);
  assert.equal(execution.result.status, 'ok');
  assert.equal(execution.result.output.result, 4);
  assert.equal(validateM2ToolResult(execution.result).valid, true);
});

await testAsync('direct provider receives the same NFC input owned by ToolRequest', async () => {
  let invokedInput = null;
  const toolBroker = broker({ clock: clockFrom([100, 101, 102, 103]) });
  const execution = await toolBroker.execute({
    toolId: 'local.math',
    input: { query: 'Cafe\u0301' },
    context: { ...context, userMessageId: 206 },
    invoke: async (_signal, authorityInput) => {
      invokedInput = authorityInput;
      return {
        success: true,
        data: { subtype: 'math', expression: authorityInput.query, result: 4 },
      };
    },
  });
  assert.deepEqual(invokedInput, { query: 'Café' });
  assert.deepEqual(execution.request.input, invokedInput);
  assert.equal(execution.result.output.expression, 'Café');
});

await testAsync('invalid direct output becomes typed error, never success', async () => {
  const toolBroker = broker({ clock: clockFrom([100, 101, 102, 103]) });
  const execution = await toolBroker.execute({
    toolId: 'local.math',
    input: { query: '2+2' },
    context,
    invoke: async () => ({ success: true, data: { subtype: 'math', result: 'four' } }),
  });
  assert.equal(execution.result.status, 'error');
  assert.equal(execution.result.error.code, M2_TOOL_ERROR_CODE.OUTPUT_INVALID);
});

await testAsync('two SQLite brokers have one live-claim winner, one provider call and exact replay', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'm2-tool-claim-race-'));
  const databasePath = path.join(directory, 'authority.sqlite');
  realAuthorityDatabase(databasePath).close();
  const databaseA = openAuthorityDatabase(databasePath);
  const databaseB = openAuthorityDatabase(databasePath);
  const liveness = Object.freeze({ isProvablyDead() { return false; } });
  const repositoryA = new M2ToolAuthorityRepository(databaseA, {
    clock: () => 1_777_000_300_000,
    executionLiveness: liveness,
  });
  const repositoryB = new M2ToolAuthorityRepository(databaseB, {
    clock: () => 1_777_000_300_000,
    executionLiveness: liveness,
  });
  const providerStarted = deferred();
  const providerRelease = deferred();
  let providerCalls = 0;
  const brokerA = createM2ToolBroker({
    repository: repositoryA,
    clock: () => 1_777_000_300_000,
    executionOwnerFactory: () => executionOwner('a', 101),
  });
  const brokerB = createM2ToolBroker({
    repository: repositoryB,
    clock: () => 1_777_000_300_000,
    executionOwnerFactory: () => executionOwner('b', 102),
  });
  const raceContext = { ...context, userMessageId: 301 };
  const invoke = async (_signal, authorityInput) => {
    providerCalls += 1;
    providerStarted.resolve();
    await providerRelease.promise;
    return {
      success: true,
      data: { subtype: 'math', expression: authorityInput.query, result: 4 },
    };
  };
  try {
    const winnerPromise = brokerA.execute({
      toolId: 'local.math',
      input: { query: '2+2' },
      context: raceContext,
      invoke,
    });
    await providerStarted.promise;
    const loser = await brokerB.execute({
      toolId: 'local.math',
      input: { query: '2+2' },
      context: raceContext,
      invoke: async () => assert.fail('claim loser must not invoke the provider'),
    });
    assert.equal(loser.state, 'in_progress');
    assert.equal(loser.result, null);
    assert.equal(providerCalls, 1);
    providerRelease.resolve();
    const winner = await winnerPromise;
    const replay = await brokerB.execute({
      toolId: 'local.math',
      input: { query: '2+2' },
      context: raceContext,
      invoke: async () => assert.fail('terminal replay must not invoke the provider'),
    });
    assert.deepEqual(replay.result, winner.result);
    assert.deepEqual(replay.value, winner.value);
    assert.equal(providerCalls, 1);
    assert.deepEqual(databaseA.prepare(`
      SELECT
        (SELECT count(*) FROM tool_v1_execution_claims) AS claims,
        (SELECT count(*) FROM tool_v1_results) AS results
    `).get(), { claims: 1, results: 1 });
  } finally {
    providerRelease.resolve();
    databaseA.close();
    databaseB.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

await testAsync('unknown liveness blocks takeover; proven death advances generation and fences stale owner', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'm2-tool-claim-takeover-'));
  const databasePath = path.join(directory, 'authority.sqlite');
  realAuthorityDatabase(databasePath).close();
  const databaseA = openAuthorityDatabase(databasePath);
  const databaseB = openAuthorityDatabase(databasePath);
  const clock = () => 1_777_000_400_000;
  const ownerA = executionOwner('c', 103);
  const ownerB = executionOwner('d', 104);
  const repositoryA = new M2ToolAuthorityRepository(databaseA, {
    clock,
    executionLiveness: { isProvablyDead() { return false; } },
  });
  const seeder = createM2ToolBroker({
    repository: repositoryA,
    clock,
    executionOwnerFactory: () => ownerA,
  });
  const takeoverContext = { ...context, userMessageId: 302 };
  try {
    const request = seeder.createRequest({
      toolId: 'local.math',
      input: { query: '2+2' },
      context: takeoverContext,
    });
    const staleClaim = repositoryA.claimToolExecution({
      requestId: request.requestId,
      executionOwner: ownerA,
    }).claim;
    const unknownRepository = new M2ToolAuthorityRepository(databaseB, {
      clock,
      executionLiveness: { isProvablyDead() { return false; } },
    });
    const unknownBroker = createM2ToolBroker({
      repository: unknownRepository,
      clock,
      executionOwnerFactory: () => ownerB,
    });
    let providerCalls = 0;
    const unknown = await unknownBroker.execute({
      toolId: 'local.math',
      input: { query: '2+2' },
      context: takeoverContext,
      invoke: async () => { providerCalls += 1; },
    });
    assert.equal(unknown.state, 'in_progress');
    assert.equal(providerCalls, 0);
    assert.equal(unknownRepository.getToolExecutionClaim(request.requestId).generation, 1);

    const takeoverRepository = new M2ToolAuthorityRepository(databaseB, {
      clock,
      executionLiveness: { isProvablyDead() { return true; } },
    });
    const takeoverBroker = createM2ToolBroker({
      repository: takeoverRepository,
      clock,
      executionOwnerFactory: () => ownerB,
    });
    const takeover = await takeoverBroker.execute({
      toolId: 'local.math',
      input: { query: '2+2' },
      context: takeoverContext,
      invoke: async (_signal, authorityInput) => {
        providerCalls += 1;
        return {
          success: true,
          data: { subtype: 'math', expression: authorityInput.query, result: 4 },
        };
      },
    });
    assert.equal(takeover.result.status, 'ok');
    assert.equal(providerCalls, 1);
    assert.equal(takeoverRepository.getToolExecutionClaim(request.requestId).generation, 2);
    assert.throws(
      () => repositoryA.recordToolResult(takeover.result, { executionClaim: staleClaim }),
      error => error.code === M2ToolAuthorityErrorCode.RESULT_REQUEST_MISMATCH,
    );
    assert.deepEqual(repositoryA.getToolResult(request.requestId), takeover.result);
    assert.throws(
      () => takeoverRepository.claimToolExecution({
        requestId: request.requestId,
        executionOwner: executionOwner('e', 105),
      }),
      error => error.code === M2ToolAuthorityErrorCode.RESULT_CONFLICT,
    );
  } finally {
    databaseA.close();
    databaseB.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

suite('M2 tool broker — effect translation and fail-closed boundary');

await testAsync('network tool without exact adapter never invokes legacy handler', async () => {
  let calls = 0;
  const toolBroker = broker({ clock: clockFrom([100, 101, 102, 103]) });
  const execution = await toolBroker.execute({
    toolId: 'web.search',
    input: { query: 'IntentSmith' },
    context,
    invoke: async () => { calls += 1; return { results: [] }; },
  });
  assert.equal(calls, 0);
  assert.equal(execution.result.status, 'error');
  assert.equal(execution.result.error.code, M2_TOOL_ERROR_CODE.EFFECT_AUTHORITY_UNAVAILABLE);
  assert.equal(execution.result.effectRequestId, null);
});

await testAsync('forged adapter authority is invalidated into one durable Tool error', async () => {
  let calls = 0;
  let captured;
  const repository = memoryRepository();
  const toolBroker = createM2ToolBroker({
    repository,
    clock: clockFrom([100, 101, 102, 103]),
    effectAdapter: {
      async prepare(input) {
        captured = input.request;
        return { state: 'approval_required', effectRequestId: `effect:${'a'.repeat(64)}` };
      },
    },
  });
  const execution = await toolBroker.execute({
      toolId: 'web.scrape',
      input: { url: 'https://example.test/page', query: 'test', maxLength: 5_000 },
      context,
      invoke: async () => { calls += 1; return {}; },
    });
  assert.equal(calls, 0);
  assert.equal(Object.isFrozen(captured), true);
  assert.equal(captured.requiredEffectKind, 'network.request');
  assert.equal(execution.result.status, 'error');
  assert.equal(execution.result.error.code, 'TOOL_EFFECT_TRANSLATION_INVALID');
  assert.deepEqual(repository.getToolResult(captured.requestId), execution.result);
});

await testAsync('canonical exact network EffectRequest can return approval-required without connect', async () => {
  let calls = 0;
  const toolBroker = broker({
    clock: clockFrom([100, 101, 102, 103]),
    effectAdapter: {
      async prepare({ request }) {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(request.input.query)}`;
        const effectRequest = effectRequestForTool(request, {
          kind: 'network.request',
          target: {
            type: 'network',
            url,
            origin: 'https://html.duckduckgo.com',
            method: 'GET',
            redirectPolicy: 'deny',
            dnsPolicy: 'public-only',
          },
          capability: 'network.http.get',
          riskClass: 'network',
        });
        return { state: 'approval_required', effectRequestId: effectRequest.effectId, effectRequest };
      },
    },
  });
  const execution = await toolBroker.execute({
    toolId: 'web.search',
    input: { query: 'IntentSmith' },
    context,
    invoke: async () => { calls += 1; },
  });
  assert.equal(calls, 0);
  assert.equal(execution.state, 'approval_required');
  assert.equal(execution.result, null);
  assert.match(execution.effectRequestId, /^effect:/);
});

await testAsync('production file adapter translates file.write to canonical filesystem runtime', async () => {
  let captured;
  const adapter = createM2ToolEffectAdapter({
    effectRuntime: {
      async requestFilesystemWrite(input) {
        captured = input;
        const payload = Buffer.from(input.content, 'utf8');
        const runId = `run:${sha256(input.conversationId)}`;
        const effectRequest = {
          contract: 'EffectRequest',
          version: 1,
          effectId: `effect:${'b'.repeat(64)}`,
          runId,
          parentEffectId: null,
          actor: { type: 'user', id: input.subjectId },
          origin: {
            surface: 'studio',
            sessionId: `session:${sha256(input.sessionId)}`,
            conversationId: `conversation:${sha256(input.conversationId)}`,
            projectId: input.projectId,
          },
          kind: 'fs.write',
          target: {
            type: 'filesystem',
            canonicalRoot: input.projectRoot,
            relativePath: input.relativePath,
            resolvedRealpath: `${input.projectRoot}/${input.relativePath}`,
          },
          payloadDigest: digest(payload),
          payloadBytes: payload.length,
          workspaceRevision: 'wsr1:test-revision',
          requiredCapability: 'project.fs.write',
          riskClass: 'write',
          timeoutMs: 120_000,
          idempotencyKey: `operation:${sha256(input.operationId)}`,
          approvalGrantId: null,
          createdAt: '2026-08-24T08:00:00.000Z',
        };
        return {
          state: 'approval_required',
          effectId: effectRequest.effectId,
          request: effectRequest,
        };
      },
    },
  });
  const toolBroker = broker({
    clock: clockFrom([100, 101, 102, 103]),
    effectAdapter: adapter,
  });
  const execution = await toolBroker.execute({
    toolId: 'file.write',
    input: { path: 'src/answer.js', content: 'export const answer = 42;\n' },
    context,
    invoke: async () => assert.fail('legacy writer must not run'),
  });
  assert.equal(captured.projectId, 7);
  assert.equal(captured.projectRoot, '/workspace/project-a');
  assert.equal(captured.relativePath, 'src/answer.js');
  assert.equal(captured.content, 'export const answer = 42;\n');
  assert.equal(execution.state, 'approval_required');
  assert.equal(execution.result, null);
  assert.equal(execution.effectRequestId, `effect:${'b'.repeat(64)}`);
});

await testAsync('network search query is not misrepresented as one exact network effect', async () => {
  let runtimeCalls = 0;
  const adapter = createM2ToolEffectAdapter({
    effectRuntime: { async requestFilesystemWrite() { runtimeCalls += 1; } },
  });
  const toolBroker = broker({
    clock: clockFrom([100, 101, 102, 103]),
    effectAdapter: adapter,
  });
  const execution = await toolBroker.execute({
    toolId: 'web.search',
    input: { query: 'IntentSmith' },
    context,
    invoke: async () => assert.fail('network handler must not run'),
  });
  assert.equal(runtimeCalls, 0);
  assert.equal(execution.result.error.code, 'TOOL_EFFECT_TRANSLATION_INVALID');
});

await testAsync('pending file effect has no ToolResult; canonical terminal retry commits success once', async () => {
  const repository = memoryRepository();
  let adapterCalls = 0;
  const toolBroker = createM2ToolBroker({
    repository,
    clock: clockFrom([100, 101, 102, 103, 104, 105, 106, 107]),
    effectAdapter: {
      async prepare({ request }) {
        adapterCalls += 1;
        const payload = Buffer.from(request.input.content, 'utf8');
        const effectRequest = effectRequestForTool(request, {
          kind: 'fs.write',
          target: {
            type: 'filesystem',
            canonicalRoot: '/workspace/project-a',
            relativePath: request.input.path,
            resolvedRealpath: `/workspace/project-a/${request.input.path}`,
          },
          payload,
          capability: 'project.fs.write',
          riskClass: 'write',
        });
        return { state: 'approval_required', effectRequestId: effectRequest.effectId, effectRequest };
      },
    },
  });
  const input = { path: 'src/answer.js', content: 'export const answer = 42;\n' };
  const pending = await toolBroker.execute({ toolId: 'file.write', input, context });
  assert.equal(pending.state, 'approval_required');
  assert.equal(pending.result, null);
  assert.equal(repository.getToolResult(pending.request.requestId), null);

  const linked = repository.getEffectLinkByEffect(pending.effectRequestId);
  repository._recordEffectResult(succeededEffectResult(linked.effectRequest));
  const terminal = toolBroker.settleEffect({ effectId: pending.effectRequestId, context });
  assert.equal(terminal.result.status, 'ok');
  assert.equal(terminal.result.effectRequestId, terminal.value.effectId);
  assert.equal(repository.getToolResult(terminal.request.requestId).status, 'ok');

  const replay = await toolBroker.execute({ toolId: 'file.write', input, context });
  assert.equal(replay.result.status, 'ok');
  assert.equal(adapterCalls, 1);
});

await testAsync('canonical failed EffectResult becomes one linked failed ToolResult', async () => {
  const toolBroker = broker({
    clock: clockFrom([100, 101, 102, 103]),
    effectAdapter: {
      async prepare({ request }) {
        const payload = Buffer.from(request.input.content, 'utf8');
        const effectRequest = effectRequestForTool(request, {
          kind: 'fs.write',
          target: {
            type: 'filesystem',
            canonicalRoot: '/workspace/project-a',
            relativePath: request.input.path,
            resolvedRealpath: `/workspace/project-a/${request.input.path}`,
          },
          payload,
          capability: 'project.fs.write',
          riskClass: 'write',
        });
        const effectResult = {
          ...succeededEffectResult(effectRequest),
          terminalStatus: 'failed',
          changes: {
            paths: [],
            beforeDigest: null,
            afterDigest: null,
            diffArtifact: null,
          },
          outputDigest: null,
          errorCode: 'EFFECT_TEST_FAILED',
        };
        return {
          state: 'terminal',
          effectRequestId: effectRequest.effectId,
          effectRequest,
          effectResult,
          output: null,
        };
      },
    },
  });
  const execution = await toolBroker.execute({
    toolId: 'file.write',
    input: { path: 'src/fail.js', content: 'failure\n' },
    context,
  });
  assert.equal(execution.result.status, 'error');
  assert.equal(execution.result.error.code, 'EFFECT_TEST_FAILED');
  assert.match(execution.result.effectRequestId, /^effect:/);
});

await testAsync('adapter output cannot forge canonical effect-backed success', async () => {
  const toolBroker = broker({
    clock: clockFrom([100, 101, 102, 103]),
    effectAdapter: {
      async prepare({ request }) {
        const payload = Buffer.from(request.input.content, 'utf8');
        const effectRequest = effectRequestForTool(request, {
          kind: 'fs.write',
          target: {
            type: 'filesystem',
            canonicalRoot: '/workspace/project-a',
            relativePath: request.input.path,
            resolvedRealpath: `/workspace/project-a/${request.input.path}`,
          },
          payload,
          capability: 'project.fs.write',
          riskClass: 'write',
        });
        return {
          state: 'terminal',
          effectRequestId: effectRequest.effectId,
          effectRequest,
          effectResult: succeededEffectResult(effectRequest),
          output: {
            path: '../../forged.txt',
            effectId: `effect:${'0'.repeat(64)}`,
            terminalStatus: 'succeeded',
          },
        };
      },
    },
  });
  const input = { path: 'src/owned.js', content: 'owned\n' };
  const execution = await toolBroker.execute({ toolId: 'file.write', input, context });
  assert.equal(execution.result.status, 'ok');
  assert.deepEqual(execution.result.output, {
    path: input.path,
    effectId: execution.result.effectRequestId,
    terminalStatus: 'succeeded',
  });
  assert.deepEqual(execution.value, execution.result.output);
});

suite('M2 tool broker — timeout, cancellation and invalid registration');

await testAsync('effect adapter throw becomes one durable error terminal', async () => {
  const repository = memoryRepository();
  const toolBroker = createM2ToolBroker({
    repository,
    clock: clockFrom([100, 101, 102, 103]),
    effectAdapter: {
      async prepare() {
        const error = new Error('adapter exploded');
        error.code = 'EFFECT_ADAPTER_THROW';
        throw error;
      },
    },
  });
  const execution = await toolBroker.execute({
    toolId: 'file.write',
    input: { path: 'src/throw.js', content: 'throw\n' },
    context,
  });
  assert.equal(execution.result.status, 'error');
  assert.equal(execution.result.error.code, 'TOOL_EFFECT_PREPARATION_FAILED');
  assert.deepEqual(repository.getToolResult(execution.request.requestId), execution.result);
});

await testAsync('hung effect adapter times out into one durable terminal and is aborted', async () => {
  const repository = memoryRepository();
  let providerSignal;
  const toolBroker = createM2ToolBroker({
    repository,
    clock: clockFrom([100, 101, 102, 103]),
    scheduleTimeout(callback) {
      queueMicrotask(callback);
      return { cancel() {} };
    },
    effectAdapter: {
      async prepare({ signal }) {
        providerSignal = signal;
        return new Promise(() => {});
      },
    },
  });
  const execution = await toolBroker.execute({
    toolId: 'file.write',
    input: { path: 'src/hang.js', content: 'hang\n' },
    context,
    timeoutMs: 1,
  });
  assert.equal(providerSignal.aborted, true);
  assert.equal(execution.result.status, 'timeout');
  assert.equal(execution.result.lateCompletionRejected, true);
  assert.deepEqual(repository.getToolResult(execution.request.requestId), execution.result);
});

await testAsync('caller cancellation during effect preparation commits cancelled terminal', async () => {
  const repository = memoryRepository();
  const controller = new AbortController();
  let providerSignal;
  const toolBroker = createM2ToolBroker({
    repository,
    clock: clockFrom([100, 101, 102, 103]),
    effectAdapter: {
      async prepare({ signal }) {
        providerSignal = signal;
        queueMicrotask(() => controller.abort('user'));
        return new Promise(() => {});
      },
    },
  });
  const execution = await toolBroker.execute({
    toolId: 'file.write',
    input: { path: 'src/cancel.js', content: 'cancel\n' },
    context: { ...context, signal: controller.signal },
  });
  assert.equal(providerSignal.aborted, true);
  assert.equal(execution.result.status, 'cancelled');
  assert.equal(execution.result.error.code, M2_TOOL_ERROR_CODE.CANCELLED);
  assert.deepEqual(repository.getToolResult(execution.request.requestId), execution.result);
});

await testAsync('real filesystem adapter timeout and cancel create no late effect authority', async () => {
  for (const mode of ['timeout', 'cancel']) {
    const directory = mkdtempSync(path.join(tmpdir(), `m2-tool-late-${mode}-`));
    const projectRoot = path.join(directory, 'project');
    mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
    const database = realAuthorityDatabase();
    const observationStarted = { resolve: null, promise: null };
    observationStarted.promise = new Promise(resolve => { observationStarted.resolve = resolve; });
    const observationCompletion = { resolve: null, promise: null };
    observationCompletion.promise = new Promise(resolve => { observationCompletion.resolve = resolve; });
    const runtime = createEffectFileRuntime({
      database,
      clock: () => 1_777_000_000_000,
      workspaceAuthority: {
        async observe() {
          observationStarted.resolve();
          return observationCompletion.promise;
        },
      },
    });
    const repository = new M2ToolAuthorityRepository(database, {
      clock: () => 1_777_000_000_000,
    });
    let timeoutCallback;
    const controller = new AbortController();
    const toolBroker = createM2ToolBroker({
      repository,
      clock: () => 1_777_000_000_000,
      scheduleTimeout(callback) {
        timeoutCallback = callback;
        return { cancel() {} };
      },
      effectAdapter: createM2ToolEffectAdapter({ effectRuntime: runtime }),
    });
    const realContext = {
      ...context,
      sessionId: `studio-${mode}`,
      conversationId: `conversation-${mode}`,
      userMessageId: mode === 'timeout' ? 201 : 202,
      project: { id: 7, path: projectRoot },
      signal: controller.signal,
    };
    try {
      const executionPromise = toolBroker.execute({
        toolId: 'file.write',
        input: { path: `src/${mode}.js`, content: `${mode}\n` },
        context: realContext,
        timeoutMs: 1,
      });
      await observationStarted.promise;
      if (mode === 'timeout') timeoutCallback();
      else controller.abort('user');
      const execution = await executionPromise;
      assert.equal(execution.result.status, mode === 'timeout' ? 'timeout' : 'cancelled');

      observationCompletion.resolve({
        canonicalRoot: realpathSync(projectRoot),
        workspaceRevision: 'wsr1:late-observation',
      });
      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => setImmediate(resolve));

      await assert.rejects(
        runtime.requestFilesystemWrite({
          sessionId: realContext.conversationId,
          conversationId: realContext.conversationId,
          subjectId: realContext.authenticatedSubject.actorId,
          operationId: execution.request.requestId,
          projectId: 7,
          projectRoot,
          relativePath: `src/forged-after-${mode}.js`,
          content: 'forged after terminal\n',
        }),
        error => /M2_TOOL_EFFECT_OPERATION_INVALIDATED/.test(
          error?.details?.cause || error?.message || '',
        ),
      );

      assert.deepEqual(database.prepare(`
        SELECT
          (SELECT count(*) FROM m2_effect_requests) AS effectRequests,
          (SELECT count(*) FROM m2_pending_effect_payloads) AS pending,
          (SELECT count(*) FROM m2_tool_effect_links) AS links,
          (SELECT count(*) FROM m2_effect_results) AS effectResults
      `).get(), { effectRequests: 0, pending: 0, links: 0, effectResults: 0 });
      assert.equal(existsSync(path.join(projectRoot, `src/${mode}.js`)), false);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

await testAsync('timeout and cancel after durable prepare invalidate the exact pending effect', async () => {
  for (const mode of ['timeout', 'cancel']) {
    const directory = mkdtempSync(path.join(tmpdir(), `m2-tool-post-register-${mode}-`));
    const projectRoot = path.join(directory, 'project');
    mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
    const database = realAuthorityDatabase();
    const clock = () => 1_777_000_075_000;
    const runtime = createEffectFileRuntime({
      database,
      clock,
      workspaceAuthority: {
        async observe() {
          return {
            canonicalRoot: realpathSync(projectRoot),
            workspaceRevision: 'wsr1:post-register-race',
          };
        },
      },
    });
    const canonicalAdapter = createM2ToolEffectAdapter({ effectRuntime: runtime });
    const prepared = deferred();
    const release = deferred();
    let durableEffectId = null;
    let timeoutCallback = null;
    const controller = new AbortController();
    const toolBroker = createM2ToolBroker({
      repository: new M2ToolAuthorityRepository(database, { clock }),
      clock,
      scheduleTimeout(callback) {
        timeoutCallback = callback;
        return { cancel() {} };
      },
      effectAdapter: {
        async prepare(args) {
          const authority = await canonicalAdapter.prepare(args);
          durableEffectId = authority.effectRequestId;
          prepared.resolve();
          await release.promise;
          return authority;
        },
      },
    });
    const realContext = {
      ...context,
      sessionId: `studio-post-register-${mode}`,
      conversationId: `conversation-post-register-${mode}`,
      userMessageId: mode === 'timeout' ? 221 : 222,
      project: { id: 7, path: projectRoot },
      signal: controller.signal,
    };
    try {
      const executionPromise = toolBroker.execute({
        toolId: 'file.write',
        input: { path: `src/post-${mode}.js`, content: 'must not run\n' },
        context: realContext,
        timeoutMs: 1,
      });
      await prepared.promise;
      if (mode === 'timeout') timeoutCallback();
      else controller.abort('user');
      const execution = await executionPromise;
      assert.equal(execution.result.status, mode === 'timeout' ? 'timeout' : 'cancelled');
      assert.deepEqual(database.prepare(`
        SELECT
          (SELECT count(*) FROM m2_effect_requests) AS effectRequests,
          (SELECT count(*) FROM m2_effect_invalidations) AS effectInvalidations,
          (SELECT count(*) FROM m2_tool_effect_operation_invalidations) AS operationInvalidations,
          (SELECT count(*) FROM m2_pending_effect_payloads) AS pending,
          (SELECT count(*) FROM m2_tool_effect_links) AS links,
          (SELECT count(*) FROM tool_v1_results) AS toolResults
      `).get(), {
        effectRequests: 1,
        effectInvalidations: 1,
        operationInvalidations: 1,
        pending: 0,
        links: 0,
        toolResults: 1,
      });
      await assert.rejects(
        runtime.approveFilesystemWrite({
          effectId: durableEffectId,
          conversationId: realContext.conversationId,
          subjectId: realContext.authenticatedSubject.actorId,
        }),
        error => error.code === 'EFFECT_INVALIDATED',
      );
      release.resolve();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(existsSync(path.join(projectRoot, `src/post-${mode}.js`)), false);
    } finally {
      release.resolve();
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

await testAsync('adapter throw or hidden return after prepare cannot leave approvable authority', async () => {
  for (const mode of ['throw', 'hidden']) {
    const directory = mkdtempSync(path.join(tmpdir(), `m2-tool-hidden-${mode}-`));
    const projectRoot = path.join(directory, 'project');
    mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
    const database = realAuthorityDatabase();
    const clock = () => 1_777_000_085_000;
    const runtime = createEffectFileRuntime({
      database,
      clock,
      workspaceAuthority: {
        async observe() {
          return {
            canonicalRoot: realpathSync(projectRoot),
            workspaceRevision: 'wsr1:hidden-adapter-authority',
          };
        },
      },
    });
    const canonicalAdapter = createM2ToolEffectAdapter({ effectRuntime: runtime });
    let durableEffectId = null;
    const toolBroker = createM2ToolBroker({
      repository: new M2ToolAuthorityRepository(database, { clock }),
      clock,
      effectAdapter: {
        async prepare(args) {
          const authority = await canonicalAdapter.prepare(args);
          durableEffectId = authority.effectRequestId;
          if (mode === 'throw') {
            throw Object.assign(new Error('post-registration adapter failure'), {
              code: 'EFFECT_ADAPTER_POST_REGISTER_THROW',
            });
          }
          return {};
        },
      },
    });
    const realContext = {
      ...context,
      sessionId: `studio-hidden-${mode}`,
      conversationId: `conversation-hidden-${mode}`,
      userMessageId: mode === 'throw' ? 223 : 224,
      project: { id: 7, path: projectRoot },
    };
    try {
      const execution = await toolBroker.execute({
        toolId: 'file.write',
        input: { path: `src/hidden-${mode}.js`, content: 'must not run\n' },
        context: realContext,
      });
      assert.equal(execution.result.status, 'error');
      assert.equal(
        execution.result.error.code,
        mode === 'throw'
          ? 'TOOL_EFFECT_PREPARATION_FAILED'
          : 'TOOL_EFFECT_TRANSLATION_INVALID',
      );
      assert.deepEqual(database.prepare(`
        SELECT
          (SELECT count(*) FROM m2_effect_requests) AS effectRequests,
          (SELECT count(*) FROM m2_effect_invalidations) AS effectInvalidations,
          (SELECT count(*) FROM m2_tool_effect_operation_invalidations) AS operationInvalidations,
          (SELECT count(*) FROM m2_pending_effect_payloads) AS pending,
          (SELECT count(*) FROM m2_tool_effect_links) AS links,
          (SELECT count(*) FROM tool_v1_results) AS toolResults
      `).get(), {
        effectRequests: 1,
        effectInvalidations: 1,
        operationInvalidations: 1,
        pending: 0,
        links: 0,
        toolResults: 1,
      });
      await assert.rejects(
        runtime.approveFilesystemWrite({
          effectId: durableEffectId,
          conversationId: realContext.conversationId,
          subjectId: realContext.authenticatedSubject.actorId,
        }),
        error => error.code === 'EFFECT_INVALIDATED',
      );
      assert.equal(existsSync(path.join(projectRoot, `src/hidden-${mode}.js`)), false);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

await testAsync('restart retry projects the first operation closure after ToolResult commit failure', async () => {
  for (const mode of ['timeout', 'cancel', 'invalid']) {
    const database = realAuthorityDatabase();
    let nowMs = 1_777_000_090_000;
    const clock = () => nowMs++;
    const repository = new M2ToolAuthorityRepository(database, {
      clock,
      executionLiveness: { isProvablyDead() { return true; } },
    });
    const record = repository.recordToolResult.bind(repository);
    let failCommit = true;
    repository.recordToolResult = (...args) => {
      if (failCommit) throw new Error('injected ToolResult commit failure');
      return record(...args);
    };
    const controller = new AbortController();
    let adapterCalls = 0;
    const toolBroker = createM2ToolBroker({
      repository,
      clock,
      scheduleTimeout(callback) {
        if (mode === 'timeout') queueMicrotask(callback);
        return { cancel() {} };
      },
      effectAdapter: {
        async prepare() {
          adapterCalls += 1;
          if (mode === 'cancel') queueMicrotask(() => controller.abort('user'));
          if (mode === 'invalid') return {};
          return new Promise(() => {});
        },
      },
    });
    const retryContext = {
      ...context,
      sessionId: `studio-retry-closure-${mode}`,
      conversationId: `conversation-retry-closure-${mode}`,
      userMessageId: mode === 'timeout' ? 226 : mode === 'cancel' ? 227 : 228,
      project: { id: 7, path: '/workspace/project-a' },
      signal: controller.signal,
    };
    const input = { path: `src/retry-${mode}.js`, content: 'never executes\n' };
    try {
      await assert.rejects(
        toolBroker.execute({ toolId: 'file.write', input, context: retryContext, timeoutMs: 1 }),
        error => error.code === M2ToolBrokerErrorCode.RESULT_UNCOMMITTED,
      );
      assert.equal(database.prepare(`
        SELECT count(*) AS count FROM m2_tool_effect_operation_invalidations
      `).get().count, 1);
      assert.equal(database.prepare('SELECT count(*) AS count FROM tool_v1_results').get().count, 0);

      failCommit = false;
      const recovered = await toolBroker.execute({
        toolId: 'file.write',
        input,
        context: retryContext,
        timeoutMs: 1,
      });
      assert.equal(
        recovered.result.status,
        mode === 'timeout' ? 'timeout' : mode === 'cancel' ? 'cancelled' : 'error',
      );
      assert.equal(
        recovered.result.error.code,
        mode === 'timeout'
          ? M2_TOOL_ERROR_CODE.TIMEOUT
          : mode === 'cancel'
            ? M2_TOOL_ERROR_CODE.CANCELLED
            : 'TOOL_EFFECT_TRANSLATION_INVALID',
      );
      assert.equal(adapterCalls, 1);
      const latestClaim = database.prepare(`
        SELECT claimed_at_ms FROM tool_v1_execution_claims
        ORDER BY generation DESC LIMIT 1
      `).get();
      const operationInvalidation = database.prepare(`
        SELECT invalidated_at_ms FROM m2_tool_effect_operation_invalidations
      `).get();
      assert.equal(Date.parse(recovered.result.startedAt), latestClaim.claimed_at_ms);
      assert.equal(Date.parse(recovered.result.completedAt), latestClaim.claimed_at_ms);
      assert.equal(operationInvalidation.invalidated_at_ms < latestClaim.claimed_at_ms, true);
      assert.deepEqual(database.prepare(`
        SELECT
          (SELECT count(*) FROM tool_v1_results) AS toolResults,
          (SELECT count(*) FROM m2_tool_effect_operation_invalidations) AS operationInvalidations,
          (SELECT count(*) FROM tool_v1_execution_claims) AS claims
      `).get(), { toolResults: 1, operationInvalidations: 1, claims: 2 });
    } finally {
      database.close();
    }
  }
});

await testAsync('operation tombstone raced during adapter prepare cannot become approval-required', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'm2-tool-prepare-tombstone-race-'));
  const projectRoot = path.join(directory, 'project');
  mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  const database = realAuthorityDatabase();
  const clock = () => 1_777_000_093_000;
  const runtime = createEffectFileRuntime({
    database,
    clock,
    workspaceAuthority: {
      async observe() {
        return {
          canonicalRoot: realpathSync(projectRoot),
          workspaceRevision: 'wsr1:prepare-tombstone-race',
        };
      },
    },
  });
  const productionAdapter = createM2ToolEffectAdapter({ effectRuntime: runtime });
  let durableEffectId = null;
  const toolBroker = createM2ToolBroker({
    repository: new M2ToolAuthorityRepository(database, { clock }),
    clock,
    effectAdapter: {
      async prepare(args) {
        const prepared = await productionAdapter.prepare(args);
        durableEffectId = prepared.effectRequestId;
        database.prepare(`
          INSERT INTO m2_tool_effect_operation_invalidations (
            source_tool_request_id, tool_request_digest, run_id, project_id,
            effect_idempotency_key, reason_code, invalidated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          args.request.requestId,
          computeM2ToolRequestDigest(args.request),
          args.request.runId,
          args.request.origin.projectId,
          expectedM2EffectOperationKey(args.request),
          'TOOL_EFFECT_PREPARATION_TIMEOUT',
          clock(),
        );
        return prepared;
      },
    },
  });
  const raceContext = {
    ...context,
    sessionId: 'studio-prepare-tombstone-race',
    conversationId: 'conversation-prepare-tombstone-race',
    userMessageId: 229,
    project: { id: 7, path: projectRoot },
  };
  try {
    const execution = await toolBroker.execute({
      toolId: 'file.write',
      input: { path: 'src/race.js', content: 'must not execute\n' },
      context: raceContext,
    });
    assert.equal(execution.state, undefined);
    assert.equal(execution.result.status, 'timeout');
    assert.equal(execution.result.error.code, M2_TOOL_ERROR_CODE.TIMEOUT);
    assert.equal(execution.result.lateCompletionRejected, true);
    assert.deepEqual(database.prepare(`
      SELECT
        (SELECT count(*) FROM m2_tool_effect_links) AS links,
        (SELECT count(*) FROM m2_pending_effect_payloads) AS pending,
        (SELECT count(*) FROM m2_approval_grants) AS grants,
        (SELECT count(*) FROM m2_effect_invalidations) AS effectInvalidations,
        (SELECT count(*) FROM m2_tool_effect_operation_invalidations) AS operationInvalidations,
        (SELECT count(*) FROM tool_v1_results) AS toolResults
    `).get(), {
      links: 0,
      pending: 0,
      grants: 0,
      effectInvalidations: 1,
      operationInvalidations: 1,
      toolResults: 1,
    });
    await assert.rejects(
      runtime.approveFilesystemWrite({
        effectId: durableEffectId,
        conversationId: raceContext.conversationId,
        subjectId: raceContext.authenticatedSubject.actorId,
      }),
      error => error.code === 'EFFECT_INVALIDATED',
    );
    assert.equal(existsSync(path.join(projectRoot, 'src/race.js')), false);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

await testAsync('standalone effect invalidation raced during adapter prepare commits one durable terminal', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'm2-tool-effect-invalidation-race-'));
  const projectRoot = path.join(directory, 'project');
  mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  const database = realAuthorityDatabase();
  const clock = () => 1_777_000_094_000;
  const runtime = createEffectFileRuntime({
    database,
    clock,
    workspaceAuthority: {
      async observe() {
        return {
          canonicalRoot: realpathSync(projectRoot),
          workspaceRevision: 'wsr1:effect-invalidation-race',
        };
      },
    },
  });
  const productionAdapter = createM2ToolEffectAdapter({ effectRuntime: runtime });
  const repository = new M2ToolAuthorityRepository(database, { clock });
  let adapterCalls = 0;
  let durableEffectId = null;
  const toolBroker = createM2ToolBroker({
    repository,
    clock,
    effectAdapter: {
      async prepare(args) {
        adapterCalls += 1;
        const prepared = await productionAdapter.prepare(args);
        durableEffectId = prepared.effectRequestId;
        database.prepare(`
          INSERT INTO m2_effect_invalidations (
            effect_id, request_digest, source_tool_request_id,
            reason_code, invalidated_at_ms
          ) VALUES (?, ?, ?, ?, ?)
        `).run(
          prepared.effectRequestId,
          computeEffectRequestDigest(prepared.effectRequest),
          args.request.requestId,
          'TOOL_EFFECT_PREPARATION_FAILED',
          clock(),
        );
        return prepared;
      },
    },
  });
  const raceContext = {
    ...context,
    sessionId: 'studio-effect-invalidation-race',
    conversationId: 'conversation-effect-invalidation-race',
    userMessageId: 230,
    project: { id: 7, path: projectRoot },
  };
  const input = { path: 'src/standalone-race.js', content: 'must not execute\n' };
  try {
    const execution = await toolBroker.execute({
      toolId: 'file.write',
      input,
      context: raceContext,
    });
    assert.equal(execution.state, undefined);
    assert.equal(execution.result.status, 'error');
    assert.equal(execution.result.error.code, 'TOOL_EFFECT_PREPARATION_FAILED');
    assert.equal(execution.result.lateCompletionRejected, true);
    assert.deepEqual(repository.getToolEffectInvalidation(execution.request.requestId), {
      requestId: execution.request.requestId,
      effectId: durableEffectId,
      operationKey: expectedM2EffectOperationKey(execution.request),
      reasonCode: 'TOOL_EFFECT_PREPARATION_FAILED',
      invalidatedAtMs: clock(),
    });
    assert.deepEqual(database.prepare(`
      SELECT
        (SELECT count(*) FROM m2_tool_effect_links) AS links,
        (SELECT count(*) FROM m2_pending_effect_payloads) AS pending,
        (SELECT count(*) FROM m2_approval_grants) AS grants,
        (SELECT count(*) FROM m2_effect_results) AS effectResults,
        (SELECT count(*) FROM m2_effect_invalidations) AS effectInvalidations,
        (SELECT count(*) FROM m2_tool_effect_operation_invalidations) AS operationInvalidations,
        (SELECT count(*) FROM tool_v1_results) AS toolResults
    `).get(), {
      links: 0,
      pending: 0,
      grants: 0,
      effectResults: 0,
      effectInvalidations: 1,
      operationInvalidations: 0,
      toolResults: 1,
    });

    const restartedBroker = createM2ToolBroker({
      repository: new M2ToolAuthorityRepository(database, { clock }),
      clock,
      effectAdapter: {
        async prepare() {
          assert.fail('durable terminal replay must not invoke the adapter');
        },
      },
    });
    const replay = await restartedBroker.execute({
      toolId: 'file.write',
      input,
      context: raceContext,
    });
    assert.deepEqual(replay.result, execution.result);
    assert.equal(replay.state, undefined);
    assert.equal(adapterCalls, 1);
    await assert.rejects(
      runtime.approveFilesystemWrite({
        effectId: durableEffectId,
        conversationId: raceContext.conversationId,
        subjectId: raceContext.authenticatedSubject.actorId,
      }),
      error => error.code === 'EFFECT_INVALIDATED',
    );
    assert.equal(existsSync(path.join(projectRoot, 'src/standalone-race.js')), false);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

await testAsync('mutated durable effect bytes under the exact operation tuple are invalidated', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'm2-tool-mutated-durable-effect-'));
  const projectRoot = path.join(directory, 'project');
  mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  const database = realAuthorityDatabase();
  const clock = () => 1_777_000_095_000;
  const runtime = createEffectFileRuntime({
    database,
    clock,
    workspaceAuthority: {
      async observe() {
        return {
          canonicalRoot: realpathSync(projectRoot),
          workspaceRevision: 'wsr1:mutated-durable-effect',
        };
      },
    },
  });
  let durableEffectId = null;
  const toolBroker = createM2ToolBroker({
    repository: new M2ToolAuthorityRepository(database, { clock }),
    clock,
    effectAdapter: {
      async prepare({ request, context: adapterContext, signal }) {
        const forged = await runtime.requestFilesystemWrite({
          sessionId: adapterContext.conversationId,
          conversationId: adapterContext.conversationId,
          subjectId: request.actor.id,
          operationId: request.requestId,
          projectId: request.origin.projectId,
          projectRoot,
          relativePath: 'src/forged.js',
          content: 'forged bytes\n',
          signal,
        });
        durableEffectId = forged.effectId;
        return {
          state: 'approval_required',
          effectRequestId: forged.effectId,
          effectRequest: forged.request,
          effectResult: null,
        };
      },
    },
  });
  const realContext = {
    ...context,
    sessionId: 'studio-mutated-durable-effect',
    conversationId: 'conversation-mutated-durable-effect',
    userMessageId: 225,
    project: { id: 7, path: projectRoot },
  };
  try {
    const execution = await toolBroker.execute({
      toolId: 'file.write',
      input: { path: 'src/owned.js', content: 'owned bytes\n' },
      context: realContext,
    });
    assert.equal(execution.result.status, 'error');
    assert.equal(execution.result.error.code, 'TOOL_EFFECT_TRANSLATION_INVALID');
    assert.deepEqual(database.prepare(`
      SELECT
        (SELECT count(*) FROM m2_effect_requests) AS effectRequests,
        (SELECT count(*) FROM m2_effect_invalidations) AS effectInvalidations,
        (SELECT count(*) FROM m2_tool_effect_operation_invalidations) AS operationInvalidations,
        (SELECT count(*) FROM m2_pending_effect_payloads) AS pending,
        (SELECT count(*) FROM m2_tool_effect_links) AS links,
        (SELECT count(*) FROM tool_v1_results) AS toolResults
    `).get(), {
      effectRequests: 1,
      effectInvalidations: 1,
      operationInvalidations: 1,
      pending: 0,
      links: 0,
      toolResults: 1,
    });
    await assert.rejects(
      runtime.approveFilesystemWrite({
        effectId: durableEffectId,
        conversationId: realContext.conversationId,
        subjectId: realContext.authenticatedSubject.actorId,
      }),
      error => error.code === 'EFFECT_INVALIDATED',
    );
    assert.equal(existsSync(path.join(projectRoot, 'src/owned.js')), false);
    assert.equal(existsSync(path.join(projectRoot, 'src/forged.js')), false);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

await testAsync('canonical pending authority outranks corrupted adapter state metadata', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'm2-tool-state-recovery-'));
  const projectRoot = path.join(directory, 'project');
  mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  const database = realAuthorityDatabase();
  const observed = {
    canonicalRoot: realpathSync(projectRoot),
    workspaceRevision: 'wsr1:stable-tool-state-recovery',
  };
  const runtime = createEffectFileRuntime({
    database,
    clock: () => 1_777_000_100_000,
    workspaceAuthority: { async observe() { return observed; } },
  });
  const canonicalAdapter = createM2ToolEffectAdapter({ effectRuntime: runtime });
  const repository = new M2ToolAuthorityRepository(database, {
    clock: () => 1_777_000_100_000,
  });
  const toolBroker = createM2ToolBroker({
    repository,
    clock: () => 1_777_000_100_000,
    effectAdapter: {
      async prepare(args) {
        const prepared = await canonicalAdapter.prepare(args);
        return {
          ...prepared,
          state: 'unavailable',
          effectRequestId: `effect:${'0'.repeat(64)}`,
        };
      },
    },
  });
  const realContext = {
    ...context,
    sessionId: 'studio-state-recovery',
    conversationId: 'conversation-state-recovery',
    userMessageId: 203,
    project: { id: 7, path: projectRoot },
  };
  const target = path.join(projectRoot, 'src/state-recovery.js');
  try {
    const pending = await toolBroker.execute({
      toolId: 'file.write',
      input: { path: 'src/state-recovery.js', content: 'recovered\n' },
      context: realContext,
    });
    assert.equal(pending.state, 'approval_required');
    assert.equal(pending.result, null);
    assert.notEqual(pending.effectRequestId, `effect:${'0'.repeat(64)}`);
    assert.deepEqual(database.prepare(`
      SELECT
        (SELECT count(*) FROM m2_effect_requests) AS effectRequests,
        (SELECT count(*) FROM m2_pending_effect_payloads) AS pending,
        (SELECT count(*) FROM m2_tool_effect_links) AS links,
        (SELECT count(*) FROM tool_v1_results) AS toolResults
    `).get(), { effectRequests: 1, pending: 1, links: 1, toolResults: 0 });
    assert.equal(existsSync(target), false);

    const effectResult = await runtime.approveFilesystemWrite({
      effectId: pending.effectRequestId,
      conversationId: realContext.conversationId,
      subjectId: realContext.authenticatedSubject.actorId,
    });
    assert.equal(effectResult.terminalStatus, 'succeeded');
    const settled = toolBroker.settleEffect({
      effectId: pending.effectRequestId,
      context: realContext,
    });
    assert.equal(settled.result.status, 'ok');
    assert.equal(settled.result.effectRequestId, pending.effectRequestId);
    assert.equal(readFileSync(target, 'utf8'), 'recovered\n');
    assert.deepEqual(database.prepare(`
      SELECT
        (SELECT count(*) FROM m2_effect_results) AS effectResults,
        (SELECT count(*) FROM tool_v1_results) AS toolResults,
        (SELECT count(*) FROM m2_pending_effect_payloads) AS pending
    `).get(), { effectResults: 1, toolResults: 1, pending: 0 });
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

await testAsync('malformed real adapter output invalidates its pending effect and cannot be approved later', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'm2-tool-invalid-adapter-'));
  const projectRoot = path.join(directory, 'project');
  mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  const database = realAuthorityDatabase();
  const clock = () => 1_777_000_150_000;
  const runtime = createEffectFileRuntime({
    database,
    clock,
    workspaceAuthority: {
      async observe() {
        return {
          canonicalRoot: realpathSync(projectRoot),
          workspaceRevision: 'wsr1:invalid-adapter',
        };
      },
    },
  });
  const canonicalAdapter = createM2ToolEffectAdapter({ effectRuntime: runtime });
  const repository = new M2ToolAuthorityRepository(database, { clock });
  let adapterCalls = 0;
  let durableEffectId = null;
  const toolBroker = createM2ToolBroker({
    repository,
    clock,
    effectAdapter: {
      async prepare(args) {
        adapterCalls += 1;
        const prepared = await canonicalAdapter.prepare(args);
        durableEffectId = prepared.effectRequestId;
        return {
          ...prepared,
          effectRequest: {
            ...prepared.effectRequest,
            target: {
              ...prepared.effectRequest.target,
              relativePath: 'src/forged.js',
              resolvedRealpath: `${projectRoot}/src/forged.js`,
            },
          },
        };
      },
    },
  });
  const realContext = {
    ...context,
    sessionId: 'studio-invalid-adapter',
    conversationId: 'conversation-invalid-adapter',
    userMessageId: 207,
    project: { id: 7, path: projectRoot },
  };
  const input = { path: 'src/owned.js', content: 'must never be written\n' };
  try {
    let first;
    try {
      first = await toolBroker.execute({ toolId: 'file.write', input, context: realContext });
    } catch (error) {
      assert.fail(`${error.message}: ${JSON.stringify(error.details || null)}`);
    }
    assert.equal(first.result.status, 'error');
    assert.equal(first.result.error.code, 'TOOL_EFFECT_TRANSLATION_INVALID');
    assert.equal(first.result.effectRequestId, null);
    assert.match(durableEffectId, /^effect:/);
    assert.deepEqual(database.prepare(`
      SELECT
        (SELECT count(*) FROM tool_v1_requests) AS toolRequests,
        (SELECT count(*) FROM tool_v1_results) AS toolResults,
        (SELECT count(*) FROM m2_effect_requests) AS effectRequests,
        (SELECT count(*) FROM m2_effect_invalidations) AS invalidations,
        (SELECT count(*) FROM m2_pending_effect_payloads) AS pending,
        (SELECT count(*) FROM m2_approval_grants) AS grants,
        (SELECT count(*) FROM m2_effect_results) AS effectResults,
        (SELECT count(*) FROM m2_tool_effect_links) AS links
    `).get(), {
      toolRequests: 1,
      toolResults: 1,
      effectRequests: 1,
      invalidations: 1,
      pending: 0,
      grants: 0,
      effectResults: 0,
      links: 0,
    });

    const replay = await toolBroker.execute({ toolId: 'file.write', input, context: realContext });
    assert.deepEqual(replay.result, first.result);
    assert.equal(adapterCalls, 1);
    await assert.rejects(
      runtime.approveFilesystemWrite({
        effectId: durableEffectId,
        conversationId: realContext.conversationId,
        subjectId: realContext.authenticatedSubject.actorId,
      }),
      error => error.code === 'EFFECT_INVALIDATED',
    );
    assert.equal(existsSync(path.join(projectRoot, 'src/owned.js')), false);
    assert.equal(existsSync(path.join(projectRoot, 'src/forged.js')), false);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

await testAsync('non-canonical file paths fail before real effect runtime registration', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'm2-tool-path-contract-'));
  const projectRoot = path.join(directory, 'project');
  mkdirSync(path.join(projectRoot, 'sub'), { recursive: true });
  const database = realAuthorityDatabase();
  const runtime = createEffectFileRuntime({
    database,
    clock: () => 1_777_000_200_000,
    workspaceAuthority: {
      async observe() {
        return {
          canonicalRoot: realpathSync(projectRoot),
          workspaceRevision: 'wsr1:stable-tool-path-contract',
        };
      },
    },
  });
  const canonicalAdapter = createM2ToolEffectAdapter({ effectRuntime: runtime });
  let adapterCalls = 0;
  const toolBroker = createM2ToolBroker({
    repository: new M2ToolAuthorityRepository(database, {
      clock: () => 1_777_000_200_000,
    }),
    clock: () => 1_777_000_200_000,
    effectAdapter: {
      async prepare(args) {
        adapterCalls += 1;
        return canonicalAdapter.prepare(args);
      },
    },
  });
  const realContext = {
    ...context,
    sessionId: 'studio-path-contract',
    conversationId: 'conversation-path-contract',
    userMessageId: 204,
    project: { id: 7, path: projectRoot },
  };
  try {
    for (const invalidPath of [
      'sub/./answer.txt',
      'sub//answer.txt',
      'sub\\answer.txt',
      'sub/',
    ]) {
      await assert.rejects(
        () => toolBroker.execute({
          toolId: 'file.write',
          input: { path: invalidPath, content: 'must not register\n' },
          context: realContext,
        }),
        error => error.code === M2ToolBrokerErrorCode.INPUT_INVALID,
      );
    }
    assert.equal(adapterCalls, 0);
    assert.deepEqual(database.prepare(`
      SELECT
        (SELECT count(*) FROM tool_v1_requests) AS toolRequests,
        (SELECT count(*) FROM tool_v1_results) AS toolResults,
        (SELECT count(*) FROM m2_effect_requests) AS effectRequests,
        (SELECT count(*) FROM m2_pending_effect_payloads) AS pending,
        (SELECT count(*) FROM m2_tool_effect_links) AS links
    `).get(), {
      toolRequests: 0,
      toolResults: 0,
      effectRequests: 0,
      pending: 0,
      links: 0,
    });
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

await testAsync('timeout aborts direct provider signal and rejects late completion', async () => {
  let providerSignal;
  const toolBroker = broker({
    clock: clockFrom([100, 101, 102, 103]),
    scheduleTimeout(callback) {
      queueMicrotask(callback);
      return { cancel() {} };
    },
  });
  const execution = await toolBroker.execute({
    toolId: 'local.math',
    input: { query: '2+2' },
    context,
    timeoutMs: 1,
    invoke: async signal => {
      providerSignal = signal;
      return new Promise(() => {});
    },
  });
  assert.equal(providerSignal.aborted, true);
  assert.equal(execution.result.status, 'timeout');
  assert.equal(execution.result.lateCompletionRejected, true);
});

await testAsync('pre-aborted caller produces cancelled result for pure tool', async () => {
  const controller = new AbortController();
  controller.abort('user');
  let calls = 0;
  const toolBroker = broker({ clock: clockFrom([100, 101, 102, 103]) });
  const execution = await toolBroker.execute({
    toolId: 'local.math',
    input: { query: '2+2' },
    context: { ...context, signal: controller.signal },
    invoke: async () => { calls += 1; return new Promise(() => {}); },
  });
  assert.equal(execution.result.status, 'cancelled');
  assert.equal(execution.result.error.code, M2_TOOL_ERROR_CODE.CANCELLED);
  assert.equal(calls <= 1, true);
});

await testAsync('unknown tool and schema-invalid input stop before invocation', async () => {
  const toolBroker = broker({ clock: () => 100 });
  assert.throws(
    () => toolBroker.createRequest({ toolId: 'unregistered.tool', input: {}, context }),
    error => error.code === M2ToolBrokerErrorCode.INPUT_INVALID,
  );
  assert.throws(
    () => toolBroker.createRequest({ toolId: 'web.search', input: { query: '', allowNetwork: true }, context }),
    error => error.code === M2ToolBrokerErrorCode.INPUT_INVALID,
  );
});

await testAsync('result-storage failure withholds a successful direct output', async () => {
  const repository = memoryRepository();
  repository.recordToolResult = () => { throw new Error('disk full'); };
  const toolBroker = createM2ToolBroker({
    repository,
    clock: clockFrom([100, 101, 102, 103]),
  });
  await assert.rejects(
    () => toolBroker.execute({
      toolId: 'local.math',
      input: { query: '2+2' },
      context,
      invoke: async () => ({
        success: true,
        data: { subtype: 'math', expression: '2+2', result: 4 },
      }),
    }),
    error => error.code === M2ToolBrokerErrorCode.RESULT_UNCOMMITTED,
  );
});

summary();
