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
    assertEqual(signals[0].errorType, 'ECONNREFUSED');
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
    assertEqual(signals.length, 1);
    assertEqual(signals[0].signalType, 'runtime_cancelled');
    assertEqual(signals[0].success, null);
  });
} finally {
  globalThis.fetch = originalFetch;
  modelUniverseStore.recordSignalEvent = originalRecordSignalEvent;
  config.ollama.retries = originalRetries;
  llmGateway.enableStrictMode();
}

summary();
