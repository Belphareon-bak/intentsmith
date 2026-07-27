# Status

## Current Phase

Phase 0 - Discovery, naming, and ADR.

## Reference State

- Source repository: `Belphareon-bak/C3-agent`
- Local reference path: `/home/belphareon/Projects/c3-agent-wip`
- Reference commit: `a7b90e36aa80310305703f54f2332e1c0e7f9e8f`
- Current repository: `/home/belphareon/Projects/intentsmith`
- Current repository purpose: greenfield foundation documents only

## Product Names

- Whole product: IntentSmith
- Local control plane: IntentSmith Core
- Theia IDE: IntentSmith Studio
- Worker layer: IntentSmith Workers
- Workflow and specialist layer: IntentSmith Skills
- Desktop distribution: IntentSmithtForge Local
- CLI: `intentsmith`
- Main package: `intentsmith-core`

## Phase 0 Verification

- Existing C3 worktree was inspected and left unmodified.
- No source file from C3 was copied into this repository.
- No application source code was created.
- P0 component versions and licenses were checked on 2026-07-27.
- Documentation and ADRs are ready for review.

## Open Decisions Before Phase 1

- Confirm whether `IntentSmithtForge Local` is intentional or should become
  `IntentSmith Forge Local`.
- Run formal trademark and domain checks before final public naming.
- Confirm whether Fastify is accepted as the Phase 1 local API framework.
- Confirm exact pinned versions before adding dependencies in Phase 1.
