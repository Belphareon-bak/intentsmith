import {
  ProviderError,
  assertLocalEndpoint,
  assertNotRemote,
  buildRequestHeaders,
  DEFAULT_OLLAMA_ENDPOINT,
  normalizeProviderError,
  type EndpointPolicyResult,
  type GenerationRequest,
  type InferenceEvent,
  type InferenceProvider,
  type ModelDescriptor,
  type ProviderCapabilities,
  type ProviderHealth,
  type ProviderIdentity,
} from '@intentsmith/inference';

import {
  nsToMs,
  parseGenerateRecord,
  parseVersion,
  parsePs,
  parseShow,
  parseTags,
  sanitize,
  type OllamaShowResult,
} from './dto.js';
import { DEFAULT_NDJSON_LIMITS, readNdjson, type NdjsonLimits } from './ndjson.js';

/**
 * Minimal transport seam.
 *
 * Injecting this keeps every offline test free of real sockets while leaving
 * production on the Node runtime's own `fetch`. No HTTP client dependency is
 * added: an SDK would bring cloud defaults, auth behaviour and hidden retries,
 * all of which this adapter must not have.
 */
export type OllamaTransport = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal: AbortSignal;
    redirect: 'error';
  },
) => Promise<OllamaResponse>;

export type OllamaResponse = {
  status: number;
  ok: boolean;
  /** Final URL, used to detect a redirect the transport followed anyway. */
  url?: string;
  text(): Promise<string>;
  /** Byte stream for NDJSON responses. */
  body(): AsyncIterable<Uint8Array>;
};

export type OllamaTimeouts = {
  /** Connect plus response headers. */
  connectMs: number;
  /** First byte of the response body. */
  firstByteMs: number;
  /** Gap between two stream records. */
  idleMs: number;
  /** Whole request, start to finish. */
  overallMs: number;
};

export const DEFAULT_TIMEOUTS: OllamaTimeouts = {
  connectMs: 5_000,
  firstByteMs: 120_000,
  idleMs: 120_000,
  overallMs: 900_000,
};

export type OllamaAdapterOptions = {
  endpoint?: string;
  transport?: OllamaTransport;
  timeouts?: Partial<OllamaTimeouts>;
  ndjsonLimits?: NdjsonLimits;
  /** Injected timer so timeout behaviour is testable without wall-clock time. */
  schedule?: (fn: () => void, ms: number) => () => void;
  /** Cap on the error body read from the daemon. */
  maxErrorBodyBytes?: number;
};

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const handle = setTimeout(fn, ms);
  handle.unref?.();
  return () => clearTimeout(handle);
};

/**
 * Rejects as soon as `signal` aborts, regardless of whether the underlying
 * transport honours it.
 *
 * `fetch` does abort a pending request, but the transport is a seam and a
 * buggy or non-cooperative implementation must not be able to hang the process
 * forever. Timeout and cancellation are IntentSmith guarantees, so they cannot
 * depend on someone else's good behaviour.
 */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new ProviderError('REQUEST_CANCELLED', 'Request was cancelled.'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new ProviderError('REQUEST_CANCELLED', 'Request was cancelled.'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/** Node `fetch` transport with redirects disabled. */
export const fetchTransport: OllamaTransport = async (url, init) => {
  const response = await fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: init.signal,
    redirect: 'error',
  });
  return {
    status: response.status,
    ok: response.ok,
    url: response.url,
    text: () => response.text(),
    body: () => {
      const stream = response.body;
      if (!stream) return (async function* empty() {})();
      return stream as unknown as AsyncIterable<Uint8Array>;
    },
  };
};

export class OllamaProvider implements InferenceProvider {
  private readonly endpoint: EndpointPolicyResult;
  private readonly transport: OllamaTransport;
  private readonly timeouts: OllamaTimeouts;
  private readonly ndjsonLimits: NdjsonLimits;
  private readonly schedule: (fn: () => void, ms: number) => () => void;
  private readonly maxErrorBodyBytes: number;

  constructor(options: OllamaAdapterOptions = {}) {
    // Endpoint policy runs in the constructor: an illegal endpoint must fail
    // before the adapter exists, not on first use.
    this.endpoint = assertLocalEndpoint(options.endpoint ?? DEFAULT_OLLAMA_ENDPOINT);
    this.transport = options.transport ?? fetchTransport;
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };
    this.ndjsonLimits = options.ndjsonLimits ?? DEFAULT_NDJSON_LIMITS;
    this.schedule = options.schedule ?? defaultSchedule;
    this.maxErrorBodyBytes = options.maxErrorBodyBytes ?? 8192;
  }

  identity(): ProviderIdentity {
    return { id: 'ollama', name: 'Ollama (local)', version: '0.1.0' };
  }

  get origin(): string {
    return this.endpoint.origin;
  }

  async health(signal?: AbortSignal): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    try {
      const payload = await this.requestJson('GET', '/api/version', undefined, this.timeouts.connectMs, signal);
      return { status: 'healthy', detail: `Ollama ${parseVersion(payload)}`, checkedAt };
    } catch (error) {
      // Health reports unavailability; it does not throw.
      const normalized = normalizeProviderError(error);
      return { status: 'unavailable', detail: normalized.message, checkedAt };
    }
  }

  async capabilities(): Promise<ProviderCapabilities> {
    return {
      streaming: true,
      nonStreaming: true,
      cancellation: true,
      tokenUsage: true,
      // Concurrency is governed by the scheduler, not by this adapter.
      maxConcurrentRequests: 1,
    };
  }

  /**
   * Lists local models.
   *
   * Remote-backed models are returned so the user can see them, but they are
   * marked `remote_forbidden` and `generate` refuses them.
   */
  async listModels(signal?: AbortSignal): Promise<ModelDescriptor[]> {
    const payload = await this.requestJson('GET', '/api/tags', undefined, this.timeouts.connectMs, signal);
    return parseTags(payload).map(entry => entry.descriptor);
  }

  /** Detailed metadata for one model, used for preflight and assessment. */
  async describeModel(modelId: string, signal?: AbortSignal): Promise<ModelDescriptor & { show: OllamaShowResult }> {
    const listed = (await this.listModels(signal)).find(model => model.id === modelId);
    const payload = await this.requestJson(
      'POST',
      '/api/show',
      { model: modelId },
      this.timeouts.connectMs,
      signal,
    );
    const show = parseShow(payload);
    // `/api/show` is a second chance to catch a remote-backed model.
    const remote = assertNotRemoteOrMark(payload, modelId);

    return {
      id: modelId,
      family: show.family ?? listed?.family ?? 'unknown',
      parameterBillions: listed?.parameterBillions,
      parameterSizeLabel: show.parameterSizeLabel ?? listed?.parameterSizeLabel,
      quantization: show.quantization ?? listed?.quantization,
      contextTokens: show.contextTokens,
      digest: listed?.digest,
      artifactBytes: listed?.artifactBytes,
      capabilities: show.capabilities,
      modifiedAt: listed?.modifiedAt,
      execution: remote.execution === 'remote_forbidden' ? 'remote_forbidden' : (listed?.execution ?? 'local'),
      executionReason: remote.reason ?? listed?.executionReason,
      show,
    };
  }

  /** Currently loaded models, from `/api/ps`. Observation only. */
  async loadedModels(signal?: AbortSignal): Promise<Array<{ model: string; sizeVramBytes?: number }>> {
    return parsePs(await this.requestJson('GET', '/api/ps', undefined, this.timeouts.connectMs, signal));
  }

  async *generate(request: GenerationRequest, signal?: AbortSignal): AsyncIterable<InferenceEvent> {
    try {
      yield* this.runGeneration(request, signal);
    } catch (error) {
      yield { type: 'failed', error: normalizeProviderError(error) };
    }
  }

  private async *runGeneration(request: GenerationRequest, signal?: AbortSignal): AsyncIterable<InferenceEvent> {
    if (typeof request.modelId !== 'string' || request.modelId.trim().length === 0) {
      throw new ProviderError('REQUEST_INVALID', 'A model id is required.');
    }
    if (typeof request.prompt !== 'string' || request.prompt.length === 0) {
      throw new ProviderError('REQUEST_INVALID', 'A prompt is required.');
    }
    if (signal?.aborted) {
      throw new ProviderError('REQUEST_CANCELLED', 'Request was cancelled before it started.');
    }

    // Preflight: prove the model exists locally and is not remote-backed
    // before a single token is generated.
    const described = await this.describeModel(request.modelId, signal);
    if (described.execution === 'remote_forbidden') {
      throw new ProviderError(
        'REMOTE_INFERENCE_FORBIDDEN',
        `Refusing remote-backed inference for "${request.modelId}": ${described.executionReason ?? 'provider reported remote execution metadata'}`,
      );
    }

    const controller = new AbortController();
    const abortUpstream = (): void => controller.abort();
    signal?.addEventListener('abort', abortUpstream, { once: true });

    let cancelIdle: (() => void) | undefined;
    let timedOut = false;
    // The overall timer must mark a timeout, not merely abort. Without this a
    // run that exceeded its ceiling was reported as REQUEST_CANCELLED, which
    // told the caller a user cancelled something that actually timed out.
    const cancelOverall = this.schedule(() => {
      timedOut = true;
      controller.abort();
    }, this.timeouts.overallMs);
    const armIdle = (ms: number): void => {
      cancelIdle?.();
      cancelIdle = this.schedule(() => {
        timedOut = true;
        controller.abort();
      }, ms);
    };

    const streaming = request.stream !== false;
    let terminalSeen = false;
    let text = '';

    try {
      const response = await raceAbort(
        this.transport(`${this.endpoint.origin}/api/generate`, {
          method: 'POST',
          headers: buildRequestHeaders(),
          body: JSON.stringify({
            model: request.modelId,
            prompt: request.prompt,
            ...(request.system === undefined ? {} : { system: request.system }),
            stream: true,
            options: {
              ...(request.maxOutputTokens === undefined ? {} : { num_predict: request.maxOutputTokens }),
              ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
            },
          }),
          signal: controller.signal,
          redirect: 'error',
        }),
        controller.signal,
      );

      this.assertNoRedirect(response);
      if (!response.ok) throw await this.httpError(response, request.modelId);

      yield { type: 'started', modelId: request.modelId };
      armIdle(this.timeouts.firstByteMs);

      let usage: { promptTokens: number; completionTokens: number } | undefined;
      for await (const raw of readNdjson(response.body(), this.ndjsonLimits)) {
        // A body that ignores the abort signal must still not be able to keep
        // feeding records after cancellation or an idle timeout.
        if (controller.signal.aborted) {
          throw new ProviderError('REQUEST_CANCELLED', 'Request was cancelled.');
        }
        armIdle(this.timeouts.idleMs);

        if (terminalSeen) {
          throw new ProviderError('STREAM_INVALID', 'Provider emitted a record after the terminal record.');
        }

        const record = parseGenerateRecord(raw);
        // Re-check every record: a daemon that looked local at preflight must
        // not be able to switch to a remote backend mid-stream.
        assertNotRemote(raw, request.modelId, 'generation stream');
        if (record.model !== request.modelId) {
          throw new ProviderError(
            'STREAM_INVALID',
            `Provider changed model identity mid-stream (expected "${request.modelId}", got "${record.model}").`,
          );
        }

        if (record.response.length > 0) {
          text += record.response;
          if (streaming) yield { type: 'token', text: record.response };
        }

        if (record.done) {
          terminalSeen = true;
          usage = {
            promptTokens: record.promptEvalCount ?? 0,
            completionTokens: record.evalCount ?? 0,
          };
          // Durations stay available as raw nanoseconds for evidence; the
          // millisecond form is only for display.
          void nsToMs(record.totalDurationNs);
        }
      }

      if (!terminalSeen) {
        throw new ProviderError('STREAM_INVALID', 'Provider stream ended without a terminal record.');
      }
      yield { type: 'completed', text, ...(usage ? { usage } : {}) };
    } catch (error) {
      if (timedOut) {
        throw new ProviderError('REQUEST_TIMEOUT', 'Provider stream stalled and timed out.', true);
      }
      if (signal?.aborted) {
        throw new ProviderError('REQUEST_CANCELLED', 'Request was cancelled.');
      }
      throw error;
    } finally {
      // Every path releases the timers and stops the upstream request.
      cancelIdle?.();
      cancelOverall();
      signal?.removeEventListener('abort', abortUpstream);
      controller.abort();
    }
  }

  private assertNoRedirect(response: OllamaResponse): void {
    if (response.status >= 300 && response.status < 400) {
      throw new ProviderError('PROVIDER_PROTOCOL_ERROR', 'Provider attempted an HTTP redirect, which is not permitted.');
    }
    if (response.url && !response.url.startsWith(this.endpoint.origin)) {
      throw new ProviderError(
        'PROVIDER_PROTOCOL_ERROR',
        'Provider response came from a different origin than the configured loopback endpoint.',
      );
    }
  }

  private async httpError(response: OllamaResponse, modelId?: string): Promise<ProviderError> {
    let body: string;
    try {
      body = (await response.text()).slice(0, this.maxErrorBodyBytes);
    } catch {
      body = '';
    }
    let message = body;
    try {
      const parsed: unknown = JSON.parse(body);
      if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
        const inner = (parsed as { error: unknown }).error;
        if (typeof inner === 'string') message = inner;
      }
    } catch {
      // Not JSON. Ollama returns plain text for an unknown route.
    }

    if (response.status === 404) {
      const target = modelId ? `"${modelId}"` : 'the requested model';
      return new ProviderError(
        'MODEL_NOT_FOUND',
        `Model ${target} is not available locally. Install it with "ollama pull ${modelId ?? '<model>'}" and try again; IntentSmith never downloads models for you.`,
      );
    }
    return new ProviderError(
      'PROVIDER_PROTOCOL_ERROR',
      `Ollama returned HTTP ${response.status}: ${sanitize(message) || 'no detail'}`,
      response.status >= 500,
    );
  }

  private async requestJson(
    method: string,
    path: string,
    body: unknown,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const controller = new AbortController();
    const abortUpstream = (): void => controller.abort();
    signal?.addEventListener('abort', abortUpstream, { once: true });
    let timedOut = false;
    const cancelTimer = this.schedule(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await raceAbort(
        this.transport(`${this.endpoint.origin}${path}`, {
          method,
          headers: buildRequestHeaders(),
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal,
          redirect: 'error',
        }),
        controller.signal,
      );
      this.assertNoRedirect(response);
      if (!response.ok) {
        const modelId = typeof body === 'object' && body !== null && 'model' in body
          ? String((body as { model: unknown }).model)
          : undefined;
        throw await this.httpError(response, modelId);
      }
      const text = await response.text();
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new ProviderError('PROVIDER_PROTOCOL_ERROR', 'Ollama returned a response that is not valid JSON.');
      }
    } catch (error) {
      if (timedOut) {
        throw new ProviderError('REQUEST_TIMEOUT', `Ollama did not respond within ${timeoutMs}ms.`, true);
      }
      if (signal?.aborted) throw new ProviderError('REQUEST_CANCELLED', 'Request was cancelled.');
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        'PROVIDER_UNAVAILABLE',
        `Ollama is not reachable at ${this.endpoint.origin}. Start it with "ollama serve".`,
        true,
      );
    } finally {
      cancelTimer();
      signal?.removeEventListener('abort', abortUpstream);
    }
  }
}

/** Marks rather than throws, so discovery can list a remote model as blocked. */
function assertNotRemoteOrMark(payload: unknown, modelId: string): { execution: 'local' | 'remote_forbidden'; reason?: string } {
  try {
    assertNotRemote(payload, modelId, 'model metadata');
    return { execution: 'local' };
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'REMOTE_INFERENCE_FORBIDDEN') {
      return { execution: 'remote_forbidden', reason: error.message };
    }
    throw error;
  }
}
