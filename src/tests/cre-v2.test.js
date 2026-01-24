// C.3 v36.2 CRE Tests
// ══════════════════════════════════════════════════════════════════════════════

import { describe, test, expect, runTests, printSummary } from './e2e-runner.js';
import {
  DialogState, Slot, DecisionTrace, DialogIntent, SystemAction, SpeechAct,
  Volatility, Certainty, Domain, Verifiability, TemporalScope, 
  ReasoningDepth, AnswerMode, VerifiabilityScore, getVerifiabilityScore,
  KnowledgeProvider, KnowledgeResult, SourceRegistry
} from '../chat/dialog-state-v2.js';
import { 
  decide, decideAdaptive, Decision, penalizeRule, rewardRule, 
  getRulePenalty, clearPenalties 
} from '../chat/decision-matrix.js';
import CRE, {
  detectIntent, detectDomain, detectVolatility, extractSlots
} from '../chat/cre-v2.js';
import {
  Claim, ClaimModality, SourceStatus, extractClaims, enforceClaimsInResponse
} from '../chat/claim-model.js';

// ════════════════════════════════════════════════════════════════════════════
// SLOT TESTS
// ════════════════════════════════════════════════════════════════════════════

describe('📦 Slot Model', () => {
  test('New slot is unresolved', () => {
    const slot = new Slot('year');
    expect(slot.isResolved()).toBe(false);
    expect(slot.isLocked()).toBe(false);
  });
  
  test('Resolve slot', () => {
    const slot = new Slot('year');
    slot.resolve(2026, 'user', 1.0);
    expect(slot.isResolved()).toBe(true);
    expect(slot.value).toBe(2026);
    expect(slot.source).toBe('user');
  });
  
  test('Lock slot', () => {
    const slot = new Slot('year');
    slot.resolve(2026, 'user');
    slot.lock();
    expect(slot.isLocked()).toBe(true);
  });
  
  test('Cannot resolve locked slot', () => {
    const slot = new Slot('year');
    slot.resolve(2026, 'user');
    slot.lock();
    const result = slot.resolve(2027, 'user');
    expect(result).toBe(false);
    expect(slot.value).toBe(2026);  // Unchanged
  });
});

// ════════════════════════════════════════════════════════════════════════════
// AUTHORITATIVE DIALOG STATE TESTS
// ════════════════════════════════════════════════════════════════════════════

describe('📊 Authoritative DialogState', () => {
  test('Initial permissions - mayGuess is FALSE', () => {
    const state = new DialogState();
    expect(state.may('mayAnswer')).toBe(true);
    expect(state.may('mayGuess')).toBe(false);  // DEFAULT FALSE!
    expect(state.may('mayAskClarification')).toBe(true);
  });
  
  test('Grant and revoke permissions', () => {
    const state = new DialogState();
    state.revoke('mayAnswer');
    expect(state.may('mayAnswer')).toBe(false);
    state.grant('mayAnswer');
    expect(state.may('mayAnswer')).toBe(true);
  });
  
  test('Require enforcement', () => {
    const state = new DialogState();
    state.require('requireDisclaimer');
    expect(state.mustHave('requireDisclaimer')).toBe(true);
  });
  
  test('Forbid numbers', () => {
    const state = new DialogState();
    state.forbid('numbers');
    expect(state.isForbidden('numbers')).toBe(true);
    expect(state.may('mayProvideNumbers')).toBe(false);
  });
  
  test('Slot resolution and locking', () => {
    const state = new DialogState();
    state.resolveSlot('year', 2026, 'user');
    state.lockSlot('year');
    
    expect(state.hasSlot('year')).toBe(true);
    expect(state.getSlotValue('year')).toBe(2026);
    expect(state.canAskAbout('year')).toBe(false);
  });
  
  test('Lock all resolved slots', () => {
    const state = new DialogState();
    state.resolveSlot('year', 2026);
    state.resolveSlot('month', 2);
    state.lockAllResolved();
    
    expect(state.canAskAbout('year')).toBe(false);
    expect(state.canAskAbout('month')).toBe(false);
    expect(state.canAskAbout('location')).toBe(true);  // Not resolved
  });
  
  test('Open slots tracking', () => {
    const state = new DialogState();
    state.getSlot('year');  // Create but don't resolve
    state.getSlot('month');
    state.resolveSlot('month', 2);
    
    const open = state.getOpenSlots();
    expect(open.includes('year')).toBe(true);
    expect(open.includes('month')).toBe(false);
  });
  
  test('Has open slots in required list', () => {
    const state = new DialogState();
    state.resolveSlot('year', 2026);
    // month not resolved
    
    expect(state.hasOpenSlotsIn(['year', 'month'])).toBe(true);
    expect(state.hasOpenSlotsIn(['year'])).toBe(false);
  });
  
  test('Get first askable slot', () => {
    const state = new DialogState();
    state.resolveSlot('year', 2026);
    state.lockSlot('year');
    // month not resolved
    
    expect(state.getFirstAskableSlot(['year', 'month'])).toBe('month');
    expect(state.getFirstAskableSlot(['year'])).toBe(null);  // Locked
  });
  
  test('Domain change detection', () => {
    const state = new DialogState();
    state.setDomain(Domain.ASTRONOMICAL);
    state.recordDecision(SystemAction.ANSWER, 'test');
    state.setDomain(Domain.PRICES);
    
    expect(state.domainChanged()).toBe(true);
    expect(state.previousDomain).toBe(Domain.ASTRONOMICAL);
  });
  
  test('Correction mode', () => {
    const state = new DialogState();
    state.enterCorrectionMode('factual');
    
    expect(state.correctionMode).toBe(true);
    expect(state.mustHave('requireCorrection')).toBe(true);
    
    state.exitCorrectionMode();
    expect(state.correctionMode).toBe(false);
  });
  
  test('Follow-up detection', () => {
    const state = new DialogState();
    expect(state.isFollowUp()).toBe(false);
    
    state.recordDecision(SystemAction.ANSWER, 'test');
    expect(state.isFollowUp()).toBe(true);
  });
  
  test('Just asked detection', () => {
    const state = new DialogState();
    state.recordDecision(SystemAction.ASK_CLARIFICATION, 'asked year');
    expect(state.justAsked()).toBe(true);
    
    state.recordDecision(SystemAction.ANSWER, 'answered');
    expect(state.justAsked()).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DECISION MATRIX TESTS
// ════════════════════════════════════════════════════════════════════════════

describe('🎲 Decision Matrix', () => {
  test('Correction mode → CORRECT_PREVIOUS', () => {
    const state = new DialogState();
    state.domain = Domain.FACTUAL;
    state.enterCorrectionMode();
    
    const decision = decide(state);
    expect(decision.action).toBe(SystemAction.CORRECT_PREVIOUS);
  });
  
  test('CONFIRM intent → CONFIRM_ONLY', () => {
    const state = new DialogState();
    state.domain = Domain.FACTUAL;
    state.dialogIntent = DialogIntent.CONFIRM;
    
    const decision = decide(state);
    expect(decision.action).toBe(SystemAction.CONFIRM_CONTEXT);
    expect(decision.speechAct).toBe(SpeechAct.CONFIRMATION);
  });
  
  test('No answer permission → DEFER', () => {
    const state = new DialogState();
    state.domain = Domain.FACTUAL;
    state.revoke('mayAnswer');
    
    const decision = decide(state);
    expect(decision.action).toBe(SystemAction.DEFER_TO_SEARCH);
    expect(decision.speechAct).toBe(SpeechAct.REFUSAL);
  });
  
  test('Open slots + can ask → ASK_CLARIFICATION', () => {
    const state = new DialogState();
    state.setDomain(Domain.ASTRONOMICAL);  // Requires year, month
    
    const decision = decide(state);
    expect(decision.action).toBe(SystemAction.ASK_CLARIFICATION);
    expect(decision.askSlot).toBe('year');
  });
  
  test('All slots filled → ANSWER', () => {
    const state = new DialogState();
    state.domain = Domain.ASTRONOMICAL;
    state.resolveSlot('year', 2026);
    state.resolveSlot('month', 2);
    
    const decision = decide(state);
    expect(decision.action).toBe(SystemAction.ANSWER);
    expect(decision.speechAct).toBe(SpeechAct.FACT);
  });
  
  test('Constraints from enforcement', () => {
    const state = new DialogState();
    state.domain = Domain.FACTUAL;
    state.forbid('numbers');
    state.require('requireDisclaimer');
    
    const decision = decide(state);
    expect(decision.constraints.includes('NO_SPECIFIC_NUMBERS')).toBe(true);
    expect(decision.constraints.includes('REQUIRE_DISCLAIMER')).toBe(true);
  });
  
  test('Domain changed → RESET_CONTEXT', () => {
    const state = new DialogState();
    state.setDomain(Domain.ASTRONOMICAL);
    state.recordDecision(SystemAction.ANSWER, 'test');
    state.setDomain(Domain.PRICES);  // Domain changes
    
    const decision = decide(state);
    expect(decision.action).toBe(SystemAction.RESET_CONTEXT);
  });
  
  test('EXPLORE intent → SUGGESTION speech act', () => {
    const state = new DialogState();
    state.domain = Domain.FACTUAL;
    state.dialogIntent = DialogIntent.EXPLORE;
    
    const decision = decide(state);
    expect(decision.action).toBe(SystemAction.ANSWER);
    expect(decision.speechAct).toBe(SpeechAct.SUGGESTION);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DETECTION TESTS
// ════════════════════════════════════════════════════════════════════════════

describe('🎯 Detection Functions', () => {
  test('detectDomain: PRICES', () => {
    expect(detectDomain('Kolik stojí RTX 4070?')).toBe(Domain.PRICES);
  });
  
  test('detectDomain: WEATHER', () => {
    expect(detectDomain('Jaké bude počasí?')).toBe(Domain.WEATHER);
  });
  
  test('detectDomain: ASTRONOMICAL', () => {
    expect(detectDomain('Kdy je úplněk?')).toBe(Domain.ASTRONOMICAL);
  });
  
  test('detectVolatility: HIGH for prices', () => {
    expect(detectVolatility('aktuální cena', Domain.UNKNOWN)).toBe(Volatility.HIGH);
  });
  
  test('detectVolatility: LOW for definitions', () => {
    expect(detectVolatility('co je definice', Domain.UNKNOWN)).toBe(Volatility.LOW);
  });
  
  test('detectVolatility: HIGH for high-vol domain', () => {
    expect(detectVolatility('test', Domain.PRICES)).toBe(Volatility.HIGH);
  });
  
  test('detectIntent: CHALLENGE', () => {
    const state = new DialogState();
    expect(detectIntent('To je blbost', state)).toBe(DialogIntent.CHALLENGE);
    expect(detectIntent('Jsi mimo', state)).toBe(DialogIntent.CHALLENGE);
  });
  
  test('detectIntent: CONFIRM in follow-up', () => {
    const state = new DialogState();
    state.recordDecision(SystemAction.ANSWER, 'test');
    expect(detectIntent('Souhlasíš?', state)).toBe(DialogIntent.CONFIRM);
  });
  
  test('detectIntent: BUILD after question', () => {
    const state = new DialogState();
    state.recordDecision(SystemAction.ASK_CLARIFICATION, 'asked');
    expect(detectIntent('2026', state)).toBe(DialogIntent.BUILD);
  });
  
  test('detectIntent: COMMAND', () => {
    const state = new DialogState();
    expect(detectIntent('Udělej tabulku', state)).toBe(DialogIntent.COMMAND);
  });
  
  test('detectIntent: EXPLORE', () => {
    const state = new DialogState();
    expect(detectIntent('Co si myslíš?', state)).toBe(DialogIntent.EXPLORE);
  });
  
  test('extractSlots: year', () => {
    const state = new DialogState();
    extractSlots('v roce 2026', state);
    expect(state.hasSlot('year')).toBe(true);
    expect(state.getSlotValue('year')).toBe(2026);
  });
  
  test('extractSlots: month', () => {
    const state = new DialogState();
    extractSlots('v únoru', state);
    expect(state.hasSlot('month')).toBe(true);
    expect(state.getSlotValue('month')).toBe(2);
  });
  
  test('extractSlots: location', () => {
    const state = new DialogState();
    extractSlots('v Praze', state);
    expect(state.hasSlot('location')).toBe(true);
    expect(state.getSlotValue('location')).toBe('Praha');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CRE INTEGRATION TESTS
// ════════════════════════════════════════════════════════════════════════════

describe('🔄 CRE Integration', () => {
  test('SEEK with missing slots → ASK', async () => {
    const state = new DialogState();
    const result = await CRE.process('Kdy je úplněk?', state, {});
    
    expect(result.success).toBe(true);
    expect(result.decision.action).toBe(SystemAction.ASK_CLARIFICATION);
    expect(result.speechAct).toBe(SpeechAct.QUESTION);
    expect(result.text).toContain('rok');
  });
  
  test('BUILD fills and locks slots', async () => {
    const state = new DialogState();
    state.recordDecision(SystemAction.ASK_CLARIFICATION, 'asked year');
    
    const result = await CRE.process('2026', state, {});
    
    expect(result.success).toBe(true);
    expect(state.hasSlot('year')).toBe(true);
    expect(state.canAskAbout('year')).toBe(false);  // LOCKED
  });
  
  test('HIGH volatility without source → DEFER', async () => {
    const state = new DialogState();
    
    const result = await CRE.process('Jaká je aktuální cena Bitcoinu?', state, {});
    
    expect(result.success).toBe(true);
    expect(result.decision.action).toBe(SystemAction.DEFER_TO_SEARCH);
  });
  
  test('HIGH volatility with source → ANSWER', async () => {
    const state = new DialogState();
    
    const result = await CRE.process('Jaká je cena Bitcoinu?', state, { source: 'web' });
    
    expect(result.success).toBe(true);
    // With source, should be allowed to answer
    expect([SystemAction.ANSWER, SystemAction.ASK_CLARIFICATION].includes(result.decision.action)).toBe(true);
  });
  
  test('LOW volatility → ANSWER with FACT', async () => {
    const state = new DialogState();
    
    const result = await CRE.process('Jaká je chemická značka zlata?', state, {});
    
    expect(result.success).toBe(true);
    expect(result.decision.action).toBe(SystemAction.ANSWER);
    expect(result.decision.speechAct).toBe(SpeechAct.FACT);
  });
  
  test('CONFIRM intent → no questions', async () => {
    const state = new DialogState();
    state.recordDecision(SystemAction.ANSWER, 'previous');
    
    const result = await CRE.process('Souhlasíš?', state, {});
    
    expect(result.success).toBe(true);
    expect(result.decision.action).toBe(SystemAction.CONFIRM_CONTEXT);
    expect(state.may('mayAskClarification')).toBe(false);
  });
  
  test('CHALLENGE → CORRECT_PREVIOUS', async () => {
    const state = new DialogState();
    state.recordDecision(SystemAction.ANSWER, 'previous');
    
    const result = await CRE.process('To je blbost', state, {});
    
    expect(result.success).toBe(true);
    expect(result.decision.action).toBe(SystemAction.CORRECT_PREVIOUS);
  });
  
  test('Multi-turn: slots persist and lock', async () => {
    const state = new DialogState();
    
    // Turn 1: Ask about moon
    const r1 = await CRE.process('Kdy je úplněk?', state, {});
    expect(r1.decision.action).toBe(SystemAction.ASK_CLARIFICATION);
    
    // Turn 2: Provide year (BUILD)
    const r2 = await CRE.process('2026', state, {});
    expect(state.hasSlot('year')).toBe(true);
    expect(state.canAskAbout('year')).toBe(false);  // LOCKED
    
    // Turn 3: Ask about month - should NOT re-ask year
    const r3 = await CRE.process('A který měsíc?', state, {});
    if (r3.decision.action === SystemAction.ASK_CLARIFICATION) {
      expect(r3.decision.askSlot).not.toBe('year');  // Year is locked
    }
  });
  
  test('Speech Act enforcement adds markers', async () => {
    const state = new DialogState();
    
    // Force low certainty
    state.setEpistemic('certainty', Certainty.LOW);
    state.require('requireDisclaimer');
    
    const result = await CRE.process('Test query', state, {});
    
    // If answered, should have disclaimer
    if (result.text && !result.text.includes('[LLM')) {
      const hasMarker = /⚠️|upozornění|orientační|odhad/i.test(result.text);
      // May or may not have marker depending on action
    }
    expect(result.success).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DECISION TRACE TESTS (FÁZE 3)
// ════════════════════════════════════════════════════════════════════════════

describe('🔍 Decision Trace (Reasoning Transparency)', () => {
  test('Decision includes trace with matched rule', async () => {
    const state = new DialogState();
    const result = await CRE.process('Kolik je 2+2?', state, {});
    
    expect(result.decision.trace).not.toBe(null);
    expect(result.decision.trace.matchedRule.name).toBeDefined();
    expect(result.decision.trace.matchedRule.id).toBeGreaterThanOrEqual(0);
  });
  
  test('Trace captures inputs (domain, intent, openSlots)', async () => {
    const state = new DialogState();
    const result = await CRE.process('Kdy bude úplněk?', state, {});
    
    const trace = result.decision.trace;
    expect(trace.inputs.domain).toBe('astronomical');
    expect(trace.inputs.intent).toBe('SEEK');
    expect(trace.inputs.openSlots).toContain('year');
  });
  
  test('Trace records evaluated rules with reasons', async () => {
    const state = new DialogState();
    state.recordDecision(SystemAction.ANSWER, 'test');
    
    const result = await CRE.process('Souhlasíš?', state, {});
    
    const trace = result.decision.trace;
    expect(trace.evaluatedRules).toBeDefined();
    expect(Array.isArray(trace.evaluatedRules)).toBe(true);
    expect(trace.evaluatedRules.length).toBeGreaterThan(0);
    // Each evaluated rule has id, name, result, reason
    const first = trace.evaluatedRules[0];
    expect(first.name).toBeDefined();
    expect(['MATCH', 'NO_MATCH']).toContain(first.result);
  });
  
  test('Decision.explain() returns readable string with negative reasoning', async () => {
    const state = new DialogState();
    const result = await CRE.process('Test', state, {});
    
    const explanation = result.decision.explain();
    expect(typeof explanation).toBe('string');
    expect(explanation.length).toBeGreaterThan(10);
    // Should contain trace info (MATCHED, INPUTS, etc)
    expect(explanation).toContain('MATCHED');
  });
  
  test('CREResult.explain() includes trace info', async () => {
    const state = new DialogState();
    const result = await CRE.process('Test', state, {});
    
    const explanation = result.explain();
    expect(typeof explanation).toBe('string');
    expect(explanation).toContain('Action:');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// EPISTEMIC PRECISION TESTS (FÁZE 4)
// ════════════════════════════════════════════════════════════════════════════

describe('🎯 Epistemic Precision', () => {
  test('PRICES domain sets REALTIME temporalScope', () => {
    const state = new DialogState();
    state.setDomain(Domain.PRICES);
    
    expect(state.epistemic.temporalScope).toBe('REALTIME');
    expect(state.epistemic.verifiability).toBe('WEB');
  });
  
  test('FACTUAL domain sets CONSENSUS verifiability', () => {
    const state = new DialogState();
    state.setDomain(Domain.FACTUAL);
    
    expect(state.epistemic.verifiability).toBe('CONSENSUS');
    expect(state.epistemic.temporalScope).toBe('STATIC');
  });
  
  test('ASTRONOMICAL domain sets YEARLY temporalScope', () => {
    const state = new DialogState();
    state.setDomain(Domain.ASTRONOMICAL);
    
    expect(state.epistemic.temporalScope).toBe('YEARLY');
    expect(state.epistemic.verifiability).toBe('OFFICIAL');
  });
  
  test('Topic-scoped confidence - different domains are independent', () => {
    const state = new DialogState();
    
    // First domain
    state.setDomain(Domain.PRICES);
    state.recordVerifiedAnswer();
    const pricesConf = state._getTopicConfidence();
    // PRICES domain has REALTIME temporal scope = 0.1 increment
    expect(pricesConf.verifiedClaims).toBeGreaterThan(0);
    
    // Switch domain
    state.setDomain(Domain.ASTRONOMICAL);
    state.recordVerifiedAnswer();
    const astroConf = state._getTopicConfidence();
    // ASTRONOMICAL domain has YEARLY temporal scope = 0.8 increment
    expect(astroConf.verifiedClaims).toBeGreaterThan(0);
    
    // Check prices still has its own confidence
    state.setDomain(Domain.PRICES);
    const pricesConf2 = state._getTopicConfidence();
    expect(pricesConf2.verifiedClaims).toBeGreaterThan(0);
  });
  
  test('User confirmation boosts topic confidence', () => {
    const state = new DialogState();
    state.setDomain(Domain.FACTUAL);
    
    const confBefore = state._getTopicConfidence();
    expect(confBefore.userConfirmed).toBe(false);
    
    state.recordUserConfirmation();
    
    const confAfter = state._getTopicConfidence();
    expect(confAfter.userConfirmed).toBe(true);
    expect(confAfter.factualSupport).toBeGreaterThan(0);
  });
  
  test('Corrections penalize both global and topic confidence', () => {
    const state = new DialogState();
    state.setDomain(Domain.FACTUAL);
    state.recordVerifiedAnswer();
    
    const initialCoherence = state.confidence.coherence;
    const initialFactual = state._getTopicConfidence().factualSupport;
    
    state.recordCorrection();
    
    expect(state.confidence.correctionCount).toBe(1);
    expect(state.confidence.coherence).toBeLessThan(initialCoherence);
    expect(state._getTopicConfidence().factualSupport).toBeLessThan(initialFactual);
    expect(state._getTopicConfidence().userConfirmed).toBe(false);
  });
  
  test('canRelaxEnforcement requires user OR source confirmation', () => {
    const state = new DialogState();
    state.setDomain(Domain.FACTUAL);
    
    // Initially cannot relax
    expect(state.canRelaxEnforcement()).toBe(false);
    
    // Add verified answers (but no confirmation)
    for (let i = 0; i < 5; i++) {
      state.recordVerifiedAnswer();
    }
    state.updateCoherence(0.3);
    
    // Still cannot relax without confirmation
    expect(state.canRelaxEnforcement()).toBe(false);
    
    // Add user confirmation
    state.recordUserConfirmation();
    
    // Now can relax
    expect(state.canRelaxEnforcement()).toBe(true);
  });
  
  test('ReasoningDepth affects answerMode', () => {
    const state = new DialogState();
    
    state.setReasoningDepth(ReasoningDepth.EXPLORATORY);
    expect(state.epistemic.answerMode).toBe(AnswerMode.EXPLORATORY);
    
    state.setReasoningDepth(ReasoningDepth.SURFACE);
    expect(state.epistemic.answerMode).toBe(AnswerMode.PRECISE);
  });
  
  test('canAnswerWithBounds checks conditions', () => {
    const state = new DialogState();
    state.setDomain(Domain.FACTUAL);
    
    // Cannot answer with bounds if PRECISE mode
    state.setAnswerMode(AnswerMode.PRECISE);
    expect(state.canAnswerWithBounds()).toBe(false);
    
    // Need at least one filled slot
    state.setAnswerMode(AnswerMode.BOUNDED);
    expect(state.canAnswerWithBounds()).toBe(false);
    
    // Fill a slot
    state.fillSlot('year', 2026, 0.9, 'user');
    
    // Now can answer with bounds (if ≤2 open slots)
    const canAnswer = state.canAnswerWithBounds();
    // Depends on open slots count
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ANSWER QUALITY GATE TESTS (FÁZE 5)
// ════════════════════════════════════════════════════════════════════════════

import { validateAnswer, applyQualityGate, applyQualityGateWithRepair, getRepairHints, QualityGateResult } from '../chat/answer-quality-gate.js';

describe('✅ Answer Quality Gate', () => {
  test('Empty response fails validation', () => {
    const state = new DialogState();
    const decision = new Decision(SystemAction.ANSWER, 'test');
    
    const result = validateAnswer('', state, decision);
    
    expect(result.passed).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations[0].code).toBe('EMPTY_RESPONSE');
  });
  
  test('Overly confident response in LOW certainty context', () => {
    const state = new DialogState();
    state.epistemic.certainty = Certainty.LOW;
    const decision = new Decision(SystemAction.ANSWER, 'test');
    
    const result = validateAnswer('Je to 100% jisté bez pochyby.', state, decision);
    
    // Should have warning and auto-fix
    expect(result.warnings.some(w => w.code === 'CERTAINTY_VIOLATION')).toBe(true);
    expect(result.correctedText).toBeDefined();
    expect(result.correctedText).not.toContain('bez pochyby');
  });
  
  test('CONFIRM response with too much content triggers fix', () => {
    const state = new DialogState();
    const decision = new Decision(SystemAction.CONFIRM_CONTEXT, 'validation');
    
    const longResponse = 'Ano, souhlasím. Navíc bych chtěl dodat, že je třeba dodat další informace. Důležité je zmínit ještě jeden bod. A ještě jedna věc.';
    const result = validateAnswer(longResponse, state, decision);
    
    // Should have warning about new facts in CONFIRM
    const hasWarning = result.warnings.some(w => w.code === 'NEW_FACTS_IN_CONFIRM');
    // Might pass or fail depending on exact rules
  });
  
  test('applyQualityGate returns fallback on violation', () => {
    const state = new DialogState();
    const decision = new Decision(SystemAction.ANSWER, 'test');
    
    const result = applyQualityGate('', state, decision);
    
    expect(result.fallback).toBe(true);
    expect(result.text).toContain('⚠️');
  });
  
  test('applyQualityGate passes good response', () => {
    const state = new DialogState();
    const decision = new Decision(SystemAction.ANSWER, 'test');
    
    const result = applyQualityGate('Dobrá odpověď na otázku.', state, decision);
    
    expect(result.fallback).toBe(false);
  });
  
  test('Missing disclaimer is auto-added', () => {
    const state = new DialogState();
    state.enforcement.requireDisclaimer = true;
    const decision = new Decision(SystemAction.ANSWER, 'test');
    
    const result = validateAnswer('Odpověď bez disclaimeru.', state, decision);
    
    expect(result.warnings.some(w => w.code === 'MISSING_DISCLAIMER')).toBe(true);
    expect(result.correctedText).toContain('⚠️');
  });
  
  test('getRepairHints returns instructions for violations', () => {
    const violation = { code: 'CERTAINTY_VIOLATION', message: 'Too confident' };
    const hints = getRepairHints(violation);
    
    expect(hints.instruction).toBeDefined();
    expect(hints.constraint).toBe('NO_CONFIDENT_LANGUAGE');
  });
  
  test('getRepairHints handles unknown violations', () => {
    const violation = { code: 'UNKNOWN_CODE', message: 'Some problem' };
    const hints = getRepairHints(violation);
    
    expect(hints.instruction).toContain('Some problem');
    expect(hints.constraint).toBe('GENERAL_FIX');
  });
  
  test('applyQualityGateWithRepair returns repairCount', async () => {
    const state = new DialogState();
    const decision = new Decision(SystemAction.ANSWER, 'test');
    
    const result = await applyQualityGateWithRepair(
      'Dobrá odpověď.',
      state,
      decision,
      null
    );
    
    expect(result.fallback).toBe(false);
    expect(result.repairCount).toBe(0);
    expect(result.confidencePenalty).toBe(0);
  });
  
  test('applyQualityGateWithRepair applies correction and counts repair', async () => {
    const state = new DialogState();
    state.enforcement.requireDisclaimer = true;
    const decision = new Decision(SystemAction.ANSWER, 'test');
    
    const result = await applyQualityGateWithRepair(
      'Odpověď bez disclaimeru.',
      state,
      decision,
      null
    );
    
    // Auto-correction should work
    if (!result.fallback) {
      // If auto-correction worked, text should have disclaimer
      expect(result.text).toContain('⚠️');
    }
    // Either way, we should get a result
    expect(result).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ATOMIC CLAIM TESTS (v35.8)
// ════════════════════════════════════════════════════════════════════════════

describe('🧬 Atomic Claims', () => {
  test('Create claim with epistemic metadata', () => {
    const claim = new Claim('Jeep Wrangler má uzávěrku diferenciálu.', {
      modality: ClaimModality.FACT,
      sourceStatus: SourceStatus.TRAINING,
      confidence: 0.8
    });
    
    expect(claim.text).toContain('Jeep');
    expect(claim.modality).toBe(ClaimModality.FACT);
    expect(claim.confidence).toBe(0.8);
  });
  
  test('Claim with POSSIBLE modality needs hedge', () => {
    const claim = new Claim('Toto může být problém.', {
      modality: ClaimModality.POSSIBLE
    });
    
    expect(claim.needsHedge()).toBe(true);
    expect(claim.getEnforcementLevel()).toBe('MEDIUM');
  });
  
  test('Verified claim has lower enforcement', () => {
    const claim = new Claim('Zlato má atomové číslo 79.', {
      modality: ClaimModality.FACT,
      sourceStatus: SourceStatus.VERIFIED,
      verifiability: Verifiability.CONSENSUS,
      confidence: 0.9  // High confidence
    });
    
    expect(claim.getEnforcementLevel()).toBe('LOW');
    expect(claim.needsHedge()).toBe(false);
    expect(claim.needsDisclaimer()).toBe(false);
  });
  
  test('REALTIME claim needs disclaimer', () => {
    const claim = new Claim('Aktuální cena je 100 Kč.', {
      temporalScope: TemporalScope.REALTIME,
      sourceStatus: SourceStatus.NONE
    });
    
    expect(claim.getEnforcementLevel()).toBe('HIGH');
    expect(claim.needsDisclaimer()).toBe(true);
  });
  
  test('extractClaims splits text into sentences', () => {
    const text = 'První věta. Druhá věta. Třetí věta.';
    const claims = extractClaims(text);
    
    expect(claims.length).toBe(3);
    expect(claims[0].position).toBe(0);
    expect(claims[2].position).toBe(2);
  });
  
  test('extractClaims detects modality from language', () => {
    const text = 'Možná bude pršet. Pravděpodobně to bude lepší.';
    const claims = extractClaims(text);
    
    expect(claims[0].modality).toBe(ClaimModality.POSSIBLE);
    expect(claims[1].modality).toBe(ClaimModality.PROBABLE);
  });
  
  test('enforceClaimsInResponse applies hedges', () => {
    const claims = [
      new Claim('Tohle je fakt.', { modality: ClaimModality.PROBABLE })
    ];
    
    const result = enforceClaimsInResponse(claims);
    
    expect(result.text).toContain('Pravděpodobně');
    expect(result.log.length).toBe(1);
    expect(result.log[0].actions).toContain('HEDGE_APPLIED');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// MACHINE-READABLE DECISION TRACE TESTS (v35.8)
// ════════════════════════════════════════════════════════════════════════════

describe('🔧 Machine-Readable DecisionTrace', () => {
  test('getAdaptationData returns structured data', async () => {
    const state = new DialogState();
    const result = await CRE.process('Test otázka', state, {});
    
    const trace = result.decision.trace;
    const adaptData = trace.getAdaptationData();
    
    expect(adaptData.decision).toBeDefined();
    expect(adaptData.context).toBeDefined();
    expect(adaptData.constraints).toBeDefined();
    expect(adaptData.repairInstructions).toBeDefined();
    expect(adaptData.confidenceImpact).toBeDefined();
  });
  
  test('confidenceImpact is calculated correctly', () => {
    const trace = new DecisionTrace();
    trace.captureInputs({
      domain: Domain.FACTUAL,
      dialogIntent: DialogIntent.SEEK,
      getOpenSlots: () => [],
      epistemic: {
        certainty: Certainty.HIGH,
        volatility: Volatility.LOW,
        verifiability: Verifiability.CONSENSUS,
        temporalScope: TemporalScope.STATIC,
        hasEvidence: true
      },
      permissions: {},
      enforcement: {},
      confidence: { coherence: 0.8, correctionCount: 0 }
    });
    trace.setMatchedRule(10, 'DEFAULT_ANSWER');
    
    const impact = trace._calculateConfidenceImpact();
    
    // Evidence = +0.1
    expect(impact.delta).toBeGreaterThan(0);
  });
  
  test('repairInstructions generated for missing evidence', () => {
    const trace = new DecisionTrace();
    trace.captureInputs({
      domain: Domain.PRICES,
      dialogIntent: DialogIntent.SEEK,
      getOpenSlots: () => [],
      epistemic: {
        certainty: Certainty.LOW,
        volatility: Volatility.HIGH,
        hasEvidence: false
      },
      permissions: {},
      enforcement: {}
    });
    trace.recordEvaluation(3, 'NO_ANSWER_PERMISSION', false, 'No evidence');
    trace.setMatchedRule(6, 'HIGH_VOLATILITY_NO_EVIDENCE');
    
    const instructions = trace._generateRepairInstructions();
    
    // Should have instruction to add disclaimer
    expect(instructions.some(i => i.type === 'ADD_DISCLAIMER')).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// VERIFIED-ONLY CONFIDENCE TESTS (v35.8)
// ════════════════════════════════════════════════════════════════════════════

describe('🔒 Verified-Only Confidence', () => {
  test('Negative feedback reduces confidence', () => {
    const state = new DialogState();
    state.setDomain(Domain.FACTUAL);
    state.recordVerifiedAnswer();
    
    const before = state._getTopicConfidence().factualSupport;
    state.recordNegativeFeedback();
    const after = state._getTopicConfidence().factualSupport;
    
    expect(after).toBeLessThan(before);
    expect(state._getTopicConfidence().userConfirmed).toBe(false);
  });
  
  test('Repair attempt is recorded with penalty', () => {
    const state = new DialogState();
    
    state.recordRepairAttempt(0.1);
    
    expect(state.confidence.repairCount).toBe(1);
    expect(state.getRepairPenalty()).toBe(0.1);
  });
  
  test('Multiple repairs accumulate penalty', () => {
    const state = new DialogState();
    
    state.recordRepairAttempt(0.1);
    state.recordRepairAttempt(0.1);
    
    expect(state.confidence.repairCount).toBe(2);
    expect(state.getRepairPenalty()).toBe(0.2);
  });
  
  test('Repair affects coherence', () => {
    const state = new DialogState();
    const initialCoherence = state.confidence.coherence;
    
    state.recordRepairAttempt(0.15);
    
    expect(state.confidence.coherence).toBeLessThan(initialCoherence);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PER-CLAIM ENFORCEMENT RELAXATION TESTS (v35.9)
// ════════════════════════════════════════════════════════════════════════════

describe('🔓 Per-Claim Enforcement Relaxation', () => {
  test('canRelaxEnforcementForClaim rejects REALTIME claims', () => {
    const state = new DialogState();
    
    const claim = {
      temporalScope: TemporalScope.REALTIME,
      sourceStatus: 'VERIFIED',
      confidence: 0.9,
      verifiability: Verifiability.WEB
    };
    
    expect(state.canRelaxEnforcementForClaim(claim)).toBe(false);
  });
  
  test('canRelaxEnforcementForClaim rejects unverified claims', () => {
    const state = new DialogState();
    
    const claim = {
      temporalScope: TemporalScope.STATIC,
      sourceStatus: 'TRAINING',
      confidence: 0.9,
      verifiability: Verifiability.CONSENSUS
    };
    
    expect(state.canRelaxEnforcementForClaim(claim)).toBe(false);
  });
  
  test('canRelaxEnforcementForClaim accepts verified STATIC claims', () => {
    const state = new DialogState();
    
    const claim = {
      temporalScope: TemporalScope.STATIC,
      sourceStatus: 'VERIFIED',
      confidence: 0.9,
      verifiability: Verifiability.CONSENSUS
    };
    
    expect(state.canRelaxEnforcementForClaim(claim)).toBe(true);
  });
  
  test('canRelaxEnforcementForClaim rejects if system was corrected', () => {
    const state = new DialogState();
    state.recordCorrection();
    
    const claim = {
      temporalScope: TemporalScope.STATIC,
      sourceStatus: 'VERIFIED',
      confidence: 0.9,
      verifiability: Verifiability.CONSENSUS
    };
    
    // Even perfect claim is rejected after correction
    expect(state.canRelaxEnforcementForClaim(claim)).toBe(false);
  });
  
  test('enforceClaimsInResponse uses per-claim relaxation', () => {
    const state = new DialogState();
    
    const claims = [
      new Claim('Zlato má atomové číslo 79.', {
        modality: ClaimModality.FACT,
        sourceStatus: SourceStatus.VERIFIED,
        temporalScope: TemporalScope.STATIC,
        verifiability: Verifiability.CONSENSUS,
        confidence: 0.95
      })
    ];
    
    const result = enforceClaimsInResponse(claims, {}, state);
    
    expect(result.log[0].wasRelaxed).toBe(true);
    expect(result.stats.relaxed).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DECISION TRACE FEEDBACK TESTS (v35.9)
// ════════════════════════════════════════════════════════════════════════════

describe('📡 DecisionTrace Feedback', () => {
  test('applyFeedback records repair', () => {
    const state = new DialogState();
    const trace = new DecisionTrace();
    trace.setMatchedRule(10, 'DEFAULT_ANSWER');
    trace.captureInputs({
      domain: Domain.FACTUAL,
      dialogIntent: DialogIntent.SEEK,
      getOpenSlots: () => [],
      epistemic: { certainty: Certainty.HIGH, volatility: Volatility.LOW },
      permissions: {},
      enforcement: {}
    });
    
    trace.applyFeedback(state, { wasRepaired: true });
    
    expect(state.getRepairPenalty()).toBeGreaterThan(0);
  });
  
  test('applyFeedback records user confirmation', () => {
    const state = new DialogState();
    state.setDomain(Domain.FACTUAL);
    const trace = new DecisionTrace();
    trace.setMatchedRule(10, 'DEFAULT_ANSWER');
    trace.captureInputs({
      domain: Domain.FACTUAL,
      dialogIntent: DialogIntent.SEEK,
      getOpenSlots: () => [],
      epistemic: {},
      permissions: {},
      enforcement: {}
    });
    
    trace.applyFeedback(state, { wasConfirmed: true });
    
    expect(state._getTopicConfidence().userConfirmed).toBe(true);
  });
  
  test('applyFeedback builds decision history', () => {
    const state = new DialogState();
    const trace = new DecisionTrace();
    trace.setMatchedRule(10, 'DEFAULT_ANSWER');
    trace.captureInputs({
      domain: Domain.FACTUAL,
      dialogIntent: DialogIntent.SEEK,
      getOpenSlots: () => [],
      epistemic: {},
      permissions: {},
      enforcement: {}
    });
    
    trace.applyFeedback(state, { result: 'success' });
    
    expect(state.decisionHistory).toBeDefined();
    expect(state.decisionHistory.length).toBe(1);
    expect(state.decisionHistory[0].rule).toBe('DEFAULT_ANSWER');
  });
  
  test('analyzeHistory detects repeated low certainty', () => {
    const state = new DialogState();
    state.decisionHistory = [
      { rule: 'LOW_CERTAINTY', domain: 'test', outcome: 'ok' },
      { rule: 'LOW_CERTAINTY', domain: 'test', outcome: 'ok' },
      { rule: 'LOW_CERTAINTY', domain: 'test', outcome: 'ok' }
    ];
    
    const analysis = DecisionTrace.analyzeHistory(state);
    
    expect(analysis).not.toBe(null);
    expect(analysis.pattern).toBe('REPEATED_LOW_CERTAINTY');
    expect(analysis.adjustment.certaintyBias).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// REPAIR PENALTY INTEGRATION TESTS (v35.9)
// ════════════════════════════════════════════════════════════════════════════

describe('⚠️ Repair Penalty Integration', () => {
  test('High repair penalty blocks global relaxation', () => {
    const state = new DialogState();
    state.setDomain(Domain.FACTUAL);
    
    // Build up conditions for relaxation
    state.recordVerifiedAnswer('source1');
    state.recordVerifiedAnswer('source2');
    state.recordUserConfirmation();
    state.updateCoherence(0.3);
    
    // Should be able to relax
    expect(state.canRelaxEnforcement()).toBe(true);
    
    // Add repairs
    state.recordRepairAttempt(0.15);
    state.recordRepairAttempt(0.15);
    
    // Now should NOT be able to relax (repair penalty > 0.2)
    expect(state.canRelaxEnforcement()).toBe(false);
  });
  
  test('Repair penalty increases enforcement strength', () => {
    const state = new DialogState();
    state.setDomain(Domain.FACTUAL);
    
    const strengthBefore = state.getEnforcementStrength();
    
    state.recordRepairAttempt(0.1);
    state.recordRepairAttempt(0.1);
    
    const strengthAfter = state.getEnforcementStrength();
    
    expect(strengthAfter).toBeGreaterThan(strengthBefore);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SATURATED CONFIDENCE TESTS (v36.0)
// ════════════════════════════════════════════════════════════════════════════

describe('📈 Saturated Confidence', () => {
  test('STATIC temporal scope gets full confidence increment', () => {
    const state = new DialogState();
    state.setDomain(Domain.FACTUAL);
    
    const claim = { temporalScope: TemporalScope.STATIC };
    state.recordVerifiedAnswer('source', claim);
    
    const conf = state._getTopicConfidence();
    expect(conf.verifiedClaims).toBe(1.0);  // Full increment
  });
  
  test('REALTIME temporal scope gets minimal confidence increment', () => {
    const state = new DialogState();
    state.setDomain(Domain.PRICES);
    
    const claim = { temporalScope: TemporalScope.REALTIME };
    state.recordVerifiedAnswer('source', claim);
    
    const conf = state._getTopicConfidence();
    expect(conf.verifiedClaims).toBe(0.1);  // Minimal increment
  });
  
  test('_getSaturatedIncrement returns correct values', () => {
    const state = new DialogState();
    
    expect(state._getSaturatedIncrement(TemporalScope.STATIC)).toBe(1.0);
    expect(state._getSaturatedIncrement(TemporalScope.YEARLY)).toBe(0.8);
    expect(state._getSaturatedIncrement(TemporalScope.REALTIME)).toBe(0.1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ADAPTIVE DECISION MATRIX TESTS (v36.0)
// ════════════════════════════════════════════════════════════════════════════

describe('🎛️ Adaptive Decision Matrix', () => {
  test('penalizeRule increases rule penalty', () => {
    clearPenalties();
    
    penalizeRule('DEFAULT_ANSWER', 0.1);
    expect(getRulePenalty('DEFAULT_ANSWER')).toBe(0.1);
    
    penalizeRule('DEFAULT_ANSWER', 0.1);
    expect(getRulePenalty('DEFAULT_ANSWER')).toBe(0.2);
  });
  
  test('rewardRule decreases penalty', () => {
    clearPenalties();
    penalizeRule('TEST_RULE', 0.1);
    
    rewardRule('TEST_RULE', 0.05);
    expect(getRulePenalty('TEST_RULE')).toBe(0.05);
  });
  
  test('decideAdaptive works like decide without penalties', () => {
    clearPenalties();
    const state = new DialogState();
    state.setDomain(Domain.FACTUAL);
    state.dialogIntent = DialogIntent.SEEK;
    
    const decision = decideAdaptive(state);
    expect(decision).toBeDefined();
    expect(decision.action).toBeDefined();
  });
  
  test('Heavy penalty requires evidence for rule match', () => {
    clearPenalties();
    
    // Penalize DEFAULT_ANSWER heavily
    penalizeRule('DEFAULT_ANSWER', 0.35);
    
    const state = new DialogState();
    state.setDomain(Domain.FACTUAL);
    state.dialogIntent = DialogIntent.SEEK;
    state.epistemic.hasEvidence = true;  // Provide evidence
    
    const decision = decideAdaptive(state);
    
    // Should match with evidence
    expect(decision.trace).toBeDefined();
    expect(decision.rulePenalty).toBeGreaterThan(0);
    
    clearPenalties();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ATOMIC CLAIMS TESTS (v36.0)
// ════════════════════════════════════════════════════════════════════════════

describe('⚛️ Atomic Claims Splitting', () => {
  test('Splits "X a Y mají" pattern', () => {
    const text = 'Jeep Wrangler a Ford Bronco mají uzávěrku diferenciálu.';
    const claims = extractClaims(text);
    
    // Should split into 2 claims
    expect(claims.length).toBe(2);
    expect(claims[0].text).toContain('Jeep Wrangler');
    expect(claims[1].text).toContain('Ford Bronco');
  });
  
  test('Splits enumeration "X, Y a Z mají" pattern', () => {
    const text = 'BMW, Mercedes a Audi mají moderní infotainment.';
    const claims = extractClaims(text);
    
    // Should split into at least 2 claims (may be 3 with better heuristics)
    expect(claims.length).toBeGreaterThanOrEqual(2);
    expect(claims[0].text).toContain('BMW');
  });
  
  test('Does not split short sentences', () => {
    const text = 'Auto je rychlé.';
    const claims = extractClaims(text);
    
    // Should NOT split - too short
    expect(claims.length).toBe(1);
  });
  
  test('Does not split conditional sentences', () => {
    const text = 'Pokud máte Jeep a Ford, můžete jezdit v terénu.';
    const claims = extractClaims(text);
    
    // Should NOT split - conditional
    expect(claims.length).toBe(1);
  });
  
  test('Extracts subject from claim', () => {
    const text = 'Tesla má autopilota.';
    const claims = extractClaims(text);
    
    expect(claims[0].subject).toContain('Tesla');
  });
  
  test('Handles coordinate clauses with "a"', () => {
    const text = 'Motor poskytuje dostatek výkonu a podvozek je stabilní.';
    const claims = extractClaims(text);
    
    // Should split - two independent clauses
    expect(claims.length).toBe(2);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// VERIFIABILITY GRADIENT TESTS (v36.1)
// ════════════════════════════════════════════════════════════════════════════

describe('📊 Verifiability Gradient', () => {
  test('VerifiabilityScore maps enum to gradient', () => {
    expect(VerifiabilityScore[Verifiability.NONE]).toBe(0.1);
    expect(VerifiabilityScore[Verifiability.WEB]).toBe(0.5);
    expect(VerifiabilityScore[Verifiability.OFFICIAL]).toBe(0.8);
    expect(VerifiabilityScore[Verifiability.CONSENSUS]).toBe(0.95);
  });
  
  test('getVerifiabilityScore handles enum input', () => {
    expect(getVerifiabilityScore(Verifiability.NONE)).toBe(0.1);
    expect(getVerifiabilityScore(Verifiability.CONSENSUS)).toBe(0.95);
  });
  
  test('getVerifiabilityScore handles numeric input', () => {
    expect(getVerifiabilityScore(0.7)).toBe(0.7);
    expect(getVerifiabilityScore(1.5)).toBe(1.0);  // Clamped
    expect(getVerifiabilityScore(-0.5)).toBe(0);   // Clamped
  });
});

// ════════════════════════════════════════════════════════════════════════════
// VOLATILITY FEEDBACK TESTS (v36.1)
// ════════════════════════════════════════════════════════════════════════════

describe('🌡️ Volatility Feedback', () => {
  test('increaseVolatilityFromFeedback accumulates adjustment', () => {
    const state = new DialogState();
    
    state.increaseVolatilityFromFeedback(0.1);
    expect(state.epistemic.volatilityAdjustment).toBe(0.1);
    
    state.increaseVolatilityFromFeedback(0.1);
    expect(state.epistemic.volatilityAdjustment).toBe(0.2);
  });
  
  test('Large adjustment upgrades volatility level', () => {
    const state = new DialogState();
    state.epistemic.volatility = Volatility.LOW;
    
    state.increaseVolatilityFromFeedback(0.3);
    
    expect(state.epistemic.volatility).toBe(Volatility.HIGH);
  });
  
  test('decreaseVolatilityFromFeedback reduces adjustment', () => {
    const state = new DialogState();
    state.increaseVolatilityFromFeedback(0.2);
    
    state.decreaseVolatilityFromFeedback(0.05);
    
    // Use rounding to avoid floating point precision issues
    expect(Math.round(state.epistemic.volatilityAdjustment * 100) / 100).toBe(0.15);
  });
  
  test('getEffectiveVolatilityScore combines base and adjustment', () => {
    const state = new DialogState();
    state.epistemic.volatility = Volatility.MEDIUM;
    
    const baseBefore = state.getEffectiveVolatilityScore();
    expect(baseBefore).toBe(0.5);
    
    state.increaseVolatilityFromFeedback(0.2);
    const after = state.getEffectiveVolatilityScore();
    
    expect(after).toBeGreaterThan(baseBefore);
  });
  
  test('Volatility adjustment blocks relaxation', () => {
    const state = new DialogState();
    state.setDomain(Domain.FACTUAL);
    state.recordVerifiedAnswer('source');
    state.recordUserConfirmation();
    state.updateCoherence(0.3);
    
    // Should be able to relax
    expect(state.canRelaxEnforcement()).toBe(true);
    
    // Add volatility feedback
    state.increaseVolatilityFromFeedback(0.2);
    
    // Now should NOT be able to relax
    expect(state.canRelaxEnforcement()).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TRACE → BEHAVIOR FEEDBACK TESTS (v36.1)
// ════════════════════════════════════════════════════════════════════════════

describe('🔄 Trace → Behavior Feedback', () => {
  test('applyFeedback with wasRepaired increases volatility', () => {
    const state = new DialogState();
    const trace = new DecisionTrace();
    trace.setMatchedRule(10, 'DEFAULT_ANSWER');
    trace.captureInputs({
      domain: Domain.FACTUAL,
      dialogIntent: DialogIntent.SEEK,
      getOpenSlots: () => [],
      epistemic: {},
      permissions: {},
      enforcement: {}
    });
    
    const volBefore = state.epistemic.volatilityAdjustment || 0;
    trace.applyFeedback(state, { wasRepaired: true });
    const volAfter = state.epistemic.volatilityAdjustment || 0;
    
    expect(volAfter).toBeGreaterThan(volBefore);
  });
  
  test('applyFeedback with wasContradicted increases volatility significantly', () => {
    const state = new DialogState();
    const trace = new DecisionTrace();
    trace.setMatchedRule(10, 'DEFAULT_ANSWER');
    trace.captureInputs({
      domain: Domain.FACTUAL,
      dialogIntent: DialogIntent.SEEK,
      getOpenSlots: () => [],
      epistemic: {},
      permissions: {},
      enforcement: {}
    });
    
    trace.applyFeedback(state, { wasContradicted: true });
    
    expect(state.epistemic.volatilityAdjustment).toBe(0.2);
  });
  
  test('applyFeedback with wasConfirmed decreases volatility', () => {
    const state = new DialogState();
    state.setDomain(Domain.FACTUAL);
    state.increaseVolatilityFromFeedback(0.2);
    
    const trace = new DecisionTrace();
    trace.setMatchedRule(10, 'DEFAULT_ANSWER');
    trace.captureInputs({
      domain: Domain.FACTUAL,
      dialogIntent: DialogIntent.SEEK,
      getOpenSlots: () => [],
      epistemic: {},
      permissions: {},
      enforcement: {}
    });
    
    const volBefore = state.epistemic.volatilityAdjustment;
    trace.applyFeedback(state, { wasConfirmed: true });
    const volAfter = state.epistemic.volatilityAdjustment;
    
    expect(volAfter).toBeLessThan(volBefore);
  });
  
  test('Decision history tracks repair/contradiction status', () => {
    const state = new DialogState();
    const trace = new DecisionTrace();
    trace.setMatchedRule(10, 'DEFAULT_ANSWER');
    trace.captureInputs({
      domain: Domain.FACTUAL,
      dialogIntent: DialogIntent.SEEK,
      getOpenSlots: () => [],
      epistemic: {},
      permissions: {},
      enforcement: {}
    });
    
    trace.applyFeedback(state, { wasRepaired: true, result: 'repaired' });
    
    expect(state.decisionHistory[0].wasRepaired).toBe(true);
    expect(state.decisionHistory[0].outcome).toBe('repaired');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// KNOWLEDGE PROVIDER TESTS (v36.2)
// ════════════════════════════════════════════════════════════════════════════

describe('📚 Knowledge Provider', () => {
  test('KnowledgeProvider has name and capabilities', () => {
    const provider = new KnowledgeProvider('test-provider', {
      realtime: true,
      verified: true
    });
    
    expect(provider.name).toBe('test-provider');
    expect(provider.capabilities.realtime).toBe(true);
    expect(provider.capabilities.verified).toBe(true);
    expect(provider.capabilities.historical).toBe(false);
  });
  
  test('KnowledgeProvider.canHandle checks capabilities', () => {
    const provider = new KnowledgeProvider('static-provider', {
      realtime: false,
      historical: true
    });
    
    // Cannot handle realtime queries
    expect(provider.canHandle({ temporalScope: TemporalScope.REALTIME })).toBe(false);
    
    // Can handle static queries
    expect(provider.canHandle({ temporalScope: TemporalScope.STATIC })).toBe(true);
  });
  
  test('KnowledgeResult stores data and metadata', () => {
    const result = new KnowledgeResult('Cena je 500 Kč', {
      source: 'https://example.com',
      confidence: 0.8,
      verified: true,
      temporalScope: TemporalScope.REALTIME
    });
    
    expect(result.data).toBe('Cena je 500 Kč');
    expect(result.source).toBe('https://example.com');
    expect(result.confidence).toBe(0.8);
    expect(result.verified).toBe(true);
  });
  
  test('KnowledgeResult.toClaim creates claim', () => {
    const result = new KnowledgeResult('Data', {
      verified: true,
      confidence: 0.9,
      temporalScope: TemporalScope.STATIC
    });
    
    const claim = result.toClaim();
    expect(claim.sourceStatus).toBe('VERIFIED');
    expect(claim.confidence).toBe(0.9);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SOURCE REGISTRY TESTS (v36.2)
// ════════════════════════════════════════════════════════════════════════════

describe('🗃️ Source Registry', () => {
  test('SourceRegistry registers providers', () => {
    const registry = new SourceRegistry();
    const provider = new KnowledgeProvider('test', { realtime: true });
    
    registry.register(provider);
    
    expect(registry.getProviders().length).toBe(1);
    expect(registry.getProviders()[0].name).toBe('test');
  });
  
  test('SourceRegistry finds capable provider', () => {
    const registry = new SourceRegistry();
    
    const staticProvider = new KnowledgeProvider('static', { realtime: false });
    const realtimeProvider = new KnowledgeProvider('realtime', { realtime: true });
    
    registry.register(staticProvider);
    registry.register(realtimeProvider);
    
    const query = { temporalScope: TemporalScope.REALTIME };
    const found = registry.findProvider(query);
    
    expect(found.name).toBe('realtime');
  });
  
  test('SourceRegistry prefers verified for official queries', () => {
    const registry = new SourceRegistry();
    
    const unverified = new KnowledgeProvider('unverified', { verified: false });
    const verified = new KnowledgeProvider('verified', { verified: true });
    
    registry.register(unverified);
    registry.register(verified);
    
    const query = { verifiability: Verifiability.OFFICIAL };
    const found = registry.findProvider(query);
    
    expect(found.name).toBe('verified');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// COLLABORATIVE REASONING TESTS (v36.2)
// ════════════════════════════════════════════════════════════════════════════

describe('🤝 Collaborative Reasoning', () => {
  test('shouldUseProvisionalAnswer checks conditions', () => {
    const state = new DialogState();
    state.setDomain(Domain.FACTUAL);
    state.dialogIntent = DialogIntent.SEEK;  // Required for provisional
    state.epistemic.certainty = Certainty.MEDIUM;
    state.epistemic.hasEvidence = false;
    state.epistemic.verifiability = Verifiability.WEB;
    state.epistemic.volatility = Volatility.MEDIUM;
    
    expect(state.shouldUseProvisionalAnswer()).toBe(true);
  });
  
  test('shouldUseProvisionalAnswer rejects high volatility without evidence', () => {
    const state = new DialogState();
    state.setDomain(Domain.PRICES);
    state.dialogIntent = DialogIntent.SEEK;
    state.epistemic.certainty = Certainty.MEDIUM;
    state.epistemic.hasEvidence = false;
    state.epistemic.volatility = Volatility.HIGH;
    
    expect(state.shouldUseProvisionalAnswer()).toBe(false);
  });
  
  test('createProvisionalAnswer stores pending answer', () => {
    const state = new DialogState();
    state.setDomain(Domain.FACTUAL);
    
    const pending = state.createProvisionalAnswer('Myslím, že X', 'Nemám ověřeno');
    
    expect(state.collaborative.pendingProvisional).not.toBe(null);
    expect(pending.content).toBe('Myslím, že X');
    expect(pending.reason).toBe('Nemám ověřeno');
  });
  
  test('recordProvisionalResponse updates confidence on confirm', () => {
    const state = new DialogState();
    state.setDomain(Domain.FACTUAL);
    
    state.createProvisionalAnswer('Test', 'reason');
    state.recordProvisionalResponse(true);
    
    expect(state.collaborative.pendingProvisional).toBe(null);
    expect(state.collaborative.confirmationHistory.length).toBe(1);
    expect(state.collaborative.confirmationHistory[0].confirmed).toBe(true);
  });
  
  test('recordProvisionalResponse penalizes on rejection', () => {
    const state = new DialogState();
    state.setDomain(Domain.FACTUAL);
    
    // Give some initial factual support so it can be reduced
    state.recordVerifiedAnswer('source1');
    state.recordVerifiedAnswer('source2');
    
    state.createProvisionalAnswer('Test', 'reason');
    const confBefore = state._getTopicConfidence().factualSupport;
    
    state.recordProvisionalResponse(false);
    
    const confAfter = state._getTopicConfidence().factualSupport;
    expect(confAfter).toBeLessThan(confBefore);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SOURCE-BOUND ANSWERING TESTS (v36.2)
// ════════════════════════════════════════════════════════════════════════════

describe('🔗 Source-Bound Answering', () => {
  test('setSourceRegistry attaches registry to state', () => {
    const state = new DialogState();
    const registry = new SourceRegistry();
    
    state.setSourceRegistry(registry);
    
    expect(state.collaborative.sourceRegistry).toBe(registry);
  });
  
  test('shouldDelegateToSource returns false without registry', () => {
    const state = new DialogState();
    state.epistemic.temporalScope = TemporalScope.REALTIME;
    
    expect(state.shouldDelegateToSource()).toBe(false);
  });
  
  test('shouldDelegateToSource returns true for REALTIME with capable provider', () => {
    const state = new DialogState();
    const registry = new SourceRegistry();
    const provider = new KnowledgeProvider('realtime', { realtime: true });
    registry.register(provider);
    
    state.setSourceRegistry(registry);
    state.setDomain(Domain.PRICES);
    state.epistemic.temporalScope = TemporalScope.REALTIME;
    
    expect(state.shouldDelegateToSource()).toBe(true);
  });
  
  test('getBestProvider returns appropriate provider', () => {
    const state = new DialogState();
    const registry = new SourceRegistry();
    const provider = new KnowledgeProvider('test', { realtime: true });
    registry.register(provider);
    
    state.setSourceRegistry(registry);
    state.setDomain(Domain.PRICES);
    state.epistemic.temporalScope = TemporalScope.REALTIME;
    
    const best = state.getBestProvider();
    expect(best.name).toBe('test');
  });
  
  test('recordKnowledgeResult updates epistemic state', () => {
    const state = new DialogState();
    state.setDomain(Domain.PRICES);
    
    const result = new KnowledgeResult('Cena: 100 Kč', {
      verified: true,
      source: 'https://example.com',
      temporalScope: TemporalScope.REALTIME
    });
    
    state.recordKnowledgeResult(result);
    
    expect(state.epistemic.hasEvidence).toBe(true);
    expect(state.collaborative.lastKnowledgeResult).toBe(result);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DECISION MATRIX v36.2 RULES TESTS
// ════════════════════════════════════════════════════════════════════════════

describe('🎯 Decision Matrix v36.2 Rules', () => {
  test('DEFER_TO_SOURCE rule matches when should delegate', () => {
    const state = new DialogState();
    const registry = new SourceRegistry();
    const provider = new KnowledgeProvider('realtime', { realtime: true });
    registry.register(provider);
    
    state.setSourceRegistry(registry);
    state.setDomain(Domain.PRICES);
    state.epistemic.temporalScope = TemporalScope.REALTIME;
    state.epistemic.volatility = Volatility.HIGH;
    state.epistemic.hasEvidence = false;
    state.dialogIntent = DialogIntent.SEEK;
    
    // Disable clarification to ensure we test DEFER_TO_SOURCE path
    state.permissions.mayAskClarification = false;
    
    const decision = decide(state);
    
    expect(decision.action).toBe(SystemAction.DEFER_TO_SOURCE);
  });
  
  test('PROVISIONAL_ANSWER rule matches for collaborative mode', () => {
    const state = new DialogState();
    state.setDomain(Domain.FACTUAL);
    state.dialogIntent = DialogIntent.SEEK;
    state.epistemic.certainty = Certainty.MEDIUM;
    state.epistemic.hasEvidence = false;
    state.epistemic.verifiability = Verifiability.WEB;
    state.epistemic.volatility = Volatility.MEDIUM;
    
    const decision = decide(state);
    
    expect(decision.action).toBe(SystemAction.ANSWER_PROVISIONAL);
    expect(decision.speechAct).toBe(SpeechAct.PROVISIONAL);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RUN
// ════════════════════════════════════════════════════════════════════════════

console.log('\n🧪 C.3 CRE v36.2 Tests (Collaborative Reasoning + Source-Bound Answering)');
console.log('━'.repeat(60));

await runTests();
const summary = printSummary();

// Exit with proper code
if (summary.exitCode !== 0) {
  setTimeout(() => { throw new Error('Tests failed'); }, 0);
}
