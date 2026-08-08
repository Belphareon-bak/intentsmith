#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

import { suite, test, summary } from './harness.js';
import {
  M1_CONTRACT_KIND,
  M1_CONTRACT_STAGE,
  M1_CONTRACT_VERSION,
  classifyTerminal,
  decodeM1Contract,
  encodeM1Contract,
  validateConversationCommand,
  validateConversationResult,
  validateCoreEvent,
  validateCoreEventStream,
  validateModelRequest,
  validateModelResult,
} from '../contracts/m1/index.js';

const require = createRequire(import.meta.url);
const tsSourceRuntime = await import(
  new URL('../c3-ide/extensions/c3-protocol/src/m1.ts', import.meta.url).href
);
const identity = Object.freeze({
  requestId: 'req-001',
  conversationId: 'conv-001',
  turnId: 'turn-001',
});

const sendCommand = Object.freeze({
  contract: 'ConversationCommand',
  version: M1_CONTRACT_VERSION,
  ...identity,
  action: 'send',
  input: 'Kolik je 17 * 23?',
});

const cancelCommand = Object.freeze({
  contract: 'ConversationCommand',
  version: M1_CONTRACT_VERSION,
  ...identity,
  action: 'cancel',
});

const conversationOk = Object.freeze({
  contract: 'ConversationResult',
  version: M1_CONTRACT_VERSION,
  ...identity,
  status: 'ok',
  response: {
    content: '391',
    metadata: { deterministic: true },
  },
});

const conversationError = Object.freeze({
  contract: 'ConversationResult',
  version: M1_CONTRACT_VERSION,
  ...identity,
  status: 'error',
  error: { code: 'PROVIDER_FAILED', message: 'Provider unavailable' },
  partial: {
    toolResults: [{
      toolCallId: 'tool-001',
      tool: 'calculator',
      status: 'ok',
      summary: '391',
    }],
  },
});

const modelRequest = Object.freeze({
  contract: 'ModelRequest',
  version: M1_CONTRACT_VERSION,
  ...identity,
  callerRole: 'CRE_DECISION',
  modelRole: 'CHAT',
  purpose: 'answer',
  prompt: 'Vysvětli rekurzi.',
  parameters: { temperature: 0.2 },
});

const modelOk = Object.freeze({
  contract: 'ModelResult',
  version: M1_CONTRACT_VERSION,
  ...identity,
  status: 'ok',
  response: {
    content: 'Rekurze volá sama sebe nad menším problémem.',
    model: 'qwen3.5:27b',
    usage: { outputTokens: 12 },
  },
});

const progressEvent = Object.freeze({
  contract: 'CoreEvent',
  version: M1_CONTRACT_VERSION,
  ...identity,
  sequence: 1,
  phase: 'progress',
  eventType: 'analysis-started',
  payload: { stage: 'routing' },
});

const tokenEvent = Object.freeze({
  ...progressEvent,
  sequence: 2,
  eventType: 'token',
  payload: { token: '391' },
});

const terminalEvent = Object.freeze({
  contract: 'CoreEvent',
  version: M1_CONTRACT_VERSION,
  ...identity,
  sequence: 3,
  phase: 'terminal',
  eventType: 'result',
  terminalStatus: 'ok',
  payload: { result: conversationOk },
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function errorSet(result) {
  return new Set(result.errors);
}

function assertRoundTrip(codec, fixture) {
  assert.deepEqual(codec(fixture), fixture);
}

suite('M1 connector — positive runtime contract');

test('version and contract discriminators are explicit and provisional', () => {
  assert.equal(M1_CONTRACT_VERSION, 1);
  assert.equal(M1_CONTRACT_STAGE, 'PROVISIONAL_V1');
  assert.deepEqual(Object.values(M1_CONTRACT_KIND).sort(), [
    'ConversationCommand',
    'ConversationResult',
    'CoreEvent',
    'ModelRequest',
    'ModelResult',
  ]);
});

test('ConversationCommand send and scoped cancel validate', () => {
  assert.equal(validateConversationCommand(sendCommand).valid, true);
  assert.equal(validateConversationCommand(cancelCommand).valid, true);
});

test('ConversationResult ok and error-with-partial validate', () => {
  assert.equal(validateConversationResult(conversationOk).valid, true);
  assert.equal(validateConversationResult(conversationError).valid, true);
});

test('ModelRequest distinguishes caller, model role, and purpose', () => {
  assert.equal(validateModelRequest(modelRequest).valid, true);
  assert.equal(modelRequest.callerRole, 'CRE_DECISION');
  assert.equal(modelRequest.modelRole, 'CHAT');
  assert.equal(modelRequest.purpose, 'answer');
});

test('ModelResult requires a non-empty successful response', () => {
  assert.equal(validateModelResult(modelOk).valid, true);
});

test('CoreEvent progress and terminal are top-level discriminated', () => {
  assert.equal(progressEvent.phase, 'progress');
  assert.equal(terminalEvent.phase, 'terminal');
  assert.equal(validateCoreEvent(progressEvent).valid, true);
  assert.equal(validateCoreEvent(terminalEvent).valid, true);
});

test('CoreEvent stream accepts future token progress without changing v1', () => {
  const result = validateCoreEventStream([progressEvent, tokenEvent, terminalEvent]);
  assert.equal(result.valid, true, result.errors.join(', '));
});

test('canonical JS codec round-trips all three connector families', () => {
  for (const fixture of [sendCommand, conversationOk, modelRequest, modelOk, progressEvent]) {
    assert.deepEqual(
      decodeM1Contract(encodeM1Contract(fixture), fixture.contract),
      fixture,
    );
  }
});

test('terminal seam renders and persists only an ok assistant', () => {
  const ok = classifyTerminal(conversationOk, {
    allowPartial: true,
    responseKind: 'conversation',
  });
  const failed = classifyTerminal(conversationError, {
    allowPartial: true,
  });
  assert.equal(ok.renderAssistant, true);
  assert.equal(ok.persistAssistant, true);
  assert.equal(failed.renderAssistant, false);
  assert.equal(failed.persistAssistant, false);
  assert.equal(failed.persistPartialToolResults, true);
  assert.equal(failed.acceptLateAssistant, false);
});

test('terminal seam fails closed without an explicit response contract', () => {
  const classification = classifyTerminal({ status: 'ok', response: {} });
  assert.equal(classification.valid, false);
  assert.equal(classification.renderAssistant, false);
  assert.equal(classification.persistAssistant, false);
  assert.equal(
    classification.errors.includes('terminal:invalid-response-kind'),
    true,
  );
});

suite('M1 connector — fail-closed negative contract');

test('missing and unscoped cancel identity is rejected', () => {
  const value = clone(cancelCommand);
  delete value.conversationId;
  const result = validateConversationCommand(value);
  assert.equal(result.valid, false);
  assert.equal(errorSet(result).has('conversation-command:missing-conversationId'), true);
});

test('transport sessionId cannot replace conversation identity', () => {
  const value = { ...cancelCommand, sessionId: 'ws-transport-only' };
  const result = validateConversationCommand(value);
  assert.equal(result.valid, false);
  assert.equal(errorSet(result).has('conversation-command:unknown-sessionId'), true);
});

test('wrong contract version and unknown status are rejected', () => {
  const wrongVersion = { ...conversationOk, version: 2 };
  const degraded = { ...conversationError, status: 'degraded' };
  assert.equal(validateConversationResult(wrongVersion).valid, false);
  assert.equal(validateConversationResult(degraded).valid, false);
});

test('response on error and error on ok are both rejected', () => {
  const responseOnError = { ...conversationError, response: { content: 'fallback' } };
  const errorOnOk = {
    ...conversationOk,
    error: { code: 'IMPOSSIBLE', message: 'must not coexist' },
  };
  assert.equal(errorSet(validateConversationResult(responseOnError)).has('terminal:response-on-error'), true);
  assert.equal(errorSet(validateConversationResult(errorOnOk)).has('terminal:error-on-ok'), true);
});

test('empty or whitespace-only model content is not success', () => {
  for (const content of ['', '   ']) {
    const value = clone(modelOk);
    value.response.content = content;
    const result = validateModelResult(value);
    assert.equal(result.valid, false);
    assert.equal(errorSet(result).has('response:invalid-content'), true);
  }
});

test('invalid model purpose is rejected', () => {
  const result = validateModelRequest({ ...modelRequest, purpose: 'stream' });
  assert.equal(result.valid, false);
  assert.equal(errorSet(result).has('model-request:invalid-purpose'), true);
});

test('foreign identity inside terminal event is rejected', () => {
  const value = clone(terminalEvent);
  value.payload.result.conversationId = 'conv-other';
  const result = validateCoreEvent(value);
  assert.equal(result.valid, false);
  assert.equal(errorSet(result).has('core-event:foreign-conversationId'), true);
});

test('out-of-order sequence is rejected', () => {
  const value = { ...tokenEvent, sequence: 1 };
  const result = validateCoreEventStream([progressEvent, value, terminalEvent]);
  assert.equal(result.valid, false);
  assert.equal(
    result.errors.some(error => error.endsWith('out-of-order-sequence')),
    true,
  );
});

test('duplicate terminal and any event after terminal are rejected', () => {
  const second = { ...terminalEvent, sequence: 4 };
  const result = validateCoreEventStream([progressEvent, terminalEvent, second]);
  assert.equal(result.valid, false);
  assert.equal(errorSet(result).has('core-event-stream:duplicate-terminal'), true);
  assert.equal(
    result.errors.some(error => error.endsWith('event-after-terminal')),
    true,
  );
});

test('partial data is allowed only on terminal error', () => {
  const cancelled = {
    ...conversationError,
    status: 'cancelled',
    error: { code: 'CANCELLED', message: 'Cancelled by user' },
  };
  const result = validateConversationResult(cancelled);
  assert.equal(result.valid, false);
  assert.equal(errorSet(result).has('terminal:partial-not-allowed'), true);
});

test('late assistant after cancellation is rejected at the terminal seam', () => {
  const classification = classifyTerminal(conversationOk, {
    allowPartial: true,
    priorStatus: 'cancelled',
    responseKind: 'conversation',
  });
  assert.equal(classification.valid, false);
  assert.equal(classification.acceptLateAssistant, false);
  assert.equal(classification.errors.includes('terminal:already-final'), true);
  assert.equal(
    classification.errors.includes('terminal:late-assistant-after-cancel'),
    true,
  );
});

test('malformed JSON and mismatched expected connector fail closed', () => {
  assert.throws(() => decodeM1Contract('{'), /m1:invalid-json/);
  assert.throws(
    () => decodeM1Contract(JSON.stringify(modelRequest), 'ConversationCommand'),
    /m1:unexpected-contract/,
  );
});

suite('M1 connector — TypeScript consumer mirror');

test('TypeScript source exposes all three connector families and no session key', () => {
  const source = fs.readFileSync(
    new URL('../c3-ide/extensions/c3-protocol/src/m1.ts', import.meta.url),
    'utf8',
  );
  for (const symbol of [
    'ConversationCommand',
    'ConversationResult',
    'ModelRequest',
    'ModelResult',
    'CoreEvent',
    'roundTripM1Contract',
  ]) assert.match(source, new RegExp(`\\b${symbol}\\b`));
  assert.equal(source.includes('sessionId'), false);
  assert.match(source, /PROVISIONAL_V1/);
});

const tsRuntimeOption = process.argv.find(arg => arg.startsWith('--typescript-runtime='));

function assertRuntimeRoundTrips(runtime) {
  assert.equal(runtime.M1_CONTRACT_VERSION, M1_CONTRACT_VERSION);
  for (const fixture of [sendCommand, conversationOk, modelRequest, modelOk, progressEvent]) {
    assertRoundTrip(runtime.roundTripM1Contract, fixture);
  }
}

function invalidFixtureMatrix() {
  const invalidValues = [];
  const unscopedCancel = clone(cancelCommand);
  delete unscopedCancel.conversationId;
  invalidValues.push(unscopedCancel);
  invalidValues.push({ ...cancelCommand, input: 'not allowed' });
  invalidValues.push({ ...conversationError, status: 'degraded' });
  invalidValues.push({
    ...conversationError,
    response: { content: 'must not render' },
  });
  invalidValues.push({
    ...conversationOk,
    error: { code: 'IMPOSSIBLE', message: 'must not coexist' },
  });
  const emptyModel = clone(modelOk);
  emptyModel.response.content = '';
  invalidValues.push(emptyModel);
  invalidValues.push({ ...modelRequest, purpose: 'stream' });
  const partialCancelled = clone(conversationError);
  partialCancelled.status = 'cancelled';
  partialCancelled.error = { code: 'CANCELLED', message: 'cancelled' };
  invalidValues.push(partialCancelled);
  const leakedToolOutput = clone(conversationError);
  leakedToolOutput.partial.toolResults[0].value = { secret: 'not public' };
  invalidValues.push(leakedToolOutput);
  return invalidValues;
}

function assertRuntimeRejectsNegativeMatrix(runtime) {
  for (const invalid of invalidFixtureMatrix()) {
    const result = runtime.validateM1Contract(invalid);
    assert.equal(result.valid, false, JSON.stringify(invalid));
  }
}

function assertRuntimeRejectsTerminalRaces(runtime) {
  const duplicate = runtime.validateCoreEventStream([
    progressEvent,
    terminalEvent,
    { ...terminalEvent, sequence: 4 },
  ]);
  assert.equal(duplicate.valid, false);
  assert.equal(duplicate.errors.includes('core-event-stream:duplicate-terminal'), true);

  const late = runtime.classifyTerminal(conversationOk, {
    priorStatus: 'cancelled',
    allowPartial: true,
    responseKind: 'conversation',
  });
  assert.equal(late.valid, false);
  assert.equal(late.errors.includes('terminal:late-assistant-after-cancel'), true);

  const untyped = runtime.classifyTerminal({ status: 'ok', response: {} });
  assert.equal(untyped.valid, false);
  assert.equal(untyped.errors.includes('terminal:invalid-response-kind'), true);
}

test('TypeScript source runtime round-trips all three connector families', () => {
  assertRuntimeRoundTrips(tsSourceRuntime);
});

test('TypeScript source runtime rejects the canonical negative matrix', () => {
  assertRuntimeRejectsNegativeMatrix(tsSourceRuntime);
});

test('TypeScript source runtime rejects terminal ordering and untyped success', () => {
  assertRuntimeRejectsTerminalRaces(tsSourceRuntime);
});

if (tsRuntimeOption) {
  const modulePath = path.resolve(tsRuntimeOption.slice('--typescript-runtime='.length));
  const compiledRuntime = require(modulePath);
  test('compiled TypeScript runtime matches the required source checks', () => {
    assertRuntimeRoundTrips(compiledRuntime);
    assertRuntimeRejectsNegativeMatrix(compiledRuntime);
    assertRuntimeRejectsTerminalRaces(compiledRuntime);
  });
}

summary();
