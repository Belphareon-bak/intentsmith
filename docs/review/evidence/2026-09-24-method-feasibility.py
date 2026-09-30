#!/usr/bin/env python3
"""Offline method study; no model calls, DB, decisions or binding changes.

Python 3.12, numpy==2.3.3, scipy==1.16.2. Run from any directory:
  python this-file.py --output /path/to/new-result.json
One row is ONE independent origin-group delta, not a model call/repetition.
This simulation is not acceptance evidence for any real CHAT distribution.
"""
import os

for variable in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ[variable] = "1"

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

import numpy as np
import scipy
from scipy.special import xlogy
from scipy.stats import bootstrap, t

ALPHA, TRIALS, RESAMPLES, SEED = .05, 1000, 999, 20260924
NS = (20, 60, 150)
ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "src/eval/code-pilot-decision.js"


def kl_interval(means, n):
    """Vectorized transcription, checked against the actual JS export below."""
    p = (np.asarray(means) + 1) / 2
    limit = np.log(2 / ALPHA) / n
    ends = []
    for lower in (True, False):
        lo = np.zeros_like(p) if lower else p.copy()
        hi = p.copy() if lower else np.ones_like(p)
        with np.errstate(divide="ignore", invalid="ignore"):
            for _ in range(80):
                mid = (lo + hi) / 2
                kl = xlogy(p, p / mid) + xlogy(1 - p, (1 - p) / (1 - mid))
                move_lo = (kl > limit) == lower
                lo, hi = np.where(move_lo, mid, lo), np.where(move_lo, hi, mid)
        end = 2 * ((lo + hi) / 2) - 1
        end = np.where(p == (0 if lower else 1), -1 if lower else 1, end)
        ends.append(end)
    return np.array(ends)


def rng_for(*parts):
    digest = hashlib.sha256((str(SEED) + "/" + "/".join(map(str, parts))).encode()).digest()
    return np.random.Generator(np.random.PCG64(int.from_bytes(digest[:16], "big")))


def rate(mask):
    count, n = int(np.count_nonzero(mask)), len(mask)
    p, z = count / n, 1.959963984540054
    den = 1 + z * z / n
    center = (p + z * z / (2 * n)) / den
    half = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return {"count": count, "of": n, "rate": p,
            "monteCarloWilson95": [float(center - half), float(center + half)]}


def measure(bounds, xs, truth, threshold):
    low, high = bounds
    degenerate = np.ptp(xs, axis=1) == 0
    accepted = low > threshold
    return {"coverage": rate((low <= truth) & (truth <= high)),
            "acceptNaive": rate(accepted),
            "acceptBlockingConstantSamples": rate(accepted & ~degenerate),
            "constantSampleCount": int(degenerate.sum())}


CASES = [
    ("quality_boundary", "uniform", .04, .04),
    ("quality_alternative", "uniform", .10, .04),
    ("noninferiority_boundary", "uniform", -.02, -.02),
    ("noninferiority_alternative", "uniform", 0., -.02),
    ("rare_harm_exact", "rare_exact", -.02, -.02),
    ("rare_harm_jitter", "rare_jitter", -.02, -.02),
    ("binary_workflow_alternative", "binary", .10, .04),
]


def sample(kind, mean, n, rng):
    shape = (TRIALS, n)
    if kind == "uniform":
        return rng.uniform(mean - np.sqrt(3) * .15, mean + np.sqrt(3) * .15, shape)
    if kind == "binary":
        return rng.choice([-1., 0., 1.], shape, p=[.1, .7, .2])
    harm = rng.random(shape) < .02
    benign = np.zeros(shape) if kind == "rare_exact" else rng.uniform(-.001, .001, shape)
    return np.where(harm, -1., benign)


def actual_js_checks():
    js = """
import {boundedGroupInterval as ci} from './src/eval/code-pilot-decision.js';
const checks=[];
for (const n of [1,20,60,150]) for (const mean of [-1,-.75,-.02,0,.04,.17,.9,1])
  checks.push({n,mean,...ci(Array(n).fill(mean),.05)});
let lo=1,hi=100000;
while(lo<hi){const mid=Math.floor((lo+hi)/2);
  if(ci(Array(mid).fill(0),.05).lower>-.02)hi=mid;else lo=mid+1;}
console.log(JSON.stringify({checks,firstN:lo,
  preceding:ci(Array(lo-1).fill(0),.05),atFirst:ci(Array(lo).fill(0),.05)}));
"""
    data = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", js], cwd=ROOT))
    max_error = 0.
    for item in data["checks"]:
        bounds = kl_interval([item["mean"]], item["n"])[:, 0]
        max_error = max(max_error, float(np.max(np.abs(bounds - [item["lower"], item["upper"]]))))
    assert max_error < 1e-12, max_error
    assert data["firstN"] == 18441
    data["pythonJsMaxAbsoluteError"] = max_error
    return data


def scipy_checks():
    xs = np.array([-.4, -.2, -.03, 0, .06, .17, .32, .5])
    indices = np.random.default_rng(812).integers(len(xs), size=(RESAMPLES, len(xs)))
    expected = np.quantile(xs[indices].mean(axis=1), [.025, .975], method="linear")
    actual = bootstrap((xs,), np.mean, n_resamples=RESAMPLES, confidence_level=.95,
                       method="percentile", rng=np.random.default_rng(812)).confidence_interval
    assert np.allclose(expected, actual, atol=1e-14, rtol=0)
    half = t.ppf(.975, len(xs) - 1) * xs.std(ddof=1) / np.sqrt(len(xs))
    t_expected = [xs.mean() - half, xs.mean() + half]
    t_actual = t.interval(.95, len(xs) - 1, loc=xs.mean(), scale=xs.std(ddof=1)/np.sqrt(len(xs)))
    assert np.allclose(t_expected, t_actual, atol=1e-14, rtol=0)
    return {"percentileBootstrapParity": True, "studentIntervalParity": True}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Refusing to replace existing evidence")
    checks = actual_js_checks()
    independent_checks = scipy_checks()
    rows = []
    for name, kind, truth, threshold in CASES:
        for n in NS:
            xs = sample(kind, truth, n, rng_for(name, n, "data"))
            assert np.all((-1 <= xs) & (xs <= 1))
            means = xs.mean(axis=1)
            half = t.ppf(1 - ALPHA / 2, n - 1) * xs.std(axis=1, ddof=1) / np.sqrt(n)
            half[np.ptp(xs, axis=1) == 0] = 0
            student = np.array([means - half, means + half])
            boot = np.empty((2, TRIALS))
            rng = rng_for(name, n, "bootstrap")
            # At most 4 x 999 x 150 indices/values at once, not the whole panel.
            for start in range(0, TRIALS, 4):
                subset = xs[start:start + 4]
                indices = rng.integers(n, size=(len(subset), RESAMPLES, n))
                resampled_means = np.take_along_axis(subset[:, None, :], indices, axis=2).mean(axis=2)
                boot[:, start:start + len(subset)] = np.quantile(
                    resampled_means, [ALPHA / 2, 1 - ALPHA / 2], axis=1, method="linear")
            rows.append({"case": name, "n": n, "trueMean": truth, "threshold": threshold,
                         "boundaryNull": truth == threshold,
                         "kl": measure(kl_interval(means, n), xs, truth, threshold),
                         "pairedT": measure(student, xs, truth, threshold),
                         "groupPercentileBootstrap": measure(boot, xs, truth, threshold)})
            print(f"{len(rows)}/{len(CASES)*len(NS)} {name} n={n}", file=sys.stderr, flush=True)
    exact_t_lower = float(.10 - t.ppf(.975, 19) * .15 / np.sqrt(20))
    assert abs(exact_t_lower - .029797839) < 1e-8
    output = {
        "status": "DESIGN_STRESS_STUDY_NOT_METHOD_ACCEPTANCE", "decisionAuthority": False,
        "inference": False, "productionChanged": False,
        "sourceHead": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "sourceSha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        "scriptSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "versions": {"python": sys.version.split()[0], "numpy": np.__version__, "scipy": scipy.__version__},
        "seed": SEED, "trialsPerCell": TRIALS, "bootstrapResamples": RESAMPLES,
        "confidence": .95, "tails": "two-sided; acceptance lower tail alpha/2=.025",
        "samplingUnit": "one independently drawn origin-group delta; equal group weights",
        "bootstrapMethod": "percentile over origin-group deltas; linear quantiles; NOT BCa",
        "distributions": {
            "uniform": "Uniform(mu-sqrt(3)*.15,mu+sqrt(3)*.15), population sd=.15; no clipping",
            "rare_exact": "P(delta=-1)=.02, P(delta=0)=.98; true mean=-.02",
            "rare_jitter": "P(delta=-1)=.02, otherwise Uniform(-.001,.001); true mean=-.02",
            "binary": "P(-1)=.1,P(0)=.7,P(+1)=.2; mean=.10, sd=sqrt(.29)"},
        "limitations": [
            "Synthetic distributions, not measured CHAT pilot variance or accepted group independence",
            "Monte Carlo study per endpoint, not joint multi-axis/candidate/sequential error control",
            "Constant-sample blocking is only a stress variant, not a sufficient eligibility rule",
            "Student t is exact under normal iid group differences; bounded/skewed cases need qualification",
            "Percentile bootstrap is one specified bootstrap, not a verdict on all bootstrap methods",
            "No repeated peeking; no method/threshold selection authorization; no new profile acceptance"],
        "actualJavaScriptParity": checks,
        "scipyReferenceChecks": independent_checks,
        "illustrations": {"tN20Mean010Sd015Lower": exact_t_lower,
                         "rareHarmNoObservedHarmN20": .98 ** 20,
                         "constantZeroN20NaiveTAndPercentileBootstrap": [0, 0],
                         "constantZeroVarianceIsPopulationProof": False},
        "rows": rows}
    with args.output.open("x") as stream:
        json.dump(output, stream, indent=2, allow_nan=False)
        stream.write("\n")


if __name__ == "__main__":
    main()
