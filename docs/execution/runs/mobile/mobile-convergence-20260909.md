# Mobile convergence — 2026-09-09

Status: IN_PROGRESS / REVIEW_PENDING / NOT_PROD_READY.
Authority and pinned inputs: [WP](../../../wp/WP-MOBILE-CONVERGENCE-20260909.md).
Working branch: `work/mobile-completion-20260908`, existing owned checkout.

Mobile `1ab8d942` and B `f812259d` are fixed merge parents. No newer B commits
are silently included. B current preflight HEAD was `0b0a4669`, clean; R donor
`5cd14776` was clean. Main/foreign branches were not changed. No upstream/push.

Three actual conflicted files: release policy, release evidence and TRYING-IT.
The Android test merged textually, but its old positive fixture still used a
development M5 adapter pin and lacked physical-evidence/origin fields. First
focused run after conflict resolution: 18 PASS / 1 FAIL. The fixture was corrected
to the actual M7 requirements and a 128-combination conjunction regression added;
the test was not relaxed to accept the old M5 production input.

Merged release focused test: 19/19 PASS; merged mobile gate before inventory
registration: 45/45 PASS, exit 0. Raw logs include the initial red run.

The locale donor was adapted, not copied wholesale: 242 literal desktop route
declarations, 7 M7 transport routes, 17 native invocation operations and the
separate public `remote-health.read` prerequisite. Two initial inventory checks
correctly failed on assumptions copied from the donor: public health was being
counted as an invocation; `/api/workers` is not a literal route in B. The checks
now compare the actual native catalog and `/api/specialists` desktop-only domain.
No route or runtime contract was changed. Generated JSON/Markdown match under
four independent locale processes (C/en_US/cs_CZ/de_DE); stale artifacts reject.
Registry: 511 programs, fingerprint
`8423593748b7c91ecb64215147ac8e3350fe50770529a62b66425be4d65f0ff6`.
Gate0 pins intentionally remain identical to pinned B (CONTRACT §8).

Raw logs: `.intentsmith-artifacts/mobile-convergence-20260909/`.
Product/evidence candidate, final tests, review and cleanup: pending.
