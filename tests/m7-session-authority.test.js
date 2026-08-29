#!/usr/bin/env node

import './helpers/isolated-test-db.js';

import { strict as assert } from 'node:assert';
import {
  createHash,
  generateKeyPairSync,
  sign,
} from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import {
  computeM7RemoteSessionAuthorityFingerprintV105,
  EXPECTED_M7_REMOTE_SESSION_AUTHORITY_FINGERPRINT_V105,
  up as installSessionAuthority,
} from '../src/db/migrations/2026_08_29_105_m7_remote_session_authority.js';
import {
  M7_SESSION_AUTHORITY_ERROR,
  M7_SESSION_AUTHORITY_STAGE,
  createM7SessionAuthority,
} from '../src/remote/m7-session-authority.js';
import {
  createM7RemoteDeviceProofBytes,
  digestM7SessionValue,
  M7_REMOTE_SCOPE_IDS,
} from '../src/remote/m7-session-authority-validation.js';
import {
  createRemoteDeviceProofBytesV1,
  validateRemoteSessionControlExchangeV1,
  validateRemoteSessionControlMessageV1,
} from '../docs/mobile/contracts/remote-session-contract-v1.js';
import {
  MOBILE_REMOTE_CANDIDATE_ADAPTER_MANIFEST_DIGEST_V1,
} from '../docs/mobile/contracts/remote-capability-manifests-v1.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ❌ ${name}: ${error.stack || error.message}`);
  }
}

function deterministicRandom(seed) {
  let counter = 0;
  return length => {
    const output = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const block = createHash('sha256').update(`${seed}:${counter}`).digest();
      counter += 1;
      block.copy(output, offset, 0, Math.min(block.length, length - offset));
      offset += Math.min(block.length, length - offset);
    }
    return output;
  };
}

function keyFixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const rawPublicKey = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return {
    privateKey,
    publicKey: rawPublicKey.toString('base64url'),
  };
}

function signedRequest(schemaId, request, privateKey) {
  const unsigned = { ...request, deviceSignature: '' };
  const internal = createM7RemoteDeviceProofBytes(schemaId, unsigned);
  const candidate = Buffer.from(createRemoteDeviceProofBytesV1(schemaId, unsigned));
  assert.equal(internal.equals(candidate), true, `${schemaId} signing bytes drifted`);
  return {
    ...unsigned,
    deviceSignature: sign(null, internal, privateKey).toString('base64url'),
  };
}

function expectCode(fn, code) {
  assert.throws(fn, error => error?.code === code, code);
}

function setup({ file = ':memory:', seed = 'session-authority' } = {}) {
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  installSessionAuthority(db);
  let nowMs = Date.parse('2026-08-29T18:00:00.000Z');
  const config = {
    adapterManifestDigest: MOBILE_REMOTE_CANDIDATE_ADAPTER_MANIFEST_DIGEST_V1,
    authorizeOperator: () => ({
      decision: 'allow',
      actorType: 'user',
      actorId: 'operator:fixture',
    }),
    challengeTtlMs: 30_000,
    claimTtlMs: 120_000,
    clock: () => nowMs,
    pairingEnabled: true,
    randomBytes: deterministicRandom(seed),
    resolveInvocationScopes: ({ operationId }) => {
      if (operationId === 'project.list') return ['read:projects'];
      if (operationId === 'settings.update') return ['write:settings'];
      throw new TypeError('unknown fixture operation');
    },
    serverIdentityPin: `sha256:${'c'.repeat(64)}`,
    serverOrigin: 'https://remote.fixture.invalid',
    sessionTtlMs: 300_000,
  };
  return {
    authority: createM7SessionAuthority(db, config),
    config,
    db,
    now: () => nowMs,
    tick: milliseconds => { nowMs += milliseconds; },
  };
}

function pairDevice(fixture, keys = keyFixture(), scopes = ['read:projects', 'write:chat']) {
  const claim = fixture.authority.issuePairingClaim({
    subjectId: 'subject:fixture',
    scopes,
  });
  const request = {
    contract: 'RemotePairingClaimRequest',
    version: 1,
    requestId: 'request:pairing:001',
    claimCode: claim.claimCode,
    clientInstanceId: 'client:fixture:001',
    clientBuild: 'android-fixture-1',
    deviceKeyId: 'device-key:fixture:001',
    devicePublicKey: keys.publicKey,
    clientNonce: 'pairing_nonce_0000000000000001',
    sentAt: new Date(fixture.now()).toISOString(),
  };
  const result = fixture.authority.claimPairing(request);
  return { claim, keys, request, result };
}

function openSession(fixture, pairing) {
  const challenge = fixture.authority.issueChallenge({
    deviceId: pairing.result.deviceId,
    purpose: 'OPEN',
  });
  const request = signedRequest('RemoteSessionOpenRequest@1', {
    contract: 'RemoteSessionOpenRequest',
    version: 1,
    requestId: 'request:session:open:001',
    clientInstanceId: pairing.request.clientInstanceId,
    clientBuild: pairing.request.clientBuild,
    deviceId: pairing.result.deviceId,
    pairingRevision: pairing.result.pairingRevision,
    deviceKeyId: pairing.request.deviceKeyId,
    serverNonce: challenge.serverNonce,
    sentAt: new Date(fixture.now()).toISOString(),
  }, pairing.keys.privateKey);
  return {
    challenge,
    request,
    result: fixture.authority.openSession(request),
  };
}

function signedInvocation(fixture, opened, pairing, overrides = {}) {
  const payload = overrides.payload || {
    contract: 'ProjectListQuery',
    version: 1,
    requestId: overrides.requestId || 'request:invocation:001',
    limit: 25,
  };
  return signedRequest('RemoteInvocationEnvelope@1', {
    contract: 'RemoteInvocationEnvelope',
    version: 1,
    requestId: payload.requestId,
    sessionId: opened.sessionId,
    deviceId: opened.deviceId,
    subjectId: opened.subjectId,
    sessionRevision: opened.sessionRevision,
    clientCounter: 1,
    nonce: 'invocation_nonce_00000000000001',
    sentAt: new Date(fixture.now()).toISOString(),
    capabilityId: 'projects',
    capabilityVersion: 2,
    operationId: 'project.list',
    payload,
    payloadDigest: digestM7SessionValue(payload),
    ...overrides,
  }, pairing.keys.privateKey);
}

console.log('\n═══ M7 durable session/pairing authority ═══════════════════════');

await test('migration is exact and the authority remains explicitly inactive', () => {
  const fixture = setup();
  assert.equal(M7_SESSION_AUTHORITY_STAGE, 'IMPLEMENTED_NOT_ACTIVE');
  assert.equal(
    computeM7RemoteSessionAuthorityFingerprintV105(fixture.db),
    EXPECTED_M7_REMOTE_SESSION_AUTHORITY_FINGERPRINT_V105,
  );
  assert.deepEqual(M7_REMOTE_SCOPE_IDS, [...M7_REMOTE_SCOPE_IDS].sort());
  fixture.db.close();
});

await test('opaque user authority issues one strong claim without persisting its code', () => {
  const fixture = setup();
  const claim = fixture.authority.issuePairingClaim({
    subjectId: 'subject:fixture',
    scopes: ['write:chat', 'read:projects'],
  });
  assert.match(claim.claimCode, /^[A-Za-z0-9_-]{22}$/u);
  const row = fixture.db.prepare(`
    SELECT claim_digest AS digest, CAST(scopes_json AS TEXT) AS scopes
    FROM m7_remote_pairing_claims
  `).get();
  assert.notEqual(row.digest, claim.claimCode);
  assert.equal(JSON.stringify(row).includes(claim.claimCode), false);
  assert.deepEqual(JSON.parse(row.scopes), ['read:projects', 'write:chat']);
  expectCode(
    () => fixture.authority.issuePairingClaim({
      subjectId: 'subject:fixture', scopes: ['admin'],
    }),
    M7_SESSION_AUTHORITY_ERROR.INPUT_INVALID,
  );
  fixture.db.close();
});

await test('pairing is single-use across repository instances and preserves exact public key bytes', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'm7-session-race-'));
  const file = path.join(directory, 'authority.db');
  const first = setup({ file, seed: 'first' });
  const claim = first.authority.issuePairingClaim({
    subjectId: 'subject:fixture', scopes: ['read:projects'],
  });
  const secondDb = new Database(file);
  secondDb.pragma('foreign_keys = ON');
  const second = createM7SessionAuthority(secondDb, {
    ...first.config,
    randomBytes: deterministicRandom('second'),
  });
  const keys = keyFixture();
  const request = {
    contract: 'RemotePairingClaimRequest', version: 1,
    requestId: 'request:pairing:race:001', claimCode: claim.claimCode,
    clientInstanceId: 'client:race:001', clientBuild: 'android-fixture-1',
    deviceKeyId: 'device-key:fixture:race', devicePublicKey: keys.publicKey,
    clientNonce: 'pairing_nonce_0000000000000002',
    sentAt: new Date(first.now()).toISOString(),
  };
  const winner = first.authority.claimPairing(request);
  assert.equal(winner.status, 'paired');
  expectCode(() => second.claimPairing(request), M7_SESSION_AUTHORITY_ERROR.PAIRING_USED);
  const stored = first.db.prepare(`
    SELECT device_public_key AS publicKey FROM m7_remote_pairings
  `).get().publicKey;
  assert.equal(Buffer.from(stored).equals(Buffer.from(keys.publicKey, 'base64url')), true);
  secondDb.close();
  first.db.close();
  rmSync(directory, { recursive: true, force: true });
});

await test('tampered Ed25519 open proof fails without consuming its challenge', () => {
  const fixture = setup();
  const pairing = pairDevice(fixture);
  const challenge = fixture.authority.issueChallenge({
    deviceId: pairing.result.deviceId,
    purpose: 'OPEN',
  });
  const valid = signedRequest('RemoteSessionOpenRequest@1', {
    contract: 'RemoteSessionOpenRequest', version: 1,
    requestId: 'request:session:open:proof',
    clientInstanceId: pairing.request.clientInstanceId,
    clientBuild: pairing.request.clientBuild,
    deviceId: pairing.result.deviceId,
    pairingRevision: pairing.result.pairingRevision,
    deviceKeyId: pairing.request.deviceKeyId,
    serverNonce: challenge.serverNonce,
    sentAt: new Date(fixture.now()).toISOString(),
  }, pairing.keys.privateKey);
  expectCode(
    () => fixture.authority.openSession({ ...valid, clientBuild: 'tampered-build' }),
    M7_SESSION_AUTHORITY_ERROR.PROOF_INVALID,
  );
  const denial = fixture.db.prepare(`
    SELECT action, outcome, CAST(record_json AS TEXT) AS recordJson
    FROM m7_remote_session_audit_events
    WHERE outcome = 'DENIED'
  `).get();
  assert.equal(denial.action, 'SESSION_OPEN_ATTEMPT');
  assert.equal(denial.outcome, 'DENIED');
  assert.equal(JSON.parse(denial.recordJson).reasonCode, M7_SESSION_AUTHORITY_ERROR.PROOF_INVALID);
  assert.equal(denial.recordJson.includes(valid.deviceSignature), false);
  assert.equal(denial.recordJson.includes(challenge.serverNonce), false);
  const opened = fixture.authority.openSession(valid);
  assert.equal(opened.status, 'active');
  expectCode(
    () => fixture.authority.openSession(valid),
    M7_SESSION_AUTHORITY_ERROR.CHALLENGE_INVALID,
  );
  fixture.db.close();
});

await test('open, invocation, restart and refresh enforce identity, scope, counter and nonce', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'm7-session-restart-'));
  const file = path.join(directory, 'authority.db');
  const fixture = setup({ file, seed: 'restart' });
  const pairing = pairDevice(fixture);
  const opened = openSession(fixture, pairing);
  const negotiation = {
    status: 'negotiated',
    serverOrigin: fixture.config.serverOrigin,
    serverIdentityPin: fixture.config.serverIdentityPin,
    adapterManifestDigest: fixture.config.adapterManifestDigest,
  };
  assert.equal(validateRemoteSessionControlExchangeV1({
    requestSchemaId: 'RemoteSessionOpenRequest@1',
    request: opened.request,
    result: opened.result,
    negotiation,
    nowMs: fixture.now(),
  }).valid, true);
  const invocation = signedInvocation(fixture, opened.result, pairing);
  assert.deepEqual(fixture.authority.authorizeInvocation(invocation), {
    decision: 'allow',
    deviceId: opened.result.deviceId,
    subjectId: opened.result.subjectId,
    grantedScopes: ['read:projects'],
  });
  fixture.db.close();
  const restartedDb = new Database(file);
  restartedDb.pragma('foreign_keys = ON');
  const restarted = createM7SessionAuthority(restartedDb, {
    ...fixture.config,
    randomBytes: deterministicRandom('restart-second'),
  });
  expectCode(() => restarted.authorizeInvocation(invocation), M7_SESSION_AUTHORITY_ERROR.REPLAY);
  expectCode(
    () => restarted.authorizeInvocation({
      ...invocation,
      clientCounter: 2,
      nonce: 'invocation_nonce_00000000000002',
      operationId: 'settings.update',
    }),
    M7_SESSION_AUTHORITY_ERROR.PROOF_INVALID,
  );
  expectCode(
    () => restarted.authorizeInvocation(signedInvocation(fixture, opened.result, pairing, {
      capabilityId: 'settings',
      clientCounter: 2,
      nonce: 'invocation_nonce_00000000000012',
      operationId: 'settings.update',
      requestId: 'request:invocation:scope-denied',
    })),
    M7_SESSION_AUTHORITY_ERROR.SCOPE_DENIED,
  );
  const challenge = restarted.issueChallenge({
    deviceId: opened.result.deviceId,
    purpose: 'REFRESH',
    sessionId: opened.result.sessionId,
    sessionRevision: opened.result.sessionRevision,
  });
  const refresh = signedRequest('RemoteSessionRefreshRequest@1', {
    contract: 'RemoteSessionRefreshRequest', version: 1,
    requestId: 'request:session:refresh:001',
    sessionId: opened.result.sessionId, deviceId: opened.result.deviceId,
    subjectId: opened.result.subjectId, sessionRevision: opened.result.sessionRevision,
    clientCounter: 2, clientNonce: 'refresh_nonce_0000000000000001',
    serverNonce: challenge.serverNonce, sentAt: new Date(fixture.now()).toISOString(),
  }, pairing.keys.privateKey);
  const refreshed = restarted.refreshSession(refresh);
  assert.equal(refreshed.sessionId, opened.result.sessionId);
  assert.notEqual(refreshed.sessionRevision, opened.result.sessionRevision);
  expectCode(
    () => restarted.authorizeInvocation(signedInvocation(fixture, opened.result, pairing, {
      clientCounter: 3,
      nonce: 'invocation_nonce_00000000000003',
      requestId: 'request:invocation:old-revision',
    })),
    M7_SESSION_AUTHORITY_ERROR.SESSION_INVALID,
  );
  restartedDb.close();
  rmSync(directory, { recursive: true, force: true });
});

await test('invocation proof rejects stolen identifiers and payload tamper before replay state changes', () => {
  const fixture = setup({ seed: 'invocation-proof' });
  const pairing = pairDevice(fixture);
  const opened = openSession(fixture, pairing);
  const valid = signedInvocation(fixture, opened.result, pairing, {
    requestId: 'request:invocation:proof',
    payload: {
      contract: 'ProjectListQuery', version: 1,
      requestId: 'request:invocation:proof', limit: 25,
      privateMarker: 'must-not-enter-audit',
    },
  });
  const tampered = structuredClone(valid);
  tampered.payload.privateMarker = 'attacker-controlled';
  tampered.payloadDigest = digestM7SessionValue(tampered.payload);
  expectCode(
    () => fixture.authority.authorizeInvocation(tampered),
    M7_SESSION_AUTHORITY_ERROR.PROOF_INVALID,
  );
  const forged = { ...valid, deviceSignature: 'A'.repeat(86) };
  expectCode(
    () => fixture.authority.authorizeInvocation(forged),
    M7_SESSION_AUTHORITY_ERROR.PROOF_INVALID,
  );
  const state = fixture.db.prepare(`
    SELECT last_client_counter AS lastClientCounter
    FROM m7_remote_sessions WHERE session_revision = ?
  `).get(opened.result.sessionRevision);
  assert.equal(state.lastClientCounter, 0);
  assert.equal(fixture.db.prepare(`SELECT count(*) AS count FROM m7_remote_invocation_nonces`).get().count, 0);
  const denied = fixture.db.prepare(`
    SELECT CAST(record_json AS TEXT) AS recordJson
    FROM m7_remote_session_audit_events
    WHERE action = 'INVOCATION_AUTHORIZATION_ATTEMPT' AND outcome = 'DENIED'
  `).all();
  assert.equal(denied.length, 2);
  assert.equal(denied.every(row => !row.recordJson.includes('privateMarker')), true);
  assert.equal(denied.every(row => !row.recordJson.includes(valid.deviceSignature)), true);
  assert.equal(fixture.authority.authorizeInvocation(valid).decision, 'allow');
  fixture.db.close();
});

await test('expired challenge and session fail closed', () => {
  const fixture = setup();
  const pairing = pairDevice(fixture);
  const challenge = fixture.authority.issueChallenge({
    deviceId: pairing.result.deviceId,
    purpose: 'OPEN',
  });
  const request = signedRequest('RemoteSessionOpenRequest@1', {
    contract: 'RemoteSessionOpenRequest', version: 1,
    requestId: 'request:session:open:expired',
    clientInstanceId: pairing.request.clientInstanceId,
    clientBuild: pairing.request.clientBuild,
    deviceId: pairing.result.deviceId,
    pairingRevision: pairing.result.pairingRevision,
    deviceKeyId: pairing.request.deviceKeyId,
    serverNonce: challenge.serverNonce,
    sentAt: new Date(fixture.now()).toISOString(),
  }, pairing.keys.privateKey);
  fixture.tick(30_001);
  request.sentAt = new Date(fixture.now()).toISOString();
  const resigned = signedRequest('RemoteSessionOpenRequest@1', request, pairing.keys.privateKey);
  expectCode(() => fixture.authority.openSession(resigned), M7_SESSION_AUTHORITY_ERROR.CHALLENGE_INVALID);
  const fresh = fixture.authority.issueChallenge({
    deviceId: pairing.result.deviceId,
    purpose: 'OPEN',
  });
  const opened = fixture.authority.openSession(signedRequest('RemoteSessionOpenRequest@1', {
    ...request,
    requestId: 'request:session:open:expires-session',
    serverNonce: fresh.serverNonce,
    sentAt: new Date(fixture.now()).toISOString(),
  }, pairing.keys.privateKey));
  fixture.tick(300_001);
  expectCode(
    () => fixture.authority.authorizeInvocation(signedInvocation(fixture, opened, pairing, {
      nonce: 'invocation_nonce_00000000000005',
      sentAt: new Date(fixture.now()).toISOString(),
      requestId: 'request:invocation:expired',
    })),
    M7_SESSION_AUTHORITY_ERROR.SESSION_EXPIRED,
  );
  fixture.db.close();
});

await test('session and device revocation are terminal and audited', () => {
  const fixture = setup();
  const pairing = pairDevice(fixture);
  const opened = openSession(fixture, pairing);
  const revoke = signedRequest('RemoteSessionRevokeRequest@1', {
    contract: 'RemoteSessionRevokeRequest', version: 1,
    requestId: 'request:session:revoke:001', sessionId: opened.result.sessionId,
    deviceId: opened.result.deviceId, subjectId: opened.result.subjectId,
    sessionRevision: opened.result.sessionRevision, clientCounter: 1,
    clientNonce: 'revoke_nonce_00000000000000001', reason: 'logout',
    sentAt: new Date(fixture.now()).toISOString(),
  }, pairing.keys.privateKey);
  const revoked = fixture.authority.revokeSession(revoke);
  assert.equal(validateRemoteSessionControlMessageV1(
    'RemoteSessionRevokeResult@1', revoked, { nowMs: fixture.now() },
  ).valid, true);
  expectCode(
    () => fixture.authority.authorizeInvocation(signedInvocation(fixture, {
      ...opened.result,
      sessionRevision: revoked.sessionRevision,
    }, pairing, {
      clientCounter: 2,
      nonce: 'invocation_nonce_00000000000004',
      requestId: 'request:invocation:revoked',
    })),
    M7_SESSION_AUTHORITY_ERROR.SESSION_REVOKED,
  );
  const pairingRevoked = fixture.authority.revokePairing({ deviceId: pairing.result.deviceId });
  assert.equal(pairingRevoked.deviceId, pairing.result.deviceId);
  expectCode(
    () => fixture.authority.issueChallenge({
      deviceId: pairing.result.deviceId, purpose: 'OPEN',
    }),
    M7_SESSION_AUTHORITY_ERROR.PAIRING_REVOKED,
  );
  const actions = fixture.db.prepare(`
    SELECT action FROM m7_remote_session_audit_events ORDER BY audit_revision
  `).all().map(row => row.action);
  for (const action of [
    'PAIRING_CLAIM_ISSUED', 'PAIRING_CLAIMED', 'SESSION_CHALLENGE_ISSUED',
    'SESSION_OPENED', 'SESSION_REVOKED', 'PAIRING_REVOKED',
  ]) assert.equal(actions.includes(action), true, action);
  fixture.db.close();
});

await test('state and audit tables reject mutation, deletion and mismatched evidence', () => {
  const fixture = setup();
  const pairing = pairDevice(fixture);
  assert.throws(() => fixture.db.prepare(`
    UPDATE m7_remote_pairings SET device_id = 'device:tampered'
  `).run(), /authority violation/u);
  assert.throws(() => fixture.db.prepare(`
    DELETE FROM m7_remote_session_audit_events
  `).run(), /append-only/u);
  const row = fixture.db.prepare(`
    SELECT * FROM m7_remote_session_audit_events ORDER BY audit_revision LIMIT 1
  `).get();
  assert.throws(() => fixture.db.prepare(`
    INSERT INTO m7_remote_session_audit_events (
      action, device_id, subject_id, session_id, outcome, recorded_at_ms, record_json
    ) VALUES ('TAMPERED', ?, ?, ?, ?, ?, ?)
  `).run(
    row.device_id, row.subject_id, row.session_id, row.outcome, row.recorded_at_ms,
    row.record_json,
  ), /EXACT_MISMATCH/u);
  assert.equal(pairing.result.status, 'paired');
  fixture.db.close();
});

await test('fail-closed defaults cannot mint or revoke pairing authority', () => {
  const db = new Database(':memory:');
  installSessionAuthority(db);
  const base = {
    adapterManifestDigest: MOBILE_REMOTE_CANDIDATE_ADAPTER_MANIFEST_DIGEST_V1,
    clock: () => Date.parse('2026-08-29T18:00:00.000Z'),
    randomBytes: deterministicRandom('closed'),
    serverIdentityPin: `sha256:${'c'.repeat(64)}`,
    serverOrigin: 'https://remote.fixture.invalid',
  };
  const closed = createM7SessionAuthority(db, base);
  expectCode(
    () => closed.issuePairingClaim({
      subjectId: 'subject:fixture', scopes: ['read:projects'],
    }),
    M7_SESSION_AUTHORITY_ERROR.AUTHORITY_DENIED,
  );
  const denied = createM7SessionAuthority(db, {
    ...base,
    authorizeOperator: () => ({ decision: 'deny', actorType: 'user', actorId: 'operator:fixture' }),
    pairingEnabled: true,
  });
  expectCode(
    () => denied.issuePairingClaim({
      subjectId: 'subject:fixture', scopes: ['read:projects'],
    }),
    M7_SESSION_AUTHORITY_ERROR.AUTHORITY_DENIED,
  );
  const deniedRows = db.prepare(`
    SELECT CAST(record_json AS TEXT) AS recordJson
    FROM m7_remote_session_audit_events
    WHERE action = 'PAIRING_CLAIM_ISSUE_ATTEMPT' AND outcome = 'DENIED'
    ORDER BY audit_revision
  `).all();
  assert.equal(deniedRows.length, 2);
  assert.equal(deniedRows.every(row => (
    JSON.parse(row.recordJson).reasonCode === M7_SESSION_AUTHORITY_ERROR.AUTHORITY_DENIED
  )), true);
  db.close();
});

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════════════════════\n');
if (failed > 0) process.exit(1);
