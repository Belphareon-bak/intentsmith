# WP: Functional acceptance of a generated six-file project

Status: **successor candidate, independent review pending; 2026-10-01 physical model journey at `62e1309f` `FAIL`; successor physical journey `LIVE_NOT_RUN`**.
Authority: operator's 2026-10-01 request to verify that generated applications actually work; `PRODUCT.md` §2.7 and §3; the six-file expense-ledger blueprint in `docs/PROJECT-BUILD.md`.

## Owned scope and fixed oracle

This package owns only `scripts/project-app-acceptance.js`, `scripts/run-project-app-journey.js`, `tests/helpers/project-app-reference.js`, `tests/project-app-acceptance.test.js`, `tests/project-app-m2-functional.test.js`, `docs/PROJECT-BUILD.md`, and this WP. It changes no chat, M2, provider, contract, schema, registry, or production service code. The runner creates a fresh project and DB under its own ignored `.intentsmith-artifacts/<new-run>/runtime-*` tree. No imported project path is used.

The model may propose **exactly** `src/app.js`, `src/cli.js`, `src/service.js`, `src/storage.js`, `src/totals.js`, and `src/validate.js`, with the dependencies and public instructions from `docs/PROJECT-BUILD.md`. Those instructions specify command tuples, one result per command, independent ordered `{amount,category}` rows, validation, and the named exports shared among the six modules. Each individual instruction and the overall instruction remain under the actual 512-byte compiler limit. The operator writes `test/acceptance.test.mjs`, `test/subject-probe.mjs`, `test/validate-invalid.mjs`, and the `src/index.mjs` CLI adapter into the new project, checks their SHA-256 hashes, and commits them **before any model call**. The private project's governance policy adds only `node:child_process` and `node:vm` to its default imports for this fixed oracle; that policy is also hashed and committed before inference. None of these files appears in the model's file plan or writable M2 diff. `focusedTest` is fixed to the preflight-checked Node 24 executable at `process.execPath` with argv `--experimental-vm-modules test/acceptance.test.mjs`; the model supplies only bytes for the six generated files. This successor leaves the oracle, probes, CLI adapter, and policy bytes unchanged.

The trusted oracle launches the CLI and fixed probes as children inside the canonical `linux-bwrap-ro-v2` process sandbox. Child stdout and exit status cover CLI behavior, but cannot prove object identity because generated code can forge them. For that requirement the trusted parent loads only generated `storage.js` and `validate.js` in a `vm.SourceTextModule` context with no `process` or `console`, disabled string/Wasm code generation, only the declared storage-to-validator static link, and denied dynamic links. It directly compares returned object identities, mutates one snapshot, and reads the other snapshot and stored row again. It also invokes the validator with a finite value and actual `NaN`, `Infinity`, and `-Infinity`, and checks randomized storage row values. VM is a narrow observation mechanism inside the existing OS sandbox, **not** a new security attestation. The retained child and CLI checks cover three decimal additions, exact total `23.25`, exact category sums `{food:16,travel:7.25}`, fresh random numeric/category inputs, ordered row values, empty state in a new run, invalid amounts and categories, and an unknown operation. After a server restart, the runner executes the CLI and full oracle again in fresh sandbox processes. These checks do not rely on model-generated tests, source keyword matches, HTTP success alone, or a Git commit alone.

## Live qualification sequence

1. Freeze and independently review one clean source commit, the oracle hash, exact CODE tag and SHA-256 digest. Choose a new direct child of `.intentsmith-artifacts`. Use a Node runtime compatible with this checkout's native `better-sqlite3` ABI; currently `/home/belphareon/.nvm/versions/node/v24.21.0/bin/node`. The no-GPU command is `<node24> scripts/run-project-app-journey.js --preflight`; it reports `LIVE_NOT_RUN` and source/oracle pins plus actual native SQLite compatibility.
2. Only in the serialized GPU slot run `<node24> scripts/run-project-app-journey.js --live --out <new-absolute-artifact-path> --source-sha <40-hex-commit> --model <exact-installed-CODE-tag> --digest <64-hex-digest>`. The runner acquires the evaluation lock; checks empty resident models, compute process inventory, RAM/disk readiness and the exact installed digest; and exposes only that model through a scoped Unix-socket relay into a loopback-only network namespace.
3. A private backend creates a new project and project-bound conversation. The conversation ID is the actual durable `conv-...` string from `/api/conversations`. Before model inference the fixed oracle, storage probe, validator probe, CLI adapter and local policy are hashed and committed. The actual `/api/m2/lifecycle/draft` generates six model proposals and must return the complete six-file diff while files and Git remain unchanged. A wrong digest approval must fail. The backend restarts and retrieves the same pending plan.
4. One exact `/api/m2/lifecycle/approve` runs the frozen oracle in M2's process sandbox and commits the six exact preview byte strings. The runner checks every file's bytes, clean Git, private CODE binding and durable M2 terminal. After a second backend restart it checks identical terminal/result, idempotent repeated approval, unchanged file identity and bytes, and runs the app CLI and oracle again in separate sandboxed processes.
5. The parent records the six provider responses with the requested model digest/version and exact preview-byte hashes even when the private child fails. `providerAttestation.valid` is a separate result and never overrides an application `FAIL`. An approval response is saved as `terminal.json` before asserting success; if approval was never reached, that file does not exist. The parent releases its owned model and GPU lock and writes the available evidence in the private run directory. Any failed assertion yields `FAIL`, never a partial `PASS`.

This is a backend HTTP/project/M2 functional journey. It does not claim a literal installed IDE renderer journey, a successful unknown model before the physical run, or broad API/DOM application coverage. A physical failure should preserve the private evidence for diagnosis and source-pinned revision testing; a model-generated flawed implementation is a quality failure even if draft transport succeeded.

## Offline evidence and required gates

`<node24> tests/project-app-acceptance.test.js` runs trusted reference modules and deliberate total/category mutants in the real read-only process sandbox. Both mutants must fail the frozen oracle for their intended assertions. `<node24> tests/project-app-m2-functional.test.js` runs the successful build and seven negative builds through the production M2 service, actual SQLite/Git/bwrap, exact approval, rollback, and a second Node process reading the durable terminal. The negatives cover wrong totals, the observed `cmd.op` object-command/last-result error, generated code mutating `node:assert/strict`, early marker/exit, the 95c9 nonfinite/JSON forgery, plain storage row aliasing, and the exact 65dd storage row alias plus forged JSON from argv. Each negative must fail M2 and restore all six targets; the new object-command case also checks the exact stderr and the failed terminal after reopening SQLite in another process. On this successor, Node 24.21.0 ran the suites **4/4 and 8/8 PASS** with the actual bwrap process profile. Syntax checks and no-inference preflight passed; the public instructions in the executable blueprint and documentation were compared as exact strings, and all instruction byte lengths were below 512. A read-only replay of the first failed run's six provider records produced `providerAttestation.valid=true`; deliberate wrong digest, wrong preview hash, and missing preview produced `false`. The frozen oracle, probe and entrypoint hashes remained `1593a906…`, `838f3c8d…`, `baf09f92…`, and `58a792dc…`. `git diff --check` and the applicable registered offline/DB profile remain gates before review/integration. The next physical run is separately gated on source freeze, independent review, exact model inventory, and the serialized GPU lease.

## First physical qualification and bounded successor

The first six-file physical attempt at clean source `62e1309f6a11fa8f750a4137621d106185a85e80` is **FAIL**, with private evidence in `.intentsmith-artifacts/project-app-live-qwen38-20261001-0836/`. Its CODE model was `qwen3.8:latest` at digest `22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643`. All six provider outputs were complete, identity-matched, and byte-for-byte present in the draft preview. The generated `src/cli.js` read `cmd.op` from object commands and returned only the last result, while the fixed entrypoint passed tuple commands and the frozen oracle required one result per command. Durable process stderr contained `Unknown operation: undefined`; focused test failed, all six effects rolled back, the baseline Git HEAD remained unchanged, and no commit occurred. The other application behaviors did not run past that first failure. The old model-visible file instruction did not specify tuple command shape or the result array, and the model was not given the fixed test. Therefore this is a real failed application attempt and also an underspecified public interface; it is not valid evidence that the model failed a fully specified API. The successor states the API in the public blueprint without changing the frozen oracle, adds the exact observed failure as an M2 regression, and keeps the first FAIL evidence intact. No successor model inference has run.

Independent review of the first candidate `a3a94d7f` was **CHANGES_REQUIRED**: it proved that the original oracle could report a successful focused test and commit a wrong total when generated code changed imported assertion functions or exited after printing the marker. It also found an incorrect numeric conversation-ID expectation that stopped the live runner before model inference. The successor changed the trust boundary: only the child loads generated code, while the parent process checks complete outputs. This failed evidence remains visible.

Independent review of successor `95c9d211` was also **CHANGES_REQUIRED**. Its generated `validate.js` mutant accepted `NaN` and both infinities, while `app.js` detected `subject-probe.mjs`, printed the complete expected `{failures:[true,true,true],distinct:true}` JSON and exited zero. The old trusted parent accepted those child-declared booleans, so actual M2 committed a faulty app with the frozen oracle hash unchanged. The reproduction and log remain in `.intentsmith-artifacts/gate0-review-app-forged-probe-95c9.{mjs,log}`.

Independent review of `65ddc2e1` was **CHANGES_REQUIRED**. Its generated `storage.js` used `rows.slice()`, exposing the same row object, while detecting `subject-probe.mjs` and printing the expected before/after JSON copied from argv. Actual M2 committed the faulty app; a separate process after restart observed `sameRow=true` and changed stored amount `999`. The proof and the narrow direct-API prototype remain in `.intentsmith-artifacts/gate0-review-app-storage-{invariants,proof}-65dd.{mjs,log}` and `.intentsmith-artifacts/gate0-review-app-api-context-prototype-65dd.{mjs,log}`. This successor makes the object identity and mutation assertions in the trusted parent. Successful offline controls and the physical live journey remain different evidence states; this candidate still requires independent re-review.

An initial successor probe embedded an `import` source string inside the oracle; the conservative governance scanner classified its relative specifier against the oracle file and denied the draft. Moving that probe to the frozen `test/subject-probe.mjs` file resolved the denial. The first VM candidate also triggered this conservative scanner with words in assertion text; removing those words from non-code text allowed the draft. The final seven M2 offline cases run through governance without changing product policy or implementation.

The first direct invocation of the M2 test with the shell's Node 22 failed before any M2 assertion because the shared `better-sqlite3` binary is built for Node ABI 137. Re-running with local Node 24.21.0 passed both cases. The native-runtime preflight now reports this prerequisite explicitly; the Node 22 result is a toolchain failure, not evidence for application behavior.

The registry owner may add two additive entries for `tests/project-app-acceptance.test.js` and `tests/project-app-m2-functional.test.js` in the registered deterministic test graph. This candidate does not edit that registry.

## Accepted integration and next physical boundary — 2026-10-01 08:24 UTC

Independent functional review accepted the complete `db601749 →
62e1309f6a11fa8f750a4137621d106185a85e80` range. Its own Node 24.21.0
run passed all 11 controls (4 oracle controls and 7 real M2/SQLite/Git
journeys); a second reviewer accepted the static direct-API observations.
Private receipts remain in the author checkout under
`.intentsmith-artifacts/gate0-review-app-functional-controls-62e.log` and
`gate0-review-app-functional-metadata-62e.json`. Previous failed reviews
above remain historical evidence. Source, contracts and registry were
unchanged in the reviewed author range.

Root integrated all four commits in order, ending at `03c82d7e`. The
six changed paths match the accepted candidate byte for byte. Additive
registration of the two suites and the helper exclusion is a separate
integration step; the original author did not claim registered evidence.
Registered verification on the combined clean source is pending.

The operator has assigned further CHAT work to another worker. The
physical project journey here exercises CODE/M2 and a newly created
private project; it does not run the conversational CHAT corpus. A
read-only GPU inventory at 08:24 UTC found a foreign/UNKNOWN resident
provider process, PID 3765553, with 16,914 MiB allocated and only 5,270 MiB
free VRAM. No lease existed, but the resident process still prevents
claiming an available serialized GPU slot. No foreign model was unloaded,
no inference was attempted and production services were unchanged.
Physical evidence remains **LIVE_NOT_RUN / GPU_IN_USE** until the slot
is free and the exact clean source/model/digest pins have been recorded.

At 08:36 UTC a fresh serialized GPU slot became available: no resident
provider model or NVIDIA compute process, no foreign lease, 22,315 MiB
free VRAM, 24,598,464 KiB available RAM and 162,930,421,760 bytes free disk.
Root started the physical CODE/M2 journey on the clean, independently
accepted author source `62e1309f6a11fa8f750a4137621d106185a85e80`, installed
and production-desired CODE tag `qwen3.8:latest`, digest
`22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643`.
It owns the shared GPU lease and a new private project/DB. State is
**RUNNING**, not a functional PASS. No conversational CHAT corpus runs.
Private output is `.intentsmith-artifacts/project-app-live-qwen38-20261001-0836`
in the author checkout; acceptance remains pending its actual terminal.

## First physical terminal — 2026-10-01 08:37 UTC

The actual frozen `62e1309f` run ended exit 1 / **FAIL**, not an accepted
app. Six complete CODE responses were generated and the exact plan approved;
the frozen functional test rejected the application. Durable execution stderr
reports `src/cli.js:53 Error: Unknown operation: undefined`. Generated CLI
expected command objects and returned only the final result; the documented
example and fixed entrypoint use tuple arrays and one result per command.
The model-visible per-file instruction omitted that wire-format requirement;
focusedTest is deliberately not supplied to the model and no context file
was requested. This is a generated interface mismatch and an incomplete
public blueprint, not a valid clean test of an explicitly supplied format.

Independent read-only diagnosis verified all six provider terminals, exact
digest/version, and bytes against the preview hashes. It also verified six
rollback events, failed durable terminal, no commit, unchanged baseline HEAD,
clean project and absence of all six generated targets. Frozen oracle, probes,
entrypoint and policy hashes are unchanged. GPU lease was released and the
owned model unloaded. The runner did not save terminal.json or validate its
provider attestations after the failed child exit; the durable SQLite and raw
provider log supply these independently verified facts. That failure-evidence
omission and the public interface contract are a separately reviewed follow-up.
No assertion or oracle is weakened and this physical failure remains preserved.
Physical success/restarts of a generated app remain **NOT_ACCEPTED**.
