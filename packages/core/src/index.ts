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
export { canonicalizeCapabilityEnvelope, canonicalizeExistingPath, assertPathInsideRoots } from './path-policy.js';
export { decideVerdict, type VerdictInput } from './verdict.js';
export { INTERRUPTIBLE_RUN_STATUSES, IntentSmithCore, type IntentSmithCoreOptions } from './core.js';
export { CryptoIdGenerator, SystemClock, SystemTimer } from './runtime-adapters.js';
export {
  PROVIDER_ERROR_CODES,
  ProviderError,
  isProviderErrorCode,
  normalizeProviderError,
  type GenerationRequest,
  type InferenceEvent,
  type InferenceProvider,
  type ModelDescriptor,
  type NormalizedProviderError,
  type ProviderCapabilities,
  type ProviderErrorCode,
  type ProviderHealth,
  type ProviderIdentity,
  type TokenUsage,
} from './inference.js';
export type {
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
