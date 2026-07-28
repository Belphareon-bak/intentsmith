import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { Type } from '@sinclair/typebox';

import { applyExecutionPolicy, assessFit } from '@intentsmith/hardware';
import { ProviderError, normalizeProviderError, type ModelDescriptor } from '@intentsmith/inference';

import type { ServerRuntime } from '../app.js';
import { providerStatus } from '../inference-routes.js';
import type { GatewayTokenStore } from './token-store.js';

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

const ChatBodySchema = Type.Object(
  {
    model: Type.String({ minLength: 1, maxLength: 200 }),
    messages: Type.Array(
      Type.Object(
        {
          role: Type.Union([Type.Literal('system'), Type.Literal('user'), Type.Literal('assistant')]),
          content: Type.String({ maxLength: 32_000 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 64 },
    ),
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
    // Present in the schema only so an explicit, actionable refusal is possible.
    // Omitting them would make Fastify reject the request with a generic
    // "additional properties" error that tells a worker nothing.
    tools: Type.Optional(Type.Array(Type.Unknown(), { maxItems: 128 })),
    tool_choice: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false },
);

export type GatewayOptions = {
  runtime: ServerRuntime;
  tokens: GatewayTokenStore;
  now?: () => number;
};

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
      messages: Array<{ role: string; content: string }>;
      stream?: boolean;
      max_tokens?: number;
      temperature?: number;
      top_p?: number;
      tools?: unknown[];
    };
    // Tool calling is not implemented by the Phase 2 provider surface.
    // Accepting the request and ignoring `tools` would be the dangerous
    // choice: the worker would believe it holds capabilities such as shell,
    // filesystem write and web fetch, and IntentSmith would have silently
    // agreed to something it cannot mediate or gate.
    if (Array.isArray(body.tools) && body.tools.length > 0) {
      return deny(
        reply,
        400,
        'TOOL_CALLING_UNSUPPORTED',
        'This gateway does not implement tool calling. It will not accept a request that advertises tools, because ignoring them would let the worker assume capabilities IntentSmith cannot mediate.',
      );
    }

    const { prompt, system } = flattenMessages(body.messages);
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
      // Identical gate to the normal API: local-only preflight, remote
      // rejection and model-fit policy, then a scheduler permit.
      const described = await runtime.provider.describeModel(body.model, controller.signal);
      const { show: _show, ...descriptor } = described;
      if (descriptor.execution === 'remote_forbidden') {
        throw new ProviderError(
          'REMOTE_INFERENCE_FORBIDDEN',
          `Refusing remote-backed inference for "${body.model}".`,
        );
      }
      const profile = await runtime.hardware.profile(controller.signal);
      const decision = applyExecutionPolicy(
        assessFit(descriptor as ModelDescriptor, profile),
        runtime.executionPolicy,
      );
      if (!decision.allowed) {
        throw new ProviderError('REQUEST_INVALID', decision.reason ?? 'Model rejected by execution policy.');
      }
      release = await runtime.scheduler.acquire(controller.signal);
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
