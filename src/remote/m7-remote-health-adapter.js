export const M7_REMOTE_HEALTH_ERROR = Object.freeze({
  CONFIG_INVALID: 'M7_REMOTE_HEALTH_CONFIG_INVALID',
});

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/u;
const COMPONENT_STATUSES = new Set(['ok', 'degraded', 'unavailable']);

function plain(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys) {
  return plain(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function fail(message) {
  const error = new TypeError(`m7-remote-health:${message}`);
  error.code = M7_REMOTE_HEALTH_ERROR.CONFIG_INVALID;
  throw error;
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function normalizeComponents(components) {
  if (!Array.isArray(components) || components.length < 1 || components.length > 32) {
    fail('components-invalid');
  }
  const seen = new Set();
  const normalized = components.map(component => {
    if (!exactKeys(component, ['componentId', 'observe'])
      || !IDENTIFIER.test(component.componentId || '')
      || typeof component.observe !== 'function'
      || seen.has(component.componentId)) {
      fail('component-invalid');
    }
    seen.add(component.componentId);
    return Object.freeze({ componentId: component.componentId, observe: component.observe });
  });
  normalized.sort((left, right) => left.componentId.localeCompare(right.componentId, 'en'));
  return Object.freeze(normalized);
}

function unavailable(componentId, code) {
  return Object.freeze({ componentId, status: 'unavailable', code });
}

function normalizeObservation(componentId, observation) {
  if (!exactKeys(observation, ['status', 'code'])
    || !COMPONENT_STATUSES.has(observation.status)
    || !IDENTIFIER.test(observation.code || '')) {
    return unavailable(componentId, 'PROBE_INVALID');
  }
  return Object.freeze({
    componentId,
    status: observation.status,
    code: observation.code,
  });
}

export function createM7RemoteHealthAdapter({ clock = Date.now, components, coreVersion } = {}) {
  if (typeof clock !== 'function'
    || typeof coreVersion !== 'string'
    || coreVersion.length < 1
    || Buffer.byteLength(coreVersion, 'utf8') > 128
    || /[\u0000-\u001f\u007f]/u.test(coreVersion)) {
    fail('identity-invalid');
  }
  const probes = normalizeComponents(components);

  async function readHealth(request) {
    const observedAtMs = clock();
    const observedDate = Number.isSafeInteger(observedAtMs) && observedAtMs >= 1
      ? new Date(observedAtMs)
      : null;
    const observedAt = observedDate !== null && !Number.isNaN(observedDate.getTime())
      ? observedDate.toISOString()
      : null;
    if (observedAt === null) {
      return deepFreeze({
        contract: 'RemoteHealthSnapshot',
        version: 1,
        requestId: request.requestId,
        status: 'error',
        error: {
          code: 'REMOTE_HEALTH_CLOCK_INVALID',
          message: 'Health observation time is unavailable.',
          retryable: true,
        },
      });
    }
    const observations = [];
    for (const probe of probes) {
      try {
        observations.push(normalizeObservation(probe.componentId, await probe.observe()));
      } catch {
        observations.push(unavailable(probe.componentId, 'PROBE_FAILED'));
      }
    }
    return deepFreeze({
      contract: 'RemoteHealthSnapshot',
      version: 1,
      requestId: request.requestId,
      status: 'ok',
      coreVersion,
      observedAt,
      components: observations,
    });
  }

  return Object.freeze({
    handlers: Object.freeze({ 'remote-health.read': readHealth }),
    readHealth,
  });
}

export default createM7RemoteHealthAdapter;
