import { availableParallelism, arch, freemem, platform, totalmem } from 'node:os';

import { probeNvidia, type NvidiaProbeOptions } from './nvidia-probe.js';
import type { AcceleratorState, GpuProbe, HardwareProfile, SystemProbe, SystemProfile } from './types.js';

/**
 * Hardware Director.
 *
 * Provider-independent: it knows nothing about Ollama and is never told which
 * model is being considered. Probes are injected so every test runs against
 * deterministic fixtures rather than the machine it happens to execute on.
 *
 * Hardware incompatibility is reported, never repaired. Nothing here installs
 * or upgrades a driver, and nothing is uploaded.
 */

export const defaultSystemProbe: SystemProbe = async () => ({
  os: platform(),
  arch: arch(),
  logicalCpuCount: availableParallelism(),
  totalRamBytes: totalmem(),
  availableRamBytes: freemem(),
  // Swap and per-volume storage need platform-specific probes that are not
  // reliably available; they stay undefined rather than being guessed.
});

export type HardwareDirectorOptions = {
  systemProbe?: SystemProbe;
  gpuProbe?: GpuProbe;
  nvidia?: NvidiaProbeOptions;
  now?: () => string;
};

function classify(gpuStatus: string, deviceCount: number): AcceleratorState {
  if (gpuStatus === 'ok' || gpuStatus === 'partial') {
    return deviceCount > 0 ? 'nvidia_available' : 'cpu_only';
  }
  if (gpuStatus === 'permission_denied') return 'gpu_permission_denied';
  if (gpuStatus === 'timeout' || gpuStatus === 'parse_error') return 'gpu_probe_unavailable';
  // `unavailable` means the probe ran and found nothing, which is CPU-only.
  return 'cpu_only';
}

export class HardwareDirector {
  private readonly systemProbe: SystemProbe;
  private readonly gpuProbe: GpuProbe;
  private readonly now: () => string;

  constructor(options: HardwareDirectorOptions = {}) {
    this.systemProbe = options.systemProbe ?? defaultSystemProbe;
    this.gpuProbe = options.gpuProbe ?? (() => probeNvidia(options.nvidia ?? {}));
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /** Collects a hardware profile. Never throws; problems become warnings. */
  async profile(signal?: AbortSignal): Promise<HardwareProfile> {
    const warnings: string[] = [];

    let system: SystemProfile;
    try {
      system = await this.systemProbe();
    } catch {
      warnings.push('System probe failed; CPU and memory evidence is unavailable.');
      system = { os: 'unknown', arch: 'unknown', logicalCpuCount: 0 };
    }

    let gpu = await this.gpuProbe(signal).catch(() => ({
      status: 'parse_error' as const,
      vendor: 'none' as const,
      devices: [],
      detail: 'GPU probe threw an unexpected error.',
    }));

    if (gpu.status !== 'ok') {
      warnings.push(gpu.detail ?? `GPU probe reported status "${gpu.status}".`);
    }
    // A probe that reports devices with no memory figures is only partial
    // evidence, and must not be presented as a complete picture.
    if (gpu.devices.length > 0 && gpu.devices.every(device => device.totalVramBytes === undefined)) {
      warnings.push('GPU devices were detected but none reported VRAM capacity.');
      gpu = { ...gpu, status: 'partial' };
    }

    return {
      collectedAt: this.now(),
      system,
      gpu,
      acceleratorState: classify(gpu.status, gpu.devices.length),
      warnings,
    };
  }
}

/**
 * Removes identifiers that are stable across reboots and uniquely identify a
 * physical machine. Used before a profile is written into committed evidence.
 */
export function redactHardwareProfile(profile: HardwareProfile): HardwareProfile {
  return {
    ...profile,
    gpu: {
      ...profile.gpu,
      devices: profile.gpu.devices.map(device => {
        const { uuid: _uuid, ...rest } = device;
        return rest;
      }),
    },
  };
}
