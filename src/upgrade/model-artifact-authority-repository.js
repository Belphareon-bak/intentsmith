import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import process from 'node:process';

import { canonicalModelName } from './model-identity.js';

const CLAIM_MODES = new Set(['SHARED', 'EXCLUSIVE']);
const EFFECT_KINDS = new Set(['PULL', 'DELETE']);
const EFFECT_SOURCES = new Set([
  'USER_REQUEST',
  'USER_HTTP',
  'USER_CHAT',
  'AUTO_CLEANUP',
  'BINDING_APPLICATION',
  'RECOVERY',
]);
const INITIAL_OUTCOMES = new Set(['SUCCEEDED', 'FAILED', 'ORPHANED']);

export class ModelArtifactAuthorityRepositoryError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'ModelArtifactAuthorityRepositoryError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = null) {
  throw new ModelArtifactAuthorityRepositoryError(code, message, details);
}

function exactObject(value, keys) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function readLinuxStartTicks(pid) {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  const suffix = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/u);
  const startTicks = suffix[19];
  if (!/^\d+$/u.test(startTicks || '')) throw new Error('invalid /proc start ticks');
  return startTicks;
}

function defaultProcessIdentity() {
  if (process.platform !== 'linux' || typeof process.getuid !== 'function') {
    fail('MODEL_ARTIFACT_PROCESS_IDENTITY_UNAVAILABLE', 'Linux process identity is required');
  }
  const bootId = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  const pid = process.pid;
  const uid = process.getuid();
  const startTicks = readLinuxStartTicks(pid);
  if (!/^[A-Za-z0-9-]{16,64}$/u.test(bootId)) {
    fail('MODEL_ARTIFACT_PROCESS_IDENTITY_UNAVAILABLE', 'Linux boot identity is invalid');
  }
  const instanceId = createHash('sha256')
    .update(`${bootId}\0${pid}\0${uid}\0${startTicks}`, 'utf8')
    .digest('hex');
  return Object.freeze({ pid, uid, bootId, startTicks, instanceId });
}

function defaultProbe(row) {
  let bootId;
  try {
    bootId = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  } catch {
    return 'UNKNOWN';
  }
  if (bootId !== row.owner_boot_id) return 'GONE';
  try {
    const startTicks = readLinuxStartTicks(row.owner_pid);
    return startTicks === row.owner_start_ticks ? 'LIVE' : 'GONE';
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ESRCH') return 'GONE';
    return 'UNKNOWN';
  }
}

function validateIdentity(identity) {
  if (!exactObject(identity, ['bootId', 'instanceId', 'pid', 'startTicks', 'uid'])
    || !Number.isSafeInteger(identity.pid) || identity.pid <= 0
    || !Number.isSafeInteger(identity.uid) || identity.uid < 0
    || !/^[A-Za-z0-9-]{16,64}$/u.test(identity.bootId || '')
    || !/^\d{1,32}$/u.test(identity.startTicks || '')
    || !/^[a-f0-9]{64}$/u.test(identity.instanceId || '')) {
    fail('MODEL_ARTIFACT_PROCESS_IDENTITY_UNAVAILABLE', 'Process identity is invalid');
  }
  return Object.freeze({ ...identity });
}

function validCanonicalName(value) {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 256
    && value === value.toLowerCase()
    && canonicalModelName(value) === value;
}

function mapClaim(row) {
  return Object.freeze({
    claimId: row.claim_id,
    canonicalName: row.canonical_name,
    mode: row.mode,
    owner: row.owner,
    ownerPid: row.owner_pid,
    ownerInstanceId: row.owner_instance_id,
    acquiredAtMs: row.acquired_at_ms,
    releasedAtMs: row.released_at_ms,
    releaseReason: row.release_reason,
  });
}

export class ModelArtifactAuthorityRepository {
  constructor(db, options = {}) {
    if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
      fail('MODEL_ARTIFACT_REPOSITORY_INVALID', 'SQLite authority repository is required');
    }
    this._db = db;
    this._clock = typeof options.clock === 'function' ? options.clock : Date.now;
    this._identity = validateIdentity(options.processIdentity || defaultProcessIdentity());
    this._probe = typeof options.processProbe === 'function' ? options.processProbe : defaultProbe;
    this._idFactory = typeof options.idFactory === 'function' ? options.idFactory : randomUUID;
  }

  #now() {
    const value = this._clock();
    if (!Number.isSafeInteger(value) || value <= 0) {
      fail('MODEL_ARTIFACT_CLOCK_INVALID', 'Authority clock returned an invalid value');
    }
    return value;
  }

  #activeClaims(canonicalName) {
    return this._db.prepare(`
      SELECT * FROM m6_model_artifact_claims
      WHERE canonical_name = ? AND released_at_ms IS NULL
      ORDER BY acquired_at_ms, claim_id
    `).all(canonicalName);
  }

  #recoverGoneClaims(canonicalName, nowMs) {
    const active = this.#activeClaims(canonicalName);
    const release = this._db.prepare(`
      UPDATE m6_model_artifact_claims
      SET released_at_ms = ?, release_reason = 'OWNER_GONE_RECOVERED'
      WHERE claim_id = ? AND released_at_ms IS NULL
    `);
    for (const row of active) {
      const state = this._probe(Object.freeze({ ...row }));
      if (!new Set(['LIVE', 'GONE', 'UNKNOWN']).has(state)) {
        fail('MODEL_ARTIFACT_PROCESS_PROBE_INVALID', 'Process probe returned an invalid state');
      }
      if (state === 'GONE') release.run(nowMs, row.claim_id);
    }
  }

  #outstandingEffect(canonicalName) {
    return this._db.prepare(`
      SELECT o.operation_id, o.kind, o.exact_name, e.error_code,
             CASE WHEN e.event_id IS NULL THEN 'INTENT_ONLY' ELSE e.status END AS state
      FROM m6_model_artifact_operations o
      LEFT JOIN m6_model_artifact_events e
        ON e.operation_id = o.operation_id AND e.sequence = 1
      LEFT JOIN m6_model_artifact_events settled
        ON settled.operation_id = o.operation_id AND settled.sequence = 2
      WHERE o.canonical_name = ?
        AND (e.event_id IS NULL OR (e.status = 'ORPHANED' AND settled.event_id IS NULL))
      ORDER BY o.created_at_ms, o.operation_id
      LIMIT 1
    `).get(canonicalName) || null;
  }

  acquireClaim(input) {
    if (!exactObject(input, ['canonicalName', 'mode', 'owner'])
      || !validCanonicalName(input.canonicalName)
      || !CLAIM_MODES.has(input.mode)
      || typeof input.owner !== 'string') {
      fail('MODEL_ARTIFACT_CLAIM_INPUT_INVALID', 'Model artifact claim input is invalid');
    }
    const run = this._db.transaction(() => {
      const nowMs = this.#now();
      this.#recoverGoneClaims(input.canonicalName, nowMs);
      const outstanding = this.#outstandingEffect(input.canonicalName);
      if (outstanding) {
        fail(
          'MODEL_ARTIFACT_OUTCOME_UNRESOLVED',
          `A provider effect has an unresolved outcome for ${input.canonicalName}`,
          {
            operationId: outstanding.operation_id,
            kind: outstanding.kind,
            exactName: outstanding.exact_name,
            errorCode: outstanding.error_code,
            state: outstanding.state,
          },
        );
      }
      const active = this.#activeClaims(input.canonicalName);
      const conflict = input.mode === 'EXCLUSIVE'
        ? active.length > 0
        : active.some(row => row.mode === 'EXCLUSIVE');
      if (conflict) {
        fail('MODEL_ARTIFACT_CLAIM_CONFLICT', 'Model artifact claim conflicts with active work', {
          canonicalName: input.canonicalName,
          requestedMode: input.mode,
          activeUseCount: active.filter(row => row.mode === 'SHARED').length,
          activeOwners: [...new Set(active.map(row => row.owner))].sort(),
          unknownOwnerState: active.some(row => this._probe(Object.freeze({ ...row })) === 'UNKNOWN'),
        });
      }
      const claimId = `mac1:${this._idFactory()}`;
      this._db.prepare(`
        INSERT INTO m6_model_artifact_claims (
          claim_id, canonical_name, mode, owner, owner_pid, owner_uid,
          owner_boot_id, owner_start_ticks, owner_instance_id, acquired_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        claimId,
        input.canonicalName,
        input.mode,
        input.owner,
        this._identity.pid,
        this._identity.uid,
        this._identity.bootId,
        this._identity.startTicks,
        this._identity.instanceId,
        nowMs,
      );
      return mapClaim(this._db.prepare(
        'SELECT * FROM m6_model_artifact_claims WHERE claim_id = ?',
      ).get(claimId));
    });
    return run.immediate();
  }

  acquirePullRecoveryClaim(operationId) {
    if (typeof operationId !== 'string' || operationId.length < 16) {
      fail('MODEL_ARTIFACT_EFFECT_INPUT_INVALID', 'Recovery operation identity is invalid');
    }
    const run = this._db.transaction(() => {
      const operation = this._db.prepare(`
        SELECT o.*, initial.event_id AS initial_event_id
        FROM m6_model_artifact_operations o
        LEFT JOIN m6_model_artifact_events initial
          ON initial.operation_id = o.operation_id AND initial.sequence = 1
        LEFT JOIN m6_model_artifact_events settled
          ON settled.operation_id = o.operation_id AND settled.sequence = 2
        WHERE o.operation_id = ? AND o.kind = 'PULL'
          AND (initial.event_id IS NULL
            OR (initial.status = 'ORPHANED' AND settled.event_id IS NULL))
      `).get(operationId);
      if (!operation) {
        fail('MODEL_ARTIFACT_EFFECT_NOT_RECOVERABLE', 'Pull operation is not recoverable');
      }
      const nowMs = this.#now();
      this.#recoverGoneClaims(operation.canonical_name, nowMs);
      const active = this.#activeClaims(operation.canonical_name);
      if (active.length > 0) {
        fail('MODEL_ARTIFACT_CLAIM_CONFLICT', 'Pull recovery conflicts with active work', {
          canonicalName: operation.canonical_name,
          requestedMode: 'EXCLUSIVE',
          activeUseCount: active.filter(row => row.mode === 'SHARED').length,
          activeOwners: [...new Set(active.map(row => row.owner))].sort(),
          unknownOwnerState: active.some(row => this._probe(Object.freeze({ ...row })) === 'UNKNOWN'),
        });
      }
      const claimId = `mac1:${this._idFactory()}`;
      this._db.prepare(`
        INSERT INTO m6_model_artifact_claims (
          claim_id, canonical_name, mode, owner, owner_pid, owner_uid,
          owner_boot_id, owner_start_ticks, owner_instance_id, acquired_at_ms
        ) VALUES (?, ?, 'EXCLUSIVE', 'MODEL_PULL', ?, ?, ?, ?, ?, ?)
      `).run(
        claimId,
        operation.canonical_name,
        this._identity.pid,
        this._identity.uid,
        this._identity.bootId,
        this._identity.startTicks,
        this._identity.instanceId,
        nowMs,
      );
      if (operation.initial_event_id === null) {
        this._db.prepare(`
          INSERT INTO m6_model_artifact_events (
            operation_id, sequence, status, error_code, recorded_at_ms
          ) VALUES (?, 1, 'ORPHANED', 'MODEL_PULL_INTENT_RECOVERY', ?)
        `).run(operation.operation_id, nowMs);
      }
      return Object.freeze({
        ...mapClaim(this._db.prepare(
          'SELECT * FROM m6_model_artifact_claims WHERE claim_id = ?',
        ).get(claimId)),
        operationId: operation.operation_id,
        exactName: operation.exact_name,
        providerOrigin: operation.provider_origin,
      });
    });
    return run.immediate();
  }

  releaseClaim(claimId) {
    if (typeof claimId !== 'string' || claimId.length < 16) {
      fail('MODEL_ARTIFACT_CLAIM_INPUT_INVALID', 'Claim identity is invalid');
    }
    const result = this._db.prepare(`
      UPDATE m6_model_artifact_claims
      SET released_at_ms = ?, release_reason = 'NORMAL'
      WHERE claim_id = ? AND owner_instance_id = ? AND released_at_ms IS NULL
    `).run(this.#now(), claimId, this._identity.instanceId);
    if (result.changes !== 1) {
      fail('MODEL_ARTIFACT_CLAIM_RELEASED', 'Model artifact claim is no longer owned');
    }
  }

  snapshot(canonicalName) {
    if (!validCanonicalName(canonicalName)) {
      fail('MODEL_ARTIFACT_CLAIM_INPUT_INVALID', 'Canonical model name is invalid');
    }
    const active = this.#activeClaims(canonicalName);
    return Object.freeze({
      canonicalName,
      activeUseCount: active.filter(row => row.mode === 'SHARED').length,
      exclusiveOwner: active.find(row => row.mode === 'EXCLUSIVE')?.owner || null,
      outstandingEffect: this.#outstandingEffect(canonicalName)?.operation_id || null,
    });
  }

  recordIntent(input) {
    const keys = [
      'canonicalName', 'claimId', 'digestSha256', 'exactName', 'kind',
      'providerOrigin', 'source',
    ];
    if (!exactObject(input, keys)
      || !validCanonicalName(input.canonicalName)
      || !EFFECT_KINDS.has(input.kind)
      || !EFFECT_SOURCES.has(input.source)
      || typeof input.claimId !== 'string'
      || typeof input.exactName !== 'string'
      || input.exactName.length < 1
      || input.exactName.length > 256
      || canonicalModelName(input.exactName) !== input.canonicalName
      || typeof input.providerOrigin !== 'string'
      || (input.kind === 'PULL' && input.digestSha256 !== null)
      || (input.kind === 'DELETE' && !/^[a-f0-9]{64}$/u.test(input.digestSha256 || ''))) {
      fail('MODEL_ARTIFACT_EFFECT_INPUT_INVALID', 'Model artifact effect intent is invalid');
    }
    const operationId = `mao1:${this._idFactory()}`;
    try {
      this._db.prepare(`
        INSERT INTO m6_model_artifact_operations (
          operation_id, claim_id, kind, exact_name, canonical_name,
          digest_sha256, source, provider_origin, created_at_ms
        )
        SELECT ?, claim_id, ?, ?, ?, ?, ?, ?, ?
        FROM m6_model_artifact_claims
        WHERE claim_id = ? AND owner_instance_id = ? AND released_at_ms IS NULL
      `).run(
        operationId,
        input.kind,
        input.exactName,
        input.canonicalName,
        input.digestSha256,
        input.source,
        input.providerOrigin,
        this.#now(),
        input.claimId,
        this._identity.instanceId,
      );
    } catch (error) {
      fail('MODEL_ARTIFACT_EFFECT_INTENT_FAILED', error.message);
    }
    const row = this._db.prepare(
      'SELECT operation_id FROM m6_model_artifact_operations WHERE operation_id = ?',
    ).get(operationId);
    if (!row) fail('MODEL_ARTIFACT_EFFECT_CLAIM_REQUIRED', 'Active owned claim is required');
    return Object.freeze({ operationId });
  }

  recordOutcome(operationId, status, errorCode = null) {
    if (typeof operationId !== 'string' || !INITIAL_OUTCOMES.has(status)
      || (status === 'SUCCEEDED' && errorCode !== null)
      || (status !== 'SUCCEEDED'
        && !(typeof errorCode === 'string' && errorCode.length >= 1 && errorCode.length <= 128))) {
      fail('MODEL_ARTIFACT_EFFECT_INPUT_INVALID', 'Model artifact outcome is invalid');
    }
    try {
      this._db.prepare(`
        INSERT INTO m6_model_artifact_events (
          operation_id, sequence, status, error_code, recorded_at_ms
        ) VALUES (?, 1, ?, ?, ?)
      `).run(operationId, status, errorCode, this.#now());
    } catch (error) {
      fail('MODEL_ARTIFACT_EFFECT_OUTCOME_FAILED', error.message);
    }
  }

  reconcileSucceeded(operationId) {
    if (typeof operationId !== 'string') {
      fail('MODEL_ARTIFACT_EFFECT_INPUT_INVALID', 'Operation identity is invalid');
    }
    try {
      this._db.prepare(`
        INSERT INTO m6_model_artifact_events (
          operation_id, sequence, status, error_code, recorded_at_ms
        ) VALUES (?, 2, 'RECONCILED_SUCCEEDED', NULL, ?)
      `).run(operationId, this.#now());
    } catch (error) {
      fail('MODEL_ARTIFACT_EFFECT_RECONCILIATION_FAILED', error.message);
    }
  }

  listOutstandingEffects() {
    return Object.freeze(this._db.prepare(`
      SELECT o.operation_id AS operationId, o.kind, o.exact_name AS exactName,
             o.canonical_name AS canonicalName, o.source,
             o.provider_origin AS providerOrigin, initial.error_code AS errorCode,
             CASE WHEN initial.event_id IS NULL THEN 'INTENT_ONLY'
                  ELSE initial.status END AS state
      FROM m6_model_artifact_operations o
      LEFT JOIN m6_model_artifact_events initial
        ON initial.operation_id = o.operation_id AND initial.sequence = 1
      LEFT JOIN m6_model_artifact_events settled
        ON settled.operation_id = o.operation_id AND settled.sequence = 2
      WHERE initial.event_id IS NULL
         OR (initial.status = 'ORPHANED' AND settled.event_id IS NULL)
      ORDER BY o.created_at_ms, o.operation_id
    `).all().map(row => Object.freeze(row)));
  }
}

export function createModelArtifactAuthorityRepository(db, options) {
  const repository = new ModelArtifactAuthorityRepository(db, options);
  return Object.freeze({
    acquireClaim: input => repository.acquireClaim(input),
    acquirePullRecoveryClaim: operationId => repository.acquirePullRecoveryClaim(operationId),
    releaseClaim: claimId => repository.releaseClaim(claimId),
    snapshot: canonicalName => repository.snapshot(canonicalName),
    recordIntent: input => repository.recordIntent(input),
    recordOutcome: (operationId, status, errorCode) => (
      repository.recordOutcome(operationId, status, errorCode)
    ),
    reconcileSucceeded: operationId => repository.reconcileSucceeded(operationId),
    listOutstandingEffects: () => repository.listOutstandingEffects(),
  });
}
