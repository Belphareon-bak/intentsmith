# IntentSmith project completion handoff — 2026-09-11

Status: `CURRENT_DETERMINISTIC_352_PASS / ONE_OPERATOR_DECISION_REQUIRED /
SPEC_REMEDIATION_RE_REVIEW_REQUIRED /
M5_EXTERNAL_ACTIONS_REQUIRED / M6_REVIEW_AND_ACCEPTANCE_BLOCKED /
M7_PHYSICAL_GATE_BLOCKED`.

This is the current convergence ledger. It does not issue an acceptance,
receipt, release tag or publication authority.

## Exact identity and current deterministic gate

The last product commit is the Decision 043 gateway-ceiling remediation
`dca0e89bcc47a1dce96fbe0d3f0616aadccd3b2c`. Its history includes the reviewed
M7 candidate `429b779f26b2f66a1c378e529c082d6b436609ca`; the later product change
does not touch M7 bytes. The range after `3291b5d4` through independently
inspected evidence HEAD `983121ee` changed documentation only. The next product
delta is exactly the gateway remediation `dca0e89b`; evidence HEAD `d2b03cc3`
adds only its handoff documents.

One clean registered audit on evidence HEAD `d2b03cc3` ran every required
deterministic program with concurrency one and the exact declared local
toolchains:

```text
inventory             = 352 programs
profiles               = 279 offline + 73 database
result                 = 352 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED
source revision        = d2b03cc32baf95ade4f096b22d875c4119ee9491
registry fingerprint   = 3ce12a0edffe7e6da0f875ce3f0b25758524641557023d00aae39d0784fdbbfc
inventory fingerprint  = c1a621012e464e5139fe860c3732d78fdfa83482ad966eba55c5fa7311c3110b
options fingerprint    = 533fb61b7113b560d7e9cdb0cbaea3bb96a1f4621554c41f3836b378a94f4c20
started/ended UTC      = 2026-09-11T15:09:05.988Z / 15:14:11.804Z
```

Report:
`.intentsmith-artifacts/current-convergence-20260911/current-deterministic-d2b03cc3-20260911-01/report.json`,
SHA-256 `023307449433ab34c4c203c6cf0d8681caa84e6a382c6097ba656de0fd8b9d4a`.
All 352 IDs and source revisions are exact; all 352 log files exist and their
report-bound SHA-256 digests match. Details:
[`current-deterministic-d2b03cc3-20260911.md`](current-deterministic-d2b03cc3-20260911.md).
The audit did not include model, GPU, external-network, owned-server, soak or
manual profiles. It is a current deterministic integration result, not a full
M6 release verdict.

## Milestone truth

| Branch | Current result | What remains |
|---|---|---|
| M0–M4 | accepted | no release blocker identified in this pass |
| M5 | `8/9 REVIEW_PASSED / KEY_CUSTODY_PARTIAL / PRIVACY_CHANGES_REQUIRED / ACCEPTANCE_BLOCKED` | custody completion, eight category actions and receipts, history receipt, final M5 acceptance |
| M6 | current deterministic tree green; SPEC gateway remediation awaiting re-review; runtime evidence collected | one web decision, review verdicts, one frozen candidate, complete model cookbook, M5 input, signed review/demo/Gate 0 |
| M7 | current product delta through `429b779f` independently reviewed; host gate green | VPN/TLS/HMAC/service/firewall, release signer/build, physical Android 13+7 matrix, evidence review and distribution decision |

The mobile source review chain is complete for the current product bytes:
`70eef905` closes the VPN/listener/Android base and
`8a811381..429b779f` covers every later M7 product change. The only later product
change is the separate Decision 043 SPEC candidate; it changes no M7 path. M7
therefore does not currently need another source implementation block; it needs
the physical environment.

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
6. `3291b5d4` implements the operation-bound complete-SPEC 6000 limit;
   its first review returned `CHANGES_REQUIRED` for a pre-existing legacy
   gateway ceiling gap. `dca0e89b` closes that gap while preserving all prior
   default and live operation budgets and now awaits narrow re-review.
7. `5279da5c` records separate reviewer custody medium B and `51846695` prepares
   all eight M5 credential actions in one operator packet.
8. The fresh registered gate on `d2b03cc3` is 352/352 PASS and includes the
   gateway remediation; its exact report is linked above.

Branch publication is transport only and grants no tag, merge, acceptance or
release authority.

## Product decisions

These cannot be inferred from the general instruction to finish the project,
because they change accepted authority boundaries under `CONTRACT.md section
11`.

### Complete SPEC output budget

**Accepted by the operator and implemented as a remediation candidate on
2026-09-11.** Decision 043 allows at most 6000 output tokens only for the
internal complete-SPEC document path. The general planner, analysis and all
other ordinary D1 paths remain at 4000. Caller input and model output cannot
mint the exception; lower limits remain lower and truncated JSON remains an
error.

The first independent source review accepted the SPEC binding and returned
`CHANGES_REQUIRED` for an older sibling path: `callWithAuth()` did not enforce
the declared role ceiling. Candidate `dca0e89b` separates ordinary defaults
from maximum role ceilings and enforces the latter in `authorize()`,
`isAuthorized()` and `call()`. Its new regression proves an issued token one
above ceiling makes zero provider calls. This remediation is focused-green but
is not accepted until independent re-review.

Evidence: with a physically verified 16384 context, three nutrition-revision
attempts ended at 5795 input + 4000 output with `length`; context was not the
limiting resource. The proposal and its independent scope review are:

- `.intentsmith-artifacts/core-completion-20260909/provider-proposal/completion-spec-budget-decision-20260909.md`;
- `.intentsmith-artifacts/core-completion-20260909/provider-proposal/completion-spec-budget-decision-20260909.mobile-review.json`.

The implementation has deterministic authority evidence and still needs exact
source review followed by the original real-model cookbook. Decision acceptance
does not claim that 6000 is sufficient. The previous concise-prompt experiment
failed and was reverted byte-for-byte.

Review result and current re-review questions:
[`first review result`](../../review/2026-09-11-COMPLETE-SPEC-6000-REVIEW-RESULT.md)
and [`gateway remediation packet`](../../review/2026-09-11-COMPLETE-SPEC-6000-GATEWAY-REMEDIATION-REREVIEW-PACKET.md).

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

The live DuckDuckGo HTML preflight returned an interactive bot challenge. It is
therefore rejected as an unattended backend. Stage 1 now requires a supported
API or an operator-controlled service with documented availability, privacy
and rate-limit behavior before implementation begins.

No projectless network scope is implemented or active. The 6000-token exception
is implemented only as a remediation candidate and has no new real-model result.

## M5 custody and receipts

Current-tree privacy scan on `d2b03cc3` is `PASS` over 2 336 tracked files with
zero findings. All 13 known incident objects remain reachable exactly as
declared by `retain_and_rotate`, so the scanner verdict is
`PASS_CURRENT_TREE_HISTORY_RETAINED_AS_DECLARED`. The signed history receipt
is still missing. The retained scan is
`.intentsmith-artifacts/current-convergence-20260911/preflight-d2b03cc3/privacy-scan.json`,
SHA-256 `d4f559b2ec5a3684197d6c42c37edf0e81e72391000bc7d9fe9c529bf36c37b4`.

Medium A is one verified LUKS2 offline copy of the three operator keys. During
this pass it was found automounted and unlocked, with no process using it. It
was unmounted, LUKS-locked and powered off again. The online source still holds
all four keys until the backup/custody set is complete.

Medium B is now a separate verified LUKS2 offline copy containing exactly the
`m6-independent-reviewer` private key plus public material. It excludes all
three operator private keys and was locked and powered off after verification.
The exact non-secret record is
[`m5-offline-custody-b-20260911.md`](m5-offline-custody-b-20260911.md).

Under the accepted policy, ordinary private cloud storage or an online NAS is
not medium B. It may hold a separately client-encrypted recovery copy. Medium B
must keep the `m6-independent-reviewer` key physically or equivalently outside
the application/worker/operator-key custody and unavailable during normal
operation. A 4–16 GB LUKS2 USB device is ample; the existing full key/public
manifest preflight is only 3562 bytes and medium A payload is 5462 bytes.

For a robust closeout, the two-media plan is now half completed:

1. a second verified offline backup of the three operator keys, allowing the
   online operator-key source to be removed — **still required**;
2. physically separate medium B for the reviewer key — **completed as an
   offline verified copy on 2026-09-11**.

Independent review deliberately verified only that medium B and its mapper were
absent; it did not weaken custody by remounting the disk to reproduce the
contents. Before the remaining online reviewer-key source is removed, a new
checkpoint must test both the known medium-B passphrase and an independently
encrypted recovery copy. A client-side encrypted archive on a private cloud or
NAS can serve as recovery, but does not replace offline medium B and must keep
its decryption authority separately.

The next M5 work then requires private operator facts, not more repository
coding: resolve each of the eight credential categories by actual rotation or
historically supported N/A, commit redacted action evidence, sign eight ordered
category receipts, sign `retain_and_rotate` history, review PRIVACY, then sign
M5 acceptance. No receipt may contain a secret or its digest/prefix/suffix.
The exact category matrix, evidence rules and one-response fact sheet are in
[`m5-credential-action-packet-20260911.md`](m5-credential-action-packet-20260911.md).

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

1. Review the prepared M6 runtime and L0-11 packets while the remaining web
   decision is answered.
2. Review the implemented SPEC authority and then run its original real-model
   cookbook; implement projectless web only after its separate decision.
3. Add the second operator-key backup, complete the eight external credential
   dispositions, then M5 PRIVACY review and acceptance.
4. Freeze one exact desktop candidate and rerun its deterministic, build,
   upgrade, model/cookbook, FILE_EXPLAIN, server, soak and throughput matrix.
5. Obtain M6 independent review, run the nine-step operator demo and issue the
   ordered signed review/demo/Gate 0 receipts.
6. Only after standalone bundle verification request separate approval for
   merge, tag and publication.

The remaining work is now concentrated in one explicit web decision, external
credential facts and the second operator-key backup, pending reviews and
physical release evidence. No unidentified repository implementation loop
remains outside the explicit SPEC review/model-measurement candidate in this
snapshot.
