# M6 L0-11 current-snapshot verification — 2026-09-11

Status: `IMPLEMENTED / CURRENT_SNAPSHOT_GREEN / RE_REVIEW_REQUIRED`.

Core implementation anchor:
`4f300269fde62c749d566496ee87f63cae49fab5`.

Verified current snapshot:
`12b63e58f2c0669fa47ccbcf295caab87b498728`.

The original durable repository and migration remain present, but later model
evaluation, binding, gateway, server and M7 work substantially changed several
consumers. This checkpoint therefore verifies the listed current blobs rather
than treating the old implementation commit as sufficient review scope.

## Current authority path

Production startup creates `ModelArtifactAuthorityRepository` from the live
SQLite handle, binds the process singleton `modelUseAuthority` exactly once
before binding rehydrate, gives the same repository to `UpgradeManager`, and
requires durable use/effect authority when initializing `ModelRegistry`.

The current consumers are:

- `LLMGateway`: one `LLM_GATEWAY` shared claim from semaphore admission across
  artifact checks, every provider attempt, retry delay, cancel/error paths and
  final release;
- `ModelRegistry` validation: `MODEL_VALIDATION` shared claim around exact
  inventory/digest validation;
- `ModelBindingApplication`: sorted shared claims around binding cutover and
  verification so current and target artifacts cannot be deleted mid-step;
- `VRAMManager`: `VRAM_ARTIFACT_USE` shared claim from task dequeue through its
  `finally`; this is artifact protection, not global GPU-residency exclusion;
- `UpgradeManager` pull and `ModelRegistry` delete: exclusive claims plus an
  immutable durable intent before the provider effect and append-only terminal
  outcome afterwards.

Migration 098 fingerprints its tables, indexes and triggers. Claims carry boot
ID, PID, UID and `/proc` start ticks. Acquisition uses an immediate SQLite
transaction, only proven `GONE` owners are recovered and `UNKNOWN` stays a
fence. Unsettled intent or `ORPHANED` outcome blocks new use/mutation. Pull may
resume only its exact operation/name/origin; delete orphan is not auto-cleared.
Destructive endpoints accept only uncredentialed HTTP loopback root origins and
the exact `/api/pull` or `/api/delete` path.

## Registered verification

The primary audit ran all seven programs serially from the clean exact snapshot.
It returned `PASS`, 7/7 programs, no fail, timeout, blocker, skip or retry:

| Program | Cases | Result |
|---|---:|---|
| `llm-gateway-runtime-signal` | 7 | PASS |
| `m1-model-binding-application` | 109 | PASS |
| `m1-model-use-authority` | 27 | PASS |
| `m1-vram-artifact-use` | 8 | PASS |
| `m6-model-artifact-authority` | 11 | PASS |
| `model-registry-current-authority` | 15 | PASS |
| `schema-migrations` | 55 | PASS |

Report:
`.intentsmith-artifacts/m6-l0-11/m6-l0-11-current-20260911-01/report.json`,
SHA-256 `6c88a6e7b5af9ce2d61148587876615f0098b1f874f178757309614e6215252f`.
The report binds every suite log; their SHA-256 values are, in table order:
`f6cf50eb...b75f9`, `45abf1d7...e3569`, `be851ce7...d138`,
`964ce75f...fd32`, `07e0f399...ab2d`, `efa3e20d...f247` and
`977ca491...758b`.

A second registered support audit on the same clean snapshot returned 2/2
programs `PASS`: artifact/documentation validation 158/158 and module boundary
ratchet 13/13. Report SHA-256:
`ce6e6c5117d00a128426c64bb5e19b043a944b48f2731925af26f33ca7cc3c27`.

Neither audit contacted Ollama, used a GPU, changed the production DB or
performed a real pull/delete. The database and provider paths use isolated
fixtures and loopback where required. These are current integration and
adversarial contract proofs, not a destructive production demonstration.

## Exact review scope

The review packet lists the 17 authoritative product/test blobs at the verified
snapshot. Relevant source changes since `4f300269` are intentionally in scope;
unrelated documentation-only commits after `12b63e58` are not product changes.

Independent review input:
[`2026-09-11-M6-L0-11-CURRENT-SNAPSHOT-REVIEW-PACKET`](../../../review/2026-09-11-M6-L0-11-CURRENT-SNAPSHOT-REVIEW-PACKET.md).
No `REVIEW_PASSED`, M6 acceptance, push, tag, activation or publication is
claimed by this checkpoint.
