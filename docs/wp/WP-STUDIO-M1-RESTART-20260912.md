# Studio M1: diagnose startup/restart network nondeterminism

Authority: PRODUCT §2.7 / §3 (observed conversation recovery and cancellation),
ROADMAP M6's retained Studio M1 capture failure, and the operator's standing
instruction to finish production-critical work without micro-handoffs.
Input `055b23967c1ed22bb04f88894be8e0591b24338e`; use the existing owned audit
checkout on `work/studio-m1-restart-20260912`. No additional worktree.

Root owns the bounded diagnosis, test-owned M1 runner/fixture timing and relevant
regression coverage in `tests/studio-electron-boundary.e2e.js`,
`tests/studio-electron-runner-contract.test.js`, `tests/fixtures/studio-m1-electron-backend.js`
and the existing CDP reducer/tests if needed; current roadmap/map/inventory
and one scoped review record. No connector/security policy changes, model/GPU
work, live DB, keys, foreign checkout/services or dependency changes.

Question: can the five startup list requests overlap the deliberate M1 listener
restart and produce the observed missing-wire network failure? Compare a bounded
forced-collision diagnostic using the shipped Electron bytes with the unchanged
registered runner. Diagnostic fault injection is labelled separately and is not
acceptance evidence. Preserve every failed run. Do not infer a historical cause
from a superficially matching failure alone.

If a specific race is established, fix sequencing at the test-owned orchestration
boundary while still observing all requests and exercising the same restart,
cancellation, rehydrate, terminal and 65-second network assertions. A regression
must distinguish failure without the fix from success with it. No timeout bump,
retry-until-green, disabled capture, filtered failed requests, registry change
or reclassification of the registered test. Stop scope growth if the result points
to a different product/authority change; report the finding without inventing it.

Verify focused registered CDP/runner suites, built Electron M1 plus shared M0 and
composer consumers, unchanged `npm run test:deterministic` (same explicit local
PDF Python and git/bwrap/bubblewrap/prlimit/python-pdf-runtime allowances), and
`npm run test:registry` on a clean pin. Include source/build hashes and cleanup.
Completion: bounded diagnosis, any supported remediation tested, and an exact
handoff retaining limitations. Independent review and whole-release acceptance
remain separate. No push/deployment.
