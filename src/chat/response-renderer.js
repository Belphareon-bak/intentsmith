// CRE v36.9 Response Renderer
// ══════════════════════════════════════════════════════════════════════════════
//
// SINGLE SOURCE OF TEXT GENERATION
//
// ResponseRenderer is the ONLY place where CREDecision → text happens.
// It uses:
//   - Static templates (no LLM) for simple responses
//   - LLM synthesis (max 1× per request, SYNTHESIZER token) for complex answers
//   - QualityGate integration (speech act enforcement + meta-claim sanitization)
//
// Contract:
//   CRE decides WHAT → ResponseRenderer decides HOW to say it
//   LLM call count per render() ≤ 1
//   Only SYNTHESIZER token is used here
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import {
  ResponseTemplate,
  RefusalReason,
  Verbosity,
  isToolCall,
  isAskUser,
  isRefuse,
  isAnswer,
  isMultiStep,
  hasLegacyText
} from './cre-decision-types.js';
import { llmGateway } from '../llm/gateway.js';
import { createAuthToken, LLMCallerRole } from '../llm/auth-types.js';
import { applyQualityGate } from './answer-quality-gate.js';
import { SpeechAct, SystemAction } from './dialog-state-v2.js';

// ════════════════════════════════════════════════════════════════════════════
// STATIC TEMPLATES
// ════════════════════════════════════════════════════════════════════════════

const TEMPLATES = {
  // Slot requests
  slot_request: {
    year: '📅 Pro který rok se ptáš?',
    month: '📅 Který měsíc tě zajímá?',
    location: '📍 Pro jaké místo/město?',
    entity: '🔍 O jaký konkrétní produkt/položku se jedná?',
    topic: '🔍 Jaké téma tě zajímá?',
    timeframe: '📅 Pro jaké období?',
    source: '📋 Z jakého zdroje mám čerpat?',
    format: '📄 V jakém formátu?',
    clarification: '❓ Můžeš upřesnit, co přesně potřebuješ?',
    default: '❓ Potřebuji více informací.'
  },

  // Source selection
  source_selection: {
    news: `📰 **Mohu vyhledat zprávy**, ale potřebuji vědět zdroje.

Dostupné zdroje:
• Reuters, AP, ČTK (mezinárodní)
• Novinky, iDnes, Seznam Zprávy (české)

Které zdroje mám použít?`,

    cars: `🚗 **Mohu vyhledat inzeráty na auta.**

Dostupné zdroje: Sauto, Bazoš, Mobile.de

Mám spustit vyhledávání? Na kterém serveru začít?`,

    flats: `🏠 **Mohu vyhledat nemovitosti.**

Dostupné zdroje: Sreality, Bezrealitky, Reality.cz

Mám spustit vyhledávání? Upřesni prosím lokalitu.`,

    default: `🔍 **Mohu provést vyhledávání.**

Upřesni prosím, co hledáš a kde mám hledat.`
  },

  // Refusal reasons
  refusal: {
    [RefusalReason.CAPABILITY_NOT_AVAILABLE]: '⚠️ Tato funkce není momentálně dostupná.',
    [RefusalReason.BACKEND_NOT_CONFIGURED]: '⚠️ Backend pro tuto operaci není nakonfigurován.',
    [RefusalReason.BACKEND_OFFLINE]: '⚠️ Backend je momentálně nedostupný.',
    [RefusalReason.PERMISSION_REQUIRED]: '🔒 Pro tuto akci je vyžadováno oprávnění.',
    [RefusalReason.PERMISSION_DENIED]: '🔒 Nemám oprávnění provést tuto akci.',
    [RefusalReason.MISSING_REQUIRED_DATA]: '⚠️ Chybí potřebná data pro provedení akce.',
    [RefusalReason.INVALID_INPUT]: '⚠️ Vstupní data nejsou platná.',
    [RefusalReason.UNSAFE_OPERATION]: '⚠️ Tato operace by mohla být nebezpečná.',
    [RefusalReason.RATE_LIMITED]: '⏱️ Příliš mnoho požadavků. Zkus to později.',
    [RefusalReason.AMBIGUOUS_REQUEST]: '❓ Požadavek není jednoznačný. Můžeš upřesnit?',
    [RefusalReason.OUT_OF_SCOPE]: '⚠️ Toto je mimo moje schopnosti.',
    [RefusalReason.INTERNAL_ERROR]: '⚠️ Došlo k interní chybě.'
  },

  // Simple responses
  confirmation: '✅ Hotovo.',
  acknowledgment: '👍 Rozumím.',
  greeting: 'Ahoj! Jak ti mohu pomoci?',
  farewell: 'Na shledanou!',
  chitchat: 'Jsem tu, abych pomohl.',

  // Tool call status
  tool_working: '🔄 Provádím akci...',

  // Execution templates (carried from CRE v36.6)
  execution: {
    ask_data_source: {
      NEWS: `📰 **Mohu vyhledat zprávy**, ale potřebuji vědět zdroje.

Dostupné zdroje:
• Reuters, AP, ČTK (mezinárodní)
• Novinky, iDnes, Seznam Zprávy (české)
• Specializované podle tématu

Které zdroje mám použít?`,

      REPORT: `📊 **Mohu vytvořit report**, ale potřebuji podklady.

Co potřebuji:
• Data k analýze (nebo zdroj odkud je získat)
• Formát reportu (PDF, DOCX)
• Klíčové metriky

Co mi můžeš poskytnout?`,

      DEFAULT: `📋 **Tuto akci umím provést**, ale potřebuji upřesnit zdroj dat.

Jaký zdroj mám použít?`
    },

    offer_search: {
      CARS: `🚗 **Mohu vyhledat inzeráty na auta.**

Dostupné zdroje: Sauto, Bazoš, Mobile.de

Mám spustit vyhledávání? Na kterém serveru začít?`,

      FLATS: `🏠 **Mohu vyhledat nemovitosti.**

Dostupné zdroje: Sreality, Bezrealitky, Reality.cz

Mám spustit vyhledávání? Upřesni prosím lokalitu.`,

      DEFAULT: `🔍 **Mohu provést vyhledávání.**

Dostupné zdroje závisí na typu hledání.
Upřesni prosím, co hledáš a kde mám hledat.`
    },

    block_no_data: `⚠️ **Tuto akci umím**, ale momentálně nemám potřebná data.

Možnosti:
1. Poskytneš mi data
2. Řekneš mi, odkud je mám získat
3. Navrhneme alternativní postup

Jak chceš pokračovat?`
  }
};

// ════════════════════════════════════════════════════════════════════════════
// SPEECH ACT ENFORCEMENT
// ════════════════════════════════════════════════════════════════════════════

function enforceSpeechAct(text, speechAct, state) {
  let result = text || '';
  const changes = [];

  // ESTIMATE/HYPOTHESIS needs uncertainty marker
  if (speechAct === SpeechAct.ESTIMATE || speechAct === SpeechAct.HYPOTHESIS) {
    const hasUncertainty = /⚠️|přibližně|orientačn|možná|pravděpodobně|odhad/i.test(result);
    if (!hasUncertainty) {
      result = '⚠️ **Odhad:** ' + result;
      changes.push('ADDED_ESTIMATE_MARKER');
    }
  }

  // REFUSAL must be clear
  if (speechAct === SpeechAct.REFUSAL) {
    if (!/⚠️|nemohu/i.test(result)) {
      result = '⚠️ ' + result;
      changes.push('ADDED_REFUSAL_MARKER');
    }
  }

  // Enforce forbidNumbers
  if (state?.enforcement?.forbidNumbers) {
    const hasSpecificNumber = /\d+\s*(kč|czk|eur|\$|km\/h|°c|kg|km)/i.test(result);
    if (hasSpecificNumber && !/přibližně|kolem|zhruba|cca/i.test(result)) {
      result = '⚠️ **Upozornění:** Konkrétní hodnoty jsou pouze orientační.\n\n' + result;
      changes.push('ADDED_NUMBER_WARNING');
    }
  }

  // Enforce forbidPrices
  if (state?.enforcement?.forbidPrices) {
    const hasPrice = /\d+\s*(kč|czk|eur|\$)/i.test(result);
    if (hasPrice && !/přibližně|kolem|zhruba|rozmezí/i.test(result)) {
      result = '⚠️ **Upozornění:** Ceny jsou pouze orientační.\n\n' + result;
      changes.push('ADDED_PRICE_WARNING');
    }
  }

  // Enforce requireDisclaimer
  if (state?.needsDisclaimer?.()) {
    const hasDisclaimer = /⚠️|upozornění|orientační|odhad/i.test(result);
    if (!hasDisclaimer) {
      result = '⚠️ **Upozornění:** Následující informace nemusí být přesná.\n\n' + result;
      changes.push('ADDED_DISCLAIMER');
    }
    state.disclaimerGiven = true;
  }

  return { text: result, changes };
}

// ════════════════════════════════════════════════════════════════════════════
// CORRECTION ENFORCEMENT
// ════════════════════════════════════════════════════════════════════════════

function enforceCorrection(text, state) {
  if (!state?.correctionMode) return { text, changes: [] };

  let result = text || '';
  const changes = [];

  const hasAck = /oprav|chyb|máš pravdu|mýlil/i.test(result);
  if (!hasAck) {
    result = '🔄 **Opravuji svou předchozí odpověď.**\n\n' + result;
    changes.push('ADDED_CORRECTION_ACK');
  }

  const defensive = /ale já|měl jsem pravdu|trvám na|nesouhlasím|jak jsem říkal/gi;
  if (defensive.test(result)) {
    result = result.replace(defensive, '');
    changes.push('REMOVED_DEFENSIVE');
  }

  state.correctionMode = false;
  return { text: result, changes };
}

// ════════════════════════════════════════════════════════════════════════════
// SYNTHESIS PROMPT BUILDER
// ════════════════════════════════════════════════════════════════════════════

function buildSynthesisPrompt(template, data, context = {}) {
  let prompt = 'Jsi C.3 Agent. Vygeneruj odpověď na základě dat.\n\n';

  // Template-specific instructions
  switch (template) {
    case ResponseTemplate.FACTUAL_ANSWER:
      prompt += 'INSTRUKCE: Odpověz věcně a přesně na základě dat. Buď stručný.\n';
      break;

    case ResponseTemplate.EXPLANATION:
      prompt += 'INSTRUKCE: Vysvětli srozumitelně a strukturovaně.\n';
      break;

    case ResponseTemplate.RECOMMENDATION:
      prompt += 'INSTRUKCE: Poskytni doporučení na základě dat. Uveď pro a proti.\n';
      break;

    case ResponseTemplate.DATA_SUMMARY:
      prompt += 'INSTRUKCE: Shrň data stručně a přehledně.\n';
      break;

    case ResponseTemplate.ANALYSIS_REPORT:
      prompt += 'INSTRUKCE: Analyzuj data a poskytni strukturovaný report.\n';
      break;

    default:
      prompt += 'INSTRUKCE: Vygeneruj odpověď na základě dat.\n';
  }

  // Verbosity instruction
  const verbosity = context.verbosity || Verbosity.NORMAL;
  if (verbosity === Verbosity.MINIMAL) {
    prompt += 'ROZSAH: Maximálně 2 věty.\n';
  } else if (verbosity === Verbosity.DETAILED) {
    prompt += 'ROZSAH: Detailní odpověď s vysvětlením.\n';
  } else {
    prompt += 'ROZSAH: Stručně, ale úplně.\n';
  }

  // Constraints from state
  if (context.constraints?.length > 0) {
    prompt += '\nOMEZENÍ:\n';
    const constraintDescriptions = {
      'NO_SPECIFIC_NUMBERS': '- NEUVÁDĚJ konkrétní čísla bez ověřeného zdroje',
      'NO_SPECIFIC_DATES': '- NEUVÁDĚJ konkrétní data bez ověření',
      'NO_SPECIFIC_PRICES': '- NEUVÁDĚJ konkrétní ceny',
      'REQUIRE_DISCLAIMER': '- MUSÍŠ uvést upozornění na nejistotu',
      'NO_SPECIFIC_CLAIMS': '- NEUVÁDĚJ konkrétní tvrzení bez evidence'
    };
    for (const c of context.constraints) {
      prompt += `${constraintDescriptions[c] || `- ${c}`}\n`;
    }
  }

  // Context slots
  if (context.resolvedSlots && Object.keys(context.resolvedSlots).length > 0) {
    prompt += '\n🔒 KONTEXT:\n';
    for (const [key, value] of Object.entries(context.resolvedSlots)) {
      prompt += `- ${key}: ${value}\n`;
    }
  }

  // Data payload
  if (data !== null && data !== undefined) {
    prompt += '\n📋 DATA:\n';
    if (typeof data === 'string') {
      prompt += data;
    } else {
      prompt += JSON.stringify(data, null, 2);
    }
  }

  // User question for context
  if (context.userMessage) {
    prompt += `\n\n❓ UŽIVATELOVA OTÁZKA: ${context.userMessage}`;
  }

  // CRITICAL: No meta-claims
  prompt += '\n\n⛔ ZÁKAZY: NIKDY neříkej "jako AI", "nemohu prohledávat internet", "nemám přístup k datům". Odpovídej přímo.';

  return prompt;
}

// ════════════════════════════════════════════════════════════════════════════
// RESPONSE RENDERER
// ════════════════════════════════════════════════════════════════════════════

/**
 * ResponseRenderer - converts CREDecision to text
 *
 * This is the ONLY place where text generation happens.
 * LLM is called MAXIMUM once per render() via SYNTHESIZER token.
 */
export class ResponseRenderer {
  constructor(options = {}) {
    this.templates = { ...TEMPLATES, ...options.templates };
    this.llmCallCount = 0;
  }

  /**
   * Render a CRE decision to text
   *
   * @param {CREDecision} decision
   * @param {Object} context - { state, userMessage, executionResults, sessionId }
   * @returns {Promise<{ text: string, metadata: Object, enforcement: string[] }>}
   */
  async render(decision, context = {}) {
    // Reset per-request LLM counter
    this.llmCallCount = 0;

    if (!decision) {
      return { text: '⚠️ Chyba: Prázdné rozhodnutí.', metadata: { error: true }, enforcement: [] };
    }

    // Handle legacy text (migration period)
    if (hasLegacyText(decision)) {
      return this._applyPostProcessing(
        decision.context.legacyText,
        context,
        { legacy: true }
      );
    }

    // Route to appropriate renderer
    let result;

    if (isAskUser(decision)) {
      result = this._renderAskUser(decision, context);
    } else if (isRefuse(decision)) {
      result = this._renderRefuse(decision, context);
    } else if (isAnswer(decision)) {
      result = await this._renderAnswer(decision, context);
    } else if (isToolCall(decision)) {
      result = {
        text: this.templates.tool_working,
        metadata: { toolCall: decision.tool }
      };
    } else if (isMultiStep(decision)) {
      result = await this._renderMultiStep(decision, context);
    } else {
      result = {
        text: '❓ Neznámý typ rozhodnutí.',
        metadata: { error: true, type: decision.type }
      };
    }

    // Apply post-processing (speech act, quality gate)
    return this._applyPostProcessing(result.text, context, result.metadata);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PRIVATE RENDERERS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Render ASK_USER decision
   */
  _renderAskUser(decision, context) {
    const { slots, template } = decision;

    // Source selection template
    if (template === ResponseTemplate.SOURCE_SELECTION) {
      const sourceType = decision.context?.sourceType || 'default';
      const text = this.templates.source_selection[sourceType] ||
                   this.templates.source_selection.default;
      return { text, metadata: { template, sourceType } };
    }

    // Standard slot request
    if (slots && slots.length > 0) {
      const firstSlot = slots[0];
      const slotName = firstSlot.name || firstSlot.slot || 'default';
      const text = this.templates.slot_request[slotName] ||
                   firstSlot.description ||
                   this.templates.slot_request.default;

      return {
        text,
        metadata: { template, slots: slots.map(s => s.name || s.slot) }
      };
    }

    return {
      text: this.templates.slot_request.default,
      metadata: { template }
    };
  }

  /**
   * Render REFUSE decision
   */
  _renderRefuse(decision, context) {
    const { reason, alternatives } = decision;

    let text = this.templates.refusal[reason] ||
               this.templates.refusal[RefusalReason.OUT_OF_SCOPE];

    // Add alternatives if provided
    if (alternatives && alternatives.length > 0) {
      text += '\n\nMožnosti:\n';
      alternatives.forEach((alt, i) => {
        text += `${i + 1}. ${alt}\n`;
      });
    }

    return {
      text,
      metadata: { template: 'refusal', reason, alternatives }
    };
  }

  /**
   * Render ANSWER decision
   *
   * Uses static templates for simple cases, LLM synthesis for complex ones.
   * LLM is called MAXIMUM once via SYNTHESIZER token.
   */
  async _renderAnswer(decision, context) {
    const { template, data, dataRef, verbosity } = decision;

    // Resolve data from reference if needed
    let renderData = data;
    if (dataRef && context.executionResults) {
      renderData = context.executionResults.get?.(dataRef) ||
                   context.executionResults[dataRef];
    }

    // ─── Static templates (no LLM) ───
    switch (template) {
      case ResponseTemplate.CONFIRMATION:
        return { text: this.templates.confirmation, metadata: { template } };

      case ResponseTemplate.ACKNOWLEDGMENT:
        return { text: this.templates.acknowledgment, metadata: { template } };

      case ResponseTemplate.GREETING:
        return { text: this.templates.greeting, metadata: { template } };

      case ResponseTemplate.FAREWELL:
        return { text: this.templates.farewell, metadata: { template } };

      case ResponseTemplate.CHITCHAT:
        return { text: this.templates.chitchat, metadata: { template } };

      case ResponseTemplate.SEARCH_RESULTS:
        return this._renderSearchResults(renderData, verbosity);

      case ResponseTemplate.SEARCH_NO_RESULTS:
        return {
          text: '🔍 Nebyly nalezeny žádné výsledky.',
          metadata: { template, count: 0 }
        };

      case ResponseTemplate.COMPARISON_TABLE:
        return this._renderComparisonTable(renderData, verbosity);

      case ResponseTemplate.CALENDAR_ANSWER:
        return this._renderCalendarAnswer(renderData, context);

      case ResponseTemplate.ARTIFACT_CREATED:
        return {
          text: `✅ Dokument vytvořen: ${renderData?.filename || 'output'}`,
          metadata: { template, artifact: renderData }
        };

      case ResponseTemplate.ARTIFACT_ERROR:
        return {
          text: `⚠️ Chyba při vytváření dokumentu: ${renderData?.error || 'neznámá chyba'}`,
          metadata: { template, error: renderData?.error }
        };
    }

    // ─── Synthesis templates (LLM max 1×) ───
    if ([ResponseTemplate.FACTUAL_ANSWER,
         ResponseTemplate.EXPLANATION,
         ResponseTemplate.RECOMMENDATION,
         ResponseTemplate.DATA_SUMMARY,
         ResponseTemplate.ANALYSIS_REPORT].includes(template)) {
      return this._synthesize(template, renderData, decision, context);
    }

    // ─── Unknown template - render data as-is ───
    if (renderData) {
      return {
        text: typeof renderData === 'string' ? renderData : JSON.stringify(renderData, null, 2),
        metadata: { template, raw: true }
      };
    }

    return {
      text: '📋 Odpověď vyžaduje dodatečná data.',
      metadata: { template, error: 'no_data' }
    };
  }

  /**
   * Render search results (static, no LLM)
   */
  _renderSearchResults(data, verbosity) {
    if (!data || !Array.isArray(data) || data.length === 0) {
      return {
        text: '🔍 Nebyly nalezeny žádné výsledky.',
        metadata: { template: 'search_results', count: 0 }
      };
    }

    let text = `🔍 **Nalezeno ${data.length} výsledků:**\n\n`;

    const limit = verbosity === Verbosity.MINIMAL ? 3 :
                  verbosity === Verbosity.DETAILED ? 10 : 5;

    data.slice(0, limit).forEach((item, i) => {
      text += `${i + 1}. **${item.title || item.name || 'Položka'}**\n`;
      if (item.description) {
        text += `   ${item.description.substring(0, 100)}...\n`;
      }
      if (item.price) {
        text += `   💰 ${item.price}\n`;
      }
      if (item.url) {
        text += `   🔗 ${item.url}\n`;
      }
      text += '\n';
    });

    if (data.length > limit) {
      text += `\n... a dalších ${data.length - limit} výsledků.`;
    }

    return {
      text,
      metadata: { template: 'search_results', count: data.length, shown: Math.min(data.length, limit) }
    };
  }

  /**
   * Render comparison table (static, no LLM)
   */
  _renderComparisonTable(data, verbosity) {
    if (!data || !Array.isArray(data) || data.length === 0) {
      return {
        text: '📊 Není co porovnat.',
        metadata: { template: 'comparison_table', count: 0 }
      };
    }

    let text = '📊 **Porovnání:**\n\n';
    const keys = Object.keys(data[0] || {}).slice(0, 5);

    data.forEach((item, i) => {
      text += `**${item.name || item.title || `Položka ${i + 1}`}**\n`;
      keys.forEach(key => {
        if (key !== 'name' && key !== 'title' && item[key] !== undefined) {
          text += `  • ${key}: ${item[key]}\n`;
        }
      });
      text += '\n';
    });

    return {
      text,
      metadata: { template: 'comparison_table', count: data.length }
    };
  }

  /**
   * Render calendar answer (static, deterministic)
   */
  _renderCalendarAnswer(data, context) {
    if (!data) {
      return { text: '📅 Kalendářní data nejsou k dispozici.', metadata: { template: 'calendar_answer' } };
    }

    // Calendar answers are pre-computed deterministic text
    if (typeof data === 'string') {
      return { text: data, metadata: { template: 'calendar_answer' } };
    }

    // Structured calendar data
    let text = '📅 ';
    if (data.event) text += `**${data.event}:** `;
    if (data.date) text += data.date;
    if (data.daysUntil !== undefined) text += ` (za ${data.daysUntil} dní)`;

    return { text, metadata: { template: 'calendar_answer', data } };
  }

  /**
   * Render multi-step decision
   */
  async _renderMultiStep(decision, context) {
    const results = [];

    for (const step of decision.steps) {
      const result = await this.render(step, context);
      if (result.text && !result.metadata?.toolCall) {
        results.push(result.text);
      }
    }

    return {
      text: results.join('\n\n'),
      metadata: { template: 'multi_step', stepCount: decision.steps.length }
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LLM SYNTHESIS (max 1× per request)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Synthesize text using LLM (SYNTHESIZER token)
   * Called ONLY for complex templates that need natural language generation.
   *
   * @param {string} template - ResponseTemplate
   * @param {*} data - Data to synthesize from
   * @param {Object} decision - The CREDecision
   * @param {Object} context - Render context
   * @returns {Promise<{text: string, metadata: Object}>}
   */
  async _synthesize(template, data, decision, context) {
    // Guard: max 1 LLM call per render
    if (this.llmCallCount >= 1) {
      logger.warn('ResponseRenderer', 'LLM call limit reached (1/request), using fallback');
      return this._synthesizeFallback(template, data);
    }

    // If no data available, return structural answer without LLM
    if (data === null || data === undefined) {
      return {
        text: '📋 Odpověď vyžaduje dodatečná data.',
        metadata: { template, error: 'no_data' }
      };
    }

    // Build synthesis prompt
    const synthesisContext = {
      verbosity: decision.verbosity || Verbosity.NORMAL,
      constraints: context.constraints || [],
      resolvedSlots: context.resolvedSlots || {},
      userMessage: context.userMessage || ''
    };

    const prompt = buildSynthesisPrompt(template, data, synthesisContext);

    // Create SYNTHESIZER auth token
    const sessionId = context.sessionId || 'renderer-' + Date.now();
    const token = createAuthToken({
      role: LLMCallerRole.SYNTHESIZER,
      decisionId: `synth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      auditContext: { sessionId }
    });

    try {
      // Authorize and call
      llmGateway.authorize(token);

      const result = await llmGateway.call(prompt, {
        capability: 'summarization',
        maxTokens: 1000,
        temperature: 0.3
      });

      this.llmCallCount++;

      logger.info('ResponseRenderer', 'LLM synthesis complete', {
        template,
        outputLength: result.content?.length || 0,
        duration: result.duration
      });

      const synthesizedText = result.content || '';

      if (!synthesizedText.trim()) {
        return this._synthesizeFallback(template, data);
      }

      return {
        text: synthesizedText,
        metadata: { template, synthesized: true, llmDuration: result.duration }
      };

    } catch (error) {
      logger.warn('ResponseRenderer', 'LLM synthesis failed, using fallback', {
        error: error.message, template
      });
      return this._synthesizeFallback(template, data);
    } finally {
      llmGateway.revoke();
    }
  }

  /**
   * Fallback when LLM synthesis is unavailable
   * Renders data in a structured but non-LLM way
   */
  _synthesizeFallback(template, data) {
    if (typeof data === 'string') {
      return { text: data, metadata: { template, fallback: true } };
    }

    // Structured data → formatted text
    if (typeof data === 'object' && data !== null) {
      let text = '';

      if (data.answer) {
        text = data.answer;
      } else if (data.summary) {
        text = data.summary;
      } else if (data.text) {
        text = data.text;
      } else {
        // Generic object formatting
        const entries = Object.entries(data).slice(0, 10);
        text = entries.map(([k, v]) => `**${k}:** ${v}`).join('\n');
      }

      return { text: text || '📋 Data dostupná, ale syntéza selhala.', metadata: { template, fallback: true } };
    }

    return { text: String(data), metadata: { template, fallback: true } };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // POST-PROCESSING (Speech Act + Quality Gate)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Apply speech act enforcement and quality gate
   */
  _applyPostProcessing(text, context, metadata) {
    const state = context.state;
    const decision = context.decision;
    const speechAct = context.speechAct || SpeechAct.FACT;
    let processedText = text;
    const allEnforcement = [];

    // Skip post-processing for tool calls and errors
    if (metadata?.toolCall || metadata?.error) {
      return { text: processedText, metadata, enforcement: [] };
    }

    // Correction enforcement
    if (context.action === SystemAction.CORRECT_PREVIOUS && state) {
      const { text: corrected, changes } = enforceCorrection(processedText, state);
      processedText = corrected;
      allEnforcement.push(...changes);
    }

    // Speech act enforcement
    if (state) {
      const { text: enforced, changes } = enforceSpeechAct(processedText, speechAct, state);
      processedText = enforced;
      allEnforcement.push(...changes);
    }

    // Quality Gate (for LLM-generated responses)
    let qualityGateResult = null;
    if (metadata?.synthesized && state && decision) {
      qualityGateResult = applyQualityGate(processedText, state, decision);

      if (qualityGateResult.fallback) {
        processedText = qualityGateResult.text;
        allEnforcement.push('QUALITY_GATE_FALLBACK');
        logger.warn('ResponseRenderer', 'Quality gate fallback applied', {
          violations: qualityGateResult.violations
        });
      } else if (qualityGateResult.text !== processedText) {
        processedText = qualityGateResult.text;
        allEnforcement.push('QUALITY_GATE_CORRECTION');
      }
    }

    return {
      text: processedText,
      metadata: { ...metadata, qualityGate: qualityGateResult },
      enforcement: allEnforcement
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // EXECUTION TEMPLATE RENDERING (for CRE fallback actions)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Render execution-related templates (ASK_DATA_SOURCE, OFFER_SEARCH, etc.)
   * Used when CRE's execution authority blocks and needs user input.
   */
  renderExecutionFallback(action, context = {}) {
    switch (action) {
      case SystemAction.ASK_DATA_SOURCE: {
        const { workflowIntent } = context;
        if (workflowIntent === 'NEWS_AGGREGATION') {
          return this.templates.execution.ask_data_source.NEWS;
        } else if (workflowIntent === 'REPORT') {
          return this.templates.execution.ask_data_source.REPORT;
        }
        return this.templates.execution.ask_data_source.DEFAULT;
      }

      case SystemAction.OFFER_SEARCH_SETUP: {
        const { message } = context;
        if (/auto|vůz|vozidl|4x4|motor/i.test(message || '')) {
          return this.templates.execution.offer_search.CARS;
        } else if (/byt|nemovitost|dům|pronájem|sreality/i.test(message || '')) {
          return this.templates.execution.offer_search.FLATS;
        }
        return this.templates.execution.offer_search.DEFAULT;
      }

      case SystemAction.BLOCK_NO_DATA:
        return this.templates.execution.block_no_data;

      default:
        return this.templates.slot_request.default;
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ════════════════════════════════════════════════════════════════════════════

export const responseRenderer = new ResponseRenderer();

// ════════════════════════════════════════════════════════════════════════════
// CONVENIENCE FUNCTION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Render a decision to text using the singleton renderer
 */
export async function renderDecision(decision, context = {}) {
  return responseRenderer.render(decision, context);
}

export default {
  ResponseRenderer,
  responseRenderer,
  renderDecision
};
