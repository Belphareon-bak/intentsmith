import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  MODEL,
  OPT_IN,
  assertPreflight,
  awaitProcessGroupExit,
  processGroupOf,
  realProductHarness,
  recordScenario,
  sampleShowsGpu,
  startGpuSampler,
  type Cleanups,
  type Preflight,
} from './real-product.js';

/**
 * Minimal real-binary smoke run.
 *
 * The smallest scenario that still touches every real dependency 2C rests on:
 * the pinned OpenCode binary, the executable server composition over loopback
 * HTTP, the real gateway, real local Ollama on the NVIDIA GPU, and a real
 * permission request raised before anything in the workspace changes. It runs
 * first and alone, so a broken dependency is identified here rather than inside
 * the complete scenario suite.
 */

export const EDIT_GOAL = [
  'Edit the existing file src/answer.js in this project so that it exports the number 4 instead of 3.',
  'After your edit the file must contain exactly: module.exports = 4;',
  'Change nothing else, create no new file, and run no shell command.',
].join(' ');

const cleanups: Cleanups = [];
let preflight: Preflight | undefined;

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

beforeAll(async () => {
  if (!OPT_IN) return;
  preflight = await assertPreflight();
}, 120_000);

const maybe = OPT_IN ? describe : describe.skip;

maybe('real OpenCode smoke run through the product', () => {
  it(
    'starts the pinned binary, reaches local GPU inference and asks before touching the workspace',
    async () => {
      const test = await realProductHarness(cleanups, { label: 'smoke' });
      // The product selected the real worker, and the API is loopback-only.
      expect(test.runtime.workerKind).toBe('opencode');
      expect(test.boundAddress).toBe('127.0.0.1');
      expect(test.gateway.url.startsWith('http://127.0.0.1:')).toBe(true);

      const sampler = startGpuSampler();
      const taskId = await test.createTask(EDIT_GOAL);
      await test.startTask(taskId);

      const runId = await test.runIdFor(taskId);
      // The persisted pid is the anchor: it comes from IntentSmith's own audit
      // trail, not from anything the worker reported about itself.
      const pid = await test.awaitWorkerPid(taskId);
      const pgid = processGroupOf(pid);
      expect(pgid).toBeDefined();

      const pending = await test.awaitPending(runId);
      const samples = sampler.stop();

      // Asked before the effect: nothing in the repository has moved.
      expect(test.targetContent()).toBe('module.exports = 3;\n');
      expect(test.gitStatus()).toBe('');
      expect(pending).toMatchObject({ runId, taskId });

      // The turn reached local inference, and the model was resident on the GPU
      // while it was running.
      const auditTypes = (await test.audit(taskId)).map(event => event.type);
      expect(auditTypes).toContain('inference.profile');
      expect(samples.some(sample => sampleShowsGpu(sample, MODEL))).toBe(true);

      // Settle the run through the product surface and prove the real process
      // group is gone rather than merely signalled.
      const cancelled = await test.post(`/tasks/${taskId}/cancel`);
      expect(cancelled.status).toBe(200);
      const task = await test.awaitTerminal(taskId);
      expect(task.status).toBe('cancelled');
      expect(await awaitProcessGroupExit(pgid as number)).toEqual([]);
      expect(test.targetContent()).toBe('module.exports = 3;\n');

      recordScenario({
        scenario: 'smoke',
        outcome: 'pass',
        preflight: preflight ?? null,
        runId,
        taskId,
        workerPid: pid,
        workerPgid: pgid ?? null,
        pendingToolName: pending.toolName,
        pendingCapabilityId: pending.capabilityId,
        gpuSamples: samples.slice(0, 4),
        finalTaskStatus: task.status,
      });
    },
    600_000,
  );
});
