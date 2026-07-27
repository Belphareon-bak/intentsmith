# IntentSmith

IntentSmith is a local-first AI control plane for software development and
eventually general local automation. It coordinates local models, replaceable
workers, tools, policy, lifecycle state, deterministic quality gates, audit,
recovery, and local memory from one user-owned machine.

IntentSmith is not another chat wrapper and not a single coding agent. Its
product thesis is that nondeterministic models and interchangeable agents need
a deterministic control plane around them: explicit state, bounded permissions,
test evidence, approvals, audit trails, and recovery.

## Naming Convention

| Name | Scope |
|---|---|
| IntentSmith | Whole product |
| IntentSmith Core | Local control plane |
| IntentSmith Studio | Theia IDE |
| IntentSmith Workers | OpenCode, OpenHands, and other agents |
| IntentSmith Skills | Workflows and specialists |
| IntentSmithtForge Local | Desktop distribution |
| `intentsmith` | CLI |
| `intentsmith-core` | Main package |

`IntentSmithtForge Local` is kept exactly as specified for this phase. The name
is treated as working naming until trademark, repository, and domain checks are
complete.

## Phase 0 Scope

This repository currently contains only foundation documentation and decision
records. It intentionally contains no application source code.

Phase 0 establishes:

- the greenfield decision;
- runtime and workspace boundaries;
- protocol boundaries;
- API framework decision;
- testing strategy;
- P0 third-party component records;
- proposed dependency boundaries;
- proposed minimal contract schemas;
- Phase 1 to Phase 4 test matrix.

## Reference

Source project: `Belphareon-bak/C3-agent`

Reference commit:

```text
a7b90e36aa80310305703f54f2332e1c0e7f9e8f
```

The C3 repository is a read-only reference for this transformation.
