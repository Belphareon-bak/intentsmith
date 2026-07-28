import { ProviderError, type ModelExecution } from './provider.js';

/**
 * Remote/cloud-backed inference detection.
 *
 * A request to `127.0.0.1:11434` is not automatically local. A signed-in
 * Ollama installation serves cloud-hosted models through the same loopback
 * socket as local ones, so the address proves nothing about where the tokens
 * are actually produced.
 *
 * Enforcement is therefore based on the metadata the daemon returns, not on
 * the model name. A name suffix such as `-cloud` is a useful hint and is
 * recorded as a warning, but it is never the thing that blocks execution:
 * a name is attacker-controlled and trivially wrong in both directions.
 */

/**
 * Fields whose presence with a non-empty value means the model is served from
 * somewhere other than this machine.
 */
export const REMOTE_MARKER_FIELDS = ['remote_model', 'remote_host'] as const;

/** Name suffixes that suggest a cloud model. Advisory only. */
const CLOUD_NAME_HINT = /(^|[-_:/])cloud($|[-_:/])|-cloud\b/i;

export type RemoteAssessment = {
  execution: ModelExecution;
  /** Human-readable reason, safe to log. Never contains prompt content. */
  reason?: string;
  /** Marker fields that were found, for audit. */
  markers: string[];
  /** Non-blocking signals, e.g. a suspicious name with no marker present. */
  warnings: string[];
};

function isNonEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return Boolean(value);
}

/**
 * Inspects one payload for remote markers.
 *
 * `payload` is any object the daemon returned: a `/api/tags` entry, an
 * `/api/show` body, or a single `/api/generate` stream record. Nested objects
 * are searched too, because upstream may move these fields.
 */
export function assessRemoteMarkers(payload: unknown, modelName?: string): RemoteAssessment {
  const markers: string[] = [];
  const warnings: string[] = [];

  const walk = (node: unknown, path: string, depth: number): void => {
    if (depth > 6 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1));
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const here = path ? `${path}.${key}` : key;
      if ((REMOTE_MARKER_FIELDS as readonly string[]).includes(key) && isNonEmpty(value)) {
        markers.push(here);
      }
      walk(value, here, depth + 1);
    }
  };
  walk(payload, '', 0);

  if (modelName && CLOUD_NAME_HINT.test(modelName)) {
    warnings.push(`Model name "${modelName}" suggests a cloud model; name is advisory only.`);
  }

  if (markers.length > 0) {
    return {
      execution: 'remote_forbidden',
      reason: `Provider reported remote execution metadata (${markers.join(', ')}).`,
      markers,
      warnings,
    };
  }
  return { execution: 'local', markers, warnings };
}

/**
 * Throws `REMOTE_INFERENCE_FORBIDDEN` when the payload proves remote execution.
 *
 * Used as a generation preflight and again on every stream record, so a daemon
 * that looks local at selection time but switches mid-stream is still stopped.
 * Never falls back to another provider.
 */
export function assertNotRemote(payload: unknown, modelName: string, stage: string): RemoteAssessment {
  const assessment = assessRemoteMarkers(payload, modelName);
  if (assessment.execution === 'remote_forbidden') {
    throw new ProviderError(
      'REMOTE_INFERENCE_FORBIDDEN',
      `Refusing remote-backed inference for "${modelName}" at ${stage}: ${assessment.reason}`,
    );
  }
  return assessment;
}
