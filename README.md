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

`pnpm verify` runs frozen installation, typecheck, lint, all offline tests, and
the build in that order.

## Local Server

Build and start the API:

```bash
pnpm build
pnpm --filter @intentsmith/server start
```

The server binds to `127.0.0.1:47831` by default. The local SQLite database is
stored at `.intentsmith/intentsmith.db`. Set `INTENTSMITH_DB_PATH` to use a
different development database.

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
