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
};

export type CliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export async function runCli(argv: string[], transport: CliTransport): Promise<CliResult> {
  const args = [...argv];
  const json = consumeFlag(args, '--json');

  try {
    const [scope, action] = args;
    let result: unknown;

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

export function createHttpTransport(baseUrl = 'http://127.0.0.1:47831'): CliTransport {
  const request = async <T>(method: string, pathname: string, body?: unknown): Promise<T> => {
    const response = await fetch(new URL(pathname, baseUrl), {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json() as unknown;
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
  };
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
