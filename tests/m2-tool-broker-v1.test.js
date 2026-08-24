#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { suite, test, testAsync, summary } from './harness.js';
import { computeEffectRequestDigest } from '../contracts/m2/effect-v1.js';
import {
  M2_TOOL_ERROR_CODE,
  canonicalizeM2ToolValue,
  validateM2ToolRequest,
  validateM2ToolResult,
} from '../contracts/m2/tool-v1.js';
import { createM2ToolBroker, M2ToolBrokerErrorCode } from '../src/tools/m2-tool-broker.js';
import { createM2ToolEffectAdapter } from '../src/tools/m2-tool-effect-adapter.js';

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
    _recordEffectResult(value) {
      effectResults.set(value.effectId, structuredClone(value));
    },
  };
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
    idempotencyKey: `effect-operation:${sha256(request.idempotencyKey)}`,
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

await testAsync('forged adapter approval without canonical EffectRequest is rejected', async () => {
  let calls = 0;
  let captured;
  const toolBroker = broker({
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
  assert.equal(execution.result.error.code, M2_TOOL_ERROR_CODE.EFFECT_AUTHORITY_UNAVAILABLE);
  assert.equal(execution.result.effectRequestId, null);
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
  assert.equal(execution.result.error.code, M2_TOOL_ERROR_CODE.EFFECT_AUTHORITY_UNAVAILABLE);
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
  assert.equal(execution.result.error.code, 'EFFECT_ADAPTER_THROW');
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
