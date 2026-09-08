import { AsyncLocalStorage } from 'node:async_hooks';

import { canonicalizeM2ExecutionValue } from '../../contracts/m2/execution-v1.js';

export const M7_MUTATION_MEDIATOR_STAGE = 'IMPLEMENTED_NOT_ACTIVE';

export const M7_MUTATION_MEDIATOR_ERROR = Object.freeze({
  AUTHORITY_DENIED: 'M7_MUTATION_AUTHORITY_DENIED',
});

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const AUTHORITY_CONTRACTS = Object.freeze([
  'ApprovalGrant@1',
  'EffectRequest@1',
  'EffectResult@1',
]);
const mediatorState = new WeakMap();

function plain(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, required, optional = []) {
  if (!plain(value)) return false;
  const expected = new Set([...required, ...optional]);
  return required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => expected.has(key));
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function sameCanonical(left, right) {
  try {
    return canonicalizeM2ExecutionValue(left) === canonicalizeM2ExecutionValue(right);
  } catch {
    return false;
  }
}

function validIdentity(value) {
  return IDENTIFIER.test(value || '');
}

function validateInvocationAuthority(value) {
  if (!exactKeys(value, [
    'capabilityId', 'deviceId', 'operationId', 'request', 'requiredScopes', 'subjectId',
  ])
    || !validIdentity(value.capabilityId)
    || !validIdentity(value.deviceId)
    || !validIdentity(value.operationId)
    || !validIdentity(value.subjectId)
    || !plain(value.request)
    || !Array.isArray(value.requiredScopes)
    || value.requiredScopes.length < 1
    || value.requiredScopes.some(scope => !validIdentity(scope))
    || !value.requiredScopes.some(scope => scope.startsWith('write:'))) {
    throw new TypeError('m7-mutation-mediator:invocation-authority-invalid');
  }
  return deepFreeze(structuredClone(value));
}

function rejected() {
  return Object.freeze({
    state: 'rejected',
    error: Object.freeze({
      code: M7_MUTATION_MEDIATOR_ERROR.AUTHORITY_DENIED,
      message: 'The signed invocation does not authorize this mutation.',
      retryable: false,
    }),
  });
}

export function createM7MutationMediator() {
  const invocationContext = new AsyncLocalStorage();

  const mediator = Object.freeze({
    contract: 'M7SignedInvocationMutationMediator',
    version: 1,
    stage: M7_MUTATION_MEDIATOR_STAGE,
    async mediate(input) {
      if (!exactKeys(input, [
        'authorityContracts', 'capabilityId', 'deviceId', 'operationId', 'perform',
        'request', 'subjectId',
      ], ['projectId'])
        || !Array.isArray(input.authorityContracts)
        || !sameCanonical(input.authorityContracts, AUTHORITY_CONTRACTS)
        || typeof input.perform !== 'function') {
        return rejected();
      }
      const current = invocationContext.getStore();
      if (!current
        || current.consumed
        || current.capabilityId !== input.capabilityId
        || current.deviceId !== input.deviceId
        || current.operationId !== input.operationId
        || current.subjectId !== input.subjectId
        || !sameCanonical(current.request, input.request)) {
        return rejected();
      }
      current.consumed = true;
      const result = await input.perform();
      return Object.freeze({ state: 'executed', result });
    },
  });

  mediatorState.set(mediator, Object.freeze({
    async runAuthorized(authority, callback) {
      if (typeof callback !== 'function') {
        throw new TypeError('m7-mutation-mediator:callback-required');
      }
      const trusted = validateInvocationAuthority(authority);
      return invocationContext.run({ ...trusted, consumed: false }, callback);
    },
  }));
  return mediator;
}

export function consumeM7MutationMediator(mediator) {
  const state = mediatorState.get(mediator);
  if (!state) throw new TypeError('m7-mutation-mediator:genuine-mediator-required');
  return state;
}

export function isGenuineM7MutationMediator(value) {
  return mediatorState.has(value);
}

export default createM7MutationMediator;
