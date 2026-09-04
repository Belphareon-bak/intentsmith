// Mobile gateway listener — S-2 / S-3.
// ==============================================================================
//
// The separate listener from PLAN.md §2.  It is a different process from the
// legacy server on purpose: a scope middleware mounted on the existing listener
// would be bypassable by simply asking for /api/* or /c3/ws on the same port,
// which is the attack the whole design exists to prevent.
//
// What this process exposes: /m1/* as enumerated in gateway-policy, plus an
// optional static client.  Nothing else — there is no proxy path, no catch-all,
// and no way to reach the legacy API through it.  The upstream connection is
// outbound only and hard-coded to the four fields chat needs.
//
// Bind policy (PLAN.md §8.1): loopback unless an operator explicitly opts out.
// The ban on non-loopback binds is a *deployment* rule that this code enforces
// rather than assumes; the flag is deliberately verbose so it cannot be set by
// accident or copied from a snippet without noticing.
//
// ==============================================================================

import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { authorizeMobileRequest, matchMobileRoute } from './gateway-policy.js';
import { registerGatewayInstance, reapDeadInstances } from './gateway-instance.js';
import { APPROVAL_RESPONSE_HEADERS, MOBILE_HANDLERS } from './handlers.js';
import { MOBILE_ERRORS, PROTOCOL_VERSION, mobileError } from './protocol.js';
import { OperationJournal } from './operation-journal.js';
import { UpstreamClient } from './upstream.js';
import { createUpstreamRemoteCorePort } from '../remote-core/port.js';

const CLIENT_DIR = fileURLToPath(new URL('./client/', import.meta.url));

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);

/** The exact opt-out phrase.  Anything else, including "true"/"1", fails closed. */
export const REMOTE_BIND_ACKNOWLEDGEMENT = 'i-accept-unproven-remote-boundary';

const MAX_BODY_BYTES = 1_000_000;

const APPROVAL_ROUTE_KEYS = new Set([
  'GET /m1/approvals',
  'POST /m1/approvals/:id/decide',
]);

/**
 * Enforce the §8.1 bind rule.
 *
 * @throws {Error} with code `C3_MOBILE_GATEWAY_LOOPBACK_REQUIRED`
 */
export function assertMobileGatewayBind(host, env = process.env) {
  const normalized = typeof host === 'string' ? host.trim().toLowerCase() : '';
  if (LOOPBACK_HOSTS.has(normalized)) return host;

  if (env.C3_MOBILE_ALLOW_REMOTE === REMOTE_BIND_ACKNOWLEDGEMENT) {
    return host;
  }

  const error = new Error(
    `Refusing to bind the mobile gateway to non-loopback host "${String(host)}". `
    + 'docs/mobile/PLAN.md §8.1 forbids remote exposure until the boundary negative '
    + `tests pass. To override deliberately, set C3_MOBILE_ALLOW_REMOTE=${REMOTE_BIND_ACKNOWLEDGEMENT}.`,
  );
  error.code = 'C3_MOBILE_GATEWAY_LOOPBACK_REQUIRED';
  throw error;
}

// ── Static client (optional) ─────────────────────────────────────────────────
//
// An exact filename → content-type allow-list rather than a directory served by
// path join.  With no user-controlled path ever reaching the filesystem, path
// traversal is not mitigated here, it is structurally absent.
const STATIC_FILES = Object.freeze({
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.css': { file: 'app.css', type: 'text/css; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/manifest.webmanifest': { file: 'manifest.webmanifest', type: 'application/manifest+json' },
  '/sw.js': { file: 'sw.js', type: 'text/javascript; charset=utf-8' },
});

function isClientEnabled(env) {
  return env.C3_MOBILE_UI !== 'off';
}

/**
 * Create (but do not start) the gateway.
 *
 * @param {Object} deps
 * @param {Object} deps.rawDb        better-sqlite3 handle
 * @param {Object} [deps.upstream]   injected for tests
 * @param {Object} [deps.journal]
 * @param {Object} [deps.env]
 * @param {Object} [deps.logger]
 */
export function createMobileGateway({
  rawDb,
  upstream = new UpstreamClient(),
  journal = null,
  env = process.env,
  logger = console,
  instance = null,
  corePort = null,
} = {}) {
  if (!rawDb) throw new Error('createMobileGateway requires a database handle');

  // Registered before the journal is usable, so from the first row this gateway
  // could open, it is already visible as live to any other instance's sweep.
  // An injected journal is bound here rather than at its construction: the
  // process entrypoint builds it before the gateway exists.
  const gatewayInstance = instance || registerGatewayInstance(rawDb);
  const operationJournal = (journal || new OperationJournal(rawDb))
    .bindInstance(gatewayInstance.instanceId);
  const remoteCorePort = corePort || createUpstreamRemoteCorePort(upstream);

  const server = http.createServer(async (req, res) => {
    try {
      await handleRequest(req, res, {
        rawDb,
        upstream,
        corePort: remoteCorePort,
        journal: operationJournal,
        env,
        logger,
      });
    } catch (error) {
      logger.error?.('MobileGateway', `Unhandled: ${error.message}`);
      // Never leak an internal message to the phone; the cause goes to the log.
      sendJson(
        res,
        500,
        { ok: false, error: { code: 'internal_error', protocolVersion: PROTOCOL_VERSION } },
        responseHeadersForRequest(req.method, req.url),
      );
    }
  });

  return { server, journal: operationJournal, instance: gatewayInstance };
}

async function handleRequest(req, res, ctx) {
  const url = new URL(req.url || '/', 'http://gateway.local');
  const pathname = url.pathname;

  // CORS is deliberately restrictive: the client is served from this same
  // origin, so no cross-origin access is required and none is granted.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');

  // ── Static client ──────────────────────────────────────────────────────
  if (!pathname.startsWith('/m1')) {
    if (!isClientEnabled(ctx.env)) {
      return sendError(res, MOBILE_ERRORS.ROUTE_NOT_ALLOWED);
    }
    const entry = STATIC_FILES[pathname];
    if (!entry) {
      return sendError(res, MOBILE_ERRORS.ROUTE_NOT_ALLOWED);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendError(res, MOBILE_ERRORS.ROUTE_NOT_ALLOWED, {}, 405);
    }
    try {
      const body = readFileSync(path.join(CLIENT_DIR, entry.file));
      res.writeHead(200, {
        'content-type': entry.type,
        'content-length': body.length,
        // The client is a single static bundle; caching it defeats iteration
        // during the spike and saves little on a LAN.
        'cache-control': 'no-cache',
      });
      return res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      return sendError(res, MOBILE_ERRORS.ROUTE_NOT_ALLOWED);
    }
  }

  // ── /m1 — policy decides before anything else runs ─────────────────────
  // Resolve route-owned transport headers before authorization. They are used
  // for failures that occur before a handler can return its own headers.
  const routeResponseHeaders = responseHeadersForRoute(req.method, pathname);

  const decision = authorizeMobileRequest({
    rawDb: ctx.rawDb,
    method: req.method,
    pathname,
    headers: req.headers,
  });

  if (!decision.allowed) {
    if (decision.headers) {
      for (const [name, value] of Object.entries(decision.headers)) res.setHeader(name, value);
    }
    return sendError(res, decision.error, extrasFor(decision), null, routeResponseHeaders);
  }

  const routeKey = `${req.method.toUpperCase()} ${decision.route.path}`;
  const handler = MOBILE_HANDLERS[routeKey];
  if (!handler) {
    // A route in the policy with no handler is a wiring bug, not a client
    // error.  Fail closed and make it loud rather than 404 and hide it.
    ctx.logger.error?.('MobileGateway', `Policy allows ${routeKey} but no handler is registered`);
    return sendJson(
      res,
      500,
      {
        ok: false,
        error: { code: 'handler_missing', retryable: false, protocolVersion: PROTOCOL_VERSION },
      },
      routeResponseHeaders,
    );
  }

  let body = null;
  if (req.method === 'POST') {
    const parsed = await readJsonBody(req);
    if (!parsed.ok) {
      return sendError(
        res,
        MOBILE_ERRORS.BAD_REQUEST,
        { reason: parsed.reason },
        null,
        routeResponseHeaders,
      );
    }
    body = parsed.value;
  }

  const result = await handler({
    rawDb: ctx.rawDb,
    journal: ctx.journal,
    upstream: ctx.upstream,
    corePort: ctx.corePort,
    env: ctx.env,
    principal: decision.principal,
    params: decision.params || {},
    query: url.searchParams,
    body,
  });

  return sendJson(res, result.status, result.body, result.headers);
}

function extrasFor(decision) {
  const extras = {};
  if (decision.requiredScope) extras.requiredScope = decision.requiredScope;
  // The scopes the device *does* hold are echoed on a 403 so the client can
  // tell the user to re-pair with wider scope instead of guessing (§8.7).
  if (decision.principal?.scopes) extras.scopes = decision.principal.scopes;
  return extras;
}

function responseHeadersForRequest(method, requestUrl) {
  try {
    return responseHeadersForRoute(
      method,
      new URL(requestUrl || '/', 'http://gateway.local').pathname,
    );
  } catch {
    return undefined;
  }
}

function responseHeadersForRoute(method, pathname) {
  try {
    const route = matchMobileRoute(method, pathname);
    const routeKey = route && `${route.method} ${route.path}`;
    return APPROVAL_ROUTE_KEYS.has(routeKey) ? APPROVAL_RESPONSE_HEADERS : undefined;
  } catch {
    return undefined;
  }
}

function readJsonBody(req) {
  return new Promise(resolve => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        resolve({ ok: false, reason: 'body_too_large' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({ ok: true, value: {} });
      try {
        resolve({ ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      } catch {
        resolve({ ok: false, reason: 'body_not_json' });
      }
    });
    req.on('error', () => resolve({ ok: false, reason: 'body_read_error' }));
  });
}

/**
 * Every error leaves the gateway in one shape: `{ ok: false, error: { code … } }`.
 *
 * Handlers already produce that shape, so the policy layer must match it.  When
 * the two differed, a client reading `body.error.code` silently fell back to a
 * generic `http_401` for exactly the cases §8.3 exists to separate — revoked
 * versus expired versus missing scope.
 */
function sendError(res, descriptor, extras = {}, statusOverride = null, headers = {}) {
  const payload = mobileError(descriptor, extras);
  return sendJson(res, statusOverride ?? payload.status, { ok: false, error: payload.error }, headers);
}

function applyResponseHeaders(res, headers = {}) {
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && value !== null) res.setHeader(name, value);
  }
}

function sendJson(res, status, body, headers = {}) {
  if (res.writableEnded) return;
  applyResponseHeaders(res, headers);
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Start the gateway.  Resolves once bound, with the OS-assigned port when
 * port 0 was requested.
 */
export async function startMobileGateway({
  rawDb,
  host = process.env.C3_MOBILE_HOST || '127.0.0.1',
  port = Number.parseInt(process.env.C3_MOBILE_PORT || '3336', 10),
  upstream,
  journal,
  env = process.env,
  logger = console,
} = {}) {
  assertMobileGatewayBind(host, env);

  const { server, journal: activeJournal, instance } = createMobileGateway({
    rawDb, upstream, journal, env, logger,
  });

  // Record what this host can prove is gone before deciding what to sweep, so
  // a crashed predecessor's operations are released on the next start rather
  // than waiting out the heartbeat TTL.
  reapDeadInstances(rawDb, { selfId: instance.instanceId });

  // Before the first request is accepted: a PENDING row with no live owner
  // belongs to a process that is gone.  Left alone it would claim to be running
  // and would hold a slot in the per-device cap that nothing can ever release.
  //
  // Rows owned by another *live* gateway are not touched — the sweep runs
  // before `listen()`, so binding the port could not have protected them.
  const swept = activeJournal.sweepInterrupted();
  if (swept > 0) {
    logger.warn?.(`[mobile] ${swept} operací zůstalo po pádu procesu — označeny UNKNOWN (process_terminated)`);
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  const address = server.address();
  return {
    server,
    journal: activeJournal,
    instance,
    host,
    port: address.port,
    url: `http://${host === '::1' ? '[::1]' : host}:${address.port}`,
    async stop() {
      await new Promise(resolve => server.close(resolve));
      // Released after the listener is closed, so no request can still be
      // opening an operation under an instance already recorded as gone.
      instance.release('clean_shutdown');
    },
  };
}

export default { createMobileGateway, startMobileGateway, assertMobileGatewayBind, REMOTE_BIND_ACKNOWLEDGEMENT };
