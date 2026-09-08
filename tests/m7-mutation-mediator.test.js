#!/usr/bin/env node

import './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';

import {
  M7_MUTATION_MEDIATOR_ERROR,
  M7_MUTATION_MEDIATOR_STAGE,
  consumeM7MutationMediator,
  createM7MutationMediator,
  isGenuineM7MutationMediator,
} from '../src/remote/m7-mutation-mediator.js';
import { suite, summary, testAsync } from './harness.js';

const CONTRACTS = ['ApprovalGrant@1', 'EffectRequest@1', 'EffectResult@1'];

function authority(overrides = {}) {
  return {
    capabilityId: 'settings',
    deviceId: 'device:fixture:001',
    operationId: 'settings.update',
    request: { contract: 'FixtureRequest', version: 1, value: 'compact' },
    requiredScopes: ['write:settings'],
    subjectId: 'local-operator',
    ...overrides,
  };
}

function intent(overrides = {}) {
  return {
    authorityContracts: CONTRACTS,
    capabilityId: 'settings',
    deviceId: 'device:fixture:001',
    operationId: 'settings.update',
    request: { contract: 'FixtureRequest', version: 1, value: 'compact' },
    subjectId: 'local-operator',
    perform: async () => ({ outcome: 'CONFIRMED' }),
    ...overrides,
  };
}

suite('M7 signed-invocation mutation mediator');

await testAsync('genuine mediator is inert outside an authorized invocation', async () => {
  const mediator = createM7MutationMediator();
  let effects = 0;
  const result = await mediator.mediate(intent({
    perform: async () => { effects += 1; return { outcome: 'CONFIRMED' }; },
  }));
  assert.equal(M7_MUTATION_MEDIATOR_STAGE, 'IMPLEMENTED_NOT_ACTIVE');
  assert.equal(isGenuineM7MutationMediator(mediator), true);
  assert.equal(isGenuineM7MutationMediator({ ...mediator }), false);
  assert.equal(result.state, 'rejected');
  assert.equal(result.error.code, M7_MUTATION_MEDIATOR_ERROR.AUTHORITY_DENIED);
  assert.equal(effects, 0);
});

await testAsync('exact authorized device, subject, operation and request execute once', async () => {
  const mediator = createM7MutationMediator();
  const receiver = consumeM7MutationMediator(mediator);
  let effects = 0;
  const first = await receiver.runAuthorized(authority(), async () => mediator.mediate(intent({
    perform: async () => { effects += 1; return { outcome: 'CONFIRMED' }; },
  })));
  assert.deepEqual(first, { state: 'executed', result: { outcome: 'CONFIRMED' } });
  assert.equal(effects, 1);

  const second = await receiver.runAuthorized(authority(), async () => {
    const accepted = await mediator.mediate(intent({
      perform: async () => { effects += 1; return { outcome: 'CONFIRMED' }; },
    }));
    const replay = await mediator.mediate(intent({
      perform: async () => { effects += 1; return { outcome: 'CONFIRMED' }; },
    }));
    return { accepted, replay };
  });
  assert.equal(second.accepted.state, 'executed');
  assert.equal(second.replay.state, 'rejected');
  assert.equal(effects, 2);
});

await testAsync('identity, request, operation and authority-contract drift never reach effect', async () => {
  const mediator = createM7MutationMediator();
  const receiver = consumeM7MutationMediator(mediator);
  const variants = [
    { deviceId: 'device:other' },
    { subjectId: 'subject:other' },
    { operationId: 'stored-information.append' },
    { request: { contract: 'FixtureRequest', version: 1, value: 'spacious' } },
    { authorityContracts: ['EffectRequest@1', 'EffectResult@1'] },
  ];
  let effects = 0;
  for (const variant of variants) {
    const result = await receiver.runAuthorized(authority(), () => mediator.mediate(intent({
      ...variant,
      perform: async () => { effects += 1; return { outcome: 'CONFIRMED' }; },
    })));
    assert.equal(result.state, 'rejected');
  }
  assert.equal(effects, 0);
});

await testAsync('concurrent authorization contexts stay isolated', async () => {
  const mediator = createM7MutationMediator();
  const receiver = consumeM7MutationMediator(mediator);
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const first = receiver.runAuthorized(authority(), async () => {
    await barrier;
    return mediator.mediate(intent());
  });
  const second = receiver.runAuthorized(authority({
    deviceId: 'device:fixture:002',
    request: { contract: 'FixtureRequest', version: 1, value: 'spacious' },
  }), async () => mediator.mediate(intent({
    deviceId: 'device:fixture:002',
    request: { contract: 'FixtureRequest', version: 1, value: 'spacious' },
  })));
  release();
  assert.equal((await first).state, 'executed');
  assert.equal((await second).state, 'executed');
});

await testAsync('effect exceptions propagate and the authorization cannot be reused', async () => {
  const mediator = createM7MutationMediator();
  const receiver = consumeM7MutationMediator(mediator);
  const result = await receiver.runAuthorized(authority(), async () => {
    await assert.rejects(
      mediator.mediate(intent({ perform: async () => { throw new Error('effect-failed'); } })),
      /effect-failed/u,
    );
    return mediator.mediate(intent());
  });
  assert.equal(result.state, 'rejected');
});

summary();
