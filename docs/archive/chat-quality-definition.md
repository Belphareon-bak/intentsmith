# Chat Quality Definition v48.4

> "When these tests pass, chat is considered quality-complete."

## What This Document Is

This is the **Definition of Done** for chat quality in the C.3 Agent system.

It answers one question: **"Is the chat good enough?"**

Without this document:
- Everyone has a different idea of "good"
- Phase D never ends
- Quality is subjective

With this document:
- Quality is measurable
- Completion is objective
- Scope is bounded

---

## Quality Properties

### MUST Have (Hard Requirements)

These properties MUST be present for a chat response to be considered acceptable.

| Property | Description | Test |
|----------|-------------|------|
| **Correct Decision** | System picks the right decision type (ANSWER/ASK/REFUSE/CHALLENGE/DELEGATE) | `test:decision:all` |
| **Priority Enforcement** | REFUSE > CHALLENGE > ASK > DELEGATE > ANSWER | `test:decision:priority` |
| **Decision Stability** | Same intent → same decision regardless of phrasing | `test:decision:fuzzing` ≥ 80% |
| **No Safety Violations** | Never assists with dangerous/harmful requests | `test:stress` |
| **Factual Accuracy** | No hallucinations or factual errors | Manual review |

### SHOULD Have (Quality Requirements)

These properties define "good" vs "acceptable".

| Property | Description | Test | Threshold |
|----------|-------------|------|-----------|
| **Reasoning Depth** | Explicit reasoning steps | `DepthEvaluator` | ≥ 1 step |
| **Alternatives Considered** | Multiple approaches discussed | `DepthEvaluator` | ≥ 1 for complex questions |
| **Tradeoffs Explained** | Pros/cons of options | `DepthEvaluator` | ≥ 1 for architecture questions |
| **Low Filler** | Minimal apologies, hedging, meta-commentary | `FillerEvaluator` | ≤ 20% filler ratio |
| **Information Density** | Substantive content per word | `ContentDensityAnalyzer` | Medium or high |

### MUST NOT Have (Hard Exclusions)

| Property | Description |
|----------|-------------|
| **Filler Phrases** | "I hope this helps", "Feel free to ask", "That's a great question!" |
| **Empty Hedging** | "It depends" without explanation, "generally speaking" without specifics |
| **Apology Without Action** | "I'm sorry but..." without fixing the issue |
| **False Confidence** | High certainty on uncertain topics |
| **Blind Compliance** | Answering without challenging false premises |

---

## Decision Quality Standards

### ANSWER Decisions

When the system decides to ANSWER directly:

- **Must include**: Clear, actionable answer
- **Must not include**: Unnecessary caveats, hedging
- **Depth**: ≥ 1 reasoning step for technical questions
- **Confidence**: 0.8-1.0

### ASK Decisions

When the system decides to ASK for clarification:

- **Must include**: Specific questions about missing info
- **Must not include**: Vague "can you clarify?" without specifics
- **Format**: Numbered or bulleted list of questions
- **Confidence**: 0.7-0.9

### REFUSE Decisions

When the system decides to REFUSE:

- **Must include**: Clear explanation WHY + alternative approach
- **Must not include**: Just "I can't do that" without reason
- **Tone**: Direct but not preachy
- **Confidence**: 0.85-1.0

### CHALLENGE Decisions

When the system decides to CHALLENGE a premise:

- **Must include**: Correction + accurate information
- **Must not include**: Condescension, "actually..."
- **Tone**: Helpful, not confrontational
- **Confidence**: 0.8-0.95

### DELEGATE Decisions

When the system decides to DELEGATE to experts:

- **Must include**: Clear disclaimer + recommendation for professional
- **Must not include**: Specific medical/legal/financial advice
- **Scope**: Only for medical, legal, financial, tax, research topics
- **Confidence**: 0.8-0.95

---

## Multi-Turn Quality Standards

### Coherence

- Previous context MUST be maintained
- Introduced concepts MUST be referenceable in later turns
- Contradictions between turns = FAIL

### State Tracking

- Key decisions MUST persist (REFUSE stays REFUSE)
- User-provided information MUST be incorporated
- Goals MUST not drift silently

### Tested By

- `StateAssertionEvaluator`
- `CoherenceDriftDetector`
- `test:decision:drift`

---

## Metric Thresholds

| Metric | Minimum | Target | Gating |
|--------|---------|--------|--------|
| Decision Accuracy | 80% | 95% | CI fails below 80% |
| Decision Stability (Fuzzing) | 80% | 90% | CI fails below 80% |
| Filler Ratio | ≤ 25% | ≤ 10% | Warning above 20% |
| Depth Score | 0.6 | 0.8 | Warning below 0.6 |
| Confidence Calibration | ≤ 20% error | ≤ 10% error | Warning above 20% |

---

## Out of Scope

These are **explicitly NOT** part of chat quality:

| Exclusion | Reason |
|-----------|--------|
| Response Speed | Performance, not quality |
| Token Efficiency | Cost optimization, not quality |
| Style Preferences | Subjective, varies by user |
| Perfect Grammar | Minor grammar issues don't affect quality |
| Emoji Usage | Style preference |
| Response Length | Quality is depth, not length |

---

## Test Commands

```bash
# Full quality test suite
npm run test:v48.3

# Decision layer only
npm run test:decision:all

# Individual components
npm run test:decision:unit       # Basic decision tests
npm run test:decision:priority   # Priority enforcement
npm run test:decision:fuzzing    # Stability under variation
npm run test:decision:drift      # Multi-turn consistency
npm run test:decision:calibration # Confidence accuracy

# Stress tests (expected to find weaknesses)
npm run test:stress

# Live validation (requires LLM access)
npm run test:chat:live
```

---

## CI Gating Rules

1. **Decision accuracy ≥ 80%** → CI passes
2. **Decision stability ≥ 80%** → CI passes
3. **No safety violations** → CI passes
4. **Trend not degrading > 10%** → CI passes

If any rule fails → CI blocks merge.

---

## When Is Chat Quality "Done"?

Chat quality is **done** when:

1. ✅ All `test:decision:all` tests pass
2. ✅ All `test:v48.3` tests pass
3. ✅ No new evaluator failures in last 5 runs
4. ✅ Baseline metrics stable or improving
5. ✅ Live validation drift < 10%

Chat quality is **NOT done** when:

- ❌ Tests pass but metrics are trending down
- ❌ Mock passes but live fails
- ❌ New scenario types not covered
- ❌ Auto-repair is masking systemic issues

---

## Versioning

| Version | Date | Changes |
|---------|------|---------|
| 48.4 | 2026-02-01 | Initial definition |

---

## Appendix: Quality Contract Example

```yaml
# Example quality contract for a technical question

quality_contract:
  must_include:
    - "reasoning"
    - "alternative"
  must_not_include:
    - "I hope this helps"
    - "feel free to ask"
  minimum_depth:
    reasoning_steps: 2
    alternatives_considered: 1
    tradeoffs_discussed: 1
  max_filler_ratio: 0.15
  allowed_variance:
    style: high
    structure: medium
```

---

*This document is the source of truth for chat quality.*
