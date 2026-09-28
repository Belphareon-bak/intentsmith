// Factual helpers for candidate discovery. These functions estimate resource
// fit and inherit descriptive metadata only; they never produce quality data.

export function normalizeFamily(name) {
  if (!name) return '';
  return name.toLowerCase().replace(/[-_]/g, '').replace(/\.\d+$/, '');
}

export function estimateVram(params) {
  if (!params || params <= 0) return 0;
  return Math.round(620 * params + 420);
}

export function buildFamilyMetadataModels(catalog) {
  if (!Array.isArray(catalog)) return new Map();
  const families = new Map();
  for (const entry of catalog) {
    if (!entry.family || !entry.params) continue;
    const family = normalizeFamily(entry.family);
    if (!families.has(family)) families.set(family, []);
    families.get(family).push({
      params: entry.params,
      category: entry.category,
      capabilities: entry.capabilities,
      contextWindow: entry.contextWindow,
    });
  }
  for (const entries of families.values()) entries.sort((a, b) => a.params - b.params);
  return families;
}

export function inheritFromNearest(family, params, familyMetadata) {
  if (!family || !params || !familyMetadata) {
    return { category: null, capabilities: null, contextWindow: null };
  }
  const entries = familyMetadata.get(normalizeFamily(family));
  if (!entries?.length) {
    return { category: null, capabilities: null, contextWindow: null };
  }
  let nearest = entries[0];
  let distance = Math.abs(nearest.params - params);
  for (const entry of entries.slice(1)) {
    const nextDistance = Math.abs(entry.params - params);
    if (nextDistance < distance) {
      nearest = entry;
      distance = nextDistance;
    }
  }
  return {
    category: nearest.category || null,
    capabilities: nearest.capabilities ? [...nearest.capabilities] : null,
    contextWindow: nearest.contextWindow ?? null,
  };
}

export function extractLibraryName(modelName) {
  if (!modelName) return '';
  return modelName.split(':')[0].toLowerCase().trim().replace(/-\d+b(-[a-z]\d+b)?$/, '');
}

export default {
  normalizeFamily,
  estimateVram,
  buildFamilyMetadataModels,
  inheritFromNearest,
  extractLibraryName,
};
