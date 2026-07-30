# Gate 0 — Opus 5 Read-only Review Packet

## Review boundary

- Candidate: `82dbc3b30ad0c7329182dbe399705d874b004f2e`
- Registry SHA-256: `f6edc6ccff693284ee01ed159e90faea20e94662892d7b84b2f61efdf35e03b5`
- Focus range: `c4dc987a1a8c4c825e45c91fb437716efa007be1..82dbc3b30ad0c7329182dbe399705d874b004f2e`
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
| G0-C1 clean candidate | PASS | all 199 suite records carry clean source-tree evidence at the candidate SHA |
| G0-C2 disposition | PASS | 225 records; validator exit 0 |
| G0-C3 registry | PASS | 350 runnable programs and 8 explicit support exclusions; validator exit 0 |
| G0-C4 clean install | PASS | two consecutive minimal installs, both exit 0; second idempotent |
| G0-C5 deterministic T1/T2 | PASS | 199 PASS, 0 FAIL/TIMEOUT/BLOCKED/SKIPPED |
| G0-C6 defective suites excluded | PASS | 0 registry rows are KNOWN_DEFECTIVE; none appears in green deterministic evidence |
| G0-C7 blockers specific | PASS | every registry BLOCKED row names server, external-network, Ollama, or GPU |
| G0-C8 generated evidence | PASS | status, index, baseline report, and review packet derive from the clean candidate |
| G0-C9 risk impact policy | PASS | 27 risk rows have validated machine-readable gateImpact entries |

## Commits

- `5fd7c6dde56b27a526ae6fc49716cbf882b17953` fix(chat): preserve immutable self-refinement
- `2bceebfbd2a235cf79640fdcb5f102fb7a471ba4` docs(gate0): record G0-R023 repair evidence
- `cda6995dce73ab752cacdbd996875c9935e59b21` test(chat): bind refinement through controller persistence
- `b05f2e577d22c2f87839559337c2a125adf0d9a2` docs(gate0): record controller refinement mutation proof
- `217df1dc8bbc89c9f5741ef12ce823b13f6789b6` fix: fail closed on provider outages
- `f1c6ce0f4b76921399be6d00a10ceeb01c0f8066` docs: record G0-R025 closure evidence
- `bbec76355eeb43324a6ee7c25c758e3abeaf242e` fix(chat): exclude terminal output from session history
- `d79a8059e018312a917b268b156aeee80d27a3c6` docs(gate0): close G0-R025 history residual
- `968d6d366d5c5d0e8dfd1e3214448907d0f89348` fix(gate0): fail closed on implicit database imports
- `8add10b4515dee6022e8d0b862f365cbbab58005` test(gate0): fail route smoke on factory exceptions
- `660db9c5173081a0b9bc79fa62a37988c7f3ba5a` fix(gate0): fail milestone execution closed
- `38f3ed34144be4440c09fcd1a2792a838a94fceb` docs(gate0): record R019 exact replay
- `c82b67701a64d4d3eb479ecb71ab6a3360f07dab` fix(gate0): derive verdict from risk impact policy
- `2c2fd256526a6ae7a5b9f84e2636f4ba0f9a49b5` docs(gate0): align risk policy with repaired findings
- `0c46c8fccf7fe9db2096ddccf27305bb29759be6` docs(gate0): restore Czech README diacritics
- `ecbacffcd27a5fd63e5e7278a7dc2239286b3ffc` test(gate0): enforce pinned model fixture preflight
- `4dec1d5681feea938bae28a377a33aec53e6b1f5` docs(gate0): record G0-R020 preflight evidence
- `bae8106d0c137437162c05b03d441d7824a888b1` docs(gate0): refresh current test-trust state
- `6027e3b93c50998934b81e24b7a5770ac79d8600` test: isolate direct-run harness runtimes
- `96b8e9439e0d1492678ae404511a391ab7d58afc` test(gate0): isolate fixed-path unit writers
- `8b058076991b67af6eaed7dad7a68a35e40d3b32` docs(gate0): record R014 isolation evidence
- `73c5f78259ed718e7c6c98c675e39a135568efe5` docs(gate0): record first fixed-writer isolation batch
- `1a0b77946de0af7f195040d512c2a350e259a541` fix(gate0): fail npm audit errors closed
- `ed538b8ed0c250ed8d11fd227a799f1358595138` docs(gate0): record G0-R027 mutation evidence
- `d1305da3b34e0dbe44852e1b2fc9c8fcbfc90a00` test(gate0): keep npm audit fixture ESM-safe
- `11e31b1f23b6c609579b6cbe9e1e36ae3c3c20bd` docs(gate0): record R014 and npm fixture interaction
- `6c2360beb720aa9f6b74a84f8c4ca7ac201b409d` test: harden attachment server boundary
- `e78290776cd2b30bd46465adbe9f8abcb0a4ad60` test(gate0): bootstrap direct database suites
- `6a330a8b9b06e7d8acdc1bdf2ac87a4d1f7291cb` test(gate0): isolate custom filesystem writers
- `c1aeb17c67a4f912c5d1e4161c0c1796f9e79f35` test(gate0): prove attachment server ownership
- `c4ced49d9f5a39ffc9ec19b73718314e7bd61e78` docs(gate0): record attachment ownership proof
- `9322c7f6a1213f49e1b4dccbc2d3badd9043cc7b` docs(gate0): record custom writer isolation evidence
- `ab0b9e5601cf8256684304832cedb326f1015ef2` test(gate0): bind attachment server capability
- `dec8cc1fe553df959cd5bde1179b85cd5bc8edb0` docs(gate0): record server capability rerun
- `fab974eda32bcdb62941f91d697600af1bdbedcb` test(gate0): pin attachment capability wiring
- `1aea988fe2ff8e7c5c2de4b9908d1e19ddf84831` docs(gate0): record capability mutation evidence
- `b381f7f530e2a19127e12bcb04f80acd9c89b16f` docs(gate0): close direct-run isolation risk
- `9d93507fb336e4f5867a3b5bbf469a3172858081` docs(gate0): attest direct-run risk closure
- `aff2d475004d0851e09d55af2ee1615e08927962` test(gate0): align E2E helper audit isolation
- `82dbc3b30ad0c7329182dbe399705d874b004f2e` docs(gate0): attest helper audit repair

## Diffstat

```text
CLAUDE.md                                          |   2 +-
 README.md                                          |   2 +-
 docs/API-REFERENCE.md                              |  18 +-
 docs/ARCHITECTURE.md                               |   6 +-
 docs/README.md                                     | 137 ++--
 docs/ROADMAP.md                                    |  51 +-
 docs/WS-PROTOCOL.md                                |  12 +
 docs/convergence/DECISIONS.md                      |   1 +
 docs/convergence/FINAL-COMMIT-DISPOSITION.md       |   2 +-
 docs/convergence/GATE-CRITERIA.md                  |  43 +-
 .../convergence/GATE0-EVIDENCE-GENERATOR-REPAIR.md |   9 +-
 docs/convergence/GATE0-G0-R012-EVIDENCE.md         |  52 ++
 .../GATE0-G0-R014-ATTACHMENTS-EVIDENCE.md          | 334 ++++++++
 .../GATE0-G0-R014-CUSTOM-WRITERS-EVIDENCE.md       | 160 ++++
 .../GATE0-G0-R014-DIRECT-RUN-ISOLATION-EVIDENCE.md | 490 ++++++++++++
 docs/convergence/GATE0-G0-R019-EVIDENCE.md         | 133 ++++
 docs/convergence/GATE0-G0-R020-EVIDENCE.md         | 148 ++++
 docs/convergence/GATE0-G0-R023-EVIDENCE.md         | 124 +++
 docs/convergence/GATE0-G0-R025-EVIDENCE.md         | 243 ++++++
 docs/convergence/GATE0-G0-R026-EVIDENCE.md         |  26 +
 docs/convergence/GATE0-G0-R027-EVIDENCE.md         | 117 +++
 docs/convergence/GATE0-GPU-OBSERVATION.md          |   9 +-
 docs/convergence/GATE0-RISK-IMPACT.json            | 148 ++++
 docs/convergence/RISK-REGISTER.md                  |  20 +-
 docs/convergence/TEST-REGISTRY.md                  |  12 +-
 docs/nightly-audit.md                              |  23 +-
 docs/tools/REGISTRY.md                             |  20 +-
 scripts/gate0-evidence-verdict.js                  | 204 ++++-
 scripts/generate-gate0-evidence.js                 |  55 +-
 scripts/model-fixture-preflight.js                 | 307 ++++++++
 scripts/nightly-audit.js                           |  82 +-
 scripts/nightly-orchestrator.js                    |   3 +-
 scripts/reconcile-ffd-e2e-registry.js              |  33 +
 scripts/test-registry.js                           |  44 +-
 src/chat/controller.js                             | 123 +--
 src/chat/response-finalizer.js                     | 153 ++++
 src/config.js                                      |   4 +-
 src/core/chat-turn-error.js                        |  83 ++
 src/db/database-path.js                            |  10 +
 src/db/database.js                                 |   3 +-
 src/planner/lifecycle-build.js                     |  37 +-
 src/routes/chat.js                                 |  18 +
 src/runtime-environment.js                         |  17 +
 src/server-port-file.js                            |  19 +
 src/server.js                                      |  25 +-
 src/tools/npm-audit.js                             | 276 +++++++
 src/tools/registry.js                              |  78 +-
 src/ws-bridge/session-adapter.js                   |  19 +-
 tests/adversarial-cre.test.js                      |   2 +
 tests/agent-wizard.test.js                         |   2 +
 tests/architecture-policy.test.js                  |   9 +-
 tests/archive-lifecycle.test.js                    |   1 +
 tests/artifact-validation.test.js                  | 307 +++++++-
 tests/attachments-projects.test.js                 | 608 +++++++++++++--
 tests/build-handoff.test.js                        |   2 +
 tests/build-patterns.test.js                       |   2 +
 tests/build-routing-project-mode.test.js           |   2 +
 tests/chat-export-budget.test.js                   |  52 +-
 tests/chat-pipeline.test.js                        |   2 +
 tests/chat-search-quality.test.js                  |   2 +
 tests/chat-synthesis-hardening.test.js             |   2 +
 tests/conv-czech-nodiacritics.test.js              |   2 +
 tests/conv-czech.test.js                           |   2 +
 tests/conv-english.test.js                         |   2 +
 tests/cre-comprehensive.test.js                    |   2 +
 tests/cre-dialog-scenarios.test.js                 |   2 +
 tests/cre-followup-diagnostic.test.js              |   2 +
 tests/cre-gatekeeper.test.js                       |   2 +
 tests/cre-guard-interactions.test.js               |   2 +
 tests/cre-report-sticky-break.test.js              |   1 +
 tests/design-sprint34.test.js                      |   2 +
 tests/design-tests.test.js                         |   2 +
 tests/e2e-harness-isolation.test.js                |  87 ++-
 tests/e2e-harness.js                               |  16 +-
 tests/e2e-resilience.test.js                       |   2 +
 tests/e2e/220-e2e-suite-runner.js                  |  13 +
 tests/e2e/60-ws-chat.e2e.js                        | 125 +++
 tests/e2e/_helpers.self-check.js                   |  25 +-
 tests/execution-loop.test.js                       |   5 +-
 tests/executor-capabilities.test.js                |   2 +
 tests/expertise-ab-quality.test.js                 |   2 +
 tests/expertise-comparison-e2e-b.test.js           |   2 +
 tests/expertise-comparison-e2e-c.test.js           |   2 +
 tests/expertise-comparison-e2e-d.test.js           |   2 +
 tests/expertise-comparison-e2e-e.test.js           |   2 +
 tests/expertise-comparison-e2e.test.js             |   2 +
 tests/expertise-routing-correctness.test.js        |   2 +
 tests/export-pdf-docx.test.js                      |  15 +-
 tests/fixes-v582.test.js                           |   2 +
 tests/harness-exit-code.test.js                    | 851 ++++++++++++++++++++-
 tests/harness.js                                   |   2 +
 tests/helpers/isolated-test-db.js                  | 383 +++++++++-
 tests/lifecycle-analysis-e2e.test.js               |   2 +
 tests/lifecycle-android-app-e2e.test.js            |   2 +
 tests/lifecycle-build.test.js                      |  54 ++
 tests/lifecycle-cookbook-e2e.test.js               |   2 +
 tests/lifecycle-db.test.js                         |   2 +
 tests/lifecycle-e2e.test.js                        |  20 +-
 tests/lifecycle-handoff.test.js                    |   2 +
 tests/lifecycle-human-friction.test.js             |  86 ++-
 tests/lifecycle-imagegen-e2e.test.js               |   2 +
 tests/lifecycle-klicenka-e2e.test.js               |   2 +
 tests/lifecycle-review-change.test.js              |   2 +
 tests/lifecycle.test.js                            |   2 +
 tests/marketplace.test.js                          |  25 +-
 tests/nightly-audit-runner-self-test.js            | 421 +++++++++-
 tests/pilot-c1c2c3.test.js                         |   2 +
 tests/project-kb-decomposer.test.js                |  22 +-
 tests/quality-gates.test.js                        |   2 +
 tests/quality-score.test.js                        |   2 +
 tests/registry.json                                |  54 +-
 tests/routes-smoke.test.js                         |  60 +-
 tests/routing-accuracy.test.js                     |   2 +
 tests/session-context.test.js                      |   2 +
 tests/signature-cache.test.js                      |   6 +-
 tests/skill-meta-detection.test.js                 |   2 +
 tests/skill-routing-cre.test.js                    |   2 +
 tests/smoke.test.js                                |   2 +
 tests/specialist-loader.test.js                    |   1 +
 tests/telemetry-aggregation-version.test.js        |   1 +
 tests/telemetry-soak.test.js                       |   2 +
 tests/tool-registry-e2e.test.js                    | 262 ++++++-
 tests/upgrade-ux-v125.test.js                      |  58 +-
 tests/v583-tier1.test.js                           |   2 +
 tests/ws-bridge.test.js                            | 464 +++++++++++
 125 files changed, 7508 insertions(+), 555 deletions(-)
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

- Deterministic registry: 199 PASS, exit 0, report SHA
  `0b7a943c2b1f2a050d6ef0be547448fe71d23f2e695fefa429078a1e1898104e`.
- Pilot A9: five consecutive PASS reports:
  - `pilot-82dbc3-01`: report `19cad01a0d3368a19be5c973d7825befbd631e964700529edb109d473858bd9f`; command `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-82dbc3-01 --out-dir=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/pilot-five --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
  - `pilot-82dbc3-02`: report `1cb1f08a731adbfce2d964c5cfda56aa3ba1de103c2e94d5616871005f1a6214`; command `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-82dbc3-02 --out-dir=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/pilot-five --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
  - `pilot-82dbc3-03`: report `8c978d7bad56eb98e606cd46b66a98556562dc037ae341afbcbcf89e6cb2e4d1`; command `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-82dbc3-03 --out-dir=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/pilot-five --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
  - `pilot-82dbc3-04`: report `742fddd5d472344fe86fd7658f948cbc9f678ce587cc4ece4ce15de46584ae23`; command `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-82dbc3-04 --out-dir=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/pilot-five --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
  - `pilot-82dbc3-05`: report `c951f14a6525d2b8d20b1597583882d8e26587096bc8550415ff7113190b7bb6`; command `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-82dbc3-05 --out-dir=/home/belphareon/Projects/intentsmith-gate0-candidate-3WIQMa/repository/.intentsmith-artifacts/gate0/candidate-82dbc3b/pilot-five --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
- Soak requirement guard: BLOCKED, exit
  2, prerequisites `gpu, ollama`.
- Registry and disposition validator exits: 0 and 0.
- Clean install: two consecutive exit-0 runs from the candidate.

## Known risks

- Registry discovery is extension-based and every support/aggregate file is an
  explicit reasoned exclusion.
- Product DB opening remains an import side effect (`G0-R012`), although the
  authoritative runner supplies isolated DB paths.
- 0 recovered E2E suites remain
  `KNOWN_DEFECTIVE`; 79 remain registry-`BLOCKED`.
- Privacy history remains reachable and credential rotation is pending.
- Repository-local Gate 0 blockers: none.
- Gate-impact policy: valid; 27
  risk rows and 27 policy entries.

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
