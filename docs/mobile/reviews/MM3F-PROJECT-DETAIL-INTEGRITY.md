# MM3-F review — project-detail integrity

Status: `IMPLEMENTED AND SOURCE TESTED; DEVICE EXECUTION NOT RUN`
Checkpoint commit: `a08d0dd0`

This checkpoint closes a client-side trust gap in the existing read-only
project detail. The gateway already returned a bounded public DTO, but the
client previously published live and cached detail without exact validation,
could display an expired snapshot, and allowed a late response to land after
the operator left the project screen. The detail consumer now fails closed.

## Delivered surface

- strict HTTP 200/success-envelope handling for `GET /m1/projects/:id`;
- exact versioned public project validation, bound to the requested id;
- accepted states limited to `active` and `archived`, with valid nullable
  timestamps, non-negative nullable conversation count and a `v1:` version;
- validation of a cached detail before publication and deletion of corrupt or
  expired snapshots;
- explicit stale-cache labelling and inline offline/server/protocol recovery
  while the last valid snapshot remains readable;
- definitive `not_found` withdrawal of the remembered detail and its cache;
- newest-generation-wins behavior for repeated reads of the same project;
- route-aware response guards, so a response arriving after navigation is
  inert and cannot repopulate the screen or cache;
- detail and cache withdrawal when `read:projects` disappears;
- reuse of the same exact project-row validator by the MM3-E list consumer.

No route, query parameter, scope, provider operation, wire field or mutation
was added. The exact mobile allow-list remains 26 routes. MM3-F is a stricter
consumer of the detail contract delivered by MM3-A.

## Truth and cache boundary

A detail is accepted only when its object contains exactly `id`, `name`,
`state`, `createdAt`, `updatedAt`, `conversationCount` and `version`. The id
must be a positive safe integer encoded as a decimal string and equal the
requested route id. Extra path, runtime or internal fields reject the entire
response rather than being silently discarded.

An offline, server or protocol failure does not erase an already validated
non-expired snapshot. The UI keeps that copy visibly labelled as cached,
explains that freshness could not be established and offers an explicit
retry. A conclusive `not_found` is different: it removes the remembered copy
because the server has disproved its continued existence. Scope loss removes
the complete project surface and durable project caches.

This checkpoint does not change cache duration. The current generic client
window used by `project.<id>` is one minute fresh and 15 minutes until expiry.
That differs from the 15-minute/seven-day target recorded in `MD-02`; policy
alignment remains open and this review does not claim the target is
implemented. MM3-F only guarantees validation and honest age/failure
presentation inside the existing client window.

Project conversation membership remains a separate MM3-C live-only dataset.
It is invalidated when the project screen is left and is never restored from
the project-detail cache.

## Authority path

```text
GET /m1/projects/:id
  -> exact route + read:projects
  -> existing RemoteCorePort projects.read/detail
  -> versioned public project DTO
  -> strict requested-id and exact-shape validation
  -> newest route generation only
  -> validated S1 project-detail snapshot
```

## Verification

Observed on 2026-09-07 from checkpoint `a08d0dd0` under repository-required
Node `v22.16.0`:

| Command | Result |
|---|---|
| `node tests/mobile-projects-ui.test.js` | PASS — 30/30 |
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

The generated backend inventory remains 250 static routes, 26 exact mobile-v1
routes, 224 broader desktop/core routes and 86 candidate-port mappings. Its
digest remains
`c47a580b144d78619ca71b60c6862bf353ffa1868bf120a807c09fcb17093277`.
The registry remains 437 runnable programs with digest
`ba13e78b08c7b8e4e505668a1fe867ca5a526dc36317734c308d212d237df031`.

Focused coverage includes id/shape binding, hidden-field rejection, a valid
stale cache with explicit offline recovery, expired/corrupt cache deletion,
protocol-safe retention of the last valid copy, definitive not-found
withdrawal, navigation invalidation and same-project response races. No new
test program was created; the existing registered project UI suite was
extended.

## Explicit non-claims

- MM3-F does not create, edit, archive, restore or delete a project.
- It does not expose project paths, files, shell access or workspace actions.
- It does not assign, create or mutate project conversations.
- It does not implement the longer `MD-02` target cache window.
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

Review the exact DTO allow-list and requested-id binding, cache validation,
the distinction between ambiguous failure and conclusive `not_found`, scope
withdrawal, and both route and same-project generation guards. Also review the
explicit cache-policy mismatch rather than treating the `MD-02` target as
implemented. A green source gate is not device or release evidence.
