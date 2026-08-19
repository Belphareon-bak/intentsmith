#!/usr/bin/env node
// Model Scoring Report — žebříček nainstalovaných modelů podle rolí
// ══════════════════════════════════════════════════════════════════════════════
//
// Spojí tři vrstvy podkladů do jednoho rozhodnutí:
//
//   1. discovery + katalogové obohacení  (benchmarky, VRAM, zralost)
//   2. validační sady                    (skutečné volání modelu, `--validate`)
//   3. model_usage                       (zda se model vůbec někdy použil)
//
// Bez `--validate` běží jen nad benchmarkovým podkladem a je to čtení bez
// vedlejších efektů.  S `--validate` skutečně volá Ollama a výsledky ukládá do
// `model_validations`, odkud si je bere i běžný upgrade cyklus.
//
// Použití:
//   node scripts/model-scoring-report.js                  # rychlý žebříček
//   node scripts/model-scoring-report.js --validate       # + reálné testy
//   node scripts/model-scoring-report.js --validate --only=qwq:32b,glm-4.7-flash
//   node scripts/model-scoring-report.js --json           # strojový výstup
//
// ══════════════════════════════════════════════════════════════════════════════

import Database from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { discover } from '../src/upgrade/model-discovery.js';
import { scoreModel, checkRoleEligibility } from '../src/upgrade/model-ranker.js';
import { getSuiteForRole, validationRunner } from '../src/upgrade/validation-suites.js';
import { canonicalModelName, sameModelName } from '../src/upgrade/model-identity.js';
import { config } from '../src/config.js';

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const value = name => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const DO_VALIDATE = flag('validate');
const AS_JSON = flag('json');
const ONLY = (value('only') || '').split(',').map(s => s.trim()).filter(Boolean);

const ROLES = Object.keys(config.models);

function log(...a) { if (!AS_JSON) console.log(...a); }

// ─── Podklady ───────────────────────────────────────────────────────────────

async function detectVram() {
  try {
    const { getSystemProfile } = await import('../src/system/gpu-detector.js');
    const profile = await getSystemProfile();
    if (profile.gpus?.length) return Math.max(...profile.gpus.map(g => g.vram_mb || 0));
  } catch { /* bez GPU detekce se skóruje s 0 a hardwareFit spadne na fallback */ }
  return 0;
}

/**
 * Otevře DB přímo přes better-sqlite3, stejně jako `bin/quality-report.js`.
 *
 * Runtime modul `src/db/database.js` se schválně nepoužívá: fail-closed na
 * `C3_DB_PATH` je jeho záměrná vlastnost pro běh serveru a CLI skript ji nemá
 * obcházet nastavením proměnné za něj.  Chybu neplykáme — bez zapisovatelné DB
 * by se hodinová validace neuložila.
 */
function openDb() {
  const dbPath = value('db')
    || process.env.C3_DB_PATH
    || resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'c3.db');
  if (!existsSync(dbPath)) {
    throw new Error(`DB nenalezena: ${dbPath} (zadej --db=/cesta nebo C3_DB_PATH)`);
  }
  return new Database(dbPath);
}

/** Kolikrát byl model reálně použit — model_usage je jediná pasivní stopa. */
function readUsage(db) {
  const usage = new Map();
  if (!db) return usage;
  try {
    const rows = db.prepare('SELECT model, COUNT(*) AS n FROM model_usage GROUP BY model').all();
    for (const row of rows) {
      const key = canonicalModelName(row.model);
      if (key) usage.set(key, (usage.get(key) || 0) + row.n);
    }
  } catch { /* tabulka nemusí existovat ve starším schématu */ }
  return usage;
}

// ─── Validace ───────────────────────────────────────────────────────────────

/** Sady, které pokrývají nakonfigurované role. */
function suitesForRoles() {
  return [...new Set(ROLES.map(getSuiteForRole).filter(Boolean))];
}

/**
 * Načte už uložené výsledky validace z DB, aby se hodinový běh nemusel
 * opakovat.  Prošlé záznamy (starší než VALIDATION_TTL_DAYS) se ignorují —
 * raději žádné číslo než zastaralé.
 *
 * @returns {Map<string, Map<string, number>>}
 */
function readPersistedValidation(models, db) {
  const scores = new Map();
  if (!db) return scores;
  validationRunner.setDb(db);
  for (const model of models) {
    const key = canonicalModelName(model.name);
    if (!key) continue;
    const perSuite = new Map();
    for (const suite of suitesForRoles()) {
      if (validationRunner.isStale(model.name, suite)) continue;
      const score = validationRunner.getScore(model.name, suite);
      if (typeof score === 'number') perSuite.set(suite, score);
    }
    if (perSuite.size > 0) scores.set(key, perSuite);
  }
  return scores;
}

/**
 * Spustí pro každý model ty sady, které odpovídají rolím.  Vrací
 * Map<canonicalName, Map<suite, score>>.
 */
async function runValidation(models, db) {
  if (db) validationRunner.setDb(db);
  const suitesNeeded = suitesForRoles();
  const scores = new Map();

  for (const model of models) {
    const key = canonicalModelName(model.name);
    if (!key) continue;
    const perSuite = new Map();
    for (const suite of suitesNeeded) {
      process.stderr.write(`  validace ${model.name} / ${suite} … `);
      try {
        const result = await validationRunner.runSuite(suite, model.name);
        const score = typeof result?.score === 'number' ? result.score : null;
        perSuite.set(suite, score);
        process.stderr.write(score == null ? 'bez výsledku\n' : `${(score * 100).toFixed(0)} %\n`);
      } catch (err) {
        perSuite.set(suite, null);
        process.stderr.write(`chyba: ${err.message}\n`);
      }
    }
    scores.set(key, perSuite);
  }
  return scores;
}

// ─── Hlavní běh ─────────────────────────────────────────────────────────────

const gpuVramMb = await detectVram();
const db = openDb();
const usage = readUsage(db);

const discovery = await discover({ includeCatalog: false });
let local = discovery.candidates.filter(c => c.source === 'local');
if (ONLY.length > 0) {
  local = local.filter(c => ONLY.some(o => sameModelName(o, c.name)));
}

if (local.length === 0) {
  console.error('Žádné nainstalované modely — běží Ollama?');
  process.exit(1);
}

// Bez --validate se použijí dřív uložené výsledky, jsou-li v TTL.  S --validate
// se měří znovu.
let validation = readPersistedValidation(local, db);
const persistedCount = validation.size;
if (DO_VALIDATE) {
  log(`\nSpouštím validační sady nad ${local.length} modely. Trvá to desítky minut.\n`);
  validation = await runValidation(local, db);
}

// Skóre pro každou dvojici (role, model)
const table = [];
for (const role of ROLES) {
  const bound = config.models[role];
  const referenceParams = local.find(c => sameModelName(c.name, bound))?.params || 0;
  const suite = getSuiteForRole(role);

  for (const model of local) {
    const key = canonicalModelName(model.name);
    const validationScore = validation.get(key)?.get(suite) ?? null;
    const { eligible, reason } = checkRoleEligibility(model, role);
    const { totalScore, breakdown } = scoreModel(
      model,
      role,
      { gpuVramMb, referenceParams, currentModel: bound, roleBindings: config.models, validationScore },
    );
    table.push({
      role,
      model: model.name,
      eligible,
      ineligibleReason: reason,
      score: totalScore,
      validationScore,
      benchmarkConfidence: model.benchmarkConfidence ?? null,
      enrichment: model.enrichmentSource ?? 'none',
      bound: sameModelName(model.name, bound),
      usage: usage.get(key) || 0,
      sizeGB: model.sizeGB || 0,
      breakdown,
    });
  }
}

// ─── Doporučení k pročištění ────────────────────────────────────────────────
//
// Model je kandidát na smazání, jen když selže ve všech třech ohledech:
// není navázaný na roli, není v top-3 žádné role a nikdy se nepoužil.
// Kterákoli jedna splněná podmínka ho zachrání.

const topThree = new Set();
for (const role of ROLES) {
  table.filter(r => r.role === role && r.eligible)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .forEach(r => topThree.add(canonicalModelName(r.model)));
}

// Nejlepší skóre modelu se počítá jen z rolí, pro které je způsobilý — jinak by
// se textový model chlubil skóre z role VISION, do které vůbec nepatří.
const byModel = new Map();
for (const row of table) {
  const key = canonicalModelName(row.model);
  const prev = byModel.get(key);
  if (!prev) {
    byModel.set(key, { name: row.model, best: null, sizeGB: row.sizeGB, usage: row.usage });
  }
  if (!row.eligible) continue;
  const entry = byModel.get(key);
  if (entry.best == null || row.score > entry.best) entry.best = row.score;
}
for (const entry of byModel.values()) if (entry.best == null) entry.best = 0;

const bound = new Set(Object.values(config.models).map(canonicalModelName).filter(Boolean));
const removable = [];
const keep = [];
for (const [key, info] of byModel) {
  const reasons = [];
  if (bound.has(key)) reasons.push('navázán na roli');
  if (topThree.has(key)) reasons.push('v top-3 některé role');
  if (info.usage > 0) reasons.push(`použit ${info.usage}×`);
  (reasons.length > 0 ? keep : removable).push({ ...info, reasons });
}
removable.sort((a, b) => b.sizeGB - a.sizeGB);

// ─── Výstup ─────────────────────────────────────────────────────────────────

if (AS_JSON) {
  console.log(JSON.stringify({
    gpuVramMb,
    validated: DO_VALIDATE,
    discovery: discovery.stats,
    table,
    keep,
    removable,
  }, null, 2));
} else {
  const valNote = DO_VALIDATE
    ? 'validace proběhla nyní'
    : (persistedCount > 0
      ? `validace z DB pro ${persistedCount} modelů`
      : 'bez validace (--validate pro reálné testy)');
  log(`GPU VRAM: ${gpuVramMb} MB | obohaceno: ${discovery.stats.enrichedExact} přesně, ` +
      `${discovery.stats.enrichedEstimated} odhadem, ${discovery.stats.enrichmentMissing} bez podkladu | ${valNote}`);

  for (const role of ROLES) {
    const all = table.filter(r => r.role === role);
    const rows = all.filter(r => r.eligible).sort((a, b) => b.score - a.score);
    const excluded = all.filter(r => !r.eligible);
    const boundRow = rows.find(r => r.bound);
    const place = boundRow
      ? `${rows.indexOf(boundRow) + 1}/${rows.length}`
      : (all.some(r => r.bound) ? 'nezpůsobilý' : 'nenainstalován');
    log(`\n── ${role}  (nyní ${config.models[role]}, pořadí ${place}) ${'─'.repeat(Math.max(0, 30 - role.length))}`);
    rows.slice(0, 5).forEach((r, i) => {
      const val = r.validationScore == null ? '' : `  val ${(r.validationScore * 100).toFixed(0)}%`;
      const conf = r.benchmarkConfidence != null && r.benchmarkConfidence < 1
        ? `  conf ${r.benchmarkConfidence.toFixed(2)}` : '';
      log(`  ${i + 1}. ${r.score.toFixed(4)}  ${r.model.padEnd(26)}${val}${conf}${r.bound ? '  ← aktuální' : ''}`);
    });
    if (excluded.length > 0) {
      log(`     nezpůsobilí (${excluded.length}): ${excluded.map(r => `${r.model} — ${r.ineligibleReason}`).join('; ')}`);
    }
  }

  log(`\n\n══ PONECHAT (${keep.length}) ══`);
  keep.sort((a, b) => b.best - a.best).forEach(k =>
    log(`  ${k.best.toFixed(4)}  ${k.name.padEnd(26)} ${k.sizeGB.toFixed(1).padStart(5)} GB  — ${k.reasons.join(', ')}`));

  const freed = removable.reduce((s, r) => s + r.sizeGB, 0);
  log(`\n══ KANDIDÁTI NA SMAZÁNÍ (${removable.length}, ${freed.toFixed(1)} GB) ══`);
  if (removable.length === 0) {
    log('  žádní — každý model je navázaný, v top-3, nebo byl použit');
  } else {
    removable.forEach(r =>
      log(`  ${r.best.toFixed(4)}  ${r.name.padEnd(26)} ${r.sizeGB.toFixed(1).padStart(5)} GB`));
    log(`\n  ollama rm ${removable.map(r => r.name).join(' ')}`);
  }
  if (!DO_VALIDATE && persistedCount < local.length) {
    log(`\nPozn.: ${local.length - persistedCount} modelů nemá platný výsledek validace,`);
    log('       jejich pořadí stojí jen na benchmarkovém podkladu — u části odhadnutém.');
    log('       Před mazáním doporučuji `--validate`.');
  }
}
