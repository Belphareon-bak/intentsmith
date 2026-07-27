import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply } from 'fastify';

import { applyExecutionPolicy, assessFit, type ExecutionPolicy } from '@intentsmith/hardware';
import {
  ProviderError,
  normalizeProviderError,
  type InferenceEvent,
  type ModelDescriptor,
} from '@intentsmith/inference';

import type { ServerRuntime } from './app.js';

/**
 * Inference, hardware and recovery routes.
 *
 * Raw Ollama DTOs never reach a client: everything here is a normalized type
 * from `@intentsmith/inference` or `@intentsmith/hardware`.
 */

/** Prompts are bounded so a client cannot exhaust the daemon or memory. */
const MAX_PROMPT_CHARS = 32_000;
const MAX_OUTPUT_TOKENS = 4096;

const GenerateBodySchema = Type.Object(
  {
    modelId: Type.String({ minLength: 1, maxLength: 200 }),
    prompt: Type.String({ minLength: 1, maxLength: MAX_PROMPT_CHARS }),
    system: Type.Optional(Type.String({ maxLength: MAX_PROMPT_CHARS })),
    maxOutputTokens: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_OUTPUT_TOKENS })),
    temperature: Type.Optional(Type.Number({ minimum: 0, maximum: 2 })),
    stream: Type.Optional(Type.Boolean()),
    executionPolicy: Type.Optional(
      Type.Union([Type.Literal('gpu_required'), Type.Literal('gpu_preferred'), Type.Literal('cpu_allowed')]),
    ),
  },
  { additionalProperties: false },
);

const AssessBodySchema = Type.Object(
  {
    executionPolicy: Type.Optional(
      Type.Union([Type.Literal('gpu_required'), Type.Literal('gpu_preferred'), Type.Literal('cpu_allowed')]),
    ),
  },
  { additionalProperties: false },
);

const ModelParamsSchema = Type.Object(
  { modelId: Type.String({ minLength: 1, maxLength: 200 }) },
  { additionalProperties: false },
);

/** Maps a provider error code onto an HTTP status. */
export function providerStatus(code: string): number {
  switch (code) {
    case 'MODEL_NOT_FOUND':
      return 404;
    case 'REQUEST_INVALID':
      return 400;
    case 'REMOTE_INFERENCE_FORBIDDEN':
    case 'MODEL_FIT_REJECTED':
      return 403;
    case 'REQUEST_TIMEOUT':
      return 504;
    case 'REQUEST_CANCELLED':
      return 499;
    case 'PROVIDER_UNAVAILABLE':
      return 503;
    default:
      return 502;
  }
}

export function registerInferenceRoutes(app: FastifyInstance, runtime: ServerRuntime): void {
  const send = (reply: FastifyReply, error: unknown): FastifyReply => {
    const normalized = normalizeProviderError(error);
    return reply.status(providerStatus(normalized.code)).send({ error: normalized });
  };

  app.get('/inference/providers', async () => ({
    providers: [
      {
        ...runtime.provider.identity(),
        endpoint: runtime.provider.origin,
        capabilities: await runtime.provider.capabilities(),
      },
    ],
  }));

  app.get('/inference/providers/ollama/health', async () => await runtime.provider.health());

  app.get('/inference/models', async (_request, reply) => {
    try {
      return { models: await runtime.provider.listModels() };
    } catch (error) {
      return send(reply, error);
    }
  });

  app.get('/inference/models/:modelId', { schema: { params: ModelParamsSchema } }, async (request, reply) => {
    const { modelId } = request.params as { modelId: string };
    try {
      const described = await runtime.provider.describeModel(modelId);
      // `show` holds raw Ollama metadata and is deliberately not returned.
      const { show: _show, ...descriptor } = described;
      return descriptor;
    } catch (error) {
      return send(reply, error);
    }
  });

  app.post(
    '/inference/models/:modelId/assess',
    { schema: { params: ModelParamsSchema, body: AssessBodySchema } },
    async (request, reply) => {
      const { modelId } = request.params as { modelId: string };
      const body = (request.body ?? {}) as { executionPolicy?: ExecutionPolicy };
      const policy = body.executionPolicy ?? runtime.executionPolicy;
      try {
        const described = await runtime.provider.describeModel(modelId);
        const { show: _show, ...descriptor } = described;
        const profile = await runtime.hardware.profile();
        const assessment = assessFit(descriptor as ModelDescriptor, profile);
        return { model: descriptor, decision: applyExecutionPolicy(assessment, policy) };
      } catch (error) {
        return send(reply, error);
      }
    },
  );

  app.get('/hardware', async () => await runtime.hardware.profile());

  app.get('/runtime/recovery', async (_request, reply) => {
    const summary = runtime.recovery;
    if (!summary) {
      return reply.status(503).send({
        error: {
          code: 'RECOVERY_NOT_RUN',
          message: 'Startup recovery has not completed.',
          retryable: true,
        },
      });
    }
    return summary;
  });

  /**
   * Streams generation as `application/x-ndjson`, one normalized
   * InferenceEvent per line.
   *
   * Errors raised before the first byte use the standard JSON error envelope
   * with a real status code. Once the stream has started the status is already
   * committed, so a failure becomes a terminal `failed` event instead.
   */
  app.post('/inference/generate', { schema: { body: GenerateBodySchema } }, async (request, reply) => {
    const body = request.body as {
      modelId: string;
      prompt: string;
      system?: string;
      maxOutputTokens?: number;
      temperature?: number;
      stream?: boolean;
      executionPolicy?: ExecutionPolicy;
    };
    const policy = body.executionPolicy ?? runtime.executionPolicy;
    const controller = new AbortController();
    // A client that hangs up must not leave the daemon generating.
    request.raw.on('close', () => controller.abort());

    let release: (() => void) | undefined;
    try {
      const described = await runtime.provider.describeModel(body.modelId, controller.signal);
      const { show: _show, ...descriptor } = described;
      const profile = await runtime.hardware.profile(controller.signal);
      const decision = applyExecutionPolicy(assessFit(descriptor as ModelDescriptor, profile), policy);
      if (!decision.allowed) {
        throw new ProviderError(
          decision.errorCode === 'REMOTE_INFERENCE_FORBIDDEN' ? 'REMOTE_INFERENCE_FORBIDDEN' : 'REQUEST_INVALID',
          decision.reason ?? 'Model was rejected by the execution policy.',
        );
      }
      release = await runtime.scheduler.acquire(controller.signal);
    } catch (error) {
      // Nothing has been written yet, so a proper status is still possible.
      release?.();
      return send(reply, error);
    }

    reply.raw.setHeader('content-type', 'application/x-ndjson');
    reply.raw.setHeader('cache-control', 'no-store');
    let terminalWritten = false;
    const write = (event: InferenceEvent): void => {
      if (terminalWritten) return;
      if (event.type === 'completed' || event.type === 'failed') terminalWritten = true;
      reply.raw.write(`${JSON.stringify(event)}\n`);
    };

    try {
      for await (const event of runtime.provider.generate(
        {
          modelId: body.modelId,
          prompt: body.prompt,
          ...(body.system === undefined ? {} : { system: body.system }),
          maxOutputTokens: body.maxOutputTokens ?? 512,
          ...(body.temperature === undefined ? {} : { temperature: body.temperature }),
          stream: body.stream !== false,
        },
        controller.signal,
      )) {
        write(event);
      }
      if (!terminalWritten) {
        write({ type: 'failed', error: normalizeProviderError(new ProviderError('STREAM_INVALID', 'Provider ended without a terminal event.')) });
      }
    } catch (error) {
      write({ type: 'failed', error: normalizeProviderError(error) });
    } finally {
      release();
      reply.raw.end();
    }
    return reply;
  });
}
