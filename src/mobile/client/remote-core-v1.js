// IntentSmith RemoteCorePort@1 — mobile compatibility pin
// =============================================================================
//
// This is a consumer-side pin, not a transport implementation.  M2 froze the
// in-process descriptor and M5 reviewed an adapter that currently exposes two
// capabilities.  M7 still owns the listener, peer authentication, pairing and
// wire framing.  Keeping those facts separate prevents the Android client from
// silently treating the prototype /m1 gateway as the production RemoteCore
// transport.

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ERROR_CODE = /^[A-Z][A-Z0-9_:-]{0,95}$/;

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const REMOTE_CORE_V1_PIN = deepFreeze({
  portVersion: 1,
  descriptorDigest: 'sha256:245abe3a13d7d60ac537c7672522872df20f855d990bee0f02b2826379b56c52',
  m5AdapterManifestDigest: 'sha256:34f3c20c94e1c4316ad76e8c92c1ce8b7dab0868b7685c3d5a637a6f6aa98e52',
  m7AdapterManifestDigest: 'sha256:abe99330702ea02ccdf7b644f4114df1b910a6e83cf3229a294a90e74c0822f4',
  source: {
    descriptor: 'contracts/m2/remote-core-port-v1.js',
    m5ProductRevision: '122b5df5303e08a38cdd62a35e6577b118795c30',
  },
  capabilities: {
    conversations: {
      version: 1,
      contractDigest: 'sha256:6a0d7e9414ec688eb5cdfd2d344615cc03a42b7edbf0761d0a4f4dc6ee209cba',
      operationsDigest: 'sha256:e8b2450c56c28b1910f637e35c453a0481b1804f5f397406b9baf1a7bddfa4dc',
      operations: ['conversation.execute'],
    },
    projects: {
      version: 1,
      contractDigest: 'sha256:c83fdbc176e7878f6804322096fb0e4274cd47110d75dc9f5ad50094f9db0805',
      operationsDigest: 'sha256:262b9af0dee31533c1dc0c1db70a0d3f29bab67151c3bdcd98602fa652c0ee60',
      operations: ['project-context.query'],
    },
  },
});

export const REMOTE_CORE_V1_CAPABILITY_IDS = deepFreeze([
  'approvals',
  'conversations',
  'events',
  'notifications',
  'projects',
  'settings',
  'stored_information',
]);

// Product surfaces, not invented wire operation IDs.  A future M7 contract can
// name its operations without this client pre-empting that public decision.
export const MOBILE_REMOTE_RELEASE_SURFACES = deepFreeze([
  { id: 'approval-list-and-decision', capabilityId: 'approvals' },
  { id: 'conversation-list-history-and-execute', capabilityId: 'conversations' },
  { id: 'typed-run-progress-and-terminal', capabilityId: 'events' },
  { id: 'notification-list-and-ack', capabilityId: 'notifications' },
  { id: 'project-list-and-context', capabilityId: 'projects' },
  { id: 'remote-settings-read-and-write', capabilityId: 'settings' },
  { id: 'stored-information-list-read-and-mutate', capabilityId: 'stored_information' },
]);

export const MOBILE_TRANSPORT_MODE = deepFreeze({
  LEGACY_M1_DEVELOPMENT: 'legacy-m1-dev',
  REMOTE_CORE_V1: 'remote-core-v1',
});

export const DEFAULT_MOBILE_RUNTIME_CONFIG = deepFreeze({
  gatewayUrl: 'http://127.0.0.1:3336',
  transportMode: MOBILE_TRANSPORT_MODE.LEGACY_M1_DEVELOPMENT,
  remoteCore: {
    descriptorDigest: REMOTE_CORE_V1_PIN.descriptorDigest,
    adapterManifestDigest: REMOTE_CORE_V1_PIN.m5AdapterManifestDigest,
  },
});

function plain(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, required, context) {
  if (!plain(value)) return [`${context}:not-object`];
  const allowed = new Set(required);
  const errors = [];
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${context}:missing-${key}`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${context}:unknown-${key}`);
  }
  return errors;
}

function canonicalize(value, seen = new Set(), depth = 0) {
  if (depth > 32) throw new TypeError('remote-core-canonical:too-deep');
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'));
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new TypeError('remote-core-canonical:invalid-number');
    }
    return String(value);
  }
  if (typeof value !== 'object' || seen.has(value)) {
    throw new TypeError('remote-core-canonical:unsupported-value');
  }

  seen.add(value);
  let encoded;
  if (Array.isArray(value)) {
    encoded = `[${value.map(item => canonicalize(item, seen, depth + 1)).join(',')}]`;
  } else if (plain(value)) {
    const fields = Object.keys(value)
      .map(original => ({ original, normalized: original.normalize('NFC') }))
      .sort((left, right) => {
        const a = new TextEncoder().encode(left.normalized);
        const b = new TextEncoder().encode(right.normalized);
        for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
          if (a[index] !== b[index]) return a[index] - b[index];
        }
        return a.length - b.length;
      });
    for (let index = 1; index < fields.length; index += 1) {
      if (fields[index - 1].normalized === fields[index].normalized) {
        seen.delete(value);
        throw new TypeError('remote-core-canonical:normalized-key-collision');
      }
    }
    encoded = `{${fields.map(({ original, normalized }) => (
      `${JSON.stringify(normalized)}:${canonicalize(value[original], seen, depth + 1)}`
    )).join(',')}}`;
  } else {
    seen.delete(value);
    throw new TypeError('remote-core-canonical:unsupported-object');
  }
  seen.delete(value);
  return encoded;
}

export function canonicalizeRemoteCoreValue(value) {
  return canonicalize(value);
}

export async function digestRemoteCoreValue(value, cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.subtle) throw new TypeError('remote-core-digest:crypto-unavailable');
  const bytes = new TextEncoder().encode(canonicalizeRemoteCoreValue(value));
  const digest = new Uint8Array(await cryptoApi.subtle.digest('SHA-256', bytes));
  return `sha256:${[...digest].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function canonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

export function createRemoteCoreHello({ requestId, clientId, clientBuild, sentAt }) {
  if (!IDENTIFIER.test(requestId || '')) throw new TypeError('remote-core-hello:invalid-requestId');
  if (!IDENTIFIER.test(clientId || '')) throw new TypeError('remote-core-hello:invalid-clientId');
  if (typeof clientBuild !== 'string' || !clientBuild.trim() || clientBuild.length > 256) {
    throw new TypeError('remote-core-hello:invalid-clientBuild');
  }
  if (!canonicalTimestamp(sentAt)) throw new TypeError('remote-core-hello:invalid-sentAt');
  return deepFreeze({
    contract: 'RemoteCoreHello',
    version: 1,
    requestId,
    clientId,
    clientBuild: clientBuild.normalize('NFC'),
    supportedPortVersions: [1],
    capabilities: REMOTE_CORE_V1_CAPABILITY_IDS.map(capabilityId => ({
      capabilityId,
      versions: [1],
    })),
    sentAt,
  });
}

function validateError(value, context) {
  const errors = exactKeys(value, ['code', 'message', 'retryable'], context);
  if (!plain(value)) return errors;
  if (!ERROR_CODE.test(value.code || '')) errors.push(`${context}:invalid-code`);
  if (typeof value.message !== 'string' || !value.message.trim()) errors.push(`${context}:invalid-message`);
  if (typeof value.retryable !== 'boolean') errors.push(`${context}:invalid-retryable`);
  return errors;
}

export async function validateRemoteCoreNegotiation(hello, value, cryptoApi = globalThis.crypto) {
  const context = 'remote-core-negotiation';
  const errors = exactKeys(value, [
    'contract', 'version', 'requestId', 'helloDigest', 'descriptorDigest',
    'negotiatedAt', 'status', 'selectedPortVersion', 'capabilities', 'error',
  ], context);
  if (!plain(value)) return { valid: false, errors };
  if (value.contract !== 'RemoteCoreNegotiation') errors.push(`${context}:invalid-contract`);
  if (value.version !== 1) errors.push(`${context}:invalid-version`);
  if (value.requestId !== hello?.requestId) errors.push(`${context}:requestId-mismatch`);
  if (value.helloDigest !== await digestRemoteCoreValue(hello, cryptoApi)) {
    errors.push(`${context}:helloDigest-mismatch`);
  }
  if (value.descriptorDigest !== REMOTE_CORE_V1_PIN.descriptorDigest) {
    errors.push(`${context}:descriptorDigest-mismatch`);
  }
  if (!canonicalTimestamp(value.negotiatedAt)) errors.push(`${context}:invalid-negotiatedAt`);
  if (canonicalTimestamp(value.negotiatedAt) && Date.parse(value.negotiatedAt) < Date.parse(hello.sentAt)) {
    errors.push(`${context}:negotiated-before-hello`);
  }
  if (!['negotiated', 'unavailable', 'incompatible'].includes(value.status)) {
    errors.push(`${context}:invalid-status`);
  }

  if (value.status === 'incompatible') {
    if (value.selectedPortVersion !== null) errors.push(`${context}:selectedPortVersion-must-be-null`);
    if (!Array.isArray(value.capabilities) || value.capabilities.length !== 0) {
      errors.push(`${context}:incompatible-capabilities-must-be-empty`);
    }
    errors.push(...validateError(value.error, `${context}.error`));
    if (plain(value.error) && value.error.code !== 'REMOTE_CORE_PORT_VERSION_INCOMPATIBLE') {
      errors.push(`${context}:port-incompatible-error-code-mismatch`);
    }
    return { valid: errors.length === 0, errors };
  }

  if (value.selectedPortVersion !== 1) errors.push(`${context}:invalid-selectedPortVersion`);
  if (!Array.isArray(value.capabilities) || value.capabilities.length !== hello.capabilities.length) {
    errors.push(`${context}:capability-result-set-mismatch`);
  } else {
    value.capabilities.forEach((capability, index) => {
      const itemContext = `${context}.capabilities[${index}]`;
      errors.push(...exactKeys(capability, [
        'capabilityId', 'status', 'selectedVersion', 'contractDigest', 'operationsDigest', 'error',
      ], itemContext));
      const expected = hello.capabilities[index];
      if (capability?.capabilityId !== expected?.capabilityId) errors.push(`${itemContext}:capabilityId-mismatch`);
      if (!['available', 'unavailable', 'incompatible'].includes(capability?.status)) {
        errors.push(`${itemContext}:invalid-status`);
      } else if (capability.status === 'available') {
        const pin = REMOTE_CORE_V1_PIN.capabilities[capability.capabilityId];
        if (!pin) errors.push(`${itemContext}:capability-not-client-pinned`);
        if (capability.selectedVersion !== 1) errors.push(`${itemContext}:invalid-selectedVersion`);
        if (!SHA256.test(capability.contractDigest || '')) errors.push(`${itemContext}:invalid-contractDigest`);
        if (!SHA256.test(capability.operationsDigest || '')) errors.push(`${itemContext}:invalid-operationsDigest`);
        if (pin && capability.contractDigest !== pin.contractDigest) errors.push(`${itemContext}:contractDigest-mismatch`);
        if (pin && capability.operationsDigest !== pin.operationsDigest) errors.push(`${itemContext}:operationsDigest-mismatch`);
        if (capability.error !== null) errors.push(`${itemContext}:unexpected-error`);
      } else {
        for (const key of ['selectedVersion', 'contractDigest', 'operationsDigest']) {
          if (capability[key] !== null) errors.push(`${itemContext}:${key}-must-be-null`);
        }
        errors.push(...validateError(capability.error, `${itemContext}.error`));
        if (plain(capability.error)
            && capability.status === 'unavailable'
            && ![
              'REMOTE_CORE_PROVIDER_UNAVAILABLE',
              'REMOTE_CORE_CAPABILITY_UNAVAILABLE',
            ].includes(capability.error.code)) {
          errors.push(`${itemContext}:unavailable-error-code-mismatch`);
        }
        if (plain(capability.error)
            && capability.status === 'incompatible'
            && capability.error.code !== 'REMOTE_CORE_CAPABILITY_VERSION_INCOMPATIBLE') {
          errors.push(`${itemContext}:incompatible-error-code-mismatch`);
        }
      }
    });
  }

  const available = Array.isArray(value.capabilities)
    ? value.capabilities.filter(capability => capability?.status === 'available').length
    : 0;
  if (value.status === 'negotiated') {
    if (available < 1) errors.push(`${context}:negotiated-without-available-capability`);
    if (value.error !== null) errors.push(`${context}:unexpected-error`);
  } else if (value.status === 'unavailable') {
    if (available !== 0) errors.push(`${context}:unavailable-with-available-capability`);
    errors.push(...validateError(value.error, `${context}.error`));
    if (plain(value.error) && value.error.code !== 'REMOTE_CORE_NO_CAPABILITY_AVAILABLE') {
      errors.push(`${context}:unavailable-error-code-mismatch`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export async function assessMobileRemoteReadiness(hello, negotiation, cryptoApi = globalThis.crypto) {
  if (!negotiation) {
    return deepFreeze({
      ready: false,
      code: 'REMOTE_TRANSPORT_NOT_NEGOTIATED',
      availableCapabilities: [],
      missingCapabilities: [...REMOTE_CORE_V1_CAPABILITY_IDS],
      missingSurfaces: MOBILE_REMOTE_RELEASE_SURFACES.map(surface => surface.id),
    });
  }
  const validation = await validateRemoteCoreNegotiation(hello, negotiation, cryptoApi);
  if (!validation.valid) {
    return deepFreeze({
      ready: false,
      code: 'REMOTE_NEGOTIATION_INVALID',
      errors: [...validation.errors],
      availableCapabilities: [],
      missingCapabilities: [...REMOTE_CORE_V1_CAPABILITY_IDS],
      missingSurfaces: MOBILE_REMOTE_RELEASE_SURFACES.map(surface => surface.id),
    });
  }
  const availableCapabilities = negotiation.capabilities
    .filter(capability => capability.status === 'available')
    .map(capability => capability.capabilityId);
  const available = new Set(availableCapabilities);
  const missingCapabilities = REMOTE_CORE_V1_CAPABILITY_IDS.filter(id => !available.has(id));
  // M5's two operations execute a turn and query already-selected project
  // context.  They do not cover the mobile list/history surfaces yet.
  const missingSurfaces = MOBILE_REMOTE_RELEASE_SURFACES
    .filter(surface => !available.has(surface.capabilityId)
      || ['conversations', 'projects'].includes(surface.capabilityId))
    .map(surface => surface.id);
  return deepFreeze({
    ready: missingCapabilities.length === 0 && missingSurfaces.length === 0,
    code: missingCapabilities.length || missingSurfaces.length
      ? 'REMOTE_CAPABILITY_SET_INCOMPLETE'
      : 'REMOTE_READY',
    availableCapabilities,
    missingCapabilities,
    missingSurfaces,
  });
}

export function validateMobileRuntimeConfig(runtime) {
  const value = runtime || DEFAULT_MOBILE_RUNTIME_CONFIG;
  if (!plain(value)) throw new TypeError('invalid_mobile_runtime_config');
  const configErrors = exactKeys(value, ['gatewayUrl', 'transportMode', 'remoteCore'], 'mobile-runtime');
  if (configErrors.length) throw new TypeError('invalid_mobile_runtime_config');
  const mode = value.transportMode;
  if (!Object.values(MOBILE_TRANSPORT_MODE).includes(mode)) {
    throw new TypeError('invalid_mobile_transport_mode');
  }
  const remote = value.remoteCore;
  const legacy = mode === MOBILE_TRANSPORT_MODE.LEGACY_M1_DEVELOPMENT;
  const remoteKeys = legacy
    ? ['descriptorDigest', 'adapterManifestDigest']
    : ['descriptorDigest', 'adapterManifestDigest', 'serverIdentityPin', 'serverOrigin'];
  if (!plain(remote)
      || exactKeys(remote, remoteKeys, 'mobile-runtime.remoteCore').length
      || remote.descriptorDigest !== REMOTE_CORE_V1_PIN.descriptorDigest
      || remote.adapterManifestDigest !== (legacy
        ? REMOTE_CORE_V1_PIN.m5AdapterManifestDigest
        : REMOTE_CORE_V1_PIN.m7AdapterManifestDigest)) {
    throw new TypeError('invalid_mobile_remote_core_pin');
  }
  if (!legacy) {
    let gateway;
    let server;
    try {
      gateway = new URL(value.gatewayUrl);
      server = new URL(remote.serverOrigin);
    } catch {
      throw new TypeError('invalid_mobile_remote_core_origin');
    }
    const exactOrigin = candidate => candidate.protocol === 'https:'
      && candidate.port === '7443'
      && !candidate.username && !candidate.password
      && candidate.pathname === '/' && !candidate.search && !candidate.hash
      && candidate.origin === candidate.href.replace(/\/$/u, '');
    if (!exactOrigin(gateway) || !exactOrigin(server)
      || gateway.origin !== server.origin
      || remote.serverOrigin !== server.origin
      || value.gatewayUrl !== gateway.origin
      || !SHA256.test(remote.serverIdentityPin || '')) {
      throw new TypeError('invalid_mobile_remote_core_origin');
    }
  }
  return deepFreeze({ gatewayUrl: value.gatewayUrl, mode, remoteCore: { ...remote } });
}
