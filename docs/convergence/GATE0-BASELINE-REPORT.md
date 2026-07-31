# IntentSmith Gate 0 Baseline Report

## Verdict

**CONDITIONAL PASS**

- Candidate: `c1de74e55da73724628a9f203b4dde6205a4b26a`
- Branch: `codex/s1-legacy-loopback-containment`
- Parsed-registry serialization fingerprint
  (`sha256-json-stringify-v1`): `21992f9fcc1625c14baa0a7d53771a88e4f704e97e4c276f4d4b8fd9ea08cd73`
- Execution context: `ATTESTED_CANDIDATE_RUN` at `$PWD`; clean candidate,
  dependencies installed by the bound install phases
- Evidence generated: 2026-07-31T11:44:34.504Z
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
| G0-C8 generated evidence | PASS | typed producer provenance .intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/provenance.json is bound by SHA-256 557cd810ed37935d0cd8e042add181dc5bc43158c6b6468bea79dcc65a94c41f |
| G0-C9 risk impact policy | PASS | 29 risk rows have validated machine-readable gateImpact entries |

## Validators

| Command | Exit | Output SHA-256 |
|---|---:|---|
| `node scripts/validate-test-registry.js --json` | 0 | `6e4291ab4930e35a9a69e627144bd8ec09d1173a594f9bac46918a3fbda3785d` |
| `node scripts/validate-final-disposition.js --json` | 0 | `072f51e70486adfdc0a97c486370fc3d6ba70e3ea931f0bdfd7a3b432092cbd5` |

Registry report: 350 programs,
8 exclusions, fingerprint
`21992f9fcc1625c14baa0a7d53771a88e4f704e97e4c276f4d4b8fd9ea08cd73`, 0 errors.

Disposition report: 225 records,
0 errors; dispositions
`EXCLUDE` 91, `KEEP` 42, `REBUILD` 92.

## Clean installation

Locked tokenized recipe, run twice with the same fresh isolated cache:

```bash
env -i PATH="${PATH-}" SYSTEMROOT="${SYSTEMROOT-}" WINDIR="${WINDIR-}" PATHEXT="${PATHEXT-}" COMSPEC="${COMSPEC-}" HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/home" XDG_CONFIG_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-config" XDG_CACHE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-cache" XDG_DATA_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data" XDG_STATE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-state" TMPDIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" TMP="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" TEMP="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" GIT_CONFIG_GLOBAL="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/gitconfig" GIT_CONFIG_NOSYSTEM=1 npm_config_cache="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/npm-cache" YARN_CACHE_FOLDER="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/yarn-cache" PIP_CACHE_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/pip-cache" COREPACK_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/corepack" C3_DB_PATH="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/install.sqlite" C3_PROJECTS_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/projects" C3_PORT_FILE="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/intentsmith.port" C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false C3_LOG_LEVEL=warn NODE_ENV=test CI=1 NO_COLOR=1 LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC PYTHONNOUSERSITE=1 ./scripts/install.sh --minimal
```

| Run | Exit | Bytes | Log SHA-256 | Artifact |
|---|---:|---:|---|---|
| clean | 0 | 5545 | `932e0a34885d6726b97861f480258f2a072cbe09af5731b735212a59477bf820` | `.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/logs/install-clean.log` |
| repeat | 0 | 5367 | `e439fcef278d37a6b0ebd8cc4c514ec20de0a829ccf4de48a48e043d0f8be84e` | `.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/logs/install-repeat.log` |

The producer spawned both recipes without a shell and recorded exact argv,
allowlisted inherited environment keys, explicit isolated overrides, source
state before/after, exit status and log digest in its ignored provenance file.

## Deterministic registry

```bash
env -i PATH="${PATH-}" SYSTEMROOT="${SYSTEMROOT-}" WINDIR="${WINDIR-}" PATHEXT="${PATHEXT-}" COMSPEC="${COMSPEC-}" HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/home" XDG_CONFIG_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-config" XDG_CACHE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-cache" XDG_DATA_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data" XDG_STATE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-state" TMPDIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" TMP="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" TEMP="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" GIT_CONFIG_GLOBAL="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/gitconfig" GIT_CONFIG_NOSYSTEM=1 npm_config_cache="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/npm-cache" YARN_CACHE_FOLDER="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/yarn-cache" PIP_CACHE_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/pip-cache" COREPACK_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/corepack" C3_DB_PATH="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/install.sqlite" C3_PROJECTS_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/projects" C3_PORT_FILE="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/intentsmith.port" C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false C3_LOG_LEVEL=warn NODE_ENV=test CI=1 NO_COLOR=1 LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC PYTHONNOUSERSITE=1 INTENTSMITH_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data/intentsmith/python/pdf/bin/python" C3_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data/intentsmith/python/pdf/bin/python" node scripts/nightly-audit.js --profile=offline,database --run-id=deterministic-c1de74e55da73724628a9f203b4dde6205a4b26a --out-dir=.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/deterministic --timeout-minutes=10 --deadline-hours=8 --concurrency=1
```

- Exit: **0**
- Verdict: **PASS**
- Status: `{"PASS":199,"FAIL":0,"TIMEOUT":0,"BLOCKED":0,"SKIPPED":0}`
- Report: `.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/deterministic/deterministic-c1de74e55da73724628a9f203b4dde6205a4b26a/report.json`
- Report SHA-256: `00e83c9c4cf7f4f0d978b0e4d542ab600333ac3933a988461d4d7a62de470421`
- Inventory: `.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/deterministic/deterministic-c1de74e55da73724628a9f203b4dde6205a4b26a/inventory.json`
- Inventory SHA-256: `661070bd1cd6496811d752428b651372a825a51d7d320562946917066ee98554`
- Inventory fingerprint: `3930be5244a64e21a4600f38cd8cd83f6a0fbac866b6004c0d7436e322eba4d8`
- Options fingerprint: `b6c9a55d1eef4edd4cd3c3fc691fe87947b8aad52dc7249c05af5a41fed7db4e`

The verdict is recomputed from all 199 required T1/T2
result rows. Printed assertion totals cannot override suite exits.

## Pilot discrimination — five consecutive runs

| Run | Exit | Verdict | Report SHA-256 |
|---|---:|---|---|
| `pilot-01-c1de74e55da73724628a9f203b4dde6205a4b26a` | 0 | PASS | `c9e1d115b5e42d94c7ab44e418916da64b4561c3cb98f17b2896479b220837fe` |
| `pilot-02-c1de74e55da73724628a9f203b4dde6205a4b26a` | 0 | PASS | `aa8c593617d873117bcfaa45b24980438e6914b8b41d066756419fc8bf7f7685` |
| `pilot-03-c1de74e55da73724628a9f203b4dde6205a4b26a` | 0 | PASS | `e1ebc79e5c90840e8df49ae6df6dbc5d7a1528ed1be19206335981fa9c6d1419` |
| `pilot-04-c1de74e55da73724628a9f203b4dde6205a4b26a` | 0 | PASS | `e9f8acf54c2b36735ee92d9c783147dd72a3e087be499c573b8c771201ad3c75` |
| `pilot-05-c1de74e55da73724628a9f203b4dde6205a4b26a` | 0 | PASS | `889c7d5a6c3b4fd0402d2ed9269f2af513b69acede4c271a84838edd4b898583` |

Exact orchestration commands:

- `pilot-01-c1de74e55da73724628a9f203b4dde6205a4b26a`: `env -i PATH="${PATH-}" SYSTEMROOT="${SYSTEMROOT-}" WINDIR="${WINDIR-}" PATHEXT="${PATHEXT-}" COMSPEC="${COMSPEC-}" HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/home" XDG_CONFIG_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-config" XDG_CACHE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-cache" XDG_DATA_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data" XDG_STATE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-state" TMPDIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" TMP="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" TEMP="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" GIT_CONFIG_GLOBAL="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/gitconfig" GIT_CONFIG_NOSYSTEM=1 npm_config_cache="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/npm-cache" YARN_CACHE_FOLDER="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/yarn-cache" PIP_CACHE_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/pip-cache" COREPACK_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/corepack" C3_DB_PATH="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/install.sqlite" C3_PROJECTS_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/projects" C3_PORT_FILE="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/intentsmith.port" C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false C3_LOG_LEVEL=warn NODE_ENV=test CI=1 NO_COLOR=1 LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC PYTHONNOUSERSITE=1 INTENTSMITH_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data/intentsmith/python/pdf/bin/python" C3_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data/intentsmith/python/pdf/bin/python" node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-01-c1de74e55da73724628a9f203b4dde6205a4b26a --out-dir=.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/pilot --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
- `pilot-02-c1de74e55da73724628a9f203b4dde6205a4b26a`: `env -i PATH="${PATH-}" SYSTEMROOT="${SYSTEMROOT-}" WINDIR="${WINDIR-}" PATHEXT="${PATHEXT-}" COMSPEC="${COMSPEC-}" HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/home" XDG_CONFIG_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-config" XDG_CACHE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-cache" XDG_DATA_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data" XDG_STATE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-state" TMPDIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" TMP="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" TEMP="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" GIT_CONFIG_GLOBAL="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/gitconfig" GIT_CONFIG_NOSYSTEM=1 npm_config_cache="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/npm-cache" YARN_CACHE_FOLDER="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/yarn-cache" PIP_CACHE_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/pip-cache" COREPACK_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/corepack" C3_DB_PATH="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/install.sqlite" C3_PROJECTS_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/projects" C3_PORT_FILE="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/intentsmith.port" C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false C3_LOG_LEVEL=warn NODE_ENV=test CI=1 NO_COLOR=1 LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC PYTHONNOUSERSITE=1 INTENTSMITH_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data/intentsmith/python/pdf/bin/python" C3_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data/intentsmith/python/pdf/bin/python" node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-02-c1de74e55da73724628a9f203b4dde6205a4b26a --out-dir=.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/pilot --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
- `pilot-03-c1de74e55da73724628a9f203b4dde6205a4b26a`: `env -i PATH="${PATH-}" SYSTEMROOT="${SYSTEMROOT-}" WINDIR="${WINDIR-}" PATHEXT="${PATHEXT-}" COMSPEC="${COMSPEC-}" HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/home" XDG_CONFIG_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-config" XDG_CACHE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-cache" XDG_DATA_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data" XDG_STATE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-state" TMPDIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" TMP="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" TEMP="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" GIT_CONFIG_GLOBAL="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/gitconfig" GIT_CONFIG_NOSYSTEM=1 npm_config_cache="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/npm-cache" YARN_CACHE_FOLDER="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/yarn-cache" PIP_CACHE_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/pip-cache" COREPACK_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/corepack" C3_DB_PATH="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/install.sqlite" C3_PROJECTS_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/projects" C3_PORT_FILE="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/intentsmith.port" C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false C3_LOG_LEVEL=warn NODE_ENV=test CI=1 NO_COLOR=1 LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC PYTHONNOUSERSITE=1 INTENTSMITH_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data/intentsmith/python/pdf/bin/python" C3_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data/intentsmith/python/pdf/bin/python" node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-03-c1de74e55da73724628a9f203b4dde6205a4b26a --out-dir=.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/pilot --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
- `pilot-04-c1de74e55da73724628a9f203b4dde6205a4b26a`: `env -i PATH="${PATH-}" SYSTEMROOT="${SYSTEMROOT-}" WINDIR="${WINDIR-}" PATHEXT="${PATHEXT-}" COMSPEC="${COMSPEC-}" HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/home" XDG_CONFIG_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-config" XDG_CACHE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-cache" XDG_DATA_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data" XDG_STATE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-state" TMPDIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" TMP="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" TEMP="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" GIT_CONFIG_GLOBAL="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/gitconfig" GIT_CONFIG_NOSYSTEM=1 npm_config_cache="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/npm-cache" YARN_CACHE_FOLDER="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/yarn-cache" PIP_CACHE_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/pip-cache" COREPACK_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/corepack" C3_DB_PATH="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/install.sqlite" C3_PROJECTS_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/projects" C3_PORT_FILE="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/intentsmith.port" C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false C3_LOG_LEVEL=warn NODE_ENV=test CI=1 NO_COLOR=1 LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC PYTHONNOUSERSITE=1 INTENTSMITH_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data/intentsmith/python/pdf/bin/python" C3_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data/intentsmith/python/pdf/bin/python" node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-04-c1de74e55da73724628a9f203b4dde6205a4b26a --out-dir=.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/pilot --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
- `pilot-05-c1de74e55da73724628a9f203b4dde6205a4b26a`: `env -i PATH="${PATH-}" SYSTEMROOT="${SYSTEMROOT-}" WINDIR="${WINDIR-}" PATHEXT="${PATHEXT-}" COMSPEC="${COMSPEC-}" HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/home" XDG_CONFIG_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-config" XDG_CACHE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-cache" XDG_DATA_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data" XDG_STATE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-state" TMPDIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" TMP="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" TEMP="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" GIT_CONFIG_GLOBAL="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/gitconfig" GIT_CONFIG_NOSYSTEM=1 npm_config_cache="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/npm-cache" YARN_CACHE_FOLDER="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/yarn-cache" PIP_CACHE_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/pip-cache" COREPACK_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/corepack" C3_DB_PATH="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/install.sqlite" C3_PROJECTS_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/projects" C3_PORT_FILE="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/intentsmith.port" C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false C3_LOG_LEVEL=warn NODE_ENV=test CI=1 NO_COLOR=1 LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC PYTHONNOUSERSITE=1 INTENTSMITH_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data/intentsmith/python/pdf/bin/python" C3_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data/intentsmith/python/pdf/bin/python" node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-05-c1de74e55da73724628a9f203b4dde6205a4b26a --out-dir=.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/pilot --timeout-minutes=5 --deadline-hours=1 --concurrency=1`

The unchanged A9 assertion passed in every run. The repair changed the low-
ceremony C2 fixture, not production score weights or thresholds.

## Model-backed soak guard

- Locked replay: `env -i PATH="${PATH-}" SYSTEMROOT="${SYSTEMROOT-}" WINDIR="${WINDIR-}" PATHEXT="${PATHEXT-}" COMSPEC="${COMSPEC-}" HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/home" XDG_CONFIG_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-config" XDG_CACHE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-cache" XDG_DATA_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data" XDG_STATE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-state" TMPDIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" TMP="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" TEMP="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" GIT_CONFIG_GLOBAL="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/gitconfig" GIT_CONFIG_NOSYSTEM=1 npm_config_cache="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/npm-cache" YARN_CACHE_FOLDER="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/yarn-cache" PIP_CACHE_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/pip-cache" COREPACK_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/corepack" C3_DB_PATH="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/install.sqlite" C3_PROJECTS_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/projects" C3_PORT_FILE="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/intentsmith.port" C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false C3_LOG_LEVEL=warn NODE_ENV=test CI=1 NO_COLOR=1 LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC PYTHONNOUSERSITE=1 INTENTSMITH_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data/intentsmith/python/pdf/bin/python" C3_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data/intentsmith/python/pdf/bin/python" node scripts/nightly-audit.js --suite=IS-T5-TESTS-SOAK-ATTACHMENT-HEAVY-TEST,IS-T5-TESTS-SOAK-BREAK-PATTERN-PROBE-TEST,IS-T5-TESTS-SOAK-FOLLOWUP-LOAD-TEST,IS-T5-TESTS-SOAK-MIXED-SESSION-SIMULATION-TEST,IS-T5-TESTS-SOAK-SHORT-INPUT-STRESS-TEST --run-id=soak-guard-c1de74e55da73724628a9f203b4dde6205a4b26a --out-dir=.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/soak --timeout-minutes=60 --deadline-hours=1 --concurrency=1`
- Exit: **2**
- Verdict: **BLOCKED**
- Named prerequisites: `gpu, ollama`
- Report SHA-256: `9bb8a4d0a2773554e292761e2d92277da09c10343ddc41ab426bebeda522df2a`
- Inventory SHA-256: `09ba18b3ecda77b08513ed4c2e404c5e5ce9316e3a4d58c75b2a60dc2f243a3c`

Five soak programs previously misdeclared as model-free are now blocked before
execution unless Ollama and GPU are explicitly authorized.

## `a7b90e3..ffd21cf` disposition

- 225 records total
- Dispositions: `EXCLUDE` 91, `KEEP` 42, `REBUILD` 92
- Terminals: `DEFERRED(external-network+owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` 1, `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` 30, `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+three-request-gpu-headroom)` 1, `REPAIRED` 60
- Resolutions: `ABSENT` 91, `EXACT` 32, `MAPPED_REPAIR` 3, `MODIFIED` 99
- Repaired subjects: 60/
  60, digest
  `ae7445713983927df68bfd33fc8d0d693a8b77f0964b5d3306df5ee547cc1de1`
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
