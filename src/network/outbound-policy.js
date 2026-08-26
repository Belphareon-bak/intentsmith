import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';

import { OutboundAuditRepository, outboundTargetDigest } from './outbound-audit-repository.js';

export const OUTBOUND_ERROR_CODE = Object.freeze({
  AUDIT_UNAVAILABLE: 'OUTBOUND_AUDIT_UNAVAILABLE',
  INVALID_TARGET: 'OUTBOUND_INVALID_TARGET',
  SCOPE_REQUIRED: 'OUTBOUND_SCOPE_REQUIRED',
  SURFACE_DISABLED: 'OUTBOUND_SURFACE_DISABLED',
  ORIGIN_DENIED: 'OUTBOUND_ORIGIN_DENIED',
  METHOD_DENIED: 'OUTBOUND_METHOD_DENIED',
  REDIRECT_DENIED: 'OUTBOUND_REDIRECT_DENIED',
});

const MODEL_DISCOVERY_ORIGINS = Object.freeze(new Set([
  'https://ollama.com',
  'https://whatllm.org',
  'https://huggingface.co',
]));
const SCOPES = Object.freeze({
  'model-discovery': Object.freeze({
    scope: 'model.metadata.read',
    methods: Object.freeze(new Set(['GET', 'HEAD'])),
    origins: MODEL_DISCOVERY_ORIGINS,
  }),
});

const runtimeTransport = typeof globalThis.fetch === 'function'
  ? globalThis.fetch.bind(globalThis)
  : null;
let productionPolicy = null;
let installedGuard = null;

function typedError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details: Object.freeze({ ...details }) });
}

function requestUrl(input) {
  const value = typeof input === 'string' || input instanceof URL ? input : input?.url;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw typedError(OUTBOUND_ERROR_CODE.INVALID_TARGET, 'Outbound target must be credential-free HTTP(S)');
  }
  return url;
}

function methodOf(input, init) {
  return String(init?.method || input?.method || 'GET').toUpperCase();
}

function isLoopback(url) {
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname === '::1') return true;
  if (isIP(hostname) === 4) return hostname.split('.')[0] === '127';
  return false;
}

function metadataValue(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const keys = Object.keys(metadata).sort();
  if (keys.length !== 2 || keys[0] !== 'scope' || keys[1] !== 'surface') return null;
  return metadata;
}

export function createOutboundPolicy({
  database,
  logger,
  transport = runtimeTransport,
  clock = Date.now,
  idFactory = randomUUID,
  enabledSurfaces = {},
} = {}) {
  if (typeof transport !== 'function') throw new TypeError('outbound-policy:transport-required');
  if (!logger || typeof logger.warn !== 'function' || typeof logger.error !== 'function') {
    throw new TypeError('outbound-policy:logger-required');
  }
  const audit = new OutboundAuditRepository(database, { clock, idFactory });

  async function governedFetch(input, init = {}, metadata = null) {
    let url;
    try {
      url = requestUrl(input);
    } catch (error) {
      if (error?.code) throw error;
      throw typedError(OUTBOUND_ERROR_CODE.INVALID_TARGET, 'Outbound target URL is invalid');
    }
    const method = methodOf(input, init);
    if (isLoopback(url)) return transport(input, init);

    const targetDigest = outboundTargetDigest(url.href);
    const requestId = audit.createRequestId(idFactory());
    const declared = metadataValue(metadata);
    const surface = declared?.surface || 'unscoped';
    const scope = declared?.scope || 'none';
    const rule = declared ? SCOPES[surface] : null;
    let decision = 'allow';
    let reasonCode = 'OUTBOUND_POLICY_ALLOWED';
    if (!rule || scope !== rule.scope) {
      decision = 'deny';
      reasonCode = OUTBOUND_ERROR_CODE.SCOPE_REQUIRED;
    } else if (enabledSurfaces[surface] !== true) {
      decision = 'deny';
      reasonCode = OUTBOUND_ERROR_CODE.SURFACE_DISABLED;
    } else if (!rule.methods.has(method)) {
      decision = 'deny';
      reasonCode = OUTBOUND_ERROR_CODE.METHOD_DENIED;
    } else if (!rule.origins.has(url.origin)) {
      decision = 'deny';
      reasonCode = OUTBOUND_ERROR_CODE.ORIGIN_DENIED;
    }

    try {
      audit.append({
        requestId,
        phase: 'decision',
        surface,
        scope,
        method,
        targetOrigin: url.origin,
        targetDigest,
        decision,
        reasonCode,
      });
    } catch (error) {
      logger.error('Outbound', 'outbound_audit_unavailable', { reasonCode: error?.code || 'DB_ERROR' });
      throw typedError(OUTBOUND_ERROR_CODE.AUDIT_UNAVAILABLE, 'External request denied because audit is unavailable');
    }
    if (decision === 'deny') {
      logger.warn('Outbound', 'outbound_request_denied', { requestId, surface, scope, method, targetOrigin: url.origin, reasonCode });
      throw typedError(reasonCode, 'External request denied by outbound policy', { requestId, surface, scope });
    }

    let response;
    try {
      response = await transport(input, { ...init, redirect: 'manual' });
      if (response.status >= 300 && response.status <= 399 && response.headers?.get('location')) {
        throw typedError(OUTBOUND_ERROR_CODE.REDIRECT_DENIED, 'External redirect requires a new exact policy decision');
      }
      audit.append({
        requestId,
        phase: 'terminal',
        surface,
        scope,
        method,
        targetOrigin: url.origin,
        targetDigest,
        decision: 'succeeded',
        reasonCode: 'OUTBOUND_REQUEST_COMPLETED',
        httpStatus: response.status,
      });
      return response;
    } catch (error) {
      try {
        audit.append({
          requestId,
          phase: 'terminal',
          surface,
          scope,
          method,
          targetOrigin: url.origin,
          targetDigest,
          decision: 'failed',
          reasonCode: error?.code === OUTBOUND_ERROR_CODE.REDIRECT_DENIED
            ? OUTBOUND_ERROR_CODE.REDIRECT_DENIED
            : 'OUTBOUND_REQUEST_FAILED',
          httpStatus: Number.isInteger(response?.status) ? response.status : null,
        });
      } catch (auditError) {
        logger.error('Outbound', 'outbound_terminal_audit_unavailable', { requestId, reasonCode: auditError?.code || 'DB_ERROR' });
      }
      throw error;
    }
  }

  return Object.freeze({
    fetch: governedFetch,
    summary: options => audit.summary(options),
  });
}

export function configureProductionOutboundPolicy(options) {
  if (productionPolicy) throw new Error('outbound-policy:already-configured');
  productionPolicy = createOutboundPolicy(options);
  return productionPolicy;
}

export function installProductionOutboundGuard() {
  if (!productionPolicy) throw new Error('outbound-policy:not-configured');
  if (installedGuard && globalThis.fetch === installedGuard) return installedGuard;
  installedGuard = (input, init) => productionPolicy.fetch(input, init, null);
  globalThis.fetch = installedGuard;
  return installedGuard;
}

export function outboundFetch(input, init, metadata) {
  if (!productionPolicy) {
    throw typedError(OUTBOUND_ERROR_CODE.AUDIT_UNAVAILABLE, 'Production outbound policy is not configured');
  }
  return productionPolicy.fetch(input, init, metadata);
}

export function getOutboundDiagnostics() {
  return productionPolicy ? productionPolicy.summary() : null;
}

export const MODEL_DISCOVERY_OUTBOUND_AUTHORITY = Object.freeze({
  surface: 'model-discovery',
  scope: 'model.metadata.read',
});

export const _testInternals = Object.freeze({ isLoopback, metadataValue, requestUrl });
