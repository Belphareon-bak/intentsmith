# Gate 0 — G0-R023 immutable self-refinement evidence

Status: verified repair evidence

Base commit: `265b87729628c7d21d9fea5ccef1c282ebd94170`

Implementation commit: `48dcdc04a08463a5693368e2dba0cf64b5722dc2`

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
7. The real `ChatController.handle()` path scores, persists, and returns the
   same accepted refinement through its production finalizer wiring.

## Exact-commit proof

All commands used isolated `HOME`, `TMPDIR`, and `C3_DB_PATH` values below
`/tmp/intentsmith-g0-r023-impl.zjcPSn`. No model, GPU, external network, server,
or `data/c3.db` was used. The worktree was clean at
`48dcdc04a08463a5693368e2dba0cf64b5722dc2` before these commands ran.

| Command | Result | Exit |
|---|---|---:|
| `node --check src/chat/response-finalizer.js && node --check src/chat/controller.js && node --check tests/ws-bridge.test.js` | syntax valid | 0 |
| `env HOME=/tmp/intentsmith-g0-r023-impl.zjcPSn/home TMPDIR=/tmp/intentsmith-g0-r023-impl.zjcPSn/tmp C3_DB_PATH=/tmp/intentsmith-g0-r023-impl.zjcPSn/runtime/ws-48dcdc0.sqlite node tests/ws-bridge.test.js` | 53 passed, 0 failed | 0 |
| `env HOME=/tmp/intentsmith-g0-r023-impl.zjcPSn/home TMPDIR=/tmp/intentsmith-g0-r023-impl.zjcPSn/tmp C3_DB_PATH=/tmp/intentsmith-g0-r023-impl.zjcPSn/runtime/improvement-48dcdc0.sqlite node tests/improvement-loops.test.js` | 21 passed, 0 failed, 0 skipped | 0 |
| `env HOME=/tmp/intentsmith-g0-r023-impl.zjcPSn/home TMPDIR=/tmp/intentsmith-g0-r023-impl.zjcPSn/tmp C3_DB_PATH=/tmp/intentsmith-g0-r023-impl.zjcPSn/runtime/chat-persistence-48dcdc0.sqlite node tests/chat-persistence.test.js` | 35 passed, 0 failed | 0 |
| `env HOME=/tmp/intentsmith-g0-r023-impl.zjcPSn/home TMPDIR=/tmp/intentsmith-g0-r023-impl.zjcPSn/tmp C3_DB_PATH=/tmp/intentsmith-g0-r023-impl.zjcPSn/runtime/quality-telemetry-48dcdc0.sqlite node tests/quality-telemetry.test.js` | 34 passed, 0 failed | 0 |
| `env HOME=/tmp/intentsmith-g0-r023-impl.zjcPSn/home TMPDIR=/tmp/intentsmith-g0-r023-impl.zjcPSn/tmp C3_DB_PATH=/tmp/intentsmith-g0-r023-impl.zjcPSn/runtime/modules-48dcdc0.sqlite node tests/modules.test.js` | 23 passed, 0 failed, 0 skipped | 0 |
| `env HOME=/tmp/intentsmith-g0-r023-impl.zjcPSn/home TMPDIR=/tmp/intentsmith-g0-r023-impl.zjcPSn/tmp C3_DB_PATH=/tmp/intentsmith-g0-r023-impl.zjcPSn/runtime/registry-48dcdc0.sqlite node scripts/validate-test-registry.js` | 350 runnable programs; registry hash `a7a5c6d4670159cd38a08edea8aabbf868eb3342a3baf1857b6a4849d1f4960a` | 0 |
| `env HOME=/tmp/intentsmith-g0-r023-impl.zjcPSn/home TMPDIR=/tmp/intentsmith-g0-r023-impl.zjcPSn/tmp C3_DB_PATH=/tmp/intentsmith-g0-r023-impl.zjcPSn/runtime/hygiene-48dcdc0.sqlite node tests/repository-hygiene.test.js` | 1,336 tracked paths checked | 0 |
| `git status --short --branch && git rev-parse HEAD && git diff --exit-code && git diff --cached --exit-code` | clean branch; exact HEAD `48dcdc04a08463a5693368e2dba0cf64b5722dc2` | 0 |

The first sandboxed hygiene invocation could not spawn `git ls-files` and
failed with `spawnSync git EPERM`. The same read-only command was repeated
outside that process sandbox and passed; this was an execution-environment
restriction, not a product assertion failure.

The dependency tree was copied locally from an existing installation whose
`package-lock.json` SHA-256 matched this worktree:
`496a21b7266c3a84a28384cd5b562414796e9e6ec8e884f402bd7ffc235a7d38`.
No dependency fetch occurred.

## Independent-review follow-up

Independent review found that the helper-level tests were mutation-sensitive,
but did not pin the production callback that connects `ChatController.handle()`
to assistant-turn persistence. In an isolated copy, changing that callback from
its `content` argument back to immutable `result.content` left the original
suite green at `53/53`.

Commit `5407bac1930a73bc81a443dfa99ab594a1374b29` adds a controller-level
regression through the real static `ChatController.handle()` path. It uses the
existing production handler configuration and a process-local `fetch` fixture
at the Ollama gateway boundary; it does not add request-controlled or
production dependency injection. The test requires one accepted refinement to
be the exact value returned and stored as the assistant turn, requires its
quality score to be `79`, and rechecks that the original `TaggedResponse`
remains frozen and unchanged.

| Command | Result | Exit |
|---|---|---:|
| `env HOME=/tmp/intentsmith-r023-review-20260730/home TMPDIR=/tmp/intentsmith-r023-review-20260730/tmp C3_DB_PATH=/tmp/intentsmith-r023-review-20260730/runtime/ws-controller-integration.sqlite node tests/ws-bridge.test.js` | 54 passed, 0 failed | 0 |
| from isolated archive `/tmp/intentsmith-r023-review-20260730/mutation-current`, change only `store.appendTurn(..., content, ...)` to `store.appendTurn(..., result.content, ...)`; `env HOME=/tmp/intentsmith-r023-review-20260730/home TMPDIR=/tmp/intentsmith-r023-review-20260730/tmp C3_DB_PATH=/tmp/intentsmith-r023-review-20260730/runtime/ws-controller-mutation-detected.sqlite node tests/ws-bridge.test.js` | `G0-R023d` failed on the persisted original-versus-refined identity; 53 passed, 1 failed | 1 |

## Remaining boundary

This evidence closes only the deterministic G0-R023 repair candidate. It does
not claim that the complete Gate 0 registry, model-backed E2E suites, or Gate 0
as a whole pass. The focused immutable-response failure is repaired and
reproducibly covered, so `G0-R023` may move from `OPEN` to `MITIGATED`.
