# Agent Client Protocol

Verified: 2026-07-27

## Upstream

- Protocol repository: https://github.com/agentclientprotocol/agent-client-protocol
- TypeScript SDK: https://www.npmjs.com/package/@agentclientprotocol/sdk
- Documentation: https://agentclientprotocol.com/libraries/typescript

## Version

- Protocol repository latest observed: `v0.13.3`
- TypeScript SDK latest observed: `1.3.0`

Phase 1 to Phase 3 must distinguish protocol/schema version from SDK package
version.

## License

Apache-2.0.

## Use Mode

Protocol and TypeScript library for worker/client sessions.

## Binary Distribution

No binary distribution planned.

## Security Boundary

ACP session permissions are advisory from IntentSmith's perspective. IntentSmith
Core policy remains the source of truth for approval and side effects.

## Fallback

Use the internal fake worker adapter and internal event contracts.

## Update Strategy

Pin SDK version before Phase 3. Experimental ACP v2 APIs are excluded until a
separate ADR approves them.
