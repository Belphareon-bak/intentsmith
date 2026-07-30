// Shared cancellation contract for chat, CRE, LLM and WebSocket boundaries.

export const AbortSource = Object.freeze({
  USER: 'user',
  TIMEOUT: 'timeout',
});

const DEFAULT_MESSAGES = Object.freeze({
  [AbortSource.USER]: 'Request cancelled by user',
  [AbortSource.TIMEOUT]: 'Request timeout',
});

const KNOWN_SOURCES = new Set(Object.values(AbortSource));

export function isAbortError(error) {
  return error?.name === 'AbortError';
}

export function createAbortError(source = AbortSource.USER, message = null) {
  const normalizedSource = KNOWN_SOURCES.has(source) ? source : AbortSource.USER;
  const error = new Error(message || DEFAULT_MESSAGES[normalizedSource]);
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  error.abortSource = normalizedSource;
  return error;
}

export function abortErrorFromSignal(
  signal,
  { fallbackSource = AbortSource.USER, message = null } = {},
) {
  const reason = signal?.reason;
  if (isAbortError(reason) && KNOWN_SOURCES.has(reason.abortSource)) {
    return reason;
  }
  return createAbortError(fallbackSource, message);
}

export function abortSourceOf(error, signal, fallbackSource = AbortSource.USER) {
  if (KNOWN_SOURCES.has(error?.abortSource)) {
    return error.abortSource;
  }
  if (KNOWN_SOURCES.has(signal?.reason?.abortSource)) {
    return signal.reason.abortSource;
  }
  return KNOWN_SOURCES.has(fallbackSource) ? fallbackSource : AbortSource.USER;
}

export function abortWithReason(controller, source, message = null) {
  if (!controller?.signal || typeof controller.abort !== 'function') {
    throw new TypeError('AbortController is required');
  }
  if (!controller.signal.aborted) {
    controller.abort(createAbortError(source, message));
  }
}

export function throwIfAborted(
  signal,
  { fallbackSource = AbortSource.USER, message = null } = {},
) {
  if (signal?.aborted) {
    throw abortErrorFromSignal(signal, { fallbackSource, message });
  }
}
