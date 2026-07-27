import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';

import { DomainError } from '@intentsmith/core';
import type { InferenceEvent, ModelDescriptor } from '@intentsmith/inference';
import { DisposableWorkspace, createTestRuntime, type TestRuntime } from '@intentsmith/testing';

import { createCoreTransport, runCli, type CliTransport } from './cli.js';
import { formatAssessment, formatHardware, formatModelDetail, formatModelList, readStdin } from './inference-cli.js';

/** Inference CLI tests. Nothing here contacts a server or Ollama. */

const runtimes: TestRuntime[] = [];
const workspaces: DisposableWorkspace[] = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    await runtime.core.shutdown();
    runtime.cleanup();
  }
  for (const workspace of workspaces.splice(0)) workspace.cleanup();
});

const LOCAL_MODEL: ModelDescriptor = {
  id: 'qwen3:14b',
  family: 'qwen3',
  parameterBillions: 14.8,
  parameterSizeLabel: '14.8B',
  quantization: 'Q4_K_M',
  contextTokens: 40_960,
  artifactBytes: 9_276_198_565,
  digest: 'bdbd181c',
  capabilities: ['completion'],
  execution: 'local',
};

const REMOTE_MODEL: ModelDescriptor = {
  id: 'frontier:latest',
  family: 'unknown',
  execution: 'remote_forbidden',
  executionReason: 'Provider reported remote execution metadata (remote_host).',
};

function baseTransport(): CliTransport {
  const runtime = createTestRuntime();
  runtimes.push(runtime);
  const workspace = new DisposableWorkspace();
  workspaces.push(workspace);
  return createCoreTransport(runtime.core);
}

function inferenceTransport(overrides: Partial<CliTransport> = {}): CliTransport {
  return {
    ...baseTransport(),
    inferenceHealth: async () => ({ status: 'healthy', detail: 'Ollama 0.17.7' }),
    listModels: async () => ({ models: [LOCAL_MODEL, REMOTE_MODEL] }),
    describeModel: async () => LOCAL_MODEL,
    assessModel: async (_id, policy) => ({
      model: LOCAL_MODEL,
      decision: {
        allowed: true,
        policy: policy ?? 'cpu_allowed',
        assessment: {
          classification: 'likely_gpu_fit',
          confidence: 'high',
          assumptions: ['Artifact size is evidence, not a measured VRAM requirement.'],
          warnings: [],
          reasonCodes: ['FITS_LARGEST_GPU'],
        },
      },
    }),
    hardware: async () => ({
      system: { os: 'linux', arch: 'x64', logicalCpuCount: 24, totalRamBytes: 33_474_011_136 },
      gpu: { status: 'ok', vendor: 'nvidia', devices: [{ index: 0, name: 'RTX 3090', totalVramBytes: 25_769_803_776 }] },
      acceleratorState: 'nvidia_available',
      warnings: [],
    }),
    recovery: async () => ({
      status: 'completed',
      recoveredRunCount: 2,
      affectedTaskIds: ['task_a', 'task_b'],
      completedAt: '2026-07-28T00:00:00.000Z',
    }),
    generate: async function* (): AsyncIterable<InferenceEvent> {
      yield { type: 'started', modelId: 'qwen3:14b' };
      yield { type: 'token', text: 'Hello' };
      yield { type: 'token', text: ' world' };
      yield { type: 'completed', text: 'Hello world', usage: { promptTokens: 3, completionTokens: 2 } };
    },
    ...overrides,
  };
}

const stdinOf = (text: string) => Readable.from([Buffer.from(text)]);

describe('formatters', () => {
  it('marks a remote model as blocked in the listing', () => {
    const text = formatModelList([LOCAL_MODEL, REMOTE_MODEL]);
    expect(text).toContain('qwen3:14b');
    expect(text).toContain('[REMOTE - BLOCKED]');
  });

  it('explains an empty model list', () => {
    expect(formatModelList([])).toContain('ollama pull');
  });

  it('shows unknown rather than a fabricated value', () => {
    const detail = formatModelDetail({ id: 'x', family: 'y', execution: 'unknown' });
    expect(detail).toContain('parameters:    unknown');
    expect(detail).toContain('artifact size: unknown');
  });

  it('renders the assessment with its assumptions', () => {
    const text = formatAssessment({
      model: { id: 'qwen3:14b' },
      decision: {
        allowed: false,
        policy: 'gpu_required',
        reason: 'not enough evidence',
        assessment: { classification: 'insufficient_data', confidence: 'none', assumptions: ['a'], warnings: ['w'], reasonCodes: ['C'] },
      },
    });
    expect(text).toContain('allowed:        no');
    expect(text).toContain('assumption:     a');
    expect(text).toContain('warning:        w');
  });

  it('renders a hardware profile', () => {
    const text = formatHardware({
      system: { os: 'linux', arch: 'x64', logicalCpuCount: 8 },
      gpu: { status: 'ok', devices: [{ index: 0, name: 'RTX 3090', totalVramBytes: 24 * 1024 ** 3 }] },
      acceleratorState: 'nvidia_available',
      warnings: ['w'],
    });
    expect(text).toContain('RTX 3090');
    expect(text).toContain('24.0 GiB');
    expect(text).toContain('warning:     w');
  });

  it('reads stdin', async () => {
    expect(await readStdin(stdinOf('piped prompt'))).toBe('piped prompt');
  });
});

describe('inference commands', () => {
  it('reports provider health', async () => {
    const result = await runCli(['inference', 'health'], inferenceTransport());
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('healthy');
  });

  it('lists models and flags the remote one', async () => {
    const result = await runCli(['inference', 'models'], inferenceTransport());
    expect(result.stdout).toContain('[REMOTE - BLOCKED]');
  });

  it('emits JSON without ANSI in --json mode', async () => {
    const result = await runCli(['inference', 'models', '--json'], inferenceTransport());
    expect(() => JSON.parse(result.stdout)).not.toThrow();
    expect(result.stdout).not.toMatch(new RegExp(`${String.fromCharCode(27)}\\[`));
  });

  it('shows model detail and assessment', async () => {
    expect((await runCli(['inference', 'model', '--model', 'qwen3:14b'], inferenceTransport())).stdout).toContain(
      'qwen3:14b',
    );
    const assess = await runCli(['inference', 'assess', '--model', 'qwen3:14b', '--policy', 'gpu_required'], inferenceTransport());
    expect(assess.stdout).toContain('gpu_required');
  });

  it('shows hardware and recovery', async () => {
    expect((await runCli(['hardware', 'show'], inferenceTransport())).stdout).toContain('RTX 3090');
    const recovery = await runCli(['runtime', 'recovery'], inferenceTransport());
    expect(recovery.stdout).toContain('recovered: 2 run(s)');
    expect(recovery.stdout).toContain('not restarted');
  });
});

describe('generation', () => {
  it('reads the prompt from stdin and streams plain text', async () => {
    const chunks: string[] = [];
    const result = await runCli(['inference', 'generate', '--model', 'qwen3:14b'], inferenceTransport(), {
      stdin: stdinOf('what is 2+2?'),
      onStreamChunk: chunk => chunks.push(chunk),
    });
    expect(result.exitCode).toBe(0);
    expect(chunks.join('')).toBe('Hello world');
    expect(result.stdout.trim()).toBe('Hello world');
  });

  it('streams NDJSON in --json mode', async () => {
    const chunks: string[] = [];
    await runCli(['inference', 'generate', '--model', 'qwen3:14b', '--json'], inferenceTransport(), {
      stdin: stdinOf('hi'),
      onStreamChunk: chunk => chunks.push(chunk),
    });
    const lines = chunks.join('').trim().split('\n');
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
    expect(lines.some(line => JSON.parse(line).type === 'completed')).toBe(true);
  });

  it('accepts an inline prompt as the less private option', async () => {
    const result = await runCli(
      ['inference', 'generate', '--model', 'qwen3:14b', '--prompt', 'inline'],
      inferenceTransport(),
    );
    expect(result.exitCode).toBe(0);
  });

  it('requires a prompt and says how to supply it privately', async () => {
    const result = await runCli(['inference', 'generate', '--model', 'qwen3:14b'], inferenceTransport());
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('stdin');
    expect(result.stderr).toContain('shell history');
  });

  it('rejects a non-integer token budget', async () => {
    const result = await runCli(
      ['inference', 'generate', '--model', 'qwen3:14b', '--prompt', 'x', '--max-tokens', 'lots'],
      inferenceTransport(),
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('positive integer');
  });

  it('surfaces a terminal failure with a stable code and non-zero exit', async () => {
    const failing = inferenceTransport({
      generate: async function* (): AsyncIterable<InferenceEvent> {
        yield { type: 'started', modelId: 'x' };
        yield {
          type: 'failed',
          error: { code: 'REMOTE_INFERENCE_FORBIDDEN', message: 'refused', retryable: false },
        };
      },
    });
    const result = await runCli(['inference', 'generate', '--model', 'x', '--prompt', 'p', '--json'], failing);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).error.code).toBe('REMOTE_INFERENCE_FORBIDDEN');
  });

  it('propagates cancellation to the transport', async () => {
    let sawAbort = false;
    const controller = new AbortController();
    const cancelling = inferenceTransport({
      generate: async function* (_body, signal): AsyncIterable<InferenceEvent> {
        yield { type: 'started', modelId: 'x' };
        controller.abort();
        await new Promise(resolve => setTimeout(resolve, 1));
        sawAbort = signal.aborted;
        yield { type: 'failed', error: { code: 'REQUEST_CANCELLED', message: 'cancelled', retryable: false } };
      },
    });
    const result = await runCli(['inference', 'generate', '--model', 'x', '--prompt', 'p'], cancelling, {
      signal: controller.signal,
    });
    expect(sawAbort).toBe(true);
    expect(result.exitCode).toBe(1);
  });

  it('fails with a stable code when the transport lacks inference support', async () => {
    const result = await runCli(['inference', 'models', '--json'], baseTransport());
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).error.code).toBe('CLI_UNSUPPORTED');
  });

  it('reports an unreachable server through the inference path', async () => {
    const failing = inferenceTransport({
      listModels: async () => {
        throw new DomainError('SERVER_UNAVAILABLE', 'not reachable', true);
      },
    });
    const result = await runCli(['inference', 'models', '--json'], failing);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).error.code).toBe('SERVER_UNAVAILABLE');
  });

  it('rejects an unknown inference subcommand', async () => {
    const result = await runCli(['inference', 'teleport'], inferenceTransport());
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('CLI_USAGE_ERROR');
  });
});
