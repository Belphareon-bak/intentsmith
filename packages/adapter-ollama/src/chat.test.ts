import { describe, expect, it } from 'vitest';

import { ProviderError, type ChatMessage } from '@intentsmith/inference';

import { OllamaProvider } from './adapter.js';
import { REMOTE_MODEL_ENTRY, chatRecord, fixtureTransport, fixtures, type FixtureRoutes } from './fixtures.js';

/**
 * Tool-calling chat surface, offline.
 *
 * The interesting cases are the ones where the model is wrong rather than the
 * daemon: call-shaped prose, malformed tool calls, and a payload that claims a
 * tool call it never structured.
 */

const FAST = { connectMs: 50, firstByteMs: 50, idleMs: 50, overallMs: 500 };

function provider(routes: FixtureRoutes = {}) {
  return new OllamaProvider({
    endpoint: 'http://127.0.0.1:11434',
    transport: fixtureTransport(routes),
    timeouts: FAST,
  });
}

const messages: ChatMessage[] = [{ role: 'user', content: 'read the manifest' }];
const tools = [{ name: 'read', description: 'read a file', parameters: { type: 'object', properties: {} } }];

function sentChat(capture: Array<{ url: string; body?: string }>): Record<string, unknown> {
  const entry = capture.find(request => request.url.endsWith('/api/chat'));
  if (!entry?.body) throw new Error('no /api/chat request was sent');
  return JSON.parse(entry.body) as Record<string, unknown>;
}

describe('tool-calling chat', () => {
  it('returns a structured tool call', async () => {
    const result = await provider({
      chat: fixtures.jsonResponse(
        200,
        chatRecord({ toolCalls: [{ name: 'read', arguments: { path: 'package.json' } }] }),
      ),
    }).chat({ modelId: 'qwen3:14b', messages, tools });

    expect(result.finishReason).toBe('tool_calls');
    expect(result.toolCalls).toEqual([{ id: 'call_0', name: 'read', arguments: { path: 'package.json' } }]);
    expect(result.usage).toEqual({ promptTokens: 11, completionTokens: 7 });
  });

  it('returns plain text when the model just answers', async () => {
    const result = await provider({
      chat: fixtures.jsonResponse(200, chatRecord({ content: 'the package is named intentsmith' })),
    }).chat({ modelId: 'qwen3:14b', messages, tools });

    expect(result.finishReason).toBe('stop');
    expect(result.toolCalls).toEqual([]);
  });

  it('refuses a tool call written as text instead of executing it', async () => {
    const call = provider({
      chat: fixtures.jsonResponse(
        200,
        chatRecord({ content: "I'll search the workspace.\n\n<function=list_files>\n" }),
      ),
    }).chat({ modelId: 'qwen3-coder:30b', messages, tools });

    await expect(call).rejects.toMatchObject({ code: 'MODEL_TOOL_PROTOCOL_ERROR' });
  });

  it('leaves call-shaped prose alone when no tools were offered', async () => {
    // Without tools there is no protocol to violate, and the text is just text.
    const result = await provider({
      chat: fixtures.jsonResponse(200, chatRecord({ content: 'write <function=x> to call a tool' })),
    }).chat({ modelId: 'qwen3:14b', messages });

    expect(result.finishReason).toBe('stop');
  });

  it('rejects a tool call whose arguments are not an object', async () => {
    const call = provider({
      chat: fixtures.jsonResponse(200, {
        model: 'qwen3:14b',
        message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read', arguments: 'oops' } }] },
        done: true,
      }),
    }).chat({ modelId: 'qwen3:14b', messages, tools });

    await expect(call).rejects.toBeInstanceOf(ProviderError);
  });

  it('refuses a remote-backed model before sending anything', async () => {
    const capture: Array<{ url: string; body?: string }> = [];
    const call = provider({
      capture,
      tags: fixtures.jsonResponse(200, { models: [REMOTE_MODEL_ENTRY] }),
      show: fixtures.jsonResponse(200, { remote_host: 'https://ollama.com', model_info: {} }),
    }).chat({ modelId: REMOTE_MODEL_ENTRY.model, messages, tools });

    await expect(call).rejects.toMatchObject({ code: 'REMOTE_INFERENCE_FORBIDDEN' });
    expect(capture.some(request => request.url.endsWith('/api/chat'))).toBe(false);
  });

  it('requires a model id and at least one message', async () => {
    await expect(provider().chat({ modelId: '  ', messages })).rejects.toMatchObject({ code: 'REQUEST_INVALID' });
    await expect(provider().chat({ modelId: 'qwen3:14b', messages: [] })).rejects.toMatchObject({
      code: 'REQUEST_INVALID',
    });
  });

  it('does not start once the caller has already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      provider().chat({ modelId: 'qwen3:14b', messages }, controller.signal),
    ).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' });
  });
});

describe('what reaches the daemon', () => {
  it('forwards an explicit thinking decision and omits it otherwise', async () => {
    const withThink: Array<{ url: string; body?: string }> = [];
    await provider({ capture: withThink }).chat({ modelId: 'qwen3:14b', messages, tools, think: false });
    expect(sentChat(withThink).think).toBe(false);

    const without: Array<{ url: string; body?: string }> = [];
    await provider({ capture: without }).chat({ modelId: 'qwen3:14b', messages, tools });
    expect('think' in sentChat(without)).toBe(false);
  });

  it('never streams, so no partial tool call has to be reassembled', async () => {
    const capture: Array<{ url: string; body?: string }> = [];
    await provider({ capture }).chat({ modelId: 'qwen3:14b', messages, tools });
    expect(sentChat(capture).stream).toBe(false);
  });

  it('carries an assistant tool call and its result into the next turn', async () => {
    const capture: Array<{ url: string; body?: string }> = [];
    await provider({ capture }).chat({
      modelId: 'qwen3:14b',
      tools,
      messages: [
        { role: 'user', content: 'read the manifest' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'call_0', name: 'read', arguments: { path: 'p.json' } }] },
        { role: 'tool', toolCallId: 'call_0', content: '{"name":"intentsmith"}' },
      ],
    });

    const sent = sentChat(capture);
    const sentMessages = sent.messages as Array<Record<string, unknown>>;
    expect(sentMessages.map(message => message.role)).toEqual(['user', 'assistant', 'tool']);
    expect(sentMessages[1]?.tool_calls).toEqual([{ function: { name: 'read', arguments: { path: 'p.json' } } }]);
    expect(sentMessages[2]?.content).toBe('{"name":"intentsmith"}');
  });

  it('forwards the advertised tool schema unchanged', async () => {
    const capture: Array<{ url: string; body?: string }> = [];
    const schema = { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] };
    await provider({ capture }).chat({
      modelId: 'qwen3:14b',
      messages,
      tools: [{ name: 'read', description: 'read a file', parameters: schema }],
    });

    expect(sentChat(capture).tools).toEqual([
      { type: 'function', function: { name: 'read', description: 'read a file', parameters: schema } },
    ]);
  });
});
