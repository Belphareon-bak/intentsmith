// Quality Score — Deterministic Diagnostic Metrics
// ══════════════════════════════════════════════════════════════════════════════
// Score ≠ Gate. Continuous 0.0–1.0 diagnostic, NOT a blocker.
//
// Spec score = 0.25·decision_depth + 0.25·measurability + 0.20·coverage
//            + 0.15·specificity + 0.15·risk_quality
//
// Roadmap score = 0.30·milestone_completeness + 0.20·dependency_coherence
//               + 0.30·requirement_coverage + 0.20·sizing_realism
//
// Change score = 0.30·impact_clarity + 0.25·risk_articulation
//              + 0.25·delta_complexity + 0.20·preservation
//
// Lifecycle score = 0.50·spec + 0.30·roadmap + 0.20·change
//   (no change → 0.60·spec + 0.40·roadmap)
//
// All computations are deterministic — no LLM calls.
// ══════════════════════════════════════════════════════════════════════════════

// ─── Helpers ────────────────────────────────────────────────────────────────

const VAGUE_PHRASES = [
  'tbd', 'later', 'good enough', 'as needed', 'if possible',
  'appropriate', 'adequate', 'various', 'etc.', 'and more',
  'some kind of', 'maybe', 'probably', 'might work',
];

function round2(n) {
  return Math.round(n * 100) / 100;
}

function clamp(n, min = 0, max = 1) {
  return Math.max(min, Math.min(max, n));
}

function scoreLabel(score) {
  if (score >= 0.85) return 'EXCELLENT';
  if (score >= 0.70) return 'GOOD';
  if (score >= 0.55) return 'ACCEPTABLE';
  return 'WEAK';
}

function countVaguePhrases(text) {
  if (!text || typeof text !== 'string') return 0;
  const lower = text.toLowerCase();
  return VAGUE_PHRASES.filter(p => lower.includes(p)).length;
}

function hasTradeoffLanguage(text) {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  const markers = [
    'but ', 'however', 'trade-off', 'tradeoff', 'whereas',
    'downside', 'on the other hand', 'although', 'despite',
  ];
  return markers.some(m => lower.includes(m));
}

// ─── Spec Sub-metrics ───────────────────────────────────────────────────────

/**
 * Decision depth: alternatives breadth, rationale quality, trade-off language.
 */
function scoreDecisionDepth(spec) {
  const decisions = spec.design_decisions;
  if (!Array.isArray(decisions) || decisions.length === 0) return 0;

  let totalScore = 0;

  for (const dd of decisions) {
    let ds = 0;

    // Alternatives considered (max 0.35)
    const alts = Array.isArray(dd.alternatives_considered)
      ? dd.alternatives_considered.length : 0;
    if (alts >= 3) ds += 0.35;
    else if (alts >= 2) ds += 0.25;
    else if (alts >= 1) ds += 0.10;

    // Rationale quality (max 0.30)
    const rationale = dd.rationale || '';
    const rLen = rationale.trim().length;
    if (rLen >= 120) ds += 0.30;
    else if (rLen >= 60) ds += 0.20;
    else if (rLen >= 20) ds += 0.10;
    else if (rLen > 0) ds += 0.05;

    // Trade-off language (max 0.20)
    if (hasTradeoffLanguage(rationale)) ds += 0.20;

    // Goal alignment — rationale references a goal ID (max 0.15)
    const fullText = `${dd.decision || ''} ${rationale}`;
    if (/\bG\d+\b/.test(fullText)) ds += 0.15;

    totalScore += clamp(ds);
  }

  let avg = totalScore / decisions.length;

  // Bonus for breadth (≥3 decisions)
  if (decisions.length >= 3) avg = Math.min(1, avg * 1.05);

  return clamp(avg);
}

/**
 * Measurability: success_criteria, acceptance_test, metric coverage + vague penalty.
 */
function scoreMeasurability(spec) {
  let score = 0;

  // Goals with success_criteria (weight 0.35)
  const goals = Array.isArray(spec.goals) ? spec.goals : [];
  if (goals.length > 0) {
    const withSC = goals.filter(
      g => g.success_criteria && typeof g.success_criteria === 'string'
        && g.success_criteria.trim().length > 0
    );
    score += 0.35 * (withSC.length / goals.length);

    // Bonus for detailed criteria (avg length > 40)
    if (withSC.length > 0) {
      const avgLen = withSC.reduce((s, g) => s + g.success_criteria.trim().length, 0) / withSC.length;
      if (avgLen > 40) score += 0.05;
    }
  }

  // Functional requirements with acceptance_test (weight 0.35)
  const funcReqs = Array.isArray(spec.requirements)
    ? spec.requirements
    : (spec.requirements?.functional || []);
  if (funcReqs.length > 0) {
    const withAT = funcReqs.filter(
      r => r.acceptance_test && typeof r.acceptance_test === 'string'
        && r.acceptance_test.trim().length > 0
    );
    score += 0.35 * (withAT.length / funcReqs.length);
  }

  // Non-functional requirements with metric (weight 0.25)
  const nfReqs = spec.requirements?.non_functional || [];
  if (nfReqs.length > 0) {
    const withMetric = nfReqs.filter(
      nf => nf.metric && typeof nf.metric === 'string' && nf.metric.trim().length > 0
    );
    score += 0.25 * (withMetric.length / nfReqs.length);
  } else if (Array.isArray(spec.requirements) && spec.requirements.length > 0) {
    // Legacy flat array — no NF reqs possible, partial credit
    score += 0.10;
  }

  // Vague phrase penalty (max -0.15)
  const allCriteria = [
    ...goals.map(g => g.success_criteria || ''),
    ...funcReqs.map(r => r.acceptance_test || ''),
    ...nfReqs.map(nf => nf.metric || ''),
  ].join(' ');
  const vagueCount = countVaguePhrases(allCriteria);
  score -= Math.min(0.15, vagueCount * 0.03);

  return clamp(score);
}

/**
 * Coverage quality: goal→requirement linkage, orphan detection.
 */
function scoreCoverageQuality(spec) {
  const goals = Array.isArray(spec.goals) ? spec.goals : [];
  const funcReqs = Array.isArray(spec.requirements)
    ? spec.requirements
    : (spec.requirements?.functional || []);

  if (goals.length === 0 || funcReqs.length === 0) return 0;

  const goalIds = new Set(goals.map(g => g.id));
  const coveredGoals = new Set();
  let linkedReqs = 0;

  for (const req of funcReqs) {
    if (req.goal_id && goalIds.has(req.goal_id)) {
      coveredGoals.add(req.goal_id);
      linkedReqs++;
    }
  }

  const goalsCoveredRatio = coveredGoals.size / goalIds.size;
  const reqsLinkedRatio = linkedReqs / funcReqs.length;

  // 50% goal coverage + 30% req linkage + 20% no-orphan bonus
  let score = 0.50 * goalsCoveredRatio + 0.30 * reqsLinkedRatio;

  if (goalsCoveredRatio === 1.0) score += 0.20;
  else if (goalsCoveredRatio >= 0.65) score += 0.10;

  return clamp(score);
}

/**
 * Specificity: concrete indicators vs vague language.
 */
function scoreSpecificity(spec) {
  const texts = [];

  if (spec.title) texts.push(spec.title);

  for (const g of (Array.isArray(spec.goals) ? spec.goals : [])) {
    if (g.description) texts.push(g.description);
    if (g.success_criteria) texts.push(g.success_criteria);
  }

  const funcReqs = Array.isArray(spec.requirements)
    ? spec.requirements : (spec.requirements?.functional || []);
  for (const r of funcReqs) {
    if (r.description) texts.push(r.description);
    if (r.acceptance_test) texts.push(r.acceptance_test);
  }

  for (const nf of (spec.requirements?.non_functional || [])) {
    if (nf.description) texts.push(nf.description);
    if (nf.metric) texts.push(nf.metric);
  }

  for (const dd of (Array.isArray(spec.design_decisions) ? spec.design_decisions : [])) {
    if (dd.rationale) texts.push(dd.rationale);
    if (dd.decision) texts.push(dd.decision);
  }

  for (const r of (Array.isArray(spec.risks) ? spec.risks : [])) {
    if (r.description) texts.push(r.description);
    if (r.mitigation) texts.push(r.mitigation);
  }

  const fullText = texts.join(' ');
  if (fullText.length < 10) return 0;

  let concreteCount = 0;

  // File paths (.js, .ts, .py, etc.)
  concreteCount += (fullText.match(/\b[\w/-]+\.(js|ts|py|go|rs|json|yaml|yml|sql|sh|enc)\b/g) || []).length;

  // CLI flags (--flag)
  concreteCount += (fullText.match(/\s--\w{2,}/g) || []).length;

  // Numbers with units
  concreteCount += (fullText.match(/\b\d+\s*(ms|mb|gb|kb|fps|loc)\b/gi) || []).length;
  concreteCount += (fullText.match(/<\s*\d+\s*(ms|s|mb)\b/gi) || []).length;

  // HTTP methods / status codes
  concreteCount += (fullText.match(/\b(GET|POST|PUT|DELETE|PATCH)\b/g) || []).length;
  concreteCount += (fullText.match(/\b[1-5]\d{2}\b/g) || []).length;

  // Technology names (broad list)
  concreteCount += (fullText.match(/\b(AES|RSA|SHA|HMAC|JWT|OAuth|REST|GraphQL|WebSocket|SQLite|PostgreSQL|MySQL|MongoDB|Redis|Docker|Kubernetes|Argon2|scrypt|PBKDF2|GCM|CBC|WAL|ACID|ChaCha20|Poly1305|node-gyp|npm|AES-NI)\b/gi) || []).length;

  // Assertion arrows and specific patterns in acceptance tests
  concreteCount += (fullText.match(/\u2192|\u2190|=>/g) || []).length;

  // Quoted identifiers / error message patterns
  concreteCount += (fullText.match(/"[^"]{3,30}"/g) || []).length;

  // Score based on absolute count with thresholds
  let score;
  if (concreteCount >= 25) score = 0.90;
  else if (concreteCount >= 18) score = 0.80;
  else if (concreteCount >= 12) score = 0.65;
  else if (concreteCount >= 7) score = 0.50;
  else if (concreteCount >= 3) score = 0.30;
  else if (concreteCount >= 1) score = 0.15;
  else score = 0;

  // Vague penalty
  const vagueCount = countVaguePhrases(fullText);
  score -= vagueCount * 0.05;

  return clamp(score);
}

/**
 * Risk quality: register completeness, severity, mitigation depth.
 */
function scoreRiskQuality(spec) {
  const risks = Array.isArray(spec.risks) ? spec.risks : [];
  if (risks.length === 0) return 0;

  let totalScore = 0;

  for (const risk of risks) {
    let rs = 0;

    // Description present and non-trivial (0.20)
    if (risk.description && risk.description.trim().length > 10) rs += 0.20;

    // Severity (0.20)
    if (risk.severity && typeof risk.severity === 'string') rs += 0.20;

    // Likelihood (0.15)
    if (risk.likelihood && typeof risk.likelihood === 'string') rs += 0.15;

    // Mitigation exists (0.25) + detailed (0.20)
    const mitLen = (risk.mitigation || '').trim().length;
    if (mitLen > 30) rs += 0.45;
    else if (mitLen > 10) rs += 0.25;
    else if (mitLen > 0) rs += 0.10;

    totalScore += clamp(rs);
  }

  let avg = totalScore / risks.length;

  // Bonus for ≥3 risks
  if (risks.length >= 3) avg = Math.min(1, avg * 1.05);
  // Penalty for only 1 risk
  if (risks.length === 1) avg *= 0.75;

  return clamp(avg);
}

// ─── Roadmap Sub-metrics ────────────────────────────────────────────────────

/**
 * Milestone completeness: fields present per milestone.
 */
function scoreMilestoneCompleteness(roadmap) {
  const milestones = roadmap.milestones;
  let totalScore = 0;

  for (const ms of milestones) {
    let msScore = 0;
    const checks = 8;

    if (ms.title && ms.title.trim().length > 0) msScore++;
    if (ms.description && ms.description.trim().length > 10) msScore++;
    if (Array.isArray(ms.acceptance_criteria) && ms.acceptance_criteria.length > 0) msScore++;
    if (ms.test_strategy && typeof ms.test_strategy === 'object') msScore++;
    if (ms.estimated_loc && ms.estimated_loc > 0) msScore++;
    if (ms.estimated_files && ms.estimated_files > 0) msScore++;
    if (ms.estimated_complexity && typeof ms.estimated_complexity === 'string') msScore++;
    if (Array.isArray(ms.dependencies)) msScore++;

    totalScore += msScore / checks;
  }

  return clamp(totalScore / milestones.length);
}

/**
 * Dependency coherence: valid refs, no self-deps, no circular.
 */
function scoreDependencyCoherence(roadmap) {
  const milestones = roadmap.milestones;
  const ids = new Set(milestones.map(m => m.id));
  let errors = 0;

  for (const ms of milestones) {
    const deps = ms.dependencies || [];
    for (const dep of deps) {
      if (!ids.has(dep)) errors++;
      if (dep === ms.id) errors++;
    }
  }

  // Simple cycle check
  const visited = new Set();
  const visiting = new Set();

  function hasCycle(id) {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const ms = milestones.find(m => m.id === id);
    if (ms) {
      for (const dep of (ms.dependencies || [])) {
        if (hasCycle(dep)) { errors++; return true; }
      }
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }

  for (const ms of milestones) {
    visited.clear();
    visiting.clear();
    hasCycle(ms.id);
  }

  if (errors === 0) return 1.0;
  return clamp(1.0 - (errors * 0.25));
}

/**
 * Requirement coverage: coverage mapping completeness.
 */
function scoreRequirementCoverage(roadmap) {
  const rc = roadmap.requirements_coverage;
  if (!rc) return 0;

  let score = 0.40; // Base for having the field

  const covered = Array.isArray(rc.covered) ? rc.covered : [];
  const uncovered = Array.isArray(rc.uncovered) ? rc.uncovered : [];
  const total = covered.length + uncovered.length;

  if (total > 0) {
    score += 0.40 * (covered.length / total);
  } else {
    score += 0.20;
  }

  // Rationale for uncovered
  if (uncovered.length > 0) {
    if (rc.rationale_for_uncovered && rc.rationale_for_uncovered.trim().length > 10) {
      score += 0.20;
    }
  } else {
    score += 0.20; // Full coverage
  }

  return clamp(score);
}

/**
 * Sizing realism: LOC, files, complexity within reasonable ranges.
 */
function scoreSizingRealism(roadmap) {
  const milestones = roadmap.milestones;
  let totalScore = 0;

  for (const ms of milestones) {
    let msScore = 0;

    // LOC in reasonable range (50–3000)
    const loc = ms.estimated_loc || 0;
    if (loc >= 50 && loc <= 3000) msScore += 0.35;
    else if (loc > 0) msScore += 0.15;

    // Files in reasonable range (1–30)
    const files = ms.estimated_files || 0;
    if (files >= 1 && files <= 30) msScore += 0.30;
    else if (files > 0) msScore += 0.15;

    // Valid complexity enum
    if (['LOW', 'MEDIUM', 'HIGH'].includes(ms.estimated_complexity)) msScore += 0.20;

    // LOC/files ratio (20–200 per file)
    if (loc > 0 && files > 0) {
      const ratio = loc / files;
      if (ratio >= 20 && ratio <= 200) msScore += 0.15;
    }

    totalScore += clamp(msScore);
  }

  return clamp(totalScore / milestones.length);
}

// ─── Change Sub-metrics ─────────────────────────────────────────────────────

/**
 * Impact clarity: affected milestones, delta details, recommendation.
 */
function scoreImpactClarity(analysis) {
  let score = 0;

  if (Array.isArray(analysis.affected_milestones) && analysis.affected_milestones.length > 0) {
    score += 0.35;
  }

  if (analysis.impact) {
    score += 0.15;
    if (analysis.impact.effort_delta) score += 0.15;
    if (analysis.impact.milestones_to_add || analysis.impact.milestones_to_remove
      || analysis.impact.milestones_to_modify) {
      score += 0.15;
    }
  }

  if (analysis.recommendation && typeof analysis.recommendation === 'string'
    && analysis.recommendation.length > 10) {
    score += 0.20;
  }

  return clamp(score);
}

/**
 * Risk articulation: risk_level + feasibility.
 */
function scoreChangeRiskArticulation(analysis) {
  let score = 0;

  if (analysis.impact?.risk_level) {
    score += 0.40;
    if (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(
      (analysis.impact.risk_level || '').toUpperCase()
    )) {
      score += 0.20;
    }
  }

  if (analysis.feasibility && typeof analysis.feasibility === 'string') {
    score += 0.40;
  }

  return clamp(score);
}

/**
 * Delta complexity: add/remove/modify details + effort delta.
 */
function scoreDeltaComplexity(analysis) {
  let score = 0;
  const impact = analysis.impact || {};

  if (Array.isArray(impact.milestones_to_add)) score += 0.30;
  if (Array.isArray(impact.milestones_to_remove)) score += 0.20;
  if (Array.isArray(impact.milestones_to_modify)) score += 0.30;
  if (impact.effort_delta && typeof impact.effort_delta === 'string') score += 0.20;

  return clamp(score);
}

/**
 * Preservation: completed milestone acknowledgment.
 */
function scorePreservation(analysis) {
  let score = 0.50; // Base — assume good faith

  if (Array.isArray(analysis.preserved_milestones)) {
    score += 0.30;
  }

  // Check if impact text references preservation
  const impactStr = JSON.stringify(analysis.impact || {});
  if (/preserv|complet|PASSED/i.test(impactStr)) {
    score += 0.20;
  }

  return clamp(score);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compute spec quality score (0.0–1.0).
 * Deterministic, no LLM.
 *
 * @param {Object} spec - Structured project specification
 * @returns {{ score: number, breakdown: Object, label: string }}
 */
export function computeSpecScore(spec) {
  if (!spec) return { score: 0, breakdown: {}, label: 'NONE' };

  const dd = scoreDecisionDepth(spec);
  const me = scoreMeasurability(spec);
  const cq = scoreCoverageQuality(spec);
  const sp = scoreSpecificity(spec);
  const rq = scoreRiskQuality(spec);

  const score = 0.25 * dd + 0.25 * me + 0.20 * cq + 0.15 * sp + 0.15 * rq;

  return {
    score: round2(score),
    breakdown: {
      decision_depth: round2(dd),
      measurability: round2(me),
      coverage_quality: round2(cq),
      specificity: round2(sp),
      risk_quality: round2(rq),
    },
    label: scoreLabel(score),
  };
}

/**
 * Compute roadmap quality score (0.0–1.0).
 *
 * @param {Object} roadmap - { milestones: [...], requirements_coverage?: {...} }
 * @returns {{ score: number, breakdown: Object, label: string }}
 */
export function computeRoadmapScore(roadmap) {
  if (!roadmap || !Array.isArray(roadmap.milestones) || roadmap.milestones.length === 0) {
    return { score: 0, breakdown: {}, label: 'NONE' };
  }

  const mc = scoreMilestoneCompleteness(roadmap);
  const dc = scoreDependencyCoherence(roadmap);
  const rc = scoreRequirementCoverage(roadmap);
  const sr = scoreSizingRealism(roadmap);

  const score = 0.30 * mc + 0.20 * dc + 0.30 * rc + 0.20 * sr;

  return {
    score: round2(score),
    breakdown: {
      milestone_completeness: round2(mc),
      dependency_coherence: round2(dc),
      requirement_coverage: round2(rc),
      sizing_realism: round2(sr),
    },
    label: scoreLabel(score),
  };
}

/**
 * Compute change impact quality score (0.0–1.0).
 *
 * @param {Object} analysis - Change impact analysis
 * @returns {{ score: number, breakdown: Object, label: string }}
 */
export function computeChangeScore(analysis) {
  if (!analysis) return { score: 0, breakdown: {}, label: 'NONE' };

  const ic = scoreImpactClarity(analysis);
  const ra = scoreChangeRiskArticulation(analysis);
  const dc = scoreDeltaComplexity(analysis);
  const pr = scorePreservation(analysis);

  const score = 0.30 * ic + 0.25 * ra + 0.25 * dc + 0.20 * pr;

  return {
    score: round2(score),
    breakdown: {
      impact_clarity: round2(ic),
      risk_articulation: round2(ra),
      delta_complexity: round2(dc),
      preservation: round2(pr),
    },
    label: scoreLabel(score),
  };
}

/**
 * Compute overall lifecycle quality score.
 *
 * @param {{ spec_score: number, roadmap_score: number, change_score?: number|null }} scores
 * @returns {{ score: number, label: string }}
 */
export function computeLifecycleScore({ spec_score = 0, roadmap_score = 0, change_score = null }) {
  // If no change management happened, redistribute weight
  if (change_score === null || change_score === undefined) {
    const score = 0.60 * spec_score + 0.40 * roadmap_score;
    return { score: round2(score), label: scoreLabel(score) };
  }

  const score = 0.50 * spec_score + 0.30 * roadmap_score + 0.20 * change_score;
  return { score: round2(score), label: scoreLabel(score) };
}

export default {
  computeSpecScore,
  computeRoadmapScore,
  computeChangeScore,
  computeLifecycleScore,
};
