// C.3 Agent System - LLM Side-car Services
// ══════════════════════════════════════════════════════════════════════════════
// LLM je použito POUZE pro:
// - Formulaci notifikací (text, ne rozhodnutí)
// - Shrnutí dat
// - Doporučení (warranty replacement, etc.)
// - Vysvětlení změn
//
// LLM NIKDY nerozhoduje o tom, zda se agent spustí nebo zda se triggeruje akce!

/**
 * LLM Side-car Services
 * Provides text generation capabilities WITHOUT decision making
 */
export class LLMServices {
  constructor({ llmClient }) {
    this.llm = llmClient;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NOTIFICATION FORMATTER
  // Formuluje text notifikace na základě dat (rozhodnutí už bylo uděláno)
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Format notification body using LLM
   * @param {object} params
   * @param {string} params.template - Base template with placeholders
   * @param {object} params.data - Data to include
   * @param {string} params.tone - Tone: friendly, formal, urgent
   * @param {string} params.language - Language: cs, en
   * @returns {Promise<string>}
   */
  async formatNotification({ template, data, tone = 'friendly', language = 'cs' }) {
    const prompt = `Naformátuj notifikaci pro uživatele.

ŠABLONA: ${template}
DATA: ${JSON.stringify(data, null, 2)}
TÓN: ${tone}
JAZYK: ${language}

Pravidla:
- Buď stručný (max 2-3 věty)
- Použij data ze šablony
- Nepoužívej emoji pokud není v šabloně
- Nerozhoduj o ničem - jen formuluj text

Odpověz POUZE textem notifikace, nic jiného.`;

    const response = await this.llm.chat({
      model: 'qwen3.5:27b',
      messages: [{ role: 'user', content: prompt }]
    });

    return response.content.trim();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DATA SUMMARIZER
  // Shrne data (pro DIGEST agenty)
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Summarize data (news articles, updates, etc.)
   * @param {object} params
   * @param {Array} params.items - Items to summarize
   * @param {string} params.format - Format: bullets, paragraph, headlines
   * @param {number} params.maxLength - Max chars
   * @param {string} params.focus - What to focus on
   * @returns {Promise<string>}
   */
  async summarize({ items, format = 'bullets', maxLength = 500, focus = null }) {
    const prompt = `Shrň následující položky.

POLOŽKY:
${JSON.stringify(items, null, 2)}

FORMÁT: ${format}
MAX DÉLKA: ${maxLength} znaků
${focus ? `ZAMĚŘENÍ: ${focus}` : ''}

Pravidla:
- Buď stručný a věcný
- Zachovej klíčové informace
- ${format === 'bullets' ? 'Použij odrážky' : format === 'headlines' ? 'Pouze nadpisy' : 'Plynulý text'}

Odpověz POUZE shrnutím, nic jiného.`;

    const response = await this.llm.chat({
      model: 'qwen3.5:27b',
      messages: [{ role: 'user', content: prompt }]
    });

    return response.content.trim();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RECOMMENDATION ENGINE
  // Doporučí náhradu/alternativu (pro TRACKER agenty)
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Generate replacement/upgrade recommendations
   * @param {object} params
   * @param {object} params.item - Item needing replacement
   * @param {Array} params.existingItems - User's other items (for compatibility)
   * @param {object} params.preferences - User preferences
   * @returns {Promise<object>}
   */
  async recommendReplacement({ item, existingItems = [], preferences = {} }) {
    const prompt = `Doporuč náhradu/upgrade pro produkt.

PRODUKT K NÁHRADĚ:
${JSON.stringify(item, null, 2)}

UŽIVATELOVY DALŠÍ PRODUKTY (pro kompatibilitu):
${JSON.stringify(existingItems, null, 2)}

PREFERENCE:
${JSON.stringify(preferences, null, 2)}

Odpověz JSON:
{
  "recommendations": [
    {
      "name": "Název produktu",
      "reason": "Proč je vhodný",
      "compatibility": "Jak je kompatibilní s ostatními",
      "price_range": "Cenový rozsah",
      "priority": "high/medium/low"
    }
  ],
  "general_advice": "Obecná rada"
}`;

    const response = await this.llm.chat({
      model: 'qwen3.5:27b',
      messages: [{ role: 'user', content: prompt }],
      format: 'json'
    });

    try {
      return JSON.parse(response.content);
    } catch {
      return { recommendations: [], general_advice: response.content };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CHANGE EXPLAINER
  // Vysvětlí co se změnilo (pro PRICE_MONITOR agenty)
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Explain what changed and why it might matter
   * @param {object} params
   * @param {object} params.before - Previous state
   * @param {object} params.after - Current state
   * @param {string} params.context - Additional context
   * @returns {Promise<string>}
   */
  async explainChange({ before, after, context = '' }) {
    const prompt = `Vysvětli změnu uživateli.

PŘEDCHOZÍ STAV:
${JSON.stringify(before, null, 2)}

AKTUÁLNÍ STAV:
${JSON.stringify(after, null, 2)}

${context ? `KONTEXT: ${context}` : ''}

Pravidla:
- Buď stručný (1-2 věty)
- Zaměř se na to, co je pro uživatele důležité
- Nehodnoť, jen popisuj

Odpověz POUZE vysvětlením, nic jiného.`;

    const response = await this.llm.chat({
      model: 'qwen3.5:27b',
      messages: [{ role: 'user', content: prompt }]
    });

    return response.content.trim();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ITEM ANALYZER
  // Analyzuje položku (pro HUNTER agenty - proč je zajímavá)
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Analyze why an item matches user's criteria
   * @param {object} params
   * @param {object} params.item - Found item
   * @param {object} params.criteria - User's criteria
   * @returns {Promise<string>}
   */
  async analyzeMatch({ item, criteria }) {
    const prompt = `Vysvětli proč je tato položka zajímavá.

POLOŽKA:
${JSON.stringify(item, null, 2)}

KRITÉRIA UŽIVATELE:
${JSON.stringify(criteria, null, 2)}

Pravidla:
- Max 2 věty
- Zaměř se na to, jak položka odpovídá kritériím
- Zmíň případné výhody nebo nevýhody

Odpověz POUZE analýzou, nic jiného.`;

    const response = await this.llm.chat({
      model: 'qwen3.5:27b',
      messages: [{ role: 'user', content: prompt }]
    });

    return response.content.trim();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DIGEST CATEGORIZER
  // Kategorizuje a řadí položky pro digest
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Categorize and rank items for digest
   * @param {object} params
   * @param {Array} params.items - Items to categorize
   * @param {Array} params.categories - Target categories
   * @returns {Promise<object>}
   */
  async categorizeForDigest({ items, categories }) {
    const prompt = `Roztřiď položky do kategorií a seřaď podle důležitosti.

POLOŽKY:
${JSON.stringify(items, null, 2)}

KATEGORIE:
${JSON.stringify(categories)}

Odpověz JSON:
{
  "categorized": {
    "category_name": [
      { "item": {...}, "importance": 1-10, "reason": "proč je důležité" }
    ]
  },
  "top_story": { "item": {...}, "reason": "proč je top" },
  "skip_list": ["položky co nejsou zajímavé"]
}`;

    const response = await this.llm.chat({
      model: 'qwen3.5:27b',
      messages: [{ role: 'user', content: prompt }],
      format: 'json'
    });

    try {
      return JSON.parse(response.content);
    } catch {
      return { categorized: {}, top_story: null, skip_list: [] };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SCOUT ADVISOR
  // Analyzuje AI novinky a navrhuje relevantní updaty
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Analyze AI updates and suggest relevant improvements
   * @param {object} params
   * @param {Array} params.updates - AI news/updates
   * @param {object} params.systemInfo - Info about C.3 system
   * @returns {Promise<object>}
   */
  async analyzeAIUpdates({ updates, systemInfo }) {
    const prompt = `Analyzuj AI novinky a navrhni relevantní vylepšení pro C.3 systém.

AI NOVINKY:
${JSON.stringify(updates, null, 2)}

INFO O C.3 SYSTÉMU:
${JSON.stringify(systemInfo, null, 2)}

Odpověz JSON:
{
  "relevant": [
    {
      "update": "název/popis novinky",
      "relevance": "high/medium/low",
      "suggested_change": "konkrétní návrh změny v C.3",
      "effort": "low/medium/high",
      "benefit": "očekávaný přínos"
    }
  ],
  "summary": "celkové shrnutí",
  "priority_recommendation": "co udělat jako první"
}`;

    const response = await this.llm.chat({
      model: 'qwen3.5:27b',
      messages: [{ role: 'user', content: prompt }],
      format: 'json'
    });

    try {
      return JSON.parse(response.content);
    } catch {
      return { relevant: [], summary: response.content, priority_recommendation: null };
    }
  }
}

export default LLMServices;
