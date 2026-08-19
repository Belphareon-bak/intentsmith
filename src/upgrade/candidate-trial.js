// Candidate Trial — fáze 2 až 4: stáhnout, změřit, prosít, utkat, rozhodnout
// ══════════════════════════════════════════════════════════════════════════════
//
// Sériový trychtýř, kde je stahování poslední a nejužší krok:
//
//   2a  stáhnout kandidáta            (bez časového limitu — stahování se
//                                      nikdy nepoužívá jako kritérium)
//   2b  změřit umístění ve VRAM       nevejde se celý → konec, smazat
//   2c  kontrola schopnostního minima  ~2 min, binární věci
//   3   souboj se stávajícím po rolích tytéž prompty, marže
//   4   rozhodnout, uklidit
//
// Proč je 2c jen „schopnostní minimum" a ne zkrácené hodnocení kvality:
// nelze poctivě zaručit, že by krátká sada nevyřadila lepší model.  Proto smí
// odmítnout jen to, co je pro roli objektivně nepoužitelné — model, který se
// nenačte, neodpoví, nevrátí vyžádaný JSON nebo neumí česky.  Cokoli, co je
// otázkou kvality, jde vždy do plného souboje.
//
// Na disku leží vždy nejvýš jeden kandidát navíc; poražený se maže hned.
// Nahrazený model se ale **nemaže** — teprve provoz ukáže, jestli byla výměna
// dobrý nápad.
//
// ══════════════════════════════════════════════════════════════════════════════

import { config } from '../config.js';
import { logger } from '../core/logger.js';
import { measureModel, drainResident, unloadModel } from './vram-measurement.js';
import { trialRole } from './pairwise-trial.js';
import { IMPROVEMENT_THRESHOLD } from './model-ranker.js';

const PULL_TIMEOUT = 60 * 60 * 1000;  // hodina; jen pojistka proti zaseknutí
const PROBE_TIMEOUT = 120_000;

function baseUrl(opts = {}) {
  return opts.baseUrl || config.ollama?.baseUrl || 'http://127.0.0.1:11434';
}

/**
 * Stáhne model.  Stahování nemá kvalitativní význam a nesmí být kritériem —
 * timeout je tu jen proto, aby se běh nezasekl navěky.
 */
export async function pullModel(modelName, opts = {}) {
  const res = await fetch(`${baseUrl(opts)}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelName, stream: true }),
    signal: AbortSignal.timeout(opts.timeout ?? PULL_TIMEOUT),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status} při stahování`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lastStatus = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let evt;
      try { evt = JSON.parse(line); } catch { continue; }
      if (evt.error) throw new Error(evt.error);
      if (evt.status && evt.status !== lastStatus) {
        lastStatus = evt.status;
        opts.onProgress?.(evt);
      }
    }
  }
  return true;
}

/** Smaže model z disku. */
export async function removeModel(modelName, opts = {}) {
  try {
    const res = await fetch(`${baseUrl(opts)}/api/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName }),
      signal: AbortSignal.timeout(60_000),
    });
    return res.ok;
  } catch (err) {
    logger.warn('CandidateTrial', `Smazání ${modelName} selhalo: ${err.message}`);
    return false;
  }
}

async function ask(modelName, prompt, opts = {}) {
  const res = await fetch(`${baseUrl(opts)}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelName,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      think: false,
      options: { temperature: 0.1, num_predict: 512, num_ctx: 4096 },
    }),
    signal: AbortSignal.timeout(opts.timeout ?? PROBE_TIMEOUT),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (data?.message?.content || '').trim();
}

/**
 * Kontrola schopnostního minima.
 *
 * Každá položka je binární a jednoznačná — žádná z nich není soud o kvalitě,
 * takže tenhle krok nemůže vyřadit model, který je „jen horší".
 */
export const CAPABILITY_FLOOR = Object.freeze([
  {
    id: 'responds',
    prompt: 'Odpověz jedním slovem: ano.',
    check: text => text.length > 0,
    failure: 'model nevrátil žádnou odpověď',
  },
  {
    id: 'json',
    prompt: 'Vrať POUZE platný JSON bez komentáře a bez markdown bloku: {"stav":"ok","cislo":42}',
    check: (text) => {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return false;
      try { JSON.parse(match[0]); return true; } catch { return false; }
    },
    failure: 'model nevrátil platný JSON, když o něj byl výslovně požádán',
  },
  {
    id: 'czech',
    prompt: 'Odpověz česky jednou větou: proč je obloha modrá?',
    // Diakritika je nejspolehlivější signál — model, který odpoví anglicky
    // nebo přepisem bez háčků, roli CHAT v češtině nezastane.
    check: text => /[áčďéěíňóřšťúůýž]/i.test(text),
    failure: 'model neodpověděl česky',
  },
]);

export async function runCapabilityFloor(modelName, opts = {}) {
  const failures = [];
  for (const probe of (opts.probes || CAPABILITY_FLOOR)) {
    try {
      const answer = await ask(modelName, probe.prompt, opts);
      if (!probe.check(answer)) failures.push({ id: probe.id, reason: probe.failure, answer: answer.slice(0, 120) });
    } catch (err) {
      failures.push({ id: probe.id, reason: `${probe.failure} (${err.message})`, answer: '' });
    }
  }
  return { passed: failures.length === 0, failures };
}

/**
 * Kompletní zkouška jednoho kandidáta.
 *
 * @returns {Promise<{model, stage, accepted, measurement, floor, trials, decisions, removed, error}>}
 */
export async function tryCandidate(candidateName, ctx = {}) {
  const {
    runner,
    roles = [],
    bindings = {},
    incumbentSpeed = {},
    keepOnFailure = false,
    onStage = () => {},
  } = ctx;

  const out = {
    model: candidateName,
    stage: 'pull',
    accepted: false,
    measurement: null,
    floor: null,
    trials: [],
    decisions: {},
    removed: false,
    error: null,
  };

  try {
    onStage('pull', candidateName);
    await pullModel(candidateName, ctx);

    onStage('measure', candidateName);
    out.stage = 'measure';
    out.measurement = await measureModel(candidateName, ctx);

    if (out.measurement.error) {
      out.error = out.measurement.error;
    } else if (!out.measurement.fits) {
      const cpuGb = (out.measurement.placement?.cpuBytes || 0) / 2 ** 30;
      out.error = `nevejde se do VRAM při ${out.measurement.numCtx} tokenech — ${cpuGb.toFixed(2)} GB by běželo na CPU`;
    }
    if (out.error) {
      if (!keepOnFailure) out.removed = await removeModel(candidateName, ctx);
      return out;
    }

    onStage('floor', candidateName);
    out.stage = 'floor';
    out.floor = await runCapabilityFloor(candidateName, ctx);
    if (!out.floor.passed) {
      out.error = `neprošel schopnostním minimem: ${out.floor.failures.map(f => f.reason).join('; ')}`;
      if (!keepOnFailure) out.removed = await removeModel(candidateName, ctx);
      return out;
    }

    onStage('trial', candidateName);
    out.stage = 'trial';
    for (const role of roles) {
      const incumbent = bindings[role];
      if (!incumbent) continue;
      const result = await trialRole(runner, role, candidateName, incumbent, {
        threshold: IMPROVEMENT_THRESHOLD[role] ?? 0.05,
        speed: {
          candidate: out.measurement.throughput?.tokensPerSecond ?? 0,
          incumbent: incumbentSpeed[incumbent] ?? 0,
        },
        between: () => drainResident(ctx),
        ...ctx.trialOpts,
      });
      out.trials.push(result);
      if (!result.skipped) out.decisions[role] = result.decision;
    }

    out.accepted = Object.values(out.decisions).some(d => d.winner === 'candidate');
    out.stage = 'done';

    // Kandidát, který nevyhrál ani jednu roli, na disku nemá co dělat.
    if (!out.accepted && !keepOnFailure) {
      out.removed = await removeModel(candidateName, ctx);
    }
  } catch (err) {
    out.error = err.message;
    if (!keepOnFailure && out.stage !== 'pull') out.removed = await removeModel(candidateName, ctx);
  } finally {
    await unloadModel(candidateName, ctx).catch(() => {});
  }

  return out;
}

export default { pullModel, removeModel, runCapabilityFloor, tryCandidate, CAPABILITY_FLOOR };
