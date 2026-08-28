// v135: Improvement Planner — 8 deterministic rules + confidence + priority + root cause
// ══════════════════════════════════════════════════════════════════════════════
// No LLM. Each rule fires based on health analysis data. Returns structured proposals.

const SEVERITY_WEIGHT = { HIGH: 0.9, MEDIUM: 0.6, LOW: 0.3 };
const PRIORITY_SEVERITY = { HIGH: 1.0, MEDIUM: 0.6, LOW: 0.3 };

function computeConfidence(severity, dataCompleteness, trendStrength) {
  return Math.round((
    (SEVERITY_WEIGHT[severity] || 0.3) * 0.5 +
    (dataCompleteness || 0) * 0.3 +
    Math.min(Math.abs(trendStrength || 0) / 0.4, 1.0) * 0.2
  ) * 1000) / 1000;
}

function computePriority(severity, confidence, isNew) {
  return Math.round((
    (PRIORITY_SEVERITY[severity] || 0.3) * 0.6 +
    confidence * 0.3 +
    (isNew ? 1.0 : 0.5) * 0.1
  ) * 1000) / 1000;
}

// ── R1: Model Low Success ─────────────────────────────────────────────────────
function ruleModelLowSuccess(dims) {
  const m = dims.models;
  if (!m || m.status === 'UNKNOWN' || !m.details?.roles) return null;
  const failing = m.details.roles.filter(r => r.success_rate < 0.75);
  if (!failing.length) return null;

  // Root cause heuristic — need raw details from health analysis
  let rootCause = `Nízký úspěch modelu pro role: ${failing.map(r => r.role).join(', ')}`;

  const severity = 'HIGH';
  const confidence = computeConfidence(severity, m.dataCompleteness, m.trend);
  return {
    rule_id: 'model-low-success',
    type: 'MODEL_SWITCH',
    severity,
    title: `Nízká úspěšnost modelu (${failing.map(r => `${r.role}: ${Math.round(r.success_rate * 100)}%`).join(', ')})`,
    description: `Průměrná úspěšnost pod 75% za posledních 30 dní.`,
    suggested_action: 'Zkontrolujte exact-contract evaluaci a teprve potom zvažte ruční změnu modelu.',
    action_payload: JSON.stringify({
      type: 'review-evaluation',
      target: `role:${failing[0].role}`,
      hint: `review current evaluation state for ${failing[0].role} role`,
      apiEndpoint: '/api/system/models/evaluations',
      params: { role: failing[0].role },
    }),
    confidence,
    root_cause: rootCause,
    _keyDetails: { roles: failing.map(r => r.role).sort().join(',') },
  };
}

// ── R2: Architecture Drift ────────────────────────────────────────────────────
function ruleArchDrift(dims) {
  const a = dims.architecture;
  if (!a || a.status === 'UNKNOWN' || !a.details) return null;
  if ((a.details.drift_score ?? 0) <= 0.3) return null;

  const lv = a.details.layer_violations || 0;
  const cd = a.details.circular_deps || 0;
  const rootCause = lv > cd
    ? `Překročení hranic vrstev (${lv} porušení)`
    : `Růst cyklických závislostí (${cd} cyklů)`;

  const severity = 'MEDIUM';
  const confidence = computeConfidence(severity, a.dataCompleteness, a.trend);
  return {
    rule_id: 'arch-drift-high',
    type: 'DRIFT_SCAN',
    severity,
    title: `Vysoký architekturální drift (${Math.round(a.details.drift_score * 100)}%)`,
    description: `Drift skóre překročilo 30%. ${rootCause}.`,
    suggested_action: 'Spusťte architekturální audit a zkontrolujte hranice vrstev.',
    action_payload: JSON.stringify({
      type: 'scan',
      target: 'architecture',
      hint: 'run architecture drift scan',
    }),
    confidence,
    root_cause: rootCause,
    _keyDetails: { drift: Math.round(a.details.drift_score * 100) },
  };
}

// ── R3: Build Quality Low ─────────────────────────────────────────────────────
function ruleBuildQualityLow(dims) {
  const b = dims.builds;
  if (!b || b.status === 'UNKNOWN' || !b.details) return null;
  const avgQ = b.details.avg_quality;
  if (avgQ === null || avgQ === undefined || avgQ >= 0.85) return null;

  const cpRate = b.details.checkpoint_pass_rate;
  const rootCause = (cpRate !== null && avgQ > cpRate)
    ? `Příliš přísná kritéria checkpointu (pass rate ${Math.round((cpRate ?? 0) * 100)}%)`
    : `Regrese kvality generovaného kódu (průměr ${Math.round(avgQ * 100)}%)`;

  const severity = 'MEDIUM';
  const confidence = computeConfidence(severity, b.dataCompleteness, b.trend);
  return {
    rule_id: 'build-quality-low',
    type: 'QUALITY_REVIEW',
    severity,
    title: `Nízká kvalita buildů (${Math.round(avgQ * 100)}%)`,
    description: `Průměrné skóre kvality pod 85% za 30 dní.`,
    suggested_action: 'Zkontrolujte kvalitu generovaného kódu a kritéria checkpointů.',
    action_payload: JSON.stringify({
      type: 'review',
      target: 'builds',
      hint: 'review build quality scores and checkpoint criteria',
    }),
    confidence,
    root_cause: rootCause,
    _keyDetails: { avg_quality: Math.round(avgQ * 100) },
  };
}

// ── R4: CRE Accuracy Low ─────────────────────────────────────────────────────
function ruleCRELow(dims) {
  const c = dims.cre;
  if (!c || c.status === 'UNKNOWN') return null;
  if (c.score >= 0.80) return null;

  const overrideRate = c.details?.override_rate ?? 0;
  const avgLatency = c.details?.avg_latency_ms ?? 0;
  let rootCause;
  if (overrideRate > 0.3) {
    rootCause = `Vysoká míra přepisování vzorů (override_rate=${Math.round(overrideRate * 100)}%)`;
  } else if (avgLatency > 5000) {
    rootCause = `Přetížení modelu (průměrná latence ${Math.round(avgLatency)}ms)`;
  } else {
    rootCause = `CRE přesnost ${Math.round(c.score * 100)}% pod prahem 80%`;
  }

  const severity = 'MEDIUM';
  const confidence = computeConfidence(severity, c.dataCompleteness, c.trend);
  return {
    rule_id: 'cre-accuracy-low',
    type: 'PATTERN_REVIEW',
    severity,
    title: `Nízká přesnost CRE (${Math.round(c.score * 100)}%)`,
    description: `CRE klasifikace pod 80% za 7 dní.`,
    suggested_action: 'Zkontrolujte CRE vzory a případně upravte guardy.',
    action_payload: JSON.stringify({
      type: 'review',
      target: 'src/chat/cre-decision.js',
      hint: 'review CRE patterns and guards',
    }),
    confidence,
    root_cause: rootCause,
    _keyDetails: { cre_score: Math.round(c.score * 100) },
  };
}

// ── Model exact evaluation missing ───────────────────────────────────────────
function ruleModelUnvalidated(dims) {
  const u = dims.upgrades;
  if (!u || u.status === 'UNKNOWN') return null;
  const missing = u.details?.current_evaluation_missing_roles || [];
  const failed = u.details?.current_evaluation_failed_roles || [];
  const blocked = u.details?.current_evaluation_blocked_roles || [];
  const durable = u.details?.durable_binding_count ?? 0;
  if (!missing.length && !failed.length && !blocked.length && durable === 7) return null;

  const affected = [...new Set([...missing, ...failed, ...blocked])];
  const severity = 'LOW';
  const confidence = computeConfidence(severity, u.dataCompleteness, u.trend);
  return {
    rule_id: 'model-evaluation-incomplete',
    type: 'MODEL_EVALUATION_REVIEW',
    severity,
    title: `Neúplné aktuální evaluace (${affected.length || 7 - durable} rolí)`,
    description: 'Některý durable binding nemá COMPLETE výsledek pro exact digest a aktuální suite contract.',
    suggested_action: 'Zkontrolujte stav evaluací a spusťte model-upgrade-hunt pouze v autorizovaném GPU slotu.',
    action_payload: JSON.stringify({
      type: 'review-evaluation',
      target: 'models',
      hint: 'review missing, failed and blocked exact-contract evaluations',
      apiEndpoint: '/api/system/models/evaluations',
    }),
    confidence,
    root_cause: `Exact-contract stav: missing=${missing.join(',') || '-'}; failed=${failed.join(',') || '-'}; blocked=${blocked.join(',') || '-'}`,
    _keyDetails: { affected: affected.sort().join(','), durable },
  };
}

// ── R7: Specialist Failing ────────────────────────────────────────────────────
function ruleSpecialistFailing(dims) {
  const s = dims.specialists;
  if (!s || s.status === 'UNKNOWN') return null;
  if (s.score >= 0.70) return null;

  const successPct = Math.round(s.score * 100);
  const severity = 'MEDIUM';
  const confidence = computeConfidence(severity, s.dataCompleteness, s.trend);
  return {
    rule_id: 'specialist-failing',
    type: 'SPECIALIST_CHECK',
    severity,
    title: `Nízká úspěšnost specialistů (${successPct}%)`,
    description: `Specialisté mají úspěšnost pod 70% za 7 dní.`,
    suggested_action: 'Zkontrolujte konfiguraci specialistů a tool matching.',
    action_payload: JSON.stringify({
      type: 'review',
      target: 'specialists',
      hint: 'review specialist configurations and tool matching',
    }),
    confidence,
    root_cause: `Specialisté mají ${successPct}% úspěšnost — problém s tool matching nebo provedením`,
    _keyDetails: { success_pct: successPct },
  };
}

// ── R8: Model Performance Drift ───────────────────────────────────────────────
function ruleModelDrift(dims, db) {
  if (!db) return null;
  const m = dims.models;
  if (!m || m.status === 'UNKNOWN') return null;

  try {
    // Compare last 20 vs previous 20 per role
    const roles = db.prepare(
      "SELECT DISTINCT role FROM model_performance WHERE created_at >= datetime('now','-60 days')"
    ).all();

    for (const { role } of roles) {
      const recent = db.prepare(
        "SELECT AVG(success) as sr FROM (SELECT success FROM model_performance WHERE role=? ORDER BY created_at DESC LIMIT 20)"
      ).get(role);
      const older = db.prepare(
        "SELECT AVG(success) as sr FROM (SELECT success FROM model_performance WHERE role=? ORDER BY created_at DESC LIMIT 20 OFFSET 20)"
      ).get(role);
      if (recent?.sr == null || older?.sr == null) continue;
      const decline = older.sr - recent.sr;
      if (decline <= 0.15) continue;

      const severity = 'HIGH';
      const confidence = computeConfidence(severity, m.dataCompleteness, m.trend);
      return {
        rule_id: 'model-drift',
        type: 'MODEL_SWITCH',
        severity,
        title: `Pokles výkonu modelu pro ${role} (${Math.round(older.sr * 100)}% → ${Math.round(recent.sr * 100)}%)`,
        description: `Úspěšnost poklesla o více než 15% v posledních 40 vzorcích.`,
        suggested_action: 'Zkontrolujte exact-contract evaluaci a zvažte ruční výměnu modelu pro tuto roli.',
        action_payload: JSON.stringify({
          type: 'review-evaluation',
          target: `role:${role}`,
          hint: `model performance declined for ${role}`,
          apiEndpoint: '/api/system/models/evaluations',
          params: { role },
        }),
        confidence,
        root_cause: `Pokles výkonu v posledních 20 vzorcích pro roli ${role} (bylo ${Math.round(older.sr * 100)}%, nyní ${Math.round(recent.sr * 100)}%)`,
        _keyDetails: { role, from: Math.round(older.sr * 100), to: Math.round(recent.sr * 100) },
      };
    }
  } catch { /* table may not exist */ }
  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

const RULES = [
  ruleModelLowSuccess,
  ruleArchDrift,
  ruleBuildQualityLow,
  ruleCRELow,
  ruleModelUnvalidated,
  ruleSpecialistFailing,
  ruleModelDrift,
];

export const improvementPlanner = {
  /**
   * Evaluate all 8 rules against the health analysis result.
   * @param {{ dimensions: Object }} analysis — from healthAnalyzer.analyze()
   * @param {import('better-sqlite3').Database} [db] — needed for R8 (model drift)
   * @returns {Array<Object>} proposals (unsorted — safety guard + governor will sort)
   */
  evaluate(analysis, db) {
    const proposals = [];
    for (const rule of RULES) {
      try {
        const result = rule === ruleModelDrift ? rule(analysis.dimensions, db) : rule(analysis.dimensions);
        if (result) proposals.push(result);
      } catch (e) {
        // Rule failure must not block other rules
      }
    }
    return proposals;
  },
};

// Exported for testing
export { computeConfidence, computePriority, SEVERITY_WEIGHT, PRIORITY_SEVERITY };
export { ruleModelLowSuccess, ruleArchDrift, ruleBuildQualityLow, ruleCRELow, ruleModelUnvalidated, ruleSpecialistFailing, ruleModelDrift };
