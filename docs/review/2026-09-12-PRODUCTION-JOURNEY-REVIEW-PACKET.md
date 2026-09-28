# Studio → physical model → approved files → restart → database restore

Status: **BOUNDED_PHYSICAL_BUILD_PASS / INSTALL_PASS / CURRENT_CODE_MEASURED /
REVIEW_PENDING / RELEASE_NOT_ACCEPTED**. Authority and exclusions:
[WP-PRODUCTION-JOURNEY](../wp/WP-PRODUCTION-JOURNEY-20260912.md).

Review source range: `b5ecf5167ed0f7301551170c0e698b73d6177a4b..dc81a0f0272e42fbbfa7720dfc2749a28a3d4e20`.
The only shipped change is an accurate offline-install message: an unprobed
Ollama is no longer reported as stopped. `src/`, Studio, all dependencies,
registered tests and their classification are unchanged from the reviewed input.
The new manual script is `scripts/run-project-build-journey.js`; it defaults to
printing its plan and requires explicit `--run` plus a new private evidence root.
Documentation closeout updates the install/build guides and current status.

## One joined physical journey

Clean source `dc81a0f0`, built Electron frontend
`8fee233175ff7bc2b2f4bb5b98778c740c3c6720649119e1c20c4fdbd632ad69`.
The physical run lasted from `2026-09-12T16:05:52.637Z` to
`2026-09-12T16:06:35.915Z`. Fixture setup creates a private Git calendar project
and its governance policy, registers project/conversation through production
HTTP and selects the initial Studio session. It does not replace fetch, model,
binding, approval, effects or the server entrypoint.

1. Real DOM form submits two dependent `.mjs` targets and an explicit test.
   The actual `src/server.js` uses the production gateway and durable CODE
   binding. Two response-bound calls to local `qwen3.5:27b` finish with `stop`.
2. The complete generated contents and literal test argv are visible. Both
   target files and the baseline Git HEAD remain unchanged before approval.
   A wrong digest gets HTTP 409 and leaves the plan awaiting approval.
3. Both Studio and server exit normally. New processes restore the same pending
   binding. Approval stays disabled until **Načíst stav a plán** displays it.
4. The actual **Schválit zobrazené změny** button executes the existing M2
   sandbox. Twelve behavioural assertions cover ordinary/leap/century years,
   fractions, strings, null, undefined, NaN and Infinity. The terminal is
   `succeeded`, test exit 0, and exact preview bytes are on disk.
5. A second new server/Studio pair reloads the identical terminal and result.
   Production backup HTTP creates a V2 snapshot. A subsequently created
   conversation acts as a restore marker.
6. With holders stopped, the CLI rejects altered backup bytes under a valid
   backup name with **BACKUP_CONTENT_MISMATCH** and unchanged current DB hash.
   A valid restore recovers byte-identical SQLite. The final new process pair
   retrieves the same lifecycle result, while the later marker returns 404.

Four server PIDs: `2196780 → 2199099 → 2199606 → 2199855`; Studio launcher PIDs:
`2196830 → 2199129 → 2199664 → 2199887`. All eight exits are 0. Four read-only
post-shutdown observations preserve the same `CONFIG_DEFAULT` CODE binding,
digest, revision, event ID and timestamps; SQLite quick/FK checks pass.
The form intentionally requests no Git commit (`not_requested`). This proves
approved writes, functional testing and persistence, not a new UI Git workflow.

The test owns private HOME/SQLite/projects/profile/Xvfb. Server and Electron
run in a loopback-only network namespace with GPU devices hidden. A private
Unix-socket relay admits only the exact local provider paths/model; no pull,
delete, remote browsing or live binding mutation. GPU use holds the existing
global evaluation lock and checks idle GPU/Ollama and RAM/disk first. Provider
responses attest digest `7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e`
and version `0.34.0-intentsmith.1`. The owned model is unloaded and lease released.

Explicit limitations: `NODE_ENV=test`, optional background features/discovery
disabled, scoped diagnostic Electron `--no-sandbox`. Renderer capture begins
after negotiated startup. This is not the registered 65-second full-network
census, production default-on discovery proof, full agent/platform journey,
six-file expense example or free-text SPEC→BUILD acceptance. The backup restores
the database; source/skills payloads remain archival and project files are not
silently restored. Independent acceptance remains required.

## Installation, upgrade and failed attempts

Owned standalone clone under `.intentsmith-artifacts/production-install-20260912-01/source`
was made with `git clone --no-local`, with no copied node_modules. Core install
on `0dd9e956` ran after both dependency directories were absent. Repeated install
on `0102bbc7` passed too. Both used the actual `scripts/install.sh --profile=core
--offline --minimal` in an empty network namespace, including native Electron
rebuild, frontend build and artifact smoke. Node `22.21.1`, npm `10.9.4`, Yarn
`1.22.22`. The final physical runner revision `dc81a0f0` changes only its backup
negative assertion from `0102bbc7`; installer, runtime sources, lockfiles and
built assets are byte-identical. Exact installer pins and that parity are in
the handoff; this distinction must survive review.

Caches were prepared explicitly. Attempts 1/2 lacked the correctly located
Corepack Yarn cache; attempt 3 reported `ENOTCACHED` for yargs-parser. Those
logs remain. Missing locked npm/Yarn packages were then obtained with lifecycle
scripts disabled and frozen locks; generated dependency directories were removed
before successful offline installation. This proves offline replay from prepared
caches, not installation without dependencies or network-free cache provisioning.
Core profile intentionally excludes optional PDF provisioning.

Schema suite **61/61** re-verifies fresh, base, retired web-111 and hunt-line
database upgrades, exact rows/raw BLOBs/history, canonical migration adoption,
consumed approvals and close/reopen. There are 100 migrations. The registered
M5 install/restore suites pass. These schema upgrade controls are separate from
the joined current-binary journey; no old published release binary was invented.

The first manual run on `a647fb66` failed before inference: fixture project was
outside private HOME and the relay did not recognize the read-only show `name`
field. `2015ed34` fixed the fixture and completed an initial seven-assertion
journey. Its negative backup test was too weak: `-corrupt` violated the backup
name grammar, so it proved name rejection, not content-integrity rejection.
An independent valid-name content check then passed, and the final joined
`dc81a0f0` run explicitly requires `BACKUP_CONTENT_MISMATCH`. All earlier results
and the weaker assertion remain recorded, with this qualification.

## Current CODE measurements

Same current contract for both artifacts:
`6ee5ab47cbc4a42649835cac02d6cca82ad43d97ba12a9fbaa84276fe6fc7035`,
`code-patch-v136.1-prototype.1`, **7 tasks × 3 repeats**. The actual existing
runner, repetition/cache path and typed append-only history writer are used.
No test threshold, prompt, grader, token ceiling or dependency was changed.
Both are measured through the patched local provider with exact response digest
and provider version verification. Evaluation runs at the contract's 16384 context;
the independent placement/throughput probe uses production 32768 context.

| Artifact | CODE score | 32768 placement | Probe throughput |
|---|---:|---:|---:|
| qwen3.5:27b, `7653528b…ec06e` | **0.333333** | 18,233,688,062 B, all GPU | 37.3 tok/s |
| qwen3-coder:latest, `06c1097e…90bca` | **0.114286** | 21,718,567,484 B, all GPU | 168.3 tok/s |

Scores are task means, not a percentage of arbitrary projects completed. Qwen
3.5 repeats score 2/7, 2/7, 3/7; one task is unstable. Qwen Coder completes no
whole task and gains 0.8 on one task in all three repeats. The actual pair has
three discriminating tasks: candidate wins 1, incumbent wins 2, margin -0.4.
Speed does not overturn this result. Neither score justifies a broad autonomous
code-quality claim. A separate control replay gives all **7 gold patches score
1** and all **7 original broken versions score 0** under the same fresh installed
dependencies. Raw oracle output is retained.

Durable run IDs are `eval_2f845415-b880-4c39-a5d6-5fad7526d75e` (source `0102bbc7`)
and `eval_063d0788-b590-4383-9514-91c4b63d4bab` (source `dc81a0f0`). Source changes
between them do not alter any evaluation-contract bytes. The first is measured
once via the existing repeated-run/cache path; its self-comparison is not a duel.
The second reuses the exact current incumbent row copied into a new private DB.
Both rows and their timestamps survive; no production history/binding was changed.

A third installed candidate, north-mini-code-1.0, was **BLOCKED before inference**
because the operator's new hunt owned the GPU lock. It has no new score. Its
private blocked report and copied prior history are retained. Foreign hunt
processes/services/checkouts and resident models were not stopped or altered.

## Checks and artifact locations

Required deterministic **353/353 PASS** on final source `dc81a0f0`, report SHA-256
`cd66a630022f282939b400842b8ca49a688339f07bfff3a2162a7469aa727339`.
An earlier full run on `0102bbc7` also passed 353/353. Registry remains 516,
fingerprint `162b890b97142127fdd4859bc48a02056a837b3fd2773e26d8a130e0e55f4deb`.
No reclassification or graph baseline update; `src` graph remains 1330 edges.

Within the owned audit checkout:

- `.intentsmith-artifacts/production-journey-20260912/`: exact replay/diagnostic
  scripts, focused/full/registry logs and later handoff collection.
- `.intentsmith-artifacts/audit/production-journey-20260912-02/`: final required
  report and all 353 raw suite logs; `-01` retains the earlier complete run.
- `.intentsmith-artifacts/production-physical-20260912-01/` and `-02/`: initial
  failure and weaker first successful manual run, kept intact.
- `.intentsmith-artifacts/production-backup-content-20260912-01/`: independent
  content-corruption rejection and unchanged target hash.
- `.intentsmith-artifacts/production-install-20260912-01/`: clone/install/cache
  provenance, attempts 1–5 and build hashes. Within `source/.intentsmith-artifacts/`,
  `production-fresh-physical-20260912-01/` holds the final joined runtime,
  screenshots, exact plans/terminals, provider/renderer trace and isolated SQLite.
  `current-code-20260912-01/`, `current-code-candidate-20260912-01/` and
  `current-code-north-20260912-01/` hold model evidence and private history DBs.
- `.intentsmith-artifacts/production-journey-review-20260912/`: final source bundle,
  hash manifest and curated evidence archive; no dependency caches or live keys.

Review should trace the DOM→HTTP→binding→gateway→effects call path, verify the
pending-plan restart and valid-name corruption negative, and inspect the exact
CODE artifact/contract/provider rows plus oracle controls. The independent review
of previous retention/integration and M1 sequencing remains separate. M5 offline
key custody/recovery, required signed receipts and operator M6 acceptance are
not performed by this engineering qualification.
