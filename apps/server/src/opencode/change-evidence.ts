import type { Evidence, Task, TaskRun } from '@intentsmith/contracts';
import type { ApprovalLedger, ChangeEvidenceCollector, Clock, CollectedChangeEvidence } from '@intentsmith/core';
import {
  captureProposedChanges,
  isAcceptable,
  relativePaths,
  runGates,
  type CapturedChangeSet,
  type GateCommandRunner,
  type GateDefinition,
  type GateResult,
} from '@intentsmith/process-runtime';
import type { ApprovalEvidenceReference } from '@intentsmith/worker-sdk';

/**
 * Git-backed change evidence for the executable OpenCode path.
 *
 * The worker's account of its own work is not an input here. What a run
 * produced is read out of the workspace's repository afterwards, the gates are
 * commands IntentSmith chose and the worker could not touch, and the approvals
 * are the ones the ledger actually recorded. A worker cannot supply a diff, a
 * digest or a gate result through any of these paths, so "the agent said it
 * worked" can never be what makes a code task pass.
 *
 * `ProposedChangeSet.authoritativeSource` is `'git'` by construction: capture is
 * its only producer.
 */

export type GitChangeEvidenceOptions = {
  /** Repository the worker edited. Never the user's real project. */
  workspaceRoot: string;
  /** The ledger the mediator wrote to, so approvals come from one source. */
  approvals: ApprovalLedger;
  gates: readonly GateDefinition[];
  requiredGateIds: readonly string[];
  clock: Clock;
  /** Injected for deterministic tests; defaults to bounded `execFile`. */
  gateRunner?: GateCommandRunner;
  gateTimeoutMs?: number;
};

export function createGitChangeEvidenceCollector(options: GitChangeEvidenceOptions): ChangeEvidenceCollector {
  return {
    collect: async ({ task, run }) => {
      const gateResults = await runGateSuite(options);
      const approvalReferences = await readApprovals(options.approvals, run.id);
      const captured = await captureProposedChanges({
        workspaceRoot: options.workspaceRoot,
        approvals: approvalReferences,
        gates: gateResults,
        requiredGateIds: options.requiredGateIds,
        // An edit task that changed nothing has not done the work, whatever the
        // worker claims. Other task types are judged on gates alone.
        requireChanges: task.type === 'code',
        ...(options.gateRunner ? { runner: options.gateRunner } : {}),
      });
      return describeEvidence(captured, gateResults, approvalReferences, task, run, options.clock);
    },
  };
}

async function runGateSuite(options: GitChangeEvidenceOptions): Promise<GateResult[]> {
  return await runGates(options.gates, {
    cwd: options.workspaceRoot,
    // A fixed, minimal environment. Nothing the worker wrote can change how the
    // command that judges it behaves.
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
    ...(options.gateTimeoutMs === undefined ? {} : { timeoutMs: options.gateTimeoutMs }),
    ...(options.gateRunner ? { runner: options.gateRunner } : {}),
  });
}

async function readApprovals(ledger: ApprovalLedger, runId: string): Promise<ApprovalEvidenceReference[]> {
  return (await ledger.listByRun(runId)).map(approval => ({
    approvalId: approval.id,
    actionId: approval.actionId,
    payloadHash: approval.payloadHash,
    resourcePaths: approval.resourcePaths,
    state: approval.state,
  }));
}

function describeEvidence(
  captured: CapturedChangeSet,
  gateResults: readonly GateResult[],
  approvalReferences: readonly ApprovalEvidenceReference[],
  task: Task,
  run: TaskRun,
  clock: Clock,
): CollectedChangeEvidence {
  const producedAt = clock.now();
  const gateEvidence: Evidence[] = gateResults.map(gate => ({
    id: `gate_${gate.id}`,
    kind: 'test',
    status: gate.status,
    summary: `${gate.description}: ${gate.status}`,
    producedAt,
  }));

  const diffUri = captured.diffDigest ? `intentsmith://git-diff/${captured.diffDigest}` : undefined;

  return {
    acceptable: isAcceptable(captured),
    findings: [...captured.policyFindings, ...captured.unresolvedRisks],
    ...(captured.unavailableReason === undefined ? {} : { unavailableReason: captured.unavailableReason }),
    gateEvidence,
    // The only diff IntentSmith records is the one Git produced.
    diffs:
      captured.diffArtifact && diffUri
        ? [{ id: captured.diffArtifact.id, kind: 'diff', uri: diffUri, sha256: captured.diffArtifact.sha256 }]
        : [],
    approvals: approvalReferences.map(reference => ({
      id: reference.approvalId,
      taskId: task.id,
      runId: run.id,
      action: reference.actionId,
      decision: reference.state === 'denied' ? ('denied' as const) : ('approved' as const),
      decidedAt: producedAt,
    })),
    auditLinks: {
      authoritativeSource: captured.authoritativeSource,
      changedPaths: relativePaths(captured),
      diffDigest: captured.diffDigest ?? null,
      diffUri: diffUri ?? null,
      approvalIds: captured.approvalReferences.map(reference => reference.approvalId),
      gateEvidenceUris: captured.gateEvidence.map(gate => gate.evidenceUri),
    },
  };
}
