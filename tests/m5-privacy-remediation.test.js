import './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import Database from 'better-sqlite3';

import {
  SIGNED_AUTHORITY_ALGORITHM,
  SIGNED_AUTHORITY_DOMAIN,
  SIGNED_AUTHORITY_RECEIPT_CONTRACT,
  SIGNED_AUTHORITY_ROLE,
  canonicalizeSignedAuthorityValue,
  computeSignedAuthorityReceiptId,
  signedAuthoritySigningBytes,
} from '../contracts/authority/signed-authority-receipt-v1.js';
import {
  M5_PRIVACY_HISTORY_ACTION,
  M5_PRIVACY_HISTORY_DECISIONS,
  M5_PRIVACY_REPOSITORY_VISIBILITY,
  M5_PRIVACY_ROTATION_CATEGORIES,
  canonicalizeM5PrivacyValue,
  createM5PrivacyRotationReceipt,
} from '../contracts/m5/privacy-remediation-v1.js';
import {
  M5_DISTRIBUTION_MANIFEST_DIGEST,
} from '../contracts/m5/distribution-manifest-v1.js';
import {
  M5_SIGNED_PRIVACY_PAYLOAD,
} from '../contracts/m5/signed-privacy-receipts-v1.js';
import {
  EXPECTED_M5_PRIVACY_AUTHORITY_FINGERPRINT_V090,
  computeM5PrivacyAuthorityFingerprintV090,
  up as applyPrivacyAuthority,
} from '../src/db/migrations/2026_08_26_090_m5_privacy_authority.js';
import {
  EXPECTED_M5_PRIVACY_WRITER_AUTHORITY_FINGERPRINT_V091,
  computeM5PrivacyWriterAuthorityFingerprintV091,
  up as applyPrivacyWriterAuthority,
} from '../src/db/migrations/2026_08_26_091_m5_privacy_writer_authority.js';
import {
  EXPECTED_SIGNED_PRIVACY_RECEIPTS_FINGERPRINT_V100,
  computeSignedPrivacyReceiptsFingerprintV100,
  up as applySignedPrivacyReceipts,
} from '../src/db/migrations/2026_08_28_100_signed_privacy_receipts.js';
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
import * as globalAuthModule from '../src/security/global-auth-policy.js';
import { createGlobalAuthAuthority } from '../src/security/global-auth-policy.js';
import { signedAuthorityKeyId } from '../src/security/signed-authority-verifier.js';
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
const LOCAL_CAPABILITY = 'A'.repeat(43);
const TRANSPORT_AUTHORITY = createGlobalAuthAuthority({
  localCapability: LOCAL_CAPABILITY,
  production: true,
});
const SUBJECT = TRANSPORT_AUTHORITY.authorize({
  routeKey: 'POST /api/security/privacy/rotations/:categoryId/attest',
  websocketLocalCapability: LOCAL_CAPABILITY,
}).subject;
const CANARY = 'm5-private-canary-value-never-emit';

const { privateKey: PRIVACY_FIXTURE_PRIVATE_KEY, publicKey: privacyFixturePublicKey } =
  generateKeyPairSync('ed25519');
const privacyFixtureSpki = privacyFixturePublicKey.export({ format: 'der', type: 'spki' });
const PRIVACY_FIXTURE_KEY_ID = signedAuthorityKeyId(privacyFixturePublicKey);
const PRIVACY_TRUST_STORE = Object.freeze({
  contract: 'SignedAuthorityTrustStore',
  version: 1,
  algorithm: SIGNED_AUTHORITY_ALGORITHM,
  keys: [{
    algorithm: SIGNED_AUTHORITY_ALGORITHM,
    authorityId: SIGNED_AUTHORITY_ROLE.M5_PRIVACY_OPERATOR,
    keyId: PRIVACY_FIXTURE_KEY_ID,
    publicKeySpkiDerBase64url: privacyFixtureSpki.toString('base64url'),
    status: 'ACTIVE',
  }],
});
const EXPECTED_BINDINGS = Object.freeze({
  productCandidateSha: 'a'.repeat(40),
  productCandidateTree: 'b'.repeat(40),
  evidenceHeadSha: 'c'.repeat(40),
  registryFingerprint: 'd'.repeat(64),
  releaseEvidenceIndexSha256: `sha256:${'e'.repeat(64)}`,
  artifactManifestSha256: `sha256:${'f'.repeat(64)}`,
});

function digest(label) {
  return `sha256:${createHash('sha256').update(label, 'utf8').digest('hex')}`;
}

function signPrivacyReceipt({
  domain,
  decision,
  payload,
  artifacts,
  previousReceiptId,
  nonceByte,
  privateKey = PRIVACY_FIXTURE_PRIVATE_KEY,
  keyId = PRIVACY_FIXTURE_KEY_ID,
}) {
  const receipt = {
    contract: SIGNED_AUTHORITY_RECEIPT_CONTRACT,
    version: 1,
    algorithm: SIGNED_AUTHORITY_ALGORITHM,
    domain,
    authorityId: SIGNED_AUTHORITY_ROLE.M5_PRIVACY_OPERATOR,
    keyId,
    ...EXPECTED_BINDINGS,
    artifacts,
    decision,
    issuedAtMs: NOW + nonceByte,
    nonce: Buffer.alloc(16, nonceByte).toString('base64url'),
    previousReceiptId,
    actor: { actorType: 'user', actorId: 'fixture:privacy-operator' },
    payload,
  };
  receipt.signature = sign(
    null,
    signedAuthoritySigningBytes(receipt),
    privateKey,
  ).toString('base64url');
  receipt.receiptId = computeSignedAuthorityReceiptId(receipt);
  return receipt;
}

function rotationReceipt(index, previousReceiptId) {
  const category = M5_PRIVACY_ROTATION_CATEGORIES[index];
  const evidenceSha256 = digest(`provider-action:${category.categoryId}`);
  return signPrivacyReceipt({
    domain: SIGNED_AUTHORITY_DOMAIN.M5_PRIVACY_ROTATION,
    decision: 'ROTATION_COMPLETED',
    previousReceiptId,
    nonceByte: index + 1,
    artifacts: [{
      path: `docs/execution/private/provider-action-${category.categoryId}.json`,
      bytes: 128 + index,
      gitMode: '100644',
      sha256: evidenceSha256,
    }],
    payload: {
      contract: M5_SIGNED_PRIVACY_PAYLOAD.ROTATION,
      version: 1,
      incidentId: 'G0-PRIVACY-001',
      categoryId: category.categoryId,
      authorityKind: category.authorityKind,
      operationCompleted: true,
      completedAtMs: NOW - 1,
      providerActionEvidenceSha256: evidenceSha256,
      secretMaterialIncluded: false,
    },
  });
}

function historyReceipt(previousReceiptId) {
  const refCensusSha256 = digest('privacy-ref-census');
  const privacyScanSha256 = digest('privacy-tree-scan');
  return signPrivacyReceipt({
    domain: SIGNED_AUTHORITY_DOMAIN.M5_PRIVACY_HISTORY,
    decision: 'HISTORY_DISPOSITION_COMPLETED',
    previousReceiptId,
    nonceByte: 9,
    artifacts: [
      {
        path: 'docs/execution/private/privacy-ref-census.json',
        bytes: 256,
        gitMode: '100644',
        sha256: refCensusSha256,
      },
      {
        path: 'docs/execution/private/privacy-tree-scan.json',
        bytes: 512,
        gitMode: '100644',
        sha256: privacyScanSha256,
      },
    ],
    payload: {
      contract: M5_SIGNED_PRIVACY_PAYLOAD.HISTORY,
      version: 1,
      incidentId: 'G0-PRIVACY-001',
      disposition: M5_PRIVACY_HISTORY_DECISIONS.RETAIN_AND_ROTATE,
      completedAction: M5_PRIVACY_HISTORY_ACTION.RETAINED,
      repositoryVisibility: M5_PRIVACY_REPOSITORY_VISIBILITY.PRIVATE,
      operationCompleted: true,
      completedAtMs: NOW - 1,
      postDispositionHeadSha: '7'.repeat(40),
      refCensusSha256,
      privacyScanSha256,
      secretMaterialIncluded: false,
    },
  });
}

function rawReceipt(receipt) {
  return `${canonicalizeSignedAuthorityValue(receipt)}\n`;
}

function openDb(settings = {}, { writerAuthority = true, databasePath = ':memory:' } = {}) {
  const db = new Database(databasePath);
  db.exec(`
    CREATE TABLE user_settings (
      id INTEGER PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare('INSERT INTO user_settings (id, data) VALUES (1, ?)').run(JSON.stringify(settings));
  applyPrivacyAuthority(db);
  if (writerAuthority) {
    applyPrivacyWriterAuthority(db);
    applySignedPrivacyReceipts(db);
  }
  return db;
}

function repository(db, { expectedBindings = EXPECTED_BINDINGS, trustStore = PRIVACY_TRUST_STORE } = {}) {
  return new M5PrivacyAuthorityRepository(db, {
    expectedBindings,
    trustStore,
  });
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
  }, { writerAuthority: false });
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
  applyPrivacyWriterAuthority(db);
  assert.equal(
    computeM5PrivacyWriterAuthorityFingerprintV091(db),
    EXPECTED_M5_PRIVACY_WRITER_AUTHORITY_FINGERPRINT_V091,
  );
  applyPrivacyWriterAuthority(db);
  applySignedPrivacyReceipts(db);
  assert.equal(
    computeSignedPrivacyReceiptsFingerprintV100(db),
    EXPECTED_SIGNED_PRIVACY_RECEIPTS_FINGERPRINT_V100,
  );
  applySignedPrivacyReceipts(db);
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

test('privacy UDFs are restored after SQLite close and reopen before settings routes write', async () => {
  const databasePath = `${process.env.C3_DB_PATH}.privacy-restart`;
  const initial = openDb({ retained: true }, { databasePath });
  initial.close();

  const reopened = new Database(databasePath);
  const authority = repository(reopened);
  assert.equal(authority.summary().verdict, 'INCOMPLETE');
  const responses = [];
  const routes = createMiscRoutes({
    db: { db: reopened },
    parseBody: async req => req.body,
    sendJSON: (_res, status, payload) => responses.push({ status, payload }),
    safeError: error => ({ error: error.message }),
    logger: { info() {}, warn() {}, error() {} },
  });
  await routes['POST /api/settings']({ body: { retained: false, language: 'cs' } }, {});
  assert.equal(responses.at(-1).status, 200, JSON.stringify(responses.at(-1)));
  assert.deepEqual(
    JSON.parse(reopened.prepare('SELECT data FROM user_settings WHERE id = 1').get().data),
    { retained: false, language: 'cs' },
  );
  reopened.close();
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

test('remediation remains incomplete until eight signed rotations and signed history are imported', () => {
  const db = openDb();
  const authority = repository(db);
  const initial = authority.summary();
  assert.equal(initial.verdict, 'INCOMPLETE');
  assert.equal(initial.rotationCompleted, 0);
  assert.equal(initial.rotationRequired, 8);
  assert.equal(initial.authorityBindingsVerified, true);

  let previousReceiptId = null;
  for (let index = 0; index < M5_PRIVACY_ROTATION_CATEGORIES.length; index += 1) {
    const receipt = rotationReceipt(index, previousReceiptId);
    authority.importSignedReceipt(rawReceipt(receipt));
    previousReceiptId = receipt.receiptId;
  }
  assert.equal(authority.summary().verdict, 'INCOMPLETE');
  const history = historyReceipt(previousReceiptId);
  authority.importSignedReceipt(rawReceipt(history));
  const complete = authority.summary();
  assert.equal(complete.verdict, 'OPERATOR_REMEDIATION_RECORDED');
  assert.equal(complete.rotationCompleted, 8);
  assert.deepEqual(complete.missingCategoryIds, []);
  assert.equal(complete.secretValuesRecorded, false);
  assert.equal(complete.historyDisposition.receiptId, history.receiptId);
  assert(!JSON.stringify(complete).includes(CANARY));
  db.close();
});

test('undefined or malformed expected bindings cannot create a privacy PASS', () => {
  const db = openDb();
  const undefinedBindings = Object.fromEntries(
    Object.keys(EXPECTED_BINDINGS).map(key => [key, undefined]),
  );
  assert.throws(
    () => repository(db, { expectedBindings: undefinedBindings }),
    /m5-privacy-authority:expected-bindings-invalid/,
  );
  assert.throws(
    () => repository(db, {
      expectedBindings: { ...EXPECTED_BINDINGS, evidenceHeadSha: 'not-a-git-sha' },
    }),
    /m5-privacy-authority:expected-bindings-invalid/,
  );
  db.close();
});

test('application mint is retired and signed import rejects stale bindings, replay and broken order', () => {
  const db = openDb();
  const authority = repository(db);
  expectCode(() => authority.recordRotation({}), M5PrivacyAuthorityErrorCode.OFFLINE_SIGNATURE_REQUIRED);
  expectCode(() => authority.recordHistory({}), M5PrivacyAuthorityErrorCode.OFFLINE_SIGNATURE_REQUIRED);

  const first = rotationReceipt(0, null);
  const stale = structuredClone(first);
  stale.productCandidateSha = '9'.repeat(40);
  stale.signature = sign(null, signedAuthoritySigningBytes(stale), PRIVACY_FIXTURE_PRIVATE_KEY)
    .toString('base64url');
  stale.receiptId = computeSignedAuthorityReceiptId(stale);
  expectCode(
    () => authority.importSignedReceipt(rawReceipt(stale)),
    M5PrivacyAuthorityErrorCode.SIGNED_RECEIPT_INVALID,
  );
  expectCode(
    () => authority.importSignedReceipt(rawReceipt(rotationReceipt(1, null))),
    M5PrivacyAuthorityErrorCode.SIGNED_RECEIPT_INVALID,
  );
  authority.importSignedReceipt(rawReceipt(first));
  expectCode(
    () => authority.importSignedReceipt(rawReceipt(first)),
    M5PrivacyAuthorityErrorCode.SIGNED_RECEIPT_INVALID,
  );
  db.close();
});

test('unsigned legacy rows fail closed even after same-process UDF replacement', () => {
  const db = openDb();
  const legacy = createM5PrivacyRotationReceipt({
    categoryId: 'administrative-api',
    authorityKind: 'local',
    completedAtMs: NOW - 1,
    attestedAtMs: NOW,
    actorId: SUBJECT.actorId,
  });
  db.function('m5_privacy_receipt_writer_authorized_v1', (_receiptId, _recordJson) => 1);
  db.function('m5_privacy_rotation_receipt_valid_v1', _recordJson => 1);
  db.prepare(`
    INSERT INTO m5_privacy_rotation_receipts (
      receipt_id, incident_id, category_id, completed_at_ms,
      attested_at_ms, actor_id, record_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    legacy.receiptId,
    legacy.incidentId,
    legacy.categoryId,
    legacy.completedAtMs,
    legacy.attestedAtMs,
    legacy.actor.actorId,
    canonicalizeM5PrivacyValue(legacy),
  );
  expectCode(
    () => repository(db).summary(),
    M5PrivacyAuthorityErrorCode.UNSIGNED_LEGACY_RECEIPT,
  );
  db.close();
});

test('second SQLite connection and replacement UDF cannot forge a signed privacy verdict', () => {
  const databasePath = `${process.env.C3_DB_PATH}.signed-privacy`;
  const owner = openDb({}, { databasePath });
  owner.close();

  const { privateKey: attackerPrivateKey, publicKey: attackerPublicKey } =
    generateKeyPairSync('ed25519');
  const attackerKeyId = signedAuthorityKeyId(attackerPublicKey);
  const forged = rotationReceipt(0, null);
  forged.keyId = attackerKeyId;
  forged.signature = sign(null, signedAuthoritySigningBytes(forged), attackerPrivateKey)
    .toString('base64url');
  forged.receiptId = computeSignedAuthorityReceiptId(forged);
  const forgedRaw = rawReceipt(forged);

  const attackerConnection = new Database(databasePath);
  attackerConnection.function('signed_authority_receipt_shape_valid_v1', _recordJson => 1);
  attackerConnection.prepare(`
    INSERT INTO m5_signed_privacy_receipts (
      receipt_id, domain, authority_id, issued_at_ms, nonce,
      previous_receipt_id, record_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    forged.receiptId,
    forged.domain,
    forged.authorityId,
    forged.issuedAtMs,
    forged.nonce,
    forged.previousReceiptId,
    forgedRaw,
  );
  attackerConnection.close();

  const reader = new Database(databasePath);
  expectCode(
    () => repository(reader).summary(),
    M5PrivacyAuthorityErrorCode.SIGNED_RECEIPT_INVALID,
  );
  reader.close();
});

test('HTTP attest routes authenticate first and then return typed 410 without reading a body', async () => {
  assert.equal(Object.hasOwn(globalAuthModule, 'authorizeGlobalRequest'), false);
  const db = openDb();
  const harness = routeHarness(repository(db));
  const rotation = harness.routes['POST /api/security/privacy/rotations/:categoryId/attest'];
  await rotation({ body: { [CANARY]: CANARY } }, {}, { categoryId: 'administrative-api' });
  assert.equal(harness.calls.responses.at(-1).status, 403);
  assert.equal(harness.calls.parseBody, 0);

  await rotation({
    authenticatedSubject: SUBJECT,
    body: { [CANARY]: CANARY },
  }, {}, { categoryId: 'administrative-api' });
  const retired = harness.calls.responses.at(-1);
  assert.equal(retired.status, 410);
  assert.equal(retired.payload.code, 'M5_PRIVACY_OFFLINE_SIGNATURE_REQUIRED');
  assert.equal(harness.calls.parseBody, 0);
  assert(!JSON.stringify(retired).includes(CANARY));

  await harness.routes['POST /api/security/privacy/history/attest']({
    authenticatedSubject: SUBJECT,
    body: { [CANARY]: CANARY },
  }, {});
  assert.equal(harness.calls.responses.at(-1).status, 410);
  assert.equal(harness.calls.parseBody, 0);
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
  assert.equal(report.scannedFiles, 2);
  assert.equal(report.contentReadFiles, 1);
  assert.equal(report.distributionManifestDigest, M5_DISTRIBUTION_MANIFEST_DIGEST);
  assert.deepEqual(report.findings, [{
    ruleId: 'M5_PRIVACY_NAMED_SECRET_LITERAL',
    path: 'src/unsafe.js',
    line: 1,
  }]);
  assert.equal(report.secretValuesRecorded, false);
  assert(!JSON.stringify(report).includes(CANARY));
});

test('tree scanner reads every distributed runtime root and detects multiline credentials', () => {
  const paths = [
    'agent-extensions/project-health/agent.json',
    'c3-ide/runtime.js',
    'skills/example.json',
    'specialists/example/index.js',
    'src/multiline.js',
    'tests/not-distributed.js',
  ];
  const reads = [];
  const report = scanM5TrackedTree({
    candidateRevision: 'c'.repeat(40),
    paths,
    readFile: filePath => {
      reads.push(filePath);
      if (filePath === 'src/multiline.js') {
        return Buffer.from([
          'const providerToken = process.env.PROVIDER_TOKEN ??',
          `  '${CANARY}';`,
          'const config = { apiKey:',
          `  '${CANARY}' };`,
        ].join('\n'), 'utf8');
      }
      return Buffer.from('{}\n', 'utf8');
    },
  });
  assert.deepEqual(reads, paths.filter(filePath => filePath !== 'tests/not-distributed.js'));
  assert.equal(report.scannedFiles, paths.length);
  assert.equal(report.contentReadFiles, 5);
  assert.deepEqual(report.findings, [
    {
      ruleId: 'M5_PRIVACY_SECRET_ENV_FALLBACK_LITERAL',
      path: 'src/multiline.js',
      line: 1,
    },
    {
      ruleId: 'M5_PRIVACY_NAMED_SECRET_LITERAL',
      path: 'src/multiline.js',
      line: 3,
    },
  ]);
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
  }, {
    isReachable: objectId => objectId === ids[0],
    declaredRefCount: 3,
    declaredRefDigest: `sha256:${'c'.repeat(64)}`,
  });
  assert.deepEqual(history, {
    checkedObjects: 2,
    reachableObjects: 1,
    unreachableObjects: 1,
    anyReachable: true,
    allReachable: false,
    declaredRefCount: 3,
    declaredRefDigest: `sha256:${'c'.repeat(64)}`,
    declaredDisposition: null,
    verdict: 'HISTORY_REMEDIATION_REQUIRED',
    personalContentInspected: false,
    objectIdentitiesReported: false,
    secretValuesRecorded: false,
  });
  assert(!JSON.stringify(history).includes(ids[0]));
});

test('history reachability classifies dangling objects from refs and declared dispositions', () => {
  const incident = {
    trackedObjectManifest: [
      { gitBlob: 'a'.repeat(40) },
      { gitBlob: 'b'.repeat(40) },
    ],
  };
  const base = {
    declaredRefCount: 2,
    declaredRefDigest: `sha256:${'d'.repeat(64)}`,
  };
  const removedPending = verifyM5PrivacyHistoryReachability(incident, {
    ...base,
    isReachable: () => false,
  });
  assert.equal(removedPending.reachableObjects, 0);
  assert.equal(removedPending.verdict, 'HISTORY_REMOVED_RECEIPT_PENDING');

  const rewritten = verifyM5PrivacyHistoryReachability(incident, {
    ...base,
    isReachable: () => false,
    declaredDisposition: M5_PRIVACY_HISTORY_DECISIONS.REWRITE_AND_ROTATE,
  });
  assert.equal(rewritten.verdict, 'HISTORY_REMOVED_AS_DECLARED');

  const retained = verifyM5PrivacyHistoryReachability(incident, {
    ...base,
    isReachable: () => true,
    declaredDisposition: M5_PRIVACY_HISTORY_DECISIONS.RETAIN_AND_ROTATE,
  });
  assert.equal(retained.verdict, 'HISTORY_RETAINED_AS_DECLARED');

  const mismatch = verifyM5PrivacyHistoryReachability(incident, {
    ...base,
    isReachable: objectId => objectId.startsWith('a'),
    declaredDisposition: M5_PRIVACY_HISTORY_DECISIONS.NEW_ROOT_AND_ROTATE,
  });
  assert.equal(mismatch.verdict, 'HISTORY_DISPOSITION_MISMATCH');
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
