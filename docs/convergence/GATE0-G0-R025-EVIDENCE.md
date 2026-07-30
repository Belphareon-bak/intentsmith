# Gate 0 evidence: G0-R025 provider-outage truthfulness

Candidate:

- branch: `codex/g0-r025-provider-failure`;
- base commit: `265b87729628c7d21d9fea5ccef1c282ebd94170`;
- tested implementation commit:
  `474983b5a504763319d96c770fde0ff16d28030d`;
- execution date: 2026-07-30 Europe/Prague;
- generated Gate 0 status/index/baseline files were not edited.

The implementation converts every response with `metadata.error === true` into
a typed terminal failure before quality/refinement and assistant persistence.
The existing provider error types map to:

```json
{
  "error": "Model provider is temporarily unavailable.",
  "code": "LLM_PROVIDER_UNAVAILABLE",
  "recoverable": true
}
```

Both HTTP chat routes return this body with status 503. WebSocket chat emits no
assistant message, emits `turn_end.status: "error"`, a typed `error` event and
a system message. The accepted user turn remains persisted; the failed
assistant turn does not.

Cancellation retains precedence when an abort and provider result race. Typed
user cancellation and typed stale-turn timeout behavior are covered by the
same WS regression suite.

## Installation

The dedicated worktree had no `node_modules`. Dependencies were restored from
the local npm cache:

```bash
npm ci --ignore-scripts --offline
npm rebuild better-sqlite3 --offline
```

Results:

- `npm ci`: 233 packages added, 0 vulnerabilities, exit 0;
- native `better-sqlite3` rebuild: `rebuilt dependencies successfully`, exit 0.

## Commit-bound deterministic runs

Immediately before execution:

```bash
git status --porcelain=v1 --untracked-files=all
git rev-parse HEAD
```

Results: empty status, exit 0; HEAD
`474983b5a504763319d96c770fde0ff16d28030d`, exit 0.

Each program used a separate private `HOME`, `TMPDIR` and `C3_DB_PATH` below
`.intentsmith-artifacts/g0-r025/post-474983b/<program>/`:

```bash
env \
  HOME=/home/belphareon/Projects/coworker/intentsmith-g0-r025/.intentsmith-artifacts/g0-r025/post-474983b/ws/home \
  TMPDIR=/home/belphareon/Projects/coworker/intentsmith-g0-r025/.intentsmith-artifacts/g0-r025/post-474983b/ws/tmp \
  C3_DB_PATH=/home/belphareon/Projects/coworker/intentsmith-g0-r025/.intentsmith-artifacts/g0-r025/post-474983b/ws/runtime/test.db \
  INTENTSMITH_TEST_SOURCE_REVISION=474983b5a504763319d96c770fde0ff16d28030d \
  node tests/ws-bridge.test.js

env \
  HOME=/home/belphareon/Projects/coworker/intentsmith-g0-r025/.intentsmith-artifacts/g0-r025/post-474983b/routes/home \
  TMPDIR=/home/belphareon/Projects/coworker/intentsmith-g0-r025/.intentsmith-artifacts/g0-r025/post-474983b/routes/tmp \
  C3_DB_PATH=/home/belphareon/Projects/coworker/intentsmith-g0-r025/.intentsmith-artifacts/g0-r025/post-474983b/routes/runtime/test.db \
  INTENTSMITH_TEST_SOURCE_REVISION=474983b5a504763319d96c770fde0ff16d28030d \
  node tests/routes-smoke.test.js
```

Results:

- `tests/ws-bridge.test.js`: 53 passed, 0 failed, exit 0;
- `tests/routes-smoke.test.js`: 50 passed, 0 failed, exit 0.

The same isolated command shape was used for these regression programs:

| Program | Result | Exit |
|---|---:|---:|
| `tests/chat-persistence.test.js` | 35 passed, 0 failed | 0 |
| `tests/chat-fixes.test.js` | 58 passed, 0 failed | 0 |
| `tests/chat-output-quality.test.js` | 45 passed, 0 failed | 0 |
| `scripts/validate-test-registry.js` | 350 runnable programs, valid | 0 |
| `tests/artifact-validation.test.js` | 31 passed, 0 failed, 0 skipped | 0 |

The registry hash was
`a7a5c6d4670159cd38a08edea8aabbf868eb3342a3baf1857b6a4849d1f4960a`.

## Mutation checks

Three temporary source mutations were applied one at a time and restored
without committing:

1. removing `throwIfTerminalChatFailure(result)` made T16f report
   `Missing expected rejection`; WS suite 51 passed / 1 failed, exit 1;
2. removing the terminal-error mapping from both HTTP catches made
   `tests/routes-smoke.test.js` throw
   `typed provider failure reached generic safeError`, exit 1;
3. removing the typed WS error mapping made T12b fail its exact payload
   assertion; WS suite 51 passed / 1 failed, exit 1.

The qualifying restored tree then returned:

- WS suite 53 passed / 0 failed, exit 0;
- routes suite 50 passed / 0 failed, exit 0;
- `git diff --check`, exit 0.

These mutations prove that the controller persistence boundary, HTTP 503
mapping and WS typed error mapping are each observed by a failing assertion.

## Commit-bound live provider outage

All writable server and client state was confined below ignored root
`.intentsmith-artifacts/g0-r025/post-474983b/live/`. The server bound an
ephemeral loopback port and used an intentionally unreachable provider:

```bash
env \
  HOME=/home/belphareon/Projects/coworker/intentsmith-g0-r025/.intentsmith-artifacts/g0-r025/post-474983b/live/home \
  XDG_CONFIG_HOME=/home/belphareon/Projects/coworker/intentsmith-g0-r025/.intentsmith-artifacts/g0-r025/post-474983b/live/xdg-config \
  XDG_CACHE_HOME=/home/belphareon/Projects/coworker/intentsmith-g0-r025/.intentsmith-artifacts/g0-r025/post-474983b/live/xdg-cache \
  XDG_DATA_HOME=/home/belphareon/Projects/coworker/intentsmith-g0-r025/.intentsmith-artifacts/g0-r025/post-474983b/live/xdg-data \
  XDG_STATE_HOME=/home/belphareon/Projects/coworker/intentsmith-g0-r025/.intentsmith-artifacts/g0-r025/post-474983b/live/xdg-state \
  XDG_RUNTIME_DIR=/home/belphareon/Projects/coworker/intentsmith-g0-r025/.intentsmith-artifacts/g0-r025/post-474983b/live/xdg-runtime \
  TMPDIR=/home/belphareon/Projects/coworker/intentsmith-g0-r025/.intentsmith-artifacts/g0-r025/post-474983b/live/tmp \
  TMP=/home/belphareon/Projects/coworker/intentsmith-g0-r025/.intentsmith-artifacts/g0-r025/post-474983b/live/tmp \
  TEMP=/home/belphareon/Projects/coworker/intentsmith-g0-r025/.intentsmith-artifacts/g0-r025/post-474983b/live/tmp \
  C3_DB_PATH=/home/belphareon/Projects/coworker/intentsmith-g0-r025/.intentsmith-artifacts/g0-r025/post-474983b/live/runtime/c3.db \
  C3_PROJECTS_DIR=/home/belphareon/Projects/coworker/intentsmith-g0-r025/.intentsmith-artifacts/g0-r025/post-474983b/live/projects \
  INTENTSMITH_TEST_PROJECTS_DIR=/home/belphareon/Projects/coworker/intentsmith-g0-r025/.intentsmith-artifacts/g0-r025/post-474983b/live/projects \
  INTENTSMITH_TEST_ARTIFACT_DIR=/home/belphareon/Projects/coworker/intentsmith-g0-r025/.intentsmith-artifacts/g0-r025/post-474983b/live/artifacts \
  INTENTSMITH_TEST_SOURCE_REVISION=474983b5a504763319d96c770fde0ff16d28030d \
  C3_HOST=127.0.0.1 C3_PORT=0 \
  C3_PORT_FILE=/home/belphareon/Projects/coworker/intentsmith-g0-r025/.intentsmith-artifacts/g0-r025/post-474983b/live/runtime/server.port.json \
  OLLAMA_URL=http://127.0.0.1:9 \
  NODE_ENV=test CI=1 NO_COLOR=1 C3_LOG_LEVEL=warn \
  C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false C3_ENABLE_COMFYUI=false \
  node src/server.js
```

The server reported `C3_READY:38579`. The client used the server-owned private
port file:

```bash
env \
  HOME=/home/belphareon/Projects/coworker/intentsmith-g0-r025/.intentsmith-artifacts/g0-r025/post-474983b/live/home \
  XDG_CONFIG_HOME=/home/belphareon/Projects/coworker/intentsmith-g0-r025/.intentsmith-artifacts/g0-r025/post-474983b/live/xdg-config \
  XDG_CACHE_HOME=/home/belphareon/Projects/coworker/intentsmith-g0-r025/.intentsmith-artifacts/g0-r025/post-474983b/live/xdg-cache \
  XDG_DATA_HOME=/home/belphareon/Projects/coworker/intentsmith-g0-r025/.intentsmith-artifacts/g0-r025/post-474983b/live/xdg-data \
  XDG_STATE_HOME=/home/belphareon/Projects/coworker/intentsmith-g0-r025/.intentsmith-artifacts/g0-r025/post-474983b/live/xdg-state \
  XDG_RUNTIME_DIR=/home/belphareon/Projects/coworker/intentsmith-g0-r025/.intentsmith-artifacts/g0-r025/post-474983b/live/xdg-runtime \
  TMPDIR=/home/belphareon/Projects/coworker/intentsmith-g0-r025/.intentsmith-artifacts/g0-r025/post-474983b/live/tmp \
  C3_PORT_FILE=/home/belphareon/Projects/coworker/intentsmith-g0-r025/.intentsmith-artifacts/g0-r025/post-474983b/live/runtime/server.port.json \
  INTENTSMITH_TEST_ARTIFACT_DIR=/home/belphareon/Projects/coworker/intentsmith-g0-r025/.intentsmith-artifacts/g0-r025/post-474983b/live/artifacts \
  INTENTSMITH_TEST_SOURCE_REVISION=474983b5a504763319d96c770fde0ff16d28030d \
  INTENTSMITH_TEST_SUITE_ID=IS-T3-E2E-60-WS-CHAT \
  NODE_ENV=test CI=1 NO_COLOR=1 \
  node tests/e2e/60-ws-chat.e2e.js
```

Result: 4 passed, 0 failed, 0 skipped, exit 0. The suite proved:

- the local deterministic `2+2=4` path remains a real assistant success;
- `/chat` and `/api/chat` return the exact provider-unavailable 503 body;
- the API conversation contains exactly one `user` and zero `assistant` rows;
- WS emits typed terminal error events, no assistant, and its conversation also
  contains exactly one `user` and zero `assistant` rows;
- cancellation and ping contracts remain intact.

The server was stopped with SIGINT after the suite and exited 0.

An initial sandboxed server start failed before test execution with
`listen EPERM: operation not permitted 127.0.0.1`, exit 1. This was an
environment restriction, not a product failure. The qualifying server and
client runs used explicit permission for loopback only.

## Independent review follow-up: in-memory history boundary

An independent read-only replay found that the implementation commit stopped
the error-tagged response before quality and durable `ConversationStore`
assistant persistence, but `ChatController.process()` had already added it to
its private in-memory `responseHistory`. A subsequent production
`ChatController.handle()` turn was not contaminated because DB-backed history
has priority, while a subsequent direct `controller.process()` call received
the prior provider-error banner in `context.history`.

The follow-up candidate moves the terminal guard immediately after response
tagging and before `#addToHistory()`. The surrounding catch explicitly
rethrows typed chat-turn errors after preserving cancellation precedence.
Direct `process()` callers therefore reject with the same typed provider error,
the failed response leaves `responseHistory` empty, and a later direct turn
receives no error banner. Exact-commit verification and mutation evidence are
pending for this follow-up commit.

## Disposition

`G0-R025` is `MITIGATED`. The original HTTP 200 / WS assistant+ok / persisted
assistant behavior is replaced by a tested fail-closed contract. A new
unrecognized `metadata.error` value still fails closed as HTTP 500 instead of
being accepted as assistant output; only recognized provider failures receive
the stable 503 classification.
