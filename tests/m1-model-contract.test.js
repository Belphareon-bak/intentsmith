#!/usr/bin/env node

import { callLLM } from '../src/planner/workflow.js';

import {
  assert,
  assertEqual,
  assertThrows,
  suite,
  test,
  summary,
  testAsync,
} from './harness.js';
import {
  AbortSource,
  abortWithReason,
} from '../src/core/abort-error.js';
import {
  LLMGatewayError,
  LLMGatewayErrorCode,
  callWithAuth,
  callWithPolicy as callGatewayWithPolicy,
  llmGateway,
} from '../src/llm/gateway.js';
import { MODEL_RUNTIME_PROFILE } from '../src/llm/model-runtime-profile.js';
import {
  LLMCallerRole,
  LLMOperation,
  RoleTokenLimits,
  authTokenOperation,
  createAuthToken,
  createSpecDocumentAuthToken,
  validateAuthToken,
} from '../src/llm/auth-types.js';
import {
  executeM1ModelRequest,
  mapM1ModelFailure,
} from '../src/llm/cre-bridge.js';
import { config } from '../src/config.js';
import { validateModelResult } from '../contracts/m1/index.js';
import { modelUniverseStore } from '../src/upgrade/model-universe-store.js';

const originalFetch = globalThis.fetch;
const originalSignalRecorder = modelUniverseStore.recordSignalEvent;
const originalConcurrencyMax = llmGateway._concurrency.max;
const originalQueueTimeout = llmGateway._concurrency.queueTimeout;
const originalStrictMode = llmGateway.strictMode;
const originalCurrentAuth = llmGateway.currentAuth;
const originalVramFitProfiles = llmGateway._vramFitProfiles;
const originalModelBindings = { ...config.models };

let tokenSequence = 0;
const secretCanary = 'private-prompt-canary-never-audit';
const runtimeSignals = [];
const FIT_VRAM_PROFILE = Object.freeze({
  modelWeightsMb: 1040,
  kvMbPer1k: 9,
  observeVram: async () => ({
    totalMb: 32768,
    freeMb: 32768,
    source: 'm1-fixture',
  }),
});
const FIT_VRAM_PROFILES = Object.freeze({
  'fixture-model:1b': FIT_VRAM_PROFILE,
});

function callWithPolicy(token, prompt, options = {}) {
  return callGatewayWithPolicy(token, prompt, options);
}

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

function modelRequest(suffix, overrides = {}) {
  return {
    contract: 'ModelRequest',
    version: 1,
    requestId: `m1-adapter-request-${suffix}`,
    conversationId: `m1-adapter-conversation-${suffix}`,
    turnId: `m1-adapter-turn-${suffix}`,
    callerRole: LLMCallerRole.CRE_DECISION,
    modelRole: 'CHAT',
    purpose: 'answer',
    prompt: secretCanary,
    ...overrides,
  };
}

function modelAuthority(request, overrides = {}) {
  return createAuthToken({
    role: request.callerRole,
    decisionId: request.requestId,
    auditContext: {
      sessionId: request.conversationId,
      stepId: request.turnId,
    },
    ...overrides,
  });
}

function executeAuthorizedModelRequest(request, runtime = {}) {
  return executeM1ModelRequest(request, {
    ...runtime,
    authToken: modelAuthority(request),
  });
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

function assertM1TerminalAudit(
  auditStart,
  request,
  result,
  expectedCallerRole = request.callerRole,
) {
  const entries = llmGateway.getAuditLogs().slice(auditStart).filter(entry => (
    entry.event === 'M1_MODEL_RESULT'
    && entry.requestId === request.requestId
  ));
  assertEqual(entries.length, 1, 'request must emit exactly one M1 terminal audit');
  const [entry] = entries;
  assertEqual(entry.requestId, result.requestId);
  assertEqual(entry.conversationId, result.conversationId);
  assertEqual(entry.turnId, result.turnId);
  assertEqual(entry.callerRole, expectedCallerRole);
  assertEqual(
    entry.modelRole,
    ['D1', 'D2', 'CODE', 'R1', 'R2', 'CHAT'].includes(request.modelRole)
      ? request.modelRole
      : null,
  );
  assertEqual(entry.purpose, request.purpose);
  assertEqual(entry.status, result.status);
  assertEqual(entry.errorCode, result.error?.code ?? null);
  return entry;
}

try {
  modelUniverseStore.recordSignalEvent = event => {
    runtimeSignals.push(event);
    return { ok: true };
  };
  llmGateway._concurrency.max = 1;
  llmGateway._concurrency.queueTimeout = 1000;
  llmGateway._vramFitProfiles = FIT_VRAM_PROFILES;

  suite('M1 model gateway policy — exact provider outcome');

  await testAsync('reference profile caps both policy and legacy provider wires', async () => {
    const providerBodies = [];
    const previousProfiles = llmGateway._vramFitProfiles;
    llmGateway._vramFitProfiles = Object.freeze({
      ...previousProfiles,
      [MODEL_RUNTIME_PROFILE.model]: Object.freeze({
        modelWeightsMb: 1000,
        kvMbPer1k: 100,
        observeVram: async () => ({
          totalMb: 2500,
          freeMb: 2500,
          source: 'profile-cap-boundary',
        }),
      }),
    });
    globalThis.fetch = async (_url, options = {}) => {
      providerBodies.push(JSON.parse(options.body));
      return providerResponse({
        json: {
          message: { content: 'profile-capped' },
          prompt_eval_count: 2,
          eval_count: 1,
        },
      });
    };

    try {
      await callWithPolicy(makeToken(), 'policy profile cap', {
        model: MODEL_RUNTIME_PROFILE.model,
        num_ctx: MODEL_RUNTIME_PROFILE.contextWindowTokens * 2,
        capability: 'reasoning',
        maxTokens: 8,
        correlation: correlation('profile-policy-cap'),
      });
      await callWithAuth(makeToken(), 'legacy profile cap', {
        model: MODEL_RUNTIME_PROFILE.model,
        num_ctx: MODEL_RUNTIME_PROFILE.contextWindowTokens * 2,
        maxTokens: 8,
        retries: 1,
        correlation: correlation('profile-legacy-cap'),
      });
      await callWithPolicy(makeToken(), 'policy lower context', {
        model: MODEL_RUNTIME_PROFILE.model,
        num_ctx: 2048,
        capability: 'reasoning',
        maxTokens: 8,
        correlation: correlation('profile-policy-lower'),
      });

      assertEqual(providerBodies.length, 3);
      assertEqual(providerBodies[0].options.num_ctx, MODEL_RUNTIME_PROFILE.contextWindowTokens);
      assertEqual(providerBodies[1].options.num_ctx, MODEL_RUNTIME_PROFILE.contextWindowTokens);
      assertEqual(providerBodies[2].options.num_ctx, 2048);
      assertSemaphoreReleased();
    } finally {
      llmGateway._vramFitProfiles = previousProfiles;
    }
  });

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
      [{
        capability: 'reasoning',
        correlation: correlation('reserved-vram-override'),
        vramFitOptions: { reserveMb: 0 },
      }, LLMGatewayErrorCode.INVALID_REQUEST],
      [{
        capability: 'reasoning',
        correlation: correlation('reserved-vram-profiles'),
        _vramFitProfiles: {},
      }, LLMGatewayErrorCode.INVALID_REQUEST],
      [{
        capability: 'reasoning',
        correlation: correlation('reserved-vram-private-options'),
        _vramFitOptions: {},
      }, LLMGatewayErrorCode.INVALID_REQUEST],
      [{
        capability: 'reasoning',
        correlation: correlation('reserved-vram-required-flag'),
        _requireVramFit: false,
      }, LLMGatewayErrorCode.INVALID_REQUEST],
      [{
        capability: 'reasoning',
        correlation: correlation('invalid-num-ctx'),
        num_ctx: -1,
      }, LLMGatewayErrorCode.INVALID_REQUEST],
      [{
        model: { name: 'fixture-model:1b' },
        capability: 'reasoning',
        correlation: correlation('invalid-model-object'),
      }, LLMGatewayErrorCode.INVALID_REQUEST],
    ];

    for (const [options, expectedCode] of fixtures) {
      const error = await capturedFailure(callWithPolicy(token, 'not sent', {
        model: 'fixture-model:1b',
        ...options,
      }));
      assertEqual(error.code, expectedCode);
    }
    const inheritedOptions = Object.assign(
      Object.create({
        model: 'fixture:7b',
        num_ctx: 4096,
      }),
      {
        capability: 'reasoning',
        correlation: correlation('prototype-options'),
      },
    );
    const inheritedError = await capturedFailure(
      callWithPolicy(token, 'not sent', inheritedOptions),
    );
    assertEqual(inheritedError.code, LLMGatewayErrorCode.INVALID_REQUEST);
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

  await testAsync('known physical non-fit fails before provider, counters, or success evidence', async () => {
    runtimeSignals.length = 0;
    const auditStart = llmGateway.getAuditLogs().length;
    const callCountStart = llmGateway.callCount;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error('non-fit request reached provider');
    };

    const previousVramFitProfiles = llmGateway._vramFitProfiles;
    let error;
    try {
      llmGateway._vramFitProfiles = {
        'fixture:7b': {
          modelWeightsMb: 4760,
          kvMbPer1k: 63,
          observeVram: async () => ({
            totalMb: 6035,
            freeMb: 6035,
            source: 'm1-nonfit-fixture',
          }),
        },
      };
      error = await capturedFailure(callWithPolicy(makeToken(), 'non-fit', {
        model: 'fixture:7b',
        capability: 'reasoning',
        num_ctx: 4096,
        correlation: correlation('vram-nonfit'),
      }));
    } finally {
      llmGateway._vramFitProfiles = previousVramFitProfiles;
    }
    assertEqual(error.code, LLMGatewayErrorCode.MODEL_VRAM_NON_FIT);
    assertEqual(fetchCalls, 0);
    assertEqual(llmGateway.callCount, callCountStart);
    const audit = llmGateway.getAuditLogs().slice(auditStart);
    const nonfit = audit.find(entry => entry.event === 'LLM_CALL_VRAM_NON_FIT');
    assert(nonfit);
    assertEqual(nonfit.requiredMb, 5012);
    assertEqual(nonfit.totalMb, 6035);
    assertEqual(audit.some(entry => entry.event === 'LLM_CALL_COMPLETE'), false);
    assertEqual(runtimeSignals.length, 0);
    assertSemaphoreReleased();
  });

  await testAsync('trusted footprint is bound to the exact normalized model identity', async () => {
    const auditStart = llmGateway.getAuditLogs().length;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return providerResponse({ json: { message: { content: 'different model result' } } });
    };

    const previousVramFitProfiles = llmGateway._vramFitProfiles;
    let result;
    try {
      llmGateway._vramFitProfiles = {
        'fixture:7b': {
          modelWeightsMb: 4760,
          kvMbPer1k: 63,
          observeVram: async () => ({
            totalMb: 6035,
            freeMb: 6035,
            source: 'must-not-cross-models',
          }),
        },
      };
      result = await callWithPolicy(makeToken(), 'different-model', {
        model: 'fixture-other:7b',
        capability: 'reasoning',
        num_ctx: 4096,
        correlation: correlation('vram-model-binding'),
      });
    } finally {
      llmGateway._vramFitProfiles = previousVramFitProfiles;
    }
    assertEqual(result.content, 'different model result');
    assertEqual(fetchCalls, 1);
    const audit = llmGateway.getAuditLogs().slice(auditStart);
    const unknown = audit.find(entry => entry.event === 'LLM_VRAM_PREFLIGHT_UNKNOWN');
    assert(unknown);
    assertEqual(unknown.vramReason, 'VRAM_FOOTPRINT_UNKNOWN');
    assertEqual(audit.some(entry => entry.event === 'LLM_CALL_VRAM_NON_FIT'), false);
    assertSemaphoreReleased();
  });

  await testAsync('reclaimable VRAM remains unknown and continues one exact provider attempt', async () => {
    runtimeSignals.length = 0;
    const auditStart = llmGateway.getAuditLogs().length;
    let fetchCalls = 0;
    let requestBody = null;
    globalThis.fetch = async (_url, options) => {
      fetchCalls += 1;
      requestBody = JSON.parse(options.body);
      return providerResponse({ json: { message: { content: 'swap-safe result' } } });
    };

    const previousVramFitProfiles = llmGateway._vramFitProfiles;
    let result;
    try {
      llmGateway._vramFitProfiles = {
        'fixture:7b': {
          modelWeightsMb: 4760,
          kvMbPer1k: 63,
          observeVram: async () => ({
            totalMb: 8192,
            freeMb: 2048,
            source: 'm1-reclaim-fixture',
          }),
        },
      };
      result = await callWithPolicy(makeToken(), 'reclaimable', {
        model: 'fixture:7b',
        capability: 'reasoning',
        num_ctx: 4096,
        correlation: correlation('vram-reclaimable'),
      });
    } finally {
      llmGateway._vramFitProfiles = previousVramFitProfiles;
    }
    assertEqual(result.content, 'swap-safe result');
    assertEqual(fetchCalls, 1);
    assertEqual(requestBody.options.num_ctx, 4096);
    const audit = llmGateway.getAuditLogs().slice(auditStart);
    const unknown = audit.find(entry => entry.event === 'LLM_VRAM_PREFLIGHT_UNKNOWN');
    assert(unknown);
    assertEqual(unknown.vramReason, 'VRAM_CURRENT_FREE_INSUFFICIENT');
    assertEqual(audit.some(entry => entry.event === 'LLM_CALL_COMPLETE'), true);
    assertEqual(runtimeSignals.length, 1);
    assertEqual(runtimeSignals[0].signalType, 'runtime');
    assertSemaphoreReleased();
  });

  await testAsync('broken trusted VRAM observation degrades to unknown without leaking ownership', async () => {
    const auditStart = llmGateway.getAuditLogs().length;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return providerResponse({ json: { message: { content: 'observer-safe result' } } });
    };

    const previousVramFitProfiles = llmGateway._vramFitProfiles;
    let result;
    try {
      llmGateway._vramFitProfiles = {
        'fixture-model:1b': {
          modelWeightsMb: 1040,
          kvMbPer1k: 9,
          observeVram: async () => ({
            get totalMb() { throw new Error('fixture VRAM getter failed'); },
            freeMb: 32768,
            source: 'broken-fixture',
          }),
        },
      };
      result = await callWithPolicy(makeToken(), 'broken-observer', {
        model: 'fixture-model:1b',
        capability: 'reasoning',
        correlation: correlation('vram-observer-failure'),
      });
    } finally {
      llmGateway._vramFitProfiles = previousVramFitProfiles;
    }
    assertEqual(result.content, 'observer-safe result');
    assertEqual(fetchCalls, 1);
    const audit = llmGateway.getAuditLogs().slice(auditStart);
    const unknown = audit.find(entry => entry.event === 'LLM_VRAM_PREFLIGHT_UNKNOWN');
    assert(unknown);
    assertEqual(unknown.vramReason, 'VRAM_OBSERVATION_UNAVAILABLE');
    assertSemaphoreReleased();
  });

  suite('M1 model gateway policy — cancellation and semaphore ownership');

  await testAsync('cancel and deadline during VRAM preflight never reach provider or a slot', async () => {
    runtimeSignals.length = 0;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error('preflight-only request reached provider');
    };
    const previousVramFitProfiles = llmGateway._vramFitProfiles;

    try {
      let cancelObserverCalls = 0;
      llmGateway._vramFitProfiles = {
        'fixture-model:1b': {
          modelWeightsMb: 1040,
          kvMbPer1k: 9,
          observeVram: async () => {
            cancelObserverCalls += 1;
            return new Promise(() => {});
          },
        },
      };
      const cancelAuditStart = llmGateway.getAuditLogs().length;
      const controller = new AbortController();
      const cancelled = callWithPolicy(makeToken(), 'cancel-preflight', {
        model: 'fixture-model:1b',
        capability: 'reasoning',
        timeout: 1000,
        signal: controller.signal,
        correlation: correlation('cancel-during-preflight'),
      });
      await new Promise(resolve => setImmediate(resolve));
      assertEqual(cancelObserverCalls, 1);
      abortWithReason(controller, AbortSource.USER, 'cancel VRAM preflight fixture');
      const cancelError = await capturedFailure(cancelled);
      assertEqual(cancelError.name, 'AbortError');
      assertEqual(cancelError.abortSource, AbortSource.USER);
      const cancelAudit = llmGateway.getAuditLogs().slice(cancelAuditStart);
      const cancelEvent = cancelAudit.find(entry => entry.event === 'LLM_CALL_CANCELLED');
      assert(cancelEvent);
      assertEqual(cancelEvent.preflight, true);
      assertSemaphoreReleased();

      let timeoutObserverCalls = 0;
      llmGateway._vramFitProfiles = {
        'fixture-model:1b': {
          modelWeightsMb: 1040,
          kvMbPer1k: 9,
          observeVram: async () => {
            timeoutObserverCalls += 1;
            return new Promise(() => {});
          },
        },
      };
      const timeoutAuditStart = llmGateway.getAuditLogs().length;
      const timeoutError = await capturedFailure(callWithPolicy(makeToken(), 'timeout-preflight', {
        model: 'fixture-model:1b',
        capability: 'reasoning',
        timeout: 5,
        correlation: correlation('timeout-during-preflight'),
      }));
      assertEqual(timeoutObserverCalls, 1);
      assertEqual(timeoutError.name, 'AbortError');
      assertEqual(timeoutError.abortSource, AbortSource.TIMEOUT);
      const timeoutAudit = llmGateway.getAuditLogs().slice(timeoutAuditStart);
      const timeoutEvent = timeoutAudit.find(entry => entry.event === 'LLM_CALL_TIMEOUT');
      assert(timeoutEvent);
      assertEqual(timeoutEvent.preflight, true);
      assertEqual(timeoutEvent.timeoutOrigin, 'preflight');
      assertSemaphoreReleased();
    } finally {
      llmGateway._vramFitProfiles = previousVramFitProfiles;
    }

    assertEqual(fetchCalls, 0);
    assertEqual(runtimeSignals.length, 0);
  });

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
    const preAuditStart = llmGateway.getAuditLogs().length;
    let preflightObserverCalls = 0;
    const previousVramFitProfiles = llmGateway._vramFitProfiles;
    let preError;
    try {
      llmGateway._vramFitProfiles = {
        'fixture-model:1b': {
          modelWeightsMb: 1040,
          kvMbPer1k: 9,
          observeVram: async () => {
            preflightObserverCalls += 1;
            return { totalMb: 32768, freeMb: 32768, source: 'should-not-run' };
          },
        },
      };
      preError = await capturedFailure(callWithPolicy(makeToken(), 'pre', {
        model: 'fixture-model:1b',
        capability: 'reasoning',
        signal: pre.signal,
        correlation: correlation('pre-cancel'),
      }));
    } finally {
      llmGateway._vramFitProfiles = previousVramFitProfiles;
    }
    assertEqual(preError.name, 'AbortError');
    assertEqual(preError.abortSource, AbortSource.USER);
    assertEqual(preflightObserverCalls, 0);
    assertEqual(fetchCalls, 0);
    const preAudit = llmGateway.getAuditLogs().slice(preAuditStart);
    const preCancelled = preAudit.find(entry => entry.event === 'LLM_CALL_CANCELLED');
    assert(preCancelled);
    assertEqual(preCancelled.preflight, true);
    assertEqual(preCancelled.abortSource, AbortSource.USER);
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

  suite('M1 model auth — issued, immutable process-local authority');

  test('token factory rejects prototype roles and freezes all authority fields', () => {
    assertThrows(() => createAuthToken({
      role: 'toString',
      decisionId: 'prototype-role-to-string',
      auditContext: { sessionId: 'prototype-role-session' },
    }));
    assertThrows(() => createAuthToken({
      role: 'constructor',
      decisionId: 'prototype-role-constructor',
      auditContext: { sessionId: 'prototype-role-session' },
    }));

    const token = makeToken();
    assertEqual(validateAuthToken(token).valid, true);
    assertEqual(Object.isFrozen(token), true);
    assertEqual(Object.isFrozen(token.allowedCapabilities), true);
    assertEqual(Object.isFrozen(token.auditContext), true);
    assertThrows(() => token.allowedCapabilities.push('code_generation'));
    assertThrows(() => { token.maxTokens = 65536; });
    assertThrows(() => createAuthToken({
      role: LLMCallerRole.CRE_DECISION,
      decisionId: 'unknown-capability',
      auditContext: { sessionId: 'unknown-capability-session' },
      capabilities: ['not-a-capability'],
    }));
  });

  await testAsync('forged, spread, and cloned token fields never authorize a provider effect', async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error('forged token reached provider');
    };
    const issued = makeToken();
    const fixtures = [
      { ...issued },
      structuredClone(issued),
      {
        role: 'ATTACKER',
        decisionId: 'forged-attacker',
        maxTokens: 65536,
        allowedCapabilities: ['reasoning'],
        auditContext: { sessionId: 'forged-session' },
        issuedAt: Date.now(),
        expiresAt: Date.now() + 300000,
      },
    ];
    for (let index = 0; index < fixtures.length; index += 1) {
      const forged = fixtures[index];
      assertEqual(validateAuthToken(forged).valid, false);
      const error = await capturedFailure(callWithPolicy(forged, 'not sent', {
        model: 'fixture-model:1b',
        capability: 'reasoning',
        correlation: {
          ...correlation(`forged-${index}`),
          callerRole: forged.role,
        },
      }));
      assertEqual(error.code, LLMGatewayErrorCode.AUTHORIZATION_DENIED);
    }
    assertEqual(fetchCalls, 0);
    assertSemaphoreReleased();
  });

  suite('M1 ModelRequest adapter — exact terminal connector');

  config.models.CHAT = 'fixture-model:1b';

  await testAsync('payload identity never mints, copies, mismatches, or elevates authority', async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error('unauthorized adapter request reached provider');
    };
    const request = modelRequest('authority-boundary');
    const issued = modelAuthority(request);
    const otherRequest = modelRequest('foreign-authority');
    const fixtures = [
      [null, 'MODEL_AUTHORIZATION_REQUIRED', null],
      [{ ...issued }, 'MODEL_AUTHORIZATION_REQUIRED', null],
      [modelAuthority(otherRequest), 'MODEL_AUTHORIZATION_MISMATCH', request.callerRole],
      [modelAuthority(request, { maxTokens: 65536 }), 'MODEL_AUTHORIZATION_INVALID', request.callerRole],
    ];
    for (const [authToken, expectedCode, expectedCallerRole] of fixtures) {
      const auditStart = llmGateway.getAuditLogs().length;
      const result = await executeM1ModelRequest(request, { authToken });
      assertEqual(validateModelResult(result).valid, true);
      assertEqual(result.status, 'error');
      assertEqual(result.error.code, expectedCode);
      assertM1TerminalAudit(auditStart, request, result, expectedCallerRole);
    }
    for (const signal of [
      'not-an-abort-signal',
      { aborted: false },
      Object.create(AbortSignal.prototype),
    ]) {
      const runtimeError = await capturedFailure(executeM1ModelRequest(request, {
        authToken: issued,
        signal,
      }));
      assertEqual(runtimeError.code, 'M1_MODEL_RUNTIME_INVALID');
    }
    assertEqual(fetchCalls, 0);
    assertSemaphoreReleased();
  });

  await testAsync('typed adapter accepts only the exact complete-SPEC operation above planner default', async () => {
    const priorD1 = config.models.D1;
    let fetchCalls = 0;
    let body = null;
    globalThis.fetch = async (_url, options) => {
      fetchCalls += 1;
      body = JSON.parse(options.body);
      return providerResponse({ json: { message: { content: '{"title":"Complete"}' }, done_reason: 'stop' } });
    };
    try {
      config.models.D1 = 'fixture-model:1b';
      const request = modelRequest('spec-document-operation', {
        callerRole: LLMCallerRole.WORKFLOW_PLANNER,
        modelRole: 'D1',
        purpose: 'answer',
        parameters: { format: 'json', maxTokens: 6000 },
      });
      const token = createSpecDocumentAuthToken({
        decisionId: request.requestId,
        auditContext: { sessionId: request.conversationId, stepId: request.turnId },
      });
      const result = await executeM1ModelRequest(request, { authToken: token });
      assertEqual(result.status, 'ok');
      assertEqual(fetchCalls, 1);
      assertEqual(body.options.num_predict, 6000);
      assertEqual(authTokenOperation(token), LLMOperation.WORKFLOW_SPEC_DOCUMENT_JSON_V1);

      const wrongPurpose = { ...request, purpose: 'refine' };
      const wrongResult = await executeM1ModelRequest(wrongPurpose, { authToken: token });
      assertEqual(wrongResult.error?.code, 'MODEL_AUTHORIZATION_INVALID');
      assertEqual(fetchCalls, 1, 'wrong operation purpose produces zero provider calls');

      const ordinary = modelAuthority(request, { maxTokens: 6000 });
      const ordinaryResult = await executeM1ModelRequest(request, { authToken: ordinary });
      assertEqual(ordinaryResult.error?.code, 'MODEL_AUTHORIZATION_INVALID');
      assertEqual(fetchCalls, 1, 'ordinary planner token above its role default produces zero provider calls');

      const copiedResult = await executeM1ModelRequest(request, { authToken: { ...token } });
      assertEqual(copiedResult.error?.code, 'MODEL_AUTHORIZATION_REQUIRED');
      assertEqual(fetchCalls, 1, 'copied operation token produces zero provider calls');
    } finally {
      if (priorD1 === undefined) delete config.models.D1;
      else config.models.D1 = priorD1;
    }
  });

  await testAsync('request identity and nested parameters are snapshotted before asynchronous work', async () => {
    const request = modelRequest('snapshot', {
      parameters: { maxTokens: 17, num_ctx: 4096 },
    });
    const originalIdentity = {
      requestId: request.requestId,
      conversationId: request.conversationId,
      turnId: request.turnId,
    };
    const authToken = modelAuthority(request);
    const priorProfiles = llmGateway._vramFitProfiles;
    let observeStarted;
    let resolveObservation;
    const started = new Promise(resolve => { observeStarted = resolve; });
    const observation = new Promise(resolve => { resolveObservation = resolve; });
    let body = null;
    globalThis.fetch = async (_url, options) => {
      body = JSON.parse(options.body);
      return providerResponse({ json: { message: { content: 'snapshot result' } } });
    };

    let result;
    try {
      llmGateway._vramFitProfiles = {
        'fixture-model:1b': {
          modelWeightsMb: 1040,
          kvMbPer1k: 9,
          observeVram: async () => {
            observeStarted();
            return observation;
          },
        },
      };
      const pending = executeM1ModelRequest(request, { authToken });
      await started;
      request.requestId = 'mutated-request-id';
      request.conversationId = 'mutated-conversation-id';
      request.turnId = 'mutated-turn-id';
      request.parameters.maxTokens = 65536;
      request.parameters.num_ctx = 32768;
      resolveObservation({ totalMb: 32768, freeMb: 32768, source: 'snapshot-fixture' });
      result = await pending;
    } finally {
      llmGateway._vramFitProfiles = priorProfiles;
    }

    assertEqual(result.requestId, originalIdentity.requestId);
    assertEqual(result.conversationId, originalIdentity.conversationId);
    assertEqual(result.turnId, originalIdentity.turnId);
    assertEqual(body.options.num_predict, 17);
    assertEqual(body.options.num_ctx, 4096);
    assertSemaphoreReleased();
  });

  await testAsync('caller attribution survives token expiry after the authorized effect starts', async () => {
    const request = modelRequest('expiry-during-effect');
    const authToken = modelAuthority(request);
    const auditStart = llmGateway.getAuditLogs().length;
    const realDateNow = Date.now;
    const startedAt = realDateNow();
    globalThis.fetch = async () => {
      Date.now = () => startedAt + 360001;
      return providerResponse({ json: { message: { content: 'expiry result' } } });
    };

    let result;
    try {
      result = await executeM1ModelRequest(request, { authToken });
    } finally {
      Date.now = realDateNow;
    }

    assertEqual(result.status, 'ok');
    const terminal = llmGateway.getAuditLogs().slice(auditStart).find(entry => (
      entry.event === 'M1_MODEL_RESULT'
      && entry.requestId === request.requestId
    ));
    assert(terminal);
    assertEqual(terminal.callerRole, request.callerRole);
    assertSemaphoreReleased();
  });

  await testAsync('valid request binds configured model, role token cap, usage, and terminal audit', async () => {
    const auditStart = llmGateway.getAuditLogs().length;
    let fetchCalls = 0;
    let body = null;
    globalThis.fetch = async (_url, options) => {
      fetchCalls += 1;
      body = JSON.parse(options.body);
      return providerResponse({
        json: {
          message: { content: 'adapter answer' },
          prompt_eval_count: 7,
          eval_count: 5,
        },
      });
    };

    const request = modelRequest('success', {
      systemPrompt: 'bounded system instruction',
      parameters: {
        temperature: 0.2,
        maxTokens: 65536,
        num_ctx: 4096,
        format: 'json',
      },
    });
    const result = await executeAuthorizedModelRequest(request);

    assertEqual(fetchCalls, 1);
    assertEqual(validateModelResult(result).valid, true);
    assertEqual(result.status, 'ok');
    assertEqual(result.response.content, 'adapter answer');
    assertEqual(result.response.model, config.models.CHAT);
    assertEqual(result.response.usage.promptEvalCount, 7);
    assertEqual(result.response.usage.evalCount, 5);
    assertEqual(body.model, config.models.CHAT);
    assertEqual(body.options.num_predict, RoleTokenLimits.CRE_DECISION);
    assertEqual(body.options.num_ctx, 4096);
    assertEqual(body.format, 'json');

    assertM1TerminalAudit(auditStart, request, result);
    const audit = llmGateway.getAuditLogs().slice(auditStart);
    assertEqual(JSON.stringify(audit).includes(secretCanary), false);
    assertSemaphoreReleased();
  });

  await testAsync('workflow JSON opt-in reaches actual provider body and leaves plain outputs unchanged', async () => {
    const bodies = [];
    globalThis.fetch = async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return providerResponse({ json: { message: { content: '{"ok":true}' }, done_reason: 'stop' } });
    };
    const json = await callLLM('D1', 'Synthetic structured request', '', { format: 'json' });
    const plain = await callLLM('D1', 'Synthetic structured request');
    await callLLM('D1', 'Synthetic caller elevation request', '', { maxTokens: 6000 });
    await callLLM('CODE', 'Synthetic raw source request');
    assertEqual(bodies.length, 4);
    assertEqual(bodies[0].format, 'json');
    assertEqual(Object.hasOwn(bodies[1], 'format'), false);
    assertEqual(Object.hasOwn(bodies[3], 'format'), false);
    const { format, ...jsonWithoutFormat } = bodies[0];
    assertEqual(JSON.stringify(jsonWithoutFormat), JSON.stringify(bodies[1]));
    assertEqual(bodies[0].options.num_predict, 4000);
    assertEqual(bodies[2].options.num_predict, 4000);
    assertEqual(json.finishReason, 'stop');
    assertEqual(json.content, plain.content);
    assertSemaphoreReleased();
  });

  await testAsync('caller-purpose matrix preserves lifecycle code and review authority', async () => {
    let fetchCalls = 0;
    let body = null;
    globalThis.fetch = async (_url, options) => {
      fetchCalls += 1;
      body = JSON.parse(options.body);
      return providerResponse({ json: { message: { content: 'matrix result' } } });
    };

    const fixtures = [
      [LLMCallerRole.WORKFLOW_CODER, 'answer', 'CODE'],
      [LLMCallerRole.WORKFLOW_REVIEWER, 'refine', 'R1'],
      [LLMCallerRole.SYNTHESIZER, 'synthesize', 'R2'],
      [LLMCallerRole.WORKFLOW_CLASSIFIER, 'classify', 'D1'],
    ];
    for (let index = 0; index < fixtures.length; index += 1) {
      const [callerRole, purpose, modelRole] = fixtures[index];
      const request = modelRequest(`matrix-${index}`, {
        callerRole,
        purpose,
        modelRole,
      });
      const result = await executeAuthorizedModelRequest(request);
      assertEqual(result.status, 'ok');
      assertEqual(validateModelResult(result).valid, true);
      assertEqual(body.model, config.models[modelRole]);
    }
    assertEqual(fetchCalls, fixtures.length);
    assertSemaphoreReleased();
  });

  await testAsync('all text model roles are exact deployment bindings, never request overrides', async () => {
    let fetchCalls = 0;
    let body = null;
    globalThis.fetch = async (_url, options) => {
      fetchCalls += 1;
      body = JSON.parse(options.body);
      return providerResponse({ json: { message: { content: 'bound result' } } });
    };

    const modelRoles = ['D1', 'D2', 'CODE', 'R1', 'R2', 'CHAT'];
    for (const modelRole of modelRoles) {
      const request = modelRequest(`binding-${modelRole}`, {
        modelRole,
      });
      const result = await executeAuthorizedModelRequest(request);
      assertEqual(result.status, 'ok');
      assertEqual(result.response.model, config.models[modelRole]);
      assertEqual(body.model, config.models[modelRole]);
    }

    const overrideRequest = modelRequest('model-override', {
      parameters: { model: 'attacker-model:latest' },
    });
    const rejected = await executeAuthorizedModelRequest(overrideRequest);
    assertEqual(rejected.status, 'error');
    assertEqual(rejected.error.code, 'MODEL_PARAMETERS_INVALID');
    assertEqual(fetchCalls, modelRoles.length);
    assertSemaphoreReleased();
  });

  await testAsync('invalid roles, unsupported vision, and unauthorized purposes fail before provider', async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error('invalid request reached provider');
    };
    const fixtures = [
      [modelRequest('prototype-caller', { callerRole: 'toString' }), 'MODEL_CALLER_ROLE_INVALID', false],
      [modelRequest('constructor-caller', { callerRole: 'constructor' }), 'MODEL_CALLER_ROLE_INVALID', false],
      [modelRequest('legacy-caller', { callerRole: LLMCallerRole.LEGACY_DIRECT }), 'MODEL_CALLER_ROLE_UNSUPPORTED', false],
      [modelRequest('vision-role', { modelRole: 'VISION' }), 'MODEL_ROLE_UNSUPPORTED', true],
      [modelRequest('unknown-role', { modelRole: 'NOT_A_ROLE' }), 'MODEL_ROLE_INVALID', true],
      [modelRequest('purpose-denied', { callerRole: LLMCallerRole.SYNTHESIZER }), 'MODEL_PURPOSE_NOT_AUTHORIZED', true],
      [modelRequest('tool-purpose-gap', { callerRole: LLMCallerRole.TOOL_INTERNAL }), 'MODEL_PURPOSE_NOT_AUTHORIZED', true],
      [modelRequest('reserved-retries', { parameters: { retries: 3 } }), 'MODEL_PARAMETERS_INVALID', true],
      [modelRequest('reserved-auth', { parameters: { _authToken: 'forged' } }), 'MODEL_PARAMETERS_INVALID', true],
      [modelRequest('reserved-correlation', { parameters: { correlation: {} } }), 'MODEL_PARAMETERS_INVALID', true],
      [modelRequest('reserved-messages', { parameters: { messages: [] } }), 'MODEL_PARAMETERS_INVALID', true],
      [modelRequest('reserved-signal', { parameters: { signal: {} } }), 'MODEL_PARAMETERS_INVALID', true],
    ];
    for (const [request, expectedCode, authorize] of fixtures) {
      const auditStart = llmGateway.getAuditLogs().length;
      const result = authorize
        ? await executeAuthorizedModelRequest(request)
        : await executeM1ModelRequest(request);
      assertEqual(validateModelResult(result).valid, true);
      assertEqual(result.status, 'error');
      assertEqual(result.error.code, expectedCode);
      assertM1TerminalAudit(
        auditStart,
        request,
        result,
        authorize ? request.callerRole : null,
      );
    }

    const preAborted = new AbortController();
    abortWithReason(preAborted, AbortSource.USER, 'must not mask invalid parameters');
    const invalidParameterRequest = modelRequest('invalid-before-cancel', {
      parameters: { model: 'forged' },
    });
    const invalidParameterAuditStart = llmGateway.getAuditLogs().length;
    const invalidParameters = await executeAuthorizedModelRequest(
      invalidParameterRequest,
      { signal: preAborted.signal },
    );
    assertEqual(invalidParameters.status, 'error');
    assertEqual(invalidParameters.error.code, 'MODEL_PARAMETERS_INVALID');
    assertM1TerminalAudit(
      invalidParameterAuditStart,
      invalidParameterRequest,
      invalidParameters,
    );

    const invalid = modelRequest('structural-invalid');
    delete invalid.prompt;
    const invalidError = await capturedFailure(executeM1ModelRequest(invalid));
    assertEqual(invalidError.code, 'M1_MODEL_REQUEST_INVALID');
    assertEqual(fetchCalls, 0);
    assertSemaphoreReleased();
  });

  await testAsync('provider failures remain exact valid ModelResult terminals without false response', async () => {
    const fixtures = [
      [() => providerResponse({ json: { message: { content: '   ' } } }), LLMGatewayErrorCode.EMPTY_RESPONSE],
      [() => providerResponse({ json: { unexpected: true } }), LLMGatewayErrorCode.MALFORMED_RESPONSE],
      [() => providerResponse({ status: 404 }), LLMGatewayErrorCode.MODEL_NOT_FOUND],
      [() => providerResponse({ status: 500 }), LLMGatewayErrorCode.PROVIDER_HTTP_ERROR],
      [() => providerResponse({ status: 503 }), LLMGatewayErrorCode.PROVIDER_UNAVAILABLE],
      [() => {
        const error = new TypeError('fetch failed');
        error.cause = Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
        throw error;
      }, LLMGatewayErrorCode.PROVIDER_UNAVAILABLE],
    ];
    let fetchCalls = 0;
    for (let index = 0; index < fixtures.length; index += 1) {
      const [provider, expectedCode] = fixtures[index];
      globalThis.fetch = async () => {
        fetchCalls += 1;
        return provider();
      };
      const request = modelRequest(`provider-${index}`);
      const auditStart = llmGateway.getAuditLogs().length;
      const result = await executeAuthorizedModelRequest(request);
      assertEqual(validateModelResult(result).valid, true);
      assertEqual(result.status, 'error');
      assertEqual(result.error.code, expectedCode);
      assertEqual(Object.hasOwn(result, 'response'), false);
      assertEqual(JSON.stringify(result).includes(secretCanary), false);
      assertM1TerminalAudit(auditStart, request, result);
      assertSemaphoreReleased();
    }
    assertEqual(fetchCalls, fixtures.length);
  });

  await testAsync('unexpected provider errors leak neither response nor standard logs', async () => {
    const logCanary = 'LOG-SECRET-CANARY-9e7a';
    const capturedLogs = [];
    const originalConsoleLog = console.log;
    globalThis.fetch = async () => {
      throw new Error(logCanary);
    };
    console.log = (...args) => {
      capturedLogs.push(args.map(String).join(' '));
    };

    let result;
    const request = modelRequest('secret-log');
    const auditStart = llmGateway.getAuditLogs().length;
    try {
      result = await executeAuthorizedModelRequest(request);
    } finally {
      console.log = originalConsoleLog;
    }

    assertEqual(validateModelResult(result).valid, true);
    assertEqual(result.status, 'error');
    assertEqual(result.error.code, 'MODEL_PROCESSING_FAILED');
    assertEqual(JSON.stringify(result).includes(logCanary), false);
    assertEqual(capturedLogs.join('\n').includes(logCanary), false);
    assertM1TerminalAudit(auditStart, request, result);
    assertSemaphoreReleased();
  });

  await testAsync('user cancel, provider deadline, and queue timeout map to distinct terminal statuses', async () => {
    let fetchCalls = 0;
    globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
      fetchCalls += 1;
      options.signal.addEventListener('abort', () => reject(options.signal.reason), {
        once: true,
      });
    });

    const cancelledController = new AbortController();
    abortWithReason(cancelledController, AbortSource.USER, 'cancel adapter fixture');
    const cancelledRequest = modelRequest('cancelled');
    const cancelledAuditStart = llmGateway.getAuditLogs().length;
    const cancelled = await executeAuthorizedModelRequest(cancelledRequest, {
      signal: cancelledController.signal,
    });
    assertEqual(cancelled.status, 'cancelled');
    assertEqual(cancelled.error.code, 'MODEL_CANCELLED');
    assertM1TerminalAudit(cancelledAuditStart, cancelledRequest, cancelled);

    const timedOutRequest = modelRequest('timeout', {
      parameters: { timeout: 5 },
    });
    const timedOutAuditStart = llmGateway.getAuditLogs().length;
    const timedOut = await executeAuthorizedModelRequest(timedOutRequest);
    assertEqual(timedOut.status, 'timeout');
    assertEqual(timedOut.error.code, 'MODEL_TIMEOUT');
    assertM1TerminalAudit(timedOutAuditStart, timedOutRequest, timedOut);
    assertEqual(fetchCalls, 1);

    const queueTimeout = mapM1ModelFailure(
      modelRequest('queue-timeout'),
      new LLMGatewayError(
        LLMGatewayErrorCode.QUEUE_TIMEOUT,
        'Model request timed out while waiting for an execution slot.',
      ),
    );
    assertEqual(validateModelResult(queueTimeout).valid, true);
    assertEqual(queueTimeout.status, 'timeout');
    assertEqual(queueTimeout.error.code, LLMGatewayErrorCode.QUEUE_TIMEOUT);

    const generic = mapM1ModelFailure(
      modelRequest('generic-failure'),
      new Error(secretCanary),
    );
    assertEqual(generic.status, 'error');
    assertEqual(generic.error.code, 'MODEL_PROCESSING_FAILED');
    assertEqual(JSON.stringify(generic).includes(secretCanary), false);
    assertSemaphoreReleased();
  });
} finally {
  globalThis.fetch = originalFetch;
  modelUniverseStore.recordSignalEvent = originalSignalRecorder;
  llmGateway._concurrency.max = originalConcurrencyMax;
  llmGateway._concurrency.queueTimeout = originalQueueTimeout;
  llmGateway.strictMode = originalStrictMode;
  llmGateway.currentAuth = originalCurrentAuth;
  llmGateway._vramFitProfiles = originalVramFitProfiles;
  Object.assign(config.models, originalModelBindings);
  // A failure must not leak an owned slot into later programs.
  llmGateway._concurrency.active = 0;
  llmGateway._concurrency.queue.length = 0;
}

summary();
