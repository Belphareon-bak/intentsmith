# ADR 0002: Runtime and Workspace Boundary

Status: accepted for Phase 0 review

Date: 2026-07-27

## Context

IntentSmith must run locally, preserve user control, and prevent workers from
becoming the authority for side effects.

## Decision

IntentSmith Core owns the runtime authority:

- lifecycle state;
- task state;
- approval state;
- audit state;
- model assignment;
- final verdicts.

All risky work runs inside explicit workspace boundaries:

- canonical read roots;
- canonical write roots;
- environment allowlist;
- command policy;
- network mode;
- timeout;
- process group cleanup;
- audit event for every proposal and side effect.

Phase 1 uses fake providers and disposable fixture workspaces only. Later worker
integration must use detached worktrees or equivalent disposable roots.

## Consequences

- Workers return proposals and evidence; they do not self-approve.
- The UI cannot write domain state directly.
- Missing sandbox capability is reported as a blocker, not silently ignored.
