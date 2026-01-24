// C.3 v35.5 Answer Quality Gate
// ══════════════════════════════════════════════════════════════════════════════
// 
// Post-generation validation - kontrola kvality odpovědi PŘED odesláním
// 
// Řeší: "kdy odpovědět" vs "jestli je odpověď dobrá"
// 
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { Certainty, Volatility, SpeechAct, SystemAction } from './dialog-state-v2.js';

// ════════════════════════════════════════════════════════════════════════════
// QUALITY GATE RESULT
// ════════════════════════════════════════════════════════════════════════════

export class QualityGateResult {
  constructor() {
    this.passed = true;
    this.violations = [];
    this.warnings = [];
    this.correctedText = null;
    this.fallbackAction = null;
  }
  
  addViolation(code, message) {
    this.passed = false;
    this.violations.push({ code, message });
  }
  
  addWarning(code, message) {
    this.warnings.push({ code, message });
  }
  
  setCorrectedText(text) {
    this.correctedText = text;
  }
  
  setFallback(action) {
    this.fallbackAction = action;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// VALIDATION RULES
// ════════════════════════════════════════════════════════════════════════════

const VALIDATION_RULES = [
  // ─────────────────────────────────────────────────────────────────────────
  // V1: CERTAINTY VIOLATION - odpověď je příliš jistá
  // ─────────────────────────────────────────────────────────────────────────
  {
    code: 'CERTAINTY_VIOLATION',
    test: (text, state, decision) => {
      if (state.epistemic.certainty === Certainty.LOW) {
        // Check for overly confident language
        const confidentPatterns = [
          /\bje\s+(?:přesně|jasně|určitě)\b/i,
          /\bbez\s+pochyby\b/i,
          /\bjistě\b/i,
          /\bzaručeně\b/i,
          /\b100\s*%\b/i
        ];
        return confidentPatterns.some(p => p.test(text));
      }
      return false;
    },
    message: 'Response too confident for LOW certainty context',
    fix: (text) => {
      return text
        .replace(/je přesně/gi, 'je přibližně')
        .replace(/bez pochyby/gi, 'pravděpodobně')
        .replace(/jistě/gi, 'pravděpodobně')
        .replace(/zaručeně/gi, 'zřejmě');
    }
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // V2: NEW FACTS IN CONFIRM - odpověď přidává nové informace v CONFIRM režimu
  // ─────────────────────────────────────────────────────────────────────────
  {
    code: 'NEW_FACTS_IN_CONFIRM',
    test: (text, state, decision) => {
      if (decision.action === SystemAction.CONFIRM_CONTEXT) {
        // CONFIRM should be short - max 2 sentences
        const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
        if (sentences.length > 3) return true;
        
        // Should not contain new factual claims
        const newFactPatterns = [
          /navíc\b/i,
          /kromě toho\b/i,
          /je třeba dodat\b/i,
          /měl bys vědět\b/i,
          /důležité je\b/i
        ];
        return newFactPatterns.some(p => p.test(text));
      }
      return false;
    },
    message: 'CONFIRM response introduces new facts',
    fix: (text) => {
      // Truncate to first 2 sentences
      const sentences = text.split(/(?<=[.!?])\s+/);
      return sentences.slice(0, 2).join(' ');
    }
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // V3: CONTRADICTS LOCKED FACTS
  // ─────────────────────────────────────────────────────────────────────────
  {
    code: 'CONTRADICTS_LOCKED_FACTS',
    test: (text, state, decision) => {
      const lockedYear = state.getSlotValue('year');
      const lockedMonth = state.getSlotValue('month');
      
      // Check if response mentions different year
      if (lockedYear) {
        const yearMatch = text.match(/\b(20\d{2})\b/);
        if (yearMatch && parseInt(yearMatch[1]) !== lockedYear) {
          return true;
        }
      }
      
      // Could add more locked fact checks here
      return false;
    },
    message: 'Response contradicts locked facts',
    fix: null  // Cannot auto-fix, requires fallback
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // V4: NUMBERS IN FORBIDDEN CONTEXT
  // ─────────────────────────────────────────────────────────────────────────
  {
    code: 'FORBIDDEN_NUMBERS',
    test: (text, state, decision) => {
      if (state.enforcement.forbidNumbers) {
        // Check for specific numerical claims
        const numberPatterns = [
          /\d+\s*(kč|czk|eur|\$|usd)/i,
          /\d+\s*°[cCfF]/i,
          /\d+\s*(km\/h|mph)/i,
          /\d+\s*(kg|g|lb)/i
        ];
        
        // Allow if preceded by "přibližně", "kolem", "zhruba"
        const hasHedge = /(?:přibližně|kolem|zhruba|cca|asi)\s*\d+/i.test(text);
        if (hasHedge) return false;
        
        return numberPatterns.some(p => p.test(text));
      }
      return false;
    },
    message: 'Response contains forbidden numbers without hedge',
    fix: (text) => {
      // Add hedge before numbers
      return text.replace(
        /(\d+\s*(?:kč|czk|eur|\$|usd|°[cCfF]|km\/h|mph|kg|g|lb))/gi,
        'přibližně $1'
      );
    }
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // V5: TONE MISMATCH
  // ─────────────────────────────────────────────────────────────────────────
  {
    code: 'TONE_MISMATCH',
    test: (text, state, decision) => {
      // CORRECTION should not be defensive
      if (decision.action === SystemAction.CORRECT_PREVIOUS) {
        const defensivePatterns = [
          /ale já/i,
          /měl jsem pravdu/i,
          /trvám na/i,
          /nesouhlasím/i,
          /jak jsem říkal/i
        ];
        return defensivePatterns.some(p => p.test(text));
      }
      
      // REFUSAL should not be apologetic
      if (decision.speechAct === SpeechAct.REFUSAL) {
        const apologeticPatterns = [
          /je mi líto/i,
          /omlouvám se/i,
          /bohužel/i
        ];
        // Refusal can have one apology, not multiple
        let apologyCount = 0;
        for (const p of apologeticPatterns) {
          if (p.test(text)) apologyCount++;
        }
        return apologyCount > 1;
      }
      
      return false;
    },
    message: 'Response tone does not match action type',
    fix: (text) => {
      return text
        .replace(/ale já/gi, '')
        .replace(/měl jsem pravdu/gi, '')
        .replace(/trvám na/gi, '')
        .replace(/jak jsem říkal/gi, '');
    }
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // V6: MISSING REQUIRED DISCLAIMER
  // ─────────────────────────────────────────────────────────────────────────
  {
    code: 'MISSING_DISCLAIMER',
    test: (text, state, decision) => {
      if (state.enforcement.requireDisclaimer) {
        const hasDisclaimer = /⚠️|upozornění|orientační|odhad|přibližn/i.test(text);
        return !hasDisclaimer;
      }
      return false;
    },
    message: 'Required disclaimer missing',
    fix: (text) => {
      return '⚠️ **Upozornění:** Následující informace jsou pouze orientační.\n\n' + text;
    }
  }
];

// ════════════════════════════════════════════════════════════════════════════
// QUALITY GATE FUNCTION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Validate generated answer against quality rules
 * 
 * @param {string} text - Generated response text
 * @param {DialogState} state - Current dialog state
 * @param {Decision} decision - Decision that led to this response
 * @returns {QualityGateResult}
 */
export function validateAnswer(text, state, decision) {
  const result = new QualityGateResult();
  
  if (!text || text.trim().length === 0) {
    result.addViolation('EMPTY_RESPONSE', 'Response is empty');
    result.setFallback(SystemAction.REFUSE);
    return result;
  }
  
  let correctedText = text;
  
  for (const rule of VALIDATION_RULES) {
    if (rule.test(text, state, decision)) {
      if (rule.fix) {
        // Rule has auto-fix
        correctedText = rule.fix(correctedText);
        result.addWarning(rule.code, rule.message);
      } else {
        // No auto-fix available - this is a violation
        result.addViolation(rule.code, rule.message);
      }
    }
  }
  
  // If violations without fix, set fallback
  if (!result.passed) {
    result.setFallback(SystemAction.REFUSE);
    logger.warn('QualityGate', `Validation failed: ${result.violations.map(v => v.code).join(', ')}`);
  } else if (correctedText !== text) {
    result.setCorrectedText(correctedText);
    logger.info('QualityGate', `Auto-corrected: ${result.warnings.map(w => w.code).join(', ')}`);
  }
  
  return result;
}

/**
 * Apply quality gate and get final response
 * 
 * @param {string} text - Generated response text
 * @param {DialogState} state - Current dialog state
 * @param {Decision} decision - Decision that led to this response
 * @returns {{ text: string, fallback: boolean }}
 */
export function applyQualityGate(text, state, decision) {
  const result = validateAnswer(text, state, decision);
  
  if (!result.passed) {
    // Return fallback response
    return {
      text: '⚠️ Nemohu poskytnout spolehlivou odpověď na tuto otázku.',
      fallback: true,
      violations: result.violations
    };
  }
  
  return {
    text: result.correctedText || text,
    fallback: false,
    warnings: result.warnings
  };
}

// ════════════════════════════════════════════════════════════════════════════
// ITERATIVE REPAIR (max attempts s penalizací)
// ════════════════════════════════════════════════════════════════════════════

const MAX_REPAIR_ATTEMPTS = 2;

/**
 * Get repair hints for a violation
 * Returns instructions for regeneration
 */
export function getRepairHints(violation) {
  const hints = {
    'CERTAINTY_VIOLATION': {
      instruction: 'Přeformuluj odpověď s menší jistotou. Použij "pravděpodobně", "přibližně", "podle dostupných informací".',
      constraint: 'NO_CONFIDENT_LANGUAGE'
    },
    'NEW_FACTS_IN_CONFIRM': {
      instruction: 'Zkrať odpověď pouze na potvrzení nebo zamítnutí. Nepřidávej nové informace.',
      constraint: 'MAX_2_SENTENCES'
    },
    'CONTRADICTS_LOCKED_FACTS': {
      instruction: 'Odpověď obsahuje rozpor s dříve potvrzeným faktem. Oprav rozpor.',
      constraint: 'RESPECT_LOCKED_FACTS'
    },
    'FORBIDDEN_NUMBERS': {
      instruction: 'Odstraň konkrétní čísla nebo je opatři hedgem ("přibližně", "kolem").',
      constraint: 'NO_SPECIFIC_NUMBERS'
    },
    'TONE_MISMATCH': {
      instruction: 'Uprav tón odpovědi. Vyhni se defenzivnímu nebo agresivnímu tónu.',
      constraint: 'NEUTRAL_TONE'
    },
    'MISSING_DISCLAIMER': {
      instruction: 'Přidej upozornění na začátek odpovědi.',
      constraint: 'REQUIRE_DISCLAIMER'
    },
    'EMPTY_RESPONSE': {
      instruction: 'Vygeneruj smysluplnou odpověď.',
      constraint: 'NON_EMPTY'
    }
  };
  
  return hints[violation.code] || {
    instruction: `Oprav problém: ${violation.message}`,
    constraint: 'GENERAL_FIX'
  };
}

/**
 * Apply quality gate with iterative repair
 * Attempts to fix violations before falling back
 * 
 * @param {string} text - Initial response
 * @param {DialogState} state - Current dialog state  
 * @param {Decision} decision - Decision context
 * @param {Function} regenerateFn - Optional async function to regenerate response
 * @returns {Promise<{ text, fallback, repairCount, confidencePenalty }>}
 */
export async function applyQualityGateWithRepair(text, state, decision, regenerateFn = null) {
  let currentText = text;
  let repairCount = 0;
  let allWarnings = [];
  
  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    const result = validateAnswer(currentText, state, decision);
    allWarnings = [...allWarnings, ...result.warnings];
    
    if (result.passed) {
      // Success - return with any accumulated penalty
      const confidencePenalty = repairCount * 0.1;  // Each repair costs confidence
      return {
        text: result.correctedText || currentText,
        fallback: false,
        repairCount,
        confidencePenalty,
        warnings: allWarnings
      };
    }
    
    // Auto-correction available?
    if (result.correctedText) {
      currentText = result.correctedText;
      repairCount++;
      continue;
    }
    
    // Can we regenerate?
    if (regenerateFn && attempt < MAX_REPAIR_ATTEMPTS) {
      const hints = result.violations.map(v => getRepairHints(v));
      try {
        currentText = await regenerateFn({
          previousText: currentText,
          repairHints: hints,
          attempt: attempt + 1
        });
        repairCount++;
        continue;
      } catch (error) {
        logger.warn('QualityGate', `Repair attempt ${attempt + 1} failed`, error);
      }
    }
    
    // Cannot fix - fallback
    return {
      text: '⚠️ Nemohu poskytnout spolehlivou odpověď na tuto otázku.',
      fallback: true,
      repairCount,
      confidencePenalty: 0.3,  // Fallback = significant penalty
      violations: result.violations,
      warnings: allWarnings
    };
  }
  
  // Should not reach here, but safety fallback
  return {
    text: '⚠️ Nemohu poskytnout spolehlivou odpověď na tuto otázku.',
    fallback: true,
    repairCount,
    confidencePenalty: 0.3,
    violations: []
  };
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export default {
  validateAnswer,
  applyQualityGate,
  applyQualityGateWithRepair,
  getRepairHints,
  QualityGateResult,
  VALIDATION_RULES,
  MAX_REPAIR_ATTEMPTS
};
