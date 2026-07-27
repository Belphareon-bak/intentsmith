# P0 Third-Party Components

Verified: 2026-07-27

This table records Phase 0 pin candidates. Exact dependency pins must be
confirmed immediately before Phase 1 or the phase where the component is first
installed.

| Component | Observed version | License | Phase | Use mode | Record |
|---|---:|---|---|---|---|
| OpenCode | GitHub `v1.18.7`; npm `opencode-ai@1.18.4` | MIT | 3 | external process | `opencode.md` |
| Agent Client Protocol | protocol `v0.13.3`; TS SDK `@agentclientprotocol/sdk@1.3.0` | Apache-2.0 | 3 | protocol/library | `acp.md` |
| MCP TypeScript SDK | `@modelcontextprotocol/sdk@1.29.0` | MIT for npm v1; upstream notes mixed MIT/Apache-2.0 | 4 | library | `mcp-typescript-sdk.md` |
| Serena | `v1.3.0` changelog release | MIT | 4 | external MCP server | `serena.md` |
| Theia AI / Coder | `@theia/*@1.73.1` package line | EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0 | 7 | framework | `theia-ai.md` |
| Promptfoo | `promptfoo@0.121.19` | MIT | 6 | dev/CI tool | `promptfoo.md` |
| OpenTelemetry JS | `@opentelemetry/api@1.9.1` | Apache-2.0 | 1 | library | `opentelemetry-js.md` |
| better-sqlite3 | `better-sqlite3@13.0.1` | MIT | 1 | library | `better-sqlite3.md` |

## Source URLs

- https://github.com/anomalyco/opencode
- https://github.com/anomalyco/opencode/releases/latest
- https://www.npmjs.com/package/opencode-ai
- https://github.com/agentclientprotocol/agent-client-protocol
- https://www.npmjs.com/package/@agentclientprotocol/sdk
- https://agentclientprotocol.com/libraries/typescript
- https://github.com/modelcontextprotocol/typescript-sdk
- https://www.npmjs.com/package/@modelcontextprotocol/sdk
- https://github.com/oraios/serena
- https://github.com/oraios/serena/blob/main/CHANGELOG.md
- https://github.com/eclipse-theia/theia
- https://www.npmjs.com/package/@theia/core
- https://www.npmjs.com/package/@theia/ai-chat
- https://theia-ide.org/docs/theia_ai/
- https://theia-ide.org/docs/theia_coder/
- https://github.com/promptfoo/promptfoo
- https://www.npmjs.com/package/promptfoo
- https://github.com/open-telemetry/opentelemetry-js
- https://www.npmjs.com/package/@opentelemetry/api
- https://github.com/WiseLibs/better-sqlite3
- https://www.npmjs.com/package/better-sqlite3

## Phase 0 Conclusions

- No cloud dependency is required by the foundation architecture.
- The UI package line has a copyleft-compatible secondary license path and
  requires distribution review before desktop packaging.
- OpenCode distribution channels differ; Phase 3 must choose and pin one.
- MCP TypeScript SDK licensing must be verified on the exact artifact selected.
- Promptfoo is development evidence only, not runtime authority.
