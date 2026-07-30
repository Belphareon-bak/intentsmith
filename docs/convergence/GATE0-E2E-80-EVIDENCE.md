# Gate 0 evidence: repaired E2E 80

Candidate:

- branch: `codex/intentsmith-1.0`;
- tested commit: `444781d2e15b4e340a63dbf008861571ecdac9d1`;
- implementation commit:
  `32629f6283be5188655697a777a0b74c4d3e39d0`;
- test blob:
  `c942b0cea4cf9a9a9f7767123cb1d7253ee61ca4`;
- source commits integrated without their original commit objects:
  `9a18345fbd2a45889935d2a98bcf09c51f366fef` and
  `d23efb3ef43fc58c2b84f64b6b48f92c9d0c9572`;
- execution date: 2026-07-30 Europe/Prague.

The original suite mixed HTTP orchestration with WebSocket observations and
contained permissive success paths. The repair sends the turn through the
WebSocket chat channel and requires:

- exact correlated LOCAL-turn envelopes, sequence and ordering;
- cancellation acknowledgement, `cancelled_by_user` and no assistant message;
- no cross-session event leakage after a causal barrier on both sockets;
- recovery from malformed raw JSON followed by exact ping/pong;
- closed sockets and hard-deleted conversation fixtures on every outcome.

Independent code review of the first source commit found that a barrier on only
the active socket could race with delivery to the passive socket, and that
sequential cleanup could strand later resources after an earlier close error.
The second source commit added a barrier on both sockets and
`Promise.allSettled` cleanup. The integrated test blob is identical to the blob
in implementation commit `32629f6`.

## Exact live run

All runtime state was confined below ignored root
`.intentsmith-artifacts/g0-e2e-80/post-444781d/`. The server used an ephemeral
loopback port, disabled lifecycle auto-commit and autonomy, and pointed Ollama
to an intentionally unreachable loopback endpoint:

```bash
env \
  HOME=/home/belphareon/Projects/intentsmith-gate0-repro/.intentsmith-artifacts/g0-e2e-80/post-444781d/home \
  TMPDIR=/home/belphareon/Projects/intentsmith-gate0-repro/.intentsmith-artifacts/g0-e2e-80/post-444781d/tmp \
  NODE_ENV=test C3_AUDIT_RUN=1 \
  C3_DB_PATH=/home/belphareon/Projects/intentsmith-gate0-repro/.intentsmith-artifacts/g0-e2e-80/post-444781d/runtime/intentsmith-test.sqlite \
  C3_PROJECTS_DIR=/home/belphareon/Projects/intentsmith-gate0-repro/.intentsmith-artifacts/g0-e2e-80/post-444781d/projects \
  INTENTSMITH_TEST_PROJECTS_DIR=/home/belphareon/Projects/intentsmith-gate0-repro/.intentsmith-artifacts/g0-e2e-80/post-444781d/projects \
  INTENTSMITH_TEST_ARTIFACT_DIR=/home/belphareon/Projects/intentsmith-gate0-repro/.intentsmith-artifacts/g0-e2e-80/post-444781d/artifacts \
  C3_PORT=0 \
  C3_PORT_FILE=/home/belphareon/Projects/intentsmith-gate0-repro/.intentsmith-artifacts/g0-e2e-80/post-444781d/runtime/intentsmith.port \
  C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false \
  C3_LOG_LEVEL=warn OLLAMA_URL=http://127.0.0.1:9 \
  node src/server.js
```

The server reported `C3_READY:39247`. With the same owned paths:

```bash
env \
  HOME=/home/belphareon/Projects/intentsmith-gate0-repro/.intentsmith-artifacts/g0-e2e-80/post-444781d/home \
  TMPDIR=/home/belphareon/Projects/intentsmith-gate0-repro/.intentsmith-artifacts/g0-e2e-80/post-444781d/tmp \
  C3_DB_PATH=/home/belphareon/Projects/intentsmith-gate0-repro/.intentsmith-artifacts/g0-e2e-80/post-444781d/runtime/intentsmith-test.sqlite \
  C3_PROJECTS_DIR=/home/belphareon/Projects/intentsmith-gate0-repro/.intentsmith-artifacts/g0-e2e-80/post-444781d/projects \
  INTENTSMITH_TEST_PROJECTS_DIR=/home/belphareon/Projects/intentsmith-gate0-repro/.intentsmith-artifacts/g0-e2e-80/post-444781d/projects \
  INTENTSMITH_TEST_ARTIFACT_DIR=/home/belphareon/Projects/intentsmith-gate0-repro/.intentsmith-artifacts/g0-e2e-80/post-444781d/artifacts \
  C3_URL=http://127.0.0.1:39247 \
  OLLAMA_URL=http://127.0.0.1:9 \
  node tests/e2e/80-ws-semantic-events.e2e.js
```

Result: `4 passed, 0 failed, 0 skipped`, exit 0. The four passing cases were
the deterministic LOCAL turn, cancellation, per-session isolation and
malformed-frame recovery. The unavailable provider proves that this qualifying
run did not silently depend on a model. The server was then stopped and exited
0.

An initial unprivileged server invocation failed before test execution with
`listen EPERM`, exit 1, because the sandbox forbids binding loopback sockets.
An initial client invocation from that same sandbox could not reach the
permitted server and exited 1 after 30 seconds. Neither is a product failure;
the qualifying server and client commands above ran with explicit loopback
permission.

## Disposition

`tests/e2e/80-ws-semantic-events.e2e.js` is terminal `REPAIRED`. Its registry
prerequisites are `server: true`, `ollama: false`, `gpu: false` and
`network: none`. This evidence does not resolve the separate provider-outage
success defect `G0-R025`.
