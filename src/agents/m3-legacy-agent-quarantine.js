export const M3_LEGACY_AGENT_RETIRED_CODE = 'LEGACY_AGENT_MUTATION_RETIRED';
export const M3_LEGACY_AGENT_REPLACEMENT = '/api/agent-extensions';

export const M3_LEGACY_AGENT_MUTATING_ROUTE_KEYS = Object.freeze([
  'POST /api/agents',
  'PUT /api/agents/:id',
  'DELETE /api/agents/:id',
  'POST /api/agents/:id/run',
  'POST /api/agents/:id/enable',
  'POST /api/agents/:id/disable',
  'POST /api/agents/build',
  'POST /api/agents/refine',
  'POST /api/agents/confirm',
  'POST /api/agents/dry-run',
  'POST /api/sources/inspect',
  'POST /api/sources/validate-field',
  'POST /api/sources/validate-condition',
]);

export const M3_LEGACY_AGENT_RETIREMENT_RESPONSE = Object.freeze({
  error: 'Legacy agent mutation endpoints are retired.',
  code: M3_LEGACY_AGENT_RETIRED_CODE,
  replacement: M3_LEGACY_AGENT_REPLACEMENT,
});

/**
 * Fail-closed overlay for the legacy agent mutation surface. This module has
 * deliberately no imports. A retired handler must not parse a request body,
 * resolve an agent, initialize a builder, touch storage, or execute a source
 * or action.
 */
export function createM3LegacyAgentQuarantineRoutes({ sendJSON } = {}) {
  if (typeof sendJSON !== 'function') {
    throw new TypeError('M3 legacy agent quarantine requires sendJSON');
  }

  const retire = (_req, res) => sendJSON(
    res,
    410,
    M3_LEGACY_AGENT_RETIREMENT_RESPONSE,
  );

  return Object.freeze(Object.fromEntries(
    M3_LEGACY_AGENT_MUTATING_ROUTE_KEYS.map(routeKey => [routeKey, retire]),
  ));
}
