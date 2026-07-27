import { describe, expect, it } from 'vitest';

import {
  PROVIDER_ERROR_CODES,
  isProviderErrorCode,
  type GenerationRequest,
  type InferenceEvent,
  type InferenceProvider,
} from '@intentsmith/core';

import { DEFAULT_FAKE_MODEL, FakeInferenceProvider, type FakeProviderMode } from './fake-provider.js';

/** Abstract provider behaviours the suite exercises. */
export type ProviderContractScenario =
  | 'healthy'
  | 'unavailable'
  | 'empty-model-list'
  | 'one-model'
  | 'streamed-response'
  | 'non-streamed-response'
  | 'timeout'
  | 'cancellation'
  | 'fail-before-first-token'
  | 'fail-mid-stream'
  | 'invalid-stream'
  | 'event-after-completed'
  | 'two-terminal-events'
  | 'unknown-model';

export type ProviderContractHarness = {
  name: string;
  /** Builds a provider configured for the given abstract scenario. */
  createProvider(scenario: ProviderContractScenario): InferenceProvider;
  /** A model id the provider is expected to serve. */
  knownModelId: string;
};

export async function collectEvents(stream: AsyncIterable<InferenceEvent>): Promise<InferenceEvent[]> {
  const events: InferenceEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const TERMINAL_EVENTS = new Set<InferenceEvent['type']>(['completed', 'failed']);

/** Index of the first terminal event, or -1 when the stream never terminated. */
export function terminalIndex(events: InferenceEvent[]): number {
  return events.findIndex(event => TERMINAL_EVENTS.has(event.type));
}

function baseRequest(modelId: string, overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return { modelId, prompt: 'ping', maxOutputTokens: 16, temperature: 0, ...overrides };
}

/**
 * Shared InferenceProvider contract suite.
 *
 * Phase 2 must be able to point this at a real adapter without editing it.
 */
export function runInferenceProviderContract(harness: ProviderContractHarness): void {
  describe(`InferenceProvider contract: ${harness.name}`, () => {
    it('exposes a stable identity', () => {
      const identity = harness.createProvider('healthy').identity();
      expect(identity.id).toMatch(/\S/);
      expect(identity.name).toMatch(/\S/);
      expect(identity.version).toMatch(/\S/);
    });

    it('reports healthy status', async () => {
      const health = await harness.createProvider('healthy').health();
      expect(health.status).toBe('healthy');
      expect(health.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('reports unavailable status without throwing', async () => {
      const health = await harness.createProvider('unavailable').health();
      expect(health.status).toBe('unavailable');
    });

    it('discovers capabilities', async () => {
      const capabilities = await harness.createProvider('healthy').capabilities();
      expect(typeof capabilities.streaming).toBe('boolean');
      expect(typeof capabilities.cancellation).toBe('boolean');
      expect(capabilities.maxConcurrentRequests).toBeGreaterThan(0);
    });

    it('lists one model', async () => {
      const models = await harness.createProvider('one-model').listModels();
      expect(models).toHaveLength(1);
      expect(models[0]?.id).toBe(harness.knownModelId);
    });

    it('lists an empty model set without throwing', async () => {
      expect(await harness.createProvider('empty-model-list').listModels()).toEqual([]);
    });

    it('surfaces PROVIDER_UNAVAILABLE from model discovery', async () => {
      await expect(harness.createProvider('unavailable').listModels()).rejects.toMatchObject({
        code: 'PROVIDER_UNAVAILABLE',
      });
    });

    it('streams a deterministic response ending in exactly one completed event', async () => {
      const provider = harness.createProvider('streamed-response');
      const events = await collectEvents(provider.generate(baseRequest(harness.knownModelId, { stream: true })));

      expect(events[0]).toMatchObject({ type: 'started' });
      expect(events.filter(event => event.type === 'token').length).toBeGreaterThan(0);
      expect(terminalIndex(events)).toBe(events.length - 1);
      const last = events.at(-1);
      expect(last?.type).toBe('completed');

      // Streaming twice must produce byte-identical output.
      const repeat = await collectEvents(provider.generate(baseRequest(harness.knownModelId, { stream: true })));
      expect(repeat).toEqual(events);
    });

    it('supports a non-streamed logical completion', async () => {
      const provider = harness.createProvider('non-streamed-response');
      const events = await collectEvents(provider.generate(baseRequest(harness.knownModelId, { stream: false })));
      expect(events.filter(event => event.type === 'token')).toHaveLength(0);
      const last = events.at(-1);
      expect(last?.type).toBe('completed');
      if (last?.type === 'completed') expect(last.text.length).toBeGreaterThan(0);
    });

    it('normalizes an unknown model to MODEL_NOT_FOUND', async () => {
      const events = await collectEvents(
        harness.createProvider('unknown-model').generate(baseRequest('definitely-not-a-model')),
      );
      const last = events.at(-1);
      expect(last?.type).toBe('failed');
      if (last?.type === 'failed') expect(last.error.code).toBe('MODEL_NOT_FOUND');
    });

    it('normalizes an invalid request to REQUEST_INVALID', async () => {
      const events = await collectEvents(
        harness.createProvider('healthy').generate(baseRequest(harness.knownModelId, { prompt: '' })),
      );
      const last = events.at(-1);
      expect(last?.type).toBe('failed');
      if (last?.type === 'failed') expect(last.error.code).toBe('REQUEST_INVALID');
    });

    it('normalizes a timeout to REQUEST_TIMEOUT', async () => {
      const events = await collectEvents(harness.createProvider('timeout').generate(baseRequest(harness.knownModelId)));
      const last = events.at(-1);
      expect(last?.type).toBe('failed');
      if (last?.type === 'failed') expect(last.error.code).toBe('REQUEST_TIMEOUT');
    });

    it('normalizes AbortSignal cancellation to REQUEST_CANCELLED', async () => {
      const controller = new AbortController();
      controller.abort();
      const events = await collectEvents(
        harness.createProvider('cancellation').generate(baseRequest(harness.knownModelId), controller.signal),
      );
      const last = events.at(-1);
      expect(last?.type).toBe('failed');
      if (last?.type === 'failed') expect(last.error.code).toBe('REQUEST_CANCELLED');
    });

    it('emits a terminal failure when it fails before the first token', async () => {
      const events = await collectEvents(
        harness.createProvider('fail-before-first-token').generate(baseRequest(harness.knownModelId)),
      );
      expect(events.filter(event => event.type === 'token')).toHaveLength(0);
      expect(events.at(-1)?.type).toBe('failed');
    });

    it('emits a terminal failure when it fails mid-stream', async () => {
      const events = await collectEvents(
        harness.createProvider('fail-mid-stream').generate(baseRequest(harness.knownModelId, { stream: true })),
      );
      expect(events.filter(event => event.type === 'token').length).toBeGreaterThan(0);
      expect(events.at(-1)?.type).toBe('failed');
    });

    it('normalizes an invalid stream to STREAM_INVALID', async () => {
      const events = await collectEvents(
        harness.createProvider('invalid-stream').generate(baseRequest(harness.knownModelId)),
      );
      const last = events.at(-1);
      expect(last?.type).toBe('failed');
      if (last?.type === 'failed') expect(last.error.code).toBe('STREAM_INVALID');
    });

    it('never uses an error code outside the normalized vocabulary', async () => {
      const modes: ProviderContractScenario[] = [
        'timeout',
        'fail-before-first-token',
        'fail-mid-stream',
        'invalid-stream',
        'unknown-model',
      ];
      for (const mode of modes) {
        const events = await collectEvents(
          harness.createProvider(mode).generate(baseRequest(mode === 'unknown-model' ? 'nope' : harness.knownModelId)),
        );
        for (const event of events) {
          if (event.type !== 'failed') continue;
          expect(isProviderErrorCode(event.error.code)).toBe(true);
          expect(PROVIDER_ERROR_CODES).toContain(event.error.code);
          expect(event.error.message).not.toMatch(/\s+at\s+.*:\d+:\d+/);
        }
      }
    });
  });
}

/**
 * Detects providers that keep emitting after a terminal event. These modes are
 * deliberate violations, so they are asserted separately from the conformance
 * suite above.
 */
export function runProviderStreamViolationChecks(
  name: string,
  createViolating: (mode: 'event-after-completed' | 'two-terminal-events') => InferenceProvider,
  knownModelId: string,
): void {
  describe(`InferenceProvider stream violations: ${name}`, () => {
    it('detects an event emitted after completed', async () => {
      const events = await collectEvents(createViolating('event-after-completed').generate(baseRequest(knownModelId)));
      expect(terminalIndex(events)).toBeLessThan(events.length - 1);
    });

    it('detects two terminal events', async () => {
      const events = await collectEvents(createViolating('two-terminal-events').generate(baseRequest(knownModelId)));
      expect(events.filter(event => TERMINAL_EVENTS.has(event.type)).length).toBeGreaterThan(1);
    });
  });
}

const FAKE_MODES: Record<ProviderContractScenario, FakeProviderMode> = {
  healthy: 'healthy',
  unavailable: 'unavailable',
  'empty-model-list': 'healthy',
  'one-model': 'healthy',
  'streamed-response': 'healthy',
  'non-streamed-response': 'healthy',
  timeout: 'timeout',
  cancellation: 'healthy',
  'fail-before-first-token': 'fail-before-first-token',
  'fail-mid-stream': 'fail-mid-stream',
  'invalid-stream': 'invalid-stream',
  'event-after-completed': 'event-after-completed',
  'two-terminal-events': 'two-terminal-events',
  'unknown-model': 'healthy',
};

/** Harness binding the shared provider contract suite to FakeInferenceProvider. */
export const fakeProviderContractHarness: ProviderContractHarness = {
  name: 'FakeInferenceProvider',
  knownModelId: DEFAULT_FAKE_MODEL.id,
  createProvider: scenario =>
    new FakeInferenceProvider({
      mode: FAKE_MODES[scenario],
      models: scenario === 'empty-model-list' ? [] : [DEFAULT_FAKE_MODEL],
    }),
};
