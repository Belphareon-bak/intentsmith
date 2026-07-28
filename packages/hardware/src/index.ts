/**
 * `@intentsmith/hardware` owns hardware discovery and model-fit assessment.
 * It is provider-independent and depends on `@intentsmith/inference` only for
 * the normalized `ModelDescriptor` type.
 */
export {
  HardwareDirector,
  defaultSystemProbe,
  redactHardwareProfile,
  type HardwareDirectorOptions,
} from './director.js';
export {
  NVIDIA_SMI_ARGS,
  NVIDIA_SMI_EXECUTABLE,
  execFileRunner,
  parseNvidiaCsv,
  probeNvidia,
  type CommandRunner,
  type NvidiaProbeOptions,
} from './nvidia-probe.js';
export {
  applyExecutionPolicy,
  assessFit,
  type ExecutionPolicy,
  type FitAssessment,
  type FitClassification,
  type FitConfidence,
  type FitEvidence,
  type PolicyDecision,
} from './model-fit.js';
export type {
  AcceleratorState,
  GpuDevice,
  GpuProbe,
  GpuProbeResult,
  HardwareProfile,
  ProbeStatus,
  SystemProbe,
  SystemProfile,
} from './types.js';
