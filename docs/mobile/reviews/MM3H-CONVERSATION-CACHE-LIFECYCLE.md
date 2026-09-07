# MM3-H review — conversation cache lifecycle enforcement

Status: `IMPLEMENTED AND SOURCE TESTED; DEVICE EXECUTION NOT RUN`
Checkpoint commit: `6dd452f7`

This checkpoint aligns the two durable conversation cache classes with the
lifecycle already specified by `DATA-MODEL.md`: conversation metadata follows
`MD-03` and message windows follow the stricter `MD-04`. Before this change
both silently inherited the generic one-minute/fifteen-minute window, and an
expired thread could still be copied into memory and rendered.

## Delivered surface

- `conversations` is `FRESH` for 15 minutes, `STALE` until 30 days and
  `EXPIRED` at 30 days;
- every `thread.<conversationId>` entry is `FRESH` for 15 minutes, `STALE`
  until seven days and `EXPIRED` at seven days;
- expired S2 thread content is deleted before it can enter in-memory state or
  the renderer;
- focused boundary evidence distinguishes the longer S1 metadata lifetime
  from the shorter S2 message lifetime;
- the existing cursor window stored with a thread remains unchanged.

No server route, response DTO, cursor, scope, provider, mutation, storage shape
or cache payload changed. Project-filtered conversation membership remains a
separate live-only, memory-only surface.

## Lifecycle

```text
validated conversation metadata snapshot (MD-03)
  -> age < 15 minutes: FRESH
  -> 15 minutes <= age < 30 days: STALE, labelled and read-only
  -> age >= 30 days: EXPIRED

downloaded thread window (MD-04, S2)
  -> age < 15 minutes: FRESH
  -> 15 minutes <= age < 7 days: STALE, labelled and read-only
  -> age >= 7 days: EXPIRED, deleted before publication
```

These windows classify already stored snapshots; they do not make cached data
server truth. Opening a thread continues to refresh its newest edge, and the
stored cursor/end boundary continues to say whether the visible window is
complete.

## Verification

Observed on 2026-09-07 from checkpoint `6dd452f7` under repository-required
Node `v22.16.0`:

| Command | Result |
|---|---|
| `node tests/mobile-overview.test.js` | PASS — 37/37 |
| `node tests/mobile-ms07-history.test.js` | PASS — 16/16 |
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

No new test program was created. Existing registered suites were extended:
`mobile-overview` from 36 to 37 scenarios and `mobile-ms07-history` from 15 to
16 scenarios.

## Explicit non-claims

- MM3-H does not add, change or freeze a wire contract.
- It does not claim that cached metadata, titles or messages still describe
  current server state; stale UI must retain its age and failure labelling.
- It does not add offline send, rename, archive or delete authority.
- It does not implement global search; searching a cached window would not
  satisfy `MR-10`.
- It does not validate the full thread DTO/cache shape. Exact thread-record,
  response, route-race and corrupt-cache integrity require a separate review.
- It does not add browser-managed HTTP `no-store` to the global list or thread
  reads; transport-cache policy is a separate boundary.
- The longer 30-day S1 metadata retention and seven-day S2 content retention
  increase the readable loss impact on an unlocked phone; logout/revocation
  handling and native device protection remain independent controls.
- Source tests are not Android device evidence.
- Chromium, JDK 21, Android SDK 36 and a physical Android target are absent on
  this host; no current APK/AAB build, WebView journey or device result is
  claimed.
- Remote TLS/peer identity, production signing/distribution and independent
  release/security acceptance remain open.
- The unavailable local security implementation has not been compared; no
  equivalence or superiority claim is made.

## Review focus

Review the exact 15-minute, seven-day and 30-day boundaries, the prefix match
for per-thread keys, deletion before publication, and the explicit retention
tradeoff. Do not treat this checkpoint as evidence for full thread DTO
integrity or browser HTTP-cache isolation.
