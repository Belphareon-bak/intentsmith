import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { ApprovalState, AuditEvent, CapabilityApproval } from '@intentsmith/contracts';
import { evaluateCapabilityRequest, type CapabilityRequest } from '@intentsmith/worker-sdk';

import { ApprovalLedger } from './approvals.js';
import type { ApprovalRepository, AuditRepository } from './ports.js';

/**
 * Approval ledger.
 *
 * The guarantees under test are the ones a user is implicitly promised when a
 * permission dialog appears: this authorizes one action, this exact action, and
 * nothing after it.
 */

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function workspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'intentsmith-appr-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'src'));
  writeFileSync(path.join(root, 'src', 'app.ts'), 'export const a = 1;\n');
  return root;
}

/** In-memory repository with the same compare-and-set semantics as SQLite. */
class MemoryApprovals implements ApprovalRepository {
  readonly rows = new Map<string, CapabilityApproval>();

  async createApproval(approval: CapabilityApproval): Promise<void> {
    this.rows.set(approval.id, approval);
  }

  async getApproval(id: string): Promise<CapabilityApproval | null> {
    return this.rows.get(id) ?? null;
  }

  async findApproval(runId: string, actionId: string, payloadHash: string): Promise<CapabilityApproval | null> {
    for (const row of this.rows.values()) {
      if (row.runId === runId && row.actionId === actionId && row.payloadHash === payloadHash) return row;
    }
    return null;
  }

  async updateApprovalState(approval: CapabilityApproval, expectedState: ApprovalState): Promise<boolean> {
    const current = this.rows.get(approval.id);
    if (!current || current.state !== expectedState) return false;
    this.rows.set(approval.id, approval);
    return true;
  }

  async listApprovalsByRun(runId: string): Promise<CapabilityApproval[]> {
    return [...this.rows.values()].filter(row => row.runId === runId);
  }

  async listApprovalsByState(states: readonly ApprovalState[]): Promise<CapabilityApproval[]> {
    return [...this.rows.values()].filter(row => states.includes(row.state));
  }
}

class MemoryAudit implements AuditRepository {
  readonly events: AuditEvent[] = [];
  async append(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
  async listByTask(taskId: string): Promise<AuditEvent[]> {
    return this.events.filter(event => event.taskId === taskId);
  }
}

function harness(options: { ttlMs?: number } = {}) {
  const approvals = new MemoryApprovals();
  const audit = new MemoryAudit();
  let millis = Date.parse('2026-07-28T12:00:00.000Z');
  let counter = 0;
  const ledger = new ApprovalLedger({
    approvals,
    audit,
    clock: { now: () => new Date(millis).toISOString() },
    ids: { next: prefix => `${prefix}_${(counter += 1)}` },
    ...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
  });
  return {
    ledger,
    approvals,
    audit,
    advance: (ms: number) => {
      millis += ms;
    },
    types: () => audit.events.map(event => event.type),
  };
}

const root = (): string => workspace();

function editRequest(workspaceRoot: string, overrides: Partial<CapabilityRequest> = {}): CapabilityRequest {
  return {
    toolName: 'edit',
    actionId: 'call_1',
    resourcePaths: [path.join(workspaceRoot, 'src', 'app.ts')],
    payload: { filepath: path.join(workspaceRoot, 'src', 'app.ts'), diff: '@@ -1 +1 @@' },
    ...overrides,
  };
}

async function requestApproval(
  h: ReturnType<typeof harness>,
  workspaceRoot: string,
  request: CapabilityRequest,
): Promise<CapabilityApproval> {
  const decision = evaluateCapabilityRequest(request, { workspaceRoot });
  if (decision.outcome !== 'requires_approval') throw new Error(`unexpected decision: ${decision.outcome}`);
  return await h.ledger.request({ taskId: 'task_1', runId: 'run_1', request, decision });
}

describe('one approval, one action', () => {
  it('records a request as pending and never as permission', async () => {
    const h = harness();
    const ws = root();
    const approval = await requestApproval(h, ws, editRequest(ws));

    expect(approval.state).toBe('pending');
    expect(h.types()).toEqual(['approval.requested']);
    const outcome = await h.ledger.consume({ runId: 'run_1', request: editRequest(ws) });
    expect(outcome).toMatchObject({ allowed: false, refusal: 'not_approved' });
  });

  it('allows one use and refuses the second', async () => {
    const h = harness();
    const ws = root();
    const approval = await requestApproval(h, ws, editRequest(ws));
    await h.ledger.approve(approval.id);

    const first = await h.ledger.consume({ runId: 'run_1', request: editRequest(ws) });
    expect(first.allowed).toBe(true);

    const second = await h.ledger.consume({ runId: 'run_1', request: editRequest(ws) });
    expect(second).toMatchObject({ allowed: false, refusal: 'already_consumed' });
    expect(h.types()).toEqual(['approval.requested', 'approval.granted', 'approval.consumed']);
  });

  it('refuses an action whose payload changed after approval', async () => {
    const h = harness();
    const ws = root();
    const approval = await requestApproval(h, ws, editRequest(ws));
    await h.ledger.approve(approval.id);

    const substituted = editRequest(ws, { payload: { filepath: 'x', diff: '@@ something else @@' } });
    const outcome = await h.ledger.consume({ runId: 'run_1', request: substituted });

    expect(outcome).toMatchObject({ allowed: false, refusal: 'payload_mismatch' });
    expect(h.types()).toContain('approval.mismatch');
    // The original approval is untouched: a substitution attempt must not
    // silently spend the grant it failed to match.
    expect((await h.approvals.getApproval(approval.id))?.state).toBe('approved');
  });

  it('refuses an action nobody ever approved', async () => {
    const h = harness();
    const ws = root();
    const outcome = await h.ledger.consume({ runId: 'run_1', request: editRequest(ws) });
    expect(outcome).toMatchObject({ allowed: false, refusal: 'no_approval' });
  });

  it('answers a repeated identical question once', async () => {
    const h = harness();
    const ws = root();
    const first = await requestApproval(h, ws, editRequest(ws));
    const second = await requestApproval(h, ws, editRequest(ws));

    expect(second.id).toBe(first.id);
    expect(h.types()).toEqual(['approval.requested']);
  });

  it('refuses a denied action and keeps the denial in the record', async () => {
    const h = harness();
    const ws = root();
    const approval = await requestApproval(h, ws, editRequest(ws));
    await h.ledger.deny(approval.id, 'not this file');

    const outcome = await h.ledger.consume({ runId: 'run_1', request: editRequest(ws) });
    expect(outcome).toMatchObject({ allowed: false, refusal: 'denied' });
    expect(h.types()).toContain('approval.denied');
  });

  it('refuses to decide an approval twice', async () => {
    const h = harness();
    const ws = root();
    const approval = await requestApproval(h, ws, editRequest(ws));
    await h.ledger.approve(approval.id);

    await expect(h.ledger.approve(approval.id)).rejects.toMatchObject({ code: 'APPROVAL_NOT_PENDING' });
    await expect(h.ledger.deny(approval.id)).rejects.toMatchObject({ code: 'APPROVAL_NOT_PENDING' });
  });

  it('refuses to decide an approval that does not exist', async () => {
    const h = harness();
    await expect(h.ledger.approve('approval_nope')).rejects.toMatchObject({ code: 'APPROVAL_NOT_FOUND' });
  });
});

describe('expiry', () => {
  it('will not approve a question that timed out while the dialog sat open', async () => {
    const h = harness({ ttlMs: 1000 });
    const ws = root();
    const approval = await requestApproval(h, ws, editRequest(ws));

    h.advance(1001);
    await expect(h.ledger.approve(approval.id)).rejects.toMatchObject({ code: 'APPROVAL_EXPIRED' });
    expect((await h.approvals.getApproval(approval.id))?.state).toBe('expired');
    expect(h.types()).toContain('approval.expired');
  });

  it('refuses an approval that expired before it was used', async () => {
    const h = harness({ ttlMs: 1000 });
    const ws = root();
    const approval = await requestApproval(h, ws, editRequest(ws));
    await h.ledger.approve(approval.id);

    h.advance(5000);
    const outcome = await h.ledger.consume({ runId: 'run_1', request: editRequest(ws) });
    expect(outcome).toMatchObject({ allowed: false, refusal: 'expired' });
  });

  it('sweeps due approvals without touching live ones', async () => {
    const h = harness({ ttlMs: 1000 });
    const ws = root();
    await requestApproval(h, ws, editRequest(ws));
    h.advance(1001);
    const later = await requestApproval(h, ws, editRequest(ws, { actionId: 'call_2' }));

    expect(await h.ledger.expireDue()).toBe(1);
    expect((await h.approvals.getApproval(later.id))?.state).toBe('pending');
    expect(await h.ledger.expireDue()).toBe(0);
  });
});

describe('revocation and recovery', () => {
  it('revokes everything outstanding when a run ends', async () => {
    const h = harness();
    const ws = root();
    const pending = await requestApproval(h, ws, editRequest(ws));
    const granted = await requestApproval(h, ws, editRequest(ws, { actionId: 'call_2' }));
    await h.ledger.approve(granted.id);

    expect(await h.ledger.revokeRun('run_1', 'Run cancelled.')).toBe(2);
    expect((await h.approvals.getApproval(pending.id))?.state).toBe('revoked');
    expect((await h.approvals.getApproval(granted.id))?.state).toBe('revoked');

    const outcome = await h.ledger.consume({ runId: 'run_1', request: editRequest(ws, { actionId: 'call_2' }) });
    expect(outcome).toMatchObject({ allowed: false, refusal: 'revoked' });
  });

  it('leaves already-consumed approvals alone when the run ends', async () => {
    const h = harness();
    const ws = root();
    const approval = await requestApproval(h, ws, editRequest(ws));
    await h.ledger.approve(approval.id);
    await h.ledger.consume({ runId: 'run_1', request: editRequest(ws) });

    expect(await h.ledger.revokeRun('run_1', 'Run cancelled.')).toBe(0);
    expect((await h.approvals.getApproval(approval.id))?.state).toBe('consumed');
  });

  it('never turns a pending question into a yes after a restart', async () => {
    const h = harness();
    const ws = root();
    const pending = await requestApproval(h, ws, editRequest(ws));
    const granted = await requestApproval(h, ws, editRequest(ws, { actionId: 'call_2' }));
    await h.ledger.approve(granted.id);

    expect(await h.ledger.recoverAfterRestart()).toBe(2);
    expect((await h.approvals.getApproval(pending.id))?.state).toBe('expired');
    // An unused grant belongs to a run that no longer exists.
    expect((await h.approvals.getApproval(granted.id))?.state).toBe('revoked');
    expect(await h.ledger.recoverAfterRestart()).toBe(0);
  });
});

describe('races', () => {
  it('approve versus cancel produces exactly one winner', async () => {
    const h = harness();
    const ws = root();
    const approval = await requestApproval(h, ws, editRequest(ws));

    const [approved, revoked] = await Promise.allSettled([
      h.ledger.approve(approval.id),
      h.ledger.revokeRun('run_1', 'Cancelled while the dialog was open.'),
    ]);

    const finalState = (await h.approvals.getApproval(approval.id))?.state;
    expect(['approved', 'revoked']).toContain(finalState);

    if (finalState === 'revoked') {
      expect(approved.status).toBe('rejected');
      // Whoever lost must not be able to use the approval afterwards.
      const outcome = await h.ledger.consume({ runId: 'run_1', request: editRequest(ws) });
      expect(outcome.allowed).toBe(false);
    } else {
      expect(revoked.status).toBe('fulfilled');
      expect(revoked.status === 'fulfilled' ? revoked.value : -1).toBe(0);
    }

    // Whatever the order, the record shows one terminal decision, not two.
    const terminal = h.types().filter(type => type === 'approval.granted' || type === 'approval.revoked');
    expect(terminal).toHaveLength(1);
  });

  it('approve versus expire never yields a usable approval', async () => {
    const h = harness({ ttlMs: 1000 });
    const ws = root();
    const approval = await requestApproval(h, ws, editRequest(ws));
    h.advance(1001);

    const results = await Promise.allSettled([h.ledger.approve(approval.id), h.ledger.expireDue()]);
    expect((await h.approvals.getApproval(approval.id))?.state).toBe('expired');
    expect(results[0].status).toBe('rejected');

    const outcome = await h.ledger.consume({ runId: 'run_1', request: editRequest(ws) });
    expect(outcome.allowed).toBe(false);
  });

  it('two consumers of one approval produce exactly one execution', async () => {
    const h = harness();
    const ws = root();
    const approval = await requestApproval(h, ws, editRequest(ws));
    await h.ledger.approve(approval.id);

    const outcomes = await Promise.all([
      h.ledger.consume({ runId: 'run_1', request: editRequest(ws) }),
      h.ledger.consume({ runId: 'run_1', request: editRequest(ws) }),
    ]);

    expect(outcomes.filter(outcome => outcome.allowed)).toHaveLength(1);
    expect(h.types().filter(type => type === 'approval.consumed')).toHaveLength(1);
  });
});

describe('audit trail', () => {
  it('records every step in the life of an approval, in order', async () => {
    const h = harness();
    const ws = root();
    const approval = await requestApproval(h, ws, editRequest(ws));
    await h.ledger.approve(approval.id);
    await h.ledger.consume({ runId: 'run_1', request: editRequest(ws) });

    expect(h.types()).toEqual(['approval.requested', 'approval.granted', 'approval.consumed']);
    const consumed = h.audit.events.at(-1);
    expect(consumed?.data).toMatchObject({
      approvalId: approval.id,
      actionId: 'call_1',
      toolName: 'edit',
      capabilityId: 'filesystem.edit',
      payloadHash: approval.payloadHash,
    });
    expect(consumed?.runId).toBe('run_1');
  });

  it('lists the approvals of a run for evidence', async () => {
    const h = harness();
    const ws = root();
    await requestApproval(h, ws, editRequest(ws));
    await requestApproval(h, ws, editRequest(ws, { actionId: 'call_2' }));
    expect(await h.ledger.listByRun('run_1')).toHaveLength(2);
  });
});
