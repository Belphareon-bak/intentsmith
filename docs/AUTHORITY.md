# CRE Authority Model

> **Final Authority Statement**: User > HumanGate > CRE > Planner > Executor > Tool

## Authority Chain

The CRE (Cognitive Reasoning Engine) operates under a strict authority hierarchy. Every action must flow through this chain, with each layer having veto power over layers below it.

```
    ┌─────────────────────────────────────────────────────────────┐
    │                         USER                                 │
    │  - Ultimate authority over all actions                       │
    │  - Can approve, reject, or override any decision             │
    │  - Sets goals, constraints, and preferences                  │
    └──────────────────────────┬──────────────────────────────────┘
                               │
    ┌──────────────────────────▼──────────────────────────────────┐
    │                      HUMAN GATE                              │
    │  - Enforces user consent for sensitive operations            │
    │  - Blocks actions that require explicit approval             │
    │  - Cannot be bypassed by any system component                │
    └──────────────────────────┬──────────────────────────────────┘
                               │
    ┌──────────────────────────▼──────────────────────────────────┐
    │                         CRE                                  │
    │  - Central cognitive reasoning                               │
    │  - Coordinates all system components                         │
    │  - Enforces safety profiles and policies                     │
    └──────────────────────────┬──────────────────────────────────┘
                               │
    ┌──────────────────────────▼──────────────────────────────────┐
    │                       PLANNER                                │
    │  - Breaks down goals into steps                              │
    │  - Selects appropriate strategies                            │
    │  - Subject to CRE policies and constraints                   │
    └──────────────────────────┬──────────────────────────────────┘
                               │
    ┌──────────────────────────▼──────────────────────────────────┐
    │                       EXECUTOR                               │
    │  - Executes planned actions                                  │
    │  - Manages tool invocations                                  │
    │  - Reports results back to Planner                           │
    └──────────────────────────┬──────────────────────────────────┘
                               │
    ┌──────────────────────────▼──────────────────────────────────┐
    │                         TOOL                                 │
    │  - Performs atomic actions                                   │
    │  - No autonomous decision-making                             │
    │  - Pure execution layer                                      │
    └─────────────────────────────────────────────────────────────┘
```

## Gate System

### HumanGate
- **Purpose**: Ensures user consent for sensitive operations
- **Scope**: File writes, command execution, network access, secrets
- **Rule**: Cannot be bypassed by plugins, remote agents, or federation

### LLMGate
- **Purpose**: Additional AI-based safety evaluation
- **Scope**: Intent verification, risk assessment, output validation
- **Rule**: Provides confidence scores, can block uncertain actions

### SafetyGate
- **Purpose**: Enforces safety profiles and policies
- **Scope**: All operations pass through safety checks
- **Rule**: Always evaluated first, highest priority

## Trust Levels

### For Plugins (v43.0)
- **Sandboxed** (default): Full gate enforcement
- **Verified**: Reduced gate checks for verified plugins
- **System**: Minimal gates for system plugins only

### For Remote Agents (v43.1)
- **TRUSTED**: Fully trusted, minimal restrictions
- **SANDBOXED** (default): Isolated environment, limited capabilities
- **UNTRUSTED**: Read-only operations, requires human approval

### For Federation (v43.2)
- **FULL**: Complete payload sharing
- **SUMMARY**: Aggregated data only
- **METADATA**: Structure and types only, no content

## Invariants

1. **User supremacy**: User can always override or abort any operation
2. **Gate integrity**: Gates cannot be bypassed by any component
3. **Plugin sandboxing**: Plugins receive PluginContext, not raw access
4. **Trust inheritance**: Child operations inherit parent trust level
5. **Audit trail**: All gate decisions are logged

## Proactive Mode (v42.1)

The system may proactively suggest actions, subject to:

- **No auto-execution**: Suggestions require explicit approval
- **Confidence threshold**: Minimum 0.8 confidence required
- **Noise prevention**: Repeated suggestions are suppressed
- **User control**: Opt-in mode, can be disabled at any time

## Goal Drift Prevention (v42.0)

- **Threshold**: Updates with confidence < 0.7 require confirmation
- **Source tracking**: USER updates apply immediately, INFERRED require approval
- **Pending state**: Low-confidence updates stored for user review

---

*This document represents the authoritative source for CRE's authority model.
Any component that violates these principles is considered a bug.*
