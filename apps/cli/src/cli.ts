import {
  VERSION,
  type AuditEvent,
  type CapabilityEnvelope,
  type CreateProjectInput,
  type CreateTaskInput,
  type Project,
  type Task,
  type TaskResult,
} from '@intentsmith/contracts';
import { DomainError, normalizeError, type IntentSmithCore } from '@intentsmith/core';
import type { InferenceEvent, ModelDescriptor } from '@intentsmith/inference';

import {
  formatAssessment,
  formatHardware,
  formatModelDetail,
  formatModelList,
  formatRecovery,
  readStdin,
} from './inference-cli.js';

export type CliTransport = {
  health(): Promise<unknown>;
  version(): Promise<unknown>;
  createProject(input: CreateProjectInput): Promise<Project>;
  getProject(projectId: string): Promise<Project>;
  createTask(input: CreateTaskInput): Promise<Task>;
  getTask(taskId: string): Promise<Task>;
  startTask(taskId: string): Promise<Task>;
  pauseTask(taskId: string): Promise<Task>;
  resumeTask(taskId: string): Promise<Task>;
  cancelTask(taskId: string): Promise<Task>;
  getTaskResult(taskId: string): Promise<TaskResult | null>;
  listAuditEvents(taskId: string): Promise<AuditEvent[]>;
  inferenceHealth?(): Promise<unknown>;
  listModels?(): Promise<{ models: ModelDescriptor[] }>;
  describeModel?(modelId: string): Promise<ModelDescriptor>;
  assessModel?(modelId: string, policy?: string): Promise<unknown>;
  hardware?(): Promise<unknown>;
  recovery?(): Promise<unknown>;
  generate?(
    body: { modelId: string; prompt: string; system?: string; maxOutputTokens?: number; stream?: boolean },
    signal: AbortSignal,
  ): AsyncIterable<InferenceEvent>;
};

export type CliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CliIo = {
  /** Stdin source for prompts; keeps them out of shell history. */
  stdin?: AsyncIterable<Uint8Array> | NodeJS.ReadableStream;
  /** Called for each chunk of streamed output. */
  onStreamChunk?: (chunk: string) => void;
  signal?: AbortSignal;
};

export async function runCli(argv: string[], transport: CliTransport, io: CliIo = {}): Promise<CliResult> {
  const args = [...argv];
  const json = consumeFlag(args, '--json');

  try {
    const [scope, action] = args;
    let result: unknown;

    if (scope === 'inference' || scope === 'hardware' || scope === 'runtime') {
      return await runInferenceCommand(scope, action, args, json, transport, io);
    }

    if (scope === 'version') result = await transport.version();
    else if (scope === 'health') result = await transport.health();
    else if (scope === 'project' && action === 'create') {
      result = await transport.createProject({
        name: requireOption(args, '--name'),
        rootPath: requireOption(args, '--root'),
        trustState: readOption(args, '--trust') === 'trusted' ? 'trusted' : 'untrusted',
      });
    } else if (scope === 'task' && action === 'create') {
      const projectId = requireOption(args, '--project-id');
      const project = await transport.getProject(projectId);
      result = await transport.createTask({
        projectId,
        type: (readOption(args, '--type') ?? 'code') as CreateTaskInput['type'],
        goal: requireOption(args, '--goal'),
        scope: envelopeFromCli(project.rootPath, readOption(args, '--root')),
        expectedOutputs: [readOption(args, '--output') ?? 'Deterministic task output'],
        acceptanceCriteria: [readOption(args, '--acceptance') ?? 'Deterministic evidence passes'],
        workerScenario: (readOption(args, '--scenario') ?? 'success') as CreateTaskInput['workerScenario'],
        timeoutMs: Number(readOption(args, '--timeout-ms') ?? 1000),
      });
    } else if (scope === 'task' && action === 'show') result = await transport.getTask(requireOption(args, '--task-id'));
    else if (scope === 'task' && action === 'start') result = await transport.startTask(requireOption(args, '--task-id'));
    else if (scope === 'task' && action === 'pause') result = await transport.pauseTask(requireOption(args, '--task-id'));
    else if (scope === 'task' && action === 'resume') result = await transport.resumeTask(requireOption(args, '--task-id'));
    else if (scope === 'task' && action === 'cancel') result = await transport.cancelTask(requireOption(args, '--task-id'));
    else if (scope === 'task' && action === 'result') {
      const taskId = requireOption(args, '--task-id');
      result = await transport.getTaskResult(taskId);
      if (!result) throw new DomainError('TASK_RESULT_NOT_FOUND', `Task result not found: ${taskId}`);
    } else if (scope === 'task' && action === 'audit') {
      result = { events: await transport.listAuditEvents(requireOption(args, '--task-id')) };
    } else {
      throw new DomainError('CLI_USAGE_ERROR', 'Unknown or incomplete command.');
    }

    return {
      exitCode: 0,
      stdout: json ? `${JSON.stringify(result, null, 2)}\n` : `${formatText(scope ?? '', action, result)}\n`,
      stderr: '',
    };
  } catch (error) {
    const normalized = normalizeError(error);
    return {
      exitCode: 1,
      stdout: json ? `${JSON.stringify({ error: normalized }, null, 2)}\n` : '',
      stderr: json ? '' : `${normalized.code}: ${normalized.message}\n`,
    };
  }
}


/** Requires an optional transport capability, or fails with a stable code. */
function require$<T>(value: T | undefined, name: string): T {
  if (!value) throw new DomainError('CLI_UNSUPPORTED', `This transport does not support ${name}.`);
  return value;
}

/**
 * Handles `inference`, `hardware` and `runtime` commands.
 *
 * Generation streams to `onStreamChunk` as it arrives; the returned stdout is
 * the machine-readable summary. The prompt is read from stdin by default so it
 * never lands in shell history.
 */
async function runInferenceCommand(
  scope: string,
  action: string | undefined,
  args: string[],
  json: boolean,
  transport: CliTransport,
  io: CliIo,
): Promise<CliResult> {
  const ok = (result: unknown, text: string): CliResult => ({
    exitCode: 0,
    stdout: json ? `${JSON.stringify(result, null, 2)}\n` : `${text}\n`,
    stderr: '',
  });

  if (scope === 'hardware' && (action === 'show' || action === undefined)) {
    const payload = await require$(transport.hardware, 'hardware inspection')();
    return ok(payload, formatHardware(payload));
  }
  if (scope === 'runtime' && action === 'recovery') {
    const payload = await require$(transport.recovery, 'recovery status')();
    return ok(payload, formatRecovery(payload));
  }

  if (scope === 'inference' && action === 'health') {
    const payload = await require$(transport.inferenceHealth, 'provider health')();
    const status = (payload as { status?: string }).status ?? 'unknown';
    const detail = (payload as { detail?: string }).detail;
    return ok(payload, `provider: ${status}${detail ? ` (${detail})` : ''}`);
  }
  if (scope === 'inference' && action === 'models') {
    const payload = await require$(transport.listModels, 'model listing')();
    return ok(payload, formatModelList(payload.models));
  }
  if (scope === 'inference' && action === 'model') {
    const modelId = requireOption(args, '--model') ?? args[2];
    if (!modelId) throw new DomainError('CLI_USAGE_ERROR', 'Missing model id.');
    const payload = await require$(transport.describeModel, 'model details')(modelId);
    return ok(payload, formatModelDetail(payload));
  }
  if (scope === 'inference' && action === 'assess') {
    const modelId = readOption(args, '--model') ?? args[2];
    if (!modelId) throw new DomainError('CLI_USAGE_ERROR', 'Missing model id.');
    const payload = await require$(transport.assessModel, 'model assessment')(
      modelId,
      readOption(args, '--policy'),
    );
    return ok(payload, formatAssessment(payload));
  }

  if (scope === 'inference' && action === 'generate') {
    const modelId = requireOption(args, '--model');
    const inlinePrompt = readOption(args, '--prompt');
    // stdin is the default so prompts stay out of shell history.
    const prompt = inlinePrompt ?? (io.stdin ? (await readStdin(io.stdin)).trim() : '');
    if (!prompt) {
      throw new DomainError(
        'CLI_USAGE_ERROR',
        'A prompt is required. Pipe it on stdin (preferred, keeps it out of shell history) or pass --prompt.',
      );
    }
    const maxRaw = readOption(args, '--max-tokens');
    const maxOutputTokens = maxRaw === undefined ? undefined : Number(maxRaw);
    if (maxOutputTokens !== undefined && (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1)) {
      throw new DomainError('CLI_USAGE_ERROR', '--max-tokens must be a positive integer.');
    }

    const generate = require$(transport.generate, 'generation');
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    io.signal?.addEventListener('abort', onAbort, { once: true });

    const events: InferenceEvent[] = [];
    let text = '';
    let failure: { code: string; message: string } | undefined;
    try {
      for await (const event of generate(
        {
          modelId,
          prompt,
          ...(readOption(args, '--system') === undefined ? {} : { system: readOption(args, '--system') as string }),
          ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
          stream: true,
        },
        controller.signal,
      )) {
        events.push(event);
        if (event.type === 'token') {
          text += event.text;
          // NDJSON in --json mode, plain text otherwise.
          io.onStreamChunk?.(json ? `${JSON.stringify(event)}\n` : event.text);
        } else if (event.type === 'completed') {
          if (text.length === 0) text = event.text;
          if (json) io.onStreamChunk?.(`${JSON.stringify(event)}\n`);
        } else if (event.type === 'failed') {
          failure = { code: event.error.code, message: event.error.message };
          if (json) io.onStreamChunk?.(`${JSON.stringify(event)}\n`);
        }
      }
    } finally {
      io.signal?.removeEventListener('abort', onAbort);
    }

    if (failure) {
      return {
        exitCode: 1,
        stdout: json ? `${JSON.stringify({ error: { ...failure, retryable: false } }, null, 2)}\n` : '',
        stderr: json ? '' : `${failure.code}: ${failure.message}\n`,
      };
    }
    return {
      exitCode: 0,
      stdout: json ? `${JSON.stringify({ modelId, events }, null, 2)}\n` : `${text}\n`,
      stderr: '',
    };
  }

  throw new DomainError('CLI_USAGE_ERROR', 'Unknown or incomplete command.');
}

export function createCoreTransport(core: IntentSmithCore): CliTransport {
  return {
    health: async () => ({ status: 'ok', service: 'intentsmith-core' }),
    version: async () => ({ version: VERSION, cli: 'intentsmith', package: 'intentsmith-core' }),
    createProject: input => core.createProject(input),
    getProject: projectId => core.getProject(projectId),
    createTask: input => core.createTask(input),
    getTask: taskId => core.getTask(taskId),
    startTask: taskId => core.startTask(taskId),
    pauseTask: taskId => core.pauseTask(taskId),
    resumeTask: taskId => core.resumeTask(taskId),
    cancelTask: taskId => core.cancelTask(taskId),
    getTaskResult: taskId => core.getTaskResult(taskId),
    listAuditEvents: taskId => core.listAuditEvents(taskId),
  };
}

export function createHttpTransport(baseUrl = 'http://127.0.0.1:47831', timeoutMs = 10_000): CliTransport {
  const request = async <T>(method: string, pathname: string, body?: unknown): Promise<T> => {
    // Transport failures must map onto stable CLI error codes instead of
    // collapsing into a generic INTERNAL_ERROR.
    let response: Response;
    try {
      response = await fetch(new URL(pathname, baseUrl), {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new DomainError('SERVER_TIMEOUT', `Request to ${baseUrl} timed out`, true);
      }
      throw new DomainError('SERVER_UNAVAILABLE', `IntentSmith server is not reachable at ${baseUrl}`, true);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new DomainError('INVALID_SERVER_RESPONSE', 'Server returned a response that is not valid JSON.');
    }

    if (!response.ok) {
      const error = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
      throw new DomainError(
        typeof error.code === 'string' ? error.code : 'HTTP_REQUEST_FAILED',
        typeof error.message === 'string' ? error.message : `HTTP request failed with status ${response.status}`,
        error.retryable === true,
      );
    }
    return payload as T;
  };

  return {
    health: () => request('GET', '/health'),
    version: () => request('GET', '/version'),
    createProject: input => request('POST', '/projects', input),
    getProject: projectId => request('GET', `/projects/${encodeURIComponent(projectId)}`),
    createTask: input => request('POST', '/tasks', input),
    getTask: taskId => request('GET', `/tasks/${encodeURIComponent(taskId)}`),
    startTask: taskId => request('POST', `/tasks/${encodeURIComponent(taskId)}/start`),
    pauseTask: taskId => request('POST', `/tasks/${encodeURIComponent(taskId)}/pause`),
    resumeTask: taskId => request('POST', `/tasks/${encodeURIComponent(taskId)}/resume`),
    cancelTask: taskId => request('POST', `/tasks/${encodeURIComponent(taskId)}/cancel`),
    getTaskResult: taskId => request('GET', `/tasks/${encodeURIComponent(taskId)}/result`),
    listAuditEvents: async taskId => {
      const payload = await request<{ events: AuditEvent[] }>('GET', `/tasks/${encodeURIComponent(taskId)}/audit`);
      return payload.events;
    },
    inferenceHealth: () => request('GET', '/inference/providers/ollama/health'),
    listModels: () => request('GET', '/inference/models'),
    describeModel: modelId => request('GET', `/inference/models/${encodeURIComponent(modelId)}`),
    assessModel: (modelId, policy) =>
      request('POST', `/inference/models/${encodeURIComponent(modelId)}/assess`, policy ? { executionPolicy: policy } : {}),
    hardware: () => request('GET', '/hardware'),
    recovery: () => request('GET', '/runtime/recovery'),
    generate: (body, signal) => streamNdjson(baseUrl, body, signal),
  };
}

/**
 * Streams `/inference/generate` and yields one normalized event per line.
 *
 * An error before the stream begins arrives as a JSON error envelope with a
 * real status code; after it begins, as a terminal `failed` event.
 */
async function* streamNdjson(
  baseUrl: string,
  body: unknown,
  signal: AbortSignal,
): AsyncIterable<InferenceEvent> {
  let response: Response;
  try {
    response = await fetch(new URL('/inference/generate', baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new DomainError('REQUEST_CANCELLED', 'Generation was cancelled.');
    }
    throw new DomainError('SERVER_UNAVAILABLE', `IntentSmith server is not reachable at ${baseUrl}`, true);
  }

  if (!response.ok) {
    let code = 'HTTP_REQUEST_FAILED';
    let message = `HTTP request failed with status ${response.status}`;
    try {
      const payload = (await response.json()) as { error?: { code?: string; message?: string } };
      if (payload.error?.code) code = payload.error.code;
      if (payload.error?.message) message = payload.error.message;
    } catch {
      // Non-JSON error body; keep the generic message.
    }
    throw new DomainError(code, message);
  }

  const stream = response.body;
  if (!stream) return;
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield JSON.parse(line) as InferenceEvent;
      newline = buffer.indexOf('\n');
    }
  }
  const tail = buffer.trim();
  if (tail) yield JSON.parse(tail) as InferenceEvent;
}

function envelopeFromCli(projectRoot: string, requestedRoot?: string): CapabilityEnvelope {
  const root = requestedRoot ?? projectRoot;
  return {
    fsReadRoots: [root],
    fsWriteRoots: [root],
    allowedCommandFamilies: [],
    deniedCommandPatterns: ['rm -rf', 'curl', 'wget'],
    network: { mode: 'disabled', allowlist: [] },
    envAllowlist: ['PATH'],
    secrets: 'none',
    processSpawning: 'disabled',
    timeoutMs: 1000,
    maxActions: 0,
    approvalRules: [],
  };
}

function formatText(scope: string, action: string | undefined, result: unknown): string {
  if (scope === 'version' && isRecord(result)) return `IntentSmith ${String(result.version)}`;
  if (scope === 'health' && isRecord(result)) return `health: ${String(result.status)}`;
  if (isRecord(result) && typeof result.id === 'string') return `${action ?? scope}: ${result.id}`;
  if (isRecord(result) && Array.isArray(result.events)) return `audit events: ${result.events.length}`;
  return JSON.stringify(result);
}

function consumeFlag(args: string[], flag: string): boolean {
  const index = args.indexOf(flag);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function requireOption(args: string[], name: string): string {
  const value = readOption(args, name);
  if (!value) throw new DomainError('CLI_USAGE_ERROR', `Missing required option ${name}`);
  return value;
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
