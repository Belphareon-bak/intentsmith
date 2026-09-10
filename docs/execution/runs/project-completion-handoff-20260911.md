# IntentSmith project completion handoff — 2026-09-11

Status: `TECHNICAL_CONVERGENCE_GREEN / TWO_OPERATOR_DECISIONS_REQUIRED /
M5_EXTERNAL_ACTIONS_REQUIRED / M6_REVIEW_AND_ACCEPTANCE_BLOCKED /
M7_PHYSICAL_GATE_BLOCKED`.

This is the current convergence ledger. It does not issue an acceptance,
receipt, release tag or publication authority.

## Exact identity and current deterministic gate

The last product commit is the reviewed M7 candidate
`429b779f26b2f66a1c378e529c082d6b436609ca`. The range from that commit through
the measured evidence HEAD
`05803dad0dd29e64eeddeb03a8c6f8b6c9ceff04` changes documentation only; a Git
diff over `src`, `contracts`, `scripts`, `mobile-app`, `systemd`, `tests` and
package manifests is empty.

One clean registered audit on `05803dad` ran every required deterministic
program with concurrency one and the exact declared local toolchains:

```text
inventory             = 352 programs
profiles               = 279 offline + 73 database
result                 = 352 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED
source revision        = 05803dad0dd29e64eeddeb03a8c6f8b6c9ceff04
registry fingerprint   = 3ce12a0edffe7e6da0f875ce3f0b25758524641557023d00aae39d0784fdbbfc
inventory fingerprint  = c1a621012e464e5139fe860c3732d78fdfa83482ad966eba55c5fa7311c3110b
options fingerprint    = 533fb61b7113b560d7e9cdb0cbaea3bb96a1f4621554c41f3836b378a94f4c20
started/ended UTC      = 2026-09-10T23:37:01.005Z / 23:41:06.737Z
```

Report:
`.intentsmith-artifacts/current-convergence-20260911/current-deterministic-20260911-02/report.json`,
SHA-256 `544e244525595d9ce325c1ea852add088df9fee345a926111eafa8c4fac80091`.
The audit did not include model, GPU, external-network, owned-server, soak or
manual profiles. It is a current deterministic integration result, not a full
M6 release verdict.

## Milestone truth

| Branch | Current result | What remains |
|---|---|---|
| M0–M4 | accepted | no release blocker identified in this pass |
| M5 | `8/9 REVIEW_PASSED / KEY_CUSTODY_PARTIAL / PRIVACY_CHANGES_REQUIRED / ACCEPTANCE_BLOCKED` | custody completion, eight category actions and receipts, history receipt, final M5 acceptance |
| M6 | deterministic current tree green; runtime evidence collected; two review packets open | two product decisions, review verdicts, one frozen candidate, complete model cookbook, M5 input, signed review/demo/Gate 0 |
| M7 | current product delta through `429b779f` independently reviewed; host gate green | VPN/TLS/HMAC/service/firewall, release signer/build, physical Android 13+7 matrix, evidence review and distribution decision |

The mobile source review chain is complete for the current product bytes:
`70eef905` closes the VPN/listener/Android base and
`8a811381..429b779f` covers every later M7 product change. Commits after
`429b779f` are documentation only. M7 therefore does not currently need another
source implementation block; it needs the physical environment.

## Reviewable milestones prepared in this batch

1. `c2a436b5` records M7 UI remediation `REVIEW_PASSED` on `429b779f`.
2. `ef97af42` hands off the real 24-hour soak, full throughput and real
   FILE_EXPLAIN evidence. Its exact requested status remains `REVIEW_REQUIRED`.
3. `12b63e58` reconciles accepted Decision 020 and the M5 DATA/AUTH/PERF review
   states without activating automatic failover.
4. `05803dad` hands off the current L0-11 model artifact authority snapshot:
   232 focused and 171 support checks, exact 17-blob scope,
   `RE_REVIEW_REQUIRED`.
5. This evidence-only handoff adds the current full 352-program deterministic
   result and the final dependency map.

No commit was pushed, tagged, merged or published.

## Two explicit product decisions

These cannot be inferred from the general instruction to finish the project,
because they change accepted authority boundaries under `CONTRACT.md section
11`.

### Complete SPEC output budget

Recommended decision: allow at most 6000 output tokens only for the internal
complete-SPEC document path. Keep the general planner, analysis and all other
roles at 4000. Caller input and model output cannot mint the exception; lower
limits remain lower and truncated JSON remains an error.

Evidence: with a physically verified 16384 context, three nutrition-revision
attempts ended at 5795 input + 4000 output with `length`; context was not the
limiting resource. The proposal and its independent scope review are:

- `.intentsmith-artifacts/core-completion-20260909/provider-proposal/completion-spec-budget-decision-20260909.md`;
- `.intentsmith-artifacts/core-completion-20260909/provider-proposal/completion-spec-budget-decision-20260909.mobile-review.json`.

Rejecting the exception is valid, but then the complete-SPEC user outcome still
needs a measured compression design under 4000 or must be removed from the 1.0
acceptance scope. The previous concise-prompt experiment failed and was reverted
byte-for-byte.

### Web search in a conversation without a project

Recommended decision: authorize the proposed separately typed
conversation/session network scope. It binds an authenticated conversation
owner, one visible exact HTTPS request, a five-minute single-effect grant,
durable output and replay without a second request. It does not create a fake
project or general internet authority.

The alternative is to keep projectless web unavailable. That is safer and
smaller, but leaves 34 measured B/C/E search attempts denied and requires the
1.0 product scope to say so explicitly. Proposal and independent source review:

- `.intentsmith-artifacts/core-completion-20260909/provider-proposal/completion-network-decision-20260909.md`;
- `.intentsmith-artifacts/core-completion-20260909/provider-proposal/completion-network-decision-independent-review-93173e15.json`.

No network scope or 6000-token exception is implemented or active.

## M5 custody and receipts

Current-tree privacy scan on `05803dad` is `PASS` over 2327 tracked files with
zero findings. All 13 known incident objects remain reachable, so the final
verdict remains `PASS_CURRENT_TREE_HISTORY_REMEDIATION_REQUIRED`. The retained
scan is
`.intentsmith-artifacts/current-convergence-20260911/preflight-05803dad/privacy-scan.json`,
SHA-256 `47a69f09569241bba794cf0e18dc0b2f2631071b7ca46c5a0ff5e7b30a36c4a2`.

Medium A is one verified LUKS2 offline copy of the three operator keys. During
this pass it was found automounted and unlocked, with no process using it. It
was unmounted, LUKS-locked and powered off again. The online source still holds
all four keys until the backup/custody set is complete.

Under the accepted policy, ordinary private cloud storage or an online NAS is
not medium B. It may hold a separately client-encrypted recovery copy. Medium B
must keep the `m6-independent-reviewer` key physically or equivalently outside
the application/worker/operator-key custody and unavailable during normal
operation. A 4–16 GB LUKS2 USB device is ample; the existing full key/public
manifest preflight is only 3562 bytes and medium A payload is 5462 bytes.

For a robust closeout, provide two additional small media or an independently
reviewed equivalent:

1. a second verified offline backup of the three operator keys, allowing the
   online operator-key source to be removed;
2. physically separate medium B for the reviewer key.

The next M5 work then requires private operator facts, not more repository
coding: resolve each of the eight credential categories by actual rotation or
historically supported N/A, commit redacted action evidence, sign eight ordered
category receipts, sign `retain_and_rotate` history, review PRIVACY, then sign
M5 acceptance. No receipt may contain a secret or its digest/prefix/suffix.

## Current host boundary for M7

Read-only preflight found no `tailscale`, `wg` or `adb` executable; no approved
VPN interface; no `intentsmith-m7.service`; and no listener on port 7443. The
system provider reports `0.32.14-intentsmith.1` with no model loaded. The
retained preflight is
`.intentsmith-artifacts/current-convergence-20260911/preflight-05803dad/host-preflight.txt`,
SHA-256 `2848c863443592c95b4f4ec1894fe098f3d0c5a2c217480d54eef2b2c5f515f3`.

The next physical M7 sequence is therefore:

1. install/activate Tailscale or a maintained WireGuard setup and freeze the
   exact VPN origin;
2. create separate TLS and 32-byte limiter HMAC material, encrypt them through
   systemd credentials, render/verify/install the service and restrict port
   7443 to the VPN interface;
3. create and back up the Android release signer, install `adb`, build the exact
   APK/AAB with the final origin/SPKI and install it on an API 29+ locked phone;
4. run the 13 transport/runtime checks and 7 accessibility/device scenarios;
5. create the private content-addressed evidence bundle and obtain independent
   review.

This branch can proceed separately and does not block desktop IntentSmith 1.0
while `INTENTSMITH_M7_REMOTE_ENABLED` remains false.

## Fastest path from here

1. Review the prepared M6 runtime and L0-11 packets while the two decisions are
   answered.
2. Implement and measure the accepted SPEC and projectless-web choices.
3. Complete custody and the eight external credential dispositions, then M5
   PRIVACY review and acceptance.
4. Freeze one exact desktop candidate and rerun its deterministic, build,
   upgrade, model/cookbook, FILE_EXPLAIN, server, soak and throughput matrix.
5. Obtain M6 independent review, run the nine-step operator demo and issue the
   ordered signed review/demo/Gate 0 receipts.
6. Only after standalone bundle verification request separate approval for
   merge, tag and publication.

The remaining work is now concentrated in two explicit behavior decisions,
external credential facts/custody, two pending reviews and physical release
evidence. No unidentified repository implementation loop remains in this
snapshot.
