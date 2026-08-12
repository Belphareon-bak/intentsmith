#!/usr/bin/env node

import './helpers/isolated-test-db.js';

import Database from 'better-sqlite3';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import fs, {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import {
  assert,
  assertEqual,
  suite,
  summary,
  testAsync,
} from './harness.js';
import { isolatedTestRuntime } from './helpers/isolated-test-db.js';
import { createMiscRoutes } from '../src/routes/misc.js';
import { createSecurityRoutes } from '../src/routes/security.js';
import { createSystemRoutes } from '../src/routes/system.js';
import {
  readWebhookSecretAuthority,
  requireWebhookSecretAuthority,
  WEBHOOK_SECRET_AUTHORITY_INVALID,
} from '../src/runtime-environment.js';
import { up as migrateModelPolicy } from '../src/db/migrations/2026_08_09_061_model_automation_policy.js';
import { up as migrateUserSettingsRevision } from '../src/db/migrations/2026_08_10_064_user_settings_revision.js';
import {
  createUserSettingsRepository,
  GENERIC_USER_SETTING_PATHS,
  LEGACY_NOTIFICATION_USER_SETTING_PATHS,
  readLegacyNotificationUserSettingsCensus,
  requireLegacyNotificationUserSettingsCensus,
  scrubLegacyNotificationUserSettingsInTransaction,
} from '../src/db/user-settings.js';
import {
  MIGRATION_ACTION,
  NOTIFICATION_AUTHORITY_DECISIONS_SCHEMA,
  applyNotificationAuthorityManifest,
  censusNotificationAuthority,
  finalizeNotificationAuthorityPlan,
} from '../scripts/migrate-notification-authority.js';

const TEST_WEBHOOK_SECRET_AUTHORITY = readWebhookSecretAuthority({
  projectRoot: isolatedTestRuntime.runtime,
  processEnvironment: { C3_WEBHOOK_SECRET: 'ROUTE_AUTHORITY_SECRET_CANARY' },
});

const USER_SETTINGS_SCHEMA = `
  CREATE TABLE user_settings (
    id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`;

const RETIRED_TYPED_NOTIFICATION_KEYS = Object.freeze([
  'c3.notif.emailEnabled',
  'c3.notif.emailOnLifecycle',
  'c3.notif.emailOnWorker',
  'c3.notif.emailRecipient',
  'c3.notif.smtpFrom',
  'c3.notif.smtpHost',
  'c3.notif.smtpPass',
  'c3.notif.smtpPort',
  'c3.notif.smtpUser',
]);

const EXPECTED_LEGACY_NOTIFICATION_USER_SETTING_PATHS = Object.freeze([
  '/notifications/discordWebhook',
  '/notifications/emailAddresses',
  '/notifications/slackChannel',
  '/notifications/slackWebhook',
  '/notifications/smsApiKey',
  '/notifications/smsPhone',
  '/notifications/smsSecret',
  '/notifications/telegramChatId',
  '/notifications/telegramToken',
  '/notifications/webhookUrl',
  'c3.notif.emailEnabled',
  'c3.notif.emailOnLifecycle',
  'c3.notif.emailOnWorker',
  'c3.notif.emailRecipient',
  'c3.notif.smtpFrom',
  'c3.notif.smtpHost',
  'c3.notif.smtpPass',
  'c3.notif.smtpPort',
  'c3.notif.smtpUser',
  'c3.notif.webhookSecret',
  'webhookSecret',
]);

const EXPECTED_GENERIC_USER_SETTING_PATHS = Object.freeze([
  'c3.account.displayName',
  'c3.account.description',
  'c3.account.timezone',
  'c3.account.currency',
  'c3.language',
  'c3.llm.chatModel',
  'c3.llm.codeModel',
  'c3.llm.ollamaUrl',
  'c3.llm.temperature',
  'c3.llm.contextWindow',
  'c3.llm.timeoutChat',
  'c3.llm.timeoutCode',
  'c3.llm.numGpu',
  'c3.memory.conversationMaxTurns',
  'c3.memory.compactThreshold',
  'c3.memory.compactKeepTurns',
  'c3.memory.ltmEnabled',
  'c3.memory.ltmMaxEntries',
  'c3.memory.ltmDecayHalfLife',
  'c3.memory.contextBudgetChat',
  'c3.memory.contextBudgetCode',
  'c3.memory.contextBudgetMaxTokens',
  'c3.memory.learningEnabled',
  'c3.memory.feedbackDetection',
  'c3.memory.patternTracking',
  'c3.notif.desktopEnabled',
  'c3.notif.quietEnabled',
  'c3.notif.quietFrom',
  'c3.notif.quietTo',
  'c3.output.codeBlocks',
  'c3.output.syntaxHighlight',
  'c3.output.markdownRendering',
  'c3.output.maxResponseLength',
  'c3.system.logLevel',
  'c3.system.logRetentionDays',
  'c3.system.maxFileSize',
  'c3.system.rateLimit',
  '/appearance/theme',
  '/appearance/accentColor',
  '/appearance/fontFamily',
  '/appearance/fontSize',
  '/appearance/density',
  '/output/enabledTypes',
  '/output/defaultFormat',
  '/output/codeStyle',
  '/output/namingConvention',
]);

const STALE_ROUTE_WAL_WORKER_SOURCE = String.raw`
const Database = require('better-sqlite3');
const { parentPort, workerData } = require('node:worker_threads');

(async () => {
  const db = new Database(workerData.databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  let response = null;
  let requestBody = null;
  const parseBody = async () => requestBody;
  const sendJSON = (_res, status, body) => { response = { status, body }; };

  try {
    const { createMiscRoutes } = await import(workerData.miscUrl);
    const routes = createMiscRoutes({
      db: { db },
      parseBody,
      sendJSON,
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      callWithAuth: async () => ({}),
      createAuthToken: () => '',
      LLMCallerRole: {},
      featureManager: { applySettings: () => 0, resetToDefaults: () => 0 },
    });
    await routes['GET /api/settings/v2']({}, {});
    if (!response || response.status !== 200) {
      throw new Error('candidate failed to read the versioned settings snapshot');
    }
    const observedRevision = response.body.revision;
    Atomics.store(workerData.barrier, 0, 1);
    Atomics.notify(workerData.barrier, 0);
    while (Atomics.load(workerData.barrier, 1) === 0) {
      Atomics.wait(workerData.barrier, 1, 0, 5000);
    }

    response = null;
    if (workerData.kind === 'generic') {
      requestBody = {
        expectedRevision: observedRevision,
        patch: { 'c3.language': 'en' },
      };
      await routes['PUT /api/settings/v2']({}, {});
    } else {
      requestBody = {
        backup: workerData.backup,
        expectedRevision: observedRevision,
      };
      await routes['POST /api/settings/import']({}, {});
    }
    parentPort.postMessage({ kind: workerData.kind, observedRevision, response });
  } catch (error) {
    parentPort.postMessage({
      kind: 'WORKER_ERROR',
      code: error && error.code || null,
      message: error && error.stack || String(error),
    });
  } finally {
    db.close();
  }
})().catch(error => {
  parentPort.postMessage({
    kind: 'WORKER_ERROR',
    code: error && error.code || null,
    message: error && error.stack || String(error),
  });
});
`;

function openLegacyDb(databasePath = ':memory:') {
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(USER_SETTINGS_SCHEMA);
  return db;
}

function openDb(databasePath = ':memory:') {
  const db = openLegacyDb(databasePath);
  db.transaction(() => migrateUserSettingsRevision(db)).immediate();
  return db;
}

function openPolicyDb(databasePath = ':memory:') {
  const db = openLegacyDb(databasePath);
  db.transaction(() => {
    migrateModelPolicy(db);
    migrateUserSettingsRevision(db);
  }).immediate();
  return db;
}

function readRaw(db) {
  return db.prepare('SELECT data FROM user_settings WHERE id = 1').get()?.data ?? null;
}

function readDocument(db) {
  const raw = readRaw(db);
  return raw === null ? {} : JSON.parse(raw);
}

function readSettingsRow(db) {
  return db.prepare(`
    SELECT id, data, updated_at, revision
    FROM user_settings
    WHERE id = 1
  `).get();
}

function replaceFixtureDocument(db, value) {
  return db.prepare(`
    UPDATE user_settings
    SET data = ?, revision = revision + 1
    WHERE id = 1
  `).run(value);
}

function readRowBytes(db) {
  return db.prepare(`
    SELECT hex(CAST(data AS BLOB)) AS dataHex, revision, updated_at AS updatedAt
    FROM user_settings
    WHERE id = 1
  `).get();
}

function backupEnvelope(overrides = {}) {
  return {
    kind: 'INTENTSMITH_SETTINGS_BACKUP',
    schemaVersion: 2,
    settingsProjection: {
      profile: 'UX_PREFERENCES_V1',
      values: {
        '/appearance/accentColor': '#6366f1',
        '/appearance/fontFamily': 'system',
        '/appearance/fontSize': 14,
        '/appearance/theme': 'light',
        '/c3.language': 'cs',
        '/c3.output.codeBlocks': true,
        '/c3.output.markdownRendering': true,
        '/c3.output.syntaxHighlight': true,
        '/output/codeStyle': 'default',
        '/output/defaultFormat': 'markdown',
        '/output/namingConvention': 'camelCase',
        ...overrides.portableValues,
      },
    },
    modelAutomationPolicy: {
      autoFailoverEnabled: true,
      autoCleanupEnabled: true,
      autoCleanupDays: 30,
      ...overrides.modelAutomationPolicy,
    },
    omissions: {
      strategy: 'DEFAULT_DENY',
      scope: 'GENERAL_SETTINGS',
      excluded: 'ALL_PATHS_NOT_IN_PROFILE',
      sourceHadExcludedPaths: false,
    },
  };
}

function captureError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error('expected operation to fail');
}

function legacyNotificationFixtureDocument() {
  return {
    webhookSecret: 'TOP_LEVEL_WEBHOOK_SECRET_CANARY',
    'c3.notif.webhookSecret': 'DOTTED_WEBHOOK_SECRET_CANARY',
    'c3.notif.emailEnabled': true,
    'c3.notif.emailOnLifecycle': false,
    'c3.notif.emailOnWorker': true,
    'c3.notif.emailRecipient': 'legacy-recipient@example.invalid',
    'c3.notif.smtpFrom': 'legacy-from@example.invalid',
    'c3.notif.smtpHost': 'legacy-smtp.invalid',
    'c3.notif.smtpPass': 'LEGACY_SMTP_SECRET_CANARY',
    'c3.notif.smtpPort': 2525,
    'c3.notif.smtpUser': 'legacy-user',
    'c3.notif.desktopEnabled': true,
    'c3.notif.quietEnabled': true,
    'c3.notif.quietFrom': '22:00',
    'c3.notif.quietTo': '07:00',
    'c3.notif.futureSecret': 'UNOWNED_NOTIFICATION_CANARY',
    notifications: {
      discordWebhook: 'https://discord.invalid/LEGACY_DISCORD_CANARY',
      emailAddresses: ['one@example.invalid', 'two@example.invalid'],
      slackChannel: 'legacy-slack-channel',
      slackWebhook: 'https://slack.invalid/LEGACY_SLACK_CANARY',
      smsApiKey: 'LEGACY_SMS_API_CANARY',
      smsPhone: '+420000000000',
      smsSecret: 'LEGACY_SMS_SECRET_CANARY',
      telegramChatId: 'legacy-telegram-chat',
      telegramToken: 'LEGACY_TELEGRAM_TOKEN_CANARY',
      webhookUrl: 'https://webhook.invalid/LEGACY_DESTINATION_CANARY',
      enabled: true,
      unknownNested: { preserve: 'exactly' },
    },
    appearance: { theme: 'dark' },
    storage: { root: '/private/device/path' },
    futurePrivate: { preserve: true },
  };
}

function copyScrubRequest(request, overrides = {}) {
  return {
    expectedRevision: request.expectedRevision,
    pathDigests: request.pathDigests.map(entry => ({ ...entry })),
    postimageSha256: request.postimageSha256,
    preimageSha256: request.preimageSha256,
    ...overrides,
  };
}

function runLegacyNotificationScrub(db, request) {
  return db.transaction(
    () => scrubLegacyNotificationUserSettingsInTransaction(db, request),
  ).immediate();
}

function oracleSha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function write0600(filePath, bytes) {
  writeFileSync(filePath, bytes, { mode: 0o600 });
  chmodSync(filePath, 0o600);
}

function createMigrationFixture(name, {
  document = {},
  setup = null,
  paiass = null,
  historicalEnvironment = null,
} = {}) {
  const root = mkdtempSync(path.join(isolatedTestRuntime.artifacts, `${name}-`));
  const databasePath = path.join(root, 'c3.sqlite');
  const db = openDb(databasePath);
  replaceFixtureDocument(db, JSON.stringify(document));
  db.close();
  if (setup !== null) write0600(path.join(root, 'c3-setup.json'), JSON.stringify(setup));
  let paiassInputPath = null;
  if (paiass !== null) {
    paiassInputPath = path.join(root, 'paiass-settings.json');
    write0600(paiassInputPath, JSON.stringify(paiass));
  }
  const historicalEnvironmentPaths = [];
  if (historicalEnvironment !== null) {
    const historicalRoot = mkdtempSync(path.join(root, 'historical-'));
    const historicalPath = path.join(historicalRoot, '.env');
    write0600(historicalPath, historicalEnvironment);
    historicalEnvironmentPaths.push(historicalPath);
  }
  return {
    root,
    databasePath,
    dataDir: root,
    paiassInputPath,
    historicalEnvironmentPaths,
    decisionsPath: path.join(root, 'decisions.json'),
    manifestPath: path.join(root, 'manifest.json'),
  };
}

function assertIsolatedMigrationCensus(census, { processPaths = [] } = {}) {
  const rootSourceIds = new Set(
    census.sources
      .filter(source => source.kind === 'ENV' && source.role === 'ROOT')
      .map(source => source.sourceId),
  );
  assertEqual(census.findings.filter(finding => rootSourceIds.has(finding.sourceId)).length, 0);
  assertEqual(
    JSON.stringify(census.findings
      .filter(finding => finding.sourceId === 'PROCESS_ENV')
      .map(finding => finding.path)),
    JSON.stringify(processPaths),
  );
}

function finalizeMigrationFixture(fixture, chooseAction, { processPaths = [] } = {}) {
  const census = censusNotificationAuthority({
    databasePath: fixture.databasePath,
    dataDir: fixture.dataDir,
    historicalEnvironmentPaths: fixture.historicalEnvironmentPaths,
    paiassInputPath: fixture.paiassInputPath,
  });
  assertIsolatedMigrationCensus(census, { processPaths });
  const actions = census.findings.map(finding => ({
    sourceId: finding.sourceId,
    path: finding.path,
    valueSha256: finding.valueSha256,
    ...chooseAction(finding, census),
  }));
  const decisions = {
    schema: NOTIFICATION_AUTHORITY_DECISIONS_SCHEMA,
    censusSha256: census.censusSha256,
    actions,
  };
  const decisionsBytes = Buffer.from(`${JSON.stringify(decisions, null, 2)}\n`, 'utf8');
  write0600(fixture.decisionsPath, decisionsBytes);
  const plan = finalizeNotificationAuthorityPlan({
    decisionsPath: fixture.decisionsPath,
    decisionsSha256: oracleSha256(decisionsBytes),
    manifestPath: fixture.manifestPath,
    databasePath: fixture.databasePath,
    dataDir: fixture.dataDir,
    historicalEnvironmentPaths: fixture.historicalEnvironmentPaths,
    paiassInputPath: fixture.paiassInputPath,
  });
  return { census, decisions, plan };
}

function applyMigrationFixture(fixture, plan, manifestPath = fixture.manifestPath) {
  const manifestBytes = readFileSync(manifestPath);
  if (manifestPath === fixture.manifestPath) {
    assertEqual(oracleSha256(manifestBytes), plan.manifestSha256);
  }
  return applyNotificationAuthorityManifest({
    manifestPath,
    manifestSha256: oracleSha256(manifestBytes),
    attestServerStopped: true,
    attestWorkersStopped: true,
    expectedDatabasePath: fixture.databasePath,
    expectedDataDir: fixture.dataDir,
    expectedHistoricalEnvironmentPaths: fixture.historicalEnvironmentPaths,
    expectedPaiassInputPath: fixture.paiassInputPath,
  });
}

function errorFromMigrationApply(callback) {
  const error = captureError(callback);
  assert(error && typeof error.code === 'string');
  return error;
}

function exerciseNotificationMigrationCli() {
  const fixtures = [];
  const previousEmailFrom = process.env.EMAIL_FROM;
  const hadEmailFrom = Object.hasOwn(process.env, 'EMAIL_FROM');
  const previousSmtpPort = process.env.C3_SMTP_PORT;
  const hadSmtpPort = Object.hasOwn(process.env, 'C3_SMTP_PORT');
  const restoreProcessEnvironment = () => {
    if (hadEmailFrom) process.env.EMAIL_FROM = previousEmailFrom;
    else delete process.env.EMAIL_FROM;
    if (hadSmtpPort) process.env.C3_SMTP_PORT = previousSmtpPort;
    else delete process.env.C3_SMTP_PORT;
  };

  try {
    process.env.EMAIL_FROM = 'PROCESS_ALIAS_RESTART_CANARY';
    process.env.C3_SMTP_PORT = '2525';
    const full = createMigrationFixture('notification-migration-full', {
      document: {
        'c3.notif.smtpHost': 'DB_EXPORT_SECRET_CANARY',
        'c3.notif.smtpPort': 2525,
        'c3.notif.desktopEnabled': true,
        futurePrivate: { preserve: true },
      },
      setup: {
        notifications: { email: { to: 'setup@example.invalid' } },
        foreign: { preserve: true },
      },
      historicalEnvironment: 'C3_SMTP_USER=HISTORICAL_EXPORT_SECRET_CANARY\nFOREIGN=value\n',
      paiass: {
        notifications: {
          emailAddresses: ['paiass@example.invalid'],
          unknown: 'preserve',
        },
        foreign: true,
      },
    });
    fixtures.push(full);
    const dbExportPath = path.join(full.root, 'db-export.json');
    const envExportPath = path.join(full.root, 'env-export.json');
    const fullPlan = finalizeMigrationFixture(full, finding => {
      if (finding.path === 'c3.notif.smtpPort') {
        const canonicalValue = '2525';
        return {
          action: MIGRATION_ACTION.TRANSFER,
          canonicalValue,
          canonicalValueSha256: oracleSha256(Buffer.from(JSON.stringify(canonicalValue))),
        };
      }
      if (finding.path === 'c3.notif.smtpHost') {
        return { action: MIGRATION_ACTION.EXPORT, exportPath: dbExportPath };
      }
      if (finding.path === 'C3_SMTP_USER') {
        return { action: MIGRATION_ACTION.EXPORT, exportPath: envExportPath };
      }
      return { action: MIGRATION_ACTION.PURGE };
    }, { processPaths: ['EMAIL_FROM'] });
    const smtpTarget = fullPlan.census.targets.find(target => target.key === 'C3_SMTP_PORT');
    assertEqual(smtpTarget.processPresent, true, 'smtp target must observe own process authority');
    assertEqual(
      smtpTarget.processValueSha256,
      oracleSha256(Buffer.from(JSON.stringify('2525'))),
    );
    assertEqual(fullPlan.plan.status, 'MANIFEST_READY');
    assertEqual(fullPlan.plan.actionCounts.TRANSFER, 1);

    const blocked = applyMigrationFixture(full, fullPlan.plan);
    assertEqual(blocked.status, 'BLOCKED_RESTART_REQUIRED');
    assertEqual(blocked.stages.find(stage => stage.kind === 'PROCESS_ENV').status,
      'BLOCKED_RESTART_REQUIRED');
    assertEqual(blocked.remainingStages[0].kind, 'PROCESS_ENV');
    assertEqual(blocked.exports.length, 2);
    assertEqual(JSON.stringify(blocked).includes('SECRET_CANARY'), false);

    delete process.env.EMAIL_FROM;
    const applied = applyMigrationFixture(full, fullPlan.plan);
    assertEqual(applied.status, 'RECEIPTS_READY');
    assertEqual(applied.remainingStages.length, 0);
    assertEqual(applied.stages.find(stage => stage.kind === 'PROCESS_ENV').status,
      'ABSENCE_CONFIRMED');
    assertEqual(applied.paiassStatus, 'RECEIPTS_READY');
    const firstReceipts = JSON.stringify(applied.receipts);

    const samePlanRetry = applyMigrationFixture(full, fullPlan.plan);
    assertEqual(samePlanRetry.status, 'RECEIPTS_READY');
    assertEqual(JSON.stringify(samePlanRetry.receipts), firstReceipts);
    assertEqual(
      samePlanRetry.stages.find(stage => stage.kind === 'CANONICAL_TRANSFER').status,
      'ALREADY_APPLIED',
    );
    assertEqual(
      samePlanRetry.exports.every(entry => entry.changed === false),
      true,
      'same-plan retry must not republish verified exports',
    );

    const paiassPostimage = JSON.parse(readFileSync(full.paiassInputPath, 'utf8'));
    delete paiassPostimage.notifications.emailAddresses;
    write0600(full.paiassInputPath, JSON.stringify(paiassPostimage));
    const completed = applyMigrationFixture(full, fullPlan.plan);
    assertEqual(completed.status, 'APPLIED');
    assertEqual(completed.paiassStatus, 'ALREADY_APPLIED');
    assertEqual(JSON.stringify(completed.receipts), firstReceipts);
    const committed = new Database(full.databasePath, { readonly: true });
    try {
      const committedDocument = JSON.parse(
        committed.prepare('SELECT data FROM user_settings WHERE id = 1').get().data,
      );
      assertEqual(committedDocument['c3.notif.smtpPort'], undefined);
      assertEqual(
        committedDocument['c3.notif.desktopEnabled'],
        true,
        'DB scrub must preserve the safe desktop preference',
      );
      assertEqual(
        committedDocument.futurePrivate.preserve,
        true,
        'DB scrub must preserve unknown future data',
      );
    } finally {
      committed.close();
    }

    for (const [kind, expectedCode] of [
      ['DB', 'MIGRATION_DATABASE_POSTIMAGE_STALE'],
      ['SETUP', 'MIGRATION_SETUP_POSTIMAGE_STALE'],
      ['PAIASS_SETTINGS', 'MIGRATION_PAIASS_POSTIMAGE_STALE'],
    ]) {
      const stale = createMigrationFixture(`notification-migration-stale-${kind.toLowerCase()}`, {
        document: kind === 'DB' ? { 'c3.notif.smtpHost': 'DB_STALE_CANARY' } : {},
        setup: kind === 'SETUP'
          ? { notifications: { email: { to: 'setup-stale@example.invalid' } } }
          : null,
        paiass: kind === 'PAIASS_SETTINGS'
          ? { notifications: { emailAddresses: ['paiass-stale@example.invalid'] } }
          : null,
      });
      fixtures.push(stale);
      const stalePlan = finalizeMigrationFixture(
        stale,
        () => ({ action: MIGRATION_ACTION.PURGE }),
      );
      const tampered = JSON.parse(readFileSync(stale.manifestPath, 'utf8'));
      const source = tampered.sources.find(candidate => candidate.kind === kind);
      source.postimageSha256 = source.preimageSha256;
      if (kind === 'PAIASS_SETTINGS') {
        tampered.paiassReceipts.at(-1).postimageSha256 = source.preimageSha256;
      }
      const tamperedPath = path.join(stale.root, 'false-postimage-manifest.json');
      write0600(tamperedPath, `${JSON.stringify(tampered, null, 2)}\n`);
      const staleError = errorFromMigrationApply(
        () => applyMigrationFixture(stale, stalePlan.plan, tamperedPath),
      );
      assertEqual(staleError.code, expectedCode);
      assertEqual(JSON.stringify(staleError.report).includes('CANARY'), false);
    }

    const partial = createMigrationFixture('notification-migration-partial-export', {
      document: {
        'c3.notif.smtpHost': 'FIRST_EXPORT_SECRET_CANARY',
        'c3.notif.smtpUser': 'SECOND_EXPORT_SECRET_CANARY',
      },
    });
    fixtures.push(partial);
    const firstExportPath = path.join(partial.root, 'first-export.json');
    const secondExportPath = path.join(partial.root, 'second-export.json');
    const partialPlan = finalizeMigrationFixture(partial, finding => ({
      action: MIGRATION_ACTION.EXPORT,
      exportPath: finding.path === 'c3.notif.smtpHost' ? firstExportPath : secondExportPath,
    }));
    write0600(secondExportPath, '"conflicting-export"');
    const partialError = errorFromMigrationApply(
      () => applyMigrationFixture(partial, partialPlan.plan),
    );
    assertEqual(partialError.code, 'MIGRATION_EXPORT_CONFLICT');
    assertEqual(partialError.report.stages.some(stage => (
      stage.kind === 'EXPORT' && stage.path === 'c3.notif.smtpHost' && stage.status === 'APPLIED'
    )), true);
    assertEqual(partialError.report.stages.at(-1).status, 'FAILED');
    assertEqual(partialError.report.remainingStages[0].path, 'c3.notif.smtpUser');
    assertEqual(JSON.stringify(partialError.report).includes('SECRET_CANARY'), false);

    const earlyWrite = createMigrationFixture('notification-migration-write-failure', {
      document: { 'c3.notif.smtpHost': 'EARLY_WRITE_SECRET_CANARY' },
    });
    fixtures.push(earlyWrite);
    const earlyExportPath = path.join(earlyWrite.root, 'early-export.json');
    const earlyPlan = finalizeMigrationFixture(earlyWrite, () => ({
      action: MIGRATION_ACTION.EXPORT,
      exportPath: earlyExportPath,
    }));
    const originalWriteFileSync = fs.writeFileSync;
    fs.writeFileSync = (...args) => {
      if (typeof args[0] === 'number') {
        const error = new Error('TEST_EARLY_DESCRIPTOR_WRITE_FAILURE');
        error.code = 'EIO';
        throw error;
      }
      return originalWriteFileSync(...args);
    };
    let earlyError;
    try {
      earlyError = errorFromMigrationApply(
        () => applyMigrationFixture(earlyWrite, earlyPlan.plan),
      );
    } finally {
      fs.writeFileSync = originalWriteFileSync;
    }
    assertEqual(earlyError.code, 'MIGRATION_EXPORT_WRITE_FAILED');
    assertEqual(
      readdirSync(earlyWrite.root).some(name => name.includes('.notification-export-')),
      false,
    );

    const replacement = createMigrationFixture('notification-migration-replacement', {
      document: { 'c3.notif.smtpHost': 'REPLACEMENT_SECRET_CANARY' },
    });
    fixtures.push(replacement);
    const replacementExportPath = path.join(replacement.root, 'replacement-export.json');
    const replacementPlan = finalizeMigrationFixture(replacement, () => ({
      action: MIGRATION_ACTION.EXPORT,
      exportPath: replacementExportPath,
    }));
    const originalLinkSync = fs.linkSync;
    fs.linkSync = (sourcePath, targetPath) => {
      if (targetPath === replacementExportPath) {
        fs.unlinkSync(sourcePath);
        originalWriteFileSync(sourcePath, '"replacement"', { mode: 0o600 });
        chmodSync(sourcePath, 0o600);
      }
      return originalLinkSync(sourcePath, targetPath);
    };
    let replacementError;
    try {
      replacementError = errorFromMigrationApply(
        () => applyMigrationFixture(replacement, replacementPlan.plan),
      );
    } finally {
      fs.linkSync = originalLinkSync;
    }
    assertEqual(replacementError.code, 'MIGRATION_EXPORT_PUBLICATION_UNKNOWN');
    assertEqual(replacementError.report.stages.at(-1).status, 'PUBLICATION_UNKNOWN');

    const resumed = createMigrationFixture('notification-migration-resumed-ledger', {
      document: { 'c3.notif.smtpHost': 'DB_PROGRESS_SECRET_CANARY' },
      setup: { notifications: { email: { to: 'setup-progress@example.invalid' } } },
    });
    fixtures.push(resumed);
    const resumedPlan = finalizeMigrationFixture(
      resumed,
      () => ({ action: MIGRATION_ACTION.PURGE }),
    );
    const originalRenameSync = fs.renameSync;
    fs.renameSync = (sourcePath, targetPath) => {
      if (targetPath === path.join(resumed.root, 'c3-setup.json')) {
        const error = new Error('TEST_SETUP_RENAME_FAILURE');
        error.code = 'EIO';
        throw error;
      }
      return originalRenameSync(sourcePath, targetPath);
    };
    let resumedError;
    try {
      resumedError = errorFromMigrationApply(
        () => applyMigrationFixture(resumed, resumedPlan.plan),
      );
    } finally {
      fs.renameSync = originalRenameSync;
    }
    assertEqual(resumedError.report.stages.some(stage => (
      stage.kind === 'DB' && stage.status === 'APPLIED'
    )), true);
    assertEqual(resumedError.report.stages.at(-1).kind, 'SETUP');
    assertEqual(resumedError.report.stages.at(-1).status, 'FAILED');
    assertEqual(resumedError.report.remainingStages[0].kind, 'SETUP');
    const resumedRetry = applyMigrationFixture(resumed, resumedPlan.plan);
    assertEqual(resumedRetry.stages.find(stage => stage.kind === 'DB').status,
      'ALREADY_APPLIED');
    assertEqual(resumedRetry.remainingStages.length, 0);
  } finally {
    restoreProcessEnvironment();
    for (const fixture of fixtures.reverse()) {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
}

function legacyPathValueForOracle(document, pathId) {
  if (!pathId.startsWith('/')) return document[pathId];
  return pathId.slice(1).split('/').reduce((value, segment) => value[segment], document);
}

function deleteLegacyPathForOracle(document, pathId) {
  if (!pathId.startsWith('/')) {
    delete document[pathId];
    return;
  }
  const segments = pathId.slice(1).split('/');
  const leaf = segments.pop();
  const parent = segments.reduce((value, segment) => value[segment], document);
  delete parent[leaf];
}

function createRouteHarness(db, {
  webhookSecretAuthority = TEST_WEBHOOK_SECRET_AUTHORITY,
  webhookSecretAuthorityValidator = requireWebhookSecretAuthority,
} = {}) {
  let requestBody = {};
  let parseFailure = null;
  let parseCount = 0;
  let genericResponse = null;
  let securityResponse = null;
  let systemResponse = null;
  let featureDocument = null;

  const miscRoutes = createMiscRoutes({
    db: { db },
    parseBody: async () => {
      parseCount += 1;
      if (parseFailure) throw parseFailure;
      return requestBody;
    },
    sendJSON: (_res, status, body) => { genericResponse = { status, body }; },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    callWithAuth: async () => ({}),
    createAuthToken: () => '',
    LLMCallerRole: {},
    featureManager: {
      applySettings(document) {
        featureDocument = document;
        return 0;
      },
      resetToDefaults() {
        return 0;
      },
    },
  });
  const systemRoutes = createSystemRoutes({
    db: { db },
    parseBody: async () => {
      parseCount += 1;
      if (parseFailure) throw parseFailure;
      return requestBody;
    },
    sendJSON: (_res, status, body) => { systemResponse = { status, body }; },
    modelRegistry: {},
    broadcastValidation() {},
  });
  const securityRoutes = createSecurityRoutes({
    db: { db },
    parseBody: async () => {
      parseCount += 1;
      if (parseFailure) throw parseFailure;
      return requestBody;
    },
    sendJSON: (_res, status, body) => { securityResponse = { status, body }; },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    webhookSecretAuthority,
    requireWebhookSecretAuthority: webhookSecretAuthorityValidator,
  });

  return {
    get parseCount() { return parseCount; },
    async postLegacy(body, options = {}) {
      requestBody = body;
      parseFailure = options.parseFailure || null;
      genericResponse = null;
      featureDocument = null;
      await miscRoutes['POST /api/settings']({}, {});
      parseFailure = null;
      return { response: genericResponse, featureDocument };
    },
    async getLegacy() {
      genericResponse = null;
      await miscRoutes['GET /api/settings']({}, {});
      return genericResponse;
    },
    async getV2() {
      genericResponse = null;
      await miscRoutes['GET /api/settings/v2']({}, {});
      return genericResponse;
    },
    async putV2(body, options = {}) {
      requestBody = body;
      parseFailure = options.parseFailure || null;
      genericResponse = null;
      featureDocument = null;
      await miscRoutes['PUT /api/settings/v2']({}, {});
      parseFailure = null;
      return { response: genericResponse, featureDocument };
    },
    async postImport(body, options = {}) {
      requestBody = body;
      parseFailure = options.parseFailure || null;
      genericResponse = null;
      await miscRoutes['POST /api/settings/import']({}, {});
      parseFailure = null;
      return genericResponse;
    },
    async postReset(body) {
      requestBody = body ?? {
        scope: 'SERVER_SETTINGS_V1',
        expectedRevision: readSettingsRow(db).revision,
        expectedPolicyRevision: db.prepare(
          'SELECT revision FROM model_automation_policy WHERE id = 1',
        ).get().revision,
      };
      genericResponse = null;
      await miscRoutes['POST /api/settings/reset']({}, {});
      return genericResponse;
    },
    async putStorage(body) {
      requestBody = body;
      parseFailure = null;
      systemResponse = null;
      await systemRoutes['PUT /api/system/storage/settings']({}, {});
      return systemResponse;
    },
    async getWebhookSecret(request = {
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
    }) {
      securityResponse = null;
      await securityRoutes['GET /api/security/webhook-secret'](request, {});
      return securityResponse;
    },
    async postWebhookSecret({
      request = {
        headers: {},
        socket: { remoteAddress: '127.0.0.1' },
      },
      parseError = null,
    } = {}) {
      parseFailure = parseError;
      securityResponse = null;
      try {
        await securityRoutes['POST /api/security/webhook-secret'](request, {});
        return securityResponse;
      } finally {
        parseFailure = null;
      }
    },
  };
}

function startStaleRouteWorker(workerData) {
  const worker = new Worker(STALE_ROUTE_WAL_WORKER_SOURCE, {
    eval: true,
    workerData,
  });
  const result = new Promise((resolve, reject) => {
    worker.once('message', message => {
      if (message.kind === 'WORKER_ERROR') {
        reject(new Error(message.message));
      } else {
        resolve(message);
      }
    });
    worker.once('error', reject);
    worker.once('exit', code => {
      if (code !== 0) reject(new Error(`route WAL worker exited ${code}`));
    });
  });
  return { worker, result };
}

suite('M1 settings notification authority — route-level data integrity');

await testAsync('migration guard and exact legacy notification scrub preserve the singleton', async () => {
  const preservedDb = openLegacyDb();
  try {
    const original = ' {"duplicate":1,"duplicate":2,"sentinel":"raw-bytes"} ';
    preservedDb.prepare(`
      INSERT INTO user_settings (id, data, updated_at)
      VALUES (1, ?, '2026-08-11 00:00:00')
    `).run(original);
    const before = preservedDb.prepare(`
      SELECT hex(CAST(data AS BLOB)) AS data_hex, updated_at
      FROM user_settings WHERE id = 1
    `).get();
    preservedDb.transaction(() => migrateUserSettingsRevision(preservedDb)).immediate();
    const migrated = readSettingsRow(preservedDb);
    assertEqual(migrated.revision, 1);
    assertEqual(
      preservedDb.prepare('SELECT hex(CAST(data AS BLOB)) AS value FROM user_settings WHERE id=1').get().value,
      before.data_hex,
    );
    assertEqual(migrated.updated_at, before.updated_at);

    for (const [operation, expectedPrefix] of [
      [() => preservedDb.prepare("INSERT INTO user_settings (id,data,revision) VALUES (2,'{}',1)").run(), 'USER_SETTINGS_INSERT_FORBIDDEN:'],
      [() => preservedDb.prepare("INSERT OR REPLACE INTO user_settings (id,data,revision) VALUES (1,'{}',1)").run(), 'USER_SETTINGS_INSERT_FORBIDDEN:'],
      [() => preservedDb.prepare('DELETE FROM user_settings WHERE id=1').run(), 'USER_SETTINGS_DELETE_FORBIDDEN:'],
      [() => preservedDb.prepare("UPDATE user_settings SET data='{}' WHERE id=1").run(), 'USER_SETTINGS_REVISION_MISMATCH:'],
      [() => preservedDb.prepare("UPDATE user_settings SET data='{}', revision=revision+2 WHERE id=1").run(), 'USER_SETTINGS_REVISION_MISMATCH:'],
      [() => preservedDb.prepare("UPDATE user_settings SET id=2, data='{}', revision=revision+1 WHERE id=1").run(), 'USER_SETTINGS_REVISION_MISMATCH:'],
    ]) {
      const error = captureError(operation);
      assert(error.message.startsWith(expectedPrefix));
      assertEqual(readSettingsRow(preservedDb).revision, 1);
      assertEqual(readSettingsRow(preservedDb).data, original);
    }
    const committed = preservedDb.prepare(`
      UPDATE user_settings
      SET data='{"committed":true}', revision=revision+1
      WHERE id=1 AND revision=1
    `).run();
    assertEqual(committed.changes, 1);
    assertEqual(readSettingsRow(preservedDb).revision, 2);
  } finally {
    preservedDb.close();
  }

  const seededDb = openLegacyDb();
  try {
    seededDb.transaction(() => migrateUserSettingsRevision(seededDb)).immediate();
    const seeded = readSettingsRow(seededDb);
    assertEqual(seeded.data, '{}');
    assertEqual(seeded.revision, 1);
  } finally {
    seededDb.close();
  }

  const invalidDb = openLegacyDb();
  try {
    invalidDb.prepare("INSERT INTO user_settings (id,data) VALUES (2,'{}')").run();
    const error = captureError(
      () => invalidDb.transaction(() => migrateUserSettingsRevision(invalidDb)).immediate(),
    );
    assert(error.message.startsWith('USER_SETTINGS_REVISION_MIGRATION_INVALID:'));
    assertEqual(
      invalidDb.prepare('PRAGMA table_info(user_settings)').all().some(row => row.name === 'revision'),
      false,
    );
  } finally {
    invalidDb.close();
  }

  const foreignTriggerDb = openLegacyDb();
  try {
    foreignTriggerDb.exec(`
      CREATE TRIGGER fixture_unknown_settings_trigger
      AFTER UPDATE ON user_settings
      BEGIN
        SELECT 1;
      END
    `);
    const error = captureError(
      () => foreignTriggerDb.transaction(() => migrateUserSettingsRevision(foreignTriggerDb)).immediate(),
    );
    assert(error.message.includes('unsupported pre-existing user_settings triggers'));
    assertEqual(
      foreignTriggerDb.prepare('PRAGMA table_info(user_settings)').all()
        .some(row => row.name === 'revision'),
      false,
    );
  } finally {
    foreignTriggerDb.close();
  }

  const lateNoopPolicyDb = openLegacyDb();
  const noLegacyPolicyBytes = '{"number":1.0,"models":{"futureSetting":"keep-me"}}';
  try {
    lateNoopPolicyDb.prepare('INSERT INTO user_settings (id,data) VALUES (1,?)')
      .run(noLegacyPolicyBytes);
    lateNoopPolicyDb.transaction(() => migrateUserSettingsRevision(lateNoopPolicyDb)).immediate();
    lateNoopPolicyDb.transaction(() => migrateModelPolicy(lateNoopPolicyDb)).immediate();
    const lateRow = readSettingsRow(lateNoopPolicyDb);
    assertEqual(lateRow.revision, 1);
    assertEqual(lateRow.data, noLegacyPolicyBytes);
  } finally {
    lateNoopPolicyDb.close();
  }

  const legacyPolicyBytes = '{"number":1e2,"duplicate":1,"duplicate":2,"models":{"autoFailoverEnabled":true,"futureSetting":"keep-me"}}';
  const expectedLegacyHex = Buffer.from(legacyPolicyBytes, 'utf8').toString('hex').toUpperCase();
  for (const legacyValue of [legacyPolicyBytes, Buffer.from(legacyPolicyBytes, 'utf8')]) {
    const legacyPolicyDb = openLegacyDb();
    try {
      legacyPolicyDb.prepare('INSERT INTO user_settings (id,data) VALUES (1,?)')
        .run(legacyValue);
      const migrationError = captureError(
        () => legacyPolicyDb.transaction(() => migrateUserSettingsRevision(legacyPolicyDb)).immediate(),
      );
      assert(migrationError.message.includes('legacy model automation keys require migration 061'));
      assertEqual(
        legacyPolicyDb.prepare('PRAGMA table_info(user_settings)').all()
          .some(row => row.name === 'revision'),
        false,
      );
      assertEqual(
        legacyPolicyDb.prepare(`
          SELECT hex(CAST(data AS BLOB)) AS data_hex
          FROM user_settings WHERE id=1
        `).get().data_hex,
        expectedLegacyHex,
      );

      const expectedDocument = JSON.parse(legacyPolicyBytes);
      delete expectedDocument.models.autoFailoverEnabled;
      legacyPolicyDb.transaction(() => migrateModelPolicy(legacyPolicyDb)).immediate();
      legacyPolicyDb.transaction(() => migrateUserSettingsRevision(legacyPolicyDb)).immediate();
      assertEqual(readSettingsRow(legacyPolicyDb).revision, 1);
      assertEqual(readSettingsRow(legacyPolicyDb).data, JSON.stringify(expectedDocument));
    } finally {
      legacyPolicyDb.close();
    }
  }

  const db = openDb();
  try {
    assertEqual(LEGACY_NOTIFICATION_USER_SETTING_PATHS.length, 21);
    assertEqual(new Set(LEGACY_NOTIFICATION_USER_SETTING_PATHS).size, 21);
    assertEqual(Object.isFrozen(LEGACY_NOTIFICATION_USER_SETTING_PATHS), true);
    assertEqual(
      JSON.stringify(LEGACY_NOTIFICATION_USER_SETTING_PATHS),
      JSON.stringify(EXPECTED_LEGACY_NOTIFICATION_USER_SETTING_PATHS),
    );

    const legacyDocument = legacyNotificationFixtureDocument();
    const legacyRaw = ` \n${JSON.stringify(legacyDocument)}\n\t`;
    replaceFixtureDocument(db, legacyRaw);
    db.exec('DROP TRIGGER trg_user_settings_revision_insert_forbidden');
    db.prepare(`
      INSERT INTO user_settings (id, data, revision, updated_at)
      VALUES (2, '{"rowTwo":"preserve-exactly"}', 41, '2026-08-12 00:00:00')
    `).run();
    const rowTwoBefore = db.prepare(`
      SELECT hex(CAST(data AS BLOB)) AS dataHex, revision, updated_at AS updatedAt
      FROM user_settings WHERE id = 2
    `).get();

    const census = readLegacyNotificationUserSettingsCensus(db);
    assertEqual(Object.isFrozen(census), true);
    assertEqual(Object.keys(census).length, 0);
    assertEqual(JSON.stringify(census), '{}');
    assertEqual(requireLegacyNotificationUserSettingsCensus(census), census);
    assertEqual(census.revision(), readSettingsRow(db).revision);
    const preimageBytes = Buffer.from(readRowBytes(db).dataHex, 'hex');
    assertEqual(preimageBytes.toString('utf8'), legacyRaw);
    const parsedPreimage = JSON.parse(legacyRaw);
    assertEqual(census.preimageSha256(), oracleSha256(preimageBytes));
    assertEqual(
      census.preimageSha256() === oracleSha256(
        Buffer.from(JSON.stringify(parsedPreimage), 'utf8'),
      ),
      false,
    );
    assertEqual(Object.isFrozen(census.paths()), true);
    assertEqual(census.paths().length, 21);
    assertEqual(
      JSON.stringify(census.paths().map(entry => entry.path)),
      JSON.stringify(EXPECTED_LEGACY_NOTIFICATION_USER_SETTING_PATHS),
    );
    assertEqual(census.paths().every(entry => (
      Object.isFrozen(entry)
      && /^[a-f0-9]{64}$/.test(entry.valueSha256)
      && JSON.stringify(entry).includes('CANARY') === false
    )), true);
    let sawNonStringNestedValue = false;
    for (const entry of census.paths()) {
      const parsedValue = legacyPathValueForOracle(parsedPreimage, entry.path);
      if (entry.path.startsWith('/') && typeof parsedValue !== 'string') {
        sawNonStringNestedValue = true;
      }
      assertEqual(
        entry.valueSha256,
        oracleSha256(Buffer.from(JSON.stringify(parsedValue), 'utf8')),
      );
    }
    assertEqual(sawNonStringNestedValue, true);
    const nestedArrayValue = legacyPathValueForOracle(
      parsedPreimage,
      '/notifications/emailAddresses',
    );
    assertEqual(Array.isArray(nestedArrayValue), true);
    assertEqual(
      census.paths().find(
        entry => entry.path === '/notifications/emailAddresses',
      ).valueSha256,
      oracleSha256(Buffer.from(JSON.stringify(nestedArrayValue), 'utf8')),
    );
    assertEqual(census.value('c3.notif.smtpPass'), 'LEGACY_SMTP_SECRET_CANARY');
    const safePreferenceCensusRead = captureError(
      () => census.value('c3.notif.desktopEnabled'),
    );
    assertEqual(
      safePreferenceCensusRead.code,
      'LEGACY_NOTIFICATION_CENSUS_PATH_UNOWNED',
    );
    const unownedCensusRead = captureError(() => census.value('c3.notif.futureSecret'));
    assertEqual(unownedCensusRead.code, 'LEGACY_NOTIFICATION_CENSUS_PATH_UNOWNED');
    const forgedCensus = captureError(
      () => requireLegacyNotificationUserSettingsCensus(Object.freeze(Object.create(null))),
    );
    assertEqual(forgedCensus.code, 'LEGACY_NOTIFICATION_CENSUS_INVALID');

    const manifest = census.scrubRequest();
    assertEqual(Object.isFrozen(manifest), true);
    assertEqual(Object.isFrozen(manifest.pathDigests), true);
    assertEqual(
      JSON.stringify(Object.keys(manifest).sort()),
      JSON.stringify([
        'expectedRevision',
        'pathDigests',
        'postimageSha256',
        'preimageSha256',
      ]),
    );
    assertEqual(manifest.pathDigests.length, 21);
    assertEqual(JSON.stringify(manifest).includes('CANARY'), false);
    const oraclePostimage = JSON.parse(legacyRaw);
    for (const pathId of EXPECTED_LEGACY_NOTIFICATION_USER_SETTING_PATHS) {
      deleteLegacyPathForOracle(oraclePostimage, pathId);
    }
    const oraclePostimageBytes = Buffer.from(JSON.stringify(oraclePostimage), 'utf8');
    assertEqual(manifest.postimageSha256, oracleSha256(oraclePostimageBytes));

    const missingRowDb = openDb();
    try {
      missingRowDb.exec('DROP TRIGGER trg_user_settings_revision_delete_forbidden');
      missingRowDb.prepare('DELETE FROM user_settings WHERE id = 1').run();
      const missingBefore = missingRowDb.prepare(
        'SELECT COUNT(*) AS rowCount FROM user_settings',
      ).get();
      const missingCensus = captureError(
        () => readLegacyNotificationUserSettingsCensus(missingRowDb),
      );
      assertEqual(missingCensus.code, 'USER_SETTINGS_ROW_MISSING');
      const missingScrub = captureError(
        () => runLegacyNotificationScrub(missingRowDb, manifest),
      );
      assertEqual(missingScrub.code, 'USER_SETTINGS_ROW_MISSING');
      assertEqual(
        JSON.stringify(missingRowDb.prepare(
          'SELECT COUNT(*) AS rowCount FROM user_settings',
        ).get()),
        JSON.stringify(missingBefore),
      );
      assertEqual(missingRowDb.inTransaction, false);
    } finally {
      missingRowDb.close();
    }

    const assertNoMutationFailure = (request, expectedCode) => {
      const before = readRowBytes(db);
      const rowTwoSnapshot = db.prepare(`
        SELECT hex(CAST(data AS BLOB)) AS dataHex, revision, updated_at AS updatedAt
        FROM user_settings WHERE id = 2
      `).get();
      const error = captureError(() => runLegacyNotificationScrub(db, request));
      assertEqual(error.code, expectedCode);
      assertEqual(JSON.stringify(readRowBytes(db)), JSON.stringify(before));
      assertEqual(
        JSON.stringify(db.prepare(`
          SELECT hex(CAST(data AS BLOB)) AS dataHex, revision, updated_at AS updatedAt
          FROM user_settings WHERE id = 2
        `).get()),
        JSON.stringify(rowTwoSnapshot),
      );
      return error;
    };

    const beforeOutsideTransaction = readRowBytes(db);
    const outsideTransaction = captureError(
      () => scrubLegacyNotificationUserSettingsInTransaction(db, manifest),
    );
    assertEqual(outsideTransaction.code, 'USER_SETTINGS_TRANSACTION_OWNERSHIP_REQUIRED');
    assertEqual(
      JSON.stringify(readRowBytes(db)),
      JSON.stringify(beforeOutsideTransaction),
    );

    assertNoMutationFailure(copyScrubRequest(manifest, {
      expectedRevision: manifest.expectedRevision + 1,
    }), 'USER_SETTINGS_REVISION_CONFLICT');
    assertNoMutationFailure(copyScrubRequest(manifest, {
      preimageSha256: '0'.repeat(64),
    }), 'LEGACY_NOTIFICATION_SCRUB_PREIMAGE_MISMATCH');
    assertNoMutationFailure(copyScrubRequest(manifest, {
      pathDigests: manifest.pathDigests.map((entry, index) => ({
        ...entry,
        valueSha256: index === 0 ? '0'.repeat(64) : entry.valueSha256,
      })),
    }), 'LEGACY_NOTIFICATION_SCRUB_PATH_MISMATCH');
    assertNoMutationFailure(copyScrubRequest(manifest, {
      postimageSha256: '0'.repeat(64),
    }), 'LEGACY_NOTIFICATION_SCRUB_POSTIMAGE_MISMATCH');
    assertNoMutationFailure(copyScrubRequest(manifest, {
      pathDigests: [{
        path: 'c3.notif.futureSecret',
        valueSha256: '0'.repeat(64),
      }],
    }), 'LEGACY_NOTIFICATION_SCRUB_INPUT_INVALID');

    const beforeApplied = readRowBytes(db);
    const applied = runLegacyNotificationScrub(db, manifest);
    assertEqual(applied.status, 'APPLIED');
    assertEqual(applied.revision, beforeApplied.revision + 1);
    assertEqual(applied.postimageSha256, manifest.postimageSha256);
    assertEqual(Object.isFrozen(applied.scrubbedPaths), true);
    assertEqual(applied.scrubbedPaths.length, 21);
    const appliedRow = readRowBytes(db);
    assertEqual(appliedRow.dataHex, oraclePostimageBytes.toString('hex').toUpperCase());
    assertEqual(
      applied.postimageSha256,
      oracleSha256(Buffer.from(appliedRow.dataHex, 'hex')),
    );
    const scrubbedDocument = readDocument(db);
    for (const pathId of EXPECTED_LEGACY_NOTIFICATION_USER_SETTING_PATHS) {
      if (pathId.startsWith('/notifications/')) {
        assertEqual(Object.hasOwn(scrubbedDocument.notifications, pathId.split('/')[2]), false);
      } else {
        assertEqual(Object.hasOwn(scrubbedDocument, pathId), false);
      }
    }
    assertEqual(scrubbedDocument['c3.notif.desktopEnabled'], true);
    assertEqual(scrubbedDocument['c3.notif.quietEnabled'], true);
    assertEqual(scrubbedDocument['c3.notif.quietFrom'], '22:00');
    assertEqual(scrubbedDocument['c3.notif.quietTo'], '07:00');
    assertEqual(
      scrubbedDocument['c3.notif.futureSecret'],
      'UNOWNED_NOTIFICATION_CANARY',
    );
    assertEqual(scrubbedDocument.notifications.enabled, true);
    assertEqual(
      JSON.stringify(scrubbedDocument.notifications.unknownNested),
      JSON.stringify({ preserve: 'exactly' }),
    );
    assertEqual(scrubbedDocument.storage.root, '/private/device/path');
    assertEqual(scrubbedDocument.futurePrivate.preserve, true);
    assertEqual(
      JSON.stringify(db.prepare(`
        SELECT hex(CAST(data AS BLOB)) AS dataHex, revision, updated_at AS updatedAt
        FROM user_settings WHERE id = 2
      `).get()),
      JSON.stringify(rowTwoBefore),
    );

    const beforeIdempotent = readRowBytes(db);
    const idempotent = runLegacyNotificationScrub(db, manifest);
    assertEqual(idempotent.status, 'ALREADY_APPLIED');
    assertEqual(idempotent.revision, beforeIdempotent.revision);
    assertEqual(
      JSON.stringify(readRowBytes(db)),
      JSON.stringify(beforeIdempotent),
    );

    replaceFixtureDocument(db, JSON.stringify(legacyNotificationFixtureDocument()));
    const failureManifest = readLegacyNotificationUserSettingsCensus(db).scrubRequest();
    db.exec(`
      CREATE TRIGGER fixture_reject_legacy_notification_scrub
      BEFORE UPDATE OF data, revision ON user_settings
      WHEN OLD.id = 1
      BEGIN
        SELECT RAISE(ABORT, 'LEGACY_NOTIFICATION_SCRUB_WRITE_CANARY');
      END
    `);
    assertNoMutationFailure(failureManifest, 'USER_SETTINGS_DB_WRITE_FAILED');
    db.exec('DROP TRIGGER fixture_reject_legacy_notification_scrub');

    db.exec(`
      CREATE TRIGGER fixture_ignore_legacy_notification_scrub
      BEFORE UPDATE OF data, revision ON user_settings
      WHEN OLD.id = 1
      BEGIN
        SELECT RAISE(IGNORE);
      END
    `);
    assertNoMutationFailure(failureManifest, 'USER_SETTINGS_STORAGE_CONTRACT');
    db.exec('DROP TRIGGER fixture_ignore_legacy_notification_scrub');

    db.exec(`
      CREATE TRIGGER fixture_diverge_legacy_notification_scrub
      AFTER UPDATE OF data, revision ON user_settings
      WHEN OLD.id = 1
      BEGIN
        UPDATE user_settings
        SET data = json_set(NEW.data, '$.fixtureAfterScrub', 'injected'),
            revision = NEW.revision + 1
        WHERE id = 1;
      END
    `);
    assertNoMutationFailure(failureManifest, 'USER_SETTINGS_STORAGE_CONTRACT');
    db.exec('DROP TRIGGER fixture_diverge_legacy_notification_scrub');

    const beforeSerializationFailure = readRowBytes(db);
    const stringifyBeforeFailure = JSON.stringify;
    try {
      JSON.stringify = () => { throw new Error('SCRUB_SERIALIZATION_CANARY'); };
      const serializationError = captureError(
        () => runLegacyNotificationScrub(db, failureManifest),
      );
      assertEqual(
        serializationError.code,
        'LEGACY_NOTIFICATION_SCRUB_SERIALIZATION_FAILED',
      );
    } finally {
      JSON.stringify = stringifyBeforeFailure;
    }
    const afterSerializationFailure = readRowBytes(db);
    assertEqual(
      afterSerializationFailure.dataHex,
      beforeSerializationFailure.dataHex,
    );
    assertEqual(
      afterSerializationFailure.revision,
      beforeSerializationFailure.revision,
    );
    assertEqual(
      afterSerializationFailure.updatedAt,
      beforeSerializationFailure.updatedAt,
    );
    assertEqual(
      readDocument(db)['c3.notif.smtpPass'],
      'LEGACY_SMTP_SECRET_CANARY',
    );

    assertEqual(createUserSettingsRepository(db).commitNotification, undefined);
    const userSettingsSource = readFileSync(
      new URL('../src/db/user-settings.js', import.meta.url),
      'utf8',
    );
    for (const retiredWriterSeam of [
      'NOTIFICATION_SETTING_FIELD_MAP',
      'NOTIFICATION_SETTING_KEYS',
      'NOTIFICATION_INPUT_FIELD_SET',
      'commitNotification(',
      'updateNotificationUserSettings',
    ]) {
      assertEqual(userSettingsSource.includes(retiredWriterSeam), false);
    }
    exerciseNotificationMigrationCli();
    const migrationCliSource = readFileSync(
      new URL('../scripts/migrate-notification-authority.js', import.meta.url),
      'utf8',
    );
    for (const requiredBoundedSeam of [
      'readLegacyNotificationUserSettingsCensus',
      'scrubLegacyNotificationUserSettingsInTransaction',
      'db.transaction(() => scrubLegacyNotificationUserSettingsInTransaction',
      ')).immediate()',
      'LEGACY_NOTIFICATION_USER_SETTING_PATHS',
      'ROOT_ENVIRONMENT_OWNER.LEGACY_NOTIFICATION_SCRUB',
      'MIGRATION_QUIESCENCE_ATTESTATION_REQUIRED',
      'MIGRATION_MANIFEST_DIGEST_MISMATCH',
      'MIGRATION_TRANSFER_RECOVERY_REQUIRED',
      'MIGRATION_CANONICAL_AMBIENT_SHADOW',
      'NOTIFICATION_AUTHORITY_DECISIONS_SCHEMA',
      'finalizeNotificationAuthorityPlan',
      'NUMERIC_SMTP_PORT',
      'canonicalValueSha256',
      'MIGRATION_DATABASE_POSTIMAGE_STALE',
      'MIGRATION_SETUP_POSTIMAGE_STALE',
      'MIGRATION_PAIASS_POSTIMAGE_STALE',
      'createApplyStagePlan',
      'remainingStages',
      'ABSENCE_CONFIRMED',
      'readExactFileIdentity(tempPath, tempWrittenStat',
      'fs.linkSync(tempPath, exportPath)',
      'privateSource.snapshot.sha256 === source.postimageSha256',
      'receipts: manifest.paiassReceipts',
      'context.paiassStatus = paiass.status;',
    ]) {
      assertEqual(
        migrationCliSource.includes(requiredBoundedSeam),
        true,
        `migration CLI source missing seam: ${requiredBoundedSeam}`,
      );
    }
    assertEqual(migrationCliSource.includes('DELETE FROM user_settings'), false);
    assertEqual(migrationCliSource.includes("startsWith('c3.notif.')"), false);
    assertEqual(migrationCliSource.includes("'--project-root'"), false);
    assert(
      migrationCliSource.indexOf('MIGRATION_QUIESCENCE_ATTESTATION_REQUIRED')
      < migrationCliSource.indexOf('readSafeFileSnapshot(manifestPath'),
    );
    assert(
      migrationCliSource.indexOf('readExactFileIdentity(tempPath, tempWrittenStat')
      < migrationCliSource.indexOf('fs.linkSync(tempPath, exportPath)'),
    );
  } finally {
    db.close();
  }
});

await testAsync('versioned generic CAS is redacted and legacy settings routes are inert 410 endpoints', async () => {
  const db = openDb();
  try {
    assertEqual(new Set(GENERIC_USER_SETTING_PATHS).size, 46);
    assertEqual(
      JSON.stringify([...GENERIC_USER_SETTING_PATHS].sort()),
      JSON.stringify([...EXPECTED_GENERIC_USER_SETTING_PATHS].sort()),
    );
    const harness = createRouteHarness(db);
    const protectedDocument = legacyNotificationFixtureDocument();
    protectedDocument.storage = { root: '/private/device/path' };
    protectedDocument.webhookSecret = 'WEBHOOK_SECRET_CANARY';
    protectedDocument.futurePrivate = 'PRIVATE_DESTINATION_CANARY';
    replaceFixtureDocument(db, JSON.stringify(protectedDocument));

    const webhookGet = await harness.getWebhookSecret();
    assertEqual(webhookGet.status, 200);
    assertEqual(
      JSON.stringify(webhookGet.body),
      JSON.stringify({ configured: true, source: 'PROCESS_ENV' }),
    );
    assertEqual(
      JSON.stringify(Object.keys(webhookGet.body)),
      JSON.stringify(['configured', 'source']),
    );

    const beforeRetiredWebhookSetter = readRowBytes(db);
    const parseCountBeforeRetiredWebhookSetter = harness.parseCount;
    const signatureBeforeRetiredWebhookSetter = TEST_WEBHOOK_SECRET_AUTHORITY.sign(
      'route-payload',
      1_700_000_000_000,
    );
    const unauthorizedWebhookPost = await harness.postWebhookSecret({
      request: {
        headers: {},
        socket: { remoteAddress: '203.0.113.10' },
      },
      parseError: new Error('WEBHOOK_BODY_MUST_NOT_PARSE'),
    });
    assertEqual(unauthorizedWebhookPost.status, 403);
    assertEqual(Object.hasOwn(unauthorizedWebhookPost.body, 'source'), false);
    assertEqual(Object.hasOwn(unauthorizedWebhookPost.body, 'code'), false);
    assertEqual(
      JSON.stringify(readRowBytes(db)),
      JSON.stringify(beforeRetiredWebhookSetter),
    );
    assertEqual(harness.parseCount, parseCountBeforeRetiredWebhookSetter);

    const retiredWebhookPost = await harness.postWebhookSecret({
      parseError: new Error('WEBHOOK_BODY_MUST_NOT_PARSE'),
    });
    assertEqual(retiredWebhookPost.status, 410);
    assertEqual(
      JSON.stringify(retiredWebhookPost.body),
      JSON.stringify({ ok: false, code: 'CREDENTIAL_SOURCE_READ_ONLY' }),
    );
    assertEqual(harness.parseCount, parseCountBeforeRetiredWebhookSetter);
    assertEqual(
      JSON.stringify(readRowBytes(db)),
      JSON.stringify(beforeRetiredWebhookSetter),
    );
    assertEqual(
      TEST_WEBHOOK_SECRET_AUTHORITY.sign('route-payload', 1_700_000_000_000),
      signatureBeforeRetiredWebhookSetter,
    );
    assertEqual(
      createUserSettingsRepository(db).commitWebhookSecret,
      undefined,
    );
    assertEqual(readDocument(db).webhookSecret, 'WEBHOOK_SECRET_CANARY');
    const forgedAuthorityError = captureError(() => createRouteHarness(db, {
      webhookSecretAuthority: Object.freeze({
        status: () => Object.freeze({ configured: true, source: 'PROCESS_ENV' }),
        sign: () => 'sha256=forged',
      }),
    }));
    assertEqual(forgedAuthorityError.code, WEBHOOK_SECRET_AUTHORITY_INVALID);

    const securitySource = readFileSync(
      new URL('../src/routes/security.js', import.meta.url),
      'utf8',
    );
    const webhookRouteStart = securitySource.indexOf('// ── Webhook Secret');
    const webhookRouteEnd = securitySource.indexOf('// ── Sessions', webhookRouteStart);
    assert(webhookRouteStart >= 0 && webhookRouteEnd > webhookRouteStart);
    const webhookRouteSource = securitySource.slice(webhookRouteStart, webhookRouteEnd);
    for (const retiredSeam of [
      '_maskSecret',
      'masked',
      'createUserSettingsRepository',
      'commitWebhookSecret',
      'randomBytes',
    ]) {
      assertEqual(webhookRouteSource.includes(retiredSeam), false);
    }

    const beforeLegacy = readRowBytes(db);
    const parseCountBeforeLegacy = harness.parseCount;
    const legacyGet = await harness.getLegacy();
    const legacyPost = await harness.postLegacy(
      { storage: { root: '/must-not-parse' } },
      { parseFailure: new Error('LEGACY_BODY_PARSE_CANARY') },
    );
    const retiredBody = { ok: false, code: 'USER_SETTINGS_LEGACY_RETIRED' };
    assertEqual(legacyGet.status, 410);
    assertEqual(JSON.stringify(legacyGet.body), JSON.stringify(retiredBody));
    assertEqual(legacyPost.response.status, 410);
    assertEqual(JSON.stringify(legacyPost.response.body), JSON.stringify(retiredBody));
    assertEqual(harness.parseCount, parseCountBeforeLegacy);
    assertEqual(JSON.stringify(readRowBytes(db)), JSON.stringify(beforeLegacy));

    const initialV2 = await harness.getV2();
    assertEqual(initialV2.status, 200);
    assertEqual(initialV2.body.revision, readSettingsRow(db).revision);
    assertEqual(Object.hasOwn(initialV2.body.settings, 'storage'), false);
    assertEqual(Object.hasOwn(initialV2.body.settings, 'webhookSecret'), false);
    assertEqual(Object.hasOwn(initialV2.body.settings, 'futurePrivate'), false);
    for (const key of RETIRED_TYPED_NOTIFICATION_KEYS) {
      assertEqual(Object.hasOwn(initialV2.body.settings, key), false);
    }
    assertEqual(JSON.stringify(initialV2.body).includes('SECRET_CANARY'), false);

    const v2Commit = await harness.putV2({
      expectedRevision: initialV2.body.revision,
      patch: {
        'c3.language': 'en',
        appearance: { theme: 'dark' },
      },
    });
    assertEqual(v2Commit.response.status, 200);
    assertEqual(v2Commit.response.body.revision, initialV2.body.revision + 1);
    assertEqual(v2Commit.response.body.settings['c3.language'], 'en');
    assertEqual(v2Commit.response.body.settings.appearance.theme, 'dark');
    assertEqual(Object.hasOwn(v2Commit.response.body.settings, 'storage'), false);
    assertEqual(Object.hasOwn(v2Commit.response.body.settings, 'webhookSecret'), false);
    assertEqual(Object.hasOwn(v2Commit.response.body.settings, 'futurePrivate'), false);
    assertEqual(v2Commit.featureDocument, null);
    assertEqual(JSON.stringify(v2Commit.response.body).includes('SECRET_CANARY'), false);
    const postCasDocument = readDocument(db);
    assertEqual(postCasDocument.storage.root, '/private/device/path');
    assertEqual(postCasDocument.webhookSecret, 'WEBHOOK_SECRET_CANARY');
    assertEqual(postCasDocument.futurePrivate, 'PRIVATE_DESTINATION_CANARY');

    db.exec(`
      CREATE TRIGGER fixture_reject_v2_settings_write
      BEFORE UPDATE OF data, revision ON user_settings
      WHEN OLD.id = 1
      BEGIN
        SELECT RAISE(ABORT, 'V2_SETTINGS_WRITE_FAILURE_CANARY');
      END
    `);
    const beforeRejectedV2Write = readRowBytes(db);
    const rejectedV2Write = await harness.putV2({
      expectedRevision: beforeRejectedV2Write.revision,
      patch: { 'c3.language': 'cs' },
    });
    assertEqual(rejectedV2Write.response.status, 503);
    assertEqual(rejectedV2Write.response.body.code, 'USER_SETTINGS_DB_WRITE_FAILED');
    assertEqual(JSON.stringify(rejectedV2Write.response.body).includes('CANARY'), false);
    const afterRejectedV2Write = readRowBytes(db);
    assertEqual(afterRejectedV2Write.dataHex, beforeRejectedV2Write.dataHex);
    assertEqual(afterRejectedV2Write.revision, beforeRejectedV2Write.revision);
    assertEqual(JSON.stringify(afterRejectedV2Write), JSON.stringify(beforeRejectedV2Write));
    db.exec('DROP TRIGGER fixture_reject_v2_settings_write');

    db.exec(`
      CREATE TRIGGER fixture_diverge_v2_settings_after_write
      AFTER UPDATE OF data, revision ON user_settings
      WHEN OLD.id = 1
      BEGIN
        UPDATE user_settings
        SET data = json_set(NEW.data, '$.fixtureAfterTrigger', 'injected'),
            revision = NEW.revision + 1
        WHERE id = 1;
      END
    `);
    const beforeDivergentV2Write = readRowBytes(db);
    const divergentV2Write = await harness.putV2({
      expectedRevision: beforeDivergentV2Write.revision,
      patch: { 'c3.language': 'cs' },
    });
    assertEqual(divergentV2Write.response.status, 503);
    assertEqual(divergentV2Write.response.body.code, 'USER_SETTINGS_STORAGE_CONTRACT');
    assertEqual(
      JSON.stringify(readRowBytes(db)),
      JSON.stringify(beforeDivergentV2Write),
    );
    db.exec('DROP TRIGGER fixture_diverge_v2_settings_after_write');

    const beforeUnowned = readSettingsRow(db);
    for (const patch of [
      { storage: { root: '/attacker/path' } },
      { 'c3.features.skills': false },
    ]) {
      const unowned = await harness.putV2({
        expectedRevision: beforeUnowned.revision,
        patch,
      });
      assertEqual(unowned.response.status, 400);
      assertEqual(unowned.response.body.code, 'USER_SETTINGS_PATH_UNOWNED');
      assertEqual(JSON.stringify(readSettingsRow(db)), JSON.stringify(beforeUnowned));
    }

    const staleRevision = readSettingsRow(db).revision;
    const interveningStorage = await harness.putStorage({
      retention: { llm_logs: 23 },
    });
    assertEqual(interveningStorage.status, 200);
    const afterStorage = readSettingsRow(db);
    const staleV2 = await harness.putV2({
      expectedRevision: staleRevision,
      patch: { 'c3.language': 'cs' },
    });
    assertEqual(staleV2.response.status, 409);
    assertEqual(staleV2.response.body.code, 'USER_SETTINGS_REVISION_CONFLICT');
    assertEqual(staleV2.response.body.expectedRevision, staleRevision);
    assertEqual(staleV2.response.body.currentRevision, afterStorage.revision);
    assertEqual(JSON.stringify(readSettingsRow(db)), JSON.stringify(afterStorage));

    const beforeParseFailure = readRowBytes(db);
    const parseFailure = await harness.putV2(
      { expectedRevision: afterStorage.revision, patch: { 'c3.language': 'cs' } },
      { parseFailure: new Error('TYPED_PARSE_CANARY') },
    );
    assertEqual(parseFailure.response.status, 400);
    assertEqual(parseFailure.response.body.code, 'USER_SETTINGS_INPUT_INVALID');
    assertEqual(JSON.stringify(readRowBytes(db)), JSON.stringify(beforeParseFailure));

    db.exec('DROP TRIGGER trg_user_settings_revision_update_guard');
    db.prepare('UPDATE user_settings SET data = ?, revision = revision + 1 WHERE id = 1')
      .run('{broken');
    const malformedRaw = readRaw(db);
    const malformedRead = await harness.getV2();
    assertEqual(malformedRead.status, 503);
    assertEqual(malformedRead.body.code, 'USER_SETTINGS_JSON_INVALID');
    assertEqual(readRaw(db), malformedRaw);
  } finally {
    db.close();
  }
});

await testAsync('five real-WAL stale candidates cannot overwrite retained or scrub commits', async () => {
  const directory = mkdtempSync(path.join(isolatedTestRuntime.artifacts, 'settings-authority-wal-'));
  const cases = [
    ['generic', 'scrub'],
    ['generic', 'storage'],
    ['import', 'scrub'],
    ['import', 'storage'],
    ['import', 'generic'],
  ];

  try {
    for (const [candidateKind, writerKind] of cases) {
      const databasePath = path.join(directory, `${candidateKind}-${writerKind}.sqlite`);
      const setup = openPolicyDb(databasePath);
      if (writerKind === 'scrub') {
        replaceFixtureDocument(
          setup,
          `\n${JSON.stringify(legacyNotificationFixtureDocument())}\n`,
        );
      }
      setup.close();
      const barrier = new Int32Array(new SharedArrayBuffer(8));
      const candidate = startStaleRouteWorker({
        databasePath,
        barrier,
        kind: candidateKind,
        backup: backupEnvelope(),
        miscUrl: new URL('../src/routes/misc.js', import.meta.url).href,
      });
      let writerDb = null;
      try {
        const deadline = Date.now() + 5000;
        while (Atomics.load(barrier, 0) !== 1 && Date.now() < deadline) {
          Atomics.wait(barrier, 0, Atomics.load(barrier, 0), 50);
        }
        assertEqual(Atomics.load(barrier, 0), 1);

        writerDb = new Database(databasePath);
        writerDb.pragma('journal_mode = WAL');
        writerDb.pragma('foreign_keys = ON');
        writerDb.pragma('busy_timeout = 5000');
        const writerHarness = createRouteHarness(writerDb);
        const observedRevision = readSettingsRow(writerDb).revision;
        let writerResponse;
        let expectedWriterValue;
        if (writerKind === 'scrub') {
          expectedWriterValue = 'c3.notif.smtpHost';
          const scrubResult = runLegacyNotificationScrub(
            writerDb,
            readLegacyNotificationUserSettingsCensus(writerDb).scrubRequest(),
          );
          assertEqual(scrubResult.status, 'APPLIED');
        } else if (writerKind === 'storage') {
          expectedWriterValue = candidateKind === 'generic' ? 17 : 19;
          writerResponse = await writerHarness.putStorage({
            retention: { llm_logs: expectedWriterValue },
          });
        } else {
          writerResponse = (await writerHarness.putV2({
            expectedRevision: observedRevision,
            patch: { 'c3.language': 'cs' },
          })).response;
          expectedWriterValue = 'cs';
        }
        if (writerResponse) assertEqual(writerResponse.status, 200);

        const afterWriter = readRowBytes(writerDb);
        assertEqual(afterWriter.revision, observedRevision + 1);
        const afterWriterDocument = readDocument(writerDb);
        if (writerKind === 'scrub') {
          assertEqual(Object.hasOwn(afterWriterDocument, expectedWriterValue), false);
          assertEqual(afterWriterDocument['c3.notif.desktopEnabled'], true);
          assertEqual(
            afterWriterDocument['c3.notif.futureSecret'],
            'UNOWNED_NOTIFICATION_CANARY',
          );
        } else if (writerKind === 'storage') {
          assertEqual(afterWriterDocument.storage.retention.llm_logs, expectedWriterValue);
        } else {
          assertEqual(afterWriterDocument['c3.language'], expectedWriterValue);
        }

        Atomics.store(barrier, 1, 1);
        Atomics.notify(barrier, 1);
        const stale = await candidate.result;
        assertEqual(stale.observedRevision, observedRevision);
        assertEqual(stale.response.status, 409);
        assertEqual(JSON.stringify(stale.response.body), JSON.stringify({
          ok: false,
          code: 'USER_SETTINGS_REVISION_CONFLICT',
          expectedRevision: observedRevision,
          currentRevision: observedRevision + 1,
        }));
        assertEqual(JSON.stringify(readRowBytes(writerDb)), JSON.stringify(afterWriter));

        const finalDocument = readDocument(writerDb);
        if (writerKind === 'scrub') {
          assertEqual(Object.hasOwn(finalDocument, expectedWriterValue), false);
          assertEqual(finalDocument['c3.notif.desktopEnabled'], true);
          assertEqual(
            finalDocument['c3.notif.futureSecret'],
            'UNOWNED_NOTIFICATION_CANARY',
          );
        } else if (writerKind === 'storage') {
          assertEqual(finalDocument.storage.retention.llm_logs, expectedWriterValue);
        } else {
          assertEqual(finalDocument['c3.language'], expectedWriterValue);
        }
      } finally {
        Atomics.store(barrier, 1, 1);
        Atomics.notify(barrier, 1);
        if (writerDb) writerDb.close();
        await Promise.allSettled([candidate.result]);
        await candidate.worker.terminate();
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: false });
  }
});

await testAsync('import and reset commit settings with policy atomically and return only redacted state', async () => {
  const db = openPolicyDb();
  const readPolicyState = () => ({
    projection: db.prepare('SELECT * FROM model_automation_policy WHERE id = 1').get(),
    events: db.prepare('SELECT * FROM model_automation_policy_events ORDER BY seq').all(),
  });
  try {
    replaceFixtureDocument(db, JSON.stringify({
      appearance: { theme: 'dark' },
      'c3.language': 'en',
      storage: { root: '/private/device/path' },
      webhookSecret: 'WEBHOOK_SECRET_CANARY',
      'c3.notif.smtpPass': 'NOTIFICATION_SECRET_CANARY',
      futurePrivate: 'PRIVATE_DESTINATION_CANARY',
    }));
    const harness = createRouteHarness(db);
    const importRequest = {
      backup: backupEnvelope(),
      expectedRevision: readSettingsRow(db).revision,
    };

    db.exec(`
      CREATE TRIGGER fixture_reject_import_policy_event
      BEFORE INSERT ON model_automation_policy_events
      WHEN NEW.event_kind = 'BACKUP_IMPORT'
      BEGIN
        SELECT RAISE(ABORT, 'IMPORT_POLICY_FAILURE_CANARY');
      END
    `);
    const beforeRejectedImport = readRowBytes(db);
    const policyBeforeRejectedImport = readPolicyState();
    const rejectedImport = await harness.postImport(importRequest);
    assertEqual(rejectedImport.status, 503);
    assertEqual(rejectedImport.body.code, 'MODEL_AUTOMATION_POLICY_STORAGE_CONTRACT');
    assertEqual(JSON.stringify(rejectedImport.body).includes('CANARY'), false);
    assertEqual(JSON.stringify(readRowBytes(db)), JSON.stringify(beforeRejectedImport));
    assertEqual(JSON.stringify(readPolicyState()), JSON.stringify(policyBeforeRejectedImport));
    db.exec('DROP TRIGGER fixture_reject_import_policy_event');

    const imported = await harness.postImport(importRequest);
    assertEqual(imported.status, 200);
    assertEqual(imported.body.revision, importRequest.expectedRevision + 1);
    assertEqual(imported.body.settings.appearance.theme, 'light');
    assertEqual(imported.body.settings['c3.language'], 'cs');
    assertEqual(imported.body.policy.autoFailoverEnabled, true);
    assertEqual(imported.body.policy.autoCleanupEnabled, true);
    assertEqual(imported.body.policy.autoCleanupDays, 30);
    for (const key of [
      'storage',
      'webhookSecret',
      'futurePrivate',
      ...RETIRED_TYPED_NOTIFICATION_KEYS,
    ]) {
      assertEqual(Object.hasOwn(imported.body.settings, key), false);
    }
    assertEqual(JSON.stringify(imported.body).includes('SECRET_CANARY'), false);
    const importedDocument = readDocument(db);
    assertEqual(importedDocument.storage.root, '/private/device/path');
    assertEqual(importedDocument.webhookSecret, 'WEBHOOK_SECRET_CANARY');
    assertEqual(importedDocument['c3.notif.smtpPass'], 'NOTIFICATION_SECRET_CANARY');
    assertEqual(importedDocument.futurePrivate, 'PRIVATE_DESTINATION_CANARY');
    assertEqual(importedDocument.appearance.theme, 'light');
    assertEqual(readPolicyState().events.length, policyBeforeRejectedImport.events.length + 1);

    db.exec(`
      CREATE TRIGGER fixture_reject_reset_policy_event
      BEFORE INSERT ON model_automation_policy_events
      WHEN NEW.event_kind = 'GLOBAL_RESET'
      BEGIN
        SELECT RAISE(ABORT, 'RESET_POLICY_FAILURE_CANARY');
      END
    `);
    const beforeRejectedReset = readRowBytes(db);
    const policyBeforeRejectedReset = readPolicyState();
    const rejectedReset = await harness.postReset();
    assertEqual(rejectedReset.status, 503);
    assertEqual(rejectedReset.body.code, 'MODEL_AUTOMATION_POLICY_STORAGE_CONTRACT');
    assertEqual(JSON.stringify(rejectedReset.body).includes('CANARY'), false);
    assertEqual(JSON.stringify(readRowBytes(db)), JSON.stringify(beforeRejectedReset));
    assertEqual(JSON.stringify(readPolicyState()), JSON.stringify(policyBeforeRejectedReset));
    db.exec('DROP TRIGGER fixture_reject_reset_policy_event');

    const reset = await harness.postReset();
    assertEqual(reset.status, 200);
    assertEqual(reset.body.revision, beforeRejectedReset.revision + 1);
    assertEqual(JSON.stringify(reset.body.settings), '{}');
    assertEqual(reset.body.policy.autoFailoverEnabled, false);
    assertEqual(reset.body.policy.autoCleanupEnabled, false);
    assertEqual(reset.body.policy.autoCleanupDays, 14);
    assertEqual(JSON.stringify(reset.body).includes('CANARY'), false);
    const resetDocument = readDocument(db);
    assertEqual(JSON.stringify(reset.body.settings), '{}');
    assertEqual(Object.hasOwn(resetDocument, 'appearance'), false);
    assertEqual(Object.hasOwn(resetDocument, 'c3.language'), false);
    assertEqual(Object.hasOwn(resetDocument, 'storage'), false);
    assertEqual(resetDocument.webhookSecret, 'WEBHOOK_SECRET_CANARY');
    assertEqual(resetDocument['c3.notif.smtpPass'], 'NOTIFICATION_SECRET_CANARY');
    assertEqual(resetDocument.futurePrivate, 'PRIVATE_DESTINATION_CANARY');
    assertEqual(readPolicyState().events.length, policyBeforeRejectedReset.events.length + 1);
  } finally {
    db.close();
  }
});

summary();
