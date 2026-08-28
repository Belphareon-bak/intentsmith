// v135: Safety Guard — structural validation + dedup + cooldown
// ══════════════════════════════════════════════════════════════════════════════

import crypto from 'crypto';

const VALID_TYPES = new Set([
  'MODEL_SWITCH', 'DRIFT_SCAN', 'QUALITY_REVIEW', 'PATTERN_REVIEW',
  'PROPOSAL_REVIEW', 'MODEL_EVALUATION_REVIEW', 'SPECIALIST_CHECK',
]);
const VALID_SEVERITIES = new Set(['LOW', 'MEDIUM', 'HIGH']);
const MIN_CONFIDENCE = 0.3;

// Cooldown durations in hours, per severity (after dismiss)
const COOLDOWN_HOURS = { HIGH: 3, MEDIUM: 12, LOW: 24 };

function computeHash(ruleId, type, keyDetails) {
  const raw = ruleId + '|' + type + '|' + JSON.stringify(keyDetails || {});
  return crypto.createHash('sha1').update(raw).digest('hex');
}

function validateProposal(p) {
  if (!p.type || !VALID_TYPES.has(p.type)) return `Invalid type: ${p.type}`;
  if (!p.severity || !VALID_SEVERITIES.has(p.severity)) return `Invalid severity: ${p.severity}`;
  if (!p.title) return 'Missing title';
  if (!p.description) return 'Missing description';
  if (typeof p.confidence !== 'number' || p.confidence < MIN_CONFIDENCE) return `Confidence too low: ${p.confidence}`;
  return null;
}

export const safetyGuard = {
  /**
   * Filter proposals through validation, dedup, and cooldown gates.
   * @param {Array<Object>} proposals — from improvementPlanner.evaluate()
   * @param {import('better-sqlite3').Database} db
   * @returns {Array<Object>} safe proposals with hash computed, preserving input order
   */
  filterSafe(proposals, db) {
    const safe = [];
    for (const p of proposals) {
      // 1. Structural validation
      const err = validateProposal(p);
      if (err) continue;

      // 2. Compute hash
      const hash = computeHash(p.rule_id, p.type, p._keyDetails);

      // 3. Dedup: block if same hash exists as pending OR approved (acknowledged = don't re-propose)
      try {
        const dup = db.prepare(
          "SELECT id FROM governor_proposals WHERE hash = ? AND status IN ('pending', 'approved')"
        ).get(hash);
        if (dup) continue;
      } catch { /* table may not exist yet — allow through */ }

      // 4. Cooldown: check for recently dismissed with same hash
      try {
        const cooled = db.prepare(
          "SELECT id FROM governor_proposals WHERE hash = ? AND status = 'dismissed' AND cooldown_until > datetime('now')"
        ).get(hash);
        if (cooled) continue;
      } catch { /* allow through */ }

      // Strip internal field, add hash
      const clean = { ...p, hash };
      delete clean._keyDetails;
      safe.push(clean);
    }
    return safe;
  },
};

// Exported for testing
export { computeHash, validateProposal, VALID_TYPES, VALID_SEVERITIES, MIN_CONFIDENCE, COOLDOWN_HOURS };
