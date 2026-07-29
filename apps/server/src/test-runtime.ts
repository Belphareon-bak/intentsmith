import { OllamaProvider, type OllamaTransport } from '@intentsmith/adapter-ollama';
import { HardwareDirector, type ExecutionPolicy, type GpuProbeResult, type SystemProfile } from '@intentsmith/hardware';
import { InferenceScheduler } from '@intentsmith/inference';
import type { IntentSmithCore } from '@intentsmith/core';

import type { ServerRuntime } from './app.js';
import { GatewayTokenStore } from './gateway/token-store.js';
import type { RunEvidenceRecorder } from './opencode/run-evidence.js';
import type { RecoverySummary } from './recovery.js';

/**
 * Builds a `ServerRuntime` for tests.
 *
 * Every dependency is injected, so nothing here opens a socket, runs a
 * subprocess, or reads the host machine's real hardware. A test that does not
 * care about inference still gets a working runtime.
 */

export const OFFLINE_SYSTEM: SystemProfile = {
  os: 'linux',
  arch: 'x64',
  logicalCpuCount: 8,
  totalRamBytes: 32 * 1024 ** 3,
  availableRamBytes: 16 * 1024 ** 3,
};

export const OFFLINE_GPU: GpuProbeResult = {
  status: 'ok',
  vendor: 'nvidia',
  devices: [
    {
      index: 0,
      name: 'Offline Test GPU',
      driverVersion: '000.00',
      totalVramBytes: 24 * 1024 ** 3,
      freeVramBytes: 22 * 1024 ** 3,
    },
  ],
};

/** Transport that refuses every call, for tests that never touch inference. */
export const unreachableTransport: OllamaTransport = async () => {
  throw new Error('offline');
};

export type TestServerRuntimeOptions = {
  core: IntentSmithCore;
  transport?: OllamaTransport;
  system?: SystemProfile;
  gpu?: GpuProbeResult;
  executionPolicy?: ExecutionPolicy;
  recovery?: RecoverySummary;
  gatewayTokens?: GatewayTokenStore;
  /** Durable lifecycle-evidence sink, for tests that assert what was persisted. */
  workerEvidence?: RunEvidenceRecorder;
  maxConcurrentInference?: number;
  close?: () => void | Promise<void>;
};

export function createTestServerRuntime(options: TestServerRuntimeOptions): ServerRuntime {
  const provider = new OllamaProvider({
    endpoint: 'http://127.0.0.1:11434',
    transport: options.transport ?? unreachableTransport,
    // Short enough that a misbehaving fixture cannot stall a run, generous
    // enough that a real loopback round trip is never the thing that fails.
    timeouts: { connectMs: 2_000, firstByteMs: 2_000, idleMs: 2_000, overallMs: 10_000 },
  });
  const hardware = new HardwareDirector({
    systemProbe: async () => options.system ?? OFFLINE_SYSTEM,
    gpuProbe: async () => options.gpu ?? OFFLINE_GPU,
    now: () => '2026-07-28T00:00:00.000Z',
  });

  return {
    core: options.core,
    provider,
    scheduler: new InferenceScheduler({ maxConcurrent: options.maxConcurrentInference ?? 1 }),
    hardware,
    gatewayTokens: options.gatewayTokens ?? new GatewayTokenStore(),
    ...(options.workerEvidence ? { workerEvidence: options.workerEvidence } : {}),
    executionPolicy: options.executionPolicy ?? 'cpu_allowed',
    recovery: options.recovery ?? {
      status: 'completed',
      startedAt: '2026-07-28T00:00:00.000Z',
      completedAt: '2026-07-28T00:00:00.000Z',
      recoveredRunCount: 0,
      affectedTaskIds: [],
    },
    close: options.close ?? (() => undefined),
  };
}
