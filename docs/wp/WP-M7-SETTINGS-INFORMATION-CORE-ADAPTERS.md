# WP-M7-SETTINGS-INFORMATION-CORE-ADAPTERS

**Type:** write-enabled M7 core capability block

**Base revision:** `35a82422` (conversation-core evidence HEAD)

**Current state:** `IMPLEMENTATION_GREEN / FULL_GATE_GREEN / REVIEW_PENDING /
NOT_ACTIVE`

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

The exact product candidate is
`1b0654f01784a9ae41c2cfbb1e5345c74b6f3c6e` with tree
`ea40b1bc3559302d425afe4b0cb2278e79cc57a6`. The review range is
`35a82422..1b0654f0` and consists of implementation `31f46cac`, two accepted
module edges `5e0373d1`, documentation pin `9296338c`, M6 runtime evidence
rebind `cbdb0300` and M6 technical-evidence fixture rebind `1b0654f0`.

Focused evidence passed: adapter `10/10`, schema `55/55`, M1 schema `20/20`,
provider `11/11`, journal `12/12`, mobile contract/provider `11/11 + 14/14`,
mobile gate `25/25`, M6 runtime/technical/release `8/8 + 8/8 + 13/13`, module
ratchet `13/13` and artifact validation `158/158`. Registry fingerprint is
`f322661b468ed5dc202ba6c37743a7002d8b9c251cedbb539b4a5b553f72a53a`.

The complete offline+database gate on the exact candidate returned
`330 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED`, verdict `PASS`, exit
0. The raw report SHA-256 is
`cd8b180e7f6785ab92b0588f0cbc5dd34a096678b5ea58c3fb3767a84d24c11d`.
Two earlier runs remain recorded as `FAIL`: `328/330` exposed both M6 runtime
and nightly-orchestrator migration/registry drift, and `329/330` exposed the
remaining M6 technical-evidence migration fixture. Neither is presented as
green.

Independent review is still required. No production mediator, provider
composition, listener, session, pairing, transport, model, GPU or device path
was activated.
