# IntentSmith Gate 0 Baseline Report

## Verdict

**FAIL**

- Candidate: `7372ad9f70c8a662c71122c2ba0ba5c6f6f90eb5`
- Branch: `codex/intentsmith-1.0`
- Registry SHA-256: `a7a5c6d4670159cd38a08edea8aabbf868eb3342a3baf1857b6a4849d1f4960a`
- Evidence generated: 2026-07-30T17:16:16.218Z
- Independent review: PENDING

The candidate does not satisfy Gate 0. Failed clauses: none. Repository-local blockers: G0-R023: OPEN, G0-R025: OPEN.
The confirmed privacy compromise remains a separate operator-owned incident
and is not presented as nearly green.

## Gate clauses

| Clause | Result | Evidence |
|---|---|---|
| G0-C1 clean candidate | PASS | all 199 suite records carry clean source-tree evidence at the candidate SHA |
| G0-C2 disposition | PASS | 225 records; validator exit 0 |
| G0-C3 registry | PASS | 350 runnable programs and 8 explicit support exclusions; validator exit 0 |
| G0-C4 clean install | PASS | two consecutive minimal installs, both exit 0; second idempotent |
| G0-C5 deterministic T1/T2 | PASS | 199 PASS, 0 FAIL/TIMEOUT/BLOCKED/SKIPPED |
| G0-C6 defective suites excluded | PASS | 0 registry rows are KNOWN_DEFECTIVE; none appears in green deterministic evidence |
| G0-C7 blockers specific | PASS | every registry BLOCKED row names server, external-network, Ollama, or GPU |
| G0-C8 generated evidence | PASS | status, index, baseline report, and review packet derive from the clean candidate |

## Validators

| Command | Exit | Output SHA-256 |
|---|---:|---|
| `node scripts/validate-test-registry.js --json` | 0 | `35e90be592602f15a9ae6961e929b651dac3e33ab7cfde1df4be07677d3b186f` |
| `node scripts/validate-final-disposition.js --json` | 0 | `cebb800de5c360bed8a2165d8373d1a64dfbc28f7e1e559fe690a1ea97a5bba4` |

Registry report: 350 programs,
8 exclusions, fingerprint
`a7a5c6d4670159cd38a08edea8aabbf868eb3342a3baf1857b6a4849d1f4960a`, 0 errors.

Disposition report: 225 records,
0 errors; dispositions
`EXCLUDE` 91, `KEEP` 42, `REBUILD` 92.

## Clean installation

Exact command, run twice with the same fresh isolated cache:

```bash
env XDG_CACHE_HOME=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/xdg-cache XDG_CONFIG_HOME=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/xdg-config XDG_DATA_HOME=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/xdg-data XDG_STATE_HOME=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/xdg-state npm_config_cache=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/npm-cache YARN_CACHE_FOLDER=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/yarn-cache PIP_CACHE_DIR=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/pip-cache COREPACK_HOME=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/corepack C3_DB_PATH=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/runtime/install.sqlite C3_PROJECTS_DIR=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/runtime/projects ./scripts/install.sh --minimal
```

| Run | Exit | Bytes | Log SHA-256 | Local artifact |
|---|---:|---:|---|---|
| clean | 0 | 7857 | `caeda248c03509524c71c998f3b46b5462e62efe431a8aa0116207691932ec01` | `/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-logs/clean.typescript` |
| idempotent | 0 | 7610 | `77bd9f53ae3f45dd3017dbb0f6aa3fa493497204682f39964f0dfcfe2a778b37` | `/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-logs/idempotent.typescript` |

The first run installed locked Node/Yarn/Python dependencies and built the IDE.
The second run exited 0 and reported the frozen Yarn tree already up to date.

## Deterministic registry

```bash
env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --profile=offline,database --run-id=gate0-deterministic-199-7372ad9 --out-dir=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/deterministic --timeout-minutes=10 --deadline-hours=8 --concurrency=1
```

- Exit: **0**
- Verdict: **PASS**
- Status: `{"PASS":199,"FAIL":0,"TIMEOUT":0,"BLOCKED":0,"SKIPPED":0}`
- Report: `/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/deterministic/gate0-deterministic-199-7372ad9/report.json`
- Report SHA-256: `e921d934b005b0e7a0bd279f97b12de6e1c874502052a44348e8972996c2a151`
- Inventory fingerprint: `89bfba52129a0d88dd0808feaa5a741f2c0fe8c4ac3de78ea141a46c9c393361`
- Options fingerprint: `b6c9a55d1eef4edd4cd3c3fc691fe87947b8aad52dc7249c05af5a41fed7db4e`

All 199 required T1/T2 suites passed from clean
per-suite environments. Printed assertion totals were not used to override
suite exits.

## Pilot discrimination — five consecutive runs

| Run | Exit | Verdict | Report SHA-256 |
|---|---:|---|---|
| `pilot-7372-01` | 0 | PASS | `fde83caa370d3c599e0023caa0dad3b45f9c0cf5105280ef53d633cb71b4526d` |
| `pilot-7372-02` | 0 | PASS | `514611ff3d5fb5bb8f9ccd8183f27dfe80b4d6ee6b6c04d5c424089fc539b439` |
| `pilot-7372-03` | 0 | PASS | `079d1f3e6e0ff1f085d61705e386b15a486af09b2814ecc712d7495ab3a18500` |
| `pilot-7372-04` | 0 | PASS | `86007c4fc78af10216d7317a3a7e333a4fd9a3aa26d08a7a142bd417e4bb3006` |
| `pilot-7372-05` | 0 | PASS | `c8e3c00f2b1c93268bb5bf5ebff66729f8b437715b3d36c75d036e5fa000db0b` |

Exact orchestration commands:

- `pilot-7372-01`: `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-7372-01 --out-dir=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/pilot-five --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
- `pilot-7372-02`: `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-7372-02 --out-dir=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/pilot-five --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
- `pilot-7372-03`: `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-7372-03 --out-dir=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/pilot-five --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
- `pilot-7372-04`: `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-7372-04 --out-dir=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/pilot-five --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
- `pilot-7372-05`: `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-7372-05 --out-dir=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/pilot-five --timeout-minutes=5 --deadline-hours=1 --concurrency=1`

The unchanged A9 assertion passed in every run. The repair changed the low-
ceremony C2 fixture, not production score weights or thresholds.

## Model-backed soak guard

- Command: `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --suite=IS-T5-TESTS-SOAK-ATTACHMENT-HEAVY-TEST,IS-T5-TESTS-SOAK-BREAK-PATTERN-PROBE-TEST,IS-T5-TESTS-SOAK-FOLLOWUP-LOAD-TEST,IS-T5-TESTS-SOAK-MIXED-SESSION-SIMULATION-TEST,IS-T5-TESTS-SOAK-SHORT-INPUT-STRESS-TEST --run-id=soak-requirement-guard-7372ad9 --out-dir=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/soak-guard --timeout-minutes=60 --deadline-hours=1 --concurrency=1`
- Exit: **2**
- Verdict: **BLOCKED**
- Named prerequisites: `gpu, ollama`
- Report SHA-256: `c55e4927a232069296bb26c99478480751343e7027218c2cea9a7f023986f06b`

Five soak programs previously misdeclared as model-free are now blocked before
execution unless Ollama and GPU are explicitly authorized.

## `a7b90e3..ffd21cf` disposition

- 225 records total
- Dispositions: `EXCLUDE` 91, `KEEP` 42, `REBUILD` 92
- Terminals: `DEFERRED(external-network+owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` 1, `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` 30, `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+three-request-gpu-headroom)` 1, `REPAIRED` 60
- Resolutions: `ABSENT` 91, `EXACT` 32, `MAPPED_REPAIR` 3, `MODIFIED` 99
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
- Repository-local Gate 0 blockers: G0-R023: OPEN, G0-R025: OPEN.
- Public-history remediation, repository visibility, and credential rotation
  remain operator decisions.
- 0 recovered E2E suites retain known false-green
  assertions and are not counted green.
- 79 registry rows remain explicitly `BLOCKED` on named
  prerequisites.
- Registry discovery covers every supported program-language file independent
  of its filename; 8 support/aggregate files are
  explicit reasoned exclusions.
- Product DB initialization remains an import side effect; all authoritative
  registry runs set an isolated `C3_DB_PATH` (`G0-R012`).
- The T1 shared-`/tmp` convention remains a documented scope decision
  (`G0-R014`).

## Recommended next step

Repair the failed local evidence or repository blocker, then repeat the clean candidate run and regenerate this report.
