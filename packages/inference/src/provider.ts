/**
 * Inference provider port.
 *
 * This is a boundary definition only. Phase 1.1 ships no real provider: there
 * is no HTTP client, no model download, no hardware probing, and nothing here
 * is wired into the task lifecycle. The types deliberately avoid any
 * vendor-specific endpoint, header, or response shape so that a future adapter
 * can satisfy the same contract suite as the fake provider.
 *
 * `MODEL_TOO_LARGE` is intentionally absent: model-fit is a hardware policy
 * decision surfaced by `@intentsmith/hardware`, not a transport-level provider
 * error.
 */

export type ProviderIdentity = {
  /** Stable machine-readable provider id, e.g. `fake`. */
  id: string;
  /** Human-readable provider name. */
  name: string;
  /** Provider adapter version, independent of any served model. */
  version: string;
};

export type ProviderHealth = {
  status: 'healthy' | 'degraded' | 'unavailable';
  /** Provider-supplied detail; never a raw transport error string. */
  detail?: string;
  checkedAt: string;
};

export type ProviderCapabilities = {
  streaming: boolean;
  /** Whether the provider can return a single non-streamed completion. */
  nonStreaming: boolean;
  cancellation: boolean;
  /** Whether generation responses can report token usage. */
  tokenUsage: boolean;
  maxConcurrentRequests: number;
};

/**
 * Where a model actually runs. `remote_forbidden` models may appear in
 * discovery so the user can see why they are unavailable, but they can never
 * be selected for generation.
 */
export type ModelExecution = 'local' | 'remote_forbidden' | 'unknown';

export type ModelDescriptor = {
  id: string;
  family: string;
  /**
   * Parameter count in billions when the provider reports it. Absent means the
   * provider did not say; it never means zero and never implies the model is
   * small enough to run.
   */
  parameterBillions?: number;
  contextTokens?: number;
  /** Content digest as reported by the provider. */
  digest?: string;
  /** On-disk artifact size in bytes. Evidence, not a VRAM requirement. */
  artifactBytes?: number;
  /** Display string such as `Q4_K_M`. */
  quantization?: string;
  /** Display string such as `14.8B`, kept verbatim alongside the parsed value. */
  parameterSizeLabel?: string;
  /** Capabilities the provider reports, e.g. `completion`, `tools`. */
  capabilities?: string[];
  modifiedAt?: string;
  execution: ModelExecution;
  /** Why the model was classified as remote, when it was. */
  executionReason?: string;
};

export type GenerationRequest = {
  modelId: string;
  prompt: string;
  /** Optional system framing; providers that lack the concept must ignore it. */
  system?: string;
  maxOutputTokens?: number;
  /** 0 means deterministic decoding where the provider supports it. */
  temperature?: number;
  stream?: boolean;
  timeoutMs?: number;
};

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
};

export type InferenceEvent =
  | { type: 'started'; modelId: string }
  | { type: 'token'; text: string }
  | { type: 'completed'; text: string; usage?: TokenUsage }
  | { type: 'failed'; error: NormalizedProviderError };

export const PROVIDER_ERROR_CODES = [
  'PROVIDER_UNAVAILABLE',
  'MODEL_NOT_FOUND',
  'REQUEST_INVALID',
  'REQUEST_TIMEOUT',
  'REQUEST_CANCELLED',
  'STREAM_INVALID',
  'PROVIDER_PROTOCOL_ERROR',
  /**
   * The provider was asked to run, or started returning, inference that is not
   * executing on this machine.
   *
   * This is a policy verdict, not a transport failure. Every other code here
   * describes something that went wrong while talking to a local daemon and may
   * be retryable or environmental. `REMOTE_INFERENCE_FORBIDDEN` means the
   * transport worked perfectly and the answer is still refused, because
   * IntentSmith is local-first and a signed-in daemon can serve cloud-backed
   * models over the same loopback socket. It is also distinct from
   * `MODEL_TOO_LARGE`, which is a hardware-fit judgement about a model that is
   * legitimately local. Never retry it and never fall back to another provider.
   */
  'REMOTE_INFERENCE_FORBIDDEN',
] as const;

export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

export type NormalizedProviderError = {
  code: ProviderErrorCode;
  message: string;
  retryable: boolean;
};

export function isProviderErrorCode(value: unknown): value is ProviderErrorCode {
  return typeof value === 'string' && (PROVIDER_ERROR_CODES as readonly string[]).includes(value);
}

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ProviderError';
  }

  toNormalizedError(): NormalizedProviderError {
    return { code: this.code, message: this.message, retryable: this.retryable };
  }
}

/**
 * Maps an arbitrary thrown value onto the stable provider error vocabulary.
 * Unknown failures never leak a stack trace or transport detail.
 */
export function normalizeProviderError(error: unknown): NormalizedProviderError {
  if (error instanceof ProviderError) return error.toNormalizedError();
  if (error instanceof Error && error.name === 'AbortError') {
    return { code: 'REQUEST_CANCELLED', message: 'Request was cancelled', retryable: false };
  }
  return { code: 'PROVIDER_PROTOCOL_ERROR', message: 'Provider protocol error', retryable: false };
}

export type InferenceProvider = {
  identity(): ProviderIdentity;
  health(signal?: AbortSignal): Promise<ProviderHealth>;
  capabilities(): Promise<ProviderCapabilities>;
  listModels(signal?: AbortSignal): Promise<ModelDescriptor[]>;
  /**
   * Executes one generation request.
   *
   * The stream must end with exactly one terminal event (`completed` or
   * `failed`) and must emit nothing afterwards. Implementations signal
   * cancellation and timeout through `failed` events carrying
   * `REQUEST_CANCELLED` / `REQUEST_TIMEOUT`.
   */
  generate(request: GenerationRequest, signal?: AbortSignal): AsyncIterable<InferenceEvent>;
};
