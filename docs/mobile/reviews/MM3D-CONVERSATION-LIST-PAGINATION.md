# MM3-D review — complete conversation-list pagination

Status: `IMPLEMENTED AND SOURCE TESTED; DEVICE EXECUTION NOT RUN`
Checkpoint commit: `34bc19de`

This checkpoint closes the client-side truncation in the global conversation
list. The gateway already returned an opaque continuation cursor, but the
mobile client read only its first 50 rows. The client now renders the boundary,
loads one server-issued page at a time and preserves a validated offline
snapshot of both the rows and their page state.

## Delivered surface

- explicit **Načíst další** state only when the backend says `hasMore` and
  supplies a non-empty `nextCursor`;
- strict validation of the response envelope, pagination invariants and exact
  versioned conversation row shape;
- stable append order with duplicate ids inside a page and overlap against an
  already published window rejected as protocol errors;
- newest-request-wins generation guard, so a late older refresh is inert;
- S1 durable cache snapshot containing `{ items, page }`, with validation on
  read and deletion at the existing hard-expiry boundary;
- backward-compatible reading of the former array-only cache without
  inventing an end-of-stream or continuation cursor;
- visible inline offline/server/protocol failure while the last confirmed
  window remains readable;
- memory, pagination and durable-cache withdrawal when `read:chat` disappears;
- in-memory withdrawal and in-flight invalidation when the app locks.

No backend route, scope, provider or wire field was added. The exact mobile
allow-list remains 26 routes. MM3-D consumes the pagination contract already
issued by `GET /m1/conversations`.

## Truth and cursor boundary

The client sends `limit=50` for the head and returns only the opaque cursor
from the last accepted response. It does not calculate offsets, infer another
page from the number of rows, silently de-duplicate an overlap or claim the
end before the backend says `end: true`.

A page is accepted only when `hasMore` and `end` are logical opposites,
`nextCursor` is present exactly for a partial page, row ids are unique, and
every row has exactly `id`, `title`, `messageCount`, `state`, `createdAt`,
`updatedAt` and a `v1:` version. An invalid or overlapping page leaves the
published window unchanged and offers a full refresh from the head.

The global list remains the `MD-03` S1 offline projection, unlike the
live-only project-membership list from MM3-C. Its cache therefore holds the
validated window and server page boundary, never a fabricated cursor. An old
array-only cache remains readable during upgrade, but is deliberately treated
as having unknown continuation until a live head response replaces it.

## Authority path

```text
GET /m1/conversations?limit=50[&cursor=<opaque>]
  -> exact route + read:chat
  -> RemoteCorePort conversations.read { operation: list, limit, position }
  -> versioned conversation-list DTO + opaque nextCursor/end
  -> strict mobile validation
  -> append-only visible window + validated S1 cache snapshot
```

## Verification

Observed on 2026-09-07 from checkpoint `34bc19de`:

| Command | Result |
|---|---|
| `node tests/mobile-overview.test.js` | PASS — 25/25 |
| `node tests/mobile-projects-ui.test.js` | PASS — 17/17 |
| `node tests/remote-core-port-contract.test.js` | PASS — 12/12 |
| `node tests/mobile-contract-pagination-end.test.js` | PASS — 21/21 |
| `node tests/mobile-contract-cursor-rejection.test.js` | PASS — 10/10 |
| `node tests/mobile-gateway-boundary.test.js` | PASS — 38/38 |
| `npm run test:mobile` | PASS — 54/54 active; 1 Chromium prerequisite withheld |
| `npm run test:registry` | PASS — 437 registered programs |
| `node tests/module-boundary-ratchet.test.js` | PASS — 13/13 |
| `node scripts/module-boundary-ratchet.mjs` | PASS — 1,106 edges; 3 pre-existing cycles; no delta |
| `npm run mobile:inventory` | PASS — 250 routes |

Generated backend inventory remains 250 static routes, 26 exact mobile-v1
routes, 224 broader desktop/core routes and 86 routes mapped as candidate port
capabilities. Inventory digest:
`c47a580b144d78619ca71b60c6862bf353ffa1868bf120a807c09fcb17093277`.

Focused coverage includes partial/end rendering, disabled concurrent append,
exact row validation, intra-page duplicates, cross-page overlap, cursor reuse,
cache boundary persistence, old-cache migration, scope withdrawal and a
late-response race. The browser accessibility program remains withheld by the
registered missing-Chromium prerequisite and is not counted as a pass.

## Explicit non-claims

- MM3-D does not add global backend search or claim that the cached window is
  a search result over all conversations.
- It does not create, rename, archive, delete, assign or otherwise mutate a
  conversation or project.
- It does not change message-history paging or message-send authority.
- It does not make the project-membership list available offline.
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

Review the pagination invariants, exact DTO validation, overlap failure,
newest-request generation guard, cache migration and scope/lock withdrawal.
Also verify the distinction between the cacheable global S1 list and the
live-only project-membership list. A green source gate is not device or release
evidence.
