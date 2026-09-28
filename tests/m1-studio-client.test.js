#!/usr/bin/env node
import { execFileSync as runStudio2BehaviorTests } from 'node:child_process';

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
import { createLegacyLocalCapability } from '../src/security/legacy-local-access-policy.js';
import { createSessionAdapter } from '../src/ws-bridge/session-adapter.js';
import {
  M1_ATTACHMENT_IMAGE_TYPES,
  createM1AttachmentLimits,
  validateM1Attachments,
} from '../src/ws-bridge/m1-attachment-policy.js';
import { attachWebSocketServer } from '../src/ws-bridge/ws-server.js';

const require = createRequire(import.meta.url);
const WorkActivity = require('../intentsmith-ide/extensions/intentsmith-chat-panel/lib/browser/work-activity.js');
const {
  REQUIRED_BUNDLE_MARKERS,
  REQUIRED_ELECTRON_MAIN_MARKERS,
  REQUIRED_CONSUMER_FUNCTIONS,
  REQUIRED_PRELOAD_MARKERS,
  REQUIRED_PROTOCOL_FUNCTIONS,
  assertRegularFile,
  probeConsumerRuntime,
  runCli,
  validateBundleSource,
  validateElectronMainSource,
  validateConsumerRuntime,
  validatePreloadSource,
  validateProtocolRuntime,
  validateSidebarComposition,
} = require('../intentsmith-ide/scripts/verify-m1-consumer-build.js');

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
]);
const CANONICAL_PRELOAD_MARKERS = Object.freeze([
  'electronIntentSmith',
  'pickAttachmentFiles',
  'readAttachmentBytes',
  'M1_BRIDGE_ITEM_TOO_LARGE',
]);
const CANONICAL_BUNDLE_MARKERS = Object.freeze([
  'Generated @intentsmith/protocol M1 runtime is unavailable',
  'm1-wire-v1',
  'core-event-stream-limit',
  'DELIVERY_UNKNOWN',
  'CONVERSATION_BUSY',
  'M1_CONNECTION_REPLACED',
  '__intentSmithLegacyLocalFetchV1',
]);
const CANONICAL_ELECTRON_MAIN_MARKERS = Object.freeze([
  'x-intentsmith-local-capability',
  'sec-fetch-site',
  'http://127.0.0.1/*',
  'http://localhost/*',
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
  '../intentsmith-ide/extensions/intentsmith-chat-panel/lib/browser/ws-client.js',
  import.meta.url,
);


const ANDROID_LIFECYCLE = new URL(
  './lifecycle-android-app-e2e.test.js',
  import.meta.url,
);
const AGENT_CLIENT = new URL(
  '../intentsmith-ide/extensions/intentsmith-chat-panel/lib/browser/agent-client.js',
  import.meta.url,
);
const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));
const STUDIO_PACKAGE = new URL('../intentsmith-ide/package.json', import.meta.url);
const PROTOCOL_PACKAGE = new URL(
  '../intentsmith-ide/extensions/intentsmith-protocol/package.json',
  import.meta.url,
);
const PROTOCOL_INDEX = new URL(
  '../intentsmith-ide/extensions/intentsmith-protocol/src/index.ts',
  import.meta.url,
);

suite('M1 Studio client — generated protocol delivery');

test('protocol lib is ignored generated output with no tracked stale stub', () => {
  const tracked = execFileSync(
    'git',
    ['ls-files', '--', 'intentsmith-ide/extensions/intentsmith-protocol/lib'],
    { cwd: REPOSITORY_ROOT, encoding: 'utf8' },
  ).trim();
  assert.equal(tracked, '');

  const ignoredBy = execFileSync(
    'git',
    ['check-ignore', '-v', 'intentsmith-ide/extensions/intentsmith-protocol/lib/runtime-probe.js'],
    { cwd: REPOSITORY_ROOT, encoding: 'utf8' },
  );
  assert.match(
    ignoredBy,
    /\.gitignore:\d+:intentsmith-ide\/extensions\/intentsmith-protocol\/lib\//,
  );
});

test('root Studio build and watch share one protocol preparation contract', () => {
  const studio = JSON.parse(fs.readFileSync(STUDIO_PACKAGE, 'utf8'));
  assert.equal(
    studio.scripts['clean:protocol'],
    'yarn workspace @intentsmith/protocol clean',
  );
  assert.equal(
    studio.scripts['prepare:protocol'],
    'yarn run clean:protocol && yarn workspace @intentsmith/protocol build --force && yarn run verify:protocol-runtime',
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



test('required Android T3 portfolio preflight fails when any exact model is missing', () => {
  const source = fs.readFileSync(ANDROID_LIFECYCLE, 'utf8');
  const start = source.indexOf('async function checkOllama()');
  const end = source.indexOf('// ─── Real LLM Executor', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const preflight = source.slice(start, end);
  assert.match(preflight, /const found = models\.includes\(req\)/);
  assert.match(preflight, /if \(!found\) missing\.push\(req\)/);
  assert.match(preflight, /return missing\.length === 0/);
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
  assert.deepEqual([...REQUIRED_PRELOAD_MARKERS], [...CANONICAL_PRELOAD_MARKERS]);
  assert.deepEqual([...REQUIRED_ELECTRON_MAIN_MARKERS], [...CANONICAL_ELECTRON_MAIN_MARKERS]);
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

test('postbuild guard rejects an Electron main bundle without local Origin protection', () => {
  const complete = CANONICAL_ELECTRON_MAIN_MARKERS.join('\n');
  assert.doesNotThrow(() => validateElectronMainSource(complete));
  assert.throws(() => validateElectronMainSource(''), /Electron main bundle is empty/);
  for (const marker of CANONICAL_ELECTRON_MAIN_MARKERS) {
    const incomplete = CANONICAL_ELECTRON_MAIN_MARKERS.filter(item => item !== marker).join('\n');
    assert.throws(() => validateElectronMainSource(incomplete), /missing local Origin marker/);
  }
});

test('postbuild guard rejects a preload bundle that lost the byte bridge', () => {
  const complete = CANONICAL_PRELOAD_MARKERS.join('\n');
  assert.doesNotThrow(() => validatePreloadSource(complete));
  assert.throws(() => validatePreloadSource(''), /preload bundle is empty/);
  assert.throws(() => validatePreloadSource(null), /preload bundle is empty/);

  /* The failure this catches is a preload that builds and starts perfectly and
     is missing only the bridge — the app looks healthy and every attachment
     picked from the dialog quietly loses its bytes. */
  for (const marker of CANONICAL_PRELOAD_MARKERS) {
    const incomplete = CANONICAL_PRELOAD_MARKERS
      .filter(candidate => candidate !== marker)
      .join('\n');
    assert.throws(
      () => validatePreloadSource(incomplete),
      new RegExp(`missing byte bridge marker: ${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    );
  }
});

test('postbuild refuses the duplicate sidebar in either manifest or generated frontend', () => {
  const manifest = { dependencies: { '@intentsmith-ide/intentsmith-studio2': '0.1.0' } };
  const frontend = "await load(container, require('@intentsmith-ide/intentsmith-studio2/lib/browser/studio2-module'));";
  assert.doesNotThrow(() => validateSidebarComposition(manifest, frontend));
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    assert.throws(() => validateSidebarComposition({ ...manifest,
      [section]: { ...manifest[section], '@intentsmith-ide/intentsmith-sidebar': '*' },
    }, frontend), /legacy duplicate sidebar/);
  }
  assert.throws(() => validateSidebarComposition(manifest,
    frontend + "require('@intentsmith-ide/intentsmith-sidebar/lib/browser/sidebar-module');"), /legacy duplicate sidebar/);
  assert.throws(() => validateSidebarComposition({}, frontend), /sidebar owner.*missing/);
  assert.throws(() => validateSidebarComposition(manifest, ''), /missing the current sidebar/);
});







test('the shipped preload bundle really carries the byte bridge', () => {
  /* lib/ is a build artifact, so this only asserts when a build is present:
     the tracked source guard above is what runs on a fresh clone. */
  const built = new URL('../intentsmith-ide/applications/electron/lib/frontend/preload.js', import.meta.url);
  if (!fs.existsSync(built)) return;
  assert.doesNotThrow(() => validatePreloadSource(fs.readFileSync(built, 'utf8')));
});

test('postbuild CLI composes exact paths and byte-level evidence', () => {
  withOwnedPostbuildRoot(studioRoot => {
    const protocolBytes = Buffer.from('module.exports = {};\n');
    const consumerBytes = Buffer.from('module.exports = {};\n// consumer\n');
    const bundleBytes = Buffer.from(`${CANONICAL_BUNDLE_MARKERS.join('\n')}\nžluťoučký\n`);
    const preloadBytes = Buffer.from(`${CANONICAL_PRELOAD_MARKERS.join('\n')}\n`);
    const mainBytes = Buffer.from(`${CANONICAL_ELECTRON_MAIN_MARKERS.join('\n')}\n`);
    const ripgrepBytes = Buffer.from('ripgrep-fixture');
    const manifestBytes = Buffer.from(JSON.stringify({ dependencies: { '@intentsmith-ide/intentsmith-studio2': '0.1.0' } }));
    const frontendBytes = Buffer.from("await load(container, require('@intentsmith-ide/intentsmith-studio2/lib/browser/studio2-module'));\n");
    writePostbuildFile(studioRoot, 'applications/electron/package.json', manifestBytes);
    writePostbuildFile(studioRoot, 'applications/electron/src-gen/frontend/index.js', frontendBytes);
    writePostbuildFile(
      studioRoot,
      'extensions/intentsmith-protocol/lib/index.js',
      protocolBytes,
    );
    writePostbuildFile(
      studioRoot,
      'extensions/intentsmith-chat-panel/lib/browser/ws-client.js',
      consumerBytes,
    );
    writePostbuildFile(
      studioRoot,
      'applications/electron/lib/frontend/bundle.js',
      bundleBytes,
    );
    writePostbuildFile(
      studioRoot,
      'applications/electron/lib/frontend/preload.js',
      preloadBytes,
    );
    writePostbuildFile(studioRoot, 'applications/electron/lib/backend/electron-main.js', mainBytes);
    const ripgrepPath = writePostbuildFile(studioRoot, 'applications/electron/lib/backend/native/rg', ripgrepBytes);
    fs.chmodSync(ripgrepPath, 0o755);

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
      applicationManifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
      frontendEntrySha256: createHash('sha256').update(frontendBytes).digest('hex'),
      bundleBytes: bundleBytes.length,
      bundleSha256: createHash('sha256').update(bundleBytes).digest('hex'),
      preloadBytes: preloadBytes.length,
      preloadSha256: createHash('sha256').update(preloadBytes).digest('hex'),
      mainBytes: mainBytes.length,
      mainSha256: createHash('sha256').update(mainBytes).digest('hex'),
      ripgrepBytes: ripgrepBytes.length,
      ripgrepSha256: createHash('sha256').update(ripgrepBytes).digest('hex'),
      consumerBytes: consumerBytes.length,
      consumerSha256: createHash('sha256').update(consumerBytes).digest('hex'),
      protocolBytes: protocolBytes.length,
      protocolSha256: createHash('sha256').update(protocolBytes).digest('hex'),
      protocolVersion: 1,
    });
    writePostbuildFile(studioRoot, 'applications/electron/lib/frontend/bundle.js',
      Buffer.concat([bundleBytes, Buffer.from('[IntentSmith] SidebarWidget created')]));
    const staleExit = runCli({ studioRoot, protocol: validPostbuildProtocol(),
      consumer: validPostbuildConsumer(), stdout: { write() {} },
      stderr: { write(value) { stderr += value; } } });
    assert.equal(staleExit, 1);
    assert.match(stderr, /production bundle contains the legacy duplicate sidebar/);
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
    IntentSmithBus: {
      emit(name, payload) {
        busEvents.push({ name, payload });
        if (typeof options.onBusEmit === 'function') options.onBusEmit(name, payload);
      },
    },
    Date,
    JSON,
    Math,
    WebSocket: HarnessWebSocket,
    _backendUrl: () => backendBase,
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
      assert.equal(specifier, '@intentsmith/protocol');
      return TEST_M1_PROTOCOL;
    },
    setInterval: () => Symbol('interval'),
    setTimeout: options.setTimeout || (() => Symbol('timeout')),
    window: {
      electronIntentSmith: {
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
    socket.onmessage({
      data: JSON.stringify({
        type: 'hello_ack',
        protocolVersion: 1,
        serverVersion: 'test',
        features,
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



function controlledFileReaderClass() {
  const readers = [];
  class ControlledFileReader {
    constructor() {
      readers.push(this);
    }
    readAsText(file) {
      this.file = file;
    }
  }
  return { ControlledFileReader, readers };
}

async function finishControlledReader(reader, outcome = 'load') {
  reader.result = outcome === 'load' ? 'attachment contents' : null;
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



function agentStateHarness(sessions = []) {
  const listeners = Object.create(null);
  const busEvents = [];
  const context = vm.createContext({
    AbortSignal,
    IntentSmithBus: {
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

    durableDb = new Database(process.env.INTENTSMITH_DB_PATH);
    durableDb.exec('CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY)');
    const insertConversation = durableDb.prepare('INSERT OR IGNORE INTO conversations (id) VALUES (?)');
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



suite('M1 Studio client — fail-closed send authority');

























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

test('explicit reconnect renews the retry budget after exhaustion without replaying user requests', () => {
  const clock = controlledTimers();
  const { client, socket, sockets } = loadClient([session()], {
    autoHandshake:false, clearTimeout:clock.clearTimeout, setTimeout:clock.setTimeout,
  });
  socket.readyState=1;socket.onopen();socket.close();
  for(let i=0;i<12;i++) {clock.run(clock.active()[0]);const s=sockets.at(-1);s.readyState=1;s.onopen();s.close();}
  assert.equal(clock.active().length,0);
  client.wsReconnect();
  assert.equal(sockets.length,14);
  const current=sockets.at(-1);current.readyState=1;current.onopen();current.close();
  assert.equal(clock.active()[0].delay,1000);
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



// ── Decision 022/A — operation-bound recovery in the Studio client ─────────
//
// The dangerous skew direction is a new bundle against an older server or a
// replayed event: the panel must then warn and never offer an action it cannot
// bind to one operation.



const COMPLETE_EVENT = Object.freeze({
  role: 'CHAT',
  model: 'fixture-target',
  operationId: 'operation-0123456789abcdef',
  committedBindingRevision: 4,
  failedAttemptRevision: 3,
  text: 'Varování',
});













test('the clear event reaches the panel through the WS consumer', () => {
  const consumer = fs.readFileSync(
    new URL('../intentsmith-ide/extensions/intentsmith-chat-panel/lib/browser/ws-client.js', import.meta.url),
    'utf8',
  );
  // Without this edge the bounded clear event would never arrive and a stale
  // warning could stay on screen over a re-verified binding.
  assert.match(
    consumer,
    /d\.action === 'upgrade_verify_cleared'[\s\S]{0,80}IntentSmithBus\.emit\('upgrade:verify_cleared', d\)/,
  );
});




await testAsync('a turn needing the legacy shell effect ends as a typed error, not ok', async () => {
  // Decision 021/R2 variant A. The legacy adapter fire-and-forgets
  // handleTerminal() on metadata.shellCommand. That effect has no M1
  // command/result authority, no approval ledger and no single terminal, so the
  // negotiated path must refuse instead of returning ok while silently doing
  // nothing — that would claim a parity the connector cannot deliver.
  const harness = crossBoundaryHarness(async () => ({
    response: 'Spouštím git status',
    mode: 'conversation',
    confidence: 1,
    metadata: { shellCommand: 'git status' },
  }), 'cross-boundary-shell-effect');
  try {
    harness.pane._projectId = 'project-cross-boundary-shell';
    assert.equal(harness.client.wsSendChat('spusť git status', harness.pane, 0), true);
    const frame = harness.frames().at(-1);
    assert.ok(frame);
    await harness.adapter.processM1Command(frame.data);

    const events = harness.serverMessages
      .filter(message => message.data?.requestId === frame.data.command.requestId)
      .map(message => message.data);
    assert.equal(validateCoreEventStream(events).valid, true);
    assert.equal(events.at(-1).terminalStatus, 'error');

    const terminal = harness.busEvents.find(event => (
      event.name === 'chat:terminal'
      && event.payload.requestId === frame.data.command.requestId
    ));
    assert.equal(terminal.payload.status, 'error');
    assert.equal(terminal.payload.result.error.code, 'M1_EFFECT_AUTHORITY_REQUIRED');
    // Exactly one terminal, and the refusal never claims success.
    assert.equal(
      events.filter(event => typeof event.terminalStatus === 'string').length,
      1,
    );
    assertCanonicalCrossBoundaryMessages(harness.serverMessages, harness.busEvents);
  } finally {
    harness.cleanup();
  }
});


// ── Decision 021/R1-B — bounded inline-only attachments ───────────────────

function clientAttachmentPolicy() {
  const source = fs.readFileSync(
    new URL('../intentsmith-ide/extensions/intentsmith-chat-panel/lib/browser/ws-client.js', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('var _M1_IMAGE_TYPES');
  const end = source.indexOf('/* 021/R1-B: map the panel', start);
  assert.ok(start >= 0 && end > start, 'client policy block is present');
  const context = vm.createContext({ TextEncoder, module: { exports: {} } });
  vm.runInContext(
    'var _MAX_TEXT_SIZE=1024*1024;var _MAX_IMG_SIZE=5*1024*1024;'
    + source.slice(start, end)
    + '\nmodule.exports={validateM1Attachments,_m1AttachmentLimits};',
    context,
  );
  return context.module.exports;
}

function base64Image(bytes, mime = 'image/png') {
  return `data:${mime};base64,${Buffer.alloc(bytes).toString('base64')}`;
}

const ATTACHMENT_CASES = [
  { label: 'PDF inline', input: [{name:'invoice.pdf',type:'application/pdf',content:base64Image(33000,'application/pdf')}],expect:true },
  { label: 'realistic 6715 KiB HEIC and PDF pair', input: [{name:'receipts.heic',type:'image/heic',content:base64Image(6715*1024,'image/heic')},{name:'invoice.pdf',type:'application/pdf',content:base64Image(33000,'application/pdf')}],expect:true },
  { label: 'document over ceiling', input: [{name:'large.heic',type:'image/heic',content:base64Image(10*1024*1024+1,'image/heic')}],expect:'M1_ATTACHMENT_ITEM_TOO_LARGE' },
  { label: 'invalid PDF bytes', input: [{name:'invoice.pdf',type:'application/pdf',content:'not a data URL'}],expect:'M1_ATTACHMENT_SHAPE_INVALID' },
  { label: 'truncated document base64', input: [{name:'invoice.pdf',type:'application/pdf',content:'data:application/pdf;base64,a'}],expect:'M1_ATTACHMENT_SHAPE_INVALID' },
  { label: 'empty collection', input: [], expect: true },
  {
    label: 'inline text',
    input: [{ name: 'a.txt', type: 'text/plain', content: 'ahoj' }],
    expect: true,
  },
  {
    label: 'empty string is legitimate content',
    input: [{ name: 'empty.txt', type: 'text/plain', content: '' }],
    expect: true,
  },
  {
    label: 'inline image',
    input: [{ name: 'a.png', type: 'image/png', content: base64Image(1024) }],
    expect: true,
  },
  {
    label: 'path present',
    input: [{ name: 'a.txt', type: 'text/plain', content: 'x', path: '/etc/passwd' }],
    expect: 'M1_ATTACHMENT_PATH_FORBIDDEN',
  },
  {
    label: 'path present even as null',
    input: [{ name: 'a.txt', type: 'text/plain', content: 'x', path: null }],
    expect: 'M1_ATTACHMENT_PATH_FORBIDDEN',
  },
  {
    label: 'missing content',
    input: [{ name: 'a.txt', type: 'text/plain' }],
    expect: 'M1_ATTACHMENT_SHAPE_INVALID',
  },
  {
    label: 'count over ceiling',
    input: Array.from({ length: 6 }, (_, index) => ({
      name: `f${index}.txt`, type: 'text/plain', content: 'x',
    })),
    expect: 'M1_ATTACHMENT_COUNT_EXCEEDED',
  },
  {
    label: 'unsupported binary type',
    input: [{ name: 'a.bin', type: 'application/octet-stream', content: 'x' }],
    expect: 'M1_ATTACHMENT_TYPE_UNSUPPORTED',
  },
  {
    label: 'text over its own ceiling',
    input: [{ name: 'big.txt', type: 'text/plain', content: 'a'.repeat(1024 * 1024 + 1) }],
    expect: 'M1_ATTACHMENT_ITEM_TOO_LARGE',
  },
  {
    label: 'image over its own ceiling',
    input: [{ name: 'big.png', type: 'image/png', content: base64Image(5 * 1024 * 1024 + 16) }],
    expect: 'M1_ATTACHMENT_ITEM_TOO_LARGE',
  },
  {
    label: 'aggregate over ceiling',
    input: [
      { name: 'i.png', type: 'image/png', content: base64Image(5 * 1024 * 1024) },
      { name: 'a.txt', type: 'text/plain', content: 'a'.repeat(1024 * 1024) },
      { name: 'b.txt', type: 'text/plain', content: 'b'.repeat(1024 * 1024) },
      { name: 'c.txt', type: 'text/plain', content: 'c'.repeat(1024 * 1024) },
      { name: 'd.txt', type: 'text/plain', content: 'd'.repeat(1024) },
    ],
    expect: 'M1_ATTACHMENT_AGGREGATE_TOO_LARGE',
  },
];

test('server and client attachment policy agree on every case', () => {
  const client = clientAttachmentPolicy();
  const serverLimits = createM1AttachmentLimits({
    maxTextAttachment: 1024 * 1024,
    maxImageAttachment: 5 * 1024 * 1024,
  });
  const clientLimits = client._m1AttachmentLimits();
  assert.equal(
    JSON.stringify(clientLimits),
    JSON.stringify(serverLimits),
    'both sides derive the same ceilings',
  );

  for (const testCase of ATTACHMENT_CASES) {
    const server = validateM1Attachments(testCase.input, serverLimits);
    const browser = client.validateM1Attachments(testCase.input, clientLimits);
    assert.equal(server.ok, browser.ok, `${testCase.label}: ok differs`);
    if (testCase.expect === true) {
      assert.equal(server.ok, true, `${testCase.label}: server rejected a legal set`);
    } else {
      assert.equal(server.code, testCase.expect, `${testCase.label}: server code`);
      assert.equal(browser.code, testCase.expect, `${testCase.label}: client code`);
    }
  }
});

test('an image is measured by decoded bytes, not by its data URL length', () => {
  // A 5 MiB image is ~6.7 MiB as base64. Measuring the string would reject a
  // legal image; measuring nothing would let an oversized one through.
  const content = base64Image(4 * 1024 * 1024);
  assert.ok(content.length > 5 * 1024 * 1024, 'the data URL really is larger than the payload');
  const verdict = validateM1Attachments(
    [{ name: 'a.png', type: 'image/png', content }],
    createM1AttachmentLimits({ maxImageAttachment: 5 * 1024 * 1024 }),
  );
  assert.equal(verdict.ok, true);
});


test('the WS server enforces a frame ceiling derived from the same seam', () => {
  const source = fs.readFileSync(
    new URL('../src/ws-bridge/ws-server.js', import.meta.url),
    'utf8',
  );
  // Before this, the project had no payload ceiling and the library default was
  // the only bound. The ceiling must come from the attachment seam, not a
  // second hand-written number that could drift away from it.
  assert.match(
    source,
    /maxPayload: createM1AttachmentLimits\(config\.limits \|\| \{\}\)\.maxFrameBytes/,
  );
  const limits = createM1AttachmentLimits({
    maxTextAttachment: 1024 * 1024,
    maxImageAttachment: 5 * 1024 * 1024,
  });
  assert.ok(
    limits.maxFrameBytes > limits.maxAggregateBytes,
    'the frame must be able to carry a full legal attachment set plus its command',
  );
});


suite('M1 Studio client — 021 attachment byte bridge');

/* The bridge is preload code: it runs with Node access on the other side of
   contextIsolation. Loading it directly is the honest test — nothing here needs
   Electron, because the dialog channel is the preload's business and the grant
   ledger is this module's. */
const { createAttachmentBridge, mediaTypeForName, clampCeiling, HARD_READ_CAP_BYTES, REJECTION } =
  require('../intentsmith-ide/applications/electron/intentsmith-attachment-bridge.js');

/* An fs double that counts reads, so "refused before allocating" is a fact the
   test can check rather than a claim the comment makes. */
function fakeFileSystem(files) {
  const calls = { open: 0, read: 0, stat: 0 };
  const open = new Map();
  let nextFd = 10;
  const statFor = (filePath) => {
    const entry = files.get(filePath);
    if (!entry) {
      const error = new Error(`ENOENT: ${filePath}`);
      error.code = 'ENOENT';
      throw error;
    }
    return {
      size: entry.directory ? 4096 : entry.bytes.length,
      mtimeMs: entry.mtimeMs === undefined ? 1000 : entry.mtimeMs,
      isFile: () => !entry.directory,
    };
  };
  return {
    calls,
    statSync(filePath) { calls.stat++; return statFor(filePath); },
    openSync(filePath) {
      calls.open++;
      statFor(filePath);
      const fd = nextFd++;
      open.set(fd, filePath);
      return fd;
    },
    fstatSync(fd) { calls.stat++; return statFor(open.get(fd)); },
    readSync(fd, buffer, offset, length, position) {
      calls.read++;
      const entry = files.get(open.get(fd));
      const chunk = entry.bytes.subarray(position, position + length);
      chunk.copy(buffer, offset);
      return chunk.length;
    },
    closeSync(fd) { open.delete(fd); },
  };
}

function bridgeHarness(entries, { start = 1_000_000 } = {}) {
  const files = new Map(entries);
  const fileSystem = fakeFileSystem(files);
  let clock = start;
  let counter = 0;
  const bridge = createAttachmentBridge({
    fileSystem,
    now: () => clock,
    randomToken: () => `tok-${++counter}`,
  });
  return {
    bridge,
    fileSystem,
    files,
    advance(ms) { clock += ms; },
  };
}

const HELLO = Buffer.from('ahoj světe', 'utf8');

test('a pick mints one single-use grant per regular file and never returns a path', () => {
  const { bridge } = bridgeHarness([
    ['/home/u/notes.txt', { bytes: HELLO }],
    ['/home/u/shot.png', { bytes: Buffer.alloc(64) }],
  ]);
  const picked = bridge.grantPaths(['/home/u/notes.txt', '/home/u/shot.png']);

  assert.equal(picked.files.length, 2);
  assert.equal(picked.directory, '/home/u', 'the next dialog can start where this one did');
  assert.deepEqual(
    picked.files.map(f => f.name),
    ['notes.txt', 'shot.png'],
  );
  assert.deepEqual(
    picked.files.map(f => f.type),
    ['text/plain', 'image/png'],
  );
  assert.equal(picked.files[0].size, HELLO.length, 'size comes from stat, not a placeholder');

  /* The whole point of the token: the renderer is handed no path in any field,
     under any name. A path anywhere here would hand back the read authority
     the design removed. */
  const serialized = JSON.stringify(picked);
  assert.ok(!serialized.includes('/home/u/notes.txt'), 'no file path crosses the bridge');
  assert.ok(!serialized.includes('/home/u/shot.png'), 'no file path crosses the bridge');
});

test('a granted token reads the real bytes exactly once', () => {
  const { bridge } = bridgeHarness([['/w/notes.txt', { bytes: HELLO }]]);
  const [file] = bridge.grantPaths(['/w/notes.txt']).files;

  const first = bridge.readTokenBytes(file.token, 1024 * 1024);
  assert.equal(first.ok, true);
  assert.equal(Buffer.from(first.bytes).toString('utf8'), 'ahoj světe');
  assert.equal(first.size, HELLO.length);

  /* One grant stands for one user gesture. Replaying the token would let a
     renderer re-read a file long after the dialog that authorized it. */
  const second = bridge.readTokenBytes(file.token, 1024 * 1024);
  assert.equal(second.ok, false);
  assert.equal(second.code, REJECTION.NO_TOKEN);
  assert.equal(bridge._grantCount(), 0, 'the ledger does not retain spent grants');
});

test('a token the bridge never minted buys nothing', () => {
  const { bridge } = bridgeHarness([['/w/secret', { bytes: HELLO }]]);
  const verdict = bridge.readTokenBytes('tok-1', 1024);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, REJECTION.NO_TOKEN);
});

test('a grant expires and its file cannot be read afterwards', () => {
  const harness = bridgeHarness([['/w/notes.txt', { bytes: HELLO }]]);
  const [file] = harness.bridge.grantPaths(['/w/notes.txt']).files;
  harness.advance(5 * 60 * 1000 + 1);

  const verdict = harness.bridge.readTokenBytes(file.token, 1024 * 1024);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, REJECTION.NO_TOKEN, 'the expired grant is swept, not merely refused');
  assert.equal(harness.fileSystem.calls.read, 0, 'an expired grant never touches the file');
});

test('an oversized file is refused from its stat, before a byte is read', () => {
  const { bridge, fileSystem } = bridgeHarness([
    ['/w/huge.txt', { bytes: Buffer.alloc(4 * 1024 * 1024) }],
  ]);
  const [file] = bridge.grantPaths(['/w/huge.txt']).files;

  const verdict = bridge.readTokenBytes(file.token, 1024 * 1024);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, REJECTION.TOO_LARGE);
  assert.equal(verdict.limit, 1024 * 1024);
  assert.equal(verdict.size, 4 * 1024 * 1024);
  /* This is the whole reason the ceiling lives at the read: the old shape would
     have moved 4 MiB into the renderer and only then discovered it was over. */
  assert.equal(fileSystem.calls.read, 0, 'the refusal costs a stat, not the file');
});

test('a file that grows between the pick and the read cannot outrun the ceiling', () => {
  const harness = bridgeHarness([['/w/grows.txt', { bytes: Buffer.alloc(512) }]]);
  const [file] = harness.bridge.grantPaths(['/w/grows.txt']).files;
  assert.equal(file.size, 512);

  harness.files.set('/w/grows.txt', { bytes: Buffer.alloc(8 * 1024) });
  const verdict = harness.bridge.readTokenBytes(file.token, 1024);
  assert.equal(verdict.ok, false);
  assert.equal(
    verdict.code,
    REJECTION.TOO_LARGE,
    'the size that binds is the one on the open descriptor, not the one from the dialog',
  );
});

test('a caller cannot raise the ceiling past the bridge hard cap', () => {
  assert.equal(clampCeiling(1024), 1024, 'a sane ceiling is honoured as given');
  assert.equal(clampCeiling(HARD_READ_CAP_BYTES * 4), HARD_READ_CAP_BYTES);
  assert.equal(clampCeiling(0), HARD_READ_CAP_BYTES, 'a missing ceiling falls back to the cap');
  assert.equal(clampCeiling(-1), HARD_READ_CAP_BYTES);
  assert.equal(clampCeiling(1.5), HARD_READ_CAP_BYTES);
  assert.ok(
    HARD_READ_CAP_BYTES > createM1AttachmentLimits({}).maxImageBytes,
    'the memory guard sits above the policy so it never becomes the real limit',
  );
});

test('directories and vanished paths are dropped at the pick rather than granted', () => {
  const { bridge } = bridgeHarness([
    ['/w/folder', { bytes: Buffer.alloc(0), directory: true }],
    ['/w/real.txt', { bytes: HELLO }],
  ]);
  const picked = bridge.grantPaths(['/w/folder', '/w/gone.txt', '', null, '/w/real.txt']);
  assert.deepEqual(picked.files.map(f => f.name), ['real.txt']);
  assert.equal(bridge._grantCount(), 1, 'only the readable file holds a grant');
});

test('the bridge reports only the media types the attachment policy accepts as images', () => {
  const imageTypes = new Set(M1_ATTACHMENT_IMAGE_TYPES);
  for (const name of ['a.png', 'a.jpg', 'a.jpeg', 'a.gif', 'a.webp']) {
    assert.ok(imageTypes.has(mediaTypeForName(name)), `${name} must be an image the policy knows`);
  }
  /* svg/bmp/ico/tiff/avif are image extensions the panel's own regex matches but
     the policy refuses. The bridge must name them accurately and let the policy
     refuse them — calling them text/plain would launder an SVG into a
     `data:text/plain;base64,...` item that is measured and delivered as text,
     while the same file dragged in is rejected. */
  for (const name of ['a.svg', 'a.bmp', 'a.ico', 'a.tiff', 'a.avif']) {
    const type = mediaTypeForName(name);
    assert.ok(!imageTypes.has(type), `${name} is not a policy image type`);
    assert.ok(type.startsWith('image/'), `${name} must still be named as an image, not laundered`);
    const verdict = validateM1Attachments(
      [{ name, type, content: base64Image(16, type) }],
      createM1AttachmentLimits({}),
    );
    assert.equal(
      verdict.code,
      'M1_ATTACHMENT_TYPE_UNSUPPORTED',
      `${name} must be refused the same way a dragged one is`,
    );
  }
  for (const name of ['a.txt', 'a.rs', 'noext']) {
    assert.ok(!imageTypes.has(mediaTypeForName(name)), `${name} must not claim to be an image`);
  }
  assert.equal(mediaTypeForName('a.json'), 'application/json');
  assert.equal(mediaTypeForName('a.PNG'), 'image/png', 'the extension test is case-insensitive');
});

/* ── Panel side ── */

/* The picker lives in the same authoritative slice as _readAttachments, so the
   round trip below is the real one: pick → File → FileReader → wire DTO. */


/* Node has no FileReader; this is the minimum of the Web API the panel uses. */
function nodeFileReaderClass() {
  return class NodeFileReader {
    readAsText(file) {
      file.text().then(text => {
        this.result = text;
        this.onload && this.onload();
      }, error => {
        this.error = error;
        this.onerror && this.onerror();
      });
    }

    readAsDataURL(file) {
      file.arrayBuffer().then(buffer => {
        this.result = `data:${file.type};base64,${Buffer.from(buffer).toString('base64')}`;
        this.onload && this.onload();
      }, error => {
        this.error = error;
        this.onerror && this.onerror();
      });
    }
  };
}

function pickAttachments(harness) {
  return new Promise(resolve => {
    harness.functions._chatPickAttachments(harness.st, harness.bridge, resolve);
  });
}



















test('the shipped preload exposes the byte bridge and no path-taking read', () => {
  const source = fs.readFileSync(
    new URL('../intentsmith-ide/applications/electron/intentsmith-preload.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /pickAttachmentFiles:/, 'the gesture-bound pick is exposed');
  assert.match(source, /readAttachmentBytes:/, 'the token-gated read is exposed');
  /* The failure this guards is a later "convenience" API that takes a path:
     that would hand the renderer back exactly the disk read authority the
     token indirection exists to withhold. */
  assert.ok(
    !/readFile|readAttachmentPath|readPath/.test(source),
    'no preload API reads a path the renderer supplies',
  );
});








suite('Studio transparent work activity');
test('turn-local activity ignores foreign events, duplicate steps and late progress after a terminal', () => {
  const a=WorkActivity.createActivity('turn-a','Pracuje',1000);
  assert.equal(WorkActivity.applyEvent(a,{turnId:'foreign',seq:1,type:'tool_call',payload:{tool:'read'}}),false);
  WorkActivity.applyEvent(a,{turnId:'turn-a',seq:1,type:'tool_call',payload:{tool:'read',callId:'a',args:{path:'a.js',apiKey:'SECRET'}}},1010);
  assert.doesNotMatch(a.steps[0].input,/SECRET/);
  assert.equal(WorkActivity.applyEvent(a,{turnId:'turn-a',seq:1,type:'tool_call',payload:{tool:'read'}}),false);
  WorkActivity.applyEvent(a,{turnId:'turn-a',seq:2,type:'turn_end',payload:{status:'ok'}},1020);
  assert.equal(a.status,'running','progress turn_end is not the M1 terminal');
  WorkActivity.finishActivity(a,'error',{},1030);
  assert.equal(a.status,'error');assert.equal(a.steps[0].status,'unconfirmed');
  WorkActivity.applyEvent(a,{turnId:'turn-a',seq:3,type:'tool_result',payload:{tool:'read',success:true}},1040);
  assert.equal(a.steps[0].status,'unconfirmed','late result cannot invent success');
});
test('tool result matches its call identity and preserves a failed result and zero duration', () => {
  const a=WorkActivity.createActivity('t','Pracuje',1000);
  for(const [seq,id] of [[1,'one'],[2,'two']])WorkActivity.applyEvent(a,{turnId:'t',seq,type:'tool_call',payload:{tool:'read',callId:id}},1000+seq);
  WorkActivity.applyEvent(a,{turnId:'t',seq:3,type:'tool_result',payload:{tool:'read',callId:'one',success:false,durationMs:0,summary:'file missing'}},1010);
  assert.equal(a.steps[0].status,'error');assert.equal(a.steps[0].durationMs,0);
  assert.equal(a.steps[0].output,'file missing');assert.equal(a.steps[1].status,'running');
});
test('activity is bounded and never displays model token/reasoning payloads', () => {
  const a=WorkActivity.createActivity('t','Pracuje');
  for(let seq=1;seq<=100;seq++)WorkActivity.applyEvent(a,{turnId:'t',seq,type:'system_step',payload:{step:'analyzing_input',detail:'x'.repeat(9000)}});
  WorkActivity.applyEvent(a,{turnId:'t',seq:101,type:'llm_token',payload:{token:'PRIVATE_REASONING'}});
  assert.equal(a.steps.length,80);assert.equal(a.omitted,20);assert.equal(a.steps[0].input.length,6000);
  assert.doesNotMatch(JSON.stringify(a),/PRIVATE_REASONING/);
});
test('question, approval, cancellation and timeout have distinct terminal presentation', () => {
  for(const [status,metadata,expected] of [['ok',{awaitingClarification:true},'question'],['ok',{webStatus:'pending'},'approval'],['cancelled',{},'cancelled'],['timeout',{},'timeout'],['ok',{},'done']]){
    const a=WorkActivity.createActivity('t','Pracuje');WorkActivity.finishActivity(a,status,metadata);
    assert.equal(a.status,expected);assert.ok(a.endedAt);
  }
});

test('line statistics count actual added and removed lines, including new files and newline-only changes', () => {
  for(const [before,after,added,removed] of [[null,'a\nb\n',2,0],['a\nb\nc\n','a\nB\nc\n',1,1],['a\n','',0,1],['','',0,0],['a\nb','a\nb',0,0],['a\nb\nc','a\nc',0,1],['a\na\n','a\n',0,1]]){
    const c=WorkActivity.lineCounts(before,after);assert.equal(c.added,added);assert.equal(c.removed,removed);
  }
  assert.equal(WorkActivity.lineCounts('a','a\n').newlineChanged,true);
  assert.equal(WorkActivity.lineCounts(undefined,'a'),null);
  assert.equal(WorkActivity.lineCounts('a\n'.repeat(2100),'b\n'.repeat(2100)),null,'large diff is unavailable, not a fabricated count');
});
test('prepared and failed M2 views cannot claim applied changes; success requires its canonical result', () => {
  const view={state:'awaiting_approval',lifecycleId:'l',diff:[{path:'a.js',before:{content:'old\n'},after:{content:'new\nsecond\n'}}]};
  const plan=WorkActivity.changeSummary(view);assert.equal(plan.applied,false);assert.deepEqual(plan.counts,{added:2,removed:1});
  assert.equal(WorkActivity.changeSummary({...view,state:'succeeded'}).applied,false);
  assert.equal(WorkActivity.changeSummary({...view,state:'succeeded',terminal:{state:'succeeded'},result:{terminalStatus:'succeeded'}}).applied,true);
  assert.equal(WorkActivity.changeSummary({...view,state:'failed',terminal:{state:'failed'},result:{terminalStatus:'failed'}}).applied,false);
});


// Active Studio 2 adapters replace source extraction from the retired React monolith.
test('m1-studio-client: active Studio 2 integration coverage', () => {
  const output = runStudio2BehaviorTests(process.execPath, ['--test', '--test-reporter=tap', 'tests/studio2-transport.test.js', 'tests/studio2-attachments.test.js', 'tests/studio2-session-store.test.js', 'tests/studio2-appearance.test.js', 'tests/studio2-model-workspace.test.js', 'tests/studio2-live-model.test.js', 'tests/studio2-conversation-view.test.js'], { cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 120000, env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
  if (!/# fail 0/.test(output)) throw new Error('Active Studio 2 tests did not complete: ' + output);
});
summary();
