import { execFile } from 'node:child_process';

/**
 * Deterministic gate runner.
 *
 * This runs the commands **Core** chose, to decide a verdict. It is not a
 * general shell executor and a worker can never influence it: the command comes
 * from IntentSmith's own configuration, the argument vector is fixed, and no
 * worker output is interpolated into it.
 *
 * That separation is the whole point. A worker claiming success proves nothing;
 * a gate the worker could not touch is what makes the verdict trustworthy.
 */

export type GateDefinition = {
  /** Stable identifier used in evidence. */
  id: string;
  /** Human-readable purpose. */
  description: string;
  executable: string;
  args: readonly string[];
  /** Exit codes considered a pass. Defaults to `[0]`. */
  passExitCodes?: readonly number[];
};

export type GateResult = {
  id: string;
  description: string;
  status: 'pass' | 'fail' | 'blocked';
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  /** Bounded, sanitized output for evidence. */
  stdoutTail: string;
  stderrTail: string;
  /** Set when the gate could not run at all. */
  blockedReason?: string;
};

export type GateRunOptions = {
  cwd: string;
  /** Complete environment. Fixed by Core, never derived from worker output. */
  env: Record<string, string>;
  timeoutMs?: number;
  maxOutputBytes?: number;
  runner?: GateCommandRunner;
  now?: () => number;
};

export type GateCommandRunner = (
  executable: string,
  args: readonly string[],
  options: { cwd: string; env: Record<string, string>; timeoutMs: number; maxOutputBytes: number },
) => Promise<{ code: number | null; signal: string | null; stdout: string; stderr: string }>;

/** Default runner: `execFile`, no shell, own process group, bounded. */
export const execFileGateRunner: GateCommandRunner = (executable, args, options) =>
  new Promise(resolve => {
    const child = execFile(
      executable,
      [...args],
      {
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeoutMs,
        maxBuffer: options.maxOutputBytes,
        shell: false,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const code = typeof (error as { code?: unknown } | null)?.code === 'number'
          ? ((error as { code: number }).code)
          : error
            ? null
            : 0;
        resolve({
          code,
          signal: (error as { signal?: string } | null)?.signal ?? null,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
        });
      },
    );
    // Own group so a gate that spawns helpers cannot leave them behind.
    child.unref?.();
  });

function tail(text: string, limit = 4000): string {
  const collapsed = text.replace(/\s+$/g, '');
  return collapsed.length > limit ? `...${collapsed.slice(-limit)}` : collapsed;
}

/** Runs one gate. Never throws: a gate that cannot run is `blocked`. */
export async function runGate(
  gate: GateDefinition,
  options: GateRunOptions,
): Promise<GateResult> {
  const runner = options.runner ?? execFileGateRunner;
  const now = options.now ?? (() => Date.now());
  const timeoutMs = options.timeoutMs ?? 120_000;
  const maxOutputBytes = options.maxOutputBytes ?? 4 * 1024 * 1024;
  const passCodes = gate.passExitCodes ?? [0];
  const started = now();

  try {
    const outcome = await runner(gate.executable, gate.args, {
      cwd: options.cwd,
      env: options.env,
      timeoutMs,
      maxOutputBytes,
    });
    const passed = outcome.code !== null && passCodes.includes(outcome.code);
    return {
      id: gate.id,
      description: gate.description,
      status: passed ? 'pass' : 'fail',
      exitCode: outcome.code,
      signal: outcome.signal,
      durationMs: now() - started,
      stdoutTail: tail(outcome.stdout),
      stderrTail: tail(outcome.stderr),
    };
  } catch (error) {
    return {
      id: gate.id,
      description: gate.description,
      status: 'blocked',
      exitCode: null,
      signal: null,
      durationMs: now() - started,
      stdoutTail: '',
      stderrTail: '',
      blockedReason: error instanceof Error ? error.message.slice(0, 300) : 'Gate could not be executed.',
    };
  }
}

/**
 * Runs every gate in order.
 *
 * Runs them all rather than stopping at the first failure, because a partial
 * picture is a worse basis for a verdict than a complete one.
 */
export async function runGates(
  gates: readonly GateDefinition[],
  options: GateRunOptions,
): Promise<GateResult[]> {
  const results: GateResult[] = [];
  for (const gate of gates) {
    results.push(await runGate(gate, options));
  }
  return results;
}

/**
 * Verdict from gate results alone.
 *
 * A worker's claim is not an input here. Anything other than every gate
 * passing is not a pass, and a blocked gate is never treated as a pass.
 */
export function verdictFromGates(results: readonly GateResult[]): 'pass' | 'fail' | 'blocked' {
  if (results.length === 0) return 'blocked';
  if (results.some(result => result.status === 'blocked')) return 'blocked';
  return results.every(result => result.status === 'pass') ? 'pass' : 'fail';
}
