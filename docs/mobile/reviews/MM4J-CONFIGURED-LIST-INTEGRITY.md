# MM4-J review — configured-list integrity

Status: `IMPLEMENTED AND SOURCE TESTED; DEVICE EXECUTION NOT RUN`
Checkpoint commit: `acff7939`

This checkpoint closes a client-side trust gap in the existing paginated
worker and specialist lists. The gateway already returned bounded, versioned
DTOs and opaque continuation cursors, but the client previously accepted the
payload without an exact row contract and silently discarded malformed or
duplicate records. Both lists now fail closed as a whole.

## Delivered surface

- strict HTTP 200/success-envelope handling for `GET /m1/workers` and
  `GET /m1/specialists`;
- exact versioned worker validation, including the nested schedule and latest
  terminal-run summaries;
- exact public specialist-summary validation without accepting manifests,
  prompts, tools or runtime fields;
- logical page-boundary validation: `hasMore` and `end` are opposites and a
  non-empty `nextCursor` exists exactly while more rows are confirmed;
- duplicate ids inside a page and overlap with an already displayed page are
  protocol errors, not silently de-duplicated results;
- independent newest-request-wins guards for workers and specialists;
- validated S1 `{ items, page }` cache publication, corrupt snapshot deletion
  and backward-compatible array-cache reading without an invented cursor;
- one disabled-safe continuation control only over a confirmed partial page;
- inline offline/server/protocol recovery that keeps the last confirmed
  window visible and restarts the selected list from its head;
- list, cursor and durable-cache withdrawal when the matching read scope is
  lost; app lock continues to remove every in-memory page boundary.

No route, query parameter, scope, provider operation or wire field was added.
The exact mobile allow-list remains 26 routes. MM4-J is a stricter consumer of
the list contracts delivered by MM4-C.

## Truth, cache and mutation boundary

A worker page is accepted only when each row contains exactly `id`, `name`,
`description`, `icon`, `kind`, `enabled`, `schedule`, `lastRun`, `createdAt`,
`updatedAt` and a `v1:` version. Nested schedule and terminal-run objects also
have closed shapes, valid timestamps, non-negative safe counts and the
documented terminal status vocabulary.

A specialist page accepts only the persisted public summary: `id`, `name`,
`packageVersion`, `domain`, `type`, `status`, `expertiseCount`, four public
timestamps and a `v1:` version. Any extra manifest/runtime/execution field,
bad enum, invalid timestamp, duplicate id or inconsistent page boundary
rejects the complete response. The prior confirmed list and cache remain
unchanged.

Worker summaries retain the five-minute fresh/seven-day hard window;
specialist summaries retain one hour/seven days. The stored object includes
only an accepted item window and the exact accepted page boundary. A legacy
array may be shown during upgrade, but it carries neither a cursor nor an
end-of-stream claim until a live read replaces it.

`workersLive` becomes true only after an exact successful worker response.
Malformed or overlapping pages clear that live proof, keep worker controls
disabled and cannot become the basis for `PUT /m1/workers/:id/enabled`.
Specialists remain read-only. Detail and worker-run history retain their
separate live-only, non-persistent MM4-H/MM4-I boundaries.

## Authority path

```text
GET /m1/<workers|specialists>?limit=50[&cursor=<opaque>]
  -> exact route + matching read scope
  -> existing RemoteCorePort <domain>.read/list
  -> versioned public DTO page + opaque nextCursor/end
  -> strict mobile page and row validation
  -> append-only confirmed S1 window + validated cache boundary
```

## Verification

Observed on 2026-09-07 from checkpoint `acff7939` under repository-required
Node `v22.16.0`:

| Command | Result |
|---|---|
| `node tests/mobile-workers-specialists-ui.test.js` | PASS — 24/24 |
| `node tests/mobile-workers-specialists.test.js` | PASS — 18/18 |
| `node tests/remote-core-port-contract.test.js` | PASS — 12/12 |
| `node tests/mobile-contract-pagination-end.test.js` | PASS — 21/21 |
| `node tests/mobile-contract-cursor-rejection.test.js` | PASS — 10/10 |
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

Focused client coverage includes both exact DTO vocabularies, nested hidden
fields, duplicate and overlapping pages, partial/end controls, protocol-safe
cache retention, corrupt-cache removal, legacy cache behavior, latest-response
selection, scope withdrawal and mutation relocking. No new test program was
created; the existing registered combined UI suite was extended.

## Explicit non-claims

- MM4-J does not add or change backend pagination semantics.
- It does not create, edit, run, dry-run or cancel a worker.
- It does not expose live run progress or execution content.
- It does not add a specialist mutation or claim live runtime registration.
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

Review the exact row allow-lists, nested worker validation, page invariant,
overlap failure, generation guards, legacy/corrupt cache behavior and the
`workersLive` relock. A green source gate is not device or release evidence.
