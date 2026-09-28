// Canonical installed-model inventory normalization.
//
// Every production/read/scoring surface must derive the same numeric model
// parameters, family and category from the same raw Ollama row.  Callers may
// add richer factual metadata, but an older caller-provided parser result must
// not override the extended parser for a known model family.

import { parseModelNameExtended } from './model-family-extensions.js';
import { normalizeModelDigestSha256 } from './model-identity.js';

function numericParameters(value) {
  if (Number.isFinite(value) && Number(value) > 0) return Number(value);
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*[bB]?$/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizedCapabilities(row) {
  const source = Array.isArray(row?.capabilities)
    ? row.capabilities
    : (Array.isArray(row?.details?.capabilities) ? row.details.capabilities : []);
  return [...new Set(source
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => value.trim().toLowerCase()))].sort();
}

export function normalizeInstalledModel(row = {}) {
  const name = typeof row?.name === 'string' ? row.name.trim() : '';
  const parsed = parseModelNameExtended(name);
  const capabilities = normalizedCapabilities(row);
  const declaredCategory = typeof row?.category === 'string'
    ? row.category.trim().toLowerCase()
    : 'unknown';
  let category = parsed.category !== 'unknown' ? parsed.category : declaredCategory;
  if (!category) category = 'unknown';

  const declaredFamily = typeof row?.family === 'string' ? row.family.trim() : 'unknown';
  const family = parsed.family !== 'unknown' ? parsed.family : (declaredFamily || 'unknown');
  const params = numericParameters(row?.params)
    ?? numericParameters(row?.details?.parameter_size)
    ?? parsed.params;
  const sizeSource = row?.size ?? row?.sizeBytes
    ?? (Number.isFinite(Number(row?.sizeGB)) ? Number(row.sizeGB) * 1_073_741_824 : 0);
  const size = Number.isFinite(Number(sizeSource)) && Number(sizeSource) >= 0
    ? Number(sizeSource)
    : 0;
  const quantization = row?.details?.quantization_level
    || row?.quantization
    || parsed.quantization
    || null;
  const digestSha256 = normalizeModelDigestSha256(row?.digestSha256 || row?.digest);
  const modifiedAt = row?.modified_at || row?.modifiedAt || null;

  return {
    ...row,
    name,
    digest: row?.digest || digestSha256,
    digestSha256,
    size,
    sizeBytes: size,
    sizeGB: (size / 1_073_741_824).toFixed(1),
    modified_at: modifiedAt,
    modifiedAt,
    params: Number.isFinite(params) ? params : null,
    paramsLabel: Number.isFinite(params) ? `${params}B` : '?',
    family,
    category,
    version: parsed.version,
    quantization,
    capabilities,
    details: row?.details || null,
  };
}

export function normalizeInstalledInventory(rows = []) {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeInstalledModel);
}

export default { normalizeInstalledModel, normalizeInstalledInventory };
