// Cheap, factual candidate eligibility used before an exact model evaluation.
//
// This module does not score quality and cannot recommend or activate a model.
// Unknown soft capabilities stay for the measured capability/evaluation gates.

import {
  applicabilityContractForRole,
  checkModelEvaluationApplicability,
} from '../eval/model-evaluation-applicability.js';

export function checkRoleEligibility(model, role) {
  const result = checkModelEvaluationApplicability(
    model,
    applicabilityContractForRole(role),
  );
  return { eligible: result.applicable, reason: result.reason };
}

export default { checkRoleEligibility };
