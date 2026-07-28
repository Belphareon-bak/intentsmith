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
  createRedactor,
  type CapabilityRequest,
  type Redactor,
  type WorkerAdapter,
  type WorkerCapability,
  type WorkerDescriptor,
  type WorkerExecutionContext,
  type WorkerExecutionResult,
  type WorkerHandle,
} from '@intentsmith/worker-sdk';

import { AGENT_METHODS, client, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';

import { AcpProtocolError } from './acp-error.js';
import {
  createStrictAcpStream,
  type StreamLimits,
  type StreamViolation,
  type StrictStream,
} from './strict-stream.js';
import { outcomeForStopReason, parsePromptResponse, type TurnOutcome } from './stop-reason.js';
import {
  GATEWAY_TOKEN_ENV,
  assertRuntimeUsesConfig,
  inspectGeneratedConfig,
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

/**
 * Decision Core returns for a permission request.
 *
 * Deliberately without an option id. Which ACP option expresses the decision is
 * this adapter's problem, and keeping the choice here is what makes
 * "never allow_always" enforceable in one place rather than trusted to every
 * caller.
 */
export type PermissionDecision = {
  allowed: boolean;
  reason?: string;
};

export type ToolProposal = {
  toolCallId: string;
  title: string;
  kind: string;
  /** Paths the tool wants to touch, as the agent reported them. */
  paths: string[];
  /** Structured payload the agent sent, never parsed out of the title. */
  rawInput: Record<string, unknown>;
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
  /** Bounds on the raw ACP stream, before the SDK ever sees a line. */
  streamLimits?: Partial<StreamLimits>;
  /**
   * Observes the ACP wire, in order. Used by the handshake regression test and
   * available for run evidence.
   */
  onWireMessage?: (direction: 'out' | 'in', message: unknown) => void;
  sandboxProbe?: SandboxProbe;
  preferSandbox?: boolean;
  /**
   * Core's approval authority. The adapter never decides; a missing handler
   * denies, because silence must not mean permission.
   *
   * The request is vendor-neutral: no ACP or OpenCode type crosses this
   * boundary, so Core's policy and audit keep their meaning when the worker
   * changes. The proposal is passed alongside for evidence only.
   */
  onPermissionRequest?: (
    request: CapabilityRequest,
    proposal: ToolProposal,
  ) => Promise<PermissionDecision>;
  schedule?: (fn: () => void, ms: number) => () => void;
  /** Injected for tests; defaults to a real temp directory. */
  makeRuntimeRoot?: () => string;
};

/** Reported to the agent in `clientInfo`. */
const INTENTSMITH_VERSION = '0.1.0';

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
        // Must go through the same guard: a cancel that already emitted a
        // terminal event must not be followed by a second one from the
        // resulting rejection.
        session.emitFailure(error);
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
  private stream: StrictStream | undefined;
  private runtimeCleanup: (() => void) | undefined;
  private cancelled = false;
  /** The one session this run owns. Messages for any other are rejected. */
  private sessionId: string | undefined;
  /** Active SDK session, used for cooperative cancellation. */
  private session: { dispose?: () => Promise<void> | void } | undefined;
  /** Exactly one terminal worker event may ever be emitted. */
  private terminalEmitted = false;
  /** Set as soon as the prompt response lands, so a later update is late. */
  private turnEnded = false;
  /** Scrubs the per-run token out of anything the agent produced. */
  private redactor: Redactor = createRedactor();

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
    // Register the token before anything can be read from the agent, so no
    // output path exists that predates redaction.
    if (grant) this.redactor = createRedactor([grant.token]);

    // The worker gets an inference route only through the gateway.
    const runtime = grant
      ? createOpenCodeRuntime({ runtimeRoot, grant })
      : { runtimeRoot, configPath: '', configSha256: '', providedEnv: {}, cleanup: () => undefined };
    this.runtimeCleanup = runtime.cleanup;

    const provided: Record<string, string> = { ...runtime.providedEnv };
    if (grant) {
      provided.INTENTSMITH_GATEWAY_URL = grant.baseUrl;
      provided.INTENTSMITH_MODEL_ID = grant.modelId;
    }

    const env = buildIsolatedEnv({ runtimeRoot, provided });
    // The gateway token is the only secret this process may hold.
    assertNoLeakedCredentials(env, [GATEWAY_TOKEN_ENV]);

    if (grant) {
      // Re-read and re-validate immediately before spawning, against the file
      // the agent will actually open. Anything between generation and here --
      // an edit, a truncation, a different XDG root -- means the mediation this
      // run depends on may not exist, and starting anyway would be running the
      // worker unmediated while believing otherwise.
      const inspected = inspectGeneratedConfig(runtime.configPath, grant.baseUrl);
      assertRuntimeUsesConfig(env, runtime.configPath);
      this.events.push({
        type: 'artifact',
        artifact: {
          id: 'opencode-config',
          kind: 'json',
          uri: `intentsmith://opencode-config/${inspected.sha256}`,
          sha256: inspected.sha256,
        },
      });
    }

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
      await this.shutdown('completed');
    } catch (error) {
      await this.shutdown(this.cancelled ? 'cancelled' : 'completed');
      throw error;
    }
  }

  /**
   * Runs the ACP conversation through the official SDK's fluent client.
   *
   * `initialize` is sent explicitly. `buildSession().start()` issues only
   * `session/new`, so relying on it would silently skip protocol version
   * negotiation; `ClientContext.request` is the public typed wrapper for
   * sending an agent-side request, and the SDK's own tests use this sequence.
   * No deprecated `ClientSideConnection` and no `unstable_*` surface is used.
   *
   * The transport is IntentSmith's own strict stream rather than the SDK's
   * `ndJsonStream`, so malformed or oversized worker output ends the run
   * deterministically instead of being logged and dropped (ADR 0016).
   */
  private async speakAcp(child: SupervisedProcess): Promise<void> {
    let protocolError: AcpProtocolError | undefined;
    const recordViolation = (violation: StreamViolation): void => {
      protocolError ??= new AcpProtocolError(violation.message);
    };

    // Per-instance transport: no shared buffers, counters or handlers, so two
    // concurrent workers cannot observe or disturb one another.
    const stream = createStrictAcpStream({
      subscribe: listener => child.onStdout(listener),
      write: line => child.write(line),
      ...(this.options.streamLimits ? { limits: this.options.streamLimits } : {}),
      onViolation: recordViolation,
      ...(this.options.onWireMessage
        ? {
            onInbound: message => this.options.onWireMessage?.('in', message),
            onOutbound: message => this.options.onWireMessage?.('out', message),
          }
        : {}),
    });
    this.stream = stream;

    const app = client({ name: 'intentsmith' });

    // Handlers must be registered through the fluent chain. Passing them to
    // `client({ ... })` is silently ignored, which would leave the worker never
    // asked for permission -- a failure in the dangerous direction.
    app.onRequest('session/request_permission', async ctx =>
      (await this.onPermissionRequest(ctx.params)) as never,
    );
    app.onNotification('session/update', async ctx => {
      this.onSessionUpdate(ctx.params);
    });

    const conversation = app.connectWith(
      stream as unknown as Parameters<typeof app.connectWith>[0],
      async ctx => {
        this.assertNotCancelled();

        const initialize = await ctx.request(AGENT_METHODS.initialize, {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
          clientInfo: { name: 'IntentSmith', version: INTENTSMITH_VERSION },
        });

        // Hard gate before anything else is sent: a mismatch must stop the run
        // rather than proceed against semantics nobody has verified.
        this.assertProtocolVersion(initialize);
        this.recordCapabilities(initialize);
        if (protocolError) throw protocolError;

        this.assertNotCancelled();
        const session = await ctx
          .buildSession({ cwd: this.context.workspaceRoot as string, mcpServers: [] })
          .start();

        const sessionId = session.sessionId;
        if (typeof sessionId !== 'string' || sessionId.length === 0) {
          throw new AcpProtocolError('OpenCode did not return a session id.');
        }
        // From here on, any message naming a different session is rejected.
        this.sessionId = sessionId;
        this.session = session as unknown as { dispose?: () => Promise<void> | void };

        this.events.push({ type: 'started', runId: this.context.run.id, workerVersion: this.workerVersion() });

        this.assertNotCancelled();
        if (protocolError) throw protocolError;

        const response = (await session.prompt([{ type: 'text', text: this.context.task.goal }])) as unknown;
        // The turn is over the moment the response lands, so a trailing update
        // is correctly seen as arriving after it.
        this.turnEnded = true;

        const outcome = outcomeForStopReason(parsePromptResponse(response));
        // A protocol violation seen during the turn outranks a success: an
        // agent that polluted stdout was not purely speaking ACP.
        if (protocolError) throw protocolError;
        this.emitTerminal(outcome);
      },
    );

    // Racing the process exit means a crashed agent fails fast rather than
    // waiting for a request timeout.
    const exited = child.exited.then(exit => {
      // The supervisor's own reason is far more useful than a generic protocol
      // error: "install OpenCode" beats "the agent stopped talking".
      const reason = child.failureReason ?? exit.reason;
      if (reason && reason !== 'completed') {
        throw Object.assign(
          // stderr is agent-controlled and must be redacted before it is
          // attached to anything IntentSmith stores or shows.
          new Error(processFailureMessage(reason, this.redactor.text(child.stderr))),
          { reason },
        );
      }
      throw new AcpProtocolError(
        `OpenCode exited before the session completed (code ${String(exit.code)}).`,
      );
    });

    try {
      await Promise.race([conversation, exited]);
    } catch (error) {
      // A recorded stream violation is the true cause and outranks whatever
      // the SDK surfaced once its reader was errored: "the worker polluted
      // stdout" is actionable, "stream errored" is not.
      if (protocolError) throw protocolError;
      throw error;
    }
    if (protocolError) throw protocolError;
  }

  /** Cancellation observed before the next protocol step. */
  private assertNotCancelled(): void {
    if (this.cancelled) {
      throw Object.assign(new Error('The run was cancelled.'), { reason: 'cancelled' });
    }
  }

  /**
   * A protocol version IntentSmith does not implement ends the connection.
   *
   * A warning would leave the run proceeding against semantics nobody has
   * verified, which is exactly how a silent misinterpretation becomes a wrong
   * verdict.
   */
  private assertProtocolVersion(initialize: unknown): void {
    const reported = isRecord(initialize) ? initialize.protocolVersion : undefined;
    if (typeof reported !== 'number') {
      throw Object.assign(
        new AcpProtocolError('Agent did not report an ACP protocol version at initialize.'),
        { reason: 'protocol_incompatible' },
      );
    }
    if (reported !== PROTOCOL_VERSION) {
      throw Object.assign(
        new AcpProtocolError(
          `Agent negotiated ACP protocol version ${reported}, but IntentSmith implements ${PROTOCOL_VERSION}. Refusing to continue against unverified protocol semantics.`,
        ),
        { reason: 'protocol_incompatible' },
      );
    }
  }

  /**
   * Emits a terminal failure, unless a terminal event already exists.
   *
   * Public because the run's rejection handler must funnel through the same
   * guard rather than pushing an event of its own.
   */
  emitFailure(error: unknown): void {
    if (this.terminalEmitted) return;
    this.terminalEmitted = true;
    this.events.push({
      type: 'failed',
      error: {
        code: normalizeFailureCode(error),
        message: this.redactor.text(describeFailure(error)),
        retryable: false,
      },
    });
  }

  /** Emits the single terminal worker event for this run. */
  private emitTerminal(outcome: TurnOutcome): void {
    if (this.terminalEmitted) return;
    this.terminalEmitted = true;

    if (outcome.kind === 'completed') {
      this.events.push({
        type: 'completed',
        claim: { status: 'success', summary: 'Agent reported the turn finished (stopReason end_turn).' },
      });
      return;
    }
    if (outcome.kind === 'cancelled') {
      this.events.push({
        type: 'failed',
        error: { code: 'WORKER_CANCELLED', message: 'The run was cancelled.', retryable: false },
      });
      return;
    }
    this.events.push({
      type: 'failed',
      error: { code: outcome.code, message: outcome.message, retryable: false },
    });
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
    } else if (protocolVersion !== PROTOCOL_VERSION) {
      limitations.push(
        `Agent negotiated ACP protocol version ${protocolVersion}; IntentSmith implements ${PROTOCOL_VERSION}.`,
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

  /**
   * Rejects a message that does not belong to this run's session.
   *
   * A missing or foreign sessionId is a protocol violation, not something to
   * accept charitably: honouring it would let one session's agent influence
   * another's evidence.
   */
  private assertOwnedSession(params: unknown, what: string): void {
    const claimed = isRecord(params) && typeof params.sessionId === 'string' ? params.sessionId : undefined;
    if (this.sessionId === undefined) {
      throw new AcpProtocolError(`Agent sent ${what} before a session existed.`);
    }
    if (claimed === undefined) {
      throw new AcpProtocolError(`Agent sent ${what} without a sessionId.`);
    }
    if (claimed !== this.sessionId) {
      throw new AcpProtocolError(`Agent sent ${what} for a session this run does not own.`);
    }
  }

  private onSessionUpdate(params: unknown): void {
    try {
      this.assertOwnedSession(params, 'a session update');
    } catch (error) {
      this.protocolViolation(error);
      return;
    }

    if (this.turnEnded || this.terminalEmitted) {
      // Anything after the turn ends is a protocol violation, recorded rather
      // than silently absorbed.
      this.protocolViolation(new AcpProtocolError('Agent sent a session update after the turn ended.'));
      return;
    }

    const update = isRecord(params) && isRecord(params.update) ? params.update : undefined;
    const kind = update && typeof update.sessionUpdate === 'string' ? update.sessionUpdate : 'unknown';

    // A tool call has an outcome; a message is talk. Only the former is
    // recorded as evidence, and even then Core's gate runner is what decides a
    // verdict -- a worker's own account of its work never can.
    if (kind === 'tool_call' || kind === 'tool_call_update') {
      const status = update && typeof update.status === 'string' ? update.status : 'unknown';
      this.events.push({
        type: 'evidence',
        evidence: {
          id: `acp_tool_${this.events.length}`,
          kind: 'worker',
          status: status === 'completed' ? 'pass' : status === 'failed' ? 'fail' : 'blocked',
          summary: this.redactor.text(`Tool call reported by the agent: ${status}`),
          producedAt: new Date().toISOString(),
        },
      });
      return;
    }

    this.events.push({
      type: 'artifact',
      artifact: {
        id: `acp_update_${this.events.length}`,
        kind: 'log',
        uri: `intentsmith://acp/session-update/${encodeURIComponent(kind)}`,
      },
    });
  }

  /** Records a protocol violation as failing security evidence. */
  private protocolViolation(error: unknown): void {
    this.events.push({
      type: 'evidence',
      evidence: {
        id: `acp_violation_${this.events.length}`,
        kind: 'security',
        status: 'fail',
        summary: this.redactor.text(
          error instanceof Error ? error.message : 'Agent violated the ACP contract.',
        ),
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
  private async onPermissionRequest(params: unknown): Promise<unknown> {
    // A permission request must belong to this run's session.
    this.assertOwnedSession(params, 'a permission request');
    if (this.turnEnded || this.terminalEmitted) {
      throw new AcpProtocolError('Agent requested permission after the turn ended.');
    }
    // The agent controls every string in here and may have echoed its token.
    const proposal = normalizeProposal(this.redactor.value(params));
    const request = toCapabilityRequest(proposal);
    const decision = this.options.onPermissionRequest
      ? await this.options.onPermissionRequest(request, proposal)
      : { allowed: false, reason: 'No approval authority is installed; denying by default.' };

    this.events.push({
      type: 'evidence',
      evidence: {
        id: `permission_${proposal.toolCallId}`,
        kind: 'security',
        status: decision.allowed ? 'pass' : 'fail',
        summary: this.redactor.text(
          `Permission ${decision.allowed ? 'granted' : 'denied'} for "${proposal.title}"${decision.reason ? `: ${decision.reason}` : ''}`,
        ),
        producedAt: new Date().toISOString(),
      },
    });

    return { outcome: { outcome: 'selected', optionId: chooseOption(proposal, decision.allowed) } };
  }

  async cancel(): Promise<void> {
    if (this.cancelled) return;
    this.cancelled = true;
    // Cooperative first, forceful second. The SDK's session dispose issues
    // `session/cancel { sessionId }` for the session this run owns.
    try {
      await this.session?.dispose?.();
    } catch {
      // The agent may already be gone.
    }
    this.emitTerminal({ kind: 'cancelled', stopReason: 'cancelled' });
    await this.shutdown('cancelled');
  }

  /**
   * Closes the session and its process.
   *
   * A normal finish is `completed`, not `cancelled`. Recording a successful run
   * as cancelled would put a false reason into evidence and make every
   * cancellation statistic meaningless.
   */
  private async shutdown(reason: 'cancelled' | 'completed' = 'completed'): Promise<void> {
    // Terminate before closing the client. The process flushes stdout as it
    // exits, and those trailing lines are exactly where an agent's
    // after-the-turn protocol violations show up; closing the reader first
    // would silently discard the evidence.
    if (this.process) {
      await this.process.terminate(reason).catch(() => undefined);
    }
    this.stream?.close();
    this.stream = undefined;
    this.session = undefined;
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
    rawInput: isRecord(toolCall.rawInput) ? toolCall.rawInput : {},
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

/**
 * Translates one ACP permission request into the vendor-neutral shape Core
 * evaluates.
 *
 * Everything is taken from structured fields. The title is never parsed:
 * approving from a title would mean approving from prose the model wrote, and
 * the spike showed the title of a shell command is exactly that.
 */
function toCapabilityRequest(proposal: ToolProposal): CapabilityRequest {
  const raw = proposal.rawInput;
  const filepath = typeof raw.filepath === 'string' ? raw.filepath : undefined;
  const command = typeof raw.command === 'string' ? raw.command : undefined;
  const url = typeof raw.url === 'string' ? raw.url : undefined;

  // `locations` is the agent's own statement of what it will touch; `filepath`
  // is the same thing for a file edit and is kept when locations are empty.
  const paths = proposal.paths.length > 0 ? proposal.paths : filepath ? [filepath] : [];

  return {
    toolName: toolNameFor(proposal),
    actionId: proposal.toolCallId,
    resourcePaths: paths,
    ...(command === undefined ? {} : { command }),
    ...(url === undefined ? {} : { url }),
    payload: raw,
  };
}

/**
 * Maps the agent's tool `kind` onto the ledger's tool vocabulary.
 *
 * An unrecognized kind stays unrecognized: `describeCapability` denies anything
 * it has not classified, and inventing a plausible name here would turn an
 * unknown action into a known-looking one.
 */
function toolNameFor(proposal: ToolProposal): string {
  const raw = proposal.rawInput;
  switch (proposal.kind) {
    case 'edit':
      // OpenCode reports both edit and write as `edit`; a diff means an edit of
      // existing content, its absence means the file is being created whole.
      return typeof raw.diff === 'string' ? 'edit' : 'write';
    case 'execute':
      return 'bash';
    case 'fetch':
      return 'webfetch';
    case 'read':
      return 'read';
    case 'search':
      return 'grep';
    default:
      return proposal.kind;
  }
}

/**
 * Picks the ACP option that expresses Core's decision.
 *
 * `allow_always` is never selected, whatever the agent offers or however it is
 * ordered. IntentSmith's approvals are single-use by construction, and choosing
 * an option that outlives the action would hand the agent a standing permission
 * Core never granted. If the agent offers no way to allow exactly once, the
 * answer is a rejection rather than a broader yes.
 */
export function chooseOption(proposal: ToolProposal, allowed: boolean): string {
  const byKind = (kind: string): string | undefined =>
    proposal.options.find(option => option.kind === kind)?.optionId;
  const reject = byKind('reject_once') ?? proposal.options.find(option => option.kind.startsWith('reject'))?.optionId;
  if (!allowed) return reject ?? 'reject';
  return byKind('allow_once') ?? reject ?? 'reject';
}

function sandboxArtifact(status: SandboxStatus): Record<string, unknown> {
  return {
    id: 'sandbox-status',
    kind: 'json',
    uri: `intentsmith://sandbox/${status.kind}/${status.level}`,
  };
}

function normalizeFailureCode(error: unknown): string {
  // An explicit reason wins over the error class: a protocol-version mismatch
  // is an AcpProtocolError but deserves its own actionable code.
  const reason = (error as { reason?: string } | undefined)?.reason;
  if (typeof reason === 'string') return `WORKER_${reason.toUpperCase()}`;
  if (error instanceof AcpProtocolError) return 'WORKER_PROTOCOL_ERROR';
  return 'WORKER_FAILED';
}

/** Turns a supervisor failure reason into something a user can act on. */
function processFailureMessage(reason: string, redactedStderr: string): string {
  const tail = redactedStderr.trim().slice(-200);
  const suffix = tail.length > 0 ? ` Worker stderr: ${tail}` : '';
  switch (reason) {
    case 'executable_missing':
      return 'The OpenCode executable was not found. IntentSmith never installs it for you; install it yourself (npm install -g opencode-ai) and try again.';
    case 'permission_denied':
      return 'The OpenCode executable exists but could not be executed (permission denied).';
    case 'startup_timeout':
      return 'OpenCode did not start within the startup timeout.';
    case 'idle_timeout':
      return `OpenCode produced no output within the idle timeout.${suffix}`;
    case 'overall_timeout':
      return 'OpenCode exceeded its overall time limit.';
    case 'stdout_overflow':
    case 'stderr_overflow':
      return 'OpenCode produced more output than the configured limit.';
    case 'cancelled':
      return 'The run was cancelled.';
    default:
      return `OpenCode exited before the session completed (${reason}).${suffix}`;
  }
}

function describeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Worker failed.';
  // Never let a stack frame or host path reach a persisted result.
  return message.replace(/\s+at\s+\S+:\d+:\d+/g, ' ').slice(0, 500);
}
