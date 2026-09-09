# Mobile convergence — 2026-09-09

Status: SCOPED_COMPLETE / IMPLEMENTER_VERIFIED / INDEPENDENT_REVIEW_PENDING /
FULL_DETERMINISTIC_GATE_FAIL / NOT_PROD_READY.
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

## Immutable candidate and measured verification

Product candidate: `f7f78d5a113df0029ff16dea5bbfdf8469b6623f`.
Tree: `91ff3bad5af27dea4f87a385a12fa6594366dcb8`.
The following evidence is bound to that clean product, not to a later doc HEAD.

| Check | Measured result |
|---|---|
| Mobile gate, LC_ALL=C | 46/46 PASS, exit 0 |
| Browser accessibility | 24/24 PASS |
| Android release boundary | 19/19 PASS; includes 128 readiness combinations |
| Locale inventory | PASS, independent C/en_US/cs_CZ/de_DE processes |
| Artifact validation | 158/158 PASS |
| Module ratchet | 13/13 PASS; unchanged B baseline 1,273 edges / 3 cycles / 28 cyclic files |
| DB-reachable harness census | PASS; oracle unchanged from B |
| Registry | 511 / 417 ACTIVE / 79 BLOCKED / 15 HISTORICAL |
| Fresh clone deterministic | **350 PASS / 1 FAIL / 0 BLOCKED**, exit 1 |
| APK + AAB build | PASS, explicit remote-core-v1 throwaway debug signing |
| Offline Gradle JVM + lint | 3 M7 canonical JSON tests + 1 template; 0 errors / 16 warnings |
| Actual APK/AAB source/runtime binding | PASS; clean source SHA, M7 pin, native HTTP patch false |
| Runtime dependency audit | 0 vulnerabilities; CycloneDX 1.5 with 2 runtime components |
| Real VPN / physical Android / TalkBack | NOT RUN |
| Production signing / independent review / release | NOT DONE / PENDING / NOT READY |

Fresh clone run `mobile-convergence-f7f78d5a` ran 2026-09-09
07:05:18.470–07:09:20.222 UTC, serial concurrency 1. No exclusions, no no-block,
no allow-dirty. All completed suite source checks were clean and cleanup found
no leaked process. The only non-PASS was
`IS-T1-TESTS-NIGHTLY-ORCHESTRATOR-SELF-TEST`, failing with
`registry hash differs from the reviewed Gate 0 policy`. This is exactly the
expected development drift described by CONTRACT §8, introduced here by the
new locale program. It is not a hidden baseline PASS or a release ratification.
The old document-count and DB-census failures did not recur.

Raw report:
`.intentsmith-artifacts/mobile-convergence-20260909/full-gate/mobile-convergence-f7f78d5a/report.json`
SHA-256 `074a994614e1e2db98cac990ab583d037e3eec22b762054deca0c9a0e4c6a75e`.
Sibling checkpoint, inventory and per-suite logs remain preserved.

## Reproduction

From the repository root (full gate was run in an exact detached shared-object
fresh clone, with a fresh offline npm ci and the existing Chromium tool copied
into its ignored cache):

```bash
LC_ALL=C npm run test:mobile
node scripts/mobile-capability-inventory.mjs
node scripts/validate-test-registry.js
LC_ALL=C INTENTSMITH_PDF_PYTHON=/home/belphareon/worktrees/is-m6-operator-demo-prep-20260827/.intentsmith-artifacts/pdf-runtime/bin/python \
  npm run test:deterministic -- \
  --allow-blocker=toolchain:git,toolchain:bwrap,toolchain:bubblewrap,toolchain:prlimit,toolchain:python-pdf-runtime \
  --run-id=mobile-convergence-f7f78d5a \
  --out-dir=/home/belphareon/worktrees/is-mobile-completion-20260908/.intentsmith-artifacts/mobile-convergence-20260909/full-gate
C3_MOBILE_TRANSPORT_MODE=remote-core-v1 \
  C3_MOBILE_APP_URL=https://100.64.0.10:7443 \
  C3_M7_SERVER_SPKI_PIN=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  C3_MOBILE_ALLOW_DEBUG_SIGNING=yes-i-know npm run mobile:android:build
(cd mobile-app/android && JAVA_HOME=/home/belphareon/toolchain/jdk21 \
  ANDROID_HOME=/home/belphareon/toolchain/android-sdk \
  ./gradlew --offline --no-daemon :app:testDebugUnitTest :app:lintRelease)
npm run mobile:android:evidence -- --allow-debug-signer
```

For a new reproduction select a new run ID/output directory; do not overwrite
the original full-gate evidence. Build took 13 s; offline unit/lint took 11 s.
PDF interpreter was reused read-only, not installed into or changed in B.

## Retained Android evidence

`.intentsmith-artifacts/mobile-release/f7f78d5a113d-V2FryZ/manifest.json`
SHA-256 `d65ff5ac384554d15e28aed287f09840f65d3c29030fa5f0fafc98052cce0e85`.
This directory retains the actual APK, AAB, native observations, SBOM/audit
and manifest; private output directory 0700 / files 0600.

- APK: `e00ee25a23f55346391d891df7480f8b10318446d03dd51861bb19ec68938ece`.
- AAB: `aa112e0dfc320c80e2df104673ae6eb660ff7111a761668d3651d1a486a47246`.
- `sourceDirty=false`, `COMMITTED_SOURCE`, exact source candidate in both assets.
- Classification `THROWAWAY_DEBUG_SIGNED`, `releaseTransportReady=false`.
- Runtime blocker `M7_REMOTE_DEVICE_AND_VPN_RUNTIME_EVIDENCE_NOT_RECORDED`;
  no expected production signer was supplied. The origin and all-a SPKI pin
  are synthetic build-only inputs, not production identity or a live connection.
- Android reports copied to `mobile-convergence-20260909/android-reports/`.

## Scope review and cleanup

[Milestone review packet](../../../review/2026-09-09-MOBILE-CONVERGENCE-REVIEW.md)
distinguishes these three completed integration milestones from incomplete
MM2–MM6 product acceptance and the remaining screen/BE/hardware work.
No independent reviewer was invoked for this new merge; the status remains
INDEPENDENT_REVIEW_PENDING. Prior independent reviews are historical inputs.

Read-only comparison against frozen B proved no manual changes to `src/remote`,
`src/server.js`, `src/db`, Android sources, harness or nightly policy. The
only `src` difference from B is the earlier reviewed mobile CSS. B remained
clean at `0b0a4669902dfed2a3573f3090c32644711e07ca`; donor R remained at
`5cd14776a621b66292d7124604c215e51ad19636`. Newer B commits were not imported.

The only temporary clone, `.mobile-verification-DbEIF9`, had clean status,
zero active process cwd references and no files under its artifact directory.
Its 575 MiB (`du -sh`; 577,531,644 apparent bytes) was moved to the trash after
verification and is recoverable. All gate/evidence roots are outside that clone
and retained. No foreign worktree or stale foreign Git record was pruned.
The existing owned review branch remains the only integration output, without
upstream or push. Final evidence HEAD is a documentation-only descendant of
the immutable product candidate, identified in Git and the operator handoff.
