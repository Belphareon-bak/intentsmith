export const M2_LEGACY_LIFECYCLE_RETIRED_CODE = 'LEGACY_LIFECYCLE_RETIRED';
export const M2_LEGACY_LIFECYCLE_REPLACEMENT = '/api/m2/lifecycle/prepare';

export const M2_LEGACY_LIFECYCLE_MUTATING_ROUTE_KEYS = Object.freeze([
  'POST /api/lifecycle/start',
  'POST /api/lifecycle/spec/answer',
  'POST /api/lifecycle/spec/approve',
  'POST /api/lifecycle/roadmap/approve',
  'POST /api/lifecycle/milestone/approve',
  'POST /api/lifecycle/milestone/next',
  'POST /api/lifecycle/milestone/blocked',
  'POST /api/lifecycle/review/acknowledge',
  'POST /api/lifecycle/change/propose',
  'POST /api/lifecycle/change/approve',
  'POST /api/lifecycle/change/reject',
  'POST /api/projects/lifecycle/start',
]);

export const M2_LEGACY_LIFECYCLE_RETIREMENT_RESPONSE = Object.freeze({
  error: 'Legacy lifecycle mutation endpoints are retired.',
  code: M2_LEGACY_LIFECYCLE_RETIRED_CODE,
  replacement: M2_LEGACY_LIFECYCLE_REPLACEMENT,
});

/**
 * Build the fail-closed route overlay for the legacy lifecycle mutation
 * surface. The factory intentionally accepts only the shared response writer:
 * retired handlers must not parse a body, resolve a project, touch storage, or
 * initialize any legacy planner/executor dependency.
 */
export function createM2LegacyLifecycleQuarantineRoutes({ sendJSON } = {}) {
  if (typeof sendJSON !== 'function') {
    throw new TypeError('M2 legacy lifecycle quarantine requires sendJSON');
  }

  const retire = (_req, res) => sendJSON(
    res,
    410,
    M2_LEGACY_LIFECYCLE_RETIREMENT_RESPONSE,
  );

  return Object.freeze(Object.fromEntries(
    M2_LEGACY_LIFECYCLE_MUTATING_ROUTE_KEYS.map(routeKey => [routeKey, retire]),
  ));
}
