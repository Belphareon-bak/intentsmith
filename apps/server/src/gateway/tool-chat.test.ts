import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { chatRecord, fixtureTransport, fixtures } from '@intentsmith/adapter-ollama/fixtures';
import { DisposableWorkspace, createTestRuntime, type TestRuntime } from '@intentsmith/testing';
import type { EffectiveInferenceSettings } from '@intentsmith/inference';

import { createTestServerRuntime } from '../test-runtime.js';
import { buildGateway } from './gateway.js';
import { GatewayTokenStore } from './token-store.js';
import { TOOL_LIMITS, normalizeMessages, normalizeTools, toOpenAiToolCalls } from './tool-chat.js';

/**
 * Tool-capable gateway path.
 *
 * Two things are being proven: that a tool round trip survives translation
 * intact, and that the gateway refuses everything it cannot mediate instead of
 * approximating it. The gateway executes nothing in any of these cases.
 */

let core: TestRuntime;
let workspace: DisposableWorkspace;
let tokens: GatewayTokenStore;
let profiles: EffectiveInferenceSettings[];

beforeEach(() => {
  core = createTestRuntime();
  workspace = new DisposableWorkspace();
  tokens = new GatewayTokenStore();
  profiles = [];
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
  return buildGateway({
    runtime,
    tokens,
    now: () => 1_780_000_000_000,
    onInferenceProfile: settings => profiles.push(settings),
  });
}

const auth = (value: string) => ({ authorization: `Bearer ${value}` });
const readTool = { type: 'function', function: { name: 'read', parameters: { type: 'object', properties: {} } } };

const post = async (
  app: ReturnType<typeof gateway>,
  payload: Record<string, unknown>,
): Promise<ReturnType<typeof app.inject> extends Promise<infer R> ? R : never> => {
  const token = tokens.issue('run_1');
  return await app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    headers: auth(token.value),
    payload: { model: 'qwen3:14b', messages: [{ role: 'user', content: 'read it' }], ...payload },
  });
};

describe('tool round trip', () => {
  it('returns a tool call in the OpenAI shape, with arguments as a JSON string', async () => {
    const app = gateway({
      chat: fixtures.jsonResponse(
        200,
        chatRecord({ toolCalls: [{ name: 'read', arguments: { path: 'package.json' } }] }),
      ),
    });
    const response = await post(app, { tools: [readTool], tool_choice: 'auto' });

    expect(response.statusCode).toBe(200);
    const choice = response.json().choices[0];
    expect(choice.finish_reason).toBe('tool_calls');
    // Ollama reports an object here; OpenAI requires a string, and a client
    // that receives the wrong one fails silently.
    expect(choice.message.tool_calls[0].function).toEqual({
      name: 'read',
      arguments: '{"path":"package.json"}',
    });
  });

  it('streams tool-call deltas when the worker asks for a stream', async () => {
    const app = gateway({
      chat: fixtures.jsonResponse(
        200,
        chatRecord({ toolCalls: [{ name: 'read', arguments: { path: 'package.json' } }] }),
      ),
    });
    const response = await post(app, { tools: [readTool], stream: true });

    expect(response.headers['content-type']).toContain('text/event-stream');
    // A non-streamed body for a streamed request is silently unusable to a real
    // client: it ends the turn with no execution and no error at all.
    expect(response.body).toContain('"tool_calls"');
    expect(response.body).toContain('"finish_reason":"tool_calls"');
    expect(response.body.trimEnd().endsWith('data: [DONE]')).toBe(true);
  });

  it('carries an assistant tool call and its result into the next turn', async () => {
    const capture: Array<{ url: string; body?: string }> = [];
    const app = gateway({ capture });
    const response = await post(app, {
      tools: [readTool],
      messages: [
        { role: 'user', content: 'read it' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_0', type: 'function', function: { name: 'read', arguments: '{"path":"p.json"}' } }],
        },
        { role: 'tool', tool_call_id: 'call_0', content: '{"name":"intentsmith"}' },
      ],
    });

    expect(response.statusCode).toBe(200);
    const sent = JSON.parse(capture.find(entry => entry.url.endsWith('/api/chat'))?.body ?? '{}') as {
      messages: Array<Record<string, unknown>>;
    };
    expect(sent.messages.map(message => message.role)).toEqual(['user', 'assistant', 'tool']);
  });
});

describe('what the gateway refuses', () => {
  it('refuses a forced or named tool choice instead of treating it as auto', async () => {
    const response = await post(gateway(), { tools: [readTool], tool_choice: 'required' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('TOOL_CHOICE_UNSUPPORTED');
  });

  it('refuses parallel tool calls up front', async () => {
    const response = await post(gateway(), { tools: [readTool], parallel_tool_calls: true });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('PARALLEL_TOOL_CALLS_UNSUPPORTED');
  });

  it('refuses a model whose tool protocol was never observed', async () => {
    const response = await post(gateway(), { model: 'someone-elses-model:7b', tools: [readTool] });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('MODEL_TOOL_PROFILE_UNKNOWN');
  });

  it('refuses a model quarantined for writing calls as prose', async () => {
    const response = await post(gateway(), { model: 'qwen3-coder:30b', tools: [readTool] });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('MODEL_TOOL_PROTOCOL_QUARANTINED');
  });

  it('refuses more tools than the limit allows', async () => {
    const many = Array.from({ length: TOOL_LIMITS.maxTools + 1 }, (_, index) => ({
      type: 'function',
      function: { name: `tool_${index}`, parameters: { type: 'object' } },
    }));
    const response = await post(gateway(), { tools: many });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('TOOL_REQUEST_TOO_LARGE');
  });

  it('refuses an oversized tool schema', async () => {
    const huge = {
      type: 'function',
      function: {
        name: 'read',
        parameters: { type: 'object', description: 'x'.repeat(TOOL_LIMITS.maxToolSchemaBytes + 1) },
      },
    };
    const response = await post(gateway(), { tools: [huge] });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('TOOL_REQUEST_TOO_LARGE');
  });

  it('surfaces a model that wrote its tool call as text', async () => {
    const app = gateway({
      chat: fixtures.jsonResponse(200, chatRecord({ content: 'let me look.\n<function=read>\n' })),
    });
    const response = await post(app, { tools: [readTool] });
    expect(response.json().error.code).toBe('MODEL_TOOL_PROTOCOL_ERROR');
  });

  it('refuses two tool calls arriving in one turn', () => {
    expect(() =>
      toOpenAiToolCalls({
        text: '',
        finishReason: 'tool_calls',
        toolCalls: [
          { id: 'a', name: 'read', arguments: {} },
          { id: 'b', name: 'write', arguments: {} },
        ],
      }),
    ).toThrow(/parallel tool calling is not supported/);
  });
});

describe('profile authority', () => {
  it('overrules the worker sampling request and records what actually ran', async () => {
    const app = gateway();
    const response = await post(app, { tools: [readTool], max_tokens: 100_000, temperature: 1.5 });

    expect(response.statusCode).toBe(200);
    expect(profiles).toHaveLength(1);
    const applied = profiles[0];
    // qwen3:14b passes its scenarios only with thinking disabled, so a worker
    // must not be able to turn it back on by asking.
    expect(applied?.think).toBe(false);
    expect(applied?.maxOutputTokens).toBe(512);
    expect(applied?.temperature).toBe(0);
    expect(applied?.overruled).toContain('max_tokens');
    expect(applied?.overruled).toContain('temperature');
  });

  it('sends the thinking decision from the profile to the daemon', async () => {
    const capture: Array<{ url: string; body?: string }> = [];
    await post(gateway({ capture }), { tools: [readTool] });
    const sent = JSON.parse(capture.find(entry => entry.url.endsWith('/api/chat'))?.body ?? '{}') as {
      think?: boolean;
      options?: { num_predict?: number };
    };
    expect(sent.think).toBe(false);
    expect(sent.options?.num_predict).toBe(512);
  });
});

describe('translation units', () => {
  it('rejects a duplicate tool name, which would make an audit ambiguous', () => {
    expect(() =>
      normalizeTools([
        { type: 'function', function: { name: 'read', parameters: {} } },
        { type: 'function', function: { name: 'read', parameters: {} } },
      ]),
    ).toThrow(/advertised more than once/);
  });

  it('rejects a tool type it does not implement', () => {
    expect(() => normalizeTools([{ type: 'retrieval', function: { name: 'x' } }])).toThrow(/not supported/);
  });

  it('rejects a schema nested past the depth limit', () => {
    let deep: Record<string, unknown> = { type: 'string' };
    for (let level = 0; level <= TOOL_LIMITS.maxToolSchemaDepth + 2; level += 1) deep = { properties: deep };
    expect(() => normalizeTools([{ type: 'function', function: { name: 'read', parameters: deep } }])).toThrow(
      /nested deeper/,
    );
  });

  it('rejects a tool result with no call id to correlate it', () => {
    expect(() => normalizeMessages([{ role: 'tool', content: '{}' }])).toThrow(/tool_call_id/);
  });

  it('rejects tool-call arguments that are not a JSON object', () => {
    expect(() =>
      normalizeMessages([
        { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read', arguments: '"just a string"' } }] },
      ]),
    ).toThrow(/not a JSON object/);
  });

  it('rejects a tool with no function name', () => {
    expect(() => normalizeTools([{ type: 'function', function: { parameters: {} } }])).toThrow(/function name/);
  });

  it('rejects a parameter schema that is not an object', () => {
    expect(() =>
      normalizeTools([{ type: 'function', function: { name: 'read', parameters: ['nope'] } }]),
    ).toThrow(/not an object/);
  });

  it('rejects a toolset that is individually small but collectively oversized', () => {
    const filler = 'x'.repeat(TOOL_LIMITS.maxToolSchemaBytes - 64);
    const tools = Array.from({ length: TOOL_LIMITS.maxTools }, (_, index) => ({
      type: 'function',
      function: { name: `tool_${index}`, parameters: { type: 'object', description: filler } },
    }));
    expect(() => normalizeTools(tools)).toThrow(/in total/);
  });

  it('keeps a tool description and defaults a missing schema', () => {
    expect(normalizeTools([{ type: 'function', function: { name: 'read', description: 'reads' } }])).toEqual([
      { name: 'read', description: 'reads', parameters: { type: 'object', properties: {} } },
    ]);
  });

  it('rejects more messages than the limit allows', () => {
    const many = Array.from({ length: TOOL_LIMITS.maxMessages + 1 }, () => ({ role: 'user', content: 'hi' }));
    expect(() => normalizeMessages(many)).toThrow(/at most/);
  });

  it('rejects a role it does not implement', () => {
    expect(() => normalizeMessages([{ role: 'developer', content: 'hi' }])).toThrow(/Unsupported message role/);
  });

  it('reads the content-part array form a real client may send', () => {
    expect(normalizeMessages([{ role: 'user', content: [{ text: 'read ' }, { text: 'it' }, { image: 'x' }] }])).toEqual(
      [{ role: 'user', content: 'read it' }],
    );
  });

  it('rejects content that is not text at all', () => {
    expect(() => normalizeMessages([{ role: 'user', content: 42 }])).toThrow(/must be text/);
  });

  it('rejects an assistant tool call with no function name', () => {
    expect(() =>
      normalizeMessages([{ role: 'assistant', content: '', tool_calls: [{ function: { arguments: '{}' } }] }]),
    ).toThrow(/requires a function name/);
  });

  it('accepts tool-call arguments already given as an object, and as nothing at all', () => {
    expect(
      normalizeMessages([
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'a', function: { name: 'read', arguments: { path: 'p' } } },
            { id: 'b', function: { name: 'glob' } },
          ],
        },
      ]),
    ).toEqual([
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'a', name: 'read', arguments: { path: 'p' } },
          { id: 'b', name: 'glob', arguments: {} },
        ],
      },
    ]);
  });

  it('rejects tool-call arguments of an impossible type', () => {
    expect(() =>
      normalizeMessages([
        { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read', arguments: 7 } }] },
      ]),
    ).toThrow(/not a JSON object/);
  });

  it('rejects a tool call whose JSON arguments are malformed', () => {
    expect(() =>
      normalizeMessages([
        { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read', arguments: '{oops' } }] },
      ]),
    ).toThrow(/not a JSON object/);
  });

  it('accepts an assistant turn that is only a tool call', () => {
    const [message] = normalizeMessages([
      { role: 'assistant', content: null, tool_calls: [{ id: 'c', function: { name: 'read', arguments: '{}' } }] },
    ]);
    expect(message).toEqual({
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'c', name: 'read', arguments: {} }],
    });
  });
});
