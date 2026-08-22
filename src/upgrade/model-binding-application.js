// One truthful manual model-binding application boundary.
//
// The repository owns durable intent and terminal outcomes. This service owns
// the provider/runtime effects which connect that intent to the running
// product. Automatic failover, proof issuance and scheduling are deliberately
// absent.

import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { logger as defaultLogger } from '../core/logger.js';
import {
  canonicalModelName,
  normalizeModelDigestSha256,
  sameModelName,
} from './model-identity.js';
import {
  MODEL_ACTIVITY_OWNER,
  modelUseAuthority,
} from './model-use-authority.js';

const LOCAL_PROVIDER_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const PROVIDER_CLAIM_HEARTBEAT_MS = 60 * 1000;
const RUNTIME_FAILURE_CODES = new Set([
  'MODEL_BINDING_PROVIDER_UNAVAILABLE',
  'MODEL_BINDING_TARGET_NOT_INSTALLED',
  'MODEL_BINDING_TARGET_DIGEST_MISSING',
  'MODEL_BINDING_TARGET_DIGEST_DRIFT',
  'MODEL_BINDING_RUNTIME_GUARD_REJECTED',
  'MODEL_BINDING_RUNTIME_COMMIT_FAILED',
]);

export class ModelBindingApplicationError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'ModelBindingApplicationError';
    this.code = code;
    this.details = options.details || null;
    this.httpStatus = options.httpStatus || null;
  }
}

function fail(code, message, details = null, httpStatus = null) {
  throw new ModelBindingApplicationError(code, message, { details, httpStatus });
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireExactInput(value, allowed) {
  if (!isPlainObject(value)) {
    fail('MODEL_BINDING_APPLICATION_INPUT_INVALID', 'Binding application input must be a plain object');
  }
  const unexpected = Object.keys(value).filter(key => !allowed.includes(key)).sort();
  if (unexpected.length > 0) {
    fail(
      'MODEL_BINDING_APPLICATION_AUTHORITY_OVERRIDE_REJECTED',
      'Binding application input contains unknown or authority-owned fields',
      { fields: unexpected },
    );
  }
  return value;
}

// Decision 022/A: recovery identity is compared exactly. Trimming or
// canonicalising it here would let a request that does not match what the user
// was warned about still look valid.
const ROLLBACK_SILENT_FAILURE_CODES = new Set([
  'MODEL_BINDING_ROLLBACK_IDENTITY_INVALID',
  'MODEL_BINDING_ROLLBACK_STALE_OPERATION',
]);

function requireExactIdentityString(value, field, { min = 16, max = 128 } = {}) {
  if (typeof value !== 'string'
    || value !== value.trim()
    || value.length < min
    || value.length > max) {
    fail(
      'MODEL_BINDING_ROLLBACK_IDENTITY_INVALID',
      `${field} must be an exact identity string`,
      { field },
      400,
    );
  }
  return value;
}

function requireExactIdentityRevision(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(
      'MODEL_BINDING_ROLLBACK_IDENTITY_INVALID',
      `${field} must be a positive safe integer`,
      { field },
      400,
    );
  }
  return value;
}

function requireExactIdentityAttemptRevision(value, field) {
  // Zero is the "no attempt recorded yet" revision; the recovery surface always
  // names a real failed verification, so it is never zero there.
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(
      'MODEL_BINDING_ROLLBACK_IDENTITY_INVALID',
      `${field} must be a non-negative safe integer`,
      { field },
      400,
    );
  }
  return value;
}

function requireExactRole(value) {
  if (typeof value !== 'string'
    || value !== value.trim().toUpperCase()
    || !value
    || value.length > 16) {
    fail(
      'MODEL_BINDING_ROLLBACK_IDENTITY_INVALID',
      'role must be an exact role identifier',
      { field: 'role' },
      400,
    );
  }
  return value;
}

function requireString(value, field, max = 512) {
  if (typeof value !== 'string') {
    fail('MODEL_BINDING_APPLICATION_INPUT_INVALID', `${field} must be a string`, { field });
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    fail('MODEL_BINDING_APPLICATION_INPUT_INVALID', `${field} has an invalid length`, { field });
  }
  return normalized;
}

function requireDigest(value, field = 'digestSha256') {
  const digest = requireString(value, field, 64);
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    fail('MODEL_BINDING_TARGET_DIGEST_MISSING', `${field} must be lowercase SHA-256`, { field });
  }
  return digest;
}

function requireLocalProviderBaseUrl(value) {
  if (typeof value !== 'string') {
    fail('MODEL_BINDING_PROVIDER_URL_INVALID', 'Ollama provider URL must be a string');
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail('MODEL_BINDING_PROVIDER_URL_INVALID', 'Ollama provider URL is invalid');
  }
  if (parsed.protocol !== 'http:'
    || !LOCAL_PROVIDER_HOSTS.has(parsed.hostname)
    || parsed.username
    || parsed.password
    || parsed.port === '0'
    || parsed.origin !== value.replace(/\/$/, '')
    || (parsed.pathname !== '/' && parsed.pathname !== '')) {
    fail(
      'MODEL_BINDING_PROVIDER_URL_INVALID',
      'Manual binding provider must be an uncredentialed loopback HTTP origin',
      { origin: parsed.origin },
    );
  }
  return parsed.origin;
}

function asApplicationError(error, fallbackCode, fallbackMessage, details = null) {
  if (error instanceof ModelBindingApplicationError) return error;
  if (typeof error?.code === 'string' && error.code.startsWith('MODEL_')) return error;
  return new ModelBindingApplicationError(fallbackCode, fallbackMessage, {
    cause: error,
    details: { ...details, causeMessage: error?.message || String(error) },
  });
}

function runtimeFailureCode(error) {
  if (RUNTIME_FAILURE_CODES.has(error?.code)) return error.code;
  if (error?.code === 'MODEL_BINDING_RUNTIME_GUARD_REJECTED') {
    return 'MODEL_BINDING_RUNTIME_GUARD_REJECTED';
  }
  if (error?.code === 'MODEL_BINDING_TARGET_NOT_INSTALLED') {
    return 'MODEL_BINDING_TARGET_NOT_INSTALLED';
  }
  if (error?.code === 'MODEL_BINDING_TARGET_DIGEST_MISSING') {
    return 'MODEL_BINDING_TARGET_DIGEST_MISSING';
  }
  if (error?.code === 'MODEL_BINDING_TARGET_DIGEST_DRIFT'
    || error?.code === 'MODEL_BINDING_TARGET_AMBIGUOUS') {
    return 'MODEL_BINDING_TARGET_DIGEST_DRIFT';
  }
  if (error?.code === 'MODEL_BINDING_PROVIDER_UNAVAILABLE') {
    return 'MODEL_BINDING_PROVIDER_UNAVAILABLE';
  }
  return 'MODEL_BINDING_RUNTIME_COMMIT_FAILED';
}

function rehydrateFailureCode(error) {
  if (error?.code === 'MODEL_BINDING_PROVIDER_UNAVAILABLE') {
    return 'MODEL_BINDING_REHYDRATE_TARGET_UNAVAILABLE';
  }
  if (error?.code === 'MODEL_BINDING_TARGET_NOT_INSTALLED') {
    return 'MODEL_BINDING_REHYDRATE_TARGET_UNAVAILABLE';
  }
  if (error?.code === 'MODEL_BINDING_TARGET_DIGEST_MISSING'
    || error?.code === 'MODEL_BINDING_TARGET_DIGEST_DRIFT'
    || error?.code === 'MODEL_BINDING_TARGET_AMBIGUOUS') {
    return 'MODEL_BINDING_REHYDRATE_DIGEST_DRIFT';
  }
  return 'MODEL_BINDING_REHYDRATE_RUNTIME_COMMIT_FAILED';
}

function verificationFailureCode(error) {
  if (error?.code === 'MODEL_BINDING_PROVIDER_UNAVAILABLE') {
    return 'MODEL_BINDING_VERIFICATION_PROVIDER_UNAVAILABLE';
  }
  if (error?.code === 'MODEL_BINDING_TARGET_DIGEST_MISSING'
    || error?.code === 'MODEL_BINDING_TARGET_DIGEST_DRIFT'
    || error?.code === 'MODEL_BINDING_TARGET_AMBIGUOUS'
    || error?.code === 'MODEL_BINDING_TARGET_NOT_INSTALLED') {
    return 'MODEL_BINDING_VERIFICATION_DIGEST_DRIFT';
  }
  return 'MODEL_BINDING_VERIFICATION_REJECTED';
}

function providerPullFailureCode(error) {
  const allowed = new Set([
    'MODEL_BINDING_PROVIDER_UNAVAILABLE',
    'MODEL_BINDING_PROVIDER_PULL_FAILED',
    'MODEL_BINDING_TARGET_NOT_INSTALLED',
    'MODEL_BINDING_TARGET_DIGEST_MISSING',
    'MODEL_BINDING_TARGET_AMBIGUOUS',
    'MODEL_BINDING_TARGET_DIGEST_DRIFT',
  ]);
  return allowed.has(error?.code)
    ? error.code
    : 'MODEL_BINDING_PROVIDER_PULL_FAILED';
}

function publicApplicationState(state) {
  if (!state || state.runtimeFinalizeStatus !== 'UNKNOWN') return state;
  return {
    ...state,
    state: 'PENDING',
    runtimeStatus: 'NOT_APPLIED',
    verificationStatus: 'NOT_VERIFIED',
    failurePhase: null,
    failureCode: null,
    notificationStatus: 'NOT_RECORDED',
    notificationFailureCode: null,
  };
}

function defaultDelay(ms) {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

export class OllamaModelBindingProvider {
  constructor(options = {}) {
    if (!isPlainObject(options)) {
      fail('MODEL_BINDING_PROVIDER_OPTIONS_INVALID', 'Provider options must be a plain object');
    }
    // Keep startup available when the optional provider is misconfigured.
    // The strict loopback contract is evaluated immediately before the first
    // provider effect, not while composing an otherwise offline server.
    this.baseUrl = options.baseUrl || config.ollama?.baseUrl || 'http://127.0.0.1:11434';
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      fail('MODEL_BINDING_PROVIDER_OPTIONS_INVALID', 'Provider fetch implementation is required');
    }
    this.pullImpl = options.pullImpl || null;
    if (this.pullImpl !== null && typeof this.pullImpl !== 'function') {
      fail('MODEL_BINDING_PROVIDER_OPTIONS_INVALID', 'Provider pull implementation must be a function');
    }
    this.inventoryTimeoutMs = options.inventoryTimeoutMs ?? 15_000;
    this.verifyTimeoutMs = options.verifyTimeoutMs ?? 90_000;
  }

  getOrigin() {
    return requireLocalProviderBaseUrl(this.baseUrl);
  }

  async listInstalled() {
    const baseUrl = requireLocalProviderBaseUrl(this.baseUrl);
    let response;
    try {
      response = await this.fetchImpl(`${baseUrl}/api/tags`, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(this.inventoryTimeoutMs),
      });
    } catch (error) {
      throw new ModelBindingApplicationError(
        'MODEL_BINDING_PROVIDER_UNAVAILABLE',
        'Ollama model inventory is unavailable',
        { cause: error },
      );
    }
    if (!response?.ok) {
      fail(
        'MODEL_BINDING_PROVIDER_UNAVAILABLE',
        `Ollama model inventory failed with HTTP ${response?.status ?? 'unknown'}`,
      );
    }
    let body;
    try {
      body = await response.json();
    } catch (error) {
      throw new ModelBindingApplicationError(
        'MODEL_BINDING_PROVIDER_UNAVAILABLE',
        'Ollama model inventory is not valid JSON',
        { cause: error },
      );
    }
    if (!isPlainObject(body) || !Array.isArray(body.models)) {
      fail('MODEL_BINDING_PROVIDER_UNAVAILABLE', 'Ollama model inventory has an invalid shape');
    }
    return body.models.map(model => ({
      name: typeof model?.name === 'string' ? model.name.trim() : '',
      canonicalName: canonicalModelName(model?.name),
      digestSha256: normalizeModelDigestSha256(model?.digest) || '',
    }));
  }

  resolveFromInventory(inventoryValue, modelName, options = {}) {
    if (!Array.isArray(inventoryValue)) {
      fail('MODEL_BINDING_PROVIDER_UNAVAILABLE', 'Ollama inventory snapshot is invalid');
    }
    const requestedModel = requireString(modelName, 'modelName');
    const requestedCanonical = canonicalModelName(requestedModel);
    if (!requestedCanonical) {
      fail('MODEL_BINDING_APPLICATION_INPUT_INVALID', 'modelName has no canonical identity');
    }
    const expectedDigest = options.expectedDigestSha256 === undefined
      ? null
      : requireDigest(options.expectedDigestSha256, 'expectedDigestSha256');
    const matches = inventoryValue.filter(model => model.canonicalName === requestedCanonical);
    if (matches.length === 0) {
      fail(
        'MODEL_BINDING_TARGET_NOT_INSTALLED',
        `Model not installed in Ollama: ${requestedModel}`,
        { modelName: requestedModel },
        404,
      );
    }
    if (matches.length !== 1) {
      fail(
        'MODEL_BINDING_TARGET_AMBIGUOUS',
        `Multiple installed artifacts share the model identity: ${requestedModel}`,
        { modelName: requestedModel, matches: matches.map(model => model.name).sort() },
      );
    }
    const match = matches[0];
    if (!/^[0-9a-f]{64}$/.test(match.digestSha256)) {
      fail(
        'MODEL_BINDING_TARGET_DIGEST_MISSING',
        `Installed model has no exact SHA-256 digest: ${match.name}`,
        { modelName: match.name },
      );
    }
    if (expectedDigest && match.digestSha256 !== expectedDigest) {
      fail(
        'MODEL_BINDING_TARGET_DIGEST_DRIFT',
        `Installed model digest changed for ${match.name}`,
        { modelName: match.name, expectedDigestSha256: expectedDigest },
      );
    }
    return Object.freeze(match);
  }

  async resolveExact(modelName, options = {}) {
    const installed = await this.listInstalled();
    return this.resolveFromInventory(installed, modelName, options);
  }

  async pull(modelName, onProgress) {
    const requestedModel = requireString(modelName, 'modelName');
    if (!this.pullImpl) {
      fail(
        'MODEL_BINDING_TARGET_NOT_INSTALLED',
        `Model not installed and no pull authority is available: ${requestedModel}`,
        { modelName: requestedModel },
        404,
      );
    }
    const baseUrl = requireLocalProviderBaseUrl(this.baseUrl);
    try {
      await this.pullImpl(requestedModel, onProgress, { baseUrl });
    } catch (error) {
      throw asApplicationError(
        error,
        'MODEL_BINDING_PROVIDER_PULL_FAILED',
        `Ollama pull failed for ${requestedModel}`,
        { modelName: requestedModel },
      );
    }
  }

  async ensureInstalled(modelName, onProgress) {
    try {
      return await this.resolveExact(modelName);
    } catch (error) {
      if (error?.code !== 'MODEL_BINDING_TARGET_NOT_INSTALLED' || !this.pullImpl) throw error;
    }
    await this.pull(modelName, onProgress);
    return this.resolveExact(modelName);
  }

  async verifyExact(expected) {
    const baseUrl = requireLocalProviderBaseUrl(this.baseUrl);
    const modelName = requireString(expected?.modelName, 'modelName');
    const expectedDigestSha256 = requireDigest(
      expected?.digestSha256,
      'expectedDigestSha256',
    );
    const before = await this.resolveExact(modelName, { expectedDigestSha256 });
    let response;
    try {
      response = await this.fetchImpl(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: before.name,
          messages: [{ role: 'user', content: 'ping' }],
          stream: false,
          think: false,
          options: { num_predict: 1, num_ctx: 512 },
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(this.verifyTimeoutMs),
      });
    } catch (error) {
      throw new ModelBindingApplicationError(
        'MODEL_BINDING_PROVIDER_UNAVAILABLE',
        `Exact model verification is unavailable for ${before.name}`,
        { cause: error },
      );
    }
    if (!response?.ok) {
      fail(
        'MODEL_BINDING_VERIFICATION_REJECTED',
        `Exact model verification failed with HTTP ${response?.status ?? 'unknown'}`,
      );
    }
    let body;
    try {
      body = await response.json();
    } catch (error) {
      throw new ModelBindingApplicationError(
        'MODEL_BINDING_VERIFICATION_REJECTED',
        'Exact model verification returned invalid JSON',
        { cause: error },
      );
    }
    const responseModel = canonicalModelName(body?.model);
    const assistantContent = body?.message?.content;
    if (
      !isPlainObject(body)
      || body.done !== true
      || responseModel !== before.canonicalName
      || !isPlainObject(body.message)
      || body.message.role !== 'assistant'
      || typeof assistantContent !== 'string'
      || assistantContent.trim().length === 0
    ) {
      fail(
        'MODEL_BINDING_VERIFICATION_REJECTED',
        'Exact model verification returned an incomplete or mismatched chat result',
      );
    }
    return this.resolveExact(before.name, { expectedDigestSha256 });
  }
}

export class ModelBindingApplication {
  constructor(options = {}) {
    if (!isPlainObject(options)) {
      fail('MODEL_BINDING_APPLICATION_OPTIONS_INVALID', 'Application options must be a plain object');
    }
    this.repository = options.repository;
    this.runtime = options.runtime;
    this.provider = options.provider;
    this.modelUseAuthority = options.modelUseAuthority || modelUseAuthority;
    this.publishControl = options.publishControl || (() => {});
    this.requestKeyFactory = options.requestKeyFactory || (() => `request_${randomUUID()}`);
    this.actorFactory = options.actorFactory || (() => 'user:local-operator');
    this.delay = options.delay || defaultDelay;
    this.verificationAttempts = options.verificationAttempts ?? 1;
    this.verificationRetryDelayMs = options.verificationRetryDelayMs ?? 30_000;
    this.clock = options.clock || Date.now;
    this.scheduleRecovery = options.scheduleRecovery || ((callback, delayMs) => {
      const timer = setTimeout(callback, delayMs);
      timer.unref?.();
      return timer;
    });
    this.cancelRecovery = options.cancelRecovery || (timer => clearTimeout(timer));
    this.logger = options.logger || defaultLogger;
    this._busy = false;
    this._background = new Map();
    this._pendingVerification = new Map();
    this._pendingNotifications = new Map();
    this._pendingProposalRepairs = new Map();
    this._ownedProviderClaims = new Map();
    this._providerRecoveryTimers = new Map();
    this._runtimeFinalizeRecoveryTimers = new Map();
    this._verificationTail = Promise.resolve();
    this._verificationStarted = false;
    this._rehydratePromise = null;

    for (const [name, value] of [
      ['repository', this.repository],
      ['runtime', this.runtime],
      ['provider', this.provider],
      ['modelUseAuthority', this.modelUseAuthority],
    ]) {
      if (!value || typeof value !== 'object') {
        fail('MODEL_BINDING_APPLICATION_OPTIONS_INVALID', `${name} dependency is required`);
      }
    }
    for (const method of [
      'getDesired',
      'getEffectiveBinding',
      'getBindingOperation',
      'getBindingApplicationState',
      'recordUserBindingApply',
      'recordUserBindingRollback',
      'recordManualRuntimeApplied',
      'recordManualRuntimeFinalized',
      'recordManualRuntimeApplyFailed',
      'recordManualStartupRehydrated',
      'recordManualStartupRehydrateFailed',
      'recordManualVerificationSucceeded',
      'recordManualVerificationFailed',
      'recordManualNotificationSucceeded',
      'recordManualNotificationFailed',
      'listCurrentManualBindingsForRehydrate',
      'listLegacyOverridesForRehydrate',
      'listCompatibilityOverridesForRehydrate',
      'recordManualProviderPullIntent',
      'recordManualProviderPullSucceeded',
      'recordManualProviderPullFailed',
      'recordManualProviderPullReconciledPresent',
      'recordManualProviderPullReconciledAbsent',
      'getLatestProviderOperation',
      'getRelevantProviderOperation',
      'listPendingProviderOperations',
      'listResumableProviderOperations',
      'renewManualProviderPullClaim',
      'claimManualProviderPullRecovery',
      'observeDesiredBinding',
    ]) {
      if (typeof this.repository[method] !== 'function') {
        fail('MODEL_BINDING_APPLICATION_OPTIONS_INVALID', `Repository is missing ${method}`);
      }
    }
    for (const method of [
      'snapshot',
      'prepare',
      'commit',
      'compensate',
      'rehydrateLegacy',
      'resolvePendingProposals',
    ]) {
      if (typeof this.runtime[method] !== 'function') {
        fail('MODEL_BINDING_APPLICATION_OPTIONS_INVALID', `Runtime port is missing ${method}`);
      }
    }
    for (const method of [
      'listInstalled',
      'resolveFromInventory',
      'resolveExact',
      'pull',
      'verifyExact',
      'getOrigin',
    ]) {
      if (typeof this.provider[method] !== 'function') {
        fail('MODEL_BINDING_APPLICATION_OPTIONS_INVALID', `Provider is missing ${method}`);
      }
    }
    if (typeof this.modelUseAuthority.acquireShared !== 'function') {
      fail(
        'MODEL_BINDING_APPLICATION_OPTIONS_INVALID',
        'Model use authority is missing acquireShared',
      );
    }
    if (typeof this.publishControl !== 'function'
      || typeof this.requestKeyFactory !== 'function'
      || typeof this.actorFactory !== 'function'
      || typeof this.delay !== 'function'
      || typeof this.clock !== 'function'
      || typeof this.scheduleRecovery !== 'function'
      || typeof this.cancelRecovery !== 'function'
      || !Number.isSafeInteger(this.verificationAttempts)
      || this.verificationAttempts < 1) {
      fail('MODEL_BINDING_APPLICATION_OPTIONS_INVALID', 'Application callbacks are invalid');
    }
  }

  /**
   * Share the binding application's fail-fast mutation owner with the one
   * destructive model-maintenance operation that can invalidate a binding.
   * The callback is an internal port, not caller data; public adapters never
   * receive it or choose the mutation kind.
   */
  async runExclusiveModelMutation(inputValue, callback) {
    const input = requireExactInput(inputValue, ['kind']);
    if (input.kind !== 'MODEL_DELETE' || typeof callback !== 'function') {
      fail(
        'MODEL_BINDING_APPLICATION_INPUT_INVALID',
        'Exclusive model mutation requires the MODEL_DELETE kind and a callback',
      );
    }
    return this.#runExclusive('model-delete', callback);
  }

  /**
   * Return the bounded set of model identities that the durable/runtime
   * binding state still needs. The registry consumes this under the shared
   * mutation owner before any destructive provider effect.
   */
  getProtectedModelNames() {
    const protectedByCanonical = new Map();
    const protect = value => {
      const canonical = canonicalModelName(value);
      if (!canonical || protectedByCanonical.has(canonical)) return;
      protectedByCanonical.set(canonical, String(value).trim());
    };

    for (const role of Object.keys(config.models).sort()) {
      protect(this.runtime.snapshot(role).modelName);
      const desired = this.repository.getDesired(role);
      protect(desired?.modelName);

      const effective = this.repository.getEffectiveBinding(role);
      const operation = effective?.operation || effective?.pendingOperation || null;
      protect(operation?.previousModelName);
      protect(operation?.targetModelName);

      const providerOperation = this.repository.getRelevantProviderOperation(role);
      protect(providerOperation?.requestedModelName);
    }

    return Object.freeze([...protectedByCanonical.values()]);
  }

  async applyManualBinding(inputValue) {
    return this.#applyManualBinding(inputValue, null);
  }

  async beginManualBinding(inputValue) {
    let accepted = false;
    let resolveAcceptance;
    let rejectAcceptance;
    const acceptance = new Promise((resolve, reject) => {
      resolveAcceptance = resolve;
      rejectAcceptance = reject;
    });
    const completion = this.#applyManualBinding(inputValue, receipt => {
      if (accepted) return;
      accepted = true;
      resolveAcceptance(Object.freeze({ accepted: true, ...receipt }));
    });
    // Attach a rejection observer immediately: completion can fail after the
    // durable receipt was returned, and the caller will observe that same
    // promise without creating an unhandled-rejection window.
    completion.catch(error => {
      if (!accepted) rejectAcceptance(error);
    });
    const receipt = await acceptance;
    return Object.freeze({ ...receipt, completion });
  }

  async #applyManualBinding(inputValue, onAccepted) {
    const input = requireExactInput(inputValue, ['role', 'targetModel']);
    const role = requireString(input.role, 'role', 16).toUpperCase();
    const targetModel = requireString(input.targetModel, 'targetModel');
    let acceptanceIssued = false;
    const accept = receipt => {
      if (acceptanceIssued || typeof onAccepted !== 'function') return;
      acceptanceIssued = true;
      onAccepted(receipt);
    };
    return this.#runExclusive('apply', async () => {
      try {
        const actor = this.#actor('apply', role);
        this.#requireNoPendingRuntimeFinalize(role);
        await this.#reconcilePendingProviderOperations();
        const resumable = this.#findResumableProviderOperation(role, targetModel);
        if (resumable) this.#assertProviderOperationOrigin(resumable);
        const requestKey = resumable?.requestKey || this.#requestKey('apply', role);
        const acceptProviderIntent = providerIntent => accept({
          phase: 'PROVIDER_INTENT',
          requestKey: providerIntent.requestKey,
          providerOperationId: providerIntent.operationId,
        });
        let desired = await this.#ensureDesiredBaseline(role, {
          actor,
          // A legacy baseline pull is only a prerequisite. It cannot accept
          // the user's target command because it does not durably represent
          // that target. Acceptance is issued below by USER_APPLY_TARGET or
          // the binding operation itself.
          onProviderIntent: undefined,
          onProgress: progress => this.#publishBestEffort({
            action: 'model_pull_progress',
            model: progress.model,
            ...progress,
          }),
        });
        if (resumable && resumable.expectedBindingRevision !== desired.bindingRevision) {
          fail(
            'MODEL_BINDING_PROVIDER_RESUME_CAS_MISMATCH',
            'Durable provider intent no longer matches the desired binding revision',
            {
              providerOperationId: resumable.operationId,
              expectedBindingRevision: resumable.expectedBindingRevision,
              actualBindingRevision: desired.bindingRevision,
            },
            409,
          );
        }
        let effectiveBeforeApply = this.repository.getEffectiveBinding(role);
        let pending = effectiveBeforeApply?.pendingOperation || null;
        let pendingState = pending?.operationId
          ? this.repository.getBindingApplicationState(pending.operationId)
          : null;
        if (desired.source?.startsWith('USER_')
          && pending?.operationId
          && pendingState?.runtimeStatus === 'FAILED'
          && pendingState.retryable === false) {
          fail(
            'MODEL_BINDING_APPLICATION_NONRETRYABLE_TERMINAL',
            'Manual binding requires explicit rollback before a new user operation',
            { operationId: pending.operationId, failureCode: pendingState.failureCode },
            409,
          );
        }
        if (desired.source?.startsWith('USER_')
          && pending?.operationId
          && canonicalModelName(targetModel) !== desired.canonicalName) {
          fail(
            'MODEL_BINDING_APPLICATION_PENDING_OPERATION',
            'A different manual binding is still pending runtime application',
            {
              role,
              pendingOperationId: pending.operationId,
              pendingModel: desired.modelName,
            },
            409,
          );
        }
        const current = effectiveBeforeApply;
        const currentOperation = current?.operation || current?.pendingOperation || null;
        let currentOperationRecord = null;
        let currentApplicationState = null;
        if (desired.source?.startsWith('USER_')
          && canonicalModelName(targetModel) === desired.canonicalName
          && currentOperation?.operationId) {
          currentOperationRecord = this.repository.getBindingOperation(currentOperation.operationId);
          currentApplicationState = this.repository.getBindingApplicationState(
            currentOperationRecord.operationId,
          );
          accept({
            phase: 'BINDING_OPERATION',
            requestKey: currentOperationRecord.requestKey,
            operationId: currentOperationRecord.operationId,
          });
          if (currentApplicationState?.runtimeStatus === 'APPLIED'
            && currentApplicationState.verificationStatus !== 'FAILED') {
            return this.#executeOperation(currentOperationRecord, { startup: false });
          }
        }
        this.#publishBestEffort({
          action: 'upgrade_progress',
          role,
          model: targetModel,
          status: 'starting',
          text: `${role}: Aplikuji ${targetModel}...`,
        });
        const target = resumable
          ? Object.freeze({
            name: resumable.terminal.observedModelName,
            canonicalName: resumable.terminal.observedCanonicalName,
            digestSha256: resumable.terminal.observedDigestSha256,
          })
          : await this.#ensureTargetInstalled(
            role,
            targetModel,
            requestKey,
            actor,
            acceptProviderIntent,
            progress => this.#publishBestEffort({
              action: 'model_pull_progress',
              model: targetModel,
              ...progress,
            }),
            {
              requestPurpose: 'USER_APPLY_TARGET',
              expectedBindingRevision: desired.bindingRevision,
            },
          );
        if (desired.source?.startsWith('USER_')
          && desired.canonicalName === target.canonicalName
          && desired.digestSha256 === target.digestSha256
          && currentOperation?.operationId) {
          const operation = currentOperationRecord
            || this.repository.getBindingOperation(currentOperation.operationId);
          const state = currentApplicationState
            || this.repository.getBindingApplicationState(operation.operationId);
          if (state.runtimeStatus === 'APPLIED' && state.verificationStatus === 'FAILED') {
            this.#scheduleVerification(operation);
            const snapshot = this.runtime.snapshot(role);
            return this.#result(
              operation,
              snapshot.configVersion,
              state,
              'VERIFICATION_RETRY_SCHEDULED',
            );
          }
          return this.#executeOperation(operation, { startup: false });
        }
        const result = this.repository.recordUserBindingApply({
          requestKey,
          role,
          expectedBindingRevision: desired.bindingRevision,
          targetModelName: target.name,
          targetDigestSha256: target.digestSha256,
          actor: resumable?.actor || actor,
        });
        if (!result.operation) {
          const receipt = result.noOpReceipt;
          if (!receipt) {
            fail(
              'MODEL_BINDING_NOOP_RECEIPT_MISSING',
              'A no-op binding acceptance requires a durable receipt',
            );
          }
          accept({
            phase: 'UNCHANGED',
            requestKey: receipt.requestKey,
            noOpReceiptId: receipt.receiptId,
            operationId: null,
          });
          const snapshot = this.runtime.snapshot(role);
          const proposalResolution = this.#tryResolvePendingProposals({
            operationId: receipt.receiptId,
            role,
            targetModelName: receipt.modelName,
            kind: 'USER_APPLY',
          });
          return {
            ok: true,
            role,
            from: snapshot.modelName,
            to: snapshot.modelName,
            changed: false,
            verified: false,
            configVersion: snapshot.configVersion,
            operationId: null,
            noOpReceiptId: receipt.receiptId,
            proposalResolutionStatus: proposalResolution.status,
            warningCode: proposalResolution.warningCode,
            outcome: proposalResolution.status === 'SUCCEEDED'
              ? result.outcome
              : 'UNCHANGED_PROPOSAL_REPAIR_PENDING',
          };
        }
        accept({
          phase: 'BINDING_OPERATION',
          requestKey: result.operation.requestKey,
          operationId: result.operation.operationId,
        });
        return this.#executeOperation(result.operation, { startup: false });
      } catch (error) {
        this.#publishBestEffort({
          action: 'upgrade_error',
          role,
          model: targetModel,
          error: error?.message || String(error),
          code: error?.code || null,
        });
        throw error;
      }
    });
  }

  async rollbackManualBinding(inputValue) {
    // Decision 022/A: role alone is rejected. The request carries the exact
    // operation the user decided about, and every member is part of the CAS.
    const input = requireExactInput(inputValue, [
      'role',
      'operationId',
      'committedBindingRevision',
      'failedAttemptRevision',
    ]);
    const role = requireExactRole(input.role);
    const operationId = requireExactIdentityString(input.operationId, 'operationId');
    const committedBindingRevision = requireExactIdentityRevision(
      input.committedBindingRevision,
      'committedBindingRevision',
    );
    const failedAttemptRevision = requireExactIdentityAttemptRevision(
      input.failedAttemptRevision,
      'failedAttemptRevision',
    );
    return this.#runExclusive('rollback', async () => {
      try {
        this.#requireNoPendingRuntimeFinalize(role);
        const effective = this.repository.getEffectiveBinding(role);
        const currentOperation = effective?.operation || effective?.pendingOperation || null;
        if (!currentOperation?.operationId) {
          const compatibilityOverride = this.repository
            .listCompatibilityOverridesForRehydrate()
            .find(row => row.role === role);
          if (!compatibilityOverride) {
            fail(
              'MODEL_BINDING_OVERRIDE_NOT_FOUND',
              `No override found for role: ${role}`,
              { role },
              404,
            );
          }
          fail(
            'MODEL_BINDING_LEGACY_ROLLBACK_REQUIRES_REBIND',
            `Legacy override for role ${role} has no exact lineage; explicitly rebind before rollback`,
            { role },
            409,
          );
        }
        // The cheap precheck fails stale clicks before the provider is touched;
        // the repository CAS below is the authority that actually holds.
        if (currentOperation.operationId !== operationId) {
          fail(
            'MODEL_BINDING_ROLLBACK_STALE_OPERATION',
            `Rollback targets an operation that is no longer current for role ${role}`,
            { role, operationId, currentOperationId: currentOperation.operationId },
            409,
          );
        }
        const appliedState = this.repository.getBindingApplicationState(operationId);
        if (!appliedState
          || appliedState.committedBindingRevision !== committedBindingRevision
          || appliedState.attemptRevision !== failedAttemptRevision) {
          fail(
            'MODEL_BINDING_ROLLBACK_STALE_OPERATION',
            `Rollback no longer matches the failed verification it was offered for: ${role}`,
            {
              role,
              operationId,
              committedBindingRevision,
              failedAttemptRevision,
              currentBindingRevision: appliedState?.committedBindingRevision ?? null,
              currentAttemptRevision: appliedState?.attemptRevision ?? null,
            },
            409,
          );
        }
        const applied = this.repository.getBindingOperation(currentOperation.operationId);
        if (applied?.kind === 'USER_ROLLBACK') {
          return this.#executeOperation(applied, { startup: false });
        }
        if (!applied || applied.kind !== 'USER_APPLY') {
          fail(
            'MODEL_BINDING_ROLLBACK_TARGET_INVALID',
            `No rollbackable apply found for role: ${role}`,
            { role },
            404,
          );
        }
        await this.provider.resolveExact(applied.previousModelName, {
          expectedDigestSha256: applied.previousDigestSha256,
        });
        const result = this.repository.recordUserBindingRollback({
          requestKey: this.#requestKey('rollback', role),
          role,
          expectedBindingRevision: committedBindingRevision,
          rollbackOfOperationId: operationId,
          expectedFailedVerificationAttemptRevision: failedAttemptRevision,
          actor: this.#actor('rollback', role),
        });
        return this.#executeOperation(result.operation, { startup: false });
      } catch (error) {
        // A stale or malformed recovery action must leave no trace at all —
        // no runtime, provider, desired, audit or broadcast effect.
        if (!ROLLBACK_SILENT_FAILURE_CODES.has(error?.code)) {
          this.#publishBestEffort({
            action: 'upgrade_error',
            role,
            model: null,
            error: error?.message || String(error),
            code: error?.code || null,
          });
        }
        throw error;
      }
    });
  }

  async rehydrateBindings() {
    if (this._rehydratePromise) return this._rehydratePromise;
    const attempt = this.#runExclusive('rehydrate', async () => {
      const summary = { restored: 0, legacyRestored: 0, failed: [], warnings: [] };
      const overrides = this.repository.listCompatibilityOverridesForRehydrate();
      const initialOperations = this.repository.listCurrentManualBindingsForRehydrate();
      const initialEligibleOperations = initialOperations.filter(operation => {
        const state = this.repository.getBindingApplicationState(operation.operationId);
        return !(state.runtimeStatus === 'FAILED' && state.retryable === false);
      });
      const pendingProviderOperations = this.repository.listPendingProviderOperations();
      const initialResumableProviderOperations = this.repository
        .listResumableProviderOperations();
      const providerOriginFailures = new Set();
      const originEligibleResumableProviderOperations = [];
      const recoverableProviderOperations = [];

      for (const providerOperation of initialResumableProviderOperations) {
        try {
          this.#assertProviderOperationOrigin(providerOperation);
          originEligibleResumableProviderOperations.push(providerOperation);
        } catch (error) {
          providerOriginFailures.add(providerOperation.operationId);
          summary.failed.push({
            role: providerOperation.role,
            providerOperationId: providerOperation.operationId,
            code: error?.code || 'MODEL_BINDING_PROVIDER_ORIGIN_MISMATCH',
          });
        }
      }

      for (const providerOperation of pendingProviderOperations) {
        try {
          this.#assertProviderOperationOrigin(providerOperation);
          recoverableProviderOperations.push(
            this.#claimProviderOperationForRecovery(providerOperation),
          );
        } catch (error) {
          if (error?.code === 'MODEL_BINDING_PROVIDER_OPERATION_IN_PROGRESS') {
            this.#scheduleProviderRecovery(providerOperation);
          }
          summary.failed.push({
            role: providerOperation.role,
            providerOperationId: providerOperation.operationId,
            code: error?.code || 'PROVIDER_RECOVERY_CLAIM_FAILED',
          });
        }
      }

      for (const legacy of overrides.filter(row => row.bindingOperationId === null)) {
        try {
          this.runtime.rehydrateLegacy({
            role: legacy.role,
            targetModel: legacy.modelName,
          });
          summary.legacyRestored++;
        } catch (error) {
          summary.failed.push({ role: legacy.role, code: error?.code || 'LEGACY_REHYDRATE_FAILED' });
        }
      }

      const exactOverrides = overrides.filter(row => row.bindingOperationId !== null);
      let inventory = null;
      let inventoryError = null;
      if (exactOverrides.length > 0
        || initialEligibleOperations.length > 0
        || recoverableProviderOperations.length > 0
        || originEligibleResumableProviderOperations.length > 0) {
        try {
          inventory = await this.provider.listInstalled();
        } catch (error) {
          inventoryError = error;
        }
      }

      if (recoverableProviderOperations.length > 0) {
        if (inventoryError) {
          for (const providerOperation of recoverableProviderOperations) {
            summary.failed.push({
              role: providerOperation.role,
              providerOperationId: providerOperation.operationId,
              code: inventoryError?.code || 'PROVIDER_RECONCILIATION_UNAVAILABLE',
            });
          }
        } else {
          for (const providerOperation of recoverableProviderOperations) {
            try {
              const reconciled = this.#reconcileProviderOperation(providerOperation, inventory);
              if (reconciled.outcome === 'RECONCILED_ABSENT') {
                summary.failed.push({
                  role: providerOperation.role,
                  providerOperationId: providerOperation.operationId,
                  code: 'MODEL_BINDING_PROVIDER_OUTCOME_UNRESOLVED',
                });
              }
            } catch (error) {
              summary.failed.push({
                role: providerOperation.role,
                providerOperationId: providerOperation.operationId,
                code: error?.code || 'PROVIDER_RECONCILIATION_FAILED',
              });
            }
          }
        }
      }

      for (const providerOperation of this.repository.listResumableProviderOperations()) {
        if (providerOriginFailures.has(providerOperation.operationId)) continue;
        try {
          this.#resumeProviderOperation(providerOperation);
        } catch (error) {
          summary.failed.push({
            role: providerOperation.role,
            providerOperationId: providerOperation.operationId,
            code: error?.code || 'PROVIDER_BINDING_RESUME_FAILED',
          });
        }
      }

      const operations = this.repository.listCurrentManualBindingsForRehydrate();
      const currentOperationIds = new Set(operations.map(operation => operation.operationId));
      const operationStates = new Map(operations.map(operation => [
        operation.operationId,
        this.repository.getBindingApplicationState(operation.operationId),
      ]));

      // A newer pending operation must not erase the last applied manual
      // compatibility override on restart. Restore that exact prior artifact
      // first; the current operation is evaluated below from the same snapshot.
      for (const override of exactOverrides) {
        if (currentOperationIds.has(override.bindingOperationId)) continue;
        try {
          const snapshot = this.runtime.snapshot(override.role);
          let releaseUseLeases;
          try {
            releaseUseLeases = this.#acquireModelUseLeases(
              [snapshot.modelName, override.modelName],
              MODEL_ACTIVITY_OWNER.BINDING_CUTOVER,
            );
          } catch (error) {
            throw this.#bindingUseConflict(error, {
              operationId: override.bindingOperationId,
              role: override.role,
            }, 'STARTUP_CUTOVER');
          }
          try {
            const resolved = await this.provider.resolveExact(override.modelName, {
              expectedDigestSha256: override.digestSha256,
            });
            this.runtime.rehydrateLegacy({
              role: override.role,
              targetModel: resolved.name,
            });
          } finally {
            releaseUseLeases();
          }
          summary.restored++;
        } catch (error) {
          summary.failed.push({
            role: override.role,
            operationId: override.bindingOperationId,
            code: rehydrateFailureCode(error),
          });
        }
      }

      for (const operation of operations) {
        let executionStarted = false;
        try {
          const state = operationStates.get(operation.operationId);
          if (state.runtimeStatus === 'FAILED' && state.retryable === false) {
            fail(
              'MODEL_BINDING_APPLICATION_NONRETRYABLE_TERMINAL',
              'Manual binding requires a new user operation after a non-retryable failure',
              { operationId: operation.operationId, failureCode: state.failureCode },
              409,
            );
          }
          executionStarted = true;
          const restored = await this.#executeOperation(operation, { startup: true });
          summary.restored++;
          if (restored.proposalResolutionStatus === 'REPAIR_PENDING') {
            summary.warnings.push({
              role: operation.role,
              operationId: operation.operationId,
              code: restored.warningCode,
            });
          }
        } catch (error) {
          const state = this.repository.getBindingApplicationState(operation.operationId);
          if (!executionStarted
            && !(state.runtimeStatus === 'FAILED' && state.retryable === false)) {
            try {
              await this.#recordRuntimeFailure(operation, state, error, true);
            } catch (auditError) {
              this.logger.warn(
                'ModelBindingApplication',
                `Startup failure audit rejected for ${operation.role}: ${auditError.message}`,
              );
            }
          }
          summary.failed.push({ role: operation.role, code: error?.code || 'REHYDRATE_FAILED' });
        }
      }
      return summary;
    });
    this._rehydratePromise = attempt;
    try {
      const summary = await attempt;
      if (summary.failed.length > 0) this._rehydratePromise = null;
      return summary;
    } catch (error) {
      this._rehydratePromise = null;
      throw error;
    }
  }

  async awaitBackgroundWork() {
    while (this._background.size > 0) {
      await Promise.all([...this._background.values()]);
    }
  }

  getBindingStatus(inputValue) {
    const input = requireExactInput(inputValue, ['role']);
    const role = requireString(input.role, 'role', 16).toUpperCase();
    const desired = this.repository.getDesired(role);
    const effective = this.repository.getEffectiveBinding(role);
    const operation = effective?.operation || effective?.pendingOperation || null;
    const providerOperation = this.repository.getRelevantProviderOperation(role);
    const internalApplicationState = operation?.operationId
      ? this.repository.getBindingApplicationState(operation.operationId)
      : null;
    const applicationState = publicApplicationState(internalApplicationState);
    return {
      role,
      runtimeModel: this.runtime.snapshot(role).modelName,
      desiredModel: desired?.modelName || null,
      desiredRevision: desired?.bindingRevision ?? null,
      operationId: operation?.operationId || null,
      state: applicationState?.state || (desired ? 'OBSERVED' : 'UNOBSERVED'),
      runtimeStatus: applicationState?.runtimeStatus || null,
      verificationStatus: applicationState?.verificationStatus || null,
      failurePhase: applicationState?.failurePhase || null,
      failureCode: applicationState?.failureCode || null,
      retryable: applicationState?.retryable ?? null,
      notificationStatus: applicationState?.notificationStatus || null,
      providerOperationId: providerOperation?.operationId || null,
      providerRequestKey: providerOperation?.requestKey || null,
      providerRequestPurpose: providerOperation?.requestPurpose || null,
      providerRequestedModel: providerOperation?.requestedModelName || null,
      providerStatus: providerOperation
        ? (providerOperation.terminal?.outcome || 'PENDING')
        : null,
      providerFailureCode: providerOperation?.terminal?.failureCode || null,
      providerRetryable: providerOperation?.terminal?.retryable ?? null,
    };
  }

  startBackgroundVerification() {
    this._verificationStarted = true;
    for (const operation of [...this._pendingProposalRepairs.values()]) {
      this.#enqueueProposalRepair(operation);
    }
    for (const entry of [...this._pendingNotifications.values()]) {
      this.#enqueueNotification(entry.operation, entry.runtimeResult);
    }
    for (const operation of [...this._pendingVerification.values()]) {
      this.#enqueueVerification(operation);
    }
  }

  async #runExclusive(operation, callback) {
    if (this._busy) {
      fail(
        'MODEL_BINDING_APPLICATION_BUSY',
        `Another binding application is in progress during ${operation}`,
        null,
        409,
      );
    }
    this._busy = true;
    try {
      return await callback();
    } finally {
      this._busy = false;
    }
  }

  #requestKey(kind, role) {
    const requestKey = requireString(
      this.requestKeyFactory({ kind, role }),
      'requestKey',
      128,
    );
    if (requestKey.length < 16) {
      fail(
        'MODEL_BINDING_APPLICATION_INPUT_INVALID',
        'requestKey must contain between 16 and 128 characters',
        { field: 'requestKey' },
      );
    }
    return requestKey;
  }

  #actor(kind, role) {
    const actor = requireString(this.actorFactory({ kind, role }), 'actor', 128);
    if (!/^user:[^\s]+$/u.test(actor)) {
      fail('MODEL_BINDING_APPLICATION_ACTOR_INVALID', 'Derived actor must use a user: identity');
    }
    return actor;
  }

  async #ensureDesiredBaseline(role, recovery = {}) {
    const existing = this.repository.getDesired(role);
    if (existing) {
      const effective = this.repository.getEffectiveBinding(role);
      const runtime = this.runtime.snapshot(role);
      if (existing.source?.startsWith('USER_')) {
        if (effective?.source === 'MANUAL' && !sameModelName(runtime.modelName, existing.modelName)) {
          fail(
            'MODEL_BINDING_RUNTIME_CAS_MISMATCH',
            'Applied manual binding differs from runtime configuration',
            { role, runtimeModel: runtime.modelName, desiredModel: existing.modelName },
          );
        }
        return existing;
      }
      if (!sameModelName(runtime.modelName, existing.modelName)) {
        fail(
          'MODEL_BINDING_RUNTIME_CAS_MISMATCH',
          'Desired baseline differs from runtime configuration',
          { role, runtimeModel: runtime.modelName, desiredModel: existing.modelName },
        );
      }
      await this.provider.resolveExact(existing.modelName, {
        expectedDigestSha256: existing.digestSha256,
      });
      return existing;
    }

    const runtime = this.runtime.snapshot(role);
    const legacy = this.repository.listLegacyOverridesForRehydrate().find(row => (
      row.role === role && sameModelName(row.modelName, runtime.modelName)
    ));
    let resolved;
    try {
      resolved = await this.provider.resolveExact(runtime.modelName);
    } catch (error) {
      if (!legacy || error?.code !== 'MODEL_BINDING_TARGET_NOT_INSTALLED') throw error;
      const recoveryRequestKey = this.#requestKey('legacy-recovery', role);
      resolved = await this.#ensureTargetInstalled(
        role,
        runtime.modelName,
        recoveryRequestKey,
        recovery.actor,
        recovery.onProviderIntent,
        progress => recovery.onProgress?.({ model: runtime.modelName, ...progress }),
        {
          requestPurpose: 'LEGACY_BASELINE_RECOVERY',
          expectedBindingRevision: null,
        },
      );
    }
    const observed = this.repository.observeDesiredBinding({
      role,
      modelName: resolved.name,
      digestSha256: resolved.digestSha256,
      source: legacy ? 'LEGACY_OVERRIDE' : 'CONFIG_DEFAULT',
      actor: 'system:binding-application',
    });
    return observed.binding;
  }

  async #ensureTargetInstalled(
    role,
    targetModel,
    requestKey,
    actor,
    onProviderIntent,
    onProgress,
    intentAuthority,
  ) {
    try {
      return await this.provider.resolveExact(targetModel);
    } catch (error) {
      if (error?.code !== 'MODEL_BINDING_TARGET_NOT_INSTALLED') throw error;
    }

    const intent = this.repository.recordManualProviderPullIntent({
      requestKey,
      role,
      requestPurpose: intentAuthority.requestPurpose,
      expectedBindingRevision: intentAuthority.expectedBindingRevision,
      providerOrigin: this.provider.getOrigin(),
      targetModelName: targetModel,
      actor,
    });
    const providerOperationId = intent.operation.operationId;
    let providerClaim = intent.operation.claim;
    if (!providerClaim) {
      fail(
        'MODEL_BINDING_PROVIDER_CLAIM_MISSING',
        'Durable provider intent did not create its effect claim',
        { providerOperationId },
      );
    }
    this._ownedProviderClaims.set(providerOperationId, providerClaim);
    let heartbeatError = null;
    const heartbeat = setInterval(() => {
      try {
        const renewed = this.repository.renewManualProviderPullClaim({
          operationId: providerOperationId,
          claimToken: providerClaim.claimToken,
          expectedFencingRevision: providerClaim.fencingRevision,
        });
        providerClaim = renewed.claim;
        this._ownedProviderClaims.set(providerOperationId, providerClaim);
      } catch (error) {
        heartbeatError = error;
      }
    }, PROVIDER_CLAIM_HEARTBEAT_MS);
    heartbeat.unref?.();
    const terminalClaim = () => {
      if (heartbeatError) {
        throw asApplicationError(
          heartbeatError,
          'MODEL_BINDING_PROVIDER_CLAIM_STALE',
          'Provider effect claim was lost before terminal audit',
          { providerOperationId },
        );
      }
      return {
        claimToken: providerClaim.claimToken,
        expectedFencingRevision: providerClaim.fencingRevision,
      };
    };
    onProviderIntent?.(intent.operation);
    let resolved;
    let pullCompleted = false;
    try {
      try {
        await this.provider.pull(targetModel, onProgress);
        pullCompleted = true;
        resolved = await this.provider.resolveExact(targetModel);
      } catch (error) {
        if (pullCompleted) {
          throw new ModelBindingApplicationError(
            'MODEL_BINDING_PROVIDER_OUTCOME_UNRESOLVED',
            'Provider pull completed but its exact artifact identity is unresolved',
            {
              cause: error,
              details: { providerOperationId, observationCode: error?.code || null },
            },
          );
        }
        // A rejected pull may still have completed remotely. Observe once before
        // writing FAILED; only an exact absent inventory makes that terminal
        // statement truthful.
        try {
          resolved = await this.provider.resolveExact(targetModel);
        } catch (observationError) {
          if (observationError?.code !== 'MODEL_BINDING_TARGET_NOT_INSTALLED') {
            throw new ModelBindingApplicationError(
              'MODEL_BINDING_PROVIDER_OUTCOME_UNRESOLVED',
              'Provider pull failed and its storage outcome is unresolved',
              {
                cause: error,
                details: {
                  providerOperationId,
                  observationCode: observationError?.code || null,
                },
              },
            );
          }
          try {
            this.repository.recordManualProviderPullFailed({
              operationId: providerOperationId,
              ...terminalClaim(),
              failureCode: providerPullFailureCode(error),
            });
            this._ownedProviderClaims.delete(providerOperationId);
            this.#cancelProviderRecovery(providerOperationId);
          } catch (auditError) {
            throw new ModelBindingApplicationError(
              'MODEL_BINDING_PROVIDER_AUDIT_FAILED',
              'Provider effect failed without a durable terminal audit outcome',
              {
                cause: auditError,
                details: {
                  providerOperationId,
                  providerFailureCode: error?.code || null,
                },
              },
            );
          }
          throw error;
        }
      }
      try {
        this.repository.recordManualProviderPullSucceeded({
          operationId: providerOperationId,
          ...terminalClaim(),
          observedModelName: resolved.name,
          observedDigestSha256: resolved.digestSha256,
        });
        this._ownedProviderClaims.delete(providerOperationId);
        this.#cancelProviderRecovery(providerOperationId);
      } catch (error) {
        throw new ModelBindingApplicationError(
          'MODEL_BINDING_PROVIDER_AUDIT_FAILED',
          'Provider pull completed but its exact terminal audit could not be committed',
          { cause: error, details: { providerOperationId } },
        );
      }
      return resolved;
    } finally {
      clearInterval(heartbeat);
    }
  }

  async #reconcilePendingProviderOperations() {
    const pending = this.repository.listPendingProviderOperations();
    if (pending.length === 0) return;
    const providerOrigin = this.provider.getOrigin();
    const mismatched = pending.filter(operation => operation.providerOrigin !== providerOrigin);
    if (mismatched.length > 0) {
      fail(
        'MODEL_BINDING_PROVIDER_ORIGIN_MISMATCH',
        'Pending provider effects belong to a different loopback provider origin',
        {
          providerOrigin,
          providerOperationIds: mismatched.map(operation => operation.operationId),
        },
        409,
      );
    }
    const claimed = [];
    const blocked = [];
    for (const operation of pending) {
      try {
        claimed.push(this.#claimProviderOperationForRecovery(operation));
      } catch (error) {
        blocked.push({
          operationId: operation.operationId,
          code: error?.code || 'MODEL_BINDING_PROVIDER_RECOVERY_CLAIM_FAILED',
        });
      }
    }
    if (claimed.length === 0) {
      fail(
        blocked[0]?.code || 'MODEL_BINDING_PROVIDER_OPERATION_IN_PROGRESS',
        'Pending provider effects are still owned or not recoverable',
        { blocked },
        409,
      );
    }
    let inventory;
    try {
      inventory = await this.provider.listInstalled();
    } catch (error) {
      throw new ModelBindingApplicationError(
        'MODEL_BINDING_PROVIDER_RECONCILIATION_REQUIRED',
        'A previous provider effect is unresolved and inventory is unavailable',
        {
          cause: error,
          details: { providerOperationIds: claimed.map(operation => operation.operationId) },
        },
      );
    }
    for (const operation of claimed) this.#reconcileProviderOperation(operation, inventory);
    if (blocked.length > 0) {
      fail(
        blocked[0].code,
        'Some pending provider effects remain owned or not recoverable',
        { blocked },
        409,
      );
    }
  }

  #claimProviderOperationForRecovery(operation) {
    const ownedClaim = this._ownedProviderClaims.get(operation.operationId);
    if (ownedClaim
      && operation.claim
      && ownedClaim.claimToken === operation.claim.claimToken
      && ownedClaim.fencingRevision === operation.claim.fencingRevision) {
      try {
        const renewed = this.repository.renewManualProviderPullClaim({
          operationId: operation.operationId,
          claimToken: ownedClaim.claimToken,
          expectedFencingRevision: ownedClaim.fencingRevision,
        });
        this._ownedProviderClaims.set(operation.operationId, renewed.claim);
        return renewed;
      } catch (error) {
        if (error?.code !== 'MODEL_BINDING_PROVIDER_CLAIM_STALE') throw error;
      }
    }
    const recovered = this.repository.claimManualProviderPullRecovery({
      operationId: operation.operationId,
    });
    this._ownedProviderClaims.set(operation.operationId, recovered.claim);
    return recovered;
  }

  #scheduleProviderRecovery(operation, delayOverrideMs = null) {
    if (this._providerRecoveryTimers.has(operation.operationId)) return;
    const delayMs = delayOverrideMs ?? Math.max(
      1,
      (operation.claim?.leaseExpiresAtMs ?? this.clock()) - this.clock() + 1,
    );
    const timer = this.scheduleRecovery(() => {
      this._providerRecoveryTimers.delete(operation.operationId);
      this._rehydratePromise = null;
      const key = `provider-recovery:${operation.operationId}`;
      const task = this.rehydrateBindings()
        .then(summary => {
          const refreshed = this.repository.getProviderOperation(operation.operationId);
          if (refreshed && this.#providerCommandNeedsRecovery(refreshed)) {
            // Reconciliation can report a typed failure in its summary rather
            // than reject. Pending provider effects retry at their renewed
            // lease boundary; a terminal provider effect whose binding commit
            // is still missing/retryable gets a bounded application retry.
            const retryDelayMs = refreshed.terminal === null
              ? null
              : Math.max(1, this.verificationRetryDelayMs);
            this.#scheduleProviderRecovery(refreshed, retryDelayMs);
          }
          return summary;
        })
        .catch(error => {
          if (error?.code === 'MODEL_BINDING_APPLICATION_BUSY') {
            this.#scheduleProviderRecovery(operation, 1000);
          } else {
            this.logger.warn(
              'ModelBindingApplication',
              `Scheduled provider recovery failed: ${error.message}`,
            );
          }
          return null;
        })
        .finally(() => this._background.delete(key));
      this._background.set(key, task);
    }, delayMs);
    this._providerRecoveryTimers.set(operation.operationId, timer);
  }

  #cancelProviderRecovery(operationId) {
    const timer = this._providerRecoveryTimers.get(operationId);
    if (timer === undefined) return;
    this._providerRecoveryTimers.delete(operationId);
    this.cancelRecovery(timer);
  }

  #requireNoPendingRuntimeFinalize(role) {
    const desired = this.repository.getDesired(role);
    if (!desired?.source?.startsWith('USER_')) return;
    const effective = this.repository.getEffectiveBinding(role);
    const reference = effective?.operation || effective?.pendingOperation || null;
    if (!reference?.operationId) return;
    const operation = this.repository.getBindingOperation(reference.operationId);
    const state = this.repository.getBindingApplicationState(reference.operationId);
    if (!operation || state?.runtimeFinalizeStatus !== 'UNKNOWN') return;
    this.#scheduleRuntimeFinalizeRecovery(operation);
    throw this.#runtimeFinalizeError(
      operation,
      null,
      'REPLAY_BLOCKED',
      'NOT_ATTEMPTED',
    );
  }

  #scheduleRuntimeFinalizeRecovery(operation) {
    if (this._runtimeFinalizeRecoveryTimers.has(operation.operationId)) return;
    const delayMs = Math.max(1, this.verificationRetryDelayMs);
    const timer = this.scheduleRecovery(() => {
      this._runtimeFinalizeRecoveryTimers.delete(operation.operationId);
      const key = `runtime-finalize:${operation.operationId}`;
      if (this._background.has(key)) return;
      let rescheduleAfterBusy = false;
      const task = this.#runExclusive(
        'runtime-finalize-recovery',
        () => {
          const latest = this.repository.getBindingApplicationState(operation.operationId);
          if (latest?.runtimeFinalizeStatus !== 'UNKNOWN') return null;
          return this.#executeOperation(operation, { startup: true });
        },
      ).catch(error => {
        rescheduleAfterBusy = error?.code === 'MODEL_BINDING_APPLICATION_BUSY';
        this.logger.warn(
          'ModelBindingApplication',
          `Runtime finalize recovery failed for ${operation.operationId}: ${error.message}`,
        );
        return null;
      }).finally(() => {
        this._background.delete(key);
        if (rescheduleAfterBusy) this.#scheduleRuntimeFinalizeRecovery(operation);
      });
      this._background.set(key, task);
    }, delayMs);
    this._runtimeFinalizeRecoveryTimers.set(operation.operationId, timer);
  }

  #cancelRuntimeFinalizeRecovery(operationId) {
    const timer = this._runtimeFinalizeRecoveryTimers.get(operationId);
    if (timer === undefined) return;
    this._runtimeFinalizeRecoveryTimers.delete(operationId);
    this.cancelRecovery(timer);
  }

  #runtimeFinalizeError(operation, cause, phase, compensationOutcome) {
    return new ModelBindingApplicationError(
      'MODEL_BINDING_RUNTIME_COMMIT_FAILED',
      'Model binding runtime finalization requires exact recovery',
      {
        cause: cause || undefined,
        details: {
          operationId: operation.operationId,
          internalState: 'RUNTIME_RECONCILIATION_REQUIRED',
          phase,
          compensationOutcome,
        },
      },
    );
  }

  #validateRuntimeCommitResult(operation, token, result) {
    const expectedVersion = token.versionBefore + (token.incrementVersion ? 1 : 0);
    if (!isPlainObject(result)
      || result.role !== operation.role
      || result.from !== token.previousModel
      || result.to !== token.targetModel
      || result.changed !== token.changed
      || result.configVersion !== expectedVersion) {
      fail(
        'MODEL_BINDING_RUNTIME_COMMIT_FAILED',
        'Runtime binding commit returned an invalid finalization result',
        { operationId: operation.operationId },
      );
    }
    return result;
  }

  #providerCommandNeedsRecovery(providerOperation) {
    if (providerOperation.terminal === null) return true;
    if (providerOperation.requestPurpose !== 'USER_APPLY_TARGET') return false;
    if (!['SUCCEEDED', 'RECONCILED_PRESENT'].includes(providerOperation.terminal.outcome)) {
      return false;
    }
    const relevant = this.repository.getRelevantProviderOperation(providerOperation.role);
    if (relevant?.operationId !== providerOperation.operationId) return false;
    const effective = this.repository.getEffectiveBinding(providerOperation.role);
    const operation = effective?.operation
      || (effective?.pendingOperation?.operationId
        ? this.repository.getBindingOperation(effective.pendingOperation.operationId)
        : null);
    if (!operation || operation.requestKey !== providerOperation.requestKey) {
      const desired = this.repository.getDesired(providerOperation.role);
      return desired?.bindingRevision === providerOperation.expectedBindingRevision;
    }
    const state = this.repository.getBindingApplicationState(operation.operationId);
    if (!state) return true;
    if (state.runtimeStatus === 'APPLIED') return false;
    return !(state.runtimeStatus === 'FAILED' && state.retryable === false);
  }

  #findResumableProviderOperation(role, targetModel) {
    const canonical = canonicalModelName(targetModel);
    const matches = this.repository.listResumableProviderOperations().filter(operation => (
      operation.role === role && operation.requestedCanonicalName === canonical
    ));
    if (matches.length > 1) {
      fail(
        'MODEL_BINDING_PROVIDER_RESUME_AMBIGUOUS',
        'Multiple durable provider intents could resume the same binding request',
        { role, targetModel, providerOperationIds: matches.map(item => item.operationId) },
        409,
      );
    }
    return matches[0] || null;
  }

  #resumeProviderOperation(providerOperation) {
    this.#assertProviderOperationOrigin(providerOperation);
    const desired = this.repository.getDesired(providerOperation.role);
    if (!desired || desired.bindingRevision !== providerOperation.expectedBindingRevision) {
      fail(
        'MODEL_BINDING_PROVIDER_RESUME_CAS_MISMATCH',
        'Durable provider intent cannot resume against a changed desired binding',
        {
          providerOperationId: providerOperation.operationId,
          expectedBindingRevision: providerOperation.expectedBindingRevision,
          actualBindingRevision: desired?.bindingRevision ?? null,
        },
        409,
      );
    }
    const terminal = providerOperation.terminal;
    if (!terminal || !['SUCCEEDED', 'RECONCILED_PRESENT'].includes(terminal.outcome)) {
      fail(
        'MODEL_BINDING_PROVIDER_RESUME_INVALID',
        'Provider intent has no exact present artifact to resume',
        { providerOperationId: providerOperation.operationId },
      );
    }
    return this.repository.recordUserBindingApply({
      requestKey: providerOperation.requestKey,
      role: providerOperation.role,
      expectedBindingRevision: providerOperation.expectedBindingRevision,
      targetModelName: terminal.observedModelName,
      targetDigestSha256: terminal.observedDigestSha256,
      actor: providerOperation.actor,
    });
  }

  #reconcileProviderOperation(operation, inventory) {
    this.#assertProviderOperationOrigin(operation);
    try {
      const resolved = this.provider.resolveFromInventory(
        inventory,
        operation.requestedModelName,
      );
      this.repository.recordManualProviderPullReconciledPresent({
        operationId: operation.operationId,
        claimToken: operation.claim.claimToken,
        expectedFencingRevision: operation.claim.fencingRevision,
        observedModelName: resolved.name,
        observedDigestSha256: resolved.digestSha256,
      });
      this._ownedProviderClaims.delete(operation.operationId);
      this.#cancelProviderRecovery(operation.operationId);
      return { outcome: 'RECONCILED_PRESENT', operation, resolved };
    } catch (error) {
      if (error?.code === 'MODEL_BINDING_TARGET_NOT_INSTALLED') {
        try {
          this.repository.recordManualProviderPullReconciledAbsent({
            operationId: operation.operationId,
            claimToken: operation.claim.claimToken,
            expectedFencingRevision: operation.claim.fencingRevision,
          });
          this._ownedProviderClaims.delete(operation.operationId);
          this.#cancelProviderRecovery(operation.operationId);
        } catch (auditError) {
          throw new ModelBindingApplicationError(
            'MODEL_BINDING_PROVIDER_RECONCILIATION_REQUIRED',
            'Observed provider absence could not be recorded durably',
            {
              cause: auditError,
              details: { providerOperationId: operation.operationId },
            },
          );
        }
        return { outcome: 'RECONCILED_ABSENT', operation };
      }
      throw new ModelBindingApplicationError(
        'MODEL_BINDING_PROVIDER_RECONCILIATION_REQUIRED',
        'A previous provider effect does not have a resolvable exact identity',
        {
          cause: error,
          details: { providerOperationId: operation.operationId },
        },
      );
    }
  }

  #assertProviderOperationOrigin(operation) {
    const providerOrigin = this.provider.getOrigin();
    if (operation.providerOrigin !== providerOrigin) {
      fail(
        'MODEL_BINDING_PROVIDER_ORIGIN_MISMATCH',
        'Provider operation cannot move between loopback provider origins',
        {
          providerOperationId: operation.operationId,
          recordedProviderOrigin: operation.providerOrigin,
          currentProviderOrigin: providerOrigin,
        },
        409,
      );
    }
  }

  #acquireModelUseLeases(modelNames, owner) {
    const modelsByCanonical = new Map();
    for (const value of modelNames) {
      const canonicalName = canonicalModelName(value);
      if (!canonicalName) {
        fail(
          'MODEL_BINDING_APPLICATION_INPUT_INVALID',
          'Model use lease requires an exact non-empty model identity',
          { modelName: value ?? null, owner },
        );
      }
      if (modelsByCanonical.has(canonicalName)) continue;
      modelsByCanonical.set(canonicalName, String(value).trim());
    }
    const leases = [];
    try {
      for (const canonicalName of [...modelsByCanonical.keys()].sort()) {
        leases.push(this.modelUseAuthority.acquireShared({
          modelName: modelsByCanonical.get(canonicalName),
          owner,
        }));
      }
    } catch (error) {
      for (const lease of [...leases].reverse()) lease.release();
      throw error;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const lease of [...leases].reverse()) lease.release();
    };
  }

  #bindingUseConflict(error, operation, phase) {
    if (error?.code !== 'MODEL_USE_EXCLUSIVE_ACTIVE') return error;
    const providerUnavailable = phase !== 'CUTOVER';
    return new ModelBindingApplicationError(
      providerUnavailable
        ? 'MODEL_BINDING_PROVIDER_UNAVAILABLE'
        : 'MODEL_BINDING_RUNTIME_GUARD_REJECTED',
      phase === 'VERIFICATION'
        ? 'Exact verification cannot start while the model artifact is being mutated'
        : phase === 'STARTUP_CUTOVER'
          ? 'Startup binding restore cannot run while a required model artifact is being mutated'
          : 'Binding cutover cannot start while a required model artifact is being mutated',
      {
        cause: error,
        details: {
          operationId: operation.operationId,
          role: operation.role,
          phase,
          modelUseCode: error.code,
          exclusiveOwner: error.details?.owner || null,
        },
      },
    );
  }

  async #executeOperation(operation, { startup }) {
    let state = this.repository.getBindingApplicationState(operation.operationId);
    if (!startup && state.runtimeFinalizeStatus === 'UNKNOWN') {
      this.#scheduleRuntimeFinalizeRecovery(operation);
      throw this.#runtimeFinalizeError(
        operation,
        null,
        'REPLAY_BLOCKED',
        'NOT_ATTEMPTED',
      );
    }
    if (!startup
      && state.runtimeStatus === 'APPLIED'
      && state.runtimeFinalizeStatus === 'DIRECT_CONFIRMED') {
      const runtime = this.runtime.snapshot(operation.role);
      const proposalResolution = this.#tryResolvePendingProposals(operation);
      let outcome = 'REPLAYED';
      if (state.notificationStatus === 'NOT_RECORDED') {
        const notification = await this.#publishBindingCommitted(operation, {
          from: operation.previousModelName,
          to: operation.targetModelName,
          configVersion: runtime.configVersion,
        });
        state = this.repository.getBindingApplicationState(operation.operationId);
        outcome = notification.status === 'SUCCEEDED'
          ? 'POST_COMMIT_REPAIRED'
          : 'APPLIED_NOTIFICATION_DEGRADED';
      }
      if (state.verificationStatus === 'NOT_VERIFIED') this.#scheduleVerification(operation);
      if (proposalResolution.status === 'REPAIR_PENDING'
        && outcome !== 'APPLIED_NOTIFICATION_DEGRADED') {
        outcome = 'APPLIED_PROPOSAL_REPAIR_PENDING';
      } else if (proposalResolution.status === 'SUCCEEDED'
        && proposalResolution.repaired
        && outcome === 'REPLAYED') {
        outcome = 'POST_COMMIT_REPAIRED';
      }
      return this.#result(
        operation,
        runtime.configVersion,
        state,
        outcome,
        proposalResolution,
      );
    }
    if (state.runtimeStatus === 'FAILED' && state.retryable === false) {
      fail(
        'MODEL_BINDING_APPLICATION_NONRETRYABLE_TERMINAL',
        'Manual binding requires a new user operation after a non-retryable failure',
        { operationId: operation.operationId, failureCode: state.failureCode },
        409,
      );
    }

    const snapshot = this.runtime.snapshot(operation.role);
    let releaseUseLeases;
    try {
      releaseUseLeases = this.#acquireModelUseLeases(
        [snapshot.modelName, operation.targetModelName],
        MODEL_ACTIVITY_OWNER.BINDING_CUTOVER,
      );
    } catch (error) {
      const conflict = this.#bindingUseConflict(
        error,
        operation,
        startup ? 'STARTUP_CUTOVER' : 'CUTOVER',
      );
      await this.#recordRuntimeFailure(operation, state, conflict, startup);
      throw conflict;
    }

    let resolved;
    let token;
    let runtimeResult;
    try {
      try {
        resolved = await this.provider.resolveExact(operation.targetModelName, {
          expectedDigestSha256: operation.targetDigestSha256,
        });
        token = this.runtime.prepare({
          role: operation.role,
          expectedModel: startup ? snapshot.modelName : operation.previousModelName,
          targetModel: resolved.name,
          incrementVersion: !startup,
        });
      } catch (error) {
        await this.#recordRuntimeFailure(operation, state, error, startup);
        throw error;
      }

      try {
        state = this.repository.getBindingApplicationState(operation.operationId);
        const recorded = startup
          ? this.repository.recordManualStartupRehydrated({
            operationId: operation.operationId,
            expectedAttemptRevision: state.attemptRevision,
            observedModelName: resolved.name,
            observedDigestSha256: resolved.digestSha256,
            runtimeChanged: token.changed,
          })
          : this.repository.recordManualRuntimeApplied({
            operationId: operation.operationId,
            expectedAttemptRevision: state.attemptRevision,
            observedModelName: resolved.name,
            observedDigestSha256: resolved.digestSha256,
            runtimeChanged: token.changed,
          });
        state = recorded.applicationState;
      } catch (error) {
        this.#scheduleRuntimeFinalizeRecovery(operation);
        let compensationOutcome = 'COMPENSATED';
        try {
          this.runtime.compensate(token);
        } catch (compensationError) {
          compensationOutcome = 'COMPENSATION_FAILED';
        }
        let latest = null;
        try {
          latest = this.repository.getBindingApplicationState(operation.operationId);
        } catch (readError) {
          this.#scheduleRuntimeFinalizeRecovery(operation);
          throw this.#runtimeFinalizeError(
            operation,
            readError,
            'RUNTIME_ATTEMPT_READBACK',
            compensationOutcome,
          );
        }
        if (latest?.runtimeFinalizeStatus === 'UNKNOWN') {
          throw this.#runtimeFinalizeError(
            operation,
            error,
            'RUNTIME_ATTEMPT_AUDIT',
            compensationOutcome,
          );
        }
        this.#cancelRuntimeFinalizeRecovery(operation.operationId);
        if (compensationOutcome === 'COMPENSATION_FAILED') {
          throw new ModelBindingApplicationError(
            'MODEL_BINDING_RUNTIME_COMPENSATION_REQUIRED',
            'Runtime changed but durable application failed and compensation could not complete',
            { cause: error, details: { operationId: operation.operationId } },
          );
        }
        try {
          await this.#recordRuntimeFailure(operation, latest, error, startup);
        } catch (auditError) {
          this.logger.warn('ModelBindingApplication', `Compensation audit failed: ${auditError.message}`);
        }
        throw asApplicationError(
          error,
          startup
            ? 'MODEL_BINDING_REHYDRATE_RUNTIME_COMMIT_FAILED'
            : 'MODEL_BINDING_RUNTIME_COMMIT_FAILED',
          'Durable binding application failed after runtime preparation',
          { operationId: operation.operationId },
        );
      }

      // This is deliberately synchronous after the repository commit: no user
      // callback or await may enter the DB-success -> runtime-finalize window.
      // Both exact model identities remain reserved until finalization returns.
      let commitReturned = false;
      try {
        runtimeResult = this.runtime.commit(token);
        commitReturned = true;
        this.#validateRuntimeCommitResult(operation, token, runtimeResult);
      } catch (error) {
        let compensationOutcome = 'NOT_ATTEMPTED';
        if (!commitReturned) {
          try {
            this.runtime.compensate(token);
            compensationOutcome = 'COMPENSATED';
          } catch {
            compensationOutcome = 'COMPENSATION_FAILED';
          }
        }
        this.#scheduleRuntimeFinalizeRecovery(operation);
        throw this.#runtimeFinalizeError(
          operation,
          error,
          'RUNTIME_COMMIT',
          compensationOutcome,
        );
      }

      try {
        const finalized = this.repository.recordManualRuntimeFinalized({
          operationId: operation.operationId,
          expectedAttemptRevision: state.attemptRevision,
          configVersion: runtimeResult.configVersion,
        });
        state = finalized.applicationState;
        this.#cancelRuntimeFinalizeRecovery(operation.operationId);
      } catch (error) {
        let latest = null;
        try {
          latest = this.repository.getBindingApplicationState(operation.operationId);
        } catch (readError) {
          this.#scheduleRuntimeFinalizeRecovery(operation);
          throw this.#runtimeFinalizeError(
            operation,
            readError,
            'RUNTIME_FINALIZE_RECEIPT_READBACK',
            'NOT_ATTEMPTED',
          );
        }
        if (latest?.runtimeFinalizeStatus === 'DIRECT_CONFIRMED') {
          state = latest;
          this.#cancelRuntimeFinalizeRecovery(operation.operationId);
        } else {
          this.#scheduleRuntimeFinalizeRecovery(operation);
          throw this.#runtimeFinalizeError(
            operation,
            error,
            'RUNTIME_FINALIZE_RECEIPT',
            'NOT_ATTEMPTED',
          );
        }
      }
    } finally {
      releaseUseLeases();
    }
    return this.#finishCommittedOperation(operation, state, runtimeResult, startup);
  }

  async #finishCommittedOperation(operation, state, runtimeResult, startup) {
    if (startup) {
      const proposalResolution = this.#tryResolvePendingProposals(operation);
      if (proposalResolution.status === 'REPAIR_PENDING') {
        this.#scheduleProposalRepair(operation);
      }
      const currentState = this.repository.getBindingApplicationState(operation.operationId);
      if (currentState.notificationStatus === 'NOT_RECORDED') {
        this.#scheduleNotification(operation, runtimeResult);
      }
      this.#scheduleVerification(operation);
      return this.#result(
        operation,
        runtimeResult.configVersion,
        state,
        proposalResolution.status === 'SUCCEEDED'
          ? 'REHYDRATED'
          : 'REHYDRATED_PROPOSAL_REPAIR_PENDING',
        proposalResolution,
      );
    }

    const proposalResolution = this.#tryResolvePendingProposals(operation);
    const notification = await this.#publishBindingCommitted(operation, runtimeResult);
    this.#scheduleVerification(operation);
    return this.#result(
      operation,
      runtimeResult.configVersion,
      this.repository.getBindingApplicationState(operation.operationId),
      notification.status !== 'SUCCEEDED'
        ? 'APPLIED_NOTIFICATION_DEGRADED'
        : proposalResolution.status === 'SUCCEEDED'
          ? 'APPLIED'
          : 'APPLIED_PROPOSAL_REPAIR_PENDING',
      proposalResolution,
    );
  }

  #tryResolvePendingProposals(operation) {
    try {
      const result = this.#resolvePendingProposals(operation);
      return Object.freeze({
        status: 'SUCCEEDED',
        warningCode: null,
        repaired: result.approved !== null || result.expired > 0,
        result,
      });
    } catch (error) {
      this.logger.warn(
        'ModelBindingApplication',
        `Binding ${operation.operationId} committed; proposal repair remains pending: ${error.message}`,
      );
      return Object.freeze({
        status: 'REPAIR_PENDING',
        warningCode: error?.code || 'MODEL_BINDING_PROPOSAL_RESOLUTION_FAILED',
        repaired: false,
        result: null,
      });
    }
  }

  #resolvePendingProposals(operation) {
    try {
      const result = this.runtime.resolvePendingProposals(
        operation.role,
        operation.targetModelName,
        operation.kind,
      );
      if (!isPlainObject(result)
        || !(result.approved === null || Number.isSafeInteger(result.approved))
        || !Number.isSafeInteger(result.expired)
        || result.expired < 0) {
        fail(
          'MODEL_BINDING_PROPOSAL_RESOLUTION_INVALID',
          'Proposal resolver returned an invalid result',
          { operationId: operation.operationId },
        );
      }
      return result;
    } catch (error) {
      throw asApplicationError(
        error,
        'MODEL_BINDING_PROPOSAL_RESOLUTION_FAILED',
        'Binding committed but proposal resolution needs an idempotent retry',
        { operationId: operation.operationId, bindingCommitted: true },
      );
    }
  }

  #scheduleProposalRepair(operation) {
    if (this._pendingProposalRepairs.has(operation.operationId)
      || this._background.has(`proposal:${operation.operationId}`)) return;
    this._pendingProposalRepairs.set(operation.operationId, operation);
    if (this._verificationStarted) this.#enqueueProposalRepair(operation);
  }

  #enqueueProposalRepair(operation) {
    const key = `proposal:${operation.operationId}`;
    if (this._background.has(key)) return;
    this._pendingProposalRepairs.delete(operation.operationId);
    const task = Promise.resolve()
      .then(() => this.#tryResolvePendingProposals(operation))
      .then(result => {
        if (result.status === 'REPAIR_PENDING') {
          this.logger.warn(
            'ModelBindingApplication',
            `Proposal repair remains pending for ${operation.operationId}`,
          );
        }
        return result;
      })
      .finally(() => this._background.delete(key));
    this._background.set(key, task);
  }

  async #recordRuntimeFailure(operation, state, error, startup) {
    const code = startup ? rehydrateFailureCode(error) : runtimeFailureCode(error);
    const latest = this.repository.getBindingApplicationState(operation.operationId) || state;
    const result = startup
      ? this.repository.recordManualStartupRehydrateFailed({
        operationId: operation.operationId,
        expectedAttemptRevision: latest.attemptRevision,
        failureCode: code,
      })
      : this.repository.recordManualRuntimeApplyFailed({
        operationId: operation.operationId,
        expectedAttemptRevision: latest.attemptRevision,
        failureCode: code,
      });
    return result.applicationState;
  }

  async #publishBindingCommitted(operation, runtimeResult) {
    let deliveryError = null;
    let failureCode = null;
    try {
      const receipt = await this.publishControl({
        action: 'model_changed',
        role: operation.role,
        fromModel: runtimeResult.from,
        toModel: runtimeResult.to,
        configVersion: runtimeResult.configVersion,
      });
      if (!isPlainObject(receipt) || receipt.accepted !== true) {
        deliveryError = new Error('Control publisher did not issue an accepted receipt');
        failureCode = 'MODEL_BINDING_NOTIFICATION_RECEIPT_NOT_ISSUED';
      }
    } catch (error) {
      deliveryError = error;
      failureCode = 'MODEL_BINDING_NOTIFICATION_DELIVERY_FAILED';
    }
    const state = this.repository.getBindingApplicationState(operation.operationId);
    try {
      if (deliveryError) {
        this.repository.recordManualNotificationFailed({
          operationId: operation.operationId,
          expectedAttemptRevision: state.attemptRevision,
          failureCode,
        });
        return { status: 'FAILED', error: deliveryError };
      }
      this.repository.recordManualNotificationSucceeded({
        operationId: operation.operationId,
        expectedAttemptRevision: state.attemptRevision,
      });
      return { status: 'SUCCEEDED' };
    } catch (error) {
      this.logger.warn('ModelBindingApplication', `Notification audit failed: ${error.message}`);
      return { status: 'FAILED', error };
    }
  }

  #scheduleNotification(operation, runtimeResult) {
    const key = operation.operationId;
    if (this._pendingNotifications.has(key)
      || this._background.has(`notification:${key}`)) return;
    const entry = Object.freeze({ operation, runtimeResult: Object.freeze({ ...runtimeResult }) });
    this._pendingNotifications.set(key, entry);
    if (this._verificationStarted) this.#enqueueNotification(operation, runtimeResult);
  }

  #enqueueNotification(operation, runtimeResult) {
    const key = `notification:${operation.operationId}`;
    if (this._background.has(key)) return;
    this._pendingNotifications.delete(operation.operationId);
    const task = Promise.resolve()
      .then(() => this.#publishBindingCommitted(operation, runtimeResult))
      .catch(error => {
        this.logger.warn('ModelBindingApplication', `Notification repair failed: ${error.message}`);
        return { status: 'FAILED', error };
      })
      .finally(() => this._background.delete(key));
    this._background.set(key, task);
  }

  #scheduleVerification(operation) {
    if (this._background.has(operation.operationId)
      || this._pendingVerification.has(operation.operationId)) return;
    this._pendingVerification.set(operation.operationId, operation);
    if (this._verificationStarted) this.#enqueueVerification(operation);
  }

  #enqueueVerification(operation) {
    if (this._background.has(operation.operationId)) return;
    this._pendingVerification.delete(operation.operationId);
    const task = this._verificationTail
      .catch(() => {})
      .then(() => this.#verifyOperation(operation))
      .catch(error => {
        this.logger.warn('ModelBindingApplication', `Verification task failed: ${error.message}`);
        return { ok: false, error };
      })
      .finally(() => this._background.delete(operation.operationId));
    this._background.set(operation.operationId, task);
    this._verificationTail = task;
  }

  async #verifyOperation(operation) {
    let lastError = null;
    let attempts = 0;
    for (let index = 0; index < this.verificationAttempts; index++) {
      attempts++;
      let resolved;
      let releaseUseLease = null;
      let probeCompleted = false;
      try {
        try {
          releaseUseLease = this.#acquireModelUseLeases(
            [operation.targetModelName],
            MODEL_ACTIVITY_OWNER.BINDING_VERIFICATION,
          );
        } catch (error) {
          throw this.#bindingUseConflict(error, operation, 'VERIFICATION');
        }
        resolved = await this.provider.verifyExact({
          modelName: operation.targetModelName,
          canonicalName: operation.targetCanonicalName,
          digestSha256: operation.targetDigestSha256,
        });
        probeCompleted = true;
        // Provider truth and durable audit truth are separate. A repository
        // failure after a successful probe must not be recast as model failure.
        if (!this.#isCurrentOperation(operation)) return { ok: false, stale: true };
        const state = this.repository.getBindingApplicationState(operation.operationId);
        this.repository.recordManualVerificationSucceeded({
          operationId: operation.operationId,
          expectedAttemptRevision: state.attemptRevision,
          observedModelName: resolved.name,
          observedDigestSha256: resolved.digestSha256,
        });
        // Decision 022/A: UX invalidation only. A live panel can drop a stale
        // warning; the guarantee itself is the transactional CAS, never this
        // best-effort event.
        this.#publishBestEffort({
          action: 'upgrade_verify_cleared',
          role: operation.role,
          model: operation.targetModelName,
          operationId: operation.operationId,
          committedBindingRevision: operation.committedBindingRevision,
        });
        return { ok: true };
      } catch (error) {
        if (probeCompleted) throw error;
        lastError = error;
        const code = verificationFailureCode(error);
        if (code === 'MODEL_BINDING_VERIFICATION_DIGEST_DRIFT'
          || index === this.verificationAttempts - 1) break;
      } finally {
        releaseUseLease?.();
      }
      await this.delay(this.verificationRetryDelayMs);
    }
    if (!this.#isCurrentOperation(operation)) return { ok: false, stale: true };
    const state = this.repository.getBindingApplicationState(operation.operationId);
    const recorded = this.repository.recordManualVerificationFailed({
      operationId: operation.operationId,
      expectedAttemptRevision: state.attemptRevision,
      failureCode: verificationFailureCode(lastError),
    });
    // Decision 022/A: the warning carries the exact operation identity, so an
    // actionable rollback can be bound to this failure and nothing newer. The
    // addition is additive — an older client ignores the unknown fields.
    this.#publishBestEffort({
      action: 'upgrade_verify_failed',
      role: operation.role,
      model: operation.targetModelName,
      operationId: operation.operationId,
      committedBindingRevision: operation.committedBindingRevision,
      failedAttemptRevision: recorded.attempt.attemptRevision,
      text: `Varování: ${operation.targetModelName} neprošel exact probe po ${attempts} pokusech. Zvažte rollback.`,
    });
    return { ok: false, error: lastError };
  }

  #isCurrentOperation(operation) {
    const desired = this.repository.getDesired(operation.role);
    return desired
      && desired.bindingRevision === operation.committedBindingRevision
      && desired.lastEventId === operation.desiredEventId
      && desired.digestSha256 === operation.targetDigestSha256;
  }

  #publishBestEffort(payload) {
    try {
      const pending = this.publishControl(payload);
      if (pending && typeof pending.catch === 'function') {
        pending.catch(error => {
          this.logger.warn('ModelBindingApplication', `Control publish failed: ${error.message}`);
        });
      }
    } catch (error) {
      this.logger.warn('ModelBindingApplication', `Control publish failed: ${error.message}`);
    }
  }

  #result(operation, configVersion, state, outcome, proposalResolution = null) {
    const publicState = publicApplicationState(state);
    return {
      ok: true,
      role: operation.role,
      from: operation.previousModelName,
      to: operation.targetModelName,
      changed: !sameModelName(operation.previousModelName, operation.targetModelName),
      verified: publicState.verificationStatus === 'VERIFIED',
      configVersion,
      operationId: operation.operationId,
      applicationState: publicState.state,
      notificationStatus: publicState.notificationStatus,
      proposalResolutionStatus: proposalResolution?.status || 'NOT_APPLICABLE',
      warningCode: proposalResolution?.warningCode || null,
      outcome,
    };
  }
}

export function createOllamaModelBindingProvider(options) {
  return new OllamaModelBindingProvider(options);
}

export function createModelBindingApplication(options) {
  return new ModelBindingApplication(options);
}
