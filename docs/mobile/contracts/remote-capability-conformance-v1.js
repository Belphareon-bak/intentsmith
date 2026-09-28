// Provider-side conformance harness for the mobile RemoteCore candidate.
// It exercises an injected in-process provider only. It never opens a listener,
// creates credentials, imports backend storage, or activates the candidate.

import { canonicalizeRemoteCoreValue } from '../../../src/mobile/client/remote-core-v1.js';
import {
  MOBILE_REMOTE_GOLDEN_OPERATION_FIXTURES_V1,
} from './fixtures/remote-capability-golden-v1.js';
import {
  MOBILE_REMOTE_CAPABILITY_MANIFESTS_V1,
  validateMobileRemoteOperationPair,
} from './remote-capability-manifests-v1.js';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function plain(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys) {
  return plain(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

export function validateMobileRemoteCandidateAdvertisement(advertisement) {
  const errors = [];
  if (!Array.isArray(advertisement)) {
    return { valid: false, errors: ['candidate-advertisement:not-array'] };
  }
  const expected = Object.values(MOBILE_REMOTE_CAPABILITY_MANIFESTS_V1);
  if (advertisement.length !== expected.length) {
    errors.push('candidate-advertisement:capability-count-mismatch');
  }
  for (const manifest of expected) {
    const context = `candidate-advertisement.${manifest.capabilityId}`;
    const item = advertisement.find(value => value?.capabilityId === manifest.capabilityId);
    if (!item) {
      errors.push(`${context}:missing`);
      continue;
    }
    if (!exactKeys(item, [
      'capabilityId', 'status', 'selectedVersion', 'contractDigest', 'operationsDigest', 'error',
    ])) errors.push(`${context}:invalid-fields`);
    if (item.status !== 'available') errors.push(`${context}:not-available`);
    if (item.selectedVersion !== manifest.version) errors.push(`${context}:version-mismatch`);
    if (item.contractDigest !== manifest.contractDigest) errors.push(`${context}:contractDigest-mismatch`);
    if (item.operationsDigest !== manifest.operationsDigest) errors.push(`${context}:operationsDigest-mismatch`);
    if (item.error !== null) errors.push(`${context}:unexpected-error`);
  }
  for (const item of advertisement) {
    if (!MOBILE_REMOTE_CAPABILITY_MANIFESTS_V1[item?.capabilityId]) {
      errors.push(`candidate-advertisement:unknown-${item?.capabilityId ?? 'capability'}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export async function runMobileRemoteProviderConformance({
  invoke,
  externalValidators = {},
  includeControlPlane = false,
  fixtures = MOBILE_REMOTE_GOLDEN_OPERATION_FIXTURES_V1,
} = {}) {
  if (typeof invoke !== 'function') throw new TypeError('mobile-provider-conformance:invoke-required');
  const selected = fixtures.filter(fixture => (
    includeControlPlane || fixture.capabilityId !== 'm7-control-plane-prerequisite'
  ));
  const failures = [];
  for (const fixture of selected) {
    const request = structuredClone(fixture.request);
    const before = canonicalizeRemoteCoreValue(request);
    try {
      const result = await invoke({
        capabilityId: fixture.capabilityId,
        capabilityVersion: fixture.capabilityVersion,
        operationId: fixture.operationId,
        request,
      });
      if (canonicalizeRemoteCoreValue(request) !== before) {
        failures.push({ operationId: fixture.operationId, errors: ['provider-mutated-request'] });
        continue;
      }
      const validation = validateMobileRemoteOperationPair({
        ...fixture,
        result,
        externalValidators,
      });
      if (!validation.valid) failures.push({
        operationId: fixture.operationId,
        errors: validation.errors,
      });
      else if (!(result?.status === 'ok' || result?.outcome === 'CONFIRMED')) failures.push({
        operationId: fixture.operationId,
        errors: ['provider-did-not-produce-golden-success-variant'],
      });
    } catch (caught) {
      failures.push({
        operationId: fixture.operationId,
        errors: [`provider-threw:${caught?.code ?? caught?.name ?? 'Error'}`],
      });
    }
  }
  return deepFreeze({
    contract: 'MobileRemoteProviderConformanceReport',
    version: 1,
    stage: 'CANDIDATE_NOT_ACCEPTED',
    passed: failures.length === 0,
    total: selected.length,
    passedCount: selected.length - failures.length,
    failures,
  });
}
