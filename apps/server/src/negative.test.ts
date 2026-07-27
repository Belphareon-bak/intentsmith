import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DisposableWorkspace, createTaskInput, createTestRuntime, type TestRuntime } from '@intentsmith/testing';

import { buildServer } from './app.js';
import { createTestServerRuntime } from './test-runtime.js';

/** Negative and adversarial API boundary tests. */

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

function server() {
  return buildServer(createTestServerRuntime({ core: runtime.core }));
}

async function seedTask(scenario: Parameters<typeof createTaskInput>[2] = {}) {
  const project = await runtime.core.createProject({ name: 'api', rootPath: workspace.path });
  return await runtime.core.createTask(createTaskInput(project.id, workspace.path, scenario));
}

describe('API negative paths', () => {
  it('rejects malformed JSON', async () => {
    const app = server();
    const response = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: { 'content-type': 'application/json' },
      payload: '{"name": "broken",',
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.json().error.code).toMatch(/\S/);
    await app.close();
  });

  it('rejects a payload above the body limit', async () => {
    const app = server();
    const response = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'x'.repeat(2_000_000), rootPath: workspace.path }),
    });
    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe('PAYLOAD_TOO_LARGE');
    await app.close();
  });

  it('rejects a wrong content type', async () => {
    const app = server();
    const response = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: { 'content-type': 'text/plain' },
      payload: 'name=nope',
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    await app.close();
  });

  it('rejects an unknown field before it reaches core', async () => {
    const app = server();
    const response = await app.inject({
      method: 'POST',
      url: '/projects',
      payload: { name: 'p', rootPath: workspace.path, admin: true },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('REQUEST_VALIDATION_FAILED');
    await app.close();
  });

  it('returns a structured error for an unknown route', async () => {
    const app = server();
    const response = await app.inject({ method: 'GET', url: '/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'ROUTE_NOT_FOUND', message: 'Unknown route', retryable: false },
    });
    await app.close();
  });

  it('returns 404 for an unknown project', async () => {
    const app = server();
    const response = await app.inject({ method: 'GET', url: '/projects/project_missing' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('PROJECT_NOT_FOUND');
    await app.close();
  });

  it('returns 404 for an unknown task', async () => {
    const app = server();
    const response = await app.inject({ method: 'GET', url: '/tasks/task_missing' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('TASK_NOT_FOUND');
    await app.close();
  });

  it('returns 409 for an invalid lifecycle transition', async () => {
    const app = server();
    const task = await seedTask();
    const response = await app.inject({ method: 'POST', url: `/tasks/${task.id}/resume` });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('INVALID_TASK_TRANSITION');
    await app.close();
  });

  it('admits exactly one of two conflicting concurrent requests', async () => {
    const app = server();
    const task = await seedTask({ workerScenario: 'pauseable-success' });
    const [first, second] = await Promise.all([
      app.inject({ method: 'POST', url: `/tasks/${task.id}/start` }),
      app.inject({ method: 'POST', url: `/tasks/${task.id}/start` }),
    ]);
    const codes = [first.statusCode, second.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    await app.close();
  });

  it('never leaks a stack trace or local path in an internal error', async () => {
    const app = buildServer(
      createTestServerRuntime({
        core: {
          ...runtime.core,
          getTask: async () => {
            throw new Error('boom at /home/someone/secret/file.ts:12:5');
          },
        } as unknown as TestRuntime['core'],
      }),
    );
    const response = await app.inject({ method: 'GET', url: '/tasks/task_x' });
    expect(response.statusCode).toBe(500);
    const body = response.body;
    expect(response.json().error).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal error', retryable: false });
    expect(body).not.toContain('/home/');
    expect(body).not.toContain('secret');
    expect(body).not.toMatch(/\s+at\s+.*:\d+:\d+/);
    await app.close();
  });

  it('cancels an active task when the server shuts down', async () => {
    let closed = false;
    const app = buildServer(
      createTestServerRuntime({
        core: runtime.core,
        close: async () => {
          await runtime.core.shutdown();
          closed = true;
        },
      }),
    );
    const task = await seedTask({ workerScenario: 'pauseable-success' });
    expect((await app.inject({ method: 'POST', url: `/tasks/${task.id}/start` })).statusCode).toBe(200);

    await app.close();
    expect(closed).toBe(true);
    expect((await runtime.core.getTask(task.id)).status).toBe('cancelled');
    expect((await runtime.core.getTaskResult(task.id))?.coreVerdict).toBe('cancelled');
  });

  it('returns 404 when a result does not exist yet', async () => {
    const app = server();
    const task = await seedTask();
    const response = await app.inject({ method: 'GET', url: `/tasks/${task.id}/result` });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('TASK_RESULT_NOT_FOUND');
    await app.close();
  });
});
