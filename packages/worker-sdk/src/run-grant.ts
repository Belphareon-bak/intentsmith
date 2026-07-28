import type { InferenceGrant } from './index.js';

/**
 * Per-run inference grant lifecycle.
 *
 * A worker holds a secret. That secret must stop working the instant its run
 * ends, on **every** exit path, including the ones nobody plans for: a spawn
 * that fails, a crash between issuing and using, a timeout, a cancel, and a
 * process restart.
 *
 * The design point is that revocation is driven by a `finally`-shaped guarantee
 * rather than by remembering to call it in each branch. `withGrant` owns the
 * token for exactly the duration of the callback, so there is no code path that
 * can leave one behind.
 */

export type GrantIssuer = {
  /** Issues a token for a run and returns the grant to hand to the worker. */
  issue(runId: string, taskId: string): InferenceGrant;
  /** Revokes whatever token that run holds. Safe to call repeatedly. */
  revoke(runId: string): boolean;
};

export type GrantOutcome = 'success' | 'failure' | 'timeout' | 'cancelled' | 'spawn_failed';

export type GrantAudit = {
  runId: string;
  taskId: string;
  outcome: GrantOutcome;
  revoked: boolean;
  issuedAt: string;
  revokedAt: string;
};

/**
 * Runs `work` while a grant is valid, revoking it on every exit path.
 *
 * The grant is passed to the callback and never returned to the caller, so a
 * token cannot outlive the scope that owns it. The returned audit record
 * deliberately carries no secret.
 */
export async function withGrant<T>(
  issuer: GrantIssuer,
  runId: string,
  taskId: string,
  work: (grant: InferenceGrant) => Promise<T>,
  options: { now?: () => string; onAudit?: (audit: GrantAudit) => void } = {},
): Promise<T> {
  const now = options.now ?? (() => new Date().toISOString());
  const issuedAt = now();
  const grant = issuer.issue(runId, taskId);

  let outcome: GrantOutcome = 'failure';
  try {
    const result = await work(grant);
    outcome = 'success';
    return result;
  } catch (error) {
    // Classify without swallowing: the caller still sees the original error.
    outcome = classifyFailure(error);
    throw error;
  } finally {
    const revoked = issuer.revoke(runId);
    options.onAudit?.({ runId, taskId, outcome, revoked, issuedAt, revokedAt: now() });
  }
}

function classifyFailure(error: unknown): GrantOutcome {
  const reason = (error as { reason?: string; code?: string } | undefined);
  const marker = reason?.reason ?? reason?.code ?? '';
  if (/cancel/i.test(marker)) return 'cancelled';
  if (/timeout/i.test(marker)) return 'timeout';
  if (/executable_missing|permission_denied|spawn_failed/i.test(marker)) return 'spawn_failed';
  return 'failure';
}

/**
 * Asserts a value carries no part of a secret.
 *
 * Used to prove that audit records, persisted results and log lines never
 * contain a grant token.
 */
export function assertNoTokenLeak(value: unknown, token: string): void {
  if (token.length === 0) return;
  const serialized = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  if (serialized.includes(token)) {
    throw new Error('A gateway token leaked into a value that is persisted, audited or logged.');
  }
}
