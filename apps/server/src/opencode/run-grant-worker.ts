import {
  createRedactor,
  withGrant,
  type GrantAudit,
  type GrantIssuer,
  type GrantOutcome,
  type InferenceGrant,
  type WorkerAdapter,
  type WorkerDescriptor,
  type WorkerExecutionContext,
  type WorkerExecutionResult,
  type WorkerHandle,
} from '@intentsmith/worker-sdk';

import type { GatewayTokenStore } from '../gateway/token-store.js';

/**
 * Run-scoped inference grants, owned by the composition root.
 *
 * The rule Phase 3 depends on is that a worker's token stops working the
 * instant its run ends, on every exit path — success, worker failure, a spawn
 * that never happened, a cancel, a timeout, a crash. `withGrant` already
 * expresses that as a `finally`-shaped guarantee; what was missing was a
 * production caller. This module is that caller.
 *
 * Revocation therefore does not depend on the composition root remembering to
 * pass a callback: it is structural. The grant exists for exactly the duration
 * of the worker's `done` promise, and nothing outside this file ever holds it.
 */

export class WorkerAuthorityError extends Error {
  readonly code = 'WORKER_AUTHORITY_UNAVAILABLE';
  constructor(message: string) {
    super(message);
    this.name = 'WorkerAuthorityError';
  }
}

/**
 * Issues per-run gateway grants once the gateway is actually listening.
 *
 * The base URL is bound after the listener exists, so it cannot be known when
 * the runtime is composed. Until it is bound, issuing throws: a worker started
 * with no mediated inference path would either reach nothing or reach something
 * IntentSmith did not authorize, and both are worse than refusing to start.
 */
export class GatewayGrantIssuer implements GrantIssuer {
  private baseUrl: string | undefined;

  constructor(
    private readonly tokens: GatewayTokenStore,
    private readonly modelId: string,
  ) {}

  bind(baseUrl: string): void {
    this.baseUrl = baseUrl;
  }

  get bound(): boolean {
    return this.baseUrl !== undefined;
  }

  issue(runId: string, taskId: string): InferenceGrant {
    if (this.baseUrl === undefined) {
      throw new WorkerAuthorityError(
        'The worker inference gateway is not listening, so no run-scoped grant can be issued. Refusing to start OpenCode without a mediated inference path.',
      );
    }
    return {
      baseUrl: this.baseUrl,
      token: this.tokens.issue(runId, taskId).value,
      modelId: this.modelId,
    };
  }

  revoke(runId: string): boolean {
    return this.tokens.revokeRun(runId);
  }
}

export type RunScopedWorkerOptions = {
  /** Describes the worker without starting one. */
  describe: () => WorkerDescriptor;
  /**
   * Builds the real adapter for exactly one run.
   *
   * A fresh instance per run keeps per-run authority — which task, which run,
   * which approvals — out of shared mutable state, so two concurrent runs
   * cannot end up answering each other's permission questions. This wrapper
   * adds authority around it and never behaviour of its own.
   */
  adapterFor: (context: WorkerExecutionContext) => WorkerAdapter;
  issuer: GrantIssuer;
  /** Absolute root the worker may modify. Never the user's real project. */
  workspaceRoot: string;
  /** Receives one record per run. Carries no secret, by construction. */
  onGrantAudit?: (audit: GrantAudit) => void;
};

/**
 * Wraps a worker adapter so every run owns its grant and outlives none of it.
 *
 * The adapter is started **inside** the grant scope, which is what makes the
 * awkward paths safe: a spawn that throws, a cancel that arrives before the
 * process exists, and a worker that dies mid-turn all leave through the same
 * `finally`.
 */
export function createRunScopedWorker(options: RunScopedWorkerOptions): WorkerAdapter {
  return {
    describe: (): WorkerDescriptor => options.describe(),
    start: (context: WorkerExecutionContext): WorkerHandle => {
      let token = '';
      let observed: WorkerExecutionResult | undefined;
      // Resolves with the live handle, or with `undefined` when the run ended
      // without one. A lifecycle command therefore never has to guess whether
      // the process exists yet, and never waits on one that never will.
      let announce!: (handle: WorkerHandle | undefined) => void;
      const started = new Promise<WorkerHandle | undefined>(resolve => {
        announce = resolve;
      });

      const done = withGrant(
        options.issuer,
        context.run.id,
        context.task.id,
        async grant => {
          token = grant.token;
          const inner = options.adapterFor(context).start({
            ...context,
            workspaceRoot: options.workspaceRoot,
            inference: grant,
          });
          announce(inner);
          observed = await inner.done;
          return observed;
        },
        {
          onAudit: audit => options.onGrantAudit?.({ ...audit, outcome: refineOutcome(audit.outcome, observed) }),
        },
      )
        .catch((error: unknown) => failureResult(error, token))
        // A run that never produced a handle still has to release anything
        // waiting on one; resolving twice is a no-op.
        .finally(() => announce(undefined));

      const liveHandle = async (verb: string): Promise<WorkerHandle> => {
        const handle = await started;
        if (!handle) throw new Error(`The worker never started, so it cannot be ${verb}.`);
        return handle;
      };

      return {
        done,
        pause: async () => await (await liveHandle('paused')).pause(),
        resume: async () => await (await liveHandle('resumed')).resume(),
        // A cancel that arrives before the process exists must still reach it,
        // and a cancel for a run that never started is simply nothing to do.
        cancel: async () => await (await started)?.cancel(),
      };
    },
  };
}

/**
 * Corrects the grant audit's outcome from what the worker actually reported.
 *
 * A worker adapter reports its own failure as a terminal event and settles
 * normally, so the promise resolving is not evidence that anything succeeded.
 * Recording that run as a success would put a false reason into the audit trail
 * while the revocation it describes was in fact a failure path.
 */
function refineOutcome(outcome: GrantOutcome, observed: WorkerExecutionResult | undefined): GrantOutcome {
  if (outcome !== 'success' || !observed) return outcome;
  const terminal = observed.events.find(
    (event): event is { type: 'failed'; error: { code?: unknown } } =>
      typeof event === 'object' && event !== null && (event as { type?: unknown }).type === 'failed',
  );
  if (!terminal) return outcome;
  const code = typeof terminal.error?.code === 'string' ? terminal.error.code : '';
  if (/cancel/i.test(code)) return 'cancelled';
  if (/timeout/i.test(code)) return 'timeout';
  if (/executable_missing|permission_denied|spawn/i.test(code)) return 'spawn_failed';
  return 'failure';
}

/**
 * Turns an escaped failure into a terminal worker event.
 *
 * The grant has already been revoked by the time this runs. The message is
 * redacted against the token that existed for this run, so a failure path can
 * never become the one place a secret reaches a persisted result.
 */
function failureResult(error: unknown, token: string): WorkerExecutionResult {
  const redactor = createRedactor(token.length > 0 ? [token] : []);
  const code = error instanceof WorkerAuthorityError ? error.code : 'WORKER_FAILED';
  const message = error instanceof Error ? error.message : 'The worker failed before producing a result.';
  return {
    events: [
      {
        type: 'failed',
        error: { code, message: redactor.text(message).slice(0, 500), retryable: false },
      },
    ],
  };
}
