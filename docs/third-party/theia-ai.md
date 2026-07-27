# Theia AI and Theia Coder

Verified: 2026-07-27

## Upstream

- Theia repository: https://github.com/eclipse-theia/theia
- Theia AI docs: https://theia-ide.org/docs/theia_ai/
- Theia Coder docs: https://theia-ide.org/docs/theia_coder/
- npm package example: https://www.npmjs.com/package/@theia/ai-chat

## Version

- Theia package latest observed: `1.73.1`
- Theia AI package example `@theia/ai-chat` latest observed: `1.73.1`

## License

EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0.

## Use Mode

Framework and extension packages for IntentSmith Studio. The UI remains a thin
client over IntentSmith Core APIs.

## Binary Distribution

Desktop distribution is deferred until Phase 7 or Phase 8. Notices and license
review are required before bundling.

## Security Boundary

Theia UI state is not domain authority. The UI cannot write directly to
SQLite, lifecycle state, approvals, or worker results.

## Fallback

CLI and local API remain the primary testable control surface without Studio.

## Update Strategy

Pin Theia package set as one version group. Security advisories around
workspace trust and AI prompt injection must be checked before every update.
