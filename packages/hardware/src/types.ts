/**
 * Hardware evidence types.
 *
 * Every field is either something a probe actually reported or an explicit
 * unknown. Nothing here is inferred, and nothing is uploaded anywhere.
 */

export type ProbeStatus =
  | 'ok'
  | 'unavailable'
  | 'permission_denied'
  | 'timeout'
  | 'parse_error'
  | 'partial';

export type SystemProfile = {
  os: string;
  arch: string;
  logicalCpuCount: number;
  totalRamBytes?: number;
  availableRamBytes?: number;
  totalSwapBytes?: number;
  availableSwapBytes?: number;
  availableStorageBytes?: number;
};

export type GpuDevice = {
  index: number;
  uuid?: string;
  name: string;
  driverVersion?: string;
  computeCapability?: string;
  totalVramBytes?: number;
  freeVramBytes?: number;
  utilizationPercent?: number;
};

export type GpuProbeResult = {
  status: ProbeStatus;
  vendor: 'nvidia' | 'none';
  devices: GpuDevice[];
  /** Safe, human-readable explanation when status is not `ok`. */
  detail?: string;
};

/**
 * Overall accelerator situation.
 *
 * `cpu_only` means no GPU was found and that is a supported way to run.
 * `gpu_probe_unavailable` means we genuinely do not know, which is different
 * from knowing there is no GPU.
 */
export type AcceleratorState =
  | 'nvidia_available'
  | 'cpu_only'
  | 'gpu_probe_unavailable'
  | 'gpu_permission_denied'
  | 'unsupported_gpu';

export type HardwareProfile = {
  collectedAt: string;
  system: SystemProfile;
  gpu: GpuProbeResult;
  acceleratorState: AcceleratorState;
  /** Non-fatal problems encountered while collecting evidence. */
  warnings: string[];
};

export type SystemProbe = () => Promise<SystemProfile>;
export type GpuProbe = (signal?: AbortSignal) => Promise<GpuProbeResult>;
