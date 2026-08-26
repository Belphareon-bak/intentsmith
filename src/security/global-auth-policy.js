import { timingSafeEqual } from 'node:crypto';
import {
  LEGACY_LOCAL_CAPABILITY_HEADER,
  legacyLocalCapabilitiesEqual,
} from './legacy-local-access-policy.js';

export const GLOBAL_AUTH_REQUIRED = 'INTENTSMITH_AUTH_REQUIRED';
export const GLOBAL_AUTH_SCOPE_REQUIRED = 'INTENTSMITH_AUTH_SCOPE_REQUIRED';
export const GLOBAL_AUTH_CREDENTIAL_AMBIGUOUS = 'INTENTSMITH_AUTH_CREDENTIAL_AMBIGUOUS';
export const GLOBAL_AUTH_WS_PROTOCOL_PREFIX = 'intentsmith-auth-v1.';

export const RouteAuthClass = Object.freeze({
  PUBLIC: 'PUBLIC',
  READ: 'READ',
  MUTATE: 'MUTATE',
  APPROVAL: 'APPROVAL',
  ADMIN: 'ADMIN',
});

const PUBLIC_ROUTES = new Set([
  'GET /',
  'GET /api/health',
  'GET /health',
]);

const APPROVAL_ROUTE = /(?:\/approve|\/confirm|\/acknowledge)(?:\/|$|:)/;
const ADMIN_ROUTE = /^(?:GET|POST|PUT|PATCH|DELETE) \/api\/(?:security(?:\/|$)|reset(?:\/|$)|features\/reset(?:\/|$)|workspace\/(?:file|directory|rename)(?:\/|$)|marketplace\/(?:install|update|installed)(?:\/|$)|system\/(?:backup|restore|shutdown-backup|vacuum|drain|clean|models\/pull|models)(?:\/|$))/;
const ROUTE_KEY = /^(GET|HEAD|POST|PUT|PATCH|DELETE) \/\S*$/;
const LOOPBACK_PEERS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1']);

function decision(allowed, values = {}) {
  return Object.freeze({ allowed, ...values });
}

function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || !left || !right) return false;
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  const size = Math.max(leftBytes.length, rightBytes.length);
  const paddedLeft = Buffer.alloc(size);
  const paddedRight = Buffer.alloc(size);
  leftBytes.copy(paddedLeft);
  rightBytes.copy(paddedRight);
  const equal = timingSafeEqual(paddedLeft, paddedRight);
  return equal && leftBytes.length === rightBytes.length;
}

const CREDENTIAL_PARSE_STATE = Object.freeze({
  ABSENT: 'absent',
  VALID: 'valid',
  AMBIGUOUS: 'ambiguous',
});

function parsedCredential(state, token = null) {
  return Object.freeze({ state, token });
}

function bearer(headers = {}) {
  if (!Object.hasOwn(headers, 'authorization')) {
    return parsedCredential(CREDENTIAL_PARSE_STATE.ABSENT);
  }
  const raw = headers.authorization;
  if (Array.isArray(raw) || typeof raw !== 'string') {
    return parsedCredential(CREDENTIAL_PARSE_STATE.AMBIGUOUS);
  }
  const match = /^Bearer ([^\s]+)$/i.exec(raw);
  return match
    ? parsedCredential(CREDENTIAL_PARSE_STATE.VALID, match[1])
    : parsedCredential(CREDENTIAL_PARSE_STATE.AMBIGUOUS);
}

function oneHeader(headers, name) {
  if (!Object.hasOwn(headers ?? {}, name)) {
    return parsedCredential(CREDENTIAL_PARSE_STATE.ABSENT);
  }
  const value = headers[name];
  return typeof value === 'string' && value.length > 0
    ? parsedCredential(CREDENTIAL_PARSE_STATE.VALID, value)
    : parsedCredential(CREDENTIAL_PARSE_STATE.AMBIGUOUS);
}

function validScopes(candidate) {
  return Array.isArray(candidate)
    && candidate.every(scope => typeof scope === 'string' && scope.length > 0);
}

export function classifyRouteAuth(routeKey) {
  if (typeof routeKey !== 'string' || !ROUTE_KEY.test(routeKey)) return null;
  if (PUBLIC_ROUTES.has(routeKey)) return RouteAuthClass.PUBLIC;
  if (APPROVAL_ROUTE.test(routeKey)) return RouteAuthClass.APPROVAL;
  if (ADMIN_ROUTE.test(routeKey)) return RouteAuthClass.ADMIN;
  return /^(?:GET|HEAD) /.test(routeKey) ? RouteAuthClass.READ : RouteAuthClass.MUTATE;
}

export function requiredScopes(routeClass, routeKey) {
  const exact = `route:${routeKey}`;
  switch (routeClass) {
    case RouteAuthClass.PUBLIC: return Object.freeze([]);
    case RouteAuthClass.READ: return Object.freeze(['*', 'admin', 'read', exact]);
    case RouteAuthClass.MUTATE: return Object.freeze(['*', 'admin', 'write', exact]);
    case RouteAuthClass.APPROVAL: return Object.freeze(['*', 'admin', 'approve', exact]);
    case RouteAuthClass.ADMIN: return Object.freeze(['*', 'admin', exact]);
    default: return null;
  }
}

export function assertGlobalAuthRouteTable(routes) {
  if (!routes || typeof routes !== 'object' || Array.isArray(routes)) {
    throw new TypeError('Global auth requires a route object');
  }
  for (const [routeKey, handler] of Object.entries(routes)) {
    if (typeof handler !== 'function' || !classifyRouteAuth(routeKey)) {
      const error = new Error(`Global auth cannot classify route: ${routeKey}`);
      error.code = 'INTENTSMITH_AUTH_ROUTE_UNCLASSIFIED';
      throw error;
    }
  }
  return Object.freeze({ routeCount: Object.keys(routes).length });
}

export function encodeWebSocketBearerCredential(token) {
  if (typeof token !== 'string' || token.length === 0) {
    throw new TypeError('WebSocket bearer token must be non-empty');
  }
  return `${GLOBAL_AUTH_WS_PROTOCOL_PREFIX}${Buffer.from(token).toString('base64url')}`;
}

export function parseWebSocketBearerCredential(rawProtocols) {
  if (rawProtocols === undefined || rawProtocols === null || rawProtocols === '') {
    return parsedCredential(CREDENTIAL_PARSE_STATE.ABSENT);
  }
  if (typeof rawProtocols !== 'string') {
    return parsedCredential(CREDENTIAL_PARSE_STATE.AMBIGUOUS);
  }
  const matches = rawProtocols.split(',')
    .map(value => value.trim())
    .filter(value => value.startsWith(GLOBAL_AUTH_WS_PROTOCOL_PREFIX));
  if (matches.length === 0) return parsedCredential(CREDENTIAL_PARSE_STATE.ABSENT);
  if (matches.length !== 1) return parsedCredential(CREDENTIAL_PARSE_STATE.AMBIGUOUS);
  const encoded = matches[0].slice(GLOBAL_AUTH_WS_PROTOCOL_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
    return parsedCredential(CREDENTIAL_PARSE_STATE.AMBIGUOUS);
  }
  try {
    const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
    return decoded && Buffer.from(decoded).toString('base64url') === encoded
      ? parsedCredential(CREDENTIAL_PARSE_STATE.VALID, decoded)
      : parsedCredential(CREDENTIAL_PARSE_STATE.AMBIGUOUS);
  } catch {
    return parsedCredential(CREDENTIAL_PARSE_STATE.AMBIGUOUS);
  }
}

export function extractWebSocketBearerCredential(rawProtocols) {
  const parsed = parseWebSocketBearerCredential(rawProtocols);
  return parsed.state === CREDENTIAL_PARSE_STATE.VALID ? parsed.token : null;
}

export function authorizeGlobalRequest({
  routeKey,
  routeClass = classifyRouteAuth(routeKey),
  headers = {},
  remoteAddress,
  production = process.env.NODE_ENV === 'production',
  localCapability,
  adminToken,
  validateApiToken,
  websocketProtocols,
  websocketLocalCapability,
  websocketLocalCredential,
} = {}) {
  if (!routeClass || !Object.values(RouteAuthClass).includes(routeClass)) {
    return decision(false, {
      status: 500,
      code: 'INTENTSMITH_AUTH_ROUTE_UNCLASSIFIED',
    });
  }
  if (routeClass === RouteAuthClass.PUBLIC) {
    return decision(true, { routeClass, subject: null, credentialType: 'public' });
  }

  const localHeader = oneHeader(headers, LEGACY_LOCAL_CAPABILITY_HEADER.toLowerCase());
  const adminHeader = oneHeader(headers, 'x-admin-token');
  const bearerHeader = bearer(headers);
  const bearerProtocol = parseWebSocketBearerCredential(websocketProtocols);
  const localProtocol = websocketLocalCredential === undefined
    ? websocketLocalCapability === undefined
      ? parsedCredential(CREDENTIAL_PARSE_STATE.ABSENT)
      : typeof websocketLocalCapability === 'string' && websocketLocalCapability.length > 0
        ? parsedCredential(CREDENTIAL_PARSE_STATE.VALID, websocketLocalCapability)
        : parsedCredential(CREDENTIAL_PARSE_STATE.AMBIGUOUS)
    : websocketLocalCredential?.state === CREDENTIAL_PARSE_STATE.ABSENT
      ? parsedCredential(CREDENTIAL_PARSE_STATE.ABSENT)
      : websocketLocalCredential?.state === CREDENTIAL_PARSE_STATE.VALID
        && typeof websocketLocalCredential.token === 'string'
        && websocketLocalCredential.token.length > 0
        ? parsedCredential(CREDENTIAL_PARSE_STATE.VALID, websocketLocalCredential.token)
        : parsedCredential(CREDENTIAL_PARSE_STATE.AMBIGUOUS);
  const credentials = [localHeader, localProtocol, adminHeader, bearerHeader, bearerProtocol];
  if (credentials.some(item => item.state === CREDENTIAL_PARSE_STATE.AMBIGUOUS)) {
    return decision(false, {
      status: 400,
      code: GLOBAL_AUTH_CREDENTIAL_AMBIGUOUS,
      routeClass,
    });
  }
  const presented = credentials.filter(item => item.state === CREDENTIAL_PARSE_STATE.VALID);
  const credentialCount = presented.length;
  if (credentialCount > 1) {
    return decision(false, {
      status: 400,
      code: GLOBAL_AUTH_CREDENTIAL_AMBIGUOUS,
      routeClass,
    });
  }

  const localCredential = localHeader.token || localProtocol.token;
  const adminCredential = adminHeader.token;
  const bearerToken = bearerHeader.token || bearerProtocol.token;

  if (localCredential) {
    if (legacyLocalCapabilitiesEqual(localCapability, localCredential)) {
      return decision(true, {
        routeClass,
        credentialType: 'local-capability',
        subject: Object.freeze({ actorType: 'user', actorId: 'local-operator' }),
      });
    }
    return decision(false, { status: 401, code: GLOBAL_AUTH_REQUIRED, routeClass });
  }

  if (adminCredential && safeEqual(adminCredential, adminToken)) {
    return decision(true, {
      routeClass,
      credentialType: 'admin-token',
      subject: Object.freeze({ actorType: 'user', actorId: 'admin-token' }),
    });
  }

  if (adminCredential) {
    return decision(false, { status: 401, code: GLOBAL_AUTH_REQUIRED, routeClass });
  }

  const presentedToken = bearerToken;
  if (presentedToken && safeEqual(presentedToken, adminToken)) {
    return decision(true, {
      routeClass,
      credentialType: 'admin-token',
      subject: Object.freeze({ actorType: 'user', actorId: 'admin-token' }),
    });
  }

  if (presentedToken && typeof validateApiToken === 'function') {
    const token = validateApiToken(presentedToken);
    if (token?.valid === true && validScopes(token.scopes)) {
      const accepted = requiredScopes(routeClass, routeKey);
      if (accepted.some(scope => token.scopes.includes(scope))) {
        return decision(true, {
          routeClass,
          credentialType: 'api-token',
          scopes: Object.freeze([...token.scopes]),
          subject: Object.freeze({ actorType: 'user', actorId: `api-token:${token.id}` }),
        });
      }
      return decision(false, {
        status: 403,
        code: GLOBAL_AUTH_SCOPE_REQUIRED,
        routeClass,
        requiredScopes: accepted,
      });
    }
  }

  if (!production && LOOPBACK_PEERS.has(String(remoteAddress).toLowerCase())) {
    return decision(true, {
      routeClass,
      credentialType: 'development-loopback',
      subject: Object.freeze({ actorType: 'user', actorId: 'local-operator' }),
    });
  }

  return decision(false, { status: 401, code: GLOBAL_AUTH_REQUIRED, routeClass });
}
