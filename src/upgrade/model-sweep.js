// Model Sweep — fáze 0 a 1: vyjmenovat všechno, seřadit bez stahování
// ══════════════════════════════════════════════════════════════════════════════
//
// Proč vzniklo:
//
// L4 discovery se ptalo `ollama.com/library/{rodina}` jen pro rodiny, které už
// jsou nainstalované.  Z 235 rodin na ollama.com se tedy dívalo na 7 a našlo
// výhradně kvantizace a menší varianty toho, co už na disku je
// (`qwen3.5:27b-mlx`, `qwen2.5-coder:3b`).  Novou rodinu nemohlo najít z
// principu — `glm-5.2`, `deepseek-v4-pro`, `kimi-k3`, `llama4`, `gemma4` ani
// `gpt-oss` nikdy neviděl.
//
// Tenhle modul dělá dvě věci, obě **bez jediného stažení**:
//
//   fáze 0  vyjmenuje všechny rodiny a jejich tagy z ollama.com
//   fáze 1  seřadí je podle externích signálů a odřízne, co se nemá šanci vejít
//
// Výstupem je krátký seznam kandidátů k vyzkoušení, ne rozhodnutí o kvalitě.
// O kvalitě rozhoduje až měření a validace po stažení.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import {
  modelDiscoveryFetch,
} from '../network/outbound-policy.js';
import { canonicalModelName } from './model-identity.js';

const LIBRARY_URL = 'https://ollama.com/library';
const FETCH_TIMEOUT = 20_000;
const CACHE_TTL = 24 * 3600 * 1000;

/**
 * Poměr mezi velikostí ke stažení a skutečnou spotřebou VRAM při 32k kontextu.
 *
 * Naměřeno 2026-08-19 na RTX 3090 (`ollama list` velikost → `/api/ps` size):
 *
 *     llava-llama3:8b       5.5 GB →  5.85 GB   1.06
 *     qwen3-30b-a3b        17   GB → 19.47 GB   1.15
 *     llava:13b             8.0 GB → 10.26 GB   1.28
 *     qwen3.5:27b          17   GB → 23.30 GB   1.37
 *     qwen3:14b             9.3 GB → 13.92 GB   1.50
 *     qwen2.5:32b          19   GB → 29.28 GB   1.54
 *     deepseek-r1-32b      18   GB → 28.29 GB   1.57
 *
 * Rozptyl 1.06–1.57 je moc velký na to, aby se z něj dalo rozhodovat — proto
 * je předfiltr **záměrně shovívavý** a používá nejnižší pozorovaný poměr.
 * Pustí dál i kandidáty, kteří se nakonec nevejdou; to je levné, protože je
 * odmítne měření.  Opačná chyba by byla drahá: zahodit model, který by se vešel.
 */
export const MIN_OBSERVED_VRAM_OVERHEAD = 1.06;
export const TYPICAL_VRAM_OVERHEAD = 1.37;

/** Tagy, které nejsou lokálním modelem ke stažení. */
const NON_LOCAL_TAGS = /^(cloud|latest-cloud)$/i;

/**
 * Agresivní kvantizace, které kvalitu snižují záměrně.
 *
 * Q2 a Q3 obětují přesnost za velikost natolik, že model přestává být tímtéž
 * modelem — brát je jako kandidáty na upgrade nedává smysl, protože soutěží
 * jinou vlastností, než kterou hledáme.  Q4 a výš se nechávají projít.
 */
const DEGRADED_QUANT = /(^|[-_])(q2|q3|iq1|iq2|iq3)([-_]|$)/i;

/**
 * Formáty vázané na konkrétní hardware.
 *
 * MLX je formát pro Apple Silicon a na NVIDII ani AMD se nespustí; NVFP4
 * vyžaduje Blackwell.  Bez tohoto filtru se do fronty dostane kandidát, který
 * se stáhne (desítky GB) a teprve pak se ukáže, že ho běhové prostředí neumí.
 */
const HARDWARE_BOUND_FORMATS = [
  { pattern: /(^|[-_])mlx([-_]|$)/i, vendors: ['apple'], label: 'MLX (Apple Silicon)' },
  { pattern: /(^|[-_])nvfp4([-_]|$)/i, vendors: ['nvidia-blackwell'], label: 'NVFP4 (Blackwell)' },
];

/**
 * Umí tenhle stroj daný formát?  `vendor` se odvozuje z názvu GPU, takže na
 * neznámém hardwaru se nefiltruje nic a rozhodne až pokus o spuštění.
 */
export function formatRunsHere(tag, gpuModel = '') {
  const gpu = String(gpuModel).toLowerCase();
  const isApple = /apple|m[1-9]\s*(pro|max|ultra)?/.test(gpu);
  const isBlackwell = /rtx\s*50\d\d|b\d{3}\b|blackwell/.test(gpu);
  for (const fmt of HARDWARE_BOUND_FORMATS) {
    if (!fmt.pattern.test(tag)) continue;
    if (fmt.vendors.includes('apple') && isApple) return true;
    if (fmt.vendors.includes('nvidia-blackwell') && isBlackwell) return true;
    return false;
  }
  return true;
}

/**
 * Preferovaná varianta v rámci rodiny.
 *
 * Ze všech tagů, které se můžou vejít, se vybírá největší — víc parametrů při
 * stejné rodině obvykle znamená lepší model, a jestli se opravdu vejde,
 * rozhodne až měření.  Tagy s explicitní agresivní kvantizací se vynechávají.
 */
export function preferredTagForFamily(tags, vramMb, gpuModel = '') {
  const usable = (tags || [])
    .filter(t => !DEGRADED_QUANT.test(t.tag))
    .filter(t => formatRunsHere(t.tag, gpuModel))
    .filter(t => mightFit(t.sizeGB, vramMb));
  if (usable.length === 0) return null;
  return usable.reduce((a, b) => (b.sizeGB > a.sizeGB ? b : a));
}

let _familiesCache = null;
let _familiesAt = 0;
let _familyMetadata = new Map();
const _tagsCache = new Map();

const RELATIVE_AGE_DAYS = Object.freeze({
  day: 1, days: 1, week: 7, weeks: 7,
  month: 30, months: 30, year: 365, years: 365,
});

export function parseLibraryFamilyMetadata(html) {
  const anchors = [...String(html || '').matchAll(/href="\/library\/([a-z0-9._-]+)"/gi)];
  const out = new Map();
  for (let index = 0; index < anchors.length; index++) {
    const family = anchors[index][1].toLowerCase();
    const start = anchors[index].index ?? 0;
    const end = anchors[index + 1]?.index ?? String(html || '').length;
    const block = String(html || '').slice(start, end);
    const age = /<span[^>]*>\s*(\d+)\s+(day|days|week|weeks|month|months|year|years)\s+ago\s*<\/span>/i.exec(block);
    const description = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(block)?.[1]
      ?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null;
    const count = Number(age?.[1]);
    const unit = age?.[2]?.toLowerCase();
    const updatedDays = Number.isFinite(count) && RELATIVE_AGE_DAYS[unit]
      ? count * RELATIVE_AGE_DAYS[unit]
      : null;
    const previous = out.get(family);
    if (!previous || (updatedDays != null && (previous.updatedDays == null || updatedDays < previous.updatedDays))) {
      out.set(family, Object.freeze({
        family,
        updatedLabel: age ? `${count} ${unit} ago` : null,
        updatedDays,
        description,
      }));
    }
  }
  return out;
}

export function getLibraryFamilyMetadata() {
  return new Map(_familyMetadata);
}

async function fetchText(url) {
  const res = await modelDiscoveryFetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
    headers: { 'User-Agent': 'intentsmith/1.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/**
 * Fáze 0 — všechny rodiny v knihovně Ollamy.
 */
export async function fetchLibraryFamilies(opts = {}) {
  if (!opts.force && _familiesCache && Date.now() - _familiesAt < CACHE_TTL) {
    return _familiesCache;
  }
  try {
    const html = opts.html ?? await fetchText(LIBRARY_URL);
    _familyMetadata = parseLibraryFamilyMetadata(html);
    const found = new Set();
    for (const m of html.matchAll(/href="\/library\/([a-z0-9._-]+)"/gi)) {
      found.add(m[1].toLowerCase());
    }
    _familiesCache = [...found].sort();
    _familiesAt = Date.now();
    logger.info('ModelSweep', `Knihovna Ollamy: ${_familiesCache.length} rodin`);
    return _familiesCache;
  } catch (err) {
    logger.warn('ModelSweep', `Seznam rodin se nepodařilo načíst: ${err.message}`);
    return _familiesCache || [];
  }
}

/**
 * Rozparsuje stránku s tagy na dvojice tag → velikost.
 *
 * Jméno tagu se na stránce opakuje vícekrát a velikost stojí za ním, takže se
 * prochází v pořadí výskytu a každému tagu se přiřadí nejbližší následující
 * velikost.
 */
export function parseTagsPage(family, html) {
  if (!html || !family) return [];
  const escaped = family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const token = new RegExp(`(${escaped}:[a-z0-9._-]+)|(\\d+(?:\\.\\d+)?)\\s*(GB|TB)`, 'gi');

  const out = new Map();
  let pendingTag = null;
  for (const m of html.matchAll(token)) {
    if (m[1]) {
      pendingTag = m[1].toLowerCase();
    } else if (pendingTag) {
      const value = parseFloat(m[2]);
      const sizeGB = /TB/i.test(m[3]) ? value * 1024 : value;
      const tag = pendingTag.split(':')[1];
      if (!NON_LOCAL_TAGS.test(tag) && !out.has(pendingTag)) {
        out.set(pendingTag, { name: pendingTag, family, tag, sizeGB });
      }
      pendingTag = null;
    }
  }
  return [...out.values()];
}

/** Tagy jedné rodiny, s cache. */
export async function fetchFamilyTags(family, opts = {}) {
  const cached = _tagsCache.get(family);
  if (!opts.force && cached && Date.now() - cached.at < CACHE_TTL) return cached.tags;
  try {
    const html = opts.html ?? await fetchText(`${LIBRARY_URL}/${encodeURIComponent(family)}/tags`);
    const tags = parseTagsPage(family, html);
    _tagsCache.set(family, { at: Date.now(), tags });
    return tags;
  } catch (err) {
    logger.warn('ModelSweep', `Tagy rodiny ${family} se nepodařilo načíst: ${err.message}`);
    return cached?.tags || [];
  }
}

/**
 * Vejde se model podle **předfiltru**?  Není to rozhodnutí, jen odhad, který
 * má být shovívavý — viz MIN_OBSERVED_VRAM_OVERHEAD.
 */
export function mightFit(sizeGB, vramMb) {
  if (!sizeGB || !vramMb) return false;
  const vramGB = vramMb / 1024;
  return sizeGB * MIN_OBSERVED_VRAM_OVERHEAD <= vramGB;
}

/** Odhad, jestli se vejde i s obvyklou režií — použije se jen k řazení. */
export function comfortablyFits(sizeGB, vramMb) {
  if (!sizeGB || !vramMb) return false;
  return sizeGB * TYPICAL_VRAM_OVERHEAD <= vramMb / 1024;
}

/**
 * Fáze 1 — seřadí kandidáty podle externích signálů.
 *
 * Priorita **není** kvalita, ale pořadí, ve kterém se vyplatí kandidáty zkoušet:
 * čím výš, tím větší šance, že se stažení a test vyplatí.  Vstupují do ní:
 *
 *   - externí discovery signál (whatllm qualityIndex), pouze pro pořadí
 *   - datum vydání z HuggingFace, pouze pro pořadí
 *   - pohodlnost velikosti: co se vejde s rezervou, je lepší kandidát než to,
 *     co projde předfiltrem jen těsně
 *
 * @returns {Array<{name, family, sizeGB, externalSignal, releaseDate, priority, reasons}>}
 */
export function prioritizeCandidates(pool, ctx = {}) {
  const {
    vramMb = 0,
    installed = [],
    externalSignalOf = () => null,
    releaseDateOf = () => null,
    // Role, pro kterou se seznam staví.  Když je zadaná, uplatní se filtr
    // způsobilosti a bonus za shodu specializace — bez ní by vznikl jeden
    // univerzální seznam, což je špatná otázka: nehledá se jeden nejlepší
    // model, ale nejlepší model pro každou roli zvlášť.
    role = null,
    eligibilityOf = null,
    profileOf = null,
    // Kategorie, které jsou pro roli obvykle nejzajímavější —
    // `MODEL_PROFILES[role].preferredCategories`. Jde pouze o pořadí. Tvrdou
    // technickou způsobilost rozhoduje výhradně `eligibilityOf`; coder model
    // proto smí být změřen i pro CHAT a vision model pro textovou roli.
    preferredCategories = null,
  } = ctx;

  const installedKeys = new Set(installed.map(canonicalModelName).filter(Boolean));
  const out = [];

  for (const entry of pool) {
    const key = canonicalModelName(entry.name);
    if (key && installedKeys.has(key)) continue;
    if (!mightFit(entry.sizeGB, vramMb)) continue;

    // Nezpůsobilý kandidát se do seznamu role vůbec nedostane — vision role
    // nemá co nabídnout textovému modelu a naopak.
    let ineligibleReason = null;
    if (role && eligibilityOf) {
      const verdict = eligibilityOf(entry, role);
      if (verdict && !verdict.eligible) ineligibleReason = verdict.reason;
    }
    if (ineligibleReason) continue;

    const profile = profileOf ? (profileOf(entry) || {}) : {};

    const externalSignal = externalSignalOf(entry) ?? null;
    const releaseDate = releaseDateOf(entry) ?? null;
    const reasons = [];

    if (externalSignal != null) reasons.push(`externí discovery signál ${externalSignal}`);
    if (releaseDate) reasons.push(`vydáno ${releaseDate}`);

    // `Number(null) === 0`; bez explicitní ochrany by rodina bez timestampu
    // dostala falešný signál „aktualizováno dnes“ a předběhla skutečně čerstvé
    // kandidáty.
    const catalogUpdatedDays = entry.catalogUpdatedDays == null
      ? null
      : Number(entry.catalogUpdatedDays);
    if (Number.isFinite(catalogUpdatedDays) && catalogUpdatedDays >= 0) {
      reasons.push(`Ollama aktualizováno ${entry.catalogUpdatedLabel || `${catalogUpdatedDays} dní zpět`}`);
    }

    // Priorita objednává frontu. Nesmí být publikována jako quality score ani
    // vyřadit kandidáta, který prošel faktickými eligibility filtry.
    let priority = 0;
    if (externalSignal != null) priority += externalSignal;
    if (releaseDate) {
      const ageDays = (Date.now() - Date.parse(releaseDate)) / 86400000;
      if (Number.isFinite(ageDays)) priority += Math.max(0, 12 - ageDays / 30);
    }
    // Živý Ollama katalog poskytuje stáří poslední aktualizace i rodinám,
    // které nejsou ve statickém benchmarkovém panelu. Není to důkaz kvality,
    // ale je to silný signál, že dosud netestovaný artefakt stojí za screening.
    if (Number.isFinite(catalogUpdatedDays) && catalogUpdatedDays >= 0) {
      priority += Math.max(0, 16 - catalogUpdatedDays / 15);
    }
    if (comfortablyFits(entry.sizeGB, vramMb)) {
      priority += 3;
      reasons.push('vejde se s rezervou');
    } else {
      reasons.push('velikost těsná — rozhodne měření');
    }

    if (Array.isArray(preferredCategories)
      && profile.category
      && profile.category !== 'unknown'
      && preferredCategories.includes(profile.category)) {
      priority += 2;
      reasons.push(`preferovaná kategorie ${profile.category} pro ${role}`);
    }

    // Shoda specializace s rolí. Coder model do role CODE je lepší kandidát
    // než stejně hodnocený generalista, i když má nižší externí index.
    if (role && profileOf) {
      const bonus = specializationBonus(profile.category, role);
      if (bonus > 0) {
        priority += bonus;
        reasons.push(`specializace ${profile.category} sedí na ${role}`);
      }
    }

    out.push({
      ...entry, role, externalSignal, releaseDate,
      category: entry.category ?? profile.category ?? 'unknown',
      priority: Math.round(priority * 100) / 100,
      reasons,
    });
  }

  out.sort((a, b) => b.priority - a.priority || a.sizeGB - b.sizeGB);
  return out;
}

/**
 * Bonus za shodu specializace modelu s rolí.
 *
 * Násobky bodů priority, ne skóre kvality — ovlivňuje jen pořadí, ve kterém se
 * kandidáti zkoušejí, ne kdo vyhraje souboj.
 */
export function specializationBonus(category, role) {
  if (!category || !role) return 0;
  if (category === 'code' && role === 'CODE') return 8;
  if (category === 'reasoning' && (role === 'D1' || role === 'R1')) return 8;
  if (category === 'vision' && role === 'VISION') return 8;
  if (category === 'general' && (role === 'CHAT' || role === 'D2' || role === 'R2')) return 4;
  return 0;
}

/**
 * Stáhne tagy pro všechny rodiny s omezenou souběžností.
 *
 * Pool se **nesmí** omezit na rodiny, které hodnotí whatllm.  Ten hodnotí 17 z
 * 235 rodin a mezi nimi není jediný vision model — role VISION by tak nikdy
 * nemohla dostat kandidáta.  Externí hodnocení je signál pro řazení, ne
 * podmínka vstupu.
 *
 * @param {string[]} families
 * @param {{vramMb:number, gpuModel?:string, concurrency?:number, onProgress?:Function}} opts
 * @returns {Promise<Array>} po jedné nejlepší variantě na rodinu
 */
export async function buildCandidatePool(families, opts = {}) {
  const { vramMb = 0, gpuModel = '', concurrency = 6, onProgress } = opts;
  const list = [...families];
  const pool = [];
  let done = 0;

  async function worker() {
    while (list.length > 0) {
      const family = list.shift();
      if (!family) break;
      const tags = await fetchFamilyTags(family, opts);
      const best = preferredTagForFamily(tags, vramMb, gpuModel);
      if (best) {
        const metadata = opts.familyMetadata?.get?.(family) || null;
        pool.push({
          ...best,
          catalogUpdatedDays: metadata?.updatedDays ?? null,
          catalogUpdatedLabel: metadata?.updatedLabel ?? null,
          catalogDescription: metadata?.description ?? null,
        });
      }
      done++;
      if (onProgress && done % 25 === 0) onProgress(done, families.length);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  pool.sort((a, b) => a.family.localeCompare(b.family));
  return pool;
}

export function clearCache() {
  _familiesCache = null;
  _familiesAt = 0;
  _familyMetadata = new Map();
  _tagsCache.clear();
}

export default {
  fetchLibraryFamilies, fetchFamilyTags, parseTagsPage,
  parseLibraryFamilyMetadata, getLibraryFamilyMetadata,
  mightFit, comfortablyFits, prioritizeCandidates, preferredTagForFamily, buildCandidatePool,
  formatRunsHere, specializationBonus, clearCache,
  MIN_OBSERVED_VRAM_OVERHEAD, TYPICAL_VRAM_OVERHEAD,
};
