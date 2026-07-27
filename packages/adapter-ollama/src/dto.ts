import { ProviderError, type ModelDescriptor } from '@intentsmith/inference';

import { assessRemoteMarkers } from '@intentsmith/inference';

/**
 * Runtime validation and normalization of Ollama DTOs.
 *
 * Ollama has no strictly versioned HTTP API, so these functions validate only
 * the fields IntentSmith actually relies on and tolerate everything else.
 * Unknown fields are preserved internally where useful for evidence but are
 * never re-exported through the public provider types.
 *
 * Pinned against Ollama 0.17.7; see docs/third-party/ollama.md.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(what: string): never {
  throw new ProviderError('PROVIDER_PROTOCOL_ERROR', `Ollama returned an unexpected ${what}.`);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** `GET /api/version` -> `{ "version": "0.17.7" }` */
export function parseVersion(payload: unknown): string {
  if (!isRecord(payload)) invalid('version payload');
  const version = optionalString(payload.version);
  if (!version) invalid('version field');
  return version;
}

/**
 * Parses a display parameter size such as `8B` or `14.8B` into billions.
 *
 * Returns undefined when the label is missing or unparseable. It never falls
 * back to guessing from the model name: an absent value must stay unknown
 * rather than become a number that later looks like evidence.
 */
export function parseParameterBillions(label: string | undefined): number | undefined {
  if (!label) return undefined;
  const match = /^([\d.]+)\s*([BM])$/i.exec(label.trim());
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return undefined;
  return match[2]?.toUpperCase() === 'M' ? value / 1000 : value;
}

/** Extracts `<family>.context_length` from the flat `model_info` map. */
export function extractContextLength(modelInfo: unknown): number | undefined {
  if (!isRecord(modelInfo)) return undefined;
  for (const [key, value] of Object.entries(modelInfo)) {
    if (key.endsWith('.context_length')) {
      const parsed = optionalFiniteNumber(value);
      if (parsed !== undefined) return parsed;
    }
  }
  return undefined;
}

export type OllamaTagEntry = {
  descriptor: ModelDescriptor;
  /** Raw entry retained for evidence; never exposed through the port. */
  raw: Record<string, unknown>;
};

/** `GET /api/tags` -> `{ models: [...] }` */
export function parseTags(payload: unknown): OllamaTagEntry[] {
  if (!isRecord(payload)) invalid('tags payload');
  const models = payload.models;
  if (models === undefined || models === null) return [];
  if (!Array.isArray(models)) invalid('tags.models field');

  return models.map(entry => {
    if (!isRecord(entry)) invalid('tags.models entry');
    const id = optionalString(entry.name) ?? optionalString(entry.model);
    if (!id) invalid('model identifier in tags');

    const details = isRecord(entry.details) ? entry.details : {};
    const parameterSizeLabel = optionalString(details.parameter_size);
    const remote = assessRemoteMarkers(entry, id);

    const descriptor: ModelDescriptor = {
      id,
      family: optionalString(details.family) ?? 'unknown',
      parameterBillions: parseParameterBillions(parameterSizeLabel),
      parameterSizeLabel,
      quantization: optionalString(details.quantization_level),
      digest: optionalString(entry.digest),
      artifactBytes: optionalFiniteNumber(entry.size),
      modifiedAt: optionalString(entry.modified_at),
      execution: remote.execution,
      executionReason: remote.reason,
    };
    return { descriptor, raw: entry };
  });
}

export type OllamaShowResult = {
  capabilities: string[];
  contextTokens?: number;
  family?: string;
  parameterSizeLabel?: string;
  quantization?: string;
  license?: string;
  raw: Record<string, unknown>;
};

/** `POST /api/show` */
export function parseShow(payload: unknown): OllamaShowResult {
  if (!isRecord(payload)) invalid('show payload');
  const details = isRecord(payload.details) ? payload.details : {};
  const capabilities = Array.isArray(payload.capabilities)
    ? payload.capabilities.filter((item): item is string => typeof item === 'string')
    : [];

  return {
    capabilities,
    contextTokens: extractContextLength(payload.model_info),
    family: optionalString(details.family),
    parameterSizeLabel: optionalString(details.parameter_size),
    quantization: optionalString(details.quantization_level),
    license: optionalString(payload.license),
    raw: payload,
  };
}

export type OllamaGenerateRecord = {
  model: string;
  response: string;
  done: boolean;
  doneReason?: string;
  /** Raw nanosecond durations, kept exactly as reported. */
  totalDurationNs?: number;
  loadDurationNs?: number;
  promptEvalDurationNs?: number;
  evalDurationNs?: number;
  promptEvalCount?: number;
  evalCount?: number;
  raw: Record<string, unknown>;
};

/** One record from the `POST /api/generate` NDJSON stream. */
export function parseGenerateRecord(payload: unknown): OllamaGenerateRecord {
  if (!isRecord(payload)) invalid('generate record');
  // An error can appear inline in the stream rather than as an HTTP status.
  const inlineError = optionalString(payload.error);
  if (inlineError) {
    throw new ProviderError('PROVIDER_PROTOCOL_ERROR', `Ollama reported an error: ${sanitize(inlineError)}`);
  }
  const model = optionalString(payload.model);
  if (!model) invalid('generate record without a model field');
  if (typeof payload.done !== 'boolean') invalid('generate record without a boolean done field');

  return {
    model,
    response: typeof payload.response === 'string' ? payload.response : '',
    done: payload.done,
    doneReason: optionalString(payload.done_reason),
    totalDurationNs: optionalFiniteNumber(payload.total_duration),
    loadDurationNs: optionalFiniteNumber(payload.load_duration),
    promptEvalDurationNs: optionalFiniteNumber(payload.prompt_eval_duration),
    evalDurationNs: optionalFiniteNumber(payload.eval_duration),
    promptEvalCount: optionalFiniteNumber(payload.prompt_eval_count),
    evalCount: optionalFiniteNumber(payload.eval_count),
    raw: payload,
  };
}

/** `GET /api/ps` -> currently loaded models. */
export function parsePs(payload: unknown): Array<{ model: string; sizeVramBytes?: number }> {
  if (!isRecord(payload)) invalid('ps payload');
  const models = payload.models;
  if (models === undefined || models === null) return [];
  if (!Array.isArray(models)) invalid('ps.models field');
  return models.flatMap(entry => {
    if (!isRecord(entry)) return [];
    const model = optionalString(entry.name) ?? optionalString(entry.model);
    if (!model) return [];
    return [{ model, sizeVramBytes: optionalFiniteNumber(entry.size_vram) }];
  });
}

/** Nanoseconds to milliseconds, for display only. Raw ns stays the evidence. */
export function nsToMs(nanoseconds: number | undefined): number | undefined {
  if (nanoseconds === undefined) return undefined;
  return Math.round(nanoseconds / 1_000_000);
}

/**
 * Trims and caps an upstream error string.
 *
 * Upstream text reaches users, so it is bounded and stripped of anything that
 * looks like a filesystem path or stack frame.
 */
export function sanitize(message: string, maxLength = 300): string {
  const withoutFrames = message.replace(/\s+at\s+\S+:\d+:\d+/g, ' ').replace(/(\/[\w.-]+){2,}/g, '<path>');
  const collapsed = withoutFrames.replace(/\s+/g, ' ').trim();
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength)}...` : collapsed;
}
