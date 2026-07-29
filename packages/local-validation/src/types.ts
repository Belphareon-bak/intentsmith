export type ScenarioVerdict = 'PASS' | 'FAIL' | 'BLOCKED';
export type SchedulerState = 'PENDING' | 'COMPLETED' | 'SKIPPED';

export type StructuredReason = {
  code: string;
  message: string;
  kind: 'failure' | 'blocked';
  timeoutMs?: number;
};

export type RuntimeVersions = {
  node: string;
  runner: string;
  opencode?: string;
  ollama?: string;
  model?: string;
  gpu?: string;
  driver?: string;
};

export type LeakCheckResult = {
  passed: boolean;
  processGroupMembers: number[];
  ownedListeners: string[];
  ownedSockets: string[];
  ownedTemporaryPaths: string[];
  isolatedEnvironmentPaths: string[];
  fileDescriptorDelta: number;
  diskBytesDelta: number;
  approvalWaiters: number;
  liveApprovalGrants: number;
  liveGatewayTokens: number;
  operatorCredentialLeaks: string[];
};

export type RedactionResult = {
  passed: boolean;
  checkedLocations: string[];
  findings: string[];
};

export type ScenarioAttempt = {
  attempt: number;
  scenarioId: string;
  scenarioVersion: string;
  testedCommit: string;
  verdict: ScenarioVerdict;
  behavioralObservations: unknown[];
  startedAt: string;
  endedAt: string;
  durationMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  reason?: StructuredReason;
  runtimeVersions: RuntimeVersions;
  artifactPaths: string[];
  logPaths: string[];
  retryCount: number;
  leakCheck: LeakCheckResult;
  redaction: RedactionResult;
};

export type ScenarioRecord = {
  id: string;
  version: string;
  schedulerState: SchedulerState;
  attempts: ScenarioAttempt[];
  /**
   * FAIL is sticky across attempts. A later successful observation is useful
   * evidence, but cannot rewrite a failure out of the run's history.
   */
  deterministicVerdict?: ScenarioVerdict;
};

export type ScenarioDefinition = {
  id: string;
  version: string;
  command: readonly [string, ...string[]];
  timeoutMs: number;
  requiredPreconditions: string[];
};

export type ModelProfile = {
  id: string;
  opencodeVersion: string;
  provider: 'ollama';
  model: string;
  gpu: string;
  concurrency: 1;
  strictOfflineProven: false;
};

export type RunFingerprints = {
  sourceCommit: string;
  runnerVersion: string;
  scenarioManifest: string;
  modelProfile: string;
  options: string;
};

export type RunCheckpoint = {
  schemaVersion: 1;
  runId: string;
  createdAt: string;
  updatedAt: string;
  fingerprints: RunFingerprints;
  scenarios: ScenarioRecord[];
};

export type RunArtifact = RunCheckpoint & {
  completedAt: string;
  baselinePath: string;
  baselineDifferences: BaselineDifference[];
};

export type BaselineDifference = {
  path: string;
  baseline: unknown;
  current: unknown;
  deterministicInvariant: boolean;
};
