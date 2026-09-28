#!/usr/bin/env node

import './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';

import Database from 'better-sqlite3';

import {
  MOBILE_REMOTE_CANDIDATE_ADAPTER_MANIFEST_DIGEST_V1,
} from '../docs/mobile/contracts/remote-capability-manifests-v1.js';
import { up as installSessions } from '../src/db/migrations/2026_08_29_105_m7_remote_session_authority.js';
import {
  M7_LOCAL_PAIRING_ERROR,
  M7_LOCAL_PAIRING_ROUTE,
  createM7LocalPairingRoutes,
} from '../src/routes/m7-local-pairing.js';
import { createGlobalAuthAuthority } from '../src/security/global-auth-policy.js';
import { createM7SessionAuthority } from '../src/remote/m7-session-authority.js';
import { suite, summary, testAsync } from './harness.js';

const NOW = Date.parse('2026-09-08T12:00:00.000Z');

function setup({ active = true } = {}) {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  installSessions(database);
  const auth = createGlobalAuthAuthority({
    adminToken: 'test-admin-token',
    localCapability: 'A'.repeat(43),
    production: true,
  });
  const local = auth.authorize({
    headers: { 'x-intentsmith-local-capability': 'A'.repeat(43) },
    remoteAddress: '127.0.0.1',
    routeKey: M7_LOCAL_PAIRING_ROUTE,
  });
  const admin = auth.authorize({
    headers: { 'x-admin-token': 'test-admin-token' },
    remoteAddress: '127.0.0.1',
    routeKey: M7_LOCAL_PAIRING_ROUTE,
  });
  let authorizationInputs = [];
  const authority = createM7SessionAuthority(database, {
    adapterManifestDigest: MOBILE_REMOTE_CANDIDATE_ADAPTER_MANIFEST_DIGEST_V1,
    authorizeOperator: input => {
      authorizationInputs.push(input);
      return input.credentialType === 'local-capability'
        && auth.isAuthenticatedSubject(input.authenticatedSubject)
        ? { actorId: input.authenticatedSubject.actorId, actorType: 'user', decision: 'allow' }
        : { decision: 'deny' };
    },
    claimTtlMs: 300_000,
    clock: () => NOW,
    pairingEnabled: true,
    serverIdentityPin: `sha256:${'a'.repeat(64)}`,
    serverOrigin: 'https://intentsmith.tailnet.example:7443',
  });
  let body = { scopes: ['read:projects', 'write:chat'] };
  const routes = createM7LocalPairingRoutes({
    isAuthenticatedSubject: subject => auth.isAuthenticatedSubject(subject),
    parseBody: async () => body,
    resolveSessionAuthority: () => active ? authority : null,
    sendJSON: (res, status, payload) => {
      res.status = status;
      res.payload = payload;
      return payload;
    },
  });
  return {
    admin,
    authority,
    authorizationInputs: () => authorizationInputs,
    close: () => database.close(),
    database,
    local,
    route: routes[M7_LOCAL_PAIRING_ROUTE],
    setBody: value => { body = value; },
  };
}

function response() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
  };
}

suite('M7 local Studio pairing issuance route');

await testAsync('genuine local Studio authority issues one five-minute no-store deep link', async () => {
  const fixture = setup();
  try {
    const res = response();
    await fixture.route({
      authenticatedCredentialType: fixture.local.credentialType,
      authenticatedSubject: fixture.local.subject,
    }, res);
    assert.equal(res.status, 201);
    assert.equal(res.headers['Cache-Control'], 'no-store, max-age=0');
    assert.equal(res.headers.Pragma, 'no-cache');
    assert.equal(res.payload.contract, 'M7LocalPairingClaim');
    assert.equal(res.payload.version, 1);
    assert.equal(Date.parse(res.payload.expiresAt) - NOW, 300_000);
    assert.equal(res.payload.pairingUri, `intentsmith://pair?code=${res.payload.claimCode}`);
    assert.equal(res.payload.subjectId, 'local-operator');
    assert.deepEqual(res.payload.scopes, ['read:projects', 'write:chat']);
    const stored = fixture.database.prepare(`
      SELECT claim_digest AS claimDigest, consumed_at_ms AS consumedAtMs
      FROM m7_remote_pairing_claims
    `).get();
    assert.match(stored.claimDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(JSON.stringify(stored).includes(res.payload.claimCode), false);
    assert.equal(stored.consumedAtMs, null);
    assert.equal(fixture.authorizationInputs().length, 1);
    assert.equal(
      fixture.authorizationInputs()[0].authenticatedSubject,
      fixture.local.subject,
    );
    const firstClaimId = res.payload.claimId;
    const next = response();
    await fixture.route({
      authenticatedCredentialType: fixture.local.credentialType,
      authenticatedSubject: fixture.local.subject,
    }, next);
    assert.equal(next.status, 201);
    assert.notEqual(next.payload.claimId, firstClaimId);
    const claims = fixture.database.prepare(`
      SELECT claim_id AS claimId, revoked_at_ms AS revokedAtMs
      FROM m7_remote_pairing_claims ORDER BY issued_at_ms, claim_id
    `).all();
    assert.equal(claims.length, 2);
    assert.equal(claims.find(row => row.claimId === firstClaimId).revokedAtMs, NOW);
    assert.equal(claims.find(row => row.claimId === next.payload.claimId).revokedAtMs, null);
  } finally {
    fixture.close();
  }
});

await testAsync('admin, API-shaped clones and self-asserted body identity cannot issue claims', async () => {
  const fixture = setup();
  try {
    for (const req of [
      {
        authenticatedCredentialType: fixture.admin.credentialType,
        authenticatedSubject: fixture.admin.subject,
      },
      {
        authenticatedCredentialType: 'local-capability',
        authenticatedSubject: { ...fixture.local.subject },
      },
    ]) {
      const res = response();
      await fixture.route(req, res);
      assert.equal(res.status, 403);
      assert.equal(res.payload.code, M7_LOCAL_PAIRING_ERROR.AUTH_REQUIRED);
    }
    fixture.setBody({
      actorId: 'attacker',
      scopes: ['read:projects'],
      subjectId: 'attacker',
    });
    const res = response();
    await fixture.route({
      authenticatedCredentialType: fixture.local.credentialType,
      authenticatedSubject: fixture.local.subject,
    }, res);
    assert.equal(res.status, 400);
    assert.equal(res.payload.code, M7_LOCAL_PAIRING_ERROR.BODY_INVALID);
    assert.equal(fixture.database.prepare('SELECT count(*) AS count FROM m7_remote_pairing_claims').get().count, 0);
  } finally {
    fixture.close();
  }
});

await testAsync('inactive M7 runtime returns 503 before parsing a body', async () => {
  const fixture = setup({ active: false });
  try {
    fixture.setBody(null);
    const res = response();
    await fixture.route({
      authenticatedCredentialType: fixture.local.credentialType,
      authenticatedSubject: fixture.local.subject,
    }, res);
    assert.equal(res.status, 503);
    assert.equal(res.payload.code, M7_LOCAL_PAIRING_ERROR.NOT_ACTIVE);
    assert.equal(fixture.authorizationInputs().length, 0);
  } finally {
    fixture.close();
  }
});

await testAsync('raw authority calls remain denied by the same closure-authenticated predicate', async () => {
  const fixture = setup();
  try {
    assert.throws(() => fixture.authority.issuePairingClaim({
      authenticatedSubject: { actorId: 'local-operator', actorType: 'user' },
      credentialType: 'local-capability',
      scopes: ['read:projects'],
      subjectId: 'local-operator',
    }), error => error?.code === 'M7_SESSION_OPERATOR_AUTHORITY_DENIED');
  } finally {
    fixture.close();
  }
});

summary();
