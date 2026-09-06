# RemoteCorePort candidate v1

Status: `CANDIDATE_V1`

Latest implementation checkpoint: MM4-F (`3341ea11`) registers the narrow,
create-only manual-memory writer. This is an additive candidate implementation,
not a contract freeze; see
[`reviews/MM4F-CREATE-ONLY-MEMORY.md`](reviews/MM4F-CREATE-ONLY-MEMORY.md).

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

`projects.read`, `conversations.read`, `conversations.send`, `settings.read`,
`settings.write`, `storedInformation.read`, `storedInformation.write`,
`workers.read` and `specialists.read` now have production providers. Worker and
specialist registration is conditional on their authoritative tables existing.
`settings.write` is limited to the eleven validated `UX_PREFERENCES_V1` paths
and an exact expected revision; it is not a generic adapter over the settings
repository. `storedInformation.write` permits only an atomic insert of a new
explicit LTM entry in four public categories. It cannot replace or delete LTM,
write task memory, or address internal categories. The other fifteen feature
identifiers currently report `unavailable`. Their
providers are added alongside the corresponding MM3/MM4 user surfaces. The
older `/m1` handlers remain on an exact allow-list during this transition; no
`/api/*` proxy or generic port operation exists.

## Backend inventory

`npm run mobile:inventory` scans every statically declared `/api` and `/m1`
route-map key and writes both human-readable and JSON artifacts. At this
candidate checkpoint it records:

- 247 unique routes;
- 23 existing `/m1` routes;
- 224 broader desktop/core routes;
- 83 routes mapped to the nine RemoteCorePort domains.

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
