#!/usr/bin/env node

import assert from 'node:assert/strict';

import { suite, test, summary } from './harness.js';
import {
  STUDIO_M0_POLICY,
  STUDIO_ROUTE_IDS,
  classifyNetworkTarget,
  createStudioCdpEvidenceReducer,
  evaluateStudioCdpEvidence as evaluateStudioCdpEvidenceRaw,
} from '../scripts/studio-cdp-evidence.js';

const BACKEND = 'http://127.0.0.1:47831';
const THEIA_CONTROL_PLANE = 'http://localhost:39001';
const CAPABILITY = 'A'.repeat(43);
const WRONG_CAPABILITY = 'B'.repeat(43);
const CAPABILITY_HEADER = 'X-IntentSmith-Local-Capability';

function evaluateStudioCdpEvidence(
  snapshot,
  policy = STUDIO_M0_POLICY,
  runtimeEvidence = { observationDurationMs: STUDIO_M0_POLICY.requiredSoakMs },
) {
  return evaluateStudioCdpEvidenceRaw(snapshot, policy, runtimeEvidence);
}

function reducer(options = {}) {
  return createStudioCdpEvidenceReducer({
    backendOrigin: BACKEND,
    controlPlaneOrigin: THEIA_CONTROL_PLANE,
    expectedCapability: CAPABILITY,
    ...options,
  });
}

function actualHeaders(overrides = {}) {
  return {
    Origin: 'null',
    'Sec-Fetch-Site': 'cross-site',
    [CAPABILITY_HEADER]: CAPABILITY,
    ...overrides,
  };
}

function responseHeaders(overrides = {}) {
  return {
    'Access-Control-Allow-Origin': 'null',
    ...overrides,
  };
}

function ingestHttp(target, {
  id,
  path,
  method = 'GET',
  status = 200,
  baseHeaders = actualHeaders(),
  wireHeaders = actualHeaders(),
  baseResponseHeaders = responseHeaders(),
  wireResponseHeaders = responseHeaders(),
  order = 'base-first',
} = {}) {
  const requestId = id || `${method}:${path}`;
  const requestBase = ['Network.requestWillBeSent', {
    requestId,
    request: {
      url: `${BACKEND}${path}`,
      method,
      headers: baseHeaders,
    },
    privateField: '/home/alice/never-output',
  }];
  const requestExtra = ['Network.requestWillBeSentExtraInfo', {
    requestId,
    headers: wireHeaders,
  }];
  const responseBase = ['Network.responseReceived', {
    requestId,
    response: { status, headers: baseResponseHeaders },
  }];
  const responseExtra = ['Network.responseReceivedExtraInfo', {
    requestId,
    statusCode: status,
    headers: wireResponseHeaders,
  }];
  const events = order === 'extra-first'
    ? [requestExtra, requestBase, responseExtra, responseBase]
    : [requestBase, requestExtra, responseBase, responseExtra];
  for (const [event, params] of events) target.ingest(event, params);
}

function ingestValidWebSocket(target, overrides = {}) {
  const requestId = overrides.requestId || 'ws-main';
  const url = overrides.url || `${BACKEND.replace('http:', 'ws:')}/c3/ws`;
  const requestHeaders = overrides.requestHeaders || {
    Origin: 'file://',
    'Sec-WebSocket-Protocol': `c3-v1, c3-local-v1.${CAPABILITY}`,
  };
  const responseHeadersValue = overrides.responseHeaders || {
    'Sec-WebSocket-Protocol': 'c3-v1',
  };
  target.ingest('Network.webSocketCreated', { requestId, url });
  target.ingest('Network.webSocketWillSendHandshakeRequest', {
    requestId,
    request: { headers: requestHeaders },
  });
  target.ingest('Network.webSocketHandshakeResponseReceived', {
    requestId,
    response: {
      status: overrides.status ?? 101,
      headers: responseHeadersValue,
    },
  });
  for (let index = 0; index < (overrides.sentFrames ?? 1); index += 1) {
    target.ingest('Network.webSocketFrameSent', {
      requestId,
      response: { payloadData: 'WS_PAYLOAD_SECRET' },
    });
  }
  for (let index = 0; index < (overrides.receivedFrames ?? 1); index += 1) {
    target.ingest('Network.webSocketFrameReceived', {
      requestId,
      response: { payloadData: 'WS_RESPONSE_SECRET' },
    });
  }
  if (overrides.frameError) {
    target.ingest('Network.webSocketFrameError', {
      requestId,
      errorMessage: '/home/alice/WS_ERROR_SECRET',
    });
  }
  if (overrides.closed) target.ingest('Network.webSocketClosed', { requestId });
}

function ingestTheiaPolling(target, overrides = {}) {
  const requestId = overrides.requestId || 'theia-polling';
  const method = overrides.method || 'GET';
  const query = overrides.query || 'EIO=4&transport=polling&t=abc123';
  const url = overrides.url || `${THEIA_CONTROL_PLANE}/socket.io/?${query}`;
  const status = overrides.status ?? 200;
  target.ingest('Network.requestWillBeSent', {
    requestId,
    request: {
      url,
      method,
      headers: { Cookie: 'THEIA_POLLING_COOKIE_SECRET' },
      postData: 'THEIA_POLLING_BODY_SECRET',
    },
  });
  target.ingest('Network.requestWillBeSentExtraInfo', {
    requestId,
    headers: { Cookie: 'THEIA_POLLING_WIRE_COOKIE_SECRET' },
  });
  target.ingest('Network.responseReceived', {
    requestId,
    response: { status, headers: { 'Set-Cookie': 'THEIA_POLLING_SET_COOKIE_SECRET' } },
  });
  target.ingest('Network.responseReceivedExtraInfo', {
    requestId,
    statusCode: status,
    headers: { 'Set-Cookie': 'THEIA_POLLING_WIRE_SET_COOKIE_SECRET' },
  });
  if (overrides.failed) {
    target.ingest('Network.loadingFailed', {
      requestId,
      errorText: 'THEIA_POLLING_FAILURE_SECRET',
    });
  }
}

function ingestValidTheiaWebSocket(target, overrides = {}) {
  const requestId = overrides.requestId || 'theia-ws-main';
  const query = overrides.query || 'EIO=4&transport=websocket&sid=sid123';
  const url = overrides.url || `${THEIA_CONTROL_PLANE.replace('http:', 'ws:')}/socket.io/?${query}`;
  target.ingest('Network.webSocketCreated', { requestId, url });
  target.ingest('Network.webSocketWillSendHandshakeRequest', {
    requestId,
    request: {
      headers: { Cookie: 'THEIA_WS_COOKIE_SECRET' },
    },
  });
  target.ingest('Network.webSocketHandshakeResponseReceived', {
    requestId,
    response: {
      status: overrides.status ?? 101,
      headers: { 'Set-Cookie': 'THEIA_WS_SET_COOKIE_SECRET' },
    },
  });
  for (let index = 0; index < (overrides.sentFrames ?? 1); index += 1) {
    target.ingest('Network.webSocketFrameSent', {
      requestId,
      response: { payloadData: 'THEIA_WS_SENT_SECRET' },
    });
  }
  for (let index = 0; index < (overrides.receivedFrames ?? 1); index += 1) {
    target.ingest('Network.webSocketFrameReceived', {
      requestId,
      response: { payloadData: 'THEIA_WS_RECEIVED_SECRET' },
    });
  }
  if (overrides.frameError) {
    target.ingest('Network.webSocketFrameError', {
      requestId,
      errorMessage: 'THEIA_WS_ERROR_SECRET',
    });
  }
  if (overrides.closed) target.ingest('Network.webSocketClosed', { requestId });
}

function completeObservation(overrides = {}) {
  const target = reducer(overrides.reducerOptions);
  const routes = [
    ['/health', 200],
    ['/api/health', 200],
    ['/api/projects', 200],
    ['/api/conversations', 200],
    ['/api/expertises', 200],
    ['/api/agents', 200],
    ['/api/media/history', overrides.mediaStatus ?? 200],
  ];
  for (const [path, status] of routes) ingestHttp(target, { path, status });
  ingestHttp(target, { path: '/api/settings', method: 'POST', status: 200 });
  ingestValidWebSocket(target, overrides.websocket);
  if (overrides.theiaPolling !== false) {
    ingestTheiaPolling(target, overrides.theiaPolling || {});
  }
  if (overrides.theiaWebSocket !== false) {
    ingestValidTheiaWebSocket(target, overrides.theiaWebSocket || {});
  }
  return target;
}

function failureCodes(result) {
  return new Set(result.failures.map(item => item.code));
}

suite('Studio CDP evidence — target classification');

test('classifies exact backend routes without retaining query data', () => {
  assert.deepEqual(
    classifyNetworkTarget(
      `${BACKEND}/api/projects?token=QUERY_SECRET`,
      BACKEND,
      THEIA_CONTROL_PLANE,
    ),
    { targetClass: 'protected', routeId: STUDIO_ROUTE_IDS.PROJECTS_LIST },
  );
});

test('classifies exact WebSocket authority and path', () => {
  assert.deepEqual(
    classifyNetworkTarget(
      'ws://127.0.0.1:47831/c3/ws',
      BACKEND,
      THEIA_CONTROL_PLANE,
    ),
    { targetClass: 'protected', routeId: STUDIO_ROUTE_IDS.WS_BRIDGE },
  );
});

test('separates other loopback, external, internal and malformed targets', () => {
  assert.equal(
    classifyNetworkTarget(
      'http://127.0.0.1:47832/api/health',
      BACKEND,
      THEIA_CONTROL_PLANE,
    ).targetClass,
    'other-loopback',
  );
  assert.equal(
    classifyNetworkTarget(
      'http://localhost:47831/api/health',
      BACKEND,
      THEIA_CONTROL_PLANE,
    ).targetClass,
    'other-loopback',
  );
  assert.equal(
    classifyNetworkTarget(
      'https://127.0.0.1:47831/api/health',
      BACKEND,
      THEIA_CONTROL_PLANE,
    ).targetClass,
    'other-loopback',
  );
  for (const url of [
    'https://127.0.0.1.evil.invalid/a',
    'http://192.168.1.5/a',
    'https://example.invalid/a',
  ]) {
    assert.equal(
      classifyNetworkTarget(url, BACKEND, THEIA_CONTROL_PLANE).targetClass,
      'external',
    );
  }
  for (const url of ['file:///home/alice/a', 'data:text/plain,x', 'blob:null/id']) {
    assert.equal(
      classifyNetworkTarget(url, BACKEND, THEIA_CONTROL_PLANE).targetClass,
      'internal',
    );
  }
  assert.equal(
    classifyNetworkTarget('not a URL', BACKEND, THEIA_CONTROL_PLANE).targetClass,
    'malformed',
  );
  assert.equal(
    classifyNetworkTarget(
      'ftp://attacker.invalid/SECRET',
      BACKEND,
      THEIA_CONTROL_PLANE,
    ).targetClass,
    'unsupported-network',
  );
});

test('classifies only strict Socket.IO Engine.IO transport on the exact Theia authority', () => {
  for (const [url, transportClass, phaseClass] of [
    [`${THEIA_CONTROL_PLANE}/socket.io/?EIO=4&transport=polling&t=abc123`, 'polling', 'polling-handshake'],
    [`${THEIA_CONTROL_PLANE}/socket.io/?transport=polling&EIO=4&sid=sid_123&t=next1`, 'polling', 'polling-session'],
    [`${THEIA_CONTROL_PLANE.replace('http:', 'ws:')}/socket.io/?EIO=4&transport=websocket&sid=sid-123`, 'websocket', 'websocket-upgrade'],
  ]) {
    assert.deepEqual(
      classifyNetworkTarget(url, BACKEND, THEIA_CONTROL_PLANE),
      {
        targetClass: 'theia-control-plane',
        routeId: STUDIO_ROUTE_IDS.THEIA_SOCKET_IO,
        transportClass,
        phaseClass,
      },
    );
  }
});

test('unexpected Theia path, query, protocol or authority remains fail-closed', () => {
  for (const url of [
    `${THEIA_CONTROL_PLANE}/socket.io?EIO=4&transport=polling`,
    `${THEIA_CONTROL_PLANE}/socket.io/extra?EIO=4&transport=polling`,
    `${THEIA_CONTROL_PLANE}/socket.io/?transport=polling`,
    `${THEIA_CONTROL_PLANE}/socket.io/?EIO=4&transport=polling`,
    `${THEIA_CONTROL_PLANE}/socket.io/?EIO=3&transport=polling`,
    `${THEIA_CONTROL_PLANE}/socket.io/?EIO=4&transport=websocket`,
    `${THEIA_CONTROL_PLANE}/socket.io/?EIO=4&transport=polling&unexpected=1`,
    `${THEIA_CONTROL_PLANE}/socket.io/?EIO=4&EIO=4&transport=polling`,
    `${THEIA_CONTROL_PLANE}/socket.io/?EIO=4&transport=polling&t=a&t=b`,
    `${THEIA_CONTROL_PLANE}/socket.io/?EIO=4&transport=polling&transport=polling&t=a`,
    `${THEIA_CONTROL_PLANE}/socket.io/?EIO=4&transport=polling&t=a&sid=s1&sid=s2`,
    `${THEIA_CONTROL_PLANE}/socket.io/?EIO=4&transport=polling&t=a&sid=`,
    `${THEIA_CONTROL_PLANE}/socket.io/?EIO=4&transport=polling&t=a&sid=${'x'.repeat(257)}`,
    `${THEIA_CONTROL_PLANE}/socket.io/?EIO=4&transport=polling&t=a&b64=1`,
    `${THEIA_CONTROL_PLANE.replace('http:', 'ws:')}/socket.io/?EIO=4&transport=websocket`,
    `${THEIA_CONTROL_PLANE.replace('http:', 'ws:')}/socket.io/?EIO=4&transport=websocket&sid=s1&sid=s2`,
    `${THEIA_CONTROL_PLANE.replace('http:', 'ws:')}/socket.io/?EIO=4&transport=websocket&sid=s&t=not-allowed`,
    'http://localhost:39002/socket.io/?EIO=4&transport=polling',
    'http://127.0.0.1:39001/socket.io/?EIO=4&transport=polling',
    'https://localhost:39001/socket.io/?EIO=4&transport=polling',
    'wss://localhost:39001/socket.io/?EIO=4&transport=websocket',
  ]) {
    assert.equal(
      classifyNetworkTarget(url, BACKEND, THEIA_CONTROL_PLANE).targetClass,
      'other-loopback',
      url,
    );
  }
});

test('rejects unsafe reducer configuration without echoing its value', () => {
  assert.throws(() => createStudioCdpEvidenceReducer({
    backendOrigin: 'https://example.invalid/SECRET',
    controlPlaneOrigin: THEIA_CONTROL_PLANE,
    expectedCapability: CAPABILITY,
  }), /exact HTTP loopback origin/);
  assert.throws(() => createStudioCdpEvidenceReducer({
    backendOrigin: BACKEND,
    controlPlaneOrigin: THEIA_CONTROL_PLANE,
    expectedCapability: 'CAPABILITY_SECRET',
  }), /valid local capability/);
  for (const controlPlaneOrigin of [
    'http://127.0.0.1:39001',
    'http://localhost',
    'https://localhost:39001',
    'http://localhost:39001/socket.io/',
  ]) {
    assert.throws(() => createStudioCdpEvidenceReducer({
      backendOrigin: BACKEND,
      controlPlaneOrigin,
      expectedCapability: CAPABILITY,
    }), /controlPlaneOrigin/);
  }
});

suite('Studio CDP evidence — deterministic wire reduction');

test('complete HTTP and WebSocket observation passes the network contract', () => {
  const snapshot = completeObservation().snapshot();
  assert.equal(evaluateStudioCdpEvidence(snapshot).verdict, 'PASS');
  assert.equal(snapshot.counts.externalAttempts, 0);
  assert.equal(snapshot.counts.otherLoopbackAttempts, 0);
  assert.equal(snapshot.counts.websockets, 1);
  assert.equal(snapshot.counts.theiaControlPlaneHttp, 1);
  assert.equal(snapshot.counts.theiaControlPlaneWebSockets, 1);
  assert.equal(snapshot.http.some(record => record.targetClass === 'theia-control-plane'), false);
  assert.equal(snapshot.websockets.some(record => record.targetClass === 'theia-control-plane'), false);
  assert.equal(snapshot.theiaControlPlane.http[0].phaseClass, 'polling-handshake');
  assert.equal(snapshot.theiaControlPlane.websockets[0].phaseClass, 'websocket-upgrade');
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.http[0]), true);
});

test('Theia control-plane records never retain authority, query, headers or payload', () => {
  const snapshot = completeObservation().snapshot();
  const serialized = JSON.stringify(snapshot.theiaControlPlane);
  for (const forbidden of [
    'localhost',
    '39001',
    'EIO',
    'transport=',
    'sid123',
    'abc123',
    'Cookie',
    'THEIA_',
  ]) assert.equal(serialized.includes(forbidden), false, `${forbidden} leaked`);
});

test('bounded polling and one live Theia WebSocket are required independently of C3', () => {
  const noPolling = completeObservation({ theiaPolling: false });
  const noPollingResult = evaluateStudioCdpEvidence(noPolling.snapshot());
  assert.equal(noPollingResult.verdict, 'FAIL');
  assert.equal(failureCodes(noPollingResult).has('theia-polling-bound-exceeded'), true);

  const noTheiaWebSocket = completeObservation({ theiaWebSocket: false });
  const result = evaluateStudioCdpEvidence(noTheiaWebSocket.snapshot());
  assert.equal(result.verdict, 'FAIL');
  assert.equal(failureCodes(result).has('theia-websocket-contract-failed'), true);
  assert.equal(noTheiaWebSocket.snapshot().websockets[0].routeId, STUDIO_ROUTE_IDS.WS_BRIDGE);
});

test('valid initial and session polling GET/POST are bounded without pinning an exact count', () => {
  const target = completeObservation({ theiaPolling: false });
  ingestTheiaPolling(target, {
    requestId: 'poll-handshake',
    method: 'GET',
    query: 'EIO=4&transport=polling&t=first1',
  });
  ingestTheiaPolling(target, {
    requestId: 'poll-session-get',
    method: 'GET',
    query: 'EIO=4&transport=polling&t=next1&sid=sid1',
  });
  ingestTheiaPolling(target, {
    requestId: 'poll-session-post',
    method: 'POST',
    query: 'EIO=4&transport=polling&t=next2&sid=sid1',
  });
  const snapshot = target.snapshot();
  assert.equal(snapshot.counts.theiaControlPlaneHttp, 3);
  assert.equal(evaluateStudioCdpEvidence(snapshot).verdict, 'PASS');
  assert.equal(evaluateStudioCdpEvidence(snapshot, {
    ...STUDIO_M0_POLICY,
    maxTheiaPollingHttp: 2,
  }).failures.some(item => item.code === 'theia-polling-bound-exceeded'), true);
});

test('invalid Theia polling method, status, terminal and handshake phase fail closed', () => {
  for (const polling of [
    { requestId: 'bad-method', method: 'DELETE' },
    { requestId: 'bad-status', status: 500 },
    { requestId: 'bad-terminal', failed: true },
    { requestId: 'bad-handshake-method', method: 'POST' },
  ]) {
    const target = completeObservation({ theiaPolling: false });
    ingestTheiaPolling(target, polling);
    assert.equal(evaluateStudioCdpEvidence(target.snapshot()).verdict, 'FAIL');
  }
});

for (const [name, overrides] of [
  ['rejected handshake', { status: 403 }],
  ['no sent frames', { sentFrames: 0 }],
  ['no received frames', { receivedFrames: 0 }],
  ['frame error', { frameError: true }],
  ['reconnect close', { closed: true }],
]) {
  test(`Theia ${name} cannot satisfy the live control-plane channel`, () => {
    const target = completeObservation({ theiaWebSocket: overrides });
    const result = evaluateStudioCdpEvidence(target.snapshot());
    assert.equal(result.verdict, 'FAIL');
    assert.equal(failureCodes(result).has('theia-websocket-contract-failed'), true);
  });
}

test('one live Theia channel cannot hide an extra reconnect channel', () => {
  const target = completeObservation();
  ingestValidTheiaWebSocket(target, { requestId: 'theia-ws-reconnect' });
  const result = evaluateStudioCdpEvidence(target.snapshot());
  assert.equal(result.verdict, 'FAIL');
  assert.equal(failureCodes(result).has('theia-websocket-contract-failed'), true);
});

test('network success cannot pass without the full bounded soak duration', () => {
  const snapshot = completeObservation().snapshot();
  assert.equal(evaluateStudioCdpEvidenceRaw(snapshot).verdict, 'FAIL');
  assert.equal(
    failureCodes(evaluateStudioCdpEvidenceRaw(
      snapshot,
      STUDIO_M0_POLICY,
      { observationDurationMs: 64_999 },
    )).has('insufficient-soak'),
    true,
  );
  assert.equal(evaluateStudioCdpEvidence(snapshot).verdict, 'PASS');
});

test('base and ExtraInfo arrival order produce identical snapshots', () => {
  const baseFirst = reducer();
  const extraFirst = reducer();
  ingestHttp(baseFirst, { path: '/api/health', order: 'base-first' });
  ingestHttp(extraFirst, { path: '/api/health', order: 'extra-first' });
  assert.deepEqual(baseFirst.snapshot(), extraFirst.snapshot());
});

test('wire ExtraInfo is authoritative over optimistic base headers', () => {
  const target = reducer();
  ingestHttp(target, {
    path: '/api/health',
    baseHeaders: actualHeaders(),
    wireHeaders: {},
  });
  const [record] = target.snapshot().http;
  assert.equal(record.headerSource, 'extra-info');
  assert.equal(record.originClass, 'absent');
  assert.equal(record.capabilityClass, 'missing');
  const codes = failureCodes(evaluateStudioCdpEvidence(target.snapshot(), {
    ...STUDIO_M0_POLICY,
    requiredHttpRoutes: [STUDIO_ROUTE_IDS.API_HEALTH],
    requiredPostRoute: STUDIO_ROUTE_IDS.API_HEALTH,
  }));
  assert.equal(codes.has('origin-boundary-failed'), true);
  assert.equal(codes.has('capability-boundary-failed'), true);
});

test('missing ExtraInfo is preserved as insufficient wire evidence', () => {
  const target = reducer();
  const requestId = 'base-only';
  target.ingest('Network.requestWillBeSent', {
    requestId,
    request: { url: `${BACKEND}/api/health`, method: 'GET', headers: actualHeaders() },
  });
  target.ingest('Network.responseReceived', {
    requestId,
    response: { status: 200, headers: responseHeaders() },
  });
  const [record] = target.snapshot().http;
  assert.equal(record.headerSource, 'base-fallback');
  assert.equal(
    failureCodes(evaluateStudioCdpEvidence(target.snapshot())).has('insufficient-wire-evidence'),
    true,
  );
});

test('duplicate request ExtraInfo fails closed', () => {
  const target = reducer();
  ingestHttp(target, { path: '/api/health' });
  target.ingest('Network.requestWillBeSentExtraInfo', {
    requestId: 'GET:/api/health',
    headers: actualHeaders({ [CAPABILITY_HEADER]: WRONG_CAPABILITY }),
  });
  const snapshot = target.snapshot();
  assert.equal(snapshot.counts.ambiguous > 0, true);
  assert.equal(
    failureCodes(evaluateStudioCdpEvidence(snapshot)).has('ambiguous-wire-evidence'),
    true,
  );
});

test('conflicting response status and CORS evidence fails closed', () => {
  const target = reducer();
  const id = 'response-conflict';
  target.ingest('Network.requestWillBeSent', {
    requestId: id,
    request: { url: `${BACKEND}/api/health`, method: 'GET', headers: actualHeaders() },
  });
  target.ingest('Network.requestWillBeSentExtraInfo', { requestId: id, headers: actualHeaders() });
  target.ingest('Network.responseReceived', {
    requestId: id,
    response: { status: 200, headers: responseHeaders({ 'Access-Control-Allow-Origin': '*' }) },
  });
  target.ingest('Network.responseReceivedExtraInfo', {
    requestId: id,
    statusCode: 201,
    headers: responseHeaders(),
  });
  const codes = target.snapshot().anomalies.map(item => item.code);
  assert.equal(codes.includes('conflicting-response-status'), true);
  assert.equal(codes.includes('conflicting-response-cors'), true);
});

test('redirect reuse of a request id is ambiguous', () => {
  const target = reducer();
  target.ingest('Network.requestWillBeSent', {
    requestId: 'redirect',
    request: { url: `${BACKEND}/api/health`, method: 'GET', headers: actualHeaders() },
  });
  target.ingest('Network.requestWillBeSent', {
    requestId: 'redirect',
    request: { url: `${BACKEND}/api/projects`, method: 'GET', headers: actualHeaders() },
    redirectResponse: { status: 302 },
  });
  assert.equal(
    target.snapshot().anomalies.some(item => item.code === 'ambiguous-redirect'),
    true,
  );
});

suite('Studio CDP evidence — HTTP boundary negatives');

for (const [name, headers, expectedClass, field] of [
  ['missing capability', actualHeaders({ [CAPABILITY_HEADER]: undefined }), 'invalid', 'capabilityClass'],
  ['wrong capability', actualHeaders({ [CAPABILITY_HEADER]: WRONG_CAPABILITY }), 'mismatch', 'capabilityClass'],
  ['duplicate capability', {
    ...actualHeaders(),
    'x-intentsmith-local-capability': CAPABILITY,
  }, 'duplicate', 'capabilityClass'],
  ['absent origin', (() => {
    const value = actualHeaders();
    delete value.Origin;
    return value;
  })(), 'absent', 'originClass'],
  ['named origin', actualHeaders({ Origin: BACKEND }), 'named', 'originClass'],
  ['duplicate origin', { ...actualHeaders(), origin: 'null' }, 'duplicate', 'originClass'],
  ['missing fetch site', (() => {
    const value = actualHeaders();
    delete value['Sec-Fetch-Site'];
    return value;
  })(), 'absent', 'fetchSiteClass'],
  ['wrong fetch site', actualHeaders({ 'Sec-Fetch-Site': 'same-site' }), 'same-site', 'fetchSiteClass'],
  ['duplicate fetch site', { ...actualHeaders(), 'sec-fetch-site': 'cross-site' }, 'duplicate', 'fetchSiteClass'],
]) {
  test(`${name} is reduced to a failing enum`, () => {
    const target = reducer();
    ingestHttp(target, { path: '/api/health', wireHeaders: headers });
    assert.equal(target.snapshot().http[0][field], expectedClass);
    assert.equal(evaluateStudioCdpEvidence(target.snapshot()).verdict, 'FAIL');
  });
}

test('missing capability is distinct from an invalid header value', () => {
  const headers = actualHeaders();
  delete headers[CAPABILITY_HEADER];
  const target = reducer();
  ingestHttp(target, { path: '/api/health', wireHeaders: headers });
  assert.equal(target.snapshot().http[0].capabilityClass, 'missing');
});

test('wildcard, named and absent ACAO all fail the response boundary', () => {
  for (const value of ['*', BACKEND, null]) {
    const target = reducer();
    const headers = value === null ? {} : { 'Access-Control-Allow-Origin': value };
    ingestHttp(target, { path: '/api/health', wireResponseHeaders: headers });
    assert.equal(evaluateStudioCdpEvidence(target.snapshot()).verdict, 'FAIL');
  }
});

test('exact opaque preflight is distinguished from capability-bearing preflight', () => {
  const exact = reducer();
  ingestHttp(exact, {
    id: 'preflight-exact',
    path: '/api/settings',
    method: 'OPTIONS',
    status: 204,
    wireHeaders: {
      Origin: 'null',
      'Sec-Fetch-Site': 'cross-site',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': `content-type, ${CAPABILITY_HEADER}`,
    },
  });
  assert.equal(exact.snapshot().http[0].preflightClass, 'exact');
  assert.equal(exact.snapshot().http[0].capabilityClass, 'not-applicable');

  const secretBearing = reducer();
  ingestHttp(secretBearing, {
    id: 'preflight-secret',
    path: '/api/settings',
    method: 'OPTIONS',
    status: 204,
    wireHeaders: {
      Origin: 'null',
      'Sec-Fetch-Site': 'cross-site',
      [CAPABILITY_HEADER]: CAPABILITY,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': CAPABILITY_HEADER,
    },
  });
  assert.equal(secretBearing.snapshot().http[0].preflightClass, 'secret-present');
  assert.equal(evaluateStudioCdpEvidence(secretBearing.snapshot()).verdict, 'FAIL');
});

test('media-history 404 is the only allowed non-2xx startup status', () => {
  assert.equal(evaluateStudioCdpEvidence(completeObservation({ mediaStatus: 404 }).snapshot()).verdict, 'PASS');
  const target = completeObservation();
  ingestHttp(target, { id: 'projects-404', path: '/api/projects', status: 404 });
  assert.equal(evaluateStudioCdpEvidence(target.snapshot()).verdict, 'FAIL');
});

test('403, 5xx and missing terminal response cannot pass', () => {
  for (const status of [403, 500]) {
    const target = completeObservation();
    ingestHttp(target, { id: `bad-${status}`, path: '/api/system/info', status });
    assert.equal(evaluateStudioCdpEvidence(target.snapshot()).verdict, 'FAIL');
  }
  const missing = completeObservation();
  missing.ingest('Network.requestWillBeSent', {
    requestId: 'no-terminal',
    request: { url: `${BACKEND}/api/system/info`, method: 'GET', headers: actualHeaders() },
  });
  missing.ingest('Network.requestWillBeSentExtraInfo', {
    requestId: 'no-terminal',
    headers: actualHeaders(),
  });
  assert.equal(evaluateStudioCdpEvidence(missing.snapshot()).verdict, 'FAIL');
});

suite('Studio CDP evidence — WebSocket and redaction');

for (const [name, overrides] of [
  ['wrong target', { url: 'ws://127.0.0.1:47832/c3/ws' }],
  ['rejected handshake', { status: 403 }],
  ['missing capability protocol', { requestHeaders: { Origin: 'null', 'Sec-WebSocket-Protocol': 'c3-v1' } }],
  ['wrong capability protocol', { requestHeaders: { Origin: 'null', 'Sec-WebSocket-Protocol': `c3-v1, c3-local-v1.${WRONG_CAPABILITY}` } }],
  ['duplicate capability protocol', { requestHeaders: { Origin: 'null', 'Sec-WebSocket-Protocol': `c3-v1, c3-local-v1.${CAPABILITY}, c3-local-v1.${CAPABILITY}` } }],
  ['missing application protocol', { requestHeaders: { Origin: 'null', 'Sec-WebSocket-Protocol': `c3-local-v1.${CAPABILITY}` } }],
  ['no sent frames', { sentFrames: 0 }],
  ['no received frames', { receivedFrames: 0 }],
  ['frame error', { frameError: true }],
  ['premature close', { closed: true }],
  ['unexpected offered protocol', { requestHeaders: { Origin: 'null', 'Sec-WebSocket-Protocol': `c3-v1, c3-local-v1.${CAPABILITY}, extra-v1` } }],
  ['capability echoed by server', { responseHeaders: { 'Sec-WebSocket-Protocol': `c3-v1, c3-local-v1.${CAPABILITY}` } }],
]) {
  test(`${name} fails the WebSocket contract`, () => {
    const target = completeObservation({ websocket: overrides });
    assert.equal(evaluateStudioCdpEvidence(target.snapshot()).verdict, 'FAIL');
  });
}

test('one valid WebSocket cannot hide another rejected or closed socket', () => {
  const target = completeObservation();
  ingestValidWebSocket(target, {
    requestId: 'ws-rejected',
    status: 403,
    closed: true,
  });
  assert.equal(evaluateStudioCdpEvidence(target.snapshot()).verdict, 'FAIL');
});

test('duplicate WebSocket creation keeps the first target and fails closed', () => {
  const target = reducer();
  target.ingest('Network.webSocketCreated', {
    requestId: 'ws-duplicate-target',
    url: 'wss://attacker.invalid/SECRET_FIRST',
  });
  target.ingest('Network.webSocketCreated', {
    requestId: 'ws-duplicate-target',
    url: `${BACKEND.replace('http:', 'ws:')}/c3/ws`,
  });
  const snapshot = target.snapshot();
  assert.equal(snapshot.counts.externalAttempts, 1);
  assert.equal(
    snapshot.anomalies.some(item => item.code === 'duplicate-websocket-created'),
    true,
  );
  assert.equal(JSON.stringify(snapshot).includes('attacker.invalid'), false);
});

test('combined false-green vector is rejected on every independent axis', () => {
  const target = reducer();
  for (const path of [
    '/health',
    '/api/health',
    '/api/projects',
    '/api/conversations',
    '/api/expertises',
    '/api/agents',
    '/api/media/history',
  ]) ingestHttp(target, { path, method: 'DELETE', status: 200 });
  ingestHttp(target, { path: '/api/settings', method: 'POST', status: 200 });
  ingestValidWebSocket(target, { requestId: 'ws-good' });
  ingestValidWebSocket(target, {
    requestId: 'ws-bad',
    status: 403,
    closed: true,
  });
  target.ingest('Network.requestWillBeSent', {
    requestId: 'ftp-egress',
    request: {
      url: 'ftp://attacker.invalid/SECRET_FTP',
      method: 'GET',
      headers: {},
    },
  });

  const snapshot = target.snapshot();
  const result = evaluateStudioCdpEvidence(snapshot);
  const codes = failureCodes(result);
  assert.equal(result.verdict, 'FAIL');
  assert.equal(codes.has('missing-required-route'), true);
  assert.equal(codes.has('unsupported-network-attempt'), true);
  assert.equal(codes.has('websocket-contract-failed'), true);
  assert.equal(JSON.stringify(snapshot).includes('SECRET_FTP'), false);
});

test('external, loopback lookalike and backend-other requests fail without exposing targets', () => {
  const target = completeObservation();
  for (const [requestId, url] of [
    ['external', 'https://example.invalid/SECRET_EXTERNAL?token=QUERY_SECRET'],
    ['loopback', 'http://127.0.0.1:47832/SECRET_LOOPBACK'],
    ['backend-other', `${BACKEND}/not-protected/SECRET_BACKEND`],
  ]) {
    target.ingest('Network.requestWillBeSent', {
      requestId,
      request: { url, method: 'GET', headers: { Authorization: 'AUTH_SECRET' } },
    });
  }
  const snapshot = target.snapshot();
  assert.equal(snapshot.counts.externalAttempts, 1);
  assert.equal(snapshot.counts.otherLoopbackAttempts, 1);
  assert.equal(evaluateStudioCdpEvidence(snapshot).verdict, 'FAIL');
  const serialized = JSON.stringify(snapshot);
  for (const secret of [
    'SECRET_EXTERNAL',
    'QUERY_SECRET',
    'SECRET_LOOPBACK',
    'SECRET_BACKEND',
    'AUTH_SECRET',
    'example.invalid',
  ]) assert.equal(serialized.includes(secret), false, `${secret} leaked`);
});

test('request, response, failure and frame payload canaries are never serialized', () => {
  const target = reducer();
  const requestId = 'redaction';
  target.ingest('Network.requestWillBeSent', {
    requestId,
    request: {
      url: `${BACKEND}/api/health?path=/home/alice&token=QUERY_SECRET`,
      method: 'GET',
      headers: {
        ...actualHeaders(),
        Authorization: 'AUTH_SECRET',
        Cookie: 'COOKIE_SECRET',
        'X-Custom': 'CUSTOM_SECRET',
      },
      postData: 'BODY_SECRET',
    },
  });
  target.ingest('Network.requestWillBeSentExtraInfo', {
    requestId,
    headers: { ...actualHeaders(), Cookie: 'WIRE_COOKIE_SECRET' },
  });
  target.ingest('Network.responseReceivedExtraInfo', {
    requestId,
    statusCode: 200,
    headers: { ...responseHeaders(), 'Set-Cookie': 'SET_COOKIE_SECRET' },
  });
  target.ingest('Network.loadingFailed', {
    requestId,
    errorText: '/home/alice/FAILURE_SECRET',
  });
  ingestValidWebSocket(target);
  target.ingest('Page.frameNavigated', { url: 'file:///home/alice/PAGE_SECRET' });
  const serialized = JSON.stringify(target.snapshot());
  for (const secret of [
    '/home/',
    'QUERY_SECRET',
    'AUTH_SECRET',
    'COOKIE_SECRET',
    'CUSTOM_SECRET',
    'BODY_SECRET',
    'WIRE_COOKIE_SECRET',
    'SET_COOKIE_SECRET',
    'FAILURE_SECRET',
    'WS_PAYLOAD_SECRET',
    'WS_RESPONSE_SECRET',
    'PAGE_SECRET',
    CAPABILITY,
  ]) assert.equal(serialized.includes(secret), false, `${secret} leaked`);
});

test('record limit is bounded and fails closed', () => {
  const target = reducer({ maxRecords: 1 });
  target.ingest('Network.requestWillBeSent', {
    requestId: 'one',
    request: { url: `${BACKEND}/api/health`, method: 'GET', headers: actualHeaders() },
  });
  target.ingest('Network.requestWillBeSent', {
    requestId: 'two',
    request: { url: `${BACKEND}/api/projects`, method: 'GET', headers: actualHeaders() },
  });
  const snapshot = target.snapshot();
  assert.equal(snapshot.anomalies.some(item => item.code === 'record-limit-exceeded'), true);
  assert.equal(evaluateStudioCdpEvidence(snapshot).verdict, 'FAIL');
});

test('repeated events cannot grow one record without bound', () => {
  const target = reducer({ maxRecords: 1 });
  for (let index = 0; index < 100; index += 1) {
    target.ingest('Network.requestWillBeSentExtraInfo', {
      requestId: 'same-record',
      headers: actualHeaders(),
    });
  }
  const snapshot = target.snapshot();
  assert.equal(snapshot.anomalies.some(item => item.code === 'record-limit-exceeded'), true);
  assert.equal(snapshot.counts.events, 100);
  assert.equal(evaluateStudioCdpEvidence(snapshot).verdict, 'FAIL');
});

test('malformed and orphan events use fixed enums without echoing input', () => {
  const target = reducer();
  target.ingest('Network.requestWillBeSent', {
    requestId: '',
    request: { url: 'MALFORMED_SECRET', method: 'SECRET_METHOD' },
  });
  target.ingest('Network.responseReceivedExtraInfo', {
    requestId: 'orphan',
    statusCode: 200,
    headers: { 'Set-Cookie': 'ORPHAN_SECRET' },
  });
  const serialized = JSON.stringify(target.snapshot());
  assert.equal(serialized.includes('MALFORMED_SECRET'), false);
  assert.equal(serialized.includes('SECRET_METHOD'), false);
  assert.equal(serialized.includes('ORPHAN_SECRET'), false);
  assert.equal(target.snapshot().counts.malformed, 1);
  assert.equal(target.snapshot().counts.orphaned, 1);
});

test('non-Network UI events do not become part of the evidence contract', () => {
  const target = reducer();
  const before = target.snapshot();
  target.ingest('Runtime.consoleAPICalled', { value: '/home/alice/UI_SECRET' });
  target.ingest('Page.frameNavigated', { url: 'file:///home/alice/UI_SECRET' });
  target.ingest('DOM.documentUpdated', { value: 'UI_SECRET' });
  assert.deepEqual(target.snapshot(), before);
});

summary();
