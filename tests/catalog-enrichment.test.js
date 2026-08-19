// tests/catalog-enrichment.test.js — obohacení lokálních modelů + způsobilost rolí
// ══════════════════════════════════════════════════════════════════════════════
// Kryje strukturální vadu, kvůli které lokální (nainstalované) modely nedostaly
// z katalogu žádná metadata, takže jejich skóre řídila pouze velikost, a dále
// tvrdý filtr způsobilosti pro roli.
// ══════════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import { MODEL_FAILOVER_PROOF_POLICY_SOURCE_PINS as SOURCE_PINS }
  from '../src/upgrade/model-failover-proof-policy.js';

import {
  catalogLookupKey, buildCatalogIndex, enrichLocalCandidates,
} from '../src/upgrade/catalog-enrichment.js';
import { checkRoleEligibility, scoreModel } from '../src/upgrade/model-ranker.js';
import { parseModelName } from '../src/upgrade/model-profiles.js';
import { parseModelNameExtended } from '../src/upgrade/model-family-extensions.js';
import { CATALOG } from '../src/upgrade/model-catalog.js';

// ─── Lookup klíč ────────────────────────────────────────────────────────────

suite('catalogLookupKey — sjednocení zápisu jména');

test('zahodí :latest', () => {
  assertEqual(catalogLookupKey('qwen3:14b'), 'qwen3:14b');
  assertEqual(catalogLookupKey('deepseek-r1-32b:latest'), 'deepseek-r1:32b');
});

test('sjednotí oddělovač velikosti na dvojtečku', () => {
  assertEqual(catalogLookupKey('deepseek-r1-32b'), 'deepseek-r1:32b');
  assertEqual(catalogLookupKey('deepseek-r1:32b'), 'deepseek-r1:32b');
});

test('zachová složený tag za velikostí', () => {
  assertEqual(catalogLookupKey('qwen3-30b-a3b'), 'qwen3:30b-a3b');
  assertEqual(catalogLookupKey('qwen3:30b-a3b'), 'qwen3:30b-a3b');
});

test('model bez velikosti v názvu projde beze změny', () => {
  assertEqual(catalogLookupKey('glm-4.7-flash'), 'glm-4.7-flash');
});

test('idempotence — klíč z klíče je týž klíč', () => {
  for (const name of ['deepseek-r1-32b', 'qwen3-30b-a3b:latest', 'glm-4.7-flash', 'llava:13b']) {
    assertEqual(catalogLookupKey(catalogLookupKey(name)), catalogLookupKey(name));
  }
});

test('neplatný vstup dá null', () => {
  assertEqual(catalogLookupKey(null), null);
  assertEqual(catalogLookupKey(''), null);
  assertEqual(catalogLookupKey(42), null);
});

test('dvě neplatné hodnoty se nikdy neshodnou', () => {
  assert(catalogLookupKey(undefined) === null && catalogLookupKey('') === null,
    'obě null, takže porovnání klíčů je nesmí spárovat');
});

// ─── Index katalogu ─────────────────────────────────────────────────────────

suite('buildCatalogIndex');

test('indexuje reálný katalog bez kolizí prvních zápisů', () => {
  const index = buildCatalogIndex(CATALOG);
  assert(index.size > 0, 'index nesmí být prázdný');
  assert(index.has('llava:13b'), 'llava:13b musí být dohledatelná');
  assert(index.has('qwen3.5:27b'), 'qwen3.5:27b musí být dohledatelná');
});

test('první zápis vyhrává', () => {
  const index = buildCatalogIndex([
    { name: 'a:7b', benchmarks: { mmlu: 0.1 } },
    { name: 'a-7b', benchmarks: { mmlu: 0.9 } },
  ]);
  assertEqual(index.get('a:7b').benchmarks.mmlu, 0.1);
});

test('nepole vrátí prázdný index', () => {
  assertEqual(buildCatalogIndex(null).size, 0);
});

// ─── Obohacení ──────────────────────────────────────────────────────────────

suite('enrichLocalCandidates');

function localCandidate(name) {
  const parsed = parseModelNameExtended(name);
  return {
    name, family: parsed.family, category: parsed.category,
    params: parsed.params, source: 'local', installed: true,
  };
}

test('přesná shoda doplní benchmarky i datum vydání', () => {
  const c = localCandidate('llava:13b');
  const res = enrichLocalCandidates([c], CATALOG);
  assertEqual(res.exact, 1);
  assert(c.benchmarks != null, 'benchmarky musí být doplněné');
  assert(c.releaseDate != null, 'releaseDate musí být doplněné');
  assertEqual(c.enrichmentSource, 'catalog-exact');
  assertEqual(c.benchmarkConfidence, 1.0);
});

test('shoda funguje i přes odlišný zápis velikosti', () => {
  const c = localCandidate('deepseek-r1-32b');
  enrichLocalCandidates([c], CATALOG);
  assert(c.benchmarks != null, 'deepseek-r1-32b se musí spárovat s deepseek-r1:32b');
});

test('katalogová položka smí přiznat nižší jistotu', () => {
  const c = localCandidate('x:7b');
  enrichLocalCandidates([c], [
    { name: 'x:7b', params: 7, benchmarks: { mmlu: 0.5 }, benchmarkConfidence: 0.4, releaseDate: '2025-01-01' },
  ]);
  assertEqual(c.benchmarkConfidence, 0.4);
});

test('jistota se ořízne do rozsahu 0–1', () => {
  const c = localCandidate('x:7b');
  enrichLocalCandidates([c], [
    { name: 'x:7b', params: 7, benchmarks: { mmlu: 0.5 }, benchmarkConfidence: 5, releaseDate: '2025-01-01' },
  ]);
  assertEqual(c.benchmarkConfidence, 1);
});

test('bez přesné shody se interpoluje uvnitř rodiny', () => {
  const c = localCandidate('qwen3:22b'); // v katalogu není, rodina qwen ano
  const res = enrichLocalCandidates([c], CATALOG);
  assertEqual(res.estimated, 1);
  assert(c.benchmarks != null, 'interpolace musí dát benchmarky');
  assert(c.benchmarkConfidence < 1, 'odhad nesmí tvrdit plnou jistotu');
  assertEqual(c.enrichmentSource, 'family-scaling');
});

test('odhad nevymýšlí datum vydání', () => {
  const c = localCandidate('qwen3:22b');
  enrichLocalCandidates([c], CATALOG);
  assertEqual(c.releaseDate, null);
});

test('neznámá rodina zůstane neobohacená a je nahlášená', () => {
  const c = localCandidate('naprosto-neznamy:9b');
  const res = enrichLocalCandidates([c], CATALOG);
  assertEqual(res.unmatched.length, 1);
  assertEqual(res.unmatched[0], 'naprosto-neznamy:9b');
  assert(c.benchmarks == null, 'bez podkladu se nesmí nic vymyslet');
});

test('údaj z Ollama se nepřepíše katalogovým odhadem', () => {
  const c = localCandidate('llava:13b');
  c.baseVramMb = 12345;
  enrichLocalCandidates([c], CATALOG);
  assertEqual(c.baseVramMb, 12345);
});

test('prázdný katalog nahlásí vše jako nepokryté', () => {
  const c = localCandidate('llava:13b');
  const res = enrichLocalCandidates([c], []);
  assertEqual(res.unmatched.length, 1);
});

test('prázdný seznam kandidátů nespadne', () => {
  const res = enrichLocalCandidates([], CATALOG);
  assertEqual(res.exact, 0);
  assertEqual(res.unmatched.length, 0);
});

test('celý reálný katalog pokryje všechny nainstalované rodiny', () => {
  const installed = [
    'glm-4.7-flash:latest', 'qwen3-coder:30b', 'llava-llama3:8b', 'qwq:32b',
    'phi4-reasoning:14b', 'devstral-small-2:24b', 'qwen3:14b', 'qwen3.5:27b',
    'llava:13b', 'qwen2.5-coder:32b', 'qwen2.5:32b', 'deepseek-r1-32b:latest',
    'qwen3-30b-a3b:latest',
  ].map(localCandidate);
  const res = enrichLocalCandidates(installed, CATALOG);
  assertEqual(res.unmatched.length, 0, `bez podkladu zůstalo: ${res.unmatched.join(', ')}`);
});

// ─── Dopad na skóre ─────────────────────────────────────────────────────────

suite('dopad obohacení na skóre');

test('obohacený model skóruje výš než neobohacený', () => {
  const bare = localCandidate('qwen3.5:27b');
  const rich = localCandidate('qwen3.5:27b');
  enrichLocalCandidates([rich], CATALOG);

  const ctx = { gpuVramMb: 24576, referenceParams: 27, roleBindings: {} };
  const bareScore = scoreModel(bare, 'CODE', ctx).totalScore;
  const richScore = scoreModel(rich, 'CODE', ctx).totalScore;
  assert(richScore > bareScore,
    `obohacený (${richScore.toFixed(4)}) musí být nad neobohaceným (${bareScore.toFixed(4)})`);
});

test('neobohacený kandidát nemá benchmarkovou složku — regresní kontrola', () => {
  // Podpis původní vady: benchmark je 0, takže 35 % váhy je mrtvých a
  // o pořadí rozhodují jen hardwareFit, maturity a speed.
  const ctx = { gpuVramMb: 24576, referenceParams: 27, roleBindings: {} };
  const c = localCandidate('qwen3.5:27b');
  assertEqual(scoreModel(c, 'CODE', ctx).breakdown.benchmark, 0);

  enrichLocalCandidates([c], CATALOG);
  assert(scoreModel(c, 'CODE', ctx).breakdown.benchmark > 0,
    'po obohacení musí benchmarková složka reálně přispívat');
});

test('bez obohacení jsou skóre natěsnaná, po obohacení rozprostřená', () => {
  // Druhý podpis vady: bez metadat se všechny modely vejdou do úzkého pásma,
  // takže „nejlepší“ model je otázka šumu.
  const names = ['qwen3:14b', 'qwen3.5:27b', 'llava:13b', 'qwen2.5-coder:32b', 'deepseek-r1-32b'];
  const ctx = { gpuVramMb: 24576, referenceParams: 27, roleBindings: {} };

  const bare = names.map(localCandidate);
  const bareScores = bare.map(c => scoreModel(c, 'CODE', ctx).totalScore);
  const bareSpread = Math.max(...bareScores) - Math.min(...bareScores);
  assert(bareSpread < 0.10, `neobohacené skóre se vejde do ${bareSpread.toFixed(3)} — proto je obohacení povinné`);

  const rich = names.map(localCandidate);
  enrichLocalCandidates(rich, CATALOG);
  const richScores = rich.map(c => scoreModel(c, 'CODE', ctx).totalScore);
  const richSpread = Math.max(...richScores) - Math.min(...richScores);
  assert(richSpread > bareSpread * 2,
    `po obohacení musí rozptyl výrazně vzrůst (${bareSpread.toFixed(3)} → ${richSpread.toFixed(3)})`);
});

// ─── Způsobilost pro roli ───────────────────────────────────────────────────

suite('checkRoleEligibility');

test('textový model je pro VISION nezpůsobilý', () => {
  const r = checkRoleEligibility({ name: 'qwen3:14b', params: 14, category: 'general' }, 'VISION');
  assertEqual(r.eligible, false);
  assert(/obraz/.test(r.reason), 'důvod má zmínit obraz');
});

test('vision model je pro VISION způsobilý', () => {
  const r = checkRoleEligibility({ name: 'llava:13b', params: 13, category: 'vision' }, 'VISION');
  assertEqual(r.eligible, true);
});

test('schopnost vision v capabilities stačí i bez kategorie', () => {
  const r = checkRoleEligibility(
    { name: 'x:13b', params: 13, category: 'general', capabilities: ['vision'] }, 'VISION');
  assertEqual(r.eligible, true);
});

test('model pod minimem parametrů je nezpůsobilý', () => {
  const r = checkRoleEligibility({ name: 'llava:8b', params: 8, category: 'vision' }, 'D1');
  assertEqual(r.eligible, false);
  assert(/minimum/.test(r.reason), 'důvod má uvést minimum');
});

test('model nad maximem parametrů je nezpůsobilý', () => {
  const r = checkRoleEligibility({ name: 'x:405b', params: 405, category: 'general' }, 'CHAT');
  assertEqual(r.eligible, false);
  assert(/maximum/.test(r.reason), 'důvod má uvést maximum');
});

test('neznámá velikost model nevyřadí', () => {
  const r = checkRoleEligibility({ name: 'x', params: null, category: 'general' }, 'D1');
  assertEqual(r.eligible, true);
});

test('neznámá role nikoho nevyřazuje', () => {
  const r = checkRoleEligibility({ name: 'x:7b', params: 7 }, 'NEEXISTUJICI');
  assertEqual(r.eligible, true);
});

test('měkké požadavky nevyřazují — jinak by seznam kandidátů zůstal prázdný', () => {
  // D1 vyžaduje 'reasoning', 'instruction-following', 'json-output', které
  // katalog u drtivé většiny položek neuvádí.
  const r = checkRoleEligibility({ name: 'qwen3.5:27b', params: 27, category: 'general' }, 'D1');
  assertEqual(r.eligible, true);
});

// ─── Rodiny modelů ──────────────────────────────────────────────────────────

suite('parseModelNameExtended — doplněné rodiny');

test('qwen3-coder je code, ne general', () => {
  // Základní tabulka se trefí do prefixu `qwen3` dřív, takže coder model
  // spadne do `general`. Rozšíření to musí přebít.
  assertEqual(parseModelName('qwen3-coder:30b').category, 'general');
  const p = parseModelNameExtended('qwen3-coder:30b');
  assertEqual(p.family, 'qwen-coder');
  assertEqual(p.category, 'code');
});

test('qwen3 zůstává general', () => {
  const p = parseModelNameExtended('qwen3:14b');
  assertEqual(p.family, 'qwen');
  assertEqual(p.category, 'general');
});

test('qwq je reasoning', () => {
  assertEqual(parseModelNameExtended('qwq:32b').category, 'reasoning');
});

test('devstral je code', () => {
  assertEqual(parseModelNameExtended('devstral-small-2:24b').category, 'code');
});

test('glm má rodinu a verzi', () => {
  const p = parseModelNameExtended('glm-4.7-flash');
  assertEqual(p.family, 'glm');
  assertEqual(p.version, '4.7');
});

test('dosavadní rodiny se nerozbily', () => {
  assertEqual(parseModelNameExtended('qwen2.5-coder:32b').family, 'qwen-coder');
  assertEqual(parseModelNameExtended('deepseek-r1-32b').family, 'deepseek-r1');
  assertEqual(parseModelNameExtended('llava:13b').category, 'vision');
  assertEqual(parseModelNameExtended('llama3.1:8b').version, '3.1');
  assertEqual(parseModelNameExtended('mistral-small:22b').family, 'mistral');
});

test('rozšíření nemění výsledek základního parseru pro známé rodiny', () => {
  for (const name of ['qwen2.5:32b', 'llava:13b', 'llama3.1:8b', 'phi4:14b', 'gemma3:27b']) {
    assertEqual(parseModelNameExtended(name).family, parseModelName(name).family);
    assertEqual(parseModelNameExtended(name).category, parseModelName(name).category);
  }
});

test('neplatný vstup projde stejně jako u základního parseru', () => {
  assertEqual(parseModelNameExtended(null).family, 'unknown');
  assertEqual(parseModelNameExtended('').family, 'unknown');
});

test('model-profiles.js zůstává bajtově nedotčený kvůli pinu', () => {
  // Rozšíření rodin schválně nesahá do připnutého souboru — kdyby někdo
  // tabulku vrátil zpátky do profilů, spadne to tady a ne až ve fail-closed
  // proof policy.
  const bytes = readFileSync(new URL('../src/upgrade/model-profiles.js', import.meta.url));
  assertEqual(bytes.length, SOURCE_PINS.modelProfiles.byteLength);
  assertEqual(createHash('sha256').update(bytes).digest('hex'), SOURCE_PINS.modelProfiles.sha256);
});

summary();
