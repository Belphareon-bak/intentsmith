import type { ModelDescriptor } from '@intentsmith/inference';

import type { GpuDevice, HardwareProfile } from './types.js';

/**
 * Model-fit assessment.
 *
 * This is an *estimate built from stated evidence*, never a measurement. The
 * artifact size on disk is not the runtime VRAM requirement: weights are
 * memory-mapped, the KV cache grows with context, and the runtime adds its own
 * overhead. Saying "this model needs exactly N GiB" from a file size would be
 * false precision, so this module refuses to do it.
 *
 * The estimate is deliberately separate from the policy decision. `assessFit`
 * answers "what does the evidence suggest?"; `applyExecutionPolicy` answers
 * "given what the user asked for, is that acceptable?". Only the second can
 * block.
 */

export type FitClassification =
  | 'likely_gpu_fit'
  | 'may_partially_offload'
  | 'cpu_only_possible'
  | 'unsupported_hardware'
  | 'insufficient_data'
  | 'remote_forbidden';

export type FitConfidence = 'high' | 'medium' | 'low' | 'none';

/** What the user is willing to accept. Separate from the estimate. */
export type ExecutionPolicy = 'gpu_required' | 'gpu_preferred' | 'cpu_allowed';

export type FitEvidence = {
  modelId: string;
  artifactBytes?: number;
  parameterBillions?: number;
  contextTokens?: number;
  quantization?: string;
  largestGpuTotalVramBytes?: number;
  largestGpuFreeVramBytes?: number;
  gpuCount: number;
  totalRamBytes?: number;
  availableRamBytes?: number;
};

export type FitAssessment = {
  classification: FitClassification;
  confidence: FitConfidence;
  evidence: FitEvidence;
  /** Every assumption the estimate rests on, stated plainly. */
  assumptions: string[];
  warnings: string[];
  reasonCodes: string[];
};

export type PolicyDecision = {
  allowed: boolean;
  policy: ExecutionPolicy;
  assessment: FitAssessment;
  /** Set only when `allowed` is false. */
  errorCode?: 'MODEL_FIT_REJECTED' | 'REMOTE_INFERENCE_FORBIDDEN';
  reason?: string;
};

const GIB = 1024 ** 3;

/**
 * Headroom multiplier applied to artifact size to approximate resident size.
 *
 * Rationale, stated rather than hidden: a GGUF artifact is close to the weight
 * memory, and the runtime needs additional room for the KV cache, compute
 * buffers and fragmentation. 1.2 is a deliberately modest allowance, and the
 * result is always reported as a band, never as a precise requirement.
 */
const RUNTIME_OVERHEAD_FACTOR = 1.2;

/** Rough KV-cache allowance per 1k context tokens, used only as a warning. */
const KV_BYTES_PER_1K_CONTEXT = 128 * 1024 * 1024;

function largestGpu(devices: GpuDevice[]): GpuDevice | undefined {
  return devices.reduce<GpuDevice | undefined>((best, device) => {
    if (device.totalVramBytes === undefined) return best;
    if (!best || (best.totalVramBytes ?? 0) < device.totalVramBytes) return device;
    return best;
  }, undefined);
}

/**
 * Estimates whether a model is likely to run, from reported evidence only.
 *
 * Never sums VRAM across GPUs. Ollama may split a model across devices, but it
 * may equally place it on one, and nothing in the metadata says which. Adding
 * device memory together would turn an unknown into a confident wrong answer,
 * so the largest single device is used and multi-GPU capacity is reported as a
 * warning instead.
 */
export function assessFit(model: ModelDescriptor, hardware: HardwareProfile): FitAssessment {
  const devices = hardware.gpu.devices;
  const biggest = largestGpu(devices);
  const evidence: FitEvidence = {
    modelId: model.id,
    artifactBytes: model.artifactBytes,
    parameterBillions: model.parameterBillions,
    contextTokens: model.contextTokens,
    quantization: model.quantization,
    largestGpuTotalVramBytes: biggest?.totalVramBytes,
    largestGpuFreeVramBytes: biggest?.freeVramBytes,
    gpuCount: devices.length,
    totalRamBytes: hardware.system.totalRamBytes,
    availableRamBytes: hardware.system.availableRamBytes,
  };

  const assumptions: string[] = [];
  const warnings: string[] = [];
  const reasonCodes: string[] = [];

  // Remote models are refused regardless of how well they would fit.
  if (model.execution === 'remote_forbidden') {
    reasonCodes.push('MODEL_IS_REMOTE');
    return {
      classification: 'remote_forbidden',
      confidence: 'high',
      evidence,
      assumptions,
      warnings: [model.executionReason ?? 'Provider reported remote execution metadata.'],
      reasonCodes,
    };
  }

  if (devices.length > 1) {
    warnings.push(
      `${devices.length} GPUs are present. VRAM is not summed across devices: the runtime may or may not split this model, and the metadata does not say which.`,
    );
    reasonCodes.push('MULTI_GPU_NOT_SUMMED');
  }

  if (model.contextTokens !== undefined && model.contextTokens >= 32_768) {
    const kv = Math.round((model.contextTokens / 1000) * KV_BYTES_PER_1K_CONTEXT / GIB);
    warnings.push(
      `Model advertises a ${model.contextTokens} token context. Using it fully could add roughly ${kv} GiB of KV cache beyond the weights.`,
    );
    reasonCodes.push('LARGE_CONTEXT');
  }

  // No artifact size means no basis for an estimate. Say so.
  if (model.artifactBytes === undefined) {
    reasonCodes.push('NO_ARTIFACT_SIZE');
    return {
      classification: 'insufficient_data',
      confidence: 'none',
      evidence,
      assumptions,
      warnings: [...warnings, 'Provider did not report an artifact size, so no fit estimate is possible.'],
      reasonCodes,
    };
  }

  const estimatedResidentBytes = model.artifactBytes * RUNTIME_OVERHEAD_FACTOR;
  assumptions.push(
    `Resident size approximated as artifact size x ${RUNTIME_OVERHEAD_FACTOR}. Artifact size is evidence, not a measured VRAM requirement.`,
  );

  if (hardware.gpu.status === 'permission_denied') {
    reasonCodes.push('GPU_PERMISSION_DENIED');
    return {
      classification: 'insufficient_data',
      confidence: 'none',
      evidence,
      assumptions,
      warnings: [...warnings, hardware.gpu.detail ?? 'GPU probe was denied permission.'],
      reasonCodes,
    };
  }

  if (hardware.gpu.status === 'timeout' || hardware.acceleratorState === 'gpu_probe_unavailable') {
    reasonCodes.push('GPU_PROBE_UNAVAILABLE');
    return {
      classification: 'insufficient_data',
      confidence: 'none',
      evidence,
      assumptions,
      warnings: [...warnings, hardware.gpu.detail ?? 'GPU state could not be determined.'],
      reasonCodes,
    };
  }

  // No GPU at all: CPU execution is still a real option, so this is not a failure.
  if (biggest?.totalVramBytes === undefined) {
    reasonCodes.push('NO_GPU_EVIDENCE');
    const ram = hardware.system.availableRamBytes ?? hardware.system.totalRamBytes;
    if (ram !== undefined && ram < estimatedResidentBytes) {
      warnings.push('Estimated resident size exceeds reported system RAM; CPU execution may swap or fail.');
      reasonCodes.push('RAM_BELOW_ESTIMATE');
    }
    return {
      classification: 'cpu_only_possible',
      confidence: ram === undefined ? 'low' : 'medium',
      evidence,
      assumptions: [...assumptions, 'No usable GPU evidence, so only CPU execution was considered.'],
      warnings,
      reasonCodes,
    };
  }

  const total = biggest.totalVramBytes;
  const free = biggest.freeVramBytes;
  if (free !== undefined && free < total * 0.5) {
    warnings.push(
      `Only ${(free / GIB).toFixed(1)} GiB of ${(total / GIB).toFixed(1)} GiB VRAM is currently free; another process is using this GPU.`,
    );
    reasonCodes.push('LOW_FREE_VRAM');
  }

  // Compare against free VRAM when known, since total is not what is usable now.
  const usable = free ?? total;
  assumptions.push(
    free === undefined
      ? 'Free VRAM was not reported, so total VRAM was used and the estimate is optimistic.'
      : 'Currently free VRAM was used rather than total VRAM.',
  );

  if (estimatedResidentBytes <= usable) {
    reasonCodes.push('FITS_LARGEST_GPU');
    return {
      classification: 'likely_gpu_fit',
      confidence: free === undefined ? 'medium' : 'high',
      evidence,
      assumptions,
      warnings,
      reasonCodes,
    };
  }

  // Too big for the GPU is not the same as unable to run: Ollama offloads.
  reasonCodes.push('EXCEEDS_LARGEST_GPU');
  return {
    classification: 'may_partially_offload',
    confidence: 'medium',
    evidence,
    assumptions: [
      ...assumptions,
      'Exceeding GPU memory means the runtime will offload layers to CPU, which is slower but not a failure.',
    ],
    warnings,
    reasonCodes,
  };
}

/**
 * Applies an execution policy to an assessment.
 *
 * Only this function can block, and only when the policy and the evidence
 * together justify it. An `insufficient_data` result never blocks under
 * `cpu_allowed`, because not knowing is not the same as knowing it will fail.
 */
export function applyExecutionPolicy(assessment: FitAssessment, policy: ExecutionPolicy): PolicyDecision {
  const base = { policy, assessment };

  if (assessment.classification === 'remote_forbidden') {
    return {
      ...base,
      allowed: false,
      errorCode: 'REMOTE_INFERENCE_FORBIDDEN',
      reason: 'Model is served remotely and can never be executed by IntentSmith.',
    };
  }
  if (assessment.classification === 'unsupported_hardware') {
    return {
      ...base,
      allowed: false,
      errorCode: 'MODEL_FIT_REJECTED',
      reason: 'Hardware is reported as unsupported for this model.',
    };
  }

  if (policy === 'gpu_required') {
    if (assessment.classification === 'likely_gpu_fit') return { ...base, allowed: true };
    return {
      ...base,
      allowed: false,
      errorCode: 'MODEL_FIT_REJECTED',
      reason:
        assessment.classification === 'insufficient_data'
          ? 'Policy requires GPU execution and there is not enough evidence to confirm the model fits in GPU memory.'
          : 'Policy requires GPU execution and the model is not expected to fit in a single GPU.',
    };
  }

  // gpu_preferred and cpu_allowed both permit CPU work; they differ only in
  // the advice attached, so neither blocks on a merely imperfect fit.
  return { ...base, allowed: true };
}
