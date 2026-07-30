# IntentSmith Gate 0 Baseline Report

## Verdict

**CONDITIONAL PASS**

- Candidate: `22a9b848db1be69f6cd0657d5d0e9bffb44bcb19`
- Branch: `codex/intentsmith-1.0`
- Registry SHA-256: `f930d637693759df07c290ed415477ba5bf461a0fe4ec71ab207e5663da0bf60`
- Evidence generated: 2026-07-30T10:40:13.721Z
- Independent review: PENDING

The code/test baseline satisfies the local deterministic Gate 0 clauses.
Acceptance remains conditional until the bounded Opus review is evaluated.
The confirmed privacy compromise remains a separate operator-owned incident
and is not presented as nearly green.

## Validators

| Command | Exit | Output SHA-256 |
|---|---:|---|
| `node scripts/validate-test-registry.js` | 0 | `f0594ce52a68572652cd1991ed31936a002f2d275fb977b18b97efd0a1c64d74` |
| `node scripts/validate-final-disposition.js` | 0 | `261126d3b5014a6a1969cfd56274a83409309d60b0293b8fcdcf0fe0399c1dae` |

Registry output: `Test registry valid: 350 runnable programs, sha256 f930d637693759df07c290ed415477ba5bf461a0fe4ec71ab207e5663da0bf60`

Disposition output: `Disposition valid: 225 records; dispositions={"EXCLUDE":91,"KEEP":42,"REBUILD":92}; resolutions={"ABSENT":91,"EXACT":87,"MAPPED_REPAIR":3,"MODIFIED":44}`

## Clean installation

Exact command, run twice with the same fresh isolated cache:

```bash
env XDG_CACHE_HOME=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/xdg-cache XDG_CONFIG_HOME=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/xdg-config XDG_DATA_HOME=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/xdg-data XDG_STATE_HOME=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/xdg-state npm_config_cache=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/npm-cache YARN_CACHE_FOLDER=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/yarn-cache PIP_CACHE_DIR=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/pip-cache COREPACK_HOME=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/corepack C3_DB_PATH=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/runtime/install.sqlite C3_PROJECTS_DIR=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/runtime/projects ./scripts/install.sh --minimal
```

| Run | Exit | Bytes | Log SHA-256 | Local artifact |
|---|---:|---:|---|---|
| clean | 0 | 7652 | `a2cf56fcac32271c75f0f15a3fcb8bb6723f34a29bd79bba38478a9938d1ca14` | `.intentsmith-artifacts/gate0/candidate-22a9b84/install-logs/clean.typescript` |
| idempotent | 0 | 7405 | `7c169ad6456a557535b6dda4bcb560c62db8ef4b3c63eed67ab41b807f66669a` | `.intentsmith-artifacts/gate0/candidate-22a9b84/install-logs/idempotent.typescript` |

The first run installed locked Node/Yarn/Python dependencies and built the IDE.
The second run exited 0 and reported the frozen Yarn tree already up to date.

## Deterministic registry

```bash
env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --profile=offline,database --run-id=gate0-deterministic-199 --out-dir=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/deterministic --timeout-minutes=10 --deadline-hours=8 --concurrency=1
```

- Exit: **0**
- Verdict: **PASS**
- Status: `{"PASS":199,"FAIL":0,"TIMEOUT":0,"BLOCKED":0,"SKIPPED":0}`
- Report: `.intentsmith-artifacts/gate0/candidate-22a9b84/deterministic/gate0-deterministic-199/report.json`
- Report SHA-256: `bcea862ee9bc31f526e301248869b98cddf07e2cd6d33e1d2b0cf212a41eac2f`
- Inventory fingerprint: `89bfba52129a0d88dd0808feaa5a741f2c0fe8c4ac3de78ea141a46c9c393361`
- Options fingerprint: `b6c9a55d1eef4edd4cd3c3fc691fe87947b8aad52dc7249c05af5a41fed7db4e`

All 199 required T1/T2 suites passed from clean
per-suite environments. Printed assertion totals were not used to override
suite exits.

## Pilot discrimination — five consecutive runs

| Run | Exit | Verdict | Report SHA-256 |
|---|---:|---|---|
| `pilot-01` | 0 | PASS | `73e3499e4d3886bd460cfb294fa070eb8f44cf996f89d700828835d1e809e39e` |
| `pilot-02` | 0 | PASS | `e1f186558130b39035516e61fb27fc4a1cb1e36f3e92232de9f9e856c342a38f` |
| `pilot-03` | 0 | PASS | `3ec23c9d51d15f79d27f3e103666f553f418ed6ed2c45fd1c85d28ea944b2f97` |
| `pilot-04` | 0 | PASS | `ea62b725a1edfe082459fb03ae3951b5c8d574a5822514868f6dd0d934834e76` |
| `pilot-05` | 0 | PASS | `ab972352a698439afb9be950c02099574ab5b6b97b645771724c206236c7f5d4` |

Exact orchestration commands:

- `pilot-01`: `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-01 --out-dir=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/pilot-five --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
- `pilot-02`: `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-02 --out-dir=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/pilot-five --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
- `pilot-03`: `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-03 --out-dir=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/pilot-five --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
- `pilot-04`: `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-04 --out-dir=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/pilot-five --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
- `pilot-05`: `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-05 --out-dir=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/pilot-five --timeout-minutes=5 --deadline-hours=1 --concurrency=1`

The unchanged A9 assertion passed in every run. The repair changed the low-
ceremony C2 fixture, not production score weights or thresholds.

## Model-backed soak guard

- Command: `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --suite=IS-T5-TESTS-SOAK-ATTACHMENT-HEAVY-TEST,IS-T5-TESTS-SOAK-BREAK-PATTERN-PROBE-TEST,IS-T5-TESTS-SOAK-FOLLOWUP-LOAD-TEST,IS-T5-TESTS-SOAK-MIXED-SESSION-SIMULATION-TEST,IS-T5-TESTS-SOAK-SHORT-INPUT-STRESS-TEST --run-id=soak-requirement-guard --out-dir=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/soak-guard --timeout-minutes=60 --deadline-hours=1 --concurrency=1`
- Exit: **2**
- Verdict: **BLOCKED**
- Named prerequisites: `gpu, ollama`
- Report SHA-256: `05ca54b9232b9a6fc526c857a3445d907b2cec61ac688534771584671e4c1b02`

Five soak programs previously misdeclared as model-free are now blocked before
execution unless Ollama and GPU are explicitly authorized.

## `a7b90e3..ffd21cf` disposition

- 225 records total
- `EXCLUDE`: 91
- `KEEP`: 42
- `REBUILD`: 92
- Resolutions: `ABSENT` 91, `EXACT` 87, `MAPPED_REPAIR` 3, `MODIFIED` 44
- Unresolved path records: 0

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

- Independent review has not yet reproduced the result.
- Public-history remediation, repository visibility, and credential rotation
  remain operator decisions.
- 25 recovered E2E suites retain known false-green
  assertions and are not counted green.
- 54 registry rows remain explicitly `BLOCKED` on named
  prerequisites.
- Registry discovery covers every supported program-language file independent
  of its filename; 8 support/aggregate files are
  explicit reasoned exclusions.
- Product DB initialization remains an import side effect; all authoritative
  registry runs set an isolated `C3_DB_PATH` (`G0-R012`).
- The T1 shared-`/tmp` convention remains a documented scope decision
  (`G0-R014`).

## Recommended next step

Perform the bounded Opus 5 read-only review, evaluate every finding against the
candidate and evidence, then ask the operator whether Gate 0 may be accepted.
Do not begin the next gate from this conditional checkpoint.
