// Factual catalog metadata enrichment for installed candidate discovery.
// This module never copies or estimates quality scores.

export function catalogLookupKey(value) {
  if (typeof value !== 'string') return null;
  let key = value.trim().toLowerCase();
  if (!key) return null;
  if (key.endsWith(':latest')) key = key.slice(0, -':latest'.length).trimEnd();
  if (!key) return null;
  const sizeMatch = key.match(/^(.*?)[-:](\d+(?:\.\d+)?b(?:[-_].*)?)$/);
  if (sizeMatch?.[1]) key = `${sizeMatch[1]}:${sizeMatch[2]}`;
  return key;
}

export function buildCatalogIndex(catalog) {
  const index = new Map();
  if (!Array.isArray(catalog)) return index;
  for (const entry of catalog) {
    const key = catalogLookupKey(entry?.name);
    if (key && !index.has(key)) index.set(key, entry);
  }
  return index;
}

function applyEntry(candidate, entry) {
  candidate.releaseDate = entry.releaseDate ?? candidate.releaseDate ?? null;
  candidate.baseVramMb = candidate.baseVramMb ?? entry.baseVramMb ?? null;
  candidate.contextWindow = candidate.contextWindow ?? entry.contextWindow ?? null;
  candidate.capabilities = candidate.capabilities ?? entry.capabilities ?? null;
  candidate.architecture = candidate.architecture ?? entry.architecture ?? null;
  candidate.supersedes = candidate.supersedes ?? entry.supersedes ?? null;
  if (!candidate.params && entry.params) candidate.params = entry.params;
  if (candidate.category === 'unknown' && entry.category) candidate.category = entry.category;
  candidate.metadataSource = 'catalog-exact';
}

export function enrichLocalCandidateMetadata(candidates, catalog) {
  const summary = { exact: 0, unmatched: [] };
  if (!Array.isArray(candidates) || candidates.length === 0) return summary;
  if (!Array.isArray(catalog) || catalog.length === 0) {
    summary.unmatched = candidates.map(candidate => candidate.name);
    return summary;
  }
  const index = buildCatalogIndex(catalog);
  for (const candidate of candidates) {
    const entry = index.get(catalogLookupKey(candidate.name));
    if (!entry) {
      summary.unmatched.push(candidate.name);
      continue;
    }
    applyEntry(candidate, entry);
    summary.exact += 1;
  }
  return summary;
}

export default { catalogLookupKey, buildCatalogIndex, enrichLocalCandidateMetadata };
