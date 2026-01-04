# C.3 System Rules (Global)

These rules apply to ALL projects and ALL executions.

## Authority
- Backend (C.3) is the single source of truth.
- UI is a passive renderer and input forwarder.
- No component other than backend computes execution state.

## Determinism
- Every execution must be reproducible from:
  - build request
  - plan
  - persisted execution state
- No hidden state is allowed.

## Separation of Concerns
- Projects contain work and artifacts.
- Global layer contains rules and invariants.
- Runtime contains ephemeral execution state.

## LLM Usage
- LLMs do not make final decisions.
- LLM outputs must be validated by backend rules.
- Final authority always belongs to backend logic.

## Safety
- No implicit filesystem writes.
- No implicit shell execution.
- All privileged actions require explicit approval.

## UI Independence
- Backend must not assume any UI exists.
- Backend must not emit UI-specific models.
- Backend emits facts (events, artifacts) only.

Violating any rule above is considered a system bug.
