import type { AuditEvent, CapabilityApproval } from '@intentsmith/contracts';
import { evaluateCapabilityRequest, type CapabilityRequest } from '@intentsmith/worker-sdk';

import type { ApprovalLedger } from './approvals.js';
import type { AuditRepository, Clock, IdGenerator } from './ports.js';

/**
 * Turns a worker's capability request into an answer.
 *
 * This is the single place where "may this happen?" is decided, and it runs
 * before the worker acts rather than alongside it. The order is deliberate and
 * is the property the whole phase rests on: classify, confine, ask, grant,
 * spend — and only then does the worker proceed.
 *
 * Nothing here executes anything either. It returns a yes or a no; the worker
 * performs its own action, under its own permission handling, having been told
 * what IntentSmith decided.
 */

/** How a human answers one pending approval. */
export type ApprovalDecider = (approval: CapabilityApproval) => Promise<'approve' | 'deny'>;

export type CapabilityMediatorOptions = {
  ledger: ApprovalLedger;
  audit: AuditRepository;
  clock: Clock;
  ids: IdGenerator;
  taskId: string;
  runId: string;
  /** Absolute root the worker is confined to. Never the user's real project. */
  workspaceRoot: string;
  /**
   * Asked once per approval that policy says needs one.
   *
   * A decider that throws, hangs past the approval's TTL, or is absent results
   * in a refusal: an unanswered question is not consent.
   */
  decide: ApprovalDecider;
};

export type MediationOutcome = {
  allowed: boolean;
  reason: string;
  approvalId?: string;
};

export class CapabilityMediator {
  constructor(private readonly options: CapabilityMediatorOptions) {}

  async mediate(request: CapabilityRequest): Promise<MediationOutcome> {
    const decision = evaluateCapabilityRequest(request, { workspaceRoot: this.options.workspaceRoot });

    if (decision.outcome === 'deny') {
      await this.note('Policy denied a capability request.', {
        toolName: request.toolName,
        actionId: request.actionId,
        capabilityId: decision.descriptor.id,
        outcome: 'denied_by_policy',
        reason: decision.reason,
      });
      return { allowed: false, reason: decision.reason };
    }

    if (decision.outcome === 'allow_validated') {
      // Read-only and confined to the workspace. There is nothing for a human
      // to decide, but the fact that it happened is still recorded: a validated
      // action that leaves no trace cannot be reviewed afterwards.
      await this.note('Read-only capability allowed after path validation.', {
        toolName: request.toolName,
        actionId: request.actionId,
        capabilityId: decision.descriptor.id,
        outcome: 'allowed_validated',
        resourcePaths: decision.resolvedPaths,
      });
      return { allowed: true, reason: 'Read-only action inside the workspace.' };
    }

    const approval = await this.options.ledger.request({
      taskId: this.options.taskId,
      runId: this.options.runId,
      request,
      decision,
    });

    if (approval.state !== 'pending') {
      // The identical action was already decided in this run. Asking again
      // would give a worker a second chance at a question that has an answer,
      // so the existing answer stands.
      return {
        allowed: false,
        reason:
          approval.state === 'consumed'
            ? 'This exact action was already used; each approval authorizes one action.'
            : `This action was already decided and is ${approval.state}.`,
        approvalId: approval.id,
      };
    }

    let answer: 'approve' | 'deny';
    try {
      answer = await this.options.decide(approval);
    } catch {
      // A decider that failed did not say yes. The detail is deliberately not
      // propagated: it is the worker's session that would receive it.
      answer = 'deny';
    }

    if (answer === 'deny') {
      try {
        await this.options.ledger.deny(approval.id, 'Denied.');
      } catch {
        // Already settled while the question was open: revoked with its run,
        // expired, or denied by whoever answered. Every one of those is already
        // a refusal, so the answer stands and nothing is retried. Letting this
        // escape would turn a late "no" into a rejected promise on a request the
        // adapter has usually stopped waiting for.
      }
      return { allowed: false, reason: 'The action was denied.', approvalId: approval.id };
    }

    try {
      await this.options.ledger.approve(approval.id);
    } catch {
      // Expired or revoked while the question was open.
      return {
        allowed: false,
        reason: 'The approval could not be granted; it expired or its run ended.',
        approvalId: approval.id,
      };
    }

    // Spend it immediately: the worker acts next, and an approval that is
    // granted but never consumed would be a permission left lying around.
    const consumption = await this.options.ledger.consume({ runId: this.options.runId, request });
    return consumption.allowed
      ? { allowed: true, reason: 'Approved for this single action.', approvalId: approval.id }
      : { allowed: false, reason: consumption.reason, approvalId: approval.id };
  }

  private async note(message: string, data: Record<string, unknown>): Promise<void> {
    const event: AuditEvent = {
      id: this.options.ids.next('audit'),
      taskId: this.options.taskId,
      runId: this.options.runId,
      type: 'security.policy',
      message,
      data,
      createdAt: this.options.clock.now(),
    };
    await this.options.audit.append(event);
  }
}
