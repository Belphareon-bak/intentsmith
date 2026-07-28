/**
 * Process sandbox port.
 *
 * IntentSmith must never claim isolation it does not actually enforce. The
 * honest states are therefore explicit, and "we removed the credentials from
 * the environment" is reported as `degraded`, not as a sandbox.
 *
 * Phase 3 detects bubblewrap and reports what it finds. It deliberately does
 * **not** build a network-namespace workaround: an unverified mechanism that
 * looks like isolation is worse than an honest `none`, because it invites the
 * user to trust something that was never tested.
 */

export type SandboxKind = 'none' | 'bubblewrap';

export type SandboxStatus = {
  kind: SandboxKind;
  /**
   * - `enforced`  the sandbox is active and constrains the process
   * - `degraded`  process isolation only: no credentials, own HOME, disposable
   *               workspace, but no OS-level enforcement
   * - `unavailable` the requested mechanism is not present on this machine
   */
  level: 'enforced' | 'degraded' | 'unavailable';
  /** Whether network access is actually blocked. Never claimed without proof. */
  networkIsolated: boolean;
  /** Absolute paths the process may write. */
  writeRoots: string[];
  detail: string;
};

export type SandboxRequest = {
  /** The single directory the process may modify. */
  workspaceRoot: string;
  /** Read-only paths the runtime genuinely needs, e.g. the executable's dir. */
  readOnlyPaths: string[];
  executable: string;
  args: readonly string[];
};

export type SandboxPlan = {
  /** Executable to actually spawn: either the original or the sandbox wrapper. */
  executable: string;
  args: readonly string[];
  status: SandboxStatus;
};

export type SandboxProbe = (executable: string) => Promise<boolean>;

/**
 * The degraded plan: run the process directly.
 *
 * This is the truthful default. The protections that *do* exist — an empty
 * environment, a private HOME, and a disposable workspace — are real but are
 * not OS-level containment, so `networkIsolated` stays false.
 */
export function degradedPlan(request: SandboxRequest, detail: string): SandboxPlan {
  return {
    executable: request.executable,
    args: request.args,
    status: {
      kind: 'none',
      level: 'degraded',
      networkIsolated: false,
      writeRoots: [request.workspaceRoot],
      detail,
    },
  };
}

/**
 * Builds a bubblewrap invocation.
 *
 * Binds the workspace read-write, the listed runtime paths read-only, and
 * nothing else. Unrelated home directories are never exposed.
 */
export function bubblewrapPlan(request: SandboxRequest, runtimeRoot: string): SandboxPlan {
  const args: string[] = [
    '--unshare-all',
    // Loopback stays up: the worker's only inference path is the IntentSmith
    // gateway, which listens on loopback. Unsharing the network without this
    // would break the very thing that keeps inference local.
    '--share-net',
    '--die-with-parent',
    '--new-session',
    '--proc', '/proc',
    '--dev', '/dev',
    '--tmpfs', '/tmp',
    '--bind', request.workspaceRoot, request.workspaceRoot,
    '--bind', runtimeRoot, runtimeRoot,
  ];
  for (const readOnly of request.readOnlyPaths) {
    args.push('--ro-bind', readOnly, readOnly);
  }
  args.push('--', request.executable, ...request.args);

  return {
    executable: 'bwrap',
    args,
    status: {
      kind: 'bubblewrap',
      level: 'enforced',
      // Loopback is deliberately reachable, so this is not full network
      // isolation and must not be reported as such.
      networkIsolated: false,
      writeRoots: [request.workspaceRoot, runtimeRoot],
      detail:
        'bubblewrap active: only the disposable workspace and the throwaway runtime root are writable. Loopback networking is intentionally reachable so the IntentSmith gateway remains usable; outbound network is not otherwise restricted.',
    },
  };
}

export type PlanSandboxOptions = {
  request: SandboxRequest;
  runtimeRoot: string;
  /** Set false to skip detection entirely. */
  preferSandbox?: boolean;
  /** Injected availability probe, so tests never depend on the host. */
  probe?: SandboxProbe;
};

/**
 * Chooses a sandbox plan, reporting exactly what was achieved.
 *
 * Never fails: an unavailable sandbox degrades with an explicit status so the
 * caller can decide whether that is acceptable for the work at hand.
 */
export async function planSandbox(options: PlanSandboxOptions): Promise<SandboxPlan> {
  if (options.preferSandbox === false) {
    return degradedPlan(options.request, 'Sandboxing was not requested for this run.');
  }
  const probe = options.probe ?? (async () => false);
  const available = await probe('bwrap').catch(() => false);
  if (!available) {
    return degradedPlan(
      options.request,
      'bubblewrap (bwrap) is not available on this machine, so the worker runs with process isolation only: an empty environment, a private HOME, and a disposable workspace. This is not OS-level containment.',
    );
  }
  return bubblewrapPlan(options.request, options.runtimeRoot);
}
