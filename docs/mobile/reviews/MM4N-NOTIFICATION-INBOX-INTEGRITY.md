# MM4-N review — notification inbox consumer integrity

Status: `IMPLEMENTED AND SOURCE TESTED; DEVICE EXECUTION NOT RUN`
Checkpoint commit: `656941d4`

This checkpoint closes the remaining client-side trust, truncation and ACK
authority gaps in the pull-based notification inbox. The backend already had a
fail-closed mobile channel, a closed S1 producer, unique sequences and
per-device receipts, but the client previously trusted arbitrary successful
rows, discarded the server page boundary and exposed ACK under read scope.

## Delivered surface

- strict HTTP 200/success-envelope handling for notification reads and ACKs;
- explicit browser/native request `no-store` plus server `Cache-Control:
  no-store` for both existing notification routes;
- exact nine-field notification DTO validation;
- a client vocabulary bound by test to the producer's nine-entry
  `S1_VOCABULARY`, including exact kind, priority, title and body;
- bounded ids/references, parseable timestamps, plain data objects and a closed
  `event`/`approvalId`/`runId` pointer shape;
- strictly increasing sequences, unique ids and coherent
  `hasMore`/`end`/`nextAfterSeq` validation for every page;
- visible partial-window state and **Načíst další zprávy**, returning only the
  sequence boundary issued by the server;
- overlap rejection without changing the last confirmed window;
- a validated `{ items, page }` durable snapshot, corrupt/expired deletion and
  explicit incomplete handling for exact legacy array caches;
- newest-generation-wins handling for concurrent reads;
- `write:notifications` as a supported scope separate from
  `read:notifications`;
- a volatile live-read grant: cached rows remain readable but cannot authorize
  ACK;
- ACK of only the currently displayed unread ids, bounded response validation,
  one in-flight attempt and a confirming read after success;
- no automatic retry after an ambiguous or malformed ACK;
- immediate mutation-grant withdrawal on new read, failure, scope loss,
  disconnect, reconnect or session lock;
- an overview count suffixed with `+` while the retained inbox window is not
  server-confirmed complete.

No route, provider operation or wire body was added. The exact mobile
allow-list remains 26 routes. The server header is transport hardening around
the existing body; the client changes consume the existing sequence and ACK
contract.

## Record and page boundary

An accepted notification contains exactly:

```text
body, createdAt, data, id, kind, priority, read, seq, title
```

`data.event` must be one of the nine closed producer events. The client accepts
the record only when `kind`, `priority`, `title` and `body` are exactly the
values mapped by that event. Optional `approvalId` and `runId` are bounded,
trimmed pointers; unknown data keys and content-bearing extensions reject the
record rather than being rendered or cached.

Within a response, ids are unique and sequences are strictly increasing after
the requested `afterSeq`. A continuation claim requires a full 50-row page,
`hasMore: true`, `end: false` and `nextAfterSeq` equal to the last accepted
sequence. An exhausted page uses the inverse booleans and the same exact
boundary rule. The client never increments, reconstructs or parses server
sequence authority.

## Cache and ACK truth

The durable cache binds the accepted rows to their page boundary. A valid
snapshot can render while a live request fails, with cache age and completeness
shown. An exact legacy array can render during upgrade but is explicitly
incomplete and has no continuation authority. Invalid or expired cache is
deleted before publication.

ACK requires the notifications route, both scopes, a healthy connection, an
exact successful live read from the current generation, no read error and no
other ACK in flight. Starting any new read withdraws the grant. Successful ACK
does not optimistically rewrite local rows; it performs a fresh read. A timeout,
non-200 success, malformed envelope or invalid acknowledged count leaves the
rows unread locally, withdraws the live grant and never dispatches an automatic
retry.

The backend remains the enforcement authority. Existing storage tests prove
that a device cannot acknowledge another device's targeted row and that a
broadcast receipt is also per-device.

## Authority path

```text
closed S1 companion producer
  -> fail-closed MobileChannel capability
  -> durable row with unique sequence
  -> GET /m1/notifications?limit=50[&afterSeq=<server-sequence>]
  -> device-filtered rows + per-device receipt state
  -> exact S1 record/page/scope validation
  -> validated read-only { items, page } cache
  -> current live read may grant ACK under write:notifications
  -> POST /m1/notifications/ack with displayed unread ids
  -> device-scoped receipt write
  -> exact ACK response followed by a confirming inbox read
```

## Verification

Observed on 2026-09-07 from checkpoint `656941d4` under repository-required
Node `v22.16.0`:

| Command | Result |
|---|---|
| `node tests/mobile-overview.test.js` | PASS — 36/36 |
| `node tests/mobile-notification-ack.test.js` | PASS — 10/10 |
| `node tests/mobile-notification-seq.test.js` | PASS — 6/6 |
| `node tests/mobile-notification-wiring.test.js` | PASS — 9/9 |
| `node tests/mobile-companion-producer.test.js` | PASS — 24/24 |
| `node tests/mobile-companion-e2e.test.js` | PASS — 5/5 |
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

No new test program was created. The existing registered overview suite was
extended from 25 to 36 scenarios, and the existing ACK suite gained transport
header assertions without changing its scenario count.

## Explicit non-claims

- MM4-N does not add or freeze a notification route, DTO or RemoteCorePort
  operation.
- It does not define the general production policy for which runtime events are
  mirrored, to which devices or at what product priority.
- It does not add background polling, WebSocket, SSE, FCM, APNs or any other
  push delivery mechanism.
- A green owned-process HTTP E2E proves the implemented pull composition on
  loopback; it is not remote-network or sleeping-app delivery evidence.
- A valid S1 cache is still readable data on a lost unlocked phone. MM4-N does
  not make cache persistence equivalent to secure deletion.
- Client scope gating is UX protection; gateway policy and device-scoped SQL
  remain the security boundary.
- Source and loopback tests are not Android device evidence.
- Chromium, JDK 21, Android SDK 36 and a physical Android target are absent on
  this host; no current APK/AAB build, WebView journey or device result is
  claimed.
- Remote TLS/peer identity, production signing/distribution and independent
  release/security acceptance remain open.
- The unavailable local security implementation has not been compared; no
  equivalence or superiority claim is made.

## Review focus

Review the duplicate closed vocabulary and its direct drift test, exact record
and sequence-page validation, cache migration/deletion behavior, read/write
scope split, live-only ACK gate, no-store transport, generation race handling,
per-device backend isolation and the no-auto-retry rule. Treat production
delivery/push policy, remote transport and device/release evidence as separate
open work rather than implied by this checkpoint.
