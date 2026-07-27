# Minimal Contract Schemas

This is the Phase 0 proposal. Phase 1 must encode these as runtime-validated
schemas in `packages/contracts`.

## IDs

All persisted boundary records include:

- `id`: stable opaque string;
- `createdAt`: ISO timestamp;
- `updatedAt`: ISO timestamp where mutable.

## Project

```ts
type Project = {
  id: string;
  name: string;
  rootPath: string;
  trustState: 'trusted' | 'untrusted';
  status: 'active' | 'archived';
};
```

## Session

```ts
type Session = {
  id: string;
  projectId: string;
  kind: 'chat' | 'task' | 'audit';
  status: 'open' | 'paused' | 'closed';
};
```

## Task

```ts
type Task = {
  id: string;
  projectId: string;
  parentTaskId?: string;
  dependencyIds: string[];
  type: 'plan' | 'code' | 'test' | 'review' | 'repair';
  goal: string;
  scope: CapabilityEnvelope;
  inputs: ArtifactRef[];
  expectedOutputs: string[];
  acceptanceCriteria: string[];
  workerPreference?: WorkerPreference;
  modelPreference?: ModelPreference;
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  status: 'pending' | 'running' | 'paused' | 'cancelled' | 'failed' | 'passed';
  latestRunId?: string;
};
```

## TaskRun

```ts
type TaskRun = {
  id: string;
  taskId: string;
  attempt: number;
  status: 'running' | 'paused' | 'cancelled' | 'failed' | 'passed' | 'timeout';
  startedAt: string;
  endedAt?: string;
};
```

## CapabilityEnvelope

```ts
type CapabilityEnvelope = {
  fsReadRoots: string[];
  fsWriteRoots: string[];
  allowedCommandFamilies: string[];
  deniedCommandPatterns: string[];
  network: { mode: 'disabled' | 'allowlist'; allowlist: string[] };
  envAllowlist: string[];
  secrets: 'none' | 'explicit_approval';
  processSpawning: 'disabled' | 'bounded';
  timeoutMs: number;
  maxActions: number;
  approvalRules: ApprovalRule[];
};
```

## WorkerEvent

```ts
type WorkerEvent =
  | { type: 'started'; runId: string; workerVersion: string }
  | { type: 'message'; role: 'worker' | 'tool'; text: string }
  | { type: 'tool_proposed'; proposal: ToolProposal }
  | { type: 'diff_proposed'; diffRef: ArtifactRef }
  | { type: 'artifact'; artifact: ArtifactRef }
  | { type: 'completed'; claim: WorkerClaim }
  | { type: 'failed'; error: NormalizedError };
```

## Result

```ts
type TaskResult = {
  taskId: string;
  workerClaim: WorkerClaim;
  actions: ExecutedAction[];
  diffs: ArtifactRef[];
  artifacts: ArtifactRef[];
  deterministicEvidence: Evidence[];
  securityEvidence: Evidence[];
  governanceFindings: Finding[];
  approvals: ApprovalRecord[];
  unresolvedRisks: string[];
  coreVerdict: 'pass' | 'fail' | 'blocked' | 'cancelled';
};
```
