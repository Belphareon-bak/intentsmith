// The selected-specialist handler receives private package results. Keep the
// public M1 tag narrower than the result used for deterministic presentation or
// the internal expertise wrapper prompt.

const BETTING_FAILURE_STATUSES = new Set([
  'INVALID_REQUEST', 'MODEL_UNAVAILABLE', 'CANCELLED', 'PROVIDER_ERROR',
  'PERSISTENCE_ERROR', 'INTERNAL_ERROR',
]);
const BETTING_PUBLIC_FIELDS = [
  'contract', 'version', 'requestId', 'runId', 'generatedAt',
  'effectivePreferences', 'status', 'dataMode', 'verifiedLive',
  'verifiedObservation', 'coverage', 'search', 'warnings', 'errors',
  'tickets', 'alternatives', 'evidenceRefs', 'rejections', 'persistence',
];
const BETTING_STATUSES = new Set([
  'READY', 'NEEDS_INPUT', 'INVALID_REQUEST', 'INSUFFICIENT_DATA',
  'MODEL_UNAVAILABLE', 'NO_SOLUTION', 'SEARCH_LIMIT_REACHED', 'CANCELLED',
  'PROVIDER_ERROR', 'PERSISTENCE_ERROR', 'INTERNAL_ERROR',
]);

function isBettingTool(toolType) {
  return typeof toolType === 'string' && /^sazeni\.[a-z_]+$/u.test(toolType);
}

function publicSourceUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password
      && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function publicBettingAnalysis(analysis) {
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) return undefined;
  const sourceRefs = Array.isArray(analysis.sourceRefs)
    ? analysis.sourceRefs.flatMap(ref => {
      if (!ref || typeof ref !== 'object' || !publicSourceUrl(ref.url)
        || typeof ref.observationId !== 'string' || typeof ref.resource !== 'string'
        || typeof ref.retrievedAt !== 'string' || typeof ref.sha256 !== 'string'
        || !Number.isSafeInteger(ref.bytes)) return [];
      return [{ observationId: ref.observationId, resource: ref.resource,
        retrievedAt: ref.retrievedAt,
        lastModified: typeof ref.lastModified === 'string' ? ref.lastModified : null,
        sha256: ref.sha256, url: ref.url, bytes: ref.bytes }];
    }) : [];
  const publicPages = Array.isArray(analysis.publicSourcePages)
    ? analysis.publicSourcePages.flatMap(page => (
      typeof page?.league === 'string' && publicSourceUrl(page.url)
        ? [{ league: page.league, url: page.url }] : []
    )) : [];
  return {
    autonomous: analysis.autonomous === true,
    sourceRefs,
    ...(publicPages.length ? { publicSourcePages: publicPages } : {}),
    ...(typeof analysis.policy?.id === 'string'
      && typeof analysis.policy.selectedMethod === 'string'
      ? { policy: { id: analysis.policy.id,
        selectedMethod: analysis.policy.selectedMethod } } : {}),
    ...(Array.isArray(analysis.limitations)
      ? { limitations: analysis.limitations.filter(item => typeof item === 'string') } : {}),
  };
}

export function publicSpecialistExecutionStatus(toolType, result) {
  if (!isBettingTool(toolType)) return 'SUCCESS';
  if (result?.contract !== 'BettingResult' || result.version !== 3
    || !BETTING_STATUSES.has(result.status)) return 'FAILED';
  return BETTING_FAILURE_STATUSES.has(result.status) ? 'FAILED' : 'SUCCESS';
}

export function publicSpecialistToolResults(toolType, result) {
  const item = { type: toolType };
  // Sázení intentionally publishes its structured ticket/observation fields.
  // Publish bounded observation references; keep raw model diagnostics private.
  if (isBettingTool(toolType) && result?.contract === 'BettingResult'
    && result.version === 3 && BETTING_STATUSES.has(result.status)) {
    item.data = Object.fromEntries(BETTING_PUBLIC_FIELDS
      .filter(key => Object.hasOwn(result, key))
      .map(key => [key, result[key]]));
    const analysis = publicBettingAnalysis(result.analysis);
    if (analysis) item.data.analysis = analysis;
  }
  return [item];
}

export function publicSpecialistProjectContext(toolType, evidence) {
  if (!['code-reviewer.analyze_code', 'code-reviewer.security_scan'].includes(toolType)
    || evidence?.contract !== 'ProjectContextSnapshot' || evidence.version !== 1
    || !Number.isSafeInteger(evidence.projectId) || evidence.projectId < 1
    || typeof evidence.workspaceRevision !== 'string'
    || typeof evidence.snapshotDigest !== 'string'
    || typeof evidence.outcome !== 'string' || !Array.isArray(evidence.items)) {
    return undefined;
  }
  const items = evidence.items.map(item => {
    if (typeof item?.path !== 'string' || !Number.isSafeInteger(item.startLine)
      || !Number.isSafeInteger(item.endLine)
      || typeof item.contentDigest !== 'string') return null;
    return { path: item.path, startLine: item.startLine,
      endLine: item.endLine, contentDigest: item.contentDigest };
  });
  if (items.includes(null)) return undefined;
  return {
    contract: evidence.contract, version: evidence.version,
    projectId: evidence.projectId, workspaceRevision: evidence.workspaceRevision,
    snapshotDigest: evidence.snapshotDigest, outcome: evidence.outcome, items,
  };
}
