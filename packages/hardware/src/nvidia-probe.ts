import { execFile } from 'node:child_process';

import type { GpuDevice, GpuProbeResult } from './types.js';

/**
 * Read-only NVIDIA probe.
 *
 * This is deliberately not the future general shell executor. It runs one
 * fixed executable with one fixed argument list, through `execFile` so no
 * shell ever interprets the command line. No user input reaches this process
 * invocation, which is why command injection is not possible here rather than
 * merely unlikely.
 *
 * A missing `nvidia-smi` is a supported state, never a crash, and never a
 * reason to modify the system: IntentSmith reports hardware, it does not
 * install drivers.
 */

/** Fields requested, in order. The parser depends on this exact order. */
const QUERY_FIELDS = [
  'index',
  'uuid',
  'name',
  'driver_version',
  'compute_cap',
  'memory.total',
  'memory.free',
  'utilization.gpu',
] as const;

/** Frozen argument list. Nothing is appended at runtime. */
export const NVIDIA_SMI_ARGS: readonly string[] = Object.freeze([
  `--query-gpu=${QUERY_FIELDS.join(',')}`,
  '--format=csv,noheader,nounits',
]);

export const NVIDIA_SMI_EXECUTABLE = 'nvidia-smi';

export type CommandRunner = (
  executable: string,
  args: readonly string[],
  options: { timeoutMs: number; maxOutputBytes: number },
) => Promise<{ stdout: string; code: number }>;

export type NvidiaProbeOptions = {
  run?: CommandRunner;
  timeoutMs?: number;
  maxOutputBytes?: number;
  /** Absolute path override; validated before use. */
  executablePath?: string;
};

/** Default runner: `execFile`, no shell, bounded time and output. */
export const execFileRunner: CommandRunner = (executable, args, options) =>
  new Promise((resolve, reject) => {
    execFile(
      executable,
      [...args],
      {
        timeout: options.timeoutMs,
        maxBuffer: options.maxOutputBytes,
        // Never a shell, and never the caller's full environment.
        shell: false,
        env: { PATH: process.env.PATH ?? '' },
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          const code = typeof (error as { code?: unknown }).code === 'number'
            ? (error as { code: number }).code
            : -1;
          reject(Object.assign(error, { code, stdout: String(stdout ?? '') }));
          return;
        }
        resolve({ stdout: String(stdout), code: 0 });
      },
    );
  });

function parseNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '' || /^\[?N\/A\]?$/i.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

function optional(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed || /^\[?N\/A\]?$/i.test(trimmed)) return undefined;
  return trimmed;
}

const MIB = 1024 * 1024;

/** Parses `--format=csv,noheader,nounits` output. Memory columns are MiB. */
export function parseNvidiaCsv(stdout: string): { devices: GpuDevice[]; malformedRows: number } {
  const devices: GpuDevice[] = [];
  let malformedRows = 0;

  for (const line of stdout.split('\n')) {
    const row = line.trim();
    if (row === '') continue;
    const cells = row.split(',').map(cell => cell.trim());
    const index = parseNumber(cells[0]);
    const name = optional(cells[2]);
    // Index and name are the minimum that makes a row meaningful.
    if (index === undefined || name === undefined || cells.length < 3) {
      malformedRows += 1;
      continue;
    }
    const totalMib = parseNumber(cells[5]);
    const freeMib = parseNumber(cells[6]);
    devices.push({
      index,
      uuid: optional(cells[1]),
      name,
      driverVersion: optional(cells[3]),
      computeCapability: optional(cells[4]),
      totalVramBytes: totalMib === undefined ? undefined : totalMib * MIB,
      freeVramBytes: freeMib === undefined ? undefined : freeMib * MIB,
      utilizationPercent: parseNumber(cells[7]),
    });
  }
  return { devices, malformedRows };
}

function classifyFailure(error: unknown): GpuProbeResult {
  const err = error as { code?: unknown; killed?: boolean; signal?: string; message?: string };
  if (err.killed || err.signal === 'SIGTERM') {
    return { status: 'timeout', vendor: 'none', devices: [], detail: 'nvidia-smi timed out.' };
  }
  const code = err.code;
  if (code === 'ENOENT') {
    return {
      status: 'unavailable',
      vendor: 'none',
      devices: [],
      detail: 'nvidia-smi was not found; treating this machine as having no NVIDIA GPU.',
    };
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return {
      status: 'permission_denied',
      vendor: 'none',
      devices: [],
      detail: 'nvidia-smi exists but could not be executed (permission denied).',
    };
  }
  return {
    status: 'parse_error',
    vendor: 'none',
    devices: [],
    detail: 'nvidia-smi failed to produce usable output.',
  };
}

/** Probes NVIDIA GPUs. Never throws; failures become an explicit status. */
export async function probeNvidia(options: NvidiaProbeOptions = {}): Promise<GpuProbeResult> {
  const run = options.run ?? execFileRunner;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const maxOutputBytes = options.maxOutputBytes ?? 256 * 1024;

  const executable = options.executablePath ?? NVIDIA_SMI_EXECUTABLE;
  if (options.executablePath !== undefined && !/^\/[\w./-]+$/.test(options.executablePath)) {
    return {
      status: 'unavailable',
      vendor: 'none',
      devices: [],
      detail: 'Configured nvidia-smi path is not an acceptable absolute path.',
    };
  }

  let stdout: string;
  try {
    ({ stdout } = await run(executable, NVIDIA_SMI_ARGS, { timeoutMs, maxOutputBytes }));
  } catch (error) {
    return classifyFailure(error);
  }

  const { devices, malformedRows } = parseNvidiaCsv(stdout);
  if (devices.length === 0) {
    return {
      status: malformedRows > 0 ? 'parse_error' : 'unavailable',
      vendor: 'none',
      devices: [],
      detail: malformedRows > 0
        ? 'nvidia-smi output could not be parsed.'
        : 'nvidia-smi reported no GPUs.',
    };
  }
  return {
    status: malformedRows > 0 ? 'partial' : 'ok',
    vendor: 'nvidia',
    devices,
    detail: malformedRows > 0 ? `${malformedRows} row(s) of nvidia-smi output were unparseable.` : undefined,
  };
}
