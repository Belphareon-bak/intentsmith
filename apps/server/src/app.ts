import Fastify, { type FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import {
  CreateProjectInputSchema,
  CreateTaskInputSchema,
  VERSION,
} from '@intentsmith/contracts';
import { DomainError, normalizeError, type IntentSmithCore } from '@intentsmith/core';
import type { OllamaProvider } from '@intentsmith/adapter-ollama';
import type { ExecutionPolicy, HardwareDirector } from '@intentsmith/hardware';
import type { InferenceScheduler } from '@intentsmith/inference';

import { registerInferenceRoutes } from './inference-routes.js';
import type { GatewayTokenStore } from './gateway/token-store.js';
import type { RecoverySummary } from './recovery.js';

export type ServerRuntime = {
  core: IntentSmithCore;
  provider: OllamaProvider;
  scheduler: InferenceScheduler;
  hardware: HardwareDirector;
  /** Per-run tokens for the worker inference gateway. */
  gatewayTokens: GatewayTokenStore;
  executionPolicy: ExecutionPolicy;
  /** Populated by `prepare()`; undefined until startup recovery has run. */
  readonly recovery?: RecoverySummary;
  /** Runs startup recovery. Must succeed before the server binds. */
  prepare?(): Promise<RecoverySummary>;
  close(): void | Promise<void>;
};

const ParamsSchema = Type.Object({
  taskId: Type.Optional(Type.String({ minLength: 1 })),
  projectId: Type.Optional(Type.String({ minLength: 1 })),
}, { additionalProperties: false });

export function buildServer(runtime: ServerRuntime): FastifyInstance {
  const app = Fastify({
    logger: false,
    bodyLimit: 1_048_576,
    ajv: {
      customOptions: {
        removeAdditional: false,
      },
    },
  });

  app.setErrorHandler((error, _request, reply) => {
    const err = error as Error & { validation?: unknown; statusCode?: number };
    const normalized = error instanceof DomainError
      ? error.toNormalizedError()
      : err.statusCode === 413
        ? { code: 'PAYLOAD_TOO_LARGE', message: 'Request payload is too large', retryable: false }
      : err.validation
        ? { code: 'REQUEST_VALIDATION_FAILED', message: 'Request validation failed', retryable: false }
        : normalizeError(error);

    const statusCode = error instanceof DomainError
      ? domainStatus(error.code)
      : err.statusCode === 413
        ? 413
      : err.validation
        ? 400
        : 500;

    void reply.status(statusCode).send({
      error: {
        code: normalized.code,
        message: normalized.message,
        retryable: normalized.retryable,
      },
    });
  });

  // Unknown routes must use the same error envelope as everything else.
  app.setNotFoundHandler((_request, reply) => {
    void reply.status(404).send({
      error: { code: 'ROUTE_NOT_FOUND', message: 'Unknown route', retryable: false },
    });
  });

  app.get('/health', async (_request, reply) => {
    // The server only binds after recovery succeeds, so a missing summary here
    // means something started the app without preparing it.
    if (runtime.prepare && !runtime.recovery) {
      return reply.status(503).send({
        error: { code: 'RECOVERY_NOT_RUN', message: 'Startup recovery has not completed.', retryable: true },
      });
    }
    return { status: 'ok', service: 'intentsmith-core', recovery: runtime.recovery?.status ?? 'not_required' };
  });
  app.get('/version', async () => ({ version: VERSION, cli: 'intentsmith', package: 'intentsmith-core' }));

  app.post('/projects', { schema: { body: CreateProjectInputSchema } }, async request => {
    return await runtime.core.createProject(request.body as never);
  });

  app.get('/projects/:projectId', { schema: { params: ParamsSchema } }, async request => {
    const { projectId } = request.params as { projectId: string };
    return await runtime.core.getProject(projectId);
  });

  app.post('/tasks', { schema: { body: CreateTaskInputSchema } }, async request => {
    return await runtime.core.createTask(request.body as never);
  });

  app.get('/tasks/:taskId', { schema: { params: ParamsSchema } }, async request => {
    const { taskId } = request.params as { taskId: string };
    return await runtime.core.getTask(taskId);
  });

  app.post('/tasks/:taskId/start', { schema: { params: ParamsSchema } }, async request => {
    const { taskId } = request.params as { taskId: string };
    return await runtime.core.startTask(taskId);
  });

  app.post('/tasks/:taskId/pause', { schema: { params: ParamsSchema } }, async request => {
    const { taskId } = request.params as { taskId: string };
    return await runtime.core.pauseTask(taskId);
  });

  app.post('/tasks/:taskId/resume', { schema: { params: ParamsSchema } }, async request => {
    const { taskId } = request.params as { taskId: string };
    return await runtime.core.resumeTask(taskId);
  });

  app.post('/tasks/:taskId/cancel', { schema: { params: ParamsSchema } }, async request => {
    const { taskId } = request.params as { taskId: string };
    return await runtime.core.cancelTask(taskId);
  });

  app.get('/tasks/:taskId/result', { schema: { params: ParamsSchema } }, async request => {
    const { taskId } = request.params as { taskId: string };
    const result = await runtime.core.getTaskResult(taskId);
    if (!result) throw new DomainError('TASK_RESULT_NOT_FOUND', `Task result not found: ${taskId}`);
    return result;
  });

  app.get('/tasks/:taskId/audit', { schema: { params: ParamsSchema } }, async request => {
    const { taskId } = request.params as { taskId: string };
    return { events: await runtime.core.listAuditEvents(taskId) };
  });

  registerInferenceRoutes(app, runtime);

  app.addHook('onClose', async () => {
    await runtime.close();
  });

  return app;
}

function domainStatus(code: string): number {
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (code === 'INVALID_TASK_TRANSITION') return 409;
  return 400;
}
