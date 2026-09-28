#!/usr/bin/env node

import './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import {
  MOBILE_REMOTE_CANDIDATE_ADAPTER_MANIFEST_DIGEST_V1,
} from '../docs/mobile/contracts/remote-capability-manifests-v1.js';
import { validateMobileRemotePayload } from '../docs/mobile/contracts/remote-capability-payloads-v1.js';
import {
  validateRemoteResponseEnvelopeV1,
} from '../docs/mobile/contracts/remote-session-contract-v1.js';
import { up as installJournal } from '../src/db/migrations/2026_08_29_101_m7_remote_operation_journal.js';
import { up as installInformation } from '../src/db/migrations/2026_08_29_102_m7_manual_information.js';
import { up as installAbandonments } from '../src/db/migrations/2026_08_29_103_m7_operation_abandonments.js';
import { up as installSessions } from '../src/db/migrations/2026_08_29_105_m7_remote_session_authority.js';
import { up as installRateLimits } from '../src/db/migrations/2026_08_30_108_m7_durable_rate_limits.js';
import {
  M7_DISCONNECTED_REQUEST_PIPELINE_ERROR,
  M7_DISCONNECTED_REQUEST_PIPELINE_STAGE,
  createM7DisconnectedRequestPipeline,
  isGenuineM7DisconnectedRequestPipeline,
} from '../src/remote/m7-disconnected-request-pipeline.js';
import { createM7DurableRateLimiter } from '../src/remote/m7-durable-rate-limiter.js';
import { createM7SessionAuthority } from '../src/remote/m7-session-authority.js';
import {
  canonicalizeM7SessionValue,
  createM7RemoteDeviceProofBytes,
  digestM7SessionValue,
} from '../src/remote/m7-session-authority-validation.js';
import { createM7TransportAdmissionPolicy } from '../src/remote/m7-transport-admission-policy.js';
import { suite, summary, test, testAsync } from './harness.js';

const SERVER_ORIGIN = 'https://intentsmith.home.arpa:7443';
const SERVER_PIN = `sha256:${'a'.repeat(64)}`;
const PEER_KEY = Buffer.from('71'.repeat(32), 'hex');
const CURSOR_KEY = Buffer.from('72'.repeat(32), 'hex');

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
  return {
    privateKey,
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url'),
  };
}

function signRequest(schemaId, value, privateKey) {
  const unsigned = { ...value, deviceSignature: '' };
  return {
    ...unsigned,
    deviceSignature: sign(
      null,
      createM7RemoteDeviceProofBytes(schemaId, unsigned),
      privateKey,
    ).toString('base64url'),
  };
}

function bodyBytes(value) {
  return Buffer.from(canonicalizeM7SessionValue(value), 'utf8');
}

function transport(pathname, bytes, {
  method = 'POST',
  remoteAddress = '192.168.50.22',
  requestId = 'request:health:pipeline',
} = {}) {
  const rawHeaders = method === 'GET'
    ? [
      'Host', 'intentsmith.home.arpa:7443',
      'X-IntentSmith-Request-Id', requestId,
    ]
    : [
      'Host', 'intentsmith.home.arpa:7443',
      'Content-Type', 'application/json',
      'Content-Length', String(bytes.length),
    ];
  return {
    httpVersion: '1.1',
    method,
    rawHeaders,
    remoteAddress,
    socketEncrypted: true,
    target: pathname,
    tlsVersion: 'TLSv1.3',
  };
}

function expectCode(fn, code) {
  assert.throws(fn, error => error?.code === code, code);
}

async function expectCodeAsync(fn, code) {
  await assert.rejects(fn, error => error?.code === code, code);
}

function setup({ executeConversation = null, seed = 'pipeline' } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'intentsmith-m7-pipeline-'));
  const projectRoot = path.join(root, 'project');
  mkdirSync(projectRoot);
  writeFileSync(path.join(projectRoot, 'authority.js'), 'export const authority = true;\n', 'utf8');
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  database.exec(`
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL,
      status TEXT NOT NULL, last_active TEXT NOT NULL
    );
    CREATE TABLE project_lifecycles (
      id TEXT PRIMARY KEY, project_id INTEGER NOT NULL, phase TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY, project_id INTEGER, title TEXT,
      message_count INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      archived_at TEXT, deleted_at TEXT
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL, content TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
    );
    CREATE TRIGGER messages_count_ai AFTER INSERT ON messages BEGIN
      UPDATE conversations SET message_count = message_count + 1
      WHERE id = new.conversation_id;
    END;
    CREATE TABLE user_settings (
      id INTEGER PRIMARY KEY, data TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  database.prepare(`
    INSERT INTO projects (id, name, path, status, last_active)
    VALUES (1, 'Pipeline project', ?, 'active', '2026-08-30 00:00:00')
  `).run(projectRoot);
  database.prepare(`
    INSERT INTO conversations (
      id, project_id, title, state, created_at, updated_at, archived_at, deleted_at
    ) VALUES (
      'conversation:pipeline', 1, 'Pipeline conversation', 'active',
      '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z', NULL, NULL
    )
  `).run();
  installJournal(database);
  installInformation(database);
  installAbandonments(database);
  installSessions(database);
  installRateLimits(database);

  let nowMs = Date.parse('2026-08-30T00:00:01.000Z');
  let projectAuthorityCalls = 0;
  let conversationCalls = 0;
  const keys = keyFixture();
  const authority = createM7SessionAuthority(database, {
    adapterManifestDigest: MOBILE_REMOTE_CANDIDATE_ADAPTER_MANIFEST_DIGEST_V1,
    authorizeOperator: () => ({
      decision: 'allow', actorType: 'user', actorId: 'operator:pipeline',
    }),
    challengeTtlMs: 30_000,
    claimTtlMs: 120_000,
    clock: () => nowMs,
    pairingEnabled: true,
    randomBytes: deterministicRandom(seed),
    resolveInvocationScopes: ({ capabilityId, capabilityVersion, operationId }) => {
      if (capabilityId === 'projects' && capabilityVersion === 2 && operationId === 'project.list') {
        return ['read:projects'];
      }
      if (capabilityId === 'conversations'
        && capabilityVersion === 2
        && operationId === 'conversation.execute') {
        return ['write:chat'];
      }
      throw new TypeError('unknown-operation');
    },
    serverIdentityPin: SERVER_PIN,
    serverOrigin: SERVER_ORIGIN,
    sessionTtlMs: 300_000,
  });
  const policy = createM7TransportAdmissionPolicy({
    listener: {
      bindAddress: '192.168.50.10',
      port: 7443,
      serverIdentityPin: SERVER_PIN,
      serverOrigin: SERVER_ORIGIN,
      tlsMaximumVersion: 'TLSv1.3',
      tlsMinimumVersion: 'TLSv1.3',
      trustProxy: false,
    },
    peerIdentityKey: PEER_KEY,
  });
  const limiter = createM7DurableRateLimiter(database, { clock: () => nowMs });
  const coreConfig = {
    authorizeConversation: async ({ projectId, exists }) => exists && projectId === 1,
    authorizeProject: async ({ projectId }) => {
      projectAuthorityCalls += 1;
      return projectId === 1;
    },
    clock: () => nowMs,
    coreVersion: '136.1.0',
    cursorKey: CURSOR_KEY,
    database,
    executeConversation: async request => {
      conversationCalls += 1;
      if (executeConversation !== null) return executeConversation(request);
      return {
        contract: 'ConversationResult', version: 1,
        requestId: request.requestId, conversationId: request.conversationId,
        turnId: request.turnId, status: 'ok', response: { content: 'Pipeline response.' },
      };
    },
    healthComponents: [
      { componentId: 'core', observe: async () => ({ status: 'ok', code: 'READY' }) },
    ],
    mediateMutation: async intent => ({ state: 'executed', result: await intent.perform() }),
  };
  const pipeline = createM7DisconnectedRequestPipeline({
    admissionPolicy: policy,
    coreConfig,
    rateLimiter: limiter,
    sessionAuthority: authority,
  });
  return {
    authority,
    close() {
      database.close();
      rmSync(root, { recursive: true, force: true });
    },
    conversationCalls: () => conversationCalls,
    coreConfig,
    database,
    keys,
    limiter,
    now: () => nowMs,
    pipeline,
    policy,
    projectAuthorityCalls: () => projectAuthorityCalls,
    tick(milliseconds) { nowMs += milliseconds; },
  };
}

async function dispatchValue(fixture, pathname, value, options) {
  const bytes = bodyBytes(value);
  return fixture.pipeline.dispatch({
    bodyBytes: bytes,
    transport: transport(pathname, bytes, options),
  });
}

async function pairAndOpen(fixture) {
  const claim = fixture.authority.issuePairingClaim({
    subjectId: 'subject:pipeline',
    scopes: ['read:projects', 'write:chat'],
  });
  const pairingRequest = {
    claimCode: claim.claimCode,
    clientBuild: 'android-pipeline-1',
    clientInstanceId: 'client:pipeline:001',
    clientNonce: 'pairing_nonce_0000000000000001',
    contract: 'RemotePairingClaimRequest',
    deviceKeyId: 'device-key:pipeline:001',
    devicePublicKey: fixture.keys.publicKey,
    requestId: 'request:pipeline:pairing',
    sentAt: new Date(fixture.now()).toISOString(),
    version: 1,
  };
  const pairing = await dispatchValue(
    fixture,
    '/remote/v1/pairing/claim',
    pairingRequest,
  );
  const challengeRequest = signRequest('RemoteSessionChallengeRequest@1', {
    clientNonce: 'challenge_nonce_000000000000001',
    contract: 'RemoteSessionChallengeRequest',
    deviceId: pairing.deviceId,
    pairingRevision: pairing.pairingRevision,
    purpose: 'OPEN',
    requestId: 'request:pipeline:challenge:open',
    sentAt: new Date(fixture.now()).toISOString(),
    sessionId: null,
    sessionRevision: null,
    version: 1,
  }, fixture.keys.privateKey);
  const challenge = await dispatchValue(
    fixture,
    '/remote/v1/session/challenge',
    challengeRequest,
  );
  const openRequest = signRequest('RemoteSessionOpenRequest@1', {
    clientBuild: pairingRequest.clientBuild,
    clientInstanceId: pairingRequest.clientInstanceId,
    contract: 'RemoteSessionOpenRequest',
    deviceId: pairing.deviceId,
    deviceKeyId: pairingRequest.deviceKeyId,
    pairingRevision: pairing.pairingRevision,
    requestId: 'request:pipeline:open',
    sentAt: new Date(fixture.now()).toISOString(),
    serverNonce: challenge.serverNonce,
    version: 1,
  }, fixture.keys.privateKey);
  const opened = await dispatchValue(fixture, '/remote/v1/session/open', openRequest);
  return { challenge, opened, pairing, pairingRequest };
}

function invocation(fixture, opened, {
  capabilityId = 'projects',
  capabilityVersion = 2,
  clientCounter = 1,
  nonce = 'invocation_nonce_00000000000001',
  operationId = 'project.list',
  payload = null,
  requestId = 'request:pipeline:invoke:001',
} = {}) {
  const requestPayload = payload ?? {
    contract: 'ProjectListQuery', version: 1, requestId, limit: 10,
  };
  return signRequest('RemoteInvocationEnvelope@1', {
    capabilityId,
    capabilityVersion,
    clientCounter,
    contract: 'RemoteInvocationEnvelope',
    deviceId: opened.deviceId,
    nonce,
    operationId,
    payload: requestPayload,
    payloadDigest: digestM7SessionValue(requestPayload),
    requestId,
    sentAt: new Date(fixture.now()).toISOString(),
    sessionId: opened.sessionId,
    sessionRevision: opened.sessionRevision,
    subjectId: opened.subjectId,
    version: 1,
  }, fixture.keys.privateKey);
}

function sessionRecord(opened, pairingRequest) {
  return {
    contract: 'RemoteSession',
    version: 1,
    sessionId: opened.sessionId,
    deviceId: opened.deviceId,
    subjectId: opened.subjectId,
    pairingRevision: opened.pairingRevision,
    sessionRevision: opened.sessionRevision,
    scopes: [...opened.scopes],
    clientBuild: pairingRequest.clientBuild,
    deviceKeyId: pairingRequest.deviceKeyId,
    serverOrigin: opened.serverOrigin,
    serverIdentityPin: opened.serverIdentityPin,
    adapterManifestDigest: opened.adapterManifestDigest,
    issuedAt: opened.issuedAt,
    expiresAt: opened.expiresAt,
    state: 'ACTIVE',
  };
}

suite('M7 disconnected request authority pipeline');

test('composition requires genuine reviewed authorities and stays explicitly disconnected', () => {
  const fixture = setup();
  try {
    assert.equal(fixture.pipeline.stage, M7_DISCONNECTED_REQUEST_PIPELINE_STAGE);
    assert.equal(isGenuineM7DisconnectedRequestPipeline(fixture.pipeline), true);
    assert.equal(isGenuineM7DisconnectedRequestPipeline({ ...fixture.pipeline }), false);
    assert.deepEqual(fixture.pipeline.describe(), {
      contract: 'M7DisconnectedRequestPipeline',
      version: 1,
      stage: 'IMPLEMENTED_NOT_ACTIVE',
      listener: 'absent',
      transport: 'disconnected',
      serverOrigin: SERVER_ORIGIN,
      serverIdentityPin: SERVER_PIN,
    });
    for (const override of [
      { admissionPolicy: { ...fixture.policy } },
      { rateLimiter: { ...fixture.limiter } },
      { sessionAuthority: { ...fixture.authority } },
    ]) expectCode(() => createM7DisconnectedRequestPipeline({
      admissionPolicy: fixture.policy,
      coreConfig: fixture.coreConfig,
      rateLimiter: fixture.limiter,
      sessionAuthority: fixture.authority,
      ...override,
    }), M7_DISCONNECTED_REQUEST_PIPELINE_ERROR.CONFIG_INVALID);
  } finally {
    fixture.close();
  }
});

await testAsync('all seven routes cross one admission and durable limiter boundary', async () => {
  const fixture = setup();
  try {
    const health = await fixture.pipeline.dispatch({
      bodyBytes: Buffer.alloc(0),
      transport: transport('/remote/v1/health', Buffer.alloc(0), {
        method: 'GET', requestId: 'request:pipeline:health',
      }),
    });
    assert.equal(health.requestId, 'request:pipeline:health');
    assert.equal(validateMobileRemotePayload('RemoteHealthSnapshot@1', health).valid, true);

    const paired = await pairAndOpen(fixture);
    const invokeRequest = invocation(fixture, paired.opened);
    const invokeResult = await dispatchValue(fixture, '/remote/v1/invoke', invokeRequest);
    assert.equal(invokeResult.status, 'ok');
    assert.deepEqual(invokeResult.payload.items.map(item => item.projectId), [1]);
    const responseValidation = await validateRemoteResponseEnvelopeV1({
      requestEnvelope: invokeRequest,
      responseEnvelope: invokeResult,
      session: sessionRecord(paired.opened, paired.pairingRequest),
      nowMs: fixture.now(),
    });
    assert.deepEqual(responseValidation.errors, []);

    const refreshChallengeRequest = signRequest('RemoteSessionChallengeRequest@1', {
      clientNonce: 'challenge_nonce_000000000000002',
      contract: 'RemoteSessionChallengeRequest',
      deviceId: paired.opened.deviceId,
      pairingRevision: paired.opened.pairingRevision,
      purpose: 'REFRESH',
      requestId: 'request:pipeline:challenge:refresh',
      sentAt: new Date(fixture.now()).toISOString(),
      sessionId: paired.opened.sessionId,
      sessionRevision: paired.opened.sessionRevision,
      version: 1,
    }, fixture.keys.privateKey);
    const refreshChallenge = await dispatchValue(
      fixture,
      '/remote/v1/session/challenge',
      refreshChallengeRequest,
    );
    const refreshRequest = signRequest('RemoteSessionRefreshRequest@1', {
      clientCounter: 2,
      clientNonce: 'refresh_nonce_0000000000000001',
      contract: 'RemoteSessionRefreshRequest',
      deviceId: paired.opened.deviceId,
      requestId: 'request:pipeline:refresh',
      sentAt: new Date(fixture.now()).toISOString(),
      serverNonce: refreshChallenge.serverNonce,
      sessionId: paired.opened.sessionId,
      sessionRevision: paired.opened.sessionRevision,
      subjectId: paired.opened.subjectId,
      version: 1,
    }, fixture.keys.privateKey);
    const refreshed = await dispatchValue(fixture, '/remote/v1/session/refresh', refreshRequest);
    assert.notEqual(refreshed.sessionRevision, paired.opened.sessionRevision);

    const revokeRequest = signRequest('RemoteSessionRevokeRequest@1', {
      clientCounter: 3,
      clientNonce: 'revoke_nonce_00000000000000001',
      contract: 'RemoteSessionRevokeRequest',
      deviceId: refreshed.deviceId,
      reason: 'logout',
      requestId: 'request:pipeline:revoke',
      sentAt: new Date(fixture.now()).toISOString(),
      sessionId: refreshed.sessionId,
      sessionRevision: refreshed.sessionRevision,
      subjectId: refreshed.subjectId,
      version: 1,
    }, fixture.keys.privateKey);
    const revoked = await dispatchValue(fixture, '/remote/v1/session/revoke', revokeRequest);
    assert.equal(revoked.status, 'revoked');
    assert.equal(fixture.database.prepare(`
      SELECT count(DISTINCT route_id) AS count FROM m7_remote_rate_limit_buckets
    `).get().count, 4);
  } finally {
    fixture.close();
  }
});

await testAsync('canonical byte, UTF-8 and framing failures never reach session authority', async () => {
  const fixture = setup();
  try {
    const beforeAudit = fixture.database.prepare(`
      SELECT count(*) AS count FROM m7_remote_session_audit_events
    `).get().count;
    for (const bytes of [
      Buffer.from('{"contract":"x", "contract":"y"}', 'utf8'),
      Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d]),
    ]) await expectCodeAsync(() => fixture.pipeline.dispatch({
      bodyBytes: bytes,
      transport: transport('/remote/v1/session/open', bytes),
    }), M7_DISCONNECTED_REQUEST_PIPELINE_ERROR.BODY_INVALID);
    const rateCount = fixture.database.prepare(`
      SELECT allowed_count AS count FROM m7_remote_rate_limit_buckets
      WHERE bucket = 'session-control-peer'
    `).get().count;
    assert.equal(rateCount, 2);
    const mismatch = Buffer.from('{}', 'utf8');
    const mismatchedTransport = transport('/remote/v1/session/open', mismatch);
    mismatchedTransport.rawHeaders[mismatchedTransport.rawHeaders.indexOf('Content-Length') + 1] = '3';
    await expectCodeAsync(() => fixture.pipeline.dispatch({
      bodyBytes: mismatch,
      transport: mismatchedTransport,
    }), M7_DISCONNECTED_REQUEST_PIPELINE_ERROR.BODY_INVALID);
    assert.equal(fixture.database.prepare(`
      SELECT allowed_count AS count FROM m7_remote_rate_limit_buckets
      WHERE bucket = 'session-control-peer'
    `).get().count, 2);
    assert.equal(fixture.database.prepare(`
      SELECT count(*) AS count FROM m7_remote_session_audit_events
    `).get().count, beforeAudit);
  } finally {
    fixture.close();
  }
});

await testAsync('rate denial is terminal before session and reports no raw peer or claim', async () => {
  const fixture = setup({ seed: 'rate-denial' });
  try {
    const invalidPairing = {
      claimCode: 'invalid_claim_code_0001',
      clientBuild: 'android-pipeline-1',
      clientInstanceId: 'client:pipeline:rate',
      clientNonce: 'pairing_nonce_0000000000000002',
      contract: 'RemotePairingClaimRequest',
      deviceKeyId: 'device-key:pipeline:rate',
      devicePublicKey: fixture.keys.publicKey,
      requestId: 'request:pipeline:rate',
      sentAt: new Date(fixture.now()).toISOString(),
      version: 1,
    };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await assert.rejects(
        () => dispatchValue(fixture, '/remote/v1/pairing/claim', invalidPairing),
        error => error?.code === 'M7_SESSION_PAIRING_INVALID',
      );
    }
    const auditBefore = fixture.database.prepare(`
      SELECT count(*) AS count FROM m7_remote_session_audit_events
    `).get().count;
    let caught;
    try {
      await dispatchValue(fixture, '/remote/v1/pairing/claim', invalidPairing);
    } catch (error) {
      caught = error;
    }
    assert.equal(caught.code, M7_DISCONNECTED_REQUEST_PIPELINE_ERROR.RATE_LIMITED);
    assert.equal(JSON.stringify(caught.details).includes('192.168.50.22'), false);
    assert.equal(JSON.stringify(caught.details).includes(invalidPairing.claimCode), false);
    assert.equal(fixture.database.prepare(`
      SELECT count(*) AS count FROM m7_remote_session_audit_events
    `).get().count, auditBefore);
  } finally {
    fixture.close();
  }
});

await testAsync('payload validation precedes replay consumption and signature tamper precedes core', async () => {
  const fixture = setup({ seed: 'validation-order' });
  try {
    const { opened } = await pairAndOpen(fixture);
    const auditBefore = fixture.database.prepare(`
      SELECT count(*) AS count FROM m7_remote_session_audit_events
    `).get().count;
    const invalidPayload = {
      contract: 'ProjectListQuery', version: 1,
      requestId: 'request:pipeline:invalid-payload', limit: 10, extra: true,
    };
    await assert.rejects(
      () => dispatchValue(fixture, '/remote/v1/invoke', invocation(fixture, opened, {
        payload: invalidPayload,
        requestId: invalidPayload.requestId,
      })),
      error => error?.code === 'M7_PROVIDER_INVALID_REQUEST',
    );
    assert.equal(fixture.database.prepare(`
      SELECT count(*) AS count FROM m7_remote_invocation_nonces
    `).get().count, 0);
    assert.equal(fixture.database.prepare(`
      SELECT count(*) AS count FROM m7_remote_session_audit_events
    `).get().count, auditBefore);

    const valid = invocation(fixture, opened, {
      requestId: 'request:pipeline:valid-after-invalid',
    });
    const tampered = {
      ...valid,
      payload: { ...valid.payload, limit: 11 },
      payloadDigest: digestM7SessionValue({ ...valid.payload, limit: 11 }),
    };
    await assert.rejects(
      () => dispatchValue(fixture, '/remote/v1/invoke', tampered),
      error => error?.code === 'M7_SESSION_DEVICE_PROOF_INVALID',
    );
    assert.equal(fixture.projectAuthorityCalls(), 0);
    const result = await dispatchValue(fixture, '/remote/v1/invoke', valid);
    assert.equal(result.status, 'ok');
    assert.equal(fixture.projectAuthorityCalls() > 0, true);
  } finally {
    fixture.close();
  }
});

await testAsync('one session cannot run two provider handlers concurrently', async () => {
  let release;
  let startedResolve;
  const started = new Promise(resolve => { startedResolve = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const fixture = setup({
    seed: 'in-flight',
    executeConversation: async request => {
      startedResolve();
      await gate;
      return {
        contract: 'ConversationResult', version: 1,
        requestId: request.requestId, conversationId: request.conversationId,
        turnId: request.turnId, status: 'ok', response: { content: 'Released.' },
      };
    },
  });
  try {
    const { opened } = await pairAndOpen(fixture);
    const first = invocation(fixture, opened, {
      capabilityId: 'conversations',
      operationId: 'conversation.execute',
      requestId: 'request:pipeline:concurrent:1',
      payload: {
        contract: 'ConversationCommand', version: 1,
        requestId: 'request:pipeline:concurrent:1',
        conversationId: 'conversation:pipeline', turnId: 'turn:pipeline:concurrent:1',
        action: 'send', input: 'Hold this request.',
      },
    });
    const second = invocation(fixture, opened, {
      capabilityId: 'conversations',
      clientCounter: 2,
      nonce: 'invocation_nonce_00000000000002',
      operationId: 'conversation.execute',
      requestId: 'request:pipeline:concurrent:2',
      payload: {
        contract: 'ConversationCommand', version: 1,
        requestId: 'request:pipeline:concurrent:2',
        conversationId: 'conversation:pipeline', turnId: 'turn:pipeline:concurrent:2',
        action: 'send', input: 'This must not execute concurrently.',
      },
    });
    const firstPromise = dispatchValue(fixture, '/remote/v1/invoke', first);
    await started;
    const secondResult = await dispatchValue(fixture, '/remote/v1/invoke', second);
    assert.equal(secondResult.status, 'error');
    assert.equal(secondResult.error.code, 'REMOTE_SESSION_IN_FLIGHT_LIMIT');
    assert.equal(secondResult.acceptedCounter, 2);
    assert.equal(fixture.conversationCalls(), 1);
    release();
    const firstResult = await firstPromise;
    assert.equal(firstResult.status, 'ok');
    assert.equal(fixture.conversationCalls(), 1);
  } finally {
    release?.();
    fixture.close();
  }
});

test('the pipeline imports no listener, server, route, TLS or network runtime', () => {
  const source = readFileSync(
    new URL('../src/remote/m7-disconnected-request-pipeline.js', import.meta.url),
    'utf8',
  );
  for (const forbidden of [
    'createServer', '.listen(', 'src/server.js', 'src/routes/', 'ws-bridge',
    'node:http', 'node:https', 'node:net', 'node:tls', 'fetch(',
  ]) assert.equal(source.includes(forbidden), false, forbidden);
});

summary();
