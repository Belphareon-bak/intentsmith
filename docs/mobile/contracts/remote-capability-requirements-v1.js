// IntentSmith Remote Companion capability requirements — mobile-owned candidate artifact
// =============================================================================
//
// This file is an executable consumer requirement, not a core/provider contract
// and not a transport implementation. M2 owns the accepted seven-capability
// catalog, M5 currently implements two narrow in-process capabilities and M7
// must own the authenticated wire boundary. Keeping this candidate separate
// prevents a mobile-only branch from silently changing backend authority.

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const RESULT_ERROR_IDENTITY_FIELDS = new Set(['conversationId', 'projectId', 'runId']);

const operation = ({
  operationId,
  requestContract,
  resultContract,
  kind,
  requiredScopes,
  pagination,
  idempotency,
  dataClass,
  providerPort,
  requestRequiredFields,
  requestOptionalFields = [],
  resultRequiredFields,
  resultOptionalFields = [],
  resultBinding,
}) => {
  const resultSemantics = kind === 'read'
    ? 'status_union'
    : kind === 'mutation'
      ? 'mutation_outcome'
      : 'referenced_contract';
  const successResultOptionalFields = kind === 'read'
    ? resultOptionalFields.filter(field => field !== 'error')
    : resultOptionalFields;
  const errorResultRequiredFields = kind === 'read'
    ? [
      'contract',
      'error',
      ...resultBinding.filter(field => RESULT_ERROR_IDENTITY_FIELDS.has(field)),
      'requestId',
      'status',
      'version',
    ].sort()
    : [];
  return {
    operationId,
    requestContract,
    resultContract,
    kind,
    requiredScopes,
    pagination,
    idempotency,
    dataClass,
    providerPort,
    requestRequiredFields,
    requestOptionalFields,
    resultSemantics,
    successResultRequiredFields: resultRequiredFields,
    successResultOptionalFields,
    errorResultRequiredFields,
    errorResultOptionalFields: [],
    resultBinding,
  };
};

const capabilities = [
  {
    capabilityId: 'approvals',
    targetVersion: 1,
    m5Status: 'unavailable',
    compatibility: 'new_capability_contract',
    minimumAuthorityContracts: [
      'ApprovalGrant@1',
      'EffectRequest@1',
      'EffectResult@1',
      'LifecycleApprovalIntent@1',
      'LifecyclePlanSnapshot@1',
      'LifecycleTerminalSnapshot@1',
    ],
    operations: [
      operation({
        operationId: 'approval.decide',
        requestContract: 'ApprovalDecisionCommand@1',
        resultContract: 'ApprovalDecisionResult@1',
        kind: 'mutation',
        requiredScopes: ['write:approvals'],
        pagination: 'none',
        idempotency: 'operation_id_required',
        dataClass: 'S2_MEMORY_ONLY',
        providerPort: 'approval-decision-service',
        requestRequiredFields: [
          'approvalId', 'contract', 'decision', 'expectedPayloadFingerprint',
          'expectedRevision', 'expectedViewDigest', 'operationId', 'requestId', 'version',
        ],
        resultRequiredFields: [
          'approvalId', 'approvalState', 'contract', 'decision', 'operationId',
          'outcome', 'payloadFingerprint', 'replayed', 'requestId', 'revision', 'version',
        ],
        resultOptionalFields: ['error'],
        resultBinding: [
          'approvalId', 'operationId', 'payloadFingerprint', 'requestId', 'revision',
        ],
      }),
      operation({
        operationId: 'approval.list',
        requestContract: 'ApprovalListQuery@1',
        resultContract: 'ApprovalPage@1',
        kind: 'read',
        requiredScopes: ['read:approvals'],
        pagination: 'opaque_cursor',
        idempotency: 'not_applicable',
        dataClass: 'S2_MEMORY_ONLY',
        providerPort: 'approval-read-model',
        requestRequiredFields: ['contract', 'limit', 'requestId', 'version'],
        requestOptionalFields: ['cursor', 'states'],
        resultRequiredFields: [
          'contract', 'end', 'items', 'nextCursor', 'requestId', 'snapshotRevision',
          'status', 'version',
        ],
        resultOptionalFields: ['error'],
        resultBinding: ['requestId', 'snapshotRevision'],
      }),
    ],
  },
  {
    capabilityId: 'conversations',
    targetVersion: 2,
    m5Status: 'available_incomplete_v1',
    compatibility: 'additive_superset_of_m5_v1',
    minimumAuthorityContracts: ['ConversationCommand@1', 'ConversationResult@1'],
    operations: [
      operation({
        operationId: 'conversation.execute',
        requestContract: 'ConversationCommand@1',
        resultContract: 'ConversationResult@1',
        kind: 'command',
        requiredScopes: ['write:chat'],
        pagination: 'none',
        idempotency: 'request_conversation_turn_identity',
        dataClass: 'S2_PROTECTED_CACHE',
        providerPort: 'conversation-command-port',
        requestRequiredFields: [
          'action', 'contract', 'conversationId', 'requestId', 'turnId', 'version',
        ],
        requestOptionalFields: ['input'],
        resultRequiredFields: [
          'contract', 'conversationId', 'requestId', 'status', 'turnId', 'version',
        ],
        resultOptionalFields: ['error', 'partial', 'response'],
        resultBinding: ['conversationId', 'requestId', 'turnId'],
      }),
      operation({
        operationId: 'conversation.history',
        requestContract: 'ConversationHistoryQuery@1',
        resultContract: 'ConversationHistoryPage@1',
        kind: 'read',
        requiredScopes: ['read:chat'],
        pagination: 'opaque_cursor',
        idempotency: 'not_applicable',
        dataClass: 'S2_PROTECTED_CACHE',
        providerPort: 'conversation-read-model',
        requestRequiredFields: ['contract', 'conversationId', 'limit', 'requestId', 'version'],
        requestOptionalFields: ['anchor', 'cursor'],
        resultRequiredFields: [
          'contract', 'conversationId', 'end', 'messages', 'nextCursor', 'requestId',
          'snapshotRevision', 'status', 'version',
        ],
        resultOptionalFields: ['error'],
        resultBinding: ['conversationId', 'requestId', 'snapshotRevision'],
      }),
      operation({
        operationId: 'conversation.list',
        requestContract: 'ConversationListQuery@1',
        resultContract: 'ConversationPage@1',
        kind: 'read',
        requiredScopes: ['read:chat'],
        pagination: 'opaque_cursor',
        idempotency: 'not_applicable',
        dataClass: 'S1_CONTENT_DERIVED',
        providerPort: 'conversation-read-model',
        requestRequiredFields: ['contract', 'limit', 'requestId', 'version'],
        requestOptionalFields: ['cursor'],
        resultRequiredFields: [
          'contract', 'end', 'items', 'nextCursor', 'requestId', 'snapshotRevision',
          'status', 'version',
        ],
        resultOptionalFields: ['error'],
        resultBinding: ['requestId', 'snapshotRevision'],
      }),
    ],
  },
  {
    capabilityId: 'events',
    targetVersion: 1,
    m5Status: 'unavailable',
    compatibility: 'new_capability_contract',
    minimumAuthorityContracts: ['CoreEvent@1'],
    operations: [
      operation({
        operationId: 'run-event.list',
        requestContract: 'RunEventQuery@1',
        resultContract: 'RunEventPage@1',
        kind: 'read',
        requiredScopes: ['read:events'],
        pagination: 'sequence_cursor',
        idempotency: 'not_applicable',
        dataClass: 'S2_MEMORY_ONLY',
        providerPort: 'run-event-read-model',
        requestRequiredFields: ['contract', 'limit', 'requestId', 'runId', 'version'],
        requestOptionalFields: ['afterSeq', 'waitMs'],
        resultRequiredFields: [
          'caughtUp', 'contract', 'events', 'nextAfterSeq', 'requestId', 'runId',
          'status', 'terminal', 'version', 'windowEndSeq', 'windowStartSeq',
        ],
        resultOptionalFields: ['error'],
        resultBinding: ['nextAfterSeq', 'requestId', 'runId'],
      }),
    ],
  },
  {
    capabilityId: 'notifications',
    targetVersion: 1,
    m5Status: 'unavailable',
    compatibility: 'new_capability_contract',
    minimumAuthorityContracts: ['CoreEvent@1'],
    operations: [
      operation({
        operationId: 'notification.ack',
        requestContract: 'NotificationAckCommand@1',
        resultContract: 'NotificationAckResult@1',
        kind: 'mutation',
        requiredScopes: ['write:notifications'],
        pagination: 'none',
        idempotency: 'operation_id_required',
        dataClass: 'S1_PROTECTED_CACHE',
        providerPort: 'notification-receipt-service',
        requestRequiredFields: [
          'contract', 'notificationIds', 'observedThroughSeq', 'operationId', 'requestId',
          'version',
        ],
        resultRequiredFields: [
          'acknowledgedIds', 'acknowledgedThroughSeq', 'contract', 'operationId',
          'outcome', 'replayed', 'requestId', 'revision', 'version',
        ],
        resultOptionalFields: ['error'],
        resultBinding: ['acknowledgedThroughSeq', 'operationId', 'requestId', 'revision'],
      }),
      operation({
        operationId: 'notification.list',
        requestContract: 'NotificationListQuery@1',
        resultContract: 'NotificationPage@1',
        kind: 'read',
        requiredScopes: ['read:notifications'],
        pagination: 'sequence_cursor',
        idempotency: 'not_applicable',
        dataClass: 'S1_PROTECTED_CACHE',
        providerPort: 'notification-read-model',
        requestRequiredFields: ['contract', 'limit', 'requestId', 'version'],
        requestOptionalFields: ['afterSeq'],
        resultRequiredFields: [
          'caughtUp', 'contract', 'items', 'nextAfterSeq', 'requestId', 'status', 'version',
        ],
        resultOptionalFields: ['error'],
        resultBinding: ['nextAfterSeq', 'requestId'],
      }),
    ],
  },
  {
    capabilityId: 'projects',
    targetVersion: 2,
    m5Status: 'available_incomplete_v1',
    compatibility: 'rootless_remote_query_replaces_m5_v1_request',
    minimumAuthorityContracts: ['ProjectContextQuery@1', 'ProjectContextSnapshot@1'],
    operations: [
      operation({
        operationId: 'project-context.query',
        requestContract: 'RemoteProjectContextQuery@1',
        resultContract: 'ProjectContextSnapshot@1',
        kind: 'read',
        requiredScopes: ['read:projects'],
        pagination: 'none',
        idempotency: 'not_applicable',
        dataClass: 'S2_MEMORY_ONLY',
        providerPort: 'remote-project-context-port',
        requestRequiredFields: [
          'contract', 'maxBytes', 'maxFiles', 'maxTokens', 'projectId', 'queryText',
          'requestId', 'version', 'workspaceRevision',
        ],
        resultRequiredFields: [
          'budget', 'contract', 'items', 'normalizationVersion', 'normalizedQuery',
          'outcome', 'projectId', 'requestId', 'snapshotDigest', 'status', 'terms',
          'truncation', 'version', 'workspaceRevision',
        ],
        resultOptionalFields: ['error'],
        resultBinding: ['projectId', 'requestId', 'workspaceRevision'],
      }),
      operation({
        operationId: 'project.list',
        requestContract: 'ProjectListQuery@1',
        resultContract: 'ProjectPage@1',
        kind: 'read',
        requiredScopes: ['read:projects'],
        pagination: 'opaque_cursor',
        idempotency: 'not_applicable',
        dataClass: 'S1_PROTECTED_CACHE',
        providerPort: 'project-read-model',
        requestRequiredFields: ['contract', 'limit', 'requestId', 'version'],
        requestOptionalFields: ['cursor', 'lifecycleStates'],
        resultRequiredFields: [
          'contract', 'end', 'items', 'nextCursor', 'requestId', 'snapshotRevision',
          'status', 'version',
        ],
        resultOptionalFields: ['error'],
        resultBinding: ['requestId', 'snapshotRevision'],
      }),
    ],
  },
  {
    capabilityId: 'settings',
    targetVersion: 1,
    m5Status: 'unavailable',
    compatibility: 'new_capability_contract',
    minimumAuthorityContracts: ['ApprovalGrant@1', 'EffectRequest@1', 'EffectResult@1'],
    operations: [
      operation({
        operationId: 'settings.read',
        requestContract: 'MobileSettingsQuery@1',
        resultContract: 'MobileSettingsSnapshot@1',
        kind: 'read',
        requiredScopes: ['read:settings'],
        pagination: 'none',
        idempotency: 'not_applicable',
        dataClass: 'S1_PROTECTED_CACHE',
        providerPort: 'mobile-settings-read-model',
        requestRequiredFields: ['contract', 'requestId', 'version'],
        requestOptionalFields: ['keys'],
        resultRequiredFields: [
          'contract', 'items', 'requestId', 'revision', 'status', 'version',
        ],
        resultOptionalFields: ['error'],
        resultBinding: ['requestId', 'revision'],
      }),
      operation({
        operationId: 'settings.update',
        requestContract: 'MobileSettingUpdateCommand@1',
        resultContract: 'MobileSettingUpdateResult@1',
        kind: 'mutation',
        requiredScopes: ['write:settings'],
        pagination: 'none',
        idempotency: 'operation_id_required',
        dataClass: 'S1_PROTECTED_CACHE',
        providerPort: 'mobile-settings-command-service',
        requestRequiredFields: [
          'contract', 'expectedRevision', 'key', 'operationId', 'requestId', 'value', 'version',
        ],
        resultRequiredFields: [
          'contract', 'key', 'operationId', 'outcome', 'replayed', 'requestId',
          'revision', 'value', 'version',
        ],
        resultOptionalFields: ['error', 'pendingApprovalId'],
        resultBinding: ['key', 'operationId', 'requestId', 'revision'],
      }),
    ],
  },
  {
    capabilityId: 'stored_information',
    targetVersion: 1,
    m5Status: 'unavailable',
    compatibility: 'new_capability_contract',
    minimumAuthorityContracts: ['ApprovalGrant@1', 'EffectRequest@1', 'EffectResult@1'],
    operations: [
      operation({
        operationId: 'stored-information.append',
        requestContract: 'StoredInformationAppendCommand@1',
        resultContract: 'StoredInformationAppendResult@1',
        kind: 'mutation',
        requiredScopes: ['write:stored_information'],
        pagination: 'none',
        idempotency: 'operation_id_required',
        dataClass: 'S2_PROTECTED_CACHE',
        providerPort: 'stored-information-command-service',
        requestRequiredFields: ['content', 'contract', 'operationId', 'requestId', 'version'],
        requestOptionalFields: ['projectId', 'tags'],
        resultRequiredFields: [
          'contract', 'informationId', 'operationId', 'outcome', 'replayed', 'requestId',
          'revision', 'version',
        ],
        resultOptionalFields: ['error', 'pendingApprovalId'],
        resultBinding: ['informationId', 'operationId', 'requestId', 'revision'],
      }),
      operation({
        operationId: 'stored-information.list',
        requestContract: 'StoredInformationListQuery@1',
        resultContract: 'StoredInformationPage@1',
        kind: 'read',
        requiredScopes: ['read:stored_information'],
        pagination: 'opaque_cursor',
        idempotency: 'not_applicable',
        dataClass: 'S2_PROTECTED_CACHE',
        providerPort: 'stored-information-read-model',
        requestRequiredFields: ['contract', 'limit', 'requestId', 'version'],
        requestOptionalFields: ['cursor', 'kinds', 'projectId'],
        resultRequiredFields: [
          'contract', 'end', 'items', 'nextCursor', 'requestId', 'snapshotRevision',
          'status', 'version',
        ],
        resultOptionalFields: ['error'],
        resultBinding: ['requestId', 'snapshotRevision'],
      }),
    ],
  },
];

const controlPlaneOperations = [
  operation({
    operationId: 'operation.abandon',
    requestContract: 'OperationAbandonCommand@1',
    resultContract: 'OperationAbandonResult@1',
    kind: 'mutation',
    requiredScopes: ['write:operations'],
    pagination: 'none',
    idempotency: 'operation_id_required',
    dataClass: 'S1_PROTECTED_CACHE',
    providerPort: 'operation-control-service',
    requestRequiredFields: [
      'contract', 'expectedRevision', 'operationId', 'requestId', 'targetOperationId', 'version',
    ],
    resultRequiredFields: [
      'contract', 'operationId', 'outcome', 'replayed', 'requestId', 'revision',
      'targetOperationId', 'version',
    ],
    resultOptionalFields: ['error'],
    resultBinding: ['operationId', 'requestId', 'revision', 'targetOperationId'],
  }),
  operation({
    operationId: 'operation.get',
    requestContract: 'OperationLookupQuery@1',
    resultContract: 'OperationLookupResult@1',
    kind: 'read',
    requiredScopes: ['read:operations'],
    pagination: 'none',
    idempotency: 'not_applicable',
    dataClass: 'S1_PROTECTED_CACHE',
    providerPort: 'operation-read-model',
    requestRequiredFields: ['contract', 'operationId', 'requestId', 'version'],
    resultRequiredFields: [
      'contract', 'operation', 'requestId', 'revision', 'status', 'version',
    ],
    resultOptionalFields: ['error'],
    resultBinding: ['operationId', 'requestId', 'revision'],
  }),
  operation({
    operationId: 'operation.list',
    requestContract: 'OperationListQuery@1',
    resultContract: 'OperationPage@1',
    kind: 'read',
    requiredScopes: ['read:operations'],
    pagination: 'opaque_cursor',
    idempotency: 'not_applicable',
    dataClass: 'S1_PROTECTED_CACHE',
    providerPort: 'operation-read-model',
    requestRequiredFields: ['contract', 'limit', 'requestId', 'version'],
    requestOptionalFields: ['cursor', 'states'],
    resultRequiredFields: [
      'contract', 'end', 'items', 'nextCursor', 'requestId', 'snapshotRevision',
      'status', 'version',
    ],
    resultOptionalFields: ['error'],
    resultBinding: ['requestId', 'snapshotRevision'],
  }),
  operation({
    operationId: 'remote-health.read',
    requestContract: 'RemoteHealthQuery@1',
    resultContract: 'RemoteHealthSnapshot@1',
    kind: 'read',
    requiredScopes: [],
    pagination: 'none',
    idempotency: 'not_applicable',
    dataClass: 'S0_CACHE',
    providerPort: 'remote-health-read-model',
    requestRequiredFields: ['contract', 'requestId', 'version'],
    resultRequiredFields: [
      'components', 'contract', 'coreVersion', 'observedAt', 'requestId', 'status', 'version',
    ],
    resultOptionalFields: ['error'],
    resultBinding: ['observedAt', 'requestId'],
  }),
];

export const MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_STAGE_V1 = 'CANDIDATE_NOT_ACCEPTED';

export const MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1 = deepFreeze({
  contract: 'MobileRemoteCapabilityRequirements',
  version: 1,
  stage: MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_STAGE_V1,
  authority: 'MOBILE_CONSUMER_REQUIREMENTS_ONLY',
  sources: {
    m2DescriptorDigest: 'sha256:245abe3a13d7d60ac537c7672522872df20f855d990bee0f02b2826379b56c52',
    m5AdapterManifestDigest: 'sha256:34f3c20c94e1c4316ad76e8c92c1ce8b7dab0868b7685c3d5a637a6f6aa98e52',
    m5ProductRevision: '122b5df5303e08a38cdd62a35e6577b118795c30',
  },
  compatibility: {
    capabilityVersioning: 'independent',
    implicitDowngrade: 'reject',
    unavailableIsSuccess: false,
    unknownCapabilities: 'reject',
    unknownFields: 'reject',
  },
  boundary: {
    backendImplementation: 'not_authorized_by_this_contract',
    invocationIdentity: 'm7_transport_subject_except_allowlisted_public_health',
    legacyRoutes: 'forbidden',
    mutationQueue: 'forbidden',
    projectRootSelection: 'server_resolved_never_client_supplied',
    secretsInPayload: 'forbidden',
    transport: 'm7_not_defined',
  },
  capabilities,
  controlPlanePrerequisite: {
    owner: 'M7_SESSION_TRANSPORT_CONTRACT',
    includedInCapabilityDigests: false,
    stage: 'REQUIRED_NOT_DEFINED',
    operations: controlPlaneOperations,
  },
});

// Digest of MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1 using the canonical JSON
// algorithm already pinned by src/mobile/client/remote-core-v1.js.
export const MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_DIGEST_V1 =
  'sha256:e076d2f17484772474bb9c4c806d156c369645fd4af395bfb19a58beee4a0654';
