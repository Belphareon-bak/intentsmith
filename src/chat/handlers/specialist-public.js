// The selected-specialist handler receives private package results. Keep the
// public M1 tag narrower than the result used for deterministic presentation or
// the internal expertise wrapper prompt.

const BETTING_FAILURE_STATUSES = new Set([
  'INVALID_REQUEST', 'MODEL_UNAVAILABLE', 'CANCELLED', 'PROVIDER_ERROR',
  'PERSISTENCE_ERROR', 'INTERNAL_ERROR',
]);
const BETTING_STATUSES = new Set([
  'READY', 'NEEDS_INPUT', 'INVALID_REQUEST', 'INSUFFICIENT_DATA',
  'MODEL_UNAVAILABLE', 'NO_SOLUTION', 'SEARCH_LIMIT_REACHED', 'CANCELLED',
  'PROVIDER_ERROR', 'PERSISTENCE_ERROR', 'INTERNAL_ERROR',
]);
const FORTUNA_PUBLIC_PAGE_PATHS = Object.freeze({
  E0: '/sazeni/fotbal/anglie-4/1-anglie',
  D1: '/sazeni/fotbal/nemecko-6/1-nemecko-1',
  I1: '/sazeni/fotbal/italie-1/1-italie-5',
  SP1: '/sazeni/fotbal/spanelsko-1/1-spanelsko-1',
  F1: '/sazeni/fotbal/francie-1/1-francie-1',
});
const PUBLIC_BETTING_LIMITATIONS = new Set([
  'Pravděpodobnost výběru je automaticky odvozený tržní odhad. Strukturální model nepřekonal referenci a je diagnostický.',
  'API feed potvrzuje zdroj a stáří dat; přijetí sázky konkrétním účtem ani kalibrace na české kanceláři nebyly ověřeny.',
  'Veřejná nabídka Fortuny byla pozorována bez přihlášení. Čas poslední změny kurzu ani přijetí sázky nejsou známé.',
  'Veřejný referenční feed nemá čas pořízení jednotlivého kurzu ani záruku dostupnosti v ČR.',
  'Historický CSV benchmark používá konzervativní publikační zpoždění; nemá původní snímky dat dostupných v daný okamžik.',
]);
const S = 'string';
const N = 'number';
const B = 'boolean';
const SN = 'string-or-number';
const CV = 'constraint-value';
const SEARCH = { completed: B, nodes: N, limitReason: S, optimality: S };
const ODDS = { min: S, max: S };
const PROBABILITY = { basis: S, metric: S, min: N };
const REQUEST = {
  contract: S, version: N, requestId: S, sport: S, competitionIds: [S],
  window: { from: S, to: S, timezone: S, maxSpreadHours: N, anchorAt: S },
  bookmakerIds: [S], ticketType: S, legOdds: ODDS, ticketOdds: ODDS,
  legs: { min: N, max: N }, probabilityFilter: PROBABILITY,
  objective: S, ticketCount: N, diversity: { maxSharedEvents: N },
  exclude: { eventIds: [S], participantIds: [S], competitionIds: [S] },
  dataMode: S, dataSource: S, minLegProbability: N, minExpectedRoi: N,
  targetOdds: S, stake: { currency: S, perTicketMinor: N, totalBudgetMinor: N },
};
const TICKET = {
  ticketId: S, lifecycle: S, bookmakerId: S, region: S,
  selections: [{ eventId: S, marketId: S, outcomeId: S, home: S, away: S,
    competitionId: S, kickoffAt: S, decimalOdds: S, probability: N,
    probabilityMethod: S, quoteRef: S, sourceUpdatedAt: S, observedAt: S }],
  totalOdds: S,
  winProbability: { basis: S, estimate: N, jointMethod: S, modelInterval: S,
    dependenceBounds: { lower: N, upper: N } },
  window: { firstKickoffAt: S, lastKickoffAt: S, spreadHours: N },
  expiresAt: S,
  money: { currency: S, stakeMinor: N, returnMinor: N, profitMinor: N,
    maxLossMinor: N, expectedProfitMinor: N, payoutRule: S },
  expectedRoi: N,
  constraints: [{ field: S, actual: CV, required: CV, pass: B }],
};
const BETTING_PUBLIC_SCHEMA = {
  contract: S, version: N, requestId: S, runId: S, generatedAt: S,
  effectivePreferences: REQUEST, status: S, dataMode: S, verifiedLive: B,
  verifiedObservation: B,
  coverage: { complete: B, scope: S, events: N, eligibleSelections: N },
  search: SEARCH, warnings: [S], tickets: [TICKET],
  alternatives: [{ field: S, value: SN, requestPatch: {
    probabilityFilter: PROBABILITY, ticketOdds: ODDS }, status: S,
    found: N, search: SEARCH, example: TICKET }],
  evidenceRefs: [{ snapshotId: S, digest: S, source: { id: S, version: S } }],
  rejections: [{ eventId: S, marketId: S, code: S }],
  persistence: { status: S, recordId: SN },
};
const PUBLIC_ERROR_MESSAGES = Object.freeze({
  INVALID_REQUEST: 'Neplatné zadání.', NEEDS_INPUT: 'Potřebuji doplnit údaje.',
  INSUFFICIENT_DATA: 'Nedostatek použitelných dat.',
  MODEL_UNAVAILABLE: 'Požadovaný model není dostupný.',
  PROVIDER_ERROR: 'Datový zdroj není dostupný. Zkus výpočet později.',
  CANCELLED: 'Výpočet zrušen.',
  PERSISTENCE_ERROR: 'Výsledek nebyl spolehlivě uložen.',
  INTERNAL_ERROR: 'Výpočet selhal.',
});

function publicFields(value, schema) {
  if (value === null) return null;
  if (schema === S) return typeof value === 'string' ? value : undefined;
  if (schema === N) return typeof value === 'number' && Number.isFinite(value)
    ? value : undefined;
  if (schema === B) return typeof value === 'boolean' ? value : undefined;
  if (schema === SN) return typeof value === 'string'
    || typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  if (schema === CV) {
    if (typeof value === 'string' || typeof value === 'number' && Number.isFinite(value))
      return value;
    if (Array.isArray(value)) return value.every(item => typeof item === 'string'
      || typeof item === 'number' && Number.isFinite(item)) ? [...value] : undefined;
    return publicFields(value, { min: SN, max: SN, from: S, to: S,
      timezone: S, maxSpreadHours: N, anchorAt: S });
  }
  if (Array.isArray(schema)) return Array.isArray(value)
    ? value.flatMap(item => {
      const projected = publicFields(item, schema[0]);
      return projected === undefined ? [] : [projected];
    }) : undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(schema).flatMap(([key, child]) => {
    if (!Object.hasOwn(value, key)) return [];
    const projected = publicFields(value[key], child);
    return projected === undefined ? [] : [[key, projected]];
  }));
}

function publicErrors(errors) {
  if (!Array.isArray(errors)) return undefined;
  return errors.map(error => {
    const code = Object.hasOwn(PUBLIC_ERROR_MESSAGES, error?.code)
      ? error.code : 'INTERNAL_ERROR';
    return { code, fieldPath: null, message: PUBLIC_ERROR_MESSAGES[code],
      retryable: code === 'PROVIDER_ERROR', sourceRef: null };
  });
}

function isBettingTool(toolType) {
  return typeof toolType === 'string' && /^sazeni\.[a-z_]+$/u.test(toolType);
}

function publicSourceUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.port || url.username || url.password
      || url.search || url.hash) return false;
    if (url.hostname === 'www.football-data.co.uk')
      return url.pathname === '/fixtures.csv'
        || /^\/mmz4281\/\d{4}\/(?:E0|D1|I1|SP1|F1)\.csv$/u.test(url.pathname);
    if (url.hostname === 'api.ifortuna.cz')
      return /^\/offer\/(?:structure\/api\/v1_0\/tournament\/ufo:tour:[a-z0-9-]+\/matches|markets\/api\/v1_0\/fixtures\/markets\/overview)$/u.test(url.pathname);
    if (url.hostname === 'api.odds-api.io')
      return /^\/v3\/(?:bookmakers|events|odds\/multi)$/u.test(url.pathname);
    return false;
  } catch {
    return false;
  }
}

function publicFortunaPageUrl(value, league) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'www.ifortuna.cz'
      && !url.port && !url.username && !url.password && !url.hash
      && Object.hasOwn(FORTUNA_PUBLIC_PAGE_PATHS, league)
      && url.pathname === FORTUNA_PUBLIC_PAGE_PATHS[league]
      && url.search === '?tab=matches';
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
      typeof page?.league === 'string' && publicFortunaPageUrl(page.url, page.league)
        ? [{ league: page.league, url: page.url }] : []
    )) : [];
  return {
    autonomous: analysis.autonomous === true,
    sourceRefs,
    ...(publicPages.length ? { publicSourcePages: publicPages } : {}),
    ...(analysis.policy?.id === 'football-1x2-policy-v1'
      && analysis.policy.selectedMethod === 'market-proportional-v1'
      ? { policy: { id: analysis.policy.id,
        selectedMethod: analysis.policy.selectedMethod } } : {}),
    ...(Array.isArray(analysis.limitations)
      ? { limitations: analysis.limitations.filter(item => PUBLIC_BETTING_LIMITATIONS.has(item)) } : {}),
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
    item.data = publicFields(result, BETTING_PUBLIC_SCHEMA);
    const errors = publicErrors(result.errors);
    if (errors) item.data.errors = errors;
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
