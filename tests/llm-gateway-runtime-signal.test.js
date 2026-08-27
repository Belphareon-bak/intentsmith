#!/usr/bin/env node

import {
  assert,
  assertEqual,
  suite,
  summary,
  testAsync,
} from './harness.js';
import { config } from '../src/config.js';
import { llmGateway } from '../src/llm/gateway.js';
import { setNumCtx } from '../src/llm/model-ctx.js';
import { modelUniverseStore } from '../src/upgrade/model-universe-store.js';
import { CREDecisionEngine } from '../src/chat/cre-decision.js';
import {
  AbortSource,
  abortWithReason,
} from '../src/core/abort-error.js';

const originalFetch = globalThis.fetch;
const originalRecordSignalEvent = modelUniverseStore.recordSignalEvent;
const originalRetries = config.ollama.retries;

const signals = [];
let requestBody = null;

try {
  llmGateway.disableStrictMode();
  config.ollama.retries = 1;
  modelUniverseStore.recordSignalEvent = event => {
    signals.push(event);
    return { ok: true };
  };

  suite('LLM gateway runtime evidence');

  await testAsync('uses registered num_ctx and records a successful runtime signal', async () => {
    signals.length = 0;
    requestBody = null;
    setNumCtx('test-model:1b', 6144);
    globalThis.fetch = async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          message: { content: 'ok' },
          done_reason: 'stop',
          prompt_eval_count: 4,
          eval_count: 1,
        }),
      };
    };

    const result = await llmGateway.call('test prompt', {
      model: 'test-model:1b',
      requestType: 'gate0-test',
      maxTokens: 16,
    });

    assertEqual(result.content, 'ok');
    assertEqual(result.finishReason, 'stop');
    assertEqual(requestBody.options.num_ctx, 6144);
    assertEqual(signals.length, 1);
    assertEqual(signals[0].signalType, 'runtime');
    assertEqual(signals[0].success, true);
    assertEqual(signals[0].payload.requestType, 'gate0-test');
    assertEqual(signals[0].payload.outputLength, 2);
  });

  await testAsync('records a failed runtime signal after the final attempt', async () => {
    signals.length = 0;
    globalThis.fetch = async () => {
      const error = new Error('offline');
      error.code = 'ECONNREFUSED';
      throw error;
    };

    let error;
    try {
      await llmGateway.call('test failure', {
        model: 'test-model:1b',
        requestType: 'gate0-test',
      });
    } catch (caught) {
      error = caught;
    }

    assert(error, 'failed request must reject');
    assertEqual(signals.length, 1);
    assertEqual(signals[0].signalType, 'runtime_failed');
    assertEqual(signals[0].success, false);
    assertEqual(signals[0].errorType, 'LLM_PROVIDER_UNAVAILABLE');
  });

  await testAsync('pre-aborted requests cancel once without reaching fetch', async () => {
    signals.length = 0;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error('fetch must not run for a pre-aborted request');
    };
    const controller = new AbortController();
    controller.abort();

    let error;
    try {
      await llmGateway.call('cancelled request', {
        model: 'test-model:1b',
        requestType: 'gate0-test',
        signal: controller.signal,
      });
    } catch (caught) {
      error = caught;
    }

    assert(error, 'cancelled request must reject');
    assertEqual(error.message, 'LLM call cancelled by user');
    assertEqual(error.name, 'AbortError');
    assertEqual(error.abortSource, AbortSource.USER);
    assertEqual(fetchCalls, 0);
    assertEqual(signals.length, 1);
    assertEqual(signals[0].signalType, 'runtime_cancelled');
    assertEqual(signals[0].success, null);
  });

  await testAsync('CRE classification propagates active cancellation to the LLM gateway', async () => {
    signals.length = 0;
    let fetchStarted;
    const started = new Promise(resolve => { fetchStarted = resolve; });
    globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
      fetchStarted();
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    });

    const controller = new AbortController();
    const engine = new CREDecisionEngine();
    const classification = engine._llmClassifyIntent(
      'Vysvětli podrobně historii počítačů.',
      { sessionId: 'cre-cancel-test', signal: controller.signal },
    );
    await started;
    controller.abort();

    let cancellationError;
    try {
      await classification;
    } catch (error) {
      cancellationError = error;
    }
    assert(cancellationError, 'CRE cancellation must reject');
    assertEqual(cancellationError.name, 'AbortError');
    assertEqual(cancellationError.abortSource, AbortSource.USER);
    assertEqual(signals.length, 1);
    assertEqual(signals[0].signalType, 'runtime_cancelled');
    assertEqual(signals[0].success, null);
  });

  await testAsync('propagates an upstream stale timeout without attributing it to the user', async () => {
    signals.length = 0;
    const auditStart = llmGateway.getAuditLogs().length;
    let fetchStarted;
    const started = new Promise(resolve => { fetchStarted = resolve; });
    globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
      fetchStarted();
      options.signal.addEventListener('abort', () => {
        reject(options.signal.reason);
      }, { once: true });
    });

    const controller = new AbortController();
    const pending = llmGateway.call('stale request', {
      model: 'test-model:1b',
      requestType: 'gate0-test',
      signal: controller.signal,
    });
    await started;
    abortWithReason(
      controller,
      AbortSource.TIMEOUT,
      'Stale turn timeout after 300000ms',
    );

    let timeoutError;
    try {
      await pending;
    } catch (error) {
      timeoutError = error;
    }

    assert(timeoutError, 'stale timeout must reject');
    assertEqual(timeoutError.name, 'AbortError');
    assertEqual(timeoutError.abortSource, AbortSource.TIMEOUT);
    assertEqual(timeoutError.message, 'Stale turn timeout after 300000ms');
    assertEqual(signals.length, 1);
    assertEqual(signals[0].signalType, 'runtime_timeout');
    assertEqual(signals[0].success, false);
    assertEqual(signals[0].payload.timeoutOrigin, 'upstream');
    assertEqual(signals[0].payload.timeoutMs, null);
    const timeoutAudit = llmGateway.getAuditLogs()
      .slice(auditStart)
      .find(entry => entry.event === 'LLM_CALL_TIMEOUT');
    assert(timeoutAudit, 'upstream timeout must create an audit entry');
    assertEqual(timeoutAudit.timeoutOrigin, 'upstream');
    assertEqual(timeoutAudit.timeout, null);
  });

  await testAsync('native AbortSignal.timeout is classified as upstream timeout before fetch', async () => {
    signals.length = 0;
    const auditStart = llmGateway.getAuditLogs().length;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error('fetch must not run for an expired timeout signal');
    };
    const signal = AbortSignal.timeout(1);
    await new Promise(resolve => {
      signal.addEventListener('abort', resolve, { once: true });
    });

    let timeoutError;
    try {
      await llmGateway.call('expired request', {
        model: 'test-model:1b',
        requestType: 'gate0-test',
        signal,
      });
    } catch (error) {
      timeoutError = error;
    }

    assert(timeoutError, 'expired timeout signal must reject');
    assertEqual(timeoutError.name, 'AbortError');
    assertEqual(timeoutError.abortSource, AbortSource.TIMEOUT);
    assertEqual(fetchCalls, 0);
    assertEqual(signals.length, 1);
    assertEqual(signals[0].signalType, 'runtime_timeout');
    assertEqual(signals[0].success, false);
    assertEqual(signals[0].payload.timeoutOrigin, 'upstream');
    assertEqual(signals[0].payload.timeoutMs, null);
    const timeoutAudit = llmGateway.getAuditLogs()
      .slice(auditStart)
      .find(entry => entry.event === 'LLM_CALL_TIMEOUT');
    assert(timeoutAudit, 'native upstream timeout must create an audit entry');
    assertEqual(timeoutAudit.timeoutOrigin, 'upstream');
    assertEqual(timeoutAudit.timeout, null);
  });

  await testAsync('gateway-owned deadline records its configured threshold', async () => {
    signals.length = 0;
    const auditStart = llmGateway.getAuditLogs().length;
    globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        reject(options.signal.reason);
      }, { once: true });
    });

    let timeoutError;
    try {
      await llmGateway.call('gateway deadline', {
        model: 'test-model:1b',
        requestType: 'gate0-test',
        timeout: 5,
      });
    } catch (error) {
      timeoutError = error;
    }

    assert(timeoutError, 'gateway deadline must reject');
    assertEqual(timeoutError.name, 'AbortError');
    assertEqual(timeoutError.abortSource, AbortSource.TIMEOUT);
    assertEqual(timeoutError.message, 'LLM timeout after 5ms (model: test-model:1b)');
    assertEqual(signals.length, 1);
    assertEqual(signals[0].signalType, 'runtime_timeout');
    assertEqual(signals[0].payload.timeoutOrigin, 'gateway');
    assertEqual(signals[0].payload.timeoutMs, 5);
    const timeoutAudit = llmGateway.getAuditLogs()
      .slice(auditStart)
      .find(entry => entry.event === 'LLM_CALL_TIMEOUT');
    assert(timeoutAudit, 'gateway timeout must create an audit entry');
    assertEqual(timeoutAudit.timeoutOrigin, 'gateway');
    assertEqual(timeoutAudit.timeout, 5);
  });
} finally {
  globalThis.fetch = originalFetch;
  modelUniverseStore.recordSignalEvent = originalRecordSignalEvent;
  config.ollama.retries = originalRetries;
  llmGateway.enableStrictMode();
}

summary();
