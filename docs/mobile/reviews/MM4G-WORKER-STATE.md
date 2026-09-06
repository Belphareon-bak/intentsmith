# MM4-G review — governed worker state

Status: `IMPLEMENTED AND SOURCE TESTED; DEVICE EXECUTION NOT RUN`
Checkpoint commit: `7ac9e303`

This checkpoint adds one deliberately narrow worker mutation to the existing
read projection: a paired device may enable or disable a worker only when it
proves the boolean state it just read. It does not expose generic agent CRUD,
run, dry-run, cancel, schedule editing, specialist mutation or a legacy API
proxy.

## Delivered

- exact allow-list entry `PUT /m1/workers/:id/enabled` with `write:workers`;
- `workers.toggle` production provider behind `RemoteCorePort`;
- pairable but non-default write scope, so default and existing pairings remain
  read-only and widening requires a new one-time pairing code;
- exact request body `{ operationId, expectedEnabled, enabled }`;
- fixed outbound command to legacy `POST /api/agents/:id/enable|disable`;
- no caller-controlled upstream URL, method, route or generic payload;
- atomic expected-state validation and update in an IMMEDIATE SQLite
  transaction owned by `AgentRepository`;
- existing `AgentScheduler.rescheduleAgent()` remains the authority after an
  enable; a disable prevents future due selection but does not cancel a run
  that is already executing;
- exact success result `{ id, previousEnabled, enabled }`;
- server operation fingerprint bound to worker id, expected state and target
  state, while the client journal stores only `Změna stavu agenta`;
- `Cache-Control: no-store` for worker reads, writes and gateway-layer errors;
- two-step confirmation shown only after a successful live, `FRESH` worker
  read and only when the device holds both read and write scopes;
- post-confirmation read refresh and no optimistic state change;
- `UNKNOWN` recovery through MS-20 for timeout, 5xx, unreadable or malformed
  results after a possible effect;
- no queued or automatic retry of a worker mutation.

## Exact mobile contract

| Field | Rule |
|---|---|
| route `id` | string, 1–128 code units, trimmed, no ASCII control characters |
| `operationId` | required operation-journal key |
| `expectedEnabled` | boolean state returned by the live read |
| `enabled` | boolean target; must differ from `expectedEnabled` |

The body may contain no additional field. A successful response must prove the
same target and transition exactly:

```text
{ id, previousEnabled: expectedEnabled, enabled }
```

A response with an additional/missing field, a different id or mismatched
boolean is not guessed into success. It leaves the attempt `UNKNOWN`.

## Authority path

```text
phone
  -> PUT /m1/workers/:id/enabled
  -> mobile operation journal
  -> RemoteCorePort workers.toggle
  -> fixed-shape UpstreamClient command over loopback
  -> legacy POST /api/agents/:id/enable|disable
  -> AgentRepository.transitionEnabled (IMMEDIATE transaction)
  -> AgentScheduler.rescheduleAgent (enable only)
```

The gateway and read-model provider share the SQLite database for projections,
but the mutation intentionally does not write `agents_v33` from the gateway
process. The live legacy process owns repository and scheduler coordination.
This avoids a split-brain update where the row changes without the in-memory
scheduler being notified.

`transitionEnabled` reads and compares the current state and changes exactly
one row inside `better-sqlite3`'s IMMEDIATE transaction. A missing worker is a
decided `404`; a mismatched expected state is a decided `409`; neither changes
the row. Enabling invokes the existing reschedule path after commit. Disabling
does not claim cancellation: a run already in progress may finish.

## Scope and UI rules

`write:workers` does not imply `read:workers`. The HTTP route is authorized by
its exact write scope. The first-party UI is intentionally stricter: it enables
the action only while the worker screen is active, the connection is live, a
successful non-cached read is `FRESH`, both scopes are present, no read error is
shown and no worker mutation is already in flight.

The first tap only arms a confirmation. The confirmation explains that enable
restores scheduled effects and that disable does not cancel current work. The
client does not flip its cached boolean. After a confirmed result it reloads
the worker list and displays server truth. Leaving the screen, background
lock, scope withdrawal or a failed read disarms the action.

## Mutation and recovery rules

1. The client persists a fresh 128-bit `operationId` before dispatch, with no
   worker id or name in its local operation record.
2. The gateway binds that key to the exact id, expected state and target state
   before invoking the core provider.
3. Same key and same request replays the stored outcome. Reusing the key with
   a changed target, precondition or worker is `operation_conflict` and causes
   no second effect.
4. Validation, scope, capacity, not-found and stale-state refusals are decided
   `REJECTED` outcomes.
5. Network failure, timeout, upstream 5xx, unreadable success or a gateway
   exception after possible dispatch is `UNKNOWN`, never `REJECTED` by guess.
6. Worker state and the mobile operation result are committed by different
   authorities. If the worker transition committed but its receipt was lost,
   MS-20 remains the honest recovery surface.
7. The client never queues, auto-retries or creates a replacement operation id
   for an ambiguous worker intent.
8. A state conflict causes one safe list refresh and requires a new conscious
   decision over the new state.

## Evidence

| Check | Result |
|---|---|
| `node tests/mobile-workers-specialists.test.js` | PASS — 12/12 |
| `node tests/mobile-workers-specialists-ui.test.js` | PASS — 12/12 |
| `node tests/mobile-data-model.test.js` | PASS — 41/41 |
| `node tests/mobile-gateway-boundary.test.js` | PASS — 38/38 |
| `node tests/mobile-companion-e2e.test.js` | PASS — 5/5 |
| `node tests/mobile-packaged-transport.test.js` | PASS — 8/8 |
| `node tests/remote-core-port-contract.test.js` | PASS — 12/12 |
| `node tests/agent-runner.test.js` | PASS — 22/22 |
| `node tests/mobile-capability-inventory.test.js` | PASS — 248 routes |
| `node tests/module-boundary-ratchet.test.js` | PASS — 13/13 |
| `node scripts/module-boundary-ratchet.mjs` | PASS — 1,106 edges; 3 existing cycles; no delta |
| `npm run test:mobile` | PASS — 54/54 active; 1 Chromium suite withheld |
| `npm run test:registry` | PASS — 437 programs |
| `git diff --check` | PASS |

Registry digest:
`ba13e78b08c7b8e4e505668a1fe867ca5a526dc36317734c308d212d237df031`.

Generated backend inventory: 248 static routes, 24 exact mobile-v1 routes,
224 broader desktop/core routes, 84 RemoteCorePort candidates, digest
`a8b901d143f2f680d68e321d49e13ed99ecf86e32bdb1fb050614d491997293f`.

The backend suite proves the real repository transition and scheduler
coordination, missing/stale refusal, exact replay without a second effect,
operation-key conflict, result-shape rejection, an injected post-effect lost
result becoming `UNKNOWN`, and absence of request JSON in the durable journal.
The UI suite proves scope withdrawal, cached/stale/offline gating, two-step
confirmation, generic local journaling, exact result validation, conflict
refresh, ambiguous recovery and absence of automatic retry.

Three additional legacy suites were probed but are not counted as milestone
passes because this host stopped them before the worker assertions:
`routes-smoke` on Windows absolute import URLs plus
`WEBHOOK_SECRET_SOURCE_UNSAFE`, `e2e-workers` on
`NOTIFICATION_CHANNEL_FACTORY_INVALID`, and `workers-phase-b` on
`WEBHOOK_SECRET_SOURCE_UNSAFE`. The mobile gate and the direct repository,
route, gateway and UI scenarios above are the checkpoint evidence; those
environment/harness failures are not relabelled as passes.

## Why specialists remain read-only

The specialist tables are not the complete live authority. Runtime
registration and dependency cleanup are coordinated by `SpecialistLoader`.
A direct mobile DB toggle could leave persisted configuration and the running
process disagreeing, so MM4-G refuses that shortcut. A future specialist
mutation needs a named command on the live owner, an expected-state/revision
contract, operation recovery and its own review checkpoint.

## Explicit non-claims

- This does not freeze `RemoteCorePort`; v1 remains `CANDIDATE_V1`.
- This is not worker create, edit, delete, run, dry-run, cancel, schedule
  editing, bulk control or complete run history.
- Disable is not kill: a run that already started may complete and produce
  effects according to its existing authority.
- This provides no specialist mutation and does not bypass `SpecialistLoader`.
- A generic `/api/*` proxy, caller-selected path/method and direct gateway DB
  mutation do not exist.
- Source and loopback tests are not Android device evidence.
- Chromium, JDK 21, Android SDK 36 and a physical Android target are absent on
  this host; no current APK/AAB build, WebView journey or device result is
  claimed.
- Remote TLS/peer identity, push policy, production signing and independent
  release/security acceptance remain open.
- The unavailable local security implementation has not been compared; no
  equivalence or superiority claim is made.
- MM4 remains `IN PROGRESS`: specialists and broader worker operations are
  separate reviewable milestones.

## Review focus

Review the non-default scope, live-read and two-step UI gates, expected-state
transaction, fixed legacy command, scheduler ownership, no direct gateway
mutation, replay/fingerprint binding, exact result validation, generic local
journal, explicit disable-not-cancel warning, post-effect ambiguity,
conflict-refresh behavior, absence of automatic retry and the decision to keep
specialists read-only. A green source gate is not device or release evidence.
