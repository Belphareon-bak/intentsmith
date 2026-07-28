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

IntentSmith implements a **minimal ACP client directly** over JSON-RPC 2.0
rather than adopting `@agentclientprotocol/sdk`. See ADR 0016 for the reasoning:
in short, interop cannot be verified without a real agent to probe, and an
unverifiable dependency has a larger blast radius than a small client that
IntentSmith validates itself. Every inbound message is schema-validated at
runtime regardless, which the SDK would not remove the need for.

The SDK remains the preferred path once a pinned OpenCode build can actually be
probed.
