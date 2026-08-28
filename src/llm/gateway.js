// CRE v36.7 LLM Gateway
// ══════════════════════════════════════════════════════════════════════════════
//
// CENTRAL CONTROLLED ACCESS TO LLM
//
// This is the ONLY place that can call Ollama/LLM.
// All callers must have a valid LLMAuthToken.
//
// Features:
// - Capability-based authorization
// - Token validation
// - Audit logging
// - Rate limiting
// - Single point of control
//
// ══════════════════════════════════════════════════════════════════════════════

import { config } from '../config.js';
import {
  AbortSource,
  abortErrorFromSignal,
  abortSourceOf,
  abortWithReason,
} from '../core/abort-error.js';
import { logger } from '../core/logger.js';
import { modelUniverseStore } from '../upgrade/model-universe-store.js';
import { normalizeModelDigestSha256, sameModelName } from '../upgrade/model-identity.js';
import {
  MODEL_ACTIVITY_OWNER,
  modelUseAuthority,
} from '../upgrade/model-use-authority.js';
import {
  VramFitState,
  fitsVram,
  resolveNumCtx,
} from './model-ctx.js';
import {
  M1_MODEL_PURPOSE,
} from '../../contracts/m1/index.js';
import {
  isIdentifier,
  isPlainRecord,
} from '../../contracts/m1/shared.js';
import { 
  validateAuthToken, 
  hasCapability, 
  LLMCallerRole,
  LLMCapability 
} from './auth-types.js';

export const LLMGatewayErrorCode = Object.freeze({
  INVALID_REQUEST: 'LLM_INVALID_REQUEST',
  AUTHORIZATION_DENIED: 'LLM_AUTHORIZATION_DENIED',
  PROVIDER_UNAVAILABLE: 'LLM_PROVIDER_UNAVAILABLE',
  PROVIDER_HTTP_ERROR: 'LLM_PROVIDER_HTTP_ERROR',
  MODEL_NOT_FOUND: 'LLM_MODEL_NOT_FOUND',
  MALFORMED_RESPONSE: 'LLM_PROVIDER_MALFORMED_RESPONSE',
  EMPTY_RESPONSE: 'LLM_PROVIDER_EMPTY_RESPONSE',
  QUEUE_TIMEOUT: 'LLM_QUEUE_TIMEOUT',
  MODEL_VRAM_NON_FIT: 'MODEL_VRAM_NON_FIT',
  BINDING_ARTIFACT_UNVERIFIED: 'LLM_BINDING_ARTIFACT_UNVERIFIED',
  BINDING_ARTIFACT_DRIFT: 'LLM_BINDING_ARTIFACT_DRIFT',
});

export class LLMGatewayError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'LLMGatewayError';
    this.code = code;
    this.httpStatus = options.httpStatus ?? null;
    this.retryable = options.retryable === true;
  }
}

function providerHttpError(status, cause = null) {
  if (status === 404) {
    return new LLMGatewayError(
      LLMGatewayErrorCode.MODEL_NOT_FOUND,
      'The requested local model is not available.',
      { cause, httpStatus: status, retryable: false },
    );
  }
  if (status === 503) {
    return new LLMGatewayError(
      LLMGatewayErrorCode.PROVIDER_UNAVAILABLE,
      'The local model provider is unavailable.',
      { cause, httpStatus: status, retryable: false },
    );
  }
  return new LLMGatewayError(
    LLMGatewayErrorCode.PROVIDER_HTTP_ERROR,
    `The local model provider returned HTTP ${status}.`,
    { cause, httpStatus: status, retryable: status >= 500 },
  );
}

async function resolveCurrentArtifactDigest(baseUrl, modelName, signal) {
  let response;
  try {
    response = await fetch(`${baseUrl}/api/tags`, { signal });
  } catch (cause) {
    if (cause?.name === 'AbortError' || cause?.name === 'TimeoutError') throw cause;
    throw new LLMGatewayError(
      LLMGatewayErrorCode.BINDING_ARTIFACT_UNVERIFIED,
      'The bound local model artifact cannot be verified.',
      { cause, httpStatus: 503, retryable: false },
    );
  }
  if (!response?.ok) {
    throw new LLMGatewayError(
      LLMGatewayErrorCode.BINDING_ARTIFACT_UNVERIFIED,
      'The bound local model artifact cannot be verified.',
      { httpStatus: 503, retryable: false },
    );
  }
  let body;
  try { body = await response.json(); }
  catch (cause) {
    throw new LLMGatewayError(
      LLMGatewayErrorCode.BINDING_ARTIFACT_UNVERIFIED,
      'The bound local model inventory is malformed.',
      { cause, httpStatus: 503, retryable: false },
    );
  }
  const matches = Array.isArray(body?.models)
    ? body.models.filter(row => sameModelName(row?.name, modelName))
    : [];
  const digestSha256 = matches.length === 1
    ? normalizeModelDigestSha256(matches[0]?.digest)
    : null;
  if (!digestSha256) {
    throw new LLMGatewayError(
      LLMGatewayErrorCode.BINDING_ARTIFACT_UNVERIFIED,
      'The bound local model artifact has no unique exact digest.',
      { httpStatus: 503, retryable: false },
    );
  }
  return digestSha256;
}

function parseProviderOutput(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new LLMGatewayError(
      LLMGatewayErrorCode.MALFORMED_RESPONSE,
      'The local model provider returned a malformed response.',
    );
  }

  const candidates = [];
  let recognized = false;
  if (data.message !== undefined) {
    recognized = true;
    if (
      data.message === null
      || typeof data.message !== 'object'
      || Array.isArray(data.message)
      || typeof data.message.content !== 'string'
    ) {
      throw new LLMGatewayError(
        LLMGatewayErrorCode.MALFORMED_RESPONSE,
        'The local model provider returned a malformed response.',
      );
    }
    candidates.push(data.message.content);
  }
  if (data.response !== undefined) {
    recognized = true;
    if (typeof data.response !== 'string') {
      throw new LLMGatewayError(
        LLMGatewayErrorCode.MALFORMED_RESPONSE,
        'The local model provider returned a malformed response.',
      );
    }
    candidates.push(data.response);
  }
  if (!recognized) {
    throw new LLMGatewayError(
      LLMGatewayErrorCode.MALFORMED_RESPONSE,
      'The local model provider returned a malformed response.',
    );
  }

  const output = candidates.find(candidate => candidate.trim().length > 0);
  if (output === undefined) {
    throw new LLMGatewayError(
      LLMGatewayErrorCode.EMPTY_RESPONSE,
      'The local model provider returned an empty response.',
    );
  }
  return output;
}

function normalizeProviderFailure(error) {
  if (error instanceof LLMGatewayError) return error;
  if (error?.cause) {
    const cause = normalizeProviderFailure(error.cause);
    if (cause instanceof LLMGatewayError) return cause;
  }
  const networkCode = error?.code || error?.cause?.code;
  if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH'].includes(networkCode)) {
    return new LLMGatewayError(
      LLMGatewayErrorCode.PROVIDER_UNAVAILABLE,
      'The local model provider is unavailable.',
      { cause: error, retryable: true },
    );
  }
  return error;
}

const M1_CORRELATION_KEYS = Object.freeze([
  'requestId',
  'conversationId',
  'turnId',
  'callerRole',
  'modelRole',
  'purpose',
]);
const M1_MODEL_PURPOSES = new Set(Object.values(M1_MODEL_PURPOSE));
const MODEL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;

function isModelName(value) {
  return typeof value === 'string' && MODEL_NAME_PATTERN.test(value);
}

function isPolicyNumCtx(value) {
  return Number.isSafeInteger(value) && value >= 512 && value <= 262144;
}

function safeCorrelation(options = {}, authToken = null) {
  const correlation = isPlainRecord(options.correlation)
    ? options.correlation
    : {};
  return {
    requestId: isIdentifier(correlation.requestId) ? correlation.requestId : null,
    conversationId: isIdentifier(correlation.conversationId)
      ? correlation.conversationId
      : null,
    turnId: isIdentifier(correlation.turnId) ? correlation.turnId : null,
    // Authorization owns caller identity. Never persist a caller-supplied
    // role that disagrees with the token even on legacy call sites.
    callerRole: isIdentifier(authToken?.role) ? authToken.role : null,
    modelRole: isIdentifier(correlation.modelRole) ? correlation.modelRole : null,
    purpose: M1_MODEL_PURPOSES.has(correlation.purpose)
      ? correlation.purpose
      : null,
  };
}

function validatePolicyBoundary(token, options = {}) {
  if (!isPlainRecord(options)) {
    throw new LLMGatewayError(
      LLMGatewayErrorCode.INVALID_REQUEST,
      'The model request options must be a plain record.',
    );
  }
  const tokenValidation = validateAuthToken(token);
  if (!tokenValidation.valid) {
    throw new LLMGatewayError(
      LLMGatewayErrorCode.AUTHORIZATION_DENIED,
      'The model request does not have valid authorization.',
    );
  }

  const correlation = options.correlation;
  if (!isPlainRecord(correlation)) {
    throw new LLMGatewayError(
      LLMGatewayErrorCode.INVALID_REQUEST,
      'The model request is missing correlation metadata.',
    );
  }
  const keys = Object.keys(correlation).sort();
  const expectedKeys = [...M1_CORRELATION_KEYS].sort();
  if (
    keys.length !== expectedKeys.length
    || keys.some((key, index) => key !== expectedKeys[index])
    || !isIdentifier(correlation.requestId)
    || !isIdentifier(correlation.conversationId)
    || !isIdentifier(correlation.turnId)
    || !isIdentifier(correlation.callerRole)
    || !isIdentifier(correlation.modelRole)
    || !M1_MODEL_PURPOSES.has(correlation.purpose)
  ) {
    throw new LLMGatewayError(
      LLMGatewayErrorCode.INVALID_REQUEST,
      'The model request has invalid correlation metadata.',
    );
  }
  if (correlation.callerRole !== token.role) {
    throw new LLMGatewayError(
      LLMGatewayErrorCode.AUTHORIZATION_DENIED,
      'The model request caller does not match its authorization.',
    );
  }
  if (
    typeof options.capability !== 'string'
    || !hasCapability(token, options.capability)
  ) {
    throw new LLMGatewayError(
      LLMGatewayErrorCode.AUTHORIZATION_DENIED,
      'The model request capability is not authorized.',
    );
  }
  for (const forbiddenKey of [
    'vramFitOptions',
    '_vramFitOptions',
    'vramFitProfiles',
    '_vramFitProfiles',
    '_requireVramFit',
  ]) {
    if (Object.prototype.hasOwnProperty.call(options, forbiddenKey)) {
      throw new LLMGatewayError(
        LLMGatewayErrorCode.INVALID_REQUEST,
        'The model request contains a reserved policy option.',
      );
    }
  }
  if (
    Object.prototype.hasOwnProperty.call(options, 'num_ctx')
    && !isPolicyNumCtx(options.num_ctx)
  ) {
    throw new LLMGatewayError(
      LLMGatewayErrorCode.INVALID_REQUEST,
      'The model request has an invalid context size.',
    );
  }
  const effectiveModel = options.model
    ?? config.models?.CHAT
    ?? 'qwen3.5:27b';
  if (!isModelName(effectiveModel)) {
    throw new LLMGatewayError(
      LLMGatewayErrorCode.INVALID_REQUEST,
      'The model request has an invalid model identifier.',
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(options, 'timeout')
    && (!Number.isSafeInteger(options.timeout) || options.timeout < 1)
  ) {
    throw new LLMGatewayError(
      LLMGatewayErrorCode.INVALID_REQUEST,
      'The model request has an invalid timeout.',
    );
  }

  return safeCorrelation(options, token);
}

function trustedVramFitOptions(model) {
  const profiles = llmGateway._vramFitProfiles;
  if (!isPlainRecord(profiles)) return {};
  const key = model.toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(profiles, key)) return {};
  const profile = profiles[key];
  return isPlainRecord(profile) ? profile : {};
}

async function awaitWithAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) {
    throw abortErrorFromSignal(signal, {
      fallbackSource: AbortSource.TIMEOUT,
      message: 'Model preflight cancelled',
    });
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const settle = callback => value => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onAbort = () => settle(reject)(abortErrorFromSignal(signal, {
      fallbackSource: AbortSource.TIMEOUT,
      message: 'Model preflight cancelled',
    }));
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(settle(resolve), settle(reject));
  });
}

// ════════════════════════════════════════════════════════════════════════════
// AUDIT LOG
// ════════════════════════════════════════════════════════════════════════════

class LLMAuditLog {
  constructor() {
    this.logs = [];
    this.maxLogs = 1000;
  }
  
  log(event, data) {
    const entry = {
      timestamp: Date.now(),
      event,
      ...data
    };
    
    this.logs.push(entry);
    
    // Trim if too many
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }
    
    // Also log to standard logger
    if (event === 'UNAUTHORIZED_CALL') {
      logger.error('LLMGateway', `UNAUTHORIZED LLM CALL BLOCKED`, data);
    } else if (event === 'CAPABILITY_DENIED') {
      logger.warn('LLMGateway', `Capability denied: ${data.capability}`, data);
    } else {
      logger.debug('LLMGateway', event, { 
        role: data.role, 
        decisionId: data.decisionId,
        duration: data.duration 
      });
    }
  }
  
  getLogs(since = 0) {
    return this.logs.filter(l => l.timestamp >= since);
  }
  
  getStats() {
    const last5min = Date.now() - 300000;
    const recentLogs = this.logs.filter(l => l.timestamp >= last5min);
    
    return {
      totalCalls: this.logs.filter(l => l.event === 'LLM_CALL_COMPLETE').length,
      recentCalls: recentLogs.filter(l => l.event === 'LLM_CALL_COMPLETE').length,
      unauthorizedAttempts: this.logs.filter(l => l.event === 'UNAUTHORIZED_CALL').length,
      byRole: this.groupByRole(recentLogs)
    };
  }
  
  groupByRole(logs) {
    const byRole = {};
    for (const log of logs) {
      if (log.role) {
        byRole[log.role] = (byRole[log.role] || 0) + 1;
      }
    }
    return byRole;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// LLM GATEWAY
// ════════════════════════════════════════════════════════════════════════════

class LLMGateway {
  constructor() {
    this.currentAuth = null;
    this.audit = new LLMAuditLog();
    this.callCount = 0;

    // Rate limiting
    this.rateLimits = {
      maxCallsPerMinute: 60,
      currentMinuteCalls: 0,
      currentMinuteStart: Date.now()
    };

    // v36.9: Strict mode is NOW DEFAULT — all calls require auth tokens.
    this.strictMode = true;

    // v133: Usage tracking DB (set via setUsageDb)
    this._usageDb = null;

    // Set by server startup after durable binding reconciliation. A degraded
    // startup must not later serve a configured fallback that differs from a
    // durable manual binding merely because the provider came back online.
    this._bindingStartupAuthority = null;
    this._bindingArtifactResolver = null;

    // v125: Concurrency semaphore — gates concurrent LLM calls
    // With single GPU, only 1 call at a time (model swap = 10-30s VRAM load/unload).
    // With multi-GPU, increase maxConcurrentLLM via config.sessions.maxConcurrentLLM.
    this._concurrency = {
      max: config.sessions?.maxConcurrentLLM || 1,
      active: 0,
      queue: [],  // Array of { resolve, reject, timer }
      queueTimeout: config.sessions?.llmQueueTimeout || 300000,
    };

    // Trusted runtime dependency, never populated from ModelRequest options.
    // Empty metadata yields UNKNOWN and lets the provider decide safely.
    this._vramFitProfiles = Object.freeze({});
  }

  /** v133: Set DB for usage tracking */
  setUsageDb(db) { this._usageDb = db; }

  setBindingStartupAuthority(authority, options = {}) {
    if (!authority || !['DURABLE', 'DEGRADED'].includes(authority.status)) {
      throw new TypeError('LLM binding startup authority must be DURABLE or DEGRADED');
    }
    if (authority.status === 'DURABLE' && typeof options.resolveArtifact !== 'function') {
      throw new TypeError('DURABLE LLM binding authority requires an exact artifact resolver');
    }
    this._bindingStartupAuthority = Object.freeze({
      status: authority.status,
      reason: authority.reason || null,
      artifacts: authority.artifacts || Object.freeze({}),
    });
    this._bindingArtifactResolver = typeof options.resolveArtifact === 'function'
      ? options.resolveArtifact
      : null;
  }

  /**
   * v125: Acquire LLM slot (semaphore). Returns immediately if slot available,
   * otherwise queues and waits. Rejects after queueTimeout.
   * @returns {Promise<void>}
   */
  async _acquireSlot(signal = null) {
    if (this._concurrency.active < this._concurrency.max) {
      this._concurrency.active++;
      return;
    }
    if (signal?.aborted) {
      throw abortErrorFromSignal(signal, {
        fallbackSource: AbortSource.USER,
        message: 'LLM call cancelled by user',
      });
    }

    // Queue this caller
    return new Promise((resolve, reject) => {
      const entry = {
        resolve,
        reject,
        timer: null,
        signal,
        abortHandler: null,
        settled: false,
      };
      const cleanup = () => {
        if (entry.timer) clearTimeout(entry.timer);
        if (entry.abortHandler && signal) {
          signal.removeEventListener('abort', entry.abortHandler);
        }
      };
      entry.grant = () => {
        if (entry.settled) return false;
        entry.settled = true;
        cleanup();
        resolve();
        return true;
      };
      entry.rejectOwned = error => {
        if (entry.settled) return false;
        entry.settled = true;
        const idx = this._concurrency.queue.indexOf(entry);
        if (idx !== -1) this._concurrency.queue.splice(idx, 1);
        cleanup();
        reject(error);
        return true;
      };
      entry.timer = setTimeout(() => {
        entry.rejectOwned(
          new LLMGatewayError(
            LLMGatewayErrorCode.QUEUE_TIMEOUT,
            `Timed out waiting ${this._concurrency.queueTimeout}ms for a local model slot.`,
            { retryable: false },
          ),
        );
      }, this._concurrency.queueTimeout);
      if (signal) {
        entry.abortHandler = () => {
          entry.rejectOwned(abortErrorFromSignal(signal, {
            fallbackSource: AbortSource.USER,
            message: 'LLM call cancelled while waiting for a slot',
          }));
        };
        signal.addEventListener('abort', entry.abortHandler, { once: true });
      }
      this._concurrency.queue.push(entry);
    });
  }

  /**
   * v125: Release LLM slot. Grants to next queued caller if any.
   */
  _releaseSlot() {
    while (this._concurrency.queue.length > 0) {
      const next = this._concurrency.queue.shift();
      if (next.grant()) return;
      // A cancelled entry should already be removed, but skip it fail-closed
      // if a same-tick cancellation raced with slot transfer.
    }
    this._concurrency.active = Math.max(0, this._concurrency.active - 1);
  }

  /**
   * v125: Get concurrency stats.
   */
  getConcurrencyStats() {
    return {
      max: this._concurrency.max,
      active: this._concurrency.active,
      queued: this._concurrency.queue.length,
    };
  }
  
  /**
   * Enable strict mode - blocks all unauthorized calls
   */
  enableStrictMode() {
    this.strictMode = true;
    logger.info('LLMGateway', 'Strict mode ENABLED - unauthorized calls will be blocked');
  }
  
  /**
   * Disable strict mode - allows legacy calls with warning
   */
  disableStrictMode() {
    this.strictMode = false;
    logger.warn('LLMGateway', 'Strict mode DISABLED - legacy calls allowed');
  }
  
  /**
   * Authorize a caller to make LLM calls
   * 
   * @param {LLMAuthToken} token
   */
  authorize(token) {
    const validation = validateAuthToken(token);
    
    if (!validation.valid) {
      throw new Error(`Invalid LLM auth token: ${validation.error}`);
    }
    
    this.currentAuth = token;
    
    this.audit.log('LLM_AUTHORIZED', {
      role: token.role,
      decisionId: token.decisionId,
      sessionId: token.auditContext?.sessionId,
      maxTokens: token.maxTokens,
      capabilities: token.allowedCapabilities
    });
  }
  
  /**
   * Revoke current authorization
   */
  revoke() {
    if (this.currentAuth) {
      this.audit.log('LLM_REVOKED', {
        role: this.currentAuth.role,
        decisionId: this.currentAuth.decisionId
      });
    }
    this.currentAuth = null;
  }
  
  /**
   * Check if currently authorized
   * @returns {boolean}
   */
  isAuthorized() {
    if (!this.currentAuth) return false;

    const validation = validateAuthToken(this.currentAuth);
    return validation.valid;
  }

  /**
   * Check if there's an active valid token (for external guards)
   * @returns {boolean}
   */
  hasActiveToken() {
    return this.isAuthorized();
  }
  
  /**
   * Get current auth info (for debugging)
   */
  getCurrentAuth() {
    return this.currentAuth ? {
      role: this.currentAuth.role,
      decisionId: this.currentAuth.decisionId,
      expiresIn: this.currentAuth.expiresAt - Date.now()
    } : null;
  }
  
  /**
   * Check rate limit
   * @returns {{ allowed: boolean, retryAfter?: number }}
   */
  checkRateLimit() {
    const now = Date.now();
    
    // Reset counter if minute has passed
    if (now - this.rateLimits.currentMinuteStart > 60000) {
      this.rateLimits.currentMinuteCalls = 0;
      this.rateLimits.currentMinuteStart = now;
    }
    
    if (this.rateLimits.currentMinuteCalls >= this.rateLimits.maxCallsPerMinute) {
      const retryAfter = 60000 - (now - this.rateLimits.currentMinuteStart);
      return { allowed: false, retryAfter };
    }
    
    return { allowed: true };
  }
  
  /**
   * Main call method - ALL LLM calls go through here
   * 
   * @param {string} prompt - The prompt to send
   * @param {Object} options - Call options
   * @param {string} [options.systemPrompt] - System prompt
   * @param {string} [options.capability] - Required capability for this call
   * @param {string} [options.model] - Model override
   * @param {number} [options.temperature] - Temperature
   * @param {number} [options.maxTokens] - Max tokens
   * @returns {Promise<{content: string, model: string, duration: number}>}
   */
  async call(prompt, options = {}) {
    const startTime = Date.now();

    // ════════════════════════════════════════════════════════════════════════
    // v125: CONCURRENCY SEMAPHORE — wait for LLM slot
    // ════════════════════════════════════════════════════════════════════════
    try {
      await this._acquireSlot(options.signal);
    } catch (error) {
      const authToken = options._authToken || this.currentAuth;
      if (error?.name === 'AbortError' || options.signal?.aborted) {
        const abortSource = abortSourceOf(error, options.signal);
        if (abortSource === AbortSource.TIMEOUT) {
          this.audit.log('LLM_CALL_TIMEOUT', {
            role: authToken?.role,
            decisionId: authToken?.decisionId,
            abortSource,
            timeout: null,
            timeoutOrigin: 'upstream',
            queue: true,
            ...safeCorrelation(options, authToken),
          });
        } else {
          this.audit.log('LLM_CALL_CANCELLED', {
            role: authToken?.role,
            decisionId: authToken?.decisionId,
            abortSource,
            queue: true,
            ...safeCorrelation(options, authToken),
          });
        }
      } else {
        this.audit.log('LLM_QUEUE_TIMEOUT', {
          role: authToken?.role,
          decisionId: authToken?.decisionId,
          queue: true,
          ...safeCorrelation(options, authToken),
        });
      }
      throw error;
    }

    // From this point exactly one outer frame owns the semaphore slot. Keep
    // the existing body layout stable while making every setup/provider throw
    // converge on the same release path.
    try { // semaphore ownership frame

    // ════════════════════════════════════════════════════════════════════════
    // v44.0: INLINE AUTH TOKEN SUPPORT (avoids race condition)
    // ════════════════════════════════════════════════════════════════════════

    // Use inline token if provided, otherwise fall back to singleton
    const authToken = options._authToken || this.currentAuth;
    const isAuthorizedCall = authToken && validateAuthToken(authToken).valid;

    // ════════════════════════════════════════════════════════════════════════
    // AUTHORIZATION CHECK
    // ════════════════════════════════════════════════════════════════════════

    if (!isAuthorizedCall) {
      if (this.strictMode) {
        this.audit.log('UNAUTHORIZED_CALL', {
          promptLength: typeof prompt === 'string' ? prompt.length : null,
          hasInlineToken: !!options._authToken,
          hasSingletonAuth: !!this.currentAuth,
        });
        throw new Error('LLM_CALL_OUTSIDE_CRE: No valid auth token. All LLM calls must go through CRE with proper authorization.');
      } else {
        // Non-strict mode (only for tests)
        logger.warn('LLMGateway', 'Unauthenticated LLM call (non-strict mode)', {
          promptLength: prompt.length
        });
        this.audit.log('UNAUTHENTICATED_CALL', {
          promptLength: prompt.length
        });
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // CAPABILITY CHECK
    // ════════════════════════════════════════════════════════════════════════

    if (authToken && options.capability) {
      if (!hasCapability(authToken, options.capability)) {
        this.audit.log('CAPABILITY_DENIED', {
          role: authToken.role,
          decisionId: authToken.decisionId,
          capability: options.capability,
          allowed: authToken.allowedCapabilities
        });
        throw new Error(`CAPABILITY_NOT_ALLOWED: ${options.capability}`);
      }
    }

    if (this._bindingStartupAuthority?.status === 'DEGRADED') {
      this.audit.log('LLM_BINDING_AUTHORITY_DEGRADED', {
        role: authToken?.role,
        decisionId: authToken?.decisionId,
        reason: this._bindingStartupAuthority.reason,
        ...safeCorrelation(options, authToken),
      });
      throw new LLMGatewayError(
        LLMGatewayErrorCode.PROVIDER_UNAVAILABLE,
        'The local model binding authority is degraded; restart after provider recovery.',
        { retryable: true },
      );
    }

    // ════════════════════════════════════════════════════════════════════════
    // RATE LIMIT CHECK
    // ════════════════════════════════════════════════════════════════════════

    const rateCheck = this.checkRateLimit();
    if (!rateCheck.allowed) {
      this.audit.log('RATE_LIMITED', {
        role: authToken?.role,
        retryAfter: rateCheck.retryAfter
      });
      throw new Error(`RATE_LIMITED: Retry after ${rateCheck.retryAfter}ms`);
    }

    // ════════════════════════════════════════════════════════════════════════
    // DETERMINE LIMITS
    // ════════════════════════════════════════════════════════════════════════

    const effectiveMaxTokens = Math.min(
      options.maxTokens || 4096,
      authToken?.maxTokens || 4096
    );

    // ════════════════════════════════════════════════════════════════════════
    // MAKE THE CALL
    // ════════════════════════════════════════════════════════════════════════

    const model = options.model || config.models?.CHAT || 'qwen3.5:27b';
    const timeout = options.timeout || config.timeouts?.CHAT || 60000;
    const requestType = options.requestType || 'chat';
    const correlation = safeCorrelation(options, authToken);
    const effectiveNumCtx = resolveNumCtx(model, options.num_ctx);
    let expectedArtifact = null;
    if (this._bindingStartupAuthority?.status === 'DURABLE') {
      try {
        expectedArtifact = await this._bindingArtifactResolver({
          modelName: model,
          role: correlation.modelRole,
        });
      } catch (cause) {
        throw new LLMGatewayError(
          LLMGatewayErrorCode.BINDING_ARTIFACT_UNVERIFIED,
          'The requested model is not backed by an exact durable binding.',
          { cause, httpStatus: 503, retryable: false },
        );
      }
      const expectedDigest = normalizeModelDigestSha256(expectedArtifact?.digestSha256);
      if (!expectedDigest
        || typeof expectedArtifact?.modelName !== 'string'
        || !sameModelName(expectedArtifact.modelName, model)) {
        throw new LLMGatewayError(
          LLMGatewayErrorCode.BINDING_ARTIFACT_UNVERIFIED,
          'The requested model is not backed by an exact durable binding.',
          { httpStatus: 503, retryable: false },
        );
      }
      expectedArtifact = Object.freeze({
        modelName: expectedArtifact.modelName.trim(),
        digestSha256: expectedDigest,
      });
    }

    const emitRuntimeSignal = (signalType, success, extra = {}) => {
      try {
        modelUniverseStore.recordSignalEvent({
          modelName: model,
          role: authToken?.role || 'UNKNOWN',
          signalType,
          success,
          latencyMs: extra.latencyMs ?? (Date.now() - startTime),
          errorType: extra.errorType || null,
          payload: {
            requestType,
            attempt: extra.attempt ?? null,
            timeoutMs: extra.timeoutMs !== undefined ? extra.timeoutMs : timeout,
            timeoutOrigin: extra.timeoutOrigin || null,
            promptLength: prompt?.length ?? 0,
            outputLength: extra.outputLength ?? null,
            queueDepth: this._concurrency.queue.length,
            correlation,
          },
          scheduleRecompute: extra.scheduleRecompute !== false,
        });
      } catch (_) {
        // Signal ingestion must never break core LLM path.
      }
    };

    // Build messages (support pre-built array via options.messages)
    const messages = options.messages || (() => {
      const msgs = [];
      if (options.systemPrompt) {
        msgs.push({ role: 'system', content: options.systemPrompt });
      }
      msgs.push({ role: 'user', content: prompt });
      return msgs;
    })();

    const body = {
      model,
      messages,
      stream: false,
      // Disable extended thinking mode (qwen3.5 puts output in thinking field, leaving content empty)
      think: false,
      options: {
        temperature: options.temperature ?? 0.3,
        top_p: options.top_p ?? 0.75,
        repeat_penalty: options.repeat_penalty ?? 1.1,
        num_predict: effectiveMaxTokens,
        // v72: Allow callers to override context window size (e.g. 1024 for classification)
        // Dynamic default from model-ctx registry (VRAM-optimized per model, set at startup)
        num_ctx: effectiveNumCtx,
      }
    };

    // Pass format through if specified (e.g. 'json' for structured output)
    if (options.format) {
      body.format = options.format;
    }

    let lastError;
    // Per-call override. A caller with an immediate fallback (intent
    // classification) gains nothing from retrying a refused connection,
    // so it asks for a single attempt. Slow models are unaffected: a
    // timeout is never retried regardless of this value.
    const maxRetries = Number.isInteger(options.retries) && options.retries > 0
      ? options.retries
      : (config.ollama?.retries || 3);

    // Preserve cancellation precedence if the signal changes after the queue
    // grants a slot but before provider ownership begins. A concurrent model
    // mutation must not replace the caller's canonical abort outcome.
    if (options.signal?.aborted) {
      const abortSource = abortSourceOf(options.signal.reason, options.signal);
      if (abortSource === AbortSource.TIMEOUT) {
        this.audit.log('LLM_CALL_TIMEOUT', {
          role: authToken?.role,
          decisionId: authToken?.decisionId,
          abortSource,
          timeout: null,
          timeoutOrigin: 'upstream',
          queue: false,
          ...correlation,
        });
        emitRuntimeSignal('runtime_timeout', false, {
          attempt: 0,
          errorType: 'timeout',
          timeoutMs: null,
          timeoutOrigin: 'upstream',
        });
      } else {
        this.audit.log('LLM_CALL_CANCELLED', {
          role: authToken?.role,
          decisionId: authToken?.decisionId,
          abortSource,
          queue: false,
          ...correlation,
        });
        emitRuntimeSignal('runtime_cancelled', null, {
          attempt: 0,
          errorType: 'user_cancel',
          scheduleRecompute: false,
        });
      }
      throw abortErrorFromSignal(options.signal, {
        fallbackSource: AbortSource.USER,
        message: abortSource === AbortSource.USER
          ? 'LLM call cancelled by user'
          : 'LLM call cancelled before provider ownership',
      });
    }

    // A queued call does not own the model. Once the semaphore grants a slot,
    // hold one shared lease across every provider attempt and retry delay so a
    // pull/delete mutation cannot invalidate the artifact mid-request.
    const modelLease = modelUseAuthority.acquireShared({
      modelName: model,
      owner: MODEL_ACTIVITY_OWNER.LLM_GATEWAY,
    });

    try { // model-use ownership frame
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let timeoutId;
      let userSignal;
      let userAbortHandler;
      try {
        const controller = new AbortController();
        timeoutId = setTimeout(
          () => abortWithReason(
            controller,
            AbortSource.TIMEOUT,
            `LLM timeout after ${timeout}ms (model: ${model})`,
          ),
          timeout,
        );

        // v63.0: Connect user cancel signal to LLM abort controller
        // When the user disconnects (req.on('close')), abort the LLM call too
        userSignal = options.signal;
        if (userSignal) {
          if (userSignal.aborted) {
            clearTimeout(timeoutId);
            throw abortErrorFromSignal(userSignal, {
              fallbackSource: AbortSource.USER,
              message: 'LLM call cancelled by user',
            });
          }
          userAbortHandler = () => {
            if (!controller.signal.aborted) {
              controller.abort(abortErrorFromSignal(userSignal, {
                fallbackSource: AbortSource.USER,
                message: 'LLM call cancelled by user',
              }));
            }
          };
          userSignal.addEventListener('abort', userAbortHandler, { once: true });
        }

        if (expectedArtifact) {
          const beforeDigest = await resolveCurrentArtifactDigest(
            config.ollama?.baseUrl || 'http://127.0.0.1:11434',
            model,
            controller.signal,
          );
          if (beforeDigest !== expectedArtifact.digestSha256) {
            throw new LLMGatewayError(
              LLMGatewayErrorCode.BINDING_ARTIFACT_DRIFT,
              'The bound local model digest changed before the provider request.',
              { httpStatus: 503, retryable: false },
            );
          }
        }

        const response = await fetch(`${config.ollama?.baseUrl || 'http://127.0.0.1:11434'}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal
        });

        if (!response.ok) {
          // Never put the provider body in logs or a public error: model
          // servers can echo prompt fragments. Cancel rather than buffering an
          // attacker-controlled response size.
          try { await response.body?.cancel?.(); } catch { /* status is authoritative */ }
          throw providerHttpError(response.status);
        }

        let data;
        try {
          data = await response.json();
        } catch (cause) {
          if (controller.signal.aborted) {
            throw abortErrorFromSignal(controller.signal, {
              fallbackSource: AbortSource.TIMEOUT,
              message: `LLM timeout after ${timeout}ms (model: ${model})`,
            });
          }
          throw new LLMGatewayError(
            LLMGatewayErrorCode.MALFORMED_RESPONSE,
            'The local model provider returned malformed JSON.',
            { cause },
          );
        }
        const output = parseProviderOutput(data);
        const servedModel = typeof data.model === 'string' && data.model.trim()
          ? data.model.trim()
          : model;
        if (expectedArtifact && !sameModelName(servedModel, expectedArtifact.modelName)) {
          throw new LLMGatewayError(
            LLMGatewayErrorCode.BINDING_ARTIFACT_DRIFT,
            'The local provider served a different model binding.',
            { httpStatus: 503, retryable: false },
          );
        }
        const servedDigest = normalizeModelDigestSha256(
          data?.digest || data?.model_digest_sha256,
        );
        if (expectedArtifact && !servedDigest) {
          throw new LLMGatewayError(
            LLMGatewayErrorCode.BINDING_ARTIFACT_UNVERIFIED,
            'The local provider response does not identify the serving artifact digest.',
            { httpStatus: 503, retryable: false },
          );
        }
        if (expectedArtifact && servedDigest !== expectedArtifact.digestSha256) {
          throw new LLMGatewayError(
            LLMGatewayErrorCode.BINDING_ARTIFACT_DRIFT,
            'The local provider response cannot be bound to the expected artifact digest.',
            { httpStatus: 503, retryable: false },
          );
        }
        const duration = Date.now() - startTime;

        // Update rate limit counter
        this.rateLimits.currentMinuteCalls++;
        this.callCount++;

        // Audit successful call
        this.audit.log('LLM_CALL_COMPLETE', {
          role: authToken?.role || 'UNKNOWN',
          decisionId: authToken?.decisionId,
          sessionId: authToken?.auditContext?.sessionId,
          model,
          promptLength: prompt.length,
          outputLength: output.length,
          duration,
          attempt,
          ...correlation,
        });

        // v133: Usage tracking for auto-cleanup decisions
        if (this._usageDb) {
          try {
            const usageRole = authToken?.role || 'UNKNOWN';
            // A desired binding is intent, not evidence of which artifact
            // actually served this request. Persist a digest only when the
            // provider response itself identifies it exactly; otherwise NULL
            // preserves the fail-closed retention boundary during a rebind.
            this._usageDb.prepare(
              'INSERT INTO model_usage (model, role, request_type, model_digest_sha256) VALUES (?, ?, ?, ?)'
            ).run(servedModel, usageRole, requestType, servedDigest);
          } catch (_) {}
        }

        emitRuntimeSignal('runtime', true, {
          attempt,
          outputLength: output.length,
          latencyMs: duration,
        });

        return {
          content: output,
          model,
          modelDigestSha256: servedDigest,
          duration,
          role: authToken?.role,
          finishReason: typeof data.done_reason === 'string'
            ? data.done_reason
            : null,
          promptEvalCount: data.prompt_eval_count || null,
          evalCount: data.eval_count || null,
        };

      } catch (err) {
        lastError = err;

        // v63.0: Distinguish abort sources for proper handling
        if (err.name === 'AbortError' || err.name === 'TimeoutError') {
          const userSignal = options.signal;
          const abortSource = abortSourceOf(
            err,
            userSignal,
            userSignal?.aborted ? AbortSource.USER : AbortSource.TIMEOUT,
          );
          if (abortSource === AbortSource.USER) {
            // User cancelled (frontend disconnect / cancel button)
            logger.info('LLMGateway', `User cancelled LLM call (attempt ${attempt}/${maxRetries})`, {
              abortSource: 'user_cancel',
              sessionId: authToken?.auditContext?.sessionId,
            });
            // Don't retry on user cancel — break immediately
            this.audit.log('LLM_CALL_CANCELLED', {
              role: authToken?.role,
              decisionId: authToken?.decisionId,
              abortSource: 'user_cancel',
              ...correlation,
            });
            emitRuntimeSignal('runtime_cancelled', null, {
              attempt,
              errorType: 'user_cancel',
              scheduleRecompute: false,
            });
            throw abortErrorFromSignal(userSignal, {
              fallbackSource: AbortSource.USER,
              message: 'LLM call cancelled by user',
            });
          } else {
            const timeoutOrigin = userSignal?.aborted
              ? 'upstream'
              : 'gateway';
            const effectiveTimeoutMs = timeoutOrigin === 'gateway' ? timeout : null;
            // v82.2: Timeout — DON'T RETRY. The model is working, just slow.
            // Retrying on timeout doubles the total time (60s+2s+60s > 90s test timeout).
            // This was the root cause of 5 E2E test timeouts.
            logger.warn('LLMGateway', timeoutOrigin === 'gateway'
              ? `Timeout after ${timeout}ms — not retrying (model is working, just slow)`
              : 'Upstream request deadline elapsed — not retrying', {
              abortSource: 'timeout',
              timeoutOrigin,
              timeoutMs: effectiveTimeoutMs,
              model,
            });
            this.audit.log('LLM_CALL_TIMEOUT', {
              role: authToken?.role,
              decisionId: authToken?.decisionId,
              timeout: effectiveTimeoutMs,
              timeoutOrigin,
              model,
              ...correlation,
            });
            emitRuntimeSignal('runtime_timeout', false, {
              attempt,
              errorType: 'timeout',
              latencyMs: Date.now() - startTime,
              timeoutMs: effectiveTimeoutMs,
              timeoutOrigin,
            });
            throw abortErrorFromSignal(userSignal, {
              fallbackSource: AbortSource.TIMEOUT,
              message: `LLM timeout after ${timeout}ms (model: ${model})`,
            });
          }
        } else if (
          err instanceof LLMGatewayError
          && [
            LLMGatewayErrorCode.BINDING_ARTIFACT_UNVERIFIED,
            LLMGatewayErrorCode.BINDING_ARTIFACT_DRIFT,
          ].includes(err.code)
        ) {
          this.audit.log('LLM_BINDING_ARTIFACT_REJECTED', {
            role: authToken?.role,
            decisionId: authToken?.decisionId,
            model,
            errorCode: err.code,
            ...correlation,
          });
          emitRuntimeSignal('runtime_failed', false, {
            attempt,
            errorType: err.code,
            latencyMs: Date.now() - startTime,
          });
          throw err;
        } else if (
          err instanceof LLMGatewayError
          && err.code === LLMGatewayErrorCode.PROVIDER_UNAVAILABLE
          && err.httpStatus === 503
        ) {
          // HTTP 503 does not prove OOM. Preserve the exact provider failure
          // and do not retry it in either legacy or v1 policy.
          logger.error('LLMGateway', 'Local model provider unavailable (503) — not retrying', { model });
          this.audit.log('LLM_CALL_PROVIDER_ERROR', {
            role: authToken?.role,
            decisionId: authToken?.decisionId,
            model,
            errorCode: err.code,
            httpStatus: err.httpStatus,
            ...correlation,
          });
          emitRuntimeSignal('runtime_failed', false, {
            attempt,
            errorType: err.code,
            latencyMs: Date.now() - startTime,
          });
          throw err;
        } else if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
          // Network errors — retry makes sense (Ollama may be starting/restarting)
          logger.warn('LLMGateway', `Network error (attempt ${attempt}/${maxRetries}): ${err.code}`, {
            abortSource: 'network',
          });
        } else {
          const normalizedError = normalizeProviderFailure(err);
          logger.warn('LLMGateway', `Provider attempt ${attempt}/${maxRetries} failed`, {
            errorCode: normalizedError?.code || err?.name || 'LLM_PROVIDER_FAILURE',
          });
        }

        if (attempt < maxRetries) {
          await this.sleep((config.ollama?.retryDelay || 1000) * attempt);
        }
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        if (userAbortHandler && userSignal) {
          userSignal.removeEventListener('abort', userAbortHandler);
        }
      }
    }

    const normalizedLastError = normalizeProviderFailure(lastError);
    this.audit.log('LLM_CALL_FAILED', {
      role: authToken?.role,
      decisionId: authToken?.decisionId,
      errorCode: normalizedLastError?.code || lastError?.name || 'LLM_CALL_FAILED',
      ...correlation,
    });
    emitRuntimeSignal('runtime_failed', false, {
      attempt: maxRetries,
      errorType: normalizedLastError?.code || lastError?.name || 'runtime_failed',
      latencyMs: Date.now() - startTime,
    });

    throw new Error(
      `LLM failed after ${maxRetries} attempts: ${lastError?.message}`,
      { cause: lastError },
    );
  } finally { // model-use ownership frame
    modelLease.release();
  }
    } finally { // semaphore ownership frame
      this._releaseSlot();
    }
  }
  
  /**
   * Helper for sleep
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Get audit stats
   */
  getStats() {
    return {
      ...this.audit.getStats(),
      totalCallCount: this.callCount,
      strictMode: this.strictMode,
      currentAuth: this.getCurrentAuth(),
      concurrency: this.getConcurrencyStats(),
    };
  }
  
  /**
   * Get audit logs
   */
  getAuditLogs(since = 0) {
    return this.audit.getLogs(since);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ════════════════════════════════════════════════════════════════════════════

// Global singleton - THE ONLY way to call LLM
export const llmGateway = new LLMGateway();

// ════════════════════════════════════════════════════════════════════════════
// CONVENIENCE FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Call LLM with auth token (convenience wrapper)
 * Use this in places that have their own auth token
 *
 * v44.0: Pass token directly to call() to avoid race conditions with singleton
 */
export async function callWithAuth(token, prompt, options = {}) {
  // v44.0: Pass token in options to avoid singleton race condition
  return await llmGateway.call(prompt, {
    ...options,
    _authToken: token
  });
}

/**
 * M1 policy boundary. One connector request produces at most one provider
 * effect; legacy callers keep their existing retry policy through
 * callWithAuth(). Precise provider failures are unwrapped for the M1 adapter.
 */
export async function callWithPolicy(token, prompt, options = {}) {
  if (!isPlainRecord(options)) {
    throw new LLMGatewayError(
      LLMGatewayErrorCode.INVALID_REQUEST,
      'The model request options must be a plain record.',
    );
  }
  // Snapshot own values once. Prototype properties and changing getters must
  // never make preflight inspect a different request than the provider sees.
  const policyOptions = { ...options };
  validatePolicyBoundary(token, policyOptions);
  const model = policyOptions.model ?? config.models?.CHAT ?? 'qwen3.5:27b';
  const numCtx = resolveNumCtx(model, policyOptions.num_ctx);
  if (!isPolicyNumCtx(numCtx)) {
    throw new LLMGatewayError(
      LLMGatewayErrorCode.INVALID_REQUEST,
      'The model request has an invalid effective context size.',
    );
  }
  const timeoutBudget = policyOptions.timeout ?? config.timeouts?.CHAT ?? 60000;
  const correlation = safeCorrelation(policyOptions, token);
  const preflightStartedAt = Date.now();
  const preflightController = new AbortController();
  const upstreamSignal = policyOptions.signal;
  let upstreamAbortHandler = null;
  if (upstreamSignal?.aborted) {
    const error = abortErrorFromSignal(upstreamSignal, {
      fallbackSource: AbortSource.USER,
      message: 'Model request cancelled before preflight',
    });
    const abortSource = abortSourceOf(error, upstreamSignal, AbortSource.USER);
    llmGateway.audit.log(
      abortSource === AbortSource.TIMEOUT
        ? 'LLM_CALL_TIMEOUT'
        : 'LLM_CALL_CANCELLED',
      {
        role: token.role,
        decisionId: token.decisionId,
        abortSource,
        timeout: abortSource === AbortSource.TIMEOUT ? timeoutBudget : null,
        timeoutOrigin: abortSource === AbortSource.TIMEOUT ? 'preflight' : null,
        preflight: true,
        ...correlation,
      },
    );
    throw error;
  }
  if (upstreamSignal) {
    upstreamAbortHandler = () => {
      if (!preflightController.signal.aborted) {
        preflightController.abort(abortErrorFromSignal(upstreamSignal, {
          fallbackSource: AbortSource.USER,
          message: 'Model request cancelled during preflight',
        }));
      }
    };
    upstreamSignal.addEventListener('abort', upstreamAbortHandler, { once: true });
  }
  const preflightTimer = setTimeout(() => abortWithReason(
    preflightController,
    AbortSource.TIMEOUT,
    `Model preflight timeout after ${timeoutBudget}ms`,
  ), timeoutBudget);

  let vramFit;
  try {
    vramFit = await awaitWithAbort(
      fitsVram(model, {
        ...trustedVramFitOptions(model),
        numCtx,
      }),
      preflightController.signal,
    );
    if (upstreamSignal?.aborted) {
      throw abortErrorFromSignal(upstreamSignal, {
        fallbackSource: AbortSource.USER,
        message: 'Model request cancelled during preflight',
      });
    }
    if (Date.now() - preflightStartedAt >= timeoutBudget) {
      throw abortErrorFromSignal(preflightController.signal, {
        fallbackSource: AbortSource.TIMEOUT,
        message: `Model preflight timeout after ${timeoutBudget}ms`,
      });
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      const abortSource = abortSourceOf(error, upstreamSignal, AbortSource.TIMEOUT);
      llmGateway.audit.log(
        abortSource === AbortSource.TIMEOUT
          ? 'LLM_CALL_TIMEOUT'
          : 'LLM_CALL_CANCELLED',
        {
          role: token.role,
          decisionId: token.decisionId,
          abortSource,
          timeout: abortSource === AbortSource.TIMEOUT ? timeoutBudget : null,
          timeoutOrigin: abortSource === AbortSource.TIMEOUT ? 'preflight' : null,
          preflight: true,
          ...correlation,
        },
      );
    }
    throw error;
  } finally {
    clearTimeout(preflightTimer);
    if (upstreamAbortHandler && upstreamSignal) {
      upstreamSignal.removeEventListener('abort', upstreamAbortHandler);
    }
  }

  if (vramFit.state === VramFitState.NONFIT) {
    llmGateway.audit.log('LLM_CALL_VRAM_NON_FIT', {
      role: token.role,
      decisionId: token.decisionId,
      model,
      errorCode: LLMGatewayErrorCode.MODEL_VRAM_NON_FIT,
      vramReason: vramFit.reason,
      requiredMb: vramFit.requiredMb,
      totalMb: vramFit.totalMb,
      freeMb: vramFit.freeMb,
      reserveMb: vramFit.reserveMb,
      ...correlation,
    });
    throw new LLMGatewayError(
      LLMGatewayErrorCode.MODEL_VRAM_NON_FIT,
      'The selected model cannot fit in the trusted GPU capacity observation.',
      { retryable: false },
    );
  }
  if (vramFit.state === VramFitState.UNKNOWN) {
    llmGateway.audit.log('LLM_VRAM_PREFLIGHT_UNKNOWN', {
      role: token.role,
      decisionId: token.decisionId,
      model,
      vramReason: vramFit.reason,
      requiredMb: vramFit.requiredMb,
      totalMb: vramFit.totalMb,
      freeMb: vramFit.freeMb,
      reserveMb: vramFit.reserveMb,
      ...correlation,
    });
  }

  const elapsedPreflightMs = Date.now() - preflightStartedAt;
  const remainingTimeoutMs = Math.max(1, timeoutBudget - elapsedPreflightMs);
  try {
    return await llmGateway.call(prompt, {
      ...policyOptions,
      model,
      num_ctx: numCtx,
      timeout: remainingTimeoutMs,
      retries: 1,
      _authToken: token,
    });
  } catch (error) {
    throw normalizeProviderFailure(error);
  }
}

export default {
  llmGateway,
  callWithAuth,
  callWithPolicy,
};
