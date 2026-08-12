#!/usr/bin/env node

import Database from 'better-sqlite3';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { WebSocket as NodeWebSocket } from 'ws';

import { suite, test, testAsync, summary } from './harness.js';
import {
  M1_CONTRACT_VERSION,
  classifyTerminal,
  validateCoreEventStream,
  validateM1Contract,
} from '../contracts/m1/index.js';
import { config } from '../src/config.js';
import {
  getConversationStore,
  resetConversationStore,
} from '../src/chat/conversation-store.js';
import { LLMProviderUnavailableError } from '../src/core/chat-turn-error.js';
import { up as migrateModelPolicy } from '../src/db/migrations/2026_08_09_061_model_automation_policy.js';
import { up as migrateUserSettingsRevision } from '../src/db/migrations/2026_08_10_064_user_settings_revision.js';
import { SETTINGS_PORTABLE_PATHS } from '../src/db/settings-portability.js';
import { createMiscRoutes } from '../src/routes/misc.js';
import { createLegacyLocalCapability } from '../src/security/legacy-local-access-policy.js';
import { createSessionAdapter } from '../src/ws-bridge/session-adapter.js';
import { attachWebSocketServer } from '../src/ws-bridge/ws-server.js';
import { createM1AttachmentPolicy } from '../src/ws-bridge/protocol.js';

const TEST_M1_ATTACHMENT_POLICY = createM1AttachmentPolicy({
  maxCount: 2,
  maxTextBytes: 1024,
  maxImageBytes: 1024,
  maxAggregateBytes: 2048,
  maxFrameBytes: 16384,
});

function m1FeatureMetadata(policy = TEST_M1_ATTACHMENT_POLICY) {
  return {
    featureMetadata: {
      'm1-wire-v1': {
        version: 1,
        attachmentPolicy: hostClone(policy),
      },
    },
  };
}

const require = createRequire(import.meta.url);
const {
  REQUIRED_BUNDLE_MARKERS,
  REQUIRED_CONSUMER_FUNCTIONS,
  REQUIRED_PROTOCOL_FUNCTIONS,
  assertRegularFile,
  probeConsumerRuntime,
  runCli,
  validateBundleSource,
  validateConsumerRuntime,
  validateProtocolRuntime,
} = require('../c3-ide/scripts/verify-m1-consumer-build.js');

const CANONICAL_PROTOCOL_FUNCTIONS = Object.freeze([
  'validateM1Contract',
  'validateCoreEventStream',
  'classifyTerminal',
  'encodeM1Contract',
  'decodeM1Contract',
  'roundTripM1Contract',
  'isM1ContractEnvelope',
]);
const CANONICAL_CONSUMER_FUNCTIONS = Object.freeze([
  'wsSendChat',
  'wsSendCancel',
  'wsHasActiveM1Turn',
  'wsIsM1WireNegotiated',
  'wsM1AttachmentPolicy',
  'wsConnectionEpoch',
  'wsTakeM1SendRejection',
]);
const CANONICAL_BUNDLE_MARKERS = Object.freeze([
  'Generated @c3/protocol M1 runtime is unavailable',
  'm1-wire-v1',
  'M1_ATTACHMENT_PATH_FORBIDDEN',
  'M1_FRAME_TOO_LARGE',
  'core-event-stream-limit',
  'DELIVERY_UNKNOWN',
  'CONVERSATION_BUSY',
  'M1_CONNECTION_REPLACED',
]);

function hostClone(value) {
  return JSON.parse(JSON.stringify(value));
}

const TEST_M1_PROTOCOL = Object.freeze({
  M1_CONTRACT_VERSION,
  classifyTerminal: (value, options) => classifyTerminal(hostClone(value), hostClone(options)),
  validateCoreEventStream: value => validateCoreEventStream(hostClone(value)),
  validateM1Contract: (value, expected) => validateM1Contract(hostClone(value), expected),
});

const WS_CLIENT = new URL(
  '../c3-ide/extensions/c3-chat-panel/lib/browser/ws-client.js',
  import.meta.url,
);
const CHAT_PANEL = new URL(
  '../c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js',
  import.meta.url,
);
const CENTER_VIEWS = new URL(
  '../c3-ide/extensions/c3-center-views/lib/browser/center-views-module.js',
  import.meta.url,
);
const ARCHITECT_UI = new URL('../src/ui/architect/architect.js', import.meta.url);
const AGENT_CLIENT = new URL(
  '../c3-ide/extensions/c3-chat-panel/lib/browser/agent-client.js',
  import.meta.url,
);
const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));
const STUDIO_PACKAGE = new URL('../c3-ide/package.json', import.meta.url);
const PROTOCOL_PACKAGE = new URL(
  '../c3-ide/extensions/c3-protocol/package.json',
  import.meta.url,
);
const PROTOCOL_INDEX = new URL(
  '../c3-ide/extensions/c3-protocol/src/index.ts',
  import.meta.url,
);

suite('M1 Studio client — generated protocol delivery');

test('protocol lib is ignored generated output with no tracked stale stub', () => {
  const tracked = execFileSync(
    'git',
    ['ls-files', '--', 'c3-ide/extensions/c3-protocol/lib'],
    { cwd: REPOSITORY_ROOT, encoding: 'utf8' },
  ).trim();
  assert.equal(tracked, '');

  const ignoredBy = execFileSync(
    'git',
    ['check-ignore', '-v', 'c3-ide/extensions/c3-protocol/lib/runtime-probe.js'],
    { cwd: REPOSITORY_ROOT, encoding: 'utf8' },
  );
  assert.match(
    ignoredBy,
    /\.gitignore:\d+:c3-ide\/extensions\/c3-protocol\/lib\//,
  );
});

test('root Studio build and watch share one protocol preparation contract', () => {
  const studio = JSON.parse(fs.readFileSync(STUDIO_PACKAGE, 'utf8'));
  assert.equal(
    studio.scripts['clean:protocol'],
    'yarn workspace @c3/protocol clean',
  );
  assert.equal(
    studio.scripts['prepare:protocol'],
    'yarn run clean:protocol && yarn workspace @c3/protocol build --force && yarn run verify:protocol-runtime',
  );
  assert.equal(studio.scripts.prebuild, 'yarn run prepare:protocol');
  assert.equal(
    studio.scripts.postbuild,
    'node scripts/verify-m1-consumer-build.js',
  );
  assert.equal(studio.scripts.prewatch, 'yarn run prepare:protocol');
  assert.equal(studio.scripts.build, 'yarn --cwd applications/electron build');
  assert.equal(studio.scripts.watch, 'yarn --cwd applications/electron watch');
  assert.equal(
    studio.scripts.clean,
    'yarn run clean:protocol && yarn --cwd applications/electron clean',
  );
});

function validPostbuildProtocol() {
  return {
    M1_CONTRACT_VERSION: 1,
    validateM1Contract: (value, expected) => validateM1Contract(value, expected),
    validateCoreEventStream: value => validateCoreEventStream(value),
    classifyTerminal: (value, options) => classifyTerminal(value, options),
    encodeM1Contract(value) {
      const validation = validateM1Contract(value);
      if (!validation.valid) throw new TypeError(validation.errors.join(', '));
      return JSON.stringify(value);
    },
    decodeM1Contract(encoded) {
      const value = JSON.parse(encoded);
      const validation = validateM1Contract(value);
      if (!validation.valid) throw new TypeError(validation.errors.join(', '));
      return value;
    },
    roundTripM1Contract(value) {
      return this.decodeM1Contract(this.encodeM1Contract(value));
    },
    isM1ContractEnvelope(value) {
      return validateM1Contract(value).valid;
    },
  };
}

test('postbuild requirements are pinned independently of guard implementation', () => {
  assert.deepEqual([...REQUIRED_PROTOCOL_FUNCTIONS], [...CANONICAL_PROTOCOL_FUNCTIONS]);
  assert.deepEqual([...REQUIRED_CONSUMER_FUNCTIONS], [...CANONICAL_CONSUMER_FUNCTIONS]);
  assert.deepEqual([...REQUIRED_BUNDLE_MARKERS], [...CANONICAL_BUNDLE_MARKERS]);
});

test('postbuild guard rejects every incomplete or non-v1 protocol surface', () => {
  assert.doesNotThrow(() => validateProtocolRuntime(validPostbuildProtocol()));

  const wrongVersion = validPostbuildProtocol();
  wrongVersion.M1_CONTRACT_VERSION = 2;
  assert.throws(
    () => validateProtocolRuntime(wrongVersion),
    /protocol version is unavailable or unexpected/,
  );

  for (const name of CANONICAL_PROTOCOL_FUNCTIONS) {
    const incomplete = validPostbuildProtocol();
    delete incomplete[name];
    assert.throws(
      () => validateProtocolRuntime(incomplete),
      new RegExp(`protocol export is missing: ${name}`),
    );
  }

  const rejecting = validPostbuildProtocol();
  rejecting.validateM1Contract = () => ({ valid: false });
  assert.throws(
    () => validateProtocolRuntime(rejecting),
    /rejected the exact postbuild fixture/,
  );
});

test('postbuild guard executes every required protocol operation', () => {
  const brokenByName = {
    validateM1Contract: () => ({ valid: false }),
    validateCoreEventStream: () => ({ valid: false }),
    classifyTerminal: () => ({ valid: false }),
    encodeM1Contract: () => '',
    decodeM1Contract: () => ({}),
    roundTripM1Contract: () => ({}),
    isM1ContractEnvelope: () => false,
  };
  for (const name of CANONICAL_PROTOCOL_FUNCTIONS) {
    const broken = validPostbuildProtocol();
    broken[name] = brokenByName[name];
    assert.throws(() => validateProtocolRuntime(broken), Error, name);
  }
});

test('postbuild guard rejects every missing Studio consumer export', () => {
  const valid = Object.fromEntries(
    CANONICAL_CONSUMER_FUNCTIONS.map(name => [name, () => undefined]),
  );
  assert.doesNotThrow(() => validateConsumerRuntime(valid));

  for (const name of CANONICAL_CONSUMER_FUNCTIONS) {
    const incomplete = { ...valid };
    delete incomplete[name];
    assert.throws(
      () => validateConsumerRuntime(incomplete),
      new RegExp(`consumer export is missing: ${name}`),
    );
  }
});

test('postbuild guard rejects every missing bundle marker and Fonts egress', () => {
  const complete = CANONICAL_BUNDLE_MARKERS.join('\n');
  assert.doesNotThrow(() => validateBundleSource(complete));
  assert.throws(() => validateBundleSource(''), /bundle is empty/);
  assert.throws(() => validateBundleSource(null), /bundle is empty/);

  for (const marker of CANONICAL_BUNDLE_MARKERS) {
    const incomplete = CANONICAL_BUNDLE_MARKERS
      .filter(candidate => candidate !== marker)
      .join('\n');
    assert.throws(
      () => validateBundleSource(incomplete),
      new RegExp(`missing M1 marker: ${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    );
  }

  for (const host of ['fonts.googleapis.com', 'fonts.gstatic.com']) {
    assert.throws(
      () => validateBundleSource(`${complete}\nhttps://${host}/font.woff2`),
      /forbidden Google Fonts egress/,
    );
  }
});

function withOwnedPostbuildRoot(callback) {
  const artifactRoot = path.join(REPOSITORY_ROOT, '.intentsmith-artifacts');
  fs.mkdirSync(artifactRoot, { mode: 0o700, recursive: true });
  const owned = fs.mkdtempSync(path.join(artifactRoot, 'postbuild-guard-'));
  try {
    return callback(owned);
  } finally {
    fs.rmSync(owned, { recursive: true });
  }
}

function writePostbuildFile(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

function validPostbuildConsumer() {
  return Object.fromEntries(
    CANONICAL_CONSUMER_FUNCTIONS.map(name => [name, () => undefined]),
  );
}

test('postbuild guard rejects missing, empty, and symlinked artifact files', () => {
  withOwnedPostbuildRoot(owned => {
    const empty = path.join(owned, 'empty.js');
    const regular = path.join(owned, 'regular.js');
    const link = path.join(owned, 'linked.js');
    fs.writeFileSync(empty, '');
    fs.writeFileSync(regular, 'module.exports = {};\n');
    fs.symlinkSync(regular, link);

    assert.throws(
      () => assertRegularFile(path.join(owned, 'missing.js'), 'fixture'),
      /fixture is missing/,
    );
    assert.throws(
      () => assertRegularFile(empty, 'fixture'),
      /fixture is not a non-empty regular file/,
    );
    assert.throws(
      () => assertRegularFile(link, 'fixture'),
      /fixture is not a non-empty regular file/,
    );
    assert.equal(assertRegularFile(regular, 'fixture').size > 0, true);
  });
});

test('postbuild CLI returns nonzero with a stable failure prefix', () => {
  let stdout = '';
  let stderr = '';
  const exitCode = runCli({
    studioRoot: path.join(REPOSITORY_ROOT, 'does-not-exist-postbuild-fixture'),
    stdout: { write(value) { stdout += value; } },
    stderr: { write(value) { stderr += value; } },
  });
  assert.equal(exitCode, 1);
  assert.equal(stdout, '');
  assert.match(
    stderr,
    /^STUDIO_M1_BUILD_CONSUMER_FAIL generated protocol runtime is missing\n$/,
  );
});

test('postbuild CLI composes exact paths and byte-level evidence', () => {
  withOwnedPostbuildRoot(studioRoot => {
    const protocolBytes = Buffer.from('module.exports = {};\n');
    const consumerBytes = Buffer.from('module.exports = {};\n// consumer\n');
    const bundleBytes = Buffer.from(`${CANONICAL_BUNDLE_MARKERS.join('\n')}\nžluťoučký\n`);
    writePostbuildFile(
      studioRoot,
      'extensions/c3-protocol/lib/index.js',
      protocolBytes,
    );
    writePostbuildFile(
      studioRoot,
      'extensions/c3-chat-panel/lib/browser/ws-client.js',
      consumerBytes,
    );
    writePostbuildFile(
      studioRoot,
      'applications/electron/lib/frontend/bundle.js',
      bundleBytes,
    );

    let stdout = '';
    let stderr = '';
    const exitCode = runCli({
      studioRoot,
      protocol: validPostbuildProtocol(),
      consumer: validPostbuildConsumer(),
      stdout: { write(value) { stdout += value; } },
      stderr: { write(value) { stderr += value; } },
    });
    assert.equal(exitCode, 0);
    assert.equal(stderr, '');
    assert.match(stdout, /^STUDIO_M1_BUILD_CONSUMER_PASS /);
    const evidence = JSON.parse(stdout.replace(/^STUDIO_M1_BUILD_CONSUMER_PASS /, ''));
    assert.deepEqual(evidence, {
      bundleBytes: bundleBytes.length,
      bundleSha256: createHash('sha256').update(bundleBytes).digest('hex'),
      consumerBytes: consumerBytes.length,
      consumerSha256: createHash('sha256').update(consumerBytes).digest('hex'),
      protocolBytes: protocolBytes.length,
      protocolSha256: createHash('sha256').update(protocolBytes).digest('hex'),
      protocolVersion: 1,
    });
  });
});

test('consumer probe is isolated and fails closed on top-level effects', () => {
  withOwnedPostbuildRoot(root => {
    const exportsSource = CANONICAL_CONSUMER_FUNCTIONS
      .map(name => `${name}() {}`)
      .join(',\n');
    const safe = writePostbuildFile(
      root,
      'safe.cjs',
      `module.exports = { ${exportsSource} };\n`,
    );
    assert.deepEqual(
      probeConsumerRuntime(safe),
      { exports: [...CANONICAL_CONSUMER_FUNCTIONS] },
    );

    for (const [name, statement] of [
      ['fetch', "fetch('http://127.0.0.1:9')"],
      ['setTimeout', 'setTimeout(() => {}, 1)'],
      ['WebSocket', "new WebSocket('ws://127.0.0.1:9')"],
    ]) {
      const effectful = writePostbuildFile(
        root,
        `${name}.cjs`,
        `${statement}; module.exports = { ${exportsSource} };\n`,
      );
      assert.throws(
        () => probeConsumerRuntime(effectful),
        new RegExp(`forbidden top-level effect: ${name}`),
      );
    }
  });
});

test('prebuild fails closed unless compiled runtime exports the M1 validators', () => {
  const studio = JSON.parse(fs.readFileSync(STUDIO_PACKAGE, 'utf8'));
  const verification = studio.scripts['verify:protocol-runtime'];
  for (const symbol of [
    'validateM1Contract',
    'validateCoreEventStream',
    'classifyTerminal',
    'encodeM1Contract',
    'decodeM1Contract',
    'roundTripM1Contract',
    'isM1ContractEnvelope',
    'M1_CONTRACT_VERSION',
  ]) {
    assert.match(verification, new RegExp(`\\b${symbol}\\b`));
  }
  assert.match(verification, /Missing generated M1 protocol export/);
  assert.match(verification, /Unexpected generated M1 protocol version/);
});

test('protocol package resolves generated index and source index re-exports M1', () => {
  const manifest = JSON.parse(fs.readFileSync(PROTOCOL_PACKAGE, 'utf8'));
  const source = fs.readFileSync(PROTOCOL_INDEX, 'utf8');
  assert.equal(manifest.main, 'lib/index.js');
  assert.equal(manifest.typings, 'lib/index.d.ts');
  assert.match(source, /export \* from ['"]\.\/m1['"]/);
});

test('authoritative panel hard-requires the generated protocol consumer', () => {
  const client = fs.readFileSync(WS_CLIENT, 'utf8');
  const panel = fs.readFileSync(CHAT_PANEL, 'utf8');
  assert.match(client, /require\(['"]@c3\/protocol['"]\)/);
  assert.match(panel, /require\(["']\.\/ws-client["']\);/);
  assert.doesNotMatch(
    panel,
    /try\s*\{\s*require\(["']\.\/ws-client["']\)/,
  );
});

function loadClient(sessions, options = {}) {
  const busEvents = [];
  const sockets = [];
  const backendBase = options.backendBase || 'http://127.0.0.1:3335';

  class FakeWebSocket {
    constructor(url, protocols) {
      if (typeof options.beforeWebSocketConstruct === 'function') {
        options.beforeWebSocketConstruct();
      }
      this.url = url;
      this.protocols = protocols;
      this.readyState = 0;
      this.sent = [];
      sockets.push(this);
    }

    send(encoded) {
      this.sent.push(JSON.parse(encoded));
    }

    close(code, reason) {
      this.closeCode = code;
      this.closeReason = reason;
      if (options.deferClose === true) {
        this.readyState = 2;
        return;
      }
      this.finishClose();
    }

    finishClose() {
      this.readyState = 3;
      if (typeof this.onclose === 'function') this.onclose();
    }
  }

  const HarnessWebSocket = options.WebSocketClass
    ? class extends options.WebSocketClass {
      constructor(url, protocols) {
        super(url, protocols);
        sockets.push(this);
      }
    }
    : FakeWebSocket;

  const context = vm.createContext({
    AbortSignal,
    C3Bus: {
      emit(name, payload) {
        busEvents.push({ name, payload });
        if (typeof options.onBusEmit === 'function') options.onBusEmit(name, payload);
      },
    },
    Date,
    JSON,
    Math,
    TextDecoder,
    WebSocket: HarnessWebSocket,
    _backendBase: backendBase,
    _sessionActive: 0,
    _sessions: sessions,
    clearInterval() {},
    clearTimeout: options.clearTimeout || (() => {}),
    console: options.console || console,
    crypto: {
      randomUUID: () => '11111111-2222-4333-8444-555555555555',
    },
    fetch: options.fetch || (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ messages: [] }),
    })),
    fetchBackendData() {},
    module: { exports: {} },
    require(specifier) {
      assert.equal(specifier, '@c3/protocol');
      return TEST_M1_PROTOCOL;
    },
    setInterval: () => Symbol('interval'),
    setTimeout: options.setTimeout || (() => Symbol('timeout')),
    window: {
      electronC3: {
        getBackendUrl: () => backendBase,
        getLocalCapability: () => options.localCapability || 'A'.repeat(43),
      },
    },
  });
  context.window.window = context.window;

  vm.runInContext(fs.readFileSync(WS_CLIENT, 'utf8'), context, {
    filename: WS_CLIENT.pathname,
  });
  const client = context.module.exports;
  function handshake(socket, features = [], overrides = {}) {
    if (socket.readyState !== 1) {
      socket.readyState = 1;
      socket.onopen();
    }
    const defaultMetadata = features.includes('m1-wire-v1')
      ? m1FeatureMetadata()
      : {};
    socket.onmessage({
      data: JSON.stringify({
        type: 'hello_ack',
        protocolVersion: 1,
        serverVersion: 'test',
        features,
        ...defaultMetadata,
        ...overrides,
      }),
    });
  }

  client.wsConnect();
  const socket = sockets[0];
  if (options.autoHandshake !== false) handshake(socket);
  return { busEvents, client, context, handshake, socket, sockets };
}

suite('M1 Studio client — required-offer wire negotiation');

test('hello offers M1 exactly once and a legacy ACK leaves it disabled', () => {
  const { client, handshake, socket } = loadClient([session()], {
    autoHandshake: false,
  });
  socket.readyState = 1;
  socket.onopen();

  const hello = socket.sent.find(message => message.type === 'hello');
  assert.ok(hello);
  assert.equal(
    hello.features.filter(feature => feature === 'm1-wire-v1').length,
    1,
  );
  assert.equal(client.wsIsM1WireNegotiated(), false);

  handshake(socket, ['workspace', 'audit']);
  assert.equal(client.wsIsReady(), true);
  assert.equal(client.wsIsM1WireNegotiated(), false);
});

test('protocol v1 ACK enables M1 only when the server echoes the offer', () => {
  const { client, handshake, socket } = loadClient([session()], {
    autoHandshake: false,
  });
  handshake(socket, ['workspace', 'm1-wire-v1']);

  assert.equal(client.wsIsReady(), true);
  assert.equal(client.wsHasFeature('m1-wire-v1'), true);
  assert.equal(client.wsIsM1WireNegotiated(), true);
  assert.deepEqual(hostClone(client.wsM1AttachmentPolicy()), hostClone(TEST_M1_ATTACHMENT_POLICY));
});

test('missing or wrong protocol and malformed feature lists keep M1 disabled', () => {
  const missing = loadClient([session()], { autoHandshake: false });
  missing.handshake(
    missing.socket,
    ['m1-wire-v1'],
    { protocolVersion: undefined },
  );
  assert.equal(missing.client.wsIsM1WireNegotiated(), false);

  const wrong = loadClient([session()], { autoHandshake: false });
  wrong.handshake(
    wrong.socket,
    ['m1-wire-v1'],
    { protocolVersion: 2 },
  );
  assert.equal(wrong.client.wsIsM1WireNegotiated(), false);

  const malformed = loadClient([session()], { autoHandshake: false });
  malformed.handshake(
    malformed.socket,
    [],
    { features: 'm1-wire-v1' },
  );
  assert.equal(malformed.client.wsIsM1WireNegotiated(), false);

  const missingPolicy = loadClient([session()], { autoHandshake: false });
  missingPolicy.handshake(
    missingPolicy.socket,
    ['m1-wire-v1'],
    { featureMetadata: undefined },
  );
  assert.equal(missingPolicy.client.wsIsReady(), false);
  assert.equal(missingPolicy.client.wsIsM1WireNegotiated(), false);
  assert.equal(missingPolicy.socket.closeCode, 4000);
  assert.equal(missingPolicy.socket.closeReason, 'Invalid M1 negotiation metadata');

  const invalidMetadata = [
    value => { value.featureMetadata.extra = {}; },
    value => { value.featureMetadata['m1-wire-v1'].extra = true; },
    value => { value.featureMetadata['m1-wire-v1'].version = 2; },
    value => { value.featureMetadata['m1-wire-v1'].attachmentPolicy.extra = true; },
    value => { value.featureMetadata['m1-wire-v1'].attachmentPolicy.maxCount = 0; },
    value => { value.featureMetadata['m1-wire-v1'].attachmentPolicy.maxAggregateBytes = 1; },
    value => { value.featureMetadata['m1-wire-v1'].attachmentPolicy.maxFrameBytes = 2048; },
    value => { value.featureMetadata['m1-wire-v1'].attachmentPolicy.imageMimeTypes.reverse(); },
  ];
  for (const mutate of invalidMetadata) {
    const metadata = m1FeatureMetadata();
    mutate(metadata);
    const candidate = loadClient([session()], { autoHandshake: false });
    candidate.handshake(candidate.socket, ['m1-wire-v1'], metadata);
    assert.equal(candidate.client.wsIsReady(), false);
    assert.equal(candidate.client.wsIsM1WireNegotiated(), false);
    assert.equal(candidate.socket.closeCode, 4000);
    assert.equal(candidate.socket.closeReason, 'Invalid M1 negotiation metadata');
  }
});

test('a reconnect clears the M1 latch until the new socket negotiates it', () => {
  const { client, handshake, socket, sockets } = loadClient([session()], {
    autoHandshake: false,
  });
  handshake(socket, ['m1-wire-v1']);
  assert.equal(client.wsIsM1WireNegotiated(), true);

  client.wsConnect();
  assert.equal(sockets.length, 2);
  assert.equal(client.wsIsM1WireNegotiated(), false);
  assert.equal(JSON.stringify(client.wsServerFeatures()), '[]');

  handshake(sockets[1], ['m1-wire-v1']);
  assert.equal(client.wsIsM1WireNegotiated(), true);
});

async function drainMicrotasks(rounds = 12) {
  for (let index = 0; index < rounds; index++) await Promise.resolve();
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

async function within(promise, label, timeoutMs = 3_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out waiting for ${label}`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function sendServerMessage(socket, message) {
  socket.onmessage({ data: JSON.stringify(message) });
}

function m1CoreEvent(command, sequence, {
  eventType = 'working',
  payload = {},
  status = null,
} = {}) {
  const event = {
    contract: 'CoreEvent',
    version: 1,
    requestId: command.requestId,
    conversationId: command.conversationId,
    turnId: command.turnId,
    sequence,
    phase: status === null ? 'progress' : 'terminal',
    eventType: status === null ? eventType : 'result',
    payload,
  };
  if (status !== null) {
    event.terminalStatus = status;
    event.payload = {
      result: {
        contract: 'ConversationResult',
        version: 1,
        requestId: command.requestId,
        conversationId: command.conversationId,
        turnId: command.turnId,
        status,
        ...(status === 'ok'
          ? { response: { content: 'M1 odpověď', metadata: { mode: 'conversation' } } }
          : { error: { code: status === 'cancelled' ? 'CHAT_CANCELLED' : 'CHAT_FAILED', message: status } }),
      },
    };
  }
  return event;
}

function lastRehydrateRequest(socket) {
  const request = [...socket.sent].reverse().find(message => (
    message.channel === 'control'
    && message.data?.action === 'rehydrate'
  ));
  assert.ok(request, 'rehydrate request was not sent');
  return request.data;
}

function sendCompleteRehydrateAck(socket, { validIds, invalidIds, ...overrides }) {
  const request = lastRehydrateRequest(socket);
  sendServerMessage(socket, {
    channel: 'control',
    data: {
      action: 'rehydrate_ack',
      rehydrateRequestId: request.rehydrateRequestId,
      complete: true,
      validIds,
      invalidIds,
      ...overrides,
    },
  });
  return request;
}

function controlledTimers() {
  const timers = [];
  return {
    timers,
    clearTimeout(timer) {
      if (timer) timer.cleared = true;
    },
    setTimeout(callback, delay) {
      const timer = { callback, cleared: false, delay, ran: false };
      timers.push(timer);
      return timer;
    },
    active() {
      return timers.filter(timer => !timer.cleared && !timer.ran);
    },
    run(timer) {
      assert.ok(timer && !timer.cleared && !timer.ran, 'timer is not runnable');
      timer.ran = true;
      timer.callback();
    },
  };
}

/* Retained below as an explicit shape helper for each Studio pane. */
function session(conversationId = null) {
  return {
    _agentId: conversationId ? `agent-${conversationId}` : null,
    _convId: conversationId,
    _label: conversationId ? `Label ${conversationId}` : '',
    _projectId: null,
    chat: {
      editMode: 'ask',
      msgs: [{ role: 'system', text: 'stale' }],
      _delivery: null,
      _pendingAttachments: null,
      _thinking: { text: 'pending' },
    },
  };
}

function panelSendHarness({
  FileReaderClass = null,
  input = '',
  localRejection = null,
  m1Negotiated = false,
  mode = 'unavailable',
  sessionIndex = 0,
} = {}) {
  const source = fs.readFileSync(CHAT_PANEL, 'utf8');
  const start = source.indexOf('var _TEXT_EXTS=');
  const end = source.indexOf('function _chatPaneUI', start);
  assert.ok(start >= 0 && end > start, 'authoritative panel send slice is missing');

  const textarea = {
    scrollHeight: 37,
    style: { height: '22px' },
    value: input,
  };
  const counters = {
    fetch: 0,
    filesystem: 0,
    provider: 0,
    render: 0,
    scroll: 0,
    shell: 0,
    timers: [],
    tool: 0,
    wsSend: [],
  };
  const pane = {
    _agentId: null,
    _convId: 'studio-send-test',
    _focusFiles: [],
    _projectId: null,
    chat: {
      _delivery: null,
      _pendingAttachments: null,
      _thinking: null,
      acSuggestion: null,
      attachments: [],
      editMode: 'ask',
      editingIdx: null,
      editOriginalText: null,
      expertise: 'Výchozí',
      msgs: [],
      specialist: null,
    },
  };
  const sessions = Array.from({ length: sessionIndex + 1 }, () => session());
  sessions[sessionIndex] = pane;
  let pendingLocalRejection = localRejection;

  const context = vm.createContext({
    C3WS: {
      isReady: () => mode !== 'unavailable',
      isM1WireNegotiated: () => m1Negotiated,
      sendCancel() {
        counters.remoteCancel = (counters.remoteCancel || 0) + 1;
        return true;
      },
      sendChat(content, selectedPane, index) {
        counters.wsSend.push({
          content,
          index,
          pendingAttachments: selectedPane.chat._pendingAttachments
            ? JSON.parse(JSON.stringify(selectedPane.chat._pendingAttachments))
            : null,
          selectedPane,
        });
        if (mode === 'throw') throw new Error('synthetic transport failure');
        return mode !== 'false' && mode !== 'local-reject';
      },
      takeM1SendRejection() {
        const rejection = pendingLocalRejection;
        pendingLocalRejection = null;
        return rejection;
      },
    },
    Date,
    FileReader: FileReaderClass || class UnexpectedFileReader {
      constructor() {
        throw new Error('binary attachment unexpectedly used FileReader');
      }
    },
    Math,
    TextDecoder,
    _focusFileExists: () => false,
    _persistSessionState() {},
    _pollContext: () => { counters.provider++; },
    _sessionActive: sessionIndex,
    _sessionCount: sessions.length,
    _sessions: sessions,
    console,
    document: {
      getElementById(id) {
        return id === `c3-chat-ta-${sessionIndex}` ? textarea : null;
      },
    },
    fetch: async (_url, options = {}) => {
      counters.fetch++;
      /* Legacy /chat is effect-capable regardless of what the renderer predicts. */
      counters.provider++;
      counters.filesystem++;
      counters.shell++;
      counters.tool++;
      return { ok: true, json: async () => ({ response: 'must not render' }) };
    },
    isFocusActive: () => false,
    module: { exports: {} },
    renderAgent() {},
    renderChat: () => { counters.render++; },
    setTimeout(callback, delay) {
      counters.timers.push({ callback, delay });
      return counters.timers.length;
    },
    window: { require: undefined },
    _chatScrollPane: () => { counters.scroll++; },
  });

  vm.runInContext(
    source.slice(start, end)
      + '\nmodule.exports={_chatCancelPreparedSend,_chatGapChoice,_chatInvalidatePreparedSends,_chatSendPane,_chatSendContextIsCurrent,_chatTryWsSend};',
    context,
    { filename: `${CHAT_PANEL.pathname}#send-slice` },
  );

  return {
    counters,
    context,
    functions: context.module.exports,
    pane,
    textarea,
  };
}

function controlledFileReaderClass() {
  const readers = [];
  class ControlledFileReader {
    constructor() {
      readers.push(this);
    }
    readAsText(file) {
      this.file = file;
      this.mode = 'text';
    }
    readAsArrayBuffer(file) {
      this.file = file;
      this.mode = 'bytes';
    }
  }
  return { ControlledFileReader, readers };
}

async function finishControlledReader(reader, outcome = 'load') {
  reader.result = outcome === 'load'
    ? reader.mode === 'bytes'
      ? new TextEncoder().encode('attachment contents').buffer
      : 'attachment contents'
    : null;
  if (outcome === 'load') reader.onload();
  else reader.onerror();
  await drainMicrotasks();
}

function assertNoFallbackEffects(harness, expectedAssistantCount = 0) {
  assert.deepEqual(
    {
      fetch: harness.counters.fetch,
      filesystem: harness.counters.filesystem,
      provider: harness.counters.provider,
      shell: harness.counters.shell,
      tool: harness.counters.tool,
    },
    { fetch: 0, filesystem: 0, provider: 0, shell: 0, tool: 0 },
  );
  assert.equal(
    harness.pane.chat.msgs.filter(message => message.role === 'assistant').length,
    expectedAssistantCount,
  );
  assert.equal(harness.counters.timers.length, 0, 'NOT_SENT scheduled an automatic retry');
}

function settingsBackupHarness(options = {}) {
  const source = fs.readFileSync(CHAT_PANEL, 'utf8');
  const loadStart = source.indexOf('function _loadBCfg(');
  const saveStart = source.indexOf('function _saveBCfg()');
  const saveEnd = source.indexOf('function _bVal', saveStart);
  const bSetStart = source.indexOf('function _bSet', saveEnd);
  const bSetEnd = source.indexOf('/* v91: Feature flags loader', bSetStart);
  const featureStart = bSetEnd;
  const featureEnd = source.indexOf('/* v87.3: Info icon helper', featureStart);
  const start = source.indexOf("var _SETTINGS_BACKUP_KIND=");
  const end = source.indexOf('/* I2: Custom CSS injection', start);
  const panelStart = source.indexOf('function settingsBackupPanel()');
  const panelEnd = source.indexOf('/* v91: Feature Flags panel */', panelStart);
  assert.ok(
    loadStart >= 0 && saveStart > loadStart && saveEnd > saveStart
      && bSetStart >= saveEnd && bSetEnd > bSetStart && featureEnd > featureStart
      && start >= 0 && end > start && panelStart >= 0 && panelEnd > panelStart,
    'settings backup slice is missing',
  );

  const downloads = [];
  const fileInputs = [];
  const requests = [];
  const revokedObjectUrls = [];
  const timers = [];
  const localStorageEffects = [];
  const confirmations = [];
  const requestWaiters = new Map();
  let renders = 0;
  const initialSettings = Object.prototype.hasOwnProperty.call(options, 'initialSettings')
    ? options.initialSettings
    : {
        theme: 'dark',
        webhookSecret: 'destination-webhook-secret',
        'c3.notif.smtpPass': 'destination-smtp-secret',
      };
  const responses = [...(options.responses || [])];
  let context;

  class CapturedBlob {
    constructor(parts, blobOptions = {}) {
      this.parts = [...parts];
      this.type = blobOptions.type;
    }
    text() {
      return Promise.resolve(this.parts.join(''));
    }
  }

  const anchor = {
    click() {
      downloads.push({
        blob: anchor.blob,
        download: anchor.download,
        href: anchor.href,
      });
    },
  };

  context = vm.createContext({
    AbortSignal: { timeout(milliseconds) { return { milliseconds }; } },
    Blob: CapturedBlob,
    C: { accent: '#22c55e', bg3: '#222', border: '#333', border2: '#444', tx1: '#fff', tx2: '#ddd', tx3: '#aaa', tx4: '#888' },
    FileReader: options.FileReaderClass || class UnexpectedSettingsFileReader {
      constructor() { throw new Error('settings FileReader was not expected'); }
    },
    URL: {
      createObjectURL(blob) {
        anchor.blob = blob;
        return 'blob:intentsmith-settings-fixture';
      },
      revokeObjectURL(value) {
        revokedObjectUrls.push(value);
      },
    },
    _bCfg: initialSettings,
    _bCfgRevision: options.initialRevision ?? 1,
    _bCfgLoading: false,
    _featureFlags: options.initialFeatureFlags || { agents: false },
    _ffLoading: false,
    _ffGeneration: 0,
    _ffLoadToken: 0,
    _backendBase: 'http://127.0.0.1:3335',
    _backupMsg: null,
    _bCfgSaveTimer: null,
    clearTimeout(timer) {
      if (timer) timer.cancelled = true;
    },
    confirm(message) { confirmations.push(message); return options.confirmResponse !== false; },
    document: {
      createElement(tagName) {
        if (tagName === 'a') return anchor;
        assert.equal(tagName, 'input');
        const input = { click() { input.clicked = true; } };
        fileInputs.push(input);
        return input;
      },
    },
    fetch(url, init = {}) {
      const request = { url, init };
      requests.push(request);
      const waiters = requestWaiters.get(url);
      if (waiters) {
        requestWaiters.delete(url);
        for (const resolve of waiters) resolve(request);
      }
      const fixture = responses.shift();
      if (fixture instanceof Error) return Promise.reject(fixture);
      if (!fixture) throw new Error(`unexpected settings request: ${url}`);
      if (typeof fixture === 'function') return fixture({ context, init, url });
      return Promise.resolve({
        ok: fixture.ok,
        status: fixture.status,
        json: fixture.jsonError
          ? async () => { throw fixture.jsonError; }
          : async () => vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(fixture.body))})`, context),
      });
    },
    module: { exports: {} },
    h(type, props, ...children) { return { type, props: props || {}, children }; },
    localStorage: {
      clear() { localStorageEffects.push({ method: 'clear' }); },
      getItem(key) { localStorageEffects.push({ method: 'getItem', key }); return null; },
      removeItem(key) { localStorageEffects.push({ method: 'removeItem', key }); },
      setItem(key, value) { localStorageEffects.push({ method: 'setItem', key, value }); },
    },
    _fs(value) { return value; },
    renderCenter() { renders++; },
    setTimeout(callback, delay) {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
  });

  vm.runInContext(
    source.slice(loadStart, saveEnd)
      + '\n'
      + source.slice(bSetStart, bSetEnd)
      + '\n'
      + source.slice(featureStart, featureEnd)
      + '\n'
      + source.slice(start, end)
      + '\n'
      + source.slice(panelStart, panelEnd)
      + '\nmodule.exports={'
      + 'exportBackup:_settingsExportBackup,'
      + 'importJson:function(encoded,fileName){return _settingsImportDocument(JSON.parse(encoded),fileName);},'
      + 'resetAll:_settingsResetAll,'
      + 'loadConfig:_loadBCfg,'
      + 'loadFeatures:_loadFeatureFlags,'
      + 'renderBackup:settingsBackupPanel,'
      + 'setConfig:_bSet,'
      + 'portablePaths:_SETTINGS_PORTABLE_PATHS,'
      + 'replaceAndSave:function(encoded){_settingsGeneration++;_bCfg=JSON.parse(encoded);_saveBCfg();},'
      + 'saveConfig:_saveBCfg,'
      + 'state:function(){return {mutationState:_settingsMutationState,pending:_settingsMutationPending,deliveryUnknown:_settingsDeliveryUnknown,reloadRequired:_settingsReloadRequired,generation:_settingsGeneration,loading:_bCfgLoading,revision:_bCfgRevision};},'
      + 'resetState:function(){return {policyRevision:_settingsPolicyRevision,localPhase:_settingsResetLocalPhase,featureGeneration:_ffGeneration,featureLoading:_ffLoading,featureToken:_ffLoadToken};},'
      + 'features:function(){return _featureFlags;}};',
    context,
    { filename: `${CHAT_PANEL.pathname}#settings-backup` },
  );

  return {
    downloads,
    fileInputs,
    functions: context.module.exports,
    confirmations,
    get renders() { return renders; },
    requests,
    waitForRequest(url) {
      const existing = requests.find(request => request.url === url);
      if (existing) return Promise.resolve(existing);
      return new Promise(resolve => {
        const waiters = requestWaiters.get(url) || [];
        waiters.push(resolve);
        requestWaiters.set(url, waiters);
      });
    },
    localStorageEffects,
    revokedObjectUrls,
    settings: () => hostClone(context._bCfg),
    status: () => hostClone(context._backupMsg),
    timers,
  };
}

function webhookSecurityHarness(options = {}) {
  const source = fs.readFileSync(CHAT_PANEL, 'utf8');
  const stateStart = source.indexOf('var _secTokens=');
  const stateEnd = source.indexOf('var _fbCategory=', stateStart);
  const securityStart = source.indexOf('/* v91: Security panel */');
  const securityEnd = source.indexOf('function _fbGetLastAssistant', securityStart);
  assert.ok(
    stateStart >= 0 && stateEnd > stateStart
      && securityStart >= 0 && securityEnd > securityStart,
    'Webhook Security panel slice is missing',
  );

  const effects = { clipboard: 0, confirm: 0, prompt: 0 };
  const requests = [];
  const responses = [...(options.responses || [])];
  let renders = 0;
  let context;

  context = vm.createContext({
    AbortSignal: { timeout(milliseconds) { return { milliseconds }; } },
    C: {
      accent: '#22c55e',
      bg3: '#222',
      bg4: '#111',
      border: '#333',
      border2: '#444',
      mono: 'monospace',
      tx1: '#fff',
      tx2: '#ddd',
      tx3: '#aaa',
      tx4: '#888',
    },
    _backendBase: 'http://127.0.0.1:3335',
    _fs(value) { return value; },
    confirm() {
      effects.confirm += 1;
      throw new Error('Webhook status unexpectedly requested confirmation');
    },
    fetch(url, init = {}) {
      requests.push({ url, init });
      const fixture = responses.shift();
      if (fixture instanceof Error) return Promise.reject(fixture);
      if (!fixture) throw new Error(`unexpected Webhook Security request: ${url}`);
      return Promise.resolve({
        ok: fixture.ok,
        status: fixture.status,
        json: fixture.jsonError
          ? async () => { throw fixture.jsonError; }
          : async () => vm.runInContext(
            `JSON.parse(${JSON.stringify(JSON.stringify(fixture.body))})`,
            context,
          ),
      });
    },
    h(type, props, ...children) { return { type, props: props || {}, children }; },
    module: { exports: {} },
    navigator: {
      clipboard: {
        writeText() {
          effects.clipboard += 1;
          throw new Error('Webhook status unexpectedly wrote to clipboard');
        },
      },
    },
    prompt() {
      effects.prompt += 1;
      throw new Error('Webhook status unexpectedly opened a prompt');
    },
    renderCenter() { renders += 1; },
  });

  vm.runInContext(
    source.slice(stateStart, stateEnd)
      + '\n'
      + source.slice(securityStart, securityEnd)
      + '\n_secTokens=[];_secAudit={};_secSessions={count:0,uptime_seconds:0};'
      + '\nmodule.exports={'
      + 'loadWebhook:_secLoadWebhook,'
      + 'renderSecurity:settingsSecurityPanel,'
      + 'state:function(){return JSON.parse(JSON.stringify(_secWebhook));}};',
    context,
    { filename: `${CHAT_PANEL.pathname}#webhook-security` },
  );

  return {
    effects,
    functions: context.module.exports,
    get renders() { return renders; },
    requests,
  };
}

function settingsBackupFixture(overrides = {}) {
  const base = {
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
      },
    },
    modelAutomationPolicy: {
      autoFailoverEnabled: false,
      autoCleanupEnabled: false,
      autoCleanupDays: 14,
    },
    omissions: {
      strategy: 'DEFAULT_DENY',
      scope: 'GENERAL_SETTINGS',
      excluded: 'ALL_PATHS_NOT_IN_PROFILE',
      sourceHadExcludedPaths: true,
    },
  };
  return {
    ...base,
    ...overrides,
    settingsProjection: overrides.settingsProjection === undefined
      ? base.settingsProjection
      : overrides.settingsProjection,
  };
}

function settingsBackupV1Fixture(overrides = {}) {
  return {
    kind: 'INTENTSMITH_SETTINGS_BACKUP',
    schemaVersion: 1,
    generalSettings: { appearance: { theme: 'light' } },
    modelAutomationPolicy: null,
    omittedSensitiveKeys: [],
    ...overrides,
  };
}

const LEGACY_CREDENTIAL_RECEIPT_PATHS = Object.freeze([
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

function legacyCredentialSha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function legacyCredentialReceiptFixture(preimage, selectedPaths, action = 'PURGE') {
  const document = JSON.parse(preimage);
  const paths = [...selectedPaths].sort();
  const pathDigests = paths.map(path => {
    const property = path.slice('notifications.'.length);
    return {
      path,
      valueSha256: legacyCredentialSha256(JSON.stringify(document.notifications[property])),
    };
  });
  for (const path of paths) {
    delete document.notifications[path.slice('notifications.'.length)];
  }
  const postimage = JSON.stringify(document);
  const receipt = {
    schema: 'INTENTSMITH_LEGACY_CREDENTIAL_RECEIPT/V1',
    source: 'PAIASS_SETTINGS',
    action,
    preimageSha256: legacyCredentialSha256(preimage),
    postimageSha256: legacyCredentialSha256(postimage),
    pathDigests,
  };
  if (action === 'EXPORT') {
    receipt.exportSha256 = legacyCredentialSha256('verified-export-artifact');
  }
  return { postimage, receipt };
}

function settingsPortableGeneralSettings(overrides = {}) {
  const base = {
    appearance: {
      accentColor: '#6366f1',
      fontFamily: 'system',
      fontSize: 14,
      theme: 'light',
    },
    output: {
      codeStyle: 'default',
      defaultFormat: 'markdown',
      namingConvention: 'camelCase',
    },
    'c3.language': 'cs',
    'c3.output.codeBlocks': true,
    'c3.output.markdownRendering': true,
    'c3.output.syntaxHighlight': true,
  };
  return {
    ...base,
    ...overrides,
    appearance: { ...base.appearance, ...(overrides.appearance || {}) },
    output: { ...base.output, ...(overrides.output || {}) },
  };
}

function settingsImportCommitFixture(overrides = {}) {
  return {
    ok: true,
    success: true,
    revision: 2,
    settings: settingsPortableGeneralSettings(),
    policy: {
      revision: 2,
      autoFailoverEnabled: false,
      autoCleanupEnabled: false,
      autoCleanupDays: 14,
      lastEventId: 'policy-event-fixture-0002',
      updatedAtMs: 1_786_313_600_000,
    },
    event: {
      eventId: 'policy-event-fixture-0002',
      requestId: 'policy-request-fixture-0002',
      eventKind: 'BACKUP_IMPORT',
      actor: 'user:settings-import',
      source: 'SETTINGS_IMPORT',
    },
    featuresChanged: 0,
    sourceSchemaVersion: 2,
    appliedPortablePaths: [...SETTINGS_PORTABLE_PATHS],
    ignoredSourcePathCount: 0,
    preservedLocalPathCount: 0,
    runtimeApplied: true,
    runtimeErrorCode: null,
    ...overrides,
  };
}

function settingsResetCommitFixture(overrides = {}) {
  return {
    ok: true,
    success: true,
    revision: 2,
    settings: {},
    policy: {
      revision: 2,
      autoFailoverEnabled: false,
      autoCleanupEnabled: false,
      autoCleanupDays: 14,
      lastEventId: 'policy-event-fixture-0003',
      updatedAtMs: 1_786_313_600_001,
    },
    event: {
      eventId: 'policy-event-fixture-0003',
      requestId: 'policy-request-fixture-0003',
      eventKind: 'GLOBAL_RESET',
      actor: 'user:global-reset',
      source: 'GLOBAL_RESET',
    },
    runtimeApplied: true,
    runtimeErrorCode: null,
    ...overrides,
  };
}

function settingsPolicyReadFixture(overrides = {}) {
  return {
    ok: true,
    policy: {
      schemaVersion: 1,
      revision: 1,
      autoFailoverEnabled: true,
      autoCleanupEnabled: false,
      autoCleanupDays: 30,
      lastEventId: 'policy-event-fixture-0001',
      updatedAtMs: 1_786_313_599_999,
      ...overrides,
    },
  };
}

function settingsResetResponses(commit, {
  settings = { revision: 1, settings: {} },
  policy = settingsPolicyReadFixture(),
  features = { ok: true, status: 200, body: { features: { agents: true } } },
} = {}) {
  return [
    { ok: true, status: 200, body: settings },
    { ok: true, status: 200, body: policy },
    commit,
    features,
  ];
}

function portableSettingsBackendHarness() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE user_settings (
      id INTEGER PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.transaction(() => {
    migrateModelPolicy(db);
    migrateUserSettingsRevision(db);
  })();
  let requestBody = null;
  let response = null;
  const routes = createMiscRoutes({
    db: { db },
    parseBody: async () => requestBody,
    sendJSON: (_res, status, body) => { response = { status, body }; },
    safeError: error => ({ error: error.message }),
    logger: { debug() {}, error() {}, info() {}, warn() {} },
    callWithAuth: async () => ({}),
    createAuthToken: () => '',
    LLMCallerRole: {},
    featureManager: {
      applySettings() { return 0; },
      resetToDefaults() {},
    },
  });
  return {
    close() { db.close(); },
    async importBackup(body) {
      const current = db.prepare('SELECT revision FROM user_settings WHERE id = 1').get();
      requestBody = { backup: body, expectedRevision: current.revision };
      response = null;
      await routes['POST /api/settings/import']({}, {});
      return response;
    },
  };
}

function architectSettingsHarness(options = {}) {
  const source = fs.readFileSync(ARCHITECT_UI, 'utf8');
  const helperStart = source.indexOf('const ARCHITECT_SETTINGS_DEFAULT_DOCUMENT');
  const helperEnd = source.indexOf('// ═══════════════════════════════════════════════════════════════════════════\n// ACCORDION', helperStart);
  const persistenceStart = source.indexOf('function architectSettingsAdoptV2Snapshot(');
  const persistenceEnd = source.indexOf('function applySettings()', persistenceStart);
  const resetStart = source.indexOf('async function architectSettingsCompleteResetReceipt()');
  const resetMarker = source.indexOf('async function resetSettings()', resetStart);
  const resetEnd = source.indexOf('// ═══════════════════════════════════════════════════════════════════════════\n// ABOUT', resetStart);
  const exportStart = source.indexOf('async function exportSettings()');
  const exportEnd = source.indexOf('// ═══════════════════════════════════════════════════════════════════════════\n// TOAST', exportStart);
  assert.ok(
    helperStart >= 0 && helperEnd > helperStart
      && persistenceStart >= 0 && persistenceEnd > persistenceStart
      && resetStart >= 0 && resetMarker > resetStart && resetEnd > resetMarker
      && exportStart >= 0 && exportEnd > exportStart,
    'Architect portable settings slices are missing',
  );

  const requests = [];
  const responses = [...(options.responses || [])];
  const downloads = [];
  const fileInputs = [];
  const toasts = [];
  const storage = new Map(Object.entries(options.localStorage || {}));
  const storageEffects = { get: [], set: [], remove: [] };
  const confirmations = [];
  const legacyReceiptStatus = { dataset: { state: 'READY' }, textContent: 'READY' };
  let digestCalls = 0;
  let applySettingsCalls = 0;
  let context;

  class CapturedBlob {
    constructor(parts, blobOptions = {}) {
      this.parts = [...parts];
      this.type = blobOptions.type;
    }
    text() { return Promise.resolve(this.parts.join('')); }
  }

  const anchor = {
    click() {
      downloads.push({ blob: anchor.blob, download: anchor.download, href: anchor.href });
    },
  };

  context = vm.createContext({
    Blob: CapturedBlob,
    Date,
    TextEncoder,
    URL: {
      createObjectURL(blob) {
        anchor.blob = blob;
        return 'blob:architect-settings-fixture';
      },
      revokeObjectURL() {},
    },
    _settingsSeed: JSON.stringify(options.initialSettings || {
      appearance: { theme: 'dark', accentColor: '#6366f1', fontFamily: 'system', fontSize: 14 },
      notifications: { telegramToken: 'local-token' },
      output: { defaultFormat: 'markdown', codeStyle: 'default', namingConvention: 'camelCase' },
    }),
    _settingsRevisionSeed: options.initialRevision ?? 1,
    applySettings() {
      applySettingsCalls++;
      if (applySettingsCalls === options.applySettingsThrowOnCall) {
        throw new Error('fixture Architect render failure');
      }
    },
    confirm(message) { confirmations.push(message); return options.confirmResponse !== false; },
    console: { warn() {} },
    crypto: {
      subtle: {
        async digest(algorithm, bytes) {
          assert.equal(algorithm, 'SHA-256');
          digestCalls += 1;
          if (options.storageMutationOnDigestCall === digestCalls) {
            storage.set('paiass_settings', options.storageMutationValue);
          }
          const digest = createHash('sha256').update(Buffer.from(bytes)).digest();
          return digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength);
        },
      },
    },
    document: {
      createElement(tagName) {
        if (tagName === 'a') return anchor;
        assert.equal(tagName, 'input');
        const input = { click() { input.clicked = true; } };
        fileInputs.push(input);
        return input;
      },
      getElementById(id) {
        return id === 'legacy-credential-receipt-status' ? legacyReceiptStatus : null;
      },
    },
    fetch(url, init = {}) {
      requests.push({ url, init });
      const fixture = responses.shift();
      if (fixture instanceof Error) return Promise.reject(fixture);
      if (!fixture) throw new Error(`unexpected Architect settings request: ${url}`);
      if (typeof fixture === 'function') return fixture({ context, init, url });
      return Promise.resolve({
        ok: fixture.ok,
        status: fixture.status,
        json: fixture.jsonError
          ? async () => { throw fixture.jsonError; }
          : async () => vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(fixture.body))})`, context),
      });
    },
    localStorage: {
      getItem(key) {
        storageEffects.get.push(key);
        if (options.storageReadThrowOnCall === storageEffects.get.length) {
          throw new Error('fixture localStorage read failure');
        }
        if (options.storageReadbackValue !== undefined && storageEffects.set.length > 0) {
          return options.storageReadbackValue;
        }
        return storage.has(key) ? storage.get(key) : null;
      },
      removeItem(key) {
        storageEffects.remove.push(key);
        if (options.storageRemoveThrowOnCall === storageEffects.remove.length) {
          throw new Error('fixture localStorage remove failure');
        }
        storage.delete(key);
      },
      setItem(key, value) {
        storageEffects.set.push({ key, value: String(value) });
        if (options.storageWriteThrows) {
          throw new Error('fixture localStorage write failure');
        }
        storage.set(key, String(value));
      },
    },
    module: { exports: {} },
    populateSettingsUI() {},
    showToast(type, title, message) { toasts.push({ type, title, message }); },
    updateSettingsSummary() {},
  });

  vm.runInContext(
    source.slice(helperStart, helperEnd)
      + '\n'
      + source.slice(persistenceStart, persistenceEnd)
      + '\n'
      + source.slice(resetStart, resetEnd)
      + '\n'
      + source.slice(exportStart, exportEnd)
      + '\nObject.assign(settingsState,architectSettingsCloneData(JSON.parse(_settingsSeed)));'
      + '\napplyArchitectSettingsDocument(JSON.parse(_settingsSeed),_settingsRevisionSeed);'
      + '\nmodule.exports={'
      + 'exportSettings,importSettings,loadSettings,resetAll,resetSettings,saveSettings,'
      + 'architectApplyLegacyCredentialReceipt,importLegacyCredentialReceipt,'
      + 'defaults:ARCHITECT_SETTINGS_DEFAULT_DOCUMENT,'
      + 'portablePaths:ARCHITECT_SETTINGS_PORTABLE_PATHS,'
      + 'legacyCredentialPaths:ARCHITECT_LEGACY_CREDENTIAL_PATHS,'
      + 'prototypeState:function(){return {'
      + 'globalPolluted:({}).architectPolluted===true,'
      + 'rootOwn:Object.prototype.hasOwnProperty.call(settingsState,"__proto__"),'
      + 'rootPrototypeSafe:Object.getPrototypeOf(settingsState)===Object.prototype,'
      + 'appearanceOwn:Object.prototype.hasOwnProperty.call(settingsState.appearance,"__proto__"),'
      + 'appearancePrototypeSafe:Object.getPrototypeOf(settingsState.appearance)===Object.prototype};},'
      + 'snapshot:function(){return settingsState;},'
      + 'setTheme:function(value){settingsState.appearance.theme=value;},'
      + 'state:function(){return architectSettingsMutationState;},'
      + 'resetState:function(){return {localPhase:architectSettingsResetLocalPhase,policyRevision:architectSettingsPolicyRevision};},'
      + 'completeResetReceipt:architectSettingsCompleteResetReceipt,'
      + 'legacyReceiptState:function(){return architectLegacyCredentialReceiptState;}};',
    context,
    { filename: `${ARCHITECT_UI.pathname}#portable-settings` },
  );

  return {
    contextValue(value) {
      return vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(value))})`, context);
    },
    downloads,
    fileInputs,
    functions: context.module.exports,
    confirmations,
    requests,
    storage,
    storageEffects,
    legacyReceiptStatus,
    toasts,
  };
}

function centerViewsSettingsHarness(options = {}) {
  const source = fs.readFileSync(CENTER_VIEWS, 'utf8');
  const helperStart = source.indexOf("const PORTABLE_SETTINGS_KIND =");
  const helperEnd = source.indexOf('/* ═══ CenterViewsWidget ═══ */', helperStart);
  const methodsStart = source.indexOf('  async _exportSettings()');
  const methodsEnd = source.indexOf('  // ─── v63.0: Wizard Methods', methodsStart);
  assert.ok(
    helperStart >= 0 && helperEnd > helperStart && methodsStart >= 0 && methodsEnd > methodsStart,
    'Center Views portable settings slices are missing',
  );

  const alerts = [];
  const downloads = [];
  const fileInputs = [];
  const requests = [];
  const responses = [...(options.responses || [])];
  let context;

  class CapturedBlob {
    constructor(parts, blobOptions = {}) {
      this.parts = [...parts];
      this.type = blobOptions.type;
    }
    text() { return Promise.resolve(this.parts.join('')); }
  }
  const anchor = {
    click() { downloads.push({ blob: anchor.blob, download: anchor.download, href: anchor.href }); },
  };
  context = vm.createContext({
    Blob: CapturedBlob,
    Date,
    URL: {
      createObjectURL(blob) {
        anchor.blob = blob;
        return 'blob:center-settings-fixture';
      },
      revokeObjectURL() {},
    },
    alert(message) { alerts.push(message); },
    document: {
      createElement(tagName) {
        if (tagName === 'a') return anchor;
        assert.equal(tagName, 'input');
        const input = { click() { input.clicked = true; } };
        fileInputs.push(input);
        return input;
      },
    },
    fetch(url, init = {}) {
      requests.push({ url, init });
      const fixture = responses.shift();
      if (fixture instanceof Error) return Promise.reject(fixture);
      if (!fixture) throw new Error(`unexpected Center Views settings request: ${url}`);
      return Promise.resolve({
        ok: fixture.ok,
        status: fixture.status,
        json: fixture.jsonError
          ? async () => { throw fixture.jsonError; }
          : async () => vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(fixture.body))})`, context),
      });
    },
    module: { exports: {} },
  });

  const methodSource = source.slice(methodsStart, methodsEnd).trim();
  vm.runInContext(
    source.slice(helperStart, helperEnd)
      + `\nclass PortableMethods {${methodSource}}`
      + '\nmodule.exports={'
      + 'exportSettings:PortableMethods.prototype._exportSettings,'
      + 'exportAll:PortableMethods.prototype._exportAll,'
      + 'importSettings:PortableMethods.prototype._importSettings,'
      + 'portablePaths:PORTABLE_SETTINGS_PATHS};',
    context,
    { filename: `${CENTER_VIEWS.pathname}#portable-settings` },
  );
  const widget = { _portableSettingsMutationState: 'IDLE' };
  return {
    alerts,
    downloads,
    fileInputs,
    functions: context.module.exports,
    requests,
    widget,
  };
}

function renderedText(node) {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(renderedText).join('');
  return renderedText(node.children);
}

function findRenderedElement(root, type, text) {
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.shift();
    if (Array.isArray(node)) {
      pending.unshift(...node);
      continue;
    }
    if (!node || typeof node !== 'object') continue;
    if (node.type === type && renderedText(node) === text) return node;
    pending.unshift(...(node.children || []));
  }
  return null;
}

function terminalPanelHarness(pane = session('panel-terminal')) {
  const source = fs.readFileSync(CHAT_PANEL, 'utf8');
  const start = source.indexOf('function _initBusSubscriptions()');
  const end = source.indexOf('/* ── Health state ──', start);
  assert.ok(start >= 0 && end > start, 'terminal subscription slice is missing');
  const listeners = Object.create(null);
  const counters = { agentRender: 0, persist: 0, render: 0, scroll: 0 };
  if (!Array.isArray(pane.log)) pane.log = [];
  const context = vm.createContext({
    C3Bus: {
      on(name, callback) { listeners[name] = callback; },
    },
    _sessions: [pane],
    _maybeRefreshExpertises() {},
    _persistSessionState() { counters.persist++; },
    _chatScrollPane() { counters.scroll++; },
    console,
    module: { exports: {} },
    renderAgent() { counters.agentRender++; },
    renderCenter() {},
    renderChat() { counters.render++; },
    renderSidebar() {},
    window: {},
  });
  vm.runInContext(
    source.slice(start, end) + '\n_initBusSubscriptions();',
    context,
    { filename: `${CHAT_PANEL.pathname}#terminal-subscription` },
  );
  return { counters, listeners, pane };
}

function upgradeRecoveryPanelHarness(options = {}) {
  const source = fs.readFileSync(CHAT_PANEL, 'utf8');
  const recoveryStart = source.indexOf('/* M1: operation-bound upgrade recovery.');
  const recoveryEndMarker = '/* End M1 operation-bound upgrade recovery. */';
  const recoveryEnd = source.indexOf(recoveryEndMarker, recoveryStart);
  const subscriptionsStart = source.indexOf('function _initBusSubscriptions()');
  const subscriptionsEnd = source.indexOf('/* ── Health state ──', subscriptionsStart);
  assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart, 'upgrade recovery slice is missing');
  assert.ok(
    subscriptionsStart >= 0 && subscriptionsEnd > subscriptionsStart,
    'upgrade subscription slice is missing',
  );
  const listeners = Object.create(null);
  const requests = [];
  const timers = [];
  const counters = { load: 0, logs: [], render: 0 };
  const fetchImpl = options.fetch || (async (url, init) => {
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          ok: true,
          ...JSON.parse(init.body),
          rollbackOperationId: 'rollback-operation-0001',
        };
      },
    };
  });
  const context = vm.createContext({
    AbortSignal,
    C3Bus: { on(name, callback) { listeners[name] = callback; } },
    Date,
    JSON,
    Math,
    Number,
    Object,
    React: { Fragment: Symbol('fragment') },
    _assigningRole: null,
    _backendBase: 'http://127.0.0.1:3335',
    _loadUpgradeData() { counters.load++; },
    _modelOverview: null,
    _roleBindings: null,
    _sessions: [session('upgrade-recovery-panel')],
    _upgradeData: null,
    _upgradeLoading: false,
    _upgradeMsg: null,
    clearTimeout() {},
    console,
    fetch(url, init) {
      requests.push({ url, init });
      return fetchImpl(url, init);
    },
    h() { return {}; },
    module: { exports: {} },
    renderAgent() {},
    renderCenter() { counters.render++; },
    renderChat() {},
    renderSidebar() {},
    setTimeout(callback, delay) {
      const timer = { callback, delay, cancelled: false };
      timers.push(timer);
      return timer;
    },
    window: {
      _c3: {
        agentLog(kind, text) { counters.logs.push({ kind, text }); },
      },
    },
  });
  vm.runInContext(
    source.slice(recoveryStart, recoveryEnd + recoveryEndMarker.length)
      + '\n'
      + source.slice(subscriptionsStart, subscriptionsEnd)
      + '\n_initBusSubscriptions();',
    context,
    { filename: `${CHAT_PANEL.pathname}#upgrade-recovery` },
  );
  return {
    context,
    counters,
    listeners,
    requests,
    snapshot: () => hostClone(context._upgradeRecoverySnapshot()),
    timers,
  };
}

function upgradeVerificationFailure(overrides = {}) {
  return {
    action: 'upgrade_verify_failed',
    role: 'CHAT',
    model: 'fixture-model:latest',
    operationId: 'operation-verification-0001',
    committedBindingRevision: 7,
    failedAttemptRevision: 11,
    text: 'Fixture verification failed',
    ...overrides,
  };
}

test('Studio WS forwards operation-bound verification failure and clear payloads unchanged', () => {
  const { busEvents, socket } = loadClient([session('upgrade-control')]);
  const failure = upgradeVerificationFailure();
  const cleared = {
    ...failure,
    action: 'upgrade_verify_cleared',
    succeededAttemptRevision: 12,
  };
  sendServerMessage(socket, { channel: 'control', data: failure });
  sendServerMessage(socket, { channel: 'control', data: cleared });
  assert.deepEqual(
    hostClone(busEvents.find(event => event.name === 'upgrade:verify_failed').payload),
    failure,
  );
  assert.deepEqual(
    hostClone(busEvents.find(event => event.name === 'upgrade:verify_cleared').payload),
    cleared,
  );
});

test('Studio recovery is actionable only with complete exact identity', () => {
  const harness = upgradeRecoveryPanelHarness();
  const failure = upgradeVerificationFailure();
  for (const role of ['constructor', '__proto__', 'toString', 'chat', 'CHAT ']) {
    harness.listeners['upgrade:verify_failed']({ ...failure, role });
    assert.deepEqual(
      harness.snapshot(),
      [],
      `prototype or non-exact role ${role} must remain warning-only`,
    );
  }
  harness.listeners['upgrade:verify_failed'](failure);
  assert.deepEqual(harness.snapshot(), [{
    role: 'CHAT',
    model: failure.model,
    operationId: failure.operationId,
    committedBindingRevision: failure.committedBindingRevision,
    failedAttemptRevision: failure.failedAttemptRevision,
    token: 1,
    phase: 'READY',
    message: failure.text,
  }]);
  assert.equal(harness.requests.length, 0, 'failure event must never trigger rollback');

  harness.listeners['upgrade:verify_failed']({
    action: 'upgrade_verify_failed',
    role: 'CHAT',
    model: failure.model,
    text: 'Legacy warning without operation identity',
  });
  assert.deepEqual(harness.snapshot(), [], 'incomplete skew event must be warn-only');
  harness.listeners['upgrade:verify_failed'](failure);
  assert.deepEqual(harness.snapshot(), [], 'replayed closed failure must not resurrect recovery');
  assert.equal(harness.requests.length, 0);
});

await testAsync('Studio recovery uses two-step confirmation, exact body and per-role single flight', async () => {
  const harness = upgradeRecoveryPanelHarness();
  const failure = upgradeVerificationFailure();
  harness.listeners['upgrade:verify_failed'](failure);
  const [ready] = harness.snapshot();
  assert.equal(harness.context._upgradeRecoveryBegin(ready.role, ready.token), true);
  assert.equal(harness.snapshot()[0].phase, 'CONFIRMING');
  assert.equal(harness.requests.length, 0, 'first click only confirms user intent');

  const first = harness.context._upgradeRecoveryConfirm(ready.role, ready.token);
  const second = harness.context._upgradeRecoveryConfirm(ready.role, ready.token);
  assert.equal(harness.requests.length, 1, 'double click must produce one request');
  assert.equal(await second, false);
  assert.equal(await first, true);
  assert.equal(
    harness.requests[0].url,
    'http://127.0.0.1:3335/api/system/upgrades/recovery/rollback',
  );
  assert.deepEqual(JSON.parse(harness.requests[0].init.body), {
    role: failure.role,
    operationId: failure.operationId,
    committedBindingRevision: failure.committedBindingRevision,
    failedAttemptRevision: failure.failedAttemptRevision,
  });
  assert.deepEqual(harness.snapshot(), []);
  assert.equal(harness.counters.load, 1);
});

await testAsync('Studio recovery classifies stale, retryable and unknown HTTP outcomes without fallback', async () => {
  const cases = [
    {
      status: 409,
      body: { code: 'MODEL_BINDING_RECOVERY_STALE', error: 'stale' },
      phase: 'DISABLED',
    },
    { status: 500, body: { error: 'server failed' }, phase: 'RETRYABLE' },
    {
      status: 200,
      body: {
        ok: true,
        ...upgradeVerificationFailure(),
        operationId: 'wrong-operation-0001',
        rollbackOperationId: 'rollback-operation-0001',
      },
      phase: 'UNKNOWN',
    },
  ];
  for (const fixture of cases) {
    const harness = upgradeRecoveryPanelHarness({
      fetch: async () => ({
        ok: fixture.status >= 200 && fixture.status < 300,
        status: fixture.status,
        async json() { return fixture.body; },
      }),
    });
    harness.listeners['upgrade:verify_failed'](upgradeVerificationFailure());
    const [record] = harness.snapshot();
    harness.context._upgradeRecoveryBegin(record.role, record.token);
    assert.equal(
      await harness.context._upgradeRecoveryConfirm(record.role, record.token),
      false,
    );
    assert.equal(harness.snapshot()[0].phase, fixture.phase);
    assert.equal(harness.requests.length, 1, 'outcome must not trigger a role-only fallback');
  }

  const network = upgradeRecoveryPanelHarness({
    fetch: async () => { throw new Error('fixture disconnected'); },
  });
  network.listeners['upgrade:verify_failed'](upgradeVerificationFailure());
  const [record] = network.snapshot();
  network.context._upgradeRecoveryBegin(record.role, record.token);
  assert.equal(await network.context._upgradeRecoveryConfirm(record.role, record.token), false);
  assert.equal(network.snapshot()[0].phase, 'RETRYABLE');
  assert.equal(network.requests.length, 1);
});

await testAsync('newer failure survives a deferred response from the replaced recovery token', async () => {
  const response = deferred();
  const harness = upgradeRecoveryPanelHarness({ fetch: async () => response.promise });
  const firstFailure = upgradeVerificationFailure();
  harness.listeners['upgrade:verify_failed'](firstFailure);
  const [first] = harness.snapshot();
  harness.context._upgradeRecoveryBegin(first.role, first.token);
  const pending = harness.context._upgradeRecoveryConfirm(first.role, first.token);

  const newerFailure = upgradeVerificationFailure({
    operationId: 'operation-verification-0002',
    committedBindingRevision: 8,
    failedAttemptRevision: 15,
  });
  harness.listeners['upgrade:verify_failed'](newerFailure);
  const [newer] = harness.snapshot();
  assert.equal(newer.operationId, newerFailure.operationId);
  assert.notEqual(newer.token, first.token);

  response.resolve({
    ok: true,
    status: 200,
    async json() {
      return {
        ok: true,
        role: firstFailure.role,
        operationId: firstFailure.operationId,
        committedBindingRevision: firstFailure.committedBindingRevision,
        failedAttemptRevision: firstFailure.failedAttemptRevision,
        rollbackOperationId: 'rollback-operation-old-0001',
      };
    },
  });
  assert.equal(await pending, false);
  assert.equal(harness.snapshot()[0].operationId, newerFailure.operationId);
  assert.equal(harness.snapshot()[0].phase, 'READY');
});

test('only exact clear invalidates recovery and role-only model_changed is non-authoritative', () => {
  const harness = upgradeRecoveryPanelHarness();
  const failure = upgradeVerificationFailure();
  harness.listeners['upgrade:verify_failed'](failure);
  harness.listeners['model:changed']({
    role: failure.role,
    fromModel: 'fixture-base',
    toModel: failure.model,
  });
  assert.equal(harness.snapshot().length, 1);
  harness.listeners['upgrade:verify_cleared']({
    ...failure,
    action: 'upgrade_verify_cleared',
    model: 'different-model:latest',
    succeededAttemptRevision: failure.failedAttemptRevision + 1,
  });
  assert.equal(harness.snapshot().length, 1, 'clear with a foreign model is not authoritative');
  harness.listeners['upgrade:verify_cleared']({
    ...failure,
    action: 'upgrade_verify_cleared',
    failedAttemptRevision: failure.failedAttemptRevision + 1,
    succeededAttemptRevision: failure.failedAttemptRevision + 2,
  });
  assert.equal(harness.snapshot().length, 1);
  harness.listeners['upgrade:verify_cleared']({
    ...failure,
    action: 'upgrade_verify_cleared',
    succeededAttemptRevision: failure.failedAttemptRevision + 1,
  });
  assert.deepEqual(harness.snapshot(), []);
  harness.listeners['upgrade:verify_failed'](failure);
  assert.deepEqual(harness.snapshot(), [], 'cleared failure replay must stay closed');
});

function agentStateHarness(sessions = []) {
  const listeners = Object.create(null);
  const busEvents = [];
  const context = vm.createContext({
    AbortSignal,
    C3Bus: {
      emit(name, payload) { busEvents.push({ name, payload }); },
      on(name, callback) { listeners[name] = callback; },
    },
    Date,
    console,
    fetch: async () => ({ json: async () => ({}) }),
    module: { exports: {} },
    _sessions: sessions,
  });
  vm.runInContext(fs.readFileSync(AGENT_CLIENT, 'utf8'), context, {
    filename: AGENT_CLIENT.pathname,
  });
  context.module.exports.initAgentClient();
  return { busEvents, client: context.module.exports, listeners };
}

suite('M1 Studio client — canonical producer and terminal ledger');

test('negotiated send uses one exact frame through the required protocol seam', () => {
  const pane = session();
  pane._agentId = 7;
  pane._projectId = 42;
  const { busEvents, client, socket } = loadClient([pane], {
    autoHandshake: false,
  });
  socket.readyState = 1;
  socket.onopen();
  socket.onmessage({
    data: JSON.stringify({
      type: 'hello_ack',
      protocolVersion: 1,
      serverVersion: 'test',
      features: ['m1-wire-v1'],
      ...m1FeatureMetadata(),
    }),
  });

  assert.equal(client.wsSendChat('M1 hello', pane, 0), true);
  const wire = socket.sent.at(-1);
  assert.deepEqual(Object.keys(wire).sort(), ['channel', 'data']);
  assert.equal(wire.channel, 'chat');
  assert.deepEqual(Object.keys(wire.data).sort(), ['command', 'context']);
  assert.equal(validateM1Contract(wire.data.command, 'ConversationCommand').valid, true);
  assert.deepEqual(wire.data.context, {
    editMode: 'ask',
    agentId: '7',
    projectId: '42',
    attachments: [],
  });

  sendServerMessage(socket, {
    channel: 'chat',
    data: m1CoreEvent(wire.data.command, 1, {
      eventType: 'handler_selected',
      payload: { mode: 'conversation' },
    }),
  });
  sendServerMessage(socket, {
    channel: 'chat',
    data: m1CoreEvent(wire.data.command, 2, { status: 'ok' }),
  });

  assert.equal(
    busEvents.some(event => event.name === 'agent:event'),
    true,
  );
  const terminal = busEvents.find(event => event.name === 'chat:terminal');
  assert.equal(terminal.payload.status, 'ok');
  assert.equal(terminal.payload.renderAssistant, true);
  assert.equal(terminal.payload.result.response.content, 'M1 odpověď');
  assert.equal(
    busEvents.some(event => event.name === 'chat:message'),
    false,
    'M1 must render only through the terminal seam',
  );
});

test('negotiated attachment input is local NOT_SENT and never legacy fallback', () => {
  const pane = session();
  pane.chat._pendingAttachments = [{
    name: 'secret.txt',
    type: 'text',
    content: null,
    path: '/private/secret.txt',
  }];
  const { client, socket } = loadClient([pane], { autoHandshake: false });
  socket.readyState = 1;
  socket.onopen();
  socket.onmessage({
    data: JSON.stringify({
      type: 'hello_ack',
      protocolVersion: 1,
      serverVersion: 'test',
      features: ['m1-wire-v1'],
      ...m1FeatureMetadata(),
    }),
  });
  const before = socket.sent.length;
  assert.equal(client.wsSendChat('do not read path', pane, 0), false);
  assert.equal(socket.sent.length, before);
  assert.equal(pane._convId, null, 'failed M1 send published a phantom identity');

  pane.chat._pendingAttachments = { path: '/malformed-private-path' };
  assert.equal(client.wsSendChat('do not normalize malformed attachment state', pane, 0), false);
  assert.equal(socket.sent.length, before);
  assert.equal(pane._convId, null);
});

test('negotiated inline attachments send only exact user-selected bytes', () => {
  const pane = session();
  pane.chat._pendingAttachments = [
    {
      name: 'empty.txt',
      size: '0 KB',
      type: 'text',
      content: '',
      path: null,
    },
    {
      name: 'pixel.png',
      size: '1 KB',
      type: 'image',
      content: 'data:image/png;base64,AQIDBA==',
      path: null,
    },
  ];
  const { client, handshake, socket } = loadClient([pane], { autoHandshake: false });
  handshake(socket, ['m1-wire-v1']);

  assert.equal(client.wsSendChat('bounded bytes', pane, 0), true);
  assert.deepEqual(socket.sent.at(-1).data.context.attachments, [
    { name: 'empty.txt', type: 'text', content: '' },
    { name: 'pixel.png', type: 'image', content: 'data:image/png;base64,AQIDBA==' },
  ]);
  assert.equal(client.wsTakeM1SendRejection(), null);
});

test('negotiated attachment and frame limits fail locally with one typed reason', () => {
  const utf8Policy = createM1AttachmentPolicy({
    maxCount: 2,
    maxTextBytes: 5,
    maxImageBytes: 16,
    maxAggregateBytes: 20,
    maxFrameBytes: 2048,
  });
  const aggregatePolicy = createM1AttachmentPolicy({
    maxCount: 2,
    maxTextBytes: 1024,
    maxImageBytes: 1024,
    maxAggregateBytes: 1500,
    maxFrameBytes: 4096,
  });
  const framePolicy = createM1AttachmentPolicy({
    maxCount: 2,
    maxTextBytes: 1024,
    maxImageBytes: 1024,
    maxAggregateBytes: 2048,
    maxFrameBytes: 2049,
  });
  const cases = [
    {
      name: 'path',
      attachments: [{ name: 'x.txt', type: 'text', content: 'x', path: '/private/x' }],
      reason: 'M1_ATTACHMENT_PATH_FORBIDDEN',
    },
    {
      name: 'malformed state',
      attachments: { name: 'x.txt' },
      reason: 'M1_ATTACHMENT_STATE_INVALID',
    },
    {
      name: 'count',
      attachments: [0, 1, 2].map(index => ({
        name: `x-${index}.txt`, type: 'text', content: 'x',
      })),
      reason: 'M1_ATTACHMENT_COUNT_EXCEEDED',
    },
    {
      name: 'filename',
      attachments: [{ name: '../x.txt', type: 'text', content: 'x' }],
      reason: 'M1_ATTACHMENT_NAME_INVALID',
    },
    {
      name: 'binary',
      attachments: [{ name: 'x.bin', type: 'binary', content: 'x' }],
      reason: 'M1_ATTACHMENT_TYPE_UNSUPPORTED',
    },
    {
      name: 'contentless',
      attachments: [{ name: 'x.txt', type: 'text', content: null }],
      reason: 'M1_ATTACHMENT_CONTENT_UNAVAILABLE',
    },
    {
      name: 'binary decoded as text',
      attachments: [{ name: 'renamed.txt', type: 'text', content: '\u0000\u0001\u0002\ufffd' }],
      reason: 'M1_ATTACHMENT_TEXT_INVALID',
    },
    {
      name: 'unpaired surrogate',
      attachments: [{ name: 'surrogate.txt', type: 'text', content: '\ud800' }],
      reason: 'M1_ATTACHMENT_TEXT_INVALID',
    },
    {
      name: 'UTF-8 bytes',
      attachments: [{ name: 'x.txt', type: 'text', content: 'žluť' }],
      policy: utf8Policy,
      reason: 'M1_ATTACHMENT_TEXT_TOO_LARGE',
    },
    {
      name: 'text item',
      attachments: [{ name: 'x.txt', type: 'text', content: 'x'.repeat(1025) }],
      reason: 'M1_ATTACHMENT_TEXT_TOO_LARGE',
    },
    {
      name: 'image MIME',
      attachments: [{ name: 'x.png', type: 'image', content: 'data:image/png;charset=utf-8;base64,AQ==' }],
      reason: 'M1_ATTACHMENT_IMAGE_INVALID',
    },
    {
      name: 'non-canonical base64',
      attachments: [{ name: 'x.png', type: 'image', content: 'data:image/png;base64,AB==' }],
      reason: 'M1_ATTACHMENT_IMAGE_INVALID',
    },
    {
      name: 'image item',
      attachments: [{
        name: 'x.png',
        type: 'image',
        content: `data:image/png;base64,${Buffer.alloc(1025, 1).toString('base64')}`,
      }],
      reason: 'M1_ATTACHMENT_IMAGE_TOO_LARGE',
    },
    {
      name: 'aggregate',
      attachments: [
        { name: 'a.txt', type: 'text', content: 'a'.repeat(800) },
        { name: 'b.txt', type: 'text', content: 'b'.repeat(800) },
      ],
      policy: aggregatePolicy,
      reason: 'M1_ATTACHMENT_AGGREGATE_TOO_LARGE',
    },
    {
      name: 'whole frame',
      attachments: [],
      input: 'x'.repeat(3000),
      policy: framePolicy,
      reason: 'M1_FRAME_TOO_LARGE',
    },
  ];

  for (const candidate of cases) {
    const pane = session();
    pane.chat._pendingAttachments = candidate.attachments;
    const { client, handshake, socket } = loadClient([pane], { autoHandshake: false });
    handshake(socket, ['m1-wire-v1'], m1FeatureMetadata(
      candidate.policy || TEST_M1_ATTACHMENT_POLICY,
    ));
    const before = socket.sent.length;
    assert.equal(client.wsSendChat(candidate.input || candidate.name, pane, 0), false, candidate.name);
    assert.equal(socket.sent.length, before, `${candidate.name} reached WebSocket.send`);
    assert.deepEqual(hostClone(client.wsTakeM1SendRejection()), {
      status: 'NOT_SENT',
      retryable: false,
      reason: candidate.reason,
      serverAcknowledged: false,
    });
    assert.equal(client.wsTakeM1SendRejection(), null, `${candidate.name} reason replayed`);
    assert.equal(pane._convId, null, `${candidate.name} published identity`);
  }
});

test('foreign, duplicate, post-terminal, and legacy frames fail before generic routing', () => {
  const cases = [
    {
      name: 'foreign',
      send(socket, command) {
        const event = m1CoreEvent(command, 1);
        event.requestId = 'foreign-request';
        event.payload = {};
        sendServerMessage(socket, { channel: 'chat', data: event });
      },
    },
    {
      name: 'foreign-conversation',
      send(socket, command) {
        const event = m1CoreEvent(command, 1);
        event.conversationId = 'foreign-conversation';
        sendServerMessage(socket, { channel: 'chat', data: event });
      },
    },
    {
      name: 'foreign-turn',
      send(socket, command) {
        const event = m1CoreEvent(command, 1);
        event.turnId = 'foreign-turn';
        sendServerMessage(socket, { channel: 'chat', data: event });
      },
    },
    {
      name: 'duplicate-sequence',
      send(socket, command) {
        sendServerMessage(socket, { channel: 'chat', data: m1CoreEvent(command, 1) });
        sendServerMessage(socket, { channel: 'chat', data: m1CoreEvent(command, 1) });
      },
    },
    {
      name: 'post-terminal',
      send(socket, command) {
        sendServerMessage(socket, {
          channel: 'chat',
          data: m1CoreEvent(command, 1, { status: 'cancelled' }),
        });
        sendServerMessage(socket, { channel: 'chat', data: m1CoreEvent(command, 2) });
      },
    },
    {
      name: 'late-ok-after-cancel',
      send(socket, command) {
        sendServerMessage(socket, {
          channel: 'chat',
          data: m1CoreEvent(command, 1, { status: 'cancelled' }),
        });
        sendServerMessage(socket, {
          channel: 'chat',
          data: m1CoreEvent(command, 2, { status: 'ok' }),
        });
      },
    },
    {
      name: 'legacy-assistant',
      send(socket) {
        sendServerMessage(socket, {
          channel: 'chat',
          data: { type: 'assistant', content: 'must not render' },
        });
      },
    },
  ];

  for (const candidate of cases) {
    const pane = session();
    const { busEvents, client, socket } = loadClient([pane], {
      autoHandshake: false,
    });
    socket.readyState = 1;
    socket.onopen();
    socket.onmessage({
      data: JSON.stringify({
        type: 'hello_ack',
        protocolVersion: 1,
        serverVersion: 'test',
        features: ['m1-wire-v1'],
        ...m1FeatureMetadata(),
      }),
    });
    assert.equal(client.wsSendChat(candidate.name, pane, 0), true);
    const command = socket.sent.at(-1).data.command;
    const ownedConversation = pane._convId;
    candidate.send(socket, command);
    assert.equal(socket.closeCode, 1008, candidate.name);
    assert.equal(pane._convId, ownedConversation, candidate.name);
    assert.equal(
      busEvents.some(event => event.name === 'chat:message'),
      false,
      candidate.name,
    );
  }
});

test('M1 cancel has independent identity and terminal ordering stays target then cancel', () => {
  const pane = session();
  const { busEvents, client, socket } = loadClient([pane], {
    autoHandshake: false,
  });
  socket.readyState = 1;
  socket.onopen();
  socket.onmessage({
    data: JSON.stringify({
      type: 'hello_ack',
      protocolVersion: 1,
      serverVersion: 'test',
      features: ['m1-wire-v1'],
      ...m1FeatureMetadata(),
    }),
  });
  assert.equal(client.wsSendChat('cancel me', pane, 0), true);
  const target = socket.sent.at(-1).data.command;
  assert.equal(client.wsSendCancel(pane), true);
  const cancel = socket.sent.at(-1).data.command;
  assert.equal(cancel.action, 'cancel');
  assert.equal(cancel.conversationId, target.conversationId);
  assert.notEqual(cancel.requestId, target.requestId);
  assert.notEqual(cancel.turnId, target.turnId);

  sendServerMessage(socket, {
    channel: 'chat',
    data: m1CoreEvent(target, 1, { status: 'cancelled' }),
  });
  sendServerMessage(socket, {
    channel: 'chat',
    data: m1CoreEvent(cancel, 1, { status: 'cancelled' }),
  });
  const terminals = busEvents.filter(event => event.name === 'chat:terminal');
  assert.deepEqual(
    terminals.map(event => event.payload.requestId),
    [target.requestId, cancel.requestId],
  );
  assert.deepEqual(
    terminals.map(event => event.payload.action),
    ['send', 'cancel'],
  );
});

test('cancel terminal before its target fails the whole negotiated connection', () => {
  const pane = session();
  const { busEvents, client, socket } = loadClient([pane], {
    autoHandshake: false,
  });
  socket.readyState = 1;
  socket.onopen();
  socket.onmessage({
    data: JSON.stringify({
      type: 'hello_ack', protocolVersion: 1, serverVersion: 'test',
      features: ['m1-wire-v1'],
      ...m1FeatureMetadata(),
    }),
  });
  assert.equal(client.wsSendChat('cancel ordering', pane, 0), true);
  const target = socket.sent.at(-1).data.command;
  assert.equal(client.wsSendCancel(pane), true);
  const cancel = socket.sent.at(-1).data.command;

  sendServerMessage(socket, {
    channel: 'chat',
    data: m1CoreEvent(cancel, 1, { status: 'cancelled' }),
  });
  assert.equal(socket.closeCode, 1008);
  assert.equal(
    busEvents.some(event => (
      event.name === 'chat:terminal'
      && event.payload.requestId === cancel.requestId
      && event.payload.status === 'cancelled'
    )),
    false,
  );
  assert.equal(
    busEvents.some(event => (
      event.name === 'chat:terminal'
      && event.payload.result.error.code === 'M1_PROTOCOL_ERROR'
    )),
    true,
  );
  assert.notEqual(target.requestId, cancel.requestId);
});

test('a moved pane keeps object-owned terminal routing at its current index', () => {
  const paneA = session('pane-A');
  const paneB = session('pane-B');
  const sessions = [paneA, paneB];
  const { busEvents, client, socket } = loadClient(sessions, { autoHandshake: false });
  socket.readyState = 1;
  socket.onopen();
  socket.onmessage({
    data: JSON.stringify({
      type: 'hello_ack', protocolVersion: 1, serverVersion: 'test',
      features: ['m1-wire-v1'],
      ...m1FeatureMetadata(),
    }),
  });
  assert.equal(client.wsSendChat('move me', paneB, 1), true);
  const command = socket.sent.at(-1).data.command;
  sessions[0] = paneB;
  sessions[1] = paneA;
  sendServerMessage(socket, {
    channel: 'chat',
    data: m1CoreEvent(command, 1, { status: 'ok' }),
  });
  const terminal = busEvents.find(event => (
    event.name === 'chat:terminal' && event.payload.requestId === command.requestId
  ));
  assert.equal(terminal.payload.sessionIdx, 0);
});

test('one M1 send per conversation is enforced before another wire effect', () => {
  const pane = session();
  const { client, socket } = loadClient([pane], { autoHandshake: false });
  socket.readyState = 1;
  socket.onopen();
  socket.onmessage({
    data: JSON.stringify({
      type: 'hello_ack', protocolVersion: 1, serverVersion: 'test',
      features: ['m1-wire-v1'],
      ...m1FeatureMetadata(),
    }),
  });
  assert.equal(client.wsSendChat('first', pane, 0), true);
  const first = socket.sent.at(-1).data.command;
  const before = socket.sent.length;
  assert.equal(client.wsHasActiveM1Turn(pane), true);
  assert.equal(client.wsSendChat('must stay local', pane, 0), false);
  assert.equal(socket.sent.length, before);
  sendServerMessage(socket, {
    channel: 'chat',
    data: m1CoreEvent(first, 1, { status: 'ok' }),
  });
  assert.equal(client.wsHasActiveM1Turn(pane), false);
  assert.equal(client.wsSendChat('after terminal', pane, 0), true);
});

test('conversation authority rejects a second pane object with the same identity', () => {
  const paneA = session('shared-conversation');
  const paneB = session('shared-conversation');
  const { busEvents, client, socket } = loadClient([paneA, paneB], { autoHandshake: false });
  socket.readyState = 1;
  socket.onopen();
  socket.onmessage({
    data: JSON.stringify({
      type: 'hello_ack', protocolVersion: 1, serverVersion: 'test',
      features: ['m1-wire-v1'],
      ...m1FeatureMetadata(),
    }),
  });

  assert.equal(client.wsSendChat('first owner', paneA, 0), true);
  const target = socket.sent.at(-1).data.command;
  const chatFramesBefore = socket.sent.filter(message => message.channel === 'chat').length;
  assert.equal(client.wsHasActiveM1Turn(paneB), true);
  assert.equal(client.wsSendChat('duplicate owner', paneB, 1), false);
  assert.equal(
    socket.sent.filter(message => message.channel === 'chat').length,
    chatFramesBefore,
  );

  assert.equal(client.wsSendCancel(paneB), true);
  const cancel = socket.sent.at(-1).data.command;
  assert.equal(cancel.action, 'cancel');
  assert.equal(cancel.conversationId, 'shared-conversation');
  sendServerMessage(socket, {
    channel: 'chat',
    data: m1CoreEvent(target, 1, { status: 'cancelled' }),
  });
  sendServerMessage(socket, {
    channel: 'chat',
    data: m1CoreEvent(cancel, 1, { status: 'cancelled' }),
  });
  const cancelTerminal = busEvents.find(event => (
    event.name === 'chat:terminal'
    && event.payload.requestId === cancel.requestId
  ));
  assert.equal(cancelTerminal.payload.sessionIdx, 0);
});

test('reconnect interrupts a pending M1 turn without resend or legacy downgrade', () => {
  const pane = session();
  const { busEvents, client, socket, sockets } = loadClient([pane], {
    autoHandshake: false,
  });
  socket.readyState = 1;
  socket.onopen();
  socket.onmessage({
    data: JSON.stringify({
      type: 'hello_ack',
      protocolVersion: 1,
      serverVersion: 'test',
      features: ['m1-wire-v1'],
      ...m1FeatureMetadata(),
    }),
  });
  assert.equal(client.wsSendChat('pending', pane, 0), true);
  const oldChatFrames = socket.sent.filter(message => message.channel === 'chat').length;
  client.wsConnect();
  assert.equal(sockets.length, 2);
  assert.equal(
    socket.sent.filter(message => message.channel === 'chat').length,
    oldChatFrames,
  );
  const interrupted = busEvents.find(event => (
    event.name === 'chat:terminal'
    && event.payload.result.error.code === 'M1_CONNECTION_REPLACED'
  ));
  assert.ok(interrupted);
  assert.equal(interrupted.payload.renderAssistant, false);
});

await testAsync('connection interruption remains visible after authoritative history replacement', async () => {
  const pane = session();
  pane.chat.msgs = [{ role: 'system', text: 'before send' }];
  const panel = terminalPanelHarness(pane);
  const { client, handshake, socket, sockets } = loadClient([pane], {
    autoHandshake: false,
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        messages: [{
          role: 'assistant',
          content: 'authoritative history',
          metadata: JSON.stringify({ mode: 'conversation' }),
        }],
      }),
    }),
    onBusEmit(name, payload) {
      if (name === 'chat:terminal') panel.listeners['chat:terminal'](payload);
    },
  });
  handshake(socket, ['m1-wire-v1']);
  assert.equal(client.wsSendChat('outcome may be unknown', pane, 0), true);
  const oldChatFrames = socket.sent.filter(message => message.channel === 'chat').length;

  client.wsConnect();
  assert.equal(pane.chat._delivery.status, 'DELIVERY_UNKNOWN');
  assert.equal(pane.chat._delivery.retryable, false);
  assert.equal(pane.chat._delivery.reason, 'M1_CONNECTION_REPLACED');
  assert.equal(
    socket.sent.filter(message => message.channel === 'chat').length,
    oldChatFrames,
  );

  const replacement = sockets[1];
  handshake(replacement, ['m1-wire-v1']);
  sendCompleteRehydrateAck(replacement, {
    validIds: [pane._convId],
    invalidIds: [],
  });
  await drainMicrotasks();

  assert.deepEqual(hostClone(pane.chat.msgs), [{
    role: 'assistant',
    text: 'authoritative history',
    tag: 'conversation',
  }]);
  assert.equal(pane.chat._delivery.status, 'DELIVERY_UNKNOWN');
  assert.equal(pane.chat._delivery.retryable, false);
  assert.equal(
    pane.chat.msgs.some(message => message.text === 'outcome may be unknown'),
    false,
  );
});

test('bounded terminal tombstones do not permanently exhaust the M1 ledger', () => {
  const pane = session();
  const { client, context, socket } = loadClient([pane], { autoHandshake: false });
  socket.readyState = 1;
  socket.onopen();
  socket.onmessage({
    data: JSON.stringify({
      type: 'hello_ack',
      protocolVersion: 1,
      serverVersion: 'test',
      features: ['m1-wire-v1'],
      ...m1FeatureMetadata(),
    }),
  });

  let lastRequestId = null;
  for (let index = 0; index < 260; index++) {
    assert.equal(client.wsSendChat(`bounded-${index}`, pane, 0), true, `send ${index}`);
    const command = socket.sent.at(-1).data.command;
    lastRequestId = command.requestId;
    sendServerMessage(socket, {
      channel: 'chat',
      data: m1CoreEvent(command, 1, { status: 'ok' }),
    });
  }
  assert.equal(socket.closeCode, undefined);
  assert.equal(
    socket.sent.filter(message => message.channel === 'chat').length,
    260,
  );
  const tombstone = context._m1Ledger[lastRequestId];
  assert.deepEqual(hostClone(tombstone.events), []);
  assert.equal(tombstone.serializedBytes, 0);
  assert.equal(tombstone.session, null);
  assert.equal(tombstone.socket, null);
});

test('active M1 stream rejects per-turn count and aggregate payload exhaustion', () => {
  for (const mode of ['count', 'size']) {
    const pane = session();
    const { client, socket } = loadClient([pane], { autoHandshake: false });
    socket.readyState = 1;
    socket.onopen();
    socket.onmessage({
      data: JSON.stringify({
        type: 'hello_ack', protocolVersion: 1, serverVersion: 'test',
        features: ['m1-wire-v1'],
        ...m1FeatureMetadata(),
      }),
    });
    assert.equal(client.wsSendChat(`bounded-${mode}`, pane, 0), true);
    const command = socket.sent.at(-1).data.command;
    if (mode === 'count') {
      for (let sequence = 1; sequence <= 257 && socket.closeCode === undefined; sequence++) {
        sendServerMessage(socket, {
          channel: 'chat',
          data: m1CoreEvent(command, sequence, { payload: { sequence } }),
        });
      }
    } else {
      sendServerMessage(socket, {
        channel: 'chat',
        data: m1CoreEvent(command, 1, { payload: { chunk: 'x'.repeat(1048576) } }),
      });
    }
    assert.equal(socket.closeCode, 1008, mode);
  }
});

test('aggregate stream limit is enforced in UTF-8 bytes, not UTF-16 units', () => {
  const pane = session();
  const { client, socket } = loadClient([pane], { autoHandshake: false });
  socket.readyState = 1;
  socket.onopen();
  socket.onmessage({
    data: JSON.stringify({
      type: 'hello_ack', protocolVersion: 1, serverVersion: 'test',
      features: ['m1-wire-v1'],
      ...m1FeatureMetadata(),
    }),
  });
  assert.equal(client.wsSendChat('unicode byte bound', pane, 0), true);
  const command = socket.sent.at(-1).data.command;
  const chunk = '😀'.repeat(270000);
  assert.ok(chunk.length < 1048576);
  assert.ok(Buffer.byteLength(chunk, 'utf8') > 1048576);
  sendServerMessage(socket, {
    channel: 'chat',
    data: m1CoreEvent(command, 1, { payload: { chunk } }),
  });
  assert.equal(socket.closeCode, 1008);
});

test('one panel terminal seam renders only ok as assistant and ends every spinner', () => {
  const ok = terminalPanelHarness();
  ok.listeners['chat:terminal']({
    sessionIdx: 0,
    action: 'send',
    status: 'ok',
    renderAssistant: true,
    result: {
      status: 'ok',
      response: { content: 'exact ok', metadata: { mode: 'conversation' } },
    },
  });
  assert.equal(ok.pane.chat._thinking, null);
  assert.equal(ok.pane.chat.msgs.at(-1).role, 'assistant');
  assert.equal(ok.pane.chat.msgs.at(-1).text, 'exact ok');

  const failed = terminalPanelHarness();
  failed.listeners['chat:terminal']({
    sessionIdx: 0,
    action: 'send',
    status: 'error',
    renderAssistant: false,
    result: { status: 'error', error: { code: 'CHAT_FAILED', message: 'exact failure' } },
  });
  assert.equal(failed.pane.chat._thinking, null);
  assert.equal(failed.pane.chat.msgs.at(-1).role, 'system');
  assert.equal(failed.pane.chat.msgs.at(-1).text, 'exact failure');
  assert.equal(
    failed.pane.chat.msgs.some(message => message.role === 'assistant'),
    false,
  );

  const cancelAck = terminalPanelHarness();
  const before = cancelAck.pane.chat.msgs.length;
  const thinkingBeforeCancelAck = cancelAck.pane.chat._thinking;
  cancelAck.listeners['chat:terminal']({
    sessionIdx: 0,
    action: 'cancel',
    status: 'cancelled',
    renderAssistant: false,
    result: { status: 'cancelled', error: { code: 'CHAT_CANCELLED', message: 'cancelled' } },
  });
  assert.equal(cancelAck.pane.chat._thinking, thinkingBeforeCancelAck);
  assert.equal(cancelAck.pane.chat.msgs.length, before);
  assert.equal(cancelAck.pane.log.at(-1).text, 'Zrušení potvrzeno.');

  const cancelFailed = terminalPanelHarness();
  const thinkingBeforeCancelFailure = cancelFailed.pane.chat._thinking;
  cancelFailed.listeners['chat:terminal']({
    sessionIdx: 0,
    action: 'cancel',
    status: 'timeout',
    renderAssistant: false,
    result: { status: 'timeout', error: { code: 'CHAT_TIMEOUT', message: 'not confirmed' } },
  });
  assert.equal(cancelFailed.pane.chat._thinking, thinkingBeforeCancelFailure);
  assert.equal(cancelFailed.pane.chat.msgs.at(-1).role, 'system');
  assert.equal(cancelFailed.pane.chat.msgs.at(-1).text, 'not confirmed');
});

test('canonical send terminal follows conversation ownership after a pane swap', () => {
  const paneA = session('agent-state-A');
  const paneB = session('agent-state-B');
  const sessions = [paneA, paneB];
  const harness = agentStateHarness(sessions);
  harness.listeners['agent:event']({
    sessionIdx: 1,
    event: {
      conversationId: 'agent-state-B',
      transport: 'm1',
      type: 'turn_start',
      payload: {},
    },
  });
  assert.equal(harness.client.isAgentExecuting(1), true);
  sessions[0] = paneB;
  sessions[1] = paneA;
  assert.equal(harness.client.isAgentExecuting(0), true);
  assert.equal(harness.client.isAgentExecuting(1), false);
  harness.listeners['chat:terminal']({
    sessionIdx: 0,
    action: 'send',
    conversationId: 'agent-state-B',
    status: 'ok',
  });
  harness.listeners['status:update']({
    sessionIdx: 1,
    transport: 'm1',
    data: { agentStatus: 'executing', conversationId: 'agent-state-B' },
  });
  assert.equal(harness.client.isAgentExecuting(0), false);
  assert.equal(harness.client.isAgentExecuting(1), false);
  assert.deepEqual(
    hostClone(harness.busEvents.at(-1)),
    {
      name: 'agent:state',
      payload: {
        sessionIdx: 0,
        conversationId: 'agent-state-B',
        executing: false,
      },
    },
  );

  const panel = terminalPanelHarness();
  assert.equal(typeof panel.listeners['agent:state'], 'function');
  const rendersBefore = panel.counters.agentRender;
  panel.listeners['agent:state']({ executing: false });
  assert.equal(panel.counters.agentRender, rendersBefore + 1);
});

suite('M1 Studio client — actual producer/adapter/ledger composition');

const CROSS_BOUNDARY_LOGGER = Object.freeze({
  error() {},
  info() {},
  warn() {},
});

function crossBoundaryHarness(handleRequest, conversationId) {
  const pane = session(conversationId);
  const studio = loadClient([pane], { autoHandshake: false });
  studio.handshake(studio.socket, ['m1-wire-v1']);
  const serverMessages = [];
  const adapter = createSessionAdapter({
    send(encoded) {
      const message = JSON.parse(encoded);
      serverMessages.push(message);
      sendServerMessage(studio.socket, message);
    },
    handleRequest,
    logger: CROSS_BOUNDARY_LOGGER,
    m1AttachmentPolicy: TEST_M1_ATTACHMENT_POLICY,
    sessionId: `cross-boundary-${conversationId}`,
    staleClock: {
      now: () => 0,
      setInterval: () => Symbol('cross-boundary-sweep'),
      clearInterval() {},
    },
  });
  return {
    ...studio,
    adapter,
    pane,
    serverMessages,
    cleanup() {
      adapter.cleanup();
      studio.client.wsDestroy();
    },
    frames() {
      return studio.socket.sent.filter(message => (
        message.channel === 'chat'
        && message.data?.command?.contract === 'ConversationCommand'
      ));
    },
  };
}

function assertCanonicalCrossBoundaryMessages(messages, busEvents) {
  assert.equal(
    messages.some(message => message.channel === 'agent'),
    false,
    'negotiated adapter must not emit legacy agent envelopes',
  );
  assert.equal(
    messages.some(message => (
      message.channel === 'chat'
      && ['assistant', 'turn_end'].includes(message.data?.type)
    )),
    false,
    'negotiated adapter must not emit legacy assistant or turn_end envelopes',
  );
  assert.equal(
    messages.some(message => (
      message.channel === 'chat'
      && message.data?.contract !== 'CoreEvent'
    )),
    false,
    'every negotiated chat envelope must contain a CoreEvent',
  );
  assert.equal(
    messages.some(message => message.data?.eventType === 'turn_end'),
    false,
    'negotiated adapter must not disguise legacy turn_end as a CoreEvent',
  );
  assert.equal(
    busEvents.some(event => event.name === 'chat:message'),
    false,
    'M1 must render only through the canonical terminal seam',
  );
}

await testAsync('actual Studio and server seams agree on success, error, and cancel', async () => {
  const telemetryBefore = config.features.telemetry;
  config.features.telemetry = false;
  try {
    {
      let controllerEffects = 0;
      let expectedFrame = null;
      const harness = crossBoundaryHarness(async request => {
        controllerEffects++;
        assert.ok(expectedFrame, 'the actual Studio frame must exist before controller entry');
        assert.equal(request.message, expectedFrame.command.input);
        assert.equal(request.requestId, expectedFrame.command.requestId);
        assert.equal(request.turnId, expectedFrame.command.turnId);
        assert.equal(request.conversationId, expectedFrame.command.conversationId);
        assert.equal(request.projectId, expectedFrame.context.projectId);
        assert.deepEqual(request.attachments, expectedFrame.context.attachments);
        assert.equal(request.context.requestId, expectedFrame.command.requestId);
        assert.equal(request.context.turnId, expectedFrame.command.turnId);
        assert.equal(request.context.conversationId, expectedFrame.command.conversationId);
        assert.equal(request.context.editMode, expectedFrame.context.editMode);
        assert.equal(request.context.agentId, expectedFrame.context.agentId);
        assert.equal(request.context.projectId, expectedFrame.context.projectId);
        request.context.onSystemStep('cross-boundary', 'actual adapter progress', 1);
        return {
          response: 'Skutečná odpověď přes oba seam-y',
          mode: 'conversation',
          confidence: 1,
          state: { source: 'cross-boundary' },
        };
      }, 'cross-boundary-success');
      try {
        harness.pane._projectId = 'project-cross-boundary-success';
        assert.equal(harness.client.wsSendChat('M1 success', harness.pane, 0), true);
        const frame = harness.frames().at(-1);
        assert.ok(frame);
        expectedFrame = frame.data;
        await harness.adapter.processM1Command(frame.data);

        const events = harness.serverMessages
          .filter(message => message.data?.requestId === frame.data.command.requestId)
          .map(message => message.data);
        assert.equal(controllerEffects, 1);
        assert.equal(validateCoreEventStream(events).valid, true);
        assert.equal(events.at(-1).terminalStatus, 'ok');
        const terminal = harness.busEvents.find(event => (
          event.name === 'chat:terminal'
          && event.payload.requestId === frame.data.command.requestId
        ));
        assert.equal(terminal.payload.status, 'ok');
        assert.equal(terminal.payload.renderAssistant, true);
        assert.equal(
          terminal.payload.result.response.content,
          'Skutečná odpověď přes oba seam-y',
        );
        const progress = harness.busEvents.filter(event => (
          event.name === 'agent:event'
          && event.payload.event.type === 'system_step'
          && event.payload.event.transport === 'm1'
        ));
        assert.equal(progress.length, 1);
        assert.equal(progress[0].payload.event.payload.step, 'cross-boundary');
        assert.equal(
          progress[0].payload.event.payload.detail,
          'actual adapter progress',
        );
        assertCanonicalCrossBoundaryMessages(harness.serverMessages, harness.busEvents);
      } finally {
        harness.cleanup();
      }
    }

    {
      const harness = crossBoundaryHarness(async () => {
        throw new LLMProviderUnavailableError('LLM_CALL_FAILED');
      }, 'cross-boundary-provider-error');
      try {
        assert.equal(harness.client.wsSendChat('M1 failure', harness.pane, 0), true);
        const frame = harness.frames().at(-1);
        await harness.adapter.processM1Command(frame.data);

        const events = harness.serverMessages
          .filter(message => message.data?.requestId === frame.data.command.requestId)
          .map(message => message.data);
        assert.equal(validateCoreEventStream(events).valid, true);
        assert.equal(events.at(-1).terminalStatus, 'error');
        assert.equal(
          events.at(-1).payload.result.error.code,
          'LLM_PROVIDER_UNAVAILABLE',
        );
        const terminals = harness.busEvents.filter(event => (
          event.name === 'chat:terminal'
          && event.payload.requestId === frame.data.command.requestId
        ));
        assert.equal(terminals.length, 1);
        assert.equal(terminals[0].payload.status, 'error');
        assert.equal(terminals[0].payload.renderAssistant, false);
        assertCanonicalCrossBoundaryMessages(harness.serverMessages, harness.busEvents);
      } finally {
        harness.cleanup();
      }
    }

    {
      const targetStarted = deferred();
      const harness = crossBoundaryHarness(request => {
        targetStarted.resolve(request);
        return new Promise((_resolve, reject) => {
          request.signal.addEventListener('abort', () => reject(request.signal.reason), {
            once: true,
          });
        });
      }, 'cross-boundary-cancel');
      try {
        assert.equal(harness.client.wsSendChat('M1 pending', harness.pane, 0), true);
        const targetFrame = harness.frames().at(-1);
        const targetRun = harness.adapter.processM1Command(targetFrame.data);
        await targetStarted.promise;

        assert.equal(harness.client.wsSendCancel(harness.pane), true);
        const cancelFrame = harness.frames().at(-1);
        assert.notEqual(cancelFrame.data.command.requestId, targetFrame.data.command.requestId);
        const cancelRun = harness.adapter.processM1Command(cancelFrame.data);
        await Promise.all([targetRun, cancelRun]);

        const terminalEvents = harness.serverMessages
          .filter(message => (
            message.channel === 'chat'
            && message.data?.contract === 'CoreEvent'
            && message.data.phase === 'terminal'
          ))
          .map(message => message.data);
        assert.deepEqual(
          terminalEvents.map(event => event.requestId),
          [targetFrame.data.command.requestId, cancelFrame.data.command.requestId],
        );
        assert.deepEqual(
          terminalEvents.map(event => event.terminalStatus),
          ['cancelled', 'cancelled'],
        );
        for (const frame of [targetFrame, cancelFrame]) {
          const stream = harness.serverMessages
            .filter(message => message.data?.requestId === frame.data.command.requestId)
            .map(message => message.data);
          assert.equal(validateCoreEventStream(stream).valid, true);
        }
        const clientTerminals = harness.busEvents
          .filter(event => event.name === 'chat:terminal')
          .map(event => ({
            action: event.payload.action,
            requestId: event.payload.requestId,
            status: event.payload.status,
          }));
        assert.deepEqual(clientTerminals, [
          {
            action: 'send',
            requestId: targetFrame.data.command.requestId,
            status: 'cancelled',
          },
          {
            action: 'cancel',
            requestId: cancelFrame.data.command.requestId,
            status: 'cancelled',
          },
        ]);
        assertCanonicalCrossBoundaryMessages(harness.serverMessages, harness.busEvents);
      } finally {
        harness.cleanup();
      }
    }
  } finally {
    config.features.telemetry = telemetryBefore;
  }
});

await testAsync('actual M1 seams preserve inline bytes and discard path authority', async () => {
  const telemetryBefore = config.features.telemetry;
  config.features.telemetry = false;
  let controllerAttachments = null;
  const harness = crossBoundaryHarness(async request => {
    controllerAttachments = request.attachments;
    return { response: 'inline accepted', mode: 'conversation', confidence: 1 };
  }, 'cross-boundary-attachments');
  try {
    harness.pane.chat._pendingAttachments = [
      {
        name: 'utf8.txt',
        type: 'text',
        content: 'žluť',
        path: null,
        size: '1 KB',
      },
      {
        name: 'pixel.png',
        type: 'image',
        content: 'data:image/png;base64,AQIDBA==',
        path: null,
        size: '1 KB',
      },
    ];
    assert.equal(harness.client.wsSendChat('M1 inline', harness.pane, 0), true);
    const frame = harness.frames().at(-1);
    assert.deepEqual(frame.data.context.attachments, [
      { name: 'utf8.txt', type: 'text', content: 'žluť' },
      { name: 'pixel.png', type: 'image', content: 'data:image/png;base64,AQIDBA==' },
    ]);
    await harness.adapter.processM1Command(frame.data);
    assert.deepEqual(controllerAttachments, [
      { name: 'utf8.txt', type: 'text', content: 'žluť', size: 6 },
      {
        name: 'pixel.png',
        type: 'image',
        content: 'data:image/png;base64,AQIDBA==',
        size: 4,
      },
    ]);
    assert.equal(controllerAttachments.some(attachment => 'path' in attachment), false);
    assertCanonicalCrossBoundaryMessages(harness.serverMessages, harness.busEvents);
  } finally {
    harness.cleanup();
    config.features.telemetry = telemetryBefore;
  }
});

await testAsync('owned loopback carries three Studio panels over the negotiated M1 wire', async () => {
  const telemetryBefore = config.features.telemetry;
  const capability = createLegacyLocalCapability();
  const historyRequests = [];
  const durableLookups = [];
  const httpServer = createServer((request, response) => {
    const match = /^\/api\/conversations\/([^/]+)\/messages$/.exec(request.url || '');
    if (match) {
      const conversationId = decodeURIComponent(match[1]);
      historyRequests.push(conversationId);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        messages: [{
          role: 'assistant',
          content: `restored:${conversationId}`,
          metadata: null,
        }],
      }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const targetStarted = deferred();
  let controllerEffects = 0;
  const ready = deferred();
  const disconnected = deferred();
  const reconnectReady = deferred();
  const reconnectRestored = deferred();
  let readyCount = 0;
  let durableDb = null;
  const observedTerminals = [];
  const terminalWaiters = [];
  let harness = null;
  let wss = null;
  let bodyError = null;
  const cleanupErrors = [];

  function observeBus(name, payload) {
    if (name === 'ws:ready') {
      readyCount++;
      if (readyCount === 1) ready.resolve(payload);
      if (readyCount === 2) reconnectReady.resolve(payload);
    }
    if (name === 'ws:disconnected' && readyCount === 1) disconnected.resolve(payload);
    if (name === 'ws:reconnected' && readyCount === 2) {
      reconnectRestored.resolve(payload);
    }
    if (name !== 'chat:terminal') return;
    observedTerminals.push(payload);
    for (let index = terminalWaiters.length - 1; index >= 0; index--) {
      const waiter = terminalWaiters[index];
      if (!waiter.predicate(payload)) continue;
      terminalWaiters.splice(index, 1);
      waiter.resolve(payload);
    }
  }

  function waitForTerminal(predicate, label) {
    const existing = observedTerminals.find(predicate);
    if (existing) return Promise.resolve(existing);
    const pending = deferred();
    terminalWaiters.push({ predicate, resolve: pending.resolve });
    return within(pending.promise, label);
  }

  try {
    config.features.telemetry = false;
    wss = attachWebSocketServer(
      httpServer,
      {
        handle: async request => {
          controllerEffects++;
          if (request.conversationId === 'loopback-cancel-A') {
            targetStarted.resolve(request);
            return new Promise((_resolve, reject) => {
              request.signal.addEventListener(
                'abort',
                () => reject(request.signal.reason),
                { once: true },
              );
            });
          }
          if (request.conversationId === 'loopback-success-B') {
            request.context.onSystemStep('live-loopback', 'actual WebSocket progress', 1);
            return {
              response: 'Live negotiated Studio response',
              mode: 'conversation',
              confidence: 1,
              state: { source: 'owned-loopback' },
            };
          }
          if (request.conversationId === 'loopback-provider-C') {
            throw new LLMProviderUnavailableError('LLM_CALL_FAILED');
          }
          throw new Error(`Unexpected live conversation: ${request.conversationId}`);
        },
      },
      CROSS_BOUNDARY_LOGGER,
      {
        allowedOrigins: [],
        localCapability: capability,
        m1WireSupported: true,
        m1AttachmentPolicy: TEST_M1_ATTACHMENT_POLICY,
      },
    );
    await new Promise((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(0, '127.0.0.1', resolve);
    });
    const address = httpServer.address();
    assert.equal(typeof address, 'object');
    assert.ok(address && Number.isSafeInteger(address.port));

    const panes = [session(), session(), session()];
    harness = loadClient(panes, {
      autoHandshake: false,
      backendBase: `http://127.0.0.1:${address.port}`,
      clearTimeout,
      fetch: globalThis.fetch,
      localCapability: capability,
      onBusEmit: observeBus,
      setTimeout,
      WebSocketClass: NodeWebSocket,
    });
    assert.equal(harness.socket instanceof NodeWebSocket, true);
    await within(ready.promise, 'negotiated Studio hello');
    assert.equal(harness.client.wsIsM1WireNegotiated(), true);

    panes[0]._convId = 'loopback-cancel-A';
    panes[0]._agentId = 'agent-loopback-A';
    panes[1]._convId = 'loopback-success-B';
    panes[1]._agentId = 'agent-loopback-B';
    panes[1]._projectId = 'project-loopback-B';
    panes[2]._convId = 'loopback-provider-C';
    panes[2]._agentId = 'agent-loopback-C';

    assert.equal(harness.client.wsSendChat('Hold A', panes[0], 0), true);
    await within(targetStarted.promise, 'cancel target controller entry');

    const successPromise = waitForTerminal(
      payload => payload.action === 'send'
        && payload.conversationId === panes[1]._convId,
      'success terminal',
    );
    assert.equal(harness.client.wsSendChat('Complete B', panes[1], 1), true);
    const success = await successPromise;
    assert.equal(success.status, 'ok');
    assert.equal(success.renderAssistant, true);
    assert.equal(success.result.response.content, 'Live negotiated Studio response');

    const providerPromise = waitForTerminal(
      payload => payload.action === 'send'
        && payload.conversationId === panes[2]._convId,
      'provider terminal',
    );
    assert.equal(harness.client.wsSendChat('Fail C', panes[2], 2), true);
    const provider = await providerPromise;
    assert.equal(provider.status, 'error');
    assert.equal(provider.renderAssistant, false);
    assert.equal(provider.result.error.code, 'LLM_PROVIDER_UNAVAILABLE');
    assert.equal(provider.sessionIdx, 2);

    const targetTerminalPromise = waitForTerminal(
      payload => payload.action === 'send'
        && payload.conversationId === panes[0]._convId,
      'cancel target terminal',
    );
    const cancelTerminalPromise = waitForTerminal(
      payload => payload.action === 'cancel'
        && payload.conversationId === panes[0]._convId,
      'cancel command terminal',
    );
    assert.equal(harness.client.wsSendCancel(panes[0]), true);
    const [targetTerminal, cancelTerminal] = await Promise.all([
      targetTerminalPromise,
      cancelTerminalPromise,
    ]);
    assert.equal(targetTerminal.status, 'cancelled');
    assert.equal(cancelTerminal.status, 'cancelled');
    assert.equal(success.sessionIdx, 1);
    assert.equal(targetTerminal.sessionIdx, 0);
    assert.equal(cancelTerminal.sessionIdx, 0);
    assert.ok(
      observedTerminals.indexOf(targetTerminal) < observedTerminals.indexOf(cancelTerminal),
      'the target terminal must reach Studio before the cancel command terminal',
    );

    assert.equal(controllerEffects, 3);
    assert.equal(observedTerminals.length, 4);
    assert.deepEqual(
      observedTerminals.map(terminal => ({
        action: terminal.action,
        conversationId: terminal.conversationId,
        sessionIdx: terminal.sessionIdx,
        status: terminal.status,
      })),
      [
        {
          action: 'send',
          conversationId: 'loopback-success-B',
          sessionIdx: 1,
          status: 'ok',
        },
        {
          action: 'send',
          conversationId: 'loopback-provider-C',
          sessionIdx: 2,
          status: 'error',
        },
        {
          action: 'send',
          conversationId: 'loopback-cancel-A',
          sessionIdx: 0,
          status: 'cancelled',
        },
        {
          action: 'cancel',
          conversationId: 'loopback-cancel-A',
          sessionIdx: 0,
          status: 'cancelled',
        },
      ],
    );
    assert.equal(
      new Set(observedTerminals.map(terminal => terminal.requestId)).size,
      4,
    );
    assert.equal(
      new Set(observedTerminals.map(terminal => terminal.turnId)).size,
      4,
    );
    assert.equal(
      harness.busEvents.some(event => event.name === 'chat:message'),
      false,
    );
    assert.equal(
      harness.busEvents.some(event => event.name === 'chat:system'),
      false,
    );
    assert.equal(
      harness.busEvents
        .filter(event => event.name === 'agent:event')
        .every(event => event.payload.event.transport === 'm1'),
      true,
    );
    assert.equal(
      harness.busEvents.some(event => (
        event.name === 'agent:event'
        && event.payload.event.type === 'system_step'
        && event.payload.event.transport === 'm1'
        && event.payload.event.conversationId === panes[1]._convId
      )),
      true,
    );

    durableDb = new Database(process.env.C3_DB_PATH);
    durableDb.exec('CREATE TABLE conversations (id TEXT PRIMARY KEY)');
    const insertConversation = durableDb.prepare('INSERT INTO conversations (id) VALUES (?)');
    for (const pane of panes) insertConversation.run(pane._convId);
    const findConversation = durableDb.prepare('SELECT id FROM conversations WHERE id = ?');
    resetConversationStore();
    getConversationStore({
      db: durableDb,
      conversations: {
        findById: {
          get(conversationId) {
            durableLookups.push(conversationId);
            return findConversation.get(conversationId);
          },
        },
      },
    });

    const firstSocket = harness.socket;
    const firstServerSocket = [...wss.clients][0];
    assert.ok(firstServerSocket, 'owned loopback server has no connected Studio client');
    firstServerSocket.terminate();
    await within(disconnected.promise, 'first owned-loopback disconnect');
    assert.equal(
      harness.client.wsIsM1WireNegotiated(),
      false,
      'a replacement connection inherited the prior M1 negotiation latch',
    );
    await within(reconnectReady.promise, 'bounded automatic Studio reconnect', 5_000);
    assert.equal(harness.sockets.length, 2);
    assert.notEqual(harness.sockets[1], firstSocket);
    assert.equal(harness.client.wsIsM1WireNegotiated(), true);

    const restored = await within(
      reconnectRestored.promise,
      'durable reconnect history restore',
    );
    assert.deepEqual(hostClone(restored), {
      status: 'ok',
      restoredCount: 3,
      invalidCount: 0,
      failedCount: 0,
    });
    assert.deepEqual(
      [...durableLookups].sort(),
      panes.map(pane => pane._convId).sort(),
      'rehydrate ACK did not consult durable authority exactly once per pane',
    );
    assert.deepEqual(
      [...historyRequests].sort(),
      panes.map(pane => pane._convId).sort(),
    );
    for (const pane of panes) {
      assert.equal(pane.chat.msgs.length, 1);
      assert.equal(pane.chat.msgs[0].text, `restored:${pane._convId}`);
    }

    const postReconnectTerminal = waitForTerminal(
      payload => payload.action === 'send'
        && payload.conversationId === panes[1]._convId
        && payload.requestId !== success.requestId,
      'post-reconnect success terminal',
    );
    assert.equal(harness.client.wsSendChat('Complete B after reconnect', panes[1], 1), true);
    const postReconnect = await postReconnectTerminal;
    assert.equal(postReconnect.status, 'ok');
    assert.equal(postReconnect.sessionIdx, 1);
    assert.equal(postReconnect.renderAssistant, true);
    assert.equal(controllerEffects, 4);
    assert.equal(observedTerminals.length, 5);
  } catch (error) {
    bodyError = error;
  } finally {
    config.features.telemetry = telemetryBefore;
    const cleanupSteps = [
      ['Studio WebSocket client', async () => {
        if (!harness) return;
        const liveSockets = harness.sockets.filter(socket => (
          socket.readyState !== NodeWebSocket.CLOSED
        ));
        const socketClosed = Promise.all(liveSockets.map(socket => (
          new Promise(resolve => socket.once('close', resolve))
        )));
        let gracefulError = null;
        try {
          harness.client.wsDestroy();
          await within(socketClosed, 'owned loopback client close', 1_000);
        } catch (error) {
          gracefulError = error;
          for (const socket of liveSockets) {
            try { socket.terminate(); } catch (terminateError) {
              cleanupErrors.push(new Error('Studio WebSocket terminate failed', {
                cause: terminateError,
              }));
            }
          }
          try {
            await within(socketClosed, 'forced owned loopback client close', 1_000);
          } catch (forcedError) {
            cleanupErrors.push(forcedError);
          }
        }
        if (gracefulError) throw gracefulError;
      }],
      ['WebSocket server', async () => {
        if (!wss) return;
        const closed = new Promise((resolve, reject) => {
          try {
            wss.close(error => (error ? reject(error) : resolve()));
          } catch (error) {
            reject(error);
          }
        });
        try {
          await within(closed, 'owned loopback WebSocket server close', 1_000);
        } catch (error) {
          for (const client of wss.clients) {
            try { client.terminate(); } catch {}
          }
          try {
            await within(closed, 'forced owned loopback WebSocket server close', 1_000);
          } catch (forcedError) {
            cleanupErrors.push(forcedError);
          }
          throw error;
        }
      }],
      ['durable reconnect store', async () => {
        resetConversationStore();
        if (durableDb?.open) durableDb.close();
      }],
      ['HTTP server', async () => {
        if (!httpServer.listening) return;
        const closed = new Promise((resolve, reject) => {
          httpServer.close(error => (error ? reject(error) : resolve()));
        });
        try {
          await within(closed, 'owned loopback HTTP server close', 1_000);
        } catch (error) {
          httpServer.closeAllConnections?.();
          try {
            await within(closed, 'forced owned loopback HTTP server close', 1_000);
          } catch (forcedError) {
            cleanupErrors.push(forcedError);
          }
          throw error;
        }
      }],
    ];
    for (const [label, cleanup] of cleanupSteps) {
      try {
        await cleanup();
      } catch (error) {
        cleanupErrors.push(new Error(`${label} cleanup failed`, { cause: error }));
      }
    }
  }

  if (bodyError && cleanupErrors.length > 0) {
    throw new AggregateError(
      [bodyError, ...cleanupErrors],
      'Owned loopback body and cleanup both failed',
    );
  }
  if (bodyError) throw bodyError;
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'Owned loopback cleanup failed');
  }
}, 15_000);

suite('M1 Studio client — conversation-scoped transport');

test('first send assigns and publishes one stable conversation identity', () => {
  const pane = session();
  const { busEvents, client, socket } = loadClient([pane]);

  assert.equal(client.wsSendChat('hello', pane, 0), true);
  assert.equal(
    pane._convId,
    'studio-11111111-2222-4333-8444-555555555555',
  );
  assert.deepEqual(socket.sent.at(-1), {
    channel: 'chat',
    data: {
      content: 'hello',
      conversationId: pane._convId,
      editMode: 'ask',
      agentId: null,
      projectId: null,
    },
  });
  const identityEvent = busEvents.find(event => event.name === 'session:identity');
  assert.equal(identityEvent.name, 'session:identity');
  assert.equal(identityEvent.payload.idx, 0);
  assert.equal(identityEvent.payload.conversationId, pane._convId);

  assert.equal(client.wsSendChat('again', pane, 0), true);
  assert.equal(socket.sent.at(-1).data.conversationId, pane._convId);
  assert.equal(
    busEvents.filter(event => event.name === 'session:identity').length,
    1,
  );
});

test('failed first send cannot publish a phantom identity or lose NOT_SENT state on reconnect', () => {
  const pane = session();
  pane.chat.msgs = [{ role: 'user', text: 'draft', tag: 'NOT_SENT' }];
  const { busEvents, client, handshake, socket, sockets } = loadClient([pane]);

  /* Preserve the readiness latch while reproducing the ready-to-closed race. */
  socket.readyState = 3;
  assert.equal(client.wsIsReady(), true);
  assert.equal(client.wsSendChat('draft', pane, 0), false);
  assert.equal(pane._convId, null);
  assert.equal(
    busEvents.filter(event => event.name === 'session:identity').length,
    0,
  );

  client.wsConnect();
  const reconnected = sockets[1];
  handshake(reconnected);
  assert.equal(
    reconnected.sent.some(message => (
      message.channel === 'control'
      && message.data.action === 'rehydrate'
    )),
    false,
  );
  sendServerMessage(reconnected, {
    channel: 'control',
    data: { action: 'rehydrate_ack', validIds: [] },
  });
  assert.equal(pane._convId, null);
  assert.equal(pane.chat.msgs[0].text, 'draft');
  assert.equal(pane.chat.msgs[0].tag, 'NOT_SENT');
  assert.equal(busEvents.some(event => event.name === 'session:invalidated'), false);
});

test('synchronous WebSocket send failure leaves a fresh identity unpublished', () => {
  const pane = session();
  const { busEvents, client, socket } = loadClient([pane]);
  socket.send = () => { throw new Error('synthetic socket send failure'); };

  assert.throws(
    () => client.wsSendChat('draft', pane, 0),
    /synthetic socket send failure/,
  );
  assert.equal(pane._convId, null);
  assert.equal(
    busEvents.filter(event => event.name === 'session:identity').length,
    0,
  );
});

test('cancel always carries the selected pane conversationId', () => {
  const paneA = session('studio-conversation-A');
  const paneB = session('studio-conversation-B');
  const { client, socket } = loadClient([paneA, paneB]);

  assert.equal(client.wsSendChat('A', paneA, 0), true);
  assert.equal(client.wsSendChat('B', paneB, 1), true);
  assert.equal(client.wsSendCancel(paneA), true);
  assert.deepEqual(socket.sent.at(-1), {
    channel: 'control',
    data: { action: 'cancel', conversationId: 'studio-conversation-A' },
  });
  assert.equal(
    socket.sent.some(message => (
      message.channel === 'control'
      && message.data.action === 'cancel'
      && !message.data.conversationId
    )),
    false,
  );
});

test('missing or malformed target cannot fall back to cancel-all', () => {
  const { client, socket } = loadClient([session()]);
  const before = socket.sent.length;

  assert.equal(client.wsSendCancel(session()), false);
  assert.equal(client.wsSendCancel(session('not a valid id')), false);
  assert.equal(socket.sent.length, before);
});

test('authoritative panel passes the selected session into cancel', () => {
  const source = fs.readFileSync(CHAT_PANEL, 'utf8');
  const cancelStart = source.indexOf('function _cancelExecution(idx)');
  const cancelEnd = source.indexOf('/* split mode:', cancelStart);
  assert.ok(cancelStart >= 0 && cancelEnd > cancelStart);
  const cancelSource = source.slice(cancelStart, cancelEnd);
  assert.match(cancelSource, /C3WS\.sendCancel\(s\)/);
  assert.match(source, /_chatCancelPreparedSend\(_sessionActive,activeSession\)/);
  assert.match(source, /C3WS\.sendCancel\(activeSession\)/);
  assert.doesNotMatch(source, /C3WS\.sendCancel\(\s*\)/);
});

suite('M1 Studio client — fail-closed send authority');

test('all three send call sites use one WebSocket-only seam and expose NOT_SENT', () => {
  const source = fs.readFileSync(CHAT_PANEL, 'utf8');
  const start = source.indexOf('function _chatSendPane');
  const end = source.indexOf('function _chatPaneUI', start);
  assert.ok(start >= 0 && end > start);
  const sendSource = source.slice(start, end);

  assert.equal((sendSource.match(/_chatTryWsSend\(/g) || []).length, 3);
  assert.doesNotMatch(sendSource, /fetch\s*\(/);
  assert.doesNotMatch(sendSource, /C3WS\.(?:isReady|sendChat)/);
  assert.match(source, /_chatGapChoice\(idx,'create',i\)/);
  assert.match(source, /_chatGapChoice\(idx,'fallback',i\)/);
  assert.match(source, /NOT_SENT · Zpráva nebyla odeslána/);
});

await testAsync('normal and edited sends fail closed for every transport failure and effect-capable prompt', async () => {
  const failureModes = [
    ['unavailable', 'WS_UNAVAILABLE', 0],
    ['false', 'WS_SEND_REJECTED', 1],
    ['throw', 'WS_SEND_FAILED', 1],
  ];
  const effectPrompts = [
    'Vytvoř soubor /owned/m1.txt s obsahem test',
    'Spusť příkaz touch /owned/m1-shell',
    'Použij nástroj pro změnu projektu',
  ];

  for (const [mode, reason, expectedWsCalls] of failureModes) {
    for (const prompt of effectPrompts) {
      const normal = panelSendHarness({ mode, input: prompt });
      const attachment = {
        file: { path: '/owned/evidence.bin', size: 128 },
        name: 'evidence.bin',
        size: '1 KB',
      };
      normal.pane.chat.attachments.push(attachment);
      normal.functions._chatSendPane(0);
      await drainMicrotasks();

      assert.equal(normal.counters.wsSend.length, expectedWsCalls);
      assert.equal(normal.pane.chat._thinking, null);
      assert.equal(normal.pane.chat._pendingAttachments, null);
      assert.equal(normal.pane.chat._delivery.status, 'NOT_SENT');
      assert.equal(normal.pane.chat._delivery.retryable, true);
      assert.equal(normal.pane.chat._delivery.reason, reason);
      assert.equal(normal.pane.chat.msgs.length, 1);
      assert.equal(normal.pane.chat.msgs[0].role, 'user');
      assert.equal(normal.pane.chat.msgs[0].tag, 'NOT_SENT');
      assert.equal(normal.pane.chat.msgs[0].retryable, true);
      assert.equal(normal.textarea.value, prompt);
      assert.equal(normal.pane.chat.attachments.length, 1);
      assert.equal(normal.pane.chat.attachments[0], attachment);
      assertNoFallbackEffects(normal);

      const edited = panelSendHarness({ mode, input: prompt });
      const originalTimeline = [
        { id: 'edit-user', role: 'user', text: 'původní dotaz' },
        { id: 'edit-assistant', role: 'assistant', text: 'původní odpověď' },
      ];
      edited.pane.chat.msgs = originalTimeline.map(message => ({ ...message }));
      edited.pane.chat.editingIdx = 0;
      edited.pane.chat.editOriginalText = 'původní dotaz';
      edited.functions._chatSendPane(0);
      await drainMicrotasks();

      assert.equal(edited.counters.wsSend.length, expectedWsCalls);
      assert.equal(JSON.stringify(edited.pane.chat.msgs), JSON.stringify(originalTimeline));
      assert.equal(edited.pane.chat.editingIdx, 0);
      assert.equal(edited.pane.chat.editOriginalText, 'původní dotaz');
      assert.equal(edited.textarea.value, prompt);
      assert.equal(edited.pane.chat._thinking, null);
      assert.equal(edited.pane.chat._delivery.status, 'NOT_SENT');
      assert.equal(edited.pane.chat._delivery.reason, reason);
      assertNoFallbackEffects(edited, 1);
    }
  }
});

await testAsync('gap choice failures re-enable the exact choice and never create a fallback effect', async () => {
  const failureModes = [
    ['unavailable', 'WS_UNAVAILABLE', 0],
    ['false', 'WS_SEND_REJECTED', 1],
    ['throw', 'WS_SEND_FAILED', 1],
  ];

  for (const [mode, reason, expectedWsCalls] of failureModes) {
    for (const choice of ['create', 'fallback']) {
      const harness = panelSendHarness({ mode });
      harness.pane.chat.msgs = [{
        _gapChoice: true,
        _gapResolved: false,
        role: 'assistant',
        text: 'Vyberte další postup',
      }];
      harness.functions._chatGapChoice(0, choice, 0);
      await drainMicrotasks();

      assert.equal(harness.counters.wsSend.length, expectedWsCalls);
      assert.equal(harness.pane.chat.msgs[0]._gapResolved, false);
      assert.equal(harness.pane.chat.msgs.length, 2);
      assert.equal(harness.pane.chat.msgs[1].role, 'user');
      assert.equal(harness.pane.chat.msgs[1].tag, 'NOT_SENT');
      assert.equal(harness.pane.chat.msgs[1].retryable, true);
      assert.equal(harness.pane.chat._thinking, null);
      assert.equal(harness.pane.chat._delivery.status, 'NOT_SENT');
      assert.equal(harness.pane.chat._delivery.reason, reason);
      assertNoFallbackEffects(harness, 1);
    }
  }
});

test('busy gap choices remain visible and create no user or wire effect', () => {
  for (const mode of ['active-turn', 'prepared-send']) {
    const harness = panelSendHarness({ mode: 'ready' });
    harness.pane.chat.msgs = [{
      _gapChoice: true,
      _gapResolved: false,
      role: 'assistant',
      text: 'Vyberte další postup',
    }];
    if (mode === 'active-turn') {
      harness.context.C3WS.hasActiveM1Turn = () => true;
    } else {
      harness.pane.chat._preparedSend = { owned: true };
    }

    assert.equal(harness.functions._chatGapChoice(0, 'create', 0), false);
    assert.equal(harness.pane.chat.msgs[0]._gapResolved, false);
    assert.equal(harness.pane.chat.msgs.length, 1);
    assert.equal(harness.counters.wsSend.length, 0);
    assert.equal(harness.counters.timers.length, 0);
    assert.equal(harness.pane.chat._delivery.status, 'BUSY');
    assert.equal(harness.pane.chat._delivery.retryable, true);
    assert.equal(
      harness.pane.chat._delivery.reason,
      mode === 'active-turn' ? 'CONVERSATION_BUSY' : 'SEND_PREPARING',
    );
    assertNoFallbackEffects(harness, 1);
  }
});

await testAsync('failed async attachment send preserves exact original and newer draft independently', async () => {
  const { ControlledFileReader, readers } = controlledFileReaderClass();
  const rawDraft = '  původní text  \n';
  const exact = panelSendHarness({ input: rawDraft, mode: 'unavailable' });
  exact.functions._chatSendPane(0);
  await drainMicrotasks();
  assert.equal(exact.textarea.value, rawDraft);
  assert.equal(exact.pane.chat._delivery.draft, rawDraft);
  assertNoFallbackEffects(exact);

  const harness = panelSendHarness({
    FileReaderClass: ControlledFileReader,
    input: rawDraft,
    mode: 'unavailable',
  });
  const attachment = {
    file: { path: '/owned/evidence.txt', size: 128 },
    name: 'evidence.txt',
    size: '1 KB',
  };
  harness.pane.chat.attachments.push(attachment);
  harness.functions._chatSendPane(0);
  assert.equal(readers.length, 1);
  assert.equal(harness.counters.wsSend.length, 0);

  harness.textarea.value = 'novější rozepsaná zpráva';
  readers[0].result = 'attachment contents';
  readers[0].onload();
  await drainMicrotasks();

  assert.equal(harness.textarea.value, 'novější rozepsaná zpráva');
  assert.equal(harness.pane.chat._delivery.status, 'NOT_SENT');
  assert.equal(harness.pane.chat._delivery.draft, rawDraft);
  assert.equal(harness.pane.chat.msgs[0].tag, 'NOT_SENT');
  assert.equal(harness.pane.chat.attachments.length, 1);
  assert.equal(harness.pane.chat.attachments[0], attachment);
  assertNoFallbackEffects(harness);
});

await testAsync('M1 attachment preparation uses gesture bytes and surfaces nonretryable NOT_SENT', async () => {
  {
    const { ControlledFileReader, readers } = controlledFileReaderClass();
    const harness = panelSendHarness({
      FileReaderClass: ControlledFileReader,
      input: 'inline bytes',
      m1Negotiated: true,
      mode: 'ready',
    });
    harness.pane.chat.attachments.push({
      file: { path: '/must/not-cross.txt', size: 128 },
      name: 'inline.txt',
      size: '1 KB',
    });
    harness.functions._chatSendPane(0);
    await finishControlledReader(readers[0]);

    assert.equal(harness.counters.wsSend.length, 1);
    assert.deepEqual(harness.counters.wsSend[0].pendingAttachments, [{
      content: 'attachment contents',
      name: 'inline.txt',
      path: null,
      size: '1 KB',
      type: 'text',
    }]);
    assert.equal(harness.pane.chat._delivery, null);
    assert.equal(harness.textarea.value, '');
    assert.equal(harness.counters.fetch, 0);
    assert.equal(harness.counters.filesystem, 0);
    assert.equal(harness.counters.provider, 0);
    assert.equal(harness.counters.shell, 0);
    assert.equal(harness.counters.tool, 0);
    assert.deepEqual(harness.counters.timers.map(timer => timer.delay), [2000]);
  }

  {
    const { ControlledFileReader, readers } = controlledFileReaderClass();
    const attachment = {
      file: { path: '/must/not-fallback.txt', size: 128 },
      name: 'unreadable.txt',
      size: '1 KB',
    };
    const harness = panelSendHarness({
      FileReaderClass: ControlledFileReader,
      input: 'keep exact draft',
      localRejection: {
        status: 'NOT_SENT',
        retryable: false,
        reason: 'M1_ATTACHMENT_CONTENT_UNAVAILABLE',
        serverAcknowledged: false,
      },
      m1Negotiated: true,
      mode: 'local-reject',
    });
    harness.pane.chat.attachments.push(attachment);
    harness.functions._chatSendPane(0);
    await finishControlledReader(readers[0], 'error');

    assert.equal(harness.counters.wsSend.length, 1);
    assert.equal(harness.counters.wsSend[0].pendingAttachments[0].path, null);
    assert.equal(harness.pane.chat._delivery.status, 'NOT_SENT');
    assert.equal(harness.pane.chat._delivery.retryable, false);
    assert.equal(
      harness.pane.chat._delivery.reason,
      'M1_ATTACHMENT_CONTENT_UNAVAILABLE',
    );
    assert.equal(harness.pane.chat.msgs[0].retryable, false);
    assert.equal(harness.pane.chat.msgs[0].deliveryReason, 'M1_ATTACHMENT_CONTENT_UNAVAILABLE');
    assert.equal(harness.textarea.value, 'keep exact draft');
    assert.equal(harness.pane.chat.attachments[0], attachment);
    assertNoFallbackEffects(harness);
  }

  {
    const attachment = {
      file: { path: '/renamed-valid.data', size: 16 },
      name: 'renamed-valid.data',
      size: '16 B',
    };
    const harness = panelSendHarness({
      input: 'reject unknown extension',
      localRejection: {
        status: 'NOT_SENT',
        retryable: false,
        reason: 'M1_ATTACHMENT_TYPE_UNSUPPORTED',
        serverAcknowledged: false,
      },
      m1Negotiated: true,
      mode: 'local-reject',
    });
    harness.pane.chat.attachments.push(attachment);
    harness.functions._chatSendPane(0);

    assert.equal(harness.counters.wsSend.length, 1);
    assert.deepEqual(harness.counters.wsSend[0].pendingAttachments, [{
      content: null,
      name: 'renamed-valid.data',
      path: null,
      size: '16 B',
      type: 'binary',
    }]);
    assert.equal(harness.pane.chat._delivery.retryable, false);
    assert.equal(
      harness.pane.chat._delivery.reason,
      'M1_ATTACHMENT_TYPE_UNSUPPORTED',
    );
    assert.equal(harness.pane.chat.attachments[0], attachment);
    assertNoFallbackEffects(harness);
  }

  {
    const { ControlledFileReader, readers } = controlledFileReaderClass();
    const attachment = {
      file: { path: '/renamed-binary.txt', size: 4 },
      name: 'renamed-binary.txt',
      size: '4 B',
    };
    const harness = panelSendHarness({
      FileReaderClass: ControlledFileReader,
      input: 'reject binary bytes',
      localRejection: {
        status: 'NOT_SENT',
        retryable: false,
        reason: 'M1_ATTACHMENT_CONTENT_UNAVAILABLE',
        serverAcknowledged: false,
      },
      m1Negotiated: true,
      mode: 'local-reject',
    });
    harness.pane.chat.attachments.push(attachment);
    harness.functions._chatSendPane(0);
    readers[0].result = new Uint8Array([0, 1, 2, 255]).buffer;
    readers[0].onload();
    await drainMicrotasks();

    assert.equal(harness.counters.wsSend.length, 1);
    assert.equal(harness.counters.wsSend[0].pendingAttachments[0].content, null);
    assert.equal(harness.counters.wsSend[0].pendingAttachments[0].path, null);
    assert.equal(harness.pane.chat._delivery.retryable, false);
    assert.equal(
      harness.pane.chat._delivery.reason,
      'M1_ATTACHMENT_CONTENT_UNAVAILABLE',
    );
    assert.equal(harness.pane.chat.attachments[0], attachment);
    assertNoFallbackEffects(harness);
  }

  const source = fs.readFileSync(CHAT_PANEL, 'utf8');
  assert.match(source, /st\._delivery\.retryable===false/);
  assert.match(source, /C3WS\.isM1WireNegotiated\(\)===true/);
  assert.match(source, /Never turn an Electron filesystem path into wire authority/);
});

await testAsync('stale attachment callbacks cannot cross reset, replacement, or identity boundaries', async () => {
  const beginPendingSend = () => {
    const { ControlledFileReader, readers } = controlledFileReaderClass();
    const harness = panelSendHarness({
      FileReaderClass: ControlledFileReader,
      input: 'Vytvoř soubor /owned/stale.txt',
      mode: 'ready',
    });
    harness.pane.chat.attachments.push({
      file: { path: '/owned/evidence.txt', size: 128 },
      name: 'evidence.txt',
      size: '1 KB',
    });
    harness.functions._chatSendPane(0);
    assert.equal(readers.length, 1);
    return { harness, reader: readers[0] };
  };
  const finishRead = async reader => {
    reader.result = 'attachment contents';
    reader.onload();
    await drainMicrotasks();
  };

  const resetCase = beginPendingSend();
  const source = fs.readFileSync(CHAT_PANEL, 'utf8');
  const resetStart = source.indexOf('function _resetSessionToClean');
  const resetEnd = source.indexOf('function _newChatInProject', resetStart);
  vm.runInContext(source.slice(resetStart, resetEnd), resetCase.harness.context);
  resetCase.harness.context._resetSessionToClean(resetCase.harness.pane);
  await finishRead(resetCase.reader);
  assert.equal(resetCase.harness.counters.wsSend.length, 0);
  assert.equal(resetCase.harness.pane.chat.msgs.length, 1);
  assert.equal(resetCase.harness.pane.chat.msgs[0].text, 'Nový chat.');
  assert.equal(resetCase.harness.pane.chat._thinking, null);
  assert.equal(resetCase.harness.pane.chat._delivery, null);
  assertNoFallbackEffects(resetCase.harness);

  const replacementCase = beginPendingSend();
  const replacement = {
    _agentId: null,
    _convId: null,
    _projectId: null,
    chat: { msgs: [{ role: 'system', text: 'replacement' }] },
  };
  replacementCase.harness.context._sessions[0] = replacement;
  await finishRead(replacementCase.reader);
  assert.equal(replacementCase.harness.counters.wsSend.length, 0);
  assert.equal(replacement.chat.msgs.length, 1);
  assert.equal(replacement.chat.msgs[0].text, 'replacement');
  assertNoFallbackEffects(replacementCase.harness);

  const identityCase = beginPendingSend();
  identityCase.harness.pane._projectId = 'new-project';
  identityCase.harness.pane.chat.msgs = [{ role: 'system', text: 'new project' }];
  await finishRead(identityCase.reader);
  assert.equal(identityCase.harness.counters.wsSend.length, 0);
  assert.equal(identityCase.harness.pane.chat.msgs.length, 1);
  assert.equal(identityCase.harness.pane.chat.msgs[0].text, 'new project');
  assertNoFallbackEffects(identityCase.harness);

  const transportCase = beginPendingSend();
  transportCase.harness.context.C3WS.connectionEpoch = () => 2;
  await finishRead(transportCase.reader);
  assert.equal(transportCase.harness.counters.wsSend.length, 0);
  assert.equal(transportCase.harness.pane.chat._delivery.status, 'NOT_SENT');
  assert.equal(
    transportCase.harness.pane.chat._delivery.reason,
    'CONTEXT_CHANGED_BEFORE_SEND',
  );
  assert.equal(transportCase.harness.pane.chat.attachments.length, 1);
  assertNoFallbackEffects(transportCase.harness);

  const multiReader = controlledFileReaderClass();
  const multi = panelSendHarness({
    FileReaderClass: multiReader.ControlledFileReader,
    input: 'two attachments',
    mode: 'ready',
  });
  multi.pane.chat.attachments.push(
    { file: { size: 1 }, name: 'first.txt', size: '1 B' },
    { file: { size: 1 }, name: 'second.txt', size: '1 B' },
  );
  multi.functions._chatSendPane(0);
  assert.equal(multiReader.readers.length, 2);
  await finishControlledReader(multiReader.readers[0]);
  multi.functions._chatInvalidatePreparedSends(multi.pane.chat);
  await finishControlledReader(multiReader.readers[1]);
  assert.equal(multi.counters.wsSend.length, 0);
  assertNoFallbackEffects(multi);
});

await testAsync('attachment preparation is single-flight and gap choices cannot overtake it', async () => {
  const { ControlledFileReader, readers } = controlledFileReaderClass();
  const harness = panelSendHarness({
    FileReaderClass: ControlledFileReader,
    input: 'old draft',
    mode: 'ready',
  });
  harness.pane.chat.msgs.push({
    _gapChoice: true,
    _gapResolved: false,
    role: 'assistant',
    text: 'choose',
  });
  harness.pane.chat.attachments.push({
    file: { path: '/owned/old.txt', size: 128 },
    name: 'old.txt',
    size: '1 KB',
  });
  harness.functions._chatSendPane(0);
  assert.equal(readers.length, 1);
  assert.equal(harness.pane.chat.msgs.length, 2);

  harness.textarea.value = 'new draft';
  harness.functions._chatSendPane(0);
  harness.functions._chatGapChoice(0, 'create', 0);
  assert.equal(readers.length, 1);
  assert.equal(harness.pane.chat.msgs.length, 2);
  assert.equal(harness.textarea.value, 'new draft');
  assert.equal(harness.pane.chat.msgs[0]._gapResolved, false);

  await finishControlledReader(readers[0]);
  assert.equal(harness.counters.wsSend.length, 1);
  assert.equal(harness.counters.wsSend[0].content, 'old draft\n📎 old.txt');
  assert.equal(harness.textarea.value, 'new draft');
  assert.equal(harness.pane.chat._preparedSend, null);
});

await testAsync('pre-wire cancel restores owned input and makes late reader completion inert', async () => {
  for (const outcome of ['load', 'error']) {
    const { ControlledFileReader, readers } = controlledFileReaderClass();
    const harness = panelSendHarness({
      FileReaderClass: ControlledFileReader,
      input: 'original draft',
      mode: 'ready',
    });
    const originalAttachment = {
      file: { path: '/owned/original.txt', size: 128 },
      name: 'original.txt',
      size: '1 KB',
    };
    const newerAttachment = {
      file: { path: '/owned/newer.txt', size: 128 },
      name: 'newer.txt',
      size: '1 KB',
    };
    harness.pane.chat.attachments.push(originalAttachment);
    harness.functions._chatSendPane(0);
    harness.textarea.value = 'newer draft';
    harness.pane.chat.attachments.push(newerAttachment);

    if (outcome === 'load') {
      const source = fs.readFileSync(CHAT_PANEL, 'utf8');
      const cancelStart = source.indexOf('function _cancelExecution');
      const cancelEnd = source.indexOf('/* split mode:', cancelStart);
      harness.pane.log = [];
      harness.context.C3Terminal = { cancel() {} };
      vm.runInContext(source.slice(cancelStart, cancelEnd), harness.context);
      harness.context._cancelExecution(0);
    } else {
      assert.equal(harness.functions._chatCancelPreparedSend(0, harness.pane), true);
    }
    assert.equal(harness.counters.wsSend.length, 0);
    assert.equal(harness.counters.remoteCancel || 0, 0);
    assert.equal(harness.textarea.value, 'newer draft');
    assert.equal(
      harness.pane.chat.attachments.map(item => item.name).join('|'),
      'original.txt|newer.txt',
    );
    assert.equal(harness.pane.chat.msgs[0].tag, 'NOT_SENT');
    assert.equal(harness.pane.chat.msgs[0].deliveryReason, 'CANCELLED_BEFORE_SEND');
    assert.equal(harness.pane.chat.msgs[0].retryable, true);
    assert.equal(harness.pane.chat._thinking, null);
    assert.equal(harness.pane.chat._delivery.reason, 'CANCELLED_BEFORE_SEND');

    await finishControlledReader(readers[0], outcome);
    assert.equal(harness.counters.wsSend.length, 0);
    assert.equal(harness.counters.remoteCancel || 0, 0);
  }
});

await testAsync('hidden panes, route drift, and focus switches cannot misroute a prepared send', async () => {
  const source = fs.readFileSync(CHAT_PANEL, 'utf8');
  const setCountStart = source.indexOf('function _setSessionCount');
  const setCountEnd = source.indexOf('/* ── Focus Mode', setCountStart);
  assert.ok(setCountStart >= 0 && setCountEnd > setCountStart);

  const hiddenReader = controlledFileReaderClass();
  const hidden = panelSendHarness({
    FileReaderClass: hiddenReader.ControlledFileReader,
    input: 'hidden send',
    mode: 'ready',
    sessionIndex: 2,
  });
  hidden.pane.chat.attachments.push({ file: { size: 1 }, name: 'hidden.txt', size: '1 B' });
  hidden.functions._chatSendPane(2);
  hidden.context._sessionCount = 2;
  await finishControlledReader(hiddenReader.readers[0]);
  assert.equal(hidden.counters.wsSend.length, 0);

  const shrinkReader = controlledFileReaderClass();
  const shrink = panelSendHarness({
    FileReaderClass: shrinkReader.ControlledFileReader,
    input: 'shrink send',
    mode: 'ready',
    sessionIndex: 2,
  });
  shrink.pane.chat.attachments.push({ file: { size: 1 }, name: 'shrink.txt', size: '1 B' });
  shrink.functions._chatSendPane(2);
  shrink.context._ensureSessions = () => {};
  vm.runInContext(source.slice(setCountStart, setCountEnd), shrink.context);
  shrink.context._setSessionCount(2);
  shrink.context._setSessionCount(3);
  await finishControlledReader(shrinkReader.readers[0]);
  assert.equal(shrink.counters.wsSend.length, 0);

  const driftReader = controlledFileReaderClass();
  const drift = panelSendHarness({
    FileReaderClass: driftReader.ControlledFileReader,
    input: 'route drift',
    mode: 'ready',
  });
  drift.pane.chat.attachments.push({ file: { size: 1 }, name: 'drift.txt', size: '1 B' });
  drift.functions._chatSendPane(0);
  const newerThinking = { text: 'newer operation' };
  drift.pane.chat._thinking = newerThinking;
  drift.pane.chat.editMode = 'auto';
  await finishControlledReader(driftReader.readers[0]);
  assert.equal(drift.counters.wsSend.length, 0);
  assert.equal(drift.pane.chat.msgs[0].tag, 'NOT_SENT');
  assert.equal(drift.pane.chat._delivery.reason, 'CONTEXT_CHANGED_BEFORE_SEND');
  assert.equal(drift.pane.chat._thinking, newerThinking);

  const appendReader = controlledFileReaderClass();
  const append = panelSendHarness({
    FileReaderClass: appendReader.ControlledFileReader,
    input: 'owned pending turn',
    mode: 'ready',
  });
  const appendAttachment = { file: { size: 1 }, name: 'append.txt', size: '1 B' };
  append.pane.chat.attachments.push(appendAttachment);
  append.functions._chatSendPane(0);
  append.pane.chat.msgs.push({ role: 'assistant', text: 'older turn completed' });
  await finishControlledReader(appendReader.readers[0]);
  assert.equal(append.counters.wsSend.length, 0);
  assert.equal(append.pane.chat.msgs.length, 2);
  assert.equal(append.pane.chat.msgs[0].tag, 'NOT_SENT');
  assert.equal(append.pane.chat.msgs[1].text, 'older turn completed');
  assert.equal(append.textarea.value, 'owned pending turn');
  assert.equal(append.pane.chat.attachments[0], appendAttachment);
  assert.equal(append.pane.chat._delivery.reason, 'CONTEXT_CHANGED_BEFORE_SEND');

  const focusReader = controlledFileReaderClass();
  const focus = panelSendHarness({
    FileReaderClass: focusReader.ControlledFileReader,
    input: 'focused send',
    mode: 'ready',
    sessionIndex: 1,
  });
  focus.pane._conversationFocus = true;
  focus.pane.chat.attachments.push({ file: { size: 1 }, name: 'focus.txt', size: '1 B' });
  focus.functions._chatSendPane(1);
  focus.context._sessionActive = 0;
  await finishControlledReader(focusReader.readers[0]);
  assert.equal(focus.counters.wsSend.length, 1);
  assert.equal(focus.counters.wsSend[0].index, 1);
  assert.deepEqual(focus.pane._focusFiles.map(item => item.name), ['focus.txt']);

  const closeReader = controlledFileReaderClass();
  const close = panelSendHarness({
    FileReaderClass: closeReader.ControlledFileReader,
    input: 'moved pane send',
    mode: 'ready',
    sessionIndex: 2,
  });
  close.pane.chat.attachments.push({ file: { size: 1 }, name: 'move.txt', size: '1 B' });
  close.functions._chatSendPane(2);
  close.context._sessions[0].log = [];
  close.context._sessions[0].term = [];
  close.context._sessions[2].log = [];
  close.context._sessions[2].term = [];
  close.context._closeDialog = { idx: 0 };
  close.context._perSessionTree = [null, null, null];
  close.context._wtRoot = '';
  close.context._wtRawTree = null;
  close.context.FILES = [];
  close.context.renderSidebar = () => {};
  close.context._ensureSessions = () => {};
  vm.runInContext(source.slice(setCountStart, setCountEnd), close.context);
  const closeStart = source.indexOf('function _closeDialogAction');
  const closeEnd = source.indexOf('var _chatContainer', closeStart);
  vm.runInContext(source.slice(closeStart, closeEnd), close.context);
  close.context._closeDialogAction('pane');
  assert.equal(close.context._sessions[0], close.pane);
  assert.equal(close.pane.chat.msgs[0].tag, 'NOT_SENT');
  await finishControlledReader(closeReader.readers[0]);
  assert.equal(close.counters.wsSend.length, 0);
});

test('all destructive session transitions invalidate prepared sends before reuse', () => {
  const source = fs.readFileSync(CHAT_PANEL, 'utf8');
  const smartStart = source.indexOf('function _smartRouteToRelay');
  const smartEnd = source.indexOf('/* v91: Open-target', smartStart);
  const showStart = source.indexOf('function _showOpenDialog');
  const showEnd = source.indexOf('function _openTargetDialogAction', showStart);
  const closeStart = source.indexOf('function _closeDialogAction');
  const closeEnd = source.indexOf('var _chatContainer', closeStart);
  const invalidStart = source.indexOf("C3Bus.on('session:invalidated'");
  const invalidEnd = source.indexOf('/* ── Health state', invalidStart);
  const escapeStart = source.indexOf("case 'Escape':");
  const escapeEnd = source.indexOf('/* Excluded:', escapeStart);
  const cancelStart = source.indexOf('function _cancelExecution');
  const cancelEnd = source.indexOf('/* split mode:', cancelStart);

  assert.equal(
    (source.slice(smartStart, smartEnd).match(/_chatPrepareRelayTarget/g) || []).length,
    3,
  );
  assert.match(source.slice(showStart, showEnd), /_chatPrepareRelayTarget\(_sessionActive\)/);
  assert.match(source.slice(closeStart, closeEnd), /_chatCancelPreparedSend\(lastIdx,last\)/);
  assert.match(source.slice(invalidStart, invalidEnd), /_chatInvalidatePreparedSends\(s\.chat\)/);
  assert.match(source.slice(escapeStart, escapeEnd), /if\(_chatCancelPreparedSend\(_sessionActive,activeSession\)\)/);
  assert.match(source.slice(cancelStart, cancelEnd), /if \(!localPreparedCancelled && typeof C3WS/);
  assert.match(source, /captured\.idx>=0&&captured\.idx<_sessionCount/);
  assert.match(source, /captured\.chat\.editMode===captured\.editMode/);
});

test('new and closed sessions cannot inherit a prior NOT_SENT banner', () => {
  const source = fs.readFileSync(CHAT_PANEL, 'utf8');
  const context = vm.createContext({ Date, module: { exports: {} } });
  const mkStart = source.indexOf('function _mkSession');
  const mkEnd = source.indexOf('var _sessions=', mkStart);
  const resetStart = source.indexOf('function _resetSessionToClean');
  const resetEnd = source.indexOf('function _newChatInProject', resetStart);
  const invalidateStart = source.indexOf('function _chatInvalidatePreparedSends');
  const invalidateEnd = source.indexOf('function _chatCaptureSendContext', invalidateStart);
  assert.ok(mkStart >= 0 && mkEnd > mkStart && resetStart >= 0 && resetEnd > resetStart);
  assert.ok(invalidateStart >= 0 && invalidateEnd > invalidateStart);
  vm.runInContext(
    source.slice(mkStart, mkEnd)
      + source.slice(resetStart, resetEnd)
      + source.slice(invalidateStart, invalidateEnd)
      + '\nmodule.exports={_mkSession,_resetSessionToClean};',
    context,
  );
  const clean = context.module.exports._mkSession();
  assert.equal(clean.chat._delivery, null);
  assert.ok(clean.chat._sendContextToken);
  assert.ok(clean.chat._sendTurnToken);
  clean.chat._delivery = { status: 'NOT_SENT' };
  context.module.exports._resetSessionToClean(clean);
  assert.equal(clean.chat._delivery, null);
  assert.match(source.slice(resetStart, resetEnd), /_chatInvalidatePreparedSends\(s&&s\.chat\)/);

  const newActionStart = source.indexOf('function _newChatDialogAction');
  const newActionEnd = source.indexOf('/* v70: Close-pane', newActionStart);
  const closeStart = source.indexOf('function _closeDialogAction');
  const closeEnd = source.indexOf('var _chatContainer', closeStart);
  assert.ok(newActionStart >= 0 && newActionEnd > newActionStart);
  assert.ok(closeStart >= 0 && closeEnd > closeStart);
  assert.equal(
    (source.slice(newActionStart, newActionEnd).match(/chat\._delivery=null/g) || []).length,
    2,
  );
  assert.match(
    source.slice(newActionStart, newActionEnd),
    /_chatInvalidatePreparedSends\(s\.chat\)/,
  );
  assert.equal(
    (source.slice(closeStart, closeEnd).match(/chat\._delivery=null/g) || []).length,
    2,
  );
  assert.match(
    source.slice(closeStart, closeEnd),
    /_chatInvalidatePreparedSends\(s\.chat\)/,
  );
  const openStart = source.indexOf('function _openTargetDialogAction');
  const openEnd = source.indexOf('/* v64.4: New-chat', openStart);
  assert.match(
    source.slice(openStart, openEnd),
    /_chatInvalidatePreparedSends\(_sessions\[idx\]&&_sessions\[idx\]\.chat\)/,
  );
});

test('ready WebSocket queues each call site once without claiming server acknowledgement', () => {
  const seam = panelSendHarness({ mode: 'ready' });
  const seamResult = seam.functions._chatTryWsSend('hello', seam.pane, 0);
  assert.deepEqual(
    JSON.parse(JSON.stringify(seamResult)),
    {
      reason: null,
      retryable: false,
      serverAcknowledged: false,
      status: 'QUEUED_WS',
    },
  );

  const normal = panelSendHarness({ mode: 'ready', input: 'hello' });
  normal.pane.chat.attachments.push({
    file: { path: '/owned/evidence.bin', size: 128 },
    name: 'evidence.bin',
    size: '1 KB',
  });
  normal.functions._chatSendPane(0);
  assert.equal(normal.counters.wsSend.length, 1);
  assert.equal(normal.counters.wsSend[0].content, 'hello\n📎 evidence.bin');
  assert.equal(normal.counters.wsSend[0].index, 0);
  assert.equal(normal.counters.wsSend[0].selectedPane, normal.pane);
  assert.deepEqual(normal.counters.wsSend[0].pendingAttachments, [{
    content: null,
    name: 'evidence.bin',
    path: '/owned/evidence.bin',
    size: '1 KB',
    type: 'binary',
  }]);
  assert.equal(normal.counters.fetch, 0);
  assert.equal(normal.textarea.value, '');
  assert.equal(normal.pane.chat.attachments.length, 0);
  assert.equal(normal.pane.chat._pendingAttachments, null);
  assert.equal(normal.pane.chat._delivery, null);
  assert.equal(normal.pane.chat._thinking.text, 'Zpracovávám...');
  assert.deepEqual(normal.counters.timers.map(timer => timer.delay), [2000]);

  const edited = panelSendHarness({ mode: 'ready', input: 'nová větev' });
  edited.pane.chat.msgs = [
    {
      deliveryStatus: 'NOT_SENT',
      retryable: true,
      role: 'user',
      tag: 'NOT_SENT',
      text: 'stará větev',
    },
    { role: 'assistant', text: 'stará odpověď' },
  ];
  edited.pane.chat.editingIdx = 0;
  edited.functions._chatSendPane(0);
  assert.equal(edited.counters.wsSend.length, 1);
  assert.equal(edited.counters.wsSend[0].content, 'nová větev');
  assert.equal(edited.counters.wsSend[0].index, 0);
  assert.equal(edited.counters.wsSend[0].selectedPane, edited.pane);
  assert.equal(edited.counters.fetch, 0);
  assert.equal(edited.pane.chat.msgs.length, 1);
  assert.equal(edited.pane.chat.msgs[0].text, 'nová větev');
  assert.equal(edited.pane.chat.msgs[0].tag, undefined);
  assert.equal(edited.pane.chat.msgs[0].deliveryStatus, undefined);
  assert.equal(edited.pane.chat.msgs[0].retryable, undefined);
  assert.equal(edited.pane.chat.editingIdx, null);
  assert.deepEqual(edited.counters.timers.map(timer => timer.delay), [2000]);

  const gap = panelSendHarness({ mode: 'ready' });
  gap.pane.chat.msgs = [{
    _gapChoice: true,
    _gapResolved: false,
    role: 'assistant',
    text: 'Vyberte další postup',
  }];
  gap.functions._chatGapChoice(0, 'create', 0);
  assert.equal(gap.counters.wsSend.length, 1);
  assert.equal(gap.counters.wsSend[0].content, 'Vytvoř expertízu');
  assert.equal(gap.counters.wsSend[0].index, 0);
  assert.equal(gap.counters.wsSend[0].selectedPane, gap.pane);
  assert.equal(gap.counters.fetch, 0);
  assert.equal(gap.pane.chat.msgs[0]._gapResolved, true);
  assert.equal(gap.pane.chat.msgs[1].text, 'Vytvoř expertízu');
  assert.equal(gap.pane.chat._delivery, null);
  assert.equal(gap.counters.timers.length, 0);
});

suite('M1 Studio client — acknowledged race-safe rehydrate');

await testAsync('history waits for ACK, authoritative empty history replaces data, and invalid pane is reset', async () => {
  const paneA = session('studio-rehydrate-A');
  const paneB = session('studio-rehydrate-B');
  paneB._projectId = 'project-kept';
  const fetchUrls = [];
  const { busEvents, socket } = loadClient([paneA, paneB], {
    fetch: async url => {
      fetchUrls.push(url);
      return { ok: true, status: 200, json: async () => ({ messages: [] }) };
    },
  });

  assert.equal(fetchUrls.length, 0, 'history fetch started before durable ACK');
  const request = lastRehydrateRequest(socket);
  assert.equal(request.action, 'rehydrate');
  assert.match(request.rehydrateRequestId, /^rehydrate-[A-Za-z0-9._:-]+$/);
  assert.deepEqual(
    Array.from(request.conversationIds),
    ['studio-rehydrate-A', 'studio-rehydrate-B'],
  );

  sendCompleteRehydrateAck(socket, {
    validIds: ['studio-rehydrate-A'],
    invalidIds: ['studio-rehydrate-B'],
  });
  await drainMicrotasks();

  assert.equal(fetchUrls.length, 1);
  assert.match(fetchUrls[0], /studio-rehydrate-A\/messages$/);
  assert.equal(paneA.chat.msgs.length, 0);
  assert.equal(paneA.chat._thinking, null);
  assert.equal(paneB._convId, null);
  assert.equal(paneB._agentId, null);
  assert.equal(paneB._label, '');
  assert.equal(paneB.chat.msgs.length, 0);
  assert.equal(paneB.chat._thinking, null);
  assert.equal(paneB._projectId, 'project-kept');

  const completion = busEvents.filter(event => event.name === 'ws:reconnected');
  assert.equal(
    JSON.stringify(completion.at(-1).payload),
    JSON.stringify({
      status: 'ok',
      restoredCount: 1,
      invalidCount: 1,
      failedCount: 0,
    }),
  );
  assert.equal(
    busEvents.filter(event => event.name === 'session:invalidated').length,
    1,
  );
});

await testAsync('prototype-named conversation identity is restored without map-key confusion', async () => {
  const pane = session('constructor');
  let fetchCount = 0;
  const { busEvents, socket } = loadClient([pane], {
    fetch: async () => {
      fetchCount++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          messages: [{ role: 'assistant', content: 'restored', metadata: null }],
        }),
      };
    },
  });

  sendCompleteRehydrateAck(socket, {
    validIds: ['constructor'],
    invalidIds: [],
  });
  await drainMicrotasks();

  assert.equal(fetchCount, 1);
  assert.equal(pane._convId, 'constructor');
  assert.equal(pane.chat.msgs[0].text, 'restored');
  assert.equal(
    JSON.stringify(busEvents.filter(event => event.name === 'ws:reconnected').at(-1).payload),
    JSON.stringify({ status: 'ok', restoredCount: 1, invalidCount: 0, failedCount: 0 }),
  );
});

await testAsync('request IDs are unique and a foreign ACK cannot end the current timer', async () => {
  const pane = session('studio-rehydrate-request-id');
  const clock = controlledTimers();
  let fetchCount = 0;
  const { busEvents, client, handshake, socket, sockets } = loadClient([pane], {
    clearTimeout: clock.clearTimeout,
    fetch: async () => {
      fetchCount++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          messages: [{ role: 'assistant', content: 'current run', metadata: null }],
        }),
      };
    },
    setTimeout: clock.setTimeout,
  });
  const firstRequest = lastRehydrateRequest(socket);
  const firstTimer = clock.active().find(timer => timer.delay === 5000);
  assert.ok(firstTimer);

  sendServerMessage(socket, {
    channel: 'control',
    data: {
      action: 'rehydrate_ack',
      complete: true,
      validIds: [pane._convId],
      invalidIds: [],
    },
  });
  sendServerMessage(socket, {
    channel: 'control',
    data: {
      action: 'rehydrate_ack',
      rehydrateRequestId: `${firstRequest.rehydrateRequestId}-foreign`,
      complete: true,
      validIds: [pane._convId],
      invalidIds: [],
    },
  });
  await drainMicrotasks();
  assert.equal(firstTimer.cleared, false);
  assert.equal(fetchCount, 0);
  assert.equal(busEvents.some(event => event.name === 'ws:reconnected'), false);

  sendCompleteRehydrateAck(socket, { validIds: [pane._convId], invalidIds: [] });
  await drainMicrotasks();
  assert.equal(firstTimer.cleared, true);
  assert.equal(fetchCount, 1);

  client.wsConnect();
  const secondSocket = sockets[1];
  handshake(secondSocket);
  const secondRequest = lastRehydrateRequest(secondSocket);
  assert.notEqual(secondRequest.rehydrateRequestId, firstRequest.rehydrateRequestId);
});

await testAsync('every matching incomplete or inconsistent ACK degrades without authority', async () => {
  const cases = [
    ['missing complete', data => { delete data.complete; }],
    ['missing invalid partition', data => { delete data.invalidIds; }],
    ['incomplete union', data => { data.validIds = []; }],
    ['overlapping partitions', data => { data.invalidIds = [...data.validIds]; }],
    ['duplicate identity', data => { data.validIds.push(data.validIds[0]); }],
    ['foreign identity', data => { data.validIds = ['studio-foreign']; }],
    ['unknown envelope key', data => { data.conversationId = 'studio-route-poison'; }],
  ];

  for (const [label, mutate] of cases) {
    const pane = session(`studio-malformed-${label.replaceAll(' ', '-')}`);
    let fetchCount = 0;
    const { busEvents, socket } = loadClient([pane], {
      fetch: async () => {
        fetchCount++;
        return { ok: true, status: 200, json: async () => ({ messages: [] }) };
      },
    });
    const request = lastRehydrateRequest(socket);
    const data = {
      action: 'rehydrate_ack',
      rehydrateRequestId: request.rehydrateRequestId,
      complete: true,
      validIds: [pane._convId],
      invalidIds: [],
    };
    mutate(data);
    sendServerMessage(socket, { channel: 'control', data });
    await drainMicrotasks();

    assert.equal(fetchCount, 0, `${label}: history effect`);
    assert.notEqual(pane._convId, null, `${label}: identity cleared`);
    assert.equal(pane.chat.msgs[0].text, 'stale', `${label}: timeline cleared`);
    assert.equal(
      busEvents.filter(event => event.name === 'ws:reconnected').at(-1)?.payload.status,
      'degraded',
      `${label}: missing degraded completion`,
    );
  }
});

await testAsync('only a matching exact typed reject ends the run immediately', async () => {
  const pane = session('studio-rehydrate-reject');
  const clock = controlledTimers();
  let fetchCount = 0;
  const { busEvents, socket } = loadClient([pane], {
    clearTimeout: clock.clearTimeout,
    fetch: async () => {
      fetchCount++;
      return { ok: true, status: 200, json: async () => ({ messages: [] }) };
    },
    setTimeout: clock.setTimeout,
  });
  const request = lastRehydrateRequest(socket);
  const ackTimer = clock.active().find(timer => timer.delay === 5000);

  sendServerMessage(socket, {
    channel: 'control',
    data: {
      action: 'rehydrate_reject',
      rehydrateRequestId: `${request.rehydrateRequestId}-foreign`,
      reason: 'TOO_MANY_CONVERSATIONS',
    },
  });
  sendServerMessage(socket, {
    channel: 'control',
    data: {
      action: 'rehydrate_reject',
      rehydrateRequestId: request.rehydrateRequestId,
      reason: 'UNKNOWN_REASON',
    },
  });
  assert.equal(ackTimer.cleared, false);
  assert.equal(busEvents.some(event => event.name === 'ws:reconnected'), false);

  sendServerMessage(socket, {
    channel: 'control',
    data: {
      action: 'rehydrate_reject',
      rehydrateRequestId: request.rehydrateRequestId,
      reason: 'TOO_MANY_CONVERSATIONS',
    },
  });
  await drainMicrotasks();

  assert.equal(ackTimer.cleared, true);
  assert.equal(fetchCount, 0);
  assert.equal(pane._convId, 'studio-rehydrate-reject');
  assert.equal(pane.chat.msgs[0].text, 'stale');
  assert.equal(
    JSON.stringify(busEvents.filter(event => event.name === 'ws:reconnected').at(-1).payload),
    JSON.stringify({ status: 'degraded', restoredCount: 0, invalidCount: 0, failedCount: 1 }),
  );
});

test('malformed local identity is preserved and quarantined without a wire effect', () => {
  const pane = session('malformed identity with spaces');
  const { busEvents, client, socket } = loadClient([pane]);

  assert.equal(
    socket.sent.some(message => message.data?.action === 'rehydrate'),
    false,
  );
  assert.equal(pane._convId, 'malformed identity with spaces');
  assert.equal(pane.chat.msgs[0].text, 'stale');
  assert.equal(pane._rehydrateState, 'quarantined');
  assert.equal(client.wsSendChat('must not leave quarantine', pane, 0), false);
  assert.equal(busEvents.filter(event => event.name === 'session:quarantined').length, 1);
  assert.equal(
    JSON.stringify(busEvents.filter(event => event.name === 'ws:reconnected').at(-1).payload),
    JSON.stringify({ status: 'degraded', restoredCount: 0, invalidCount: 0, failedCount: 1 }),
  );
});

test('client refuses an over-limit rehydrate set before sending it', () => {
  const panes = Array.from({ length: 33 }, (_, index) => session(`studio-limit-${index}`));
  const { busEvents, socket } = loadClient(panes);

  assert.equal(
    socket.sent.some(message => message.data?.action === 'rehydrate'),
    false,
  );
  assert.equal(
    JSON.stringify(busEvents.filter(event => event.name === 'ws:reconnected').at(-1).payload),
    JSON.stringify({ status: 'degraded', restoredCount: 0, invalidCount: 0, failedCount: 33 }),
  );
  assert.equal(panes.every(pane => pane._convId !== null), true);
});

await testAsync('malformed or unsolicited ACK preserves every local snapshot', async () => {
  const pane = session('studio-rehydrate-safe');
  let fetchCount = 0;
  const { busEvents, socket } = loadClient([pane], {
    fetch: async () => {
      fetchCount++;
      return { ok: true, status: 200, json: async () => ({ messages: [] }) };
    },
  });

  sendCompleteRehydrateAck(socket, {
    validIds: ['studio-unsolicited'],
    invalidIds: [],
  });
  await drainMicrotasks();

  assert.equal(fetchCount, 0);
  assert.equal(pane._convId, 'studio-rehydrate-safe');
  assert.equal(pane.chat.msgs[0].text, 'stale');
  assert.equal(
    JSON.stringify(busEvents.filter(event => event.name === 'ws:reconnected').at(-1).payload),
    JSON.stringify({ status: 'degraded', restoredCount: 0, invalidCount: 0, failedCount: 1 }),
  );
});

await testAsync('non-2xx history preserves snapshot and reports degraded completion', async () => {
  const pane = session('studio-rehydrate-http-failure');
  const { busEvents, socket } = loadClient([pane], {
    fetch: async () => ({
      ok: false,
      status: 503,
      json: async () => ({ messages: [] }),
    }),
  });

  sendCompleteRehydrateAck(socket, {
    validIds: [pane._convId],
    invalidIds: [],
  });
  await drainMicrotasks();

  assert.equal(pane._convId, 'studio-rehydrate-http-failure');
  assert.equal(pane.chat.msgs[0].text, 'stale');
  assert.equal(
    JSON.stringify(busEvents.filter(event => event.name === 'ws:reconnected').at(-1).payload),
    JSON.stringify({ status: 'degraded', restoredCount: 0, invalidCount: 0, failedCount: 1 }),
  );
});

await testAsync('only exact HTTP 200 can carry authoritative history content', async () => {
  for (const status of [201, 206]) {
    const pane = session(`studio-rehydrate-http-${status}`);
    const { busEvents, socket } = loadClient([pane], {
      fetch: async () => ({
        ok: true,
        status,
        json: async () => ({ messages: [] }),
      }),
    });

    sendCompleteRehydrateAck(socket, {
      validIds: [pane._convId],
      invalidIds: [],
    });
    await drainMicrotasks();

    assert.equal(pane._convId, `studio-rehydrate-http-${status}`);
    assert.equal(pane.chat.msgs[0].text, 'stale');
    assert.equal(pane.chat._thinking.text, 'pending');
    assert.equal(
      JSON.stringify(busEvents.filter(event => event.name === 'ws:reconnected').at(-1).payload),
      JSON.stringify({ status: 'degraded', restoredCount: 0, invalidCount: 0, failedCount: 1 }),
    );
  }
});

await testAsync('typed conversation 404 preserves identity and snapshot for the next rehydrate', async () => {
  const pane = session('studio-rehydrate-history-missing');
  let responseBodyReads = 0;
  const { busEvents, socket } = loadClient([pane], {
    fetch: async () => ({
      ok: false,
      status: 404,
      json: async () => {
        responseBodyReads++;
        return {
          error: 'Conversation not found',
          code: 'CONVERSATION_NOT_FOUND',
        };
      },
    }),
  });

  sendCompleteRehydrateAck(socket, {
    validIds: [pane._convId],
    invalidIds: [],
  });
  await drainMicrotasks();

  assert.equal(responseBodyReads, 0, 'non-success payload must not gain content authority');
  assert.equal(pane._convId, 'studio-rehydrate-history-missing');
  assert.equal(pane.chat.msgs[0].text, 'stale');
  assert.equal(pane.chat._thinking.text, 'pending');
  assert.equal(busEvents.some(event => event.name === 'session:invalidated'), false);
  assert.equal(
    JSON.stringify(busEvents.filter(event => event.name === 'ws:reconnected').at(-1).payload),
    JSON.stringify({ status: 'degraded', restoredCount: 0, invalidCount: 0, failedCount: 1 }),
  );
});

await testAsync('rejected and timed-out history effects preserve identity and snapshot', async () => {
  const failures = [
    Object.assign(new Error('synthetic fetch rejection'), { name: 'TypeError' }),
    Object.assign(new Error('synthetic history timeout'), { name: 'TimeoutError' }),
  ];
  for (const failure of failures) {
    const pane = session(`studio-rehydrate-${failure.name.toLowerCase()}`);
    const { busEvents, socket } = loadClient([pane], {
      fetch: async () => { throw failure; },
    });

    sendCompleteRehydrateAck(socket, {
      validIds: [pane._convId],
      invalidIds: [],
    });
    await drainMicrotasks();

    assert.equal(pane._convId, `studio-rehydrate-${failure.name.toLowerCase()}`);
    assert.equal(pane.chat.msgs[0].text, 'stale');
    assert.equal(pane.chat._thinking.text, 'pending');
    assert.equal(busEvents.some(event => event.name === 'session:invalidated'), false);
    assert.equal(
      JSON.stringify(busEvents.filter(event => event.name === 'ws:reconnected').at(-1).payload),
      JSON.stringify({ status: 'degraded', restoredCount: 0, invalidCount: 0, failedCount: 1 }),
    );
  }
});

await testAsync('malformed success history preserves snapshot and reports degraded completion', async () => {
  const pane = session('studio-rehydrate-malformed-history');
  const { busEvents, socket } = loadClient([pane], {
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ notMessages: [] }),
    }),
  });

  sendCompleteRehydrateAck(socket, {
    validIds: [pane._convId],
    invalidIds: [],
  });
  await drainMicrotasks();

  assert.equal(pane._convId, 'studio-rehydrate-malformed-history');
  assert.equal(pane.chat.msgs[0].text, 'stale');
  assert.equal(
    JSON.stringify(busEvents.filter(event => event.name === 'ws:reconnected').at(-1).payload),
    JSON.stringify({ status: 'degraded', restoredCount: 0, invalidCount: 0, failedCount: 1 }),
  );
});

await testAsync('new reconnect epoch wins and stale history cannot overwrite it', async () => {
  const pane = session('studio-rehydrate-race');
  const pendingFetches = [];
  const { busEvents, client, handshake, socket, sockets } = loadClient([pane], {
    fetch: () => {
      const request = deferred();
      pendingFetches.push(request);
      return request.promise;
    },
  });

  sendCompleteRehydrateAck(socket, {
    validIds: [pane._convId],
    invalidIds: [],
  });
  await drainMicrotasks();
  assert.equal(pendingFetches.length, 1);

  client.wsConnect();
  const newerSocket = sockets[1];
  handshake(newerSocket);
  sendCompleteRehydrateAck(newerSocket, {
    validIds: [pane._convId],
    invalidIds: [],
  });
  await drainMicrotasks();
  assert.equal(pendingFetches.length, 2);
  assert.equal(
    busEvents.filter(event => event.name === 'ws:reconnected').length,
    0,
    'completion was emitted before current history fetch settled',
  );

  pendingFetches[1].resolve({
    ok: true,
    status: 200,
    json: async () => ({
      messages: [{ role: 'assistant', content: 'new epoch', metadata: null }],
    }),
  });
  await drainMicrotasks();
  assert.equal(pane.chat.msgs[0].text, 'new epoch');

  pendingFetches[0].resolve({
    ok: true,
    status: 200,
    json: async () => ({
      messages: [{ role: 'assistant', content: 'stale epoch', metadata: null }],
    }),
  });
  await drainMicrotasks();
  assert.equal(pane.chat.msgs[0].text, 'new epoch');
  assert.equal(
    busEvents.filter(event => event.name === 'ws:reconnected').length,
    1,
  );
});

await testAsync('connection epoch alone revokes pending history before the newer ACK', async () => {
  const pane = session('studio-rehydrate-epoch-only');
  const pendingFetch = deferred();
  const { busEvents, client, handshake, socket, sockets } = loadClient([pane], {
    fetch: () => pendingFetch.promise,
  });

  sendCompleteRehydrateAck(socket, {
    validIds: [pane._convId],
    invalidIds: [],
  });
  await drainMicrotasks();

  client.wsConnect();
  handshake(sockets[1]);
  assert.equal(lastRehydrateRequest(sockets[1]).conversationIds[0], pane._convId);
  pendingFetch.resolve({
    ok: true,
    status: 200,
    json: async () => ({
      messages: [{ role: 'assistant', content: 'must lose to newer epoch', metadata: null }],
    }),
  });
  await drainMicrotasks();

  assert.equal(pane.chat.msgs[0].text, 'stale');
  assert.equal(pane.chat._thinking.text, 'pending');
  assert.equal(busEvents.some(event => event.name === 'ws:reconnected'), false);
});

test('stale socket cannot route events, disconnect the active client, or schedule reconnect', () => {
  const timers = [];
  const { busEvents, client, handshake, socket, sockets } = loadClient(
    [session('studio-stale-socket')],
    {
      clearTimeout(timer) {
        if (timer) timer.cleared = true;
      },
      setTimeout(callback, delay) {
        const timer = { callback, cleared: false, delay };
        timers.push(timer);
        return timer;
      },
    },
  );

  client.wsConnect();
  const activeSocket = sockets[1];
  handshake(activeSocket);
  const timerCount = timers.length;
  const socketCount = sockets.length;

  sendServerMessage(socket, {
    channel: 'chat',
    data: {
      type: 'assistant',
      content: 'stale socket response',
      conversationId: 'studio-stale-socket',
    },
  });
  socket.close();

  assert.equal(
    busEvents.some(event => event.name === 'chat:message' && event.payload.content === 'stale socket response'),
    false,
  );
  assert.equal(busEvents.some(event => event.name === 'ws:disconnected'), false);
  assert.equal(busEvents.some(event => event.name === 'ws:reconnect_exhausted'), false);
  assert.equal(client.wsIsReady(), true);
  assert.equal(timers.length, timerCount);
  assert.equal(sockets.length, socketCount);
});

await testAsync('history cannot overwrite activity added after ACK in the same epoch', async () => {
  const pane = session('studio-rehydrate-active');
  const pendingFetch = deferred();
  const { busEvents, socket } = loadClient([pane], {
    fetch: () => pendingFetch.promise,
  });

  sendCompleteRehydrateAck(socket, {
    validIds: [pane._convId],
    invalidIds: [],
  });
  await drainMicrotasks();

  pane.chat.msgs.push({ role: 'user', text: 'newer local activity' });
  pane.chat._thinking = { text: 'new turn pending' };
  pendingFetch.resolve({
    ok: true,
    status: 200,
    json: async () => ({
      messages: [{ role: 'assistant', content: 'older durable history', metadata: null }],
    }),
  });
  await drainMicrotasks();

  assert.equal(pane.chat.msgs.at(-1).text, 'newer local activity');
  assert.equal(pane.chat._thinking.text, 'new turn pending');
  assert.equal(
    JSON.stringify(busEvents.filter(event => event.name === 'ws:reconnected').at(-1).payload),
    JSON.stringify({ status: 'degraded', restoredCount: 0, invalidCount: 0, failedCount: 1 }),
  );
});

await testAsync('same-ID slot reuse after ACK revokes a pending history response', async () => {
  const original = session('studio-rehydrate-post-ack-reuse');
  const sessions = [original];
  const pendingFetch = deferred();
  const { busEvents, socket } = loadClient(sessions, {
    fetch: () => pendingFetch.promise,
  });

  sendCompleteRehydrateAck(socket, {
    validIds: [original._convId],
    invalidIds: [],
  });
  await drainMicrotasks();

  const replacement = session('studio-rehydrate-post-ack-reuse');
  replacement.chat.msgs = [{ role: 'user', text: 'replacement owns this slot' }];
  replacement.chat._thinking = null;
  sessions[0] = replacement;
  pendingFetch.resolve({
    ok: true,
    status: 200,
    json: async () => ({
      messages: [{ role: 'assistant', content: 'late history for old owner', metadata: null }],
    }),
  });
  await drainMicrotasks();

  assert.equal(sessions[0], replacement);
  assert.equal(replacement._convId, 'studio-rehydrate-post-ack-reuse');
  assert.equal(replacement.chat.msgs[0].text, 'replacement owns this slot');
  assert.equal(original.chat.msgs[0].text, 'stale');
  assert.equal(
    JSON.stringify(busEvents.filter(event => event.name === 'ws:reconnected').at(-1).payload),
    JSON.stringify({ status: 'degraded', restoredCount: 0, invalidCount: 0, failedCount: 1 }),
  );
});

await testAsync('typed 404 after ACK cannot affect a same-ID replacement slot', async () => {
  const original = session('studio-rehydrate-404-reuse');
  const sessions = [original];
  const pendingFetch = deferred();
  const { busEvents, socket } = loadClient(sessions, {
    fetch: () => pendingFetch.promise,
  });

  sendCompleteRehydrateAck(socket, {
    validIds: [original._convId],
    invalidIds: [],
  });
  await drainMicrotasks();

  const replacement = session('studio-rehydrate-404-reuse');
  replacement.chat.msgs = [{ role: 'user', text: 'replacement survives 404' }];
  replacement.chat._thinking = null;
  sessions[0] = replacement;
  pendingFetch.resolve({
    ok: false,
    status: 404,
    json: async () => ({
      error: 'Conversation not found',
      code: 'CONVERSATION_NOT_FOUND',
    }),
  });
  await drainMicrotasks();

  assert.equal(sessions[0], replacement);
  assert.equal(replacement._convId, 'studio-rehydrate-404-reuse');
  assert.equal(replacement.chat.msgs[0].text, 'replacement survives 404');
  assert.equal(original._convId, 'studio-rehydrate-404-reuse');
  assert.equal(original.chat.msgs[0].text, 'stale');
  assert.equal(busEvents.some(event => event.name === 'session:invalidated'), false);
  assert.equal(
    JSON.stringify(busEvents.filter(event => event.name === 'ws:reconnected').at(-1).payload),
    JSON.stringify({ status: 'degraded', restoredCount: 0, invalidCount: 0, failedCount: 1 }),
  );
});

await testAsync('post-ACK chat and messages reference replacement revoke history authority', async () => {
  for (const replacementKind of ['chat', 'messages']) {
    const pane = session(`studio-rehydrate-${replacementKind}-ref`);
    const pendingFetch = deferred();
    const { busEvents, socket } = loadClient([pane], {
      fetch: () => pendingFetch.promise,
    });

    sendCompleteRehydrateAck(socket, {
      validIds: [pane._convId],
      invalidIds: [],
    });
    await drainMicrotasks();

    if (replacementKind === 'chat') {
      pane.chat = {
        ...pane.chat,
        msgs: [{ role: 'user', text: 'replacement chat object' }],
        _thinking: null,
      };
    } else {
      pane.chat.msgs = [{ role: 'user', text: 'replacement messages object' }];
      pane.chat._thinking = null;
    }
    const currentChat = pane.chat;
    const currentMessages = pane.chat.msgs;
    pendingFetch.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        messages: [{ role: 'assistant', content: 'late stale history', metadata: null }],
      }),
    });
    await drainMicrotasks();

    assert.equal(pane.chat, currentChat);
    assert.equal(pane.chat.msgs, currentMessages);
    assert.match(pane.chat.msgs[0].text, /^replacement /);
    assert.equal(
      JSON.stringify(busEvents.filter(event => event.name === 'ws:reconnected').at(-1).payload),
      JSON.stringify({ status: 'degraded', restoredCount: 0, invalidCount: 0, failedCount: 1 }),
    );
  }
});

await testAsync('activity before ACK is neither overwritten nor cleared by the ACK result', async () => {
  const validPane = session('studio-rehydrate-pre-ack-valid');
  const invalidPane = session('studio-rehydrate-pre-ack-invalid');
  const { busEvents, socket } = loadClient([validPane, invalidPane], {
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        messages: [{ role: 'assistant', content: 'older durable history', metadata: null }],
      }),
    }),
  });

  validPane.chat.msgs.push({ role: 'user', text: 'valid pane activity before ACK' });
  invalidPane.chat.msgs.push({ role: 'user', text: 'invalid pane activity before ACK' });
  sendCompleteRehydrateAck(socket, {
    validIds: [validPane._convId],
    invalidIds: [invalidPane._convId],
  });
  await drainMicrotasks();

  assert.equal(validPane.chat.msgs.at(-1).text, 'valid pane activity before ACK');
  assert.equal(invalidPane._convId, 'studio-rehydrate-pre-ack-invalid');
  assert.equal(invalidPane.chat.msgs.at(-1).text, 'invalid pane activity before ACK');
  assert.equal(
    busEvents.filter(event => event.name === 'session:invalidated').length,
    0,
  );
  assert.equal(
    JSON.stringify(busEvents.filter(event => event.name === 'ws:reconnected').at(-1).payload),
    JSON.stringify({ status: 'degraded', restoredCount: 0, invalidCount: 0, failedCount: 2 }),
  );
});

await testAsync('slot reuse and message-array replacement revoke ACK authority', async () => {
  {
    const original = session('studio-rehydrate-reused-slot');
    const sessions = [original];
    let fetchCount = 0;
    const { busEvents, socket } = loadClient(sessions, {
      fetch: async () => {
        fetchCount++;
        return { ok: true, status: 200, json: async () => ({ messages: [] }) };
      },
    });
    const replacement = session('studio-rehydrate-reused-slot');
    replacement.chat.msgs = [{ role: 'user', text: 'replacement timeline' }];
    sessions[0] = replacement;

    sendCompleteRehydrateAck(socket, {
      validIds: ['studio-rehydrate-reused-slot'],
      invalidIds: [],
    });
    await drainMicrotasks();
    assert.equal(fetchCount, 0);
    assert.equal(replacement._convId, 'studio-rehydrate-reused-slot');
    assert.equal(replacement.chat.msgs[0].text, 'replacement timeline');
    assert.equal(original._convId, 'studio-rehydrate-reused-slot');
    assert.equal(
      busEvents.filter(event => event.name === 'ws:reconnected').at(-1).payload.status,
      'degraded',
    );
  }

  {
    const pane = session('studio-rehydrate-array-ref');
    let fetchCount = 0;
    const { busEvents, socket } = loadClient([pane], {
      fetch: async () => {
        fetchCount++;
        return { ok: true, status: 200, json: async () => ({ messages: [] }) };
      },
    });
    pane.chat.msgs = pane.chat.msgs.map(message => ({ ...message }));
    sendCompleteRehydrateAck(socket, {
      validIds: [pane._convId],
      invalidIds: [],
    });
    await drainMicrotasks();
    assert.equal(fetchCount, 0);
    assert.equal(pane.chat.msgs[0].text, 'stale');
    assert.equal(
      busEvents.filter(event => event.name === 'ws:reconnected').at(-1).payload.status,
      'degraded',
    );
  }

  {
    const original = session('studio-rehydrate-invalid-reuse');
    const sessions = [original];
    const { busEvents, socket } = loadClient(sessions);
    const replacement = session('studio-rehydrate-invalid-reuse');
    replacement.chat.msgs = [{ role: 'user', text: 'must survive invalid ACK' }];
    sessions[0] = replacement;
    sendCompleteRehydrateAck(socket, {
      validIds: [],
      invalidIds: ['studio-rehydrate-invalid-reuse'],
    });
    await drainMicrotasks();
    assert.equal(replacement._convId, 'studio-rehydrate-invalid-reuse');
    assert.equal(replacement.chat.msgs[0].text, 'must survive invalid ACK');
    assert.equal(original._convId, 'studio-rehydrate-invalid-reuse');
    assert.equal(busEvents.filter(event => event.name === 'session:invalidated').length, 0);
  }
});

await testAsync('identity control frames cannot route first or revive legacy cleanup authority', async () => {
  const emptyPane = session();
  emptyPane.chat.msgs = [];
  const durablePane = session('studio-rehydrate-authority');
  const { busEvents, socket } = loadClient([emptyPane, durablePane]);
  const request = lastRehydrateRequest(socket);

  sendServerMessage(socket, {
    channel: 'control',
    data: {
      action: 'rehydrate_ack',
      rehydrateRequestId: request.rehydrateRequestId,
      complete: true,
      validIds: [durablePane._convId],
      invalidIds: [],
      conversationId: 'studio-route-poison',
    },
  });
  await drainMicrotasks();
  assert.equal(emptyPane._convId, null);
  assert.equal(durablePane._convId, 'studio-rehydrate-authority');
  assert.equal(
    busEvents.filter(event => event.name === 'ws:reconnected').at(-1).payload.status,
    'degraded',
  );

  sendServerMessage(socket, {
    channel: 'control',
    data: {
      action: 'session_invalid',
      conversationId: 'studio-unknown-legacy-identity',
    },
  });
  assert.equal(emptyPane._convId, null);
  assert.equal(durablePane._convId, 'studio-rehydrate-authority');
  assert.equal(durablePane.chat.msgs[0].text, 'stale');
  assert.equal(busEvents.filter(event => event.name === 'session:invalidated').length, 0);
  assert.equal(busEvents.filter(event => event.name === 'session:identity_warning').length, 1);
});

await testAsync('missing ACK times out without clearing the local snapshot and ignores a late ACK', async () => {
  const pane = session('studio-rehydrate-timeout');
  const timers = [];
  let fetchCount = 0;
  const { busEvents, socket } = loadClient([pane], {
    clearTimeout(timer) {
      if (timer) timer.cleared = true;
    },
    fetch: async () => {
      fetchCount++;
      return { ok: true, status: 200, json: async () => ({ messages: [] }) };
    },
    setTimeout(callback, delay) {
      const timer = { callback, cleared: false, delay };
      timers.push(timer);
      return timer;
    },
  });

  const ackTimer = timers.find(timer => timer.delay === 5000 && !timer.cleared);
  assert.ok(ackTimer, 'rehydrate ACK timeout was not scheduled');
  assert.equal(fetchCount, 0);
  ackTimer.callback();
  await drainMicrotasks();

  assert.equal(pane._convId, 'studio-rehydrate-timeout');
  assert.equal(pane.chat.msgs[0].text, 'stale');
  assert.equal(
    JSON.stringify(busEvents.filter(event => event.name === 'ws:reconnected').at(-1).payload),
    JSON.stringify({ status: 'degraded', restoredCount: 0, invalidCount: 0, failedCount: 1 }),
  );

  sendCompleteRehydrateAck(socket, {
    validIds: [pane._convId],
    invalidIds: [],
  });
  await drainMicrotasks();
  assert.equal(fetchCount, 0);
  assert.equal(
    busEvents.filter(event => event.name === 'ws:reconnected').length,
    1,
  );
});

test('panel persists only an exact transport-owned invalidation', () => {
  const source = fs.readFileSync(CHAT_PANEL, 'utf8');
  const start = source.indexOf("C3Bus.on('session:invalidated'");
  const end = source.indexOf('\n  });', start);
  assert.ok(start >= 0 && end > start);
  const handler = source.slice(start, end);
  assert.match(handler, /_sessions\[ev\.idx\]!==ev\.sessionRef/);
  assert.match(handler, /ev\.sessionRef\._convId!==null/);
  assert.doesNotMatch(handler, /_convId=null/);
  assert.match(handler, /_chatInvalidatePreparedSends\(s\.chat\)/);
  assert.match(handler, /_persistSessionState\(\)/);
});

test('persisted Studio bounds are normalized by the function used during restore', () => {
  const source = fs.readFileSync(CHAT_PANEL, 'utf8');
  const start = source.indexOf('function _normalizePersistedSessionState');
  const end = source.indexOf('/* ── Restore session state', start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({ module: { exports: {} }, Number, Math, Array });
  vm.runInContext(
    `${source.slice(start, end)}\nmodule.exports = _normalizePersistedSessionState;`,
    context,
  );
  const normalize = context.module.exports;
  const plain = value => JSON.parse(JSON.stringify(value));

  assert.deepEqual(
    plain(normalize({
      sessionCount: 40,
      sessionActive: 39,
      sessions: [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }],
    })),
    {
      sessionCount: 3,
      sessionActive: 2,
      sessions: [{ id: 0 }, { id: 1 }, { id: 2 }],
    },
  );
  assert.deepEqual(
    plain(normalize({ sessionCount: -4, sessionActive: -9, sessions: [] })),
    { sessionCount: 1, sessionActive: 0, sessions: [] },
  );
  for (const invalidCount of ['3', null, 2.5]) {
    assert.deepEqual(
      plain(normalize({
        sessionCount: invalidCount,
        sessionActive: '1',
        sessions: 'not-an-array',
      })),
      { sessionCount: 2, sessionActive: 0, sessions: [] },
    );
  }

  const restore = source.slice(end, source.indexOf('/* ── Initialize transport', end));
  assert.match(restore, /var normalizedSaved=_normalizePersistedSessionState\(saved\)/);
  assert.match(restore, /normalizedSaved\.sessions\.forEach/);
  assert.match(restore, /if\(!ss\|\|typeof ss!==['"]object['"]\|\|Array\.isArray\(ss\)\)return/);
  assert.doesNotMatch(restore, /\(saved\.sessions \|\| \[\]\)\.forEach/);
});

suite('M1 Studio client — bounded visible reconnect');

test('socket stuck in CONNECTING times out into the bounded scheduler', () => {
  const clock = controlledTimers();
  const { busEvents, socket, sockets } = loadClient([session()], {
    autoHandshake: false,
    clearTimeout: clock.clearTimeout,
    setTimeout: clock.setTimeout,
  });

  assert.equal(socket.readyState, 0);
  assert.equal(clock.active().length, 1);
  assert.equal(clock.active()[0].delay, 5000);
  clock.run(clock.active()[0]);

  assert.equal(socket.readyState, 3);
  assert.equal(clock.active().length, 1);
  assert.equal(clock.active()[0].delay, 1000);
  assert.equal(sockets.length, 1);
  assert.equal(busEvents.some(event => event.name === 'ws:reconnect_exhausted'), false);
});

test('open without ACK times out, does not reset backoff, and hello ACK resets it', () => {
  const clock = controlledTimers();
  const { client, handshake, socket, sockets } = loadClient([session()], {
    autoHandshake: false,
    clearTimeout: clock.clearTimeout,
    setTimeout: clock.setTimeout,
  });

  socket.readyState = 1;
  socket.onopen();
  const handshakeTimeout = clock.active().find(timer => timer.delay === 5000);
  clock.run(handshakeTimeout);
  assert.equal(clock.active().length, 1);
  assert.equal(clock.active()[0].delay, 1000);

  clock.run(clock.active()[0]);
  const secondSocket = sockets[1];
  secondSocket.readyState = 1;
  secondSocket.onopen();
  secondSocket.close();
  assert.equal(clock.active().length, 1);
  assert.equal(clock.active()[0].delay, 2000);

  clock.run(clock.active()[0]);
  const acknowledgedSocket = sockets[2];
  handshake(acknowledgedSocket);
  assert.equal(client.wsIsReady(), true);
  acknowledgedSocket.close();
  assert.equal(clock.active().length, 1);
  assert.equal(clock.active()[0].delay, 1000);
});

test('late hello ACK after timeout cannot create false ready or reset backoff', () => {
  const clock = controlledTimers();
  const { busEvents, client, socket, sockets } = loadClient([session()], {
    autoHandshake: false,
    clearTimeout: clock.clearTimeout,
    deferClose: true,
    setTimeout: clock.setTimeout,
  });

  socket.readyState = 1;
  socket.onopen();
  socket.close();
  socket.finishClose();
  assert.equal(clock.active()[0].delay, 1000);
  clock.run(clock.active()[0]);

  const timedOutSocket = sockets[1];
  const handshakeTimeout = clock.active().find(timer => timer.delay === 5000);
  clock.run(handshakeTimeout);
  assert.equal(timedOutSocket.readyState, 2);
  sendServerMessage(timedOutSocket, {
    type: 'hello_ack',
    serverVersion: 'late',
    features: [],
  });

  assert.equal(client.wsIsReady(), false);
  assert.equal(busEvents.some(event => event.name === 'ws:ready'), false);
  assert.equal(busEvents.some(event => event.name === 'ws:reconnected'), false);
  timedOutSocket.finishClose();
  assert.equal(clock.active().length, 1);
  assert.equal(clock.active()[0].delay, 2000);
});

test('twelve failed reconnects stop at the exact cap and emit exhaustion once', () => {
  const clock = controlledTimers();
  const { busEvents, socket, sockets } = loadClient([session()], {
    autoHandshake: false,
    clearTimeout: clock.clearTimeout,
    setTimeout: clock.setTimeout,
  });
  const retryDelays = [];

  socket.readyState = 1;
  socket.onopen();
  socket.close();
  for (let attempt = 0; attempt < 12; attempt++) {
    assert.equal(clock.active().length, 1);
    const retryTimer = clock.active()[0];
    retryDelays.push(retryTimer.delay);
    clock.run(retryTimer);
    const currentSocket = sockets.at(-1);
    currentSocket.readyState = 1;
    currentSocket.onopen();
    currentSocket.close();
  }

  assert.deepEqual(
    retryDelays,
    [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000, 30000, 30000, 30000],
  );
  assert.equal(sockets.length, 13);
  assert.equal(clock.active().length, 0);
  assert.equal(
    JSON.stringify(busEvents.filter(event => event.name === 'ws:reconnect_exhausted')),
    JSON.stringify([{
      name: 'ws:reconnect_exhausted',
      payload: { attempts: 12, maxAttempts: 12 },
    }]),
  );

  sockets.at(-1).close();
  assert.equal(clock.active().length, 0);
  assert.equal(
    busEvents.filter(event => event.name === 'ws:reconnect_exhausted').length,
    1,
  );
});

test('constructor failures use the same bounded scheduler without recursion', () => {
  const clock = controlledTimers();
  let constructCalls = 0;
  const { busEvents, sockets } = loadClient([session()], {
    autoHandshake: false,
    beforeWebSocketConstruct() {
      constructCalls++;
      throw new Error('synthetic constructor failure');
    },
    clearTimeout: clock.clearTimeout,
    console: { error() {}, log() {} },
    setTimeout: clock.setTimeout,
  });
  const retryDelays = [];

  for (let attempt = 0; attempt < 12; attempt++) {
    assert.equal(clock.active().length, 1);
    const retryTimer = clock.active()[0];
    retryDelays.push(retryTimer.delay);
    clock.run(retryTimer);
  }

  assert.equal(constructCalls, 13);
  assert.equal(sockets.length, 0);
  assert.deepEqual(
    retryDelays,
    [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000, 30000, 30000, 30000],
  );
  assert.equal(clock.active().length, 0);
  assert.equal(
    busEvents.filter(event => event.name === 'ws:reconnect_exhausted').length,
    1,
  );
});

test('a successful handshake resets the exhaustion latch for a later outage', () => {
  const clock = controlledTimers();
  const { busEvents, client, handshake, socket, sockets } = loadClient([session()], {
    autoHandshake: false,
    clearTimeout: clock.clearTimeout,
    setTimeout: clock.setTimeout,
  });

  socket.readyState = 1;
  socket.onopen();
  socket.close();
  for (let attempt = 0; attempt < 12; attempt++) {
    const retryTimer = clock.active()[0];
    clock.run(retryTimer);
    const currentSocket = sockets.at(-1);
    currentSocket.readyState = 1;
    currentSocket.onopen();
    currentSocket.close();
  }
  assert.equal(
    busEvents.filter(event => event.name === 'ws:reconnect_exhausted').length,
    1,
  );

  assert.equal(client.wsConnect(), true);
  const recoveredSocket = sockets.at(-1);
  handshake(recoveredSocket);
  recoveredSocket.close();
  for (let attempt = 0; attempt < 12; attempt++) {
    const retryTimer = clock.active()[0];
    clock.run(retryTimer);
    const currentSocket = sockets.at(-1);
    currentSocket.readyState = 1;
    currentSocket.onopen();
    currentSocket.close();
  }

  assert.equal(
    busEvents.filter(event => event.name === 'ws:reconnect_exhausted').length,
    2,
  );
});

test('destroyed active client stays stopped without retry or exhaustion', () => {
  const clock = controlledTimers();
  const { busEvents, client, sockets } = loadClient([session()], {
    clearTimeout: clock.clearTimeout,
    setTimeout: clock.setTimeout,
  });
  assert.equal(client.wsIsReady(), true);
  client.trackEditRequest('edit-destroy', '/owned/file.js', null, 0);

  client.wsDestroy();

  assert.equal(client.wsIsReady(), false);
  assert.equal(clock.active().length, 0);
  assert.equal(busEvents.some(event => event.name === 'ws:reconnect_exhausted'), false);
  assert.equal(
    JSON.stringify(busEvents.filter(event => event.name === 'edit:resolved').at(-1)),
    JSON.stringify({
      name: 'edit:resolved',
      payload: { reqId: 'edit-destroy', action: 'disconnect' },
    }),
  );
  assert.equal(client.wsConnect(), false);
  assert.equal(sockets.length, 1);
});

test('destroy cancels a pending retry and its queued callback cannot reconnect', () => {
  const clock = controlledTimers();
  const { busEvents, client, socket, sockets } = loadClient([session()], {
    autoHandshake: false,
    clearTimeout: clock.clearTimeout,
    setTimeout: clock.setTimeout,
  });
  socket.readyState = 1;
  socket.onopen();
  socket.close();
  const retryTimer = clock.active()[0];
  assert.equal(retryTimer.delay, 1000);

  client.wsDestroy();
  assert.equal(retryTimer.cleared, true);
  retryTimer.callback();

  assert.equal(sockets.length, 1);
  assert.equal(clock.active().length, 0);
  assert.equal(busEvents.some(event => event.name === 'ws:reconnect_exhausted'), false);
});

test('destroy cancels a pending CONNECTING timeout and its callback is inert', () => {
  const clock = controlledTimers();
  const { busEvents, client, sockets } = loadClient([session()], {
    autoHandshake: false,
    clearTimeout: clock.clearTimeout,
    setTimeout: clock.setTimeout,
  });
  const handshakeTimer = clock.active()[0];
  assert.equal(handshakeTimer.delay, 5000);

  client.wsDestroy();
  assert.equal(handshakeTimer.cleared, true);
  handshakeTimer.callback();

  assert.equal(sockets.length, 1);
  assert.equal(clock.active().length, 0);
  assert.equal(busEvents.some(event => event.name === 'ws:reconnect_exhausted'), false);
});

test('panel makes reconnect exhaustion visible and keeps health offline', () => {
  const source = fs.readFileSync(CHAT_PANEL, 'utf8');
  const start = source.indexOf("C3Bus.on('ws:reconnect_exhausted'");
  const end = source.indexOf('\n  });', start);
  assert.ok(start >= 0 && end > start);
  const handler = source.slice(start, end);
  assert.match(handler, /_serverHealth\.wsConnected = false/);
  assert.match(handler, /_serverHealth\.status = 'offline'/);
  assert.match(handler, /agentLog/);
  assert.match(handler, /renderSidebar\(\);_updateStatusIndicator\(\)/);
});

suite('M1 Studio client — versioned settings recovery');

await testAsync('export rejects non-2xx and malformed success without creating a download', async () => {
  for (const fixture of [
    { ok: false, status: 503, body: { code: 'MODEL_POLICY_STORAGE_UNAVAILABLE' } },
    { ok: true, status: 200, body: { ok: false, backup: settingsBackupFixture() } },
    { ok: true, status: 200, body: { ok: true, backup: {} } },
    {
      ok: true,
      status: 200,
      body: {
        ok: true,
        backup: settingsBackupFixture({
          generalSettings: { webhookSecret: 'server-leaked-secret' },
        }),
      },
    },
    { ok: true, status: 200, jsonError: new Error('invalid JSON') },
    new Error('fixture disconnected'),
  ]) {
    const initial = { theme: 'dark', webhookSecret: 'keep-local-secret' };
    const harness = settingsBackupHarness({ initialSettings: initial, responses: [fixture] });
    assert.equal(await harness.functions.exportBackup(), null);
    assert.equal(harness.requests.length, 1);
    assert.equal(harness.downloads.length, 0);
    assert.deepEqual(harness.settings(), initial);
    assert.equal(harness.status().ok, false);
  }
});

await testAsync('export downloads the exact validated versioned envelope returned by the server', async () => {
  const backup = settingsBackupFixture();
  const harness = settingsBackupHarness({
    responses: [{ ok: true, status: 200, body: { ok: true, backup } }],
  });

  const result = await harness.functions.exportBackup();
  assert.equal(result.ok, true);
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0].url, 'http://127.0.0.1:3335/api/settings/backup');
  assert.equal(harness.requests[0].init.method, undefined);
  assert.equal(harness.requests[0].init.signal.milliseconds, 3000);
  assert.equal(harness.downloads.length, 1);
  assert.match(harness.downloads[0].download, /^intentsmith-settings-\d{4}-\d{2}-\d{2}\.json$/);
  assert.equal(harness.downloads[0].blob.type, 'application/json');
  assert.equal(harness.downloads[0].href, 'blob:intentsmith-settings-fixture');
  assert.deepEqual(harness.revokedObjectUrls, ['blob:intentsmith-settings-fixture']);
  const encoded = await harness.downloads[0].blob.text();
  assert.deepEqual(JSON.parse(encoded), backup);
  assert.equal(encoded.includes('destination-webhook-secret'), false);
  assert.equal(encoded.includes('destination-smtp-secret'), false);
  assert.equal(harness.status().ok, true);
});

await testAsync('import failures retain the exact local settings snapshot', async () => {
  const backup = settingsBackupFixture();
  for (const fixture of [
    { ok: false, status: 400, body: { code: 'MODEL_POLICY_SETTINGS_BACKUP_INVALID' } },
    {
      ok: false,
      status: 409,
      body: {
        code: 'USER_SETTINGS_REVISION_CONFLICT',
        expectedRevision: 1,
        currentRevision: 2,
      },
    },
    { ok: false, status: 503, body: { code: 'MODEL_POLICY_STORAGE_UNAVAILABLE' } },
    { ok: true, status: 200, body: { ok: true, success: true, settings: null } },
    { ok: true, status: 200, body: { ok: false, success: true, settings: {} } },
    { ok: true, status: 200, jsonError: new Error('invalid JSON') },
    new Error('fixture disconnected'),
  ]) {
    const initial = {
      theme: 'dark',
      webhookSecret: 'keep-webhook',
      'c3.notif.smtpPass': 'keep-smtp',
    };
    const harness = settingsBackupHarness({ initialSettings: initial, responses: [fixture] });
    assert.equal(
      await harness.functions.importJson(JSON.stringify(backup), 'fixture.json'),
      null,
    );
    assert.equal(harness.requests.length, 1);
    assert.deepEqual(harness.settings(), initial);
    assert.equal(harness.status().ok, false);
    if (fixture && fixture.status === 409) {
      assert.equal(harness.functions.state().mutationState, 'RELOAD_REQUIRED');
      assert.equal(harness.functions.state().reloadRequired, true);
      assert.equal(harness.requests.length, 1, 'revision conflict was replayed');
    }
  }
});

await testAsync('invalid local documents fail before any import effect', async () => {
  for (const encoded of [
    '[]',
    JSON.stringify(settingsBackupFixture({ schemaVersion: 3 })),
    JSON.stringify({ ...settingsBackupFixture(), unknown: true }),
    JSON.stringify(settingsBackupFixture({
      modelAutomationPolicy: {
        autoFailoverEnabled: 'true',
        autoCleanupEnabled: false,
        autoCleanupDays: 14,
      },
    })),
    JSON.stringify(settingsBackupFixture({ settingsProjection: {
      profile: 'UX_PREFERENCES_V1',
      values: {
        ...settingsBackupFixture().settingsProjection.values,
        '/notifications/telegramToken': 'must-not-enter-versioned-import',
      },
    } })),
    JSON.stringify({ kind: 'UNKNOWN_BACKUP', schemaVersion: 1 }),
  ]) {
    const initial = { theme: 'dark', webhookSecret: 'keep-webhook' };
    const harness = settingsBackupHarness({ initialSettings: initial });
    assert.equal(await harness.functions.importJson(encoded, 'invalid.json'), null);
    assert.equal(harness.requests.length, 0);
    assert.deepEqual(harness.settings(), initial);
    assert.equal(harness.status().ok, false);
  }
});

await testAsync('legacy import is CAS-wrapped, adopts redacted state, and the next save stays versioned', async () => {
  const committedSettings = {
    appearance: { theme: 'light' },
  };
  const harness = settingsBackupHarness({
    initialSettings: { theme: 'dark', webhookSecret: 'old-webhook' },
    responses: [
      {
        ok: true,
        status: 200,
        body: settingsImportCommitFixture({
          settings: committedSettings,
          runtimeApplied: false,
          runtimeErrorCode: 'SETTINGS_RUNTIME_APPLY_FAILED',
          sourceSchemaVersion: 1,
          appliedPortablePaths: ['/appearance/theme'],
          preservedLocalPathCount: 2,
        }),
      },
      { ok: true, status: 200, body: { revision: 3, settings: committedSettings } },
    ],
  });

  const result = await harness.functions.importJson(
    JSON.stringify({ appearance: { theme: 'light' } }),
    'legacy-settings.json',
  );
  assert.equal(result.success, true);
  assert.equal(harness.requests[0].url, 'http://127.0.0.1:3335/api/settings/import');
  assert.equal(harness.requests[0].init.method, 'POST');
  assert.deepEqual(hostClone(harness.requests[0].init.headers), { 'Content-Type': 'application/json' });
  assert.equal(harness.requests[0].init.signal.milliseconds, 3000);
  assert.deepEqual(JSON.parse(harness.requests[0].init.body), {
    backup: {
      kind: 'INTENTSMITH_SETTINGS_BACKUP',
      schemaVersion: 1,
      generalSettings: { appearance: { theme: 'light' } },
      modelAutomationPolicy: null,
      omittedSensitiveKeys: [],
    },
    expectedRevision: 1,
  });
  assert.deepEqual(harness.settings(), committedSettings);
  assert.match(harness.status().text, /runtime vyžaduje restart/);

  harness.functions.saveConfig();
  const saveTimer = harness.timers.find(timer => timer.delay === 500);
  assert.ok(saveTimer, 'generic save was not scheduled');
  saveTimer.callback();
  await Promise.resolve();
  assert.equal(harness.requests[1].url, 'http://127.0.0.1:3335/api/settings/v2');
  assert.equal(harness.requests[1].init.method, 'PUT');
  assert.deepEqual(JSON.parse(harness.requests[1].init.body), {
    expectedRevision: 2,
    patch: committedSettings,
  });
});

await testAsync('reset is fail-closed and only adopts a committed server snapshot', async () => {
  const initial = { theme: 'dark', webhookSecret: 'keep-webhook' };
  const failed = settingsBackupHarness({
    initialSettings: initial,
    responses: settingsResetResponses({
      ok: false,
      status: 500,
      body: { code: 'SETTINGS_RESET_FAILED' },
    }),
  });
  assert.equal(await failed.functions.resetAll(), null);
  assert.deepEqual(failed.settings(), initial);
  assert.equal(failed.status().ok, false);

  const committedSettings = {};
  const succeeded = settingsBackupHarness({
    initialSettings: initial,
    responses: settingsResetResponses({
      ok: true,
      status: 200,
      body: settingsResetCommitFixture({
        settings: committedSettings,
        runtimeApplied: false,
        runtimeErrorCode: 'SETTINGS_RUNTIME_APPLY_FAILED',
      }),
    }),
  });
  assert.equal((await succeeded.functions.resetAll()).success, true);
  assert.deepEqual(succeeded.requests.map(request => request.url), [
    'http://127.0.0.1:3335/api/settings/v2',
    'http://127.0.0.1:3335/api/system/models/settings',
    'http://127.0.0.1:3335/api/settings/reset',
    'http://127.0.0.1:3335/api/features',
  ]);
  assert.equal(succeeded.requests[2].init.method, 'POST');
  assert.deepEqual(hostClone(succeeded.requests[2].init.headers), { 'Content-Type': 'application/json' });
  assert.equal(succeeded.requests[2].init.signal.milliseconds, 3000);
  assert.deepEqual(JSON.parse(succeeded.requests[2].init.body), {
    scope: 'SERVER_SETTINGS_V1',
    expectedRevision: 1,
    expectedPolicyRevision: 1,
  });
  assert.deepEqual(succeeded.settings(), committedSettings);
  assert.deepEqual(hostClone(succeeded.functions.features()), { agents: true });
  assert.deepEqual(succeeded.localStorageEffects, []);
  assert.match(succeeded.status().text, /runtime vyžaduje restart/);

  const localRetry = settingsBackupHarness({
    responses: [
      ...settingsResetResponses(
        { ok: true, status: 200, body: settingsResetCommitFixture() },
        { features: new Error('fixture feature reload failed') },
      ),
      { ok: true, status: 200, body: { features: { agents: false } } },
    ],
  });
  assert.equal((await localRetry.functions.resetAll()).success, true);
  assert.equal(localRetry.functions.resetState().localPhase, 'DEGRADED');
  assert.equal(localRetry.requests.filter(request => request.init.method === 'POST').length, 1);
  assert.equal((await localRetry.functions.resetAll()).success, true);
  assert.equal(localRetry.functions.resetState().localPhase, 'COMPLETE');
  assert.equal(localRetry.requests.filter(request => request.init.method === 'POST').length, 1);
  assert.equal(localRetry.requests.at(-1).url, 'http://127.0.0.1:3335/api/features');
  assert.deepEqual(localRetry.localStorageEffects, []);

  const staleFeature = deferred();
  const fenced = settingsBackupHarness({
    responses: [
      ({ context }) => staleFeature.promise.then(body => ({
        ok: true,
        status: 200,
        async json() {
          return vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(body))})`, context);
        },
      })),
      ...settingsResetResponses(
        { ok: true, status: 200, body: settingsResetCommitFixture() },
        { features: { ok: true, status: 200, body: { features: { agents: true } } } },
      ),
    ],
  });
  const oldFeatureLoad = fenced.functions.loadFeatures();
  await drainMicrotasks();
  assert.equal((await fenced.functions.resetAll()).success, true);
  staleFeature.resolve({ features: { agents: false, stale: true } });
  assert.equal(await oldFeatureLoad, false);
  assert.deepEqual(hostClone(fenced.functions.features()), { agents: true });

  for (const staleOutcome of ['resolve', 'reject']) {
    const stale = deferred();
    const replacement = deferred();
    const overlapping = settingsBackupHarness({
      responses: [
        ({ context }) => stale.promise.then(body => ({
          ok: true,
          status: 200,
          async json() {
            return vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(body))})`, context);
          },
        })),
        ({ context }) => replacement.promise.then(body => ({
          ok: true,
          status: 200,
          async json() {
            return vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(body))})`, context);
          },
        })),
      ],
    });
    const staleLoad = overlapping.functions.loadFeatures(null, true);
    const replacementLoad = overlapping.functions.loadFeatures(null, true);
    if (staleOutcome === 'resolve') stale.resolve({ features: { stale: true } });
    else stale.reject(new Error('fixture stale feature failure'));
    assert.equal(await staleLoad, false);
    assert.equal(overlapping.functions.resetState().featureLoading, true);
    replacement.resolve({ features: { newest: true } });
    assert.equal(await replacementLoad, true);
    assert.equal(overlapping.functions.resetState().featureLoading, false);
    assert.deepEqual(hostClone(overlapping.functions.features()), { newest: true });
  }

  const failedForce = deferred();
  const afterFailure = settingsBackupHarness({
    responses: [
      () => failedForce.promise,
      { ok: true, status: 200, body: { features: { recovered: true } } },
    ],
  });
  const failedLoad = afterFailure.functions.loadFeatures(null, true);
  assert.equal(afterFailure.functions.resetState().featureLoading, true);
  failedForce.reject(new Error('fixture current feature failure'));
  assert.equal(await failedLoad, false);
  assert.equal(afterFailure.functions.resetState().featureLoading, false);
  assert.equal(await afterFailure.functions.loadFeatures(), true);
  assert.deepEqual(hostClone(afterFailure.functions.features()), { recovered: true });
});

await testAsync('successful runtime apply does not claim restart for import or reset', async () => {
  const imported = settingsBackupHarness({
    responses: [{
      ok: true,
      status: 200,
      body: settingsImportCommitFixture(),
    }],
  });
  assert.equal(
    (await imported.functions.importJson(JSON.stringify(settingsBackupFixture()), 'exact.json')).success,
    true,
  );
  assert.equal(imported.status().text.includes('restart'), false);

  const reset = settingsBackupHarness({
    responses: settingsResetResponses({
      ok: true,
      status: 200,
      body: settingsResetCommitFixture(),
    }),
  });
  assert.equal((await reset.functions.resetAll()).success, true);
  assert.equal(reset.status().text.includes('restart'), false);
});

await testAsync('import and reset reject incomplete or inconsistent runtime commit metadata', async () => {
  const invalidBodies = [
    { ok: true, success: true, settings: { theme: 'partial' } },
    { ok: true, success: true, settings: { theme: 'partial' }, runtimeApplied: null, runtimeErrorCode: null },
    { ok: true, success: true, settings: { theme: 'partial' }, runtimeApplied: 'false', runtimeErrorCode: 'SETTINGS_RUNTIME_APPLY_FAILED' },
    { ok: true, success: true, settings: { theme: 'partial' }, runtimeApplied: 0, runtimeErrorCode: 'SETTINGS_RUNTIME_APPLY_FAILED' },
    { ok: true, success: true, settings: { theme: 'partial' }, runtimeApplied: true, runtimeErrorCode: 'SETTINGS_RUNTIME_APPLY_FAILED' },
    { ok: true, success: true, settings: { theme: 'partial' }, runtimeApplied: false, runtimeErrorCode: null },
  ];

  for (const body of invalidBodies) {
    for (const operation of ['import', 'reset']) {
      const initial = { theme: 'dark', webhookSecret: 'keep-webhook' };
      const harness = settingsBackupHarness({
        initialSettings: initial,
        responses: operation === 'reset'
          ? settingsResetResponses({ ok: true, status: 200, body })
          : [{ ok: true, status: 200, body }],
      });
      const result = operation === 'import'
        ? await harness.functions.importJson(JSON.stringify(settingsBackupFixture()), 'invalid-runtime.json')
        : await harness.functions.resetAll();
      assert.equal(result, null);
      assert.deepEqual(harness.settings(), initial);
      assert.equal(harness.status().ok, false);
    }
  }
});

await testAsync('all first-party import consumers reject schema and audit provenance mismatches', async () => {
  const base = settingsImportCommitFixture();
  const mismatches = [
    { ...base, sourceSchemaVersion: 1 },
    { ...base, revision: 1 },
    { ...base, event: { ...base.event, actor: 'user:unexpected-importer' } },
    { ...base, policy: { ...base.policy, lastEventId: 'policy-event-mismatch-0002' } },
    {
      ...base,
      settings: settingsPortableGeneralSettings({ appearance: { theme: 'dark' } }),
    },
    { ...base, policy: { ...base.policy, autoCleanupDays: 30 } },
    { ...base, ignoredSourcePathCount: 999 },
  ];

  for (const body of mismatches) {
    const chatPanel = settingsBackupHarness({
      initialSettings: { appearance: { theme: 'dark' } },
      responses: [{ ok: true, status: 200, body }],
    });
    assert.equal(
      await chatPanel.functions.importJson(JSON.stringify(settingsBackupFixture()), 'mismatch.json'),
      null,
    );
    assert.equal(chatPanel.functions.state().mutationState, 'DELIVERY_UNKNOWN');
    assert.deepEqual(chatPanel.settings(), { appearance: { theme: 'dark' } });

    const architect = architectSettingsHarness({
      initialSettings: { appearance: { theme: 'dark' } },
      responses: [{ ok: true, status: 200, body }],
    });
    architect.functions.importSettings();
    await architect.fileInputs[0].onchange({
      target: { files: [{ text: async () => JSON.stringify(settingsBackupFixture()) }] },
    });
    assert.equal(architect.functions.state(), 'DELIVERY_UNKNOWN');
    assert.equal(architect.functions.snapshot().appearance.theme, 'dark');

    const center = centerViewsSettingsHarness({
      responses: [
        { ok: true, status: 200, body: { revision: 1, settings: {} } },
        { ok: true, status: 200, body },
      ],
    });
    center.functions.importSettings.call(center.widget);
    await center.fileInputs[0].onchange({
      target: { files: [{ text: async () => JSON.stringify(settingsBackupFixture()) }] },
    });
    assert.equal(center.widget._portableSettingsMutationState, 'DELIVERY_UNKNOWN');
    assert.match(center.alerts.at(-1), /outcome is unknown/);
  }
});

await testAsync('legacy import provenance is the exact source-derived portable path subset', async () => {
  const legacy = settingsBackupV1Fixture({
    generalSettings: {
      appearance: { theme: 'light' },
      'c3.language': 'en',
    },
  });
  const committed = settingsImportCommitFixture({
    settings: {
      appearance: { theme: 'light' },
      'c3.language': 'en',
    },
    sourceSchemaVersion: 1,
    appliedPortablePaths: ['/appearance/theme', '/c3.language'],
  });
  const invalidPathLists = [
    [],
    ['/c3.language'],
    ['/appearance/theme', '/c3.language', '/c3.output.codeBlocks'],
    ['/appearance/theme', '/appearance/theme', '/c3.language'],
    ['/c3.language', '/appearance/theme'],
    ['/appearance/theme,/c3.language'],
    ['/appearance/theme\0/c3.language'],
  ];

  for (const appliedPortablePaths of invalidPathLists) {
    const body = { ...committed, appliedPortablePaths };
    const chatPanel = settingsBackupHarness({
      responses: [{ ok: true, status: 200, body }],
    });
    assert.equal(await chatPanel.functions.importJson(JSON.stringify(legacy), 'legacy.json'), null);
    assert.equal(chatPanel.functions.state().mutationState, 'DELIVERY_UNKNOWN');

    const architect = architectSettingsHarness({
      responses: [{ ok: true, status: 200, body }],
    });
    architect.functions.importSettings();
    await architect.fileInputs[0].onchange({
      target: { files: [{ text: async () => JSON.stringify(legacy) }] },
    });
    assert.equal(architect.functions.state(), 'DELIVERY_UNKNOWN');

    const center = centerViewsSettingsHarness({
      responses: [
        { ok: true, status: 200, body: { revision: 1, settings: {} } },
        { ok: true, status: 200, body },
      ],
    });
    center.functions.importSettings.call(center.widget);
    await center.fileInputs[0].onchange({
      target: { files: [{ text: async () => JSON.stringify(legacy) }] },
    });
    assert.equal(center.widget._portableSettingsMutationState, 'DELIVERY_UNKNOWN');
  }
});

await testAsync('legacy compatibility reports ignored non-portable source paths in every UI', async () => {
  const legacy = settingsBackupV1Fixture({
    generalSettings: {
      appearance: { theme: 'light' },
      notifications: { telegramToken: 'ATTACKER_SOURCE_TOKEN' },
    },
  });
  const body = settingsImportCommitFixture({
    settings: {
      appearance: { theme: 'light' },
    },
    sourceSchemaVersion: 1,
    appliedPortablePaths: ['/appearance/theme'],
    ignoredSourcePathCount: 1,
    preservedLocalPathCount: 1,
  });

  const chatPanel = settingsBackupHarness({
    responses: [{ ok: true, status: 200, body }],
  });
  assert.equal(
    (await chatPanel.functions.importJson(JSON.stringify(legacy), 'legacy.json')).success,
    true,
  );
  assert.match(chatPanel.status().text, /1 nepřenosných zdrojových cest/);

  const architect = architectSettingsHarness({
    responses: [{ ok: true, status: 200, body }],
  });
  architect.functions.importSettings();
  await architect.fileInputs[0].onchange({
    target: { files: [{ text: async () => JSON.stringify(legacy) }] },
  });
  assert.equal(architect.functions.state(), 'IDLE');
  assert.match(architect.toasts.at(-1).message, /1 nepřenosných zdrojových cest/);

  const center = centerViewsSettingsHarness({
    responses: [
      { ok: true, status: 200, body: { revision: 1, settings: {} } },
      { ok: true, status: 200, body },
    ],
  });
  center.functions.importSettings.call(center.widget);
  await center.fileInputs[0].onchange({
    target: { files: [{ text: async () => JSON.stringify(legacy) }] },
  });
  assert.equal(center.widget._portableSettingsMutationState, 'IDLE');
  assert.match(center.alerts.at(-1), /1 non-portable source paths/);
});

await testAsync('reset rejects a malformed 2xx commit without changing local settings', async () => {
  const exactReset = settingsResetCommitFixture();
  for (const body of [
    { ok: true, success: false, settings: {} },
    { ok: true, success: true, settings: [] },
    settingsResetCommitFixture({ settings: { appearance: { theme: 'light' } } }),
    settingsResetCommitFixture({ revision: 3 }),
    settingsResetCommitFixture({ policy: { ...exactReset.policy, revision: 3 } }),
    settingsResetCommitFixture({
      policy: { ...exactReset.policy, autoFailoverEnabled: true },
    }),
  ]) {
    const initial = { theme: 'dark', webhookSecret: 'keep-webhook' };
    const harness = settingsBackupHarness({
      initialSettings: initial,
      responses: settingsResetResponses({ ok: true, status: 200, body }),
    });
    assert.equal(await harness.functions.resetAll(), null);
    assert.deepEqual(harness.settings(), initial);
    assert.equal(harness.status().ok, false);
  }
});

await testAsync('settings mutations are single-flight and an old success timer cannot erase a newer failure', async () => {
  const pending = deferred();
  const harness = settingsBackupHarness({
    responses: [
      ({ context }) => pending.promise.then(body => ({
        ok: true,
        status: 200,
        async json() {
          return vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(body))})`, context);
        },
      })),
      { ok: false, status: 500, body: { code: 'MODEL_AUTOMATION_POLICY_RESET_FAILED' } },
    ],
  });
  const first = harness.functions.importJson(
    JSON.stringify(settingsBackupFixture()),
    'pending.json',
  );
  assert.equal(await harness.functions.resetAll(), null);
  assert.equal(harness.requests.length, 1, 'a pending mutation admitted another HTTP effect');
  assert.match(harness.status().text, /právě probíhá/);

  pending.resolve(settingsImportCommitFixture({
    settings: settingsPortableGeneralSettings(),
  }));
  assert.equal((await first).success, true);
  assert.deepEqual(harness.settings(), settingsPortableGeneralSettings());
  const oldSuccessTimer = harness.timers.find(timer => timer.delay === 4000);
  assert.ok(oldSuccessTimer);

  assert.equal(await harness.functions.resetAll(), null);
  assert.equal(harness.requests.length, 2);
  assert.equal(harness.status().ok, false);
  const failureText = harness.status().text;
  oldSuccessTimer.callback();
  assert.equal(harness.status().text, failureText);
});

await testAsync('settings recovery cancels queued saves, waits for in-flight saves, and cannot be overwritten', async () => {
  const saveDone = deferred();
  const committedSettings = {};
  const harness = settingsBackupHarness({
    initialSettings: { theme: 'stale', webhookSecret: 'preserved-webhook' },
    responses: [
      ({ context }) => saveDone.promise.then(() => ({
        ok: true,
        status: 200,
        async json() {
          const body = {
            revision: 2,
            settings: { theme: 'stale', webhookSecret: 'preserved-webhook' },
          };
          return vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(body))})`, context);
        },
      })),
      { ok: true, status: 200, body: { revision: 2, settings: { theme: 'stale', webhookSecret: 'preserved-webhook' } } },
      { ok: true, status: 200, body: settingsPolicyReadFixture() },
      {
        ok: true,
        status: 200,
        body: settingsResetCommitFixture({
          revision: 3,
          settings: committedSettings,
        }),
      },
      { ok: true, status: 200, body: { features: { agents: true } } },
    ],
  });

  harness.functions.saveConfig();
  const firstSaveTimer = harness.timers.find(timer => timer.delay === 500);
  assert.ok(firstSaveTimer);
  firstSaveTimer.callback();
  await drainMicrotasks();
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0].url, 'http://127.0.0.1:3335/api/settings/v2');
  assert.deepEqual(JSON.parse(harness.requests[0].init.body), {
    expectedRevision: 1,
    patch: {
      theme: 'stale',
      webhookSecret: 'preserved-webhook',
    },
  });

  const reset = harness.functions.resetAll();
  harness.functions.replaceAndSave(JSON.stringify({
    theme: 'concurrent-stale',
    webhookSecret: 'preserved-webhook',
  }));
  await drainMicrotasks();
  assert.equal(harness.requests.length, 1, 'recovery did not wait for the in-flight generic save');

  saveDone.resolve();
  const resetResult = await reset;
  assert.equal(harness.requests.length, 5, 'reset did not complete fresh reads, commit and local reload');
  assert.equal(harness.requests[3].url, 'http://127.0.0.1:3335/api/settings/reset');
  assert.equal(resetResult.success, true);
  assert.deepEqual(harness.settings(), committedSettings);
  assert.equal(
    harness.timers.filter(timer => timer.delay === 500 && !timer.cancelled).length,
    1,
    'recovery scheduled a stale generic save after its committed snapshot',
  );

  const failed = settingsBackupHarness({
    initialSettings: { theme: 'unsaved' },
    responses: [
      { ok: true, status: 200, body: { revision: 1, settings: { theme: 'unsaved' } } },
      { ok: true, status: 200, body: settingsPolicyReadFixture() },
      { ok: false, status: 500, body: { code: 'MODEL_AUTOMATION_POLICY_RESET_FAILED' } },
      { ok: true, status: 200, body: { revision: 2, settings: { theme: 'unsaved' } } },
    ],
  });
  failed.functions.saveConfig();
  const cancelledTimer = failed.timers.find(timer => timer.delay === 500);
  assert.ok(cancelledTimer);
  assert.equal(await failed.functions.resetAll(), null);
  assert.equal(cancelledTimer.cancelled, true);
  const resumedTimer = failed.timers.find(timer => timer.delay === 500 && !timer.cancelled);
  assert.ok(resumedTimer, 'failed recovery did not resume the cancelled local save');
  resumedTimer.callback();
  await drainMicrotasks();
  assert.equal(failed.requests.length, 4, 'definitive rejection did not resume the deferred PUT');
  assert.equal(failed.requests[3].url, 'http://127.0.0.1:3335/api/settings/v2');
  assert.deepEqual(JSON.parse(failed.requests[3].init.body), {
    expectedRevision: 1,
    patch: { theme: 'unsaved' },
  });
});

await testAsync('ambiguous settings delivery fences stale saves and every later mutation effect', async () => {
  for (const ambiguousResponse of [
    { ok: true, status: 200, jsonError: new Error('truncated commit response') },
    new Error('connection ended after request delivery'),
  ]) {
    const harness = settingsBackupHarness({
      initialSettings: { theme: 'stale-before-reset' },
      responses: [
        { ok: true, status: 200, body: { revision: 1, settings: { theme: 'stale-before-reset' } } },
        { ok: true, status: 200, body: settingsPolicyReadFixture() },
        ambiguousResponse,
      ],
    });
    harness.functions.saveConfig();
    const staleTimer = harness.timers.find(timer => timer.delay === 500);
    assert.ok(staleTimer);

    assert.equal(await harness.functions.resetAll(), null);
    assert.equal(staleTimer.cancelled, true);
    assert.deepEqual(hostClone(harness.functions.state()), {
      mutationState: 'DELIVERY_UNKNOWN',
      pending: false,
      deliveryUnknown: true,
      reloadRequired: false,
      generation: 1,
      loading: false,
      revision: 1,
    });
    assert.equal(harness.requests.length, 3);
    assert.match(harness.status().text, /nelze potvrdit/);
    assert.equal(
      harness.timers.some(timer => timer.delay === 500 && !timer.cancelled),
      false,
      'DELIVERY_UNKNOWN replayed the stale queued save',
    );

    harness.functions.setConfig('theme', 'must-not-write');
    assert.deepEqual(harness.settings(), { theme: 'stale-before-reset' });
    assert.equal(await harness.functions.resetAll(), null);
    await drainMicrotasks();
    assert.equal(harness.requests.length, 3, 'the delivery-unknown fence admitted another write');
    assert.equal(
      harness.timers.some(timer => timer.delay === 500 && !timer.cancelled),
      false,
      'the delivery-unknown fence scheduled a later generic save',
    );
  }
});

await testAsync('definitive settings rejection resumes exactly one deferred generic save', async () => {
  const harness = settingsBackupHarness({
    initialSettings: { theme: 'locally-edited' },
    responses: [
      { ok: true, status: 200, body: { revision: 1, settings: { theme: 'locally-edited' } } },
      { ok: true, status: 200, body: settingsPolicyReadFixture() },
      { ok: false, status: 503, jsonError: new Error('unreadable rejection body') },
      { ok: true, status: 200, body: { revision: 2, settings: { theme: 'locally-edited' } } },
    ],
  });
  harness.functions.saveConfig();
  const staleTimer = harness.timers.find(timer => timer.delay === 500);
  assert.ok(staleTimer);

  assert.equal(await harness.functions.resetAll(), null);
  assert.equal(staleTimer.cancelled, true);
  assert.equal(harness.functions.state().mutationState, 'REJECTED');
  const resumed = harness.timers.filter(timer => timer.delay === 500 && !timer.cancelled);
  assert.equal(resumed.length, 1);
  resumed[0].callback();
  await drainMicrotasks();
  assert.equal(harness.requests.length, 4);
  assert.equal(harness.requests[3].url, 'http://127.0.0.1:3335/api/settings/v2');
  assert.deepEqual(JSON.parse(harness.requests[3].init.body), {
    expectedRevision: 1,
    patch: { theme: 'locally-edited' },
  });
});

await testAsync('a settings load admitted before recovery cannot overwrite its committed snapshot', async () => {
  const staleLoad = deferred();
  const committedSettings = {};
  const harness = settingsBackupHarness({
    initialSettings: { theme: 'current' },
    responses: [
      ({ context }) => staleLoad.promise.then(body => ({
        ok: true,
        status: 200,
        async json() {
          return vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(body))})`, context);
        },
      })),
      { ok: true, status: 200, body: { revision: 1, settings: { theme: 'current' } } },
      { ok: true, status: 200, body: settingsPolicyReadFixture() },
      {
        ok: true,
        status: 200,
        body: settingsResetCommitFixture({
          settings: committedSettings,
        }),
      },
      { ok: true, status: 200, body: { features: { agents: true } } },
      { ok: true, status: 200, body: { revision: 3, settings: committedSettings } },
    ],
  });

  const load = harness.functions.loadConfig(null, true);
  await drainMicrotasks();
  assert.equal(harness.requests.length, 1);
  const featureRequest = harness.waitForRequest('http://127.0.0.1:3335/api/features');
  const reset = harness.functions.resetAll();
  await featureRequest;
  assert.equal(harness.requests.length, 5);
  assert.equal((await reset).success, true);
  assert.deepEqual(harness.settings(), committedSettings);

  staleLoad.resolve({ revision: 1, settings: { theme: 'stale-load' } });
  assert.equal(await load, false);
  assert.deepEqual(harness.settings(), committedSettings);
  assert.equal(harness.functions.state().mutationState, 'COMMITTED');

  harness.functions.saveConfig();
  const saveTimer = harness.timers.find(timer => timer.delay === 500 && !timer.cancelled);
  assert.ok(saveTimer);
  saveTimer.callback();
  await drainMicrotasks();
  assert.equal(harness.requests.length, 6);
  assert.deepEqual(JSON.parse(harness.requests[5].init.body), {
    expectedRevision: 2,
    patch: committedSettings,
  });
});

await testAsync('the rendered Backup panel wires exact endpoints and reports FileReader failures', async () => {
  const exportHarness = settingsBackupHarness({
    responses: [{ ok: true, status: 200, body: { ok: true, backup: settingsBackupFixture() } }],
  });
  const exportButton = findRenderedElement(exportHarness.functions.renderBackup(), 'button', 'Exportovat přenosné předvolby');
  assert.ok(exportButton);
  exportButton.props.onClick();
  await drainMicrotasks();
  assert.equal(exportHarness.requests[0].url, 'http://127.0.0.1:3335/api/settings/backup');
  assert.equal(exportHarness.downloads.length, 1);

  const resetHarness = settingsBackupHarness({
    responses: settingsResetResponses({
      ok: true,
      status: 200,
      body: settingsResetCommitFixture(),
    }),
  });
  const resetButton = findRenderedElement(resetHarness.functions.renderBackup(), 'button', 'Resetovat serverová nastavení');
  assert.ok(resetButton);
  const resetRequest = resetHarness.waitForRequest('http://127.0.0.1:3335/api/settings/reset');
  resetButton.props.onClick();
  assert.equal(
    (await resetRequest).url,
    'http://127.0.0.1:3335/api/settings/reset',
  );

  const validReader = controlledFileReaderClass();
  const importHarness = settingsBackupHarness({
    FileReaderClass: validReader.ControlledFileReader,
    responses: [{
      ok: true,
      status: 200,
      body: settingsImportCommitFixture({
        settings: settingsPortableGeneralSettings(),
      }),
    }],
  });
  const importButton = findRenderedElement(importHarness.functions.renderBackup(), 'button', 'Importovat přenosné předvolby');
  assert.ok(importButton);
  importButton.props.onClick();
  assert.equal(importHarness.fileInputs.length, 1);
  importHarness.fileInputs[0].onchange({ target: { files: [{ name: 'portable.json' }] } });
  assert.equal(validReader.readers.length, 1);
  validReader.readers[0].onload({ target: { result: JSON.stringify(settingsBackupFixture()) } });
  await drainMicrotasks();
  assert.equal(importHarness.requests[0].url, 'http://127.0.0.1:3335/api/settings/import');
  assert.deepEqual(importHarness.settings(), settingsPortableGeneralSettings());

  for (const outcome of ['onerror', 'onabort']) {
    const controlled = controlledFileReaderClass();
    const failureHarness = settingsBackupHarness({ FileReaderClass: controlled.ControlledFileReader });
    const button = findRenderedElement(failureHarness.functions.renderBackup(), 'button', 'Importovat přenosné předvolby');
    button.props.onClick();
    failureHarness.fileInputs[0].onchange({ target: { files: [{ name: 'unreadable.json' }] } });
    assert.equal(typeof controlled.readers[0][outcome], 'function');
    controlled.readers[0][outcome]();
    assert.equal(failureHarness.requests.length, 0);
    assert.equal(failureHarness.status().ok, false);
    assert.match(failureHarness.status().text, outcome === 'onerror' ? /nepodařilo přečíst/ : /bylo zrušeno/);
  }
});

await testAsync('Webhook Security status is exact GET-only and malformed responses fail closed', async () => {
  const successCases = [
    {
      body: { configured: true, source: 'PROCESS_ENV' },
      configuredText: 'Stav: Nastaven',
      sourceText: 'Procesní prostředí (PROCESS_ENV)',
    },
    {
      body: { source: 'PROCESS_ENV', configured: false },
      configuredText: 'Stav: Nenastaven',
      sourceText: 'Procesní prostředí (PROCESS_ENV)',
    },
    {
      body: { configured: true, source: 'ROOT_ENV_FILE' },
      configuredText: 'Stav: Nastaven',
      sourceText: 'Kořenový .env soubor (ROOT_ENV_FILE)',
    },
    {
      body: { configured: false, source: 'ROOT_ENV_FILE' },
      configuredText: 'Stav: Nenastaven',
      sourceText: 'Kořenový .env soubor (ROOT_ENV_FILE)',
    },
  ];

  for (const fixture of successCases) {
    const harness = webhookSecurityHarness({
      responses: [{ ok: true, status: 200, body: fixture.body }],
    });
    assert.equal(await harness.functions.loadWebhook(), true);
    assert.equal(harness.requests.length, 1);
    assert.equal(harness.requests[0].url, 'http://127.0.0.1:3335/api/security/webhook-secret');
    assert.equal(harness.requests[0].init.method, undefined);
    assert.equal(Object.hasOwn(harness.requests[0].init, 'body'), false);
    assert.deepEqual(hostClone(harness.functions.state()), {
      phase: 'READY',
      configured: fixture.body.configured,
      source: fixture.body.source,
    });

    const rendered = harness.functions.renderSecurity();
    const text = renderedText(rendered);
    assert.match(text, new RegExp(fixture.configuredText));
    assert.match(text, new RegExp(fixture.sourceText.replace(/[().]/g, '\\$&')));
    assert.match(text, /spravuje operátor/);
    assert.match(text, /restartu serveru/);
    assert.equal(findRenderedElement(rendered, 'button', 'Regenerovat'), null);
    assert.deepEqual(harness.effects, { clipboard: 0, confirm: 0, prompt: 0 });
    assert.equal(harness.requests.length, 1, 'READY render repeated the status request');
  }

  const invalidCases = [
    { ok: false, status: 500, body: { configured: true, source: 'PROCESS_ENV' } },
    { ok: true, status: 201, body: { configured: true, source: 'PROCESS_ENV' } },
    { ok: true, status: 200, jsonError: new Error('malformed JSON') },
    { ok: true, status: 200, body: { configured: true } },
    {
      ok: true,
      status: 200,
      body: { configured: true, source: 'PROCESS_ENV', masked: 'MASKED_SECRET_CANARY' },
    },
    { ok: true, status: 200, body: { configured: 'true', source: 'PROCESS_ENV' } },
    { ok: true, status: 200, body: { configured: true, source: null } },
    { ok: true, status: 200, body: { configured: true, source: 'DATABASE' } },
    new Error('network unavailable'),
  ];

  for (const response of invalidCases) {
    const harness = webhookSecurityHarness({ responses: [response] });
    assert.equal(await harness.functions.loadWebhook(), false);
    assert.equal(harness.requests.length, 1);
    assert.deepEqual(hostClone(harness.functions.state()), {
      phase: 'ERROR',
    });

    const firstRender = harness.functions.renderSecurity();
    const secondRender = harness.functions.renderSecurity();
    const text = renderedText(firstRender);
    assert.match(text, /Stav webhook secretu není dostupný/);
    assert.doesNotMatch(text, /Stav: Nastaven|Stav: Nenastaven|PROCESS_ENV|ROOT_ENV_FILE/);
    assert.doesNotMatch(text, /MASKED_SECRET_CANARY/);
    assert.equal(findRenderedElement(firstRender, 'button', 'Regenerovat'), null);
    assert.equal(findRenderedElement(secondRender, 'button', 'Regenerovat'), null);
    assert.equal(harness.requests.length, 1, 'ERROR render retried the status request');
    assert.equal(
      harness.requests.some(request => request.init.method === 'POST'),
      false,
    );
    assert.deepEqual(harness.effects, { clipboard: 0, confirm: 0, prompt: 0 });
  }
});

suite('M1 first-party portable settings consumers');

test('backend, authoritative Studio panel, Center Views, and Architect pin one exact profile', () => {
  const expected = [...SETTINGS_PORTABLE_PATHS];
  assert.deepEqual(hostClone(settingsBackupHarness().functions.portablePaths), expected);
  assert.deepEqual(hostClone(architectSettingsHarness().functions.portablePaths), expected);
  assert.deepEqual(hostClone(centerViewsSettingsHarness().functions.portablePaths), expected);
});

await testAsync('one real backend commit is accepted by every first-party portable settings consumer', async () => {
  const backend = portableSettingsBackendHarness();
  try {
    const backup = settingsBackupFixture({
      settingsProjection: {
        profile: 'UX_PREFERENCES_V1',
        values: {
          '/appearance/theme': 'light',
          '/c3.language': 'en',
        },
      },
    });
    const committed = await backend.importBackup(backup);
    assert.equal(committed.status, 200);
    assert.equal(committed.body.sourceSchemaVersion, 2);
    assert.deepEqual(committed.body.appliedPortablePaths, ['/appearance/theme', '/c3.language']);
    assert.equal(committed.body.policy.lastEventId, committed.body.event.eventId);

    const chatPanel = settingsBackupHarness({
      responses: [{ ok: true, status: 200, body: committed.body }],
    });
    assert.equal(
      (await chatPanel.functions.importJson(JSON.stringify(backup), 'real-backend.json')).success,
      true,
    );

    const architect = architectSettingsHarness({
      responses: [{ ok: true, status: 200, body: committed.body }],
    });
    architect.functions.importSettings();
    await architect.fileInputs[0].onchange({
      target: { files: [{ text: async () => JSON.stringify(backup) }] },
    });
    assert.equal(architect.functions.state(), 'IDLE');
    assert.equal(architect.functions.snapshot().appearance.theme, 'light');

    const center = centerViewsSettingsHarness({
      responses: [
        { ok: true, status: 200, body: { revision: 1, settings: {} } },
        { ok: true, status: 200, body: committed.body },
      ],
    });
    center.functions.importSettings.call(center.widget);
    await center.fileInputs[0].onchange({
      target: { files: [{ text: async () => JSON.stringify(backup) }] },
    });
    assert.equal(center.widget._portableSettingsMutationState, 'IDLE');
    assert.match(center.alerts.at(-1), /imported successfully/);
  } finally {
    backend.close();
  }
});

await testAsync('Architect exports only the validated v2 artifact and rejects injected paths', async () => {
  const backup = settingsBackupFixture();
  const successful = architectSettingsHarness({
    initialSettings: {
      appearance: { theme: 'dark' },
      notifications: { telegramToken: 'ARCHITECT_LOCAL_SECRET_CANARY' },
    },
    responses: [{ ok: true, status: 200, body: { ok: true, backup } }],
  });
  await successful.functions.exportSettings();
  assert.equal(successful.requests.length, 1);
  assert.equal(successful.requests[0].url, '/api/settings/backup');
  assert.equal(successful.downloads.length, 1);
  const encoded = await successful.downloads[0].blob.text();
  assert.deepEqual(JSON.parse(encoded), backup);
  assert.equal(encoded.includes('ARCHITECT_LOCAL_SECRET_CANARY'), false);
  assert.match(successful.downloads[0].download, /^intentsmith-preferences-\d{4}-\d{2}-\d{2}\.json$/);

  const injected = settingsBackupFixture({
    settingsProjection: {
      profile: 'UX_PREFERENCES_V1',
      values: {
        ...settingsBackupFixture().settingsProjection.values,
        '/notifications/telegramToken': 'SERVER_LEAK_CANARY',
      },
    },
  });
  const rejected = architectSettingsHarness({
    responses: [{ ok: true, status: 200, body: { ok: true, backup: injected } }],
  });
  await rejected.functions.exportSettings();
  assert.equal(rejected.downloads.length, 0);
  assert.equal(rejected.toasts.at(-1).type, 'error');
});

await testAsync('Architect import adopts redacted state, fences ambiguity, and applies offline receipt', async () => {
  const committed = {
    appearance: { theme: 'light', accentColor: '#6366f1', fontFamily: 'system', fontSize: 14 },
    output: { defaultFormat: 'markdown', codeStyle: 'default', namingConvention: 'camelCase' },
    'c3.language': 'en',
    'c3.output.codeBlocks': false,
    'c3.output.markdownRendering': false,
    'c3.output.syntaxHighlight': false,
  };
  const successful = architectSettingsHarness({
    initialSettings: {
      appearance: { theme: 'dark', staleCanary: 'STALE_APPEARANCE' },
      notifications: { telegramToken: 'STALE_TOKEN' },
      futureTopLevelCanary: 'STALE_FUTURE',
    },
    localStorage: { paiass_settings: JSON.stringify({ notifications: { telegramToken: 'STALE_TOKEN' } }) },
    responses: [
      {
        ok: true,
        status: 200,
        body: settingsImportCommitFixture({
          settings: committed,
          sourceSchemaVersion: 1,
          appliedPortablePaths: ['/appearance/theme'],
          preservedLocalPathCount: 1,
        }),
      },
      {
        ok: true,
        status: 200,
        body: {
          revision: 3,
          settings: {
            ...committed,
            appearance: { ...committed.appearance, theme: 'system' },
          },
        },
      },
    ],
  });
  successful.functions.importSettings();
  assert.equal(successful.fileInputs.length, 1);
  await successful.fileInputs[0].onchange({
    target: { files: [{ text: async () => JSON.stringify({ appearance: { theme: 'light' } }) }] },
  });
  assert.equal(successful.requests[0].url, '/api/settings/import');
  assert.equal(successful.requests[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(successful.requests[0].init.body), {
    backup: {
      kind: 'INTENTSMITH_SETTINGS_BACKUP',
      schemaVersion: 1,
      generalSettings: { appearance: { theme: 'light' } },
      modelAutomationPolicy: null,
      omittedSensitiveKeys: [],
    },
    expectedRevision: 1,
  });
  const committedSnapshot = hostClone(successful.functions.snapshot());
  assert.equal(committedSnapshot.appearance.theme, 'light');
  assert.equal(committedSnapshot.appearance.staleCanary, 'STALE_APPEARANCE');
  assert.equal(committedSnapshot.notifications.telegramToken, 'STALE_TOKEN');
  assert.equal(committedSnapshot.location.language, 'en');
  assert.equal(committedSnapshot['c3.output.codeBlocks'], undefined);
  assert.equal(committedSnapshot['c3.output.markdownRendering'], undefined);
  assert.equal(committedSnapshot['c3.output.syntaxHighlight'], undefined);
  assert.equal(committedSnapshot.futureTopLevelCanary, 'STALE_FUTURE');
  assert.equal(successful.functions.prototypeState().globalPolluted, false);
  assert.equal(successful.functions.prototypeState().rootPrototypeSafe, true);
  assert.equal(successful.functions.prototypeState().appearancePrototypeSafe, true);
  assert.equal(successful.storage.has('paiass_settings'), true);
  assert.equal(successful.functions.state(), 'IDLE');

  successful.functions.setTheme('system');
  assert.equal(await successful.functions.saveSettings(), 'COMMITTED');
  assert.equal(successful.requests[1].url, '/api/settings/v2');
  assert.equal(successful.requests[1].init.method, 'PUT');
  assert.deepEqual(JSON.parse(successful.requests[1].init.body), {
    expectedRevision: 2,
    patch: { appearance: { theme: 'system' } },
  });
  assert.equal(({}).architectPolluted, undefined);

  const ambiguous = architectSettingsHarness({
    responses: [new Error('connection ended'), new Error('reload also failed')],
  });
  ambiguous.functions.importSettings();
  await ambiguous.fileInputs[0].onchange({
    target: { files: [{ text: async () => JSON.stringify(settingsBackupFixture()) }] },
  });
  assert.equal(ambiguous.functions.state(), 'DELIVERY_UNKNOWN');
  assert.equal(await ambiguous.functions.saveSettings(), 'BLOCKED');
  assert.equal(ambiguous.requests.length, 2, 'delivery-unknown state admitted a replay or write');

  const legacyPreimage = JSON.stringify({
    appearance: { theme: 'dark' },
    notifications: {
      channels: { inapp: true },
      emailAddresses: ['private@example.invalid'],
      telegramToken: 'PRIVATE_TELEGRAM_TOKEN',
      telegramChatId: 'keep-unselected',
      futureNotificationCanary: { keep: true },
    },
    futureTopLevelCanary: ['keep', 1],
  }, null, 2);
  const legacyFixture = legacyCredentialReceiptFixture(legacyPreimage, [
    'notifications.emailAddresses',
    'notifications.telegramToken',
  ]);
  const receiptHarness = architectSettingsHarness({
    localStorage: {
      paiass_settings: legacyPreimage,
      'c3-settings': 'C3_SETTINGS_MUST_NOT_CHANGE',
    },
  });
  assert.deepEqual(
    hostClone(receiptHarness.functions.legacyCredentialPaths),
    LEGACY_CREDENTIAL_RECEIPT_PATHS,
  );
  const appliedReceipt = await receiptHarness.functions.architectApplyLegacyCredentialReceipt(
    receiptHarness.contextValue(legacyFixture.receipt),
  );
  assert.deepEqual(hostClone(appliedReceipt), { ok: true, state: 'APPLIED', code: null });
  assert.equal(receiptHarness.storage.get('paiass_settings'), legacyFixture.postimage);
  assert.equal(receiptHarness.storage.get('c3-settings'), 'C3_SETTINGS_MUST_NOT_CHANGE');
  assert.deepEqual(receiptHarness.storageEffects.set, [{
    key: 'paiass_settings',
    value: legacyFixture.postimage,
  }]);
  assert.deepEqual(receiptHarness.storageEffects.get, [
    'paiass_settings',
    'paiass_settings',
    'paiass_settings',
  ]);
  assert.deepEqual(receiptHarness.storageEffects.remove, []);
  assert.deepEqual(receiptHarness.requests, []);
  assert.deepEqual(receiptHarness.downloads, []);
  const scrubbedLegacy = JSON.parse(receiptHarness.storage.get('paiass_settings'));
  assert.equal(Object.hasOwn(scrubbedLegacy.notifications, 'emailAddresses'), false);
  assert.equal(Object.hasOwn(scrubbedLegacy.notifications, 'telegramToken'), false);
  assert.equal(scrubbedLegacy.notifications.telegramChatId, 'keep-unselected');
  assert.deepEqual(scrubbedLegacy.notifications.futureNotificationCanary, { keep: true });
  assert.deepEqual(scrubbedLegacy.futureTopLevelCanary, ['keep', 1]);
  assert.equal(receiptHarness.legacyReceiptStatus.textContent, 'APPLIED');

  const idempotentReceipt = await receiptHarness.functions.architectApplyLegacyCredentialReceipt(
    receiptHarness.contextValue(legacyFixture.receipt),
  );
  assert.deepEqual(
    hostClone(idempotentReceipt),
    { ok: true, state: 'ALREADY_APPLIED', code: null },
  );
  assert.equal(receiptHarness.storageEffects.set.length, 1);
  receiptHarness.functions.importLegacyCredentialReceipt();
  assert.equal(receiptHarness.fileInputs.length, 1);
  assert.equal(receiptHarness.fileInputs[0].type, 'file');
  assert.equal(receiptHarness.fileInputs[0].accept, '.json,application/json');
  assert.equal(receiptHarness.fileInputs[0].clicked, true);
  await receiptHarness.fileInputs[0].onchange({
    target: { files: [{ text: async () => JSON.stringify(legacyFixture.receipt) }] },
  });
  assert.equal(receiptHarness.storageEffects.set.length, 1);
  assert.equal(receiptHarness.toasts.at(-1).message, 'ALREADY_APPLIED');
  assert.equal(receiptHarness.requests.length, 0);
  assert.equal(
    receiptHarness.storageEffects.get.every(key => key === 'paiass_settings'),
    true,
  );
  assert.equal(
    JSON.stringify(receiptHarness.toasts).includes('PRIVATE_TELEGRAM_TOKEN'),
    false,
  );
  assert.equal(
    JSON.stringify(receiptHarness.toasts).includes('private@example.invalid'),
    false,
  );

  const exportFixture = legacyCredentialReceiptFixture(
    legacyPreimage,
    ['notifications.telegramToken'],
    'EXPORT',
  );
  const exportHarness = architectSettingsHarness({
    localStorage: { paiass_settings: legacyPreimage },
  });
  assert.equal(
    (await exportHarness.functions.architectApplyLegacyCredentialReceipt(
      exportHarness.contextValue(exportFixture.receipt),
    )).state,
    'APPLIED',
  );
  assert.equal(exportHarness.storage.get('paiass_settings'), exportFixture.postimage);
  assert.equal(exportHarness.storageEffects.set.length, 1);

  const forgedPostimageReceipt = hostClone(legacyFixture.receipt);
  forgedPostimageReceipt.preimageSha256 = '1'.repeat(64);
  forgedPostimageReceipt.postimageSha256 = legacyCredentialSha256(legacyPreimage);
  const forgedPostimageHarness = architectSettingsHarness({
    localStorage: { paiass_settings: legacyPreimage },
  });
  assert.equal(
    (await forgedPostimageHarness.functions.architectApplyLegacyCredentialReceipt(
      forgedPostimageHarness.contextValue(forgedPostimageReceipt),
    )).code,
    'LEGACY_RECEIPT_STALE',
  );
  assert.equal(forgedPostimageHarness.storage.get('paiass_settings'), legacyPreimage);
  assert.equal(forgedPostimageHarness.storageEffects.set.length, 0);

  const idempotentRaceHarness = architectSettingsHarness({
    localStorage: { paiass_settings: legacyFixture.postimage },
    storageMutationOnDigestCall: 1,
    storageMutationValue: legacyPreimage,
  });
  assert.equal(
    (await idempotentRaceHarness.functions.architectApplyLegacyCredentialReceipt(
      idempotentRaceHarness.contextValue(legacyFixture.receipt),
    )).code,
    'LEGACY_RECEIPT_STALE',
  );
  assert.equal(idempotentRaceHarness.storage.get('paiass_settings'), legacyPreimage);
  assert.equal(idempotentRaceHarness.storageEffects.set.length, 0);

  const invalidReceiptCases = [
    {
      name: 'extra-key',
      mutate(receipt) { receipt.extra = true; },
      code: 'LEGACY_RECEIPT_INVALID',
    },
    {
      name: 'wrong-schema',
      mutate(receipt) { receipt.schema = 'INTENTSMITH_LEGACY_CREDENTIAL_RECEIPT/V2'; },
      code: 'LEGACY_RECEIPT_INVALID',
    },
    {
      name: 'wrong-action',
      mutate(receipt) { receipt.action = 'TRANSFER'; },
      code: 'LEGACY_RECEIPT_INVALID',
    },
    {
      name: 'purge-export-digest-forbidden',
      mutate(receipt) { receipt.exportSha256 = '1'.repeat(64); },
      code: 'LEGACY_RECEIPT_INVALID',
    },
    {
      name: 'empty-path-digests',
      mutate(receipt) { receipt.pathDigests = []; },
      code: 'LEGACY_RECEIPT_INVALID',
    },
    {
      name: 'path-digest-extra-key',
      mutate(receipt) { receipt.pathDigests[0].extra = true; },
      code: 'LEGACY_RECEIPT_INVALID',
    },
    {
      name: 'unknown-path',
      mutate(receipt) { receipt.pathDigests[0].path = 'notifications.unknown'; },
      code: 'LEGACY_RECEIPT_INVALID',
    },
    {
      name: 'wrong-source',
      mutate(receipt) { receipt.source = 'C3_SETTINGS'; },
      code: 'LEGACY_RECEIPT_INVALID',
    },
    {
      name: 'duplicate-path',
      mutate(receipt) { receipt.pathDigests[1].path = receipt.pathDigests[0].path; },
      code: 'LEGACY_RECEIPT_INVALID',
    },
    {
      name: 'unsorted-path',
      mutate(receipt) { receipt.pathDigests.reverse(); },
      code: 'LEGACY_RECEIPT_INVALID',
    },
    {
      name: 'uppercase-digest',
      mutate(receipt) { receipt.preimageSha256 = 'A'.repeat(64); },
      code: 'LEGACY_RECEIPT_INVALID',
    },
    {
      name: 'equal-preimage-postimage',
      mutate(receipt) { receipt.postimageSha256 = receipt.preimageSha256; },
      code: 'LEGACY_RECEIPT_INVALID',
    },
    {
      name: 'path-digest',
      mutate(receipt) { receipt.pathDigests[0].valueSha256 = '0'.repeat(64); },
      code: 'LEGACY_RECEIPT_PATH_DIGEST_MISMATCH',
    },
    {
      name: 'postimage-digest',
      mutate(receipt) { receipt.postimageSha256 = '0'.repeat(64); },
      code: 'LEGACY_RECEIPT_POSTIMAGE_MISMATCH',
    },
    {
      name: 'export-digest-missing',
      mutate(receipt) { receipt.action = 'EXPORT'; },
      code: 'LEGACY_RECEIPT_INVALID',
    },
  ];
  for (const invalidCase of invalidReceiptCases) {
    const receipt = hostClone(legacyFixture.receipt);
    invalidCase.mutate(receipt);
    const harness = architectSettingsHarness({
      localStorage: { paiass_settings: legacyPreimage },
    });
    const result = await harness.functions.architectApplyLegacyCredentialReceipt(
      harness.contextValue(receipt),
    );
    assert.deepEqual(
      hostClone(result),
      { ok: false, state: 'FAILED', code: invalidCase.code },
      invalidCase.name,
    );
    assert.equal(harness.storage.get('paiass_settings'), legacyPreimage, invalidCase.name);
    assert.equal(harness.storageEffects.set.length, 0, invalidCase.name);
    assert.equal(harness.requests.length, 0, invalidCase.name);
  }

  const staleHarness = architectSettingsHarness({
    localStorage: { paiass_settings: `${legacyPreimage}\n` },
  });
  assert.equal(
    (await staleHarness.functions.architectApplyLegacyCredentialReceipt(
      staleHarness.contextValue(legacyFixture.receipt),
    )).code,
    'LEGACY_RECEIPT_STALE',
  );
  assert.equal(staleHarness.storageEffects.set.length, 0);

  const malformedHarness = architectSettingsHarness({
    localStorage: { paiass_settings: '{"notifications":' },
  });
  assert.equal(
    (await malformedHarness.functions.architectApplyLegacyCredentialReceipt(
      malformedHarness.contextValue(legacyFixture.receipt),
    )).code,
    'LEGACY_RECEIPT_SOURCE_INVALID',
  );
  assert.equal(malformedHarness.storageEffects.set.length, 0);

  const missingPathRaw = JSON.stringify({
    notifications: { telegramChatId: 'unselected' },
  });
  const missingPathReceipt = hostClone(legacyFixture.receipt);
  missingPathReceipt.preimageSha256 = legacyCredentialSha256(missingPathRaw);
  const missingPathHarness = architectSettingsHarness({
    localStorage: { paiass_settings: missingPathRaw },
  });
  assert.equal(
    (await missingPathHarness.functions.architectApplyLegacyCredentialReceipt(
      missingPathHarness.contextValue(missingPathReceipt),
    )).code,
    'LEGACY_RECEIPT_PATH_MISSING',
  );
  assert.equal(missingPathHarness.storageEffects.set.length, 0);

  const missingSourceHarness = architectSettingsHarness();
  assert.equal(
    (await missingSourceHarness.functions.architectApplyLegacyCredentialReceipt(
      missingSourceHarness.contextValue(legacyFixture.receipt),
    )).code,
    'LEGACY_RECEIPT_SOURCE_MISSING',
  );
  assert.equal(missingSourceHarness.storageEffects.set.length, 0);

  const readFailure = architectSettingsHarness({
    localStorage: { paiass_settings: legacyPreimage },
    storageReadThrowOnCall: 1,
  });
  assert.equal(
    (await readFailure.functions.architectApplyLegacyCredentialReceipt(
      readFailure.contextValue(legacyFixture.receipt),
    )).code,
    'LEGACY_RECEIPT_STORAGE_READ_FAILED',
  );
  assert.equal(readFailure.storageEffects.set.length, 0);

  const prewriteReadFailure = architectSettingsHarness({
    localStorage: { paiass_settings: legacyPreimage },
    storageReadThrowOnCall: 2,
  });
  assert.equal(
    (await prewriteReadFailure.functions.architectApplyLegacyCredentialReceipt(
      prewriteReadFailure.contextValue(legacyFixture.receipt),
    )).code,
    'LEGACY_RECEIPT_STALE',
  );
  assert.equal(prewriteReadFailure.storage.get('paiass_settings'), legacyPreimage);
  assert.equal(prewriteReadFailure.storageEffects.set.length, 0);

  const writeFailure = architectSettingsHarness({
    localStorage: { paiass_settings: legacyPreimage },
    storageWriteThrows: true,
  });
  assert.equal(
    (await writeFailure.functions.architectApplyLegacyCredentialReceipt(
      writeFailure.contextValue(legacyFixture.receipt),
    )).code,
    'LEGACY_RECEIPT_STORAGE_WRITE_FAILED',
  );
  assert.equal(writeFailure.storage.get('paiass_settings'), legacyPreimage);
  assert.equal(writeFailure.storageEffects.set.length, 1);

  const readbackFailure = architectSettingsHarness({
    localStorage: { paiass_settings: legacyPreimage },
    storageReadbackValue: 'READBACK_MISMATCH',
  });
  assert.equal(
    (await readbackFailure.functions.architectApplyLegacyCredentialReceipt(
      readbackFailure.contextValue(legacyFixture.receipt),
    )).code,
    'LEGACY_RECEIPT_READBACK_FAILED',
  );
  assert.equal(readbackFailure.storageEffects.set.length, 1);
  assert.deepEqual(readbackFailure.storageEffects.remove, []);

  const readbackReadFailure = architectSettingsHarness({
    localStorage: { paiass_settings: legacyPreimage },
    storageReadThrowOnCall: 3,
  });
  assert.equal(
    (await readbackReadFailure.functions.architectApplyLegacyCredentialReceipt(
      readbackReadFailure.contextValue(legacyFixture.receipt),
    )).code,
    'LEGACY_RECEIPT_READBACK_FAILED',
  );
  assert.equal(readbackReadFailure.storageEffects.set.length, 1);
  assert.deepEqual(readbackReadFailure.storageEffects.remove, []);

  const foreignRaceBytes = '{"foreign":"writer-won"}';
  const mutationDuringDigest = architectSettingsHarness({
    localStorage: { paiass_settings: legacyPreimage },
    storageMutationOnDigestCall: 4,
    storageMutationValue: foreignRaceBytes,
  });
  assert.equal(
    (await mutationDuringDigest.functions.architectApplyLegacyCredentialReceipt(
      mutationDuringDigest.contextValue(legacyFixture.receipt),
    )).code,
    'LEGACY_RECEIPT_STALE',
  );
  assert.equal(mutationDuringDigest.storage.get('paiass_settings'), foreignRaceBytes);
  assert.equal(mutationDuringDigest.storageEffects.set.length, 0);
  assert.deepEqual(mutationDuringDigest.storageEffects.remove, []);

  const fileFailure = architectSettingsHarness({
    localStorage: { paiass_settings: legacyPreimage },
  });
  fileFailure.functions.importLegacyCredentialReceipt();
  await fileFailure.fileInputs[0].onchange({
    target: { files: [{ text: async () => '{' }] },
  });
  assert.equal(fileFailure.functions.legacyReceiptState(), 'FAILED');
  assert.equal(fileFailure.toasts.at(-1).message, 'LEGACY_RECEIPT_FILE_INVALID');
  assert.equal(fileFailure.storage.get('paiass_settings'), legacyPreimage);
  assert.equal(fileFailure.storageEffects.set.length, 0);

  const fileReadFailure = architectSettingsHarness({
    localStorage: { paiass_settings: legacyPreimage },
  });
  fileReadFailure.functions.importLegacyCredentialReceipt();
  await fileReadFailure.fileInputs[0].onchange({
    target: { files: [{ text: async () => { throw new Error('raw file failure'); } }] },
  });
  assert.equal(fileReadFailure.functions.legacyReceiptState(), 'FAILED');
  assert.equal(fileReadFailure.toasts.at(-1).message, 'LEGACY_RECEIPT_FILE_INVALID');
  assert.equal(fileReadFailure.storage.get('paiass_settings'), legacyPreimage);
  assert.equal(fileReadFailure.storageEffects.set.length, 0);

  const architectSource = fs.readFileSync(ARCHITECT_UI, 'utf8');
  const receiptSlice = architectSource.slice(
    architectSource.indexOf('const ARCHITECT_LEGACY_CREDENTIAL_RECEIPT_SCHEMA'),
    architectSource.indexOf('// ACCORDION', architectSource.indexOf(
      'const ARCHITECT_LEGACY_CREDENTIAL_RECEIPT_SCHEMA',
    )),
  );
  assert.match(receiptSlice, /localStorage\.getItem\(ARCHITECT_LEGACY_CREDENTIAL_STORAGE_KEY\)/);
  assert.match(receiptSlice, /localStorage\.setItem\(/);
  assert.doesNotMatch(
    receiptSlice,
    /c3-settings|localStorage\.(?:clear|removeItem)|fetch\(|WebSocket|clipboard|window\.open|Blob|createObjectURL|downloadJSON|console\./,
  );
  const architectHtml = fs.readFileSync(new URL('../src/ui/architect/architect.html', import.meta.url), 'utf8');
  assert.match(architectHtml, /onclick="importLegacyCredentialReceipt\(\)"/);
  assert.match(architectHtml, /id="legacy-credential-receipt-status" data-state="READY">READY</);
});

await testAsync('Architect settings reset requires an exact commit and false factory reset has no effect', async () => {
  const harness = architectSettingsHarness({
    initialSettings: {
      appearance: { theme: 'light', staleCanary: 'RESET_STALE_APPEARANCE' },
      notifications: { telegramToken: 'RESET_STALE_TOKEN' },
      futureTopLevelCanary: 'RESET_STALE_FUTURE',
    },
    localStorage: {
      paiass_settings: '{"appearance":{"theme":"stale"}}',
      paiass_accordion_state: '["system"]',
      foreign_key: 'PRESERVE_FOREIGN',
    },
    responses: [
      { ok: true, status: 200, body: { revision: 1, settings: {} } },
      { ok: true, status: 200, body: settingsPolicyReadFixture() },
      { ok: true, status: 200, body: settingsResetCommitFixture() },
    ],
  });
  await harness.functions.resetSettings();
  assert.equal(harness.requests.length, 3);
  assert.deepEqual(harness.requests.map(request => request.url), [
    '/api/settings/v2',
    '/api/system/models/settings',
    '/api/settings/reset',
  ]);
  assert.equal(harness.requests[2].init.method, 'POST');
  assert.deepEqual(JSON.parse(harness.requests[2].init.body), {
    scope: 'SERVER_SETTINGS_V1',
    expectedRevision: 1,
    expectedPolicyRevision: 1,
  });
  assert.equal(harness.storage.has('paiass_settings'), false);
  assert.equal(harness.storage.has('paiass_accordion_state'), true);
  assert.equal(harness.storage.get('foreign_key'), 'PRESERVE_FOREIGN');
  assert.deepEqual(harness.storageEffects.remove, ['paiass_settings']);
  assert.equal(harness.functions.state(), 'IDLE');
  assert.equal(harness.functions.snapshot().appearance.theme, 'dark');
  assert.equal(harness.functions.snapshot().notifications.telegramToken, 'RESET_STALE_TOKEN');
  assert.equal(harness.functions.snapshot().futureTopLevelCanary, 'RESET_STALE_FUTURE');

  harness.functions.resetAll();
  assert.equal(harness.requests.length, 3, 'false factory reset performed an HTTP effect');
  assert.match(harness.toasts.at(-1).title, /Úplné smazání není dostupné/);

  assert.equal(await harness.functions.saveSettings(), 'SESSION_ONLY');
  assert.equal(harness.requests.length, 3, 'session-only fields escaped after reset');

  for (const failure of [
    { storageRemoveThrowOnCall: 1 },
    { applySettingsThrowOnCall: 2 },
  ]) {
    const degraded = architectSettingsHarness({
      ...failure,
      localStorage: {
        paiass_settings: 'REMOVE_ONLY_THIS',
        paiass_accordion_state: '["system"]',
        foreign_key: 'PRESERVE_FOREIGN',
      },
      responses: [
        { ok: true, status: 200, body: { revision: 1, settings: {} } },
        { ok: true, status: 200, body: settingsPolicyReadFixture() },
        { ok: true, status: 200, body: settingsResetCommitFixture() },
      ],
    });
    await degraded.functions.resetSettings();
    assert.equal(degraded.functions.state(), 'LOCAL_DEGRADED');
    assert.equal(degraded.functions.resetState().localPhase, 'DEGRADED');
    assert.equal(degraded.confirmations.length, 1);
    assert.equal(degraded.requests.filter(request => request.init.method === 'POST').length, 1);
    const localRetry = degraded.functions.resetSettings();
    const joinedRetry = degraded.functions.resetSettings();
    assert.equal(await localRetry, true);
    assert.equal(await joinedRetry, true);
    assert.equal(degraded.functions.state(), 'IDLE');
    assert.equal(degraded.functions.resetState().localPhase, 'COMPLETE');
    assert.equal(degraded.confirmations.length, 1, 'local retries requested a new server-reset confirmation');
    assert.equal(degraded.requests.length, 3, 'local retry performed a server request');
    assert.equal(degraded.requests.filter(request => request.init.method === 'POST').length, 1);
    assert.equal(degraded.storageEffects.remove.length, 2, 'concurrent local retry did not join one operation');
    assert.equal(degraded.storage.has('paiass_settings'), false);
    assert.equal(degraded.storage.has('paiass_accordion_state'), true);
    assert.equal(degraded.storage.get('foreign_key'), 'PRESERVE_FOREIGN');
  }
});

await testAsync('Architect rejects a nonempty or nondefault reset commit', async () => {
  const exactReset = settingsResetCommitFixture();
  for (const body of [
    settingsResetCommitFixture({ settings: { appearance: { theme: 'light' } } }),
    settingsResetCommitFixture({ revision: 3 }),
    settingsResetCommitFixture({ policy: { ...exactReset.policy, revision: 3 } }),
    settingsResetCommitFixture({
      policy: { ...exactReset.policy, autoCleanupEnabled: true },
    }),
  ]) {
    const harness = architectSettingsHarness({
      initialSettings: { appearance: { theme: 'system' } },
      localStorage: {
        paiass_settings: 'PRESERVE_BEFORE_RECEIPT',
        paiass_accordion_state: '["system"]',
      },
      responses: [
        { ok: true, status: 200, body: { revision: 1, settings: { appearance: { theme: 'system' } } } },
        { ok: true, status: 200, body: settingsPolicyReadFixture() },
        { ok: true, status: 200, body },
        { ok: true, status: 200, body: { revision: 1, settings: { appearance: { theme: 'system' } } } },
      ],
    });
    await harness.functions.resetSettings();
    assert.equal(harness.functions.state(), 'IDLE');
    assert.equal(harness.functions.snapshot().appearance.theme, 'system');
    assert.equal(harness.storage.get('paiass_settings'), 'PRESERVE_BEFORE_RECEIPT');
    assert.deepEqual(harness.storageEffects.remove, []);
    assert.equal(harness.requests.filter(request => request.init.method === 'POST').length, 1);
  }
});

await testAsync('Architect recovery revokes an older settings read before it can resurrect state', async () => {
  const staleLoad = deferred();
  const harness = architectSettingsHarness({
    initialSettings: { appearance: { theme: 'system' } },
    responses: [
      ({ context }) => staleLoad.promise.then(body => ({
        ok: true,
        status: 200,
        async json() {
          return vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(body))})`, context);
        },
      })),
      { ok: true, status: 200, body: { revision: 1, settings: { appearance: { theme: 'system' } } } },
      { ok: true, status: 200, body: settingsPolicyReadFixture() },
      { ok: true, status: 200, body: settingsResetCommitFixture() },
    ],
  });

  const load = harness.functions.loadSettings();
  await drainMicrotasks();
  assert.equal(harness.requests[0].url, '/api/settings/v2');
  await harness.functions.resetSettings();
  assert.equal(harness.functions.snapshot().appearance.theme, 'dark');

  staleLoad.resolve({
    revision: 1,
    settings: { appearance: { theme: 'light' }, staleTopLevelCanary: 'STALE_LOAD' },
  });
  assert.equal(await load, false);
  assert.equal(harness.functions.snapshot().appearance.theme, 'dark');
  assert.equal(harness.functions.snapshot().staleTopLevelCanary, undefined);
  assert.equal(harness.functions.state(), 'IDLE');
});

await testAsync('Architect keeps an authoritative server read when rendering throws', async () => {
  const harness = architectSettingsHarness({
    applySettingsThrowOnCall: 2,
    initialSettings: { appearance: { theme: 'dark' } },
    localStorage: {
      paiass_settings: JSON.stringify({
        appearance: { theme: 'system' },
        staleTopLevelCanary: 'STALE_LOCAL_FALLBACK',
      }),
    },
    responses: [{
      ok: true,
      status: 200,
      body: {
        revision: 2,
        settings: { appearance: { theme: 'light' }, serverTopLevelCanary: 'IGNORED_SERVER' },
      },
    }],
  });

  assert.equal(await harness.functions.loadSettings(), false);
  assert.equal(harness.functions.snapshot().appearance.theme, 'light');
  assert.equal(harness.functions.snapshot().serverTopLevelCanary, undefined);
  assert.equal(harness.functions.snapshot().staleTopLevelCanary, undefined);
  assert.equal(harness.storage.has('paiass_settings'), true);
});

await testAsync('Center Views uses canonical backup/import endpoints and never WS key replay', async () => {
  const backup = settingsBackupFixture();
  const committed = settingsImportCommitFixture({
    settings: { appearance: { theme: 'light' } },
    sourceSchemaVersion: 1,
    appliedPortablePaths: ['/appearance/theme'],
  });
  const harness = centerViewsSettingsHarness({
    responses: [
      { ok: true, status: 200, body: { ok: true, backup } },
      { ok: true, status: 200, body: { revision: 1, settings: {} } },
      { ok: true, status: 200, body: committed },
    ],
  });
  await harness.functions.exportSettings.call(harness.widget);
  assert.equal(harness.requests[0].url, '/api/settings/backup');
  assert.equal(harness.downloads.length, 1);
  assert.deepEqual(JSON.parse(await harness.downloads[0].blob.text()), backup);

  harness.functions.importSettings.call(harness.widget);
  assert.equal(harness.fileInputs.length, 1);
  await harness.fileInputs[0].onchange({
    target: { files: [{ text: async () => JSON.stringify(settingsBackupV1Fixture()) }] },
  });
  assert.equal(harness.requests[1].url, '/api/settings/v2');
  assert.equal(harness.requests[2].url, '/api/settings/import');
  assert.equal(harness.requests[2].init.method, 'POST');
  assert.deepEqual(JSON.parse(harness.requests[2].init.body), {
    backup: settingsBackupV1Fixture(),
    expectedRevision: 1,
  });
  assert.equal(harness.widget._portableSettingsMutationState, 'IDLE');
  assert.match(harness.alerts.at(-1), /imported successfully/);

  await harness.functions.exportAll.call(harness.widget);
  assert.equal(harness.requests.length, 3, 'disabled full backup caused an HTTP effect');
  assert.match(harness.alerts.at(-1), /Full-state backup is not available/);

  const invalid = centerViewsSettingsHarness();
  invalid.functions.importSettings.call(invalid.widget);
  await invalid.fileInputs[0].onchange({
    target: {
      files: [{
        text: async () => JSON.stringify(settingsBackupFixture({
          settingsProjection: {
            profile: 'UX_PREFERENCES_V1',
            values: {
              ...settingsBackupFixture().settingsProjection.values,
              '/system/ollamaUrl': 'http://attacker.invalid',
            },
          },
        })),
      }],
    },
  });
  assert.equal(invalid.requests.length, 0);
  assert.equal(invalid.widget._portableSettingsMutationState, 'IDLE');

  const ambiguous = centerViewsSettingsHarness({
    responses: [
      { ok: true, status: 200, body: { revision: 1, settings: {} } },
      new Error('connection ended'),
    ],
  });
  ambiguous.functions.importSettings.call(ambiguous.widget);
  await ambiguous.fileInputs[0].onchange({
    target: { files: [{ text: async () => JSON.stringify(backup) }] },
  });
  assert.equal(ambiguous.requests.length, 2);
  assert.equal(ambiguous.widget._portableSettingsMutationState, 'DELIVERY_UNKNOWN');
  assert.match(ambiguous.alerts.at(-1), /outcome is unknown/);

  const conflict = centerViewsSettingsHarness({
    responses: [
      { ok: true, status: 200, body: { revision: 1, settings: {} } },
      {
        ok: false,
        status: 409,
        body: {
          code: 'USER_SETTINGS_REVISION_CONFLICT',
          expectedRevision: 1,
          currentRevision: 2,
        },
      },
    ],
  });
  conflict.functions.importSettings.call(conflict.widget);
  await conflict.fileInputs[0].onchange({
    target: { files: [{ text: async () => JSON.stringify(backup) }] },
  });
  assert.equal(conflict.requests.length, 2, 'Center replayed a revision conflict');
  assert.equal(conflict.widget._portableSettingsMutationState, 'RELOAD_REQUIRED');
  assert.match(conflict.alerts.at(-1), /was not retried/);
});

test('active first-party UI source no longer contains the raw export/import bypasses', () => {
  const architect = fs.readFileSync(ARCHITECT_UI, 'utf8');
  const architectExport = architect.slice(
    architect.indexOf('async function exportSettings()'),
    architect.indexOf('function downloadJSON', architect.indexOf('async function exportSettings()')),
  );
  assert.match(architectExport, /\/api\/settings\/backup/);
  assert.match(architectExport, /\/api\/settings\/import/);
  assert.doesNotMatch(architectExport, /JSON\.stringify\(settingsState/);
  assert.doesNotMatch(architectExport, /Object\.assign\(settingsState/);

  const center = fs.readFileSync(CENTER_VIEWS, 'utf8');
  const centerBackup = center.slice(
    center.indexOf('  async _exportSettings()'),
    center.indexOf('  // ─── v63.0: Wizard Methods', center.indexOf('  async _exportSettings()')),
  );
  assert.match(centerBackup, /\/api\/settings\/backup/);
  assert.match(centerBackup, /\/api\/settings\/import/);
  assert.doesNotMatch(centerBackup, /\/api\/system\/info/);
  assert.doesNotMatch(centerBackup, /syncSettings/);
});

summary();
