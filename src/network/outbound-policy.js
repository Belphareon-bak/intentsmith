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
  TARGET_CONTRACT_DENIED: 'OUTBOUND_TARGET_CONTRACT_DENIED',
  REDIRECT_DENIED: 'OUTBOUND_REDIRECT_DENIED',
});

const OUTBOUND_CAPABILITIES = new WeakMap();
const MODEL_FAMILY_PATH = /^\/library\/[a-z0-9._-]+$/;
const MAX_REDIRECTS = 4;

function requestHeaderEntries(input, init) {
  const source = Object.hasOwn(init ?? {}, 'headers') ? init.headers : input?.headers;
  try {
    return [...new Headers(source).entries()];
  } catch {
    return null;
  }
}

function requestHasBody(input, init) {
  if (Object.hasOwn(init ?? {}, 'body')) return init.body !== null && init.body !== undefined;
  return input?.body !== null && input?.body !== undefined;
}

function exactHeaders(entries, expected) {
  if (!entries || entries.length !== expected.length) return false;
  const actual = new Map(entries);
  return expected.every(([name, value]) => actual.get(name) === value);
}

function validModelDiscoveryTarget({ url, method, headers, hasBody }) {
  if (url.hash !== '' || hasBody) return false;
  if (url.origin === 'https://whatllm.org') {
    return method === 'GET'
      && url.pathname === '/'
      && url.search === ''
      && exactHeaders(headers, [['accept', 'text/html']]);
  }
  if (url.origin === 'https://huggingface.co') {
    const keys = [...url.searchParams.keys()].sort();
    return method === 'GET'
      && url.pathname === '/api/models'
      && keys.length === 4
      && keys.join(',') === 'direction,limit,search,sort'
      && typeof url.searchParams.get('search') === 'string'
      && url.searchParams.get('search').length > 0
      && url.searchParams.get('search').length <= 200
      && url.searchParams.get('limit') === '10'
      && url.searchParams.get('sort') === 'downloads'
      && url.searchParams.get('direction') === '-1'
      && exactHeaders(headers, [
        ['accept', 'application/json'],
        ['user-agent', 'intentsmith/1.0'],
      ]);
  }
  if (url.origin === 'https://ollama.com') {
    const exactPath = url.pathname === '/library' || MODEL_FAMILY_PATH.test(url.pathname);
    const allowedHeaders = headers?.length === 0
      || exactHeaders(headers, [['user-agent', 'c3-agent/1.0']])
      || exactHeaders(headers, [['user-agent', 'intentsmith/1.0']]);
    return ['GET', 'HEAD'].includes(method)
      && exactPath
      && url.search === ''
      && allowedHeaders;
  }
  return false;
}

function createOutboundCapability({ surface, scope, validateTarget }) {
  const capability = Object.freeze(Object.create(null));
  OUTBOUND_CAPABILITIES.set(capability, Object.freeze({ surface, scope, validateTarget }));
  return capability;
}

const MODEL_DISCOVERY_OUTBOUND_CAPABILITY = createOutboundCapability({
  surface: 'model-discovery',
  scope: 'model.metadata.read',
  validateTarget: validModelDiscoveryTarget,
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

function authorityValue(capability) {
  return capability && typeof capability === 'object'
    ? OUTBOUND_CAPABILITIES.get(capability) ?? null
    : null;
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
    const headers = requestHeaderEntries(input, init);
    const hasBody = requestHasBody(input, init);
    const authority = authorityValue(metadata);
    const surface = authority?.surface || 'unscoped';
    const scope = authority?.scope || 'none';
    let requestId = null;
    let currentUrl = url;
    let currentInput = input;
    let redirectCount = 0;

    function appendDecision(targetUrl, decision, reasonCode) {
      requestId ??= audit.createRequestId(idFactory());
      const targetDigest = outboundTargetDigest(targetUrl.href);
      try {
        audit.append({
          requestId,
          phase: 'decision',
          surface,
          scope,
          method,
          targetOrigin: targetUrl.origin,
          targetDigest,
          decision,
          reasonCode,
        });
      } catch (error) {
        logger.error('Outbound', 'outbound_audit_unavailable', { reasonCode: error?.code || 'DB_ERROR' });
        throw typedError(OUTBOUND_ERROR_CODE.AUDIT_UNAVAILABLE, 'External request denied because audit is unavailable');
      }
      if (decision === 'deny') {
        logger.warn('Outbound', 'outbound_request_denied', {
          requestId, surface, scope, method, targetOrigin: targetUrl.origin, reasonCode,
        });
        throw typedError(reasonCode, 'External request denied by outbound policy', {
          requestId, surface, scope,
        });
      }
    }

    function authorizeTarget(targetUrl, { redirected = false, fromLoopback = false } = {}) {
      if (isLoopback(targetUrl)) {
        if (redirected && !fromLoopback) {
          appendDecision(targetUrl, 'deny', OUTBOUND_ERROR_CODE.REDIRECT_DENIED);
        }
        return;
      }
      let reasonCode = 'OUTBOUND_POLICY_ALLOWED';
      if (!authority) reasonCode = OUTBOUND_ERROR_CODE.SCOPE_REQUIRED;
      else if (enabledSurfaces[authority.surface] !== true) {
        reasonCode = OUTBOUND_ERROR_CODE.SURFACE_DISABLED;
      } else if (!authority.validateTarget({ url: targetUrl, method, headers, hasBody })) {
        reasonCode = OUTBOUND_ERROR_CODE.TARGET_CONTRACT_DENIED;
      }
      appendDecision(
        targetUrl,
        reasonCode === 'OUTBOUND_POLICY_ALLOWED' ? 'allow' : 'deny',
        reasonCode,
      );
    }

    authorizeTarget(currentUrl);
    let response;
    try {
      for (;;) {
        const sourceWasLoopback = isLoopback(currentUrl);
        response = await transport(currentInput, { ...init, redirect: 'manual' });
        const location = response.status >= 300 && response.status <= 399
          ? response.headers?.get('location')
          : null;
        if (!location) break;
        redirectCount += 1;
        if (redirectCount > MAX_REDIRECTS) {
          throw typedError(OUTBOUND_ERROR_CODE.REDIRECT_DENIED, 'External redirect limit exceeded');
        }
        let redirectedUrl;
        try {
          redirectedUrl = requestUrl(new URL(location, currentUrl));
        } catch {
          throw typedError(OUTBOUND_ERROR_CODE.REDIRECT_DENIED, 'External redirect target is invalid');
        }
        currentUrl = redirectedUrl;
        authorizeTarget(currentUrl, { redirected: true, fromLoopback: sourceWasLoopback });
        currentInput = redirectedUrl.href;
      }
      if (requestId === null) return response;
      const targetDigest = outboundTargetDigest(currentUrl.href);
      audit.append({
        requestId,
        phase: 'terminal',
        surface,
        scope,
        method,
        targetOrigin: currentUrl.origin,
        targetDigest,
        decision: 'succeeded',
        reasonCode: 'OUTBOUND_REQUEST_COMPLETED',
        httpStatus: response.status,
      });
      return response;
    } catch (error) {
      if (requestId !== null) {
        try {
          const targetDigest = outboundTargetDigest(currentUrl.href);
          audit.append({
            requestId,
            phase: 'terminal',
            surface,
            scope,
            method,
            targetOrigin: currentUrl.origin,
            targetDigest,
            decision: 'failed',
            reasonCode: Object.values(OUTBOUND_ERROR_CODE).includes(error?.code)
              ? error.code
              : 'OUTBOUND_REQUEST_FAILED',
            httpStatus: Number.isInteger(response?.status) ? response.status : null,
          });
        } catch (auditError) {
          logger.error('Outbound', 'outbound_terminal_audit_unavailable', { requestId, reasonCode: auditError?.code || 'DB_ERROR' });
        }
      }
      throw error;
    }
  }

  return Object.freeze({
    fetch: governedFetch,
    modelDiscoveryFetch: (input, init) => governedFetch(
      input,
      init,
      MODEL_DISCOVERY_OUTBOUND_CAPABILITY,
    ),
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

export function modelDiscoveryFetch(input, init) {
  if (!productionPolicy) {
    throw typedError(OUTBOUND_ERROR_CODE.AUDIT_UNAVAILABLE, 'Production outbound policy is not configured');
  }
  return productionPolicy.modelDiscoveryFetch(input, init);
}

export function getOutboundDiagnostics() {
  return productionPolicy ? productionPolicy.summary() : null;
}

export const _testInternals = Object.freeze({ authorityValue, isLoopback, requestUrl });
