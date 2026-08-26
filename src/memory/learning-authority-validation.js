import {
  canonicalizeLearningValue,
  validateLearningObservationV1,
  validateLearningOutcomeTransitionV1,
  validateLearningProposalV1,
} from '../../contracts/m4/learning-v1.js';

function exactCanonicalRecord(raw, validator) {
  if (typeof raw !== 'string') return 0;
  try {
    const parsed = JSON.parse(raw);
    return validator(parsed).valid && canonicalizeLearningValue(parsed) === raw ? 1 : 0;
  } catch {
    return 0;
  }
}

export function registerM4LearningAuthorityFunctions(db) {
  db.function('m4_learning_observation_valid_v1', {
    deterministic: true,
  }, raw => exactCanonicalRecord(raw, validateLearningObservationV1));
  db.function('m4_learning_proposal_valid_v1', {
    deterministic: true,
  }, raw => exactCanonicalRecord(raw, validateLearningProposalV1));
  db.function('m4_learning_outcome_transition_valid_v1', {
    deterministic: true,
  }, (outcomeRaw, proposalRaw, previousRaw) => {
    if (
      exactCanonicalRecord(proposalRaw, validateLearningProposalV1) !== 1
      || typeof outcomeRaw !== 'string'
    ) return 0;
    try {
      const outcome = JSON.parse(outcomeRaw);
      const proposal = JSON.parse(proposalRaw);
      const previous = previousRaw === null ? null : JSON.parse(previousRaw);
      return (
        canonicalizeLearningValue(outcome) === outcomeRaw
        && validateLearningOutcomeTransitionV1(outcome, proposal, previous).valid
      ) ? 1 : 0;
    } catch {
      return 0;
    }
  });
}
