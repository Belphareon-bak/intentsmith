import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { REMOTE_MODEL_ENTRY, SHOW_BODY, fixtureTransport, fixtures } from '@intentsmith/adapter-ollama/fixtures';
import { DisposableWorkspace, createTaskInput, createTestRuntime, type TestRuntime } from '@intentsmith/testing';

import { buildServer } from './app.js';
import { StartupRecoveryError, runStartupRecovery } from './recovery.js';
import { createRuntime } from './runtime.js';
import { createTestServerRuntime } from './test-runtime.js';

/**
 * Startup recovery and inference route tests.
 *
 * Nothing here contacts Ollama or reads real hardware.
 */

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'intentsmith-startup-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function testCore(): TestRuntime {
  const runtime = createTestRuntime();
  cleanups.push(() => runtime.cleanup());
  return runtime;
}

describe('startup recovery', () => {
  it('reports zero recovered runs on a clean database', async () => {
    const summary = await runStartupRecovery(testCore().core);
    expect(summary.status).toBe('completed');
    expect(summary.recoveredRunCount).toBe(0);
    expect(summary.affectedTaskIds).toEqual([]);
  });

  it('reports one interrupted run after a simulated crash', async () => {
    const dir = tempDir();
    const dbPath = path.join(dir, 'state.db');
    const workspace = new DisposableWorkspace();
    cleanups.push(() => workspace.cleanup());

    const first = createRuntime({ dbPath });
    const project = await first.core.createProject({ name: 'startup', rootPath: workspace.path });
    const task = await first.core.createTask(
      createTaskInput(project.id, workspace.path, { workerScenario: 'pauseable-success' }),
    );
    await first.core.startTask(task.id);
    // Simulate an unexpected exit: the process dies with the run still marked
    // `running` on disk. A graceful close would cancel it, which is the case
    // recovery is specifically *not* for.
    cleanups.push(() => void first.close());

    const second = createRuntime({ dbPath });
    const summary = await second.prepare?.();
    expect(summary?.status).toBe('completed');
    expect(summary?.recoveredRunCount).toBe(1);
    expect(summary?.affectedTaskIds).toEqual([task.id]);
    // Nothing was restarted.
    expect((await second.core.getTask(task.id)).status).toBe('failed');
    await second.close();
  });

  it('is idempotent across a second startup', async () => {
    const dir = tempDir();
    const dbPath = path.join(dir, 'state.db');
    const workspace = new DisposableWorkspace();
    cleanups.push(() => workspace.cleanup());

    const first = createRuntime({ dbPath });
    const project = await first.core.createProject({ name: 'startup', rootPath: workspace.path });
    const task = await first.core.createTask(
      createTaskInput(project.id, workspace.path, { workerScenario: 'pauseable-success' }),
    );
    await first.core.startTask(task.id);
    cleanups.push(() => void first.close());

    const second = createRuntime({ dbPath });
    expect((await second.prepare?.())?.recoveredRunCount).toBe(1);
    await second.close();

    const third = createRuntime({ dbPath });
    expect((await third.prepare?.())?.recoveredRunCount).toBe(0);
    await third.close();
  });

  it('fails startup when recovery itself fails', async () => {
    const core = {
      recoverInterruptedRuns: async () => {
        throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
      },
    } as unknown as TestRuntime['core'];

    const error = await runStartupRecovery(core).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StartupRecoveryError);
    const summary = (error as StartupRecoveryError).summary;
    expect(summary.status).toBe('failed');
    expect(summary.errorCode).toBe('SQLITE_BUSY');
    // The message is actionable and leaks no internals.
    expect(summary.errorMessage).toContain('Resolve that and start again');
    expect(summary.errorMessage).not.toMatch(/\s+at\s+.*:\d+:\d+/);
  });

  it('refuses to report healthy before recovery has run', async () => {
    const runtime = createTestServerRuntime({ core: testCore().core });
    // Simulate a server built but not prepared.
    const unprepared = { ...runtime, recovery: undefined, prepare: async () => runtime.recovery! };
    const app = buildServer(unprepared);
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('RECOVERY_NOT_RUN');
    await app.close();
  });

  it('exposes the recovery summary over the API', async () => {
    const app = buildServer(createTestServerRuntime({ core: testCore().core }));
    const response = await app.inject({ method: 'GET', url: '/runtime/recovery' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'completed', recoveredRunCount: 0 });
    await app.close();
  });
});

describe('inference routes', () => {
  function server(routes: Parameters<typeof fixtureTransport>[0] = {}) {
    return buildServer(createTestServerRuntime({ core: testCore().core, transport: fixtureTransport(routes) }));
  }

  it('lists providers with the loopback endpoint', async () => {
    const app = server();
    const body = (await app.inject({ method: 'GET', url: '/inference/providers' })).json();
    expect(body.providers[0]).toMatchObject({ id: 'ollama', endpoint: 'http://127.0.0.1:11434' });
    await app.close();
  });

  it('reports provider health', async () => {
    const app = server();
    expect((await app.inject({ method: 'GET', url: '/inference/providers/ollama/health' })).json().status).toBe(
      'healthy',
    );
    await app.close();
  });

  it('lists models and never exposes raw Ollama DTOs', async () => {
    const app = server();
    const response = await app.inject({ method: 'GET', url: '/inference/models' });
    const body = response.json();
    expect(body.models[0]).toMatchObject({ id: 'qwen3:14b', execution: 'local' });
    // Raw upstream keys must not appear anywhere in the payload.
    expect(response.body).not.toContain('modelfile');
    expect(response.body).not.toContain('parameter_size');
    expect(response.body).not.toContain('quantization_level');
    await app.close();
  });

  it('describes a model without leaking the show payload', async () => {
    const app = server();
    const response = await app.inject({ method: 'GET', url: '/inference/models/qwen3:14b' });
    expect(response.json()).toMatchObject({ id: 'qwen3:14b', contextTokens: 40_960 });
    expect(response.body).not.toContain('modelfile');
    expect(response.body).not.toContain('"show"');
    await app.close();
  });

  it('returns 404 for a model that is not installed', async () => {
    const app = server({ show: fixtures.jsonResponse(404, { error: 'not found' }) });
    const response = await app.inject({ method: 'GET', url: '/inference/models/missing:1b' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('MODEL_NOT_FOUND');
    await app.close();
  });

  it('assesses model fit and separates estimate from policy', async () => {
    const app = server();
    const response = await app.inject({
      method: 'POST',
      url: '/inference/models/qwen3:14b/assess',
      payload: { executionPolicy: 'gpu_required' },
    });
    const body = response.json();
    expect(body.decision.policy).toBe('gpu_required');
    expect(body.decision.assessment.classification).toBe('likely_gpu_fit');
    expect(body.decision.assessment.assumptions.length).toBeGreaterThan(0);
    await app.close();
  });

  it('reports a hardware profile', async () => {
    const app = server();
    const body = (await app.inject({ method: 'GET', url: '/hardware' })).json();
    expect(body.acceleratorState).toBe('nvidia_available');
    expect(body.system.logicalCpuCount).toBeGreaterThan(0);
    await app.close();
  });

  it('streams NDJSON with exactly one terminal event', async () => {
    const app = server();
    const response = await app.inject({
      method: 'POST',
      url: '/inference/generate',
      payload: { modelId: 'qwen3:14b', prompt: 'ping' },
    });
    expect(response.headers['content-type']).toContain('application/x-ndjson');
    const events = response.body
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as { type: string });
    expect(events[0]?.type).toBe('started');
    expect(events.filter(event => event.type === 'completed' || event.type === 'failed')).toHaveLength(1);
    expect(events.at(-1)?.type).toBe('completed');
    await app.close();
  });

  it('refuses a remote-backed model with a real status before streaming', async () => {
    const app = server({
      tags: fixtures.jsonResponse(200, { models: [REMOTE_MODEL_ENTRY] }),
      show: fixtures.jsonResponse(200, { ...SHOW_BODY, remote_host: 'https://ollama.com' }),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/inference/generate',
      payload: { modelId: REMOTE_MODEL_ENTRY.name, prompt: 'ping' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('REMOTE_INFERENCE_FORBIDDEN');
    await app.close();
  });

  it('rejects an oversized prompt and unknown fields', async () => {
    const app = server();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/inference/generate',
          payload: { modelId: 'qwen3:14b', prompt: 'x'.repeat(40_000) },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/inference/generate',
          payload: { modelId: 'qwen3:14b', prompt: 'ping', rogue: true },
        })
      ).statusCode,
    ).toBe(400);
    await app.close();
  });
});
