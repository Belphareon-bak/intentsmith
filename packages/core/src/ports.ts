import type {
  ApprovalState,
  AuditEvent,
  CapabilityApproval,
  CreateProjectInput,
  CreateTaskInput,
  Project,
  Task,
  TaskResult,
  TaskRun,
  TaskRunStatus,
} from '@intentsmith/contracts';

export type Clock = {
  now(): string;
};

/**
 * Scheduling port. Phase 1 called the global `setTimeout` directly, which tied
 * worker timeouts to wall-clock time and made timeout tests depend on machine
 * speed. Tests inject a manually advanced timer instead.
 */
export type Timer = {
  /** Schedules `fn` after `ms` and returns a cancel function. */
  schedule(fn: () => void, ms: number): () => void;
};

export type IdGenerator = {
  next(prefix: string): string;
};

export type ProjectRepository = {
  create(project: Project): Promise<void>;
  get(id: string): Promise<Project | null>;
};

export type TaskRepository = {
  createTask(task: Task): Promise<void>;
  getTask(id: string): Promise<Task | null>;
  update(task: Task): Promise<void>;
  createRun(run: TaskRun): Promise<void>;
  getRun(id: string): Promise<TaskRun | null>;
  updateRun(run: TaskRun): Promise<void>;
  listRuns(taskId: string): Promise<TaskRun[]>;
  listRunsByStatus(statuses: readonly TaskRunStatus[]): Promise<TaskRun[]>;
  countRuns(taskId: string): Promise<number>;
  saveResult(result: TaskResult): Promise<void>;
  getResult(taskId: string): Promise<TaskResult | null>;
  getResultByRun(runId: string): Promise<TaskResult | null>;
};

/**
 * Storage for capability approvals.
 *
 * `updateApprovalState` is compare-and-set rather than a blind write: two
 * callers racing to decide the same approval must not be able to overwrite each
 * other, and the loser needs to find out that it lost.
 */
export type ApprovalRepository = {
  createApproval(approval: CapabilityApproval): Promise<void>;
  getApproval(id: string): Promise<CapabilityApproval | null>;
  findApproval(runId: string, actionId: string, payloadHash: string): Promise<CapabilityApproval | null>;
  /** Returns false when the row was no longer in `expectedState`. */
  updateApprovalState(approval: CapabilityApproval, expectedState: ApprovalState): Promise<boolean>;
  listApprovalsByRun(runId: string): Promise<CapabilityApproval[]>;
  listApprovalsByState(states: readonly ApprovalState[]): Promise<CapabilityApproval[]>;
};

export type AuditRepository = {
  append(event: AuditEvent): Promise<void>;
  listByTask(taskId: string): Promise<AuditEvent[]>;
};

export type TransactionManager = {
  transaction<T>(fn: () => Promise<T>): Promise<T>;
};

// The worker port lives in `@intentsmith/worker-sdk` so a concrete adapter can
// implement it without depending on Core (ADR 0011 direction, ADR 0017 for the
// worker port specifically). Core re-exports the types it consumes.
export type {
  InferenceGrant,
  WorkerAdapter,
  WorkerCapability,
  WorkerDescriptor,
  WorkerExecutionContext,
  WorkerExecutionResult,
  WorkerHandle,
} from '@intentsmith/worker-sdk';

export type CreateProjectCommand = CreateProjectInput;
export type CreateTaskCommand = CreateTaskInput;
