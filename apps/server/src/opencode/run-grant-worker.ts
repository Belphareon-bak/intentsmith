import {
  createRedactor,
  withGrant,
  type GrantAudit,
  type GrantIssuer,
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
      let inner: WorkerHandle | undefined;
      let cancelRequested = false;
      let token = '';

      const done = withGrant(
        options.issuer,
        context.run.id,
        context.task.id,
        async grant => {
          token = grant.token;
          inner = options.adapterFor(context).start({
            ...context,
            workspaceRoot: options.workspaceRoot,
            inference: grant,
          });
          // A cancel that arrived while the grant was being issued must still
          // reach the process, rather than being lost to the ordering.
          if (cancelRequested) await inner.cancel();
          return await inner.done;
        },
        options.onGrantAudit ? { onAudit: options.onGrantAudit } : {},
      ).catch((error: unknown) => failureResult(error, token));

      return {
        done,
        pause: async () => {
          if (!inner) throw new Error('The worker has not started yet and cannot be paused.');
          await inner.pause();
        },
        resume: async () => {
          if (!inner) throw new Error('The worker has not started yet and cannot be resumed.');
          await inner.resume();
        },
        cancel: async () => {
          cancelRequested = true;
          await inner?.cancel();
        },
      };
    },
  };
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
