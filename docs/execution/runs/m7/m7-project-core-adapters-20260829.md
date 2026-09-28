# M7 project core adapters — 2026-08-29

**State:** `IMPLEMENTATION_GREEN / FULL_GATE_GREEN / REVIEW_PENDING /
NOT_ACTIVE`

## Binding

- base journal evidence HEAD: `6e4fc2cfb50da4a76f0e69564f581d96ea955b3c`;
- exact product candidate: `e937344a94b71303646ccdae1b658c7c4fba6248`;
- candidate tree: `299daec816c3e8f2ff084fe2680561b6618d25ad`;
- implementation commit: `5906bf6259fddea55ddfd80b4a6d3eb8df173d7e`;
- module-baseline commit: `a0233a00fc7cc1dedca346f7202a316b32922b79`;
- DB-bootstrap oracle correction: `e937344a`;
- branch: `codex/m7-mobile-contract-integration-20260829`, without upstream;
- registry: 488 runnable, 394 ACTIVE / 79 BLOCKED / 15 HISTORICAL;
- registry fingerprint:
  `82c2d70acfbfbc84f2d8db8f950824133e71baacbfe6e1cddc5daed5a4fd10e2`.

## Implemented boundary

`project.list` reads only active projects from the real SQLite catalog. Before
metadata can leave core, an injected authority approves the trusted
`deviceId + subjectId + projectId + operationId`, the existing M2 provider
observes the workspace twice, and authority is checked again. The whole active
catalog is re-read after observation; any catalog or workspace instability
returns one generic typed error. The scan is bounded at 200 projects.

The continuation cursor is canonical, HMAC-SHA-256 authenticated and bound to
capability/version, operation, device, subject, normalized filter digest,
complete snapshot revision and offset. It has no request-controlled key and
cross-device, cross-subject, cross-operation, filter, snapshot and byte-tamper
replay all fail closed.

`project-context.query` accepts a numeric `projectId`, never a host path. After
authorization the adapter resolves the catalog path internally and delegates
to the accepted M2 `ProjectContextQuery/Snapshot@1` provider. It rechecks the
project mapping and authority before returning. Result and error bytes never
contain `canonicalRoot`.

The modules do not import route, server, database singleton, session, listener
or network authority. They are handlers for the already transport-free
provider and are not composed into production.

## Executed evidence

| Boundary | Result |
|---|---|
| project adapters | `8/8 PASS` |
| provider + durable journal | `10/10 + 10/10 PASS` |
| mobile gate | `23/23 PASS` |
| schema migrations | `55/55 PASS`; 88 migrations |
| M1 exact schema oracle | `20/20 PASS` |
| DB bootstrap meta-test | PASS; 120 database-reachable roots protected |
| module ratchet | `13/13 PASS`; 1 216 edges / 3 cycles / 28 files |
| artifact boundary | `158/158 PASS` |
| M6 runtime + technical contracts | `8/8 + 8/8 PASS` |
| M6 locked candidate plan | `16/16 PASS` |
| registry | valid; 488 runnable; exact fingerprint above |
| full offline+database gate | `328 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED` |

The green full gate started `2026-08-29T02:34:25.492Z`, ended
`2026-08-29T02:38:09.674Z`, returned exit 0 and stayed bound to exact source
`e937344a94b71303646ccdae1b658c7c4fba6248`.

Raw report:
`.intentsmith-artifacts/m7-project-core-offline-database-rerun-20260829/m7-project-core-e937344a-final/report.json`.

- report SHA-256:
  `bbf234ae74589f22c3d2ae4d46c44d916fec7754c895335822627154bb9fa2a4`;
- inventory SHA-256:
  `91aa628d1555ca87eca79acda221a33f39b205c255be046195a53409ff463316`;
- inventory fingerprint:
  `f8f676ad40d5e42e8a9455f568af1a08a7a44fc61a473e382e4d0999fbdeda63`;
- options fingerprint:
  `533fb61b7113b560d7e9cdb0cbaea3bb96a1f4621554c41f3836b378a94f4c20`.

## Red and corrected intermediate evidence

Before explicit baseline acceptance, the module suite truthfully returned
`12/13` and named only these new edges:

- `src/remote/m7-project-core-adapters.js -> src/code-intel/project-context-provider.js`;
- `src/remote/m7-project-core-adapters.js -> src/remote/m7-core-cursor.js`.

The writer admitted those exact edges after the product commit. Cycles stayed
at 3 and cyclic files at 28.

The first full gate on intermediate candidate `54e62859` ended with
`327 PASS / 1 FAIL`, verdict `FAIL`, exit 1. The report SHA-256 is
`daba8f29655407ed9338f45bfa628d412aa9ddd0d95d49e37a740084531d7be4`.
The only failure was the intentional DB-bootstrap census oracle: the new M7
test was the 120th database-reachable root while the exact expected count was
still 119. `e937344a` documents the new protected root and the meta-test now
proves 120/120 before the clean rerun.

Two unsupported discovery invocations, `--help` and later `--format=json`,
returned exit 1 from `validate-test-registry.js`; the declared `--json` command
then passed with the fingerprint above. These were caller errors, not product
suite evidence. An exact ignored test sandbox cleanup using `rm -rf` was
rejected by the terminal safety layer; the zero-byte sandbox was moved to the
recoverable desktop trash instead. No product or foreign data was removed.

No LLM, Ollama, physical GPU, public network, device, pairing, signature,
rotation, history rewrite, push, tag or publish action ran in this block. The
separate M6 24-hour soak remained alive and untouched.

## Accepted implementation limits

The adapter intentionally rebuilds at most 200 active projects for each page.
SQLite, filesystem and the later session authority have no common transaction;
the block uses repeated observation and final authorization, not a claim of an
atomic cross-resource snapshot. Archived-project projection, session-generation
binding, production cursor-key custody, pairing/revocation, composition root,
listener and wire transport remain later M7 work.

Independent review is required. This report is not M7 acceptance or runtime
activation.
