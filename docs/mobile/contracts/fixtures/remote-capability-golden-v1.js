// Golden provider-conformance fixtures for the mobile RemoteCore candidate.
// These are sanitized synthetic values. They contain no production data and
// authorize no backend implementation or network exposure.

const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;
const WSR_A = `wsr1:${'a'.repeat(64)}`;
const CURSOR_A = 'cursor:v1:fixture:0001';
const T0 = '2026-08-27T12:00:00.000Z';
const T1 = '2026-08-27T12:01:00.000Z';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const error = (code = 'REMOTE_PROVIDER_UNAVAILABLE') => ({
  code,
  message: 'Sanitized remote provider error.',
  retryable: code === 'REMOTE_PROVIDER_UNAVAILABLE',
});

const readError = (contract, requestId, extra = {}) => ({
  contract,
  version: 1,
  requestId,
  status: 'error',
  error: error(),
  ...extra,
});

const mutationError = (contract, request, extra = {}) => ({
  contract,
  version: 1,
  requestId: request.requestId,
  operationId: request.operationId,
  revision: 'rev:rejected:001',
  outcome: 'REJECTED',
  replayed: false,
  error: error('REMOTE_CONFLICT'),
  ...extra,
});

const operation = ({ capabilityId, capabilityVersion, operationId, request, success, failure }) => ({
  capabilityId,
  capabilityVersion,
  operationId,
  request,
  success,
  failure,
});

const approvalListRequest = {
  contract: 'ApprovalListQuery', version: 1, requestId: 'request:approval:list:001', limit: 25,
  states: ['pending'],
};
const approvalDecisionRequest = {
  contract: 'ApprovalDecisionCommand', version: 1, requestId: 'request:approval:decide:001',
  operationId: 'operation:approval:decide:001', approvalId: 'approval:001', decision: 'approve',
  expectedPayloadFingerprint: DIGEST_A, expectedViewDigest: DIGEST_B, expectedRevision: 'rev:approval:001',
};
const conversationListRequest = {
  contract: 'ConversationListQuery', version: 1, requestId: 'request:conversation:list:001', limit: 25,
};
const conversationHistoryRequest = {
  contract: 'ConversationHistoryQuery', version: 1, requestId: 'request:conversation:history:001',
  conversationId: 'conversation:001', limit: 25, anchor: 'latest',
};
const conversationExecuteRequest = {
  contract: 'ConversationCommand', version: 1, requestId: 'request:conversation:execute:001',
  conversationId: 'conversation:001', turnId: 'turn:001', action: 'send', input: 'Synthetic prompt.',
};
const runEventRequest = {
  contract: 'RunEventQuery', version: 1, requestId: 'request:run:event:001',
  runId: 'run:001', limit: 25, afterSeq: 7, waitMs: 0,
};
const notificationListRequest = {
  contract: 'NotificationListQuery', version: 1, requestId: 'request:notification:list:001',
  limit: 25, afterSeq: 4,
};
const notificationAckRequest = {
  contract: 'NotificationAckCommand', version: 1, requestId: 'request:notification:ack:001',
  operationId: 'operation:notification:ack:001', notificationIds: ['notification:001'],
  observedThroughSeq: 5,
};
const projectListRequest = {
  contract: 'ProjectListQuery', version: 1, requestId: 'request:project:list:001', limit: 25,
};
const projectContextRequest = {
  contract: 'RemoteProjectContextQuery', version: 1, requestId: 'request:project:context:001',
  projectId: 7, workspaceRevision: WSR_A, queryText: 'find request authority',
  maxFiles: 8, maxBytes: 8192, maxTokens: 2048,
};
const settingsReadRequest = {
  contract: 'MobileSettingsQuery', version: 1, requestId: 'request:settings:read:001',
  keys: ['appearance.theme'],
};
const settingsUpdateRequest = {
  contract: 'MobileSettingUpdateCommand', version: 1, requestId: 'request:settings:update:001',
  operationId: 'operation:settings:update:001', key: 'appearance.theme', value: 'dark',
  expectedRevision: 'rev:settings:001',
};
const storedListRequest = {
  contract: 'StoredInformationListQuery', version: 1, requestId: 'request:stored:list:001',
  limit: 25, kinds: ['manual_note'], projectId: 7,
};
const storedAppendRequest = {
  contract: 'StoredInformationAppendCommand', version: 1, requestId: 'request:stored:append:001',
  operationId: 'operation:stored:append:001', content: 'Synthetic manual note.',
  projectId: 7, tags: ['mobile'],
};
const operationListRequest = {
  contract: 'OperationListQuery', version: 1, requestId: 'request:operation:list:001',
  limit: 25, states: ['pending', 'unknown'],
};
const operationGetRequest = {
  contract: 'OperationLookupQuery', version: 1, requestId: 'request:operation:get:001',
  operationId: 'operation:settings:update:001',
};
const operationAbandonRequest = {
  contract: 'OperationAbandonCommand', version: 1, requestId: 'request:operation:abandon:001',
  operationId: 'operation:abandon:001', targetOperationId: 'operation:settings:update:001',
  expectedRevision: 'rev:operation:001',
};
const healthRequest = {
  contract: 'RemoteHealthQuery', version: 1, requestId: 'request:health:001',
};

const operationRecord = {
  operationId: 'operation:settings:update:001',
  operationKind: 'settings.update',
  requestDigest: DIGEST_A,
  state: 'pending',
  createdAt: T0,
  updatedAt: T1,
  resultReference: null,
  canAbandon: true,
  revision: 'rev:operation:001',
};

export const MOBILE_REMOTE_GOLDEN_OPERATION_FIXTURES_V1 = deepFreeze([
  operation({
    capabilityId: 'approvals', capabilityVersion: 1, operationId: 'approval.decide',
    request: approvalDecisionRequest,
    success: {
      contract: 'ApprovalDecisionResult', version: 1, requestId: approvalDecisionRequest.requestId,
      operationId: approvalDecisionRequest.operationId, approvalId: approvalDecisionRequest.approvalId,
      decision: 'approve', approvalState: 'approved', payloadFingerprint: DIGEST_A,
      revision: 'rev:approval:002', outcome: 'CONFIRMED', replayed: false,
    },
    failure: mutationError('ApprovalDecisionResult', approvalDecisionRequest, {
      approvalId: approvalDecisionRequest.approvalId, decision: 'approve', approvalState: 'expired',
      payloadFingerprint: DIGEST_A,
    }),
  }),
  operation({
    capabilityId: 'approvals', capabilityVersion: 1, operationId: 'approval.list',
    request: approvalListRequest,
    success: {
      contract: 'ApprovalPage', version: 1, requestId: approvalListRequest.requestId, status: 'ok',
      items: [{
        approvalId: 'approval:001', projectId: 7, runId: 'run:001', effectKind: 'fs.write',
        riskClass: 'high', summary: 'Synthetic approval.', details: ['Writes one synthetic file.'],
        payloadFingerprint: DIGEST_A, approvalViewDigest: DIGEST_B, createdAt: T0, expiresAt: T1,
        state: 'pending', revision: 'rev:approval:001',
      }], end: true, nextCursor: null, snapshotRevision: 'rev:approval:snapshot:001',
    },
    failure: readError('ApprovalPage', approvalListRequest.requestId),
  }),
  operation({
    capabilityId: 'conversations', capabilityVersion: 2, operationId: 'conversation.execute',
    request: conversationExecuteRequest,
    success: {
      contract: 'ConversationResult', version: 1, requestId: conversationExecuteRequest.requestId,
      conversationId: conversationExecuteRequest.conversationId, turnId: conversationExecuteRequest.turnId,
      status: 'ok', response: { content: 'Synthetic response.' },
    },
    failure: {
      contract: 'ConversationResult', version: 1, requestId: conversationExecuteRequest.requestId,
      conversationId: conversationExecuteRequest.conversationId, turnId: conversationExecuteRequest.turnId,
      status: 'error', error: { code: 'MODEL_UNAVAILABLE', message: 'Synthetic model error.' },
    },
  }),
  operation({
    capabilityId: 'conversations', capabilityVersion: 2, operationId: 'conversation.history',
    request: conversationHistoryRequest,
    success: {
      contract: 'ConversationHistoryPage', version: 1, requestId: conversationHistoryRequest.requestId,
      conversationId: conversationHistoryRequest.conversationId, status: 'ok',
      messages: [{
        messageId: 'message:001', turnId: 'turn:001', role: 'user', content: 'Synthetic prompt.',
        status: 'ok', createdAt: T0, revision: 'rev:message:001',
      }], end: true, nextCursor: null, snapshotRevision: 'rev:conversation:snapshot:001',
    },
    failure: readError('ConversationHistoryPage', conversationHistoryRequest.requestId, {
      conversationId: conversationHistoryRequest.conversationId,
    }),
  }),
  operation({
    capabilityId: 'conversations', capabilityVersion: 2, operationId: 'conversation.list',
    request: conversationListRequest,
    success: {
      contract: 'ConversationPage', version: 1, requestId: conversationListRequest.requestId,
      status: 'ok', items: [{
        conversationId: 'conversation:001', projectId: 7, title: 'Synthetic conversation',
        state: 'active', messageCount: 1, updatedAt: T1, revision: 'rev:conversation:001',
      }], end: false, nextCursor: CURSOR_A, snapshotRevision: 'rev:conversation:snapshot:001',
    },
    failure: readError('ConversationPage', conversationListRequest.requestId),
  }),
  operation({
    capabilityId: 'events', capabilityVersion: 1, operationId: 'run-event.list',
    request: runEventRequest,
    success: {
      contract: 'RunEventPage', version: 1, requestId: runEventRequest.requestId,
      runId: runEventRequest.runId, status: 'ok', events: [{
        eventId: 'event:008', runId: runEventRequest.runId, sequence: 8, phase: 'progress',
        eventType: 'tool.progress', occurredAt: T1, title: 'Synthetic progress', detail: null,
        progressPercent: 50, terminalStatus: null,
        correlation: { conversationId: 'conversation:001', turnId: 'turn:001', projectId: 7 },
      }], windowStartSeq: 1, windowEndSeq: 8, nextAfterSeq: 8, caughtUp: true, terminal: false,
    },
    failure: readError('RunEventPage', runEventRequest.requestId, { runId: runEventRequest.runId }),
  }),
  operation({
    capabilityId: 'notifications', capabilityVersion: 1, operationId: 'notification.ack',
    request: notificationAckRequest,
    success: {
      contract: 'NotificationAckResult', version: 1, requestId: notificationAckRequest.requestId,
      operationId: notificationAckRequest.operationId, acknowledgedIds: ['notification:001'],
      acknowledgedThroughSeq: 5, revision: 'rev:notification:receipt:001',
      outcome: 'CONFIRMED', replayed: false,
    },
    failure: mutationError('NotificationAckResult', notificationAckRequest, {
      acknowledgedIds: [], acknowledgedThroughSeq: 4,
    }),
  }),
  operation({
    capabilityId: 'notifications', capabilityVersion: 1, operationId: 'notification.list',
    request: notificationListRequest,
    success: {
      contract: 'NotificationPage', version: 1, requestId: notificationListRequest.requestId,
      status: 'ok', items: [{
        notificationId: 'notification:001', sequence: 5, kind: 'approval.pending', priority: 'high',
        title: 'Approval required', target: { type: 'approval', id: 'approval:001' }, projectId: 7,
        createdAt: T0, readAt: null, revision: 'rev:notification:001',
      }], nextAfterSeq: 5, caughtUp: true,
    },
    failure: readError('NotificationPage', notificationListRequest.requestId),
  }),
  operation({
    capabilityId: 'projects', capabilityVersion: 2, operationId: 'project-context.query',
    request: projectContextRequest,
    success: {
      contract: 'ProjectContextSnapshot', version: 1, requestId: projectContextRequest.requestId,
      projectId: projectContextRequest.projectId, status: 'ok', outcome: 'empty',
      workspaceRevision: WSR_A, normalizationVersion: 1,
      normalizedQuery: 'find request authority', terms: ['find', 'request', 'authority'], items: [],
      budget: {
        maxFiles: 8, maxBytes: 8192, maxTokens: 2048,
        usedFiles: 0, usedBytes: 0, usedTokens: 0,
      },
      truncation: { truncated: false },
      snapshotDigest: 'pcs1:94038aa4fe5ef52c7b2a0b890d65b8fb7bdf8bd651ad49ff0b3b8639b79bedb9',
    },
    failure: {
      contract: 'ProjectContextSnapshot', version: 1, requestId: projectContextRequest.requestId,
      projectId: projectContextRequest.projectId, status: 'error',
      error: { code: 'PROJECT_CONTEXT_TIMEOUT', message: 'Synthetic context timeout.' },
    },
  }),
  operation({
    capabilityId: 'projects', capabilityVersion: 2, operationId: 'project.list',
    request: projectListRequest,
    success: {
      contract: 'ProjectPage', version: 1, requestId: projectListRequest.requestId, status: 'ok',
      items: [{
        projectId: 7, name: 'Synthetic project', lifecycleStage: 'active', updatedAt: T1,
        workspaceRevision: WSR_A, revision: 'rev:project:001',
      }], end: true, nextCursor: null, snapshotRevision: 'rev:project:snapshot:001',
    },
    failure: readError('ProjectPage', projectListRequest.requestId),
  }),
  operation({
    capabilityId: 'settings', capabilityVersion: 1, operationId: 'settings.read',
    request: settingsReadRequest,
    success: {
      contract: 'MobileSettingsSnapshot', version: 1, requestId: settingsReadRequest.requestId,
      status: 'ok', items: [{
        key: 'appearance.theme', category: 'appearance', valueType: 'enum', value: 'dark',
        writable: true, constraints: { enumValues: ['dark', 'light', 'system'] },
        revision: 'rev:setting:001',
      }], revision: 'rev:settings:001',
    },
    failure: readError('MobileSettingsSnapshot', settingsReadRequest.requestId),
  }),
  operation({
    capabilityId: 'settings', capabilityVersion: 1, operationId: 'settings.update',
    request: settingsUpdateRequest,
    success: {
      contract: 'MobileSettingUpdateResult', version: 1, requestId: settingsUpdateRequest.requestId,
      operationId: settingsUpdateRequest.operationId, key: settingsUpdateRequest.key,
      value: settingsUpdateRequest.value, revision: 'rev:settings:002', outcome: 'CONFIRMED', replayed: false,
    },
    failure: mutationError('MobileSettingUpdateResult', settingsUpdateRequest, {
      key: settingsUpdateRequest.key, value: settingsUpdateRequest.value,
    }),
  }),
  operation({
    capabilityId: 'stored_information', capabilityVersion: 1, operationId: 'stored-information.append',
    request: storedAppendRequest,
    success: {
      contract: 'StoredInformationAppendResult', version: 1, requestId: storedAppendRequest.requestId,
      operationId: storedAppendRequest.operationId, informationId: 'information:001',
      revision: 'rev:information:001', outcome: 'CONFIRMED', replayed: false,
    },
    failure: mutationError('StoredInformationAppendResult', storedAppendRequest, {
      informationId: 'information:001',
    }),
  }),
  operation({
    capabilityId: 'stored_information', capabilityVersion: 1, operationId: 'stored-information.list',
    request: storedListRequest,
    success: {
      contract: 'StoredInformationPage', version: 1, requestId: storedListRequest.requestId,
      status: 'ok', items: [{
        informationId: 'information:001', kind: 'manual_note', projectId: 7,
        summary: 'Synthetic note', content: 'Synthetic manual note.', tags: ['mobile'],
        createdAt: T0, updatedAt: T1, revision: 'rev:information:001',
      }], end: true, nextCursor: null, snapshotRevision: 'rev:information:snapshot:001',
    },
    failure: readError('StoredInformationPage', storedListRequest.requestId),
  }),
  operation({
    capabilityId: 'm7-control-plane-prerequisite', capabilityVersion: 1, operationId: 'operation.abandon',
    request: operationAbandonRequest,
    success: {
      contract: 'OperationAbandonResult', version: 1, requestId: operationAbandonRequest.requestId,
      operationId: operationAbandonRequest.operationId,
      targetOperationId: operationAbandonRequest.targetOperationId,
      revision: 'rev:operation:002', outcome: 'CONFIRMED', replayed: false,
    },
    failure: mutationError('OperationAbandonResult', operationAbandonRequest, {
      targetOperationId: operationAbandonRequest.targetOperationId,
    }),
  }),
  operation({
    capabilityId: 'm7-control-plane-prerequisite', capabilityVersion: 1, operationId: 'operation.get',
    request: operationGetRequest,
    success: {
      contract: 'OperationLookupResult', version: 1, requestId: operationGetRequest.requestId,
      status: 'ok', operation: operationRecord, revision: 'rev:operation:snapshot:001',
    },
    failure: readError('OperationLookupResult', operationGetRequest.requestId),
  }),
  operation({
    capabilityId: 'm7-control-plane-prerequisite', capabilityVersion: 1, operationId: 'operation.list',
    request: operationListRequest,
    success: {
      contract: 'OperationPage', version: 1, requestId: operationListRequest.requestId,
      status: 'ok', items: [operationRecord], end: true, nextCursor: null,
      snapshotRevision: 'rev:operation:snapshot:001',
    },
    failure: readError('OperationPage', operationListRequest.requestId),
  }),
  operation({
    capabilityId: 'm7-control-plane-prerequisite', capabilityVersion: 1, operationId: 'remote-health.read',
    request: healthRequest,
    success: {
      contract: 'RemoteHealthSnapshot', version: 1, requestId: healthRequest.requestId,
      status: 'ok', coreVersion: '1.0.0', observedAt: T1,
      components: [{ componentId: 'core', status: 'ok', code: 'READY' }],
    },
    failure: readError('RemoteHealthSnapshot', healthRequest.requestId),
  }),
]);

function clone(value) {
  return structuredClone(value);
}

const unknownField = clone(projectListRequest);
unknownField.token = 'must-never-be-accepted';
const ambiguousHistory = clone(conversationHistoryRequest);
ambiguousHistory.cursor = CURSOR_A;
const cursorMismatch = clone(MOBILE_REMOTE_GOLDEN_OPERATION_FIXTURES_V1
  .find(item => item.operationId === 'conversation.list').success);
cursorMismatch.end = true;
const unsortedAck = clone(notificationAckRequest);
unsortedAck.notificationIds = ['notification:002', 'notification:001'];
const pendingWithoutApproval = clone(MOBILE_REMOTE_GOLDEN_OPERATION_FIXTURES_V1
  .find(item => item.operationId === 'settings.update').success);
pendingWithoutApproval.outcome = 'PENDING';
const terminalMismatch = clone(MOBILE_REMOTE_GOLDEN_OPERATION_FIXTURES_V1
  .find(item => item.operationId === 'run-event.list').success.events[0]);
terminalMismatch.phase = 'terminal';

export const MOBILE_REMOTE_NEGATIVE_PAYLOAD_FIXTURES_V1 = deepFreeze([
  { id: 'unknown-authority-field', schemaId: 'ProjectListQuery@1', value: unknownField },
  { id: 'ambiguous-history-position', schemaId: 'ConversationHistoryQuery@1', value: ambiguousHistory },
  { id: 'end-cursor-mismatch', schemaId: 'ConversationPage@1', value: cursorMismatch },
  { id: 'unsorted-notification-set', schemaId: 'NotificationAckCommand@1', value: unsortedAck },
  { id: 'pending-without-approval', schemaId: 'MobileSettingUpdateResult@1', value: pendingWithoutApproval },
  { id: 'terminal-event-without-status', schemaId: 'RunEvent@1', value: terminalMismatch },
]);

export const MOBILE_REMOTE_FIXTURE_CONSTANTS_V1 = deepFreeze({
  cursor: CURSOR_A,
  digest: DIGEST_A,
  workspaceRevision: WSR_A,
});

export const MOBILE_REMOTE_GOLDEN_OPERATION_FIXTURES_DIGEST_V1 =
  'sha256:171d023fc0d0efc7a2d2c1e692f47fa8291ddcc139a147747a52c121b405a17d';
export const MOBILE_REMOTE_NEGATIVE_PAYLOAD_FIXTURES_DIGEST_V1 =
  'sha256:869d1fc306f0112dec9ca0bcde0d6b4ba625abe5ee23fcc2234d1c2f92a935fb';
