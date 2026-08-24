// Cheap, factual candidate eligibility used before an exact model evaluation.
//
// This module does not score quality and cannot recommend or activate a model.
// Unknown soft capabilities stay for the measured capability/evaluation gates.

import { MODEL_PROFILES } from './model-profiles.js';

export function checkRoleEligibility(model, role, profiles = MODEL_PROFILES) {
  const profile = profiles?.[role];
  const requirements = profile?.requirements;
  if (!requirements) return { eligible: true, reason: null };

  const params = model?.params;
  if (params) {
    if (requirements.minParams && params < requirements.minParams) {
      return { eligible: false, reason: `${params}B < minimum ${requirements.minParams}B` };
    }
    if (requirements.maxParams && params > requirements.maxParams) {
      return { eligible: false, reason: `${params}B > maximum ${requirements.maxParams}B` };
    }
  }

  const needsVision = Array.isArray(requirements.capabilities)
    && requirements.capabilities.some(capability => (
      capability === 'vision' || capability === 'image-understanding'
    ));
  if (needsVision) {
    const capabilities = Array.isArray(model?.capabilities) ? model.capabilities : [];
    const hasVision = model?.category === 'vision' || capabilities.includes('vision');
    if (!hasVision) return { eligible: false, reason: 'model neumí zpracovat obraz' };
  }

  return { eligible: true, reason: null };
}

export default { checkRoleEligibility };
