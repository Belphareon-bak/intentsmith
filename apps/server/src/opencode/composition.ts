import { OpenCodeWorker } from '@intentsmith/adapter-opencode';
import {
  ApprovalLedger,
  CapabilityMediator,
  type ApprovalDecider,
  type ApprovalRepository,
  type AuditRepository,
  type ChangeEvidenceCollector,
  type Clock,
  type IdGenerator,
  type WorkerAdapter,
  type WorkerExecutionContext,
} from '@intentsmith/core';
import type { GateCommandRunner, ProcessLimits } from '@intentsmith/process-runtime';
import type { GrantAudit } from '@intentsmith/worker-sdk';

import type { GatewayTokenStore } from '../gateway/token-store.js';
import { ApprovalDesk } from './approval-desk.js';
import { createGitChangeEvidenceCollector } from './change-evidence.js';
import { RunEvidenceRecorder } from './run-evidence.js';
import type { OpenCodeConfig } from './config.js';
import { GatewayGrantIssuer, createRunScopedWorker } from './run-grant-worker.js';

/**
 * The executable OpenCode authority stack.
 *
 * Until now every Phase 3 component that decides something — the approval
 * ledger, the capability mediator, Git-backed change evidence, the gate runner,
 * the run-scoped grant — was only ever assembled by a test. A product that
 * composes a fake worker instead cannot enforce any of it, so the guarantees
 * were real in the test suite and absent from the thing an operator runs.
 *
 * This module is where they are assembled for the product. Nothing here is a
 * second implementation: every part is the existing one, reached through its
 * package boundary.
 */

export type OpenCodeOverrides = {
  /**
   * Answers pending approvals.
   *
   * The default is the run-scoped {@link ApprovalDesk}, which suspends the
   * mediator until a human decides through the server's approval routes. An
   * override exists only so a test can decide deterministically; production
   * never installs one, and neither path can produce an automatic yes.
   */
  approvalDecider?: ApprovalDecider;
  preferSandbox?: boolean;
  limits?: Partial<ProcessLimits>;
  /** Injected for deterministic tests; defaults to bounded `execFile`. */
  gateRunner?: GateCommandRunner;
  gateTimeoutMs?: number;
  /** Observes grant issue/revoke records. Carries no secret, by construction. */
  onGrantAudit?: (audit: GrantAudit) => void;
};

export type OpenCodeStackOptions = {
  config: OpenCodeConfig;
  store: ApprovalRepository & AuditRepository;
  clock: Clock;
  ids: IdGenerator;
  tokens: GatewayTokenStore;
  overrides?: OpenCodeOverrides;
};

export type OpenCodeStack = {
  worker: WorkerAdapter;
  approvals: ApprovalLedger;
  /** The executable decision surface the server's approval routes talk to. */
  desk: ApprovalDesk;
  /** Durable sink for grant, inference-profile and protocol-attempt evidence. */
  evidence: RunEvidenceRecorder;
  changeEvidence: ChangeEvidenceCollector;
  /** Called once the gateway is listening. No run may start before it is. */
  bindGateway(baseUrl: string): void;
  /** Releases every suspended decision. Called when the server stops. */
  close(): void;
};

export function createOpenCodeStack(options: OpenCodeStackOptions): OpenCodeStack {
  const { config, store, clock, ids } = options;
  const overrides = options.overrides ?? {};

  const approvals = new ApprovalLedger({ approvals: store, audit: store, clock, ids });
  const desk = new ApprovalDesk(approvals);
  const decide = overrides.approvalDecider ?? desk.decider;
  const issuer = new GatewayGrantIssuer(options.tokens, config.modelId);

  const evidence = new RunEvidenceRecorder({ audit: store, clock, ids });

  const adapterOptionsFor = (context: WorkerExecutionContext | undefined): ConstructorParameters<
    typeof OpenCodeWorker
  >[0] => ({
    executable: config.executable,
    args: config.args,
    expectedVersion: config.expectedVersion,
    ...(overrides.preferSandbox === undefined ? {} : { preferSandbox: overrides.preferSandbox }),
    ...(overrides.limits ? { limits: overrides.limits } : {}),
    ...(context === undefined
      ? {}
      : {
          // A pid and nothing else. It is what 2C's proof that the real binary
          // and its process group are gone will have to be anchored to.
          onProcessStart: pid => evidence.processStarted(context.run.id, pid),
          onPermissionRequest: async request => {
            // The adapter asks; Core decides. The mediator is the only place a
            // capability request turns into a yes, and it is bound to this run.
            const mediator = new CapabilityMediator({
              ledger: approvals,
              audit: store,
              clock,
              ids,
              taskId: context.task.id,
              runId: context.run.id,
              workspaceRoot: config.workspaceRoot,
              decide,
            });
            const outcome = await mediator.mediate(request);
            return { allowed: outcome.allowed, reason: outcome.reason };
          },
        }),
  });

  const worker = createRunScopedWorker({
    describe: () => new OpenCodeWorker(adapterOptionsFor(undefined)).describe(),
    adapterFor: context => {
      const adapter = new OpenCodeWorker(adapterOptionsFor(context));
      // Registered before the adapter can produce anything, and holding the
      // adapter's own sandbox getter rather than a value a worker reported.
      evidence.beginRun(context.run.id, context.task.id, () => adapter.sandboxStatus);
      return adapter;
    },
    issuer,
    workspaceRoot: config.workspaceRoot,
    // The grant audit fires from `withGrant`'s `finally`, which is the one place
    // that runs on every terminal path this run can take. Releasing suspended
    // decisions from there makes waiter cleanup structural rather than a thing
    // each failure branch has to remember.
    onGrantAudit: audit => {
      desk.settleRun(audit.runId);
      evidence.grantSettled(audit);
      overrides.onGrantAudit?.(audit);
    },
  });

  const changeEvidence = createGitChangeEvidenceCollector({
    workspaceRoot: config.workspaceRoot,
    approvals,
    evidence,
    gates: config.gates,
    requiredGateIds: config.requiredGateIds,
    clock,
    ...(overrides.gateRunner ? { gateRunner: overrides.gateRunner } : {}),
    ...(overrides.gateTimeoutMs === undefined ? {} : { gateTimeoutMs: overrides.gateTimeoutMs }),
  });

  return {
    worker,
    approvals,
    desk,
    evidence,
    changeEvidence,
    bindGateway: baseUrl => issuer.bind(baseUrl),
    close: () => {
      desk.settleAll();
    },
  };
}
