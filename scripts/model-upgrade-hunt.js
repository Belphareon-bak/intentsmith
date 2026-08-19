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
//   node scripts/model-upgrade-hunt.js --run --limit=3      zkusí 3 nejlepší kandidáty
//   node scripts/model-upgrade-hunt.js --run --only=qwen3.8:27b
//   node scripts/model-upgrade-hunt.js --shortlist --json
//
// Bez `--run` skript nic nestahuje ani nemaže.
//
// ══════════════════════════════════════════════════════════════════════════════

import Database from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { config } from '../src/config.js';
import { logger } from '../src/core/logger.js';
import { fetchLibraryFamilies, fetchFamilyTags, rankCandidates, preferredTagForFamily } from '../src/upgrade/model-sweep.js';
import { fetchModels as fetchWhatllm, matchModels } from '../src/upgrade/whatllm-client.js';
import { lookupModel as lookupHf } from '../src/upgrade/huggingface-client.js';
import { measureModel, drainResident } from '../src/upgrade/vram-measurement.js';
import { tryCandidate } from '../src/upgrade/candidate-trial.js';
import { validationRunner } from '../src/upgrade/validation-suites.js';
import { fetchInstalledModels, buildCandidates } from '../src/upgrade/model-discovery.js';
import { canonicalModelName } from '../src/upgrade/model-identity.js';

const args = process.argv.slice(2);
const flag = n => args.includes(`--${n}`);
const val = n => { const h = args.find(a => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : null; };

const DO_RUN = flag('run');
const AS_JSON = flag('json');
const LIMIT = parseInt(val('limit') || '3', 10);
const ONLY = (val('only') || '').split(',').map(s => s.trim()).filter(Boolean);
const ROLES = Object.keys(config.models);

const log = (...a) => { if (!AS_JSON) console.log(...a); };

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
      return { vramMb: gpu.vram_mb || 0, model: gpu.gpu_model, igpu: gpu.is_igpu };
    }
  } catch { /* bez detekce se jede jen na měření */ }
  return { vramMb: 0, model: 'neznámá', igpu: false };
}

// ─── Fáze 0 + 1 ─────────────────────────────────────────────────────────────

async function buildShortlist(gpu, installedNames) {
  const families = await fetchLibraryFamilies();
  log(`Fáze 0: ${families.length} rodin v knihovně Ollamy`);

  const whatllm = await fetchWhatllm().catch(() => []);
  const qualityByFamily = new Map();
  if (whatllm.length) {
    // Nejlepší hodnocení, které rodina má — kandidát se poměřuje jím.
    const probe = families.map(f => ({ name: `${f}:1b` }));
    const matched = matchModels(whatllm, probe);
    for (const [probeName, entry] of matched) {
      const fam = probeName.split(':')[0];
      const prev = qualityByFamily.get(fam);
      if (!prev || prev < entry.qualityIndex) qualityByFamily.set(fam, entry.qualityIndex);
    }
  }
  log(`Fáze 1: whatllm zná ${qualityByFamily.size} z nich`);

  // Laťka: nejlepší externí hodnocení mezi tím, co už je nainstalované.
  // Musí se párovat skutečnými jmény, ne odhadem z rodiny — `qwen3-30b-a3b`
  // se páruje na `Qwen3 30B A3B 2507 Instruct`, což z holé rodiny `qwen3`
  // nevyjde.
  let incumbentQuality = null;
  if (whatllm.length) {
    const installedMatched = matchModels(whatllm, installedNames.map(n => ({ name: n })));
    for (const [, entry] of installedMatched) {
      if (incumbentQuality == null || entry.qualityIndex > incumbentQuality) {
        incumbentQuality = entry.qualityIndex;
      }
    }
  }

  const interesting = families.filter(f => qualityByFamily.has(f)
    && (incumbentQuality == null || qualityByFamily.get(f) > incumbentQuality));
  log(`Fáze 1: ${interesting.length} rodin má vyšší hodnocení než nejlepší nainstalovaný (${incumbentQuality ?? '—'})`);

  // Z každé rodiny jedna varianta — největší, která se může vejít. Víc variant
  // téže rodiny by frontu zaplnilo bez přínosu.
  const pool = [];
  for (const family of interesting) {
    const tags = await fetchFamilyTags(family);
    const best = preferredTagForFamily(tags, gpu.vramMb, gpu.model);
    if (best) pool.push(best);
  }
  log(`Fáze 1: ${pool.length} rodin má variantu, která se může vejít`);

  const ranked = rankCandidates(pool, {
    vramMb: gpu.vramMb,
    installed: installedNames,
    incumbentQuality,
    qualityOf: e => qualityByFamily.get(e.family) ?? null,
  });

  return { shortlist: ranked, incumbentQuality, familiesTotal: families.length };
}

// ─── Běh ────────────────────────────────────────────────────────────────────

const gpu = await detectVram();
log(`GPU: ${gpu.model}, ${gpu.vramMb} MB VRAM${gpu.igpu ? ' (integrovaná)' : ''}`);
if (!gpu.vramMb) log('⚠ VRAM se nepodařilo zjistit — předfiltr velikosti se neuplatní, rozhodne měření');

const db = openDb();
validationRunner.setDb(db);

const installed = buildCandidates(await fetchInstalledModels());
const installedNames = installed.map(m => m.name);
log(`Nainstalováno: ${installedNames.length} modelů\n`);

const { shortlist, incumbentQuality, familiesTotal } = await buildShortlist(gpu, installedNames);

let picked = shortlist;
if (ONLY.length) picked = ONLY.map(n => ({ name: n, family: n.split(':')[0], sizeGB: 0, reasons: ['zadáno ručně'] }));

log(`\n══ SHORTLIST (${shortlist.length}) ══`);
shortlist.slice(0, 15).forEach((c, i) =>
  log(`  ${String(i + 1).padStart(2)}. ${c.name.padEnd(26)} ${String(c.sizeGB).padStart(5)} GB  prio ${String(c.priority).padStart(6)}  ${c.reasons.join(', ')}`));
if (!shortlist.length) log('  žádný kandidát neprošel filtrem');

if (!DO_RUN) {
  if (AS_JSON) console.log(JSON.stringify({ gpu, familiesTotal, incumbentQuality, shortlist }, null, 2));
  else log('\n(bez --run se nic nestahuje; --run --limit=N zkusí N nejlepších)');
  process.exit(0);
}

// Referenční rychlost stávajících modelů — potřebná pro rozhodnutí při remíze.
log('\n══ MĚŘENÍ STÁVAJÍCÍCH MODELŮ ══');
const bindings = { ...config.models };
const incumbentSpeed = {};
for (const name of new Set(Object.values(bindings))) {
  const m = await measureModel(name);
  incumbentSpeed[name] = m.throughput?.tokensPerSecond ?? 0;
  const p = m.placement || {};
  log(`  ${name.padEnd(24)} ${m.fits ? 'vejde se' : 'NEVEJDE '} `
    + `${p.sizeBytes ? `${(p.vramBytes / 2 ** 30).toFixed(2)}/${(p.sizeBytes / 2 ** 30).toFixed(2)} GB` : '-'}  `
    + `${incumbentSpeed[name] || '—'} tok/s`);
}
await drainResident();

const queue = picked.slice(0, LIMIT);
log(`\n══ ZKOUŠKA KANDIDÁTŮ (${queue.length}) ══`);

const results = [];
for (const cand of queue) {
  log(`\n─── ${cand.name} ───`);
  const r = await tryCandidate(cand.name, {
    runner: validationRunner,
    roles: ROLES,
    bindings,
    incumbentSpeed,
    onStage: (stage, m, info = {}) => {
      if (stage === 'measured') {
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
    log(`  ✗ ${r.error}${r.removed ? ' → smazán' : ''}`);
    continue;
  }
  const t = r.measurement.throughput?.tokensPerSecond;
  if (r.accepted) {
    const won = Object.entries(r.decisions).filter(([, d]) => d.winner === 'candidate').map(([x]) => x);
    log(`  → PŘIJAT pro role: ${won.join(', ')} (stávající modely zůstávají na disku)`);
    for (const role of won) bindings[role] = cand.name;
    incumbentSpeed[cand.name] = t ?? 0;
  } else {
    log(`  → zamítnut${r.removed ? ', smazán' : ''}`);
  }
}

log('\n══ VÝSLEDEK ══');
for (const role of ROLES) {
  const before = config.models[role];
  const after = bindings[role];
  log(`  ${role.padEnd(7)} ${before === after ? `beze změny (${before})` : `${before} → ${after}`}`);
}
const changed = ROLES.filter(r => config.models[r] !== bindings[r]);
log(changed.length
  ? `\n${changed.length} rolí má lepšího kandidáta. Vazby se nemění automaticky — potvrď je ručně.`
  : '\nŽádný kandidát neporazil stávající modely.');

if (AS_JSON) console.log(JSON.stringify({ gpu, shortlist, results, bindings }, null, 2));
