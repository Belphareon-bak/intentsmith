const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export class ModelProviderOriginError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ModelProviderOriginError';
    this.code = code;
  }
}

export function requireLoopbackModelProviderOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new ModelProviderOriginError(
      'MODEL_PROVIDER_ORIGIN_INVALID',
      'Model provider URL is invalid',
    );
  }
  if (
    parsed.protocol !== 'http:'
    || !LOOPBACK_HOSTS.has(parsed.hostname)
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || (parsed.pathname !== '/' && parsed.pathname !== '')
  ) {
    throw new ModelProviderOriginError(
      'MODEL_PROVIDER_ORIGIN_UNSUPPORTED',
      'Model provider effects require an uncredentialed loopback HTTP origin',
    );
  }
  if (!parsed.port) parsed.port = '11434';
  parsed.pathname = '';
  return Object.freeze({
    origin: parsed.origin,
    endpoint: pathname => new URL(pathname, `${parsed.origin}/`).href,
  });
}
