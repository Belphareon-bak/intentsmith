# RemoteCorePort candidate v1

Status: `CANDIDATE_V1`

Latest port implementation checkpoint: MM3-C (`701308d8`) extends the existing
`conversations.read` list operation with a closed optional project filter.
Opaque pagination streams are bound to the selected project and the filtered
gateway read requires both `read:chat` and `read:projects`. This is an additive
candidate implementation, not a contract freeze; see
[`reviews/MM3C-PROJECT-CONVERSATIONS.md`](reviews/MM3C-PROJECT-CONVERSATIONS.md).

Latest consumer checkpoints MM3-D (`34bc19de`), MM3-E (`075f5eb7`), MM4-J
(`acff7939`), MM3-F (`a08d0dd0`), MM4-K (`99cdfdde`), MM4-L (`d1f0a98a`) and
MM4-M (`af33f984`)
change no port input,
output or provider. They make the mobile client consume already returned
opaque cursors for the global conversation
list, active/archive project filters and worker/specialist lists; validate
every versioned page; and persist only the confirmed S1 window plus its
boundary. MM4-J also rejects hidden configured-resource fields, duplicate or
overlapping ids and corrupt cache snapshots before they reach UI or worker
mutation gating. See
[`reviews/MM3D-CONVERSATION-LIST-PAGINATION.md`](reviews/MM3D-CONVERSATION-LIST-PAGINATION.md)
[`reviews/MM3E-PROJECT-LIST-PAGINATION.md`](reviews/MM3E-PROJECT-LIST-PAGINATION.md)
and [`reviews/MM4J-CONFIGURED-LIST-INTEGRITY.md`](reviews/MM4J-CONFIGURED-LIST-INTEGRITY.md).
MM3-F additionally binds the existing project-detail DTO to its requested id,
validates live and cached snapshots, distinguishes conclusive not-found from
ambiguous failure and prevents a late route generation from publishing. See
[`reviews/MM3F-PROJECT-DETAIL-INTEGRITY.md`](reviews/MM3F-PROJECT-DETAIL-INTEGRITY.md).
MM4-K validates the existing settings read as an exact versioned DTO and binds
its 46 accepted public paths directly to the core owner-map export before the
document can render or support the separate revisioned writer. See
[`reviews/MM4K-PUBLIC-SETTINGS-INTEGRITY.md`](reviews/MM4K-PUBLIC-SETTINGS-INTEGRITY.md).
MM4-L validates the existing combined LTM/task-memory records and page
boundary, returns only the server-issued opaque cursor and binds the retained
window to its cache boundary before it can render or support the existing
create-only writer. See
[`reviews/MM4L-STORED-INFORMATION-LIST-INTEGRITY.md`](reviews/MM4L-STORED-INFORMATION-LIST-INTEGRITY.md).
MM4-M validates the existing paired-device projection as an exact public
snapshot, binds its single current row to the active credential and separates
readable cache from live revoke authority. See
[`reviews/MM4M-PAIRED-DEVICE-LIST-INTEGRITY.md`](reviews/MM4M-PAIRED-DEVICE-LIST-INTEGRITY.md).

`RemoteCorePort` is the core-owned, in-process boundary used by the mobile
gateway. It is deliberately narrower than the desktop HTTP listener: a mobile
component can invoke a named capability, but cannot submit an arbitrary URL,
HTTP method, module name or workspace route.

## Contract surface

Version 1 declares nine domains and twenty-four feature identifiers:

| Domain | Features |
|---|---|
| projects | `read`, `create`, `update`, `archive` |
| conversations | `read`, `create`, `update`, `archive`, `send` |
| settings | `read`, `write` |
| stored information | `read`, `write`, `delete` |
| workers | `read`, `toggle`, `dryRun` |
| specialists | `read`, `toggle` |
| approvals | `read`, `decide` |
| notifications | `read`, `ack` |
| events | `read` |

Every feature declares its required device scopes and whether it is a
mutation. Implementations are registered only under known feature identifiers.
Provider output is a closed JSON-safe result algebra:

```text
{ ok: true, data }
{ ok: false, error: { code, details? } }
```

Contract and implementation live in:

- `contracts/remote-core/v1.js`;
- `src/remote-core/port.js`.

## Negotiation and capability truth

The client offers an ordered list of versions. Core selects the first exact
supported version; it does not guess a downgrade. Empty, malformed and
duplicate offers are rejected with distinct codes.

Capability discovery reports each feature as:

- `unavailable` when core did not register a provider;
- `forbidden` when a provider exists but the paired device lacks a scope;
- `available` only when both implementation and authority exist.

This order is intentional: absence of a provider is deployment truth and is
not disguised as an authorization problem. Invocation still fails closed for
unknown versions, unknown feature names, missing providers, insufficient
scope, malformed input and malformed provider output.

## Current production wiring

The mobile gateway constructs the port itself and routes conversation list,
detail and history reads through `conversations.read`, and message submission
through `conversations.send`. The adapter preserves the existing distinction
between a decided rejection and an ambiguous upstream outcome, so retry and
operation-journal guarantees remain intact.

The list operation also accepts the exact optional `projectId` input used by
MM3-C. Filtering happens inside the core-owned provider before DTO projection;
deleted and other-project rows are absent. The gateway binds each continuation
cursor to that project and the client keeps this filtered surface in memory
only with `no-store`. This adds no assignment, create, archive or project
mutation authority.

`projects.read`, `conversations.read`, `conversations.send`, `settings.read`,
`settings.write`, `storedInformation.read`, `storedInformation.write`,
`workers.read`, `workers.toggle` and `specialists.read` now have production
providers. Worker and specialist registration is conditional on their
authoritative tables existing. `workers.toggle` is also conditional on the
fixed-shape lifecycle upstream: the mobile gateway never writes worker tables
behind the live server. The legacy `AgentRepository` validates the expected
enabled state inside an IMMEDIATE transaction and `AgentScheduler` remains the
owner of rescheduling after enable.
`workers.read` also accepts the exact `history` operation used by
`GET /m1/workers/:id/runs`. It returns only bounded metadata for terminal rows
and excludes execution content and untrustworthy live-run state.
`specialists.read` also accepts the exact `detail` operation used by
`GET /m1/specialists/:id`. It reads public persisted package metadata and
ordered expertise bindings in one read transaction; manifest data, prompts,
tools, runtime registration, telemetry and mutation authority are excluded.
Persisted package status is never presented as live runtime truth.
`settings.write` is limited to the eleven validated `UX_PREFERENCES_V1` paths
and an exact expected revision; it is not a generic adapter over the settings
repository. `storedInformation.write` permits only an atomic insert of a new
explicit LTM entry in four public categories. It cannot replace or delete LTM,
write task memory, or address internal categories. The other fourteen feature
identifiers currently report `unavailable`. Their
providers are added alongside the corresponding MM3/MM4 user surfaces. The
older `/m1` handlers remain on an exact allow-list during this transition; no
`/api/*` proxy or generic port operation exists.

## Backend inventory

`npm run mobile:inventory` scans every statically declared `/api` and `/m1`
route-map key and writes both human-readable and JSON artifacts. At this
candidate checkpoint it records:

- 250 unique routes;
- 26 existing `/m1` routes;
- 224 broader desktop/core routes;
- 86 routes mapped to the nine RemoteCorePort domains.

The inventory is an exposure review input, not automatic permission. Security
token and secret administration are marked `never-expose-admin`; governed
effects must cross approval authority instead of being proxied. Dynamically
registered behavior and WebSocket message kinds still require their own
contract inventories.

## Threat model

The boundary protects against these classes of accidental authority growth:

- arbitrary desktop-route proxying;
- path or method injection;
- importing internal core modules by caller-controlled name;
- treating a missing provider as an empty successful result;
- executing a provider before scope validation;
- passing non-JSON values across the contract;
- silently changing version semantics.

It does not itself provide transport security, secure credential storage,
device attestation or push delivery. Those are MM5 concerns outside this
in-process contract.

## Why this is not frozen

The upstream `ConversationCommand`, `ConversationResult` and `CoreEvent`
contracts are still labelled `PROVISIONAL_V1`. Freezing this dependent contract
would make a stronger claim than the repository evidence supports. Promotion
from `CANDIDATE_V1` requires a separately reviewed commit after those
prerequisites are pinned; until then MM3/MM4 providers may evolve without a
false compatibility promise.
