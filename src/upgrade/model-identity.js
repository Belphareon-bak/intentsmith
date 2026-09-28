// Canonical model identity for binding and presence safety.
//
// Ollama may expose an implicitly tagged model as `name:latest` while the
// configured role binding stores `name`.  Those two spellings identify the
// same logical presence.  Explicit non-latest tags stay distinct, and this
// module deliberately does not perform family, size or quantization matching.
//
// A canonical name is not an artifact identity.  Callers that authorize a
// failover or claim verification must additionally bind the exact digest.

/**
 * Return the canonical key used for model presence and binding comparisons.
 * Invalid or empty values return null so two invalid values never compare as
 * the same model.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function canonicalModelName(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  const canonical = normalized.endsWith(':latest')
    ? normalized.slice(0, -':latest'.length).trimEnd()
    : normalized;
  return canonical || null;
}

/**
 * Compare two names using only the conservative presence identity.
 *
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
export function sameModelName(left, right) {
  const leftKey = canonicalModelName(left);
  const rightKey = canonicalModelName(right);
  return leftKey !== null && rightKey !== null && leftKey === rightKey;
}

/**
 * Return the exact spellings which can represent this canonical identity in
 * persisted name-only tables.  Explicit tags such as `:7b` do not acquire a
 * second, invalid `:latest` suffix.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export function modelNameAliases(value) {
  const canonical = canonicalModelName(value);
  if (!canonical) return [];
  const lastSlash = canonical.lastIndexOf('/');
  const lastColon = canonical.lastIndexOf(':');
  const hasExplicitTag = lastColon > lastSlash;
  return hasExplicitTag ? [canonical] : [canonical, `${canonical}:latest`];
}

/**
 * Build a set of canonical presence keys, dropping invalid entries.
 *
 * @param {Iterable<unknown>} values
 * @returns {Set<string>}
 */
export function canonicalModelNameSet(values) {
  const result = new Set();
  for (const value of values || []) {
    const key = canonicalModelName(value);
    if (key) result.add(key);
  }
  return result;
}

/**
 * Normalize the exact artifact digest returned by Ollama.
 *
 * Ollama inventories in the wild and in the repository's real-endpoint
 * fixtures use both a bare 64-hex value and the conventional `sha256:`
 * prefix.  Presence identity must never absorb this value: callers authorize
 * an artifact only with the separately validated digest returned here.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeModelDigestSha256(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/^sha256:/, '');
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}
