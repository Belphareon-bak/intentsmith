# Gate 0 evidence: repaired E2E 60–63

Candidate:

- branch: `codex/intentsmith-1.0`;
- commit: `3924999efa34c5c40cd4d55cb9edbfbe4543692c`;
- source commit integrated without its original commit object:
  `c715f66e90235952cba7e0d42cc15b49148f1b60`;
- execution date: 2026-07-30 Europe/Prague;
- all runtime files were below ignored private
  `.intentsmith-artifacts/g0-e2e-60-63/` roots.

## Deterministic regressions

Each command used a separate private directory as `HOME`, `TMPDIR` and the
parent of `C3_DB_PATH`:

```bash
env HOME=.intentsmith-artifacts/g0-e2e-60-63/ws \
  TMPDIR=.intentsmith-artifacts/g0-e2e-60-63/ws \
  C3_DB_PATH=.intentsmith-artifacts/g0-e2e-60-63/ws/post-3924999.sqlite \
  node tests/ws-bridge.test.js

env HOME=.intentsmith-artifacts/g0-e2e-60-63/llm \
  TMPDIR=.intentsmith-artifacts/g0-e2e-60-63/llm \
  C3_DB_PATH=.intentsmith-artifacts/g0-e2e-60-63/llm/post-3924999.sqlite \
  node tests/llm-gateway-runtime-signal.test.js

env HOME=.intentsmith-artifacts/g0-e2e-60-63/cre \
  TMPDIR=.intentsmith-artifacts/g0-e2e-60-63/cre \
  C3_DB_PATH=.intentsmith-artifacts/g0-e2e-60-63/cre/post-3924999.sqlite \
  node tests/cre-build-arbitration.test.js

env HOME=.intentsmith-artifacts/g0-e2e-60-63/chat \
  TMPDIR=.intentsmith-artifacts/g0-e2e-60-63/chat \
  C3_DB_PATH=.intentsmith-artifacts/g0-e2e-60-63/chat/post-3924999.sqlite \
  node tests/chat-fixes.test.js
```

| Program | Result | Exit |
|---|---:|---:|
| `tests/ws-bridge.test.js` | 46 passed, 0 failed | 0 |
| `tests/llm-gateway-runtime-signal.test.js` | 4 passed, 0 failed | 0 |
| `tests/cre-build-arbitration.test.js` | 7 passed, 0 failed | 0 |
| `tests/chat-fixes.test.js` | 58 passed, 0 failed | 0 |

The WS regression includes two negative cancellation cases: a provider that
rejects with an ordinary error after abort must surface canonical `AbortError`,
and an abort between controller completion and the quality stage must leave
only the user turn in persistence.

## Model-free server suites

The isolated server started with:

```bash
env \
  HOME=/home/belphareon/Projects/intentsmith-gate0-repro/.intentsmith-artifacts/g0-e2e-60-63/post-3924999/home \
  TMPDIR=/home/belphareon/Projects/intentsmith-gate0-repro/.intentsmith-artifacts/g0-e2e-60-63/post-3924999/tmp \
  NODE_ENV=test C3_AUDIT_RUN=1 \
  C3_DB_PATH=/home/belphareon/Projects/intentsmith-gate0-repro/.intentsmith-artifacts/g0-e2e-60-63/post-3924999/runtime/intentsmith-test.sqlite \
  C3_PROJECTS_DIR=/home/belphareon/Projects/intentsmith-gate0-repro/.intentsmith-artifacts/g0-e2e-60-63/post-3924999/projects \
  INTENTSMITH_TEST_PROJECTS_DIR=/home/belphareon/Projects/intentsmith-gate0-repro/.intentsmith-artifacts/g0-e2e-60-63/post-3924999/projects \
  INTENTSMITH_TEST_ARTIFACT_DIR=/home/belphareon/Projects/intentsmith-gate0-repro/.intentsmith-artifacts/g0-e2e-60-63/post-3924999/artifacts \
  C3_PORT=0 \
  C3_PORT_FILE=/home/belphareon/Projects/intentsmith-gate0-repro/.intentsmith-artifacts/g0-e2e-60-63/post-3924999/runtime/intentsmith.port \
  C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false \
  C3_LOG_LEVEL=warn OLLAMA_URL=http://127.0.0.1:9 \
  node src/server.js
```

It reported `C3_READY:40273`. The deliberately unreachable Ollama address makes
any hidden model dependency fail. With the same environment plus
`C3_URL=http://127.0.0.1:40273`, these exact programs ran:

```bash
node tests/e2e/60-ws-chat.e2e.js
node tests/e2e/63-agent-execution.e2e.js
```

| Program | Result | Exit |
|---|---:|---:|
| `tests/e2e/60-ws-chat.e2e.js` | 3 passed, 0 failed, 0 skipped | 0 |
| `tests/e2e/63-agent-execution.e2e.js` | 5 passed, 0 failed, 0 skipped | 0 |

## Model-backed suites

`curl --fail --silent --show-error http://127.0.0.1:11434/api/tags` exited 0
before execution and listed the default CHAT model `qwen3.5:27b`. A separate
isolated server used `OLLAMA_URL=http://127.0.0.1:11434` and reported
`C3_READY:32787`. With the same owned paths plus
`C3_URL=http://127.0.0.1:32787`, these programs ran:

```bash
node tests/e2e/61-autocomplete.e2e.js
node tests/e2e/62-validation-suites.e2e.js
```

| Program | Result | Exit |
|---|---:|---:|
| `tests/e2e/61-autocomplete.e2e.js` | 3 passed, 0 failed, 0 skipped | 0 |
| `tests/e2e/62-validation-suites.e2e.js` | 4 passed, 0 failed, 0 skipped | 0 |

Both servers bound only to loopback and were stopped after their runs. No
runtime database, port file, log or generated test output is tracked.

## Independent review follow-up

An independent runtime and mutation review accepted the cancellation race
repairs but found that the final guard immediately before assistant persistence
was not pinned by `T16c`: that test aborted while reading the response tag and
therefore exercised an earlier guard. The follow-up adds a distinct regression
that aborts only when `QualityTelemetry` is emitted, then requires canonical
rejection and exactly one persisted user turn. It also centralizes the
`AbortError` contract, removes the redundant synchronous guard and propagates a
stale-turn timeout as `timeout` rather than `cancelled_by_user`.

The same review reproduced a separate residual with an unreachable loopback
provider: HTTP returned 200, WebSocket emitted an assistant plus
`turn_end.status: "ok"`, and each path persisted an assistant error banner.
That behavior is not presented as fixed by this follow-up. It is recorded as
the blocking runtime risk `G0-R025`; suite 60's deterministic local-math result
proves only its model-free path.

### Follow-up candidate and positive evidence

The cancellation follow-up candidate is
`aa2062bd96680a2aff67de7eb5325b29cde51d07`. Every database-backed command used
its own ignored root below
`.intentsmith-artifacts/g0-review-followup/post-aa2062b/`:

```bash
env HOME=<root>/<program>/home \
  TMPDIR=<root>/<program>/tmp \
  C3_DB_PATH=<root>/<program>/runtime/test.sqlite \
  node <program>
```

| Program or validator | Result | Exit |
|---|---:|---:|
| `tests/ws-bridge.test.js` | 49 passed, 0 failed | 0 |
| `tests/llm-gateway-runtime-signal.test.js` | 5 passed, 0 failed | 0 |
| `tests/chat-fixes.test.js` | 58 passed, 0 failed | 0 |
| `tests/cre-build-arbitration.test.js` | 7 passed, 0 failed | 0 |
| `tests/chat-persistence.test.js` | 35 passed, 0 failed | 0 |
| `tests/telemetry.test.js` | 33 passed, 0 failed | 0 |
| `tests/artifact-validation.test.js` | 31 passed, 0 failed | 0 |
| `node scripts/validate-test-registry.js` | 350 programs; SHA-256 `0a652994c7d9dc5252b15e9eb8647e8dbc59967b508c2bf80cd6d516ecf15735` | 0 |

### Mutation evidence

A local no-hardlink clone at exact candidate `aa2062b` used the same isolated
environment contract. Removing only the final `throwIfAborted(signal)` directly
before `appendTurn()` and running:

```bash
env HOME=.intentsmith-artifacts/mutation/home \
  TMPDIR=.intentsmith-artifacts/mutation/tmp \
  C3_DB_PATH=.intentsmith-artifacts/mutation/runtime/test.sqlite \
  node tests/ws-bridge.test.js
```

produced `48 passed, 1 failed`, exit 1. The sole failure was `T16d`:
`Missing expected rejection`, proving that the persistence-boundary test fails
when its target guard is removed.

After restoring that guard, changing only the stale-sweep abort source from
`AbortSource.TIMEOUT` to `AbortSource.USER` and rerunning the same program with
a fresh isolated database produced `48 passed, 1 failed`, exit 1. The sole
failure was `T10c`, which observed `Zpracování zrušeno.` instead of the required
timeout contract. Neither mutation touched the integration worktree.

### Typed-source review follow-up

A second independent review reproduced both mutation results above and found
two additional precedence gaps. A typed `user` abort whose message contained
the word `timeout` was classified as a timeout by the legacy text heuristic,
while native `AbortSignal.timeout()` carried a `TimeoutError` reason that the
shared canonicalizer treated as a user cancellation. The upstream timeout also
reported the gateway's configured model deadline rather than its actual origin.

The follow-up makes a typed source authoritative over message text, restricts
the legacy text heuristic to non-abort errors, recognizes native
`TimeoutError`, and distinguishes `upstream` from `gateway` deadlines in both
audit and runtime-signal payloads. Direct regressions cover the contradictory
user/message case, native timeout, upstream stale timeout and a gateway-owned
deadline. The provider-outage residual remains separate as `G0-R025`.

The exact typed-source candidate is
`dcf7753ccc604fbec2fa1b87cc8235f8c4726a4b`, with parent
`32629f6283be5188655697a777a0b74c4d3e39d0`. On the integration checkout, each
database-backed program ran with its own ignored `HOME`, `TMPDIR` and
`C3_DB_PATH` below `.intentsmith-artifacts/g0-review-followup/post-dcf7753/`:

| Program or validator | Result | Exit |
|---|---:|---:|
| `tests/ws-bridge.test.js` | 50 passed, 0 failed | 0 |
| `tests/llm-gateway-runtime-signal.test.js` | 7 passed, 0 failed | 0 |
| `tests/chat-fixes.test.js` | 58 passed, 0 failed | 0 |
| `tests/cre-build-arbitration.test.js` | 7 passed, 0 failed | 0 |
| `tests/artifact-validation.test.js` | 31 passed, 0 failed | 0 |
| `node scripts/validate-test-registry.js` | 350 programs; SHA-256 `a7a5c6d4670159cd38a08edea8aabbf868eb3342a3baf1857b6a4849d1f4960a` | 0 |
| `node scripts/reconcile-ffd-e2e-registry.js --check` | 78 disputed E2E suites; BLOCKED 78; path SHA-256 `43108129171be799d282df0fc5b7db5d40daefda0bbcebe5cc287f3139b033ff` | 0 |
| `node scripts/validate-final-disposition.js` | 225 records; all 92 `REBUILD` rows terminal | 0 |

An independent reviewer repeated `git diff --check`, syntax checks and the WS
and LLM programs from a `git archive` of the exact candidate. The archive runs
produced `50 passed, 0 failed` and `7 passed, 0 failed`, both exit 0. Runtime
and audit payloads agreed that upstream stale and native timeouts have
`timeoutOrigin: "upstream"` and `timeoutMs: null`, while the 5 ms
gateway-owned deadline has `timeoutOrigin: "gateway"` and `timeoutMs: 5`. The
review verdict was `ACCEPT`, with no new blocker in this change scope.

Two mutation runs pinned the new boundaries in a detached worktree at exact
candidate `dcf7753`. Reintroducing message-first classification:

```js
abortSource === AbortSource.TIMEOUT || err.message?.includes('timeout')
```

and running the isolated WS program produced `49 passed, 1 failed`, exit 1.
The sole failure was `T10d`: it observed `timeout` instead of the required
typed-user result `cancelled_by_user`.

After restoring the file, removing only native `TimeoutError` recognition from
`sourceFromReason()` and running:

```bash
env HOME=.intentsmith-artifacts/mutation-native-timeout/home \
  TMPDIR=.intentsmith-artifacts/mutation-native-timeout/tmp \
  C3_DB_PATH=.intentsmith-artifacts/mutation-native-timeout/runtime/native-timeout.sqlite \
  node tests/llm-gateway-runtime-signal.test.js
```

produced `6 passed, 1 failed`, exit 1. The sole failure expected abort source
`timeout` but observed `user`. The tracked files were restored to the exact
candidate before the temporary worktree was removed.
