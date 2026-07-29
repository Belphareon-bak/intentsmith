import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { OllamaProvider } from '@intentsmith/adapter-ollama';
import {
  CryptoIdGenerator,
  IntentSmithCore,
  SystemClock,
  type Clock,
  type IdGenerator,
  type IntentSmithCoreOptions,
  type Timer,
} from '@intentsmith/core';
import { HardwareDirector, type ExecutionPolicy } from '@intentsmith/hardware';
import { DEFAULT_OLLAMA_ENDPOINT, InferenceScheduler, assertLocalEndpoint } from '@intentsmith/inference';
import { openIntentSmithDatabase } from '@intentsmith/persistence';
import { FakeWorker } from '@intentsmith/testing';

import type { ServerRuntime } from './app.js';
import { GatewayTokenStore } from './gateway/token-store.js';
import { createOpenCodeStack, type OpenCodeOverrides } from './opencode/composition.js';
import { readOpenCodeConfig, readWorkerSelection, type WorkerSelection } from './opencode/config.js';
import { runStartupRecovery, type RecoverySummary } from './recovery.js';

export type RuntimeOptions = {
  dbPath?: string;
  /** Loopback endpoint for the Ollama daemon. Validated before use. */
  ollamaEndpoint?: string;
  /** Maximum concurrent generations. Local config only, never inferred. */
  maxConcurrentInference?: number;
  executionPolicy?: ExecutionPolicy;
  /** Configuration source. Injected so a test never depends on the ambient env. */
  env?: NodeJS.ProcessEnv;
  clock?: Clock;
  ids?: IdGenerator;
  timer?: Timer;
  /** Applies only when `INTENTSMITH_WORKER=opencode` selected the real worker. */
  opencode?: OpenCodeOverrides;
};

/**
 * Composition root.
 *
 * This is the only place allowed to instantiate a concrete adapter. Core never
 * imports it, so swapping providers stays a wiring change.
 *
 * Which worker runs is an explicit operator decision. `INTENTSMITH_WORKER=fake`
 * (the default) keeps the deterministic development path; `opencode` composes
 * the real worker together with everything that makes its output trustworthy —
 * the approval ledger, the capability mediator, Git-backed change evidence,
 * configured gates and run-scoped inference grants. There is no third state in
 * which OpenCode runs without them: a configuration that cannot support that
 * stack stops startup instead of quietly reverting to the fake.
 */
export function createRuntime(options: RuntimeOptions | string = {}): ServerRuntime {
  const resolved: RuntimeOptions = typeof options === 'string' ? { dbPath: options } : options;
  const env = resolved.env ?? process.env;

  // Configuration is validated before anything is opened or created, so an
  // unusable selection fails without leaving a database behind.
  const workerKind: WorkerSelection = readWorkerSelection(env);
  const openCodeConfig = workerKind === 'opencode' ? readOpenCodeConfig(env) : undefined;

  const store = openIntentSmithDatabase(resolved.dbPath ?? defaultDbPath());
  const clock = resolved.clock ?? new SystemClock();
  const ids = resolved.ids ?? new CryptoIdGenerator();
  const gatewayTokens = new GatewayTokenStore();

  const shared: Omit<IntentSmithCoreOptions, 'worker'> = {
    clock,
    ids,
    projects: store,
    tasks: store,
    audit: store,
    transactions: store,
    ...(resolved.timer ? { timer: resolved.timer } : {}),
  };

  const openCode = openCodeConfig
    ? createOpenCodeStack({
        config: openCodeConfig,
        store,
        clock,
        ids,
        tokens: gatewayTokens,
        ...(resolved.opencode ? { overrides: resolved.opencode } : {}),
      })
    : undefined;

  const core = openCode
    ? new IntentSmithCore({
        ...shared,
        worker: openCode.worker,
        approvals: openCode.approvals,
        changeEvidence: openCode.changeEvidence,
        // A code task run by the real worker cannot pass on the worker's word.
        requireChangeEvidenceForCodeTasks: true,
      })
    : new IntentSmithCore({ ...shared, worker: new FakeWorker() });

  const endpoint = resolved.ollamaEndpoint ?? env.INTENTSMITH_OLLAMA_ENDPOINT ?? DEFAULT_OLLAMA_ENDPOINT;
  // Fails fast on an illegal endpoint rather than at first generation.
  assertLocalEndpoint(endpoint);
  const provider = new OllamaProvider({ endpoint });
  const scheduler = new InferenceScheduler({
    maxConcurrent: resolved.maxConcurrentInference ?? readConcurrency(env),
  });
  const hardware = new HardwareDirector();

  let recovery: RecoverySummary | undefined;

  return {
    core,
    provider,
    scheduler,
    hardware,
    gatewayTokens,
    workerKind,
    executionPolicy: resolved.executionPolicy ?? 'cpu_allowed',
    // Present only for the OpenCode path, where a run cannot start until the
    // gateway exists to issue it a token.
    ...(openCode ? { bindWorkerGateway: openCode.bindGateway } : {}),
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
function readConcurrency(env: NodeJS.ProcessEnv): number {
  const raw = env.INTENTSMITH_MAX_CONCURRENT_INFERENCE;
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
