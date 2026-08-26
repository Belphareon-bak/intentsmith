import {
  LEARNING_ACTOR_KIND,
  LEARNING_OUTCOME_STATUS,
  canonicalizeLearningValue,
  computeLearningItemId,
  createLearningOutcomeV1,
  validateLearningObservationV1,
  validateLearningOutcomeTransitionV1,
  validateLearningProposalForObservations,
  validateLearningProposalV1,
} from '../../contracts/m4/learning-v1.js';
import { registerM4LearningAuthorityFunctions } from './learning-authority-validation.js';

export const LearningAuthorityErrorCode = Object.freeze({
  INPUT_INVALID: 'LEARNING_AUTHORITY_INPUT_INVALID',
  OBSERVATION_NOT_FOUND: 'LEARNING_OBSERVATION_NOT_FOUND',
  PROPOSAL_NOT_FOUND: 'LEARNING_PROPOSAL_NOT_FOUND',
  OUTCOME_NOT_FOUND: 'LEARNING_OUTCOME_NOT_FOUND',
  OBSERVATION_CONFLICT: 'LEARNING_OBSERVATION_CONFLICT',
  PROPOSAL_CONFLICT: 'LEARNING_PROPOSAL_CONFLICT',
  OUTCOME_CONFLICT: 'LEARNING_OUTCOME_CONFLICT',
  PROPOSAL_ALREADY_DECIDED: 'LEARNING_PROPOSAL_ALREADY_DECIDED',
  TRANSITION_INVALID: 'LEARNING_TRANSITION_INVALID',
  STORAGE_FAILURE: 'LEARNING_AUTHORITY_STORAGE_FAILURE',
});

export class LearningAuthorityError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'LearningAuthorityError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = null) {
  throw new LearningAuthorityError(code, message, details);
}

function requireDatabase(db) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    fail(LearningAuthorityErrorCode.INPUT_INVALID, 'A better-sqlite3 database is required');
  }
  return db;
}

function requireClock(clock) {
  if (typeof clock !== 'function') {
    fail(LearningAuthorityErrorCode.INPUT_INVALID, 'A trusted learning authority clock is required');
  }
  return clock;
}

function requireProjectId(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(LearningAuthorityErrorCode.INPUT_INVALID, 'projectId must be a positive integer');
  }
  return value;
}

function requireIdentifier(value, label) {
  if (
    typeof value !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
  ) fail(LearningAuthorityErrorCode.INPUT_INVALID, `${label} must be a bounded identifier`);
  return value;
}

function requireReason(value) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 4096) {
    fail(LearningAuthorityErrorCode.INPUT_INVALID, 'reason must be bounded non-empty text');
  }
  return value;
}

function requireConfidence(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    fail(LearningAuthorityErrorCode.INPUT_INVALID, 'confidenceBps must be an integer from 0 to 10000');
  }
  return value;
}

function requireMeasurement(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(LearningAuthorityErrorCode.INPUT_INVALID, 'measurement must be an object');
  }
  return structuredClone(value);
}

function requireValid(value, validator, label) {
  const result = validator(value);
  if (!result.valid) {
    fail(
      LearningAuthorityErrorCode.INPUT_INVALID,
      `${label} is invalid`,
      { errors: [...result.errors] },
    );
  }
  return value;
}

function immediate(db, callback) {
  const transaction = db.transaction(callback);
  return transaction.immediate ? transaction.immediate() : transaction();
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const item of Object.values(value)) deepFreeze(item, seen);
  return Object.freeze(value);
}

function parseStored(raw, validator, label) {
  try {
    const parsed = JSON.parse(raw);
    const result = validator(parsed);
    if (!result.valid || canonicalizeLearningValue(parsed) !== raw) {
      throw new Error(result.errors.join(',') || 'non-canonical bytes');
    }
    return deepFreeze(parsed);
  } catch (error) {
    fail(
      LearningAuthorityErrorCode.STORAGE_FAILURE,
      `Stored ${label} is invalid`,
      { cause: error?.message || String(error) },
    );
  }
}

function storageFailure(operation, error) {
  if (error instanceof LearningAuthorityError) throw error;
  fail(
    LearningAuthorityErrorCode.STORAGE_FAILURE,
    `Learning authority storage failed during ${operation}`,
    { cause: error?.message || String(error), sqliteCode: error?.code || null },
  );
}

function activeStatus(status) {
  return [
    LEARNING_OUTCOME_STATUS.APPROVED,
    LEARNING_OUTCOME_STATUS.MEASURED,
    LEARNING_OUTCOME_STATUS.WEAKENED,
  ].includes(status);
}

function createOutcomeOrFail(fields) {
  try {
    return createLearningOutcomeV1(fields);
  } catch (error) {
    fail(
      LearningAuthorityErrorCode.INPUT_INVALID,
      'LearningOutcome fields are invalid',
      { cause: error?.message || String(error) },
    );
  }
}

export class LearningAuthorityRepository {
  constructor(db, { clock = Date.now } = {}) {
    this.db = requireDatabase(db);
    this.clock = requireClock(clock);
    registerM4LearningAuthorityFunctions(this.db);
  }

  #now() {
    const value = this.clock();
    if (!Number.isSafeInteger(value) || value < 1) {
      fail(LearningAuthorityErrorCode.INPUT_INVALID, 'Learning authority clock is invalid');
    }
    return value;
  }

  #observationRow(observationId) {
    return this.db.prepare(`
      SELECT record_json FROM m4_learning_observations WHERE observation_id = ?
    `).get(observationId);
  }

  #proposalRow(proposalId) {
    return this.db.prepare(`
      SELECT record_json FROM m4_learning_proposals WHERE proposal_id = ?
    `).get(proposalId);
  }

  #outcomeRow(outcomeId) {
    return this.db.prepare(`
      SELECT record_json FROM m4_learning_outcomes WHERE outcome_id = ?
    `).get(outcomeId);
  }

  #currentOutcomeRow(proposalId) {
    return this.db.prepare(`
      SELECT current.record_json
      FROM m4_learning_outcomes current
      WHERE current.proposal_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM m4_learning_outcomes child
          WHERE child.previous_outcome_id = current.outcome_id
        )
      LIMIT 1
    `).get(proposalId);
  }

  #proposalOrFail(proposalId) {
    const row = this.#proposalRow(proposalId);
    if (!row) {
      fail(LearningAuthorityErrorCode.PROPOSAL_NOT_FOUND, 'Learning proposal does not exist');
    }
    return parseStored(row.record_json, validateLearningProposalV1, 'LearningProposal');
  }

  #insertOutcome(outcome, proposal, previous) {
    const checked = validateLearningOutcomeTransitionV1(outcome, proposal, previous);
    if (!checked.valid) {
      fail(
        LearningAuthorityErrorCode.TRANSITION_INVALID,
        'Learning outcome transition is invalid',
        { errors: [...checked.errors] },
      );
    }
    const encoded = canonicalizeLearningValue(outcome);
    this.db.prepare(`
      INSERT INTO m4_learning_outcomes (
        outcome_id, proposal_id, project_id, status,
        recorded_at_ms, previous_outcome_id, record_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      outcome.outcomeId,
      outcome.proposalId,
      outcome.projectId,
      outcome.status,
      outcome.recordedAtMs,
      outcome.previousOutcomeId,
      encoded,
    );
    return deepFreeze(structuredClone(outcome));
  }

  recordObservation(observationValue) {
    const observation = requireValid(
      observationValue,
      validateLearningObservationV1,
      'LearningObservation',
    );
    const encoded = canonicalizeLearningValue(observation);
    try {
      return immediate(this.db, () => {
        const existing = this.#observationRow(observation.observationId);
        if (existing) {
          if (existing.record_json !== encoded) {
            fail(LearningAuthorityErrorCode.OBSERVATION_CONFLICT, 'Observation ID conflict');
          }
          return parseStored(existing.record_json, validateLearningObservationV1, 'LearningObservation');
        }
        this.db.prepare(`
          INSERT INTO m4_learning_observations (
            observation_id, project_id, producer, confidence_bps, observed_at_ms, record_json
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          observation.observationId,
          observation.projectId,
          observation.producer,
          observation.confidenceBps,
          observation.observedAtMs,
          encoded,
        );
        return deepFreeze(structuredClone(observation));
      });
    } catch (error) {
      storageFailure('observation insert', error);
    }
  }

  getObservation(observationId) {
    const row = this.#observationRow(observationId);
    return row ? parseStored(row.record_json, validateLearningObservationV1, 'LearningObservation') : null;
  }

  recordProposal(proposalValue) {
    const proposal = requireValid(proposalValue, validateLearningProposalV1, 'LearningProposal');
    const encoded = canonicalizeLearningValue(proposal);
    try {
      return immediate(this.db, () => {
        const existing = this.#proposalRow(proposal.proposalId);
        if (existing) {
          if (existing.record_json !== encoded) {
            fail(LearningAuthorityErrorCode.PROPOSAL_CONFLICT, 'Proposal ID conflict');
          }
          return parseStored(existing.record_json, validateLearningProposalV1, 'LearningProposal');
        }
        const sources = proposal.observationIds.map((observationId) => {
          const observation = this.getObservation(observationId);
          if (!observation) {
            fail(
              LearningAuthorityErrorCode.OBSERVATION_NOT_FOUND,
              'A proposal source observation does not exist',
              { observationId },
            );
          }
          return observation;
        });
        const checked = validateLearningProposalForObservations(proposal, sources);
        if (!checked.valid) {
          fail(
            LearningAuthorityErrorCode.INPUT_INVALID,
            'LearningProposal sources are invalid',
            { errors: [...checked.errors] },
          );
        }
        this.db.prepare(`
          INSERT INTO m4_learning_proposals (
            proposal_id, project_id, confidence_bps, created_at_ms, record_json
          ) VALUES (?, ?, ?, ?, ?)
        `).run(
          proposal.proposalId,
          proposal.projectId,
          proposal.confidenceBps,
          proposal.createdAtMs,
          encoded,
        );
        return deepFreeze(structuredClone(proposal));
      });
    } catch (error) {
      storageFailure('proposal insert', error);
    }
  }

  getProposal(proposalId) {
    const row = this.#proposalRow(proposalId);
    return row ? parseStored(row.record_json, validateLearningProposalV1, 'LearningProposal') : null;
  }

  recordOutcome(outcomeValue) {
    try {
      return immediate(this.db, () => {
        const existing = this.#outcomeRow(outcomeValue?.outcomeId);
        if (existing) {
          const encoded = canonicalizeLearningValue(outcomeValue);
          if (existing.record_json !== encoded) {
            fail(LearningAuthorityErrorCode.OUTCOME_CONFLICT, 'Outcome ID conflict');
          }
          return parseStored(existing.record_json, value => ({
            valid: value.outcomeId === outcomeValue.outcomeId,
            errors: [],
          }), 'LearningOutcome');
        }
        const proposal = this.#proposalOrFail(outcomeValue?.proposalId);
        const previous = outcomeValue?.previousOutcomeId === null
          ? null
          : this.getOutcome(outcomeValue?.previousOutcomeId);
        return this.#insertOutcome(outcomeValue, proposal, previous);
      });
    } catch (error) {
      storageFailure('outcome insert', error);
    }
  }

  getOutcome(outcomeId) {
    const row = this.#outcomeRow(outcomeId);
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.record_json);
      const proposal = this.#proposalOrFail(parsed.proposalId);
      const previous = parsed.previousOutcomeId === null
        ? null
        : (() => {
          const previousRow = this.#outcomeRow(parsed.previousOutcomeId);
          if (!previousRow) return null;
          return JSON.parse(previousRow.record_json);
        })();
      return parseStored(
        row.record_json,
        value => validateLearningOutcomeTransitionV1(value, proposal, previous),
        'LearningOutcome',
      );
    } catch (error) {
      storageFailure('outcome read', error);
    }
  }

  getCurrentOutcome(proposalId) {
    const row = this.#currentOutcomeRow(proposalId);
    if (!row) return null;
    const parsed = JSON.parse(row.record_json);
    return this.getOutcome(parsed.outcomeId);
  }

  approveProposal({ proposalId, actorId, reason }) {
    requireIdentifier(actorId, 'actorId');
    requireReason(reason);
    try {
      return immediate(this.db, () => {
        const proposal = this.#proposalOrFail(proposalId);
        if (this.#currentOutcomeRow(proposalId)) {
          fail(LearningAuthorityErrorCode.PROPOSAL_ALREADY_DECIDED, 'Proposal already has an outcome');
        }
        const recordedAtMs = this.#now();
        const outcome = createOutcomeOrFail({
          proposalId,
          projectId: proposal.projectId,
          status: LEARNING_OUTCOME_STATUS.APPROVED,
          recordedAtMs,
          actor: { kind: LEARNING_ACTOR_KIND.USER, actorId },
          reason,
          previousOutcomeId: null,
          learnedItem: {
            itemId: computeLearningItemId(proposalId),
            itemVersion: 1,
            active: true,
            confidenceBps: proposal.confidenceBps,
            expiresAtMs: recordedAtMs + proposal.retention.ttlMs,
            adaptation: structuredClone(proposal.adaptation),
          },
          measurement: null,
        });
        return this.#insertOutcome(outcome, proposal, null);
      });
    } catch (error) {
      storageFailure('proposal approval', error);
    }
  }

  rejectProposal({ proposalId, actorId, reason }) {
    requireIdentifier(actorId, 'actorId');
    requireReason(reason);
    try {
      return immediate(this.db, () => {
        const proposal = this.#proposalOrFail(proposalId);
        if (this.#currentOutcomeRow(proposalId)) {
          fail(LearningAuthorityErrorCode.PROPOSAL_ALREADY_DECIDED, 'Proposal already has an outcome');
        }
        const outcome = createOutcomeOrFail({
          proposalId,
          projectId: proposal.projectId,
          status: LEARNING_OUTCOME_STATUS.REJECTED,
          recordedAtMs: this.#now(),
          actor: { kind: LEARNING_ACTOR_KIND.USER, actorId },
          reason,
          previousOutcomeId: null,
          learnedItem: null,
          measurement: null,
        });
        return this.#insertOutcome(outcome, proposal, null);
      });
    } catch (error) {
      storageFailure('proposal rejection', error);
    }
  }

  weakenLearning({ proposalId, actorId, reason, confidenceBps, value }) {
    requireIdentifier(actorId, 'actorId');
    requireReason(reason);
    requireConfidence(confidenceBps);
    try {
      return immediate(this.db, () => {
        const proposal = this.#proposalOrFail(proposalId);
        const previous = this.getCurrentOutcome(proposalId);
        if (!previous || !activeStatus(previous.status) || !previous.learnedItem?.active) {
          fail(LearningAuthorityErrorCode.TRANSITION_INVALID, 'Only an active learned item can be weakened');
        }
        if (confidenceBps >= previous.learnedItem.confidenceBps) {
          fail(
            LearningAuthorityErrorCode.TRANSITION_INVALID,
            'Weakened confidence must be lower than the current confidence',
          );
        }
        const outcome = createOutcomeOrFail({
          proposalId,
          projectId: proposal.projectId,
          status: LEARNING_OUTCOME_STATUS.WEAKENED,
          recordedAtMs: this.#now(),
          actor: { kind: LEARNING_ACTOR_KIND.USER, actorId },
          reason,
          previousOutcomeId: previous.outcomeId,
          learnedItem: {
            ...structuredClone(previous.learnedItem),
            itemVersion: previous.learnedItem.itemVersion + 1,
            confidenceBps,
            adaptation: {
              ...structuredClone(previous.learnedItem.adaptation),
              value: structuredClone(value),
            },
          },
          measurement: null,
        });
        return this.#insertOutcome(outcome, proposal, previous);
      });
    } catch (error) {
      storageFailure('learning weaken', error);
    }
  }

  rollbackLearning({ proposalId, actorId, reason }) {
    const current = this.getCurrentOutcome(proposalId);
    if (!current || !activeStatus(current.status) || !current.learnedItem?.active) {
      fail(LearningAuthorityErrorCode.TRANSITION_INVALID, 'Only active learning can be rolled back');
    }
    return this.#terminalUserTransition({
      proposalId,
      actorId,
      reason,
      status: LEARNING_OUTCOME_STATUS.ROLLED_BACK,
      retainItem: true,
    });
  }

  deleteLearning({ proposalId, actorId, reason }) {
    return this.#terminalUserTransition({
      proposalId,
      actorId,
      reason,
      status: LEARNING_OUTCOME_STATUS.DELETED,
      retainItem: false,
    });
  }

  #terminalUserTransition({ proposalId, actorId, reason, status, retainItem }) {
    requireIdentifier(actorId, 'actorId');
    requireReason(reason);
    try {
      return immediate(this.db, () => {
        const proposal = this.#proposalOrFail(proposalId);
        const previous = this.getCurrentOutcome(proposalId);
        if (!previous) {
          fail(LearningAuthorityErrorCode.OUTCOME_NOT_FOUND, 'Proposal has no current outcome');
        }
        const learnedItem = retainItem && previous.learnedItem
          ? { ...structuredClone(previous.learnedItem), active: false }
          : null;
        const outcome = createOutcomeOrFail({
          proposalId,
          projectId: proposal.projectId,
          status,
          recordedAtMs: this.#now(),
          actor: { kind: LEARNING_ACTOR_KIND.USER, actorId },
          reason,
          previousOutcomeId: previous.outcomeId,
          learnedItem,
          measurement: null,
        });
        return this.#insertOutcome(outcome, proposal, previous);
      });
    } catch (error) {
      storageFailure(`learning ${status}`, error);
    }
  }

  recordMeasurement({ proposalId, actorId = 'learning-outcome-evaluator.v1', reason, measurement }) {
    requireIdentifier(actorId, 'actorId');
    requireReason(reason);
    const checkedMeasurement = requireMeasurement(measurement);
    try {
      return immediate(this.db, () => {
        const proposal = this.#proposalOrFail(proposalId);
        const previous = this.getCurrentOutcome(proposalId);
        if (!previous || !activeStatus(previous.status) || !previous.learnedItem?.active) {
          fail(LearningAuthorityErrorCode.TRANSITION_INVALID, 'Only active learning can be measured');
        }
        const outcome = createOutcomeOrFail({
          proposalId,
          projectId: proposal.projectId,
          status: LEARNING_OUTCOME_STATUS.MEASURED,
          recordedAtMs: this.#now(),
          actor: { kind: LEARNING_ACTOR_KIND.SYSTEM, actorId },
          reason,
          previousOutcomeId: previous.outcomeId,
          learnedItem: structuredClone(previous.learnedItem),
          measurement: checkedMeasurement,
        });
        return this.#insertOutcome(outcome, proposal, previous);
      });
    } catch (error) {
      storageFailure('learning measurement', error);
    }
  }

  expireDue(projectId) {
    requireProjectId(projectId);
    try {
      return immediate(this.db, () => {
        const now = this.#now();
        const rows = this.db.prepare(`
          SELECT current.record_json
          FROM m4_learning_outcomes current
          WHERE current.project_id = ?
            AND current.status IN ('approved', 'measured', 'weakened')
            AND json_extract(current.record_json, '$.learnedItem.expiresAtMs') <= ?
            AND NOT EXISTS (
              SELECT 1 FROM m4_learning_outcomes child
              WHERE child.previous_outcome_id = current.outcome_id
            )
          ORDER BY current.outcome_id
        `).all(projectId, now);
        return rows.map(row => {
          const previousRaw = JSON.parse(row.record_json);
          const previous = this.getOutcome(previousRaw.outcomeId);
          const proposal = this.#proposalOrFail(previous.proposalId);
          const outcome = createOutcomeOrFail({
            proposalId: proposal.proposalId,
            projectId,
            status: LEARNING_OUTCOME_STATUS.EXPIRED,
            recordedAtMs: now,
            actor: { kind: LEARNING_ACTOR_KIND.SYSTEM, actorId: 'learning-retention.v1' },
            reason: 'The approved learning TTL elapsed.',
            previousOutcomeId: previous.outcomeId,
            learnedItem: null,
            measurement: null,
          });
          return this.#insertOutcome(outcome, proposal, previous);
        });
      });
    } catch (error) {
      storageFailure('learning expiration', error);
    }
  }

  getLearningSettlement(proposalId) {
    const proposal = this.getProposal(proposalId);
    if (!proposal) return null;
    const outcome = this.getCurrentOutcome(proposalId);
    const state = !outcome
      ? 'pending'
      : (activeStatus(outcome.status) ? 'active' : outcome.status);
    return deepFreeze({
      proposal,
      currentOutcome: outcome,
      state,
      learnedItem: outcome?.learnedItem ?? null,
    });
  }

  listActiveLearnedItems(projectId, { nowMs = this.#now() } = {}) {
    requireProjectId(projectId);
    if (!Number.isSafeInteger(nowMs) || nowMs < 1) {
      fail(LearningAuthorityErrorCode.INPUT_INVALID, 'nowMs must be a positive integer');
    }
    try {
      const rows = this.db.prepare(`
        SELECT proposal.record_json AS proposal_json,
               current.record_json AS outcome_json
        FROM m4_learning_outcomes current
        JOIN m4_learning_proposals proposal
          ON proposal.proposal_id = current.proposal_id
        WHERE current.project_id = ?
          AND current.status IN ('approved', 'measured', 'weakened')
          AND NOT EXISTS (
            SELECT 1 FROM m4_learning_outcomes child
            WHERE child.previous_outcome_id = current.outcome_id
          )
        ORDER BY current.outcome_id
      `).all(projectId);
      const items = [];
      for (const row of rows) {
        const proposal = parseStored(row.proposal_json, validateLearningProposalV1, 'LearningProposal');
        const rawOutcome = JSON.parse(row.outcome_json);
        const outcome = this.getOutcome(rawOutcome.outcomeId);
        const item = outcome.learnedItem;
        if (!item?.active || item.expiresAtMs <= nowMs) continue;
        const approvedAtMs = item.expiresAtMs - proposal.retention.ttlMs;
        const ageMs = Math.max(0, nowMs - approvedAtMs);
        const halfLives = ageMs / proposal.retention.decay.halfLifeMs;
        const effectiveConfidenceBps = Math.floor(item.confidenceBps * (2 ** -halfLives));
        if (effectiveConfidenceBps < proposal.retention.decay.floorConfidenceBps) continue;
        items.push(deepFreeze({
          projectId,
          itemId: item.itemId,
          itemVersion: item.itemVersion,
          proposalId: proposal.proposalId,
          outcomeId: outcome.outcomeId,
          observationIds: [...proposal.observationIds],
          adaptation: structuredClone(item.adaptation),
          baseConfidenceBps: item.confidenceBps,
          effectiveConfidenceBps,
          approvedAtMs,
          expiresAtMs: item.expiresAtMs,
        }));
      }
      return Object.freeze(items);
    } catch (error) {
      storageFailure('active learning read', error);
    }
  }

  exportProjectLearning(projectId) {
    requireProjectId(projectId);
    try {
      const observations = this.db.prepare(`
        SELECT record_json FROM m4_learning_observations
        WHERE project_id = ? ORDER BY observed_at_ms, observation_id
      `).all(projectId).map(row => (
        parseStored(row.record_json, validateLearningObservationV1, 'LearningObservation')
      ));
      const proposals = this.db.prepare(`
        SELECT record_json FROM m4_learning_proposals
        WHERE project_id = ? ORDER BY created_at_ms, proposal_id
      `).all(projectId).map(row => (
        parseStored(row.record_json, validateLearningProposalV1, 'LearningProposal')
      ));
      const outcomes = this.db.prepare(`
        SELECT outcome_id FROM m4_learning_outcomes
        WHERE project_id = ? ORDER BY recorded_at_ms, outcome_id
      `).all(projectId).map(row => this.getOutcome(row.outcome_id));
      return deepFreeze({ projectId, observations, proposals, outcomes });
    } catch (error) {
      storageFailure('project learning export', error);
    }
  }
}
