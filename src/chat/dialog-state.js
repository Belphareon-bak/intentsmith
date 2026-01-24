// C.3 v35.3 Dialog State Machine
// ══════════════════════════════════════════════════════════════════════════════
// 
// DialogState je JEDINÝ ZDROJ PRAVDY pro konverzaci.
// 
// Řeší:
// - Co už víme (resolvedFacts)
// - Co se NESMÍ znovu ptát (lockedFacts)
// - Co ještě nevíme (openSlots)
// - Epistemický stav (volatility, certainty)
// - Historie turnů (lastTurn)
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// DIALOG INTENT (dialogové, ne technické)
// ════════════════════════════════════════════════════════════════════════════

export const DialogIntent = {
  SEEK: 'SEEK',           // Hledám novou informaci
  BUILD: 'BUILD',         // Doplňuji kontext k předchozímu
  CONFIRM: 'CONFIRM',     // Ověřuji myšlenku (chci validaci, ne info)
  CHALLENGE: 'CHALLENGE', // Zpochybňuji / opravuji
  EXPLORE: 'EXPLORE',     // Brainstorm / open-ended
  COMMAND: 'COMMAND'      // Příkaz (vytvoř, udělej)
};

// ════════════════════════════════════════════════════════════════════════════
// PERMITTED ACTIONS (jediná povolená akce)
// ════════════════════════════════════════════════════════════════════════════

export const PermittedAction = {
  ANSWER: 'ANSWER',       // Odpověz
  ASK: 'ASK',             // Zeptej se (na konkrétní slot)
  REFUSE: 'REFUSE',       // Odmítni (s důvodem)
  CONFIRM: 'CONFIRM',     // Potvrď/validuj
  DEFER: 'DEFER'          // Odlož (potřebuje externí zdroj)
};

// ════════════════════════════════════════════════════════════════════════════
// ANSWER TYPES (každá odpověď má právě jeden typ)
// ════════════════════════════════════════════════════════════════════════════

export const AnswerType = {
  FACTUAL: 'FACTUAL',           // Konkrétní fakt
  STRUCTURAL: 'STRUCTURAL',     // Rámcová/strukturální odpověď
  EXPLANATORY: 'EXPLANATORY',   // Vysvětlení
  CONDITIONAL: 'CONDITIONAL',   // Podmíněná odpověď
  REFUSAL: 'REFUSAL'            // Odmítnutí
};

// ════════════════════════════════════════════════════════════════════════════
// CORRECTION TYPES
// ════════════════════════════════════════════════════════════════════════════

export const CorrectionType = {
  FACTUAL: 'FACTUAL',       // Změna faktu ("správně je X")
  EPISTEMIC: 'EPISTEMIC',   // "Tohle si nemůžeš být jistý"
  SCOPE: 'SCOPE'            // "Řešíš něco, co jsem se neptal"
};

// ════════════════════════════════════════════════════════════════════════════
// VOLATILITY & CERTAINTY
// ════════════════════════════════════════════════════════════════════════════

export const Volatility = {
  LOW: 'LOW',       // Stabilní fakta (definice, historie)
  MEDIUM: 'MEDIUM', // Mění se pomalu (produkty, astronomie)
  HIGH: 'HIGH'      // Mění se rychle (ceny, počasí, zprávy)
};

export const Certainty = {
  LOW: 'LOW',       // Nejistota, odhad
  MEDIUM: 'MEDIUM', // Pravděpodobně správně
  HIGH: 'HIGH'      // Ověřeno / stabilní fakt
};

// ════════════════════════════════════════════════════════════════════════════
// DOMAIN
// ════════════════════════════════════════════════════════════════════════════

export const Domain = {
  UNKNOWN: 'unknown',
  ASTRONOMICAL: 'astronomical',
  PRICES: 'prices',
  WEATHER: 'weather',
  NEWS: 'news',
  TECHNICAL: 'technical',
  FACTUAL: 'factual',
  CREATIVE: 'creative'
};

// ════════════════════════════════════════════════════════════════════════════
// DIALOG STATE
// ════════════════════════════════════════════════════════════════════════════

export class DialogState {
  constructor() {
    this.reset();
  }
  
  reset() {
    // Domain
    this.domain = Domain.UNKNOWN;
    
    // Current dialog intent
    this.intent = null;
    
    // Resolved facts (co už víme jistě)
    this.resolvedFacts = new Map();
    
    // Locked facts (co se NESMÍ znovu ptát)
    this.lockedFacts = new Set();
    
    // Open slots (co ještě nevíme a potřebujeme)
    this.openSlots = new Set();
    
    // Assumptions made during conversation
    this.assumptions = [];
    
    // Epistemic state
    this.epistemic = {
      volatility: Volatility.MEDIUM,
      certainty: Certainty.MEDIUM
    };
    
    // Last turn info
    this.lastTurn = {
      action: null,
      reason: null,
      answerType: null,
      askedSlot: null,       // Co jsme se ptali
      responseHash: null      // Pro repeat prevention
    };
    
    // Turn counter
    this.turnCount = 0;
    
    // Correction state
    this.pendingCorrection = null;
    
    // Disclaimer tracking
    this.disclaimerGiven = false;
  }
  
  // ══════════════════════════════════════════════════════════════════════════
  // FACT MANAGEMENT
  // ══════════════════════════════════════════════════════════════════════════
  
  /**
   * Resolve a fact - mark as known
   */
  resolveFact(key, value) {
    this.resolvedFacts.set(key, value);
    this.openSlots.delete(key);  // No longer open
    logger.debug('DialogState', `Resolved: ${key}=${value}`);
  }
  
  /**
   * Lock a fact - CANNOT ask about it again
   */
  lockFact(key) {
    if (this.resolvedFacts.has(key)) {
      this.lockedFacts.add(key);
      logger.debug('DialogState', `Locked: ${key}`);
    }
  }
  
  /**
   * Lock all currently resolved facts
   */
  lockAllResolved() {
    for (const key of this.resolvedFacts.keys()) {
      this.lockedFacts.add(key);
    }
    logger.debug('DialogState', `Locked all: ${Array.from(this.lockedFacts)}`);
  }
  
  /**
   * Check if we can ask about a slot
   */
  canAskAbout(key) {
    return !this.lockedFacts.has(key);
  }
  
  /**
   * Check if a fact is resolved
   */
  hasFact(key) {
    return this.resolvedFacts.has(key);
  }
  
  /**
   * Get a resolved fact
   */
  getFact(key) {
    return this.resolvedFacts.get(key);
  }
  
  /**
   * Mark a slot as open (needs to be resolved)
   */
  markSlotOpen(key) {
    if (!this.lockedFacts.has(key)) {
      this.openSlots.add(key);
    }
  }
  
  /**
   * Check if there are open slots
   */
  hasOpenSlots() {
    return this.openSlots.size > 0;
  }
  
  /**
   * Get first open slot that can be asked
   */
  getFirstAskableSlot() {
    for (const slot of this.openSlots) {
      if (this.canAskAbout(slot)) {
        return slot;
      }
    }
    return null;
  }
  
  // ══════════════════════════════════════════════════════════════════════════
  // EPISTEMIC STATE
  // ══════════════════════════════════════════════════════════════════════════
  
  /**
   * Set volatility based on domain/content
   */
  setVolatility(v) {
    this.epistemic.volatility = v;
  }
  
  /**
   * Set certainty based on sources/evidence
   */
  setCertainty(c) {
    this.epistemic.certainty = c;
  }
  
  /**
   * Check if high volatility
   */
  isHighVolatility() {
    return this.epistemic.volatility === Volatility.HIGH;
  }
  
  /**
   * Check if low certainty
   */
  isLowCertainty() {
    return this.epistemic.certainty === Certainty.LOW;
  }
  
  // ══════════════════════════════════════════════════════════════════════════
  // TURN MANAGEMENT
  // ══════════════════════════════════════════════════════════════════════════
  
  /**
   * Record a turn
   */
  recordTurn(action, reason, answerType = null, askedSlot = null) {
    this.lastTurn = {
      action,
      reason,
      answerType,
      askedSlot,
      responseHash: null  // Set separately
    };
    this.turnCount++;
    
    // If we asked, mark what we asked
    if (action === PermittedAction.ASK && askedSlot) {
      this.markSlotOpen(askedSlot);
    }
    
    logger.debug('DialogState', `Turn ${this.turnCount}`, this.lastTurn);
  }
  
  /**
   * Set response hash for repeat prevention
   */
  setResponseHash(hash) {
    this.lastTurn.responseHash = hash;
  }
  
  /**
   * Check if this is a follow-up (not first turn)
   */
  isFollowUp() {
    return this.turnCount > 0;
  }
  
  /**
   * Check if we just asked something
   */
  justAsked() {
    return this.lastTurn.action === PermittedAction.ASK;
  }
  
  /**
   * Get what we just asked about
   */
  getJustAskedSlot() {
    return this.lastTurn.askedSlot;
  }
  
  // ══════════════════════════════════════════════════════════════════════════
  // CORRECTION
  // ══════════════════════════════════════════════════════════════════════════
  
  /**
   * Set pending correction
   */
  setPendingCorrection(type, details = null) {
    this.pendingCorrection = { type, details };
    logger.info('DialogState', `Correction pending: ${type}`, details);
  }
  
  /**
   * Clear pending correction
   */
  clearCorrection() {
    this.pendingCorrection = null;
  }
  
  /**
   * Check if correction is pending
   */
  hasPendingCorrection() {
    return this.pendingCorrection !== null;
  }
  
  // ══════════════════════════════════════════════════════════════════════════
  // ASSUMPTIONS
  // ══════════════════════════════════════════════════════════════════════════
  
  /**
   * Add an assumption
   */
  addAssumption(text) {
    this.assumptions.push(text);
  }
  
  /**
   * Clear assumptions
   */
  clearAssumptions() {
    this.assumptions = [];
  }
  
  // ══════════════════════════════════════════════════════════════════════════
  // SNAPSHOT
  // ══════════════════════════════════════════════════════════════════════════
  
  /**
   * Get state snapshot for debugging/logging
   */
  getSnapshot() {
    return {
      domain: this.domain,
      intent: this.intent,
      resolvedFacts: Object.fromEntries(this.resolvedFacts),
      lockedFacts: Array.from(this.lockedFacts),
      openSlots: Array.from(this.openSlots),
      epistemic: { ...this.epistemic },
      lastTurn: { ...this.lastTurn },
      turnCount: this.turnCount,
      pendingCorrection: this.pendingCorrection
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// DECISION RESULT (jediná povolená akce + constraints)
// ════════════════════════════════════════════════════════════════════════════

export class Decision {
  constructor(action, reason) {
    this.action = action;
    this.reason = reason;
    this.constraints = {
      mustAsk: [],        // Které sloty MUSÍME zeptat
      mustNotAsk: [],     // Které sloty NESMÍME zeptat (locked)
      mustInclude: [],    // Co MUSÍ být v odpovědi
      mustAvoid: [],      // Co NESMÍ být v odpovědi
      answerType: null,   // Povolený typ odpovědi
      maxCertainty: null  // Maximální povolená jistota
    };
  }
  
  /**
   * Factory methods
   */
  static answer(reason, answerType = AnswerType.FACTUAL) {
    const d = new Decision(PermittedAction.ANSWER, reason);
    d.constraints.answerType = answerType;
    return d;
  }
  
  static ask(slot, reason) {
    const d = new Decision(PermittedAction.ASK, reason);
    d.constraints.mustAsk = [slot];
    return d;
  }
  
  static refuse(reason) {
    const d = new Decision(PermittedAction.REFUSE, reason);
    d.constraints.answerType = AnswerType.REFUSAL;
    return d;
  }
  
  static confirm(reason) {
    const d = new Decision(PermittedAction.CONFIRM, reason);
    d.constraints.answerType = AnswerType.CONDITIONAL;
    return d;
  }
  
  static defer(reason) {
    const d = new Decision(PermittedAction.DEFER, reason);
    return d;
  }
  
  /**
   * Constraint setters
   */
  withMustNotAsk(slots) {
    this.constraints.mustNotAsk = slots;
    return this;
  }
  
  withMustInclude(items) {
    this.constraints.mustInclude = items;
    return this;
  }
  
  withMustAvoid(items) {
    this.constraints.mustAvoid = items;
    return this;
  }
  
  withMaxCertainty(level) {
    this.constraints.maxCertainty = level;
    return this;
  }
  
  withAnswerType(type) {
    this.constraints.answerType = type;
    return this;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export default {
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
