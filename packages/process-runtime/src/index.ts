/**
 * `@intentsmith/process-runtime` owns bounded external-process supervision,
 * isolated child environments, the sandbox port, the deterministic gate runner
 * and git-backed change capture.
 *
 * It depends only on `@intentsmith/worker-sdk`, for the change-set vocabulary
 * and workspace confinement that capture produces. That is not a widening of
 * scope: every worker adapter already depends on worker-sdk, so this package
 * stays reusable by any of them. It must never reach Core, persistence or the
 * server, and `tools/architecture/boundaries.test.ts` enforces that.
 */
export {
  DEFAULT_PROCESS_LIMITS,
  ProcessError,
  SupervisedProcess,
  type ProcessExit,
  type ProcessFailureReason,
  type ProcessLimits,
  type SupervisedProcessOptions,
} from './supervisor.js';
export {
  EnvironmentPolicyError,
  FORBIDDEN_ENV_PATTERNS,
  INHERITED_ENV_KEYS,
  assertNoLeakedCredentials,
  buildIsolatedEnv,
  isForbiddenEnvKey,
  type IsolatedEnvOptions,
} from './isolated-env.js';
export {
  bubblewrapPlan,
  degradedPlan,
  planSandbox,
  type PlanSandboxOptions,
  type SandboxKind,
  type SandboxPlan,
  type SandboxProbe,
  type SandboxRequest,
  type SandboxStatus,
} from './sandbox.js';
export {
  captureProposedChanges,
  isAcceptable,
  relativePaths,
  type CaptureOptions,
  type CapturedChangeSet,
} from './change-capture.js';
export {
  execFileGateRunner,
  runGate,
  runGates,
  verdictFromGates,
  type GateCommandRunner,
  type GateDefinition,
  type GateResult,
  type GateRunOptions,
} from './gate-runner.js';
