// Feasibility of a paired decision plan BEFORE collection: can the chosen
// method, margins and number of independent groups actually decide, and does
// it keep the false-acceptance rate on the observed kind of data?
//
// Simulation runs through the real decision interval (groupInterval). Group
// deltas are resampled from observed pilot pairs (empirical shape, including
// spikes at zero and rare large drops) or drawn from Normal(mean, sigma).
// Deterministic for a given seed. Planning evidence only, never a decision.
import { groupInterval } from './decision-methods.js';

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

function sampler({ pools, sigma }, random) {
  if (Array.isArray(pools) && pools.length) {
    const centered = pools.filter(p => p.length >= 2).map(p => { const m = mean(p); return p.map(x => x - m); });
    if (!centered.length) throw new Error('FEASIBILITY_POOLS_EMPTY');
    // One simulated comparison = one (random) observed model pair's shape.
    return n => { const pool = centered[Math.floor(random() * centered.length)];
      return Array.from({ length: n }, () => pool[Math.floor(random() * pool.length)]); };
  }
  if (!(sigma >= 0)) throw new Error('FEASIBILITY_SIGMA_OR_POOLS_REQUIRED');
  return n => Array.from({ length: n }, () => {
    let u = 0, v = 0; while (!u) u = random(); while (!v) v = random();
    return sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  });
}

// Rate at which the plan's lower bound exceeds `threshold` when the true
// group-mean difference is `trueMean`.
export function acceptanceRate({ method, alpha, groups, trueMean, threshold, pools, sigma, sims = 2000, seed = 1 }) {
  const random = rng(seed), draw = sampler({ pools, sigma }, random);
  let accepted = 0;
  for (let s = 0; s < sims; s++) {
    const values = draw(groups).map(x => clip(x + trueMean));
    if (groupInterval(values, alpha, method).lower > threshold) accepted++;
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

// Verdict for one role plan: FEASIBLE / EXPLORATORY_ONLY / METHOD_UNSAFE.
export function planFeasibility({ method, alpha = 0.05, minimumBenefit, nonInferiorityMargin,
  availableGroups, plannedEffect, pools, sigma, power = 0.8, sims = 2000, seed = 20260924, maxGroups = 400 }) {
  const common = { method, alpha, pools, sigma, sims, seed };
  const allowed = allowedFalseAccept(alpha, sims);
  const quality = {
    falseAcceptAtBoundary: acceptanceRate({ ...common, groups: availableGroups, trueMean: minimumBenefit, threshold: minimumBenefit }),
    powerAtPlannedEffect: acceptanceRate({ ...common, groups: availableGroups, trueMean: plannedEffect, threshold: minimumBenefit }),
    minimumDetectableEffect: minimumDetectableEffect({ ...common, groups: availableGroups, threshold: minimumBenefit, power }),
    requiredGroupsForPlannedEffect: requiredGroups({ ...common, trueMean: plannedEffect, threshold: minimumBenefit, power, maxGroups }),
  };
  const nonInferiority = nonInferiorityMargin > 0 ? {
    falseAcceptAtBoundary: acceptanceRate({ ...common, groups: availableGroups, trueMean: -nonInferiorityMargin, threshold: -nonInferiorityMargin }),
    powerWhenEqual: acceptanceRate({ ...common, groups: availableGroups, trueMean: 0, threshold: -nonInferiorityMargin }),
    requiredGroupsWhenEqual: requiredGroups({ ...common, trueMean: 0, threshold: -nonInferiorityMargin, power, maxGroups }),
  } : null;
  const unsafe = quality.falseAcceptAtBoundary > allowed
    || (nonInferiority && nonInferiority.falseAcceptAtBoundary > allowed);
  const verdict = unsafe ? 'METHOD_UNSAFE'
    : quality.powerAtPlannedEffect >= power ? 'FEASIBLE' : 'EXPLORATORY_ONLY';
  return { method, alpha, minimumBenefit, nonInferiorityMargin, availableGroups, plannedEffect, power,
    sims, seed, allowedFalseAccept: allowed, quality, nonInferiority, verdict,
    dataModel: Array.isArray(pools) && pools.length ? `empirical resampling of ${pools.length} observed pairs` : `normal sigma=${sigma}` };
}
