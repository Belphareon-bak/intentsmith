import { createHmac } from 'node:crypto';

import {
  MOBILE_REMOTE_CANDIDATE_ADAPTER_MANIFEST_DIGEST_V1,
} from '../../docs/mobile/contracts/remote-capability-manifests-v1.js';
import {
  MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1,
} from '../../docs/mobile/contracts/remote-capability-requirements-v1.js';
import { createM7DisconnectedRequestPipeline } from './m7-disconnected-request-pipeline.js';
import { createM7DurableRateLimiter } from './m7-durable-rate-limiter.js';
import { createM7MutationMediator } from './m7-mutation-mediator.js';
import { createM7RunEventCoreAdapter } from './m7-run-event-core-adapter.js';
import { createM7SessionAuthority } from './m7-session-authority.js';
import { createM7TransportAdmissionPolicy } from './m7-transport-admission-policy.js';
import {
  isGenuineM7VpnRuntimeConfiguration,
  withM7ServiceCredentialMaterial,
} from './m7-vpn-runtime-config.js';
import { createM7VpnTlsListener } from './m7-vpn-tls-listener.js';

export const M7_VPN_PRODUCTION_RUNTIME_STAGE = 'IMPLEMENTED_NOT_ACTIVE';

const REQUIRED_CAPABILITIES = Object.freeze(
  MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1.capabilities
    .map(capability => capability.capabilityId)
    .sort(),
);
const runtimeCompositions = new WeakSet();
const runtimeCompositionState = new WeakMap();
const productionRuntimes = new WeakSet();

function plain(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireFunction(value, label) {
  if (typeof value !== 'function') {
    throw new TypeError(`m7-vpn-production:${label}-required`);
  }
  return value;
}

function requireDatabase(value) {
  const database = value?.db ?? value;
  if (!database || typeof database.prepare !== 'function' || typeof database.transaction !== 'function') {
    throw new TypeError('m7-vpn-production:sqlite-database-required');
  }
  return database;
}

function requirePeerKey(value) {
  const key = Buffer.isBuffer(value) || value instanceof Uint8Array
    ? Buffer.from(value)
    : null;
  if (key === null || key.length !== 32) {
    throw new TypeError('m7-vpn-production:peer-key-invalid');
  }
  return key;
}

function cursorKey(peerKey) {
  return createHmac('sha256', peerKey)
    .update('IntentSmith/M7/CoreCursor/v1\0', 'utf8')
    .digest();
}

function resolveInvocationScopes(identity) {
  if (!plain(identity)) throw new TypeError('m7-vpn-production:operation-identity-invalid');
  const capability = MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1.capabilities.find(item => (
    item.capabilityId === identity.capabilityId
    && item.targetVersion === identity.capabilityVersion
  ));
  const operation = capability?.operations.find(item => item.operationId === identity.operationId);
  if (!operation) throw new TypeError('m7-vpn-production:operation-identity-invalid');
  return [...operation.requiredScopes];
}

function requireCoreDependencies(value) {
  const required = [
    'authorizeConversation',
    'authorizeNotification',
    'authorizeOperator',
    'authorizeProject',
    'executeConversation',
  ];
  if (!plain(value)) throw new TypeError('m7-vpn-production:dependencies-invalid');
  for (const field of required) requireFunction(value[field], field);
  if (typeof value.coreVersion !== 'string' || value.coreVersion.length < 1
    || !Array.isArray(value.healthComponents) || value.healthComponents.length < 1
    || value.m2ApprovalPort === undefined || value.notificationPort === undefined) {
    throw new TypeError('m7-vpn-production:dependencies-incomplete');
  }
  return value;
}

export function createM7VpnRuntimeComposition({
  dependencies,
  peerIdentityKey,
  runtimeConfig,
} = {}) {
  if (!isGenuineM7VpnRuntimeConfiguration(runtimeConfig)) {
    throw new TypeError('m7-vpn-production:genuine-runtime-config-required');
  }
  const deps = requireCoreDependencies(dependencies);
  const database = requireDatabase(deps.database);
  const key = requirePeerKey(peerIdentityKey);
  const state = { active: false };
  const events = deps.runEventAdapter ?? createM7RunEventCoreAdapter({ now: deps.clock });
  const sessionAuthority = createM7SessionAuthority(database, {
    adapterManifestDigest: MOBILE_REMOTE_CANDIDATE_ADAPTER_MANIFEST_DIGEST_V1,
    authorizeOperator: deps.authorizeOperator,
    clock: deps.clock,
    pairingEnabled: () => state.active,
    resolveInvocationScopes,
    serverIdentityPin: runtimeConfig.serverIdentityPin,
    serverOrigin: runtimeConfig.serverOrigin,
  });
  const admissionPolicy = createM7TransportAdmissionPolicy({
    listener: runtimeConfig.listener,
    peerIdentityKey: key,
  });
  const rateLimiter = createM7DurableRateLimiter(database, {
    clock: deps.clock,
    maximumRows: runtimeConfig.rateLimit.maximumRows,
    retentionMs: runtimeConfig.rateLimit.retentionMs,
  });
  const mutationMediator = createM7MutationMediator();
  let pipeline;
  try {
    pipeline = createM7DisconnectedRequestPipeline({
      admissionPolicy,
      rateLimiter,
      requireCompleteCapabilities: true,
      sessionAuthority,
      coreConfig: {
        authorizeConversation: deps.authorizeConversation,
        authorizeNotification: deps.authorizeNotification,
        authorizeProject: deps.authorizeProject,
        clock: deps.clock,
        coreVersion: deps.coreVersion,
        cursorKey: cursorKey(key),
        database,
        executeConversation: deps.executeConversation,
        healthComponents: deps.healthComponents,
        m2ApprovalPort: deps.m2ApprovalPort,
        mutationMediator,
        notificationPort: deps.notificationPort,
        runEventAdapter: events,
      },
    });
  } finally {
    key.fill(0);
  }

  const composition = Object.freeze({
    describe() {
      return Object.freeze({
        active: state.active,
        capabilities: [...REQUIRED_CAPABILITIES],
        contract: 'M7VpnRuntimeComposition',
        serverIdentityPin: runtimeConfig.serverIdentityPin,
        serverOrigin: runtimeConfig.serverOrigin,
        stage: M7_VPN_PRODUCTION_RUNTIME_STAGE,
        version: 1,
      });
    },
    pipeline,
    runEventAdapter: events,
    sessionAuthority,
    stage: M7_VPN_PRODUCTION_RUNTIME_STAGE,
  });
  runtimeCompositions.add(composition);
  runtimeCompositionState.set(composition, state);
  return composition;
}

export function createM7VpnProductionRuntime({
  dependencies,
  runtimeConfig,
} = {}) {
  const composition = withM7ServiceCredentialMaterial(runtimeConfig, material => (
    createM7VpnRuntimeComposition({
      dependencies,
      peerIdentityKey: material.rateLimitKey,
      runtimeConfig,
    })
  ));
  if (!runtimeCompositions.has(composition)) {
    throw new TypeError('m7-vpn-production:genuine-composition-required');
  }
  const listener = createM7VpnTlsListener({ config: runtimeConfig, pipeline: composition.pipeline });
  const state = runtimeCompositionState.get(composition);
  const runtime = Object.freeze({
    describe: composition.describe,
    runEventAdapter: composition.runEventAdapter,
    sessionAuthority: composition.sessionAuthority,
    async start() {
      if (!productionRuntimes.has(this) || state.active) {
        throw new TypeError('m7-vpn-production:start-state-invalid');
      }
      const binding = await listener.start();
      state.active = true;
      return binding;
    },
    async stop(options) {
      if (!productionRuntimes.has(this)) {
        throw new TypeError('m7-vpn-production:genuine-runtime-required');
      }
      state.active = false;
      return listener.stop(options);
    },
  });
  productionRuntimes.add(runtime);
  return runtime;
}

export function isGenuineM7VpnProductionRuntime(value) {
  return productionRuntimes.has(value);
}

export const _testInternals = Object.freeze({
  cursorKey,
  resolveInvocationScopes,
});

export default createM7VpnProductionRuntime;
