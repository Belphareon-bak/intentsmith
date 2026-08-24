#!/usr/bin/env node

import assert from 'node:assert/strict';

import { suite, test, summary } from './harness.js';
import {
  M2_TOOL_CONTRACT_KIND,
  M2_TOOL_CONTRACT_VERSION,
  M2_TOOL_ERROR_CODE,
  canonicalizeM2ToolValue,
  computeM2ToolRequestDigest,
  computeM2ToolValueDigest,
  decodeM2ToolContract,
  encodeM2ToolContract,
  validateM2ToolContract,
  validateM2ToolRequest,
  validateM2ToolResult,
} from '../contracts/m2/tool-v1.js';

function clone(value) {
  return structuredClone(value);
}

const input = { query: '2 + 2' };
const request = Object.freeze({
  contract: M2_TOOL_CONTRACT_KIND.REQUEST,
  version: M2_TOOL_CONTRACT_VERSION,
  requestId: `tool:${'a'.repeat(64)}`,
  runId: `run:${'b'.repeat(64)}`,
  actor: { type: 'user', id: 'operator-1' },
  origin: {
    surface: 'studio',
    sessionId: `session:${'c'.repeat(64)}`,
    conversationId: `conversation:${'d'.repeat(64)}`,
    projectId: 7,
  },
  toolId: 'local.math',
  toolVersion: 1,
  riskClass: 'pure',
  inputSchema: 'intentsmith.tool.local-math.input@1',
  input,
  inputDigest: computeM2ToolValueDigest(input),
  requiredEffectKind: null,
  timeoutMs: 30_000,
  idempotencyKey: `tool-operation:${'e'.repeat(64)}`,
  createdAt: '2026-08-24T08:00:00.000Z',
});

const output = { subtype: 'math', expression: '2 + 2', result: 4 };
const success = Object.freeze({
  contract: M2_TOOL_CONTRACT_KIND.RESULT,
  version: M2_TOOL_CONTRACT_VERSION,
  requestId: request.requestId,
  requestDigest: computeM2ToolRequestDigest(request),
  runId: request.runId,
  projectId: request.origin.projectId,
  toolId: request.toolId,
  toolVersion: request.toolVersion,
  status: 'ok',
  outputSchema: 'intentsmith.tool.local-math.output@1',
  output,
  outputDigest: computeM2ToolValueDigest(output),
  effectRequestId: null,
  error: null,
  startedAt: '2026-08-24T08:00:00.001Z',
  completedAt: '2026-08-24T08:00:00.002Z',
  evidenceRefs: [],
  lateCompletionRejected: false,
});

const deniedNetwork = Object.freeze({
  ...success,
  toolId: 'web.search',
  status: 'error',
  outputSchema: 'intentsmith.tool.web-search.output@1',
  output: null,
  outputDigest: null,
  effectRequestId: null,
  error: {
    code: M2_TOOL_ERROR_CODE.EFFECT_AUTHORITY_UNAVAILABLE,
    message: 'Exact network effect authority is unavailable.',
    retryable: false,
  },
  evidenceRefs: ['tool:network-effect-not-invoked'],
});

suite('M2 ToolRequest/ToolResult v1 — canonical positive forms');

test('pure ToolRequest binds registry identity, schema, normalized input and digest', () => {
  const validation = validateM2ToolRequest(request);
  assert.equal(validation.valid, true, validation.errors.join(', '));
  assert.equal(validateM2ToolContract(request).valid, true);
  assert.match(computeM2ToolRequestDigest(request), /^sha256:[a-f0-9]{64}$/);
});

test('successful ToolResult has typed output and exact digest', () => {
  const validation = validateM2ToolResult(success);
  assert.equal(validation.valid, true, validation.errors.join(', '));
  assert.equal(validateM2ToolContract(success).valid, true);
});

test('unavailable effect authority is explicit and cannot claim an EffectRequest', () => {
  const validation = validateM2ToolResult(deniedNetwork);
  assert.equal(validation.valid, true, validation.errors.join(', '));
  assert.equal(deniedNetwork.status, 'error');
  assert.equal(deniedNetwork.error.code, M2_TOOL_ERROR_CODE.EFFECT_AUTHORITY_UNAVAILABLE);
  assert.equal(deniedNetwork.effectRequestId, null);
});

test('canonical encoding is key-order independent and NFC-normalized', () => {
  assert.equal(
    canonicalizeM2ToolValue({ z: 'Pr\u030ci\u0301lis\u030c', a: 1 }),
    canonicalizeM2ToolValue({ a: 1, z: 'Příliš' }),
  );
  const encoded = encodeM2ToolContract(request, M2_TOOL_CONTRACT_KIND.REQUEST);
  assert.deepEqual(decodeM2ToolContract(encoded), request);
});

suite('M2 ToolRequest/ToolResult v1 — fail-closed negatives');

test('caller cannot down-class network or write tools as pure', () => {
  const networkInput = { query: 'IntentSmith' };
  const downClassed = {
    ...request,
    toolId: 'web.search',
    inputSchema: 'intentsmith.tool.web-search.input@1',
    input: networkInput,
    inputDigest: computeM2ToolValueDigest(networkInput),
    riskClass: 'pure',
    requiredEffectKind: 'network.request',
  };
  const writeWithoutEffect = {
    ...request,
    toolId: 'file.write',
    riskClass: 'write',
    requiredEffectKind: null,
  };
  assert.equal(validateM2ToolRequest(downClassed).valid, false);
  assert.equal(validateM2ToolRequest(writeWithoutEffect).valid, false);
});

test('input mutation after digest and unknown fields are rejected', () => {
  const mutated = clone(request);
  mutated.input.query = '2 + 3';
  const extra = { ...request, allowNetwork: true };
  assert.equal(validateM2ToolRequest(mutated).valid, false);
  assert.equal(validateM2ToolRequest(extra).valid, false);
});

test('non-JSON, cyclic and non-finite inputs cannot be digested', () => {
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => computeM2ToolValueDigest(cyclic), /not-json/);
  assert.throws(() => computeM2ToolValueDigest({ value: Infinity }), /not-json/);
  assert.throws(() => computeM2ToolValueDigest({ value: undefined }), /not-json/);
});

test('success cannot carry an error and failure cannot carry output', () => {
  assert.equal(validateM2ToolResult({ ...success, error: deniedNetwork.error }).valid, false);
  assert.equal(validateM2ToolResult({
    ...deniedNetwork,
    output,
    outputDigest: computeM2ToolValueDigest(output),
  }).valid, false);
});

test('wrong output digest and reversed timestamps are rejected', () => {
  assert.equal(validateM2ToolResult({
    ...success,
    outputDigest: `sha256:${'0'.repeat(64)}`,
  }).valid, false);
  assert.equal(validateM2ToolResult({
    ...success,
    completedAt: '2026-08-24T07:59:59.999Z',
  }).valid, false);
});

test('evidence references must be bytewise sorted and unique', () => {
  assert.equal(validateM2ToolResult({
    ...success,
    evidenceRefs: ['z', 'a'],
  }).valid, false);
  assert.equal(validateM2ToolResult({
    ...success,
    evidenceRefs: ['a', 'a'],
  }).valid, false);
});

test('decoder rejects invalid UTF-8, oversize payload and wrong contract kind', () => {
  assert.throws(() => decodeM2ToolContract(Buffer.from([0xff])), /invalid-utf8/);
  assert.throws(() => decodeM2ToolContract(Buffer.alloc(1_048_577, 0x20)), /invalid-size/);
  assert.throws(
    () => decodeM2ToolContract(encodeM2ToolContract(request), M2_TOOL_CONTRACT_KIND.RESULT),
    /unexpected-contract/,
  );
});

summary();
