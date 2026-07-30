# IntentSmith Gate 0 Baseline Report

## Verdict

**CONDITIONAL PASS**

- Candidate: `7c20b722b4dc389267d987b461beed1329744df3`
- Branch: `codex/intentsmith-1.0`
- Registry SHA-256: `f6edc6ccff693284ee01ed159e90faea20e94662892d7b84b2f61efdf35e03b5`
- Evidence generated: 2026-07-30T23:07:13.905Z
- Independent review: PENDING

The code/test baseline satisfies the local deterministic Gate 0 clauses. Acceptance remains conditional until the bounded Opus review is evaluated.
The confirmed privacy compromise remains a separate operator-owned incident
and is not presented as nearly green.

## Gate clauses

| Clause | Result | Evidence |
|---|---|---|
| G0-C1 clean candidate | PASS | all 9 locked executions started and ended at a clean candidate SHA |
| G0-C2 disposition | PASS | 225 records; 60/60 repaired subjects; validator exit 0 |
| G0-C3 registry | PASS | 350 runnable programs and 8 explicit support exclusions; validator exit 0 |
| G0-C4 clean install | PASS | two consecutive locked minimal installs, both exit 0 against the same isolated cache |
| G0-C5 deterministic T1/T2 | PASS | 199 deterministic PASS; 5/5 pilot PASS; deterministic verdict PASS/exit 0 |
| G0-C6 defective suites excluded | PASS | 0 registry rows are KNOWN_DEFECTIVE; none appears in green deterministic evidence |
| G0-C7 blockers specific | PASS | every registry BLOCKED row names a concrete prerequisite; all five soak guards name gpu and ollama |
| G0-C8 generated evidence | PASS | typed producer provenance .intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/provenance.json is bound by SHA-256 8d32aa50fa2642700843cc27d7e03dbe216d0f01e9b8c96d49c221c6ff6f5ada |
| G0-C9 risk impact policy | PASS | 28 risk rows have validated machine-readable gateImpact entries |

## Validators

| Command | Exit | Output SHA-256 |
|---|---:|---|
| `node scripts/validate-test-registry.js --json` | 0 | `92b421854f9515922ab9f609ce044e38cbabf9586a87ccdb038b8f9f1af2dd00` |
| `node scripts/validate-final-disposition.js --json` | 0 | `473f2efe767b67d0ab6874e71eed608b6465ee7b394e116bcbc3c1639bb829e8` |

Registry report: 350 programs,
8 exclusions, fingerprint
`f6edc6ccff693284ee01ed159e90faea20e94662892d7b84b2f61efdf35e03b5`, 0 errors.

Disposition report: 225 records,
0 errors; dispositions
`EXCLUDE` 91, `KEEP` 42, `REBUILD` 92.

## Clean installation

Locked tokenized recipe, run twice with the same fresh isolated cache:

```bash
env -i PATH="${PATH-}" SYSTEMROOT="${SYSTEMROOT-}" WINDIR="${WINDIR-}" PATHEXT="${PATHEXT-}" COMSPEC="${COMSPEC-}" HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/home" XDG_CONFIG_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-config" XDG_CACHE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-cache" XDG_DATA_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-data" XDG_STATE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-state" TMPDIR="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/tmp" TMP="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/tmp" TEMP="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/tmp" GIT_CONFIG_GLOBAL="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/gitconfig" GIT_CONFIG_NOSYSTEM=1 npm_config_cache="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/npm-cache" YARN_CACHE_FOLDER="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/yarn-cache" PIP_CACHE_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/pip-cache" COREPACK_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/corepack" C3_DB_PATH="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/runtime/install.sqlite" C3_PROJECTS_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/runtime/projects" C3_PORT_FILE="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/runtime/intentsmith.port" C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false C3_LOG_LEVEL=warn NODE_ENV=test CI=1 NO_COLOR=1 LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC PYTHONNOUSERSITE=1 ./scripts/install.sh --minimal
```

| Run | Exit | Bytes | Log SHA-256 | Artifact |
|---|---:|---:|---|---|
| clean | 0 | 5464 | `9f4949921448bc6f4a406889f2293a5db66c938e86538d51554a7165503f56ae` | `.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/logs/install-clean.log` |
| repeat | 0 | 5286 | `506fb4b697d7679a5509f29238c7b0817014cd36ce44408b3eb2a4c7485d79a2` | `.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/logs/install-repeat.log` |

The producer spawned both recipes without a shell and recorded exact argv,
allowlisted inherited environment keys, explicit isolated overrides, source
state before/after, exit status and log digest in its ignored provenance file.

## Deterministic registry

```bash
env -i PATH="${PATH-}" SYSTEMROOT="${SYSTEMROOT-}" WINDIR="${WINDIR-}" PATHEXT="${PATHEXT-}" COMSPEC="${COMSPEC-}" HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/home" XDG_CONFIG_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-config" XDG_CACHE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-cache" XDG_DATA_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-data" XDG_STATE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-state" TMPDIR="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/tmp" TMP="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/tmp" TEMP="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/tmp" GIT_CONFIG_GLOBAL="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/gitconfig" GIT_CONFIG_NOSYSTEM=1 npm_config_cache="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/npm-cache" YARN_CACHE_FOLDER="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/yarn-cache" PIP_CACHE_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/pip-cache" COREPACK_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/corepack" C3_DB_PATH="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/runtime/install.sqlite" C3_PROJECTS_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/runtime/projects" C3_PORT_FILE="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/runtime/intentsmith.port" C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false C3_LOG_LEVEL=warn NODE_ENV=test CI=1 NO_COLOR=1 LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC PYTHONNOUSERSITE=1 INTENTSMITH_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-data/intentsmith/python/pdf/bin/python" C3_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-data/intentsmith/python/pdf/bin/python" node scripts/nightly-audit.js --profile=offline,database --run-id=deterministic-7c20b722b4dc389267d987b461beed1329744df3 --out-dir=.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/deterministic --timeout-minutes=10 --deadline-hours=8 --concurrency=1
```

- Exit: **0**
- Verdict: **PASS**
- Status: `{"PASS":199,"FAIL":0,"TIMEOUT":0,"BLOCKED":0,"SKIPPED":0}`
- Report: `.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/deterministic/deterministic-7c20b722b4dc389267d987b461beed1329744df3/report.json`
- Report SHA-256: `d9993a63017bb1daa09c056cc63d0004b2c43ce7b13e5603350d904cbaed11d7`
- Inventory: `.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/deterministic/deterministic-7c20b722b4dc389267d987b461beed1329744df3/inventory.json`
- Inventory SHA-256: `09c3f46da4fefd6e47a33f23deb562c78829310775ac6319a449488d97cd3ff3`
- Inventory fingerprint: `89bfba52129a0d88dd0808feaa5a741f2c0fe8c4ac3de78ea141a46c9c393361`
- Options fingerprint: `b6c9a55d1eef4edd4cd3c3fc691fe87947b8aad52dc7249c05af5a41fed7db4e`

The verdict is recomputed from all 199 required T1/T2
result rows. Printed assertion totals cannot override suite exits.

## Pilot discrimination — five consecutive runs

| Run | Exit | Verdict | Report SHA-256 |
|---|---:|---|---|
| `pilot-01-7c20b722b4dc389267d987b461beed1329744df3` | 0 | PASS | `c2c89914b3b45c466db9f07f8c8730e555443ee0f5dabc08a49af8b400734361` |
| `pilot-02-7c20b722b4dc389267d987b461beed1329744df3` | 0 | PASS | `92a2faf6401717a2fb4226b01a9e25e05602e5cafbe5647c2c0f9738dfb5540b` |
| `pilot-03-7c20b722b4dc389267d987b461beed1329744df3` | 0 | PASS | `22076f88874eeef4d9d4f901c42c0964384a45af6954847bed23b918324c24ad` |
| `pilot-04-7c20b722b4dc389267d987b461beed1329744df3` | 0 | PASS | `70729554a6625783f556e0d6bf6c323cc84ae858864a607eb1130ca8f3c0bb0b` |
| `pilot-05-7c20b722b4dc389267d987b461beed1329744df3` | 0 | PASS | `58fee2c123d1b6f0caa8cb4945042826ac816e12d04afb100b8fbde1158c8f7d` |

Exact orchestration commands:

- `pilot-01-7c20b722b4dc389267d987b461beed1329744df3`: `env -i PATH="${PATH-}" SYSTEMROOT="${SYSTEMROOT-}" WINDIR="${WINDIR-}" PATHEXT="${PATHEXT-}" COMSPEC="${COMSPEC-}" HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/home" XDG_CONFIG_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-config" XDG_CACHE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-cache" XDG_DATA_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-data" XDG_STATE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-state" TMPDIR="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/tmp" TMP="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/tmp" TEMP="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/tmp" GIT_CONFIG_GLOBAL="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/gitconfig" GIT_CONFIG_NOSYSTEM=1 npm_config_cache="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/npm-cache" YARN_CACHE_FOLDER="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/yarn-cache" PIP_CACHE_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/pip-cache" COREPACK_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/corepack" C3_DB_PATH="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/runtime/install.sqlite" C3_PROJECTS_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/runtime/projects" C3_PORT_FILE="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/runtime/intentsmith.port" C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false C3_LOG_LEVEL=warn NODE_ENV=test CI=1 NO_COLOR=1 LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC PYTHONNOUSERSITE=1 INTENTSMITH_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-data/intentsmith/python/pdf/bin/python" C3_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-data/intentsmith/python/pdf/bin/python" node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-01-7c20b722b4dc389267d987b461beed1329744df3 --out-dir=.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/pilot --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
- `pilot-02-7c20b722b4dc389267d987b461beed1329744df3`: `env -i PATH="${PATH-}" SYSTEMROOT="${SYSTEMROOT-}" WINDIR="${WINDIR-}" PATHEXT="${PATHEXT-}" COMSPEC="${COMSPEC-}" HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/home" XDG_CONFIG_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-config" XDG_CACHE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-cache" XDG_DATA_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-data" XDG_STATE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-state" TMPDIR="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/tmp" TMP="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/tmp" TEMP="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/tmp" GIT_CONFIG_GLOBAL="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/gitconfig" GIT_CONFIG_NOSYSTEM=1 npm_config_cache="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/npm-cache" YARN_CACHE_FOLDER="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/yarn-cache" PIP_CACHE_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/pip-cache" COREPACK_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/corepack" C3_DB_PATH="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/runtime/install.sqlite" C3_PROJECTS_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/runtime/projects" C3_PORT_FILE="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/runtime/intentsmith.port" C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false C3_LOG_LEVEL=warn NODE_ENV=test CI=1 NO_COLOR=1 LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC PYTHONNOUSERSITE=1 INTENTSMITH_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-data/intentsmith/python/pdf/bin/python" C3_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-data/intentsmith/python/pdf/bin/python" node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-02-7c20b722b4dc389267d987b461beed1329744df3 --out-dir=.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/pilot --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
- `pilot-03-7c20b722b4dc389267d987b461beed1329744df3`: `env -i PATH="${PATH-}" SYSTEMROOT="${SYSTEMROOT-}" WINDIR="${WINDIR-}" PATHEXT="${PATHEXT-}" COMSPEC="${COMSPEC-}" HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/home" XDG_CONFIG_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-config" XDG_CACHE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-cache" XDG_DATA_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-data" XDG_STATE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-state" TMPDIR="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/tmp" TMP="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/tmp" TEMP="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/tmp" GIT_CONFIG_GLOBAL="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/gitconfig" GIT_CONFIG_NOSYSTEM=1 npm_config_cache="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/npm-cache" YARN_CACHE_FOLDER="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/yarn-cache" PIP_CACHE_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/pip-cache" COREPACK_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/corepack" C3_DB_PATH="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/runtime/install.sqlite" C3_PROJECTS_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/runtime/projects" C3_PORT_FILE="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/runtime/intentsmith.port" C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false C3_LOG_LEVEL=warn NODE_ENV=test CI=1 NO_COLOR=1 LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC PYTHONNOUSERSITE=1 INTENTSMITH_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-data/intentsmith/python/pdf/bin/python" C3_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-data/intentsmith/python/pdf/bin/python" node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-03-7c20b722b4dc389267d987b461beed1329744df3 --out-dir=.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/pilot --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
- `pilot-04-7c20b722b4dc389267d987b461beed1329744df3`: `env -i PATH="${PATH-}" SYSTEMROOT="${SYSTEMROOT-}" WINDIR="${WINDIR-}" PATHEXT="${PATHEXT-}" COMSPEC="${COMSPEC-}" HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/home" XDG_CONFIG_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-config" XDG_CACHE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-cache" XDG_DATA_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-data" XDG_STATE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-state" TMPDIR="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/tmp" TMP="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/tmp" TEMP="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/tmp" GIT_CONFIG_GLOBAL="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/gitconfig" GIT_CONFIG_NOSYSTEM=1 npm_config_cache="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/npm-cache" YARN_CACHE_FOLDER="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/yarn-cache" PIP_CACHE_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/pip-cache" COREPACK_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/corepack" C3_DB_PATH="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/runtime/install.sqlite" C3_PROJECTS_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/runtime/projects" C3_PORT_FILE="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/runtime/intentsmith.port" C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false C3_LOG_LEVEL=warn NODE_ENV=test CI=1 NO_COLOR=1 LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC PYTHONNOUSERSITE=1 INTENTSMITH_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-data/intentsmith/python/pdf/bin/python" C3_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-data/intentsmith/python/pdf/bin/python" node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-04-7c20b722b4dc389267d987b461beed1329744df3 --out-dir=.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/pilot --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
- `pilot-05-7c20b722b4dc389267d987b461beed1329744df3`: `env -i PATH="${PATH-}" SYSTEMROOT="${SYSTEMROOT-}" WINDIR="${WINDIR-}" PATHEXT="${PATHEXT-}" COMSPEC="${COMSPEC-}" HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/home" XDG_CONFIG_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-config" XDG_CACHE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-cache" XDG_DATA_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-data" XDG_STATE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-state" TMPDIR="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/tmp" TMP="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/tmp" TEMP="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/tmp" GIT_CONFIG_GLOBAL="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/gitconfig" GIT_CONFIG_NOSYSTEM=1 npm_config_cache="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/npm-cache" YARN_CACHE_FOLDER="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/yarn-cache" PIP_CACHE_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/pip-cache" COREPACK_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/corepack" C3_DB_PATH="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/runtime/install.sqlite" C3_PROJECTS_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/runtime/projects" C3_PORT_FILE="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/runtime/intentsmith.port" C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false C3_LOG_LEVEL=warn NODE_ENV=test CI=1 NO_COLOR=1 LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC PYTHONNOUSERSITE=1 INTENTSMITH_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-data/intentsmith/python/pdf/bin/python" C3_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-data/intentsmith/python/pdf/bin/python" node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-05-7c20b722b4dc389267d987b461beed1329744df3 --out-dir=.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/pilot --timeout-minutes=5 --deadline-hours=1 --concurrency=1`

The unchanged A9 assertion passed in every run. The repair changed the low-
ceremony C2 fixture, not production score weights or thresholds.

## Model-backed soak guard

- Locked replay: `env -i PATH="${PATH-}" SYSTEMROOT="${SYSTEMROOT-}" WINDIR="${WINDIR-}" PATHEXT="${PATHEXT-}" COMSPEC="${COMSPEC-}" HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/home" XDG_CONFIG_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-config" XDG_CACHE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-cache" XDG_DATA_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-data" XDG_STATE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-state" TMPDIR="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/tmp" TMP="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/tmp" TEMP="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/tmp" GIT_CONFIG_GLOBAL="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/gitconfig" GIT_CONFIG_NOSYSTEM=1 npm_config_cache="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/npm-cache" YARN_CACHE_FOLDER="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/yarn-cache" PIP_CACHE_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/pip-cache" COREPACK_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/corepack" C3_DB_PATH="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/runtime/install.sqlite" C3_PROJECTS_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/runtime/projects" C3_PORT_FILE="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/runtime/intentsmith.port" C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false C3_LOG_LEVEL=warn NODE_ENV=test CI=1 NO_COLOR=1 LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC PYTHONNOUSERSITE=1 INTENTSMITH_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-data/intentsmith/python/pdf/bin/python" C3_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/install-root/xdg-data/intentsmith/python/pdf/bin/python" node scripts/nightly-audit.js --suite=IS-T5-TESTS-SOAK-ATTACHMENT-HEAVY-TEST,IS-T5-TESTS-SOAK-BREAK-PATTERN-PROBE-TEST,IS-T5-TESTS-SOAK-FOLLOWUP-LOAD-TEST,IS-T5-TESTS-SOAK-MIXED-SESSION-SIMULATION-TEST,IS-T5-TESTS-SOAK-SHORT-INPUT-STRESS-TEST --run-id=soak-guard-7c20b722b4dc389267d987b461beed1329744df3 --out-dir=.intentsmith-artifacts/gate0/candidate-7c20b722b4dc389267d987b461beed1329744df3/soak --timeout-minutes=60 --deadline-hours=1 --concurrency=1`
- Exit: **2**
- Verdict: **BLOCKED**
- Named prerequisites: `gpu, ollama`
- Report SHA-256: `9146ab1f19754b950b2e5634e06224aeb453eb4a9d360f6d98ed66b42f6c5f08`
- Inventory SHA-256: `587b9526c4fedd8a7fb72a6c0a383b25324e7004a3eced70a4e1cedf6d43e93d`

Five soak programs previously misdeclared as model-free are now blocked before
execution unless Ollama and GPU are explicitly authorized.

## `a7b90e3..ffd21cf` disposition

- 225 records total
- Dispositions: `EXCLUDE` 91, `KEEP` 42, `REBUILD` 92
- Terminals: `DEFERRED(external-network+owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` 1, `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` 30, `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+three-request-gpu-headroom)` 1, `REPAIRED` 60
- Resolutions: `ABSENT` 91, `EXACT` 32, `MAPPED_REPAIR` 3, `MODIFIED` 99
- Repaired subjects: 60/
  60, digest
  `95188ae39a57e04531ac2b92fabe4174c9255e419d0a47e11e43cd45dd056897`
- Validator errors: 0

The disputed commit was neither accepted wholesale nor reverted wholesale.

## Privacy incident and rotation inventory

- Incident: `G0-PRIVACY-001`
- Status: **CONFIRMED_COMPROMISE**
- Current-tree tracked private paths removed: 13
- Affected Git objects remain reachable: true
- History rewritten: false
- Personal content inspected: false

Potentially compromised categories to rotate, without values:

- license signing and validation secrets: rotate or reissue and revoke affected licenses
- administrative and issued API credentials: revoke and reissue
- notification credentials: rotate credentials and verify destinations
- model and provider credentials: revoke and reissue
- license and agent credentials: rotate where externally valid
- fixture passwords reused outside tests: rotate only if reused outside its fixture context
- project-scoped external credentials: inventory by the operator without publishing values, then revoke and reissue
- ephemeral authorization material: invalidate through service restart or revocation

## Remaining risks and blockers

- Independent review status: PENDING.
- Repository-local Gate 0 blockers: none.
- Review-required risks: G0-R015: OPEN.
- Later-gate risks: G0-R009: OPEN, G0-R018: OPEN.
- Separate incidents: G0-R001: CONTAINED_CURRENT_TREE / OPEN_HISTORY, G0-R002: CONTAINED_CURRENT_TREE / OPEN_HISTORY, G0-R010: OPEN.
- Public-history remediation, repository visibility, and credential rotation
  remain operator decisions.
- 0 recovered E2E suites retain known false-green
  assertions and are not counted green.
- 79 registry rows remain explicitly `BLOCKED` on named
  prerequisites.
- Registry discovery covers every supported program-language file independent
  of its filename; 8 support/aggregate files are
  explicit reasoned exclusions.
- Runtime database access now requires an explicit non-empty `C3_DB_PATH`;
  authoritative registry runs bind a distinct isolated path (`G0-R012`).
- All current direct-run temp creators use the private bootstrap-owned runtime
  boundary; the former shared-`/tmp` convention is closed (`G0-R014`).

## Recommended next step

Perform the bounded Opus 5 read-only review, evaluate every finding against the candidate and evidence, then ask the operator whether Gate 0 may be accepted. Do not begin the next gate from this conditional checkpoint.
