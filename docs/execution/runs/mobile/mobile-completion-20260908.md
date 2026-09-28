# Mobile completion — 2026-09-08

Status: SCOPED_SOURCE_REVIEW_PASSED / BASELINE_GATE_FAIL / NOT_RELEASE_READY.
This is exact-run evidence, not a replacement milestone authority.

Base: `de0e81275afa381dd6a73afbb699bde47971b658`.
Owned branch: `work/mobile-completion-20260908`.
Owned checkout: `/home/belphareon/worktrees/is-mobile-completion-20260908`.
Product candidate: `88d1d45ba90f287a1a5ed166e2be0de1b75dc29c`.
Candidate tree: `34b02110ffade4b0a80728449384cd5edf4127b1`.
Independent source review: PASS. Doc-only follow-up
`56665cd40c969f417589f20c7e14a1558754a638`: independently REVIEW_PASSED.
Scope and authority: [WP](../../../wp/WP-MOBILE-COMPLETION-20260908.md).

## Inventory and compatibility

Integration `codex/m7-mobile-contract-integration-20260829` was pinned at
`de0e8127`. Its foreign writer is building native M7 Java/client transport;
that dirty work was not modified, imported or tested as committed evidence.
UI donor `wp/mobile-convergence-prep-20260908` was clean at
`5cd14776a621b66292d7124604c215e51ad19636`. Archive donor `ab1940aa` was clean.
Main checkout `832db06f` has foreign dirt and was left untouched. No push.

The UI donor cannot be merged wholesale: `/m1` versus signed `/remote/v1`,
different settings/project/stored-information DTOs, no B projectId list filter,
and no B workers/specialists/device-management operations. Donor navigation
also uses scopes without enforcing advertised availability. These are actual
integration requirements, not completed features. Current core has M7 VPN
runtime wiring; old listener-absent snapshots do not describe this base.

## Implemented in this cut

Source-compatible CSS/a11y changes, fail-closed dirty release provenance and
current README/runbook pointers. No core/server, migration, wire contract,
Android/native foreign code or trust-store changes. Focused tests are green;
the full gate is red for independently reproduced integration baseline issues.

Raw logs: `.intentsmith-artifacts/mobile-completion-20260908/` in owned checkout.
Initial browser launch was BLOCKED by root-created artifact directory mode;
0700 correction fixed this run prerequisite, without changing test assertions.
Original browser suite: 22 PASS / 0 FAIL. Strengthened oracle: 21 PASS / 3 FAIL.
Including real MS-14 decision controls: 20 PASS / 4 FAIL. These red runs remain
retained. Measured defects: light primary text 3.90:1, dark danger label 2.80:1,
dark selected navbar 4.28:1 and horizontal overflow at 200% font.
After repair: browser 24 PASS / 0 FAIL across 8 existing integration surfaces;
Android release boundary 16 PASS / 0 FAIL. No donor-only screen is counted.

## Reproduced verification on the product candidate

| Check | Result | Raw evidence under the run artifact directory |
|---|---|---|
| Mobile gate | 42/42 PASS, exit 0 | `mobile-gate.log` |
| Browser | 24/24 PASS, exit 0 | `browser-fixed.log`; also rerun in fresh full gate |
| Android release boundary | 16/16 PASS, exit 0 | full-gate `logs/tests_mobile-android-release.test.js.*.log` |
| Registry | 507 programs, exit 0 | `registry.log` |
| APK + AAB build | PASS, exit 0; 121 Gradle tasks | `android-build.log` |
| Offline debug unit + release lint | PASS; **1 template unit test only**, 0 lint errors / 13 warnings | `android-test-lint.log`, `android-reports/` |
| Archive/source/signature binding | PASS, `THROWAWAY_DEBUG_SIGNED` | `android-evidence.log`, release manifest below |
| Runtime npm audit | 0 reported runtime vulnerabilities | retained release SBOM/audit below |
| Fresh clone default full gate | **336 PASS / 3 FAIL / 8 BLOCKED**, exit 1 | `full-gate/mobile-completion-88d1d45b-fresh/report.json` |
| Base replay of the three FAIL suites | **0 PASS / 3 FAIL**, exit 1 | `full-gate/mobile-completion-de0e8127-baseline/report.json` |
| Fresh clone full gate with explicit local toolchains | **344 PASS / 3 FAIL / 0 BLOCKED**, exit 1 | `full-gate/mobile-completion-88d1d45b-provisioned/report.json` |

Registry fingerprint:
`2111d9ad93f7c4b060d39a530d9cac62cb488c15fdd1f8af63316ee24846613f`.
Fresh-clone provisioning initially failed `npm ci --offline` with ENOTCACHED
for zod3.25.76. Reinstall from the exact lockfile with the network enabled
succeeded (233 root and 98 mobile packages); the actual gate used offline/database
profiles, not live LLM/GPU or external-network suites. Chromium was cache-provisioned.

The three failures were replayed on base `de0e8127` in the same disposable clone:

- `tests/artifact-validation.test.js`: 154/158, the same four failures on both
  SHAs: root README counts, SYSTEM-MAP LOC, ROADMAP edge census, privacy-state docs.
  The privacy-named test fails only its last SYSTEM-MAP count assertion; all
  seven privacy/API/WP/Decision041 conditions pass. This is not a new key or
  signature defect. Registry507/413ACTIVE vs documented500/406; edges1268.
  Source JS count is unchanged by this slice; tests add97 lines to an already
  stale LOC total (base233780, candidate233877, documented232499).
- `tests/harness-exit-code.test.js`: database-reachable count is 126, oracle124,
  on both SHAs. No test program or registry entry was added by this mobile cut.
  The two prior BE roots are `m7-vpn-production-runtime.test.js` and
  `m7-vpn-tls-listener.test.js`; read-only import analysis found0 unprotected roots.
- `tests/nightly-orchestrator-self-test.js`: current registry hash differs from
  reviewed Gate0 policy on both SHAs. A mobile author cannot ratify that policy.
  Sealed profile counts are270offline/70database, current274/73.

The eight default BLOCKED suites require explicit local toolchain authority:
git, bwrap/bubblewrap, prlimit and Python PDF. The second full run with those exact
allowances finished344PASS/3FAIL/0BLOCKED, exit1, 20:50:42–20:54:52 UTC;
no `--no-block` or state/policy bypass was used. Its command:

```bash
LC_ALL=C INTENTSMITH_PDF_PYTHON=/home/belphareon/worktrees/is-m6-operator-demo-prep-20260827/.intentsmith-artifacts/pdf-runtime/bin/python npm run test:deterministic -- --allow-blocker=toolchain:git,toolchain:bwrap,toolchain:bubblewrap,toolchain:prlimit,toolchain:python-pdf-runtime --run-id=mobile-completion-88d1d45b-provisioned --out-dir=/home/belphareon/worktrees/is-mobile-completion-20260908/.intentsmith-artifacts/mobile-completion-20260908/full-gate
```

This reused an existing isolated Python runtime (reportlab5.0.0), without
changing BE source, its configuration or its test processes.

## Actual Android artifacts

Retained manifest:
`.intentsmith-artifacts/mobile-release/88d1d45ba90f/manifest.json`.
Source verification is `COMMITTED_SOURCE`, dirty=false; APK and AAB each
declare and independently match product SHA `88d1d45b`. Their metadata and
network-security trees agree. APK SHA-256:
`e4b5ae561639737773e3af1684dafd5fd2eef6f492d1d167a938b1babf3a4590`.
AAB SHA-256:
`baf08b8f22db19a554e2c082c5cc753341823830c3b468c510b02b4bf6402c93`.

These are **not distributable releases**. The embedded mode is `legacy-m1-dev`,
origin `http://127.0.0.1:3336`, global native HTTP patch=true and
`releaseTransportReady=false`. The manifest's historical compound blocker code
does not mean the newer core VPN listener is absent; it means this mobile
artifact is not bound to that production transport. There is no production
signer authority or native/security device proof in the template JVM unit test.

## Milestone boundaries

Existing donor MM0/MM1 completion belongs to its own lineage, not this candidate.
MM2 needs the accepted B connector/DTO consumer; MM3/MM4 need per-domain porting,
server capability+scope gates and missing BE-owned operations. MM5 requires
native session/security/lifecycle integration plus physical evidence; browser
accessibility alone cannot close it. MM6 requires final-tree APK/AAB binding,
production signer authority, distribution and device acceptance. M7 global
acceptance and M5/M6 receipts remain outside this mobile-only slice.

## Host and remaining prerequisites

2026-09-08 observation: Temurin21.0.12+8, SDK36/build-tools36.0.0,
Gradle8.14.3 cache, Capacitor8.5.0 lock, AGP8.13.0; pinned bundletool1.18.1
SHA-256 `a73341a7945abcb0e6b8971c7b1b2801bd765006447ca0d2437a4260d572ceac`.
Root and mobile dependencies installed offline successfully; Chromium145.0.7632.67
reused from host cache into the owned project cache.
`adb devices -l`: no device (started local adb daemon5037).
`ip -brief address`: lo, Wi-Fi and Docker/veth, no VPN interface.

Needed for actual production acceptance: integrated native client with bundled
Decision042 origin/SPKI and exact source asset manifest; no global HTTP patch;
physical phone/VPN pairing, replay/mismatch/expiry/revocation/recovery/TalkBack
matrix; systemd credential custody; explicit APK/AAB signer identities;
distribution and operator acceptance. No credentials were generated or read,
no real pairing, listener activation, device installation, tag or publication.

## Handoff

Product code is frozen at the candidate above. Evidence/document-only follow-up
fixes the independently found runbook cwd bug: the Gradle command uses a subshell
so subsequent npm commands still run from the root. Final full-run result is
recorded above. Reviewer independently closed the handoff P2 on evidence commit
`56665cd40c969f417589f20c7e14a1558754a638` and rehashed the retained APK/AAB.
Neither baseline FAIL nor global NOT_READY is waived.

Cleanup: the owned fresh clone
`/home/belphareon/worktrees/.mobile-verification-33N72t` was clean at S88, no
process had its cwd there, and it contained no residual test evidence (only
an empty artifact-directory tree). It was moved to the desktop Trash, about
602 MiB, **recoverable**, not claimed as freed disk space. Three disposable
runtime/home directories selected for this checkout by the workspace-budget
dry run were also moved to Trash. All raw red/green reports, checkpoints,
inventories, logs, Android reports and APK/AAB remain in the owned evidence
directory. The two full-run runtime trees were protected by the evidence rule
and retained. No global cleanup command was applied to foreign worktrees.
The adb daemon started by this run was stopped only after confirming no devices
or connected clients; other workers' processes were not stopped.

One owned review branch/worktree remains, clean, without upstream and unpushed:
`work/mobile-completion-20260908`. It is not yet absorbed by integration.
At final inventory the foreign integration HEAD was still `de0e8127`, with
active native/session/UI work plus new changes to the same release-policy and
evidence scripts. Therefore **do not overwrite those files from this branch**:
merge after its owner commits, preserve its transport/config fields AND this
slice's mandatory dirty-source provenance, then rerun both release and mobile
boundaries on the new merge SHA. No foreign branch was reset, cleaned or merged.
Do not infer PROD_READY from this document or transfer donor test counts.
