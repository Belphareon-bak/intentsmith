#!/usr/bin/env node

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';

import { suite, test, testAsync, summary } from './harness.js';
import {
  CdpClient,
  actualPositiveBoundary,
  exactStudioPageTarget,
  observeSpawnCompletion,
  processGroupFromStat,
  runCleanupSequence,
  safeInheritedEnvironment,
  startModelProviderSentinel,
  successEvidence,
  theiaControlPlaneOriginFromEntrypoint,
  validateFunctional,
  validateSoakLifecycle,
} from './studio-electron-boundary.e2e.js';

const SHA = 'a'.repeat(40);
const DIGEST = 'b'.repeat(64);

function validFunctional(overrides = {}) {
  return {
    conversationCreated: true,
    sent: true,
    turnStarts: 1,
    creDecisions: 1,
    localDecisions: 1,
    unexpectedDecisions: 0,
    unexpectedAgentEvents: 0,
    assistantMessages: 1,
    turnEndsOk: 1,
    modelProviderRequestsDuringTurn: 0,
    forbiddenEffects: 0,
    errorSignals: 0,
    assistantMatches: true,
    assistantCorrelated: true,
    assistantModeValid: true,
    disconnected: false,
    orderValid: true,
    resultClass: 'terminal-idle',
    ...overrides,
  };
}

function validSoak(overrides = {}) {
  return {
    assistantMessages: 1,
    systemMessages: 0,
    disconnects: 0,
    turnStarts: 1,
    turnEnds: 1,
    creDecisions: 1,
    localDecisions: 1,
    unexpectedDecisions: 0,
    unexpectedAgentEvents: 0,
    forbiddenEffects: 0,
    agentErrors: 0,
    idleSignals: 1,
    ...overrides,
  };
}

function validSnapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    counts: {
      events: 20,
      protectedHttp: 1,
      websockets: 1,
      ignored: 0,
      malformed: 0,
      ambiguous: 0,
      orphaned: 0,
      externalAttempts: 0,
      otherLoopbackAttempts: 0,
      unsupportedNetworkAttempts: 0,
    },
    http: [{
      routeId: 'api-health',
      targetClass: 'protected',
      methodClass: 'GET',
      status: 200,
      statusClass: '2xx',
      terminalClass: 'response',
      originClass: 'opaque',
      fetchSiteClass: 'cross-site',
      capabilityClass: 'match',
      preflightClass: 'not-preflight',
      allowOriginClass: 'opaque',
      headerSource: 'extra-info',
      responseSource: 'extra-info',
      redirected: false,
      count: 1,
    }],
    websockets: [],
    externalByScheme: { http: 0, https: 0, ws: 0, wss: 0 },
    anomalies: [],
    ...overrides,
  };
}

function validExit(overrides = {}) {
  return {
    started: true,
    exitCode: 0,
    signal: null,
    requestedSignal: 'none',
    forced: false,
    processGroupClean: true,
    ...overrides,
  };
}

suite('Studio Electron runner — non-visual contract');

test('runner uses an explicit non-visual CDP surface and never observes UI state', () => {
  const source = fs.readFileSync(
    new URL('./studio-electron-boundary.e2e.js', import.meta.url),
    'utf8',
  );
  for (const forbidden of [
    'document.',
    'document.querySelector',
    'document.getElementById',
    'getComputedStyle',
    'innerText',
    'textContent',
    'Page.captureScreenshot',
    'Page.getLayoutMetrics',
    'DOM.enable',
    'CSS.enable',
    'Accessibility.enable',
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  const literalCdpMethods = [
    ...source.matchAll(/cdp\.send\('([^']+)'/g),
  ].map(match => match[1]);
  assert.deepEqual(
    [...new Set(literalCdpMethods)].sort(),
    [
      'Browser.close',
      'Network.enable',
      'Page.enable',
      'Page.navigate',
      'Runtime.enable',
      'Runtime.evaluate',
    ],
  );
  assert.match(source, /window\.C3WS/);
  assert.match(source, /window\.C3Bus/);
  assert.equal(source.includes('window._c3'), false);
  assert.equal(source.includes('sendChat'), false);
  assert.match(source, /window\.C3WS\.send\('chat'/);
  assert.match(source, /uiEvaluation: 'excluded-non-final-ui'/);
});

test('runner rechecks source revision and cleanliness before PASS evidence', () => {
  const source = fs.readFileSync(
    new URL('./studio-electron-boundary.e2e.js', import.meta.url),
    'utf8',
  );
  assert.equal(source.match(/await inspectSource\(\)/g)?.length, 2);
  assert.match(source, /source-revision-changed-during-run/);
  assert.match(
    source,
    /await inspectSource\(\)[\s\S]*await writePrivateJson\(paths\.evidence, evidence\)/,
  );
});

test('child environment inherits only the explicit process-neutral allowlist', () => {
  const original = {
    DISPLAY: process.env.DISPLAY,
    XAUTHORITY: process.env.XAUTHORITY,
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    ELECTRON_RUN_AS_NODE: process.env.ELECTRON_RUN_AS_NODE,
  };
  try {
    process.env.DISPLAY = ':99';
    process.env.XAUTHORITY = '/private/xauthority';
    process.env.XDG_RUNTIME_DIR = '/private/runtime';
    process.env.AWS_SECRET_ACCESS_KEY = 'PRIVATE_AWS_CANARY';
    process.env.ELECTRON_RUN_AS_NODE = '1';
    const selected = safeInheritedEnvironment();
    assert.deepEqual(
      Object.keys(selected).sort(),
      ['PATH', 'LANG', 'LC_ALL', 'TZ']
        .filter(key => process.env[key] !== undefined)
        .sort(),
    );
    for (const forbidden of Object.keys(original)) {
      assert.equal(Object.hasOwn(selected, forbidden), false, forbidden);
    }
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('process-group parser handles Linux command names containing spaces', () => {
  assert.equal(
    processGroupFromStat('123 (electron helper) S 100 77 77 0 -1 0'),
    77,
  );
  assert.equal(processGroupFromStat('malformed'), null);
});

test('CDP target must be the exact built Studio file and debug authority', () => {
  const target = {
    type: 'page',
    url: 'file:///repo/c3-ide/applications/electron/lib/frontend/index.html?port=4567',
    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/fixture-id',
  };
  const expected = '/repo/c3-ide/applications/electron/lib/frontend/index.html';
  assert.equal(exactStudioPageTarget(target, 9222, expected), true);
  assert.equal(exactStudioPageTarget({
    ...target,
    url: 'file:///repo/other/index.html',
  }, 9222, expected), false);
  assert.equal(exactStudioPageTarget({
    ...target,
    webSocketDebuggerUrl: 'ws://127.0.0.1:9223/devtools/page/fixture-id',
  }, 9222, expected), false);
});

test('Theia control-plane authority is derived only from the exact file target', () => {
  const expected = '/repo/c3-ide/applications/electron/lib/frontend/index.html';
  assert.equal(
    theiaControlPlaneOriginFromEntrypoint(
      `file://${expected}?port=4567`,
      expected,
    ),
    'http://localhost:4567',
  );
  for (const url of [
    `file://${expected}`,
    `file://${expected}?port=0`,
    `file://${expected}?port=4567&port=4568`,
    `file://${expected}?port=4567&extra=1`,
    'file:///repo/other/index.html?port=4567',
    'https://localhost:4567/index.html?port=4567',
  ]) {
    assert.equal(theiaControlPlaneOriginFromEntrypoint(url, expected), null, url);
  }
});

suite('Studio Electron runner — functional terminal contract');

await testAsync('CDP connect errors reject instead of hanging', async () => {
  class RejectingSocket extends EventTarget {
    static OPEN = 1;
    constructor() {
      super();
      this.readyState = 0;
      queueMicrotask(() => this.dispatchEvent(new Event('error')));
    }
    close() {
      this.readyState = 3;
      this.dispatchEvent(new Event('close'));
    }
  }
  const client = new CdpClient('ws://fixture.invalid', RejectingSocket, 100);
  await assert.rejects(client.open(), /cdp-connect-error/);
}, 1_000);

await testAsync('malformed CDP callback state becomes a caught command failure', async () => {
  class OpenSocket extends EventTarget {
    static OPEN = 1;
    constructor() {
      super();
      this.readyState = 0;
      queueMicrotask(() => {
        this.readyState = 1;
        this.dispatchEvent(new Event('open'));
      });
    }
    send() {}
    close() {
      this.readyState = 3;
      this.dispatchEvent(new Event('close'));
    }
    malformed() {
      const event = new Event('message');
      Object.defineProperty(event, 'data', { value: '{malformed' });
      this.dispatchEvent(event);
    }
  }
  const client = new CdpClient('ws://fixture.invalid', OpenSocket, 100);
  await client.open();
  client.socket.malformed();
  await assert.rejects(client.send('Runtime.enable'), /cdp-message-malformed/);
}, 1_000);

await testAsync('suite-owned model sentinel proves zero requests instead of provider failure', async () => {
  const sentinel = await startModelProviderSentinel();
  try {
    assert.equal(sentinel.requestCount(), 0);
    const response = await fetch(`${sentinel.origin}/api/generate`, {
      method: 'POST',
      body: '{}',
    });
    assert.equal(response.status, 503);
    assert.equal(sentinel.requestCount(), 1);
  } finally {
    await sentinel.close();
  }
  const source = fs.readFileSync(
    new URL('./studio-electron-boundary.e2e.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /OLLAMA_URL: modelProviderUrl/);
  assert.match(source, /modelProviderRequestsDuringTurn/);
}, 2_000);

await testAsync('cleanup attempts every owned resource and preserves the first failure', async () => {
  const calls = [];
  const cleanup = await runCleanupSequence([
    {
      name: 'electron',
      run: async () => {
        calls.push('electron');
        throw new Error('PRIVATE_ELECTRON_ERROR');
      },
      fallback: 'electron-fallback',
    },
    {
      name: 'backend',
      run: async () => {
        calls.push('backend');
        throw new Error('PRIVATE_BACKEND_ERROR');
      },
      fallback: 'backend-fallback',
    },
    {
      name: 'sentinel',
      run: async () => {
        calls.push('sentinel');
        return 'closed';
      },
      fallback: 'sentinel-fallback',
    },
    {
      name: 'process-group',
      run: async () => {
        calls.push('process-group');
        return true;
      },
      fallback: false,
    },
  ]);
  assert.deepEqual(calls, ['electron', 'backend', 'sentinel', 'process-group']);
  assert.equal(cleanup.error?.code, 'electron-cleanup-failed');
  assert.equal(cleanup.results.electron, 'electron-fallback');
  assert.equal(cleanup.results.backend, 'backend-fallback');
  assert.equal(cleanup.results.sentinel, 'closed');
  assert.equal(cleanup.results['process-group'], true);
}, 1_000);

await testAsync('namespace spawn errors resolve to a sanitized failure instead of rejecting', async () => {
  const child = new EventEmitter();
  const completionPromise = observeSpawnCompletion(child);
  child.emit('error', new Error('PRIVATE_SPAWN_ERROR'));
  child.emit('close', null, null);
  assert.deepEqual(await completionPromise, {
    code: null,
    signal: null,
    spawnError: true,
  });
}, 1_000);

test('only the complete correlated deterministic WS turn passes', () => {
  assert.equal(validateFunctional(validFunctional()), true);
  const mutations = {
    conversationCreated: false,
    sent: false,
    turnStarts: 2,
    creDecisions: 2,
    localDecisions: 0,
    unexpectedDecisions: 1,
    unexpectedAgentEvents: 1,
    assistantMessages: 2,
    turnEndsOk: 0,
    modelProviderRequestsDuringTurn: 1,
    forbiddenEffects: 1,
    errorSignals: 1,
    assistantMatches: false,
    assistantCorrelated: false,
    assistantModeValid: false,
    disconnected: true,
    orderValid: false,
    resultClass: 'timeout',
  };
  for (const [field, value] of Object.entries(mutations)) {
    assert.equal(validateFunctional(validFunctional({ [field]: value })), false, field);
  }
});

test('full-soak lifecycle rejects every late duplicate, error, effect, or disconnect', () => {
  assert.equal(validateSoakLifecycle(validSoak()), true);
  const mutations = {
    assistantMessages: 2,
    systemMessages: 1,
    disconnects: 1,
    turnStarts: 2,
    turnEnds: 2,
    creDecisions: 2,
    localDecisions: 0,
    unexpectedDecisions: 1,
    unexpectedAgentEvents: 1,
    forbiddenEffects: 1,
    agentErrors: 1,
    idleSignals: 0,
  };
  for (const [field, value] of Object.entries(mutations)) {
    assert.equal(validateSoakLifecycle(validSoak({ [field]: value })), false, field);
  }
});

test('positive boundary requires actual opaque capability-protected API health', () => {
  assert.equal(actualPositiveBoundary(validSnapshot()), 200);
  assert.equal(actualPositiveBoundary(validSnapshot({ http: [] })), null);
  const missingCapability = validSnapshot();
  missingCapability.http[0].capabilityClass = 'missing';
  assert.equal(actualPositiveBoundary(missingCapability), null);
});

suite('Studio Electron runner — sanitized evidence');

test('success evidence drops incidental private fields and marks UI excluded', () => {
  const evidence = successEvidence({
    sourceRevision: SHA,
    observationDurationMs: 65_050,
    networkCaptureDurationMs: 78_050,
    snapshot: validSnapshot(),
    networkVerdict: { verdict: 'PASS', failures: [] },
    negative: [
      {
        case: 'cross-site-no-origin-with-capability',
        status: 403,
        outcome: 'rejected',
        privatePath: '/private/negative-canary',
      },
      {
        case: 'opaque-origin-without-capability',
        status: 403,
        outcome: 'rejected',
      },
    ],
    functional: validFunctional({ rawAnswer: 'PRIVATE_RESPONSE_CANARY' }),
    soakMonitor: validSoak({ privateEvent: 'PRIVATE_EVENT_CANARY' }),
    positiveBoundaryStatus: 204,
    buildDigests: {
      electronMainSha256: DIGEST,
      frontendBundleSha256: DIGEST,
      frontendIndexSha256: DIGEST,
      preloadSha256: DIGEST,
      privateBuildPath: '/private/build-canary',
    },
    shutdown: {
      electron: validExit({ privateLog: '/private/electron-canary' }),
      backend: validExit({
        requestedSignal: 'SIGTERM',
        privateLog: '/private/backend-canary',
      }),
    },
    portFileRemoved: true,
    logDigests: { backend: DIGEST, electron: DIGEST },
  });
  const serialized = JSON.stringify(evidence);
  for (const canary of [
    '/private/negative-canary',
    'PRIVATE_RESPONSE_CANARY',
    '/private/electron-canary',
    '/private/backend-canary',
    'PRIVATE_EVENT_CANARY',
    '/private/build-canary',
  ]) {
    assert.equal(serialized.includes(canary), false, canary);
  }
  assert.equal(evidence.uiEvaluation, 'excluded-non-final-ui');
  assert.equal(
    evidence.isolation.ambientRuntimeEnvironment,
    'process-neutral-allowlist-only',
  );
  assert.equal(evidence.boundaryMatrix.length, 3);
  assert.equal(evidence.boundaryMatrix[2].status, 204);
  assert.equal(evidence.observation.requiredDurationMs, 65_000);
  assert.equal(evidence.observation.actualDurationMs, 65_050);
  assert.equal(evidence.observation.networkCaptureDurationMs, 78_050);
  assert.equal(Object.isFrozen(evidence), true);
  assert.deepEqual(
    Object.keys(evidence.shutdown.electron).sort(),
    [
      'exitCode',
      'forced',
      'processGroupClean',
      'requestedSignal',
      'signal',
      'started',
    ],
  );
});

test('runner source has no soak-duration override or process.env spread', () => {
  const source = fs.readFileSync(
    new URL('./studio-electron-boundary.e2e.js', import.meta.url),
    'utf8',
  );
  assert.equal(source.includes('INTENTSMITH_STUDIO_SOAK_MS'), false);
  assert.equal(source.includes('...process.env'), false);
  assert.match(source, /STUDIO_M0_POLICY\.requiredSoakMs/);
  assert.match(source, /--user[\s\S]*--map-root-user[\s\S]*--net/);
  assert.match(source, /detached: false/);
});

summary();
