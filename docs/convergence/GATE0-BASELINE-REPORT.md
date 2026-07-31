# IntentSmith Gate 0 Baseline Report

## Verdict

**CONDITIONAL PASS**

- Candidate: `2f11e801707a93a547795b5e96ff30c7f620ba5b`
- Branch: `codex/s1-legacy-loopback-containment`
- Parsed-registry serialization fingerprint
  (`sha256-json-stringify-v1`): `21992f9fcc1625c14baa0a7d53771a88e4f704e97e4c276f4d4b8fd9ea08cd73`
- Execution context: `ATTESTED_CANDIDATE_RUN` at `$PWD`; clean candidate,
  dependencies installed by the bound install phases
- Evidence generated: 2026-07-31T12:40:43.804Z
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
| G0-C8 generated evidence | PASS | typed producer provenance .intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/provenance.json is bound by SHA-256 c0999b27620a7decbb074d270a67dae000e185ea97eebfb63a83b03fc9058651 |
| G0-C9 risk impact policy | PASS | 30 risk rows have validated machine-readable gateImpact entries |

## Validators

| Command | Exit | Output SHA-256 |
|---|---:|---|
| `node scripts/validate-test-registry.js --json` | 0 | `6e4291ab4930e35a9a69e627144bd8ec09d1173a594f9bac46918a3fbda3785d` |
| `node scripts/validate-final-disposition.js --json` | 0 | `37db2d883b3f045d2fda8d65eb31ca24f155cb59ef99a1a2cff6d7b354df8ff5` |

Registry report: 350 programs,
8 exclusions, fingerprint
`21992f9fcc1625c14baa0a7d53771a88e4f704e97e4c276f4d4b8fd9ea08cd73`, 0 errors.

Disposition report: 225 records,
0 errors; dispositions
`EXCLUDE` 91, `KEEP` 42, `REBUILD` 92.

## Clean installation

Locked tokenized recipe, run twice with the same fresh isolated cache:

```bash
env -i PATH="${PATH-}" SYSTEMROOT="${SYSTEMROOT-}" WINDIR="${WINDIR-}" PATHEXT="${PATHEXT-}" COMSPEC="${COMSPEC-}" HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/home" XDG_CONFIG_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-config" XDG_CACHE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-cache" XDG_DATA_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-data" XDG_STATE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-state" TMPDIR="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/tmp" TMP="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/tmp" TEMP="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/tmp" GIT_CONFIG_GLOBAL="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/gitconfig" GIT_CONFIG_NOSYSTEM=1 npm_config_cache="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/npm-cache" YARN_CACHE_FOLDER="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/yarn-cache" PIP_CACHE_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/pip-cache" COREPACK_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/corepack" C3_DB_PATH="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/runtime/install.sqlite" C3_PROJECTS_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/runtime/projects" C3_PORT_FILE="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/runtime/intentsmith.port" C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false C3_LOG_LEVEL=warn NODE_ENV=test CI=1 NO_COLOR=1 LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC PYTHONNOUSERSITE=1 ./scripts/install.sh --minimal
```

| Run | Exit | Bytes | Log SHA-256 | Artifact |
|---|---:|---:|---|---|
| clean | 0 | 5545 | `f61b8b2b47cd4ba4314ddfbeb156b3f895ad45ff4b385bee5d4ce403ba7f303b` | `.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/logs/install-clean.log` |
| repeat | 0 | 5367 | `3791fc3a8d1020f0d76ce177dd5d1e9d7d8501369dfa38b5c7e7da902ab10ee2` | `.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/logs/install-repeat.log` |

The producer spawned both recipes without a shell and recorded exact argv,
allowlisted inherited environment keys, explicit isolated overrides, source
state before/after, exit status and log digest in its ignored provenance file.

## Deterministic registry

```bash
env -i PATH="${PATH-}" SYSTEMROOT="${SYSTEMROOT-}" WINDIR="${WINDIR-}" PATHEXT="${PATHEXT-}" COMSPEC="${COMSPEC-}" HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/home" XDG_CONFIG_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-config" XDG_CACHE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-cache" XDG_DATA_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-data" XDG_STATE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-state" TMPDIR="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/tmp" TMP="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/tmp" TEMP="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/tmp" GIT_CONFIG_GLOBAL="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/gitconfig" GIT_CONFIG_NOSYSTEM=1 npm_config_cache="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/npm-cache" YARN_CACHE_FOLDER="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/yarn-cache" PIP_CACHE_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/pip-cache" COREPACK_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/corepack" C3_DB_PATH="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/runtime/install.sqlite" C3_PROJECTS_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/runtime/projects" C3_PORT_FILE="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/runtime/intentsmith.port" C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false C3_LOG_LEVEL=warn NODE_ENV=test CI=1 NO_COLOR=1 LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC PYTHONNOUSERSITE=1 INTENTSMITH_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-data/intentsmith/python/pdf/bin/python" C3_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-data/intentsmith/python/pdf/bin/python" node scripts/nightly-audit.js --profile=offline,database --run-id=deterministic-2f11e801707a93a547795b5e96ff30c7f620ba5b --out-dir=.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/deterministic --timeout-minutes=10 --deadline-hours=8 --concurrency=1
```

- Exit: **0**
- Verdict: **PASS**
- Status: `{"PASS":199,"FAIL":0,"TIMEOUT":0,"BLOCKED":0,"SKIPPED":0}`
- Report: `.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/deterministic/deterministic-2f11e801707a93a547795b5e96ff30c7f620ba5b/report.json`
- Report SHA-256: `281d8c7c9e1673631b1ff737e82d7f4286aa209c05dd02e1e058e827c61e5dfd`
- Inventory: `.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/deterministic/deterministic-2f11e801707a93a547795b5e96ff30c7f620ba5b/inventory.json`
- Inventory SHA-256: `43df783f8cb84bae347f26183c66fbdd3801300419b6b1413c33057a5e5173fb`
- Inventory fingerprint: `3930be5244a64e21a4600f38cd8cd83f6a0fbac866b6004c0d7436e322eba4d8`
- Options fingerprint: `b6c9a55d1eef4edd4cd3c3fc691fe87947b8aad52dc7249c05af5a41fed7db4e`

The verdict is recomputed from all 199 required T1/T2
result rows. Printed assertion totals cannot override suite exits.

## Pilot discrimination — five consecutive runs

| Run | Exit | Verdict | Report SHA-256 |
|---|---:|---|---|
| `pilot-01-2f11e801707a93a547795b5e96ff30c7f620ba5b` | 0 | PASS | `d5e98ff7109babd6ced6d967ec0b9f509e4a244ea4eb5e6b3c008f8ecc0ed83d` |
| `pilot-02-2f11e801707a93a547795b5e96ff30c7f620ba5b` | 0 | PASS | `ce2d0a01a9a4a172c3cd98919cdbbd2fb36ba486b82b14e85d34f3c7fbfd7ac1` |
| `pilot-03-2f11e801707a93a547795b5e96ff30c7f620ba5b` | 0 | PASS | `6556cb844fd9e4be90e3f8d2ec0bed2e1d4ea25cc5009c67070260faf270e08d` |
| `pilot-04-2f11e801707a93a547795b5e96ff30c7f620ba5b` | 0 | PASS | `0de401be009edff2910908225f7ac9addeda8813029c40053ca6b3f55f2f6fa1` |
| `pilot-05-2f11e801707a93a547795b5e96ff30c7f620ba5b` | 0 | PASS | `743bd57131212fc0f7409b04f57843ecd19548c0bd0e541e558e94e0ea576c2b` |

Exact orchestration commands:

- `pilot-01-2f11e801707a93a547795b5e96ff30c7f620ba5b`: `env -i PATH="${PATH-}" SYSTEMROOT="${SYSTEMROOT-}" WINDIR="${WINDIR-}" PATHEXT="${PATHEXT-}" COMSPEC="${COMSPEC-}" HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/home" XDG_CONFIG_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-config" XDG_CACHE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-cache" XDG_DATA_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-data" XDG_STATE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-state" TMPDIR="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/tmp" TMP="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/tmp" TEMP="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/tmp" GIT_CONFIG_GLOBAL="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/gitconfig" GIT_CONFIG_NOSYSTEM=1 npm_config_cache="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/npm-cache" YARN_CACHE_FOLDER="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/yarn-cache" PIP_CACHE_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/pip-cache" COREPACK_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/corepack" C3_DB_PATH="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/runtime/install.sqlite" C3_PROJECTS_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/runtime/projects" C3_PORT_FILE="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/runtime/intentsmith.port" C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false C3_LOG_LEVEL=warn NODE_ENV=test CI=1 NO_COLOR=1 LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC PYTHONNOUSERSITE=1 INTENTSMITH_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-data/intentsmith/python/pdf/bin/python" C3_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-data/intentsmith/python/pdf/bin/python" node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-01-2f11e801707a93a547795b5e96ff30c7f620ba5b --out-dir=.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/pilot --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
- `pilot-02-2f11e801707a93a547795b5e96ff30c7f620ba5b`: `env -i PATH="${PATH-}" SYSTEMROOT="${SYSTEMROOT-}" WINDIR="${WINDIR-}" PATHEXT="${PATHEXT-}" COMSPEC="${COMSPEC-}" HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/home" XDG_CONFIG_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-config" XDG_CACHE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-cache" XDG_DATA_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-data" XDG_STATE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-state" TMPDIR="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/tmp" TMP="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/tmp" TEMP="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/tmp" GIT_CONFIG_GLOBAL="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/gitconfig" GIT_CONFIG_NOSYSTEM=1 npm_config_cache="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/npm-cache" YARN_CACHE_FOLDER="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/yarn-cache" PIP_CACHE_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/pip-cache" COREPACK_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/corepack" C3_DB_PATH="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/runtime/install.sqlite" C3_PROJECTS_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/runtime/projects" C3_PORT_FILE="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/runtime/intentsmith.port" C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false C3_LOG_LEVEL=warn NODE_ENV=test CI=1 NO_COLOR=1 LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC PYTHONNOUSERSITE=1 INTENTSMITH_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-data/intentsmith/python/pdf/bin/python" C3_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-data/intentsmith/python/pdf/bin/python" node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-02-2f11e801707a93a547795b5e96ff30c7f620ba5b --out-dir=.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/pilot --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
- `pilot-03-2f11e801707a93a547795b5e96ff30c7f620ba5b`: `env -i PATH="${PATH-}" SYSTEMROOT="${SYSTEMROOT-}" WINDIR="${WINDIR-}" PATHEXT="${PATHEXT-}" COMSPEC="${COMSPEC-}" HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/home" XDG_CONFIG_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-config" XDG_CACHE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-cache" XDG_DATA_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-data" XDG_STATE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-state" TMPDIR="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/tmp" TMP="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/tmp" TEMP="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/tmp" GIT_CONFIG_GLOBAL="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/gitconfig" GIT_CONFIG_NOSYSTEM=1 npm_config_cache="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/npm-cache" YARN_CACHE_FOLDER="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/yarn-cache" PIP_CACHE_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/pip-cache" COREPACK_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/corepack" C3_DB_PATH="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/runtime/install.sqlite" C3_PROJECTS_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/runtime/projects" C3_PORT_FILE="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/runtime/intentsmith.port" C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false C3_LOG_LEVEL=warn NODE_ENV=test CI=1 NO_COLOR=1 LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC PYTHONNOUSERSITE=1 INTENTSMITH_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-data/intentsmith/python/pdf/bin/python" C3_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-data/intentsmith/python/pdf/bin/python" node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-03-2f11e801707a93a547795b5e96ff30c7f620ba5b --out-dir=.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/pilot --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
- `pilot-04-2f11e801707a93a547795b5e96ff30c7f620ba5b`: `env -i PATH="${PATH-}" SYSTEMROOT="${SYSTEMROOT-}" WINDIR="${WINDIR-}" PATHEXT="${PATHEXT-}" COMSPEC="${COMSPEC-}" HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/home" XDG_CONFIG_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-config" XDG_CACHE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-cache" XDG_DATA_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-data" XDG_STATE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-state" TMPDIR="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/tmp" TMP="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/tmp" TEMP="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/tmp" GIT_CONFIG_GLOBAL="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/gitconfig" GIT_CONFIG_NOSYSTEM=1 npm_config_cache="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/npm-cache" YARN_CACHE_FOLDER="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/yarn-cache" PIP_CACHE_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/pip-cache" COREPACK_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/corepack" C3_DB_PATH="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/runtime/install.sqlite" C3_PROJECTS_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/runtime/projects" C3_PORT_FILE="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/runtime/intentsmith.port" C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false C3_LOG_LEVEL=warn NODE_ENV=test CI=1 NO_COLOR=1 LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC PYTHONNOUSERSITE=1 INTENTSMITH_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-data/intentsmith/python/pdf/bin/python" C3_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-data/intentsmith/python/pdf/bin/python" node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-04-2f11e801707a93a547795b5e96ff30c7f620ba5b --out-dir=.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/pilot --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
- `pilot-05-2f11e801707a93a547795b5e96ff30c7f620ba5b`: `env -i PATH="${PATH-}" SYSTEMROOT="${SYSTEMROOT-}" WINDIR="${WINDIR-}" PATHEXT="${PATHEXT-}" COMSPEC="${COMSPEC-}" HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/home" XDG_CONFIG_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-config" XDG_CACHE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-cache" XDG_DATA_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-data" XDG_STATE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-state" TMPDIR="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/tmp" TMP="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/tmp" TEMP="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/tmp" GIT_CONFIG_GLOBAL="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/gitconfig" GIT_CONFIG_NOSYSTEM=1 npm_config_cache="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/npm-cache" YARN_CACHE_FOLDER="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/yarn-cache" PIP_CACHE_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/pip-cache" COREPACK_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/corepack" C3_DB_PATH="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/runtime/install.sqlite" C3_PROJECTS_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/runtime/projects" C3_PORT_FILE="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/runtime/intentsmith.port" C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false C3_LOG_LEVEL=warn NODE_ENV=test CI=1 NO_COLOR=1 LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC PYTHONNOUSERSITE=1 INTENTSMITH_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-data/intentsmith/python/pdf/bin/python" C3_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-data/intentsmith/python/pdf/bin/python" node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-05-2f11e801707a93a547795b5e96ff30c7f620ba5b --out-dir=.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/pilot --timeout-minutes=5 --deadline-hours=1 --concurrency=1`

The unchanged A9 assertion passed in every run. The repair changed the low-
ceremony C2 fixture, not production score weights or thresholds.

## Model-backed soak guard

- Locked replay: `env -i PATH="${PATH-}" SYSTEMROOT="${SYSTEMROOT-}" WINDIR="${WINDIR-}" PATHEXT="${PATHEXT-}" COMSPEC="${COMSPEC-}" HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/home" XDG_CONFIG_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-config" XDG_CACHE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-cache" XDG_DATA_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-data" XDG_STATE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-state" TMPDIR="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/tmp" TMP="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/tmp" TEMP="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/tmp" GIT_CONFIG_GLOBAL="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/gitconfig" GIT_CONFIG_NOSYSTEM=1 npm_config_cache="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/npm-cache" YARN_CACHE_FOLDER="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/yarn-cache" PIP_CACHE_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/pip-cache" COREPACK_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/corepack" C3_DB_PATH="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/runtime/install.sqlite" C3_PROJECTS_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/runtime/projects" C3_PORT_FILE="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/runtime/intentsmith.port" C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false C3_LOG_LEVEL=warn NODE_ENV=test CI=1 NO_COLOR=1 LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC PYTHONNOUSERSITE=1 INTENTSMITH_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-data/intentsmith/python/pdf/bin/python" C3_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/install-root/xdg-data/intentsmith/python/pdf/bin/python" node scripts/nightly-audit.js --suite=IS-T5-TESTS-SOAK-ATTACHMENT-HEAVY-TEST,IS-T5-TESTS-SOAK-BREAK-PATTERN-PROBE-TEST,IS-T5-TESTS-SOAK-FOLLOWUP-LOAD-TEST,IS-T5-TESTS-SOAK-MIXED-SESSION-SIMULATION-TEST,IS-T5-TESTS-SOAK-SHORT-INPUT-STRESS-TEST --run-id=soak-guard-2f11e801707a93a547795b5e96ff30c7f620ba5b --out-dir=.intentsmith-artifacts/gate0/candidate-2f11e801707a93a547795b5e96ff30c7f620ba5b/soak --timeout-minutes=60 --deadline-hours=1 --concurrency=1`
- Exit: **2**
- Verdict: **BLOCKED**
- Named prerequisites: `gpu, ollama`
- Report SHA-256: `654561419c259d128fafbde5677921f1d96ffab6dcbfa28e351cec465405d383`
- Inventory SHA-256: `f3335f23edd964d5cea5182ec22ef09f36b29f2c7cf50e821c09f7945dd6226e`

Five soak programs previously misdeclared as model-free are now blocked before
execution unless Ollama and GPU are explicitly authorized.

## `a7b90e3..ffd21cf` disposition

- 225 records total
- Dispositions: `EXCLUDE` 91, `KEEP` 42, `REBUILD` 92
- Terminals: `DEFERRED(external-network+owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` 1, `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` 30, `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+three-request-gpu-headroom)` 1, `REPAIRED` 60
- Resolutions: `ABSENT` 91, `EXACT` 32, `MAPPED_REPAIR` 3, `MODIFIED` 99
- Repaired subjects: 60/
  60, digest
  `2c3bb1d3039456b519259b189468c7571a2ec947c6a9291e6cc37fc49109857f`
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
- Later-gate risks: G0-R009: OPEN, G0-R018: OPEN, G0-R030: OPEN.
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
