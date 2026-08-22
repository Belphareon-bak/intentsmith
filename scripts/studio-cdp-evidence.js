import { timingSafeEqual } from 'node:crypto';

export const STUDIO_CDP_EVIDENCE_SCHEMA_VERSION = 2;

export const STUDIO_ROUTE_IDS = Object.freeze({
  HEALTH_ROOT: 'health-root',
  API_HEALTH: 'api-health',
  PROJECTS_LIST: 'projects-list',
  CONVERSATIONS_LIST: 'conversations-list',
  EXPERTISES_LIST: 'expertises-list',
  AGENTS_LIST: 'agents-list',
  MEDIA_HISTORY: 'media-history',
  SETTINGS: 'settings',
  SYSTEM_INFO: 'system-info',
  WORKSPACE: 'workspace',
  CHAT: 'chat',
  WS_BRIDGE: 'ws-bridge',
  THEIA_SOCKET_IO: 'theia-socket-io',
  API_OTHER: 'api-other',
  BACKEND_OTHER: 'backend-other',
});

export const STUDIO_M0_POLICY = Object.freeze({
  requiredHttpRoutes: Object.freeze([
    STUDIO_ROUTE_IDS.HEALTH_ROOT,
    STUDIO_ROUTE_IDS.API_HEALTH,
    STUDIO_ROUTE_IDS.PROJECTS_LIST,
    STUDIO_ROUTE_IDS.CONVERSATIONS_LIST,
    STUDIO_ROUTE_IDS.EXPERTISES_LIST,
    STUDIO_ROUTE_IDS.AGENTS_LIST,
    STUDIO_ROUTE_IDS.MEDIA_HISTORY,
  ]),
  requiredPostRoute: STUDIO_ROUTE_IDS.SETTINGS,
  requiredSoakMs: 65_000,
  minTheiaPollingHttp: 1,
  maxTheiaPollingHttp: 128,
  requiredBackendWebSocketCount: 1,
  requiredClosedBackendWebSocketCount: 0,
});

export const STUDIO_M1_POLICY = Object.freeze({
  ...STUDIO_M0_POLICY,
  requiredBackendWebSocketCount: 2,
  requiredClosedBackendWebSocketCount: 1,
});

const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const LOCAL_CAPABILITY_HEADER = 'x-intentsmith-local-capability';
const WS_CAPABILITY_PREFIX = 'c3-local-v1.';
const SAFE_METHODS = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
]);
const INTERNAL_PROTOCOLS = new Set([
  'file:',
  'data:',
  'blob:',
  'chrome:',
  'chrome-extension:',
  'devtools:',
  'about:',
]);
const NETWORK_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const THEIA_CONTROL_PLANE_HOST = 'localhost';
const SOCKET_IO_PATH = '/socket.io/';
const SOCKET_IO_QUERY_KEYS = new Set(['EIO', 'transport', 'sid', 't']);
const SOCKET_IO_QUERY_VALUE_PATTERN = /^[A-Za-z0-9_-]+$/;
const SOCKET_IO_QUERY_VALUE_MAX_LENGTH = 256;

function canonicalBackendOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError('backendOrigin must be an absolute URL');
  }
  if (
    parsed.protocol !== 'http:'
    || !LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
  ) {
    throw new TypeError('backendOrigin must be an exact HTTP loopback origin');
  }
  return parsed.origin;
}

function canonicalControlPlaneOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError('controlPlaneOrigin must be an absolute URL');
  }
  if (
    parsed.protocol !== 'http:'
    || parsed.hostname.toLowerCase() !== THEIA_CONTROL_PLANE_HOST
    || !parsed.port
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
  ) {
    throw new TypeError('controlPlaneOrigin must be an exact HTTP localhost origin with an explicit port');
  }
  const port = Number.parseInt(parsed.port, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError('controlPlaneOrigin must use a valid explicit port');
  }
  return parsed.origin;
}

function classifySocketIoTransport(parsed) {
  if (parsed.pathname !== SOCKET_IO_PATH || !parsed.search) return null;
  const rawPairs = parsed.search.slice(1).split('&');
  if (rawPairs.length < 2 || rawPairs.some(pair => !pair)) return null;

  const values = new Map();
  for (const rawPair of rawPairs) {
    const separator = rawPair.indexOf('=');
    if (
      separator <= 0
      || separator !== rawPair.lastIndexOf('=')
    ) return null;
    const key = rawPair.slice(0, separator);
    const value = rawPair.slice(separator + 1);
    if (
      !SOCKET_IO_QUERY_KEYS.has(key)
      || values.has(key)
      || !value
      || value.length > SOCKET_IO_QUERY_VALUE_MAX_LENGTH
      || !SOCKET_IO_QUERY_VALUE_PATTERN.test(value)
    ) return null;
    values.set(key, value);
  }

  if (values.get('EIO') !== '4') return null;
  const transport = values.get('transport');
  if (
    parsed.protocol === 'http:'
    && transport === 'polling'
    && values.has('t')
    && values.size === (values.has('sid') ? 4 : 3)
  ) {
    return Object.freeze({
      transportClass: 'polling',
      phaseClass: values.has('sid') ? 'polling-session' : 'polling-handshake',
    });
  }
  if (
    parsed.protocol === 'ws:'
    && transport === 'websocket'
    && values.has('sid')
    && !values.has('t')
    && values.size === 3
  ) {
    return Object.freeze({
      transportClass: 'websocket',
      phaseClass: 'websocket-upgrade',
    });
  }
  return null;
}

function classifyBackendPath(pathname) {
  const exact = new Map([
    ['/health', STUDIO_ROUTE_IDS.HEALTH_ROOT],
    ['/api/health', STUDIO_ROUTE_IDS.API_HEALTH],
    ['/api/projects', STUDIO_ROUTE_IDS.PROJECTS_LIST],
    ['/api/conversations', STUDIO_ROUTE_IDS.CONVERSATIONS_LIST],
    ['/api/expertises', STUDIO_ROUTE_IDS.EXPERTISES_LIST],
    ['/api/agents', STUDIO_ROUTE_IDS.AGENTS_LIST],
    ['/api/media/history', STUDIO_ROUTE_IDS.MEDIA_HISTORY],
    ['/api/settings', STUDIO_ROUTE_IDS.SETTINGS],
    ['/api/system/info', STUDIO_ROUTE_IDS.SYSTEM_INFO],
    ['/api/workspace', STUDIO_ROUTE_IDS.WORKSPACE],
    ['/chat', STUDIO_ROUTE_IDS.CHAT],
  ]);
  if (exact.has(pathname)) return exact.get(pathname);
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    return STUDIO_ROUTE_IDS.API_OTHER;
  }
  return STUDIO_ROUTE_IDS.BACKEND_OTHER;
}

export function classifyNetworkTarget(rawUrl, backendOrigin, controlPlaneOrigin) {
  const expectedOrigin = canonicalBackendOrigin(backendOrigin);
  const expected = new URL(expectedOrigin);
  const exactControlPlaneOrigin = canonicalControlPlaneOrigin(controlPlaneOrigin);
  const expectedControlPlane = new URL(exactControlPlaneOrigin);
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return Object.freeze({ targetClass: 'malformed', routeId: null });
  }
  if (parsed.username || parsed.password || parsed.hash) {
    return Object.freeze({ targetClass: 'malformed', routeId: null });
  }

  if (INTERNAL_PROTOCOLS.has(parsed.protocol)) {
    return Object.freeze({ targetClass: 'internal', routeId: null });
  }
  if (!NETWORK_PROTOCOLS.has(parsed.protocol)) {
    return Object.freeze({ targetClass: 'unsupported-network', routeId: null });
  }
  const sameBackendAuthority = (
    parsed.hostname.toLowerCase() === expected.hostname.toLowerCase()
    && parsed.port === expected.port
    && (
      parsed.protocol === expected.protocol
      || (expected.protocol === 'http:' && parsed.protocol === 'ws:')
    )
  );
  if (sameBackendAuthority) {
    const routeId = parsed.protocol === 'ws:' && parsed.pathname === '/c3/ws'
      ? STUDIO_ROUTE_IDS.WS_BRIDGE
      : classifyBackendPath(parsed.pathname);
    return Object.freeze({
      targetClass: routeId === STUDIO_ROUTE_IDS.BACKEND_OTHER
        ? 'backend-other'
        : 'protected',
      routeId,
    });
  }
  const sameControlPlaneAuthority = (
    parsed.hostname.toLowerCase() === expectedControlPlane.hostname.toLowerCase()
    && parsed.port === expectedControlPlane.port
    && (
      parsed.protocol === expectedControlPlane.protocol
      || (expectedControlPlane.protocol === 'http:' && parsed.protocol === 'ws:')
    )
  );
  if (sameControlPlaneAuthority) {
    const transport = classifySocketIoTransport(parsed);
    if (transport) {
      return Object.freeze({
        targetClass: 'theia-control-plane',
        routeId: STUDIO_ROUTE_IDS.THEIA_SOCKET_IO,
        transportClass: transport.transportClass,
        phaseClass: transport.phaseClass,
      });
    }
    return Object.freeze({ targetClass: 'other-loopback', routeId: null });
  }
  if (LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
    return Object.freeze({ targetClass: 'other-loopback', routeId: null });
  }
  return Object.freeze({
    targetClass: 'external',
    routeId: null,
    schemeClass: parsed.protocol.slice(0, -1),
  });
}

function entriesForHeader(headers, wantedName) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return [];
  const wanted = wantedName.toLowerCase();
  const values = [];
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== wanted) continue;
    if (Array.isArray(value)) values.push(...value.map(item => String(item)));
    else values.push(String(value));
  }
  return values;
}

function commaValues(headers, name) {
  return entriesForHeader(headers, name)
    .flatMap(value => value.split(','))
    .map(value => value.trim());
}

function classifyOrigin(headers, name = 'origin') {
  const values = entriesForHeader(headers, name);
  if (values.length === 0) return 'absent';
  if (values.length !== 1 || values[0].includes(',')) return 'duplicate';
  const value = values[0].trim();
  if (value === 'null' || value.startsWith('file:')) return 'opaque';
  try {
    const parsed = new URL(value);
    return parsed.origin === value && !parsed.username && !parsed.password
      ? 'named'
      : 'invalid';
  } catch {
    return 'invalid';
  }
}

function classifyFetchSite(headers) {
  const values = entriesForHeader(headers, 'sec-fetch-site');
  if (values.length === 0) return 'absent';
  if (values.length !== 1 || values[0].includes(',')) return 'duplicate';
  const normalized = values[0].trim().toLowerCase();
  return new Set(['cross-site', 'same-origin', 'same-site', 'none']).has(normalized)
    ? normalized
    : 'invalid';
}

function safeEqualCapability(presented, expected) {
  if (!CAPABILITY_PATTERN.test(presented) || !CAPABILITY_PATTERN.test(expected)) {
    return false;
  }
  const left = Buffer.from(presented, 'ascii');
  const right = Buffer.from(expected, 'ascii');
  return left.length === right.length && timingSafeEqual(left, right);
}

function classifyCapability(headers, expectedCapability) {
  const values = entriesForHeader(headers, LOCAL_CAPABILITY_HEADER);
  if (values.length === 0) return 'missing';
  if (values.length !== 1 || values[0].includes(',')) return 'duplicate';
  const value = values[0].trim();
  if (!CAPABILITY_PATTERN.test(value)) return 'invalid';
  return safeEqualCapability(value, expectedCapability) ? 'match' : 'mismatch';
}

function classifyAllowOrigin(headers) {
  const values = entriesForHeader(headers, 'access-control-allow-origin');
  if (values.length === 0) return 'absent';
  if (values.length !== 1 || values[0].includes(',')) return 'duplicate';
  const value = values[0].trim();
  if (value === 'null') return 'opaque';
  if (value === '*') return 'wildcard';
  try {
    const parsed = new URL(value);
    return parsed.origin === value && !parsed.username && !parsed.password
      ? 'named'
      : 'invalid';
  } catch {
    return 'invalid';
  }
}

function classifyPreflight(headers) {
  if (entriesForHeader(headers, LOCAL_CAPABILITY_HEADER).length !== 0) {
    return 'secret-present';
  }
  const method = entriesForHeader(headers, 'access-control-request-method');
  if (
    method.length !== 1
    || !SAFE_METHODS.has(method[0].trim().toUpperCase())
    || method[0].trim().toUpperCase() === 'OPTIONS'
  ) {
    return 'invalid';
  }
  const requested = commaValues(headers, 'access-control-request-headers')
    .map(value => value.toLowerCase());
  if (requested.length === 0) return 'missing-capability-declaration';
  if (new Set(requested).size !== requested.length || requested.some(value => !value)) {
    return 'invalid';
  }
  if (!requested.includes(LOCAL_CAPABILITY_HEADER)) {
    return 'missing-capability-declaration';
  }
  if (requested.some(value => !new Set([
    LOCAL_CAPABILITY_HEADER,
    'content-type',
  ]).has(value))) {
    return 'unexpected-header';
  }
  return 'exact';
}

function summarizeRequestHeaders(headers, expectedCapability) {
  return Object.freeze({
    originClass: classifyOrigin(headers),
    fetchSiteClass: classifyFetchSite(headers),
    capabilityClass: classifyCapability(headers, expectedCapability),
    preflightClass: classifyPreflight(headers),
  });
}

function summarizeResponseHeaders(headers) {
  return Object.freeze({ allowOriginClass: classifyAllowOrigin(headers) });
}

function safeMethod(value) {
  const normalized = String(value || '').toUpperCase();
  return SAFE_METHODS.has(normalized) ? normalized : 'OTHER';
}

function statusClass(status) {
  if (!Number.isInteger(status)) return 'missing';
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 300 && status < 400) return '3xx';
  if (status >= 400 && status < 500) return '4xx';
  if (status >= 500 && status < 600) return '5xx';
  return 'invalid';
}

function stableAggregate(records) {
  const aggregated = new Map();
  for (const record of records) {
    const key = JSON.stringify(record);
    aggregated.set(key, { ...record, count: (aggregated.get(key)?.count || 0) + 1 });
  }
  return [...aggregated.values()].sort((left, right) => (
    JSON.stringify(left).localeCompare(JSON.stringify(right))
  ));
}

function addAnomaly(counts, code, increment = 1) {
  counts.set(code, (counts.get(code) || 0) + increment);
}

function snapshotAnomalies(anomalies) {
  return [...anomalies.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((left, right) => left.code.localeCompare(right.code));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function selectWireFacts(slot, anomalies) {
  let requestFacts;
  let headerSource;
  if (slot.requestExtra.length === 1) {
    requestFacts = slot.requestExtra[0];
    headerSource = 'extra-info';
  } else if (slot.requestExtra.length > 1) {
    addAnomaly(anomalies, 'ambiguous-request-extra-info');
    requestFacts = slot.requestExtra[0];
    headerSource = 'ambiguous';
  } else if (slot.requestBase) {
    requestFacts = slot.requestBase.headers;
    headerSource = 'base-fallback';
  } else {
    requestFacts = summarizeRequestHeaders({}, slot.expectedCapability);
    headerSource = 'missing';
  }

  let status = null;
  let allowOriginClass = 'absent';
  let responseSource = 'missing';
  if (slot.responseExtra.length === 1) {
    status = slot.responseExtra[0].status;
    allowOriginClass = slot.responseExtra[0].headers.allowOriginClass;
    responseSource = 'extra-info';
    if (slot.responseBase && slot.responseBase.status !== status) {
      addAnomaly(anomalies, 'conflicting-response-status');
    }
    if (
      slot.responseBase
      && slot.responseBase.headers.allowOriginClass !== 'absent'
      && slot.responseBase.headers.allowOriginClass !== allowOriginClass
    ) {
      addAnomaly(anomalies, 'conflicting-response-cors');
    }
  } else if (slot.responseExtra.length > 1) {
    addAnomaly(anomalies, 'ambiguous-response-extra-info');
    status = slot.responseExtra[0].status;
    allowOriginClass = slot.responseExtra[0].headers.allowOriginClass;
    responseSource = 'ambiguous';
  } else if (slot.responseBase) {
    status = slot.responseBase.status;
    allowOriginClass = slot.responseBase.headers.allowOriginClass;
    responseSource = 'base-fallback';
  }

  return {
    ...requestFacts,
    capabilityClass: slot.method === 'OPTIONS'
      ? 'not-applicable'
      : requestFacts.capabilityClass,
    preflightClass: slot.method === 'OPTIONS'
      ? requestFacts.preflightClass
      : 'not-applicable',
    headerSource,
    status,
    statusClass: statusClass(status),
    allowOriginClass,
    responseSource,
  };
}

function createHttpSlot(expectedCapability) {
  return {
    expectedCapability,
    target: null,
    method: 'OTHER',
    requestBase: null,
    requestExtra: [],
    responseBase: null,
    responseExtra: [],
    failed: false,
    redirect: false,
  };
}

function createWsSlot(expectedCapability) {
  return {
    expectedCapability,
    target: null,
    requestHeaders: [],
    responseHeaders: [],
    handshakeStatus: null,
    sentFrames: 0,
    receivedFrames: 0,
    frameErrors: 0,
    closed: false,
  };
}

function classifyWsProtocols(headers, expectedCapability, response = false) {
  const protocols = commaValues(headers, 'sec-websocket-protocol');
  const v1Count = protocols.filter(value => value === 'c3-v1').length;
  const capabilityValues = protocols.filter(value => value.startsWith(WS_CAPABILITY_PREFIX));
  let capabilityProtocolClass = 'missing';
  if (capabilityValues.length > 1) capabilityProtocolClass = 'duplicate';
  else if (capabilityValues.length === 1) {
    const candidate = capabilityValues[0].slice(WS_CAPABILITY_PREFIX.length);
    capabilityProtocolClass = !CAPABILITY_PATTERN.test(candidate)
      ? 'invalid'
      : safeEqualCapability(candidate, expectedCapability) ? 'match' : 'mismatch';
  }
  return {
    originClass: classifyOrigin(headers),
    capabilityProtocolClass,
    protocolSetClass: response
      ? protocols.length === 1 && v1Count === 1 ? 'exact' : 'unexpected'
      : protocols.length === 2 && v1Count === 1 && capabilityValues.length === 1
        ? 'exact'
        : 'unexpected',
    protocolV1Offered: response ? false : v1Count === 1,
    protocolV1Selected: response ? v1Count === 1 : false,
    protocolV1Ambiguous: v1Count > 1,
  };
}

export function createStudioCdpEvidenceReducer({
  backendOrigin,
  controlPlaneOrigin,
  expectedCapability,
  maxRecords = 4096,
}) {
  const exactBackendOrigin = canonicalBackendOrigin(backendOrigin);
  const exactControlPlaneOrigin = canonicalControlPlaneOrigin(controlPlaneOrigin);
  if (exactControlPlaneOrigin === exactBackendOrigin) {
    throw new TypeError('backendOrigin and controlPlaneOrigin must be distinct');
  }
  if (!CAPABILITY_PATTERN.test(expectedCapability || '')) {
    throw new TypeError('expectedCapability must be a valid local capability');
  }
  if (!Number.isInteger(maxRecords) || maxRecords < 1 || maxRecords > 100_000) {
    throw new TypeError('maxRecords must be an integer between 1 and 100000');
  }

  const httpSlots = new Map();
  const wsSlots = new Map();
  const anomalies = new Map();
  let events = 0;
  let ignored = 0;
  let malformed = 0;
  let overflowed = false;

  function validId(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 256;
  }

  function getSlot(map, id, factory) {
    if (!validId(id)) {
      malformed += 1;
      addAnomaly(anomalies, 'malformed-event');
      return null;
    }
    if (!map.has(id)) {
      if (httpSlots.size + wsSlots.size >= maxRecords) {
        if (!overflowed) addAnomaly(anomalies, 'record-limit-exceeded');
        overflowed = true;
        return null;
      }
      map.set(id, factory(expectedCapability));
    }
    return map.get(id);
  }

  function ingestHttp(method, params) {
    const slot = getSlot(httpSlots, params?.requestId, createHttpSlot);
    if (!slot) return;
    if (method === 'Network.requestWillBeSent') {
      if (slot.requestBase || slot.target) {
        slot.redirect = true;
        addAnomaly(anomalies, 'ambiguous-redirect');
        return;
      }
      const target = classifyNetworkTarget(
        params?.request?.url,
        exactBackendOrigin,
        exactControlPlaneOrigin,
      );
      if (target.targetClass === 'malformed') {
        malformed += 1;
        addAnomaly(anomalies, 'malformed-url');
      }
      slot.target = target;
      slot.method = safeMethod(params?.request?.method);
      slot.requestBase = {
        headers: summarizeRequestHeaders(
          params?.request?.headers,
          expectedCapability,
        ),
      };
      return;
    }
    if (method === 'Network.requestWillBeSentExtraInfo') {
      slot.requestExtra.push(summarizeRequestHeaders(
        params?.headers,
        expectedCapability,
      ));
      return;
    }
    if (method === 'Network.responseReceived') {
      if (slot.responseBase) addAnomaly(anomalies, 'duplicate-response-base');
      slot.responseBase = {
        status: Number.isInteger(params?.response?.status)
          ? params.response.status
          : null,
        headers: summarizeResponseHeaders(params?.response?.headers),
      };
      return;
    }
    if (method === 'Network.responseReceivedExtraInfo') {
      slot.responseExtra.push({
        status: Number.isInteger(params?.statusCode) ? params.statusCode : null,
        headers: summarizeResponseHeaders(params?.headers),
      });
      return;
    }
    if (method === 'Network.loadingFailed') slot.failed = true;
  }

  function ingestWebSocket(method, params) {
    const slot = getSlot(wsSlots, params?.requestId, createWsSlot);
    if (!slot) return;
    if (method === 'Network.webSocketCreated') {
      if (slot.target) {
        addAnomaly(anomalies, 'duplicate-websocket-created');
        return;
      }
      slot.target = classifyNetworkTarget(
        params?.url,
        exactBackendOrigin,
        exactControlPlaneOrigin,
      );
    } else if (method === 'Network.webSocketWillSendHandshakeRequest') {
      slot.requestHeaders.push(classifyWsProtocols(
        params?.request?.headers,
        expectedCapability,
      ));
    } else if (method === 'Network.webSocketHandshakeResponseReceived') {
      slot.handshakeStatus = Number.isInteger(params?.response?.status)
        ? params.response.status
        : null;
      slot.responseHeaders.push(classifyWsProtocols(
        params?.response?.headers,
        expectedCapability,
        true,
      ));
    } else if (method === 'Network.webSocketFrameSent') {
      slot.sentFrames += 1;
    } else if (method === 'Network.webSocketFrameReceived') {
      slot.receivedFrames += 1;
    } else if (method === 'Network.webSocketFrameError') {
      slot.frameErrors += 1;
    } else if (method === 'Network.webSocketClosed') {
      slot.closed = true;
    }
  }

  function ingest(method, params = {}) {
    if (typeof method !== 'string' || !method.startsWith('Network.')) {
      return;
    }
    events += 1;
    if (events > maxRecords * 16) {
      if (!overflowed) addAnomaly(anomalies, 'record-limit-exceeded');
      overflowed = true;
      return;
    }
    if (method.startsWith('Network.webSocket')) ingestWebSocket(method, params);
    else if (new Set([
      'Network.requestWillBeSent',
      'Network.requestWillBeSentExtraInfo',
      'Network.responseReceived',
      'Network.responseReceivedExtraInfo',
      'Network.loadingFailed',
    ]).has(method)) ingestHttp(method, params);
    else ignored += 1;
  }

  function snapshot() {
    const derivedAnomalies = new Map(anomalies);
    const http = [];
    const theiaControlPlaneHttp = [];
    const externalByScheme = { http: 0, https: 0, ws: 0, wss: 0 };
    let externalAttempts = 0;
    let otherLoopbackAttempts = 0;
    let unsupportedNetworkAttempts = 0;
    let orphaned = 0;

    for (const slot of httpSlots.values()) {
      if (!slot.target) {
        orphaned += 1;
        addAnomaly(derivedAnomalies, 'orphan-http-event');
        continue;
      }
      if (slot.target.targetClass === 'external') {
        externalAttempts += 1;
        if (Object.hasOwn(externalByScheme, slot.target.schemeClass)) {
          externalByScheme[slot.target.schemeClass] += 1;
        }
        continue;
      }
      if (slot.target.targetClass === 'other-loopback') {
        otherLoopbackAttempts += 1;
        continue;
      }
      if (slot.target.targetClass === 'unsupported-network') {
        unsupportedNetworkAttempts += 1;
        addAnomaly(derivedAnomalies, 'unsupported-network-scheme');
        continue;
      }
      if (new Set(['internal', 'ignored', 'malformed']).has(slot.target.targetClass)) continue;
      const wire = selectWireFacts(slot, derivedAnomalies);
      if (slot.target.targetClass === 'theia-control-plane') {
        theiaControlPlaneHttp.push({
          routeId: slot.target.routeId,
          targetClass: slot.target.targetClass,
          transportClass: slot.target.transportClass,
          phaseClass: slot.target.phaseClass,
          methodClass: slot.method,
          status: wire.status,
          statusClass: wire.statusClass,
          terminalClass: slot.failed ? 'failed' : wire.status === null ? 'missing' : 'response',
          responseSource: wire.responseSource,
          redirected: slot.redirect,
        });
        continue;
      }
      http.push({
        routeId: slot.target.routeId,
        targetClass: slot.target.targetClass,
        methodClass: slot.method,
        status: wire.status,
        statusClass: wire.statusClass,
        terminalClass: slot.failed ? 'failed' : wire.status === null ? 'missing' : 'response',
        originClass: wire.originClass,
        fetchSiteClass: wire.fetchSiteClass,
        capabilityClass: wire.capabilityClass,
        preflightClass: wire.preflightClass,
        allowOriginClass: wire.allowOriginClass,
        headerSource: wire.headerSource,
        responseSource: wire.responseSource,
        redirected: slot.redirect,
      });
    }

    const websockets = [];
    const theiaControlPlaneWebSockets = [];
    for (const slot of wsSlots.values()) {
      if (!slot.target) {
        orphaned += 1;
        addAnomaly(derivedAnomalies, 'orphan-websocket-event');
        continue;
      }
      if (slot.target.targetClass === 'external') {
        externalAttempts += 1;
        if (Object.hasOwn(externalByScheme, slot.target.schemeClass)) {
          externalByScheme[slot.target.schemeClass] += 1;
        }
        continue;
      }
      if (slot.target.targetClass === 'other-loopback') {
        otherLoopbackAttempts += 1;
        continue;
      }
      if (slot.target.targetClass === 'unsupported-network') {
        unsupportedNetworkAttempts += 1;
        addAnomaly(derivedAnomalies, 'unsupported-network-scheme');
        continue;
      }
      if (slot.target.targetClass === 'theia-control-plane') {
        if (slot.requestHeaders.length > 1 || slot.responseHeaders.length > 1) {
          addAnomaly(derivedAnomalies, 'ambiguous-websocket-handshake');
        }
        theiaControlPlaneWebSockets.push({
          targetClass: slot.target.targetClass,
          routeId: slot.target.routeId,
          transportClass: slot.target.transportClass,
          phaseClass: slot.target.phaseClass,
          handshakeStatus: slot.handshakeStatus,
          sentFrames: slot.sentFrames,
          receivedFrames: slot.receivedFrames,
          frameErrors: slot.frameErrors,
          closed: slot.closed,
        });
        continue;
      }
      const request = slot.requestHeaders.length === 1
        ? slot.requestHeaders[0]
        : null;
      const response = slot.responseHeaders.length === 1
        ? slot.responseHeaders[0]
        : null;
      if (slot.requestHeaders.length > 1 || slot.responseHeaders.length > 1) {
        addAnomaly(derivedAnomalies, 'ambiguous-websocket-handshake');
      }
      websockets.push({
        targetClass: slot.target.targetClass,
        routeId: slot.target.routeId,
        handshakeStatus: slot.handshakeStatus,
        originClass: request?.originClass || 'absent',
        capabilityProtocolClass: request?.capabilityProtocolClass || 'missing',
        requestProtocolSetClass: request?.protocolSetClass || 'unexpected',
        responseProtocolSetClass: response?.protocolSetClass || 'unexpected',
        protocolV1Offered: request?.protocolV1Offered === true,
        protocolV1Selected: response?.protocolV1Selected === true,
        sentFrames: slot.sentFrames,
        receivedFrames: slot.receivedFrames,
        frameErrors: slot.frameErrors,
        closed: slot.closed,
      });
    }

    const anomaliesOutput = snapshotAnomalies(derivedAnomalies);
    return deepFreeze({
      schemaVersion: STUDIO_CDP_EVIDENCE_SCHEMA_VERSION,
      counts: Object.freeze({
        events,
        protectedHttp: http.length,
        websockets: websockets.length,
        theiaControlPlaneHttp: theiaControlPlaneHttp.length,
        theiaControlPlaneWebSockets: theiaControlPlaneWebSockets.length,
        ignored,
        malformed,
        ambiguous: anomaliesOutput
          .filter(item => item.code.startsWith('ambiguous') || item.code.startsWith('conflicting'))
          .reduce((sum, item) => sum + item.count, 0),
        orphaned,
        externalAttempts,
        otherLoopbackAttempts,
        unsupportedNetworkAttempts,
      }),
      http: stableAggregate(http),
      websockets: stableAggregate(websockets),
      theiaControlPlane: Object.freeze({
        http: stableAggregate(theiaControlPlaneHttp),
        websockets: stableAggregate(theiaControlPlaneWebSockets),
      }),
      externalByScheme,
      anomalies: anomaliesOutput,
    });
  }

  return Object.freeze({ ingest, snapshot });
}

function failure(code, details = {}) {
  return Object.freeze({ code, ...details });
}

export function evaluateStudioCdpEvidence(
  snapshot,
  policy = STUDIO_M0_POLICY,
  runtimeEvidence = {},
) {
  const failures = [];
  if (snapshot?.schemaVersion !== STUDIO_CDP_EVIDENCE_SCHEMA_VERSION) {
    return Object.freeze({ verdict: 'FAIL', failures: [failure('invalid-schema')] });
  }
  if (snapshot.counts.externalAttempts !== 0) failures.push(failure('external-attempt'));
  if (snapshot.counts.otherLoopbackAttempts !== 0) failures.push(failure('other-loopback-attempt'));
  if (snapshot.counts.unsupportedNetworkAttempts !== 0) {
    failures.push(failure('unsupported-network-attempt'));
  }
  if (snapshot.counts.malformed !== 0) failures.push(failure('malformed-event'));
  if (snapshot.counts.ambiguous !== 0) failures.push(failure('ambiguous-wire-evidence'));
  if (snapshot.counts.orphaned !== 0) failures.push(failure('orphan-event'));
  if (snapshot.anomalies.length !== 0) {
    failures.push(failure('reducer-anomaly'));
  }
  if (
    !Number.isInteger(runtimeEvidence.observationDurationMs)
    || runtimeEvidence.observationDurationMs < policy.requiredSoakMs
  ) {
    failures.push(failure('insufficient-soak'));
  }

  const actualHttp = snapshot.http.filter(record => record.methodClass !== 'OPTIONS');
  for (const routeId of policy.requiredHttpRoutes) {
    if (!actualHttp.some(record => (
      record.routeId === routeId && record.methodClass === 'GET'
    ))) {
      failures.push(failure('missing-required-route', { routeId }));
    }
  }

  for (const record of snapshot.http) {
    if (record.targetClass === 'backend-other') {
      failures.push(failure('unexpected-backend-path', { routeId: record.routeId }));
      continue;
    }
    if (record.headerSource !== 'extra-info') {
      failures.push(failure('insufficient-wire-evidence', { routeId: record.routeId }));
    }
    if (record.responseSource === 'missing') {
      failures.push(failure('missing-response-evidence', { routeId: record.routeId }));
    }
    if (record.originClass !== 'opaque') {
      failures.push(failure('origin-boundary-failed', { routeId: record.routeId }));
    }
    if (record.fetchSiteClass !== 'cross-site') {
      failures.push(failure('fetch-site-boundary-failed', { routeId: record.routeId }));
    }
    if (record.allowOriginClass !== 'opaque') {
      failures.push(failure('cors-response-boundary-failed', { routeId: record.routeId }));
    }
    if (record.methodClass === 'OPTIONS') {
      if (record.preflightClass !== 'exact' || record.status !== 204) {
        failures.push(failure('preflight-contract-failed', { routeId: record.routeId }));
      }
      continue;
    }
    if (record.methodClass === 'OTHER') {
      failures.push(failure('unsupported-http-method', { routeId: record.routeId }));
    }
    if (record.capabilityClass !== 'match') {
      failures.push(failure('capability-boundary-failed', { routeId: record.routeId }));
    }
    const mediaDisabled = record.routeId === STUDIO_ROUTE_IDS.MEDIA_HISTORY
      && record.methodClass === 'GET'
      && record.status === 404;
    if (
      record.redirected
      || record.terminalClass !== 'response'
      || (!mediaDisabled && record.statusClass !== '2xx')
    ) {
      failures.push(failure('http-status-contract-failed', { routeId: record.routeId }));
    }
  }

  if (!actualHttp.some(record => (
    record.routeId === policy.requiredPostRoute
    && record.methodClass === 'POST'
    && record.statusClass === '2xx'
  ))) {
    failures.push(failure('missing-settings-post'));
  }

  const theiaHttp = Array.isArray(snapshot.theiaControlPlane?.http)
    ? snapshot.theiaControlPlane.http
    : [];
  const theiaWebSockets = Array.isArray(snapshot.theiaControlPlane?.websockets)
    ? snapshot.theiaControlPlane.websockets
    : [];
  if (!snapshot.theiaControlPlane || !Array.isArray(snapshot.theiaControlPlane.http)) {
    failures.push(failure('missing-theia-control-plane-evidence'));
  }
  const theiaPollingCount = theiaHttp.reduce(
    (total, record) => total + (Number.isInteger(record.count) ? record.count : 0),
    0,
  );
  if (
    !Number.isInteger(policy.minTheiaPollingHttp)
    || policy.minTheiaPollingHttp < 0
    || !Number.isInteger(policy.maxTheiaPollingHttp)
    || policy.maxTheiaPollingHttp < 0
    || policy.minTheiaPollingHttp > policy.maxTheiaPollingHttp
    || theiaPollingCount < policy.minTheiaPollingHttp
    || theiaPollingCount > policy.maxTheiaPollingHttp
  ) {
    failures.push(failure('theia-polling-bound-exceeded'));
  }
  if (!theiaHttp.every(record => (
    Number.isInteger(record.count)
    && record.count > 0
    && record.routeId === STUDIO_ROUTE_IDS.THEIA_SOCKET_IO
    && record.targetClass === 'theia-control-plane'
    && record.transportClass === 'polling'
    && new Set(['polling-handshake', 'polling-session']).has(record.phaseClass)
    && new Set(['GET', 'POST']).has(record.methodClass)
    && (record.phaseClass !== 'polling-handshake' || record.methodClass === 'GET')
    && record.statusClass === '2xx'
    && record.terminalClass === 'response'
    && record.responseSource !== 'missing'
    && !record.redirected
  ))) {
    failures.push(failure('theia-polling-contract-failed'));
  }

  const theiaWebSocketCount = theiaWebSockets.reduce(
    (total, record) => total + (Number.isInteger(record.count) ? record.count : 0),
    0,
  );
  const everyTheiaWebSocketValid = theiaWebSocketCount === 1
    && theiaWebSockets.every(record => (
      record.count === 1
      && record.routeId === STUDIO_ROUTE_IDS.THEIA_SOCKET_IO
      && record.targetClass === 'theia-control-plane'
      && record.transportClass === 'websocket'
      && record.phaseClass === 'websocket-upgrade'
      && record.handshakeStatus === 101
      && record.sentFrames > 0
      && record.receivedFrames > 0
      && record.frameErrors === 0
      && !record.closed
    ));
  if (!everyTheiaWebSocketValid) {
    failures.push(failure('theia-websocket-contract-failed'));
  }

  const websocketCount = snapshot.websockets.reduce(
    (total, record) => total + (Number.isInteger(record.count) ? record.count : 0),
    0,
  );
  const closedWebSocketCount = snapshot.websockets.reduce(
    (total, record) => total + (
      record.closed && Number.isInteger(record.count) ? record.count : 0
    ),
    0,
  );
  const everyWebSocketValid = (
    Number.isInteger(policy.requiredBackendWebSocketCount)
    && policy.requiredBackendWebSocketCount > 0
    && Number.isInteger(policy.requiredClosedBackendWebSocketCount)
    && policy.requiredClosedBackendWebSocketCount >= 0
    && policy.requiredClosedBackendWebSocketCount < policy.requiredBackendWebSocketCount
    && websocketCount === policy.requiredBackendWebSocketCount
    && closedWebSocketCount === policy.requiredClosedBackendWebSocketCount
  )
    && snapshot.websockets.every(record => (
      Number.isInteger(record.count)
      && record.count > 0
      && record.routeId === STUDIO_ROUTE_IDS.WS_BRIDGE
      && record.handshakeStatus === 101
      && record.originClass === 'opaque'
      && record.capabilityProtocolClass === 'match'
      && record.requestProtocolSetClass === 'exact'
      && record.responseProtocolSetClass === 'exact'
      && record.protocolV1Offered
      && record.protocolV1Selected
      && record.sentFrames > 0
      && record.receivedFrames > 0
      && record.frameErrors === 0
    ));
  if (!everyWebSocketValid) failures.push(failure('websocket-contract-failed'));

  const uniqueFailures = stableAggregate(failures).map(({ count: _count, ...item }) => item);
  return deepFreeze({
    verdict: uniqueFailures.length === 0 ? 'PASS' : 'FAIL',
    failures: uniqueFailures,
  });
}
