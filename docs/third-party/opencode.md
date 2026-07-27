# OpenCode

Verified: 2026-07-27

## Upstream

- Repository: https://github.com/anomalyco/opencode
- Documentation: https://opencode.ai/docs/
- CLI package: https://www.npmjs.com/package/opencode-ai

## Version

- GitHub latest observed: `v1.18.7`
- npm `opencode-ai` latest observed: `1.18.4`

These differed at Phase 0 review time. Phase 3 must pin one distribution
channel explicitly before installation.

## License

MIT.

## Use Mode

External process through worker adapter and ACP/server boundary.

## Binary Distribution

Do not redistribute binary artifacts in MVP. Installation strategy is external
process discovery or user-managed install.

## Security Boundary

OpenCode is not an authority. It may propose diffs, tool actions, shell actions,
and artifacts. IntentSmith Core owns policy, approval, execution, audit, and
final verdicts.

## Fallback

Use fake worker adapter in tests. If OpenCode is missing, report
`WORKER_UNAVAILABLE` with installation guidance.

## Update Strategy

Pin exact version in Phase 3. Update only after contract tests, fixture E2E, and
side-effect boundary tests pass.
