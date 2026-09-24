#!/usr/bin/env node
// Measure per-role variability of paired group deltas from REAL graded runs
// and check whether a decision method can decide with the available groups.
// Read-only: opens the evaluation DB readonly, never writes, never infers.
//
// node scripts/hunt-decision-feasibility.mjs [--db=PATH] [--out=FILE.json]
//   [--planned-effect=0.10] [--sims=2000] [--role=CHAT] [--also-groups=20,60]
//   [--extra-suite=CHAT:chat_conversation_pilot]  (merge another suite's groups by exact digest)
import Database from 'better-sqlite3';
import { writeFileSync } from 'node:fs';
import { ROLE_IMPROVEMENT_THRESHOLDS } from '../src/eval/role-evaluation-plan.js';
import { DECISION_METHODS, groupInterval } from '../src/eval/decision-methods.js';
import { existsSync, readFileSync } from 'node:fs';
import { planFeasibility, sampleSd } from '../src/eval/decision-feasibility.js';

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const dbPath = args.db || '/home/belphareon/Projects/intentsmith/data/c3.db';
const plannedEffect = Number(args['planned-effect'] ?? 0.10);
const sims = Number(args.sims ?? 2000);
const onlyRole = args.role || null;
// Extra suite sizes to evaluate with the same measured variability, e.g. the
// 20-group CHAT conversation suite or a planned larger confirmation set.
const alsoGroups = String(args['also-groups'] || '').split(',').filter(Boolean).map(Number);
// role -> suite name whose groups are merged into the role's main suite per exact digest
const extraSuites = Object.fromEntries(String(args['extra-suite'] || '').split(',').filter(Boolean)
  .map(x => x.split(':')));
// Live role bindings (running backend export) for a demonstration of what each
// method would say today. Benchmark data is exploratory, never confirmation.
const bindingsPath = args.bindings || '/mnt/vi7000/intentsmith/evidence/hunt-decision-methods-20260924/live-bindings.json';
const bindings = existsSync(bindingsPath) ? JSON.parse(readFileSync(bindingsPath, 'utf8')).bindingResponse?.bindings || {} : {};

function demoDecisions(role, models, minimumBenefit, margin, alpha = 0.05) {
  const incumbent = models.find(m => m.model === bindings[role]);
  if (!incumbent) return { incumbent: bindings[role] || null, status: 'INCUMBENT_NOT_MEASURED_ON_THIS_SUITE' };
  const verdict = iv => iv.lower > minimumBenefit ? 'ZMENIT' : iv.upper < -margin ? 'PONECHAT' : 'NEROZHODNUTO';
  const rows = models.filter(m => m !== incumbent).map(candidate => {
    const shared = [...incumbent.groups.keys()].filter(g => candidate.groups.has(g));
    const deltas = shared.map(g => candidate.groups.get(g) - incumbent.groups.get(g));
    const t = groupInterval(deltas, alpha, DECISION_METHODS.PAIRED_T), kl = groupInterval(deltas, 0.05, DECISION_METHODS.KL_BOUNDED);
    return { candidate: candidate.model, groups: deltas.length, meanDelta: r3(t.mean),
      pairedT: { lower: r3(t.lower), upper: r3(t.upper), verdict: verdict(t) },
      kl: { lower: r3(kl.lower), upper: r3(kl.upper), verdict: verdict(kl) } };
  }).sort((a, b) => b.meanDelta - a.meanDelta);
  return { incumbent: incumbent.model, minimumBenefit, margin, alpha, rows };
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const quantile = (xs, q) => { const s = [...xs].sort((a, b) => a - b); const i = (s.length - 1) * q;
  return s[Math.floor(i)] + (s[Math.ceil(i)] - s[Math.floor(i)]) * (i - Math.floor(i)); };
const r3 = x => x == null ? null : Math.round(x * 1000) / 1000;
const groupOf = task => task.independenceGroup || String(task.name).replace(/^(cs|en)_/, '');

function taskMean(task) {
  if (Number.isFinite(task.mean)) return task.mean;
  const s = (task.scores || []).filter(Number.isFinite);
  return s.length ? mean(s) : null;
}

// Latest graded run per model on the role's most widely measured suite contract.
function roleData(role) {
  const best = db.prepare(`SELECT suite_name, suite_contract_sha256, COUNT(DISTINCT model_digest_sha256) models
    FROM model_evaluation_runs WHERE role=? AND status='COMPLETE' AND task_results_json IS NOT NULL
    GROUP BY 1,2 ORDER BY models DESC, MAX(completed_at) DESC LIMIT 1`).get(role);
  if (!best) return null;
  const rows = db.prepare(`SELECT model_name, model_digest_sha256, task_results_json, completed_at
    FROM model_evaluation_runs WHERE role=? AND status='COMPLETE' AND suite_contract_sha256=?
    ORDER BY completed_at DESC`).all(role, best.suite_contract_sha256);
  const models = new Map();
  for (const row of rows) {
    if (models.has(row.model_digest_sha256)) continue;
    const tasks = JSON.parse(row.task_results_json);
    const byGroup = new Map();
    for (const task of Array.isArray(tasks) ? tasks : []) {
      const m = taskMean(task);
      if (m == null) continue;
      const g = groupOf(task);
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(m);
    }
    models.set(row.model_digest_sha256, { model: row.model_name,
      groups: new Map([...byGroup].map(([g, xs]) => [g, mean(xs)])) });
  }
  const extra = extraSuites[role];
  if (extra) {
    const extraRows = db.prepare(`SELECT model_name, model_digest_sha256, task_results_json FROM model_evaluation_runs
      WHERE role=? AND status='COMPLETE' AND suite_name=? ORDER BY completed_at DESC`).all(role, extra);
    const seen = new Set();
    for (const row of extraRows) {
      if (seen.has(row.model_digest_sha256)) continue;
      seen.add(row.model_digest_sha256);
      const byGroup = new Map();
      for (const task of JSON.parse(row.task_results_json)) {
        const m = taskMean(task); if (m == null) continue;
        const g = `${extra}:${groupOf(task)}`; // namespaced: never collides with main-suite groups
        if (!byGroup.has(g)) byGroup.set(g, []);
        byGroup.get(g).push(m);
      }
      const target = models.get(row.model_digest_sha256) || { model: row.model_name, groups: new Map() };
      for (const [g, xs] of byGroup) target.groups.set(g, mean(xs));
      models.set(row.model_digest_sha256, target);
    }
  }
  return { suite: extra ? `${best.suite_name}+${extra}` : best.suite_name, contract: best.suite_contract_sha256,
    models: [...models.values()] };
}

function pairedPools(models) {
  const pools = [];
  for (let i = 0; i < models.length; i++) for (let j = i + 1; j < models.length; j++) {
    const a = models[i], b = models[j];
    const shared = [...a.groups.keys()].filter(g => b.groups.has(g));
    if (shared.length < 2) continue;
    pools.push({ pair: [a.model, b.model], deltas: shared.map(g => a.groups.get(g) - b.groups.get(g)) });
  }
  return pools;
}

const report = { status: 'PLANNING_EVIDENCE_ONLY', decisionAuthority: false, inference: false,
  generatedAt: new Date().toISOString(), db: dbPath, plannedEffect, sims, roles: {} };
for (const role of Object.keys(ROLE_IMPROVEMENT_THRESHOLDS)) {
  if (onlyRole && role !== onlyRole) continue;
  const data = roleData(role);
  if (!data || data.models.length < 2) { report.roles[role] = { status: 'NO_PAIRED_DATA' }; continue; }
  const pools = pairedPools(data.models);
  const sds = pools.map(p => sampleSd(p.deltas)).filter(Number.isFinite);
  const groups = Math.max(...pools.map(p => p.deltas.length));
  const zeroShare = mean(pools.map(p => p.deltas.filter(d => Math.abs(d) < 1e-9).length / p.deltas.length));
  const deltaPools = pools.map(p => p.deltas);
  const minimumBenefit = ROLE_IMPROVEMENT_THRESHOLDS[role];
  const run = (method, nonInferiorityMargin, availableGroups = groups) => planFeasibility({ method, minimumBenefit,
    nonInferiorityMargin, availableGroups, plannedEffect, pools: deltaPools, sims });
  const entry = {
    suite: data.suite, contract: data.contract, models: data.models.length, pairs: pools.length, groups,
    sigma: { median: r3(quantile(sds, 0.5)), p25: r3(quantile(sds, 0.25)), p75: r3(quantile(sds, 0.75)),
      max: r3(Math.max(...sds)) },
    zeroDeltaShare: r3(zeroShare), minimumBenefit,
    kl: run(DECISION_METHODS.KL_BOUNDED, 0.02),
    pairedT: run(DECISION_METHODS.PAIRED_T, 0.02),
    pairedTMargin005: run(DECISION_METHODS.PAIRED_T, 0.05),
    pairedTCalibrated: planFeasibility({ method: DECISION_METHODS.PAIRED_T, minimumBenefit, nonInferiorityMargin: 0.05,
      availableGroups: groups, plannedEffect, pools: deltaPools, sims, calibrate: true }),
    pairedTAtGroups: Object.fromEntries(alsoGroups.map(n => [n, run(DECISION_METHODS.PAIRED_T, 0.05, n)])),
    demo: demoDecisions(role, data.models, minimumBenefit, 0.05),
  };
  // Variability that matters for a real decision: incumbent vs candidates, not
  // every pair (clearly unsuitable models inflate the all-pairs sigma).
  const incumbentPools = pools.filter(p => p.pair.includes(bindings[role])).map(p => p.deltas);
  if (incumbentPools.length) {
    const isds = incumbentPools.map(sampleSd).filter(Number.isFinite);
    entry.incumbentPairs = { incumbent: bindings[role], pairs: incumbentPools.length,
      sigma: { median: r3(quantile(isds, 0.5)), p25: r3(quantile(isds, 0.25)), p75: r3(quantile(isds, 0.75)) },
      pairedT: planFeasibility({ method: DECISION_METHODS.PAIRED_T, minimumBenefit, nonInferiorityMargin: 0.05,
        availableGroups: groups, plannedEffect, pools: incumbentPools, sims, calibrate: true }),
      pairedTAtGroups: Object.fromEntries(alsoGroups.map(n => [n, planFeasibility({ method: DECISION_METHODS.PAIRED_T,
        minimumBenefit, nonInferiorityMargin: 0.05, availableGroups: n, plannedEffect, pools: incumbentPools, sims, calibrate: true })])) };
    if (entry.incumbentPairs.pairedT.calibration)
      entry.demo = demoDecisions(role, data.models, minimumBenefit, 0.05, entry.incumbentPairs.pairedT.alpha);
  }
  report.roles[role] = entry;
  const q = entry.pairedT.quality, ni2 = entry.pairedT.nonInferiority, ni5 = entry.pairedTMargin005.nonInferiority;
  console.error(`${role.padEnd(6)} ${data.suite} models=${data.models.length} groups=${groups} `
    + `sigma med=${entry.sigma.median} [${entry.sigma.p25}-${entry.sigma.p75}] zero=${entry.zeroDeltaShare} | `
    + `KL ${entry.kl.verdict} power=${entry.kl.quality.powerAtPlannedEffect} | `
    + `t ${entry.pairedT.verdict} FA=${q.falseAcceptAtBoundary} power=${q.powerAtPlannedEffect} `
    + `MDE=${q.minimumDetectableEffect} needN=${q.requiredGroupsForPlannedEffect} | `
    + `NI.02 needN=${ni2.requiredGroupsWhenEqual} NI.05 needN=${ni5.requiredGroupsWhenEqual} FA=${ni5.falseAcceptAtBoundary}`
    + alsoGroups.map(n => { const x = entry.pairedTAtGroups[n];
      return ` | @${n}: ${x.verdict} power=${x.quality.powerAtPlannedEffect} MDE=${x.quality.minimumDetectableEffect}`; }).join(''));
  if (entry.incumbentPairs) { const ip = entry.incumbentPairs, x = ip.pairedT;
    console.error(`       vs incumbent ${ip.incumbent}: sigma med=${ip.sigma.median} | calibrated t alpha=${x.calibration ? x.alpha : 'none-safe'} ${x.verdict} `
      + `FA=${x.quality.falseAcceptAtBoundary} switchWhenEqual=${x.quality.switchWhenEqual} `
      + `power=${x.quality.powerAtPlannedEffect} MDE=${x.quality.minimumDetectableEffect} needN=${x.quality.requiredGroupsForPlannedEffect} `
      + `NI.05 power=${x.nonInferiority.powerWhenEqual} needN=${x.nonInferiority.requiredGroupsWhenEqual}`
      + alsoGroups.map(n => { const y = ip.pairedTAtGroups[n];
        return ` | @${n}: alpha=${y.calibration ? y.alpha : 'none-safe'} ${y.verdict} power=${y.quality.powerAtPlannedEffect} MDE=${y.quality.minimumDetectableEffect}`; }).join('')); }
}
const json = JSON.stringify(report, null, 1) + '\n';
if (args.out) writeFileSync(args.out, json); else process.stdout.write(json);
