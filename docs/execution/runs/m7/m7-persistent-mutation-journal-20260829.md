# M7 persistent mutation journal — 2026-08-29

**State:** `IMPLEMENTATION_GREEN / FULL_GATE_GREEN / REVIEW_PENDING /
NOT_ACTIVE`

## Binding

- base provider evidence HEAD: `abc2968d0248e56e2ffa2117a8f5878a2679df66`;
- exact product candidate: `ea97c410f061cf2022777a295a986b26ef773464`;
- candidate tree: `23b422f435762d03fdadff1d8b1e0450e85869cf`;
- implementation commit: `9f6407c21c475505f67685debf5baeef9de40379`;
- module-baseline commit: `2a67f2d3`;
- branch: `codex/m7-mobile-contract-integration-20260829`, without upstream;
- registry: 487 runnable, 393 ACTIVE / 79 BLOCKED / 15 HISTORICAL;
- registry fingerprint:
  `278c7b9ad957d61fca748452bcc60efbcbfa39d81eab61a5122feb1d684fbab5`.

## Implemented boundary

Migration 101 adds one append-only event table. Identity is the trusted
`deviceId + subjectId + operationId`; operation type and canonical request
digest must remain exact. Sequence 0 is committed before `execute()`. Sequence
1 contains the first provider-validated terminal result or a typed `UNKNOWN`.
The request payload is never stored. Canonical result bytes are BLOB-backed and
reparsed on every read; repository construction re-registers the deterministic
SQLite validator after restart.

The provider now passes trusted device and subject identity to the journal and
validates a mutation result before persistence. A replay is validated again at
the provider boundary. Exact restart replay returns the stored result with
`replayed: true`; digest/type conflicts, concurrent or interrupted intents,
handler ambiguity, SQL tampering and storage failure are fail-closed. Unknown
outcomes are not automatically retried.

The block intentionally does not implement abandonment, retention, session
ownership, production handlers, listener, pairing, revocation or wire
transport. The provider and journal are not composed into the running server.

## Executed evidence

| Boundary | Result |
|---|---|
| journal focused | `10/10 PASS` |
| provider focused | `10/10 PASS` |
| mobile gate | `22/22 PASS` |
| schema migrations | `55/55 PASS`; 88 migrations |
| M1 exact schema oracle | `20/20 PASS` |
| module ratchet | `13/13 PASS`; 1 214 edges / 3 cycles / 28 files |
| artifact boundary | `158/158 PASS` |
| M6 runtime + technical contracts | `8/8 + 8/8 PASS` |
| M6 locked candidate plan | `16/16 PASS` |
| registry | valid; 487 runnable; exact fingerprint above |
| full offline+database gate | `327 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED` |

The full gate started `2026-08-29T02:04:49.137Z`, ended
`2026-08-29T02:08:40.277Z`, returned exit 0 and remained bound to exact source
`ea97c410f061cf2022777a295a986b26ef773464`.

Raw report:
`.intentsmith-artifacts/m7-journal-offline-database-final-20260829/m7-journal-ea97c410-final/report.json`.

- report SHA-256:
  `a3a3557b305007a3594bf30f8c3b03d3ab1967ecd1d0548b019d88743975b456`;
- inventory SHA-256:
  `db7b66454b9fbfdb601246e9f8afb81aa6984e0b3ada264dac9f7635364ce8c8`;
- inventory fingerprint:
  `82f0e764946852bd2615f5f32d300a25276cb278e14fa9947d7a11c8cfe4c27b`;
- options fingerprint:
  `533fb61b7113b560d7e9cdb0cbaea3bb96a1f4621554c41f3836b378a94f4c20`.

## Red and corrected intermediate evidence

Two local grouped verification commands used historical non-existent entrypoint
names. Their groups exited 1 after the preceding real suites passed. The exact
current entrypoints, `scripts/mobile-gate.js` and
`tests/m6-candidate-plan.test.js`, were then run and passed. These were caller
invocation failures, not product-suite PASS evidence.

Before explicit baseline acceptance the module suite truthfully returned
`12/13` and named exactly two new edges. After the product commit the repository
writer admitted only those two edges; cycles remained 3 and cyclic files 28.
The next artifact run returned `157/158` because ROADMAP still said 1 211
edges. Updating that current-state census produced `158/158`; no executable
code changed in the correction.

No LLM, Ollama or physical GPU program ran. No push, tag, publish, production
signature, key generation, rotation or history disposition occurred.

## Remaining boundary

Independent review is required. Later blocks must still add real core adapters,
session/pairing/revocation authority and an opt-in transport before a physical
mobile journey is possible. Production listener activation and distribution
remain operator decisions.
