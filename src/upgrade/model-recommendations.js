// Model Recommendations v121.3 — Curated discovery catalog for C3 IDE
// ══════════════════════════════════════════════════════════════════════════════
//
// Comprehensive curated list of recommended 14-32B models organized by C3 role.
// Complements L4 online discovery with human-verified model data.
//
// Each model includes: benchmarks, VRAM estimate, role suitability, description,
// and semaphore hint vs current model.
//
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Curated model recommendations organized by C3 role sections.
 *
 * Benchmark values are 0.0-1.0 normalized (same scale as CATALOG).
 * VRAM estimates use Q4_K_M formula: 620 * params + 420 (dense)
 * or active_params-based for MoE models.
 */
export const RECOMMENDATION_SECTIONS = [
  // ─── D1/R1: Reasoning & Planning ──────────────────────────────────────
  {
    id: 'reasoning',
    title: 'Reasoning & Plánování (D1/R1)',
    subtitle: 'Modely pro hlubokou analýzu, plánování a rozhodování. Vyžadují json_mode.',
    icon: '\uD83E\uDDE0',
    models: [
      {
        name: 'deepseek-r1:32b',
        params: 32, vramMb: 20260, contextWindow: 65536,
        capabilities: ['json_mode', 'reasoning', 'long_context'],
        roles: ['D1', 'R1'],
        description: 'Nejsilnější reasoning v segmentu 14-32B. Překonává o1-mini.',
        detail: 'Distilled z 671B modelu. Silný v matematice, logice a plánování. Výborný pro D1 architektonické rozhodování.',
        benchmarks: { reasoning: 0.88, mmlu: 0.72, humaneval: 0.72, livecodebench: 0.55, arena: 0.52 },
        releaseDate: '2025-01-20', tier: 1,
      },
      {
        name: 'qwq:32b',
        params: 32, vramMb: 20260, contextWindow: 32768,
        capabilities: ['json_mode', 'reasoning'],
        roles: ['D1', 'R1'],
        description: 'Qwen reasoning variant — GPQA 65%, AIME 50%. Alternativa k DeepSeek-R1.',
        detail: 'Experimentální reasoning model od Qwen. Srovnatelný s R1 na mnoha úlohách, ale menší kontext.',
        benchmarks: { reasoning: 0.85, mmlu: 0.65, humaneval: 0.65, arena: 0.50 },
        releaseDate: '2025-03-01', tier: 1,
      },
      {
        name: 'phi4-reasoning:14b-plus',
        params: 14, vramMb: 9100, contextWindow: 16384,
        capabilities: ['json_mode', 'reasoning'],
        roles: ['D1', 'R1'],
        description: 'Překonává 70B modely! RL-enhanced reasoning od Microsoftu.',
        detail: 'Nejlepší poměr výkon/VRAM v reasoning kategorii. RL trénink přináší výrazný skok.',
        benchmarks: { reasoning: 0.83, mmlu: 0.70, humaneval: 0.68, arena: 0.45 },
        releaseDate: '2025-08-01', tier: 1, highlight: true,
      },
      {
        name: 'phi4-reasoning:14b',
        params: 14, vramMb: 9100, contextWindow: 16384,
        capabilities: ['json_mode', 'reasoning'],
        roles: ['D1', 'R1'],
        description: 'SFT reasoning od Microsoftu. Slabší než Plus, ale stále silný za 9 GB.',
        detail: 'Supervised fine-tuning varianta. Dobrá alternativa pokud nechcete RL verzi.',
        benchmarks: { reasoning: 0.78, mmlu: 0.68, humaneval: 0.65, arena: 0.42 },
        releaseDate: '2025-06-01', tier: 2,
      },
      {
        name: 'exaone-deep:32b',
        params: 32, vramMb: 20260, contextWindow: 32768,
        capabilities: ['json_mode', 'reasoning'],
        roles: ['D1', 'R1'],
        description: 'LG AI reasoning model. Silný v matematice a kódu.',
        detail: 'Korejský model s výborným reasoning. Méně testovaný v češtině.',
        benchmarks: { reasoning: 0.82, mmlu: 0.68, humaneval: 0.70, arena: 0.48 },
        releaseDate: '2025-09-01', tier: 2,
      },
      {
        name: 'magistral:24b',
        params: 24, vramMb: 15300, contextWindow: 131072,
        capabilities: ['json_mode', 'reasoning', 'long_context'],
        roles: ['D1', 'R1'],
        description: 'Mistral reasoning model s trasovatelným Chain-of-Thought.',
        detail: 'Velký kontext (128K), vhodný pro analýzu rozsáhlých kódových bází.',
        benchmarks: { reasoning: 0.80, mmlu: 0.70, humaneval: 0.65, arena: 0.50 },
        releaseDate: '2025-10-01', tier: 2,
      },
      {
        name: 'qwen3:32b',
        params: 32, vramMb: 20260, contextWindow: 32768,
        capabilities: ['json_mode', 'reasoning', 'tool_use'],
        roles: ['D1', 'R1', 'D2', 'R2'],
        description: 'Univerzální s thinking mode. Výborná čeština.',
        detail: 'Thinking mode umožňuje přepínat mezi rychlým a hlubokým reasoning. Skvělý multilingual.',
        benchmarks: { reasoning: 0.82, mmlu: 0.74, humaneval: 0.72, livecodebench: 0.52, arena: 0.55 },
        releaseDate: '2025-04-01', tier: 1,
      },
      {
        name: 'deepseek-r1:14b',
        params: 14, vramMb: 9100, contextWindow: 65536,
        capabilities: ['json_mode', 'reasoning', 'long_context'],
        roles: ['D1', 'R1'],
        description: 'Distilled z 671B, solidní reasoning za malou VRAM.',
        detail: 'Kompaktní varianta. Dobrá pro systémy s omezenou VRAM.',
        benchmarks: { reasoning: 0.78, mmlu: 0.60, humaneval: 0.55, livecodebench: 0.42, arena: 0.31 },
        releaseDate: '2025-01-20', tier: 2,
      },
      {
        name: 'qwen3:14b',
        params: 14, vramMb: 9100, contextWindow: 32768,
        capabilities: ['json_mode', 'reasoning', 'tool_use'],
        roles: ['D1', 'D2', 'R2'],
        description: 'Efektivní reasoning s thinking mode za 9 GB.',
        detail: 'Dobrý kompromis mezi výkonem a VRAM. Vhodný pro D2/R2 role.',
        benchmarks: { reasoning: 0.72, mmlu: 0.65, humaneval: 0.60, livecodebench: 0.40, arena: 0.42 },
        releaseDate: '2025-04-01', tier: 2,
      },
    ],
  },

  // ─── CODE: Implementation ─────────────────────────────────────────────
  {
    id: 'code',
    title: 'Kód & Implementace (CODE)',
    subtitle: 'Modely pro generování, opravu a refaktoring kódu.',
    icon: '\uD83D\uDCBB',
    models: [
      {
        name: 'qwen2.5-coder:32b',
        params: 32, vramMb: 20260, contextWindow: 131072,
        capabilities: ['json_mode', 'long_context'],
        roles: ['CODE'],
        description: 'HumanEval 92.7%, GPT-4o level. Král kódování.',
        detail: 'Nejlepší open-source coding model. FIM podpora, 128K kontext, Aider 73.7. Konkuruje GPT-4o.',
        benchmarks: { swebench: 0.30, livecodebench: 0.55, humaneval: 0.927, mmlu: 0.65, arena: 0.48 },
        releaseDate: '2024-11-12', tier: 1, highlight: true,
      },
      {
        name: 'devstral-small-2:24b',
        params: 24, vramMb: 15300, contextWindow: 131072,
        capabilities: ['json_mode', 'vision'],
        roles: ['CODE'],
        description: 'SWE-bench 68%! Nejlepší agentic coder v segmentu.',
        detail: 'Mistral model specializovaný na agentní kódování. Výborný pro SWE úlohy s vision podporou.',
        benchmarks: { swebench: 0.68, livecodebench: 0.52, humaneval: 0.85, arena: 0.50 },
        releaseDate: '2025-11-01', tier: 1, highlight: true,
      },
      {
        name: 'devstral:24b',
        params: 24, vramMb: 15300, contextWindow: 131072,
        capabilities: ['json_mode'],
        roles: ['CODE'],
        description: 'SWE-bench 46.8%, starší verze Devstralu.',
        detail: 'Předchůdce devstral-small-2. Stále solidní pro kódové úlohy.',
        benchmarks: { swebench: 0.468, livecodebench: 0.45, humaneval: 0.80, arena: 0.45 },
        releaseDate: '2025-05-01', tier: 2,
      },
      {
        name: 'codestral:22b',
        params: 22, vramMb: 14060, contextWindow: 32768,
        capabilities: ['json_mode'],
        roles: ['CODE'],
        description: 'Mistral, 80+ jazyků, FIM podpora.',
        detail: 'Fill-in-the-Middle podpora pro IDE integrace. Široká jazyková podpora.',
        benchmarks: { livecodebench: 0.48, humaneval: 0.81, arena: 0.42 },
        releaseDate: '2024-05-29', tier: 2,
      },
      {
        name: 'qwen2.5-coder:14b',
        params: 14, vramMb: 9100, contextWindow: 131072,
        capabilities: ['json_mode', 'long_context'],
        roles: ['CODE'],
        description: 'Solidní coder za menší VRAM. 128K kontext.',
        detail: 'Kompaktnější varianta Qwen Coder. Dobrý pro systémy s 16 GB VRAM.',
        benchmarks: { swebench: 0.18, livecodebench: 0.42, humaneval: 0.83, mmlu: 0.58, arena: 0.38 },
        releaseDate: '2024-11-12', tier: 2,
      },
      {
        name: 'deepcoder:14b',
        params: 14, vramMb: 9100, contextWindow: 16384,
        capabilities: ['json_mode', 'reasoning'],
        roles: ['CODE'],
        description: 'Code reasoning specialist — o3-mini level (tvrzení autorů).',
        detail: 'Fine-tuned z DeepSeek-R1-Distilled-Qwen-14B přes RL. Zaměřený na code reasoning.',
        benchmarks: { livecodebench: 0.50, humaneval: 0.82, reasoning: 0.75 },
        releaseDate: '2025-02-01', tier: 2,
      },
      {
        name: 'deepseek-coder-v2:16b',
        params: 16, vramMb: 10340, contextWindow: 131072,
        capabilities: ['json_mode', 'long_context'],
        roles: ['CODE'],
        description: '338 jazyků, HumanEval 81%, 128K kontext. MoE architektura.',
        detail: 'Mixture-of-Experts. Výkon srovnatelný s GPT4-Turbo na kódových úlohách.',
        benchmarks: { livecodebench: 0.42, humaneval: 0.81, mmlu: 0.60, arena: 0.40 },
        releaseDate: '2024-06-17', tier: 2,
      },
      {
        name: 'starcoder2:15b',
        params: 15, vramMb: 9720, contextWindow: 16384,
        capabilities: [],
        roles: ['CODE'],
        description: '600+ jazyků, ale nemá json_mode. Záložní varianta.',
        detail: 'Transparentně trénovaný na open datech. Vynikající pro autocompletion a FIM.',
        benchmarks: { humaneval: 0.72, livecodebench: 0.35 },
        releaseDate: '2024-02-28', tier: 3,
      },
    ],
  },

  // ─── CHAT: Conversation ───────────────────────────────────────────────
  {
    id: 'chat',
    title: 'Chat & Konverzace (CHAT)',
    subtitle: 'Modely pro konverzaci s uživatelem. Důraz na češtinu a kvalitu odpovědí.',
    icon: '\uD83D\uDCAC',
    models: [
      {
        name: 'qwen3:32b',
        params: 32, vramMb: 20260, contextWindow: 32768,
        capabilities: ['json_mode', 'reasoning', 'tool_use'],
        roles: ['CHAT', 'D2', 'R2'],
        description: 'Výborná čeština, thinking mode, multilingual.',
        detail: 'Nejlepší multilingual model v segmentu. Přepínatelný thinking/fast mode.',
        benchmarks: { mmlu: 0.74, arena: 0.55, reasoning: 0.82, humaneval: 0.72 },
        releaseDate: '2025-04-01', tier: 1,
      },
      {
        name: 'qwen3.5:27b',
        params: 27, vramMb: 17160, contextWindow: 262144,
        capabilities: ['json_mode', 'reasoning', 'vision', 'long_context'],
        roles: ['CHAT', 'D2'],
        description: 'SWE-bench 72.4% (GPT-5 mini level), 262K kontext, multimodal.',
        detail: 'Dense model s obrovským kontextem. Nativní multimodal. Vynikající pro chat s dokumenty.',
        benchmarks: { mmlu: 0.78, arena: 0.58, reasoning: 0.80, humaneval: 0.75, swebench: 0.724 },
        releaseDate: '2025-07-15', tier: 1, highlight: true,
      },
      {
        name: 'qwen2.5:32b',
        params: 32, vramMb: 20260, contextWindow: 131072,
        capabilities: ['json_mode', 'tool_use', 'long_context'],
        roles: ['CHAT', 'D2', 'R2'],
        description: 'Stabilní, 29+ jazyků, 128K kontext.',
        detail: 'Osvědčený model. Dobrá čeština, stabilní výstup, velký kontext.',
        benchmarks: { mmlu: 0.72, arena: 0.50, reasoning: 0.70, humaneval: 0.65 },
        releaseDate: '2024-09-19', tier: 1,
      },
      {
        name: 'gemma3:27b',
        params: 27, vramMb: 17160, contextWindow: 131072,
        capabilities: ['json_mode', 'vision', 'long_context'],
        roles: ['CHAT', 'VISION'],
        description: 'Multimodal, 140+ jazyků, 128K kontext.',
        detail: 'Google model s vision. Široká jazyková podpora včetně češtiny.',
        benchmarks: { mmlu: 0.72, arena: 0.52, reasoning: 0.68, humaneval: 0.60 },
        releaseDate: '2025-03-12', tier: 1,
      },
      {
        name: 'mistral-small3.2:24b',
        params: 24, vramMb: 15300, contextWindow: 32768,
        capabilities: ['json_mode', 'vision', 'tool_use'],
        roles: ['CHAT', 'VISION'],
        description: 'Vision, tool use, multilingual. Všestranný.',
        detail: 'Mistral s vision a tool use. Dobrý pro chat s obrázky a nástroji.',
        benchmarks: { mmlu: 0.70, arena: 0.50, reasoning: 0.65, humaneval: 0.60 },
        releaseDate: '2025-10-01', tier: 2,
      },
      {
        name: 'qwen2.5:14b',
        params: 14, vramMb: 9100, contextWindow: 131072,
        capabilities: ['json_mode', 'tool_use', 'long_context'],
        roles: ['CHAT', 'D2', 'R2'],
        description: 'Menší varianta, dobrá čeština za 9 GB.',
        detail: 'Efektivní alternativa pro systémy s omezenou VRAM. Solidní čeština.',
        benchmarks: { mmlu: 0.65, arena: 0.42, reasoning: 0.60, humaneval: 0.55 },
        releaseDate: '2024-09-19', tier: 2,
      },
      {
        name: 'phi4:14b',
        params: 14, vramMb: 9100, contextWindow: 16384,
        capabilities: ['json_mode'],
        roles: ['CHAT', 'D2'],
        description: 'General-purpose od Microsoftu. MIT licence.',
        detail: 'Instruction tuned, silná adherence k instrukcím. MIT licence.',
        benchmarks: { mmlu: 0.68, arena: 0.40, reasoning: 0.62 },
        releaseDate: '2024-12-01', tier: 2,
      },
      {
        name: 'command-r:35b',
        params: 35, vramMb: 22120, contextWindow: 131072,
        capabilities: ['json_mode', 'tool_use', 'long_context'],
        roles: ['CHAT'],
        description: 'Optimalizovaný pro RAG, 128K kontext.',
        detail: 'Cohere model specializovaný na retrieval-augmented generation. CC-BY-NC licence.',
        benchmarks: { mmlu: 0.68, arena: 0.48, reasoning: 0.60 },
        releaseDate: '2024-04-01', tier: 3,
      },
    ],
  },

  // ─── VISION: Image Understanding ──────────────────────────────────────
  {
    id: 'vision',
    title: 'Vision (VISION)',
    subtitle: 'Modely pro porozumění obrázkům a vizuálním datům.',
    icon: '\uD83D\uDC41\uFE0F',
    models: [
      {
        name: 'gemma3:27b',
        params: 27, vramMb: 17160, contextWindow: 131072,
        capabilities: ['json_mode', 'vision', 'long_context'],
        roles: ['VISION', 'CHAT'],
        description: 'Text + obrázky, 128K kontext, 140+ jazyků.',
        detail: 'Nejlepší vision model v kategorii 27B. Robustní multimodal.',
        benchmarks: { mmlu: 0.72, arena: 0.52, reasoning: 0.68 },
        releaseDate: '2025-03-12', tier: 1,
      },
      {
        name: 'mistral-small3.2:24b',
        params: 24, vramMb: 15300, contextWindow: 32768,
        capabilities: ['json_mode', 'vision', 'tool_use'],
        roles: ['VISION', 'CHAT'],
        description: 'Vision + tool use od Mistralu.',
        detail: 'Vision od verze 3.1+. Kombinuje rozpoznání obrázků s tool use.',
        benchmarks: { mmlu: 0.70, arena: 0.50, reasoning: 0.65 },
        releaseDate: '2025-10-01', tier: 2,
      },
      {
        name: 'devstral-small-2:24b',
        params: 24, vramMb: 15300, contextWindow: 131072,
        capabilities: ['json_mode', 'vision'],
        roles: ['VISION', 'CODE'],
        description: 'Vision + kód. Čte screenshoty UI a generuje kód.',
        detail: 'Unikátní kombinace vision + agentic coding. Ideální pro UI/UX generování.',
        benchmarks: { swebench: 0.68, humaneval: 0.85, arena: 0.50 },
        releaseDate: '2025-11-01', tier: 1,
      },
    ],
  },

  // ─── MoE: Efficient Models ────────────────────────────────────────────
  {
    id: 'moe',
    title: 'MoE — Efektivní modely',
    subtitle: 'Mixture-of-Experts: velký parametrový prostor, ale nízké aktivní parametry = rychlé. Omezený reasoning depth.',
    icon: '\u26A1',
    models: [
      {
        name: 'qwen3:30b-a3b',
        params: 30, vramMb: 2280, contextWindow: 32768,
        capabilities: ['json_mode', 'reasoning', 'tool_use'],
        roles: ['D2', 'R2', 'CHAT'],
        description: '30B/3.3B active — překonává QwQ-32B(!), extrémně efektivní.',
        detail: 'MoE model co bije dense 32B na mnoha úlohách. Extrémně rychlý inference.',
        benchmarks: { mmlu: 0.68, arena: 0.50, reasoning: 0.72, humaneval: 0.60 },
        releaseDate: '2025-04-01', tier: 1, highlight: true,
        moe: { totalParams: 30, activeParams: 3.3 },
      },
      {
        name: 'qwen3.5:35b-a3b',
        params: 36, vramMb: 2280, contextWindow: 262144,
        capabilities: ['json_mode', 'vision', 'reasoning', 'long_context'],
        roles: ['CHAT', 'VISION'],
        description: '36B/3B active — Sonnet 4.5 level (tvrzení), 262K kontext, vision.',
        detail: 'Nejnovější Qwen MoE. Obrovský kontext, multimodal. Ideální pro chat s dokumenty.',
        benchmarks: { mmlu: 0.75, arena: 0.55, reasoning: 0.75, humaneval: 0.68 },
        releaseDate: '2025-07-15', tier: 1,
        moe: { totalParams: 36, activeParams: 3 },
      },
      {
        name: 'qwen3-coder:30b',
        params: 30, vramMb: 2280, contextWindow: 32768,
        capabilities: ['json_mode'],
        roles: ['CODE'],
        description: '30B/3.3B active — agentic coder, SWE-bench RL trénink.',
        detail: 'MoE coding specialist s RL tréninkem na SWE-bench. Rychlý inference pro iterativní kódování.',
        benchmarks: { swebench: 0.45, livecodebench: 0.48, humaneval: 0.80 },
        releaseDate: '2025-06-01', tier: 2,
        moe: { totalParams: 30, activeParams: 3.3 },
      },
      {
        name: 'nemotron-3-nano:30b',
        params: 30, vramMb: 2590, contextWindow: 1048576,
        capabilities: ['json_mode', 'long_context'],
        roles: ['CHAT', 'D2'],
        description: '30B/3.5B active — NVIDIA Mamba-2 hybrid, 1M kontext(!)',
        detail: 'Unikátní hybridní architektura (Mamba-2 + Transformer). Extrémní kontext 1M tokenů.',
        benchmarks: { mmlu: 0.65, arena: 0.45, reasoning: 0.60 },
        releaseDate: '2025-09-01', tier: 2,
        moe: { totalParams: 30, activeParams: 3.5 },
      },
      {
        name: 'lfm2:24b',
        params: 24, vramMb: 1660, contextWindow: 32768,
        capabilities: ['json_mode'],
        roles: ['CHAT'],
        description: '24B/2B active — Liquid AI hybrid, 112 tok/s na CPU.',
        detail: 'Ultra-efektivní model s hybridní architekturou. Běží rychle i na CPU.',
        benchmarks: { mmlu: 0.60, arena: 0.40 },
        releaseDate: '2025-10-01', tier: 3,
        moe: { totalParams: 24, activeParams: 2 },
      },
    ],
  },
];

/**
 * Get all unique model names from recommendations.
 */
export function getAllRecommendedNames() {
  const names = new Set();
  for (const section of RECOMMENDATION_SECTIONS) {
    for (const m of section.models) names.add(m.name);
  }
  return names;
}

/**
 * Compute semaphore for a recommended model vs current model for a role.
 *
 * @param {Object} recModel - Recommended model entry
 * @param {Object} currentEntry - Current model's catalog entry (with benchmarks)
 * @param {string} role - C3 role (D1, CODE, CHAT, etc.)
 * @param {Function} scoreModelFn - scoreModel() from model-ranker
 * @param {Object} scoringContext - Context for scoreModel (gpuVramMb, roleBindings, etc.)
 * @returns {'upgrade'|'sidegrade'|'downgrade'|'unknown'}
 */
export function computeSemaphore(recModel, currentEntry, role, scoreModelFn, scoringContext) {
  if (!currentEntry || !currentEntry.benchmarks || !recModel.benchmarks) return 'unknown';

  try {
    // Score current model
    const currentResult = scoreModelFn(currentEntry, role, scoringContext);

    // Build temporary entry for recommended model
    // NOT provisional — curated benchmarks are human-verified, no penalty/attenuation
    const recEntry = {
      name: recModel.name,
      family: recModel.name.split(':')[0],
      category: recModel.roles?.includes('CODE') ? 'code'
        : recModel.roles?.includes('D1') || recModel.roles?.includes('R1') ? 'reasoning'
        : 'general',
      params: recModel.params,
      contextWindow: recModel.contextWindow,
      benchmarks: recModel.benchmarks,
      capabilities: recModel.capabilities || [],
      releaseDate: recModel.releaseDate,
    };

    const recResult = scoreModelFn(recEntry, role, scoringContext);
    const delta = recResult.totalScore - currentResult.totalScore;

    if (delta > 0.02) return 'upgrade';
    if (delta > -0.02) return 'sidegrade';
    return 'downgrade';
  } catch {
    return 'unknown';
  }
}

export default { RECOMMENDATION_SECTIONS, getAllRecommendedNames, computeSemaphore };
