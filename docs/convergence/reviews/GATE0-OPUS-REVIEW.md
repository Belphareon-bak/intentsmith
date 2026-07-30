# Gate 0 — Opus 5 Read-only Review Packet

## Review boundary

- Candidate: `7372ad9f70c8a662c71122c2ba0ba5c6f6f90eb5`
- Registry SHA-256: `a7a5c6d4670159cd38a08edea8aabbf868eb3342a3baf1857b6a4849d1f4960a`
- Focus range: `126b061..7372ad9f70c8a662c71122c2ba0ba5c6f6f90eb5`
- Role: read-only reviewer; do not modify the branch

The earlier large E2E reconstruction is represented by the current
225-row
disposition report (clause
PASS) and registry
evidence. This bounded packet focuses on the final test-trust repairs and
verdict machinery.

- Derived verdict: **FAIL**
- Independent review status: **PENDING**
- Repository-local blockers: G0-R023: OPEN, G0-R025: OPEN

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

## Commits

- `f38f5e8850ac6dde428659a3444332f5f2e280fc` test: restore pilot score discrimination
- `6fc2e55973fd747aa3ea5e27cf8a35e5e94b95ce` test: align deterministic release evidence
- `f85a53aba8643b21ef91199cbe999c48aa5228e4` test: classify model-backed soak requirements
- `c09812a40dfb4b1dba035c3eaebe5aca0aa71881` docs: normativní kritéria Gate 0 a evidenční pravidla
- `e5000b4b8a8ecdaa8eb9a64191861afeda8cabc2` docs: IntentSmith Roadmapa 1.0 nahrazuje C3 roadmapu v17
- `b860ae96d8f333acfa61724ba8065740059995d6` docs: srovnat zděděná C3 tvrzení se skutečným stavem
- `d417dade6f549c75fa7e4f9add8aac15178cdeda` test: close registry filename discovery gap
- `7bec33cb8e74dc9752f82b8cad0da157fb3bd527` test: reject symlink registry bypasses
- `2e81df00dd39ac83846e282f95e1d74bf47d5ed1` chore: generate reproducible Gate 0 evidence
- `af539dccbb420ac32aed5e095eb6d69bc4ffcc37` docs: align Gate 0 criteria with complete registry
- `793497bb512b1f19eb0784afb4a968b4446a1a3f` chore: bind Gate 0 evidence to exact commands
- `6c9da5ed9d8ffb6a46879bcdafa532f32edb502b` test: update audit runner registry fixture
- `22a9b848db1be69f6cd0657d5d0e9bffb44bcb19` test: wait for complete interrupt fixture JSON
- `bf70c790231d7640f78c4b391551e3e91d7f40f3` docs: attest Gate 0 candidate 22a9b84
- `934dd560041488edebb02f746c83944c13fd6c58` docs: close verified Gate 0 ledgers
- `be84c53ba8441afd4e22ccc2b2d193950ac5fd17` docs: record Gate 0 GPU timeout findings
- `54913a1e797b97ef151c4483d0b09e9040135ed0` docs: uzavřít false-green díry v kritériích Gate 0
- `48f0f97faf68eee4e244ec9d904580c05c1e5713` docs: G0-R018 — neautentizované RCE při bindu mimo loopback
- `1767b3b4b96d1a8aa7ef6a0ef9d1b691eb5e474c` docs: isolate generic remote security track
- `357cd28b93a06f91212341df533aec2070a23ed7` docs: tighten remote execution evidence
- `71579622e42f0502fae4ba774a8afd30a9ec2276` test: make final disposition offline reproducible
- `7ad7145360d927d164eb85d2e732cdfa20c6fd81` test: fail closed in shared E2E helpers
- `d54425a50ee776d4d1db288777d8c8f152083935` docs: close first D-018 support repairs
- `343c19f9354c87a0154baf695f9351221c7722c8` test: bind persistent E2E state to source revision
- `452b1f7688e7624d30b81daabcb0be3b18a64cd0` test: persist phase completion only after assertions
- `30fae93dd9592f22125933a16e2e69e139bc926a` docs: close multi-phase D-018 repairs
- `c0471924d7a445c4be0d9256c06154bd970f53f8` test: make positive chat helpers fail closed
- `b188e54bc339557b316676cc27619457710bb0bf` docs: defer truthful model suites by prerequisites
- `7d3426ca84906bbc7434e0af02e21b6802541957` docs: close non-E2E D-018 repairs
- `06d49847988ae3fb65711fe6bf737c08c0e3ac0c` test: repair core HTTP E2E contracts
- `d9631e979fcd035def9e0fab9d9dbfcf1638a917` docs: close first server E2E repairs
- `ce79b1217a6f9c4ba26e0cd6855a95307d589470` test: repair server E2E 04 and 06-09
- `15cb9917bddec6e3d823ffad96e134d03555d9d4` test: keep repaired E2E registry reproducible
- `5bcedd855c56cd543f6f752a6385be9c64c20f6a` test: repair server E2E 10-13
- `ed0b1f6ed972cd953b5caf0b28c863268bee2835` test: repair server E2E 14-17
- `e8ddb7cade47f1c895fda1b14137081d452b9d2a` test: repair server E2E 18-20
- `657ffc51634066ee3e0637eec5f61deb43ab4c7b` test: repair server E2E 21-25
- `601a195ecbced3242cd42603615d143f59d2766e` test: repair model E2E 57-59
- `286a9117c77c6c29969ed374bcaea86c1ef1ba1a` fix: bind chat to stored project context
- `fbb615741c6f42a4fb51c31d90c3222544fac75f` test: repair semantic E2E 75-78
- `693e8defe3bc0da19c5ee0178b99bdbdfaee64dc` test: repair long model E2E quality
- `ab14c0ec7b891a8cbbdcccf1ab7bf018214a4293` test: repair semantic E2E 50-56
- `b77f6384186c0f498d08dae7b2bf90c203c234af` docs: bind E2E 50-56 evidence to candidate
- `8e6cd4147dd154d28212a5c8e9be271d4b8b367c` fix: write private server port files
- `d78dffdb3b85e5443fcd49235b515bfafd2dc385` test: repair specialist runtime false green
- `3924999efa34c5c40cd4d55cb9edbfbe4543692c` test: repair E2E 60-63 contracts
- `efc3bcf81ad24fab33de6ffcd97039dd80faf8fd` docs: bind E2E 60-63 evidence to candidate
- `aa2062bd96680a2aff67de7eb5325b29cde51d07` fix: make cancellation boundaries truthful
- `847586295699d9026b9f79b56e51ced5ffd14753` docs: bind cancellation review evidence
- `64a49d419e80d8a49cda5018a663b3baa9d13290` test: repair E2E 79 semantic oracles
- `30bed56f2644b5e9f6c1c570fda70f7808b55bfa` docs: bind E2E 79 evidence to candidate
- `fab2c5179c04e26d3908933ac6cbf0e68871b931` test: repair E2E 81 lifecycle contract
- `14d22f993ecff9be286e1e771260d2a7f1b6741d` docs: bind E2E 81 evidence to candidate
- `32629f6283be5188655697a777a0b74c4d3e39d0` test: repair E2E 80 WebSocket semantics
- `dcf7753ccc604fbec2fa1b87cc8235f8c4726a4b` fix: preserve typed timeout provenance
- `444781d2e15b4e340a63dbf008861571ecdac9d1` docs: record typed timeout mutation evidence
- `265b87729628c7d21d9fea5ccef1c282ebd94170` docs: bind E2E 80 evidence to candidate
- `f84107f27b1c106cf45034f7a1108dc4e3087dfb` fix: derive Gate 0 evidence verdicts
- `7372ad9f70c8a662c71122c2ba0ba5c6f6f90eb5` test: harden Gate 0 evidence protocols

## Diffstat

```text
CLAUDE.md                                          |   39 +-
 README.md                                          |   10 +-
 docs/ARCHITECTURE.md                               |   31 +-
 docs/README.md                                     |   38 +-
 docs/ROADMAP.md                                    |  856 ++-----
 docs/archive/ROADMAP-v17-C3.md                     |  741 ++++++
 docs/convergence/DECISIONS.md                      |   10 +
 docs/convergence/EVIDENCE-INDEX.json               |  180 +-
 docs/convergence/FINAL-COMMIT-DIFF-MANIFEST.json   | 2501 ++++++++++++++++++++
 docs/convergence/FINAL-COMMIT-DISPOSITION.md       |  252 +-
 docs/convergence/GATE-CRITERIA.md                  |  192 ++
 docs/convergence/GATE0-BASELINE-REPORT.md          |  147 ++
 docs/convergence/GATE0-E2E-50-56-EVIDENCE.md       |   83 +
 docs/convergence/GATE0-E2E-60-63-EVIDENCE.md       |  237 ++
 docs/convergence/GATE0-E2E-79-EVIDENCE.md          |   60 +
 docs/convergence/GATE0-E2E-80-EVIDENCE.md          |   89 +
 docs/convergence/GATE0-E2E-81-EVIDENCE.md          |   73 +
 .../convergence/GATE0-EVIDENCE-GENERATOR-REPAIR.md |   75 +
 docs/convergence/GATE0-GPU-OBSERVATION.md          |   55 +
 docs/convergence/RISK-REGISTER.md                  |   26 +-
 docs/convergence/STATUS.md                         |   72 +-
 docs/convergence/TEST-REGISTRY.md                  |  113 +-
 docs/convergence/reviews/GATE0-OPUS-REVIEW.md      |  111 +
 docs/nightly-audit.md                              |   35 +-
 package.json                                       |    1 +
 scripts/final-disposition-manifest.js              |  449 ++++
 scripts/gate0-evidence-verdict.js                  |  343 +++
 scripts/generate-final-disposition-manifest.js     |   55 +
 scripts/generate-gate0-evidence.js                 | 1015 ++++++++
 scripts/nightly-audit.js                           |    4 +
 scripts/nightly-orchestrator.js                    |    4 +-
 scripts/reconcile-ffd-e2e-registry.js              |   32 +-
 scripts/test-registry.js                           |   78 +-
 scripts/validate-final-disposition.js              |  465 ++--
 scripts/validate-test-registry.js                  |   48 +-
 src/agents/repository.js                           |   16 +
 src/chat/controller.js                             |   24 +-
 src/chat/cre-decision.js                           |    5 +
 src/core/abort-error.js                            |   77 +
 src/llm/gateway.js                                 |   68 +-
 src/routes/agents.js                               |    4 +-
 src/routes/autonomy.js                             |    6 +-
 src/routes/chat.js                                 |   82 +-
 src/routes/projects.js                             |    5 +-
 src/routes/specialists.js                          |    4 +-
 src/routes/system.js                               |    9 +-
 src/server-port-file.js                            |   51 +
 src/server.js                                      |   13 +-
 src/upgrade/proposal-store.js                      |    5 +-
 src/ws-bridge/session-adapter.js                   |   88 +-
 tests/agent-runner.test.js                         |   35 +
 tests/artifact-validation.test.js                  |  489 +++-
 tests/e2e-harness-isolation.test.js                |    6 +-
 tests/e2e/01-health-smoke.e2e.js                   |   28 +-
 tests/e2e/02-chat-api.e2e.js                       |    8 +-
 tests/e2e/03-conversations.e2e.js                  |   25 +-
 tests/e2e/04-projects.e2e.js                       |   79 +-
 tests/e2e/05-attachments.e2e.js                    |   23 +-
 tests/e2e/06-expertises.e2e.js                     |   31 +-
 tests/e2e/07-specialists.e2e.js                    |  201 +-
 tests/e2e/08-agents.e2e.js                         |   78 +-
 tests/e2e/09-skills.e2e.js                         |   16 +-
 tests/e2e/10-marketplace.e2e.js                    |   32 +-
 tests/e2e/11-memory.e2e.js                         |   13 +-
 tests/e2e/12-notifications.e2e.js                  |   53 +-
 tests/e2e/13-security.e2e.js                       |    9 +-
 tests/e2e/14-system.e2e.js                         |   67 +-
 tests/e2e/15-quality.e2e.js                        |   30 +-
 tests/e2e/16-setup-wizard.e2e.js                   |   51 +-
 tests/e2e/17-export.e2e.js                         |   83 +-
 tests/e2e/18-websocket.e2e.js                      |  160 +-
 tests/e2e/19-rate-limit.e2e.js                     |   38 +-
 tests/e2e/20-security-hardening.e2e.js             |  102 +-
 tests/e2e/200-s1-minic3-p1.e2e.js                  |    8 +-
 tests/e2e/201-s1-minic3-p2.e2e.js                  |    6 +-
 tests/e2e/202-s1-minic3-p3.e2e.js                  |    5 +-
 tests/e2e/203-s1-minic3-p4.e2e.js                  |    6 +-
 tests/e2e/204-s1-minic3-p5.e2e.js                  |    6 +-
 tests/e2e/205-s1-minic3-p6.e2e.js                  |   13 +-
 tests/e2e/206-s2-shopflow-p1.e2e.js                |    7 +-
 tests/e2e/207-s2-shopflow-p2.e2e.js                |    2 +-
 tests/e2e/208-s2-shopflow-p3.e2e.js                |    2 +-
 tests/e2e/209-s2-shopflow-p4.e2e.js                |    2 +-
 tests/e2e/21-model-upgrade.e2e.js                  |   71 +-
 tests/e2e/210-s2-shopflow-p5.e2e.js                |    2 +-
 tests/e2e/211-s2-shopflow-p6.e2e.js                |   13 +-
 tests/e2e/22-autonomy.e2e.js                       |   27 +-
 tests/e2e/220-e2e-suite-runner.js                  |   90 +-
 tests/e2e/23-feedback.e2e.js                       |   56 +-
 tests/e2e/24-drafts.e2e.js                         |   38 +-
 tests/e2e/25-features.e2e.js                       |   54 +-
 tests/e2e/50-chat-conversation.e2e.js              |  158 +-
 tests/e2e/51-cre-classification.e2e.js             |  201 +-
 tests/e2e/52-chat-quality-gate.e2e.js              |  206 +-
 tests/e2e/53-long-conversation.e2e.js              |  143 +-
 tests/e2e/54-chat-with-expertise.e2e.js            |  135 +-
 tests/e2e/55-chat-with-specialist.e2e.js           |  120 +-
 tests/e2e/56-chat-with-project.e2e.js              |  133 +-
 tests/e2e/57-lifecycle-full.e2e.js                 |   60 +-
 tests/e2e/58-code-generation.e2e.js                |   97 +-
 tests/e2e/59-cross-feature.e2e.js                  |   94 +-
 tests/e2e/60-ws-chat.e2e.js                        |  222 +-
 tests/e2e/61-autocomplete.e2e.js                   |   34 +-
 tests/e2e/62-validation-suites.e2e.js              |  153 +-
 tests/e2e/63-agent-execution.e2e.js                |   85 +-
 tests/e2e/70-cre-intent-semantic.e2e.js            |    2 +-
 tests/e2e/75-expertise-behavioral.e2e.js           |  188 +-
 tests/e2e/76-specialist-domain.e2e.js              |  123 +-
 tests/e2e/77-project-context-injection.e2e.js      |  121 +-
 tests/e2e/78-guard-rules.e2e.js                    |  165 +-
 tests/e2e/79-response-semantics.e2e.js             |  296 ++-
 tests/e2e/80-ws-semantic-events.e2e.js             |  657 +++--
 tests/e2e/81-conversation-lifecycle.e2e.js         |  315 ++-
 tests/e2e/86-code-semantic-quality.e2e.js          |  186 +-
 tests/e2e/88-concurrent-load.e2e.js                |   57 +-
 tests/e2e/90-large-project-generation.e2e.js       |  382 +--
 tests/e2e/91-multi-turn-project-build.e2e.js       |  122 +-
 tests/e2e/94-long-conversation-quality.e2e.js      |  152 +-
 tests/e2e/_e2e-state.js                            |   60 +-
 tests/e2e/_helpers.js                              |   42 +-
 tests/e2e/_helpers.self-check.js                   |  251 +-
 tests/e2e/_quality-evaluator.js                    |    9 +-
 tests/harness-exit-code.test.js                    |  155 +-
 tests/llm-gateway-runtime-signal.test.js           |  169 ++
 tests/model-upgrade-phase2.test.js                 |    3 +-
 tests/nightly-audit-runner-self-test.js            |    6 +-
 tests/nightly-orchestrator-self-test.js            |   22 +-
 tests/pilot-c1c2c3.test.js                         |   23 +-
 tests/registry.json                                |  326 ++-
 tests/routes-smoke.test.js                         |  246 ++
 tests/specialist-runtime.test.js                   |   11 +-
 tests/upgrade-ux-v125.test.js                      |   50 +-
 tests/ws-bridge.test.js                            |  278 ++-
 133 files changed, 13769 insertions(+), 3531 deletions(-)
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
  `e921d934b005b0e7a0bd279f97b12de6e1c874502052a44348e8972996c2a151`.
- Pilot A9: five consecutive PASS reports:
  - `pilot-7372-01`: report `fde83caa370d3c599e0023caa0dad3b45f9c0cf5105280ef53d633cb71b4526d`; command `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-7372-01 --out-dir=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/pilot-five --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
  - `pilot-7372-02`: report `514611ff3d5fb5bb8f9ccd8183f27dfe80b4d6ee6b6c04d5c424089fc539b439`; command `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-7372-02 --out-dir=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/pilot-five --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
  - `pilot-7372-03`: report `079d1f3e6e0ff1f085d61705e386b15a486af09b2814ecc712d7495ab3a18500`; command `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-7372-03 --out-dir=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/pilot-five --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
  - `pilot-7372-04`: report `86007c4fc78af10216d7317a3a7e333a4fd9a3aa26d08a7a142bd417e4bb3006`; command `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-7372-04 --out-dir=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/pilot-five --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
  - `pilot-7372-05`: report `c8e3c00f2b1c93268bb5bf5ebff66729f8b437715b3d36c75d036e5fa000db0b`; command `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-7372-05 --out-dir=/home/belphareon/Projects/intentsmith-gate0-candidate-7372ad9/.intentsmith-artifacts/gate0/candidate-7372ad9/pilot-five --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
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
- Repository-local Gate 0 blockers: G0-R023: OPEN, G0-R025: OPEN.

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
