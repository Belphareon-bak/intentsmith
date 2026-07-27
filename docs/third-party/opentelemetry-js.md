# OpenTelemetry JS

Verified: 2026-07-27

## Upstream

- Repository: https://github.com/open-telemetry/opentelemetry-js
- npm API package: https://www.npmjs.com/package/@opentelemetry/api

## Version

- `@opentelemetry/api` latest observed: `1.9.1`

## License

Apache-2.0.

## Use Mode

Library for local traces, metrics, and correlation IDs.

## Binary Distribution

No binary distribution.

## Security Boundary

Telemetry export is local by default. Any remote export requires explicit opt-in
and redaction rules.

## Fallback

No-op tracer and structured local JSON logs.

## Update Strategy

Pin API package in Phase 1. Add exporters only through separate ADRs.
