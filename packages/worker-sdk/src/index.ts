import type { Task, TaskRun } from '@intentsmith/contracts';

/**
 * `@intentsmith/worker-sdk` owns the worker port and its normalized vocabulary.
 *
 * It depends only on `@intentsmith/contracts`, so a concrete worker adapter can
 * implement the port without pulling in Core. This mirrors ADR 0011: Core is
 * the authority that *uses* a worker, not a library workers build on.
 */

export type WorkerExecutionContext = {
  task: Task;
  run: TaskRun;
  signal: AbortSignal;
  /**
   * Everything a worker needs to reach inference, when the run has one.
   *
   * A worker never receives Ollama's address. Its only inference path is the
   * IntentSmith gateway, and the token is scoped to this run.
   */
  inference?: InferenceGrant;
  /** Absolute path the worker may modify. Never the user's real project. */
  workspaceRoot?: string;
};

export type InferenceGrant = {
  /** Loopback base URL of the IntentSmith gateway, e.g. `http://127.0.0.1:41234`. */
  baseUrl: string;
  /** Per-run secret. Never logged, persisted, audited, or passed as an argument. */
  token: string;
  /** Model the worker is permitted to use. */
  modelId: string;
};

export type WorkerExecutionResult = {
  events: unknown[];
};

export type WorkerHandle = {
  done: Promise<WorkerExecutionResult>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  cancel(): Promise<void>;
};

/** How a capability was established. Claims are not evidence. */
export type CapabilitySource = 'negotiated' | 'probed' | 'documented' | 'unknown';

/**
 * Normalized worker description.
 *
 * A capability is reported as available only when the worker actually
 * negotiated or demonstrated it. A schema defining something is not a reason to
 * advertise it, so anything unconfirmed stays `false` with source `unknown`.
 */
export type WorkerCapability = {
  available: boolean;
  source: CapabilitySource;
  detail?: string;
};

export type WorkerDescriptor = {
  id: string;
  version: string;
  capabilities: {
    pause: boolean;
    cancel: boolean;
  };
  /** Populated by adapters that discover capabilities at runtime. */
  detailed?: {
    protocolVersion?: number | string;
    sdkVersion?: string;
    workerVersion?: string;
    session?: Record<string, WorkerCapability>;
    /** Limitations the adapter knows about, stated plainly. */
    limitations?: string[];
  };
};

export type WorkerAdapter = {
  describe(): WorkerDescriptor;
  start(context: WorkerExecutionContext): WorkerHandle;
};

/** Convenience for adapters that cannot confirm a capability. */
export const UNKNOWN_CAPABILITY: WorkerCapability = { available: false, source: 'unknown' };

export {
  assertNoTokenLeak,
  withGrant,
  type GrantAudit,
  type GrantIssuer,
  type GrantOutcome,
} from './run-grant.js';
export {
  DEFAULT_DIFF_POLICY,
  WorkspacePolicyError,
  assertInsideWorkspace,
  evaluateDiffPolicy,
  findGeneratedSecrets,
  isEscapingSymlink,
  sha256,
  type ApprovalEvidenceReference,
  type ChangeProvenance,
  type ChangedPath,
  type DiffPolicy,
  type GateEvidenceReference,
  type ProposedChangeSet,
} from './workspace.js';
export {
  CAPABILITY_CATALOG,
  UNKNOWN_CAPABILITY_DESCRIPTOR,
  capabilityPayloadHash,
  describeCapability,
  evaluateCapabilityRequest,
  type CapabilityCategory,
  type CapabilityDecision,
  type CapabilityDescriptor,
  type CapabilityEvaluationOptions,
  type CapabilityRequest,
  type ConfirmationRequirement,
} from './capability.js';
export {
  REDACTED,
  assertRedacted,
  createRedactor,
  type Redactor,
} from './redaction.js';
