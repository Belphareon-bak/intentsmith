import type { OllamaResponse, OllamaTransport } from './adapter.js';

/**
 * Offline fixtures.
 *
 * Shapes are copied from a live Ollama 0.17.7 daemon (see
 * docs/third-party/ollama.md). No test using these opens a socket, so
 * `pnpm verify` never needs Ollama, a GPU, or a model.
 */

export const VERSION_BODY = { version: '0.17.7' };

export const LOCAL_MODEL_ENTRY = {
  name: 'qwen3:14b',
  model: 'qwen3:14b',
  modified_at: '2026-03-25T22:04:04.262605238+01:00',
  size: 9_300_000_000,
  digest: '44c161b1f46523301da9c0cc505afa4a4a0cc62f580581d98a430bb21acd46de',
  details: {
    parent_model: '',
    format: 'gguf',
    family: 'qwen3',
    families: ['qwen3'],
    parameter_size: '14.8B',
    quantization_level: 'Q4_K_M',
  },
};

/**
 * A cloud-backed entry.
 *
 * The public Ollama API docs do not specify these fields, so this fixture
 * encodes the defensive contract IntentSmith enforces: a non-empty
 * `remote_model`/`remote_host` means the model is not executing here. Note the
 * name has no `-cloud` suffix, which is exactly why name matching is not the
 * enforcement mechanism.
 */
export const REMOTE_MODEL_ENTRY = {
  name: 'some-frontier-model:latest',
  model: 'some-frontier-model:latest',
  modified_at: '2026-07-01T00:00:00.000000000+00:00',
  size: 0,
  digest: 'deadbeef',
  remote_model: 'some-frontier-model',
  remote_host: 'https://ollama.com',
  details: { family: 'unknown', parameter_size: '', quantization_level: '' },
};

export const SHOW_BODY = {
  capabilities: ['completion', 'tools', 'thinking'],
  details: {
    parent_model: '',
    format: 'gguf',
    family: 'qwen3',
    families: ['qwen3'],
    parameter_size: '14.8B',
    quantization_level: 'Q4_K_M',
  },
  license: 'Apache-2.0',
  model_info: {
    'qwen3.block_count': 40,
    'qwen3.context_length': 40_960,
    'qwen3.embedding_length': 5120,
  },
  modelfile: 'FROM /root/.ollama/blobs/sha256-...',
  parameters: 'stop "<|im_end|>"',
  template: '{{ .Prompt }}',
};

export function generateRecord(text: string, done = false): string {
  return `${JSON.stringify({
    model: 'qwen3:14b',
    created_at: '2026-07-28T00:00:00.000000000Z',
    response: text,
    done,
  })}\n`;
}

export function terminalRecord(overrides: Record<string, unknown> = {}): string {
  return `${JSON.stringify({
    model: 'qwen3:14b',
    created_at: '2026-07-28T00:00:01.000000000Z',
    response: '',
    done: true,
    done_reason: 'stop',
    context: [1, 2, 3],
    total_duration: 1_500_000_000,
    load_duration: 500_000_000,
    prompt_eval_count: 12,
    prompt_eval_duration: 200_000_000,
    eval_count: 5,
    eval_duration: 800_000_000,
    ...overrides,
  })}\n`;
}

function jsonResponse(status: number, body: unknown, url?: string): OllamaResponse {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    ...(url === undefined ? {} : { url }),
    text: async () => text,
    body: async function* () {
      yield new TextEncoder().encode(text);
    },
  };
}

function streamResponse(chunks: string[], status = 200, url?: string): OllamaResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    ...(url === undefined ? {} : { url }),
    text: async () => chunks.join(''),
    body: async function* () {
      for (const chunk of chunks) yield new TextEncoder().encode(chunk);
    },
  };
}

export type FixtureRoutes = {
  version?: OllamaResponse | (() => Promise<never>);
  tags?: OllamaResponse;
  show?: OllamaResponse;
  ps?: OllamaResponse;
  generate?: OllamaResponse | (() => Promise<never>);
};

/** Builds a transport that answers from fixtures and never touches a socket. */
export function fixtureTransport(routes: FixtureRoutes = {}): OllamaTransport {
  const defaults = {
    version: jsonResponse(200, VERSION_BODY),
    tags: jsonResponse(200, { models: [LOCAL_MODEL_ENTRY] }),
    show: jsonResponse(200, SHOW_BODY),
    ps: jsonResponse(200, { models: [] }),
    generate: streamResponse([generateRecord('Hello'), generateRecord(' world'), terminalRecord()]),
  };

  return async (url, init) => {
    if (init.signal.aborted) {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    }
    const pick = (key: keyof FixtureRoutes): OllamaResponse | (() => Promise<never>) =>
      routes[key] ?? defaults[key];

    let chosen: OllamaResponse | (() => Promise<never>);
    if (url.endsWith('/api/version')) chosen = pick('version');
    else if (url.endsWith('/api/tags')) chosen = pick('tags');
    else if (url.endsWith('/api/show')) chosen = pick('show');
    else if (url.endsWith('/api/ps')) chosen = pick('ps');
    else if (url.endsWith('/api/generate')) chosen = pick('generate');
    else chosen = jsonResponse(404, '404 page not found');

    if (typeof chosen === 'function') return await chosen();
    return chosen;
  };
}

export const fixtures = { jsonResponse, streamResponse };
