import {
  CapabilityApprovalSchema,
  parseWithSchema,
  type ApprovalState,
  type AuditEvent,
  type CapabilityApproval,
} from '@intentsmith/contracts';
import { capabilityPayloadHash, type CapabilityDecision, type CapabilityRequest } from '@intentsmith/worker-sdk';

import { DomainError } from './errors.js';
import { KeyedMutex } from './mutex.js';
import type { ApprovalRepository, AuditRepository, Clock, IdGenerator } from './ports.js';

/**
 * Core's approval ledger.
 *
 * Everything a worker is allowed to do to the world passes through here, and
 * the design assumptions are deliberately pessimistic:
 *
 *  - an approval authorizes **one** action, once, and only the exact payload it
 *    was shown;
 *  - it expires, because an approval a user forgot about is not consent;
 *  - it is revoked when the run it belonged to ends, because permission granted
 *    for work that is no longer happening should not survive to authorize
 *    something else;
 *  - a restart never turns a pending question into a yes.
 *
 * There is no "always allow" and no API through which one could be added
 * without changing this type: `approve` decides a single approval by id, and
 * the id exists only because a specific request created it.
 */

export const DEFAULT_APPROVAL_TTL_MS = 5 * 60_000;

export type ApprovalLedgerOptions = {
  approvals: ApprovalRepository;
  audit: AuditRepository;
  clock: Clock;
  ids: IdGenerator;
  /** How long an unanswered approval stays answerable. */
  ttlMs?: number;
};

export type ApprovalRequestInput = {
  taskId: string;
  runId: string;
  request: CapabilityRequest;
  decision: Extract<CapabilityDecision, { outcome: 'requires_approval' }>;
};

/** Why a consumption attempt was refused. Never a near-miss that proceeds. */
export type ConsumptionRefusal =
  | 'no_approval'
  | 'payload_mismatch'
  | 'not_approved'
  | 'expired'
  | 'already_consumed'
  | 'revoked'
  | 'denied';

export type ConsumptionOutcome =
  | { allowed: true; approval: CapabilityApproval }
  | { allowed: false; refusal: ConsumptionRefusal; reason: string };

export class ApprovalLedger {
  private readonly ttlMs: number;
  /** Serializes decisions per approval so a race cannot interleave mid-check. */
  private readonly decisions = new KeyedMutex();

  constructor(private readonly options: ApprovalLedgerOptions) {
    this.ttlMs = options.ttlMs ?? DEFAULT_APPROVAL_TTL_MS;
  }

  /**
   * Records that a worker asked to do something, and returns the pending
   * approval a human still has to decide.
   *
   * Asking twice for the identical action and payload returns the existing
   * approval rather than a second one: a worker must not be able to multiply
   * its chances by repeating itself, and one question deserves one answer.
   */
  async request(input: ApprovalRequestInput): Promise<CapabilityApproval> {
    const payloadHash = capabilityPayloadHash(input.request);
    const existing = await this.options.approvals.findApproval(input.runId, input.request.actionId, payloadHash);
    if (existing) return existing;

    const requestedAt = this.options.clock.now();
    const approval: CapabilityApproval = {
      id: this.options.ids.next('approval'),
      taskId: input.taskId,
      runId: input.runId,
      actionId: input.request.actionId,
      toolName: input.request.toolName,
      capabilityId: input.decision.descriptor.id,
      payloadHash,
      resourcePaths: input.decision.resolvedPaths,
      state: 'pending',
      requestedAt,
      expiresAt: new Date(Date.parse(requestedAt) + this.ttlMs).toISOString(),
    };
    parseWithSchema(CapabilityApprovalSchema, approval);
    await this.options.approvals.createApproval(approval);
    await this.record(approval, 'approval.requested', `Worker requested ${approval.capabilityId}.`);
    return approval;
  }

  /**
   * Grants a single use of one approval.
   *
   * Allow-once only. The absence of a scope parameter here is the feature: an
   * approval cannot be widened to a tool, a path prefix or a session, so no
   * later call can inherit this decision.
   */
  async approve(approvalId: string): Promise<CapabilityApproval> {
    return await this.decide(approvalId, 'approved', 'approval.granted', 'Approved for a single use.');
  }

  async deny(approvalId: string, reason = 'Denied by the user.'): Promise<CapabilityApproval> {
    return await this.decide(approvalId, 'denied', 'approval.denied', reason);
  }

  private async decide(
    approvalId: string,
    state: Extract<ApprovalState, 'approved' | 'denied'>,
    type: Extract<AuditEvent['type'], 'approval.granted' | 'approval.denied'>,
    reason: string,
  ): Promise<CapabilityApproval> {
    return await this.decisions.run(approvalId, async () => {
      const approval = await this.load(approvalId);

      // Expiry is evaluated against the clock, not against whether a sweep has
      // run. An approval that timed out while the dialog sat open must not
      // become a grant just because nobody swept yet.
      if (approval.state === 'pending' && this.hasExpired(approval)) {
        await this.settle(approval, 'expired', 'approval.expired', 'Expired before it was answered.');
        throw new DomainError('APPROVAL_EXPIRED', `Approval "${approvalId}" expired before it was answered.`);
      }
      if (approval.state !== 'pending') {
        throw new DomainError(
          'APPROVAL_NOT_PENDING',
          `Approval "${approvalId}" is ${approval.state} and cannot be decided again.`,
        );
      }

      const settled = await this.settle(approval, state, type, reason);
      if (!settled) {
        // Another writer reached a terminal state first — cancellation or an
        // expiry sweep. The decision is refused rather than retried, because
        // the state it was made against no longer exists.
        throw new DomainError(
          'APPROVAL_NOT_PENDING',
          `Approval "${approvalId}" was settled by something else before this decision landed.`,
        );
      }
      return settled;
    });
  }

  /**
   * Spends an approval for the action that is about to happen.
   *
   * Called immediately before the worker is allowed to proceed. The payload is
   * re-hashed from what is actually being done, so an approval shown one diff
   * cannot authorize another.
   */
  async consume(input: { runId: string; request: CapabilityRequest }): Promise<ConsumptionOutcome> {
    const payloadHash = capabilityPayloadHash(input.request);
    const approval = await this.options.approvals.findApproval(
      input.runId,
      input.request.actionId,
      payloadHash,
    );

    if (!approval) {
      // Either nothing was ever approved for this action, or the payload
      // changed after approval. Both are refusals; the second is worth an audit
      // event of its own, because it is what an attempt to substitute a
      // different action looks like.
      const forAction = (await this.options.approvals.listApprovalsByRun(input.runId)).filter(
        entry => entry.actionId === input.request.actionId,
      );
      if (forAction.length > 0) {
        await this.recordMismatch(forAction[0] as CapabilityApproval, payloadHash);
        return {
          allowed: false,
          refusal: 'payload_mismatch',
          reason: 'The action presented for execution does not match what was approved.',
        };
      }
      return { allowed: false, refusal: 'no_approval', reason: 'No approval exists for this action.' };
    }

    return await this.decisions.run(approval.id, async () => {
      const current = await this.load(approval.id);

      if (current.state === 'approved' && this.hasExpired(current)) {
        await this.settle(current, 'expired', 'approval.expired', 'Expired before it was used.');
        return { allowed: false, refusal: 'expired', reason: 'The approval expired before it was used.' };
      }
      if (current.state === 'consumed') {
        return {
          allowed: false,
          refusal: 'already_consumed',
          reason: 'The approval was already used; each approval authorizes exactly one action.',
        };
      }
      if (current.state === 'revoked') {
        return { allowed: false, refusal: 'revoked', reason: 'The approval was revoked when its run ended.' };
      }
      if (current.state === 'denied') {
        return { allowed: false, refusal: 'denied', reason: 'The action was denied.' };
      }
      if (current.state !== 'approved') {
        return {
          allowed: false,
          refusal: 'not_approved',
          reason: `The approval is ${current.state} and does not authorize anything.`,
        };
      }

      const consumedAt = this.options.clock.now();
      const consumed: CapabilityApproval = { ...current, state: 'consumed', consumedAt };
      parseWithSchema(CapabilityApprovalSchema, consumed);
      if (!(await this.options.approvals.updateApprovalState(consumed, 'approved'))) {
        // Lost to a revocation or an expiry between the read and the write.
        return {
          allowed: false,
          refusal: 'revoked',
          reason: 'The approval stopped being valid before it could be used.',
        };
      }
      await this.record(consumed, 'approval.consumed', `Approval used for ${consumed.capabilityId}.`);
      return { allowed: true, approval: consumed };
    });
  }

  /**
   * Ends every outstanding approval belonging to a run.
   *
   * Called on cancellation, timeout and failure. An approval that outlived its
   * run would be a grant with nothing left to authorize, which is exactly the
   * kind of leftover permission that gets used for something else.
   */
  async revokeRun(runId: string, reason: string): Promise<number> {
    const outstanding = (await this.options.approvals.listApprovalsByRun(runId)).filter(
      approval => approval.state === 'pending' || approval.state === 'approved',
    );
    let revoked = 0;
    for (const approval of outstanding) {
      const settled = await this.decisions.run(approval.id, async () =>
        this.settle(approval, 'revoked', 'approval.revoked', reason),
      );
      if (settled) revoked += 1;
    }
    return revoked;
  }

  /** Expires everything past its TTL. Safe to call repeatedly. */
  async expireDue(): Promise<number> {
    const live = await this.options.approvals.listApprovalsByState(['pending', 'approved']);
    let expired = 0;
    for (const approval of live) {
      if (!this.hasExpired(approval)) continue;
      const settled = await this.decisions.run(approval.id, async () =>
        this.settle(approval, 'expired', 'approval.expired', 'Expired without being used.'),
      );
      if (settled) expired += 1;
    }
    return expired;
  }

  /**
   * Closes approvals left behind by a process that stopped.
   *
   * A pending approval found after a restart is expired, never approved: nobody
   * answered the question, and the fact that the process died is not consent.
   * An approved-but-unused one is revoked for the same reason — the run it
   * belonged to is gone.
   */
  async recoverAfterRestart(): Promise<number> {
    const stranded = await this.options.approvals.listApprovalsByState(['pending', 'approved']);
    let closed = 0;
    for (const approval of stranded) {
      const settled = await this.decisions.run(approval.id, async () =>
        approval.state === 'pending'
          ? this.settle(approval, 'expired', 'approval.expired', 'Unanswered when the process stopped.')
          : this.settle(approval, 'revoked', 'approval.revoked', 'Its run did not survive the restart.'),
      );
      if (settled) closed += 1;
    }
    return closed;
  }

  async listByRun(runId: string): Promise<CapabilityApproval[]> {
    return await this.options.approvals.listApprovalsByRun(runId);
  }

  private hasExpired(approval: CapabilityApproval): boolean {
    return Date.parse(this.options.clock.now()) >= Date.parse(approval.expiresAt);
  }

  private async load(approvalId: string): Promise<CapabilityApproval> {
    const approval = await this.options.approvals.getApproval(approvalId);
    if (!approval) throw new DomainError('APPROVAL_NOT_FOUND', `Approval "${approvalId}" does not exist.`);
    return approval;
  }

  /** Compare-and-set plus its audit event, or undefined when the race was lost. */
  private async settle(
    approval: CapabilityApproval,
    state: ApprovalState,
    type: AuditEvent['type'],
    reason: string,
  ): Promise<CapabilityApproval | undefined> {
    const settled: CapabilityApproval = {
      ...approval,
      state,
      decidedAt: this.options.clock.now(),
      reason,
    };
    parseWithSchema(CapabilityApprovalSchema, settled);
    if (!(await this.options.approvals.updateApprovalState(settled, approval.state))) return undefined;
    await this.record(settled, type, reason);
    return settled;
  }

  private async recordMismatch(approval: CapabilityApproval, presentedHash: string): Promise<void> {
    await this.append({
      taskId: approval.taskId,
      runId: approval.runId,
      type: 'approval.mismatch',
      message: `An action was presented for ${approval.actionId} that does not match its approval.`,
      data: {
        approvalId: approval.id,
        actionId: approval.actionId,
        approvedPayloadHash: approval.payloadHash,
        presentedPayloadHash: presentedHash,
      },
    });
  }

  private async record(approval: CapabilityApproval, type: AuditEvent['type'], message: string): Promise<void> {
    await this.append({
      taskId: approval.taskId,
      runId: approval.runId,
      type,
      message,
      data: {
        approvalId: approval.id,
        actionId: approval.actionId,
        toolName: approval.toolName,
        capabilityId: approval.capabilityId,
        payloadHash: approval.payloadHash,
        // Paths are recorded because an approval nobody can locate afterwards
        // is not evidence. They are inside the disposable workspace by
        // construction: the policy refused anything else before this point.
        resourcePaths: approval.resourcePaths,
        state: approval.state,
      },
    });
  }

  private async append(input: Omit<AuditEvent, 'id' | 'createdAt'>): Promise<void> {
    await this.options.audit.append({
      id: this.options.ids.next('audit'),
      createdAt: this.options.clock.now(),
      ...input,
    });
  }
}
