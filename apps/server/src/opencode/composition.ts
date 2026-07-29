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
import { createGitChangeEvidenceCollector } from './change-evidence.js';
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
   * There is no HTTP or CLI decision surface yet, so the default denies and
   * says why. That is deliberate: an unanswered question is not consent, and an
   * automatic yes here would be exactly the standing permission the ledger
   * exists to make impossible.
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
  changeEvidence: ChangeEvidenceCollector;
  /** Called once the gateway is listening. No run may start before it is. */
  bindGateway(baseUrl: string): void;
};

/** Refusal used until the approval decision surface exists. */
export const NO_DECISION_SURFACE: ApprovalDecider = async () => 'deny';

export function createOpenCodeStack(options: OpenCodeStackOptions): OpenCodeStack {
  const { config, store, clock, ids } = options;
  const overrides = options.overrides ?? {};

  const approvals = new ApprovalLedger({ approvals: store, audit: store, clock, ids });
  const decide = overrides.approvalDecider ?? NO_DECISION_SURFACE;
  const issuer = new GatewayGrantIssuer(options.tokens, config.modelId);

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
    adapterFor: context => new OpenCodeWorker(adapterOptionsFor(context)),
    issuer,
    workspaceRoot: config.workspaceRoot,
    ...(overrides.onGrantAudit ? { onGrantAudit: overrides.onGrantAudit } : {}),
  });

  const changeEvidence = createGitChangeEvidenceCollector({
    workspaceRoot: config.workspaceRoot,
    approvals,
    gates: config.gates,
    requiredGateIds: config.requiredGateIds,
    clock,
    ...(overrides.gateRunner ? { gateRunner: overrides.gateRunner } : {}),
    ...(overrides.gateTimeoutMs === undefined ? {} : { gateTimeoutMs: overrides.gateTimeoutMs }),
  });

  return {
    worker,
    approvals,
    changeEvidence,
    bindGateway: baseUrl => issuer.bind(baseUrl),
  };
}
