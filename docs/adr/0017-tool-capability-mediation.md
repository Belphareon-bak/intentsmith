# ADR 0017: Tool Capability Mediation

Status: accepted for Phase 3B

Date: 2026-07-28

## Context

Phase 3 closed H with an inference-only OpenCode integration: the gateway
refused any request advertising tools (`TOOL_CALLING_UNSUPPORTED`). That was the
honest position while nothing had been probed — accepting `tools` and ignoring
them would have let a worker believe it held shell, filesystem and network
capabilities IntentSmith could not mediate.

The Phase 3B contract spike (`docs/testing/phase-3b-tool-mediation-spike.md`)
then established, against the pinned real `opencode-ai@1.18.8` binary, that
mediation is possible **and** that it does not exist by default:

- under OpenCode's own defaults, zero permission requests were emitted and a
  bash command wrote a file outside the disposable workspace;
- with `permission: { edit, write, bash, webfetch: "ask" }`, permission is
  requested before every side effect and a denial prevents it.

Mediation is therefore a property of the configuration IntentSmith writes, not
of OpenCode.

## Decision

Tool calling is implemented as a bounded vertical slice with four separations.

**1. The gateway translates; it never executes.**
The tool-capable path converts an OpenAI request to the provider's chat surface
and back. It runs no command, touches no file and makes no network request
beyond the same local provider the plain path already used. A tool call leaves
the gateway as data.

**2. Core owns policy, approval state and audit.**
The capability ledger classifies every observed tool with its category, side
effects, idempotence, destructiveness, confirmation requirement, resource scope,
sandbox requirement and audit evidence. `read`/`glob`/`grep` are validated-only,
`edit`/`write` require an approval, `bash`, `webfetch`, `skill`, `task` and
`todowrite` are denied. An unclassified tool resolves to the worst case.

`bash` is denied for a specific reason rather than a general caution: the
observed permission payload carries a command string but an empty `locations`
array, so a command cannot be bound to a workspace scope. Approving it would
mean approving prose. IntentSmith runs its own deterministic gates instead.

**3. An approval authorizes one action, once, and only that payload.**
Approvals are scoped to run + action + normalized payload hash, expire, are
consumed exactly once, and are revoked when their run is cancelled, times out,
fails or does not survive a restart. There is no "always allow" and no API
through which one could be added: `approve` decides a single approval by id.

**4. No worker transport type enters Core.**
The OpenCode adapter translates ACP permission requests into vendor-neutral
capability requests built from structured fields only — never from a title.

### Configuration invariant

IntentSmith must always generate `permission: { edit, write, bash, webfetch:
"ask" }` and must never select `allow_always`. The adapter enforces the second
half itself: it selects `allow_once` or rejects, and an agent that offers no way
to allow exactly once gets a rejection rather than a broader yes.

## Consequences

`TOOL_CALLING_UNSUPPORTED` no longer refuses every tool request. It is still
returned when the provider cannot carry a tool conversation, and when a
conversation contains tool turns with no advertised tools.

What a worker can actually do in this phase is read, edit and write inside a
disposable workspace, each write individually approved. That is deliberately
narrow, and it proves useful coding through the capabilities whose permission
payloads carry enough structure to police.

Not established, and explicitly still open:

- cancel/timeout/process failure while a permission is outstanding, against the
  real binary;
- parallel tool calls (refused, not supported);
- `skill`, `task`, `todowrite`, `webfetch` payload shapes;
- strict-offline execution, which remains NOT PROVEN while OpenCode fetches its
  provider catalog.
