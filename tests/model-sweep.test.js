// tests/model-sweep.test.js — fáze 0 a 1: vyjmenování rodin a řazení kandidátů
// ══════════════════════════════════════════════════════════════════════════════
// Bez sítě: parsování z fixture HTML, řazení nad syntetickým poolem.
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';

import {
  fetchLibraryFamilies, parseTagsPage, mightFit, comfortablyFits,
  preferredTagForFamily, formatRunsHere, prioritizeCandidates, clearCache,
  specializationBonus, buildCandidatePool,
  parseLibraryFamilyMetadata, getLibraryFamilyMetadata,
  MIN_OBSERVED_VRAM_OVERHEAD, TYPICAL_VRAM_OVERHEAD,
} from '../src/upgrade/model-sweep.js';

const VRAM_24GB = 24576;

// ─── Fáze 0 ─────────────────────────────────────────────────────────────────

suite('fetchLibraryFamilies');

await testAsync('vytáhne rodiny z HTML knihovny', async () => {
  clearCache();
  const html = `
    <a href="/library/qwen3.5">qwen3.5</a>
    <a href="/library/deepseek-v4-pro">deepseek</a>
    <a href="/library/glm-5.2">glm</a>
    <a href="/library/qwen3.5">duplicita</a>
    <a href="/blog/neco">ne-rodina</a>`;
  const fams = await fetchLibraryFamilies({ html, force: true });
  assertEqual(fams.length, 3, `dostal: ${fams.join(',')}`);
  assert(fams.includes('deepseek-v4-pro'), 'rodina se spojovníky a číslem projde');
  clearCache();
});

test('živý katalog zachová stáří aktualizace a popis rodiny', () => {
  const metadata = parseLibraryFamilyMetadata(`
    <a href="/library/qwen3.6"><p>Agentic coding and thinking.</p><span>1 week ago</span></a>
    <a href="/library/laguna-xs-2.1"><p>Local coding model.</p><span>2 days ago</span></a>`);
  assertEqual(metadata.get('qwen3.6').updatedDays, 7);
  assertEqual(metadata.get('qwen3.6').description, 'Agentic coding and thinking.');
  assertEqual(metadata.get('laguna-xs-2.1').updatedDays, 2);
});

await testAsync('metadata patří ke stejnému živému snapshotu jako rodiny', async () => {
  clearCache();
  await fetchLibraryFamilies({
    html: '<a href="/library/qwen3.6"><p>New model.</p><span>1 week ago</span></a>',
    force: true,
  });
  assertEqual(getLibraryFamilyMetadata().get('qwen3.6').updatedDays, 7);
  clearCache();
});

// ─── Parsování tagů ─────────────────────────────────────────────────────────

suite('parseTagsPage');

const TAGS_HTML = `
  qwen3.5:latest qwen3.5:latest 6.6GB
  qwen3.5:0.8b qwen3.5:0.8b 1.0GB
  qwen3.5:27b qwen3.5:27b 17GB
  qwen3.5:122b 81GB
  qwen3.5:cloud qwen3.5:cloud
  qwen3.5:400b 1.2TB`;

test('spáruje tag s velikostí', () => {
  const tags = parseTagsPage('qwen3.5', TAGS_HTML);
  const byTag = Object.fromEntries(tags.map(t => [t.tag, t.sizeGB]));
  assertEqual(byTag['27b'], 17);
  assertEqual(byTag['0.8b'], 1);
});

test('TB se převede na GB', () => {
  const tags = parseTagsPage('qwen3.5', TAGS_HTML);
  assertEqual(tags.find(t => t.tag === '400b').sizeGB, 1228.8);
});

test('cloudový tag se vynechá — není ke stažení', () => {
  const tags = parseTagsPage('qwen3.5', TAGS_HTML);
  assert(!tags.some(t => t.tag === 'cloud'), 'cloud nesmí být kandidát');
});

test('tečka v názvu rodiny se nebere jako regex', () => {
  // `qwen3.5` by jako regex chytlo i `qwen345`; escapování musí fungovat.
  const tags = parseTagsPage('qwen3.5', 'qwen345:7b 4GB');
  assertEqual(tags.length, 0);
});

test('prázdný nebo chybný vstup nespadne', () => {
  assertEqual(parseTagsPage('x', '').length, 0);
  assertEqual(parseTagsPage(null, 'x:7b 4GB').length, 0);
});

// ─── Odhad velikosti ────────────────────────────────────────────────────────

suite('mightFit — shovívavý předfiltr');

test('předfiltr je shovívavý, ne přesný', () => {
  // Naměřený rozptyl režie je 1.06–1.57, takže předfiltr používá dolní mez.
  // Musí pustit dál i to, co se možná nevejde — o tom rozhodne až měření.
  assert(MIN_OBSERVED_VRAM_OVERHEAD < TYPICAL_VRAM_OVERHEAD, 'dolní mez musí být pod typickou');
  assert(mightFit(22, VRAM_24GB), '22 GB má dostat šanci na 24GB kartě');
  assert(!mightFit(30, VRAM_24GB), '30 GB nemá šanci ani při nejlepší režii');
});

test('comfortablyFits je přísnější než mightFit', () => {
  assert(mightFit(18, VRAM_24GB) && !comfortablyFits(18, VRAM_24GB),
    '18 GB projde předfiltrem, ale rezervu nemá');
  assert(comfortablyFits(15, VRAM_24GB), '15 GB se vejde s rezervou');
});

test('bez známé VRAM se předfiltr neuplatní', () => {
  assertEqual(mightFit(18, 0), false);
});

// ─── Výběr varianty ─────────────────────────────────────────────────────────

suite('preferredTagForFamily');

test('vybere největší variantu, která se může vejít', () => {
  const best = preferredTagForFamily([
    { tag: '4b', sizeGB: 3 }, { tag: '27b', sizeGB: 17 }, { tag: '122b', sizeGB: 81 },
  ], VRAM_24GB);
  assertEqual(best.tag, '27b');
});

test('agresivní kvantizace se vynechá', () => {
  // Q2/Q3 obětují přesnost za velikost — soutěží jinou vlastností, než hledáme.
  const best = preferredTagForFamily([
    { tag: '22b-instruct-q2_k', sizeGB: 8 }, { tag: '9b', sizeGB: 6 },
  ], VRAM_24GB);
  assertEqual(best.tag, '9b');
});

test('Q4 a výš projdou', () => {
  const best = preferredTagForFamily([{ tag: '22b-q6_k', sizeGB: 18 }], VRAM_24GB);
  assertEqual(best.tag, '22b-q6_k');
});

test('když nic nevyhovuje, vrátí null', () => {
  assertEqual(preferredTagForFamily([{ tag: '400b', sizeGB: 900 }], VRAM_24GB), null);
  assertEqual(preferredTagForFamily([], VRAM_24GB), null);
});

// ─── Formáty vázané na hardware ─────────────────────────────────────────────

suite('formatRunsHere');

test('MLX na NVIDII neběží', () => {
  assertEqual(formatRunsHere('mlx-4bit', 'NVIDIA GeForce RTX 3090'), false);
});

test('MLX na Apple běží', () => {
  assertEqual(formatRunsHere('mlx-4bit', 'Apple M3 Max'), true);
});

test('NVFP4 potřebuje Blackwell', () => {
  assertEqual(formatRunsHere('mlx-nvfp4', 'NVIDIA GeForce RTX 3090'), false);
  assertEqual(formatRunsHere('nvfp4', 'NVIDIA GeForce RTX 5090'), true);
});

test('běžný tag projde všude', () => {
  assertEqual(formatRunsHere('27b', 'NVIDIA GeForce RTX 3090'), true);
  assertEqual(formatRunsHere('27b', ''), true);
});

test('na neznámé GPU se nefiltruje', () => {
  // Radši stáhnout zbytečně, než zahodit model kvůli neznámému hardwaru.
  assertEqual(formatRunsHere('mlx-4bit', 'nějaká neznámá karta'), false);
  assertEqual(formatRunsHere('27b', 'nějaká neznámá karta'), true);
});

// ─── Fáze 1: řazení ─────────────────────────────────────────────────────────

suite('prioritizeCandidates');

const POOL = [
  { name: 'qwen3.8:latest', family: 'qwen3.8', tag: 'latest', sizeGB: 18 },
  { name: 'devstral-2:latest', family: 'devstral-2', tag: 'latest', sizeGB: 15 },
  { name: 'huge:400b', family: 'huge', tag: '400b', sizeGB: 400 },
  { name: 'qwen3:14b', family: 'qwen3', tag: '14b', sizeGB: 9 },
];

test('vyřadí, co se nemůže vejít', () => {
  const out = prioritizeCandidates(POOL, { vramMb: VRAM_24GB });
  assert(!out.some(c => c.family === 'huge'), '400 GB nemá být v seznamu');
});

test('vyřadí, co už je nainstalované', () => {
  const out = prioritizeCandidates(POOL, { vramMb: VRAM_24GB, installed: ['qwen3:14b'] });
  assert(!out.some(c => c.name === 'qwen3:14b'), 'nainstalovaný model není kandidát');
});

test('shoda jména je tolerantní k :latest', () => {
  const out = prioritizeCandidates(POOL, { vramMb: VRAM_24GB, installed: ['qwen3.8'] });
  assert(!out.some(c => c.family === 'qwen3.8'), 'qwen3.8 ≡ qwen3.8:latest');
});

test('externí signál pouze řadí a žádného fakticky způsobilého kandidáta nemaže', () => {
  const out = prioritizeCandidates(POOL, {
    vramMb: VRAM_24GB,
    externalSignalOf: e => (e.family === 'qwen3.8' ? 57.7 : 5),
  });
  assertEqual(out.length, 3);
  assertEqual(out[0].family, 'qwen3.8');
});

test('řadí podle hodnocení sestupně', () => {
  const q = { 'qwen3.8': 57.7, 'devstral-2': 19.2, qwen3: 8.5 };
  const out = prioritizeCandidates(POOL, { vramMb: VRAM_24GB, externalSignalOf: e => q[e.family] ?? null });
  assertEqual(out[0].family, 'qwen3.8');
  assert(out[0].priority > out[1].priority, 'priorita musí klesat');
});

test('datum vydání pouze řadí a starší kandidát zůstává k exact evaluaci', () => {
  const out = prioritizeCandidates(POOL, {
    vramMb: VRAM_24GB,
    releaseDateOf: e => (e.family === 'qwen3.8' ? '2026-08-05' : '2025-01-01'),
  });
  assertEqual(out.length, 3);
  assertEqual(out[0].family, 'qwen3.8');
});

test('rezerva ve velikosti zvedne prioritu', () => {
  const tight = prioritizeCandidates([{ name: 'a:1', family: 'a', sizeGB: 18 }], { vramMb: VRAM_24GB });
  const roomy = prioritizeCandidates([{ name: 'b:1', family: 'b', sizeGB: 10 }], { vramMb: VRAM_24GB });
  assert(roomy[0].priority > tight[0].priority, 'pohodlná velikost je lepší kandidát');
  assert(tight[0].reasons.some(r => /těsná/.test(r)), 'těsnost se musí objevit v důvodech');
});

test('čerstvá aktualizace živého katalogu zvedne netestovaný model ve frontě', () => {
  const out = prioritizeCandidates([
    { name: 'fresh:14b', family: 'fresh', sizeGB: 10, catalogUpdatedDays: 7, catalogUpdatedLabel: '1 week ago' },
    { name: 'old:14b', family: 'old', sizeGB: 10, catalogUpdatedDays: 365, catalogUpdatedLabel: '1 year ago' },
  ], { vramMb: VRAM_24GB });
  assertEqual(out[0].family, 'fresh');
  assert(out[0].reasons.some(reason => /1 week ago/.test(reason)));
});

test('chybějící stáří se nesmí vydávat za aktualizaci dnes', () => {
  const [candidate] = prioritizeCandidates([
    { name: 'undated:14b', family: 'undated', sizeGB: 10, catalogUpdatedDays: null },
  ], { vramMb: VRAM_24GB });
  assertEqual(candidate.priority, 3);
  assert(!candidate.reasons.some(reason => /aktualizováno/.test(reason)));
});

test('prázdný pool nespadne', () => {
  assertEqual(prioritizeCandidates([], { vramMb: VRAM_24GB }).length, 0);
});

// ─── Seznam per role ────────────────────────────────────────────────────────

suite('prioritizeCandidates — seznam pro konkrétní roli');

const MIXED = [
  { name: 'coder:14b', family: 'coder', sizeGB: 9 },
  { name: 'seer:13b', family: 'seer', sizeGB: 8 },
  { name: 'talker:14b', family: 'talker', sizeGB: 9 },
  { name: 'zahadny:14b', family: 'zahadny', sizeGB: 9 },
];
const CATEGORY = {
  coder: 'code', seer: 'vision', talker: 'general', zahadny: 'unknown',
};
const profileOf = e => ({ category: CATEGORY[e.family], params: 14 });

test('category preference nevyřadí technicky kompatibilní vision model z CODE', () => {
  const out = prioritizeCandidates(MIXED, {
    vramMb: VRAM_24GB, role: 'CODE', profileOf,
    preferredCategories: ['code', 'general'],
  });
  const names = out.map(c => c.family);
  assert(names.includes('seer'), 'preference nesmí být hard eligibility filtr');
  assert(names.includes('coder'), 'coder ano');
  assert(names.indexOf('coder') < names.indexOf('seer'), 'preference smí změnit jen pořadí');
});

test('coder model pro CHAT zůstane ve frontě bez preference bonusu', () => {
  const out = prioritizeCandidates(MIXED, {
    vramMb: VRAM_24GB, role: 'CHAT', profileOf, preferredCategories: ['general'],
  });
  const names = out.map(c => c.family);
  assert(names.includes('coder'), 'technicky kompatibilní coder musí dostat šanci na měření');
  assert(names.includes('talker'), 'generalista ano');
  assert(names.indexOf('talker') < names.indexOf('coder'), 'general preference je pouze ranking bonus');
});

test('neznámá kategorie projde — nevíme, tak nevyřazujeme', () => {
  // Zahodit model kvůli mezeře v rozpoznávání názvu by bylo horší než ho
  // nechat projít s nulovým bonusem; rozhodne pak souboj.
  for (const role of ['CODE', 'CHAT', 'VISION']) {
    const out = prioritizeCandidates(MIXED, {
      vramMb: VRAM_24GB, role, profileOf,
      preferredCategories: role === 'VISION' ? ['vision'] : ['general'],
    });
    assert(out.some(c => c.family === 'zahadny'), `neznámá kategorie musí projít i pro ${role}`);
  }
});

test('bez preferredCategories se nefiltruje', () => {
  const out = prioritizeCandidates(MIXED, { vramMb: VRAM_24GB, role: 'CODE', profileOf });
  assertEqual(out.length, MIXED.length);
});

test('preferredCategories mění prioritu, nikoli počet technicky způsobilých kandidátů', () => {
  const without = prioritizeCandidates(MIXED, {
    vramMb: VRAM_24GB, role: 'CHAT', profileOf,
  });
  const withPreference = prioritizeCandidates(MIXED, {
    vramMb: VRAM_24GB, role: 'CHAT', profileOf, preferredCategories: ['general'],
  });
  assertEqual(withPreference.length, without.length);
  assert(withPreference.find(row => row.family === 'talker').priority
    > without.find(row => row.family === 'talker').priority);
});

test('nezpůsobilý kandidát se do seznamu role nedostane', () => {
  const out = prioritizeCandidates(MIXED, {
    vramMb: VRAM_24GB,
    role: 'VISION',
    profileOf,
    eligibilityOf: (e, role) => ({
      eligible: CATEGORY[e.family] === 'vision',
      reason: 'model neumí zpracovat obraz',
    }),
  });
  assertEqual(out.length, 1);
  assertEqual(out[0].family, 'seer');
});

test('shoda specializace zvedne pořadí v rámci role', () => {
  const out = prioritizeCandidates(MIXED, {
    vramMb: VRAM_24GB, role: 'CODE', profileOf,
    preferredCategories: ['code', 'general'],
  });
  assertEqual(out[0].family, 'coder', 'coder má být pro CODE první');
  assert(out[0].reasons.some(r => /specializace code/.test(r)));
});

test('výsledek nese roli, pro kterou byl sestaven', () => {
  const out = prioritizeCandidates(MIXED, { vramMb: VRAM_24GB, role: 'R2', profileOf });
  assert(out.every(c => c.role === 'R2'), 'každý záznam ví, do které role patří');
});

// ─── Bonus za specializaci ──────────────────────────────────────────────────

suite('specializationBonus');

test('shoda specializace s rolí dává bonus', () => {
  assert(specializationBonus('code', 'CODE') > 0);
  assert(specializationBonus('vision', 'VISION') > 0);
  assert(specializationBonus('reasoning', 'D1') > 0);
});

test('neshoda nedává nic', () => {
  assertEqual(specializationBonus('code', 'VISION'), 0);
  assertEqual(specializationBonus('vision', 'CODE'), 0);
  assertEqual(specializationBonus(null, 'CODE'), 0);
});

test('specializovaná shoda váží víc než obecná', () => {
  assert(specializationBonus('code', 'CODE') > specializationBonus('general', 'CHAT'),
    'coder do CODE je silnější signál než generalista do CHAT');
});

// ─── Pool přes všechny rodiny ───────────────────────────────────────────────

suite('buildCandidatePool');

await testAsync('pool se nesmí omezit na hodnocené rodiny', async () => {
  // whatllm hodnotí 17 z 235 rodin a mezi nimi není jediný vision model —
  // omezení poolu na hodnocené by roli VISION nechalo trvale prázdnou.
  clearCache();
  const families = ['alfa', 'beta', 'gama'];
  const pool = await buildCandidatePool(families, {
    vramMb: VRAM_24GB,
    concurrency: 2,
    html: 'alfa:7b 5GB beta:7b 5GB gama:7b 5GB',
  });
  assertEqual(pool.length, 3, 'všechny rodiny se dostanou do poolu');
  clearCache();
});

await testAsync('pool přenese metadata živého katalogu do role rankeru', async () => {
  clearCache();
  const familyMetadata = new Map([['novy', {
    updatedDays: 3, updatedLabel: '3 days ago', description: 'A capable local model.',
  }]]);
  const pool = await buildCandidatePool(['novy'], {
    vramMb: VRAM_24GB,
    html: 'novy:14b 9GB',
    familyMetadata,
  });
  assertEqual(pool[0].catalogUpdatedDays, 3);
  assertEqual(pool[0].catalogDescription, 'A capable local model.');
  clearCache();
});

await testAsync('rodina bez vhodné varianty do poolu nepatří', async () => {
  clearCache();
  const pool = await buildCandidatePool(['obri'], {
    vramMb: VRAM_24GB, html: 'obri:400b 900GB',
  });
  assertEqual(pool.length, 0);
  clearCache();
});

summary();
