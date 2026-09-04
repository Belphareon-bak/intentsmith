// Mobile gateway authorization policy.
//
// This module deliberately contains no listener and no route *handlers*.  It is
// the deterministic boundary the separate /m1 listener consults before any
// handler runs.  Keeping the decision independent of the transport is what let
// it be tested before any network exposure existed, and it is why the legacy
// API and WebSocket terminal cannot become reachable by accident: this table is
// the only thing that says yes, and it lists nothing but /m1.
//
// Three access classes, and the reason the middle one exists:
//
//   public        — no token.  /m1/health only, so a client can distinguish
//                   "network down" from "server down" from "token bad".
//   authenticated — a valid device token, but no particular scope.  Used only
//                   for reading the state of one's own operation (MD-19 §4.1):
//                   that read must never be the thing a device lacks authority
//                   for, or an UNKNOWN becomes permanently unresolvable.
//   scoped        — a valid token carrying the exact scope named below.
//
// Everything not in the table is denied.  There is no wildcard and no prefix
// match.

import { validateDeviceToken } from './pairing.js';
import { MOBILE_ERRORS } from './protocol.js';

/**
 * Route table.  `path` is either an exact string or a pattern whose `:param`
 * segments bind one path segment each.  No pattern may end in a wildcard —
 * default-deny is only meaningful if the table cannot over-match.
 */
export const MOBILE_ROUTE_POLICY = Object.freeze([
  // Public — diagnostics only, read-only, no data.
  Object.freeze({ method: 'GET', path: '/m1/health', scope: null, access: 'public' }),
  // Public — the pairing entry point.  Its protection is the single-use code,
  // the TTL, and the kill switch, not a token the device does not yet have.
  Object.freeze({ method: 'POST', path: '/m1/pair/claim', scope: null, access: 'public' }),

  // Authenticated, scope-free — see MD-19 §4.1 rule 1 above.  The recovery
  // surface is scope-free for the same reason as the lookup: once the open
  // operation cap is reached every mutation is refused, so if releasing the cap
  // itself required a scope the device could lack, the app would have no way
  // out of a state it cannot leave (UI-DESIGN §6.9).  All three act only on the
  // calling device's own records.
  Object.freeze({ method: 'GET',  path: '/m1/operations',                     scope: null, access: 'authenticated' }),
  Object.freeze({ method: 'GET',  path: '/m1/operations/:operationId',        scope: null, access: 'authenticated' }),
  Object.freeze({ method: 'POST', path: '/m1/operations/:operationId/abandon', scope: null, access: 'authenticated' }),

  // Scoped.
  Object.freeze({ method: 'GET',  path: '/m1/capabilities',            scope: 'read:capabilities' }),
  Object.freeze({ method: 'GET',  path: '/m1/conversations',           scope: 'read:chat' }),
  Object.freeze({ method: 'GET',  path: '/m1/conversations/:id',       scope: 'read:chat' }),
  Object.freeze({ method: 'GET',  path: '/m1/projects',                scope: 'read:projects' }),
  Object.freeze({ method: 'GET',  path: '/m1/projects/:id',            scope: 'read:projects' }),
  Object.freeze({ method: 'GET',  path: '/m1/settings',                scope: 'read:settings' }),
  Object.freeze({ method: 'POST', path: '/m1/chat',                    scope: 'write:chat' }),
  Object.freeze({ method: 'GET',  path: '/m1/notifications',           scope: 'read:notifications' }),
  Object.freeze({ method: 'POST', path: '/m1/notifications/ack',       scope: 'write:notifications' }),
  Object.freeze({ method: 'GET',  path: '/m1/approvals',               scope: 'read:approvals' }),
  Object.freeze({ method: 'POST', path: '/m1/approvals/:id/decide',    scope: 'write:approvals' }),
]);

const UNAUTHORIZED_HEADERS = Object.freeze({ 'WWW-Authenticate': 'Bearer' });

function normalizeMethod(method) {
  return typeof method === 'string' ? method.trim().toUpperCase() : '';
}

function normalizePath(pathname) {
  if (typeof pathname !== 'string') return '';
  const trimmed = pathname.trim();
  // Reject anything that could normalise into a different path later.  We match
  // the raw form and refuse to be clever: `.` and `..` segments, backslashes,
  // encoded slashes, and repeated slashes are simply not valid here.
  if (!trimmed.startsWith('/')) return '';
  if (trimmed.includes('\\') || trimmed.includes('//')) return '';
  if (/%2f/i.test(trimmed) || /%5c/i.test(trimmed)) return '';
  const segments = trimmed.split('/');
  if (segments.some(segment => segment === '.' || segment === '..')) return '';
  // Trailing slash is normalised away so /m1/health/ and /m1/health are one
  // route rather than one allowed and one 404.
  return trimmed.length > 1 && trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

function matchPattern(pattern, pathname) {
  if (!pattern.includes(':')) {
    return pattern === pathname ? {} : null;
  }
  const patternParts = pattern.split('/');
  const pathParts = pathname.split('/');
  if (patternParts.length !== pathParts.length) return null;

  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    const expected = patternParts[i];
    const actual = pathParts[i];
    if (expected.startsWith(':')) {
      // A parameter binds exactly one non-empty segment.
      if (!actual) return null;
      params[expected.slice(1)] = decodeURIComponent(actual);
      continue;
    }
    if (expected !== actual) return null;
  }
  return params;
}

export function matchMobileRoute(method, pathname, policy = MOBILE_ROUTE_POLICY) {
  const normalizedMethod = normalizeMethod(method);
  const normalizedPath = normalizePath(pathname);
  if (!normalizedPath) return null;

  for (const route of policy) {
    if (route.method !== normalizedMethod) continue;
    const params = matchPattern(route.path, normalizedPath);
    if (params) return { ...route, params };
  }
  return null;
}

/**
 * Extract only an Authorization Bearer token.  Admin-token headers and query
 * parameters are intentionally unsupported on the mobile boundary: a token in a
 * query string ends up in logs and browser history, and accepting
 * `X-Admin-Token` here would let the phone present admin authority at all.
 */
export function extractBearerToken(headers = {}) {
  const authorizationValues = Object.entries(headers)
    .filter(([name]) => name.toLowerCase() === 'authorization')
    .flatMap(([, value]) => Array.isArray(value) ? value : [value]);

  if (authorizationValues.length !== 1 || typeof authorizationValues[0] !== 'string') {
    return null;
  }

  const match = /^Bearer\s+([^\s,]+)$/i.exec(authorizationValues[0].trim());
  return match?.[1] || null;
}

function denied(descriptor, extra = {}) {
  return {
    allowed: false,
    status: descriptor.status,
    reason: descriptor.code,
    error: descriptor,
    ...extra,
  };
}

/**
 * The single authorization decision for the mobile boundary.
 *
 * @returns {{allowed: true, status: 200, route, params, principal}
 *          |{allowed: false, status: number, reason: string, error, ...}}
 */
export function authorizeMobileRequest({
  rawDb,
  method,
  pathname,
  headers,
  routePolicy = MOBILE_ROUTE_POLICY,
  now = Date.now(),
}) {
  const route = matchMobileRoute(method, pathname, routePolicy);
  if (!route) {
    return denied(MOBILE_ERRORS.ROUTE_NOT_ALLOWED);
  }

  // Health and pair/claim are deliberately public so diagnostics can separate
  // network, server, and token failures, and so a device with no token yet has
  // a way in.  Both must stay read-only-ish and minimal.
  if (route.access === 'public') {
    return { allowed: true, status: 200, route, params: route.params, principal: null };
  }

  const token = extractBearerToken(headers);
  if (!token) {
    return denied(MOBILE_ERRORS.TOKEN_MISSING, { headers: UNAUTHORIZED_HEADERS });
  }

  const principal = validateDeviceToken(rawDb, token, { now });
  if (!principal.valid) {
    // §8.3: the cause travels to the client.  invalid / expired / revoked lead
    // to three different screens, so collapsing them would make those screens
    // unbuildable.
    return denied(principal.error, { headers: UNAUTHORIZED_HEADERS });
  }

  const identity = {
    id: principal.id,
    deviceId: principal.deviceId,
    name: principal.name,
    scopes: principal.scopes,
  };

  if (route.access === 'authenticated') {
    return { allowed: true, status: 200, route, params: route.params, principal: identity };
  }

  if (!Array.isArray(principal.scopes) || !principal.scopes.includes(route.scope)) {
    return denied(MOBILE_ERRORS.SCOPE_REQUIRED, {
      requiredScope: route.scope,
      principal: identity,
    });
  }

  return { allowed: true, status: 200, route, params: route.params, principal: identity };
}

export default {
  MOBILE_ROUTE_POLICY,
  matchMobileRoute,
  extractBearerToken,
  authorizeMobileRequest,
};
