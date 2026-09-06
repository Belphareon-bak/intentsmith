# MM4-H review — worker detail and terminal run history

Status: `IMPLEMENTED AND SOURCE TESTED; DEVICE EXECUTION NOT RUN`
Checkpoint commit: `fd8ad498`

This checkpoint turns the worker list into an inspectable mobile surface. A
paired device with `read:workers` may open one worker and walk backwards over
bounded metadata for its completed runs. It does not expose execution content
or add another lifecycle mutation.

## Delivered surface

- exact allow-list entry `GET /m1/workers/:id/runs` with `read:workers`;
- `workers.read` operation `history` behind `RemoteCorePort`;
- worker identity, type, enabled state and schedule metadata;
- newest-first, opaque-cursor pagination over terminal runs;
- run id, terminal status, start/finish timestamps, action count and trigger
  count;
- a dedicated worker detail screen with an explicit older-history control;
- strict server and client shape validation, scope invalidation and
  `Cache-Control: no-store`.

The query contract is closed: optional `limit` is an integer from 1 through
100 (default 20), optional `cursor` is a server-issued opaque cursor, and every
other, duplicate or malformed parameter is rejected. Cursors are bound to the
worker-history stream and backward direction; list, specialist, conversation
or another worker's cursor cannot be reused.

## Data boundary

Only rows with a finish timestamp and one of `success`, `partial` or `error`
are projected. The response deliberately excludes:

- `log`, error text and explain payloads;
- worker definition, state and parameter documents;
- trigger identities and arguments;
- rows still labelled `running`;
- lifecycle commands such as run, dry-run and cancel.

Those fields can carry S2 execution content or untrustworthy live state. The
mobile response contains bounded S1 lifecycle metadata only. Invalid JSON,
timestamps, status values or a finish time before the start fail the whole
projection closed instead of silently manufacturing a partial truth.

## Ordering and pagination

The read model counts the terminal prefix and reads an absolute window from
the authoritative monotonically increasing run ids. It reverses that window
for newest-first display. A cursor issued for page one therefore keeps walking
into the same older prefix when a newer terminal run is appended between
requests.

The cursor is not a durable archive token. Direct deletion or rewriting of
legacy rows is outside the mobile contract, and deleting the worker removes
the resource. The UI does not persist worker-run pages offline, splice
overlapping pages or infer a position. It reloads the selected live resource;
scope loss, backgrounding and session reset clear the detail projection.

## Authority path

```text
GET /m1/workers/:id/runs
  -> exact route + read:workers
  -> handleWorkerRuns
  -> RemoteCorePort workers.read { operation: history, id, limit, end }
  -> worker mobile read model
  -> agents_v33 + terminal agent_runs_v33 metadata
```

The existing `workers.read` provider remains the only registered provider for
this domain. No generic `/api/*` proxy, caller-selected SQL or gateway-owned
worker lifecycle logic was introduced.

## Verification

Observed on 2026-09-06 from checkpoint `fd8ad498`:

| Command | Result |
|---|---|
| `node tests/mobile-workers-specialists.test.js` | PASS — 15/15 |
| `node tests/mobile-workers-specialists-ui.test.js` | PASS — 15/15 |
| `node tests/mobile-gateway-boundary.test.js` | PASS — 38/38 |
| `node tests/mobile-data-model.test.js` | PASS — 41/41 |
| `node tests/remote-core-port.test.js` | PASS — 12/12 |
| `node tests/mobile-packaged-transport.test.js` | PASS — 8/8 |
| `node tests/mobile-navbar.test.js` | PASS — 22/22 |
| `node tests/mobile-overview.test.js` | PASS — 18/18 |
| `npm run test:mobile` | PASS — 54/54 active; 1 Chromium prerequisite withheld |
| `npm run test:registry` | PASS — 437 registered programs |
| `node tests/module-boundary-ratchet.test.js` | PASS — 13/13 |
| `node scripts/module-boundary-ratchet.mjs` | PASS — 1,106 edges; 3 pre-existing cycles; no delta |
| `node tests/mobile-capability-inventory.test.js` | PASS — 249 routes |

Generated backend inventory: 249 static routes, 25 exact mobile-v1 routes,
224 broader desktop/core routes and 85 routes mapped as candidate port
capabilities. Inventory digest:
`2924e93da37c97b55b6b14b2c1983edb294aafa3a8214c971a699129743f5e4e`.

> Historical checkpoint note: MM4-I later added the separately reviewed
> specialist detail route. The 249/25 inventory and 15/15 suite counts above
> remain the exact MM4-H evidence, not current-HEAD totals. See
> [MM4-I review](MM4I-SPECIALIST-DETAIL.md).

## Specialist authority decision

MM4-H also traced specialist state changes through the existing
`SpecialistLoader`. Its enable path may register runtime dependencies before a
later step fails, and it has no owner-level expected-state command suitable
for the mobile ambiguity contract. Wrapping the current loader would therefore
overstate atomicity. Specialist mutation remains read-only until the live
owner offers a named, recoverable and precondition-checked operation.

## Explicit non-claims

- This is completed history metadata, not live run progress or a log viewer.
- This is not worker run, dry-run, cancel, create, edit, delete, schedule edit
  or bulk control.
- This provides no specialist mutation and does not bypass
  `SpecialistLoader`.
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

Review the terminal-only S1 projection, corrupt-row fail closure, exact query
and response shapes, cursor stream/worker/direction binding, append-stable
backward walk, no-store policy, client overlap rejection, privacy clearing on
scope/session transitions, absence of run commands and the documented decision
not to wrap non-atomic specialist lifecycle behavior. A green source gate is
not device or release evidence.
