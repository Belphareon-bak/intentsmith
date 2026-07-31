// IntentSmith legacy-local HTTP capability bootstrap.
//
// This file runs in Electron's main renderer world before Theia extensions.
// It authorizes only the exact backend origin discovered through the private
// port file. Capability material is never forwarded to another origin.
'use strict';

const LEGACY_LOCAL_CAPABILITY_HEADER =
  'X-IntentSmith-Local-Capability';
const LOCAL_CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const LOCAL_BACKEND_PATTERN =
  /^http:\/\/(127\.0\.0\.1|localhost):([1-9][0-9]{0,4})$/;
const LEGACY_RELATIVE_PATH_PATTERN =
  /^\/(?:api(?:[/?#]|$)|health(?:[?#]|$)|chat(?:[?#]|$))/;
const INSTALL_MARKER = '__intentSmithLegacyLocalFetchV1';

function normalizeLocalAccess(rawAccess) {
  if (
    !rawAccess
    || typeof rawAccess !== 'object'
    || typeof rawAccess.backendUrl !== 'string'
    || typeof rawAccess.localCapability !== 'string'
    || !LOCAL_CAPABILITY_PATTERN.test(rawAccess.localCapability)
  ) {
    return null;
  }

  const match = LOCAL_BACKEND_PATTERN.exec(rawAccess.backendUrl);
  if (!match) return null;

  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }

  return Object.freeze({
    backendUrl: new URL(`http://${match[1]}:${port}`).origin,
    localCapability: rawAccess.localCapability,
  });
}

function readLocalAccess(scope) {
  try {
    return normalizeLocalAccess(scope.electronC3?.getLocalAccess?.());
  } catch {
    return null;
  }
}

function rawRequestTarget(input, RequestCtor) {
  if (typeof input === 'string') return input;
  if (typeof URL !== 'undefined' && input instanceof URL) return input.href;
  if (RequestCtor && input instanceof RequestCtor) return input.url;
  return null;
}

function resolveRequestTarget(rawTarget, access, scope) {
  if (typeof rawTarget !== 'string') return null;

  if (LEGACY_RELATIVE_PATH_PATTERN.test(rawTarget)) {
    if (!access) {
      return Object.freeze({ intendedLocal: true, url: null });
    }
    return Object.freeze({
      intendedLocal: true,
      url: new URL(rawTarget, `${access.backendUrl}/`),
    });
  }

  try {
    const base = scope.location?.href;
    return Object.freeze({
      intendedLocal: false,
      url: base ? new URL(rawTarget, base) : new URL(rawTarget),
    });
  } catch {
    return null;
  }
}

function effectiveHeaders(input, init, HeadersCtor, RequestCtor) {
  if (
    init
    && Object.prototype.hasOwnProperty.call(init, 'headers')
    && init.headers !== undefined
  ) {
    return new HeadersCtor(init.headers);
  }
  if (RequestCtor && input instanceof RequestCtor) {
    return new HeadersCtor(input.headers);
  }
  return new HeadersCtor();
}

function requestWithCapability({
  input,
  init,
  targetUrl,
  capability,
  RequestCtor,
  HeadersCtor,
}) {
  const baseRequest = RequestCtor && input instanceof RequestCtor
    ? new RequestCtor(input, init)
    : new RequestCtor(targetUrl.href, init);
  const headers = new HeadersCtor(baseRequest.headers);
  headers.set(LEGACY_LOCAL_CAPABILITY_HEADER, capability);
  return new RequestCtor(baseRequest, {
    headers,
    redirect: 'error',
  });
}

function requestWithoutCapability({
  input,
  init,
  RequestCtor,
  HeadersCtor,
}) {
  const baseRequest = new RequestCtor(input, init);
  const headers = new HeadersCtor(baseRequest.headers);
  headers.delete(LEGACY_LOCAL_CAPABILITY_HEADER);
  return new RequestCtor(baseRequest, { headers });
}

function installLegacyLocalFetch(scope) {
  if (
    !scope
    || typeof scope.fetch !== 'function'
    || typeof scope.Request !== 'function'
    || typeof scope.Headers !== 'function'
  ) {
    throw new TypeError('IntentSmith local HTTP bootstrap requires Fetch API globals');
  }
  if (scope[INSTALL_MARKER]) return false;

  const nativeFetch = scope.fetch;
  const RequestCtor = scope.Request;
  const HeadersCtor = scope.Headers;

  Object.defineProperty(scope, INSTALL_MARKER, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  scope.fetch = function intentSmithLocalFetch(input, init) {
    const access = readLocalAccess(scope);
    const rawTarget = rawRequestTarget(input, RequestCtor);
    const resolved = resolveRequestTarget(rawTarget, access, scope);

    if (resolved?.intendedLocal && !access) {
      return Promise.reject(
        new TypeError('IntentSmith local backend capability is unavailable'),
      );
    }

    const isExactBackend = Boolean(
      access
      && resolved?.url
      && resolved.url.origin === access.backendUrl,
    );

    if (isExactBackend) {
      try {
        const authorizedRequest = requestWithCapability({
          input,
          init,
          targetUrl: resolved.url,
          capability: access.localCapability,
          RequestCtor,
          HeadersCtor,
        });
        return nativeFetch.call(scope, authorizedRequest);
      } catch (error) {
        return Promise.reject(error);
      }
    }

    let headers;
    try {
      headers = effectiveHeaders(input, init, HeadersCtor, RequestCtor);
    } catch (error) {
      return Promise.reject(error);
    }

    if (headers.has(LEGACY_LOCAL_CAPABILITY_HEADER)) {
      try {
        return nativeFetch.call(
          scope,
          requestWithoutCapability({
            input,
            init,
            RequestCtor,
            HeadersCtor,
          }),
        );
      } catch (error) {
        return Promise.reject(error);
      }
    }

    return nativeFetch.call(scope, input, init);
  };

  return true;
}

if (typeof window !== 'undefined') {
  installLegacyLocalFetch(window);
}

module.exports = {
  INSTALL_MARKER,
  LEGACY_LOCAL_CAPABILITY_HEADER,
  installLegacyLocalFetch,
  normalizeLocalAccess,
};
