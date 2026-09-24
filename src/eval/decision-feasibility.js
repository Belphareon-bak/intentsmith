// Feasibility of a paired decision plan BEFORE collection: can the chosen
// method, margins and number of independent groups actually decide, and does
// it keep the false-acceptance rate on the observed kind of data?
//
// Simulation runs through the real decision interval (groupInterval). Group
// deltas are resampled from observed pilot pairs (empirical shape, including
// spikes at zero and rare large drops) or drawn from Normal(mean, sigma).
// Deterministic for a given seed. Planning evidence only, never a decision.
//
// Data model: a group delta is bounded to [-1,1]. The observed shape is moved
// to the requested mean; where that pushes mass past a bound, the mass stays
// at the bound and the shift is re-solved so the bounded population still has
// exactly the requested mean. Its variance and bound mass then differ from
// the observed shape, and planFeasibility reports by how much.
import { groupInterval } from './decision-methods.js';

// Evidence from an older generator must not pass for the current one: v1
// clipped after shifting, so its reported true means were not the simulated ones.
export const FEASIBILITY_MODEL_VERSION = 'bounded-location-shift-v2';
export const POPULATION_MEAN_TOLERANCE = 1e-12;

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clip = x => Math.max(-1, Math.min(1, x));
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
export const sampleSd = xs => xs.length < 2 ? null
  : Math.sqrt(xs.reduce((a, x) => a + (x - mean(xs)) ** 2, 0) / (xs.length - 1));

// f(shift) = mean(clip(x + shift)) is continuous and non-decreasing from -1
// to 1, so bisection finds the shift for any mean inside the bounds.
function solveShift(meanAt, target, lo, hi) {
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (meanAt(mid) < target) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
function requireMean(trueMean) {
  if (!(trueMean > -1 && trueMean < 1)) throw new Error('FEASIBILITY_TRUE_MEAN_OUT_OF_BOUNDS');
}

// Finite population for one observed pool at the requested mean. Throws
// instead of simulating a population whose mean is not the reported one.
export function boundedPopulation(pool, trueMean) {
  requireMean(trueMean);
  if (!Array.isArray(pool) || pool.length < 2 || pool.some(x => !Number.isFinite(x) || x < -1 || x > 1))
    throw new Error('FEASIBILITY_POOL_INVALID');
  const m = mean(pool), centered = pool.map(x => x - m);
  let shift = trueMean, values = centered.map(x => x + trueMean);
  if (values.some(x => x < -1 || x > 1)) {
    shift = solveShift(t => mean(centered.map(x => clip(x + t))), trueMean, -3, 3);
    values = centered.map(x => clip(x + shift));
  }
  const actualMean = mean(values);
  if (!(Math.abs(actualMean - trueMean) <= POPULATION_MEAN_TOLERANCE)) throw new Error('FEASIBILITY_POPULATION_MEAN_MISMATCH');
  const sourceSd = Math.sqrt(mean(centered.map(x => x * x)));
  const sd = Math.sqrt(mean(values.map(x => (x - actualMean) ** 2)));
  return { values, trueMean, actualMean, shift,
    boundMass: centered.filter(x => x + shift < -1 || x + shift > 1).length / pool.length,
    sdRatio: sourceSd > 0 ? sd / sourceSd : 1 };
}

// Standard normal CDF: erf(x) = P(1/2, x^2), regularized incomplete gamma by
// series / continued fraction (Numerical Recipes gser/gcf), about 1e-15.
const LOG_SQRT_PI = 0.5 * Math.log(Math.PI);
function gammaPHalf(x) {
  if (x <= 0) return 0;
  const front = Math.exp(-x + 0.5 * Math.log(x) - LOG_SQRT_PI);
  if (x < 1.5) {
    let ap = 0.5, del = 2, sum = 2;
    for (let n = 0; n < 500; n++) { ap += 1; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-17) break; }
    return sum * front;
  }
  const tiny = 1e-300;
  let b = x + 0.5, c = 1 / tiny, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - 0.5);
    b += 2; d = an * d + b; if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return 1 - front * h;
}
export function normalCdf(z) { const p = 0.5 * gammaPHalf(z * z / 2); return z >= 0 ? 0.5 + p : 0.5 - p; }
const normalPdf = z => Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);

// E[clip(N(shift, sigma^2), -1, 1)], exact up to the CDF accuracy.
export function censoredNormalMean(shift, sigma) {
  if (sigma === 0) return clip(shift);
  const a = (-1 - shift) / sigma, b = (1 - shift) / sigma, pa = normalCdf(a), pb = normalCdf(b);
  return -pa + (1 - pb) + shift * (pb - pa) + sigma * (normalPdf(a) - normalPdf(b));
}
export function boundedNormal(sigma, trueMean) {
  requireMean(trueMean);
  if (!(sigma >= 0)) throw new Error('FEASIBILITY_SIGMA_OR_POOLS_REQUIRED');
  const shift = sigma === 0 ? trueMean : solveShift(s => censoredNormalMean(s, sigma), trueMean, -1 - 40 * sigma, 1 + 40 * sigma);
  const actualMean = censoredNormalMean(shift, sigma);
  if (!(Math.abs(actualMean - trueMean) <= POPULATION_MEAN_TOLERANCE)) throw new Error('FEASIBILITY_POPULATION_MEAN_MISMATCH');
  return { sigma, trueMean, actualMean, shift,
    boundMass: sigma === 0 ? 0 : normalCdf((-1 - shift) / sigma) + 1 - normalCdf((1 - shift) / sigma) };
}

const populationCache = new WeakMap();
function poolPopulations(pools, trueMean) {
  if (!populationCache.has(pools)) populationCache.set(pools, new Map());
  const byMean = populationCache.get(pools);
  if (!byMean.has(trueMean)) {
    const usable = pools.filter(p => p.length >= 2);
    if (!usable.length) throw new Error('FEASIBILITY_POOLS_EMPTY');
    byMean.set(trueMean, usable.map(p => boundedPopulation(p, trueMean)));
  }
  return byMean.get(trueMean);
}

function sampler({ pools, sigma }, trueMean, random) {
  if (Array.isArray(pools) && pools.length) {
    const populations = poolPopulations(pools, trueMean).map(p => p.values);
    // One simulated comparison = one (random) observed model pair's shape.
    return n => { const pool = populations[Math.floor(random() * populations.length)];
      return Array.from({ length: n }, () => pool[Math.floor(random() * pool.length)]); };
  }
  const { shift } = boundedNormal(sigma, trueMean);
  return n => Array.from({ length: n }, () => {
    let u = 0, v = 0; while (!u) u = random(); while (!v) v = random();
    return clip(shift + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
  });
}

// What the simulated populations actually are at the named true means.
export function describePopulations({ pools, sigma }, means) {
  const describe = trueMean => {
    if (!(Array.isArray(pools) && pools.length)) {
      const n = boundedNormal(sigma, trueMean);
      return { trueMean, shift: n.shift, boundMass: n.boundMass };
    }
    const ps = poolPopulations(pools, trueMean);
    return { trueMean, maxActualMeanError: Math.max(...ps.map(p => Math.abs(p.actualMean - trueMean))),
      poolsWithBoundMass: ps.filter(p => p.boundMass > 0).length, maxBoundMass: Math.max(...ps.map(p => p.boundMass)),
      minSdRatio: Math.min(...ps.map(p => p.sdRatio)) };
  };
  return { modelVersion: FEASIBILITY_MODEL_VERSION, construction: 'location-shift-with-mass-kept-at-bounds',
    meanTolerance: POPULATION_MEAN_TOLERANCE,
    at: Object.fromEntries(Object.entries(means).filter(([, m]) => m != null).map(([k, m]) => [k, describe(m)])) };
}

// Paired pools from graded runs ({ model, digest, groups: Map(group -> score) }).
// Every pool is named candidate - incumbent; without an incumbent, each
// unordered pair appears once in both directions. Models and groups are
// ordered by digest and group key, so run recency and input row order cannot
// change a sign or the resampling sequence.
const byKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export function orientedPairPools(models, { incumbentDigest = null } = {}) {
  const sorted = [...models].sort((a, b) => byKey(a.digest, b.digest));
  if (new Set(sorted.map(m => m.digest)).size !== sorted.length || sorted.some(m => !m.digest))
    throw new Error('FEASIBILITY_MODEL_IDENTITY');
  const pools = [];
  for (const incumbent of sorted) {
    if (incumbentDigest && incumbent.digest !== incumbentDigest) continue;
    for (const candidate of sorted) {
      if (candidate === incumbent) continue;
      const groups = [...incumbent.groups.keys()].filter(g => candidate.groups.has(g)).sort(byKey);
      if (groups.length < 2) continue;
      pools.push({ candidate: candidate.model, candidateDigest: candidate.digest,
        incumbent: incumbent.model, incumbentDigest: incumbent.digest, groups,
        deltas: groups.map(g => candidate.groups.get(g) - incumbent.groups.get(g)) });
    }
  }
  return pools;
}

// Rate at which the plan's lower bound exceeds `threshold` when the true
// group-mean difference is `trueMean`.
export function acceptanceRate({ method, alpha, groups, trueMean, threshold, pools, sigma, sims = 2000, seed = 1 }) {
  const random = rng(seed), draw = sampler({ pools, sigma }, trueMean, random);
  let accepted = 0;
  for (let s = 0; s < sims; s++) {
    if (groupInterval(draw(groups), alpha, method).lower > threshold) accepted++;
  }
  return accepted / sims;
}

export function allowedFalseAccept(alpha, sims) {
  const p = alpha / 2; // one-sided tail of the two-sided interval
  return p + 3 * Math.sqrt(p * (1 - p) / sims);
}

export function requiredGroups({ maxGroups = 400, power = 0.8, ...args }) {
  const ok = n => acceptanceRate({ ...args, groups: n }) >= power;
  let hi = 10;
  while (hi <= maxGroups && !ok(hi)) hi *= 2;
  if (hi > maxGroups) { if (!ok(maxGroups)) return null; hi = maxGroups; }
  let lo = Math.max(2, Math.floor(hi / 2));
  while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (ok(mid)) hi = mid; else lo = mid + 1; }
  return hi;
}

// Smallest true improvement over the threshold detectable with `power`.
export function minimumDetectableEffect({ maxEffect = 0.6, power = 0.8, threshold, ...args }) {
  const ok = e => acceptanceRate({ ...args, threshold, trueMean: e }) >= power;
  if (!ok(maxEffect)) return null;
  let lo = threshold, hi = maxEffect;
  for (let i = 0; i < 9; i++) { const mid = (lo + hi) / 2; if (ok(mid)) hi = mid; else lo = mid; }
  return Math.round(hi * 1000) / 1000;
}

// Largest alpha from the grid whose simulated false acceptance at BOTH
// boundaries (quality and non-inferiority) stays within the nominal one-sided
// target on this role's observed data. Skewed, spiky deltas make the nominal t
// interval anti-conservative; calibrating alpha on pilot pools fixes that
// without inventing a different estimand. Null = no safe alpha in the grid.
export const ALPHA_GRID = Object.freeze([0.05, 0.04, 0.03, 0.02, 0.015, 0.01, 0.005]);
export function calibrateAlpha({ method, groups, minimumBenefit, nonInferiorityMargin, pools, sigma,
  target = 0.025, sims = 2000, seed = 20260924, grid = ALPHA_GRID }) {
  // Strict: Monte Carlo noise may only make the chosen alpha conservative.
  const tolerance = target;
  for (const alpha of grid) {
    const common = { method, alpha, groups, pools, sigma, sims, seed };
    const quality = acceptanceRate({ ...common, trueMean: minimumBenefit, threshold: minimumBenefit });
    const nonInferiority = nonInferiorityMargin > 0
      ? acceptanceRate({ ...common, trueMean: -nonInferiorityMargin, threshold: -nonInferiorityMargin }) : 0;
    if (quality <= tolerance && nonInferiority <= tolerance) return { alpha, target, tolerance, quality, nonInferiority };
  }
  return null;
}

// Verdict for one role plan: FEASIBLE / EXPLORATORY_ONLY / METHOD_UNSAFE.
export function planFeasibility({ method, alpha: requestedAlpha = 0.05, minimumBenefit, nonInferiorityMargin,
  availableGroups, plannedEffect, pools, sigma, power = 0.8, sims = 2000, seed = 20260924, maxGroups = 400,
  calibrate = false }) {
  const calibration = calibrate ? calibrateAlpha({ method, groups: availableGroups, minimumBenefit,
    nonInferiorityMargin, pools, sigma, target: requestedAlpha / 2, sims, seed }) : null;
  const alpha = calibration?.alpha ?? requestedAlpha;
  // Verify on fresh simulations: the calibration draws selected alpha and
  // would be optimistic. The target stays the requested nominal tail.
  const common = { method, alpha, pools, sigma, sims, seed: calibrate ? seed + 1 : seed };
  const allowed = allowedFalseAccept(requestedAlpha, sims);
  const quality = {
    falseAcceptAtBoundary: acceptanceRate({ ...common, groups: availableGroups, trueMean: minimumBenefit, threshold: minimumBenefit }),
    powerAtPlannedEffect: acceptanceRate({ ...common, groups: availableGroups, trueMean: plannedEffect, threshold: minimumBenefit }),
    minimumDetectableEffect: minimumDetectableEffect({ ...common, groups: availableGroups, threshold: minimumBenefit, power }),
    requiredGroupsForPlannedEffect: requiredGroups({ ...common, trueMean: plannedEffect, threshold: minimumBenefit, power, maxGroups }),
    // The practically harmful error: switching when the candidate is not better at all.
    switchWhenEqual: acceptanceRate({ ...common, groups: availableGroups, trueMean: 0, threshold: minimumBenefit }),
  };
  const nonInferiority = nonInferiorityMargin > 0 ? {
    falseAcceptAtBoundary: acceptanceRate({ ...common, groups: availableGroups, trueMean: -nonInferiorityMargin, threshold: -nonInferiorityMargin }),
    powerWhenEqual: acceptanceRate({ ...common, groups: availableGroups, trueMean: 0, threshold: -nonInferiorityMargin }),
    requiredGroupsWhenEqual: requiredGroups({ ...common, trueMean: 0, threshold: -nonInferiorityMargin, power, maxGroups }),
  } : null;
  const unsafe = (calibrate && !calibration) || quality.falseAcceptAtBoundary > allowed
    || (nonInferiority && nonInferiority.falseAcceptAtBoundary > allowed);
  const verdict = unsafe ? 'METHOD_UNSAFE'
    : quality.powerAtPlannedEffect >= power ? 'FEASIBLE' : 'EXPLORATORY_ONLY';
  return { method, alpha, requestedAlpha, calibration, minimumBenefit, nonInferiorityMargin, availableGroups, plannedEffect, power,
    sims, seed, allowedFalseAccept: allowed, quality, nonInferiority, verdict,
    dataModel: Array.isArray(pools) && pools.length ? `empirical resampling of ${pools.length} observed pairs` : `normal sigma=${sigma}`,
    population: describePopulations({ pools, sigma }, { qualityBoundary: minimumBenefit,
      nonInferiorityBoundary: nonInferiorityMargin > 0 ? -nonInferiorityMargin : null, equal: 0, plannedEffect }) };
}
