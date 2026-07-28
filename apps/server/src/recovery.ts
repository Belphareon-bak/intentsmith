import type { IntentSmithCore } from '@intentsmith/core';

/**
 * Startup recovery.
 *
 * ADR 0007 defined the policy for a run found non-terminal after a restart but
 * left the invocation point open. It runs here, before the server binds, so no
 * client can ever observe a stale `running` row as if it were live work.
 *
 * If recovery fails the process must not serve: a half-recovered database is
 * exactly the ambiguous state the policy exists to remove.
 */

export type RecoverySummary = {
  status: 'completed' | 'failed';
  startedAt: string;
  completedAt: string;
  /** Number of runs closed as interrupted. */
  recoveredRunCount: number;
  /**
   * Tasks affected. Task ids are opaque local identifiers and carry no prompt
   * or user content, so they are safe to surface locally.
   */
  affectedTaskIds: string[];
  errorCode?: string;
  errorMessage?: string;
};

export class StartupRecoveryError extends Error {
  readonly code = 'STARTUP_RECOVERY_FAILED';

  constructor(
    message: string,
    readonly summary: RecoverySummary,
  ) {
    super(message);
    this.name = 'StartupRecoveryError';
  }
}

/**
 * Runs recovery and returns its summary.
 *
 * Throws `StartupRecoveryError` when recovery itself fails, so the caller can
 * refuse to listen. Interrupted runs are never restarted automatically.
 */
export async function runStartupRecovery(core: IntentSmithCore, now = () => new Date().toISOString()): Promise<RecoverySummary> {
  const startedAt = now();
  try {
    const recovered = await core.recoverInterruptedRuns();
    return {
      status: 'completed',
      startedAt,
      completedAt: now(),
      recoveredRunCount: recovered.length,
      affectedTaskIds: [...new Set(recovered.map(run => run.taskId))],
    };
  } catch (error) {
    const summary: RecoverySummary = {
      status: 'failed',
      startedAt,
      completedAt: now(),
      recoveredRunCount: 0,
      affectedTaskIds: [],
      errorCode: (error as { code?: string }).code ?? 'RECOVERY_FAILED',
      errorMessage:
        error instanceof Error
          ? 'Startup recovery could not complete. The database may be unreadable, locked by another IntentSmith process, or written by a newer schema version. Resolve that and start again; no work was retried.'
          : 'Startup recovery failed for an unknown reason.',
    };
    throw new StartupRecoveryError(summary.errorMessage ?? 'Startup recovery failed', summary);
  }
}
