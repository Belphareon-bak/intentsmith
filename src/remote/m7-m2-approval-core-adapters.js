import { createHash } from 'node:crypto';

import {
  canonicalizeM2LifecycleValue,
  computeM2LifecyclePlanSnapshotDigest,
} from '../../contracts/m2/lifecycle-v1.js';
import {
  isM2LifecycleApprovalPort,
} from '../lifecycle/m2-lifecycle-application-service.js';
import {
  computeM7CoreCursorFilterDigest,
  createM7CoreCursorCodec,
} from './m7-core-cursor.js';

export const M7_M2_APPROVAL_ADAPTER_STAGE = 'IMPLEMENTED_NOT_ACTIVE';

export const M7_M2_APPROVAL_ERROR = Object.freeze({
  AUTHORITY_INVALID: 'M7_M2_APPROVAL_AUTHORITY_INVALID',
  DECISION_REJECTED: 'M7_M2_APPROVAL_DECISION_REJECTED',
  INPUT_INVALID: 'M7_M2_APPROVAL_INPUT_INVALID',
  READ_FAILED: 'M7_M2_APPROVAL_READ_FAILED',
  VIEW_STALE: 'M7_M2_APPROVAL_VIEW_STALE',
});

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAX_APPROVAL_SCAN = 2_000;

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function requireContext(value) {
  if (!value || !IDENTIFIER.test(value.deviceId || '') || !IDENTIFIER.test(value.subjectId || '')) {
    const error = new TypeError('m7-m2-approval:trusted-context-invalid');
    error.code = M7_M2_APPROVAL_ERROR.INPUT_INVALID;
    throw error;
  }
  return value;
}

function digest(value) {
  return `sha256:${createHash('sha256')
    .update(canonicalizeM2LifecycleValue(value), 'utf8')
    .digest('hex')}`;
}

function revision(prefix, value) {
  return `rev:${prefix}:${digest(value).slice(7)}`;
}

function remoteError(code, message, retryable = false) {
  return { code, message, retryable };
}

function approvalState(status, nowMs) {
  if (status.approval) return 'approved';
  if (status.cancelRequested || status.terminal?.state === 'cancelled') return 'rejected';
  if (status.terminal) return 'superseded';
  if (Date.parse(status.plan.approvalExpiresAt) <= nowMs) return 'expired';
  return 'pending';
}

function riskClass(plan) {
  if (plan.gitCommit !== null) return 'high';
  return plan.changes.length > 1 ? 'high' : 'medium';
}

function projectApproval(status, nowMs) {
  const plan = status?.plan;
  if (!plan || plan.state !== 'awaiting_approval') {
    throw new TypeError('m7-m2-approval:canonical-plan-required');
  }
  const planDigest = computeM2LifecyclePlanSnapshotDigest(plan);
  if (planDigest !== status.planDigest) {
    throw new TypeError('m7-m2-approval:plan-digest-mismatch');
  }
  const state = approvalState(status, nowMs);
  const base = {
    approvalId: plan.identity.lifecycleId,
    projectId: plan.project.projectId,
    runId: plan.identity.runId,
    effectKind: 'lifecycle.project-change',
    riskClass: riskClass(plan),
    summary: `Project change with ${plan.changes.length} file${plan.changes.length === 1 ? '' : 's'}.`,
    details: plan.changes.slice(0, 32).map(change => `Write ${change.path}`),
    payloadFingerprint: planDigest,
    createdAt: plan.createdAt,
    expiresAt: plan.approvalExpiresAt,
    state,
  };
  const approvalViewDigest = digest(base);
  return deepFreeze({
    ...base,
    approvalViewDigest,
    revision: revision('approval', {
      approvalViewDigest,
      approvalIntentDigest: status.approval?.intentDigest ?? null,
      cancelRequested: status.cancelRequested,
      terminal: status.terminal,
    }),
  });
}

function readFailure(requestId, code, message, retryable = false) {
  return deepFreeze({
    contract: 'ApprovalPage', version: 1, requestId, status: 'error',
    error: remoteError(code, message, retryable),
  });
}

function decisionFailure(request, item, code, message, retryable = false) {
  return deepFreeze({
    contract: 'ApprovalDecisionResult', version: 1,
    requestId: request.requestId,
    operationId: request.operationId,
    approvalId: request.approvalId,
    decision: request.decision,
    approvalState: item?.state === 'pending' ? 'superseded' : item?.state ?? 'superseded',
    payloadFingerprint: item?.payloadFingerprint ?? request.expectedPayloadFingerprint,
    revision: item?.revision ?? request.expectedRevision,
    outcome: 'REJECTED',
    replayed: false,
    error: remoteError(code, message, retryable),
  });
}

export function createM7M2ApprovalCoreAdapters({
  approvalPort,
  cursorKey,
  maxApprovalScan = MAX_APPROVAL_SCAN,
  now = Date.now,
} = {}) {
  if (!isM2LifecycleApprovalPort(approvalPort)) {
    throw new TypeError('m7-m2-approval:genuine-m2-port-required');
  }
  if (typeof now !== 'function'
    || !Number.isSafeInteger(maxApprovalScan)
    || maxApprovalScan < 1
    || maxApprovalScan > MAX_APPROVAL_SCAN) {
    throw new TypeError('m7-m2-approval:config-invalid');
  }
  const cursorCodec = createM7CoreCursorCodec({ key: cursorKey });

  function trustedNow() {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError('m7-m2-approval:clock-invalid');
    }
    return value;
  }

  function currentItem(subjectId, approvalId, nowMs) {
    return projectApproval(approvalPort.getOwnedStatus({
      subjectId,
      lifecycleId: approvalId,
    }), nowMs);
  }

  async function listApprovals(request, trustedContext) {
    const context = requireContext(trustedContext);
    try {
      const nowMs = trustedNow();
      const owned = approvalPort.listOwned({
        subjectId: context.subjectId,
        limit: maxApprovalScan + 1,
      });
      if (owned.length > maxApprovalScan) throw new TypeError('approval scan limit exceeded');
      const requestedStates = request.states ?? [
        'approved', 'expired', 'pending', 'rejected', 'superseded',
      ];
      const allItems = owned.map(row => currentItem(context.subjectId, row.lifecycleId, nowMs));
      const filtered = allItems.filter(item => requestedStates.includes(item.state));
      const filterDigest = computeM7CoreCursorFilterDigest({
        limit: request.limit,
        states: requestedStates,
      });
      const snapshotRevision = revision('approval-snapshot', allItems.map(item => ({
        approvalId: item.approvalId,
        revision: item.revision,
      })));
      let offset = 0;
      if (request.cursor) offset = cursorCodec.decode(request.cursor, {
        capabilityId: 'approvals', capabilityVersion: 1,
        operationId: 'approval.list', deviceId: context.deviceId,
        subjectId: context.subjectId, filterDigest, snapshotRevision,
      }).offset;
      if (offset > filtered.length) throw new TypeError('approval cursor offset invalid');
      const items = filtered.slice(offset, offset + request.limit);
      const nextOffset = offset + items.length;
      const end = nextOffset >= filtered.length;
      return deepFreeze({
        contract: 'ApprovalPage', version: 1, requestId: request.requestId,
        status: 'ok', items, end,
        nextCursor: end ? null : cursorCodec.encode({
          capabilityId: 'approvals', capabilityVersion: 1,
          operationId: 'approval.list', deviceId: context.deviceId,
          subjectId: context.subjectId, filterDigest, snapshotRevision,
          offset: nextOffset,
        }),
        snapshotRevision,
      });
    } catch {
      return readFailure(
        request.requestId,
        'REMOTE_APPROVAL_READ_FAILED',
        'M2 approvals could not be read safely.',
        true,
      );
    }
  }

  async function decideApproval(request, trustedContext) {
    const context = requireContext(trustedContext);
    let nowMs;
    let item;
    try {
      nowMs = trustedNow();
      item = currentItem(context.subjectId, request.approvalId, nowMs);
      const exactView = item.payloadFingerprint === request.expectedPayloadFingerprint
        && item.approvalViewDigest === request.expectedViewDigest
        && item.revision === request.expectedRevision;
      if (!exactView) return decisionFailure(
        request, item, 'REMOTE_APPROVAL_VIEW_STALE',
        'The approval view changed before the decision.',
      );
      if (item.state !== 'pending') return decisionFailure(
        request, item, 'REMOTE_APPROVAL_NOT_PENDING',
        'The M2 approval is no longer pending.',
      );
      if (request.decision === 'approve') {
        await approvalPort.approveOwned({
          subjectId: context.subjectId,
          lifecycleId: request.approvalId,
          planDigest: item.payloadFingerprint,
        });
      } else {
        await approvalPort.rejectOwned({
          subjectId: context.subjectId,
          lifecycleId: request.approvalId,
        });
      }
      const decided = currentItem(context.subjectId, request.approvalId, trustedNow());
      const expectedState = request.decision === 'approve' ? 'approved' : 'rejected';
      if (decided.state !== expectedState) {
        return decisionFailure(
          request, decided, 'REMOTE_APPROVAL_DECISION_UNCOMMITTED',
          'The M2 authority did not record the requested terminal decision.',
          true,
        );
      }
      return deepFreeze({
        contract: 'ApprovalDecisionResult', version: 1,
        requestId: request.requestId, operationId: request.operationId,
        approvalId: request.approvalId, decision: request.decision,
        approvalState: decided.state,
        payloadFingerprint: decided.payloadFingerprint,
        revision: decided.revision,
        outcome: 'CONFIRMED', replayed: false,
      });
    } catch {
      return decisionFailure(
        request, item, 'REMOTE_APPROVAL_DECISION_REJECTED',
        'The M2 approval decision was rejected safely.',
        false,
      );
    }
  }

  const handlers = deepFreeze({
    'approval.decide': decideApproval,
    'approval.list': listApprovals,
  });
  return Object.freeze({ decideApproval, handlers, listApprovals });
}

export default createM7M2ApprovalCoreAdapters;
