import { computeM2RemoteCoreValueDigest } from '../m2/remote-core-port-v1.js';

export const M5_REMOTE_CORE_ADAPTER_CONTRACT = 'RemoteCoreAdapterManifest';
export const M5_REMOTE_CORE_ADAPTER_VERSION = 1;
export const M5_REMOTE_CORE_ADAPTER_STAGE = 'PINNED_V1';

export const M5_REMOTE_CORE_OPERATION = Object.freeze({
  CONVERSATION_EXECUTE: 'conversation.execute',
  PROJECT_CONTEXT_QUERY: 'project-context.query',
});

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function capability({ capabilityId, contracts, operation }) {
  const operations = [{
    operationId: operation.operationId,
    requestContract: operation.requestContract,
    resultContract: operation.resultContract,
  }];
  const contractManifest = { capabilityId, version: 1, contracts };
  const operationManifest = { capabilityId, version: 1, operations };
  return {
    capabilityId,
    version: 1,
    contractManifest,
    operationManifest,
    contractDigest: computeM2RemoteCoreValueDigest(contractManifest),
    operationsDigest: computeM2RemoteCoreValueDigest(operationManifest),
  };
}

const CAPABILITIES = [
  capability({
    capabilityId: 'conversations',
    contracts: ['ConversationCommand@1', 'ConversationResult@1'],
    operation: {
      operationId: M5_REMOTE_CORE_OPERATION.CONVERSATION_EXECUTE,
      requestContract: 'ConversationCommand@1',
      resultContract: 'ConversationResult@1',
    },
  }),
  capability({
    capabilityId: 'projects',
    contracts: ['ProjectContextQuery@1', 'ProjectContextSnapshot@1'],
    operation: {
      operationId: M5_REMOTE_CORE_OPERATION.PROJECT_CONTEXT_QUERY,
      requestContract: 'ProjectContextQuery@1',
      resultContract: 'ProjectContextSnapshot@1',
    },
  }),
];

export const M5_REMOTE_CORE_ADAPTER_MANIFEST_V1 = deepFreeze({
  contract: M5_REMOTE_CORE_ADAPTER_CONTRACT,
  version: M5_REMOTE_CORE_ADAPTER_VERSION,
  stage: M5_REMOTE_CORE_ADAPTER_STAGE,
  capabilities: CAPABILITIES,
  boundary: {
    authentication: 'transport_owned_not_implemented',
    invocation: 'in_process_only',
    legacyRoutes: 'forbidden',
    listener: 'not_implemented',
    negotiationAuthority: 'none',
    pairing: 'not_implemented',
  },
});

export const M5_REMOTE_CORE_ADAPTER_MANIFEST_DIGEST_V1 =
  computeM2RemoteCoreValueDigest(M5_REMOTE_CORE_ADAPTER_MANIFEST_V1);

export const M5_REMOTE_CORE_CAPABILITY_MANIFESTS_V1 = deepFreeze(
  Object.fromEntries(CAPABILITIES.map(item => [item.capabilityId, item])),
);
