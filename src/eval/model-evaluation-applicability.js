// Versioned authority for model-evaluation coverage.
//
// These are technical measurement constraints, not discovery preferences and
// not quality claims.  Unknown soft capabilities remain measurable.  A pair
// is excluded only when known model facts contradict this contract.

export const MODEL_EVALUATION_APPLICABILITY_VERSION = 'technical-role-compatibility-v1';

const ROLE_CONSTRAINTS = Object.freeze({
  D1: Object.freeze({ min: 14, max: 72, modalities: Object.freeze([]) }),
  D2: Object.freeze({ min: 7, max: 72, modalities: Object.freeze([]) }),
  CODE: Object.freeze({ min: 7, max: 72, modalities: Object.freeze([]) }),
  R1: Object.freeze({ min: 14, max: 72, modalities: Object.freeze([]) }),
  R2: Object.freeze({ min: 7, max: 72, modalities: Object.freeze([]) }),
  CHAT: Object.freeze({ min: 7, max: 72, modalities: Object.freeze([]) }),
  VISION: Object.freeze({ min: 7, max: 72, modalities: Object.freeze(['vision']) }),
});

export function applicabilityContractForRole(role) {
  const normalizedRole = String(role || '').toUpperCase();
  const constraints = ROLE_CONSTRAINTS[normalizedRole]
    || { min: null, max: null, modalities: [] };
  return Object.freeze({
    version: MODEL_EVALUATION_APPLICABILITY_VERSION,
    scope: 'all-technically-compatible-installed-artifacts',
    role: normalizedRole,
    minimumParametersBillions: constraints.min,
    maximumParametersBillions: constraints.max,
    requiredModalities: Object.freeze([...constraints.modalities]),
  });
}

export function checkModelEvaluationApplicability(model, planOrContract) {
  const contract = planOrContract?.applicabilityContract || planOrContract;
  if (contract?.version !== MODEL_EVALUATION_APPLICABILITY_VERSION) {
    throw new TypeError('current model evaluation applicability contract is required');
  }
  const params = model?.params == null || model.params === ''
    ? null
    : Number(model.params);
  if (Number.isFinite(params) && contract.minimumParametersBillions != null
    && params < contract.minimumParametersBillions) {
    return Object.freeze({
      applicable: false,
      reasonCode: 'MODEL_PARAMETERS_BELOW_ROLE_MINIMUM',
      reason: `${params}B < minimum ${contract.minimumParametersBillions}B`,
    });
  }
  if (Number.isFinite(params) && contract.maximumParametersBillions != null
    && params > contract.maximumParametersBillions) {
    return Object.freeze({
      applicable: false,
      reasonCode: 'MODEL_PARAMETERS_ABOVE_ROLE_MAXIMUM',
      reason: `${params}B > maximum ${contract.maximumParametersBillions}B`,
    });
  }
  if (contract.requiredModalities.includes('vision')) {
    const capabilities = Array.isArray(model?.capabilities) ? model.capabilities : [];
    const hasVision = model?.category === 'vision'
      || capabilities.includes('vision')
      || capabilities.includes('image-understanding');
    if (!hasVision) {
      return Object.freeze({
        applicable: false,
        reasonCode: 'MODEL_VISION_CAPABILITY_REQUIRED',
        reason: 'model neumí zpracovat obraz (image-understanding capability missing)',
      });
    }
  }
  return Object.freeze({ applicable: true, reasonCode: null, reason: null });
}

export default {
  MODEL_EVALUATION_APPLICABILITY_VERSION,
  applicabilityContractForRole,
  checkModelEvaluationApplicability,
};
