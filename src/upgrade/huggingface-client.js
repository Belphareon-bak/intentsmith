// HuggingFace Client — druhý, nezávislý zdroj faktů o modelech
// ══════════════════════════════════════════════════════════════════════════════
//
// Proč vůbec:
//
// Do 2026-08-19 stála kvalitativní data celého scoringu na jediném externím
// zdroji (whatllm.org).  `ollama.com/library` odpovídá jen na „existuje tenhle
// model a jaké má tagy", žádnou kvalitu nenese, takže fallback neexistoval —
// výpadek nebo změna formátu whatllm.org tiše shodí veškeré obohacení.
//
// Co tenhle modul přidává a co ne:
//
//   ANO  releaseDate  — `createdAt` je ověřitelný fakt a přímo živí `maturity`
//                       (15 % váhy) a `generation` bonus (10 %).  Katalog ho u
//                       části položek nemá vůbec.
//   ANO  schopnosti   — `pipeline_tag` rozliší multimodální model od textového
//                       nezávisle na hádání z názvu.  `Qwen/Qwen3.5-27B` je
//                       `image-text-to-text`, což z názvu `qwen3.5:27b` nepoznáš.
//   ANO  adopce       — stažení a lajky jako *korroborační* signál.
//   NE   benchmarky   — popularita není kvalita.  Starší model má víc stažení
//                       jen proto, že je déle venku, a kvantizované forky mají
//                       vlastní čísla.  Kdyby se z adopce dělalo skóre, vznikla
//                       by táž třída vady jako u míchání whatllm a katalogu.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

const HF_API = 'https://huggingface.co/api/models';
const FETCH_TIMEOUT = 15_000;
const CACHE_TTL = 24 * 3600 * 1000;
const ERROR_COOLDOWN = 3600 * 1000;

/** Jistota pro fakta z HF: ověřitelná metadata, ale ne měření kvality. */
export const HUGGINGFACE_CONFIDENCE = 0.80;

/** Markery kvantizovaných a odvozených repozitářů — nejsou zdrojem pravdy. */
const DERIVED_MARKERS = /(gguf|awq|gptq|fp8|fp4|mlx|int4|int8|\d+bit|-bit|imat|quant|onnx|openvino|distill-gguf)/i;

/** Známí vydavatelé — repozitář od nich má přednost před komunitním forkem. */
const CANONICAL_ORGS = new Set([
  'qwen', 'deepseek-ai', 'meta-llama', 'mistralai', 'microsoft', 'google',
  'llava-hf', 'ibm-granite', 'zai-org', 'thudm', 'allenai', 'nvidia',
  'moonshotai', 'internlm', '01-ai', 'stabilityai',
]);

/** `pipeline_tag`, které znamenají zpracování obrazu. */
const VISION_PIPELINES = new Set([
  'image-text-to-text', 'image-to-text', 'visual-question-answering',
  'video-text-to-text',
]);

let _cache = new Map();
let _lastError = 0;

function isOffline() {
  return _lastError > 0 && Date.now() - _lastError < ERROR_COOLDOWN;
}

async function hfFetch(url) {
  if (isOffline()) return null;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      headers: { 'User-Agent': 'intentsmith/1.0', Accept: 'application/json' },
    });
    if (!res.ok) {
      if (res.status >= 500) _lastError = Date.now();
      return null;
    }
    _lastError = 0;
    return await res.json();
  } catch (err) {
    _lastError = Date.now();
    logger.warn('HuggingFace', `Dotaz selhal: ${err.message}`);
    return null;
  }
}

/**
 * Dotaz, kterým se model hledá.  Z Ollama jména `qwen2.5-coder:32b` udělá
 * `qwen2.5-coder 32b` — tečka i pomlčka ve jménu rodiny se zachovají, protože
 * odlišují generace (`qwen2.5` vs `qwen3`).
 */
export function buildSearchQuery(ollamaName) {
  if (typeof ollamaName !== 'string') return null;
  const lower = ollamaName.trim().toLowerCase();
  if (!lower) return null;
  const [base, tag] = lower.split(':');
  if (!base) return null;
  const size = (tag && tag !== 'latest') ? tag.replace(/-.*$/, '') : '';
  return size ? `${base} ${size}` : base;
}

/**
 * Vybere z výsledků hledání kanonický repozitář.
 *
 * Pořadí je záměrné: odvozené repozitáře (GGUF, AWQ, …) mají často víc stažení
 * než originál, takže samotné řazení podle popularity by vrátilo kvantizovaný
 * fork a s ním i jeho `createdAt` — tedy datum kvantizace, ne vydání modelu.
 */
export function pickCanonicalRepo(results) {
  if (!Array.isArray(results) || results.length === 0) return null;

  const scored = results.map(entry => {
    const id = entry?.id || '';
    const org = id.split('/')[0]?.toLowerCase() || '';
    return {
      entry,
      derived: DERIVED_MARKERS.test(id),
      canonicalOrg: CANONICAL_ORGS.has(org),
      downloads: entry?.downloads || 0,
    };
  });

  scored.sort((a, b) =>
    (a.derived - b.derived)
    || (b.canonicalOrg - a.canonicalOrg)
    || (b.downloads - a.downloads));

  return scored[0]?.entry || null;
}

/**
 * Dohledá na HF metadata k jednomu Ollama modelu.
 *
 * @returns {Promise<{repo, releaseDate, pipelineTag, downloads, likes}|null>}
 */
export async function lookupModel(ollamaName) {
  const query = buildSearchQuery(ollamaName);
  if (!query) return null;

  const cached = _cache.get(query);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.value;

  const url = `${HF_API}?search=${encodeURIComponent(query)}&limit=10&sort=downloads&direction=-1`;
  const results = await hfFetch(url);
  if (!results) return null;

  const picked = pickCanonicalRepo(results);
  const value = picked
    ? {
      repo: picked.id,
      releaseDate: typeof picked.createdAt === 'string' ? picked.createdAt.slice(0, 10) : null,
      pipelineTag: picked.pipeline_tag || null,
      downloads: picked.downloads || 0,
      likes: picked.likes || 0,
    }
    : null;

  _cache.set(query, { at: Date.now(), value });
  return value;
}

/**
 * Doplní kandidátům fakta z HuggingFace.
 *
 * Mutuje kandidáty na místě.  Nikdy nepřepisuje benchmarky — ty zůstávají na
 * katalogu, whatllm a validaci.
 *
 * @returns {Promise<{resolved: number, datesFilled: number, visionFound: number, conflicts: Array}>}
 */
export async function enrichFromHuggingFace(candidates, opts = {}) {
  const summary = { resolved: 0, datesFilled: 0, visionFound: 0, conflicts: [] };
  if (!Array.isArray(candidates) || candidates.length === 0) return summary;

  for (const candidate of candidates) {
    const meta = opts.lookup
      ? await opts.lookup(candidate.name)
      : await lookupModel(candidate.name);
    if (!meta) continue;

    summary.resolved++;
    candidate.hfRepo = meta.repo;
    candidate.adoption = { downloads: meta.downloads, likes: meta.likes };

    // Datum vydání: doplnit, když chybí; při rozporu s katalogem nepřepisovat,
    // ale nahlásit — ruční katalog je revidovaný a rozpor je informace.
    if (meta.releaseDate) {
      if (!candidate.releaseDate) {
        candidate.releaseDate = meta.releaseDate;
        candidate.releaseDateSource = 'huggingface';
        summary.datesFilled++;
      } else {
        const days = Math.abs(Date.parse(candidate.releaseDate) - Date.parse(meta.releaseDate))
          / 86400000;
        if (Number.isFinite(days) && days > 90) {
          summary.conflicts.push({
            model: candidate.name,
            field: 'releaseDate',
            catalog: candidate.releaseDate,
            huggingface: meta.releaseDate,
            repo: meta.repo,
          });
        }
      }
    }

    // Schopnost zpracovat obraz je fakt z metadat, ne odhad z názvu.
    if (meta.pipelineTag && VISION_PIPELINES.has(meta.pipelineTag)) {
      const caps = new Set(candidate.capabilities || []);
      if (!caps.has('vision')) {
        caps.add('vision');
        candidate.capabilities = [...caps];
        summary.visionFound++;
        if (candidate.category && candidate.category !== 'vision') {
          summary.conflicts.push({
            model: candidate.name,
            field: 'category',
            catalog: candidate.category,
            huggingface: meta.pipelineTag,
            repo: meta.repo,
          });
        }
      }
    }
  }

  if (summary.conflicts.length > 0) {
    logger.warn('HuggingFace',
      `Rozpor mezi katalogem a HF u ${summary.conflicts.length} modelů: `
      + summary.conflicts.map(c => `${c.model}/${c.field}`).join(', '));
  }
  if (summary.resolved > 0) {
    logger.info('HuggingFace',
      `Dohledáno ${summary.resolved}/${candidates.length}, doplněno dat vydání: ${summary.datesFilled}, nalezena vision schopnost: ${summary.visionFound}`);
  }

  return summary;
}

export function clearCache() {
  _cache = new Map();
  _lastError = 0;
}

export default {
  buildSearchQuery, pickCanonicalRepo, lookupModel, enrichFromHuggingFace,
  clearCache, HUGGINGFACE_CONFIDENCE,
};
