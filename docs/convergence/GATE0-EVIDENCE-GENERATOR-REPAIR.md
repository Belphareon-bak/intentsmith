# Gate 0 evidence generator repair

Scope: remove manual verdict control, make validator failures distinguishable
from evidence-infrastructure failures, derive every rendered clause from one
model, and remove stale registry/disposition facts.

Implementation commit:
`f84107f27b1c106cf45034f7a1108dc4e3087dfb`.

## Contracts

- Both validators expose structured JSON.
- Exit 0 requires a green report whose schema, source identity, counts and
  fingerprint agree with the candidate.
- Exit 1 plus a well-formed report containing validation errors is valid red
  evidence. The generator writes all four documents with verdict `FAIL` and
  then exits 1.
- Missing execution, a signal, unsupported exit, malformed/contradictory JSON,
  unknown terminal vocabulary, or broken pinned invariants is infrastructure
  failure exit 2.
- `--verdict`, including an empty value, is rejected. With all local evidence
  green, pending independent review can derive only `CONDITIONAL PASS`.
- The current generator validates `GATE0-RISK-IMPACT.json` against every risk
  row. Any non-closed `G0_FAIL` or unclassified open/local risk forces `FAIL`;
  no fixed risk-ID allowlist defines that result (`D-024`).

## Exact focused evidence

At exact implementation commit `f84107f`:

```bash
env \
  HOME=.intentsmith-artifacts/g0-generator/post-f84107f/home \
  TMPDIR=.intentsmith-artifacts/g0-generator/post-f84107f/tmp \
  C3_DB_PATH=.intentsmith-artifacts/g0-generator/post-f84107f/runtime/test.sqlite \
  node tests/artifact-validation.test.js
```

Result: `49 passed, 0 failed, 0 skipped`, exit 0.

```bash
node scripts/validate-test-registry.js
node scripts/validate-test-registry.js --json
node scripts/validate-final-disposition.js
```

All three commands exited 0. The registry reported 350 runnable programs and
SHA-256
`a7a5c6d4670159cd38a08edea8aabbf868eb3342a3baf1857b6a4849d1f4960a`.
Disposition reported 225 records, 92 terminal `REBUILD` rows and resolutions
`ABSENT=91`, `EXACT=32`, `MAPPED_REPAIR=3`, `MODIFIED=99`.

The isolated `tests/nightly-orchestrator-self-test.js` and
`tests/nightly-audit-runner-self-test.js` each exited 0. The latter deliberately
exercised internal PASS, FAIL, TIMEOUT and BLOCKED fixtures before reporting
`nightly audit runner self-test: PASS`.

## Independent control-flow review

An independent reviewer used temporary synthetic evidence only to control the
generator branches; those fixtures are not Gate evidence. This list preserves
the behavior tested before the later `D-024` policy generalization. On temporary
patched commit `8664ff1`:

- green validators plus open `G0-R023`/`G0-R025`: four `FAIL` documents,
  generator exit 1;
- structured-red disposition: four documents, G0-C2 `FAIL`, exit 1;
- structured-red registry: four documents, G0-C3 `FAIL`, exit 1;
- malformed disposition or registry: exit 2 and all four pre-existing output
  hashes unchanged;
- all local evidence green and blockers closed: four
  `CONDITIONAL PASS` documents, exit 0.

The review then found three schema edges: empty `--verdict=`, hard-coded
disposition row wording on a red report, and unknown count/terminal keys with
correct totals. The follow-up rejects all three. Its focused suite reports
`50 passed, 0 failed, 0 skipped`, exit 0; an exact post-commit SHA is added in
the immediate evidence-binding commit.
