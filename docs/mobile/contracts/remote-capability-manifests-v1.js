// IntentSmith Remote Companion capability manifests — mobile-owned candidate
// =============================================================================
//
// These manifests use the same contract/operation digest shape as the accepted
// M5 in-process adapter. They are provider implementation inputs, not proof
// that a provider or M7 transport exists.

import {
  MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_DIGEST_V1,
  MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1,
} from './remote-capability-requirements-v1.js';
import {
  MOBILE_REMOTE_PAYLOAD_SCHEMAS_DIGEST_V1,
  collectMobileRemoteSchemaClosure,
  validateMobileRemotePayload,
} from './remote-capability-payloads-v1.js';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function compareUtf8(left, right) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

const DIGESTS = {
  approvals: {
    contract: 'sha256:ea976e924effbf02f37692c60f1db9aece10b242f9f105d0c095769abd8f18b6',
    operations: 'sha256:2678a4096b62360bd5749b5d1c66f648d69f51c1cc4012cc85f92e09dddc4f74',
    payloadSchema: 'sha256:785419fc6d19ca29b551f3dccf9d79b0353674dfb7d01a8677f6ca039b143ef9',
  },
  conversations: {
    contract: 'sha256:fbc0d27b84fe4cda15abcda8eb91508ae7daf5ff2e4e301cdc1da5af7e96c76b',
    operations: 'sha256:839f84d1166a7caff29aa1f89f172cc96d642ee8ff37e33ab21de03347599838',
    payloadSchema: 'sha256:ae9cd76e3166a808535e03e823106f497540078c7502e420d60591f7ea266956',
  },
  events: {
    contract: 'sha256:cc371d5bff05b61a5b23a678098286044957da556c55f54a50f6e7c997524ac3',
    operations: 'sha256:975cfea739e6ee68557f718ed5deda98257402382374aee021b3f1b8bbaad977',
    payloadSchema: 'sha256:18dfc76f21b3f77a775eed7ec6a7eed5bae18892c70b708f2dd1dd8bb667102f',
  },
  notifications: {
    contract: 'sha256:d780ec62c6158338da17d434acef35c0b467d30d63e2fc3b8bb9bfa3e0220f2a',
    operations: 'sha256:75cec5c761bd213c36397b46b5205962fb7ac80115fe090efebc14f1eaa970e4',
    payloadSchema: 'sha256:27bd21b119d440ed3a8ccc91c4a3e1330335e63becb51052d8bfb39f98e0fbb7',
  },
  projects: {
    contract: 'sha256:a3b9bc367bfe8d54eb98999b348f133d704896f9fb3842f50b9b21c00dc6e9f3',
    operations: 'sha256:69bd4d5a94d8068365a6f23af74e464efe88e81e69f2925d72973f70a5c0639d',
    payloadSchema: 'sha256:d794b4efeb077cc310d7a79c96a859db5796f37758ae55759de0090f16254773',
  },
  settings: {
    contract: 'sha256:f45384dbb3c52526c43b6c23c755ef2a2a507ab68d3c979807cd2d38379296b4',
    operations: 'sha256:17d46054ce0c80b223c6f097eec95fd0eb08e61efcf383f9780dd05138784b3a',
    payloadSchema: 'sha256:263f640b13de6fb8ce328da63931a6361bceab9f6d0eeb0ce135bd005e2948c5',
  },
  stored_information: {
    contract: 'sha256:73b961d0967a94443d6632eedb01e6135c8310a5286f558b4fee2514449c96ed',
    operations: 'sha256:d01733ba8348ccde38d4a6388bf53b8b67a24dd64819966ea8903ff6b34157e5',
    payloadSchema: 'sha256:e0ce3fe78863ee45e7ca6c708e5a98667c3591971a08f7869d7edc47f484ae50',
  },
};

function createManifest(requirement) {
  const operations = requirement.operations.map(operation => ({
    operationId: operation.operationId,
    requestContract: operation.requestContract,
    resultContract: operation.resultContract,
  }));
  const contracts = [...new Set(operations.flatMap(operation => [
    operation.requestContract,
    operation.resultContract,
  ]))].sort(compareUtf8);
  const contractManifest = {
    capabilityId: requirement.capabilityId,
    version: requirement.targetVersion,
    contracts,
  };
  const operationManifest = {
    capabilityId: requirement.capabilityId,
    version: requirement.targetVersion,
    operations,
  };
  const payloadSchemaManifest = {
    capabilityId: requirement.capabilityId,
    version: requirement.targetVersion,
    schemas: collectMobileRemoteSchemaClosure(contracts),
  };
  return {
    capabilityId: requirement.capabilityId,
    version: requirement.targetVersion,
    stage: 'CANDIDATE_NOT_ACCEPTED',
    contractManifest,
    operationManifest,
    payloadSchemaManifest,
    contractDigest: DIGESTS[requirement.capabilityId].contract,
    operationsDigest: DIGESTS[requirement.capabilityId].operations,
    payloadSchemaDigest: DIGESTS[requirement.capabilityId].payloadSchema,
  };
}

const CAPABILITY_MANIFESTS = Object.fromEntries(
  MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1.capabilities.map(requirement => (
    [requirement.capabilityId, createManifest(requirement)]
  )),
);

const controlOperations = MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1
  .controlPlanePrerequisite.operations;
const controlContracts = [...new Set(controlOperations.flatMap(operation => [
  operation.requestContract,
  operation.resultContract,
]))].sort(compareUtf8);

export const MOBILE_REMOTE_CAPABILITY_MANIFESTS_STAGE_V1 = 'CANDIDATE_NOT_ACCEPTED';
export const MOBILE_REMOTE_CAPABILITY_MANIFESTS_V1 = deepFreeze(CAPABILITY_MANIFESTS);
export const MOBILE_REMOTE_CONTROL_PLANE_MANIFEST_V1 = deepFreeze({
  contract: 'MobileRemoteControlPlaneManifest',
  version: 1,
  stage: 'REQUIRED_NOT_DEFINED_BY_M7',
  owner: 'M7_SESSION_TRANSPORT_CONTRACT',
  contractManifest: {
    capabilityId: 'm7-control-plane-prerequisite',
    version: 1,
    contracts: controlContracts,
  },
  operationManifest: {
    capabilityId: 'm7-control-plane-prerequisite',
    version: 1,
    operations: controlOperations.map(operation => ({
      operationId: operation.operationId,
      requestContract: operation.requestContract,
      resultContract: operation.resultContract,
    })),
  },
  payloadSchemaManifest: {
    capabilityId: 'm7-control-plane-prerequisite',
    version: 1,
    schemas: collectMobileRemoteSchemaClosure(controlContracts),
  },
  contractDigest: 'sha256:02d60a00057857dda0b008280413f8effc54ac1406e273df2e9b902d1e76ede2',
  operationsDigest: 'sha256:3c9e13d4fbe2cca22b189986cb3822b757ee3ca7ae86a8ea687806fe73c5f0a7',
  payloadSchemaDigest: 'sha256:e06bca3432b8f8356b15f95197189e7313df91dbdc0224f8578838424ce86d7c',
  includedInM2CapabilityNegotiation: false,
});

export const MOBILE_REMOTE_CANDIDATE_ADAPTER_MANIFEST_V1 = deepFreeze({
  contract: 'MobileRemoteCandidateAdapterManifest',
  version: 1,
  stage: MOBILE_REMOTE_CAPABILITY_MANIFESTS_STAGE_V1,
  authority: 'MOBILE_CONSUMER_REQUIREMENTS_ONLY',
  requirementsDigest: MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_DIGEST_V1,
  payloadSchemasDigest: MOBILE_REMOTE_PAYLOAD_SCHEMAS_DIGEST_V1,
  capabilities: Object.values(CAPABILITY_MANIFESTS).map(capability => ({
    capabilityId: capability.capabilityId,
    version: capability.version,
    contractDigest: capability.contractDigest,
    operationsDigest: capability.operationsDigest,
    payloadSchemaDigest: capability.payloadSchemaDigest,
  })),
  controlPlane: {
    owner: MOBILE_REMOTE_CONTROL_PLANE_MANIFEST_V1.owner,
    contractDigest: MOBILE_REMOTE_CONTROL_PLANE_MANIFEST_V1.contractDigest,
    operationsDigest: MOBILE_REMOTE_CONTROL_PLANE_MANIFEST_V1.operationsDigest,
    payloadSchemaDigest: MOBILE_REMOTE_CONTROL_PLANE_MANIFEST_V1.payloadSchemaDigest,
  },
  boundary: {
    backendImplementation: 'absent',
    listener: 'absent',
    authentication: 'm7_owned_absent',
    runtimeActivation: 'forbidden_until_accepted_and_implemented',
  },
});

export const MOBILE_REMOTE_CANDIDATE_ADAPTER_MANIFEST_DIGEST_V1 =
  'sha256:abe99330702ea02ccdf7b644f4114df1b910a6e83cf3229a294a90e74c0822f4';

const BINDINGS = {
  'approval.decide': [
    ['requestId', 'requestId', 'equal'],
    ['operationId', 'operationId', 'equal'],
    ['approvalId', 'approvalId', 'equal'],
    ['decision', 'decision', 'equal'],
    ['expectedPayloadFingerprint', 'payloadFingerprint', 'equal'],
  ],
  'approval.list': [['requestId', 'requestId', 'equal']],
  'conversation.execute': [
    ['requestId', 'requestId', 'equal'],
    ['conversationId', 'conversationId', 'equal'],
    ['turnId', 'turnId', 'equal'],
  ],
  'conversation.history': [
    ['requestId', 'requestId', 'equal'],
    ['conversationId', 'conversationId', 'equal'],
  ],
  'conversation.list': [['requestId', 'requestId', 'equal']],
  'run-event.list': [
    ['requestId', 'requestId', 'equal'],
    ['runId', 'runId', 'equal'],
  ],
  'notification.ack': [
    ['requestId', 'requestId', 'equal'],
    ['operationId', 'operationId', 'equal'],
    ['observedThroughSeq', 'acknowledgedThroughSeq', 'lessThanOrEqual'],
    ['notificationIds', 'acknowledgedIds', 'subset'],
  ],
  'notification.list': [['requestId', 'requestId', 'equal']],
  'project-context.query': [
    ['requestId', 'requestId', 'equal'],
    ['projectId', 'projectId', 'equal'],
    ['workspaceRevision', 'workspaceRevision', 'equalWhenResultOk'],
  ],
  'project.list': [['requestId', 'requestId', 'equal']],
  'settings.read': [['requestId', 'requestId', 'equal']],
  'settings.update': [
    ['requestId', 'requestId', 'equal'],
    ['operationId', 'operationId', 'equal'],
    ['key', 'key', 'equal'],
  ],
  'stored-information.append': [
    ['requestId', 'requestId', 'equal'],
    ['operationId', 'operationId', 'equal'],
  ],
  'stored-information.list': [['requestId', 'requestId', 'equal']],
  'operation.abandon': [
    ['requestId', 'requestId', 'equal'],
    ['operationId', 'operationId', 'equal'],
    ['targetOperationId', 'targetOperationId', 'equal'],
  ],
  'operation.get': [
    ['requestId', 'requestId', 'equal'],
    ['operationId', 'operation.operationId', 'equalWhenResultOk'],
  ],
  'operation.list': [['requestId', 'requestId', 'equal']],
  'remote-health.read': [['requestId', 'requestId', 'equal']],
};

export const MOBILE_REMOTE_OPERATION_BINDINGS_V1 = deepFreeze(BINDINGS);

function fieldAt(value, path) {
  return path.split('.').reduce((current, key) => current?.[key], value);
}

function findOperation(operationId) {
  for (const capability of MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1.capabilities) {
    const operation = capability.operations.find(item => item.operationId === operationId);
    if (operation) return { capabilityId: capability.capabilityId, version: capability.targetVersion, operation };
  }
  const operation = controlOperations.find(item => item.operationId === operationId);
  return operation
    ? { capabilityId: 'm7-control-plane-prerequisite', version: 1, operation }
    : null;
}

export function validateMobileRemoteOperationPair({
  capabilityId,
  capabilityVersion,
  operationId,
  request,
  result,
  externalValidators = {},
}) {
  const descriptor = findOperation(operationId);
  const errors = [];
  if (!descriptor) return { valid: false, errors: [`${operationId}:unknown-operation`] };
  if (descriptor.capabilityId !== capabilityId) errors.push(`${operationId}:capability-mismatch`);
  if (descriptor.version !== capabilityVersion) errors.push(`${operationId}:version-mismatch`);
  const requestValidation = validateMobileRemotePayload(
    descriptor.operation.requestContract,
    request,
    { externalValidators, context: `${operationId}.request` },
  );
  const resultValidation = validateMobileRemotePayload(
    descriptor.operation.resultContract,
    result,
    { externalValidators, context: `${operationId}.result` },
  );
  errors.push(...requestValidation.errors, ...resultValidation.errors);
  if (requestValidation.valid && resultValidation.valid) {
    for (const [requestPath, resultPath, relation] of BINDINGS[operationId] ?? []) {
      const left = fieldAt(request, requestPath);
      const right = fieldAt(result, resultPath);
      if (relation === 'equal' && left !== right) {
        errors.push(`${operationId}:binding-${requestPath}-to-${resultPath}`);
      }
      if (relation === 'equalWhenResultOk' && result.status === 'ok' && left !== right) {
        errors.push(`${operationId}:binding-${requestPath}-to-${resultPath}`);
      }
      if (relation === 'lessThanOrEqual' && right > left) {
        errors.push(`${operationId}:binding-${resultPath}-exceeds-${requestPath}`);
      }
      if (relation === 'subset' && (!Array.isArray(right)
        || right.some(item => !new Set(left).has(item)))) {
        errors.push(`${operationId}:binding-${resultPath}-not-subset-of-${requestPath}`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}
