import type { CapabilityApproval } from '@intentsmith/contracts';
import { DomainError, type ApprovalDecider, type ApprovalLedger } from '@intentsmith/core';

/**
 * The place a human actually answers a pending approval.
 *
 * Until now the executable OpenCode path installed a decider that denied
 * everything and said why. That was honest but useless: a product where consent
 * is impossible is not a product where consent is enforced, it is one where the
 * question is never really asked.
 *
 * This is the missing half, and it is deliberately thin. It decides nothing and
 * grants nothing. The `CapabilityMediator` still owns the sequence — record the
 * request, ask, settle the ledger, spend the approval — and the `ApprovalLedger`
 * is still the only thing that can turn a request into permission. The desk
 * holds exactly one piece of state the ledger cannot: the *waiter*, the
 * suspended mediator call blocked on an answer, and it relays a human's answer
 * back to it.
 *
 * That split is what keeps the surface honest. Because the desk never writes to
 * the ledger, an HTTP route cannot produce a grant the mediator did not ask for,
 * cannot approve a request that was never recorded, and cannot approve anything
 * other than the exact payload the mediator hashed.
 *
 * The properties that matter:
 *
 *  - a waiter is addressed by run **and** approval id, so a decision cannot
 *    reach a different run's question;
 *  - a decision is delivered at most once: taking the waiter is what consumes
 *    it, and a second or contradicting decision finds nothing to deliver;
 *  - a waiter is removed on the first decision and on every terminal run path,
 *    so nothing stays suspended after the run it belonged to has ended;
 *  - a decision that arrives late finds no waiter, and the ledger has already
 *    revoked the approval behind it, so both layers refuse independently.
 *
 * There is no widening surface anywhere: a decision is an id and a verdict.
 * No tool, path, command, capability, resource, duration or scope can be
 * supplied by whoever answers, because the answer is only ever "yes to this
 * exact recorded request" or "no".
 */

export type ApprovalVerdict = 'approve' | 'deny';

/** Safe projection of a pending approval. Carries no secret and no payload. */
export type PendingApprovalView = {
  id: string;
  taskId: string;
  runId: string;
  actionId: string;
  toolName: string;
  capabilityId: string;
  /** Digest of the exact request. The decision is bound to this, not to a name. */
  payloadHash: string;
  resourcePaths: string[];
  requestedAt: string;
  expiresAt: string;
};

export type DecisionResult = {
  approval: PendingApprovalView;
  decision: ApprovalVerdict;
  /**
   * The decision was handed to the mediator, which settles the ledger next.
   * The desk deliberately does not report an approval state it did not write.
   */
  outcome: 'recorded';
};

export class ApprovalDeskError extends DomainError {
  constructor(code: string, message: string) {
    super(code, message);
  }
}

type Waiter = {
  runId: string;
  release: (verdict: ApprovalVerdict) => void;
};

export function describePending(approval: CapabilityApproval): PendingApprovalView {
  return {
    id: approval.id,
    taskId: approval.taskId,
    runId: approval.runId,
    actionId: approval.actionId,
    toolName: approval.toolName,
    capabilityId: approval.capabilityId,
    payloadHash: approval.payloadHash,
    resourcePaths: approval.resourcePaths,
    requestedAt: approval.requestedAt,
    expiresAt: approval.expiresAt,
  };
}

export class ApprovalDesk {
  /** Suspended mediator calls, keyed by approval id. */
  private readonly waiters = new Map<string, Waiter>();
  /**
   * Answers already delivered.
   *
   * Kept so a repeated or contradicting decision is refused as a conflict
   * rather than reported as an unknown id. It is a memo, never an authority:
   * nothing is ever read from here to permit anything.
   */
  private readonly delivered = new Map<string, { runId: string; verdict: ApprovalVerdict }>();

  constructor(private readonly ledger: ApprovalLedger) {}

  /**
   * The decider installed on the executable path.
   *
   * Suspends until somebody decides through {@link decide}, or until the run
   * ends. A run that ends first resolves as `deny`: the mediator must be told
   * something, and the only safe something is no.
   */
  get decider(): ApprovalDecider {
    return async approval =>
      await new Promise<ApprovalVerdict>(resolve => {
        // A repeat for an id already waiting cannot happen — the ledger returns
        // the existing approval and the mediator refuses a non-pending one — but
        // if it ever did, the newest waiter must not orphan the old.
        this.waiters.get(approval.id)?.release('deny');
        this.waiters.set(approval.id, { runId: approval.runId, release: resolve });
      });
  }

  /**
   * Approvals of one exact run that are pending **and** awaiting an answer.
   *
   * Both halves are required. The ledger knows which requests are unanswered;
   * only the desk knows which of them still have somebody listening. A row left
   * pending by a run that has gone is not something an operator can usefully
   * decide, and offering it would invite a decision that quietly does nothing.
   */
  async listPending(runId: string): Promise<PendingApprovalView[]> {
    const approvals = await this.ledger.listByRun(runId);
    return approvals
      .filter(approval => approval.state === 'pending' && this.waiters.get(approval.id)?.runId === runId)
      .map(describePending);
  }

  /**
   * Delivers one decision for one exact pending approval.
   *
   * The run id is not decoration: an approval id alone would be enough to decide
   * it, and requiring the pair means an id learned from one run cannot be spent
   * against another. A mismatch is reported as "not found" rather than "wrong
   * run", so the surface does not confirm that an id exists elsewhere.
   */
  async decide(runId: string, approvalId: string, verdict: ApprovalVerdict): Promise<DecisionResult> {
    const already = this.delivered.get(approvalId);
    if (already && already.runId === runId) {
      throw new ApprovalDeskError(
        'APPROVAL_NOT_PENDING',
        `Approval "${approvalId}" was already decided (${already.verdict}) and cannot be decided again.`,
      );
    }

    const waiter = this.waiters.get(approvalId);
    if (!waiter || waiter.runId !== runId) {
      // Unknown id, an id from another run, or a run that has already ended.
      throw new ApprovalDeskError(
        'APPROVAL_NOT_FOUND',
        `No approval "${approvalId}" is awaiting a decision in run "${runId}".`,
      );
    }

    // The ledger is consulted before the answer is delivered, so an approval
    // that expired or was revoked while the question sat open is refused here
    // rather than becoming a decision the mediator then fails to apply.
    const approval = (await this.ledger.listByRun(runId)).find(entry => entry.id === approvalId);
    if (!approval) {
      throw new ApprovalDeskError(
        'APPROVAL_NOT_FOUND',
        `No approval "${approvalId}" belongs to run "${runId}".`,
      );
    }
    if (approval.state !== 'pending') {
      throw new ApprovalDeskError(
        'APPROVAL_NOT_PENDING',
        `Approval "${approvalId}" is ${approval.state} and cannot be decided.`,
      );
    }

    // Taking the waiter is what consumes the decision. Everything after this
    // point is delivery; a concurrent second call finds nothing to take.
    this.waiters.delete(approvalId);
    this.delivered.set(approvalId, { runId, verdict });
    waiter.release(verdict);

    return { approval: describePending(approval), decision: verdict, outcome: 'recorded' };
  }

  /**
   * Ends every waiter belonging to a run.
   *
   * Called from the one place that already runs on every terminal path — cancel,
   * timeout, worker failure, protocol failure, spawn failure and shutdown — so a
   * pending question cannot outlive the run that asked it. The verdict is `deny`
   * because the ledger is about to revoke the approval anyway, and because a run
   * that has ended must not be able to perform the side effect.
   */
  settleRun(runId: string): number {
    let settled = 0;
    for (const [approvalId, waiter] of [...this.waiters]) {
      if (waiter.runId !== runId) continue;
      this.waiters.delete(approvalId);
      waiter.release('deny');
      settled += 1;
    }
    return settled;
  }

  /** Ends every waiter. Called when the server itself stops. */
  settleAll(): number {
    const count = this.waiters.size;
    for (const waiter of [...this.waiters.values()]) waiter.release('deny');
    this.waiters.clear();
    return count;
  }

  /** Waiters still suspended. Used by tests to prove none are left behind. */
  get pendingWaiterCount(): number {
    return this.waiters.size;
  }
}
