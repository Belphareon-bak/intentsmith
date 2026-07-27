# better-sqlite3

Verified: 2026-07-27

## Upstream

- Repository: https://github.com/WiseLibs/better-sqlite3
- npm: https://www.npmjs.com/package/better-sqlite3

## Version

- npm latest observed: `13.0.1`

## License

MIT.

## Use Mode

Library for local SQLite persistence.

## Binary Distribution

Prebuilt native packages may be installed from npm. Distribution packaging must
review platform-specific binary handling in Phase 8.

## Security Boundary

SQLite is the local source of truth. Access is only through typed repositories,
explicit transactions, WAL, `busy_timeout`, and append-only audit events for
security decisions.

## Fallback

If native install fails, Phase 1 should fail with an actionable dependency
error. Do not silently switch persistence engines.

## Update Strategy

Pin before Phase 1. Run migration, repository, crash-recovery, and backup tests
before update.
