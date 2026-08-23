#!/usr/bin/env node
// Model Upgrade Hunt — celý řetězec od vyjmenování rodin po výměnu modelu
// ══════════════════════════════════════════════════════════════════════════════
//
//   0  vyjmenovat všech ~235 rodin z ollama.com          bez stahování
//   1  seřadit podle externích signálů, odříznout, co se nevejde
//   2  po jednom: stáhnout → změřit VRAM → schopnostní minimum
//   3  souboj se stávajícím modelem na stejných úlohách
//   4  rozhodnout, uklidit, pokračovat dalším kandidátem
//
// Použití:
//   node scripts/model-upgrade-hunt.js --shortlist          jen fáze 0+1 (nic nestahuje)
//   node scripts/model-upgrade-hunt.js --role=CODE --run    jen jedna role
//
// Mazání kandidátů je od 2026-08-20 **vypnuté**, dokud validační sady
// nerozlišují — verdikt „neuspěl" dnes často znamená „nešlo změřit".
// Zapíná se vědomě: --allow-removal
//   node scripts/model-upgrade-hunt.js --run --limit=3      zkusí 3 nejlepší kandidáty
//   node scripts/model-upgrade-hunt.js --run --only=qwen3.8:27b
//   node scripts/model-upgrade-hunt.js --shortlist --json
//
// Bez `--run` skript nic nestahuje ani nemaže.
//
// ══════════════════════════════════════════════════════════════════════════════

import Database from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { existsSync, readFileSync, statfsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { config } from '../src/config.js';
import { logger } from '../src/core/logger.js';
import {
  fetchLibraryFamilies, rankCandidates, buildCandidatePool,
} from '../src/upgrade/model-sweep.js';
import { checkRoleEligibility } from '../src/upgrade/model-ranker.js';
import { MODEL_PROFILES } from '../src/upgrade/model-profiles.js';
import { parseModelNameExtended } from '../src/upgrade/model-family-extensions.js';
import { fetchModels as fetchWhatllm, matchModels } from '../src/upgrade/whatllm-client.js';
import { lookupModel as lookupHf } from '../src/upgrade/huggingface-client.js';
import { modelRegistry } from '../src/upgrade/model-registry.js';
import { upgradeManager } from '../src/upgrade/upgrade-manager.js';
import {
  measureModel, drainResident, intendedNumCtx, listResident,
} from '../src/upgrade/vram-measurement.js';
import { tryCandidate } from '../src/upgrade/candidate-trial.js';
import { fetchInstalledModels, buildCandidates } from '../src/upgrade/model-discovery.js';
import { canonicalModelName } from '../src/upgrade/model-identity.js';
import { runMigrations } from '../src/db/migrate.js';
import {
  RoleQualityValidationRunner, describeChatTests,
} from '../src/eval/role-quality-suites.js';
import { createRoleEvaluationPlans } from '../src/eval/role-evaluation-plan.js';
import { modelEvaluationHistory } from '../src/upgrade/model-evaluation-history.js';
import {
  applyWinningBindings,
  auditResponsibilitySegregation,
  buildInstalledCandidateQueue,
  createHistoryCallbacks,
  evaluationStateForArtifact,
  resolveCurrentBindings,
  selectResponsibilityPortfolio,
} from '../src/upgrade/model-upgrade-prototype.js';
import { createModelFailoverRepository } from '../src/upgrade/model-failover.js';
import {
  createModelBindingApplication,
  createOllamaModelBindingProvider,
} from '../src/upgrade/model-binding-application.js';
import {
  assessScheduledEvaluationReadiness, holdGpuEvaluationLock,
} from '../src/upgrade/gpu-evaluation-lock.js';
import { TASK_MARGIN_EPSILON } from '../src/upgrade/pairwise-trial.js';

const args = process.argv.slice(2);
const flag = n => args.includes(`--${n}`);
const val = n => { const h = args.find(a => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : null; };

const DO_RUN = flag('run');
const AS_JSON = flag('json');
const LIMIT = parseInt(val('limit') || '3', 10);
const ONLY = (val('only') || '').split(',').map(s => s.trim()).filter(Boolean);
// Kandidát, kterého sada nerozlišila, nebyl horší — jen to nešlo změřit.
const KEEP_INCONCLUSIVE = flag('keep-inconclusive');
// Mazání je vypnuté, dokud sady nerozlišují (pravidlo z 2026-08-20).
const ALLOW_REMOVAL = flag('allow-removal');
const APPLY_WINNERS = flag('apply-winners');
const SHOW_CHAT_TESTS = flag('show-chat-tests');
const REMOTE_ONLY = flag('remote-only');
const EXPORT_CHAT_HISTORY = flag('export-chat-history');
const SCHEDULED = flag('scheduled');
const REPORT_PATH = val('report');
// `--json` is a machine contract. Imported discovery modules share this
// logger object, so silence their human progress lines for this process only;
// otherwise ANSI log prefixes would corrupt stdout before the JSON document.
if (AS_JSON) {
  logger.debug = () => {};
  logger.info = () => {};
  logger.warn = () => {};
  logger.error = () => {};
}
const emitJsonArtifact = payload => {
  if (REPORT_PATH) writeFileSync(REPORT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  if (AS_JSON) console.log(JSON.stringify(payload, null, 2));
};
/**
 * Role, pro které se hledá.  `--role=CODE` zúží běh na jednu roli — hodí se
 * na ověření řetězce, protože se tím zkrátí souboj i fronta kandidátů.
 */
const ROLE_FILTER = (val('role') || '').split(',').map(r => r.trim().toUpperCase()).filter(Boolean);
const ALL_ROLES = Object.keys(config.models);
const unknownRoles = ROLE_FILTER.filter(r => !ALL_ROLES.includes(r));
if (unknownRoles.length) {
  console.error(`Neznámá role: ${unknownRoles.join(', ')}. Dostupné: ${ALL_ROLES.join(', ')}`);
  process.exit(1);
}
const ROLES = ROLE_FILTER.length ? ROLE_FILTER : ALL_ROLES;

const log = (...a) => { if (!AS_JSON) console.log(...a); };

if (SHOW_CHAT_TESTS) {
  const tests = describeChatTests();
  if (AS_JSON || REPORT_PATH) emitJsonArtifact({
    generatedAt: new Date().toISOString(),
    suite: 'chat_v3',
    weighting: { en: 0.6, cs: 0.4 },
    tests,
  });
  else {
    console.log('CHAT v3 — EN 60 %, CZ 40 %\n');
    for (const test of tests) {
      console.log(`── ${test.name} [${test.language}]`);
      console.log(typeof test.prompt === 'string' ? test.prompt : JSON.stringify(test.prompt));
      test.rubric.forEach((item, index) => console.log(`  ${index + 1}. ${item}`));
      console.log('');
    }
  }
  process.exit(0);
}

function openDb() {
  const p = val('db') || process.env.C3_DB_PATH
    || resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'c3.db');
  if (!existsSync(p)) throw new Error(`DB nenalezena: ${p}`);
  return new Database(p);
}

async function detectVram() {
  try {
    const { getSystemProfile } = await import('../src/system/gpu-detector.js');
    const p = await getSystemProfile();
    if (p.gpus?.length) {
      const gpu = p.gpus.reduce((a, b) => ((b.vram_mb || 0) > (a.vram_mb || 0) ? b : a));
      return {
        vramMb: gpu.vram_mb || 0, model: gpu.gpu_model, igpu: gpu.is_igpu,
        numCtx: intendedNumCtx(),
      };
    }
  } catch { /* bez detekce se jede jen na měření */ }
  return { vramMb: 0, model: 'neznámá', igpu: false, numCtx: intendedNumCtx() };
}

function memoryAvailableBytes() {
  try {
    const match = readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+)\s+kB$/m);
    return match ? Number(match[1]) * 1024 : null;
  } catch { return null; }
}

function gpuComputeProcesses() {
  try {
    return execFileSync('nvidia-smi', [
      '--query-compute-apps=pid,process_name', '--format=csv,noheader,nounits',
    ], { encoding: 'utf8', timeout: 10_000 })
      .split(/\r?\n/).map(row => row.trim()).filter(Boolean);
  } catch { return ['stav GPU nelze bezpečně zjistit']; }
}

function modelStorageAvailableBytes() {
  try {
    const storagePath = process.env.OLLAMA_MODELS || '/usr/share/ollama/.ollama/models';
    const stats = statfsSync(storagePath);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch { return null; }
}

async function scheduledEvaluationReadiness() {
  return assessScheduledEvaluationReadiness({
    residentModels: await listResident({ baseUrl: config.ollama?.baseUrl }),
    computeProcesses: gpuComputeProcesses(),
    memoryAvailableBytes: memoryAvailableBytes(),
    diskAvailableBytes: modelStorageAvailableBytes(),
  });
}

// ─── Fáze 0 + 1 ─────────────────────────────────────────────────────────────

/**
 * Fáze 0 + 1 — pro **každou roli zvlášť**.
 *
 * Jeden společný seznam byl špatná otázka: cílem není jeden univerzální model,
 * ale nejlepší model pro každou roli. Role se liší laťkou (svým stávajícím
 * modelem), způsobilostí (VISION potřebuje vision model, D1 minimálně 14B) i
 * tím, co je pro ni přínos (coder model do CODE, generalista do CHAT).
 *
 * @returns {{ perRole: Map<string, Array>, queue: Array, familiesTotal: number }}
 */
async function buildRoleShortlists(gpu, installedNames, bindings) {
  const families = await fetchLibraryFamilies();
  log(`Fáze 0: ${families.length} rodin v knihovně Ollamy`);

  const whatllm = await fetchWhatllm().catch(() => []);
  const qualityByFamily = new Map();
  if (whatllm.length) {
    const probe = families.map(f => ({ name: `${f}:1b` }));
    for (const [probeName, entry] of matchModels(whatllm, probe)) {
      const fam = probeName.split(':')[0];
      const prev = qualityByFamily.get(fam);
      if (!prev || prev < entry.qualityIndex) qualityByFamily.set(fam, entry.qualityIndex);
    }
  }
  log(`Fáze 1: whatllm hodnotí ${qualityByFamily.size} z nich`);

  // Laťka je pro každou roli jiná — je to hodnocení jejího stávajícího modelu,
  // ne globální maximum. Silná role tak nezvedne laťku slabé a naopak.
  // Klíčem je kanonické jméno: config váže `qwen3-30b-a3b`, Ollama hlásí
  // `qwen3-30b-a3b:latest`. Bez sjednocení by laťka nikdy nesedla a filtr
  // podle hodnocení by se neuplatnil.
  const qualityOfModel = new Map();
  if (whatllm.length) {
    for (const [name, entry] of matchModels(whatllm, installedNames.map(n => ({ name: n })))) {
      const key = canonicalModelName(name);
      if (key) qualityOfModel.set(key, entry.qualityIndex);
    }
  }

  // Tagy se stahují jednou pro všechny role a pro **všechny** rodiny.
  // Omezit pool na hodnocené rodiny by roli VISION nechalo trvale prázdnou —
  // whatllm mezi svými 17 rodinami žádný vision model nemá.
  const pool = await buildCandidatePool(families, {
    vramMb: gpu.vramMb,
    gpuModel: gpu.model,
    onProgress: (d, t) => log(`   … prohledáno ${d}/${t} rodin`),
  });
  log(`Fáze 1: ${pool.length} rodin má variantu, která se může vejít\n`);

  const profileOf = (entry) => parseModelNameExtended(entry.name);
  const eligibilityOf = (entry, role) => checkRoleEligibility(profileOf(entry), role);

  const perRole = new Map();
  for (const role of ROLES) {
    const incumbent = bindings[role];
    const baseline = qualityOfModel.get(canonicalModelName(incumbent)) ?? null;
    const ranked = rankCandidates(pool, {
      vramMb: gpu.vramMb,
      installed: installedNames,
      incumbentQuality: baseline,
      qualityOf: e => qualityByFamily.get(e.family) ?? null,
      role,
      eligibilityOf,
      profileOf,
      preferredCategories: MODEL_PROFILES[role]?.preferredCategories ?? null,
    });
    perRole.set(role, ranked);
    log(`  ${role.padEnd(7)} laťka ${incumbent} (${baseline ?? 'nehodnocen'})  →  ${ranked.length} kandidátů`);
  }

  // Fronta: kandidát se stáhne jednou a zkusí se jen v rolích, kde je
  // kandidátem. Pořadí podle jeho nejlepší priority napříč těmi rolemi.
  const byName = new Map();
  for (const [role, list] of perRole) {
    for (const c of list) {
      const existing = byName.get(c.name);
      if (existing) {
        existing.roles.push(role);
        existing.priority = Math.max(existing.priority, c.priority);
      } else {
        byName.set(c.name, { ...c, roles: [role] });
      }
    }
  }
  const queue = [...byName.values()].sort((a, b) => b.priority - a.priority || a.sizeGB - b.sizeGB);

  return { perRole, queue, familiesTotal: families.length };
}

// ─── Běh ────────────────────────────────────────────────────────────────────

const gpu = await detectVram();
log(`GPU: ${gpu.model}, ${gpu.vramMb} MB VRAM${gpu.igpu ? ' (integrovaná)' : ''}`);
if (!gpu.vramMb) log('⚠ VRAM se nepodařilo zjistit — předfiltr velikosti se neuplatní, rozhodne měření');

const db = openDb();
await runMigrations(db);
modelEvaluationHistory.setDb(db);
const bindingRepository = createModelFailoverRepository(db);
const validationRunner = new RoleQualityValidationRunner(config.ollama?.baseUrl);
validationRunner.setDb(db);
const evaluationPlans = createRoleEvaluationPlans();

if (EXPORT_CHAT_HISTORY) {
  const plan = evaluationPlans.CHAT;
  const selected = new Set(ONLY.map(canonicalModelName));
  const rows = db.prepare(`
    SELECT model_name, model_canonical_name, model_digest_sha256, score, repeats,
           duration_ms, tokens_per_second, vram_bytes, task_results_json, completed_at
      FROM model_evaluation_runs
     WHERE status = 'COMPLETE'
       AND suite_name = ?
       AND suite_contract_sha256 = ?
     ORDER BY completed_at ASC
  `).all(plan.suiteName, plan.suiteContractSha256)
    .filter(row => !selected.size || selected.has(row.model_canonical_name))
    .map(row => ({
      model: row.model_name,
      canonicalModel: row.model_canonical_name,
      digestSha256: row.model_digest_sha256,
      score: row.score,
      repeats: row.repeats,
      durationMs: row.duration_ms,
      tokensPerSecond: row.tokens_per_second,
      vramBytes: row.vram_bytes,
      completedAt: row.completed_at,
      tasks: JSON.parse(row.task_results_json),
    }));
  const currentForExport = resolveCurrentBindings(config.models, bindingRepository, ALL_ROLES);
  const incumbentCanonical = canonicalModelName(currentForExport.bindings.CHAT);
  const incumbent = rows.find(row => row.canonicalModel === incumbentCanonical) || null;
  const languageScore = (row, language) => {
    const tasks = row.tasks.filter(task => task.language === language);
    return tasks.reduce((sum, task) => sum + task.mean, 0) / (tasks.length || 1);
  };
  const pairwise = rows.filter(row => row !== incumbent).map(row => {
    const incumbentTasks = new Map((incumbent?.tasks || []).map(task => [task.name, task]));
    const tasks = row.tasks.map(task => {
      const baseline = incumbentTasks.get(task.name);
      const delta = baseline ? task.mean - baseline.mean : 0;
      const noise = baseline ? Math.max(task.spread, baseline.spread) : 0;
      return {
        name: task.name, language: task.language, candidateMean: task.mean,
        incumbentMean: baseline?.mean ?? null, delta, noise,
        discriminating: !!baseline && Math.abs(delta) > Math.max(TASK_MARGIN_EPSILON, noise),
      };
    });
    const discriminating = tasks.filter(task => task.discriminating);
    return {
      candidate: row.model,
      incumbent: incumbent?.model || currentForExport.bindings.CHAT,
      discriminating: discriminating.length,
      byLanguage: Object.fromEntries(['en', 'cs'].map(language => [
        language, discriminating.filter(task => task.language === language).length,
      ])),
      candidateWins: discriminating.filter(task => task.delta > 0).length,
      incumbentWins: discriminating.filter(task => task.delta < 0).length,
      tasks,
    };
  });
  const taskNames = [...new Set(rows.flatMap(row => row.tasks.map(task => task.name)))];
  const panel = taskNames.map(name => {
    const values = rows.map(row => {
      const task = row.tasks.find(item => item.name === name);
      return { model: row.model, mean: task?.mean ?? 0, spread: task?.spread ?? 0 };
    });
    const means = values.map(value => value.mean);
    const range = Math.max(...means) - Math.min(...means);
    const noise = Math.max(...values.map(value => value.spread));
    const language = rows.flatMap(row => row.tasks).find(task => task.name === name)?.language || null;
    return {
      name, language, values, range, noise,
      discriminating: range > Math.max(TASK_MARGIN_EPSILON, noise) + 1e-9,
    };
  });
  emitJsonArtifact({
    generatedAt: new Date().toISOString(),
    suite: plan.suiteName,
    suiteVersion: plan.suiteVersion,
    suiteContractSha256: plan.suiteContractSha256,
    weighting: { en: 0.6, cs: 0.4 },
    decisionMinimums: {
      total: plan.minimumDiscriminatingTasks,
      byLanguage: plan.minimumDiscriminatingByLanguage,
    },
    incumbent: currentForExport.bindings.CHAT,
    tests: describeChatTests(),
    models: rows.map(row => ({
      ...row,
      languageScores: { en: languageScore(row, 'en'), cs: languageScore(row, 'cs') },
    })),
    pairwise,
    panel: {
      models: rows.map(row => row.model),
      discriminating: panel.filter(task => task.discriminating).length,
      byLanguage: Object.fromEntries(['en', 'cs'].map(language => [
        language, panel.filter(task => task.language === language && task.discriminating).length,
      ])),
      tasks: panel,
    },
  });
  db.close();
  process.exit(0);
}

const installedRaw = await fetchInstalledModels();
const installed = buildCandidates(installedRaw);
const installedNames = installed.map(m => m.name);
log(`Nainstalováno: ${installedNames.length} modelů`);
if (ROLE_FILTER.length) log(`Omezeno na role: ${ROLES.join(', ')}`);
log('');

// Durable USER_APPLY/USER_ROLLBACK bindings are runtime truth after startup
// rehydration. Falling back to config here would compare against stale defaults
// and could "upgrade" a role to a model it already superseded.
const current = resolveCurrentBindings(config.models, bindingRepository, ALL_ROLES);
const durableBindings = current.durable;
const initialBindings = current.bindings;
const bindings = { ...initialBindings };
if (Object.keys(durableBindings).length) {
  log(`Durable runtime vazby: ${Object.entries(durableBindings).map(([role, model]) => `${role}=${model}`).join(', ')}`);
}
const initialResponsibilityAudit = auditResponsibilitySegregation(initialBindings);
if (!initialResponsibilityAudit.compliant) {
  log(`Segregace vyžaduje opravu: ${initialResponsibilityAudit.violations
    .map(row => `${row.type} ${row.roles.join('+')}=${row.model}`).join('; ')}`);
}
// Ručně zadaný pilot zná své kandidáty předem. Neprocházet kvůli němu celý
// vzdálený katalog je podstatné: --only má být rychlá a síťově úsporná cesta,
// ne skrytá discovery fáze.
const shortlist = ONLY.length
  ? { perRole: new Map(ROLES.map(role => [role, []])), queue: [], familiesTotal: 0 }
  : await buildRoleShortlists(gpu, installedNames, bindings);
const { perRole, queue: remoteQueue, familiesTotal } = shortlist;
const installedQueue = REMOTE_ONLY ? [] : buildInstalledCandidateQueue({
  candidates: installed,
  roles: ROLES,
  bindings,
  plans: evaluationPlans,
  history: modelEvaluationHistory,
  hardware: gpu,
});
const queue = [...installedQueue, ...remoteQueue]
  .sort((a, b) => b.priority - a.priority || a.sizeGB - b.sizeGB);

log('\n══ KANDIDÁTI PODLE ROLÍ ══');
for (const role of ROLES) {
  const list = perRole.get(role) || [];
  log(`\n── ${role}  (nyní ${bindings[role]}) ──`);
  if (!list.length) { log('   žádný kandidát neprošel filtrem'); continue; }
  list.slice(0, 5).forEach((c, i) =>
    log(`  ${i + 1}. ${c.name.padEnd(28)} ${String(c.sizeGB).padStart(5)} GB  prio ${String(c.priority).padStart(6)}  ${c.reasons.join(', ')}`));
}

log(`\n══ FRONTA KE ZKOUŠCE (${queue.length}) ══`);
queue.slice(0, 12).forEach((c, i) =>
  log(`  ${String(i + 1).padStart(2)}. ${c.name.padEnd(28)} pro role: ${c.roles.join(', ')}`
    + `${c.evaluationState ? `  [${c.evaluationState.state}]` : '  [remote artifact unknown]'}`));

let picked = queue;
if (ONLY.length) {
  picked = ONLY.map((name) => {
    const local = installed.find(candidate => canonicalModelName(candidate.name) === canonicalModelName(name));
    return {
      ...(local || {}),
      name: local?.name || name,
      family: (local?.name || name).split(':')[0],
      sizeGB: local?.sizeGB || 0,
      installed: Boolean(local),
      artifact: local?.artifact || null,
      roles: ROLES,
      reasons: [local ? 'zadáno ručně; již nainstalováno' : 'zadáno ručně'],
    };
  });
}

if (!DO_RUN) {
  if (AS_JSON || REPORT_PATH) {
    emitJsonArtifact({
      gpu, familiesTotal,
      perRole: Object.fromEntries([...perRole].map(([r, l]) => [r, l])),
      queue,
    });
  } else log('\n(bez --run se nic nestahuje; --run --limit=N zkusí N nejlepších)');
  process.exit(0);
}

const readyRoles = ROLES.filter(role => evaluationPlans[role]?.decisionReady !== false);
const blockedRoles = ROLES.filter(role => !readyRoles.includes(role));
for (const role of blockedRoles) {
  const plan = evaluationPlans[role];
  log(`  [suite-readiness] ${role}: ${plan.suiteName} má ${plan.taskCount}/${plan.minimumTaskCount} `
    + 'požadovaných aktivních úloh');
}
if (readyRoles.length === 0) {
  log('\nŽádná vybraná role nemá rozhodovací sadu; bez stahování a bez GPU běhu končím.');
  process.exit(0);
}

// Prevent a scheduled hunt, manual pilot and CODE calibration from loading
// different Ollama models into the same GPU between drain and measurement.
const gpuLease = holdGpuEvaluationLock({ command: `model-upgrade-hunt ${args.join(' ')}` });
if (SCHEDULED) {
  const readiness = await scheduledEvaluationReadiness();
  if (!readiness.ready) {
    log(`Plánovaný hunt přeskočen bez zásahu: ${readiness.reasons.join('; ')}`);
    gpuLease.release();
    process.exit(0);
  }
}

// Referenční rychlost stávajících modelů — potřebná pro rozhodnutí při remíze.
log('\n══ MĚŘENÍ STÁVAJÍCÍCH MODELŮ ══');
const incumbentSpeed = {};
const measurements = new Map();
const historyCallbacks = createHistoryCallbacks({
  history: modelEvaluationHistory,
  inventory: installedRaw,
  baseUrl: config.ollama?.baseUrl,
  hardware: gpu,
  measurements,
});
for (const name of new Set(readyRoles.map(role => bindings[role]).filter(Boolean))) {
  const artifact = await historyCallbacks.resolveArtifact(name);
  const matchingRole = readyRoles.find(role => canonicalModelName(bindings[role]) === canonicalModelName(name));
  const plan = matchingRole ? evaluationPlans[matchingRole] : null;
  const prior = plan ? modelEvaluationHistory.getComplete({
    digestSha256: artifact.digestSha256,
    suiteName: plan.suiteName,
    contractSha256: plan.suiteContractSha256,
  }) : null;
  const m = prior?.tokensPerSecond != null
    ? { fits: true, throughput: { tokensPerSecond: prior.tokensPerSecond }, placement: { vramBytes: prior.vramBytes || 0, sizeBytes: 0 }, reused: true }
    : await measureModel(name);
  incumbentSpeed[name] = m.throughput?.tokensPerSecond ?? 0;
  measurements.set(canonicalModelName(name), m);
  const p = m.placement || {};
  log(`  ${name.padEnd(24)} ${m.fits ? 'vejde se' : 'NEVEJDE '} ${m.reused ? '[history]' : '[new]'} `
    + `${p.sizeBytes ? `${(p.vramBytes / 2 ** 30).toFixed(2)}/${(p.sizeBytes / 2 ** 30).toFixed(2)} GB` : '-'}  `
    + `${incumbentSpeed[name] || '—'} tok/s`);
}
await drainResident();

const toTry = picked.slice(0, LIMIT);
log(`\n══ ZKOUŠKA KANDIDÁTŮ (${toTry.length}) ══`);

const results = [];
for (const cand of toTry) {
  log(`\n─── ${cand.name}  (role: ${cand.roles.join(', ')}) ───`);
  const r = await tryCandidate(cand.name, {
    runner: validationRunner,
    skipPull: cand.installed === true,
    // Jen role, pro které je tenhle model vůbec kandidátem.
    roles: cand.roles,
    bindings,
    keepInconclusive: KEEP_INCONCLUSIVE,
    allowRemoval: ALLOW_REMOVAL,
    // Mazání vlastní model-registry; candidate-trial ho dostane injekcí,
    // aby neobcházel kanonickou identitu a exclusive mutation autoritu.
    deleteModel: (name, options) => modelRegistry.deleteModel(name, options),
    incumbentSpeed,
    evaluationPlans,
    trialOpts: {
      repeats: 3,
      loadHistoricalSummary: historyCallbacks.loadHistoricalSummary,
      saveHistoricalSummary: historyCallbacks.saveHistoricalSummary,
    },
    hasReusableEvaluation: async (name, roles) => {
      const artifact = await historyCallbacks.resolveArtifact(name);
      return evaluationStateForArtifact(
        artifact, roles, evaluationPlans, modelEvaluationHistory,
      ).state === 'scored';
    },
    onStage: (stage, m, info = {}) => {
      if (stage === 'measured') {
        measurements.set(canonicalModelName(m), {
          fits: info.fits,
          throughput: { tokensPerSecond: info.tokensPerSecond },
          placement: { vramBytes: info.vramBytes, sizeBytes: info.sizeBytes },
          numCtx: info.numCtx,
        });
        const gb = n => (n / 2 ** 30).toFixed(2);
        log(`  ✓ vejde se do VRAM (${gb(info.vramBytes)}/${gb(info.sizeBytes)} GB při ${info.numCtx} tok), `
          + `${info.tokensPerSecond ?? '—'} tok/s`);
      } else if (stage === 'floorPassed') {
        log(`  ✓ schopnostní minimum prošlo (${info.probes} kontroly)`);
      } else if (stage === 'roleDecided') {
        const d = info.decision;
        log(`     ${info.role.padEnd(7)} ${d.winner === 'candidate' ? 'KANDIDÁT' : 'stávající'}  (${d.basis}) ${d.detail}`);
      } else {
        log(`  [${stage}] ${m}`);
      }
    },
  });
  results.push(r);

  if (r.error) {
    let artifact;
    try {
      artifact = await historyCallbacks.resolveArtifact(cand.name);
    } catch {
      // Pull failures still belong in append-only history. Without a digest the
      // row is evidence only and will never suppress a future artifact.
      artifact = { modelName: cand.name };
    }
    const recordedContracts = new Set();
    for (const role of cand.roles) {
      const plan = evaluationPlans[role];
      if (!plan) continue;
      const contractKey = `${plan.suiteName}:${plan.suiteContractSha256}`;
      if (recordedContracts.has(contractKey)) continue;
      recordedContracts.add(contractKey);
      const measuredCpuSpill = r.stage === 'measure'
        && r.measurement?.placement?.loaded === true
        && r.measurement?.fits === false;
      modelEvaluationHistory.recordTerminal({
        artifact,
        role,
        suiteName: plan.suiteName,
        suiteVersion: plan.suiteVersion,
        contractSha256: plan.suiteContractSha256,
        status: r.stage === 'measure' ? 'BLOCKED' : 'FAILED',
        repeats: plan.repeats,
        hardware: gpu,
        metadata: {
          source: 'model-upgrade-hunt-v136.1', stage: r.stage,
          numCtx: r.measurement?.numCtx ?? gpu.numCtx,
          cpuBytes: r.measurement?.placement?.cpuBytes ?? null,
          sizeBytes: r.measurement?.placement?.sizeBytes ?? null,
          vramBytes: r.measurement?.placement?.vramBytes ?? null,
        },
        errorCode: r.stage === 'measure'
          ? (measuredCpuSpill ? 'CANDIDATE_VRAM_FIT_FAILED' : 'CANDIDATE_MEASURE_RETRYABLE')
          : `CANDIDATE_${String(r.stage || 'unknown').toUpperCase()}_FAILED`,
        errorMessage: r.error,
      });
    }
    log(`  ✗ ${r.error}${r.removed ? ' → smazán' : ''}`);
    continue;
  }
  const t = r.measurement.throughput?.tokensPerSecond;
  if (r.accepted) {
    const won = Object.entries(r.decisions).filter(([, d]) => d.winner === 'candidate').map(([x]) => x);
    log(`  → kvalitativní kandidát pro role: ${won.join(', ')}; finální portfolio určí segregace`);
    incumbentSpeed[cand.name] = t ?? 0;
  } else if (r.inconclusive) {
    log('  → NEROZHODNUTO — sada kandidáta neodlišila od stávajícího, takže');
    log(`     to neznamená, že je horší. ${r.removed ? 'Smazán.' : 'Ponechán na disku.'}`);
  } else {
    log(`  → prohrál v souboji${r.removed ? ', smazán' : ', ponechán na disku'}`);
  }
  if (r.keptReason) log(`     (${r.keptReason})`);
}

const portfolioEvidence = {};
const addPortfolioEvidence = (role, row) => {
  if (!portfolioEvidence[role]) portfolioEvidence[role] = [];
  portfolioEvidence[role].push(row);
};
for (const result of results) {
  for (const trial of result.trials || []) {
    if (!trial?.comparison || !trial.role) continue;
    addPortfolioEvidence(trial.role, {
      model: result.model,
      score: trial.comparison.candidateSuiteScore,
      source: 'candidate-evaluation',
      eligibleForChange: trial.decision?.winner === 'candidate',
    });
    addPortfolioEvidence(trial.role, {
      model: initialBindings[trial.role],
      score: trial.comparison.incumbentSuiteScore,
      source: 'incumbent-evaluation',
      eligibleForChange: true,
    });
  }
}
const portfolio = selectResponsibilityPortfolio({
  before: initialBindings,
  evidenceByRole: portfolioEvidence,
  roles: ALL_ROLES,
});
Object.assign(bindings, portfolio.bindings);

log('\n══ SEGREGACE ODPOVĚDNOSTÍ ══');
if (portfolio.feasible) {
  log(`  portfolio vyhovuje: nejvýše 2 role/model, kritické autor-reviewer dvojice oddělené`);
  for (const role of portfolio.changedRoles) {
    const choice = portfolio.choices[role];
    log(`  ${role}: ${initialBindings[role]} → ${portfolio.bindings[role]}  score ${choice?.score?.toFixed?.(3) ?? '—'}`);
  }
} else {
  log('  z dosud změřených variant nelze sestavit vyhovující portfolio; žádná vazba se nemění');
  for (const violation of portfolio.audit.violations) {
    log(`  ✗ ${violation.type}: ${violation.roles.join(', ')} → ${violation.model}`);
  }
}

log('\n══ VÝSLEDEK ══');
for (const role of ROLES) {
  const before = initialBindings[role];
  const after = bindings[role];
  log(`  ${role.padEnd(7)} ${before === after ? `beze změny (${before})` : `${before} → ${after}`}`);
}
const changed = ROLES.filter(r => initialBindings[r] !== bindings[r]);
let applicationOutcomes = [];
if (changed.length && APPLY_WINNERS) {
  log('\n══ APLIKACE VÍTĚZŮ ══');
  upgradeManager.setDb(db);
  const provider = createOllamaModelBindingProvider({
    baseUrl: config.ollama?.baseUrl,
    pullImpl: (modelName, onProgress, authority) => (
      upgradeManager.pullModel(modelName, onProgress, authority)
    ),
  });
  const application = createModelBindingApplication({
    repository: bindingRepository,
    runtime: upgradeManager.createBindingRuntimePort(),
    provider,
    publishControl: () => {},
    actorFactory: () => 'user:model-upgrade-hunt',
    logger,
  });
  await application.rehydrateBindings();
  applicationOutcomes = await applyWinningBindings({
    before: initialBindings,
    after: bindings,
    roles: changed,
    applyBinding: (role, targetModel) => application.applyManualBinding({ role, targetModel }),
  });
  for (const outcome of applicationOutcomes) {
    log(`  ${outcome.role}: ${outcome.from} → ${outcome.to}  ${outcome.result.verified ? 'verified' : outcome.result.outcome}`);
  }
} else if (changed.length) {
  log(`\n${changed.length} rolí má lepšího kandidáta. Přidej --apply-winners pro durable aplikaci; incumbent zůstane na disku.`);
} else {
  const rawWinners = results.flatMap(result => Object.entries(result.decisions || {})
    .filter(([, decision]) => decision.winner === 'candidate')
    .map(([role]) => `${role}=${result.model}`));
  if (rawWinners.length) {
    log(`\nKvalitativní vítěz existuje (${rawWinners.join(', ')}), ale po segregaci nevznikla přípustná změna vazby.`);
  } else {
    log('\nŽádný kandidát neporazil stávající modely.');
  }
}

if (AS_JSON || REPORT_PATH) {
  emitJsonArtifact({
    generatedAt: new Date().toISOString(),
    gpu,
    perRole: Object.fromEntries([...perRole].map(([r, l]) => [r, l])),
    queue, results, bindings, applicationOutcomes, portfolio,
  });
}
