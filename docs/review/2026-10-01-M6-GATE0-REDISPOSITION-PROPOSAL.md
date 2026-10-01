# M6 Gate 0 re-disposition proposal, candidate `77672c2c`

**Status: DRAFT / SEMANTIC_REVIEW_REQUIRED / RELEASE BLOCKED.** This packet
records observed drift after the historical Gate 0 seal. It is not an operator
decision, a repaired Gate 0 attestation, an independent review, or a signature.
The current M6 source must be frozen and remeasured before release evidence is
generated. The exact machine-readable snapshot is
[`2026-10-01-m6-gate0-redisposition-proposal-v1.json`](evidence/2026-10-01-m6-gate0-redisposition-proposal-v1.json).

## Authority and reproduction

- User request: prepare the remaining IntentSmith completion work by milestones.
- Existing authority: `CONTRACT.md` §§5, 8, 10; `ROADMAP.md` M6; Decision 036
  requires exact candidate, technical evidence, independent operator review and
  operator demo. Decision 030 authorizes consolidation of obsolete v123 model
  evaluation paths, but does not prove that a removed test had equivalent
  coverage.
- The C3 source diff manifest is the same 225-record, SHA-256
  `aa95bbc0918daa3f188283297e03562e3a4b8a8d0b178bec126b60a27cd8677e`
  manifest. The historical repaired-subject sidecar is the same 60-record,
  SHA-256 `1dd6edffedfa902e7396fe20151002a15ddd8fbc3b64670103d3da5792300ed5`
  sidecar. Neither file was rehashed or edited.
- On clean, pushed `77672c2ce1bb503483f72ab559b17e1a2b46c714`, the
  release-only `node scripts/validate-final-disposition.js --json` exits 1
  with **31 errors**. Four records point to absent paths; 25 repaired-subject
  records have a stale blob, of which one is also absent. The one changed
  legacy-package path and one mode error belong to those same records. Thus
  **28 unique source records** need re-disposition or semantic delta review.
- `node scripts/validate-m6-gate0-redisposition-proposal.js --json` checks the
  28-row snapshot against tracked Git objects and the exact 31 legacy errors.
  A consistent packet still reports `gate0Status=BLOCKED`.

## Proposed lineage and disposition

The following table maps every affected historical source sequence. The listed
commit is a Git lineage pointer, not a semantic acceptance receipt. Blob and
mode identities for both the sealed subject and candidate are in the JSON.
All 28 records remain `SEMANTIC_REVIEW_REQUIRED`.

| Source # | Historical candidate subject | Observed candidate subject | Proposed disposition | Lineage commit | Delta class |
|---:|---|---|---|---|---|
| 2 | `CLAUDE.md` | `CLAUDE.md` | REBUILD/REPAIRED | `1e579527` | Product guidance changed |
| 3 | `README.md` | `README.md` | REBUILD/REPAIRED | `77672c2c` | Product status changed |
| 86 | `package-lock.json` | `package-lock.json` | REBUILD/REPAIRED | `d050cb6e` | Dependency lock changed |
| 87 | `package.json` | `package.json` | REBUILD/REPAIRED | `6177a066` | Dependency and script contract changed |
| 91 | `src/config.js` | `src/config.js` | REBUILD/REPAIRED | `25b7d21d` | Runtime configuration changed |
| 97 | `src/planner/execution-loop.js` | `src/executor/execution-loop.js` | KEEP/REPLAY | `d7a5b2a9` | 100% rename, followed by code changes |
| 101 | `src/server.js` | `src/server.js` | REBUILD/REPAIRED | `d4be0ac1` | Runtime server changed |
| 107 | `tests/registry.json` | `tests/registry.json` | REBUILD/REPAIRED | `008bb6b7` | Registry membership changed |
| 108 | `docs/convergence/TEST-REGISTRY.md` | `docs/convergence/TEST-REGISTRY.md` | REBUILD/REPAIRED | `008bb6b7` | Registry projection changed |
| 116 | `tests/_legacy/p5-scoring-simulation.js` | absent | EXCLUDE/REMOVE_FOLLOWUP | `13d3fee1` | Old v123 scoring test retired |
| 117 | `tests/_legacy/packages/c3-backend.md` | `tests/_legacy/packages/intentsmith-backend.md` | REBUILD/REPAIRED | `5e53255b` | Legacy package reference renamed |
| 127 | `tests/artifact-validation.test.js` | `tests/artifact-validation.test.js` | REBUILD/REPAIRED | `50e21e0f` | Gate test assertions changed |
| 129 | `tests/e2e/01-health-smoke.e2e.js` | same path | REBUILD/REPAIRED | `d050cb6e` | E2E contract changed |
| 131 | `tests/e2e/03-conversations.e2e.js` | same path | REBUILD/REPAIRED | `582ddd6b` | E2E contract changed |
| 136 | `tests/e2e/08-agents.e2e.js` | same path | REBUILD/REPAIRED | `7708519e` | E2E contract changed |
| 141 | `tests/e2e/13-security.e2e.js` | same path | REBUILD/REPAIRED | `5e53255b` | E2E contract changed |
| 142 | `tests/e2e/14-system.e2e.js` | same path | REBUILD/REPAIRED | `13d3fee1` | E2E contract changed |
| 143 | `tests/e2e/15-quality.e2e.js` | same path | REBUILD/REPAIRED | `5e53255b` | E2E contract changed |
| 149 | `tests/e2e/200-s1-minic3-p1.e2e.js` | same path | REBUILD/REPAIRED | `5e53255b` | E2E contract changed |
| 159 | `tests/e2e/21-model-upgrade.e2e.js` | same path | REBUILD/REPAIRED | `13d3fee1` | E2E contract changed |
| 163 | `tests/e2e/220-e2e-suite-runner.js` | same path | REBUILD/REPAIRED | `5e53255b` | E2E runner changed |
| 173 | `tests/e2e/56-chat-with-project.e2e.js` | same path | REBUILD/REPAIRED | `0eb4c285` | E2E contract changed |
| 177 | `tests/e2e/60-ws-chat.e2e.js` | same path | REBUILD/REPAIRED | `d050cb6e` | E2E contract changed |
| 179 | `tests/e2e/62-validation-suites.e2e.js` | absent | EXCLUDE/REMOVE_FOLLOWUP | `13d3fee1` | Old v123 validation E2E retired |
| 180 | `tests/e2e/63-agent-execution.e2e.js` | same path | REBUILD/REPAIRED | `7708519e` | E2E contract changed |
| 191 | `tests/e2e/80-ws-semantic-events.e2e.js` | same path | REBUILD/REPAIRED | `d050cb6e` | E2E contract changed |
| 210 | `tests/e2e/_helpers.js` | same path | REBUILD/REPAIRED | `5e53255b` | E2E helper changed |
| 222 | `tests/proposal-stale-cleanup.test.js` | absent | EXCLUDE/REMOVE_FOLLOWUP | `13d3fee1` | Old ProposalStore cleanup test retired |

`d7a5b2a9` is an exact 100% rename at that commit, but later executor edits
mean current blob identity differs. `13d3fee1` removed the three old model
tests during Decision 030 consolidation. It added the read-only
`tests/e2e/62-model-evaluations.e2e.js` and new model-evaluation tests. Those
are **related contracts**, not a proven one-to-one substitute: the old E2E
exercised validation start/progress/result, while the new E2E checks the current
read-only authority and removed endpoints. The proposed three retirements need
an explicit semantic parity or intentional-scope decision.

If the three retirements are accepted, the proposed 225-row totals become
`EXCLUDE 94`, `KEEP 40`, `REBUILD 91` (`REPAIRED 59`, `DEFERRED 32`). The
historical totals remain `91/42/92` with 60 repaired subjects. The table is a
candidate re-disposition, not a mutation of the historical ledger.

## Remaining release work

1. Independently review all 24 changed surviving subjects for weakened or
   changed assertions, especially the 14 E2E contracts, gate test, registry
   membership, runtime configuration and server. Review the 100% rename and
   subsequent execution-loop changes as one lineage.
2. Decide explicitly whether the three retired tests' old behavior is obsolete
   under Decision 030, or whether current-contract negative and live coverage
   must be added. Preserve a distinct `CHANGES_REQUIRED` state if parity is
   missing.
3. After product source freeze, issue a new M6 disposition authority and
   candidate-bound subject manifest/versioned validator. Review any new drift;
   do not reuse this `77672c2c` snapshot for later source without validation.
4. Run the complete M6 Gate 0 technical matrix from the frozen candidate.
   Decision 036 still requires independent operator `REVIEW_PASSED`, operator
   demo/approval and the signed custody path of Decision 041. No receipt or
   actor assertion is generated by this packet.
