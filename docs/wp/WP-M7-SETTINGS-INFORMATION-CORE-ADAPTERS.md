# WP-M7-SETTINGS-INFORMATION-CORE-ADAPTERS

**Type:** write-enabled M7 core capability block

**Base revision:** `35a82422` (conversation-core evidence HEAD)

**Current state:** `IMPLEMENTATION_IN_PROGRESS / REVIEW_PENDING / NOT_ACTIVE`

## 1. User outcome

Implement the transport-free `settings@1` and `stored_information@1`
capabilities against real core storage while preserving the candidate's
approval/effect and durable-replay boundaries.

## 2. Owned and forbidden paths

Owned:

- a fixed safe mobile settings projection over the production `user_settings`
  document;
- revision-bound setting updates behind an injected approval/effect mediator;
- a subject/project-scoped append-only manual-information repository;
- authenticated pagination, M7 journal replay, schema oracles and negative
  tests;
- registry, migration, module-boundary and review evidence updates.

Forbidden:

- generic mobile read/write access to the complete settings JSON document;
- exposure of notification credentials, provider endpoints, model activation,
  admin/security keys or arbitrary request-selected JSON paths;
- claiming legacy `task_memory` or `memory` rows are mobile-subject-bound;
- adding new accepted M2 effect kinds or activating a production mediator;
- HTTP, WebSocket, TLS, listener, pairing, session or transport code;
- a real LLM, Ollama, GPU or mobile-device run.

## 3. Authority contract

`settings.read` projects only five Git-pinned, actually consumed UI values:
theme, density, font size, save-context and save-history. Missing storage uses
the established UI defaults; malformed storage fails closed. Unknown keys do
not become an oracle into the underlying JSON document. Every item and the
complete snapshot are content-addressed.

`settings.update` requires the exact fresh snapshot revision, a typed allowlist
value, the provider's authenticated subject/device context, the durable M7
operation journal and an injected mutation mediator naming `ApprovalGrant@1`,
`EffectRequest@1` and `EffectResult@1`. The adapter supplies the write callback;
pending or rejected mediation cannot reach it. The production mediator is not
composed in this block, so the provider remains inactive.

`stored-information.append` creates only `manual_note` rows in migration 102.
Rows are append-only, partitioned by subject, optionally project-scoped and
bound to a stable operation identity. Project authorization is checked before
mediation and again immediately before insert. `stored-information.list`
authorizes project identities before reading protected content, rechecks them
before release and uses the shared HMAC cursor bound to subject, device,
filters and the complete snapshot. Legacy task/long-term kinds return an
explicit typed unavailable result instead of a false empty page.

## 4. Demonstration and stop conditions

Required before review:

- secret-like and unrelated settings bytes never enter the mobile projection
  and survive an allowed update unchanged;
- stale, invalid, unknown, malformed, pending and rejected settings paths do
  not write;
- manual notes survive restart storage, replay exactly once, and cannot cross
  subject or denied project boundaries;
- revocation between approval and insert leaves no row and a durable UNKNOWN
  operation settlement;
- cursor tamper, filter drift and snapshot drift fail closed;
- direct invalid protected bytes become a typed read error;
- migration fingerprint, append-only triggers, migration oracles, registry,
  module ratchet and the complete offline+database gate are green.

Stop before production mediator composition, accepted-contract changes,
legacy-memory identity migration, listener/session work or physical/runtime
model tests.

## 5. Output

This section is filled only after the exact product candidate and evidence are
committed. Until then the block remains `IMPLEMENTATION_IN_PROGRESS`.
