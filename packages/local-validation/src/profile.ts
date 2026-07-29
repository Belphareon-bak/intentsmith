import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { ModelProfile, StructuredReason } from './types.js';

const exec = promisify(execFile);

export const RTX_3090_QWEN3_PROFILE: ModelProfile = {
  id: 'rtx3090-opencode-1.18.8-qwen3-14b',
  opencodeVersion: '1.18.8',
  provider: 'ollama',
  model: 'qwen3:14b',
  gpu: 'NVIDIA GeForce RTX 3090',
  concurrency: 1,
  strictOfflineProven: false,
};

export type ProfileProbe = {
  available: boolean;
  idle: boolean;
  reason?: StructuredReason;
  observed: {
    opencode?: string;
    opencodePath?: string;
    ollama?: string;
    models: string[];
    gpu?: string;
    driver?: string;
    gpuProcesses: string[];
  };
};

export type ProbeCommand = (program: string, args: string[]) => Promise<string | undefined>;

async function command(program: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout, stderr } = await exec(program, args, { encoding: 'utf8', timeout: 10_000 });
    return `${stdout}${stderr}`.trim();
  } catch {
    return undefined;
  }
}

function blocked(code: string, message: string, observed: ProfileProbe['observed']): ProfileProbe {
  return { available: false, idle: false, reason: { code, message, kind: 'blocked' }, observed };
}

export async function probeLocalGpuProfile(
  profile: ModelProfile = RTX_3090_QWEN3_PROFILE,
  options: { ollamaBaseUrl?: string; opencodeBin?: string; runCommand?: ProbeCommand; fetchFn?: typeof fetch } = {},
): Promise<ProfileProbe> {
  const runCommand = options.runCommand ?? command;
  const fetchFn = options.fetchFn ?? fetch;
  const observed: ProfileProbe['observed'] = { models: [], gpuProcesses: [] };
  const opencodeBin = options.opencodeBin ?? 'opencode';
  observed.opencodePath = opencodeBin;
  const opencode = await runCommand(opencodeBin, ['--version']);
  observed.opencode = opencode;
  if (!opencode) return blocked('OPENCODE_MISSING', 'The pinned OpenCode binary is not available.', observed);
  if (!new RegExp(`\\b${profile.opencodeVersion.replaceAll('.', '\\.')}\\b`).test(opencode)) {
    return blocked('OPENCODE_VERSION_MISMATCH', `Expected OpenCode ${profile.opencodeVersion}; observed ${opencode}.`, observed);
  }

  const gpu = await runCommand('nvidia-smi', [
    '--query-gpu=name,driver_version,utilization.gpu,memory.used',
    '--format=csv,noheader,nounits',
  ]);
  if (!gpu) return blocked('GPU_MISSING', 'nvidia-smi did not report the required GPU.', observed);
  const [gpuName = '', driver = '', utilization = '', memory = ''] = gpu.split('\n')[0]?.split(/\s*,\s*/) ?? [];
  observed.gpu = gpuName;
  observed.driver = driver;
  if (gpuName !== profile.gpu) return blocked('GPU_MISMATCH', `Expected ${profile.gpu}; observed ${gpuName}.`, observed);
  observed.gpuProcesses =
    (await runCommand('nvidia-smi', ['--query-compute-apps=pid,process_name,used_memory', '--format=csv,noheader,nounits']))
      ?.split('\n')
      .filter(Boolean) ?? [];

  const baseUrl = options.ollamaBaseUrl ?? 'http://127.0.0.1:11434';
  let response: Response;
  try {
    response = await fetchFn(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5_000) });
  } catch {
    return blocked('OLLAMA_MISSING', 'The local Ollama endpoint is unavailable.', observed);
  }
  if (!response.ok) return blocked('OLLAMA_MISSING', `Ollama returned HTTP ${response.status}.`, observed);
  const body = (await response.json()) as { models?: Array<{ name?: string }> };
  observed.ollama = response.headers.get('server') ?? 'local endpoint';
  observed.models = (body.models ?? []).flatMap(model => (model.name ? [model.name] : []));
  if (!observed.models.includes(profile.model)) {
    return blocked('MODEL_MISSING', `Ollama does not report ${profile.model}.`, observed);
  }

  const idle = observed.gpuProcesses.length === 0 && Number(utilization) <= 5 && Number(memory) <= 1024;
  if (!idle) return blocked('GPU_BUSY', 'The GPU is not idle; no validation process was started or disturbed.', observed);
  return { available: true, idle: true, observed };
}
