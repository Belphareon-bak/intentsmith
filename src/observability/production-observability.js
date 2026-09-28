import { randomUUID } from 'node:crypto';

export const PRODUCTION_DIAGNOSTICS_CONTRACT = 'intentsmith.production-diagnostics';
export const HTTP_REQUEST_ID_HEADER = 'X-Request-ID';
export const HTTP_RUN_ID_HEADER = 'X-IntentSmith-Run-ID';

export const FailureClass = Object.freeze({
  NONE: 'none',
  AUTHENTICATION: 'authentication',
  AUTHORIZATION: 'authorization',
  INPUT: 'input',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  RATE_LIMIT: 'rate_limit',
  CANCELLED: 'cancelled',
  TIMEOUT: 'timeout',
  DEPENDENCY: 'dependency',
  RESOURCE: 'resource',
  STORAGE: 'storage',
  RECOVERY: 'recovery',
  INTERNAL: 'internal',
});

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
const STATUS_FAMILIES = Object.freeze(['2xx', '3xx', '4xx', '5xx', 'aborted']);

function canonicalIdentifier(value) {
  return typeof value === 'string'
    && IDENTIFIER_PATTERN.test(value)
    && value === value.normalize('NFC')
    ? value
    : null;
}

function canonicalErrorCode(value) {
  return typeof value === 'string' && ERROR_CODE_PATTERN.test(value) ? value : null;
}

function statusFamily(statusCode) {
  if (!Number.isInteger(statusCode)) return 'aborted';
  const family = `${Math.floor(statusCode / 100)}xx`;
  return STATUS_FAMILIES.includes(family) ? family : 'aborted';
}

function failure(classification, retryable, severity) {
  return Object.freeze({ classification, retryable, severity });
}

export function classifyProductionFailure({ statusCode, errorCode } = {}) {
  const code = canonicalErrorCode(errorCode) || '';
  if (Number.isInteger(statusCode) && statusCode < 400) {
    return failure(FailureClass.NONE, false, 'info');
  }
  if (/(?:^|_)(?:CANCELLED|CANCELED)(?:_|$)/.test(code)) {
    return failure(FailureClass.CANCELLED, false, 'info');
  }
  if (/(?:^|_)TIME(?:D)?_?OUT(?:_|$)|TIMEOUT/.test(code) || statusCode === 504) {
    return failure(FailureClass.TIMEOUT, true, 'warning');
  }
  if (/(?:^|_)RECOVERY(?:_|$)|ORPHANED|IN_DOUBT/.test(code)) {
    return failure(FailureClass.RECOVERY, true, 'error');
  }
  if (/(?:^|_)(?:STORAGE|DATABASE|DB)(?:_|$)/.test(code)) {
    return failure(FailureClass.STORAGE, true, 'error');
  }
  if (/(?:^|_)(?:RESOURCE|LIMIT|TOO_LARGE)(?:_|$)/.test(code) || statusCode === 413) {
    return failure(FailureClass.RESOURCE, false, 'warning');
  }
  if (statusCode === 401 || /AUTH_REQUIRED|UNAUTHENTICATED/.test(code)) {
    return failure(FailureClass.AUTHENTICATION, false, 'warning');
  }
  if (statusCode === 403 || /AUTH_SCOPE|FORBIDDEN|OWNER_MISMATCH/.test(code)) {
    return failure(FailureClass.AUTHORIZATION, false, 'warning');
  }
  if (statusCode === 404 || /NOT_FOUND/.test(code)) {
    return failure(FailureClass.NOT_FOUND, false, 'info');
  }
  if (statusCode === 409 || /CONFLICT|STALE|MISMATCH|BUSY|REPLAY|EXPIRED|INCOMPLETE/.test(code)) {
    return failure(FailureClass.CONFLICT, false, 'warning');
  }
  if (statusCode === 429 || /RATE_LIMIT/.test(code)) {
    return failure(FailureClass.RATE_LIMIT, true, 'warning');
  }
  if (statusCode === 400 || /INPUT|INVALID|MALFORMED|REQUIRED|MISSING/.test(code)) {
    return failure(FailureClass.INPUT, false, 'info');
  }
  if ([502, 503].includes(statusCode)
    || /PROVIDER|DEPENDENCY|UNAVAILABLE|NOT_INITIALIZED/.test(code)) {
    return failure(FailureClass.DEPENDENCY, true, 'error');
  }
  return failure(FailureClass.INTERNAL, true, 'error');
}

function responseCorrelation(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const planIdentity = payload.plan?.identity;
  return {
    operationRequestId: canonicalIdentifier(payload.requestId),
    lifecycleId: canonicalIdentifier(payload.lifecycleId)
      || canonicalIdentifier(planIdentity?.lifecycleId),
    runId: canonicalIdentifier(payload.runId)
      || canonicalIdentifier(payload.result?.runId)
      || canonicalIdentifier(planIdentity?.runId),
  };
}

function boundedRouteKey(value) {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 512
    && !/[\r\n\0]/.test(value)
    ? value
    : null;
}

function frozenRecord(value) {
  return Object.freeze({ ...value });
}

export function createProductionObservability({
  logger,
  clock = Date.now,
  idFactory = randomUUID,
  recentFailureLimit = 32,
} = {}) {
  if (!logger || !['debug', 'info', 'warn', 'error'].every(level => typeof logger[level] === 'function')) {
    throw new TypeError('production-observability:logger-required');
  }
  if (typeof clock !== 'function' || typeof idFactory !== 'function') {
    throw new TypeError('production-observability:clock-and-id-factory-required');
  }
  if (!Number.isSafeInteger(recentFailureLimit) || recentFailureLimit < 1 || recentFailureLimit > 256) {
    throw new TypeError('production-observability:invalid-recent-failure-limit');
  }

  const startedAtMs = clock();
  const statusCounts = Object.fromEntries(STATUS_FAMILIES.map(key => [key, 0]));
  const failureCounts = Object.fromEntries(Object.values(FailureClass).map(key => [key, 0]));
  const recentFailures = [];
  let activeRequests = 0;
  let completedRequests = 0;
  let durationTotalMs = 0;
  let durationMaxMs = 0;

  function beginHttpRequest(req, res) {
    const started = clock();
    const generated = canonicalIdentifier(idFactory());
    if (!Number.isSafeInteger(started) || started < 0 || !generated) {
      throw new Error('production-observability:request-identity-unavailable');
    }
    const state = {
      requestId: `http:${generated}`,
      clientRequestId: canonicalIdentifier(req?.headers?.['x-request-id']),
      operationRequestId: null,
      lifecycleId: null,
      runId: null,
      routeKey: null,
      credentialType: null,
      errorCode: null,
      startedAtMs: started,
      finalized: false,
    };
    req.observation = state;
    res.observation = state;
    res.setHeader(HTTP_REQUEST_ID_HEADER, state.requestId);
    activeRequests += 1;

    const finalize = aborted => {
      if (state.finalized) return;
      state.finalized = true;
      activeRequests = Math.max(0, activeRequests - 1);
      completedRequests += 1;
      const completedAtMs = clock();
      const durationMs = Number.isSafeInteger(completedAtMs) && completedAtMs >= state.startedAtMs
        ? completedAtMs - state.startedAtMs
        : 0;
      durationTotalMs += durationMs;
      durationMaxMs = Math.max(durationMaxMs, durationMs);
      const statusCode = aborted ? null : res.statusCode;
      statusCounts[statusFamily(statusCode)] += 1;
      const taxonomy = aborted
        ? failure(FailureClass.CANCELLED, false, 'warning')
        : classifyProductionFailure({ statusCode, errorCode: state.errorCode });
      failureCounts[taxonomy.classification] += 1;
      const record = frozenRecord({
        requestId: state.requestId,
        clientRequestId: state.clientRequestId,
        operationRequestId: state.operationRequestId,
        lifecycleId: state.lifecycleId,
        runId: state.runId,
        routeKey: state.routeKey,
        credentialType: state.credentialType,
        statusCode,
        durationMs,
        errorCode: state.errorCode,
        failureClass: taxonomy.classification,
        retryable: taxonomy.retryable,
      });
      if (taxonomy.classification !== FailureClass.NONE) {
        recentFailures.push(record);
        if (recentFailures.length > recentFailureLimit) recentFailures.shift();
      }
      if (taxonomy.severity === 'error') logger.error('Observe', 'http_request_completed', record);
      else if (taxonomy.severity === 'warning') logger.warn('Observe', 'http_request_completed', record);
      else if (record.runId || record.lifecycleId) logger.info('Observe', 'http_request_completed', record);
      else logger.debug('Observe', 'http_request_completed', record);
    };
    res.once('finish', () => finalize(false));
    res.once('close', () => finalize(true));

    return Object.freeze({
      requestId: state.requestId,
      setRoute(routeKey) { state.routeKey = boundedRouteKey(routeKey); },
      setCredentialType(value) { state.credentialType = canonicalIdentifier(value); },
    });
  }

  function observeResponse(res, { statusCode, payload } = {}) {
    const state = res?.observation;
    if (!state || state.finalized) return false;
    const correlation = responseCorrelation(payload);
    if (correlation.operationRequestId) state.operationRequestId = correlation.operationRequestId;
    if (correlation.lifecycleId) state.lifecycleId = correlation.lifecycleId;
    if (correlation.runId) {
      state.runId = correlation.runId;
      if (!res.headersSent) res.setHeader(HTTP_RUN_ID_HEADER, correlation.runId);
    }
    state.errorCode = canonicalErrorCode(payload?.code)
      || canonicalErrorCode(payload?.errorCode)
      || (Number.isInteger(statusCode) && statusCode >= 500 ? 'HTTP_INTERNAL_ERROR' : state.errorCode);
    return true;
  }

  function markFailure(res, errorCode) {
    const state = res?.observation;
    const code = canonicalErrorCode(errorCode);
    if (!state || state.finalized || !code) return false;
    state.errorCode = code;
    return true;
  }

  function snapshot() {
    const now = clock();
    return Object.freeze({
      contract: PRODUCTION_DIAGNOSTICS_CONTRACT,
      version: 1,
      generatedAt: new Date(now).toISOString(),
      processStartedAt: new Date(startedAtMs).toISOString(),
      http: Object.freeze({
        activeRequests,
        completedRequests,
        statusCounts: frozenRecord(statusCounts),
        failureCounts: frozenRecord(failureCounts),
        latency: Object.freeze({
          meanMs: completedRequests === 0 ? 0 : Math.round(durationTotalMs / completedRequests),
          maxMs: durationMaxMs,
        }),
        recentFailures: Object.freeze(recentFailures.map(frozenRecord)),
      }),
    });
  }

  return Object.freeze({ beginHttpRequest, markFailure, observeResponse, snapshot });
}

export const _testInternals = Object.freeze({
  canonicalErrorCode,
  canonicalIdentifier,
  responseCorrelation,
  statusFamily,
});

export default createProductionObservability;
