# WP-MOBILE-CONVERGENCE-20260909

Status: SCOPED_COMPLETE / INDEPENDENT_REVIEW_PENDING / NOT_RELEASE_ACCEPTANCE.

Product candidate: `f7f78d5a113df0029ff16dea5bbfdf8469b6623f`.
All three scoped milestones are implemented and verified. Ordinary deterministic
gate remains FAIL: 350 PASS / 1 expected sealed-registry drift FAIL (CONTRACT §8).
Results: [execution ledger](../execution/runs/mobile/mobile-convergence-20260909.md)
and [review packet](../review/2026-09-09-MOBILE-CONVERGENCE-REVIEW.md).

Authority: operator instruction to perform the proposed exact merge, compose both
release guards, port the locale correction and verify the resulting candidate.
This WP records that scope; it does not create product or release authority.

Owned checkout/branch: existing `is-mobile-completion-20260908` /
`work/mobile-completion-20260908`. No new worktree, push or foreign edits.
Fixed merge parents: mobile `1ab8d9425c58d2d087cd0c868097545616cc54d2` and
B `f812259d787671358f78d5e789373b39dbfbcd57`.
Locale donor: `5cd14776a621b66292d7124604c215e51ad19636`, correction `15e1cd6f`.
B already moved to `0b0a4669` at preflight; those five later commits are excluded.

## Milestones

1. Merge pinned B without hand-editing backend/runtime/migrations. Resolve the
   policy, generator and runbook conflicts by preserving mandatory sourceDirty,
   non-debug verified signers, M5/M7-specific pins, origin/SPKI, physical runtime
   evidence, native HTTP prohibition and private non-clobbering output. Preserve
   doc-only history and positive/negative guards. Test the release conjunction.
2. Bring the locale-independent inventory onto B: script, registered test and
   regenerated JSON/Markdown. Do not resurrect missing `/m1` server or donor's
   nine-domain contract. Separate desktop route declarations, actual M7 HTTP
   transport routes and canonical operation descriptors; static inventory is
   not session availability or new backend authority. Test locale independence
   and stale-artifact detection.
3. Verify mobile/browser/release, registry, fresh-clone ordinary deterministic
   gate and explicit throwaway Android build/binding. Update measured current
   documentation on this integration candidate. Retain failures; Gate0 sealed
   registry drift is not permission to ratify a release under CONTRACT §8.

No production keys, listener/systemd/VPN activation, pairing, device install,
signing/distribution or live LLM/GPU tests. Existing hardware prerequisites and
foreign changes remain outside scope. Report exact product/evidence SHA and
review status; do not inherit independent acceptance across changed bytes.
