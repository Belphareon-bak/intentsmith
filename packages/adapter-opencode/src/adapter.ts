import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  SupervisedProcess,
  assertNoLeakedCredentials,
  buildIsolatedEnv,
  planSandbox,
  type ProcessLimits,
  type SandboxProbe,
  type SandboxStatus,
} from '@intentsmith/process-runtime';
import {
  UNKNOWN_CAPABILITY,
  type WorkerAdapter,
  type WorkerCapability,
  type WorkerDescriptor,
  type WorkerExecutionContext,
  type WorkerExecutionResult,
  type WorkerHandle,
} from '@intentsmith/worker-sdk';

import { ACP_PROTOCOL_VERSION, AcpClient, AcpProtocolError, LineBuffer } from './acp.js';
import {
  GATEWAY_TOKEN_ENV,
  assertConfigHasNoDirectInference,
  buildOpenCodeConfig,
  createOpenCodeRuntime,
} from './runtime-config.js';

/**
 * OpenCode worker adapter.
 *
 * Core keeps every authority that matters. This adapter starts a process,
 * translates ACP into normalized worker events, and asks Core whatever it is
 * not allowed to decide. It never touches Task or TaskRun state, never reaches
 * persistence, and never decides a verdict.
 */

/** Decision Core returns for a permission request. */
export type PermissionDecision = {
  allowed: boolean;
  /** Option id to send back to the agent. */
  optionId?: string;
  reason?: string;
};

export type ToolProposal = {
  toolCallId: string;
  title: string;
  kind: string;
  /** Paths the tool wants to touch, as the agent reported them. */
  paths: string[];
  options: Array<{ optionId: string; name: string; kind: string }>;
};

export type OpenCodeAdapterOptions = {
  /** Resolved executable. Never a command string. */
  executable: string;
  /** Fixed arguments; `acp` is appended by the adapter. */
  args?: readonly string[];
  /** Version the operator pinned, for the mismatch check. */
  expectedVersion?: string;
  limits?: Partial<ProcessLimits>;
  sandboxProbe?: SandboxProbe;
  preferSandbox?: boolean;
  /**
   * Core's approval authority. The adapter never decides; a missing handler
   * denies, because silence must not mean permission.
   */
  onPermissionRequest?: (proposal: ToolProposal) => Promise<PermissionDecision>;
  schedule?: (fn: () => void, ms: number) => () => void;
  /** Injected for tests; defaults to a real temp directory. */
  makeRuntimeRoot?: () => string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class OpenCodeWorker implements WorkerAdapter {
  private discovered: WorkerDescriptor['detailed'] | undefined;
  private lastSandbox: SandboxStatus | undefined;

  constructor(private readonly options: OpenCodeAdapterOptions) {}

  /**
   * Static description.
   *
   * Everything runtime-discovered stays absent until a session has actually
   * negotiated it. A capability the ACP schema defines is not a capability this
   * build has.
   */
  describe(): WorkerDescriptor {
    return {
      id: 'opencode',
      version: this.options.expectedVersion ?? 'unpinned',
      capabilities: { pause: false, cancel: true },
      detailed: this.discovered ?? {
        protocolVersion: undefined,
        limitations: [
          'Capabilities are unknown until a session is initialized; nothing is assumed from the ACP schema.',
          'ACP has no pause primitive, so pause is reported as unavailable rather than emulated.',
        ],
      },
    };
  }

  /** Sandbox status of the most recent run, for evidence. */
  get sandboxStatus(): SandboxStatus | undefined {
    return this.lastSandbox;
  }

  start(context: WorkerExecutionContext): WorkerHandle {
    const events: unknown[] = [];
    let settle: (result: WorkerExecutionResult) => void;
    const done = new Promise<WorkerExecutionResult>(resolve => {
      settle = resolve;
    });

    const session = new OpenCodeSession(this.options, context, events, status => {
      this.lastSandbox = status;
    }, detailed => {
      this.discovered = detailed;
    });

    void session.run().then(
      () => settle({ events }),
      error => {
        events.push({
          type: 'failed',
          error: {
            code: normalizeFailureCode(error),
            message: describeFailure(error),
            retryable: false,
          },
        });
        settle({ events });
      },
    );

    return {
      done,
      pause: async () => {
        // ACP has no pause. Emulating it by stalling the stream would be a lie
        // about what the worker is doing, so it is refused honestly.
        throw new Error('OpenCode does not support pause; cancel and start a new run instead.');
      },
      resume: async () => {
        throw new Error('OpenCode does not support resume.');
      },
      cancel: () => session.cancel(),
    };
  }
}

/** One OpenCode run: process, ACP session, and cleanup. */
class OpenCodeSession {
  private process: SupervisedProcess | undefined;
  private client: AcpClient | undefined;
  private runtimeCleanup: (() => void) | undefined;
  private cancelled = false;
  private terminalSeen = false;

  constructor(
    private readonly options: OpenCodeAdapterOptions,
    private readonly context: WorkerExecutionContext,
    private readonly events: unknown[],
    private readonly reportSandbox: (status: SandboxStatus) => void,
    private readonly reportCapabilities: (detailed: WorkerDescriptor['detailed']) => void,
  ) {}

  async run(): Promise<void> {
    const workspaceRoot = this.context.workspaceRoot;
    if (!workspaceRoot) {
      throw new Error('OpenCode requires a disposable workspace root; refusing to run without one.');
    }

    const runtimeRoot = (this.options.makeRuntimeRoot ?? defaultRuntimeRoot)();
    const grant = this.context.inference;

    // The worker gets an inference route only through the gateway.
    const runtime = grant
      ? createOpenCodeRuntime({ runtimeRoot, grant })
      : { runtimeRoot, configPath: '', providedEnv: {}, cleanup: () => undefined };
    this.runtimeCleanup = runtime.cleanup;

    if (grant) {
      assertConfigHasNoDirectInference(buildOpenCodeConfig(grant), grant.baseUrl);
    }

    const provided: Record<string, string> = { ...runtime.providedEnv };
    if (grant) {
      provided.INTENTSMITH_GATEWAY_URL = grant.baseUrl;
      provided.INTENTSMITH_MODEL_ID = grant.modelId;
    }

    const env = buildIsolatedEnv({ runtimeRoot, provided });
    // The gateway token is the only secret this process may hold.
    assertNoLeakedCredentials(env, [GATEWAY_TOKEN_ENV]);

    const plan = await planSandbox({
      request: {
        workspaceRoot,
        readOnlyPaths: [],
        executable: this.options.executable,
        args: [...(this.options.args ?? []), 'acp'],
      },
      runtimeRoot,
      ...(this.options.preferSandbox === undefined ? {} : { preferSandbox: this.options.preferSandbox }),
      ...(this.options.sandboxProbe ? { probe: this.options.sandboxProbe } : {}),
    });
    this.reportSandbox(plan.status);
    this.events.push({ type: 'artifact', artifact: sandboxArtifact(plan.status) });

    const child = new SupervisedProcess({
      executable: plan.executable,
      args: plan.args,
      cwd: workspaceRoot,
      env,
      ...(this.options.limits ? { limits: this.options.limits } : {}),
      ...(this.options.schedule ? { schedule: this.options.schedule } : {}),
    });
    this.process = child;

    try {
      await this.speakAcp(child);
    } finally {
      await this.shutdown();
    }
  }

  private async speakAcp(child: SupervisedProcess): Promise<void> {
    const lines = new LineBuffer();
    const listeners = new Set<(line: string) => void>();
    let protocolError: AcpProtocolError | undefined;

    child.onStdout(chunk => {
      try {
        for (const line of lines.push(chunk.toString('utf8'))) {
          for (const listener of listeners) listener(line);
        }
      } catch (error) {
        protocolError = error as AcpProtocolError;
      }
    });

    const client = new AcpClient({
      transport: {
        send: line => child.write(line),
        onLine: listener => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      ...(this.options.schedule ? { schedule: this.options.schedule } : {}),
    });
    this.client = client;

    client.onProtocolError = error => {
      protocolError = error;
    };
    client.onNotification = (method, params) => this.onNotification(method, params);
    client.onRequest = async (method, params) => await this.onAgentRequest(method, params);

    // Racing the process exit means a crashed agent fails fast rather than
    // waiting for a request timeout.
    const exited = child.exited.then(exit => {
      throw new AcpProtocolError(
        `OpenCode exited before the session completed (code ${String(exit.code)}${exit.reason ? `, ${exit.reason}` : ''}).`,
      );
    });

    const conversation = (async () => {
      const initialize = (await client.request('initialize', {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      })) as unknown;
      this.recordCapabilities(initialize);

      const session = (await client.request('session/new', {
        cwd: this.context.workspaceRoot,
        mcpServers: [],
      })) as unknown;
      const sessionId = isRecord(session) && typeof session.sessionId === 'string' ? session.sessionId : undefined;
      if (!sessionId) throw new AcpProtocolError('OpenCode did not return a session id.');

      this.events.push({ type: 'started', runId: this.context.run.id, workerVersion: this.workerVersion() });

      await client.request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: this.context.task.goal }],
      });
      this.terminalSeen = true;
    })();

    await Promise.race([conversation, exited]);
    if (protocolError) throw protocolError;
  }

  private workerVersion(): string {
    return this.options.expectedVersion ?? 'opencode/unpinned';
  }

  /**
   * Records what the agent actually negotiated.
   *
   * Anything not present in the response stays unavailable with source
   * `unknown`, so IntentSmith never advertises a capability on the strength of
   * a schema.
   */
  private recordCapabilities(initialize: unknown): void {
    const capability = (value: unknown): WorkerCapability =>
      typeof value === 'boolean'
        ? { available: value, source: 'negotiated' }
        : UNKNOWN_CAPABILITY;

    if (!isRecord(initialize)) {
      this.reportCapabilities({ limitations: ['Agent returned no usable initialize result.'] });
      return;
    }
    const agentCapabilities = isRecord(initialize.agentCapabilities) ? initialize.agentCapabilities : {};
    const info = isRecord(initialize.agentInfo) ? initialize.agentInfo : {};
    const promptCapabilities = isRecord(agentCapabilities.promptCapabilities)
      ? agentCapabilities.promptCapabilities
      : {};

    const protocolVersion = typeof initialize.protocolVersion === 'number' ? initialize.protocolVersion : undefined;
    const limitations: string[] = [];
    if (protocolVersion === undefined) {
      limitations.push('Agent did not report a protocol version at initialize.');
    } else if (protocolVersion !== ACP_PROTOCOL_VERSION) {
      limitations.push(
        `Agent negotiated ACP protocol version ${protocolVersion}; IntentSmith implements ${ACP_PROTOCOL_VERSION}.`,
      );
    }
    limitations.push('ACP defines no pause primitive, so pause is unavailable rather than emulated.');
    // Terminal support is not claimed unless the agent said so explicitly.
    if (!('terminal' in agentCapabilities)) {
      limitations.push('Agent did not report terminal support; it is treated as unavailable.');
    }

    this.reportCapabilities({
      protocolVersion,
      ...(typeof info.version === 'string' ? { workerVersion: info.version } : {}),
      session: {
        loadSession: capability(agentCapabilities.loadSession),
        terminal: capability(agentCapabilities.terminal),
        promptImage: capability(promptCapabilities.image),
        promptAudio: capability(promptCapabilities.audio),
        promptEmbeddedContext: capability(promptCapabilities.embeddedContext),
        cancel: { available: true, source: 'documented', detail: 'session/cancel is part of ACP v1.' },
      },
      limitations,
    });
  }

  private onNotification(method: string, params: unknown): void {
    if (this.terminalSeen) {
      // Anything after the turn ends is a protocol violation, recorded as
      // evidence rather than silently absorbed.
      this.events.push({
        type: 'evidence',
        evidence: {
          id: `acp_after_terminal_${this.events.length}`,
          kind: 'worker',
          status: 'fail',
          summary: `Agent sent "${method}" after the turn ended.`,
          producedAt: new Date().toISOString(),
        },
      });
      return;
    }
    if (method !== 'session/update' || !isRecord(params)) return;
    const update = isRecord(params.update) ? params.update : undefined;
    const kind = update && typeof update.sessionUpdate === 'string' ? update.sessionUpdate : 'unknown';
    this.events.push({
      type: 'evidence',
      evidence: {
        id: `acp_update_${this.events.length}`,
        kind: 'worker',
        status: 'pass',
        summary: `Session update: ${kind}`,
        producedAt: new Date().toISOString(),
      },
    });
  }

  /**
   * Handles agent-initiated requests.
   *
   * Permission decisions belong to Core. With no handler installed the request
   * is denied, because an absent authority must never read as consent.
   */
  private async onAgentRequest(method: string, params: unknown): Promise<unknown> {
    if (method !== 'session/request_permission') {
      throw new AcpProtocolError(`Unsupported agent request: ${method}`);
    }
    const proposal = normalizeProposal(params);
    const decision = this.options.onPermissionRequest
      ? await this.options.onPermissionRequest(proposal)
      : { allowed: false, reason: 'No approval authority is installed; denying by default.' };

    this.events.push({
      type: 'evidence',
      evidence: {
        id: `permission_${proposal.toolCallId}`,
        kind: 'security',
        status: decision.allowed ? 'pass' : 'fail',
        summary: `Permission ${decision.allowed ? 'granted' : 'denied'} for "${proposal.title}"${decision.reason ? `: ${decision.reason}` : ''}`,
        producedAt: new Date().toISOString(),
      },
    });

    const chosen = decision.allowed
      ? (decision.optionId ?? proposal.options.find(option => option.kind.startsWith('allow'))?.optionId)
      : (decision.optionId ?? proposal.options.find(option => option.kind.startsWith('reject'))?.optionId);

    return { outcome: { outcome: 'selected', optionId: chosen ?? 'reject' } };
  }

  async cancel(): Promise<void> {
    if (this.cancelled) return;
    this.cancelled = true;
    // Cooperative first, forceful second.
    try {
      this.client?.notify('session/cancel', {});
    } catch {
      // The agent may already be gone.
    }
    await this.shutdown('cancelled');
  }

  private async shutdown(reason: 'cancelled' | 'completed' = 'completed'): Promise<void> {
    this.client?.close('Session closed.');
    if (this.process) {
      await this.process.terminate(reason === 'cancelled' ? 'cancelled' : 'cancelled').catch(() => undefined);
    }
    this.runtimeCleanup?.();
    this.runtimeCleanup = undefined;
  }
}

function defaultRuntimeRoot(): string {
  return mkdtempSync(path.join(tmpdir(), 'intentsmith-opencode-'));
}

function normalizeProposal(params: unknown): ToolProposal {
  const record = isRecord(params) ? params : {};
  const toolCall = isRecord(record.toolCall) ? record.toolCall : {};
  const locations = Array.isArray(toolCall.locations) ? toolCall.locations : [];
  const options = Array.isArray(record.options) ? record.options : [];

  return {
    toolCallId: typeof toolCall.toolCallId === 'string' ? toolCall.toolCallId : 'unknown',
    title: typeof toolCall.title === 'string' ? toolCall.title : 'Untitled tool call',
    kind: typeof toolCall.kind === 'string' ? toolCall.kind : 'unknown',
    paths: locations.flatMap(location =>
      isRecord(location) && typeof location.path === 'string' ? [location.path] : [],
    ),
    options: options.flatMap(option =>
      isRecord(option) && typeof option.optionId === 'string'
        ? [{
            optionId: option.optionId,
            name: typeof option.name === 'string' ? option.name : option.optionId,
            kind: typeof option.kind === 'string' ? option.kind : 'unknown',
          }]
        : [],
    ),
  };
}

function sandboxArtifact(status: SandboxStatus): Record<string, unknown> {
  return {
    id: 'sandbox-status',
    kind: 'json',
    uri: `intentsmith://sandbox/${status.kind}/${status.level}`,
  };
}

function normalizeFailureCode(error: unknown): string {
  const reason = (error as { reason?: string } | undefined)?.reason;
  if (typeof reason === 'string') return `WORKER_${reason.toUpperCase()}`;
  if (error instanceof AcpProtocolError) return 'WORKER_PROTOCOL_ERROR';
  return 'WORKER_FAILED';
}

function describeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Worker failed.';
  // Never let a stack frame or host path reach a persisted result.
  return message.replace(/\s+at\s+\S+:\d+:\d+/g, ' ').slice(0, 500);
}
