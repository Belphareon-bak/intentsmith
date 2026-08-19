// tests/candidate-trial.test.js — fáze 2 až 4: zkouška jednoho kandidáta
// ══════════════════════════════════════════════════════════════════════════════
// Bez Ollamy a bez stahování: `fetch` je atrapa.
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';

import {
  runCapabilityFloor, tryCandidate, removeModel, CAPABILITY_FLOOR,
} from '../src/upgrade/candidate-trial.js';
import { SUITES } from '../src/upgrade/validation-suites.js';

const GB = 2 ** 30;
const realFetch = globalThis.fetch;
const restore = () => { globalThis.fetch = realFetch; };

/**
 * Atrapa Ollamy.  `answers` mapuje podřetězec promptu na odpověď, `placement`
 * určuje, co vrátí /api/ps.
 */
function stubOllama({ answers = {}, placement, pullFails = false, currentModel = null } = {}) {
  const seen = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    seen.push({ path, body, method: init.method });

    if (path === '/api/pull') {
      if (pullFails) return { ok: false, status: 500 };
      return {
        ok: true,
        body: { getReader: () => ({ read: async () => ({ done: true, value: undefined }) }) },
      };
    }
    if (path === '/api/delete') return { ok: true, status: 200, json: async () => ({}) };
    if (path === '/api/ps') {
      // Jméno se dopisuje podle právě zkoušeného modelu — `readPlacement`
      // párauje podle jména, takže pevná hodnota by se netrefila.
      const model = placement && (placement.name || currentModel);
      return {
        ok: true, status: 200,
        json: async () => ({ models: placement ? [{ ...placement, name: model }] : [] }),
      };
    }
    if (path === '/api/chat') {
      const prompt = body?.messages?.[0]?.content || '';
      let content = 'ok';
      for (const [needle, reply] of Object.entries(answers)) {
        if (prompt.includes(needle)) { content = reply; break; }
      }
      return {
        ok: true, status: 200,
        json: async () => ({ message: { content }, eval_count: 100, eval_duration: 1e9 }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return seen;
}

const GOOD_ANSWERS = {
  'jedním slovem': 'ano',
  'platný JSON': '{"stav":"ok","cislo":42}',
  'česky': 'Obloha je modrá kvůli rozptylu světla v atmosféře.',
};

const FITS = { size: 10 * GB, size_vram: 10 * GB };
const SPILLS = { size: 29 * GB, size_vram: 21 * GB };

/**
 * Rychlý úklid paměti pro testy.  Atrapa /api/ps drží model napořád, takže bez
 * zkrácení by `drainResident` čekal celý minutový timeout u každé zkoušky.
 */
const FAST_DRAIN = { drainTimeout: 30, drainPollMs: 5 };

function fakeRunner(scores) {
  return {
    async runSuite(suiteName, model) {
      const per = scores[model] || {};
      const tests = SUITES[suiteName].tests.map(t => ({
        name: t.name, score: per[t.name] ?? per._default ?? 1, passed: true,
      }));
      return { suite: suiteName, model, tests, score: tests.reduce((s, t) => s + t.score, 0) / tests.length };
    },
  };
}

// ─── Schopnostní minimum ────────────────────────────────────────────────────

suite('runCapabilityFloor');

test('minimum obsahuje jen binární, jednoznačné kontroly', () => {
  // Krátká sada nesmí být zkrácené hodnocení kvality — nesmí umět vyřadit
  // model, který je „jen horší". Každá položka je proto schopnostní podlaha.
  assertEqual(CAPABILITY_FLOOR.length, 3);
  for (const p of CAPABILITY_FLOOR) {
    assert(typeof p.check === 'function' && p.failure, `${p.id} musí mít kontrolu i důvod`);
  }
});

await testAsync('dobrý model projde', async () => {
  stubOllama({ answers: GOOD_ANSWERS });
  const r = await runCapabilityFloor('cand:7b');
  assertEqual(r.passed, true);
  restore();
});

await testAsync('prázdná odpověď propadne', async () => {
  stubOllama({ answers: { 'jedním slovem': '' } });
  const r = await runCapabilityFloor('cand:7b');
  assertEqual(r.passed, false);
  assert(r.failures.some(f => f.id === 'responds'));
  restore();
});

await testAsync('neplatný JSON propadne', async () => {
  stubOllama({ answers: { ...GOOD_ANSWERS, 'platný JSON': 'tady je: {nevalidni' } });
  const r = await runCapabilityFloor('cand:7b');
  assertEqual(r.passed, false);
  assert(r.failures.some(f => f.id === 'json'));
  restore();
});

await testAsync('JSON obalený textem projde', async () => {
  // Kontroluje se schopnost vytvořit JSON, ne poslušnost formátování.
  stubOllama({ answers: { ...GOOD_ANSWERS, 'platný JSON': 'Jistě:\n{"stav":"ok"}\nHotovo.' } });
  assertEqual((await runCapabilityFloor('cand:7b')).passed, true);
  restore();
});

await testAsync('odpověď bez diakritiky propadne na češtině', async () => {
  stubOllama({ answers: { ...GOOD_ANSWERS, 'česky': 'The sky is blue.' } });
  const r = await runCapabilityFloor('cand:7b');
  assertEqual(r.passed, false);
  assert(r.failures.some(f => f.id === 'czech'));
  restore();
});

// ─── Celá zkouška ───────────────────────────────────────────────────────────

suite('tryCandidate');

await testAsync('přetékající kandidát se zamítne a smaže ještě před testy', async () => {
  const seen = stubOllama({ answers: GOOD_ANSWERS, placement: SPILLS, currentModel: 'cand:32b' });
  const r = await tryCandidate('cand:32b', {
    ...FAST_DRAIN, runner: fakeRunner({}), roles: ['CODE'], bindings: { CODE: 'inc:7b' } });
  assertEqual(r.accepted, false);
  assertEqual(r.stage, 'measure');
  assert(/nevejde se do VRAM/.test(r.error), r.error);
  assertEqual(r.removed, true);
  assert(!seen.some(s => s.path === '/api/chat' && /platný JSON/.test(s.body?.messages?.[0]?.content || '')),
    'schopnostní minimum se nemá spouštět, když se model nevejde');
  restore();
});

await testAsync('propadnutí u minima zamítne kandidáta a smaže ho', async () => {
  stubOllama({ answers: { ...GOOD_ANSWERS, 'česky': 'no diacritics here' }, placement: FITS, currentModel: 'cand:7b' });
  const r = await tryCandidate('cand:7b', {
    ...FAST_DRAIN, runner: fakeRunner({}), roles: ['CODE'], bindings: { CODE: 'inc:7b' } });
  assertEqual(r.accepted, false);
  assertEqual(r.stage, 'floor');
  assertEqual(r.removed, true);
  restore();
});

await testAsync('lepší kandidát vyhraje roli a NEsmaže se', async () => {
  stubOllama({ answers: GOOD_ANSWERS, placement: FITS, currentModel: 'cand:7b' });
  const codeTask = SUITES.code.tests[0].name;
  const r = await tryCandidate('cand:7b', {
    ...FAST_DRAIN,
    runner: fakeRunner({ 'cand:7b': { _default: 1 }, 'inc:7b': { _default: 1, [codeTask]: 0.1 } }),
    roles: ['CODE'],
    bindings: { CODE: 'inc:7b' },
  });
  assertEqual(r.accepted, true);
  assertEqual(r.decisions.CODE.winner, 'candidate');
  assertEqual(r.removed, false, 'přijatý kandidát na disku zůstává');
  restore();
});

await testAsync('kandidát, který nevyhraje žádnou roli, se smaže', async () => {
  stubOllama({ answers: GOOD_ANSWERS, placement: FITS, currentModel: 'cand:7b' });
  const r = await tryCandidate('cand:7b', {
    ...FAST_DRAIN,
    runner: fakeRunner({ 'cand:7b': { _default: 1 }, 'inc:7b': { _default: 1 } }),
    roles: ['CODE'],
    bindings: { CODE: 'inc:7b' },
  });
  assertEqual(r.accepted, false);
  assertEqual(r.removed, true, 'na disku nemá co dělat');
  restore();
});

await testAsync('keepOnFailure zabrání mazání', async () => {
  stubOllama({ answers: GOOD_ANSWERS, placement: SPILLS, currentModel: 'cand:32b' });
  const r = await tryCandidate('cand:32b', {
    ...FAST_DRAIN,
    runner: fakeRunner({}), roles: [], bindings: {}, keepOnFailure: true,
  });
  assertEqual(r.removed, false);
  restore();
});

await testAsync('selhání stahování nesmaže nic cizího', async () => {
  const seen = stubOllama({ pullFails: true });
  const r = await tryCandidate('cand:7b', {
    ...FAST_DRAIN, runner: fakeRunner({}), roles: [], bindings: {} });
  assertEqual(r.stage, 'pull');
  assert(r.error, 'chyba se musí propsat');
  assert(!seen.some(s => s.path === '/api/delete'), 'nestažený model se nemaže');
  restore();
});

await testAsync('stahování nemá kvalitativní timeout', async () => {
  // Pojistka proti zaseknutí je hodina; nesmí to být kritérium vyřazení.
  const seen = stubOllama({ answers: GOOD_ANSWERS, placement: FITS, currentModel: 'cand:7b' });
  await tryCandidate('cand:7b', {
    ...FAST_DRAIN, runner: fakeRunner({}), roles: [], bindings: {} });
  assert(seen.some(s => s.path === '/api/pull'), 'stahování proběhlo');
  restore();
});

await testAsync('role bez navázaného modelu se přeskočí', async () => {
  stubOllama({ answers: GOOD_ANSWERS, placement: FITS, currentModel: 'cand:7b' });
  const r = await tryCandidate('cand:7b', {
    ...FAST_DRAIN,
    runner: fakeRunner({}), roles: ['CODE', 'CHAT'], bindings: { CODE: 'inc:7b' },
  });
  assert(!('CHAT' in r.decisions), 'role bez stávajícího modelu nemá s čím soutěžit');
  restore();
});

await testAsync('odstranění modelu ohlásí výsledek', async () => {
  stubOllama({});
  assertEqual(await removeModel('x:7b'), true);
  restore();
  globalThis.fetch = async () => { throw new Error('down'); };
  assertEqual(await removeModel('x:7b'), false);
  restore();
});

// ─── Průběžné hlášení ───────────────────────────────────────────────────────

suite('onStage — hlášení průběhu');

await testAsync('měření se hlásí hned, ne až po souboji', async () => {
  // Souboj trvá desítky minut; operátor má vědět dřív, jestli se kandidát
  // vůbec vešel a jak je rychlý.
  stubOllama({ answers: GOOD_ANSWERS, placement: FITS, currentModel: 'cand:7b' });
  const stages = [];
  await tryCandidate('cand:7b', {
    ...FAST_DRAIN,
    runner: fakeRunner({ 'cand:7b': { _default: 1 }, 'inc:7b': { _default: 1 } }),
    roles: ['CODE'],
    bindings: { CODE: 'inc:7b' },
    onStage: (stage, model, info) => stages.push({ stage, info }),
  });
  const measured = stages.find(s => s.stage === 'measured');
  assert(measured, 'měření se musí ohlásit');
  assertEqual(measured.info.fits, true);
  assertEqual(measured.info.tokensPerSecond, 100);

  const trialIdx = stages.findIndex(s => s.stage === 'roleDecided');
  const measuredIdx = stages.indexOf(measured);
  assert(measuredIdx < trialIdx, 'měření se hlásí před rozhodnutím role');
  restore();
});

await testAsync('rozhodnutí role se hlásí průběžně', async () => {
  stubOllama({ answers: GOOD_ANSWERS, placement: FITS, currentModel: 'cand:7b' });
  const decided = [];
  await tryCandidate('cand:7b', {
    ...FAST_DRAIN,
    runner: fakeRunner({ 'cand:7b': { _default: 1 }, 'inc:7b': { _default: 1 } }),
    roles: ['CODE', 'CHAT'],
    bindings: { CODE: 'inc:7b', CHAT: 'inc:7b' },
    onStage: (stage, model, info) => { if (stage === 'roleDecided') decided.push(info.role); },
  });
  assertEqual(decided.length, 2, 'každá role se ohlásí, jakmile je rozhodnutá');
  restore();
});

await testAsync('u přetékajícího kandidáta se měření jako úspěch nehlásí', async () => {
  stubOllama({ answers: GOOD_ANSWERS, placement: SPILLS, currentModel: 'cand:32b' });
  const stages = [];
  await tryCandidate('cand:32b', {
    ...FAST_DRAIN,
    runner: fakeRunner({}), roles: [], bindings: {},
    onStage: (stage, model, info) => stages.push(stage),
  });
  assert(!stages.includes('measured'), 'nevešel se — nemá se hlásit jako změřený');
  restore();
});

// ─── Způsobilost pro roli ───────────────────────────────────────────────────

suite('způsobilost rolí ve zkoušce');

await testAsync('textový model se pro VISION vůbec nesoutěží', async () => {
  // Nemohl by tam vyhrát a stálo by to šest běhů sady navíc — o způsobilosti
  // rozhodl filtr, souboj ji nemá obcházet.
  stubOllama({ answers: GOOD_ANSWERS, placement: FITS, currentModel: 'qwen3-coder:30b' });
  const skipped = [];
  const r = await tryCandidate('qwen3-coder:30b', {
    ...FAST_DRAIN,
    runner: fakeRunner({}),
    roles: ['VISION'],
    bindings: { VISION: 'llava:13b' },
    onStage: (stage, m, info) => { if (stage === 'roleSkipped') skipped.push(info); },
  });
  assertEqual(skipped.length, 1);
  assert(/obraz/.test(skipped[0].reason), skipped[0].reason);
  assert(!('VISION' in r.decisions), 'nezpůsobilá role nemá rozhodnutí');
  restore();
});

await testAsync('vision model se pro VISION soutěží normálně', async () => {
  stubOllama({ answers: GOOD_ANSWERS, placement: FITS, currentModel: 'llava:34b' });
  const r = await tryCandidate('llava:34b', {
    ...FAST_DRAIN,
    runner: fakeRunner({ 'llava:34b': { _default: 1 }, 'llava:13b': { _default: 1 } }),
    roles: ['VISION'],
    bindings: { VISION: 'llava:13b' },
  });
  assert('VISION' in r.decisions, 'způsobilý kandidát musí soutěžit');
  restore();
});

await testAsync('volající může dodat přesnější vlastnosti kandidáta', async () => {
  // qwen3.5:27b je podle HuggingFace multimodální, i když z názvu to nepoznáš.
  stubOllama({ answers: GOOD_ANSWERS, placement: FITS, currentModel: 'qwen3.5:27b' });
  const r = await tryCandidate('qwen3.5:27b', {
    ...FAST_DRAIN,
    runner: fakeRunner({ 'qwen3.5:27b': { _default: 1 }, 'llava:13b': { _default: 1 } }),
    roles: ['VISION'],
    bindings: { VISION: 'llava:13b' },
    candidateCapabilities: ['vision'],
  });
  assert('VISION' in r.decisions, 'dodaná schopnost vision musí kandidáta pustit do souboje');
  restore();
});

summary();
