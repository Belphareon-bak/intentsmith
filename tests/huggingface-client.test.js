// tests/huggingface-client.test.js — druhý zdroj faktů o modelech
// ══════════════════════════════════════════════════════════════════════════════
// Bez sítě: vše přes injektovaný `lookup` a syntetické výsledky hledání.
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';

import {
  buildSearchQuery, pickCanonicalRepo, enrichFromHuggingFace, clearCache,
} from '../src/upgrade/huggingface-client.js';

// ─── Dotaz ──────────────────────────────────────────────────────────────────

suite('buildSearchQuery');

test('z Ollama jména udělá dotaz se jménem a velikostí', () => {
  assertEqual(buildSearchQuery('qwen2.5-coder:32b'), 'qwen2.5-coder 32b');
  assertEqual(buildSearchQuery('llava:13b'), 'llava 13b');
});

test('tag latest se do dotazu nedostane', () => {
  assertEqual(buildSearchQuery('deepseek-r1-32b:latest'), 'deepseek-r1-32b');
});

test('u složeného tagu se bere jen velikost', () => {
  assertEqual(buildSearchQuery('qwen3:30b-a3b'), 'qwen3 30b');
});

test('generace se v dotazu zachová', () => {
  // `qwen2.5` a `qwen3` jsou různé modely — kdyby se tečka zahodila, hledání
  // by vracelo špatnou generaci.
  assert(buildSearchQuery('qwen2.5:32b').includes('2.5'), 'tečka v generaci zůstává');
});

test('neplatný vstup dá null', () => {
  assertEqual(buildSearchQuery(null), null);
  assertEqual(buildSearchQuery(''), null);
  assertEqual(buildSearchQuery(42), null);
});

// ─── Výběr kanonického repozitáře ───────────────────────────────────────────

suite('pickCanonicalRepo');

test('originál vyhraje nad populárnějším GGUF forkem', () => {
  // Přesně ten případ, kvůli kterému výběr existuje: kvantizované repozitáře
  // mívají víc stažení a jejich createdAt je datum kvantizace, ne vydání.
  const picked = pickCanonicalRepo([
    { id: 'unsloth/Qwen3.5-27B-GGUF', downloads: 9_000_000 },
    { id: 'Qwen/Qwen3.5-27B', downloads: 2_800_000 },
  ]);
  assertEqual(picked.id, 'Qwen/Qwen3.5-27B');
});

test('AWQ, FP8 a MLX varianty jsou také odvozené', () => {
  for (const derived of ['x/M-AWQ', 'x/M-FP8', 'x/M-MLX-4bit', 'x/M-GPTQ', 'x/M-int4']) {
    const picked = pickCanonicalRepo([
      { id: derived, downloads: 1_000_000 },
      { id: 'Qwen/M', downloads: 10 },
    ]);
    assertEqual(picked.id, 'Qwen/M', `${derived} nesmí vyhrát`);
  }
});

test('mezi neodvozenými rozhodne známý vydavatel', () => {
  const picked = pickCanonicalRepo([
    { id: 'nekdo/Model', downloads: 500_000 },
    { id: 'deepseek-ai/Model', downloads: 1_000 },
  ]);
  assertEqual(picked.id, 'deepseek-ai/Model');
});

test('mezi rovnocennými rozhodne popularita', () => {
  const picked = pickCanonicalRepo([
    { id: 'a/Model', downloads: 10 },
    { id: 'b/Model', downloads: 900 },
  ]);
  assertEqual(picked.id, 'b/Model');
});

test('prázdný vstup dá null', () => {
  assertEqual(pickCanonicalRepo([]), null);
  assertEqual(pickCanonicalRepo(null), null);
});

// ─── Obohacení ──────────────────────────────────────────────────────────────

suite('enrichFromHuggingFace');

function lookupFrom(map) {
  return async (name) => map[name] || null;
}

await testAsync('doplní chybějící datum vydání', async () => {
  const c = [{ name: 'x:7b' }];
  const s = await enrichFromHuggingFace(c, {
    lookup: lookupFrom({ 'x:7b': { repo: 'org/X', releaseDate: '2025-03-01', pipelineTag: 'text-generation', downloads: 10, likes: 1 } }),
  });
  assertEqual(s.datesFilled, 1);
  assertEqual(c[0].releaseDate, '2025-03-01');
  assertEqual(c[0].releaseDateSource, 'huggingface');
});

await testAsync('existující datum z katalogu nepřepíše', async () => {
  const c = [{ name: 'x:7b', releaseDate: '2024-01-01' }];
  await enrichFromHuggingFace(c, {
    lookup: lookupFrom({ 'x:7b': { repo: 'org/X', releaseDate: '2026-02-24', pipelineTag: null, downloads: 0, likes: 0 } }),
  });
  assertEqual(c[0].releaseDate, '2024-01-01', 'revidovaný katalog má přednost');
});

await testAsync('rozdíl data nad 90 dní nahlásí jako rozpor', async () => {
  const c = [{ name: 'x:7b', releaseDate: '2025-07-15' }];
  const s = await enrichFromHuggingFace(c, {
    lookup: lookupFrom({ 'x:7b': { repo: 'org/X', releaseDate: '2026-02-24', pipelineTag: null, downloads: 0, likes: 0 } }),
  });
  assertEqual(s.conflicts.length, 1);
  assertEqual(s.conflicts[0].field, 'releaseDate');
});

await testAsync('malý rozdíl data se za rozpor nepovažuje', async () => {
  const c = [{ name: 'x:7b', releaseDate: '2024-09-19' }];
  const s = await enrichFromHuggingFace(c, {
    lookup: lookupFrom({ 'x:7b': { repo: 'org/X', releaseDate: '2024-09-15', pipelineTag: null, downloads: 0, likes: 0 } }),
  });
  assertEqual(s.conflicts.length, 0);
});

await testAsync('multimodální pipeline doplní schopnost vision', async () => {
  const c = [{ name: 'x:27b', category: 'general' }];
  const s = await enrichFromHuggingFace(c, {
    lookup: lookupFrom({ 'x:27b': { repo: 'Qwen/X', releaseDate: null, pipelineTag: 'image-text-to-text', downloads: 5, likes: 5 } }),
  });
  assertEqual(s.visionFound, 1);
  assert(c[0].capabilities.includes('vision'), 'schopnost se doplní');
  assertEqual(s.conflicts.length, 1, 'a rozpor s kategorií se nahlásí');
});

await testAsync('textová pipeline schopnost vision nepřidá', async () => {
  const c = [{ name: 'x:7b', category: 'general' }];
  const s = await enrichFromHuggingFace(c, {
    lookup: lookupFrom({ 'x:7b': { repo: 'org/X', releaseDate: null, pipelineTag: 'text-generation', downloads: 0, likes: 0 } }),
  });
  assertEqual(s.visionFound, 0);
  assert(!(c[0].capabilities || []).includes('vision'), 'nic se nepřidá');
});

await testAsync('adopce se zaznamená, ale benchmarky zůstanou netknuté', async () => {
  // Popularita není kvalita — starší model má víc stažení jen proto, že je déle
  // venku. Kdyby se z ní dělalo skóre, vznikla by táž vada jako u míchání
  // whatllm a katalogu.
  const original = { mmlu: 0.7 };
  const c = [{ name: 'x:7b', benchmarks: original, benchmarkConfidence: 0.55 }];
  await enrichFromHuggingFace(c, {
    lookup: lookupFrom({ 'x:7b': { repo: 'org/X', releaseDate: null, pipelineTag: null, downloads: 9_999_999, likes: 9999 } }),
  });
  assertEqual(c[0].benchmarks, original, 'benchmarky se nemění');
  assertEqual(c[0].benchmarkConfidence, 0.55, 'jistota se nemění');
  assertEqual(c[0].adoption.downloads, 9_999_999);
});

await testAsync('nedohledaný model projde beze změny', async () => {
  const c = [{ name: 'neznamy:7b' }];
  const s = await enrichFromHuggingFace(c, { lookup: async () => null });
  assertEqual(s.resolved, 0);
  assertEqual(c[0].hfRepo, undefined);
});

await testAsync('prázdný seznam nespadne', async () => {
  const s = await enrichFromHuggingFace([], { lookup: async () => null });
  assertEqual(s.resolved, 0);
  assertEqual(s.conflicts.length, 0);
});

clearCache();
summary();
