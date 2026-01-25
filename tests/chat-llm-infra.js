// C.3 v35.2 Chat LLM E2E Test Infrastructure
// ══════════════════════════════════════════════════════════════════════════════
// Real LLM testy - volají skutečný Ollama model
// 
// ⚠️ POZOR: Tyto testy jsou:
//   - Pomalé (5-30s per test)
//   - Potenciálně flaky
//   - NEPATŘÍ do běžného CI
//   - Patří do: nightly, pre-release, manuální QA
//
// Spuštění: node src/tests/chat-llm-e2e.js
// ══════════════════════════════════════════════════════════════════════════════

import { ChatContext, runChatGuards } from '../src/chat/chat-guards.js';
import { 
  containsErrorAdmission,
  containsDefensiveLanguage,
  introducesNewFacts
} from '../src/chat/correction-enforcer.js';
import {
  QueryType,
  Volatility,
  Strategy,
  DialogState,
  detectQueryType,
  detectVolatility,
  decideStrategy,
  analyzeDialog
} from '../src/chat/dialog-control.js';
import { logger } from '../src/core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════

export const LLM_CONFIG = {
  baseUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
  model: process.env.LLM_MODEL || 'qwen2.5:32b',
  timeout: 60000,  // 60s timeout
  retries: 2,
  retryDelay: 2000,
};

// ════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} ChatLLMMetadata
 * @property {string} domain - Detected domain (astronomical, prices, etc.)
 * @property {boolean} usedEvidence - Whether evidence was required/used
 * @property {boolean} correctionModeUsed - Whether correction mode was activated
 * @property {boolean} askedForClarification - Whether LLM asked for clarification
 * @property {'low'|'medium'|'high'} confidence - Response confidence level
 * @property {number|null} detectedYear - Detected year from context
 * @property {number|null} detectedMonth - Detected month from context
 * @property {string[]} sourceUrls - URLs mentioned in response
 * @property {boolean} containsDisclaimer - Whether response has uncertainty disclaimer
 * @property {boolean} admitsError - Whether response admits previous error
 */

/**
 * @typedef {Object} ChatLLMResult
 * @property {string} rawText - Raw LLM response text
 * @property {ChatLLMMetadata} metadata - Extracted metadata
 * @property {Object} guardResult - Result from chat guards
 * @property {Object} context - Chat context state
 * @property {number} latencyMs - Response time in milliseconds
 * @property {boolean} success - Whether the call succeeded
 * @property {string|null} error - Error message if failed
 */

// ════════════════════════════════════════════════════════════════════════════
// LLM CLIENT
// ════════════════════════════════════════════════════════════════════════════

/**
 * Call Ollama LLM with retry logic
 */
async function callOllamaRaw(prompt, systemPrompt = '', options = {}) {
  const { timeout, retries, retryDelay } = { ...LLM_CONFIG, ...options };
  
  let lastError = null;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetch(`${LLM_CONFIG.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: LLM_CONFIG.model,
          prompt: prompt,
          system: systemPrompt,
          stream: false,
          options: {
            temperature: 0.3,  // Lower for more deterministic responses
            num_predict: 1024,
          }
        })
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`LLM API error: ${response.status}`);
      }
      
      const data = await response.json();
      return {
        success: true,
        text: data.response,
        model: data.model,
        totalDuration: data.total_duration
      };
      
    } catch (err) {
      lastError = err;
      
      if (attempt < retries) {
        console.log(`    ⚠️ Retry ${attempt + 1}/${retries} after error: ${err.message}`);
        await new Promise(r => setTimeout(r, retryDelay));
      }
    }
  }
  
  return {
    success: false,
    text: null,
    error: lastError?.message || 'Unknown error'
  };
}

// ════════════════════════════════════════════════════════════════════════════
// METADATA EXTRACTION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Extract metadata from LLM response
 */
export function extractMetadata(rawText, guardResult, context) {
  const metadata = {
    domain: context.get().domain || 'unknown',
    usedEvidence: context.evidenceRequired || false,
    correctionModeUsed: context.correctionMode || false,
    askedForClarification: false,
    confidence: 'medium',
    detectedYear: context.get().year || null,
    detectedMonth: context.get().month || null,
    sourceUrls: [],
    containsDisclaimer: false,
    admitsError: false,
  };
  
  if (!rawText) return metadata;
  
  const textLower = rawText.toLowerCase();
  
  // Detect clarification requests
  const clarificationPatterns = [
    /který rok/i,
    /jaký rok/i,
    /který měsíc/i,
    /upřesni/i,
    /potřebuji vědět/i,
    /můžeš upřesnit/i,
    /myslíš\s+\d{4}/i,
  ];
  metadata.askedForClarification = clarificationPatterns.some(p => p.test(rawText));
  
  // Detect confidence level
  const highConfidencePatterns = [/určitě/, /přesně/, /na 100\s*%/, /jednoznačně/, /bezpochyby/];
  const lowConfidencePatterns = [/nevím/, /nejsem si jist/, /přibližně/, /orientačně/, /možná/, /pravděpodobně/, /bez ověření/];
  
  if (highConfidencePatterns.some(p => p.test(textLower))) {
    metadata.confidence = 'high';
  } else if (lowConfidencePatterns.some(p => p.test(textLower))) {
    metadata.confidence = 'low';
  }
  
  // Detect URLs
  const urlMatches = rawText.match(/https?:\/\/[^\s)]+/g);
  if (urlMatches) {
    metadata.sourceUrls = urlMatches;
  }
  
  // Detect disclaimer
  const disclaimerPatterns = [
    /bez ověření/i,
    /orientační/i,
    /nemusí být přesn/i,
    /doporučuji ověřit/i,
    /⚠️/,
  ];
  metadata.containsDisclaimer = disclaimerPatterns.some(p => p.test(rawText));
  
  // Detect error admission
  const errorAdmissionPatterns = [
    /opravuji/i,
    /máš pravdu/i,
    /omlouvám se/i,
    /měl jsem chybu/i,
    /správně je/i,
    /pardon/i,
  ];
  metadata.admitsError = errorAdmissionPatterns.some(p => p.test(rawText));
  
  // Extract year from response if not in context
  if (!metadata.detectedYear) {
    const yearMatch = rawText.match(/\b(20\d{2})\b/);
    if (yearMatch) {
      metadata.detectedYear = parseInt(yearMatch[1]);
    }
  }
  
  return metadata;
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN CHAT FUNCTION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Full chat pipeline with LLM + Dialog Control Layer
 * 
 * Pipeline:
 *   1. Guards (detekce stavu)
 *   2. DCL Analysis (query type, volatility, strategy)
 *   3. Hard exits
 *   4. LLM call
 *   5. Enforcement
 *   6. Update dialog state
 * 
 * @param {string} message - User message
 * @param {ChatContext} context - Existing context (optional)
 * @param {DialogState} dialogState - Dialog state (optional)
 * @returns {Promise<ChatLLMResult>}
 */
export async function chatLLM(message, existingContext = null, existingDialogState = null) {
  const startTime = Date.now();
  const context = existingContext || new ChatContext();
  const dialogState = existingDialogState || new DialogState();
  
  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 1: GUARDS (legacy - pro zpětnou kompatibilitu)
  // ═══════════════════════════════════════════════════════════════════════
  
  const guardResult = runChatGuards(message, context);
  
  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 2: DIALOG CONTROL LAYER
  // ═══════════════════════════════════════════════════════════════════════
  
  const dcl = analyzeDialog(message, context, dialogState);
  
  // Update dialog state with extracted info from guards
  dialogState.update(dcl.queryType, {
    domain: context.get().domain,
    year: context.get().year,
    month: context.get().month
  });
  
  logger.debug('ChatLLM:DCL', 'Analysis complete', {
    queryType: dcl.queryType,
    volatility: dcl.volatility,
    strategy: dcl.strategy,
    mode: dialogState.mode
  });
  
  // ═══════════════════════════════════════════════════════════════════════
  // STATE CAPTURE
  // ═══════════════════════════════════════════════════════════════════════
  
  const certaintyRequest = /na 100\s*%|stoprocentn|zaruč|garanto|přesně kdy|určitě kdy/i.test(message);
  const yearMatch = message.match(/\b(20\d{2})\b/);
  const requestedYear = yearMatch ? parseInt(yearMatch[1]) : null;
  const distantYear = requestedYear && Math.abs(requestedYear - 2026) > 5;
  const artifactRequestDirect = /udělej|vytvoř|vygeneruj|připrav|sestav/i.test(message) &&
                                 /tabulk|dokument|report|pdf|excel|graf/i.test(message);
  
  const STATE = {
    queryType: dcl.queryType,
    volatility: dcl.volatility,
    strategy: dcl.strategy,
    
    correctionModeActive: context.correctionMode === true || dcl.queryType === QueryType.CORRECT,
    evidenceRequired: context.evidenceRequired === true,
    certaintyRequest,
    distantYear,
    requestedYear,
    
    artifactRequested: guardResult.artifactRequested === true || artifactRequestDirect,
    artifactBlocked: guardResult.artifactAllowed === false,
    artifactBlockReason: guardResult.artifactBlockReason,
    
    // MUST_SHOW_UNCERTAINTY - respektuje DCL
    mustShowUncertainty: computeUncertaintyRequired(dcl, certaintyRequest, distantYear, context, dialogState)
  };
  
  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 3: HARD EXITS
  // ═══════════════════════════════════════════════════════════════════════
  
  // EXIT A: Artifact bait bez kontextu
  if (STATE.artifactRequested && STATE.artifactBlocked && STATE.artifactBlockReason === 'NO_CONTEXT') {
    const fallback = '❓ Co konkrétně mám vytvořit? Potřebuji vědět:\n\n• O čem má být obsah?\n• Jaká data mám použít?\n• V jakém formátu to chceš?';
    
    dialogState.lastAnswerType = 'clarification';
    dialogState.setPendingClarification('artifact_content');
    
    return buildResponse(fallback, {
      guardResult, context, dialogState,
      state: { ...STATE, askedForClarification: true },
      startTime, source: 'ARTIFACT_FALLBACK'
    });
  }
  
  // EXIT B: Guard blocked - BUT check if DCL says noClarification!
  if (!guardResult.proceed && guardResult.action !== 'ARTIFACT_BLOCKED_NO_CONTEXT') {
    // If DCL says no clarification (BUILD mode, locked facts), override guard
    if (dcl.noClarification) {
      logger.info('ChatLLM', 'DCL overrides guard clarification', { strategy: dcl.strategy });
      // Let it proceed to LLM
    } else {
      dialogState.lastAnswerType = 'clarification';
      dialogState.setPendingClarification(guardResult.action);
      
      return buildResponse(guardResult.response, {
        guardResult, context, dialogState, state: STATE, startTime, source: 'GUARD_BLOCKED'
      });
    }
  }
  
  // EXIT C: DCL says REFUSE_WITHOUT_SOURCE
  if (dcl.strategy === Strategy.REFUSE_WITHOUT_SOURCE) {
    const refusal = '⚠️ Tato informace se rychle mění a nemám aktuální zdroj. Pro přesnou odpověď bych potřeboval aktuální data.';
    
    return buildResponse(refusal, {
      guardResult, context, dialogState,
      state: { ...STATE, mustShowUncertainty: true },
      startTime, source: 'DCL_REFUSE'
    });
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 4: LLM CALL
  // ═══════════════════════════════════════════════════════════════════════
  
  const systemPrompt = buildSystemPromptWithDCL(context, guardResult, dcl, dialogState);
  const llmResult = await callOllamaRaw(message, systemPrompt);
  
  if (!llmResult.success) {
    return {
      rawText: null,
      metadata: buildMetadata(null, STATE, context, []),
      guardResult,
      context: context.get(),
      dialogState: dialogState.getSnapshot(),
      latencyMs: Date.now() - startTime,
      success: false,
      error: llmResult.error
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 5: ENFORCEMENT
  // ═══════════════════════════════════════════════════════════════════════
  
  let finalText = llmResult.text;
  let enforcementChanges = [];
  
  // 5A: CORRECTION ENFORCEMENT
  if (STATE.correctionModeActive) {
    const enforced = hardEnforceCorrection(finalText, context);
    finalText = enforced.text;
    enforcementChanges.push(...enforced.changes);
    
    logger.info('ChatLLM', 'Correction HARD enforced', { changes: enforced.changes });
  }
  
  // 5B: UNCERTAINTY ENFORCEMENT - respect DCL noDisclaimer
  if (STATE.mustShowUncertainty && !dcl.noDisclaimer && !dialogState.disclaimerGiven) {
    const enforced = hardEnforceUncertainty(finalText, STATE, context);
    finalText = enforced.text;
    enforcementChanges.push(...enforced.changes);
    
    if (enforced.changes.length > 0) {
      logger.info('ChatLLM', 'Uncertainty HARD enforced', { changes: enforced.changes });
      dialogState.disclaimerGiven = true;
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 6: UPDATE STATE & BUILD RESPONSE
  // ═══════════════════════════════════════════════════════════════════════
  
  if (STATE.correctionModeActive) {
    context.correctionMode = false;
  }
  
  // Lock facts after BUILD
  if (dcl.queryType === QueryType.BUILD && dcl.lockFactsAfter) {
    dialogState.lockAllResolved();
  }
  
  // Record answer type
  dialogState.lastAnswerType = STATE.correctionModeActive ? 'correction' : 
                               STATE.mustShowUncertainty ? 'estimate' : 'fact';
  
  return buildResponse(finalText, {
    guardResult, context, dialogState, state: STATE,
    startTime, source: 'LLM', enforcementChanges
  });
}

/**
 * Compute whether uncertainty is required - DCL-aware
 */
function computeUncertaintyRequired(dcl, certaintyRequest, distantYear, context, dialogState) {
  // CONFIRMATION mode → NEVER show uncertainty
  if (dcl.queryType === QueryType.CONFIRM) {
    return false;
  }
  
  // BUILD mode → trust context
  if (dcl.queryType === QueryType.BUILD) {
    return false;
  }
  
  // DCL says noDisclaimer
  if (dcl.noDisclaimer) {
    return false;
  }
  
  // Certainty requests ALWAYS need uncertainty
  if (certaintyRequest) {
    return true;
  }
  
  // Distant year ALWAYS needs disclaimer
  if (distantYear && !context.get().source) {
    return true;
  }
  
  // HIGH volatility without source
  if (dcl.volatility === Volatility.HIGH && !context.get().source) {
    return true;
  }
  
  // LOW volatility → trust LLM
  if (dcl.volatility === Volatility.LOW) {
    return false;
  }
  
  // MEDIUM volatility - check if context is resolved
  if (dcl.volatility === Volatility.MEDIUM) {
    if (dialogState.hasSufficientContext(['year', 'location', 'month'])) {
      return false;  // Context resolved, no need for uncertainty
    }
    return !dialogState.disclaimerGiven;  // Show once if not resolved
  }
  
  return false;
}

/**
 * Build system prompt with DCL awareness
 */
function buildSystemPromptWithDCL(context, guardResult, dcl, dialogState) {
  const lock = context.get();
  
  let prompt = `Jsi C.3 Agent, inteligentní asistent. Dodržuj tato pravidla:

1. NIKDY nevymýšlej fakta. Pokud nevíš, řekni to.
2. Respektuj kontext konverzace.
`;

  // Add mode-specific instructions
  if (dcl.strategy === Strategy.CONFIRM_CONTEXT) {
    prompt += `
⚠️ CONFIRMATION MODE:
- Uživatel chce validaci své myšlenky, NE nové informace
- Odpověz jen "Ano, dává to smysl, protože..." nebo "Ne, tady je problém..."
- NEHLEDEJ nové informace
- NEPTEJ SE na upřesnění
`;
  }
  
  if (dcl.queryType === QueryType.BUILD) {
    prompt += `
⚠️ BUILD MODE:
- Uživatel doplnil kontext (${Object.entries(dialogState.resolvedFacts).map(([k,v]) => `${k}=${v}`).join(', ')})
- Použij tento kontext a ODPOVĚZ
- NEPTEJ SE znovu na to, co už víš
`;
  }
  
  if (dcl.queryType === QueryType.CORRECT) {
    prompt += `
⚠️ CORRECTION MODE:
- Uživatel opravuje tvou předchozí odpověď
- PŘIZNEJ chybu a oprav se
- NEBRAŇ SE
`;
  }

  // Context lock info
  if (lock.year || lock.month) {
    prompt += `\n🔒 ZAMČENÝ KONTEXT: ${lock.year ? `rok ${lock.year}` : ''} ${lock.month ? `měsíc ${lock.month}` : ''}\n`;
    prompt += `   NESMÍŠ se znovu ptát na tyto údaje!\n`;
  }

  if (lock.source) {
    prompt += `\n📌 ZDROJ: ${lock.source}\n`;
  }

  // Volatility-based instructions
  if (dcl.volatility === Volatility.HIGH && !lock.source) {
    prompt += `\n⚡ VYSOKÁ VOLATILITA: Tato data se rychle mění. Bez aktuálního zdroje NESMÍŠ uvádět přesná čísla.\n`;
  }
  
  if (dcl.volatility === Volatility.LOW) {
    prompt += `\n📚 STABILNÍ FAKTA: Toto jsou neměnná fakta, můžeš odpovědět přímo ze znalostí.\n`;
  }

  return prompt;
}

/**
 * HARD enforcement - uncertainty (GLOBAL)
 * Pokud MUST_SHOW_UNCERTAINTY a odpověď neobsahuje nejistotu → VYNUŤ
 */
function hardEnforceUncertainty(text, state, context) {
  const changes = [];
  let result = text || '';
  
  // Check if uncertainty is already present
  const hasUncertainty = /⚠️|nevím|nejsem si jist|přibližně|orientačn|možná|pravděpodobně|bez ověření|nelze potvrdit|nemusí být přesn/i.test(result);
  
  if (hasUncertainty) {
    return { text: result, changes };
  }
  
  // CERTAINTY REQUEST → explicit refusal + uncertainty
  if (state.certaintyRequest) {
    result = '⚠️ **Nemohu garantovat stoprocentní jistotu.** Informace mohu poskytnout pouze s určitou mírou nejistoty.\n\n' + result;
    changes.push('ADDED_CERTAINTY_REFUSAL');
  }
  // DISTANT YEAR → add disclaimer
  else if (state.distantYear) {
    result = `⚠️ **Upozornění:** Pro rok ${state.requestedYear} nemohu poskytnout ověřené informace. Následující je pouze orientační.\n\n` + result;
    changes.push('ADDED_DISTANT_YEAR_DISCLAIMER');
  }
  // EVIDENCE REQUIRED → add general disclaimer
  else if (state.evidenceRequired) {
    result = '⚠️ **Upozornění:** Následující informace nemusí být přesná bez ověření z aktuálního zdroje.\n\n' + result;
    changes.push('ADDED_EVIDENCE_DISCLAIMER');
  }
  
  return { text: result, changes };
}

/**
 * HARD enforcement - deterministické úpravy textu
 * NEZÁVISÍ na LLM, VŽDY se aplikují
 */
function hardEnforceCorrection(text, context) {
  const changes = [];
  let result = text || '';
  
  // INVARIANT 1: Přiznání chyby MUSÍ být přítomno
  if (!containsErrorAdmission(result)) {
    result = '🔄 **Opravuji svou předchozí odpověď.**\n\n' + result;
    changes.push('ADDED_ERROR_ADMISSION');
  }
  
  // INVARIANT 2: Obranný jazyk MUSÍ být odstraněn
  if (containsDefensiveLanguage(result)) {
    result = stripDefensiveLanguage(result);
    changes.push('STRIPPED_DEFENSIVE');
  }
  
  // INVARIANT 3: Nová fakta bez zdroje MUSÍ mít disclaimer
  if (introducesNewFacts(result) && !context?.get()?.source) {
    if (!result.includes('⚠️')) {
      result += '\n\n⚠️ *Tato informace vyžaduje ověření.*';
      changes.push('ADDED_UNCERTAINTY_DISCLAIMER');
    }
  }
  
  return { text: result, changes };
}

/**
 * Odstraní obranný jazyk z textu
 */
function stripDefensiveLanguage(text) {
  const defensivePatterns = [
    /ale já\b[^.!?]*/gi,
    /měl jsem pravdu[^.!?]*/gi,
    /trvám na[^.!?]*/gi,
    /nesouhlasím[^.!?]*/gi,
    /jak jsem říkal[^.!?]*/gi,
    /podle mě[^.!?]*/gi,
  ];
  
  let result = text;
  for (const pattern of defensivePatterns) {
    result = result.replace(pattern, '').replace(/\s{2,}/g, ' ');
  }
  
  return result.trim();
}

/**
 * Builduje finální response objekt
 */
function buildResponse(text, { guardResult, context, dialogState = null, state, startTime, source, enforcementChanges = [] }) {
  const metadata = buildMetadata(text, state, context, enforcementChanges);
  
  return {
    rawText: text,
    metadata,
    guardResult,
    context: context.get(),
    dialogState: dialogState?.getSnapshot?.() || null,
    latencyMs: Date.now() - startTime,
    success: true,
    error: null,
    source,
    correctionEnforced: state.correctionModeActive && enforcementChanges.length > 0,
    correctionChanges: enforcementChanges
  };
}

/**
 * Builduje metadata - VŽDY používá STATE, nikdy context.correctionMode
 */
function buildMetadata(text, state, context, enforcementChanges) {
  const lock = context.get();
  
  // Check for uncertainty markers (must match what we add in enforcement)
  const hasUncertaintyMarkers = text ? /⚠️|nevím|nejsem si jist|přibližně|orientačn|možná|pravděpodobně|bez ověření|nelze potvrdit|nemusí být přesn|nemohu garantovat|pouze orientační/i.test(text) : false;
  
  return {
    // Domain & context
    domain: lock.domain || 'unknown',
    detectedYear: lock.year || extractYearFromText(text),
    detectedMonth: lock.month || null,
    sourceUrls: extractUrls(text),
    
    // Evidence & Uncertainty
    usedEvidence: state.evidenceRequired,
    containsDisclaimer: hasUncertaintyMarkers,
    uncertaintyEnforced: enforcementChanges.some(c => c.includes('DISCLAIMER') || c.includes('UNCERTAINTY') || c.includes('REFUSAL')),
    
    // Correction - VŽDY z STATE, NIKDY z context
    correctionModeUsed: state.correctionModeActive,  // ← HARD: z captured state
    correctionEnforced: enforcementChanges.some(c => c.includes('ERROR') || c.includes('DEFENSIVE')),
    correctionChanges: enforcementChanges,
    admitsError: text ? containsErrorAdmission(text) : false,
    hasDefensiveLanguage: text ? containsDefensiveLanguage(text) : false,
    
    // Clarification
    askedForClarification: state.askedForClarification || detectClarificationRequest(text),
    
    // Confidence - if uncertainty was enforced, always low
    confidence: state.mustShowUncertainty ? 'low' : determineConfidence(text, state)
  };
}

function extractYearFromText(text) {
  if (!text) return null;
  const match = text.match(/\b(20\d{2})\b/);
  return match ? parseInt(match[1]) : null;
}

function extractUrls(text) {
  if (!text) return [];
  const matches = text.match(/https?:\/\/[^\s)]+/g);
  return matches || [];
}

function detectClarificationRequest(text) {
  if (!text) return false;
  return /který rok|jaký rok|který měsíc|upřesni|potřebuji vědět|konkrétně/i.test(text);
}

function determineConfidence(text, state) {
  if (!text) return 'low';
  if (state.correctionModeActive) return 'low';  // V correction mode vždy low
  if (/určitě|přesně|na 100|jednoznačně/i.test(text)) return 'high';
  if (/nevím|nejsem si jist|přibližně|možná|pravděpodobně|⚠️/i.test(text)) return 'low';
  return 'medium';
}

/**
 * Multi-turn conversation
 */
export async function chatLLMSequence(messages) {
  const context = new ChatContext();
  const results = [];
  
  for (const msg of messages) {
    const result = await chatLLM(msg, context);
    results.push({
      query: msg,
      ...result
    });
    
    if (!result.success) {
      console.log(`    ⚠️ LLM call failed: ${result.error}`);
    }
  }
  
  return { context, results };
}

// ════════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT BUILDER
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// FUZZY ASSERTIONS
// ════════════════════════════════════════════════════════════════════════════

export const fuzzy = {
  /**
   * Check if text contains any of the patterns
   */
  containsAny(text, patterns) {
    if (!text) return false;
    const textLower = text.toLowerCase();
    return patterns.some(p => {
      if (p instanceof RegExp) return p.test(text);
      return textLower.includes(p.toLowerCase());
    });
  },
  
  /**
   * Check if text does NOT contain any of the patterns
   */
  containsNone(text, patterns) {
    return !this.containsAny(text, patterns);
  },
  
  /**
   * Check if text mentions a specific year
   */
  mentionsYear(text, year) {
    if (!text) return false;
    return text.includes(String(year));
  },
  
  /**
   * Check if text mentions a different year (not the expected one)
   */
  mentionsDifferentYear(text, expectedYear, range = 5) {
    if (!text) return false;
    for (let y = expectedYear - range; y <= expectedYear + range; y++) {
      if (y !== expectedYear && text.includes(String(y))) {
        return true;
      }
    }
    return false;
  },
  
  /**
   * Check if response shows uncertainty
   */
  showsUncertainty(text) {
    return this.containsAny(text, [
      'nevím', 'nejsem si jist', 'přibližně', 'orientačně', 'orientační',
      'možná', 'pravděpodobně', 'bez ověření', 'nelze potvrdit',
      '⚠️', 'upozornění', 'disclaimer',
      'nemohu garantovat', 'pouze orientační', 'nemusí být přesn'
    ]);
  },
  
  /**
   * Check if response shows high confidence (bad for unverified facts)
   */
  showsHighConfidence(text) {
    return this.containsAny(text, [
      'určitě', 'přesně', 'na 100', 'jednoznačně', 'bezpochyby',
      'zaručeně', 'definitivně', 'nepochybně'
    ]);
  },
  
  /**
   * Check if response admits error
   */
  admitsError(text) {
    return this.containsAny(text, [
      'opravuji', 'máš pravdu', 'omlouvám se', 'měl jsem chybu',
      'správně je', 'pardon', 'chyba', 'špatně jsem'
    ]);
  },
  
  /**
   * Check if response asks for clarification
   */
  asksForClarification(text) {
    return this.containsAny(text, [
      'který rok', 'jaký rok', 'který měsíc', 'upřesni',
      'potřebuji vědět', 'můžeš upřesnit', 'myslíš'
    ]);
  },
  
  /**
   * Check if response contains specific date (should be avoided without evidence)
   */
  containsSpecificDate(text) {
    // Matches patterns like "15. února", "20. 2.", "2026-02-15"
    return /\d{1,2}\.\s*(ledna|února|března|dubna|května|června|července|srpna|září|října|listopadu|prosince|\d{1,2}\.)/i.test(text);
  }
};

// ════════════════════════════════════════════════════════════════════════════
// TEST LOGGING
// ════════════════════════════════════════════════════════════════════════════

export function logTestResult(testName, result, assertions) {
  console.log(`\n    📊 ${testName} Details:`);
  console.log(`    ├─ Latency: ${result.latencyMs}ms`);
  console.log(`    ├─ Domain: ${result.metadata.domain}`);
  console.log(`    ├─ Confidence: ${result.metadata.confidence}`);
  console.log(`    ├─ Evidence Required: ${result.metadata.usedEvidence}`);
  console.log(`    ├─ Correction Mode: ${result.metadata.correctionModeUsed}`);
  console.log(`    ├─ Asked Clarification: ${result.metadata.askedForClarification}`);
  console.log(`    ├─ Contains Disclaimer: ${result.metadata.containsDisclaimer}`);
  console.log(`    ├─ Admits Error: ${result.metadata.admitsError}`);
  console.log(`    ├─ Year: ${result.metadata.detectedYear}`);
  console.log(`    ├─ Month: ${result.metadata.detectedMonth}`);
  console.log(`    └─ Sources: ${result.metadata.sourceUrls.length}`);
  
  if (assertions && assertions.length > 0) {
    console.log(`    📋 Assertions:`);
    for (const a of assertions) {
      const icon = a.passed ? '✓' : '✗';
      console.log(`       ${icon} ${a.name}: ${a.passed ? 'PASS' : 'FAIL'}`);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export default {
  LLM_CONFIG,
  chatLLM,
  chatLLMSequence,
  extractMetadata,
  fuzzy,
  logTestResult
};
