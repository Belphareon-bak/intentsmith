# MM4-F review — create-only stored information

Status: `IMPLEMENTED AND SOURCE TESTED; DEVICE EXECUTION NOT RUN`
Checkpoint commit: `3341ea11`

Historical scope note: this review remains authoritative for MM4-F only.
MM4-G later added guarded worker enable/disable in `7ac9e303`; current inventory
counts and remaining action scope are recorded in
[`MM4G-WORKER-STATE.md`](MM4G-WORKER-STATE.md).

This checkpoint gives the existing stored-information card one deliberately
narrow mutation: a paired device may create a new explicit long-term-memory
entry. It does not expose the core's broader memory machinery, replacement,
deletion, task/execution memory writes or internal agent memory.

## Delivered

- exact allow-list entry `POST /m1/memory` with `write:memory`;
- `storedInformation.write` production provider behind `RemoteCorePort`;
- pairable but non-default write scope, so default/existing pairing remains
  read-only and widening requires a new one-time pairing code;
- exact request body `{ operationId, category, key, value }`;
- four public categories: `preference`, `project`, `style` and `correction`;
- atomic SQLite `INSERT` protected by the existing unique
  `(user_id, kind, key)` authority; a stale caller cannot replace a fact;
- explicit persisted provenance (`confidence=1`, `source=explicit`, no TTL);
- bounded keys and values, with blank, padded, control-character and oversized
  input rejected before a write;
- content-free write receipt: id, LTM kind, category and key, never the value;
- operation fingerprint bound to category, key and value; exact replay returns
  the original outcome and key reuse with changed input is rejected;
- `Cache-Control: no-store` for memory reads, writes and gateway-layer errors;
- create form under Settings → Stored information, shown only with both scopes
  and enabled only after a successful live read;
- post-confirmation read refresh, conflict refresh and no optimistic insertion;
- `UNKNOWN` recovery through MS-20 for lost, malformed or ambiguous results;
- fixed, content-free local journal label and no automatic mutation retry.

## Exact write contract

| Field | Rule |
|---|---|
| `operationId` | required operation-journal key |
| `category` | exactly `preference`, `project`, `style` or `correction` |
| `key` | string, 1–128 UTF-16 code units, no leading/trailing whitespace, no ASCII control characters |
| `value` | nonblank string, at most 8 KiB UTF-8 |

The request object may contain no additional field. The provider performs one
insert for the fixed repository user `default`. It stores `JSON.stringify` of
the string value and returns only:

```text
{ id: "ltm:mem_default_<category>_<key>", kind: "ltm", category, key }
```

The route cannot select another user, set confidence/provenance/TTL, write an
`agent_internal` category, touch `task_memory`, update an existing row or
delete anything. `storedInformation.delete` remains reported as unavailable.

## Authority and conflict behavior

`write:memory` does not imply `read:memory`. The gateway authorizes the mutation
using only its exact write scope, while the UI requires both scopes and a live
read before enabling the form. This prevents a cached or write-only client from
presenting an editor without current server truth.

The SQLite unique constraint is the replacement guard. A duplicate
`(default, category, key)` returns `409 state_conflict`, the client performs one
safe read and the original value is unchanged. The client does not turn that
conflict into an update. Choosing a new key is a new user intent and therefore
requires a new operation id.

## Mutation and recovery rules

1. The client must be on the stored-information surface, online, hold both
   scopes and have completed a successful live read.
2. Tapping **Přidat informaci** persists a fresh 128-bit `operationId` before
   dispatch. The local record uses only the fixed label
   `Přidání informace do paměti`; key and value are not stored there.
3. The server binds the operation id to category, key and value before invoking
   the core provider. The journal stores their hash, not the request document.
4. Same key and same payload replays. Reusing the operation id with any changed
   field is `operation_conflict` and performs no effect.
5. Known validation, scope, capacity and duplicate-key refusals are `REJECTED`.
6. A success must exactly prove the deterministic receipt for the attempted
   category and key. A malformed success is `UNKNOWN`, never guessed.
7. The memory insert and mobile result record are separate SQLite writes. If
   the insert may have committed but the result is lost, the honest outcome is
   `UNKNOWN` and MS-20 is the recovery surface.
8. The client never queues, auto-retries or mints a replacement operation key
   for an ambiguous user intent.

## Evidence

| Check | Result |
|---|---|
| `node tests/mobile-stored-information.test.js` | PASS — 12/12 |
| `node tests/mobile-stored-information-ui.test.js` | PASS — 14/14 |
| `node tests/remote-core-port-contract.test.js` | PASS — 12/12 |
| `node tests/mobile-capability-inventory.test.js` | PASS — 247 routes |
| `node tests/module-boundary-ratchet.test.js` | PASS — 13/13; 1,106 edges; 3 existing cycles; no delta |
| `npm run test:mobile` | PASS — 54/54 active; 1 Chromium suite withheld |
| `npm run test:registry` | PASS — 437 programs |

Registry digest:
`ba13e78b08c7b8e4e505668a1fe867ca5a526dc36317734c308d212d237df031`.

Generated backend inventory: 247 static routes, 23 exact mobile-v1 routes,
digest
`10f6abef4496799822b7c78669ca139a59dc54af68126f54408a89ab6cc91645`.

The backend suite also injects an effect followed by a lost provider result and
proves that dispatch happens once, the operation becomes `UNKNOWN`, the
journal contains only a SHA-256 fingerprint and no second write occurs. UI
tests cover scope withdrawal, live-read gating, exact validation, content-free
local journaling, conflict refresh and ambiguous-result recovery.

The Chromium suite is registry-`BLOCKED` because this host has no Chromium
runtime. JDK 21, Android SDK 36 and an attached Android target are absent, so no
APK/AAB build, WebView interaction or physical-device memory journey is
claimed.

## Explicit non-claims

- This does not freeze `RemoteCorePort`; current M1 remains `CANDIDATE_V1`.
- This is not update, upsert, delete, bulk import or memory administration.
- This cannot write task/execution memory or any internal agent category.
- HTTP `no-store` does not make the existing WebView read cache encrypted;
  protected at-rest S2 cache remains part of the wider MM5 data-boundary work.
- Source and loopback tests are not Android device evidence.
- Remote TLS/peer identity, push policy, production signing and release
  acceptance remain open.
- The unavailable local security implementation has not been compared; no
  equivalence or superiority claim is made.
- MM4 remains `IN PROGRESS`: governed worker and specialist actions are a
  separate reviewable milestone.

## Review focus

Review the non-default scope, exact four-category allow-list, key/value bounds,
insert-only database authority, absence of replacement/delete/task-memory
paths, operation fingerprint and replay, content-free local journal, malformed
result fail-closed behavior, documented two-write ambiguity, live-read UI gate
and absence of automatic retry. A green source gate is not device or release
evidence.
