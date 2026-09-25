#!/usr/bin/env node
// Measure per-role variability of paired group deltas from REAL graded runs
// and check whether a decision method can decide with the available groups.
// Read-only: opens the evaluation DB readonly, never writes, never infers.
//
// node scripts/hunt-decision-feasibility.mjs [--db=PATH] [--out=FILE.json]
//   [--planned-effect=0.10] [--sims=2000] [--role=CHAT] [--also-groups=20,60]
//   [--ni-margin=0.02]                       non-inferiority tolerance (contract value until R2 is accepted)
//   [--suite=CHAT:chat_v3@<sha256>]          pin the role's main suite contract instead of the widest one
//   [--extra-suite=CHAT:chat_conversation_pilot@<sha256>]  add another exact suite contract per digest
import Database from 'better-sqlite3';
import { writeFileSync } from 'node:fs';
import { ROLE_IMPROVEMENT_THRESHOLDS } from '../src/eval/role-evaluation-plan.js';
import { DECISION_METHODS, groupInterval } from '../src/eval/decision-methods.js';
import { existsSync, readFileSync } from 'node:fs';
import { planFeasibility, sampleSd, orientedPairPools, FEASIBILITY_MODEL_VERSION } from '../src/eval/decision-feasibility.js';

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const dbPath = args.db || '/home/belphareon/Projects/intentsmith/data/c3.db';
const plannedEffect = Number(args['planned-effect'] ?? 0.10);
const sims = Number(args.sims ?? 2000);
const onlyRole = args.role || null;
// Extra suite sizes to evaluate with the same measured variability, e.g. the
// 20-group CHAT conversation suite or a planned larger confirmation set.
const alsoGroups = String(args['also-groups'] || '').split(',').filter(Boolean).map(Number);
// One tolerance for calibration, verdicts and the report. The contract value
// stays 0.02 until the proposed 0.05 (roadmap R2) is accepted.
const niMargin = Number(args['ni-margin'] ?? 0.02);
if (!(niMargin > 0 && niMargin < 1)) throw new Error('INVALID_NI_MARGIN');
// ROLE:suite@contract. A suite name alone could silently pick up a new
// version under the same name, so the exact contract is required.
const suiteSpecs = (value, flag) => Object.fromEntries(String(value || '').split(',').filter(Boolean).map(spec => {
  const [role, rest = ''] = spec.split(':'), [suite, contract] = rest.split('@');
  if (!role || !suite || !/^[a-f0-9]{64}$/.test(contract || '')) throw new Error(`${flag}_CONTRACT_REQUIRED:${spec}`);
  return [role, { suite, contract }];
}));
const pinnedSuites = suiteSpecs(args.suite, 'SUITE');
const extraSuites = suiteSpecs(args['extra-suite'], 'EXTRA_SUITE');
// Live role bindings (running backend export) for a demonstration of what each
// method would say today. Benchmark data is exploratory, never confirmation.
const bindingsPath = args.bindings || '/mnt/vi7000/intentsmith/evidence/hunt-decision-methods-20260924/live-bindings.json';
const bindings = existsSync(bindingsPath) ? JSON.parse(readFileSync(bindingsPath, 'utf8')).bindingResponse?.bindings || {} : {};

// The binding names a model; the newest graded run under that name fixes the
// exact artifact. Other digests under the same name remain candidates.
const incumbentOf = (role, models) => models.find(m => m.model === bindings[role]) || null;

function demoDecisions(role, models, minimumBenefit, margin, alpha = 0.05, alphaSource = 'NOMINAL_UNCALIBRATED') {
  const incumbent = incumbentOf(role, models);
  if (!incumbent) return { incumbent: bindings[role] || null, status: 'INCUMBENT_NOT_MEASURED_ON_THIS_SUITE' };
  const verdict = iv => iv.lower > minimumBenefit ? 'ZMENIT' : iv.upper < -margin ? 'PONECHAT' : 'NEROZHODNUTO';
  const rows = orientedPairPools(models, { incumbentDigest: incumbent.digest }).map(({ candidate, deltas }) => {
    const t = groupInterval(deltas, alpha, DECISION_METHODS.PAIRED_T), kl = groupInterval(deltas, 0.05, DECISION_METHODS.KL_BOUNDED);
    return { candidate, groups: deltas.length, meanDelta: r3(t.mean),
      pairedT: { lower: r3(t.lower), upper: r3(t.upper), verdict: verdict(t) },
      kl: { lower: r3(kl.lower), upper: r3(kl.upper), verdict: verdict(kl) } };
  }).sort((a, b) => b.meanDelta - a.meanDelta || (a.candidate < b.candidate ? -1 : 1));
  return { incumbent: incumbent.model, incumbentDigest: incumbent.digest, orientation: 'candidate-minus-incumbent',
    minimumBenefit, margin, alpha, alphaSource, rows };
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

// Latest graded run per digest of one exact suite contract, merged into `models`.
// Group keys of an added suite are namespaced so they never meet main-suite groups.
function loadSuite(role, { suite, contract }, kind, selection, models) {
  const rows = db.prepare(`SELECT model_name, model_digest_sha256, task_results_json FROM model_evaluation_runs
    WHERE role=? AND status='COMPLETE' AND suite_name=? AND suite_contract_sha256=? AND task_results_json IS NOT NULL
    ORDER BY completed_at DESC`).all(role, suite, contract);
  const prefix = kind === 'main' ? '' : `${suite}:`, seen = new Set(), groups = new Set();
  let explicit = 0, nameDerived = 0;
  for (const row of rows) {
    if (seen.has(row.model_digest_sha256)) continue;
    seen.add(row.model_digest_sha256);
    const tasks = JSON.parse(row.task_results_json), byGroup = new Map();
    for (const task of Array.isArray(tasks) ? tasks : []) {
      const m = taskMean(task);
      if (m == null) continue;
      if (task.independenceGroup) explicit++; else nameDerived++;
      const g = prefix + groupOf(task);
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(m);
    }
    const target = models.get(row.model_digest_sha256) || { model: row.model_name, digest: row.model_digest_sha256, groups: new Map() };
    for (const [g, xs] of byGroup) { target.groups.set(g, mean(xs)); groups.add(g); }
    models.set(row.model_digest_sha256, target);
  }
  // Groups from task names are a planning assumption, not evidence of independence.
  return { kind, suite, contract, selection, models: seen.size, groups,
    groupSource: nameDerived === 0 ? 'EXPLICIT' : explicit === 0 ? 'ASSUMED_NAME_GROUPS' : 'MIXED',
    explicitGroupTaskRows: explicit, nameDerivedTaskRows: nameDerived };
}

function roleData(role) {
  const main = pinnedSuites[role] || db.prepare(`SELECT suite_name suite, suite_contract_sha256 contract,
    COUNT(DISTINCT model_digest_sha256) models FROM model_evaluation_runs
    WHERE role=? AND status='COMPLETE' AND task_results_json IS NOT NULL
    GROUP BY 1,2 ORDER BY models DESC, MAX(completed_at) DESC LIMIT 1`).get(role);
  if (!main) return null;
  const models = new Map();
  const components = [loadSuite(role, main, 'main', pinnedSuites[role] ? 'PINNED' : 'WIDEST_COVERAGE', models)];
  if (extraSuites[role]) components.push(loadSuite(role, extraSuites[role], 'extra', 'PINNED', models));
  return { suite: components.map(c => c.suite).join('+'), contract: main.contract, components, models: [...models.values()] };
}

const onlyGroups = (models, groups) => models.map(m => ({ ...m, groups: new Map([...m.groups].filter(([g]) => groups.has(g))) }));

// Calibrated plans and the demonstration over candidate - incumbent pairs.
function incumbentAnalysis(role, models, minimumBenefit, sizes) {
  const incumbent = incumbentOf(role, models);
  const oriented = incumbent ? orientedPairPools(models, { incumbentDigest: incumbent.digest }) : [];
  if (!oriented.length) return { demo: demoDecisions(role, models, minimumBenefit, niMargin) };
  const pools = oriented.map(p => p.deltas), groups = Math.max(...pools.map(p => p.length));
  const isds = pools.map(sampleSd).filter(Number.isFinite);
  const plan = n => planFeasibility({ method: DECISION_METHODS.PAIRED_T, minimumBenefit, nonInferiorityMargin: niMargin,
    availableGroups: n, plannedEffect, pools, sims, calibrate: true });
  const incumbentPairs = { incumbent: incumbent.model, incumbentDigest: incumbent.digest,
    orientation: 'candidate-minus-incumbent', scope: 'INCUMBENT_PAIRS_MIXTURE', pairs: pools.length, groups,
    sigma: { median: r3(quantile(isds, 0.5)), p25: r3(quantile(isds, 0.25)), p75: r3(quantile(isds, 0.75)) },
    pairedT: plan(groups), pairedTAtGroups: Object.fromEntries(sizes.map(n => [n, plan(n)])) };
  const calibrated = incumbentPairs.pairedT.calibration;
  return { incumbentPairs, demo: calibrated
    ? demoDecisions(role, models, minimumBenefit, niMargin, incumbentPairs.pairedT.alpha, 'CALIBRATED_INCUMBENT_PAIRS')
    : demoDecisions(role, models, minimumBenefit, niMargin) };
}

const report = { status: 'PLANNING_EVIDENCE_ONLY', decisionAuthority: false, inference: false,
  feasibilityModelVersion: FEASIBILITY_MODEL_VERSION, nonInferiorityMargin: niMargin,
  generatedAt: new Date().toISOString(), db: dbPath, plannedEffect, sims, roles: {} };
for (const role of Object.keys(ROLE_IMPROVEMENT_THRESHOLDS)) {
  if (onlyRole && role !== onlyRole) continue;
  const data = roleData(role);
  if (!data || data.models.length < 2) { report.roles[role] = { status: 'NO_PAIRED_DATA' }; continue; }
  // All ordered pairs: both directions of every pair, so the mixture has no
  // hidden sign. Sign-free statistics use each unordered pair once.
  const pools = orientedPairPools(data.models);
  const unordered = pools.filter(p => p.candidateDigest > p.incumbentDigest);
  const sds = unordered.map(p => sampleSd(p.deltas)).filter(Number.isFinite);
  const groups = Math.max(...pools.map(p => p.deltas.length));
  const zeroShare = mean(unordered.map(p => p.deltas.filter(d => Math.abs(d) < 1e-9).length / p.deltas.length));
  const deltaPools = pools.map(p => p.deltas);
  const minimumBenefit = ROLE_IMPROVEMENT_THRESHOLDS[role];
  const run = (method, nonInferiorityMargin, availableGroups = groups) => planFeasibility({ method, minimumBenefit,
    nonInferiorityMargin, availableGroups, plannedEffect, pools: deltaPools, sims });
  const entry = {
    suite: data.suite, contract: data.contract, models: data.models.length, pairs: unordered.length, groups,
    // Several suites are a union for exploration, not one accepted scoring suite.
    combination: data.components.length > 1 ? 'EXPLORATORY_UNION_NOT_AN_ACCEPTED_SUITE' : 'SINGLE_SUITE',
    components: data.components.map(({ groups: g, ...c }) => ({ ...c, groups: g.size })),
    // Mixture over every observed pair and direction. It describes the suite,
    // not the safety of any one candidate against the incumbent.
    scope: 'ALL_ORDERED_PAIRS_MIXTURE', perCandidateGuarantee: false, nonInferiorityMargin: niMargin,
    sigma: { median: r3(quantile(sds, 0.5)), p25: r3(quantile(sds, 0.25)), p75: r3(quantile(sds, 0.75)),
      max: r3(Math.max(...sds)) },
    zeroDeltaShare: r3(zeroShare), minimumBenefit,
    kl: run(DECISION_METHODS.KL_BOUNDED, niMargin),
    pairedT: run(DECISION_METHODS.PAIRED_T, niMargin),
    // Diagnostic of the proposed tolerance (R2), not the contract value.
    pairedTMargin005: run(DECISION_METHODS.PAIRED_T, 0.05),
    pairedTCalibrated: planFeasibility({ method: DECISION_METHODS.PAIRED_T, minimumBenefit, nonInferiorityMargin: niMargin,
      availableGroups: groups, plannedEffect, pools: deltaPools, sims, calibrate: true }),
    pairedTAtGroups: Object.fromEntries(alsoGroups.map(n => [n, run(DECISION_METHODS.PAIRED_T, niMargin, n)])),
  };
  // Variability that matters for a real decision: incumbent vs candidates, not
  // every pair (clearly unsuitable models inflate the all-pairs sigma).
  // Always candidate - incumbent: a rare candidate loss must stay a loss.
  Object.assign(entry, incumbentAnalysis(role, data.models, minimumBenefit, alsoGroups));
  // Each suite on its own groups and its own calibration, so a union cannot
  // hide that the suites disagree.
  if (data.components.length > 1) data.components.forEach((component, i) => {
    Object.assign(entry.components[i], incumbentAnalysis(role, onlyGroups(data.models, component.groups), minimumBenefit, []));
  });
  report.roles[role] = entry;
  const q = entry.pairedT.quality, ni = entry.pairedT.nonInferiority, ni5 = entry.pairedTMargin005.nonInferiority;
  console.error(`${role.padEnd(6)} ${data.suite} models=${data.models.length} groups=${groups} `
    + `sigma med=${entry.sigma.median} [${entry.sigma.p25}-${entry.sigma.p75}] zero=${entry.zeroDeltaShare} | `
    + `KL ${entry.kl.verdict} power=${entry.kl.quality.powerAtPlannedEffect} | `
    + `t ${entry.pairedT.verdict} FA=${q.falseAcceptAtBoundary} power=${q.powerAtPlannedEffect} `
    + `MDE=${q.minimumDetectableEffect} needN=${q.requiredGroupsForPlannedEffect} | `
    + `NI${niMargin} needN=${ni.requiredGroupsWhenEqual} FA=${ni.falseAcceptAtBoundary} NI0.05 needN=${ni5.requiredGroupsWhenEqual}`
    + alsoGroups.map(n => { const x = entry.pairedTAtGroups[n];
      return ` | @${n}: ${x.verdict} power=${x.quality.powerAtPlannedEffect} MDE=${x.quality.minimumDetectableEffect}`; }).join(''));
  const line = (label, ip) => { const x = ip.pairedT;
    console.error(`       ${label} vs incumbent ${ip.incumbent} groups=${ip.groups}: sigma med=${ip.sigma.median} | calibrated t alpha=${x.calibration ? x.alpha : 'none-safe'} ${x.verdict} `
      + `FA=${x.quality.falseAcceptAtBoundary} switchWhenEqual=${x.quality.switchWhenEqual} `
      + `power=${x.quality.powerAtPlannedEffect} MDE=${x.quality.minimumDetectableEffect} needN=${x.quality.requiredGroupsForPlannedEffect} `
      + `NI${niMargin} power=${x.nonInferiority.powerWhenEqual} needN=${x.nonInferiority.requiredGroupsWhenEqual}`
      + Object.entries(ip.pairedTAtGroups).map(([n, y]) =>
        ` | @${n}: alpha=${y.calibration ? y.alpha : 'none-safe'} ${y.verdict} power=${y.quality.powerAtPlannedEffect} MDE=${y.quality.minimumDetectableEffect}`).join('')); };
  if (entry.incumbentPairs) line(data.components.length > 1 ? 'union' : '', entry.incumbentPairs);
  for (const c of entry.components) if (c.incumbentPairs) line(`${c.suite}`, c.incumbentPairs);
}
const json = JSON.stringify(report, null, 1) + '\n';
if (args.out) writeFileSync(args.out, json); else process.stdout.write(json);
