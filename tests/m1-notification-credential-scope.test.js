import { strict as assert } from 'node:assert';
import { createHash, createHmac } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseDotenv } from 'dotenv';

import {
  createNotificationRouter,
  EmailChannel,
  PushChannel,
  TelegramChannel,
  WebhookChannel,
} from '../src/notifications/index.js';
import {
  NOTIFICATION_ENVIRONMENT_AUTHORITY_INVALID,
  WEBHOOK_SECRET_AUTHORITY_INVALID,
  WEBHOOK_SECRET_NOT_CONFIGURED,
  WEBHOOK_SECRET_SOURCE_UNSAFE,
  notificationEnvironmentAuthority,
  readRuntimeEnvironmentAuthorities,
  readWebhookSecretAuthority,
  requireNotificationEnvironmentAuthority,
  requireWebhookSecretAuthority,
  webhookSecretAuthority,
} from '../src/runtime-environment.js';
import { createNotificationRoutes } from '../src/routes/notifications.js';
import {
  EXTERNAL_NOTIFICATION_CHANNEL_FLAGS,
  EXTERNAL_NOTIFICATION_CHANNELS,
  NOTIFICATION_CHANNEL_DISABLED,
  NOTIFICATION_CHANNEL_POLICY_INVALID,
  NOTIFICATION_CHANNEL_UNSUPPORTED,
  readNotificationChannelPolicy,
} from '../src/notifications/channel-policy.js';
import {
  dryRun,
  verifyAll,
  verifyEmail,
  verifyNtfy,
  verifyTelegram,
} from '../src/notifications/e2e-verify.js';
import {
  SETUP_ALREADY_COMPLETE,
  SETUP_ENV_DUPLICATE_OWNED_KEY,
  SETUP_ENV_TARGET_OUT_OF_SCOPE,
  SETUP_ENV_TARGET_UNSAFE,
  SETUP_ENV_VALUE_INVALID,
  SETUP_NOTIFICATION_INPUT_RETIRED,
  SETUP_STATE_INVALID,
  SETUP_STATE_WRITE_FAILED,
  SetupWizard,
  createSetupRoutes,
  renderSetupEnvironment,
  requireSafeSetupEnvTarget,
} from '../src/setup/wizard.js';
import {
  SETUP_ADMIN_AUTH_REQUIRED,
  createStrictAdminTokenGuard,
} from '../src/security/strict-admin-auth.js';
import {
  LEGACY_NOTIFICATION_ENV_DELETE_ONLY_KEYS,
  NOTIFICATION_ENV_OWNED_KEYS,
  ROOT_ENVIRONMENT_MAX_BYTES,
  ROOT_ENVIRONMENT_OWNER,
  SETUP_ENV_OWNED_KEYS,
  patchRootEnvironmentFile,
  readRootEnvironmentBootstrap,
  readRootEnvironmentFile,
  requireRootEnvironmentBootstrap,
  requireRootEnvironmentFileRead,
} from '../src/security/root-environment-file.js';
import {
  FEATURE_SETTING_KEYS,
  FEATURE_SETTINGS_INPUT_INVALID,
  featureManager,
} from '../src/core/feature-manager.js';
import {
  LEGACY_CREDENTIAL_RECEIPT_SCHEMA,
  MIGRATION_ACTION,
  PAIASS_NOTIFICATION_PATHS,
  SETUP_NOTIFICATION_PATHS,
  createPaiassReceipt,
  parseMigrationCliArguments,
} from '../scripts/migrate-notification-authority.js';
import { suite, summary, testAsync } from './harness.js';

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SILENT_LOGGER = Object.freeze({
  debug() {},
  error() {},
  info() {},
  warn() {},
});
const SETUP_ADMIN_TOKEN = 'fixture-admin-token';
const RUNTIME_NOTIFICATION_DEPENDENCIES = Object.freeze({
  notificationEnvironmentAuthority,
  requireNotificationEnvironmentAuthority,
  requireWebhookSecretAuthority,
  webhookSecretAuthority,
});

const EXPECTED_CHANNEL_FLAGS = Object.freeze({
  email: 'C3_ENABLE_NOTIFICATION_EMAIL',
  telegram: 'C3_ENABLE_NOTIFICATION_TELEGRAM',
  push: 'C3_ENABLE_NOTIFICATION_PUSH',
  webhook: 'C3_ENABLE_NOTIFICATION_WEBHOOK',
  desktop: 'C3_ENABLE_NOTIFICATION_DESKTOP',
});

const EXPECTED_FEATURE_SETTING_KEYS = Object.freeze([
  'c3.features.agents',
  'c3.features.lifecycle',
  'c3.features.expertises',
  'c3.features.telemetry',
  'c3.features.specialistTelemetry',
  'c3.features.autonomy',
  'c3.features.skills',
]);

const EXPECTED_SETUP_ENV_KEYS = Object.freeze([
  'OLLAMA_URL',
  'C3_LANG',
  'C3_DB_PATH',
  'C3_LICENSE_KEY',
]);

const EXPECTED_NOTIFICATION_ENV_KEYS = Object.freeze([
  'C3_SMTP_HOST',
  'C3_SMTP_PORT',
  'C3_SMTP_USER',
  'C3_SMTP_PASS',
  'C3_SMTP_FROM',
  'C3_TELEGRAM_BOT_TOKEN',
  'C3_TELEGRAM_CHAT_ID',
  'C3_NTFY_SERVER',
  'C3_NTFY_TOPIC',
  'C3_NTFY_TOKEN',
  'C3_WEBHOOK_URL',
  'C3_WEBHOOK_SECRET',
]);

const EXPECTED_LEGACY_NOTIFICATION_ENV_KEYS = Object.freeze([
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'NTFY_SERVER',
  'NTFY_TOPIC',
  'EMAIL_FROM',
  'SMTP_URL',
  'EMAIL_TO',
  'C3_NTFY_URL',
]);

function captureError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error('Expected callback to throw');
}

function fakeChannelFactories(counters) {
  return Object.fromEntries(EXTERNAL_NOTIFICATION_CHANNELS.map(channelName => [
    channelName,
    () => {
      counters.construct[channelName] += 1;
      return {
        name: channelName,
        async send() {
          counters.send += 1;
          return { delivered: true, messageId: `fake-${channelName}` };
        },
        async verify() {
          counters.verify += 1;
          return { ok: true };
        },
      };
    },
  ]));
}

function makeCounters() {
  return {
    construct: Object.fromEntries(EXTERNAL_NOTIFICATION_CHANNELS.map(name => [name, 0])),
    send: 0,
    verify: 0,
  };
}

function setupRequest(routeKey, headers = { 'x-admin-token': SETUP_ADMIN_TOKEN }, rawHeaders) {
  const effectiveRawHeaders = rawHeaders === undefined
    ? Object.entries(headers).flatMap(([name, value]) => [name, value])
    : rawHeaders;
  return {
    headers,
    rawHeaders: effectiveRawHeaders,
    url: routeKey.split(' ')[1],
  };
}

async function invokeSetupRoute(routes, routeKey, req = setupRequest(routeKey)) {
  return await routes[routeKey](req, {});
}

function createSetupRouteHarness(wizard, parseBody, {
  requireSetupAdminAuth = createStrictAdminTokenGuard({
    expectedToken: SETUP_ADMIN_TOKEN,
  }),
} = {}) {
  let response = null;
  const routes = createSetupRoutes(wizard, {
    parseBody,
    requireSetupAdminAuth,
    sendJSON(_res, status, body) {
      response = { status, body };
      return response;
    },
  });
  return {
    routes,
    response: () => response,
    reset: () => { response = null; },
  };
}

function assertErrorCode(callback, expectedCode) {
  const error = captureError(callback);
  assert.equal(error.code, expectedCode);
}

function readSource(relativePath) {
  return readFileSync(join(REPOSITORY_ROOT, relativePath), 'utf8');
}

function sliceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing source start marker: ${start}`);
  assert.notEqual(endIndex, -1, `Missing source end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

suite('M1 notification credential scope');

await testAsync('channel, startup and setup authority is exact, default-off and no-effect', async () => {
  assert.deepEqual(SETUP_NOTIFICATION_PATHS, [
    'notifications.email.from',
    'notifications.email.smtp',
    'notifications.email.to',
    'notifications.ntfy.server',
    'notifications.ntfy.topic',
    'notifications.telegram.chatId',
    'notifications.telegram.token',
  ]);
  assert.deepEqual(PAIASS_NOTIFICATION_PATHS, [
    'notifications.discordWebhook',
    'notifications.emailAddresses',
    'notifications.slackChannel',
    'notifications.slackWebhook',
    'notifications.smsApiKey',
    'notifications.smsPhone',
    'notifications.smsSecret',
    'notifications.telegramChatId',
    'notifications.telegramToken',
    'notifications.webhookUrl',
  ]);
  assert.equal(Object.isFrozen(SETUP_NOTIFICATION_PATHS), true);
  assert.equal(Object.isFrozen(PAIASS_NOTIFICATION_PATHS), true);

  const cliDatabasePath = resolve(tmpdir(), 'm1-c3-cli.sqlite');
  const cliDataDir = resolve(tmpdir(), 'm1-c3-data');
  const cliManifestPath = resolve(tmpdir(), 'm1-c3-manifest.json');
  const censusOptions = parseMigrationCliArguments([
    '--census',
    '--db', cliDatabasePath,
    '--data-dir', cliDataDir,
  ]);
  assert.equal(Object.isFrozen(censusOptions), true);
  assert.equal(censusOptions.mode, 'CENSUS');
  assert.deepEqual(censusOptions.historicalEnvironmentPaths, []);
  assertErrorCode(() => parseMigrationCliArguments([
    '--census', '--db', 'relative.sqlite', '--data-dir', cliDataDir,
  ]), 'MIGRATION_DATABASE_PATH_INVALID');
  assertErrorCode(() => parseMigrationCliArguments([
    '--apply', '--db', cliDatabasePath, '--data-dir', cliDataDir,
    '--manifest', cliManifestPath, '--manifest-sha256', 'a'.repeat(64),
  ]), 'MIGRATION_QUIESCENCE_ATTESTATION_REQUIRED');
  assertErrorCode(() => parseMigrationCliArguments([
    '--census', '--db', cliDatabasePath, '--data-dir', cliDataDir,
    '--project-root', resolve(tmpdir(), 'forbidden-root'),
  ]), 'MIGRATION_CLI_INVALID');
  const applyOptions = parseMigrationCliArguments([
    '--apply', '--db', cliDatabasePath, '--data-dir', cliDataDir,
    '--manifest', cliManifestPath, '--manifest-sha256', 'a'.repeat(64),
    '--attest-server-stopped', '--attest-workers-stopped',
  ]);
  assert.equal(applyOptions.mode, 'APPLY');
  assert.equal(applyOptions.attestServerStopped, true);
  assert.equal(applyOptions.attestWorkersStopped, true);
  const decisionsPath = resolve(tmpdir(), 'm1-c3-decisions.json');
  const planOptions = parseMigrationCliArguments([
    '--plan', '--db', cliDatabasePath, '--data-dir', cliDataDir,
    '--decisions', decisionsPath, '--decisions-sha256', 'b'.repeat(64),
    '--manifest', cliManifestPath,
  ]);
  assert.equal(planOptions.mode, 'PLAN');
  assert.equal(planOptions.decisionsPath, decisionsPath);
  assert.equal(planOptions.manifestPath, cliManifestPath);
  assertErrorCode(() => parseMigrationCliArguments([
    '--census', '--db', cliDatabasePath, '--data-dir', cliDataDir,
    '--decisions', decisionsPath, '--decisions-sha256', 'b'.repeat(64),
  ]), 'MIGRATION_CLI_INVALID');

  const paiassPreimage = Buffer.from(
    ' {\n  "notifications":{"emailAddresses":["one@example.invalid",{"kind":"nested"}],"unknown":"keep"},\n  "foreign":true\n}\n',
    'utf8',
  );
  const paiassDocument = JSON.parse(paiassPreimage.toString('utf8'));
  const paiassValue = paiassDocument.notifications.emailAddresses;
  const paiassValueSha256 = createHash('sha256')
    .update(Buffer.from(JSON.stringify(paiassValue), 'utf8'))
    .digest('hex');
  delete paiassDocument.notifications.emailAddresses;
  const paiassPostimage = Buffer.from(JSON.stringify(paiassDocument), 'utf8');
  const purgeReceipt = createPaiassReceipt({
    action: MIGRATION_ACTION.PURGE,
    preimageBytes: paiassPreimage,
    postimageBytes: paiassPostimage,
    pathDigests: [{
      path: 'notifications.emailAddresses',
      valueSha256: paiassValueSha256,
    }],
  });
  assert.equal(Object.isFrozen(purgeReceipt), true);
  assert.equal(Object.isFrozen(purgeReceipt.pathDigests), true);
  assert.deepEqual(Object.keys(purgeReceipt), [
    'schema',
    'source',
    'action',
    'preimageSha256',
    'postimageSha256',
    'pathDigests',
  ]);
  assert.equal(purgeReceipt.schema, LEGACY_CREDENTIAL_RECEIPT_SCHEMA);
  assert.equal(purgeReceipt.source, 'PAIASS_SETTINGS');
  assert.equal(purgeReceipt.action, 'PURGE');
  assert.equal(
    purgeReceipt.preimageSha256,
    createHash('sha256').update(paiassPreimage).digest('hex'),
  );
  assert.equal(
    purgeReceipt.postimageSha256,
    createHash('sha256').update(paiassPostimage).digest('hex'),
  );
  assert.equal(purgeReceipt.pathDigests[0].valueSha256, paiassValueSha256);
  assert.equal(JSON.stringify(purgeReceipt).includes('one@example.invalid'), false);
  assert.deepEqual(createPaiassReceipt({
    action: MIGRATION_ACTION.PURGE,
    preimageBytes: paiassPreimage,
    postimageBytes: paiassPostimage,
    pathDigests: [{
      path: 'notifications.emailAddresses',
      valueSha256: paiassValueSha256,
    }],
  }), purgeReceipt);
  const exportReceipt = createPaiassReceipt({
    action: MIGRATION_ACTION.EXPORT,
    preimageBytes: paiassPreimage,
    postimageBytes: paiassPostimage,
    pathDigests: [{
      path: 'notifications.emailAddresses',
      valueSha256: paiassValueSha256,
    }],
    exportSha256: paiassValueSha256,
  });
  assert.deepEqual(Object.keys(exportReceipt), [
    'schema',
    'source',
    'action',
    'preimageSha256',
    'postimageSha256',
    'pathDigests',
    'exportSha256',
  ]);
  assertErrorCode(() => createPaiassReceipt({
    action: MIGRATION_ACTION.PURGE,
    preimageBytes: paiassPreimage,
    postimageBytes: paiassPostimage,
    pathDigests: [{
      path: 'notifications.emailAddresses',
      valueSha256: paiassValueSha256.toUpperCase(),
    }],
  }), 'MIGRATION_RECEIPT_INVALID');
  assertErrorCode(() => createPaiassReceipt({
    action: MIGRATION_ACTION.PURGE,
    preimageBytes: paiassPreimage,
    postimageBytes: paiassPostimage,
    pathDigests: [{
      path: 'notifications.futureSecret',
      valueSha256: paiassValueSha256,
    }],
  }), 'MIGRATION_RECEIPT_INVALID');

  assert.deepEqual(SETUP_ENV_OWNED_KEYS, EXPECTED_SETUP_ENV_KEYS);
  assert.deepEqual(NOTIFICATION_ENV_OWNED_KEYS, EXPECTED_NOTIFICATION_ENV_KEYS);
  assert.deepEqual(
    LEGACY_NOTIFICATION_ENV_DELETE_ONLY_KEYS,
    EXPECTED_LEGACY_NOTIFICATION_ENV_KEYS,
  );
  for (const ownerSet of [
    SETUP_ENV_OWNED_KEYS,
    NOTIFICATION_ENV_OWNED_KEYS,
    LEGACY_NOTIFICATION_ENV_DELETE_ONLY_KEYS,
  ]) {
    assert.equal(Object.isFrozen(ownerSet), true);
    assert.equal(new Set(ownerSet).size, ownerSet.length);
  }
  assert.equal(new Set([
    ...SETUP_ENV_OWNED_KEYS,
    ...NOTIFICATION_ENV_OWNED_KEYS,
    ...LEGACY_NOTIFICATION_ENV_DELETE_ONLY_KEYS,
  ]).size, 24);
  assert.deepEqual(ROOT_ENVIRONMENT_OWNER, {
    SETUP: 'SETUP',
    NOTIFICATION: 'NOTIFICATION',
    LEGACY_NOTIFICATION_SCRUB: 'LEGACY_NOTIFICATION_SCRUB',
  });
  assert.equal(Object.isFrozen(ROOT_ENVIRONMENT_OWNER), true);

  assert.deepEqual(EXTERNAL_NOTIFICATION_CHANNEL_FLAGS, EXPECTED_CHANNEL_FLAGS);
  assert.deepEqual([...EXTERNAL_NOTIFICATION_CHANNELS], Object.keys(EXPECTED_CHANNEL_FLAGS));
  assert.equal(Object.isFrozen(EXTERNAL_NOTIFICATION_CHANNEL_FLAGS), true);
  assert.equal(Object.isFrozen(EXTERNAL_NOTIFICATION_CHANNELS), true);

  const defaultCounters = makeCounters();
  const defaultRouter = createNotificationRouter({
    ...RUNTIME_NOTIFICATION_DEPENDENCIES,
    env: {},
    channelFactories: fakeChannelFactories(defaultCounters),
    logger: SILENT_LOGGER,
  });
  assert.deepEqual(defaultRouter.getAvailableChannels(), ['in_app', 'mobile']);
  assert.equal(Object.values(defaultCounters.construct).reduce((a, b) => a + b, 0), 0);
  assert.deepEqual(
    await defaultRouter.send({ channel: 'in_app', agentId: 'local' }),
    { delivered: true, channel: 'in_app' },
  );

  for (const [channelName, envName] of Object.entries(EXPECTED_CHANNEL_FLAGS)) {
    const counters = makeCounters();
    const router = createNotificationRouter({
      ...RUNTIME_NOTIFICATION_DEPENDENCIES,
      env: { [envName]: 'true' },
      channelFactories: fakeChannelFactories(counters),
      logger: SILENT_LOGGER,
    });
    assert.deepEqual(router.getAvailableChannels(), ['in_app', 'mobile', channelName]);
    assert.equal(counters.construct[channelName], 1);
    assert.equal(Object.values(counters.construct).reduce((a, b) => a + b, 0), 1);

    const offCounters = makeCounters();
    const offRouter = createNotificationRouter({
      ...RUNTIME_NOTIFICATION_DEPENDENCIES,
      env: { [envName]: 'false' },
      channelFactories: fakeChannelFactories(offCounters),
      logger: SILENT_LOGGER,
    });
    assert.deepEqual(offRouter.getAvailableChannels(), ['in_app', 'mobile']);
    assert.equal(Object.values(offCounters.construct).reduce((a, b) => a + b, 0), 0);

    const invalidCounters = makeCounters();
    const invalid = captureError(() => createNotificationRouter({
      ...RUNTIME_NOTIFICATION_DEPENDENCIES,
      env: { [envName]: 'TRUE' },
      channelFactories: fakeChannelFactories(invalidCounters),
      logger: SILENT_LOGGER,
    }));
    assert.equal(invalid.code, NOTIFICATION_CHANNEL_POLICY_INVALID);
    assert.equal(Object.values(invalidCounters.construct).reduce((a, b) => a + b, 0), 0);
  }

  const partialCounters = makeCounters();
  assertErrorCode(() => createNotificationRouter({
    ...RUNTIME_NOTIFICATION_DEPENDENCIES,
    env: {
      C3_ENABLE_NOTIFICATION_EMAIL: 'true',
      C3_ENABLE_NOTIFICATION_DESKTOP: '1',
    },
    channelFactories: fakeChannelFactories(partialCounters),
    logger: SILENT_LOGGER,
  }), NOTIFICATION_CHANNEL_POLICY_INVALID);
  assert.equal(Object.values(partialCounters.construct).reduce((a, b) => a + b, 0), 0);

  const inheritedEnv = Object.create({ C3_ENABLE_NOTIFICATION_EMAIL: 'true' });
  assert.equal(readNotificationChannelPolicy(inheritedEnv).enabled.email, false);

  const disabledSend = await defaultRouter.send({ channel: 'email', title: 'no effect' });
  assert.equal(disabledSend.code, NOTIFICATION_CHANNEL_DISABLED);
  assert.equal((await defaultRouter.testChannel('email', 'nobody')).code, NOTIFICATION_CHANNEL_DISABLED);
  assert.equal((await defaultRouter.send({ channel: 'slack' })).code, NOTIFICATION_CHANNEL_UNSUPPORTED);
  assert.equal((await defaultRouter.testChannel('slack', 'nobody')).code, NOTIFICATION_CHANNEL_UNSUPPORTED);
  assert.equal(Object.hasOwn(defaultRouter, 'updateChannelConfig'), false);
  assert.equal(typeof defaultRouter.updateChannelConfig, 'undefined');
  assert.equal(defaultRouter.registerChannel({ name: 'ntfy', async send() {} }), false);
  assert.deepEqual(
    { send: defaultCounters.send, verify: defaultCounters.verify },
    { send: 0, verify: 0 },
  );

  // WP028 CORE evidence lives in this existing program: the install-root
  // reader, opaque capability and the real default webhook factory are one
  // authority boundary, exercised without an outbound request.
  const authorityProjectRoot = resolve(mkdtempSync(join(tmpdir(), 'm1-webhook-authority-')));
  const authorityForeignRoot = resolve(mkdtempSync(join(tmpdir(), 'm1-webhook-foreign-cwd-')));
  const authorityEnvPath = join(authorityProjectRoot, '.env');
  const authorityOriginalCwd = process.cwd();
  const hadOwnFetch = Object.hasOwn(globalThis, 'fetch');
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;
  const hadOwnWebhookUrl = Object.hasOwn(process.env, 'C3_WEBHOOK_URL');
  const originalWebhookUrl = process.env.C3_WEBHOOK_URL;
  const deterministicPayload = '{"fixture":"wp028"}';
  const deterministicTimestamp = 1_700_000_000_123;
  const expectedHmac = (secret, payload, timestamp) => `sha256=${createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex')}`;
  const installAuthorityEnv = (content, mode = 0o600) => {
    rmSync(authorityEnvPath, { recursive: true, force: true });
    if (content === null) return;
    writeFileSync(authorityEnvPath, content);
    chmodSync(authorityEnvPath, mode);
  };
  const assertExactAuthorityStatus = (authority, expected) => {
    const status = authority.status();
    assert.equal(authority.status(), status);
    assert.equal(Object.isFrozen(status), true);
    assert.deepEqual(Object.keys(status), ['configured', 'source']);
    assert.deepEqual(status, expected);
    return status;
  };
  const assertTypedAuthorityError = (callback, expectedCode) => {
    const error = captureError(callback);
    assert.equal(error.name, 'WebhookSecretAuthorityError');
    assert.equal(error.code, expectedCode);
    assert.equal(error.message, expectedCode);
    return error;
  };

  try {
    writeFileSync(
      join(authorityForeignRoot, '.env'),
      'C3_WEBHOOK_SECRET=foreign-cwd-secret\nFOREIGN_CWD_CANARY=must-not-load\n',
    );
    chmodSync(join(authorityForeignRoot, '.env'), 0o600);
    process.chdir(authorityForeignRoot);

    const rootWithSecret = [
      'C3_WEBHOOK_SECRET=root-file-secret',
      'ROOT_NON_SECRET=loaded-from-install-root',
      '',
    ].join('\n');
    const authorityCases = [
      {
        name: 'process nonempty',
        root: rootWithSecret,
        environment: () => ({ C3_WEBHOOK_SECRET: 'process-secret' }),
        expected: { configured: true, source: 'PROCESS_ENV' },
        secret: 'process-secret',
      },
      {
        name: 'process empty',
        root: rootWithSecret,
        environment: () => ({ C3_WEBHOOK_SECRET: '' }),
        expected: { configured: false, source: 'PROCESS_ENV' },
        secret: '',
      },
      {
        name: 'process whitespace',
        root: rootWithSecret,
        environment: () => ({ C3_WEBHOOK_SECRET: '   ' }),
        expected: { configured: true, source: 'PROCESS_ENV' },
        secret: '   ',
      },
      {
        name: 'inherited process key',
        root: rootWithSecret,
        environment: () => Object.create({ C3_WEBHOOK_SECRET: 'prototype-secret' }),
        expected: { configured: true, source: 'ROOT_ENV_FILE' },
        secret: 'root-file-secret',
      },
      {
        name: 'root nonempty',
        root: rootWithSecret,
        environment: () => ({}),
        expected: { configured: true, source: 'ROOT_ENV_FILE' },
        secret: 'root-file-secret',
      },
      {
        name: 'root empty',
        root: 'C3_WEBHOOK_SECRET=\nROOT_NON_SECRET=loaded-from-install-root\n',
        environment: () => ({}),
        expected: { configured: false, source: 'ROOT_ENV_FILE' },
        secret: '',
      },
      {
        name: 'root key absent',
        root: 'ROOT_NON_SECRET=loaded-from-install-root\n',
        environment: () => ({}),
        expected: { configured: false, source: 'ROOT_ENV_FILE' },
        secret: '',
      },
      {
        name: 'root file absent',
        root: null,
        environment: () => ({}),
        expected: { configured: false, source: 'ROOT_ENV_FILE' },
        secret: '',
      },
    ];

    for (const authorityCase of authorityCases) {
      installAuthorityEnv(authorityCase.root);
      const processEnvironment = authorityCase.environment();
      const processOwnedSecretBefore = Object.hasOwn(processEnvironment, 'C3_WEBHOOK_SECRET');
      const authority = readWebhookSecretAuthority({
        projectRoot: authorityProjectRoot,
        processEnvironment,
      });
      assertExactAuthorityStatus(authority, authorityCase.expected);
      assert.equal(Object.isFrozen(authority), true, authorityCase.name);
      assert.equal(Object.getPrototypeOf(authority), null, authorityCase.name);
      assert.deepEqual(Object.keys(authority), [], authorityCase.name);
      assert.deepEqual(Reflect.ownKeys(authority).sort(), ['sign', 'status'], authorityCase.name);
      assert.equal(Object.getOwnPropertyDescriptor(authority, 'sign').enumerable, false);
      assert.equal(Object.getOwnPropertyDescriptor(authority, 'status').enumerable, false);
      assert.equal(JSON.stringify(authority), '{}', authorityCase.name);
      assert.equal(requireWebhookSecretAuthority(authority), authority, authorityCase.name);
      assert.equal(Object.hasOwn(processEnvironment, 'C3_WEBHOOK_SECRET'), processOwnedSecretBefore);
      assert.equal(Object.hasOwn(processEnvironment, 'FOREIGN_CWD_CANARY'), false);
      if (authorityCase.root?.includes('ROOT_NON_SECRET=')) {
        assert.equal(processEnvironment.ROOT_NON_SECRET, 'loaded-from-install-root');
      }
      if (authorityCase.expected.source === 'ROOT_ENV_FILE') {
        assert.equal(Object.hasOwn(processEnvironment, 'C3_WEBHOOK_SECRET'), false);
      }
      if (authorityCase.expected.configured) {
        assert.equal(
          authority.sign(deterministicPayload, deterministicTimestamp),
          expectedHmac(authorityCase.secret, deterministicPayload, deterministicTimestamp),
          authorityCase.name,
        );
      } else {
        assertTypedAuthorityError(
          () => authority.sign(deterministicPayload, deterministicTimestamp),
          WEBHOOK_SECRET_NOT_CONFIGURED,
        );
      }
    }

    installAuthorityEnv(rootWithSecret, 0o600);
    assertTypedAuthorityError(() => readRuntimeEnvironmentAuthorities({
      projectRoot: authorityProjectRoot,
      processEnvironment: { C3_SMTP_HOST: 2525 },
    }), WEBHOOK_SECRET_SOURCE_UNSAFE);

    installAuthorityEnv('C3_WEBHOOK_SECRET=root-must-not-bypass-mode\n', 0o644);
    assertTypedAuthorityError(() => readWebhookSecretAuthority({
      projectRoot: authorityProjectRoot,
      processEnvironment: { C3_WEBHOOK_SECRET: 'process-would-win' },
    }), WEBHOOK_SECRET_SOURCE_UNSAFE);

    const symlinkTarget = join(authorityForeignRoot, 'webhook-secret-target');
    writeFileSync(symlinkTarget, 'C3_WEBHOOK_SECRET=symlink-secret\n');
    chmodSync(symlinkTarget, 0o600);
    rmSync(authorityEnvPath, { force: true });
    symlinkSync(symlinkTarget, authorityEnvPath);
    assertTypedAuthorityError(() => readWebhookSecretAuthority({
      projectRoot: authorityProjectRoot,
      processEnvironment: { C3_WEBHOOK_SECRET: 'process-would-win' },
    }), WEBHOOK_SECRET_SOURCE_UNSAFE);
    assert.equal(readFileSync(symlinkTarget, 'utf8'), 'C3_WEBHOOK_SECRET=symlink-secret\n');

    installAuthorityEnv('C3_WEBHOOK_SECRET=root-snapshot-a\n', 0o600);
    const rootSnapshotEnvironment = {};
    const rootSnapshotAuthority = readWebhookSecretAuthority({
      projectRoot: authorityProjectRoot,
      processEnvironment: rootSnapshotEnvironment,
    });
    const rootSnapshotStatus = assertExactAuthorityStatus(rootSnapshotAuthority, {
      configured: true,
      source: 'ROOT_ENV_FILE',
    });
    const rootSnapshotSignature = expectedHmac(
      'root-snapshot-a',
      deterministicPayload,
      deterministicTimestamp,
    );
    assert.equal(
      rootSnapshotAuthority.sign(deterministicPayload, deterministicTimestamp),
      rootSnapshotSignature,
    );
    assert.equal(Object.hasOwn(rootSnapshotEnvironment, 'C3_WEBHOOK_SECRET'), false);

    installAuthorityEnv('C3_WEBHOOK_SECRET=root-snapshot-b\n', 0o600);
    assert.equal(rootSnapshotAuthority.status(), rootSnapshotStatus);
    assert.equal(
      rootSnapshotAuthority.sign(deterministicPayload, deterministicTimestamp),
      rootSnapshotSignature,
    );
    const restartedRootAuthority = readWebhookSecretAuthority({
      projectRoot: authorityProjectRoot,
      processEnvironment: {},
    });
    assert.equal(
      restartedRootAuthority.sign(deterministicPayload, deterministicTimestamp),
      expectedHmac('root-snapshot-b', deterministicPayload, deterministicTimestamp),
    );

    installAuthorityEnv([
      'C3_WEBHOOK_SECRET=root-snapshot-b',
      'C3_WEBHOOK_URL=https://root-webhook.invalid/hook',
      'C3_SMTP_HOST=root-smtp.invalid',
      'C3_SMTP_USER=root-user',
      'ROOT_NON_SECRET=single-read-ambient',
      '',
    ].join('\n'), 0o600);
    const mutableProcessEnvironment = {
      C3_WEBHOOK_SECRET: 'process-snapshot-a',
      C3_WEBHOOK_URL: 'https://injected-webhook.invalid/hook',
      C3_SMTP_HOST: '',
    };
    const processSnapshotAuthorities = readRuntimeEnvironmentAuthorities({
      projectRoot: authorityProjectRoot,
      processEnvironment: mutableProcessEnvironment,
    });
    const processSnapshotAuthority = processSnapshotAuthorities.webhookSecretAuthority;
    const processNotificationAuthority =
      processSnapshotAuthorities.notificationEnvironmentAuthority;
    assert.equal(Object.isFrozen(processNotificationAuthority), true);
    assert.equal(Object.getPrototypeOf(processNotificationAuthority), null);
    assert.deepEqual(Object.keys(processNotificationAuthority), []);
    assert.deepEqual(Reflect.ownKeys(processNotificationAuthority).sort(), ['status', 'value']);
    assert.equal(JSON.stringify(processNotificationAuthority), '{}');
    assert.equal(
      requireNotificationEnvironmentAuthority(processNotificationAuthority),
      processNotificationAuthority,
    );
    const notificationStatus = processNotificationAuthority.status();
    assert.equal(Object.isFrozen(notificationStatus), true);
    assert.deepEqual(Object.keys(notificationStatus), EXPECTED_NOTIFICATION_ENV_KEYS);
    for (const leaf of Object.values(notificationStatus)) {
      assert.equal(Object.isFrozen(leaf), true);
      assert.deepEqual(Object.keys(leaf), ['configured', 'source']);
    }
    assert.deepEqual(notificationStatus.C3_SMTP_HOST, {
      configured: false,
      source: 'PROCESS_ENV',
    });
    assert.deepEqual(notificationStatus.C3_SMTP_USER, {
      configured: true,
      source: 'ROOT_ENV_FILE',
    });
    assert.equal(
      processSnapshotAuthority.status(),
      notificationStatus.C3_WEBHOOK_SECRET,
    );
    assert.equal(mutableProcessEnvironment.ROOT_NON_SECRET, 'single-read-ambient');
    assert.equal(mutableProcessEnvironment.C3_SMTP_HOST, '');
    assert.equal(Object.hasOwn(mutableProcessEnvironment, 'C3_SMTP_USER'), false);
    assert.equal(Object.hasOwn(mutableProcessEnvironment, 'C3_NTFY_URL'), false);
    assertErrorCode(
      () => processNotificationAuthority.value('C3_NTFY_URL'),
      NOTIFICATION_ENVIRONMENT_AUTHORITY_INVALID,
    );
    assertErrorCode(
      () => requireNotificationEnvironmentAuthority(Object.freeze(Object.create(null))),
      NOTIFICATION_ENVIRONMENT_AUTHORITY_INVALID,
    );

    let notificationRouteResponse = null;
    let notificationRouteParseCalls = 0;
    let notificationRouteDbCalls = 0;
    const notificationRoutes = createNotificationRoutes({
      notificationRouter: { channels: new Map(), getAvailableChannels: () => ['in_app'] },
      notificationEnvironmentAuthority: processNotificationAuthority,
      requireNotificationEnvironmentAuthority,
      db: {
        prepare() {
          notificationRouteDbCalls += 1;
          throw new Error('DB must stay unreachable');
        },
      },
      async parseBody() {
        notificationRouteParseCalls += 1;
        throw new Error('body must stay unread');
      },
      sendJSON(_res, status, body) {
        notificationRouteResponse = { status, body };
        return notificationRouteResponse;
      },
    });
    notificationRoutes['GET /api/notifications/config']({}, {});
    assert.deepEqual(notificationRouteResponse, {
      status: 200,
      body: { sources: notificationStatus },
    });
    notificationRoutes['POST /api/notifications/config']({}, {});
    assert.deepEqual(notificationRouteResponse, {
      status: 410,
      body: { ok: false, code: 'CREDENTIAL_SOURCE_READ_ONLY' },
    });
    assert.equal(notificationRouteParseCalls, 0);
    assert.equal(notificationRouteDbCalls, 0);

    let observedTestRecipient = 'NOT_CALLED';
    const notificationTestRoutes = createNotificationRoutes({
      notificationRouter: {
        channels: new Map(),
        getAvailableChannels: () => ['in_app'],
        async testChannel(_channel, recipient) {
          observedTestRecipient = recipient;
          return { ok: false, error: 'fixture' };
        },
      },
      notificationEnvironmentAuthority: processNotificationAuthority,
      requireNotificationEnvironmentAuthority,
      db: { prepare() { throw new Error('DB must stay unreachable'); } },
      async parseBody() { return { channel: 'telegram' }; },
      sendJSON() {},
    });
    await notificationTestRoutes['POST /api/notifications/test']({}, {});
    assert.equal(observedTestRecipient, undefined);

    let realFactoryFetchCalls = 0;
    globalThis.fetch = () => {
      realFactoryFetchCalls += 1;
      throw new Error('disabled/missing notification config reached fetch');
    };
    const realFactoryRouter = createNotificationRouter({
      env: {
        C3_ENABLE_NOTIFICATION_EMAIL: 'true',
        C3_ENABLE_NOTIFICATION_TELEGRAM: 'true',
        C3_ENABLE_NOTIFICATION_PUSH: 'true',
      },
      logger: SILENT_LOGGER,
      notificationEnvironmentAuthority: processNotificationAuthority,
      requireNotificationEnvironmentAuthority,
      requireWebhookSecretAuthority,
      webhookSecretAuthority: processSnapshotAuthority,
    });
    assert.equal(realFactoryRouter.channels.get('email') instanceof EmailChannel, true);
    assert.equal(realFactoryRouter.channels.get('telegram') instanceof TelegramChannel, true);
    assert.equal(realFactoryRouter.channels.get('push') instanceof PushChannel, true);
    assert.equal((await realFactoryRouter.channels.get('email').send({ recipient: '' })).delivered, false);
    assert.equal((await realFactoryRouter.channels.get('email').send({ recipient: 'nobody@example.invalid' })).delivered, false);
    assert.equal((await realFactoryRouter.testChannel('email', undefined)).ok, false);
    assert.equal((await realFactoryRouter.channels.get('telegram').send({})).delivered, false);
    assert.equal((await realFactoryRouter.channels.get('telegram').send({ recipient: 'explicit' })).delivered, false);
    assert.equal((await realFactoryRouter.channels.get('push').send({})).delivered, false);
    assert.equal(realFactoryFetchCalls, 0);

    installAuthorityEnv([
      'C3_TELEGRAM_BOT_TOKEN=root-token-must-not-win',
      'C3_TELEGRAM_CHAT_ID=root-chat-must-not-win',
      'C3_NTFY_TOPIC=root-topic-must-not-win',
      '',
    ].join('\n'), 0o600);
    const ownEmptyAuthorities = readRuntimeEnvironmentAuthorities({
      projectRoot: authorityProjectRoot,
      processEnvironment: {
        C3_TELEGRAM_BOT_TOKEN: '',
        C3_TELEGRAM_CHAT_ID: '',
        C3_NTFY_TOPIC: '',
      },
    });
    for (const key of [
      'C3_TELEGRAM_BOT_TOKEN',
      'C3_TELEGRAM_CHAT_ID',
      'C3_NTFY_TOPIC',
    ]) {
      assert.deepEqual(ownEmptyAuthorities.notificationEnvironmentAuthority.status()[key], {
        configured: false,
        source: 'PROCESS_ENV',
      });
    }
    const ownEmptyRouter = createNotificationRouter({
      env: {
        C3_ENABLE_NOTIFICATION_TELEGRAM: 'true',
        C3_ENABLE_NOTIFICATION_PUSH: 'true',
      },
      logger: SILENT_LOGGER,
      notificationEnvironmentAuthority:
        ownEmptyAuthorities.notificationEnvironmentAuthority,
      requireNotificationEnvironmentAuthority,
      requireWebhookSecretAuthority,
      webhookSecretAuthority: ownEmptyAuthorities.webhookSecretAuthority,
    });
    assert.equal((await ownEmptyRouter.channels.get('telegram').send({})).delivered, false);
    assert.equal((await ownEmptyRouter.channels.get('push').send({})).delivered, false);
    assert.equal(realFactoryFetchCalls, 0);

    installAuthorityEnv('ROOT_NON_SECRET=test-channel-authority\n', 0o600);
    const testChannelAuthorities = readRuntimeEnvironmentAuthorities({
      projectRoot: authorityProjectRoot,
      processEnvironment: {
        C3_TELEGRAM_BOT_TOKEN: 'test-channel-token',
        C3_TELEGRAM_CHAT_ID: '',
        C3_NTFY_SERVER: 'https://test-channel-ntfy.invalid',
        C3_NTFY_TOPIC: '',
        C3_NTFY_TOKEN: '',
        C3_WEBHOOK_URL: '',
        C3_WEBHOOK_SECRET: 'test-channel-secret',
      },
    });
    const testChannelFetches = [];
    globalThis.fetch = async (url, options = {}) => {
      const request = { url: String(url), options };
      testChannelFetches.push(request);
      if (request.url.endsWith('/getMe')) {
        return {
          ok: true,
          async json() { return { ok: true, result: { username: 'fixture_bot' } }; },
        };
      }
      if (request.url.endsWith('/sendMessage')) {
        return {
          ok: true,
          async json() { return { ok: true, result: { message_id: 17 } }; },
        };
      }
      if (request.url === 'https://test-channel-ntfy.invalid/v1/health') {
        return { ok: true, status: 200 };
      }
      if (request.url === 'https://test-channel-ntfy.invalid') {
        return {
          ok: true,
          status: 200,
          async json() { return { id: 'test-channel-push' }; },
        };
      }
      if (request.url === 'https://test-channel-webhook.invalid/hook') {
        return { ok: true, status: 204 };
      }
      throw new Error(`unexpected testChannel request: ${request.url}`);
    };
    const testChannelRouter = createNotificationRouter({
      env: {
        C3_ENABLE_NOTIFICATION_TELEGRAM: 'true',
        C3_ENABLE_NOTIFICATION_PUSH: 'true',
        C3_ENABLE_NOTIFICATION_WEBHOOK: 'true',
      },
      logger: SILENT_LOGGER,
      notificationEnvironmentAuthority:
        testChannelAuthorities.notificationEnvironmentAuthority,
      requireNotificationEnvironmentAuthority,
      requireWebhookSecretAuthority,
      webhookSecretAuthority: testChannelAuthorities.webhookSecretAuthority,
    });
    assert.equal((await testChannelRouter.testChannel('telegram', 'caller-chat')).ok, true);
    assert.equal((await testChannelRouter.testChannel('push', 'caller-topic')).ok, true);
    assert.equal(
      (await testChannelRouter.testChannel(
        'webhook',
        'https://test-channel-webhook.invalid/hook',
      )).ok,
      true,
    );
    assert.equal(
      JSON.parse(testChannelFetches.find(call => call.url.endsWith('/sendMessage')).options.body)
        .chat_id,
      'caller-chat',
    );
    assert.equal(
      JSON.parse(testChannelFetches.find(
        call => call.url === 'https://test-channel-ntfy.invalid',
      ).options.body).topic,
      'caller-topic',
    );
    const fetchesBeforeRejectedTestChannels = testChannelFetches.length;
    for (const [channel, recipient] of [
      ['telegram', undefined],
      ['telegram', { invalid: true }],
      ['push', undefined],
      ['push', ['invalid']],
      ['webhook', undefined],
      ['webhook', 'not a valid URL'],
    ]) {
      assert.equal((await testChannelRouter.testChannel(channel, recipient)).ok, false);
    }
    assert.equal(testChannelFetches.length, fetchesBeforeRejectedTestChannels);

    const canonicalChannelAuthorities = readRuntimeEnvironmentAuthorities({
      projectRoot: authorityProjectRoot,
      processEnvironment: {
        C3_TELEGRAM_BOT_TOKEN: 'canonical-channel-token',
        C3_TELEGRAM_CHAT_ID: 'canonical-chat',
        C3_NTFY_SERVER: 'https://test-channel-ntfy.invalid',
        C3_NTFY_TOPIC: 'canonical-topic',
        C3_WEBHOOK_URL: 'https://canonical-webhook.invalid/hook',
        C3_WEBHOOK_SECRET: 'canonical-channel-secret',
      },
    });
    const canonicalChannelRouter = createNotificationRouter({
      env: {
        C3_ENABLE_NOTIFICATION_TELEGRAM: 'true',
        C3_ENABLE_NOTIFICATION_PUSH: 'true',
        C3_ENABLE_NOTIFICATION_WEBHOOK: 'true',
      },
      logger: SILENT_LOGGER,
      notificationEnvironmentAuthority:
        canonicalChannelAuthorities.notificationEnvironmentAuthority,
      requireNotificationEnvironmentAuthority,
      requireWebhookSecretAuthority,
      webhookSecretAuthority: canonicalChannelAuthorities.webhookSecretAuthority,
    });
    assert.equal((await canonicalChannelRouter.channels.get('telegram').verify()).ok, true);
    assert.equal((await canonicalChannelRouter.channels.get('push').verify()).ok, true);
    assert.equal((await canonicalChannelRouter.channels.get('webhook').verify()).ok, true);

    mutableProcessEnvironment.C3_WEBHOOK_SECRET = 'process-snapshot-b';
    mutableProcessEnvironment.C3_WEBHOOK_URL = 'https://mutated-ambient.invalid/hook';
    assert.equal(
      processSnapshotAuthority.sign(deterministicPayload, deterministicTimestamp),
      expectedHmac('process-snapshot-a', deterministicPayload, deterministicTimestamp),
    );
    assert.equal(
      processNotificationAuthority.value('C3_WEBHOOK_URL'),
      'https://injected-webhook.invalid/hook',
    );
    const restartedProcessAuthorities = readRuntimeEnvironmentAuthorities({
      projectRoot: authorityProjectRoot,
      processEnvironment: mutableProcessEnvironment,
    });
    assert.equal(
      restartedProcessAuthorities.webhookSecretAuthority.sign(
        deterministicPayload,
        deterministicTimestamp,
      ),
      expectedHmac('process-snapshot-b', deterministicPayload, deterministicTimestamp),
    );

    const legacyDbFixture = {
      webhookSecret: 'LEGACY_DB_TOP_LEVEL_CANARY',
      'c3.notif.webhookSecret': 'LEGACY_DB_FLAT_CANARY',
    };
    const beforeLegacyScrubStatus = processSnapshotAuthority.status();
    const beforeLegacyScrubSignature = processSnapshotAuthority.sign(
      deterministicPayload,
      deterministicTimestamp,
    );
    delete legacyDbFixture.webhookSecret;
    delete legacyDbFixture['c3.notif.webhookSecret'];
    assert.deepEqual(legacyDbFixture, {});
    assert.equal(processSnapshotAuthority.status(), beforeLegacyScrubStatus);
    assert.equal(
      processSnapshotAuthority.sign(deterministicPayload, deterministicTimestamp),
      beforeLegacyScrubSignature,
    );
    for (const retiredSecret of ['LEGACY_DB_TOP_LEVEL_CANARY', 'LEGACY_DB_FLAT_CANARY']) {
      assert.notEqual(
        beforeLegacyScrubSignature,
        expectedHmac(retiredSecret, deterministicPayload, deterministicTimestamp),
      );
    }

    const forgedAuthority = Object.freeze({
      status: () => Object.freeze({ configured: true, source: 'PROCESS_ENV' }),
      sign: () => 'sha256=forged',
    });
    assertTypedAuthorityError(
      () => requireWebhookSecretAuthority(forgedAuthority),
      WEBHOOK_SECRET_AUTHORITY_INVALID,
    );
    assertTypedAuthorityError(() => new WebhookChannel({
      url: 'https://fake-webhook.invalid/forged',
      requireWebhookSecretAuthority,
      webhookSecretAuthority: forgedAuthority,
    }), WEBHOOK_SECRET_AUTHORITY_INVALID);
    assertErrorCode(() => new WebhookChannel({
      requireWebhookSecretAuthority,
      webhookSecretAuthority: processSnapshotAuthority,
    }), NOTIFICATION_ENVIRONMENT_AUTHORITY_INVALID);
    assertErrorCode(() => new WebhookChannel({
      url: null,
      requireWebhookSecretAuthority,
      webhookSecretAuthority: processSnapshotAuthority,
    }), NOTIFICATION_ENVIRONMENT_AUTHORITY_INVALID);
    const rawInjectionError = captureError(() => new WebhookChannel({
      url: 'https://fake-webhook.invalid/raw',
      secret: 'RAW_SECRET_CANARY',
      requireWebhookSecretAuthority,
      webhookSecretAuthority: processSnapshotAuthority,
    }));
    assert.equal(rawInjectionError.code, 'WEBHOOK_SECRET_RAW_INJECTION_RETIRED');
    assert.equal(rawInjectionError.message, 'WEBHOOK_SECRET_RAW_INJECTION_RETIRED');

    process.env.C3_WEBHOOK_URL = 'https://ambient-webhook-must-not-win.invalid/hook';
    Date.now = () => deterministicTimestamp;
    const fakeFetchCalls = [];
    globalThis.fetch = async (url, options) => {
      fakeFetchCalls.push({ url: String(url), options });
      return { ok: true, status: 204 };
    };
    const actualRouter = createNotificationRouter({
      env: { C3_ENABLE_NOTIFICATION_WEBHOOK: 'true' },
      logger: SILENT_LOGGER,
      notificationEnvironmentAuthority: processNotificationAuthority,
      requireNotificationEnvironmentAuthority,
      requireWebhookSecretAuthority,
      webhookSecretAuthority: processSnapshotAuthority,
    });
    const actualWebhookChannel = actualRouter.channels.get('webhook');
    assert.equal(actualWebhookChannel instanceof WebhookChannel, true);
    assert.equal(JSON.stringify(actualWebhookChannel).includes('injected-webhook'), false);
    assert.equal(Object.hasOwn(actualWebhookChannel, 'url'), false);
    assert.deepEqual(await actualWebhookChannel.verify(), { ok: true });
    const actualDelivery = await actualRouter.send({
      channel: 'webhook',
      title: 'WP028 fake delivery',
      body: 'no outbound request',
      agentId: 'fixture-agent',
      data: { fixture: true },
    });
    assert.equal(actualDelivery.delivered, true);
    assert.equal(fakeFetchCalls.length, 1);
    const [{ url: fetchedUrl, options: fetchedOptions }] = fakeFetchCalls;
    assert.equal(fetchedUrl, 'https://injected-webhook.invalid/hook');
    assert.equal(fetchedOptions.method, 'POST');
    const sentTimestamp = Number(fetchedOptions.headers['X-C3-Timestamp']);
    const sentPayload = JSON.parse(fetchedOptions.body);
    assert.equal(sentTimestamp, deterministicTimestamp);
    assert.equal(sentPayload.timestamp, sentTimestamp);
    assert.equal(
      fetchedOptions.headers['X-C3-Signature'],
      expectedHmac('process-snapshot-a', fetchedOptions.body, sentTimestamp),
    );

    installAuthorityEnv([
      'C3_WEBHOOK_SECRET=',
      'C3_WEBHOOK_URL=https://unconfigured-webhook.invalid/hook',
      '',
    ].join('\n'), 0o600);
    const unconfiguredAuthorities = readRuntimeEnvironmentAuthorities({
      projectRoot: authorityProjectRoot,
      processEnvironment: {},
    });
    const unconfiguredRouter = createNotificationRouter({
      env: { C3_ENABLE_NOTIFICATION_WEBHOOK: 'true' },
      logger: SILENT_LOGGER,
      notificationEnvironmentAuthority:
        unconfiguredAuthorities.notificationEnvironmentAuthority,
      requireNotificationEnvironmentAuthority,
      requireWebhookSecretAuthority,
      webhookSecretAuthority: unconfiguredAuthorities.webhookSecretAuthority,
    });
    const unconfiguredChannel = unconfiguredRouter.channels.get('webhook');
    assert.equal(unconfiguredChannel instanceof WebhookChannel, true);
    assert.equal((await unconfiguredChannel.verify()).ok, false);
    const fetchCountBeforeUnconfiguredSend = fakeFetchCalls.length;
    const unconfiguredDelivery = await unconfiguredRouter.send({
      channel: 'webhook',
      title: 'must stay local',
    });
    assert.equal(unconfiguredDelivery.delivered, false);
    assert.equal(fakeFetchCalls.length, fetchCountBeforeUnconfiguredSend);
  } finally {
    process.chdir(authorityOriginalCwd);
    Date.now = originalDateNow;
    if (hadOwnFetch) globalThis.fetch = originalFetch;
    else delete globalThis.fetch;
    if (hadOwnWebhookUrl) process.env.C3_WEBHOOK_URL = originalWebhookUrl;
    else delete process.env.C3_WEBHOOK_URL;
    rmSync(authorityProjectRoot, { recursive: true, force: true });
    rmSync(authorityForeignRoot, { recursive: true, force: true });
  }

  const runtimeEnvironmentSource = readSource('src/runtime-environment.js');
  const rootEnvironmentFileSource = readSource('src/security/root-environment-file.js');
  assert.match(
    rootEnvironmentFileSource,
    /const \{ O_NOFOLLOW, O_NONBLOCK \} = fs\.constants;/,
    'root env safe flags must come from fs.constants',
  );
  assert.match(runtimeEnvironmentSource, /readRootEnvironmentBootstrap/);
  assert.doesNotMatch(runtimeEnvironmentSource, /from 'node:fs'/);
  assert.doesNotMatch(
    runtimeEnvironmentSource,
    /dotenv\/config|process\.cwd\(|DOTENV_CONFIG_PATH/,
  );

  const webhookChannelSource = readSource('src/notifications/channels/webhook.js');
  assert.doesNotMatch(
    webhookChannelSource,
    /process\.env\.C3_WEBHOOK_(?:SECRET|URL)|this\.secret/,
  );
  for (const channelPath of [
    'src/notifications/channels/email.js',
    'src/notifications/channels/telegram.js',
    'src/notifications/channels/push.js',
  ]) {
    assert.doesNotMatch(readSource(channelPath), /process\.env/);
  }
  assert.doesNotMatch(readSource('src/notifications/index.js'), /channels\/ntfy\.js/);

  const serverSource = readSource('src/server.js');
  const serverNotificationInit = sliceBetween(
    serverSource,
    'const { pipeline: notificationPipeline, router: notificationRouter } = createNotificationPipeline({',
    "logger.info('Server', `Notification system initialized",
  );
  const serverRouteDependencies = sliceBetween(
    serverSource,
    'const routeDeps = {',
    '// v93: notificationRouter + notificationPipeline initialized above',
  );
  assert.equal(
    serverSource.indexOf("from './runtime-environment.js';")
      < serverSource.indexOf("import db from './db/database.js';"),
    true,
  );
  for (const dependency of [
    'notificationEnvironmentAuthority',
    'requireNotificationEnvironmentAuthority',
    'requireWebhookSecretAuthority',
    'webhookSecretAuthority',
  ]) {
    assert.match(serverNotificationInit, new RegExp(`\\b${dependency}\\b`));
    assert.match(serverRouteDependencies, new RegExp(`\\b${dependency}\\b`));
  }
  assert.doesNotMatch(serverSource, /NotificationEmitter|setNotificationEmitter/);
  assert.equal(existsSync(join(REPOSITORY_ROOT, 'src/notifications/emitter.js')), false);
  assert.doesNotMatch(
    readSource('src/planner/lifecycle-build.js'),
    /NotificationEmitter|notificationEmitter|emitLifecycleEvent/,
  );
  assert.match(serverSource, /key === 'GET \/api\/notifications\/config'/);
  assert.match(serverSource, /key === 'POST \/api\/notifications\/config'/);
  assert.match(
    serverSource,
    /createStrictAdminTokenGuard\(\{\s*expectedToken: process\.env\.C3_ADMIN_TOKEN,?\s*\}\)/,
  );
  assert.match(serverRouteDependencies, /\brequireSetupAdminAuth\b/);
  assert.equal(
    serverSource.indexOf('const requireSetupAdminAuth = createStrictAdminTokenGuard')
      < serverSource.indexOf('const routeDeps = {'),
    true,
  );

  const workerSource = readSource('scripts/start-workers.js');
  const workerNotificationInit = sliceBetween(
    workerSource,
    'const { pipeline, router } = createNotificationPipeline({',
    '// ── Check notification channels',
  );
  assert.equal(
    workerSource.indexOf("from '../src/runtime-environment.js';")
      < workerSource.indexOf("import Database from 'better-sqlite3';"),
    true,
  );
  for (const dependency of [
    'notificationEnvironmentAuthority',
    'requireNotificationEnvironmentAuthority',
    'requireWebhookSecretAuthority',
    'webhookSecretAuthority',
  ]) {
    assert.match(workerNotificationInit, new RegExp(`\\b${dependency}\\b`));
  }

  const exampleEnvironment = readSource('.env.example');
  for (const key of EXPECTED_NOTIFICATION_ENV_KEYS) {
    assert.equal(
      (exampleEnvironment.match(new RegExp(`^${key}=$`, 'gm')) || []).length,
      1,
      `${key} must occur exactly once with no example value`,
    );
  }
  for (const key of EXPECTED_LEGACY_NOTIFICATION_ENV_KEYS) {
    assert.equal(
      (exampleEnvironment.match(new RegExp(`^${key}=`, 'gm')) || []).length,
      0,
      `${key} is scrub-only and must not be advertised`,
    );
  }
  assert.match(exampleEnvironment, /install-root \.env regular, owner-owned, mode 0600/);
  assert.match(exampleEnvironment, /Restart IntentSmith after changing any value in this block/);

  const verifierEffects = { fetch: 0, transport: 0 };
  const disabledEmail = await verifyEmail({}, {
    env: {
      C3_ENABLE_NOTIFICATION_EMAIL: 'false',
      C3_SMTP_HOST: 'real-looking.invalid',
      C3_SMTP_USER: 'private-user',
      C3_SMTP_PASS: 'private-pass',
      C3_TEST_EMAIL: 'private@example.invalid',
    },
    channelPolicy: readNotificationChannelPolicy({
      C3_ENABLE_NOTIFICATION_EMAIL: 'true',
    }),
    createTransport() {
      verifierEffects.transport += 1;
      throw new Error('transport must stay unreachable');
    },
  });
  const disabledTelegram = await verifyTelegram({}, {
    env: {
      C3_ENABLE_NOTIFICATION_TELEGRAM: 'false',
      C3_TELEGRAM_BOT_TOKEN: 'private-token',
      C3_TELEGRAM_CHAT_ID: 'private-chat',
    },
    fetchImpl() {
      verifierEffects.fetch += 1;
      throw new Error('fetch must stay unreachable');
    },
  });
  const disabledNtfy = await verifyNtfy({}, {
    env: {
      C3_ENABLE_NOTIFICATION_PUSH: 'false',
      C3_NTFY_TOPIC: 'private-topic',
    },
    fetchImpl() {
      verifierEffects.fetch += 1;
      throw new Error('fetch must stay unreachable');
    },
  });
  assert.deepEqual(
    [disabledEmail.code, disabledTelegram.code, disabledNtfy.code],
    Array(3).fill(NOTIFICATION_CHANNEL_DISABLED),
  );
  assert.deepEqual(verifierEffects, { fetch: 0, transport: 0 });

  const verifierAuthorityRoot = resolve(mkdtempSync(join(tmpdir(), 'm1-verifier-authority-')));
  try {
    writeFileSync(join(verifierAuthorityRoot, '.env'), 'VERIFIER_AMBIENT=kept\n');
    chmodSync(join(verifierAuthorityRoot, '.env'), 0o600);
    const verifierAuthorities = readRuntimeEnvironmentAuthorities({
      projectRoot: verifierAuthorityRoot,
      processEnvironment: {
        C3_SMTP_HOST: 'fake-smtp.invalid',
        C3_SMTP_PORT: '2525',
        C3_SMTP_USER: 'fake-user',
        C3_SMTP_PASS: 'fake-pass',
        C3_SMTP_FROM: 'fake-from@example.invalid',
        C3_TELEGRAM_BOT_TOKEN: 'fake-token',
        C3_TELEGRAM_CHAT_ID: 'authority-chat',
        C3_NTFY_SERVER: 'https://fake-ntfy.invalid',
        C3_NTFY_TOPIC: 'authority-topic',
        C3_NTFY_TOKEN: '',
      },
    });
    const verifierAuthorityDeps = {
      notificationEnvironmentAuthority:
        verifierAuthorities.notificationEnvironmentAuthority,
      requireNotificationEnvironmentAuthority,
    };
    let capturedTransport = null;
    const missingEmailRecipient = await verifyEmail({}, {
      ...verifierAuthorityDeps,
      env: { C3_ENABLE_NOTIFICATION_EMAIL: 'true' },
      createTransport() {
        verifierEffects.transport += 1;
        throw new Error('missing recipient reached transport');
      },
    });
    assert.equal(missingEmailRecipient.configured, false);
    assert.equal(verifierEffects.transport, 0);

    const enabledEmail = await verifyEmail({ recipient: 'fake@example.invalid' }, {
      ...verifierAuthorityDeps,
      env: { C3_ENABLE_NOTIFICATION_EMAIL: 'true' },
      createTransport(options) {
        verifierEffects.transport += 1;
        capturedTransport = options;
        return {
          async verify() {},
          async sendMail() { return { messageId: 'fake-mail' }; },
        };
      },
    });
    assert.equal(enabledEmail.delivered, true);
    assert.equal(verifierEffects.transport, 1);
    assert.deepEqual(capturedTransport.auth, { user: 'fake-user', pass: 'fake-pass' });

    let telegramBody = null;
    const enabledTelegram = await verifyTelegram({}, {
      ...verifierAuthorityDeps,
      env: { C3_ENABLE_NOTIFICATION_TELEGRAM: 'true' },
      async fetchImpl(_url, options) {
        verifierEffects.fetch += 1;
        telegramBody = JSON.parse(options.body);
        return {
          async json() { return { ok: true, result: { message_id: 7 } }; },
        };
      },
    });
    assert.equal(enabledTelegram.delivered, true);
    assert.equal(telegramBody.chat_id, 'authority-chat');
    const fetchesBeforeEmptyTelegram = verifierEffects.fetch;
    assert.equal((await verifyTelegram({ recipient: '' }, {
      ...verifierAuthorityDeps,
      env: { C3_ENABLE_NOTIFICATION_TELEGRAM: 'true' },
      fetchImpl() {
        verifierEffects.fetch += 1;
        throw new Error('explicit empty Telegram recipient reached fetch');
      },
    })).configured, false);
    assert.equal(verifierEffects.fetch, fetchesBeforeEmptyTelegram);

    const enabledDefaultNtfy = await verifyNtfy({}, {
      ...verifierAuthorityDeps,
      env: { C3_ENABLE_NOTIFICATION_PUSH: 'true' },
      async fetchImpl(url) {
        verifierEffects.fetch += 1;
        assert.equal(url, 'https://fake-ntfy.invalid/authority-topic');
        return { ok: true, async json() { return { id: 'fake-default-push' }; } };
      },
    });
    assert.equal(enabledDefaultNtfy.delivered, true);
    const enabledExplicitNtfy = await verifyNtfy({ recipient: 'fake-topic' }, {
      ...verifierAuthorityDeps,
      env: { C3_ENABLE_NOTIFICATION_PUSH: 'true' },
      async fetchImpl(url) {
        verifierEffects.fetch += 1;
        assert.equal(url, 'https://fake-ntfy.invalid/fake-topic');
        return { ok: true, async json() { return { id: 'fake-push' }; } };
      },
    });
    assert.equal(enabledExplicitNtfy.delivered, true);
    const fetchesBeforeEmptyNtfy = verifierEffects.fetch;
    assert.equal((await verifyNtfy({ recipient: '' }, {
      ...verifierAuthorityDeps,
      env: { C3_ENABLE_NOTIFICATION_PUSH: 'true' },
      fetchImpl() {
        verifierEffects.fetch += 1;
        throw new Error('explicit empty ntfy recipient reached fetch');
      },
    })).configured, false);
    assert.equal(verifierEffects.fetch, fetchesBeforeEmptyNtfy);
  } finally {
    rmSync(verifierAuthorityRoot, { recursive: true, force: true });
  }

  const verifierSource = readSource('src/notifications/e2e-verify.js');
  assert.doesNotMatch(verifierSource, /C3_NTFY_URL|C3_TEST_EMAIL/);
  assert.match(verifierSource, /C3_NTFY_SERVER/);

  const unsupportedVerification = await verifyAll({ channels: ['slack'] }, { env: {} });
  assert.equal(unsupportedVerification.allPassed, false);
  assert.equal(unsupportedVerification.results[0].code, NOTIFICATION_CHANNEL_UNSUPPORTED);
  assert.equal(dryRun().every(result => result.proof === false && result.delivered === false), true);

  const root = mkdtempSync(join(tmpdir(), 'm1-notification-scope-'));
  const originalCwd = process.cwd();
  try {
    const canonicalRoot = join(root, 'install-root');
    const cwdDecoy = join(root, 'cwd-decoy');
    const dataDir = join(root, 'data');
    mkdirSync(canonicalRoot, { recursive: true });
    mkdirSync(cwdDecoy, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    process.chdir(cwdDecoy);
    const envPath = join(canonicalRoot, '.env');
    const setupPath = join(dataDir, 'c3-setup.json');
    const defaultWizard = new SetupWizard(join(root, 'new-default-data'), {
      projectRoot: canonicalRoot,
    });
    assert.deepEqual(defaultWizard.config.notifications, {
      telegram: { enabled: false },
      email: { enabled: false },
      ntfy: { enabled: false },
    });
    for (const channel of Object.values(defaultWizard.config.notifications)) {
      assert.deepEqual(Object.keys(channel), ['enabled']);
    }
    const legacyNotifications = {
      telegram: { enabled: true, token: 'legacy-token', chatId: 'legacy-chat' },
      email: { enabled: true, smtp: 'legacy-smtp', from: 'a', to: 'b' },
      ntfy: { enabled: true, topic: 'legacy-topic', server: 'https://legacy.invalid' },
      unknownChannel: { preserve: true },
    };
    const legacySetup = {
      version: 1,
      completed: false,
      completedAt: null,
      ollama: {
        url: 'http://127.0.0.1:11434',
        models: { CHAT: 'fixture-chat' },
        verified: false,
      },
      language: 'cs',
      notifications: legacyNotifications,
      dataDir: './data',
      license: { key: '', activated: false },
      unknownTopLevel: { preserve: 'exactly' },
    };
    writeFileSync(setupPath, JSON.stringify(legacySetup, null, 2));
    const wizard = new SetupWizard(dataDir, { projectRoot: canonicalRoot });
    wizard.load();
    wizard.config.ollama = { ...wizard.config.ollama, url: 'http://127.0.0.1:22444' };
    wizard.config.language = 'en';
    wizard.config.dataDir = './operator-data';
    wizard.config.license = { ...wizard.config.license, key: '' };

    assertErrorCode(() => createSetupRoutes(wizard, {
      parseBody: async () => ({}),
      sendJSON() {},
    }), SETUP_ADMIN_AUTH_REQUIRED);

    const deniedEffects = {
      checkModels: 0,
      complete: 0,
      isComplete: 0,
      parse: 0,
      verifyOllama: 0,
      writeEnvFile: 0,
    };
    const deniedWizard = new SetupWizard(join(root, 'denied-data'), {
      projectRoot: canonicalRoot,
    });
    deniedWizard.checkModels = async () => { deniedEffects.checkModels += 1; };
    deniedWizard.complete = () => { deniedEffects.complete += 1; };
    deniedWizard.isComplete = () => { deniedEffects.isComplete += 1; };
    deniedWizard.verifyOllama = async () => { deniedEffects.verifyOllama += 1; };
    deniedWizard.writeEnvFile = () => { deniedEffects.writeEnvFile += 1; };
    const deniedConfig = JSON.stringify(deniedWizard.config);
    const deniedHarness = createSetupRouteHarness(deniedWizard, async () => {
      deniedEffects.parse += 1;
      return { key: 'must-not-parse', language: 'en', url: 'https://must-not-fetch.invalid' };
    });
    const deniedRequestFactories = [
      routeKey => ({
        ...setupRequest(routeKey, {}),
        socket: { remoteAddress: '127.0.0.1' },
      }),
      routeKey => setupRequest(routeKey, { 'x-admin-token': 'wrong-token' }),
      routeKey => setupRequest(routeKey, { 'x-admin-token': [SETUP_ADMIN_TOKEN] }),
      routeKey => setupRequest(routeKey, { authorization: [`Bearer ${SETUP_ADMIN_TOKEN}`] }),
      routeKey => setupRequest(routeKey, {
        'x-admin-token': SETUP_ADMIN_TOKEN,
        authorization: `Bearer ${SETUP_ADMIN_TOKEN}`,
      }),
      routeKey => setupRequest(routeKey, { 'x-admin-token': 'fixture admin token' }),
      routeKey => setupRequest(routeKey, { 'x-admin-token': 'fixture,admin-token' }),
      routeKey => setupRequest(routeKey, { authorization: `bearer ${SETUP_ADMIN_TOKEN}` }),
      routeKey => setupRequest(routeKey, { authorization: `Bearer  ${SETUP_ADMIN_TOKEN}` }),
      routeKey => setupRequest(
        routeKey,
        { 'x-admin-token': SETUP_ADMIN_TOKEN },
        ['X-Admin-Token', SETUP_ADMIN_TOKEN, 'x-admin-token', SETUP_ADMIN_TOKEN],
      ),
      routeKey => setupRequest(
        routeKey,
        { authorization: `Bearer ${SETUP_ADMIN_TOKEN}` },
        ['Authorization', `Bearer ${SETUP_ADMIN_TOKEN}`, 'authorization', `Bearer ${SETUP_ADMIN_TOKEN}`],
      ),
      routeKey => setupRequest(
        routeKey,
        { 'x-admin-token': SETUP_ADMIN_TOKEN },
        ['X-Admin-Token', 'incoherent-token'],
      ),
      routeKey => {
        const inheritedHeaders = Object.create({ 'x-admin-token': SETUP_ADMIN_TOKEN });
        return setupRequest(routeKey, inheritedHeaders, []);
      },
    ];
    const guardedRoutes = [
      'POST /api/setup/ollama',
      'POST /api/setup/language',
      'POST /api/setup/license',
      'POST /api/setup/complete',
    ];
    for (const routeKey of guardedRoutes) {
      for (const requestFactory of deniedRequestFactories) {
        deniedHarness.reset();
        await invokeSetupRoute(deniedHarness.routes, routeKey, requestFactory(routeKey));
        assert.deepEqual(deniedHarness.response(), {
          status: 403,
          body: { ok: false, code: SETUP_ADMIN_AUTH_REQUIRED },
        });
      }
    }
    assert.deepEqual(deniedEffects, {
      checkModels: 0,
      complete: 0,
      isComplete: 0,
      parse: 0,
      verifyOllama: 0,
      writeEnvFile: 0,
    });
    assert.equal(JSON.stringify(deniedWizard.config), deniedConfig);

    for (const expectedToken of [undefined, '', 'bad token', 'bad,token']) {
      const unconfiguredHarness = createSetupRouteHarness(deniedWizard, async () => {
        deniedEffects.parse += 1;
      }, {
        requireSetupAdminAuth: createStrictAdminTokenGuard({ expectedToken }),
      });
      await invokeSetupRoute(unconfiguredHarness.routes, 'POST /api/setup/complete');
      assert.deepEqual(unconfiguredHarness.response(), {
        status: 403,
        body: { ok: false, code: SETUP_ADMIN_AUTH_REQUIRED },
      });
    }
    for (const nonBooleanGuard of [() => 'true', async () => false]) {
      const nonBooleanHarness = createSetupRouteHarness(deniedWizard, async () => {
        deniedEffects.parse += 1;
      }, { requireSetupAdminAuth: nonBooleanGuard });
      await invokeSetupRoute(nonBooleanHarness.routes, 'POST /api/setup/complete');
      assert.deepEqual(nonBooleanHarness.response(), {
        status: 403,
        body: { ok: false, code: SETUP_ADMIN_AUTH_REQUIRED },
      });
    }
    assert.deepEqual(deniedEffects, {
      checkModels: 0,
      complete: 0,
      isComplete: 0,
      parse: 0,
      verifyOllama: 0,
      writeEnvFile: 0,
    });

    const bearerHarness = createSetupRouteHarness(wizard, async () => ({ language: 'en' }));
    await invokeSetupRoute(
      bearerHarness.routes,
      'POST /api/setup/language',
      setupRequest(
        'POST /api/setup/language',
        { authorization: `Bearer ${SETUP_ADMIN_TOKEN}` },
        ['Authorization', `Bearer ${SETUP_ADMIN_TOKEN}`],
      ),
    );
    assert.deepEqual(bearerHarness.response(), { status: 200, body: { language: 'en' } });

    let parseCount = 0;
    const routeHarness = createSetupRouteHarness(wizard, async () => {
      parseCount += 1;
      return { channel: 'telegram', config: { token: 'new-secret' } };
    });
    const configBeforeRetiredRoute = JSON.stringify(wizard.config);
    await invokeSetupRoute(
      routeHarness.routes,
      'POST /api/setup/notifications',
      setupRequest('POST /api/setup/notifications', {}),
    );
    assert.deepEqual(routeHarness.response(), {
      status: 410,
      body: { ok: false, code: SETUP_NOTIFICATION_INPUT_RETIRED },
    });
    assert.equal(parseCount, 0);
    assert.equal(JSON.stringify(wizard.config), configBeforeRetiredRoute);
    assert.equal(existsSync(envPath), false);
    await invokeSetupRoute(
      routeHarness.routes,
      'GET /api/setup/status',
      setupRequest('GET /api/setup/status', {}),
    );
    assert.deepEqual(routeHarness.response(), { status: 200, body: wizard.getStatus() });

    const existingBytes = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('# foreign header\r\nFOREIGN=alpha\r\nSMTP_URL=smtp://legacy\n'),
      Buffer.from('EMAIL_TO=legacy@example.invalid\nC3_NTFY_URL=https://legacy-ntfy.invalid\n'),
      Buffer.from('C3_SMTP_PASS=legacy-secret\n'),
      Buffer.from('export OLLAMA_URL = "old"\nC3_LANG=cs\nC3_DB_PATH="./old.db"\n'),
      Buffer.from('C3_LICENSE_KEY=stale-license\nTAIL=omega'),
    ]);
    writeFileSync(envPath, existingBytes);
    chmodSync(envPath, 0o600);
    const retainedNotifications = wizard.config.notifications;
    wizard.config.notifications = {};
    wizard.writeEnvFile();
    wizard.config.notifications = retainedNotifications;
    const patchedBytes = readFileSync(envPath);
    assert.equal(patchedBytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), true);
    for (const exactForeignRow of [
      '# foreign header\r\n',
      'FOREIGN=alpha\r\n',
      'SMTP_URL=smtp://legacy\n',
      'EMAIL_TO=legacy@example.invalid\n',
      'C3_NTFY_URL=https://legacy-ntfy.invalid\n',
      'C3_SMTP_PASS=legacy-secret\n',
      'TAIL=omega',
    ]) {
      assert.equal(patchedBytes.includes(Buffer.from(exactForeignRow)), true);
    }
    const patchedEnv = parseDotenv(patchedBytes);
    assert.equal(patchedEnv.OLLAMA_URL, 'http://127.0.0.1:22444');
    assert.equal(patchedEnv.C3_LANG, 'en');
    assert.equal(patchedEnv.C3_DB_PATH, 'operator-data/c3.db');
    assert.equal(Object.hasOwn(patchedEnv, 'C3_LICENSE_KEY'), false);
    assert.equal(patchedEnv.C3_SMTP_PASS, 'legacy-secret');
    assert.equal(patchedEnv.SMTP_URL, 'smtp://legacy');
    assert.equal(patchedEnv.EMAIL_TO, 'legacy@example.invalid');
    assert.equal(patchedEnv.C3_NTFY_URL, 'https://legacy-ntfy.invalid');
    assert.equal(lstatSync(envPath).mode & 0o7777, 0o600);
    assert.equal(existsSync(join(dataDir, '.env')), false);
    assert.equal(existsSync(join(cwdDecoy, '.env')), false);

    routeHarness.reset();
    await invokeSetupRoute(routeHarness.routes, 'POST /api/setup/complete');
    assert.deepEqual(routeHarness.response(), {
      status: 200,
      body: { ok: true, completed: true },
    });
    const savedSetup = JSON.parse(readFileSync(setupPath, 'utf8'));
    assert.deepEqual(savedSetup.notifications, legacyNotifications);
    assert.deepEqual(savedSetup.unknownTopLevel, { preserve: 'exactly' });

    const durableDataDir = join(root, 'durable-completion');
    mkdirSync(durableDataDir);
    const durableSetupPath = join(durableDataDir, 'c3-setup.json');
    writeFileSync(durableSetupPath, JSON.stringify({
      ...legacySetup,
      completed: false,
      unknownTopLevel: { durable: true },
    }));
    const durableWizard = new SetupWizard(durableDataDir, { projectRoot: canonicalRoot });
    durableWizard.load();
    assert.equal(durableWizard.config.completed, false);
    writeFileSync(durableSetupPath, JSON.stringify({
      ...legacySetup,
      completed: true,
      completedAt: '2026-08-11T00:00:00.000Z',
      unknownTopLevel: { durable: true },
    }));
    assert.equal(durableWizard.config.completed, false);
    const envBeforeRetry = readFileSync(envPath);
    const setupBeforeRetry = readFileSync(durableSetupPath);
    let retryWriteCount = 0;
    let retryCompleteCount = 0;
    durableWizard.writeEnvFile = () => { retryWriteCount += 1; };
    durableWizard.complete = () => { retryCompleteCount += 1; };
    const durableHarness = createSetupRouteHarness(durableWizard, async () => {
      throw new Error('parse must stay unreachable');
    });
    await invokeSetupRoute(durableHarness.routes, 'POST /api/setup/complete');
    assert.deepEqual(durableHarness.response(), {
      status: 409,
      body: { ok: false, code: SETUP_ALREADY_COMPLETE },
    });
    assert.deepEqual([retryWriteCount, retryCompleteCount], [0, 0]);
    assert.equal(readFileSync(envPath).equals(envBeforeRetry), true);
    assert.equal(readFileSync(durableSetupPath).equals(setupBeforeRetry), true);

    const stateFailureWizard = new SetupWizard(join(root, 'state-write-failure'), {
      projectRoot: canonicalRoot,
    });
    stateFailureWizard.writeEnvFile = () => {};
    stateFailureWizard.save = () => false;
    const stateFailureHarness = createSetupRouteHarness(stateFailureWizard, async () => ({}));
    await invokeSetupRoute(stateFailureHarness.routes, 'POST /api/setup/complete');
    assert.deepEqual(stateFailureHarness.response(), {
      status: 503,
      body: { ok: false, code: SETUP_STATE_WRITE_FAILED },
    });
    assert.equal(stateFailureWizard.config.completed, false);
    assert.equal(stateFailureWizard.config.completedAt, null);

    const partialDataDir = join(root, 'partial-valid-state');
    mkdirSync(partialDataDir);
    const partialNotifications = {
      telegram: { enabled: true, unknownLeaf: 'preserve' },
      unknownChannel: { preserve: true },
    };
    writeFileSync(join(partialDataDir, 'c3-setup.json'), JSON.stringify({
      completed: false,
      ollama: {},
      notifications: partialNotifications,
      license: {},
      unknownTopLevel: true,
    }));
    const partialWizard = new SetupWizard(partialDataDir, { projectRoot: canonicalRoot });
    partialWizard.load();
    assert.deepEqual(partialWizard.config.notifications, partialNotifications);
    assert.deepEqual(partialWizard.getStatus().notifications, {
      telegram: true,
      email: false,
      ntfy: false,
    });
    assert.deepEqual(Object.keys(partialWizard.toEnvVars()).sort(), [
      'C3_DB_PATH',
      'C3_LANG',
      'C3_LICENSE_KEY',
      'OLLAMA_URL',
    ]);

    for (const [name, invalidBytes] of [
      ['invalid-json', Buffer.from('{"completed":')],
      ['invalid-shape', Buffer.from(JSON.stringify({
        completed: 'yes',
        notifications: null,
      }))],
      ['invalid-utf8', Buffer.from([0xc3, 0x28])],
    ]) {
      const invalidDataDir = join(root, name);
      mkdirSync(invalidDataDir);
      const invalidSetupPath = join(invalidDataDir, 'c3-setup.json');
      writeFileSync(invalidSetupPath, invalidBytes);
      const invalidWizard = new SetupWizard(invalidDataDir, { projectRoot: canonicalRoot });
      assertErrorCode(() => invalidWizard.load(), SETUP_STATE_INVALID);
      const invalidHarness = createSetupRouteHarness(invalidWizard, async () => {
        throw new Error('parse must stay unreachable');
      });
      const invalidEnvBefore = readFileSync(envPath);
      await invokeSetupRoute(invalidHarness.routes, 'POST /api/setup/complete');
      assert.deepEqual(invalidHarness.response(), {
        status: 409,
        body: { ok: false, code: SETUP_STATE_INVALID },
      });
      assert.equal(readFileSync(invalidSetupPath).equals(invalidBytes), true);
      assert.equal(readFileSync(envPath).equals(invalidEnvBefore), true);
    }

    const unreadableDataDir = join(root, 'unreadable-state');
    const unreadableSetupPath = join(unreadableDataDir, 'c3-setup.json');
    mkdirSync(unreadableSetupPath, { recursive: true });
    const unreadableWizard = new SetupWizard(unreadableDataDir, {
      projectRoot: canonicalRoot,
    });
    assertErrorCode(() => unreadableWizard.load(), SETUP_STATE_INVALID);
    const unreadableHarness = createSetupRouteHarness(unreadableWizard, async () => {
      throw new Error('parse must stay unreachable');
    });
    await invokeSetupRoute(unreadableHarness.routes, 'POST /api/setup/complete');
    assert.deepEqual(unreadableHarness.response(), {
      status: 409,
      body: { ok: false, code: SETUP_STATE_INVALID },
    });
    assert.equal(lstatSync(unreadableSetupPath).isDirectory(), true);

    unlinkSync(envPath);
    wizard.writeEnvFile();
    const created = lstatSync(envPath);
    assert.equal(created.isFile(), true);
    assert.equal(created.nlink, 1);
    assert.equal(created.mode & 0o7777, 0o600);
    assert.equal(readFileSync(envPath, 'utf8').includes('legacy-secret'), false);

    const specialValues = {
      OLLAMA_URL: ' http://quoted.invalid/#fragment "x" ',
      C3_LANG: String.raw`cs\nvalue`,
      C3_DB_PATH: './data path/#db',
      C3_LICENSE_KEY: "license'with#marker",
    };
    const roundTrip = renderSetupEnvironment(Buffer.from('FOREIGN=keep\n'), specialValues);
    const parsedRoundTrip = parseDotenv(roundTrip);
    for (const [key, value] of Object.entries(specialValues)) {
      assert.equal(parsedRoundTrip[key], value);
    }
    assert.equal(roundTrip.includes(Buffer.from('FOREIGN=keep\n')), true);

    const safeBase = Buffer.from('FOREIGN=keep\n');
    const resetTarget = (bytes = safeBase, mode = 0o600) => {
      rmSync(envPath, { force: true, recursive: true });
      writeFileSync(envPath, bytes);
      chmodSync(envPath, mode);
    };

    const ownerSeparatedBytes = Buffer.from([
      '# owner separation\r\n',
      'FOREIGN_CANARY=keep-byte-for-byte\r\n',
      'OLLAMA_URL=setup-canary\n',
      'C3_SMTP_PASS=old-canonical\n',
      'SMTP_URL=smtp://legacy.invalid\n',
      'EMAIL_TO=legacy@example.invalid\n',
      'C3_NTFY_URL=https://legacy-ntfy.invalid\n',
      'TAIL_CANARY=omega',
    ].join(''));
    resetTarget(ownerSeparatedBytes);
    const bootstrapRead = readRootEnvironmentBootstrap({ projectRoot: canonicalRoot });
    assert.equal(Object.isFrozen(bootstrapRead), true);
    assert.deepEqual(Object.keys(bootstrapRead), []);
    assert.equal(JSON.stringify(bootstrapRead), '{}');
    assert.equal(requireRootEnvironmentBootstrap(bootstrapRead), bootstrapRead);
    assert.equal(bootstrapRead.exists(), true);
    assert.equal(Object.isFrozen(bootstrapRead.notificationKeys()), true);
    assert.equal(Object.isFrozen(bootstrapRead.ambientKeys()), true);
    assert.deepEqual(bootstrapRead.notificationKeys(), ['C3_SMTP_PASS']);
    assert.equal(bootstrapRead.notificationValue('C3_SMTP_PASS'), 'old-canonical');
    const observedAmbient = Object.create(null);
    assert.equal(bootstrapRead.forEachAmbient((key, value) => {
      observedAmbient[key] = value;
    }), 3);
    assert.equal(observedAmbient.OLLAMA_URL, 'setup-canary');
    assert.equal(observedAmbient.FOREIGN_CANARY, 'keep-byte-for-byte');
    for (const nonAmbientKey of [
      ...EXPECTED_NOTIFICATION_ENV_KEYS,
      ...EXPECTED_LEGACY_NOTIFICATION_ENV_KEYS,
    ]) {
      assert.equal(Object.hasOwn(observedAmbient, nonAmbientKey), false);
    }
    assertErrorCode(
      () => bootstrapRead.notificationValue('SMTP_URL'),
      SETUP_ENV_VALUE_INVALID,
    );
    assertErrorCode(
      () => requireRootEnvironmentBootstrap(Object.freeze(Object.create(null))),
      SETUP_ENV_VALUE_INVALID,
    );
    const notificationPatch = patchRootEnvironmentFile({
      projectRoot: canonicalRoot,
      owner: ROOT_ENVIRONMENT_OWNER.NOTIFICATION,
      values: {
        C3_SMTP_PASS: 'new-canonical',
        C3_WEBHOOK_URL: 'https://webhook.invalid/hook',
      },
    });
    assert.equal(notificationPatch.changed, true);
    const notificationPatchedBytes = readFileSync(envPath);
    for (const untouchedRow of [
      '# owner separation\r\n',
      'FOREIGN_CANARY=keep-byte-for-byte\r\n',
      'OLLAMA_URL=setup-canary\n',
      'SMTP_URL=smtp://legacy.invalid\n',
      'EMAIL_TO=legacy@example.invalid\n',
      'C3_NTFY_URL=https://legacy-ntfy.invalid\n',
      'TAIL_CANARY=omega',
    ]) {
      assert.equal(notificationPatchedBytes.includes(Buffer.from(untouchedRow)), true);
    }
    const notificationRead = readRootEnvironmentFile({
      projectRoot: canonicalRoot,
      owner: ROOT_ENVIRONMENT_OWNER.NOTIFICATION,
    });
    assert.equal(Object.isFrozen(notificationRead), true);
    assert.deepEqual(Object.keys(notificationRead), []);
    assert.equal(JSON.stringify(notificationRead), '{}');
    assert.equal(requireRootEnvironmentFileRead(notificationRead), notificationRead);
    assert.equal(notificationRead.exists(), true);
    assert.equal(Object.isFrozen(notificationRead.keys()), true);
    assert.deepEqual([...notificationRead.keys()].sort(), [
      'C3_SMTP_PASS',
      'C3_WEBHOOK_URL',
    ]);
    assert.equal(notificationRead.has('C3_SMTP_PASS'), true);
    assert.equal(notificationRead.value('C3_SMTP_PASS'), 'new-canonical');
    assertErrorCode(() => notificationRead.value('OLLAMA_URL'), SETUP_ENV_VALUE_INVALID);
    assertErrorCode(() => notificationRead.has('SMTP_URL'), SETUP_ENV_VALUE_INVALID);
    assertErrorCode(
      () => requireRootEnvironmentFileRead(Object.freeze(Object.create(null))),
      SETUP_ENV_VALUE_INVALID,
    );

    const beforeNoOpStat = lstatSync(envPath, { bigint: true });
    const noOpPatch = patchRootEnvironmentFile({
      projectRoot: canonicalRoot,
      owner: ROOT_ENVIRONMENT_OWNER.NOTIFICATION,
      values: { C3_SMTP_PASS: 'new-canonical' },
    });
    const afterNoOpStat = lstatSync(envPath, { bigint: true });
    assert.deepEqual(noOpPatch, { path: envPath, changed: false });
    assert.equal(afterNoOpStat.ino, beforeNoOpStat.ino);
    assert.equal(afterNoOpStat.mtimeNs, beforeNoOpStat.mtimeNs);
    assert.equal(readFileSync(envPath).equals(notificationPatchedBytes), true);

    const beforeInvalidOwner = readFileSync(envPath);
    assertErrorCode(() => patchRootEnvironmentFile({
      projectRoot: canonicalRoot,
      owner: ROOT_ENVIRONMENT_OWNER.NOTIFICATION,
      values: { OLLAMA_URL: 'must-not-cross-owner' },
    }), SETUP_ENV_VALUE_INVALID);
    assertErrorCode(() => patchRootEnvironmentFile({
      projectRoot: canonicalRoot,
      owner: ROOT_ENVIRONMENT_OWNER.LEGACY_NOTIFICATION_SCRUB,
      values: { SMTP_URL: 'must-never-be-created' },
      deleteKeys: [],
    }), SETUP_ENV_VALUE_INVALID);
    assert.equal(readFileSync(envPath).equals(beforeInvalidOwner), true);

    const scrubResult = patchRootEnvironmentFile({
      projectRoot: canonicalRoot,
      owner: ROOT_ENVIRONMENT_OWNER.LEGACY_NOTIFICATION_SCRUB,
      deleteKeys: ['SMTP_URL', 'EMAIL_TO', 'C3_NTFY_URL'],
    });
    assert.equal(scrubResult.changed, true);
    const scrubbedBytes = readFileSync(envPath);
    const scrubbedEnvironment = parseDotenv(scrubbedBytes);
    assert.equal(Object.hasOwn(scrubbedEnvironment, 'SMTP_URL'), false);
    assert.equal(Object.hasOwn(scrubbedEnvironment, 'EMAIL_TO'), false);
    assert.equal(Object.hasOwn(scrubbedEnvironment, 'C3_NTFY_URL'), false);
    assert.equal(scrubbedEnvironment.C3_SMTP_PASS, 'new-canonical');
    assert.equal(scrubbedEnvironment.OLLAMA_URL, 'setup-canary');
    for (const untouchedRow of [
      '# owner separation\r\n',
      'FOREIGN_CANARY=keep-byte-for-byte\r\n',
      'OLLAMA_URL=setup-canary\n',
      'C3_SMTP_PASS=new-canonical\n',
      'TAIL_CANARY=omega',
    ]) {
      assert.equal(scrubbedBytes.includes(Buffer.from(untouchedRow)), true);
    }
    const beforeScrubNoOpStat = lstatSync(envPath, { bigint: true });
    const scrubNoOp = patchRootEnvironmentFile({
      projectRoot: canonicalRoot,
      owner: ROOT_ENVIRONMENT_OWNER.LEGACY_NOTIFICATION_SCRUB,
      deleteKeys: ['SMTP_URL', 'EMAIL_TO', 'C3_NTFY_URL'],
    });
    const afterScrubNoOpStat = lstatSync(envPath, { bigint: true });
    assert.equal(scrubNoOp.changed, false);
    assert.equal(afterScrubNoOpStat.ino, beforeScrubNoOpStat.ino);
    assert.equal(afterScrubNoOpStat.mtimeNs, beforeScrubNoOpStat.mtimeNs);

    const utf8Bom = Buffer.from([0xef, 0xbb, 0xbf]);
    resetTarget(Buffer.concat([
      utf8Bom,
      Buffer.from('SMTP_URL=smtp://delete-first.invalid\nFOREIGN=keep-exact\n'),
    ]));
    const bomScrub = patchRootEnvironmentFile({
      projectRoot: canonicalRoot,
      owner: ROOT_ENVIRONMENT_OWNER.LEGACY_NOTIFICATION_SCRUB,
      deleteKeys: ['SMTP_URL'],
    });
    assert.equal(bomScrub.changed, true);
    assert.equal(readFileSync(envPath).equals(Buffer.concat([
      utf8Bom,
      Buffer.from('FOREIGN=keep-exact\n'),
    ])), true);

    resetTarget(Buffer.concat([
      utf8Bom,
      Buffer.from('C3_SMTP_PASS=before\nFOREIGN=keep-exact\n'),
    ]));
    const bomModify = patchRootEnvironmentFile({
      projectRoot: canonicalRoot,
      owner: ROOT_ENVIRONMENT_OWNER.NOTIFICATION,
      values: { C3_SMTP_PASS: 'after' },
    });
    assert.equal(bomModify.changed, true);
    const expectedBomModify = Buffer.concat([
      utf8Bom,
      Buffer.from('C3_SMTP_PASS=after\nFOREIGN=keep-exact\n'),
    ]);
    assert.equal(readFileSync(envPath).equals(expectedBomModify), true);
    const bomNoOp = patchRootEnvironmentFile({
      projectRoot: canonicalRoot,
      owner: ROOT_ENVIRONMENT_OWNER.NOTIFICATION,
      values: { C3_SMTP_PASS: 'after' },
    });
    assert.equal(bomNoOp.changed, false);
    assert.equal(readFileSync(envPath).equals(expectedBomModify), true);

    const duplicatedForeignOwner = Buffer.from(
      'C3_SMTP_PASS=one\nC3_SMTP_PASS=two\nFOREIGN=keep\n',
    );
    resetTarget(duplicatedForeignOwner);
    wizard.writeEnvFile();
    const afterSetupWithNotificationDuplicate = readFileSync(envPath);
    assert.equal(
      afterSetupWithNotificationDuplicate.includes(Buffer.from('C3_SMTP_PASS=one\n')),
      true,
    );
    assert.equal(
      afterSetupWithNotificationDuplicate.includes(Buffer.from('C3_SMTP_PASS=two\n')),
      true,
    );
    assertErrorCode(() => readRootEnvironmentFile({
      projectRoot: canonicalRoot,
      owner: ROOT_ENVIRONMENT_OWNER.NOTIFICATION,
    }), SETUP_ENV_DUPLICATE_OWNED_KEY);

    resetTarget(Buffer.from('C3_SMTP_PASS="expanded\\ncontrol"\nFOREIGN=keep\n'));
    assertErrorCode(() => readRootEnvironmentFile({
      projectRoot: canonicalRoot,
      owner: ROOT_ENVIRONMENT_OWNER.NOTIFICATION,
    }), SETUP_ENV_TARGET_UNSAFE);
    assertErrorCode(() => patchRootEnvironmentFile({
      projectRoot: canonicalRoot,
      owner: ROOT_ENVIRONMENT_OWNER.NOTIFICATION,
      values: { C3_SMTP_PASS: 'replacement' },
    }), SETUP_ENV_TARGET_UNSAFE);

    resetTarget(Buffer.from([0xc3, 0x28]));
    assertErrorCode(() => readRootEnvironmentFile({
      projectRoot: canonicalRoot,
      owner: ROOT_ENVIRONMENT_OWNER.NOTIFICATION,
    }), SETUP_ENV_TARGET_UNSAFE);

    resetTarget(Buffer.alloc(ROOT_ENVIRONMENT_MAX_BYTES + 1, 0x41));
    assertErrorCode(() => readRootEnvironmentFile({
      projectRoot: canonicalRoot,
      owner: ROOT_ENVIRONMENT_OWNER.NOTIFICATION,
    }), SETUP_ENV_TARGET_UNSAFE);

    rmSync(envPath, { force: true });
    const absentScrub = patchRootEnvironmentFile({
      projectRoot: canonicalRoot,
      owner: ROOT_ENVIRONMENT_OWNER.LEGACY_NOTIFICATION_SCRUB,
      deleteKeys: ['SMTP_URL'],
    });
    assert.deepEqual(absentScrub, { path: envPath, changed: false });
    assert.equal(existsSync(envPath), false);

    const duplicate = Buffer.from('\uFEFF\u00a0OLLAMA_URL: one\nOLLAMA_URL=two\nFOREIGN=keep\n');
    resetTarget(duplicate);
    assertErrorCode(() => wizard.writeEnvFile(), SETUP_ENV_DUPLICATE_OWNED_KEY);
    assert.equal(readFileSync(envPath).equals(duplicate), true);

    const bareCrDuplicate = Buffer.from(
      'OLLAMA_URL=one\rOLLAMA_URL=two\rFOREIGN=keep\r',
    );
    resetTarget(bareCrDuplicate);
    assertErrorCode(() => wizard.writeEnvFile(), SETUP_ENV_DUPLICATE_OWNED_KEY);
    assert.equal(readFileSync(envPath).equals(bareCrDuplicate), true);

    const bareCrForeign = Buffer.from('FOREIGN=keep\rOLLAMA_URL=old\rTAIL=omega\r');
    resetTarget(bareCrForeign);
    wizard.writeEnvFile();
    const patchedBareCr = readFileSync(envPath);
    assert.equal(patchedBareCr.includes(Buffer.from('FOREIGN=keep\r')), true);
    assert.equal(patchedBareCr.includes(Buffer.from('TAIL=omega\r')), true);
    assert.equal(patchedBareCr.includes(Buffer.from('TAIL=omega\r\n')), false);
    assert.equal(patchedBareCr.includes(Buffer.from('TAIL=omega\rC3_LANG=')), true);
    assert.equal(parseDotenv(patchedBareCr).OLLAMA_URL, wizard.config.ollama.url);

    const unterminatedNotification = Buffer.from('C3_SMTP_PASS=legacy-secret');
    const preservedUnterminated = renderSetupEnvironment(
      unterminatedNotification,
      wizard.toEnvVars(),
    );
    assert.equal(
      preservedUnterminated.subarray(-unterminatedNotification.length)
        .equals(unterminatedNotification),
      true,
    );
    assert.equal(preservedUnterminated.includes(Buffer.from('legacy-secret\n')), false);
    assert.equal(parseDotenv(preservedUnterminated).C3_SMTP_PASS, 'legacy-secret');

    for (const multilineDotenv of [
      Buffer.from('FOREIGN="x\nC3_LANG=embedded\ny"\nTAIL=keep\n'),
      Buffer.from('C3_LANG="cs\nC3_SMTP_PASS=shadow"\nFOREIGN=keep\n'),
      Buffer.from('FOREIGN:\nOLLAMA_URL=old\n'),
      Buffer.from('OLLAMA_URL\n=old\n'),
      Buffer.from('FOREIGN=x#c\u2028OLLAMA_URL=hidden\nOLLAMA_URL=visible\n'),
      Buffer.from('FOREIGN=x#c\u2029OLLAMA_URL=hidden\nOLLAMA_URL=visible\n'),
    ]) {
      resetTarget(multilineDotenv);
      assertErrorCode(() => wizard.writeEnvFile(), SETUP_ENV_TARGET_UNSAFE);
      assert.equal(readFileSync(envPath).equals(multilineDotenv), true);
    }

    resetTarget();
    const beforeNewline = readFileSync(envPath);
    const oldLanguage = wizard.config.language;
    for (const unsafeLanguage of [
      'en\nC3_SMTP_PASS=injected',
      'en\u2028C3_SMTP_PASS=injected',
      'en\u2029C3_SMTP_PASS=injected',
    ]) {
      wizard.config.language = unsafeLanguage;
      assertErrorCode(() => wizard.writeEnvFile(), SETUP_ENV_VALUE_INVALID);
      assert.equal(readFileSync(envPath).equals(beforeNewline), true);
    }
    wizard.config.language = oldLanguage;

    resetTarget(safeBase, 0o644);
    assertErrorCode(() => wizard.writeEnvFile(), SETUP_ENV_TARGET_UNSAFE);
    assert.equal(readFileSync(envPath).equals(safeBase), true);

    resetTarget(safeBase, 0o4600);
    assertErrorCode(() => wizard.writeEnvFile(), SETUP_ENV_TARGET_UNSAFE);
    assert.equal(readFileSync(envPath).equals(safeBase), true);

    rmSync(envPath, { force: true });
    const symlinkTarget = join(root, 'foreign-env');
    writeFileSync(symlinkTarget, safeBase);
    chmodSync(symlinkTarget, 0o600);
    symlinkSync(symlinkTarget, envPath);
    assertErrorCode(() => wizard.writeEnvFile(), SETUP_ENV_TARGET_UNSAFE);
    assert.equal(readFileSync(symlinkTarget).equals(safeBase), true);

    unlinkSync(envPath);
    const hardlinkSource = join(root, 'hardlink-env');
    writeFileSync(hardlinkSource, safeBase);
    chmodSync(hardlinkSource, 0o600);
    linkSync(hardlinkSource, envPath);
    assertErrorCode(() => wizard.writeEnvFile(), SETUP_ENV_TARGET_UNSAFE);
    assert.equal(readFileSync(hardlinkSource).equals(safeBase), true);

    rmSync(envPath, { force: true });
    mkdirSync(envPath);
    assertErrorCode(() => wizard.writeEnvFile(), SETUP_ENV_TARGET_UNSAFE);

    assertErrorCode(
      () => wizard.writeEnvFile(join(dataDir, '.env')),
      SETUP_ENV_TARGET_OUT_OF_SCOPE,
    );
    assert.equal(existsSync(join(dataDir, '.env')), false);

    const localUid = typeof process.geteuid === 'function' ? process.geteuid() : 1000;
    assertErrorCode(() => requireSafeSetupEnvTarget({
      isFile: () => true,
      uid: localUid + 1,
      nlink: 1,
      mode: 0o100600,
    }, localUid), SETUP_ENV_TARGET_UNSAFE);
    assertErrorCode(() => requireSafeSetupEnvTarget({
      isFile: () => true,
      uid: localUid,
      nlink: 1,
      mode: 0o104600,
    }, localUid), SETUP_ENV_TARGET_UNSAFE);
    assertErrorCode(() => requireSafeSetupEnvTarget({
      isFile: () => false,
      uid: localUid,
      nlink: 1,
      mode: 0o010600,
    }, localUid), SETUP_ENV_TARGET_UNSAFE);

    const rootEnvironmentSource = readSource('src/security/root-environment-file.js');
    const wizardSource = readSource('src/setup/wizard.js');
    const existingTargetOpen = sliceBetween(
      rootEnvironmentSource,
      'descriptor = fs.openSync(\n      targetPath,',
      ');',
    );
    assert.match(existingTargetOpen, /requireSafeOpenFlags\(\)/);
    assert.match(rootEnvironmentSource, /O_NOFOLLOW === 0/);
    assert.match(rootEnvironmentSource, /O_NONBLOCK === 0/);
    assert.match(rootEnvironmentSource, /fs\.fstatSync\(tempDescriptor/);
    assert.match(rootEnvironmentSource, /tempReadback\.equals\(nextBytes\)/);
    assert.doesNotMatch(rootEnvironmentSource, /process\.env|dotenv\.populate/);
    assert.doesNotMatch(wizardSource, /fs\.renameSync|fs\.linkSync|fs\.openSync/);
    assert.match(wizardSource, /owner: ROOT_ENVIRONMENT_OWNER\.SETUP/);
    const interactiveSlice = sliceBetween(
      wizardSource,
      'export async function runInteractiveWizard',
      '// ─── API Routes',
    );
    assert.equal(interactiveSlice.includes('wizard.writeEnvFile();'), true);
    assert.equal(interactiveSlice.includes('if (!wizard.complete())'), true);
    assert.equal(interactiveSlice.includes('process.cwd()'), false);
    assert.equal(interactiveSlice.includes("path.join(wizard.projectRoot, '.env')"), true);
    assert.equal(interactiveSlice.includes('Configure Telegram'), false);
    assert.equal(interactiveSlice.includes('Configure ntfy'), false);
  } finally {
    process.chdir(originalCwd);
    rmSync(root, { recursive: true, force: true });
  }
});

await testAsync('WS and all four UI surfaces are feature-only, atomic and credential-free', async () => {
  assert.deepEqual([...FEATURE_SETTING_KEYS].sort(), [...EXPECTED_FEATURE_SETTING_KEYS].sort());
  assert.equal(new Set(FEATURE_SETTING_KEYS).size, 7);

  const originalFeatures = featureManager.getAll();
  try {
    featureManager.init(Object.fromEntries(
      EXPECTED_FEATURE_SETTING_KEYS.map(key => [key.slice('c3.features.'.length), false]),
    ));
    const allEnabled = Object.fromEntries(EXPECTED_FEATURE_SETTING_KEYS.map(key => [key, true]));
    assert.equal(featureManager.applySettings(allEnabled), 7);
    for (const featureName of EXPECTED_FEATURE_SETTING_KEYS.map(
      key => key.slice('c3.features.'.length),
    )) {
      assert.equal(featureManager.isEnabled(featureName), true);
    }

    const invalidPayloads = [
      {},
      null,
      { 'c3.notif.smtpPass': 'secret-canary' },
      { 'c3.features.skills': false, 'c3.notif.smtpPass': 'secret-canary' },
      { 'c3.features.skills': 'false' },
      { 'c3.features.future': true },
      Object.create({ 'c3.features.skills': false }),
      { [Symbol('c3.features.skills')]: true },
    ];
    for (const payload of invalidPayloads) {
      const before = JSON.stringify(featureManager.getAll());
      const error = captureError(() => featureManager.applySettings(payload));
      assert.equal(error.code, FEATURE_SETTINGS_INPUT_INVALID);
      assert.equal(JSON.stringify(featureManager.getAll()), before);
    }
  } finally {
    featureManager.init(originalFeatures);
  }

  const sessionSource = readSource('src/ws-bridge/session-adapter.js');
  const syncSlice = sliceBetween(sessionSource, "case 'sync_settings':", "case 'edit_approve':");
  assert.equal(syncSlice.includes('featureManager.applySettings(data.settings)'), true);
  assert.equal(syncSlice.includes('changed: 0'), true);
  assert.equal(syncSlice.includes('FEATURE_SETTINGS_INPUT_INVALID'), true);
  assert.equal(syncSlice.includes('updateChannelConfig'), false);
  assert.equal(syncSlice.includes('smtpPass'), false);
  assert.equal(sessionSource.includes('setNotificationDeps'), false);

  const chatSource = readSource(
    'c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js',
  );
  const chatNotificationSlice = sliceBetween(
    chatSource,
    'function settingsNotif(){',
    'function settingsOutput(){',
  );
  assert.match(chatNotificationSlice, /In-App/);
  assert.match(chatNotificationSlice, /core 1\.0/);
  assert.match(chatNotificationSlice, /Retained externí kandidáti/);
  assert.doesNotMatch(chatNotificationSlice, /c3\.notif\.|\/api\/notifications\//);
  assert.doesNotMatch(chatNotificationSlice, /_cfgToggle|_cfgInput|Aktivní|Neaktivní/);
  const chatSecuritySlice = sliceBetween(
    chatSource,
    '/* v91: Security panel */',
    'function _fbGetLastAssistant',
  );
  const webhookLoaderSlice = sliceBetween(
    chatSecuritySlice,
    'function _secWebhookStatus(value)',
    'function _secLoadSessions()',
  );
  const webhookRendererSlice = sliceBetween(
    chatSecuritySlice,
    '/* ── Webhook ── */',
    '/* ── Sessions ── */',
  );
  assert.equal(
    (chatSource.match(/\/api\/security\/webhook-secret/g) || []).length,
    1,
  );
  assert.match(webhookLoaderSlice, /\/api\/security\/webhook-secret/);
  assert.match(webhookLoaderSlice, /phase:'READY'/);
  assert.match(webhookLoaderSlice, /phase:'ERROR'/);
  assert.doesNotMatch(webhookLoaderSlice, /method\s*:\s*['"]POST['"]/);
  assert.doesNotMatch(chatSecuritySlice, /\bmasked\b|Regenerovat/);
  assert.doesNotMatch(webhookRendererSlice, /button|input|confirm|prompt/);
  assert.match(webhookRendererSlice, /PROCESS_ENV/);
  assert.match(webhookRendererSlice, /ROOT_ENV_FILE/);
  assert.match(webhookRendererSlice, /spravuje operátor/);
  assert.match(webhookRendererSlice, /restartu serveru/);
  assert.match(chatSecuritySlice, /Webhook Secret/);

  const centerSource = readSource(
    'c3-ide/extensions/c3-center-views/lib/browser/center-views-module.js',
  );
  const centerNotificationSlice = sliceBetween(
    centerSource,
    "case 'notif':",
    "case 'storage':",
  );
  assert.match(centerNotificationSlice, /In-App/);
  assert.match(centerNotificationSlice, /core 1\.0/);
  assert.match(centerNotificationSlice, /retained operátorské kandidáty/);
  assert.doesNotMatch(centerNotificationSlice, /_inp\(|_tog\(|c3\.notif\.|\/api\/notifications\//);
  assert.doesNotMatch(centerSource, /_fetchNotifChannels|_testNotifChannel|\/api\/notifications\//);
  for (const key of EXPECTED_FEATURE_SETTING_KEYS) assert.match(centerSource, new RegExp(key.replaceAll('.', '\\.')));
  const centerSyncSlice = sliceBetween(centerSource, 'const _sync = (key, val) => {', 'const _tog =');
  assert.match(centerSyncSlice, /FEATURE_SYNC_KEYS\.includes\(key\)/);
  assert.match(centerSyncSlice, /typeof val !== 'boolean'/);
  assert.equal(centerSyncSlice.indexOf("typeof val !== 'boolean'") < centerSyncSlice.indexOf('syncSettings'), true);

  const settingsSourcePaths = [
    'c3-ide/extensions/c3-settings/src/browser/settings-module.ts',
    'c3-ide/extensions/c3-settings/src/browser/settings-contribution.ts',
    'c3-ide/extensions/c3-settings/src/common/settings-protocol.ts',
  ];
  const settingsSources = settingsSourcePaths.map(readSource);
  for (const source of settingsSources) assert.doesNotMatch(source, /c3\.notif\./);
  for (const key of EXPECTED_FEATURE_SETTING_KEYS) {
    assert.match(settingsSources[0], new RegExp(key.replaceAll('.', '\\.')));
  }
  assert.match(settingsSources[0], /FEATURE_SYNC_KEYS\.has\(event\.preferenceName\)/);
  assert.match(settingsSources[0], /typeof event\.newValue === 'boolean'/);
  assert.equal(
    settingsSources[0].indexOf("typeof event.newValue === 'boolean'")
      < settingsSources[0].indexOf('ws.syncSettings'),
    true,
  );

  const architectHtml = readSource('src/ui/architect/architect.html');
  const architectNotificationHtml = sliceBetween(
    architectHtml,
    '<div class="accordion-section" data-section="notifications">',
    '<div class="accordion-section" data-section="appearance">',
  );
  assert.match(architectNotificationHtml, /In-App/);
  assert.match(architectNotificationHtml, /core 1\.0/);
  assert.doesNotMatch(architectNotificationHtml, /<input|<select|notif-|quiet-/);
  assert.doesNotMatch(architectNotificationHtml, /testNotification|requestNotificationPermission/);

  const architectSource = readSource('src/ui/architect/architect.js');
  assert.match(architectSource, /const ARCHITECT_SETTINGS_DEFAULT_DOCUMENT = \{/);
  assert.match(architectSource, /notifications: \{/);
  assert.match(architectSource, /telegramToken: ''/);
  assert.match(architectSource, /smsSecret: ''/);
  assert.doesNotMatch(
    architectSource,
    /\/api\/notifications\/test|Notification\.requestPermission|new Notification\(/,
  );
  assert.doesNotMatch(
    architectSource,
    /function (?:toggleNotificationChannel|updateNotificationConfig|testNotificationChannel|requestNotificationPermission)/,
  );
  const architectProjectionSlice = sliceBetween(
    architectSource,
    'function architectSettingsProjectionFromState',
    'function architectSettingsStateForPublicDocument',
  );
  assert.doesNotMatch(architectProjectionSlice, /notifications/);
});

summary();
