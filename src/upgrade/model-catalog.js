// Model Catalog v118 — Curated Model Database for Upgrade Discovery
// ══════════════════════════════════════════════════════════════════════════════
//
// Static catalog of ~55 Ollama models with factual identity, capabilities and
// hardware requirements. It intentionally carries no quality scores.
//
// VRAM model:
//   baseVramMb = Q4_K_M runtime VRAM (weights + overhead, before KV cache)
//   effectiveVram = (baseVramMb × quantFactor + params × contextWindow × 0.00002) × 1.10
//
// ══════════════════════════════════════════════════════════════════════════════

export const CATALOG_VERSION = 'v118.1';

// ─── Quantization Factors ──────────────────────────────────────────────────

export const QUANT_FACTORS = {
  Q4_K_S: 0.95, Q4_K_M: 1.0, Q5_K_S: 1.20, Q5_K_M: 1.25,
  Q6_K: 1.50, Q8_0: 2.0, FP16: 3.5,
};

// ─── Catalog Entries ───────────────────────────────────────────────────────

export const CATALOG = [

  // ── Qwen 2.5 (Sep 2024) ─────────────────────────────────────────────────
  {
    name: 'qwen2.5:3b', family: 'qwen', category: 'general', params: 3,
    variants: ['3b', '7b', '14b', '32b', '72b'],
    sizeGB: 2.0, baseVramMb: 2800, contextWindow: 32768,
    capabilities: ['json_mode', 'tool_use'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2024-09-19', supersedes: null,
  },
  {
    name: 'qwen2.5:7b', family: 'qwen', category: 'general', params: 7,
    variants: ['3b', '7b', '14b', '32b', '72b'],
    sizeGB: 4.4, baseVramMb: 5500, contextWindow: 32768,
    capabilities: ['json_mode', 'tool_use'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2024-09-19', supersedes: null,
  },
  {
    name: 'qwen2.5:14b', family: 'qwen', category: 'general', params: 14,
    variants: ['3b', '7b', '14b', '32b', '72b'],
    sizeGB: 8.7, baseVramMb: 10500, contextWindow: 32768,
    capabilities: ['json_mode', 'tool_use'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2024-09-19', supersedes: null,
  },
  {
    name: 'qwen2.5:32b', family: 'qwen', category: 'general', params: 32,
    variants: ['3b', '7b', '14b', '32b', '72b'],
    sizeGB: 19.6, baseVramMb: 22000, contextWindow: 32768,
    capabilities: ['json_mode', 'tool_use', 'long_context'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2024-09-19', supersedes: null,
  },
  {
    name: 'qwen2.5:72b', family: 'qwen', category: 'general', params: 72,
    variants: ['3b', '7b', '14b', '32b', '72b'],
    sizeGB: 44.0, baseVramMb: 46000, contextWindow: 32768,
    capabilities: ['json_mode', 'tool_use', 'long_context'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2024-09-19', supersedes: null,
  },

  // ── Qwen 2.5-Coder (Nov 2024) ──────────────────────────────────────────
  {
    name: 'qwen2.5-coder:7b', family: 'qwen-coder', category: 'code', params: 7,
    variants: ['7b', '14b', '32b'],
    sizeGB: 4.4, baseVramMb: 5500, contextWindow: 32768,
    capabilities: ['json_mode', 'tool_use'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2024-11-11', supersedes: null,
  },
  {
    name: 'qwen2.5-coder:14b', family: 'qwen-coder', category: 'code', params: 14,
    variants: ['7b', '14b', '32b'],
    sizeGB: 8.7, baseVramMb: 10500, contextWindow: 32768,
    capabilities: ['json_mode', 'tool_use'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2024-11-11', supersedes: null,
  },
  {
    name: 'qwen2.5-coder:32b', family: 'qwen-coder', category: 'code', params: 32,
    variants: ['7b', '14b', '32b'],
    sizeGB: 19.6, baseVramMb: 22000, contextWindow: 32768,
    capabilities: ['json_mode', 'tool_use'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2024-11-11', supersedes: null,
  },

  // ── Qwen 3 (Apr 2025) ──────────────────────────────────────────────────
  {
    name: 'qwen3:4b', family: 'qwen', category: 'general', params: 4,
    variants: ['4b', '8b', '14b', '30b-a3b', '32b'],
    sizeGB: 2.5, baseVramMb: 3200, contextWindow: 32768,
    capabilities: ['json_mode', 'tool_use'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2025-04-29', supersedes: 'qwen2.5',
  },
  {
    name: 'qwen3:8b', family: 'qwen', category: 'general', params: 8,
    variants: ['4b', '8b', '14b', '30b-a3b', '32b'],
    sizeGB: 4.9, baseVramMb: 5800, contextWindow: 32768,
    capabilities: ['json_mode', 'tool_use'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2025-04-29', supersedes: 'qwen2.5',
  },
  {
    name: 'qwen3:14b', family: 'qwen', category: 'general', params: 14,
    variants: ['4b', '8b', '14b', '30b-a3b', '32b'],
    sizeGB: 8.7, baseVramMb: 10500, contextWindow: 32768,
    capabilities: ['json_mode', 'tool_use', 'long_context'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2025-04-29', supersedes: 'qwen2.5',
  },
  {
    name: 'qwen3:30b-a3b', family: 'qwen', category: 'general', params: 30,
    variants: ['4b', '8b', '14b', '30b-a3b', '32b'],
    sizeGB: 18.0, baseVramMb: 20000, contextWindow: 32768,
    capabilities: ['json_mode', 'tool_use', 'long_context'],
    tokenizer: 'bpe', architecture: 'moe', recommendedQuant: 'Q4_K_M',
    releaseDate: '2025-04-29', supersedes: 'qwen2.5',
  },
  {
    name: 'qwen3:32b', family: 'qwen', category: 'general', params: 32,
    variants: ['4b', '8b', '14b', '30b-a3b', '32b'],
    sizeGB: 19.6, baseVramMb: 22000, contextWindow: 32768,
    capabilities: ['json_mode', 'tool_use', 'long_context'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2025-04-29', supersedes: 'qwen2.5',
  },

  // ── Qwen 3.5 (Jul 2025) ────────────────────────────────────────────────
  {
    name: 'qwen3.5:4b', family: 'qwen', category: 'general', params: 4,
    variants: ['4b', '9b', '27b', '35b'],
    sizeGB: 2.5, baseVramMb: 3200, contextWindow: 32768,
    capabilities: ['json_mode', 'tool_use'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2025-07-15', supersedes: 'qwen3',
  },
  {
    name: 'qwen3.5:9b', family: 'qwen', category: 'general', params: 9,
    variants: ['4b', '9b', '27b', '35b'],
    sizeGB: 5.5, baseVramMb: 6400, contextWindow: 32768,
    capabilities: ['json_mode', 'tool_use'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2025-07-15', supersedes: 'qwen3',
  },
  {
    name: 'qwen3.5:27b', family: 'qwen', category: 'general', params: 27,
    variants: ['4b', '9b', '27b', '35b'],
    sizeGB: 16.5, baseVramMb: 18500, contextWindow: 32768,
    capabilities: ['json_mode', 'tool_use', 'long_context'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2025-07-15', supersedes: 'qwen3',
  },
  {
    name: 'qwen3.5:35b', family: 'qwen', category: 'general', params: 35,
    variants: ['4b', '9b', '27b', '35b'],
    sizeGB: 21.4, baseVramMb: 24000, contextWindow: 32768,
    capabilities: ['json_mode', 'tool_use', 'long_context'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2025-07-15', supersedes: 'qwen3',
  },

  // ── DeepSeek-R1 Distilled (Jan 2025) ────────────────────────────────────
  {
    name: 'deepseek-r1:7b', family: 'deepseek-r1', category: 'reasoning', params: 7,
    variants: ['7b', '14b', '32b', '70b'],
    sizeGB: 4.4, baseVramMb: 5500, contextWindow: 131072,
    capabilities: ['long_context'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2025-01-20', supersedes: null,
  },
  {
    name: 'deepseek-r1:14b', family: 'deepseek-r1', category: 'reasoning', params: 14,
    variants: ['7b', '14b', '32b', '70b'],
    sizeGB: 8.7, baseVramMb: 10500, contextWindow: 131072,
    capabilities: ['json_mode', 'long_context'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2025-01-20', supersedes: null,
  },
  {
    name: 'deepseek-r1:32b', family: 'deepseek-r1', category: 'reasoning', params: 32,
    variants: ['7b', '14b', '32b', '70b'],
    sizeGB: 19.6, baseVramMb: 22000, contextWindow: 131072,
    capabilities: ['json_mode', 'long_context'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2025-01-20', supersedes: null,
  },
  {
    name: 'deepseek-r1:70b', family: 'deepseek-r1', category: 'reasoning', params: 70,
    variants: ['7b', '14b', '32b', '70b'],
    sizeGB: 42.8, baseVramMb: 46000, contextWindow: 131072,
    capabilities: ['json_mode', 'long_context'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2025-01-20', supersedes: null,
  },

  // ── DeepSeek-R1-0528 (May 2025) — improved distills ────────────────────
  {
    name: 'deepseek-r1-0528:7b', family: 'deepseek-r1', category: 'reasoning', params: 7,
    variants: ['7b', '14b', '32b', '70b'],
    sizeGB: 4.4, baseVramMb: 5500, contextWindow: 131072,
    capabilities: ['json_mode', 'long_context'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2025-05-28', supersedes: 'deepseek-r1',
  },
  {
    name: 'deepseek-r1-0528:14b', family: 'deepseek-r1', category: 'reasoning', params: 14,
    variants: ['7b', '14b', '32b', '70b'],
    sizeGB: 8.7, baseVramMb: 10500, contextWindow: 131072,
    capabilities: ['json_mode', 'long_context'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2025-05-28', supersedes: 'deepseek-r1',
  },
  {
    name: 'deepseek-r1-0528:32b', family: 'deepseek-r1', category: 'reasoning', params: 32,
    variants: ['7b', '14b', '32b', '70b'],
    sizeGB: 19.6, baseVramMb: 22000, contextWindow: 131072,
    capabilities: ['json_mode', 'long_context'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2025-05-28', supersedes: 'deepseek-r1',
  },
  {
    name: 'deepseek-r1-0528:70b', family: 'deepseek-r1', category: 'reasoning', params: 70,
    variants: ['7b', '14b', '32b', '70b'],
    sizeGB: 42.8, baseVramMb: 46000, contextWindow: 131072,
    capabilities: ['json_mode', 'long_context'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2025-05-28', supersedes: 'deepseek-r1',
  },

  // ── DeepSeek-Coder-V2 (Jun 2024) ───────────────────────────────────────
  {
    name: 'deepseek-coder-v2:16b', family: 'deepseek-coder', category: 'code', params: 16,
    variants: ['16b'],
    sizeGB: 9.9, baseVramMb: 11000, contextWindow: 131072,
    capabilities: ['json_mode', 'long_context'],
    tokenizer: 'bpe', architecture: 'moe', recommendedQuant: 'Q4_K_M',
    releaseDate: '2024-06-17', supersedes: null,
  },

  // ── DeepSeek-Coder (Nov 2023) ───────────────────────────────────────────
  {
    name: 'deepseek-coder:7b', family: 'deepseek-coder', category: 'code', params: 7,
    variants: ['7b', '33b'],
    sizeGB: 4.4, baseVramMb: 5500, contextWindow: 16384,
    capabilities: [],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2023-11-02', supersedes: null,
  },
  {
    name: 'deepseek-coder:33b', family: 'deepseek-coder', category: 'code', params: 33,
    variants: ['7b', '33b'],
    sizeGB: 20.2, baseVramMb: 22500, contextWindow: 16384,
    capabilities: [],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2023-11-02', supersedes: null,
  },

  // ── Llama 3.1 (Jul 2024) ───────────────────────────────────────────────
  {
    name: 'llama3.1:8b', family: 'llama', category: 'general', params: 8,
    variants: ['8b', '70b'],
    sizeGB: 4.9, baseVramMb: 5800, contextWindow: 131072,
    capabilities: ['json_mode', 'tool_use', 'long_context'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2024-07-23', supersedes: null,
  },
  {
    name: 'llama3.1:70b', family: 'llama', category: 'general', params: 70,
    variants: ['8b', '70b'],
    sizeGB: 42.8, baseVramMb: 46000, contextWindow: 131072,
    capabilities: ['json_mode', 'tool_use', 'long_context'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2024-07-23', supersedes: null,
  },

  // ── Llama 3.2 (Sep 2024) ───────────────────────────────────────────────
  {
    name: 'llama3.2:3b', family: 'llama', category: 'general', params: 3,
    variants: ['3b', '11b'],
    sizeGB: 2.0, baseVramMb: 2800, contextWindow: 131072,
    capabilities: ['json_mode', 'tool_use', 'long_context'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2024-09-25', supersedes: 'llama3.1',
  },
  {
    name: 'llama3.2:11b', family: 'llama', category: 'vision', params: 11,
    variants: ['3b', '11b'],
    sizeGB: 6.5, baseVramMb: 7800, contextWindow: 131072,
    capabilities: ['json_mode', 'tool_use', 'long_context', 'vision'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2024-09-25', supersedes: 'llama3.1',
  },

  // ── Llama 3.3 (Dec 2024) ───────────────────────────────────────────────
  {
    name: 'llama3.3:70b', family: 'llama', category: 'general', params: 70,
    variants: ['70b'],
    sizeGB: 42.8, baseVramMb: 46000, contextWindow: 131072,
    capabilities: ['json_mode', 'tool_use', 'long_context'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2024-12-06', supersedes: 'llama3.2',
  },

  // ── Codestral (May 2024) ───────────────────────────────────────────────
  {
    name: 'codestral:22b', family: 'codestral', category: 'code', params: 22,
    variants: ['22b'],
    sizeGB: 13.5, baseVramMb: 15000, contextWindow: 32768,
    capabilities: ['json_mode'],
    tokenizer: 'sentencepiece', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2024-05-29', supersedes: null,
  },

  // ── Mistral (various) ──────────────────────────────────────────────────
  {
    name: 'mistral:7b', family: 'mistral', category: 'general', params: 7,
    variants: ['7b'],
    sizeGB: 4.4, baseVramMb: 5200, contextWindow: 32768,
    capabilities: ['json_mode'],
    tokenizer: 'sentencepiece', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2024-05-22', supersedes: null,
  },
  {
    name: 'mistral-nemo:12b', family: 'mistral', category: 'general', params: 12,
    variants: ['12b'],
    sizeGB: 7.4, baseVramMb: 8800, contextWindow: 131072,
    capabilities: ['json_mode', 'tool_use', 'long_context'],
    tokenizer: 'sentencepiece', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2024-07-18', supersedes: 'mistral',
  },
  {
    name: 'mistral-small:22b', family: 'mistral', category: 'general', params: 22,
    variants: ['22b'],
    sizeGB: 13.5, baseVramMb: 15000, contextWindow: 32768,
    capabilities: ['json_mode', 'tool_use'],
    tokenizer: 'sentencepiece', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2024-09-18', supersedes: 'mistral-nemo',
  },

  // ── Mixtral (Dec 2023) ─────────────────────────────────────────────────
  {
    name: 'mixtral:8x7b', family: 'mixtral', category: 'general', params: 47,
    variants: ['8x7b'],
    sizeGB: 28.0, baseVramMb: 30000, contextWindow: 32768,
    capabilities: ['json_mode'],
    tokenizer: 'sentencepiece', architecture: 'moe', recommendedQuant: 'Q4_K_M',
    releaseDate: '2023-12-11', supersedes: null,
  },

  // ── StarCoder2 (Feb 2024) ──────────────────────────────────────────────
  {
    name: 'starcoder2:7b', family: 'starcoder', category: 'code', params: 7,
    variants: ['7b', '15b'],
    sizeGB: 4.4, baseVramMb: 5200, contextWindow: 16384,
    capabilities: [],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2024-02-28', supersedes: null,
  },
  {
    name: 'starcoder2:15b', family: 'starcoder', category: 'code', params: 15,
    variants: ['7b', '15b'],
    sizeGB: 9.2, baseVramMb: 10500, contextWindow: 16384,
    capabilities: [],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2024-02-28', supersedes: null,
  },

  // ── Phi (Microsoft) ────────────────────────────────────────────────────
  {
    name: 'phi3:14b', family: 'phi', category: 'general', params: 14,
    variants: ['14b'],
    sizeGB: 8.7, baseVramMb: 10000, contextWindow: 4096,
    capabilities: ['json_mode'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2024-04-23', supersedes: null,
  },
  {
    name: 'phi4:14b', family: 'phi', category: 'general', params: 14,
    variants: ['14b'],
    sizeGB: 8.7, baseVramMb: 10000, contextWindow: 16384,
    capabilities: ['json_mode', 'tool_use'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2024-12-12', supersedes: 'phi3',
  },

  // ── Gemma 2 (Jun 2024) ─────────────────────────────────────────────────
  {
    name: 'gemma2:2b', family: 'gemma', category: 'general', params: 2,
    variants: ['2b', '9b', '27b'],
    sizeGB: 1.6, baseVramMb: 2200, contextWindow: 8192,
    capabilities: [],
    tokenizer: 'sentencepiece', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2024-06-27', supersedes: null,
  },
  {
    name: 'gemma2:9b', family: 'gemma', category: 'general', params: 9,
    variants: ['2b', '9b', '27b'],
    sizeGB: 5.5, baseVramMb: 6400, contextWindow: 8192,
    capabilities: ['json_mode'],
    tokenizer: 'sentencepiece', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2024-06-27', supersedes: null,
  },
  {
    name: 'gemma2:27b', family: 'gemma', category: 'general', params: 27,
    variants: ['2b', '9b', '27b'],
    sizeGB: 16.5, baseVramMb: 18000, contextWindow: 8192,
    capabilities: ['json_mode'],
    tokenizer: 'sentencepiece', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2024-06-27', supersedes: null,
  },

  // ── Gemma 3 (Mar 2025) ─────────────────────────────────────────────────
  {
    name: 'gemma3:4b', family: 'gemma', category: 'general', params: 4,
    variants: ['4b', '12b', '27b'],
    sizeGB: 2.5, baseVramMb: 3200, contextWindow: 32768,
    capabilities: ['json_mode', 'tool_use'],
    tokenizer: 'sentencepiece', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2025-03-12', supersedes: 'gemma2',
  },
  {
    name: 'gemma3:12b', family: 'gemma', category: 'general', params: 12,
    variants: ['4b', '12b', '27b'],
    sizeGB: 7.4, baseVramMb: 8800, contextWindow: 32768,
    capabilities: ['json_mode', 'tool_use', 'vision'],
    tokenizer: 'sentencepiece', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2025-03-12', supersedes: 'gemma2',
  },
  {
    name: 'gemma3:27b', family: 'gemma', category: 'general', params: 27,
    variants: ['4b', '12b', '27b'],
    sizeGB: 16.5, baseVramMb: 18000, contextWindow: 32768,
    capabilities: ['json_mode', 'tool_use', 'vision'],
    tokenizer: 'sentencepiece', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2025-03-12', supersedes: 'gemma2',
  },

  // ── Vision Models ──────────────────────────────────────────────────────
  {
    name: 'llava:7b', family: 'llava', category: 'vision', params: 7,
    variants: ['7b', '13b', '34b'],
    sizeGB: 4.5, baseVramMb: 5800, contextWindow: 4096,
    capabilities: ['vision'],
    tokenizer: 'sentencepiece', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2023-10-05', supersedes: null,
  },
  {
    name: 'llava:13b', family: 'llava', category: 'vision', params: 13,
    variants: ['7b', '13b', '34b'],
    sizeGB: 8.0, baseVramMb: 9500, contextWindow: 4096,
    capabilities: ['vision'],
    tokenizer: 'sentencepiece', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2023-10-05', supersedes: null,
  },
  {
    name: 'llava:34b', family: 'llava', category: 'vision', params: 34,
    variants: ['7b', '13b', '34b'],
    sizeGB: 20.8, baseVramMb: 23000, contextWindow: 4096,
    capabilities: ['vision'],
    tokenizer: 'sentencepiece', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2023-10-05', supersedes: null,
  },
  {
    name: 'bakllava:7b', family: 'llava', category: 'vision', params: 7,
    variants: ['7b'],
    sizeGB: 4.5, baseVramMb: 5800, contextWindow: 4096,
    capabilities: ['vision'],
    tokenizer: 'sentencepiece', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2023-10-18', supersedes: null,
  },
  {
    name: 'llava-llama3:8b', family: 'llava', category: 'vision', params: 8,
    variants: ['8b'],
    sizeGB: 5.0, baseVramMb: 6200, contextWindow: 8192,
    capabilities: ['vision'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2024-04-22', supersedes: 'llava',
  },
  {
    name: 'moondream:1.8b', family: 'moondream', category: 'vision', params: 2,
    variants: ['1.8b'],
    sizeGB: 1.1, baseVramMb: 1800, contextWindow: 2048,
    capabilities: ['vision'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2024-02-15', supersedes: null,
  },
  {
    name: 'minicpm-v:8b', family: 'minicpm', category: 'vision', params: 8,
    variants: ['8b'],
    sizeGB: 5.0, baseVramMb: 6200, contextWindow: 4096,
    capabilities: ['vision'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2024-08-06', supersedes: null,
  },

  // ── Nainstalované modely bez dosavadního pokrytí ─────────────────────────
  //
  // Tyto tři lokálně používané modely doplňují factual pokrytí katalogu.
  {
    name: 'qwq:32b', family: 'qwq', category: 'reasoning', params: 32,
    variants: ['32b'],
    sizeGB: 19.0, baseVramMb: 22000, contextWindow: 32768,
    capabilities: ['reasoning', 'json_mode'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2025-03-06', supersedes: null,
  },
  {
    name: 'devstral-small-2:24b', family: 'devstral', category: 'code', params: 24,
    variants: ['24b'],
    sizeGB: 15.0, baseVramMb: 16500, contextWindow: 131072,
    capabilities: ['tool_use', 'json_mode'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    releaseDate: '2025-07-10', supersedes: null,
  },
  {
    name: 'glm-4.7-flash', family: 'glm', category: 'general', params: 29,
    variants: ['flash'],
    sizeGB: 19.0, baseVramMb: 20500, contextWindow: 131072,
    capabilities: ['tool_use', 'json_mode'],
    tokenizer: 'bpe', architecture: 'transformer', recommendedQuant: 'Q4_K_M',
    // Datum vydání neznám a `modified_at` z Ollama je čas stažení, ne vydání.
    // Chybějící release date zůstává explicitně neznámé.
    releaseDate: null, supersedes: null,
  },
];

// ─── Catalog Hash ──────────────────────────────────────────────────────────

function _djb2(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

const _hashInput = CATALOG.map(entry => JSON.stringify(entry)).sort().join('|');
export const CATALOG_HASH = `${CATALOG_VERSION}-${_djb2(_hashInput)}`;

// ─── Lookup Index ──────────────────────────────────────────────────────────

const _byName = new Map();
for (const entry of CATALOG) _byName.set(entry.name, entry);

// ─── Query Functions ───────────────────────────────────────────────────────

/**
 * Get a single catalog entry by exact name.
 * @param {string} name - Ollama model name (e.g. 'qwen3:32b')
 * @returns {Object|null}
 */
export function getCatalogEntry(name) {
  return _byName.get(name) ?? null;
}

/**
 * Find all entries matching a family.
 * @param {string} family - e.g. 'qwen', 'deepseek-r1', 'llava'
 * @returns {Array}
 */
export function findByFamily(family) {
  return CATALOG.filter(e => e.family === family);
}

/**
 * Find all entries matching a category.
 * @param {string} category - 'general', 'code', 'reasoning', 'vision'
 * @returns {Array}
 */
export function findByCategory(category) {
  return CATALOG.filter(e => e.category === category);
}

/**
 * Get catalog entries for models NOT in the installed set.
 * @param {Set<string>} installedNames - Set of installed model names
 * @returns {Array}
 */
export function getNotInstalled(installedNames) {
  return CATALOG.filter(e => !installedNames.has(e.name));
}

/**
 * Check if a model has sufficient maturity (days since release).
 * @param {Object} entry - Catalog entry
 * @param {number} [minDays=7] - Minimum days since release
 * @returns {boolean}
 */
export function isModelMature(entry, minDays = 7) {
  if (!entry.releaseDate) return false;
  const ageDays = (Date.now() - Date.parse(entry.releaseDate)) / (24 * 60 * 60 * 1000);
  return ageDays >= minDays;
}

/**
 * Compute effective VRAM requirement including KV cache and safety margin.
 *
 * Formula: (baseVramMb × quantFactor + params × contextWindow × 0.00002) × 1.10
 *
 * @param {Object} entry - Catalog entry
 * @param {number} [quantFactor=1.0] - From QUANT_FACTORS (Q4_K_M=1.0)
 * @returns {number} Effective VRAM in MB
 */
export function computeEffectiveVram(entry, quantFactor = 1.0) {
  const kvCache = (entry.params || 0) * (entry.contextWindow || 32768) * 0.00002;
  return ((entry.baseVramMb || 0) * quantFactor + kvCache) * 1.10;
}

export default {
  CATALOG, CATALOG_VERSION, CATALOG_HASH, QUANT_FACTORS,
  getCatalogEntry, findByFamily, findByCategory,
  getNotInstalled, isModelMature, computeEffectiveVram,
};
