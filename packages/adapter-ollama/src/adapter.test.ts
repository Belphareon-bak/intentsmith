import { describe, expect, it } from 'vitest';

import { assertLocalEndpoint, type InferenceEvent } from '@intentsmith/inference';

import { OllamaProvider } from './adapter.js';
import {
  LOCAL_MODEL_ENTRY,
  REMOTE_MODEL_ENTRY,
  SHOW_BODY,
  VERSION_BODY,
  fixtureTransport,
  fixtures,
  generateRecord,
  terminalRecord,
} from './fixtures.js';

/**
 * Offline Ollama adapter tests.
 *
 * Every case uses an injected transport, so nothing here needs Ollama, a GPU,
 * a model or a network port.
 */

const FAST = { connectMs: 50, firstByteMs: 50, idleMs: 50, overallMs: 500 };

function provider(routes: Parameters<typeof fixtureTransport>[0] = {}, extra = {}) {
  return new OllamaProvider({
    endpoint: 'http://127.0.0.1:11434',
    transport: fixtureTransport(routes),
    timeouts: FAST,
    ...extra,
  });
}

async function collect(stream: AsyncIterable<InferenceEvent>): Promise<InferenceEvent[]> {
  const events: InferenceEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const request = { modelId: 'qwen3:14b', prompt: 'ping', maxOutputTokens: 8 };

describe('endpoint policy', () => {
  it('accepts loopback forms and normalizes them', () => {
    expect(assertLocalEndpoint('http://127.0.0.1:11434').origin).toBe('http://127.0.0.1:11434');
    expect(assertLocalEndpoint('http://localhost:11434').origin).toBe('http://127.0.0.1:11434');
    expect(assertLocalEndpoint('http://127.0.0.1:11434/').origin).toBe('http://127.0.0.1:11434');
    expect(assertLocalEndpoint('http://[::1]:11434').hostname).toBe('[::1]');
    expect(assertLocalEndpoint('http://127.5.5.5:11434').hostname).toBe('127.5.5.5');
  });

  it.each([
    ['ollama.com', 'http://ollama.com:11434'],
    ['https scheme', 'https://127.0.0.1:11434'],
    ['public IP', 'http://8.8.8.8:11434'],
    ['private LAN', 'http://192.168.1.50:11434'],
    ['other private LAN', 'http://10.0.0.5:11434'],
    ['link-local', 'http://169.254.1.1:11434'],
    ['arbitrary hostname', 'http://my-gpu-box:11434'],
    ['userinfo', 'http://user:pass@127.0.0.1:11434'],
    ['path manipulation', 'http://127.0.0.1:11434/../evil'],
    ['query string', 'http://127.0.0.1:11434/?x=1'],
    ['non-http protocol', 'ftp://127.0.0.1:11434'],
    ['malformed port', 'http://127.0.0.1:99999'],
    ['not a url', 'not-a-url'],
    ['empty', ''],
  ])('rejects %s', (_label, endpoint) => {
    expect(() => assertLocalEndpoint(endpoint)).toThrowError(expect.objectContaining({ code: 'REQUEST_INVALID' }));
  });

  it('refuses to construct an adapter with an illegal endpoint', () => {
    expect(() => new OllamaProvider({ endpoint: 'http://ollama.com' })).toThrowError(
      expect.objectContaining({ code: 'REQUEST_INVALID' }),
    );
  });
});

describe('version and health', () => {
  it('reports healthy with the daemon version', async () => {
    const health = await provider().health();
    expect(health.status).toBe('healthy');
    expect(health.detail).toContain(VERSION_BODY.version);
  });

  it('reports unavailable rather than throwing when the daemon is down', async () => {
    const health = await provider({
      version: async () => {
        throw new Error('ECONNREFUSED');
      },
    }).health();
    expect(health.status).toBe('unavailable');
    expect(health.detail).not.toMatch(/\s+at\s+.*:\d+:\d+/);
  });

  it('rejects a malformed version payload', async () => {
    const health = await provider({ version: fixtures.jsonResponse(200, { nope: true }) }).health();
    expect(health.status).toBe('unavailable');
  });

  it('times out a stalled connection', async () => {
    const health = await provider({
      version: () =>
        new Promise(() => undefined) as Promise<never>,
    }).health();
    expect(health.status).toBe('unavailable');
  });
});

describe('model discovery', () => {
  it('maps a local model onto a normalized descriptor', async () => {
    const [model] = await provider().listModels();
    expect(model).toMatchObject({
      id: 'qwen3:14b',
      family: 'qwen3',
      parameterBillions: 14.8,
      parameterSizeLabel: '14.8B',
      quantization: 'Q4_K_M',
      digest: LOCAL_MODEL_ENTRY.digest,
      artifactBytes: LOCAL_MODEL_ENTRY.size,
      execution: 'local',
    });
  });

  it('returns an empty list without throwing', async () => {
    expect(await provider({ tags: fixtures.jsonResponse(200, { models: [] }) }).listModels()).toEqual([]);
  });

  it('rejects a malformed tags payload', async () => {
    await expect(provider({ tags: fixtures.jsonResponse(200, { models: 'nope' }) }).listModels()).rejects.toMatchObject(
      { code: 'PROVIDER_PROTOCOL_ERROR' },
    );
  });

  it('marks a remote-backed model as forbidden in discovery', async () => {
    const models = await provider({
      tags: fixtures.jsonResponse(200, { models: [LOCAL_MODEL_ENTRY, REMOTE_MODEL_ENTRY] }),
    }).listModels();
    const remote = models.find(model => model.id === REMOTE_MODEL_ENTRY.name);
    expect(remote?.execution).toBe('remote_forbidden');
    expect(remote?.executionReason).toContain('remote');
    // The local model is unaffected.
    expect(models.find(model => model.id === 'qwen3:14b')?.execution).toBe('local');
  });

  it('reads context length and capabilities from show', async () => {
    const described = await provider().describeModel('qwen3:14b');
    expect(described.contextTokens).toBe(SHOW_BODY.model_info['qwen3.context_length']);
    expect(described.capabilities).toEqual(SHOW_BODY.capabilities);
  });

  it('returns MODEL_NOT_FOUND with actionable local guidance', async () => {
    await expect(
      provider({ show: fixtures.jsonResponse(404, { error: "model 'nope' not found" }) }).describeModel('nope'),
    ).rejects.toMatchObject({ code: 'MODEL_NOT_FOUND' });

    const error = await provider({ show: fixtures.jsonResponse(404, { error: 'nope' }) })
      .describeModel('nope')
      .catch((caught: Error) => caught);
    // Guidance tells the user what to do without downloading anything for them.
    expect(String(error)).toContain('ollama pull');
    expect(String(error)).toContain('never downloads');
  });

  it('reports loaded models from ps', async () => {
    expect(await provider().loadedModels()).toEqual([]);
    const loaded = await provider({
      ps: fixtures.jsonResponse(200, { models: [{ name: 'qwen3:14b', size_vram: 1024 }] }),
    }).loadedModels();
    expect(loaded).toEqual([{ model: 'qwen3:14b', sizeVramBytes: 1024 }]);
  });
});

describe('generation streaming', () => {
  it('normalizes a valid NDJSON stream', async () => {
    const events = await collect(provider().generate(request));
    expect(events[0]).toMatchObject({ type: 'started', modelId: 'qwen3:14b' });
    expect(events.filter(event => event.type === 'token').map(e => (e as { text: string }).text)).toEqual([
      'Hello',
      ' world',
    ]);
    const last = events.at(-1);
    expect(last?.type).toBe('completed');
    if (last?.type === 'completed') {
      expect(last.text).toBe('Hello world');
      expect(last.usage).toEqual({ promptTokens: 12, completionTokens: 5 });
    }
  });

  it('handles records split across arbitrary chunk boundaries', async () => {
    const whole = `${generateRecord('Hel')}${generateRecord('lo')}${terminalRecord()}`;
    // One byte at a time is the worst case for a line-oriented reader.
    const chunks = [...whole].map(character => character);
    const events = await collect(provider({ generate: fixtures.streamResponse(chunks) }).generate(request));
    expect(events.at(-1)?.type).toBe('completed');
    expect(events.filter(event => event.type === 'token')).toHaveLength(2);
  });

  it('handles multiple records arriving in one chunk', async () => {
    const single = `${generateRecord('a')}${generateRecord('b')}${terminalRecord()}`;
    const events = await collect(provider({ generate: fixtures.streamResponse([single]) }).generate(request));
    expect(events.filter(event => event.type === 'token')).toHaveLength(2);
    expect(events.at(-1)?.type).toBe('completed');
  });

  it('rejects a malformed record', async () => {
    const events = await collect(
      provider({ generate: fixtures.streamResponse(['{not json\n']) }).generate(request),
    );
    const last = events.at(-1);
    expect(last?.type).toBe('failed');
    if (last?.type === 'failed') expect(last.error.code).toBe('STREAM_INVALID');
  });

  it('rejects an oversized record', async () => {
    const huge = `${JSON.stringify({ model: 'qwen3:14b', response: 'x'.repeat(5000), done: false })}\n`;
    const events = await collect(
      provider({ generate: fixtures.streamResponse([huge]) }, {
        ndjsonLimits: { maxRecordBytes: 512, maxTotalBytes: 1_000_000, maxRecords: 100 },
      }).generate(request),
    );
    const last = events.at(-1);
    expect(last?.type).toBe('failed');
    if (last?.type === 'failed') expect(last.error.code).toBe('STREAM_INVALID');
  });

  it('rejects a stream that never sends a terminal record', async () => {
    const events = await collect(
      provider({ generate: fixtures.streamResponse([generateRecord('a')]) }).generate(request),
    );
    const last = events.at(-1);
    expect(last?.type).toBe('failed');
    if (last?.type === 'failed') expect(last.error.code).toBe('STREAM_INVALID');
  });

  it('rejects a second terminal record', async () => {
    const events = await collect(
      provider({ generate: fixtures.streamResponse([terminalRecord(), terminalRecord()]) }).generate(request),
    );
    const last = events.at(-1);
    expect(last?.type).toBe('failed');
    if (last?.type === 'failed') expect(last.error.code).toBe('STREAM_INVALID');
  });

  it('rejects a record after the terminal record', async () => {
    const events = await collect(
      provider({ generate: fixtures.streamResponse([terminalRecord(), generateRecord('late')]) }).generate(request),
    );
    const last = events.at(-1);
    expect(last?.type).toBe('failed');
    if (last?.type === 'failed') expect(last.error.code).toBe('STREAM_INVALID');
  });

  it('rejects a model identity change mid-stream', async () => {
    const swapped = `${JSON.stringify({ model: 'other-model:1b', response: 'x', done: false })}\n`;
    const events = await collect(
      provider({ generate: fixtures.streamResponse([generateRecord('a'), swapped, terminalRecord()]) }).generate(
        request,
      ),
    );
    const last = events.at(-1);
    expect(last?.type).toBe('failed');
    if (last?.type === 'failed') {
      expect(last.error.code).toBe('STREAM_INVALID');
      expect(last.error.message).toContain('model identity');
    }
  });

  it('surfaces an inline upstream error, sanitized', async () => {
    const inline = `${JSON.stringify({ error: 'boom at /home/someone/x.go:12:5' })}\n`;
    const events = await collect(provider({ generate: fixtures.streamResponse([inline]) }).generate(request));
    const last = events.at(-1);
    expect(last?.type).toBe('failed');
    if (last?.type === 'failed') {
      expect(last.error.message).not.toContain('/home/someone');
      expect(last.error.message).not.toMatch(/\s+at\s+\S+:\d+:\d+/);
    }
  });

  it('cancels before the first token', async () => {
    const controller = new AbortController();
    controller.abort();
    const events = await collect(provider().generate(request, controller.signal));
    const last = events.at(-1);
    expect(last?.type).toBe('failed');
    if (last?.type === 'failed') expect(last.error.code).toBe('REQUEST_CANCELLED');
  });

  it('cancels mid-stream', async () => {
    const controller = new AbortController();
    const slow = {
      status: 200,
      ok: true,
      text: async () => '',
      body: async function* () {
        yield new TextEncoder().encode(generateRecord('first'));
        controller.abort();
        // A cooperative daemon would stop here; simulate it hanging instead.
        await new Promise(resolve => setTimeout(resolve, 5));
        yield new TextEncoder().encode(terminalRecord());
      },
    };
    const events = await collect(provider({ generate: slow }).generate(request, controller.signal));
    const last = events.at(-1);
    expect(last?.type).toBe('failed');
    if (last?.type === 'failed') expect(last.error.code).toBe('REQUEST_CANCELLED');
  });

  it('times out an idle stream', async () => {
    let fire: (() => void) | undefined;
    const events = await collect(
      provider(
        {
          generate: {
            status: 200,
            ok: true,
            text: async () => '',
            body: async function* () {
              yield new TextEncoder().encode(generateRecord('first'));
              // Trip the injected idle timer instead of waiting on the clock.
              fire?.();
              await new Promise(resolve => setTimeout(resolve, 20));
              yield new TextEncoder().encode(terminalRecord());
            },
          },
        },
        {
          schedule: (fn: () => void) => {
            fire = fn;
            return () => {
              fire = undefined;
            };
          },
        },
      ).generate(request),
    );
    const last = events.at(-1);
    expect(last?.type).toBe('failed');
    if (last?.type === 'failed') expect(last.error.code).toBe('REQUEST_TIMEOUT');
  });

  it('rejects an unexpected redirect', async () => {
    const events = await collect(
      provider({ generate: fixtures.jsonResponse(302, '', 'http://evil.example.com/api/generate') }).generate(request),
    );
    const last = events.at(-1);
    expect(last?.type).toBe('failed');
    if (last?.type === 'failed') expect(last.error.code).toBe('PROVIDER_PROTOCOL_ERROR');
  });

  it('rejects a response that came from another origin', async () => {
    const events = await collect(
      provider({ generate: fixtures.streamResponse([terminalRecord()], 200, 'http://10.0.0.9:11434/api/generate') })
        .generate(request),
    );
    const last = events.at(-1);
    expect(last?.type).toBe('failed');
    if (last?.type === 'failed') expect(last.error.message).toContain('different origin');
  });

  it('rejects an invalid request without contacting the daemon', async () => {
    for (const bad of [{ modelId: '', prompt: 'x' }, { modelId: 'qwen3:14b', prompt: '' }]) {
      const events = await collect(provider().generate(bad));
      const last = events.at(-1);
      expect(last?.type).toBe('failed');
      if (last?.type === 'failed') expect(last.error.code).toBe('REQUEST_INVALID');
    }
  });
});

describe('remote inference rejection', () => {
  it('refuses generation for a model marked remote at preflight', async () => {
    const events = await collect(
      provider({
        tags: fixtures.jsonResponse(200, { models: [REMOTE_MODEL_ENTRY] }),
        show: fixtures.jsonResponse(200, { ...SHOW_BODY, remote_host: 'https://ollama.com' }),
      }).generate({ ...request, modelId: REMOTE_MODEL_ENTRY.name }),
    );
    const last = events.at(-1);
    expect(last?.type).toBe('failed');
    if (last?.type === 'failed') expect(last.error.code).toBe('REMOTE_INFERENCE_FORBIDDEN');
    // Nothing was generated.
    expect(events.filter(event => event.type === 'token')).toHaveLength(0);
  });

  it('aborts immediately when remote metadata appears during generation', async () => {
    // Preflight looks local; the daemon then switches to a remote backend.
    const sneaky = `${JSON.stringify({
      model: 'qwen3:14b',
      response: 'leak',
      done: false,
      remote_model: 'frontier',
    })}\n`;
    const events = await collect(
      provider({ generate: fixtures.streamResponse([generateRecord('ok'), sneaky, terminalRecord()]) }).generate(
        request,
      ),
    );
    const last = events.at(-1);
    expect(last?.type).toBe('failed');
    if (last?.type === 'failed') expect(last.error.code).toBe('REMOTE_INFERENCE_FORBIDDEN');
    // The stream stopped at the offending record; nothing after it was emitted.
    expect(events.filter(event => event.type === 'token')).toHaveLength(1);
  });

  it('a locally addressed daemon cannot make IntentSmith accept cloud output', async () => {
    // The endpoint is loopback and the transport is healthy: the only thing
    // that stops this is the metadata check.
    const local = new OllamaProvider({
      endpoint: 'http://127.0.0.1:11434',
      transport: fixtureTransport({
        tags: fixtures.jsonResponse(200, { models: [{ ...LOCAL_MODEL_ENTRY, remote_host: 'https://ollama.com' }] }),
      }),
      timeouts: FAST,
    });
    const models = await local.listModels();
    expect(models[0]?.execution).toBe('remote_forbidden');

    const events = await collect(local.generate(request));
    const last = events.at(-1);
    expect(last?.type).toBe('failed');
    if (last?.type === 'failed') expect(last.error.code).toBe('REMOTE_INFERENCE_FORBIDDEN');
  });
});
