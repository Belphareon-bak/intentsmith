# IntentSmith Gate 0 Baseline Report

## Verdict

**CONDITIONAL PASS**

- Candidate: `82dbc3b30ad0c7329182dbe399705d874b004f2e`
- Branch: `codex/intentsmith-1.0`
- Registry SHA-256: `f6edc6ccff693284ee01ed159e90faea20e94662892d7b84b2f61efdf35e03b5`
- Evidence generated: 2026-07-30T19:58:58.489Z
- Independent review: PENDING

The code/test baseline satisfies the local deterministic Gate 0 clauses. Acceptance remains conditional until the bounded Opus review is evaluated.
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
| G0-C9 risk impact policy | PASS | 27 risk rows have validated machine-readable gateImpact entries |

## Validators

| Command | Exit | Output SHA-256 |
|---|---:|---|
| `node scripts/validate-test-registry.js --json` | 0 | `92b421854f9515922ab9f609ce044e38cbabf9586a87ccdb038b8f9f1af2dd00` |
| `node scripts/validate-final-disposition.js --json` | 0 | `93e87b939d5672a93bb81e4da1cedc41a0778f2d09742e5be945007fc47f497a` |

Registry report: 350 programs,
8 exclusions, fingerprint
`f6edc6ccff693284ee01ed159e90faea20e94662892d7b84b2f61efdf35e03b5`, 0 errors.

Disposition report: 225 records,
0 errors; dispositions
`EXCLUDE` 91, `KEEP` 42, `REBUILD` 92.

## Clean installation

Exact command, run twice with the same fresh isolated cache:

```bash
env XDG_CACHE_HOME=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-root/xdg-cache XDG_CONFIG_HOME=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-root/xdg-config XDG_DATA_HOME=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-root/xdg-data XDG_STATE_HOME=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-root/xdg-state npm_config_cache=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-root/npm-cache YARN_CACHE_FOLDER=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-root/yarn-cache PIP_CACHE_DIR=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-root/pip-cache COREPACK_HOME=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-root/corepack C3_DB_PATH=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-root/runtime/install.sqlite C3_PROJECTS_DIR=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-root/runtime/projects ./scripts/install.sh --minimal
```

| Run | Exit | Bytes | Log SHA-256 | Local artifact |
|---|---:|---:|---|---|
| clean | 0 | 8014 | `a5f1b95ccb99a69cbdd0b731d0fa865d4db14a62757ef7ae6bb103826f74577e` | `/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-logs/clean.typescript` |
| idempotent | 0 | 7767 | `dd5f8c6767caae35595e086ff81fb68c1b94bb678c2970ab9fc4bb5901f1b8d8` | `/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-logs/idempotent.typescript` |

The first run installed locked Node/Yarn/Python dependencies and built the IDE.
The second run exited 0 and reported the frozen Yarn tree already up to date.

## Deterministic registry

```bash
env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --profile=offline,database --run-id=gate0-deterministic-199-82dbc3b --out-dir=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/deterministic --timeout-minutes=10 --deadline-hours=8 --concurrency=1
```

- Exit: **0**
- Verdict: **PASS**
- Status: `{"PASS":199,"FAIL":0,"TIMEOUT":0,"BLOCKED":0,"SKIPPED":0}`
- Report: `/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/deterministic/gate0-deterministic-199-82dbc3b/report.json`
- Report SHA-256: `0b7a943c2b1f2a050d6ef0be547448fe71d23f2e695fefa429078a1e1898104e`
- Inventory fingerprint: `89bfba52129a0d88dd0808feaa5a741f2c0fe8c4ac3de78ea141a46c9c393361`
- Options fingerprint: `b6c9a55d1eef4edd4cd3c3fc691fe87947b8aad52dc7249c05af5a41fed7db4e`

All 199 required T1/T2 suites passed from clean
per-suite environments. Printed assertion totals were not used to override
suite exits.

## Pilot discrimination — five consecutive runs

| Run | Exit | Verdict | Report SHA-256 |
|---|---:|---|---|
| `pilot-82dbc3-01` | 0 | PASS | `19cad01a0d3368a19be5c973d7825befbd631e964700529edb109d473858bd9f` |
| `pilot-82dbc3-02` | 0 | PASS | `1cb1f08a731adbfce2d964c5cfda56aa3ba1de103c2e94d5616871005f1a6214` |
| `pilot-82dbc3-03` | 0 | PASS | `8c978d7bad56eb98e606cd46b66a98556562dc037ae341afbcbcf89e6cb2e4d1` |
| `pilot-82dbc3-04` | 0 | PASS | `742fddd5d472344fe86fd7658f948cbc9f678ce587cc4ece4ce15de46584ae23` |
| `pilot-82dbc3-05` | 0 | PASS | `c951f14a6525d2b8d20b1597583882d8e26587096bc8550415ff7113190b7bb6` |

Exact orchestration commands:

- `pilot-82dbc3-01`: `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-82dbc3-01 --out-dir=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/pilot-five --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
- `pilot-82dbc3-02`: `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-82dbc3-02 --out-dir=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/pilot-five --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
- `pilot-82dbc3-03`: `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-82dbc3-03 --out-dir=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/pilot-five --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
- `pilot-82dbc3-04`: `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-82dbc3-04 --out-dir=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/pilot-five --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
- `pilot-82dbc3-05`: `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-82dbc3-05 --out-dir=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/pilot-five --timeout-minutes=5 --deadline-hours=1 --concurrency=1`

The unchanged A9 assertion passed in every run. The repair changed the low-
ceremony C2 fixture, not production score weights or thresholds.

## Model-backed soak guard

- Command: `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --suite=IS-T5-TESTS-SOAK-ATTACHMENT-HEAVY-TEST,IS-T5-TESTS-SOAK-BREAK-PATTERN-PROBE-TEST,IS-T5-TESTS-SOAK-FOLLOWUP-LOAD-TEST,IS-T5-TESTS-SOAK-MIXED-SESSION-SIMULATION-TEST,IS-T5-TESTS-SOAK-SHORT-INPUT-STRESS-TEST --run-id=soak-requirement-guard-82dbc3b --out-dir=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/soak-guard --timeout-minutes=60 --deadline-hours=1 --concurrency=1`
- Exit: **2**
- Verdict: **BLOCKED**
- Named prerequisites: `gpu, ollama`
- Report SHA-256: `af4a4fcba8c0cbf3d5d1cde624c41c06f77819906a53cbe3316982afdcdac2cf`

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
- Product DB initialization remains an import side effect; all authoritative
  registry runs set an isolated `C3_DB_PATH` (`G0-R012`).
- The T1 shared-`/tmp` convention remains a documented scope decision
  (`G0-R014`).

## Recommended next step

Perform the bounded Opus 5 read-only review, evaluate every finding against the candidate and evidence, then ask the operator whether Gate 0 may be accepted. Do not begin the next gate from this conditional checkpoint.
