import {
  REMOTE_CORE_FEATURE_IDS,
  REMOTE_CORE_FEATURES,
  REMOTE_CORE_PORT_NAME,
  REMOTE_CORE_PORT_STAGE,
  REMOTE_CORE_PORT_VERSION,
  negotiateRemoteCoreVersion,
} from '../../contracts/remote-core/index.js';
import { isJsonValue, isPlainRecord } from '../../contracts/m1/shared.js';

export class RemoteCorePortError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'RemoteCorePortError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function requireProviderResult(result, feature) {
  if (!isPlainRecord(result) || typeof result.ok !== 'boolean') {
    throw new RemoteCorePortError('provider_result_invalid', { feature });
  }
  if (result.ok) {
    if (!Object.hasOwn(result, 'data') || !isJsonValue(result.data)) {
      throw new RemoteCorePortError('provider_result_invalid', { feature });
    }
    return Object.freeze({ ok: true, data: result.data });
  }
  if (
    !isPlainRecord(result.error)
    || typeof result.error.code !== 'string'
    || !/^[a-z][a-z0-9_]{0,63}$/.test(result.error.code)
    || (Object.hasOwn(result.error, 'details') && !isJsonValue(result.error.details))
  ) {
    throw new RemoteCorePortError('provider_result_invalid', { feature });
  }
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: result.error.code,
      ...(Object.hasOwn(result.error, 'details') ? { details: result.error.details } : {}),
    }),
  });
}

function normalizeScopes(principal) {
  const scopes = Array.isArray(principal?.scopes) ? principal.scopes : [];
  return new Set(scopes.filter(scope => typeof scope === 'string'));
}

/**
 * Narrow, versioned connector owned by core.
 *
 * Providers are registered by capability id. There is deliberately no generic
 * `request(path)`, `fetch(url)`, module resolver or property passthrough.
 */
export class RemoteCorePort {
  #providers;

  constructor({ providers = {} } = {}) {
    if (!isPlainRecord(providers)) {
      throw new RemoteCorePortError('provider_registry_invalid');
    }
    const unknown = Object.keys(providers).filter(id => !REMOTE_CORE_FEATURE_IDS.includes(id));
    if (unknown.length > 0) {
      throw new RemoteCorePortError('provider_unknown', { features: unknown.sort() });
    }
    for (const [id, provider] of Object.entries(providers)) {
      if (typeof provider !== 'function') {
        throw new RemoteCorePortError('provider_invalid', { feature: id });
      }
    }
    this.#providers = Object.freeze({ ...providers });
    Object.freeze(this);
  }

  negotiate(offered) {
    return negotiateRemoteCoreVersion(offered);
  }

  capabilities(principal = null) {
    const granted = normalizeScopes(principal);
    const features = {};
    for (const id of REMOTE_CORE_FEATURE_IDS) {
      const definition = REMOTE_CORE_FEATURES[id];
      const available = Object.hasOwn(this.#providers, id);
      const authorized = definition.scopes.every(scope => granted.has(scope));
      features[id] = Object.freeze({
        status: !available ? 'unavailable' : authorized ? 'available' : 'forbidden',
        scopes: definition.scopes,
        mutation: definition.mutation,
      });
    }
    return Object.freeze({
      name: REMOTE_CORE_PORT_NAME,
      version: REMOTE_CORE_PORT_VERSION,
      stage: REMOTE_CORE_PORT_STAGE,
      features: Object.freeze(features),
    });
  }

  async invoke({ version, feature, input = {}, principal = null } = {}) {
    if (version !== REMOTE_CORE_PORT_VERSION) {
      throw new RemoteCorePortError('contract_version_unsupported', {
        requested: version ?? null,
        supported: [REMOTE_CORE_PORT_VERSION],
      });
    }
    if (!REMOTE_CORE_FEATURE_IDS.includes(feature)) {
      throw new RemoteCorePortError('capability_unknown', { feature: feature ?? null });
    }
    if (!isPlainRecord(input) || !isJsonValue(input)) {
      throw new RemoteCorePortError('input_invalid', { feature });
    }

    const provider = this.#providers[feature];
    if (!provider) {
      throw new RemoteCorePortError('capability_unavailable', { feature });
    }
    const granted = normalizeScopes(principal);
    const missing = REMOTE_CORE_FEATURES[feature].scopes.filter(scope => !granted.has(scope));
    if (missing.length > 0) {
      throw new RemoteCorePortError('capability_forbidden', { feature, required: missing });
    }

    const result = await provider(input, Object.freeze({
      principal: principal === null ? null : Object.freeze({
        deviceId: principal.deviceId ?? null,
        scopes: Object.freeze([...granted]),
      }),
      contractVersion: REMOTE_CORE_PORT_VERSION,
      feature,
    }));
    return requireProviderResult(result, feature);
  }
}

/** Adapter for the only legacy core effect currently used by the gateway. */
export function createUpstreamRemoteCorePort(upstream) {
  if (!upstream || typeof upstream.postChat !== 'function') {
    throw new RemoteCorePortError('upstream_invalid');
  }
  return new RemoteCorePort({
    providers: {
      'conversations.send': async input => {
        const result = await upstream.postChat(input);
        if (result?.ok) return { ok: true, data: result.data ?? {} };
        return {
          ok: false,
          error: {
            code: typeof result?.code === 'string' ? result.code : 'upstream_unavailable',
            details: {
              decided: result?.decided === true,
              ...(Number.isInteger(result?.status) ? { status: result.status } : {}),
            },
          },
        };
      },
    },
  });
}

export default { RemoteCorePort, RemoteCorePortError, createUpstreamRemoteCorePort };
