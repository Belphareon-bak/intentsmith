// C.3 v35.3 Conversational Reasoning Engine (CRE)
// ══════════════════════════════════════════════════════════════════════════════
// 
// CRE je hlavní orchestrační vrstva pro chat.
// 
// Integruje:
// - DialogState (jediný zdroj pravdy)
// - Decision Layer (vrací jedinou povolenou akci)
// - Response Generation (LLM s constraints)
// - Enforcement (post-processing)
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import {
  DialogState,
  Decision,
  DialogIntent,
  PermittedAction,
  AnswerType,
  CorrectionType,
  Volatility,
  Certainty,
  Domain
} from './dialog-state.js';
import {
  makeDecision,
  detectIntent,
  detectVolatility,
  detectDomain
} from './decision-layer.js';

// ════════════════════════════════════════════════════════════════════════════
// CRE RESULT
// ════════════════════════════════════════════════════════════════════════════

export class CREResult {
  constructor() {
    this.success = false;
    this.rawText = null;
    this.decision = null;
    this.dialogState = null;
    this.enforcement = {
      changes: [],
      corrected: false
    };
    this.metadata = {};
    this.error = null;
  }
  
  static success(text, decision, dialogState) {
    const r = new CREResult();
    r.success = true;
    r.rawText = text;
    r.decision = decision;
    r.dialogState = dialogState.getSnapshot();
    return r;
  }
  
  static failure(error) {
    const r = new CREResult();
    r.success = false;
    r.error = error;
    return r;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// RESPONSE TEMPLATES
// ════════════════════════════════════════════════════════════════════════════

const TEMPLATES = {
  ASK: {
    year: '📅 Pro který rok se ptáš?',
    month: '📅 Který měsíc tě zajímá?',
    location: '📍 Pro jaké místo/město?',
    entity: '🔍 O jaký konkrétní produkt/položku se jedná?',
    artifact_content: '❓ Co konkrétně mám vytvořit?\n\n• O čem má být obsah?\n• Jaká data mám použít?\n• V jakém formátu to chceš?',
    topic: '🔍 Jaké téma tě zajímá?',
    timeframe: '📅 Pro jaké období?'
  },
  
  REFUSE: {
    high_volatility: '⚠️ Tato informace se rychle mění a nemám aktuální zdroj.\n\nPro přesnou odpověď bych potřeboval aktuální data.',
    no_source: '⚠️ Bez ověřeného zdroje nemohu poskytnout spolehlivou odpověď na tuto otázku.'
  },
  
  DEFER: {
    need_search: '🔍 Pro tuto informaci bych potřeboval vyhledat aktuální data. Chceš, abych to zkusil najít?'
  }
};

// ════════════════════════════════════════════════════════════════════════════
// PROMPT BUILDER
// ════════════════════════════════════════════════════════════════════════════

/**
 * Build system prompt based on decision constraints
 */
function buildPrompt(decision, dialogState) {
  let prompt = `Jsi C.3 Agent, inteligentní asistent. STRIKTNĚ dodržuj následující pravidla:\n\n`;
  
  // Action-specific instructions
  switch (decision.action) {
    case PermittedAction.ANSWER:
      prompt += `AKCE: ODPOVĚZ na otázku.\n`;
      break;
    case PermittedAction.CONFIRM:
      prompt += `AKCE: POTVRĎ nebo VYVRAŤ uživatelovu myšlenku.\n`;
      prompt += `- NEHLEDEJ nové informace\n`;
      prompt += `- NEKLADEŠ nové otázky\n`;
      prompt += `- Použij POUZE existující kontext\n`;
      break;
  }
  
  // Answer type constraint
  if (decision.constraints.answerType) {
    const typeInstructions = {
      [AnswerType.FACTUAL]: 'Odpověz KONKRÉTNÍMI FAKTY.',
      [AnswerType.STRUCTURAL]: 'Odpověz RÁMCOVĚ a OBECNĚ. NEUVÁDĚJ konkrétní čísla bez zdroje.',
      [AnswerType.EXPLANATORY]: 'VYSVĚTLI koncept nebo mechanismus.',
      [AnswerType.CONDITIONAL]: 'Odpověz PODMÍNĚNĚ (pokud X, pak Y).',
      [AnswerType.REFUSAL]: 'ODMÍTNI odpovědět a vysvětli proč.'
    };
    prompt += `\nTYP ODPOVĚDI: ${typeInstructions[decision.constraints.answerType]}\n`;
  }
  
  // Max certainty constraint
  if (decision.constraints.maxCertainty) {
    if (decision.constraints.maxCertainty === Certainty.LOW) {
      prompt += `\n⚠️ MAXIMÁLNÍ JISTOTA: NÍZKÁ\n`;
      prompt += `- NEUVÁDĚJ přesná čísla bez zdroje\n`;
      prompt += `- NEPŘEDSTÍREJ jistotu\n`;
      prompt += `- Použij "přibližně", "orientačně", "závisí na..."\n`;
    }
  }
  
  // Must include constraints
  if (decision.constraints.mustInclude.length > 0) {
    prompt += `\nMUSÍŠ ZAHRNOUT:\n`;
    for (const item of decision.constraints.mustInclude) {
      prompt += `- ${item}\n`;
    }
  }
  
  // Must avoid constraints
  if (decision.constraints.mustAvoid.length > 0) {
    prompt += `\nNESMÍŠ ZAHRNOUT:\n`;
    for (const item of decision.constraints.mustAvoid) {
      prompt += `- ${item}\n`;
    }
  }
  
  // Context from dialog state
  if (dialogState.resolvedFacts.size > 0) {
    prompt += `\n🔒 KONTEXT (NESMÍŠ se znovu ptát):\n`;
    for (const [key, value] of dialogState.resolvedFacts) {
      prompt += `- ${key}: ${value}\n`;
    }
  }
  
  // Domain-specific instructions
  if (dialogState.domain !== Domain.UNKNOWN) {
    prompt += `\nDOMÉNA: ${dialogState.domain}\n`;
  }
  
  // Correction mode
  if (dialogState.hasPendingCorrection()) {
    const correction = dialogState.pendingCorrection;
    prompt += `\n⚠️ REŽIM OPRAVY (${correction.type}):\n`;
    prompt += `- PŘIZNEJ předchozí chybu\n`;
    prompt += `- NEBRAŇ SE\n`;
    prompt += `- Extrahuj správnou informaci z uživatelova vstupu\n`;
  }
  
  return prompt;
}

// ════════════════════════════════════════════════════════════════════════════
// ENFORCEMENT
// ════════════════════════════════════════════════════════════════════════════

/**
 * Enforce decision constraints on LLM output
 */
function enforceConstraints(text, decision, dialogState) {
  let result = text || '';
  const changes = [];
  
  // Correction enforcement
  if (dialogState.hasPendingCorrection()) {
    const hasAdmission = /oprav|chyb|máš pravdu|mýlil|špatn/i.test(result);
    if (!hasAdmission) {
      result = '🔄 **Opravuji svou předchozí odpověď.**\n\n' + result;
      changes.push('ADDED_CORRECTION_ADMISSION');
    }
    
    // Remove defensive language
    const defensive = /ale já|měl jsem pravdu|trvám na|nesouhlasím|jak jsem říkal/gi;
    if (defensive.test(result)) {
      result = result.replace(defensive, '');
      changes.push('REMOVED_DEFENSIVE');
    }
  }
  
  // Max certainty enforcement
  if (decision.constraints.maxCertainty === Certainty.LOW) {
    const hasUncertainty = /přibližně|orientačn|závisí|možná|pravděpodobně|⚠️|nevím|nejsem si jist/i.test(result);
    if (!hasUncertainty) {
      result = '⚠️ **Upozornění:** Následující informace je pouze orientační.\n\n' + result;
      changes.push('ADDED_UNCERTAINTY_DISCLAIMER');
      dialogState.disclaimerGiven = true;
    }
  }
  
  // Structural answer enforcement (no specific numbers)
  if (decision.constraints.answerType === AnswerType.STRUCTURAL) {
    // Check for specific price/number claims without source
    const hasSpecificClaim = /\d+\s*(kč|czk|eur|\$|km\/h|°c)/i.test(result) && 
                             !/přibližně|orientačn|kolem|zhruba/i.test(result);
    if (hasSpecificClaim) {
      result = '⚠️ **Upozornění:** Konkrétní hodnoty jsou pouze orientační.\n\n' + result;
      changes.push('ADDED_STRUCTURAL_DISCLAIMER');
    }
  }
  
  return { text: result, changes };
}

// ════════════════════════════════════════════════════════════════════════════
// REPEAT PREVENTION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Simple hash for repeat detection
 */
function computeResponseHash(text) {
  if (!text) return null;
  // Simple hash: first 100 chars normalized
  return text.toLowerCase().replace(/\s+/g, ' ').substring(0, 100);
}

/**
 * Check if response is a repeat
 */
function isRepeat(text, dialogState) {
  const hash = computeResponseHash(text);
  return hash && hash === dialogState.lastTurn.responseHash;
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN CRE FUNCTION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Process a message through the Conversational Reasoning Engine
 * 
 * @param {string} message - User message
 * @param {DialogState} dialogState - Current dialog state
 * @param {object} context - Additional context (source, etc.)
 * @param {Function} llmCall - Function to call LLM (message, systemPrompt) => text
 * @returns {Promise<CREResult>}
 */
export async function processMessage(message, dialogState, context = {}, llmCall = null) {
  const startTime = Date.now();
  
  try {
    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 1: DECISION
    // ═══════════════════════════════════════════════════════════════════════
    
    const decision = makeDecision(message, dialogState, context);
    
    logger.info('CRE', 'Decision made', {
      action: decision.action,
      reason: decision.reason,
      constraints: decision.constraints
    });
    
    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 2: HANDLE NON-LLM ACTIONS
    // ═══════════════════════════════════════════════════════════════════════
    
    // ASK → Return template question
    if (decision.action === PermittedAction.ASK) {
      const slot = decision.constraints.mustAsk[0];
      const response = TEMPLATES.ASK[slot] || `❓ Upřesni prosím: ${slot}`;
      
      dialogState.recordTurn(PermittedAction.ASK, decision.reason, null, slot);
      
      return CREResult.success(response, decision, dialogState);
    }
    
    // REFUSE → Return refusal
    if (decision.action === PermittedAction.REFUSE) {
      const response = TEMPLATES.REFUSE.high_volatility;
      
      dialogState.recordTurn(PermittedAction.REFUSE, decision.reason, AnswerType.REFUSAL);
      
      return CREResult.success(response, decision, dialogState);
    }
    
    // DEFER → Return defer message
    if (decision.action === PermittedAction.DEFER) {
      const response = TEMPLATES.DEFER.need_search;
      
      dialogState.recordTurn(PermittedAction.DEFER, decision.reason);
      
      return CREResult.success(response, decision, dialogState);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 3: LLM CALL (for ANSWER and CONFIRM)
    // ═══════════════════════════════════════════════════════════════════════
    
    if (!llmCall) {
      // No LLM available - return placeholder
      const placeholder = `[LLM CALL REQUIRED]\nAction: ${decision.action}\nAnswer Type: ${decision.constraints.answerType}`;
      return CREResult.success(placeholder, decision, dialogState);
    }
    
    const systemPrompt = buildPrompt(decision, dialogState);
    const llmResponse = await llmCall(message, systemPrompt);
    
    if (!llmResponse || !llmResponse.success) {
      return CREResult.failure(llmResponse?.error || 'LLM call failed');
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 4: ENFORCEMENT
    // ═══════════════════════════════════════════════════════════════════════
    
    const { text: enforced, changes } = enforceConstraints(
      llmResponse.text,
      decision,
      dialogState
    );
    
    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 5: REPEAT PREVENTION
    // ═══════════════════════════════════════════════════════════════════════
    
    if (isRepeat(enforced, dialogState)) {
      logger.warn('CRE', 'Repeat detected, adding variation');
      // Could add variation or flag
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 6: UPDATE STATE
    // ═══════════════════════════════════════════════════════════════════════
    
    dialogState.recordTurn(
      decision.action,
      decision.reason,
      decision.constraints.answerType
    );
    dialogState.setResponseHash(computeResponseHash(enforced));
    
    // Clear correction after handling
    if (dialogState.hasPendingCorrection()) {
      dialogState.clearCorrection();
    }
    
    // Build result
    const result = CREResult.success(enforced, decision, dialogState);
    result.enforcement = { changes, corrected: changes.length > 0 };
    result.metadata = {
      latencyMs: Date.now() - startTime,
      answerType: decision.constraints.answerType,
      volatility: dialogState.epistemic.volatility
    };
    
    return result;
    
  } catch (error) {
    logger.error('CRE', 'Processing error', error);
    return CREResult.failure(error.message);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export {
  DialogState,
  Decision,
  DialogIntent,
  PermittedAction,
  AnswerType,
  CorrectionType,
  Volatility,
  Certainty,
  Domain
};

export default {
  processMessage,
  CREResult,
  buildPrompt,
  enforceConstraints
};
