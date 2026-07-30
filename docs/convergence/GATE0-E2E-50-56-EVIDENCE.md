# Gate 0 E2E 50–56 repair evidence

Status: focused post-commit evidence, not a claim that the complete T3 registry
is green.

## Candidate and isolation

- source revision:
  `ab14c0ec7b891a8cbbdcccf1ab7bf018214a4293`;
- branch: `codex/intentsmith-1.0`;
- artifact root:
  `.intentsmith-artifacts/g0-e2e-ab14c0e.Bygj47`;
- artifact root and its `home`, `tmp`, `projects`, `artifacts`, and `runtime`
  children: mode `0700`;
- database:
  `.intentsmith-artifacts/g0-e2e-ab14c0e.Bygj47/runtime/intentsmith-test.sqlite`;
- server origin: `http://127.0.0.1:38605`;
- server ready marker: `C3_READY:38605`;
- server termination: operator `Ctrl-C`, exit 0.

The ignored artifact root remains local and is not part of the committed
evidence. No response transcript, runtime database content, or private value is
copied into this document.

## Server command

```bash
env \
  HOME=/home/belphareon/Projects/intentsmith-gate0-repro/.intentsmith-artifacts/g0-e2e-ab14c0e.Bygj47/home \
  TMPDIR=/home/belphareon/Projects/intentsmith-gate0-repro/.intentsmith-artifacts/g0-e2e-ab14c0e.Bygj47/tmp \
  NODE_ENV=test \
  C3_AUDIT_RUN=1 \
  C3_DB_PATH=/home/belphareon/Projects/intentsmith-gate0-repro/.intentsmith-artifacts/g0-e2e-ab14c0e.Bygj47/runtime/intentsmith-test.sqlite \
  C3_PROJECTS_DIR=/home/belphareon/Projects/intentsmith-gate0-repro/.intentsmith-artifacts/g0-e2e-ab14c0e.Bygj47/projects \
  INTENTSMITH_TEST_PROJECTS_DIR=/home/belphareon/Projects/intentsmith-gate0-repro/.intentsmith-artifacts/g0-e2e-ab14c0e.Bygj47/projects \
  INTENTSMITH_TEST_ARTIFACT_DIR=/home/belphareon/Projects/intentsmith-gate0-repro/.intentsmith-artifacts/g0-e2e-ab14c0e.Bygj47/artifacts \
  C3_PORT=0 \
  C3_PORT_FILE=/home/belphareon/Projects/intentsmith-gate0-repro/.intentsmith-artifacts/g0-e2e-ab14c0e.Bygj47/runtime/intentsmith.port \
  C3_LIFECYCLE_AUTO_COMMIT=false \
  C3_ENABLE_AUTONOMY=false \
  C3_LOG_LEVEL=warn \
  OLLAMA_URL=http://127.0.0.1:11434 \
  node src/server.js
```

## Suite command contract

Each command below used the same exact environment. This executable array is a
compact rendering of the repeated literal `env` arguments:

```bash
gate0_e2e_env=(
  HOME=/home/belphareon/Projects/intentsmith-gate0-repro/.intentsmith-artifacts/g0-e2e-ab14c0e.Bygj47/home
  TMPDIR=/home/belphareon/Projects/intentsmith-gate0-repro/.intentsmith-artifacts/g0-e2e-ab14c0e.Bygj47/tmp
  NODE_ENV=test
  C3_AUDIT_RUN=1
  C3_DB_PATH=/home/belphareon/Projects/intentsmith-gate0-repro/.intentsmith-artifacts/g0-e2e-ab14c0e.Bygj47/runtime/intentsmith-test.sqlite
  C3_URL=http://127.0.0.1:38605
  INTENTSMITH_TEST_PROJECTS_DIR=/home/belphareon/Projects/intentsmith-gate0-repro/.intentsmith-artifacts/g0-e2e-ab14c0e.Bygj47/projects
  INTENTSMITH_TEST_ARTIFACT_DIR=/home/belphareon/Projects/intentsmith-gate0-repro/.intentsmith-artifacts/g0-e2e-ab14c0e.Bygj47/artifacts
  E2E_GPU_COOLDOWN=0
)
```

| Command | Result | Exit |
|---|---|---:|
| `env "${gate0_e2e_env[@]}" node tests/e2e/50-chat-conversation.e2e.js` | 6 passed, 0 failed, 0 skipped | 0 |
| `env "${gate0_e2e_env[@]}" node tests/e2e/54-chat-with-expertise.e2e.js` | 3 passed, 0 failed, 0 skipped | 0 |
| `env "${gate0_e2e_env[@]}" node tests/e2e/55-chat-with-specialist.e2e.js` | 4 passed, 0 failed, 0 skipped | 0 |
| `env "${gate0_e2e_env[@]}" node tests/e2e/56-chat-with-project.e2e.js` | 4 passed, 0 failed, 0 skipped | 0 |

## Residual observations

The server logged two non-fatal failures in the self-refinement path:

```text
ChatController Self-refinement failed (non-fatal):
Cannot set property content of #<TaggedResponse> which has only a getter
```

This is tracked as `G0-R023`. It does not invalidate the exact primary response,
state, persistence, expertise, specialist, and project assertions above, but
the refinement path is not green evidence.
