// Read-only design evidence for GPU-HUNT-ROADMAP M0, not a decision or a power result for a real panel.
// node docs/review/evidence/2026-09-24-decision-method-simulation.mjs
//
// Assumption (explicit, to be replaced by paired pilot grades in M0):
// per-group delta = candidate − incumbent, averaged within one independent origin group,
// drawn from Normal(mu, sigma) and clipped to [-1, 1]. Groups are independent.
// Compared methods on the same simulated data:
//   KL  = existing boundedGroupInterval (bounded mean, variance-free)
//   t   = paired two-sided 95 % t-interval over group deltas
import { boundedGroupInterval } from '../../../src/eval/code-pilot-decision.js';

const SIMS = 2000, ALPHA = 0.05;
const T975 = { 19: 2.093, 39: 2.023, 59: 2.001, 99: 1.984, 149: 1.976, 249: 1.970 };
const NS = [20, 40, 60, 100, 150, 250], SIGMAS = [0.10, 0.20, 0.30];

function rng(seed) { // mulberry32, deterministic
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function normal(r) { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function tLower(xs) {
  const n = xs.length, m = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
  return m - T975[n - 1] * sd / Math.sqrt(n);
}
function rate(n, mu, sigma, threshold, seed) {
  const r = rng(seed); let kl = 0, t = 0;
  for (let s = 0; s < SIMS; s++) {
    const xs = Array.from({ length: n }, () => Math.max(-1, Math.min(1, mu + sigma * normal(r))));
    if (boundedGroupInterval(xs, ALPHA).lower > threshold) kl++;
    if (tLower(xs) > threshold) t++;
  }
  return { kl: +(kl / SIMS).toFixed(3), t: +(t / SIMS).toFixed(3) };
}

const cells = [
  // purpose, true mean, threshold the lower bound must exceed
  ['superiority: false accept at boundary (want <= 0.025)', 0.04, 0.04],
  ['superiority: power, true +0.10', 0.10, 0.04],
  ['superiority: power, true +0.15', 0.15, 0.04],
  ['non-inferiority 0.02: power at true 0', 0.00, -0.02],
  ['non-inferiority 0.02: false accept at true -0.02', -0.02, -0.02],
  ['non-inferiority 0.05: power at true 0', 0.00, -0.05],
  ['non-inferiority 0.05: false accept at true -0.05', -0.05, -0.05],
];
const rows = [];
let seed = 20260924;
for (const [purpose, mu, threshold] of cells)
  for (const sigma of SIGMAS)
    for (const n of NS) rows.push({ purpose, mu, sigma, n, ...rate(n, mu, sigma, threshold, seed++) });

console.log(JSON.stringify({ status: 'DESIGN_SIMULATION_ONLY', decisionAuthority: false, inference: false,
  sims: SIMS, alpha: ALPHA, assumption: 'group deltas ~ Normal(mu, sigma) clipped to [-1,1], independent groups',
  sigmaSource: 'NOT MEASURED: M0 must estimate sigma from dual-graded paired pilot groups', rows }, null, 1));
