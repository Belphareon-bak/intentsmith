# Promptfoo

Verified: 2026-07-27

## Upstream

- Repository: https://github.com/promptfoo/promptfoo
- npm: https://www.npmjs.com/package/promptfoo
- Ollama provider docs: https://www.promptfoo.dev/docs/providers/ollama/

## Version

- npm latest observed: `0.121.19`

## License

MIT.

## Use Mode

Development and CI evaluation tool. It is not runtime authority.

## Binary Distribution

No bundled binary planned in MVP. Use dev dependency or external command only
after Phase 6 approval.

## Security Boundary

Promptfoo eval outputs are evidence. They do not override deterministic safety,
policy, or functional gates.

## Fallback

Local deterministic eval runner remains available if Promptfoo is unavailable.

## Update Strategy

Pin before Phase 6. Keep Ollama-only eval profiles for offline use.
