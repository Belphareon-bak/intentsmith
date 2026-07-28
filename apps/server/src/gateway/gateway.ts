import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { Type } from '@sinclair/typebox';

import { applyExecutionPolicy, assessFit } from '@intentsmith/hardware';
import {
  ProviderError,
  normalizeProviderError,
  supportsToolCalling,
  type EffectiveInferenceSettings,
  type ModelDescriptor,
} from '@intentsmith/inference';

import type { ServerRuntime } from '../app.js';
import { providerStatus } from '../inference-routes.js';
import type { GatewayTokenStore } from './token-store.js';
import {
  ToolRequestError,
  assertToolCallingAllowed,
  normalizeMessages,
  normalizeTools,
  toOpenAiToolCalls,
  type OpenAiMessage,
  type OpenAiTool,
} from './tool-chat.js';

/**
 * Loopback-only inference gateway for future external workers.
 *
 * A worker such as OpenCode speaks an OpenAI-shaped API. Pointing it straight
 * at a cloud endpoint, or even straight at Ollama, would put it outside every
 * IntentSmith guarantee. This gateway is the only inference path a worker gets:
 * it reuses the same `InferenceProvider`, Hardware Director, model-fit policy,
 * local-only endpoint checks and scheduler as the normal API, so a worker
 * cannot obtain capabilities the user's own API surface does not have.
 *
 * Deliberately minimal. Phase 2 implements `/v1/models` plus the chat surface
 * the Phase 2 provider actually supports (a prompt with optional system
 * framing). Phase 3 may extend it only after probing the pinned OpenCode build
 * and documenting what it genuinely requires; guessing now would mean shipping
 * untested surface.
 *
 * There is no cloud fallback anywhere in this file.
 */

export const GATEWAY_DEFAULT_HOST = '127.0.0.1';

/**
 * One message in either direction.
 *
 * `content` is nullable because an assistant turn that consists only of tool
 * calls carries no text, and `tool_calls`/`tool_call_id` are declared so a tool
 * conversation survives the round trip instead of being silently flattened.
 */
const MessageSchema = Type.Object(
  {
    role: Type.Union([
      Type.Literal('system'),
      Type.Literal('user'),
      Type.Literal('assistant'),
      Type.Literal('tool'),
    ]),
    content: Type.Optional(
      Type.Union([
        Type.String({ maxLength: 128_000 }),
        Type.Null(),
        Type.Array(Type.Unknown(), { maxItems: 64 }),
      ]),
    ),
    tool_calls: Type.Optional(Type.Array(Type.Unknown(), { maxItems: 16 })),
    tool_call_id: Type.Optional(Type.String({ maxLength: 200 })),
    name: Type.Optional(Type.String({ maxLength: 200 })),
  },
  { additionalProperties: false },
);

const ChatBodySchema = Type.Object(
  {
    model: Type.String({ minLength: 1, maxLength: 200 }),
    messages: Type.Array(MessageSchema, { minItems: 1, maxItems: 256 }),
    stream: Type.Optional(Type.Boolean()),
    // A real OpenAI-compatible client sends a wider sampling surface than the
    // minimum. These are accepted because they do not change what the request
    // means; anything that would is rejected below rather than dropped.
    max_tokens: Type.Optional(Type.Integer({ minimum: 1, maximum: 131_072 })),
    temperature: Type.Optional(Type.Number({ minimum: 0, maximum: 2 })),
    top_p: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    stream_options: Type.Optional(
      Type.Object({ include_usage: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
    ),
    tools: Type.Optional(Type.Array(Type.Unknown(), { maxItems: 128 })),
    tool_choice: Type.Optional(Type.Unknown()),
    // Declared so it can be refused with a reason. Accepting it silently would
    // let a worker believe two side effects may be requested at once.
    parallel_tool_calls: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export type GatewayOptions = {
  runtime: ServerRuntime;
  tokens: GatewayTokenStore;
  now?: () => number;
  /**
   * Receives the settings a tool-calling turn actually ran with.
   *
   * Run evidence has to record what was used, not what was asked for: a profile
   * that silently differs from the audit is worse than no profile at all.
   */
  onInferenceProfile?: (settings: EffectiveInferenceSettings) => void;
};

/**
 * Reduces OpenAI content to text for the plain path.
 *
 * Kept separate from the tool path's normalization so the Phase 2 surface keeps
 * behaving exactly as it did, while still tolerating the content-part array a
 * real client may send.
 */
function plainText(content: unknown): string {
  if (content === undefined || content === null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as Array<{ text?: unknown }>)
      .map(part => (typeof part.text === 'string' ? part.text : ''))
      .join('');
  }
  throw new ToolRequestError('REQUEST_INVALID', 'Message content must be text.');
}

/**
 * Flattens OpenAI chat messages onto the provider's prompt/system shape.
 *
 * Phase 2's provider surface is a single prompt with optional system framing,
 * so this is a faithful reduction rather than a pretence of full chat support:
 * assistant turns are included as transcript text, not replayed as roles.
 */
export function flattenMessages(
  messages: Array<{ role: string; content: string }>,
): { prompt: string; system?: string } {
  const system = messages
    .filter(message => message.role === 'system')
    .map(message => message.content)
    .join('\n')
    .trim();
  const conversation = messages.filter(message => message.role !== 'system');
  const prompt = conversation
    .map(message => (message.role === 'assistant' ? `Assistant: ${message.content}` : `User: ${message.content}`))
    .join('\n')
    .trim();
  return { prompt, ...(system.length > 0 ? { system } : {}) };
}

/** Builds the gateway app. Bind it to loopback only. */
export function buildGateway(options: GatewayOptions): FastifyInstance {
  const { runtime, tokens } = options;
  const app = Fastify({
    logger: false,
    bodyLimit: 1_048_576,
    // Match the main API: an unsupported field is an error, not something to
    // silently drop. A worker asking for `tools` must be told Phase 2 does not
    // implement it rather than have the request quietly reinterpreted.
    ajv: { customOptions: { removeAdditional: false } },
  });

  const deny = (reply: FastifyReply, status: number, code: string, message: string): FastifyReply =>
    reply.status(status).send({ error: { code, message, retryable: false } });

  /**
   * The gate every request passes, tools or not: local-only preflight, remote
   * rejection, model-fit policy, then a scheduler permit. Returns the permit's
   * release function.
   */
  const admitModel = async (modelId: string, signal: AbortSignal): Promise<() => void> => {
    const described = await runtime.provider.describeModel(modelId, signal);
    const { show: _show, ...descriptor } = described;
    if (descriptor.execution === 'remote_forbidden') {
      throw new ProviderError('REMOTE_INFERENCE_FORBIDDEN', `Refusing remote-backed inference for "${modelId}".`);
    }
    const hardwareProfile = await runtime.hardware.profile(signal);
    const decision = applyExecutionPolicy(
      assessFit(descriptor as ModelDescriptor, hardwareProfile),
      runtime.executionPolicy,
    );
    if (!decision.allowed) {
      throw new ProviderError('REQUEST_INVALID', decision.reason ?? 'Model rejected by execution policy.');
    }
    return await runtime.scheduler.acquire(signal);
  };

  /**
   * Serves one tool-calling turn.
   *
   * This path translates and nothing else. It does not run a tool, read a file,
   * spawn a process or reach the network beyond the same local provider the
   * plain path uses; a tool call is returned to the worker as data, and the
   * worker executes it only after its own permission handling.
   */
  const handleToolChat = async (
    body: {
      model: string;
      messages: OpenAiMessage[];
      tools?: OpenAiTool[];
      tool_choice?: unknown;
      parallel_tool_calls?: boolean;
      stream?: boolean;
      max_tokens?: number;
      temperature?: number;
    },
    reply: FastifyReply,
  ): Promise<FastifyReply | unknown> => {
    if (!supportsToolCalling(runtime.provider)) {
      return deny(
        reply,
        400,
        'TOOL_CALLING_UNSUPPORTED',
        'The configured provider cannot carry a tool-calling conversation, and this gateway will not silently serve the request as a plain completion.',
      );
    }

    // `required` and a named-function choice are not implemented. Accepting
    // either and behaving like `auto` would tell the worker its constraint was
    // honoured when it was not.
    const toolChoice = body.tool_choice ?? 'auto';
    if (toolChoice !== 'auto' && toolChoice !== 'none') {
      return deny(
        reply,
        400,
        'TOOL_CHOICE_UNSUPPORTED',
        'Only tool_choice "auto" and "none" are implemented; a forced or named choice is refused rather than approximated.',
      );
    }
    if (body.parallel_tool_calls === true) {
      return deny(
        reply,
        400,
        'PARALLEL_TOOL_CALLS_UNSUPPORTED',
        'Parallel tool calls are not supported: two side effects arriving as one indivisible turn cannot be mediated or audited separately.',
      );
    }

    let tools: ReturnType<typeof normalizeTools>;
    let messages: ReturnType<typeof normalizeMessages>;
    let effective: EffectiveInferenceSettings;
    try {
      effective = assertToolCallingAllowed(body.model);
      tools = normalizeTools(body.tools ?? []);
      messages = normalizeMessages(body.messages);
    } catch (error) {
      if (error instanceof ToolRequestError) return deny(reply, 400, error.code, error.message);
      throw error;
    }

    const controller = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) controller.abort();
    });

    let release: (() => void) | undefined;
    try {
      release = await admitModel(body.model, controller.signal);
    } catch (error) {
      release?.();
      const normalized = normalizeProviderError(error);
      return reply.status(providerStatus(normalized.code)).send({ error: normalized });
    }

    const created = Math.floor((options.now?.() ?? Date.now()) / 1000);
    const id = `chatcmpl-${created}`;

    try {
      // The profile decides; the worker's own sampling request is recorded as
      // overruled rather than blended in.
      const result = await runtime.provider.chat(
        {
          modelId: body.model,
          messages,
          ...(toolChoice === 'none' ? { toolChoice: 'none' as const } : { tools, toolChoice: 'auto' as const }),
          maxOutputTokens: effective.maxOutputTokens,
          temperature: effective.temperature,
          ...(effective.think === undefined ? {} : { think: effective.think }),
        },
        controller.signal,
      );
      options.onInferenceProfile?.({
        modelId: effective.modelId,
        role: effective.role,
        maxOutputTokens: effective.maxOutputTokens,
        temperature: effective.temperature,
        ...(effective.think === undefined ? {} : { think: effective.think }),
        toolProtocol: effective.toolProtocol,
        overruled: [
          ...effective.overruled,
          ...(body.max_tokens !== undefined && body.max_tokens > effective.maxOutputTokens ? ['max_tokens'] : []),
          ...(body.temperature !== undefined && body.temperature !== effective.temperature ? ['temperature'] : []),
        ],
      });

      const toolCalls = toOpenAiToolCalls(result);
      const finishReason = toolCalls.length > 0 ? 'tool_calls' : 'stop';
      const usage = {
        prompt_tokens: result.usage?.promptTokens ?? 0,
        completion_tokens: result.usage?.completionTokens ?? 0,
        total_tokens: (result.usage?.promptTokens ?? 0) + (result.usage?.completionTokens ?? 0),
      };

      if (body.stream !== true) {
        return {
          id,
          object: 'chat.completion',
          created,
          model: body.model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: result.text,
                ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
              },
              finish_reason: finishReason,
            },
          ],
          usage,
        };
      }

      // A real OpenAI-compatible client treats a non-streamed body for a
      // streamed request as unusable and ends the turn without an error, so the
      // tool call must arrive as SSE deltas or it may as well not exist.
      reply.raw.setHeader('content-type', 'text/event-stream');
      reply.raw.setHeader('cache-control', 'no-store');
      const chunk = (payload: Record<string, unknown>): void => {
        reply.raw.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: body.model, ...payload })}\n\n`);
      };

      chunk({ choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
      if (result.text.length > 0) {
        chunk({ choices: [{ index: 0, delta: { content: result.text }, finish_reason: null }] });
      }
      for (const [index, call] of toolCalls.entries()) {
        chunk({
          choices: [
            {
              index: 0,
              delta: { tool_calls: [{ index, id: call.id, type: 'function', function: call.function }] },
              finish_reason: null,
            },
          ],
        });
      }
      chunk({ choices: [{ index: 0, delta: {}, finish_reason: finishReason }] });
      chunk({ choices: [], usage });
      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();
      return reply;
    } catch (error) {
      const normalized = normalizeProviderError(error);
      if (reply.raw.headersSent) {
        // The status is already committed, so the failure travels in-band.
        reply.raw.write(`data: ${JSON.stringify({ error: normalized })}\n\n`);
        reply.raw.write('data: [DONE]\n\n');
        reply.raw.end();
        return reply;
      }
      return reply.status(providerStatus(normalized.code)).send({ error: normalized });
    } finally {
      release();
    }
  };

  /**
   * Every gateway route requires a valid per-run token, even on loopback.
   * The token itself is never logged, echoed, or included in any error.
   */
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    const presented = typeof header === 'string' && header.toLowerCase().startsWith('bearer ')
      ? header.slice(7).trim()
      : undefined;
    const token = tokens.verify(presented);
    if (!token) {
      return deny(reply, 401, 'GATEWAY_TOKEN_INVALID', 'A valid per-run gateway token is required.');
    }
    (request as FastifyRequest & { gatewayRunId?: string }).gatewayRunId = token.runId;
    return undefined;
  });

  /** OpenAI-shaped model list. Remote-backed models are never offered. */
  app.get('/v1/models', async (_request, reply) => {
    try {
      const models = await runtime.provider.listModels();
      return {
        object: 'list',
        data: models
          .filter(model => model.execution === 'local')
          .map(model => ({ id: model.id, object: 'model', owned_by: 'intentsmith-local' })),
      };
    } catch (error) {
      const normalized = normalizeProviderError(error);
      return reply.status(providerStatus(normalized.code)).send({ error: normalized });
    }
  });

  app.post('/v1/chat/completions', { schema: { body: ChatBodySchema } }, async (request, reply) => {
    const body = request.body as {
      model: string;
      messages: OpenAiMessage[];
      stream?: boolean;
      max_tokens?: number;
      temperature?: number;
      top_p?: number;
      tools?: OpenAiTool[];
      tool_choice?: unknown;
      parallel_tool_calls?: boolean;
    };

    const advertisesTools = Array.isArray(body.tools) && body.tools.length > 0;
    const carriesToolTurns = body.messages.some(
      message => message.role === 'tool' || (message.tool_calls?.length ?? 0) > 0,
    );

    if (advertisesTools) {
      return await handleToolChat(body, reply);
    }

    // A conversation containing tool turns without an advertised toolset cannot
    // be served as a plain completion: flattening it would drop the fact that a
    // tool ran, and the model would answer from a transcript that lies.
    if (carriesToolTurns) {
      return deny(
        reply,
        400,
        'TOOL_CALLING_UNSUPPORTED',
        'The conversation contains tool calls or tool results but advertises no tools.',
      );
    }

    let flattened: { prompt: string; system?: string };
    try {
      flattened = flattenMessages(
        body.messages.map(message => ({ role: message.role, content: plainText(message.content) })),
      );
    } catch (error) {
      const message = error instanceof ToolRequestError ? error.message : 'Message content must be text.';
      return deny(reply, 400, 'REQUEST_INVALID', message);
    }
    const { prompt, system } = flattened;
    if (prompt.length === 0) {
      return deny(reply, 400, 'REQUEST_INVALID', 'At least one user message is required.');
    }

    // Abort only on a genuine client disconnect. `request.raw.on('close')` is
    // the wrong signal: it fires when the request body has been consumed, so it
    // aborted every normal POST. `reply.raw` closing while the response is
    // still unfinished is what actually means "the client went away".
    const controller = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) controller.abort();
    });

    let release: (() => void) | undefined;
    try {
      release = await admitModel(body.model, controller.signal);
    } catch (error) {
      release?.();
      const normalized = normalizeProviderError(error);
      return reply.status(providerStatus(normalized.code)).send({ error: normalized });
    }

    const created = Math.floor((options.now?.() ?? Date.now()) / 1000);
    const id = `chatcmpl-${created}`;
    const streaming = body.stream === true;

    try {
      const events = runtime.provider.generate(
        {
          modelId: body.model,
          prompt,
          ...(system === undefined ? {} : { system }),
          // Clamp to the provider's own ceiling; a client may ask for far more.
          maxOutputTokens: Math.min(body.max_tokens ?? 512, 4096),
          ...(body.temperature === undefined ? {} : { temperature: body.temperature }),
          stream: streaming,
        },
        controller.signal,
      );

      if (!streaming) {
        let text = '';
        let failure: ProviderError | undefined;
        let usage: { promptTokens: number; completionTokens: number } | undefined;
        for await (const event of events) {
          if (event.type === 'completed') {
            text = event.text;
            usage = event.usage;
          } else if (event.type === 'failed') {
            failure = new ProviderError(event.error.code, event.error.message, event.error.retryable);
          }
        }
        if (failure) {
          const normalized = normalizeProviderError(failure);
          return reply.status(providerStatus(normalized.code)).send({ error: normalized });
        }
        return {
          id,
          object: 'chat.completion',
          created,
          model: body.model,
          choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
          usage: {
            prompt_tokens: usage?.promptTokens ?? 0,
            completion_tokens: usage?.completionTokens ?? 0,
            total_tokens: (usage?.promptTokens ?? 0) + (usage?.completionTokens ?? 0),
          },
        };
      }

      // OpenAI-style server-sent events.
      reply.raw.setHeader('content-type', 'text/event-stream');
      reply.raw.setHeader('cache-control', 'no-store');
      const chunk = (delta: Record<string, unknown>, finish: string | null): void => {
        reply.raw.write(
          `data: ${JSON.stringify({
            id,
            object: 'chat.completion.chunk',
            created,
            model: body.model,
            choices: [{ index: 0, delta, finish_reason: finish }],
          })}\n\n`,
        );
      };

      for await (const event of events) {
        if (event.type === 'token') chunk({ content: event.text }, null);
        else if (event.type === 'completed') chunk({}, 'stop');
        else if (event.type === 'failed') {
          // The status is already committed, so the failure travels in-band.
          reply.raw.write(`data: ${JSON.stringify({ error: event.error })}\n\n`);
        }
      }
      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();
      return reply;
    } finally {
      release();
    }
  });

  app.setNotFoundHandler((_request, reply) => {
    void deny(reply, 404, 'ROUTE_NOT_FOUND', 'Unknown gateway route.');
  });

  return app;
}
