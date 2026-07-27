# MCP TypeScript SDK

Verified: 2026-07-27

## Upstream

- Repository: https://github.com/modelcontextprotocol/typescript-sdk
- npm: https://www.npmjs.com/package/@modelcontextprotocol/sdk
- Documentation: https://modelcontextprotocol.io

## Version

- npm latest observed: `1.29.0`

## License

MIT for the published v1 npm package. Upstream notes Apache-2.0 for new
contributions with existing code under MIT. Phase 4 must re-check the exact
published artifact license before pinning.

## Use Mode

Library for MCP client/server adapters.

## Binary Distribution

No binary distribution planned.

## Security Boundary

MCP tool metadata and tool results are untrusted. Every tool call must pass
through capability envelope checks, scope validation, output limits, and audit.

## Fallback

If MCP is unavailable, code intelligence and tool integrations return explicit
blocked states. Core lifecycle remains usable with fake adapters.

## Update Strategy

Pin v1.x for Phase 4 unless a separate ADR approves v2.
