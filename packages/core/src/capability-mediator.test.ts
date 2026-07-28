import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { ApprovalState, AuditEvent, CapabilityApproval } from '@intentsmith/contracts';
import type { CapabilityRequest } from '@intentsmith/worker-sdk';

import { ApprovalLedger } from './approvals.js';
import { CapabilityMediator, type ApprovalDecider } from './capability-mediator.js';
import type { ApprovalRepository, AuditRepository } from './ports.js';

/**
 * Capability mediation, end to end inside Core.
 *
 * The tool policy from the ledger and the single-use approval model meet here,
 * so these tests are about the whole answer: which tools get through, which are
 * refused outright, and what a yes actually authorizes.
 */

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

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
  async listByTask(): Promise<AuditEvent[]> {
    return this.events;
  }
}

function harness(decide: ApprovalDecider) {
  const root = mkdtempSync(path.join(tmpdir(), 'intentsmith-med-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'src'));
  writeFileSync(path.join(root, 'src', 'app.ts'), 'export const a = 1;\n');

  const approvals = new MemoryApprovals();
  const audit = new MemoryAudit();
  let counter = 0;
  const clock = { now: () => new Date(Date.parse('2026-07-28T12:00:00.000Z')).toISOString() };
  const ids = { next: (prefix: string) => `${prefix}_${(counter += 1)}` };
  const ledger = new ApprovalLedger({ approvals, audit, clock, ids });
  const mediator = new CapabilityMediator({
    ledger,
    audit,
    clock,
    ids,
    taskId: 'task_1',
    runId: 'run_1',
    workspaceRoot: root,
    decide,
  });
  return { mediator, ledger, approvals, audit, root, types: () => audit.events.map(event => event.type) };
}

const approveAll: ApprovalDecider = async () => 'approve';
const denyAll: ApprovalDecider = async () => 'deny';

const request = (root: string, overrides: Partial<CapabilityRequest> & { toolName: string }): CapabilityRequest => ({
  actionId: 'call_1',
  resourcePaths: [],
  payload: {},
  ...overrides,
});

describe('what gets through', () => {
  it('allows a workspace read without asking anyone', async () => {
    const h = harness(async () => {
      throw new Error('should not be asked');
    });
    const outcome = await h.mediator.mediate(
      request(h.root, { toolName: 'read', resourcePaths: ['src/app.ts'] }),
    );

    expect(outcome.allowed).toBe(true);
    expect(outcome.approvalId).toBeUndefined();
    // Still recorded: a validated action that leaves no trace cannot be reviewed.
    expect(h.types()).toEqual(['security.policy']);
  });

  it('allows an approved edit exactly once', async () => {
    const h = harness(approveAll);
    const edit = request(h.root, {
      toolName: 'edit',
      resourcePaths: ['src/app.ts'],
      payload: { filepath: 'src/app.ts', diff: '@@ -1 +1 @@' },
    });

    const first = await h.mediator.mediate(edit);
    expect(first.allowed).toBe(true);
    expect(h.types()).toEqual(['approval.requested', 'approval.granted', 'approval.consumed']);

    // The same action again is a new question, not a reuse of the old answer.
    const second = await h.mediator.mediate(edit);
    expect(second.allowed).toBe(false);
    expect(second.reason).toMatch(/already used; each approval authorizes one action/);
  });
});

describe('what is refused', () => {
  it('refuses bash without asking, even when the decider would approve', async () => {
    const h = harness(approveAll);
    const outcome = await h.mediator.mediate(
      request(h.root, { toolName: 'bash', command: 'npm test', payload: { command: 'npm test' } }),
    );

    expect(outcome.allowed).toBe(false);
    expect(outcome.reason).toMatch(/Arbitrary shell/);
    // No approval was ever created: a denied capability is not a question.
    expect(h.approvals.rows.size).toBe(0);
    expect(h.types()).toEqual(['security.policy']);
  });

  it('refuses webfetch in strict-local mode', async () => {
    const h = harness(approveAll);
    const outcome = await h.mediator.mediate(
      request(h.root, { toolName: 'webfetch', url: 'https://example.com', payload: { url: 'https://example.com' } }),
    );
    expect(outcome.allowed).toBe(false);
  });

  it('refuses an unclassified tool rather than guessing', async () => {
    const h = harness(approveAll);
    const outcome = await h.mediator.mediate(
      request(h.root, { toolName: 'todowrite', payload: { todos: [] } }),
    );
    expect(outcome.allowed).toBe(false);
    expect(outcome.reason).toMatch(/not yet observed|denied until classified|A familiar name/);
  });

  it('refuses an edit that escapes the workspace before anyone is asked', async () => {
    const h = harness(async () => {
      throw new Error('should not be asked');
    });
    const outcome = await h.mediator.mediate(
      request(h.root, { toolName: 'edit', resourcePaths: ['../../etc/passwd'], payload: {} }),
    );

    expect(outcome.allowed).toBe(false);
    expect(outcome.reason).toMatch(/outside the disposable workspace/);
  });

  it('refuses when the decider says no', async () => {
    const h = harness(denyAll);
    const outcome = await h.mediator.mediate(
      request(h.root, { toolName: 'write', resourcePaths: ['src/new.ts'], payload: { filepath: 'src/new.ts' } }),
    );

    expect(outcome.allowed).toBe(false);
    expect(h.types()).toEqual(['approval.requested', 'approval.denied']);
  });

  it('refuses when the decider fails, because a failure is not consent', async () => {
    const h = harness(async () => {
      throw new Error('the approval UI crashed');
    });
    const outcome = await h.mediator.mediate(
      request(h.root, { toolName: 'write', resourcePaths: ['src/new.ts'], payload: {} }),
    );

    expect(outcome.allowed).toBe(false);
    expect(h.types()).toContain('approval.denied');
  });

  it('refuses when the run ended while the question was open', async () => {
    const h = harness(async approval => {
      // The run is cancelled while the dialog is on screen.
      await h.ledger.revokeRun(approval.runId, 'Run cancelled.');
      return 'approve';
    });
    const outcome = await h.mediator.mediate(
      request(h.root, { toolName: 'edit', resourcePaths: ['src/app.ts'], payload: { diff: '@@' } }),
    );

    expect(outcome.allowed).toBe(false);
    expect(outcome.reason).toMatch(/expired or its run ended/);
  });
});
