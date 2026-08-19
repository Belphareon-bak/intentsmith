// Model Ranker v118 — Pairwise upgrade evaluation with multi-dimensional scoring
// ══════════════════════════════════════════════════════════════════════════════
//
// Scores a model for a specific role, then compares candidate vs current.
// No absolute ranking — pairwise evaluation only.
//
// Score formula (0-1), váhy podle role viz ROLE_WEIGHTS:
//   benchmarkScore * w.benchmark + empirical * ew + maturity * w.maturity
//   + generation * w.generation + category * w.category + speed * w.speed
//   + validationBonus + sizePenalty + diversityPenalty + provisionalPenalty
//
// `hardwareFit` už není složkou kvality — vejde se do VRAM je tvrdá brána
// (`checkVramGate`) podle naměřeného umístění, ne bodovaná vlastnost.
//
// ══════════════════════════════════════════════════════════════════════════════

import { parseModelName, isNewerVersion, MODEL_PROFILES } from './model-profiles.js';

export const EVALUATION_VERSION = 'v120.2';

// ─── Benchmark Weights per Role ──────────────────────────────────────────────

export const BENCHMARK_WEIGHTS = {
  D1:     { swebench: 0.20, reasoning: 0.50, mmlu: 0.20, arena: 0.10 },
  D2:     { swebench: 0.30, reasoning: 0.20, mmlu: 0.30, arena: 0.20 },
  CODE:   { swebench: 0.15, livecodebench: 0.40, humaneval: 0.30, arena: 0.15 },
  R1:     { swebench: 0.20, reasoning: 0.50, mmlu: 0.20, arena: 0.10 },
  R2:     { swebench: 0.10, reasoning: 0.30, mmlu: 0.40, arena: 0.20 },
  CHAT:   { swebench: 0.15, reasoning: 0.15, mmlu: 0.35, arena: 0.35 },
  VISION: { reasoning: 0.20, mmlu: 0.40, arena: 0.40 },
};

// ─── Váhy složek podle role ──────────────────────────────────────────────────

/**
 * Váhy kvalitativních složek skóre pro každou roli.
 *
 * Dvě věci se sem 2026-08-19 promítly:
 *
 * 1. `hardwareFit` z kvalitativního skóre **zmizel**.  Míchal dvě různé otázky
 *    („vejde se" vs. „je dobrý") a dával systematickou výhodu malým modelům —
 *    spolu se `speed` to bylo 27 % váhy, které s kvalitou nesouvisí.  Vejde se
 *    do VRAM je dnes tvrdá brána (`checkVramGate`), ne bodovaná složka.
 *
 * 2. Váha rychlosti závisí na roli.  U CHAT je odezva součástí kvality, u D1
 *    a R1 běží deliberace na pozadí a rychlost skoro nerozhoduje.  Fixních
 *    7 % pro všechny role byl kompromis, který neseděl nikde.
 *
 * Každý řádek dává 0.90; zbytek do 1.0 je prostor pro validační bonus (0.05)
 * a empirickou složku, která podle počtu vzorků ukrajuje z benchmarkové váhy.
 */
export const ROLE_WEIGHTS = Object.freeze({
  D1:     Object.freeze({ benchmark: 0.47, maturity: 0.15, generation: 0.10, category: 0.15, speed: 0.03 }),
  R1:     Object.freeze({ benchmark: 0.47, maturity: 0.15, generation: 0.10, category: 0.15, speed: 0.03 }),
  D2:     Object.freeze({ benchmark: 0.44, maturity: 0.15, generation: 0.10, category: 0.15, speed: 0.06 }),
  CODE:   Object.freeze({ benchmark: 0.42, maturity: 0.15, generation: 0.10, category: 0.15, speed: 0.08 }),
  VISION: Object.freeze({ benchmark: 0.42, maturity: 0.15, generation: 0.10, category: 0.15, speed: 0.08 }),
  R2:     Object.freeze({ benchmark: 0.38, maturity: 0.15, generation: 0.10, category: 0.15, speed: 0.12 }),
  CHAT:   Object.freeze({ benchmark: 0.35, maturity: 0.15, generation: 0.10, category: 0.15, speed: 0.15 }),
});

const DEFAULT_WEIGHTS = ROLE_WEIGHTS.CODE;

export function weightsForRole(role) {
  return ROLE_WEIGHTS[role] || DEFAULT_WEIGHTS;
}

/**
 * Tvrdá brána podle **naměřeného** umístění modelu ve VRAM.
 *
 * Odhad z počtu parametrů podstřeluje o třetinu (změřeno: `qwen2.5:32b` odhad
 * 22 000 MB, skutečnost 29 983 MB), takže rozhodovat podle něj nelze.  Když
 * měření chybí, brána se neuplatní a rozhodne se až po stažení.
 *
 * Přetečení není penalizace, ale diskvalifikace: model s 8 GB na CPU spadl ze
 * 74 na 6 tok/s, což není zpomalení, ale ztráta použitelnosti.
 *
 * @param {{fits?: boolean, placement?: {fullyOnGpu?: boolean, cpuBytes?: number}}} measurement
 * @returns {{measured: boolean, fits: boolean, reason: string|null}}
 */
export function checkVramGate(measurement) {
  if (!measurement || (measurement.fits == null && !measurement.placement)) {
    return { measured: false, fits: true, reason: null };
  }
  const fits = measurement.fits ?? measurement.placement?.fullyOnGpu ?? false;
  if (fits) return { measured: true, fits: true, reason: null };
  const cpuGb = (measurement.placement?.cpuBytes || 0) / 2 ** 30;
  return {
    measured: true,
    fits: false,
    reason: cpuGb > 0
      ? `nevejde se do VRAM — ${cpuGb.toFixed(2)} GB by běželo na CPU`
      : 'nevejde se do VRAM',
  };
}

// ─── Improvement Thresholds per Role ─────────────────────────────────────────

export const IMPROVEMENT_THRESHOLD = {
  D1: 0.06, D2: 0.05, CODE: 0.05, R1: 0.06, R2: 0.05, CHAT: 0.04, VISION: 0.05,
};

// ─── Score Components ────────────────────────────────────────────────────────

/**
 * Compute weighted benchmark score for a role.
 * Null benchmarks: redistribute weight proportionally to non-null.
 */
export function computeBenchmarkScore(benchmarks, role) {
  if (!benchmarks) return 0;
  const weights = BENCHMARK_WEIGHTS[role];
  if (!weights) return 0;

  let totalWeight = 0;
  let weightedSum = 0;

  for (const [key, weight] of Object.entries(weights)) {
    if (benchmarks[key] != null) {
      totalWeight += weight;
      weightedSum += benchmarks[key] * weight;
    }
  }

  if (totalWeight === 0) return 0;
  return weightedSum / totalWeight; // Redistributed to non-null
}

/**
 * Category bonus — alignment between model specialization and role.
 * Code+CODE gets 0.10 (raised from 0.05 — P5 data shows coder models
 * significantly outperform generalists in pipeline execution).
 */
export function computeCategoryBonus(category, role) {
  if (category === 'code' && role === 'CODE') return 0.10;
  if (category === 'reasoning' && (role === 'D1' || role === 'R1')) return 0.05;
  if (category === 'vision' && role === 'VISION') return 0.10;
  return 0;
}

/**
 * Tvrdá způsobilost modelu pro roli podle `MODEL_PROFILES[role].requirements`.
 *
 * Skóre je spojité a `computeCategoryBonus` dává vision modelu v roli VISION
 * jen +0.10.  To nestačí: `BENCHMARK_WEIGHTS.VISION` obsahuje výhradně textové
 * benchmarky (mmlu, arena, reasoning), takže silný textový model roli VISION
 * vyhraje, přestože obrázek vůbec nezpracuje.  Nezpůsobilost proto není
 * penalizace, ale vyřazení.
 *
 * Vynucuje se jen to, co lze poctivě rozhodnout z dostupných dat:
 *   - rozsah parametrů (`minParams` / `maxParams`), je-li velikost známá;
 *   - schopnost `vision`, protože textový model roli fyzicky nezastane.
 *
 * Ostatní požadavky (`reasoning`, `instruction-following`, `json-output`)
 * zůstávají měkké — katalog je u naprosté většiny položek neuvádí, takže
 * tvrdý filtr by vyprázdnil seznam kandidátů. Ty patří validačním sadám.
 *
 * @param {Object} model - kandidát z discovery
 * @param {string} role
 * @param {Object} [profiles] - MODEL_PROFILES (injektovatelné kvůli testům)
 * @returns {{ eligible: boolean, reason: string|null }}
 */
export function checkRoleEligibility(model, role, profiles = MODEL_PROFILES) {
  const profile = profiles?.[role];
  const req = profile?.requirements;
  if (!req) return { eligible: true, reason: null };

  const params = model?.params;
  if (params) {
    if (req.minParams && params < req.minParams) {
      return { eligible: false, reason: `${params}B < minimum ${req.minParams}B` };
    }
    if (req.maxParams && params > req.maxParams) {
      return { eligible: false, reason: `${params}B > maximum ${req.maxParams}B` };
    }
  }

  const needsVision = Array.isArray(req.capabilities)
    && req.capabilities.some(c => c === 'vision' || c === 'image-understanding');
  if (needsVision) {
    const caps = Array.isArray(model?.capabilities) ? model.capabilities : [];
    const hasVision = model?.category === 'vision' || caps.includes('vision');
    if (!hasVision) return { eligible: false, reason: 'model neumí zpracovat obraz' };
  }

  return { eligible: true, reason: null };
}

/**
 * Hardware fit score based on effective VRAM vs GPU VRAM.
 * @param {number} effectiveVramMb - Model's effective VRAM requirement
 * @param {number} gpuVramMb - Available GPU VRAM (0 = CPU-only)
 * @returns {number} 0-1
 */
export function computeHardwareFit(effectiveVramMb, gpuVramMb) {
  if (!gpuVramMb || gpuVramMb === 0) return 0.3; // CPU-only
  if (!effectiveVramMb) return 0.5; // Unknown

  const ratio = effectiveVramMb / gpuVramMb;

  // Původní implementace vracela tři konstantní pásma, takže na hranici 0.80
  // skočilo skóre o 0.30 (po váze 0.20 tedy o 0.06 celkového skóre) mezi dvěma
  // modely lišícími se o promile VRAM.  Je to táž skoková vada, jakou audit
  // v123 (#14) opravil u blend vah v empirical-scorer.
  //
  // Kotevní body původních pásem zůstávají zachované, aby se nezměnila
  // kalibrace; mění se jen přechod mezi nimi na lineární rampu:
  //   0.80 → 1.0 (pohodlné)   0.95 → 0.7 (těsné)   1.00 → 0.4 (riziko swapu)
  if (ratio <= 0.80) return 1.0;
  if (ratio > 1.00) return 0.0;   // nevejde se — tvrdé vyřazení zůstává skokové

  const [from, to, fromScore, toScore] = ratio <= 0.95
    ? [0.80, 0.95, 1.0, 0.7]
    : [0.95, 1.00, 0.7, 0.4];
  const t = (ratio - from) / (to - from);
  return Math.round((fromScore + (toScore - fromScore) * t) * 1000) / 1000;
}

/**
 * Speed score — penalizes large models relative to current.
 * @param {number} candidateParams - Candidate param count (billions)
 * @param {number} referenceParams - Current model param count (billions)
 * @returns {number} 0.6-1.2 (clamped)
 */
export function computeSpeedScore(candidateParams, referenceParams, measurement = {}) {
  // Naměřená propustnost má přednost před odhadem z velikosti.  Odhad
  // předpokládá, že rychlost klesá s počtem parametrů, což u MoE architektur
  // neplatí: `qwen3-30b-a3b` má 30B parametrů, aktivuje ~3B a dává 142 tok/s
  // proti 74 tok/s u hustého 14B modelu.  Odhad by pořadí obrátil.
  const { measured, reference } = measurement;
  if (measured > 0 && reference > 0) {
    return Math.max(0.6, Math.min(1.2, measured / reference));
  }

  if (!candidateParams || !referenceParams || referenceParams === 0) return 0.8;
  const raw = 1 / Math.sqrt(candidateParams / referenceParams);
  return Math.max(0.6, Math.min(1.2, raw));
}

/**
 * Generation bonus from supersedes chain.
 * @param {Object} candidate - CatalogEntry or ModelCandidate
 * @param {Object} current - Current model info { name, family, version }
 * @returns {number} 0-1
 */
export function computeGenerationBonus(candidate, current) {
  if (!current || !candidate) return 0;

  const cParsed = typeof candidate.family === 'string' ? candidate : parseModelName(candidate.name);
  const curParsed = typeof current.family === 'string' ? current : parseModelName(current.name);

  // Direct successor via supersedes
  if (candidate.supersedes && candidate.supersedes === curParsed.name?.replace(/:.*/, '')) {
    return 1.0;
  }

  // Same family
  if (cParsed.family && cParsed.family === curParsed.family && cParsed.family !== 'unknown') {
    // Minor version bump (e.g. 3 → 3.5)
    if (cParsed.version && curParsed.version) {
      const cv = parseFloat(cParsed.version);
      const cuv = parseFloat(curParsed.version);
      if (!isNaN(cv) && !isNaN(cuv)) {
        if (cv > cuv && cv - cuv < 1) return 0.7; // Minor version
        if (cv > cuv) return 0.8; // Major version
      }
    }
    // Same family, newer (from isNewerVersion)
    if (isNewerVersion(curParsed.name || current.name, cParsed.name || candidate.name)) {
      return 0.5;
    }
    return 0.3; // Same family, unknown version relation
  }

  return 0.0; // Different family
}

/**
 * Maturity / community trust score.
 * @param {string} releaseDate - ISO date string
 * @returns {number} 0-1
 */
export function computeMaturity(releaseDate) {
  if (!releaseDate) return 0.5; // Unknown
  const ageDays = (Date.now() - Date.parse(releaseDate)) / (24 * 60 * 60 * 1000);
  if (ageDays > 90) return 1.0 + 0.02; // Stability bonus (capped at 1.0 in final)
  if (ageDays >= 30) return 0.7;
  if (ageDays >= 7) return 0.4;
  return 0.0; // Immature
}

// ─── Model Scoring ────────────────────────────────────────────────────────

/**
 * Score a single model for a specific role.
 *
 * @param {Object} model - CatalogEntry or ModelCandidate
 * @param {string} role - D1, D2, CODE, R1, R2, CHAT, VISION
 * @param {Object} context - { gpuVramMb, referenceParams, validationScore? }
 * @returns {{ totalScore: number, breakdown: Object }}
 */
export function scoreModel(model, role, context = {}, empirical = {}) {
  const benchmark = computeBenchmarkScore(model.benchmarks, role);
  const category = computeCategoryBonus(model.category, role);
  // Rychlost z měření, když je k dispozici; jinak odhad z počtu parametrů.
  // Měření je nesrovnatelně přesnější: `qwen3-30b-a3b` má 30B parametrů, ale
  // jako MoE aktivuje jen zlomek a dává 142 tok/s — dvakrát víc než 14B model.
  // Odhad podle velikosti by ho označil za pomalý.
  const speed = computeSpeedScore(
    model.params,
    context.referenceParams,
    { measured: model.measuredTokensPerSecond, reference: context.referenceTokensPerSecond },
  );
  const maturityRaw = computeMaturity(model.releaseDate);
  const maturity = Math.min(1.0, maturityRaw);
  const generation = computeGenerationBonus(model, context.currentModel);

  // Váhy podle role — rychlost váží jinak u CHAT než u D1 (viz ROLE_WEIGHTS).
  const weights = weightsForRole(role);

  // v120: Blended benchmark + empirical scoring.  Empirická složka ukrajuje
  // z benchmarkové váhy, takže s přibývajícími vzorky přebírá rozhodování
  // změřené chování místo publikovaných čísel.
  const ew = empirical.blendWeights?.empiricalWeight ?? 0.00;
  const bw = Math.max(0.10, weights.benchmark - ew);
  const rawEs = empirical.empiricalScore ?? 0;
  // Hard cap: empirical contribution <= MAX_EMPIRICAL_CONTRIBUTION (0.25)
  const es = ew > 0 ? Math.min(rawEs, 0.25 / ew) : rawEs;

  // v121.1: Benchmark confidence attenuation for L4 provisional models
  const benchConfidence = model.benchmarkConfidence ?? 1.0;

  // v121.1: Provisional penalty + ghost decay
  let provisionalPenalty = model.provisional ? -0.02 : 0;
  if (model.provisional && (context.empiricalSamples ?? 0) === 0 && model.discoveredAt) {
    const ageDays = (Date.now() - Date.parse(model.discoveredAt)) / 86400000;
    if (ageDays > 7) provisionalPenalty -= 0.01; // Ghost decay
  }

  // v120.2: Size floor for CODE role — small models (<20B) get penalized
  const sizePenalty = (role === 'CODE' && (model.params || 0) > 0 && (model.params || 0) < 20) ? -0.05 : 0;

  // v120.2: Role diversity penalty — discourage model monoculture
  // -0.01 per other role already using this model (max -0.04)
  let diversityPenalty = 0;
  if (context.roleBindings && model.name) {
    const otherRolesUsing = Object.entries(context.roleBindings)
      .filter(([r, m]) => r !== role && m === model.name).length;
    diversityPenalty = -Math.min(otherRolesUsing * 0.01, 0.04);
  }

  // v123: Validation suite score (0-1) — weighted bonus for locally validated models
  const validationScore = context.validationScore ?? null;
  const validationBonus = validationScore != null ? validationScore * 0.05 : 0;

  const totalScore = Math.max(0, Math.min(1.0,
    benchmark * bw * benchConfidence +
    es * ew +
    maturity * weights.maturity +
    generation * weights.generation +
    category * weights.category +
    speed * weights.speed +
    validationBonus +
    sizePenalty +
    diversityPenalty +
    provisionalPenalty
  ));

  return {
    totalScore,
    normalizedScore: Math.round(totalScore * 11), // Backward compat with Phase 1 (0-11)
    weights,
    breakdown: {
      benchmark,
      // `hardwareFit` zůstává v rozpadu jen pro diagnostiku a je vždy null:
      // do skóre nevstupuje, o vejde-se rozhoduje `checkVramGate` z měření.
      hardwareFit: null,
      maturity,
      generation,
      category,
      speed,
      validation: validationScore,
      diversityPenalty,
      benchConfidence,
      provisionalPenalty,
    },
  };
}

// ─── Risk Scoring ─────────────────────────────────────────────────────────

/**
 * Compute risk level for an upgrade.
 */
export function computeRiskLevel(current, candidate) {
  const ageDays = candidate.releaseDate
    ? (Date.now() - Date.parse(candidate.releaseDate)) / (24 * 60 * 60 * 1000)
    : 999;

  const paramJump = (candidate.params && current.params)
    ? candidate.params / current.params
    : 1;

  const ctxDrop = (candidate.contextWindow && current.contextWindow)
    ? 1 - (candidate.contextWindow / current.contextWindow)
    : 0;

  const archChange = candidate.architecture && current.architecture
    && candidate.architecture !== current.architecture;

  // HIGH conditions
  if ((candidate.sizeGB || 0) > 30) return 'high';
  if (ageDays < 14) return 'high';
  if (paramJump > 2) return 'high';
  if (ctxDrop > 0.30) return 'high';

  // MEDIUM conditions
  if (archChange) return 'medium';
  if (paramJump > 1.5) return 'medium';

  return 'low';
}

// ─── Pairwise Upgrade Evaluation ──────────────────────────────────────────

/**
 * Evaluate whether upgrading from current to candidate is worthwhile.
 *
 * @param {Object} current - Current model (CatalogEntry or { name, family, params, benchmarks, ... })
 * @param {Object} candidate - Candidate model
 * @param {string} role
 * @param {Object} context - { gpuVramMb }
 * @returns {{ shouldUpgrade: boolean, currentScore: number, candidateScore: number,
 *             delta: number, breakdown: Object, riskLevel: string, rejectReason?: string }}
 */
export function evaluateUpgrade(current, candidate, role, context = {}, empiricalCtx = {}) {
  const currentParams = current.params || parseModelName(current.name || '').params || 0;
  const candidateParams = candidate.params || parseModelName(candidate.name || '').params || 0;

  // Don't pass currentModel when scoring the current model — generation bonus
  // is meant to reward candidates that are newer versions, not self-referential.
  const currentScoreResult = scoreModel(current, role, {
    ...context,
    referenceParams: currentParams,
    currentModel: null,
  }, empiricalCtx.current || {});

  const candidateScoreResult = scoreModel(candidate, role, {
    ...context,
    referenceParams: currentParams,
    currentModel: current,
  }, empiricalCtx.candidate || {});

  const delta = candidateScoreResult.totalScore - currentScoreResult.totalScore;
  const threshold = IMPROVEMENT_THRESHOLD[role] || 0.05;
  const riskLevel = computeRiskLevel(current, candidate);

  // Context regression check
  if (candidate.contextWindow && current.contextWindow) {
    if (candidate.contextWindow < current.contextWindow * 0.5) {
      return {
        shouldUpgrade: false,
        currentScore: currentScoreResult.totalScore,
        candidateScore: candidateScoreResult.totalScore,
        delta,
        breakdown: {
          current: currentScoreResult.breakdown,
          candidate: candidateScoreResult.breakdown,
        },
        riskLevel,
        rejectReason: `context window regression: ${candidate.contextWindow} < ${current.contextWindow * 0.5}`,
      };
    }
  }

  // Dominance gate — no dimension worse by >20%
  // v120.2: Relax when empirical data strongly favors candidate
  const empiricalDelta = (empiricalCtx.candidate?.empiricalScore ?? 0)
                       - (empiricalCtx.current?.empiricalScore ?? 0);
  const strongEmpirical = empiricalDelta > 0.15
    && (empiricalCtx.candidate?.blendWeights?.empiricalWeight ?? 0) > 0;

  // Dominance gate: only check context window regression.
  // HardwareFit and speed are already weighted in the total score (0.20 + 0.07);
  // gating on them blocks valid upgrades where a larger model fits in GPU but
  // has slightly worse hw/speed ratio (e.g. 32B vs 14B on 24GB GPU).
  const dominanceChecks = [];

  // Context window as normalized dimension (1.0 = same or better, 0 = none)
  if (candidate.contextWindow && current.contextWindow) {
    const ctxRatio = candidate.contextWindow / current.contextWindow;
    dominanceChecks.push(['contextWindow', Math.min(1.0, ctxRatio), 1.0]);
  }

  for (const [dim, candVal, curVal] of dominanceChecks) {
    if (curVal > 0 && candVal < curVal * 0.8 && !strongEmpirical) {
      return {
        shouldUpgrade: false,
        currentScore: currentScoreResult.totalScore,
        candidateScore: candidateScoreResult.totalScore,
        delta,
        breakdown: {
          current: currentScoreResult.breakdown,
          candidate: candidateScoreResult.breakdown,
        },
        riskLevel,
        rejectReason: `dominance gate: ${dim} regression (${candVal.toFixed(2)} < ${(curVal * 0.8).toFixed(2)})`,
      };
    }
  }

  return {
    shouldUpgrade: delta >= threshold,
    currentScore: currentScoreResult.totalScore,
    candidateScore: candidateScoreResult.totalScore,
    delta,
    breakdown: {
      current: currentScoreResult.breakdown,
      candidate: candidateScoreResult.breakdown,
    },
    riskLevel,
  };
}

// ─── Phase 3/4 Interface Stubs ────────────────────────────────────────────

/**
 * Phase 3: Empirical Model Evaluation — IMPLEMENTED (v120)
 * See: empirical-scorer.js, metrics-collector.js
 *
 * scoreModel() accepts empirical = { blendWeights, empiricalScore }
 * evaluateUpgrade() accepts empiricalCtx = { current, candidate } (each with blendWeights + empiricalScore)
 *
 * Blend transition (B+E=0.35):
 *   <10 samples:  B=0.35, E=0.00 (Phase 2 behavior)
 *   10-50:        B=0.25, E=0.10
 *   >50:          B=0.15, E=0.20
 *   Hard cap: empirical contribution <= 0.25
 *
 * v120.2 calibration:
 *   CODE weights: livecodebench=0.40, humaneval=0.30, swebench=0.15, arena=0.15
 *   Category bonus: code+CODE=0.10 (was 0.05)
 *   Score weights: category=0.13, speed=0.07 (was 0.10/0.10)
 *   Size floor: CODE role, params<20B → -0.05 penalty
 *   Dominance gate relaxed when empirical delta > 0.15
 */

/**
 * Phase 4: Adaptive Multi-Model Routing (NOT IMPLEMENTED)
 * @typedef {Object} RoutingDecision
 * @property {string} role
 * @property {string} selectedModel
 * @property {string} taskType           - 'reasoning'|'code_gen'|'review'|'chat'
 * @property {number} confidence         - 0-1
 * @property {string} fallbackModel
 */

export default {
  scoreModel, evaluateUpgrade, computeRiskLevel,
  computeBenchmarkScore, computeCategoryBonus, computeHardwareFit,
  computeSpeedScore, computeGenerationBonus, computeMaturity,
  BENCHMARK_WEIGHTS, IMPROVEMENT_THRESHOLD, EVALUATION_VERSION,
};
