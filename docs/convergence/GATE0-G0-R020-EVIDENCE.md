# Gate 0 G0-R020 model fixture contract

## Scope and result

- Source base:
  `d79a8059e018312a917b268b156aeee80d27a3c6`
- Worktree:
  `/home/belphareon/Projects/coworker/intentsmith-g0-r020`
- Branch:
  `codex/g0-r020-model-fixture-contract`
- Implementation commit:
  `6dff750a36a44b38d8ab17730f3dab1f0b5d1f24`
- Scope: registry schema, read-only model fixture preflight, deterministic
  positive/negative tests, and this risk evidence.
- Result: the identified suites can no longer become runnable on the basis of
  `gpu: true` alone. No model inference or GPU workload was run, and no model
  suite is claimed green.
- `STATUS.md` was not edited. It remains generated evidence for its historical
  candidate.

## Contract

Registry schema v3 adds an exact `requirements.modelFixture` object to E2E
suites 57, 58, 59 and 88:

| Field | Suites 57–59 | Suite 88 |
|---|---:|---:|
| provider | `ollama` | `ollama` |
| model | `qwen3.5:27b` | `qwen3.5:27b` |
| manifest SHA-256 | `7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e` | same |
| per-request context | 8,192 tokens | 8,192 tokens |
| parallel requests | 1 | 3 |
| required allocated context | 8,192 tokens | 24,576 tokens |
| minimum equivalent pre-load free VRAM | 20,128 MiB | 24,016 MiB |
| minimum post-load headroom | 1,024 MiB | 1,024 MiB |
| minimum GPU residency | 100% | 100% |
| fallback policy | `forbid` | `forbid` |
| registry state | `BLOCKED` | `BLOCKED` |

The values use the existing conservative C3 VRAM formula:

- model weights: `620 × 27 + 420 = 17,160 MiB`;
- per-request 8K KV allocation: `8 × (27 × 9) = 1,944 MiB`;
- reserved headroom: `1,024 MiB`;
- single request: `17,160 + 1,944 + 1,024 = 20,128 MiB`;
- three requests: `17,160 + (3 × 1,944) + 1,024 = 24,016 MiB`.

Ollama documents that memory scales with
`OLLAMA_NUM_PARALLEL × OLLAMA_CONTEXT_LENGTH`; the read-only `/api/ps`
contract exposes digest, VRAM allocation and allocated context. The references
used for the preflight shape are:

- <https://docs.ollama.com/faq#how-does-ollama-handle-concurrent-requests>
- <https://docs.ollama.com/api/ps>

## Enforcement

`scripts/model-fixture-preflight.js`:

1. queries installed and loaded models without making a generation request;
2. requires the exact name and manifest digest for both views;
3. requires allocated context to equal per-request context multiplied by the
   declared request concurrency;
4. requires one readable NVIDIA GPU, the declared equivalent pre-load free
   capacity, post-load free headroom and minimum GPU residency;
5. returns structured issue codes and fails closed on an unavailable or
   malformed probe.

`scripts/nightly-audit.js` treats `model-fixture` as a non-bypassable dynamic
preflight. `--no-block` and `--allow-blocker` can bypass the old soft
`ollama`/`gpu` markers, but cannot convert a missing or failed model fixture
preflight into execution. Passing and blocked preflight evidence is retained
in the per-suite result.

The canonical E2E reconciler emits these four contracts, and the registry
validator rejects their removal, malformed digests, zero concurrency,
unsupported fallback policy, incompatible network requirements, or missing
Ollama/GPU declarations.

## Commands and results

| Command | Result | Exit |
|---|---|---:|
| `git rev-parse HEAD` before edits | `d79a8059e018312a917b268b156aeee80d27a3c6` | 0 |
| `sha256sum /usr/share/ollama/.ollama/models/manifests/registry.ollama.ai/library/qwen3.5/27b` | pinned manifest digest above; read-only, no model load | 0 |
| `curl --fail --silent --show-error http://127.0.0.1:11434/api/tags` | Ollama unavailable; no model request made | 7 |
| `curl --fail --silent --show-error http://127.0.0.1:11434/api/ps` | Ollama unavailable; no model request made | 7 |
| `nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free --format=csv,noheader,nounits` | NVIDIA driver unavailable in this execution environment; no GPU workload made | 9 |
| `node scripts/reconcile-ffd-e2e-registry.js --write` | 78 rebuilt E2E rows; all remain `BLOCKED` | 0 |
| `node scripts/validate-test-registry.js --write-doc` | 350 runnable programs; registry SHA-256 `f6edc6ccff693284ee01ed159e90faea20e94662892d7b84b2f61efdf35e03b5` | 0 |
| `node tests/nightly-audit-runner-self-test.js --model-fixture-only` with isolated HOME/TMP/DB | positive registry/preflight path executed one synthetic child and returned `PASS`; insufficient headroom returned `BLOCKED` without a child log; digest, concurrency and schema negatives passed | 0 |
| `node scripts/nightly-audit.js --dry-run --suite=IS-T3-E2E-57-LIFECYCLE-FULL,IS-T3-E2E-58-CODE-GENERATION,IS-T3-E2E-59-CROSS-FEATURE,IS-T3-E2E-88-CONCURRENT-LOAD ...` | four model suites; blockers `gpu=4`, `model-fixture=4`, `ollama=4`, `server=4`, `state-blocked=4`; no suite executed | 0 |
| `node scripts/validate-test-registry.js` | 350 runnable programs; same registry hash | 0 |
| `node scripts/reconcile-ffd-e2e-registry.js` | canonical 78-row E2E metadata matches | 0 |
| `node scripts/validate-final-disposition.js` | 225 records valid | 0 |
| `node tests/artifact-validation.test.js` with isolated HOME/TMP/DB | 50 passed, 0 failed | 0 |
| `node --check` on all changed JavaScript files | syntax valid | 0 |

The implementation commit was then checked out into a detached worktree.
`git rev-parse HEAD` returned
`6dff750a36a44b38d8ab17730f3dab1f0b5d1f24`,
`git status --porcelain=v1 --untracked-files=all` returned no output, and all
green rows in the table above were repeated there with the same result.

The exact isolated target-test command in that clean worktree was:

```bash
cd /tmp/intentsmith-g0-r020-6dff
env HOME=/tmp/intentsmith-g0-r020.aglSQ4 \
  TMPDIR=/tmp/intentsmith-g0-r020.aglSQ4 \
  TMP=/tmp/intentsmith-g0-r020.aglSQ4 \
  TEMP=/tmp/intentsmith-g0-r020.aglSQ4 \
  C3_DB_PATH=/tmp/intentsmith-g0-r020.aglSQ4/test.sqlite \
  node tests/nightly-audit-runner-self-test.js --model-fixture-only
```

The exact no-execution inventory command in that clean worktree was:

```bash
cd /tmp/intentsmith-g0-r020-6dff
node scripts/nightly-audit.js \
  --dry-run \
  --suite=IS-T3-E2E-57-LIFECYCLE-FULL,IS-T3-E2E-58-CODE-GENERATION,IS-T3-E2E-59-CROSS-FEATURE,IS-T3-E2E-88-CONCURRENT-LOAD \
  --run-id=g0-r020-clean-6dff-dry-run \
  --out-dir=/tmp/intentsmith-g0-r020.aglSQ4/clean-audit
```

The unfiltered `tests/nightly-audit-runner-self-test.js` invocation inside the
restricted execution sandbox reached the new positive and negative model
fixture cases, then failed later because the pre-existing fast child output
marker was absent from its log. The exact same later assertion and exit `1`
were reproduced from a detached clean `d79a805` worktree. This is recorded as
an environment-sensitive baseline observation, not as a G0-R020 product
failure and not repaired in this branch. The integrator will rerun that
existing full self-test outside the restricted sandbox.

## Residual boundary

- These checks prove the contract and fail-closed scheduling behavior using
  deterministic observations. They do not prove that the current host can
  satisfy the contract.
- All four production E2E rows remain `BLOCKED`; their other owned-server and
  model-quality prerequisites are unchanged.
- A future real-model run must record the exact preflight object with the suite
  result. It must not be counted green if any identity, allocated-context,
  residency, free-capacity or headroom check fails.
- Changing the model digest, context, concurrency, VRAM budget or fallback
  policy is a reviewed registry change, not a runtime override.
