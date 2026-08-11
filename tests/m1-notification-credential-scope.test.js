import { strict as assert } from 'node:assert';
import { createHmac } from 'node:crypto';
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
  WebhookChannel,
} from '../src/notifications/index.js';
import {
  WEBHOOK_SECRET_AUTHORITY_INVALID,
  WEBHOOK_SECRET_NOT_CONFIGURED,
  WEBHOOK_SECRET_SOURCE_UNSAFE,
  readWebhookSecretAuthority,
  requireWebhookSecretAuthority,
} from '../src/runtime-environment.js';
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
  SETUP_ENV_DUPLICATE_OWNED_KEY,
  SETUP_ENV_TARGET_OUT_OF_SCOPE,
  SETUP_ENV_TARGET_UNSAFE,
  SETUP_ENV_VALUE_INVALID,
  SETUP_NOTIFICATION_INPUT_RETIRED,
  SETUP_STATE_WRITE_FAILED,
  SetupWizard,
  createSetupRoutes,
  renderSetupEnvironment,
  requireSafeSetupEnvTarget,
} from '../src/setup/wizard.js';
import {
  FEATURE_SETTING_KEYS,
  FEATURE_SETTINGS_INPUT_INVALID,
  featureManager,
} from '../src/core/feature-manager.js';
import { suite, summary, testAsync } from './harness.js';

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SILENT_LOGGER = Object.freeze({
  debug() {},
  error() {},
  info() {},
  warn() {},
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
        updateConfig() {
          counters.update += 1;
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
    update: 0,
  };
}

async function invokeSetupRoute(routes, routeKey) {
  return await routes[routeKey]({ url: routeKey.split(' ')[1] }, {});
}

function createSetupRouteHarness(wizard, parseBody) {
  let response = null;
  const routes = createSetupRoutes(wizard, {
    parseBody,
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
  assert.deepEqual(EXTERNAL_NOTIFICATION_CHANNEL_FLAGS, EXPECTED_CHANNEL_FLAGS);
  assert.deepEqual([...EXTERNAL_NOTIFICATION_CHANNELS], Object.keys(EXPECTED_CHANNEL_FLAGS));
  assert.equal(Object.isFrozen(EXTERNAL_NOTIFICATION_CHANNEL_FLAGS), true);
  assert.equal(Object.isFrozen(EXTERNAL_NOTIFICATION_CHANNELS), true);

  const defaultCounters = makeCounters();
  const defaultRouter = createNotificationRouter({
    env: {},
    channelFactories: fakeChannelFactories(defaultCounters),
    logger: SILENT_LOGGER,
  });
  assert.deepEqual(defaultRouter.getAvailableChannels(), ['in_app']);
  assert.equal(Object.values(defaultCounters.construct).reduce((a, b) => a + b, 0), 0);
  assert.deepEqual(
    await defaultRouter.send({ channel: 'in_app', agentId: 'local' }),
    { delivered: true, channel: 'in_app' },
  );

  for (const [channelName, envName] of Object.entries(EXPECTED_CHANNEL_FLAGS)) {
    const counters = makeCounters();
    const router = createNotificationRouter({
      env: { [envName]: 'true' },
      channelFactories: fakeChannelFactories(counters),
      logger: SILENT_LOGGER,
    });
    assert.deepEqual(router.getAvailableChannels(), ['in_app', channelName]);
    assert.equal(counters.construct[channelName], 1);
    assert.equal(Object.values(counters.construct).reduce((a, b) => a + b, 0), 1);

    const offCounters = makeCounters();
    const offRouter = createNotificationRouter({
      env: { [envName]: 'false' },
      channelFactories: fakeChannelFactories(offCounters),
      logger: SILENT_LOGGER,
    });
    assert.deepEqual(offRouter.getAvailableChannels(), ['in_app']);
    assert.equal(Object.values(offCounters.construct).reduce((a, b) => a + b, 0), 0);

    const invalidCounters = makeCounters();
    const invalid = captureError(() => createNotificationRouter({
      env: { [envName]: 'TRUE' },
      channelFactories: fakeChannelFactories(invalidCounters),
      logger: SILENT_LOGGER,
    }));
    assert.equal(invalid.code, NOTIFICATION_CHANNEL_POLICY_INVALID);
    assert.equal(Object.values(invalidCounters.construct).reduce((a, b) => a + b, 0), 0);
  }

  const partialCounters = makeCounters();
  assertErrorCode(() => createNotificationRouter({
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
  assert.equal(
    defaultRouter.updateChannelConfig('email', { pass: 'must-not-apply' }).code,
    NOTIFICATION_CHANNEL_DISABLED,
  );
  assert.equal((await defaultRouter.send({ channel: 'slack' })).code, NOTIFICATION_CHANNEL_UNSUPPORTED);
  assert.equal((await defaultRouter.testChannel('slack', 'nobody')).code, NOTIFICATION_CHANNEL_UNSUPPORTED);
  assert.equal(
    defaultRouter.updateChannelConfig('slack', { token: 'must-not-apply' }).code,
    NOTIFICATION_CHANNEL_UNSUPPORTED,
  );
  assert.equal(defaultRouter.registerChannel({ name: 'ntfy', async send() {} }), false);
  assert.deepEqual(
    { send: defaultCounters.send, verify: defaultCounters.verify, update: defaultCounters.update },
    { send: 0, verify: 0, update: 0 },
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

    const mutableProcessEnvironment = { C3_WEBHOOK_SECRET: 'process-snapshot-a' };
    const processSnapshotAuthority = readWebhookSecretAuthority({
      projectRoot: authorityProjectRoot,
      processEnvironment: mutableProcessEnvironment,
    });
    mutableProcessEnvironment.C3_WEBHOOK_SECRET = 'process-snapshot-b';
    assert.equal(
      processSnapshotAuthority.sign(deterministicPayload, deterministicTimestamp),
      expectedHmac('process-snapshot-a', deterministicPayload, deterministicTimestamp),
    );
    const restartedProcessAuthority = readWebhookSecretAuthority({
      projectRoot: authorityProjectRoot,
      processEnvironment: mutableProcessEnvironment,
    });
    assert.equal(
      restartedProcessAuthority.sign(deterministicPayload, deterministicTimestamp),
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
    const rawInjectionError = captureError(() => new WebhookChannel({
      url: 'https://fake-webhook.invalid/raw',
      secret: 'RAW_SECRET_CANARY',
      requireWebhookSecretAuthority,
      webhookSecretAuthority: processSnapshotAuthority,
    }));
    assert.equal(rawInjectionError.code, 'WEBHOOK_SECRET_RAW_INJECTION_RETIRED');
    assert.equal(rawInjectionError.message, 'WEBHOOK_SECRET_RAW_INJECTION_RETIRED');

    process.env.C3_WEBHOOK_URL = 'https://fake-webhook.invalid/default-factory';
    Date.now = () => deterministicTimestamp;
    const fakeFetchCalls = [];
    globalThis.fetch = async (url, options) => {
      fakeFetchCalls.push({ url: String(url), options });
      return { ok: true, status: 204 };
    };
    const actualRouter = createNotificationRouter({
      env: { C3_ENABLE_NOTIFICATION_WEBHOOK: 'true' },
      logger: SILENT_LOGGER,
      requireWebhookSecretAuthority,
      webhookSecretAuthority: processSnapshotAuthority,
    });
    const actualWebhookChannel = actualRouter.channels.get('webhook');
    assert.equal(actualWebhookChannel instanceof WebhookChannel, true);
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
    assert.equal(fetchedUrl, 'https://fake-webhook.invalid/default-factory');
    assert.equal(fetchedOptions.method, 'POST');
    const sentTimestamp = Number(fetchedOptions.headers['X-C3-Timestamp']);
    const sentPayload = JSON.parse(fetchedOptions.body);
    assert.equal(sentTimestamp, deterministicTimestamp);
    assert.equal(sentPayload.timestamp, sentTimestamp);
    assert.equal(
      fetchedOptions.headers['X-C3-Signature'],
      expectedHmac('process-snapshot-a', fetchedOptions.body, sentTimestamp),
    );

    installAuthorityEnv('C3_WEBHOOK_SECRET=\n', 0o600);
    const unconfiguredAuthority = readWebhookSecretAuthority({
      projectRoot: authorityProjectRoot,
      processEnvironment: {},
    });
    const unconfiguredRouter = createNotificationRouter({
      env: { C3_ENABLE_NOTIFICATION_WEBHOOK: 'true' },
      logger: SILENT_LOGGER,
      requireWebhookSecretAuthority,
      webhookSecretAuthority: unconfiguredAuthority,
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
  const rootEnvOpenSlice = sliceBetween(
    runtimeEnvironmentSource,
    'descriptor = openSync(',
    ');',
  );
  assert.match(rootEnvOpenSlice, /fsConstants\.O_NOFOLLOW/);
  assert.match(rootEnvOpenSlice, /fsConstants\.O_NONBLOCK/);
  assert.doesNotMatch(
    runtimeEnvironmentSource,
    /dotenv\/config|process\.cwd\(|DOTENV_CONFIG_PATH/,
  );

  const webhookChannelSource = readSource('src/notifications/channels/webhook.js');
  assert.doesNotMatch(webhookChannelSource, /process\.env\.C3_WEBHOOK_SECRET|this\.secret/);

  const serverSource = readSource('src/server.js');
  const serverNotificationInit = sliceBetween(
    serverSource,
    'const { pipeline: notificationPipeline, router: notificationRouter } = createNotificationPipeline({',
    'const notificationEmitter =',
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
  for (const dependency of ['requireWebhookSecretAuthority', 'webhookSecretAuthority']) {
    assert.match(serverNotificationInit, new RegExp(`\\b${dependency}\\b`));
    assert.match(serverRouteDependencies, new RegExp(`\\b${dependency}\\b`));
  }

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
  for (const dependency of ['requireWebhookSecretAuthority', 'webhookSecretAuthority']) {
    assert.match(workerNotificationInit, new RegExp(`\\b${dependency}\\b`));
  }

  const exampleEnvironment = readSource('.env.example');
  assert.equal((exampleEnvironment.match(/^C3_WEBHOOK_SECRET=$/gm) || []).length, 1);
  assert.match(exampleEnvironment, /install-root \.env regular, owner-owned, mode 0600/);
  assert.match(exampleEnvironment, /restart IntentSmith after changing this value/);

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

  let capturedTransport = null;
  const enabledEmail = await verifyEmail({}, {
    env: {
      C3_ENABLE_NOTIFICATION_EMAIL: 'true',
      C3_SMTP_HOST: 'fake-smtp.invalid',
      C3_SMTP_PORT: '2525',
      C3_SMTP_USER: 'fake-user',
      C3_SMTP_PASS: 'fake-pass',
      C3_TEST_EMAIL: 'fake@example.invalid',
    },
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

  const enabledNtfy = await verifyNtfy({}, {
    env: {
      C3_ENABLE_NOTIFICATION_PUSH: 'true',
      C3_NTFY_URL: 'https://fake-ntfy.invalid',
      C3_NTFY_TOPIC: 'fake-topic',
    },
    async fetchImpl(url) {
      verifierEffects.fetch += 1;
      assert.equal(url, 'https://fake-ntfy.invalid/fake-topic');
      return { ok: true, async json() { return { id: 'fake-push' }; } };
    },
  });
  assert.equal(enabledNtfy.delivered, true);
  assert.equal(verifierEffects.fetch, 1);

  const unsupportedVerification = await verifyAll({ channels: ['slack'] }, { env: {} });
  assert.equal(unsupportedVerification.allPassed, false);
  assert.equal(unsupportedVerification.results[0].code, NOTIFICATION_CHANNEL_UNSUPPORTED);
  assert.equal(dryRun().every(result => result.proof === false && result.delivered === false), true);

  const root = mkdtempSync(join(tmpdir(), 'm1-notification-scope-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(root);
    const dataDir = join(root, 'data');
    mkdirSync(dataDir, { recursive: true });
    const wizard = new SetupWizard(dataDir);
    wizard.config.ollama = { ...wizard.config.ollama, url: 'http://127.0.0.1:22444' };
    wizard.config.language = 'en';
    wizard.config.dataDir = './operator-data';
    wizard.config.license = { ...wizard.config.license, key: '' };
    wizard.config.notifications = {
      telegram: { enabled: true, token: 'legacy-token', chatId: 'legacy-chat' },
      email: { enabled: true, smtp: 'legacy-smtp', from: 'a', to: 'b' },
      ntfy: { enabled: true, topic: 'legacy-topic', server: 'https://legacy.invalid' },
    };

    let parseCount = 0;
    const routeHarness = createSetupRouteHarness(wizard, async () => {
      parseCount += 1;
      return { channel: 'telegram', config: { token: 'new-secret' } };
    });
    const configBeforeRetiredRoute = JSON.stringify(wizard.config);
    await invokeSetupRoute(routeHarness.routes, 'POST /api/setup/notifications');
    assert.deepEqual(routeHarness.response(), {
      status: 410,
      body: { ok: false, code: SETUP_NOTIFICATION_INPUT_RETIRED },
    });
    assert.equal(parseCount, 0);
    assert.equal(JSON.stringify(wizard.config), configBeforeRetiredRoute);
    assert.equal(existsSync(join(root, '.env')), false);

    const existingBytes = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('# foreign header\r\nFOREIGN=alpha\r\nC3_SMTP_PASS=legacy-secret\n'),
      Buffer.from('export OLLAMA_URL = "old"\nC3_LANG=cs\nC3_DB_PATH="./old.db"\n'),
      Buffer.from('C3_LICENSE_KEY=stale-license\nTAIL=omega'),
    ]);
    writeFileSync(join(root, '.env'), existingBytes);
    chmodSync(join(root, '.env'), 0o600);
    wizard.writeEnvFile();
    const patchedBytes = readFileSync(join(root, '.env'));
    assert.equal(patchedBytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), true);
    for (const exactForeignRow of [
      '# foreign header\r\n',
      'FOREIGN=alpha\r\n',
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
    assert.equal(lstatSync(join(root, '.env')).mode & 0o777, 0o600);
    assert.equal(existsSync(join(dataDir, '.env')), false);

    routeHarness.reset();
    await invokeSetupRoute(routeHarness.routes, 'POST /api/setup/complete');
    assert.deepEqual(routeHarness.response(), {
      status: 200,
      body: { ok: true, completed: true },
    });
    const savedSetup = JSON.parse(readFileSync(join(dataDir, 'c3-setup.json'), 'utf8'));
    assert.equal(savedSetup.notifications.telegram.token, 'legacy-token');
    assert.equal(savedSetup.notifications.ntfy.topic, 'legacy-topic');

    const stateFailureWizard = new SetupWizard(join(root, 'state-write-failure'));
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

    unlinkSync(join(root, '.env'));
    wizard.writeEnvFile();
    const created = lstatSync(join(root, '.env'));
    assert.equal(created.isFile(), true);
    assert.equal(created.nlink, 1);
    assert.equal(created.mode & 0o777, 0o600);
    assert.equal(readFileSync(join(root, '.env'), 'utf8').includes('legacy-secret'), false);

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
      rmSync(join(root, '.env'), { force: true, recursive: true });
      writeFileSync(join(root, '.env'), bytes);
      chmodSync(join(root, '.env'), mode);
    };

    const duplicate = Buffer.from('\uFEFF\u00a0OLLAMA_URL: one\nOLLAMA_URL=two\nFOREIGN=keep\n');
    resetTarget(duplicate);
    assertErrorCode(() => wizard.writeEnvFile(), SETUP_ENV_DUPLICATE_OWNED_KEY);
    assert.equal(readFileSync(join(root, '.env')).equals(duplicate), true);

    const bareCrDuplicate = Buffer.from(
      'OLLAMA_URL=one\rOLLAMA_URL=two\rFOREIGN=keep\r',
    );
    resetTarget(bareCrDuplicate);
    assertErrorCode(() => wizard.writeEnvFile(), SETUP_ENV_DUPLICATE_OWNED_KEY);
    assert.equal(readFileSync(join(root, '.env')).equals(bareCrDuplicate), true);

    const bareCrForeign = Buffer.from('FOREIGN=keep\rOLLAMA_URL=old\rTAIL=omega\r');
    resetTarget(bareCrForeign);
    wizard.writeEnvFile();
    const patchedBareCr = readFileSync(join(root, '.env'));
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
      assert.equal(readFileSync(join(root, '.env')).equals(multilineDotenv), true);
    }

    resetTarget();
    const beforeNewline = readFileSync(join(root, '.env'));
    const oldLanguage = wizard.config.language;
    for (const unsafeLanguage of [
      'en\nC3_SMTP_PASS=injected',
      'en\u2028C3_SMTP_PASS=injected',
      'en\u2029C3_SMTP_PASS=injected',
    ]) {
      wizard.config.language = unsafeLanguage;
      assertErrorCode(() => wizard.writeEnvFile(), SETUP_ENV_VALUE_INVALID);
      assert.equal(readFileSync(join(root, '.env')).equals(beforeNewline), true);
    }
    wizard.config.language = oldLanguage;

    resetTarget(safeBase, 0o644);
    assertErrorCode(() => wizard.writeEnvFile(), SETUP_ENV_TARGET_UNSAFE);
    assert.equal(readFileSync(join(root, '.env')).equals(safeBase), true);

    rmSync(join(root, '.env'), { force: true });
    const symlinkTarget = join(root, 'foreign-env');
    writeFileSync(symlinkTarget, safeBase);
    chmodSync(symlinkTarget, 0o600);
    symlinkSync(symlinkTarget, join(root, '.env'));
    assertErrorCode(() => wizard.writeEnvFile(), SETUP_ENV_TARGET_UNSAFE);
    assert.equal(readFileSync(symlinkTarget).equals(safeBase), true);

    unlinkSync(join(root, '.env'));
    const hardlinkSource = join(root, 'hardlink-env');
    writeFileSync(hardlinkSource, safeBase);
    chmodSync(hardlinkSource, 0o600);
    linkSync(hardlinkSource, join(root, '.env'));
    assertErrorCode(() => wizard.writeEnvFile(), SETUP_ENV_TARGET_UNSAFE);
    assert.equal(readFileSync(hardlinkSource).equals(safeBase), true);

    rmSync(join(root, '.env'), { force: true });
    mkdirSync(join(root, '.env'));
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

    const wizardSource = readSource('src/setup/wizard.js');
    const interactiveSlice = sliceBetween(
      wizardSource,
      'export async function runInteractiveWizard',
      '// ─── API Routes',
    );
    assert.equal(interactiveSlice.includes('wizard.writeEnvFile();'), true);
    assert.equal(interactiveSlice.includes('if (!wizard.complete())'), true);
    assert.equal(interactiveSlice.includes("path.join(dataDir, '.env')"), false);
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
