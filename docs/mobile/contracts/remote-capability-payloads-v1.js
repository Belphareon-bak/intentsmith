// IntentSmith Remote Companion payload schemas — mobile-owned candidate artifact
// =============================================================================
//
// This is executable schema authority for the candidate payloads introduced by
// the mobile/core handoff. It deliberately does not implement a provider, a
// listener, authentication, or persistence. Existing accepted payloads stay
// external and must be validated by their owning contract package.

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const ref = schemaId => ({ type: 'ref', schemaId });
const literal = value => ({ type: 'literal', value });
const enumOf = values => ({ type: 'enum', values });
const nullable = schema => ({ type: 'nullable', schema });
const arrayOf = (items, options = {}) => ({ type: 'array', items, ...options });
const record = (required, optional = {}, rules = []) => ({
  type: 'record',
  exact: true,
  required,
  optional,
  ...(rules.length ? { rules } : {}),
});
const contractRecord = (schemaId, required, optional = {}, rules = []) => {
  const [contract, versionText] = schemaId.split('@');
  return record({
    contract: literal(contract),
    version: literal(Number(versionText)),
    ...required,
  }, optional, rules);
};
const readResult = (schemaId, successRequired, successOptional = {}, rules = []) => {
  const [contract, versionText] = schemaId.split('@');
  const identity = {
    contract: literal(contract),
    version: literal(Number(versionText)),
    requestId: ref('Identifier'),
  };
  return {
    type: 'union',
    variants: [
      record({ ...identity, status: literal('ok'), ...successRequired }, successOptional, rules),
      record({ ...identity, status: literal('error'), error: ref('RemoteError@1') }),
    ],
  };
};

const IDENTIFIER_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$';
const ERROR_CODE_PATTERN = '^REMOTE_[A-Z0-9_]{1,80}$';
const WORKSPACE_REVISION_PATTERN = '^wsr1:[0-9a-f]{64}$';
const DIGEST_PATTERN = '^sha256:[0-9a-f]{64}$';

const SCHEMAS = {
  Identifier: { type: 'string', minBytes: 1, maxBytes: 128, pattern: IDENTIFIER_PATTERN, nfc: true },
  Revision: { type: 'string', minBytes: 1, maxBytes: 128, pattern: IDENTIFIER_PATTERN, nfc: true },
  Digest: { type: 'string', minBytes: 71, maxBytes: 71, pattern: DIGEST_PATTERN, nfc: true },
  WorkspaceRevision: {
    type: 'string', minBytes: 69, maxBytes: 69, pattern: WORKSPACE_REVISION_PATTERN, nfc: true,
  },
  Timestamp: { type: 'timestamp' },
  Cursor: { type: 'string', minBytes: 16, maxBytes: 2048, nfc: true, noControls: true },
  ShortText: { type: 'string', minBytes: 1, maxBytes: 512, nfc: true, noControls: true },
  DetailText: { type: 'string', minBytes: 1, maxBytes: 4096, nfc: true, noControls: true },
  ContentText: { type: 'string', minBytes: 1, maxBytes: 16384, nfc: true, noControls: true },
  Tag: { type: 'string', minBytes: 1, maxBytes: 64, nfc: true, noControls: true },
  NonNegativeInteger: { type: 'integer', min: 0, max: MAX_SAFE_INTEGER },
  SafeInteger: { type: 'integer', min: Number.MIN_SAFE_INTEGER, max: MAX_SAFE_INTEGER },
  PositiveInteger: { type: 'integer', min: 1, max: MAX_SAFE_INTEGER },
  Limit: { type: 'integer', min: 1, max: 200 },
  Percentage: { type: 'integer', min: 0, max: 100 },
  CanonicalDecimal: {
    type: 'string',
    minBytes: 1,
    maxBytes: 24,
    pattern: '^-?(?:0|[1-9][0-9]{0,15})(?:\\.[0-9]{0,5}[1-9])?$',
    forbiddenValues: ['-0'],
    nfc: true,
  },
  CanonicalNumeric: {
    type: 'union',
    variants: [ref('SafeInteger'), ref('CanonicalDecimal')],
  },
  JsonScalar: { type: 'jsonScalar', stringMaxBytes: 16384, noControls: true },

  'RemoteError@1': record({
    code: { type: 'string', minBytes: 8, maxBytes: 87, pattern: ERROR_CODE_PATTERN, nfc: true },
    message: { type: 'string', minBytes: 1, maxBytes: 512, nfc: true, noControls: true },
    retryable: { type: 'boolean' },
  }),

  'ApprovalItem@1': record({
    approvalId: ref('Identifier'),
    projectId: nullable(ref('PositiveInteger')),
    runId: ref('Identifier'),
    effectKind: ref('Identifier'),
    riskClass: enumOf(['low', 'medium', 'high', 'critical']),
    summary: ref('ShortText'),
    details: arrayOf(ref('DetailText'), { maxItems: 32 }),
    payloadFingerprint: ref('Digest'),
    approvalViewDigest: ref('Digest'),
    createdAt: ref('Timestamp'),
    expiresAt: ref('Timestamp'),
    state: enumOf(['pending', 'approved', 'rejected', 'expired', 'superseded']),
    revision: ref('Revision'),
  }, {}, [{ rule: 'timestampOrder', before: 'createdAt', after: 'expiresAt' }]),
  'ApprovalListQuery@1': contractRecord('ApprovalListQuery@1', {
    requestId: ref('Identifier'),
    limit: ref('Limit'),
  }, {
    cursor: ref('Cursor'),
    states: arrayOf(enumOf(['pending', 'approved', 'rejected', 'expired', 'superseded']), {
      minItems: 1, maxItems: 5, sortedUnique: true,
    }),
  }),
  'ApprovalPage@1': readResult('ApprovalPage@1', {
    items: arrayOf(ref('ApprovalItem@1'), { maxItems: 200 }),
    end: { type: 'boolean' },
    nextCursor: nullable(ref('Cursor')),
    snapshotRevision: ref('Revision'),
  }, {}, [{ rule: 'endCursor' }]),
  'ApprovalDecisionCommand@1': contractRecord('ApprovalDecisionCommand@1', {
    requestId: ref('Identifier'),
    operationId: ref('Identifier'),
    approvalId: ref('Identifier'),
    decision: enumOf(['approve', 'reject']),
    expectedPayloadFingerprint: ref('Digest'),
    expectedViewDigest: ref('Digest'),
    expectedRevision: ref('Revision'),
  }),
  'ApprovalDecisionResult@1': contractRecord('ApprovalDecisionResult@1', {
    requestId: ref('Identifier'),
    operationId: ref('Identifier'),
    approvalId: ref('Identifier'),
    decision: enumOf(['approve', 'reject']),
    approvalState: enumOf(['approved', 'rejected', 'expired', 'superseded']),
    payloadFingerprint: ref('Digest'),
    revision: ref('Revision'),
    outcome: enumOf(['CONFIRMED', 'REJECTED', 'PENDING', 'UNKNOWN']),
    replayed: { type: 'boolean' },
  }, {
    error: ref('RemoteError@1'),
  }, [{ rule: 'mutationOutcome', pendingApproval: 'forbidden' }]),

  'ConversationItem@1': record({
    conversationId: ref('Identifier'),
    projectId: nullable(ref('PositiveInteger')),
    title: ref('ShortText'),
    state: enumOf(['active', 'archived']),
    messageCount: ref('NonNegativeInteger'),
    updatedAt: ref('Timestamp'),
    revision: ref('Revision'),
  }),
  'ConversationMessage@1': record({
    messageId: ref('Identifier'),
    turnId: ref('Identifier'),
    role: enumOf(['user', 'assistant', 'system']),
    content: ref('ContentText'),
    status: enumOf(['ok', 'cancelled', 'timeout', 'error']),
    createdAt: ref('Timestamp'),
    revision: ref('Revision'),
  }),
  'ConversationListQuery@1': contractRecord('ConversationListQuery@1', {
    requestId: ref('Identifier'),
    limit: ref('Limit'),
  }, { cursor: ref('Cursor') }),
  'ConversationPage@1': readResult('ConversationPage@1', {
    items: arrayOf(ref('ConversationItem@1'), { maxItems: 200 }),
    end: { type: 'boolean' },
    nextCursor: nullable(ref('Cursor')),
    snapshotRevision: ref('Revision'),
  }, {}, [{ rule: 'endCursor' }]),
  'ConversationHistoryQuery@1': contractRecord('ConversationHistoryQuery@1', {
    requestId: ref('Identifier'),
    conversationId: ref('Identifier'),
    limit: ref('Limit'),
  }, {
    anchor: literal('latest'),
    cursor: ref('Cursor'),
  }, [{ rule: 'exactlyOne', fields: ['anchor', 'cursor'] }]),
  'ConversationHistoryPage@1': {
    type: 'union',
    variants: [
      contractRecord('ConversationHistoryPage@1', {
        requestId: ref('Identifier'),
        conversationId: ref('Identifier'),
        status: literal('ok'),
        messages: arrayOf(ref('ConversationMessage@1'), { maxItems: 200 }),
        end: { type: 'boolean' },
        nextCursor: nullable(ref('Cursor')),
        snapshotRevision: ref('Revision'),
      }, {}, [{ rule: 'endCursor' }, { rule: 'ascending', field: 'createdAt', array: 'messages' }]),
      contractRecord('ConversationHistoryPage@1', {
        requestId: ref('Identifier'),
        conversationId: ref('Identifier'),
        status: literal('error'),
        error: ref('RemoteError@1'),
      }),
    ],
  },

  'RunEventCorrelation@1': record({
    conversationId: nullable(ref('Identifier')),
    turnId: nullable(ref('Identifier')),
    projectId: nullable(ref('PositiveInteger')),
  }),
  'RunEvent@1': record({
    eventId: ref('Identifier'),
    runId: ref('Identifier'),
    sequence: ref('PositiveInteger'),
    phase: enumOf(['progress', 'terminal']),
    eventType: ref('Identifier'),
    occurredAt: ref('Timestamp'),
    title: ref('ShortText'),
    detail: nullable(ref('DetailText')),
    progressPercent: nullable(ref('Percentage')),
    terminalStatus: nullable(enumOf(['ok', 'cancelled', 'timeout', 'error'])),
    correlation: ref('RunEventCorrelation@1'),
  }, {}, [{ rule: 'terminalEvent' }]),
  'RunEventQuery@1': contractRecord('RunEventQuery@1', {
    requestId: ref('Identifier'),
    runId: ref('Identifier'),
    limit: ref('Limit'),
  }, {
    afterSeq: ref('NonNegativeInteger'),
    waitMs: { type: 'integer', min: 0, max: 30000 },
  }),
  'RunEventPage@1': {
    type: 'union',
    variants: [
      contractRecord('RunEventPage@1', {
        requestId: ref('Identifier'),
        runId: ref('Identifier'),
        status: literal('ok'),
        events: arrayOf(ref('RunEvent@1'), { maxItems: 200 }),
        windowStartSeq: ref('NonNegativeInteger'),
        windowEndSeq: ref('NonNegativeInteger'),
        nextAfterSeq: ref('NonNegativeInteger'),
        caughtUp: { type: 'boolean' },
        terminal: { type: 'boolean' },
      }, {}, [{ rule: 'sequenceWindow' }]),
      contractRecord('RunEventPage@1', {
        requestId: ref('Identifier'),
        runId: ref('Identifier'),
        status: literal('error'),
        error: ref('RemoteError@1'),
      }),
    ],
  },

  'NotificationTarget@1': record({
    type: enumOf(['approval', 'conversation', 'project', 'run']),
    id: ref('Identifier'),
  }),
  'NotificationItem@1': record({
    notificationId: ref('Identifier'),
    sequence: ref('PositiveInteger'),
    kind: ref('Identifier'),
    priority: enumOf(['low', 'normal', 'high']),
    title: ref('ShortText'),
    target: ref('NotificationTarget@1'),
    projectId: nullable(ref('PositiveInteger')),
    createdAt: ref('Timestamp'),
    readAt: nullable(ref('Timestamp')),
    revision: ref('Revision'),
  }, {}, [{ rule: 'nullableTimestampOrder', before: 'createdAt', after: 'readAt' }]),
  'NotificationListQuery@1': contractRecord('NotificationListQuery@1', {
    requestId: ref('Identifier'),
    limit: ref('Limit'),
  }, { afterSeq: ref('NonNegativeInteger') }),
  'NotificationPage@1': readResult('NotificationPage@1', {
    items: arrayOf(ref('NotificationItem@1'), { maxItems: 200 }),
    nextAfterSeq: ref('NonNegativeInteger'),
    caughtUp: { type: 'boolean' },
  }, {}, [{ rule: 'ascending', field: 'sequence' }, { rule: 'nextSequence', array: 'items' }]),
  'NotificationAckCommand@1': contractRecord('NotificationAckCommand@1', {
    requestId: ref('Identifier'),
    operationId: ref('Identifier'),
    notificationIds: arrayOf(ref('Identifier'), { minItems: 1, maxItems: 200, sortedUnique: true }),
    observedThroughSeq: ref('NonNegativeInteger'),
  }),
  'NotificationAckResult@1': contractRecord('NotificationAckResult@1', {
    requestId: ref('Identifier'),
    operationId: ref('Identifier'),
    acknowledgedIds: arrayOf(ref('Identifier'), { maxItems: 200, sortedUnique: true }),
    acknowledgedThroughSeq: ref('NonNegativeInteger'),
    revision: ref('Revision'),
    outcome: enumOf(['CONFIRMED', 'REJECTED', 'PENDING', 'UNKNOWN']),
    replayed: { type: 'boolean' },
  }, { error: ref('RemoteError@1') }, [{ rule: 'mutationOutcome', pendingApproval: 'forbidden' }]),

  'RemoteProjectContextQuery@1': contractRecord('RemoteProjectContextQuery@1', {
    requestId: ref('Identifier'),
    projectId: ref('PositiveInteger'),
    workspaceRevision: ref('WorkspaceRevision'),
    queryText: ref('ContentText'),
    maxFiles: { type: 'integer', min: 1, max: 200 },
    maxBytes: { type: 'integer', min: 1, max: 1048576 },
    maxTokens: { type: 'integer', min: 1, max: 32768 },
  }),
  'ProjectItem@1': record({
    projectId: ref('PositiveInteger'),
    name: ref('ShortText'),
    lifecycleStage: ref('Identifier'),
    updatedAt: ref('Timestamp'),
    workspaceRevision: ref('WorkspaceRevision'),
    revision: ref('Revision'),
  }),
  'ProjectListQuery@1': contractRecord('ProjectListQuery@1', {
    requestId: ref('Identifier'),
    limit: ref('Limit'),
  }, {
    cursor: ref('Cursor'),
    lifecycleStates: arrayOf(ref('Identifier'), { minItems: 1, maxItems: 32, sortedUnique: true }),
  }),
  'ProjectPage@1': readResult('ProjectPage@1', {
    items: arrayOf(ref('ProjectItem@1'), { maxItems: 200 }),
    end: { type: 'boolean' },
    nextCursor: nullable(ref('Cursor')),
    snapshotRevision: ref('Revision'),
  }, {}, [{ rule: 'endCursor' }]),

  'MobileSettingConstraints@1': record({}, {
    minimum: ref('CanonicalNumeric'),
    maximum: ref('CanonicalNumeric'),
    step: ref('CanonicalNumeric'),
    enumValues: arrayOf(ref('JsonScalar'), { minItems: 1, maxItems: 64, sortedUnique: true }),
    maxBytes: { type: 'integer', min: 1, max: 16384 },
  }, [{ rule: 'numericConstraints' }]),
  'MobileSettingItem@1': record({
    key: ref('Identifier'),
    category: enumOf(['llm', 'notifications', 'appearance', 'memory', 'system']),
    valueType: enumOf(['boolean', 'integer', 'number', 'string', 'enum']),
    value: ref('JsonScalar'),
    writable: { type: 'boolean' },
    constraints: ref('MobileSettingConstraints@1'),
    revision: ref('Revision'),
  }, {}, [{ rule: 'settingValueType' }]),
  'MobileSettingsQuery@1': contractRecord('MobileSettingsQuery@1', {
    requestId: ref('Identifier'),
  }, {
    keys: arrayOf(ref('Identifier'), { minItems: 1, maxItems: 128, sortedUnique: true }),
  }),
  'MobileSettingsSnapshot@1': readResult('MobileSettingsSnapshot@1', {
    items: arrayOf(ref('MobileSettingItem@1'), { maxItems: 128 }),
    revision: ref('Revision'),
  }, {}, [{ rule: 'ascending', field: 'key' }]),
  'MobileSettingUpdateCommand@1': contractRecord('MobileSettingUpdateCommand@1', {
    requestId: ref('Identifier'),
    operationId: ref('Identifier'),
    key: ref('Identifier'),
    value: ref('JsonScalar'),
    expectedRevision: ref('Revision'),
  }),
  'MobileSettingUpdateResult@1': contractRecord('MobileSettingUpdateResult@1', {
    requestId: ref('Identifier'),
    operationId: ref('Identifier'),
    key: ref('Identifier'),
    value: ref('JsonScalar'),
    revision: ref('Revision'),
    outcome: enumOf(['CONFIRMED', 'REJECTED', 'PENDING', 'UNKNOWN']),
    replayed: { type: 'boolean' },
  }, {
    pendingApprovalId: ref('Identifier'),
    error: ref('RemoteError@1'),
  }, [{ rule: 'mutationOutcome', pendingApproval: 'requiredWhenPending' }]),

  'StoredInformationItem@1': record({
    informationId: ref('Identifier'),
    kind: enumOf(['manual_note', 'task_memory', 'long_term_memory']),
    projectId: nullable(ref('PositiveInteger')),
    summary: ref('ShortText'),
    content: ref('ContentText'),
    tags: arrayOf(ref('Tag'), { maxItems: 32, sortedUnique: true }),
    createdAt: ref('Timestamp'),
    updatedAt: ref('Timestamp'),
    revision: ref('Revision'),
  }, {}, [{ rule: 'timestampOrder', before: 'createdAt', after: 'updatedAt' }]),
  'StoredInformationListQuery@1': contractRecord('StoredInformationListQuery@1', {
    requestId: ref('Identifier'),
    limit: ref('Limit'),
  }, {
    cursor: ref('Cursor'),
    kinds: arrayOf(enumOf(['manual_note', 'task_memory', 'long_term_memory']), {
      minItems: 1, maxItems: 3, sortedUnique: true,
    }),
    projectId: ref('PositiveInteger'),
  }),
  'StoredInformationPage@1': readResult('StoredInformationPage@1', {
    items: arrayOf(ref('StoredInformationItem@1'), { maxItems: 200 }),
    end: { type: 'boolean' },
    nextCursor: nullable(ref('Cursor')),
    snapshotRevision: ref('Revision'),
  }, {}, [{ rule: 'endCursor' }]),
  'StoredInformationAppendCommand@1': contractRecord('StoredInformationAppendCommand@1', {
    requestId: ref('Identifier'),
    operationId: ref('Identifier'),
    content: ref('ContentText'),
  }, {
    projectId: ref('PositiveInteger'),
    tags: arrayOf(ref('Tag'), { maxItems: 32, sortedUnique: true }),
  }),
  'StoredInformationAppendResult@1': contractRecord('StoredInformationAppendResult@1', {
    requestId: ref('Identifier'),
    operationId: ref('Identifier'),
    informationId: ref('Identifier'),
    revision: ref('Revision'),
    outcome: enumOf(['CONFIRMED', 'REJECTED', 'PENDING', 'UNKNOWN']),
    replayed: { type: 'boolean' },
  }, {
    pendingApprovalId: ref('Identifier'),
    error: ref('RemoteError@1'),
  }, [{ rule: 'mutationOutcome', pendingApproval: 'requiredWhenPending' }]),

  'OperationRecord@1': record({
    operationId: ref('Identifier'),
    operationKind: ref('Identifier'),
    requestDigest: ref('Digest'),
    state: enumOf(['pending', 'confirmed', 'rejected', 'unknown', 'abandoned']),
    createdAt: ref('Timestamp'),
    updatedAt: ref('Timestamp'),
    resultReference: nullable(ref('Identifier')),
    canAbandon: { type: 'boolean' },
    revision: ref('Revision'),
  }, {}, [
    { rule: 'timestampOrder', before: 'createdAt', after: 'updatedAt' },
    { rule: 'operationState' },
  ]),
  'OperationAbandonCommand@1': contractRecord('OperationAbandonCommand@1', {
    requestId: ref('Identifier'),
    operationId: ref('Identifier'),
    targetOperationId: ref('Identifier'),
    expectedRevision: ref('Revision'),
  }),
  'OperationAbandonResult@1': contractRecord('OperationAbandonResult@1', {
    requestId: ref('Identifier'),
    operationId: ref('Identifier'),
    targetOperationId: ref('Identifier'),
    revision: ref('Revision'),
    outcome: enumOf(['CONFIRMED', 'REJECTED', 'PENDING', 'UNKNOWN']),
    replayed: { type: 'boolean' },
  }, { error: ref('RemoteError@1') }, [{ rule: 'mutationOutcome', pendingApproval: 'forbidden' }]),
  'OperationLookupQuery@1': contractRecord('OperationLookupQuery@1', {
    requestId: ref('Identifier'),
    operationId: ref('Identifier'),
  }),
  'OperationLookupResult@1': readResult('OperationLookupResult@1', {
    operation: ref('OperationRecord@1'),
    revision: ref('Revision'),
  }),
  'OperationListQuery@1': contractRecord('OperationListQuery@1', {
    requestId: ref('Identifier'),
    limit: ref('Limit'),
  }, {
    cursor: ref('Cursor'),
    states: arrayOf(enumOf(['pending', 'confirmed', 'rejected', 'unknown', 'abandoned']), {
      minItems: 1, maxItems: 5, sortedUnique: true,
    }),
  }),
  'OperationPage@1': readResult('OperationPage@1', {
    items: arrayOf(ref('OperationRecord@1'), { maxItems: 200 }),
    end: { type: 'boolean' },
    nextCursor: nullable(ref('Cursor')),
    snapshotRevision: ref('Revision'),
  }, {}, [{ rule: 'endCursor' }]),
  'RemoteHealthQuery@1': contractRecord('RemoteHealthQuery@1', {
    requestId: ref('Identifier'),
  }),
  'RemoteHealthComponent@1': record({
    componentId: ref('Identifier'),
    status: enumOf(['ok', 'degraded', 'unavailable']),
    code: ref('Identifier'),
  }),
  'RemoteHealthSnapshot@1': readResult('RemoteHealthSnapshot@1', {
    coreVersion: { type: 'string', minBytes: 1, maxBytes: 128, nfc: true, noControls: true },
    observedAt: ref('Timestamp'),
    components: arrayOf(ref('RemoteHealthComponent@1'), { maxItems: 32 }),
  }, {}, [{ rule: 'ascending', field: 'componentId', array: 'components' }]),
};

const EXTERNAL_ACCEPTED_CONTRACTS = {
  'ConversationCommand@1': {
    owner: 'contracts/m1',
    validator: 'validateConversationCommand',
  },
  'ConversationResult@1': {
    owner: 'contracts/m1',
    validator: 'validateConversationResult',
  },
  'ProjectContextSnapshot@1': {
    owner: 'contracts/m2/project-context-v1.js',
    validator: 'validateProjectContextSnapshot',
  },
};

function plain(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function compareUtf8(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function canonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function has(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function scalarKey(value) {
  return `${typeof value}:${JSON.stringify(value)}`;
}

function applyRule(rule, value, context, errors) {
  if (rule.rule === 'exactlyOne') {
    if (rule.fields.filter(field => has(value, field)).length !== 1) {
      errors.push(`${context}:exactly-one-${rule.fields.join('-or-')}`);
    }
    return;
  }
  if (rule.rule === 'endCursor') {
    if ((value.end === true) !== (value.nextCursor === null)) {
      errors.push(`${context}:end-nextCursor-mismatch`);
    }
    return;
  }
  if (rule.rule === 'ascending') {
    const items = value[rule.array ?? 'items'];
    if (Array.isArray(items)) {
      for (let index = 1; index < items.length; index += 1) {
        if (compareUtf8(items[index - 1]?.[rule.field], items[index]?.[rule.field]) >= 0) {
          errors.push(`${context}:${rule.array ?? 'items'}-not-strictly-ascending-${rule.field}`);
          break;
        }
      }
    }
    return;
  }
  if (rule.rule === 'timestampOrder' || rule.rule === 'nullableTimestampOrder') {
    if (value[rule.after] === null && rule.rule === 'nullableTimestampOrder') return;
    const before = Date.parse(value[rule.before]);
    const after = Date.parse(value[rule.after]);
    if (Number.isFinite(before) && Number.isFinite(after) && after < before) {
      errors.push(`${context}:${rule.after}-before-${rule.before}`);
    }
    return;
  }
  if (rule.rule === 'terminalEvent') {
    const terminal = value.phase === 'terminal';
    if (terminal !== (value.terminalStatus !== null)) {
      errors.push(`${context}:phase-terminalStatus-mismatch`);
    }
    return;
  }
  if (rule.rule === 'sequenceWindow') {
    const events = Array.isArray(value.events) ? value.events : [];
    if (value.windowEndSeq < value.windowStartSeq || value.nextAfterSeq > value.windowEndSeq) {
      errors.push(`${context}:invalid-sequence-window`);
    }
    for (let index = 1; index < events.length; index += 1) {
      if (events[index - 1].sequence >= events[index].sequence) {
        errors.push(`${context}:events-not-strictly-ascending-sequence`);
        break;
      }
    }
    if (events.some(event => event.runId !== value.runId)) errors.push(`${context}:foreign-run-event`);
    if (events.length && value.nextAfterSeq !== events.at(-1).sequence) {
      errors.push(`${context}:nextAfterSeq-not-last-event`);
    }
    if (!events.length && value.nextAfterSeq < value.windowStartSeq) {
      errors.push(`${context}:nextAfterSeq-before-window`);
    }
    if (value.terminal === true && events.length && events.at(-1).phase !== 'terminal') {
      errors.push(`${context}:terminal-without-terminal-event`);
    }
    return;
  }
  if (rule.rule === 'nextSequence') {
    const items = Array.isArray(value[rule.array]) ? value[rule.array] : [];
    if (items.length && value.nextAfterSeq !== items.at(-1).sequence) {
      errors.push(`${context}:nextAfterSeq-not-last-item`);
    }
    return;
  }
  if (rule.rule === 'mutationOutcome') {
    const hasError = has(value, 'error');
    const hasPending = has(value, 'pendingApprovalId');
    if (value.outcome === 'CONFIRMED' && (hasError || hasPending)) {
      errors.push(`${context}:confirmed-cannot-carry-error-or-pending-approval`);
    }
    if (['REJECTED', 'UNKNOWN'].includes(value.outcome) && !hasError) {
      errors.push(`${context}:${value.outcome.toLowerCase()}-requires-error`);
    }
    if (value.outcome === 'PENDING' && rule.pendingApproval === 'requiredWhenPending' && !hasPending) {
      errors.push(`${context}:pending-requires-pendingApprovalId`);
    }
    if (value.outcome !== 'PENDING' && hasPending) {
      errors.push(`${context}:pendingApprovalId-only-with-pending`);
    }
    if (rule.pendingApproval === 'forbidden' && hasPending) {
      errors.push(`${context}:pendingApprovalId-forbidden`);
    }
    return;
  }
  if (rule.rule === 'numericConstraints') {
    const numeric = item => typeof item === 'number' ? item : Number(item);
    if (has(value, 'minimum') && has(value, 'maximum')
      && numeric(value.minimum) > numeric(value.maximum)) {
      errors.push(`${context}:minimum-exceeds-maximum`);
    }
    if (has(value, 'step') && (!(numeric(value.step) > 0) || !Number.isFinite(numeric(value.step)))) {
      errors.push(`${context}:invalid-step`);
    }
    return;
  }
  if (rule.rule === 'settingValueType') {
    const type = typeof value.value;
    const matches = value.valueType === 'boolean' ? type === 'boolean'
        : value.valueType === 'integer' ? Number.isSafeInteger(value.value)
        : value.valueType === 'number' ? typeof value.value === 'string'
          && /^-?(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{0,5}[1-9])?$/.test(value.value)
          && value.value !== '-0'
          : value.valueType === 'string' ? type === 'string'
            : value.constraints?.enumValues?.some(item => scalarKey(item) === scalarKey(value.value));
    if (!matches) errors.push(`${context}:value-does-not-match-valueType`);
    return;
  }
  if (rule.rule === 'operationState') {
    const terminal = ['confirmed', 'rejected', 'abandoned'].includes(value.state);
    if (value.canAbandon === true && !['pending', 'unknown'].includes(value.state)) {
      errors.push(`${context}:terminal-operation-cannot-be-abandoned`);
    }
    if (terminal && value.state !== 'abandoned' && value.resultReference === null) {
      errors.push(`${context}:terminal-operation-requires-resultReference`);
    }
  }
}

function validateDescriptor(schema, value, context, errors, depth) {
  if (depth > 32) {
    errors.push(`${context}:too-deep`);
    return;
  }
  if (schema.type === 'ref') {
    const resolved = SCHEMAS[schema.schemaId];
    if (!resolved) {
      errors.push(`${context}:unknown-schema-${schema.schemaId}`);
      return;
    }
    validateDescriptor(resolved, value, context, errors, depth + 1);
    return;
  }
  if (schema.type === 'literal') {
    if (value !== schema.value) errors.push(`${context}:expected-${JSON.stringify(schema.value)}`);
    return;
  }
  if (schema.type === 'enum') {
    if (!schema.values.includes(value)) errors.push(`${context}:invalid-enum`);
    return;
  }
  if (schema.type === 'nullable') {
    if (value !== null) validateDescriptor(schema.schema, value, context, errors, depth + 1);
    return;
  }
  if (schema.type === 'union') {
    const variants = schema.variants.map(variant => {
      const variantErrors = [];
      validateDescriptor(variant, value, context, variantErrors, depth + 1);
      return variantErrors;
    });
    if (!variants.some(variantErrors => variantErrors.length === 0)) {
      errors.push(`${context}:no-union-variant`);
      errors.push(...variants.sort((left, right) => left.length - right.length)[0]);
    }
    return;
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') {
      errors.push(`${context}:not-string`);
      return;
    }
    const bytes = new TextEncoder().encode(value).length;
    if (bytes < (schema.minBytes ?? 0) || bytes > (schema.maxBytes ?? Infinity)) {
      errors.push(`${context}:invalid-byte-length`);
    }
    if (schema.nfc && value.normalize('NFC') !== value) errors.push(`${context}:not-nfc`);
    if (schema.noControls && /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
      errors.push(`${context}:control-character`);
    }
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) {
      errors.push(`${context}:pattern-mismatch`);
    }
    if (schema.forbiddenValues?.includes(value)) errors.push(`${context}:forbidden-value`);
    return;
  }
  if (schema.type === 'timestamp') {
    if (!canonicalTimestamp(value)) errors.push(`${context}:invalid-timestamp`);
    return;
  }
  if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)
      || value < schema.min || value > schema.max) errors.push(`${context}:invalid-integer`);
    return;
  }
  if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)) {
      errors.push(`${context}:invalid-number`);
    }
    return;
  }
  if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') errors.push(`${context}:not-boolean`);
    return;
  }
  if (schema.type === 'jsonScalar') {
    if (!(value === null || ['string', 'boolean'].includes(typeof value)
      || (typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0)))) {
      errors.push(`${context}:not-json-scalar`);
    }
    if (typeof value === 'string' && value.normalize('NFC') !== value) errors.push(`${context}:not-nfc`);
    if (typeof value === 'string'
      && new TextEncoder().encode(value).length > (schema.stringMaxBytes ?? Infinity)) {
      errors.push(`${context}:invalid-byte-length`);
    }
    if (typeof value === 'string' && schema.noControls
      && /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
      errors.push(`${context}:control-character`);
    }
    return;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${context}:not-array`);
      return;
    }
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) {
      errors.push(`${context}:invalid-item-count`);
    }
    value.forEach((item, index) => validateDescriptor(
      schema.items, item, `${context}[${index}]`, errors, depth + 1,
    ));
    if (schema.sortedUnique) {
      for (let index = 1; index < value.length; index += 1) {
        if (compareUtf8(scalarKey(value[index - 1]), scalarKey(value[index])) >= 0) {
          errors.push(`${context}:not-sorted-unique`);
          break;
        }
      }
    }
    return;
  }
  if (schema.type === 'record') {
    if (!plain(value)) {
      errors.push(`${context}:not-object`);
      return;
    }
    const required = Object.keys(schema.required);
    const allowed = new Set([...required, ...Object.keys(schema.optional ?? {})]);
    for (const key of required) {
      if (!has(value, key)) errors.push(`${context}:missing-${key}`);
    }
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) errors.push(`${context}:unknown-${key}`);
    }
    for (const [key, child] of Object.entries(schema.required)) {
      if (has(value, key)) validateDescriptor(child, value[key], `${context}.${key}`, errors, depth + 1);
    }
    for (const [key, child] of Object.entries(schema.optional ?? {})) {
      if (has(value, key)) validateDescriptor(child, value[key], `${context}.${key}`, errors, depth + 1);
    }
    for (const rule of schema.rules ?? []) applyRule(rule, value, context, errors);
    return;
  }
  errors.push(`${context}:unsupported-schema-type-${schema.type}`);
}

export const MOBILE_REMOTE_PAYLOAD_SCHEMA_STAGE_V1 = 'CANDIDATE_NOT_ACCEPTED';
export const MOBILE_REMOTE_PAYLOAD_SCHEMAS_V1 = deepFreeze({
  contract: 'MobileRemotePayloadSchemas',
  version: 1,
  stage: MOBILE_REMOTE_PAYLOAD_SCHEMA_STAGE_V1,
  authority: 'MOBILE_CONSUMER_SCHEMA_CANDIDATE',
  compatibility: {
    exactKeys: true,
    implicitCoercion: false,
    implicitDowngrade: false,
    unknownFields: 'reject',
  },
  schemas: SCHEMAS,
  externalAcceptedContracts: EXTERNAL_ACCEPTED_CONTRACTS,
});

export function validateMobileRemotePayload(schemaId, value, {
  externalValidators = {},
  context = schemaId,
} = {}) {
  if (EXTERNAL_ACCEPTED_CONTRACTS[schemaId]) {
    const validator = externalValidators[schemaId];
    if (typeof validator !== 'function') {
      return { valid: false, errors: [`${context}:external-validator-required-${schemaId}`] };
    }
    const result = validator(value);
    if (result?.valid === true) return { valid: true, errors: [] };
    return {
      valid: false,
      errors: Array.isArray(result?.errors) && result.errors.length
        ? result.errors.map(error => `${context}:external:${error}`)
        : [`${context}:external-validation-failed-${schemaId}`],
    };
  }
  const schema = SCHEMAS[schemaId];
  if (!schema) return { valid: false, errors: [`${context}:unknown-schema-${schemaId}`] };
  const errors = [];
  validateDescriptor(schema, value, context, errors, 0);
  return { valid: errors.length === 0, errors };
}

export function collectMobileRemoteSchemaClosure(schemaIds) {
  const found = new Set();
  const visit = schemaId => {
    if (found.has(schemaId) || EXTERNAL_ACCEPTED_CONTRACTS[schemaId]) return;
    const schema = SCHEMAS[schemaId];
    if (!schema) throw new TypeError(`mobile-remote-schema:unknown-${schemaId}`);
    found.add(schemaId);
    const walk = descriptor => {
      if (!descriptor || typeof descriptor !== 'object') return;
      if (descriptor.type === 'ref') {
        visit(descriptor.schemaId);
        return;
      }
      for (const child of Object.values(descriptor)) {
        if (Array.isArray(child)) child.forEach(walk);
        else walk(child);
      }
    };
    walk(schema);
  };
  schemaIds.forEach(visit);
  return [...found].sort(compareUtf8).map(schemaId => ({ schemaId, schema: SCHEMAS[schemaId] }));
}

// Digest of MOBILE_REMOTE_PAYLOAD_SCHEMAS_V1 using the RemoteCore canonical
// JSON algorithm. Updated only by the validation gate after an intentional
// schema version change.
export const MOBILE_REMOTE_PAYLOAD_SCHEMAS_DIGEST_V1 =
  'sha256:1f9ac2bba6253fa8577d86f87233a912f0ea307cf9d5e51b4f66ceb94a03753b';
