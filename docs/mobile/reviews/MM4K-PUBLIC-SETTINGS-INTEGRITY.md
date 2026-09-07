# MM4-K review — public-settings read integrity

Status: `IMPLEMENTED AND SOURCE TESTED; DEVICE EXECUTION NOT RUN`
Checkpoint commit: `99cdfdde`

This checkpoint closes a client-side trust gap in the existing live-only
settings read. The core provider already projected its public owner map, but
the mobile client previously accepted any successful payload. An incompatible
or compromised gateway could therefore render an unowned field or let a
malformed revision become the basis for the revision-checked editor. The
consumer now fails closed before either can happen.

## Delivered surface

- strict HTTP 200/success-envelope handling for `GET /m1/settings`;
- exact top-level settings DTO: `revision`, `settings` and `version` only;
- positive safe-integer revision and `v1:` version validation;
- browser-side mirror of all 46 core-owned `GENERIC_USER_SETTING_PATHS`;
- only the documented `appearance` and `output` containers may be nested, and
  each accepts only its core-owned children;
- recursive finite-JSON validation for every public setting value;
- a source test that compares the client path mirror directly with the core
  export, so additions or removals fail instead of drifting silently;
- malformed data remains unpublished, is classified as a protocol/server
  failure and cannot unlock any revisioned write control;
- existing newest-generation-wins and scope-withdrawal behavior is retained;
- settings remain live-only and are never written to the mobile cache.

No route, query parameter, scope, provider operation, wire field or mutation
was added. The exact mobile allow-list remains 26 routes. MM4-K is a stricter
consumer of the public settings contract delivered by MM4-A and used as the
read authority for MM4-E writes.

## Truth and mutation boundary

The accepted settings object can contain only literal public dotted keys from
the core generic owner map, plus the allow-listed children of `appearance` and
`output`. Private integration fields, legacy notification credentials,
security controls, feature flags, unknown containers, unknown nested fields,
non-finite numbers and non-JSON values reject the complete response.

The phone does not persist the settings projection. Every diagnostics entry or
foreground refresh obtains a live snapshot. A read failure leaves no settings
document to edit. Even when the device also holds `write:settings`, mutation
controls stay locked unless the current generation produced an exact valid
document and the client remains online, on the settings route and error-free.

MM4-K validates ownership and transport shape; it does not narrow values to the
11-path `UX_PREFERENCES_V1` write schema. The broader 46-path read projection
intentionally remains read-only except for those 11 separately validated MM4-E
paths.

## Authority path

```text
GET /m1/settings
  -> exact route + read:settings
  -> RemoteCorePort settings.read
  -> UserSettingsRepository.readPublic()
  -> versioned { revision, settings }
  -> strict mobile DTO + 46-path owner-map validation
  -> newest live generation only; no persistent cache
  -> MM4-E editor unlocks only for its separate 11-path write allow-list
```

## Verification

Observed on 2026-09-07 from checkpoint `99cdfdde` under repository-required
Node `v22.16.0`:

| Command | Result |
|---|---|
| `node tests/mobile-settings-ui.test.js` | PASS — 17/17 |
| `node tests/mobile-settings.test.js` | PASS — 13/13 |
| `node tests/remote-core-port-contract.test.js` | PASS — 12/12 |
| `npm run test:mobile` | PASS — 54/54 active; 1 Chromium prerequisite withheld |
| `npm run test:registry` | PASS — 437 registered programs |
| `node tests/module-boundary-ratchet.test.js` | PASS — 13/13 |
| `node scripts/module-boundary-ratchet.mjs` | PASS — 1,106 edges; 3 pre-existing cycles; no delta |
| `npm run mobile:inventory` | PASS — 250 routes |

The generated backend inventory remains 250 static routes, 26 exact mobile-v1
routes, 224 broader desktop/core routes and 86 candidate-port mappings. Its
digest remains
`c47a580b144d78619ca71b60c6862bf353ffa1868bf120a807c09fcb17093277`.
The registry remains 437 runnable programs with digest
`ba13e78b08c7b8e4e505668a1fe867ca5a526dc36317734c308d212d237df031`.

Focused coverage includes exact data keys, revision/version rules, public
flat and nested owner-map paths, hidden-field rejection, finite JSON, strict
HTTP status/envelope handling, mutation relocking, scope withdrawal and a
two-generation response race. No new test program was created; the existing
registered settings UI suite was extended.

## Explicit non-claims

- MM4-K does not add a settings route or change the core public projection.
- It does not expose security, credential, pairing, model-policy, retention or
  feature-flag authority.
- It does not expand the 11-path MM4-E write allow-list.
- It does not persist settings for offline reading or editing.
- It does not freeze `RemoteCorePort`; v1 remains `CANDIDATE_V1`.
- Source and loopback tests are not Android device evidence.
- Chromium, JDK 21, Android SDK 36 and a physical Android target are absent on
  this host; no current APK/AAB build, WebView journey or device result is
  claimed.
- Remote TLS/peer identity, push policy, production signing and independent
  release/security acceptance remain open.
- The unavailable local security implementation has not been compared; no
  equivalence or superiority claim is made.

## Review focus

Review the mirrored 46-path owner map and its direct equality test against the
core export, exact DTO and finite-JSON validation, protocol failure handling,
newest-generation selection, scope withdrawal and the fact that malformed
reads cannot unlock the MM4-E editor. A green source gate is not device or
release evidence.
