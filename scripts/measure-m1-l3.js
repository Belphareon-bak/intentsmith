#!/usr/bin/env node
//
// M1 L3 measurement — the numbers the roadmap requires to be measured, not
// estimated: deterministic p50/p95, model chat p50/p95, throughput, cold vs
// warm, and the refinement delta.
//
// Runs serially against a live product server. GPU work is never concurrent.
//
// Usage: C3_URL=http://127.0.0.1:PORT node measure-m1-l3.js [--samples N]

import { writeFileSync } from 'node:fs';

const BASE = process.env.C3_URL;
if (!BASE) {
  console.error('C3_URL is required');
  process.exit(2);
}
const samplesArg = process.argv.indexOf('--samples');
const SAMPLES = samplesArg > 0 ? Number(process.argv[samplesArg + 1]) : 12;

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  // Nearest-rank: the smallest value at or above the p-th percentile.
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

function summarize(values) {
  if (values.length === 0) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    n: values.length,
    minMs: Math.min(...values),
    p50Ms: percentile(values, 50),
    p95Ms: percentile(values, 95),
    maxMs: Math.max(...values),
    meanMs: Math.round(sum / values.length),
  };
}

async function chatOnce(message, extra = {}) {
  const started = process.hrtime.bigint();
  const response = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, ...extra }),
    signal: AbortSignal.timeout(300_000),
  });
  const body = await response.json().catch(() => null);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  return { status: response.status, body, elapsedMs };
}

const DETERMINISTIC_PROMPTS = [
  'kolik je 2+2',
  'kolik je 17*3',
  'kolik je 100/4',
];

const MODEL_PROMPTS = [
  'Vysvětli jednou větou, co dělá HTTP status 409.',
  'Jedním odstavcem: proč je append-only log lepší než mutovatelný stav pro audit?',
  'Ve dvou větách vysvětli rozdíl mezi shared a exclusive lockem.',
];

async function main() {
  const report = {
    measuredAtIso: new Date().toISOString(),
    baseUrl: BASE,
    samples: SAMPLES,
    deterministic: null,
    modelChat: null,
    notes: [],
  };

  // ── Deterministic ────────────────────────────────────────────────────────
  const deterministicMs = [];
  let deterministicClassified = 0;
  for (let index = 0; index < SAMPLES; index += 1) {
    const prompt = DETERMINISTIC_PROMPTS[index % DETERMINISTIC_PROMPTS.length];
    const result = await chatOnce(prompt);
    if (result.status !== 200) {
      report.notes.push(`deterministic request ${index} returned ${result.status}`);
      continue;
    }
    if (result.body?.classifiedBy === 'deterministic'
      || result.body?.localComputation === true) {
      deterministicClassified += 1;
    }
    deterministicMs.push(result.elapsedMs);
  }
  report.deterministic = {
    ...summarize(deterministicMs),
    classifiedDeterministic: deterministicClassified,
    targetP95Ms: 100,
  };
  report.deterministic.meetsTarget = report.deterministic.p95Ms !== null
    && report.deterministic.p95Ms < 100;

  // ── Model chat: first call is cold, the rest are warm ────────────────────
  const warmMs = [];
  let coldMs = null;
  let providerErrors = 0;
  const refinement = { observed: 0, improved: 0, deltas: [] };

  for (let index = 0; index < SAMPLES; index += 1) {
    const prompt = `${MODEL_PROMPTS[index % MODEL_PROMPTS.length]} (${index})`;
    const result = await chatOnce(prompt);
    if (result.status !== 200) {
      providerErrors += 1;
      report.notes.push(`model request ${index} returned ${result.status}`);
      continue;
    }
    if (index === 0) coldMs = result.elapsedMs;
    else warmMs.push(result.elapsedMs);

    const quality = result.body?.quality || result.body?.metadata?.quality;
    if (quality && typeof quality.scoreBefore?.total === 'number') {
      refinement.observed += 1;
      if (typeof quality.scoreAfter?.total === 'number') {
        refinement.improved += 1;
        refinement.deltas.push(quality.scoreAfter.total - quality.scoreBefore.total);
      }
    }
  }

  const warmSummary = summarize(warmMs);
  report.modelChat = {
    coldMs: coldMs === null ? null : Math.round(coldMs),
    warm: warmSummary,
    providerErrors,
    throughputTurnsPerMinute: warmSummary
      ? Number((60_000 / warmSummary.meanMs).toFixed(2))
      : null,
    refinement: {
      observedTurns: refinement.observed,
      refinedTurns: refinement.improved,
      meanDelta: refinement.deltas.length
        ? Number((refinement.deltas.reduce((a, b) => a + b, 0) / refinement.deltas.length).toFixed(4))
        : null,
      deltas: refinement.deltas,
    },
  };

  const out = process.env.M1_L3_REPORT || '/tmp/m1-l3-report.json';
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nreport: ${out}`);
}

main().catch((error) => {
  console.error('measurement failed:', error.message);
  process.exit(1);
});
