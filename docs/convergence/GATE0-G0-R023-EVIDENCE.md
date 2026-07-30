# Gate 0 — G0-R023 immutable self-refinement evidence

Status: implementation candidate; exact-commit verification pending

Base commit: `265b87729628c7d21d9fea5ccef1c282ebd94170`

Branch: `codex/g0-r023-immutable-refinement`

Date: 2026-07-30

## Finding

`TaggedResponse` is deliberately frozen and exposes `content` through a getter
without a setter. The centralized self-refinement path nevertheless assigned an
accepted candidate back to `result.content`.

An isolated deterministic reproduction on the base commit used the real
`improveResponse()` implementation and a fake model result. The candidate was
accepted with score `60 -> 79`, after which the assignment failed:

```text
TypeError: Cannot set property content of #<TaggedResponse> which has only a getter
{"resultStillOriginal":true,"acceptedCandidateLost":true}
```

The outer non-fatal catch allowed the primary response to complete, but the
accepted candidate was neither scored, persisted, nor returned. Telemetry also
reported `refined: needsRefinement`, which described eligibility rather than
whether refinement was actually applied.

## Repair

- Keep `TaggedResponse` frozen and getter-only.
- Carry the selected response in a local `finalContent` value.
- Use that same value for final scoring, assistant-turn persistence, and the
  returned response.
- Track `refinementApplied` separately from eligibility and use it in telemetry.
- Preserve the existing cancellation checks immediately before quality work and
  immediately before assistant persistence.
- Use injectable deterministic dependencies only inside the finalization helper;
  the production caller uses the existing improvement, scorer, and CRE bridge.

Changed implementation and regression scope:

- `src/chat/controller.js`
- `src/chat/response-finalizer.js`
- `tests/ws-bridge.test.js`

No registry, generator, nightly, disposition, generated status, or database file
is part of this change.

## Mutation-sensitive coverage

The registered `tests/ws-bridge.test.js` suite now requires:

1. `TaggedResponse` remains frozen, getter-only, and rejects content assignment.
2. A deterministic candidate accepted by the real improvement loop is the exact
   value scored, persisted, and returned.
3. The immutable handler result remains unchanged.
4. Accepted refinement emits `refined: true` and no mutation warning.
5. A rejected candidate is not scored, persisted, or returned.
6. Eligibility without application emits `refined: false` and no failure warning.

## Candidate-tree proof

All commands used isolated `HOME`, `TMPDIR`, and `C3_DB_PATH` values below
`/tmp/intentsmith-g0-r023-impl.zjcPSn`. No model, GPU, external network, server,
or `data/c3.db` was used.

| Command | Result | Exit |
|---|---|---:|
| `node --check src/chat/response-finalizer.js && node --check src/chat/controller.js && node --check tests/ws-bridge.test.js` | syntax valid | 0 |
| `node tests/ws-bridge.test.js` | 53 passed, 0 failed | 0 |
| `node tests/improvement-loops.test.js` | 21 passed, 0 failed, 0 skipped | 0 |
| `node tests/chat-persistence.test.js` | 35 passed, 0 failed | 0 |
| `node tests/quality-telemetry.test.js` | 34 passed, 0 failed | 0 |
| `node tests/modules.test.js` | 23 passed, 0 failed, 0 skipped | 0 |
| `node scripts/validate-test-registry.js` | 350 runnable programs; registry hash `a7a5c6d4670159cd38a08edea8aabbf868eb3342a3baf1857b6a4849d1f4960a` | 0 |
| `node tests/repository-hygiene.test.js` | 1,334 tracked paths checked | 0 |
| `git diff --check` | no whitespace errors | 0 |

The first sandboxed hygiene invocation could not spawn `git ls-files` and
failed with `spawnSync git EPERM`. The same read-only command was repeated
outside that process sandbox and passed; this was an execution-environment
restriction, not a product assertion failure.

The dependency tree was copied locally from an existing installation whose
`package-lock.json` SHA-256 matched this worktree:
`496a21b7266c3a84a28384cd5b562414796e9e6ec8e884f402bd7ffc235a7d38`.
No dependency fetch occurred.

## Remaining boundary

This evidence closes only the deterministic G0-R023 repair candidate. It does
not claim that the complete Gate 0 registry, model-backed E2E suites, or Gate 0
as a whole pass. The exact implementation commit must be rerun before
`G0-R023` changes from `OPEN` to `MITIGATED`.
