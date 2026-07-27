# Serena

Verified: 2026-07-27

## Upstream

- Repository: https://github.com/oraios/serena
- Documentation: https://oraios.github.io/serena/

## Version

- Latest changelog release observed: `v1.3.0` from 2026-05-11.

## License

MIT.

## Use Mode

External local MCP server and code-intelligence capability provider.

## Binary Distribution

No bundled binary in MVP. User-managed or installer-managed local dependency
only after Phase 4 approval.

## Security Boundary

Serena reads code and may propose edits through tools. IntentSmith scopes all
project roots, treats repository content as untrusted, and requires approval for
write or rename operations.

## Fallback

If unavailable, return `CODE_INTEL_UNAVAILABLE` and continue with less precise
context.

## Update Strategy

Pin version or commit in Phase 4. Run MCP contract tests, symbol lookup tests,
rename approval tests, and unavailable-service tests before update.
