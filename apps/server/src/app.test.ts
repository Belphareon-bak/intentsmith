import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { VERSION } from '@intentsmith/contracts';
import { DisposableWorkspace, createTaskInput, createTestRuntime, type TestRuntime } from '@intentsmith/testing';

import { buildServer } from './app.js';
import { DEFAULT_HOST } from './index.js';

let runtime: TestRuntime;
let workspace: DisposableWorkspace;

beforeEach(() => {
  runtime = createTestRuntime();
  workspace = new DisposableWorkspace();
});

afterEach(async () => {
  await runtime.core.shutdown();
  runtime.cleanup();
  workspace.cleanup();
});

describe('localhost API', () => {
  it('reports health, version and the safe default bind host', async () => {
    const app = buildServer({ core: runtime.core, close: () => undefined });
    expect((await app.inject({ method: 'GET', url: '/health' })).json()).toEqual({
      status: 'ok',
      service: 'intentsmith-core',
    });
    expect((await app.inject({ method: 'GET', url: '/version' })).json()).toMatchObject({ version: VERSION });
    expect(DEFAULT_HOST).toBe('127.0.0.1');
    await app.close();
  });

  it('validates request payloads and rejects unknown fields before core', async () => {
    const app = buildServer({ core: runtime.core, close: () => undefined });
    const response = await app.inject({
      method: 'POST',
      url: '/projects',
      payload: { name: 'invalid', rootPath: workspace.path, unexpected: true },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: {
        code: 'REQUEST_VALIDATION_FAILED',
        message: 'Request validation failed',
        retryable: false,
      },
    });
    await app.close();
  });

  it('returns a stable sanitized error for an unknown task', async () => {
    const app = buildServer({ core: runtime.core, close: () => undefined });
    const response = await app.inject({ method: 'GET', url: '/tasks/missing' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: 'TASK_NOT_FOUND',
        message: 'Task not found: missing',
        retryable: false,
      },
    });
    expect(response.body).not.toContain('stack');
    await app.close();
  });

  it('returns conflict for an invalid lifecycle transition', async () => {
    const app = buildServer({ core: runtime.core, close: () => undefined });
    const { taskId } = await createApiTask(app, 'pauseable-success');
    expect((await app.inject({ method: 'POST', url: `/tasks/${taskId}/start` })).statusCode).toBe(200);
    const response = await app.inject({ method: 'POST', url: `/tasks/${taskId}/start` });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('INVALID_TASK_TRANSITION');
    await app.close();
  });

  it('runs the complete successful flow using Fastify injection only', async () => {
    const app = buildServer({ core: runtime.core, close: () => undefined });
    const { projectId, taskId } = await createApiTask(app, 'success');
    expect((await app.inject({ method: 'GET', url: `/projects/${projectId}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/tasks/${taskId}/start` })).json().status).toBe('running');
    await runtime.core.waitForTask(taskId);

    const task = await app.inject({ method: 'GET', url: `/tasks/${taskId}` });
    const result = await app.inject({ method: 'GET', url: `/tasks/${taskId}/result` });
    const audit = await app.inject({ method: 'GET', url: `/tasks/${taskId}/audit` });
    expect(task.json().status).toBe('passed');
    expect(result.json().coreVerdict).toBe('pass');
    expect(audit.json().events.at(-1).type).toBe('task.verdict');
    await app.close();
  });

  it('enforces the request body size limit', async () => {
    const app = buildServer({ core: runtime.core, close: () => undefined });
    const response = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'x'.repeat(1_048_576), rootPath: workspace.path }),
    });
    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe('PAYLOAD_TOO_LARGE');
    await app.close();
  });
});

async function createApiTask(
  app: ReturnType<typeof buildServer>,
  scenario: 'success' | 'pauseable-success',
): Promise<{ projectId: string; taskId: string }> {
  const projectResponse = await app.inject({
    method: 'POST',
    url: '/projects',
    payload: { name: 'API project', rootPath: workspace.path },
  });
  const projectId = projectResponse.json().id as string;
  const taskResponse = await app.inject({
    method: 'POST',
    url: '/tasks',
    payload: createTaskInput(projectId, workspace.path, { workerScenario: scenario }),
  });
  return { projectId, taskId: taskResponse.json().id as string };
}
