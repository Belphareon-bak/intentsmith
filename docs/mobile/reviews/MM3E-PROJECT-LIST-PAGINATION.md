# MM3-E review — complete project-filter pagination

Status: `IMPLEMENTED AND SOURCE TESTED; DEVICE EXECUTION NOT RUN`
Checkpoint commit: `075f5eb7`

This checkpoint closes the client-side truncation of the active and archived
project lists. `GET /m1/projects` already returned a state-bound opaque
continuation cursor, but the mobile client read only its first 100 rows. Each
filter can now be walked to its backend-confirmed end without mixing states.

## Delivered surface

- explicit **Načíst další projekty** state only when the selected filter has a
  backend-confirmed `hasMore` and non-empty `nextCursor`;
- strict validation of pagination invariants, the response `state` and the
  exact versioned project row shape;
- active rows accepted only in the active stream and archived rows only in the
  archived stream;
- stable append order with duplicate ids and overlap against the visible
  window rejected as protocol errors;
- filter-aware newest-request-wins guard, so a late active response cannot
  overwrite a newly selected archived view;
- separate S1 `{ items, page }` cache snapshots for active and archived
  filters, validated before publication;
- backward-compatible reading of the former array-only cache without
  inventing a continuation cursor or end-of-stream claim;
- inline offline/server/protocol failure with a conscious refresh of the
  selected filter from its head;
- page-boundary withdrawal on app lock and list/cache withdrawal when
  `read:projects` disappears.

No backend route, query name, scope, provider input or wire field was added.
The exact mobile allow-list remains 26 routes. MM3-E consumes the state-bound
pagination contract already issued by `GET /m1/projects`.

## Truth, state and cursor boundary

The client requests up to 100 rows and returns only the opaque cursor from the
last accepted page of the same state filter. It does not calculate offsets,
derive continuation from row count, silently de-duplicate overlaps or reuse an
active cursor for the archive.

A page is accepted only when its top-level `state` equals the selected filter,
`hasMore` and `end` are logical opposites, `nextCursor` exists exactly for a
partial page, ids are unique positive safe integers encoded as strings, and
every row contains exactly `id`, `name`, `state`, `createdAt`, `updatedAt`,
`conversationCount` and a `v1:` version. An invalid or overlapping page leaves
the last confirmed filter window unchanged.

Project list metadata remains the cacheable `MD-02` S1 projection. Active and
archived snapshots live under distinct cache keys and include the server page
boundary. An old array-only snapshot may be shown during upgrade, but its
continuation remains unknown until a live response replaces it. Project
conversation membership remains the separate MM3-C live-only surface.

## Authority path

```text
GET /m1/projects?state=<active|archived>&limit=100[&cursor=<opaque>]
  -> exact route + read:projects
  -> RemoteCorePort projects.read { operation: list, state, limit, offset }
  -> versioned project DTO + state-bound opaque nextCursor/end
  -> strict mobile state/page validation
  -> append-only selected-filter window + validated S1 cache snapshot
```

## Verification

Observed on 2026-09-07 from checkpoint `075f5eb7`:

| Command | Result |
|---|---|
| `node tests/mobile-projects-ui.test.js` | PASS — 23/23 |
| `node tests/mobile-projects.test.js` | PASS — 11/11 |
| `node tests/mobile-overview.test.js` | PASS — 25/25 |
| `node tests/remote-core-port-contract.test.js` | PASS — 12/12 |
| `node tests/mobile-contract-pagination-end.test.js` | PASS — 21/21 |
| `node tests/mobile-contract-cursor-rejection.test.js` | PASS — 10/10 |
| `npm run test:mobile` | PASS — 54/54 active; 1 Chromium prerequisite withheld |
| `npm run test:registry` | PASS — 437 registered programs |
| `node tests/module-boundary-ratchet.test.js` | PASS — 13/13 |
| `node scripts/module-boundary-ratchet.mjs` | PASS — 1,106 edges; 3 pre-existing cycles; no delta |
| `npm run mobile:inventory` | PASS — 250 routes |

Generated backend inventory remains 250 static routes, 26 exact mobile-v1
routes, 224 broader desktop/core routes and 86 routes mapped as candidate port
capabilities. Inventory digest:
`c47a580b144d78619ca71b60c6862bf353ffa1868bf120a807c09fcb17093277`.

Focused coverage includes partial/end rendering, concurrent-append blocking,
exact rows, state mismatch, duplicate/overlap failure, cursor reuse, separate
filter caches, old-cache migration, scope withdrawal and an active/archive
response race. The browser accessibility program remains withheld by the
registered missing-Chromium prerequisite and is not counted as a pass.

## Explicit non-claims

- MM3-E does not create, edit, archive, restore or delete a project.
- It does not expose project paths, files, shell access or workspace actions.
- It does not assign, create or mutate project conversations.
- It does not add global backend search or live run progress/cancellation.
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

Review state binding at response, row, cursor and cache layers; duplicate and
overlap failure; the active/archive race; legacy cache behavior; and
scope/lock withdrawal. A green source gate is not device or release evidence.
