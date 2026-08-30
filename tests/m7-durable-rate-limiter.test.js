#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import { up as installRateLimits } from '../src/db/migrations/2026_08_30_108_m7_durable_rate_limits.js';
import {
  M7_DURABLE_RATE_LIMIT_ERROR,
  createM7DurableRateLimiter,
  isGenuineM7DurableRateLimiter,
} from '../src/remote/m7-durable-rate-limiter.js';
import {
  createM7TransportAdmissionPolicy,
  isGenuineM7TransportRateLimitPlan,
} from '../src/remote/m7-transport-admission-policy.js';
import { suite, summary, test, testAsync } from './harness.js';

const KEY = Buffer.from('11'.repeat(32), 'hex');
let nowMs = 1_800_000_000_000;

function setup({ maximumRows = 50_000, retentionMs = 86_400_000 } = {}) {
  const database = new Database(':memory:');
  installRateLimits(database);
  const policy = createM7TransportAdmissionPolicy({
    listener: {
      bindAddress: '192.168.50.10',
      port: 7443,
      serverIdentityPin: `sha256:${'a'.repeat(64)}`,
      serverOrigin: 'https://intentsmith.home.arpa:7443',
      tlsMaximumVersion: 'TLSv1.3',
      tlsMinimumVersion: 'TLSv1.3',
      trustProxy: false,
    },
    peerIdentityKey: KEY,
  });
  const limiter = createM7DurableRateLimiter(database, {
    clock: () => nowMs,
    maximumRows,
    retentionMs,
  });
  return { database, limiter, policy };
}

function request({ remoteAddress = '192.168.50.22', target = '/remote/v1/invoke' } = {}) {
  return {
    httpVersion: '1.1',
    method: 'POST',
    rawHeaders: [
      'Host', 'intentsmith.home.arpa:7443',
      'Content-Type', 'application/json',
      'Content-Length', '128',
    ],
    remoteAddress,
    socketEncrypted: true,
    target,
    tlsVersion: 'TLSv1.3',
  };
}

function invocationPlan(policy, operationKind = 'mutation', remoteAddress) {
  const admission = policy.admit(request({ remoteAddress }));
  return policy.createRateLimitPlan(admission, { operationKind });
}

function pairingPlan(policy, remoteAddress = '192.168.50.22', digest = 'b'.repeat(64)) {
  const admission = policy.admit(request({
    remoteAddress,
    target: '/remote/v1/pairing/claim',
  }));
  return policy.createRateLimitPlan(admission, { claimCodeDigest: `sha256:${digest}` });
}

function expectCode(fn, code) {
  assert.throws(fn, error => error?.code === code);
}

function waitFor(predicate, timeoutMs = 5_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) return resolve();
      if (Date.now() - started >= timeoutMs) return reject(new Error('wait timed out'));
      setTimeout(poll, 5);
    };
    poll();
  });
}

function runRacer(databasePath, readyPath, startPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      new URL('./helpers/m7-durable-rate-limit-racer.js', import.meta.url).pathname,
      databasePath,
      readyPath,
      startPath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', code => {
      if (code !== 0) reject(new Error(`racer exit ${code}: ${stderr}`));
      else resolve(JSON.parse(stdout));
    });
  });
}

suite('M7 durable rate-limit authority');

test('only closure-genuine policy plans and limiter receivers can consume', () => {
  const { database, limiter, policy } = setup();
  const plan = invocationPlan(policy);
  assert.equal(isGenuineM7TransportRateLimitPlan(plan), true);
  assert.equal(isGenuineM7DurableRateLimiter(limiter), true);
  expectCode(() => limiter.consume({ ...plan }), M7_DURABLE_RATE_LIMIT_ERROR.INPUT_INVALID);
  expectCode(() => ({ ...limiter }).consume(plan), M7_DURABLE_RATE_LIMIT_ERROR.INPUT_INVALID);
  assert.equal(database.prepare('SELECT count(*) AS count FROM m7_remote_rate_limit_buckets').get().count, 0);
  database.close();
});

test('missing storage schema fails with the typed fail-closed error', () => {
  const database = new Database(':memory:');
  expectCode(
    () => createM7DurableRateLimiter(database),
    M7_DURABLE_RATE_LIMIT_ERROR.STORAGE_FAILURE,
  );
  database.close();
});

test('pairing consumes three buckets atomically and denial changes none', () => {
  const { database, limiter, policy } = setup();
  const plan = pairingPlan(policy);
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    assert.equal(limiter.consume(plan).allowed, true);
  }
  const before = database.prepare(`
    SELECT identity_digest, allowed_count FROM m7_remote_rate_limit_buckets
    ORDER BY identity_digest
  `).all();
  const denied = limiter.consume(plan);
  assert.equal(denied.allowed, false);
  assert.deepEqual(denied.limitedBuckets, ['pairing-peer', 'pairing-peer-claim']);
  assert.equal(denied.retryAfterSeconds > 0, true);
  assert.deepEqual(database.prepare(`
    SELECT identity_digest, allowed_count FROM m7_remote_rate_limit_buckets
    ORDER BY identity_digest
  `).all(), before);
  assert.equal(JSON.stringify(before).includes('192.168.50.22'), false);
  assert.equal(JSON.stringify(before).includes('b'.repeat(64)), false);
  database.close();
});

test('read and mutation windows enforce their exact independent limits', () => {
  const { database, limiter, policy } = setup();
  const read = invocationPlan(policy, 'read');
  const mutation = invocationPlan(policy, 'mutation');
  for (let attempt = 1; attempt <= 60; attempt += 1) assert.equal(limiter.consume(read).allowed, true);
  assert.equal(limiter.consume(read).allowed, false);
  for (let attempt = 1; attempt <= 10; attempt += 1) assert.equal(limiter.consume(mutation).allowed, true);
  assert.equal(limiter.consume(mutation).allowed, false);
  assert.equal(database.prepare('SELECT count(*) AS count FROM m7_remote_rate_limit_buckets').get().count, 2);
  database.close();
});

test('all session-control routes share one stable peer bucket without config drift', () => {
  const { database, limiter, policy } = setup();
  const paths = [
    '/remote/v1/session/challenge',
    '/remote/v1/session/open',
    '/remote/v1/session/refresh',
    '/remote/v1/session/revoke',
  ];
  for (const target of paths) {
    const admission = policy.admit(request({ target }));
    const decision = limiter.consume(policy.createRateLimitPlan(admission, {}));
    assert.equal(decision.allowed, true);
    assert.equal(decision.routeId, admission.routeId);
  }
  assert.deepEqual(database.prepare(`
    SELECT route_id AS configurationId, allowed_count AS allowedCount
    FROM m7_remote_rate_limit_buckets WHERE bucket = 'session-control-peer'
  `).get(), { configurationId: 'session-control', allowedCount: 4 });
  database.close();
});

test('state survives a second repository instance and SQLite connection', () => {
  const path = process.env.INTENTSMITH_TEST_ARTIFACT_DIR
    ? `${process.env.INTENTSMITH_TEST_ARTIFACT_DIR}/m7-rate-limit-restart.sqlite`
    : ':memory:';
  const first = new Database(path);
  installRateLimits(first);
  const fixture = setup();
  const plan = invocationPlan(fixture.policy, 'mutation');
  const firstLimiter = createM7DurableRateLimiter(first, { clock: () => nowMs });
  for (let attempt = 1; attempt <= 9; attempt += 1) firstLimiter.consume(plan);
  first.close();
  const second = new Database(path);
  const secondLimiter = createM7DurableRateLimiter(second, { clock: () => nowMs });
  assert.equal(secondLimiter.consume(plan).allowed, true);
  assert.equal(secondLimiter.consume(plan).allowed, false);
  second.close();
  fixture.database.close();
});

await testAsync('two processes serialize on one IMMEDIATE counter without over-admission', async () => {
  const root = mkdtempSync(path.join(process.env.INTENTSMITH_TEST_ARTIFACT_DIR, 'm7-rate-race-'));
  const databasePath = path.join(root, 'rate.sqlite');
  const startPath = path.join(root, 'start');
  const readyPaths = [path.join(root, 'ready-1'), path.join(root, 'ready-2')];
  const database = new Database(databasePath);
  installRateLimits(database);
  database.close();
  const racers = readyPaths.map(readyPath => runRacer(databasePath, readyPath, startPath));
  await waitFor(() => readyPaths.every(readyPath => existsSync(readyPath)));
  writeFileSync(startPath, 'start\n', { flag: 'wx', mode: 0o600 });
  const results = await Promise.all(racers);
  assert.equal(results.reduce((sum, result) => sum + result.allowed, 0), 10);
  assert.equal(results.reduce((sum, result) => sum + result.denied, 0), 10);
  const verify = new Database(databasePath, { readonly: true });
  assert.deepEqual(verify.prepare(`
    SELECT allowed_count AS allowedCount FROM m7_remote_rate_limit_buckets
  `).get(), { allowedCount: 10 });
  verify.close();
});

test('window rollover resets exactly and clock regression fails closed', () => {
  const { database, limiter, policy } = setup();
  const plan = invocationPlan(policy, 'mutation');
  assert.equal(limiter.consume(plan).allowed, true);
  const original = nowMs;
  nowMs += 60_000;
  assert.equal(limiter.consume(plan).allowed, true);
  nowMs -= 1;
  expectCode(() => limiter.consume(plan), M7_DURABLE_RATE_LIMIT_ERROR.CLOCK_REGRESSION);
  nowMs = original;
  database.close();
});

test('active-window storage drift is denied and expires before canonical recovery', () => {
  const { database, limiter, policy } = setup();
  const plan = invocationPlan(policy, 'mutation');
  limiter.consume(plan);
  database.prepare(`
    UPDATE m7_remote_rate_limit_buckets SET maximum = 9
    WHERE identity_digest = ?
  `).run(plan.buckets[0].identityDigest);
  expectCode(() => limiter.consume(plan), M7_DURABLE_RATE_LIMIT_ERROR.CONFIG_DRIFT);
  assert.equal(database.prepare('SELECT allowed_count AS count FROM m7_remote_rate_limit_buckets').get().count, 1);
  nowMs += 60_000;
  assert.equal(limiter.consume(plan).allowed, true);
  assert.deepEqual(database.prepare(`
    SELECT maximum, allowed_count AS allowedCount
    FROM m7_remote_rate_limit_buckets
  `).get(), { maximum: 10, allowedCount: 1 });
  nowMs -= 60_000;
  database.close();
});

test('retention cleanup is bounded and capacity fails before a partial insert', () => {
  const { database, limiter, policy } = setup({ maximumRows: 3, retentionMs: 60_000 });
  limiter.consume(pairingPlan(policy));
  const before = database.prepare('SELECT count(*) AS count FROM m7_remote_rate_limit_buckets').get().count;
  assert.equal(before, 3);
  expectCode(
    () => limiter.consume(invocationPlan(policy, 'read', '192.168.50.99')),
    M7_DURABLE_RATE_LIMIT_ERROR.CAPACITY_EXCEEDED,
  );
  assert.equal(database.prepare('SELECT count(*) AS count FROM m7_remote_rate_limit_buckets').get().count, 3);
  nowMs += 11 * 60_000;
  assert.equal(limiter.consume(invocationPlan(policy, 'read', '192.168.50.99')).allowed, true);
  assert.equal(database.prepare('SELECT count(*) AS count FROM m7_remote_rate_limit_buckets').get().count, 1);
  database.close();
});

test('limiter stays disconnected from listener, session and provider runtime', () => {
  const source = readFileSync(
    new URL('../src/remote/m7-durable-rate-limiter.js', import.meta.url),
    'utf8',
  );
  for (const forbidden of [
    'createServer', '.listen(', 'm7-session-authority', 'm7-core-composition',
    'src/server.js', 'node:http', 'node:https', 'node:tls',
  ]) assert.equal(source.includes(forbidden), false, forbidden);
});

summary();
