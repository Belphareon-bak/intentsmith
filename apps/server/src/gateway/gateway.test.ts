import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { REMOTE_MODEL_ENTRY, SHOW_BODY, fixtureTransport, fixtures } from '@intentsmith/adapter-ollama/fixtures';
import { DisposableWorkspace, createTestRuntime, type TestRuntime } from '@intentsmith/testing';

import { createTestServerRuntime } from '../test-runtime.js';
import { buildGateway, flattenMessages } from './gateway.js';
import { GatewayTokenStore } from './token-store.js';

/**
 * Worker inference gateway tests.
 *
 * The gateway is the only inference path a future external worker gets, so
 * these prove it cannot be used to escape the local-only guarantees.
 */

let core: TestRuntime;
let workspace: DisposableWorkspace;
let tokens: GatewayTokenStore;

beforeEach(() => {
  core = createTestRuntime();
  workspace = new DisposableWorkspace();
  tokens = new GatewayTokenStore();
});

afterEach(async () => {
  await core.core.shutdown();
  core.cleanup();
  workspace.cleanup();
});

function gateway(routes: Parameters<typeof fixtureTransport>[0] = {}) {
  const runtime = createTestServerRuntime({
    core: core.core,
    transport: fixtureTransport(routes),
    gatewayTokens: tokens,
  });
  return buildGateway({ runtime, tokens, now: () => 1_780_000_000_000 });
}

const auth = (value: string) => ({ authorization: `Bearer ${value}` });

describe('gateway token store', () => {
  it('issues a token scoped to one run', () => {
    const token = tokens.issue('run_1', 'task_1');
    expect(token.runId).toBe('run_1');
    expect(tokens.verify(token.value)?.runId).toBe('run_1');
  });

  it('rejects an unknown or empty token', () => {
    tokens.issue('run_1');
    expect(tokens.verify('nope')).toBeUndefined();
    expect(tokens.verify(undefined)).toBeUndefined();
    expect(tokens.verify('')).toBeUndefined();
  });

  it('expires a token', () => {
    let now = 1000;
    const store = new GatewayTokenStore({ now: () => now, ttlMs: 100 });
    const token = store.issue('run_1');
    expect(store.verify(token.value)).toBeDefined();
    now += 101;
    expect(store.verify(token.value)).toBeUndefined();
  });

  it('revokes on run end and on shutdown', () => {
    const a = tokens.issue('run_a');
    const b = tokens.issue('run_b');
    expect(tokens.revokeRun('run_a')).toBe(true);
    expect(tokens.verify(a.value)).toBeUndefined();
    expect(tokens.verify(b.value)).toBeDefined();

    tokens.revokeAll();
    expect(tokens.verify(b.value)).toBeUndefined();
    expect(tokens.size).toBe(0);
  });

  it('replaces a previous token when a run is re-issued', () => {
    const first = tokens.issue('run_1');
    const second = tokens.issue('run_1');
    expect(tokens.verify(first.value)).toBeUndefined();
    expect(tokens.verify(second.value)).toBeDefined();
    expect(tokens.size).toBe(1);
  });

  it('never exposes the secret in its listing', () => {
    const token = tokens.issue('run_1', 'task_1');
    const listed = tokens.list();
    expect(listed[0]).toMatchObject({ runId: 'run_1', taskId: 'task_1' });
    expect(JSON.stringify(listed)).not.toContain(token.value);
  });

  it('prunes expired entries so the store cannot grow without bound', () => {
    let now = 1000;
    const store = new GatewayTokenStore({ now: () => now, ttlMs: 50 });
    store.issue('run_1');
    store.issue('run_2');
    now += 51;
    expect(store.pruneExpired()).toBe(2);
    expect(store.size).toBe(0);
  });
});

describe('gateway authentication', () => {
  it('refuses every route without a token, even on loopback', async () => {
    const app = gateway();
    for (const [method, url] of [
      ['GET', '/v1/models'],
      ['POST', '/v1/chat/completions'],
    ] as const) {
      const response = await app.inject({ method, url, payload: method === 'POST' ? {} : undefined });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('GATEWAY_TOKEN_INVALID');
    }
    await app.close();
  });

  it('refuses a wrong or expired token', async () => {
    const app = gateway();
    tokens.issue('run_1');
    expect((await app.inject({ method: 'GET', url: '/v1/models', headers: auth('wrong') })).statusCode).toBe(401);

    tokens.revokeAll();
    const stale = new GatewayTokenStore().issue('run_1');
    expect((await app.inject({ method: 'GET', url: '/v1/models', headers: auth(stale.value) })).statusCode).toBe(401);
    await app.close();
  });

  it('never echoes the token in a response', async () => {
    const app = gateway();
    const token = tokens.issue('run_1');
    const response = await app.inject({ method: 'GET', url: '/v1/models', headers: auth(token.value) });
    expect(response.body).not.toContain(token.value);
    expect(JSON.stringify(response.headers)).not.toContain(token.value);
    await app.close();
  });
});

describe('gateway model surface', () => {
  it('lists local models in OpenAI shape', async () => {
    const app = gateway();
    const token = tokens.issue('run_1');
    const body = (await app.inject({ method: 'GET', url: '/v1/models', headers: auth(token.value) })).json();
    expect(body.object).toBe('list');
    expect(body.data[0]).toMatchObject({ id: 'qwen3:14b', object: 'model', owned_by: 'intentsmith-local' });
    await app.close();
  });

  it('never offers a remote-backed model to a worker', async () => {
    const app = gateway({
      tags: fixtures.jsonResponse(200, { models: [REMOTE_MODEL_ENTRY] }),
    });
    const token = tokens.issue('run_1');
    const body = (await app.inject({ method: 'GET', url: '/v1/models', headers: auth(token.value) })).json();
    expect(body.data).toEqual([]);
    await app.close();
  });
});

describe('gateway chat completions', () => {
  const chat = {
    model: 'qwen3:14b',
    messages: [
      { role: 'system', content: 'Be terse.' },
      { role: 'user', content: 'ping' },
    ],
  };

  it('flattens messages onto the provider prompt shape', () => {
    const flattened = flattenMessages(chat.messages);
    expect(flattened.system).toBe('Be terse.');
    expect(flattened.prompt).toBe('User: ping');
  });

  it('returns a non-streamed completion', async () => {
    const app = gateway();
    const token = tokens.issue('run_1');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: auth(token.value),
      payload: chat,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.object).toBe('chat.completion');
    expect(body.choices[0].message).toEqual({ role: 'assistant', content: 'Hello world' });
    expect(body.usage.prompt_tokens).toBe(12);
    await app.close();
  });

  it('streams SSE chunks ending with DONE', async () => {
    const app = gateway();
    const token = tokens.issue('run_1');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: auth(token.value),
      payload: { ...chat, stream: true },
    });
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.body).toContain('chat.completion.chunk');
    expect(response.body.trimEnd().endsWith('data: [DONE]')).toBe(true);
    await app.close();
  });

  it('refuses a remote-backed model through the worker path', async () => {
    const app = gateway({
      tags: fixtures.jsonResponse(200, { models: [REMOTE_MODEL_ENTRY] }),
      show: fixtures.jsonResponse(200, { ...SHOW_BODY, remote_host: 'https://ollama.com' }),
    });
    const token = tokens.issue('run_1');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: auth(token.value),
      payload: { ...chat, model: REMOTE_MODEL_ENTRY.name },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('REMOTE_INFERENCE_FORBIDDEN');
    await app.close();
  });

  it('returns 404 for a model that is not installed locally', async () => {
    const app = gateway({ show: fixtures.jsonResponse(404, { error: 'not found' }) });
    const token = tokens.issue('run_1');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: auth(token.value),
      payload: { ...chat, model: 'missing:1b' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('MODEL_NOT_FOUND');
    await app.close();
  });

  it('rejects an unknown field and a message list that has no user turn', async () => {
    const app = gateway();
    const token = tokens.issue('run_1');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/chat/completions',
          headers: auth(token.value),
          payload: { ...chat, notARealField: true },
        })
      ).statusCode,
    ).toBe(400);

    const noUser = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: auth(token.value),
      payload: { model: 'qwen3:14b', messages: [{ role: 'system', content: 'only system' }] },
    });
    expect(noUser.statusCode).toBe(400);
    await app.close();
  });

  it('accepts the wider sampling surface a real OpenAI client sends', async () => {
    const app = gateway();
    const token = tokens.issue('run_1');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: auth(token.value),
      // Observed from a real OpenCode 1.18.8 request.
      payload: { ...chat, top_p: 1, stream_options: { include_usage: true }, max_tokens: 32_000 },
    });
    // These change nothing about what the request means, so they are honoured.
    expect(response.statusCode).toBe(200);
  });

  it('refuses a request that advertises tools rather than ignoring them', async () => {
    const app = gateway();
    const token = tokens.issue('run_1');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: auth(token.value),
      payload: {
        ...chat,
        tool_choice: 'auto',
        tools: [{ type: 'function', function: { name: 'bash' } }],
      },
    });

    // Accepting and dropping them would let the worker believe it holds shell,
    // filesystem and network capabilities IntentSmith cannot mediate.
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('TOOL_CALLING_UNSUPPORTED');
    expect(response.json().error.message).toContain('cannot mediate');
  });

  it('accepts an empty tools array, which advertises nothing', async () => {
    const app = gateway();
    const token = tokens.issue('run_1');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: auth(token.value),
      payload: { ...chat, tools: [] },
    });
    expect(response.statusCode).toBe(200);
  });

  it('returns a structured error for an unknown gateway route', async () => {
    const app = gateway();
    const token = tokens.issue('run_1');
    const response = await app.inject({ method: 'GET', url: '/v1/embeddings', headers: auth(token.value) });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('ROUTE_NOT_FOUND');
    await app.close();
  });

  it('does not leak the prompt or the full response into an error body', async () => {
    const app = gateway({ show: fixtures.jsonResponse(404, { error: 'not found' }) });
    const token = tokens.issue('run_1');
    const secret = 'SUPER-SECRET-PROMPT-TEXT';
    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: auth(token.value),
      payload: { model: 'missing:1b', messages: [{ role: 'user', content: secret }] },
    });
    expect(response.body).not.toContain(secret);
    await app.close();
  });
});
