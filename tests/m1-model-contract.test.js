#!/usr/bin/env node

import {
  assert,
  assertEqual,
  suite,
  summary,
  testAsync,
} from './harness.js';
import {
  AbortSource,
  abortWithReason,
} from '../src/core/abort-error.js';
import {
  LLMGatewayErrorCode,
  callWithPolicy,
  llmGateway,
} from '../src/llm/gateway.js';
import { createAuthToken } from '../src/llm/auth-types.js';
import { modelUniverseStore } from '../src/upgrade/model-universe-store.js';

const originalFetch = globalThis.fetch;
const originalSignalRecorder = modelUniverseStore.recordSignalEvent;
const originalConcurrencyMax = llmGateway._concurrency.max;
const originalQueueTimeout = llmGateway._concurrency.queueTimeout;
const originalStrictMode = llmGateway.strictMode;
const originalCurrentAuth = llmGateway.currentAuth;

let tokenSequence = 0;
const secretCanary = 'private-prompt-canary-never-audit';
const runtimeSignals = [];

function makeToken() {
  tokenSequence += 1;
  return createAuthToken({
    role: 'CRE_DECISION',
    decisionId: `m1-model-decision-${tokenSequence}`,
    auditContext: { sessionId: `m1-model-session-${tokenSequence}` },
  });
}

function correlation(suffix) {
  return {
    requestId: `m1-model-request-${suffix}`,
    conversationId: `m1-model-conversation-${suffix}`,
    turnId: `m1-model-turn-${suffix}`,
    callerRole: 'CRE_DECISION',
    modelRole: 'CHAT',
    purpose: 'answer',
  };
}

function providerResponse({ status = 200, json = {}, text = '' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
    text: async () => text,
  };
}

async function capturedFailure(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected model request to reject');
}

function assertSemaphoreReleased() {
  const stats = llmGateway.getConcurrencyStats();
  assertEqual(stats.active, 0, 'gateway active slot must be released');
  assertEqual(stats.queued, 0, 'gateway queue must be empty');
}

try {
  modelUniverseStore.recordSignalEvent = event => {
    runtimeSignals.push(event);
    return { ok: true };
  };
  llmGateway._concurrency.max = 1;
  llmGateway._concurrency.queueTimeout = 1000;

  suite('M1 model gateway policy — exact provider outcome');

  await testAsync('one valid provider result keeps correlation and never audits prompt content', async () => {
    runtimeSignals.length = 0;
    const auditStart = llmGateway.getAuditLogs().length;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return providerResponse({
        json: {
          message: { content: 'bounded local answer' },
          prompt_eval_count: 4,
          eval_count: 3,
        },
      });
    };

    const ids = correlation('success');
    const result = await callWithPolicy(makeToken(), secretCanary, {
      model: 'fixture-model:1b',
      capability: 'reasoning',
      maxTokens: 16,
      retries: 99,
      correlation: ids,
    });

    assertEqual(fetchCalls, 1, 'M1 policy must make exactly one provider attempt');
    assertEqual(result.content, 'bounded local answer');
    const audit = llmGateway.getAuditLogs().slice(auditStart);
    const complete = audit.find(entry => entry.event === 'LLM_CALL_COMPLETE');
    assert(complete, 'success must create a terminal audit event');
    for (const [key, value] of Object.entries(ids)) assertEqual(complete[key], value);
    assertEqual(JSON.stringify(audit).includes(secretCanary), false);
    assertEqual(runtimeSignals.length, 1);
    assertEqual(runtimeSignals[0].signalType, 'runtime');
    assertEqual(JSON.stringify(runtimeSignals[0].payload.correlation), JSON.stringify(ids));
    assertEqual(JSON.stringify(runtimeSignals).includes(secretCanary), false);
    assertSemaphoreReleased();
  });

  await testAsync('policy rejects malformed identity and denied capability before provider effects', async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error('authorization failure reached provider');
    };
    const token = makeToken();
    const fixtures = [
      [{ capability: 'reasoning' }, LLMGatewayErrorCode.INVALID_REQUEST],
      [{
        capability: 'reasoning',
        correlation: { ...correlation('foreign-role'), callerRole: 'REFLECTOR' },
      }, LLMGatewayErrorCode.AUTHORIZATION_DENIED],
      [{
        capability: 'reasoning',
        correlation: { ...correlation('unknown-key'), extra: 'not-allowed' },
      }, LLMGatewayErrorCode.INVALID_REQUEST],
      [{
        capability: 'reasoning',
        correlation: { ...correlation('object-id'), requestId: { value: 'spoof' } },
      }, LLMGatewayErrorCode.INVALID_REQUEST],
      [{
        capability: 'code_generation',
        correlation: correlation('denied-capability'),
      }, LLMGatewayErrorCode.AUTHORIZATION_DENIED],
    ];

    for (const [options, expectedCode] of fixtures) {
      const error = await capturedFailure(callWithPolicy(token, 'not sent', {
        model: 'fixture-model:1b',
        ...options,
      }));
      assertEqual(error.code, expectedCode);
    }
    assertEqual(fetchCalls, 0);
    assertSemaphoreReleased();
  });

  await testAsync('unauthorized audit stores lengths and flags but no prompt, system prompt, token, or stack', async () => {
    const auditStart = llmGateway.getAuditLogs().length;
    llmGateway.revoke();
    llmGateway.enableStrictMode();
    const error = await capturedFailure(llmGateway.call(secretCanary, {
      systemPrompt: `${secretCanary}-system`,
      messages: [{ role: 'user', content: `${secretCanary}-message` }],
    }));
    assert(error.message.includes('LLM_CALL_OUTSIDE_CRE'));
    const audit = llmGateway.getAuditLogs().slice(auditStart);
    const denied = audit.find(entry => entry.event === 'UNAUTHORIZED_CALL');
    assert(denied);
    assertEqual(denied.promptLength, secretCanary.length);
    assertEqual(Object.hasOwn(denied, 'promptPreview'), false);
    assertEqual(Object.hasOwn(denied, 'stack'), false);
    assertEqual(JSON.stringify(audit).includes(secretCanary), false);
    assertSemaphoreReleased();
  });

  await testAsync('empty and whitespace outputs fail closed without a success audit', async () => {
    for (const [index, content] of ['', '   '].entries()) {
      const auditStart = llmGateway.getAuditLogs().length;
      let fetchCalls = 0;
      globalThis.fetch = async () => {
        fetchCalls += 1;
        return providerResponse({ json: { message: { content } } });
      };
      const error = await capturedFailure(callWithPolicy(makeToken(), 'empty', {
        model: 'fixture-model:1b',
        capability: 'reasoning',
        correlation: correlation(`empty-${index}`),
      }));
      assertEqual(fetchCalls, 1);
      assertEqual(error.code, LLMGatewayErrorCode.EMPTY_RESPONSE);
      const audit = llmGateway.getAuditLogs().slice(auditStart);
      assertEqual(audit.some(entry => entry.event === 'LLM_CALL_COMPLETE'), false);
      assertSemaphoreReleased();
    }
  });

  await testAsync('malformed JSON and malformed payloads are distinct typed failures', async () => {
    const fixtures = [
      {
        fetch: async () => ({
          ok: true,
          status: 200,
          json: async () => { throw new SyntaxError('private malformed bytes'); },
          text: async () => '',
        }),
      },
      { fetch: async () => providerResponse({ json: { message: { content: 42 } } }) },
      { fetch: async () => providerResponse({ json: { unrelated: true } }) },
    ];
    for (const [index, fixture] of fixtures.entries()) {
      globalThis.fetch = fixture.fetch;
      const error = await capturedFailure(callWithPolicy(makeToken(), 'malformed', {
        model: 'fixture-model:1b',
        capability: 'reasoning',
        correlation: correlation(`malformed-${index}`),
      }));
      assertEqual(error.code, LLMGatewayErrorCode.MALFORMED_RESPONSE);
      assertEqual(error.message.includes('private malformed bytes'), false);
      assertSemaphoreReleased();
    }
  });

  await testAsync('404, 500, and 503 preserve exact safe provider classifications', async () => {
    const fixtures = [
      [404, LLMGatewayErrorCode.MODEL_NOT_FOUND],
      [500, LLMGatewayErrorCode.PROVIDER_HTTP_ERROR],
      [503, LLMGatewayErrorCode.PROVIDER_UNAVAILABLE],
    ];
    for (const [status, expectedCode] of fixtures) {
      runtimeSignals.length = 0;
      const auditStart = llmGateway.getAuditLogs().length;
      let fetchCalls = 0;
      globalThis.fetch = async () => {
        fetchCalls += 1;
        return providerResponse({ status, text: secretCanary });
      };
      const error = await capturedFailure(callWithPolicy(makeToken(), 'status', {
        model: 'fixture-model:1b',
        capability: 'reasoning',
        retries: 50,
        correlation: correlation(`http-${status}`),
      }));
      assertEqual(fetchCalls, 1, `HTTP ${status} must not retry under M1 policy`);
      assertEqual(error.code, expectedCode);
      assertEqual(error.httpStatus, status);
      assertEqual(error.message.includes(secretCanary), false);
      assertEqual(
        JSON.stringify(llmGateway.getAuditLogs().slice(auditStart)).includes(secretCanary),
        false,
      );
      assertEqual(runtimeSignals.length, 1);
      assertEqual(runtimeSignals[0].signalType, 'runtime_failed');
      assertEqual(runtimeSignals[0].errorType, expectedCode);
      if (status === 503) {
        assertEqual(
          llmGateway.getAuditLogs().slice(auditStart)
            .some(entry => entry.event === 'LLM_CALL_OOM'),
          false,
        );
      }
      assertSemaphoreReleased();
    }
  });

  await testAsync('refused provider becomes unavailable after exactly one attempt', async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      const error = new TypeError('fetch failed');
      error.cause = Object.assign(new Error('connect refused'), { code: 'ECONNREFUSED' });
      throw error;
    };
    const error = await capturedFailure(callWithPolicy(makeToken(), 'refused', {
      model: 'fixture-model:1b',
      capability: 'reasoning',
      correlation: correlation('refused'),
    }));
    assertEqual(fetchCalls, 1);
    assertEqual(error.code, LLMGatewayErrorCode.PROVIDER_UNAVAILABLE);
    assertSemaphoreReleased();
  });

  suite('M1 model gateway policy — cancellation and semaphore ownership');

  await testAsync('pre-abort, in-flight cancel, and gateway timeout never succeed', async () => {
    let fetchCalls = 0;
    globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
      fetchCalls += 1;
      options.signal.addEventListener('abort', () => reject(options.signal.reason), {
        once: true,
      });
    });

    const pre = new AbortController();
    abortWithReason(pre, AbortSource.USER, 'pre-cancelled model request');
    const preError = await capturedFailure(callWithPolicy(makeToken(), 'pre', {
      model: 'fixture-model:1b',
      capability: 'reasoning',
      signal: pre.signal,
      correlation: correlation('pre-cancel'),
    }));
    assertEqual(preError.name, 'AbortError');
    assertEqual(preError.abortSource, AbortSource.USER);
    assertEqual(fetchCalls, 0);
    assertSemaphoreReleased();

    const active = new AbortController();
    const pending = callWithPolicy(makeToken(), 'active', {
      model: 'fixture-model:1b',
      capability: 'reasoning',
      signal: active.signal,
      correlation: correlation('active-cancel'),
    });
    await new Promise(resolve => setImmediate(resolve));
    abortWithReason(active, AbortSource.USER, 'active model cancellation');
    const activeError = await capturedFailure(pending);
    assertEqual(activeError.name, 'AbortError');
    assertEqual(activeError.abortSource, AbortSource.USER);
    assertEqual(fetchCalls, 1);
    assertSemaphoreReleased();

    const timeoutError = await capturedFailure(callWithPolicy(makeToken(), 'timeout', {
      model: 'fixture-model:1b',
      capability: 'reasoning',
      timeout: 5,
      correlation: correlation('timeout'),
    }));
    assertEqual(timeoutError.name, 'AbortError');
    assertEqual(timeoutError.abortSource, AbortSource.TIMEOUT);
    assertEqual(fetchCalls, 2);
    assertSemaphoreReleased();
  });

  await testAsync('queued cancellation removes only its waiter and transfers no slot', async () => {
    let resolveFirstFetch;
    let firstFetchStarted;
    const started = new Promise(resolve => { firstFetchStarted = resolve; });
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      if (fetchCalls !== 1) throw new Error('queued request reached provider');
      firstFetchStarted();
      return new Promise(resolve => { resolveFirstFetch = resolve; });
    };

    const first = callWithPolicy(makeToken(), 'first', {
      model: 'fixture-model:1b',
      capability: 'reasoning',
      timeout: 1000,
      correlation: correlation('queue-owner'),
    });
    await started;

    const queuedAbort = new AbortController();
    const queued = callWithPolicy(makeToken(), 'queued', {
      model: 'fixture-model:1b',
      capability: 'reasoning',
      timeout: 1000,
      signal: queuedAbort.signal,
      correlation: correlation('queue-cancel'),
    });
    await new Promise(resolve => setImmediate(resolve));
    assertEqual(llmGateway.getConcurrencyStats().queued, 1);
    abortWithReason(queuedAbort, AbortSource.USER, 'cancel queued model request');
    const queuedError = await capturedFailure(queued);
    assertEqual(queuedError.name, 'AbortError');
    assertEqual(queuedError.abortSource, AbortSource.USER);
    assertEqual(llmGateway.getConcurrencyStats().active, 1);
    assertEqual(llmGateway.getConcurrencyStats().queued, 0);
    assertEqual(fetchCalls, 1);

    resolveFirstFetch(providerResponse({ json: { message: { content: 'owner done' } } }));
    const firstResult = await first;
    assertEqual(firstResult.content, 'owner done');
    assertSemaphoreReleased();
  });

  await testAsync('queued upstream deadline is timeout, never user cancellation', async () => {
    let resolveOwner;
    let ownerStarted;
    const started = new Promise(resolve => { ownerStarted = resolve; });
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      if (fetchCalls !== 1) throw new Error('expired queued request reached provider');
      ownerStarted();
      return new Promise(resolve => { resolveOwner = resolve; });
    };

    const owner = callWithPolicy(makeToken(), 'owner', {
      model: 'fixture-model:1b',
      capability: 'reasoning',
      timeout: 1000,
      correlation: correlation('upstream-timeout-owner'),
    });
    await started;
    const auditStart = llmGateway.getAuditLogs().length;
    const deadline = new AbortController();
    const waiter = callWithPolicy(makeToken(), 'waiter', {
      model: 'fixture-model:1b',
      capability: 'reasoning',
      timeout: 1000,
      signal: deadline.signal,
      correlation: correlation('upstream-timeout-waiter'),
    });
    await new Promise(resolve => setImmediate(resolve));
    abortWithReason(deadline, AbortSource.TIMEOUT, 'upstream request deadline');
    const waiterError = await capturedFailure(waiter);
    assertEqual(waiterError.name, 'AbortError');
    assertEqual(waiterError.abortSource, AbortSource.TIMEOUT);
    assertEqual(fetchCalls, 1);
    const audit = llmGateway.getAuditLogs().slice(auditStart);
    const timeout = audit.find(entry => entry.event === 'LLM_CALL_TIMEOUT');
    assert(timeout);
    assertEqual(timeout.timeoutOrigin, 'upstream');
    assertEqual(timeout.queue, true);
    assertEqual(audit.some(entry => entry.event === 'LLM_CALL_CANCELLED'), false);

    resolveOwner(providerResponse({ json: { message: { content: 'owner complete' } } }));
    assertEqual((await owner).content, 'owner complete');
    assertSemaphoreReleased();
  });

  await testAsync('queue deadline is typed and cannot consume the owner slot', async () => {
    const previousQueueTimeout = llmGateway._concurrency.queueTimeout;
    let resolveOwner;
    let ownerStarted;
    const started = new Promise(resolve => { ownerStarted = resolve; });
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      if (fetchCalls !== 1) throw new Error('timed-out waiter reached provider');
      ownerStarted();
      return new Promise(resolve => { resolveOwner = resolve; });
    };

    try {
      llmGateway._concurrency.queueTimeout = 5;
      const owner = callWithPolicy(makeToken(), 'owner', {
        model: 'fixture-model:1b',
        capability: 'reasoning',
        timeout: 1000,
        correlation: correlation('queue-timeout-owner'),
      });
      await started;
      const waiterError = await capturedFailure(callWithPolicy(makeToken(), 'waiter', {
        model: 'fixture-model:1b',
        capability: 'reasoning',
        timeout: 1000,
        correlation: correlation('queue-timeout-waiter'),
      }));
      assertEqual(waiterError.code, LLMGatewayErrorCode.QUEUE_TIMEOUT);
      assertEqual(fetchCalls, 1);
      assertEqual(llmGateway.getConcurrencyStats().active, 1);
      assertEqual(llmGateway.getConcurrencyStats().queued, 0);

      resolveOwner(providerResponse({ json: { message: { content: 'owner complete' } } }));
      assertEqual((await owner).content, 'owner complete');
      assertSemaphoreReleased();
    } finally {
      llmGateway._concurrency.queueTimeout = previousQueueTimeout;
    }
  });
} finally {
  globalThis.fetch = originalFetch;
  modelUniverseStore.recordSignalEvent = originalSignalRecorder;
  llmGateway._concurrency.max = originalConcurrencyMax;
  llmGateway._concurrency.queueTimeout = originalQueueTimeout;
  llmGateway.strictMode = originalStrictMode;
  llmGateway.currentAuth = originalCurrentAuth;
  // A failure must not leak an owned slot into later programs.
  llmGateway._concurrency.active = 0;
  llmGateway._concurrency.queue.length = 0;
}

summary();
