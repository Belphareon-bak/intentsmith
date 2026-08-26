import {
  LEARNING_PLAN_CONFORMANCE_STATUS,
  validateLearningPlanEvaluationArtifactV1,
} from '../../contracts/m4/learning-plan-evaluation-v1.js';
import { validateProjectLearningContextV1 } from '../../contracts/m4/project-learning-context-v1.js';
import {
  LEARNING_MEASUREMENT_METRIC,
  canonicalizeLearningValue,
} from '../../contracts/m4/learning-v1.js';

export class LearningOutcomeEvaluationError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'LearningOutcomeEvaluationError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = null) {
  throw new LearningOutcomeEvaluationError(code, message, details);
}

function requireRepository(repository) {
  if (
    !repository
    || typeof repository.getLearningSettlement !== 'function'
    || typeof repository.recordMeasurement !== 'function'
    || typeof repository.listActiveLearnedItems !== 'function'
    || typeof repository.recordPlanEvaluationArtifact !== 'function'
  ) fail('LEARNING_OUTCOME_REPOSITORY_REQUIRED', 'Learning authority repository is required');
  return repository;
}

function requireArtifact(value, label) {
  const result = validateLearningPlanEvaluationArtifactV1(value);
  if (!result.valid) {
    fail('LEARNING_OUTCOME_ARTIFACT_INVALID', `${label} artifact is invalid`, {
      errors: [...result.errors],
    });
  }
  return value;
}

function conformanceScore(status) {
  return status === LEARNING_PLAN_CONFORMANCE_STATUS.CONFORMED
    || status === LEARNING_PLAN_CONFORMANCE_STATUS.CONFLICT_EXPLICIT
    ? 10_000
    : 0;
}

function sameItem(artifact, settlement) {
  const item = settlement.learnedItem;
  return artifact.projectId === settlement.proposal.projectId
    && artifact.proposalId === settlement.proposal.proposalId
    && artifact.itemId === item?.itemId
    && artifact.itemVersion === item?.itemVersion
    && artifact.conformance.key === item?.adaptation?.key;
}

function contextItemMatchesAuthority(contextItem, authorityItem) {
  if (!contextItem || !authorityItem) return false;
  const projected = {
    itemId: authorityItem.itemId,
    itemVersion: authorityItem.itemVersion,
    proposalId: authorityItem.proposalId,
    outcomeId: authorityItem.outcomeId,
    key: authorityItem.adaptation.key,
    value: authorityItem.adaptation.value,
    baseConfidenceBps: authorityItem.baseConfidenceBps,
    effectiveConfidenceBps: authorityItem.effectiveConfidenceBps,
    approvedAtMs: authorityItem.approvedAtMs,
    expiresAtMs: authorityItem.expiresAtMs,
    sourceObservationIds: [...authorityItem.observationIds].sort(),
  };
  const observed = {
    itemId: contextItem.itemId,
    itemVersion: contextItem.itemVersion,
    proposalId: contextItem.proposalId,
    outcomeId: contextItem.outcomeId,
    key: contextItem.key,
    value: contextItem.value,
    baseConfidenceBps: contextItem.baseConfidenceBps,
    effectiveConfidenceBps: contextItem.effectiveConfidenceBps,
    approvedAtMs: contextItem.approvedAtMs,
    expiresAtMs: contextItem.expiresAtMs,
    sourceObservationIds: [...contextItem.sourceObservationIds],
  };
  return canonicalizeLearningValue(observed) === canonicalizeLearningValue(projected);
}

export function createLearningOutcomeEvaluator(repositoryValue) {
  const repository = requireRepository(repositoryValue);
  return Object.freeze({
    measurePlanConformance({ proposalId, baselineArtifact, observedArtifact, projectLearningContext }) {
      const settlement = repository.getLearningSettlement(proposalId);
      if (!settlement || settlement.state !== 'active' || !settlement.learnedItem?.active) {
        fail('LEARNING_OUTCOME_ITEM_NOT_ACTIVE', 'Plan conformance requires an active learned item');
      }
      const baseline = requireArtifact(baselineArtifact, 'Baseline');
      const observed = requireArtifact(observedArtifact, 'Observed');
      const contextValidation = validateProjectLearningContextV1(projectLearningContext);
      if (!contextValidation.valid) {
        fail('LEARNING_OUTCOME_CONTEXT_INVALID', 'Project learning context is invalid', {
          errors: [...contextValidation.errors],
        });
      }
      if (!sameItem(baseline, settlement) || !sameItem(observed, settlement)) {
        fail('LEARNING_OUTCOME_ITEM_MISMATCH', 'Evaluation artifacts do not bind the active item version');
      }
      if (baseline.learningContextDigest !== null) {
        fail('LEARNING_OUTCOME_BASELINE_INVALID', 'Baseline must be measured without learned context');
      }
      if (baseline.conformance.status !== LEARNING_PLAN_CONFORMANCE_STATUS.ABSENT) {
        fail('LEARNING_OUTCOME_BASELINE_INVALID', 'Baseline must report learned pattern absence');
      }
      const contextItem = projectLearningContext.items.find(item => (
        item.itemId === settlement.learnedItem.itemId
        && item.itemVersion === settlement.learnedItem.itemVersion
        && item.proposalId === proposalId
      ));
      const authorityItem = repository.listActiveLearnedItems(
        settlement.proposal.projectId,
        { nowMs: projectLearningContext.generatedAtMs },
      ).find(item => (
        item.itemId === settlement.learnedItem.itemId
        && item.itemVersion === settlement.learnedItem.itemVersion
      ));
      if (
        observed.learningContextDigest !== projectLearningContext.contextDigest
        || projectLearningContext.projectId !== settlement.proposal.projectId
        || !contextItemMatchesAuthority(contextItem, authorityItem)
      ) fail('LEARNING_OUTCOME_CONTEXT_MISMATCH', 'Observed artifact is not bound to the active context item');
      if (observed.generatedAtMs <= baseline.generatedAtMs) {
        fail('LEARNING_OUTCOME_TIME_INVALID', 'Observed plan must follow the baseline plan');
      }
      const baselineScoreBps = conformanceScore(baseline.conformance.status);
      const observedScoreBps = conformanceScore(observed.conformance.status);
      const reason = `Exact plan conformance comparison baseline=${baseline.artifactId} observed=${observed.artifactId} context=${projectLearningContext.contextDigest}`;
      repository.recordPlanEvaluationArtifact(baseline);
      repository.recordPlanEvaluationArtifact(observed);
      const outcome = repository.recordMeasurement({
        proposalId,
        actorId: 'learning-outcome-evaluator.v1',
        reason,
        measurement: {
          metric: LEARNING_MEASUREMENT_METRIC.PLAN_CONFORMANCE,
          baselineScoreBps,
          observedScoreBps,
          deltaBps: observedScoreBps - baselineScoreBps,
          sampleSize: 1,
          baselineArtifactId: baseline.artifactId,
          observedArtifactId: observed.artifactId,
        },
      });
      return Object.freeze({ baseline, observed, projectLearningContext, outcome });
    },
  });
}
