// CRE v56.2 Sprint C2 — LLM Synthesis Layer
// ══════════════════════════════════════════════════════════════════════════════
// Extracted from handlers.js for better modularity
//
// v56.2 Sprint C2: conversationContext parameter added to buildSynthesisPrompt
//   and synthesizeWithLLM — LLM now sees previous turns for pronoun resolution
// v45.0 Architecture: Tools return DATA, LLM generates RESPONSE
// This module handles all LLM synthesis operations.
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../../../core/logger.js';
import { FORBIDDEN_PHRASES } from '../../cre-decision.js';
import { Structure, FollowUpStyle } from '../../../memory/preferences.js';
import { detectFluff, buildFluffRetryPrompt } from './quality.js';
import { enforceOutputContract, buildOutputGateRetryPrompt } from './output-gate.js';
import { getLanguageContext } from './language.js';
import { buildStrictLanguageInstruction, validateResponseLanguage, buildLanguageRetryInstruction, mechanicalSlovakToCzech, detectSlovakContamination } from './language-enforcement.js';
import {
  filterToolResults,
  annotateWithTrust,
  calculateAnswerConfidence,
  getConfidenceSynthesisInstructions,
} from '../../quality/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// v62.2: SOURCE URL EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract source URLs from tool execution data for explicit LLM reference.
 * Walks through all tool results and collects { title, url } pairs.
 */
function extractSourceUrls(data) {
  const urls = [];
  const seen = new Set();
  if (!data || !Array.isArray(data)) return urls;

  for (const item of data) {
    // Search results: { type: 'search', data: { results: [{ title, url, snippet }] } }
    if (item?.data?.results && Array.isArray(item.data.results)) {
      for (const r of item.data.results) {
        if (r?.url && !seen.has(r.url)) {
          seen.add(r.url);
          urls.push({ title: r.title || '', url: r.url });
        }
      }
    }
    // Scrape results: { type: 'scrape', data: { url, title, content } }
    if (item?.data?.url && !seen.has(item.data.url)) {
      seen.add(item.data.url);
      urls.push({ title: item.data.title || '', url: item.data.url });
    }
  }
  return urls.slice(0, 10); // Cap at 10 sources
}

// ─────────────────────────────────────────────────────────────────────────────
// QUERY TYPE DETECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determine if query is asking for a list/multiple results
 */
export function isListQuery(query) {
  const listPatterns = [
    /nejlepší|top|seznam|list|přehled|porovn|srovn/i,
    /všechny|všech|multiple|several|many/i,
    /\d+\s*(nejlepší|top|možností|options)/i,
    /kolik|how many/i,
  ];
  return listPatterns.some(p => p.test(query));
}

/**
 * Determine if query is asking for a specific answer
 */
export function isSpecificQuery(query) {
  const specificPatterns = [
    /co je|what is|who is|kdo je/i,
    /kdy|when|kolik stojí|how much/i,
    /^najdi\s+\w+$/i,
    /konkrétní|specific|exact/i,
  ];
  return specificPatterns.some(p => p.test(query));
}

// ─────────────────────────────────────────────────────────────────────────────
// RELEVANCE SCORING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate relevance score for a search result
 * @param {Object} result - Search result { title, url, snippet }
 * @param {string} query - User query
 * @returns {number} Score 0-1
 */
export function calculateRelevanceScore(result, query) {
  if (!result || !query) return 0;

  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  let score = 0;
  let maxScore = queryWords.length * 3;

  const title = (result.title || '').toLowerCase();
  const snippet = (result.snippet || '').toLowerCase();
  const url = (result.url || '').toLowerCase();

  for (const word of queryWords) {
    if (title.includes(word)) score += 3;
    if (snippet.includes(word)) score += 2;
    if (url.includes(word)) score += 1;
  }

  return maxScore > 0 ? Math.min(score / maxScore, 1) : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// ADAPTIVE RESULT COUNT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply adaptive result count to tool data
 * v45.0 FIX 1.3 - Dynamically determine how many results to include
 * 
 * @param {Array} data - Tool result data array
 * @param {string} query - User query
 * @param {string} intent - Detected intent
 * @returns {Array} Filtered data with appropriate result count
 */
export function applyAdaptiveResultCount(data, query, intent) {
  return data.map(item => {
    if (item.type !== 'search' || !item.data?.results) {
      return item;
    }

    const results = item.data.results;
    const isList = isListQuery(query);
    const isSpecific = isSpecificQuery(query);

    // Determine target count based on query type and intent
    let targetCount;
    if (intent === 'REPORT') {
      targetCount = isList ? 10 : 5;
    } else if (intent === 'FACTUAL') {
      targetCount = isSpecific ? 1 : 3;
    } else if (intent === 'SEARCH') {
      targetCount = isList ? 8 : (isSpecific ? 2 : 5);
    } else {
      targetCount = 5;
    }

    // Calculate relevance scores and sort
    const scoredResults = results.map(r => ({
      ...r,
      relevanceScore: calculateRelevanceScore(r, query),
    }));
    scoredResults.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Apply minimum relevance threshold for non-list queries
    let filteredResults = scoredResults;
    if (!isList && scoredResults.length > 1) {
      const minRelevance = 0.2;
      filteredResults = scoredResults.filter(r => r.relevanceScore >= minRelevance);
      if (filteredResults.length === 0) {
        filteredResults = [scoredResults[0]];
      }
    }

    const finalResults = filteredResults.slice(0, targetCount);

    logger.debug('Synthesis', 'Applied adaptive filtering', {
      originalCount: results.length,
      filteredCount: finalResults.length,
      targetCount,
      isList,
      isSpecific,
      intent,
    });

    return {
      ...item,
      data: {
        ...item.data,
        results: finalResults,
        originalCount: results.length,
        adaptiveFiltered: true,
      },
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the prompt for LLM synthesis
 * v45.0 Phase 3: Added expertHints support
 */
export function buildSynthesisPrompt({ query, intent, data, failures, userPreferences, expertHints = null, conversationContext = null, allToolResults = null }) {
  let prompt = `User query: "${query}"\n\n`;

  // v56.2 Sprint C2: Inject conversation context so LLM knows what pronouns refer to
  // "A co jeho teorém?" → LLM sees previous turn was about Pythagoras
  if (conversationContext && conversationContext.length > 0) {
    prompt += `Recent conversation context:\n`;
    for (const turn of conversationContext.slice(-3)) {
      if (turn.userInput) prompt += `  User: ${turn.userInput}\n`;
      if (turn.assistantSummary) prompt += `  Assistant: ${turn.assistantSummary}\n`;
    }
    prompt += `\n`;
  }

  prompt += `Intent: ${intent}\n\n`;

  // Apply adaptive result count before sending to LLM
  const adaptedData = applyAdaptiveResultCount(data, query, intent);

  prompt += `Tool execution data:\n`;
  prompt += '```json\n';
  prompt += JSON.stringify(adaptedData, null, 2);
  prompt += '\n```\n\n';

  // v62.2b: Pre-extract source URLs — try adapted data first, fallback to ALL tool results
  // This ensures URLs are always available even when relevance filter removes search results
  let sourceUrls = extractSourceUrls(adaptedData);
  if (sourceUrls.length === 0 && allToolResults) {
    sourceUrls = extractSourceUrls(allToolResults);
  }
  if (sourceUrls.length > 0) {
    prompt += `\n═══ AVAILABLE SOURCE URLs (MANDATORY — include at least 2 in your response) ═══\n`;
    sourceUrls.forEach((src, i) => {
      prompt += `[${i + 1}] ${src.title || src.url} — ${src.url}\n`;
    });
    prompt += `═══ END SOURCE URLs — USE FULL URLs like https://... in your response ═══\n\n`;
  }

  if (failures.length > 0) {
    prompt += `Note: Some tools failed:\n`;
    failures.forEach(f => {
      prompt += `- ${f.type}: ${f.error}\n`;
    });
    prompt += '\n';
  }

  // Add user preferences
  const prefLines = [];
  if (userPreferences.verbosity) prefLines.push(`verbosity: ${userPreferences.verbosity}`);
  if (userPreferences.structure) prefLines.push(`structure: ${userPreferences.structure}`);
  if (userPreferences.followUpStyle) prefLines.push(`follow-up style: ${userPreferences.followUpStyle}`);
  if (userPreferences.technicalDepth) prefLines.push(`technical depth: ${userPreferences.technicalDepth}`);

  if (prefLines.length > 0) {
    prompt += `User preferences: ${prefLines.join(', ')}\n`;
  }

  // Expert hints
  if (expertHints?.active) {
    prompt += `\nExpert mode: ${expertHints.expertName} (${Math.round(expertHints.influence * 100)}% intensity)\n`;
    if (expertHints.systemAddition) {
      prompt += `Expert guidance: ${expertHints.systemAddition}\n`;
    }
  }

  prompt += `\nSynthesize a helpful response based on this data.`;

  return prompt;
}

/**
 * Build system prompt for synthesis based on intent
 * v45.0 Phase 3: Added expertHints and responseIntent support
 * v55.2: Added languageInstruction for language consistency
 */
export function buildSynthesisSystemPrompt(intent, userPreferences, expertHints = null, responseIntent = null, languageInstruction = '', lang = 'cs', searchSubType = null) {
  // v62.2b: Language instruction FIRST — prevents EN contamination at source
  // The LLM reads system prompt top-to-bottom; language rule must come before anything else
  let basePrompt = '';
  basePrompt += buildStrictLanguageInstruction(lang);
  if (languageInstruction) {
    basePrompt += languageInstruction;
  }

  basePrompt += `\n\nYou are a response synthesizer. Your job is to take tool execution data and create a helpful, well-structured response for the user.

CRITICAL RULES:
1. ONLY use information from the provided tool data - do not make up facts
2. Be concise and relevant to the user's query
3. Use markdown formatting for readability
4. If data is limited, acknowledge it but still provide what you can
5. NEVER say "I cannot access" or "I don't have access" - you have the data!
6. RESPOND IN THE USER'S LANGUAGE — if user writes in Czech, respond ENTIRELY in Czech
7. START WITH SUBSTANCE — first sentence must directly answer the question or present a fact. NEVER start with meta-phrases like "Na základě dostupných informací", "Zde je přehled", "Po prozkoumání", "Based on the search results"

FORBIDDEN PHRASES (never use these):
${FORBIDDEN_PHRASES.slice(0, 5).map(p => `- "${p}"`).join('\n')}`;

  // Expert style hints
  if (expertHints?.active && expertHints.influence >= 0.25) {
    basePrompt += `\n\nEXPERT MODE (${expertHints.expertName}):`;
    
    switch (expertHints.style) {
      case 'creative': basePrompt += '\n- Use creative, expressive language'; break;
      case 'technical': basePrompt += '\n- Use precise technical terminology'; break;
      case 'formal': basePrompt += '\n- Maintain formal, professional tone'; break;
      case 'casual': basePrompt += '\n- Use friendly, approachable language'; break;
    }
    
    switch (expertHints.depth) {
      case 'deep': basePrompt += '\n- Provide thorough, detailed explanations'; break;
      case 'shallow': basePrompt += '\n- Keep explanations brief and focused'; break;
    }
    
    if (expertHints.caution === 'high') {
      basePrompt += '\n- Include disclaimers and caveats where appropriate';
      basePrompt += '\n- Emphasize limitations and risks';
    }
    
    if (expertHints.influence >= 0.5 && expertHints.systemAddition) {
      basePrompt += `\n- ${expertHints.systemAddition}`;
    }

    // v57.1 A7: Domain-specific synthesis instructions
    if (expertHints.domainSynthesis) {
      basePrompt += `\n\n${expertHints.domainSynthesis}`;
    }
  }

  // Intent-specific prompts
  const intentPrompts = getIntentPrompts();
  if (intentPrompts[intent]) {
    basePrompt += intentPrompts[intent];
  }

  // v62.2: SEARCH sub-type specific instructions
  if (searchSubType) {
    const subTypeInstructions = getSearchSubTypeInstructions();
    if (subTypeInstructions[searchSubType]) {
      basePrompt += subTypeInstructions[searchSubType];
    }
  }

  // Response intent formatting
  if (responseIntent) {
    const responseIntentInstructions = getResponseIntentInstructions();
    if (responseIntentInstructions[responseIntent]) {
      basePrompt += `\n\n════════════════════════════════════════════════════════════════════════════════
🎯 USER REQUESTED FORMAT — FOLLOW EXACTLY
════════════════════════════════════════════════════════════════════════════════
${responseIntentInstructions[responseIntent]}
════════════════════════════════════════════════════════════════════════════════`;
    }
  }

  // Strict preference enforcement
  basePrompt += buildStrictPreferencesPrompt(userPreferences);

  // v62.2b: Language instructions already at TOP of prompt (moved from here)
  // Add a final reminder at the end as well (belt + suspenders)
  if (lang === 'cs') {
    basePrompt += `\n\n⚠️ ZÁVĚREČNÉ PŘIPOMENUTÍ: Celá odpověď MUSÍ být v češtině. Žádná angličtina, žádná slovenština.`;
  }

  return basePrompt;
}

/**
 * Get intent-specific synthesis prompts
 */
function getIntentPrompts() {
  return {
    SEARCH: `
═══════════════════════════════════════════════════════════════════════════════
SEARCH RESPONSE CONTRACT — FOLLOW EXACTLY
═══════════════════════════════════════════════════════════════════════════════

STRUCTURE:
1. FIRST SENTENCE: Direct answer to the question (not "Vyhledal jsem..." or "Našel jsem...")
2. SUPPORTING DETAIL: 2-3 sentences with specific facts (numbers, dates, names)
3. SOURCES: At end, formatted as numbered footnotes with FULL URLs from tool data

SOURCE FORMAT (MANDATORY — always include at least 1 source):
[1] [Title](https://example.com/page)
[2] [Title](https://other.com/page)

Extract URLs from the "url" fields in tool execution data. EVERY response MUST end with at least one [N] source footnote containing a real URL from the data.

ABSOLUTELY FORBIDDEN:
- ❌ Starting with "Vyhledal jsem pro vás..."
- ❌ Starting with "Našel jsem tyto výsledky..."
- ❌ Starting with "Zde jsou výsledky..."
- ❌ Empty footnotes like "[1]" without URL
- ❌ Generic filler: "Na internetu najdete...", "Doporučuji zkontrolovat..."
- ❌ Saying "potřeboval bych vyhledávání" or "nemám aktuální data"

REQUIRED:
- ✅ Start with the ANSWER, not the search process
- ✅ Include at least ONE concrete fact (number, date, name, price)
- ✅ If multiple results: synthesize, don't list
- ✅ End with [1], [2] source footnotes with FULL URLs
═══════════════════════════════════════════════════════════════════════════════`,

    REPORT: `
═══════════════════════════════════════════════════════════════════════════════
CRITICAL: REPORT = INTELLIGENT SYNTHESIS
You must SYNTHESIZE information, not just list sources!
═══════════════════════════════════════════════════════════════════════════════

YOUR JOB:
1. ANALYZE the scraped content thoroughly
2. IDENTIFY key facts, events, and patterns relevant to the query
3. SYNTHESIZE a coherent narrative that ANSWERS the user's question
4. ORGANIZE information logically (chronological, by topic, by importance)

ABSOLUTELY FORBIDDEN:
- ❌ Listing source URLs as the main content
- ❌ Copying raw scraped text
- ❌ "Zde jsou zdroje:" followed by links
- ❌ Generic phrases like "Na těchto stránkách najdete..."

REQUIRED OUTPUT:
- ✅ Original synthesis in YOUR words
- ✅ Key points organized with bullet points or sections
- ✅ Specific facts, numbers, dates when available
- ✅ At least 3 concrete data points (names, numbers, dates)
- ✅ Sources as numbered footnotes with FULL URLs: [1] [Title](https://...)`,

    FACTUAL: `
═══════════════════════════════════════════════════════════════════════════════
FACTUAL RESPONSE CONTRACT — FOLLOW EXACTLY
═══════════════════════════════════════════════════════════════════════════════

STRUCTURE:
1. FIRST SENTENCE: The answer. One sentence. Concrete fact.
   GOOD: "Lhůta pro podání DPFO je 1. dubna 2025."
   BAD:  "Podle dostupných informací existuje několik termínů..."
2. BRIEF EXPLANATION: 1-2 sentences max. Only if it adds value.
3. SOURCE: One footnote [1] with FULL URL from tool data: [1] [Title](https://...)

RULES:
- Maximum 3 sentences total
- MUST contain at least one concrete datum (number, date, name)
- Extract concrete data from tool results — numbers, prices, dates, names
- If data is in the tool results, USE IT — do not say "nepodařilo se ověřit"
- NEVER start with hedging phrases for factual answers
═══════════════════════════════════════════════════════════════════════════════`,

    ITEM_LOOKUP: `
═══════════════════════════════════════════════════════════════════════════════
CRITICAL: ITEM_LOOKUP = SPECIFIC ITEMS WITH LINKS
You must return SPECIFIC ITEMS the user can click on!
═══════════════════════════════════════════════════════════════════════════════

YOUR JOB:
1. Extract the NUMBER of items requested
2. Find ACTUAL listings/products/items from the results
3. Each item MUST have a clickable URL
4. Include price, location, key details when available

REQUIRED OUTPUT FORMAT:
1. **[Item title]** - [price] | [location]
   [Brief description]
   🔗 [direct link to this specific item]`,
  };
}

/**
 * Get response intent instructions
 */
function getResponseIntentInstructions() {
  return {
    DIRECT: `
RESPONSE STYLE: DIRECT
- Answer in one clear sentence or short paragraph
- No headers, no bullet lists, no preamble
- Get straight to the point`,

    SUMMARY: `
RESPONSE STYLE: SUMMARY
- Condense the information to its essence
- Maximum 2-3 sentences
- Focus on the single most important takeaway`,

    BULLETS: `
RESPONSE STYLE: BULLETS
- MANDATORY: Use bullet points only
- No paragraphs, no headers
- Each bullet: one key point (5-15 words)`,

    COMPARISON: `
RESPONSE STYLE: COMPARISON
- Use a side-by-side format (table or parallel lists)
- Highlight key differences clearly
- Include both similarities AND differences`,

    STEP_BY_STEP: `
RESPONSE STYLE: STEP-BY-STEP
- Use numbered steps (1, 2, 3...)
- Each step: clear, actionable instruction
- One action per step`,

    EXPLORATORY: `
RESPONSE STYLE: EXPLORATORY
- Present multiple options/directions
- Don't commit to one answer
- Offer trade-offs for each option`,

    OPINIONATED: `
RESPONSE STYLE: OPINIONATED
- Give a clear recommendation
- State your reasoning (2-3 points)
- Be confident but not dismissive`,

    MINIMAL: `
RESPONSE STYLE: MINIMAL
- Absolute minimum words needed
- Just the answer: number, date, yes/no, name
- No explanation, no context, no sources`,
  };
}

/**
 * v62.2: Get SEARCH sub-type specific instructions.
 * Tailors synthesis for NEWS, SPEC, COMPARISON, FACTUAL_NUMERIC, PERSON, CLASSIFIED queries.
 */
function getSearchSubTypeInstructions() {
  return {
    NEWS: `

SEARCH SUB-TYPE: NEWS — CURRENT EVENTS
- Extract SPECIFIC headlines, events, and dates from the data
- Each news item must have: headline, 1-sentence summary, source URL
- Minimum 3 concrete news items if data is available
- NEVER say "informace jsou omezené" if data contains actual articles
- Organize chronologically or by importance`,

    SPEC: `

SEARCH SUB-TYPE: TECH SPECIFICATIONS
- Present specs in STRUCTURED format (bullet list or table)
- Required fields where available: display, processor/chip, RAM, battery, camera, dimensions, weight
- Include specific NUMBERS (MHz, mAh, MP, mm, g)
- Source URL is MANDATORY
- NEVER use prose paragraphs for specs — use structured bullets`,

    COMPARISON: `

SEARCH SUB-TYPE: COMPARISON
- Present BOTH/ALL items being compared with equal detail
- Use parallel structure (same attributes for each item)
- Include specific numbers for key metrics
- End with a brief recommendation/summary of differences
- Table or side-by-side format preferred`,

    FACTUAL_NUMERIC: `

SEARCH SUB-TYPE: FACTUAL/NUMERIC DATA
- The answer MUST contain at least one concrete number (price, rate, temperature, percentage)
- Extract the actual value from search results — do NOT just link to websites
- If the exact number is in the search snippets or page titles, USE IT
- If the snippet says "25.12 Kč" or "3°C" — PUT THAT NUMBER in your response
- Format: "Aktuální kurz: XX.XX Kč/EUR [1]" or "Teplota: X°C [1]"
- NEVER say "podívejte se na stránky" or "nebyly přesně uvedeny" — this is FORBIDDEN
- NEVER refuse to give the number — even approximate values are better than no answer
- Look for numbers in: titles, snippets, URLs, page content — extract them ALL
- If no exact number is in the search data, provide your BEST ESTIMATE with "(přibližně)" prefix
- Examples: "Aktuální kurz eura je přibližně 25,20 Kč [1]", "Teplota je přibližně 5°C [1]"
- Your estimate should be reasonable and based on general knowledge
- An approximate answer is ALWAYS better than redirecting to a website`,

    PERSON: `

SEARCH SUB-TYPE: PERSON LOOKUP
- Start with: "[Name] je [current role/occupation]."
- Include at least 3 key facts about the person
- Use CURRENT information from search results, not outdated training data
- Source URL is MANDATORY`,

    CLASSIFIED: `

SEARCH SUB-TYPE: CLASSIFIED LISTINGS
- Each item MUST have a clickable URL — use the FULL https://... URL from the source list above
- Include: title, price, location, key details
- Present items as numbered list
- FORMAT each item EXACTLY like this:
  1. **[Title]** — [price] | [location]
     [Brief description]
     🔗 [Source name](https://full-url-from-source-list)
- If individual listing URLs are not available, use the search/category page URL
- ALWAYS include at least 2 source URLs from the "AVAILABLE SOURCE URLs" section above`,
  };
}

/**
 * Build strict preferences prompt section
 */
function buildStrictPreferencesPrompt(userPreferences) {
  const strictPreferences = [];

  // Verbosity
  if (userPreferences.verbosity === 'minimal' || userPreferences.verbosity === 'brief') {
    strictPreferences.push('VERBOSITY: MINIMAL — Maximum 3 sentences. No fluff.');
  } else if (userPreferences.verbosity === 'detailed') {
    strictPreferences.push('VERBOSITY: DETAILED — Provide thorough explanations with examples.');
  }

  // Structure
  if (userPreferences.structure === Structure.BULLETS || userPreferences.structure === 'bullets') {
    strictPreferences.push('STRUCTURE: BULLETS — You MUST use bullet points.');
  } else if (userPreferences.structure === Structure.PARAGRAPHS || userPreferences.structure === 'paragraphs') {
    strictPreferences.push('STRUCTURE: PARAGRAPHS — You MUST use flowing prose.');
  }

  // Follow-up style
  if (userPreferences.followUpStyle === FollowUpStyle.CONCISE || userPreferences.followUpStyle === 'concise') {
    strictPreferences.push('FOLLOW-UP: CONCISE — Keep responses brief and direct.');
  }

  if (strictPreferences.length === 0) return '';

  return `

═══════════════════════════════════════════════════════════════════════════════
⚠️  STRICT USER PREFERENCES — REQUIREMENTS, NOT SUGGESTIONS!
═══════════════════════════════════════════════════════════════════════════════

${strictPreferences.map(p => `• ${p}`).join('\n')}

VIOLATION OF THESE PREFERENCES IS AN ERROR.
═══════════════════════════════════════════════════════════════════════════════`;
}

// ─────────────────────────────────────────────────────────────────────────────
// FALLBACK RESPONSES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build fallback response when synthesis fails
 */
export function buildSynthesisFailureResponse(query, failures) {
  let content = `⚠️ **Nepodařilo se získat data pro váš dotaz**\n\n`;
  content += `**Dotaz:** ${query}\n\n`;

  if (failures.length > 0) {
    content += `**Problémy:**\n`;
    failures.forEach(f => {
      content += `- ${f.type}: ${f.error || 'neznámá chyba'}\n`;
    });
  }

  content += `\nZkuste to prosím znovu nebo přeformulujte dotaz.`;
  return content;
}

/**
 * Build basic synthesis without LLM (emergency fallback)
 */
export function buildBasicSynthesis(query, intent, data) {
  let content = '';

  const searchData = data.find(d => d.type === 'search');
  if (searchData?.data?.results) {
    content += `📊 **Výsledky vyhledávání**\n\n`;
    searchData.data.results.slice(0, 5).forEach((r, i) => {
      content += `${i + 1}. **${r.title || 'Bez názvu'}**\n`;
      if (r.url) content += `   🔗 ${r.url}\n`;
      if (r.snippet) content += `   ${r.snippet}\n`;
      content += '\n';
    });
  }

  const scrapeData = data.find(d => d.type === 'scrape');
  if (scrapeData?.data?.content) {
    content += `📄 **Obsah stránky**\n\n`;
    content += scrapeData.data.content.substring(0, 1000);
    if (scrapeData.data.content.length > 1000) content += '...';
    content += '\n';
  }

  const localData = data.find(d => d.type === 'local');
  if (localData?.data) {
    content += `📊 **Výsledek:** ${JSON.stringify(localData.data)}\n`;
  }

  return content || `Dotaz: ${query}\n\nData zpracována, ale bez možnosti syntézy.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SYNTHESIS FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * synthesizeWithLLM - Generate human response from tool data
 *
 * v45.0 - Core architecture change: Tools return DATA, LLM generates RESPONSE
 * v45.0 FIX 3.3 - Confidence gate: detect fluff, retry with improved prompt
 *
 * @param {Object} options
 * @param {string} options.query - Original user query
 * @param {string} options.intent - Detected intent
 * @param {Array} options.toolResults - Array of ToolResult objects
 * @param {Object} options.context - Handler context
 * @param {Object} options.userPreferences - User preferences
 * @param {Object} options.expertHints - Expert synthesis hints
 * @param {string} options.responseIntent - ResponseIntent
 * @param {Function} options.creDecisionEngine - CRE decision engine reference
 * @returns {Promise<{ content: string, confidence: number, model: string }>}
 */
export async function synthesizeWithLLM({
  query,
  intent,
  toolResults,
  context = {},
  userPreferences = {},
  expertHints = null,
  responseIntent = null,
  creDecisionEngine = null,
  conversationContext = null,  // v56.2 Sprint C2: previous turns for reference resolution
  searchSubType = null,       // v62.2: NEWS/SPEC/COMPARISON/FACTUAL_NUMERIC/PERSON/CLASSIFIED/GENERAL
}) {
  // Extract successful results
  const successfulData = toolResults
    .filter(r => r.success !== false)
    .map(r => ({ type: r.type, data: r.data, meta: r.meta }));

  // Extract failures
  const failures = toolResults
    .filter(r => r.success === false)
    .map(r => ({ type: r.type, error: r.error, errorCode: r.errorCode }));

  // If no successful data, return degraded response
  if (successfulData.length === 0) {
    return {
      content: buildSynthesisFailureResponse(query, failures),
      confidence: 0.3,
      model: 'fallback',
    };
  }

  // ─── Quality Pipeline (K5.1-K5.3) ──────────────────────────────────────
  // 1. Filter by relevance to query
  const filterResult = filterToolResults(successfulData, query);
  // 2. Annotate with source trust weights (expects ARRAY, not filter object)
  const relevantItems = filterResult.relevant || [];
  const annotatedData = annotateWithTrust(relevantItems);
  // 3. Calculate confidence based on evidence strength (expects filter OBJECT)
  const confidenceInfo = calculateAnswerConfidence(filterResult, annotatedData);
  // 4. Get tone instructions matching confidence
  const confidenceInstructions = getConfidenceSynthesisInstructions(confidenceInfo);
  // ─────────────────────────────────────────────────────────────────────────

  // Build prompts
  let synthesisPrompt = buildSynthesisPrompt({
    query, intent, data: relevantItems.length > 0 ? relevantItems : successfulData,
    failures, userPreferences, expertHints,
    conversationContext,  // v56.2 Sprint C2
    allToolResults: successfulData,  // v62.2b: Pass ALL results for URL extraction fallback
  });

  // v61.2: When scrapes failed, instruct LLM to maximize snippet extraction
  if (context.snippetOnlyMode) {
    synthesisPrompt += `\n\nIMPORTANT: Full page content could not be fetched (sites blocked scraping). `
      + `You MUST extract and synthesize ALL available information from the search result snippets above. `
      + `Present every relevant fact, headline, and detail found in the snippets. `
      + `Do NOT say you cannot access the pages — work with what you have and be thorough.`;
  }
  // v55.2: Detect language and inject instruction
  const langCtx = getLanguageContext(query);
  const systemPrompt = buildSynthesisSystemPrompt(intent, userPreferences, expertHints, responseIntent, langCtx.instruction, langCtx.language, searchSubType)
    + (confidenceInstructions ? `\n\n${confidenceInstructions}` : '');

  const MAX_RETRIES = 1;  // v62.2b: back to 1 — extra retries are too slow, controller gate handles the rest
  let retryCount = 0;

  try {
    const creBridge = await import('../../../llm/cre-bridge.js');

    // v59.0 IDE Bridge: Notify LLM synthesis start
    if (typeof context.onLLMStart === 'function') {
      try { context.onLLMStart('synthesis', synthesisPrompt.length); } catch { /* */ }
    }

    while (retryCount <= MAX_RETRIES) {
      const result = await creBridge.generateChatResponse(synthesisPrompt, systemPrompt, {
        sessionId: `synth-${context.sessionId || 'default'}`,
        temperature: retryCount === 0 ? 0.4 : 0.5,
      });

      // Validate response
      if (creDecisionEngine) {
        const validation = creDecisionEngine.validateResponse(result.content);
        if (!validation.valid) {
          logger.warn('Synthesis', 'LLM generated forbidden phrase', {
            violations: validation.violations,
            intent,
          });
        }
      }

      // Check for fluff
      const fluffCheck = detectFluff(result.content, successfulData);

      if (fluffCheck.isFluff && retryCount < MAX_RETRIES) {
        logger.warn('Synthesis', 'Fluff detected, retrying', {
          reason: fluffCheck.reason,
          confidence: fluffCheck.confidence,
          retryCount,
        });
        synthesisPrompt = buildFluffRetryPrompt(synthesisPrompt, fluffCheck);
        retryCount++;
        continue;
      }

      if (fluffCheck.isFluff) {
        logger.warn('Synthesis', 'Fluff detected but max retries reached', {
          reason: fluffCheck.reason,
        });
      }

      // ─── D6 Output Quality Gate (v55.2) ────────────────────────────────
      // Runs AFTER fluff check. Validates semantic quality:
      // D6.1: Zombie/meta responses
      // D6.2: Minimum content density
      // D6.3: Response intent enforcement
      // ───────────────────────────────────────────────────────────────────
      const gateVerdict = enforceOutputContract(result.content, {
        intent,
        responseIntent,
      });

      if (!gateVerdict.ok && retryCount < MAX_RETRIES) {
        logger.warn('Synthesis', `D6 gate failed (${gateVerdict.failDimension}), retrying`, {
          reason: gateVerdict.reason,
          retryCount,
        });
        synthesisPrompt = buildOutputGateRetryPrompt(synthesisPrompt, gateVerdict);
        retryCount++;
        continue;
      }

      if (!gateVerdict.ok) {
        logger.warn('Synthesis', `D6 gate failed but max retries reached`, {
          dimension: gateVerdict.failDimension,
          reason: gateVerdict.reason,
        });
      }
      // ─── End D6 Output Quality Gate ────────────────────────────────────

      // ─── v62.2: Language Validation Gate ──────────────────────────────
      // Catches SK/EN contamination in synthesis path (same as decisions.js ANSWER path)
      const langValidation = validateResponseLanguage(result.content, langCtx.language);
      if (!langValidation.clean && retryCount < MAX_RETRIES) {
        logger.warn('Synthesis', 'Language validation failed, retrying', {
          issues: langValidation.issues,
          language: langCtx.language,
          retryCount,
        });
        synthesisPrompt = buildLanguageRetryInstruction(langCtx.language, langValidation.issues)
          + '\n\n' + synthesisPrompt;
        retryCount++;
        continue;
      }
      if (!langValidation.clean) {
        logger.warn('Synthesis', 'Language validation failed but max retries reached', {
          issues: langValidation.issues,
        });
      }
      // ─── End Language Validation Gate ─────────────────────────────────

      // ─── Tool-Only Numeric Enforcement (expert opt-in, v57.2) ────────
      if (expertHints?.toolEnforcement && retryCount < MAX_RETRIES) {
        const guard = await import('../../../experts/guards/tool-enforcement.js');
        const numericVerdict = guard.verifyNumericClaims(result.content, successfulData);

        if (!numericVerdict.ok) {
          logger.warn('Synthesis', 'Tool enforcement: unbacked numbers detected', {
            unbacked: numericVerdict.unbacked.length,
            backed: numericVerdict.backed.length,
            reason: numericVerdict.reason,
          });
          synthesisPrompt = guard.buildToolEnforcementRetryPrompt(synthesisPrompt, numericVerdict);
          retryCount++;
          continue;
        }
      }
      if (expertHints?.toolEnforcement && retryCount >= MAX_RETRIES) {
        const guard = await import('../../../experts/guards/tool-enforcement.js');
        const finalNumericVerdict = guard.verifyNumericClaims(result.content, successfulData);
        if (!finalNumericVerdict.ok) {
          logger.warn('Synthesis', 'Tool enforcement failed but max retries reached', {
            reason: finalNumericVerdict.reason,
          });
        }
      }
      // ─── End Tool Enforcement ────────────────────────────────────────

      // ─── v55.2 Sprint 2.4: Confidence-based response styling ─────────
      const finalConfidence = fluffCheck.isFluff ? 0.6 : (gateVerdict.ok ? 0.85 : 0.55);
      let finalContent = result.content;

      // Degraded transparency: if confidence < 0.6, add honesty suffix
      if (finalConfidence < 0.6 && confidenceInfo?.level === 'uncertain') {
        finalContent += '\n\n---\n⚠️ *Odpověď vychází z omezených nebo neověřených dat.*';
      } else if (finalConfidence < 0.6 && !gateVerdict.ok) {
        finalContent += '\n\n---\n⚠️ *Kvalita odpovědi je omezená. Zkuste dotaz upřesnit pro lepší výsledek.*';
      }

      // Confidence boost: if HIGH confidence + good gate, no suffix needed
      // This is the happy path — clean, confident answer
      // ─── End confidence styling ────────────────────────────────────

      // v59.0 IDE Bridge: Notify gate verdict
      if (typeof context.onGateVerdict === 'function') {
        try {
          context.onGateVerdict({
            ok: gateVerdict.ok,
            dimension: gateVerdict.failDimension,
            confidence: finalConfidence,
            fluff: fluffCheck.isFluff,
            retried: retryCount > 0,
          });
        } catch { /* */ }
      }

      // v59.0 IDE Bridge: Notify LLM synthesis done
      if (typeof context.onLLMDone === 'function') {
        try { context.onLLMDone(finalContent.length, result.duration); } catch { /* */ }
      }

      // v62.2b: Apply mechanical Slovak→Czech replacement as final step
      // Fast (0ms) and catches common SK words that survive LLM retries
      if (langCtx.language === 'cs') {
        const skCheck = detectSlovakContamination(finalContent);
        if (skCheck.contaminated) {
          logger.info('Synthesis', 'Applying mechanical SK→CZ replacement', {
            markers: skCheck.markers.slice(0, 3),
          });
          finalContent = mechanicalSlovakToCzech(finalContent);
        }
      }

      // v62.2e: LinkGuard — force-append source URLs when SEARCH response lacks links
      // Deterministic fix: never let LLM decide whether to cite sources
      if ((intent === 'SEARCH' || searchSubType) && finalContent.length > 100) {
        const linkCount = (finalContent.match(/https?:\/\/\S+/g) || []).length;
        if (linkCount < 2) {
          let sourceUrls = extractSourceUrls(successfulData);
          if (sourceUrls.length === 0) {
            sourceUrls = extractSourceUrls(toolResults);
          }
          if (sourceUrls.length > 0) {
            const urlBlock = sourceUrls.slice(0, 5).map((u, i) =>
              `[${i + 1}] [${u.title || 'Zdroj'}](${u.url})`
            ).join('\n');
            finalContent += `\n\n**Zdroje:**\n${urlBlock}`;
            logger.info('Synthesis', 'LinkGuard: force-appended source URLs', {
              appended: Math.min(sourceUrls.length, 5),
              existing: linkCount,
            });
          }
        }
      }

      return {
        content: finalContent,
        confidence: finalConfidence,
        model: result.model,
        duration: result.duration,
        retried: retryCount > 0,
        gateVerdict: gateVerdict.ok ? undefined : gateVerdict,
        confidenceLevel: confidenceInfo?.level,
      };
    }

    return {
      content: buildBasicSynthesis(query, intent, successfulData),
      confidence: 0.5,
      model: 'fallback',
    };

  } catch (err) {
    logger.error('Synthesis', `LLM synthesis failed: ${err.message}`);
    return {
      content: buildBasicSynthesis(query, intent, successfulData),
      confidence: 0.5,
      model: 'fallback',
    };
  }
}

export default {
  synthesizeWithLLM,
  buildSynthesisPrompt,
  buildSynthesisSystemPrompt,
  buildSynthesisFailureResponse,
  buildBasicSynthesis,
  applyAdaptiveResultCount,
  isListQuery,
  isSpecificQuery,
  calculateRelevanceScore,
};
