# MM4-E review — revision-checked settings write

Status: `IMPLEMENTED AND SOURCE TESTED; DEVICE EXECUTION NOT RUN`
Checkpoint commit: `4bb9011d`

This checkpoint turns the public backend-settings card into a deliberately
narrow mutation surface. A phone may write one validated UX preference at the
revision it just read. It does not receive a general settings editor, secret
access, feature-flag authority or a route to the desktop settings API.

## Delivered

- exact allow-list entry `PUT /m1/settings` with `write:settings`;
- `settings.write` production provider behind `RemoteCorePort`;
- pairable but non-default write scope, so existing/default pairing stays
  read-only and widening requires a new one-time pairing code;
- exact request body `{ operationId, expectedRevision, path, value }`;
- one preference per user intent and per operation key;
- optimistic concurrency through the core `UserSettingsRepository` revision;
- preservation of every unrelated public and private setting;
- `Cache-Control: no-store` on settings reads, writes and gateway-layer
  failures for those routes;
- operation fingerprint bound to revision, path and value; exact replay returns
  the original result and rebinding the key is rejected;
- a live-only editor under Settings with enum, boolean, bounded integer and
  color controls; no server-settings cache is written;
- UI mutation lock while offline, loading, failed, scope-withdrawn or already
  saving;
- explicit revision-conflict refresh with no overwrite retry;
- `UNKNOWN` recovery through MS-20 for lost, malformed or ambiguous results;
- content-free local journal label and no automatic mutation retry.

## Exact write allow-list

The provider reuses the core-owned `UX_PREFERENCES_V1` portability profile.
Only these eleven paths and values are accepted:

| Path | Allowed value |
|---|---|
| `/appearance/accentColor` | `#RRGGBB` |
| `/appearance/fontFamily` | `system`, `inter`, `roboto`, `source-code` |
| `/appearance/fontSize` | integer 12–20 |
| `/appearance/theme` | `dark`, `light`, `system` |
| `/c3.language` | `cs`, `en` |
| `/c3.output.codeBlocks` | boolean |
| `/c3.output.markdownRendering` | boolean |
| `/c3.output.syntaxHighlight` | boolean |
| `/output/codeStyle` | `default`, `airbnb`, `google`, `standard` |
| `/output/defaultFormat` | `markdown`, `json`, `csv`, `yaml` |
| `/output/namingConvention` | `camelCase`, `snake_case`, `kebab-case`, `PascalCase` |

Unknown paths and invalid values fail closed. The wider 46-path generic core
repository is not exposed as a mobile API. Security settings, credentials,
model endpoints, retention controls, notifications, feature flags and future
settings remain outside this milestone.

## Authority and concurrency

The phone first reads `GET /m1/settings` and receives the authoritative
revision. A write succeeds only when `expectedRevision` still matches. The core
repository performs the read/compare/update in `BEGIN IMMEDIATE`, increments
the revision and preserves unowned document sections. A stale writer receives
`409 state_conflict` plus the current revision; the client performs one safe
read and asks the user to decide again. It never silently overwrites a desktop
or second-phone edit.

`write:settings` does not imply `read:settings`. The UI requires both because it
will not edit without a live revision, while the gateway authorizes the write
route only by its own exact write scope. A successful response returns only the
new revision and the path/value that the provider proved it committed; it does
not leak the full settings projection to a write-only principal.

## Mutation and recovery rules

1. The client must hold a live public settings snapshot and both scopes.
2. Tapping **Uložit** persists a fresh 128-bit `operationId` before dispatch.
3. The server binds the key to `(expectedRevision, path, value)` before calling
   the core provider.
4. Same key and same payload replays; the same key with any changed field is
   `operation_conflict`.
5. A known validation, scope, capacity or revision refusal is `REJECTED`.
6. A valid provider result must exactly echo path/value and revision + 1.
   Anything else is `UNKNOWN`, never a guessed success.
7. The core settings transaction and mobile operation-result write are two
   SQLite transactions. If the preference commits but result persistence
   fails, the honest result is `UNKNOWN` and MS-20 is the recovery surface.
8. The client never queues, auto-retries or mints a fresh key for that ambiguous
   user intent.

This differs intentionally from MM4-D self-revocation, whose effect and result
must be atomic because self-revocation destroys the caller's recovery
authority. Settings retain recovery access, so this milestone records the
cross-transaction ambiguity rather than pretending atomicity.

## Evidence

| Check | Result |
|---|---|
| `node tests/mobile-settings.test.js` | PASS — 13/13 |
| `node tests/mobile-settings-ui.test.js` | PASS — 13/13 |
| `node tests/remote-core-port-contract.test.js` | PASS — 12/12 |
| `node tests/mobile-capability-inventory.test.js` | PASS |
| `node tests/module-boundary-ratchet.test.js` | PASS — 13/13; 1,106 edges; 3 existing cycles; no delta |
| `npm run test:mobile` | PASS — 54/54 active; 1 Chromium suite withheld |
| `npm run test:registry` | PASS — 437 programs |

Registry digest:
`ba13e78b08c7b8e4e505668a1fe867ca5a526dc36317734c308d212d237df031`.

Generated backend inventory: 246 static routes, 22 exact mobile-v1 routes,
digest
`e347a76a9a53f623aff015a5a987e3a7dcfb16e16989a1b489c8e146788be0a1`.

The Chromium suite is registry-`BLOCKED` because this host has no Chromium
runtime. JDK 21, Android SDK 36 and an attached Android target are absent, so no
APK/AAB build, WebView interaction or physical-device settings journey is
claimed.

## Explicit non-claims

- This is not the unfinished `CONTRACT-V2-PROPOSAL` per-key PATCH contract and
  does not freeze `RemoteCorePort`; current M1 remains `CANDIDATE_V1`.
- It is not a generic editor for all user settings, imports, resets, backups,
  security, model or feature configuration.
- Source and loopback tests are not Android device evidence.
- Remote TLS/peer identity, push policy, production signing and release
  acceptance remain open.
- The unavailable local security implementation has not been compared; no
  equivalence or superiority claim is made.
- MM4 remains `IN PROGRESS`: governed worker/specialist actions and safe stored-
  information mutations are separate reviewable milestones.

## Review focus

Review the non-default scope choice, exact eleven-path allow-list, value
validation reuse, preservation of unrelated settings, revision conflict,
operation fingerprint and replay, malformed-result fail-closed behavior, the
documented two-transaction ambiguity, live-only UI lock and absence of an
automatic retry. A green source gate is not device or release evidence.
