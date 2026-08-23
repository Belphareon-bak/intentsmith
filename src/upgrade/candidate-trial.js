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
// Kandidát se po souboji nemaže naslepo. Přesný digest zůstává v historii a
// bounded retenci vlastní model-registry: teprve pod diskovým tlakem, po grace
// period a jen s dokončeným scoringem smí odstranit nevázaný artefakt, který
// není poslední rollback.
//
// ══════════════════════════════════════════════════════════════════════════════

import { config } from '../config.js';
import { logger } from '../core/logger.js';
import { measureModel, drainResident, unloadModel } from './vram-measurement.js';
import { trialRole, createSuiteCache } from './pairwise-trial.js';
import { parseModelNameExtended } from './model-family-extensions.js';
import { IMPROVEMENT_THRESHOLD, checkRoleEligibility } from './model-ranker.js';

const PULL_TIMEOUT = 60 * 60 * 1000;  // hodina; jen pojistka proti zaseknutí
const PROBE_TIMEOUT = 120_000;

/**
 * Mazání kandidátů je **vypnuté**, dokud validační sady nerozlišují.
 *
 * Operátorské pravidlo z 2026-08-20.  Důvod: verdikt „kandidát neuspěl" dnes
 * často znamená „sada ho neuměla odlišit", ne „je horší" — 8 z 36 úloh dává
 * všem modelům 100 % a nenese žádnou informaci.  Mazat na základě měření,
 * o kterém víme, že nerozlišuje, je ztráta, kterou nejde vzít zpět.
 *
 * Zapnout zpátky až po doladění sad, vědomým `allowRemoval: true`.
 */
export const REMOVAL_ENABLED_BY_DEFAULT = false;

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

/**
 * Smaže model z disku **cizí autoritou**, ne vlastní cestou.
 *
 * Mazání modelu vlastní `upgrade/model-registry.js` — jen ono ověří kanonickou
 * identitu, přesný digest a proběhne pod exclusive mutation autoritou.  Vlastní
 * vlastní volání Ollama delete endpointu tady tuhle ochranu obcházelo; guard M1
 * v `tests/m1-model-binding-application.test.js` proto vyžaduje, aby ten endpoint
 * byl v `src/**` zmíněný právě v jednom souboru.
 *
 * Funkce se sem nedostane importem, ale z runtime kontextu (`ctx.deleteModel`) —
 * strict injection podle [rozhodnutí 019](../../docs/decisions/019-l0-8-specialist-boundary.md).
 * Bez injektované autority se **nemaže**; fail-closed, ne tichý bypass.
 */
export async function removeModel(modelName, opts = {}) {
  const deleteModel = opts.deleteModel;
  if (typeof deleteModel !== 'function') {
    logger.warn(
      'CandidateTrial',
      `Smazání ${modelName} zamítnuto: chybí injektovaná autorita mazání`,
    );
    return false;
  }
  try {
    await deleteModel(modelName, { source: 'AUTO_CLEANUP' });
    return true;
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
    // Mazání je vypnuté napevno; zapíná se jen vědomě, viz
    // REMOVAL_ENABLED_BY_DEFAULT.
    allowRemoval = REMOVAL_ENABLED_BY_DEFAULT,
    onStage = () => {},
  } = ctx;

  const removalAllowed = allowRemoval && !keepOnFailure;

  const out = {
    model: candidateName,
    stage: 'pull',
    accepted: false,
    inconclusive: false,
    measurement: null,
    floor: null,
    trials: [],
    decisions: {},
    removed: false,
    keptReason: null,
    error: null,
  };

  // Suite readiness is known before download or GPU placement. Do not spend
  // network, VRAM and capability probes on a candidate when none of its roles
  // is allowed to make a decision yet.
  const runnableRoles = [];
  for (const role of roles) {
    const plan = ctx.evaluationPlans?.[role] || null;
    const minimumTaskCount = plan?.minimumTaskCount ?? 1;
    if (plan && plan.taskCount < minimumTaskCount) {
      const reason = `${plan.suiteName} má ${plan.taskCount}/${minimumTaskCount} `
        + 'požadovaných aktivních úloh';
      out.trials.push({ role, skipped: true, reason });
      onStage('roleSkipped', candidateName, { role, reason });
    } else {
      runnableRoles.push(role);
    }
  }
  if (roles.length > 0 && runnableRoles.length === 0) {
    out.stage = 'suite-readiness';
    out.inconclusive = true;
    out.keptReason = 'role nemá dostatečně rozlišující validační sadu';
    return out;
  }

  try {
    if (ctx.skipPull === true) {
      out.stage = 'measure';
      onStage('pullSkipped', candidateName, { reason: 'already installed' });
    } else {
      onStage('pull', candidateName);
      await pullModel(candidateName, ctx);
    }

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
      if (removalAllowed) out.removed = await removeModel(candidateName, ctx);
      else out.keptReason = 'mazání je vypnuté, dokud validační sady nerozlišují';
      return out;
    }

    // Hlásí se hned, ne až po souboji — souboj trvá desítky minut a operátor
    // má vědět, jestli se kandidát vůbec vešel a jak je rychlý.
    onStage('measured', candidateName, {
      fits: true,
      tokensPerSecond: out.measurement.throughput?.tokensPerSecond ?? null,
      vramBytes: out.measurement.placement?.vramBytes ?? 0,
      sizeBytes: out.measurement.placement?.sizeBytes ?? 0,
      numCtx: out.measurement.numCtx,
    });

    onStage('floor', candidateName);
    out.stage = 'floor';
    const reusable = typeof ctx.hasReusableEvaluation === 'function'
      ? await ctx.hasReusableEvaluation(candidateName, runnableRoles)
      : false;
    out.floor = reusable
      ? { passed: true, failures: [], reused: true }
      : await runCapabilityFloor(candidateName, ctx);
    if (!out.floor.passed) {
      out.error = `neprošel schopnostním minimem: ${out.floor.failures.map(f => f.reason).join('; ')}`;
      if (removalAllowed) out.removed = await removeModel(candidateName, ctx);
      else out.keptReason = 'mazání je vypnuté, dokud validační sady nerozlišují';
      return out;
    }

    onStage('floorPassed', candidateName, { probes: (ctx.probes || CAPABILITY_FLOOR).length });

    // Vlastnosti kandidáta pro filtr způsobilosti. Volající je může dodat
    // přesnější (z katalogu či HuggingFace); jinak se odvodí z názvu.
    const parsed = parseModelNameExtended(candidateName);
    const candidateProfile = {
      name: candidateName,
      params: ctx.candidateParams ?? parsed.params,
      category: ctx.candidateCategory ?? parsed.category,
      capabilities: ctx.candidateCapabilities ?? null,
    };

    out.stage = 'trial';
    // Sdílená cache napříč rolemi — `reasoning` obsluhuje D1, D2 i R1.
    const suiteCache = createSuiteCache();
    for (const role of runnableRoles) {
      const incumbent = bindings[role];
      if (!incumbent) continue;
      const evaluationPlan = ctx.evaluationPlans?.[role] || null;

      // Nezpůsobilá role se nesoutěží.  Textový model nemá co dělat v souboji
      // o VISION — jednak by tam nemohl vyhrát, jednak by to stálo šest běhů
      // sady navíc. Způsobilost už jednou rozhodla, že tam nepatří.
      const eligibility = checkRoleEligibility(candidateProfile, role);
      if (!eligibility.eligible) {
        out.trials.push({ role, skipped: true, reason: eligibility.reason });
        onStage('roleSkipped', candidateName, { role, reason: eligibility.reason });
        continue;
      }
      const result = await trialRole(runner, role, candidateName, incumbent, {
        evaluationPlan,
        threshold: IMPROVEMENT_THRESHOLD[role] ?? 0.05,
        speed: {
          candidate: out.measurement.throughput?.tokensPerSecond ?? 0,
          incumbent: incumbentSpeed[incumbent] ?? 0,
        },
        between: () => drainResident(ctx),
        suiteCache,
        ...ctx.trialOpts,
      });
      out.trials.push(result);
      if (!result.skipped) {
        out.decisions[role] = result.decision;
        onStage('roleDecided', candidateName, { role, decision: result.decision });
      }
    }

    out.accepted = Object.values(out.decisions).some(d => d.winner === 'candidate');
    out.stage = 'done';

    // „Prohrál" a „neumíme rozlišit" nejsou totéž.  Když sada nerozlišila,
    // kandidát nebyl horší — jen to nešlo změřit, což je vlastnost sady, ne
    // modelu.  Smazat kvůli tomu model s vyšším externím hodnocením je ztráta
    // informace, takže se to aspoň musí rozlišit ve výstupu a jde to vypnout.
    out.inconclusive = !out.accepted
      && Object.values(out.decisions).length > 0
      && Object.values(out.decisions).every(d => d.basis === 'nerozhodně');

    if (!out.accepted && removalAllowed && !(out.inconclusive && ctx.keepInconclusive)) {
      out.removed = await removeModel(candidateName, ctx);
    } else if (!out.accepted) {
      out.keptReason = removalAllowed
        ? 'sada kandidáta neodlišila — nemazat, dokud nerozlišuje'
        : 'mazání je vypnuté, dokud validační sady nerozlišují';
    }
  } catch (err) {
    out.error = err.message;
    if (removalAllowed && out.stage !== 'pull') out.removed = await removeModel(candidateName, ctx);
  } finally {
    await unloadModel(candidateName, ctx).catch(() => {});
  }

  return out;
}

export default {
  pullModel, removeModel, runCapabilityFloor, tryCandidate,
  CAPABILITY_FLOOR, REMOVAL_ENABLED_BY_DEFAULT,
};
