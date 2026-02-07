# CRE v36.2 Architecture Documentation

## Conversational Reasoning Engine

**Version:** v36.2  
**Status:** Production-ready architecture  
**Date:** January 2026

---

## 📋 Executive Summary

CRE (Conversational Reasoning Engine) is an authoritative dialog management system that:

1. **Controls LLM behavior** - CRE is the authority, LLM is the text generator
2. **Maintains epistemic correctness** - System knows what it knows and doesn't know
3. **Enables collaborative reasoning** - Can ask for confirmation when uncertain
4. **Separates concerns** - When to delegate vs. how to fetch

---

## 🏗️ Core Architecture

### Layer Stack

```
┌─────────────────────────────────────────────────────────────┐
│                    User Interface                            │
├─────────────────────────────────────────────────────────────┤
│                 Answer Quality Gate                          │
│              (form enforcement, no fact changes)             │
├─────────────────────────────────────────────────────────────┤
│                   Decision Matrix                            │
│           (priority rules → action + speechAct)              │
├─────────────────────────────────────────────────────────────┤
│                    Dialog State                              │
│     (slots, epistemic, permissions, enforcement)             │
├─────────────────────────────────────────────────────────────┤
│                   Detection Layer                            │
│        (intent, domain, volatility, slots)                   │
├─────────────────────────────────────────────────────────────┤
│                  Knowledge Providers                         │
│           (external sources, CRE decides WHEN)               │
└─────────────────────────────────────────────────────────────┘
```

---

## 📦 Core Components

### 1. DialogState

The authoritative source of truth for conversation state.

```javascript
class DialogState {
  // Domain & Intent
  domain: Domain           // PRICES, WEATHER, ASTRONOMICAL, etc.
  dialogIntent: DialogIntent  // SEEK, CONFIRM, CHALLENGE, etc.
  
  // Slot-based facts
  slots: Map<string, Slot>   // key → { value, confidence, source, locked }
  
  // Epistemic state
  epistemic: {
    certainty: Certainty,      // LOW, MEDIUM, HIGH
    volatility: Volatility,    // LOW, MEDIUM, HIGH
    verifiability: Verifiability,  // NONE, WEB, OFFICIAL, CONSENSUS
    temporalScope: TemporalScope,  // STATIC, YEARLY, MONTHLY, REALTIME
    hasEvidence: boolean,
    reasoningDepth: ReasoningDepth,
    answerMode: AnswerMode,
    volatilityAdjustment: number  // Feedback-driven adjustment
  }
  
  // Topic-scoped confidence
  confidence: {
    coherence: number,        // Global dialog coherence
    correctionCount: number,  // How many times corrected
    byTopic: Map<domain, TopicConfidence>
  }
  
  // Permissions (LLM cannot override)
  permissions: {
    mayAnswer: boolean,
    mayGuess: boolean,
    mayAskClarification: boolean,
    mayUseArtifact: boolean,
    maySearchWeb: boolean
  }
  
  // Enforcement (hard rules for output)
  enforcement: {
    requireDisclaimer: boolean,
    forbidNumbers: boolean,
    forbidDates: boolean,
    forbidPrices: boolean,
    requiredSpeechAct: SpeechAct
  }
  
  // Collaborative reasoning (v36.2)
  collaborative: {
    pendingProvisional: ProvisionalAnswer,
    confirmationHistory: ConfirmationRecord[],
    sourceRegistry: SourceRegistry,
    lastKnowledgeResult: KnowledgeResult
  }
}
```

### 2. Decision Matrix

Priority-ordered rules that map state → action.

```javascript
// Rule structure
{
  name: string,
  test: (state) => boolean,
  whyNot: (state) => string,  // Negative reasoning
  action: SystemAction,
  reason: string,
  speechAct: SpeechAct
}

// Priority order (first match wins)
P1:  DOMAIN_CHANGED → RESET_CONTEXT
P2:  CORRECTION_MODE → CORRECT_PREVIOUS
P3:  CONFIRM_INTENT → CONFIRM_CONTEXT
P4:  NO_ANSWER_PERMISSION → DEFER_TO_SEARCH
P5:  OPEN_SLOTS_EVIDENCE_REQUIRED → ASK_CLARIFICATION
P5.5: DEFER_TO_SOURCE → delegate to provider  // v36.2
P6:  ANSWER_WITH_BOUNDS → conditional answer
P7:  OPEN_SLOTS → ASK_CLARIFICATION
P8:  HIGH_VOLATILITY_NO_EVIDENCE → ANSWER_STRUCTURAL
P9:  LOW_CERTAINTY → ANSWER_WITH_DISCLAIMER
P9.5: PROVISIONAL_ANSWER → collaborative confirm  // v36.2
P10: MEDIUM_CERTAINTY_DISCLAIMER → ANSWER_WITH_DISCLAIMER
P11: EXPLORE_INTENT → SUGGESTION
P12: DEFAULT_ANSWER → ANSWER as FACT
```

### 3. Answer Quality Gate

Post-processing layer for form enforcement.

```javascript
// Validates:
- Empty responses
- Overly confident language in LOW certainty
- Missing disclaimers when required
- Too much content for CONFIRM responses

// Does NOT:
- Change facts
- Override decisions
- Add new information
```

### 4. Claim Model

Per-claim epistemic tracking.

```javascript
class Claim {
  text: string
  modality: ClaimModality     // CERTAIN, PROBABLE, POSSIBLE, UNKNOWN
  sourceStatus: SourceStatus  // VERIFIED, INFERRED, UNVERIFIED
  temporalScope: TemporalScope
  confidence: number          // 0-1
  subject: string             // Extracted subject
}

// Per-claim relaxation
canRelaxEnforcementForClaim(claim) {
  if (claim.temporalScope === REALTIME) return false;
  if (claim.sourceStatus !== VERIFIED) return false;
  if (correctionCount > 0) return false;
  return true;
}
```

### 5. Knowledge Provider (v36.2)

Abstract interface for external knowledge sources.

```javascript
class KnowledgeProvider {
  name: string
  capabilities: {
    realtime: boolean,
    historical: boolean,
    verified: boolean,
    structured: boolean
  }
  
  canHandle(query): boolean
  fetch(query, context): Promise<KnowledgeResult>
  getConfidence(): number
}

class SourceRegistry {
  register(provider, isDefault?)
  findProvider(query): KnowledgeProvider
  hasCapableProvider(query): boolean
}
```

---

## 🎯 Key Design Decisions

### 1. CRE is Authority, LLM is Generator

```
WRONG: LLM decides → CRE validates
RIGHT: CRE decides → LLM generates → AQG enforces
```

LLM has NO authority to:
- Override permissions
- Change certainty levels
- Skip disclaimers
- Claim facts without evidence

### 2. Confidence is Topic-Scoped

```javascript
// WRONG: Global confidence
confidence: 0.8  // Applies to everything

// RIGHT: Per-topic confidence
confidence.byTopic.get('astronomical').factualSupport = 0.8
confidence.byTopic.get('prices').factualSupport = 0.2
```

### 3. Saturated Confidence Increments

Different temporal scopes get different confidence boosts:

```javascript
_getSaturatedIncrement(temporalScope) {
  return {
    STATIC: 1.0,     // Timeless facts → full increment
    YEARLY: 0.8,     // Astronomy, taxes
    MONTHLY: 0.5,    // Monthly data
    DAILY: 0.3,      // Daily data
    REALTIME: 0.1    // Prices, weather → minimal
  }[temporalScope];
}
```

### 4. Trace Affects Future Behavior

DecisionTrace isn't just logging - it affects future decisions:

```javascript
applyFeedback(state, outcome) {
  if (outcome.wasRepaired) {
    state.increaseVolatilityFromFeedback(0.1);
  }
  if (outcome.wasContradicted) {
    state.increaseVolatilityFromFeedback(0.2);
  }
  if (outcome.wasConfirmed) {
    state.decreaseVolatilityFromFeedback(0.05);
  }
}
```

### 5. Verifiability is Gradient

```javascript
// Categorical enum for compatibility
Verifiability.NONE      // 0.1
Verifiability.WEB       // 0.5
Verifiability.OFFICIAL  // 0.8
Verifiability.CONSENSUS // 0.95

// Gradient for Decision Matrix thresholds
getVerifiabilityScore(verifiability) → 0..1
```

### 6. CRE Decides WHEN, Provider Decides HOW

```javascript
// CRE decision
if (shouldDelegateToSource()) {
  return DEFER_TO_SOURCE;
}

// Provider execution (separate)
const provider = getBestProvider();
const result = await provider.fetch(query);
recordKnowledgeResult(result);
```

---

## 🔄 Flow Diagrams

### Basic Decision Flow

```
User Message
    │
    ▼
┌─────────────────┐
│ Detection Layer │
│ • detectIntent  │
│ • detectDomain  │
│ • extractSlots  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Update State   │
│ • Fill slots    │
│ • Set epistemic │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Decision Matrix │
│ • Test rules    │
│ • First match   │
│ • Create trace  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  LLM Generate   │
│ (guided by      │
│  decision)      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Quality Gate    │
│ • Validate      │
│ • Enforce       │
└────────┬────────┘
         │
         ▼
    Response
```

### Collaborative Reasoning Flow (v36.2)

```
User Question
    │
    ▼
┌─────────────────────┐
│ shouldDelegate?     │──yes──▶ DEFER_TO_SOURCE
└──────────┬──────────┘              │
           │ no                      ▼
           ▼                   ┌─────────────┐
┌─────────────────────┐        │ Fetch from  │
│ shouldProvisional?  │        │ Provider    │
└──────────┬──────────┘        └──────┬──────┘
           │ yes                      │
           ▼                          ▼
┌─────────────────────┐        ┌─────────────┐
│ ANSWER_PROVISIONAL  │        │ Record      │
│ "X... souhlasíš?"   │        │ Knowledge   │
└──────────┬──────────┘        └──────┬──────┘
           │                          │
           ▼                          ▼
┌─────────────────────┐        Re-decide with
│ User Confirms/      │        new evidence
│ Rejects             │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ recordProvisional   │
│ Response            │
│ • Adjust confidence │
│ • Clear pending     │
└─────────────────────┘
```

---

## 📊 Enums Reference

### Domain
```
UNKNOWN, PRICES, WEATHER, ASTRONOMICAL, FACTUAL, HISTORICAL, TECHNICAL
```

### DialogIntent
```
SEEK, BUILD, CONFIRM, CHALLENGE, EXPLORE, COMMAND
```

### SystemAction
```
ANSWER, ANSWER_WITH_DISCLAIMER, ANSWER_STRUCTURAL, ANSWER_WITH_BOUNDS,
ANSWER_PROVISIONAL, ASK_CLARIFICATION, REFUSE, CONFIRM_CONTEXT,
CORRECT_PREVIOUS, DEFER_TO_SEARCH, DEFER_TO_SOURCE, RESET_CONTEXT
```

### SpeechAct
```
FACT, ESTIMATE, HYPOTHESIS, SUGGESTION, QUESTION, REFUSAL,
CONFIRMATION, CONDITIONAL, PROVISIONAL
```

### Certainty / Volatility
```
LOW, MEDIUM, HIGH
```

### Verifiability
```
NONE (0.1), WEB (0.5), OFFICIAL (0.8), CONSENSUS (0.95)
```

### TemporalScope
```
STATIC, YEARLY, MONTHLY, REALTIME
```

---

## 🧪 Testing Strategy

### 6 Test Dimensions

1. **Epistemic correctness** - System knows what it knows
2. **Context integrity** - No leakage between topics
3. **Reasoning discipline** - No hallucination
4. **User intent alignment** - Correct interpretation
5. **Confirmation & collaboration** - Proper uncertainty handling
6. **Failure handling** - Graceful degradation

### Test Classes

| Class | Focus | Examples |
|-------|-------|----------|
| A | Hard Facts | Time-sensitive data, sources |
| B | Hallucination | Non-existent entities, pseudoscience |
| C | Context | Progressive refinement, topic changes |
| D | Correction | User corrections, frustration |
| E | Collaboration | Provisional answers, confirmation |
| F | Abuse | Artifact bait, certainty pressure |

### Metrics Per Test

```javascript
{
  decisionTrace: DecisionTrace,
  speechAct: SpeechAct,
  epistemic: { certainty, volatility, verifiability, temporalScope },
  contextDelta: { slotsAdded, domainChanged },
  confidenceDelta: { before, after, delta },
  enforcementApplied: boolean,
  dimensions: string[]  // Which dimensions tested
}
```

---

## 📈 Version History

| Version | Key Changes |
|---------|-------------|
| v35.x | Policy wrapper, basic guards |
| v36.0 | First real CRE, saturated confidence, adaptive matrix |
| v36.1 | Verifiability gradient, volatility feedback |
| v36.2 | Collaborative reasoning, source-bound answering |

---

## 🔮 Future Roadmap

### v36.3 - Confirmation Semantics
- Types of confirmation: full / partial / reject
- Weighted confidence updates based on confirmation type

### v36.4 - Epistemic Style Guide
- Centralized text templates
- Consistent disclaimer language
- No logic changes

### v37 - External Verification Loop
- "I'll verify and return" pattern
- Async reasoning
- IO orchestration

---

## 📚 File Structure

```
src/chat/
├── dialog-state-v2.js     # Core state, enums, providers
├── decision-matrix.js     # Priority rules
├── answer-quality-gate.js # Form enforcement
├── claim-model.js         # Per-claim tracking
├── cre-v2.js             # Detection functions
├── chat-guards.js        # Legacy guards
└── correction-enforcer.js # Correction handling

src/tests/
├── cre-v2.test.js        # Unit tests (141)
├── cre-v36-e2e.test.js   # E2E tests (20)
├── chat-llm-*.js         # LLM integration tests
└── e2e-runner.js         # Test framework
```

---

## ⚠️ Known Limitations

### Current

1. **Astronomical data** - Treated same as other factual data, should require evidence
2. **Far future dates** - No enhanced volatility for 2042 vs 2026
3. **Frustration detection** - "jsi úplně mimo" not detected as CHALLENGE
4. **Certainty demands** - No special handling for "100%" requests

### By Design

1. **No ML** - All decisions are rule-based and auditable
2. **No persistence** - State resets between sessions
3. **No external calls** - CRE only decides WHEN, not HOW

---

## 🏆 Key Principles

1. **CRE is the judge, not the moderator**
2. **Confidence ≠ truth** - High confidence can be wrong
3. **Per-topic isolation** - Good moon knowledge doesn't help GPU prices
4. **Trace affects future** - Corrections make system more careful
5. **Provisional is not uncertain** - It's incomplete authority

---

*This document reflects CRE v36.2 architecture.*
