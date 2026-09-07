# MM3-I review — conversation thread integrity and HTTP cache boundary

Status: `IMPLEMENTED AND SOURCE TESTED; DEVICE EXECUTION NOT RUN`
Checkpoint commit: `7a6b379e`

This checkpoint closes the remaining consumer-integrity boundaries left
explicitly open by MM3-H for `MS-07`. A downloaded thread is accepted only
when its public conversation and message records, route identity, direction
and page boundary agree. Browser-managed caches are excluded independently of
the app's seven-day `MD-04` cache lifecycle.

## Delivered surface

- a live thread requires the exact versioned seven-field conversation DTO and
  exact six-field public message DTOs with unique positive server ids;
- the conversation id must equal the requested route id, the response must
  walk `backward`, and `hasMore`/`nextCursor`/`end` must be coherent;
- a continuation page may not duplicate a message internally or overlap the
  already confirmed window;
- current `{ conversation, messages, window }` cache snapshots are validated
  before publication; the exact legacy shape without `window` remains
  readable but is explicitly treated as partial;
- corrupt and expired S2 cache is deleted before it can enter memory or UI;
- a shared response generation makes late thread/open/continuation responses
  inert after navigation, a newer request, a locally started chat or scope
  withdrawal;
- loss of `read:chat` clears every in-memory and durable `thread.*` snapshot;
- conclusive server `not_found` deletes known thread data and renders the
  error; only a never-sent local `m-*` conversation may resolve to an empty
  local thread;
- every global conversation-list and thread fetch uses client-side
  `cache: 'no-store'`, and the gateway sends `Cache-Control: no-store` on
  success, handler failures and authorization failures for both read routes.

No route, query parameter, scope, RemoteCorePort operation, provider call,
wire response body, cursor format, mutation or durable cache lifetime was
added or changed. The only server transport change is the privacy response
header on the two existing global conversation read routes.

## Acceptance and failure model

```text
cached thread
  -> expired or malformed: delete before publication
  -> exact legacy snapshot: readable, partial boundary
  -> exact current snapshot: readable with its confirmed boundary

live thread page
  -> exact route id + DTO + backward boundary + newest generation: publish
  -> malformed, duplicate or overlapping: retain only prior valid evidence
  -> route/scope/generation changed: response is inert
  -> conclusive not_found: delete known server thread
  -> never-sent local m-* not_found: empty local thread is allowed
```

App cache age and HTTP cache policy are intentionally separate. A valid S2
snapshot may remain read-only for the `MD-04` window, while the HTTP response
that delivered it must never enter a browser-managed cache.

## Verification

Observed on 2026-09-07 from checkpoint `7a6b379e` under repository-required
Node `v22.16.0`:

| Command | Result |
|---|---|
| `node tests/mobile-ms07-history.test.js` | PASS — 22/22 |
| `node tests/mobile-contract-pagination-end.test.js` | PASS — 23/23 |
| `node tests/mobile-overview.test.js` | PASS — 37/37 |
| `node tests/mobile-devices.test.js` | PASS — 8/8 |
| `node tests/mobile-devices-ui.test.js` | PASS — 15/15 |
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
`mobile-ms07-history` from 16 to 22 scenarios and
`mobile-contract-pagination-end` from 22 to 23 scenarios. The 37-scenario
overview suite gained a stronger assertion without changing its count.

## Explicit non-claims

- MM3-I does not make cached titles, metadata or messages current server
  truth; stale content keeps its age and failure labelling.
- It does not implement global search (`MR-10`) or authoritative live run
  progress/cancel (`MR-07`). Both still require approved server contracts.
- It does not add conversation rename/archive/delete, offline send or another
  chat mutation. Existing operation-keyed message submission is unchanged.
- It does not turn a missing server conversation into an empty success. The
  exception is narrowly limited to a never-sent local `m-*` draft identity.
- Source and loopback HTTP tests are not Android WebView or device evidence.
- Chromium, JDK 21, Android SDK 36 and a physical Android target are absent on
  this host; no current APK/AAB build or device result is claimed.
- Remote TLS/peer identity, production signing/distribution and independent
  release/security acceptance remain open.
- The unavailable local security implementation has not been compared; no
  equivalence or superiority claim is made.

## Review focus

Review the exact public DTO and route-id binding, boundary coherence,
duplicate/overlap refusal, response-generation invalidation, scope-loss wipe,
the narrow local-draft exception and both sides of the HTTP `no-store`
boundary. Do not treat this checkpoint as search, live-run, device or release
evidence.
