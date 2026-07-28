/**
 * `@intentsmith/process-runtime` owns bounded external-process supervision,
 * isolated child environments, and the sandbox port. It depends on no other
 * IntentSmith package so any future worker adapter can reuse it.
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
  execFileGateRunner,
  runGate,
  runGates,
  verdictFromGates,
  type GateCommandRunner,
  type GateDefinition,
  type GateResult,
  type GateRunOptions,
} from './gate-runner.js';
