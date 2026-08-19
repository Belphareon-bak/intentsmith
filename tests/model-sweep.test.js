// tests/model-sweep.test.js — fáze 0 a 1: vyjmenování rodin a řazení kandidátů
// ══════════════════════════════════════════════════════════════════════════════
// Bez sítě: parsování z fixture HTML, řazení nad syntetickým poolem.
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';

import {
  fetchLibraryFamilies, parseTagsPage, mightFit, comfortablyFits,
  preferredTagForFamily, formatRunsHere, rankCandidates, clearCache,
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

suite('rankCandidates');

const POOL = [
  { name: 'qwen3.8:latest', family: 'qwen3.8', tag: 'latest', sizeGB: 18 },
  { name: 'devstral-2:latest', family: 'devstral-2', tag: 'latest', sizeGB: 15 },
  { name: 'huge:400b', family: 'huge', tag: '400b', sizeGB: 400 },
  { name: 'qwen3:14b', family: 'qwen3', tag: '14b', sizeGB: 9 },
];

test('vyřadí, co se nemůže vejít', () => {
  const out = rankCandidates(POOL, { vramMb: VRAM_24GB });
  assert(!out.some(c => c.family === 'huge'), '400 GB nemá být v seznamu');
});

test('vyřadí, co už je nainstalované', () => {
  const out = rankCandidates(POOL, { vramMb: VRAM_24GB, installed: ['qwen3:14b'] });
  assert(!out.some(c => c.name === 'qwen3:14b'), 'nainstalovaný model není kandidát');
});

test('shoda jména je tolerantní k :latest', () => {
  const out = rankCandidates(POOL, { vramMb: VRAM_24GB, installed: ['qwen3.8'] });
  assert(!out.some(c => c.family === 'qwen3.8'), 'qwen3.8 ≡ qwen3.8:latest');
});

test('horší externí hodnocení než stávající se nezkouší', () => {
  const out = rankCandidates(POOL, {
    vramMb: VRAM_24GB,
    incumbentQuality: 20,
    qualityOf: e => (e.family === 'qwen3.8' ? 57.7 : 5),
  });
  assertEqual(out.length, 1);
  assertEqual(out[0].family, 'qwen3.8');
});

test('řadí podle hodnocení sestupně', () => {
  const q = { 'qwen3.8': 57.7, 'devstral-2': 19.2, qwen3: 8.5 };
  const out = rankCandidates(POOL, { vramMb: VRAM_24GB, qualityOf: e => q[e.family] ?? null });
  assertEqual(out[0].family, 'qwen3.8');
  assert(out[0].priority > out[1].priority, 'priorita musí klesat');
});

test('starší model než stávající se nezkouší', () => {
  const out = rankCandidates(POOL, {
    vramMb: VRAM_24GB,
    incumbentReleaseDate: '2026-01-01',
    releaseDateOf: e => (e.family === 'qwen3.8' ? '2026-08-05' : '2025-01-01'),
  });
  assertEqual(out.length, 1);
  assertEqual(out[0].family, 'qwen3.8');
});

test('rezerva ve velikosti zvedne prioritu', () => {
  const tight = rankCandidates([{ name: 'a:1', family: 'a', sizeGB: 18 }], { vramMb: VRAM_24GB });
  const roomy = rankCandidates([{ name: 'b:1', family: 'b', sizeGB: 10 }], { vramMb: VRAM_24GB });
  assert(roomy[0].priority > tight[0].priority, 'pohodlná velikost je lepší kandidát');
  assert(tight[0].reasons.some(r => /těsná/.test(r)), 'těsnost se musí objevit v důvodech');
});

test('prázdný pool nespadne', () => {
  assertEqual(rankCandidates([], { vramMb: VRAM_24GB }).length, 0);
});

summary();
