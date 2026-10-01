import { createHash } from 'node:crypto';

import { computeEffectRequestDigest } from '../../contracts/m2/effect-current.js';

export const M2_ROLLBACK_OBSERVATION = Object.freeze({
  MATCHES_FORWARD: 'matches_forward',
  MATCHES_BEFORE: 'matches_before',
  FOREIGN: 'foreign',
});

const OBSERVATIONS = new Set(Object.values(M2_ROLLBACK_OBSERVATION));
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

export function digestStoredEffectResult(resultJson) {
  if (typeof resultJson !== 'string') return null;
  return `sha256:${createHash('sha256').update(resultJson, 'utf8').digest('hex')}`;
}

function knownMissingBefore(request, result) {
  if (result?.changes?.beforeDigest !== null) return false;
  if (request?.version === 3 && request?.requiredCapability === 'project.fs.create') {
    // Only provider evidence from after the atomic link proves that the
    // create-only target was absent. A restart orphan with no provider
    // evidence must retain its debt when the current name is missing.
    return Array.isArray(result?.evidenceRefs) && [
      'fs-create',
      'fs-create-durability-unconfirmed',
      'fs-create-post-commit-verification-failed',
    ].some(reason => result.evidenceRefs.includes(`effect:${result.effectId}:${reason}`));
  }
  if (result?.changes?.afterDigest !== null) return true;
  return Array.isArray(result?.evidenceRefs)
    && result.evidenceRefs.includes(
      `effect:${result.effectId}:fs-write-post-commit-verification-failed`,
    );
}

/**
 * Classify a descriptor-pinned observation without changing the target. The
 * authorized payload digest is the forward image even when a failed provider
 * could not persist its own read-back digest. A null beforeDigest is treated
 * as a known missing file only when provider evidence proves that preflight
 * completed; restart-created orphan results deliberately retain unknown truth.
 */
export function classifyRollbackObservation({
  request,
  result,
  observedExists,
  observedDigest,
} = {}) {
  const validObservation = typeof observedExists === 'boolean'
    && (observedExists ? DIGEST_PATTERN.test(observedDigest) : observedDigest === null);
  const exactAuthority = request?.kind === 'fs.write'
    && (request.version !== 3 || (request.requiredCapability === 'project.fs.create'
      && result?.changes?.beforeDigest === null))
    && result?.effectId === request.effectId
    && result?.requestDigest === computeEffectRequestDigest(request)
    && result?.rollback?.required === true
    && result.rollback.status === 'pending';
  if (!validObservation || !exactAuthority) return null;

  if (observedExists && observedDigest === request.payloadDigest) {
    return M2_ROLLBACK_OBSERVATION.MATCHES_FORWARD;
  }
  if (
    observedExists
    && result.changes?.beforeDigest !== null
    && observedDigest === result.changes.beforeDigest
  ) return M2_ROLLBACK_OBSERVATION.MATCHES_BEFORE;
  if (!observedExists && knownMissingBefore(request, result)) {
    return M2_ROLLBACK_OBSERVATION.MATCHES_BEFORE;
  }
  return M2_ROLLBACK_OBSERVATION.FOREIGN;
}

export function rollbackObservationMatchesJson(
  requestJson,
  resultJson,
  observationCode,
  observedExists,
  observedDigest,
) {
  try {
    return classifyRollbackObservation({
      request: JSON.parse(requestJson),
      result: JSON.parse(resultJson),
      observedExists: observedExists === 1,
      observedDigest,
    }) === observationCode ? 1 : 0;
  } catch {
    return 0;
  }
}

export function validateRollbackReceiptForResult({
  request,
  result,
  resultJson,
  receipt,
} = {}) {
  if (!request || !result || typeof resultJson !== 'string' || !receipt) return false;
  const expectedObservation = classifyRollbackObservation({
    request,
    result,
    observedExists: receipt.observedExists,
    observedDigest: receipt.observedDigest,
  });
  return OBSERVATIONS.has(receipt.observationCode)
    && expectedObservation === receipt.observationCode
    && receipt.effectId === result.effectId
    && receipt.requestDigest === result.requestDigest
    && receipt.resultDigest === digestStoredEffectResult(resultJson)
    && Number.isSafeInteger(receipt.observedAtMs)
    && receipt.observedAtMs >= Date.parse(result.completedAt)
    && receipt.evidenceRef
      === `effect:${result.effectId}:rollback-observation:${receipt.observationCode}`;
}

export function buildEffectSettlement(result, receipt = null) {
  if (!result) return null;
  const receiptSettled = receipt?.observationCode === M2_ROLLBACK_OBSERVATION.MATCHES_FORWARD
    || receipt?.observationCode === M2_ROLLBACK_OBSERVATION.MATCHES_BEFORE;
  const rollbackApplied = result.rollback.required === true && result.rollback.status === 'succeeded';
  const required = result.rollback.required === true && !rollbackApplied && !receiptSettled;
  const status = result.rollback.required !== true
    ? 'not_required'
    : rollbackApplied
      ? 'settled_by_rollback'
      : receiptSettled
        ? 'settled_by_observation'
        : receipt?.observationCode === M2_ROLLBACK_OBSERVATION.FOREIGN
          ? 'foreign'
          : result.rollback.status;
  return Object.freeze({
    result,
    rollbackReceipt: receipt,
    rollbackDebt: Object.freeze({
      required,
      status,
      sourceStatus: result.rollback.status,
      evidenceRef: receiptSettled ? receipt.evidenceRef : result.rollback.evidenceRef,
      observation: receipt?.observationCode || null,
    }),
  });
}
