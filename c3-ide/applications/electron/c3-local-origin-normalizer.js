// Preserve native Chromium Fetch while truthfully identifying the exact
// file:// Studio renderer as an opaque origin at the local backend boundary.
'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const {
  LOCAL_CAPABILITY_PATTERN,
  readLocalAccess,
} = require('./c3-local-access');

const LOCAL_CAPABILITY_HEADER = 'x-intentsmith-local-capability';
const PROTECTED_PATH_PATTERN = /^\/(?:api(?:\/|$)|health$|chat$)/;
const ACTUAL_REQUEST_METHODS = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
]);
const PREFLIGHT_ALLOWED_HEADERS = new Set([
  'content-type',
  LOCAL_CAPABILITY_HEADER,
]);
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9a-z-]+$/;
const FILE_FRAME_ORIGINS = new Set(['file://', 'null']);
let installed = false;

function matchingHeaders(headers, name) {
  return Object.entries(headers || {})
    .filter(([key]) => key.toLowerCase() === name.toLowerCase());
}

function uniqueHeader(headers, name) {
  const matches = matchingHeaders(headers, name);
  return matches.length === 1 ? String(matches[0][1]) : null;
}

function equalCapability(presented, expected) {
  if (
    !LOCAL_CAPABILITY_PATTERN.test(presented || '')
    || !LOCAL_CAPABILITY_PATTERN.test(expected || '')
  ) {
    return false;
  }
  const left = Buffer.from(presented, 'ascii');
  const right = Buffer.from(expected, 'ascii');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function validOpaquePreflight(headers) {
  if (matchingHeaders(headers, LOCAL_CAPABILITY_HEADER).length !== 0) {
    return false;
  }
  const requestedMethod = uniqueHeader(
    headers,
    'access-control-request-method',
  )?.toUpperCase();
  if (!ACTUAL_REQUEST_METHODS.has(requestedMethod)) return false;

  const requestedHeaderValue = uniqueHeader(
    headers,
    'access-control-request-headers',
  );
  if (!requestedHeaderValue) return false;
  const requestedHeaders = requestedHeaderValue
    .split(',')
    .map(value => value.trim().toLowerCase());
  if (
    requestedHeaders.some(name => !name || !HEADER_NAME_PATTERN.test(name))
    || new Set(requestedHeaders).size !== requestedHeaders.length
    || !requestedHeaders.includes(LOCAL_CAPABILITY_HEADER)
    || requestedHeaders.some(name => !PREFLIGHT_ALLOWED_HEADERS.has(name))
  ) {
    return false;
  }
  return true;
}

function resolveExpectedFrontendPath() {
  if (path.isAbsolute(process.env.THEIA_APP_PROJECT_PATH || '')) {
    return path.join(
      process.env.THEIA_APP_PROJECT_PATH,
      'lib',
      'frontend',
      'index.html',
    );
  }
  return path.resolve(__dirname, '..', 'frontend', 'index.html');
}

function normalizeOpaqueStudioRequest(details, options = {}) {
  const access = (options.readAccess || readLocalAccess)();
  const expectedFrontendPath = options.expectedFrontendPath
    || resolveExpectedFrontendPath();
  const frame = details?.frame;
  if (!access || !frame || frame.isDestroyed()) return null;
  if (frame.parent !== null || frame.top !== frame) return null;
  if (!FILE_FRAME_ORIGINS.has(frame.origin)) return null;
  if (details.resourceType !== 'xhr') return null;
  const method = String(details.method || '').toUpperCase();
  if (method !== 'OPTIONS' && !ACTUAL_REQUEST_METHODS.has(method)) return null;

  try {
    const frameUrl = new URL(frame.url);
    if (
      frameUrl.protocol !== 'file:'
      || fileURLToPath(frameUrl) !== expectedFrontendPath
    ) {
      return null;
    }
  } catch {
    return null;
  }

  let target;
  try {
    target = new URL(details.url);
  } catch {
    return null;
  }
  if (
    target.origin !== access.backendUrl
    || target.username
    || target.password
    || target.hash
    || !PROTECTED_PATH_PATTERN.test(target.pathname)
  ) {
    return null;
  }

  const headers = details.requestHeaders || {};
  if (matchingHeaders(headers, 'origin').length !== 0) return null;
  if (uniqueHeader(headers, 'sec-fetch-site')?.toLowerCase() !== 'cross-site') {
    return null;
  }
  if (method === 'OPTIONS') {
    return validOpaquePreflight(headers)
      ? { ...headers, Origin: 'null' }
      : null;
  }
  if (!equalCapability(
    uniqueHeader(headers, LOCAL_CAPABILITY_HEADER),
    access.localCapability,
  )) {
    return null;
  }

  // Electron owns the request-header envelope after the callback. Keep the
  // returned object mutable for compatibility with its native bridge while
  // leaving the caller-provided object untouched.
  return { ...headers, Origin: 'null' };
}

function installOnSession(electronSession) {
  if (installed) return false;
  electronSession.webRequest.onBeforeSendHeaders(
    { urls: ['http://127.0.0.1/*', 'http://localhost/*'] },
    (details, callback) => {
      let requestHeaders = null;
      try {
        requestHeaders = normalizeOpaqueStudioRequest(details);
      } catch {}
      callback(requestHeaders ? { requestHeaders } : {});
    },
  );
  installed = true;
  return true;
}

function installLocalOriginNormalizer() {
  const { app, session } = require('electron');
  const installDefaultSession = () => installOnSession(session.defaultSession);
  if (app.isReady()) installDefaultSession();
  else app.once('ready', installDefaultSession);
}

if (process.type === 'browser') installLocalOriginNormalizer();

module.exports = {
  LOCAL_CAPABILITY_HEADER,
  equalCapability,
  installOnSession,
  normalizeOpaqueStudioRequest,
  validOpaquePreflight,
};
