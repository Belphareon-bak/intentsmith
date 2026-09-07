# MM4-L review — stored-information list integrity

Status: `IMPLEMENTED AND SOURCE TESTED; DEVICE EXECUTION NOT RUN`
Checkpoint commit: `d1f0a98a`

This checkpoint closes the remaining client-side trust and truncation gap in
the stored-information read delivered by MM4-B and used as the live authority
for MM4-F create-only writes. The gateway already returned exact records and
an opaque forward cursor, but the mobile client previously trusted arbitrary
successful data, displayed only the first 50 rows and cached an unvalidated
array without its server-confirmed boundary.

## Delivered surface

- strict HTTP 200/success-envelope handling for `GET /m1/memory`;
- exact 14-field versioned DTO validation for both `ltm` and `task` records;
- kind-bound id, source and project/milestone semantics;
- finite JSON values, bounded confidence/strength, non-negative access count,
  timestamps and `v1:` version validation;
- exact `kind=all` page validation with coherent `hasMore`, `nextCursor` and
  `end`, a 50-row response ceiling, unique ids and valid scope lists;
- visible partial-list state and a **Načíst další informace** control that
  returns only the opaque server-issued cursor;
- append rejection for duplicate or overlapping ids, with the last confirmed
  window and cache left unchanged;
- a versioned cache shape containing `{ items, page }`, validated again before
  publication under the existing one-hour fresh / seven-day expiry policy;
- safe legacy-array migration: exact rows can still render, but the client
  explicitly marks completeness as unknown and never fabricates a cursor;
- corrupt and expired cache deletion, newest-generation-wins response handling
  and immediate cache/list withdrawal when `read:memory` disappears;
- live mutation authority is withdrawn while reading and after offline,
  server or protocol failure, including a failed append.

No route, query parameter, scope, provider operation, wire field or mutation
was added. The exact mobile allow-list remains 26 routes. MM4-L consumes the
pagination and DTO already produced by MM4-B; it does not broaden MM4-F beyond
create-only explicit LTM inserts.

## Record and page boundary

An accepted record contains exactly:

```text
accessCount, category, createdAt, id, key, kind, lastUsedAt,
milestoneId, projectId, source, storedConfidence, strength, value, version
```

An LTM row must use an `ltm:` id and cannot claim project or milestone
membership. A task row must use a positive numeric `task:` id, retain the
backend's `execution_loop` source and identify a project. Neither kind may
carry an unknown field, non-finite JSON value or invalid version.

The client treats each response as one forward page, not as a complete list by
default. `hasMore: true` requires a non-empty opaque cursor and `end: false`;
an exhausted page requires a null cursor and `end: true`. The client never
parses, increments or rebuilds that cursor. A page that repeats an id already
in the retained window is rejected atomically.

## Cache and mutation truth

The durable S2 cache now binds records to the page boundary that describes
them. A valid snapshot may be shown while offline, with its age and partial
state visible. A legacy exact array remains readable only as an incomplete
copy. Invalid or expired content is deleted before it can render.

Cached data never grants mutation authority. The MM4-F create form becomes
actionable only after an exact live page for the current generation succeeds
while the client still has both memory scopes and a healthy connection. Any
new read, failed append, scope loss or ambiguous connection state relocks it.
The core insert-only constraint remains the final protection against a key
that exists outside the currently loaded window.

## Authority path

```text
GET /m1/memory?kind=all&limit=50[&cursor=<opaque-server-value>]
  -> exact route + read:memory
  -> RemoteCorePort storedInformation.read
  -> filtered LTM + task-memory repository projection
  -> versioned records + observed over-fetch page boundary
  -> strict mobile record/page validation
  -> append only if ids do not overlap the confirmed window
  -> persist { items, page }; live success may unlock MM4-F create-only form
```

## Verification

Observed on 2026-09-07 from checkpoint `d1f0a98a` under repository-required
Node `v22.16.0`:

| Command | Result |
|---|---|
| `node tests/mobile-stored-information-ui.test.js` | PASS — 21/21 |
| `node tests/mobile-stored-information.test.js` | PASS — 12/12 |
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

Focused coverage includes both record kinds, hidden and malformed fields,
duplicate ids, invalid page boundaries and scopes, strict HTTP handling,
validated current and legacy cache, corrupt-cache deletion, opaque cursor
append, cross-page overlap, cache preservation on failure, mutation relocking,
scope withdrawal and a two-generation response race. No new test program was
created; the existing registered stored-information UI suite was extended.

## Explicit non-claims

- MM4-L does not add or change the stored-information gateway/provider contract.
- It does not add replacement, editing, deletion, task-memory writes or access
  to internal agent memory.
- It does not claim a stable snapshot across concurrent backend deletions; it
  consumes the existing offset cursor exactly as issued.
- It does not make cached S2 content safe on an unlocked or compromised phone.
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

Review the exact LTM/task DTO semantics, page/cache boundary, legacy-cache
truthfulness, opaque-cursor append, overlap and generation guards, failure
preservation, scope withdrawal and the rule that only a current exact live read
can unlock the existing create-only form. A green source gate is not device or
release evidence.
