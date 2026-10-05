# HTTP Items — generated candidate, not accepted

**PHYSICAL_ORACLE_PASS_API_SOURCE_REVIEW_FAIL_NOT_ACCEPTED.**

Four exact generated modules, **26,139 bytes**, from the real CODE → public
M2 preview → exact approval → sandbox test → commit → backend restart journey.
No generated source was edited or formatted. This candidate is excluded from
the parent list of 24 accepted modules. `MANIFEST.json` pins every source byte;
`API.md` preserves the original frozen contract, including requirements that
this candidate does not satisfy.

## Provenance and measured result

IntentSmith source `65ad7c054d2edc9e9316bc77c15f6b7b2fa5a370`, generated
project commit `1856920fea6c31b8fc0f6618e1499967cdccd362`, completed
2026-10-05 01:59:30 UTC. Eight CODE calls total: six historical and two new;
D1/CLI calls zero. Qwen3.8 digest
`22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643`,
provider `0.34.0-intentsmith.1`, context 32,768, new repair output cap 4,096.
The new outputs completed normally at 736 and 1,150 tokens.

Independent combined review SHA-256:
`895d651c71e02c4651f645f362c4c07b7ae3667d89afd81976ac0dc903569e52`.
Independent source/API review SHA-256:
`87a4b8a51b3e70022d0ca9e56ff1fa14502b46c6bca533a544c7c590209af184`.
They verified raw output → compiler → preview → durable material → filesystem
→ original Git bytes, 70 HTTP requests, 14 refused SQL cases and 14 paired
positive controls, AUTOINCREMENT, exact approval, rollback 4/4 and cleanup.

## Remaining defects

| Finding | Evidence and limit |
| --- | --- |
| A1: noncanonical URL aliases | Router splits on `/` and drops empty components; item paths such as `/items//1`, `//items/1` and `/items/1/` reach the canonical handler. Static source finding; these exact HTTP requests were not run. |
| A2: dynamic import | Server uses `await import('node:url')`; frozen API permits literal static imports only. Direct syntax violation. |
| A3: charset handling | Router rejects quoted UTF-8 charset and whitespace before the semicolon. Review flags a standard media-type interpretation gap; exact HTTP variants were not run. |

A1 and A2 already prevent full acceptance. Passing the frozen functional
oracle does not override the source/API review. Historical failed attempts
and the exhausted eight-call budget remain unchanged.

## Scope

SQLite rows persisted between two server processes reopening the same private
database within one sandbox. Separate sandbox invocations have fresh private
`/tmp`; persistence between those invocations is not claimed. Backend restart
verified durable M2/source/Git state and replay without duplicate effects.

This export contains source and contract identities only: no DB, credentials,
runtime IDs, prompts, responses, dependencies or private Git objects. It adds
no execution or model call. See the [HTTP WP](../../../docs/wp/WP-M2-PRIVATE-HTTP-EXECUTION-20261004.md)
and [current completion report](../../../docs/WORK-PROGRESS.md).
