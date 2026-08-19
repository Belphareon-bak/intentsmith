// Catalog Enrichment — doplnění metadat lokálním (nainstalovaným) modelům
// ══════════════════════════════════════════════════════════════════════════════
//
// Ollama /api/tags vrací pouze jméno, velikost a základní `details`.  Ranker ale
// skóruje z `benchmarks`, `releaseDate` a `baseVramMb`.  Bez doplnění je u
// lokálního modelu 88 % váhy skóre nulové nebo konstantní (benchmark 0,
// hardwareFit i maturity spadnou na fallback 0.5, generation 0) a reálně
// rozhoduje jen `speed`, tedy inverzní funkce velikosti.  Menší model pak vyhraje
// vždy a každý návrh zní „nahraď modelem, který nemáš“.
//
// Tento modul doplní lokálním kandidátům stejná pole, jaká nese katalogová
// položka, ve třech krocích:
//
//   1. přesná shoda podle lookup klíče       → benchmarkConfidence 1.00
//   2. interpolace uvnitř rodiny (estimator) → benchmarkConfidence dle estimátoru
//   3. nic z toho                            → kandidát zůstane neobohacený
//
// ── Lookup klíč není identita vazby ──────────────────────────────────────────
//
// `model-identity.js` schválně nedělá shodu podle rodiny ani velikosti, protože
// jeho `canonicalModelName()` autorizuje failover a ověření claimu.  Zde je
// potřeba volnější klíč: Ollama píše `deepseek-r1-32b`, katalog `deepseek-r1:32b`.
// Proto má tento modul vlastní `catalogLookupKey()`, který se používá **výhradně**
// pro dohledání metadat ke skórování.  Nikdy jím neautorizuj vazbu ani failover.
//
// ══════════════════════════════════════════════════════════════════════════════

import {
  buildFamilyScalingModels,
  estimateBenchmarks,
  estimateVram,
  inheritFromNearest,
} from './benchmark-estimator.js';

/**
 * Klíč pro dohledání katalogové položky ke stejnému logickému modelu.
 *
 * Sjednocuje oddělovač velikosti: `name-32b` i `name:32b` dají `name:32b`.
 * Zahodí `:latest`.  Modely bez velikosti v názvu (`glm-4.7-flash`) projdou
 * beze změny.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function catalogLookupKey(value) {
  if (typeof value !== 'string') return null;
  let key = value.trim().toLowerCase();
  if (!key) return null;
  if (key.endsWith(':latest')) key = key.slice(0, -':latest'.length).trimEnd();
  if (!key) return null;

  // Sjednoť oddělovač před prvním údajem o velikosti: `-32b` / `:32b` → `:32b`.
  // `qwen3-30b-a3b` → `qwen3:30b-a3b`, `deepseek-r1-32b` → `deepseek-r1:32b`.
  const sizeMatch = key.match(/^(.*?)[-:](\d+(?:\.\d+)?b(?:[-_].*)?)$/);
  if (sizeMatch && sizeMatch[1]) {
    key = `${sizeMatch[1]}:${sizeMatch[2]}`;
  }
  return key;
}

/**
 * Index katalogu podle lookup klíče.  První zápis vyhrává, takže pořadí položek
 * v katalogu zůstává rozhodující a duplicitní zápis nepřepíše přesnější.
 *
 * @param {Array} catalog
 * @returns {Map<string, Object>}
 */
export function buildCatalogIndex(catalog) {
  const index = new Map();
  if (!Array.isArray(catalog)) return index;
  for (const entry of catalog) {
    const key = catalogLookupKey(entry?.name);
    if (key && !index.has(key)) index.set(key, entry);
  }
  return index;
}

/**
 * Pole, která kandidát přebírá z katalogu.  Doplňuje se jen to, co kandidát
 * ještě nemá — údaj zjištěný přímo z Ollama (skutečná velikost, kvantizace)
 * je přesnější než katalogový odhad a nesmí být přepsán.
 */
function applyEntry(candidate, entry, confidence, source) {
  candidate.benchmarks = entry.benchmarks ?? candidate.benchmarks;
  candidate.releaseDate = entry.releaseDate ?? candidate.releaseDate ?? null;
  candidate.baseVramMb = candidate.baseVramMb ?? entry.baseVramMb ?? null;
  candidate.contextWindow = candidate.contextWindow ?? entry.contextWindow ?? null;
  candidate.capabilities = candidate.capabilities ?? entry.capabilities ?? null;
  candidate.architecture = candidate.architecture ?? entry.architecture ?? null;
  candidate.supersedes = candidate.supersedes ?? entry.supersedes ?? null;
  if (!candidate.params && entry.params) candidate.params = entry.params;
  if (candidate.category === 'unknown' && entry.category) candidate.category = entry.category;
  candidate.benchmarkConfidence = confidence;
  candidate.enrichmentSource = source;
}

/**
 * Doplní lokálním kandidátům katalogová metadata.
 *
 * Mutuje předané kandidáty na místě a vrací souhrn pro logování.
 *
 * @param {Array<Object>} candidates - lokální kandidáti z buildCandidates()
 * @param {Array<Object>} catalog - CATALOG z model-catalog.js
 * @returns {{ exact: number, estimated: number, unmatched: string[] }}
 */
export function enrichLocalCandidates(candidates, catalog) {
  const summary = { exact: 0, estimated: 0, unmatched: [] };
  if (!Array.isArray(candidates) || candidates.length === 0) return summary;
  if (!Array.isArray(catalog) || catalog.length === 0) {
    summary.unmatched = candidates.map(c => c.name);
    return summary;
  }

  const index = buildCatalogIndex(catalog);
  const scalingModels = buildFamilyScalingModels(catalog);

  for (const candidate of candidates) {
    // 1. Přesná shoda
    const key = catalogLookupKey(candidate.name);
    const exact = key ? index.get(key) : null;
    if (exact) {
      // Katalogová položka smí sama přiznat, že její čísla jsou odhad
      // (`benchmarkConfidence`).  Ranker tím benchmarkovou složku utlumí,
      // dokud ji nepřebije validační běh nebo L5 enrichment.
      const confidence = typeof exact.benchmarkConfidence === 'number'
        ? Math.max(0, Math.min(1, exact.benchmarkConfidence))
        : 1.0;
      applyEntry(candidate, exact, confidence, 'catalog-exact');
      summary.exact++;
      continue;
    }

    // 2. Interpolace uvnitř rodiny
    const { benchmarks, confidence } = estimateBenchmarks(
      candidate.family,
      candidate.params,
      scalingModels,
    );
    if (benchmarks && confidence > 0) {
      const nearest = inheritFromNearest(candidate.family, candidate.params, scalingModels) || {};
      applyEntry(
        candidate,
        {
          benchmarks,
          // Datum vydání se neinterpoluje — neznámé stáří nesmí předstírat
          // zralost. Ranker si na chybějící releaseDate sáhne na fallback.
          releaseDate: null,
          baseVramMb: estimateVram(candidate.params) || null,
          contextWindow: nearest.contextWindow ?? null,
          capabilities: nearest.capabilities ?? null,
          category: nearest.category ?? null,
          params: candidate.params,
        },
        confidence,
        'family-scaling',
      );
      summary.estimated++;
      continue;
    }

    // 3. Bez podkladu — ať je v logu vidět, co katalogu chybí
    summary.unmatched.push(candidate.name);
  }

  return summary;
}

export default { catalogLookupKey, buildCatalogIndex, enrichLocalCandidates };
