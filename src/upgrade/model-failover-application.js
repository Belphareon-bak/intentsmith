// Runtime application boundary for the accepted D+ automatic failover policy.
//
// The repository owns durable desired/incident/proof/claim authority.  This
// service intersects that authority with one strict local inventory snapshot,
// reserves both runtime artifacts, prepares the shared binding runtime CAS,
// commits the terminal event, finalizes the runtime synchronously and records
// an append-only receipt.  It never pulls, deletes, validates or renews proof.

import { logger as defaultLogger } from '../core/logger.js';
import {
  canonicalModelName,
  sameModelName,
} from './model-identity.js';
import { getModelFailoverProofContract } from './model-failover-proof-policy.js';
import {
  MODEL_ACTIVITY_OWNER,
  modelUseAuthority,
} from './model-use-authority.js';
import { MODEL_FAILOVER_ROLES } from './model-failover.js';

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const DEFAULT_CLAIM_LEASE_MS = 60_000;
const TERMINAL_EVENT_TO_KIND = Object.freeze({
  ACTIVATED: 'ACTIVATE',
  REAPPLIED: 'REAPPLY',
  RESTORED: 'RESTORE',
});

export class ModelFailoverApplicationError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'ModelFailoverApplicationError';
    this.code = code;
    this.details = options.details || null;
  }
}

function fail(code, message, details = null) {
  throw new ModelFailoverApplicationError(code, message, { details });
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireExactInput(value, allowed) {
  if (!isPlainObject(value)) {
    fail('MODEL_FAILOVER_APPLICATION_INPUT_INVALID', 'Failover application input must be a plain object');
  }
  const unexpected = Object.keys(value).filter(key => !allowed.includes(key)).sort();
  if (unexpected.length > 0) {
    fail(
      'MODEL_FAILOVER_APPLICATION_AUTHORITY_OVERRIDE_REJECTED',
      'Failover application input contains unknown or authority-owned fields',
      { fields: unexpected },
    );
  }
  return value;
}

function requireRole(value) {
  if (typeof value !== 'string'
    || value !== value.trim().toUpperCase()
    || !MODEL_FAILOVER_ROLES.includes(value)) {
    fail('MODEL_FAILOVER_APPLICATION_ROLE_INVALID', 'role must be an exact failover role');
  }
  return value;
}

function requireBoolean(value, field) {
  if (typeof value !== 'boolean') {
    fail('MODEL_FAILOVER_APPLICATION_INPUT_INVALID', `${field} must be a boolean`);
  }
  return value;
}

function freezeResult(value) {
  if (Array.isArray(value)) {
    for (const entry of value) freezeResult(entry);
  } else if (isPlainObject(value)) {
    for (const entry of Object.values(value)) freezeResult(entry);
  }
  return Object.freeze(value);
}

function normalizeInventory(value) {
  if (!Array.isArray(value) || value.length === 0) {
    fail('MODEL_FAILOVER_INVENTORY_INVALID', 'Installed model inventory must be a non-empty array');
  }
  const artifacts = [];
  const seen = new Set();
  for (const entry of value) {
    if (!isPlainObject(entry)) {
      fail('MODEL_FAILOVER_INVENTORY_INVALID', 'Installed model inventory entry is invalid');
    }
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    const canonicalName = canonicalModelName(name);
    const reportedCanonical = typeof entry.canonicalName === 'string'
      ? entry.canonicalName.trim()
      : '';
    const digestSha256 = typeof entry.digestSha256 === 'string'
      ? entry.digestSha256.trim()
      : '';
    if (!name
      || !canonicalName
      || reportedCanonical !== canonicalName
      || !DIGEST_PATTERN.test(digestSha256)
      || seen.has(canonicalName)) {
      fail(
        'MODEL_FAILOVER_INVENTORY_INVALID',
        'Installed model inventory is ambiguous or lacks an exact digest',
        { modelName: name || null, canonicalName: canonicalName || null },
      );
    }
    seen.add(canonicalName);
    artifacts.push(Object.freeze({ name, canonicalName, digestSha256 }));
  }
  return Object.freeze(artifacts.sort((left, right) => (
    left.canonicalName.localeCompare(right.canonicalName)
  )));
}

function exactArtifact(inventory, modelName, digestSha256) {
  const canonicalName = canonicalModelName(modelName);
  if (!canonicalName || !DIGEST_PATTERN.test(digestSha256)) return null;
  const matches = inventory.filter(artifact => artifact.canonicalName === canonicalName);
  if (matches.length !== 1) return null;
  const artifact = matches[0];
  return artifact.name === modelName && artifact.digestSha256 === digestSha256
    ? artifact
    : null;
}

function selectProof(proofs, inventory, predicate) {
  for (const proof of proofs) {
    if (!predicate(proof)) continue;
    const artifact = exactArtifact(inventory, proof.modelName, proof.modelDigestSha256);
    if (artifact
      && artifact.canonicalName === proof.modelCanonicalName) {
      return Object.freeze({ proof, artifact });
    }
  }
  return null;
}

function operationFailurePhase(kind, error) {
  if (kind === 'RESTORE') return 'RESTORE';
  if (error?.code === 'MODEL_FAILOVER_PROOF_INELIGIBLE'
    || error?.code === 'MODEL_FAILOVER_INVENTORY_INVALID'
    || error?.code === 'MODEL_BINDING_TARGET_DIGEST_DRIFT'
    || error?.code === 'MODEL_BINDING_TARGET_NOT_INSTALLED') {
    return 'VERIFICATION';
  }
  if (String(error?.code || '').includes('RUNTIME')) return 'RUNTIME_APPLY';
  return 'PERSISTENCE';
}

export class ModelFailoverApplication {
  constructor(options = {}) {
    if (!isPlainObject(options)) {
      fail('MODEL_FAILOVER_APPLICATION_OPTIONS_INVALID', 'Application options must be a plain object');
    }
    this.repository = options.repository;
    this.provider = options.provider;
    this.runtime = options.runtime;
    this.mutationOwner = options.mutationOwner;
    this.modelUseAuthority = options.modelUseAuthority || modelUseAuthority;
    this.publishControl = options.publishControl || (() => {});
    this.logger = options.logger || defaultLogger;
    this.claimLeaseMs = options.claimLeaseMs ?? DEFAULT_CLAIM_LEASE_MS;

    const repositoryMethods = [
      'getDesired',
      'getState',
      'listActiveForRestart',
      'listEligibleProofs',
      'claimOperation',
      'completeOperation',
      'failOperation',
      'getRuntimeFinalization',
      'listPendingRuntimeFinalizations',
      'recordRuntimeFinalized',
      'getRuntimeHealth',
      'recordActiveProofExpired',
    ];
    for (const method of repositoryMethods) {
      if (typeof this.repository?.[method] !== 'function') {
        fail('MODEL_FAILOVER_APPLICATION_OPTIONS_INVALID', `Repository is missing ${method}`);
      }
    }
    for (const method of ['listInstalled', 'resolveExact']) {
      if (typeof this.provider?.[method] !== 'function') {
        fail('MODEL_FAILOVER_APPLICATION_OPTIONS_INVALID', `Provider is missing ${method}`);
      }
    }
    for (const method of ['snapshot', 'prepare', 'commit', 'compensate']) {
      if (typeof this.runtime?.[method] !== 'function') {
        fail('MODEL_FAILOVER_APPLICATION_OPTIONS_INVALID', `Runtime is missing ${method}`);
      }
    }
    if (typeof this.mutationOwner?.runExclusiveAutomaticFailover !== 'function'
      || typeof this.modelUseAuthority?.acquireShared !== 'function'
      || typeof this.publishControl !== 'function'
      || !Number.isSafeInteger(this.claimLeaseMs)
      || this.claimLeaseMs < 1) {
      fail('MODEL_FAILOVER_APPLICATION_OPTIONS_INVALID', 'Application dependencies are invalid');
    }
  }

  async runRole(inputValue) {
    const input = requireExactInput(inputValue, ['role', 'startup']);
    const role = requireRole(input.role);
    const startup = input.startup === undefined ? false : requireBoolean(input.startup, 'startup');
    return this.mutationOwner.runExclusiveAutomaticFailover(
      { kind: 'AUTOMATIC_FAILOVER' },
      () => this.#runOwned(role, startup),
    );
  }

  async runAll() {
    const roles = [];
    for (const role of MODEL_FAILOVER_ROLES) {
      try {
        roles.push(await this.runRole({ role, startup: false }));
      } catch (error) {
        roles.push(freezeResult({
          role,
          status: 'INCONCLUSIVE',
          reason: error?.code || 'MODEL_FAILOVER_APPLICATION_FAILED',
        }));
      }
    }
    return freezeResult({ status: 'COMPLETED', roles });
  }

  async recoverStartup() {
    const activeRoles = new Set(this.repository.listActiveForRestart().map(state => state.role));
    for (const pending of this.repository.listPendingRuntimeFinalizations()) {
      activeRoles.add(pending.role);
    }
    const roles = [];
    for (const role of [...activeRoles].sort()) {
      try {
        roles.push(await this.runRole({ role, startup: true }));
      } catch (error) {
        roles.push(freezeResult({
          role,
          status: 'INCONCLUSIVE',
          reason: error?.code || 'MODEL_FAILOVER_STARTUP_RECOVERY_FAILED',
        }));
      }
    }
    return freezeResult({ status: 'COMPLETED', roles });
  }

  async #runOwned(role, startup) {
    const desired = this.repository.getDesired(role);
    const state = this.repository.getState(role);
    if (!desired || !state) {
      return freezeResult({ role, status: 'UNCHANGED', reason: 'NO_FAILOVER_INCIDENT' });
    }

    const pending = this.repository.listPendingRuntimeFinalizations()
      .filter(entry => entry.role === role);
    if (pending.length > 1) {
      fail(
        'MODEL_FAILOVER_RUNTIME_FINALIZE_AMBIGUOUS',
        'More than one unfinalized runtime transition exists for a role',
        { role, operationIds: pending.map(entry => entry.operationId) },
      );
    }
    if (pending.length === 1) {
      return this.#recoverPending(pending[0], desired, state, startup);
    }

    if (!['DETECTED', 'ACTIVATED'].includes(state.state)) {
      return freezeResult({
        role,
        status: 'UNCHANGED',
        reason: `INCIDENT_${state.state}`,
      });
    }

    const inventory = normalizeInventory(await this.provider.listInstalled());
    const desiredArtifact = exactArtifact(inventory, desired.modelName, desired.digestSha256);
    const proofContract = getModelFailoverProofContract(role);

    if (state.state === 'DETECTED') {
      if (desiredArtifact) {
        return freezeResult({ role, status: 'UNCHANGED', reason: 'DESIRED_PRESENT_EXACT' });
      }
      const proofs = this.repository.listEligibleProofs({
        role,
        roleContractSha256: proofContract.roleContractSha256,
        requireAutoFailoverEnabled: true,
      });
      const selected = selectProof(
        proofs,
        inventory,
        proof => proof.modelCanonicalName !== desired.canonicalName,
      );
      if (!selected) {
        return freezeResult({ role, status: 'UNCHANGED', reason: 'NO_ELIGIBLE_LOCAL_FALLBACK' });
      }
      return this.#executeTransition({
        role,
        desired,
        state,
        kind: 'ACTIVATE',
        selected,
        startup,
        roleContractSha256: proofContract.roleContractSha256,
      });
    }

    const health = this.repository.getRuntimeHealth(role);
    if (desiredArtifact) {
      const proofs = this.repository.listEligibleProofs({
        role,
        roleContractSha256: proofContract.roleContractSha256,
        requireAutoFailoverEnabled: false,
      });
      const selected = selectProof(
        proofs,
        inventory,
        proof => proof.modelName === desired.modelName
          && proof.modelCanonicalName === desired.canonicalName
          && proof.modelDigestSha256 === desired.digestSha256,
      );
      if (!selected) {
        return freezeResult({ role, status: 'UNCHANGED', reason: 'DESIRED_PROOF_NOT_FRESH' });
      }
      return this.#executeTransition({
        role,
        desired,
        state,
        kind: 'RESTORE',
        selected,
        startup,
        roleContractSha256: proofContract.roleContractSha256,
      });
    }

    const runtimeSnapshot = this.runtime.snapshot(role);
    if (health?.status !== 'HEALTHY') {
      const recorded = health?.status === 'PROOF_EXPIRED_UNRECORDED'
        ? this.repository.recordActiveProofExpired({
          role,
          episodeId: state.episodeId,
          expectedRowVersion: state.rowVersion,
          activeEventId: state.activeEventId,
        })
        : { outcome: 'ALREADY_RECORDED', health };
      if (recorded.outcome === 'RECORDED') {
        this.#publishBestEffort({
          action: 'model_failover_degraded',
          role,
          status: 'DEGRADED_PROOF_EXPIRED',
          model: state.fallbackModelName,
        });
      }
      return freezeResult({
        role,
        status: 'DEGRADED_PROOF_EXPIRED',
        reason: 'ACTIVE_PROOF_EXPIRED',
      });
    }
    if (sameModelName(runtimeSnapshot.modelName, state.fallbackModelName)) {
      return freezeResult({ role, status: 'UNCHANGED', reason: 'FALLBACK_ACTIVE_EXACT' });
    }
    if (!sameModelName(runtimeSnapshot.modelName, desired.modelName)) {
      return freezeResult({ role, status: 'INCONCLUSIVE', reason: 'RUNTIME_BINDING_DRIFT' });
    }
    const proofs = this.repository.listEligibleProofs({
      role,
      roleContractSha256: proofContract.roleContractSha256,
      requireAutoFailoverEnabled: true,
    });
    const selected = selectProof(
      proofs,
      inventory,
      proof => proof.modelName === state.fallbackModelName
        && proof.modelCanonicalName === state.fallbackCanonicalName
        && proof.modelDigestSha256 === state.fallbackDigestSha256,
    );
    if (!selected) {
      return freezeResult({ role, status: 'UNCHANGED', reason: 'FALLBACK_PROOF_NOT_FRESH' });
    }
    return this.#executeTransition({
      role,
      desired,
      state,
      kind: 'REAPPLY',
      selected,
      startup,
      roleContractSha256: proofContract.roleContractSha256,
    });
  }

  async #recoverPending(pending, desired, state, startup) {
    const kind = TERMINAL_EVENT_TO_KIND[pending.eventType];
    if (!kind) {
      fail('MODEL_FAILOVER_RUNTIME_FINALIZE_TARGET_INVALID', 'Pending transition type is invalid');
    }
    if (kind !== 'RESTORE') {
      const health = this.repository.getRuntimeHealth(pending.role);
      if (health?.status !== 'HEALTHY') {
        if (health?.status === 'PROOF_EXPIRED_UNRECORDED') {
          const recorded = this.repository.recordActiveProofExpired({
            role: pending.role,
            episodeId: state.episodeId,
            expectedRowVersion: state.rowVersion,
            activeEventId: state.activeEventId,
          });
          if (recorded.outcome === 'RECORDED') {
            this.#publishBestEffort({
              action: 'model_failover_degraded',
              role: pending.role,
              status: 'DEGRADED_PROOF_EXPIRED',
              model: state.fallbackModelName,
            });
          }
        }
        return freezeResult({
          role: pending.role,
          status: 'DEGRADED_PROOF_EXPIRED',
          reason: 'PENDING_REAPPLY_BLOCKED_BY_EXPIRED_PROOF',
        });
      }
    }

    const snapshot = this.runtime.snapshot(pending.role);
    if (sameModelName(snapshot.modelName, pending.targetModelName)) {
      const finalized = this.repository.recordRuntimeFinalized({
        operationId: pending.operationId,
        terminalEventId: pending.terminalEventId,
        configVersion: snapshot.configVersion,
        finalizeKind: 'RECOVERED_OBSERVED',
      });
      return freezeResult({
        role: pending.role,
        status: 'RECOVERED',
        reason: 'RUNTIME_TARGET_ALREADY_ACTIVE',
        operationId: pending.operationId,
        finalization: finalized.finalization.status,
      });
    }
    const expectedCurrent = kind === 'RESTORE'
      ? state.fallbackModelName
      : desired.modelName;
    if (!sameModelName(snapshot.modelName, expectedCurrent)) {
      return freezeResult({
        role: pending.role,
        status: 'INCONCLUSIVE',
        reason: 'RUNTIME_RECOVERY_CAS_MISMATCH',
      });
    }
    return this.#applyCommittedPending(pending, snapshot, startup);
  }

  async #applyCommittedPending(pending, snapshot, startup) {
    let releaseLeases;
    let token;
    let commitReturned = false;
    try {
      releaseLeases = this.#acquireLeases([snapshot.modelName, pending.targetModelName]);
      const resolved = await this.provider.resolveExact(pending.targetModelName, {
        expectedDigestSha256: pending.targetDigestSha256,
      });
      token = this.runtime.prepare({
        role: pending.role,
        expectedModel: snapshot.modelName,
        targetModel: resolved.name,
        incrementVersion: !startup,
      });
      const runtimeResult = this.runtime.commit(token);
      commitReturned = true;
      this.#validateRuntimeResult(pending.role, resolved.name, runtimeResult);
      const finalized = this.repository.recordRuntimeFinalized({
        operationId: pending.operationId,
        terminalEventId: pending.terminalEventId,
        configVersion: runtimeResult.configVersion,
        finalizeKind: 'RECOVERED_OBSERVED',
      });
      this.#publishBestEffort({
        action: 'model_changed',
        role: pending.role,
        model: resolved.name,
        reason: `FAILOVER_${pending.eventType}_RECOVERED`,
        configVersion: runtimeResult.configVersion,
      });
      return freezeResult({
        role: pending.role,
        status: 'RECOVERED',
        reason: 'PENDING_RUNTIME_TRANSITION_APPLIED',
        operationId: pending.operationId,
        finalization: finalized.finalization.status,
      });
    } catch (error) {
      if (token && !commitReturned) {
        try { this.runtime.compensate(token); } catch (_) {}
      }
      throw error;
    } finally {
      releaseLeases?.();
    }
  }

  async #executeTransition({
    role,
    desired,
    state,
    kind,
    selected,
    startup,
    roleContractSha256,
  }) {
    const claimed = this.repository.claimOperation({
      role,
      episodeId: state.episodeId,
      expectedDesiredRevision: state.desiredRevision,
      expectedRowVersion: state.rowVersion,
      kind,
      leaseMs: this.claimLeaseMs,
      requireAutoFailoverEnabled: kind !== 'RESTORE',
    });
    let releaseLeases;
    let token;
    let terminal = null;
    let commitReturned = false;
    try {
      const snapshot = this.runtime.snapshot(role);
      const expectedCurrent = kind === 'ACTIVATE'
        ? desired.modelName
        : state.fallbackModelName;
      if (!sameModelName(snapshot.modelName, expectedCurrent)) {
        fail(
          'MODEL_FAILOVER_RUNTIME_CAS_MISMATCH',
          'Runtime binding no longer matches the failover transition source',
          { role, kind, runtimeModel: snapshot.modelName, expectedCurrent },
        );
      }
      releaseLeases = this.#acquireLeases([snapshot.modelName, selected.artifact.name]);
      const resolved = await this.provider.resolveExact(selected.artifact.name, {
        expectedDigestSha256: selected.artifact.digestSha256,
      });
      token = this.runtime.prepare({
        role,
        expectedModel: snapshot.modelName,
        targetModel: resolved.name,
        incrementVersion: !startup,
      });
      terminal = this.repository.completeOperation({
        role,
        episodeId: claimed.state.episodeId,
        expectedDesiredRevision: claimed.state.desiredRevision,
        expectedRowVersion: claimed.state.rowVersion,
        operationId: claimed.claim.operationId,
        claimToken: claimed.claim.token,
        kind,
        proofId: selected.proof.proofId,
        roleContractSha256,
        targetModelName: resolved.name,
        targetDigestSha256: resolved.digestSha256,
      });

      const runtimeResult = this.runtime.commit(token);
      commitReturned = true;
      this.#validateRuntimeResult(role, resolved.name, runtimeResult);
      const finalized = this.repository.recordRuntimeFinalized({
        operationId: claimed.claim.operationId,
        terminalEventId: terminal.event.eventId,
        configVersion: runtimeResult.configVersion,
        finalizeKind: 'DIRECT_CONFIRMED',
      });
      this.#publishBestEffort({
        action: 'model_changed',
        role,
        model: resolved.name,
        reason: `FAILOVER_${kind}`,
        configVersion: runtimeResult.configVersion,
      });
      return freezeResult({
        role,
        status: terminal.outcome === 'ALREADY_COMPLETED' ? 'REPLAYED' : 'APPLIED',
        reason: kind,
        operationId: claimed.claim.operationId,
        eventId: terminal.event.eventId,
        finalization: finalized.finalization.status,
        from: runtimeResult.from,
        to: runtimeResult.to,
        changed: runtimeResult.changed,
        configVersion: runtimeResult.configVersion,
      });
    } catch (error) {
      if (terminal) {
        if (token && !commitReturned) {
          try { this.runtime.compensate(token); } catch (_) {}
        }
        throw new ModelFailoverApplicationError(
          'MODEL_FAILOVER_RUNTIME_RECONCILIATION_REQUIRED',
          'Durable failover transition requires runtime finalization recovery',
          {
            cause: error,
            details: {
              role,
              kind,
              operationId: claimed.claim.operationId,
              terminalEventId: terminal.event.eventId,
              causeCode: error?.code || null,
            },
          },
        );
      }
      if (token) {
        try { this.runtime.compensate(token); } catch (_) {}
      }
      try {
        this.repository.failOperation({
          role,
          episodeId: claimed.state.episodeId,
          expectedDesiredRevision: claimed.state.desiredRevision,
          expectedRowVersion: claimed.state.rowVersion,
          operationId: claimed.claim.operationId,
          claimToken: claimed.claim.token,
          kind,
          failurePhase: operationFailurePhase(kind, error),
        });
      } catch (auditError) {
        this.logger.warn(
          'ModelFailoverApplication',
          `Failover failure audit could not be recorded: ${auditError.message}`,
        );
      }
      throw error;
    } finally {
      releaseLeases?.();
    }
  }

  #acquireLeases(modelNames) {
    const byCanonical = new Map();
    for (const value of modelNames) {
      const canonicalName = canonicalModelName(value);
      if (!canonicalName) {
        fail('MODEL_FAILOVER_APPLICATION_INPUT_INVALID', 'Failover lease model is invalid');
      }
      if (!byCanonical.has(canonicalName)) byCanonical.set(canonicalName, String(value).trim());
    }
    const leases = [];
    try {
      for (const canonicalName of [...byCanonical.keys()].sort()) {
        leases.push(this.modelUseAuthority.acquireShared({
          modelName: byCanonical.get(canonicalName),
          owner: MODEL_ACTIVITY_OWNER.FAILOVER_CUTOVER,
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

  #validateRuntimeResult(role, targetModel, result) {
    if (!isPlainObject(result)
      || result.role !== role
      || !sameModelName(result.to, targetModel)
      || !Number.isSafeInteger(result.configVersion)
      || result.configVersion < 0
      || typeof result.changed !== 'boolean') {
      fail('MODEL_FAILOVER_RUNTIME_RESULT_INVALID', 'Runtime returned an invalid failover result');
    }
  }

  #publishBestEffort(payload) {
    try {
      this.publishControl(payload);
    } catch (error) {
      this.logger.warn('ModelFailoverApplication', `Failover notification degraded: ${error.message}`);
    }
  }
}

export function createModelFailoverApplication(options) {
  return new ModelFailoverApplication(options);
}

