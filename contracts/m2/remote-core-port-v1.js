import {
  canonicalizeM2ExecutionValue,
  computeM2ExecutionValueDigest,
} from './execution-v1.js';
import {
  isIdentifier,
  isPlainRecord,
  validateExactKeys,
  validationResult,
} from '../m1/shared.js';

export const M2_REMOTE_CORE_PORT_VERSION = 1;
export const M2_REMOTE_CORE_PORT_STAGE = 'CANDIDATE_V1';

export const M2_REMOTE_CORE_PORT_KIND = Object.freeze({
  DESCRIPTOR: 'RemoteCorePortDescriptor',
  HELLO: 'RemoteCoreHello',
  NEGOTIATION: 'RemoteCoreNegotiation',
});

export const M2_REMOTE_CORE_NEGOTIATION_STATUS = Object.freeze({
  NEGOTIATED: 'negotiated',
  UNAVAILABLE: 'unavailable',
  INCOMPATIBLE: 'incompatible',
});

export const M2_REMOTE_CORE_CAPABILITY_STATUS = Object.freeze({
  AVAILABLE: 'available',
  UNAVAILABLE: 'unavailable',
  INCOMPATIBLE: 'incompatible',
});

export const M2_REMOTE_CORE_ERROR_CODE = Object.freeze({
  PORT_VERSION_INCOMPATIBLE: 'REMOTE_CORE_PORT_VERSION_INCOMPATIBLE',
  NO_CAPABILITY_AVAILABLE: 'REMOTE_CORE_NO_CAPABILITY_AVAILABLE',
  PROVIDER_UNAVAILABLE: 'REMOTE_CORE_PROVIDER_UNAVAILABLE',
  CAPABILITY_UNAVAILABLE: 'REMOTE_CORE_CAPABILITY_UNAVAILABLE',
  CAPABILITY_VERSION_INCOMPATIBLE: 'REMOTE_CORE_CAPABILITY_VERSION_INCOMPATIBLE',
});

export const M2_REMOTE_CORE_CAPABILITY_IDS = Object.freeze([
  'approvals',
  'conversations',
  'events',
  'notifications',
  'projects',
  'settings',
  'stored_information',
]);

const CAPABILITY_ID_SET = new Set(M2_REMOTE_CORE_CAPABILITY_IDS);
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_:-]{0,95}$/;

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function isNfcString(value, maximum = 1_024) {
  return typeof value === 'string'
    && value === value.normalize('NFC')
    && !value.includes('\0')
    && value.trim().length > 0
    && Buffer.byteLength(value, 'utf8') <= maximum;
}

function isDigest(value) {
  return typeof value === 'string' && DIGEST_PATTERN.test(value);
}

function isCanonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function validateSortedUniqueIntegers(value, context) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    return [`${context}:invalid-array`];
  }
  const errors = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (!Number.isSafeInteger(entry) || entry < 1 || entry > 65_535) {
      errors.push(`${context}[${index}]:invalid`);
    }
    if (index > 0 && value[index - 1] >= entry) {
      errors.push(`${context}:not-sorted-unique`);
      break;
    }
  }
  return errors;
}

function validateSortedUniqueStrings(value, context, validator = isNfcString) {
  if (!Array.isArray(value)) return [`${context}:not-array`];
  const errors = [];
  value.forEach((entry, index) => {
    if (!validator(entry)) errors.push(`${context}[${index}]:invalid`);
  });
  for (let index = 1; index < value.length; index += 1) {
    if (
      typeof value[index - 1] === 'string'
      && typeof value[index] === 'string'
      && compareUtf8(value[index - 1], value[index]) >= 0
    ) {
      errors.push(`${context}:not-bytewise-sorted-unique`);
      break;
    }
  }
  return errors;
}

function validateError(value, context) {
  const errors = validateExactKeys(value, ['code', 'message', 'retryable'], [], context);
  if (!isPlainRecord(value)) return errors;
  if (typeof value.code !== 'string' || !ERROR_CODE_PATTERN.test(value.code)) {
    errors.push(`${context}:invalid-code`);
  }
  if (!isNfcString(value.message, 1_024)) errors.push(`${context}:invalid-message`);
  if (typeof value.retryable !== 'boolean') errors.push(`${context}:invalid-retryable`);
  return errors;
}

const CAPABILITY_CATALOG = [
  {
    capabilityId: 'approvals',
    minimumAuthorityContracts: [
      'ApprovalGrant@1',
      'EffectRequest@1',
      'EffectResult@1',
      'LifecycleApprovalIntent@1',
      'LifecyclePlanSnapshot@1',
      'LifecycleTerminalSnapshot@1',
    ],
  },
  {
    capabilityId: 'conversations',
    minimumAuthorityContracts: ['ConversationCommand@1', 'ConversationResult@1'],
  },
  {
    capabilityId: 'events',
    minimumAuthorityContracts: ['CoreEvent@1'],
  },
  {
    capabilityId: 'notifications',
    minimumAuthorityContracts: ['CoreEvent@1'],
  },
  {
    capabilityId: 'projects',
    minimumAuthorityContracts: ['ProjectContextQuery@1', 'ProjectContextSnapshot@1'],
  },
  {
    capabilityId: 'settings',
    minimumAuthorityContracts: ['ApprovalGrant@1', 'EffectRequest@1', 'EffectResult@1'],
  },
  {
    capabilityId: 'stored_information',
    minimumAuthorityContracts: ['ApprovalGrant@1', 'EffectRequest@1', 'EffectResult@1'],
  },
];

export const M2_REMOTE_CORE_PORT_DESCRIPTOR_V1 = deepFreeze({
  contract: M2_REMOTE_CORE_PORT_KIND.DESCRIPTOR,
  version: M2_REMOTE_CORE_PORT_VERSION,
  stage: M2_REMOTE_CORE_PORT_STAGE,
  portVersions: [M2_REMOTE_CORE_PORT_VERSION],
  capabilities: CAPABILITY_CATALOG,
  compatibility: {
    capabilityVersioning: 'independent',
    implicitDowngrade: 'reject',
    unavailableIsSuccess: false,
    unknownCapabilities: 'reject',
    unknownFields: 'reject',
  },
  securityBoundary: {
    authentication: 'not_implemented',
    legacyListener: 'forbidden',
    listener: 'not_implemented',
    negotiationAuthority: 'none',
    pairing: 'not_implemented',
    transport: 'not_defined',
  },
});

export const M2_REMOTE_CORE_PORT_DESCRIPTOR_DIGEST_V1 =
  computeM2ExecutionValueDigest(M2_REMOTE_CORE_PORT_DESCRIPTOR_V1);

function validateDescriptorCapability(value, index) {
  const context = `remote-core-port-descriptor.capabilities[${index}]`;
  const errors = validateExactKeys(
    value,
    ['capabilityId', 'minimumAuthorityContracts'],
    [],
    context,
  );
  if (!isPlainRecord(value)) return errors;
  if (!CAPABILITY_ID_SET.has(value.capabilityId)) errors.push(`${context}:invalid-capabilityId`);
  errors.push(...validateSortedUniqueStrings(
    value.minimumAuthorityContracts,
    `${context}.minimumAuthorityContracts`,
    entry => typeof entry === 'string' && /^[A-Za-z][A-Za-z0-9]+@[1-9][0-9]*$/.test(entry),
  ));
  return errors;
}

export function validateM2RemoteCorePortDescriptor(value) {
  const context = 'remote-core-port-descriptor';
  const errors = validateExactKeys(value, [
    'contract', 'version', 'stage', 'portVersions', 'capabilities',
    'compatibility', 'securityBoundary',
  ], [], context);
  if (!isPlainRecord(value)) return validationResult(errors, value);
  if (value.contract !== M2_REMOTE_CORE_PORT_KIND.DESCRIPTOR) {
    errors.push(`${context}:invalid-contract`);
  }
  if (value.version !== M2_REMOTE_CORE_PORT_VERSION) errors.push(`${context}:invalid-version`);
  if (value.stage !== M2_REMOTE_CORE_PORT_STAGE) errors.push(`${context}:invalid-stage`);
  errors.push(...validateSortedUniqueIntegers(value.portVersions, `${context}.portVersions`));
  if (
    !Array.isArray(value.capabilities)
    || value.capabilities.length !== M2_REMOTE_CORE_CAPABILITY_IDS.length
  ) {
    errors.push(`${context}:invalid-capabilities`);
  } else {
    value.capabilities.forEach((capability, index) => {
      errors.push(...validateDescriptorCapability(capability, index));
      if (capability?.capabilityId !== M2_REMOTE_CORE_CAPABILITY_IDS[index]) {
        errors.push(`${context}.capabilities[${index}]:catalog-order-mismatch`);
      }
    });
  }
  errors.push(...validateExactKeys(value.compatibility, [
    'capabilityVersioning', 'implicitDowngrade', 'unavailableIsSuccess',
    'unknownCapabilities', 'unknownFields',
  ], [], `${context}.compatibility`));
  if (isPlainRecord(value.compatibility)) {
    if (value.compatibility.capabilityVersioning !== 'independent') {
      errors.push(`${context}.compatibility:invalid-capabilityVersioning`);
    }
    if (value.compatibility.implicitDowngrade !== 'reject') {
      errors.push(`${context}.compatibility:invalid-implicitDowngrade`);
    }
    if (value.compatibility.unavailableIsSuccess !== false) {
      errors.push(`${context}.compatibility:unavailable-must-not-succeed`);
    }
    for (const key of ['unknownCapabilities', 'unknownFields']) {
      if (value.compatibility[key] !== 'reject') {
        errors.push(`${context}.compatibility:invalid-${key}`);
      }
    }
  }
  errors.push(...validateExactKeys(value.securityBoundary, [
    'authentication', 'legacyListener', 'listener', 'negotiationAuthority',
    'pairing', 'transport',
  ], [], `${context}.securityBoundary`));
  if (isPlainRecord(value.securityBoundary)) {
    const expected = M2_REMOTE_CORE_PORT_DESCRIPTOR_V1.securityBoundary;
    for (const key of Object.keys(expected)) {
      if (value.securityBoundary[key] !== expected[key]) {
        errors.push(`${context}.securityBoundary:invalid-${key}`);
      }
    }
  }
  if (errors.length === 0) {
    try {
      if (computeM2ExecutionValueDigest(value) !== M2_REMOTE_CORE_PORT_DESCRIPTOR_DIGEST_V1) {
        errors.push(`${context}:descriptor-digest-mismatch`);
      }
    } catch {
      errors.push(`${context}:noncanonical`);
    }
  }
  return validationResult(errors, value);
}

function validateHelloCapability(value, index) {
  const context = `remote-core-hello.capabilities[${index}]`;
  const errors = validateExactKeys(value, ['capabilityId', 'versions'], [], context);
  if (!isPlainRecord(value)) return errors;
  if (!CAPABILITY_ID_SET.has(value.capabilityId)) errors.push(`${context}:invalid-capabilityId`);
  errors.push(...validateSortedUniqueIntegers(value.versions, `${context}.versions`));
  return errors;
}

export function validateM2RemoteCoreHello(value) {
  const context = 'remote-core-hello';
  const errors = validateExactKeys(value, [
    'contract', 'version', 'requestId', 'clientId', 'clientBuild',
    'supportedPortVersions', 'capabilities', 'sentAt',
  ], [], context);
  if (!isPlainRecord(value)) return validationResult(errors, value);
  if (value.contract !== M2_REMOTE_CORE_PORT_KIND.HELLO) errors.push(`${context}:invalid-contract`);
  if (value.version !== M2_REMOTE_CORE_PORT_VERSION) errors.push(`${context}:invalid-version`);
  for (const key of ['requestId', 'clientId']) {
    if (!isIdentifier(value[key])) errors.push(`${context}:invalid-${key}`);
  }
  if (!isNfcString(value.clientBuild, 256)) errors.push(`${context}:invalid-clientBuild`);
  errors.push(...validateSortedUniqueIntegers(
    value.supportedPortVersions,
    `${context}.supportedPortVersions`,
  ));
  if (!Array.isArray(value.capabilities) || value.capabilities.length < 1) {
    errors.push(`${context}:invalid-capabilities`);
  } else if (value.capabilities.length > M2_REMOTE_CORE_CAPABILITY_IDS.length) {
    errors.push(`${context}:too-many-capabilities`);
  } else {
    value.capabilities.forEach((capability, index) => {
      errors.push(...validateHelloCapability(capability, index));
      if (
        index > 0
        && typeof value.capabilities[index - 1]?.capabilityId === 'string'
        && typeof capability?.capabilityId === 'string'
        && compareUtf8(value.capabilities[index - 1].capabilityId, capability.capabilityId) >= 0
      ) errors.push(`${context}.capabilities:not-bytewise-sorted-unique`);
    });
  }
  if (!isCanonicalTimestamp(value.sentAt)) errors.push(`${context}:invalid-sentAt`);
  return validationResult(errors, value);
}

export function computeM2RemoteCoreHelloDigest(value) {
  const validation = validateM2RemoteCoreHello(value);
  if (!validation.valid) throw new TypeError(validation.errors.join(','));
  return computeM2ExecutionValueDigest(value);
}

function validateNegotiatedCapability(value, helloCapability, index) {
  const context = `remote-core-negotiation.capabilities[${index}]`;
  const errors = validateExactKeys(value, [
    'capabilityId', 'status', 'selectedVersion', 'contractDigest',
    'operationsDigest', 'error',
  ], [], context);
  if (!isPlainRecord(value)) return errors;
  if (value.capabilityId !== helloCapability?.capabilityId) {
    errors.push(`${context}:capabilityId-mismatch`);
  }
  const statuses = Object.values(M2_REMOTE_CORE_CAPABILITY_STATUS);
  if (!statuses.includes(value.status)) errors.push(`${context}:invalid-status`);
  if (value.status === M2_REMOTE_CORE_CAPABILITY_STATUS.AVAILABLE) {
    if (
      !Number.isSafeInteger(value.selectedVersion)
      || !helloCapability?.versions?.includes(value.selectedVersion)
    ) errors.push(`${context}:unoffered-selectedVersion`);
    if (!isDigest(value.contractDigest)) errors.push(`${context}:invalid-contractDigest`);
    if (!isDigest(value.operationsDigest)) errors.push(`${context}:invalid-operationsDigest`);
    if (value.error !== null) errors.push(`${context}:unexpected-error`);
  } else if (statuses.includes(value.status)) {
    if (value.selectedVersion !== null) errors.push(`${context}:selectedVersion-must-be-null`);
    if (value.contractDigest !== null) errors.push(`${context}:contractDigest-must-be-null`);
    if (value.operationsDigest !== null) errors.push(`${context}:operationsDigest-must-be-null`);
    errors.push(...validateError(value.error, `${context}.error`));
    if (isPlainRecord(value.error)) {
      if (
        value.status === M2_REMOTE_CORE_CAPABILITY_STATUS.UNAVAILABLE
        && ![
          M2_REMOTE_CORE_ERROR_CODE.PROVIDER_UNAVAILABLE,
          M2_REMOTE_CORE_ERROR_CODE.CAPABILITY_UNAVAILABLE,
        ].includes(value.error.code)
      ) errors.push(`${context}:unavailable-error-code-mismatch`);
      if (
        value.status === M2_REMOTE_CORE_CAPABILITY_STATUS.INCOMPATIBLE
        && value.error.code !== M2_REMOTE_CORE_ERROR_CODE.CAPABILITY_VERSION_INCOMPATIBLE
      ) errors.push(`${context}:incompatible-error-code-mismatch`);
    }
  }
  return errors;
}

export function validateM2RemoteCoreNegotiationForHello(helloValue, value) {
  const hello = validateM2RemoteCoreHello(helloValue);
  const context = 'remote-core-negotiation';
  const errors = [...hello.errors];
  errors.push(...validateExactKeys(value, [
    'contract', 'version', 'requestId', 'helloDigest', 'descriptorDigest',
    'status', 'selectedPortVersion', 'capabilities', 'error', 'negotiatedAt',
  ], [], context));
  if (!isPlainRecord(value)) return validationResult(errors, value);
  if (value.contract !== M2_REMOTE_CORE_PORT_KIND.NEGOTIATION) {
    errors.push(`${context}:invalid-contract`);
  }
  if (value.version !== M2_REMOTE_CORE_PORT_VERSION) errors.push(`${context}:invalid-version`);
  if (value.requestId !== helloValue?.requestId) errors.push(`${context}:requestId-mismatch`);
  if (hello.valid && value.helloDigest !== computeM2RemoteCoreHelloDigest(helloValue)) {
    errors.push(`${context}:helloDigest-mismatch`);
  }
  if (value.descriptorDigest !== M2_REMOTE_CORE_PORT_DESCRIPTOR_DIGEST_V1) {
    errors.push(`${context}:descriptorDigest-mismatch`);
  }
  const statuses = Object.values(M2_REMOTE_CORE_NEGOTIATION_STATUS);
  if (!statuses.includes(value.status)) errors.push(`${context}:invalid-status`);
  if (!isCanonicalTimestamp(value.negotiatedAt)) errors.push(`${context}:invalid-negotiatedAt`);
  if (
    hello.valid
    && isCanonicalTimestamp(value.negotiatedAt)
    && Date.parse(value.negotiatedAt) < Date.parse(helloValue.sentAt)
  ) errors.push(`${context}:negotiated-before-hello`);

  if (value.status === M2_REMOTE_CORE_NEGOTIATION_STATUS.INCOMPATIBLE) {
    if (value.selectedPortVersion !== null) errors.push(`${context}:selectedPortVersion-must-be-null`);
    if (!Array.isArray(value.capabilities) || value.capabilities.length !== 0) {
      errors.push(`${context}:incompatible-capabilities-must-be-empty`);
    }
    errors.push(...validateError(value.error, `${context}.error`));
    if (
      isPlainRecord(value.error)
      && value.error.code !== M2_REMOTE_CORE_ERROR_CODE.PORT_VERSION_INCOMPATIBLE
    ) errors.push(`${context}:port-incompatible-error-code-mismatch`);
    if (
      hello.valid
      && helloValue.supportedPortVersions.includes(M2_REMOTE_CORE_PORT_VERSION)
    ) errors.push(`${context}:incompatible-despite-shared-port-version`);
  } else if (statuses.includes(value.status)) {
    if (
      value.selectedPortVersion !== M2_REMOTE_CORE_PORT_VERSION
      || !helloValue?.supportedPortVersions?.includes(value.selectedPortVersion)
    ) errors.push(`${context}:invalid-selectedPortVersion`);
    if (
      !Array.isArray(value.capabilities)
      || value.capabilities.length !== helloValue?.capabilities?.length
    ) {
      errors.push(`${context}:capability-result-set-mismatch`);
    } else {
      value.capabilities.forEach((capability, index) => {
        errors.push(...validateNegotiatedCapability(
          capability,
          helloValue.capabilities[index],
          index,
        ));
      });
    }
    const availableCount = Array.isArray(value.capabilities)
      ? value.capabilities.filter(capability => (
        capability?.status === M2_REMOTE_CORE_CAPABILITY_STATUS.AVAILABLE
      )).length
      : 0;
    if (value.status === M2_REMOTE_CORE_NEGOTIATION_STATUS.NEGOTIATED) {
      if (availableCount < 1) errors.push(`${context}:negotiated-without-available-capability`);
      if (value.error !== null) errors.push(`${context}:unexpected-error`);
    }
    if (value.status === M2_REMOTE_CORE_NEGOTIATION_STATUS.UNAVAILABLE) {
      if (availableCount !== 0) errors.push(`${context}:unavailable-with-available-capability`);
      errors.push(...validateError(value.error, `${context}.error`));
      if (
        isPlainRecord(value.error)
        && value.error.code !== M2_REMOTE_CORE_ERROR_CODE.NO_CAPABILITY_AVAILABLE
      ) errors.push(`${context}:unavailable-error-code-mismatch`);
    }
  }
  return validationResult(errors, value);
}

export function canonicalizeM2RemoteCoreValue(value) {
  return canonicalizeM2ExecutionValue(value);
}

export function computeM2RemoteCoreValueDigest(value) {
  return computeM2ExecutionValueDigest(value);
}

export function selectM2RemoteCorePortVersion(supportedPortVersions) {
  const validationErrors = validateSortedUniqueIntegers(
    supportedPortVersions,
    'remote-core-port-selection.supportedPortVersions',
  );
  if (validationErrors.length > 0) throw new TypeError(validationErrors.join(','));
  return supportedPortVersions.includes(M2_REMOTE_CORE_PORT_VERSION)
    ? M2_REMOTE_CORE_PORT_VERSION
    : null;
}

export function createM2RemoteCoreUnavailableNegotiation(helloValue, negotiatedAt) {
  const hello = validateM2RemoteCoreHello(helloValue);
  if (!hello.valid) throw new TypeError(hello.errors.join(','));
  if (!isCanonicalTimestamp(negotiatedAt)) {
    throw new TypeError('remote-core-negotiation:invalid-negotiatedAt');
  }
  if (Date.parse(negotiatedAt) < Date.parse(helloValue.sentAt)) {
    throw new TypeError('remote-core-negotiation:negotiated-before-hello');
  }
  const selectedPortVersion = selectM2RemoteCorePortVersion(helloValue.supportedPortVersions);
  const common = {
    contract: M2_REMOTE_CORE_PORT_KIND.NEGOTIATION,
    version: M2_REMOTE_CORE_PORT_VERSION,
    requestId: helloValue.requestId,
    helloDigest: computeM2RemoteCoreHelloDigest(helloValue),
    descriptorDigest: M2_REMOTE_CORE_PORT_DESCRIPTOR_DIGEST_V1,
    negotiatedAt,
  };
  if (selectedPortVersion === null) {
    return deepFreeze({
      ...common,
      status: M2_REMOTE_CORE_NEGOTIATION_STATUS.INCOMPATIBLE,
      selectedPortVersion: null,
      capabilities: [],
      error: {
        code: M2_REMOTE_CORE_ERROR_CODE.PORT_VERSION_INCOMPATIBLE,
        message: 'No explicitly supported RemoteCorePort version is shared.',
        retryable: false,
      },
    });
  }
  return deepFreeze({
    ...common,
    status: M2_REMOTE_CORE_NEGOTIATION_STATUS.UNAVAILABLE,
    selectedPortVersion,
    capabilities: helloValue.capabilities.map(capability => ({
      capabilityId: capability.capabilityId,
      status: M2_REMOTE_CORE_CAPABILITY_STATUS.UNAVAILABLE,
      selectedVersion: null,
      contractDigest: null,
      operationsDigest: null,
      error: {
        code: M2_REMOTE_CORE_ERROR_CODE.PROVIDER_UNAVAILABLE,
        message: `Remote core provider is unavailable for ${capability.capabilityId}.`,
        retryable: false,
      },
    })),
    error: {
      code: M2_REMOTE_CORE_ERROR_CODE.NO_CAPABILITY_AVAILABLE,
      message: 'No requested remote core capability is currently available.',
      retryable: false,
    },
  });
}
