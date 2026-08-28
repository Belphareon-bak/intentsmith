// WhatLLM Client — Unit Tests
// ══════════════════════════════════════════════════════════════════════════════

import {
  parseModels,
  parseWhatllmName,
  parseOllamaName,
  matchModels,
  clearCache,
} from '../src/upgrade/whatllm-client.js';

// ─── Harness ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, msg) {
  if (condition) { passed++; }
  else { failed++; failures.push(msg); console.error(`  FAIL: ${msg}`); }
}

function assertEq(actual, expected, msg) {
  if (actual === expected) { passed++; }
  else { failed++; failures.push(`${msg}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`); console.error(`  FAIL: ${msg}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`); }
}

function assertApprox(actual, expected, tolerance, msg) {
  if (Math.abs(actual - expected) <= tolerance) { passed++; }
  else { failed++; failures.push(`${msg}: got ${actual}, expected ~${expected} (±${tolerance})`); console.error(`  FAIL: ${msg}: got ${actual}, expected ~${expected}`); }
}

// ─── Sample Data ─────────────────────────────────────────────────────────────

const SAMPLE_WHATLLM_MODELS = [
  { name: 'Qwen3.5 27B', qualityIndex: 37.18, creator: 'Alibaba', contextWindow: 262144, outputSpeed: 91.02 },
  { name: 'Qwen2.5 72B', qualityIndex: 32.50, creator: 'Alibaba', contextWindow: 32768, outputSpeed: 45.00 },
  { name: 'Qwen2.5 7B', qualityIndex: 18.00, creator: 'Alibaba', contextWindow: 32768, outputSpeed: 120.00 },
  { name: 'Llama 3.1 Instruct 70B', qualityIndex: 12.47, creator: 'Meta', contextWindow: 128000, outputSpeed: 31.16 },
  { name: 'Llama 3.1 Instruct 8B', qualityIndex: 5.20, creator: 'Meta', contextWindow: 128000, outputSpeed: 95.00 },
  { name: 'DeepSeek V3.2', qualityIndex: 32.09, creator: 'DeepSeek', contextWindow: 128000, outputSpeed: 86.07 },
  { name: 'Mistral Large 2', qualityIndex: 22.50, creator: 'Mistral', contextWindow: 128000, outputSpeed: 55.00 },
  { name: 'Gemma 2 27B', qualityIndex: 15.30, creator: 'Google', contextWindow: 8192, outputSpeed: 70.00 },
  { name: 'Phi-4 14B', qualityIndex: 19.80, creator: 'Microsoft', contextWindow: 16384, outputSpeed: 85.00 },
  { name: 'Claude Sonnet 4.6', qualityIndex: 51.72, creator: 'Anthropic', contextWindow: 200000, outputSpeed: 68.00 },
  { name: 'GPT-5.4 mini', qualityIndex: 48.10, creator: 'OpenAI', contextWindow: 400000, outputSpeed: 172.46 },
  // Intentional: models with no params (cloud-only) — should NOT match Ollama models with params
  { name: 'Claude Opus 4.5', qualityIndex: 55.00, creator: 'Anthropic', contextWindow: 200000, outputSpeed: 30.00 },
  // Duplicate family, different size
  { name: 'Llama 3.3 70B', qualityIndex: 16.00, creator: 'Meta', contextWindow: 131072, outputSpeed: 40.00 },
  // Edge: very large model
  { name: 'Llama 3.1 Instruct 405B', qualityIndex: 25.00, creator: 'Meta', contextWindow: 128000, outputSpeed: 10.00 },
  // Padding to hit MIN_MODELS threshold (need >= 20)
  { name: 'Test Model A 1B', qualityIndex: 2.00, creator: 'Test', contextWindow: 4096, outputSpeed: 200.00 },
  { name: 'Test Model B 3B', qualityIndex: 4.00, creator: 'Test', contextWindow: 4096, outputSpeed: 180.00 },
  { name: 'Test Model C 13B', qualityIndex: 10.00, creator: 'Test', contextWindow: 8192, outputSpeed: 100.00 },
  { name: 'Test Model D 34B', qualityIndex: 20.00, creator: 'Test', contextWindow: 16384, outputSpeed: 60.00 },
  { name: 'Test Model E 65B', qualityIndex: 28.00, creator: 'Test', contextWindow: 32768, outputSpeed: 30.00 },
  { name: 'Test Model F 120B', qualityIndex: 35.00, creator: 'Test', contextWindow: 65536, outputSpeed: 15.00 },
  { name: 'Test Model G 180B', qualityIndex: 40.00, creator: 'Test', contextWindow: 131072, outputSpeed: 8.00 },
];

// ═══════════════════════════════════════════════════════════════════════════
// 1. parseWhatllmName
// ═══════════════════════════════════════════════════════════════════════════

console.log('── 1. parseWhatllmName ──');
{
  const r1 = parseWhatllmName('Qwen3.5 27B');
  assertEq(r1.family, 'qwen', 'Qwen3.5 family');
  assertEq(r1.params, 27, 'Qwen3.5 params');

  const r2 = parseWhatllmName('Llama 3.1 Instruct 70B');
  assertEq(r2.family, 'llama', 'Llama family');
  assertEq(r2.params, 70, 'Llama params');

  const r3 = parseWhatllmName('DeepSeek V3.2');
  assertEq(r3.family, 'deepseek', 'DeepSeek family');
  assertEq(r3.params, null, 'DeepSeek no params');

  const r4 = parseWhatllmName('Mistral Large 2');
  assertEq(r4.family, 'mistral', 'Mistral family');
  assertEq(r4.params, null, 'Mistral no params (2 is not followed by B)');

  const r5 = parseWhatllmName('Phi-4 14B');
  assertEq(r5.family, 'phi', 'Phi family');
  assertEq(r5.params, 14, 'Phi params');

  const r6 = parseWhatllmName('Gemma 2 27B');
  assertEq(r6.family, 'gemma', 'Gemma family');
  assertEq(r6.params, 27, 'Gemma params');

  const r7 = parseWhatllmName(null);
  assertEq(r7, null, 'null input returns null');

  const r8 = parseWhatllmName('');
  assertEq(r8, null, 'empty input returns null');

  // Edge: "Llama 3.1 Instruct 405B" — very large
  const r9 = parseWhatllmName('Llama 3.1 Instruct 405B');
  assertEq(r9.params, 405, 'large param count');
  assertEq(r9.family, 'llama', 'large model family');

  // Edge: "Qwen2.5 7B" — small
  const r10 = parseWhatllmName('Qwen2.5 7B');
  assertEq(r10.params, 7, 'small param count');
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. parseOllamaName
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n── 2. parseOllamaName ──');
{
  const r1 = parseOllamaName('qwen2.5:72b');
  assertEq(r1.family, 'qwen', 'qwen family');
  assertEq(r1.version, '2.5', 'qwen version');
  assertEq(r1.params, 72, 'qwen params');

  const r2 = parseOllamaName('llama3.1:70b');
  assertEq(r2.family, 'llama', 'llama family');
  assertEq(r2.version, '3.1', 'llama version');
  assertEq(r2.params, 70, 'llama params');

  const r3 = parseOllamaName('deepseek-r1:32b');
  assertEq(r3.family, 'deepseek', 'deepseek-r1 family');
  assertEq(r3.params, 32, 'deepseek params');

  const r4 = parseOllamaName('mistral:7b');
  assertEq(r4.family, 'mistral', 'mistral family');
  assertEq(r4.params, 7, 'mistral params');

  const r5 = parseOllamaName('phi4:14b');
  assertEq(r5.family, 'phi', 'phi family');
  assertEq(r5.params, 14, 'phi params');

  const r6 = parseOllamaName('gemma2:27b');
  assertEq(r6.family, 'gemma', 'gemma2 family');
  assertEq(r6.params, 27, 'gemma2 params');

  const r7 = parseOllamaName(null);
  assertEq(r7, null, 'null returns null');

  const r8 = parseOllamaName('qwen2.5:3b');
  assertEq(r8.params, 3, 'small ollama params');
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. matchModels — strict family + params matching
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n── 3. matchModels ──');
{
  const candidates = [
    { name: 'qwen2.5:72b' },
    { name: 'qwen2.5:7b' },
    { name: 'llama3.1:70b' },
    { name: 'llama3.1:8b' },
    { name: 'deepseek-r1:32b' },
    { name: 'gemma2:27b' },
    { name: 'phi4:14b' },
    { name: 'some-unknown:13b' },
  ];

  const matches = matchModels(SAMPLE_WHATLLM_MODELS, candidates);

  // qwen2.5:72b should match "Qwen2.5 72B" (exact family + params)
  assert(matches.has('qwen2.5:72b'), 'qwen2.5:72b matched');
  assertApprox(matches.get('qwen2.5:72b').qualityIndex, 32.50, 0.01, 'qwen72b quality');

  // qwen2.5:7b should match "Qwen2.5 7B"
  assert(matches.has('qwen2.5:7b'), 'qwen2.5:7b matched');
  assertApprox(matches.get('qwen2.5:7b').qualityIndex, 18.00, 0.01, 'qwen7b quality');

  // llama3.1:70b should match "Llama 3.1 Instruct 70B" (closest 70B in llama family)
  assert(matches.has('llama3.1:70b'), 'llama3.1:70b matched');
  assertApprox(matches.get('llama3.1:70b').qualityIndex, 12.47, 0.01, 'llama70b quality');

  // llama3.1:8b should match "Llama 3.1 Instruct 8B"
  assert(matches.has('llama3.1:8b'), 'llama3.1:8b matched');
  assertApprox(matches.get('llama3.1:8b').qualityIndex, 5.20, 0.01, 'llama8b quality');

  // gemma2:27b should match "Gemma 2 27B"
  assert(matches.has('gemma2:27b'), 'gemma2:27b matched');

  // phi4:14b should match "Phi-4 14B"
  assert(matches.has('phi4:14b'), 'phi4:14b matched');

  // unknown model should NOT match
  assert(!matches.has('some-unknown:13b'), 'unknown model not matched');
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. matchModels — rejects params mismatch >10%
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n── 4. matchModels rejects param mismatch ──');
{
  const whatllm = [
    ...SAMPLE_WHATLLM_MODELS,
  ];
  const candidates = [
    { name: 'qwen2.5:32b' },  // Qwen family but 32B != 72B and != 7B and != 27B
  ];

  const matches = matchModels(whatllm, candidates);
  // qwen2.5:32b has no close match in whatllm (27B is 15.6% off from 32B → >10%)
  assert(!matches.has('qwen2.5:32b'), 'qwen32b not matched (27B is >10% off)');
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. matchModels — accepts params within 10%
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n── 5. matchModels accepts close params ──');
{
  // 72B ollama vs 70B whatllm: delta = 2/72 = 2.8% → should match
  const whatllm = [
    { name: 'Llama 3.1 70B', qualityIndex: 12.47, creator: 'Meta', contextWindow: 128000, outputSpeed: 31.0 },
    ...Array.from({ length: 20 }, (_, i) => ({
      name: `Pad ${i} 1B`, qualityIndex: 1, creator: 'Pad', contextWindow: 4096, outputSpeed: 100,
    })),
  ];
  const candidates = [{ name: 'llama3.1:72b' }];
  const matches = matchModels(whatllm, candidates);
  assert(matches.has('llama3.1:72b'), 'llama3.1:72b matches 70B whatllm (2.8% delta)');
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. parseModels — __NEXT_DATA__ format
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n── 7. parseModels: __NEXT_DATA__ ──');
{
  const models = Array.from({ length: 25 }, (_, i) => ({
    name: `Model ${i}`,
    qualityIndex: 10 + i,
    creator: 'Test',
    contextWindow: 4096,
    outputSpeed: 100,
  }));

  const html = `<html><head><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"data":{"models":${JSON.stringify(models)}}}}}</script></head><body></body></html>`;

  const parsed = parseModels(html);
  assertEq(parsed.length, 25, 'parsed 25 models from __NEXT_DATA__');
  assertEq(parsed[0].name, 'Model 0', 'first model name');
  assertEq(parsed[0].qualityIndex, 10, 'first model quality');
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. parseModels — raw "models":[] in HTML
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n── 8. parseModels: raw models array ──');
{
  const models = Array.from({ length: 25 }, (_, i) => ({
    name: `Raw ${i}`,
    qualityIndex: 5 + i * 2,
    creator: 'TestRaw',
    contextWindow: 8192,
    outputSpeed: 50,
  }));

  const html = `<html><body><script>var data = {"stats":{"modelCount":25},"models":${JSON.stringify(models)}};</script></body></html>`;

  const parsed = parseModels(html);
  assertEq(parsed.length, 25, 'parsed 25 models from raw');
  assertEq(parsed[5].name, 'Raw 5', 'model name from raw');
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. parseModels — __next_f.push format
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n── 9. parseModels: __next_f.push ──');
{
  const models = Array.from({ length: 25 }, (_, i) => ({
    name: `Push ${i}`,
    qualityIndex: 3 + i,
    creator: 'PushTest',
    contextWindow: 4096,
    outputSpeed: 80,
  }));

  const jsonPayload = `{"data":{"models":${JSON.stringify(models)}}}`;
  const escaped = jsonPayload.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const html = `<html><body><script>self.__next_f.push([1,"${escaped}"])</script></body></html>`;

  const parsed = parseModels(html);
  assertEq(parsed.length, 25, 'parsed 25 models from __next_f');
  assertEq(parsed[0].name, 'Push 0', 'first model from push');
}

// ═══════════════════════════════════════════════════════════════════════════
// 10. parseModels — fails gracefully
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n── 10. parseModels: failure ──');
{
  let threw = false;
  try {
    parseModels('<html><body>no data here</body></html>');
  } catch (e) {
    threw = true;
    assert(e.message === 'WHATLLM_PARSE_FAILED', 'throws WHATLLM_PARSE_FAILED');
  }
  assert(threw, 'parseModels throws on no data');
}

// ═══════════════════════════════════════════════════════════════════════════
// 20. clearCache
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n── 20. clearCache ──');
{
  clearCache();
  const state = (await import('../src/upgrade/whatllm-client.js')).getCacheState();
  assertEq(state.hasCache, false, 'cache cleared');
  assertEq(state.modelCount, 0, 'zero models after clear');
  assertEq(state.lastFetch, 0, 'lastFetch reset');
  assertEq(state.lastError, 0, 'lastError reset');
}

// ═══════════════════════════════════════════════════════════════════════════
// 22. Multiple matches — picks closest params
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n── 22. matchModels: picks closest params ──');
{
  const whatllm = [
    { name: 'Llama 3.1 Instruct 8B', qualityIndex: 5.20, creator: 'Meta', contextWindow: 128000, outputSpeed: 95 },
    { name: 'Llama 3.1 Instruct 70B', qualityIndex: 12.47, creator: 'Meta', contextWindow: 128000, outputSpeed: 31 },
    ...Array.from({ length: 20 }, (_, i) => ({
      name: `Pad ${i} 1B`, qualityIndex: 1, creator: 'Pad', contextWindow: 4096, outputSpeed: 100,
    })),
  ];

  const candidates = [{ name: 'llama3.1:8b' }];
  const matches = matchModels(whatllm, candidates);
  assert(matches.has('llama3.1:8b'), 'llama3.1:8b matched');
  assertEq(matches.get('llama3.1:8b').qualityIndex, 5.20, 'matched 8B not 70B');
}

// ═══════════════════════════════════════════════════════════════════════════
// 23. parseModels — rejects too-small array
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n── 23. parseModels: rejects small array ──');
{
  const models = [{ name: 'Only One', qualityIndex: 50 }];
  const html = `<html><script id="__NEXT_DATA__">{"props":{"pageProps":{"data":{"models":${JSON.stringify(models)}}}}}</script></html>`;

  let threw = false;
  try { parseModels(html); } catch (e) { threw = true; }
  assert(threw, 'rejects array with < 20 models');
}

// ═══════════════════════════════════════════════════════════════════════════
// 24. Cloud-only models don't match Ollama
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n── 24. Cloud-only no match ──');
{
  const candidates = [
    { name: 'claude:latest' },
    { name: 'gpt-4:latest' },
  ];

  const matches = matchModels(SAMPLE_WHATLLM_MODELS, candidates);
  assert(!matches.has('claude:latest'), 'claude not matched (no params)');
  assert(!matches.has('gpt-4:latest'), 'gpt-4 not matched (no params in ollama tag)');
}

// ═══════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════

console.log(`\n══════════════════════════════════════════════════`);
console.log(`WhatLLM Client: ${passed} passed, ${failed} failed`);
console.log(`══════════════════════════════════════════════════`);

if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  FAIL: ${f}`));
  process.exit(1);
}
