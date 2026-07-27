export { DomainError, normalizeError } from './errors.js';
export { ALLOWED_TRANSITIONS, TERMINAL_TASK_STATUSES, assertTransition, canTransition } from './lifecycle.js';
export { canonicalizeCapabilityEnvelope, assertPathInsideRoots } from './path-policy.js';
export { decideVerdict, type VerdictInput } from './verdict.js';
export { IntentSmithCore, type IntentSmithCoreOptions } from './core.js';
export { CryptoIdGenerator, SystemClock } from './runtime-adapters.js';
export type {
  AuditRepository,
  Clock,
  CreateProjectCommand,
  CreateTaskCommand,
  IdGenerator,
  ProjectRepository,
  TaskRepository,
  TransactionManager,
  WorkerAdapter,
  WorkerExecutionContext,
  WorkerExecutionResult,
  WorkerHandle,
} from './ports.js';
