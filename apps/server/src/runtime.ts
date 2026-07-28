import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { OllamaProvider } from '@intentsmith/adapter-ollama';
import { CryptoIdGenerator, IntentSmithCore, SystemClock } from '@intentsmith/core';
import { HardwareDirector, type ExecutionPolicy } from '@intentsmith/hardware';
import { DEFAULT_OLLAMA_ENDPOINT, InferenceScheduler, assertLocalEndpoint } from '@intentsmith/inference';
import { openIntentSmithDatabase } from '@intentsmith/persistence';
import { FakeWorker } from '@intentsmith/testing';

import type { ServerRuntime } from './app.js';
import { GatewayTokenStore } from './gateway/token-store.js';
import { runStartupRecovery, type RecoverySummary } from './recovery.js';

export type RuntimeOptions = {
  dbPath?: string;
  /** Loopback endpoint for the Ollama daemon. Validated before use. */
  ollamaEndpoint?: string;
  /** Maximum concurrent generations. Local config only, never inferred. */
  maxConcurrentInference?: number;
  executionPolicy?: ExecutionPolicy;
};

/**
 * Composition root.
 *
 * This is the only place allowed to instantiate a concrete adapter. Core never
 * imports it, so swapping providers stays a wiring change.
 */
export function createRuntime(options: RuntimeOptions | string = {}): ServerRuntime {
  const resolved: RuntimeOptions = typeof options === 'string' ? { dbPath: options } : options;
  const store = openIntentSmithDatabase(resolved.dbPath ?? defaultDbPath());
  const core = new IntentSmithCore({
    clock: new SystemClock(),
    ids: new CryptoIdGenerator(),
    projects: store,
    tasks: store,
    audit: store,
    transactions: store,
    worker: new FakeWorker(),
  });

  const endpoint = resolved.ollamaEndpoint ?? process.env.INTENTSMITH_OLLAMA_ENDPOINT ?? DEFAULT_OLLAMA_ENDPOINT;
  // Fails fast on an illegal endpoint rather than at first generation.
  assertLocalEndpoint(endpoint);
  const provider = new OllamaProvider({ endpoint });
  const scheduler = new InferenceScheduler({
    maxConcurrent: resolved.maxConcurrentInference ?? readConcurrency(),
  });
  const hardware = new HardwareDirector();
  const gatewayTokens = new GatewayTokenStore();

  let recovery: RecoverySummary | undefined;

  return {
    core,
    provider,
    scheduler,
    hardware,
    gatewayTokens,
    executionPolicy: resolved.executionPolicy ?? 'cpu_allowed',
    get recovery() {
      return recovery;
    },
    /**
     * Runs recovery. Must complete before the server binds; a failure here
     * must stop startup rather than serve from an ambiguous database.
     */
    prepare: async () => {
      recovery = await runStartupRecovery(core);
      return recovery;
    },
    close: async () => {
      // Tokens die with the server; a stale token must never outlive it.
      gatewayTokens.revokeAll();
      scheduler.shutdown();
      await core.shutdown();
      store.close();
    },
  };
}

/** Concurrency comes only from validated local configuration. */
function readConcurrency(): number {
  const raw = process.env.INTENTSMITH_MAX_CONCURRENT_INFERENCE;
  if (!raw) return 1;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8) return 1;
  return parsed;
}

export function defaultDbPath(): string {
  // Only create the directory that is actually used; an explicit override must
  // not leave a stray `.intentsmith` folder in the current working directory.
  const override = process.env.INTENTSMITH_DB_PATH;
  if (override) return override;
  const root = path.join(process.cwd(), '.intentsmith');
  mkdirSync(root, { recursive: true });
  return path.join(root, 'intentsmith.db');
}
