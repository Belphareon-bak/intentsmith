// C.3 v35.8 Atomic Claim Model
// ══════════════════════════════════════════════════════════════════════════════
// 
// Rozpad odpovědi na atomická tvrzení s vlastní epistemikou
// 
// Problém v35.7: claim = odstavec/sekce, ne atomické tvrzení
// Řešení: každé tvrzení má vlastní:
//   - modality (FACT/PROBABLE/POSSIBLE)
//   - sourceStatus (VERIFIED/UNVERIFIED/NONE)
//   - temporalScope
//   - verifiability
// 
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { Verifiability, TemporalScope, Certainty } from './dialog-state-v2.js';

// ════════════════════════════════════════════════════════════════════════════
// CLAIM MODALITY (míra jistoty tvrzení)
// ════════════════════════════════════════════════════════════════════════════

export const ClaimModality = {
  FACT: 'FACT',           // "Je" - definitivní tvrzení
  PROBABLE: 'PROBABLE',   // "Pravděpodobně", "Měl by" - vysoká pravděpodobnost
  POSSIBLE: 'POSSIBLE',   // "Může", "Možná" - nízká jistota
  CONDITIONAL: 'CONDITIONAL', // "Pokud X, pak Y"
  OPINION: 'OPINION'      // "Myslím", "Domnívám se"
};

// ════════════════════════════════════════════════════════════════════════════
// SOURCE STATUS (původ tvrzení)
// ════════════════════════════════════════════════════════════════════════════

export const SourceStatus = {
  VERIFIED: 'VERIFIED',       // Ověřeno externím zdrojem
  USER_CONFIRMED: 'USER_CONFIRMED', // Potvrzeno uživatelem
  TRAINING: 'TRAINING',       // Z tréninkových dat
  INFERRED: 'INFERRED',       // Odvozeno z kontextu
  NONE: 'NONE'                // Bez zdroje
};

// ════════════════════════════════════════════════════════════════════════════
// ATOMIC CLAIM
// ════════════════════════════════════════════════════════════════════════════

export class Claim {
  constructor(text, options = {}) {
    // Core content
    this.text = text;
    this.subject = options.subject || null;     // O čem se mluví
    this.predicate = options.predicate || null; // Co se tvrdí
    
    // Epistemic metadata (per-claim, ne globální!)
    this.modality = options.modality || ClaimModality.FACT;
    this.sourceStatus = options.sourceStatus || SourceStatus.TRAINING;
    this.verifiability = options.verifiability || Verifiability.WEB;
    this.temporalScope = options.temporalScope || TemporalScope.STATIC;
    this.confidence = options.confidence || 0.5;
    
    // Enforcement requirements (per-claim!)
    this.requiresDisclaimer = options.requiresDisclaimer || false;
    this.requiresHedge = options.requiresHedge || false;
    this.forbiddenInContext = options.forbiddenInContext || false;
    
    // Tracking
    this.id = options.id || `claim_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.position = options.position || 0;  // Pozice v odpovědi
  }
  
  /**
   * Determine enforcement level for this claim
   */
  getEnforcementLevel() {
    // HIGH risk claims
    if (this.temporalScope === TemporalScope.REALTIME ||
        this.verifiability === Verifiability.NONE ||
        this.sourceStatus === SourceStatus.NONE) {
      return 'HIGH';
    }
    
    // MEDIUM risk claims
    if (this.modality === ClaimModality.PROBABLE ||
        this.sourceStatus === SourceStatus.INFERRED) {
      return 'MEDIUM';
    }
    
    // LOW risk claims
    if (this.modality === ClaimModality.FACT &&
        (this.sourceStatus === SourceStatus.VERIFIED || 
         this.sourceStatus === SourceStatus.USER_CONFIRMED) &&
        this.verifiability === Verifiability.CONSENSUS) {
      return 'LOW';
    }
    
    return 'MEDIUM';
  }
  
  /**
   * Check if this claim needs a hedge phrase
   */
  needsHedge() {
    return this.modality === ClaimModality.PROBABLE ||
           this.modality === ClaimModality.POSSIBLE ||
           this.sourceStatus === SourceStatus.INFERRED ||
           this.confidence < 0.7;
  }
  
  /**
   * Check if this claim needs a disclaimer
   */
  needsDisclaimer() {
    return this.temporalScope === TemporalScope.REALTIME ||
           this.verifiability === Verifiability.NONE ||
           (this.modality === ClaimModality.FACT && this.confidence < 0.5);
  }
  
  /**
   * Apply hedge to claim text
   */
  applyHedge() {
    if (!this.needsHedge()) return this.text;
    
    const hedges = {
      [ClaimModality.PROBABLE]: 'Pravděpodobně ',
      [ClaimModality.POSSIBLE]: 'Možná ',
      [ClaimModality.CONDITIONAL]: '',
      [ClaimModality.OPINION]: 'Podle mého názoru '
    };
    
    const prefix = hedges[this.modality] || 'Přibližně ';
    
    // Don't double-hedge
    if (this.text.match(/^(Pravděpodobně|Možná|Přibližně|Asi|Zhruba)/i)) {
      return this.text;
    }
    
    return prefix + this.text.charAt(0).toLowerCase() + this.text.slice(1);
  }
  
  toJSON() {
    return {
      id: this.id,
      text: this.text,
      subject: this.subject,
      predicate: this.predicate,
      modality: this.modality,
      sourceStatus: this.sourceStatus,
      verifiability: this.verifiability,
      temporalScope: this.temporalScope,
      confidence: this.confidence,
      enforcementLevel: this.getEnforcementLevel(),
      position: this.position
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CLAIM EXTRACTOR (heuristiky, ne plný NLP)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Extract atomic claims from text using heuristics
 * Not full NLP - pattern-based splitting
 */
export function extractClaims(text, context = {}) {
  const claims = [];
  
  // Split by sentences (basic heuristic)
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .filter(s => s.trim().length > 0);
  
  let globalPosition = 0;
  
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i].trim();
    
    // Try to split into atomic claims
    const atomicClaims = splitIntoAtomicClaims(sentence);
    
    for (const atomicText of atomicClaims) {
      // Detect modality from language patterns
      const modality = detectModality(atomicText);
      
      // Detect temporal scope
      const temporalScope = detectTemporalScope(atomicText, context);
      
      // Detect verifiability
      const verifiability = detectVerifiability(atomicText, context);
      
      // Extract subject if possible
      const subject = extractSubject(atomicText);
      
      // Create claim
      const claim = new Claim(atomicText, {
        modality,
        temporalScope,
        verifiability,
        sourceStatus: context.source ? SourceStatus.VERIFIED : SourceStatus.TRAINING,
        confidence: modalityToConfidence(modality),
        position: globalPosition++,
        subject
      });
      
      claims.push(claim);
    }
  }
  
  return claims;
}

/**
 * Split sentence into atomic claims using heuristics
 * Handles: "X a Y", "X nebo Y", comma lists, "X, Y a Z"
 */
function splitIntoAtomicClaims(sentence) {
  // Don't split very short sentences
  if (sentence.length < 30) {
    return [sentence];
  }
  
  // Don't split conditional sentences
  if (/^(Pokud|Jestliže|Kdyby|V případě|Když)/i.test(sentence)) {
    return [sentence];
  }
  
  // Pattern: "X a Y mají/jsou/..." - split subjects
  const andPattern = /^(.+?)\s+a\s+(.+?)\s+(mají|jsou|mohou|můžou|mívají|bývají|umí)/i;
  const andMatch = sentence.match(andPattern);
  if (andMatch) {
    const subject1 = andMatch[1];
    const subject2 = andMatch[2];
    const predicate = andMatch[3] + sentence.slice(andMatch[0].length);
    
    return [
      `${subject1} ${predicate}`,
      `${subject2} ${predicate}`
    ];
  }
  
  // Pattern: "X, Y a Z mají/jsou/..." - split enumeration
  const enumPattern = /^(.+?),\s+(.+?)\s+a\s+(.+?)\s+(mají|jsou|mohou|můžou|mívají|bývají)/i;
  const enumMatch = sentence.match(enumPattern);
  if (enumMatch) {
    const subjects = [enumMatch[1], enumMatch[2], enumMatch[3]];
    const predicate = enumMatch[4] + sentence.slice(enumMatch[0].length);
    
    return subjects.map(s => `${s.trim()} ${predicate}`);
  }
  
  // Pattern: coordinate clauses with "a" in the middle
  // "X dělá něco a Y dělá jiného"
  if (sentence.includes(' a ') && !sentence.includes(',')) {
    const parts = sentence.split(/\s+a\s+/i);
    if (parts.length === 2 && parts[0].length > 15 && parts[1].length > 15) {
      // Both parts are substantial - likely independent claims
      return parts.map(p => p.trim());
    }
  }
  
  // Pattern: "X nebo Y" - split alternatives
  const orPattern = /^(.+?)\s+nebo\s+(.+?)\s+(může|mohou|jsou|mají)/i;
  const orMatch = sentence.match(orPattern);
  if (orMatch) {
    const subject1 = orMatch[1];
    const subject2 = orMatch[2];
    const predicate = orMatch[3] + sentence.slice(orMatch[0].length);
    
    return [
      `${subject1} ${predicate}`,
      `${subject2} ${predicate}`
    ];
  }
  
  // Default: don't split
  return [sentence];
}

/**
 * Extract subject from claim text (simple heuristic)
 */
function extractSubject(text) {
  // Pattern: starts with noun (capitalized or after article)
  const subjectMatch = text.match(/^([A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž]+(?:\s+[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž]+)?)/);
  if (subjectMatch) {
    return subjectMatch[1];
  }
  
  // Pattern: starts with lowercase - likely a pronoun or common noun
  const commonMatch = text.match(/^([a-záčďéěíňóřšťúůýž]+(?:\s+[a-záčďéěíňóřšťúůýž]+)?)/);
  if (commonMatch) {
    return commonMatch[1];
  }
  
  return null;
}

/**
 * Detect claim modality from language patterns
 */
function detectModality(text) {
  // CONDITIONAL patterns
  if (/^(Pokud|Jestliže|Kdyby|V případě)/i.test(text)) {
    return ClaimModality.CONDITIONAL;
  }
  
  // OPINION patterns
  if (/(myslím|domnívám|podle mě|dle mého|mám za to)/i.test(text)) {
    return ClaimModality.OPINION;
  }
  
  // POSSIBLE patterns
  if (/(možná|může být|mohlo by|asi|snad|případně|eventuálně)/i.test(text)) {
    return ClaimModality.POSSIBLE;
  }
  
  // PROBABLE patterns
  if (/(pravděpodobně|zřejmě|patrně|měl by|obvykle|většinou|typicky)/i.test(text)) {
    return ClaimModality.PROBABLE;
  }
  
  // Default: FACT
  return ClaimModality.FACT;
}

/**
 * Detect temporal scope from content
 */
function detectTemporalScope(text, context) {
  // REALTIME indicators
  if (/(aktuálně|právě teď|momentálně|dnes|v tuto chvíli)/i.test(text)) {
    return TemporalScope.REALTIME;
  }
  
  // Price/market indicators → REALTIME
  if (/(cena|kurz|hodnota|stojí|korun|dolarů|eur)/i.test(text)) {
    return TemporalScope.REALTIME;
  }
  
  // Weather indicators → REALTIME
  if (/(počasí|teplota|prší|sněží|vítr)/i.test(text)) {
    return TemporalScope.REALTIME;
  }
  
  // Historical/definitional → STATIC
  if (/(definice|je to|znamená|vždy|nikdy|historicky)/i.test(text)) {
    return TemporalScope.STATIC;
  }
  
  // Default from context or STATIC
  return context.temporalScope || TemporalScope.STATIC;
}

/**
 * Detect verifiability from content
 */
function detectVerifiability(text, context) {
  // Mathematical/logical → CONSENSUS
  if (/(rovná se|výsledek|matematicky|logicky|definice)/i.test(text)) {
    return Verifiability.CONSENSUS;
  }
  
  // Official sources → OFFICIAL
  if (/(zákon|vyhláška|nařízení|oficiálně|úředně)/i.test(text)) {
    return Verifiability.OFFICIAL;
  }
  
  // Opinions → NONE
  if (/(myslím|domnívám|subjektivně|dle mého)/i.test(text)) {
    return Verifiability.NONE;
  }
  
  // Default: WEB
  return context.verifiability || Verifiability.WEB;
}

/**
 * Convert modality to confidence score
 */
function modalityToConfidence(modality) {
  const map = {
    [ClaimModality.FACT]: 0.9,
    [ClaimModality.PROBABLE]: 0.7,
    [ClaimModality.POSSIBLE]: 0.4,
    [ClaimModality.CONDITIONAL]: 0.6,
    [ClaimModality.OPINION]: 0.3
  };
  return map[modality] || 0.5;
}

// ════════════════════════════════════════════════════════════════════════════
// CLAIM-LEVEL ENFORCEMENT
// ════════════════════════════════════════════════════════════════════════════

/**
 * Apply enforcement rules per-claim
 * Now supports per-claim relaxation based on DialogState
 * 
 * @param {Claim[]} claims - Claims to enforce
 * @param {Object} globalEnforcement - Global enforcement rules
 * @param {DialogState} state - Optional state for per-claim relaxation
 * @returns {{ claims, log, text, needsGlobalDisclaimer }}
 */
export function enforceClaimsInResponse(claims, globalEnforcement = {}, state = null) {
  const enforcedClaims = [];
  const enforcementLog = [];
  let needsGlobalDisclaimer = false;
  
  for (const claim of claims) {
    let text = claim.text;
    const actions = [];
    
    // Check per-claim relaxation (if state provided)
    const canRelaxThisClaim = state ? 
      state.canRelaxEnforcementForClaim(claim) : false;
    
    // Check if claim needs hedge (unless relaxed)
    if (!canRelaxThisClaim && (claim.needsHedge() || globalEnforcement.requireHedge)) {
      const hedged = claim.applyHedge();
      if (hedged !== text) {
        text = hedged;
        actions.push('HEDGE_APPLIED');
      }
    } else if (canRelaxThisClaim) {
      actions.push('RELAXED');
    }
    
    // Check if claim is forbidden (realtime data without source)
    // NEVER relax this - realtime claims ALWAYS need disclaimer
    if (claim.temporalScope === TemporalScope.REALTIME && 
        claim.sourceStatus !== SourceStatus.VERIFIED) {
      claim.requiresDisclaimer = true;
      actions.push('MARKED_FOR_DISCLAIMER');
      needsGlobalDisclaimer = true;
    }
    
    // Check for price-related claims - ALWAYS strict
    if (/cen|kurz|stojí|korun|dolar|eur/i.test(text) && 
        claim.sourceStatus !== SourceStatus.VERIFIED) {
      if (!canRelaxThisClaim) {
        claim.requiresDisclaimer = true;
        actions.push('PRICE_CLAIM_DISCLAIMER');
        needsGlobalDisclaimer = true;
      }
    }
    
    // Check for prediction claims - ALWAYS need hedge
    if (/bude|stane se|předpovídám|očekávám/i.test(text) && !canRelaxThisClaim) {
      if (claim.modality === ClaimModality.FACT) {
        text = text.replace(/bude/i, 'pravděpodobně bude');
        actions.push('PREDICTION_HEDGED');
      }
    }
    
    // Log enforcement action
    enforcementLog.push({
      claimId: claim.id,
      originalText: claim.text,
      enforcedText: text,
      actions,
      enforcementLevel: claim.getEnforcementLevel(),
      wasRelaxed: canRelaxThisClaim
    });
    
    enforcedClaims.push({
      ...claim,
      text
    });
  }
  
  // Summary statistics
  const stats = {
    totalClaims: claims.length,
    hedged: enforcementLog.filter(e => e.actions.includes('HEDGE_APPLIED')).length,
    relaxed: enforcementLog.filter(e => e.wasRelaxed).length,
    disclaimers: enforcementLog.filter(e => 
      e.actions.includes('MARKED_FOR_DISCLAIMER') || 
      e.actions.includes('PRICE_CLAIM_DISCLAIMER')
    ).length
  };
  
  return {
    claims: enforcedClaims,
    log: enforcementLog,
    text: enforcedClaims.map(c => c.text).join(' '),
    needsGlobalDisclaimer,
    stats
  };
}

/**
 * Validate claims against locked facts
 */
export function validateClaimsAgainstFacts(claims, lockedFacts) {
  const violations = [];
  
  for (const claim of claims) {
    for (const [factKey, factValue] of Object.entries(lockedFacts)) {
      // Check for contradictions
      if (contradicts(claim.text, factKey, factValue)) {
        violations.push({
          claimId: claim.id,
          claimText: claim.text,
          contradiction: { key: factKey, value: factValue },
          severity: 'HIGH'
        });
      }
    }
  }
  
  return violations;
}

/**
 * Simple contradiction detection
 */
function contradicts(text, factKey, factValue) {
  const lowerText = text.toLowerCase();
  
  // Year contradiction
  if (factKey === 'year' && /\b(19|20)\d{2}\b/.test(text)) {
    const yearInText = text.match(/\b(19|20)\d{2}\b/)[0];
    return yearInText !== String(factValue);
  }
  
  // Month contradiction
  if (factKey === 'month') {
    const months = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen',
                    'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
    const monthIndex = months.findIndex(m => lowerText.includes(m));
    if (monthIndex >= 0) {
      return (monthIndex + 1) !== factValue;
    }
  }
  
  return false;
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export default {
  Claim,
  ClaimModality,
  SourceStatus,
  extractClaims,
  enforceClaimsInResponse,
  validateClaimsAgainstFacts
};
