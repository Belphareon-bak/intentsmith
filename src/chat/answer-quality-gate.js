// CRE v36.6 Answer Quality Gate
// ══════════════════════════════════════════════════════════════════════════════
// 
// Post-generation validation - kontrola kvality odpovědi PŘED odesláním
// 
// v36.6 CRITICAL:
// - FORBIDDEN_META_CLAIMS: Hard blacklist of "jako AI" disclaimers
// - Auto-sanitization of capability lies
// - System NEVER asks for current date (it knows it)
// 
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { Certainty, Volatility, SpeechAct, SystemAction } from './dialog-state-v2.js';

// ════════════════════════════════════════════════════════════════════════════
// FORBIDDEN META-CLAIMS (v36.6 - FIX 2)
// ════════════════════════════════════════════════════════════════════════════
// These patterns MUST NEVER appear in output. They are LIES about system capabilities.
// If LLM outputs these, it's a HARD FAILURE that must be blocked or rewritten.

export const FORBIDDEN_META_CLAIMS = [
  // ─── Identity lies ───
  /jako\s+(ai|umělá\s*inteligence|jazykový\s*model)/i,
  /jsem\s+(pouze|jen)?\s*(ai|bot|model|asistent)/i,
  /jakožto\s+(ai|model|asistent)/i,
  
  // ─── Capability lies (system CAN do these) ───
  /nemohu\s+(prohledávat|vyhledávat|procházet)\s*(internet|web)/i,
  /nemám\s+přístup\s+k\s+(aktuálním|živým|real-?time)?\s*(datům|informacím|internetu)/i,
  /nemohu\s+v\s+reálném\s+čase/i,
  /nejsem\s+schopen\s*(vyhledat|prohledat|najít|pomoci)/i,
  /nemám\s+možnost\s+(vyhledat|prohledat)/i,
  /nemůžu\s+(prohledávat|vyhledávat|najít)/i,
  /nedokážu\s+(vyhledat|prohledat|najít)/i,
  
  // ─── Knowledge lies (system HAS this) ───
  /nevím,?\s*(jaké?|kdy)?\s*(je)?\s*(dnes|aktuální)?\s*(datum|den|čas)?/i,
  /potřeboval?\s+bych\s+(znát|vědět)\s+aktuální\s+(datum|čas|den)/i,
  /neznám\s+aktuální\s+(datum|čas|den)/i,
  /nemám\s+informace?\s+o\s+(aktuálním|dnešním)/i,
  /nevím,?\s+kdy\s+je\s+dnes/i,
  
  // ─── Generic disclaimers ───
  /omlouvám\s+se,?\s+(ale\s+)?jako\s+(ai|model)/i,
  /bohužel\s+(jako\s+)?(ai|model)/i,
  /moje\s+znalosti\s+(jsou|byly)\s+(omezeny|limitovány)/i,
  /můj\s+(knowledge\s+)?cutoff/i,
  /moje\s+data\s+(končí|skončila)/i
];

/**
 * Detect forbidden meta-claims in text
 * @returns {{ hasForbidden: boolean, matches: string[] }}
 */
export function detectForbiddenMetaClaims(text) {
  if (!text) return { hasForbidden: false, matches: [] };
  
  const matches = [];
  for (const pattern of FORBIDDEN_META_CLAIMS) {
    const match = text.match(pattern);
    if (match) {
      matches.push(match[0]);
    }
  }
  
  return {
    hasForbidden: matches.length > 0,
    matches
  };
}

/**
 * Sanitize text by removing/replacing forbidden meta-claims
 * @returns {{ text: string, sanitized: boolean, removed: string[] }}
 */
export function sanitizeForbiddenMetaClaims(text) {
  if (!text) return { text: '', sanitized: false, removed: [] };
  
  let result = text;
  const removed = [];
  
  // ═══════════════════════════════════════════════════════════════════════
  // STEP 1: PHRASE REPLACEMENTS (preserve sentence structure)
  // ═══════════════════════════════════════════════════════════════════════
  const phraseReplacements = [
    // Capability phrases → system perspective
    [/nemohu\s+(prohledávat|vyhledávat)\s+(internet|web)/gi, 'vyhledávání vyžaduje specifikaci zdroje'],
    [/nemám\s+přístup\s+k\s+(aktuálním\s+)?datům/gi, 'data momentálně nejsou k dispozici'],
    [/nemám\s+přístup\s+k\s+internetu/gi, 'připojení k externím zdrojům není aktivní'],
    [/nejsem\s+schopen\s+(vyhledat|najít|pomoci)/gi, 'toto vyžaduje dodatečné informace'],
    [/nemohu\s+v\s+reálném\s+čase\s+(vyhledávat|hledat)/gi, 'mohu vyhledat, pokud upřesníš zdroj'],
    
    // Identity phrases → remove entirely
    [/jako\s+(ai|umělá\s*inteligence|jazykový\s*model)\s*(asistent\s*)?/gi, ''],
    [/jsem\s+(pouze|jen)?\s*(ai|bot|model)\s*(a\s+)?/gi, ''],
    [/jakožto\s+(ai|model|asistent)\s*/gi, ''],
    
    // Date requests → remove (system knows the date)
    [/potřeboval?\s+bych\s+(znát|vědět)\s+aktuální\s+(datum|čas)[^,.]*/gi, ''],
    [/nevím,?\s+kdy\s+je\s+dnes[^,.]*/gi, ''],
    [/neznám\s+aktuální\s+(datum|čas)[^,.]*/gi, ''],
    
    // Apologetic disclaimers → remove
    [/omlouvám\s+se,?\s+(ale\s+)?/gi, ''],
    [/bohužel\s+(jako\s+)?(ai|model)?\s*/gi, '']
  ];
  
  for (const [pattern, replacement] of phraseReplacements) {
    const matches = result.match(pattern);
    if (matches) {
      removed.push(...matches);
      result = result.replace(pattern, replacement);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // STEP 2: FULL SENTENCE REMOVALS (only for entirely bad sentences)
  // ═══════════════════════════════════════════════════════════════════════
  // Only remove if the sentence is ENTIRELY about AI limitations
  const sentenceRemovals = [
    /[^.!?]*moje\s+znalosti\s+(jsou|byly)\s+(omezeny|limitovány)[^.!?]*[.!?]\s*/gi,
    /[^.!?]*můj\s+(knowledge\s+)?cutoff[^.!?]*[.!?]\s*/gi,
    /[^.!?]*moje\s+data\s+(končí|skončila)[^.!?]*[.!?]\s*/gi
  ];
  
  for (const pattern of sentenceRemovals) {
    const matches = result.match(pattern);
    if (matches) {
      removed.push(...matches);
      result = result.replace(pattern, '');
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // STEP 3: CLEANUP
  // ═══════════════════════════════════════════════════════════════════════
  result = result
    // Fix double commas from phrase removal
    .replace(/,\s*,/g, ',')
    // Fix orphaned conjunctions
    .replace(/^\s*,\s*/g, '')
    .replace(/,\s*\./g, '.')
    .replace(/\s+ale\s+\./g, '.')
    .replace(/\s+a\s+\./g, '.')
    // Fix whitespace
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .replace(/^\s+|\s+$/g, '')
    .replace(/\s+([.!?,])/g, '$1')
    // Fix sentence starts
    .replace(/^\s*,\s*/gm, '')
    .replace(/^\s*ale\s+/gim, '')
    .replace(/\.\s*\./g, '.');
  
  // Capitalize first letter
  if (result.length > 0) {
    result = result.charAt(0).toUpperCase() + result.slice(1);
  }
  
  return {
    text: result,
    sanitized: removed.length > 0,
    removed
  };
}

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
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // V7: META_IDENTITY_LEAK (v36.6) - LLM claims it "cannot" do things
  // ─────────────────────────────────────────────────────────────────────────
  // This is the MOST IMPORTANT rule for user trust.
  // LLM must NEVER:
  //   - claim to be "AI assistant"
  //   - claim it "cannot search the internet"
  //   - claim it "doesn't have access to data"
  //   - ask for current date (system knows it)
  // ─────────────────────────────────────────────────────────────────────────
  {
    code: 'META_IDENTITY_LEAK',
    test: (text, state, decision) => {
      // FORBIDDEN PATTERNS - hard blacklist
      const FORBIDDEN_META_CLAIMS = [
        /jako\s+ai/i,
        /jako\s+jazykový\s+model/i,
        /jako\s+umělá\s+inteligence/i,
        /jsem\s+ai/i,
        /jsem\s+jazykový\s+model/i,
        /nemohu\s+prohledávat\s+internet/i,
        /nemohu\s+v\s+reálném\s+čase/i,
        /nemám\s+přístup\s+k\s+(?:aktuálním\s+)?dat/i,
        /nemám\s+přístup\s+k\s+internetu/i,
        /nejsem\s+schopen/i,
        /nejsem\s+schopn[áý]/i,
        /potřeboval\s+bych\s+(?:znát\s+)?aktuální\s+datum/i,
        /nevím[,]?\s+kdy\s+je\s+dnes/i,
        /nemám\s+informace\s+o\s+aktuálním/i,
        /můj\s+(?:knowledge\s+)?cutoff/i,
        /moje\s+znalosti\s+(?:jsou\s+)?(?:omezeny|limitovány)/i,
        /jako\s+(?:textový\s+)?(?:ai\s+)?asistent/i
      ];
      
      return FORBIDDEN_META_CLAIMS.some(p => p.test(text));
    },
    message: 'Response contains forbidden AI/model meta-identity claims',
    fix: (text) => {
      // Rewrite to system-perspective language
      let fixed = text
        // Remove AI identity claims entirely
        .replace(/jako\s+ai\s+(?:asistent\s+)?/gi, '')
        .replace(/jako\s+jazykový\s+model\s+/gi, '')
        .replace(/jako\s+umělá\s+inteligence\s+/gi, '')
        .replace(/jsem\s+ai\s+(?:asistent\s+)?(?:a\s+)?/gi, '')
        .replace(/jako\s+(?:textový\s+)?(?:ai\s+)?asistent[,]?\s+/gi, '')
        // Rewrite capability denials to system-perspective
        .replace(/nemohu\s+prohledávat\s+internet/gi, 'vyhledávání vyžaduje specifikaci zdroje')
        .replace(/nemohu\s+v\s+reálném\s+čase\s+(?:vyhledávat|hledat)/gi, 'mohu vyhledat, ale potřebuji zdroj')
        .replace(/nemám\s+přístup\s+k\s+(?:aktuálním\s+)?datům/gi, 'data nejsou momentálně k dispozici')
        .replace(/nemám\s+přístup\s+k\s+internetu/gi, 'připojení k externím zdrojům není aktivní')
        .replace(/nejsem\s+schopen(?:a)?/gi, 'toto nelze provést')
        // Remove date queries (system knows the date)
        .replace(/potřeboval\s+bych\s+(?:znát\s+)?aktuální\s+datum[^.]*\./gi, '')
        .replace(/nevím[,]?\s+kdy\s+je\s+dnes[^.]*\./gi, '')
        // Clean up resulting text
        .replace(/\s+/g, ' ')
        .replace(/^\s+|\s+$/g, '')
        .replace(/\.\s*\./g, '.');
      
      return fixed;
    }
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // V8: CAPABILITY_DENIAL (v36.6) - denying enabled capabilities
  // ─────────────────────────────────────────────────────────────────────────
  {
    code: 'CAPABILITY_DENIAL',
    test: (text, state, decision) => {
      // Generic "I cannot" patterns that deny system capabilities
      const CAPABILITY_DENIAL_PATTERNS = [
        /nemohu\s+(?:vám\s+)?(?:pomoci\s+)?(?:s\s+)?(?:vyhledáním|hledáním)/i,
        /nemohu\s+(?:vám\s+)?(?:najít|vyhledat)/i,
        /nedokážu\s+(?:vám\s+)?(?:vyhledat|najít)/i,
        /nemůžu\s+(?:vám\s+)?(?:vyhledat|najít|pomoci)/i,
        /není\s+v\s+mých\s+možnostech/i,
        /to\s+(?:bohužel\s+)?není\s+možné/i,
        /tuto\s+službu\s+neposkytuj/i
      ];
      
      return CAPABILITY_DENIAL_PATTERNS.some(p => p.test(text));
    },
    message: 'Response denies enabled system capabilities',
    fix: (text) => {
      // These should not be auto-fixed - trigger fallback instead
      return null;
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
 * v36.6: Now sanitizes forbidden meta-claims FIRST before other validation
 * 
 * @param {string} text - Generated response text
 * @param {DialogState} state - Current dialog state
 * @param {Decision} decision - Decision that led to this response
 * @returns {{ text: string, fallback: boolean }}
 */
export function applyQualityGate(text, state, decision) {
  // ═══════════════════════════════════════════════════════════════════════
  // STEP 1: SANITIZE FORBIDDEN META-CLAIMS (v36.6 - FIX 2)
  // ═══════════════════════════════════════════════════════════════════════
  // This MUST happen first, before any other validation
  // LLM must NEVER claim it "cannot" do things the system CAN do
  
  const sanitization = sanitizeForbiddenMetaClaims(text);
  let processedText = sanitization.text;
  
  if (sanitization.sanitized) {
    logger.warn('QualityGate', 'Sanitized forbidden meta-claims', {
      removed: sanitization.removed
    });
  }
  
  // If sanitization resulted in empty text, use fallback
  if (!processedText || processedText.trim().length === 0) {
    logger.error('QualityGate', 'Response was entirely forbidden meta-claims');
    return {
      text: '❓ Můžeš mi upřesnit, co potřebuješ?',
      fallback: true,
      violations: [{ code: 'EMPTY_AFTER_SANITIZATION', message: 'Response was entirely meta-claims' }]
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // STEP 2: STANDARD VALIDATION
  // ═══════════════════════════════════════════════════════════════════════
  
  const result = validateAnswer(processedText, state, decision);
  
  if (!result.passed) {
    // Return fallback response
    return {
      text: '⚠️ Nemohu poskytnout spolehlivou odpověď na tuto otázku.',
      fallback: true,
      violations: result.violations
    };
  }
  
  return {
    text: result.correctedText || processedText,
    fallback: false,
    warnings: result.warnings,
    sanitized: sanitization.sanitized
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
