// Preference Tracker v118 — Implicit user preferences from upgrade history
// ══════════════════════════════════════════════════════════════════════════════
//
// Tracks per (role, family, sizeBucket) from existing tables — NO new table.
//
// Data sources:
//   upgrade_proposals: status (approved/rejected/dismissed) → approve/reject/dismiss
//   upgrade_history:   action='rollback' → rollback
//
// Score formula:
//   totalActions = approvals + rejections + rollbacks*2 + dismissals*3
//   base = approvals / totalActions
//   decay = exp(-daysSinceLastAction / 90)
//   confidence = min(1.0, totalActions / 5)   // dampening: first 1-4 < full weight
//   preferenceScore = base * decay * confidence
//
// Penalty:
//   if preferenceScore > 0.5 → 0
//   else → (0.5 - preferenceScore) * 0.16     // max 0.08
//
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Classify model params into a size bucket.
 * @param {number} params - Param count in billions
 * @returns {'small'|'medium'|'large'}
 */
export function sizeBucket(params) {
  if (!params || params < 10) return 'small';
  if (params <= 30) return 'medium';
  return 'large';
}

/**
 * Compute preference penalty for a candidate model.
 *
 * @param {string} role
 * @param {string} candidateFamily
 * @param {number} candidateParams - Billions
 * @param {Object} db - better-sqlite3 database instance
 * @returns {number} Penalty 0-0.08 (subtracted from upgrade delta)
 */
export function computePreferencePenalty(role, candidateFamily, candidateParams, db) {
  if (!db) return 0;
  const stats = getPreferenceStats(role, db);
  const bucket = sizeBucket(candidateParams);
  const key = `${candidateFamily}:${bucket}`;
  const entry = stats.get(key);
  if (!entry || entry.totalActions === 0) return 0;
  return entry.penalty;
}

/**
 * Build preference stats for a role from DB history.
 *
 * @param {string} role
 * @param {Object} db
 * @returns {Map<string, { approvals, rejections, rollbacks, dismissals, totalActions, score, penalty, lastActionAt }>}
 */
export function getPreferenceStats(role, db) {
  const result = new Map();
  if (!db) return result;

  // Gather proposal history (approved, rejected, dismissed)
  try {
    const proposals = db.prepare(`
      SELECT candidate_model, status, resolved_at FROM upgrade_proposals
      WHERE role = ? AND status IN ('approved', 'rejected', 'dismissed')
      ORDER BY resolved_at DESC
    `).all(role);

    for (const p of proposals) {
      const family = _extractFamily(p.candidate_model);
      const params = _extractParams(p.candidate_model);
      const bucket = sizeBucket(params);
      const key = `${family}:${bucket}`;

      if (!result.has(key)) {
        result.set(key, { approvals: 0, rejections: 0, rollbacks: 0, dismissals: 0, totalActions: 0, score: 0, penalty: 0, lastActionAt: null });
      }
      const entry = result.get(key);

      if (p.status === 'approved') entry.approvals++;
      else if (p.status === 'rejected') entry.rejections++;
      else if (p.status === 'dismissed') entry.dismissals++;

      if (!entry.lastActionAt || p.resolved_at > entry.lastActionAt) {
        entry.lastActionAt = p.resolved_at;
      }
    }
  } catch (_) {}

  // Gather rollback history
  try {
    const rollbacks = db.prepare(`
      SELECT new_model, created_at FROM upgrade_history
      WHERE role = ? AND action = 'rollback'
      ORDER BY created_at DESC
    `).all(role);

    for (const r of rollbacks) {
      const family = _extractFamily(r.new_model);
      const params = _extractParams(r.new_model);
      const bucket = sizeBucket(params);
      const key = `${family}:${bucket}`;

      if (!result.has(key)) {
        result.set(key, { approvals: 0, rejections: 0, rollbacks: 0, dismissals: 0, totalActions: 0, score: 0, penalty: 0, lastActionAt: null });
      }
      const entry = result.get(key);
      entry.rollbacks++;

      if (!entry.lastActionAt || r.created_at > entry.lastActionAt) {
        entry.lastActionAt = r.created_at;
      }
    }
  } catch (_) {}

  // Compute scores and penalties
  const now = Date.now();
  for (const [, entry] of result) {
    entry.totalActions = entry.approvals + entry.rejections + entry.rollbacks * 2 + entry.dismissals * 3;
    if (entry.totalActions === 0) continue;

    const base = entry.approvals / entry.totalActions;

    const daysSinceLast = entry.lastActionAt
      ? (now - Date.parse(entry.lastActionAt)) / (24 * 60 * 60 * 1000)
      : 999;
    const decay = Math.exp(-daysSinceLast / 90);

    const confidence = Math.min(1.0, entry.totalActions / 5);

    entry.score = base * decay * confidence;
    entry.penalty = entry.score > 0.5 ? 0 : (0.5 - entry.score) * 0.16;
  }

  return result;
}

// ─── Internal Helpers ──────────────────────────────────────────────────────

function _extractFamily(modelName) {
  if (!modelName) return 'unknown';
  const lower = modelName.toLowerCase();
  // Match against known prefixes (aligned with model-profiles.js MODEL_FAMILIES)
  const families = [
    'deepseek-r1', 'deepseek-coder', 'deepseek',
    'qwen2.5-coder', 'qwen-coder', 'qwen',
    'llama', 'codestral', 'mistral-nemo', 'mistral-small', 'mistral', 'mixtral',
    'phi', 'gemma', 'starcoder', 'llava-llama3', 'llava', 'bakllava',
    'moondream', 'minicpm',
  ];
  for (const f of families) {
    if (lower.startsWith(f)) return f;
  }
  return 'unknown';
}

function _extractParams(modelName) {
  if (!modelName) return 0;
  const match = modelName.match(/[:\-](\d+)b/i);
  return match ? parseInt(match[1], 10) : 0;
}

export default { computePreferencePenalty, getPreferenceStats, sizeBucket };
