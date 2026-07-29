# IntentSmith

IntentSmith is a local-first AI control plane for software development and
eventually general local automation. It coordinates local models, replaceable
workers, tools, policy, lifecycle state, deterministic quality gates, audit,
recovery, and local memory from one user-owned machine.

IntentSmith is not another chat wrapper and not a single coding agent. Its
product thesis is that nondeterministic models and interchangeable agents need
a deterministic control plane around them: explicit state, bounded permissions,
test evidence, approvals, audit trails, and recovery.

## Naming Convention

| Name | Scope |
|---|---|
| IntentSmith | Whole product |
| IntentSmith Core | Local control plane |
| IntentSmith Studio | Theia IDE |
| IntentSmith Workers | OpenCode, OpenHands, and other agents |
| IntentSmith Skills | Workflows and specialists |
| IntentSmith Forge Local | Desktop distribution |
| `intentsmith` | CLI |
| `intentsmith-core` | Main package |

`IntentSmith Forge Local` is treated as working naming until trademark,
repository, and domain checks are complete.

## Current State

Phase 1 delivered the deterministic vertical slice. Phase 1.1 audited it and
hardened the boundaries. Phase 2 adds the first real local inference provider.
See `docs/STATUS.md`, `docs/testing/phase-1-1-results.md` and
`docs/testing/phase-2-results.md`.

## Local-First Guarantee

IntentSmith runs inference on your machine and must never silently use the
cloud. A request to `http://127.0.0.1:11434` is **not** automatically local: a
signed-in Ollama installation serves cloud-hosted models through the same
loopback socket.

Enforcement is in code, not convention:

- only plain HTTP to a loopback address is accepted, validated before any socket
  opens; HTTPS, public and private addresses, arbitrary hostnames, userinfo and
  `ollama.com` are rejected, and redirects are disabled;
- `Authorization`, cookies and API-key headers are never forwarded;
- a model is treated as remote-backed when the daemon reports `remote_model` or
  `remote_host`, checked at discovery, before generation, and on **every**
  stream record, so a daemon cannot switch to a remote backend mid-stream;
- a `-cloud` name suffix is a warning only and never the enforcement mechanism;
- rejection raises `REMOTE_INFERENCE_FORBIDDEN`, which is never retried and
  never falls back to another provider.

IntentSmith never installs Ollama, signs in, uses an API key, downloads a model,
or contacts ollama.com.

Phase 1.1 also adds two reusable contract suites. Any `WorkerAdapter` and any
`InferenceProvider` can be checked against them without copying tests, so a real
adapter in a later phase is held to the same bar as the fake. The
`InferenceProvider` port is a boundary definition only: there is no HTTP client,
no model download, no hardware detection, and it is not wired into the task
lifecycle.

## Phase 1 Scope

Phase 1 implements a fully local deterministic vertical slice:

```text
CLI / localhost API
  -> IntentSmith Core lifecycle
  -> deterministic fake worker
  -> core-owned verdict
  -> SQLite persistence and append-only audit
```

There is no LLM, external agent, shell execution, cloud call, or non-localhost
network dependency. `Task` stores the long-lived user intent while `TaskRun`
stores one immutable execution attempt.

## Requirements

- Node.js 22 LTS
- pnpm 11.17.0 through Corepack

All dependency versions are pinned exactly in the workspace manifests and
lockfile.

## Install And Verify

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify` runs frozen installation, typecheck, lint, all offline tests with
coverage gates, and the build in that order. It needs no Ollama, no GPU and no
model: every transport and hardware probe is injected. `pnpm test:coverage` runs the
coverage-gated suite on its own. The same pipeline runs in GitHub Actions on
pull requests and on pushes to `main`, without secrets and without a dependency
cache, so a clean-install failure cannot be masked.

Architecture rules are executable: `tools/architecture/boundaries.test.ts`
enforces the dependency boundaries in
`docs/architecture/dependency-boundaries.md`, so crossing one fails
`pnpm verify`.

## Local Server

Build and start the API:

```bash
pnpm build
pnpm --filter @intentsmith/server start
```

The server binds to `127.0.0.1:47831` by default. The local SQLite database is
stored at `.intentsmith/intentsmith.db`. Set `INTENTSMITH_DB_PATH` to use a
different development database.

## Local Inference

With a local Ollama daemon running, IntentSmith can inspect and use it:

```bash
pnpm --filter intentsmith start inference health
pnpm --filter intentsmith start inference models
pnpm --filter intentsmith start inference model --model qwen3:14b
pnpm --filter intentsmith start inference assess --model qwen3:14b --policy gpu_required
pnpm --filter intentsmith start hardware show
pnpm --filter intentsmith start runtime recovery
```

Generation reads the prompt from stdin so it never enters shell history:

```bash
echo "Explain this repository in one sentence." \
  | pnpm --filter intentsmith start inference generate --model qwen3:14b
```

`--prompt` exists but is documented as the less private option. Ctrl+C cancels
the generation upstream rather than orphaning it.

IntentSmith does not download models. If one is missing it says so and tells you
the `ollama pull` command to run yourself.

### Optional real-Ollama verification

```bash
INTENTSMITH_RUN_REAL_OLLAMA=1 \
INTENTSMITH_OLLAMA_TEST_MODEL=<an-already-installed-model> \
pnpm test:ollama
```

Never part of `pnpm verify` or CI. It never pulls a model, signs in or uses an
API key, and reports BLOCKED rather than PASS when Ollama or the model is
missing.

### Optional real-OpenCode verification

The opt-in suite in `tools/opencode/` drives the executable server composition
over loopback HTTP with the pinned real binary, the real gateway and real local
inference:

```bash
INTENTSMITH_RUN_REAL_OPENCODE=1 \
INTENTSMITH_OPENCODE_BIN=/absolute/path/to/opencode \
pnpm test:opencode
```

IntentSmith never installs OpenCode: install exactly `opencode-ai@1.18.8`
yourself, outside this repository, and point the variable at it. The suite
reports BLOCKED rather than PASS when the binary, its pinned version, the local
Ollama daemon, the model (`INTENTSMITH_OPENCODE_TEST_MODEL`, default
`qwen3:14b`) or the NVIDIA GPU is missing, and it is never part of `pnpm verify`
or CI. Set `INTENTSMITH_2C_EVIDENCE` to a file path to collect the sanitized
scenario log the Phase 3 evidence artifact is built from.

## Worker Inference Gateway

A loopback-only, OpenAI-shaped gateway exists so a future external worker can
run inference under the same guarantees as the user's own API: same provider,
same hardware and model-fit policy, same local-only checks, same scheduler.

It is **off by default**, because no worker exists yet:

```bash
INTENTSMITH_GATEWAY=1 pnpm --filter @intentsmith/server start
# optionally pin the port instead of using an ephemeral one
INTENTSMITH_GATEWAY_PORT=41234 pnpm --filter @intentsmith/server start
```

Every route needs an IntentSmith-issued per-run bearer token even on loopback,
because loopback is not an authorization boundary: any local process can reach
the port. Tokens are scoped to one run, never persisted or logged, and revoked
when the run ends or the server stops.

## CLI

The CLI talks only to the localhost API by default:

```bash
pnpm --filter intentsmith start version
pnpm --filter intentsmith start health
pnpm --filter intentsmith start project create --name demo --root /absolute/path
pnpm --filter intentsmith start task create --project-id PROJECT_ID --goal "Run deterministic checks"
pnpm --filter intentsmith start task start --task-id TASK_ID
pnpm --filter intentsmith start task result --task-id TASK_ID --json
pnpm --filter intentsmith start task audit --task-id TASK_ID --json
```

Set `INTENTSMITH_URL` to another localhost URL when the server uses a different
port.

## Development Data

Stop the server first. To delete only the default development database:

```bash
rm -f .intentsmith/intentsmith.db .intentsmith/intentsmith.db-shm .intentsmith/intentsmith.db-wal
```

This command does not touch project workspaces.

## Reference

Source project: `Belphareon-bak/C3-agent`

Reference commit:

```text
a7b90e36aa80310305703f54f2332e1c0e7f9e8f
```

The C3 repository is a read-only reference for this transformation.
