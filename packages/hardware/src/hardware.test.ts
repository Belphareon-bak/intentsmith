import { describe, expect, it, vi } from 'vitest';

import type { ModelDescriptor } from '@intentsmith/inference';

import { HardwareDirector, redactHardwareProfile } from './director.js';
import { applyExecutionPolicy, assessFit, type ExecutionPolicy } from './model-fit.js';
import { NVIDIA_SMI_ARGS, NVIDIA_SMI_EXECUTABLE, parseNvidiaCsv, probeNvidia } from './nvidia-probe.js';
import type { GpuProbeResult, HardwareProfile, SystemProfile } from './types.js';

/**
 * Hardware Director and model-fit tests.
 *
 * All probes are injected, so nothing here runs `nvidia-smi`, reads the host's
 * real hardware, or depends on which machine executes the suite.
 */

const GIB = 1024 ** 3;
const MIB = 1024 * 1024;

const SYSTEM: SystemProfile = {
  os: 'linux',
  arch: 'x64',
  logicalCpuCount: 16,
  totalRamBytes: 64 * GIB,
  availableRamBytes: 32 * GIB,
};

/** Shape matches the real `--format=csv,noheader,nounits` output. */
const SINGLE_GPU_CSV = '0, GPU-abc-123, NVIDIA GeForce RTX 3090, 590.48.01, 8.6, 24576, 22935, 3\n';
const DUAL_GPU_CSV =
  `${SINGLE_GPU_CSV}1, GPU-def-456, NVIDIA GeForce RTX 3090, 590.48.01, 8.6, 24576, 24000, 0\n`;

function runnerFor(stdout: string) {
  return vi.fn(async () => ({ stdout, code: 0 }));
}

function profile(gpu: GpuProbeResult, system: SystemProfile = SYSTEM): HardwareProfile {
  return {
    collectedAt: '2026-07-28T00:00:00.000Z',
    system,
    gpu,
    acceleratorState: gpu.devices.length > 0 ? 'nvidia_available' : 'cpu_only',
    warnings: [],
  };
}

function model(overrides: Partial<ModelDescriptor> = {}): ModelDescriptor {
  return {
    id: 'qwen3:14b',
    family: 'qwen3',
    parameterBillions: 14.8,
    artifactBytes: 9 * GIB,
    contextTokens: 8192,
    execution: 'local',
    ...overrides,
  };
}

describe('nvidia probe', () => {
  it('parses a supported single-GPU fixture', async () => {
    const result = await probeNvidia({ run: runnerFor(SINGLE_GPU_CSV) });
    expect(result.status).toBe('ok');
    expect(result.vendor).toBe('nvidia');
    expect(result.devices).toHaveLength(1);
    expect(result.devices[0]).toMatchObject({
      index: 0,
      name: 'NVIDIA GeForce RTX 3090',
      // The driver version is whatever the probe reported; nothing is hardcoded
      // in the implementation.
      driverVersion: '590.48.01',
      computeCapability: '8.6',
      totalVramBytes: 24576 * MIB,
      freeVramBytes: 22935 * MIB,
      utilizationPercent: 3,
    });
  });

  it('parses multiple GPUs', async () => {
    const result = await probeNvidia({ run: runnerFor(DUAL_GPU_CSV) });
    expect(result.devices).toHaveLength(2);
    expect(result.devices.map(device => device.index)).toEqual([0, 1]);
  });

  it('never uses a shell and always passes the frozen argument list', async () => {
    const run = runnerFor(SINGLE_GPU_CSV);
    await probeNvidia({ run });
    const [executable, args] = run.mock.calls[0] as unknown as [string, readonly string[]];
    expect(executable).toBe(NVIDIA_SMI_EXECUTABLE);
    expect(args).toEqual(NVIDIA_SMI_ARGS);
    // No shell metacharacters anywhere, and nothing appended at runtime.
    for (const arg of args) expect(arg).not.toMatch(/[;&|`$><]/);
    expect(Object.isFrozen(NVIDIA_SMI_ARGS)).toBe(true);
  });

  it('treats a missing nvidia-smi as a supported state', async () => {
    const result = await probeNvidia({
      run: async () => {
        throw Object.assign(new Error('spawn nvidia-smi ENOENT'), { code: 'ENOENT' });
      },
    });
    expect(result.status).toBe('unavailable');
    expect(result.devices).toEqual([]);
    expect(result.detail).toContain('not found');
  });

  it('reports permission denial distinctly', async () => {
    const result = await probeNvidia({
      run: async () => {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      },
    });
    expect(result.status).toBe('permission_denied');
  });

  it('reports a timeout distinctly', async () => {
    const result = await probeNvidia({
      run: async () => {
        throw Object.assign(new Error('timed out'), { killed: true, signal: 'SIGTERM' });
      },
    });
    expect(result.status).toBe('timeout');
  });

  it('reports malformed CSV as a parse error', async () => {
    const result = await probeNvidia({ run: runnerFor('this is not, csv\ngarbage\n') });
    expect(result.status).toBe('parse_error');
    expect(result.devices).toEqual([]);
  });

  it('marks partially parseable output as partial', async () => {
    const result = await probeNvidia({ run: runnerFor(`${SINGLE_GPU_CSV}garbage-row\n`) });
    expect(result.status).toBe('partial');
    expect(result.devices).toHaveLength(1);
  });

  it('keeps missing optional fields undefined instead of zero', () => {
    const { devices } = parseNvidiaCsv('0, [N/A], Some GPU, [N/A], [N/A], [N/A], [N/A], [N/A]\n');
    expect(devices[0]).toMatchObject({ index: 0, name: 'Some GPU' });
    expect(devices[0]?.uuid).toBeUndefined();
    expect(devices[0]?.totalVramBytes).toBeUndefined();
    expect(devices[0]?.utilizationPercent).toBeUndefined();
  });

  it('rejects a configured executable path that is not a plain absolute path', async () => {
    const result = await probeNvidia({ executablePath: '/usr/bin/nvidia-smi; rm -rf /' });
    expect(result.status).toBe('unavailable');
    expect(result.detail).toContain('acceptable absolute path');
  });
});

describe('hardware director', () => {
  it('reports a CPU-only machine without treating it as a failure', async () => {
    const director = new HardwareDirector({
      systemProbe: async () => SYSTEM,
      gpuProbe: async () => ({ status: 'unavailable', vendor: 'none', devices: [], detail: 'no nvidia-smi' }),
    });
    const result = await director.profile();
    expect(result.acceleratorState).toBe('cpu_only');
    expect(result.system.logicalCpuCount).toBe(16);
  });

  it('distinguishes a failed probe from a machine with no GPU', async () => {
    const director = new HardwareDirector({
      systemProbe: async () => SYSTEM,
      gpuProbe: async () => ({ status: 'timeout', vendor: 'none', devices: [], detail: 'timed out' }),
    });
    expect((await director.profile()).acceleratorState).toBe('gpu_probe_unavailable');
  });

  it('surfaces permission denial as its own state', async () => {
    const director = new HardwareDirector({
      systemProbe: async () => SYSTEM,
      gpuProbe: async () => ({ status: 'permission_denied', vendor: 'none', devices: [] }),
    });
    expect((await director.profile()).acceleratorState).toBe('gpu_permission_denied');
  });

  it('never throws when a probe explodes', async () => {
    const director = new HardwareDirector({
      systemProbe: async () => {
        throw new Error('boom');
      },
      gpuProbe: async () => {
        throw new Error('boom');
      },
    });
    const result = await director.profile();
    expect(result.system.os).toBe('unknown');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('downgrades to partial when devices report no VRAM', async () => {
    const director = new HardwareDirector({
      systemProbe: async () => SYSTEM,
      gpuProbe: async () => ({ status: 'ok', vendor: 'nvidia', devices: [{ index: 0, name: 'Mystery GPU' }] }),
    });
    const result = await director.profile();
    expect(result.gpu.status).toBe('partial');
    expect(result.warnings.join(' ')).toContain('none reported VRAM');
  });

  it('redacts GPU UUIDs before evidence is written', async () => {
    const gpu = (await probeNvidia({ run: runnerFor(SINGLE_GPU_CSV) })) as GpuProbeResult;
    expect(gpu.devices[0]?.uuid).toBe('GPU-abc-123');
    const redacted = redactHardwareProfile(profile(gpu));
    expect(redacted.gpu.devices[0]?.uuid).toBeUndefined();
    // Everything else survives.
    expect(redacted.gpu.devices[0]?.name).toBe('NVIDIA GeForce RTX 3090');
    expect(JSON.stringify(redacted)).not.toContain('GPU-abc-123');
  });
});

describe('model fit', () => {
  const gpu24 = (freeGib = 22): GpuProbeResult => ({
    status: 'ok',
    vendor: 'nvidia',
    devices: [{ index: 0, name: 'RTX 3090', totalVramBytes: 24 * GIB, freeVramBytes: freeGib * GIB }],
  });

  it('classifies a model that fits the largest GPU', () => {
    const result = assessFit(model({ artifactBytes: 9 * GIB }), profile(gpu24()));
    expect(result.classification).toBe('likely_gpu_fit');
    expect(result.confidence).toBe('high');
    expect(result.reasonCodes).toContain('FITS_LARGEST_GPU');
    // The estimate always states what it assumed.
    expect(result.assumptions.join(' ')).toContain('not a measured VRAM requirement');
  });

  it('classifies a model that will partially offload', () => {
    const result = assessFit(model({ artifactBytes: 40 * GIB }), profile(gpu24()));
    expect(result.classification).toBe('may_partially_offload');
    expect(result.reasonCodes).toContain('EXCEEDS_LARGEST_GPU');
    // Not fitting is explicitly not the same as not running.
    expect(result.assumptions.join(' ')).toContain('not a failure');
  });

  it('never sums VRAM across GPUs', () => {
    const dual: GpuProbeResult = {
      status: 'ok',
      vendor: 'nvidia',
      devices: [
        { index: 0, name: 'A', totalVramBytes: 24 * GIB, freeVramBytes: 24 * GIB },
        { index: 1, name: 'B', totalVramBytes: 24 * GIB, freeVramBytes: 24 * GIB },
      ],
    };
    // 40 GiB would "fit" only if the two cards were added together.
    const result = assessFit(model({ artifactBytes: 40 * GIB }), profile(dual));
    expect(result.classification).toBe('may_partially_offload');
    expect(result.reasonCodes).toContain('MULTI_GPU_NOT_SUMMED');
    expect(result.warnings.join(' ')).toContain('not summed across devices');
  });

  it('falls back to CPU-only when there is no GPU', () => {
    const result = assessFit(
      model(),
      profile({ status: 'unavailable', vendor: 'none', devices: [] }),
    );
    expect(result.classification).toBe('cpu_only_possible');
    expect(result.reasonCodes).toContain('NO_GPU_EVIDENCE');
  });

  it('returns insufficient_data when the artifact size is unknown', () => {
    const result = assessFit(model({ artifactBytes: undefined }), profile(gpu24()));
    expect(result.classification).toBe('insufficient_data');
    expect(result.confidence).toBe('none');
    expect(result.reasonCodes).toContain('NO_ARTIFACT_SIZE');
  });

  it('returns insufficient_data when the GPU probe was denied', () => {
    const result = assessFit(
      model(),
      profile({ status: 'permission_denied', vendor: 'none', devices: [] }),
    );
    expect(result.classification).toBe('insufficient_data');
    expect(result.reasonCodes).toContain('GPU_PERMISSION_DENIED');
  });

  it('warns about a large advertised context', () => {
    const result = assessFit(model({ contextTokens: 131_072 }), profile(gpu24()));
    expect(result.reasonCodes).toContain('LARGE_CONTEXT');
    expect(result.warnings.join(' ')).toContain('KV cache');
  });

  it('warns when little VRAM is currently free', () => {
    const result = assessFit(model({ artifactBytes: 2 * GIB }), profile(gpu24(4)));
    expect(result.reasonCodes).toContain('LOW_FREE_VRAM');
    expect(result.warnings.join(' ')).toContain('another process');
  });

  it('uses total VRAM but lowers confidence when free VRAM is unknown', () => {
    const noFree: GpuProbeResult = {
      status: 'ok',
      vendor: 'nvidia',
      devices: [{ index: 0, name: 'RTX 3090', totalVramBytes: 24 * GIB }],
    };
    const result = assessFit(model({ artifactBytes: 9 * GIB }), profile(noFree));
    expect(result.classification).toBe('likely_gpu_fit');
    expect(result.confidence).toBe('medium');
    expect(result.assumptions.join(' ')).toContain('optimistic');
  });

  it('always forbids a remote model regardless of fit', () => {
    const result = assessFit(
      model({ execution: 'remote_forbidden', artifactBytes: 1024, executionReason: 'remote_host set' }),
      profile(gpu24()),
    );
    expect(result.classification).toBe('remote_forbidden');
    expect(result.reasonCodes).toContain('MODEL_IS_REMOTE');
  });
});

describe('execution policy', () => {
  const decide = (assessmentFor: HardwareProfile, policy: ExecutionPolicy, m = model()) =>
    applyExecutionPolicy(assessFit(m, assessmentFor), policy);

  const fits = profile({
    status: 'ok',
    vendor: 'nvidia',
    devices: [{ index: 0, name: 'RTX 3090', totalVramBytes: 24 * GIB, freeVramBytes: 22 * GIB }],
  });
  const cpuOnly = profile({ status: 'unavailable', vendor: 'none', devices: [] });

  it('gpu_required allows a confirmed GPU fit', () => {
    expect(decide(fits, 'gpu_required').allowed).toBe(true);
  });

  it('gpu_required blocks CPU-only execution', () => {
    const decision = decide(cpuOnly, 'gpu_required');
    expect(decision.allowed).toBe(false);
    expect(decision.errorCode).toBe('MODEL_FIT_REJECTED');
  });

  it('gpu_required blocks when the evidence is insufficient', () => {
    const decision = applyExecutionPolicy(assessFit(model({ artifactBytes: undefined }), fits), 'gpu_required');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('not enough evidence');
  });

  it('gpu_preferred allows CPU execution', () => {
    expect(decide(cpuOnly, 'gpu_preferred').allowed).toBe(true);
  });

  it('cpu_allowed allows CPU execution and unknown evidence', () => {
    expect(decide(cpuOnly, 'cpu_allowed').allowed).toBe(true);
    expect(
      applyExecutionPolicy(assessFit(model({ artifactBytes: undefined }), cpuOnly), 'cpu_allowed').allowed,
    ).toBe(true);
  });

  it('blocks a remote model under every policy', () => {
    for (const policy of ['gpu_required', 'gpu_preferred', 'cpu_allowed'] as const) {
      const decision = decide(fits, policy, model({ execution: 'remote_forbidden' }));
      expect(decision.allowed).toBe(false);
      expect(decision.errorCode).toBe('REMOTE_INFERENCE_FORBIDDEN');
    }
  });
});
