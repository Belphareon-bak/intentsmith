// VRAM Measurement — naměřené umístění modelu a jeho propustnost
// ══════════════════════════════════════════════════════════════════════════════
//
// Proč měřit, když existuje odhad:
//
// `computeEffectiveVram()` v katalogu odhaduje spotřebu z počtu parametrů a
// kontextu.  Změřeno 2026-08-19 na RTX 3090:
//
//     qwen3.5:27b   odhad 18 500 MB   skutečnost 23 859 MB   (+29 %)
//     qwen2.5:32b   odhad 22 000 MB   skutečnost 29 983 MB   (+36 %)
//
// Odhad tedy podstřeluje o třetinu a jako brána se použít nedá.  Ollama ale
// v `/api/ps` hlásí `size` a `size_vram`; když se liší, leží zbytek modelu na
// CPU.  To je měřený binární fakt nezávislý na výrobci GPU — funguje na NVIDII,
// AMD i bez GPU, takže na detekci hardwaru nestojí nic kritického.
//
// Proč je přetečení diskvalifikace a ne penalizace (změřeno tamtéž):
//
//     llava:13b      10.26/10.26 GB  celý v GPU     81.7 tok/s
//     qwen3:14b      13.92/13.92 GB  celý v GPU     67.1 tok/s
//     qwen3.5:27b    20.61/23.30 GB  2.7 GB na CPU  17.7 tok/s
//     qwen2.5:32b    21.07/29.28 GB  8.2 GB na CPU   6.0 tok/s
//
// Není to plynulé zpomalení, ale propad na hranici použitelnosti.
//
// ══════════════════════════════════════════════════════════════════════════════

import { execFileSync } from 'node:child_process';

import { MODEL_ACTIVITY_OWNER, modelUseAuthority } from './model-use-authority.js';
import { config } from '../config.js';
import { logger } from '../core/logger.js';
import { sameModelName } from './model-identity.js';

const DEFAULT_TIMEOUT = 30_000;
const LOAD_TIMEOUT = 300_000;
const THROUGHPUT_TIMEOUT = 300_000;

/** Prompt pro měření propustnosti — dost dlouhá odpověď, žádná znalostní past. */
const THROUGHPUT_PROMPT = 'Popiš v souvislém odstavci, jak se mění počasí během roku.';
const THROUGHPUT_TOKENS = 160;

/**
 * Kontext, při kterém se měří.
 *
 * Musí odpovídat tomu, na čem se reálně pojede: KV cache roste s kontextem,
 * takže model, který se vejde při 4k, může při 32k přetéct.  Změřeno na
 * `qwen2.5:32b` — 19.41 GB při 4k, 29.28 GB při výchozím kontextu Ollamy.
 *
 * `resolveNumCtx()` v gateway umí kontext podle VRAM sám snížit, ale gate se
 * ptá na jinou otázku: vejde se model při kontextu, který chceme používat?
 * Model, který 32k neuveze, je omezení, i když ho runtime tiše zmenší.
 */
export function intendedNumCtx() {
  return config.compact?.contextWindow || 32768;
}

function baseUrl(opts = {}) {
  return opts.baseUrl || config.ollama?.baseUrl || 'http://127.0.0.1:11434';
}

async function ollama(path, init, timeoutMs, opts = {}) {
  const modelName = init?.body ? JSON.parse(init.body).model : null;
  const lease = modelName ? modelUseAuthority.acquireShared({ modelName, owner: MODEL_ACTIVITY_OWNER.VRAM_ARTIFACT_USE }) : null;
  try {
    const res = await fetch(`${baseUrl(opts)}${path}`, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status} na ${path}`);
    return res.json();
  } finally { lease?.release(); }
}

/**
 * Načte model do paměti.  `num_predict: 1` stačí — cílem je jen vynutit load,
 * ne dostat odpověď.
 *
 * `num_ctx` je podstatný: velikost KV cache roste s kontextem, takže model,
 * který se vejde při 4k, může při 32k přetéct.  Měří se proto při tom kontextu,
 * se kterým se reálně poběží.
 */
export async function loadModel(modelName, opts = {}) {
  const numCtx = opts.numCtx ?? intendedNumCtx();
  await ollama('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelName,
      messages: [{ role: 'user', content: 'ok' }],
      stream: false,
      think: false,
      keep_alive: opts.keepAlive ?? '5m',
      options: { num_predict: 1, num_ctx: numCtx },
    }),
  }, opts.timeout ?? LOAD_TIMEOUT, opts);
  return numCtx;
}

/**
 * Přečte skutečné umístění načteného modelu.
 *
 * @returns {Promise<{loaded: boolean, sizeBytes: number, vramBytes: number,
 *   cpuBytes: number, fullyOnGpu: boolean}|null>}
 */
export async function readPlacement(modelName, opts = {}) {
  const data = await ollama('/api/ps', {}, opts.timeout ?? DEFAULT_TIMEOUT, opts);
  const entry = (data?.models || []).find(m => sameModelName(m?.name, modelName)
    || sameModelName(m?.model, modelName));
  if (!entry) return { loaded: false, sizeBytes: 0, vramBytes: 0, cpuBytes: 0, fullyOnGpu: false };

  const sizeBytes = entry.size || 0;
  const vramBytes = entry.size_vram || 0;
  return {
    loaded: true,
    sizeBytes,
    vramBytes,
    cpuBytes: Math.max(0, sizeBytes - vramBytes),
    // Rovnost je záměrná: Ollama hlásí obě čísla ze stejného výpočtu, takže
    // „celý v GPU" znamená přesnou shodu, ne shodu s tolerancí.
    fullyOnGpu: sizeBytes > 0 && sizeBytes === vramBytes,
  };
}

/**
 * Změří propustnost v tokenech za sekundu z `eval_count` a `eval_duration`,
 * které Ollama vrací u každé odpovědi.  Nepočítá se čas načtení ani prompt —
 * jde o rychlost generování, tedy to, co uživatel vnímá jako odezvu.
 */
export async function measureThroughput(modelName, opts = {}) {
  const numCtx = opts.numCtx ?? intendedNumCtx();
  const data = await ollama('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelName,
      messages: [{ role: 'user', content: opts.prompt || THROUGHPUT_PROMPT }],
      stream: false,
      think: false,
      options: {
        num_predict: opts.tokens ?? THROUGHPUT_TOKENS,
        num_ctx: numCtx,
        temperature: 0.1,
      },
    }),
  }, opts.timeout ?? THROUGHPUT_TIMEOUT, opts);

  const evalCount = data?.eval_count || 0;
  const evalNs = data?.eval_duration || 0;
  if (!evalCount || !evalNs) return { tokensPerSecond: null, tokens: evalCount };
  return {
    tokensPerSecond: Math.round((evalCount / (evalNs / 1e9)) * 10) / 10,
    tokens: evalCount,
  };
}

/**
 * Vypíše všechny modely, které Ollama drží v paměti.
 */
export async function listResident(opts = {}) {
  try {
    const data = await ollama('/api/ps', {}, opts.timeout ?? DEFAULT_TIMEOUT, opts);
    return (data?.models || []).map(m => m.name || m.model).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * NVIDIA compute procesy jsou druhý, host-level signál. Ollama `/api/ps` může
 * při přechodu krátce hlásit prázdno, i když starý llama-server stále vlastní
 * CUDA alokaci. `null` znamená, že host tento signál neposkytuje (AMD/CPU), a
 * drain pak zůstane přenositelně u stabilního Ollama pozorování.
 */
function gpuComputeProcesses() {
  try {
    return execFileSync('nvidia-smi', [
      '--query-compute-apps=pid,process_name', '--format=csv,noheader,nounits',
    ], { encoding: 'utf8', timeout: 5000 })
      .split(/\r?\n/).map(row => row.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

/**
 * Uvolní z paměti všechno a počká, až Ollama skutečně nic nedrží.
 *
 * Bez tohohle kroku se neměří model, ale kontence.  Změřeno: `qwen3.5:27b`
 * vedle jiného rezidentního modelu vyšel 20.61/23.30 GB a 17.7 tok/s, tedy
 * jako přetékající — po vyprázdnění paměti se vejde celý (21.37/21.37 GB) a
 * dává 33.3 tok/s.  Stejný model, dvojnásobný rozdíl, jen podle toho, co
 * zrovna leželo ve VRAM.
 */
export async function drainResident(opts = {}) {
  const deadline = Date.now() + (opts.drainTimeout ?? 60_000);
  const requiredEmptyPolls = opts.drainEmptyPolls ?? 4;
  let emptyPolls = 0;
  while (Date.now() < deadline) {
    const resident = await listResident(opts);
    if (resident.length === 0) {
      const processes = typeof opts.gpuComputeProcesses === 'function'
        ? await opts.gpuComputeProcesses()
        : gpuComputeProcesses();
      // On NVIDIA, an empty API is not enough until the runner disappears
      // from the compute process table. On hosts without nvidia-smi, `null`
      // deliberately falls back to the portable stable-empty API check.
      if (processes === null || processes.length === 0) emptyPolls += 1;
      else emptyPolls = 0;
      // /api/ps can become empty a few seconds before the old llama-server
      // releases its CUDA allocation. Requiring stable emptiness prevents the
      // next load from racing that teardown. The host process check above
      // closes the longer transition observed with large models on NVIDIA.
      if (emptyPolls >= requiredEmptyPolls) return true;
    } else {
      emptyPolls = 0;
      if (opts.allowedDrainModels && resident.some(name => !opts.allowedDrainModels.has(name))) {
        throw Object.assign(new Error('GPU belongs to a model outside this hunt'), { code: 'HUNT_GPU_BUSY' });
      }
      for (const name of resident) await unloadModel(name, opts);
    }
    await new Promise(r => setTimeout(r, opts.drainPollMs ?? 1000));
  }
  logger.warn('VramMeasurement', 'Paměť se nepodařilo vyprázdnit — měření může být zkreslené kontencí');
  return false;
}

/**
 * Kompletní měření jednoho modelu: načíst, zjistit umístění, změřit rychlost.
 *
 * Propustnost se měří jen u modelu, který se celý vešel — u přetékajícího nemá
 * číslo význam pro srovnání, protože neměří model, ale rychlost sběrnice.
 *
 * @returns {Promise<{model, numCtx, placement, throughput, fits, error}>}
 */
export async function measureModel(modelName, opts = {}) {
  const result = {
    model: modelName,
    numCtx: opts.numCtx ?? intendedNumCtx(),
    placement: null,
    throughput: null,
    fits: false,
    error: null,
  };

  let lease;
  try {
    lease = modelUseAuthority.acquireShared({ modelName, owner: MODEL_ACTIVITY_OWNER.VRAM_ARTIFACT_USE });
    // Měří se vždy z prázdné paměti, jinak výsledek popisuje kontenci.
    if (opts.drain !== false && !await drainResident(opts)) {
      result.error = 'GPU se před měřením nepodařilo bezpečně uvolnit';
      return result;
    }
    result.numCtx = await loadModel(modelName, opts);
    const placementDeadline = Date.now() + (opts.placementTimeout ?? 15_000);
    do {
      result.placement = await readPlacement(modelName, opts);
      if (result.placement?.loaded) break;
      await new Promise(r => setTimeout(r, opts.placementPollMs ?? 500));
    } while (Date.now() < placementDeadline);

    if (!result.placement?.loaded) {
      result.error = 'model se nenačetl do paměti';
      return result;
    }

    result.fits = result.placement.fullyOnGpu;
    if (!result.fits) {
      logger.warn('VramMeasurement',
        `${modelName} přetéká: ${(result.placement.cpuBytes / 2 ** 30).toFixed(2)} GB na CPU `
        + `(${(result.placement.vramBytes / 2 ** 30).toFixed(2)}/${(result.placement.sizeBytes / 2 ** 30).toFixed(2)} GB)`);
      return result;
    }

    result.throughput = await measureThroughput(modelName, opts);
  } catch (err) {
    result.error = err.message;
  } finally { lease?.release(); }

  return result;
}

/** Uvolní model z paměti, ať měření dalšího kandidáta nestartuje s plnou VRAM. */
export async function unloadModel(modelName, opts = {}) {
  try {
    await ollama('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: 'user', content: 'ok' }],
        stream: false,
        keep_alive: 0,
        options: { num_predict: 1 },
      }),
    }, opts.timeout ?? DEFAULT_TIMEOUT, opts);
    return true;
  } catch {
    return false;
  }
}

export default {
  loadModel, readPlacement, measureThroughput, measureModel,
  unloadModel, listResident, drainResident, intendedNumCtx,
};
