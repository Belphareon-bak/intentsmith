// Group-level interval methods for paired candidate/incumbent decisions.
// A plan names its method explicitly and the method is part of the sealed plan
// hash, so an existing KL plan is never reinterpreted by adding a new method.

export const DECISION_METHODS = Object.freeze({
  KL_BOUNDED: 'hoeffding-kl-bounded-groups',
  PAIRED_T: 'paired-t-groups',
});

// The t interval is only a decision interval with enough independent groups;
// below this it returns the non-decisive full range instead of a narrow guess.
export const PAIRED_T_MINIMUM_GROUPS = 10;

function logGamma(x) { // Lanczos, g=7
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function betaContinuedFraction(a, b, x) { // Numerical Recipes betacf
  const tiny = 1e-300;
  let c = 1, d = 1 - (a + b) * x / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-15) break;
  }
  return h;
}

function regularizedIncompleteBeta(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2)
    ? front * betaContinuedFraction(a, b, x) / a
    : 1 - front * betaContinuedFraction(b, a, 1 - x) / b;
}

export function studentTCdf(t, df) {
  if (!(df > 0) || !Number.isFinite(t)) throw new Error('INVALID_T_ARGUMENTS');
  const tail = 0.5 * regularizedIncompleteBeta(df / 2, 0.5, df / (df + t * t));
  return t >= 0 ? 1 - tail : tail;
}

export function studentTQuantile(p, df) {
  if (!(p > 0 && p < 1) || !(df > 0)) throw new Error('INVALID_T_ARGUMENTS');
  if (p === 0.5) return 0;
  if (p < 0.5) return -studentTQuantile(1 - p, df);
  let lo = 0, hi = 1;
  while (studentTCdf(hi, df) < p) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (studentTCdf(mid, df) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Two-sided (1-alpha) Student t interval over independent group deltas in [-1,1].
// Uses the observed variance, unlike the variance-free KL bound.
export function pairedTGroupInterval(values, alpha) {
  if (!Array.isArray(values) || !values.length || !(alpha > 0 && alpha < 1)
    || values.some(x => !Number.isFinite(x) || x < -1 || x > 1)) throw new Error('INVALID_GROUP_VALUES');
  const n = values.length, mean = values.reduce((a, b) => a + b, 0) / n;
  const base = { mean, groups: n, confidence: 1 - alpha, independenceAssumed: true, method: DECISION_METHODS.PAIRED_T };
  if (n < PAIRED_T_MINIMUM_GROUPS) return { ...base, lower: -1, upper: 1, sd: null, reason: 'TOO_FEW_GROUPS' };
  const sd = Math.sqrt(values.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1));
  const half = studentTQuantile(1 - alpha / 2, n - 1) * sd / Math.sqrt(n);
  return { ...base, sd, lower: Math.max(-1, mean - half), upper: Math.min(1, mean + half) };
}

export function boundedGroupInterval(values, alpha) {
  if (!values.length || !(alpha > 0 && alpha < 1)
    || values.some(x => !Number.isFinite(x) || x < -1 || x > 1)) throw new Error('INVALID_GROUP_VALUES');
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const p = (mean + 1) / 2;
  const limit = Math.log(2 / alpha) / values.length;
  const kl = q => (p ? p * Math.log(p / q) : 0) + (p < 1 ? (1 - p) * Math.log((1 - p) / (1 - q)) : 0);
  const root = lower => {
    if (lower && p === 0) return 0;
    if (!lower && p === 1) return 1;
    let lo = lower ? 0 : p, hi = lower ? p : 1;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if ((kl(mid) > limit) === lower) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  };
  return { mean, lower: 2 * root(true) - 1, upper: 2 * root(false) - 1,
    groups: values.length, confidence: 1 - alpha, independenceAssumed: true };
}


export function groupInterval(values, alpha, method) {
  if (method === DECISION_METHODS.KL_BOUNDED) return { ...boundedGroupInterval(values, alpha), method };
  if (method === DECISION_METHODS.PAIRED_T) return pairedTGroupInterval(values, alpha);
  throw new Error('UNKNOWN_DECISION_METHOD');
}
