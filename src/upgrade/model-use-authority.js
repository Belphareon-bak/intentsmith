// Single-process coordination for provider effects that address a model.
//
// Shared leases represent active inference/validation/verification. Exclusive
// leases represent provider mutations such as pull and delete.
// Acquisition is deliberately fail-fast: an HTTP request must never wait behind
// an unbounded model call while holding some other product-level authority.

import { canonicalModelName } from './model-identity.js';

export const MODEL_ACTIVITY_OWNER = Object.freeze({
  LLM_GATEWAY: 'LLM_GATEWAY',
  MODEL_VALIDATION: 'MODEL_VALIDATION',
  BINDING_CUTOVER: 'BINDING_CUTOVER',
  FAILOVER_CUTOVER: 'FAILOVER_CUTOVER',
  BINDING_VERIFICATION: 'BINDING_VERIFICATION',
  VRAM_ARTIFACT_USE: 'VRAM_ARTIFACT_USE',
  MODEL_PULL: 'MODEL_PULL',
  MODEL_DELETE: 'MODEL_DELETE',
});

const VALID_OWNERS = new Set(Object.values(MODEL_ACTIVITY_OWNER));
const SHARED_OWNERS = new Set([
  MODEL_ACTIVITY_OWNER.LLM_GATEWAY,
  MODEL_ACTIVITY_OWNER.MODEL_VALIDATION,
  MODEL_ACTIVITY_OWNER.BINDING_CUTOVER,
  MODEL_ACTIVITY_OWNER.FAILOVER_CUTOVER,
  MODEL_ACTIVITY_OWNER.BINDING_VERIFICATION,
  MODEL_ACTIVITY_OWNER.VRAM_ARTIFACT_USE,
]);
const EXCLUSIVE_OWNERS = new Set([
  MODEL_ACTIVITY_OWNER.MODEL_PULL,
  MODEL_ACTIVITY_OWNER.MODEL_DELETE,
]);

export class ModelUseAuthorityError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'ModelUseAuthorityError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = null) {
  throw new ModelUseAuthorityError(code, message, details);
}

function requireRequest(inputValue) {
  if (inputValue === null || typeof inputValue !== 'object' || Array.isArray(inputValue)) {
    fail('MODEL_USE_INPUT_INVALID', 'Model activity request must be a plain object');
  }
  const prototype = Object.getPrototypeOf(inputValue);
  if (prototype !== Object.prototype && prototype !== null) {
    fail('MODEL_USE_INPUT_INVALID', 'Model activity request must be a plain object');
  }
  const keys = Object.keys(inputValue).sort();
  if (keys.length !== 2 || keys[0] !== 'modelName' || keys[1] !== 'owner') {
    fail('MODEL_USE_INPUT_INVALID', 'Model activity request must contain only modelName and owner');
  }
  const canonicalName = canonicalModelName(inputValue.modelName);
  if (!canonicalName || !VALID_OWNERS.has(inputValue.owner)) {
    fail('MODEL_USE_INPUT_INVALID', 'Model activity request has an invalid modelName or owner');
  }
  return Object.freeze({
    modelName: String(inputValue.modelName).trim(),
    canonicalName,
    owner: inputValue.owner,
  });
}

function requireCallback(callback) {
  if (typeof callback !== 'function') {
    fail('MODEL_USE_INPUT_INVALID', 'Model activity callback must be a function');
  }
}

export class ModelUseAuthority {
  constructor() {
    this._states = new Map();
    this._nextLeaseId = 1;
  }

  #stateFor(canonicalName) {
    let state = this._states.get(canonicalName);
    if (!state) {
      state = { readers: new Map(), writer: null };
      this._states.set(canonicalName, state);
    }
    return state;
  }

  #release(canonicalName, mode, leaseId) {
    const state = this._states.get(canonicalName);
    if (!state) {
      fail('MODEL_USE_LEASE_RELEASED', 'Model activity lease is no longer active');
    }
    if (mode === 'SHARED') {
      if (!state.readers.delete(leaseId)) {
        fail('MODEL_USE_LEASE_RELEASED', 'Shared model activity lease is no longer active');
      }
    } else if (state.writer?.leaseId === leaseId) {
      state.writer = null;
    } else {
      fail('MODEL_USE_LEASE_RELEASED', 'Exclusive model activity lease is no longer active');
    }
    if (state.readers.size === 0 && state.writer === null) {
      this._states.delete(canonicalName);
    }
  }

  #lease(request, mode) {
    const modeOwners = mode === 'SHARED' ? SHARED_OWNERS : EXCLUSIVE_OWNERS;
    if (!modeOwners.has(request.owner)) {
      fail(
        'MODEL_USE_INPUT_INVALID',
        `${request.owner} is not valid for a ${mode.toLowerCase()} model activity lease`,
      );
    }
    const state = this.#stateFor(request.canonicalName);
    if (mode === 'SHARED' && state.writer) {
      fail(
        'MODEL_USE_EXCLUSIVE_ACTIVE',
        `Model provider mutation is already active for ${request.modelName}`,
        { canonicalName: request.canonicalName, owner: state.writer.owner },
      );
    }
    if (mode === 'EXCLUSIVE' && state.writer) {
      fail(
        'MODEL_MUTATION_EXCLUSIVE_ACTIVE',
        `Another model provider mutation is already active for ${request.modelName}`,
        { canonicalName: request.canonicalName, owner: state.writer.owner },
      );
    }
    if (mode === 'EXCLUSIVE' && state.readers.size > 0) {
      const activeOwners = [...new Set(
        [...state.readers.values()].map(reader => reader.owner),
      )].sort();
      fail(
        'MODEL_MUTATION_ACTIVE_USE',
        `Model is actively in use: ${request.modelName}`,
        {
          canonicalName: request.canonicalName,
          activeUseCount: state.readers.size,
          activeOwners,
        },
      );
    }

    const leaseId = this._nextLeaseId++;
    if (mode === 'SHARED') {
      state.readers.set(leaseId, Object.freeze({ leaseId, owner: request.owner }));
    } else {
      state.writer = Object.freeze({ leaseId, owner: request.owner });
    }

    let released = false;
    return Object.freeze({
      modelName: request.modelName,
      canonicalName: request.canonicalName,
      owner: request.owner,
      mode,
      release: () => {
        if (released) {
          fail('MODEL_USE_LEASE_RELEASED', 'Model activity lease was already released');
        }
        released = true;
        this.#release(request.canonicalName, mode, leaseId);
      },
    });
  }

  acquireShared(inputValue) {
    return this.#lease(requireRequest(inputValue), 'SHARED');
  }

  acquireExclusive(inputValue) {
    return this.#lease(requireRequest(inputValue), 'EXCLUSIVE');
  }

  async runShared(inputValue, callback) {
    requireCallback(callback);
    const lease = this.acquireShared(inputValue);
    try {
      return await callback();
    } finally {
      lease.release();
    }
  }

  async runExclusive(inputValue, callback) {
    requireCallback(callback);
    const lease = this.acquireExclusive(inputValue);
    try {
      return await callback();
    } finally {
      lease.release();
    }
  }

  snapshot(modelName) {
    const canonicalName = canonicalModelName(modelName);
    if (!canonicalName) {
      fail('MODEL_USE_INPUT_INVALID', 'Model activity snapshot requires a valid modelName');
    }
    const state = this._states.get(canonicalName);
    return Object.freeze({
      canonicalName,
      activeUseCount: state?.readers.size || 0,
      exclusiveOwner: state?.writer?.owner || null,
    });
  }
}

export const modelUseAuthority = new ModelUseAuthority();

export default modelUseAuthority;
