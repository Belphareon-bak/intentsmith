import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

/**
 * Bounded external-process supervision.
 *
 * Everything here exists because an external worker is untrusted and may
 * misbehave in ways that are not its fault: it can flood stdout, ignore
 * SIGTERM, or leave grandchildren behind. None of those may be able to take
 * IntentSmith with it.
 *
 * This is deliberately **not** a general shell executor. There is no shell, no
 * command string, and no user input in the argument vector.
 */

export type ProcessLimits = {
  /** Milliseconds to wait for the process to be considered started. */
  startupMs: number;
  /** Milliseconds of silence before the process is treated as hung. */
  idleMs: number;
  /** Whole-run ceiling. */
  overallMs: number;
  /** Bytes retained from stdout. Beyond this the process is failed. */
  maxStdoutBytes: number;
  /** Bytes retained from stderr. */
  maxStderrBytes: number;
  /** Milliseconds between SIGTERM and SIGKILL of the process group. */
  terminationGraceMs: number;
};

export const DEFAULT_PROCESS_LIMITS: ProcessLimits = {
  startupMs: 30_000,
  idleMs: 120_000,
  overallMs: 900_000,
  maxStdoutBytes: 8 * 1024 * 1024,
  maxStderrBytes: 1024 * 1024,
  terminationGraceMs: 5_000,
};

export type SupervisedProcessOptions = {
  /** Absolute path or bare executable name. Never a command string. */
  executable: string;
  /** Fixed argument vector. Never built from user text. */
  args: readonly string[];
  /** Explicit working directory. */
  cwd: string;
  /**
   * Complete environment for the child. This **replaces** the parent
   * environment; nothing is inherited implicitly.
   */
  env: Record<string, string>;
  limits?: Partial<ProcessLimits>;
  /** Injected for tests so timeouts never depend on wall-clock time. */
  schedule?: (fn: () => void, ms: number) => () => void;
  /** Injected spawn, for tests. */
  spawnFn?: typeof spawn;
};

export type ProcessFailureReason =
  | 'executable_missing'
  | 'permission_denied'
  | 'spawn_failed'
  | 'immediate_exit'
  | 'startup_timeout'
  | 'idle_timeout'
  | 'overall_timeout'
  | 'stdout_overflow'
  | 'stderr_overflow'
  | 'crashed'
  | 'cancelled';

export class ProcessError extends Error {
  constructor(
    readonly reason: ProcessFailureReason,
    message: string,
    readonly exitCode?: number | null,
    readonly signal?: NodeJS.Signals | null,
  ) {
    super(message);
    this.name = 'ProcessError';
  }
}

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const handle = setTimeout(fn, ms);
  handle.unref?.();
  return () => clearTimeout(handle);
};

export type ProcessExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** Set when IntentSmith terminated the process rather than it exiting. */
  reason?: ProcessFailureReason;
};

/**
 * A supervised child process.
 *
 * Spawned in its own process group (`detached: true`) so termination can reach
 * grandchildren. A worker that spawns helpers must not be able to leave them
 * running after cancel, timeout or shutdown.
 */
export class SupervisedProcess {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly limits: ProcessLimits;
  private readonly schedule: (fn: () => void, ms: number) => () => void;

  private stdoutBytes = 0;
  private stderrBytes = 0;
  private stderrTail = '';
  private cancelIdle: (() => void) | undefined;
  private cancelOverall: (() => void) | undefined;
  private settled = false;
  private failure: ProcessError | undefined;

  readonly exited: Promise<ProcessExit>;
  private resolveExit!: (value: ProcessExit) => void;

  /** Raw stdout chunks, for the protocol reader to consume. */
  private readonly stdoutListeners = new Set<(chunk: Buffer) => void>();

  constructor(options: SupervisedProcessOptions) {
    this.limits = { ...DEFAULT_PROCESS_LIMITS, ...options.limits };
    this.schedule = options.schedule ?? defaultSchedule;
    const spawnFn = options.spawnFn ?? spawn;

    this.exited = new Promise(resolve => {
      this.resolveExit = resolve;
    });

    this.child = spawnFn(options.executable, [...options.args], {
      cwd: options.cwd,
      // The child gets exactly this environment and nothing else.
      env: options.env,
      // Never a shell: no argument can be reinterpreted as a command.
      shell: false,
      // Own process group, so kill() can reach the whole tree.
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;

    this.child.on('error', (error: NodeJS.ErrnoException) => {
      const reason: ProcessFailureReason =
        error.code === 'ENOENT'
          ? 'executable_missing'
          : error.code === 'EACCES' || error.code === 'EPERM'
            ? 'permission_denied'
            : 'spawn_failed';
      this.fail(new ProcessError(reason, describeSpawnError(reason, options.executable)));
    });

    this.child.stdout.on('data', (chunk: Buffer) => {
      this.stdoutBytes += chunk.byteLength;
      if (this.stdoutBytes > this.limits.maxStdoutBytes) {
        this.fail(new ProcessError('stdout_overflow', 'Worker produced more stdout than the configured limit.'));
        return;
      }
      this.armIdle();
      for (const listener of this.stdoutListeners) listener(chunk);
    });

    this.child.stderr.on('data', (chunk: Buffer) => {
      this.stderrBytes += chunk.byteLength;
      if (this.stderrBytes > this.limits.maxStderrBytes) {
        this.fail(new ProcessError('stderr_overflow', 'Worker produced more stderr than the configured limit.'));
        return;
      }
      // Only a bounded tail is retained, for diagnostics.
      this.stderrTail = `${this.stderrTail}${chunk.toString('utf8')}`.slice(-4096);
      this.armIdle();
    });

    this.child.on('exit', (code, signal) => {
      this.settle({ code, signal, ...(this.failure ? { reason: this.failure.reason } : {}) });
    });

    this.armIdle();
    this.cancelOverall = this.schedule(() => {
      this.fail(new ProcessError('overall_timeout', 'Worker exceeded its overall time limit.'));
    }, this.limits.overallMs);
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  /** Bounded stderr tail, safe to attach to diagnostics. */
  get stderr(): string {
    return this.stderrTail;
  }

  get failureReason(): ProcessFailureReason | undefined {
    return this.failure?.reason;
  }

  onStdout(listener: (chunk: Buffer) => void): () => void {
    this.stdoutListeners.add(listener);
    return () => this.stdoutListeners.delete(listener);
  }

  /** Writes to the child's stdin. No-op once the process is gone. */
  write(data: string): void {
    if (this.settled || this.child.stdin.destroyed) return;
    this.child.stdin.write(data);
  }

  /**
   * Terminates the process group.
   *
   * SIGTERM first, then SIGKILL to the whole group after the grace period. The
   * negative PID targets the group, which is why `detached: true` matters: a
   * worker's grandchildren must not survive.
   */
  async terminate(reason: ProcessFailureReason = 'cancelled'): Promise<ProcessExit> {
    if (!this.failure) this.failure = new ProcessError(reason, `Process terminated: ${reason}`);
    this.clearTimers();

    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      return await this.exited;
    }

    this.signalGroup('SIGTERM');
    const forced = this.schedule(() => this.signalGroup('SIGKILL'), this.limits.terminationGraceMs);
    try {
      return await this.exited;
    } finally {
      forced();
    }
  }

  private signalGroup(signal: NodeJS.Signals): void {
    const pid = this.child.pid;
    if (pid === undefined) return;
    try {
      // Negative pid = process group.
      process.kill(-pid, signal);
    } catch {
      // The group may already be gone; fall back to the direct child.
      try {
        this.child.kill(signal);
      } catch {
        // Nothing left to signal.
      }
    }
  }

  private armIdle(): void {
    this.cancelIdle?.();
    this.cancelIdle = this.schedule(() => {
      this.fail(new ProcessError('idle_timeout', 'Worker produced no output within the idle timeout.'));
    }, this.limits.idleMs);
  }

  private fail(error: ProcessError): void {
    if (this.failure) return;
    this.failure = error;
    this.clearTimers();
    if (this.child.pid !== undefined && this.child.exitCode === null) {
      void this.terminate(error.reason);
      return;
    }
    this.settle({ code: this.child.exitCode, signal: this.child.signalCode, reason: error.reason });
  }

  private clearTimers(): void {
    this.cancelIdle?.();
    this.cancelOverall?.();
    this.cancelIdle = undefined;
    this.cancelOverall = undefined;
  }

  private settle(exit: ProcessExit): void {
    if (this.settled) return;
    this.settled = true;
    this.clearTimers();
    this.resolveExit(exit);
  }
}

function describeSpawnError(reason: ProcessFailureReason, executable: string): string {
  if (reason === 'executable_missing') {
    return `Worker executable "${executable}" was not found. IntentSmith never installs it for you; install it yourself and try again.`;
  }
  if (reason === 'permission_denied') {
    return `Worker executable "${executable}" exists but could not be executed (permission denied).`;
  }
  return `Worker executable "${executable}" could not be started.`;
}
