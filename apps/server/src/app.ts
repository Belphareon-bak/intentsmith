import Fastify, { type FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import {
  CreateProjectInputSchema,
  CreateTaskInputSchema,
  VERSION,
} from '@intentsmith/contracts';
import { DomainError, normalizeError, type IntentSmithCore } from '@intentsmith/core';

export type ServerRuntime = {
  core: IntentSmithCore;
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

  app.get('/health', async () => ({ status: 'ok', service: 'intentsmith-core' }));
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
