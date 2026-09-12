// Metadata lokálních modelů a faktická způsobilost rolí.
// ══════════════════════════════════════════════════════════════════════════════
// Obohacení slouží discovery a plánování evalů; samo neurčuje kvalitu.
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';

import {
  catalogLookupKey, buildCatalogIndex, enrichLocalCandidateMetadata,
} from '../src/upgrade/catalog-metadata.js';
import { checkRoleEligibility } from '../src/upgrade/candidate-eligibility.js';
import {
  checkModelEvaluationApplicability,
  createRoleEvaluationPlans,
} from '../src/eval/role-evaluation-plan.js';
import { parseModelName } from '../src/upgrade/model-profiles.js';
import { parseModelNameExtended } from '../src/upgrade/model-family-extensions.js';
import { normalizeInstalledModel } from '../src/upgrade/model-inventory.js';
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
    { name: 'a:7b', releaseDate: '2025-01-01' },
    { name: 'a-7b', releaseDate: '2026-01-01' },
  ]);
  assertEqual(index.get('a:7b').releaseDate, '2025-01-01');
});

test('nepole vrátí prázdný index', () => {
  assertEqual(buildCatalogIndex(null).size, 0);
});

// ─── Faktická metadata ──────────────────────────────────────────────────────

suite("enrichLocalCandidateMetadata");

function localCandidate(name) {
  const parsed = parseModelNameExtended(name);
  return {
    name, family: parsed.family, category: parsed.category,
    params: parsed.params, source: "local", installed: true,
  };
}

test("přesná shoda doplní metadata bez quality score", () => {
  const candidate = localCandidate("llava:13b");
  const result = enrichLocalCandidateMetadata([candidate], CATALOG);
  assertEqual(result.exact, 1);
  assert(candidate.releaseDate != null);
  assertEqual(candidate.metadataSource, "catalog-exact");
  assertEqual("benchmarks" in candidate, false);
});

test("shoda funguje přes odlišný zápis velikosti", () => {
  const candidate = localCandidate("deepseek-r1-32b");
  const result = enrichLocalCandidateMetadata([candidate], CATALOG);
  assertEqual(result.exact, 1);
  assert(candidate.capabilities != null);
});

test("neznámý model zůstane neobohacený a je nahlášený", () => {
  const candidate = localCandidate("naprosto-neznamy:9b");
  const result = enrichLocalCandidateMetadata([candidate], CATALOG);
  assertEqual(result.unmatched[0], candidate.name);
  assertEqual("benchmarks" in candidate, false);
});

test("údaj z Ollama se nepřepíše", () => {
  const candidate = localCandidate("llava:13b");
  candidate.baseVramMb = 12345;
  enrichLocalCandidateMetadata([candidate], CATALOG);
  assertEqual(candidate.baseVramMb, 12345);
});

// ─── Způsobilost pro roli ───────────────────────────────────────────────────

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

test('evaluation applicability ignores ranking preferences and keeps technical constraints', () => {
  const plans = createRoleEvaluationPlans({ repeats: 1 });
  const codeForChat = checkModelEvaluationApplicability(
    { name: 'qwen3-coder:latest', params: 30, category: 'code' },
    plans.CHAT,
  );
  assertEqual(codeForChat.applicable, true);

  const textForVision = checkModelEvaluationApplicability(
    { name: 'qwen3.5:27b', params: 27, category: 'general', capabilities: [] },
    plans.VISION,
  );
  assertEqual(textForVision.applicable, false);
  assertEqual(textForVision.reasonCode, 'MODEL_VISION_CAPABILITY_REQUIRED');
});

test('one inventory normalizer repairs old parser metadata and keeps numeric params', () => {
  const normalized = normalizeInstalledModel({
    name: 'qwen3-coder:latest',
    params: '30B',
    family: 'qwen',
    category: 'general',
    digest: `sha256:${'a'.repeat(64)}`,
  });
  assertEqual(normalized.family, 'qwen-coder');
  assertEqual(normalized.category, 'code');
  assertEqual(normalized.params, 30);
  assertEqual(normalized.paramsLabel, '30B');
});

test('multimodal capability does not overwrite the primary ranking category', () => {
  const normalized = normalizeInstalledModel({
    name: 'qwen3.5:27b', capabilities: ['completion', 'vision'],
  });
  assertEqual(normalized.category, 'general');
  assertEqual(normalized.capabilities.includes('vision'), true);
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

test('nové coding, vision a negenerativní rodiny se nepropadnou do unknown', () => {
  assertEqual(parseModelNameExtended('north-mini-code-1.0:latest').category, 'code');
  assertEqual(parseModelNameExtended('qwen3-coder-next:latest').category, 'code');
  assertEqual(parseModelNameExtended('qwen3-vl:32b').category, 'vision');
  assertEqual(parseModelNameExtended('minicpm-v4.6:latest').category, 'vision');
  assertEqual(parseModelNameExtended('bge-m3:latest').category, 'embedding');
  assertEqual(parseModelNameExtended('glm-ocr:latest').category, 'ocr');
  assertEqual(parseModelNameExtended('granite4.1-guardian:8b').category, 'safety');
  assertEqual(parseModelNameExtended('medgemma:27b').category, 'vision');
  assert(checkRoleEligibility(parseModelNameExtended('ornith-1.5:9b'), 'VISION').eligible);
  assert(!checkRoleEligibility(parseModelNameExtended('ornith-1.5:9b'), 'R1').eligible);
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

summary();
