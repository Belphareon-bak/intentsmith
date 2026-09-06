# MM3-C review — project conversation drill-down

Status: `IMPLEMENTED AND SOURCE TESTED; DEVICE EXECUTION NOT RUN`
Checkpoint commit: `701308d8`

This checkpoint turns the project detail from a count-only projection into a
usable read path. A paired device may open one project, read the current
non-deleted conversations assigned to it, page toward older rows and open an
item in the existing conversation detail. It adds no project or conversation
mutation.

## Delivered surface

- optional, closed `projectId` filter on the existing exact
  `GET /m1/conversations` route;
- additive `projectId` input on the existing `conversations.read` list
  operation behind `RemoteCorePort`;
- newest-first active and archived conversations assigned to the selected
  project; deleted and other-project rows are excluded;
- a project-bound opaque cursor that cannot be replayed against another
  project or the unfiltered conversation stream;
- a project-detail section with loading, failure, confirmed-empty, scope-lock,
  list and explicit older-page states;
- strict query, provider-input and client-response validation;
- HTTP and browser-request `no-store`, with no durable client cache;
- generation guards and withdrawal on navigation, lock, disconnect or scope
  loss.

No new route was introduced. The exact mobile allow-list remains 26 routes;
MM3-C narrows and extends the behavior of its existing conversation-list read.

## Authority and truth boundary

The unfiltered conversation list still requires `read:chat`. Supplying
`projectId` additionally requires `read:projects`; one scope never substitutes
for the other. Project ids must be positive decimal safe integers. Unknown or
duplicate query names, malformed ids, unknown cursors and extra provider
fields fail closed.

The backend filter is applied in the core-owned SQLite read provider before
rows become DTOs. The response contains only the existing versioned
conversation-list projection: id, title, message count, persisted state and
created/updated timestamps. It does not expose `project_id`, paths, summaries,
message bodies, attachments or project filesystem data.

The project conversation section is a live read, not an offline statement.
Both the HTTP response and packaged-client fetch request use `no-store`; the
application never calls its durable cache writer for this dataset. The
in-memory list and cursor are withdrawn when either required scope disappears,
when the app locks, when connectivity is lost, or when the user leaves the
project. A cached project detail can therefore remain visible without silently
promoting remembered membership into current backend truth.

## Authority path

```text
GET /m1/conversations?projectId=<positive-safe-integer>&limit=<n>&cursor=<opaque>
  -> exact route + read:chat
  -> filtered-read guard + read:projects
  -> handleConversations
  -> RemoteCorePort conversations.read { operation: list, projectId, limit, position }
  -> conversation mobile read model
  -> conversations WHERE project_id = ? AND state != 'deleted'
```

Cursor streams are named per project inside the gateway and remain opaque on
the wire. The client only returns a cursor issued by that exact stream; it does
not calculate offsets.

## Verification

Observed on 2026-09-06 from checkpoint `701308d8`:

| Command | Result |
|---|---|
| `node tests/mobile-projects.test.js` | PASS — 11/11 |
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

The focused suites cover two-scope authority, filtering, deleted-row
exclusion, ordering, paging, cross-project and filtered/unfiltered cursor
rejection, malformed/duplicate/unknown query refusal, response `no-store`,
exact client shapes, escaping, empty/error/lock states, automatic detail
loading, non-overlapping append and in-memory withdrawal.

## Explicit non-claims

- MM3-C does not create, rename, archive, delete or assign a conversation.
- It does not create, edit, archive or delete a project and exposes no project
  files, shell, path or workspace operation.
- Opening a listed row uses the existing chat surface; it grants no new send
  authority and does not create a project-scoped chat.
- Active and archived are persisted conversation states, not run progress.
- Global backend search and live run progress/cancel remain contract-blocked.
- This does not freeze `RemoteCorePort`; v1 remains `CANDIDATE_V1`.
- Source and loopback tests are not Android device evidence.
- Chromium, JDK 21, Android SDK 36 and a physical Android target are absent on
  this host; no current APK/AAB build, WebView journey or device result is
  claimed.
- Remote TLS/peer identity, push policy, production signing and independent
  release/security acceptance remain open.
- The unavailable local security implementation has not been compared; no
  equivalence or superiority claim is made.

## Review focus

Review the two-scope boundary, SQL-side membership filter, positive safe-id
validation, exact provider/client shapes, cursor stream isolation, no-store and
memory-only lifecycle, stale-response generation guards, honest empty/error
states, escaping and absence of project/conversation mutation controls. A
green source gate is not device or release evidence.
