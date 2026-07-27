import type {
  AuditEvent,
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

export type AuditRepository = {
  append(event: AuditEvent): Promise<void>;
  listByTask(taskId: string): Promise<AuditEvent[]>;
};

export type TransactionManager = {
  transaction<T>(fn: () => Promise<T>): Promise<T>;
};

export type WorkerExecutionContext = {
  task: Task;
  run: TaskRun;
  signal: AbortSignal;
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

/**
 * Static worker identity and capability discovery.
 *
 * Added in Phase 1.1 so the shared contract suite can assert what an adapter
 * claims to support before exercising it. Breaking change: every
 * `WorkerAdapter` must now implement `describe()`.
 */
export type WorkerDescriptor = {
  id: string;
  version: string;
  capabilities: {
    pause: boolean;
    cancel: boolean;
  };
};

export type WorkerAdapter = {
  describe(): WorkerDescriptor;
  start(context: WorkerExecutionContext): WorkerHandle;
};

export type CreateProjectCommand = CreateProjectInput;
export type CreateTaskCommand = CreateTaskInput;
