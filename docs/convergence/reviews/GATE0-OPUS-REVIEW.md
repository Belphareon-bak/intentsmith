# Gate 0 — Opus 5 Read-only Review Packet

## Review boundary

- Candidate: `22a9b848db1be69f6cd0657d5d0e9bffb44bcb19`
- Registry SHA-256: `f930d637693759df07c290ed415477ba5bf461a0fe4ec71ab207e5663da0bf60`
- Focus range: `126b061..22a9b848db1be69f6cd0657d5d0e9bffb44bcb19`
- Role: read-only reviewer; do not modify the branch

The earlier large E2E reconstruction is represented by the validated 225-row
disposition and registry evidence. This bounded packet focuses on the final
test-trust repairs and verdict machinery.

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

## Diffstat

```text
CLAUDE.md                                    |  39 +-
 README.md                                    |  10 +-
 docs/ARCHITECTURE.md                         |  31 +-
 docs/README.md                               |  38 +-
 docs/ROADMAP.md                              | 845 ++++++--------------------
 docs/archive/ROADMAP-v17-C3.md               | 741 +++++++++++++++++++++++
 docs/convergence/DECISIONS.md                |   9 +
 docs/convergence/FINAL-COMMIT-DISPOSITION.md |  16 +
 docs/convergence/GATE-CRITERIA.md            | 170 ++++++
 docs/convergence/RISK-REGISTER.md            |  19 +-
 docs/convergence/STATUS.md                   |  90 ++-
 docs/convergence/TEST-REGISTRY.md            |  35 +-
 docs/nightly-audit.md                        |  10 +-
 package.json                                 |   1 +
 scripts/generate-gate0-evidence.js           | 854 +++++++++++++++++++++++++++
 scripts/nightly-orchestrator.js              |   4 +-
 scripts/test-registry.js                     |  75 ++-
 tests/e2e-harness-isolation.test.js          |   6 +-
 tests/e2e/_helpers.self-check.js             |   2 +-
 tests/harness-exit-code.test.js              |  84 ++-
 tests/nightly-audit-runner-self-test.js      |   3 +-
 tests/nightly-orchestrator-self-test.js      |  22 +-
 tests/pilot-c1c2c3.test.js                   |  23 +-
 tests/registry.json                          |  96 ++-
 24 files changed, 2456 insertions(+), 767 deletions(-)
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
  `bcea862ee9bc31f526e301248869b98cddf07e2cd6d33e1d2b0cf212a41eac2f`.
- Pilot A9: five consecutive PASS reports:
  - `pilot-01`: report `73e3499e4d3886bd460cfb294fa070eb8f44cf996f89d700828835d1e809e39e`; command `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-01 --out-dir=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/pilot-five --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
  - `pilot-02`: report `e1f186558130b39035516e61fb27fc4a1cb1e36f3e92232de9f9e856c342a38f`; command `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-02 --out-dir=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/pilot-five --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
  - `pilot-03`: report `3ec23c9d51d15f79d27f3e103666f553f418ed6ed2c45fd1c85d28ea944b2f97`; command `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-03 --out-dir=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/pilot-five --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
  - `pilot-04`: report `ea62b725a1edfe082459fb03ae3951b5c8d574a5822514868f6dd0d934834e76`; command `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-04 --out-dir=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/pilot-five --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
  - `pilot-05`: report `ab972352a698439afb9be950c02099574ab5b6b97b645771724c206236c7f5d4`; command `env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --suite=IS-T2-TESTS-PILOT-C1C2C3-TEST --run-id=pilot-05 --out-dir=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/pilot-five --timeout-minutes=5 --deadline-hours=1 --concurrency=1`
- Soak requirement guard: BLOCKED, exit
  2, prerequisites `gpu, ollama`.
- Registry and disposition validators: exit 0.
- Clean install: two consecutive exit-0 runs from the candidate.

## Known risks

- Registry discovery is extension-based and every support/aggregate file is an
  explicit reasoned exclusion.
- Product DB opening remains an import side effect (`G0-R012`), although the
  authoritative runner supplies isolated DB paths.
- 25 recovered E2E suites remain
  `KNOWN_DEFECTIVE`; 54 remain registry-`BLOCKED`.
- Privacy history remains reachable and credential rotation is pending.

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
