import type {
  AuditEvent,
  CreateProjectInput,
  CreateTaskInput,
  Project,
  Task,
  TaskResult,
  TaskRun,
} from '@intentsmith/contracts';

export type Clock = {
  now(): string;
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
  countRuns(taskId: string): Promise<number>;
  saveResult(result: TaskResult): Promise<void>;
  getResult(taskId: string): Promise<TaskResult | null>;
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

export type WorkerAdapter = {
  start(context: WorkerExecutionContext): WorkerHandle;
};

export type CreateProjectCommand = CreateProjectInput;
export type CreateTaskCommand = CreateTaskInput;
