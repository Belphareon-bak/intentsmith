const ALLOWED_OLLAMA_ORIGINS = new Set([
  'http://127.0.0.1:11434',
  'http://localhost:11434',
  'http://[::1]:11434',
]);

const ALLOWED_OLLAMA_ENDPOINTS = new Map([
  ['/api/chat', 'POST'],
  ['/api/generate', 'POST'],
  ['/api/show', 'POST'],
  ['/api/tags', 'GET'],
]);

let activeInstallation = null;

function boundaryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseRequest(input) {
  const requestLike = typeof Request === 'function' && input instanceof Request;
  const rawUrl = requestLike ? input.url : input instanceof URL ? input.href : String(input);
  const url = new URL(rawUrl);
  const requestMethod = requestLike ? input.method : null;
  return { requestMethod, url };
}

function normalizedMethod(requestMethod, init) {
  return String(init?.method || requestMethod || 'GET').toUpperCase();
}

function assertAllowedOllamaRequest(input, init) {
  let parsed;
  try {
    parsed = parseRequest(input);
  } catch {
    throw boundaryError(
      'INTENTSMITH_TEST_NETWORK_TARGET_INVALID',
      'M6 model test rejected an invalid network target',
    );
  }

  const { requestMethod, url } = parsed;
  if (
    !ALLOWED_OLLAMA_ORIGINS.has(url.origin)
    || url.username !== ''
    || url.password !== ''
    || url.search !== ''
    || url.hash !== ''
  ) {
    throw boundaryError(
      'INTENTSMITH_TEST_EXTERNAL_NETWORK_BLOCKED',
      'M6 model test permits only the exact loopback Ollama origin',
    );
  }

  const expectedMethod = ALLOWED_OLLAMA_ENDPOINTS.get(url.pathname);
  const method = normalizedMethod(requestMethod, init);
  if (expectedMethod !== method) {
    throw boundaryError(
      'INTENTSMITH_TEST_OLLAMA_ENDPOINT_BLOCKED',
      'M6 model test rejected an unapproved Ollama endpoint or method',
    );
  }

  return url;
}

export function installOllamaLoopbackFetchBoundary({
  transport = globalThis.fetch,
  reportOnExit = false,
} = {}) {
  if (activeInstallation !== null) {
    throw boundaryError(
      'INTENTSMITH_TEST_NETWORK_BOUNDARY_ALREADY_INSTALLED',
      'M6 model test network boundary is already installed',
    );
  }
  if (typeof transport !== 'function') {
    throw new TypeError('M6 model test requires an available fetch transport');
  }

  const previousFetch = globalThis.fetch;
  const counters = {
    loopbackRequests: 0,
    blockedRequests: 0,
    blockedRedirects: 0,
  };

  const guardedFetch = async (input, init = undefined) => {
    try {
      assertAllowedOllamaRequest(input, init);
    } catch (error) {
      counters.blockedRequests += 1;
      throw error;
    }

    counters.loopbackRequests += 1;
    const response = await transport.call(globalThis, input, {
      ...(init || {}),
      redirect: 'manual',
    });
    if (response?.status >= 300 && response.status < 400) {
      counters.blockedRedirects += 1;
      throw boundaryError(
        'INTENTSMITH_TEST_OLLAMA_REDIRECT_BLOCKED',
        'M6 model test rejected an Ollama redirect',
      );
    }
    return response;
  };

  const snapshot = () => Object.freeze({ ...counters });
  const report = () => {
    try {
      process.stdout.write(`M6_OLLAMA_LOOPBACK_BOUNDARY=${JSON.stringify(snapshot())}\n`);
    } catch {
      // Exit reporting is evidence only; it must not change the program verdict.
    }
  };
  if (reportOnExit) process.on('exit', report);

  const installation = Object.freeze({
    snapshot,
    restore() {
      if (activeInstallation !== installation) return false;
      if (reportOnExit) process.off('exit', report);
      globalThis.fetch = previousFetch;
      activeInstallation = null;
      return true;
    },
  });
  activeInstallation = installation;
  globalThis.fetch = guardedFetch;
  return installation;
}
