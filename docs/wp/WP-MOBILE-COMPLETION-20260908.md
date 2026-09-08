# WP-MOBILE-COMPLETION-20260908

Status: IMPLEMENTED / SOURCE_REVIEW_PASSED / BASELINE_GATE_FAIL /
FINAL_HANDOFF_REVIEW_PENDING / NOT_RELEASE_ACCEPTANCE.

Product candidate: `88d1d45ba90f287a1a5ed166e2be0de1b75dc29c`.
Results: [execution evidence](../execution/runs/mobile/mobile-completion-20260908.md)
and [milestone review](../review/2026-09-08-MOBILE-COMPLETION-REVIEW.md).

Authority: explicit operator request to finish mobile work and review milestones;
`docs/mobile/UI-DESIGN.md` §4, §8 and §10; existing release artifact source-binding
requirements. This WP records scope, not new product or operational authority.

Base: `de0e81275afa381dd6a73afbb699bde47971b658` (current M7 integration).
Owned branch: `work/mobile-completion-20260908`.
Owned checkout: `/home/belphareon/worktrees/is-mobile-completion-20260908`.
One writer; parallel reviewers are read-only.

## Scope

1. Port compatible accessibility measurement/layout repairs from the mobile UI
   donor `5cd14776a621b66292d7124604c215e51ad19636` onto existing integration DOM.
   Measure sRGB/translucent colours, all navigation labels, 48 dp controls and
   320/390 dp reflow at 100/200% text. Do not import donor backend or incompatible
   domain DTOs.
2. Prevent dirty source evidence from being classified as production-ready;
   retain clean-source behaviour and explicit throwaway evidence.
3. Reconcile the current mobile entry runbook and milestone evidence; verify
   available deterministic/browser/Android tooling without real signing,
   pairing, device writes, service activation or publication.

Allowed product paths: `src/mobile/client/app.css`,
`tests/mobile-browser-a11y.test.js`, existing Android release evidence/binding
scripts and their existing tests. Documentation: this WP, current mobile
runbook, completion execution/review evidence. Changes to source-binding fixtures
must be explained by the actual source changes, never by weakening the gate.

## Ownership and exclusions

The integration checkout has a foreign active native M7 transport writer. Its
Android/Java/native client changes remain untouched. No changes to backend,
runtime/server, wire contract, migrations, trust store, production keys,
remotes or foreign worktrees. The UI donor uses incompatible legacy DTOs;
wholesale merge is not authorized by this work package. Historical evidence
is retained, not overwritten with current verdicts.

## Verification and handoff

Preserve initial failures, run serially per checkout, then browser/mobile,
release boundary, registry and ordinary deterministic gates. Build an explicitly
throwaway Android artifact only if toolchain prerequisites allow. Review the
immutable product commit independently; keep evidence-only HEAD separate.
Record device/VPN/signing/contract prerequisites as blockers, not PASS. Keep one
clearly owned review branch; remove only this run's disposable runtime sandboxes,
never evidence or another worker's checkout. No push, tags or acceptance receipts.
