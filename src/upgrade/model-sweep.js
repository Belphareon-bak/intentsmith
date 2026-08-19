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
const _tagsCache = new Map();

async function fetchText(url) {
  const res = await fetch(url, {
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
 *   - externí hodnocení (whatllm qualityIndex) proti stávajícímu modelu
 *   - datum vydání z HuggingFace: starší než to, co už mám, nemá smysl zkoušet
 *   - pohodlnost velikosti: co se vejde s rezervou, je lepší kandidát než to,
 *     co projde předfiltrem jen těsně
 *
 * @returns {Array<{name, family, sizeGB, quality, releaseDate, priority, reasons}>}
 */
export function rankCandidates(pool, ctx = {}) {
  const {
    vramMb = 0,
    installed = [],
    incumbentQuality = null,
    qualityOf = () => null,
    releaseDateOf = () => null,
    incumbentReleaseDate = null,
  } = ctx;

  const installedKeys = new Set(installed.map(canonicalModelName).filter(Boolean));
  const out = [];

  for (const entry of pool) {
    const key = canonicalModelName(entry.name);
    if (key && installedKeys.has(key)) continue;
    if (!mightFit(entry.sizeGB, vramMb)) continue;

    const quality = qualityOf(entry) ?? null;
    const releaseDate = releaseDateOf(entry) ?? null;
    const reasons = [];

    // Externí hodnocení, když je: horší než stávající se nezkouší.
    if (quality != null && incumbentQuality != null) {
      if (quality <= incumbentQuality) continue;
      reasons.push(`externí hodnocení ${quality} > ${incumbentQuality}`);
    }

    // Starší model než ten, který mám, nemá co nabídnout.
    if (releaseDate && incumbentReleaseDate
      && Date.parse(releaseDate) <= Date.parse(incumbentReleaseDate)) {
      continue;
    }
    if (releaseDate) reasons.push(`vydáno ${releaseDate}`);

    // Priorita: externí hodnocení dominuje, novost a pohodlná velikost dolaďují.
    let priority = 0;
    if (quality != null) priority += quality;
    if (releaseDate) {
      const ageDays = (Date.now() - Date.parse(releaseDate)) / 86400000;
      if (Number.isFinite(ageDays)) priority += Math.max(0, 12 - ageDays / 30);
    }
    if (comfortablyFits(entry.sizeGB, vramMb)) {
      priority += 3;
      reasons.push('vejde se s rezervou');
    } else {
      reasons.push('velikost těsná — rozhodne měření');
    }

    out.push({ ...entry, quality, releaseDate, priority: Math.round(priority * 100) / 100, reasons });
  }

  out.sort((a, b) => b.priority - a.priority || a.sizeGB - b.sizeGB);
  return out;
}

export function clearCache() {
  _familiesCache = null;
  _familiesAt = 0;
  _tagsCache.clear();
}

export default {
  fetchLibraryFamilies, fetchFamilyTags, parseTagsPage,
  mightFit, comfortablyFits, rankCandidates, preferredTagForFamily, formatRunsHere, clearCache,
  MIN_OBSERVED_VRAM_OVERHEAD, TYPICAL_VRAM_OVERHEAD,
};
