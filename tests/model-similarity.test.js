import { suite, test, assert, assertEqual, summary } from './harness.js';
import { computeModelSimilarity, estimateModelPrior } from '../src/upgrade/model-similarity.js';

suite('Model Similarity Engine');

const POOL = [
  {
    name: 'qwen3.5:27b',
    family: 'qwen',
    params: 27,
    contextWindow: 32768,
    architecture: 'transformer',
    modality: 'text',
    category: 'general',
    capabilities: ['json_mode', 'tool_use'],
    benchmarks: { swebench: 0.13, reasoning: 0.86, mmlu: 0.87 },
    benchmarkConfidence: 1.0,
    source: 'catalog',
  },
  {
    name: 'qwen3:14b',
    family: 'qwen',
    params: 14,
    contextWindow: 32768,
    architecture: 'transformer',
    modality: 'text',
    category: 'general',
    capabilities: ['json_mode'],
    benchmarks: { swebench: 0.08, reasoning: 0.80, mmlu: 0.82 },
    benchmarkConfidence: 0.95,
    source: 'catalog',
  },
  {
    name: 'llama3.3:70b',
    family: 'llama',
    params: 70,
    contextWindow: 8192,
    architecture: 'transformer',
    modality: 'text',
    category: 'general',
    capabilities: ['instruction-following'],
    benchmarks: { swebench: 0.11, reasoning: 0.84, mmlu: 0.86 },
    benchmarkConfidence: 0.9,
    source: 'catalog',
  },
  {
    name: 'mixtral:8x7b',
    family: 'mixtral',
    params: 46,
    contextWindow: 32768,
    architecture: 'moe',
    modality: 'text',
    category: 'general',
    capabilities: ['tool_use'],
    benchmarks: { swebench: 0.09, reasoning: 0.79, mmlu: 0.80 },
    benchmarkConfidence: 0.85,
    source: 'catalog',
  },
];

test('computeModelSimilarity prefers close family/size candidates', () => {
  const target = { name: 'qwen4:27b', family: 'qwen', params: 27, contextWindow: 32768, modality: 'text' };
  const qwen = POOL[0];
  const llama = POOL[2];
  const sQwen = computeModelSimilarity(target, qwen);
  const sLlama = computeModelSimilarity(target, llama);

  assert(sQwen > sLlama, `Expected qwen similarity > llama (${sQwen} <= ${sLlama})`);
  assert(sQwen > 0.7, `Expected qwen similarity > 0.7, got ${sQwen}`);
});

test('estimateModelPrior uses same_family strategy when available', () => {
  const target = { name: 'qwen4:30b', family: 'qwen', params: 30, contextWindow: 32768, modality: 'text' };
  const prior = estimateModelPrior(target, POOL, { topK: 3 });

  assert(!!prior, 'Expected prior');
  assertEqual(prior.strategy, 'same_family');
  assert(prior.neighbors.length >= 1, 'Expected at least one neighbor');
  assert(prior.neighbors.some(n => n.name.startsWith('qwen')), 'Expected qwen neighbor');
  assert(prior.benchmarks?.reasoning != null, 'Expected benchmark prior');
});

test('estimateModelPrior falls back to params strategy when family has no neighbors', () => {
  const target = { name: 'unknown-x:30b', family: 'unknown', params: 30, contextWindow: 32768, modality: 'text' };
  const prior = estimateModelPrior(target, POOL, { topK: 2 });

  assert(!!prior, 'Expected prior');
  assertEqual(prior.strategy, 'params');
  assert(prior.neighbors.length >= 1, 'Expected params fallback neighbors');
});

test('estimateModelPrior falls back to architecture when params missing', () => {
  const target = { name: 'new-moe:latest', family: 'unknown', params: null, architecture: 'moe', modality: 'text' };
  const prior = estimateModelPrior(target, POOL, { topK: 2 });

  assert(!!prior, 'Expected prior');
  assertEqual(prior.strategy, 'architecture');
  assert(prior.neighbors.some(n => n.name.includes('mixtral')), 'Expected mixtral architecture neighbor');
});

test('estimateModelPrior falls back to baseline as last resort', () => {
  const target = { name: 'mystery-model', family: 'unknown', params: null, architecture: 'unknown', modality: 'text' };
  const prior = estimateModelPrior(target, POOL, { topK: 2 });

  assert(!!prior, 'Expected prior');
  assertEqual(prior.strategy, 'baseline');
  assert(prior.benchmarkConfidence >= 0.3, `Expected baseline confidence >= 0.3, got ${prior.benchmarkConfidence}`);
});

summary();
