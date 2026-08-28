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

/**
 * The installed scoring panel uses role requirements and the role's declared
 * category policy. Keep that policy in one place so discovery, the read model
 * and the operator-facing overview agree about which model-role pairs are in
 * scoring scope. Automatic deletion remains separately fail-closed.
 */
export function checkRoleCandidateApplicability(model, role, profiles = MODEL_PROFILES) {
  const eligibility = checkRoleEligibility(model, role, profiles);
  if (!eligibility.eligible) {
    return Object.freeze({
      applicable: false,
      reasonCode: 'ROLE_REQUIREMENTS_NOT_MET',
      reason: eligibility.reason,
    });
  }

  const preferredCategories = profiles?.[role]?.preferredCategories;
  const category = typeof model?.category === 'string' ? model.category.trim() : '';
  if (preferredCategories?.length
    && category
    && category !== 'unknown'
    && !preferredCategories.includes(category)) {
    return Object.freeze({
      applicable: false,
      reasonCode: 'ROLE_CATEGORY_NOT_PREFERRED',
      reason: `category ${category} is outside ${role}: ${preferredCategories.join(', ')}`,
    });
  }

  return Object.freeze({ applicable: true, reasonCode: null, reason: null });
}

export default { checkRoleEligibility, checkRoleCandidateApplicability };
