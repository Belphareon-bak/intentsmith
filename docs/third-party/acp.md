# Agent Client Protocol

Verified: 2026-07-28 (updated from the Phase 0 record)

## Upstream

- Protocol repository: https://github.com/agentclientprotocol/agent-client-protocol
- Schema documentation: https://agentclientprotocol.com/protocol/schema
- TypeScript SDK: https://www.npmjs.com/package/@agentclientprotocol/sdk
- SDK repository: https://github.com/agentclientprotocol/typescript-sdk

## Versions

Protocol version and package version are different things and are tracked
separately.

- **Protocol version: `1`** — an integer negotiated at `initialize`. Upstream
  states the current stable ACP protocol version is 1. The repository publishes
  generated JSON Schema artifacts under `schema/v1` and `schema/v2`; that
  versioning applies to the schema artifacts, not to two stable protocols in
  active use.
- **TypeScript SDK: `1.3.0`** (latest observed). Version history runs
  `0.21.0 … 0.29.0 → 1.0.0 … 1.3.0`, so an SDK major of 1 does not imply
  protocol version 1; the numbers coincide by accident.
- `@zed-industries/agent-client-protocol` `0.4.5` also exists and is a separate
  package lineage. IntentSmith does not use it.

## License

Apache-2.0, for both the protocol repository and the TypeScript SDK.

## Transport

JSON-RPC 2.0 over stdio.

## Core Methods

`initialize`, `session/new`, `session/prompt`, `session/update` (notification),
`session/request_permission`, `session/cancel`.

## Use In Phase 3

IntentSmith **adopts `@agentclientprotocol/sdk@1.3.0`** for the ACP lifecycle.
See ADR 0016 for the spike evidence: the SDK was driven against the same fake
ACP agent the Phase 3 suite uses and covers initialize, session creation,
prompt, updates, permission requests, cancellation and process termination.

Integrity `sha512-i3h/efaeuMUFAO1HSfo97QZQnnvMd7wWBYtBsdL6UMZg3a78sk3Ffya5Xu7C7tYsXomXoDXJBAzQF2PcFKAhIQ==`,
Apache-2.0, no runtime dependencies, no install lifecycle scripts.

Only the stable v1 surface is used. The SDK also ships `unstable_*` methods and
v2 draft material; neither is used, and the two are not mixed.

One gap is handled by IntentSmith rather than the SDK: `ndJsonStream` logs a
malformed line to `console.error` and drops it, with no hook for the caller, so
stdout purity is checked in the process supervisor where it belongs.
