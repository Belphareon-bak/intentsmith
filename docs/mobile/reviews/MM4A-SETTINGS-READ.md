# MM4-A review — public settings read projection

Status: `IMPLEMENTED AND TESTED`

This checkpoint replaces the backend-settings placeholder with a real,
scope-gated, read-only projection. It uses the core's existing revisioned user
settings repository and therefore inherits its explicit public allow-list;
the mobile provider never reads the raw settings document directly.

## Delivered

- production `settings.read` provider behind `RemoteCorePort`;
- `GET /m1/settings`, exact query schema with no accepted parameters;
- pairable and default `read:settings` scope;
- provider-aware capability discovery;
- a live-only backend settings card with revision, loading, failure, empty,
  locked and success states;
- stable display of flat and public nested settings;
- scope-withdrawal invalidation and no persistent mobile settings cache;
- service-worker shell bump so installed clients receive the screen.

## Security boundary

The provider calls `UserSettingsRepository.readPublic()`. Unowned values and
legacy notification secrets are excluded by the core allow-list before the
result crosses the port. A 256 KiB response ceiling fails closed. The screen
escapes keys and values and exposes no write control; `settings.write` remains
`unavailable`.

## Evidence

| Check | Result |
|---|---|
| `node tests/mobile-settings.test.js` | PASS — 5/5 |
| `node tests/mobile-settings-ui.test.js` | PASS — 7/7 |
| `node tests/remote-core-port-contract.test.js` | PASS — 12/12 |
| `npm run test:mobile` | PASS — 43/43 active; 1 Chromium suite withheld |

## Compatibility boundary

The route uses the current `m1.2026-07-30` envelope. It is not presented as
conformance to the unfinished `CONTRACT-V2-PROPOSAL.md`; writes and the future
typed setting-key union require their own reviewable checkpoint.

## Remaining MM4 work

- revision-checked settings writes with operation recovery;
- stored information and memory controls;
- authoritative agents/specialists projection;
- paired-device management and remaining provider migrations.
