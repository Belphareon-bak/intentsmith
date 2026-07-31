# Gate 0 — Opus 5 Read-only Review Packet

## Review boundary

- Candidate: `c1de74e55da73724628a9f203b4dde6205a4b26a`
- Parsed-registry serialization fingerprint
  (`sha256-json-stringify-v1`): `21992f9fcc1625c14baa0a7d53771a88e4f704e97e4c276f4d4b8fd9ea08cd73`
- Candidate execution context: `ATTESTED_CANDIDATE_RUN` at `$PWD`;
  dependencies installed by the bound install phases
- Focus range: `f11026f062e5d2e75fe6802a3e4e2ad38a6c9dab..c1de74e55da73724628a9f203b4dde6205a4b26a`
- Role: read-only reviewer; do not modify the branch

The earlier large E2E reconstruction is represented by the current
225-row
disposition report (clause
PASS) and registry
evidence. This bounded packet focuses on the final test-trust repairs and
verdict machinery.

- Derived verdict: **CONDITIONAL PASS**
- Independent review status: **PENDING**
- Repository-local blockers: none
- Review-required risks: G0-R015: OPEN
- Later-gate risks: G0-R009: OPEN, G0-R018: OPEN
- Separate incidents: G0-R001: CONTAINED_CURRENT_TREE / OPEN_HISTORY, G0-R002: CONTAINED_CURRENT_TREE / OPEN_HISTORY, G0-R010: OPEN

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

## Commits

- `ec19fa4f603859cd7785bd508ab2c258b4b395b9` fix(gate0): reject stale disposition identity claims
- `e859267f4718e3feb03813df317c891fdeba5ca5` docs(gate0): refresh terminal evidence provenance
- `1c40dfa1eae6c4e27ed12c257f7d12886d19ea80` fix(gate0): emit portable evidence replay commands
- `213e9f109e61bbfdbbfca0e4c6610cad96bb3339` test(gate0): bind root docs to current inventories
- `6bf5166d21c4ccc1b4272da0cf6c89e8c46cc2eb` fix(gate0): bind repaired disposition subjects
- `855fb80095b8f571303fa58ac992a51da3865f6f` gate0: bind reproducible evidence to candidate
- `b594f30a44c8821e451102e1e4d84a04caf86fbc` fix(gate0): isolate install project directory
- `7c20b722b4dc389267d987b461beed1329744df3` fix(gate0): remove audit direct-test sibling
- `091136811400ce4404508971e75ab784d5e4094a` docs(gate0): attest reproducible candidate 7c20b72
- `e9ba95ab6d76c8c05d1c842137fc07ef89458d2d` feat(gate0): define independent review result contract
- `9763ca81d6064ec43ed8cc42cb00f5ae28b1ee07` fix(gate0): assert attestation input disjointness
- `96446ab4893840434bf3856c89fc157c7f5069bc` feat(gate0): validate approved review chain
- `68e68e9f8727c7625be26efffd25493b02d8dd66` feat(gate0): derive approved evidence bytes
- `65e831c6f95cb6dfd6176388526ba2d24d8bee08` feat(gate0): load approved attestation chains
- `473c59c34f3bd6b2f103551b892cd5f3252023c0` feat(gate0): prepare approved review evidence
- `1853ba8c41ecfca470291534916aeb9008292b06` docs(gate0): clarify evidence execution context
- `423265b0cb7cbe5d178f2f6f048b21910889b341` test(gate0): isolate vram discovery fixtures
- `2e1f55672efe18330e6a7e28e4790bf8557e3988` docs(gate0): attest candidate 423265b
- `df5010cd26af608048a77e49b5b40f58644c1107` security: confine legacy listener to loopback
- `2ba21bf658d6dad94f16624a5e33ed3666e8e516` docs(gate0): attest loopback containment candidate
- `428fb8f4431531354edda0744343db6b01197a69` security: validate legacy bind before runtime state
- `b483559dba4e150f4c4ec301e2608297745aa407` security: guard legacy websocket browser origins
- `2312ce3f208801fca285922c41da354362cd5b1c` security: stage exact-target Electron HTTP capability
- `3d03496ec53cd3205f29c7f150b960a86ab35d0a` security: authorize legacy media object URLs
- `c1de74e55da73724628a9f203b4dde6205a4b26a` security: enforce legacy local HTTP boundary

## Diffstat

```text
.env.example                                       |    3 +-
 .../electron/c3-local-http-bootstrap.js            |  219 ++
 c3-ide/applications/electron/c3-preload.js         |   47 +-
 c3-ide/applications/electron/webpack.config.js     |   14 +
 .../lib/browser/center-views-module.js             |   80 +-
 .../c3-chat-panel/lib/browser/chat-panel-module.js |   59 +-
 .../c3-chat-panel/lib/browser/ws-client.js         |   10 +-
 c3-ide/shared/legacy-local-object-url-cache.js     |  208 ++
 docs/README.md                                     |    1 +
 docs/ROADMAP.md                                    |   10 +-
 docs/convergence/CAPABILITY-MATRIX.md              |    2 +-
 docs/convergence/DECISIONS.md                      |    6 +-
 docs/convergence/EVIDENCE-INDEX.json               | 1159 ++++++++-
 .../FINAL-COMMIT-DISPOSITION-SUBJECTS.json         |   74 +
 docs/convergence/FINAL-COMMIT-DISPOSITION.md       |   60 +-
 docs/convergence/GATE-CRITERIA.md                  |  151 +-
 docs/convergence/GATE0-BASELINE-REPORT.md          |   91 +-
 docs/convergence/GATE0-EVIDENCE-CORRECTION.md      |   77 +
 .../GATE0-G0-R029-VRAM-FIXTURE-EVIDENCE.md         |   62 +
 docs/convergence/GATE0-RISK-IMPACT.json            |   10 +
 docs/convergence/RISK-REGISTER.md                  |    8 +-
 docs/convergence/STATUS.md                         |   25 +-
 docs/convergence/TEST-REGISTRY.md                  |    6 +-
 docs/convergence/reviews/GATE0-OPUS-REVIEW.md      |  287 +--
 docs/nightly-audit.md                              |  117 +-
 docs/security/LEGACY-LISTENER-BOUNDARY.md          |  127 +
 package.json                                       |    3 +
 scripts/gate0-attestation-paths.js                 |   19 +
 scripts/gate0-evidence-contract.js                 |  713 ++++++
 scripts/gate0-evidence-projections.js              |  351 +++
 scripts/gate0-evidence-verdict.js                  |   47 +-
 scripts/gate0-promotion-contract.js                |  255 ++
 scripts/gate0-review-contract.js                   |  285 +++
 scripts/generate-gate0-evidence.js                 | 1272 +++++++---
 scripts/install.sh                                 |    3 +-
 scripts/nightly-audit.js                           |   12 +-
 scripts/nightly-orchestrator.js                    |   17 +-
 scripts/promote-gate0-review.js                    |  227 ++
 scripts/run-gate0-candidate-evidence.js            |  691 +++++
 scripts/test-registry.js                           |   48 +-
 scripts/validate-final-disposition.js              |  434 +++-
 scripts/validate-gate0-attestation.js              | 1903 ++++++++++++++
 src/config.js                                      |    4 +-
 src/runtime-environment.js                         |   18 +
 src/security/legacy-listener-policy.js             |   54 +
 src/security/legacy-local-access-policy.js         |  253 ++
 src/server-port-file.js                            |   30 +-
 src/server.js                                      |  109 +-
 src/ws-bridge/index.js                             |    5 +-
 src/ws-bridge/ws-server.js                         |   58 +-
 tests/artifact-validation.test.js                  | 2653 +++++++++++++++++++-
 tests/harness-exit-code.test.js                    |   55 +
 tests/nightly-orchestrator-self-test.js            |   40 +-
 tests/registry.json                                |    8 +-
 tests/repository-hygiene.test.js                   |   84 +
 tests/routes-smoke.test.js                         |  780 +++++-
 tests/upgrade-ux-v125.test.js                      |  404 ++-
 tests/vram-coordination.test.js                    |  132 +-
 tests/ws-bridge.test.js                            |  593 ++++-
 59 files changed, 13516 insertions(+), 957 deletions(-)
```

## Invariants

- Do not weaken A9 or production score thresholds.
- No source/test run may touch operator `data/c3.db`.
- `KNOWN_DEFECTIVE` and `BLOCKED` suites never count green.
- Audit child exits, log hashes, source SHA, cleanup, and clean-tree evidence
  determine the verdict; printed assertion totals do not.
- PDF tests use the isolated locked interpreter.
- No history rewrite, force push, merge, tag, release, credential rotation, or
  user-data deletion occurred.

## Verification

- Deterministic registry: PASS, exit
  0, status
  `{"PASS":199,"FAIL":0,"TIMEOUT":0,"BLOCKED":0,"SKIPPED":0}`, report SHA
  `00e83c9c4cf7f4f0d978b0e4d542ab600333ac3933a988461d4d7a62de470421`; locked replay
  `env -i PATH="${PATH-}" SYSTEMROOT="${SYSTEMROOT-}" WINDIR="${WINDIR-}" PATHEXT="${PATHEXT-}" COMSPEC="${COMSPEC-}" HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/home" XDG_CONFIG_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-config" XDG_CACHE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-cache" XDG_DATA_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data" XDG_STATE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-state" TMPDIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" TMP="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" TEMP="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" GIT_CONFIG_GLOBAL="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/gitconfig" GIT_CONFIG_NOSYSTEM=1 npm_config_cache="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/npm-cache" YARN_CACHE_FOLDER="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/yarn-cache" PIP_CACHE_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/pip-cache" COREPACK_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/corepack" C3_DB_PATH="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/install.sqlite" C3_PROJECTS_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/projects" C3_PORT_FILE="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/intentsmith.port" C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false C3_LOG_LEVEL=warn NODE_ENV=test CI=1 NO_COLOR=1 LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC PYTHONNOUSERSITE=1 INTENTSMITH_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data/intentsmith/python/pdf/bin/python" C3_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data/intentsmith/python/pdf/bin/python" node scripts/nightly-audit.js --profile=offline,database --run-id=deterministic-c1de74e55da73724628a9f203b4dde6205a4b26a --out-dir=.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/deterministic --timeout-minutes=10 --deadline-hours=8 --concurrency=1`.
- Pilot A9: five consecutive structured reports:
  - `pilot-01-c1de74e55da73724628a9f203b4dde6205a4b26a`: PASS/exit 0; report `c9e1d115b5e42d94c7ab44e418916da64b4561c3cb98f17b2896479b220837fe`; replay `env -i PATH="${PATH-}" SYSTEMROOT="${SYSTEMROOT-}" WINDIR="${WINDIR-}" PATHEXT="${PATHEXT-}" COMSPEC="${COMSPEC-}" HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/home" XDG_CONFIG_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-config" XDG_CACHE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-cache" XDG_DATA_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data" XDG_STATE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-state" TMPDIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" TMP="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" TEMP="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" GIT_CONFIG_GLOBAL="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/gitconfig" GIT_CONFIG_NOSYSTEM=1 npm_config_cache="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/npm-cache" YARN_CACHE_FOLDER="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/yarn-cache" PIP_CACHE_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/pip-cache" COREPACK_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/corepack" C3_DB_PATH="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/install.sqlite" C3_PROJECTS_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/projects" C3_PORT_FILE="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/intentsmith.port" C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false C3_LOG_LEVEL=warn NODE_ENV=test CI=1 NO_COLOR=1 LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC PYTHONNOUSERSITE=1 INTENTSMITH_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data/intentsmith/python/pdf/bin/python" C3_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data/intentsmith/python/pdf/bin/python" node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-01-c1de74e55da73724628a9f203b4dde6205a4b26a --out-dir=.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/pilot --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
  - `pilot-02-c1de74e55da73724628a9f203b4dde6205a4b26a`: PASS/exit 0; report `aa8c593617d873117bcfaa45b24980438e6914b8b41d066756419fc8bf7f7685`; replay `env -i PATH="${PATH-}" SYSTEMROOT="${SYSTEMROOT-}" WINDIR="${WINDIR-}" PATHEXT="${PATHEXT-}" COMSPEC="${COMSPEC-}" HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/home" XDG_CONFIG_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-config" XDG_CACHE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-cache" XDG_DATA_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data" XDG_STATE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-state" TMPDIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" TMP="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" TEMP="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" GIT_CONFIG_GLOBAL="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/gitconfig" GIT_CONFIG_NOSYSTEM=1 npm_config_cache="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/npm-cache" YARN_CACHE_FOLDER="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/yarn-cache" PIP_CACHE_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/pip-cache" COREPACK_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/corepack" C3_DB_PATH="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/install.sqlite" C3_PROJECTS_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/projects" C3_PORT_FILE="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/intentsmith.port" C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false C3_LOG_LEVEL=warn NODE_ENV=test CI=1 NO_COLOR=1 LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC PYTHONNOUSERSITE=1 INTENTSMITH_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data/intentsmith/python/pdf/bin/python" C3_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data/intentsmith/python/pdf/bin/python" node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-02-c1de74e55da73724628a9f203b4dde6205a4b26a --out-dir=.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/pilot --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
  - `pilot-03-c1de74e55da73724628a9f203b4dde6205a4b26a`: PASS/exit 0; report `e1ebc79e5c90840e8df49ae6df6dbc5d7a1528ed1be19206335981fa9c6d1419`; replay `env -i PATH="${PATH-}" SYSTEMROOT="${SYSTEMROOT-}" WINDIR="${WINDIR-}" PATHEXT="${PATHEXT-}" COMSPEC="${COMSPEC-}" HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/home" XDG_CONFIG_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-config" XDG_CACHE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-cache" XDG_DATA_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data" XDG_STATE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-state" TMPDIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" TMP="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" TEMP="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" GIT_CONFIG_GLOBAL="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/gitconfig" GIT_CONFIG_NOSYSTEM=1 npm_config_cache="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/npm-cache" YARN_CACHE_FOLDER="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/yarn-cache" PIP_CACHE_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/pip-cache" COREPACK_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/corepack" C3_DB_PATH="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/install.sqlite" C3_PROJECTS_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/projects" C3_PORT_FILE="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/intentsmith.port" C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false C3_LOG_LEVEL=warn NODE_ENV=test CI=1 NO_COLOR=1 LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC PYTHONNOUSERSITE=1 INTENTSMITH_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data/intentsmith/python/pdf/bin/python" C3_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data/intentsmith/python/pdf/bin/python" node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-03-c1de74e55da73724628a9f203b4dde6205a4b26a --out-dir=.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/pilot --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
  - `pilot-04-c1de74e55da73724628a9f203b4dde6205a4b26a`: PASS/exit 0; report `e9f8acf54c2b36735ee92d9c783147dd72a3e087be499c573b8c771201ad3c75`; replay `env -i PATH="${PATH-}" SYSTEMROOT="${SYSTEMROOT-}" WINDIR="${WINDIR-}" PATHEXT="${PATHEXT-}" COMSPEC="${COMSPEC-}" HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/home" XDG_CONFIG_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-config" XDG_CACHE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-cache" XDG_DATA_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data" XDG_STATE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-state" TMPDIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" TMP="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" TEMP="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" GIT_CONFIG_GLOBAL="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/gitconfig" GIT_CONFIG_NOSYSTEM=1 npm_config_cache="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/npm-cache" YARN_CACHE_FOLDER="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/yarn-cache" PIP_CACHE_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/pip-cache" COREPACK_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/corepack" C3_DB_PATH="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/install.sqlite" C3_PROJECTS_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/projects" C3_PORT_FILE="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/intentsmith.port" C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false C3_LOG_LEVEL=warn NODE_ENV=test CI=1 NO_COLOR=1 LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC PYTHONNOUSERSITE=1 INTENTSMITH_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data/intentsmith/python/pdf/bin/python" C3_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data/intentsmith/python/pdf/bin/python" node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-04-c1de74e55da73724628a9f203b4dde6205a4b26a --out-dir=.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/pilot --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
  - `pilot-05-c1de74e55da73724628a9f203b4dde6205a4b26a`: PASS/exit 0; report `889c7d5a6c3b4fd0402d2ed9269f2af513b69acede4c271a84838edd4b898583`; replay `env -i PATH="${PATH-}" SYSTEMROOT="${SYSTEMROOT-}" WINDIR="${WINDIR-}" PATHEXT="${PATHEXT-}" COMSPEC="${COMSPEC-}" HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/home" XDG_CONFIG_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-config" XDG_CACHE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-cache" XDG_DATA_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data" XDG_STATE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-state" TMPDIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" TMP="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" TEMP="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" GIT_CONFIG_GLOBAL="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/gitconfig" GIT_CONFIG_NOSYSTEM=1 npm_config_cache="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/npm-cache" YARN_CACHE_FOLDER="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/yarn-cache" PIP_CACHE_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/pip-cache" COREPACK_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/corepack" C3_DB_PATH="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/install.sqlite" C3_PROJECTS_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/projects" C3_PORT_FILE="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/intentsmith.port" C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false C3_LOG_LEVEL=warn NODE_ENV=test CI=1 NO_COLOR=1 LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC PYTHONNOUSERSITE=1 INTENTSMITH_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data/intentsmith/python/pdf/bin/python" C3_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data/intentsmith/python/pdf/bin/python" node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-05-c1de74e55da73724628a9f203b4dde6205a4b26a --out-dir=.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/pilot --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
- Soak requirement guard: BLOCKED, exit
  2, prerequisites `gpu, ollama`;
  replay `env -i PATH="${PATH-}" SYSTEMROOT="${SYSTEMROOT-}" WINDIR="${WINDIR-}" PATHEXT="${PATHEXT-}" COMSPEC="${COMSPEC-}" HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/home" XDG_CONFIG_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-config" XDG_CACHE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-cache" XDG_DATA_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data" XDG_STATE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-state" TMPDIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" TMP="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" TEMP="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" GIT_CONFIG_GLOBAL="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/gitconfig" GIT_CONFIG_NOSYSTEM=1 npm_config_cache="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/npm-cache" YARN_CACHE_FOLDER="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/yarn-cache" PIP_CACHE_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/pip-cache" COREPACK_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/corepack" C3_DB_PATH="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/install.sqlite" C3_PROJECTS_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/projects" C3_PORT_FILE="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/intentsmith.port" C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false C3_LOG_LEVEL=warn NODE_ENV=test CI=1 NO_COLOR=1 LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC PYTHONNOUSERSITE=1 INTENTSMITH_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data/intentsmith/python/pdf/bin/python" C3_PDF_PYTHON="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data/intentsmith/python/pdf/bin/python" node scripts/nightly-audit.js --suite=IS-T5-TESTS-SOAK-ATTACHMENT-HEAVY-TEST,IS-T5-TESTS-SOAK-BREAK-PATTERN-PROBE-TEST,IS-T5-TESTS-SOAK-FOLLOWUP-LOAD-TEST,IS-T5-TESTS-SOAK-MIXED-SESSION-SIMULATION-TEST,IS-T5-TESTS-SOAK-SHORT-INPUT-STRESS-TEST --run-id=soak-guard-c1de74e55da73724628a9f203b4dde6205a4b26a --out-dir=.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/soak --timeout-minutes=60 --deadline-hours=1 --concurrency=1`.
- Registry and disposition validator exits: 0 and 0.
- Clean install exits: clean=0, repeat=0;
  replay `env -i PATH="${PATH-}" SYSTEMROOT="${SYSTEMROOT-}" WINDIR="${WINDIR-}" PATHEXT="${PATHEXT-}" COMSPEC="${COMSPEC-}" HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/home" XDG_CONFIG_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-config" XDG_CACHE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-cache" XDG_DATA_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-data" XDG_STATE_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/xdg-state" TMPDIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" TMP="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" TEMP="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/tmp" GIT_CONFIG_GLOBAL="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/gitconfig" GIT_CONFIG_NOSYSTEM=1 npm_config_cache="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/npm-cache" YARN_CACHE_FOLDER="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/yarn-cache" PIP_CACHE_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/pip-cache" COREPACK_HOME="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/corepack" C3_DB_PATH="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/install.sqlite" C3_PROJECTS_DIR="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/projects" C3_PORT_FILE="${PWD}/.intentsmith-artifacts/gate0/candidate-c1de74e55da73724628a9f203b4dde6205a4b26a/install-root/runtime/intentsmith.port" C3_LIFECYCLE_AUTO_COMMIT=false C3_ENABLE_AUTONOMY=false C3_LOG_LEVEL=warn NODE_ENV=test CI=1 NO_COLOR=1 LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC PYTHONNOUSERSITE=1 ./scripts/install.sh --minimal`.
- Disposition: 225 rows; terminals
  `DEFERRED(external-network+owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` 1, `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` 30, `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+three-request-gpu-headroom)` 1, `REPAIRED` 60; repaired subjects
  60/
  60, digest
  `ae7445713983927df68bfd33fc8d0d693a8b77f0964b5d3306df5ee547cc1de1`.

## Known risks

- Registry discovery is extension-based and every support/aggregate file is an
  explicit reasoned exclusion.
- Runtime DB access fails closed without an explicit `C3_DB_PATH`, and the
  authoritative runner supplies isolated DB paths (`G0-R012`).
- 0 recovered E2E suites remain
  `KNOWN_DEFECTIVE`; 79 remain registry-`BLOCKED`.
- Privacy history remains reachable and credential rotation is pending.
- Repository-local Gate 0 blockers: none.
- Gate-impact policy: valid; 29
  risk rows and 29 policy entries.

## Questions

1. Did any final repair weaken a mandatory assertion or conceal a failure?
2. Can a suite escape the isolated HOME/temp/DB/artifact boundaries?
3. Is the registry fingerprint/count pin updated everywhere it is enforced?
4. Does the A9 fixture repair reflect the documented low-ceremony case without
   changing production scoring behavior?
5. Are any blocked/model/soak programs still misclassified as deterministic?
6. Is the candidate/attestation split sufficient to make the evidence
   reproducible without a self-referential commit claim?
7. Should the remaining `G0-R012` database import side effect prevent
   operator acceptance of Gate 0 despite runner-level isolation?

Report security gaps, regressions, false-green behavior, missing evidence, or
scope expansion. Do not approve based on narrative alone; follow the hashes and
commands in `GATE0-BASELINE-REPORT.md`.
