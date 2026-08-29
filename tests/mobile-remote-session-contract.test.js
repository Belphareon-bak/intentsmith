#!/usr/bin/env node

import { strict as assert } from 'node:assert';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  MOBILE_REMOTE_SESSION_CONTRACT_DIGEST_V1,
  MOBILE_REMOTE_SESSION_CONTRACT_STAGE_V1,
  MOBILE_REMOTE_SESSION_CONTRACT_V1,
  createRemoteInvocationProofBytesV1,
  resolveRemoteSecurityTransitionV1,
  validateRemoteCursorBindingV1,
  validateRemoteInvocationEnvelopeV1,
  validateRemoteResponseEnvelopeV1,
  validateRemoteSessionControlExchangeV1,
  validateRemoteSessionControlMessageV1,
  validateRemoteSessionNegotiationV1,
} from '../docs/mobile/contracts/remote-session-contract-v1.js';
import {
  createRemoteSessionGoldenFixturesV1,
  createRemoteSessionNegativeFixturesV1,
  MOBILE_REMOTE_SESSION_FIXTURE_CONSTANTS_V1,
} from '../docs/mobile/contracts/fixtures/remote-session-golden-v1.js';
import {
  digestRemoteCoreValue,
} from '../src/mobile/client/remote-core-v1.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✗ ${name}: ${error.message}`);
  }
}

const golden = await createRemoteSessionGoldenFixturesV1(webcrypto);
const nowMs = MOBILE_REMOTE_SESSION_FIXTURE_CONSTANTS_V1.nowMs;
const previousCounter = MOBILE_REMOTE_SESSION_FIXTURE_CONSTANTS_V1.previousCounter;

console.log('\n=== Mobile Remote session/security contract candidate ===');

await test('candidate is immutable, non-authoritative and canonically pinned', async () => {
  assert.equal(MOBILE_REMOTE_SESSION_CONTRACT_STAGE_V1, 'CANDIDATE_NOT_ACCEPTED');
  assert.equal(MOBILE_REMOTE_SESSION_CONTRACT_V1.activation.runtimeAuthority, 'none');
  assert.match(MOBILE_REMOTE_SESSION_CONTRACT_V1.activation.productionImport, /forbidden/);
  assert.equal(Object.isFrozen(MOBILE_REMOTE_SESSION_CONTRACT_V1.threatModel[0]), true);
  assert.equal(
    await digestRemoteCoreValue(MOBILE_REMOTE_SESSION_CONTRACT_V1, webcrypto),
    MOBILE_REMOTE_SESSION_CONTRACT_DIGEST_V1,
  );
});

await test('pairing and session state machines reject implicit reactivation', () => {
  assert.equal(resolveRemoteSecurityTransitionV1('pairing', 'UNPAIRED', 'START_CLAIM'), 'CLAIM_PENDING');
  assert.equal(resolveRemoteSecurityTransitionV1('pairing', 'CLAIM_PENDING', 'CLAIM_CONFIRMED'), 'PAIRED');
  assert.equal(resolveRemoteSecurityTransitionV1('pairing', 'PAIRED', 'REVOKE'), 'REVOKED');
  assert.throws(
    () => resolveRemoteSecurityTransitionV1('pairing', 'REVOKED', 'CLAIM_CONFIRMED'),
    /forbidden/,
  );
  assert.equal(resolveRemoteSecurityTransitionV1('session', 'ACTIVE', 'BEGIN_REFRESH'), 'REFRESHING');
  assert.equal(resolveRemoteSecurityTransitionV1('session', 'REFRESHING', 'REFRESH_FAILED'), 'EXPIRED');
  assert.throws(
    () => resolveRemoteSecurityTransitionV1('session', 'REVOKED', 'OPEN_CONFIRMED'),
    /forbidden/,
  );
});

await test('pairing, challenge, open, refresh and revoke messages have exact fail-closed shapes', () => {
  assert.deepEqual(
    Object.keys(golden.controlMessages),
    Object.keys(MOBILE_REMOTE_SESSION_CONTRACT_V1.controlMessages),
  );
  for (const [schemaId, value] of Object.entries(golden.controlMessages)) {
    const validation = validateRemoteSessionControlMessageV1(schemaId, value, { nowMs });
    assert.deepEqual(validation.errors, [], schemaId);
    assert.equal(validation.valid, true, schemaId);
  }

  const weakSignature = structuredClone(golden.controlMessages['RemoteSessionOpenRequest@1']);
  weakSignature.deviceSignature = 'short';
  assert.equal(validateRemoteSessionControlMessageV1(
    'RemoteSessionOpenRequest@1', weakSignature, { nowMs },
  ).valid, false);

  const mixedError = structuredClone(golden.controlMessages['RemoteSessionOpenResult@1']);
  mixedError.status = 'error';
  mixedError.error = { code: 'REMOTE_SESSION_REJECTED', message: 'Synthetic.', retryable: false };
  assert.equal(validateRemoteSessionControlMessageV1(
    'RemoteSessionOpenResult@1', mixedError, { nowMs },
  ).valid, false);

  const unknown = structuredClone(golden.controlMessages['RemoteSessionRevokeRequest@1']);
  unknown.token = 'forbidden';
  assert.equal(validateRemoteSessionControlMessageV1(
    'RemoteSessionRevokeRequest@1', unknown, { nowMs },
  ).valid, false);
});

await test('control responses are bound to the exact request and trusted session lineage', () => {
  const messages = golden.controlMessages;
  const cases = [
    ['RemotePairingClaimRequest@1', null, null],
    ['RemoteSessionChallengeRequest@1', null, golden.negotiation],
    ['RemoteSessionOpenRequest@1', null, golden.negotiation],
    ['RemoteSessionRefreshRequest@1', golden.session, null],
    ['RemoteSessionRevokeRequest@1', golden.session, null],
  ];
  for (const [requestSchemaId, session, negotiation] of cases) {
    const resultSchemaId = MOBILE_REMOTE_SESSION_CONTRACT_V1
      .controlExchangeBindings[requestSchemaId].resultSchemaId;
    const validation = validateRemoteSessionControlExchangeV1({
      requestSchemaId,
      request: messages[requestSchemaId],
      result: messages[resultSchemaId],
      session,
      negotiation,
      nowMs,
    });
    assert.deepEqual(validation.errors, [], requestSchemaId);
    assert.equal(validation.valid, true, requestSchemaId);
  }

  const pairingError = structuredClone(messages['RemotePairingClaimResult@1']);
  pairingError.status = 'error';
  pairingError.error = {
    code: 'REMOTE_PAIRING_REJECTED', message: 'Synthetic rejection.', retryable: false,
  };
  for (const field of [
    'deviceId', 'deviceKeyId', 'pairedAt', 'pairingRevision', 'scopes', 'subjectId',
  ]) pairingError[field] = null;
  assert.equal(validateRemoteSessionControlExchangeV1({
    requestSchemaId: 'RemotePairingClaimRequest@1',
    request: messages['RemotePairingClaimRequest@1'],
    result: pairingError,
    nowMs,
  }).valid, true, 'typed error must bind requestId without inventing server identity');
  assert.match(validateRemoteSessionControlExchangeV1({
    requestSchemaId: 'RemotePairingClaimRequest@1',
    request: messages['RemotePairingClaimRequest@1'],
    result: messages['RemotePairingClaimResult@1'],
  }).errors.join(','), /invalid-nowMs/);

  const pairingSwap = structuredClone(messages['RemotePairingClaimResult@1']);
  pairingSwap.deviceKeyId = 'device-key:foreign:001';
  assert.match(validateRemoteSessionControlExchangeV1({
    requestSchemaId: 'RemotePairingClaimRequest@1',
    request: messages['RemotePairingClaimRequest@1'],
    result: pairingSwap,
    nowMs,
  }).errors.join(','), /deviceKeyId-mismatch/);

  const openSwap = structuredClone(messages['RemoteSessionOpenResult@1']);
  openSwap.deviceId = 'device:foreign';
  assert.match(validateRemoteSessionControlExchangeV1({
    requestSchemaId: 'RemoteSessionOpenRequest@1',
    request: messages['RemoteSessionOpenRequest@1'],
    result: openSwap,
    negotiation: golden.negotiation,
    nowMs,
  }).errors.join(','), /deviceId-mismatch/);

  const refreshSwap = structuredClone(messages['RemoteSessionRefreshResult@1']);
  refreshSwap.subjectId = 'subject:foreign';
  assert.match(validateRemoteSessionControlExchangeV1({
    requestSchemaId: 'RemoteSessionRefreshRequest@1',
    request: messages['RemoteSessionRefreshRequest@1'],
    result: refreshSwap,
    session: golden.session,
    nowMs,
  }).errors.join(','), /subjectId-mismatch/);

  const revokeSwap = structuredClone(messages['RemoteSessionRevokeResult@1']);
  revokeSwap.pairingRevision = 'pairing-revision:foreign';
  assert.match(validateRemoteSessionControlExchangeV1({
    requestSchemaId: 'RemoteSessionRevokeRequest@1',
    request: messages['RemoteSessionRevokeRequest@1'],
    result: revokeSwap,
    session: golden.session,
    nowMs,
  }).errors.join(','), /pairingRevision-mismatch/);

  const refreshChallenge = structuredClone(messages['RemoteSessionChallengeRequest@1']);
  refreshChallenge.requestId = 'request:session:challenge:refresh';
  refreshChallenge.purpose = 'REFRESH';
  refreshChallenge.sessionId = golden.session.sessionId;
  refreshChallenge.sessionRevision = golden.session.sessionRevision;
  refreshChallenge.clientNonce = 'challenge_nonce_000000000000099';
  const refreshChallengeResult = structuredClone(messages['RemoteSessionChallengeResult@1']);
  refreshChallengeResult.requestId = refreshChallenge.requestId;
  refreshChallengeResult.purpose = 'REFRESH';
  refreshChallengeResult.sessionId = refreshChallenge.sessionId;
  refreshChallengeResult.sessionRevision = refreshChallenge.sessionRevision;
  assert.equal(validateRemoteSessionControlExchangeV1({
    requestSchemaId: 'RemoteSessionChallengeRequest@1',
    request: refreshChallenge,
    result: refreshChallengeResult,
    session: golden.session,
    negotiation: golden.negotiation,
    nowMs,
  }).valid, true);
  refreshChallengeResult.sessionRevision = 'session-revision:foreign';
  assert.match(validateRemoteSessionControlExchangeV1({
    requestSchemaId: 'RemoteSessionChallengeRequest@1',
    request: refreshChallenge,
    result: refreshChallengeResult,
    session: golden.session,
    negotiation: golden.negotiation,
    nowMs,
  }).errors.join(','), /sessionRevision-mismatch/);
});

await test('session negotiation binds exact hello, version, descriptor, adapter and server identity', async () => {
  assert.equal((await validateRemoteSessionNegotiationV1(
    golden.hello,
    golden.negotiation,
    webcrypto,
  )).valid, true);
  const downgrade = structuredClone(golden.negotiation);
  downgrade.selectedSessionVersion = 0;
  assert.equal((await validateRemoteSessionNegotiationV1(golden.hello, downgrade, webcrypto)).valid, false);
  const spoof = structuredClone(golden.negotiation);
  spoof.serverOrigin = 'http://companion.fixture.invalid';
  assert.equal((await validateRemoteSessionNegotiationV1(golden.hello, spoof, webcrypto)).valid, false);
});

await test('valid protected invocation is scope, identity, counter, time and payload bound', async () => {
  const validation = await validateRemoteInvocationEnvelopeV1({
    envelope: golden.invocation,
    session: golden.session,
    previousCounter,
    nowMs,
    cryptoApi: webcrypto,
  });
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.valid, true);
  assert.equal(validation.operation.operation.operationId, 'project.list');
});

await test('invocation proof bytes bind every envelope field except the signature itself', () => {
  const original = Buffer.from(createRemoteInvocationProofBytesV1(golden.invocation));
  const signatureOnly = structuredClone(golden.invocation);
  signatureOnly.deviceSignature = 'C'.repeat(86);
  assert.equal(original.equals(Buffer.from(createRemoteInvocationProofBytesV1(signatureOnly))), true);
  const payloadChanged = structuredClone(golden.invocation);
  payloadChanged.payload.limit = 24;
  assert.equal(original.equals(Buffer.from(createRemoteInvocationProofBytesV1(payloadChanged))), false);
  const counterChanged = structuredClone(golden.invocation);
  counterChanged.clientCounter += 1;
  assert.equal(original.equals(Buffer.from(createRemoteInvocationProofBytesV1(counterChanged))), false);
});

await test('replay, expiry and scope loss fail before provider authority', async () => {
  const weakProof = structuredClone(golden.invocation);
  weakProof.deviceSignature = 'short';
  assert.match((await validateRemoteInvocationEnvelopeV1({
    envelope: weakProof,
    session: golden.session,
    previousCounter,
    nowMs,
    cryptoApi: webcrypto,
  })).errors.join(','), /invalid-deviceSignature/);

  const replay = await validateRemoteInvocationEnvelopeV1({
    envelope: golden.invocation,
    session: golden.session,
    previousCounter: golden.invocation.clientCounter,
    nowMs,
    cryptoApi: webcrypto,
  });
  assert.match(replay.errors.join(','), /counter-replay/);

  const expired = structuredClone(golden.session);
  expired.expiresAt = '2026-08-27T12:00:09.000Z';
  const expiryValidation = await validateRemoteInvocationEnvelopeV1({
    envelope: golden.invocation,
    session: expired,
    previousCounter,
    nowMs,
    cryptoApi: webcrypto,
  });
  assert.match(expiryValidation.errors.join(','), /session-expired/);

  const noScope = structuredClone(golden.session);
  noScope.scopes = [];
  const scopeValidation = await validateRemoteInvocationEnvelopeV1({
    envelope: golden.invocation,
    session: noScope,
    previousCounter,
    nowMs,
    cryptoApi: webcrypto,
  });
  assert.match(scopeValidation.errors.join(','), /missing-scope-read:projects/);
});

await test('negative invocation fixtures reject substitution, downgrade, tamper and legacy route injection', async () => {
  const negatives = createRemoteSessionNegativeFixturesV1(golden)
    .filter(fixture => fixture.target === 'invocation');
  assert.equal(negatives.length >= 6, true);
  for (const fixture of negatives) {
    const validation = await validateRemoteInvocationEnvelopeV1({
      envelope: fixture.value,
      session: golden.session,
      previousCounter,
      nowMs,
      cryptoApi: webcrypto,
    });
    assert.equal(validation.valid, false, fixture.id);
    assert.equal(validation.errors.length > 0, true, fixture.id);
  }
});

await test('response remains bound to request, session counter and canonical provider payload', async () => {
  const valid = await validateRemoteResponseEnvelopeV1({
    requestEnvelope: golden.invocation,
    responseEnvelope: golden.response,
    session: golden.session,
    nowMs,
    cryptoApi: webcrypto,
  });
  assert.deepEqual(valid.errors, []);
  for (const fixture of createRemoteSessionNegativeFixturesV1(golden)
    .filter(item => item.target === 'response')) {
    const validation = await validateRemoteResponseEnvelopeV1({
      requestEnvelope: golden.invocation,
      responseEnvelope: fixture.value,
      session: golden.session,
      nowMs,
      cryptoApi: webcrypto,
    });
    assert.equal(validation.valid, false, fixture.id);
  }
});

await test('cursor is bound to device, subject, session, query, operation, snapshot and limit', () => {
  assert.equal(validateRemoteCursorBindingV1({
    binding: golden.cursor,
    session: golden.session,
    invocation: golden.invocation,
    queryDigest: golden.queryDigest,
    nowMs,
  }).valid, true);
  for (const fixture of createRemoteSessionNegativeFixturesV1(golden)
    .filter(item => item.target === 'cursor')) {
    assert.equal(validateRemoteCursorBindingV1({
      binding: fixture.value,
      session: golden.session,
      invocation: golden.invocation,
      queryDigest: golden.queryDigest,
      nowMs,
    }).valid, false, fixture.id);
  }
});

await test('threat model and limits cover all release-mandated remote abuse classes', () => {
  const threats = new Set(MOBILE_REMOTE_SESSION_CONTRACT_V1.threatModel.map(item => item.threat));
  for (const threat of [
    'credential_replay', 'subject_substitution', 'device_cloning',
    'protocol_downgrade', 'cursor_rebinding', 'cross_device_operation_access',
    'legacy_route_bypass', 'server_impersonation', 'resource_exhaustion',
  ]) assert.equal(threats.has(threat), true, threat);
  assert.deepEqual(
    MOBILE_REMOTE_SESSION_CONTRACT_V1.listenerBoundary.forbiddenPathPrefixes,
    ['/api/', '/c3/ws', '/m1/'],
  );
  assert.equal(MOBILE_REMOTE_SESSION_CONTRACT_V1.resourceLimits.pageItemsMaximum, 100);
  assert.equal(MOBILE_REMOTE_SESSION_CONTRACT_V1.resourceLimits.inFlightPerSessionMaximum, 1);
  assert.equal(MOBILE_REMOTE_SESSION_CONTRACT_V1.resourceLimits.longPollMillisecondsMaximum, 30_000);
});

await test('production client does not import the candidate session contract', () => {
  const runtime = readFileSync(
    new URL('../src/mobile/client/remote-core-v1.js', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(runtime, /remote-session-contract-v1/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
