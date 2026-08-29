// M7 transport-free capability provider boundary.
//
// This module deliberately imports no candidate contract, backend repository,
// listener or transport. Composition injects the exact reviewed manifests and
// validators. The provider cannot activate itself and has no allow-all default.

export const M7_IN_PROCESS_PROVIDER_STAGE = 'IMPLEMENTED_NOT_ACTIVE';

export const M7_IN_PROCESS_PROVIDER_ERROR = Object.freeze({
  AUTHORITY_DENIED: 'M7_PROVIDER_AUTHORITY_DENIED',
  AUTHORITY_INVALID: 'M7_PROVIDER_AUTHORITY_INVALID',
  CAPABILITY_UNAVAILABLE: 'M7_PROVIDER_CAPABILITY_UNAVAILABLE',
  CONFIG_INVALID: 'M7_PROVIDER_CONFIG_INVALID',
  INVALID_INVOCATION: 'M7_PROVIDER_INVALID_INVOCATION',
  INVALID_REQUEST: 'M7_PROVIDER_INVALID_REQUEST',
  INVALID_RESULT: 'M7_PROVIDER_INVALID_RESULT',
  JOURNAL_PROTOCOL: 'M7_PROVIDER_JOURNAL_PROTOCOL',
  OPERATION_UNAVAILABLE: 'M7_PROVIDER_OPERATION_UNAVAILABLE',
});

const INVOCATION_KEYS = Object.freeze([
  'capabilityId',
  'capabilityVersion',
  'operationId',
  'request',
]);

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function plain(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys) {
  return plain(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function requireFunction(value, name) {
  if (typeof value !== 'function') fail(
    M7_IN_PROCESS_PROVIDER_ERROR.CONFIG_INVALID,
    `m7-provider:${name}-required`,
  );
  return value;
}

function cloneFrozen(value, label) {
  try {
    return deepFreeze(structuredClone(value));
  } catch {
    fail(
      M7_IN_PROCESS_PROVIDER_ERROR.INVALID_INVOCATION,
      `m7-provider:${label}-not-cloneable`,
    );
  }
}

function requireValidation(validation, code, label) {
  if (!plain(validation) || validation.valid !== true || !Array.isArray(validation.errors)) {
    const details = plain(validation) && Array.isArray(validation.errors)
      ? validation.errors.join(',')
      : 'validator-invalid-result';
    fail(code, `m7-provider:${label}:${details}`);
  }
}

function normalizeAuthorityDecision(value, requiredScopes) {
  if (!exactKeys(value, ['decision', 'deviceId', 'subjectId', 'grantedScopes'])
    || !['allow', 'deny'].includes(value.decision)
    || !Array.isArray(value.grantedScopes)
    || value.grantedScopes.some(scope => typeof scope !== 'string' || scope.length === 0)
    || new Set(value.grantedScopes).size !== value.grantedScopes.length
    || (value.decision === 'allow'
      && (typeof value.subjectId !== 'string' || value.subjectId.length === 0
        || typeof value.deviceId !== 'string' || value.deviceId.length === 0))
    || (value.decision === 'deny'
      && (value.subjectId !== null || value.deviceId !== null))) {
    fail(
      M7_IN_PROCESS_PROVIDER_ERROR.AUTHORITY_INVALID,
      'm7-provider:authority-decision-invalid',
    );
  }
  if (value.decision !== 'allow'
    || requiredScopes.some(scope => !value.grantedScopes.includes(scope))) {
    fail(
      M7_IN_PROCESS_PROVIDER_ERROR.AUTHORITY_DENIED,
      'm7-provider:required-scope-denied',
    );
  }
  return deepFreeze({
    deviceId: value.deviceId,
    subjectId: value.subjectId,
    // The resolver may know more about the subject than this operation needs.
    // Do not expose unrelated authority to a core handler.
    grantedScopes: [...requiredScopes],
  });
}

function buildDescriptors(requirements, manifests) {
  if (!plain(requirements) || !Array.isArray(requirements.capabilities) || !plain(manifests)) {
    fail(M7_IN_PROCESS_PROVIDER_ERROR.CONFIG_INVALID, 'm7-provider:contract-input-invalid');
  }
  const capabilityIds = requirements.capabilities.map(item => item?.capabilityId);
  if (capabilityIds.some(id => typeof id !== 'string' || id.length === 0)
    || new Set(capabilityIds).size !== capabilityIds.length
    || Object.keys(manifests).length !== capabilityIds.length
    || Object.keys(manifests).some(id => !capabilityIds.includes(id))) {
    fail(M7_IN_PROCESS_PROVIDER_ERROR.CONFIG_INVALID, 'm7-provider:capability-set-mismatch');
  }

  const operationIds = new Set();
  const capabilities = requirements.capabilities.map(requirement => {
    const manifest = manifests[requirement.capabilityId];
    const manifestOperations = manifest?.operationManifest?.operations;
    if (!plain(manifest)
      || manifest.capabilityId !== requirement.capabilityId
      || manifest.version !== requirement.targetVersion
      || !Array.isArray(requirement.operations)
      || !Array.isArray(manifestOperations)
      || manifestOperations.length !== requirement.operations.length) {
      fail(M7_IN_PROCESS_PROVIDER_ERROR.CONFIG_INVALID, 'm7-provider:manifest-mismatch');
    }
    const operations = requirement.operations.map((operation, index) => {
      const pinned = manifestOperations[index];
      if (!plain(operation)
        || typeof operation.operationId !== 'string'
        || operationIds.has(operation.operationId)
        || !['command', 'mutation', 'read'].includes(operation.kind)
        || !Array.isArray(operation.requiredScopes)
        || operation.requiredScopes.some(scope => typeof scope !== 'string' || scope.length === 0)
        || new Set(operation.requiredScopes).size !== operation.requiredScopes.length
        || !plain(pinned)
        || pinned.operationId !== operation.operationId
        || pinned.requestContract !== operation.requestContract
        || pinned.resultContract !== operation.resultContract) {
        fail(M7_IN_PROCESS_PROVIDER_ERROR.CONFIG_INVALID, 'm7-provider:operation-mismatch');
      }
      operationIds.add(operation.operationId);
      return deepFreeze({
        capabilityId: requirement.capabilityId,
        capabilityVersion: requirement.targetVersion,
        operationId: operation.operationId,
        requestContract: operation.requestContract,
        resultContract: operation.resultContract,
        kind: operation.kind,
        requiredScopes: [...operation.requiredScopes],
      });
    });
    return deepFreeze({
      capabilityId: requirement.capabilityId,
      version: requirement.targetVersion,
      contractDigest: manifest.contractDigest,
      operationsDigest: manifest.operationsDigest,
      operations,
    });
  });
  return { capabilities: deepFreeze(capabilities), operationIds };
}

function unavailableAdvertisement(capability, reason) {
  return {
    capabilityId: capability.capabilityId,
    status: 'unavailable',
    selectedVersion: null,
    contractDigest: null,
    operationsDigest: null,
    error: {
      code: M7_IN_PROCESS_PROVIDER_ERROR.CAPABILITY_UNAVAILABLE,
      message: reason,
      retryable: false,
    },
  };
}

export function createM7InProcessCapabilityProvider({
  authorityResolver,
  externalValidators = {},
  handlers = {},
  manifests,
  mutationJournal = null,
  requirements,
  validateOperationPair,
  validatePayload,
} = {}) {
  const resolveAuthority = requireFunction(authorityResolver, 'authority-resolver');
  const pairValidator = requireFunction(validateOperationPair, 'operation-pair-validator');
  const payloadValidator = requireFunction(validatePayload, 'payload-validator');
  if (!plain(handlers) || !plain(externalValidators)) fail(
    M7_IN_PROCESS_PROVIDER_ERROR.CONFIG_INVALID,
    'm7-provider:handler-or-validator-map-invalid',
  );
  const descriptors = buildDescriptors(requirements, manifests);
  if (Object.keys(handlers).some(operationId => !descriptors.operationIds.has(operationId))
    || Object.values(handlers).some(handler => typeof handler !== 'function')) {
    fail(M7_IN_PROCESS_PROVIDER_ERROR.CONFIG_INVALID, 'm7-provider:unknown-or-invalid-handler');
  }
  const journalRun = mutationJournal === null ? null : mutationJournal?.run;
  if (journalRun !== null && typeof journalRun !== 'function') fail(
    M7_IN_PROCESS_PROVIDER_ERROR.CONFIG_INVALID,
    'm7-provider:mutation-journal-invalid',
  );
  const operationById = new Map(descriptors.capabilities.flatMap(capability => (
    capability.operations.map(operation => [operation.operationId, operation])
  )));
  const capabilityById = new Map(descriptors.capabilities.map(capability => (
    [capability.capabilityId, capability]
  )));
  const capabilityReady = capability => capability.operations.every(operation => (
    typeof handlers[operation.operationId] === 'function'
      && (operation.kind !== 'mutation' || journalRun !== null)
  ));

  return Object.freeze({
    describe() {
      return deepFreeze({
        contract: 'M7InProcessCapabilityProvider',
        version: 1,
        stage: M7_IN_PROCESS_PROVIDER_STAGE,
        activation: 'not_active',
        listener: 'absent',
        transport: 'absent',
      });
    },

    advertise() {
      return deepFreeze(descriptors.capabilities.map(capability => (
        capabilityReady(capability)
          ? {
            capabilityId: capability.capabilityId,
            status: 'available',
            selectedVersion: capability.version,
            contractDigest: capability.contractDigest,
            operationsDigest: capability.operationsDigest,
            error: null,
          }
          : unavailableAdvertisement(
            capability,
            `Capability ${capability.capabilityId} lacks a complete handler/journal set.`,
          )
      )));
    },

    async invoke(invocationValue, authorityContext = Object.freeze({})) {
      if (!exactKeys(invocationValue, INVOCATION_KEYS)) fail(
        M7_IN_PROCESS_PROVIDER_ERROR.INVALID_INVOCATION,
        'm7-provider:invalid-invocation-envelope',
      );
      const operation = operationById.get(invocationValue.operationId);
      const capability = capabilityById.get(invocationValue.capabilityId);
      if (!operation || operation.capabilityId !== invocationValue.capabilityId) fail(
        M7_IN_PROCESS_PROVIDER_ERROR.OPERATION_UNAVAILABLE,
        'm7-provider:operation-unavailable',
      );
      if (!capabilityReady(capability)) fail(
        M7_IN_PROCESS_PROVIDER_ERROR.CAPABILITY_UNAVAILABLE,
        'm7-provider:capability-incomplete',
      );
      if (invocationValue.capabilityVersion !== operation.capabilityVersion) fail(
        M7_IN_PROCESS_PROVIDER_ERROR.INVALID_INVOCATION,
        'm7-provider:capability-version-mismatch',
      );
      const requestValidation = payloadValidator(
        operation.requestContract,
        invocationValue.request,
        { externalValidators, context: `${operation.operationId}.request` },
      );
      requireValidation(
        requestValidation,
        M7_IN_PROCESS_PROVIDER_ERROR.INVALID_REQUEST,
        'invalid-request',
      );
      const request = cloneFrozen(invocationValue.request, 'request');
      const context = cloneFrozen(authorityContext, 'authority-context');
      const authorityInput = deepFreeze({
        capabilityId: operation.capabilityId,
        operationId: operation.operationId,
        requiredScopes: [...operation.requiredScopes],
        request,
        context,
      });
      const authority = normalizeAuthorityDecision(
        await resolveAuthority(authorityInput),
        operation.requiredScopes,
      );
      const handlerContext = deepFreeze({
        deviceId: authority.deviceId,
        subjectId: authority.subjectId,
        grantedScopes: [...authority.grantedScopes],
        capabilityId: operation.capabilityId,
        operationId: operation.operationId,
      });
      const validateResult = (value) => {
        const validation = pairValidator({
          capabilityId: operation.capabilityId,
          capabilityVersion: operation.capabilityVersion,
          operationId: operation.operationId,
          request,
          result: value,
          externalValidators,
        });
        requireValidation(
          validation,
          M7_IN_PROCESS_PROVIDER_ERROR.INVALID_RESULT,
          'invalid-result',
        );
        return cloneFrozen(value, 'result');
      };
      const execute = async () => validateResult(
        await handlers[operation.operationId](request, handlerContext),
      );
      let result;
      if (operation.kind === 'mutation') {
        let executionStarted = false;
        result = await journalRun.call(mutationJournal, Object.freeze({
          deviceId: authority.deviceId,
          subjectId: authority.subjectId,
          operationId: request.operationId,
          operationType: operation.operationId,
          request,
          execute: async () => {
            if (executionStarted) fail(
              M7_IN_PROCESS_PROVIDER_ERROR.JOURNAL_PROTOCOL,
              'm7-provider:journal-executed-handler-more-than-once',
            );
            executionStarted = true;
            return execute();
          },
        }));
      } else {
        result = await execute();
      }
      // Validate again after the journal boundary: a replay did not execute the
      // handler in this invocation and must earn the same contract proof.
      return validateResult(result);
    },
  });
}

export default createM7InProcessCapabilityProvider;
