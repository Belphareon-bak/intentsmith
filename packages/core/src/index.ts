export { DomainError, normalizeError } from './errors.js';
export {
  ALLOWED_TRANSITIONS,
  COMMAND_SOURCE_STATES,
  COMMAND_TARGET_STATUS,
  TERMINAL_TASK_STATUSES,
  assertCommand,
  assertTransition,
  canRunCommand,
  canTransition,
  isTerminal,
  targetStatusFor,
  type LifecycleCommand,
} from './lifecycle.js';
export { KeyedMutex } from './mutex.js';
export {
  ApprovalLedger,
  DEFAULT_APPROVAL_TTL_MS,
  type ApprovalLedgerOptions,
  type ApprovalRequestInput,
  type ConsumptionOutcome,
  type ConsumptionRefusal,
} from './approvals.js';
export { canonicalizeCapabilityEnvelope, canonicalizeExistingPath, assertPathInsideRoots } from './path-policy.js';
export { decideVerdict, type VerdictInput } from './verdict.js';
export { INTERRUPTIBLE_RUN_STATUSES, IntentSmithCore, type IntentSmithCoreOptions } from './core.js';
export { CryptoIdGenerator, SystemClock, SystemTimer } from './runtime-adapters.js';
export type {
  ApprovalRepository,
  AuditRepository,
  Clock,
  CreateProjectCommand,
  CreateTaskCommand,
  IdGenerator,
  ProjectRepository,
  TaskRepository,
  Timer,
  TransactionManager,
  WorkerAdapter,
  WorkerDescriptor,
  WorkerExecutionContext,
  WorkerExecutionResult,
  WorkerHandle,
} from './ports.js';
