// Least-authority coordinators for the approved D+ local model failover policy.
//
// Detection may observe an exact digest-bound desired baseline and record a
// DETECTED incident. The lifecycle wrapper receives only two frozen run ports;
// runtime mutation remains exclusively inside ModelBindingApplication.

import { canonicalModelName } from './model-identity.js';
import {
  MODEL_FAILOVER_ACTOR,
  MODEL_FAILOVER_ROLES,
} from './model-failover.js';

const OBSERVABLE_SOURCES = new Set(['CONFIG_DEFAULT', 'LEGACY_OVERRIDE']);
const MANUAL_SOURCES = new Set(['USER_APPLY', 'USER_ROLLBACK']);
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const REPOSITORY_PORT_METHODS = Object.freeze([
  'getDesired',
  'getState',
  'listCompatibilityOverridesForRehydrate',
  'observeDesiredBinding',
  'recordDetection',
]);
const INVENTORY_PORT_METHODS = Object.freeze(['listInstalled']);
const RUN_PORT_METHODS = Object.freeze(['runOnce']);

export const ModelFailoverDetectionStatus = Object.freeze({
  COMPLETED: 'COMPLETED',
  PARTIAL: 'PARTIAL',
  INCONCLUSIVE: 'INCONCLUSIVE',
  SKIPPED_BUSY: 'SKIPPED_BUSY',
  SKIPPED_DISABLED: 'SKIPPED_DISABLED',
  SKIPPED_INVALID_SETTINGS: 'SKIPPED_INVALID_SETTINGS',
});

export const ModelFailoverLifecycleStatus = Object.freeze({
  COMPLETED: 'COMPLETED',
  PARTIAL: 'PARTIAL',
  SKIPPED_BUSY: 'SKIPPED_BUSY',
});

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function createNarrowPort(dependency, methods, name) {
  if (!dependency || typeof dependency !== 'object') {
    throw new TypeError(`${name} dependency is required`);
  }
  const port = {};
  for (const method of methods) {
    if (typeof dependency[method] !== 'function') {
      throw new TypeError(`${name} dependency is missing ${method}`);
    }
    const implementation = dependency[method];
    port[method] = implementation.bind(dependency);
  }
  return Object.freeze(port);
}

function requireExactPort(value, methods, name) {
  if (!isPlainObject(value) || !Object.isFrozen(value)) {
    throw new TypeError(`${name} must be a frozen plain object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...methods].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new TypeError(`${name} has an invalid capability set`);
  }
  for (const method of methods) {
    if (typeof value[method] !== 'function') {
      throw new TypeError(`${name} is missing ${method}`);
    }
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

function normalizeBindings(value) {
  if (!isPlainObject(value)) {
    return { valid: false, reason: 'BINDINGS_NOT_OBJECT', bindings: null };
  }

  const expectedRoles = [...MODEL_FAILOVER_ROLES].sort();
  const actualRoles = Object.keys(value).sort();
  if (JSON.stringify(actualRoles) !== JSON.stringify(expectedRoles)) {
    return { valid: false, reason: 'BINDING_ROLE_SET_INVALID', bindings: null };
  }

  const bindings = [];
  for (const role of expectedRoles) {
    const modelName = typeof value[role] === 'string' ? value[role].trim() : '';
    const canonicalName = canonicalModelName(modelName);
    if (!modelName || !canonicalName) {
      return { valid: false, reason: 'BINDING_IDENTITY_INVALID', bindings: null };
    }
    bindings.push(Object.freeze({ role, modelName, canonicalName }));
  }
  return { valid: true, reason: null, bindings: Object.freeze(bindings) };
}

function sameBindings(left, right) {
  if (left.length !== right.length) return false;
  return left.every((binding, index) => (
    binding.role === right[index].role
    && binding.modelName === right[index].modelName
    && binding.canonicalName === right[index].canonicalName
  ));
}

function normalizeInventory(value) {
  if (!Array.isArray(value)) {
    return { valid: false, reason: 'INVENTORY_NOT_ARRAY', artifacts: null };
  }
  if (value.length === 0) {
    return { valid: false, reason: 'INVENTORY_EMPTY', artifacts: null };
  }

  const artifacts = [];
  const seenCanonical = new Set();
  for (const entry of value) {
    if (!isPlainObject(entry)) {
      return { valid: false, reason: 'INVENTORY_ENTRY_INVALID', artifacts: null };
    }
    const exactName = typeof entry.name === 'string' ? entry.name.trim() : '';
    const canonicalName = canonicalModelName(exactName);
    const reportedCanonical = typeof entry.canonicalName === 'string'
      ? entry.canonicalName.trim()
      : '';
    const digestSha256 = typeof entry.digestSha256 === 'string'
      ? entry.digestSha256.trim()
      : '';
    if (!exactName || !canonicalName || reportedCanonical !== canonicalName) {
      return { valid: false, reason: 'INVENTORY_IDENTITY_INVALID', artifacts: null };
    }
    if (!DIGEST_PATTERN.test(digestSha256)) {
      return { valid: false, reason: 'INVENTORY_DIGEST_INVALID', artifacts: null };
    }
    if (seenCanonical.has(canonicalName)) {
      return { valid: false, reason: 'INVENTORY_IDENTITY_AMBIGUOUS', artifacts: null };
    }
    seenCanonical.add(canonicalName);
    artifacts.push(Object.freeze({ exactName, canonicalName, digestSha256 }));
  }

  artifacts.sort((left, right) => left.canonicalName.localeCompare(right.canonicalName));
  return { valid: true, reason: null, artifacts: Object.freeze(artifacts) };
}

function readPolicy(readSettings) {
  let result;
  try {
    result = readSettings();
  } catch (_) {
    return { enabled: false, valid: false, reason: 'MODEL_SETTINGS_READ_FAILED' };
  }
  if (!isPlainObject(result) || result.valid !== true || !isPlainObject(result.settings)) {
    return {
      enabled: false,
      valid: false,
      reason: typeof result?.reason === 'string' && result.reason
        ? result.reason
        : 'MODEL_SETTINGS_INVALID',
    };
  }
  if (result.settings.autoFailoverEnabled !== true) {
    return { enabled: false, valid: true, reason: 'AUTO_FAILOVER_DISABLED' };
  }
  return { enabled: true, valid: true, reason: null };
}

function sourceForInitialObservation(role, binding, compatibilityOverrides) {
  const roleOverrides = compatibilityOverrides.filter(entry => entry?.role === role);
  if (roleOverrides.length === 0) {
    return { valid: true, source: 'CONFIG_DEFAULT', reason: null };
  }
  if (roleOverrides.length !== 1) {
    return { valid: false, source: null, reason: 'OVERRIDE_AUTHORITY_AMBIGUOUS' };
  }

  const [override] = roleOverrides;
  const overrideCanonical = canonicalModelName(override?.modelName);
  if (
    override.bindingOperationId === null
    && override.verificationStatus === 'LEGACY_UNVERIFIED'
    && overrideCanonical === binding.canonicalName
  ) {
    return { valid: true, source: 'LEGACY_OVERRIDE', reason: null };
  }
  return { valid: false, source: null, reason: 'OVERRIDE_AUTHORITY_UNEXPLAINED' };
}

function createCounters() {
  return {
    rolesChecked: 0,
    desiredCreated: 0,
    desiredUnchanged: 0,
    detectionsCreated: 0,
    detectionsUnchanged: 0,
    presentExact: 0,
    skipped: 0,
    inconclusive: 0,
  };
}

function classifyRepositoryFailure(error) {
  if (error?.code === 'MODEL_FAILOVER_AUTO_FAILOVER_DISABLED') {
    return 'AUTO_FAILOVER_POLICY_CHANGED';
  }
  if (error?.code === 'MODEL_FAILOVER_STALE_DESIRED') {
    return 'DESIRED_AUTHORITY_CHANGED';
  }
  if (error?.code === 'MODEL_FAILOVER_INCIDENT_EXISTS'
    || error?.code === 'MODEL_FAILOVER_DESIRED_CHANGE_REQUIRES_SUPERSEDE') {
    return 'INCIDENT_AUTHORITY_CHANGED';
  }
  return 'REPOSITORY_WRITE_FAILED';
}

export class ModelFailoverDetectionCoordinator {
  #repositoryPort;
  #inventoryPort;
  #running;

  constructor(options = {}) {
    if (!isPlainObject(options)) {
      throw new TypeError('Model failover coordinator options must be an object');
    }
    this.#repositoryPort = requireExactPort(
      options.repositoryPort,
      REPOSITORY_PORT_METHODS,
      'repositoryPort',
    );
    this.#inventoryPort = requireExactPort(
      options.inventoryPort,
      INVENTORY_PORT_METHODS,
      'inventoryPort',
    );
    this.readSettings = options.readSettings;
    this.readBindings = options.readBindings;
    this.clock = options.clock || Date.now;
    this.#running = false;
    if (typeof this.readSettings !== 'function'
      || typeof this.readBindings !== 'function'
      || typeof this.clock !== 'function') {
      throw new TypeError('Coordinator callbacks are invalid');
    }
  }

  #result(status, reason, roleResults = [], counters = createCounters()) {
    let checkedAtMs = null;
    try {
      const observed = this.clock();
      if (Number.isSafeInteger(observed)) checkedAtMs = observed;
    } catch (_) {}
    return freezeResult({
      schemaVersion: 1,
      status,
      reason,
      checkedAtMs,
      counters: { ...counters },
      roles: [...roleResults],
    });
  }

  #policyStillEnabled() {
    return readPolicy(this.readSettings).enabled === true;
  }

  async runOnce() {
    if (this.#running) {
      return this.#result(
        ModelFailoverDetectionStatus.SKIPPED_BUSY,
        'COORDINATOR_BUSY',
      );
    }
    this.#running = true;
    try {
      return await this.#runOwned();
    } catch (_) {
      return this.#result(
        ModelFailoverDetectionStatus.INCONCLUSIVE,
        'COORDINATOR_UNEXPECTED_FAILURE',
      );
    } finally {
      this.#running = false;
    }
  }

  async #runOwned() {
    const initialPolicy = readPolicy(this.readSettings);
    if (!initialPolicy.enabled) {
      return this.#result(
        initialPolicy.valid
          ? ModelFailoverDetectionStatus.SKIPPED_DISABLED
          : ModelFailoverDetectionStatus.SKIPPED_INVALID_SETTINGS,
        initialPolicy.reason,
      );
    }

    let beforeBindings;
    try {
      beforeBindings = normalizeBindings(this.readBindings());
    } catch (_) {
      return this.#result(
        ModelFailoverDetectionStatus.INCONCLUSIVE,
        'BINDINGS_READ_FAILED',
      );
    }
    if (!beforeBindings.valid) {
      return this.#result(
        ModelFailoverDetectionStatus.INCONCLUSIVE,
        beforeBindings.reason,
      );
    }

    let rawInventory;
    try {
      rawInventory = await this.#inventoryPort.listInstalled();
    } catch (_) {
      return this.#result(
        ModelFailoverDetectionStatus.INCONCLUSIVE,
        'INVENTORY_UNAVAILABLE',
      );
    }

    let afterBindings;
    try {
      afterBindings = normalizeBindings(this.readBindings());
    } catch (_) {
      return this.#result(
        ModelFailoverDetectionStatus.INCONCLUSIVE,
        'BINDINGS_READ_FAILED_AFTER_INVENTORY',
      );
    }
    if (!afterBindings.valid || !sameBindings(beforeBindings.bindings, afterBindings.bindings)) {
      return this.#result(
        ModelFailoverDetectionStatus.INCONCLUSIVE,
        afterBindings.valid ? 'BINDINGS_CHANGED_DURING_INVENTORY' : afterBindings.reason,
      );
    }

    const inventory = normalizeInventory(rawInventory);
    if (!inventory.valid) {
      return this.#result(
        ModelFailoverDetectionStatus.INCONCLUSIVE,
        inventory.reason,
      );
    }
    if (!this.#policyStillEnabled()) {
      return this.#result(
        ModelFailoverDetectionStatus.INCONCLUSIVE,
        'AUTO_FAILOVER_POLICY_CHANGED',
      );
    }

    let compatibilityOverrides;
    try {
      compatibilityOverrides = this.#repositoryPort.listCompatibilityOverridesForRehydrate();
    } catch (_) {
      return this.#result(
        ModelFailoverDetectionStatus.INCONCLUSIVE,
        'OVERRIDE_AUTHORITY_READ_FAILED',
      );
    }
    if (!Array.isArray(compatibilityOverrides)) {
      return this.#result(
        ModelFailoverDetectionStatus.INCONCLUSIVE,
        'OVERRIDE_AUTHORITY_INVALID',
      );
    }

    const artifactsByCanonical = new Map(
      inventory.artifacts.map(artifact => [artifact.canonicalName, artifact]),
    );
    const counters = createCounters();
    const roleResults = [];
    let hasInconclusive = false;

    for (const binding of afterBindings.bindings) {
      counters.rolesChecked += 1;
      let desired;
      let state;
      try {
        desired = this.#repositoryPort.getDesired(binding.role);
        state = this.#repositoryPort.getState(binding.role);
      } catch (_) {
        counters.inconclusive += 1;
        hasInconclusive = true;
        roleResults.push({
          role: binding.role,
          outcome: 'INCONCLUSIVE',
          reason: 'DESIRED_AUTHORITY_READ_FAILED',
        });
        continue;
      }

      const artifact = artifactsByCanonical.get(binding.canonicalName) || null;

      if (desired && MANUAL_SOURCES.has(desired.source)) {
        counters.skipped += 1;
        roleResults.push({
          role: binding.role,
          outcome: 'MANUAL_OWNED',
          reason: 'MANUAL_DESIRED_AUTHORITY',
        });
        continue;
      }

      if (desired && !OBSERVABLE_SOURCES.has(desired.source)) {
        counters.inconclusive += 1;
        hasInconclusive = true;
        roleResults.push({
          role: binding.role,
          outcome: 'INCONCLUSIVE',
          reason: 'DESIRED_SOURCE_INVALID',
        });
        continue;
      }

      if (desired && desired.canonicalName !== binding.canonicalName) {
        counters.inconclusive += 1;
        hasInconclusive = true;
        roleResults.push({
          role: binding.role,
          outcome: 'AUTHORITY_DRIFT',
          reason: 'RUNTIME_DESIRED_CANONICAL_MISMATCH',
        });
        continue;
      }

      if (state) {
        const exactUnclaimedDetection = state.state === 'DETECTED'
          && state.desiredRevision === desired?.bindingRevision
          && state.activeFailover === false
          && state.claimPresent === false;
        if (exactUnclaimedDetection && !artifact) {
          if (!this.#policyStillEnabled()) {
            counters.inconclusive += 1;
            hasInconclusive = true;
            roleResults.push({
              role: binding.role,
              outcome: 'INCONCLUSIVE',
              reason: 'AUTO_FAILOVER_POLICY_CHANGED',
            });
            break;
          }
          try {
            const detection = this.#repositoryPort.recordDetection({
              role: binding.role,
              expectedDesiredRevision: desired.bindingRevision,
              detectionOnly: true,
              requireAutoFailoverEnabled: true,
            });
            counters.detectionsUnchanged += 1;
            roleResults.push({
              role: binding.role,
              outcome: 'DETECTED_UNCHANGED',
              reason: detection.outcome,
            });
          } catch (error) {
            counters.inconclusive += 1;
            hasInconclusive = true;
            roleResults.push({
              role: binding.role,
              outcome: 'INCONCLUSIVE',
              reason: classifyRepositoryFailure(error),
            });
          }
        } else {
          counters.skipped += 1;
          roleResults.push({
            role: binding.role,
            outcome: 'INCIDENT_OWNED',
            reason: 'EXISTING_INCIDENT_REQUIRES_LATER_STATE_MACHINE',
          });
        }
        continue;
      }

      if (!desired) {
        if (!artifact) {
          counters.inconclusive += 1;
          hasInconclusive = true;
          roleResults.push({
            role: binding.role,
            outcome: 'UNSEEDED_MISSING',
            reason: 'NO_DIGEST_BOUND_DESIRED_BASELINE',
          });
          continue;
        }
        const source = sourceForInitialObservation(
          binding.role,
          binding,
          compatibilityOverrides,
        );
        if (!source.valid) {
          counters.inconclusive += 1;
          hasInconclusive = true;
          roleResults.push({
            role: binding.role,
            outcome: 'INCONCLUSIVE_AUTHORITY',
            reason: source.reason,
          });
          continue;
        }
        if (!this.#policyStillEnabled()) {
          counters.inconclusive += 1;
          hasInconclusive = true;
          roleResults.push({
            role: binding.role,
            outcome: 'INCONCLUSIVE',
            reason: 'AUTO_FAILOVER_POLICY_CHANGED',
          });
          break;
        }
        try {
          const observed = this.#repositoryPort.observeDesiredBinding({
            role: binding.role,
            modelName: binding.modelName,
            digestSha256: artifact.digestSha256,
            source: source.source,
            actor: MODEL_FAILOVER_ACTOR,
            expectedAbsent: true,
            requireAutoFailoverEnabled: true,
          });
          if (observed.outcome === 'CREATED') counters.desiredCreated += 1;
          else counters.desiredUnchanged += 1;
          roleResults.push({
            role: binding.role,
            outcome: observed.outcome === 'CREATED'
              ? 'DESIRED_CREATED'
              : 'DESIRED_UNCHANGED',
            reason: source.source,
          });
        } catch (error) {
          counters.inconclusive += 1;
          hasInconclusive = true;
          roleResults.push({
            role: binding.role,
            outcome: 'INCONCLUSIVE',
            reason: classifyRepositoryFailure(error),
          });
        }
        continue;
      }

      if (artifact) {
        if (artifact.digestSha256 !== desired.digestSha256) {
          counters.inconclusive += 1;
          hasInconclusive = true;
          roleResults.push({
            role: binding.role,
            outcome: 'DIGEST_DRIFT',
            reason: 'DESIRED_ARTIFACT_DIGEST_CHANGED',
          });
        } else {
          counters.presentExact += 1;
          roleResults.push({
            role: binding.role,
            outcome: 'PRESENT_EXACT',
            reason: null,
          });
        }
        continue;
      }

      if (!this.#policyStillEnabled()) {
        counters.inconclusive += 1;
        hasInconclusive = true;
        roleResults.push({
          role: binding.role,
          outcome: 'INCONCLUSIVE',
          reason: 'AUTO_FAILOVER_POLICY_CHANGED',
        });
        break;
      }
      try {
        const detection = this.#repositoryPort.recordDetection({
          role: binding.role,
          expectedDesiredRevision: desired.bindingRevision,
          detectionOnly: true,
          requireAutoFailoverEnabled: true,
        });
        if (detection.outcome === 'CREATED') counters.detectionsCreated += 1;
        else counters.detectionsUnchanged += 1;
        roleResults.push({
          role: binding.role,
          outcome: detection.outcome === 'CREATED'
            ? 'DETECTED_CREATED'
            : 'DETECTED_UNCHANGED',
          reason: detection.outcome,
        });
      } catch (error) {
        counters.inconclusive += 1;
        hasInconclusive = true;
        roleResults.push({
          role: binding.role,
          outcome: 'INCONCLUSIVE',
          reason: classifyRepositoryFailure(error),
        });
      }
    }

    return this.#result(
      hasInconclusive
        ? ModelFailoverDetectionStatus.PARTIAL
        : ModelFailoverDetectionStatus.COMPLETED,
      hasInconclusive ? 'ONE_OR_MORE_ROLES_INCONCLUSIVE' : null,
      roleResults,
      counters,
    );
  }
}

export function createModelFailoverDetectionCoordinator(options) {
  return new ModelFailoverDetectionCoordinator(options);
}

export function createModelFailoverDetectionRepositoryPort(repository) {
  return createNarrowPort(repository, REPOSITORY_PORT_METHODS, 'repository');
}

export function createModelFailoverDetectionInventoryPort(provider) {
  return createNarrowPort(provider, INVENTORY_PORT_METHODS, 'provider');
}

export function createModelFailoverDetectionRunPort(coordinator) {
  return createNarrowPort(coordinator, RUN_PORT_METHODS, 'detection coordinator');
}

export function createModelFailoverTerminalApplicationPort(application) {
  if (!application || typeof application.runTerminalFailoverCycle !== 'function') {
    throw new TypeError('terminal binding application dependency is required');
  }
  return Object.freeze({
    runOnce: application.runTerminalFailoverCycle.bind(application),
  });
}

export class ModelFailoverLifecycleCoordinator {
  #running;

  constructor(options = {}) {
    if (!isPlainObject(options)) {
      throw new TypeError('Model failover lifecycle options must be a plain object');
    }
    this.detectionPort = requireExactPort(
      options.detectionPort,
      RUN_PORT_METHODS,
      'detection run port',
    );
    this.terminalPort = requireExactPort(
      options.terminalPort,
      RUN_PORT_METHODS,
      'terminal application port',
    );
    this.#running = false;
  }

  async runOnce() {
    if (this.#running) {
      return freezeResult({
        schemaVersion: 1,
        status: ModelFailoverLifecycleStatus.SKIPPED_BUSY,
        detection: null,
        terminal: null,
      });
    }
    this.#running = true;
    try {
      const detection = await this.detectionPort.runOnce();
      const terminal = await this.terminalPort.runOnce();
      const partial = detection?.status === ModelFailoverDetectionStatus.PARTIAL
        || detection?.status === ModelFailoverDetectionStatus.INCONCLUSIVE
        || terminal?.status === 'PARTIAL';
      return freezeResult({
        schemaVersion: 1,
        status: partial
          ? ModelFailoverLifecycleStatus.PARTIAL
          : ModelFailoverLifecycleStatus.COMPLETED,
        detection,
        terminal,
      });
    } finally {
      this.#running = false;
    }
  }
}

export function createModelFailoverLifecycleCoordinator(options) {
  return new ModelFailoverLifecycleCoordinator(options);
}

export function startModelFailoverDetectionScheduler(options = {}) {
  if (!isPlainObject(options) || typeof options.coordinator?.runOnce !== 'function') {
    throw new TypeError('A model failover detection coordinator is required');
  }
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const schedule = options.schedule || setTimeout;
  const cancel = options.cancel || clearTimeout;
  const onResult = options.onResult || (() => {});
  const onError = options.onError || (() => {});
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1
    || typeof schedule !== 'function'
    || typeof cancel !== 'function'
    || typeof onResult !== 'function'
    || typeof onError !== 'function') {
    throw new TypeError('Model failover scheduler options are invalid');
  }

  let stopped = false;
  let timer = null;
  const scheduleNext = () => {
    if (stopped) return;
    timer = schedule(() => {
      void tick();
    }, intervalMs);
    timer?.unref?.();
  };
  const tick = async () => {
    try {
      onResult(await options.coordinator.runOnce());
    } catch (error) {
      onError(error);
    } finally {
      scheduleNext();
    }
  };

  scheduleNext();
  return Object.freeze({
    stop() {
      if (stopped) return;
      stopped = true;
      if (timer !== null) cancel(timer);
      timer = null;
    },
  });
}
