import {
  ProviderError,
  normalizeProviderError,
  type GenerationRequest,
  type InferenceEvent,
  type InferenceProvider,
  type ModelDescriptor,
  type ProviderCapabilities,
  type ProviderHealth,
  type ProviderIdentity,
} from '@intentsmith/core';

/**
 * Deterministic in-memory inference provider.
 *
 * Uses no network, no real clock, no subprocess, and no external inference
 * runtime. Every behaviour is selected explicitly through {@link FakeProviderOptions}
 * so the provider contract suite produces identical results on any machine.
 */
export type FakeProviderMode =
  | 'healthy'
  | 'unavailable'
  | 'fail-before-first-token'
  | 'fail-mid-stream'
  | 'invalid-stream'
  | 'event-after-completed'
  | 'two-terminal-events'
  | 'timeout';

export type FakeProviderOptions = {
  mode?: FakeProviderMode;
  models?: ModelDescriptor[];
  /** Tokens emitted for a streamed response, in order. */
  tokens?: string[];
  identity?: Partial<ProviderIdentity>;
  capabilities?: Partial<ProviderCapabilities>;
  /** Virtual instant reported by health checks; never `Date.now()`. */
  now?: string;
};

export const DEFAULT_FAKE_MODEL: ModelDescriptor = {
  id: 'fake-small',
  family: 'fake',
  parameterBillions: 1,
  contextTokens: 4096,
};

export class FakeInferenceProvider implements InferenceProvider {
  private readonly mode: FakeProviderMode;
  private readonly models: ModelDescriptor[];
  private readonly tokens: string[];
  private readonly now: string;
  private readonly capabilityOverrides: Partial<ProviderCapabilities>;
  private readonly identityOverrides: Partial<ProviderIdentity>;

  constructor(options: FakeProviderOptions = {}) {
    this.mode = options.mode ?? 'healthy';
    this.models = options.models ?? [DEFAULT_FAKE_MODEL];
    this.tokens = options.tokens ?? ['Hello', ' ', 'world'];
    this.now = options.now ?? '2026-07-27T00:00:00.000Z';
    this.capabilityOverrides = options.capabilities ?? {};
    this.identityOverrides = options.identity ?? {};
  }

  identity(): ProviderIdentity {
    return { id: 'fake', name: 'Fake Inference Provider', version: '0.1.0', ...this.identityOverrides };
  }

  async health(): Promise<ProviderHealth> {
    if (this.mode === 'unavailable') {
      return { status: 'unavailable', detail: 'Fake provider is configured as unavailable', checkedAt: this.now };
    }
    return { status: 'healthy', checkedAt: this.now };
  }

  async capabilities(): Promise<ProviderCapabilities> {
    return {
      streaming: true,
      nonStreaming: true,
      cancellation: true,
      tokenUsage: true,
      maxConcurrentRequests: 1,
      ...this.capabilityOverrides,
    };
  }

  async listModels(): Promise<ModelDescriptor[]> {
    if (this.mode === 'unavailable') {
      throw new ProviderError('PROVIDER_UNAVAILABLE', 'Fake provider is unavailable', true);
    }
    return [...this.models];
  }

  async *generate(request: GenerationRequest, signal?: AbortSignal): AsyncIterable<InferenceEvent> {
    try {
      yield* this.emit(request, signal);
    } catch (error) {
      // A provider never throws out of its stream; it emits a terminal event.
      yield { type: 'failed', error: normalizeProviderError(error) };
    }
  }

  private async *emit(request: GenerationRequest, signal?: AbortSignal): AsyncIterable<InferenceEvent> {
    if (this.mode === 'unavailable') {
      throw new ProviderError('PROVIDER_UNAVAILABLE', 'Fake provider is unavailable', true);
    }
    if (typeof request.modelId !== 'string' || request.modelId.length === 0 || request.prompt.length === 0) {
      throw new ProviderError('REQUEST_INVALID', 'Model id and prompt are required');
    }
    if (!this.models.some(model => model.id === request.modelId)) {
      throw new ProviderError('MODEL_NOT_FOUND', `Unknown model: ${request.modelId}`);
    }
    if (signal?.aborted) {
      throw new ProviderError('REQUEST_CANCELLED', 'Request was cancelled before it started');
    }
    if (this.mode === 'timeout') {
      throw new ProviderError('REQUEST_TIMEOUT', 'Fake provider timed out', true);
    }
    if (this.mode === 'fail-before-first-token') {
      throw new ProviderError('PROVIDER_PROTOCOL_ERROR', 'Fake provider failed before the first token');
    }
    if (this.mode === 'invalid-stream') {
      yield { type: 'started', modelId: request.modelId };
      throw new ProviderError('STREAM_INVALID', 'Fake provider produced an invalid stream');
    }

    yield { type: 'started', modelId: request.modelId };

    const streaming = request.stream !== false;
    const emitted: string[] = [];
    for (const [index, token] of this.tokens.entries()) {
      if (signal?.aborted) {
        throw new ProviderError('REQUEST_CANCELLED', 'Request was cancelled mid-stream');
      }
      if (this.mode === 'fail-mid-stream' && index === 1) {
        throw new ProviderError('PROVIDER_PROTOCOL_ERROR', 'Fake provider failed mid-stream');
      }
      emitted.push(token);
      if (streaming) yield { type: 'token', text: token };
    }

    const text = emitted.join('');
    yield {
      type: 'completed',
      text,
      usage: { promptTokens: request.prompt.length, completionTokens: emitted.length },
    };

    // Deliberate contract violations, used to prove the suite detects them.
    if (this.mode === 'event-after-completed') {
      yield { type: 'token', text: '!' };
    }
    if (this.mode === 'two-terminal-events') {
      yield { type: 'completed', text, usage: { promptTokens: 0, completionTokens: 0 } };
    }
  }
}
