import './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import {
  M5_PRIVACY_HISTORY_ACTION,
  M5_PRIVACY_HISTORY_DECISIONS,
  M5_PRIVACY_REPOSITORY_VISIBILITY,
  M5_PRIVACY_ROTATION_CATEGORIES,
  canonicalizeM5PrivacyValue,
  createM5PrivacyRotationReceipt,
} from '../contracts/m5/privacy-remediation-v1.js';
import {
  EXPECTED_M5_PRIVACY_AUTHORITY_FINGERPRINT_V090,
  computeM5PrivacyAuthorityFingerprintV090,
  up as applyPrivacyAuthority,
} from '../src/db/migrations/2026_08_26_090_m5_privacy_authority.js';
import { generateLicenseKey, validateLicenseKey } from '../src/licensing/license.js';
import { createNotificationRoutes } from '../src/routes/notifications.js';
import { createMiscRoutes } from '../src/routes/misc.js';
import { createPrivacyRoutes } from '../src/routes/privacy.js';
import { createSecurityRoutes } from '../src/routes/security.js';
import {
  M5PrivacyAuthorityError,
  M5PrivacyAuthorityErrorCode,
  M5PrivacyAuthorityRepository,
} from '../src/security/privacy-authority-repository.js';
import {
  scanM5TrackedTree,
  verifyM5PrivacyHistoryReachability,
} from '../src/security/privacy-scan.js';
import {
  inspectM5UserSettingsPrivacy,
  scrubM5UserSettingsPrivacy,
} from '../src/security/user-settings-privacy.js';
import { createSessionAdapter } from '../src/ws-bridge/session-adapter.js';

const NOW = 1_800_000_000_000;
const SUBJECT = Object.freeze({ actorType: 'user', actorId: 'local-operator' });
const CANARY = 'm5-private-canary-value-never-emit';

function openDb(settings = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE user_settings (
      id INTEGER PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare('INSERT INTO user_settings (id, data) VALUES (1, ?)').run(JSON.stringify(settings));
  applyPrivacyAuthority(db);
  return db;
}

function repository(db) {
  return new M5PrivacyAuthorityRepository(db, { clock: () => NOW });
}

function expectCode(operation, code) {
  assert.throws(operation, error => error instanceof M5PrivacyAuthorityError && error.code === code);
}

function routeHarness(authority) {
  const calls = { parseBody: 0, responses: [] };
  const routes = createPrivacyRoutes({
    privacyAuthority: authority,
    parseBody: async req => { calls.parseBody += 1; return req.body; },
    sendJSON: (_res, status, payload) => {
      const response = { status, payload };
      calls.responses.push(response);
      return response;
    },
    safeError: () => ({ error: 'Internal server error' }),
  });
  return { calls, routes };
}

test('privacy migration scrubs obsolete plaintext settings and installs exact schema', () => {
  const db = openDb({
    webhookSecret: CANARY,
    'c3.notif.smtpPass': CANARY,
    notifications: {
      telegramToken: CANARY,
      smsSecret: CANARY,
      retained: true,
    },
    'c3.notif.smtpHost': 'smtp.invalid',
  });
  const settings = JSON.parse(db.prepare('SELECT data FROM user_settings WHERE id = 1').get().data);
  assert.deepEqual(settings, {
    notifications: { retained: true },
    'c3.notif.smtpHost': 'smtp.invalid',
  });
  assert.equal(
    computeM5PrivacyAuthorityFingerprintV090(db),
    EXPECTED_M5_PRIVACY_AUTHORITY_FINGERPRINT_V090,
  );
  applyPrivacyAuthority(db);
  assert.equal(computeM5PrivacyAuthorityFingerprintV090(db), EXPECTED_M5_PRIVACY_AUTHORITY_FINGERPRINT_V090);
  db.close();
});

test('user settings cannot reintroduce plaintext credential keys or malformed JSON', () => {
  const db = openDb({ retained: true });
  assert.throws(
    () => db.prepare('UPDATE user_settings SET data = ? WHERE id = 1').run(JSON.stringify({ webhookSecret: CANARY })),
    /M5_PRIVACY_PLAINTEXT_SETTING_FORBIDDEN/,
  );
  assert.throws(
    () => db.prepare('INSERT INTO user_settings (id, data) VALUES (2, ?)').run('{'),
    /M5_PRIVACY_PLAINTEXT_SETTING_FORBIDDEN/,
  );
  assert.throws(
    () => db.prepare('UPDATE user_settings SET data = ? WHERE id = 1').run(JSON.stringify({
      nested: { telegramToken: CANARY },
    })),
    /M5_PRIVACY_PLAINTEXT_SETTING_FORBIDDEN/,
  );
  assert.deepEqual(JSON.parse(db.prepare('SELECT data FROM user_settings WHERE id = 1').get().data), { retained: true });
  db.close();
});

test('shared settings policy finds and scrubs nested credential keys without retaining values', () => {
  const input = {
    maxTokens: 8192,
    nested: {
      apiKey: CANARY,
      C3_LICENSE_SECRET: CANARY,
      webhookUrl: CANARY,
      retained: 'yes',
    },
  };
  const inspected = inspectM5UserSettingsPrivacy(input);
  assert.equal(inspected.valid, false);
  assert.deepEqual(inspected.forbiddenPaths, [
    'nested.C3_LICENSE_SECRET',
    'nested.apiKey',
    'nested.webhookUrl',
  ]);
  assert(!JSON.stringify(inspected).includes(CANARY));
  const scrubbed = scrubM5UserSettingsPrivacy(input);
  assert.deepEqual(scrubbed.settings, { maxTokens: 8192, nested: { retained: 'yes' } });
  assert.equal(scrubbed.removedCount, 3);
});

test('generic HTTP settings boundary rejects credential documents without storing values', async () => {
  const db = openDb({ retained: true });
  const responses = [];
  const routes = createMiscRoutes({
    db: { db },
    parseBody: async req => req.body,
    sendJSON: (_res, status, payload) => responses.push({ status, payload }),
    safeError: () => ({ error: 'Internal server error' }),
    logger: { info() {}, warn() {}, error() {} },
  });
  await routes['POST /api/settings']({
    body: { language: 'cs', notifications: { telegramToken: CANARY } },
  }, {});
  assert.equal(responses[0].status, 400);
  assert.equal(responses[0].payload.code, 'M5_PRIVACY_PLAINTEXT_SETTING_FORBIDDEN');
  assert.equal(responses[0].payload.forbiddenSettingCount, 1);
  assert(!JSON.stringify(responses[0]).includes(CANARY));
  assert.deepEqual(JSON.parse(db.prepare('SELECT data FROM user_settings WHERE id = 1').get().data), { retained: true });
  db.close();
});

test('WS settings boundary rejects credentials before feature or notification dispatch', () => {
  const sent = [];
  const adapter = createSessionAdapter({
    send: raw => sent.push(JSON.parse(raw)),
    handleRequest: async () => ({ response: 'unused', mode: 'conversation', confidence: 1, state: {} }),
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
  try {
    adapter.handleControl({
      action: 'sync_settings',
      settings: { 'c3.notif.telegramToken': CANARY },
    });
  } finally {
    adapter.cleanup();
  }
  const response = sent.find(message => message.channel === 'control');
  assert.equal(response.data.success, false);
  assert.equal(response.data.code, 'M5_PRIVACY_PLAINTEXT_SETTING_FORBIDDEN');
  assert.equal(response.data.forbiddenSettingCount, 1);
  assert(!JSON.stringify(sent).includes(CANARY));
});

test('remediation remains incomplete until all eight rotations and history are recorded', () => {
  const db = openDb();
  const authority = repository(db);
  const initial = authority.summary();
  assert.equal(initial.verdict, 'INCOMPLETE');
  assert.equal(initial.rotationCompleted, 0);
  assert.equal(initial.rotationRequired, 8);
  assert.equal(initial.historyDisposition, null);

  for (const category of M5_PRIVACY_ROTATION_CATEGORIES) {
    authority.recordRotation({
      authenticatedSubject: SUBJECT,
      categoryId: category.categoryId,
      authorityKind: category.authorityKind,
      completedAtMs: NOW - 1,
    });
  }
  assert.equal(authority.summary().verdict, 'INCOMPLETE');
  authority.recordHistory({
    authenticatedSubject: SUBJECT,
    decision: M5_PRIVACY_HISTORY_DECISIONS.RETAIN_AND_ROTATE,
    actionStatus: M5_PRIVACY_HISTORY_ACTION.RETAINED,
    repositoryVisibility: M5_PRIVACY_REPOSITORY_VISIBILITY.PRIVATE,
    completedAtMs: NOW - 1,
  });
  const complete = authority.summary();
  assert.equal(complete.verdict, 'OPERATOR_REMEDIATION_RECORDED');
  assert.equal(complete.rotationCompleted, 8);
  assert.deepEqual(complete.missingCategoryIds, []);
  assert.equal(complete.secretValuesRecorded, false);
  assert(complete.rotations.every(receipt => receipt.secretValuesRecorded === false));
  db.close();
});

test('authority rejects missing users, future claims, category mismatch and replay', () => {
  const db = openDb();
  const authority = repository(db);
  const category = M5_PRIVACY_ROTATION_CATEGORIES[0];
  const input = {
    authenticatedSubject: SUBJECT,
    categoryId: category.categoryId,
    authorityKind: category.authorityKind,
    completedAtMs: NOW - 1,
  };
  expectCode(
    () => authority.recordRotation({ ...input, authenticatedSubject: { actorType: 'agent', actorId: 'self' } }),
    M5PrivacyAuthorityErrorCode.AUTH_REQUIRED,
  );
  expectCode(
    () => authority.recordRotation({ ...input, completedAtMs: NOW + 1 }),
    M5PrivacyAuthorityErrorCode.INPUT_INVALID,
  );
  expectCode(
    () => authority.recordRotation({ ...input, authorityKind: 'external' }),
    M5PrivacyAuthorityErrorCode.INPUT_INVALID,
  );
  authority.recordRotation(input);
  expectCode(() => authority.recordRotation(input), M5PrivacyAuthorityErrorCode.ROTATION_ALREADY_RECORDED);
  expectCode(() => authority.recordHistory({
    authenticatedSubject: SUBJECT,
    decision: M5_PRIVACY_HISTORY_DECISIONS.RETAIN_AND_ROTATE,
    actionStatus: M5_PRIVACY_HISTORY_ACTION.REWRITE_COMPLETED,
    repositoryVisibility: M5_PRIVACY_REPOSITORY_VISIBILITY.PRIVATE,
    completedAtMs: NOW - 1,
  }), M5PrivacyAuthorityErrorCode.INPUT_INVALID);
  db.close();
});

test('SQL authority rejects forged indexed fields and receipts are append-only', () => {
  const db = openDb();
  const receipt = createM5PrivacyRotationReceipt({
    categoryId: 'administrative-api',
    authorityKind: 'local',
    completedAtMs: NOW - 1,
    attestedAtMs: NOW,
    actorId: SUBJECT.actorId,
  });
  assert.throws(() => db.prepare(`
    INSERT INTO m5_privacy_rotation_receipts (
      receipt_id, incident_id, category_id, completed_at_ms,
      attested_at_ms, actor_id, record_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    receipt.receiptId,
    receipt.incidentId,
    'license-agent',
    receipt.completedAtMs,
    receipt.attestedAtMs,
    receipt.actor.actorId,
    canonicalizeM5PrivacyValue(receipt),
  ), /M5_PRIVACY_ROTATION_AUTHORITY_MISMATCH/);
  repository(db).recordRotation({
    authenticatedSubject: SUBJECT,
    categoryId: receipt.categoryId,
    authorityKind: receipt.authorityKind,
    completedAtMs: receipt.completedAtMs,
  });
  assert.throws(() => db.prepare('UPDATE m5_privacy_rotation_receipts SET actor_id = ?').run('forged'), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM m5_privacy_rotation_receipts').run(), /append-only/);
  db.close();
});

test('HTTP gate takes actor only from transport and rejects bodies carrying extra material', async () => {
  const db = openDb();
  const authority = repository(db);
  const harness = routeHarness(authority);
  const route = harness.routes['POST /api/security/privacy/rotations/:categoryId/attest'];
  await route({ body: { [CANARY]: CANARY } }, {}, { categoryId: 'administrative-api' });
  assert.equal(harness.calls.responses.at(-1).status, 403);
  assert.equal(harness.calls.parseBody, 0);

  await route({
    authenticatedSubject: SUBJECT,
    body: {
      authorityKind: 'local',
      completedAtMs: NOW - 1,
      confirmNoSecretValues: true,
      actorId: 'self-asserted',
      note: CANARY,
    },
  }, {}, { categoryId: 'administrative-api' });
  const rejected = harness.calls.responses.at(-1);
  assert.equal(rejected.status, 400);
  assert(!JSON.stringify(rejected).includes(CANARY));

  await route({
    authenticatedSubject: SUBJECT,
    body: {
      authorityKind: 'local',
      completedAtMs: NOW - 1,
      confirmNoSecretValues: true,
    },
  }, {}, { categoryId: 'administrative-api' });
  const accepted = harness.calls.responses.at(-1);
  assert.equal(accepted.status, 201);
  assert.equal(accepted.payload.actor.actorId, SUBJECT.actorId);
  assert.equal(accepted.payload.secretValuesRecorded, false);
  db.close();
});

test('tree scanner reports only rule, path and line and never the matched value', () => {
  const report = scanM5TrackedTree({
    candidateRevision: 'a'.repeat(40),
    paths: ['.env.example', 'src/unsafe.js'],
    readFile: filePath => {
      if (filePath === '.env.example') throw new Error('allowed template must not be read');
      return Buffer.from(`const apiSecret = '${CANARY}';\n`, 'utf8');
    },
  });
  assert.equal(report.verdict, 'FAIL');
  assert.deepEqual(report.findings, [{
    ruleId: 'M5_PRIVACY_NAMED_SECRET_LITERAL',
    path: 'src/unsafe.js',
    line: 1,
  }]);
  assert.equal(report.secretValuesRecorded, false);
  assert(!JSON.stringify(report).includes(CANARY));
});

test('sensitive tracked paths are not opened and history reachability does not expose identities', () => {
  let reads = 0;
  const tree = scanM5TrackedTree({
    candidateRevision: 'b'.repeat(40),
    paths: ['private.sqlite'],
    readFile: () => { reads += 1; return CANARY; },
  });
  assert.equal(reads, 0);
  assert.equal(tree.findings[0].ruleId, 'M5_PRIVACY_SENSITIVE_PATH_TRACKED');
  const ids = ['a'.repeat(40), 'b'.repeat(40)];
  const history = verifyM5PrivacyHistoryReachability({
    trackedObjectManifest: ids.map(gitBlob => ({ gitBlob })),
  }, objectId => objectId === ids[0]);
  assert.deepEqual(history, {
    checkedObjects: 2,
    reachableObjects: 1,
    allReachable: false,
    personalContentInspected: false,
    objectIdentitiesReported: false,
    secretValuesRecorded: false,
  });
  assert(!JSON.stringify(history).includes(ids[0]));
});

test('license authority fails closed without a strong caller-owned secret', () => {
  const input = { hwFingerprint: '1234567890abcdef', tier: 'PRO' };
  assert.throws(
    () => generateLicenseKey({ ...input, secret: 'too-short' }),
    error => error.code === 'LICENSE_SIGNING_SECRET_REQUIRED',
  );
  const invalid = validateLicenseKey('C3-00', { secret: 'too-short', hwFingerprint: input.hwFingerprint });
  assert.equal(invalid.valid, false);
  assert.equal(invalid.tier, 'FREE');
  const key = generateLicenseKey({ ...input, secret: 'fixture-only-authority-material-32+' });
  assert.equal(validateLicenseKey(key, {
    secret: 'fixture-only-authority-material-32+',
    hwFingerprint: input.hwFingerprint,
  }).valid, true);
});

test('webhook and notification APIs expose environment-only credential persistence', async () => {
  const db = openDb({ 'c3.notif.smtpHost': 'old.invalid' });
  const security = createSecurityRoutes({
    db,
    parseBody: async req => req.body,
    sendJSON: (res, status, payload) => { res.response = { status, payload }; },
    logger: { info() {}, warn() {}, error() {} },
  });
  const local = { socket: { remoteAddress: '127.0.0.1' }, headers: {} };
  const webhookResponse = {};
  security['GET /api/security/webhook-secret'](local, webhookResponse);
  assert.equal(webhookResponse.response.status, 200);
  assert.equal(webhookResponse.response.payload.persistence, 'environment_only');
  assert(!Object.hasOwn(webhookResponse.response.payload, 'masked'));
  const rejectedResponse = {};
  await security['POST /api/security/webhook-secret'](local, rejectedResponse);
  assert.equal(rejectedResponse.response.status, 409);
  assert.equal(rejectedResponse.response.payload.code, 'M5_PRIVACY_WEBHOOK_SECRET_ENV_ONLY');

  const updates = [];
  const notifications = createNotificationRoutes({
    db,
    notificationRouter: {
      channels: new Map(),
      getAvailableChannels: () => [],
      updateChannelConfig: (...args) => updates.push(args),
    },
    parseBody: async req => req.body,
    sendJSON: (res, status, payload) => { res.response = { status, payload }; },
  });
  const notificationResponse = {};
  await notifications['POST /api/notifications/config']({
    body: { smtpHost: 'new.invalid', smtpPass: CANARY },
  }, notificationResponse);
  assert.equal(notificationResponse.response.status, 400);
  assert.equal(notificationResponse.response.payload.code, 'M5_PRIVACY_SMTP_CREDENTIAL_ENV_ONLY');
  const stored = db.prepare('SELECT data FROM user_settings WHERE id = 1').get().data;
  assert(!stored.includes(CANARY));
  assert(!Object.hasOwn(JSON.parse(stored), 'c3.notif.smtpPass'));
  assert.equal(updates.length, 0);

  const acceptedResponse = {};
  await notifications['POST /api/notifications/config']({
    body: { smtpHost: 'new.invalid' },
  }, acceptedResponse);
  assert.equal(acceptedResponse.response.status, 200);
  assert.equal(acceptedResponse.response.payload.credentialPersistence, 'environment_only');
  assert.equal(updates[0][1].pass, process.env.C3_SMTP_PASS);
  db.close();
});
