// Browser-safe M7 operation boundary.
// =============================================================================
//
// The Android application ships raw ES modules, not a Node bundle. Production
// client code therefore cannot import the mobile-owned candidate modules from
// docs/ (or server-only contracts outside this web root). This frozen runtime
// projection contains only the fields the client must know to reject request,
// response and cross-message substitution before publishing data to the UI.
// The integration test compares every operation identity and field set with
// the canonical M7 requirements, so this copy cannot drift silently.

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const WORKSPACE_REVISION = /^wsr1:[0-9a-f]{64}$/u;

const fields = value => Object.freeze(value ? value.split(' ') : []);

function descriptor(
  capabilityId,
  capabilityVersion,
  requestContract,
  resultContract,
  kind,
  requestRequired,
  requestOptional,
  resultRequired,
  resultOptional,
  errorRequired = 'contract error requestId status version',
) {
  return Object.freeze({
    capabilityId,
    capabilityVersion,
    kind,
    requestContract,
    requestRequiredFields: fields(requestRequired),
    requestOptionalFields: fields(requestOptional),
    resultContract,
    successResultRequiredFields: fields(resultRequired),
    successResultOptionalFields: fields(resultOptional),
    errorResultRequiredFields: kind === 'read' ? fields(errorRequired) : fields(''),
    errorResultOptionalFields: fields(''),
  });
}

export const M7_RUNTIME_OPERATION_DESCRIPTORS = Object.freeze({
  'approval.decide': descriptor(
    'approvals', 1, 'ApprovalDecisionCommand@1', 'ApprovalDecisionResult@1', 'mutation',
    'approvalId contract decision expectedPayloadFingerprint expectedRevision expectedViewDigest operationId requestId version', '',
    'approvalId approvalState contract decision operationId outcome payloadFingerprint replayed requestId revision version', 'error', '',
  ),
  'approval.list': descriptor(
    'approvals', 1, 'ApprovalListQuery@1', 'ApprovalPage@1', 'read',
    'contract limit requestId version', 'cursor states',
    'contract end items nextCursor requestId snapshotRevision status version', '',
  ),
  'conversation.execute': descriptor(
    'conversations', 2, 'ConversationCommand@1', 'ConversationResult@1', 'command',
    'action contract conversationId requestId turnId version', 'input',
    'contract conversationId requestId status turnId version', 'error partial response', '',
  ),
  'conversation.history': descriptor(
    'conversations', 2, 'ConversationHistoryQuery@1', 'ConversationHistoryPage@1', 'read',
    'contract conversationId limit requestId version', 'anchor cursor',
    'contract conversationId end messages nextCursor requestId snapshotRevision status version', '',
    'contract conversationId error requestId status version',
  ),
  'conversation.list': descriptor(
    'conversations', 2, 'ConversationListQuery@1', 'ConversationPage@1', 'read',
    'contract limit requestId version', 'cursor',
    'contract end items nextCursor requestId snapshotRevision status version', '',
  ),
  'run-event.list': descriptor(
    'events', 1, 'RunEventQuery@1', 'RunEventPage@1', 'read',
    'contract limit requestId runId version', 'afterSeq waitMs',
    'caughtUp contract events nextAfterSeq requestId runId status terminal version windowEndSeq windowStartSeq', '',
    'contract error requestId runId status version',
  ),
  'notification.ack': descriptor(
    'notifications', 1, 'NotificationAckCommand@1', 'NotificationAckResult@1', 'mutation',
    'contract notificationIds observedThroughSeq operationId requestId version', '',
    'acknowledgedIds acknowledgedThroughSeq contract operationId outcome replayed requestId revision version', 'error', '',
  ),
  'notification.list': descriptor(
    'notifications', 1, 'NotificationListQuery@1', 'NotificationPage@1', 'read',
    'contract limit requestId version', 'afterSeq',
    'caughtUp contract items nextAfterSeq requestId status version', '',
  ),
  'project-context.query': descriptor(
    'projects', 2, 'RemoteProjectContextQuery@1', 'ProjectContextSnapshot@1', 'read',
    'contract maxBytes maxFiles maxTokens projectId queryText requestId version workspaceRevision', '',
    'budget contract items normalizationVersion normalizedQuery outcome projectId requestId snapshotDigest status terms truncation version workspaceRevision', '',
    'contract error projectId requestId status version',
  ),
  'project.list': descriptor(
    'projects', 2, 'ProjectListQuery@1', 'ProjectPage@1', 'read',
    'contract limit requestId version', 'cursor lifecycleStates',
    'contract end items nextCursor requestId snapshotRevision status version', '',
  ),
  'settings.read': descriptor(
    'settings', 1, 'MobileSettingsQuery@1', 'MobileSettingsSnapshot@1', 'read',
    'contract requestId version', 'keys',
    'contract items requestId revision status version', '',
  ),
  'settings.update': descriptor(
    'settings', 1, 'MobileSettingUpdateCommand@1', 'MobileSettingUpdateResult@1', 'mutation',
    'contract expectedRevision key operationId requestId value version', '',
    'contract key operationId outcome replayed requestId revision value version', 'error pendingApprovalId', '',
  ),
  'stored-information.append': descriptor(
    'stored_information', 1, 'StoredInformationAppendCommand@1', 'StoredInformationAppendResult@1', 'mutation',
    'content contract operationId requestId version', 'projectId tags',
    'contract informationId operationId outcome replayed requestId revision version', 'error pendingApprovalId', '',
  ),
  'stored-information.list': descriptor(
    'stored_information', 1, 'StoredInformationListQuery@1', 'StoredInformationPage@1', 'read',
    'contract limit requestId version', 'cursor kinds projectId',
    'contract end items nextCursor requestId snapshotRevision status version', '',
  ),
  'operation.abandon': descriptor(
    'm7-control-plane-prerequisite', 1, 'OperationAbandonCommand@1', 'OperationAbandonResult@1', 'mutation',
    'contract expectedRevision operationId requestId targetOperationId version', '',
    'contract operationId outcome replayed requestId revision targetOperationId version', 'error', '',
  ),
  'operation.get': descriptor(
    'm7-control-plane-prerequisite', 1, 'OperationLookupQuery@1', 'OperationLookupResult@1', 'read',
    'contract operationId requestId version', '',
    'contract operation requestId revision status version', '',
  ),
  'operation.list': descriptor(
    'm7-control-plane-prerequisite', 1, 'OperationListQuery@1', 'OperationPage@1', 'read',
    'contract limit requestId version', 'cursor states',
    'contract end items nextCursor requestId snapshotRevision status version', '',
  ),
});

export const M7_RUNTIME_OPERATION_BINDINGS = Object.freeze({
  'approval.decide': [['requestId', 'requestId', 'equal'], ['operationId', 'operationId', 'equal'], ['approvalId', 'approvalId', 'equal'], ['decision', 'decision', 'equal'], ['expectedPayloadFingerprint', 'payloadFingerprint', 'equal']],
  'approval.list': [['requestId', 'requestId', 'equal']],
  'conversation.execute': [['requestId', 'requestId', 'equal'], ['conversationId', 'conversationId', 'equal'], ['turnId', 'turnId', 'equal']],
  'conversation.history': [['requestId', 'requestId', 'equal'], ['conversationId', 'conversationId', 'equal']],
  'conversation.list': [['requestId', 'requestId', 'equal']],
  'run-event.list': [['requestId', 'requestId', 'equal'], ['runId', 'runId', 'equal']],
  'notification.ack': [['requestId', 'requestId', 'equal'], ['operationId', 'operationId', 'equal'], ['observedThroughSeq', 'acknowledgedThroughSeq', 'lessThanOrEqual'], ['notificationIds', 'acknowledgedIds', 'subset']],
  'notification.list': [['requestId', 'requestId', 'equal']],
  'project-context.query': [['requestId', 'requestId', 'equal'], ['projectId', 'projectId', 'equal'], ['workspaceRevision', 'workspaceRevision', 'equalWhenResultOk']],
  'project.list': [['requestId', 'requestId', 'equal']],
  'settings.read': [['requestId', 'requestId', 'equal']],
  'settings.update': [['requestId', 'requestId', 'equal'], ['operationId', 'operationId', 'equal'], ['key', 'key', 'equal']],
  'stored-information.append': [['requestId', 'requestId', 'equal'], ['operationId', 'operationId', 'equal']],
  'stored-information.list': [['requestId', 'requestId', 'equal']],
  'operation.abandon': [['requestId', 'requestId', 'equal'], ['operationId', 'operationId', 'equal'], ['targetOperationId', 'targetOperationId', 'equal']],
  'operation.get': [['requestId', 'requestId', 'equal'], ['operationId', 'operation.operationId', 'equalWhenResultOk']],
  'operation.list': [['requestId', 'requestId', 'equal']],
});

function plain(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactFields(value, required, optional) {
  if (!plain(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => allowed.has(key));
}

function contractIdentity(schemaId) {
  const separator = schemaId.lastIndexOf('@');
  return [schemaId.slice(0, separator), Number(schemaId.slice(separator + 1))];
}

function isSortedUniqueStrings(value, maximum = 200) {
  return Array.isArray(value) && value.length <= maximum
    && value.every((item, index) => typeof item === 'string' && item.length > 0
      && (index === 0 || value[index - 1] < item));
}

function errorShape(value) {
  return plain(value)
    && exactFields(value, ['code', 'message', 'retryable'], [])
    && /^REMOTE_[A-Z0-9_]{1,80}$/u.test(value.code || '')
    && typeof value.message === 'string' && value.message.length > 0 && value.message.length <= 512
    && typeof value.retryable === 'boolean';
}

function commonValidation(value, schemaId, context) {
  const errors = [];
  const [contract, version] = contractIdentity(schemaId);
  if (value?.contract !== contract) errors.push(`${context}:contract`);
  if (value?.version !== version) errors.push(`${context}:version`);
  for (const field of ['requestId', 'operationId', 'targetOperationId', 'conversationId', 'turnId', 'runId']) {
    if (Object.hasOwn(value || {}, field) && !IDENTIFIER.test(value[field] || '')) {
      errors.push(`${context}:${field}`);
    }
  }
  for (const field of ['expectedPayloadFingerprint', 'expectedViewDigest', 'payloadFingerprint', 'snapshotDigest']) {
    if (Object.hasOwn(value || {}, field) && !DIGEST.test(value[field] || '')) {
      errors.push(`${context}:${field}`);
    }
  }
  if (Object.hasOwn(value || {}, 'workspaceRevision')
    && !WORKSPACE_REVISION.test(value.workspaceRevision || '')) {
    errors.push(`${context}:workspaceRevision`);
  }
  if (Object.hasOwn(value || {}, 'limit')
    && (!Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > 200)) {
    errors.push(`${context}:limit`);
  }
  for (const field of ['afterSeq', 'observedThroughSeq']) {
    if (Object.hasOwn(value || {}, field)
      && (!Number.isSafeInteger(value[field]) || value[field] < 0)) errors.push(`${context}:${field}`);
  }
  if (Object.hasOwn(value || {}, 'waitMs')
    && (!Number.isSafeInteger(value.waitMs) || value.waitMs < 0 || value.waitMs > 30_000)) {
    errors.push(`${context}:waitMs`);
  }
  if (Object.hasOwn(value || {}, 'maxFiles')
    && (!Number.isSafeInteger(value.maxFiles) || value.maxFiles < 1 || value.maxFiles > 200)) {
    errors.push(`${context}:maxFiles`);
  }
  if (Object.hasOwn(value || {}, 'maxBytes')
    && (!Number.isSafeInteger(value.maxBytes) || value.maxBytes < 1 || value.maxBytes > 1_048_576)) {
    errors.push(`${context}:maxBytes`);
  }
  if (Object.hasOwn(value || {}, 'maxTokens')
    && (!Number.isSafeInteger(value.maxTokens) || value.maxTokens < 1 || value.maxTokens > 32_768)) {
    errors.push(`${context}:maxTokens`);
  }
  for (const field of ['states', 'lifecycleStates', 'keys', 'kinds', 'tags', 'notificationIds', 'acknowledgedIds']) {
    if (Object.hasOwn(value || {}, field) && !isSortedUniqueStrings(value[field])) {
      errors.push(`${context}:${field}`);
    }
  }
  return errors;
}

function fieldAt(value, path) {
  return path.split('.').reduce((current, field) => current?.[field], value);
}

export function validateM7RuntimeOperationRequest(operationId, value) {
  const descriptorValue = M7_RUNTIME_OPERATION_DESCRIPTORS[operationId];
  if (!descriptorValue) return { valid: false, errors: [`${operationId}:unknown-operation`] };
  const errors = [];
  if (!exactFields(value, descriptorValue.requestRequiredFields, descriptorValue.requestOptionalFields)) {
    errors.push(`${operationId}.request:fields`);
    return { valid: false, errors };
  }
  errors.push(...commonValidation(value, descriptorValue.requestContract, `${operationId}.request`));
  if (operationId === 'conversation.history'
    && (Object.hasOwn(value, 'anchor') === Object.hasOwn(value, 'cursor'))) {
    errors.push(`${operationId}.request:anchor-cursor`);
  }
  if (Object.hasOwn(value, 'cursor') && (typeof value.cursor !== 'string' || value.cursor.length < 16)) {
    errors.push(`${operationId}.request:cursor`);
  }
  if (Object.hasOwn(value, 'projectId')
    && (!Number.isSafeInteger(value.projectId) || value.projectId < 1)) {
    errors.push(`${operationId}.request:projectId`);
  }
  return { valid: errors.length === 0, errors };
}

export function validateM7RuntimeOperationPair(operationId, request, result) {
  const descriptorValue = M7_RUNTIME_OPERATION_DESCRIPTORS[operationId];
  if (!descriptorValue) return { valid: false, errors: [`${operationId}:unknown-operation`] };
  const errors = [];
  const requestValidation = validateM7RuntimeOperationRequest(operationId, request);
  errors.push(...requestValidation.errors);

  let required = descriptorValue.successResultRequiredFields;
  let optional = descriptorValue.successResultOptionalFields;
  if (descriptorValue.kind === 'read' && result?.status === 'error') {
    required = descriptorValue.errorResultRequiredFields;
    optional = descriptorValue.errorResultOptionalFields;
  }
  if (!exactFields(result, required, optional)) {
    errors.push(`${operationId}.result:fields`);
    return { valid: false, errors };
  }
  errors.push(...commonValidation(result, descriptorValue.resultContract, `${operationId}.result`));
  if (descriptorValue.kind === 'read' && !['ok', 'error'].includes(result.status)) {
    errors.push(`${operationId}.result:status`);
  }
  if (result.status === 'error' && !errorShape(result.error)) {
    errors.push(`${operationId}.result:error`);
  }
  if (Object.hasOwn(result, 'outcome')
    && !['CONFIRMED', 'REJECTED', 'PENDING', 'UNKNOWN'].includes(result.outcome)) {
    errors.push(`${operationId}.result:outcome`);
  }
  for (const [requestPath, resultPath, relation] of M7_RUNTIME_OPERATION_BINDINGS[operationId]) {
    const left = fieldAt(request, requestPath);
    const right = fieldAt(result, resultPath);
    if (relation === 'equal' && left !== right) errors.push(`${operationId}:binding-${requestPath}`);
    if (relation === 'equalWhenResultOk' && result.status === 'ok' && left !== right) {
      errors.push(`${operationId}:binding-${requestPath}`);
    }
    if (relation === 'lessThanOrEqual' && right > left) {
      errors.push(`${operationId}:binding-${resultPath}`);
    }
    if (relation === 'subset' && (!Array.isArray(right)
      || right.some(item => !new Set(left).has(item)))) {
      errors.push(`${operationId}:binding-${resultPath}`);
    }
  }
  return { valid: errors.length === 0, errors };
}
