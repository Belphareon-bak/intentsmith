# ADR 0016: Adopt the Official ACP SDK

Status: accepted for Phase 3

Date: 2026-07-28

Supersedes the provisional position recorded in `docs/third-party/acp.md`, which
said IntentSmith would implement a minimal ACP client directly.

## Context

Phase 3 needs an ACP client. The earlier provisional decision to write one was
made when no agent was available to probe, on the reasoning that an unverifiable
dependency has a larger blast radius than a small client we control.

That reasoning no longer holds: the SDK can be verified against the same fake
ACP process the rest of Phase 3 uses. "We already wrote one" is explicitly not a
reason to keep it.

## Versions Verified

From the npm registry on 2026-07-28:

- `@agentclientprotocol/sdk@1.3.0`
- License Apache-2.0
- `dist.integrity`
  `sha512-i3h/efaeuMUFAO1HSfo97QZQnnvMd7wWBYtBsdL6UMZg3a78sk3Ffya5Xu7C7tYsXomXoDXJBAzQF2PcFKAhIQ==`
- **No runtime dependencies**
- **No install lifecycle scripts** (`clean`, `test`, `generate`, `build` are
  development scripts only)
- The package exports `PROTOCOL_VERSION = 1`, which matches the protocol version
  IntentSmith targets. SDK major 1 and protocol version 1 coincide by accident
  and are tracked separately.

## Spike Result

A throwaway spike installed the SDK with `--ignore-scripts` in a temporary
directory and drove its fluent `client()` API against the same fake ACP agent
processes used by the Phase 3 test suite.

| Behaviour | Result |
|---|---|
| initialize and version negotiation | covered |
| `session/new` | covered |
| `session/prompt` with `stopReason` | covered |
| `session/update` notifications | covered |
| `session/request_permission` | covered |
| cancellation (`ActiveSession.dispose`) | covered |
| process termination mid-prompt | covered; surfaces as `ACP connection closed` |
| malformed message on stdout | **not surfaced to the caller** |

Three apparent failures during the spike turned out to be spike errors, not SDK
defects, and are recorded because each is a trap worth avoiding:

- the agent proxy lives on `handle.connection`, not `handle.agent`;
- `client({ requestPermission, sessionUpdate })` **silently ignores** handlers.
  `ClientApp`'s constructor reads only `options.name`. Handlers must be
  registered through `app.onRequest(...)` / `app.onNotification(...)`. Getting
  this wrong produces a client that is never asked for permission, which fails
  in the dangerous direction and is easy to miss;
- the fake agent was replying to responses as though they were requests, which
  is a JSON-RPC error on the agent side and was fixed in the fixture.

### The one genuine gap

`ndJsonStream` logs a parse failure with `console.error` and drops the line.
There is no hook, callback or event, so a caller cannot learn that the agent
wrote something that was not ACP. Verified in
`node_modules/@agentclientprotocol/sdk/dist/stream.js`.

This matters to IntentSmith because a non-ACP line means the process is not
purely speaking the protocol, which is a supervision signal rather than a
protocol one.

## Decision

**Adopt `@agentclientprotocol/sdk` for the ACP lifecycle.** The gap above is not
sufficient reason to maintain a parallel protocol implementation, because it is
addressable outside the protocol layer: `SupervisedProcess` already sees raw
stdout and can detect non-JSON lines itself, which is where an output-purity
check belongs anyway.

IntentSmith retains:

- process supervision, including process-group termination;
- the isolated environment and throwaway runtime;
- message and output size limits;
- **stdout purity detection**, covering the SDK's silent parse-failure gap;
- runtime validation of the normalized boundary, including `stopReason`
  validation and the single-terminal-event guarantee;
- timeout and cancellation policy;
- evidence redaction of the per-run gateway token;
- session ownership checks on inbound messages.

Only the stable v1 surface is used. The SDK also exposes `unstable_*` methods
(`unstable_forkSession`, `unstable_startNes`, document lifecycle, and others);
none are used, and ACP v2 draft types are not mixed in.

## Consequences

- A new pinned runtime dependency, `@agentclientprotocol/sdk@1.3.0`, with the
  integrity hash recorded above and no transitive runtime dependencies.
- The hand-written client in `packages/adapter-opencode/src/acp.ts` is replaced.
  Its validation behaviour does not disappear: the parts the SDK does not cover
  move to the supervision and normalization layers listed above.
- If a future SDK release adds a parse-error hook, the stdout purity check stays
  useful anyway, because it also catches a process that writes non-JSON without
  breaking a line.

## Status Of This Migration

The decision is made and the evidence is recorded. The adapter migration onto
the SDK is the next commit on this branch and is **not** yet complete; until it
lands, `acp.ts` remains in use. This ADR is deliberately written before the
migration so the decision, and the evidence behind it, are reviewable
independently of the code change.
